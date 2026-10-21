import { del, get, set } from 'idb-keyval'
import { decodeAudioFile } from '../audio/decode'
import type { F0Curve, NoteSegment, Peaks, Project } from '../types'

export const MAX_RECENT = 10

/** What the recent-files list shows. */
export interface RecentSummary {
  id: string
  fileName: string
  durationSec: number
  noteCount: number
  editedCount: number
  /** ms since epoch */
  lastOpened: number
}

/**
 * Everything needed to reopen a project without uploading or analysing again. Written once; edits live
 * under their own key so saving an edit never rewrites the (possibly 100 MB) original file.
 */
interface StoredProject {
  id: string
  fileName: string
  file: Blob
  peaks: Peaks
  f0: F0Curve
}

const INDEX_KEY = 'recent:index'
const projectKey = (id: string) => `recent:project:${id}`
const notesKey = (id: string) => `recent:notes:${id}`

/** Most recent first, at most `max`; returns the list to keep and the ids that fell off. */
export function updateIndex(
  index: RecentSummary[],
  entry: RecentSummary,
  max = MAX_RECENT,
): { index: RecentSummary[]; dropped: string[] } {
  const sorted = [entry, ...index.filter((r) => r.id !== entry.id)].sort((a, b) => b.lastOpened - a.lastOpened)
  return { index: sorted.slice(0, max), dropped: sorted.slice(max).map((r) => r.id) }
}

const summarize = (project: Project, lastOpened: number): RecentSummary => ({
  id: project.id,
  fileName: project.fileName,
  durationSec: project.buffer.duration,
  noteCount: project.notes.length,
  editedCount: project.notes.filter((n) => Math.abs(n.midi - n.detectedMidi) > 1e-6).length,
  lastOpened,
})

export async function listRecent(): Promise<RecentSummary[]> {
  return (await get<RecentSummary[]>(INDEX_KEY)) ?? []
}

async function touch(project: Project, opened: number) {
  const { index, dropped } = updateIndex(await listRecent(), summarize(project, opened))
  await set(INDEX_KEY, index)
  await Promise.all(dropped.flatMap((id) => [del(projectKey(id)), del(notesKey(id))]))
}

/** Saves a newly analysed project at the top of the list. Storage problems are only logged. */
export async function saveRecent(project: Project): Promise<void> {
  try {
    const stored: StoredProject = {
      id: project.id,
      fileName: project.fileName,
      file: project.file,
      peaks: project.peaks,
      f0: project.f0,
    }
    await set(projectKey(project.id), stored)
    await set(notesKey(project.id), project.notes)
    await touch(project, Date.now())
  } catch (err) {
    console.warn('Could not save to recent files', err)
  }
}

/** Saves just the edits (called as notes change); keeps the list order. */
export async function saveRecentNotes(project: Project): Promise<void> {
  try {
    if (!(await get(projectKey(project.id)))) return
    await set(notesKey(project.id), project.notes)
    const index = await listRecent()
    const entry = index.find((r) => r.id === project.id)
    if (entry) await set(INDEX_KEY, index.map((r) => (r.id === project.id ? summarize(project, r.lastOpened) : r)))
  } catch (err) {
    console.warn('Could not save edits to recent files', err)
  }
}

/** Reopens a project: decodes the stored original, reuses the stored analysis and edits. */
export async function openRecent(id: string): Promise<Project> {
  const [stored, notes] = await Promise.all([get<StoredProject>(projectKey(id)), get<NoteSegment[]>(notesKey(id))])
  if (!stored || !notes) throw new Error('That project is no longer in recent files.')
  const buffer = await decodeAudioFile(stored.file, stored.fileName)
  const project: Project = { ...stored, notes, buffer }
  await touch(project, Date.now()).catch((err) => console.warn('Could not update recent files', err))
  return project
}

export async function deleteRecent(id: string): Promise<void> {
  await Promise.all([del(projectKey(id)), del(notesKey(id))])
  await set(
    INDEX_KEY,
    (await listRecent()).filter((r) => r.id !== id),
  )
}
