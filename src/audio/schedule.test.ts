import { describe, expect, it } from 'vitest'
import type { NoteSegment } from '../types'
import { DEFAULT_PARAMS } from './params'
import {
  BRIDGE_MAX_GAP_SECONDS,
  EDGE_PAD_SECONDS,
  ShiftScheduler,
  type TimedChange,
  buildSchedule,
  shiftAt,
} from './schedule'

const GAP_FILL = DEFAULT_PARAMS.gapFillMaxSeconds

const note = (start: number, end: number, detectedMidi: number, midi = detectedMidi): NoteSegment => ({
  id: `${start}`,
  start,
  end,
  detectedMidi,
  originalMidi: Math.round(detectedMidi),
  midi,
})

describe('buildSchedule', () => {
  it('has no changes when nothing is edited', () => {
    expect(buildSchedule([note(0, 1, 60.2), note(1.5, 2, 62)])).toEqual([{ t: 0, semitones: 0 }])
  })

  it('shifts an edited note over its span, padded by 10 ms, and returns to 0 after', () => {
    const schedule = buildSchedule([note(0.5, 1, 59.7, 60), note(1.5, 2, 62)])
    expect(schedule).toHaveLength(3)
    expect(schedule[1].t).toBeCloseTo(0.49)
    expect(schedule[1].semitones).toBeCloseTo(0.3)
    expect(schedule[2]).toEqual({ t: 1.01, semitones: 0 })
  })

  it('goes straight from one shifted note to the next when they touch', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62), note(1.01, 1.5, 64, 63)])
    expect(schedule.map((c) => c.semitones)).toEqual([0, 2, -1, 0])
    // The boundary sits in the middle of the 10 ms gap.
    expect(schedule[2].t).toBeCloseTo(1.005)
  })

  it('never pads past the middle of a gap', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 61), note(1.012, 1.5, 60)])
    expect(schedule[2].t).toBeCloseTo(1.006)
  })

  it('carries an edited note to the middle of a short gap before an unedited note', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62), note(1.2, 2, 60)])
    expect(schedule).toHaveLength(3)
    expect(schedule[2].t).toBeCloseTo(1.1)
    expect(schedule[2].semitones).toBe(0)
  })

  it('carries an edited note back to the middle of a short gap after an unedited note', () => {
    const schedule = buildSchedule([note(0.5, 1, 60), note(1.2, 2, 60, 62)])
    expect(schedule.map((c) => c.semitones)).toEqual([0, 2, 0])
    expect(schedule[1].t).toBeCloseTo(1.1)
  })

  it('switches directly between two edited notes at the middle of a short gap, without dipping to 0', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62), note(1.2, 2, 60, 59)])
    expect(schedule.map((c) => c.semitones)).toEqual([0, 2, -1, 0])
    expect(schedule[2].t).toBeCloseTo(1.1)
  })

  it('stays on one shift across a short gap between notes with the same shift', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62), note(1.2, 2, 61, 63)])
    expect(schedule.map((c) => c.semitones)).toEqual([0, 2, 0])
    expect(shiftAt(schedule, 1.1)).toBe(2)
  })

  it('bridges a gap just under the limit but not one just over it', () => {
    const at = (gap: number) => buildSchedule([note(0.5, 1, 60, 62), note(1 + gap, 2, 60, 62)])
    expect(at(BRIDGE_MAX_GAP_SECONDS - 0.01).map((c) => c.semitones)).toEqual([0, 2, 0])
    // Over the limit: pad 10 ms, return to 0, and come back 10 ms before the next note.
    const long = at(BRIDGE_MAX_GAP_SECONDS + 0.01)
    expect(long.map((c) => c.semitones)).toEqual([0, 2, 0, 2, 0])
    expect(long[2].t).toBeCloseTo(1 + EDGE_PAD_SECONDS)
    expect(long[3].t).toBeCloseTo(1.31 - EDGE_PAD_SECONDS)
  })

  it('still pads only 10 ms at the ends of the file', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62)])
    expect(schedule[1].t).toBeCloseTo(0.49)
    expect(schedule[2].t).toBeCloseTo(1.01)
  })

  it('looks up the shift at a time', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62)])
    expect(shiftAt(schedule, 0.2)).toBe(0)
    expect(shiftAt(schedule, 0.7)).toBe(2)
    expect(shiftAt(schedule, 1.2)).toBe(0)
  })
})

describe('buildSchedule with sound between notes', () => {
  const span = (start: number, end: number) => ({ start, end })

  it('gives sound in a long gap the shift of the nearer note', () => {
    const notes = [note(0.5, 1, 60, 63), note(3, 3.5, 60)]
    const schedule = buildSchedule(notes, [span(1.5, 1.7), span(2.5, 2.8)])
    expect(shiftAt(schedule, 1.6)).toBe(3)
    // Nearer the unedited note: stays as it was.
    expect(shiftAt(schedule, 2.6)).toBe(0)
    // Silence between them returns to 0.
    expect(shiftAt(schedule, 1.9)).toBe(0)
  })

  it('splits a run of sound that crosses the middle of the gap between two edited notes', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 63), note(3, 3.5, 60, 58)], [span(1.5, 2.5)])
    expect(shiftAt(schedule, 1.9)).toBe(3)
    expect(shiftAt(schedule, 2.1)).toBe(-2)
  })

  it('joins sound close to a note onto the note, with no dip to 0', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 63), note(3, 3.5, 60)], [span(1.2, 1.4)])
    expect(schedule.map((c) => c.semitones)).toEqual([0, 3, 0])
    expect(schedule[2].t).toBeCloseTo(1.41)
  })

  it('covers sound before the first and after the last note', () => {
    const schedule = buildSchedule([note(1, 1.5, 60, 62)], [span(0.2, 0.5), span(1.9, 2.1)])
    expect(shiftAt(schedule, 0.3)).toBe(2)
    expect(shiftAt(schedule, 2)).toBe(2)
  })

  it('leaves sound further than the limit from any note', () => {
    const notes = [note(0.5, 1, 60, 63)]
    const near = buildSchedule(notes, [span(1 + GAP_FILL - 0.05, 1 + GAP_FILL + 0.1)])
    const far = buildSchedule(notes, [span(1 + GAP_FILL + 0.05, 1 + GAP_FILL + 0.1)])
    expect(shiftAt(near, 1 + GAP_FILL)).toBe(3)
    expect(shiftAt(far, 1 + GAP_FILL + 0.07)).toBe(0)
  })

  it("doesn't change short gaps, which are already bridged", () => {
    const notes = [note(0.5, 1, 60, 63), note(1.2, 2, 60)]
    expect(buildSchedule(notes, [span(1.02, 1.18)])).toEqual(buildSchedule(notes))
  })

  it('has no changes when nothing is edited', () => {
    expect(buildSchedule([note(0.5, 1, 60), note(3, 3.5, 62)], [span(1.5, 2.5)])).toEqual([{ t: 0, semitones: 0 }])
  })
})

describe('ShiftScheduler', () => {
  const run = (changes: TimedChange[], times: number[], latency = 0.06) => {
    const posted: { output: number; outputTime: number }[] = []
    const scheduler = new ShiftScheduler((c, outputTime) => posted.push({ output: c.output, outputTime }), latency)
    scheduler.reset(changes, 10)
    const log = times.map((now) => {
      scheduler.tick(now)
      return posted.length
    })
    return { posted, log }
  }
  const changes = [10.5, 11, 11.04, 12].map((output) => ({ output, semitones: 1 }))

  it('posts the first change at once, then each one when its predecessor is active', () => {
    const { posted, log } = run(changes, [10, 10.43, 10.45, 10.95, 10.99, 11.95])
    // 10.45 >= 10.5 - 0.06 queues 11; 10.95 >= 11 - 0.06 queues 11.04; 10.99 >= 11.04 - 0.06 queues 12.
    expect(log).toEqual([1, 1, 2, 3, 4, 4])
    expect(posted.at(-1)?.output).toBe(12)
  })

  it('sets outputTime just after the previous change so it is not dropped', () => {
    const { posted } = run(changes.slice(0, 2), [10, 10.45])
    expect(posted[0].outputTime).toBeCloseTo(10)
    expect(posted[1].outputTime).toBeCloseTo(10.5)
    expect(posted[1].outputTime).toBeGreaterThan(10.5)
  })

  it('drops changes at or before the active segment on reset', () => {
    const { posted } = run([{ output: 9, semitones: 1 }, ...changes.slice(0, 1)], [10])
    expect(posted.map((p) => p.output)).toEqual([10.5])
  })
})
