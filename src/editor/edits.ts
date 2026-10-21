import { isEdited } from '../audio/music'
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
 * Keeps an edit inside the drawn grid (C2-C6) without ever moving a note the wrong way: a note sung outside
 * the grid can move toward it, but an edit that would take it further out leaves it where it is.
 */
const keepInGrid = (to: number, from: number) => clamp(to, Math.min(MIDI_MIN, from), Math.max(MIDI_MAX, from))

/**
 * Moves notes by `delta` semitones from their `start` pitches. With snap, each note lands on the
 * nearest semitone (which also corrects its tuning); without, it moves in 1-cent steps.
 */
export function shiftNotes(start: Map<string, number>, delta: number, snap: boolean): Edit {
  return [...start].map(([id, from]) => {
    const raw = from + delta
    const to = snap ? Math.round(raw) : Math.round(raw / FINE_STEP) * FINE_STEP
    return { id, from, to: keepInGrid(to, from) }
  })
}

/** Keyboard nudge. Snapped: to the next semitone up or down. Fine: by `step` semitones. */
export function nudgeNotes(notes: NoteSegment[], ids: Set<string>, direction: 1 | -1, snap: boolean): Edit {
  return notes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const to = snap ? Math.round(n.midi) + direction : Math.round((n.midi + direction * FINE_KEY_STEP) * 100) / 100
      return { id: n.id, from: n.midi, to: keepInGrid(to, n.midi) }
    })
}

/** Puts notes back at the pitch they were sung at. */
export function resetNotes(notes: NoteSegment[], ids: Set<string>): Edit {
  return notes.filter((n) => ids.has(n.id) && isEdited(n)).map((n) => ({ id: n.id, from: n.midi, to: n.detectedMidi }))
}

/** Notes that read as off pitch (not green): more than 10 cents from a semitone. */
export const isOffPitch = (note: NoteSegment) => Math.abs(note.midi - Math.round(note.midi)) * 100 > IN_TUNE_CENTS

/** "Tune Up": moves every off-pitch note to its nearest semitone, as one edit. */
export function tuneUp(notes: NoteSegment[]): Edit {
  return notes.filter(isOffPitch).map((n) => ({ id: n.id, from: n.midi, to: Math.round(n.midi) }))
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
/** Within this many cents of a semitone a note counts as in tune (green); further out it's off pitch. */
export const IN_TUNE_CENTS = 10
const OFF_PITCH_CENTS = 50

/** 0 = fully off pitch, 1 = in tune. */
export const tuningAmount = (cents: number) =>
  clamp((OFF_PITCH_CENTS - Math.abs(cents)) / (OFF_PITCH_CENTS - IN_TUNE_CENTS), 0, 1)

export function tuningColor(cents: number, alpha = 1): string {
  const t = tuningAmount(cents)
  const [r, g, b] = OFF_PITCH.map((c, i) => Math.round(c + (IN_TUNE[i] - c) * t))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
