import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EMPTY = () => ({
  /** Telegram application credentials from https://my.telegram.org/apps */
  apiId: null,
  apiHash: null,
  /** GramJS StringSession; the MTProto auth key. Treat as a password. */
  session: '',
  phone: null,
  /** Signed-in account snapshot: { id, username, firstName, lastName, phone } */
  me: null,
  /** Chats the agent may send to. Entries are user-supplied handles resolved lazily. */
  whitelist: [],
  /** Dedicated private chat with DSH: { peerId, id, accessHash, title, createdAt } */
  dshChat: null,
  /** Message ids this plugin has sent in the DSH chat, so echoes are not read back as user input. */
  outbox: [],
  /** Ring buffer of recently received messages (newest last). */
  inbox: [],
  /** Highest inbox seq the agent has consumed. */
  readSeq: 0,
  /** Chats explicitly watched for incoming messages. */
  watch: [],
  /** 'auto' reads the system proxy, 'custom' uses `proxy`, 'off' forces direct. */
  proxyMode: 'auto',
  proxy: null,
  /**
   * The bot that speaks as DSH in the dedicated chat: { id, username, name, token }.
   * Created through @BotFather; the token is a secret and never leaves the Host.
   */
  bot: null,
  /**
   * Telegram → DSH bridge: { enabled, sessionId }.
   * When enabled, a message the human writes in the DSH chat is admitted as a
   * prompt into `sessionId` (or the most recently active Session when null).
   */
  bridge: { enabled: false, sessionId: null },
})

export class SettingsStore {
  constructor() {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.dir = path.join(home, 'dsh-telegram')
    this.file = path.join(this.dir, 'settings.json')
    this.data = null
  }

  ensure() {
    if (this.data === null) {
      this.load()
      return this.data
    }
    // Settings can be edited while the Host is running (the Settings page, the
    // operator scripts, or a plain editor). Re-read when the file changed so a
    // live process never answers from a stale snapshot.
    if (this.stampOf() !== this.stamp) this.load()
    return this.data
  }

  stampOf() {
    try {
      const stat = fs.statSync(this.file)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return 'missing'
    }
  }

  load() {
    const base = EMPTY()
    let raw = ''
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      raw = ''
    }
    if (raw !== '') {
      try {
        const parsed = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') Object.assign(base, parsed)
      } catch {
        /* corrupted settings: keep defaults, the next save rewrites the file */
      }
    }
    if (!Array.isArray(base.whitelist)) base.whitelist = []
    if (!Array.isArray(base.inbox)) base.inbox = []
    if (!Array.isArray(base.outbox)) base.outbox = []
    if (!Array.isArray(base.watch)) base.watch = []
    if (base.bridge === null || typeof base.bridge !== 'object') base.bridge = { enabled: false, sessionId: null }
    if (typeof base.bridge.enabled !== 'boolean') base.bridge.enabled = false
    this.data = base
    this.stamp = this.stampOf()
    return this.data
  }

  save() {
    const data = this.ensure()
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    try {
      fs.chmodSync(this.file, 0o600)
    } catch {
      /* best effort on Windows */
    }
    this.stamp = this.stampOf()
    return data
  }

  patch(next) {
    Object.assign(this.ensure(), next)
    return this.save()
  }

  get() {
    return this.ensure()
  }
}
