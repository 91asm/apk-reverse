// Pull the routing + usage evidence out of a DSH session jsonl.
import fs from 'node:fs'

const file = process.argv[2]
const mode = process.argv[3] ?? 'routing'
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const clip = (value, max = 3000) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}]` : text
}

if (mode === 'routing') {
  for (const { line, rec } of recs) {
    if (['model/selection', 'request/header', 'request/context', 'agent-preset/selected', 'session', 'system/message', 'web/deepseek-search-llm-request'].includes(rec.type)) {
      console.log(`\n--- line ${line} :: ${rec.type} ---`)
      console.log(clip(rec.data ?? rec, 4000))
    }
  }
}

if (mode === 'usage') {
  for (const { line, rec } of recs) {
    if (rec.type !== 'step/end' && rec.type !== 'assistant/attempt' && rec.type !== 'turn/end') continue
    const data = rec.data ?? {}
    const keys = Object.keys(data)
    const usage = data.usage ?? data.tokens ?? null
    const interesting = keys.filter((k) => /usage|token|stop|model|provider|finish|reason|limit|max/i.test(k))
    const view = {}
    for (const k of interesting) view[k] = data[k]
    if (Object.keys(view).length === 0) continue
    console.log(`line ${String(line).padStart(4)} ${rec.type.padEnd(18)} ${clip(view, 1200)}`)
  }
}

if (mode === 'texts') {
  let i = 0
  for (const { line, rec } of recs) {
    if (rec.type !== 'assistant/message') continue
    i += 1
    const data = rec.data ?? {}
    const parts = Array.isArray(data.parts) ? data.parts : []
    const summary = parts.map((p) => {
      const kind = p.type ?? '?'
      const text = typeof p.text === 'string' ? p.text : typeof p.content === 'string' ? p.content : JSON.stringify(p).slice(0, 200)
      return `${kind}(${text.length}): ${text.slice(0, 220).replace(/\s+/g, ' ')}`
    })
    console.log(`\n#${i} line ${line} keys=${Object.keys(data).join(',')}`)
    for (const s of summary) console.log('   ', s)
  }
}

if (mode === 'inbox') {
  for (const { line, rec } of recs) {
    if (!['agent/inbox/spliced', 'user/message', 'step/start', 'turn/start'].includes(rec.type)) continue
    const data = rec.data ?? {}
    console.log(`\n--- line ${line} :: ${rec.type} :: ${clip(Object.keys(data), 400)}`)
    console.log('   ', clip(data, 700).replace(/\s+/g, ' '))
  }
}
