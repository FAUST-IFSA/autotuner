import { useCallback, useState } from 'react'
import { EditorScreen } from './screens/EditorScreen'
import { UploadScreen } from './screens/UploadScreen'
import type { NoteSegment, Project } from './types'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)

  const setNotes = useCallback((update: (notes: NoteSegment[]) => NoteSegment[]) => {
    setProject((p) => p && { ...p, notes: update(p.notes) })
  }, [])

  if (!project) return <UploadScreen onLoaded={setProject} />
  return <EditorScreen project={project} onNotesChange={setNotes} onReset={() => setProject(null)} />
}
