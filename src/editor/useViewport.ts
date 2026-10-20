import { useState } from 'react'
import type { NoteSegment } from '../types'
import {
  GRID_HEIGHT,
  KEYBOARD_WIDTH,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  RULER_HEIGHT,
  clamp,
  pitchToY,
} from './layout'

export interface Viewport {
  viewWidth: number
  gridHeight: number
  pxPerSec: number
  /** Scroll offsets clamped to the content, as drawn; every handler works from these. */
  sx: number
  sy: number
  /** Scrolls so content x (or y) is at the left (or top) edge, clamped to the content. */
  scrollToX: (x: number) => void
  scrollToY: (y: number) => void
  /** Zooms time by `factor`, keeping the time under `anchorX` (px into the grid) where it is. */
  zoomBy: (factor: number, anchorX: number) => void
}

/**
 * Zoom and scroll for an editor of `size`: until the user zooms, the whole file fits the view; until they
 * scroll vertically, it is centred on the sung range.
 */
export function useViewport(size: { width: number; height: number }, duration: number, notes: NoteSegment[]): Viewport {
  // null means "not touched yet": fit the whole file and centre on the sung range.
  const [zoom, setZoom] = useState<number | null>(null)
  const [scrollX, setScrollX] = useState(0)
  const [scrollY, setScrollY] = useState<number | null>(null)
  // Fit to the notes as analysed, once; later edits don't move the view.
  const [sungCentre] = useState(() => {
    if (notes.length === 0) return 60
    const pitches = notes.map((n) => n.detectedMidi)
    return (Math.min(...pitches) + Math.max(...pitches)) / 2
  })

  const viewWidth = Math.max(0, size.width - KEYBOARD_WIDTH)
  const gridHeight = Math.max(0, size.height - RULER_HEIGHT)
  const pxPerSec = zoom ?? clamp(viewWidth / duration, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
  const maxScrollX = Math.max(0, duration * pxPerSec - viewWidth)
  const maxScrollY = Math.max(0, GRID_HEIGHT - gridHeight)
  // Stored offsets can be out of range (zooming, resizing); they are clamped only here, when drawn.
  const sx = clamp(scrollX, 0, maxScrollX)
  const sy = clamp(scrollY ?? pitchToY(sungCentre) - gridHeight / 2, 0, maxScrollY)

  return {
    viewWidth,
    gridHeight,
    pxPerSec,
    sx,
    sy,
    scrollToX: (x) => setScrollX(clamp(x, 0, maxScrollX)),
    scrollToY: (y) => setScrollY(clamp(y, 0, maxScrollY)),
    zoomBy: (factor, anchorX) => {
      const anchorTime = (sx + anchorX) / pxPerSec
      const nextPxPerSec = clamp(pxPerSec * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
      setZoom(nextPxPerSec)
      setScrollX(anchorTime * nextPxPerSec - anchorX)
    },
  }
}
