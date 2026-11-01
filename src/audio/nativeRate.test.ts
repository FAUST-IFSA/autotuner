import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mp3SampleRateFor } from './mp3Limits'
import { readNativeSampleRate } from './nativeRate'
import { encodeWav } from './wav'

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  new Blob(parts.map((p) => Uint8Array.from(typeof p === 'string' ? new TextEncoder().encode(p) : p)))
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const zeros = (n: number) => new Array(n).fill(0)
/** An ID3v2 tag with a `size`-byte body (syncsafe size field). */
const id3 = (size: number) => [
  'I'.charCodeAt(0),
  'D'.charCodeAt(0),
  '3'.charCodeAt(0),
  4,
  0,
  0,
  0,
  0,
  size >> 7,
  size & 0x7f,
  ...zeros(size),
]

describe('readNativeSampleRate', () => {
  it('reads WAV files written by our encoder', async () => {
    const wav = encodeWav([new Float32Array(100)], 22050)
    expect(await readNativeSampleRate(new Blob([wav]))).toBe(22050)
  })

  it('walks past other chunks before the WAV format chunk', async () => {
    const fmt = [1, 0, 2, 0, ...u32le(96000), ...u32le(96000 * 4), 4, 0, 16, 0]
    const file = bytes('RIFF', u32le(4 + 13 + 1 + 24), 'WAVE', 'LIST', u32le(5), zeros(5), [0], 'fmt ', u32le(16), fmt)
    expect(await readNativeSampleRate(file)).toBe(96000)
  })

  it('reads AIFF (80-bit float rate)', async () => {
    const comm = [0, 2, ...u32be(1000), 0, 16, 0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0] // 44100
    expect(await readNativeSampleRate(bytes('FORM', u32be(30), 'AIFF', 'COMM', u32be(18), comm))).toBe(44100)
  })

  it('reads FLAC STREAMINFO, also after an ID3 tag', async () => {
    const streaminfo = [...zeros(10), 0x17, 0x70, 0x02, ...zeros(21)] // 0x17700 = 96000 Hz
    const flac: (number[] | string)[] = ['fLaC', [0x80, 0, 0, 34], streaminfo]
    expect(await readNativeSampleRate(bytes(...flac))).toBe(96000)
    expect(await readNativeSampleRate(bytes(id3(40), ...flac))).toBe(96000)
  })

  it('reads Ogg Vorbis and treats Opus as 48 kHz', async () => {
    const page = (packet: number[] | string) => bytes('OggS', zeros(22), [1, 30], packet, zeros(30))
    expect(
      await readNativeSampleRate(
        page([1, ...[...'vorbis'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 2, ...u32le(32000)]),
      ),
    ).toBe(32000)
    expect(await readNativeSampleRate(page('OpusHead'))).toBe(48000)
  })

  it('reads MP3 frames after an ID3 tag, and skips bytes that only look like a frame', async () => {
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames.
    const v1 = [0xff, 0xfb, 0x90, 0x00]
    const twoFrames = (h: number[], length: number) => [...h, ...zeros(length - 4), ...h, ...zeros(8)]
    expect(await readNativeSampleRate(bytes(id3(20), twoFrames(v1, 417)))).toBe(44100)
    // MPEG-2 Layer III, 64 kbps, 22.05 kHz: 208-byte frames. Preceded by junk containing a fake sync.
    const v2 = [0xff, 0xf3, 0x80, 0x00]
    const junk = [0xff, 0xfb, 0x94, 0x00, 1, 2, 3] // claims 48 kHz, but no frame follows where it should
    expect(await readNativeSampleRate(bytes(junk, twoFrames(v2, 208), zeros(300)))).toBe(22050)
  })

  it('never reads MP3-looking bytes inside an M4A as MP3', async () => {
    const v1 = [0xff, 0xfb, 0x90, 0x00]
    const m4a = bytes([0, 0, 0, 0x20], 'ftypM4A ', zeros(20), v1, zeros(413), v1, zeros(8))
    expect(await readNativeSampleRate(m4a)).toBeNull()
  })

  it('returns null for formats it does not read (e.g. M4A) and for empty files', async () => {
    expect(await readNativeSampleRate(bytes([0, 0, 0, 0x20], 'ftypM4A ', zeros(40)))).toBeNull()
    expect(await readNativeSampleRate(new Blob([]))).toBeNull()
  })

  it('reads the generated test vocals', async () => {
    // Written by scripts/make-fixture.mjs (npm test runs it first).
    const rate = async (path: string) => readNativeSampleRate(new Blob([fs.readFileSync(path)]))
    expect(await rate('fixtures/synth-vocal-22k-mono.wav')).toBe(22050)
    expect(await rate('fixtures/synth-vocal-44k-stereo.wav')).toBe(44100)
  })
})

describe('mp3SampleRateFor', () => {
  it('keeps MP3 rates and rounds others up to the next one, capped at 48 kHz', () => {
    expect(mp3SampleRateFor(44100)).toBe(44100)
    expect(mp3SampleRateFor(22050)).toBe(22050)
    expect(mp3SampleRateFor(37800)).toBe(44100)
    expect(mp3SampleRateFor(7000)).toBe(8000)
    expect(mp3SampleRateFor(96000)).toBe(48000)
  })
})
