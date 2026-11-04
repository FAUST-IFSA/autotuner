// Ways of turning the notes' shifts into a transpose timeline, compared by ear on the dev compare page
// (compare.html). "today" is what playback and export do now (buildSchedule); the others are candidates.
import { type ShiftChange, buildSchedule, shiftAt } from '../audio/schedule'
import type { F0Curve, MusicalKey, NoteSegment, TimeSpan } from '../types'

export interface Variant {
  id: string
  name: string
  description: string
  /** No tuning at all: the reference. */
  original?: boolean
  /** Seconds a shift takes to change at a note edge; 0 switches instantly (today). */
  glide: number
  /** Only shift voiced audio: consonants and breaths stay as sung. */
  sungOnly: boolean
  /** Signalsmith analysis block; undefined keeps the library default (about 120 ms). */
  blockMs?: number
  /** Give formant correction the singer's typical pitch instead of letting it track pitch itself. */
  fixedFormantBase?: boolean
}

export const VARIANTS: Variant[] = [
  { id: 'original', name: 'Original', description: 'No tuning.', original: true, glide: 0, sungOnly: false },
  {
    id: 'today',
    name: 'Today',
    description:
      "What the app does now: each note's shift switches instantly, at the middle of short gaps, and carries " +
      'through sound between notes.',
    glide: 0,
    sungOnly: false,
  },
  {
    id: 'glide',
    name: 'Glides',
    description: 'Shifts change over 60 ms at note edges instead of instantly.',
    glide: 0.06,
    sungOnly: false,
  },
  {
    id: 'sung',
    name: 'Glides + sung parts only',
    description: 'As Glides, and consonants and breaths (unvoiced audio) are left unshifted.',
    glide: 0.06,
    sungOnly: true,
  },
  {
    id: 'long-glide',
    name: 'Long glides + sung parts only',
    description: 'As above with 120 ms glides: smoother, but quick runs may blur.',
    glide: 0.12,
    sungOnly: true,
  },
  {
    id: 'block',
    name: 'Glides + sung parts + 80 ms block',
    description: 'As "Glides + sung parts only", with an 80 ms analysis block: sharper changes and vibrato.',
    glide: 0.06,
    sungOnly: true,
    blockMs: 80,
  },
  {
    id: 'formant',
    name: 'Glides + sung parts + fixed formant base',
    description: 'As "Glides + sung parts only", telling formant correction the singer\'s typical pitch.',
    glide: 0.06,
    sungOnly: true,
    fixedFormantBase: true,
  },
]

/** Time step the smoothed timelines are sampled at. */
const STEP = 0.005
/** Unvoiced gaps shorter than this inside sung audio are pitch-tracker dropouts, not consonants. */
const MAX_DROPOUT = 0.08
/** Voiced/unvoiced edges fade the shift over this long, so it never jumps. */
const VOICED_FADE = 0.02
/** Changes smaller than this (1 cent) aren't sent. */
const MIN_CHANGE = 0.01

/** Centred moving average over `width` samples (a box filter), so a step becomes a ramp `width` long. */
export function boxSmooth(values: Float64Array, width: number): Float64Array {
  if (width <= 1) return values
  const prefix = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i]
  const half = Math.floor(width / 2)
  return values.map((_, i) => {
    const a = Math.max(0, i - half)
    const b = Math.min(values.length, i - half + width)
    return (prefix[b] - prefix[a]) / (b - a)
  })
}

/** 1 where the F0 curve is voiced (short dropouts filled), 0 elsewhere, sampled every `step` seconds. */
export function voicedMask(f0: F0Curve, length: number, step = STEP): Float64Array {
  const voiced = f0.midi.map((m) => m !== null)
  const maxGap = Math.round(MAX_DROPOUT / f0.hopSec)
  for (let i = 0; i < voiced.length; i++) {
    if (voiced[i] || i === 0 || !voiced[i - 1]) continue
    let j = i
    while (j < voiced.length && !voiced[j]) j++
    if (j < voiced.length && j - i <= maxGap) voiced.fill(true, i, j)
    i = j
  }
  return Float64Array.from({ length }, (_, k) => (voiced[Math.round((k * step) / f0.hopSec)] ? 1 : 0))
}

/** The transpose timeline for `variant` over `duration` seconds. `audible` as in Project (see buildSchedule). */
export function variantSchedule(
  notes: NoteSegment[],
  f0: F0Curve,
  variant: Variant,
  duration: number,
  audible: TimeSpan[] = [],
): ShiftChange[] {
  const steps = buildSchedule(notes, audible)
  if (variant.original) return [{ t: 0, semitones: 0 }]
  if (variant.glide === 0 && !variant.sungOnly) return steps
  const length = Math.ceil(duration / STEP) + 1
  const sampled = Float64Array.from({ length }, (_, k) => shiftAt(steps, k * STEP))
  const shift = boxSmooth(sampled, Math.round(variant.glide / STEP))
  const mask = variant.sungOnly ? boxSmooth(voicedMask(f0, length), Math.round(VOICED_FADE / STEP)) : null
  const at = (k: number) => {
    const semitones = shift[k] * (mask?.[k] ?? 1)
    return Math.abs(semitones) < 1e-6 ? 0 : semitones
  }
  const out: ShiftChange[] = [{ t: 0, semitones: at(0) }]
  for (let k = 1; k < length; k++) {
    const semitones = at(k)
    const last = out[out.length - 1].semitones
    // Send changes of a cent or more, and always land exactly on 0 where a shift fades out.
    if (Math.abs(semitones - last) >= MIN_CHANGE || (semitones === 0 && last !== 0))
      out.push({ t: k * STEP, semitones })
  }
  return out
}

/**
 * Every note moved to the nearest note of `key` (natural minor for minor keys): bigger moves than Tune Up,
 * up to a semitone, like fixing notes sung on the wrong pitch. For comparing by ear only.
 */
export function snapToKey(notes: NoteSegment[], key: MusicalKey): NoteSegment[] {
  const scale = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
  const inKey = (midi: number) => scale.includes((((midi - key.tonic) % 12) + 12) % 12)
  return notes.map((note) => {
    let best = Math.round(note.detectedMidi)
    for (let midi = Math.floor(note.detectedMidi) - 1; midi <= Math.ceil(note.detectedMidi) + 1; midi++) {
      const closer = Math.abs(midi - note.detectedMidi) < Math.abs(best - note.detectedMidi)
      if (inKey(midi) && (!inKey(best) || closer)) best = midi
    }
    return { ...note, midi: best }
  })
}
