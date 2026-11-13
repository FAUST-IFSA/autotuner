import type { BackingTrack } from '../types'
import { mixToMono } from './channels'
import { decodeAudioFile } from './decode'
import { MAX_DURATION_SECONDS } from './loadAudioFile'
import { computePeaks } from './peaks'

/** Where the volume slider starts: backing tracks are usually mastered louder than a raw vocal. */
export const DEFAULT_BACKING_VOLUME = 0.8

/** Slider position to gain: squared, so the slider feels even across its range. */
export const backingGain = (backing: Pick<BackingTrack, 'volume' | 'muted'>) =>
  backing.muted ? 0 : backing.volume ** 2

/** Decodes a backing track and draws its waveform. It isn't analysed: it's only played for reference. */
export async function loadBackingTrack(file: Blob, fileName: string): Promise<BackingTrack> {
  const buffer = await decodeAudioFile(file, fileName)
  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new Error(`"${fileName}" is longer than ${MAX_DURATION_SECONDS / 60} minutes.`)
  }
  return {
    file,
    fileName,
    buffer,
    peaks: computePeaks(mixToMono(buffer), buffer.sampleRate),
    offset: 0,
    volume: DEFAULT_BACKING_VOLUME,
    muted: false,
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
