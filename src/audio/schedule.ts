import type { NoteSegment } from '../types'

/** From time `t` (seconds in the original audio) on, transpose by `semitones`. */
export interface ShiftChange {
  t: number
  semitones: number
}

/** Shifts start this much before a note and end this much after it, to cover onsets and releases. */
export const EDGE_PAD_SECONDS = 0.01
/**
 * Gaps between shifted notes shorter than this aren't worth a return to 0: in fast vocals the brief
 * flip back and forth was a main source of pops. The gap is silence or breath, so holding a shift is fine.
 */
const MIN_GAP_SECONDS = 0.08
/**
 * Segments shorter than this collapse into the next one. Must be longer than CROSSFADE_SECONDS so each
 * voice has time to change pitch while it is silent.
 */
const MIN_SEGMENT_SECONDS = 0.03
/** Length of the crossfade between voices at every pitch change. */
export const CROSSFADE_SECONDS = 0.02

/**
 * The transpose timeline for playback and export: each note's shift over its span, 0 between notes.
 * Notes are in time order and don't overlap. Untouched notes produce no changes at all.
 */
export function buildSchedule(notes: NoteSegment[]): ShiftChange[] {
  const changes: ShiftChange[] = [{ t: 0, semitones: 0 }]
  const push = (t: number, semitones: number) => {
    const last = changes[changes.length - 1]
    if (Math.abs(last.semitones - semitones) < 1e-9) return
    if (t - last.t >= MIN_SEGMENT_SECONDS) {
      changes.push({ t, semitones })
      return
    }
    // Too close to the previous change: that segment is too short to matter, so it takes the new value.
    last.semitones = semitones
    const before = changes[changes.length - 2]
    if (before && Math.abs(before.semitones - semitones) < 1e-9) changes.pop()
  }

  notes.forEach((note, i) => {
    const shift = note.midi - note.detectedMidi
    const prev = notes[i - 1]
    const next = notes[i + 1]
    // Pad into the gaps, but never past the middle of a gap.
    const start = Math.max(prev ? (prev.end + note.start) / 2 : 0, note.start - EDGE_PAD_SECONDS)
    const end = next ? Math.min((note.end + next.start) / 2, note.end + EDGE_PAD_SECONDS) : note.end + EDGE_PAD_SECONDS
    push(start, Math.abs(shift) < 1e-9 ? 0 : shift)
    const nextShift = next ? next.midi - next.detectedMidi : 0
    // Return to 0 after the note unless the next note follows right away (it sets its own shift).
    if (!next || next.start - note.end >= MIN_GAP_SECONDS || Math.abs(nextShift) < 1e-9) push(end, 0)
  })
  return changes
}

/** The transpose in effect at time `t`. */
export function shiftAt(schedule: ShiftChange[], t: number): number {
  let semitones = 0
  for (const c of schedule) {
    if (c.t > t) break
    semitones = c.semitones
  }
  return semitones
}

/** A change mapped onto the AudioContext clock. */
export interface TimedChange {
  output: number
  semitones: number
  /** false = stop (end of the audio). */
  active?: boolean
}

/**
 * Feeds changes to Signalsmith Stretch one at a time. Its `schedule()` keeps only the segment active at
 * `outputTime` plus later ones, so change k can only be queued once change k-1 is active
 * (context time >= its output time minus the node's output latency), with `outputTime` just after it.
 * See docs/DECISIONS.md, "Signalsmith transpose timeline uses just-in-time scheduling".
 */
export class ShiftScheduler {
  private queue: TimedChange[] = []
  private lastOutput = 0
  private readonly post: (change: TimedChange, outputTime: number) => void
  /** Output latency of the node, seconds (half of `latency()`). */
  private readonly outputLatency: number

  constructor(post: (change: TimedChange, outputTime: number) => void, outputLatency: number) {
    this.post = post
    this.outputLatency = outputLatency
  }

  /** Replaces the pending changes. `activeOutput` is the output time of the segment now in effect. */
  reset(changes: TimedChange[], activeOutput: number) {
    this.queue = changes.filter((c) => c.output > activeOutput)
    this.lastOutput = activeOutput
  }

  /** Posts every change whose predecessor is already active. Call often (every ~20 ms). */
  tick(now: number) {
    while (this.queue.length > 0 && now >= this.lastOutput - this.outputLatency) {
      const change = this.queue.shift()!
      this.post(change, this.lastOutput + 1e-6)
      this.lastOutput = change.output
    }
  }

  get pending() {
    return this.queue.length
  }
}

/** One pitch change for one voice, and the crossfades that move the sound between the two voices. */
export interface VoicePlan {
  /** Shift each voice starts with at `from`. */
  initial: [number, number]
  /** Per voice: pitch changes, each made while that voice is silent. */
  changes: [ShiftChange[], ShiftChange[]]
  /** Crossfades centred at `t`: the sound moves to voice `to`. */
  fades: { t: number; to: 0 | 1 }[]
}

/**
 * Splits a transpose timeline across two stretcher voices so neither changes pitch while it is heard.
 * Each segment plays on alternating voices; the next segment's pitch is set on the other voice right
 * after it has faded out, and a short crossfade at each boundary hands the sound over. Changing the
 * pitch of a sounding stretcher smears the jump across its analysis window, which pops on fast vocals.
 */
export function planVoices(schedule: ShiftChange[], from = 0, crossfade = CROSSFADE_SECONDS): VoicePlan {
  // Segment playing at `from`, then everything after it.
  let first = 0
  while (first + 1 < schedule.length && schedule[first + 1].t <= from) first++
  const segments = schedule.slice(first)
  const voiceOf = (k: number) => (k % 2) as 0 | 1
  const plan: VoicePlan = {
    initial: [segments[0].semitones, segments[1]?.semitones ?? 0],
    changes: [[], []],
    fades: [],
  }
  for (let k = 1; k < segments.length; k++) {
    plan.fades.push({ t: segments[k].t, to: voiceOf(k) })
    // Voice for segment k+1 last played segment k-1, which faded out around segments[k].t.
    const next = segments[k + 1]
    if (next) plan.changes[voiceOf(k + 1)].push({ t: segments[k].t + crossfade / 2, semitones: next.semitones })
  }
  return plan
}
