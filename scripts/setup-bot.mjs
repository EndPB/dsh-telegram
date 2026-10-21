/**
 * One-off operator script: create the DSH bot through @BotFather, put it in
 * the dedicated chat, and prove a bot-identity message arrives.
 *
 * Run it while the plugin row is disabled, so only one MTProto client uses the
 * stored StringSession:
 *   node scripts/setup-bot.mjs
 */
import { SettingsStore } from '../lib/store.js'
import { TelegramSession } from '../lib/session.js'

const store = new SettingsStore()
const session = new TelegramSession(store, { log: (message) => console.log(`[telegram] ${message}`) })

try {
  const status = await session.status()
  console.log('status:', JSON.stringify({ configured: status.configured, authorized: status.authorized, me: status.me, note: status.note }))
  if (!status.authorized) throw new Error('not authorized; sign in from Settings first')

  const dsh = await session.ensureDsh()
  console.log('dsh chat:', JSON.stringify(dsh))

  const bot = await session.ensureBot()
  console.log('bot:', JSON.stringify(bot))

  const sent = await session.sendToDsh('你好，我是 DSH。以后在这个群里，我的消息会以这个机器人的名字和头像出现。')
  console.log('sent:', JSON.stringify(sent))
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await session.dispose()
}
