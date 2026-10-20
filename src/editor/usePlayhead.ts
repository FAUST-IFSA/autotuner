import type Konva from 'konva'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/AudioEngine'
import { KEYBOARD_WIDTH } from './layout'

interface Options {
  engine: AudioEngine | null
  playing: boolean
  pxPerSec: number
  /** The clamped scroll offset the grid is drawn at. */
  scrollX: number
  viewWidth: number
  /** Scrolls the view (clamped), for following. */
  scrollToX: (x: number) => void
}

/**
 * Moves the playhead line every animation frame straight on the Konva node, so playback never
 * re-renders React (only following off the edge of the view does). The view follows page by page and
 * stops as soon as the user scrolls or zooms (`stopFollowing`); playing, pausing or seeking turns it back
 * on. Seeks are heard from the engine, so with none (loading, or playback unavailable) Enter and ruler
 * clicks leave following as it is: the playhead can't move. Returns the line's ref (state, so the line is
 * drawn as soon as the Stage mounts it).
 */
export function usePlayhead({ engine, playing, pxPerSec, scrollX, viewWidth, scrollToX }: Options) {
  const [line, setLine] = useState<Konva.Line | null>(null)
  // The view chases the playhead until the user scrolls or zooms; playing or jumping turns it back on.
  const following = useRef(true)
  const view = useRef({ pxPerSec, scrollX, viewWidth })

  const draw = useEffectEvent(() => {
    if (!line) return
    const { pxPerSec: pps, scrollX: left, viewWidth: width } = view.current
    const t = engine?.currentTime ?? 0
    const x = t * pps - left
    line.visible(x >= 0 && x <= width)
    line.x(KEYBOARD_WIDTH + x)
    line.getLayer()?.batchDraw()
    // Off either edge: jump a page so the playhead sits 10% into the view.
    if ((x > width * 0.95 || x < 0) && following.current) scrollToX(t * pps - width * 0.1)
  })

  // A scroll, zoom or resize (or the line first appearing) moves the line at once, before paint.
  useLayoutEffect(() => {
    view.current = { pxPerSec, scrollX, viewWidth }
    if (line) draw()
  }, [line, pxPerSec, scrollX, viewWidth])

  // Every frame while playing. Play, pause and the end re-render, so they redraw here, in the commit
  // that shows them (after any scroll in that commit), and only then turn following back on: so that
  // redraw still leaves a view the user scrolled away alone, and every later one follows.
  useLayoutEffect(() => {
    let frame = 0
    const tick = () => {
      draw()
      if (playing) frame = requestAnimationFrame(tick)
    }
    tick()
    following.current = true
    return () => cancelAnimationFrame(frame)
  }, [playing])

  // A seek moves the playhead without a re-render: redraw for it, then follow again, as above.
  useEffect(
    () =>
      engine?.subscribe((event) => {
        if (event !== 'seek') return
        draw()
        following.current = true
      }),
    [engine],
  )

  const stopFollowing = useCallback(() => {
    following.current = false
  }, [])

  return { lineRef: setLine, stopFollowing }
}
