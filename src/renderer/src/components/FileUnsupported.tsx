import { api } from '../api'
import { OS_WORDS } from '../../../shared/platform'
import { extOf } from '../fileKinds'
import Icon from './Icon'
import { Button } from './ui/Button'

// Shown instead of a preview for files the app can't display (Office docs, archives,
// audio, binaries, very large text). Offers Finder and the default app.
export default function FileUnsupported({ root, relPath, reason = 'type' }: { root: string; relPath: string; reason?: 'type' | 'binary' | 'too-large' }) {
  const ext = extOf(relPath).toUpperCase()
  const name = relPath.split('/').pop() ?? relPath
  const why = reason === 'too-large'
    ? 'This file is too large to preview here.'
    : ext ? `${ext} files can't be previewed here.` : "This file can't be previewed here."
  return (
    <div className="file-unsupported">
      <Icon name="file" size="xl" className="file-unsupported-ico" />
      <div className="file-unsupported-name truncate" title={relPath}>{name}</div>
      <p className="file-unsupported-why">{why}</p>
      <div className="file-unsupported-actions">
        <Button variant="primary" size="sm" onClick={() => api.system.revealItem(root, relPath)}>{OS_WORDS.showInFolder}</Button>
        <Button size="sm" onClick={() => api.system.openItem(root, relPath)}>Open in default app</Button>
      </div>
    </div>
  )
}
