// Dev-only page behind `npm run sweep` (sweep.html). Not imported by the app, so never bundled.
// For each input file it renders one audio file per value of the swept parameter, through the same note
// pipeline, transpose schedule and Signalsmith render as the app's export, so the files can be compared by ear.
import * as tf from '@tensorflow/tfjs'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { get, set } from 'idb-keyval'
import config from '../../sweep/sweep.config'
import { copyChannels } from '../audio/channels'
import { decodeAudioFile } from '../audio/decode'
import { renderTuned } from '../audio/export'
import { ANALYSIS_SAMPLE_RATE, NOTE_CLARITY, audibleRuns, computeF0 } from '../audio/f0'
import { resampleForAnalysis } from '../audio/loadAudioFile'
import { isEdited } from '../audio/music'
import { decodeBasicPitch, evaluateBasicPitch, notesFromRaw, type Posteriors } from '../audio/notes'
import { DEFAULT_PARAMS, type TuningParams } from '../audio/params'
import { buildSchedule, shiftAt } from '../audio/schedule'
import { encodeWav } from '../audio/wav'
import type { F0Curve, NoteSegment, TimeSpan } from '../types'
import type { SweepEdit } from './sweepConfig'

const AUDIO_FILE = /\.(wav|mp3|m4a|flac|ogg|aac|opus)$/i
const inputUrls = import.meta.glob('/sweep/inputs/*', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>

const out = document.getElementById('out')!
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}

const { param, values } = config.sweep
const baseParams: TuningParams = { ...DEFAULT_PARAMS, ...config.base }
document
  .getElementById('summary')!
  .append(
    `Sweeping `,
    el('code', param),
    ` over ${values.join(', ')} (default ${DEFAULT_PARAMS[param]}), edit `,
    el('code', JSON.stringify(config.edit)),
    config.window ? `, window ${config.window[0]}–${config.window[1]} s.` : '.',
  )

async function loadModel() {
  setWasmPaths(`${location.origin}${import.meta.env.BASE_URL}tfjs-wasm/`)
  await tf.setBackend('wasm')
  await tf.ready()
  return tf.loadGraphModel(`${location.origin}${import.meta.env.BASE_URL}models/basic-pitch/model.json`)
}

/** The model output is the slow part and doesn't depend on any swept value, so it is kept across reloads. */
async function posteriorsFor(name: string, blob: Blob, samples: Float32Array, status: (s: string) => void) {
  const key = `sweep:${name}:${blob.size}:${samples.length}`
  const cached = await get<Posteriors>(key).catch(() => undefined)
  if (cached) return cached
  const model = await loadModel()
  const posteriors = await evaluateBasicPitch(samples, model, (p) => status(`Analysing ${Math.round(p * 100)}%`))
  await set(key, posteriors).catch(() => {})
  return posteriors
}

function applyEdit(notes: NoteSegment[], edit: SweepEdit): NoteSegment[] {
  const [from, to] = edit.range ?? [0, Infinity]
  return notes.map((n) =>
    n.end > from && n.start < to ? { ...n, midi: 'shift' in edit ? n.detectedMidi + edit.shift : n.originalMidi } : n,
  )
}

/** Share of the voiced audio in the edited range that the schedule leaves at its original pitch. */
function unshiftedShare(f0: F0Curve, notes: NoteSegment[], audible: TimeSpan[], edit: SweepEdit, params: TuningParams) {
  const schedule = buildSchedule(notes, audible, params)
  const [from, to] = edit.range ?? [0, Infinity]
  let voiced = 0
  let unshifted = 0
  f0.midi.forEach((m, i) => {
    const t = i * f0.hopSec
    if (m === null || f0.clarity[i] < NOTE_CLARITY || t < from || t > to) return
    voiced++
    if (Math.abs(shiftAt(schedule, t)) < 1e-6) unshifted++
  })
  return voiced ? unshifted / voiced : 0
}

/** Playing one file stops the others and continues from the same position, so they can be compared. */
function linkPlayers(players: HTMLAudioElement[]) {
  let position = 0
  for (const player of players) {
    player.addEventListener('play', () => {
      for (const other of players) if (other !== player) other.pause()
      if (Math.abs(player.currentTime - position) > 0.05) player.currentTime = position
    })
    player.addEventListener('timeupdate', () => {
      if (!player.paused) position = player.currentTime
    })
    player.addEventListener('seeked', () => {
      position = player.currentTime
    })
  }
}

function wavUrl(buffer: AudioBuffer) {
  const [from, to] = config.window ?? [0, buffer.duration]
  const blob = new Blob([encodeWav(copyChannels(buffer, from, to), buffer.sampleRate)], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

function addRow(group: HTMLElement, label: string, url: string, fileName: string, meta: string, isDefault = false) {
  const row = el('div', '', 'row')
  const audio = el('audio')
  audio.controls = true
  audio.preload = 'auto'
  audio.src = url
  const link = el('a', 'download')
  link.href = url
  link.download = fileName
  const labelEl = el('div', label, isDefault ? 'default' : '')
  const info = el('div', meta, 'meta')
  info.append(' · ', link)
  row.append(labelEl, audio, info)
  group.append(row)
  return audio
}

async function runFile(name: string, blob: Blob) {
  const group = el('section')
  const status = el('span')
  const heading = el('h2', name + '  ')
  heading.append(status)
  group.append(heading)
  out.append(group)
  const setStatus = (text: string, error = false) => {
    status.textContent = text
    status.className = error ? 'err' : ''
  }
  try {
    setStatus('Decoding')
    const buffer = await decodeAudioFile(blob, name)
    const samples = await resampleForAnalysis(buffer)
    const f0 = computeF0(samples, ANALYSIS_SAMPLE_RATE)
    const audible = audibleRuns(samples)
    const posteriors = await posteriorsFor(name, blob, samples, setStatus)

    const players = [
      addRow(group, 'original', wavUrl(buffer), `${name}-original.wav`, `${buffer.duration.toFixed(1)} s`),
    ]
    for (const [i, value] of values.entries()) {
      setStatus(`Rendering ${i + 1}/${values.length}`)
      const params = { ...baseParams, [param]: value }
      const notes = applyEdit(notesFromRaw(decodeBasicPitch(posteriors, params), f0, params), config.edit)
      const started = performance.now()
      const rendered = await renderTuned(buffer, notes, audible, undefined, params)
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      const meta = [
        `${notes.length} notes, ${notes.filter(isEdited).length} edited`,
        'shift' in config.edit
          ? `${Math.round(unshiftedShare(f0, notes, audible, config.edit, params) * 100)}% of voiced audio unshifted`
          : '',
        `rendered in ${seconds} s`,
      ]
      players.push(
        addRow(
          group,
          `${param} = ${value}${value === baseParams[param] ? ' (default)' : ''}`,
          wavUrl(rendered),
          `${name}-${param}-${value}.wav`,
          meta.filter(Boolean).join(' · '),
          value === baseParams[param],
        ),
      )
    }
    linkPlayers(players)
    setStatus('')
  } catch (err) {
    console.error(err)
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
}

async function runAll(files: { name: string; blob: Blob }[]) {
  for (const { name, blob } of files) await runFile(name, blob)
}

async function inputFiles() {
  const wanted = config.files
  const entries = Object.entries(inputUrls).filter(
    ([path]) => AUDIO_FILE.test(path) && (!wanted || wanted.some((w) => path.includes(w))),
  )
  return Promise.all(
    entries.map(async ([path, url]) => ({
      name: path.split('/').pop()!,
      blob: await (await fetch(await url())).blob(),
    })),
  )
}

document.getElementById('picker')!.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement
  void runAll([...(input.files ?? [])].map((file) => ({ name: file.name, blob: file })))
})

void inputFiles().then((files) => {
  if (files.length === 0) {
    out.append(el('p', 'No audio in sweep/inputs/ yet. Drop files there and reload, or pick a file above.'))
  }
  return runAll(files)
})
