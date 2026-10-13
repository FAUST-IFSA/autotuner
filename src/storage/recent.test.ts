import { describe, expect, it } from 'vitest'
import { type RecentSummary, updateIndex } from './recent'

const entry = (id: string, lastOpened: number): RecentSummary => ({
  id,
  fileName: `${id}.mp3`,
  durationSec: 10,
  noteCount: 5,
  editedCount: 0,
  lastOpened,
})

describe('updateIndex', () => {
  it('puts the newest first and replaces an existing entry', () => {
    const { index } = updateIndex([entry('a', 1), entry('b', 2)], entry('a', 3))
    expect(index.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('keeps at most 10 and reports the ones that fell off', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`p${i}`, i))
    const { index, dropped } = updateIndex(many, entry('new', 100))
    expect(index).toHaveLength(10)
    expect(index[0].id).toBe('new')
    expect(dropped).toEqual(['p0'])
  })
})
