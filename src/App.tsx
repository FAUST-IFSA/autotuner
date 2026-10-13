import { useCallback, useState } from 'react'
import { EditorScreen } from './screens/EditorScreen'
import { UploadScreen } from './screens/UploadScreen'
import type { Project } from './types'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)

  const setNoteMidi = useCallback((id: string, midi: number) => {
    setProject((p) => p && { ...p, notes: p.notes.map((n) => (n.id === id ? { ...n, midi } : n)) })
  }, [])

  if (!project) return <UploadScreen onLoaded={setProject} />
  return <EditorScreen project={project} onNoteMidiChange={setNoteMidi} onReset={() => setProject(null)} />
}
