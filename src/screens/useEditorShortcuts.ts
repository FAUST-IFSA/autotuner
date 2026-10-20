import { useEffect, useEffectEvent } from 'react'
import { type Edit, nudgeNotes, resetNotes } from '../editor/edits'
import type { NoteSegment } from '../types'

interface Options {
  /** Off while another screen covers the editor. */
  enabled: boolean
  notes: NoteSegment[]
  selection: Set<string>
  snap: boolean
  setSelection: (selection: Set<string>) => void
  apply: (edit: Edit) => void
  step: (direction: 'undo' | 'redo') => void
  togglePlay: () => void
  skip: (direction: 1 | -1) => void
  toStart: () => void
  playNote: (note: NoteSegment) => void
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox'))

/** Index of the note after (or before) the selection; notes are in time order. */
function neighbourIndex(notes: NoteSegment[], selection: Set<string>, direction: 1 | -1) {
  const indices = notes.flatMap((n, i) => (selection.has(n.id) ? [i] : []))
  if (direction === 1) return indices.length ? Math.min(notes.length - 1, indices[indices.length - 1] + 1) : 0
  return indices.length ? Math.max(0, indices[0] - 1) : notes.length - 1
}

/** The editor's keyboard shortcuts, listened for on the window. */
export function useEditorShortcuts({
  enabled,
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
}: Options) {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    // A button reached with Tab keeps Space/Enter for itself.
    if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLButtonElement) return
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
      if (moved) playNote({ ...moved, midi: edit[0].to })
    } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // Notes are in time order: step to the neighbour of the selection.
      const next = notes[neighbourIndex(notes, selection, e.key === 'ArrowRight' ? 1 : -1)]
      if (next) setSelection(new Set([next.id]))
    }
    // < and > move the playhead (also , and . so Shift isn't needed).
    else if (!mod && (e.key === '<' || e.key === ',')) skip(-1)
    else if (!mod && (e.key === '>' || e.key === '.')) skip(1)
    else if (e.key === 'Enter') toStart()
    else if ((e.key === 'Backspace' || e.key === 'Delete') && selection.size > 0) {
      apply(resetNotes(notes, selection))
    } else return
    e.preventDefault()
  })

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
