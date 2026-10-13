import { isEdited, shiftOf } from '../editor/edits'
import type { Project } from '../types'

interface Props {
  project: Project
}

function downloadCorrections(project: Project) {
  const corrections = project.notes
    .filter(isEdited)
    .map((n) => ({
      start: n.start,
      end: n.end,
      originalMidi: n.originalMidi,
      detectedMidi: +n.detectedMidi.toFixed(3),
      targetMidi: +n.midi.toFixed(3),
      semitones: +shiftOf(n).toFixed(3),
    }))
  const json = JSON.stringify(
    { fileName: project.fileName, sampleRate: project.buffer.sampleRate, corrections },
    null,
    2,
  )
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${project.fileName.replace(/\.[^.]+$/, '')}-corrections.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function ExportBar({ project }: Props) {
  const changed = project.notes.filter(isEdited).length

  return (
    <footer className="export-bar">
      <span>
        {changed === 0
          ? 'No notes changed yet'
          : `${changed} of ${project.notes.length} notes changed`}
      </span>
      <span className="export-note">Audio export coming soon</span>
      <button type="button" className="primary" disabled={changed === 0} onClick={() => downloadCorrections(project)}>
        Export corrections
      </button>
    </footer>
  )
}
