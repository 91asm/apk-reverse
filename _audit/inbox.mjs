// What actually got spliced into the conversation: inbox injections and user messages.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const clip = (value, max = 700) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}]` : text
}

function textOf(message) {
  if (message === null || typeof message !== 'object') return ''
  const parts = Array.isArray(message.content) ? message.content : Array.isArray(message.parts) ? message.parts : []
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n')
}

console.log('== user/message ==')
for (const { line, rec } of recs) {
  if (rec.type !== 'user/message') continue
  const data = rec.data ?? {}
  const text = textOf(data.message)
  console.log(`\nline ${line} keys=${Object.keys(data).join(',')} len=${text.length}`)
  console.log('   ', clip(text.replace(/\s+/g, ' '), 500))
}

console.log('\n\n== agent/inbox/spliced ==')
for (const { line, rec } of recs) {
  if (rec.type !== 'agent/inbox/spliced') continue
  const data = rec.data ?? {}
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.messages) ? data.messages : null
  console.log(`\nline ${line} keys=${Object.keys(data).join(',')} count=${items === null ? '?' : items.length}`)
  if (items !== null) {
    for (const item of items.slice(0, 4)) {
      const role = item.role ?? item.message?.role ?? '?'
      const text = textOf(item.message ?? item)
      console.log(`    [${role}] len=${text.length} :: ${clip(text.replace(/\s+/g, ' '), 400)}`)
    }
  } else {
    console.log('   ', clip(data, 600))
  }
}
