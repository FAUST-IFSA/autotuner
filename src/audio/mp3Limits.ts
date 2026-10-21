// Kept apart from mp3.ts so the main bundle can use these without pulling in lamejs (LGPL), which must
// stay in the MP3 worker's own chunk.

export const MP3_KBPS = 192

/** The sample rates MPEG audio (and so LAME) can encode. */
export const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]

/**
 * The rate an MP3 export is encoded at: the audio's own rate when MP3 supports it, else the nearest supported
 * rate above it (so nothing is lost), capped at 48 kHz.
 */
export function mp3SampleRateFor(rate: number): number {
  return MP3_SAMPLE_RATES.find((r) => r >= rate) ?? 48000
}
