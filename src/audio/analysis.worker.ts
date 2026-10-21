import * as tf from '@tensorflow/tfjs'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import type { Project } from '../types'
import { analyzePitch } from './analyze'
import { computePeaks } from './peaks'

export interface AnalysisRequest {
  /** Mono mix at the original sample rate, for drawing. */
  samples: Float32Array
  sampleRate: number
  /** Mono at 22,050 Hz, for pitch analysis. */
  analysisSamples: Float32Array
}

export type AnalysisResult = Pick<Project, 'peaks' | 'notes' | 'f0'> & { usedFallback: boolean }

export type AnalysisMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string }

// Self-hosted assets, copied into public/ by scripts/copy-assets.mjs.
const base = new URL(import.meta.env.BASE_URL, self.location.origin).href

async function loadModel() {
  setWasmPaths(`${base}tfjs-wasm/`)
  await tf.setBackend('wasm')
  await tf.ready()
  return tf.loadGraphModel(`${base}models/basic-pitch/model.json`)
}

const post = (message: AnalysisMessage, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { samples, sampleRate, analysisSamples } = event.data
  try {
    const peaks = computePeaks(samples, sampleRate)
    const { notes, f0, usedFallback } = await analyzePitch(analysisSamples, loadModel, (fraction) =>
      post({ type: 'progress', fraction }),
    )
    post({ type: 'done', result: { peaks, notes, f0, usedFallback } }, [peaks.min.buffer, peaks.max.buffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
