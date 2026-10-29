import { useEffect, useRef, useState } from 'react'

/** Every editor shortcut and mouse action, grouped for the Controls dropdown. */
const CONTROLS: { group: string; items: [keys: string[], action: string][] }[] = [
  {
    group: 'Playback',
    items: [
      [['Space'], 'Play / pause'],
      [['Enter'], 'Back to the start'],
      [['< / >'], 'Previous / next note'],
      [['Click the time ruler'], 'Move the playhead'],
    ],
  },
  {
    group: 'Notes',
    items: [
      [['Click and hold a note'], 'Play it on a loop'],
      [['Drag a note'], 'Change its pitch'],
      [['Alt', 'drag'], 'Fine steps (1 cent)'],
      [['↑ / ↓'], 'Move selected notes a semitone'],
      [['Alt', '↑ / ↓'], 'Move by 10 cents'],
      [['Backspace'], 'Reset selected notes'],
    ],
  },
  {
    group: 'Selecting',
    items: [
      [['← / →'], 'Select previous / next note'],
      [['Drag empty space'], 'Select a group of notes'],
      [['Shift', 'click'], 'Add or remove a note'],
      [['⌘/Ctrl', 'A'], 'Select all'],
      [['Esc'], 'Clear selection'],
    ],
  },
  {
    group: 'Editing and view',
    items: [
      [['⌘/Ctrl', 'Z'], 'Undo'],
      [['⌘/Ctrl', 'Shift', 'Z'], 'Redo'],
      [['⌘/Ctrl', '← / →'], 'Zoom out / in'],
      [['⌘/Ctrl', 'scroll'], 'Zoom'],
      [['Scroll'], 'Move around'],
      [['Shift', 'scroll'], 'Move sideways'],
    ],
  },
]

/** A "Controls" button that opens the list of shortcuts. */
export function ControlsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape (Escape doesn't also clear the note selection).
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="controls-menu" ref={ref}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Controls ▾
      </button>
      {open && (
        <div className="controls-panel" role="dialog" aria-label="Keyboard and mouse controls">
          {CONTROLS.map(({ group, items }) => (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {items.map(([keys, action]) => (
                  <div key={action} className="control-row">
                    <dt>
                      {keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="plus">+</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
