import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

/**
 * Minimal Telegram Bot API client.
 *
 * The bot is the DSH side of the dedicated chat: it owns the avatar and the
 * name the human sees, while the MTProto userbot keeps reading everything the
 * account can see. Direct TLS works from this machine; when it does not, the
 * same request is retried through the configured HTTP proxy with CONNECT.
 */

const HOST = 'api.telegram.org'

export class BotApiError extends Error {
  constructor(message, { code = 0, method = '', retryAfter = 0, description = '' } = {}) {
    super(message)
    this.name = 'BotApiError'
    this.code = code
    this.method = method
    this.retryAfter = retryAfter
    this.description = description
  }
}

function requestDirect(path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      port: 443,
      path,
      method: 'POST',
      servername: HOST,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        connection: 'close',
      },
      timeout: timeoutMs,
    })
    req.on('response', (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('Bot API request timed out')))
    req.on('error', reject)
    req.end(body)
  })
}

function proxyConnect(proxy, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.ip, port: proxy.port })
    const fail = (error) => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('proxy connect timed out')))
    socket.on('error', fail)
    socket.once('connect', () => {
      socket.setTimeout(0)
      socket.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nHost: ${HOST}:443\r\n\r\n`)
      let buffered = ''
      const onData = (chunk) => {
        buffered += chunk.toString('latin1')
        const end = buffered.indexOf('\r\n\r\n')
        if (end < 0) return
        socket.removeListener('data', onData)
        const statusLine = buffered.slice(0, buffered.indexOf('\r\n'))
        if (!/^HTTP\/1\.[01] 2\d\d/u.test(statusLine)) {
          fail(new Error(`proxy refused CONNECT: ${statusLine}`))
          return
        }
        const secured = tls.connect({ socket, servername: HOST })
        secured.once('secureConnect', () => resolve(secured))
        secured.once('error', fail)
      }
      socket.on('data', onData)
    })
  })
}

function requestViaProxy(proxy, path, body, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    let socket
    try {
      socket = await proxyConnect(proxy, timeoutMs)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    // The TLS tunnel is already established: a plain HTTP request written over
    // it is exactly what an HTTPS request would put on the wire, and Node's
    // HTTP parser still handles the response (including chunked bodies).
    const agent = new http.Agent({ keepAlive: false, maxSockets: 1 })
    agent.createConnection = () => socket
    const req = http.request({
      host: HOST,
      port: 443,
      path,
      method: 'POST',
      agent,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        connection: 'close',
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('Bot API request through the proxy timed out')))
    req.on('error', (error) => reject(new Error(error?.message || 'Bot API proxy request failed')))
    req.end(body)
  })
}
/**
 * One logical request. Direct TLS is tried first; a failed attempt is retried
 * through the proxy. The last working transport is remembered so a blocked
 * network costs one timeout, not one per message.
 */
let lastTransport = 'direct'

async function callOnce(path, body, timeoutMs, proxy) {
  const order = proxy === null
    ? ['direct']
    : lastTransport === 'proxy' ? ['proxy', 'direct'] : ['direct', 'proxy']
  let lastError = null
  for (const attempt of order) {
    try {
      const raw = attempt === 'proxy'
        ? await requestViaProxy(proxy, path, body, timeoutMs)
        : await requestDirect(path, body, proxy === null ? timeoutMs : Math.min(timeoutMs, 6000))
      if (raw.status === 0) throw new Error('empty response')
      lastTransport = attempt
      return raw
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('Bot API unreachable')
}

/**
 * Call one Bot API method.
 *
 * @param {string} token bot token from BotFather
 * @param {string} method e.g. "sendMessage"
 * @param {object} payload JSON body
 * @param {{ proxy?: {ip:string,port:number}|null, timeoutMs?: number }} options
 */
export async function botCall(token, method, payload = {}, options = {}) {
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/u.test(token)) {
    throw new BotApiError('机器人 token 无效（尚未创建机器人？）', { method })
  }
  const body = JSON.stringify(payload ?? {})
  const timeoutMs = Number(options.timeoutMs ?? 30_000)
  const path = `/bot${token}/${method}`
  let raw
  try {
    raw = await callOnce(path, body, timeoutMs, options.proxy ?? null)
  } catch (error) {
    throw new BotApiError(`无法连接 Bot API：${error instanceof Error ? error.message : String(error)}`, { method })
  }
  let parsed
  try {
    parsed = JSON.parse(raw.text)
  } catch {
    throw new BotApiError(`Bot API 返回了非 JSON 响应（HTTP ${raw.status}）`, { method, code: raw.status })
  }
  if (parsed?.ok !== true) {
    const retryAfter = Number(parsed?.parameters?.retry_after ?? 0)
    const description = typeof parsed?.description === 'string' ? parsed.description : 'unknown error'
    throw new BotApiError(`Bot API ${method} 失败：${description}`, {
      method,
      code: Number(parsed?.error_code ?? raw.status),
      retryAfter,
      description,
    })
  }
  return parsed.result
}

/** Telegram caps one message at 4096 characters; keep paragraphs intact when splitting. */
export function splitMessage(text, limit = 4000) {
  const source = String(text ?? '')
  if (source.length <= limit) return [source]
  const parts = []
  let rest = source
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '))
    const at = cut > limit * 0.5 ? cut : limit
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest !== '') parts.push(rest)
  return parts
}
