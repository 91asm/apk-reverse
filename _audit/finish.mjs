// Every finish chunk in every recorded stream: the authoritative truncation evidence.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const reasons = new Map()
const finishEvents = []

function walk(node, line, path) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, line, `${path}[${index}]`))
    return
  }
  if (node.type === 'finish' && node.reason !== undefined) {
    const key = JSON.stringify(node.reason)
    reasons.set(key, (reasons.get(key) ?? 0) + 1)
    finishEvents.push({ line, path, reason: node.reason })
  }
  for (const [key, value] of Object.entries(node)) walk(value, line, path.length === 0 ? key : `${path}.${key}`)
}

for (const { line, rec } of recs) walk(rec.data, line, rec.type)

console.log('== finish reasons across all recorded streams ==')
for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`x${String(count).padStart(3)} ${reason.slice(0, 300)}`)
}

console.log('\n== non-normal finish events ==')
for (const event of finishEvents) {
  const kind = event.reason?.kind ?? '?'
  if (kind === 'stop' || kind === 'toolUse' || kind === 'tool_use') continue
  console.log(`line ${event.line} ${event.path} :: ${JSON.stringify(event.reason).slice(0, 400)}`)
}

console.log('\n== last text chunk of each assistant message (truncation shape) ==')
for (const { line, rec } of recs) {
  if (rec.type !== 'assistant/message') continue
  const content = rec.data?.message?.content ?? []
  const text = content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
  if (text.length < 3000) continue
  console.log(`\nline ${line} len=${text.length}`)
  console.log('   tail:', JSON.stringify(text.slice(-160)))
}
