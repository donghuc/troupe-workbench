import { Badge } from './ui/Badge'
import { OS_WORDS } from '../../../shared/platform'
import { useEffect, useRef, useState } from 'react'
import type { ProviderInfo, ProviderId, FileNode, Skill } from '../../../shared/types'
import type { PermissionMode } from '../../../shared/agent'
import { matchSkill } from '../skillMatch'
import ProviderAvatar from './ProviderAvatar'
import Modal from './Modal'
import FileTree from './FileTree'
import { api } from '../api'
import Icon from './Icon'
import { presetsFor } from '../models'
import { customAgentFor } from '../agents'
import { MODES, MODE_IDS } from '../../../shared/modes'
import { agentHandles } from '../../../shared/mentions'
import { getDraft, setDraft, getDraftSelections, setDraftSelections, getDraftAttachments, setDraftAttachments } from '../drafts'
import { type SelectionItem, sourceLabel, snippet, composeWithSelections } from '../../../shared/selections'
import { type PendingAttachment, attachmentName, attachmentIsImage } from '../attachments'
import { Menu } from './ui/Menu'
import { Button, IconButton } from './ui/Button'
import VoiceButton from './VoiceButton'
import { hasCollab, stripCollab } from '../collabMention'
import AttachmentsModal from './AttachmentsModal'
import { insertAtCaret } from '../../../shared/voice'

interface Props {
  providers: ProviderInfo[]
  onSend: (text: string, provider: ProviderId, attachments: PendingAttachment[], skillId?: string, model?: string, permMode?: PermissionMode, selections?: SelectionItem[]) => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  defaultProvider?: ProviderId
  folderPath?: string
  enableSkills?: boolean
  defaultModel?: string | null
  defaultPermissionMode?: PermissionMode | null
  onPermissionModeChange?: (mode: PermissionMode) => void
  draftKey?: string
  /** The chat this composer sends to (for its attachment list, D-126). */
  chatId?: string
  busy?: boolean
  onStop?: () => void
  // Text appended to the input, and/or selected passages added as a chip (D-065).
  inject?: { text?: string; selections?: SelectionItem[]; nonce: number }
  onQuickMemory?: (line: string) => void
  onProviderChange?: (id: ProviderId) => void
  onStartCollab?: (goal: string, provider: ProviderId, permMode: PermissionMode, model?: string) => void
  collabAvailable?: boolean
  collabBusy?: boolean
}

const handleFor = (id: ProviderId) => agentHandles().find((a) => a.id === id)?.handle ?? id

const PERM_OPTS: { v: PermissionMode; l: string; d: string }[] = [
  { v: 'read', l: 'Read-only', d: 'No edits, shell, or web' },
  { v: 'auto', l: 'Auto', d: 'Auto-accept edits (default)' },
  { v: 'full', l: 'Full access', d: 'No restrictions' }
]

export default function Composer({ providers, onSend, disabled, placeholder = 'How can I help you today?', autoFocus, defaultProvider, folderPath, enableSkills, defaultModel, defaultPermissionMode, onPermissionModeChange, draftKey, chatId, busy, onStop, inject, onQuickMemory, onProviderChange, onStartCollab, collabAvailable, collabBusy }: Props) {
  const [text, setText] = useState(() => (draftKey ? getDraft(draftKey) : ''))
  const [providerId, setProviderId] = useState<ProviderId>(defaultProvider ?? providers[0]?.id ?? 'claude-code')
  // If the chosen agent is turned off (Settings ▸ Agents, D-071), fall back to the first one that is on.
  useEffect(() => { if (providers.length && !providers.some((p) => p.id === providerId)) setProviderId(providers[0].id) }, [providers, providerId])
  const [model, setModel] = useState<string>(defaultModel ?? '')
  // A remembered model that has since been switched off (D-072) falls back to the agent's default.
  useEffect(() => { if (model && !presetsFor(providerId).some((m) => m.v === model)) setModel('') }, [providers, providerId, model])
  const [attachments, setAttachments] = useState<PendingAttachment[]>(() => (draftKey ? getDraftAttachments(draftKey) : []))
  const [selections, setSelections] = useState<SelectionItem[]>(() => (draftKey ? getDraftSelections(draftKey) : []))
  const [selOpen, setSelOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [picking, setPicking] = useState(false)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [manualSkillId, setManualSkillId] = useState<string | null>(null)
  const [dismissedAutoId, setDismissedAutoId] = useState<string | null>(null)
  const [permMode, setPermModeRaw] = useState<PermissionMode>(defaultPermissionMode ?? 'auto')
  const setPermMode = (m: PermissionMode) => { setPermModeRaw(m); onPermissionModeChange?.(m) }
  // The remembered mode can arrive after mount (app-wide fallback is read async); adopt it.
  useEffect(() => { if (defaultPermissionMode) setPermModeRaw(defaultPermissionMode) }, [defaultPermissionMode])
  const [permOpen, setPermOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [manageAttach, setManageAttach] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pmOpen, setPmOpen] = useState(false)
  // The agent/model menu is rendered in a portal at fixed coordinates so no scrolling
  // ancestor (project home, conversation) clips it and it layers above the side panel.
  const pmBtnRef = useRef<HTMLButtonElement>(null)
  const [pmPos, setPmPos] = useState<{ right: number; bottom: number } | null>(null)
  const togglePm = () => {
    if (pmOpen) { setPmOpen(false); setHovered(null); return }
    const r = pmBtnRef.current?.getBoundingClientRect()
    if (r) setPmPos({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6 })
    setPmOpen(true)
  }
  useEffect(() => {
    if (!pmOpen) return
    const close = () => { setPmOpen(false); setHovered(null) }
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [pmOpen])
  const [hovered, setHovered] = useState<ProviderId | null>(null)
  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (picking && folderPath) api.files.listTree(folderPath).then(setTree) }, [picking, folderPath])
  useEffect(() => {
    if (!enableSkills) return
    const load = () => Promise.all([api.skills.list(), folderPath ? api.skills.list(folderPath) : Promise.resolve([] as Skill[])])
      .then(([g, p]) => setSkills([...g, ...p]))
    load()
    return api.skills.onChanged(load)
  }, [enableSkills, folderPath])
  useEffect(() => { if (draftKey) setDraft(draftKey, text) }, [text, draftKey])
  useEffect(() => { if (draftKey) setDraftSelections(draftKey, selections) }, [selections, draftKey])
  useEffect(() => { if (draftKey) setDraftAttachments(draftKey, attachments) }, [attachments, draftKey])
  useEffect(() => { if (!selections.length) setSelOpen(false) }, [selections.length])
  // Auto-grow the input with content, up to the CSS max-height (then it scrolls).
  useEffect(() => {
    const el = taRef.current; if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [text])
  const lastInject = useRef(0)
  useEffect(() => {
    if (inject && inject.nonce !== lastInject.current) {
      lastInject.current = inject.nonce
      if (inject.text) setText((t) => (t ? t + '\n' : '') + inject.text)
      if (inject.selections?.length) setSelections((cur) => [...cur, ...inject.selections!.filter((n) => !cur.some((c) => c.id === n.id))])
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }, [inject])

  // Keep the parent in step with the provider picker — the context inspector needs
  // it, because memory delivery differs per provider (D-055).
  useEffect(() => { onProviderChange?.(providerId) }, [providerId])
  const provider = providers.find((p) => p.id === providerId)
  // Typing `# something` turns the send into a quick save to project memory (like Claude Code's #).
  const memoryMode = !!onQuickMemory && /^#\s+\S/.test(text)
  // Auto-match a skill from the prompt's text via each skill's trigger keywords,
  // unless the user manually picked one. Shown as a removable chip; removing an
  // auto match suppresses it for the current text (until a different one matches).
  const autoId = enableSkills && !manualSkillId ? matchSkill(text, skills) : null
  const effectiveAutoId = autoId && autoId !== dismissedAutoId ? autoId : null
  const skillId = manualSkillId ?? effectiveAutoId
  const isAutoSkill = !manualSkillId && !!effectiveAutoId
  const activeSkill = skills.find((s) => s.id === skillId) ?? null
  const modelLabel = presetsFor(providerId).find((m) => m.v === model)?.l ?? 'Default'

  const mentionMatches = mentionQuery === null ? [] : providers.filter((p) => {
    const h = handleFor(p.id)
    return h.startsWith(mentionQuery) || p.name.toLowerCase().startsWith(mentionQuery)
  })
  // @all → blind-parallel across every agent.
  const showAllMention = mentionQuery !== null && providers.length > 1 && 'all'.startsWith(mentionQuery)
  // @debate / @critique / @research → a thinking mode (D-083).
  const modeMatches = mentionQuery === null ? [] : MODE_IDS.filter((id) => id.startsWith(mentionQuery))
  const [modesOpen, setModesOpen] = useState(false)
  // @collab → plan & run with several agents (D-129): it replaced the Chat/Collab switch.
  const collabMode = !!onStartCollab && hasCollab(text)
  const collabBlocked = collabMode && (!collabAvailable || !!collabBusy)
  const showCollabMention = !!onStartCollab && mentionQuery !== null && 'collab'.startsWith(mentionQuery)

  const choose = (pid: ProviderId, m: string) => { setProviderId(pid); setModel(m); setPmOpen(false); setHovered(null) }

  // Detect an @token immediately before the caret and open the picker.
  const refreshMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@(\w*)$/)
    if (m) { setMentionQuery(m[2].toLowerCase()); setMentionIndex(0) }
    else setMentionQuery(null)
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
  }

  const insertMention = (id: ProviderId) => {
    const el = taRef.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/(^|\s)@(\w*)$/, `$1@${handleFor(id)} `)
    const after = text.slice(caret)
    const next = before + after
    setText(next)
    setMentionQuery(null)
    requestAnimationFrame(() => { el?.focus(); try { el?.setSelectionRange(before.length, before.length) } catch { /* noop */ } })
  }

  const insertAllMention = (handle = 'all') => {
    const el = taRef.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/(^|\s)@(\w*)$/, `$1@${handle} `)
    const next = before + text.slice(caret)
    setText(next)
    setMentionQuery(null)
    requestAnimationFrame(() => { el?.focus(); try { el?.setSelectionRange(before.length, before.length) } catch { /* noop */ } })
  }

  const submit = () => {
    const t = text.trim()
    const hasSel = selections.length > 0 && !memoryMode
    if ((!t && !hasSel) || disabled || busy) return
    setMentionQuery(null)
    if (memoryMode) { onQuickMemory!(t.replace(/^#\s+/, '')); setText(''); return }
    if (collabMode) {
      if (collabBlocked || !onStartCollab) return
      const goal = stripCollab(t)
      if (!goal && !selections.length) return
      onStartCollab(composeWithSelections(goal, selections), providerId, permMode, model || undefined)
      setText(''); setSelections([])
      return
    }
    onSend(t, providerId, attachments, skillId ?? undefined, model || undefined, permMode, selections.length ? selections : undefined)
    setText(''); setAttachments([]); setSelections([])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && (mentionMatches.length > 0 || showAllMention || modeMatches.length > 0 || showCollabMention)) {
      if (mentionMatches.length > 0 && e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return }
      if (mentionMatches.length > 0 && e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (mentionMatches.length > 0) insertMention(mentionMatches[mentionIndex].id); else if (showAllMention) insertAllMention(); else if (showCollabMention && collabAvailable) insertAllMention('collab'); else if (modeMatches.length) insertAllMention(modeMatches[0]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return }
    }
    // Shift+Enter continues a Markdown list: on a numbered/bulleted line it inserts
    // the next marker; on an empty list item it removes the marker (exits the list).
    if (e.key === 'Enter' && e.shiftKey) {
      const el = taRef.current
      if (el && el.selectionStart === el.selectionEnd) {
        const start = el.selectionStart ?? text.length
        const before = text.slice(0, start)
        const lineStart = before.lastIndexOf('\n') + 1
        const line = before.slice(lineStart)
        const ordered = line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/)
        const unordered = line.match(/^(\s*)([-*+])(\s+)(.*)$/)
        if (ordered || unordered) {
          const content = ordered ? ordered[5] : unordered![4]
          e.preventDefault()
          if (content.trim() === '') {
            // Empty item → end the list: drop the marker, leave an empty line.
            const next = text.slice(0, lineStart) + text.slice(start)
            setText(next)
            requestAnimationFrame(() => { el.focus(); try { el.setSelectionRange(lineStart, lineStart) } catch { /* noop */ } })
          } else {
            const marker = ordered
              ? `${ordered[1]}${parseInt(ordered[2], 10) + 1}${ordered[3]} `
              : `${unordered![1]}${unordered![2]} `
            const insert = '\n' + marker
            const next = before + insert + text.slice(start)
            setText(next)
            const pos = before.length + insert.length
            requestAnimationFrame(() => { el.focus(); try { el.setSelectionRange(pos, pos) } catch { /* noop */ } })
          }
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  // Voice input (D-124): the words go where the caret is, for you to edit; nothing is sent.
  const insertSpoken = (spoken: string) => {
    const el = taRef.current
    const cur = el?.value ?? text
    const r = insertAtCaret(cur, el?.selectionStart ?? cur.length, el?.selectionEnd ?? cur.length, spoken)
    setText(r.text)
    requestAnimationFrame(() => { el?.focus(); try { el?.setSelectionRange(r.caret, r.caret) } catch { /* noop */ } })
  }

  const hasFolder = (rel: string) => attachments.some((a) => a.kind === 'folder' && a.relPath === rel)
  const toggleFolder = (rel: string) =>
    setAttachments((a) => (hasFolder(rel) ? a.filter((x) => !(x.kind === 'folder' && x.relPath === rel)) : [...a, { kind: 'folder', relPath: rel }]))
  const addFiles = (files: FileList | File[]) =>
    setAttachments((a) => [...a, ...Array.from(files).map((f) => ({ kind: 'file', file: f } as PendingAttachment))])
  const removeAt = (i: number) => setAttachments((a) => a.filter((_, idx) => idx !== i))
  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imgs: File[] = []
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (!f) continue
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        imgs.push(f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type }))
      }
    }
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }

  return (
    <div
      ref={rootRef}
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files) }}
    >
      {(attachments.length > 0 || activeSkill || memoryMode || selections.length > 0 || collabMode) && (
        <div className="attach-chips">
          {selections.length > 0 && !memoryMode && (
            <span className="attach-chip sel-chip">
              <button className="sel-chip-btn" onClick={() => setSelOpen((v) => !v)} aria-expanded={selOpen} title="Show the selected passages">
                <Icon name="copy" size="xs" /> {selections.length === 1 ? sourceLabel(selections[0].source) : `${selections.length} selections`}
              </button>
              <button onClick={() => setSelections([])} aria-label="Remove all selections">✕</button>
              {selOpen && (
                <div className="sel-pop" role="dialog" aria-label="Selected passages">
                  {selections.map((s) => (
                    <div key={s.id} className="sel-pop-row">
                      <div className="sel-pop-text">
                        <span className="sel-pop-src">{sourceLabel(s.source)}</span>
                        <span className="sel-pop-snip">“{snippet(s.text)}”</span>
                      </div>
                      <IconButton title="Remove this selection" onClick={() => setSelections((cur) => cur.filter((x) => x.id !== s.id))}>✕</IconButton>
                    </div>
                  ))}
                  <Button variant="link" className="sel-pop-clear" onClick={() => setSelections([])}>Clear all</Button>
                </div>
              )}
            </span>
          )}
          {collabMode && (
            <span className={`attach-chip collab-chip${collabBlocked ? ' blocked' : ''}`}>
              <Icon name="flash" size="xs" /> Collab
              <span className="collab-chip-note"> · {!collabAvailable ? 'needs a project folder' : collabBusy ? 'a run is already active — stop or finish it first' : 'the agents plan it, you approve, then they run it'}</span>
              <button onClick={() => setText((cur) => stripCollab(cur))} aria-label="Turn off Collab">✕</button>
            </span>
          )}
          {memoryMode && <span className="attach-chip mem-chip"><Icon name="memory" size="xs" /> Saving to project memory</span>}
          {activeSkill && (
            <span className="attach-chip skill-chip">⚡ {activeSkill.name}{isAutoSkill && <span className="skill-auto"> · auto</span>}
              <button onClick={() => { if (isAutoSkill) setDismissedAutoId(activeSkill.id); else setManualSkillId(null) }} aria-label="Remove skill">✕</button>
            </span>
          )}
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip"><Icon name={attachmentIsImage(a) ? 'image' : 'file'} size="xs" /> {attachmentName(a)}
              <button onClick={() => removeAt(i)} aria-label="Remove">✕</button>
            </span>
          ))}
          {/* D-126: say where dropped files go, and who can read them. */}
          {folderPath && attachments.some((a) => a.kind === 'file') && (
            <span className="attach-shared">Copied into this project — its agents can open it. <Button variant="link" onClick={() => setManageAttach(true)}>Manage</Button></span>
          )}
        </div>
      )}
      <div className="composer-input-wrap">
        {mentionQuery !== null && (mentionMatches.length > 0 || showAllMention || modeMatches.length > 0 || showCollabMention) && (
          <div className="mention-menu">
            {showAllMention && (
              <button className="mention-item" onMouseEnter={() => setMentionIndex(-1)} onClick={() => insertAllMention()}>
                <span className="mention-all-ico"><Icon name="flash" size="sm" /></span>
                <span className="mention-name">All agents</span>
                <span className="mention-handle">@all · side-by-side</span>
              </button>
            )}
            {/* Thinking modes (D-083): one row, a submenu with the three — like the model picker. */}
            {modeMatches.length > 0 && (
              <div className="mention-item mention-modes" onMouseEnter={() => { setMentionIndex(-1); setModesOpen(true) }} onMouseLeave={() => setModesOpen(false)}>
                <span className="mention-all-ico"><Icon name="flash" size="sm" /></span>
                <span className="mention-name">Thinking mode</span>
                <span className="mention-handle">{modeMatches.length === 1 ? `@${modeMatches[0]}` : '@debate · @critique · @research'} ›</span>
                {modesOpen && (
                  <div className="pm-submenu mention-submenu">
                    {modeMatches.map((id) => (
                      <button key={id} className="mention-item" onClick={() => insertAllMention(id)} title={MODES[id].description}>
                        <span className="mention-name">{MODES[id].label}</span>
                        <span className="mention-handle">@{id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showCollabMention && (
              <button className="mention-item" disabled={!collabAvailable} onMouseEnter={() => setMentionIndex(-1)} onClick={() => insertAllMention('collab')}
                title={collabAvailable ? 'The agents plan it, you approve, then they run it' : 'Collab needs a project folder'}>
                <span className="mention-all-ico"><Icon name="flash" size="sm" /></span>
                <span className="mention-name">Collab</span>
                <span className="mention-handle">{collabAvailable ? '@collab · plan & run with several agents' : 'needs a project folder'}</span>
              </button>
            )}
            {mentionMatches.map((p, i) => (
              <button
                key={p.id}
                className={`mention-item ${i === mentionIndex ? 'active' : ''}`}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => insertMention(p.id)}
              >
                <ProviderAvatar id={p.id} size="sm" />
                <span className="mention-name">{p.name}</span>
                <span className="mention-handle">@{handleFor(p.id)}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={text}
          placeholder={collabMode ? 'Describe the goal — the agents plan it, you confirm, then they run it…' : placeholder}
          autoFocus={autoFocus}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={2}
        />
      </div>
      <div className="composer-row">
        <div className="composer-left">
          <div className="attach-wrap">
            <button className="attach-btn" title="Attach files" onClick={() => setAttachOpen((o) => !o)}><Icon name="plus" size="md" /></button>
            <Menu open={attachOpen} onClose={() => setAttachOpen(false)} className="attach-menu">
                <button onClick={() => { setAttachOpen(false); fileInputRef.current?.click() }}>Upload files…</button>
                {folderPath && <button onClick={() => { setAttachOpen(false); setPicking(true) }}>From project folder</button>}
                {folderPath && <button onClick={() => { setAttachOpen(false); setManageAttach(true) }}>Attachments in this project…</button>}
            </Menu>
          </div>
          <div className="perm-wrap">
            <button className="perm-select" onClick={() => setPermOpen((o) => !o)} title="Permission mode">
              {PERM_OPTS.find((o) => o.v === permMode)?.l ?? 'Auto'} <Icon name="chevron-down" size="sm" />
            </button>
            <Menu open={permOpen} onClose={() => setPermOpen(false)} className="perm-menu">
                {PERM_OPTS.map((o) => (
                  <button key={o.v} className={`perm-opt ${permMode === o.v ? 'active' : ''}`} onClick={() => { setPermMode(o.v); setPermOpen(false) }}>
                    <span className="perm-opt-l">{o.l}</span>
                    <span className="perm-opt-d">{o.v === 'read' && customAgentFor(providerId) && !customAgentFor(providerId)!.readOnlyArgs?.length ? `Read-only can't be enforced for ${customAgentFor(providerId)!.name}` : o.d}</span>
                  </button>
                ))}
            </Menu>
          </div>
          <input
            ref={fileInputRef} type="file" multiple
            className="visually-hidden"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) addFiles(files) }}
          />
        </div>
        <div className="composer-actions">
          <div className="pm-wrap">
            <button ref={pmBtnRef} className="provider-select" onClick={togglePm} title="Provider & model">
              <ProviderAvatar id={providerId} size="sm" /> {provider?.name ?? 'Provider'}{model ? ` · ${modelLabel}` : ''} <Icon name="chevron-down" size="sm" />
            </button>
            <Menu portal open={pmOpen && !!pmPos} onClose={() => { setPmOpen(false); setHovered(null) }} className="pm-menu pm-menu-floating" style={pmPos ? { right: pmPos.right, bottom: pmPos.bottom } : undefined}>
                  {providers.map((p) => {
                    const ms = presetsFor(p.id)
                    return (
                      <div key={p.id} className="pm-prov" onMouseEnter={() => setHovered(p.id)}>
                        <button className="pm-prov-row" onClick={() => choose(p.id, '')}>
                          <ProviderAvatar id={p.id} size="sm" />
                          <span className="pm-prov-name">{p.name}</span>
                          {!p.installed
                            ? <Badge tone="danger" title={`The ${p.name} CLI wasn't found on this ${OS_WORDS.computer}`}>Not installed</Badge>
                            : !p.authenticated && <Badge tone="warning" title={`Sign in to the ${p.name} CLI first (see Providers)`}>Signed out</Badge>}
                          {ms.length > 1 && <span className="pm-caret">›</span>}
                        </button>
                        {hovered === p.id && ms.length > 1 && (
                          <div className="pm-submenu">
                            {ms.map((m) => (
                              <button key={m.v} className={`pm-model ${p.id === providerId && m.v === model ? 'active' : ''}`} onClick={() => choose(p.id, m.v)}>{m.l}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
            </Menu>
          </div>
          <VoiceButton scope={rootRef} onText={insertSpoken} disabled={disabled} owner={draftKey} />
          {busy && onStop
            ? <button className="send-btn stop-btn" onClick={onStop} title="Stop"><Icon name="stop" size="md" /></button>
            : <button className="send-btn" disabled={(!(collabMode ? stripCollab(text) : text.trim()) && !(selections.length && !memoryMode)) || disabled || collabBlocked} onClick={submit} title={collabMode ? (collabBlocked ? (collabAvailable ? 'A Collab run is already active' : 'Collab needs a project folder') : 'Plan with Collab') : 'Send'}><Icon name="send" size="md" /></button>}
        </div>
      </div>

      {manageAttach && folderPath && <AttachmentsModal root={folderPath} chatId={chatId} onClose={() => setManageAttach(false)} />}

      {picking && folderPath && (
        <Modal title="Attach files to this message" onClose={() => setPicking(false)} footer={<Button onClick={() => setPicking(false)}>Done</Button>}>
          {tree && <FileTree node={tree} activePath={null} onOpenFile={toggleFolder} loadRoot={folderPath} />}
          {attachments.length > 0 && <div className="field-hint">Attached: {attachments.map(attachmentName).join(', ')}</div>}
        </Modal>
      )}

    </div>
  )
}
