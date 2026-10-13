# Decisions and deviations from PLAN.md

Newest first. Each entry: what changed, why, and what it affects.

## 2026-10-13 (Phase 1)

### Fragment merging after monophonic cleanup

Vibrato that crosses a semitone boundary makes Basic Pitch flip between neighbouring notes, so one held note
came out as several pieces (the 62.3 note in the synthetic fixture became 4). `mergeFragments` rejoins touching
segments (gap < 40 ms) whose sung pitch differs by less than 0.5 semitone. Result on the fixture: 35 notes
became 28 of 28, all within 15 cents. Trade-off: a legato repeat of the same pitch with no gap merges into
one note.

### F0 median uses only frames within a semitone of Basic Pitch's note

This keeps pitchy's octave errors and neighbouring-note frames out of `detectedMidi`. Basic Pitch decides which
note it is; the F0 curve decides exactly how sharp or flat it was sung.

### Model and WASM binaries copied into `public/` on `postinstall`

`scripts/copy-assets.mjs` copies them from `node_modules`, so they're self-hosted, never committed, and always
match the installed versions.

### Analysis deps in `optimizeDeps.include`

Without this, Vite finds tfjs only when the worker first loads and reloads the page in the middle of the first
analysis.

### Single-threaded WASM for now

The threaded tfjs WASM build needs cross-origin isolation (COOP/COEP headers), so the app uses the
single-threaded SIMD build. Measured in Chromium: about 6× real time (53 s of audio in 8.7 s, 68 s in 10.9 s,
109 s in 17.2 s). Revisit if analysis feels slow: adding the headers is a two-line Vite change, but deployment
must send them too.

### Kept the teammate's lockfile versions

New packages were added on top of `canvas-setup`'s `package-lock.json`, so the scaffold's resolved versions
(konva 10.7.1, oxlint 1.87.0, ...) stay unchanged.

## 2026-10-13

### Adopted the team scaffold (`canvas-setup`) and rewrote PLAN.md as v2

We now build on the `canvas-setup` scaffold rather than the v1 monorepo, so the project mirrors what the team
started:

- a single Vite + React app at the root
- Konva instead of PixiJS
- oxlint instead of eslint and Prettier
- analysis in a browser Web Worker instead of a Fastify server

With analysis in the browser there is no server, so audio never leaves the device. The v1 spike code is
kept in `docs/spikes/code/` for reference; the v1 branch was deleted.

### No server means the email gate has no backend

The gate becomes a client-side stub until the team decides (PLAN.md §12).

## 2026-10-08 (Phase 0, still valid under v2)

### Note detection on `@tensorflow/tfjs-backend-wasm`

Pure-JS tfjs CPU took 84 s per 30 s of audio. The WASM backend took 4.6 s with identical output and no native
code. tfjs-node was faster (1.1 s), but it only runs in Node, so it doesn't apply now that analysis runs in the
browser.

### One tfjs version via npm `overrides`

`@spotify/basic-pitch@1.0.1` declares `@tensorflow/tfjs@^3.2.0`. Override it to `4.22.0` so the model, backend
and Basic Pitch share one engine. Verified: identical notes. (`npm ls` reports the override as "invalid"; that
is expected.)

### Signalsmith transpose timeline uses just-in-time scheduling

`schedule()` in `signalsmith-stretch@1.3.2` can only hold one future change relative to "now" (`outputTime`).
Post each change once the previous one is active: `{ output: t[k], outputTime: t[k-1] + 1e-6, semitones }`,
posted 60 ms (= output latency = `latency()/2`) before `t[k-1]`. Offline renders drive this with
`OfflineAudioContext.suspend()`. No package patch and no ramps are needed.

### Drag preview uses its own Signalsmith node with `blockMs: 40`; about 75 ms latency accepted

The original 50 ms target isn't reachable, because hardware output latency alone is about 38 ms. A 40 ms block
gives about 21 ms node latency (about 75 ms perceived). Accepted by the team on 2026-10-08.

### Bricolage Grotesque: import `standard.css`

If the font is adopted in the design pass, the default Fontsource entry has only the weight axis.
`standard.css` adds the width axis.
