import type { NoteSegment } from '../types'
import { MIDI_MAX, MIDI_MIN, clamp } from './layout'

/** One note's target pitch before and after an edit. */
export interface NoteChange {
  id: string
  from: number
  to: number
}

/** A single undoable step: every note it touched. */
export type Edit = NoteChange[]

export interface History {
  past: Edit[]
  future: Edit[]
}

export const MAX_HISTORY = 100
/** Alt-drag and Alt+arrow resolution: 1 cent, and 10 cents per key press. */
export const FINE_STEP = 0.01
export const FINE_KEY_STEP = 0.1

export const emptyHistory: History = { past: [], future: [] }

export const shiftOf = (note: NoteSegment) => note.midi - note.detectedMidi

export const isEdited = (note: NoteSegment) => Math.abs(shiftOf(note)) > 1e-6

/** Applies an edit's `to` (or, undoing, its `from`) values. Untouched notes keep their identity. */
export function applyEdit(notes: NoteSegment[], edit: Edit, direction: 'to' | 'from' = 'to'): NoteSegment[] {
  if (edit.length === 0) return notes
  const targets = new Map(edit.map((c) => [c.id, c[direction]]))
  return notes.map((n) => {
    const midi = targets.get(n.id)
    return midi === undefined || midi === n.midi ? n : { ...n, midi }
  })
}

/**
 * Moves notes by `delta` semitones from their `start` pitches. With snap, each note lands on the
 * nearest semitone (which also corrects its tuning); without, it moves in 1-cent steps.
 */
export function shiftNotes(start: Map<string, number>, delta: number, snap: boolean): Edit {
  return [...start].map(([id, from]) => {
    const raw = from + delta
    const to = snap ? Math.round(raw) : Math.round(raw / FINE_STEP) * FINE_STEP
    return { id, from, to: clamp(to, MIDI_MIN, MIDI_MAX) }
  })
}

/** Keyboard nudge. Snapped: to the next semitone up or down. Fine: by `step` semitones. */
export function nudgeNotes(notes: NoteSegment[], ids: Set<string>, direction: 1 | -1, snap: boolean): Edit {
  return notes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const to = snap ? Math.round(n.midi) + direction : Math.round((n.midi + direction * FINE_KEY_STEP) * 100) / 100
      return { id: n.id, from: n.midi, to: clamp(to, MIDI_MIN, MIDI_MAX) }
    })
}

/** Puts notes back at the pitch they were sung at. */
export function resetNotes(notes: NoteSegment[], ids: Set<string>): Edit {
  return notes.filter((n) => ids.has(n.id) && isEdited(n)).map((n) => ({ id: n.id, from: n.midi, to: n.detectedMidi }))
}

/** Drops no-op changes; returns null when nothing changed. */
export function effective(edit: Edit): Edit | null {
  const changed = edit.filter((c) => Math.abs(c.to - c.from) > 1e-9)
  return changed.length ? changed : null
}

export function record(history: History, edit: Edit): History {
  return { past: [...history.past, edit].slice(-MAX_HISTORY), future: [] }
}

export function undo(history: History): [History, Edit | null] {
  const edit = history.past.at(-1)
  if (!edit) return [history, null]
  return [{ past: history.past.slice(0, -1), future: [edit, ...history.future] }, edit]
}

export function redo(history: History): [History, Edit | null] {
  const [edit, ...future] = history.future
  if (!edit) return [history, null]
  return [{ past: [...history.past, edit], future }, edit]
}

// Tuning colours (dark theme): off pitch at 50 cents away, in tune within 10 cents.
const OFF_PITCH = [224, 86, 155]
const IN_TUNE = [63, 191, 134]
const IN_TUNE_CENTS = 10
const OFF_PITCH_CENTS = 50

/** 0 = fully off pitch, 1 = in tune. */
export const tuningAmount = (cents: number) =>
  clamp((OFF_PITCH_CENTS - Math.abs(cents)) / (OFF_PITCH_CENTS - IN_TUNE_CENTS), 0, 1)

export function tuningColor(cents: number, alpha = 1): string {
  const t = tuningAmount(cents)
  const [r, g, b] = OFF_PITCH.map((c, i) => Math.round(c + (IN_TUNE[i] - c) * t))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
