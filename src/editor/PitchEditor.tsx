import { useMemo, useRef } from 'react'
import { Group, Layer, Rect, Stage } from 'react-konva'
import type { AudioEngine } from '../audio/AudioEngine'
import type { F0Curve as Curve, NoteSegment, Peaks } from '../types'
import { shiftOf } from '../audio/music'
import type { Edit } from './edits'
import { F0Curve } from './F0Curve'
import { KEYBOARD_WIDTH, RULER_HEIGHT } from './layout'
import { NoteBlob } from './NoteBlob'
import { Playhead } from './Playhead'
import { Keyboard, PitchGrid } from './PitchGrid'
import { TimeRuler } from './TimeRuler'
import { useElementSize } from './useElementSize'
import { useNoteGestures } from './useNoteGestures'
import { usePanZoom } from './usePanZoom'
import { usePlayhead } from './usePlayhead'
import { useRevealSelection } from './useRevealSelection'
import { useViewport } from './useViewport'

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
  engine: AudioEngine | null
  playing: boolean
  /** Click on the time ruler. */
  onSeek: (seconds: number) => void
  /** Drag preview: a note was grabbed, its shift changed, it was released. */
  onGrab: (note: NoteSegment) => void
  onGrabShift: (semitones: number) => void
  onRelease: () => void
  /** Off while another screen (the Downloaded screen) covers the editor. */
  shortcutsEnabled: boolean
}

/** Semitone shift per F0 frame, so the curve moves with edited notes. */
function frameShifts(notes: NoteSegment[], f0: Curve) {
  const out = new Float32Array(f0.midi.length)
  for (const n of notes) {
    const shift = shiftOf(n)
    if (shift === 0) continue
    out.fill(shift, Math.max(0, Math.ceil(n.start / f0.hopSec)), Math.floor(n.end / f0.hopSec) + 1)
  }
  return out
}

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
  engine,
  playing,
  onSeek,
  onGrab,
  onGrabShift,
  onRelease,
  shortcutsEnabled,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  const view = useViewport(size, duration, notes)
  const { viewWidth, gridHeight, pxPerSec, sx, sy } = view
  useRevealSelection(selection, notes, view)
  const { lineRef, stopFollowing } = usePlayhead({
    engine,
    playing,
    pxPerSec,
    scrollX: sx,
    viewWidth,
    scrollToX: view.scrollToX,
  })
  const handleWheel = usePanZoom(view, stopFollowing, shortcutsEnabled)
  const { hovered, marquee, cursor, pointerHandlers } = useNoteGestures({
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
  })

  const shifts = useMemo(() => frameShifts(notes, f0), [notes, f0])

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

  return (
    <div ref={containerRef} className="pitch-editor" style={{ cursor }} {...pointerHandlers}>
      {size.width > 0 && size.height > 0 && (
        <Stage width={size.width} height={size.height} onWheel={handleWheel}>
          <Layer listening={false}>
            <Group x={KEYBOARD_WIDTH} clipX={0} clipY={0} clipWidth={viewWidth} clipHeight={RULER_HEIGHT}>
              <TimeRuler duration={duration} pxPerSec={pxPerSec} scrollX={sx} width={viewWidth} />
            </Group>
            <Group
              x={KEYBOARD_WIDTH}
              y={RULER_HEIGHT}
              clipX={0}
              clipY={0}
              clipWidth={viewWidth}
              clipHeight={gridHeight}
            >
              <PitchGrid
                duration={duration}
                pxPerSec={pxPerSec}
                scrollX={sx}
                scrollY={sy}
                width={viewWidth}
                height={gridHeight}
              />
            </Group>
            <Group y={RULER_HEIGHT} clipX={0} clipY={0} clipWidth={KEYBOARD_WIDTH} clipHeight={gridHeight}>
              <Keyboard scrollY={sy} height={gridHeight} />
            </Group>
            <Rect width={KEYBOARD_WIDTH} height={RULER_HEIGHT} fill="#15171c" stroke="#30343d" strokeWidth={1} />
          </Layer>
          <Layer listening={false}>
            <Group
              x={KEYBOARD_WIDTH}
              y={RULER_HEIGHT}
              clipX={0}
              clipY={0}
              clipWidth={viewWidth}
              clipHeight={gridHeight}
            >
              <F0Curve f0={f0} shifts={shifts} pxPerSec={pxPerSec} scrollX={sx} scrollY={sy} width={viewWidth} />
              <Group x={-sx} y={-sy}>
                {blobs}
                {marquee && (
                  <Rect
                    x={Math.min(marquee.x0, marquee.x1)}
                    y={Math.min(marquee.y0, marquee.y1)}
                    width={Math.abs(marquee.x1 - marquee.x0)}
                    height={Math.abs(marquee.y1 - marquee.y0)}
                    fill="rgba(127, 156, 245, 0.12)"
                    stroke="#7f9cf5"
                    strokeWidth={1}
                  />
                )}
              </Group>
            </Group>
          </Layer>
          <Playhead ref={lineRef} height={size.height} />
        </Stage>
      )}
    </div>
  )
}
