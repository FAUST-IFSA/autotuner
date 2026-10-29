import { useCallback, useEffect } from 'react'
import type { AudioEngine } from '../audio/AudioEngine'
import type { NoteSegment } from '../types'

/**
 * The editor's side of the audio engine: keeps it playing the current notes (and quiet while the editor
 * is covered), and turns transport buttons, shortcuts and note grabs into engine calls. Every action
 * does nothing while there is no engine.
 */
export function usePlayback(engine: AudioEngine | null, notes: NoteSegment[], suspended: boolean) {
  // Covered by the Downloaded screen: stop the sound.
  useEffect(() => {
    if (suspended) engine?.pause()
  }, [suspended, engine])

  // Playback follows edits as they happen, including mid-drag.
  useEffect(() => engine?.setNotes(notes), [engine, notes])

  const togglePlay = useCallback(() => {
    if (!engine) return
    if (engine.isPlaying) engine.pause()
    else void engine.play()
  }, [engine])
  const seek = useCallback((seconds: number) => engine?.seek(seconds), [engine])
  /** Next (or previous) note start from the playhead: what < and > and the skip buttons jump to. */
  const skip = useCallback(
    (direction: 1 | -1) => {
      if (!engine) return
      const now = engine.currentTime
      const target =
        direction === 1
          ? notes.find((n) => n.start > now + 0.01)?.start
          : // A little slack so pressing rewind at a note's start goes to the note before it.
            notes.findLast((n) => n.start < now - 0.15)?.start
      seek(target ?? (direction === 1 ? now : 0))
    },
    [engine, notes, seek],
  )
  const toStart = useCallback(() => seek(0), [seek])

  // Clicking a note plays it on a loop until release (pausing and resuming playback around it).
  const grab = useCallback((note: NoteSegment) => void engine?.startPreview(note), [engine])
  const grabShift = useCallback((semitones: number) => engine?.updatePreview(semitones), [engine])
  const release = useCallback(() => engine?.stopPreview(), [engine])
  /** Plays a note once at its current pitch (after a keyboard nudge). */
  const playNote = useCallback((note: NoteSegment) => void engine?.playNote(note), [engine])

  return { togglePlay, seek, skip, toStart, grab, grabShift, release, playNote }
}
