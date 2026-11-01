import type { StretchNode } from 'signalsmith-stretch'

// Settings shared by every Signalsmith Stretch node, for playback (AudioEngine) and export (renderTuned).

/** Formant compensation keeps a shifted voice from sounding chipmunk-like or muffled. */
export const VOICE = { formantCompensation: true, formantBaseHz: 0 } as const

/** A node's output latency: latency() is input + output latency, and output is half (Phase 0, spike 2). */
export async function outputLatencyOf(node: StretchNode): Promise<number> {
  return (await node.latency()) / 2
}
