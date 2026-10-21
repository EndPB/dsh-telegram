/**
 * Pure formatting helpers: turn GramJS TL objects into small JSON records that
 * are cheap for a model to read and stable across TL schema changes.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/giu

export function extractText(msg) {
  const text = typeof msg.message === 'string' ? msg.message : ''
  return text
}

export function extractLinks(msg) {
  const text = extractText(msg)
  const links = new Set()
  for (const match of text.matchAll(URL_RE)) links.add(trimTrailing(match[0]))
  const entities = Array.isArray(msg.entities) ? msg.entities : []
  for (const entity of entities) {
    if (entity?.className === 'MessageEntityTextUrl' && typeof entity.url === 'string') links.add(entity.url)
    if (entity?.className === 'MessageEntityUrl' && typeof entity.offset === 'number') {
      const raw = text.slice(entity.offset, entity.offset + entity.length)
      if (raw.startsWith('http')) links.add(trimTrailing(raw))
    }
    if (entity?.className === 'MessageEntityMention' && typeof entity.offset === 'number') {
      links.add(`https://t.me/${text.slice(entity.offset + 1, entity.offset + entity.length)}`)
    }
  }
  return [...links]
}

function trimTrailing(url) {
  return url.replace(/[),.;!?]+$/u, '')
}

export function mediaKind(msg) {
  const media = msg?.media
  if (!media) return null
  const kind = typeof media.className === 'string' ? media.className : ''
  switch (kind) {
    case 'MessageMediaPhoto':
      return 'photo'
    case 'MessageMediaDocument': {
      const doc = media.document
      const attrs = Array.isArray(doc?.attributes) ? doc.attributes : []
      if (attrs.some((a) => a.className === 'DocumentAttributeSticker')) return 'sticker'
      if (attrs.some((a) => a.className === 'DocumentAttributeAudio' && a.voice === true)) return 'voice'
      if (attrs.some((a) => a.className === 'DocumentAttributeAudio')) return 'audio'
      if (attrs.some((a) => a.className === 'DocumentAttributeVideo')) return 'video'
      return 'document'
    }
    case 'MessageMediaWebPage':
      return 'webpage'
    case 'MessageMediaPoll':
      return 'poll'
    case 'MessageMediaGeo':
    case 'MessageMediaGeoLive':
      return 'location'
    case 'MessageMediaContact':
      return 'contact'
    case 'MessageMediaVenue':
      return 'venue'
    case 'MessageMediaDice':
      return 'dice'
    case 'MessageMediaGame':
      return 'game'
    case 'MessageMediaInvoice':
      return 'invoice'
    case 'MessageMediaUnsupported':
      return 'unsupported'
    default:
      return 'media'
  }
}

function peerOf(obj) {
  // Accept Api.PeerUser / PeerChat / PeerChannel or a raw GramJS entity.
  if (!obj) return null
  if (obj.className === 'PeerUser') return { kind: 'user', id: obj.userId }
  if (obj.className === 'PeerChat') return { kind: 'chat', id: obj.chatId }
  if (obj.className === 'PeerChannel') return { kind: 'channel', id: obj.channelId }
  if (typeof obj.userId !== 'undefined') return { kind: 'user', id: obj.userId }
  if (typeof obj.chatId !== 'undefined') return { kind: 'chat', id: obj.chatId }
  if (typeof obj.channelId !== 'undefined') return { kind: 'channel', id: obj.channelId }
  return null
}

export function messageRecord(msg, options = {}) {
  const { meId = null, chat = null, includeLinks = true } = options
  const record = {
    id: msg.id,
    date: new Date(Number(msg.date) * 1000).toISOString(),
    text: extractText(msg),
    out: msg.out === true,
  }
  const media = mediaKind(msg)
  if (media !== null) record.media = media

  const from = peerOf(msg.fromId)
  if (from !== null) {
    record.fromId = String(from.id)
    record.fromMe = meId !== null && String(meId) === String(from.id)
  }
  const senderName = senderLabel(msg)
  if (senderName !== '') record.sender = senderName

  const reply = msg.replyTo
  if (reply) {
    const replyTo = reply.replyToMsgId ?? reply.replyToTopId
    if (typeof replyTo === 'number' || typeof replyTo === 'bigint') record.replyTo = Number(replyTo)
    if (reply.replyToTopId && reply.replyToTopId !== reply.replyToMsgId) record.threadId = Number(reply.replyToTopId)
  }
  if (msg.threadId !== undefined && record.threadId === undefined) record.threadId = Number(msg.threadId)

  const replies = msg.replies
  if (replies && typeof replies.replies === 'number') record.replyCount = replies.replies
  if (typeof msg.views === 'number') record.views = msg.views
  if (typeof msg.forwards === 'number') record.forwards = msg.forwards
  if (msg.post === true) record.channelPost = true
  if (msg.pinned === true) record.pinned = true
  if (msg.editDate) record.edited = new Date(Number(msg.editDate) * 1000).toISOString()

  const forward = msg.fwdFrom
  if (forward) {
    const from = peerOf(forward.fromId)
    record.forwarded = forward.fromName ?? (from !== null ? String(from.id) : 'hidden')
  }

  if (chat !== null) {
    record.chatId = String(chat.peerId)
    record.chat = chat.title
  }
  if (includeLinks) {
    const links = extractLinks(msg)
    if (links.length > 0) record.links = links
    const text = extractText(msg)
    const tags = new Set()
    for (const match of text.matchAll(/#([\p{L}\p{N}_]{1,64})/gu)) tags.add(match[1])
    if (tags.size > 0) record.hashtags = [...tags]
    const mentions = new Set()
    for (const match of text.matchAll(/@([A-Za-z][A-Za-z0-9_]{3,31})/gu)) mentions.add(match[1])
    if (mentions.size > 0) record.mentions = [...mentions]
  }
  return record
}

export function senderLabel(msg) {
  const sender = msg.sender
  if (sender && typeof sender === 'object') {
    const title = typeof sender.title === 'string' ? sender.title : ''
    if (title !== '') return title
    const parts = [sender.firstName, sender.lastName].filter((v) => typeof v === 'string' && v !== '')
    if (parts.length > 0) return parts.join(' ')
    if (typeof sender.username === 'string' && sender.username !== '') return `@${sender.username}`
  }
  if (typeof msg.postAuthor === 'string' && msg.postAuthor !== '') return msg.postAuthor
  return ''
}

export function chatRecord(dialog, entity) {
  const target = entity ?? dialog?.entity ?? null
  const className = typeof target?.className === 'string' ? target.className : ''
  const kind = className === 'User'
    ? 'user'
    : className === 'Chat'
      ? 'group'
      : target?.megagroup === true
        ? 'group'
        : target?.broadcast === true
          ? 'channel'
          : 'chat'
  const record = {
    id: String(dialog?.id ?? target?.id ?? ''),
    peerId: String(dialog?.id ?? ''),
    kind,
    title: dialog?.title ?? dialog?.name ?? target?.title ?? '',
  }
  const username = target?.username ?? null
  if (typeof username === 'string' && username !== '') {
    record.username = username
    record.handle = `@${username}`
  } else if (typeof target?.usernames === 'object' && target.usernames !== null) {
    const active = (target.usernames.usernames ?? []).find((u) => u.active === true)
    if (active) {
      record.username = active.username
      record.handle = `@${active.username}`
    }
  }
  if (dialog?.isChannel === true) record.channel = true
  if (dialog?.isGroup === true) record.group = true
  if (dialog?.isUser === true) record.user = true
  if (typeof dialog?.unreadCount === 'number' && dialog.unreadCount > 0) record.unread = dialog.unreadCount
  if (typeof target?.participantsCount === 'number') record.members = target.participantsCount
  if (dialog?.archived === true) record.archived = true
  if (dialog?.pinned === true) record.pinned = true
  if (typeof dialog?.message?.message === 'string' && dialog.message.message !== '') {
    const last = dialog.message.message.replace(/\s+/gu, ' ').slice(0, 120)
    if (last !== '') record.last = last
  }
  if (dialog?.message?.date) record.lastDate = new Date(Number(dialog.message.date) * 1000).toISOString()
  const canSend = target !== null && typeof target === 'object'
    ? target.creator === true
      || target.adminRights !== undefined
      || target.left !== true
      || kind === 'user'
    : false
  if (target?.left === true) record.left = true
  record.canSend = canSend && target?.left !== true
  if (Array.isArray(target?.restrictionReason) && target.restrictionReason.length > 0) record.restricted = true
  return record
}

export function jsonText(value, max = 16000) {
  const text = JSON.stringify(value, null, 1)
  if (Array.isArray(value) || text.length <= max) return text
  return text
}

export function truncate(text, max) {
  if (typeof text !== 'string' || text.length <= max) return text
  return `${text.slice(0, max)}…`
}
