# Known limitations

One place for what the autotuner can't do, or does less well. Each entry says what happens, why, and where it
lives in the code. Reasoning and measurements are in [`DECISIONS.md`](DECISIONS.md); open work is tracked in
[`REVIEW-FINDINGS.md`](REVIEW-FINDINGS.md). If you add a limitation to a code comment, add it here too.

## Note detection

| Limitation | Effect | Where |
| --- | --- | --- |
| **Notes aren't split at breaths or rests.** Cleanup only trims, drops and merges; it never cuts a note where the F0 curve goes silent. Gaps under 40 ms between notes at the same pitch are closed. | One note can cover both sides of a pause, and dragging it moves both. | `src/audio/notes.ts` (`MERGE_GAP_SECONDS`, `mergeFragments`); review item 1 |
| **Analysis uses a 22,050 Hz mono copy.** Basic Pitch requires it. Playback and export use the original. | Content above about 11 kHz (s, sh, ř consonants) is ignored, which slightly softens attacks. Doubled vocals, harmonies and wide stereo effects collapse into one stream, and the louder note wins overlaps. Works best on a close-miked solo vocal. | `src/audio/analysis.worker.ts`; review item 4 |
| **Fallback detection is approximate.** If Basic Pitch fails to load or run, notes come from loudness segments (one per loud region). | The editor shows an "approximate notes" banner, and the project isn't saved to recent files. How often this happens isn't measured. | `src/audio/analyze.ts` (`usedFallback`); review item 2 |
| **Thresholds were tuned on three test vocals.** F0 clarity (0.85 / 0.6) and the outlier filter (under 0.2 s, 7+ semitones off, under 50% F0 support). | Other voices or recording styles may lose real notes or keep stray ones. | `src/audio/f0.ts`, `src/audio/notes.ts`; review item 8 |
| **Pitch range is 70 to 1,100 Hz** (about C2 to C6). The editor grid shows C2 to C6 only (`MIDI_MIN` 36, `MIDI_MAX` 84). | Pitches outside that range aren't tracked or drawn, and edits are clamped to the grid. | `f0.ts` (`MIN_HZ`, `MAX_HZ`), `editor/layout.ts`, `edits.ts` |
| **Monophonic only.** Overlapping notes are reduced to one line. | Choirs and chords can't be tuned note by note. | `toMonophonic` in `src/audio/notes.ts` |

## Playback and export

| Limitation | Effect | Where |
| --- | --- | --- |
| **MP3 tops out at 48 kHz and uses standard MPEG rates.** Other rates round up to the next one, and anything above 48 kHz becomes 48 kHz. Bitrate is fixed at 192 kbps. | A 96 kHz file exports as a 48 kHz MP3. WAV keeps the file's own rate. | `src/audio/mp3Limits.ts`, `exportFile.ts` |
| **M4A and WebM exports stay at the playback rate.** Their headers aren't read, because compressed data can contain bytes that look like MP3 frames (a real M4A was misread as 44.1 kHz). | These files export at the output device's rate (often 48 kHz) instead of their own. Unknown formats and read failures behave the same way. | `src/audio/nativeRate.ts` |
| **Export works around one-change-at-a-time scheduling.** Signalsmith's `schedule()` holds one future change, so the offline render suspends at each change point. | Works (29x real time, no clicks added), but the render loop is more complex than a single pass. | `renderTuned` in `src/audio/export.ts`; review item 5 |
| **MP3 export carries LGPL obligations.** `@breezystack/lamejs` (LGPL-3.0) is kept in its own worker chunk, enforced by `scripts/check-chunks.mjs`. | Whether this is enough for compliance is undecided. WAV-only export avoids the question. | review item 7 |

## Editor and app

| Limitation | Effect | Where |
| --- | --- | --- |
| **Uploads are one file, up to 400 MB.** | Larger files and batches are rejected. Whole files are decoded in memory. | `UploadScreen.tsx` (`MAX_FILE_BYTES`) |
| **Undo history holds 100 edits.** | Older edits can't be undone. | `editor/edits.ts` (`MAX_HISTORY`) |
| **Only the 10 most recent files are kept**, in this browser's IndexedDB. Approximate (fallback) projects aren't saved, and storage errors are only logged. | Clearing site data loses the list. A failed save is silent. | `storage/recent.ts` |
| **Zoom is limited to 5 to 2,000 px per second.** | Very long files can't be fully zoomed out to fit. | `editor/layout.ts` |
| **The backing track is only heard under the vocal.** The editor's timeline is the vocal's. | Any part of the song before the vocal starts or after it ends isn't shown or played. | `audio/backing.ts` (`backingSpan`) |
| **Lining up is by hand.** There's no automatic alignment. | Placement relies on dragging (zoomed in for precision), the 10 ms nudges and listening. | `screens/LineUpScreen.tsx` |
| **One key per song, from the backing track only.** Key changes aren't followed, tuning away from A440 isn't measured, and a vocal alone never gets a key. | A song that modulates shows its strongest key or none; a detuned backing track can read as a neighbouring key. | `audio/key.ts` |
| **Key thresholds were set on synthetic tracks and a few vocals.** | Real backing tracks of known key haven't been tested yet, so how often the badge is missing or wrong is unmeasured. | `audio/key.ts` (`MIN_SCORE`, `MIN_MARGIN`) |
| **A backing track roughly doubles a project's memory and storage.** It's decoded in full, and the original file is kept in recent files. | Two 10-minute files may not fit the browser's storage quota; a backing track that doesn't fit is left out of recent files with a console warning. | `audio/backing.ts`, `storage/recent.ts` |

## Engine

| Limitation | Effect | Where |
| --- | --- | --- |
| **Signalsmith nodes are pooled and never discarded.** The worklet's `process()` always returns `true`, so a node is never garbage collected. | State must be reset in `releaseVoices` when a file closes. A missed reset can leak between files. | `src/audio/AudioEngine.ts`; review item 3 |
| **Preview latency of about 75 ms.** The drag preview node uses a 40 ms block size. | Pitch changes under the cursor are heard slightly late. | `DECISIONS.md` (Phase 0) |
| **Single-threaded WASM.** | Note detection is slower than a multi-threaded build would be. | `DECISIONS.md` (Phase 1) |
| **No server.** Everything runs in the browser, and recent files live in IndexedDB. | No email gate backend, no failure telemetry, and recent files are per browser. | `DECISIONS.md` (2026-10-13) |
