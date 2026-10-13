import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { loadAudioFile } from '../audio/decode'
import type { Project } from '../types'

const MAX_FILE_BYTES = 100 * 1024 * 1024

interface Props {
  onLoaded: (project: Project) => void
}

export function UploadScreen({ onLoaded }: Props) {
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const onDropAccepted = useCallback(
    async ([file]: File[]) => {
      setError(null)
      setProcessing(true)
      setProgress(0)
      try {
        onLoaded(await loadAudioFile(file, setProgress))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong loading that file.')
        setProcessing(false)
      }
    },
    [onLoaded],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted,
    onDropRejected: () => setError('Please drop a single audio file under 100 MB.'),
    accept: { 'audio/*': [] },
    maxFiles: 1,
    maxSize: MAX_FILE_BYTES,
    disabled: processing,
  })

  return (
    <main className="upload-screen">
      <h1>Faust Studio Autotuner</h1>
      <p className="subtitle">Drop a vocal to autotune!</p>
      <div {...getRootProps({ className: `dropzone${isDragActive ? ' active' : ''}${processing ? ' busy' : ''}` })}>
        <input {...getInputProps()} />
        {processing ? (
          <p>Finding the notes in your vocal… {Math.round(progress * 100)}%</p>
        ) : (
          <>
            <p className="dropzone-title">{isDragActive ? 'Drop it here' : 'Drag an audio file here'}</p>
            <p className="dropzone-hint">or click to browse · WAV, MP3, OGG, FLAC · up to 10 minutes</p>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
