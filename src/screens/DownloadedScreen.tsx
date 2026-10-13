interface Props {
  fileName: string
  onBack: () => void
  onNewVocal: () => void
}

export function DownloadedScreen({ fileName, onBack, onNewVocal }: Props) {
  return (
    <main className="downloaded-screen">
      <h1>Saved to your downloads</h1>
      <p className="saved-file">{fileName}</p>
      <div className="downloaded-actions">
        <button type="button" className="primary" onClick={onBack} autoFocus>
          Back to editor
        </button>
        <button type="button" onClick={onNewVocal}>
          Tune another vocal
        </button>
      </div>
    </main>
  )
}
