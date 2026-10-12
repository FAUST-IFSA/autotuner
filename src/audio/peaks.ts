import type { Peaks } from '../types'

export const PEAK_SAMPLES_PER_BIN = 256

export function computePeaks(samples: Float32Array, sampleRate: number, samplesPerBin = PEAK_SAMPLES_PER_BIN): Peaks {
  const bins = Math.ceil(samples.length / samplesPerBin)
  const min = new Float32Array(bins)
  const max = new Float32Array(bins)
  let peak = 0

  for (let b = 0; b < bins; b++) {
    const from = b * samplesPerBin
    const to = Math.min(from + samplesPerBin, samples.length)
    let lo = 0
    let hi = 0
    for (let i = from; i < to; i++) {
      const s = samples[i]
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
    min[b] = lo
    max[b] = hi
    peak = Math.max(peak, -lo, hi)
  }

  return { min, max, samplesPerBin, sampleRate, peak: peak || 1 }
}

/** Min/max sample value between two times, aggregated over the bins they span. */
export function peakRange(peaks: Peaks, t0: number, t1: number): [number, number] {
  const binsPerSec = peaks.sampleRate / peaks.samplesPerBin
  const last = peaks.min.length - 1
  const from = Math.min(last, Math.max(0, Math.floor(t0 * binsPerSec)))
  const to = Math.min(last, Math.max(from, Math.ceil(t1 * binsPerSec) - 1))
  let lo = 0
  let hi = 0
  for (let b = from; b <= to; b++) {
    if (peaks.min[b] < lo) lo = peaks.min[b]
    if (peaks.max[b] > hi) hi = peaks.max[b]
  }
  return [lo, hi]
}
