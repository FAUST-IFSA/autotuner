import type { Project } from '../types'
import { computePeaks } from './peaks'
import { detectSegments } from './segments'

export interface AnalysisRequest {
  samples: Float32Array
  sampleRate: number
}

export type AnalysisResult = Pick<Project, 'peaks' | 'notes'>

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { samples, sampleRate } = event.data
  const result: AnalysisResult = {
    peaks: computePeaks(samples, sampleRate),
    notes: detectSegments(samples, sampleRate),
  }
  self.postMessage(result, { transfer: [result.peaks.min.buffer, result.peaks.max.buffer] })
}
