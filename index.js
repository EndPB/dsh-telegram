import { SettingsStore } from './lib/store.js'
import { TelegramSession } from './lib/session.js'
import { createTools } from './lib/tools.js'

export const name = 'dsh-telegram'
export const inject = ['tools']

const RPC_CHANNEL = '/dsh-telegram'

function ok(value) {
  return { ok: true, value }
}

function fail(error) {
  return {
    ok: false,
    error: {
      code: 'telegram/failed',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

/** Exported so scripts/measure-tokens.mjs can weigh the section exactly. */
export function promptText(session) {
  const settings = session.settings()
  const me = settings.me
  const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : []
  const pending = session.pendingInboxCount()
  const bot = session.publicBot()
  const bridge = settings.bridge ?? { enabled: false }
  // Kept to state and conventions only: what a tool does is in the tool
  // description, so repeating it here would cost every turn twice.
  const lines = [
    '## Telegram (user account over MTProto)',
    'You act through the user\'s own Telegram account with the `tg_*` tools, so you see exactly what the account sees.',
  ]
  if (!settings.apiId) {
    lines.push('Status: NOT CONFIGURED — no api_id/api_hash yet, so no Telegram call can run. The human creates an application at https://my.telegram.org/apps and enters it in DSH Settings → Telegram.')
  } else if (!settings.session) {
    lines.push('Status: NOT LOGGED IN. The human signs in from DSH Settings → Telegram (phone code + optional two-step password).')
  } else if (me !== null && me !== undefined) {
    const who = me.username ? `@${me.username}` : [me.firstName, me.lastName].filter(Boolean).join(' ') || String(me.id)
    lines.push(`Signed in as ${who} (id ${me.id}).`)
  } else {
    lines.push('A session is stored; `tg_login` action=status reports whether a call needs a fresh login.')
  }
  if (me !== null && me !== undefined && settings.session) {
    lines.push('Order of work: `tg_dialogs` to find a chat, `tg_messages` to page or full-text search it (it prints the `before` id of the next page), `tg_search` scope=channels to find a public channel, `tg_join` to join it, `tg_buttons` for keyboard results in search groups, `tg_comments` for a post\'s thread, `tg_links` for URLs, `tg_forward` to push messages into the DSH chat.')
    if (settings.dshChat) {
      lines.push(`The human reads you in Telegram in "${settings.dshChat.title}" (${settings.dshChat.peerId}): post with \`tg_dsh\` action=send (it goes out as ${bot ? `the bot ${bot.handle ?? bot.name}` : 'your account'}, with DSH's name and avatar), and read back with \`tg_inbox\`.`)
      if (bridge.enabled === true) {
        lines.push('The bridge is ON: a message the human writes there arrives as a prompt — answer it by posting back with `tg_dsh` action=send.')
      }
    } else {
      lines.push('No dedicated DSH chat exists yet; `tg_dsh` action=ensure creates one.')
    }
    lines.push(whitelist.length > 0
      ? `Send whitelist (the only postable chats, human-managed in DSH Settings → Telegram): ${whitelist.map((entry) => entry.handle ?? entry.title ?? entry.peerId).join(', ')}.`
      : 'Send whitelist is EMPTY, so every send is refused; ask the human to add the destination in DSH Settings → Telegram.')
    if (pending > 0) lines.push(`Inbox: ${pending} unread — call \`tg_inbox\` before answering about replies.`)
  }
  lines.push('Never post what the human did not ask for, and never move one chat\'s content into another. Never reveal the api_hash, session string or bot token.')
  return lines.join('\n')
}

function sessionLabel(item) {
  const cwd = typeof item.cwd === 'string' && item.cwd !== '' ? item.cwd : ''
  const tail = cwd.split(/[\\/]/u).filter(Boolean).pop() ?? ''
  const when = typeof item.updatedAt === 'number' ? new Date(item.updatedAt).toISOString() : ''
  return `${tail || 'Session'} · ${String(item.sessionId).slice(0, 8)}${when ? ` · ${when.slice(0, 16).replace('T', ' ')}` : ''}`
}

/**
 * Telegram → DSH bridge.
 *
 * A human message in the dedicated chat is admitted as a prompt into one DSH
 * Session (pinned in Settings, otherwise the most recently active root
 * Session). The model answers with `tg_dsh` action=send, which posts through
 * the bot so the human sees DSH's own avatar.
 */
function createBridge(ctx, session, store, log) {
  let timer = null
  let pending = []
  let flushing = false

  const pickSession = async (sessions, pinned) => {
    let items = []
    try {
      const controller = new AbortController()
      const value = await sessions.list({}, controller.signal)
      items = Array.isArray(value?.items) ? value.items : []
    } catch (error) {
      log(`dsh-telegram: could not list sessions: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
    const usable = items.filter((item) => item && item.origin !== 'subagent' && item.formatStatus !== 'migration-required')
    if (usable.length === 0) return null
    if (typeof pinned === 'string' && pinned !== '') {
      const hit = usable.find((item) => String(item.sessionId) === pinned)
      if (hit !== undefined) return hit.sessionId
    }
    const preferred = usable.find((item) => item.blank !== true) ?? usable[0]
    return preferred.sessionId
  }

  const flush = async () => {
    timer = null
    if (flushing) return
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const settings = store.get()
    const bridge = settings.bridge ?? {}
    if (bridge.enabled !== true) return
    const remember = (patch) => {
      const current = store.get().bridge ?? {}
      try {
        store.patch({ bridge: { ...current, ...patch } })
      } catch {
        /* diagnostic only */
      }
    }
    const sessions = ctx.get('sessionController')
    if (sessions === undefined) {
      remember({ last: { at: new Date().toISOString(), ok: false, error: 'sessionController unavailable' } })
      return
    }
    flushing = true
    try {
      const target = await pickSession(sessions, bridge.sessionId)
      if (target === null) {
        remember({ last: { at: new Date().toISOString(), ok: false, error: 'no DSH Session to bridge into' } })
        return
      }
      const body = batch.map((entry) => {
        const media = entry.media ? `\n[${entry.media}]` : ''
        return `${entry.text}${media}`.trim()
      }).filter((text) => text !== '').join('\n\n')
      if (body === '') return
      const text = [
        '消息来自 Telegram 的 DSH 专用群：',
        body,
        '',
        '请直接回复这条消息：调用 tg_dsh action=send 把回答发到 Telegram（像即时聊天一样简短自然，不要描述这次转发）。',
      ].join('\n')
      const controller = new AbortController()
      await sessions.prompt({
        requestId: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: target,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: 'Asia/Shanghai',
      }, controller.signal)
      remember({ last: { at: new Date().toISOString(), ok: true, sessionId: String(target), count: batch.length } })
      log(`dsh-telegram: bridged ${batch.length} Telegram message(s) into ${String(target).slice(0, 8)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      remember({ last: { at: new Date().toISOString(), ok: false, error: message } })
      log(`dsh-telegram: bridge failed: ${message}`)
    } finally {
      flushing = false
    }
  }

  return {
    receive(entry) {
      if (!entry || typeof entry.text !== 'string') return
      if (entry.text === '' && entry.media === undefined) return
      pending.push(entry)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, 1500)
      if (typeof timer.unref === 'function') timer.unref()
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = []
    },
  }
}

export function apply(ctx, config = {}) {
  const store = new SettingsStore()
  const log = (message) => {
    if (typeof console !== 'undefined' && typeof console.log === 'function') console.log(message)
  }
  const session = new TelegramSession(store, { log })
  const web = () => ctx.get('web')
  const bridge = createBridge(ctx, session, store, log)
  session.onDshMessage = (entry) => bridge.receive(entry)

  // Tools ---------------------------------------------------------------
  for (const tool of createTools({ session, web })) {
    ctx.effect(() => ctx.tools.register(tool), `dsh-telegram: ${tool.name}`)
  }

  // Prompt context ------------------------------------------------------
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined && systemPrompt !== null) {
    ctx.effect(
      () => systemPrompt.section({
        name: 'telegram',
        order: 770,
        text: () => promptText(session),
      }),
      'dsh-telegram: telegram prompt section',
    )
  }

  // Settings page RPC ---------------------------------------------------
  ctx.inject(['connection', 'webServer'], (connectionCtx) => {
    const ownerCtx = typeof connectionCtx.extend === 'function'
      ? connectionCtx.extend({ webServer: connectionCtx.get('webServer') })
      : connectionCtx
    connectionCtx.effect(
      () => ownerCtx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
        const input = payload !== null && typeof payload === 'object' ? payload : {}
        try {
          switch (endpoint) {
            case 'status':
              return ok({ ...(await session.status()), settingsFile: store.file })
            case 'loginStart':
              return ok(await session.loginStart({ apiId: input.apiId, apiHash: input.apiHash, phone: input.phone }))
            case 'loginCode':
              return ok(await session.loginCode(input.code))
            case 'loginPassword':
              return ok(await session.loginPassword(input.password))
            case 'logout':
              return ok(await session.logout())
            case 'setProxy':
              return ok(await session.setProxy(input.value))
            case 'whitelistAdd':
              return ok(await session.whitelist('add', Array.isArray(input.entries) ? input.entries : []))
            case 'whitelistRemove':
              return ok(await session.whitelist('remove', Array.isArray(input.entries) ? input.entries : []))
            case 'dshEnsure':
              return ok(await session.ensureDsh())
            case 'botEnsure':
              return ok(await session.ensureBot())
            case 'setBridge': {
              const enabled = input.enabled === true
              const sessionId = typeof input.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : null
              store.patch({ bridge: { enabled, sessionId } })
              return ok({ enabled, sessionId })
            }
            case 'sessions': {
              const sessions = ctx.get('sessionController')
              if (sessions === undefined) return ok({ items: [] })
              const controller = new AbortController()
              const value = await sessions.list({}, controller.signal)
              const items = (Array.isArray(value?.items) ? value.items : [])
                .filter((item) => item && item.origin !== 'subagent')
                .slice(0, 30)
                .map((item) => ({
                  id: String(item.sessionId),
                  label: sessionLabel(item),
                  running: item.running === true,
                  blank: item.blank === true,
                  updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
                }))
              return ok({ items })
            }
            default:
              throw new Error(`unknown endpoint ${JSON.stringify(endpoint)}`)
          }
        } catch (error) {
          return fail(error)
        }
      }),
      'dsh-telegram: settings rpc channel',
    )
  })

  // Lifecycle -----------------------------------------------------------
  ctx.effect(() => {
    if (session.configured) {
      void session.ensure().catch((error) => {
        log(`dsh-telegram: background connect failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return () => {
      bridge.dispose()
      void session.dispose()
    }
  }, 'dsh-telegram: lifecycle')
}
