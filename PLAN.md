# Build plan: browser vocal pitch editor

## How to use this plan

This is the brief for Claude Code. Work through the phases in order. The plan builds on the team scaffold from
the `canvas-setup` branch ([PR #1](https://github.com/FAUST-IFSA/autotuner/pull/1)) and mirrors its
structure and conventions: a single Vite + React app at the repo root, Konva for the editor canvas, oxlint,
and analysis in a Web Worker. Where this plan and the existing code disagree, follow the existing code and
note the change in `docs/DECISIONS.md`. When something here conflicts with what a library actually does,
trust the library's own README, source and tests.

**Revision history.** v1 (2026-10-08) planned an npm-workspaces monorepo with a Fastify analysis server and a
PixiJS editor, and Phase 0 spiked its risky parts. v2 (2026-10-13) adopts the team scaffold instead. The
Phase 0 findings still apply and are summarized in §7. The full write-up is in `docs/spikes/phase-0-results.md`,
and the spike code is in `docs/spikes/code/` (reference only, not built).

The only WebAssembly in the project arrives precompiled inside npm packages: the Signalsmith pitch shifter and
the TensorFlow.js WASM backend. We write no C++.

## 1. Product summary

Users upload a vocal recording, see it as draggable note blobs on a pitch grid, drag notes to new pitches while
hearing each change live, play back the full edited vocal at any time, and export the result as an audio file.
Access is gated by an email address, with no passwords or accounts. One file is edited at a time.

### Screens and flow

1. **Email gate** (new). Email field, an unticked separate checkbox for marketing emails, a checkbox confirming
   the user is 15 or older, and a button. Client-side stub for now (there is no backend, see §2).
2. **Upload** (exists: `UploadScreen`). react-dropzone, single file, up to 100 MB and 10 minutes. Accepts
   whatever the browser can decode (WAV, MP3, OGG, FLAC; M4A where supported). Add a Recent files button and a
   help button to the header.
3. **Analyzing** (exists as the dropzone's busy state). Shows progress from the worker. Ends with the app's
   one orchestrated motion moment (see §8).
4. **Editor** (exists: `EditorScreen` + `PitchEditor`). Piano keys, semitone grid, note blobs with the waveform
   envelope, time ruler, Ctrl/Cmd + scroll zoom and scroll pan. To add: F0 curve, play/stop, playhead,
   selection, snap toggle, undo, and real audio export (replacing "Export corrections" JSON) with a WAV/MP3
   choice.
5. **Downloaded** (new). Confirms the file was saved, with buttons to return to the editor or tune another
   vocal.

## 2. Architecture

Everything runs in the browser. There is no server.

```
Main thread                                         Analysis worker (src/audio/analysis.worker.ts)
------------------------------------------          ----------------------------------------------
1. User drops file (UploadScreen)
2. decodeAudioData() -> original AudioBuffer
   (kept for playback and export)
3. Mix to mono, resample to 22,050 Hz  --------->   - peaks (exists)
   (OfflineAudioContext)                            - F0 curve (pitchy)
                                                    - notes (Basic Pitch on tfjs WASM backend)
   AnalysisResult + progress  <-----------------    - monophonic cleanup
4. Editor draws blobs, envelope, F0 curve
5. Drag preview, playback and export run through
   Signalsmith Stretch (WASM AudioWorklet).
```

**Audio never leaves the user's device.** This is stronger than v1's "deleted after processing" and makes the
privacy copy literally true. Model weights and WASM binaries are self-hosted from `public/`. Nothing loads
from a CDN at runtime.

Analysis sits behind a function boundary (`analyze(samples, sampleRate, onProgress)` in the worker), so a
server-side or different analyzer can replace it later without touching the editor.

## 3. Tech stack

Existing (from the scaffold), kept as is: React 19, TypeScript 6 (`tsc -b`), Vite 8, Konva + react-konva,
react-dropzone, oxlint.

| Area | Choice | License (verify) | Ships to browser? |
| --- | --- | --- | --- |
| Pitch shifting | `signalsmith-stretch` 1.3.2 (WASM + AudioWorklet) | MIT | Yes |
| Note detection | `@spotify/basic-pitch` 1.0.1 on `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm` 4.22.0 | Apache-2.0 | Yes (worker) |
| F0 curve | `pitchy` 4.1.0 (McLeod pitch method) | MIT | Yes (worker) |
| MP3 export | `lamejs`, lazy-loaded as its own chunk, unmodified | LGPL | Yes |
| Recent files storage | `idb-keyval` (IndexedDB) | Apache-2.0 | Yes |
| Tests | vitest | MIT | No |
| License check | `license-checker-rseidelsohn` | BSD-3-Clause | No |

Pin exact versions for new dependencies, and record every dependency in the license register. Basic Pitch
declares `@tensorflow/tfjs@^3`. Use an npm `overrides` entry to force 4.22.0 everywhere (verified working in
Phase 0).

Hard rules: no GPL or AGPL dependencies anywhere; no LGPL except lamejs as an isolated chunk; no ffmpeg; no
remote CDNs at runtime; no `localStorage` for audio.

## 4. Repository structure

Mirror the scaffold. New files are marked `+`.

```
/
  PLAN.md
  README.md
  package.json, tsconfig*.json, vite.config.ts, .oxlintrc.json
  docs/
  + DECISIONS.md                deviations from this plan and why
  + spikes/phase-0-results.md
  + licenses/THIRD_PARTY_LICENSES.md, licenses/texts/
  scripts/
  + licenses-check.mjs, make-fixture.mjs
  public/
  + models/basic-pitch/         model.json + weights + LICENSE copied from the package
  + tfjs-wasm/                  tfjs-backend-wasm .wasm binaries
  fixtures/                     test vocals (gitignored audio; synthetic generator + truth JSON committed)
  src/
    App.tsx, main.tsx, index.css, types.ts
    screens/                    UploadScreen, EditorScreen, + EmailGateScreen, + DownloadedScreen
    components/                 ExportBar (becomes the audio export menu)
    editor/                     PitchEditor, PitchGrid, NoteBlob, TimeRuler, layout.ts, + F0Curve, + Playhead,
                                + selection and undo
    audio/
      decode.ts, peaks.ts, analysis.worker.ts
      segments.ts               RMS segmenter; kept as the fallback when Basic Pitch fails
    + f0.ts, notes.ts, music.ts, resample.ts
    + AudioEngine.ts            Signalsmith playback + drag preview
    + export.ts, wav.ts, mp3.worker.ts
    + storage/recent.ts         IndexedDB recent projects
```

Scripts: keep `dev`, `build`, `lint` and `preview`; add `test` (vitest) and `licenses:check`.

## 5. Data model (`src/types.ts`)

Extend the scaffold's types rather than replacing them:

```ts
export interface NoteSegment {
  id: string
  start: number            // seconds
  end: number              // seconds
  originalMidi: number     // Math.round(detectedMidi), as today
  midi: number             // target pitch; integer when snapped, fractional (1-cent steps) when not
  + detectedMidi: number   // median of voiced F0 frames inside the note, fractional
}

+ export interface F0Curve {
+   hopSec: number              // 256 / 22050
+   midi: (number | null)[]     // fractional MIDI per frame; null = unvoiced
+   clarity: number[]           // 0..1
+ }

export interface Project {
  fileName, buffer, peaks, notes   // as today
  + f0: F0Curve
}
```

Derived values (not stored): `shiftSemitones = midi - detectedMidi`, `centsOff = (detectedMidi - originalMidi) * 100`.
With snap on (the default, and the scaffold's current behavior), dragging sets `midi` to an integer. That
also corrects the original tuning. Alt-drag moves in 1-cent steps. The shift is constant per note, so
vibrato and natural movement are kept. Hard tune is out of scope.

Undo: a command stack of note-target changes, 100 steps.

## 6. Analysis (worker)

Replaces the placeholder in `segments.ts`, which currently sets every note to C4.

- **Resample** on the main thread to 22,050 Hz mono with an `OfflineAudioContext` before posting to the
  worker. Basic Pitch requires exactly 22,050 Hz mono (confirmed in its source).
- **F0:** pitchy over frames (window 1024, hop 256). Mark a frame unvoiced if clarity is below about 0.85 or
  its RMS is below a silence threshold. Restrict to roughly 70 to 1100 Hz. Apply a 5-frame median filter to
  voiced runs.
- **Notes:** Basic Pitch with the tfjs **WASM backend** inside the worker. Load the model from
  `public/models/basic-pitch/` and point the WASM backend at `public/tfjs-wasm/`. Run `outputToNotesPoly`
  → `addPitchBendsToNoteEvents` → `noteFramesToTime`. Then make the result monophonic: resolve overlaps by
  keeping the higher-amplitude note, drop notes shorter than 60 ms, and merge same-pitch neighbors less than
  40 ms apart. Compute `detectedMidi` from the F0 frames inside each note, falling back to Basic Pitch's pitch
  when there are too few voiced frames.
- **Fallback:** if model loading or inference fails, use the existing RMS segmenter, labeled with F0-derived
  pitches.
- **Progress:** post progress messages so the Analyzing state can show them. Phase 0 measured about 6.5×
  real time with the WASM backend in Node (about 37 s for a 4-minute vocal). Measure again in the browser.
- **Peaks:** keep the existing `computePeaks`.

## 7. Audio engine and export

Phase 0 findings that shape this section (details in `docs/spikes/phase-0-results.md`):

- **`schedule()` can only hold one future change.** Signalsmith 1.3.2 treats `outputTime` (default: now) as
  "now" and discards the rest of the queue. Queue change _k_ only after change _k−1_ is active:
  `{ output: t[k], outputTime: t[k-1] + 1e-6, semitones }`, posted 60 ms (the node's output latency, which
  is `latency()/2`) before `t[k-1]`.
- **No ramps needed.** Changes produced no measurable clicks, and the API has no ramp support.
- **Offline render works** in an `OfflineAudioContext` at 30× real time, driven by `ctx.suspend()` at each
  boundary.
- **Live drag latency** is about 75 ms perceived with a dedicated preview node at `blockMs: 40`. The team
  accepted this as the target.

### `src/audio/AudioEngine.ts`

One class owns the shared `AudioContext` (reuse `getAudioContext()` from `decode.ts`) and two Signalsmith
nodes:

- **Playback node** (default preset): plays the original buffer with a just-in-time transpose schedule built
  from `notes` (0 semitones between notes). It enables `formantCompensation` and exposes the current time for
  the playhead.
- **Preview node** (`blockMs: 40`): on drag start, loops the dragged note plus 50 ms of pre-roll. It sends
  `semitones` directly from pointer moves (no rAF throttle) and stops on release.

Resume the context on the first user gesture.

### `src/audio/export.ts`

Render with an `OfflineAudioContext` at the file's own sample rate (read from its header and re-decoded at
that rate; see DECISIONS 2026-10-21) and the original channel count, using the same scheduler
driven by `suspend()`. Write WAV with our own encoder (`wav.ts`). For MP3, lazy-load lamejs at 192 kbps in a
Web Worker. Download as `<name>-tuned.wav` or `.mp3`, then show the Downloaded screen. This replaces the
current "Export corrections" JSON button.

## 8. Editor and design

Keep the scaffold's Konva structure: `PitchEditor` owns the stage, zoom and scroll; `PitchGrid`, `Keyboard`
and `TimeRuler` draw static layers; `NoteBlob` draws each note as a waveform envelope.

Additions:

- **F0 curve layer** above the grid. Each note's portion is drawn shifted along with its blob, so the vibrato
  moves with it.
- **Tuning color and tick.** Blob fill shows how close the note is to true pitch. Fully off-pitch color at 50
  cents away, fully in-tune color within 10 cents. A thin tick shows the cents offset, like a strobe tuner
  needle. Never rely on color alone: the tick and a cents readout on hover carry the same information.
- **Interactions:** keep vertical snap-drag; add Alt for fine (cent) moves. Drag on empty space draws a
  selection; dragging any selected blob moves all of them. Click empty space to clear the selection. Click
  the ruler to move the playhead.
- **Keyboard:** Space play/pause; Up/Down move the selection a semitone; Alt+Up/Down move it 10 cents;
  Backspace resets; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo.
- **Pitch range:** keep C2 to C6, scrolled to fit the detected notes on load (today it centers on C4).
- **Performance target:** 60 fps while dragging with 500 notes. `NoteBlob` is already memoized. Watch the
  per-blob envelope recompute on zoom, and move blobs to `Konva.FastLayer` or cached shapes if needed.

### Design direction

The scaffold uses a dark, neutral UI, which is the current baseline. The direction below is the proposal
for the Phase 6 design pass, and **needs agreement from the team before it's applied**.

Concept: "a tuner on manuscript paper". The semitone ruling is the visual identity. The one bold element is
tuning color, and everything else stays quiet.

| Name | Hex | Role |
| --- | --- | --- |
| Paper | `#EEF1EC` | Page background (light theme) |
| Ink | `#16213B` | Text, icons, primary buttons |
| Ruling | `#CBD3D8` | Semitone lines, borders |
| In tune | `#1E8A5A` | Notes within ±10 cents |
| Off pitch | `#B3246C` | Notes far from a semitone |
| Cursor blue | `#3156C6` | Selection, playhead, focus rings |

Font: Bricolage Grotesque (variable, self-hosted via `@fontsource-variable`, OFL; import `standard.css` to
get the width axis). Use tabular figures for times and cents. Sentence case throughout.

Motion: one orchestrated moment. When analysis finishes, the F0 curve draws left to right over about 900 ms,
then the blobs settle and take their colors. Respect `prefers-reduced-motion`.

Copy: plain and specific. Avoid "autotune" in UI copy. "Auto-Tune" is an Antares trademark, so keep the
product name in one constant until a final name is chosen. The scaffold currently says "Faust Studio
Autotuner" and "Drop a vocal to autotune!", which the team should revisit.

Quality floor: visible keyboard focus, WCAG AA contrast, keyboard-reachable controls, and responsive
upload and downloaded screens. The editor is desktop-first.

## 9. Recent files, email gate and errors

- **Recent files:** up to 10 projects in IndexedDB (original file blob, name, analysis, note targets, last
  opened). Opening one skips decode and analysis. Delete button per project. Everything stays on the device.
- **Email gate:** shown before the first upload. Client-side stub that validates and keeps a flag in
  `sessionStorage` (never audio). `VITE_SKIP_EMAIL_GATE=true` skips it in development. Collecting and storing
  emails needs a backend, which this app doesn't have. That decision is the team's (see §12).
- **Errors:** every failure says what happened and what to do: unsupported format, too large, too long,
  analysis found no singing, model failed to load, export failed.

## 10. License tracking

- `docs/licenses/THIRD_PARTY_LICENSES.md`: one row per direct dependency, plus the Basic Pitch weights and
  the font. Columns: version, SPDX license, source, where it runs, obligations, notes. Copy texts into
  `docs/licenses/texts/`.
- `npm run licenses:check` fails on GPL, AGPL, LGPL or unknown licenses across the full tree, with lamejs as
  the only exception. Run it at the end of every phase.
- Known gaps from Phase 0: `signalsmith-stretch` and the tfjs packages ship no LICENSE file, so fetch the
  texts from upstream. The Basic Pitch weights are covered by the package's Apache-2.0 LICENSE.

## 11. Phases

Each phase ends with `npm run build`, `npm run lint`, `npm test` and `npm run licenses:check` passing, the
app running via `npm run dev`, and a short summary. Work happens on feature branches off `main` and is merged
through pull requests that use the repo's PR template.

**Phase 0: done.** Risk spikes, results in `docs/spikes/phase-0-results.md`.

**Phase 1: tooling and real pitch detection.** Add vitest, the license register and check, `DECISIONS.md`
and the fixture generator. Self-host the Basic Pitch model and the tfjs WASM binaries. Replace the C4
placeholder with F0 + Basic Pitch + monophonic cleanup in the worker, with progress reporting. Unit tests for
music helpers, F0 smoothing and monophonic cleanup, plus an accuracy test against the synthetic fixture's
ground truth. Measure analysis speed in the browser on the three Looperman test vocals.

**Phase 2: editor completion.** F0 curve layer, tuning colors and ticks, fit-to-notes scroll, fine drag,
selection and multi-note moves, keyboard controls, undo/redo, and reset. Acceptance: 60 fps panning a
3-minute vocal, and every edit survives undo and redo.

**Phase 3: sound.** AudioEngine playback with the just-in-time schedule, playhead, and live drag preview.
Acceptance: about 75 ms drag latency, and no clicks at note boundaries on the test vocals.

**Phase 4: export, Downloaded screen, recent files.** WAV and MP3 at original quality. Acceptance: the
export sounds the same as playback.

**Phase 5: email gate, design pass and hardening.** Apply the agreed design direction, the reveal animation,
every error state, an accessibility check and a final license audit.

Test material: three Looperman acapellas in `fixtures/` (gitignored; Looperman's license is for use in
music, so don't redistribute them) and the synthetic vocal with known pitches from
`scripts/make-fixture.mjs`.

## 12. Open questions for the team

- **Email gate backend.** The app has no server. Should we drop the gate, keep it as a client-only stub, or
  add a small backend or hosted form service?
- **Design direction (§8):** keep the scaffold's dark look or adopt the manuscript-paper direction?
- **Product name and copy:** "Autotuner" and "autotune" in the UI touch the Antares trademark.
- **Formatting:** the scaffold has no Prettier config. Should we add one, to keep diffs clean between
  contributors?

## 13. Out of scope (leave TODOs)

- Real email sending, verification, double opt-in, unsubscribe and deletion, and a database.
- Privacy policy, terms and an open-source licenses page.
- GDPR production items.
- Hard tune / retune speed, and per-note formant controls.
- Time stretching, splitting or merging notes.
- Deployment and HTTPS.
