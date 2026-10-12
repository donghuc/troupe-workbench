import Switch from './Switch'
import { Stack, Field, Section } from '../Form'
import { PROVIDERS, PROVIDER_IDS } from '../../../../shared/providers'
import { allPresetsFor, modelKey, type ModelLists } from '../../../../shared/models'
import { MODES, MODE_IDS, type ModeTemplates } from '../../../../shared/modes'
import type { ProviderId } from '../../../../shared/types'
import type { Dispatch, SetStateAction } from 'react'

interface Props {
  thinkAgent: ProviderId; setThinkAgent: (v: ProviderId) => void
  thinkModel: string; setThinkModel: (v: string) => void
  compareAuto: boolean; setCompareAuto: (v: boolean) => void
  modeTpl: ModeTemplates; setModeTpl: Dispatch<SetStateAction<ModeTemplates>>
  offAgents: ProviderId[]; offModels: Set<string>; lists: ModelLists
}

// Settings ▸ Thinking (D-081, D-083): the drafting agent, Compare, and thinking-mode casts.
export default function ThinkingTab({ thinkAgent, setThinkAgent, thinkModel, setThinkModel, compareAuto, setCompareAuto, modeTpl, setModeTpl, offAgents, offModels, lists }: Props) {
  const models = allPresetsFor(thinkAgent, lists).filter((m) => !m.v || !offModels.has(modelKey(thinkAgent, m.v)))
  const agentsOn = PROVIDER_IDS.filter((id) => !offAgents.includes(id))
  return (
    <Stack>
      <Section title="Drafting agent">
      <Field hint={offAgents.includes(thinkAgent) ? "This agent is switched off; Troupe will use the chat's agent instead." : undefined}>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Agent</div>
            <div className="settings-row-sub">Writes Compare cards and drafts saved outcomes.</div>
          </div>
          <select className="field-input field-inline" value={thinkAgent} onChange={(e) => { setThinkAgent(e.target.value as ProviderId); setThinkModel('') }}>
            {agentsOn.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Model</div>
          </div>
          <select className="field-input field-inline" value={thinkModel} onChange={(e) => setThinkModel(e.target.value)}>
            {models.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </div>
      </div>
      </Field>
      </Section>
      <Section title="Compare">
      <Field>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-title">Compare automatically after @all</div>
            <div className="settings-row-sub">A card after every @all: verdict, where agents agree and disagree, replies folded beneath. Off: a Compare button instead.</div>
          </div>
          <Switch on={compareAuto} label="Compare automatically" onChange={setCompareAuto} />
        </div>
      </div>
      </Field>
      </Section>
      <Section title="Thinking modes">
      <Field hint="Start with @debate, @critique or @research. An agent that is off is replaced by the first one on. Each role’s rules are the “Mode:” skills.">
      <Stack tight>
      {MODE_IDS.map((id) => {
        const def = MODES[id]; const tpl = modeTpl[id]
        const setRole = (key: string, pid: ProviderId) => setModeTpl((cur) => ({ ...cur, [id]: { ...cur[id], roles: { ...cur[id].roles, [key]: pid } } }))
        return (
          <div key={id} className="settings-group mode-group">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-title">{def.label}</div>
                <div className="settings-row-sub">{def.description}</div>
              </div>
              {def.rounds && (
                <label className="mode-rounds">Rounds
                  <select className="field-input field-inline field-narrow" value={tpl.rounds ?? def.rounds.default} onChange={(e) => setModeTpl((cur) => ({ ...cur, [id]: { ...cur[id], rounds: Number(e.target.value) } }))}>
                    {Array.from({ length: def.rounds.max - def.rounds.min + 1 }, (_, i) => def.rounds!.min + i).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
            </div>
            {def.roles.map((r) => (
              <div key={r.key} className="settings-row mode-role-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">{r.label}</div>
                  <div className="settings-row-sub">{r.hint}</div>
                </div>
                <select className="field-input field-inline" value={tpl.roles[r.key]} onChange={(e) => setRole(r.key, e.target.value as ProviderId)}>
                  {PROVIDER_IDS.map((pid) => <option key={pid} value={pid}>{PROVIDERS[pid].label}{offAgents.includes(pid) ? ' (off)' : ''}</option>)}
                </select>
              </div>
            ))}
          </div>
        )
      })}
      </Stack>
      </Field>
      </Section>
    </Stack>
  )
}
