import type { Context } from 'konva/lib/Context'
import type { KonvaEventObject } from 'konva/lib/Node'
import { memo, useMemo } from 'react'
import { Group, Line, Shape, Text } from 'react-konva'
import { peakRange } from '../audio/peaks'
import type { NoteSegment, Peaks } from '../types'
import { BLOB_HALF_HEIGHT, ROW_HEIGHT, midiName, midiToY, yToMidi } from './layout'

interface Props {
  note: NoteSegment
  peaks: Peaks
  pxPerSec: number
  onMidiChange: (id: string, midi: number) => void
}

const MID = ROW_HEIGHT / 2
const MIN_HALF_HEIGHT = 2

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container()
  if (container) container.style.cursor = cursor
}

/** Traces the waveform envelope, mirrored around the row's centre line. */
function traceEnvelope(ctx: Context, envelope: Float32Array) {
  ctx.beginPath()
  ctx.moveTo(0, MID)
  for (let px = 0; px < envelope.length; px++) ctx.lineTo(px, MID - envelope[px])
  for (let px = envelope.length - 1; px >= 0; px--) ctx.lineTo(px, MID + envelope[px])
  ctx.closePath()
}

export const NoteBlob = memo(function NoteBlob({ note, peaks, pxPerSec, onMidiChange }: Props) {
  const x = note.start * pxPerSec
  const width = Math.max(2, Math.ceil((note.end - note.start) * pxPerSec))
  const shift = note.midi - note.originalMidi
  const label = shift === 0 ? midiName(note.midi) : `${midiName(note.midi)} (${shift > 0 ? '+' : ''}${shift})`

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
      {shift !== 0 && (
        <Shape
          x={x}
          y={midiToY(note.originalMidi)}
          stroke="#5eb0ef"
          strokeWidth={1}
          dash={[4, 3]}
          opacity={0.4}
          listening={false}
          sceneFunc={(ctx, shape) => {
            traceEnvelope(ctx, envelope)
            ctx.strokeShape(shape)
          }}
        />
      )}
      <Group
        x={x}
        y={midiToY(note.midi)}
        draggable
        onDragMove={(e) => {
          e.target.x(x)
          e.target.y(midiToY(yToMidi(e.target.y())))
        }}
        onDragEnd={(e) => onMidiChange(note.id, yToMidi(e.target.y()))}
        onMouseEnter={(e) => setCursor(e, 'ns-resize')}
        onMouseLeave={(e) => setCursor(e, 'default')}
      >
        <Shape
          fill={shift === 0 ? 'rgba(94, 176, 239, 0.55)' : 'rgba(240, 163, 94, 0.6)'}
          stroke={shift === 0 ? '#8fcaf5' : '#f5c58f'}
          strokeWidth={1}
          sceneFunc={(ctx, shape) => {
            traceEnvelope(ctx, envelope)
            ctx.fillStrokeShape(shape)
          }}
          hitFunc={(ctx, shape) => {
            ctx.beginPath()
            ctx.rect(0, MID - BLOB_HALF_HEIGHT, width, BLOB_HALF_HEIGHT * 2)
            ctx.closePath()
            ctx.fillStrokeShape(shape)
          }}
        />
        <Line points={[0, MID, width, MID]} stroke="#ffffff" strokeWidth={1} opacity={0.5} listening={false} />
        {width > 36 && (
          <Text text={label} x={2} y={MID - BLOB_HALF_HEIGHT - 12} fontSize={10} fill="#e6e8eb" listening={false} />
        )}
      </Group>
    </>
  )
})
