import { useEffect, useState } from 'react'
import Icon from './Icon'
import { copyImageFile } from '../copyImage'
import { notify } from '../notices'

interface Props { src: string; alt?: string; root?: string; relPath?: string; onClose: () => void }

// A minimal single-image lightbox: fullscreen overlay, click backdrop / Esc / ✕ to close.
// Distinct from the artifact viewer (side panel) — this is just for looking at an image.
export default function MediaViewer({ src, alt, root, relPath, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(relPath || src)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const copy = async () => {
    if (!root || !relPath) return
    if (await copyImageFile(root, relPath, src)) { setCopied(true); setTimeout(() => setCopied(false), 1200) }
    else notify('Couldn’t copy this image.')
  }
  return (
    <div className="media-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="media-viewer-actions" onClick={(e) => e.stopPropagation()}>
        {root && relPath && !isVideo && (
          <button className="media-viewer-btn" title={copied ? 'Copied' : 'Copy image'} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size="nav" /></button>
        )}
        <button className="media-viewer-btn" title="Close (Esc)" onClick={onClose}><Icon name="close" size="lg" /></button>
      </div>
      {isVideo
        ? <video className="media-viewer-img" src={src} controls autoPlay onClick={(e) => e.stopPropagation()} />
        : <img className="media-viewer-img" src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} />}
    </div>
  )
}
