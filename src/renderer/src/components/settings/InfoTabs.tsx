import { useEffect, useState } from 'react'
import { api } from '../../api'
import logo from '../../assets/logo.png'
import type { AppInfo } from '../../../../shared/api'

const COMMANDS: { k: string; d: string }[] = [
  { k: '@claude / @codex', d: 'Route this message to one specific agent.' },
  { k: '@all', d: 'Ask every agent at once — each answers independently; a Compare card sums them up.' },
  { k: '@debate', d: 'Thinking mode: one agent argues for, one against, a judge decides (cast in Settings ▸ Thinking).' },
  { k: '@critique', d: 'Thinking mode: one agent produces, another attacks, the first responds.' },
  { k: '@research', d: 'Thinking mode: one agent gathers sources, another checks them.' },
  { k: '# your note', d: 'Save the line as a dated fact in this project\'s memory instead of sending it.' },
  { k: '⌘K', d: 'Search across chats and messages.' },
  { k: 'Shift + Enter', d: 'New line — and continues a numbered or bulleted list.' },
  { k: 'Select text', d: 'Pops a menu: Explain this · Reply · Lookup.' },
  { k: 'Compare replies', d: 'Under an @all group: one card with the verdict, agreements and disagreements; full replies fold beneath.' },
  { k: 'Reply ⋯ menu', d: 'Regenerate · Branch from here · Save to project · Save as skill · Add fact to Memory · Save outcome · Second opinion.' }
]

// Settings ▸ Commands: what you can type and click.
export function CommandsTab() {
  return (
    <div className="cmd-list">
      {COMMANDS.map((c) => (
        <div key={c.k} className="cmd-row">
          <kbd className="cmd-key">{c.k}</kbd>
          <span className="cmd-desc">{c.d}</span>
        </div>
      ))}
    </div>
  )
}

// Settings ▸ About.
export function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => { api.system.appInfo().then(setInfo).catch(() => {}) }, [])
  return (
    <div className="about-pane">
      <div className="about-head">
        <img className="about-logo" src={logo} alt="" />
        <div>
          <div className="about-name">Troupe</div>
          <div className="about-version">Version {info?.version ?? '…'}</div>
        </div>
      </div>
      <dl className="about-grid">
        <div><dt>Electron</dt><dd>{info?.electron ?? '—'}</dd></div>
        <div><dt>Chromium</dt><dd>{info?.chrome ?? '—'}</dd></div>
        <div><dt>Node</dt><dd>{info?.node ?? '—'}</dd></div>
        <div><dt>Platform</dt><dd>{info?.platform ?? '—'}</dd></div>
      </dl>
      <div className="about-actions">
        <button className="btn btn-sm" onClick={() => api.system.openLogs()}>Reveal logs in Finder</button>
      </div>
      <p className="about-note">Logs record app activity, tool calls and errors (not your full message text) — attach <code>main.log</code> when reporting a bug.</p>
    </div>
  )
}
