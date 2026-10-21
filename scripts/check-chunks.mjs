// Fails the build if the LGPL MP3 encoder (lamejs) ends up anywhere but its own worker chunk.
// LGPL compliance here relies on lamejs shipping unmodified as a separate, replaceable file
// (docs/licenses/THIRD_PARTY_LICENSES.md). One stray import from the main app would merge it into
// index-*.js without any visible error, so this checks the built output after `vite build`.
import fs from 'node:fs'
import path from 'node:path'

const assets = path.resolve(import.meta.dirname, '../dist/assets')
const MARKERS = ['Mp3Encoder', 'lame_init']
const WORKER = /^mp3\.worker-.*\.js$/

const files = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
const hasLame = (f) => {
  const text = fs.readFileSync(path.join(assets, f), 'utf8')
  return MARKERS.some((m) => text.includes(m))
}

const problems = []
const workers = files.filter((f) => WORKER.test(f))
if (workers.length !== 1) problems.push(`expected exactly one mp3.worker chunk, found ${workers.length}`)
for (const f of workers) if (!hasLame(f)) problems.push(`${f} doesn't contain lamejs (markers changed?)`)
for (const f of files)
  if (!WORKER.test(f) && hasLame(f)) problems.push(`lamejs found in ${f}; it must only be in the MP3 worker`)

console.log(`check-chunks: ${files.join(', ')}`)
if (problems.length) {
  console.error(`check-chunks failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('check-chunks: lamejs is only in the MP3 worker chunk.')
