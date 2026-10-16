// Deep dive: where usage lives, every error/abort record, and repetition stats.
import fs from 'node:fs'

const file = process.argv[2]
const mode = process.argv[3] ?? 'all'
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const clip = (value, max = 1200) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}]` : text
}

/** Walk a record and collect every path whose key matches the pattern. */
function hunt(node, pattern, path = '', out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((item, index) => hunt(item, pattern, `${path}[${index}]`, out))
    return out
  }
  for (const [key, value] of Object.entries(node)) {
    const next = path.length === 0 ? key : `${path}.${key}`
    if (pattern.test(key)) out.push({ path: next, value })
    hunt(value, pattern, next, out)
  }
  return out
}

if (mode === 'all' || mode === 'usage') {
  console.log('== records carrying usage-like keys ==')
  for (const { line, rec } of recs) {
    const found = hunt(rec.data ?? rec, /^(usage|input_tokens|output_tokens|total_tokens|prompt_tokens|completion_tokens|cached_tokens|reasoning_tokens|maxTokens|max_tokens|contextWindow|stopReason|stop_reason)$/i)
    if (found.length === 0) continue
    console.log(`\nline ${line} :: ${rec.type}`)
    for (const item of found) console.log('   ', item.path, '=', clip(item.value, 400))
  }
}

if (mode === 'all' || mode === 'errors') {
  console.log('\n== records mentioning error / limit / truncation ==')
  const pattern = /error|limit|truncat|exceed|quota|insufficient|length|aborted|refus/i
  for (const { line, rec } of recs) {
    const text = JSON.stringify(rec.data ?? {})
    if (!pattern.test(text)) continue
    const found = hunt(rec.data ?? {}, /^(message|error|reason|kind|code|detail|description|text|status)$/i)
      .filter((item) => pattern.test(String(item.value)))
    if (found.length === 0) continue
    console.log(`\nline ${line} :: ${rec.type}`)
    for (const item of found.slice(0, 6)) console.log('   ', item.path, '=', clip(item.value, 500))
  }
}
