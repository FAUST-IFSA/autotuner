import type { NoteSegment } from '../types'

const FRAME_SIZE = 1024
const MIN_GAP_SECONDS = 0.08
const MIN_LENGTH_SECONDS = 0.12

/**
 * Splits audio into segments wherever it is loud enough to contain a note.
 * Fallback when Basic Pitch fails: every segment starts at `defaultMidi` until its pitch is read from the F0 curve.
 */
export function detectSegments(samples: Float32Array, sampleRate: number, defaultMidi = 60): NoteSegment[] {
  const frameCount = Math.floor(samples.length / FRAME_SIZE)
  const rms = new Float32Array(frameCount)
  let loudest = 0

  for (let f = 0; f < frameCount; f++) {
    let sum = 0
    for (let i = f * FRAME_SIZE; i < (f + 1) * FRAME_SIZE; i++) sum += samples[i] * samples[i]
    rms[f] = Math.sqrt(sum / FRAME_SIZE)
    loudest = Math.max(loudest, rms[f])
  }

  const threshold = Math.max(loudest * 0.15, 0.005)
  const frameSeconds = FRAME_SIZE / sampleRate
  const minGapFrames = Math.ceil(MIN_GAP_SECONDS / frameSeconds)
  const minLengthFrames = Math.ceil(MIN_LENGTH_SECONDS / frameSeconds)

  const runs: [number, number][] = []
  let runStart = -1
  for (let f = 0; f <= frameCount; f++) {
    const loud = f < frameCount && rms[f] >= threshold
    if (loud && runStart < 0) runStart = f
    if (!loud && runStart >= 0) {
      const prev = runs[runs.length - 1]
      if (prev && runStart - prev[1] < minGapFrames) prev[1] = f
      else runs.push([runStart, f])
      runStart = -1
    }
  }

  return runs
    .filter(([from, to]) => to - from >= minLengthFrames)
    .map(([from, to], i) => ({
      id: `seg-${i}`,
      start: from * frameSeconds,
      end: to * frameSeconds,
      originalMidi: defaultMidi,
      midi: defaultMidi,
      detectedMidi: defaultMidi,
    }))
}
