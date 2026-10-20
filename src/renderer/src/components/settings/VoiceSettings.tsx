import { useEffect, useState } from 'react'
import Icon from '../Icon'
import { Field, Section } from '../Form'
import { Button } from '../ui/Button'
import { Segmented } from '../ui/Segmented'
import { api } from '../../api'
import { failed, reportError } from '../../notices'
import { confirmDialog } from '../ui/ConfirmDialog'
import { OS_WORDS } from '../../../../shared/platform'
import { VOICE_LANGUAGES, formatMb, type VoiceModelId, type VoiceStatus, type VoiceDownloadEvent } from '../../../../shared/voice'
import { refreshVoiceStatus, VOICE_SHORTCUT_LABEL } from '../../voice'

// Settings ▸ Tools ▸ Voice (D-124). Applies at once, like downloading a model: the choice of
// model and language isn't held for the Settings Save button.
export default function VoiceSettings() {
  const [st, setSt] = useState<VoiceStatus | null>(null)
  const [progress, setProgress] = useState<Partial<Record<VoiceModelId, number>>>({})

  useEffect(() => {
    void refreshVoiceStatus().then(setSt).catch(() => setSt(null))
    return api.voice.onEvent((e: VoiceDownloadEvent) => {
      if (e.state === 'downloading') setProgress((p) => ({ ...p, [e.id]: e.received }))
      else {
        setProgress((p) => { const n = { ...p }; delete n[e.id]; return n })
        void refreshVoiceStatus().then(setSt).catch(() => {})
        if (e.state === 'error') reportError('Download voice model', e.error ?? 'Failed.')
      }
    })
  }, [])

  if (!st) return null
  const setPrefs = (p: { model?: VoiceModelId; language?: string }) =>
    api.voice.setPrefs(p).then((s: VoiceStatus) => { setSt(s); void refreshVoiceStatus() }).catch(failed('Save voice settings'))
  const download = (id: VoiceModelId) => {
    setSt({ ...st, models: st.models.map((m) => (m.id === id ? { ...m, downloading: true } : m)) })
    api.voice.download(id).catch(() => { /* reported through the download event */ })
  }
  const remove = async (id: VoiceModelId, label: string) => {
    if (!(await confirmDialog({ title: `Remove the ${label} model?`, message: 'Voice input uses another downloaded model, or asks you to download one.', confirmLabel: 'Remove' }))) return
    await api.voice.remove(id).catch(failed('Remove voice model'))
    setSt(await refreshVoiceStatus())
  }

  return (
    <Section title="Voice">
      <Field hint={`Click the mic in the message box or press ${VOICE_SHORTCUT_LABEL}; press again to stop, Esc to discard. Speech is turned into text on this ${OS_WORDS.computer} — only the model is downloaded, once.${st.backend === 'gpu' ? ' Runs on the graphics card.' : st.backend === 'cpu' ? ' Runs on the processor (no usable graphics card found), so larger models are slow.' : ''}`}>
        <div className="settings-group" role="group" aria-label="Voice models">
          {st.models.map((m) => {
            const got = progress[m.id] ?? m.received
            const pct = m.bytes ? Math.min(100, Math.round((got / m.bytes) * 100)) : 0
            return (
              <div key={m.id} className="settings-row voice-model-row">
                <div className="settings-row-text">
                  <div className="settings-row-title">
                    {m.label} <span className="voice-model-size">· {formatMb(m.bytes)}</span>
                    {st.active === m.id && <span className="voice-model-inuse"><Icon name="check" size="xs" /> In use</span>}
                  </div>
                  {m.downloading
                    ? <>
                        <div className="settings-row-sub">Downloading {formatMb(got)} of {formatMb(m.bytes)}</div>
                        <div className="voice-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${m.label} model download`}><span style={{ width: `${pct}%` }} /></div>
                      </>
                    : <div className="settings-row-sub">{m.note}{speedNote(m.secPer20s, m.id, st.backend)}</div>}
                </div>
                {m.downloading
                  ? <Button size="sm" onClick={() => api.voice.cancelDownload(m.id).catch(failed('Cancel download'))}>Cancel</Button>
                  : m.installed
                    ? <Button size="sm" danger onClick={() => void remove(m.id, m.label)}><Icon name="trash" size="sm" /> Remove</Button>
                    : <Button size="sm" onClick={() => download(m.id)}><Icon name="download" size="sm" /> Download</Button>}
              </div>
            )
          })}
        </div>
      </Field>
      <Field label="Use" hint={st.models.find((m) => m.id === st.selected)?.installed ? undefined : 'Not downloaded yet — voice input uses another downloaded model until then.'}>
        <Segmented size="sm" label="Voice model" value={st.selected} onChange={(v) => void setPrefs({ model: v })}
          options={st.models.map((m) => ({ value: m.id, label: m.label }))} />
      </Field>
      <Field label="Language" htmlFor="voice-lang" hint="Also on the chip next to the mic, so switching between two languages is one click.">
        <select id="voice-lang" className="collab-kind-sel voice-lang" value={st.language} onChange={(e) => void setPrefs({ language: e.target.value })}>
          {VOICE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Field>
    </Section>
  )
}

/** "· about 4 s per 20 s of speech here", once this computer has used the model. */
function speedNote(sec: number | null, id: string, backend: VoiceStatus['backend']): string {
  if (sec !== null) return ` · about ${sec} s per 20 s of speech on this ${OS_WORDS.computer}`
  if (id === 'turbo' && backend === 'cpu') return ' · slow without a graphics card'
  return ''
}
