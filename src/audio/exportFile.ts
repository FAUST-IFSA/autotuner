import type { Project } from '../types'
import { copyChannels } from './channels'
import { renderTuned, resample } from './export'
import { decodeAtRate, readNativeSampleRate } from './nativeRate'
import { mp3SampleRateFor } from './mp3Limits'
import type { Mp3Message, Mp3Request } from './mp3.worker'
import { encodeWav } from './wav'

export type ExportFormat = 'wav' | 'mp3'

export interface ExportStatus {
  stage: 'render' | 'encode'
  fraction: number
}

/** "vocal.mp3" -> "vocal-tuned.wav" */
export const tunedFileName = (fileName: string, format: ExportFormat) =>
  `${fileName.replace(/\.[^.]+$/, '') || 'vocal'}-tuned.${format}`

function encodeMp3InWorker(channels: Float32Array[], sampleRate: number, onProgress: (f: number) => void) {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Mp3Message>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress(message.fraction)
      worker.terminate()
      if (message.type === 'done') resolve(new Blob(message.chunks as BlobPart[], { type: 'audio/mpeg' }))
      else reject(new Error(message.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'MP3 encoding failed.'))
    }
    const request: Mp3Request = { channels, sampleRate }
    worker.postMessage(
      request,
      channels.map((c) => c.buffer),
    )
  })
}

/**
 * The recording at the sample rate it was made at. The project's buffer is at the playback context's rate
 * (decodeAudioData resamples), so when the file's header says otherwise it is decoded again at its own rate,
 * just for this export. Note times are in seconds, so the edits line up either way. Unknown formats (e.g.
 * M4A) and any failure fall back to the project's buffer.
 */
async function atNativeRate(project: Project): Promise<AudioBuffer> {
  try {
    const rate = await readNativeSampleRate(project.file)
    if (!rate || rate === project.buffer.sampleRate) return project.buffer
    return await decodeAtRate(project.file, rate)
  } catch (err) {
    console.warn('Exporting at the playback rate: could not decode at the file rate', err)
    return project.buffer
  }
}

/** Renders the edited vocal at full quality and encodes it. */
export async function exportTuned(
  project: Project,
  format: ExportFormat,
  onStatus: (status: ExportStatus) => void = () => {},
): Promise<{ blob: Blob; fileName: string }> {
  const render = (fraction: number) => onStatus({ stage: 'render', fraction })
  let source = await atNativeRate(project)
  // MP3 only supports the standard MPEG rates (up to 48 kHz); WAV keeps the file's own rate.
  const mp3Rate = mp3SampleRateFor(source.sampleRate)
  if (format === 'mp3' && mp3Rate !== source.sampleRate) source = await resample(source, mp3Rate)
  const rendered = await renderTuned(source, project.notes, render)
  const channels = copyChannels(rendered)
  const blob =
    format === 'wav'
      ? new Blob([encodeWav(channels, rendered.sampleRate)], { type: 'audio/wav' })
      : await encodeMp3InWorker(channels, rendered.sampleRate, (fraction) => onStatus({ stage: 'encode', fraction }))
  return { blob, fileName: tunedFileName(project.fileName, format) }
}

/** Hands a file to the browser's downloads. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Give the download a moment to start before releasing the data.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
