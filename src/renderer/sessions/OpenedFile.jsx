import { useEffect, useEffectEvent, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { closeFind } from '../ui/useFindActive.js'
import './OpenedFile.css'

// A transcript from anywhere on disk (File → Open, a drop), read whole and shown outside the timeline.
// `opened` is { filePath, meta | error }; set it to null to close the file.
export function useOpenedFile() {
  const [opened, setOpened] = useState(null)

  const open = useEffectEvent(filePath => {
    closeFind()
    setOpened({ filePath })
    const settle = result => setOpened(o => o?.filePath === filePath ? { filePath, ...result } : o) // a later open wins
    window.api.openSessionFile(filePath).then(meta => settle({ meta }), error => settle({ error }))
  })

  useEffect(() => {
    const isFileDrag = e => e.dataTransfer.types.includes('Files') // leave text drags into inputs alone
    const onDragOver = e => { if (isFileDrag(e)) e.preventDefault() }
    const onDrop = e => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) open(window.api.pathForFile(file))
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    const off = window.api.onOpenSessionFile(filePath => open(filePath))
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      off()
    }
  }, [])

  return [opened, setOpened]
}

export function OpenedFileHeader({ filePath, onClose }) {
  return (
    <header className="section-title opened-file">
      <FileText size={18} className="opened-file-icon" />
      <h2 className="section-title-text">Opened file</h2>
      <span className="opened-file-path" data-tooltip-content={filePath}><bdi>{filePath}</bdi></span>
      <button type="button" className="opened-file-close" onClick={onClose} aria-label="Close file" data-tooltip-content="Close file">
        <X size={16} />
      </button>
    </header>
  )
}
