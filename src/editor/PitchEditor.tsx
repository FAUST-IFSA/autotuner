import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Group, Layer, Rect, Stage } from 'react-konva'
import type { F0Curve as Curve, NoteSegment, Peaks } from '../types'
import { type Edit, shiftNotes, shiftOf } from './edits'
import { F0Curve } from './F0Curve'
import { NoteBlob } from './NoteBlob'
import { Playhead } from './Playhead'
import { Keyboard, PitchGrid } from './PitchGrid'
import { TimeRuler } from './TimeRuler'
import {
  BLOB_HALF_HEIGHT,
  GRID_HEIGHT,
  KEYBOARD_WIDTH,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  ROW_HEIGHT,
  RULER_HEIGHT,
  clamp,
  pitchAtY,
  pitchToY,
} from './layout'

interface Props {
  peaks: Peaks
  notes: NoteSegment[]
  f0: Curve
  duration: number
  selection: Set<string>
  snap: boolean
  onSelectionChange: (selection: Set<string>) => void
  /** Live update while dragging; not recorded in undo history. */
  onPreview: (edit: Edit) => void
  /** The whole drag as one undoable step (notes already show its result). */
  onCommit: (edit: Edit) => void
  /** Playback position and state, for the playhead. */
  getTime: () => number
  playing: boolean
  playheadRevision: number
  /** Click on the time ruler. */
  onSeek: (seconds: number) => void
  /** Drag preview: a note was grabbed, its shift changed, it was released. */
  onGrab: (note: NoteSegment) => void
  onGrabShift: (semitones: number) => void
  onRelease: () => void
}

/** Pointer travel (px) before a press on a note becomes a drag. */
const DRAG_THRESHOLD = 3

type Gesture =
  | { kind: 'drag'; startY: number; start: Map<string, number>; active: boolean; edit: Edit; grabbed: NoteSegment }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }

export function PitchEditor({
  peaks,
  notes,
  f0,
  duration,
  selection,
  snap,
  onSelectionChange,
  onPreview,
  onCommit,
  getTime,
  playing,
  playheadRevision,
  onSeek,
  onGrab,
  onGrabShift,
  onRelease,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(containerRef.current!)
    return () => observer.disconnect()
  }, [])

  // null means "not touched yet": fit the whole file and centre on the sung range.
  const [zoom, setZoom] = useState<number | null>(null)
  const [scrollX, setScrollX] = useState(0)
  const [scrollY, setScrollY] = useState<number | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)

  const viewWidth = Math.max(0, width - KEYBOARD_WIDTH)
  const gridHeight = Math.max(0, height - RULER_HEIGHT)
  const pxPerSec = zoom ?? clamp(viewWidth / duration, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
  const maxScrollX = Math.max(0, duration * pxPerSec - viewWidth)
  const maxScrollY = Math.max(0, GRID_HEIGHT - gridHeight)
  // Fit to the notes as analysed, once; later edits don't move the view.
  const [sungCentre] = useState(() => {
    if (notes.length === 0) return 60
    const pitches = notes.map((n) => n.detectedMidi)
    return (Math.min(...pitches) + Math.max(...pitches)) / 2
  })
  const sx = clamp(scrollX, 0, maxScrollX)
  const sy = clamp(scrollY ?? pitchToY(sungCentre) - gridHeight / 2, 0, maxScrollY)

  // Semitone shift per F0 frame, so the curve moves with edited notes.
  const shifts = useMemo(() => {
    const out = new Float32Array(f0.midi.length)
    for (const n of notes) {
      const shift = shiftOf(n)
      if (shift === 0) continue
      out.fill(shift, Math.max(0, Math.ceil(n.start / f0.hopSec)), Math.floor(n.end / f0.hopSec) + 1)
    }
    return out
  }, [notes, f0])

  // When the selection becomes a single off-screen note (arrow keys), scroll it into view.
  const [revealed, setRevealed] = useState(selection)
  if (revealed !== selection) {
    setRevealed(selection)
    const note = selection.size === 1 ? notes.find((n) => selection.has(n.id)) : undefined
    if (note && viewWidth > 0) {
      if (note.start * pxPerSec < sx || note.end * pxPerSec > sx + viewWidth) {
        setScrollX(clamp(note.start * pxPerSec - viewWidth / 3, 0, maxScrollX))
      }
      const y = pitchToY(note.midi)
      if (y < sy || y > sy + gridHeight) setScrollY(clamp(y - gridHeight / 2, 0, maxScrollY))
    }
  }

  // The view chases the playhead until the user scrolls or zooms; playing or jumping turns it back on.
  const following = useRef(true)
  useEffect(() => {
    following.current = true
  }, [playing, playheadRevision])

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    following.current = false
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt

    if (ctrlKey || metaKey) {
      const pointerX = (e.target.getStage()?.getPointerPosition()?.x ?? KEYBOARD_WIDTH) - KEYBOARD_WIDTH
      const anchorTime = (sx + Math.max(0, pointerX)) / pxPerSec
      const nextPxPerSec = clamp(pxPerSec * Math.exp(-deltaY * 0.002), MIN_PX_PER_SEC, MAX_PX_PER_SEC)
      setZoom(nextPxPerSec)
      setScrollX(anchorTime * nextPxPerSec - Math.max(0, pointerX))
      return
    }

    setScrollX(clamp(sx + (shiftKey ? deltaY : deltaX), 0, maxScrollX))
    if (!shiftKey) setScrollY(clamp(sy + deltaY, 0, maxScrollY))
  }

  /** Pointer position in grid content coordinates, or null over the ruler or keyboard. */
  const toContent = (e: ReactPointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const vx = e.clientX - rect.left - KEYBOARD_WIDTH
    const vy = e.clientY - rect.top - RULER_HEIGHT
    return { x: vx + sx, y: vy + sy, inGrid: vx >= 0 && vy >= 0 }
  }

  const noteAt = (x: number, y: number) => {
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

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const { x, y, inGrid } = toContent(e)
    const rect = containerRef.current!.getBoundingClientRect()
    if (!inGrid && e.clientX - rect.left >= KEYBOARD_WIDTH && e.clientY - rect.top < RULER_HEIGHT) {
      onSeek(x / pxPerSec)
      return
    }
    if (!inGrid) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const hit = noteAt(x, y)

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
      const hit = inGrid ? noteAt(x, y) : null
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
      else if (!(e.shiftKey || e.metaKey || e.ctrlKey) && selection.size > 1) {
        const hit = noteAt(toContent(e).x, toContent(e).y)
        if (hit) onSelectionChange(new Set([hit.id]))
      }
      return
    }
    const { x0, y0, x1, y1, additive } = gesture
    const moved = Math.abs(x1 - x0) > DRAG_THRESHOLD || Math.abs(y1 - y0) > DRAG_THRESHOLD
    if (!moved) {
      if (!additive) onSelectionChange(new Set())
      return
    }
    const [t0, t1] = [Math.min(x0, x1) / pxPerSec, Math.max(x0, x1) / pxPerSec]
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)]
    const next = new Set(additive ? selection : [])
    for (const n of notes) {
      const cy = pitchToY(n.midi)
      if (n.end >= t0 && n.start <= t1 && cy + ROW_HEIGHT / 2 >= top && cy - ROW_HEIGHT / 2 <= bottom) next.add(n.id)
    }
    onSelectionChange(next)
  }

  // The same element list across scroll-only renders, so React skips all the blobs while panning.
  const blobs = useMemo(
    () =>
      notes.map((note) => (
        <NoteBlob
          key={note.id}
          note={note}
          peaks={peaks}
          pxPerSec={pxPerSec}
          selected={selection.has(note.id)}
          labelled={hovered === note.id || (selection.size <= 3 && selection.has(note.id))}
        />
      )),
    [notes, peaks, pxPerSec, selection, hovered],
  )

  const dragging = gesture?.kind === 'drag' && gesture.active
  const cursor = dragging || (hovered && !gesture) ? 'ns-resize' : gesture?.kind === 'marquee' ? 'crosshair' : 'default'

  return (
    <div
      ref={containerRef}
      className="pitch-editor"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        if (gesture?.kind === 'drag') onRelease()
        setGesture(null)
      }}
      onPointerLeave={() => !gesture && setHovered(null)}
    >
      {width > 0 && height > 0 && (
        <Stage width={width} height={height} onWheel={handleWheel}>
          <Layer listening={false}>
            <Group x={KEYBOARD_WIDTH} clipX={0} clipY={0} clipWidth={viewWidth} clipHeight={RULER_HEIGHT}>
              <TimeRuler duration={duration} pxPerSec={pxPerSec} scrollX={sx} width={viewWidth} />
            </Group>
            <Group x={KEYBOARD_WIDTH} y={RULER_HEIGHT} clipX={0} clipY={0} clipWidth={viewWidth} clipHeight={gridHeight}>
              <PitchGrid duration={duration} pxPerSec={pxPerSec} scrollX={sx} scrollY={sy} width={viewWidth} height={gridHeight} />
            </Group>
            <Group y={RULER_HEIGHT} clipX={0} clipY={0} clipWidth={KEYBOARD_WIDTH} clipHeight={gridHeight}>
              <Keyboard scrollY={sy} height={gridHeight} />
            </Group>
            <Rect width={KEYBOARD_WIDTH} height={RULER_HEIGHT} fill="#15171c" stroke="#30343d" strokeWidth={1} />
          </Layer>
          <Layer listening={false}>
            <Group x={KEYBOARD_WIDTH} y={RULER_HEIGHT} clipX={0} clipY={0} clipWidth={viewWidth} clipHeight={gridHeight}>
              <F0Curve f0={f0} shifts={shifts} pxPerSec={pxPerSec} scrollX={sx} scrollY={sy} width={viewWidth} />
              <Group x={-sx} y={-sy}>
                {blobs}
                {gesture?.kind === 'marquee' && (
                  <Rect
                    x={Math.min(gesture.x0, gesture.x1)}
                    y={Math.min(gesture.y0, gesture.y1)}
                    width={Math.abs(gesture.x1 - gesture.x0)}
                    height={Math.abs(gesture.y1 - gesture.y0)}
                    fill="rgba(127, 156, 245, 0.12)"
                    stroke="#7f9cf5"
                    strokeWidth={1}
                  />
                )}
              </Group>
            </Group>
          </Layer>
          <Playhead
            getTime={getTime}
            pxPerSec={pxPerSec}
            scrollX={sx}
            viewWidth={viewWidth}
            height={height}
            playing={playing}
            revision={playheadRevision}
            shouldFollow={() => following.current}
            onFollow={(t) => setScrollX(clamp(t * pxPerSec - viewWidth * 0.1, 0, maxScrollX))}
          />
        </Stage>
      )}
    </div>
  )
}
