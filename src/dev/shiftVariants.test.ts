import { describe, expect, it } from 'vitest'
import { shiftAt } from '../audio/schedule'
import type { F0Curve, NoteSegment } from '../types'
import { VARIANTS, boxSmooth, snapToKey, variantSchedule, voicedMask } from './shiftVariants'

const variant = (id: string) => VARIANTS.find((v) => v.id === id)!

/** One note from 1 s to 2 s, sung at 60 and moved up two semitones. */
const notes: NoteSegment[] = [{ id: 'a', start: 1, end: 2, originalMidi: 60, midi: 62, detectedMidi: 60 }]
/** Voiced from 0.9 s to 2.1 s, with a 40 ms dropout at 1.5 s and a 200 ms unvoiced consonant at 1.2 s. */
const hopSec = 0.01
const f0: F0Curve = {
  hopSec,
  midi: Array.from({ length: 300 }, (_, i) => {
    const t = i * hopSec
    const voiced = t >= 0.9 && t < 2.1 && !(t >= 1.5 && t < 1.54) && !(t >= 1.2 && t < 1.4)
    return voiced ? 60 : null
  }),
  clarity: new Array(300).fill(1),
}

describe('shift variants', () => {
  it('turns a step into a ramp as long as the box', () => {
    const smoothed = boxSmooth(Float64Array.from([0, 0, 0, 0, 1, 1, 1, 1]), 4)
    // Centred on the step: halfway (0.5) at the first new sample.
    expect([...smoothed]).toEqual([0, 0, 0, 0.25, 0.5, 0.75, 1, 1])
  })

  it('keeps today and the original as they are', () => {
    expect(variantSchedule(notes, f0, variant('original'), 3)).toEqual([{ t: 0, semitones: 0 }])
    const today = variantSchedule(notes, f0, variant('today'), 3)
    expect(shiftAt(today, 1.5)).toBe(2)
    expect(shiftAt(today, 0.98)).toBe(0)
  })

  it('glides into and out of a note over 60 ms, ending exactly at 0', () => {
    const glide = variantSchedule(notes, f0, variant('glide'), 3)
    expect(shiftAt(glide, 0.95)).toBe(0)
    expect(shiftAt(glide, 0.99)).toBeGreaterThan(0.5)
    expect(shiftAt(glide, 0.99)).toBeLessThan(1.5)
    expect(shiftAt(glide, 1.5)).toBe(2)
    expect(shiftAt(glide, 2.1)).toBe(0)
    // Steps are at most a cent apart in time order, every 5 ms at most.
    expect(glide.every((c, i) => i === 0 || c.t > glide[i - 1].t)).toBe(true)
  })

  it('fills pitch-tracker dropouts but not consonants', () => {
    const mask = voicedMask(f0, 600, 0.005)
    expect(mask[Math.round(1.52 / 0.005)]).toBe(1)
    expect(mask[Math.round(1.3 / 0.005)]).toBe(0)
    expect(mask[Math.round(0.5 / 0.005)]).toBe(0)
  })

  it('leaves consonants unshifted when only sung parts are shifted', () => {
    const sung = variantSchedule(notes, f0, variant('sung'), 3)
    expect(shiftAt(sung, 1.1)).toBe(2)
    expect(shiftAt(sung, 1.3)).toBe(0)
    expect(shiftAt(sung, 1.52)).toBe(2)
    expect(shiftAt(sung, 1.7)).toBe(2)
  })

  it('snaps notes to the nearest note of the key', () => {
    const sung = (detectedMidi: number): NoteSegment => ({ ...notes[0], midi: detectedMidi, detectedMidi })
    // D major: G# (68) isn't in it, so 68.2 goes to A (69) and 67.8 to G (67); 66.3 is F# already.
    const snapped = snapToKey([sung(68.2), sung(67.8), sung(66.3)], { tonic: 2, mode: 'major' })
    expect(snapped.map((n) => n.midi)).toEqual([69, 67, 66])
  })
})
