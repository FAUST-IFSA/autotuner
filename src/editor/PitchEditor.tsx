import type { KonvaEventObject } from 'konva/lib/Node'
import { useLayoutEffect, useRef, useState } from 'react'
import { Group, Layer, Rect, Stage } from 'react-konva'
import type { NoteSegment, Peaks } from '../types'
import { NoteBlob } from './NoteBlob'
import { Keyboard, PitchGrid } from './PitchGrid'
import { TimeRuler } from './TimeRuler'
import {
  GRID_HEIGHT,
  KEYBOARD_WIDTH,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  ROW_HEIGHT,
  RULER_HEIGHT,
  clamp,
  midiToY,
} from './layout'

interface Props {
  peaks: Peaks
  notes: NoteSegment[]
  duration: number
  onNoteMidiChange: (id: string, midi: number) => void
}

export function PitchEditor({ peaks, notes, duration, onNoteMidiChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(containerRef.current!)
    return () => observer.disconnect()
  }, [])

  // null means "not touched yet": fit the whole file and centre on middle C.
  const [zoom, setZoom] = useState<number | null>(null)
  const [scrollX, setScrollX] = useState(0)
  const [scrollY, setScrollY] = useState<number | null>(null)

  const viewWidth = Math.max(0, width - KEYBOARD_WIDTH)
  const gridHeight = Math.max(0, height - RULER_HEIGHT)
  const pxPerSec = zoom ?? clamp(viewWidth / duration, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
  const maxScrollX = Math.max(0, duration * pxPerSec - viewWidth)
  const maxScrollY = Math.max(0, GRID_HEIGHT - gridHeight)
  const sx = clamp(scrollX, 0, maxScrollX)
  const sy = clamp(scrollY ?? midiToY(60) + ROW_HEIGHT / 2 - gridHeight / 2, 0, maxScrollY)

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
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

  return (
    <div ref={containerRef} className="pitch-editor">
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
          <Layer>
            <Group x={KEYBOARD_WIDTH} y={RULER_HEIGHT} clipX={0} clipY={0} clipWidth={viewWidth} clipHeight={gridHeight}>
              <Group x={-sx} y={-sy}>
                {notes.map((note) => (
                  <NoteBlob key={note.id} note={note} peaks={peaks} pxPerSec={pxPerSec} onMidiChange={onNoteMidiChange} />
                ))}
              </Group>
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  )
}
