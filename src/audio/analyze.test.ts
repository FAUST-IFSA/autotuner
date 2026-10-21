// End-to-end accuracy check: the full pitch pipeline against the synthetic vocal's known notes.
// Fixture: `node scripts/make-fixture.mjs` (runs automatically via `npm test`).
import fs from 'node:fs'
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzePitch, type PitchAnalysis } from './analyze'

const WAV = 'fixtures/synth-vocal-22k-mono.wav'
const TRUTH = 'fixtures/synth-vocal.truth.json'
const MODEL_DIR = 'node_modules/@spotify/basic-pitch/model'

function readWav16Mono(file: string) {
  const b = fs.readFileSync(file)
  let o = 12
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'data') return Float32Array.from({ length: size / 2 }, (_, i) => b.readInt16LE(o + 8 + i * 2) / 32768)
    o += 8 + size + (size & 1)
  }
  throw new Error('no data chunk')
}

// The package's own test loads the model via file://, which needs tfjs-node; read it into memory instead.
// Like the worker's loader, this selects the backend lazily, so the test catches ordering bugs.
async function loadModel() {
  await tf.setBackend('wasm')
  const json = JSON.parse(fs.readFileSync(`${MODEL_DIR}/model.json`, 'utf8'))
  const weights = Buffer.concat(
    json.weightsManifest.flatMap((g: { paths: string[] }) => g.paths.map((p) => fs.readFileSync(`${MODEL_DIR}/${p}`))),
  )
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest.flatMap((g: { weights: tf.io.WeightsManifestEntry[] }) => g.weights),
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
    }),
  )
}

describe('analyzePitch on the synthetic vocal', () => {
  const truth: { notes: { startSec: number; endSec: number; midi: number }[] } = JSON.parse(
    fs.readFileSync(TRUTH, 'utf8'),
  )
  let result: PitchAnalysis
  let seconds = 0

  beforeAll(async () => {
    await tf.setBackend('cpu')
    const t0 = performance.now()
    result = await analyzePitch(readWav16Mono(WAV), loadModel)
    seconds = (performance.now() - t0) / 1000
    console.log(`analysis: ${seconds.toFixed(1)} s for 30 s of audio, ${result.notes.length} notes`)
  })

  it('uses Basic Pitch, not the fallback', () => {
    expect(result.usedFallback).toBe(false)
  })

  it('finds each sung note at the right pitch, to within 15 cents', () => {
    let found = 0
    for (const t of truth.notes) {
      const mid = (t.startSec + t.endSec) / 2
      const seg = result.notes.find((n) => n.start <= mid && mid <= n.end)
      if (seg && Math.abs(seg.detectedMidi - t.midi) < 0.15) found++
    }
    expect(found / truth.notes.length).toBeGreaterThanOrEqual(0.95)
  })

  it('does not invent many extra notes', () => {
    expect(result.notes.length).toBeLessThanOrEqual(truth.notes.length * 1.1)
  })

  it('returns notes in order without overlaps', () => {
    for (let i = 1; i < result.notes.length; i++) expect(result.notes[i].start).toBeGreaterThanOrEqual(result.notes[i - 1].end)
  })
})
