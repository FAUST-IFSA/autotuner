// Spike 3: run Basic Pitch on the server side and print notes + timing.
// Usage: npx tsx basic-pitch/run.ts <22050-mono-16bit.wav> [truth.json]
// Set TF_BACKEND=node to try @tensorflow/tfjs-node (if installed).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const useNode = process.env.TF_BACKEND === 'node';
const tf: typeof import('@tensorflow/tfjs') = useNode
  ? require('@tensorflow/tfjs-node')
  : await import('@tensorflow/tfjs');
const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } =
  await import('@spotify/basic-pitch');

function readWav16Mono(file: string): { samples: Float32Array; sampleRate: number } {
  const b = fs.readFileSync(file);
  const sampleRate = b.readUInt32LE(24);
  let o = 12;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4),
      size = b.readUInt32LE(o + 4);
    if (id === 'data') {
      const n = size / 2,
        s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
      return { samples: s, sampleRate };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

async function loadModel(): Promise<import('@tensorflow/tfjs').GraphModel> {
  const dir = path.dirname(require.resolve('@spotify/basic-pitch/package.json')) + '/model';
  const json = JSON.parse(fs.readFileSync(`${dir}/model.json`, 'utf8'));
  const weightSpecs = json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights);
  const weightData = Buffer.concat(
    json.weightsManifest.flatMap((g: { paths: string[] }) =>
      g.paths.map((p) => fs.readFileSync(`${dir}/${p}`)),
    ),
  );
  const ab = weightData.buffer.slice(
    weightData.byteOffset,
    weightData.byteOffset + weightData.byteLength,
  );
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs,
      weightData: ab,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
    }),
  );
}

const [wavPath, truthPath] = process.argv.slice(2);
if (!wavPath) throw new Error('usage: run.ts file.wav [truth.json]');
const { samples, sampleRate } = readWav16Mono(wavPath);
if (sampleRate !== 22050) throw new Error(`expected 22050 Hz, got ${sampleRate}`);
await tf.ready();
console.log(
  `backend: ${tf.getBackend()} (tfjs ${tf.version.tfjs}), audio ${(samples.length / sampleRate).toFixed(1)} s`,
);

let t0 = performance.now();
const model = await loadModel();
console.log(`model load: ${(performance.now() - t0).toFixed(0)} ms`);

const frames: number[][] = [],
  onsets: number[][] = [],
  contours: number[][] = [];
t0 = performance.now();
await new BasicPitch(Promise.resolve(model)).evaluateModel(
  samples,
  (f, o, c) => {
    frames.push(...f);
    onsets.push(...o);
    contours.push(...c);
  },
  () => {},
);
const inferMs = performance.now() - t0;
const notes = noteFramesToTime(
  addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)),
).sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
console.log(
  `inference: ${inferMs.toFixed(0)} ms (${(samples.length / sampleRate / (inferMs / 1000)).toFixed(1)}x real time), ${notes.length} raw notes`,
);
for (const n of notes)
  console.log(
    `  ${n.startTimeSeconds.toFixed(2)}-${(n.startTimeSeconds + n.durationSeconds).toFixed(2)}  midi ${n.pitchMidi}  amp ${n.amplitude.toFixed(2)}`,
  );

if (truthPath) {
  const truth: { notes: { startSec: number; endSec: number; midi: number }[] } = JSON.parse(
    fs.readFileSync(truthPath, 'utf8'),
  );
  let hit = 0;
  for (const tn of truth.notes) {
    const mid = (tn.startSec + tn.endSec) / 2;
    if (
      notes.some(
        (n) =>
          n.startTimeSeconds <= mid &&
          mid <= n.startTimeSeconds + n.durationSeconds &&
          n.pitchMidi === Math.round(tn.midi),
      )
    )
      hit++;
  }
  console.log(
    `truth match: ${hit}/${truth.notes.length} notes have a correct-pitch detection covering their midpoint`,
  );
}
