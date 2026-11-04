import type { BackingTrack } from '../types'

export type BackingSettingsUpdate = Partial<Pick<BackingTrack, 'volume' | 'muted'>>

interface Props {
  backing: BackingTrack
  onChange: (update: BackingSettingsUpdate) => void
  onRemove: () => void
}

/** The backing track's controls, above its lane in the pitch editor. */
export function BackingBar({ backing, onChange, onRemove }: Props) {
  return (
    <div className="backing-bar">
      <span className="backing-label">Backing track</span>
      <span className="backing-name" title={backing.fileName}>
        {backing.fileName}
      </span>
      <button type="button" aria-pressed={backing.muted} onClick={() => onChange({ muted: !backing.muted })}>
        {backing.muted ? 'Unmute' : 'Mute'}
      </button>
      <label className="volume">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={backing.volume}
          onChange={(e) => onChange({ volume: Number(e.target.value), muted: false })}
          // Hand the keyboard back to the editor (Space, arrows) after a mouse adjustment.
          onPointerUp={(e) => e.currentTarget.blur()}
        />
      </label>
      <button type="button" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}
