import { useState } from 'react'
import { loadBackingTrack } from '../audio/backing'
import { AudioDropzone } from '../components/AudioDropzone'
import type { BackingTrack } from '../types'

interface Props {
  onLoaded: (backing: BackingTrack) => void
  onCancel: () => void
}

/** The vocal upload screen again, for the backing track. Covers the editor, which stays loaded underneath. */
export function BackingUploadScreen({ onLoaded, onCancel }: Props) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFile = async (file: File) => {
    setError(null)
    setProcessing(true)
    try {
      onLoaded(await loadBackingTrack(file, file.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong loading that file.')
      setProcessing(false)
    }
  }

  return (
    <main className="upload-screen backing-upload-screen">
      <h1>Faust Studio Autotuner</h1>
      <p className="subtitle">Drop a backing track to tune along with!</p>
      <AudioDropzone
        busyStatus={processing ? <p>Getting your backing track ready…</p> : null}
        onFile={loadFile}
        onRejected={setError}
      />
      {error && <p className="error">{error}</p>}
      <p className="backing-note">It plays under your vocal for reference. It isn't tuned or exported.</p>
      <button type="button" onClick={onCancel} disabled={processing}>
        Not now
      </button>
    </main>
  )
}
