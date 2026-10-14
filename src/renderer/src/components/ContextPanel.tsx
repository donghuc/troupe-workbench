import { useEffect, useState } from 'react'
import type { Project, ProviderInfo } from '../../../shared/types'
import { api } from '../api'
import Icon from './Icon'
import ResizeHandle from './ResizeHandle'
import ContextCheckModal from './ContextCheckModal'
import type { Outcome } from '../../../shared/decisions'
import { Button } from './ui/Button'

interface Props {
  project: Project
  providers: ProviderInfo[]
  onEditInstructions: () => void
  onConnectFolder: () => void
  onAddFolder: () => void
  onRemoveFolder: (path: string) => void
  onBrowseFiles: () => void
  onOpenProviders: () => void
  onManageContext: () => void
  onEditMemory: () => void
}

export default function ContextPanel({
  project, providers, onEditInstructions, onConnectFolder, onAddFolder, onRemoveFolder,
  onBrowseFiles, onOpenProviders, onManageContext, onEditMemory
}: Props) {
  const instrMeta = project.instructions.trim()
    ? `${project.instructions.trim().length} chars`
    : 'Not set'
  // Memory lives in the folder's CLAUDE.md for folder projects (D-028); read its real
  // length rather than the (usually empty) DB field.
  const [memChars, setMemChars] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const set = (n: number) => { if (alive) setMemChars(n) }
    if (project.folderPath) api.projectMemory.read(project.folderPath).then((v: string | null) => set((v ?? '').trim().length)).catch(() => set(project.memory.trim().length))
    else set(project.memory.trim().length)
    return () => { alive = false }
  }, [project.id, project.folderPath, project.memory])
  // Decisions log (D-081/D-082): the brief agents start from = memory facts + this index.
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let alive = true
    api.outcomes.list(project.id).then((l: Outcome[]) => { if (alive) setOutcomes(l) }).catch(() => {})
    return () => { alive = false }
  }, [project.id, project.folderPath])
  const memMeta = memChars === null ? '…' : memChars > 0 ? `${memChars.toLocaleString()} chars${memChars > 30000 ? ' · near Codex cap' : ''}` : 'Not set'
  return (
    <aside className="context-panel">
      <ResizeHandle varName="--context-panel-w" edge="left" min={240} max={1200} />
      <button className="context-card" onClick={onEditInstructions}>
        <span className="card-title">Instructions</span>
        <span className="card-meta truncate">{instrMeta}</span>
      </button>
      <button className="context-card" onClick={onEditMemory}>
        <span className="card-title">Memory</span>
        <span className="card-meta truncate">{memMeta}</span>
      </button>
      <button className="context-card" onClick={onManageContext}>
        <span className="card-title">Context</span>
        <span className="card-meta truncate">Reference files</span>
      </button>
      <div className="context-card context-decisions">
        <span className="card-title">Decisions</span>
        <span className="card-meta">{outcomes.length ? `${outcomes.length} · latest: ${outcomes[0].title}` : 'None yet · Save outcome on a reply'}</span>
        {outcomes.length > 0 && (
          <div className="context-folder-actions">
            <Button variant="link" onClick={() => setChecking(true)} title="Ask a fresh chat what this project has decided, and see what it gets wrong">Check context</Button>
          </div>
        )}
      </div>
      {checking && <ContextCheckModal projectId={project.id} onClose={() => setChecking(false)} />}

      <div className="context-card context-folder">
        <div className="context-folder-head">
          <span className="card-title">Folder</span>
          {project.folderPath && (
            <button className="folder-browse-icon" title="Browse files" onClick={onBrowseFiles}><Icon name="folder-open" size="md" /></button>
          )}
        </div>
        <span className="card-meta truncate">{project.folderPath ?? 'No folder connected'}</span>
        <div className="context-folder-actions">
          <Button variant="link" onClick={onConnectFolder}>{project.folderPath ? 'Change' : 'Connect a folder'}</Button>
        </div>

        {/* Additional folders (D-054): places the agent may read AND edit, not second
            roots — memory, skills and the file browser stay with the primary folder.
            This amends D-002, so the panel says the write part out loud. */}
        {project.folderPath && (
          <div className="extra-folders">
            <span className="extra-folders-label">Additional folders</span>
            {project.extraFolders.length === 0 && (
              <span className="card-meta">None</span>
            )}
            {project.extraFolders.map((f) => (
              <div key={f} className="extra-folder-row">
                <span className="truncate extra-folder-path" title={f}>{f}</span>
                <button
                  className="extra-folder-remove"
                  title={`Remove ${f}`}
                  aria-label={`Remove ${f}`}
                  onClick={() => onRemoveFolder(f)}
                >✕</button>
              </div>
            ))}
            <div className="context-folder-actions">
              <Button variant="link" title="Folders the agent may also read and edit. Memory, skills and the file browser stay with the main folder." onClick={onAddFolder}>Add a folder</Button>
            </div>
            {project.extraFolders.length > 0 && (
              <span className="card-meta extra-folders-note">Read and edit access. Memory and skills stay with the main folder.</span>
            )}
          </div>
        )}
      </div>

      <button className="context-card" onClick={onOpenProviders}>
        <span className="card-title">Providers</span>
        <span className="card-meta truncate">{providers.map((p) => p.name).join(' · ')}</span>
      </button>
    </aside>
  )
}
