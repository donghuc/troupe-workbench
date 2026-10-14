import { useEffect, useState } from 'react'
import Icon from '../Icon'
import { api } from '../../api'
import { failed, notify } from '../../notices'
import { fileUrl, IMAGE_REF_TYPE } from './geometry'
import { SAVED_DIR, isImagePath } from '../../../../shared/imageCanvas'
import type { FileNode } from '../../../../shared/types'
import { IconButton } from '../ui/Button'

// Right-hand panel listing the images in saved/ (D-088, Hien 2026-10-05), newest first.
// `version` bumps whenever something is saved or unsaved, so the list follows.
interface Props { root: string; version: number; onOpen: (rel: string) => void; onClose: () => void }

export default function SavedPanel({ root, version, onOpen, onClose }: Props) {
  const [files, setFiles] = useState<FileNode[] | null>(null)
  useEffect(() => {
    let live = true
    api.files.listTree(root, SAVED_DIR)
      .then((t: FileNode) => { if (live) setFiles((t.children ?? []).filter((n) => n.type === 'file' && isImagePath(n.name)).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))) })
      .catch(() => { if (live) setFiles([]) })
    return () => { live = false }
  }, [root, version])

  return (
    <aside className="img-saved-panel">
      <div className="img-saved-head">
        <span className="img-saved-title">Saved</span>
        {files && files.length > 0 && <span className="img-meta">{files.length}</span>}
        <span className="md-head-spacer" />
        <IconButton title="Show the saved folder in Finder" onClick={() => api.system.revealItem(root, SAVED_DIR).catch(failed('Show in Finder'))}><Icon name="folder-open" size="md" /></IconButton>
        <IconButton title="Close" onClick={onClose}><Icon name="close" size="md" /></IconButton>
      </div>
      <div className="img-saved-body">
        {files === null && <div className="img-saved-empty">Loading…</div>}
        {files && !files.length && <div className="img-saved-empty">Nothing saved yet. Hover an image in an Output card and press <Icon name="download" size="xs" /> to keep it here.</div>}
        {files && files.length > 0 && (
          <div className="img-saved-grid">
            {files.map((f) => (
              <figure key={f.relPath} className="img-saved-item" title={f.name}>
                <img src={fileUrl(root, f.relPath)} alt="" onClick={() => onOpen(f.relPath)} draggable
                  title="Click to view · drag onto a Media card (or the canvas) to use as a reference"
                  onDragStart={(e) => { e.dataTransfer.setData(IMAGE_REF_TYPE, f.relPath); e.dataTransfer.effectAllowed = 'copy' }} />
                <div className="img-shot-actions">
                  {!/\.svg$/i.test(f.name) && <button title="Copy image" onClick={() => api.system.copyImage(root, f.relPath).then((ok: boolean) => ok && notify('Image copied')).catch(failed('Copy image'))}><Icon name="copy" size="sm" /></button>}
                  <button title="Open in its own window" onClick={() => api.system.openArtifactWindow(root, f.relPath).catch(failed('Open window'))}><Icon name="popout" size="sm" /></button>
                  <button title="Show in Finder" onClick={() => api.system.revealItem(root, f.relPath).catch(failed('Show in Finder'))}><Icon name="folder-open" size="sm" /></button>
                </div>
                <figcaption className="truncate">{f.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
