import { useEffect, useState } from 'react'
import { OS_WORDS, isAbsPath, relUnder } from '../../../shared/platform'
import { api } from '../api'
import { kindOf } from '../fileKinds'
import Icon from './Icon'
import FilePreview, { normalizePath } from './FilePreview'
import { IconButton } from './ui/Button'
import { copyImageFile } from '../copyImage'
import { notify } from '../notices'
import { wbfileSrc } from '../chatFiles'

interface Props { root: string; relPath: string; onClose: () => void; popout?: boolean }

export default function ArtifactViewer({ root, relPath, onClose, popout }: Props) {
  const [current, setCurrent] = useState(relPath)
  const [text, setText] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => { setCurrent(relPath) }, [relPath])

  const kind = kindOf(current)
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* ignore */ } }
  const copyImage = async () => { if (await copyImageFile(root, current, wbfileSrc(root, current))) { setCopied(true); setTimeout(() => setCopied(false), 1200) } else notify('Couldn’t copy this image.') }

  const openLink = (href: string) => {
    let h = href
    const under = relUnder(h, root)
    if (under !== null) h = under
    else if (!isAbsPath(h)) {
      const dir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''
      h = normalizePath(dir ? `${dir}/${h}` : h)
    }
    setCurrent(h)
  }

  return (
    <div className="artifact-viewer" data-surface="paper" data-artifact-path={current}>
      <div className="artifact-head">
        <span className="artifact-title truncate" title={current}>{current.split('/').pop()}</span>
        <div className="artifact-actions">
          {popout && (
            <IconButton onClick={() => api.system.openArtifactWindow(root, current)} title="Open in new window"><Icon name="popout" size="md" /></IconButton>
          )}
          <IconButton onClick={() => api.system.revealItem(root, current)} title={OS_WORDS.showInFolder}><Icon name="folder-open" size="md" /></IconButton>
          {(kind === 'pdf' || kind === 'video' || kind === 'audio') && (
            <IconButton onClick={() => api.system.openItem(root, current)} title={kind === 'pdf' ? 'Open in Preview' : 'Open in default app'}><Icon name="external" size="md" /></IconButton>
          )}
          {kind !== 'image' && text && (
            <IconButton onClick={copy} title={copied ? 'Copied' : 'Copy'}><Icon name={copied ? 'check' : 'copy'} size="md" /></IconButton>
          )}
          {kind === 'image' && (
            <IconButton onClick={copyImage} title={copied ? 'Copied' : 'Copy image'}><Icon name={copied ? 'check' : 'copy'} size="md" /></IconButton>
          )}
          <IconButton onClick={onClose} title="Close"><Icon name="close" size="md" /></IconButton>
        </div>
      </div>
      <div className="artifact-body">
        <FilePreview root={root} relPath={current} onOpenLink={openLink} onText={setText} />
      </div>
    </div>
  )
}
