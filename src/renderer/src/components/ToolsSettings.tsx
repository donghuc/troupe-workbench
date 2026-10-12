import { useEffect, useState } from 'react'
import Icon from './Icon'
import McpAddModal from './McpAddModal'
import { Stack, Field, Section } from './Form'
import { api } from '../api'
import { failed, notify, reportError } from '../notices'
import { PROVIDERS } from '../../../shared/providers'
import { mcpOffKey, mcpDisplay, groupMcpServers } from '../../../shared/projectMcp'
import type { AgentTools, McpServer, ProviderId } from '../../../shared/types'
import Switch from './settings/Switch'

interface Props {
  agents: ProviderId[]                      // agents that are on
  mcpOff: string[]                          // "<provider>:<name>" keys (saved with the modal)
  setMcpOff: (next: string[]) => void
  webAccess: boolean; setWebAccess: (v: boolean) => void
  shellAccess: boolean; setShellAccess: (v: boolean) => void
  chromeAccess: boolean; setChromeAccess: (v: boolean) => void
}

// Settings ▸ Tools (D-077): the one place MCP servers and built-in tool access are
// switched on or off — for every project. The chat side panel only shows what's active.
export default function ToolsSettings({ agents, mcpOff, setMcpOff, webAccess, setWebAccess, shellAccess, setShellAccess, chromeAccess, setChromeAccess }: Props) {
  const [agent, setAgent] = useState<ProviderId>(agents[0] ?? 'claude-code')
  const [tools, setTools] = useState<AgentTools | null>(null)
  const [loading, setLoading] = useState(false)
  const [openPlugins, setOpenPlugins] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => { if (!agents.includes(agent) && agents[0]) setAgent(agents[0]) }, [agents, agent])
  const load = () => {
    setLoading(true)
    api.system.tools(agent).then((t: AgentTools) => setTools(t)).catch(() => setTools(null)).finally(() => setLoading(false))
  }
  useEffect(() => { setTools(null); load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent])

  const isOn = (name: string) => !mcpOff.includes(mcpOffKey(agent, name))
  const setOn = (names: string[], on: boolean) => {
    const keys = names.map((n) => mcpOffKey(agent, n))
    setMcpOff(on ? mcpOff.filter((k) => !keys.includes(k)) : [...new Set([...mcpOff, ...keys])])
  }
  const remove = async (name: string) => {
    if (!confirm(`Remove MCP server “${name}” from Claude and Codex?`)) return
    setRemoving(name)
    const r = await api.system.mcpRemove(name).catch(failed('Remove MCP server'))
    if (r && !r.ok) reportError('Remove MCP server', r.error || 'Failed.')
    else if (r?.warning) notify(r.warning)
    setRemoving(null); load()
  }

  const row = (m: McpServer, opts: { removable?: boolean; indent?: boolean } = {}) => {
    const d = mcpDisplay(m.name)
    const on = isOn(m.name)
    return (
      <div key={m.name} className={`settings-row tools-row${on ? '' : ' off'}${opts.indent ? ' indent' : ''}`}>
        <span className={`mcp-dot ${on ? m.status : 'unknown'}`} />
        <div className="settings-row-text">
          <div className="settings-row-title" title={m.name}>{d.label}</div>
          {m.detail && <div className="settings-row-sub truncate" title={m.detail}>{m.detail}</div>}
          {on && m.status === 'pending' && (
            <div className="settings-row-sub">Sign in once in Terminal: run <code>claude</code>, type <code>/mcp</code>, pick this server, Authenticate. Troupe reuses the login.</div>
          )}
        </div>
        <span className="tool-status">{on ? (m.status === 'pending' ? 'sign in' : m.status) : 'off'}</span>
        {opts.removable && d.removable && (
          <button className="icon-btn" title="Remove server" disabled={removing === m.name} onClick={() => remove(m.name)}>
            {removing === m.name ? <span className="activity-spinner spinner-xs" /> : <Icon name="close" size={13} />}
          </button>
        )}
        <Switch on={on} label={`${d.label} ${on ? 'on' : 'off'}`} onChange={(v) => setOn([m.name], v)} />
      </div>
    )
  }

  const g = tools ? groupMcpServers(tools.mcp) : null
  const canAdd = agent === 'claude-code' || agent === 'codex'   // Add writes Claude's and Codex's configs

  return (
    <Stack>
      {agents.length > 1 && (
        <div className="seg-control" role="tablist" aria-label="Agent">
          {agents.map((id) => (
            <button key={id} role="tab" aria-selected={agent === id} className={`seg-btn${agent === id ? ' active' : ''}`} onClick={() => setAgent(id)}>{PROVIDERS[id].label}</button>
          ))}
        </div>
      )}

      <Section title="MCP servers" actions={<>
          {canAdd && <button className="link-btn" onClick={() => setShowAdd(true)}>+ Add server</button>}
          <button className="icon-btn" title="Refresh" onClick={load} disabled={loading}>{loading ? <span className="activity-spinner spinner-xs" /> : <Icon name="refresh" size={14} />}</button>
        </>}>
      <Field hint={<>Off servers are left out of every run, in every project.{agent === 'codex' && ' On Codex, MCP tools run only in Full access.'}</>}>
      <Stack tight>
      {loading && !tools && <div className="skeleton-stack"><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row short" /></div>}
      {g && tools!.mcp.length === 0 && <p className="field-hint">No MCP servers set up for {PROVIDERS[agent].label}.</p>}

      {g && g.own.length > 0 && (
        <div>
          <div className="tools-group-label">Your servers</div>
          <div className="settings-group">{g.own.map((m) => row(m, { removable: true }))}</div>
        </div>
      )}
      {g && g.connectors.length > 0 && (
        <div>
          <div className="tools-group-label">claude.ai connectors <span className="tools-group-hint">· connect or remove them on claude.ai</span></div>
          <div className="settings-group">{g.connectors.map((m) => row(m))}</div>
        </div>
      )}
      {g && g.plugins.length > 0 && (
        <div>
          <div className="tools-group-label">Plugins <span className="tools-group-hint">· install or remove with /plugin in Claude Code</span></div>
          <div className="settings-group">
            {g.plugins.map(({ plugin, servers }) => {
              const names = servers.map((s) => s.name)
              const onCount = names.filter(isOn).length
              const open = openPlugins.has(plugin)
              return (
                <div key={plugin} className="tools-plugin">
                  <div className={`settings-row tools-row${onCount ? '' : ' off'}`}>
                    <button className="tools-plugin-toggle" aria-expanded={open} onClick={() => setOpenPlugins((cur) => { const n = new Set(cur); if (open) n.delete(plugin); else n.add(plugin); return n })}>
                      <span className={`tools-chevron${open ? ' open' : ''}`}><Icon name="chevron-down" size={13} /></span>
                      <span className="settings-row-text">
                        <span className="settings-row-title">{plugin}</span>
                        <span className="settings-row-sub">{onCount === names.length ? `${names.length} servers, all on` : onCount === 0 ? `${names.length} servers, all off` : `${onCount} of ${names.length} servers on`}</span>
                      </span>
                    </button>
                    <Switch on={onCount > 0} label={`${plugin} plugin servers ${onCount ? 'on' : 'off'}`} title={onCount ? 'Switch all of this plugin’s servers off' : 'Switch all of this plugin’s servers on'} onChange={(v) => setOn(names, v)} />
                  </div>
                  {open && servers.map((m) => row(m, { indent: true }))}
                </div>
              )
            })}
          </div>
        </div>
      )}
      </Stack>
      </Field>
      </Section>

      <Section title="Built-in tools">
      <Field hint="Apply to every agent; a chat’s permission level can narrow them.">
      <div className="settings-group" role="group" aria-label="Built-in tools">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Web access</div>
            <div className="settings-row-sub">Search and read web pages.</div>
          </div>
          <Switch on={webAccess} label="Web access" onChange={setWebAccess} />
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Shell commands</div>
            <div className="settings-row-sub">Run commands in the project folder. Never in Read-only.</div>
          </div>
          <Switch on={shellAccess} label="Shell commands" onChange={setShellAccess} />
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Chrome browser</div>
            <div className="settings-row-sub">Claude browses in your own Chrome, signed in as you. Needs the Claude in Chrome extension; not in Read-only.</div>
          </div>
          <Switch on={chromeAccess} label="Chrome browser" onChange={setChromeAccess} />
        </div>
      </div>
      </Field>
      </Section>

      {showAdd && <McpAddModal globalOnly onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}
    </Stack>
  )
}
