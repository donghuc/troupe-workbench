import { confirmDialog } from './ui/ConfirmDialog'
import { OS_WORDS, IS_WINDOWS } from '../../../shared/platform'
import { useEffect, useState } from 'react'
import Icon from './Icon'
import McpAddModal from './McpAddModal'
import { Stack, Field, Section } from './Form'
import { api } from '../api'
import { failed, notify, reportError } from '../notices'
import { agentEntry } from '../../../shared/providers'
import { mcpOffKey, mcpDisplay, groupMcpServers } from '../../../shared/projectMcp'
import type { AgentTools, McpServer, ProviderId } from '../../../shared/types'
import Switch from './settings/Switch'
import { Button, IconButton } from './ui/Button'
import { Segmented } from './ui/Segmented'

interface Props {
  agents: ProviderId[]                      // agents that are on
  mcpOff: string[]                          // "<provider>:<name>" keys (saved with the modal)
  setMcpOff: (next: string[]) => void
  webAccess: boolean; setWebAccess: (v: boolean) => void
  shellAccess: boolean; setShellAccess: (v: boolean) => void
  shellSandbox: boolean; setShellSandbox: (v: boolean) => void   // D-115
  shellDomains: string; setShellDomains: (v: string) => void
  cliAccess: boolean; setCliAccess: (v: boolean) => void   // D-117
  chromeAccess: boolean; setChromeAccess: (v: boolean) => void
}

// Settings ▸ Tools (D-077): the one place MCP servers and built-in tool access are
// switched on or off — for every project. The chat side panel only shows what's active.
export default function ToolsSettings({ agents, mcpOff, setMcpOff, webAccess, setWebAccess, shellAccess, setShellAccess, shellSandbox, setShellSandbox, shellDomains, setShellDomains, cliAccess, setCliAccess, chromeAccess, setChromeAccess }: Props) {
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
    if (!(await confirmDialog({ title: 'Remove MCP server?', message: `“${name}” is removed from Claude and Codex.`, confirmLabel: 'Remove' }))) return
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
            <div className="settings-row-sub">Sign in once in {OS_WORDS.terminal}: run <code>claude</code>, type <code>/mcp</code>, pick this server, Authenticate. Troupe reuses the login.</div>
          )}
        </div>
        <span className="tool-status">{on ? (m.status === 'pending' ? 'sign in' : m.status) : 'off'}</span>
        {opts.removable && d.removable && (
          <IconButton title="Remove server" disabled={removing === m.name} onClick={() => remove(m.name)}>
            {removing === m.name ? <span className="activity-spinner spinner-xs" /> : <Icon name="close" size="sm" />}
          </IconButton>
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
        <Segmented label="Agent" className="segmented-spaced" value={agent} onChange={setAgent}
          options={agents.map((id) => ({ value: id, label: agentEntry(id).label }))} />
      )}

      <Section title="MCP servers" actions={<>
          {canAdd && <Button variant="link" onClick={() => setShowAdd(true)}>+ Add server</Button>}
          <IconButton title="Refresh" onClick={load} disabled={loading}>{loading ? <span className="activity-spinner spinner-xs" /> : <Icon name="refresh" size="sm" />}</IconButton>
        </>}>
      <Field hint={<>Off servers are left out of every run, in every project.{agent === 'codex' && ' On Codex, MCP tools run only in Full access.'}</>}>
      <Stack tight>
      {loading && !tools && <div className="skeleton-stack"><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row short" /></div>}
      {g && tools!.mcp.length === 0 && <p className="field-hint">No MCP servers set up for {agentEntry(agent).label}.</p>}

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
                      <span className={`tools-chevron${open ? ' open' : ''}`}><Icon name="chevron-down" size="sm" /></span>
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
        {shellAccess && (
          <div className="settings-row settings-row-nested">
            <div className="settings-row-text">
              <div className="settings-row-title">Sandbox in Auto</div>
              <div className="settings-row-sub">{IS_WINDOWS
                ? "Claude Code has no sandbox on Windows, so while this is on, Auto doesn't run shell commands. Turn it off to let Auto run them unsandboxed; Full access always can."
                : "In Auto, Claude's commands can only change files in the project and reach package registries, GitHub and the sites below. Full access skips the sandbox."}</div>
              {shellSandbox && !IS_WINDOWS && (
                <textarea
                  className="global-instr-input shell-domains-input"
                  aria-label="Other sites shell commands may reach"
                  placeholder={'Other sites, one per line — e.g. api.example.com or *.figma.com'}
                  value={shellDomains}
                  onChange={(e) => setShellDomains(e.target.value)}
                />
              )}
            </div>
            <Switch on={shellSandbox} label="Sandbox in Auto" onChange={setShellSandbox} />
          </div>
        )}
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

      <Section title="Command line">
      <Field hint={`Lets tools on this ${OS_WORDS.computer}, like Grok Bot, list projects and chat through the troupe command. Runs use Read-only or Auto, never Full access.`}>
      <div className="settings-group" role="group" aria-label="Command line">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Allow command-line access</div>
            <div className="settings-row-sub">Only while Troupe is open, and only for your user on this {OS_WORDS.computer}.</div>
          </div>
          <Switch on={cliAccess} label="Allow command-line access" onChange={setCliAccess} />
        </div>
        <CliInstallRow />
      </div>
      </Field>
      </Section>

      {showAdd && <McpAddModal globalOnly onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}
    </Stack>
  )
}

// D-117: install the `troupe` command (a small wrapper in a bin folder) and show where it is.
function CliInstallRow() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ path: string; onPath: boolean } | null>(null)
  const install = async () => {
    setBusy(true)
    try { setResult(await api.system.cliInstall()) } catch (e) { reportError('Install the troupe command', e) } finally { setBusy(false) }
  }
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">troupe command</div>
        <div className={`settings-row-sub${result ? ' ok' : ''}`}>
          {result ? <>Installed at <code>{result.path}</code>{result.onPath ? (IS_WINDOWS ? ' — open a new terminal to use it.' : '') : ' — not on your PATH, so call it by this full path.'}</> : `Adds the troupe command to your ${OS_WORDS.computer}. Run troupe --help to start.`}
        </div>
      </div>
      <Button size="sm" disabled={busy} onClick={install}>{result ? 'Reinstall' : 'Install'}</Button>
    </div>
  )
}
