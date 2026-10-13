import { useEffect, useRef } from 'react'

interface Props {
  playing: boolean
  /** Bumped on seeks so a paused position redraws. */
  revision: number
  disabled: boolean
  duration: number
  getTime: () => number
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
  playing,
  revision,
  disabled,
  duration,
  getTime,
  onToggle,
  onToStart,
  onRewind,
  onFastForward,
}: Props) {
  const timeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      if (timeRef.current) timeRef.current.textContent = format(getTime())
      if (playing) frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [playing, revision, getTime])

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
