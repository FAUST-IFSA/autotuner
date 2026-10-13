import { Shape } from 'react-konva'
import type { F0Curve as Curve } from '../types'
import { pitchToY } from './layout'

interface Props {
  f0: Curve
  /** Semitones to add per frame, so the curve moves with edited notes. */
  shifts: Float32Array
  pxPerSec: number
  scrollX: number
  scrollY: number
  width: number
}

/** Pitch change between neighbouring frames above which the line breaks (tracker octave jumps). */
const MAX_JUMP = 1

/** The sung pitch over time. Only the visible frames are drawn, at most about one per pixel. */
export function F0Curve({ f0, shifts, pxPerSec, scrollX, scrollY, width }: Props) {
  return (
    <Shape
      listening={false}
      stroke="rgba(230, 232, 235, 0.6)"
      strokeWidth={1.25}
      lineJoin="round"
      sceneFunc={(ctx, shape) => {
        const framesPerPx = 1 / (f0.hopSec * pxPerSec)
        const step = Math.max(1, Math.floor(framesPerPx))
        const first = Math.max(0, Math.floor(scrollX / pxPerSec / f0.hopSec) - step)
        const last = Math.min(f0.midi.length - 1, Math.ceil((scrollX + width) / pxPerSec / f0.hopSec) + step)
        ctx.beginPath()
        let drawing = false
        let prevShift = 0
        let prevMidi = 0
        for (let i = first; i <= last; i += step) {
          const m = f0.midi[i]
          // Break the line at unvoiced frames, octave jumps, and wherever a moved note starts or ends.
          if (m === null || (drawing && (shifts[i] !== prevShift || Math.abs(m - prevMidi) > MAX_JUMP * step))) {
            drawing = false
            if (m === null) continue
          }
          const x = i * f0.hopSec * pxPerSec - scrollX
          const y = pitchToY(m + shifts[i]) - scrollY
          if (drawing) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
          drawing = true
          prevShift = shifts[i]
          prevMidi = m
        }
        ctx.strokeShape(shape)
      }}
    />
  )
}
