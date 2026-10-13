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
  /** MIDI note the segment was detected at. */
  originalMidi: number
  /** MIDI note the user wants the segment corrected to. */
  midi: number
}

export interface Project {
  fileName: string
  buffer: AudioBuffer
  peaks: Peaks
  notes: NoteSegment[]
}
