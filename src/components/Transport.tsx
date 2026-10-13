import { useEffect, useRef } from 'react'

interface Props {
  playing: boolean
  /** Bumped on seeks so a paused position redraws. */
  revision: number
  disabled: boolean
  duration: number
  getTime: () => number
  onToggle: () => void
}

const format = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Play/pause plus a position readout that updates every frame without re-rendering React. */
export function Transport({ playing, revision, disabled, duration, getTime, onToggle }: Props) {
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
      <button type="button" className="play" onClick={onToggle} disabled={disabled} title="Play or pause (Space)">
        {playing ? 'Pause' : 'Play'}
      </button>
      <span className="position">
        <span ref={timeRef}>0:00.0</span> / {format(duration)}
      </span>
    </div>
  )
}
