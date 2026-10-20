import { useCallback, useState } from 'react'
import { type Edit, type History, applyEdit, effective, emptyHistory, record, redo, undo } from '../editor/edits'
import type { NoteSegment } from '../types'

type NotesUpdate = (update: (notes: NoteSegment[]) => NoteSegment[]) => void

/**
 * Pitch edits with undo and redo. Edits are absolute (from/to pitches), so undoing one restores exactly
 * what it replaced. Undo and redo select the notes they touched.
 */
export function useEditHistory(onNotesChange: NotesUpdate, setSelection: (selection: Set<string>) => void) {
  const [history, setHistory] = useState<History>(emptyHistory)

  /** Shows an edit without recording it (a drag in progress). */
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
    [history, onNotesChange, setSelection],
  )

  return { preview, commit, apply, step, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }
}
