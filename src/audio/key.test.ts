import { describe, expect, it } from 'vitest'
import type { MusicalKey } from '../types'
import { KEY_SAMPLE_RATE, chromaOf, detectKey, estimateKey, isClearKey, keyName, scaleContrast } from './key'

const SR = KEY_SAMPLE_RATE

/** Chords (MIDI notes) one second each, as tones with five harmonics, the way a keyboard part might sound. */
function render(chords: number[][], seconds = 1): Float32Array {
  const out = new Float32Array(Math.round(chords.length * seconds * SR))
  chords.forEach((chord, c) => {
    const from = Math.round(c * seconds * SR)
    for (let i = 0; i < seconds * SR; i++) {
      const t = i / SR
      const envelope = 0.2 + 0.8 * Math.exp(-1.5 * t)
      let s = 0
      for (const note of chord) {
        const hz = 440 * 2 ** ((note - 69) / 12)
        for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * hz * h * t) / h
      }
      out[from + i] = (0.05 * envelope * s) / chord.length
    }
  })
  return out
}

/** Triads with a bass note, from scale degrees (semitones above the tonic). */
const triad = (tonic: number, root: number, third: number, fifth: number) => [
  36 + ((tonic + root) % 12),
  60 + tonic + root,
  60 + tonic + third,
  60 + tonic + fifth,
]
// I-IV-V-I and i-iv-V-i (harmonic minor V), twice.
const majorCadence = (t: number) =>
  [triad(t, 0, 4, 7), triad(t, 5, 9, 12), triad(t, 7, 11, 14), triad(t, 0, 4, 7)].flatMap((c) => [c, c])
const minorCadence = (t: number) =>
  [triad(t, 0, 3, 7), triad(t, 5, 8, 12), triad(t, 7, 11, 14), triad(t, 0, 3, 7)].flatMap((c) => [c, c])

describe('key detection', () => {
  for (const mode of ['major', 'minor'] as const) {
    it(`finds all 12 ${mode} keys from a cadence`, () => {
      for (let tonic = 0; tonic < 12; tonic++) {
        const audio = render(mode === 'major' ? majorCadence(tonic) : minorCadence(tonic))
        const found = detectKey(audio)
        expect(found && keyName(found), `expected ${keyName({ tonic, mode })}`).toBe(keyName({ tonic, mode }))
      }
    })
  }

  it('finds A minor from a pop loop (Am F C G Am F E Am)', () => {
    const loop = [
      [45, 57, 60, 64],
      [41, 53, 57, 60],
      [48, 55, 60, 64],
      [43, 55, 59, 62],
      [45, 57, 60, 64],
      [41, 53, 57, 60],
      [40, 52, 56, 59],
      [45, 57, 60, 64],
    ]
    expect(keyName(detectKey(render(loop))!)).toBe('A minor')
  })

  it("doesn't name a key for noise, a single drone or silence", () => {
    let seed = 1
    const noise = Float32Array.from({ length: 8 * SR }, () => {
      seed = (seed * 16807) % 2147483647
      return (seed / 2147483647 - 0.5) * 0.5
    })
    expect(detectKey(noise)).toBeNull()
    // A bare fifth (C and G) belongs to too many keys to pick one.
    expect(detectKey(render(Array.from({ length: 8 }, () => [48, 55])))).toBeNull()
    expect(detectKey(new Float32Array(8 * SR))).toBeNull()
    expect(estimateKey(chromaOf(new Float32Array(8 * SR), SR))).toBeNull()
  })

  // Pitch-class strength (C to B, strongest = 100) of two real backing tracks: Cambridge-MT multitracks with the
  // vocals left out.
  const ALONE_WITH_YOU = [23, 57, 100, 32, 90, 33, 86, 84, 35, 81, 26, 92]
  const WINDOW = [47, 21, 100, 25, 90, 42, 36, 64, 27, 98, 17, 74]

  it('names a real song whose notes are exactly its key', () => {
    const estimate = estimateKey(ALONE_WITH_YOU)!
    expect(keyName(estimate)).toBe('D major')
    expect(isClearKey(estimate)).toBe(true)
  })

  it("doesn't name a key whose notes the music doesn't use", () => {
    // The profiles' best match is D major, but the riff uses C and F more than C♯ and F♯.
    const estimate = estimateKey(WINDOW)!
    expect(keyName(estimate)).toBe('D major')
    expect(estimate.score).toBeGreaterThan(0.6)
    expect(estimate.contrast).toBe(0)
    expect(isClearKey(estimate)).toBe(false)
  })

  it('accepts the natural or raised 6th and 7th in minor keys', () => {
    // A minor: G and G♯ (and F and F♯) all count as in the key, so only C♯, D♯ and A♯ are outside it. The
    // seven strongest end with G♯ at 45, against 5 outside.
    const aMinor = [80, 5, 60, 5, 90, 55, 10, 40, 45, 100, 5, 50]
    expect(scaleContrast(aMinor, { tonic: 9, mode: 'minor' })).toBe(9)
    expect(scaleContrast(aMinor, { tonic: 0, mode: 'major' })).toBe(0)
  })

  it('names keys with the usual spellings', () => {
    const key = (tonic: number, mode: MusicalKey['mode']): MusicalKey => ({ tonic, mode })
    expect(keyName(key(3, 'major'))).toBe('E♭ major')
    expect(keyName(key(1, 'minor'))).toBe('C♯ minor')
    expect(keyName(key(6, 'major'))).toBe('F♯ major')
  })
})
