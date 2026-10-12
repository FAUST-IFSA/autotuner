import { Shape } from 'react-konva'
import { RULER_HEIGHT, timeStep } from './layout'

interface Props {
  duration: number
  pxPerSec: number
  scrollX: number
  width: number
}

export function TimeRuler({ duration, pxPerSec, scrollX, width }: Props) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.setAttr('fillStyle', '#15171c')
        ctx.fillRect(0, 0, width, RULER_HEIGHT)

        const step = timeStep(pxPerSec)
        ctx.setAttr('font', '10px system-ui, sans-serif')
        ctx.setAttr('textBaseline', 'middle')
        for (let t = Math.floor(scrollX / pxPerSec / step) * step; t <= duration; t += step) {
          const x = t * pxPerSec - scrollX
          if (x > width) break
          ctx.setAttr('fillStyle', '#3a3f4b')
          ctx.fillRect(x, RULER_HEIGHT - 8, 1, 8)
          ctx.setAttr('fillStyle', '#7d8590')
          ctx.fillText(`${+t.toFixed(2)}s`, x + 4, RULER_HEIGHT / 2 - 2)
        }

        ctx.setAttr('fillStyle', '#30343d')
        ctx.fillRect(0, RULER_HEIGHT - 1, width, 1)
      }}
    />
  )
}
