import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { NoteSegment } from '../types'
import { type Edit, shiftNotes } from './edits'
import { BLOB_HALF_HEIGHT, KEYBOARD_WIDTH, ROW_HEIGHT, RULER_HEIGHT, pitchAtY, pitchToY } from './layout'

/** Pointer travel (px) before a press on a note becomes a drag. */
const DRAG_THRESHOLD = 3

interface Marquee {
  kind: 'marquee'
  x0: number
  y0: number
  x1: number
  y1: number
  additive: boolean
}
type Gesture =
  | { kind: 'drag'; startY: number; start: Map<string, number>; active: boolean; edit: Edit; grabbed: NoteSegment }
  | Marquee

interface Options {
  containerRef: RefObject<HTMLDivElement | null>
  notes: NoteSegment[]
  selection: Set<string>
  snap: boolean
  pxPerSec: number
  sx: number
  sy: number
  onSelectionChange: (selection: Set<string>) => void
  onSeek: (seconds: number) => void
  onPreview: (edit: Edit) => void
  onCommit: (edit: Edit) => void
  onGrab: (note: NoteSegment) => void
  onGrabShift: (semitones: number) => void
  onRelease: () => void
}

/** Shift, Cmd and Ctrl all add to (or toggle) the selection. */
const isAdditive = (e: ReactPointerEvent) => e.shiftKey || e.metaKey || e.ctrlKey

/** The note under a content point: the closest whose pitch line is within reach. */
function noteAt(notes: NoteSegment[], pxPerSec: number, x: number, y: number) {
  const t = x / pxPerSec
  const reach = BLOB_HALF_HEIGHT / ROW_HEIGHT
  let best: NoteSegment | null = null
  for (const n of notes) {
    if (t < n.start || t > n.end) continue
    const distance = Math.abs(pitchAtY(y) - n.midi)
    if (distance <= reach && (!best || distance < Math.abs(pitchAtY(y) - best.midi))) best = n
  }
  return best
}

/** The selection a released marquee makes, or null to leave it alone (an additive click). */
function marqueeSelection(marquee: Marquee, notes: NoteSegment[], pxPerSec: number, selection: Set<string>) {
  const { x0, y0, x1, y1, additive } = marquee
  const moved = Math.abs(x1 - x0) > DRAG_THRESHOLD || Math.abs(y1 - y0) > DRAG_THRESHOLD
  if (!moved) return additive ? null : new Set<string>()
  const [t0, t1] = [Math.min(x0, x1) / pxPerSec, Math.max(x0, x1) / pxPerSec]
  const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)]
  const next = new Set(additive ? selection : [])
  for (const n of notes) {
    const cy = pitchToY(n.midi)
    if (n.end >= t0 && n.start <= t1 && cy + ROW_HEIGHT / 2 >= top && cy - ROW_HEIGHT / 2 <= bottom) next.add(n.id)
  }
  return next
}

function cursorFor(gesture: Gesture | null, hovered: string | null) {
  if ((gesture?.kind === 'drag' && gesture.active) || (hovered && !gesture)) return 'ns-resize'
  if (gesture?.kind === 'marquee') return 'crosshair'
  return 'default'
}

/**
 * Pointer input on the editor: click the ruler to seek; press a note to select it and drag it (and the
 * rest of the selection) in pitch; drag on empty space for a box selection; hover a note to label it.
 */
export function useNoteGestures({
  containerRef,
  notes,
  selection,
  snap,
  pxPerSec,
  sx,
  sy,
  onSelectionChange,
  onSeek,
  onPreview,
  onCommit,
  onGrab,
  onGrabShift,
  onRelease,
}: Options) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)

  /** Pointer position in grid content coordinates; inGrid is false over the ruler or keyboard. */
  const toContent = (e: ReactPointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const vx = e.clientX - rect.left - KEYBOARD_WIDTH
    const vy = e.clientY - rect.top - RULER_HEIGHT
    return { x: vx + sx, y: vy + sy, inGrid: vx >= 0 && vy >= 0, onRuler: vx >= 0 && vy < 0 }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const { x, y, inGrid, onRuler } = toContent(e)
    if (onRuler) {
      onSeek(x / pxPerSec)
      return
    }
    if (!inGrid) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const additive = isAdditive(e)
    const hit = noteAt(notes, pxPerSec, x, y)

    if (!hit) {
      setGesture({ kind: 'marquee', x0: x, y0: y, x1: x, y1: y, additive })
      return
    }
    let next = selection
    if (additive) {
      next = new Set(selection)
      if (next.has(hit.id)) next.delete(hit.id)
      else next.add(hit.id)
      onSelectionChange(next)
      if (!next.has(hit.id)) return
    } else if (!selection.has(hit.id)) {
      next = new Set([hit.id])
      onSelectionChange(next)
    }
    const start = new Map(notes.filter((n) => next.has(n.id)).map((n) => [n.id, n.midi]))
    setGesture({ kind: 'drag', startY: y, start, active: false, edit: [], grabbed: hit })
    onGrab(hit)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const { x, y, inGrid } = toContent(e)
    if (!gesture) {
      const hit = inGrid ? noteAt(notes, pxPerSec, x, y) : null
      if ((hit?.id ?? null) !== hovered) setHovered(hit?.id ?? null)
      return
    }
    if (gesture.kind === 'marquee') {
      setGesture({ ...gesture, x1: x, y1: y })
      return
    }
    const dy = y - gesture.startY
    if (!gesture.active && Math.abs(dy) < DRAG_THRESHOLD) return
    // Alt (Option) temporarily switches to fine, unsnapped moves.
    const edit = shiftNotes(gesture.start, -dy / ROW_HEIGHT, snap && !e.altKey)
    setGesture({ ...gesture, active: true, edit })
    onPreview(edit)
    const grabbed = edit.find((c) => c.id === gesture.grabbed.id)
    if (grabbed) onGrabShift(grabbed.to - gesture.grabbed.detectedMidi)
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!gesture) return
    setGesture(null)
    if (gesture.kind === 'drag') {
      onRelease()
      if (gesture.active) onCommit(gesture.edit)
      // A plain click on a note in a multi-selection selects just that note.
      else if (!isAdditive(e) && selection.size > 1) {
        const { x, y } = toContent(e)
        const hit = noteAt(notes, pxPerSec, x, y)
        if (hit) onSelectionChange(new Set([hit.id]))
      }
      return
    }
    const next = marqueeSelection(gesture, notes, pxPerSec, selection)
    if (next) onSelectionChange(next)
  }

  const pointerHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      // The browser took the pointer mid-drag: keep the pitch the note was moved to, and record it so
      // Undo can revert it (it's already applied as a preview).
      if (gesture?.kind === 'drag') {
        onRelease()
        if (gesture.active) onCommit(gesture.edit)
      }
      setGesture(null)
    },
    onPointerLeave: () => !gesture && setHovered(null),
  }
  const marquee = gesture?.kind === 'marquee' ? gesture : null
  return { hovered, marquee, cursor: cursorFor(gesture, hovered), pointerHandlers }
}
