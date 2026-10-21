import { useEffect, useRef, useState, type RefObject } from 'react'
import Icon from './Icon'
import { api } from '../api'
import { getDraft, setDraft } from '../drafts'
import { notify, openSettings, reportError } from '../notices'
import { cleanTranscript, formatElapsed, VOICE_MAX_SECONDS, VOICE_LANGUAGES } from '../../../shared/voice'
import { onVoiceStatus, registerVoiceTarget, startRecording, VOICE_SHORTCUT_LABEL, type Recording } from '../voice'

interface Props {
  /** The composer around this button: focusing it makes the shortcut talk to this button. */
  scope: RefObject<HTMLElement | null>
  /** Called with the transcribed text; the composer inserts it at the caret. Never sends. */
  onText: (text: string) => void
  disabled?: boolean
  /** The chat's draft key. A transcription still running when you leave the chat finishes
   *  anyway: the words land in the composer when you come back (or in the chat's draft). */
  owner?: string
}

// Transcriptions in flight, by owner — they outlive the button (switching chats remounts it).
const inFlight = new Map<string, Promise<string>>()
let anon = 0

/** Start transcribing a finished recording for `owner`. If no button for that owner takes the
 *  words when they arrive, they're added to the owner's draft. */
function transcribeFor(owner: string, r: Recording, keepDraft: boolean): Promise<string> {
  const p = (async () => {
    const pcm = await r.finish()
    if (pcm.byteLength < 16_000) throw new Error('too-short')   // < 0.5 s
    return cleanTranscript((await api.voice.transcribe(pcm)).text)
  })()
  inFlight.set(owner, p)
  const orphan = () => setTimeout(() => {   // after any mounted button had its turn
    if (inFlight.get(owner) !== p) return
    inFlight.delete(owner)
    p.then((text) => {
      if (!text || !keepDraft) return
      const cur = getDraft(owner)
      setDraft(owner, cur.trim() ? `${cur.trimEnd()} ${text}` : text)
    }, () => {})
  }, 0)
  p.then(orphan, orphan)
  return p
}

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

// Voice input (D-124): the mic button in the composer. Click (or ⌘⇧Space) to start,
// again to stop; Esc discards. The words land in the composer for you to edit.
export default function VoiceButton({ scope, onText, disabled, owner: ownerProp }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ready, setReady] = useState<boolean | null>(null)   // a model is on disk
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<Recording | null>(null)
  const job = useRef(0)   // bumped by a discard, so a late transcript is dropped
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const owner = useRef(ownerProp ?? `voice-${++anon}`).current
  const mounted = useRef(true)

  const [lang, setLang] = useState('en')
  // Dictation always has a language (never Whisper's guess), set in Settings ▸ Tools ▸ Voice.
  useEffect(() => onVoiceStatus((s) => { setReady(!!s.active); setLang(s.language) }), [])
  const langInfo = VOICE_LANGUAGES.find((l) => l.code === lang) ?? VOICE_LANGUAGES[0]

  // Wait for this owner's transcription and put the words in the composer — also one started
  // before you left the chat and came back.
  const follow = async (p: Promise<string>) => {
    setPhase('transcribing')
    const mine = ++job.current
    try {
      const text = await p
      if (!mounted.current || mine !== job.current || inFlight.get(owner) !== p) return   // gone, discarded or taken
      inFlight.delete(owner)
      if (text) onTextRef.current(text)
      else notify('No speech was recognised.')
    } catch (e) {
      if (!mounted.current || mine !== job.current || inFlight.get(owner) !== p) return
      inFlight.delete(owner)
      if (e instanceof Error && e.message === 'too-short') notify('That was too short to transcribe.')
      else reportError('Voice input', e)
    } finally {
      if (mounted.current && mine === job.current) setPhase('idle')
    }
  }

  const stopAndTranscribe = async () => {
    const r = rec.current; rec.current = null
    if (!r) return
    await follow(transcribeFor(owner, r, !!ownerProp))
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
    if (p === 'transcribing') { job.current++; inFlight.delete(owner); void api.voice.cancel(); setPhase('idle'); return true }
    return false
  }
  const toggleRef = useRef(toggle); toggleRef.current = toggle
  const cancelRef = useRef(cancel); cancelRef.current = cancel

  // The shortcut and Esc reach the composer that was focused last.
  useEffect(() => {
    const reg = registerVoiceTarget({ toggle: () => toggleRef.current(), cancel: () => cancelRef.current() })
    const el = scope.current
    el?.addEventListener('focusin', reg.focus)
    return () => { el?.removeEventListener('focusin', reg.focus); reg.remove() }
  }, [scope])

  // Coming back to a chat whose words are still being transcribed: show it, and take them.
  // Leaving while recording: what you said is transcribed into the chat's draft, not lost.
  useEffect(() => {
    mounted.current = true
    const p = inFlight.get(owner)
    if (p) void follow(p)
    return () => {
      mounted.current = false
      const r = rec.current; rec.current = null
      if (r) { if (ownerProp) void transcribeFor(owner, r, true).catch(() => {}); else r.discard() }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        title={ready === false ? 'Voice input — download a model in Settings ▸ Tools ▸ Voice' : `Voice input in ${langInfo.label} (${VOICE_SHORTCUT_LABEL})`}
        aria-label="Voice input"
      >
        <Icon name="mic" size="md" />
      </button>
  )
}
