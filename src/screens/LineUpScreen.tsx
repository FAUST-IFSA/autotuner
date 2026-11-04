import type Konva from 'konva'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { LineUpPlayer } from '../audio/LineUpPlayer'
import { clampOffset, formatSongTime, lineUpRange, sameLength } from '../audio/backing'
import { getAudioContext } from '../audio/decode'
import { RULER_HEIGHT } from '../editor/layout'
import { TimeRuler } from '../editor/TimeRuler'
import { useElementSize } from '../editor/useElementSize'
import { Waveform } from '../editor/Waveform'
import type { BackingTrack, Project } from '../types'

interface Props {
  vocal: Pick<Project, 'buffer' | 'peaks'>
  backing: BackingTrack
  onDone: (offset: number) => void
  onCancel: () => void
}

const LANE_HEIGHT = 72
const LANE_GAP = 8
const VOCAL_TOP = RULER_HEIGHT + LANE_HEIGHT + LANE_GAP
const STAGE_HEIGHT = VOCAL_TOP + LANE_HEIGHT
const WAVE_PADDING = 8
/** The playhead starts this long before the vocal comes in. */
const PRE_ROLL = 2
const NUDGES = [-0.1, -0.01, 0.01, 0.1]
/** Arrow keys move the playhead this far (with Shift, five times as far). */
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
  const { width } = useElementSize(containerRef)
  const pxPerSec = width / (range.end - range.start) || 1
  const toX = (t: number) => (t - range.start) * pxPerSec
  const toTime = (x: number) => range.start + x / pxPerSec
  const clamp = (next: number) => clampOffset(next, vocalDuration, backingDuration)

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
    if (player.isPlaying) play(clamped)
  }
  /** Moves the vocal; playing restarts from the same spot so the change is heard straight away. */
  const moveTo = (next: number) => {
    const clamped = clamp(next)
    setOffset(clamped)
    if (player.isPlaying) play(player.position, clamped)
  }

  // The playhead follows playback every frame, without re-rendering. At the end of both, playback stops and
  // the playhead goes back to just before the vocal.
  const onFrame = useEffectEvent(() => {
    const t = player.position
    if (t >= Math.max(backingDuration, offset + vocalDuration)) {
      player.stop()
      setPlaying(false)
      setHead(beforeVocal(offset))
      return
    }
    playheadRef.current?.x(toX(t))
    playheadRef.current?.getLayer()?.batchDraw()
  })
  // While stopped, the playhead sits at `head`.
  const placeHead = useEffectEvent(() => {
    playheadRef.current?.x(toX(head))
    playheadRef.current?.getLayer()?.batchDraw()
  })
  useLayoutEffect(() => {
    if (!playing) placeHead()
  }, [playing, head, width])
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
    const direction = e.key === 'ArrowLeft' ? -1 : 1
    if (e.key === ' ') {
      if (playing) pause()
      else play(head)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
      // Option/Alt + arrows nudge the vocal.
      moveTo(offset + direction * (e.shiftKey ? 0.1 : 0.01))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      seekTo(position() + direction * SEEK_STEP * (e.shiftKey ? 5 : 1))
    } else if (e.key === 'Enter') seekTo(beforeVocal(offset))
    else if (e.key === 'Escape') onCancel()
    else return
    e.preventDefault()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const setCursor = (cursor: string) => {
    if (containerRef.current) containerRef.current.style.cursor = cursor
  }
  const clipWidth = vocalDuration * pxPerSec

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
          <Stage width={width} height={STAGE_HEIGHT}>
            <Layer>
              {/* A click anywhere (ruler, lanes or the vocal) moves the playhead there. */}
              <Rect
                width={width}
                height={STAGE_HEIGHT}
                fill="#0f1115"
                onClick={(e) => seekTo(toTime(e.target.getStage()!.getPointerPosition()!.x))}
              />
              <TimeRuler duration={range.end} pxPerSec={pxPerSec} scrollX={range.start * pxPerSec} width={width} />
              <Group y={RULER_HEIGHT} listening={false}>
                <Rect x={toX(0)} width={backingDuration * pxPerSec} height={LANE_HEIGHT} fill="#151b23" />
                <Group y={WAVE_PADDING}>
                  <Waveform
                    peaks={backing.peaks}
                    duration={backingDuration}
                    viewStart={range.start}
                    audioStart={0}
                    pxPerSec={pxPerSec}
                    width={width}
                    height={LANE_HEIGHT - 2 * WAVE_PADDING}
                    color="rgba(94, 176, 239, 0.7)"
                  />
                </Group>
                <Text x={toX(0) + 8} y={6} text="Backing track" fontSize={11} fill="#9aa1ab" />
              </Group>
              <Group
                x={toX(offset)}
                y={VOCAL_TOP}
                draggable
                dragBoundFunc={(pos) => ({ x: toX(clamp(toTime(pos.x))), y: VOCAL_TOP })}
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
                  height={LANE_HEIGHT}
                  fill="rgba(63, 191, 134, 0.16)"
                  stroke="#3fbf86"
                  strokeWidth={1}
                  cornerRadius={6}
                />
                <Group y={WAVE_PADDING} listening={false}>
                  <Waveform
                    peaks={vocal.peaks}
                    duration={vocalDuration}
                    viewStart={0}
                    audioStart={0}
                    pxPerSec={pxPerSec}
                    width={clipWidth}
                    height={LANE_HEIGHT - 2 * WAVE_PADDING}
                    color="rgba(63, 191, 134, 0.8)"
                  />
                </Group>
                <Text x={8} y={6} text="Your vocal" fontSize={11} fill="#c9ced6" listening={false} />
              </Group>
              {/* Where the vocal starts, across both lanes. */}
              <Line
                points={[toX(offset), RULER_HEIGHT, toX(offset), STAGE_HEIGHT]}
                stroke="#3fbf86"
                strokeWidth={1}
                dash={[3, 3]}
                listening={false}
              />
            </Layer>
            <Layer listening={false}>
              <Line ref={playheadRef} points={[0, 0, 0, STAGE_HEIGHT]} stroke="#7f9cf5" strokeWidth={2} />
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
        Click anywhere or use ← → to move the playhead (Shift: 5 s); Enter goes back to just before your vocal; Space
        plays and pauses. Option/Alt + ← → nudges your vocal (Shift: 100 ms).
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
