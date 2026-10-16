// Pseudo-tag distribution per assistant message, plus the first失控 context.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

console.log('line | turn | step | chars | </invoke> | </parameter> | firstTagPos | usageOut')
let totalInvoke = 0
let totalParam = 0
const samples = []
for (const { line, rec } of recs) {
  if (rec.type !== 'assistant/message') continue
  const data = rec.data ?? {}
  const content = data.message?.content ?? []
  const text = content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
  const inv = text.split('</invoke>').length - 1
  const par = text.split('</parameter>').length - 1
  totalInvoke += inv
  totalParam += par
  if (inv === 0 && par === 0) continue
  const first = Math.min(
    ...[text.indexOf('</invoke>'), text.indexOf('</parameter>')].filter((i) => i >= 0),
  )
  const usageOut = data.usage?.outputTokens ?? '-'
  console.log(
    [String(line).padStart(4), String(data.turn).padStart(4), String(data.step).padStart(4), String(text.length).padStart(7), String(inv).padStart(9), String(par).padStart(12), String(first).padStart(11), String(usageOut).padStart(8)].join(' | '),
  )
  if (samples.length < 2) samples.push({ line, text, first })
}

console.log(`\ntotal </invoke> = ${totalInvoke}, total </parameter> = ${totalParam}`)

console.log('\n== first pseudo-tag context ==')
for (const sample of samples) {
  const start = Math.max(0, sample.first - 400)
  console.log(`\n--- line ${sample.line} around char ${sample.first} ---`)
  console.log(JSON.stringify(sample.text.slice(start, sample.first + 200)))
}
