import type { GraphModel } from '@tensorflow/tfjs'
import type { F0Curve, NoteSegment } from '../types'
import { ANALYSIS_SAMPLE_RATE, computeF0, curveForDisplay } from './f0'
import { dropOutliers, mergeFragments, numberNotes, runBasicPitch, toMonophonic, toSegments } from './notes'
import { detectSegments } from './segments'

export interface PitchAnalysis {
  notes: NoteSegment[]
  f0: F0Curve
  /** True when Basic Pitch failed and notes came from the loudness segmenter instead. */
  usedFallback: boolean
}

/** Share of the progress bar spent on the F0 pass; the rest is Basic Pitch. */
const F0_SHARE = 0.1

/** F0 curve + notes for 22,050 Hz mono audio. */
export async function analyzePitch(
  samples: Float32Array,
  loadModel: () => Promise<GraphModel>,
  onProgress: (fraction: number) => void = () => {},
): Promise<PitchAnalysis> {
  onProgress(0)
  const f0 = computeF0(samples, ANALYSIS_SAMPLE_RATE)
  onProgress(F0_SHARE)
  try {
    // Await the model before calling Basic Pitch: loading also selects the tfjs backend, and
    // Basic Pitch starts tensor work immediately.
    const model = await loadModel()
    const raw = await runBasicPitch(samples, model, (p) => onProgress(F0_SHARE + p * (1 - F0_SHARE)))
    onProgress(1)
    const notes = numberNotes(dropOutliers(mergeFragments(toSegments(toMonophonic(raw), f0), f0), f0))
    return { notes, f0: curveForDisplay(f0, notes), usedFallback: false }
  } catch (err) {
    console.error('Basic Pitch failed, falling back to loudness segments', err)
    const spans = detectSegments(samples, ANALYSIS_SAMPLE_RATE).map(({ start, end }) => ({ start, end }))
    onProgress(1)
    const notes = numberNotes(toSegments(spans, f0))
    return { notes, f0: curveForDisplay(f0, notes), usedFallback: true }
  }
}
