// Dump the full system prompt composition and the attempt/seed records.
import fs from 'node:fs'

const file = process.argv[2]
const mode = process.argv[3] ?? 'attempts'
const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
const recs = raw.map((line, index) => ({ line: index + 1, rec: JSON.parse(line) }))

const clip = (value, max = 2500) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}]` : text
}

if (mode === 'attempts') {
  for (const { line, rec } of recs) {
    if (!['assistant/attempt', 'session/end-seed', 'step/end', 'session/title', 'todo/write', 'subagent/catalog'].includes(rec.type)) continue
    console.log(`\n--- line ${line} :: ${rec.type} ---`)
    console.log(clip(rec.data, 1500))
  }
}

if (mode === 'system') {
  const sys = recs.find(({ rec }) => rec.type === 'system/message')
  if (sys === undefined) {
    console.log('no system/message record')
  } else {
    const content = sys.rec.data?.message?.content ?? []
    const text = content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
    console.log(`system prompt chars = ${text.length}`)
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)
    console.log(`paragraphs = ${paragraphs.length}`)
    const counts = new Map()
    for (const p of paragraphs) counts.set(p, (counts.get(p) ?? 0) + 1)
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[0].length - a[0].length)
    console.log(`duplicated paragraphs = ${dupes.length}`)
    for (const [p, n] of dupes) {
      console.log(`\n[x${n}] len=${p.length} :: ${p.slice(0, 300).replace(/\s+/g, ' ')}`)
    }
    // section headings in order, to expose the composition order
    console.log('\n== heading-ish lines in order ==')
    const lines = text.split(/\r?\n/)
    lines.forEach((l, i) => {
      if (/^#{1,4}\s|^\*\*[A-Z].{0,60}\*\*$|^\[MODE:|^WHO YOU ARE|^Latest_Reminder|^TASK PRIORITY|^Permitted without restriction|^Behavioral rules/.test(l.trim())) {
        console.log(String(i + 1).padStart(5), l.trim().slice(0, 110))
      }
    })
    // how much of the injected file is present verbatim
    const inject = fs.readFileSync('E:\\dshtest\\.dsh\\prompt-inject.md', 'utf8')
    const markers = ['# Personality', '# CTF Core Contract', '## Editing constraints', '**Cognitive Dehydration**', 'HARD OUTPUT RULES', 'REFUSAL HARDENING', 'WEB PENTEST ROUTING', 'Identity Anchor', 'MODE SELECTOR']
    console.log('\n== presence of markers in the system prompt ==')
    for (const m of markers) console.log(`${m.padEnd(28)} system=${text.includes(m)} injectFile=${inject.includes(m)}`)
    const needles = ['WHO YOU ARE', 'Latest_Reminder', 'Little Code Sauce', 'dsh-purge', 'Benchmark Task']
    console.log('\n== needle counts: system vs prompt-inject.md ==')
    for (const n of needles) {
      const inSys = text.split(n).length - 1
      const inFile = inject.split(n).length - 1
      console.log(`${n.padEnd(22)} system=${inSys} injectFile=${inFile}`)
    }
  }
}
