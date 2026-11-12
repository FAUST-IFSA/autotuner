import { del, get, set } from 'idb-keyval'
import { loadBackingTrack } from '../audio/backing'
import { decodeAudioFile } from '../audio/decode'
import { isEdited } from '../audio/music'
import { voicedRuns } from '../audio/f0'
import type { BackingTrack, F0Curve, NoteSegment, Peaks, Project, TimeSpan } from '../types'

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
 * under their own key so saving an edit never rewrites the (possibly 400 MB) original file.
 */
interface StoredProject {
  id: string
  fileName: string
  file: Blob
  peaks: Peaks
  f0: F0Curve
  /** Missing in projects saved before it was added. */
  audible?: TimeSpan[]
}

/** A project's backing track file, written once when it's added; its settings are saved with the edits. */
interface StoredBacking {
  fileName: string
  file: Blob
}

type BackingSettings = Pick<BackingTrack, 'offset' | 'volume' | 'muted'>

const INDEX_KEY = 'recent:index'
const projectKey = (id: string) => `recent:project:${id}`
const notesKey = (id: string) => `recent:notes:${id}`
const backingKey = (id: string) => `recent:backing:${id}`
const backingSettingsKey = (id: string) => `recent:backing-settings:${id}`

const deleteBacking = (id: string) => Promise.all([del(backingKey(id)), del(backingSettingsKey(id))])
const deleteProject = (id: string) => Promise.all([del(projectKey(id)), del(notesKey(id)), deleteBacking(id)])

const settingsOf = ({ offset, volume, muted }: BackingTrack): BackingSettings => ({ offset, volume, muted })

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
  editedCount: project.notes.filter(isEdited).length,
  lastOpened,
})

/**
 * Every write runs here, one at a time and in order. Writes read-modify-write the index, so overlapping ones
 * could overwrite each other; and the list shown right after closing a project must include the save that
 * closing started.
 */
let writes: Promise<unknown> = Promise.resolve()
function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task, task)
  writes = run.catch(() => {})
  return run
}

const readIndex = async () => (await get<RecentSummary[]>(INDEX_KEY)) ?? []

/** The list, after any save still in progress has finished. */
export async function listRecent(): Promise<RecentSummary[]> {
  await writes
  return readIndex()
}

async function touch(project: Project, opened: number) {
  const { index, dropped } = updateIndex(await readIndex(), summarize(project, opened))
  await set(INDEX_KEY, index)
  await Promise.all(dropped.map(deleteProject))
}

/** Saves a newly analysed project at the top of the list. Storage problems are only logged. */
export function saveRecent(project: Project): Promise<void> {
  return serially(async () => {
    try {
      const stored: StoredProject = {
        id: project.id,
        fileName: project.fileName,
        file: project.file,
        peaks: project.peaks,
        f0: project.f0,
        audible: project.audible,
      }
      await set(projectKey(project.id), stored)
      await set(notesKey(project.id), project.notes)
      await touch(project, Date.now())
    } catch (err) {
      console.warn('Could not save to recent files', err)
    }
  })
}

/** Saves just the edits (called as notes or backing track settings change); keeps the list order. */
export function saveRecentEdits(project: Project): Promise<void> {
  return serially(async () => {
    try {
      if (!(await get(projectKey(project.id)))) return
      await set(notesKey(project.id), project.notes)
      if (project.backing) await set(backingSettingsKey(project.id), settingsOf(project.backing))
      const index = await readIndex()
      const entry = index.find((r) => r.id === project.id)
      if (entry)
        await set(
          INDEX_KEY,
          index.map((r) => (r.id === project.id ? summarize(project, r.lastOpened) : r)),
        )
    } catch (err) {
      console.warn('Could not save edits to recent files', err)
    }
  })
}

/** Saves a project's new backing track. Only for projects already in recent files; problems are only logged. */
export function saveRecentBacking(id: string, backing: BackingTrack): Promise<void> {
  return serially(async () => {
    try {
      if (!(await get(projectKey(id)))) return
      const stored: StoredBacking = { fileName: backing.fileName, file: backing.file }
      await set(backingKey(id), stored)
      await set(backingSettingsKey(id), settingsOf(backing))
    } catch (err) {
      console.warn('Could not save the backing track to recent files', err)
    }
  })
}

export function deleteRecentBacking(id: string): Promise<void> {
  return serially(async () => {
    try {
      await deleteBacking(id)
    } catch (err) {
      console.warn('Could not remove the backing track from recent files', err)
    }
  })
}

/** Decodes a stored backing track again. One that won't load is left out rather than failing the project. */
async function reopenBacking(stored: StoredBacking, settings: BackingSettings | undefined) {
  try {
    return { ...(await loadBackingTrack(stored.file, stored.fileName)), ...settings }
  } catch (err) {
    console.warn('Could not reopen the backing track', err)
    return undefined
  }
}

/** Reopens a project: decodes the stored original, reuses the stored analysis and edits. */
export async function openRecent(id: string): Promise<Project> {
  const [stored, notes, storedBacking, backingSettings] = await Promise.all([
    get<StoredProject>(projectKey(id)),
    get<NoteSegment[]>(notesKey(id)),
    get<StoredBacking>(backingKey(id)),
    get<BackingSettings>(backingSettingsKey(id)),
  ])
  if (!stored || !notes) throw new Error('That project is no longer in recent files.')
  const buffer = await decodeAudioFile(stored.file, stored.fileName)
  const backing = storedBacking && (await reopenBacking(storedBacking, backingSettings))
  // Older saves don't have it; the display curve's voiced runs are the closest stand-in (they cover less).
  const project: Project = { ...stored, audible: stored.audible ?? voicedRuns(stored.f0), notes, buffer, backing }
  await serially(() => touch(project, Date.now())).catch((err) => console.warn('Could not update recent files', err))
  return project
}

export function deleteRecent(id: string): Promise<void> {
  return serially(async () => {
    await deleteProject(id)
    await set(
      INDEX_KEY,
      (await readIndex()).filter((r) => r.id !== id),
    )
  })
}
