// Tail shape of the six usage-less long messages: complete sentence or hard cut?
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const targets = new Set([446, 464, 492, 510, 534, 587])
for (const { line, rec } of recs) {
  if (!targets.has(line)) continue
  const data = rec.data ?? {}
  const content = data.message?.content ?? []
  const text = content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
  const parts = content.map((p) => p.type)
  console.log(`\n=== line ${line} turn=${data.turn} step=${data.step} chars=${text.length} parts=${parts.join(',')} ===`)
  console.log('HEAD:', JSON.stringify(text.slice(0, 120)))
  console.log('TAIL:', JSON.stringify(text.slice(-220)))
  const endsClean = /[。！？.!?`)\]}"'」』]\s*$/.test(text)
  console.log('ends on a sentence/closing mark:', endsClean)
}

// What happened immediately after each of those messages?
console.log('\n== following records ==')
for (const { line, rec } of recs) {
  if (!targets.has(line - 1) && !targets.has(line - 2)) continue
  if (rec.type === 'tool/call' || rec.type === 'tool/result') continue
  console.log(`line ${line} :: ${rec.type} :: ${JSON.stringify(rec.data).slice(0, 200)}`)
}
