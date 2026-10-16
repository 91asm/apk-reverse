// Structural scan of a DSH session jsonl: record types, key sets, and model/usage fields.
import fs from 'node:fs'

const file = process.argv[2]
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)

const types = new Map()
const keySets = new Map()
const bad = []

raw.forEach((line, index) => {
  let rec
  try {
    rec = JSON.parse(line)
  } catch (error) {
    bad.push({ line: index + 1, error: String(error).slice(0, 80) })
    return
  }
  const type = String(rec.type ?? '<none>')
  types.set(type, (types.get(type) ?? 0) + 1)
  const keys = Object.keys(rec).sort().join(',')
  if (!keySets.has(type)) keySets.set(type, new Map())
  const perType = keySets.get(type)
  perType.set(keys, (perType.get(keys) ?? 0) + 1)
})

console.log('== total lines ==', raw.length, '| parse errors ==', bad.length)
if (bad.length > 0) console.log(JSON.stringify(bad.slice(0, 5)))

console.log('\n== record types ==')
for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(count).padStart(6), type)
}

console.log('\n== key shapes per type ==')
for (const [type, perType] of keySets) {
  for (const [keys, count] of [...perType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`[${type}] x${count} :: ${keys}`)
  }
}

// Where do model / provider / usage / token-limit strings appear?
const needles = ['"model"', '"provider"', '"usage"', '"maxTokens"', '"max_tokens"', '"finishReason"', '"finish_reason"', '"stopReason"', '"reasoningEffort"', '"tokens"', '"contextWindow"']
console.log('\n== needle counts (substring per line) ==')
for (const needle of needles) {
  let lines = 0
  let hits = 0
  for (const line of raw) {
    const found = line.split(needle).length - 1
    if (found > 0) {
      lines += 1
      hits += found
    }
  }
  console.log(needle.padEnd(20), 'lines=', String(lines).padStart(5), 'hits=', hits)
}
