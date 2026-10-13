export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Signed cents from the nearest semitone, in [-50, 50]. */
export const centsOff = (midi: number) => (midi - Math.round(midi)) * 100

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
