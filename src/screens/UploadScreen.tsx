import { type ReactNode, useState } from 'react'
import { loadAudioFile } from '../audio/loadAudioFile'
import { AudioDropzone } from '../components/AudioDropzone'
import { RecentFiles } from '../components/RecentFiles'
import { openRecent, saveRecent } from '../storage/recent'
import type { Project } from '../types'

interface Props {
  /** `fresh` is true for a new upload, false for a project reopened from recent files. */
  onLoaded: (project: Project, fresh: boolean) => void
}

export function UploadScreen({ onLoaded }: Props) {
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const loadFile = async (file: File) => {
    setError(null)
    setProcessing(true)
    setProgress(0)
    try {
      const project = await loadAudioFile(file, setProgress)
      // Approximate notes aren't kept: reopening never re-analyses, so they'd outlive a working model.
      if (!project.approximateNotes) void saveRecent(project)
      onLoaded(project, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong loading that file.')
      setProcessing(false)
    }
  }

  const [opening, setOpening] = useState(false)
  const openProject = async (id: string) => {
    setError(null)
    setOpening(true)
    try {
      onLoaded(await openRecent(id), false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that project.")
      setOpening(false)
    }
  }

  let busyStatus: ReactNode = null
  if (opening) busyStatus = <p>Opening…</p>
  else if (processing) busyStatus = <p>Finding the notes in your vocal… {Math.round(progress * 100)}%</p>

  return (
    <main className="upload-screen">
      <h1>Faust Studio Autotuner</h1>
      <p className="subtitle">Drop a vocal to autotune!</p>
      <AudioDropzone busyStatus={busyStatus} onFile={loadFile} onRejected={setError} />
      {error && <p className="error">{error}</p>}
      <RecentFiles disabled={processing || opening} onOpen={openProject} />
    </main>
  )
}
