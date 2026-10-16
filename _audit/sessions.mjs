// Find the turn that actually ended at the output-token cap, across every local session.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const roots = ['E:\\dshtest\\.dsh\\sessions', 'C:\\Users\\inliver\\.dsh\\sessions']
const found = []

function readMaybeZstd(file) {
  const buf = fs.readFileSync(file)
  if (file.endsWith('.zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return null
    return zlib.zstdDecompressSync(buf).toString('utf8')
  }
  return buf.toString('utf8')
}

const files = []
for (const root of roots) {
  if (!fs.existsSync(root)) continue
  for (const workspace of fs.readdirSync(root)) {
    const workspaceDir = path.join(root, workspace)
    if (!fs.statSync(workspaceDir).isDirectory()) continue
    for (const session of fs.readdirSync(workspaceDir)) {
      const candidate = path.join(workspaceDir, session, 'session.v3.jsonl.zstd')
      if (fs.existsSync(candidate)) files.push(candidate)
    }
  }
}
files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
console.log(`session files found = ${files.length}; scanning all`)
let scanned = 0
const hits = []

for (const file of files) {
  scanned += 1
  let text
  try {
    text = readMaybeZstd(file)
  } catch (error) {
    continue
  }
  if (text === null) {
    console.log('zstd unsupported by this node build')
    break
  }
  const maxTokensHits = text.split('"max-tokens"').length - 1
  if (maxTokensHits === 0) continue
  hits.push({ file, maxTokensHits, text })
  const stamp = new Date(fs.statSync(file).mtimeMs).toISOString()
  console.log(`\n${file}\n  mtime=${stamp} max-tokens hits=${maxTokensHits}`)
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"max-tokens"')) continue
    console.log('   ', line.slice(0, 600))
  }
  found.push(file)
}

console.log(`\nscanned ${scanned} sessions`)
if (found.length === 0) console.log('no session on this machine recorded a max-tokens finish')
