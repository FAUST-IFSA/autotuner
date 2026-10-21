import { useCallback, useEffect, useState } from 'react'
import { useAudioEngine } from '../audio/useAudioEngine'
import { ExportBar } from '../components/ExportBar'
import { Transport } from '../components/Transport'
import {
  type Edit,
  type History,
  applyEdit,
  effective,
  emptyHistory,
  isEdited,
  isOffPitch,
  nudgeNotes,
  record,
  redo,
  resetNotes,
  tuneUp,
  undo,
} from '../editor/edits'
import { PitchEditor } from '../editor/PitchEditor'
import type { NoteSegment, Project } from '../types'

interface Props {
  project: Project
  onNotesChange: (update: (notes: NoteSegment[]) => NoteSegment[]) => void
  onReset: () => void
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox'))

export function EditorScreen({ project, onNotesChange, onReset }: Props) {
  const { notes } = project
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [snap, setSnap] = useState(true)
  const [history, setHistory] = useState<History>(emptyHistory)
  const { engine, playing, error: audioError } = useAudioEngine(project.buffer)
  const [playheadRevision, setPlayheadRevision] = useState(0)

  // Playback follows edits as they happen, including mid-drag.
  useEffect(() => engine?.setNotes(notes), [engine, notes])

  const getTime = useCallback(() => engine?.currentTime ?? 0, [engine])
  const togglePlay = useCallback(() => {
    if (!engine) return
    if (engine.isPlaying) engine.pause()
    else void engine.play()
  }, [engine])
  const seek = useCallback(
    (seconds: number) => {
      engine?.seek(seconds)
      setPlayheadRevision((r) => r + 1)
    },
    [engine],
  )
  /** Next (or previous) note start from the playhead: what the arrow keys and skip buttons jump to. */
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

  const preview = useCallback((edit: Edit) => onNotesChange((n) => applyEdit(n, edit)), [onNotesChange])

  /** Records an edit whose result the notes already show (the end of a drag). */
  const commit = useCallback((edit: Edit) => {
    const changed = effective(edit)
    if (changed) setHistory((h) => record(h, changed))
  }, [])

  const apply = useCallback(
    (edit: Edit) => {
      const changed = effective(edit)
      if (!changed) return
      onNotesChange((n) => applyEdit(n, changed))
      setHistory((h) => record(h, changed))
    },
    [onNotesChange],
  )

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      const [next, edit] = direction === 'undo' ? undo(history) : redo(history)
      if (!edit) return
      setHistory(next)
      onNotesChange((n) => applyEdit(n, edit, direction === 'undo' ? 'from' : 'to'))
      setSelection(new Set(edit.map((c) => c.id)))
    },
    [history, onNotesChange],
  )

  const offPitchCount = notes.filter(isOffPitch).length

  const resetTarget = selection.size > 0 ? selection : new Set(notes.map((n) => n.id))
  const canReset = notes.some((n) => resetTarget.has(n.id) && isEdited(n))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (e.key === ' ' && !mod) togglePlay()
      else if (mod && key === 'z') step(e.shiftKey ? 'redo' : 'undo')
      else if (mod && key === 'y') step('redo')
      else if (mod && key === 'a') setSelection(new Set(notes.map((n) => n.id)))
      else if (e.key === 'Escape') setSelection(new Set())
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selection.size > 0) {
        const edit = nudgeNotes(notes, selection, e.key === 'ArrowUp' ? 1 : -1, snap && !e.altKey)
        apply(edit)
        // Play the (first) moved note again at its new pitch.
        const moved = notes.find((n) => n.id === edit[0]?.id)
        if (moved) void engine?.playNote({ ...moved, midi: edit[0].to })
      } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Notes are in time order: step to the neighbour of the selection.
        const indices = notes.flatMap((n, i) => (selection.has(n.id) ? [i] : []))
        const next =
          e.key === 'ArrowRight'
            ? indices.length ? Math.min(notes.length - 1, indices[indices.length - 1] + 1) : 0
            : indices.length ? Math.max(0, indices[0] - 1) : notes.length - 1
        if (notes[next]) setSelection(new Set([notes[next].id]))
      }
      // < and > move the playhead (also , and . so Shift isn't needed).
      else if (!mod && (e.key === '<' || e.key === ',')) skip(-1)
      else if (!mod && (e.key === '>' || e.key === '.')) skip(1)
      else if (e.key === 'Enter') toStart()
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selection.size > 0) {
        apply(resetNotes(notes, selection))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [notes, selection, snap, apply, step, togglePlay, skip, toStart, engine])

  return (
    <main className="editor-screen">
      <header className="editor-header">
        <button type="button" onClick={onReset}>
          ← New file
        </button>
        <Transport
          playing={playing}
          revision={playheadRevision}
          disabled={!engine}
          duration={project.buffer.duration}
          getTime={getTime}
          onToggle={togglePlay}
          onToStart={toStart}
          onRewind={() => skip(-1)}
          onFastForward={() => skip(1)}
        />
        <span className="file-name">{project.fileName}</span>
        <span className="file-meta">
          {project.buffer.duration.toFixed(1)}s · {notes.length} notes
          {selection.size > 0 && ` · ${selection.size} selected`}
        </span>
        <div className="editor-tools">
          <button
            type="button"
            className="tune-up"
            onClick={() => apply(tuneUp(notes))}
            disabled={offPitchCount === 0}
            title={
              offPitchCount === 0
                ? 'Every note is within 10 cents of a semitone'
                : `Move ${offPitchCount} off-pitch ${offPitchCount === 1 ? 'note' : 'notes'} to the nearest semitone`
            }
          >
            Tune Up
          </button>
          <label className="toggle">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Snap to semitone
          </label>
          <button type="button" onClick={() => step('undo')} disabled={history.past.length === 0} title="Undo (Ctrl/⌘ Z)">
            Undo
          </button>
          <button
            type="button"
            onClick={() => step('redo')}
            disabled={history.future.length === 0}
            title="Redo (Shift Ctrl/⌘ Z)"
          >
            Redo
          </button>
          <button type="button" onClick={() => apply(resetNotes(notes, resetTarget))} disabled={!canReset}>
            {selection.size > 0 ? 'Reset selected' : 'Reset all'}
          </button>
        </div>
        {audioError && <span className="error">Playback isn't available: {audioError}</span>}
        <span className="hint">
          Space play · Enter to start · &lt; &gt; previous/next note · ←/→ select notes · Drag notes to retune (Alt for fine steps) · Drag empty space to select · ⌘/Ctrl + scroll or ⌘/Ctrl + ←/→ to zoom
        </span>
      </header>
      <PitchEditor
        peaks={project.peaks}
        notes={notes}
        f0={project.f0}
        duration={project.buffer.duration}
        selection={selection}
        snap={snap}
        onSelectionChange={setSelection}
        onPreview={preview}
        onCommit={commit}
        getTime={getTime}
        playing={playing}
        playheadRevision={playheadRevision}
        onSeek={seek}
        onGrab={grab}
        onGrabShift={grabShift}
        onRelease={release}
      />
      <ExportBar project={project} />
    </main>
  )
}
