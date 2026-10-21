/** The app's one realtime AudioContext: playback runs on it, and every file is decoded through it. */
let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

/**
 * Decodes a file through the shared context. decodeAudioData resamples to the context's rate (the output
 * device's), so the buffer, playback and export are all at that rate, not necessarily the file's own.
 */
export async function decodeAudioFile(file: Blob, name: string): Promise<AudioBuffer> {
  const data = await file.arrayBuffer()
  try {
    return await getAudioContext().decodeAudioData(data)
  } catch {
    throw new Error(`Couldn't decode "${name}". Try a WAV, MP3, OGG or FLAC file.`)
  }
}
