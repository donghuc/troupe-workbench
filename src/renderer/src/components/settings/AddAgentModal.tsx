import { Button } from '../ui/Button'
import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal'
import { Field } from '../Form'
import Icon from '../Icon'
import ProviderAvatar from '../ProviderAvatar'
import { api } from '../../api'
import { customAgents } from '../../agents'
import { PRESET_RECIPES, type AgentRecipe } from '../../../../shared/agentRecipes'
import {
  parseCommandLine, handleFromName, validateDraft, draftOf, showArg,
  type CustomAgent, type CustomAgentDraft, type TestResult
} from '../../../../shared/customAgents'

// Settings ▸ Agents ▸ + Add agent (Troupe 2.4, Part B/C). Presets found on this Mac fill the
// form in one click; any other command-line agent is typed in. Test runs it once in an empty
// temp folder; Add is enabled once it passes (or "Add without testing" is ticked).
interface Props { editing?: CustomAgent; onClose: () => void }

const EMPTY: CustomAgentDraft = { name: '', handle: '', command: '', output: 'text', modelFlag: '', readOnlyArgs: '' }
const sameDraft = (a: CustomAgentDraft, b: CustomAgentDraft) => JSON.stringify(a) === JSON.stringify(b)

/** The preset's command, run with the binary actually found (e.g. `agent` instead of `cursor-agent`). */
function presetDraft(r: AgentRecipe, found: string | null): CustomAgentDraft {
  const cmd = r.agent!.command
  const command = found && !cmd.startsWith(found + ' ') ? cmd.replace(/^\S+/, found) : cmd
  const handle = handleFromName(r.label.replace(/\s+CLI$/i, ''))
  return { name: r.label, handle, command, output: r.agent!.output, modelFlag: r.agent!.modelFlag ?? '', readOnlyArgs: r.agent!.readOnlyArgs ?? '', presetId: r.id }
}

export default function AddAgentModal({ editing, onClose }: Props) {
  const [draft, setDraft] = useState<CustomAgentDraft>(editing ? draftOf(editing) : EMPTY)
  const [handleTouched, setHandleTouched] = useState(!!editing)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [skipTest, setSkipTest] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ draft: CustomAgentDraft; result: TestResult } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<Record<string, string | null> | null>(null)

  // Which presets are installed (a PATH lookup; nothing runs). Re-checked when the window regains focus.
  useEffect(() => {
    if (editing) return
    const check = () => { api.customAgents.presets().then((list: { id: string; found: string | null }[]) => setFound(Object.fromEntries(list.map((p) => [p.id, p.found])))).catch(() => setFound({})) }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [editing])

  const set = (patch: Partial<CustomAgentDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch }
      if (patch.name !== undefined && !handleTouched) next.handle = handleFromName(patch.name)
      return next
    })
    setError('')
  }

  const parsed = useMemo(() => (draft.command.trim() ? parseCommandLine(draft.command.trim()) : null), [draft.command])
  const others = customAgents()
  const check = validateDraft(draft, others, editing?.id)
  const passed = !!test && test.result.ok && sameDraft(test.draft, draft)
  // Editing only the name or @handle doesn't change what runs, so it saves without a new test.
  const orig = editing ? draftOf(editing) : null
  const runChanged = !orig || (['command', 'output', 'modelFlag', 'readOnlyArgs'] as const).some((k) => (draft[k] ?? '').trim() !== (orig[k] ?? '').trim())
  const canSave = passed || skipTest || !runChanged
  const added = new Set(others.filter((a) => !a.archived && a.presetId).map((a) => a.presetId))

  const runTest = async () => {
    if (!check.ok) { setError(check.error); return }
    setTesting(true); setTest(null); setError('')
    try { setTest({ draft, result: await api.customAgents.test(draft, editing?.id) }) } catch (e) { setError((e as Error).message) }
    setTesting(false)
  }

  const save = async () => {
    if (!check.ok) { setError(check.error); return }
    setSaving(true)
    try { await api.customAgents.save(draft, editing?.id); onClose() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); setSaving(false) }
  }

  const pickPreset = (r: AgentRecipe) => { setDraft(presetDraft(r, found?.[r.id] ?? null)); setHandleTouched(true); setTest(null); setError('') }

  const footer = (
    <>
      <span className="modal-footer-note">{passed ? 'Test passed' : testing ? '' : !runChanged ? '' : skipTest ? (editing ? 'Saving without a test' : 'Adding without a test') : editing ? 'Command changed — test it, then save' : 'Test it, then add it'}</span>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={runTest} disabled={testing || !draft.command.trim()}>{testing ? <><span className="activity-spinner" /> Testing…</> : 'Test'}</Button>
      <Button variant="primary" onClick={save} disabled={saving || testing || !canSave}>{editing ? 'Save' : 'Add'}</Button>
    </>
  )

  const advSummary = [draft.output === 'claude-stream-json' ? 'Claude-style JSON' : 'Plain text', draft.modelFlag?.trim(), draft.readOnlyArgs?.trim()].filter(Boolean).join(' · ')

  return (
    <Modal title={editing ? `Edit ${editing.name}` : 'Add agent'} onClose={onClose} footer={footer} wide>
      <div className="agent-form">
        {!editing && (
          <section className="agent-form-block">
            <div className="agent-form-label">Ready-made</div>
            <div className="settings-group" role="list" aria-label="Ready-made agents">
              {PRESET_RECIPES.map((r) => {
                const bin = found?.[r.id]
                const isAdded = added.has(r.id)
                const picked = draft.presetId === r.id
                const state = found === null ? 'Checking…' : isAdded ? 'Already added' : bin ? 'Found on your Mac' : 'Not installed'
                return (
                  <div key={r.id} role="listitem" className={`settings-row preset-row${picked ? ' picked' : ''}`}>
                    <ProviderAvatar id={`x-${r.id}`} size="lg" />
                    <div className="settings-row-text">
                      <div className="settings-row-title">{r.label}</div>
                      <div className="settings-row-sub"><span className={bin && !isAdded ? 'ok' : ''}>{state}</span>{r.needs ? ` · ${r.needs}` : ''}</div>
                    </div>
                    {picked && <span className="preset-picked"><Icon name="check" size="xs" /> Selected</span>}
                    {!picked && bin && !isAdded && <Button size="sm" onClick={() => pickPreset(r)}>Use</Button>}
                    {found !== null && !bin && !isAdded && r.install && (
                      <Button size="sm" title={`Opens Terminal and runs: ${r.install.cmd}`} onClick={() => api.agents.setupStart(r.id, 'install', true)}>Install…</Button>
                    )}
                    {bin && r.signIn && !isAdded && <Button variant="ghost" size="sm" title={`Opens Terminal and runs: ${r.signIn.cmd}`} onClick={() => api.agents.setupStart(r.id, 'signIn', true)}>Sign in…</Button>}
                  </div>
                )
              })}
            </div>
            <div className="agent-form-divider"><span>or add any command-line agent</span></div>
          </section>
        )}

        <section className="agent-form-block">
          <div className="field-row-2">
            <Field label="Name" htmlFor="ca-name">
              <input id="ca-name" className="field-input" placeholder="e.g. DeepSeek" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Mention as" htmlFor="ca-handle">
              <div className="input-prefix">
                <span aria-hidden="true">@</span>
                <input id="ca-handle" className="field-input mono" placeholder="deepseek" value={draft.handle} onChange={(e) => { setHandleTouched(true); set({ handle: e.target.value }) }} />
              </div>
            </Field>
          </div>
          <Field label="Command" htmlFor="ca-cmd" hint={<>The command that runs one prompt and exits. Put <code>{'{prompt}'}</code> where the prompt goes; leave it out to send the prompt on stdin.</>}>
            <input id="ca-cmd" className="field-input mono" placeholder="opencode run {prompt}" value={draft.command} spellCheck={false} onChange={(e) => set({ command: e.target.value })} />
            {parsed && (parsed.ok
              ? <div className="cmd-chips" aria-label="What will run">{parsed.argv.map((a, i) => <span key={i} className={`cmd-chip${i === 0 ? ' bin' : ''}${a.includes('{prompt}') ? ' slot' : ''}`}>{showArg(a)}</span>)}</div>
              : <p className="field-hint warn">{parsed.error}</p>)}
          </Field>

          <div className={`disclosure${showAdvanced ? ' open' : ''}`}>
            <button type="button" className="disclosure-head" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
              <Icon name="chevron-down" size="xs" className="disclosure-chevron" />
              <span>Advanced</span>
              {!showAdvanced && <span className="disclosure-summary">{advSummary}</span>}
            </button>
            {showAdvanced && (
              <div className="disclosure-body">
                <Field label="Output" htmlFor="ca-output" hint="Claude-style JSON shows live tool steps, if the agent prints Claude Code's stream-json format.">
                  <select id="ca-output" className="field-input" value={draft.output} onChange={(e) => set({ output: e.target.value as CustomAgentDraft['output'] })}>
                    <option value="text">Plain text</option>
                    <option value="claude-stream-json">Claude-style JSON</option>
                  </select>
                </Field>
                <div className="field-row-2">
                  <Field label="Model flag" htmlFor="ca-model" hint="Lets you pick models for it in Settings ▸ Agents.">
                    <input id="ca-model" className="field-input mono" placeholder="--model" value={draft.modelFlag ?? ''} onChange={(e) => set({ modelFlag: e.target.value })} />
                  </Field>
                  <Field label="Read-only flags" htmlFor="ca-ro" hint="Added in Read-only mode. Without them, read-only is only asked for.">
                    <input id="ca-ro" className="field-input mono" placeholder="--sandbox read-only" value={draft.readOnlyArgs ?? ''} onChange={(e) => set({ readOnlyArgs: e.target.value })} />
                  </Field>
                </div>
                <label className="field-check"><input type="checkbox" checked={skipTest} onChange={(e) => setSkipTest(e.target.checked)} /> {editing ? 'Save without testing' : 'Add without testing'}</label>
              </div>
            )}
          </div>
        </section>

        {(testing || test || error) && (
          <div className={`agent-test ${testing ? '' : test?.result.ok && !error ? 'ok' : 'fail'}`} role="status">
            {testing && <><span className="activity-spinner" /> Sending a test prompt in an empty folder… (up to 60 seconds)</>}
            {!testing && error && <>{error}</>}
            {!testing && !error && test && (test.result.ok
              ? <><strong>It answered</strong> in {(test.result.ms / 1000).toFixed(1)} s. You can add it.<pre className="agent-test-reply">{test.result.reply}</pre></>
              : <><strong>It didn't answer:</strong> {test.result.error}. Check the command runs in Terminal.{test.result.reply && <pre className="agent-test-reply">{test.result.reply}</pre>}</>)}
          </div>
        )}

        <p className="agent-trust"><Icon name="info" size="sm" /> Added agents can read and change files in your project folder. Only add tools you trust.</p>
      </div>
    </Modal>
  )
}
