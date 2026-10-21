import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useEffectEvent } from 'react'
import { KEYBOARD_WIDTH } from './layout'
import type { Viewport } from './useViewport'

/** Ctrl/Cmd + scroll zoom per unit of wheel delta (was 0.002, which felt slow). */
const WHEEL_ZOOM_SPEED = 0.004
/** Cmd/Ctrl + arrow zoom per press. */
const KEY_ZOOM_STEP = 1.5

/**
 * The user moving the view: wheel and trackpad scrolling and pinching, and Cmd/Ctrl + Left/Right. Each
 * stops the view following the playhead. Returns the Stage's wheel handler.
 */
export function usePanZoom(view: Viewport, stopFollowing: () => void) {
  // Cmd/Ctrl + Right zooms in, Cmd/Ctrl + Left zooms out, around the middle of the view.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    // Also stops the browser's Cmd+Left "back" shortcut.
    e.preventDefault()
    stopFollowing()
    view.zoomBy(e.key === 'ArrowRight' ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP, view.viewWidth / 2)
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    stopFollowing()
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt

    if (ctrlKey || metaKey) {
      const pointerX = (e.target.getStage()?.getPointerPosition()?.x ?? KEYBOARD_WIDTH) - KEYBOARD_WIDTH
      view.zoomBy(Math.exp(-deltaY * WHEEL_ZOOM_SPEED), Math.max(0, pointerX))
      return
    }

    view.scrollToX(view.sx + (shiftKey ? deltaY : deltaX))
    if (!shiftKey) view.scrollToY(view.sy + deltaY)
  }
}
