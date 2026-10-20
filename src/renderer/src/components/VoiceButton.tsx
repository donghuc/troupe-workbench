import { useEffect, useRef, useState, type RefObject } from 'react'
import Icon from './Icon'
import { api } from '../api'
import { notify, openSettings, reportError } from '../notices'
import { cleanTranscript, formatElapsed, VOICE_MAX_SECONDS } from '../../../shared/voice'
import { onVoiceStatus, registerVoiceTarget, startRecording, VOICE_SHORTCUT_LABEL, type Recording } from '../voice'

interface Props {
  /** The composer around this button: focusing it makes the shortcut talk to this button. */
  scope: RefObject<HTMLElement | null>
  /** Called with the transcribed text; the composer inserts it at the caret. Never sends. */
  onText: (text: string) => void
  disabled?: boolean
}

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

// Voice input (D-124): the mic button in the composer. Click (or ⌘⇧Space) to start,
// again to stop; Esc discards. The words land in the composer for you to edit.
export default function VoiceButton({ scope, onText, disabled }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ready, setReady] = useState<boolean | null>(null)   // a model is on disk
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<Recording | null>(null)
  const job = useRef(0)   // bumped by a discard, so a late transcript is dropped
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  useEffect(() => onVoiceStatus((s) => setReady(!!s.active)), [])

  const stopAndTranscribe = async () => {
    const r = rec.current; rec.current = null
    if (!r) return
    setPhase('transcribing')
    const mine = ++job.current
    try {
      const pcm = await r.finish()
      if (pcm.byteLength < 16_000) { notify('That was too short to transcribe.'); return }   // < 0.5 s
      const res = await api.voice.transcribe(pcm)
      const text = cleanTranscript(res.text)
      if (mine !== job.current) return   // discarded meanwhile
      if (text) onTextRef.current(text)
      else notify('No speech was recognised.')
    } catch (e) {
      reportError('Voice input', e)
    } finally {
      if (mine === job.current) setPhase('idle')
    }
  }

  const start = async () => {
    if (ready === false) { openSettings('tools'); notify('Download a voice model in Settings ▸ Tools ▸ Voice first.'); return }
    setPhase('starting')
    try {
      rec.current = await startRecording()
      void api.voice.prepare().catch(() => {})   // the model loads while you talk
      setElapsed(0)
      setPhase('recording')
    } catch (e) {
      setPhase('idle')
      reportError('Voice input', e)
    }
  }

  const toggle = () => {
    const p = phaseRef.current
    if (p === 'idle') { if (!disabled) void start() }
    else if (p === 'recording') void stopAndTranscribe()
  }
  const cancel = (): boolean => {
    const p = phaseRef.current
    if (p === 'recording') { rec.current?.discard(); rec.current = null; setPhase('idle'); return true }
    if (p === 'transcribing') { job.current++; void api.voice.cancel(); setPhase('idle'); return true }
    return false
  }
  const toggleRef = useRef(toggle); toggleRef.current = toggle
  const cancelRef = useRef(cancel); cancelRef.current = cancel

  // The shortcut and Esc reach the composer that was focused last.
  useEffect(() => {
    const reg = registerVoiceTarget({ toggle: () => toggleRef.current(), cancel: () => cancelRef.current() })
    const el = scope.current
    el?.addEventListener('focusin', reg.focus)
    return () => { el?.removeEventListener('focusin', reg.focus); reg.remove(); rec.current?.discard() }
  }, [scope])

  // Recording timer; stops by itself at the 10-minute cap.
  useEffect(() => {
    if (phase !== 'recording') return
    const t0 = Date.now()
    const iv = setInterval(() => {
      const s = (Date.now() - t0) / 1000
      setElapsed(s)
      if (s >= VOICE_MAX_SECONDS) void stopAndTranscribe()
    }, 250)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  if (phase === 'recording' || phase === 'transcribing') {
    const isRec = phase === 'recording'
    return (
      <div className={`voice-pill${isRec ? ' recording' : ''}`} role="group" aria-label="Voice input">
        {isRec ? <span className="voice-dot" aria-hidden="true" /> : <span className="activity-spinner spinner-xs" aria-hidden="true" />}
        <span className="voice-pill-label" aria-live="polite">{isRec ? formatElapsed(elapsed) : 'Transcribing…'}</span>
        {isRec && (
          <button className="voice-pill-btn" onClick={() => void stopAndTranscribe()} title={`Stop and transcribe (${VOICE_SHORTCUT_LABEL})`} aria-label="Stop and transcribe">
            <Icon name="check" size="sm" />
          </button>
        )}
        <button className="voice-pill-btn" onClick={() => cancel()} title="Discard (Esc)" aria-label="Discard recording">
          <Icon name="close" size="sm" />
        </button>
      </div>
    )
  }
  return (
    <button
      className="mic-btn"
      onClick={toggle}
      disabled={disabled || phase === 'starting'}
      title={ready === false ? 'Voice input — download a model in Settings ▸ Tools ▸ Voice' : `Voice input (${VOICE_SHORTCUT_LABEL})`}
      aria-label="Voice input"
    >
      <Icon name="mic" size="md" />
    </button>
  )
}
