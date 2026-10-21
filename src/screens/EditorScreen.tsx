import { useCallback, useEffect, useState } from 'react'
import { ExportBar } from '../components/ExportBar'
import {
  type Edit,
  type History,
  applyEdit,
  effective,
  emptyHistory,
  isEdited,
  nudgeNotes,
  record,
  redo,
  resetNotes,
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

  const resetTarget = selection.size > 0 ? selection : new Set(notes.map((n) => n.id))
  const canReset = notes.some((n) => resetTarget.has(n.id) && isEdited(n))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') step(e.shiftKey ? 'redo' : 'undo')
      else if (mod && key === 'y') step('redo')
      else if (mod && key === 'a') setSelection(new Set(notes.map((n) => n.id)))
      else if (e.key === 'Escape') setSelection(new Set())
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selection.size > 0) {
        apply(nudgeNotes(notes, selection, e.key === 'ArrowUp' ? 1 : -1, snap && !e.altKey))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Notes are in time order: step to the neighbour of the selection.
        const indices = notes.flatMap((n, i) => (selection.has(n.id) ? [i] : []))
        const next =
          e.key === 'ArrowRight'
            ? indices.length ? Math.min(notes.length - 1, indices[indices.length - 1] + 1) : 0
            : indices.length ? Math.max(0, indices[0] - 1) : notes.length - 1
        if (notes[next]) setSelection(new Set([notes[next].id]))
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selection.size > 0) {
        apply(resetNotes(notes, selection))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [notes, selection, snap, apply, step])

  return (
    <main className="editor-screen">
      <header className="editor-header">
        <button type="button" onClick={onReset}>
          ← New file
        </button>
        <span className="file-name">{project.fileName}</span>
        <span className="file-meta">
          {project.buffer.duration.toFixed(1)}s · {notes.length} notes
          {selection.size > 0 && ` · ${selection.size} selected`}
        </span>
        <div className="editor-tools">
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
        <span className="hint">
          Drag notes to retune · Alt for fine steps · Drag empty space to select · Ctrl + scroll to zoom
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
      />
      <ExportBar project={project} />
    </main>
  )
}
