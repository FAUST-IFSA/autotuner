export interface Peaks {
  min: Float32Array
  max: Float32Array
  samplesPerBin: number
  sampleRate: number
  /** Largest absolute sample value, used to normalise drawing. */
  peak: number
}

export interface NoteSegment {
  id: string
  /** Seconds. */
  start: number
  /** Seconds. */
  end: number
  /** MIDI note the segment was detected at (nearest semitone to `detectedMidi`). */
  originalMidi: number
  /** MIDI note the user wants the segment corrected to. */
  midi: number
  /** Sung pitch, fractional MIDI: median of the voiced F0 frames inside the note. */
  detectedMidi: number
}

export interface F0Curve {
  /** Seconds between frames. */
  hopSec: number
  /** Fractional MIDI per frame; null = unvoiced. */
  midi: (number | null)[]
  /** 0..1 per frame. */
  clarity: number[]
}

export interface Project {
  fileName: string
  buffer: AudioBuffer
  peaks: Peaks
  notes: NoteSegment[]
  f0: F0Curve
}
