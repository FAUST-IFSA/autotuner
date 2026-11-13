import type { ReactNode } from 'react'
import { useDropzone } from 'react-dropzone'

// Fits 10 minutes of 96 kHz / 24-bit stereo WAV (346 MB). Memory follows duration, not file size, so the
// 10-minute limit in loadAudioFile is the real guard; this only stops a huge file being read in at all.
const MAX_FILE_BYTES = 400 * 1024 * 1024

interface Props {
  /** Shown instead of the prompt while a file is read or opened (null when idle); disables the dropzone. */
  busyStatus: ReactNode
  onFile: (file: File) => void
  onRejected: (message: string) => void
}

/** The drop area for one audio file, shared by the vocal and backing track uploads. */
export function AudioDropzone({ busyStatus, onFile, onRejected }: Props) {
  const busy = busyStatus != null
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted: ([file]) => onFile(file),
    onDropRejected: () => onRejected(`Please drop a single audio file under ${MAX_FILE_BYTES / 1024 / 1024} MB.`),
    accept: { 'audio/*': [] },
    maxFiles: 1,
    maxSize: MAX_FILE_BYTES,
    disabled: busy,
  })

  return (
    <div {...getRootProps({ className: `dropzone${isDragActive ? ' active' : ''}${busy ? ' busy' : ''}` })}>
      <input {...getInputProps()} />
      {busy ? (
        busyStatus
      ) : (
        <>
          <p className="dropzone-title">{isDragActive ? 'Drop it here' : 'Drag an audio file here'}</p>
          <p className="dropzone-hint">or click to browse · WAV, MP3, OGG, FLAC</p>
        </>
      )}
    </div>
  )
}
