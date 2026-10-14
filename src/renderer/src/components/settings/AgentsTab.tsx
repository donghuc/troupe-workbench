import { Badge } from '../ui/Badge'
import { confirmDialog } from '../ui/ConfirmDialog'
import { useState } from 'react'
import ProviderAvatar from '../ProviderAvatar'
import Modal from '../Modal'
import AgentSetupCard from '../AgentSetupCard'
import AddAgentModal from './AddAgentModal'
import Icon from '../Icon'
import Switch from './Switch'
import { Stack, Field, Section } from '../Form'
import { agentEntry, agentIds, isBuiltinId } from '../../../../shared/providers'
import { allPresetsFor, modelKey, parseExtraModels, addExtraModel, removeExtraModel, type ModelLists } from '../../../../shared/models'
import type { ProviderId, BuiltinProviderId } from '../../../../shared/types'
import type { CustomAgent } from '../../../../shared/customAgents'
import { presetRecipe } from '../../../../shared/agentRecipes'
import { useAgentList, customAgentFor } from '../../agents'
import { api } from '../../api'
import { Button } from '../ui/Button'

type Status = Partial<Record<ProviderId, { installed: boolean; authenticated: boolean }>>
interface Props {
  offAgents: ProviderId[]; toggleAgent: (id: ProviderId, on: boolean) => void
  offModels: Set<string>; toggleModel: (key: string, on: boolean) => void
  agentStatus: Status
  onAgentStatus?: (id: ProviderId, s: { installed: boolean; authenticated: boolean }) => void
  lists: ModelLists                       // each agent's models incl. the typed "More models"
  extraModels: string; setExtraModelsText: (v: string) => void
  codexImageModel: string; setCodexImageModel: (v: string) => void
}

// Settings ▸ Agents (D-071, D-072, D-078; reworked for 2.4). One compact row per agent —
// tile, name, status, on/off — that opens to its details: which models the picker shows
// (plus Add model, which writes the "More models" lines), Codex's image model, and for
// user-added agents the command with Edit / Remove.
export default function AgentsTab({ offAgents, toggleAgent, offModels, toggleModel, agentStatus, onAgentStatus, lists, extraModels, setExtraModelsText, codexImageModel, setCodexImageModel }: Props) {
  const [setupFor, setSetupFor] = useState<BuiltinProviderId | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<CustomAgent | null>(null)
  const [open, setOpen] = useState<ProviderId | null>(null)
  const [newModel, setNewModel] = useState('')
  useAgentList()   // re-render when an agent is added or removed
  const ids = agentIds()
  const typed = parseExtraModels(extraModels)

  const remove = async (a: CustomAgent) => {
    if (!(await confirmDialog({ title: `Remove ${a.name}?`, message: 'It leaves your pickers; past messages keep its name.', confirmLabel: 'Remove' }))) return
    setOpen(null)
    await api.customAgents.remove(a.id)
  }
  const addModel = (id: ProviderId) => {
    const next = addExtraModel(extraModels, id, newModel)
    if (next !== extraModels) setExtraModelsText(next)
    setNewModel('')
  }

  return (
    <Stack>
      {setupFor && (
        <Modal title={`Set up ${agentEntry(setupFor).label}`} onClose={() => setSetupFor(null)}>
          <AgentSetupCard id={setupFor} status={agentStatus[setupFor]} onStatus={onAgentStatus} />
        </Modal>
      )}
      {(adding || editing) && <AddAgentModal editing={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null) }} />}

      <Section title="Agents" actions={<Button size="sm" onClick={() => setAdding(true)}><Icon name="plus" size="xs" /> Add agent</Button>}>
        <Field hint="Off agents leave every picker; at least one stays on. Open an agent to choose the models its picker shows.">
          <div className="settings-group agents-list" role="list" aria-label="Agents">
            {ids.map((id) => {
              const e = agentEntry(id)
              const custom = customAgentFor(id)
              const on = !offAgents.includes(id)
              const last = on && ids.length - offAgents.length === 1
              const av = agentStatus[id]
              const ready = !!av && av.installed && av.authenticated
              const status = !on ? 'Off' : !av ? 'Checking…' : !av.installed ? (custom ? `${custom.bin} not found` : 'Not installed') : av.authenticated ? 'Ready' : 'Signed out'
              const tone = !on || !av ? '' : ready ? 'ok' : 'warn'
              const models = allPresetsFor(id, lists).filter((m) => m.v)
              const shown = models.filter((m) => !offModels.has(modelKey(id, m.v))).length
              const isOpen = open === id && on
              const canSetUp = isBuiltinId(id) && !!av && !ready && on
              return (
                <div key={id} role="listitem" className={`agent-item${on ? '' : ' off'}${isOpen ? ' open' : ''}`}>
                  <div className="agent-head">
                    <button type="button" className="agent-head-main" aria-expanded={isOpen} disabled={!on} onClick={() => { setOpen(isOpen ? null : id); setNewModel('') }}>
                      <ProviderAvatar id={id} size="lg" />
                      <span className="settings-row-text">
                        <span className="settings-row-title">
                          {e.label} <span className="settings-row-handle">@{e.handle}</span>
                          {custom && <Badge className="agent-tag" title="Shows replies only. Live tool steps and cost aren't available for this agent.">Basic</Badge>}
                        </span>
                        <span className={`settings-row-sub ${tone}`}>
                          {status}{on && ready ? ` · ${shown + 1} model${shown ? 's' : ''}` : ''}
                        </span>
                      </span>
                    </button>
                    {canSetUp && <Button size="sm" onClick={() => setSetupFor(id as BuiltinProviderId)}>Set up</Button>}
                    <button type="button" className="agent-chevron-btn" aria-label={isOpen ? `Close ${e.label} details` : `Open ${e.label} details`} disabled={!on} onClick={() => { setOpen(isOpen ? null : id); setNewModel('') }}>
                      {on && <Icon name="chevron-down" size="sm" className="agent-chevron" />}
                    </button>
                    <Switch on={on} disabled={last} label={`${e.label} ${on ? 'on' : 'off'}`} title={last ? 'At least one agent must stay on' : undefined} onChange={(v) => { toggleAgent(id, v); if (!v && open === id) setOpen(null) }} />
                  </div>

                  {isOpen && (
                    <div className="agent-body">
                      <div className="agent-body-label">Models in the picker</div>
                      <div className="settings-models" role="group" aria-label={`${e.label} models`}>
                        <span className="model-chip locked" title="The agent's own default model is always available">Default</span>
                        {models.map((m) => {
                          const key = modelKey(id, m.v)
                          const mOn = !offModels.has(key)
                          const isTyped = (typed[id] ?? []).some((t) => t.v === m.v)
                          return (
                            <span key={key} className={`model-chip-wrap${isTyped ? ' typed' : ''}`}>
                              <button type="button" className={`model-chip${mOn ? ' on' : ''}`} aria-pressed={mOn} title={`${m.v}${m.note ? ` — ${m.note}` : ''}\n${mOn ? `Hide ${m.l} from the model picker` : `Show ${m.l} in the model picker`}`} onClick={() => toggleModel(key, !mOn)}>
                                <Icon name={mOn ? 'check' : 'close'} size="xs" />{m.l}{m.note && <span className="model-chip-note"> · retiring</span>}
                              </button>
                              {isTyped && <button type="button" className="model-chip-remove" aria-label={`Remove ${m.l}`} title={`Remove ${m.l}`} onClick={() => setExtraModelsText(removeExtraModel(extraModels, id, m.v))}><Icon name="close" size="xs" /></button>}
                            </span>
                          )
                        })}
                      </div>
                      {custom && !custom.modelFlag
                        ? <p className="agent-body-hint">This agent has no model flag, so it always uses its own default. Set one in Edit to pick models here.</p>
                        : (
                          <form className="agent-add-model" onSubmit={(ev) => { ev.preventDefault(); addModel(id) }}>
                            <input className="field-input mono" placeholder={id === 'claude-code' ? 'haiku' : custom?.presetId === 'opencode' ? 'provider/model, e.g. opencode/big-pickle' : custom ? 'model id' : 'model-id'} value={newModel} onChange={(ev) => setNewModel(ev.target.value)} aria-label={`Add a ${e.label} model`} />
                            <Button size="sm" type="submit" disabled={!newModel.trim()}>Add model</Button>
                          </form>
                        )}
                      {(id === 'codex' || id === 'gemini') && models.length === 0 && <p className="agent-body-hint">Model list not found — run {e.cli} once, or add models above.</p>}

                      {id === 'codex' && (
                        <Field label="Image model" htmlFor="codex-image-model" hint="Used on the Image canvas.">
                          <input id="codex-image-model" className="field-input mono" placeholder="gpt-5.6-sol (default)" value={codexImageModel} onChange={(ev) => setCodexImageModel(ev.target.value)} />
                        </Field>
                      )}

                      {custom && (
                        <div className="agent-custom">
                          <div className="agent-body-label">Command</div>
                          <code className="agent-command">{custom.command}</code>
                          <div className="agent-custom-actions">
                            <Button size="sm" onClick={() => setEditing(custom)}><Icon name="edit" size="xs" /> Edit</Button>
                            {custom.presetId && presetRecipe(custom.presetId)?.signIn && (
                              <Button size="sm" title={`Opens Terminal and runs: ${presetRecipe(custom.presetId)!.signIn!.cmd} — sign in or add an API key there`} onClick={() => api.agents.setupStart(custom.presetId!, 'signIn', true)}>Sign in / API key…</Button>
                            )}
                            <Button variant="ghost" size="sm" danger onClick={() => remove(custom)}>Remove</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Field>
      </Section>
    </Stack>
  )
}
