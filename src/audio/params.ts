/**
 * The tunable numbers of the note-detection and shift pipeline, in one place so the sweep page
 * (`sweep.html`) can vary one at a time. The app always uses `DEFAULT_PARAMS`.
 */
export interface TuningParams {
  /** Basic Pitch note onset threshold (0..1): lower finds more, shorter notes. */
  onsetThreshold: number
  /** Basic Pitch note frame threshold (0..1): lower makes notes last longer. */
  frameThreshold: number
  /** Basic Pitch minimum note length, in model frames (about 11.6 ms each). */
  minNoteFrames: number
  /** Detected fragments shorter than this are dropped. */
  minNoteSeconds: number
  /** Same-pitch or same-sung-pitch neighbours closer than this are merged into one note. */
  mergeGapSeconds: number
  /** Touching segments whose sung pitch differs by less than this are fragments of one note. */
  fragmentSemitones: number
  /** A shift starts this much before a note and ends this much after it (across gaps too long to bridge). */
  edgePadSeconds: number
  /** Gaps up to this long between notes are bridged: the shifts meet at the middle of the gap. */
  bridgeMaxGapSeconds: number
  /**
   * Across longer gaps, voiced audio (from the F0 tracker) up to this far from a note takes that note's
   * shift. Catches syllables that Basic Pitch didn't detect as notes, mostly in speech.
   */
  voicedFillMaxSeconds: number
}

export const DEFAULT_PARAMS: TuningParams = {
  // Thresholds from the Basic Pitch README.
  onsetThreshold: 0.25,
  frameThreshold: 0.25,
  minNoteFrames: 5,
  minNoteSeconds: 0.06,
  mergeGapSeconds: 0.04,
  fragmentSemitones: 0.5,
  edgePadSeconds: 0.01,
  bridgeMaxGapSeconds: 0.3,
  voicedFillMaxSeconds: 1,
}
