import type { BackingTrack } from '../types'
import { mixToMono, resampleMono } from './channels'
import { decodeAudioFile } from './decode'
import { KEY_SAMPLE_RATE, detectKey } from './key'
import { MAX_DURATION_SECONDS } from './loadAudioFile'
import { computePeaks } from './peaks'

/** Where the volume slider starts: backing tracks are usually mastered louder than a raw vocal. */
export const DEFAULT_BACKING_VOLUME = 0.8

/** Slider position to gain: squared, so the slider feels even across its range. */
export const backingGain = (backing: Pick<BackingTrack, 'volume' | 'muted'>) =>
  backing.muted ? 0 : backing.volume ** 2

/** Decodes a backing track, draws its waveform and detects its key. It's played for reference, never tuned. */
export async function loadBackingTrack(file: Blob, fileName: string): Promise<BackingTrack> {
  const buffer = await decodeAudioFile(file, fileName)
  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new Error(`"${fileName}" is longer than ${MAX_DURATION_SECONDS / 60} minutes.`)
  }
  const key = detectKey(await resampleMono(buffer, KEY_SAMPLE_RATE))
  return {
    file,
    fileName,
    buffer,
    peaks: computePeaks(mixToMono(buffer), buffer.sampleRate),
    offset: 0,
    volume: DEFAULT_BACKING_VOLUME,
    muted: false,
    ...(key && { key: { tonic: key.tonic, mode: key.mode } }),
  }
}

/**
 * The part of the backing track heard when the vocal plays from `from`: `duration` seconds of it, from
 * `start`, beginning `delay` seconds after the vocal does. The backing track is only heard under the vocal,
 * so it stops where the vocal ends. Null when there's none left to hear.
 */
export function backingSpan(from: number, offset: number, vocalDuration: number, backingDuration: number) {
  const begin = from + offset
  const start = Math.max(0, begin)
  const end = Math.min(backingDuration, vocalDuration + offset)
  if (end - start <= 1e-6) return null
  return { delay: start - begin, start, duration: end - start }
}

/** Files this close in length were almost certainly exported together, so they already line up. */
export const SAME_LENGTH_SECONDS = 0.1

export const sameLength = (vocalDuration: number, backingDuration: number) =>
  Math.abs(vocalDuration - backingDuration) <= SAME_LENGTH_SECONDS

/** How much of the two must overlap after lining up, so there's always something to hear together. */
const MIN_OVERLAP_SECONDS = 0.5

/**
 * The song time the line-up view spans: the whole backing track and wherever the vocal can go, plus a margin.
 * Song time is time in the backing track; the vocal sits at `offset`.
 */
export function lineUpRange(vocalDuration: number, backingDuration: number) {
  const margin = Math.max(2, 0.05 * Math.max(vocalDuration, backingDuration))
  return {
    start: Math.min(0, backingDuration - vocalDuration) - margin,
    end: Math.max(backingDuration, vocalDuration) + margin,
  }
}

/** Keeps the vocal inside the line-up view and overlapping the backing track. */
export function clampOffset(offset: number, vocalDuration: number, backingDuration: number) {
  const { start, end } = lineUpRange(vocalDuration, backingDuration)
  const overlap = Math.min(MIN_OVERLAP_SECONDS, vocalDuration, backingDuration)
  const lo = Math.max(start, overlap - vocalDuration)
  const hi = Math.min(end - vocalDuration, backingDuration - overlap)
  return Math.min(hi, Math.max(lo, offset))
}

/** "1:12.40", or "-0:01.20" before the backing track starts. */
export function formatSongTime(seconds: number) {
  const centis = Math.round(Math.abs(seconds) * 100)
  const minutes = Math.floor(centis / 6000)
  const rest = ((centis % 6000) / 100).toFixed(2).padStart(5, '0')
  return `${seconds < 0 && centis > 0 ? '-' : ''}${minutes}:${rest}`
}
