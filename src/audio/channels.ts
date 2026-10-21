/** Copies of a buffer's channel data (the whole buffer, or `from`-`to` seconds), safe to transfer to a worklet or worker. */
export function copyChannels(buffer: AudioBuffer, from = 0, to = buffer.duration): Float32Array[] {
  const a = Math.max(0, Math.floor(from * buffer.sampleRate))
  const b = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate))
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(a, b))
}
