import { memo, useEffect, useState } from 'react'
import type { AgentTools, ProviderId } from '../../../shared/types'
import { MCP_OFF_SETTING, mcpOffKey, parseMcpOff, mcpDisplay } from '../../../shared/projectMcp'
import { CHROME_ACCESS_SETTING } from '../../../shared/providers'
import { openSettings, SETTINGS_SAVED_EVENT } from '../notices'
import { artifactIcon } from '../chatFiles'
import { api } from '../api'
import Icon from './Icon'

interface Props {
  conversationId: string
  cwd?: string
  composerProvider: ProviderId
  agentName: string
  artifacts: string[]
  workingFiles: string[]
  onOpen?: (rel: string) => void
  onBrowseFiles?: () => void
  /** The artifact viewer is showing in this column. Stays mounted so its state survives (D-098). */
  hidden: boolean
}

// The chat's right column when no artifact is open: recent artifacts, working files, and
// the tools the composer's agent has (read-only; on/off lives in Settings ▸ Tools, D-077).
function ChatSidePanel({ conversationId, cwd, composerProvider, agentName, artifacts, workingFiles, onOpen, onBrowseFiles, hidden }: Props) {
  const [showAllArtifacts, setShowAllArtifacts] = useState(false)
  const [showWorking, setShowWorking] = useState(false)
  const [tools, setTools] = useState<AgentTools | null>(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [showAllMcp, setShowAllMcp] = useState(false)
  const [showAllTools, setShowAllTools] = useState(false)
  // Active tools, read-only (D-077): on/off lives in Settings ▸ Tools and applies everywhere.
  const [mcpOff, setMcpOff] = useState<string[]>([])
  const [builtinAccess, setBuiltinAccess] = useState({ web: true, shell: true, chrome: false })
  const loadToolSettings = () => {
    api.settings.get(MCP_OFF_SETTING).then((v: string | null) => setMcpOff(parseMcpOff(v))).catch(() => {})
    Promise.all([api.settings.get('agent_web_access'), api.settings.get('agent_shell_access'), api.settings.get(CHROME_ACCESS_SETTING)])
      .then(([w, sh, ch]) => setBuiltinAccess({ web: w !== '0', shell: sh !== '0', chrome: ch === '1' })).catch(() => {})
  }
  const loadTools = () => {
    setToolsLoading(true)
    api.system.tools(composerProvider, cwd).then((t: AgentTools) => setTools(t))
      .catch(() => setTools(null)).finally(() => setToolsLoading(false))
  }
  useEffect(() => { setTools(null); loadTools(); loadToolSettings() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, composerProvider, cwd])
  useEffect(() => {
    const onSaved = () => { loadTools(); loadToolSettings() }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerProvider, cwd])
  const activeMcp = (tools?.mcp ?? []).filter((m) => !mcpOff.includes(mcpOffKey(composerProvider, m.name)))
  const offMcpCount = (tools?.mcp.length ?? 0) - activeMcp.length
  const activeBuiltin = [
    ...(tools?.builtin ?? []).filter((t) => (builtinAccess.web || !/^web/i.test(t)) && (builtinAccess.shell || !/^(bash|shell)$/i.test(t))),
    ...(builtinAccess.chrome && composerProvider === 'claude-code' ? ['Chrome'] : [])
  ]

  if (hidden) return null
  return (
    <div className="chat-side-inner">
      <div className="side-section-label side-section-row">
        <span>Recent artifacts</span>
        {cwd && onBrowseFiles && (
          <button className="folder-browse-icon" title="Browse files" aria-label="Browse files" onClick={onBrowseFiles}><Icon name="folder-open" size={16} /></button>
        )}
      </div>
      {artifacts.length === 0 && workingFiles.length === 0 && <div className="sidebar-empty">No files yet.</div>}
      {(showAllArtifacts ? artifacts : artifacts.slice(0, 8)).map((rel) => (
        <button key={rel} className="artifact-row" onClick={() => onOpen?.(rel)} disabled={!cwd} title={cwd ? rel : `${rel} (connect a folder to open)`}>
          <Icon name={artifactIcon(rel)} size={15} className="artifact-ico" />
          <span className="truncate">{rel.split('/').pop()}</span>
        </button>
      ))}
      {artifacts.length > 8 && (
        <button className="view-more" onClick={() => setShowAllArtifacts((v) => !v)}>
          {showAllArtifacts ? 'View less' : `View more (${artifacts.length - 8})`}
        </button>
      )}
      {workingFiles.length > 0 && (
        <>
          <button className="view-more disclosure" onClick={() => setShowWorking((v) => !v)} title="Files the agent read or edited but did not link in a reply" aria-expanded={showWorking}>
            <Icon name="chevron-down" size={13} className={`disclosure-chevron ${showWorking ? 'open' : ''}`} />
            <span>Working files ({workingFiles.length})</span>
          </button>
          {showWorking && workingFiles.map((rel) => (
            <button key={rel} className="artifact-row artifact-row-working" onClick={() => onOpen?.(rel)} disabled={!cwd} title={rel}>
              <Icon name={artifactIcon(rel)} size={15} className="artifact-ico" />
              <span className="truncate">{rel.split('/').pop()}</span>
            </button>
          ))}
        </>
      )}
      <div className="side-section-label side-section-row">
        <span>Tools &amp; sources · {agentName}</span>
        <span className="side-actions">
          <button className="link-btn side-manage" title="Turn servers and tools on or off in Settings ▸ Tools" onClick={() => openSettings('tools')}>Manage</button>
          <button className="icon-btn side-refresh" title="Refresh" onClick={loadTools} disabled={toolsLoading}>{toolsLoading ? <span className="activity-spinner spinner-xs" /> : <Icon name="refresh" size={14} />}</button>
        </span>
      </div>
      {toolsLoading && !tools && (
        <div className="skeleton-stack" aria-label="Checking servers">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row short" />
        </div>
      )}
      {tools && (() => {
        const mcpNames = activeMcp.map((m) => mcpDisplay(m.name).label)
        const mcpSub = activeMcp.length === 0
          ? (tools.mcp.length ? 'All servers are off' : 'None connected')
          : mcpNames.join(', ') + (offMcpCount ? ` · ${offMcpCount} off` : '')
        const failing = activeMcp.filter((m) => m.status === 'failed').length
        return (
          <div className="settings-group tools-panel" role="group" aria-label="Tools and sources">
            <button className={`settings-row tools-panel-row${showAllMcp ? ' open' : ''}`} aria-expanded={showAllMcp} onClick={() => setShowAllMcp((v) => !v)}>
              <span className="settings-row-text">
                <span className="settings-row-title">MCP servers {failing > 0 && <span className="tools-badge failed">{failing} failing</span>}</span>
                <span className="settings-row-sub clamp1">{mcpSub}</span>
              </span>
              <Icon name="chevron-down" size={13} className={`disclosure-chevron ${showAllMcp ? 'open' : ''}`} />
            </button>
            {showAllMcp && activeMcp.length > 0 && (
              <div className="tools-panel-list">
                {activeMcp.map((m) => { const d = mcpDisplay(m.name); return (
                  <div key={m.name} className="tool-row" title={m.detail ? `${m.name}\n${m.detail}` : m.name}>
                    <span className={`mcp-dot ${m.status}`} />
                    <span className="truncate">{d.label}{d.source && <span className="mcp-source"> · {d.source}</span>}</span>
                    <span className="tool-status">{m.status}</span>
                  </div>
                ) })}
                {composerProvider === 'codex' && <div className="tool-note">On Codex, MCP tools run only in Full access.</div>}
              </div>
            )}
            <button className={`settings-row tools-panel-row${showAllTools ? ' open' : ''}`} aria-expanded={showAllTools} onClick={() => setShowAllTools((v) => !v)}>
              <span className="settings-row-text">
                <span className="settings-row-title">Built-in tools</span>
                <span className={`settings-row-sub${showAllTools ? '' : ' clamp1'}`}>{activeBuiltin.length ? activeBuiltin.join(', ') : 'None'}</span>
              </span>
              <Icon name="chevron-down" size={13} className={`disclosure-chevron ${showAllTools ? 'open' : ''}`} />
            </button>
          </div>
        )
      })()}
    </div>
  )
}

export default memo(ChatSidePanel)
