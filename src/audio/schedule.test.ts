import { describe, expect, it } from 'vitest'
import type { NoteSegment } from '../types'
import { ShiftScheduler, type TimedChange, buildSchedule, shiftAt } from './schedule'

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

  it('looks up the shift at a time', () => {
    const schedule = buildSchedule([note(0.5, 1, 60, 62)])
    expect(shiftAt(schedule, 0.2)).toBe(0)
    expect(shiftAt(schedule, 0.7)).toBe(2)
    expect(shiftAt(schedule, 1.2)).toBe(0)
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
