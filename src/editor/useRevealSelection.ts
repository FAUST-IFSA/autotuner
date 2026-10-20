import { useState } from 'react'
import type { NoteSegment } from '../types'
import { pitchToY } from './layout'
import type { Viewport } from './useViewport'

/**
 * When the selection becomes a single off-screen note (arrow keys, undo, a click), scrolls it into view.
 * Runs during render, so the first frame drawn already shows the note.
 */
export function useRevealSelection(selection: Set<string>, notes: NoteSegment[], view: Viewport) {
  const [revealed, setRevealed] = useState(selection)
  if (revealed === selection) return
  setRevealed(selection)
  const note = selection.size === 1 ? notes.find((n) => selection.has(n.id)) : undefined
  if (!note || view.viewWidth === 0) return
  const { pxPerSec, sx, sy, viewWidth, gridHeight } = view
  if (note.start * pxPerSec < sx || note.end * pxPerSec > sx + viewWidth) {
    view.scrollToX(note.start * pxPerSec - viewWidth / 3)
  }
  const y = pitchToY(note.midi)
  if (y < sy || y > sy + gridHeight) view.scrollToY(y - gridHeight / 2)
}
