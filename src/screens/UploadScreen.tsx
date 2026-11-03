import { type ReactNode, useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { loadAudioFile } from '../audio/loadAudioFile'
import { RecentFiles } from '../components/RecentFiles'
import { openRecent, saveRecent } from '../storage/recent'
import type { Project } from '../types'

// Fits 10 minutes of 96 kHz / 24-bit stereo WAV (346 MB). Memory follows duration, not file size, so the
// 10-minute limit in loadAudioFile is the real guard; this only stops a huge file being read in at all.
const MAX_FILE_BYTES = 400 * 1024 * 1024

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
        const project = await loadAudioFile(file, setProgress)
        // Approximate notes aren't kept: reopening never re-analyses, so they'd outlive a working model.
        if (!project.approximateNotes) void saveRecent(project)
        onLoaded(project)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong loading that file.')
        setProcessing(false)
      }
    },
    [onLoaded],
  )

  const [opening, setOpening] = useState(false)
  const openProject = async (id: string) => {
    setError(null)
    setOpening(true)
    try {
      onLoaded(await openRecent(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that project.")
      setOpening(false)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted,
    onDropRejected: () => setError(`Please drop a single audio file under ${MAX_FILE_BYTES / 1024 / 1024} MB.`),
    accept: { 'audio/*': [] },
    maxFiles: 1,
    maxSize: MAX_FILE_BYTES,
    disabled: processing || opening,
  })

  let status: ReactNode
  if (opening) status = <p>Opening…</p>
  else if (processing) status = <p>Finding the notes in your vocal… {Math.round(progress * 100)}%</p>
  else {
    status = (
      <>
        <p className="dropzone-title">{isDragActive ? 'Drop it here' : 'Drag an audio file here'}</p>
        <p className="dropzone-hint">or click to browse · WAV, MP3, OGG, FLAC</p>
      </>
    )
  }

  return (
    <main className="upload-screen">
      <h1>Faust Studio Autotuner</h1>
      <p className="subtitle">Drop a vocal to autotune!</p>
      <div {...getRootProps({ className: `dropzone${isDragActive ? ' active' : ''}${processing ? ' busy' : ''}` })}>
        <input {...getInputProps()} />
        {status}
      </div>
      {error && <p className="error">{error}</p>}
      <RecentFiles disabled={processing || opening} onOpen={openProject} />
    </main>
  )
}
