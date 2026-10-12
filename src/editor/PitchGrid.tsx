import { Shape } from 'react-konva'
import { KEYBOARD_WIDTH, MIDI_MAX, MIDI_MIN, ROW_HEIGHT, isBlackKey, midiName, midiToY, timeStep } from './layout'

interface GridProps {
  duration: number
  pxPerSec: number
  scrollX: number
  scrollY: number
  width: number
  height: number
}

export function PitchGrid({ duration, pxPerSec, scrollX, scrollY, width, height }: GridProps) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        for (let midi = MIDI_MAX; midi >= MIDI_MIN; midi--) {
          const y = midiToY(midi) - scrollY
          if (y + ROW_HEIGHT < 0 || y > height) continue
          ctx.setAttr('fillStyle', isBlackKey(midi) ? '#181a20' : '#1d2027')
          ctx.fillRect(0, y, width, ROW_HEIGHT)
          ctx.setAttr('fillStyle', midi % 12 === 0 ? '#3a3f4b' : '#252830')
          ctx.fillRect(0, y + ROW_HEIGHT - 1, width, 1)
        }

        const step = timeStep(pxPerSec)
        ctx.setAttr('fillStyle', '#2a2e37')
        for (let t = Math.floor(scrollX / pxPerSec / step) * step; t <= duration; t += step) {
          const x = t * pxPerSec - scrollX
          if (x > width) break
          ctx.fillRect(x, 0, 1, height)
        }
      }}
    />
  )
}

interface KeyboardProps {
  scrollY: number
  height: number
}

export function Keyboard({ scrollY, height }: KeyboardProps) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.setAttr('font', '10px system-ui, sans-serif')
        ctx.setAttr('textBaseline', 'middle')
        for (let midi = MIDI_MAX; midi >= MIDI_MIN; midi--) {
          const y = midiToY(midi) - scrollY
          if (y + ROW_HEIGHT < 0 || y > height) continue
          const black = isBlackKey(midi)
          ctx.setAttr('fillStyle', black ? '#22252c' : '#d7dbe0')
          ctx.fillRect(0, y, KEYBOARD_WIDTH, ROW_HEIGHT)
          ctx.setAttr('fillStyle', '#0f1115')
          ctx.fillRect(0, y + ROW_HEIGHT - 1, KEYBOARD_WIDTH, 1)
          ctx.setAttr('fillStyle', black ? '#9aa1ab' : '#2a2e37')
          ctx.fillText(midiName(midi), 6, y + ROW_HEIGHT / 2)
        }
      }}
    />
  )
}
