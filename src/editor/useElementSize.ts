import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** The element's content size in whole pixels, kept current with a ResizeObserver (0 x 0 until measured). */
export function useElementSize(ref: RefObject<Element | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [ref])

  return size
}
