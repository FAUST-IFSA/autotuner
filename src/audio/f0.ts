import { PitchDetector } from 'pitchy'
import type { F0Curve } from '../types'
import { hzToMidi, median } from './music'

/** Basic Pitch requires exactly this rate, so all analysis runs at it. */
export const ANALYSIS_SAMPLE_RATE = 22050

const WINDOW = 1024
const HOP = 256
/** Clarity needed for a frame to count as voiced on its own (silence, gaps between notes). */
export const STRICT_CLARITY = 0.85
/**
 * Clarity accepted inside a detected note when the frame agrees with the note's pitch. Real vocals
 * (breathy, reverb, processing) often sit around 0.6-0.85; at 0.85 alone, a third of one test vocal's
 * note frames were voiced.
 */
export const NOTE_CLARITY = 0.6
const MIN_HZ = 70
const MAX_HZ = 1100
/** Frames quieter than this fraction of the loudest frame's RMS are treated as silence. */
const SILENCE_RATIO = 0.03
const MEDIAN_SIZE = 5

/**
 * Fundamental frequency per frame using the McLeod pitch method. Frame `i` is centred on
 * `i * hopSec`, so frame times line up with note times. Keeps frames down to `NOTE_CLARITY`;
 * `curveForDisplay` decides which of the weaker ones to show once notes are known.
 */
export function computeF0(samples: Float32Array, sampleRate = ANALYSIS_SAMPLE_RATE): F0Curve {
  const frameCount = Math.ceil(samples.length / HOP)
  const detector = PitchDetector.forFloat32Array(WINDOW)
  const window = new Float32Array(WINDOW)
  const rms = new Float32Array(frameCount)
  const raw: (number | null)[] = new Array(frameCount)
  const clarity: number[] = new Array(frameCount)

  for (let i = 0; i < frameCount; i++) {
    const from = i * HOP - WINDOW / 2
    let sum = 0
    for (let j = 0; j < WINDOW; j++) {
      const s = samples[from + j] ?? 0
      window[j] = s
      sum += s * s
    }
    rms[i] = Math.sqrt(sum / WINDOW)
    const [hz, c] = detector.findPitch(window, sampleRate)
    clarity[i] = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0
    raw[i] = c >= NOTE_CLARITY && hz >= MIN_HZ && hz <= MAX_HZ ? hzToMidi(hz) : null
  }

  let loudest = 0
  for (const r of rms) loudest = Math.max(loudest, r)
  const silence = Math.max(loudest * SILENCE_RATIO, 1e-4)
  for (let i = 0; i < frameCount; i++) if (rms[i] < silence) raw[i] = null

  return { hopSec: HOP / sampleRate, midi: medianFilterVoicedRuns(raw, MEDIAN_SIZE), clarity }
}

/** Voiced runs shorter than this (about 70 ms) are hidden outside notes. */
const MIN_RUN_FRAMES = 6

export function dropShortRuns(values: (number | null)[], minLength: number): (number | null)[] {
  const out = [...values]
  let i = 0
  while (i < out.length) {
    if (out[i] === null) {
      i++
      continue
    }
    let end = i
    while (end < out.length && out[end] !== null) end++
    if (end - i < minLength) out.fill(null, i, end)
    i = end
  }
  return out
}

/** Median filter that never reaches across unvoiced gaps, so note edges stay sharp. */
export function medianFilterVoicedRuns(values: (number | null)[], size: number): (number | null)[] {
  const half = size >> 1
  const out: (number | null)[] = new Array(values.length).fill(null)
  let i = 0
  while (i < values.length) {
    if (values[i] === null) {
      i++
      continue
    }
    let end = i
    while (end < values.length && values[end] !== null) end++
    const run = values.slice(i, end) as number[]
    for (let k = 0; k < run.length; k++) {
      out[i + k] = median(run.slice(Math.max(0, k - half), Math.min(run.length, k + half + 1)))
    }
    i = end
  }
  return out
}

/**
 * Voiced frames between two times. With a reference pitch, frames down to `NOTE_CLARITY` count if
 * they are within a semitone of it (which also rules out octave errors); without one, only frames
 * that pass `STRICT_CLARITY` count.
 */
function voicedFrames(f0: F0Curve, start: number, end: number, near?: number): number[] {
  const from = Math.max(0, Math.ceil(start / f0.hopSec))
  const to = Math.min(f0.midi.length - 1, Math.floor(end / f0.hopSec))
  const voiced: number[] = []
  for (let i = from; i <= to; i++) {
    const m = f0.midi[i]
    if (m === null) continue
    if (near === undefined ? f0.clarity[i] >= STRICT_CLARITY : Math.abs(m - near) <= 1) voiced.push(m)
  }
  return voiced
}

/** Median of the voiced frames between two times, or null if there are fewer than `minFrames`. */
export function f0Median(f0: F0Curve, start: number, end: number, near?: number, minFrames = 3): number | null {
  const voiced = voicedFrames(f0, start, end, near)
  return voiced.length >= minFrames ? median(voiced) : null
}

/** Fraction of frames between two times that are voiced near `near` (0..1). */
export function f0Support(f0: F0Curve, start: number, end: number, near: number): number {
  const frames = Math.max(1, Math.floor(end / f0.hopSec) - Math.ceil(start / f0.hopSec) + 1)
  return voicedFrames(f0, start, end, near).length / frames
}

/**
 * The curve the editor draws: strict frames everywhere, plus weaker frames inside a note that
 * agree with that note's pitch.
 */
export function curveForDisplay(f0: F0Curve, notes: { start: number; end: number; detectedMidi: number }[]): F0Curve {
  const strict = f0.midi.map((m, i) => (m !== null && f0.clarity[i] >= STRICT_CLARITY ? m : null))
  // Outside notes, very short voiced runs are tracker noise rather than singing.
  const midi = dropShortRuns(strict, MIN_RUN_FRAMES)
  for (const note of notes) {
    const from = Math.max(0, Math.ceil(note.start / f0.hopSec))
    const to = Math.min(f0.midi.length - 1, Math.floor(note.end / f0.hopSec))
    for (let i = from; i <= to; i++) {
      const m = f0.midi[i]
      if (m !== null && Math.abs(m - note.detectedMidi) <= 1) midi[i] = m
    }
  }
  return { ...f0, midi }
}
