# Decisions and deviations from PLAN.md

Newest first. Each entry: what changed, why, and what it affects.

## 2026-11-04

### Lining up a vocal with its backing track

A vocal is often only part of the song, so starting both together would put it in the wrong place. Of the two
options (line them up, or only accept backing tracks the same length as the vocal) we chose lining up, kept to
one move: the Line up screen shows the whole backing track with the vocal as a single clip under it. Drag the
clip or nudge it by 10 or 100 ms (buttons, or Option/Alt + ← →, Shift for 100 ms). A playhead marks where
playback starts: click anywhere or use ← → to move it (Shift for 5 s), Enter puts it just before the vocal, and
Space plays and pauses. Done saves `offset`; Cancel keeps the old one. It's reached from "Line up" in the
backing bar.

- **Always shown after a backing upload**, so the user confirms the placement before the editor opens. Files
  within 0.1 s of each other in length were almost certainly exported together from one session, so they start
  together and the screen says so (`sameLength`).
- **No automatic alignment.** An instrumental and a vocal share no audio, so there's nothing reliable to match.
  It could work for full mixes that still contain the vocal; not attempted.
- **Line-up playback** is two plain buffer sources (`LineUpPlayer`), with no tuning: only timing matters here.
- **Limits.** The vocal stays inside the view (the backing track plus a 5% margin) and overlaps the backing
  track by at least 0.5 s, so there's always something to hear together (`clampOffset`).

### Backing track, for reference only

A client request: let the singer hear their vocal against the song while tuning. After a new vocal is analysed
a screen of its own asks "Add a backing track?"; yes opens the upload screen again (same dropzone and limits,
no recent files). Both are full screens covering the editor, which stays mounted underneath so its engine and
undo history survive. "Add
backing track" in the editor header opens the same screen later, and Remove takes it away again.

- **Playback.** The backing track doesn't go through Signalsmith. It's a plain `AudioBufferSourceNode`, one
  per play, started at the same context time the vocal is scheduled to be heard (`startOutput`), behind its
  own fade and a volume gain. Pause, seek, the end of the vocal and the drag preview stop it with the vocal.
  Measured by recording both outputs with a copy of the vocal as the backing track: the backing lands within
  1 ms of the vocal from a fresh start, and within 4 ms after seeks (the stretcher's block timing).
- **Timeline.** The editor keeps the vocal's timeline. `BackingTrack.offset` says where the vocal starts in
  the backing track (set on the Line up screen, above), and only the part under the vocal is
  shown and played (`backingSpan`). Notes, the ruler, zoom and export are unchanged.
- **Export** reads only the vocal file and its notes (`exportTuned`), so the backing track can't reach it.
- **Volume** is a 0 to 1 slider applied squared, so it feels even; it starts at 0.8 because backing tracks are
  usually mastered louder than a raw vocal.
- **Recent files** keep the backing file under its own key, written once, and its settings (offset, volume,
  mute) next to the edits. Reopening decodes it again; a backing track that fails to load is left out rather
  than failing the project.

## 2026-11-03 (shifts follow the sound between notes)

After gap bridging, a shifted talking vocal (`bside_intro`) still had syllables at the original pitch, all in
gaps over 300 ms between detected notes. Basic Pitch at its default thresholds covers only 78% of the voiced
audio that the F0 tracker finds in that file. It is trained on music, and speech has few stable notes.
Lowering the thresholds to 0.1 covers it all, but nearly doubles the notes (166 to 302), and the cleanup still
drops a fifth of the audio.

So the schedule now fills long gaps from the recording itself. In a gap too long to bridge, each half of the
gap follows its neighbouring note: any sound in it takes that note's shift, up to 1 s away
(`gapFillMaxSeconds`). Sound next to an unedited note stays unshifted. No notes are added to the editor.

"Sound" means above the silence level the F0 tracker uses (3% of the loudest frame's RMS), voiced or not. A
first version used the F0 tracker's voiced runs, and left 6.4 s of the file's 55 s of sound unshifted: none
of it voiced by the tracker's rules. About half was clear but below its 70 Hz floor (creaky voice at phrase
ends, read at 31-76 Hz), and half had clarity under 0.6 (breathy or rough voice). Shifting consonants and
reverb tails along with their word is harmless, so loudness is the simpler and more complete rule.

Projects keep these spans as `audible`. Recent files saved before this use the display curve's voiced runs
instead, which cover less. The editor's F0 curve now takes its shift from the same schedule, so it moves the
way the audio does (including the bridged gaps).

## 2026-11-01 (shifts bridge short gaps)

On a talking vocal, shifting a whole section left audible remnants of the original voice. `buildSchedule`
shifted only each note's detected span plus 10 ms, and returned to 0 in every gap of 30 ms or more, so
transitions, consonants and breaths between words that Basic Pitch didn't turn into notes played at the original
pitch. Now a gap of up to 300 ms (`BRIDGE_MAX_GAP_SECONDS`) is split at its middle: an edited note's shift
reaches that point, and two edited neighbours switch directly from one shift to the other there. Longer gaps
(phrase breaks) keep the 10 ms pad and the return to 0, as do the start and end of the file.

The 300 ms limit is a first guess, not tuned by ear. Audio that was never detected as a note at all (long
unvoiced stretches inside a phrase) is still unshifted; that needs the F0 curve, or a range-level shift.

## 2026-10-28

### Upload limit raised from 100 MB to 400 MB

Memory follows a file's duration, not its size: every file is decoded to 32-bit float audio at the playback
rate, so 10 minutes of stereo costs about the same whether it arrived as a 10 MB MP3 or a 300 MB WAV. The
100 MB cap rejected legitimate files inside the 10-minute limit (10 minutes of 44.1 kHz/16-bit stereo WAV is
106 MB; 48 kHz/24-bit is 173 MB). 400 MB fits 10 minutes of 96 kHz/24-bit stereo (346 MB). The 10-minute
limit stays the real memory guard; the byte cap only stops a huge file from being read in at all.

Verified in the dev browser (Chromium) with a 9:50, 96 kHz/24-bit stereo WAV (339.8 MB):
- A 401 MB file is refused with "Please drop a single audio file under 400 MB."
- Load and analysis: about 170 s to the editor (analysis reached 100% at about 130 s), 1,936 notes. The pane
  was hidden during the run, so times are rough.
- Tune Up (1,384 notes changed), playback and both exports work. The WAV is 96 kHz/24-bit, 590 s, 339.8 MB
  (63 s to export); the MP3 is 48 kHz, 192 kbps, 590 s, 14.2 MB (68 s).
- Recent files saved the 340 MB original with its edits, and reopening it took 10 s.
- Peak renderer memory was about 1.26 GB (finishing the load), 1.18 GB (WAV export). The test also held an
  extra in-memory copy of the file, so a real drop peaks somewhat lower.
- Browser storage quota depends on free disk: on a Mac with about 9 GB free it was 1.7 GB, so only a few
  files this size fit in recent files. A save that doesn't fit is skipped with a console warning.

Not tested: Safari.

## 2026-10-21 (architecture review)

A lean review covered module boundaries, folder structure and resource lifecycles: three reviewers, one
skeptic per finding, 15 of 23 findings upheld. Every upheld finding was re-checked against the code before
changing anything. The fixes are in PR 7, on top of the stack.

### Bugs fixed

- **Export finishing after "← New file":** it no longer shows the old "Saved to your downloads" screen over
  the next project.
- **"← New file" and "Tune another vocal"** save the latest edits immediately. The 0.8 s debounced save used
  to be cancelled, losing the last edits.
- **Recent-files writes now run one at a time, in order, and the list waits for them.** Found while
  verifying the previous fix: the upload screen read the list a moment before the closing save finished, so
  it showed stale counts. Overlapping saves could also overwrite each other's index updates.
- **Closing a file cancels a one-shot note preview** (an Up/Down nudge) that is still loading. Its load or end
  timer could otherwise drive the pooled nodes the next file uses, and `play()` stops if the engine was
  disposed while the context resumed.
- **A drag the browser cancels** keeps its pitch and is recorded for undo. This predates the refactor.
- **Cmd/Ctrl+arrow zoom is off** while the Downloaded screen covers the editor, like the other shortcuts.
- **When Basic Pitch fails**, the editor says the notes are approximate, and they aren't saved to recent files
  (reopening never re-analyses). The fallback flag used to be computed and then dropped.
- **Notes sung outside the C2–C6 grid** are never nudged or dragged the wrong way: 84.6 nudged up used to drop
  to 84.

### Structure

These are pure moves.

- `audio/decode.ts` keeps the shared AudioContext and file decoding; loading and analysing a file moved to
  `audio/loadAudioFile.ts`.
- The shift rule (`midi - detectedMidi`) and `isEdited` live once, in `audio/music.ts`.
- Signalsmith settings shared by playback and export are in `audio/stretch.ts`, and `copyChannels` is in
  `audio/channels.ts`. Offline export no longer imports the realtime engine.
- `npm run build` now runs `scripts/check-chunks.mjs`, which fails if lamejs (LGPL) appears outside the MP3
  worker chunk. Verified by adding a deliberate stray import: the build failed and named the chunk.

### Exports are at the file's own sample rate (fixed)

**The problem.** `decodeAudioData` resamples to its AudioContext's rate, and every file is decoded through the
shared playback context, which runs at the output device's rate. So `Project.buffer` and playback are at the
device rate, and exports used to be too: a 44.1 kHz vocal opened on a 48 kHz Mac exported as a 48 kHz WAV. The
earlier entries saying "at the original rate" and "bit-exact" were wrong until this fix.

**The fix touches export only.** Playback and analysis are unchanged.

- `audio/nativeRate.ts` reads the rate from the file's header: WAV/RF64, AIFF, FLAC, MP3 (after any ID3 tag,
  confirmed by two consecutive frames), and Ogg (Vorbis, or Opus, which is always 48 kHz).
- MP4/M4A and WebM return null. Their compressed data can contain bytes that look like MP3 frames: a real
  M4A misread as 44.1 kHz before they were excluded.
- When the file's rate differs from the project's, `exportTuned` decodes the file again at its own rate through
  an `OfflineAudioContext`, which decodes to its own rate. That copy exists only during the export.
- Note times are in seconds, so edits line up at any rate.
- Unknown formats and any failure fall back to the playback-rate buffer.

**MP3 rates.** MP3 can only use the standard MPEG rates (8 to 48 kHz). Other rates round up to the next
supported one, so nothing is lost, and anything above 48 kHz becomes 48 kHz.

**Verified.**

- 10 unit tests on synthetic headers. These include an extra chunk before `fmt `, ID3 tags before FLAC and MP3,
  a fake MP3 sync in junk, and MP3-looking bytes inside an M4A.
- Real files made with ffmpeg: WAV 48k/96k, AIFF, FLAC 88.2k, MP3 22.05k/32k/48k (tagged and untagged), Opus,
  M4A, and the Looperman vocals.
- In the app, with the browser at 44.1 kHz:
  - 22.05k, 48k and 96k WAV and 48k MP3 sources each export at their own rate and length.
  - With no edits, exports are sample-identical to the source: exact for 24-bit, and within one 24-bit step
    otherwise.
  - Edited notes at 22.05 kHz: 28/28 within 20 cents of their targets, worst 13.

`AudioEngine.create` throws if a buffer's rate differs from the context's, which makes the assumption playback
relies on visible.

### Reviewed and left as they are (impact too small)

- `storage/` importing `decodeAudioFile`
- one main bundle chunk
- note-name helpers living in `editor/layout.ts`
- two small `OfflineAudioContext` resamplers
- where `useAudioEngine` lives
- recent-files quota behaviour (already a documented choice)

## 2026-10-20 (editor refactor)

### PitchEditor and EditorScreen split into hooks

This is a behaviour-preserving refactor toward idiomatic React/TypeScript.

- **`PitchEditor`** (366 → 159 lines). The pieces moved into:
  - `useElementSize` (container size)
  - `useViewport` (zoom, scroll, fit-to-sung-range)
  - `usePanZoom` (wheel and Cmd/Ctrl+arrow zoom)
  - `useRevealSelection` (scroll a keyboard-selected note into view)
  - `usePlayhead` (per-frame line, following)
  - `useNoteGestures` (hit testing, drag, marquee, hover, ruler seek, preview grab)
- **`EditorScreen`** (248 → 127 lines). The pieces moved into:
  - `useEditHistory` (preview/commit/apply, undo/redo)
  - `usePlayback` (engine wiring)
  - `useEditorShortcuts` (the keyboard table)
- **The engine reports its state instead of being polled.** `AudioEngine.subscribe()` emits `play`, `pause`,
  `end` and `seek`. React reads `playing` through `useSyncExternalStore`, and the playhead and readout redraw
  on engine events. That replaces the `playheadRevision` counter and three effects that only existed to
  re-run on it.
- **Lint and typing clean-ups.**
  - TypeScript `strict` is on.
  - The stricter oxlint rules that matter (`no-shadow`, effect dependencies, nested ternaries,
    `require-await`) report nothing.

**How it was checked.**

- A 110-item behaviour inventory guided the work, which went through two rounds of lens-specific review with
  two skeptics per finding.
- It was then exercised in the browser with real input: seeks while paused, ruler click, playback, holding a
  note mid-playback, box select, arrow selection and nudge, undo, Cmd+arrow zoom, following, Tune Up,
  Controls/Esc, and WAV export.
- An A/B performance run against the pre-refactor build showed the same canvas updates per scroll step and
  comparable React time.
- Zoomed-in sideways panning of a 3-minute vocal peaks around 30 ms per frame on both builds, because Konva
  redraws every note. That predates the refactor and is a separate follow-up.

### With no audio engine, Enter and ruler clicks change nothing

Seeks now reach the playhead and the time readout through the engine's own events instead of a revision
counter in the editor. While the engine is loading, or after "Playback isn't available", Enter and a ruler
click therefore do nothing. Before, they still turned following back on without moving the playhead (it
stays at 0:00 without audio), so the next reveal or resize snapped the view back to the start. This narrows
"Play or any jump turns it back on" (2026-10-13): with no engine nothing jumps, which matches the transport
buttons being disabled. With an engine, seeks behave as before.

## 2026-10-14 (Phase 4)

### Export renders offline through the playback path

`renderTuned` runs the original through the same Signalsmith node settings, transpose schedule and
`ShiftScheduler` as playback, in an `OfflineAudioContext`. The render pauses at each point where the next
change can be queued. A project with no edits is exported untouched: bit-exact against the file decoded at
its own rate (see 2026-10-21).

Measured with `exportCheck` on the synthetic vocal, every other note moved:

| Check | Result |
| --- | --- |
| Length | identical to the original |
| Notes at target pitch | 28/28 within 20 cents (median pitch over each note; worst 14) |
| Clicks at the 37 shift changes | none added (max 1.22× the original) |
| Time offset | 2 ms |
| Speed | 29× real time |

On the 3-minute test vocal with 280 of 522 notes moved: WAV in 6 s (47 MB), MP3 in 16 s (4.2 MB).

### WAV is 24-bit PCM at the file's own rate; MP3 is 192 kbps, at most 48 kHz

The file's own rate has applied since 2026-10-21; before that, exports used the playback context's rate. MP3
uses the standard MPEG rates only, so other rates round up to the next one and anything above 48 kHz becomes
48 kHz.

### MP3 uses `@breezystack/lamejs`, isolated in its own worker chunk

The maintained fork of lamejs (LGPL-3.0); the original's npm build breaks in bundlers. It is imported only by
the MP3 worker. Shared constants are in `mp3Limits.ts`, because importing even a constant from `mp3.ts`
pulled lamejs into the main bundle (caught in the dev server's network log). The production build shows the
encoder only in `mp3.worker-*.js`. The package's LICENSE file is LAME's usage note, so the full LGPL-3.0
and GPL-3.0 texts were added from gnu.org.

### The Downloaded screen is an overlay; the editor stays mounted underneath

"Back to editor" keeps undo history, selection and zoom. Editor shortcuts are off and playback pauses while
the overlay is up. This replaces the scaffold's "Export corrections" JSON download with real audio export.

### Recent files: IndexedDB via idb-keyval, edits stored separately

Each project stores the original file, peaks and F0 under one key (written once) and the notes/edits under
another, saved 0.8 s after editing stops. Saving an edit never rewrites the original audio. The list keeps 10
projects, newest first, and each one has a delete button.

Reopening skips decode-to-analysis: 0.26 s for the 53 s vocal, against about 9 s to analyse. Storage errors
(e.g. quota) are logged and never block editing. The list sits under the drop zone on the upload screen,
not behind a header button as the plan sketched.

### Buttons don't keep focus after a mouse click

Space and Enter stay play/pause and back-to-start after clicking any toolbar button. A button reached with
Tab still responds to Space and Enter itself.

### Fixed: the shortcut hint widened the page

The hint now sits on its own line and is trimmed with an ellipsis; the full text is in its tooltip.

## 2026-10-14 (editor additions)

### "Tune Up" button

One click moves every off-pitch note (the pink/red ones, more than 10 cents from a semitone, the same rule as
the colours) to its nearest semitone, as a single undoable edit. On the test vocal it moved 93 of 139 notes.
It's the only coloured control:

- a green gradient, with a light running around its border (a conic-gradient border animated through a
  registered `--tune-up-angle` custom property)
- the animation turns off under `prefers-reduced-motion`
- the button greys out when nothing is off pitch

It applies to all notes, not just the selection.

### Zoom: ⌘/Ctrl + →/← and faster scroll zoom

⌘/Ctrl + → zooms in 1.5× and ⌘/Ctrl + ← zooms out, around the middle of the view. The handler prevents the
browser's ⌘+← "back" shortcut, and arrows with ⌘/Ctrl no longer move the note selection. Scroll/pinch zoom is
twice as fast (wheel factor 0.002 → 0.004 per delta unit).

## 2026-10-14 (Phase 3 revisions)

### A note plays again from its start whenever it moves to a new pitch

This was flagged as very important.

- **Dragging:** each time the held note lands on a new pitch (half a semitone or more from where it last
  started), it restarts from its beginning at that pitch, behind a 12 ms fade dip. Fine (Alt) moves under
  half a semitone just bend the pitch.
- **Up/Down nudges:** the moved note plays once from its start at the new pitch, then stops. While the song
  is playing, nudges don't interrupt it; playback already reflects the change.

Measured with `src/dev/audioChecks.ts` (`retriggerCheck`, `nudgeCheck`, `loopCheck`).

### Fixed: the held-note loop never looped

The preview measured the note's length after `addBuffers` had transferred (emptied) the sample arrays, so
the loop end was 0, which disables looping. A held note played once and then went silent. Length is now
measured before the transfer. `loopCheck` holds a 1 s note for 2.5 s and confirms it sounds the whole time.

### Dev builds expose the engine as `window.__audioEngine`

This is for the audio checks and console debugging, and is stripped from production builds.

## 2026-10-13 (Phase 3 revisions, from Aidan's review)

### Clicking a note plays it on a loop until release, even during playback

This supersedes "Drag preview only plays the dragged note ... the preview is skipped while playback is
running". Now a press on a note always starts the looped preview at once. If the song was playing, it pauses
and resumes from the same spot on release, with any pitch change applied. Moving the note while holding
changes the looped pitch live. Verified in the app: paused at 0.82 s, resumed from 0.84 s.

### The view follows the playhead only until the user scrolls or zooms

Following is page-by-page: when the playhead leaves the view, the view jumps so it sits at 10% from the
left. Any wheel scroll or zoom turns following off, and Play or any jump (Enter, arrows, ruler click, skip
buttons) turns it back on.

### < and > move the playhead between notes; Enter returns to the start

< and > jump the playhead to the previous/next note start; `,` and `.` work too, so Shift isn't needed.
Rewind has 150 ms of slack, so pressing it at a note's start goes to the note before. ← and → still step
the selection between notes (Phase 2), and Up/Down still move selected notes.

### Transport: back to start, rewind, play/pause, fast forward

Styled after the reference screenshot (dark segmented buttons, green play icon). Rewind and fast forward do
the same as < and >. Space and Enter are handled at the window level and their default is prevented, so a
focused transport button never fires twice.

## 2026-10-13 (Phase 3)

### Signalsmith nodes are pooled and reused, never discarded

Signalsmith's worklet `process()` always returns `true`, so a node is never garbage collected and keeps
running its STFT even after it is disconnected. Creating nodes per recording would leak a full copy of the
audio, plus audio-thread CPU, every time a file is opened (twice in React dev mode).

`AudioEngine` takes a playback + preview pair from a per-`AudioContext` pool. On dispose it fades out, drops
the buffers and returns the pair. Nodes are always created stereo: mono recordings are played on both
channels by the node itself.

### Drag preview only plays the dragged note

The preview node gets just the note's slice (plus 50 ms pre-roll) on each grab, looped, so it never holds a
second copy of the whole file. While playback is running, the preview is skipped: playback re-plans its
schedule on every edit instead, so you hear the change in context.

### Edits during playback re-plan from "now + output latency"

The engine posts a segment at that time with the current shift, using `outputTime` just before it, so
segments that have already started are kept. The scheduler then restarts from there.

### The scheduler is driven by the worklet's time reports

`setUpdateInterval(20 ms)` runs the scheduler from the audio thread's reports, with a 50 ms timer as backup.
Timers alone are throttled in background tabs.

### Measured (dev server, Chromium, this MacBook Air)

Re-run with `src/dev/audioChecks.ts`.

| Check | Result |
| --- | --- |
| Drag preview latency | engine 21–22 ms (median of 6) + device output 38 ms = **about 59 ms heard** (target about 75 ms) |
| Playback, synthetic vocal with every other note moved +2 / −3 | 13–17 of 13–17 notes at the target pitch (within 40 cents; the remainder is vibrato in the 46 ms window) |
| Clicks at note boundaries | click energy at each of 17–20 shift changes 0.7–1.28× the unedited passage (≈1 = nothing added) |

## 2026-10-13 (Phase 2)

### Untouched notes keep their sung (fractional) pitch

`midi` starts equal to `detectedMidi` instead of the rounded `originalMidi`. A note that hasn't been
touched is never retuned, and the shift is always `midi - detectedMidi`. With snap on, the first drag
lands the note on a semitone, which also corrects its tuning.

### Two clarity levels for the F0 curve

The real test vocals sat well below the planned 0.85 clarity cutoff: median clarity inside notes was 0.81,
0.88 and 0.94, and only 31% of note frames were voiced on one vocal. Frames now count:

- at **0.85** anywhere
- at **0.6** inside a detected note, if they are within a semitone of its pitch

Notes with fewer than 3 supporting frames fell from 103 to 54 (of 171) on that vocal. Lowering the inside
cutoff below 0.6 barely helped.

### Outlier filter for stray detections

A note is dropped only if it is shorter than 0.2 s, at least 7 semitones from the median of its neighbours
within 2 s, and less than 50% backed by matching F0 frames. On the test vocals this removes 3 to 7 blips each
(overtones an octave up, breaths). A supported leap is kept even when it is short.

### Display curve: breaks at jumps over a semitone, hides runs shorter than 70 ms outside notes

The tracker's octave jumps had drawn long vertical lines across the grid.

### Pointer handling moved from Konva `draggable` to DOM pointer events on the editor

This supports multi-note drags, pointer capture (drags that leave the canvas) and the selection box. Hit
testing is a simple scan over the notes, and every Konva layer is `listening={false}`, so Konva builds no
hit canvas.

### Keyboard: Left/Right always step to the previous/next note

The plan had this only when nothing is selected. Stepping from the current selection is the more useful
behaviour, and Escape clears the selection.

### Labels on hover and for selections of 3 or fewer

Labels on every selected note overlapped once a box selection covered more than a few notes. Wide blobs
still always show their label, as in the scaffold.

### Performance (production build, 3-minute vocal, 522 notes, Chromium)

Cost per update, against a 16.7 ms budget for 60 fps:

| Action | p95 per update |
| --- | --- |
| Pan, zoomed in | 13–15 ms |
| Pan, fully zoomed out (all notes drawn) | 15.6 ms (17.3 ms before caching the blob element list) |
| Move one note with all 522 on screen | about 1 ms React + 6 ms Konva drawing |
| Move all 522 notes at once | 27 ms (about 37 fps) |

Konva's full redraw is about 5–6 ms of every update. If whole-song moves need to be smoother, the next step
is caching blob shapes or splitting static and moving notes across layers.

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
