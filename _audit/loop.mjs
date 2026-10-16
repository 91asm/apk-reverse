// Per-assistant-message usage table + repetition analysis of assistant text.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

function partsOf(message) {
  if (message === null || typeof message !== 'object') return []
  if (Array.isArray(message.parts)) return message.parts
  if (Array.isArray(message.content)) return message.content
  return []
}

function textOf(parts) {
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter((t) => t.length > 0)
    .join('\n')
}

const rows = []
for (const { line, rec } of recs) {
  if (rec.type !== 'assistant/message') continue
  const data = rec.data ?? {}
  const message = data.message ?? {}
  const usage = data.usage ?? message.usage ?? null
  const stop = message.source?.replayState?.response?.stopReason ?? data.stopReason ?? null
  const parts = partsOf(message)
  const text = textOf(parts)
  const tools = parts.filter((p) => (p.type ?? '').includes('tool') || p.toolName !== undefined).map((p) => p.toolName ?? p.name ?? p.type)
  rows.push({ line, usage, stop, chars: text.length, text, tools })
}

console.log('== assistant/message usage table ==')
console.log('line | stopReason | in | out | total | cache | chars | tools')
for (const row of rows) {
  const u = row.usage ?? {}
  console.log(
    [
      String(row.line).padStart(4),
      String(row.stop).padEnd(10),
      String(u.inputTokens ?? '-').padStart(7),
      String(u.outputTokens ?? '-').padStart(6),
      String(u.totalTokens ?? '-').padStart(8),
      String(u.cacheReadTokens ?? '-').padStart(7),
      String(row.chars).padStart(7),
      (row.tools ?? []).join('+'),
    ].join(' | '),
  )
}

const outputs = rows.map((r) => r.usage?.outputTokens).filter((v) => typeof v === 'number')
if (outputs.length > 0) {
  console.log(`\noutputTokens: n=${outputs.length} max=${Math.max(...outputs)} sum=${outputs.reduce((a, b) => a + b, 0)}`)
}
const stops = new Map()
for (const r of rows) stops.set(String(r.stop), (stops.get(String(r.stop)) ?? 0) + 1)
console.log('stopReasons:', JSON.stringify([...stops.entries()]))

// Repetition: identical assistant texts, and repeated n-gram sentences across the whole stream.
console.log('\n== identical assistant texts (>=40 chars) ==')
const byText = new Map()
for (const r of rows) {
  const key = r.text.trim()
  if (key.length < 40) continue
  if (!byText.has(key)) byText.set(key, [])
  byText.get(key).push(r.line)
}
let dupGroups = 0
for (const [text, lines] of byText) {
  if (lines.length < 2) continue
  dupGroups += 1
  console.log(`x${lines.length} lines=${lines.join(',')} :: ${text.slice(0, 160).replace(/\s+/g, ' ')}`)
}
if (dupGroups === 0) console.log('(none)')

console.log('\n== sentence-level repetition across all assistant text ==')
const all = rows.map((r) => r.text).join('\n')
const sentences = all
  .split(/[\n。！？!?]+/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 25)
const counts = new Map()
for (const s of sentences) counts.set(s, (counts.get(s) ?? 0) + 1)
const repeated = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
console.log(`sentences=${sentences.length} unique=${counts.size} repeated(>=3)=${repeated.length}`)
for (const [s, n] of repeated.slice(0, 25)) console.log(`x${n} :: ${s.slice(0, 140).replace(/\s+/g, ' ')}`)
