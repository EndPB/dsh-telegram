import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'

const HOST = 'api.telegram.org'
const PROXY = { ip: '127.0.0.1', port: 7890 }
const token = process.argv[2]

function proxyConnect(proxy, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.ip, port: proxy.port })
    const fail = (error) => { socket.destroy(); reject(error) }
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
        if (!/^HTTP\/1\.[01] 2\d\d/u.test(statusLine)) { fail(new Error(`proxy refused CONNECT: ${statusLine}`)); return }
        const secured = tls.connect({ socket, servername: HOST })
        secured.once('secureConnect', () => resolve(secured))
        secured.once('error', fail)
      }
      socket.on('data', onData)
    })
  })
}

const socket = await proxyConnect(PROXY)
console.log('tunnel ok')

const agent = new http.Agent({ keepAlive: false, maxSockets: 1 })
agent.createConnection = () => socket

const body = JSON.stringify({})
const result = await new Promise((resolve, reject) => {
  const req = http.request({
    host: HOST, port: 443, path: `/bot${token}/getMe`, method: 'POST', agent,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' },
    timeout: 20000,
  }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', reject)
  req.end(body)
})
console.log('response', result.status, result.text)
