// Kept apart from mp3.ts so the main bundle can use these without pulling in lamejs (LGPL), which must
// stay in the MP3 worker's own chunk.

/** LAME accepts 8-48 kHz; higher-rate recordings are rendered at 48 kHz for MP3. */
export const MP3_MAX_SAMPLE_RATE = 48000
export const MP3_KBPS = 192
