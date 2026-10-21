import net from 'node:net'
import { execFile } from 'node:child_process'

/**
 * Proxy resolution for the MTProto client.
 *
 * The plugin never guesses a SOCKS server blindly: an automatic candidate is
 * used only after a real SOCKS5 greeting succeeds, so a machine without a
 * working proxy still connects directly.
 */

export function parseProxyString(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let text = value.trim()
  if (text === 'auto' || text === 'off' || text === 'direct') return null
  text = text.replace(/^socks5?h?:\/\//iu, '').replace(/^https?:\/\//iu, '')
  const [hostPort] = text.split('/')
  const index = hostPort.lastIndexOf(':')
  if (index <= 0) return null
  const ip = hostPort.slice(0, index).replace(/^\[|\]$/gu, '')
  const port = Number(hostPort.slice(index + 1))
  if (ip === '' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { ip, port, socksType: 5 }
}

export function describeProxy(proxy) {
  if (!proxy) return '直连'
  return `SOCKS5 ${proxy.ip}:${proxy.port}`
}

function probeSocks5(proxy, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.connect(proxy.port, proxy.ip)
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.on('connect', () => {
      try {
        socket.write(Buffer.from([5, 1, 0]))
      } catch {
        finish(false)
      }
    })
    socket.on('data', (buffer) => finish(buffer.length >= 2 && buffer[0] === 5 && buffer[1] === 0))
    socket.on('error', () => finish(false))
    socket.on('close', () => finish(false))
  })
}

function regQuery(valueName) {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', valueName],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => resolve(error ? '' : String(stdout)),
    )
  })
}

/** Reads the WinINET proxy this machine already uses (Edge, Telegram Desktop, ...). */
export async function readSystemProxy() {
  if (process.platform !== 'win32') return null
  const enabled = await regQuery('ProxyEnable')
  if (!/ProxyEnable\s+REG_DWORD\s+0x1/iu.test(enabled)) return null
  const server = await regQuery('ProxyServer')
  const match = server.match(/ProxyServer\s+REG_SZ\s+(.+)$/imu)
  if (!match) return null
  const raw = match[1].trim()
  const first = raw.includes('=')
    ? raw.split(';').map((part) => part.split('=')[1]).find((part) => typeof part === 'string' && part !== '')
    : raw
  return parseProxyString(first ?? '')
}

/**
 * Returns { proxy, source } where proxy is null for a direct connection.
 * Order: explicit "off" > explicit custom > TG_PROXY/ALL_PROXY/HTTPS_PROXY > system proxy.
 */
export async function resolveProxy(settings) {
  const mode = settings?.proxyMode ?? 'auto'
  if (mode === 'off') return { proxy: null, source: 'off' }
  const custom = settings?.proxy
  if (mode === 'custom' && custom && custom.ip && custom.port) {
    return { proxy: { ip: custom.ip, port: custom.port, socksType: custom.socksType ?? 5 }, source: 'custom' }
  }
  const envValue = process.env.TG_PROXY || process.env.ALL_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (envValue) {
    const parsed = parseProxyString(envValue)
    if (parsed) {
      if (await probeSocks5(parsed)) return { proxy: parsed, source: 'env' }
    }
  }
  const system = await readSystemProxy()
  if (system) {
    const ok = await probeSocks5(system)
    if (ok) return { proxy: system, source: 'system' }
  }
  return { proxy: null, source: 'direct' }
}
