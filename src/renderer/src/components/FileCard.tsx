// A file shown as a card in the conversation (D-066): files an agent linked or wrote in
// a reply, and files attached to your message. Click opens the artifact viewer; the
// icons pop it out or show it in Finder.
import Icon from './Icon'
import { OS_WORDS } from '../../../shared/platform'
import { api } from '../api'
import { fileCardMeta } from '../../../shared/fileCards'
import { FILE_THUMBS } from '../fileThumbs'
import { IconButton } from './ui/Button'

export default function FileCard({ root, rel, name, onOpen }: { root?: string; rel: string; name?: string; onOpen?: (rel: string) => void }) {
  const meta = fileCardMeta(name ?? rel)
  const canOpen = !!root && !!onOpen
  return (
    <div className={`file-card${canOpen ? '' : ' disabled'}`} title={rel}>
      <button className="file-card-main" onClick={() => canOpen && onOpen!(rel)} disabled={!canOpen}>
        {meta.thumb
          ? <img className="file-card-thumb" src={FILE_THUMBS[meta.thumb]} alt="" aria-hidden="true" draggable={false} />
          : <span className="file-card-icon"><Icon name={meta.icon} size="md" /></span>}
        <span className="file-card-text">
          <span className="file-card-title">{meta.title}</span>
          <span className="file-card-sub">{meta.subtitle}</span>
        </span>
      </button>
      {root && (
        <span className="file-card-actions">
          <IconButton title="Open in new window" onClick={() => { void api.system.openArtifactWindow(root, rel) }}><Icon name="popout" size="sm" /></IconButton>
          <IconButton title={OS_WORDS.showInFolder} onClick={() => { void api.system.revealItem(root, rel) }}><Icon name="folder-open" size="md" /></IconButton>
        </span>
      )}
    </div>
  )
}
