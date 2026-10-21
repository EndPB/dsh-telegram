/**
 * Operator script: rename the DSH bot to "DSH" through @BotFather.
 *   node scripts/bot-setname.mjs "DSH"
 */
import { Api } from 'telegram'
import { SettingsStore } from '../lib/store.js'
import { TelegramSession } from '../lib/session.js'

const newName = typeof process.argv[2] === 'string' && process.argv[2].trim() !== '' ? process.argv[2].trim() : 'DSH'
const store = new SettingsStore()
const session = new TelegramSession(store, { log: (message) => console.log(`[telegram] ${message}`) })

const client = await session.ensure()
const username = store.get().bot?.username ?? ''
if (username === '') throw new Error('bot username missing: set settings.bot.username (settings page or settings.json)')
const father = await client.getInputEntity('@BotFather')
let cursor = 0
const head = await client.getMessages(father, { limit: 1 })
if (head.length > 0) cursor = Number(head[0].id)

const send = async (text) => {
  const sent = await client.sendMessage(father, { message: text })
  if (sent && typeof sent.id === 'number') cursor = Math.max(cursor, Number(sent.id))
}
const next = async (timeoutMs = 20000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const messages = await client.getMessages(father, { limit: 8, minId: cursor })
    const fresh = (messages ?? []).filter((m) => m?.className === 'Message' && m.out !== true).sort((a, b) => Number(a.id) - Number(b.id))
    for (const message of fresh) {
      cursor = Math.max(cursor, Number(message.id))
      return message
    }
    await session.delay(800)
  }
  throw new Error('no BotFather reply')
}

await send('/setname')
const listing = await next()
const text = typeof listing.message === 'string' ? listing.message : ''
console.log('listing:', text.slice(0, 160).replace(/\n/gu, ' | '))
const rows = listing.replyMarkup?.rows ?? []
const buttons = rows.flatMap((row) => row.buttons ?? [])
console.log('buttons:', JSON.stringify(buttons.map((b) => ({ text: b.text, data: b.data }))))
const target = buttons.find((b) => typeof b.text === 'string' && b.text.toLowerCase().includes(username.toLowerCase()))
if (!target) throw new Error('bot button not found in the BotFather listing')
if (target.data !== undefined && target.data !== null) {
  await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: father, msgId: listing.id, data: target.data }))
} else {
  // BotFather's bot picker is a reply keyboard here: pressing it just sends the label.
  await send(target.text)
}
const prompt = await next()
console.log('prompt:', (typeof prompt.message === 'string' ? prompt.message : '').slice(0, 160).replace(/\n/gu, ' | '))
await send(newName)
const done = await next()
console.log('done:', (typeof done.message === 'string' ? done.message : '').slice(0, 160).replace(/\n/gu, ' | '))
store.patch({ bot: { ...store.get().bot, name: newName } })
await session.dispose()
