/**
 * Operator script: attach an already-created Telegram bot to the DSH chat.
 *   node scripts/attach-bot.mjs <token>
 * The token is written to the plugin settings (0600) and never printed.
 */
import { SettingsStore } from '../lib/store.js'
import { TelegramSession } from '../lib/session.js'
import { botCall } from '../lib/botapi.js'

const token = typeof process.argv[2] === 'string' ? process.argv[2].trim() : ''
if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(token)) {
  console.error('usage: node scripts/attach-bot.mjs <bot-token>')
  process.exitCode = 2
} else {
  const store = new SettingsStore()
  const session = new TelegramSession(store, { log: (message) => console.log(`[telegram] ${message}`) })
  try {
    const network = await session.clientProxy()
    const me = await botCall(token, 'getMe', {}, { proxy: network.proxy ?? null })
    store.patch({
      bot: {
        id: String(me.id),
        username: me.username ?? null,
        name: me.first_name ?? 'DSH',
        token,
        createdAt: new Date().toISOString(),
      },
    })
    console.log('bot:', JSON.stringify({ id: me.id, username: me.username, name: me.first_name }))
    const client = await session.ensure()
    try {
      await session.ensureBotInDsh(client, me.username)
      console.log('invited: true')
    } catch (error) {
      console.log('invited: false ->', error instanceof Error ? error.message : String(error))
    }
    const sent = await session.sendToDsh('你好，我是 DSH。以后在这个群里，我的消息会用这个机器人的名字和头像出现。')
    console.log('sent:', JSON.stringify(sent))
  } catch (error) {
    console.error('FAILED:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    await session.dispose()
  }
}
