import type { Project, ProviderInfo, ProjectPatch, ProviderId, Conversation } from '../../../shared/types'
import type { PermissionMode } from '../../../shared/agent'
import type { SelectionItem } from '../../../shared/selections'
import Composer from './Composer'
import type { PendingAttachment } from '../attachments'
import ContextPanel from './ContextPanel'
import InlineEdit from './InlineEdit'

interface Props {
  project: Project
  providers: ProviderInfo[]
  conversations: Conversation[]
  onSelectConversation: (id: string) => void
  onPatch: (patch: ProjectPatch) => void
  onEditInstructions: () => void
  onConnectFolder: () => void
  onAddFolder: () => void
  onRemoveFolder: (path: string) => void
  onBrowseFiles: () => void
  onStartConversation: (text: string, provider: ProviderId, attachments: PendingAttachment[], skillId?: string, model?: string, permMode?: PermissionMode, selections?: SelectionItem[]) => void
  onStartCollab?: (goal: string, provider: ProviderId, permMode: PermissionMode, model?: string) => void
  onOpenProviders: () => void
  onManageContext: () => void
  onEditMemory: () => void
}

const fmtWhen = (ts: number) => {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ProjectHome({
  project, providers, conversations, onSelectConversation, onPatch, onEditInstructions,
  onConnectFolder, onAddFolder, onRemoveFolder, onBrowseFiles, onStartConversation,
  onStartCollab, onOpenProviders, onManageContext, onEditMemory
}: Props) {
  const pinned = conversations.filter((c) => c.pinned)
  const rest = conversations.filter((c) => !c.pinned)
  const ordered = [...pinned, ...rest]

  return (
    <div className="main-body main-body-panel">
      <section className="project-home">
        <div className="project-home-inner">
          <h1 className="project-title">
            <InlineEdit value={project.name} as="title" onCommit={(v) => onPatch({ name: v })} />
          </h1>
          <p className="project-desc">
            <InlineEdit
              value={project.description}
              as="desc"
              placeholder="Add a description"
              onCommit={(v) => onPatch({ description: v })}
            />
          </p>
          <Composer providers={providers} onSend={onStartConversation} onStartCollab={onStartCollab} collabAvailable={!!project.folderPath} folderPath={project.folderPath ?? undefined} autoFocus />

          {ordered.length > 0 && (
            <div className="home-chats">
              <div className="home-chats-label">Chats in this project</div>
              {ordered.map((c) => (
                <button key={c.id} className="home-chat-row" onClick={() => onSelectConversation(c.id)} title={c.title}>
                  <span className="truncate home-chat-title">{c.pinned && <span className="pin-dot">📌 </span>}{c.title}</span>
                  <span className="home-chat-when">{fmtWhen(c.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      <ContextPanel
        project={project}
        providers={providers}
        onEditInstructions={onEditInstructions}
        onConnectFolder={onConnectFolder}
        onAddFolder={onAddFolder}
        onRemoveFolder={onRemoveFolder}
        onBrowseFiles={onBrowseFiles}
        onOpenProviders={onOpenProviders}
        onManageContext={onManageContext}
        onEditMemory={onEditMemory}
      />
    </div>
  )
}
