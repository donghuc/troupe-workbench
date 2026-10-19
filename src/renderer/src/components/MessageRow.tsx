import { memo } from 'react'
import type { Message } from '../../../shared/types'
import { selectionsFromMeta } from '../../../shared/selections'
import ProviderAvatar from './ProviderAvatar'
import SelectionCard from './SelectionCard'
import FileCard from './FileCard'
import MessageMarkdown from './MessageMarkdown'
import Icon from './Icon'
import { ARTIFACT_EXT, IMG_RE, wbfileSrc, usageMain, usageBreakdown, actionsOf, attachmentsMeta, userDisplayText } from '../chatFiles'
import { Menu, MenuItem } from './ui/Menu'

/** What a message row can ask its chat to do. One stable object per chat (D-098). */
export interface RowActions {
  openArtifact: (rel: string) => void
  openMedia: (rel: string) => void
  toggleMenu: (id: string) => void
  closeMenu: () => void
  regenerate: (m: Message, idx: number) => void
  editUser: (m: Message) => void
  branchFrom: (id: string) => void
  saveToProject: (content: string) => void
  saveSkill: (content: string) => void
  saveOutcome: (id: string) => void
  addToMemory: (content: string) => void
  secondOpinion: (m: Message) => void
}

interface Props {
  m: Message
  idx: number
  name: string                 // the author's display name
  cwd?: string
  files: string[]              // file cards under a reply (chatFiles.replyFiles)
  menuOpen: boolean
  isStreaming: boolean
  otherName?: string           // the agent a "Second opinion" would go to
  actions: RowActions
}

// One saved message. Memoized: while an agent streams, the chat re-renders every frame
// but rows whose props did not change are skipped (D-098).
function MessageRow({ m, idx, name, cwd, files, menuOpen, isStreaming, otherName, actions }: Props) {
  const openArtifact = cwd ? actions.openArtifact : undefined
  const openMedia = cwd ? actions.openMedia : undefined
  return (
    <div className={`msg msg-${m.role}`} data-quote-label={m.role === 'user' ? 'your earlier message' : `${name}'s reply`}>
      <div className="msg-author">
        {m.role === 'user'
          ? <span>You</span>
          : <><ProviderAvatar id={m.provider} /><span>{name}</span></>}
      </div>
      {m.role === 'user' && selectionsFromMeta(m.metadata).length > 0 && (
        <div className="msg-selections">
          {selectionsFromMeta(m.metadata).map((s) => <SelectionCard key={s.id} sel={s} onOpen={openArtifact} />)}
        </div>
      )}
      <div className="msg-body markdown-body">
        {m.role === 'assistant'
          ? <MessageMarkdown onOpenArtifact={openArtifact} onOpenMedia={openMedia} root={cwd}>{m.content}</MessageMarkdown>
          : <><span className="msg-user-text">{userDisplayText(m)}</span>{typeof m.metadata?.modeCast === 'string' && <span className="msg-mode-cast"><Icon name="flash" size="xs" /> {m.metadata.modeCast as string}</span>}{m.metadata?.via === 'cli' && <span className="msg-mode-cast">Sent from the command line</span>}</>}
      </div>
      {m.role === 'assistant' && files.length > 0 && (
        <div className="msg-artifacts">
          {files.map((rel) => (
            cwd && IMG_RE.test(rel)
              ? <span key={rel} className="media-item">
                  <button className="msg-thumb-btn" onClick={() => openMedia?.(rel)} title={`View ${rel}`}><img className="msg-thumb" src={wbfileSrc(cwd, rel)} alt={rel.split('/').pop()} loading="lazy" /></button>
                  <button className="media-open-btn" onClick={() => openArtifact?.(rel)} title={`Open ${rel} in the artifact viewer`}><Icon name="popout" size="xs" /> Open as artifact</button>
                </span>
              : <FileCard key={rel} root={cwd} rel={rel} onOpen={openArtifact} />
          ))}
        </div>
      )}
      {m.role === 'user' && attachmentsMeta(m.metadata).length > 0 && (
        <div className="msg-attachments">
          {attachmentsMeta(m.metadata).map((a, i) => (
            a.image && a.viewable && a.path && cwd
              ? <span key={i} className="media-item">
                  <button className="msg-thumb-btn" onClick={() => openMedia?.(a.path!)} title={`View ${a.name}`}><img className="msg-thumb" src={wbfileSrc(cwd, a.path!)} alt={a.name} loading="lazy" /></button>
                  <button className="media-open-btn" onClick={() => openArtifact?.(a.path!)} title={`Open ${a.name} in the artifact viewer`}><Icon name="popout" size="xs" /> Open as artifact</button>
                </span>
              : a.viewable && a.path && cwd && ARTIFACT_EXT.test(a.path)
                ? <FileCard key={i} root={cwd} rel={a.path!} name={a.name} onOpen={openArtifact} />
                : <span key={i} className="attach-chip"><Icon name={a.image ? 'image' : 'file'} size="xs" /> {a.name}</span>
          ))}
        </div>
      )}
      {m.role === 'assistant' && actionsOf(m.metadata).length > 0 && (
        <details className="msg-actions">
          <summary>{actionsOf(m.metadata).length} action{actionsOf(m.metadata).length > 1 ? 's' : ''}</summary>
          <ul>
            {actionsOf(m.metadata).map((a, i) => (
              <li key={i}><Icon name={a.kind === 'file' ? 'file' : 'settings'} size="sm" className="act-ico" /> {a.label}{a.detail ? <span className="act-detail"> · {a.detail}</span> : null}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="msg-tokens" title={usageBreakdown(m) ?? undefined}>{usageMain(m)}
        <span className="msg-menu-wrap">
          <button className="msg-more" title="More" onClick={() => actions.toggleMenu(m.id)}><Icon name="settings" size="md" /></button>
          <Menu open={menuOpen} onClose={actions.closeMenu} className="conv-menu msg-menu">
              <MenuItem onClick={() => { navigator.clipboard?.writeText(m.content); actions.closeMenu() }}>Copy</MenuItem>
              {m.role === 'assistant' && <MenuItem onClick={() => actions.regenerate(m, idx)}>Regenerate</MenuItem>}
              {m.role === 'user' && <MenuItem onClick={() => actions.editUser(m)} disabled={isStreaming}>Edit</MenuItem>}
              <MenuItem onClick={() => actions.branchFrom(m.id)}>Branch from here</MenuItem>
              {m.role === 'assistant' && cwd && <MenuItem onClick={() => { actions.saveToProject(m.content); actions.closeMenu() }}>Save to project</MenuItem>}
              {m.role === 'assistant' && <MenuItem onClick={() => { actions.saveSkill(m.content); actions.closeMenu() }}>Save as skill</MenuItem>}
              {m.role === 'assistant' && <MenuItem onClick={() => { actions.saveOutcome(m.id); actions.closeMenu() }}>Save outcome</MenuItem>}
              {m.role === 'assistant' && <MenuItem onClick={() => { actions.addToMemory(m.content); actions.closeMenu() }} title="Facts that stay true go to memory; decisions go to the log via Save outcome">Add fact to Memory</MenuItem>}
              {m.role === 'assistant' && otherName && <MenuItem onClick={() => actions.secondOpinion(m)}>Second opinion ({otherName})</MenuItem>}
          </Menu>
        </span>
      </div>
    </div>
  )
}

export default memo(MessageRow)
