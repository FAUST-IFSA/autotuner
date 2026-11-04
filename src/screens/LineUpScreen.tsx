import type Konva from 'konva'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { LineUpPlayer } from '../audio/LineUpPlayer'
import { clampOffset, formatSongTime, lineUpRange } from '../audio/backing'
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
/** Play starts this long before the vocal comes in. */
const PRE_ROLL = 2
const NUDGES = [-0.1, -0.01, 0.01, 0.1]

/**
 * Lines a vocal up with a backing track it doesn't match in length (a verse cut from a whole song, say):
 * drag the vocal along the song, nudge it, and play both to check by ear. One clip, one move: nothing else.
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
  const playheadRef = useRef<Konva.Line>(null)
  useEffect(() => () => player.stop(), [player])

  const play = (from: number, at = offset) => {
    void player.play(from, at)
    setPlaying(true)
  }
  const stop = () => {
    player.stop()
    setPlaying(false)
  }
  const playFromVocal = () => play(Math.max(Math.min(0, offset), offset - PRE_ROLL))
  /** Moves the vocal; playing restarts from the same spot so the change is heard straight away. */
  const moveTo = (next: number) => {
    const clamped = clamp(next)
    setOffset(clamped)
    if (player.isPlaying) play(player.position, clamped)
  }

  // The playhead follows playback every frame, without re-rendering; playback stops at the end of both.
  const onFrame = useEffectEvent(() => {
    const t = player.position
    if (t >= Math.max(backingDuration, offset + vocalDuration)) return stop()
    playheadRef.current?.x(toX(t))
    playheadRef.current?.getLayer()?.batchDraw()
  })
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
    if (e.key === ' ') {
      if (playing) stop()
      else playFromVocal()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      moveTo(offset + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01))
    } else if (e.key === 'Escape') onCancel()
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
    // Mouse clicks don't leave focus on buttons, so Space keeps meaning play/stop after a click.
    <main
      className="line-up-screen"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      <h1>Line up your vocal</h1>
      <p className="subtitle">
        Your vocal and backing track are different lengths. Drag your vocal to where it starts in the song, then play to
        check.
      </p>
      <div ref={containerRef} className="line-up-tracks">
        {width > 0 && (
          <Stage width={width} height={STAGE_HEIGHT}>
            <Layer>
              <TimeRuler duration={range.end} pxPerSec={pxPerSec} scrollX={range.start * pxPerSec} width={width} />
              {/* Clicking either lane (but not the clip) plays from there. */}
              <Rect
                y={RULER_HEIGHT}
                width={width}
                height={STAGE_HEIGHT - RULER_HEIGHT}
                fill="#0f1115"
                onClick={(e) => play(toTime(e.target.getStage()!.getPointerPosition()!.x))}
              />
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
                onDragStart={() => setCursor('grabbing')}
                onDragMove={(e) => setOffset(clamp(toTime(e.target.x())))}
                onDragEnd={(e) => {
                  setCursor('grab')
                  moveTo(toTime(e.target.x()))
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
            <Layer listening={false} visible={playing}>
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
        <button type="button" onClick={playing ? stop : playFromVocal}>
          {playing ? 'Stop' : 'Play'}
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
        Space plays from just before your vocal; click a waveform to play from there. ← and → nudge your vocal (hold
        Shift for bigger steps).
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
