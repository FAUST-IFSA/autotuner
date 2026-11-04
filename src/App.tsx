import { useCallback, useEffect, useState } from 'react'
import { AddBackingPrompt } from './components/AddBackingPrompt'
import type { BackingSettingsUpdate } from './components/BackingBar'
import { BackingUploadScreen } from './screens/BackingUploadScreen'
import { DownloadedScreen } from './screens/DownloadedScreen'
import { EditorScreen } from './screens/EditorScreen'
import { deleteRecentBacking, saveRecentBacking, saveRecentEdits } from './storage/recent'
import { UploadScreen } from './screens/UploadScreen'
import type { BackingTrack, NoteSegment, Project } from './types'

/** Adding a backing track: asked once after a new upload, then its upload screen (both cover the editor). */
type BackingStep = 'ask' | 'upload'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  /** Set after an export: shows the Downloaded screen (the project stays loaded behind it). */
  const [savedFile, setSavedFile] = useState<string | null>(null)
  const [backingStep, setBackingStep] = useState<BackingStep | null>(null)

  const setNotes = useCallback((update: (notes: NoteSegment[]) => NoteSegment[]) => {
    setProject((p) => p && { ...p, notes: update(p.notes) })
  }, [])

  const changeBacking = useCallback((update: BackingSettingsUpdate) => {
    setProject((p) => (p?.backing ? { ...p, backing: { ...p.backing, ...update } } : p))
  }, [])

  // Keep the recent-files copy of the edits current, a moment after editing stops.
  useEffect(() => {
    if (!project) return
    const timer = setTimeout(() => void saveRecentEdits(project), 800)
    return () => clearTimeout(timer)
  }, [project])

  // Closing the project: save its latest edits now (the debounced save above would be cancelled) and drop
  // any Downloaded screen with it.
  const closeProject = () => {
    if (project) void saveRecentEdits(project)
    setSavedFile(null)
    setBackingStep(null)
    setProject(null)
  }

  const openProject = (opened: Project, fresh: boolean) => {
    setProject(opened)
    if (fresh) setBackingStep('ask')
  }

  const skipBacking = useCallback(() => setBackingStep(null), [])

  if (!project) return <UploadScreen onLoaded={openProject} />

  const addBacking = (backing: BackingTrack) => {
    setProject((p) => p && { ...p, backing })
    void saveRecentBacking(project.id, backing)
    setBackingStep(null)
  }

  const removeBacking = () => {
    setProject((p) => p && { ...p, backing: undefined })
    void deleteRecentBacking(project.id)
  }

  return (
    <>
      {/* The editor stays mounted under the other screens so undo history and selection survive. */}
      <EditorScreen
        project={project}
        onNotesChange={setNotes}
        onReset={closeProject}
        onExported={setSavedFile}
        onAddBacking={() => setBackingStep('upload')}
        onBackingChange={changeBacking}
        onRemoveBacking={removeBacking}
        suspended={savedFile !== null || backingStep !== null}
      />
      {backingStep === 'ask' && <AddBackingPrompt onAdd={() => setBackingStep('upload')} onSkip={skipBacking} />}
      {backingStep === 'upload' && <BackingUploadScreen onLoaded={addBacking} onCancel={skipBacking} />}
      {savedFile && (
        <DownloadedScreen fileName={savedFile} onBack={() => setSavedFile(null)} onNewVocal={closeProject} />
      )}
    </>
  )
}
