/**
 * Tool-result rendering: the only text the model ever reads.
 *
 * The tool *values* stay rich records (session.js is unchanged), so a compact
 * rendering loses nothing irreversible: anything clipped here has a documented
 * way back (`tg_messages` id=… for one message, a narrower scope for a list).
 * Rules: one line per item, no per-item boilerplate (the chat title is hoisted
 * into the header), no derived fields (links/hashtags/mentions are already in
 * the text), and every omission is marked with its size.
 */

/** Hard cap for one tool result. Lists stay far below it. */
const CAP = 20000
/** Characters of message text kept per line in a list. */
const CLIP = 160

const SPACE = /\s+/gu

/**
 * Split a budget over the rows instead of fixing a per-row length: a 3-message
 * page can show each message whole (no follow-up call), a 50-message page
 * cannot, and both stay bounded.
 */
function perItem(count, budget, min, max) {
  if (count <= 0) return max
  return Math.max(min, Math.min(max, Math.round(budget / count)))
}

function flatText(value) {
  return typeof value === 'string' ? value.replace(SPACE, ' ').trim() : ''
}

/** Flatten to one line and clip with an explicit `…+N` (chars omitted) mark. */
function clip(value, max) {
  const text = flatText(value)
  if (text.length <= max) return text
  let cut = text.slice(0, max)
  if (/[\uD800-\uDBFF]$/u.test(cut)) cut = cut.slice(0, -1)
  const omitted = text.length - max
  return `${cut}…+${omitted}`
}

/** `10-20 20:53` inside the current UTC year, `2025-10-20 20:53` otherwise. */
function dayTime(iso) {
  if (typeof iso !== 'string' || iso.length < 16) return ''
  const year = iso.slice(0, 4)
  const rest = `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
  return year === String(new Date().getUTCFullYear()) ? rest : `${year}-${rest}`
}

function compactJson(value) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item === null || item === undefined) return undefined
      if (typeof item === 'bigint') return String(item)
      return item
    }) ?? ''
  } catch {
    return String(value)
  }
}

/** `key: value · key: value`, empty/false values dropped, nested kept as JSON. */
function kvText(value, order = null) {
  const source = value !== null && typeof value === 'object' ? value : { value }
  const keys = order === null ? Object.keys(source) : order.filter((key) => key in source)
  const parts = []
  for (const key of keys) {
    if (key === 'ok') continue
    const item = source[key]
    if (item === null || item === undefined || item === '' || item === false) continue
    const rendered = typeof item === 'object' ? compactJson(item) : String(item)
    parts.push(`${key}: ${rendered}`)
  }
  return parts.join(' · ')
}

function chatHead(value) {
  const chat = value?.chat
  const title = typeof chat === 'string' ? flatText(chat) : flatText(chat?.title)
  const peerId = chat !== null && typeof chat === 'object' ? chat.peerId : value?.peerId
  const id = peerId === null || peerId === undefined || peerId === '' ? '' : ` (${peerId})`
  return title === '' ? (peerId ? String(peerId) : '') : `${title}${id}`
}

function flagsOf(record) {
  const out = []
  if (record.fromDsh === true) out.push('[dsh]')
  if (record.media) out.push(`[${record.media}]`)
  if (record.pinned === true) out.push('[pin]')
  if (record.edited) out.push('[edit]')
  if (record.forwarded) out.push(`[fwd:${clip(record.forwarded, 24)}]`)
  if (record.replyTo) out.push(`[r:${record.replyTo}]`)
  if (record.threadId && record.threadId !== record.replyTo) out.push(`[th:${record.threadId}]`)
  if (typeof record.replyCount === 'number' && record.replyCount > 0) out.push(`[c:${record.replyCount}]`)
  return out.join('')
}

/**
 * One message per line: `#id <time> [<chat>] <sender><flags> <text>`.
 * `sender` is `me` for the account's own messages.
 */
function recordLine(record, options = {}) {
  if (record === null || typeof record !== 'object') return String(record)
  const { showChat = false, limit = CLIP } = options
  const bits = [`#${record.id}`]
  const when = dayTime(record.date)
  if (when !== '') bits.push(when)
  if (showChat) {
    const chat = record.chat ?? record.chatId ?? ''
    if (chat !== '') bits.push(String(chat))
  }
  let who = record.fromMe === true ? 'me' : flatText(record.sender)
  if (who === '') who = flatText(record.from)
  if (who === '') who = record.fromId === undefined || record.fromId === null ? '' : String(record.fromId)
  const flags = flagsOf(record)
  const text = clip(record.text, limit)
  if (who === '' && flags === '' && text === '') return bits.join(' ')
  bits.push(`${who}${flags}`)
  if (text !== '') bits.push(text)
  return bits.join(' ')
}

function messageLines(items, options = {}) {
  return items.map((item) => recordLine(item, options))
}

// ------------------------------------------------------------------ messages

function messagesText(value, args = {}) {
  const items = Array.isArray(value.items) ? value.items : []
  const head = [chatHead(value), `${items.length} msgs`]
  if (typeof value.total === 'number') head.push(`total ${value.total}`)
  const ids = items.map((item) => Number(item?.id)).filter((id) => Number.isFinite(id) && id > 0)
  if (ids.length > 0) {
    head.push(args.after ? `newer: after=${Math.max(...ids)}` : `older: before=${Math.min(...ids)}`)
  }
  const lines = [head.filter(Boolean).join(' · ')]
  const showChat = value.chat === undefined || value.chat === null
  const limit = perItem(items.length, 6000, 90, 600)
  lines.push(...messageLines(items, { showChat, limit }))
  if (items.some((item) => flatText(item?.text).length > limit)) {
    lines.push(`text clipped at ${limit} chars · full text: tg_messages {chat, id}`)
  }
  return lines.join('\n')
}

function channelsText(value, args = {}) {
  const items = Array.isArray(value.items) ? value.items : []
  const lines = [`channels for "${args.query ?? ''}" · ${items.length}`]
  for (const item of items) {
    const bits = [`"${flatText(item.title) || item.peerId}"`, String(item.peerId ?? '')]
    if (item.kind) bits.push(item.kind)
    if (item.username) bits.push(`@${item.username}`)
    if (item.members) bits.push(`m:${item.members}`)
    bits.push(item.joined === true ? 'joined' : 'not-joined')
    lines.push(bits.join(' '))
  }
  return lines.join('\n')
}

function dialogsText(value) {
  const items = Array.isArray(value.items) ? value.items : []
  const lines = [`${value.total ?? items.length} chats · showing ${items.length}`]
  const lastLimit = perItem(items.length, 2400, 50, 160)
  for (const item of items) {
    const bits = [`"${flatText(item.title) || item.peerId}"`, String(item.peerId ?? '')]
    if (item.kind) bits.push(item.kind)
    if (item.handle) bits.push(item.handle)
    if (item.unread) bits.push(`u:${item.unread}`)
    if (item.members) bits.push(`m:${item.members}`)
    if (item.pinned) bits.push('[pin]')
    if (item.archived) bits.push('[arch]')
    if (item.left) bits.push('[left]')
    if (item.restricted) bits.push('[restricted]')
    if (item.canSend === false) bits.push('[nosend]')
    const when = dayTime(item.lastDate)
    if (when !== '') bits.push(when)
    const last = clip(item.last, lastLimit)
    if (last !== '') bits.push(last)
    lines.push(bits.filter(Boolean).join(' '))
  }
  return lines.join('\n')
}

function commentsText(value) {
  if (!Array.isArray(value.items)) return kvText(value)
  const items = value.items
  const discussion = value.discussion ?? null
  const head = [chatHead(value), `post #${value.msgId}`, `${items.length} comments`]
  if (discussion?.title) head.push(`thread ${discussion.title} (${discussion.peerId}) root #${discussion.rootId}`)
  const lines = [head.filter(Boolean).join(' · ')]
  lines.push(...messageLines(items, { limit: perItem(items.length, 8000, 120, 800) }))
  if (value.note) lines.push(`note: ${value.note}`)
  return lines.join('\n')
}

function inboxText(value) {
  const items = Array.isArray(value.items) ? value.items : []
  const lines = [`inbox · ${items.length} entries · pending ${value.pending ?? 0}`]
  const limit = perItem(items.length, 6000, 100, 600)
  for (const item of items) {
    // `isDsh` marks the chat, not the author, so the sender stays `item.from`.
    lines.push(recordLine({ ...item, sender: item.from }, { showChat: true, limit }))
  }
  return lines.join('\n')
}

// ------------------------------------------------------------------- buttons

function kindTag(kind) {
  return kind === undefined || kind === null || kind === 'callback' ? '' : `(${kind})`
}

function buttonsText(value) {
  if (!Array.isArray(value.rows) || value.rows.length === 0) return kvText(value, ['chat', 'msgId', 'note'])
  const head = [`#${value.msgId}`, chatHead(value), value.markup ?? '', `${value.count} buttons`]
  const lines = [head.filter(Boolean).join(' · ')]
  value.rows.forEach((row, index) => {
    const cells = row.map((cell) => `${cell.index}:${cell.text}${kindTag(cell.kind)}`)
    lines.push(`r${index + 1} ${cells.join('  ')}`)
  })
  if (value.text) lines.push(`message: ${clip(value.text, 200)}`)
  return lines.join('\n')
}

function pressText(value) {
  const lines = [`pressed ${value.pressed?.index}:${value.pressed?.text ?? ''} · via ${value.via ?? '?'} · #${value.msgId}`]
  if (value.answer) lines.push(`answer: ${clip(value.answer, 400)}`)
  if (value.alert === true) lines.push('alert: true')
  if (value.url) lines.push(`url: ${value.url}`)
  if (value.note) lines.push(`note: ${value.note}`)
  if (value.updated) lines.push(`updated ${recordLine(value.updated, { limit: 400 })}`)
  if (Array.isArray(value.latest) && value.latest.length > 0) {
    lines.push(`latest (${value.latest.length})`)
    lines.push(...messageLines(value.latest, { limit: 400 }))
  }
  return lines.join('\n')
}

// -------------------------------------------------------------------- links

function linksText(value) {
  const links = Array.isArray(value.links) ? value.links : []
  const head = [`#${value.msgId}`, chatHead(value), `${links.length} links`]
  const lines = [head.filter(Boolean).join(' · ')]
  lines.push(...links.map((link) => String(link)))
  if (value.permalink) lines.push(`permalink: ${value.permalink}`)
  if (value.text) lines.push(`text: ${clip(value.text, 400)}`)
  return lines.join('\n')
}

function linkText(value) {
  if (value.kind === 'url') return `url ${value.url}`
  const head = [value.kind ?? 'link', value.chat ?? '', value.peerId ? `(${value.peerId})` : '']
  if (value.msgId) head.push(`#${value.msgId}`)
  if (value.accessible === true) head.push('accessible')
  const lines = [head.filter(Boolean).join(' ')]
  if (value.message) lines.push(recordLine(value.message, { limit: 600 }))
  if (value.note) lines.push(`note: ${value.note}`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ writing

function sendText(value) {
  let head = `sent #${value.id}`
  if (value.chat) head += ` → ${value.chat}`
  if (value.peerId) head += ` (${value.peerId})`
  if (value.via) head += ` · via ${value.via}`
  const lines = [head]
  if (value.note) lines.push(`note: ${value.note}`)
  return lines.join('\n')
}

function forwardText(value) {
  const count = Array.isArray(value.forwarded) ? value.forwarded.length : 0
  const ids = Array.isArray(value.newIds) && value.newIds.length > 0
    ? ` · new ${value.newIds.map((id) => `#${id}`).join(' ')}`
    : ''
  return `forwarded ${count} from ${value.from ?? '?'} → ${value.to ?? '?'}${ids}`
}

function joinText(value) {
  if (value.left) return `left ${value.left}`
  return `joined ${value.joined ?? '?'}${value.peerId ? ` (${value.peerId})` : ''}`
}

function whitelistText(value) {
  const entries = Array.isArray(value.whitelist) ? value.whitelist : []
  const lines = [`whitelist · ${entries.length} entries`]
  entries.forEach((entry, index) => {
    const bits = [`${index + 1}.`]
    if (entry.title) bits.push(`"${flatText(entry.title)}"`)
    if (entry.peerId) bits.push(String(entry.peerId))
    if (entry.handle) bits.push(entry.handle)
    lines.push(bits.join(' '))
  })
  if (value.note) lines.push(`note: ${value.note}`)
  return lines.join('\n')
}

function dshText(value) {
  if (!Array.isArray(value.items)) return kvText(value, ['chat', 'peerId', 'created', 'note'])
  const lines = [`${chatHead(value)} · ${value.items.length} msgs`]
  lines.push(...messageLines(value.items, { limit: 300 }))
  return lines.join('\n')
}

function fetchedText(value) {
  const head = [`fetched ${value.url}`, value.statusCode ? String(value.statusCode) : '', value.truncated ? '[truncated]' : '']
  return [head.filter(Boolean).join(' · '), value.text ?? ''].join('\n')
}

// ------------------------------------------------------------------ dispatch

function dispatch(name, args, value) {
  const action = typeof args?.action === 'string' ? args.action : ''
  switch (name) {
    case 'tg_messages': {
      if (typeof args?.id === 'number') {
        const record = value?.message
        if (record === null || record === undefined) return kvText(value)
        return [chatHead(value), recordLine(record, { limit: 4000 })].filter(Boolean).join('\n')
      }
      return messagesText(value, args)
    }
    case 'tg_dialogs':
      return dialogsText(value)
    case 'tg_search':
      return value?.scope === 'channels' ? channelsText(value, args) : messagesText(value, args)
    case 'tg_comments':
      return commentsText(value)
    case 'tg_inbox':
      return action === 'read' || action === '' ? inboxText(value) : kvText(value)
    case 'tg_buttons':
      return action === 'press' ? pressText(value) : buttonsText(value)
    case 'tg_links':
      if (value?.kind === 'url' && typeof value.text === 'string') return fetchedText(value)
      if (value?.links !== undefined) return linksText(value)
      return linkText(value)
    case 'tg_send':
      return sendText(value)
    case 'tg_forward':
      return forwardText(value)
    case 'tg_join':
      return joinText(value)
    case 'tg_whitelist':
      return whitelistText(value)
    case 'tg_dsh':
      return action === 'read' ? dshText(value) : kvText(value, ['chat', 'peerId', 'created', 'note'])
    default:
      return kvText(value)
  }
}

/**
 * Render one tool result for the model. `args` is the call's own input, which
 * is what lets a rendering stay short (an `after` page hints forward, not back).
 */
export function renderResult(name, args, value) {
  let text
  try {
    if (value !== null && typeof value === 'object' && value.ok === false) {
      text = `error: ${flatText(value.error ?? value.note) || 'failed'}`
    } else {
      text = dispatch(name, args ?? {}, value)
    }
  } catch (error) {
    text = `render failed: ${error instanceof Error ? error.message : String(error)}\n${compactJson(value)}`
  }
  if (typeof text !== 'string') text = String(text)
  if (text.length > CAP) return `${text.slice(0, CAP)}\n…(result clipped at ${CAP} chars — narrow it with limit / before / a specific id)`
  return text
}
