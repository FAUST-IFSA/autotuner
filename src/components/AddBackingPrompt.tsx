import { useEffect } from 'react'

interface Props {
  onAdd: () => void
  onSkip: () => void
}

/** Asked once, after a new vocal has been analysed. */
export function AddBackingPrompt({ onAdd, onSkip }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSkip])

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-backing-title">
        <h2 id="add-backing-title">Add a backing track?</h2>
        <p>
          Hear your vocal with the music while you tune. The backing track is only for reference: it isn't tuned or
          exported.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onSkip}>
            Not now
          </button>
          <button type="button" className="primary" onClick={onAdd} autoFocus>
            Add backing track
          </button>
        </div>
      </div>
    </div>
  )
}
