import { Group, Rect, Text } from 'react-konva'
import type { BackingTrack } from '../types'
import { BACKING_LANE_HEIGHT, KEYBOARD_WIDTH } from './layout'
import { Waveform } from './Waveform'

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
  return (
    <Group listening={false}>
      <Rect width={width} height={BACKING_LANE_HEIGHT} fill="#13161b" />
      <Group y={PADDING}>
        <Waveform
          peaks={backing.peaks}
          duration={backing.buffer.duration}
          viewStart={scrollX / pxPerSec}
          // Vocal time 0 is `offset` into the backing track.
          audioStart={-backing.offset}
          until={duration}
          pxPerSec={pxPerSec}
          width={width}
          height={BACKING_LANE_HEIGHT - 2 * PADDING}
          color={backing.muted ? 'rgba(94, 176, 239, 0.25)' : 'rgba(94, 176, 239, 0.7)'}
        />
      </Group>
      <Rect y={BACKING_LANE_HEIGHT - 1} width={width} height={1} fill="#30343d" />
    </Group>
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
