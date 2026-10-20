// Copies LICENSE / NOTICE / COPYING files of every direct dependency
// into docs/licenses/texts/ and prints name, version and declared license for the register.
// Packages that ship no license file are reported; fetch their text from upstream by hand.
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const outDir = path.join(root, 'docs/licenses/texts')
fs.mkdirSync(outDir, { recursive: true })
const manifests = ['package.json']

const deps = new Map()
for (const m of manifests) {
  const pj = JSON.parse(fs.readFileSync(path.join(root, m), 'utf8'))
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pj[field] ?? {})) deps.set(name, field)
  }
}

const missing = []
for (const name of [...deps.keys()].sort()) {
  const dir = path.join(root, 'node_modules', name)
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const files = fs.readdirSync(dir).filter((f) => /^(LICEN[CS]E|NOTICE|COPYING)/i.test(f))
  const slug = name.replace('/', '__')
  for (const f of files) {
    const kind = /NOTICE/i.test(f) ? 'NOTICE' : 'LICENSE'
    fs.copyFileSync(path.join(dir, f), path.join(outDir, `${slug}.${kind}.txt`))
  }
  if (!files.some((f) => !/NOTICE/i.test(f))) missing.push(name)
  console.log(`${name}\t${pj.version}\t${pj.license ?? JSON.stringify(pj.licenses)}\t${files.join(',') || '-'}`)
}
if (missing.length) console.log(`\nNo license file shipped (fetch from upstream): ${missing.join(', ')}`)
