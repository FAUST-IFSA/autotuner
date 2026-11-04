import { useEffect } from 'react'

interface Props {
  onAdd: () => void
  onSkip: () => void
}

/** Asked once, after a new vocal has been analysed, before the editor opens. */
export function AddBackingScreen({ onAdd, onSkip }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSkip])

  return (
    <main className="upload-screen backing-upload-screen">
      <h1>Add a backing track?</h1>
      <p className="subtitle">
        Your vocal is ready. Add the song's backing track to hear your vocal with the music while you tune. It's only
        for reference: it isn't tuned or exported.
      </p>
      <div className="add-backing-actions">
        <button type="button" className="primary" onClick={onAdd} autoFocus>
          Add backing track
        </button>
        <button type="button" onClick={onSkip}>
          Not now
        </button>
      </div>
    </main>
  )
}
