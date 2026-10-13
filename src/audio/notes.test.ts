import { describe, expect, it } from 'vitest'
import type { NoteSegment } from '../types'
import { mergeFragments, toMonophonic, toSegments } from './notes'

const note = (start: number, end: number, midi: number, amplitude = 0.5) => ({ start, end, midi, amplitude })

describe('toMonophonic', () => {
  it('lets the louder note win an overlap and trims the quieter one', () => {
    const out = toMonophonic([note(0, 1, 60, 0.9), note(0.8, 1.5, 62, 0.4)])
    expect(out).toEqual([note(0, 1, 60, 0.9), note(1, 1.5, 62, 0.4)])
  })

  it('drops a quieter harmonic that sits inside a louder note', () => {
    expect(toMonophonic([note(0, 1, 60, 0.9), note(0.2, 0.6, 72, 0.3)])).toEqual([note(0, 1, 60, 0.9)])
  })

  it('drops fragments shorter than 60 ms', () => {
    expect(toMonophonic([note(0, 0.05, 60)])).toEqual([])
    expect(toMonophonic([note(0, 1, 60, 0.9), note(0.97, 1.02, 62, 0.4)])).toEqual([note(0, 1, 60, 0.9)])
  })

  it('merges same-pitch neighbours less than 40 ms apart', () => {
    expect(toMonophonic([note(0, 0.5, 60, 0.4), note(0.52, 1, 60, 0.6)])).toEqual([note(0, 1, 60, 0.6)])
    expect(toMonophonic([note(0, 0.5, 60), note(0.6, 1, 60)])).toHaveLength(2)
  })
})

describe('toSegments', () => {
  const f0 = { hopSec: 0.1, midi: [null, 60.3, 60.4, 60.2, null, null], clarity: [] }

  it('takes the sung pitch from the F0 curve', () => {
    const [seg] = toSegments([{ start: 0, end: 0.4, midi: 60 }], f0)
    expect(seg.detectedMidi).toBeCloseTo(60.3)
    expect(seg.originalMidi).toBe(60)
    expect(seg.midi).toBe(60)
  })

  it('falls back to the detector pitch without voiced frames', () => {
    expect(toSegments([{ start: 0.45, end: 0.6, midi: 62 }], f0)[0].detectedMidi).toBe(62)
  })

  it('drops pitchless spans that have no voiced frames', () => {
    expect(toSegments([{ start: 0.45, end: 0.6 }], f0)).toEqual([])
  })
})

describe('mergeFragments', () => {
  const f0 = { hopSec: 0.1, midi: [62.2, 62.4, 62.3, 62.2, 63.4, 63.5, 64, 64], clarity: [] }
  const seg = (start: number, end: number, detectedMidi: number): NoteSegment => ({
    id: '',
    start,
    end,
    detectedMidi,
    originalMidi: Math.round(detectedMidi),
    midi: Math.round(detectedMidi),
  })

  it('joins touching fragments of one vibrato note and re-reads its pitch', () => {
    const out = mergeFragments([seg(0, 0.15, 62.2), seg(0.15, 0.25, 62.48), seg(0.25, 0.35, 62.1)], f0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'note-0', start: 0, end: 0.35, originalMidi: 62, midi: 62 })
    expect(out[0].detectedMidi).toBeCloseTo(62.25)
  })

  it('keeps neighbouring notes a semitone or more apart', () => {
    expect(mergeFragments([seg(0, 0.35, 62.3), seg(0.35, 0.55, 63.45)], f0)).toHaveLength(2)
  })

  it('keeps fragments separated by a real gap', () => {
    expect(mergeFragments([seg(0, 0.2, 62.3), seg(0.3, 0.4, 62.3)], f0)).toHaveLength(2)
  })
})
