// Dev-only page (compare.html, served by `npm run dev` at /compare.html; not part of the build). Renders one
// passage of a vocal (edited by Tune Up, by snapping to the key, or by the user in the app) once per shift
// variant (shiftVariants.ts), through the same Signalsmith offline render as export, to compare by ear.
// Inputs default to fixtures/pairs/alone-with-you_*.flac (see fixtures/pairs/README.md); override them with
// ?vocal=/fixtures/...&backing=/fixtures/...
import { get, set } from 'idb-keyval'
import SignalsmithStretch from 'signalsmith-stretch'
import { copyChannels, resampleMono } from '../audio/channels'
import { decodeAudioFile, getAudioContext } from '../audio/decode'
import { voicedRuns } from '../audio/f0'
import { KEY_SAMPLE_RATE, detectKey, keyName } from '../audio/key'
import { loadAudioFile } from '../audio/loadAudioFile'
import { median, midiToHz, shiftOf } from '../audio/music'
import { type ShiftChange, ShiftScheduler } from '../audio/schedule'
import { VOICE, outputLatencyOf } from '../audio/stretch'
import { encodeWav } from '../audio/wav'
import { applyEdit, tuneUp } from '../editor/edits'
import type { F0Curve, NoteSegment, TimeSpan } from '../types'
import { VARIANTS, type Variant, snapToKey, variantSchedule } from './shiftVariants'

const params = new URLSearchParams(location.search)
const VOCAL_URL = params.get('vocal') ?? '/fixtures/pairs/alone-with-you_vocal.flac'
const BACKING_URL = params.get('backing') ?? '/fixtures/pairs/alone-with-you_backing.flac'
const PASSAGE_SECONDS = 20

const $ = (id: string) => document.getElementById(id)!
const status = (text: string) => ($('status').textContent = text)
const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

async function fetchBlob(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}. Make the pairs first (fixtures/pairs/README.md).`)
  return response.blob()
}

/** Notes, F0 and sound spans for the whole vocal, from the app's analysis; cached, since it takes minutes on a long file. */
async function analyse(blob: Blob, name: string) {
  const key = `compare:analysis:${name}:${blob.size}`
  const cached = await get<{ notes: NoteSegment[]; f0: F0Curve; audible?: TimeSpan[] }>(key)
  // Entries cached before `audible` existed are analysed again.
  if (cached?.audible) {
    const { notes, f0, audible } = cached
    return { notes, f0, audible, buffer: await decodeAudioFile(blob, name) }
  }
  const project = await loadAudioFile(new File([blob], name), (f) =>
    status(`Analysing ${name}… ${Math.round(f * 100)}%`),
  )
  await set(key, { notes: project.notes, f0: project.f0, audible: project.audible })
  return project
}

/** Up to three non-overlapping passages where Tune Up moves the most (shift × duration). */
function busiestPassages(notes: NoteSegment[], duration: number) {
  const score = (t0: number) =>
    notes.reduce((sum, n) => {
      const overlap = Math.min(n.end, t0 + PASSAGE_SECONDS) - Math.max(n.start, t0)
      return overlap > 0 ? sum + Math.abs(shiftOf(n)) * overlap : sum
    }, 0)
  const starts = Array.from({ length: Math.max(1, Math.floor(duration - PASSAGE_SECONDS)) }, (_, i) => i)
  const ranked = starts.map((t0) => ({ t0, score: score(t0) })).sort((a, b) => b.score - a.score)
  const picked: number[] = []
  for (const { t0 } of ranked) {
    if (picked.every((p) => Math.abs(p - t0) >= PASSAGE_SECONDS)) picked.push(t0)
    if (picked.length === 3) break
  }
  return picked
}

function slice(buffer: AudioBuffer, from: number, to: number) {
  const channels = copyChannels(buffer, from, to)
  const out = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: buffer.sampleRate,
  })
  channels.forEach((c, i) => out.getChannelData(i).set(c))
  return out
}

function notesIn(notes: NoteSegment[], from: number, to: number) {
  return notes
    .filter((n) => n.end > from && n.start < to)
    .map((n) => ({ ...n, start: Math.max(n.start, from) - from, end: Math.min(n.end, to) - from }))
}

function spansIn(spans: TimeSpan[], from: number, to: number): TimeSpan[] {
  return spans
    .filter((s) => s.end > from && s.start < to)
    .map((s) => ({ start: Math.max(s.start, from) - from, end: Math.min(s.end, to) - from }))
}

function f0In(f0: F0Curve, from: number, to: number): F0Curve {
  const a = Math.round(from / f0.hopSec)
  const b = Math.round(to / f0.hopSec)
  return { hopSec: f0.hopSec, midi: f0.midi.slice(a, b), clarity: f0.clarity.slice(a, b) }
}

/** renderTuned (audio/export.ts) with a given timeline and stretch settings instead of the app's. */
async function render(buffer: AudioBuffer, schedule: ShiftChange[], variant: Variant, formantBaseHz: number) {
  const { sampleRate, numberOfChannels, length } = buffer
  const ctx = new OfflineAudioContext(numberOfChannels, length, sampleRate)
  const node = await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [numberOfChannels],
  })
  if (variant.blockMs) await node.configure({ blockMs: variant.blockMs })
  node.connect(ctx.destination)
  const channels = copyChannels(buffer)
  await node.addBuffers(
    channels,
    channels.map((c) => c.buffer),
  )
  const outputLatency = await outputLatencyOf(node)
  const voice = variant.fixedFormantBase ? { ...VOICE, formantBaseHz } : VOICE

  const pending: Promise<unknown>[] = []
  const scheduler = new ShiftScheduler((change, outputTime) => {
    pending.push(node.schedule({ output: change.output, outputTime, semitones: change.semitones }))
  }, outputLatency)
  await node.schedule({ active: true, input: 0, output: 0, semitones: schedule[0].semitones, ...voice })
  scheduler.reset(
    schedule.slice(1).map((c) => ({ output: c.t, semitones: c.semitones })),
    0,
  )
  scheduler.tick(0)
  const quantum = 128 / sampleRate
  const end = length / sampleRate
  const times = new Set<number>()
  for (const c of schedule.slice(1)) times.add(Math.ceil((c.t - outputLatency) / quantum) * quantum)
  for (const t of [...times].filter((time) => time > 0 && time < end).sort((a, b) => a - b)) {
    void ctx.suspend(t).then(async () => {
      scheduler.tick(ctx.currentTime)
      await Promise.all(pending.splice(0))
      await ctx.resume()
    })
  }
  await Promise.all(pending.splice(0))
  return ctx.startRendering()
}

// Playback: the rendered vocal and the backing passage loop together; switching variant keeps the place.
const audio = getAudioContext()
let rendered: AudioBuffer[] = []
let backingPassage: AudioBuffer | null = null
let playing: { index: number; sources: AudioBufferSourceNode[]; startedAt: number; from: number } | null = null
let selected = 1
let pausedAt = 0
/** A passage is being rendered: other passage buttons wait. */
let busy = false
const backingGain = new GainNode(audio, { gain: 0.25 })
backingGain.connect(audio.destination)

const position = () => {
  if (!playing) return pausedAt
  const length = rendered[playing.index].duration
  return (playing.from + audio.currentTime - playing.startedAt) % length
}

function stop() {
  if (!playing) return
  pausedAt = position()
  for (const source of playing.sources) source.stop()
  playing = null
}

async function play(index: number, from = position()) {
  stop()
  await audio.resume()
  selected = index
  const at = audio.currentTime + 0.03
  const start = (buffer: AudioBuffer, destination: AudioNode) => {
    const source = new AudioBufferSourceNode(audio, { buffer, loop: true, loopEnd: buffer.duration })
    source.connect(destination)
    source.start(at, from)
    return source
  }
  const sources = [start(rendered[index], audio.destination)]
  if (backingPassage && ($('backing') as HTMLInputElement).checked) sources.push(start(backingPassage, backingGain))
  playing = { index, sources, startedAt: at, from }
  updateButtons()
}

function updateButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((button) => {
    const index = Number(button.dataset.play)
    const on = playing?.index === index
    button.textContent = on ? 'Pause' : 'Play'
    button.classList.toggle('active', index === selected)
  })
}

function wavLink(buffer: AudioBuffer, name: string) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([encodeWav(channels, buffer.sampleRate)], { type: 'audio/wav' }))
  link.download = name
  link.textContent = 'WAV'
  return link
}

async function renderPassage(
  vocal: AudioBuffer,
  backing: AudioBuffer | null,
  notes: NoteSegment[],
  f0: F0Curve,
  audible: TimeSpan[],
  from: number,
) {
  stop()
  pausedAt = 0
  const to = Math.min(vocal.duration, from + PASSAGE_SECONDS)
  const passage = slice(vocal, from, to)
  const passageNotes = notesIn(notes, from, to)
  const passageF0 = f0In(f0, from, to)
  const passageAudible = spansIn(audible, from, to)
  backingPassage = backing && slice(backing, from, Math.min(backing.duration, to))
  const voiced = passageF0.midi.filter((m): m is number => m !== null)
  const formantBaseHz = Math.round(midiToHz(median(voiced)))
  const shifts = passageNotes.map((n) => Math.abs(shiftOf(n)))
  $('stats').textContent =
    `${formatTime(from)} to ${formatTime(to)}: the edits move ${shifts.filter((s) => s > 0).length} of ` +
    `${passageNotes.length} notes, by ${(median(shifts) * 100).toFixed(0)} cents typically and ` +
    `${(Math.max(...shifts) * 100).toFixed(0)} cents at most. Singer's typical pitch: ${formantBaseHz} Hz.`

  rendered = []
  const table = $('variants') as HTMLTableElement
  table.replaceChildren()
  for (const [i, variant] of VARIANTS.entries()) {
    status(`Rendering ${i + 1} of ${VARIANTS.length}: ${variant.name}…`)
    const schedule = variantSchedule(passageNotes, passageF0, variant, passage.duration, passageAudible)
    const buffer = variant.original ? passage : await render(passage, schedule, variant, formantBaseHz)
    rendered.push(buffer)
    const row = table.insertRow()
    const button = document.createElement('button')
    button.dataset.play = String(i)
    button.textContent = 'Play'
    button.onclick = () => (playing?.index === i ? (stop(), updateButtons()) : void play(i))
    row.insertCell().append(button)
    const label = row.insertCell()
    label.innerHTML = `<strong>${i + 1}. ${variant.name}</strong><small></small>`
    label.querySelector('small')!.textContent = variant.description
    row.insertCell().append(wavLink(buffer, `${variant.id}-${Math.round(from)}s.wav`))
  }
  updateButtons()
  status('Ready.')
}

/** The user's own edits of this file, if it's in recent files in this browser (newest first). */
async function editsFromRecent(name: string) {
  const index = (await get<{ id: string; fileName: string; editedCount: number }[]>('recent:index')) ?? []
  const entry = index.find((r) => r.fileName === name && r.editedCount > 0)
  if (!entry) return null
  const [notes, project] = await Promise.all([
    get<NoteSegment[]>(`recent:notes:${entry.id}`),
    get<{ f0: F0Curve; audible?: TimeSpan[] }>(`recent:project:${entry.id}`),
  ])
  if (!notes || !project) return null
  // As openRecent does for projects saved before `audible` existed.
  return { notes, f0: project.f0, audible: project.audible ?? voicedRuns(project.f0), count: entry.editedCount }
}

async function main() {
  status('Loading files…')
  const [vocalBlob, backingBlob] = await Promise.all([fetchBlob(VOCAL_URL), fetchBlob(BACKING_URL).catch(() => null)])
  const name = VOCAL_URL.split('/').pop()!
  const { notes: detected, f0, audible, buffer: vocal } = await analyse(vocalBlob, name)
  const backing = backingBlob && (await decodeAudioFile(backingBlob, BACKING_URL))
  const key = backing && detectKey(await resampleMono(backing, KEY_SAMPLE_RATE))

  // Which edits to hear: Tune Up, every note snapped to the song's key (bigger moves), or the user's own.
  const modes: { label: string; notes: NoteSegment[]; f0: F0Curve; audible: TimeSpan[] }[] = [
    { label: 'Tune Up (nearest semitone)', notes: applyEdit(detected, tuneUp(detected)), f0, audible },
  ]
  if (key)
    modes.push({ label: `Snap to ${keyName(key)} (up to a semitone)`, notes: snapToKey(detected, key), f0, audible })
  const own = await editsFromRecent(name)
  if (own)
    modes.push({
      label: `Your edits in the app (${own.count} notes)`,
      notes: own.notes,
      f0: own.f0,
      audible: own.audible,
    })

  let mode = modes[0]
  const show = async (from: number) => {
    if (busy) return
    busy = true
    try {
      await renderPassage(vocal, backing, mode.notes, mode.f0, mode.audible, from)
    } finally {
      busy = false
    }
  }
  /** Lists the passages the current edits change most, and renders the first. */
  const choose = async (next: (typeof modes)[number]) => {
    mode = next
    const passages = busiestPassages(mode.notes, vocal.duration)
    $('passages').replaceChildren('Passage:')
    for (const [i, from] of passages.entries()) {
      const button = document.createElement('button')
      button.textContent = `${formatTime(from)}${i === 0 ? ' (most corrected)' : ''}`
      button.onclick = () => void show(from)
      $('passages').append(button)
    }
    await show(passages[0])
  }
  const select = $('edits') as HTMLSelectElement
  select.replaceChildren(...modes.map((m, i) => new Option(m.label, String(i))))
  select.onchange = () => {
    if (busy) select.value = String(modes.indexOf(mode))
    else void choose(modes[Number(select.value)])
  }

  $('volume').oninput = (e) => (backingGain.gain.value = Number((e.target as HTMLInputElement).value) ** 2)
  $('backing').onchange = () => playing && void play(playing.index)
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return
    const n = Number(e.key)
    if (n >= 1 && n <= rendered.length) void play(n - 1)
    else if (e.key === ' ') {
      if (playing) stop()
      else if (rendered.length) void play(selected)
      updateButtons()
    } else return
    e.preventDefault()
  })
  setInterval(() => ($('position').textContent = rendered.length ? `at ${position().toFixed(1)} s` : ''), 100)
  await choose(mode)
}

main().catch((err) => status(err instanceof Error ? err.message : String(err)))
