import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import type { GraphModel } from '@tensorflow/tfjs'
import type { F0Curve, NoteSegment } from '../types'
import { f0Median } from './f0'

/** A note event from Basic Pitch (polyphonic, may overlap). */
export interface RawNote {
  start: number
  end: number
  midi: number
  amplitude: number
}

export const MIN_NOTE_SECONDS = 0.06
export const MERGE_GAP_SECONDS = 0.04
/** Touching segments whose sung pitch differs by less than this are fragments of one note. */
export const FRAGMENT_SEMITONES = 0.5

/** Runs Basic Pitch on 22,050 Hz mono audio. `onProgress` gets 0..1. */
export async function runBasicPitch(
  samples: Float32Array,
  model: GraphModel,
  onProgress: (fraction: number) => void,
): Promise<RawNote[]> {
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await new BasicPitch(Promise.resolve(model)).evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    onProgress,
  )
  // Thresholds from the Basic Pitch README.
  const events = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)))
  return events.map((e) => ({
    start: e.startTimeSeconds,
    end: e.startTimeSeconds + e.durationSeconds,
    midi: e.pitchMidi,
    amplitude: e.amplitude,
  }))
}

/** Removes the parts of `a` covered by `b`. */
function subtract(a: { start: number; end: number }, b: { start: number; end: number }) {
  if (b.end <= a.start || b.start >= a.end) return [a]
  const pieces = []
  if (b.start > a.start) pieces.push({ start: a.start, end: b.start })
  if (b.end < a.end) pieces.push({ start: b.end, end: a.end })
  return pieces
}

/**
 * Makes polyphonic note events monophonic: louder notes win overlaps (quieter ones are trimmed),
 * fragments under 60 ms are dropped, and same-pitch neighbours less than 40 ms apart are merged.
 */
export function toMonophonic(raw: RawNote[]): RawNote[] {
  const placed: RawNote[] = []
  for (const note of [...raw].sort((a, b) => b.amplitude - a.amplitude || a.start - b.start)) {
    let pieces = [{ start: note.start, end: note.end }]
    for (const p of placed) pieces = pieces.flatMap((piece) => subtract(piece, p))
    for (const piece of pieces) if (piece.end - piece.start >= MIN_NOTE_SECONDS) placed.push({ ...note, ...piece })
  }
  placed.sort((a, b) => a.start - b.start)

  const merged: RawNote[] = []
  for (const note of placed) {
    const last = merged[merged.length - 1]
    if (last && last.midi === note.midi && note.start - last.end < MERGE_GAP_SECONDS) {
      last.end = Math.max(last.end, note.end)
      last.amplitude = Math.max(last.amplitude, note.amplitude)
    } else merged.push({ ...note })
  }
  return merged
}

/** Turns note spans into editor segments, taking the sung pitch from the F0 curve where possible. */
export function toSegments(notes: { start: number; end: number; midi?: number }[], f0: F0Curve): NoteSegment[] {
  const segments: NoteSegment[] = []
  for (const note of notes) {
    const detectedMidi = f0Median(f0, note.start, note.end, note.midi) ?? note.midi
    if (detectedMidi === undefined) continue
    const originalMidi = Math.round(detectedMidi)
    segments.push({
      id: `note-${segments.length}`,
      start: note.start,
      end: note.end,
      originalMidi,
      midi: originalMidi,
      detectedMidi,
    })
  }
  return segments
}

/**
 * Rejoins fragments of one sung note. Vibrato that crosses a semitone boundary makes Basic Pitch
 * flip between neighbouring notes, splitting one held note into several short ones.
 */
export function mergeFragments(segments: NoteSegment[], f0: F0Curve): NoteSegment[] {
  const merged: NoteSegment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (
      last &&
      seg.start - last.end < MERGE_GAP_SECONDS &&
      Math.abs(seg.detectedMidi - last.detectedMidi) < FRAGMENT_SEMITONES
    ) {
      const weighted =
        (last.detectedMidi * (last.end - last.start) + seg.detectedMidi * (seg.end - seg.start)) /
        (seg.end - last.start)
      last.end = seg.end
      last.detectedMidi = f0Median(f0, last.start, last.end, weighted) ?? weighted
      last.originalMidi = last.midi = Math.round(last.detectedMidi)
    } else merged.push({ ...seg })
  }
  return merged.map((seg, i) => ({ ...seg, id: `note-${i}` }))
}
