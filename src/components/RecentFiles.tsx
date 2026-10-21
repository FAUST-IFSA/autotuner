import { useEffect, useState } from 'react'
import { type RecentSummary, deleteRecent, listRecent } from '../storage/recent'

interface Props {
  disabled: boolean
  onOpen: (id: string) => void
}

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

const formatWhen = (ms: number) => {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ms).toLocaleDateString()
}

/** Projects stored on this device; opening one skips upload and analysis. */
export function RecentFiles({ disabled, onOpen }: Props) {
  const [recent, setRecent] = useState<RecentSummary[] | null>(null)

  useEffect(() => {
    listRecent().then(setRecent, () => setRecent([]))
  }, [])

  if (!recent?.length) return null

  const remove = async (id: string) => {
    await deleteRecent(id)
    setRecent(await listRecent())
  }

  return (
    <section className="recent-files" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent files</h2>
      <ul>
        {recent.map((r) => (
          <li key={r.id}>
            <button type="button" className="recent-open" onClick={() => onOpen(r.id)} disabled={disabled}>
              <span className="recent-name">{r.fileName}</span>
              <span className="recent-meta">
                {formatDuration(r.durationSec)} · {r.editedCount ? `${r.editedCount} of ${r.noteCount} notes edited` : `${r.noteCount} notes`}{' '}
                · {formatWhen(r.lastOpened)}
              </span>
            </button>
            <button
              type="button"
              className="recent-delete"
              onClick={() => remove(r.id)}
              disabled={disabled}
              aria-label={`Remove ${r.fileName} from recent files`}
              title="Remove from recent files"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="recent-note">Stored only on this device.</p>
    </section>
  )
}
