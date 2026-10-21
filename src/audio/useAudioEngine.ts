import { useEffect, useState } from 'react'
import { AudioEngine } from './AudioEngine'
import { getAudioContext } from './decode'

/** Creates the audio engine for a recording and tears it down when the editor closes. */
export function useAudioEngine(buffer: AudioBuffer) {
  const [engine, setEngine] = useState<AudioEngine | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let created: AudioEngine | null = null
    let cancelled = false
    AudioEngine.create(getAudioContext(), buffer).then(
      (e) => {
        if (cancelled) return e.dispose()
        created = e
        e.onPlayingChange = setPlaying
        setEngine(e)
        // Dev builds expose the live engine for src/dev/audioChecks.ts and console debugging.
        if (import.meta.env.DEV) Object.assign(window, { __audioEngine: e })
      },
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      cancelled = true
      created?.dispose()
      setEngine(null)
      setPlaying(false)
    }
  }, [buffer])

  return { engine, playing, error }
}
