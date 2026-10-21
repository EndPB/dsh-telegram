#!/usr/bin/env node
/**
 * Weigh what the plugin costs in a model's context.
 *
 *   node scripts/measure-tokens.mjs [checkout]      # defaults to this checkout
 *
 * Two things are measured:
 *
 *   1. what every single request pays — the tool definitions and the
 *      system-prompt section, weighed from the code that actually ships;
 *   2. what one call pays — the tool results, rendered the old way
 *      (`JSON.stringify(value, null, 1)`, i.e. the pre-0.3 renderer) against
 *      the current renderer, over the payloads in scripts/fixtures/.
 *
 * Tokens are estimated (1 per CJK/emoji char, 1 per 3.5 ASCII chars) because a
 * tokenizer is model-specific; compare the same way before and after.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(here, '..')
const current = path.resolve(here, '..')

function weigh(text) {
  const value = typeof text === 'string' ? text : String(text)
  let ascii = 0
  for (const ch of value) if (ch.codePointAt(0) < 128) ascii += 1
  return { chars: value.length, approxTokens: Math.round(ascii / 3.5) + (value.length - ascii) }
}

function row(label, value) {
  return `${label.padEnd(30)} ${String(value.chars).padStart(6)} chars   ~${String(value.approxTokens).padStart(5)} tok`
}

const settingsFile = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'dsh-telegram', 'settings.json')
const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}
const stub = {
  settings: () => settings,
  pendingInboxCount: () => 3,
  publicBot: () => (settings.bot === null || settings.bot === undefined
    ? null
    : { id: settings.bot.id, username: settings.bot.username, name: settings.bot.name }),
}

const { createTools } = await import(pathToFileURL(path.join(root, 'lib', 'tools.js')).href)
const tools = createTools({ session: stub, web: () => null })

console.log(`checkout: ${root}\n`)
console.log('— every request —')
let toolTotal = 0
for (const tool of tools) {
  const definition = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })
  toolTotal += definition.length
  console.log(row(tool.name, weigh(definition)))
}
console.log(row(`${tools.length} tool definitions`, weigh(' '.repeat(toolTotal))))

const index = await import(pathToFileURL(path.join(root, 'index.js')).href)
const prompt = typeof index.promptText === 'function' ? index.promptText(stub) : ''
console.log(row('system-prompt section', weigh(prompt)))
console.log(row('TOTAL fixed per request', weigh(' '.repeat(toolTotal + prompt.length))))

const fixtureDir = path.join(here, 'fixtures')
const { renderResult } = await import(pathToFileURL(path.join(current, 'lib', 'render.js')).href)
console.log('\n— one call (payloads in scripts/fixtures) —')
let beforeTotal = 0
let afterTotal = 0
for (const file of fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort()) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'))
  const tool = fixture.tool ?? (fixture.name === 'dialogs' ? 'tg_dialogs' : 'tg_messages')
  const before = weigh(JSON.stringify(fixture.value, null, 1))
  const after = weigh(renderResult(tool, fixture.args ?? {}, JSON.parse(JSON.stringify(fixture.value))))
  beforeTotal += before.approxTokens
  afterTotal += after.approxTokens
  const saved = before.approxTokens === 0 ? 0 : Math.round(100 - (after.approxTokens / before.approxTokens) * 100)
  console.log(`${fixture.name.padEnd(30)} ${before.chars} → ${after.chars} chars   ~${before.approxTokens} → ${after.approxTokens} tok   -${saved}%`)
}
const saved = beforeTotal === 0 ? 0 : Math.round(100 - (afterTotal / beforeTotal) * 100)
console.log(`\ncall results: ~${beforeTotal} → ~${afterTotal} tok  (-${saved}%)`)
