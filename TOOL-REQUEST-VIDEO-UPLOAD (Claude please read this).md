# Request: accept phone videos (MP4/MOV) as input

From: landing-page team (Paris). Re: FAUST-IFSA/autotuner, checked against commit e255279.

## Goal
A big part of the audience is kids uploading from their phone. They have a video of themselves singing,
not an audio file. They should be able to drop the video and get a tuned WAV/MP3 back. Export already
works; only the input side needs to change.

## Why it's small
`decodeAudioFile` (src/audio/decode.ts) already uses `AudioContext.decodeAudioData()`, which on Chrome,
Safari and Firefox (macOS/Windows/Android) decodes the AAC audio track straight out of an MP4/MOV
container and ignores the video. No demuxer, no ffmpeg. The only gate is the dropzone:

    src/screens/UploadScreen.tsx:51   accept: { 'audio/*': [] }

Side effect worth knowing: on iOS Safari, `accept="audio/*"` hides the Photo Library in the picker.
Adding video types makes "Photo Library" appear, which is what makes the tool usable from a phone at all.

## Scope
1. Accept: add `'video/mp4': ['.mp4', '.m4v']`, `'video/quicktime': ['.mov']`, `'audio/mp4': ['.m4a']`.
2. Copy: update the three strings that list formats
   - UploadScreen.tsx:50  onDropRejected message ("...audio file under 100 MB")
   - UploadScreen.tsx:70  dropzone hint ("WAV, MP3, OGG, FLAC")
   - decode.ts:19         decode error ("Try a WAV, MP3, OGG or FLAC file.")
3. Size cap: `MAX_FILE_BYTES = 100 MB` (UploadScreen.tsx:8) rejects most phone videos. iPhone 1080p is
   ~60-130 MB/min, 4K 300+ MB/min, so a 3-minute song is 200-400 MB. Raise the cap for video (suggest
   500 MB) but note `file.arrayBuffer()` holds the whole file in RAM before decoding; mobile Safari
   tabs die around 1-1.5 GB. Your call on the exact number; please test on a real iPhone.
4. Recent files: `StoredProject.file` (src/storage/recent.ts) persists the original Blob to IndexedDB.
   With video that caches hundreds of MB per project, x10 recents. Options: store a decoded/re-encoded
   audio blob instead of the original when the input is video, or don't add video uploads to recents.
   Recommend the first (also fixes the memory cost of reopening).
5. The 10-minute duration cap can stay.

Out of scope for now: streaming demux (mp4box.js + WebCodecs AudioDecoder) to avoid loading the whole
file. Only needed if (3) proves too tight. ffmpeg.wasm is the wrong tool: ~30 MB download, and its
multithreaded build needs COOP/COEP headers GitHub Pages can't send.

## Acceptance criteria
- An iPhone .mov (HEVC and H.264) and an Android .mp4 picked from the camera roll analyse, tune and
  export to WAV and MP3 with no errors, on iOS Safari, Android Chrome and desktop Chrome/Safari.
- A 3-minute 1080p phone video (~250 MB) completes the flow on a mid-range phone without the tab crashing.
- Rejected/undecodable files show a message that names video as a supported input.
- Reopening a video-sourced project from Recent files works and does not store the video bytes.
- Firefox on Linux (no AAC decoder) fails with the decode error, not a crash. Acceptable.
- No absolute `/models/...`-style paths introduced; the build must still work under `/website-prod/tool/`.

## Please tell us
- The commit SHA when it's ready, so we can bump `autotuner.commit` in site.config.json.
- Whether the drop-zone text changed, so we can retake the How-it-works screenshot.
- The final size cap, so the landing page copy matches.
