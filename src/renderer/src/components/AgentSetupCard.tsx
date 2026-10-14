// One agent's setup (Troupe 2.3, Part A): install and sign in from inside Troupe. Used by the
// Welcome screen and Settings ▸ Agents. Commands come from the bundled recipe; main runs them
// only after the user confirms (once per recipe version). Every command stays copyable under
// "Or do it yourself in Terminal".
import { Badge } from './ui/Badge'
import { useEffect, useRef, useState } from 'react'
import ProviderAvatar from './ProviderAvatar'
import { api } from '../api'
import { setAgentStatus } from '../agents'
import { BUILTIN_RECIPES, recipeHash, SETUP_CONFIRMED_SETTING } from '../../../shared/agentRecipes'
import { agentState } from '../../../shared/welcome'
import type { ProviderId, BuiltinProviderId } from '../../../shared/types'
import type { SetupEvent } from '../../../shared/agentSetup'
import { Button, buttonClass } from './ui/Button'

type Avail = { installed: boolean; authenticated: boolean; detail?: string }
type Phase = 'idle' | 'confirm' | 'installing' | 'signingIn' | 'terminal' | 'failed'

interface Props {
  id: BuiltinProviderId
  status?: Avail
  /** Fresh status after a step or a re-check. */
  onStatus?: (id: ProviderId, s: Avail) => void
}

function CopyCmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1200) } catch { /* ignore */ } }
  return (
    <div className="welcome-cmd">
      <code>{cmd}</code>
      <Button size="sm" onClick={copy}>{done ? 'Copied' : 'Copy'}</Button>
    </div>
  )
}

export default function AgentSetupCard({ id, status, onStatus }: Props) {
  const recipe = BUILTIN_RECIPES[id]
  const [phase, setPhase] = useState<Phase>('idle')
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showLog, setShowLog] = useState(true)
  const [diy, setDiy] = useState(false)
  const runId = useRef<string | null>(null)
  const st = agentState(status)

  const check = async (fresh = false) => {
    try {
      const a = await api.agents.check(id, fresh)
      setAgentStatus(id, a); onStatus?.(id, a)
      return a
    } catch { return undefined }
  }

  // Output and results of this card's background step.
  useEffect(() => api.agents.onEvent((e: SetupEvent) => {
    if (e.agent !== id || e.runId !== runId.current) return
    if (e.line) setLines((l) => [...l.slice(-49), e.line!])
    if (e.done) {
      runId.current = null
      if (e.done.ok) {
        setPhase('idle')
        void check(e.kind === 'install')
      } else if (e.kind === 'signIn' && !e.done.cancelled) {
        // Sign-in couldn't finish without a terminal: hand it to Terminal and wait.
        void startStep('signIn', true)
      } else {
        setError(e.done.error ?? 'It stopped.'); setPhase(e.done.cancelled ? 'idle' : 'failed')
      }
    }
  }), [id])   // eslint-disable-line react-hooks/exhaustive-deps

  // While the user finishes in Terminal: re-check this agent every 3 s and when Troupe regains focus.
  useEffect(() => {
    if (phase !== 'terminal') return
    const tick = () => { void check(true).then((a) => { if (a && agentState(a) === 'ready') setPhase('idle') }) }
    const t = setInterval(tick, 3000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(t); window.removeEventListener('focus', tick) }
  }, [phase])   // eslint-disable-line react-hooks/exhaustive-deps
  // A sign-in that turned Ready elsewhere ends the waiting state.
  useEffect(() => { if (st === 'ready' && (phase === 'terminal' || phase === 'signingIn')) setPhase('idle') }, [st, phase])

  const startStep = async (kind: 'install' | 'signIn', terminal = false) => {
    setError(''); setLines([])
    try {
      const r = await api.agents.setupStart(id, kind, terminal)
      if (r.mode === 'run') { runId.current = r.runId; setPhase(kind === 'install' ? 'installing' : 'signingIn') }
      else if (r.mode === 'terminal') setPhase('terminal')
      else setPhase('idle')
    } catch (e) { setError((e as Error).message); setPhase('failed') }
  }

  const install = async () => {
    const confirmed = JSON.parse((await api.settings.get(SETUP_CONFIRMED_SETTING).catch(() => null)) || '{}') as Record<string, string>
    if (confirmed[id] === recipeHash(recipe)) void startStep('install')
    else setPhase('confirm')
  }
  const confirmInstall = async () => {
    const confirmed = JSON.parse((await api.settings.get(SETUP_CONFIRMED_SETTING).catch(() => null)) || '{}') as Record<string, string>
    await api.settings.set(SETUP_CONFIRMED_SETTING, JSON.stringify({ ...confirmed, [id]: recipeHash(recipe) }))
    void startStep('install')
  }
  const cancel = () => { if (runId.current) void api.agents.setupCancel(runId.current); else setPhase('idle') }

  const busy = phase === 'installing' || phase === 'signingIn'
  return (
    <div className="setup-card">
      <div className="setup-card-head">
        <ProviderAvatar id={id} size="xl" />
        <div className="setup-card-title">
          <div className="setup-card-name">{recipe.label}{recipe.recommended && <Badge appearance="soft">Recommended</Badge>}</div>
          <div className="welcome-agent-state"><span className={`welcome-dot ${st}`} />
            {st === 'checking' && 'Checking…'}
            {st === 'ready' && (id === 'grok' || id === 'gemini' ? 'Installed · sign-in is checked on first use' : `Ready${status?.detail ? ` · ${status.detail.split(' · ')[0]}` : ''}`)}
            {st === 'signin' && 'Installed · not signed in'}
            {st === 'missing' && `Not installed${recipe.needs ? ` · ${recipe.needs}` : ''}`}
          </div>
        </div>
      </div>

      {phase === 'confirm' && recipe.install && (
        <div className="setup-confirm">
          <div><b>Install {recipe.label}?</b> This downloads and runs the official installer from <b>{recipe.install.host}</b> on your Mac.</div>
          <code className="setup-cmd">{recipe.install.cmd}</code>
          <div className="setup-actions">
            <Button variant="primary" onClick={confirmInstall}>Install</Button>
            <Button variant="ghost" onClick={() => setPhase('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {busy && (
        <div className="setup-progress">
          <div className="setup-progress-row">
            <span className="activity-spinner spinner-xs" />
            <span>{phase === 'installing' ? 'Installing…' : 'Finish signing in in your browser.'}</span>
            <Button variant="link" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide details' : 'Show details'}</Button>
            <Button size="sm" onClick={cancel}>Cancel</Button>
          </div>
          {showLog && lines.length > 0 && <pre className="setup-log">{lines.slice(-8).join('\n')}</pre>}
        </div>
      )}

      {phase === 'terminal' && (
        <div className="setup-progress">
          <div className="setup-progress-row">
            <span className="activity-spinner spinner-xs" />
            <span>Finish in the Terminal window, then come back here.</span>
            <Button size="sm" onClick={() => setPhase('idle')}>Stop waiting</Button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="setup-failed">
          <div>Couldn't finish. {error}</div>
          <div className="setup-actions">
            <Button size="sm" onClick={() => setPhase('idle')}>Try again</Button>
            <Button size="sm" onClick={() => startStep(st === 'missing' ? 'install' : 'signIn', true)}>Open in Terminal</Button>
          </div>
        </div>
      )}

      {phase === 'idle' && st !== 'ready' && st !== 'checking' && (
        <div className="setup-actions">
          {st === 'missing' && recipe.install && <Button variant="primary" onClick={install}>Install</Button>}
          {st === 'missing' && !recipe.install && recipe.docs && <a className={buttonClass({ size: 'sm' })} href={recipe.docs} target="_blank" rel="noreferrer">Install instructions ↗</a>}
          {st === 'signin' && recipe.signIn && <Button variant="primary" onClick={() => startStep('signIn')}>Sign in</Button>}
          <Button variant="link" onClick={() => void check(true)}>Check again</Button>
        </div>
      )}

      {st !== 'ready' && (recipe.install || recipe.signIn) && (
        <div className="setup-diy">
          <Button variant="link" onClick={() => setDiy((v) => !v)}>{diy ? '▾' : '▸'} Or do it yourself in Terminal</Button>
          {diy && (
            <div className="setup-diy-body">
              {st === 'missing' && recipe.install && <CopyCmd cmd={recipe.install.cmd} />}
              {recipe.signIn && <CopyCmd cmd={recipe.signIn.cmd} />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
