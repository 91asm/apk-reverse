// Upstream identity: every responseModel the routes actually reported, plus the
// no-usage assistant records and the tool-call repetition profile.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const clip = (value, max = 900) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}]` : text
}

console.log('== provider / model / responseModel actually used ==')
const tally = new Map()
for (const { line, rec } of recs) {
  if (rec.type !== 'assistant/message') continue
  const src = rec.data?.message?.source ?? {}
  const replay = src.replayState?.response ?? {}
  const key = [src.provider ?? replay.provider ?? '-', src.model ?? replay.model ?? '-', replay.responseModel ?? '(none)'].join(' | ')
  if (!tally.has(key)) tally.set(key, [])
  tally.get(key).push(line)
}
for (const [key, lines] of tally) console.log(`x${String(lines.length).padStart(3)} :: ${key}\n        lines: ${lines.slice(0, 12).join(',')}${lines.length > 12 ? ' ...' : ''}`)

console.log('\n== assistant/message with no usage (injected or interrupted) ==')
for (const { line, rec } of recs) {
  if (rec.type !== 'assistant/message') continue
  const data = rec.data ?? {}
  if (data.usage !== undefined) continue
  const content = data.message?.content ?? []
  const text = content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('\n')
  console.log(`\nline ${line} turn=${data.turn} step=${data.step} source=${clip(data.message?.source?.kind ?? data.message?.source ?? '?', 200)} len=${text.length}`)
  console.log('   ', clip(text.replace(/\s+/g, ' '), 500))
}

console.log('\n== tool-call repetition: same name+arguments seen more than once ==')
const calls = []
for (const { line, rec } of recs) {
  if (rec.type !== 'tool/call') continue
  const data = rec.data ?? {}
  const name = data.name ?? data.call?.name ?? '?'
  const args = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? data.call?.arguments ?? '')
  calls.push({ line, name, args })
}
const seen = new Map()
for (const call of calls) {
  const key = `${call.name}::${call.args}`
  if (!seen.has(key)) seen.set(key, [])
  seen.get(key).push(call.line)
}
const repeats = [...seen.entries()].filter(([, lines]) => lines.length > 1).sort((a, b) => b[1].length - a[1].length)
console.log(`tool calls total=${calls.length} unique=${seen.size} repeated-signatures=${repeats.length}`)
for (const [key, lines] of repeats.slice(0, 15)) {
  const [name, args] = key.split('::')
  console.log(`\nx${lines.length} ${name} lines=${lines.join(',')}`)
  console.log('   ', clip(args.replace(/\s+/g, ' '), 300))
}

console.log('\n== steps per turn ==')
const stepsPerTurn = new Map()
for (const { rec } of recs) {
  if (rec.type !== 'step/start') continue
  const turn = rec.data?.turn ?? '?'
  stepsPerTurn.set(turn, (stepsPerTurn.get(turn) ?? 0) + 1)
}
console.log([...stepsPerTurn.entries()].map(([t, n]) => `turn ${t}: ${n} steps`).join('\n'))
