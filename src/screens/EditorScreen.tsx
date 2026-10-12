import { ExportBar } from '../components/ExportBar'
import { PitchEditor } from '../editor/PitchEditor'
import type { Project } from '../types'

interface Props {
  project: Project
  onNoteMidiChange: (id: string, midi: number) => void
  onReset: () => void
}

export function EditorScreen({ project, onNoteMidiChange, onReset }: Props) {
  return (
    <main className="editor-screen">
      <header className="editor-header">
        <button type="button" onClick={onReset}>
          ← New file
        </button>
        <span className="file-name">{project.fileName}</span>
        <span className="file-meta">
          {project.buffer.duration.toFixed(1)}s · {project.notes.length} segments
        </span>
        <span className="hint">Drag blocks up/down to change pitch · Ctrl + scroll to zoom · Shift + scroll to pan</span>
      </header>
      <PitchEditor
        peaks={project.peaks}
        notes={project.notes}
        duration={project.buffer.duration}
        onNoteMidiChange={onNoteMidiChange}
      />
      <ExportBar project={project} />
    </main>
  )
}
