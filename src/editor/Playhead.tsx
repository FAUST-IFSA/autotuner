import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Layer, Line } from 'react-konva'
import { KEYBOARD_WIDTH } from './layout'

interface Props {
  getTime: () => number
  pxPerSec: number
  scrollX: number
  viewWidth: number
  height: number
  playing: boolean
  /** Bumped on seeks so a paused position redraws. */
  revision: number
  /** Called when playback runs off either edge of the view, with the time to bring into view. */
  onFollow: (time: number) => void
}

/**
 * The playback position. Moved every animation frame straight on the Konva node, so playback never
 * re-renders React (only following off the edge of the view does).
 */
export function Playhead({ getTime, pxPerSec, scrollX, viewWidth, height, playing, revision, onFollow }: Props) {
  const lineRef = useRef<Konva.Line>(null)
  const view = useRef({ pxPerSec, scrollX, viewWidth, onFollow })
  useEffect(() => {
    view.current = { pxPerSec, scrollX, viewWidth, onFollow }
  })

  useEffect(() => {
    let frame = 0
    const draw = () => {
      const line = lineRef.current
      if (line) {
        const { pxPerSec, scrollX, viewWidth, onFollow } = view.current
        const t = getTime()
        const x = t * pxPerSec - scrollX
        line.visible(x >= 0 && x <= viewWidth)
        line.x(KEYBOARD_WIDTH + x)
        line.getLayer()?.batchDraw()
        if (playing && (x > viewWidth * 0.95 || x < 0)) onFollow(t)
      }
      if (playing) frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [getTime, playing, revision, pxPerSec, scrollX, viewWidth])

  return (
    <Layer listening={false}>
      <Line ref={lineRef} points={[0, 0, 0, height]} stroke="#7f9cf5" strokeWidth={2} />
    </Layer>
  )
}
