import { Shape } from 'react-konva'
import { peakRange } from '../audio/peaks'
import type { Peaks } from '../types'

interface Props {
  peaks: Peaks
  /** The audio's length, seconds. */
  duration: number
  /** Time at x = 0, and where the audio starts, on the same time axis. */
  viewStart: number
  audioStart: number
  /** Nothing is drawn from this time on. */
  until?: number
  pxPerSec: number
  width: number
  height: number
  color: string
}

/** A min/max waveform placed on a time axis, one column per pixel. Display only. */
export function Waveform({
  peaks,
  duration,
  viewStart,
  audioStart,
  until = Infinity,
  pxPerSec,
  width,
  height,
  color,
}: Props) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const mid = height / 2
        const scale = mid / peaks.peak
        ctx.setAttr('fillStyle', color)
        for (let px = 0; px < width; px++) {
          const t = viewStart + px / pxPerSec
          if (t >= until) break
          const inAudio = t - audioStart
          if (inAudio < 0) continue
          if (inAudio >= duration) break
          const [lo, hi] = peakRange(peaks, inAudio, inAudio + 1 / pxPerSec)
          const top = mid - hi * scale
          ctx.fillRect(px, top, 1, Math.max(1, mid - lo * scale - top))
        }
      }}
    />
  )
}
