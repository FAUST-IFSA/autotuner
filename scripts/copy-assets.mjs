// Copies runtime assets from node_modules into public/ so nothing loads from a CDN:
// the Basic Pitch model (+ its LICENSE) and the tfjs WASM backend binaries.
// Runs on postinstall; the copies are gitignored.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const copies = [
  ['node_modules/@spotify/basic-pitch/model', 'public/models/basic-pitch'],
  ['node_modules/@spotify/basic-pitch/LICENSE', 'public/models/basic-pitch/LICENSE'],
  ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', 'public/tfjs-wasm/tfjs-backend-wasm.wasm'],
  ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', 'public/tfjs-wasm/tfjs-backend-wasm-simd.wasm'],
  [
    'node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm',
    'public/tfjs-wasm/tfjs-backend-wasm-threaded-simd.wasm',
  ],
]

for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
  fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true })
}
console.log('Copied Basic Pitch model and tfjs WASM binaries into public/')
