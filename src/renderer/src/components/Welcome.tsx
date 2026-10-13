// First-run welcome (D-103): shown once to a brand-new user (no projects, never finished).
// 1 · which agents are ready (copyable install/sign-in commands, Re-check),
// 2 · first project (a folder, or scratch mode), created on Continue,
// 3 · permission modes + a one-click first prompt (read-only).
import { useEffect, useState } from 'react'
import ProviderAvatar from './ProviderAvatar'
import { refreshAgentStatus, saveDisabledAgents, setAgentStatus } from '../agents'
import AgentSetupCard from './AgentSetupCard'
import { api } from '../api'
import { PROVIDERS, PROVIDER_IDS } from '../../../shared/providers'
import type { ProviderId } from '../../../shared/types'
import type { ProviderAvailability } from '../../../shared/agent'
import {
  agentState, readyAgents, welcomeAgentsOff, welcomePrompt, isBroadFolder, nameFromFolder,
  type AgentStatus
} from '../../../shared/welcome'

export interface WelcomeRun { text: string; provider: ProviderId }

interface Props {
  /** Create the project (connecting the folder when given); resolves to its id. */
  createProject: (name: string, folder: string | null) => Promise<string>
  /** Close the welcome and open the project; `run` sends the first prompt read-only. */
  onFinish: (projectId: string | null, run?: WelcomeRun) => void
}

export default function Welcome({ createProject, onFinish }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [status, setStatus] = useState<AgentStatus>({})
  const [checking, setChecking] = useState(true)
  const [folder, setFolder] = useState<string | null>(null)
  const [scratch, setScratch] = useState(false)
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [sel, setSel] = useState<ProviderId>('claude-code')
  useEffect(() => {
    void (async () => {
      const st = await refreshAgentStatus()
      setStatus(st); setChecking(false)
      // Open on the agent most worth setting up: Claude unless it's ready, then the first not ready.
      if (agentState(st['claude-code']) === 'ready') setSel(PROVIDER_IDS.find((id) => agentState(st[id]) !== 'ready') ?? 'claude-code')
    })()
  }, [])
  // Back from a browser or Terminal: re-check the agents that aren't ready yet, one by one.
  useEffect(() => {
    if (step !== 1) return
    const onFocus = () => {
      for (const id of PROVIDER_IDS) {
        if (agentState(status[id]) === 'ready') continue
        void api.agents.check(id).then((a: ProviderAvailability) => { setAgentStatus(id, a); setStatus((s) => ({ ...s, [id]: a })) }).catch(() => {})
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [step, status])

  const ready = readyAgents(status)
  const canContinue1 = !checking && ready.length > 0

  const next1 = async () => {
    const off = welcomeAgentsOff(status)
    if (off.length) await saveDisabledAgents(off)
    setStep(2)
  }

  const chooseFolder = async () => {
    const f = await api.dialog.selectFolder()
    if (!f) return
    setFolder(f); setScratch(false)
    if (!name.trim()) setName(nameFromFolder(f))
  }

  const next2 = async () => {
    if (projectId) { setStep(3); return }
    setBusy(true)
    try {
      const id = await createProject(name.trim() || (folder ? nameFromFolder(folder) : 'My first project'), scratch ? null : folder)
      setProjectId(id); setStep(3)
    } finally { setBusy(false) }
  }

  const prompt = welcomePrompt(ready, !!folder && !scratch)
  const names = (ids: ProviderId[]) => ids.map((id) => PROVIDERS[id].label).join(' + ')

  return (
    <div className="welcome-overlay">
      <div className="welcome-card" role="dialog" aria-label="Welcome to Troupe">
        <div className="welcome-steps" aria-hidden>
          {[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}
        </div>

        {step === 1 && (
          <div className="welcome-body">
            <div className="welcome-head">
              <div className="welcome-eyebrow">Welcome to Troupe</div>
              <h2>Set up your agents</h2>
              <p>Troupe works with the AI agents you already use. Set up at least one to start.</p>
            </div>
            <div className="welcome-setup">
              <div className="welcome-rail" role="listbox" aria-label="Agents">
                {PROVIDER_IDS.map((id) => {
                  const st = agentState(status[id])
                  return (
                    <button key={id} role="option" aria-selected={sel === id} className={`welcome-rail-row${sel === id ? ' on' : ''}`} onClick={() => setSel(id)}>
                      <ProviderAvatar id={id} size={24} />
                      <span className="welcome-rail-name">{PROVIDERS[id].label}</span>
                      <span className={`welcome-dot ${st}`} title={st} />
                    </button>
                  )
                })}
              </div>
              {/* One card per agent, all mounted: an install keeps its progress while you look at another agent. */}
              {PROVIDER_IDS.map((id) => (
                <div key={id} hidden={sel !== id}>
                  <AgentSetupCard id={id} status={status[id]} onStatus={(aid, a) => setStatus((s) => ({ ...s, [aid]: a }))} />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="welcome-body">
            <div className="welcome-head">
              <h2>Start your first project</h2>
              <p>A project is a folder on your Mac. Agents read and edit the files in it, and its memory lives there too.</p>
            </div>
            <div className="welcome-choices">
              <button className={`welcome-choice${!scratch ? ' sel' : ''}`} disabled={!!projectId} onClick={chooseFolder}>
                <span className="welcome-choice-title">Use a folder</span>
                <span className="welcome-choice-sub">Docs, notes, a repo — anything you want agents to work on.</span>
                {folder ? <span className="welcome-path">{folder}</span> : <span className="btn btn-sm">Choose folder…</span>}
              </button>
              <button className={`welcome-choice${scratch ? ' sel' : ''}`} disabled={!!projectId} onClick={() => { setScratch(true); setFolder(null) }}>
                <span className="welcome-choice-title">Start without a folder</span>
                <span className="welcome-choice-sub">Just chat. You can attach a folder later.</span>
              </button>
            </div>
            {folder && !scratch && isBroadFolder(folder) && (
              <p className="welcome-warn">This is a whole {folder.split('/').length <= 3 ? 'home' : folder.split('/').pop()} folder. Agents can edit everything inside a project, so a subfolder is safer.</p>
            )}
            <label className="field-label" htmlFor="welcome-name">Project name</label>
            <input id="welcome-name" className="field-input" value={name} disabled={!!projectId}
              placeholder={folder ? nameFromFolder(folder) : 'My first project'} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        {step === 3 && (
          <div className="welcome-body">
            <div className="welcome-head">
              <h2>You decide how much agents can do</h2>
              <p>Set per chat from the composer. You can change it any time.</p>
            </div>
            <dl className="welcome-modes">
              <div><dt>Read-only</dt><dd>Agents read and search the project. No edits.</dd></div>
              <div><dt>Auto · default</dt><dd>Agents edit files inside the project without asking.</dd></div>
              <div><dt>Full access</dt><dd>No sandbox and no prompts. Needed for some tools (e.g. MCP on Codex). Use with care.</dd></div>
            </dl>
            {prompt && (
              <div className="welcome-try">
                <div className="welcome-try-title">{prompt.compare ? "Try Troupe's best trick" : 'Try a first question'}</div>
                <div className="welcome-try-prompt">{prompt.text}</div>
                <div className="welcome-try-row">
                  <button className="btn btn-primary" onClick={() => onFinish(projectId, { text: prompt.text, provider: prompt.provider })}>
                    Run with {prompt.compare ? names(ready) : PROVIDERS[prompt.provider].label}
                  </button>
                  <span className="welcome-hint">
                    {prompt.compare ? 'Each agent answers on its own, then a Compare card shows where they agree and disagree. ' : ''}
                    Runs read-only and uses a little of each agent's plan.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="welcome-foot">
          {/* Back sits on the left, apart from the forward actions on the right. */}
          {step > 1 && <button className="btn btn-ghost" onClick={() => setStep((step - 1) as 1 | 2)}>Back</button>}
          <span className="welcome-meta">{step === 1 && (checking ? 'Checking your agents…' : ready.length ? `${ready.length} of ${PROVIDER_IDS.length} ready` : 'Install and sign in to at least one agent to continue')}</span>
          {step < 3 && <button className="btn btn-ghost" onClick={() => onFinish(projectId)}>Skip setup</button>}
          {step === 1 && <button className="btn btn-primary" disabled={!canContinue1} onClick={next1}>Continue</button>}
          {step === 2 && <button className="btn btn-primary" disabled={busy || (!folder && !scratch)} onClick={next2}>{busy ? 'Creating…' : 'Continue'}</button>}
          {step === 3 && <button className="btn" onClick={() => onFinish(projectId)}>Skip, open project</button>}
        </div>
      </div>
    </div>
  )
}
