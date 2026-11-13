import { Group, Rect, Shape, Text } from 'react-konva'
import { peakRange } from '../audio/peaks'
import type { BackingTrack } from '../types'
import { BACKING_LANE_HEIGHT, KEYBOARD_WIDTH } from './layout'

interface Props {
  backing: Pick<BackingTrack, 'buffer' | 'peaks' | 'offset' | 'muted'>
  /** The vocal's length: the lane shows only the part of the backing track under the vocal. */
  duration: number
  pxPerSec: number
  scrollX: number
  width: number
}

const PADDING = 6

/** The backing track's waveform on the vocal's timeline. Display only: it can't be edited. */
export function BackingLane({ backing, duration, pxPerSec, scrollX, width }: Props) {
  const { buffer, peaks, offset, muted } = backing
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.setAttr('fillStyle', '#13161b')
        ctx.fillRect(0, 0, width, BACKING_LANE_HEIGHT)

        const mid = BACKING_LANE_HEIGHT / 2
        const scale = (mid - PADDING) / peaks.peak
        ctx.setAttr('fillStyle', muted ? 'rgba(94, 176, 239, 0.25)' : 'rgba(94, 176, 239, 0.7)')
        for (let px = 0; px < width; px++) {
          const t = (scrollX + px) / pxPerSec
          if (t >= duration) break
          const inBacking = t + offset
          if (inBacking < 0 || inBacking >= buffer.duration) continue
          const [lo, hi] = peakRange(peaks, inBacking, inBacking + 1 / pxPerSec)
          const top = mid - hi * scale
          ctx.fillRect(px, top, 1, Math.max(1, mid - lo * scale - top))
        }

        ctx.setAttr('fillStyle', '#30343d')
        ctx.fillRect(0, BACKING_LANE_HEIGHT - 1, width, 1)
      }}
    />
  )
}

/** The lane's label in the keyboard column. */
export function BackingLaneLabel() {
  return (
    <Group listening={false}>
      <Rect width={KEYBOARD_WIDTH} height={BACKING_LANE_HEIGHT} fill="#15171c" stroke="#30343d" strokeWidth={1} />
      <Text
        width={KEYBOARD_WIDTH}
        height={BACKING_LANE_HEIGHT}
        text="Backing"
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        fill="#7d8590"
        align="center"
        verticalAlign="middle"
      />
    </Group>
  )
}
