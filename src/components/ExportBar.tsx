import { useEffect, useRef, useState } from 'react'
import { type ExportFormat, type ExportStatus, exportTuned, saveFile } from '../audio/exportFile'
import { isEdited } from '../editor/edits'
import type { Project } from '../types'

interface Props {
  project: Project
  /** Called with the saved file's name once the download has started. */
  onExported: (fileName: string) => void
}

const describe = (format: ExportFormat, status: ExportStatus | null) => {
  if (!status) return 'Preparing…'
  const percent = Math.round(status.fraction * 100)
  return status.stage === 'render' ? `Rendering ${format.toUpperCase()}… ${percent}%` : `Encoding MP3… ${percent}%`
}

export function ExportBar({ project, onExported }: Props) {
  const changed = project.notes.filter(isEdited).length
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState<{ format: ExportFormat; status: ExportStatus | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menuOpen])

  const run = async (format: ExportFormat) => {
    setMenuOpen(false)
    setError(null)
    setBusy({ format, status: null })
    try {
      const { blob, fileName } = await exportTuned(project, format, (status) => setBusy({ format, status }))
      saveFile(blob, fileName)
      onExported(fileName)
    } catch (err) {
      console.error(err)
      const reason = err instanceof Error ? err.message : String(err)
      setError(
        format === 'mp3'
          ? `MP3 export failed (${reason}). Try again, or export as WAV.`
          : `WAV export failed (${reason}). Try again, or try a shorter recording.`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <footer className="export-bar">
      <span>
        {changed === 0 ? 'No notes changed yet' : `${changed} of ${project.notes.length} notes changed`}
      </span>
      {error && <span className="error export-error">{error}</span>}
      <div className="export-menu" ref={menuRef}>
        {busy ? (
          <span className="export-progress" role="status">
            {describe(busy.format, busy.status)}
          </span>
        ) : (
          <button
            type="button"
            className="primary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Export ▾
          </button>
        )}
        {menuOpen && (
          <div className="export-options" role="menu">
            <button type="button" role="menuitem" onClick={() => run('wav')}>
              Export as WAV
              <small>Full quality, 24-bit</small>
            </button>
            <button type="button" role="menuitem" onClick={() => run('mp3')}>
              Export as MP3
              <small>Smaller file, 192 kbps</small>
            </button>
          </div>
        )}
      </div>
    </footer>
  )
}
