import { Api, TelegramClient, utils, password as gramPassword } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage } from 'telegram/events/index.js'
import { chatRecord, messageRecord, mediaKind, senderLabel } from './format.js'
import { botCall, splitMessage } from './botapi.js'
import { describeProxy, parseProxyString, resolveProxy } from './proxy.js'

const CLIENT_OPTIONS = {
  connectionRetries: 5,
  autoReconnect: true,
  retryDelay: 1500,
  requestRetries: 3,
  timeout: 25,
  deviceModel: 'DSH Harness',
  systemVersion: process.platform,
  appVersion: '0.1.0',
  langCode: 'en',
  systemLangCode: 'en',
  useWSS: false,
}

const INBOX_LIMIT = 400
const DIALOG_CACHE_MS = 60_000
const DSH_CHAT_TITLE = 'DSH · DeepSeek Harness'

let randomCounter = 0
function nextRandomId() {
  randomCounter = (randomCounter + 1) % 1_000_000
  return `${Date.now()}${String(randomCounter).padStart(6, '0')}`
}

function peerIdOf(peer) {
  try {
    const id = utils.getPeerId(peer)
    return typeof id === 'string' ? id : id === null || id === undefined ? null : String(id)
  } catch {
    return null
  }
}

function errorMessage(error) {
  if (error === null || error === undefined) return 'unknown error'
  const name = typeof error?.constructor?.name === 'string' ? error.constructor.name : ''
  const rpc = typeof error?.errorMessage === 'string' ? error.errorMessage : ''
  if (name === 'FloodWaitError' || /FLOOD_WAIT|FLOOD_PREMIUM_WAIT/u.test(rpc)) {
    return `Telegram flood wait: retry after ${error?.seconds ?? '?'}s`
  }
  if (name === 'SessionPasswordNeededError' || rpc === 'SESSION_PASSWORD_NEEDED') {
    return 'SESSION_PASSWORD_NEEDED'
  }
  if (name === 'PhoneCodeInvalidError' || rpc === 'PHONE_CODE_INVALID') return 'The login code is invalid'
  if (name === 'PhoneCodeExpiredError' || rpc === 'PHONE_CODE_EXPIRED') return 'The login code expired; start the login again'
  if (name === 'PasswordHashInvalidError' || rpc === 'PASSWORD_HASH_INVALID') return 'The two-step verification password is wrong'
  if (rpc !== '') return rpc
  if (typeof error?.message === 'string' && error.message !== '') return error.message
  return String(error)
}

function mediaFilter(kind) {
  switch (kind) {
    case 'photos': return new Api.InputMessagesFilterPhotos()
    case 'videos': return new Api.InputMessagesFilterVideo()
    case 'documents': return new Api.InputMessagesFilterDocument()
    case 'urls': return new Api.InputMessagesFilterUrl()
    case 'music': return new Api.InputMessagesFilterMusic()
    case 'voice': return new Api.InputMessagesFilterVoice()
    case 'round': return new Api.InputMessagesFilterRoundVideo()
    case 'gifs': return new Api.InputMessagesFilterGif()
    case 'pinned': return new Api.InputMessagesFilterPinned()
    default: return new Api.InputMessagesFilterEmpty()
  }
}

function buttonKindOf(button) {
  switch (button?.className) {
    case 'KeyboardButtonCallback': return 'callback'
    case 'KeyboardButtonUrl': return 'url'
    case 'KeyboardButtonSwitchInline': return 'switch-inline'
    case 'KeyboardButtonWebView':
    case 'KeyboardButtonSimpleWebView': return 'web-view'
    case 'KeyboardButtonCopy': return 'copy'
    default: return 'text'
  }
}

function buttonLayoutOf(message) {
  const markup = message?.replyMarkup
  const rows = []
  let index = 0
  const kind = markup?.className === 'ReplyInlineMarkup'
    ? 'inline'
    : markup?.className === 'ReplyKeyboardMarkup'
      ? 'reply-keyboard'
      : markup?.className === 'ReplyKeyboardHide'
        ? 'hidden'
        : 'none'
  for (const row of markup?.rows ?? (Array.isArray(markup) ? [] : [])) {
    const cells = []
    for (const button of row?.buttons ?? []) {
      index += 1
      const cell = {
        index,
        text: typeof button?.text === 'string' ? button.text : '',
        kind: buttonKindOf(button),
      }
      if (typeof button?.url === 'string') cell.url = button.url
      if (button?.data !== undefined && button?.data !== null) cell.data = button.data
      cells.push(cell)
    }
    if (cells.length > 0) rows.push(cells)
  }
  /* Bot API style arrays ([[{text, data}]]) appear on some inline keyboards. */
  if (rows.length === 0 && Array.isArray(markup)) {
    for (const row of markup) {
      const cells = []
      for (const button of Array.isArray(row) ? row : []) {
        index += 1
        const cell = { index, text: typeof button?.text === 'string' ? button.text : '', kind: button?.url ? 'url' : button?.data ? 'callback' : 'text' }
        if (typeof button?.url === 'string') cell.url = button.url
        if (button?.data !== undefined && button?.data !== null) cell.data = button.data
        cells.push(cell)
      }
      if (cells.length > 0) rows.push(cells)
    }
  }
  return { kind, rows, count: index }
}

export class TelegramSession {
  constructor(store, options = {}) {
    this.store = store
    this.log = options.log ?? (() => {})
    this.client = null
    this.connecting = null
    this.pendingLogin = null
    this.dialogsCache = null
    this.dialogsAt = 0
    this.dialogsPromise = null
    this.pendingRandomIds = new Set()
    this.saveTimer = null
    this.closed = false
    this.attachedTo = null
    this.proxyCache = null
    /** Set by index.js: called for a human message in the dedicated DSH chat. */
    this.onDshMessage = null
    this.botCreating = null
  }

  async clientProxy(force = false) {
    const now = Date.now()
    if (!force && this.proxyCache !== null && now - this.proxyCache.at < 300_000) return this.proxyCache
    let info = { proxy: null, source: 'direct' }
    try {
      info = await resolveProxy(this.settings())
    } catch {
      info = { proxy: null, source: 'direct' }
    }
    this.proxyCache = { ...info, at: now }
    return this.proxyCache
  }

  async dropClient() {
    if (this.client === null) return
    try {
      await this.client.disconnect()
    } catch {
      /* ignore */
    }
    this.client = null
    this.attachedTo = null
  }

  settings() {
    return this.store.get()
  }

  get configured() {
    const s = this.settings()
    return Boolean(s.apiId && s.apiHash && s.session)
  }

  get connected() {
    return this.client !== null && this.client.connected === true
  }

  scheduleSave() {
    if (this.saveTimer !== null) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.store.save()
      } catch (error) {
        this.log(`dsh-telegram: settings save failed: ${errorMessage(error)}`)
      }
    }, 1200)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  async createClient(apiId, apiHash, sessionString, forceProxy = false) {
    const resolved = await this.clientProxy(forceProxy)
    const client = new TelegramClient(
      new StringSession(sessionString ?? ''),
      Number(apiId),
      String(apiHash),
      resolved.proxy ? { ...CLIENT_OPTIONS, proxy: resolved.proxy } : CLIENT_OPTIONS,
    )
    try {
      client.setLogLevel('error')
    } catch {
      /* older builds */
    }
    this.proxySource = resolved.source
    this.client = client
    return client
  }

  async setProxy(value) {
    const text = String(value ?? '').trim()
    const lower = text.toLowerCase()
    if (lower === 'auto') {
      this.store.patch({ proxyMode: 'auto', proxy: null })
    } else if (lower === 'off' || lower === 'direct' || lower === '') {
      this.store.patch({ proxyMode: 'off', proxy: null })
    } else {
      const parsed = parseProxyString(text)
      if (parsed === null) throw new Error('代理格式应为 host:port，例如 127.0.0.1:7890（或用 auto / off）')
      this.store.patch({ proxyMode: 'custom', proxy: parsed })
    }
    this.proxyCache = null
    await this.dropClient()
    return { ok: true, ...(await this.proxyInfo()) }
  }

  async proxyInfo() {
    const settings = this.settings()
    const resolved = await this.clientProxy(true)
    return {
      mode: settings.proxyMode ?? 'auto',
      configured: settings.proxy ?? null,
      source: resolved.source,
      proxy: resolved.proxy,
      description: describeProxy(resolved.proxy),
    }
  }

  attach(client) {
    if (this.attachedTo === client) return
    try {
      client.addEventHandler((event) => {
        const message = event?.message
        if (!message) return
        void this.recordIncoming(message).catch(() => {})
      }, new NewMessage({}))
      this.attachedTo = client
    } catch (error) {
      this.log(`dsh-telegram: update handler failed: ${errorMessage(error)}`)
    }
  }

  async ensure() {
    const settings = this.settings()
    if (!settings.apiId || !settings.apiHash) {
      throw new Error('Telegram 应用凭据未配置（api_id / api_hash）。请在 DSH 设置 → Telegram 中填写并登录。')
    }
    if (!settings.session) {
      throw new Error('尚未登录 Telegram。请在 DSH 设置 → Telegram 中完成登录。')
    }
    if (this.client !== null && this.client.connected === true) return this.client
    if (this.connecting !== null) return this.connecting
    this.connecting = (async () => {
      const client = this.client ?? (await this.createClient(settings.apiId, settings.apiHash, settings.session))
      if (!client.connected) {
        try {
          await client.connect()
        } catch (error) {
          this.proxyCache = null
          const hint = this.proxySource === 'direct'
            ? '当前是直连；这台机器可能连不上 Telegram 数据中心。'
            : `当前代理来源：${this.proxySource}。`
          throw new Error(`连接 Telegram 失败：${errorMessage(error)}。${hint} 请在 DSH 设置 → Telegram 里设置代理（例如 127.0.0.1:7890）后重试。`)
        }
      }
      const authorized = await client.isUserAuthorized()
      if (!authorized) {
        throw new Error('Telegram 会话已失效，请在 DSH 设置 → Telegram 中重新登录。')
      }
      this.attach(client)
      return client
    })()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  // ------------------------------------------------------------------ login

  async loginStart({ apiId, apiHash, phone }) {
    const current = this.settings()
    const id = Number(apiId ?? current.apiId)
    const hash = String(apiHash ?? current.apiHash ?? '').trim()
    const normalized = String(phone ?? current.phone ?? '').replace(/[\s-]/gu, '')
    if (!Number.isFinite(id) || id <= 0) throw new Error('apiId 必填，且必须是 my.telegram.org 给出的整数')
    if (hash === '') throw new Error('apiHash 必填（https://my.telegram.org/apps）')
    if (normalized === '') throw new Error('phone 必填，国际格式，例如 +8613800000000')

    // Replace any previous client so a half-finished attempt cannot leak.
    await this.dropClient()
    this.store.patch({ apiId: id, apiHash: hash, phone: normalized, session: '' })

    const client = await this.createClient(id, hash, '', true)
    try {
      await client.connect()
    } catch (error) {
      throw new Error(`连接 Telegram 失败：${errorMessage(error)}。请在 DSH 设置 → Telegram 里设置代理（例如 127.0.0.1:7890）后重试。`)
    }
    const sent = await client.invoke(new Api.auth.SendCode({
      phoneNumber: normalized,
      apiId: id,
      apiHash: hash,
      settings: new Api.CodeSettings({}),
    }))
    if (sent?.className === 'auth.SentCodeSuccess' || sent?.className === 'auth.SentCodePaymentRequired') {
      throw new Error(`Telegram 没有接受 SendCode（${sent.className}）`)
    }
    this.pendingLogin = { apiId: id, apiHash: hash, phone: normalized, phoneCodeHash: sent.phoneCodeHash, client }
    return {
      ok: true,
      step: 'code',
      phone: normalized,
      phoneCodeHash: sent.phoneCodeHash,
      codeType: sent.type?.className ?? 'unknown',
      note: '验证码已发送到你的 Telegram 客户端（或短信）。把验证码交给 tg_login action=code。',
    }
  }

  async loginCode(code) {
    const pending = this.pendingLogin
    if (pending === null) throw new Error('没有进行中的登录，先调用 tg_login action=start')
    if (!code) throw new Error('code 必填')
    const client = pending.client
    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: String(code).replace(/\s/gu, ''),
      }))
    } catch (error) {
      const message = errorMessage(error)
      if (message === 'SESSION_PASSWORD_NEEDED' || /two-step|password/iu.test(message)) {
        return { ok: true, step: 'password', note: '该账号启用了两步验证，请把密码交给 tg_login action=password。' }
      }
      throw new Error(message)
    }
    return this.finishLogin(client)
  }

  async loginPassword(password) {
    const pending = this.pendingLogin
    if (pending === null) throw new Error('没有进行中的登录，先调用 tg_login action=start')
    if (!password) throw new Error('password 必填')
    const client = pending.client
    try {
      const pwd = await client.invoke(new Api.account.GetPassword())
      const check = await gramPassword.computeCheck(pwd, String(password))
      await client.invoke(new Api.auth.CheckPassword({ password: check }))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
    return this.finishLogin(client)
  }

  async finishLogin(client) {
    const session = client.session.save()
    if (!session) throw new Error('登录成功但会话字符串为空，请重试')
    this.store.patch({ session, apiId: this.settings().apiId, apiHash: this.settings().apiHash })
    this.pendingLogin = null
    this.attach(client)
    const me = await this.readMe(client)
    this.store.patch({ me })
    this.dialogsCache = null
    return { ok: true, step: 'done', me, note: '已登录；下一步可用 tg_dsh action=ensure 建立专用私聊。' }
  }

  async readMe(client = this.client) {
    if (client === null) return null
    const user = await client.getMe()
    if (!user) return null
    return {
      id: String(user.id),
      username: user.username ?? null,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      phone: user.phone ?? null,
    }
  }

  async status() {
    const settings = this.settings()
    const me = settings.me
    let authorized = false
    let note = ''
    let resolvedNetwork = { source: null, proxy: null }
    try {
      resolvedNetwork = await this.clientProxy()
    } catch {
      /* keep the unknown shape */
    }
    if (settings.session && settings.apiId) {
      try {
        const client = await this.ensure()
        authorized = await client.isUserAuthorized()
        if (authorized) {
          const fresh = await this.readMe(client)
          if (fresh !== null && JSON.stringify(fresh) !== JSON.stringify(me)) this.store.patch({ me: fresh })
        }
      } catch (error) {
        note = errorMessage(error)
      }
    } else if (!settings.apiId) {
      note = '缺少 api_id / api_hash'
    } else {
      note = '会话为空，需要登录'
    }
    return {
      configured: Boolean(settings.apiId && settings.apiHash),
      authorized,
      me: this.settings().me,
      phone: settings.phone,
      pendingStep: this.pendingLogin && this.client !== null ? 'code-or-password' : null,
      dshChat: settings.dshChat,
      bot: this.publicBot(),
      bridge: settings.bridge ?? { enabled: false, sessionId: null },
      whitelist: settings.whitelist,
      watch: settings.watch,
      inboxPending: this.pendingInboxCount(),
      network: {
        mode: settings.proxyMode ?? 'auto',
        source: resolvedNetwork.source,
        proxy: resolvedNetwork.proxy ?? null,
        description: describeProxy(resolvedNetwork.proxy ?? null),
      },
      note,
    }
  }

  async logout() {
    if (this.client !== null) {
      try {
        if (await this.client.isUserAuthorized()) await this.client.invoke(new Api.auth.LogOut())
      } catch {
        /* the local session is dropped either way */
      }
      try {
        await this.client.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.client = null
    this.pendingLogin = null
    this.dialogsCache = null
    this.store.patch({ session: '', me: null, dshChat: null, outbox: [], inbox: [], readSeq: 0 })
    return { ok: true, note: '已退出登录，本地会话已清除。' }
  }

  // ---------------------------------------------------------------- dialogs

  async loadDialogs({ refresh = false } = {}) {
    const client = await this.ensure()
    const fresh = Date.now() - this.dialogsAt < DIALOG_CACHE_MS
    if (!refresh && fresh && this.dialogsCache !== null) return this.dialogsCache
    if (this.dialogsPromise !== null) return this.dialogsPromise
    this.dialogsPromise = (async () => {
      const dialogs = await client.getDialogs({ limit: 500 })
      const map = new Map()
      const list = []
      for (const dialog of dialogs) {
        const entity = dialog.entity ?? null
        const peerId = dialog.id !== undefined && dialog.id !== null
          ? String(dialog.id)
          : peerIdOf(entity !== null ? entity : null)
        if (peerId === null) continue
        const record = chatRecord(dialog, entity)
        map.set(peerId, { dialog, entity, record })
        list.push(record)
      }
      this.dialogsCache = { list, map, at: Date.now() }
      this.dialogsAt = Date.now()
      return this.dialogsCache
    })()
    try {
      return await this.dialogsPromise
    } finally {
      this.dialogsPromise = null
    }
  }

  async resolve(query, { refresh = false } = {}) {
    const client = await this.ensure()
    const text = String(query ?? '').trim()
    if (text === '') throw new Error('chat 不能为空：用 @username、t.me 链接、数字 id 或标题片段')
    if (text === 'me' || text === 'self' || text === 'saved') return client.getInputEntity('me')

    const cache = await this.loadDialogs({ refresh })
    const lower = text.toLowerCase().replace(/^@/u, '')

    const byCache = (predicate) => {
      for (const [peerId, entry] of cache.map) {
        if (predicate(entry.record, peerId)) return { peerId, entity: entry.entity, record: entry.record }
      }
      return null
    }
    const hit = async (match) => ({
      input: await client.getInputEntity(match.entity ?? match.peerId),
      entity: match.entity ?? null,
      record: match.record,
    })

    const exact = byCache((record, peerId) =>
      String(peerId) === text
      || (record.username ?? '').toLowerCase() === lower
      || (record.title ?? '').toLowerCase() === lower)
    if (exact !== null) return hit(exact)

    if (/^-?\d+$/u.test(text) && text !== '0') {
      try {
        const entity = await client.getEntity(text)
        if (entity) {
          const peerId = peerIdOf(entity.peerId ?? entity)
          if (peerId !== null) {
            return hit({
              peerId,
              entity,
              record: cache.map.get(peerId)?.record ?? { peerId, title: senderLabel({ sender: entity }) },
            })
          }
        }
      } catch {
        /* fall through to the name search */
      }
    }

    const username = text
      .replace(/^https?:\/\/(?:www\.)?t(?:elegram)?\.(?:me|dog)\//iu, '')
      .replace(/^t\.me\//iu, '')
      .replace(/^@/u, '')
      .split(/[/?#]/u)[0]
      .trim()
    if (username !== '' && !username.startsWith('+')) {
      try {
        const entity = await client.getEntity(username)
        if (entity) {
          const peerId = peerIdOf(entity.peerId ?? entity)
          return hit({
            peerId: peerId ?? username,
            entity,
            record: peerId === null ? { title: username } : (cache.map.get(peerId)?.record ?? { peerId, title: username }),
          })
        }
      } catch {
        /* fall through */
      }
    }

    const notFound = new Error(`在会话列表里找不到 "${text}"；先 tg_join 加入，或改用精确的 @username`)
    notFound.code = 'CHAT_NOT_FOUND'
    throw notFound
  }

  async listDialogs({ kind = 'all', query = '', limit = 50, archived = 'exclude' } = {}) {
    const cache = await this.loadDialogs()
    let records = cache.list
    if (archived === 'only') {
      const client = await this.ensure()
      const archivedDialogs = await client.getDialogs({ limit: 200, folder: 1 })
      records = archivedDialogs.map((dialog) => chatRecord(dialog, dialog.entity ?? null))
    }
    const needle = String(query ?? '').trim().toLowerCase().replace(/^@/u, '')
    if (needle !== '') {
      records = records.filter((record) =>
        (record.title ?? '').toLowerCase().includes(needle)
        || (record.username ?? '').toLowerCase().includes(needle)
        || String(record.peerId).includes(needle))
    }
    if (kind !== 'all') {
      const accept = kind === 'channels'
        ? (r) => r.kind === 'channel'
        : kind === 'groups'
          ? (r) => r.kind === 'group'
          : kind === 'users'
            ? (r) => r.kind === 'user'
            : () => true
      records = records.filter(accept)
    }
    const total = records.length
    return { total, items: records.slice(0, Math.min(limit, 200)) }
  }

  async input(query, options) {
    const resolved = await this.resolve(query, options)
    return resolved
  }

  // --------------------------------------------------------------- messages

  async history(query, options = {}) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const limit = Math.max(1, Math.min(Number(options.limit ?? 30), 200))
    const params = { limit }
    if (options.before) params.maxId = Number(options.before)
    if (options.after) params.minId = Number(options.after)
    if (options.search) params.search = String(options.search)
    if (options.from) {
      const fromEntity = await this.resolve(options.from)
      params.fromUser = fromEntity.entity ?? fromEntity.input
    }
    if (options.filter) params.filter = mediaFilter(String(options.filter))
    if (options.after) params.reverse = true
    const messages = await client.getMessages(resolved.input, params)
    const meId = this.settings().me?.id ?? null
    const chat = { peerId: resolved.record?.peerId ?? String(query), title: resolved.record?.title ?? '' }
    const items = messages
      .filter((message) => message && typeof message === 'object' && message.className !== 'MessageService')
      .map((message) => messageRecord(message, { meId, chat }))
    if (options.after) items.reverse()
    return { chat, count: items.length, items }
  }

  async searchGlobal(options = {}) {
    const client = await this.ensure()
    const limit = Math.max(1, Math.min(Number(options.limit ?? 30), 100))
    const flags = {}
    if (options.channelsOnly) flags.broadcastsOnly = true
    if (options.groupsOnly) flags.groupsOnly = true
    if (options.usersOnly) flags.usersOnly = true
    const minDate = options.minDate ? Math.floor(new Date(options.minDate).getTime() / 1000) : 0
    const maxDate = options.maxDate ? Math.floor(new Date(options.maxDate).getTime() / 1000) : 0
    const result = await client.invoke(new Api.messages.SearchGlobal({
      q: String(options.query ?? ''),
      filter: mediaFilter(String(options.filter ?? '')),
      minDate: Number.isFinite(minDate) ? minDate : 0,
      maxDate: Number.isFinite(maxDate) ? maxDate : 0,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit,
      ...flags,
    }))
    return this.messagesResult(result, options)
  }

  async searchInChat(query, options = {}) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const limit = Math.max(1, Math.min(Number(options.limit ?? 30), 200))
    const messages = await client.getMessages(resolved.input, {
      limit,
      search: String(options.text ?? ''),
      filter: mediaFilter(String(options.filter ?? '')),
      ...(options.from ? { fromUser: (await this.resolve(options.from)).entity } : {}),
      ...(options.before ? { maxId: Number(options.before) } : {}),
    })
    const meId = this.settings().me?.id ?? null
    const chat = { peerId: resolved.record?.peerId ?? String(query), title: resolved.record?.title ?? '' }
    return {
      chat,
      count: messages.length,
      items: messages
        .filter((message) => message?.className !== 'MessageService')
        .map((message) => messageRecord(message, { meId, chat })),
    }
  }

  messagesResult(result, options = {}) {
    const chats = Array.isArray(result.chats) ? result.chats : []
    const users = Array.isArray(result.users) ? result.users : []
    const byId = new Map()
    for (const chat of chats) {
      const peerId = peerIdOf(chat.peerId ?? chat)
      if (peerId !== null) byId.set(peerId, chat.title ?? chat.username ?? peerId)
    }
    for (const user of users) {
      const peerId = peerIdOf(new Api.PeerUser({ userId: user.id }))
      if (peerId !== null) byId.set(peerId, [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || peerId)
    }
    const meId = this.settings().me?.id ?? null
    const items = []
    for (const message of Array.isArray(result.messages) ? result.messages : []) {
      if (!message || typeof message !== 'object') continue
      if (message.className === 'MessageEmpty' || message.className === 'MessageService') continue
      const peerId = peerIdOf(message.peerId)
      const title = peerId === null ? '' : byId.get(peerId) ?? ''
      items.push(messageRecord(message, {
        meId,
        chat: { peerId: peerId ?? '', title },
        includeLinks: options.includeLinks !== false,
      }))
    }
    return { count: items.length, items, total: result.count ?? undefined }
  }

  async searchChannels(query, { limit = 20, global = true } = {}) {
    const client = await this.ensure()
    const text = String(query ?? '').trim()
    if (text === '') throw new Error('query 不能为空')
    const out = new Map()
    try {
      const found = await client.invoke(new Api.contacts.Search({ q: text, limit: Math.min(limit, 50) }))
      for (const chat of found.chats ?? []) {
        if (chat.className !== 'Channel') continue
        const peerId = peerIdOf(chat.peerId ?? chat)
        if (peerId === null) continue
        out.set(peerId, {
          peerId,
          title: chat.title,
          username: chat.username ?? null,
          kind: chat.megagroup === true ? 'group' : 'channel',
          members: chat.participantsCount,
          joined: chat.left !== true,
        })
      }
    } catch {
      /* contacts.Search needs the account to have a few contacts; global search still runs */
    }
    if (global) {
      try {
        const result = await client.invoke(new Api.messages.SearchGlobal({
          q: text,
          filter: new Api.InputMessagesFilterEmpty(),
          minDate: 0,
          maxDate: 0,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit: 50,
          broadcastsOnly: true,
        }))
        for (const chat of result.chats ?? []) {
          if (chat.className !== 'Channel') continue
          const peerId = peerIdOf(chat.peerId ?? chat)
          if (peerId === null || out.has(peerId)) continue
          out.set(peerId, {
            peerId,
            title: chat.title,
            username: chat.username ?? null,
            kind: chat.megagroup === true ? 'group' : 'channel',
            members: chat.participantsCount,
            joined: chat.left !== true,
          })
        }
      } catch {
        /* ignore: global search can be restricted */
      }
    }
    return [...out.values()].slice(0, limit)
  }

  async messageOf(query, msgId) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const messages = await client.getMessages(resolved.input, { ids: [Number(msgId)] })
    const message = messages?.[0]
    if (!message || message.className === 'MessageEmpty') throw new Error(`找不到消息 ${msgId}`)
    const meId = this.settings().me?.id ?? null
    return {
      resolved,
      message,
      record: messageRecord(message, {
        meId,
        chat: { peerId: resolved.record?.peerId ?? String(query), title: resolved.record?.title ?? '' },
      }),
    }
  }

  // ---------------------------------------------------------------- buttons

  /**
   * Flatten the keyboard of a message into rows of pressable cells.
   * `data` stays on the returned cells so pressButton can invoke the callback;
   * the tool boundary strips it (a Uint8Array is not lossless JSON).
   */
  async buttonMessage(client, resolved, msgId) {
    if (typeof msgId === 'number' && Number.isFinite(msgId)) {
      const messages = await client.getMessages(resolved.input, { ids: [Number(msgId)] })
      const message = messages?.[0]
      return message && message.className === 'Message' ? message : null
    }
    const recent = await client.getMessages(resolved.input, { limit: 20 })
    for (const message of Array.isArray(recent) ? recent : []) {
      if (!message || message.className !== 'Message') continue
      if (buttonLayoutOf(message).count > 0) return message
    }
    return null
  }

  async buttons(query, msgId) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const message = await this.buttonMessage(client, resolved, msgId)
    const chatTitle = resolved.record?.title ?? String(query)
    if (message === null) {
      return { ok: true, chat: chatTitle, msgId: msgId ?? null, count: 0, note: '没有找到带按钮的消息（可以带上具体 msgId）', rows: [] }
    }
    const layout = buttonLayoutOf(message)
    const meId = this.settings().me?.id ?? null
    const record = messageRecord(message, {
      meId,
      chat: { peerId: resolved.record?.peerId ?? String(query), title: chatTitle },
      includeLinks: false,
    })
    return {
      ok: true,
      chat: chatTitle,
      msgId: message.id,
      markup: layout.kind,
      count: layout.count,
      rows: layout.rows.map((row) => row.map((cell) => {
        const out = { index: cell.index, text: cell.text, kind: cell.kind }
        if (cell.url !== undefined) out.url = cell.url
        return out
      })),
      text: (record.text ?? '').slice(0, 500),
    }
  }

  async pressButton(query, msgId, options = {}) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    if (options.enforceWhitelist !== false) await this.assertWhitelisted(resolved, '点击按钮')
    const message = await this.buttonMessage(client, resolved, msgId)
    if (message === null) throw new Error('没有找到带按钮的消息')
    const layout = buttonLayoutOf(message)
    const flat = layout.rows.flat()
    let target = null
    if (typeof options.button === 'number') {
      target = flat.find((cell) => cell.index === options.button) ?? null
    } else if (typeof options.label === 'string' && options.label.trim() !== '') {
      const needle = options.label.trim().toLowerCase()
      target = flat.find((cell) => cell.text.toLowerCase() === needle)
        ?? flat.find((cell) => cell.text.toLowerCase().includes(needle))
        ?? null
    }
    if (target === null) {
      const hint = flat.map((cell) => `${cell.index}=${cell.text}`).join(', ')
      throw new Error(`没找到按钮 ${options.button ?? options.label}；这条消息的按钮是：${hint || '（没有）'}`)
    }
    const chatTitle = resolved.record?.title ?? String(query)
    const pressed = { index: target.index, text: target.text, kind: target.kind }

    if (target.kind === 'url' || target.kind === 'copy') {
      return { ok: true, chat: chatTitle, msgId: message.id, pressed, url: target.url ?? null, note: '这是链接/复制按钮，没有可点的回调' }
    }

    let via = target.kind
    let answer = null
    if (target.kind === 'callback' && target.data !== undefined) {
      try {
        answer = await client.invoke(new Api.messages.GetBotCallbackAnswer({
          peer: resolved.input,
          msgId: message.id,
          data: target.data,
        }))
      } catch (error) {
        if (!/DATA_INVALID|BUTTON_INVALID|QUERY_ID_INVALID|MESSAGE_ID_INVALID/u.test(errorMessage(error))) throw error
        via = 'text-fallback'
        const sent = await client.sendMessage(resolved.input, { message: target.text })
        if (typeof sent?.id === 'number') this.noteOutbound(sent.id)
      }
    } else {
      via = 'text'
      const sent = await client.sendMessage(resolved.input, { message: target.text })
      if (typeof sent?.id === 'number') this.noteOutbound(sent.id)
    }

    const meId = this.settings().me?.id ?? null
    const chat = { peerId: resolved.record?.peerId ?? String(query), title: chatTitle }
    let updated = null
    let latest = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.delay(attempt === 0 ? 800 : 900)
      const [fresh] = await client.getMessages(resolved.input, { ids: [message.id] })
      if (fresh && fresh.className === 'Message') {
        const same = Number(fresh.editDate ?? 0) === Number(message.editDate ?? 0)
        updated = same ? null : messageRecord(fresh, { meId, chat, includeLinks: false })
      }
      const after = await client.getMessages(resolved.input, { limit: 5, minId: message.id })
      latest = (Array.isArray(after) ? after : [])
        .filter((item) => item && item.className === 'Message' && item.id !== message.id)
        .sort((a, b) => a.id - b.id)
        .map((item) => messageRecord(item, { meId, chat }))
      if (updated !== null || latest.length > 0) break
    }
    return {
      ok: true,
      chat: chatTitle,
      msgId: message.id,
      pressed,
      via,
      answer: typeof answer?.message === 'string' && answer.message !== '' ? answer.message : null,
      alert: answer?.alert === true,
      url: typeof answer?.url === 'string' && answer.url !== '' ? answer.url : null,
      updated,
      latest,
    }
  }

  // --------------------------------------------------------------- comments

  async discussionOf(query, msgId) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const result = await client.invoke(new Api.messages.GetDiscussionMessage({
      peer: resolved.input,
      msgId: Number(msgId),
    }))
    const root = (result.messages ?? []).find((message) => message && message.className === 'Message')
    const chat = (result.chats ?? [])[0] ?? null
    return { client, resolved, result, root, chat }
  }

  async comments(query, msgId, options = {}) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    let root = null
    let discussionChat = null
    try {
      const discussion = await this.discussionOf(query, msgId)
      root = discussion.root
      discussionChat = discussion.chat
    } catch (error) {
      return {
        ok: false,
        chat: resolved.record?.title ?? String(query),
        msgId: Number(msgId),
        note: `该消息没有可用的评论区（${errorMessage(error)}）`,
        items: [],
      }
    }
    if (root === null) {
      return { ok: true, chat: resolved.record?.title ?? String(query), msgId: Number(msgId), note: '没有找到讨论区根消息，可能尚未开启评论', items: [] }
    }
    const limit = Math.max(1, Math.min(Number(options.limit ?? 40), 200))
    const result = await client.invoke(new Api.messages.GetReplies({
      peer: resolved.input,
      msgId: Number(msgId),
      offsetId: Number(options.before ?? 0),
      offsetDate: 0,
      addOffset: 0,
      limit,
      maxId: 0,
      minId: 0,
      hash: 0,
    }))
    const meId = this.settings().me?.id ?? null
    const title = discussionChat?.title ?? resolved.record?.title ?? ''
    const chat = { peerId: peerIdOf(discussionChat?.peerId ?? discussionChat) ?? '', title }
    const items = (result.messages ?? [])
      .filter((message) => message?.className === 'Message')
      .map((message) => messageRecord(message, { meId, chat }))
    return {
      ok: true,
      chat: resolved.record?.title ?? String(query),
      discussion: { peerId: chat.peerId, title, rootId: root.id },
      msgId: Number(msgId),
      count: items.length,
      items,
    }
  }

  async replyComment(query, msgId, text, options = {}) {
    const client = await this.ensure()
    const resolved = await this.resolve(query)
    const discussion = await this.discussionOf(query, msgId)
    if (discussion.root === null) throw new Error('该消息没有评论区，无法回复评论')
    const discussionPeer = discussion.chat !== null
      ? await client.getInputEntity(discussion.chat)
      : await client.getInputEntity(discussion.root.peerId)
    const replyTo = Number(options.replyTo ?? discussion.root.id)
    const sent = await client.sendMessage(discussionPeer, {
      message: String(text),
      replyTo,
      ...(options.silent ? { silent: true } : {}),
    })
    if (typeof sent?.id === 'number') this.noteOutbound(sent.id)
    return {
      ok: true,
      chat: resolved.record?.title ?? String(query),
      discussion: discussion.chat?.title ?? '',
      id: sent?.id ?? null,
      replyTo,
    }
  }

  // ------------------------------------------------------------------ send

  async whitelistEntries() {
    const settings = this.settings()
    return Array.isArray(settings.whitelist) ? settings.whitelist : []
  }

  async isWhitelisted(resolved) {
    const entries = await this.whitelistEntries()
    const peerId = resolved.record?.peerId ?? resolved.peerId ?? null
    return entries.some((entry) =>
      (peerId !== null && String(entry.peerId) === String(peerId))
      || String(entry.peerId) === String(resolved.record?.peerId ?? '')
      || (entry.handle && resolved.record?.username && entry.handle.toLowerCase() === `@${String(resolved.record.username).toLowerCase()}`))
  }

  async assertWhitelisted(resolved, action = '发送消息') {
    const entries = await this.whitelistEntries()
    if (entries.length === 0) {
      throw new Error(`${action}被拒绝：白名单为空。请让用户在 DSH 设置 → Telegram 里把目标加入白名单。`)
    }
    if (!(await this.isWhitelisted(resolved))) {
      const names = entries.map((entry) => entry.handle ?? entry.title ?? entry.peerId).join(', ')
      throw new Error(`${action}被拒绝："${resolved.record?.title ?? resolved.record?.peerId ?? '该会话'}" 不在白名单内。已允许：${names}`)
    }
  }

  async send(query, options = {}) {
    const client = await this.ensure()
    if (typeof options.text !== 'string' || options.text.trim() === '') throw new Error('text 不能为空')
    if (options.enforceWhitelist !== false) {
      const resolved = await this.resolve(query)
      await this.assertWhitelisted(resolved, '发送消息')
      const sent = await client.sendMessage(resolved.input, {
        message: options.text,
        ...(options.replyTo ? { replyTo: Number(options.replyTo) } : {}),
        ...(options.silent ? { silent: true } : {}),
        ...(options.parseMode ? { parseMode: options.parseMode } : {}),
        ...(options.linkPreview === false ? { linkPreview: false } : {}),
      })
      if (typeof sent?.id === 'number') this.noteOutbound(sent.id)
      return {
        ok: true,
        via: 'whitelist',
        chat: resolved.record?.title ?? String(query),
        peerId: resolved.record?.peerId ?? null,
        id: sent?.id ?? null,
      }
    }
    const resolved = await this.resolve(query)
    const sent = await client.sendMessage(resolved.input, {
      message: options.text,
      ...(options.replyTo ? { replyTo: Number(options.replyTo) } : {}),
      ...(options.silent ? { silent: true } : {}),
    })
    if (typeof sent?.id === 'number') this.noteOutbound(sent.id)
    return { ok: true, via: 'direct', chat: resolved.record?.title ?? String(query), id: sent?.id ?? null }
  }

  async forward(fromQuery, ids, toQuery, options = {}) {
    const client = await this.ensure()
    const from = await this.resolve(fromQuery)
    const to = toQuery ? await this.resolve(toQuery) : await this.resolveDsh()
    const list = (Array.isArray(ids) ? ids : [ids]).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    if (list.length === 0) throw new Error('ids 需要至少一个消息 id')
    const result = await client.invoke(new Api.messages.ForwardMessages({
      fromPeer: from.input,
      id: list,
      randomId: list.map(() => nextRandomId()),
      toPeer: to.input,
      ...(options.silent ? { silent: true } : {}),
      ...(options.dropAuthor ? { dropAuthor: true } : {}),
    }))
    const newIds = []
    for (const update of result.updates ?? []) {
      const message = update?.message
      if (message && typeof message.id === 'number') newIds.push(message.id)
    }
    for (const id of newIds) this.noteOutbound(id)
    return { ok: true, from: from.record?.title ?? String(fromQuery), to: to.record?.title ?? String(toQuery), forwarded: list, newIds }
  }

  // ------------------------------------------------------------------ join

  async join(query, { leave = false } = {}) {
    const client = await this.ensure()
    const text = String(query ?? '').trim()
    if (text === '') throw new Error('chat 不能为空')
    const invite = text.match(/(?:t(?:elegram)?\.me|telegram\.dog)\/(?:\+|joinchat\/)([\w-]+)/iu)
    if (invite !== null) {
      if (leave) throw new Error('邀请链接不能用于退出')
      const result = await client.invoke(new Api.messages.ImportChatInvite({ hash: invite[1] }))
      const chat = (result.chats ?? [])[0] ?? null
      this.dialogsCache = null
      return { ok: true, joined: chat?.title ?? invite[1], peerId: chat === null ? null : peerIdOf(chat.peerId ?? chat) }
    }
    const resolved = await this.resolve(text, { refresh: true })
    const channel = resolved.entity
    if (channel === null || channel === undefined) throw new Error('无法解析目标频道实体')
    if (leave) {
      await client.invoke(new Api.channels.LeaveChannel({ channel: resolved.input }))
      this.dialogsCache = null
      return { ok: true, left: resolved.record?.title ?? text }
    }
    try {
      await client.invoke(new Api.channels.JoinChannel({ channel: resolved.input }))
    } catch (error) {
      const message = errorMessage(error)
      if (!/already.*participant|USER_ALREADY_PARTICIPANT/iu.test(message)) throw new Error(message)
    }
    this.dialogsCache = null
    return { ok: true, joined: resolved.record?.title ?? text, peerId: resolved.record?.peerId ?? null }
  }

  // ------------------------------------------------------------- DSH chat

  // ------------------------------------------------------------- DSH bot

  /**
   * The bot that speaks as DSH inside the dedicated chat. The userbot keeps
   * reading everything (bots cannot see group history), while every message
   * the human sees from DSH carries this bot's name and avatar.
   */
  botRecord() {
    const bot = this.settings().bot
    return bot !== null && typeof bot === 'object' && typeof bot.token === 'string' && bot.token !== '' ? bot : null
  }

  publicBot() {
    const bot = this.botRecord()
    if (bot === null) return null
    return {
      id: String(bot.id ?? ''),
      username: bot.username ?? null,
      name: bot.name ?? bot.username ?? 'DSH',
      handle: bot.username ? `@${bot.username}` : null,
    }
  }

  async botApi(method, payload = {}) {
    const bot = this.botRecord()
    if (bot === null) throw new Error('尚未创建 DSH 机器人')
    const network = await this.clientProxy()
    return await botCall(bot.token, method, payload, { proxy: network.proxy ?? null })
  }

  delay(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      if (typeof timer.unref === 'function') timer.unref()
    })
  }

  /** Drive @BotFather over MTProto: /newbot, name, username, token. */
  async createBotViaBotFather(client) {
    const father = await client.getInputEntity('@BotFather')
    const recent = await client.getMessages(father, { limit: 3 })
    let cursor = recent.length > 0 && typeof recent[0].id === 'number' ? Number(recent[0].id) : 0
    const send = async (text) => {
      const sent = await client.sendMessage(father, { message: text })
      if (sent && typeof sent.id === 'number') cursor = Math.max(cursor, Number(sent.id))
    }
    const waitFor = async (matcher, timeoutMs = 25_000) => {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        const messages = await client.getMessages(father, { limit: 8, minId: cursor })
        const fresh = (messages ?? [])
          .filter((message) => message?.className === 'Message' && message.out !== true)
          .sort((a, b) => Number(a.id) - Number(b.id))
        for (const message of fresh) {
          cursor = Math.max(cursor, Number(message.id))
          const text = typeof message.message === 'string' ? message.message : ''
          if (matcher(text)) return { text, message }
        }
        await this.delay(900)
      }
      throw new Error('等待 @BotFather 回复超时；可以稍后重试，或在 Telegram 里手动向 @BotFather 创建机器人')
    }
    await send('/newbot')
    await waitFor((text) => /name for your bot|How are we going to call it/iu.test(text))
    await send('DSH')
    await waitFor((text) => /username for your bot|must end in/iu.test(text))
    const candidates = [
      'dsh_harness_bot', 'dsh_deepseek_bot', 'dsh_assistant_bot', 'dsh_bridge_bot',
      'dsh_tg_bridge_bot', 'ds_harness_bot', 'dsh_harness_777_bot', 'dsh_remote_bot',
      'dsh_chat_bridge_bot', 'dsh_harness_2026_bot',
    ]
    let last = ''
    for (const candidate of candidates) {
      await send(candidate)
      const reply = await waitFor((text) => /Congratulations|token|already taken|invalid|Sorry/iu.test(text))
      last = reply.text
      const token = reply.text.match(/(\d{6,}:[A-Za-z0-9_-]{30,})/u)
      if (token !== null) return { token: token[1], username: candidate }
      if (!/already taken|occupied/iu.test(reply.text)) {
        throw new Error(`@BotFather 拒绝了用户名 ${candidate}：${reply.text.slice(0, 200)}`)
      }
    }
    throw new Error(`@BotFather 拒绝了所有候选用户名（最后一次回复：${last.slice(0, 160)}）`)
  }

  async ensureBotInDsh(client, username) {
    const target = await this.resolveDsh()
    const entity = await client.getEntity(`@${username}`)
    if (!entity) throw new Error(`找不到机器人 @${username}`)
    const inputUser = new Api.InputUser({ userId: entity.id, accessHash: entity.accessHash })
    try {
      await client.invoke(new Api.channels.InviteToChannel({ channel: target.input, users: [inputUser] }))
    } catch (error) {
      const message = errorMessage(error)
      if (!/already.*participant|USER_ALREADY_PARTICIPANT|PARTICIPANT/iu.test(message)) {
        throw new Error(`把机器人加入 DSH 私聊失败：${message}`)
      }
    }
    return true
  }

  /** Create (once) the DSH bot, verify its token, and put it into the group. */
  async ensureBot() {
    const client = await this.ensure()
    if (this.botCreating !== null) return this.botCreating
    this.botCreating = (async () => {
      let bot = this.botRecord()
      let created = false
      if (bot === null) {
        const fresh = await this.createBotViaBotFather(client)
        const me = await botCall(fresh.token, 'getMe', {}, { proxy: (await this.clientProxy()).proxy ?? null })
        bot = {
          id: String(me.id),
          username: me.username ?? fresh.username,
          name: me.first_name ?? 'DSH',
          token: fresh.token,
          createdAt: new Date().toISOString(),
        }
        this.store.patch({ bot })
        created = true
      }
      const me = await this.botApi('getMe', {})
      const patched = {
        ...bot,
        id: String(me.id),
        username: me.username ?? bot.username,
        name: me.first_name ?? bot.name,
      }
      this.store.patch({ bot: patched })
      let inChat = false
      let note = ''
      if (this.settings().dshChat) {
        try {
          await this.ensureBotInDsh(client, patched.username)
          inChat = true
        } catch (error) {
          note = errorMessage(error)
        }
      } else {
        note = 'DSH 私聊尚未创建'
      }
      return { ok: true, created, bot: this.publicBot(), inChat, note }
    })()
    try {
      return await this.botCreating
    } finally {
      this.botCreating = null
    }
  }

  async botSendDsh(text, options = {}) {
    const target = await this.resolveDsh()
    const chatId = target.record?.peerId ?? this.settings().dshChat?.peerId ?? null
    if (chatId === null) throw new Error('找不到 DSH 私聊的 peer id')
    const parts = splitMessage(text)
    const ids = []
    for (const part of parts) {
      const sent = await this.botApi('sendMessage', {
        chat_id: String(chatId),
        text: part,
        ...(options.replyTo ? { reply_to_message_id: Number(options.replyTo), allow_sending_without_reply: true } : {}),
        ...(options.silent ? { disable_notification: true } : {}),
        ...(options.parseMode ? { parse_mode: options.parseMode === 'html' ? 'HTML' : 'Markdown' } : {}),
        ...(options.linkPreview === false ? { link_preview_options: { is_disabled: true } } : {}),
      })
      if (sent && typeof sent.message_id === 'number') {
        ids.push(sent.message_id)
        this.noteOutbound(sent.message_id)
      }
    }
    return { ok: true, via: 'bot', id: ids[0] ?? null, ids, chat: target.record?.title ?? DSH_CHAT_TITLE }
  }

  async resolveDsh() {
    const client = await this.ensure()
    const settings = this.settings()
    if (!settings.dshChat) throw new Error('专用私聊尚未创建：先调用 tg_dsh action=ensure')
    const chat = settings.dshChat
    const cache = await this.loadDialogs().catch(() => null)
    const cached = cache?.map.get(String(chat.peerId))
    if (cached) {
      return {
        input: await client.getInputEntity(cached.entity ?? chat.peerId),
        record: cached.record ?? { peerId: String(chat.peerId), title: chat.title },
        isDsh: true,
      }
    }
    if (chat.channelId && chat.accessHash) {
      const input = new Api.InputPeerChannel({
        channelId: BigInt(chat.channelId),
        accessHash: BigInt(chat.accessHash),
      })
      try {
        const entity = await client.getEntity(input)
        return { input, record: { peerId: String(chat.peerId), title: entity?.title ?? chat.title }, isDsh: true }
      } catch {
        /* fall through */
      }
    }
    throw new Error('找不到 DSH 专用私聊，可能已删除：调用 tg_dsh action=ensure 重建')
  }

  async ensureDsh() {
    const client = await this.ensure()
    const settings = this.settings()
    if (settings.dshChat) {
      try {
        const resolved = await this.resolveDsh()
        return { ok: true, created: false, peerId: String(settings.dshChat.peerId), title: resolved.record?.title ?? settings.dshChat.title }
      } catch {
        /* recreate below */
      }
    }
    const result = await client.invoke(new Api.channels.CreateChannel({
      title: DSH_CHAT_TITLE,
      about: 'DeepSeek Harness 的专用私聊：DSH 在这里推送频道消息，你在这里回复它。',
      megagroup: true,
    }))
    const channel = (result.chats ?? []).find((chat) => chat.className === 'Channel')
    if (!channel) throw new Error('创建私聊失败：Telegram 没有返回频道实体')
    const peerId = peerIdOf(new Api.PeerChannel({ channelId: channel.id })) ?? `-100${channel.id}`
    const record = {
      peerId,
      channelId: String(channel.id),
      accessHash: String(channel.accessHash),
      title: channel.title ?? DSH_CHAT_TITLE,
      createdAt: new Date().toISOString(),
    }
    this.store.patch({ dshChat: record, watch: [...new Set([...(settings.watch ?? []), peerId])] })
    this.dialogsCache = null
    const bot = this.botRecord()
    if (bot !== null && bot.username) {
      try {
        await this.ensureBotInDsh(client, bot.username)
      } catch (error) {
        this.log(`dsh-telegram: adding the bot to the new chat failed: ${errorMessage(error)}`)
      }
    }
    await this.sendToDsh('DSH 专用私聊已建立。频道消息会转发到这里；你在这里回复即可被 DSH 读到。')
    return { ok: true, created: true, peerId, title: record.title }
  }

  async sendToDsh(text, options = {}) {
    if (this.botRecord() !== null) {
      try {
        return await this.botSendDsh(text, options)
      } catch (error) {
        this.log(`dsh-telegram: bot send failed, falling back to the account: ${errorMessage(error)}`)
      }
    }
    const client = await this.ensure()
    const target = await this.resolveDsh()
    const randomId = nextRandomId()
    this.pendingRandomIds.add(randomId)
    try {
      const result = await client.invoke(new Api.messages.SendMessage({
        peer: target.input,
        message: String(text),
        randomId,
        ...(options.replyTo ? { replyTo: new Api.InputReplyToMessage({ replyToMsgId: Number(options.replyTo) }) } : {}),
        ...(options.silent ? { silent: true } : {}),
      }))
      let id = null
      for (const update of result.updates ?? []) {
        if (update.className === 'UpdateMessageID') id = update.id
        else if (update?.message && typeof update.message.id === 'number') id = update.message.id
      }
      if (id !== null) this.noteOutbound(id)
      return { ok: true, via: 'account', id, chat: target.record?.title ?? DSH_CHAT_TITLE, note: '机器人发送失败，已用你的账号发出（没有机器人头像）' }
    } finally {
      // The echo may arrive slightly after the invoke returns; keep the marker briefly.
      setTimeout(() => this.pendingRandomIds.delete(randomId), 30_000).unref?.()
    }
  }

  noteOutbound(id) {
    const settings = this.settings()
    const outbox = Array.isArray(settings.outbox) ? settings.outbox : []
    outbox.push(Number(id))
    settings.outbox = outbox.slice(-200)
    this.scheduleSave()
  }

  async readDsh({ limit = 30 } = {}) {
    const target = await this.resolveDsh()
    const client = await this.ensure()
    const messages = await client.getMessages(target.input, { limit: Math.max(1, Math.min(Number(limit), 100)) })
    const meId = this.settings().me?.id ?? null
    const outbox = new Set((this.settings().outbox ?? []).map((id) => Number(id)))
    const botId = this.settings().bot && this.settings().bot.id ? String(this.settings().bot.id) : null
    const items = []
    for (const message of messages) {
      if (!message || message.className !== 'Message') continue
      const record = messageRecord(message, { meId, chat: { peerId: target.record?.peerId ?? '', title: target.record?.title ?? '' } })
      record.fromDsh = outbox.has(Number(message.id)) || (botId !== null && String(record.fromId ?? '') === botId)
      items.push(record)
    }
    items.sort((a, b) => a.id - b.id)
    return { chat: target.record?.title ?? DSH_CHAT_TITLE, peerId: target.record?.peerId ?? null, count: items.length, items }
  }

  // ----------------------------------------------------------------- inbox

  pendingInboxCount() {
    const settings = this.settings()
    const inbox = Array.isArray(settings.inbox) ? settings.inbox : []
    return inbox.filter((entry) => entry.seq > (settings.readSeq ?? 0)).length
  }

  async recordIncoming(message) {
    if (!message || typeof message !== 'object') return
    if (message.className !== 'Message') return
    const settings = this.settings()
    const peerId = peerIdOf(message.peerId)
    if (peerId === null) return
    const dshPeerId = settings.dshChat ? String(settings.dshChat.peerId) : null
    const isDsh = dshPeerId !== null && peerId === dshPeerId
    const outbox = new Set((settings.outbox ?? []).map((id) => Number(id)))
    const randomId = message.randomId
    const knownOutbound = outbox.has(Number(message.id))
      || (message.out === true && randomId !== undefined && this.pendingRandomIds.has(String(randomId)))
    if (knownOutbound) return
    const botId = settings.bot && settings.bot.id ? String(settings.bot.id) : null
    const senderId = message.senderId ?? message.fromId?.userId ?? null
    const fromBot = botId !== null && senderId !== null && String(senderId) === botId
    if (fromBot) {
      // DSH's own bot echo: remember it so every reader treats it as outbound.
      this.noteOutbound(Number(message.id))
      return
    }
    const watch = Array.isArray(settings.watch) ? settings.watch : []
    const hasReply = message.replyTo !== undefined && message.replyTo !== null
    if (!isDsh && !watch.includes(peerId) && !hasReply) return
    if (message.post === true && !isDsh) return

    let title = settings.dshChat !== null && isDsh ? settings.dshChat.title : ''
    if (title === '') {
      try {
        const cache = this.dialogsCache
        title = cache?.map.get(peerId)?.record?.title ?? ''
        if (title === '' && this.client !== null) {
          const entity = await this.client.getEntity(peerId)
          title = entity?.title ?? [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') ?? ''
        }
      } catch {
        title = ''
      }
    }
    const seq = Math.max(0, ...(settings.inbox ?? []).map((entry) => entry.seq ?? 0)) + 1
    const text = typeof message.message === 'string' ? message.message : ''
    const entry = {
      seq,
      id: Number(message.id),
      peerId,
      chat: title || peerId,
      isDsh,
      date: new Date(Number(message.date) * 1000).toISOString(),
      from: senderLabel(message),
      text: text.slice(0, 4000),
      ...(mediaKind(message) ? { media: mediaKind(message) } : {}),
      ...(hasReply ? { replyTo: Number(message.replyTo.replyToMsgId ?? message.replyTo.replyToTopId ?? 0) } : {}),
    }
    const inbox = [...(settings.inbox ?? []), entry].slice(-INBOX_LIMIT)
    settings.inbox = inbox
    this.scheduleSave()
    if (isDsh && typeof this.onDshMessage === 'function') {
      try {
        this.onDshMessage(entry)
      } catch (error) {
        this.log(`dsh-telegram: DSH chat handler failed: ${errorMessage(error)}`)
      }
    }
  }

  async inbox({ limit = 50, all = false, chat = null, markRead = false } = {}) {
    const settings = this.settings()
    const inbox = Array.isArray(settings.inbox) ? settings.inbox : []
    const readSeq = Number(settings.readSeq ?? 0)
    let entries = all ? inbox : inbox.filter((entry) => (entry.seq ?? 0) > readSeq)
    if (chat !== null && chat !== undefined && String(chat) !== '') {
      const needle = String(chat).toLowerCase()
      entries = entries.filter((entry) =>
        String(entry.peerId).includes(needle)
        || String(entry.chat).toLowerCase().includes(needle))
    }
    const items = entries.slice(-Math.max(1, Math.min(Number(limit), 200)))
    if (markRead && items.length > 0) {
      const highest = Math.max(...items.map((entry) => entry.seq ?? 0))
      this.store.patch({ readSeq: Math.max(readSeq, highest) })
    }
    return { pending: this.pendingInboxCount(), count: items.length, items }
  }

  async watchChat(query, { remove = false } = {}) {
    const resolved = await this.resolve(query)
    const peerId = resolved.record?.peerId ?? null
    if (peerId === null) throw new Error('无法确定该会话的 peerId')
    const settings = this.settings()
    const watch = new Set(settings.watch ?? [])
    if (remove) watch.delete(peerId)
    else watch.add(peerId)
    this.store.patch({ watch: [...watch] })
    return { ok: true, peerId, title: resolved.record?.title ?? '', watching: [...watch] }
  }

  // -------------------------------------------------------------- whitelist

  async whitelist(action, entries = []) {
    const settings = this.settings()
    const list = Array.isArray(settings.whitelist) ? settings.whitelist : []
    if (action === 'list') return { ok: true, whitelist: list }
    if (action === 'add') {
      const added = []
      for (const entry of entries) {
        const resolved = await this.resolve(entry)
        const peerId = resolved.record?.peerId ?? null
        if (peerId === null) continue
        if (list.some((item) => String(item.peerId) === String(peerId))) continue
        added.push({
          peerId,
          title: resolved.record?.title ?? '',
          handle: resolved.record?.username ? `@${resolved.record.username}` : null,
          kind: resolved.record?.kind ?? 'chat',
          addedAt: new Date().toISOString(),
        })
      }
      const next = [...list, ...added]
      const watch = [...new Set([...(settings.watch ?? []), ...added.map((item) => item.peerId)])]
      this.store.patch({ whitelist: next, watch })
      return { ok: true, added, whitelist: next }
    }
    if (action === 'remove') {
      const removeIds = new Set()
      for (const entry of entries) {
        try {
          const resolved = await this.resolve(entry)
          if (resolved.record?.peerId) removeIds.add(String(resolved.record.peerId))
        } catch {
          removeIds.add(String(entry))
        }
      }
      const next = list.filter((item) => !removeIds.has(String(item.peerId)))
      this.store.patch({ whitelist: next })
      return { ok: true, removed: [...removeIds], whitelist: next }
    }
    throw new Error(`未知的 whitelist action: ${action}`)
  }

  // ------------------------------------------------------------------ misc

  async raw(entityQuery) {
    const resolved = await this.resolve(entityQuery)
    return resolved
  }

  async readLink(url) {
    const text = String(url ?? '').trim()
    const messageLink = text.match(/^https?:\/\/(?:t|telegram)\.me\/(?:c\/(\d+)|([\w-]+))\/(\d+)/iu)
    if (messageLink === null) {
      const username = text.replace(/^https?:\/\/(?:t|telegram)\.me\//iu, '').replace(/^@/u, '').split(/[/?#]/u)[0]
      if (username !== '' && /^[\w-]+$/u.test(username)) {
        const resolved = await this.resolve(username)
        return { kind: 'chat', chat: resolved.record?.title ?? username, peerId: resolved.record?.peerId ?? null }
      }
      return { kind: 'url', url: text }
    }
    const [, channelId, username, msgId] = messageLink
    if (channelId !== undefined && channelId !== null) {
      const peerId = `-100${channelId}`
      const cache = await this.loadDialogs().catch(() => null)
      const known = cache?.map.get(peerId)
      if (!known) {
        return { kind: 'message', peerId, msgId: Number(msgId), accessible: false, note: '不在会话列表中，无法直接解析该私有消息链接' }
      }
      try {
        const detail = await this.messageOf(peerId, msgId)
        return { kind: 'message', peerId, msgId: Number(msgId), accessible: true, message: detail.record }
      } catch (error) {
        return { kind: 'message', peerId, msgId: Number(msgId), accessible: false, note: errorMessage(error) }
      }
    }
    try {
      const detail = await this.messageOf(`@${username}`, msgId)
      return {
        kind: 'message',
        peerId: detail.resolved.record?.peerId ?? null,
        chat: detail.resolved.record?.title ?? `@${username}`,
        msgId: Number(msgId),
        accessible: true,
        message: detail.record,
      }
    } catch (error) {
      const reason = errorMessage(error)
      try {
        const resolved = await this.resolve(`@${username}`)
        return {
          kind: 'message',
          peerId: resolved.record?.peerId ?? null,
          chat: resolved.record?.title ?? `@${username}`,
          msgId: Number(msgId),
          accessible: false,
          note: `${reason}（频道可解析，但这台账号看不到该条消息；公开频道的历史通常需要先加入）`,
        }
      } catch {
        return { kind: 'message', msgId: Number(msgId), accessible: false, note: reason }
      }
    }
  }

  async dispose() {
    this.closed = true
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      try {
        this.store.save()
      } catch {
        /* ignore */
      }
    }
    if (this.client !== null) {
      try {
        await this.client.disconnect()
      } catch {
        /* ignore */
      }
      this.client = null
    }
  }
}
