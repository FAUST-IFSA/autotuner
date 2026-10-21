import type { Context } from 'konva/lib/Context'
import { memo, useMemo } from 'react'
import { Group, Line, Shape, Text } from 'react-konva'
import { centsOff } from '../audio/music'
import { peakRange } from '../audio/peaks'
import type { NoteSegment, Peaks } from '../types'
import { isEdited, tuningColor } from './edits'
import { BLOB_HALF_HEIGHT, ROW_HEIGHT, midiName, midiToY } from './layout'

interface Props {
  note: NoteSegment
  peaks: Peaks
  pxPerSec: number
  selected: boolean
  /** Show the name/cents label even when the blob is too narrow for it (hover, small selections). */
  labelled: boolean
}

const MID = ROW_HEIGHT / 2
const MIN_HALF_HEIGHT = 2
const SELECTED_STROKE = '#7f9cf5'

/** Traces the waveform envelope, mirrored around the row's centre line. */
function traceEnvelope(ctx: Context, envelope: Float32Array) {
  ctx.beginPath()
  ctx.moveTo(0, MID)
  for (let px = 0; px < envelope.length; px++) ctx.lineTo(px, MID - envelope[px])
  for (let px = envelope.length - 1; px >= 0; px--) ctx.lineTo(px, MID + envelope[px])
  ctx.closePath()
}

function formatCents(cents: number) {
  const rounded = Math.round(cents)
  return rounded === 0 ? '' : ` ${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}¢`
}

export const NoteBlob = memo(function NoteBlob({ note, peaks, pxPerSec, selected, labelled }: Props) {
  const x = note.start * pxPerSec
  const width = Math.max(2, Math.ceil((note.end - note.start) * pxPerSec))
  const edited = isEdited(note)
  const cents = centsOff(note.midi)
  // Offset of the nearest semitone's centre line from this blob's centre line (the tuner needle).
  const needle = (note.midi - Math.round(note.midi)) * ROW_HEIGHT
  const name = midiName(Math.round(note.midi))
  const label = `${edited ? `${midiName(note.originalMidi)} → ` : ''}${name}${formatCents(cents)}`

  const envelope = useMemo(() => {
    const halfHeights = new Float32Array(width + 1)
    for (let px = 0; px <= width; px++) {
      const t0 = note.start + px / pxPerSec
      const [lo, hi] = peakRange(peaks, t0, t0 + 1 / pxPerSec)
      halfHeights[px] = Math.max(MIN_HALF_HEIGHT, (Math.max(-lo, hi) / peaks.peak) * BLOB_HALF_HEIGHT)
    }
    return halfHeights
  }, [note.start, width, pxPerSec, peaks])

  return (
    <>
      {edited && (
        <Shape
          x={x}
          y={midiToY(note.detectedMidi)}
          stroke="#9aa1ab"
          strokeWidth={1}
          dash={[4, 3]}
          opacity={0.45}
          listening={false}
          sceneFunc={(ctx, shape) => {
            traceEnvelope(ctx, envelope)
            ctx.strokeShape(shape)
          }}
        />
      )}
      <Group x={x} y={midiToY(note.midi)} listening={false}>
        <Shape
          fill={tuningColor(cents, 0.5)}
          stroke={selected ? SELECTED_STROKE : tuningColor(cents, 0.9)}
          strokeWidth={selected ? 2 : 1}
          sceneFunc={(ctx, shape) => {
            traceEnvelope(ctx, envelope)
            ctx.fillStrokeShape(shape)
          }}
        />
        <Line points={[0, MID, width, MID]} stroke="#ffffff" strokeWidth={1} opacity={0.5} />
        {/* Strobe-tuner needle: from the sung pitch to the nearest semitone, with a cap on the semitone. */}
        <Line points={[1, MID, 1, MID + needle]} stroke={tuningColor(cents)} strokeWidth={2} />
        <Line points={[-3, MID + needle, 5, MID + needle]} stroke="#e6e8eb" strokeWidth={1} />
        {(width > 36 || labelled) && (
          <Text text={label} x={4} y={MID - BLOB_HALF_HEIGHT - 12} fontSize={10} fill="#e6e8eb" />
        )}
      </Group>
    </>
  )
})
