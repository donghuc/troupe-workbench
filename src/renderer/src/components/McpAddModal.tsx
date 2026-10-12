import { useState } from 'react'
import Modal from './Modal'
import Icon from './Icon'
import { api } from '../api'
import type { McpAddInput, McpKeyVal, McpScope } from '../../../shared/types'
import { notify } from '../notices'

interface Props {
  cwd?: string
  globalOnly?: boolean   // Settings ▸ Tools (D-077): always user scope, no scope picker
  onClose: () => void
  onAdded: () => void
}

// Add a Claude Code MCP server from within the app (writes to Claude Code's own
// config via `claude mcp add`). stdio = a local command; http = a hosted URL.
export default function McpAddModal({ cwd, globalOnly, onClose, onAdded }: Props) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [commandOrUrl, setCommandOrUrl] = useState('')
  const [argsText, setArgsText] = useState('')
  const [pairs, setPairs] = useState<McpKeyVal[]>([])
  const [scope, setScope] = useState<McpScope>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setPair = (i: number, patch: Partial<McpKeyVal>) => setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const addPair = () => setPairs((ps) => [...ps, { key: '', value: '' }])
  const removePair = (i: number) => setPairs((ps) => ps.filter((_, j) => j !== i))

  const preset = (n: string, cmd: string, args: string) => {
    setTransport('stdio'); setName(n); setCommandOrUrl(cmd); setArgsText(args); setPairs([]); setError(null)
  }

  const submit = async () => {
    setError(null); setBusy(true)
    const input: McpAddInput = {
      name: name.trim(), transport, commandOrUrl: commandOrUrl.trim(), scope,
      args: transport === 'stdio' ? argsText.trim().split(/\s+/).filter(Boolean) : undefined,
      env: transport === 'stdio' ? pairs.filter((p) => p.key.trim()) : undefined,
      headers: transport === 'http' ? pairs.filter((p) => p.key.trim()) : undefined
    }
    const res = await api.system.mcpAdd(input, cwd)
    setBusy(false)
    if (res.ok) { if (res.warning) notify(res.warning); onAdded() }
    else setError(res.error || 'Failed to add server.')
  }

  const pairLabel = transport === 'http' ? 'Headers' : 'Environment variables'
  // The name is the identifier the CLIs use (`claude mcp add <name>`, `mcp__<name>__tool`),
  // so it can't contain spaces. Say so instead of silently greying the button out.
  const badName = /\s/.test(name.trim())
  const suggested = name.trim().toLowerCase().replace(/\s+/g, '-')
  const canSubmit = name.trim() && !badName && commandOrUrl.trim() && !busy

  return (
    <Modal title="Add MCP server" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>{busy ? <><span className="activity-spinner spinner-xs" />Adding…</> : 'Add server'}</button>
      </>
    }>
      <label className="field-label">Quick add</label>
      <div className="mcp-presets">
        <button className="btn btn-sm" onClick={() => preset('playwright', 'npx', '-y @playwright/mcp@latest')}>🌐 Browser (Playwright)</button>
        <button className="btn btn-sm" onClick={() => preset('chrome-devtools', 'npx', '-y chrome-devtools-mcp@latest')}>🌐 Browser (Chrome DevTools)</button>
        <button className="btn btn-sm" onClick={() => preset('browser-cdp', 'npx', '-y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222')} title="Reuses your logged-in Chrome. Start Chrome with --remote-debugging-port=9222 first.">🌐 Browser (my Chrome · CDP 9222)</button>
      </div>

      <label className="field-label">Name</label>
      <input className="field-input" value={name} placeholder="e.g. sequential-thinking" onChange={(e) => setName(e.target.value)} />
      {badName && (
        <div className="field-hint">
          No spaces — agents use this as an identifier. <button type="button" className="link-btn" onClick={() => setName(suggested)}>Use “{suggested}”</button>
        </div>
      )}

      <label className="field-label">Transport</label>
      <select className="field-input" value={transport} onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')}>
        <option value="stdio">stdio — a local command Claude runs</option>
        <option value="http">http — a hosted server URL</option>
      </select>

      <label className="field-label">{transport === 'http' ? 'Server URL' : 'Command'}</label>
      <input className="field-input" value={commandOrUrl}
        placeholder={transport === 'http' ? 'https://mcp.example.com/mcp' : 'npx'}
        onChange={(e) => setCommandOrUrl(e.target.value)} />

      {transport === 'stdio' && (
        <>
          <label className="field-label">Arguments</label>
          <input className="field-input" value={argsText} placeholder="-y @modelcontextprotocol/server-sequential-thinking" onChange={(e) => setArgsText(e.target.value)} />
        </>
      )}

      <label className="field-label">{pairLabel}</label>
      {pairs.map((p, i) => (
        <div key={i} className="kv-row">
          <input className="field-input" value={p.key} placeholder={transport === 'http' ? 'Authorization' : 'API_KEY'} onChange={(e) => setPair(i, { key: e.target.value })} />
          <input className="field-input" value={p.value} placeholder={transport === 'http' ? 'Bearer …' : 'value'} onChange={(e) => setPair(i, { value: e.target.value })} />
          <button className="icon-btn" title="Remove" onClick={() => removePair(i)}><Icon name="close" size={14} /></button>
        </div>
      ))}
      <button className="link-btn" onClick={addPair}>+ Add {transport === 'http' ? 'header' : 'variable'}</button>

      {!globalOnly && <><label className="field-label">Scope</label>
      <select className="field-input" value={scope} onChange={(e) => setScope(e.target.value as McpScope)}>
        <option value="user">User — all your projects (recommended)</option>
        <option value="local">Local — this project folder only</option>
        <option value="project">Project — shared via .mcp.json (needs approval)</option>
      </select></>}

      {error && <div className="mcp-error">⚠ {error}</div>}
    </Modal>
  )
}
