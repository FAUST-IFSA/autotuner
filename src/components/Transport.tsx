import { useEffect, useRef } from 'react'
import type { AudioEngine } from '../audio/AudioEngine'

interface Props {
  /** Source of the position readout (null while loading or unavailable: shows 0:00.0). */
  engine: AudioEngine | null
  playing: boolean
  disabled: boolean
  duration: number
  onToggle: () => void
  onToStart: () => void
  onRewind: () => void
  onFastForward: () => void
}

const format = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const showTime = (span: HTMLSpanElement | null, engine: AudioEngine | null) => {
  if (span) span.textContent = format(engine?.currentTime ?? 0)
}

const icons = {
  toStart: <path d="M3 3h2v10H3zM14 3v10L6 8z" />,
  rewind: <path d="M8 3v10L1 8zM15 3v10L8 8z" />,
  play: <path d="M4 2.5v11L13.5 8z" />,
  pause: <path d="M3.5 3h3v10h-3zM9.5 3h3v10h-3z" />,
  fastForward: <path d="M1 3v10l7-5zM8 3v10l7-5z" />,
}

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      {icons[name]}
    </svg>
  )
}

/** Transport controls plus a position readout that updates every frame without re-rendering React. */
export function Transport({
  engine,
  playing,
  disabled,
  duration,
  onToggle,
  onToStart,
  onRewind,
  onFastForward,
}: Props) {
  const timeRef = useRef<HTMLSpanElement>(null)

  // Every frame while playing, and once whenever playback starts or stops.
  useEffect(() => {
    let frame = 0
    const update = () => {
      showTime(timeRef.current, engine)
      if (playing) frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [engine, playing])

  // A seek moves the position without re-rendering anything.
  useEffect(
    () =>
      engine?.subscribe((event) => {
        if (event === 'seek') showTime(timeRef.current, engine)
      }),
    [engine],
  )

  return (
    <div className="transport">
      <div className="transport-buttons" role="group" aria-label="Transport">
        <button type="button" onClick={onToStart} disabled={disabled} title="Back to start (Enter)" aria-label="Back to start">
          <Icon name="toStart" />
        </button>
        <button type="button" onClick={onRewind} disabled={disabled} title="Previous note (<)" aria-label="Previous note">
          <Icon name="rewind" />
        </button>
        <button
          type="button"
          className={playing ? 'play active' : 'play'}
          onClick={onToggle}
          disabled={disabled}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button type="button" onClick={onFastForward} disabled={disabled} title="Next note (>)" aria-label="Next note">
          <Icon name="fastForward" />
        </button>
      </div>
      <span className="position">
        <span ref={timeRef}>0:00.0</span> / {format(duration)}
      </span>
    </div>
  )
}
