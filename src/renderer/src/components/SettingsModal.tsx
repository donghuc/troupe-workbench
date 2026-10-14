import { Button } from './ui/Button'
import { useEffect, useMemo, useState } from 'react'
import { setExtraModels, setAutoModels } from '../models'
import { saveDisabledAgents, saveDisabledModels, refreshAgentStatus } from '../agents'
import { parseExtraModels, modelListFor, EXTRA_MODELS_SETTING, type ModelLists, parseDisabledModels, DISABLED_MODELS_SETTING } from '../../../shared/models'
import { agentIds, BUILTIN_IDS, parseDisabledAgents, DISABLED_AGENTS_SETTING, CHROME_ACCESS_SETTING } from '../../../shared/providers'
import type { ProviderId } from '../../../shared/types'
import Modal from './Modal'
import ToolsSettings from './ToolsSettings'
import ImageSettings from './ImageSettings'
import { Stack, Field } from './Form'
import { SETTINGS_SAVED_EVENT, reportError } from '../notices'
import { MCP_OFF_SETTING, parseMcpOff } from '../../../shared/projectMcp'
import { THINKING_AGENT_SETTING, THINKING_MODEL_SETTING, COMPARE_AUTO_SETTING } from '../../../shared/thinking'
import { MODES_SETTING, parseModeTemplates, type ModeTemplates } from '../../../shared/modes'
import Icon from './Icon'
import AgentsTab from './settings/AgentsTab'
import ThinkingTab from './settings/ThinkingTab'
import { CommandsTab, AboutTab } from './settings/InfoTabs'
import { api } from '../api'
import {
  applyAppearance, DEFAULT_CHAT_FONT, MIN_CHAT_FONT, MAX_CHAT_FONT, DEFAULT_ARTIFACT_FONT, MIN_ARTIFACT_FONT, MAX_ARTIFACT_FONT, clampArtifactFont, type ThemeChoice
} from '../appearance'

const THEMES: { v: ThemeChoice; l: string }[] = [
  { v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }
]

export type Tab = 'general' | 'appearance' | 'conversations' | 'agents' | 'tools' | 'image' | 'thinking' | 'commands' | 'about'
const TABS: { v: Tab; l: string; icon: 'settings' | 'image' | 'copy' | 'flash' | 'grid' | 'memory' | 'file' | 'info' }[] = [
  { v: 'general', l: 'General', icon: 'settings' },
  { v: 'appearance', l: 'Appearance', icon: 'image' },
  { v: 'conversations', l: 'Conversations', icon: 'copy' },
  { v: 'agents', l: 'Agents', icon: 'flash' },
  { v: 'tools', l: 'Tools', icon: 'grid' },
  { v: 'image', l: 'Image', icon: 'image' },
  { v: 'thinking', l: 'Thinking', icon: 'memory' },
  { v: 'commands', l: 'Commands', icon: 'file' },
  { v: 'about', l: 'About', icon: 'info' }
]

export default function SettingsModal({ onClose, initialTab = 'general' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [mcpOff, setMcpOff] = useState<string[]>([])   // D-077: global MCP on/off
  const [thinkAgent, setThinkAgent] = useState<ProviderId>('claude-code')   // D-081
  const [thinkModel, setThinkModel] = useState('')
  const [compareAuto, setCompareAuto] = useState(true)
  const [modeTpl, setModeTpl] = useState<ModeTemplates>(() => parseModeTemplates(null))   // D-083
  const [threshold, setThreshold] = useState('20')
  const [runTimeout, setRunTimeout] = useState('15')
  const [idleWarn, setIdleWarn] = useState('5')
  const [webAccess, setWebAccess] = useState(true)
  const [shellAccess, setShellAccess] = useState(true)
  const [chromeAccess, setChromeAccess] = useState(false)
  const [extraModels, setExtraModelsText] = useState('')   // global "More models" (D-078)
  const [autoLists, setAutoLists] = useState<ModelLists>({})   // each agent's own list (D-076, D-079)
  const [codexImageModel, setCodexImageModel] = useState('')
  const [globalInstr, setGlobalInstr] = useState('')
  const [theme, setTheme] = useState<ThemeChoice>('system')
  const [font, setFont] = useState(DEFAULT_CHAT_FONT)
  const [artifactFont, setArtifactFont] = useState(DEFAULT_ARTIFACT_FONT)
  const [saved, setSaved] = useState<{ theme: ThemeChoice; font: number; artifactFont: number }>({ theme: 'system', font: DEFAULT_CHAT_FONT, artifactFont: DEFAULT_ARTIFACT_FONT })
  const [offAgents, setOffAgents] = useState<ProviderId[]>([])
  const [offModels, setOffModels] = useState<Set<string>>(new Set())
  const toggleModel = (key: string, on: boolean) => setOffModels((cur) => { const n = new Set(cur); if (on) n.delete(key); else n.add(key); return n })
  const [agentStatus, setAgentStatus] = useState<Partial<Record<ProviderId, { installed: boolean; authenticated: boolean }>>>({})
  const toggleAgent = (id: ProviderId, on: boolean) => setOffAgents((cur) => {
    const next = on ? cur.filter((x) => x !== id) : [...cur, id]
    return next.length >= agentIds().length ? cur : next   // at least one agent stays on
  })

  useEffect(() => {
    api.settings.get('compaction_threshold').then((v: string | null) => { if (v) setThreshold(v) })
    api.settings.get('run_timeout_min').then((v: string | null) => { if (v) setRunTimeout(v) })
    api.settings.get('run_idle_warn_min').then((v: string | null) => { if (v) setIdleWarn(v) })
    refreshAgentStatus().then((st) => setAgentStatus(st)).catch(() => {})
    api.settings.get(DISABLED_MODELS_SETTING).then((v: string | null) => setOffModels(parseDisabledModels(v)))
    api.settings.get(DISABLED_AGENTS_SETTING).then((v: string | null) => setOffAgents(parseDisabledAgents(v)))
    api.settings.get(MCP_OFF_SETTING).then((v: string | null) => setMcpOff(parseMcpOff(v)))
    api.settings.get(THINKING_AGENT_SETTING).then((v: string | null) => { if (v && agentIds().includes(v as ProviderId)) setThinkAgent(v as ProviderId) })
    api.settings.get(THINKING_MODEL_SETTING).then((v: string | null) => setThinkModel(v ?? ''))
    api.settings.get(COMPARE_AUTO_SETTING).then((v: string | null) => setCompareAuto(v !== '0'))
    api.settings.get(MODES_SETTING).then((v: string | null) => setModeTpl(parseModeTemplates(v)))
    api.settings.get('agent_web_access').then((v: string | null) => setWebAccess(v !== '0'))
    api.settings.get('agent_shell_access').then((v: string | null) => setShellAccess(v !== '0'))
    api.settings.get(CHROME_ACCESS_SETTING).then((v: string | null) => setChromeAccess(v === '1'))
    api.settings.get(EXTRA_MODELS_SETTING).then((v: string | null) => setExtraModelsText(v ?? ''))
    api.system.autoModels().then((l: ModelLists) => { setAutoLists(l); setAutoModels(l) }).catch(() => {})
    api.settings.get('codex_image_model').then((v: string | null) => setCodexImageModel(v ?? ''))
    api.settings.get('global_instructions').then((v: string | null) => setGlobalInstr(v ?? ''))
    Promise.all([api.settings.get('theme'), api.settings.get('chat_font_px'), api.settings.get('artifact_font_px')]).then(([t, f, a]) => {
      const th = (t === 'light' || t === 'dark' || t === 'system' ? t : 'system') as ThemeChoice
      const fn = Number(f) || DEFAULT_CHAT_FONT
      const af = clampArtifactFont(Number(a))
      setTheme(th); setFont(fn); setArtifactFont(af); setSaved({ theme: th, font: fn, artifactFont: af })
    })
  }, [])

  // Each agent's models: its own list plus the "More models" lines as currently typed (D-078).
  const lists = useMemo<ModelLists>(() => {
    const typed = parseExtraModels(extraModels)
    return { ...typed, codex: modelListFor(autoLists.codex ?? [], typed.codex), gemini: modelListFor(autoLists.gemini ?? [], typed.gemini) }
  }, [extraModels, autoLists])

  const pickTheme = (t: ThemeChoice) => { setTheme(t); applyAppearance(t, font, artifactFont) }
  const pickFont = (n: number) => { setFont(n); applyAppearance(theme, n, artifactFont) }
  const pickArtifactFont = (n: number) => { setArtifactFont(n); applyAppearance(theme, font, n) }

  // Save keeps the window open (Hien, 2026-09-25): the button confirms "Saved", and the
  // secondary button becomes Close — what's on screen is now the saved state.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedOnce, setSavedOnce] = useState(false)
  const save = async () => {
    setSaveState('saving')
    try {
    await api.settings.set('compaction_threshold', String(Math.max(2, Number(threshold) || 20)))
    await api.settings.set('run_timeout_min', String(Math.max(0, Number(runTimeout) || 0)))
    await api.settings.set('run_idle_warn_min', String(Math.max(0, Number(idleWarn) || 0)))
    await saveDisabledAgents(offAgents)
    await saveDisabledModels(offModels)
    await api.settings.set(MCP_OFF_SETTING, JSON.stringify([...mcpOff].sort()))
    await api.settings.set(THINKING_AGENT_SETTING, thinkAgent)
    await api.settings.set(THINKING_MODEL_SETTING, thinkModel)
    await api.settings.set(COMPARE_AUTO_SETTING, compareAuto ? '1' : '0')
    await api.settings.set(MODES_SETTING, JSON.stringify(modeTpl))
    await api.settings.set('agent_web_access', webAccess ? '1' : '0')
    await api.settings.set('agent_shell_access', shellAccess ? '1' : '0')
    await api.settings.set(CHROME_ACCESS_SETTING, chromeAccess ? '1' : '0')
    await api.settings.set(EXTRA_MODELS_SETTING, extraModels)
    await api.settings.set('codex_image_model', codexImageModel.trim())
    setExtraModels(extraModels) // update the live picker lists immediately
    await api.settings.set('global_instructions', globalInstr)
    await api.settings.set('theme', theme)
    await api.settings.set('chat_font_px', String(font))
    await api.settings.set('artifact_font_px', String(artifactFont))
    window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT))   // side panels refresh what's active (D-077)
    setSaved({ theme, font, artifactFont })   // Close no longer reverts the appearance just saved
    setSavedOnce(true)
    setSaveState('saved')
    setTimeout(() => setSaveState((st) => (st === 'saved' ? 'idle' : st)), 1600)
    } catch (e) { setSaveState('idle'); reportError('Save settings', e) }
  }
  const cancel = () => { applyAppearance(saved.theme, saved.font, saved.artifactFont); onClose() }

  return (
    <Modal title="Settings" wide onClose={cancel} footer={<>
      <Button onClick={cancel}>{savedOnce ? 'Close' : 'Cancel'}</Button>
      <Button variant="primary" onClick={save} disabled={saveState === 'saving'}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? <><Icon name="check" size="sm" /> Saved</> : 'Save'}</Button>
    </>}>
      <div className="settings-tabs">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.v} className={tab === t.v ? 'active' : ''} onClick={() => setTab(t.v)}>
              <Icon name={t.icon} size="md" /> {t.l}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          {tab === 'general' && (
            <Stack>
              <Field label="Global instructions" htmlFor="global-instr">
                <textarea
                  id="global-instr"
                  className="global-instr-input"
                  value={globalInstr}
                  placeholder={'Applies to every project — how you want agents to behave across all of your work.'}
                  onChange={(e) => setGlobalInstr(e.target.value)}
                />
              </Field>
            </Stack>
          )}

          {tab === 'appearance' && (
            <Stack>
              <Field label="Theme">
                <div className="seg-control">
                  {THEMES.map((t) => (
                    <button key={t.v} className={`seg-btn ${theme === t.v ? 'active' : ''}`} onClick={() => pickTheme(t.v)}>{t.l}</button>
                  ))}
                </div>
              </Field>
              <Field label={`Chat font size — ${font}px`} htmlFor="chat-font">
                <input id="chat-font" className="field-range" type="range" min={MIN_CHAT_FONT} max={MAX_CHAT_FONT} step={1} value={font} onChange={(e) => pickFont(Number(e.target.value))} />
              </Field>
              <Field label={`Artifact viewer font size — ${artifactFont}px`} htmlFor="artifact-font" hint="Markdown, text, CSV and JSON. HTML, PDF and images keep their own size.">
                <input id="artifact-font" className="field-range" type="range" min={MIN_ARTIFACT_FONT} max={MAX_ARTIFACT_FONT} step={1} value={artifactFont} onChange={(e) => pickArtifactFont(Number(e.target.value))} />
              </Field>
            </Stack>
          )}

          {tab === 'conversations' && (
            <Stack>
              <Field label="Auto-compress after N messages" htmlFor="compress-n">
                <input id="compress-n" className="field-input" type="number" min={2} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              </Field>
              <Field label="Stop an agent run after N minutes (0 = never)" htmlFor="run-timeout" hint="Counted from the last output. Collab runs get 3×.">
                <input id="run-timeout" className="field-input" type="number" min={0} value={runTimeout} onChange={(e) => setRunTimeout(e.target.value)} />
              </Field>
              <Field label="Warn after N minutes without output (0 = never)" htmlFor="idle-warn">
                <input id="idle-warn" className="field-input" type="number" min={0} value={idleWarn} onChange={(e) => setIdleWarn(e.target.value)} />
              </Field>
            </Stack>
          )}

          {tab === 'agents' && (
            <AgentsTab offAgents={offAgents} toggleAgent={toggleAgent} offModels={offModels} toggleModel={toggleModel} agentStatus={agentStatus} onAgentStatus={(id, st) => setAgentStatus((p) => ({ ...p, [id]: st }))}
              lists={lists} extraModels={extraModels} setExtraModelsText={setExtraModelsText} codexImageModel={codexImageModel} setCodexImageModel={setCodexImageModel} />
          )}

          {tab === 'tools' && (
            <ToolsSettings agents={BUILTIN_IDS.filter((id) => !offAgents.includes(id))} mcpOff={mcpOff} setMcpOff={setMcpOff}
              webAccess={webAccess} setWebAccess={setWebAccess} shellAccess={shellAccess} setShellAccess={setShellAccess} chromeAccess={chromeAccess} setChromeAccess={setChromeAccess} />
          )}

          {tab === 'thinking' && (
            <ThinkingTab thinkAgent={thinkAgent} setThinkAgent={setThinkAgent} thinkModel={thinkModel} setThinkModel={setThinkModel}
              compareAuto={compareAuto} setCompareAuto={setCompareAuto} modeTpl={modeTpl} setModeTpl={setModeTpl}
              offAgents={offAgents} offModels={offModels} lists={lists} />
          )}

          {tab === 'commands' && <CommandsTab />}

          {tab === 'image' && <ImageSettings />}

          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </Modal>
  )
}
