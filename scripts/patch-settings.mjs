/**
 * Operator script: repair/normalize the plugin settings file.
 * Strips a UTF-8 BOM (PowerShell's Set-Content adds one) and sets the bridge flag.
 *   node scripts/patch-settings.mjs on|off
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const file = path.join(process.env.USERPROFILE ?? os.homedir(), '.dsh', 'dsh-telegram', 'settings.json')
const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
const data = JSON.parse(raw)
const enabled = process.argv[2] !== 'off'
data.bridge = {
  enabled,
  sessionId: data.bridge?.sessionId ?? null,
  ...(data.bridge?.last ? { last: data.bridge.last } : {}),
}
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({
  hasApi: Boolean(data.apiId),
  hasSession: Boolean(data.session && data.session !== ''),
  hasBot: Boolean(data.bot && data.bot.token),
  bridge: data.bridge.enabled,
}))
