import { renderResult } from './render.js'

function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

/**
 * The harness only accepts lossless JSON as a tool value: TL records carry
 * BigInt ids and `undefined` optionals, so normalise once at the boundary.
 */
function toLossless(value) {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? String(item) : item)))
  } catch {
    return null
  }
}

function define({ name, description, parameters, kind = 'other', run }) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      // Every tool goes through one renderer: see lib/render.js for the budget.
      render: (args, value) => [{ type: 'text', text: renderResult(name, args, value) }],
    },
    presentCall: (args) => {
      const chat = args && typeof args === 'object' && typeof args.chat === 'string' ? args.chat : ''
      return {
        card: 'generic',
        title: chat === '' ? `Telegram · ${name.replace(/^tg_/u, '')}` : `Telegram · ${name.replace(/^tg_/u, '')} · ${chat}`,
        kind,
      }
    },
    async execute(args) {
      try {
        return toLossless(await run(args ?? {}))
      } catch (error) {
        return fail(error)
      }
    },
  }
}

const CHAT_DESCRIPTION = 'Chat: @username, t.me link, peer id, exact title or title fragment; "me" = Saved Messages.'

export function createTools({ session, web }) {
  const tools = []

  tools.push(define({
    name: 'tg_login',
    kind: 'read',
    description: 'Telegram status: configured/authorized, network path, identity, whitelist, DSH chat, pending inbox. Login, logout, proxy and whitelist edits grant authority, so they are user-only (DSH Settings → Telegram) and not callable here.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status'] },
      },
      required: ['action'],
    },
    async run(args) {
      if (args.action !== 'status') return { ok: false, error: '只有 status 可以通过工具调用；登录、退出、代理和白名单请在 DSH 设置 → Telegram 里操作。' }
      return { ok: true, ...(await session.status()) }
    },
  }))

  tools.push(define({
    name: 'tg_dialogs',
    kind: 'read',
    description: 'List chats, channels and groups, newest activity first; filter by kind or a title/username fragment. Discover peer ids and handles here before reading or sending.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['all', 'channels', 'groups', 'users'], description: 'default all' },
        query: { type: 'string', description: 'Title/@username/peer id fragment.' },
        limit: { type: 'integer', description: 'Rows, 1-200, default 30.' },
        archived: { type: 'string', enum: ['exclude', 'only'], description: 'Read the archive folder instead of the main list.' },
      },
    },
    async run(args) {
      const result = await session.listDialogs({
        kind: args.kind ?? 'all',
        query: args.query ?? '',
        limit: args.limit ?? 30,
        archived: args.archived ?? 'exclude',
      })
      return { ok: true, ...result }
    },
  }))

  tools.push(define({
    name: 'tg_messages',
    kind: 'read',
    description: 'Read one chat newest-first: before/after page around a message id, search is full-text inside that chat, filter narrows by media. id fetches a single message with its full text (list text is clipped).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chat: { type: 'string', description: CHAT_DESCRIPTION },
        limit: { type: 'integer', description: 'Messages per page, 1-200, default 20.' },
        before: { type: 'integer', description: 'Only messages older than this message id.' },
        after: { type: 'integer', description: 'Only messages newer than this message id (returned oldest first).' },
        search: { type: 'string', description: 'Full-text query scoped to this chat.' },
        from: { type: 'string', description: 'Only messages authored by this user/chat reference.' },
        filter: { type: 'string', enum: ['photos', 'videos', 'documents', 'urls', 'music', 'voice', 'gifs', 'pinned'] },
        id: { type: 'integer', description: 'Fetch this one message (full text) instead of a page.' },
      },
      required: ['chat'],
    },
    async run(args) {
      if (typeof args.id === 'number') {
        const detail = await session.messageOf(args.chat, args.id)
        return { ok: true, chat: detail.resolved.record?.title ?? args.chat, peerId: detail.resolved.record?.peerId ?? null, message: detail.record }
      }
      return { ok: true, ...(await session.history(args.chat, { ...args, limit: args.limit ?? 20 })) }
    },
  }))

  tools.push(define({
    name: 'tg_buttons',
    kind: 'other',
    description: [
      'List (action=list) or press (action=press) the buttons attached to a message: inline bot keyboards and reply keyboards.',
      'Search groups work by keyword: send it with `tg_send`, then page the answer with the 第 N 页 / 类型 buttons. Omit msgId to take the newest message that carries buttons.',
      'Prefer label over button: the keyboard changes after every press, so `pressed.text` is the record of what was really pressed.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'press'], description: 'List or press.' },
        chat: { type: 'string', description: CHAT_DESCRIPTION },
        msgId: { type: 'integer', description: 'Message id holding the keyboard; omit to pick the newest message that has buttons.' },
        button: { type: 'integer', description: 'action=press: 1-based index from action=list.' },
        label: { type: 'string', description: 'action=press: button text instead of an index (exact first, then substring).' },
      },
      required: ['action', 'chat'],
    },
    async run(args) {
      if (args.action === 'list') return await session.buttons(args.chat, args.msgId)
      if (args.action === 'press') {
        if (typeof args.button !== 'number' && (typeof args.label !== 'string' || args.label.trim() === '')) {
          throw new Error('press 需要 button（序号）或 label（按钮文字）')
        }
        return await session.pressButton(args.chat, args.msgId, { button: args.button, label: args.label, enforceWhitelist: true })
      }
      return { ok: false, error: `unknown action: ${args.action}` }
    },
  }))

  tools.push(define({
    name: 'tg_search',
    kind: 'search',
    description: 'scope=global searches every chat the account can see; scope=chat searches inside one chat; scope=channels finds public channels/groups by name so they can be joined.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: { type: 'string', enum: ['global', 'chat', 'channels'], description: 'Where to search. Defaults to global.' },
        query: { type: 'string', description: 'Search text; empty is allowed for global media search.' },
        chat: { type: 'string', description: `Required for scope=chat. ${CHAT_DESCRIPTION}` },
        limit: { type: 'integer', description: 'Results, 1-100, default 20.' },
        filter: { type: 'string', enum: ['photos', 'videos', 'documents', 'urls', 'music', 'voice', 'gifs', 'pinned'] },
        minDate: { type: 'string', description: 'Earliest date, ISO 8601 (global scope only).' },
        maxDate: { type: 'string', description: 'Latest date, ISO 8601 (global scope only).' },
        channelsOnly: { type: 'boolean', description: 'Global scope: broadcast channels only.' },
        before: { type: 'integer', description: 'scope=chat: only messages older than this id.' },
        from: { type: 'string', description: 'scope=chat: only messages from this author reference.' },
      },
    },
    async run(args) {
      const scope = args.scope ?? 'global'
      if (scope === 'channels') {
        const items = await session.searchChannels(args.query ?? '', { limit: args.limit ?? 15 })
        return { ok: true, scope, count: items.length, items }
      }
      if (scope === 'chat') {
        if (!args.chat) throw new Error('scope=chat 需要 chat 参数')
        return { ok: true, scope, ...(await session.searchInChat(args.chat, { ...args, text: args.query ?? '', limit: args.limit ?? 20 })) }
      }
      return {
        ok: true,
        scope,
        ...(await session.searchGlobal({
          query: args.query ?? '',
          limit: args.limit ?? 20,
          filter: args.filter,
          minDate: args.minDate,
          maxDate: args.maxDate,
          channelsOnly: args.channelsOnly === true,
        })),
      }
    },
  }))

  tools.push(define({
    name: 'tg_comments',
    kind: 'read',
    description: "Open a channel post's comment thread and list it, or post into it with reply (replyTo a comment id, default the thread root).",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chat: { type: 'string', description: `Channel holding the post. ${CHAT_DESCRIPTION}` },
        msgId: { type: 'integer' },
        limit: { type: 'integer', description: 'Comments, 1-200, default 30.' },
        before: { type: 'integer', description: 'Only comments older than this comment id.' },
        reply: { type: 'string', description: 'When set, send this text into the comment thread instead of only reading it.' },
        replyTo: { type: 'integer', description: 'Comment id to answer; defaults to the discussion root.' },
        silent: { type: 'boolean', description: 'No notification sound.' },
      },
      required: ['chat', 'msgId'],
    },
    async run(args) {
      if (typeof args.reply === 'string' && args.reply.trim() !== '') {
        const resolved = await session.resolve(args.chat)
        await session.assertWhitelisted(resolved, '发表评论')
        return { ok: true, ...(await session.replyComment(args.chat, args.msgId, args.reply, { replyTo: args.replyTo, silent: args.silent })) }
      }
      return await session.comments(args.chat, args.msgId, { limit: args.limit ?? 30, before: args.before })
    },
  }))

  tools.push(define({
    name: 'tg_links',
    kind: 'read',
    description: 'Collect the URLs of one message (chat+msgId), resolve a t.me link into a chat and message (url), or fetch a plain http(s) page as text (url + fetch=true).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chat: { type: 'string', description: `Message source. ${CHAT_DESCRIPTION}` },
        msgId: { type: 'integer', description: 'Message id whose links should be listed.' },
        url: { type: 'string', description: 'A t.me message/chat link, or any http(s) URL to open.' },
        fetch: { type: 'boolean', description: 'Fetch the page content for a plain http(s) URL.' },
      },
    },
    async run(args) {
      if (typeof args.chat === 'string' && typeof args.msgId === 'number') {
        const detail = await session.messageOf(args.chat, args.msgId)
        const record = detail.record
        const links = record.links ?? []
        return {
          ok: true,
          chat: detail.resolved.record?.title ?? args.chat,
          msgId: args.msgId,
          text: record.text ?? '',
          links,
          permalink: detail.resolved.record?.username
            ? `https://t.me/${detail.resolved.record.username}/${args.msgId}`
            : null,
        }
      }
      if (typeof args.url === 'string' && args.url !== '') {
        const resolved = await session.readLink(args.url)
        if (args.fetch === true && resolved.kind === 'url') {
          const service = web()
          if (service === undefined || service === null) throw new Error('web 服务不可用，无法抓取链接内容')
          const fetched = await service.fetch({ url: resolved.url })
          const text = typeof fetched?.text === 'string'
            ? fetched.text
            : typeof fetched?.content === 'string'
              ? fetched.content
              : typeof fetched?.body === 'string'
                ? fetched.body
                : JSON.stringify(fetched).slice(0, 20000)
          return {
            ok: true,
            kind: 'url',
            url: resolved.url,
            statusCode: fetched?.statusCode ?? fetched?.status ?? null,
            truncated: fetched?.truncated === true,
            text: String(text).slice(0, 20000),
          }
        }
        return { ok: true, ...resolved }
      }
      throw new Error('需要 chat+msgId 或 url')
    },
  }))

  tools.push(define({
    name: 'tg_send',
    kind: 'other',
    description: 'Send text as your own account. Only whitelisted chats accept it; the dedicated DSH chat is reached through tg_dsh instead. Use replyTo to answer a message id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chat: { type: 'string', description: `Destination chat. ${CHAT_DESCRIPTION}` },
        text: { type: 'string', description: 'Message body; plain text unless parseMode is set.' },
        replyTo: { type: 'integer', description: 'Answer this message id in the target chat.' },
        silent: { type: 'boolean', description: 'No notification sound.' },
        parseMode: { type: 'string', enum: ['html', 'markdown', 'md'] },
        linkPreview: { type: 'boolean', description: 'false = no preview' },
      },
      required: ['chat', 'text'],
    },
    async run(args) {
      return await session.send(args.chat, {
        text: args.text,
        replyTo: args.replyTo,
        silent: args.silent,
        parseMode: args.parseMode,
        linkPreview: args.linkPreview,
        enforceWhitelist: true,
      })
    },
  }))

  tools.push(define({
    name: 'tg_join',
    kind: 'other',
    description: 'Join a channel/group from @username, t.me link, invite link (t.me/+hash) or title fragment; leave=true exits it instead.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        chat: { type: 'string', description: `Target channel/group/invite link. ${CHAT_DESCRIPTION}` },
        leave: { type: 'boolean', description: 'Leave the chat instead of joining it.' },
      },
      required: ['chat'],
    },
    async run(args) {
      return await session.join(args.chat, { leave: args.leave === true })
    },
  }))

  tools.push(define({
    name: 'tg_whitelist',
    kind: 'read',
    description: 'List the send whitelist: the only chats the agent may post into. Read-only here — adding or removing a chat grants or withdraws permission, so only the human does it, in DSH Settings → Telegram.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list'] },
      },
      required: ['action'],
    },
    async run(args) {
      if (args.action !== 'list') return { ok: false, error: '白名单只能由用户在 DSH 设置 → Telegram 中修改。' }
      return { ok: true, whitelist: await session.whitelistEntries(), note: '白名单只能由用户在 DSH 设置 → Telegram 中修改' }
    },
  }))

  tools.push(define({
    name: 'tg_forward',
    kind: 'other',
    description: 'Forward message ids from one chat into another, or into the dedicated DSH chat by default; dropAuthor hides the "forwarded from" header.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: `Source chat. ${CHAT_DESCRIPTION}` },
        ids: { type: 'array', items: { type: 'integer' } },
        to: { type: 'string', description: 'omit = the DSH chat' },
        dropAuthor: { type: 'boolean', description: 'Hide the original author.' },
        silent: { type: 'boolean', description: 'Forward silently.' },
      },
      required: ['from', 'ids'],
    },
    async run(args) {
      return await session.forward(args.from, args.ids, args.to, { dropAuthor: args.dropAuthor === true, silent: args.silent === true })
    },
  }))

  tools.push(define({
    name: 'tg_dsh',
    kind: 'other',
    description: [
      'The dedicated Telegram chat between the user and DSH (a private group holding the user and the DSH bot): ensure creates it, send posts as the bot so the user sees DSH\'s name and avatar, read lists recent messages with fromDsh flags.',
      'When the bridge is on, a message the user writes there arrives as a prompt — answer it with send.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['ensure', 'send', 'read'] },
        text: { type: 'string', description: 'Body for send.' },
        limit: { type: 'integer', description: 'read: messages, 1-100, default 20.' },
        replyTo: { type: 'integer', description: 'action=send: reply to this message id.' },
        silent: { type: 'boolean', description: 'action=send: send without notification.' },
      },
      required: ['action'],
    },
    async run(args) {
      if (args.action === 'ensure') return await session.ensureDsh()
      if (args.action === 'send') {
        if (typeof args.text !== 'string' || args.text.trim() === '') throw new Error('text 不能为空')
        return await session.sendToDsh(args.text, { replyTo: args.replyTo, silent: args.silent })
      }
      if (args.action === 'read') return { ok: true, ...(await session.readDsh({ limit: args.limit ?? 20 })) }
      return { ok: false, error: `unknown action: ${args.action}` }
    },
  }))

  tools.push(define({
    name: 'tg_inbox',
    kind: 'read',
    description: [
      'What arrived while you were not looking: messages in the DSH chat, watched chats, and comments answering posts.',
      'read returns buffered entries newer than the read cursor (markRead advances it); watch/unwatch manage the watched set.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['read', 'watch', 'unwatch'], description: 'default read' },
        chat: { type: 'string', description: `read: filter by chat; watch/unwatch: target chat. ${CHAT_DESCRIPTION}` },
        limit: { type: 'integer', description: 'Entries, 1-200, default 30.' },
        all: { type: 'boolean', description: 'read: include entries already marked read.' },
        markRead: { type: 'boolean', description: 'read: advance the read cursor past the returned entries.' },
      },
    },
    async run(args) {
      const action = args.action ?? 'read'
      if (action === 'watch') return await session.watchChat(args.chat, { remove: false })
      if (action === 'unwatch') return await session.watchChat(args.chat, { remove: true })
      return { ok: true, ...(await session.inbox({ limit: args.limit ?? 30, all: args.all === true, chat: args.chat ?? null, markRead: args.markRead === true })) }
    },
  }))

  return tools
}
