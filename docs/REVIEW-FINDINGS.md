# Review findings from the stacked PRs (#3 to #9)

Daniel's review of the seven stacked PRs left **20 inline review threads**, all unresolved. The stack was
superseded when [#10](https://github.com/FAUST-IFSA/autotuner/pull/10) (2026-10-29) and
[#11](https://github.com/FAUST-IFSA/autotuner/pull/11) (2026-11-01) merged into `main`, so #3 to #9 are stale
and their threads would be easy to lose. This file collects them in one place: the bugs and edge cases found,
the open decisions, and the explanatory notes.

**Status** was checked against `main` at commit `a5850cb` on 2026-11-01. "Open" means the problem is still
there, "Partly done" means part of it was fixed after the review, and "Decision" means it needs a team call.

For what was fixed and why, see [`DECISIONS.md`](DECISIONS.md). This file only tracks what the reviews raised.

## Summary

| #   | Topic                                                         | Where raised | Status                           |
| --- | ------------------------------------------------------------- | ------------ | -------------------------------- |
| 1   | Notes that span a breath or rest are never split              | #4           | Open                             |
| 2   | Detection fallback (loudness segments) is a poor substitute   | #4           | Partly done                      |
| 3   | Pooled playback and preview nodes keep state between files    | #6           | Open (hardening); pooling is deliberate |
| 4   | Analysis runs on a 22,050 Hz mono copy                        | #4           | Open (undocumented)              |
| 5   | Export has to work around one-change-at-a-time scheduling     | #7           | Open question                    |
| 6   | Limitations are documented only in scattered code comments    | #7           | Done (`LIMITATIONS.md`)          |
| 7   | MP3 export and LGPL compliance                                | #7, #9       | Decision                         |
| 8   | Clarity and outlier thresholds come from three test vocals    | #5           | Open                             |
| 9   | Spike code has a wrong script reference                       | #3           | Done                             |
| 10  | Preview while the song is playing; recent-files placement     | #6, #7       | Done (recorded in `DECISIONS.md`) |
| 11  | How much license bookkeeping is needed                        | #4           | Note                             |

## Bugs and edge cases

### 1. Notes that span a breath or rest are never split

Basic Pitch sometimes draws one note straight across a breath or short pause. The cleanup that follows only
trims, drops or merges notes, and never cuts one open where the F0 curve goes silent. In `src/audio/notes.ts`,
`toMonophonic`, `mergeFragments` and `dropOutliers` have no splitting step, and a gap under 40 ms
(`MERGE_GAP_SECONDS`) between two notes at nearly the same pitch is closed.

**Effect.** You get one blob covering both sides of the gap. Dragging it moves the whole stretch by the same
amount, so the two sides can't be tuned differently.

**Possible fix.** Split a segment where the F0 curve is unvoiced for longer than a threshold inside the note
(before `mergeFragments`), and add a case to `notes.test.ts` for one note covering a rest.

**Status: Open.** Raised in #4: [notes.ts:66](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339788257),
[notes.test.ts:22](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339976337).

### 2. The fallback gives much worse notes, and its failure rate is unknown

If model loading or inference fails, `analyzePitch` falls back to the loudness segmenter: one blob per loud
region instead of one per sung note. The editor looked the same, so a user couldn't tell.

The review asked for the user to be told, suggested **pYIN** as the fallback instead of loudness detection, and
wanted to know how often Basic Pitch actually fails.

- **Done.** `analyzePitch` returns `usedFallback`, `loadAudioFile` sets `approximateNotes`, the editor shows
  "Note detection was unavailable, so these notes are approximate. Reload and try again.", and approximate
  projects are not saved to recent files.
- **Open.** Nothing measures how often the fallback happens (the failure is only a `console.error`, and there is
  no backend to collect it). The fallback is still the loudness segmenter, not pYIN.

**Status: Partly done.** Raised in #4:
[analyze.ts:11](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339736759) and
[follow-up](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339752301).

### 3. Pooled nodes keep state between files

Playback and preview nodes are reused across files. A reused node has history (loop points, the previous
preview's semitones, a tick callback). `releaseVoices` resets some of it (`setUpdateInterval`, `dropBuffers`),
so correctness depends on every future setting being reset there. A fresh node per file would have no such risk.

**Why it is pooled anyway.** `DECISIONS.md` ("Signalsmith nodes are pooled and reused, never discarded")
explains that Signalsmith's worklet `process()` always returns `true`, so a node is never garbage collected and
keeps running after it is disconnected. Creating nodes per recording would leak a copy of the audio and
audio-thread CPU each time a file opens. Replacing the pool with fresh nodes would bring that leak back unless
a node can be shut down properly.

**Possible fix.** Keep the pool, but put every reset in one place and add a check that a reused pair behaves
like a fresh one. Separately, look for a supported way to shut a Signalsmith node down.

**Status: Open (hardening).** Raised in #6:
[AudioEngine.ts:27](https://github.com/FAUST-IFSA/autotuner/pull/6#discussion_r4435932988). Closing a file now
also cancels a preview that is still loading (#9), which removes one way for state to leak.

### 4. Analysis runs on a 22,050 Hz mono copy

Basic Pitch needs exactly 22,050 Hz mono, so analysis uses a resampled mono copy. Playback and export use the
original.

- **22,050 Hz.** Anything above about 11 kHz is gone from the analysis copy only. A sung vowel's identity and
  pitch live well below that. What lives above it are noisy consonants (English s, sh, th; Czech s, š, c, ř).
  Basic Pitch isn't trained to hear those as notes, so they mostly mark gaps. Removing them can make pitch
  cleaner, but can also soften the attack the model uses to find where a note starts. The effect is small, and
  slightly larger for Czech because ř and consonant clusters are more common.
- **Mono.** A close-miked solo vocal is already one signal. Mono hurts when the recording isn't one voice: a
  doubled chorus, a harmony or a wide stereo effect becomes one stream, and the louder note wins any overlap.
  Czech and English choirs fail the same way.

The review added "flags^", meaning these cases should be flagged to the user.

**Status: Open.** As of this check, neither `DECISIONS.md` nor the UI mentions these limits. Raised in #4:
[analysis.worker.ts:12](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339678157).

### 5. Export has to work around one-change-at-a-time scheduling

Signalsmith's `schedule()` holds only one future change. To export faster than real time, the offline render
(`renderTuned` in `src/audio/export.ts`) suspends at each point where the next change can be queued, posts it,
and resumes. The review wondered whether there is a way around this.

It works (see "Export renders offline through the playback path" in `DECISIONS.md`: 29x real time, no clicks
added), so this is an open question, not a bug.

**Status: Open question.** Raised in #7:
[export.ts:27](https://github.com/FAUST-IFSA/autotuner/pull/7#discussion_r4436020465).

### 6. Limitations are documented only in scattered code comments

Edge cases such as "MP3 tops out at 48 kHz", "M4A and WebM exports stay at the playback rate because their
headers aren't read", the rest-splitting gap, the mono and 22,050 Hz analysis, and the scheduling workaround
live in code comments and individual `DECISIONS.md` entries. The review asked for them to be documented
consistently in one place.

**Status: Done.** The list now lives in [`LIMITATIONS.md`](LIMITATIONS.md), grouped by detection, export and
engine, each with its code location. Raised in #7:
[exportFile.ts:46](https://github.com/FAUST-IFSA/autotuner/pull/7#discussion_r4436024772). Items 1 to 5 here were
the starting list.

## Decisions and open questions

### 7. MP3 export and LGPL compliance

MP3 is optional. A WAV-only export removes the whole LGPL concern. Other LAME builds, including LAME compiled to
WASM, are also LGPL, so switching encoders wouldn't avoid it. Whether MP3 is worth the licence overhead is a
product decision.

Today MP3 uses `@breezystack/lamejs` (LGPL-3.0), imported only by the MP3 worker. `scripts/check-chunks.mjs`
fails the build if the encoder shows up in any other chunk, and the full LGPL and GPL texts are in
`docs/licenses/texts`. The review's open point is whether that is enough to be compliant.

**Options.**

- Drop MP3 and keep WAV only.
- Keep MP3 and confirm what compliance requires (keeping the library replaceable, notices, source
  availability), then record it.

**Status: Decision.** Raised in #7 ([DECISIONS.md:29](https://github.com/FAUST-IFSA/autotuner/pull/7#discussion_r4436011973))
and #9 ([check-chunks.mjs:1](https://github.com/FAUST-IFSA/autotuner/pull/9#discussion_r4436036798), "LGPL
compliance (with MP3) is an open question").

### 8. Clarity and outlier thresholds come from three test vocals

The F0 curve accepts frames at clarity **0.85** anywhere and **0.6** inside a detected note (within a semitone
of its pitch). The outlier filter drops a note only if it is under 0.2 s, at least 7 semitones from the median
of its neighbours within 2 s, and under 50% backed by matching F0 frames. These values came from measurements
on the three test vocals, and the 0.6 cutoff was tuned mostly on one of them (only 31% of its note frames were
voiced at 0.85). The review suggested sweeping the values across different songs.

**Status: Open.** Raised in #5: [DECISIONS.md:22](https://github.com/FAUST-IFSA/autotuner/pull/5#discussion_r4340027535).
See "Two clarity levels for the F0 curve" and "Outlier filter for stray detections" in `DECISIONS.md`.

### 9. Spike code references the wrong script

`docs/spikes/code/audio-index.html` loaded `./main.ts`, but the file is `audio-main.ts`. It is reference code that
is not built, so this only mattered to someone trying to run the spike. The script tag now points at
`./audio-main.ts`. Running the spike also needs `signalsmith-stretch` installed and the synthetic vocal fixtures
served from the site root (`audio-main.ts` fetches `/synth-vocal-44k-stereo.wav` and `/synth-vocal.truth.json`).

The same review on #3 also said the "Phase 1" section of `DECISIONS.md` described code that wasn't in that PR.
That is moot now that the code is on `main`.

**Status: Done (script path fixed on the `docs/review-findings-work` branch).** Raised in #3: [audio-index.html:43](https://github.com/FAUST-IFSA/autotuner/pull/3#discussion_r4336772417),
[DECISIONS.md](https://github.com/FAUST-IFSA/autotuner/pull/3#discussion_r4336900410).

### 10. Preview during playback, and recent-files placement

Both were raised as notes and are already recorded.

- **Preview during playback.** Pressing a note now always starts the looped preview, pausing the song and
  resuming from the same spot on release. This replaced an earlier rule that skipped the preview while the song
  played so you would hear the change in context. The replacement is recorded in `DECISIONS.md` under
  "Clicking a note plays it on a loop until release". One leftover: the older entry "Drag preview only plays the
  dragged note" still says the preview is skipped during playback, and could point to the newer one.
  ([audioChecks.ts:225](https://github.com/FAUST-IFSA/autotuner/pull/6#discussion_r4435971464))
- **Recent files.** The 10 most recent files are kept, and the list sits under the drop zone on the upload
  screen, not behind a header button as `PLAN.md` sketched. Recorded in `DECISIONS.md` under "Recent files".
  ([DECISIONS.md:48](https://github.com/FAUST-IFSA/autotuner/pull/7#discussion_r4436017342))

### 11. How much license bookkeeping is needed

The review asked whether all the licence material is required. The answer recorded:

- MIT packages that ship (React, Konva, pitchy, Signalsmith and the rest) need their copyright and licence
  notice kept with the distribution. One `THIRD_PARTY_LICENSES` file shipped next to the build covers this.
- Apache-2.0 code that ships (Basic Pitch, TensorFlow.js and the model weights) needs the Apache licence, a note
  if the code was changed, and any NOTICE file. Copying the model's LICENSE into `public/models/basic-pitch/`
  is the one copy that matters, because those weights are served to the browser.
- Dev tools (Vite, TypeScript, oxlint, Vitest, the checker and `@types/*`) don't ship, so keeping their full
  texts in the repo is optional.
- `scripts/licenses-check.mjs` is a guardrail, not a legal requirement. It fails the build on GPL, AGPL or LGPL
  packages, with lamejs as the only exception. It is worth keeping when several people add dependencies.

So the useful set before a release is one notice file for the packages that ship, the Apache licence beside the
model weights, and the check script if the GPL ban should stay enforced.
([licenses-check.mjs](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339628872))

## Explanatory notes from the reviews

- **Why `scripts/copy-assets.mjs` exists.** It copies the model and WASM binaries into `public/` so audio and
  models never go to an external server.
  ([#4](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339605753))
- **What `src/audio/f0.ts` does.** It measures the sung pitch over time. It doesn't find note boundaries and
  doesn't change the audio. `analyze.ts` calls it once, before Basic Pitch, on the 22,050 Hz mono copy. It steps
  through the audio 256 samples (about 12 ms) at a time, looks at 1,024 samples (about 46 ms) per step, and asks
  pitchy for a frequency and clarity. Frames are stored as null if clarity is too low, the pitch is outside
  70 to 1,100 Hz, or the frame is very quiet compared with the loudest part of the file. A 5-frame median
  smooths each voiced stretch without crossing a gap. The review note quotes the 0.6 cutoff, which is the
  inside-a-note threshold; the 0.85 cutoff still applies outside notes (see item 8).
  ([#4](https://github.com/FAUST-IFSA/autotuner/pull/4#discussion_r4339864285))
- **Spike files in #3.** `audio-index.html` tests Signalsmith, which does the pitch shifting;
  `audio-main.ts` is used to measure pitch in tests; `basic-pitch-run.ts` uses Spotify's Basic Pitch as ground
  truth for pitch detection.
  ([1](https://github.com/FAUST-IFSA/autotuner/pull/3#discussion_r4339332168),
  [2](https://github.com/FAUST-IFSA/autotuner/pull/3#discussion_r4339363121),
  [3](https://github.com/FAUST-IFSA/autotuner/pull/3#discussion_r4339422504))

## Review outcomes

- [#4](https://github.com/FAUST-IFSA/autotuner/pull/4): **changes requested** (7 threads).
- [#5](https://github.com/FAUST-IFSA/autotuner/pull/5): **approved** with "LGTM, please address code comments"
  (1 thread).
- [#3](https://github.com/FAUST-IFSA/autotuner/pull/3) (5 threads), [#6](https://github.com/FAUST-IFSA/autotuner/pull/6)
  (2), [#7](https://github.com/FAUST-IFSA/autotuner/pull/7) (4) and
  [#9](https://github.com/FAUST-IFSA/autotuner/pull/9) (1): comments only.
- [#8](https://github.com/FAUST-IFSA/autotuner/pull/8), [#10](https://github.com/FAUST-IFSA/autotuner/pull/10)
  and [#11](https://github.com/FAUST-IFSA/autotuner/pull/11): no review threads.

## Suggested follow-up order

1. Split notes at rests (item 1). It is the only item that affects results users see.
2. Decide on MP3 (item 7), because it affects what has to be documented and shipped.
3. Measure how often the fallback happens, and decide on pYIN (item 2).
4. Document the analysis and export limits in one place (items 4 and 6).
5. Harden the node pool (item 3) and sweep thresholds (item 8) when touching those areas next.
