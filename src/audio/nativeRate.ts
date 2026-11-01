// The sample rate a file was recorded at, read from its header. decodeAudioData resamples to its context's
// rate, so the shared playback context can't tell us; export uses this to write at the file's own rate.

/** MPEG audio sample rates by version (MPEG-1, MPEG-2, MPEG-2.5) and the header's rate index. */
const MPEG_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
}
/** Layer III bitrates in kbps by bitrate index, for MPEG-1 and for MPEG-2/2.5. */
const L3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const L3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

const text = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length))
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** Size of an ID3v2 tag at `at` (header, body and optional footer), or 0 if there is none. */
function id3Size(b: Uint8Array, at = 0): number {
  if (b.length < at + 10 || text(b, at, 3) !== 'ID3') return 0
  const body = ((b[at + 6] & 0x7f) << 21) | ((b[at + 7] & 0x7f) << 14) | ((b[at + 8] & 0x7f) << 7) | (b[at + 9] & 0x7f)
  return 10 + body + (b[at + 5] & 0x10 ? 10 : 0)
}

/** 80-bit IEEE extended float (AIFF's sample rate field). */
function extended80(b: Uint8Array, at: number): number {
  const exponent = ((b[at] & 0x7f) << 8) | b[at + 1]
  const mantissa = view(b).getUint32(at + 2) * 2 ** 32 + view(b).getUint32(at + 6)
  return mantissa * 2 ** (exponent - 16383 - 63)
}

function riffRate(b: Uint8Array): number | null {
  // RIFF/RF64 'WAVE': walk the little-endian chunks to 'fmt ' (format u16, channels u16, rate u32).
  for (let at = 12; at + 8 <= b.length;) {
    const size = view(b).getUint32(at + 4, true)
    if (text(b, at, 4) === 'fmt ') return at + 16 <= b.length ? view(b).getUint32(at + 12, true) : null
    at += 8 + size + (size & 1)
  }
  return null
}

function aiffRate(b: Uint8Array): number | null {
  // FORM 'AIFF'/'AIFC': walk the big-endian chunks to 'COMM' (channels, frames, bits, then an 80-bit rate).
  for (let at = 12; at + 8 <= b.length;) {
    const size = view(b).getUint32(at + 4)
    if (text(b, at, 4) === 'COMM') return at + 26 <= b.length ? Math.round(extended80(b, at + 16)) : null
    at += 8 + size + (size & 1)
  }
  return null
}

function flacRate(b: Uint8Array, at: number): number | null {
  // 'fLaC', then the STREAMINFO block (type 0): its 20-bit rate starts 10 bytes into the block data.
  const block = at + 4
  if (b.length < block + 4 + 13 || (b[block] & 0x7f) !== 0) return null
  const d = block + 4
  return (b[d + 10] << 12) | (b[d + 11] << 4) | (b[d + 12] >> 4) || null
}

function oggRate(b: Uint8Array): number | null {
  // First Ogg page: the identification packet starts after the 27-byte header and the segment table.
  const packet = 27 + b[26]
  if (b.length < packet + 16) return null
  if (b[packet] === 1 && text(b, packet + 1, 6) === 'vorbis') return view(b).getUint32(packet + 12, true)
  // Opus always decodes at 48 kHz, whatever rate the encoder was fed.
  if (text(b, packet, 8) === 'OpusHead') return 48000
  return null
}

/** A valid MPEG audio frame header at `at`: its sample rate and (for Layer III) frame length. */
function mpegFrame(b: Uint8Array, at: number): { rate: number; length: number | null } | null {
  if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null
  const version = (b[at + 1] >> 3) & 3
  const layer = (b[at + 1] >> 1) & 3
  const bitrateIndex = b[at + 2] >> 4
  const rateIndex = (b[at + 2] >> 2) & 3
  if (version === 1 || layer === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const rate = MPEG_RATES[version][rateIndex]
  if (layer !== 1 || bitrateIndex === 0) return { rate, length: null }
  const kbps = (version === 3 ? L3_KBPS_V1 : L3_KBPS_V2)[bitrateIndex]
  const padding = (b[at + 2] >> 1) & 1
  return { rate, length: Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / rate) + padding }
}

function mpegRate(b: Uint8Array, searchBytes: number): number | null {
  // First frame header after any ID3 tag; for Layer III, require the next frame to follow where the first
  // says it ends, so a stray 0xFF in junk data isn't mistaken for audio.
  for (let at = 0; at < searchBytes && at + 4 <= b.length; at++) {
    const frame = mpegFrame(b, at)
    if (!frame) continue
    if (frame.length === null) return frame.rate
    const next = mpegFrame(b, at + frame.length)
    if (next?.rate === frame.rate) return frame.rate
    if (at + frame.length + 4 > b.length) return frame.rate
  }
  return null
}

/**
 * The sample rate stored in a WAV, AIFF, FLAC, Ogg (Vorbis, Opus) or MP3 file's header, or null when the
 * format isn't one of these (e.g. M4A) or the header can't be read.
 */
export async function readNativeSampleRate(file: Blob): Promise<number | null> {
  const read = async (from: number, to: number) => new Uint8Array(await file.slice(from, to).arrayBuffer())
  let head = await read(0, 64 * 1024)
  if (head.length < 12) return null
  // An ID3v2 tag (cover art can make it large) may come before MP3 or FLAC data.
  const tag = id3Size(head)
  if (tag > 0) head = await read(tag, tag + 64 * 1024)

  const magic = text(head, 0, 4)
  let rate: number | null = null
  if ((magic === 'RIFF' || magic === 'RF64') && text(head, 8, 4) === 'WAVE') rate = riffRate(head)
  else if (magic === 'FORM' && ['AIFF', 'AIFC'].includes(text(head, 8, 4))) rate = aiffRate(head)
  else if (magic === 'fLaC') rate = flacRate(head, 0)
  else if (magic === 'OggS') rate = oggRate(head)
  // MP4/M4A ('ftyp' box) and Matroska/WebM aren't read; their compressed data can contain byte runs that look
  // like MP3 frames, so they must not reach the MP3 scan.
  else if (text(head, 4, 4) === 'ftyp' || magic === '\x1aE\xdf\xa3') rate = null
  // MP3: right after an ID3 tag, or (with no tag) near the start, where real MP3 data begins.
  else rate = mpegRate(head, tag > 0 ? head.length : 4096)
  // Anything outside what Web Audio can render is a misread header.
  return rate !== null && rate >= 3000 && rate <= 768000 ? rate : null
}

/** Decodes a file at `sampleRate` (an OfflineAudioContext decodes to its own rate, so this keeps the file's). */
export async function decodeAtRate(file: Blob, sampleRate: number): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(await file.arrayBuffer())
}
