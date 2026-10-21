export const KEYBOARD_WIDTH = 56
export const RULER_HEIGHT = 24
export const ROW_HEIGHT = 22
/** Blobs extend past their own row so the waveform shape stays readable. */
export const BLOB_HALF_HEIGHT = ROW_HEIGHT * 1.25

/** C2 to C6. */
export const MIDI_MIN = 36
export const MIDI_MAX = 84
export const GRID_HEIGHT = (MIDI_MAX - MIDI_MIN + 1) * ROW_HEIGHT

export const MIN_PX_PER_SEC = 5
export const MAX_PX_PER_SEC = 2000

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Top edge of the row for a MIDI note, in grid content coordinates. */
export const midiToY = (midi: number) => (MIDI_MAX - midi) * ROW_HEIGHT

/** Fractional pitch at a grid content y (row centres are whole semitones). */
export const pitchAtY = (y: number) => MIDI_MAX + 0.5 - y / ROW_HEIGHT

/** Grid content y of a (fractional) pitch's centre line. */
export const pitchToY = (midi: number) => midiToY(midi) + ROW_HEIGHT / 2

export const midiName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

export const isBlackKey = (midi: number) => NOTE_NAMES[midi % 12].includes('#')

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const TIME_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]

/** A time grid step that keeps grid lines at least ~80px apart. */
export const timeStep = (pxPerSec: number) =>
  TIME_STEPS.find((step) => step * pxPerSec >= 80) ?? TIME_STEPS[TIME_STEPS.length - 1]
