import { describe, expect, it } from 'vitest'
import type { NoteSegment } from '../types'
import {
  MAX_HISTORY,
  applyEdit,
  effective,
  emptyHistory,
  isEdited,
  isOffPitch,
  nudgeNotes,
  record,
  redo,
  resetNotes,
  shiftNotes,
  tuningAmount,
  tuningColor,
  tuneUp,
  undo,
} from './edits'

const note = (id: string, detectedMidi: number, midi = detectedMidi): NoteSegment => ({
  id,
  start: 0,
  end: 1,
  detectedMidi,
  originalMidi: Math.round(detectedMidi),
  midi,
})

describe('shiftNotes', () => {
  const start = new Map([
    ['a', 59.73],
    ['b', 62.1],
  ])

  it('snaps every note to a semitone, correcting its tuning', () => {
    expect(shiftNotes(start, 1.2, true)).toEqual([
      { id: 'a', from: 59.73, to: 61 },
      { id: 'b', from: 62.1, to: 63 },
    ])
  })

  it('moves in 1-cent steps without snap', () => {
    const [a] = shiftNotes(start, 0.123, false)
    expect(a.to).toBeCloseTo(59.85)
  })

  it('stays inside the grid', () => {
    expect(shiftNotes(new Map([['a', 83]]), 5, true)[0].to).toBe(84)
  })
})

describe('nudgeNotes', () => {
  const notes = [note('a', 59.73), note('b', 64.2)]

  it('moves selected notes to the next semitone with snap', () => {
    expect(nudgeNotes(notes, new Set(['a']), 1, true)).toEqual([{ id: 'a', from: 59.73, to: 61 }])
    expect(nudgeNotes(notes, new Set(['a']), -1, true)[0].to).toBe(59)
  })

  it('moves by 10 cents in fine mode', () => {
    expect(nudgeNotes(notes, new Set(['b']), 1, false)[0].to).toBeCloseTo(64.3)
  })
})

describe('resetNotes', () => {
  it('restores the sung pitch of edited notes only', () => {
    const notes = [note('a', 59.73, 61), note('b', 64.2)]
    expect(resetNotes(notes, new Set(['a', 'b']))).toEqual([{ id: 'a', from: 61, to: 59.73 }])
  })
})

describe('applyEdit', () => {
  it('applies forwards and backwards, keeping untouched notes identical', () => {
    const notes = [note('a', 59.73), note('b', 64.2)]
    const edit = [{ id: 'a', from: 59.73, to: 61 }]
    const after = applyEdit(notes, edit)
    expect(after[0].midi).toBe(61)
    expect(after[1]).toBe(notes[1])
    expect(isEdited(after[0])).toBe(true)
    expect(applyEdit(after, edit, 'from')[0].midi).toBe(59.73)
  })
})

describe('history', () => {
  const e1 = [{ id: 'a', from: 60, to: 61 }]
  const e2 = [{ id: 'a', from: 61, to: 62 }]

  it('undoes and redoes in order', () => {
    let h = record(record(emptyHistory, e1), e2)
    let edit
    ;[h, edit] = undo(h)
    expect(edit).toBe(e2)
    ;[h, edit] = undo(h)
    expect(edit).toBe(e1)
    expect(undo(h)[1]).toBeNull()
    ;[h, edit] = redo(h)
    expect(edit).toBe(e1)
  })

  it('clears redo after a new edit', () => {
    const [h] = undo(record(emptyHistory, e1))
    expect(record(h, e2).future).toEqual([])
  })

  it('keeps the last 100 steps', () => {
    let h = emptyHistory
    for (let i = 0; i < MAX_HISTORY + 20; i++) h = record(h, [{ id: 'a', from: i, to: i + 1 }])
    expect(h.past).toHaveLength(MAX_HISTORY)
    expect(h.past[0][0].from).toBe(20)
  })

  it('ignores no-op edits', () => {
    expect(effective([{ id: 'a', from: 60, to: 60 }])).toBeNull()
  })
})

describe('tuning colour', () => {
  it('is fully in tune within 10 cents and fully off at 50', () => {
    expect(tuningAmount(8)).toBe(1)
    expect(tuningAmount(-50)).toBe(0)
    expect(tuningAmount(30)).toBeCloseTo(0.5)
    expect(tuningColor(0)).toBe('rgba(63, 191, 134, 1)')
  })
})

describe('tuneUp', () => {
  it('moves only off-pitch notes (more than 10 cents out) to their nearest semitone', () => {
    const notes = [note('a', 59.7), note('b', 62.08), note('c', 64.45), note('d', 60.2, 61.3)]
    expect(notes.map(isOffPitch)).toEqual([true, false, true, true])
    expect(tuneUp(notes)).toEqual([
      { id: 'a', from: 59.7, to: 60 },
      { id: 'c', from: 64.45, to: 64 },
      { id: 'd', from: 61.3, to: 61 },
    ])
  })

  it('does nothing when everything is in tune', () => {
    expect(tuneUp([note('a', 60.05), note('b', 62, 64)])).toEqual([])
  })
})
