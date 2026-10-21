import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useAudioEngine } from '../audio/useAudioEngine'
import { ControlsMenu } from '../components/ControlsMenu'
import { ExportBar } from '../components/ExportBar'
import { Transport } from '../components/Transport'
import { isEdited, isOffPitch, resetNotes, tuneUp } from '../editor/edits'
import { PitchEditor } from '../editor/PitchEditor'
import type { NoteSegment, Project } from '../types'
import { useEditHistory } from './useEditHistory'
import { useEditorShortcuts } from './useEditorShortcuts'
import { usePlayback } from './usePlayback'

interface Props {
  project: Project
  onNotesChange: (update: (notes: NoteSegment[]) => NoteSegment[]) => void
  onReset: () => void
  onExported: (fileName: string) => void
  /** Covered by another screen: keyboard shortcuts are off. */
  suspended?: boolean
}

// Mouse clicks don't leave focus on buttons, so Space keeps meaning play/pause after a click.
const keepFocusOffButtons = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button')) e.preventDefault()
}

function tuneUpTitle(offPitchCount: number) {
  if (offPitchCount === 0) return 'Every note is within 10 cents of a semitone'
  return `Move ${offPitchCount} off-pitch ${offPitchCount === 1 ? 'note' : 'notes'} to the nearest semitone`
}

export function EditorScreen({ project, onNotesChange, onReset, onExported, suspended = false }: Props) {
  const { notes } = project
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [snap, setSnap] = useState(true)
  const { preview, commit, apply, step, canUndo, canRedo } = useEditHistory(onNotesChange, setSelection)
  const { engine, playing, error: audioError } = useAudioEngine(project.buffer)
  const { togglePlay, seek, skip, toStart, grab, grabShift, release, playNote } = usePlayback(engine, notes, suspended)
  useEditorShortcuts({
    enabled: !suspended,
    notes,
    selection,
    snap,
    setSelection,
    apply,
    step,
    togglePlay,
    skip,
    toStart,
    playNote,
  })

  const offPitchCount = notes.filter(isOffPitch).length

  const resetTarget = selection.size > 0 ? selection : new Set(notes.map((n) => n.id))
  const canReset = notes.some((n) => resetTarget.has(n.id) && isEdited(n))

  return (
    <main className="editor-screen" onMouseDown={keepFocusOffButtons}>
      <header className="editor-header">
        <button type="button" onClick={onReset}>
          ← New file
        </button>
        <Transport
          engine={engine}
          playing={playing}
          disabled={!engine}
          duration={project.buffer.duration}
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
        {project.approximateNotes && (
          <span className="notice" role="status">
            Note detection was unavailable, so these notes are approximate. Reload and try again.
          </span>
        )}
        <div className="editor-tools">
          <button
            type="button"
            className="tune-up"
            onClick={() => apply(tuneUp(notes))}
            disabled={offPitchCount === 0}
            title={tuneUpTitle(offPitchCount)}
          >
            Tune Up
          </button>
          <label className="toggle">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Snap to semitone
          </label>
          <button type="button" onClick={() => step('undo')} disabled={!canUndo} title="Undo (Ctrl/⌘ Z)">
            Undo
          </button>
          <button type="button" onClick={() => step('redo')} disabled={!canRedo} title="Redo (Shift Ctrl/⌘ Z)">
            Redo
          </button>
          <button type="button" onClick={() => apply(resetNotes(notes, resetTarget))} disabled={!canReset}>
            {selection.size > 0 ? 'Reset selected' : 'Reset all'}
          </button>
        </div>
        {audioError && <span className="error">Playback isn't available: {audioError}</span>}
        <ControlsMenu />
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
        engine={engine}
        playing={playing}
        onSeek={seek}
        onGrab={grab}
        onGrabShift={grabShift}
        onRelease={release}
        shortcutsEnabled={!suspended}
      />
      <ExportBar project={project} onExported={onExported} />
    </main>
  )
}
