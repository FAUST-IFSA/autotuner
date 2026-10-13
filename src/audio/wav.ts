/**
 * 24-bit PCM WAV. 24-bit keeps the original's quality for 16-bit and 24-bit sources, and every DAW and
 * player reads it.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const bytesPerSample = 3
  const frames = channels[0]?.length ?? 0
  const blockAlign = channels.length * bytesPerSample
  const dataBytes = frames * blockAlign
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))

  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const s = Math.max(-1, Math.min(1, channel[i]))
      const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff)
      view.setUint8(offset, v & 0xff)
      view.setUint8(offset + 1, (v >> 8) & 0xff)
      view.setUint8(offset + 2, (v >> 16) & 0xff)
      offset += 3
    }
  }
  return view.buffer
}
