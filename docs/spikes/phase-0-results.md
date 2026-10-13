# Phase 0 spike results (2026-10-08)

Machine: MacBook Air (arm64), macOS 26 (Darwin 25.6), Node 22.19.0, Chromium (Claude desktop browser pane).
Test material: `fixtures/synth-vocal-*` from `scripts/make-fixture.mjs`, a synthetic 30 s "vocal" with vowel
formants, vibrato, scoops and breath noise, plus 28 notes with known pitches (some deliberately detuned).
**Real vocals have not been tested yet** (clean dry, reverb, fast run). Those are still needed.

Spike code lives on the `aidan/phase-0-scaffold` branch (`spikes/`), which used the v1 monorepo layout.
These results carry over unchanged to the v2 plan (team scaffold, analysis in a browser worker).

## 1. Signalsmith live transpose (`spikes/audio`, "Live transpose")

Latency was measured objectively. A 440 Hz sine went through the node, a +12 semitone change was sent from
the main thread, and a recorder worklet captured the node output. The time to the octave jump was taken from
that recording (6 trials per config). Perceived latency adds `ctx.baseLatency` + `ctx.outputLatency`
(5.8 + 32 ms on this machine) + up to one frame (16 ms) of pointer-event throttling.

| Config                         | `latency()` | Measured node (median) | Est. perceived |
| ------------------------------ | ----------- | ---------------------- | -------------- |
| default preset (120 ms blocks) | 120 ms      | 58 ms                  | ~112 ms        |
| `preset: 'cheaper'`            | 140 ms      | 89 ms                  | ~143 ms        |
| `blockMs: 60`                  | 60 ms       | 32 ms                  | ~86 ms         |
| `blockMs: 40`                  | 40 ms       | 21 ms                  | ~75 ms         |
| `blockMs: 30`                  | 30 ms       | 15 ms                  | ~69 ms         |

Main-thread to worklet message: ~0.1 ms one-way.

- **The 50 ms target is not reachable on this hardware.** The device's own output latency (~38 ms) uses most
  of the budget. The node's part shrinks with smaller blocks (about half of `blockMs`).
- Recommendation: use a **separate preview node configured with `blockMs: 40`** for drag preview (~21 ms node
  latency), and the default preset for playback and export (better quality on low voices). `configure()`
  resets the stretcher, so don't reconfigure the playback node mid-drag. Send transpose changes directly from
  `pointermove`. Chrome already coalesces these per frame, so a rAF throttle only adds delay.
- Clicks on live slider moves: none visible in the offline measurements (see below). **Still needs a listening
  check on real vocals.** Open the spike page, press "Start looped vocal" and move the slider.

## 2. Signalsmith offline render (`spikes/audio`, "Offline render")

**Works inside `OfflineAudioContext`, and fast: a 30 s stereo 44.1 kHz render with 37 transpose changes took
1.0 s (30× real time).** 28/28 notes landed on the expected shifted pitch, with all detections within ±40 cents
(the residual is vibrato inside the 46 ms analysis window).

**API finding: `schedule()` can't hold a timeline.** From the 1.3.2 source:
`schedule(obj)` uses `obj.outputTime` (default: the worklet's `currentTime`, **not** `obj.output`) as "now".
It drops every queued segment at or after "now", then shifts out every segment up to "now". Queuing N
future changes up front therefore leaves only the last one, and the whole render plays at the final
transpose (confirmed: 660 Hz throughout instead of 440/880/440/660).

**Workaround that works with the unmodified package (just-in-time scheduling):** queue change _k_ only after
change _k−1_ has become active, passing `outputTime: t[k-1] + 1e-6` and `output: t[k]`.

- Offline: `ctx.suspend(t[k-1] − 60 ms)` → `await node.schedule(...)` → `ctx.resume()`.
- Realtime: the same rule driven by a main-thread lookahead timer.
- The lead must equal the node's **output latency, which is half of `latency()` (60 ms by default)**. That was
  confirmed by sweeping lead = 0 / 60 / 120 ms.

| Lead                    | Step change timing error | 40 ms notes timing error  |
| ----------------------- | ------------------------ | ------------------------- |
| 0 ms                    | +5.5 / −3.9 ms           | up to ±35 ms (late/early) |
| **60 ms (= latency/2)** | **+5.5 / −3.9 ms**       | **within ±15 ms**         |
| 120 ms                  | −58 / −63 ms (early)     | up to ±35 ms              |

(The ±5 ms floor is the resolution of the zero-crossing detector used in the test, not the node.)

**Clicks:** high-frequency energy at transpose changes was no higher than in the surrounding 300 ms (ratio
0.9 to 1.04). A 15 ms stepped ramp (5 sub-steps) changed nothing measurable, because the stretcher already
crossfades across its STFT block. No ramp API exists, and none appears to be needed. **Confirm by ear on real
vocals.** Use the "Play last offline render" or "Download last render" buttons after running the tests.

## 3. Basic Pitch in Node (`spikes/basic-pitch/run.ts`)

Model: loaded from the package's `model/` directory via `tf.io.fromMemory` (no `file://` handler needed).
Input: `Float32Array` at 22,050 Hz mono passed straight to `evaluateModel` (confirmed in the source: 22,050 Hz
mono is required). Output for the 30 s fixture: 188 raw (polyphonic) note events. **27/28 true notes have a
correct-pitch event covering their midpoint**, before any monophonic cleanup.

| Backend                                | 30 s inference | Speed   | Install                            |
| -------------------------------------- | -------------- | ------- | ---------------------------------- |
| `@tensorflow/tfjs` (pure JS CPU)       | 84.4 s         | 0.4× RT | fine                               |
| `@tensorflow/tfjs-backend-wasm` 4.22.0 | 4.6 s          | 6.5× RT | fine, no native code               |
| `@tensorflow/tfjs-node` 4.22.0         | 1.1 s          | 26× RT  | **fails in this repo** (see below) |

All three produced identical notes.

- **tfjs-node fails to build because the repo path contains a space** (`autotune prototype`). Its node-gyp
  build passes an unquoted include path. It installs and runs fine in a path without spaces. It also pulls
  in deprecated deps with `npm audit` advisories (tar, adm-zip, etc.).
- **Chosen for now: `@tensorflow/tfjs-backend-wasm`**. That means about 37 s of analysis for a 4-minute
  vocal, which is acceptable for the draft. Pure-JS CPU is unusable (about 11 minutes for 4 minutes of
  audio).
- `@spotify/basic-pitch@1.0.1` depends on `@tensorflow/tfjs@^3.2.0`. A root `overrides` entry forces one
  `@tensorflow/tfjs@4.22.0` everywhere, so the model and Basic Pitch share one engine. It works
  (identical output).
