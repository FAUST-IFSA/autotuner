import { useCallback, useEffect, useState } from 'react'
import { DownloadedScreen } from './screens/DownloadedScreen'
import { EditorScreen } from './screens/EditorScreen'
import { saveRecentNotes } from './storage/recent'
import { UploadScreen } from './screens/UploadScreen'
import type { NoteSegment, Project } from './types'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  /** Set after an export: shows the Downloaded screen (the project stays loaded behind it). */
  const [savedFile, setSavedFile] = useState<string | null>(null)

  const setNotes = useCallback((update: (notes: NoteSegment[]) => NoteSegment[]) => {
    setProject((p) => p && { ...p, notes: update(p.notes) })
  }, [])

  // Keep the recent-files copy of the edits current, a moment after editing stops.
  useEffect(() => {
    if (!project) return
    const timer = setTimeout(() => void saveRecentNotes(project), 800)
    return () => clearTimeout(timer)
  }, [project])

  // Closing the project: save its latest edits now (the debounced save above would be cancelled) and drop
  // any Downloaded screen with it.
  const closeProject = () => {
    if (project) void saveRecentNotes(project)
    setSavedFile(null)
    setProject(null)
  }

  if (!project) return <UploadScreen onLoaded={setProject} />
  return (
    <>
      {/* The editor stays mounted under the Downloaded screen so undo history and selection survive. */}
      <EditorScreen
        project={project}
        onNotesChange={setNotes}
        onReset={closeProject}
        onExported={setSavedFile}
        suspended={savedFile !== null}
      />
      {savedFile && (
        <DownloadedScreen fileName={savedFile} onBack={() => setSavedFile(null)} onNewVocal={closeProject} />
      )}
    </>
  )
}
