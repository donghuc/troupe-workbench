import { useState } from 'react'
import ProviderAvatar from '../ProviderAvatar'
import Modal from '../Modal'
import AgentSetupCard from '../AgentSetupCard'
import Icon from '../Icon'
import Switch from './Switch'
import { Stack, Field, Section } from '../Form'
import { PROVIDERS, PROVIDER_IDS } from '../../../../shared/providers'
import { allPresetsFor, modelKey, type ModelLists } from '../../../../shared/models'
import type { ProviderId } from '../../../../shared/types'

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

// Settings ▸ Agents (D-071, D-072, D-078): agents on/off, which models show, extra models.
export default function AgentsTab({ offAgents, toggleAgent, offModels, toggleModel, agentStatus, onAgentStatus, lists, extraModels, setExtraModelsText, codexImageModel, setCodexImageModel }: Props) {
  // 2.3: agents that aren't Ready get Set up, which opens the same card the Welcome uses.
  const [setupFor, setSetupFor] = useState<ProviderId | null>(null)
  return (
    <Stack>
      {setupFor && (
        <Modal title={`Set up ${PROVIDERS[setupFor].label}`} onClose={() => setSetupFor(null)}>
          <AgentSetupCard id={setupFor} status={agentStatus[setupFor]} onStatus={onAgentStatus} />
        </Modal>
      )}
      <Section title="Agents">
      <Field hint="Off agents leave every picker; at least one stays on. Click a model to hide or show it.">
      <div className="settings-group" role="group" aria-label="Agents">
        {PROVIDER_IDS.map((id) => {
          const on = !offAgents.includes(id)
          const last = on && PROVIDER_IDS.length - offAgents.length === 1
          const av = agentStatus[id]
          const status = !av ? 'Checking…' : !av.installed ? 'Not installed' : av.authenticated ? 'Ready' : 'Signed out'
          const tone = !av ? '' : !av.installed || !av.authenticated ? 'warn' : 'ok'
          return (
            <div key={id} className={`settings-row${on ? '' : ' off'}`}>
              <ProviderAvatar id={id} size={28} />
              <div className="settings-row-text">
                <div className="settings-row-title">{PROVIDERS[id].label} <span className="settings-row-handle">@{PROVIDERS[id].handle}</span></div>
                <div className={`settings-row-sub ${tone}`}>{on ? status : 'Off'}</div>
              </div>
              {av && (!av.installed || !av.authenticated) && <button className="btn btn-sm" onClick={() => setSetupFor(id)}>Set up</button>}
              <Switch on={on} disabled={last} label={`${PROVIDERS[id].label} ${on ? 'on' : 'off'}`} title={last ? 'At least one agent must stay on' : undefined} onChange={(v) => toggleAgent(id, v)} />
              {on && (() => {
                // Models this agent offers (D-072): its presets or own newest few, plus the "More models" lines as currently typed (D-078).
                const models = allPresetsFor(id, lists).filter((m) => m.v)
                return (
                  <div className="settings-models" role="group" aria-label={`${PROVIDERS[id].label} models`}>
                    <span className="model-chip locked" title="The agent's own default model is always available">Default</span>
                    {models.map((m) => {
                      const key = modelKey(id, m.v)
                      const mOn = !offModels.has(key)
                      return (
                        <button key={key} type="button" className={`model-chip${mOn ? ' on' : ''}`} aria-pressed={mOn} title={`${m.v}${m.note ? ` — ${m.note}` : ''}\n${mOn ? `Hide ${m.l} from the model picker` : `Show ${m.l} in the model picker`}`} onClick={() => toggleModel(key, !mOn)}>
                          <Icon name={mOn ? 'check' : 'close'} size={11} />{m.l}{m.note && <span className="model-chip-note"> · retiring</span>}
                        </button>
                      )
                    })}
                    {models.length === 0 && <span className="settings-models-empty">{id === 'codex' || id === 'gemini' ? `Model list not found — run ${PROVIDERS[id].cli} once, or add models below.` : 'Default model only — add more below.'}</span>}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
      </Field>
      <Field label="More models" htmlFor="extra-models" hint={<>Each agent lists its three newest models. Add more, one per line: <code>agent: model-id</code> or <code>agent: model-id | Label</code> (agent: {PROVIDER_IDS.map((pid) => PROVIDERS[pid].handle).join(', ')}).</>}>
        <textarea id="extra-models" className="field-input mono" rows={4} placeholder={'claude: haiku | Haiku\ncodex: gpt-5.5 | GPT-5.5'} value={extraModels} onChange={(e) => setExtraModelsText(e.target.value)} />
      </Field>
      </Section>
      <Section title={`Codex${offAgents.includes('codex') ? ' · off' : ''}`} dim={offAgents.includes('codex')}>
        <fieldset className="settings-fieldset" disabled={offAgents.includes('codex')}>
          <Field label="Image model" htmlFor="codex-image-model">
            <input id="codex-image-model" className="field-input mono" placeholder="gpt-5.6-sol (default)" value={codexImageModel} onChange={(e) => setCodexImageModel(e.target.value)} />
          </Field>
        </fieldset>
      </Section>
    </Stack>
  )
}
