import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { LineUpPlayer } from '../audio/LineUpPlayer'
import { clampOffset, formatSongTime, lineUpRange, sameLength } from '../audio/backing'
import { getAudioContext } from '../audio/decode'
import { MAX_PX_PER_SEC, RULER_HEIGHT } from '../editor/layout'
import { TimeRuler } from '../editor/TimeRuler'
import { useElementSize } from '../editor/useElementSize'
import { KEY_ZOOM_STEP, WHEEL_ZOOM_SPEED } from '../editor/usePanZoom'
import { Waveform } from '../editor/Waveform'
import type { BackingTrack, Project } from '../types'

interface Props {
  vocal: Pick<Project, 'buffer' | 'peaks'>
  backing: BackingTrack
  onDone: (offset: number) => void
  onCancel: () => void
}

/** The lanes share the height the screen gives the tracks (.line-up-tracks), but never get shorter than this. */
const MIN_LANE_HEIGHT = 110
const LANE_GAP = 8
const WAVE_PADDING = 8
/** The playhead starts this long before the vocal comes in. */
const PRE_ROLL = 2
const NUDGES = [-0.1, -0.01, 0.01, 0.1]
/** < and > (or , and .) move the playhead this far. */
const SEEK_STEP = 1

/**
 * Lines a vocal up with its backing track, after every backing upload: drag the vocal along the song (a verse
 * cut from a whole song, say), nudge it, and play both to check by ear. One clip, one move: nothing else.
 */
export function LineUpScreen({ vocal, backing, onDone, onCancel }: Props) {
  const vocalDuration = vocal.buffer.duration
  const backingDuration = backing.buffer.duration
  const range = lineUpRange(vocalDuration, backingDuration)
  const [offset, setOffset] = useState(() => clampOffset(backing.offset, vocalDuration, backingDuration))
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(containerRef)
  const laneHeight = Math.max(MIN_LANE_HEIGHT, Math.floor((height - RULER_HEIGHT - LANE_GAP) / 2))
  const vocalTop = RULER_HEIGHT + laneHeight + LANE_GAP
  const stageHeight = vocalTop + laneHeight
  // Zoom and scroll work as in the editor. Until the user zooms, the whole song fits the view.
  const fitPxPerSec = width / (range.end - range.start) || 1
  const [zoom, setZoom] = useState<number | null>(null)
  const pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(fitPxPerSec, zoom ?? fitPxPerSec))
  const [scrollTo, setScroll] = useState(0)
  // Stored offsets can be out of range (zooming, resizing); they're clamped only here, when drawn.
  const scroll = Math.min(Math.max(0, (range.end - range.start) * pxPerSec - width), Math.max(0, scrollTo))
  const toX = (t: number) => (t - range.start) * pxPerSec - scroll
  const toTime = (x: number) => range.start + (x + scroll) / pxPerSec
  const clamp = (next: number) => clampOffset(next, vocalDuration, backingDuration)
  /** The view follows the playhead page by page while playing, until the user scrolls or zooms. */
  const following = useRef(true)
  /** Zooms by `factor`, keeping the time under `anchorX` where it is. */
  const zoomBy = (factor: number, anchorX: number) => {
    following.current = false
    const anchor = toTime(anchorX)
    const next = Math.min(MAX_PX_PER_SEC, Math.max(fitPxPerSec, pxPerSec * factor))
    setZoom(next)
    setScroll((anchor - range.start) * next - anchorX)
  }
  /** Scrolls a page so song time `t` sits 10% into the view, if it's off screen. */
  const reveal = (t: number) => {
    const x = toX(t)
    if (x < 0 || x > width * 0.95) setScroll((t - range.start) * pxPerSec - width * 0.1)
  }

  const [player] = useState(
    () => new LineUpPlayer(getAudioContext(), vocal.buffer, backing.buffer, backing.volume ** 2),
  )
  const [playing, setPlaying] = useState(false)
  /** Song time where the playhead rests: playback starts here, and pausing leaves it where it stopped. */
  const beforeVocal = (at: number) => Math.max(Math.min(0, at), at - PRE_ROLL)
  const [head, setHead] = useState(() => beforeVocal(offset))
  const playheadRef = useRef<Konva.Line>(null)
  /** Set by a drag of the vocal, so the click that ends it doesn't also move the playhead. */
  const dragged = useRef(false)
  useEffect(() => () => player.stop(), [player])

  const play = (from: number, at = offset) => {
    following.current = true
    void player.play(from, at)
    setPlaying(true)
  }
  const pause = () => {
    setHead(player.position)
    player.stop()
    setPlaying(false)
  }
  const position = () => (player.isPlaying ? player.position : head)
  /** Moves the playhead; playback carries on from there. */
  const seekTo = (t: number) => {
    const clamped = Math.min(range.end, Math.max(range.start, t))
    setHead(clamped)
    following.current = true
    reveal(clamped)
    if (player.isPlaying) play(clamped)
  }
  /** Moves the vocal; playing restarts from the same spot so the change is heard straight away. */
  const moveTo = (next: number) => {
    const clamped = clamp(next)
    setOffset(clamped)
    if (player.isPlaying) play(player.position, clamped)
  }

  const drawHead = (t: number) => {
    const line = playheadRef.current
    if (!line) return
    const x = toX(t)
    line.visible(x >= 0 && x <= width)
    line.x(x)
    line.getLayer()?.batchDraw()
  }
  // The playhead follows playback every frame, without re-rendering (only turning a page does). At the end of
  // both, playback stops and the playhead goes back to just before the vocal.
  const onFrame = useEffectEvent(() => {
    const t = player.position
    if (t >= Math.max(backingDuration, offset + vocalDuration)) {
      player.stop()
      setPlaying(false)
      setHead(beforeVocal(offset))
      return
    }
    drawHead(t)
    if (following.current) reveal(t)
  })
  // While stopped, the playhead sits at `head`.
  const placeHead = useEffectEvent(() => drawHead(head))
  useLayoutEffect(() => {
    if (!playing) placeHead()
  }, [playing, head, width, pxPerSec, scroll])
  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      onFrame()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return
    const arrow = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    const mod = e.metaKey || e.ctrlKey
    if (e.key === ' ') {
      if (playing) pause()
      else play(head)
    }
    // As in the editor: Cmd/Ctrl + Right zooms in, Cmd/Ctrl + Left zooms out, around the middle.
    else if (arrow && mod) zoomBy(arrow > 0 ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP, width / 2)
    else if (arrow) moveTo(offset + arrow * (e.shiftKey ? 0.1 : 0.01))
    // < and > move the playhead, as they do in the editor (also , and . so Shift isn't needed).
    else if (!mod && (e.key === '<' || e.key === ',')) seekTo(position() - SEEK_STEP)
    else if (!mod && (e.key === '>' || e.key === '.')) seekTo(position() + SEEK_STEP)
    else if (e.key === 'Enter') seekTo(beforeVocal(offset))
    else if (e.key === 'Escape') onCancel()
    else return
    e.preventDefault()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Scrolling and pinching, as in the editor: Cmd/Ctrl + scroll (or a pinch) zooms around the pointer, and
  // scrolling moves along the song (vertical scrolling too, since there's nothing else to scroll).
  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    following.current = false
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt
    if (ctrlKey || metaKey) {
      zoomBy(Math.exp(-deltaY * WHEEL_ZOOM_SPEED), e.target.getStage()?.getPointerPosition()?.x ?? width / 2)
      return
    }
    setScroll(scroll + (shiftKey || deltaX === 0 ? deltaY : deltaX))
  }

  const setCursor = (cursor: string) => {
    if (containerRef.current) containerRef.current.style.cursor = cursor
  }
  const clipX = toX(offset)
  const clipWidth = vocalDuration * pxPerSec
  // Only the part of the vocal on screen is drawn: zoomed in, the clip can be far wider than the view.
  const clipFrom = Math.max(0, -clipX)
  const clipTo = Math.min(clipWidth, width - clipX)

  return (
    // Mouse clicks don't leave focus on buttons, so Space keeps meaning play/pause after a click.
    <main
      className="line-up-screen"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      <h1>Line up your vocal</h1>
      <p className="subtitle">
        {sameLength(vocalDuration, backingDuration)
          ? 'Your vocal and backing track are the same length, so they probably start together. Play to check, then choose Done.'
          : 'Your vocal and backing track are different lengths. Drag your vocal to where it starts in the song, then play to check.'}
      </p>
      <div ref={containerRef} className="line-up-tracks">
        {width > 0 && (
          <Stage width={width} height={stageHeight} onWheel={onWheel}>
            <Layer>
              {/* A click anywhere (ruler, lanes or the vocal) moves the playhead there. */}
              <Rect
                width={width}
                height={stageHeight}
                fill="#0f1115"
                onClick={(e) => seekTo(toTime(e.target.getStage()!.getPointerPosition()!.x))}
              />
              <TimeRuler
                duration={range.end}
                pxPerSec={pxPerSec}
                scrollX={range.start * pxPerSec + scroll}
                width={width}
              />
              <Group y={RULER_HEIGHT} listening={false}>
                <Rect x={toX(0)} width={backingDuration * pxPerSec} height={laneHeight} fill="#151b23" />
                <Group y={WAVE_PADDING}>
                  <Waveform
                    peaks={backing.peaks}
                    duration={backingDuration}
                    viewStart={toTime(0)}
                    audioStart={0}
                    pxPerSec={pxPerSec}
                    width={width}
                    height={laneHeight - 2 * WAVE_PADDING}
                    color="rgba(94, 176, 239, 0.7)"
                  />
                </Group>
                <Text x={Math.max(0, toX(0)) + 8} y={6} text="Backing track" fontSize={11} fill="#9aa1ab" />
              </Group>
              <Group
                x={clipX}
                y={vocalTop}
                draggable
                dragBoundFunc={(pos) => ({ x: toX(clamp(toTime(pos.x))), y: vocalTop })}
                onMouseDown={() => {
                  dragged.current = false
                }}
                onDragStart={() => {
                  dragged.current = true
                  setCursor('grabbing')
                }}
                onDragMove={(e) => setOffset(clamp(toTime(e.target.x())))}
                onDragEnd={(e) => {
                  setCursor('grab')
                  moveTo(toTime(e.target.x()))
                }}
                onClick={(e) => {
                  if (!dragged.current) seekTo(toTime(e.target.getStage()!.getPointerPosition()!.x))
                }}
                onMouseEnter={() => setCursor('grab')}
                onMouseLeave={() => setCursor('')}
              >
                <Rect
                  width={clipWidth}
                  height={laneHeight}
                  fill="rgba(63, 191, 134, 0.16)"
                  stroke="#3fbf86"
                  strokeWidth={1}
                  cornerRadius={6}
                />
                {clipTo > clipFrom && (
                  <Group x={clipFrom} y={WAVE_PADDING} listening={false}>
                    <Waveform
                      peaks={vocal.peaks}
                      duration={vocalDuration}
                      viewStart={clipFrom / pxPerSec}
                      audioStart={0}
                      pxPerSec={pxPerSec}
                      width={clipTo - clipFrom}
                      height={laneHeight - 2 * WAVE_PADDING}
                      color="rgba(63, 191, 134, 0.8)"
                    />
                  </Group>
                )}
                <Text x={clipFrom + 8} y={6} text="Your vocal" fontSize={11} fill="#c9ced6" listening={false} />
              </Group>
              {/* Where the vocal starts, across both lanes. */}
              <Line
                points={[clipX, RULER_HEIGHT, clipX, stageHeight]}
                stroke="#3fbf86"
                strokeWidth={1}
                dash={[3, 3]}
                listening={false}
              />
            </Layer>
            <Layer listening={false}>
              <Line ref={playheadRef} points={[0, 0, 0, stageHeight]} stroke="#7f9cf5" strokeWidth={2} />
            </Layer>
          </Stage>
        )}
      </div>
      <p className="line-up-readout">
        {offset >= 0
          ? `Your vocal starts ${formatSongTime(offset)} into the backing track`
          : `Your vocal starts ${formatSongTime(-offset)} before the backing track`}
      </p>
      <div className="line-up-controls">
        <button type="button" onClick={playing ? pause : () => play(head)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="nudges">
          {NUDGES.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => moveTo(offset + step)}
              title={`Move your vocal ${Math.abs(step) * 1000} ms ${step < 0 ? 'earlier' : 'later'}`}
            >
              {step < 0 ? '−' : '+'}
              {Math.abs(step) * 1000} ms
            </button>
          ))}
        </div>
        <button type="button" onClick={() => moveTo(0)} disabled={offset === 0}>
          Start together
        </button>
      </div>
      <p className="line-up-hint">
        Click anywhere or press &lt; &gt; to move the playhead; Enter goes back to just before your vocal; Space plays
        and pauses. ← → nudge your vocal (Shift: 100 ms). Cmd/Ctrl + scroll, a pinch, or Cmd/Ctrl + ← → zooms; scroll to
        move along the song.
      </p>
      <div className="line-up-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onDone(offset)}>
          Done
        </button>
      </div>
    </main>
  )
}
