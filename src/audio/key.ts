import type { MusicalKey } from '../types'

// Key detection: how much of each of the 12 pitch classes a recording contains (its chroma), compared with
// the Krumhansl-Kessler key profiles in all 24 keys. Used on backing tracks, where chords make the key clear.

export interface KeyEstimate extends MusicalKey {
  /** Correlation of the chroma with this key's profile, -1 to 1. */
  score: number
  /**
   * Lead over the best other key that isn't this key's relative major or minor (which has the same notes, so
   * mixing the two up doesn't change which notes are in key).
   */
  margin: number
}

/** The rate chroma is computed at: key detection only needs content up to about 2 kHz. */
export const KEY_SAMPLE_RATE = 11025

/** Below either of these the key isn't shown: the music doesn't point clearly at one key. */
const MIN_SCORE = 0.6
const MIN_MARGIN = 0.05

// Krumhansl & Kessler (1982) probe-tone ratings, from the tonic up.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const FRAME = 4096
const HOP = 2048
/** C2 to C7: bass notes up to the top of most chord voicings. */
const MIN_HZ = 65.4
const MAX_HZ = 2093
/** Frames quieter than this (RMS, about -60 dBFS) are skipped. */
const SILENCE_RMS = 1e-3

const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

export const keyName = ({ tonic, mode }: MusicalKey) =>
  `${(mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[tonic]} ${mode}`

/** An in-place radix-2 FFT of `re` + i`im` for one size (a power of two), with its twiddles worked out once. */
function makeFft(n: number) {
  const cos = Float64Array.from({ length: n / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / n))
  const sin = Float64Array.from({ length: n / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / n))
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        const r = re[i]
        re[i] = re[j]
        re[j] = r
        const m = im[i]
        im[i] = im[j]
        im[j] = m
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const stride = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * stride]
          const wi = sin[k * stride]
          const a = start + k
          const b = a + half
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
  }
}

/**
 * The recording's chroma: energy per pitch class (0 = C), each frame normalised so loud passages don't
 * outweigh quiet ones. Spectrum bins between two semitones count less, so they don't smear into both.
 */
export function chromaOf(samples: Float32Array, sampleRate: number): number[] {
  const chroma = new Array<number>(12).fill(0)
  const window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME))
  const bins: { k: number; pitchClass: number; weight: number }[] = []
  for (let k = Math.ceil((MIN_HZ * FRAME) / sampleRate); k <= Math.floor((MAX_HZ * FRAME) / sampleRate); k++) {
    const midi = 69 + 12 * Math.log2((k * sampleRate) / FRAME / 440)
    const nearest = Math.round(midi)
    bins.push({ k, pitchClass: ((nearest % 12) + 12) % 12, weight: Math.cos(Math.PI * (midi - nearest)) ** 2 })
  }
  const fft = makeFft(FRAME)
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const frame = new Array<number>(12)
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let energy = 0
    for (let i = 0; i < FRAME; i++) {
      const s = samples[start + i]
      energy += s * s
      re[i] = s * window[i]
      im[i] = 0
    }
    if (Math.sqrt(energy / FRAME) < SILENCE_RMS) continue
    fft(re, im)
    frame.fill(0)
    for (const { k, pitchClass, weight } of bins) frame[pitchClass] += Math.hypot(re[k], im[k]) * weight
    const total = frame.reduce((a, b) => a + b, 0)
    if (total > 0) for (let pc = 0; pc < 12; pc++) chroma[pc] += frame[pc] / total
  }
  return chroma
}

function correlation(a: readonly number[], b: readonly number[]) {
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(a)
  const mb = mean(b)
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

/** The relative minor of a major key, or major of a minor one: the same seven notes. */
const relativeOf = ({ tonic, mode }: MusicalKey): MusicalKey =>
  mode === 'major' ? { tonic: (tonic + 9) % 12, mode: 'minor' } : { tonic: (tonic + 3) % 12, mode: 'major' }

/** The best-matching key for a chroma; null for silence. */
export function estimateKey(chroma: readonly number[]): KeyEstimate | null {
  if (!chroma.some((c) => c > 0)) return null
  const keys = (['major', 'minor'] as const).flatMap((mode) =>
    Array.from({ length: 12 }, (_, tonic) => {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
      const rotated = Array.from({ length: 12 }, (_, pc) => profile[(pc - tonic + 12) % 12])
      return { tonic, mode, score: correlation(chroma, rotated) }
    }),
  )
  keys.sort((a, b) => b.score - a.score)
  const best = keys[0]
  const relative = relativeOf(best)
  const rival = keys.find((k) => k !== best && !(k.tonic === relative.tonic && k.mode === relative.mode))!
  return { ...best, margin: best.score - rival.score }
}

/** True when an estimate is strong enough to show. */
export const isClearKey = (estimate: KeyEstimate | null): estimate is KeyEstimate =>
  estimate !== null && estimate.score >= MIN_SCORE && estimate.margin >= MIN_MARGIN

/** The key of mono audio at KEY_SAMPLE_RATE, or null when it isn't clear. */
export function detectKey(samples: Float32Array): KeyEstimate | null {
  const estimate = estimateKey(chromaOf(samples, KEY_SAMPLE_RATE))
  return isClearKey(estimate) ? estimate : null
}
