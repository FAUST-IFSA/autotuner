import type Konva from 'konva'
import type { Ref } from 'react'
import { Layer, Line } from 'react-konva'

interface Props {
  /** The line node, which usePlayhead moves straight on the canvas. */
  ref: Ref<Konva.Line>
  height: number
}

/**
 * The playback position: a line over the ruler and the grid, above everything else. Its x and
 * visibility aren't props; usePlayhead sets them every animation frame, so playback never re-renders
 * React.
 */
export function Playhead({ ref, height }: Props) {
  return (
    <Layer listening={false}>
      <Line ref={ref} points={[0, 0, 0, height]} stroke="#7f9cf5" strokeWidth={2} />
    </Layer>
  )
}
