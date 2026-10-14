import { useEffect, useMemo, useRef, useState } from 'react'
import Composer from './Composer'
import CollabCard from './CollabCard'
import { useConversationRun, sendMessage, cancelRun, regenerate, reloadConversation, compareReplies } from '../turnsStore'
import type { PermissionMode } from '../../../shared/agent'
import type { TurnLane as Lane } from '../turnsStore'
import LiveLane from './LiveLane'
import ProviderAvatar from './ProviderAvatar'
import ContextInspector from './ContextInspector'
import SaveToProject from './SaveToProject'
import ArtifactViewer from './ArtifactViewer'
import { failed, reportError, notify } from '../notices'
import { quoteWithSource, selectionSource, selectionContext, type QuoteSource } from '../quoteSource'
import { providerLabel } from '../../../shared/providers'
import { composeWithSelections, selectionsFromMeta, type SelectionItem } from '../../../shared/selections'
import MediaViewer from './MediaViewer'
import SaveAsSkillModal from './SaveAsSkillModal'
import SaveOutcomeModal from './SaveOutcomeModal'
import MessageMarkdown from './MessageMarkdown'
import MessageRow, { type RowActions } from './MessageRow'
import ChatSidePanel from './ChatSidePanel'
import { collectChatFiles, replyFiles, toRelPath, usageMain, usageBreakdown, wbfileSrc } from '../chatFiles'
import Icon from './Icon'
import ResizeHandle from './ResizeHandle'
import { type PendingAttachment, type RunAttachment, resolveAttachment } from '../attachments'
import { api } from '../api'
import type { ProviderInfo, ProviderId, Conversation, Message, CollabRun } from '../../../shared/types'
import type { ModeId } from '../../../shared/modes'
import { stampLine } from '../../../shared/contextBudget'
import { Button } from './ui/Button'

// What the project page hands a brand-new chat to send as its first message.
export interface PendingSend {
  text: string
  provider: ProviderId
  attachments?: PendingAttachment[]
  skillId?: string
  model?: string
  permMode?: PermissionMode
  selections?: SelectionItem[]
}

interface Props {
  conversation: Conversation
  providers: ProviderInfo[]
  pendingSend: PendingSend | null
  onConsumePending: () => void
  cwd?: string
  onAddToMemory: (content: string) => void
  onBranch: (fromConvId: string, messageId: string | null) => void
  onBrowseFiles?: () => void
}

const providerName = (providers: ProviderInfo[], id: ProviderId | null) =>
  providers.find((p) => p.id === id)?.name ?? providerLabel(id, 'Claude')
const NO_FILES: string[] = []

export default function ConversationView({ conversation, providers, pendingSend, onConsumePending, cwd, onAddToMemory, onBranch, onBrowseFiles }: Props) {
  const run = useConversationRun(conversation.id)
  // Permission mode: this chat's remembered choice, else the app-wide last choice, else Auto.
  const [permDefault, setPermDefault] = useState<PermissionMode | null>((conversation.permissionMode as PermissionMode | null) ?? null)
  useEffect(() => {
    if (conversation.permissionMode) return
    api.settings.get('last_permission_mode').then((v: string | null) => { if (v === 'read' || v === 'auto' || v === 'full') setPermDefault(v) }).catch(() => {})
  }, [conversation.id, conversation.permissionMode])
  const { error } = run
  const isStreaming = run.busy
  const [messages, setMessages] = useState<Message[]>([])
  useEffect(() => {
    let alive = true
    api.messages.list(conversation.id).then((m: Message[]) => { if (alive) setMessages(m) })
    return () => { alive = false }
  }, [conversation.id, run.rev])

  // Ghost lanes (D-081 step 1). When a turn finishes, main clears the lanes and bumps rev
  // in separate messages, and the saved replies arrive later over IPC — so the streamed
  // text vanished for a moment and the group re-appeared, which read as the block
  // collapsing and expanding. Keep showing the last lanes until the reload that
  // includes their saved replies has landed (a newer assistant message than the lanes).
  const [ghost, setGhost] = useState<{ lanes: Lane[]; parallel: boolean; since: number } | null>(null)
  const lanesSince = useRef(0)
  const prevLanes = useRef<Lane[]>([]); const prevParallel = useRef(false)
  useEffect(() => { if (run.lanes.length) { prevLanes.current = run.lanes; prevParallel.current = run.parallel } }, [run.lanes, run.parallel])
  useEffect(() => {
    if (run.lanes.length) { if (!lanesSince.current) lanesSince.current = Date.now(); setGhost(null); return }
    if (lanesSince.current) {
      const since = lanesSince.current; lanesSince.current = 0
      const landed = messages.some((m) => m.role === 'assistant' && m.createdAt >= since - 2000)
      setGhost(landed ? null : { lanes: prevLanes.current, parallel: prevParallel.current, since })
    }
  }, [run.lanes, run.parallel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ghost && messages.some((m) => m.role === 'assistant' && m.createdAt >= ghost.since - 2000)) setGhost(null)
  }, [messages, ghost])
  // Compare cards (D-081): a reply tagged `synthesis` renders as a card on top of its
  // group; the replies it compared collapse behind one-line headers until clicked.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const isSynthesis = (m: Message) => m.role === 'assistant' && !!m.metadata?.synthesis
  const firstLine = (text: string) => { const l = text.split('\n').map((x) => x.replace(/^[#>*\-\s`]+/, '').replace(/\*\*|__|`/g, '').trim()).find(Boolean) ?? ''; return l.length > 110 ? l.slice(0, 110) + '…' : l }
  const shownLanes = run.lanes.length ? run.lanes : (ghost?.lanes ?? [])
  const shownParallel = run.lanes.length ? run.parallel : !!ghost?.parallel

  // Collab mode: the latest run for this conversation, hydrated with tasks.
  const [collabRun, setCollabRun] = useState<CollabRun | null>(null)
  useEffect(() => {
    let alive = true
    const reload = async () => {
      const list = await api.collab.list(conversation.id).catch(() => [] as CollabRun[])
      if (!alive) return
      if (!list.length) { setCollabRun(null); return }
      const full = await api.collab.get(list[0].id).catch(() => null)
      if (!alive) return
      setCollabRun(full)
      // Collab sub-runs bypass the run store, so pull in any new messages they wrote.
      api.messages.list(conversation.id).then((m: Message[]) => { if (alive) setMessages(m) })
    }
    reload()
    const off = api.collab.onChanged(reload)
    return () => { alive = false; off() }
  }, [conversation.id])

  const collabActive = !!collabRun && ['planning', 'awaiting_confirmation', 'running', 'needs_attention'].includes(collabRun.status)
  const startCollab = async (goal: string, provider: ProviderId, permMode: PermissionMode, model?: string) => {
    if (!cwd || collabActive) return
    await api.collab.start({ conversationId: conversation.id, cwd, providerId: provider, model, permissionMode: permMode, goal }).catch(failed('Start collab'))
  }
  const [showInspect, setShowInspect] = useState(false)
  // The provider currently selected in the composer — what the inspector reports on.
  const [composerProvider, setComposerProvider] = useState<ProviderId>(conversation.provider)
  const [compressing, setCompressing] = useState(false)
  const [saveContent, setSaveContent] = useState<string | null>(null)
  const [saveSkill, setSaveSkill] = useState<string | null>(null)
  const [saveOutcomeFor, setSaveOutcomeFor] = useState<string | null>(null)   // message id (D-081)
  const [openArtifact, setOpenArtifact] = useState<string | null>(null)
  const [media, setMedia] = useState<{ src: string; alt: string; rel: string } | null>(null)
  const [sel, setSel] = useState<{ text: string; x: number; y: number; source: QuoteSource | null; before?: string; after?: string } | null>(null)
  const [inject, setInject] = useState<{ text?: string; selections?: SelectionItem[]; nonce: number } | undefined>(undefined)
  const [atBottom, setAtBottom] = useState(true)
  const [menuMsg, setMenuMsg] = useState<string | null>(null)
  const [memSaved, setMemSaved] = useState(false)
  const quickMemory = async (line: string) => {
    const append = (cur: string) => (cur.trim() ? cur.trimEnd() + '\n' : '') + stampLine(line)   // dated so the inspector can flag stale facts (D-082)
    try {
      if (cwd) { const cur = (await api.projectMemory.read(cwd)) ?? ''; await api.projectMemory.write(cwd, append(cur)) }
      else { const p = await api.projects.get(conversation.projectId); await api.projects.update(conversation.projectId, { memory: append(p?.memory ?? '') }) }
      setMemSaved(true); setTimeout(() => setMemSaved(false), 1800)
    } catch (e) { reportError('Save to memory', e) }
  }

  useEffect(() => {
    const off = api.conversations.onCompressing((p: { conversationId: string; state: 'start' | 'end' }) => {
      if (p.conversationId === conversation.id) setCompressing(p.state === 'start')
    })
    return off
  }, [conversation.id])

  // Turn an absolute-inside-cwd or ./-prefixed path into a project-relative one.
  const toRel = (p: string) => toRelPath(cwd, p)

  // Files referenced in this chat, newest first, split into artifacts and working files.
  // Artifacts = what the agent LINKED in a reply, plus any deliverable-type file it WROTE
  // (html, images, pdf, md, office, csv) even if it only mentioned the path in plain text
  // or not at all (1.5.5 — an unlinked new .html used to land under Working files).
  // Working files = everything else it touched via tools (reads, code, config). Dotfiles
  // and hidden folders (agents' scratch space, e.g. .workbench/tmp/) are dropped, and
  // everything is filtered against the disk so deleted temporaries disappear (D-062).
  const { linked: linkedRaw, touched: touchedRaw } = useMemo(() => collectChatFiles(messages, cwd), [messages, cwd])
  const [existing, setExisting] = useState<Set<string> | null>(null)
  const [fsTick, setFsTick] = useState(0)
  useEffect(() => {
    if (!cwd) { setExisting(null); return }
    let alive = true
    const all = [...linkedRaw, ...touchedRaw]
    if (!all.length) { setExisting(new Set()); return }
    api.files.existing(cwd, all).then((ok: string[]) => { if (alive) setExisting(new Set(ok)) }).catch(() => { if (alive) setExisting(null) })
    return () => { alive = false }
  }, [cwd, linkedRaw, touchedRaw, fsTick])
  // Re-check when the folder watcher reports a change (agent deleted its scratch files).
  useEffect(() => api.files.onChanged(() => setFsTick((t) => t + 1)), [])
  const keep = (rel: string) => existing === null || existing.has(rel)
  const artifacts = linkedRaw.filter(keep)
  const workingFiles = touchedRaw.filter((r) => keep(r) && !artifacts.includes(r))

  const openArtifactFn = cwd ? (rel: string) => setOpenArtifact(toRel(rel)) : undefined
  // Media thumbnails open a lightbox; a link below opens the artifact viewer.
  const openMedia = cwd ? (rel: string) => setMedia({ src: wbfileSrc(cwd, toRel(rel)), alt: toRel(rel).split('/').pop() || rel, rel: toRel(rel) }) : undefined

  // A message sent with selected passages stores what the user typed separately (D-065).
  // Files to show as cards under a reply (D-066): files it linked in the text, then files
  // it created or edited; hidden files and ones known to be gone are left out.
  const checked = useMemo(() => new Set([...linkedRaw, ...touchedRaw]), [linkedRaw, touchedRaw])
  // Computed once per transcript change, not per streamed frame (D-090).
  const replyFilesById = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of messages) if (m.role === 'assistant') { const f = replyFiles(m, cwd, existing, checked); if (f.length) map.set(m.id, f) }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, existing, checked, cwd])
  const sendWithAttachments = async (t: string, p: typeof conversation.provider, atts: PendingAttachment[], skillId?: string, model?: string, permMode?: PermissionMode, sels?: SelectionItem[], mode?: ModeId) => {
    let attachments: RunAttachment[] | undefined
    if (atts.length) {
      const resolved = (await Promise.all(atts.map((a) => resolveAttachment(a, cwd)))).filter((x): x is RunAttachment => x !== null)
      if (resolved.length) attachments = resolved
    }
    // Selected passages (D-065): the agent receives them under the typed text, each with
    // its source; the bubble shows only the typed text plus a selections chip.
    if (sels?.length) sendMessage(conversation.id, cwd, composeWithSelections(t, sels), p, attachments, skillId, model, permMode, { selections: sels, displayText: t }, mode)
    else sendMessage(conversation.id, cwd, t, p, attachments, skillId, model, permMode, undefined, mode)
  }

  // Multi-agent: ask a *different* agent to critique the selected reply (D-033).
  const otherProviderFor = (pid: ProviderId | null) => providers.find((p) => p.id !== pid)
  const secondOpinion = (m: Message) => {
    const other = otherProviderFor(m.provider)
    if (!other) return
    setMenuMsg(null)
    sendMessage(conversation.id, cwd, 'Give a second opinion on the previous response. Point out any errors, missing considerations, or better alternatives, then give your own recommendation.', other.id)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const firedPending = useRef(false)

  const scrollToBottom = () => { const el = scrollRef.current; if (el) { el.scrollTo({ top: el.scrollHeight }); setAtBottom(true) } }
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    if (sel) setSel(null)
  }
  const onContextMenu = (e: React.MouseEvent) => {
    const s = window.getSelection(); const t = s?.toString().trim() ?? ''
    if (t && s && s.rangeCount > 0) { e.preventDefault(); setSel({ text: t, x: e.clientX, y: e.clientY, source: selectionSource(s.getRangeAt(0)), ...selectionContext(s.getRangeAt(0)) }) }
    else setSel(null)
  }
  const replyToSelection = () => {
    if (!sel) return
    setInject({ selections: [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: sel.text, source: sel.source, before: sel.before, after: sel.after }], nonce: Date.now() })
    setSel(null); window.getSelection()?.removeAllRanges()
  }
  const lookupSelection = () => { api.system.lookup(); setSel(null) }
  // Explain: immediately ask the conversation's current agent about the selection.
  const explainSelection = () => {
    if (!sel) return
    sendMessage(conversation.id, cwd, `Explain this:\n\n${quoteWithSource(sel.text, sel.source)}`, conversation.provider, undefined, 'global/explain-this')
    setSel(null); window.getSelection()?.removeAllRanges()
  }

  // Branch (copy the thread up to and including this message into a new chat).
  const branchFrom = (messageId: string | null) => {
    setMenuMsg(null)
    onBranch(conversation.id, messageId)
  }
  // Regenerate an assistant reply: rerun the same provider on the preceding user turn.
  const regenerateFrom = (m: Message, idx: number) => {
    let prompt = ''
    for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === 'user') { prompt = messages[i].content; break } }
    setMenuMsg(null)
    if (!prompt.trim()) return
    regenerate(conversation.id, cwd, m.id, m.provider ?? conversation.provider, prompt, conversation.model ?? undefined)
  }
  // Edit a user message: drop it (and everything after) and reload it into the composer.
  const editUser = async (m: Message) => {
    setMenuMsg(null)
    await api.messages.deleteFrom(conversation.id, m.id)
    reloadConversation(conversation.id)
    const sels = selectionsFromMeta(m.metadata)
    const display = (m.metadata as { displayText?: unknown } | null)?.displayText
    setInject(sels.length ? { text: typeof display === 'string' ? display : m.content, selections: sels, nonce: Date.now() } : { text: m.content, nonce: Date.now() })
  }

  useEffect(() => {
    if (pendingSend && !firedPending.current) {
      firedPending.current = true
      void sendWithAttachments(pendingSend.text, pendingSend.provider, pendingSend.attachments ?? [], pendingSend.skillId, pendingSend.model, pendingSend.permMode, pendingSend.selections)
      onConsumePending()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend, onConsumePending, conversation.id, cwd])

  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, shownLanes, atBottom])

  const idxOf = useMemo(() => { const map = new Map<string, number>(); messages.forEach((mm, i) => map.set(mm.id, i)); return map }, [messages])
  // Group consecutive assistant messages that share a parallelGroup so blind-parallel
  // replies render side-by-side (@all). Everything else stays a single row.
  const rows = useMemo(() => {
    const out: (Message | Message[])[] = []
    for (let i = 0; i < messages.length; ) {
      const m = messages[i]
      const pg = m.role === 'assistant' ? (m.metadata?.parallelGroup as string | undefined) : undefined
      if (pg) {
        const group = [m]; let j = i + 1
        while (j < messages.length && messages[j].role === 'assistant' && (messages[j].metadata?.parallelGroup as string | undefined) === pg) { group.push(messages[j]); j++ }
        out.push(group.length > 1 ? group : m); i = j
      } else { out.push(m); i++ }
    }
    return out
  }, [messages])

  const renderLane = (lane: Lane) => (
    <LiveLane lane={lane} name={providerName(providers, lane.provider)} root={cwd} onOpenArtifact={openArtifactFn} onOpenMedia={openMedia} />
  )

  // One stable actions object for every row, always calling the latest handlers, so
  // memoized rows are not re-rendered just because a closure was re-created (D-098).
  const latest = useRef({ openArtifactFn, openMedia, regenerateFrom, editUser, branchFrom, secondOpinion, onAddToMemory })
  latest.current = { openArtifactFn, openMedia, regenerateFrom, editUser, branchFrom, secondOpinion, onAddToMemory }
  const rowActions = useMemo<RowActions>(() => ({
    openArtifact: (rel) => latest.current.openArtifactFn?.(rel),
    openMedia: (rel) => latest.current.openMedia?.(rel),
    toggleMenu: (id) => setMenuMsg((cur) => (cur === id ? null : id)),
    closeMenu: () => setMenuMsg(null),
    regenerate: (m, idx) => latest.current.regenerateFrom(m, idx),
    editUser: (m) => { void latest.current.editUser(m) },
    branchFrom: (id) => latest.current.branchFrom(id),
    saveToProject: (content) => setSaveContent(content),
    saveSkill: (content) => setSaveSkill(content),
    saveOutcome: (id) => setSaveOutcomeFor(id),
    addToMemory: (content) => latest.current.onAddToMemory(content),
    secondOpinion: (m) => latest.current.secondOpinion(m)
  }), [])
  const renderMessage = (m: Message) => (
    <MessageRow
      key={m.id} m={m} idx={idxOf.get(m.id) ?? 0} name={providerName(providers, m.provider)} cwd={cwd}
      files={replyFilesById.get(m.id) ?? NO_FILES} menuOpen={menuMsg === m.id} isStreaming={isStreaming}
      otherName={otherProviderFor(m.provider)?.name} actions={rowActions}
    />
  )

  return (
    <div className="chat-layout" onContextMenu={onContextMenu} onMouseDown={() => { if (sel) setSel(null) }}>
      <div className="conversation">
        <div className="conv-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="conv-inner">
            {(() => {
              const renderCard = (m: Message) => (
                <div key={m.id} className="synthesis-card" data-quote-label="the comparison">
                  <div className="synthesis-head"><Icon name="flash" size="xs" /> Compare · {providerName(providers, (m.metadata?.synthesisAgent as ProviderId | undefined) ?? m.provider)}</div>
                  <div className="msg-body markdown-body synthesis-body"><MessageMarkdown onOpenArtifact={openArtifactFn} onOpenMedia={openMedia} root={cwd}>{m.content}</MessageMarkdown></div>
                  <div className="synthesis-foot">
                    <span className="msg-tokens" title={usageBreakdown(m) ?? undefined}>{usageMain(m)}</span>
                    <Button type="button" variant="link" className="synthesis-save" onClick={() => setSaveOutcomeFor(m.id)}>Save outcome</Button>
                  </div>
                </div>
              )
              const renderCollapsed = (m: Message) => (
                <button key={m.id} type="button" className="reply-collapsed" onClick={() => toggleExpanded(m.id)} title="Show the full reply">
                  <ProviderAvatar id={m.provider} size="sm" />
                  <span className="reply-collapsed-name">{providerName(providers, m.provider)}</span>
                  {typeof m.metadata?.modelUsed === 'string' && <span className="reply-collapsed-model">{m.metadata.modelUsed as string}</span>}
                  <span className="reply-collapsed-line truncate">{firstLine(m.content)}</span>
                  <span className="reply-collapsed-tokens">{usageMain(m).split(' · ').slice(0, 1)[0]}</span>
                  <Icon name="chevron-down" size="xs" />
                </button>
              )
              const renderRow = (row: Message | Message[]) => {
                if (!Array.isArray(row)) return isSynthesis(row) ? renderCard(row) : renderMessage(row)
                const card = row.find(isSynthesis)
                const replies = row.filter((m) => !isSynthesis(m))
                if (!card) {
                  return (
                    <div key={row[0].id} className="parallel-stack">
                      <div className="parallel-header"><Icon name="flash" size="xs" /> {replies.length} agents · answered independently</div>
                      {replies.map((m) => renderMessage(m))}
                    </div>
                  )
                }
                // With a card: the card stands on its own; the replies fold into a quiet list
                // beneath it (no accent rail — the card is the thing to read).
                return (
                  <div key={row[0].id} className="compare-group">
                    {renderCard(card)}
                    <div className="replies-folded">
                      <div className="replies-folded-head">{replies.length} replies · answered independently · click one to read it</div>
                      {replies.map((m) => !expanded.has(m.id) ? renderCollapsed(m) : (
                        <div key={m.id} className="reply-expanded">
                          <Button type="button" variant="link" className="reply-collapse-btn" onClick={() => toggleExpanded(m.id)}>Collapse</Button>
                          {renderMessage(m)}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
              // Compare on demand (D-081): ≥2 replies from different agents since the last
              // user message and no card yet — a turn-by-turn debate, or @all with auto off.
              const lastUser = [...messages].reverse().find((m) => m.role === 'user')
              const since = lastUser ? messages.slice(messages.indexOf(lastUser) + 1) : []
              const canCompare = !isStreaming && since.filter((m) => m.role === 'assistant' && m.content.trim()).length >= 2 && !since.some(isSynthesis)
              // Terminal collab card: drop it in at the point the run happened so later
              // chat flows below it. Active runs keep it pinned at the end (near composer).
              if (collabRun && !collabActive) {
                const rowTime = (r: Message | Message[]) => (Array.isArray(r) ? r[0].createdAt : r.createdAt)
                const i = rows.findIndex((r) => rowTime(r) > collabRun.createdAt)
                const cut = i === -1 ? rows.length : i
                return <>{rows.slice(0, cut).map(renderRow)}<CollabCard key="collab-card" run={collabRun} providers={providers} onOpenFile={cwd ? (rel) => setOpenArtifact(rel) : undefined} />{rows.slice(cut).map(renderRow)}</>
              }
              return <>{rows.map(renderRow)}{canCompare && <div className="compare-row"><Button size="sm" onClick={() => compareReplies(conversation.id).catch(failed('Compare replies'))}><Icon name="flash" size="xs" /> Compare replies</Button></div>}</>
            })()}
            {shownLanes.length > 0 && (
              shownParallel
                ? (
                  <div className="parallel-stack">
                    <div className="parallel-header"><Icon name="flash" size="xs" /> {shownLanes.length} agents · {run.phase === 'compare' ? <><span className="activity-spinner spinner-xs" /> comparing the answers…</> : shownLanes.every((l) => l.done) ? 'answered independently' : 'answering independently…'}</div>
                    {shownLanes.map((lane) => <div key={lane.provider} className="parallel-item">{renderLane(lane)}</div>)}
                  </div>
                )
                : renderLane(shownLanes[0])
            )}
            {run.phase === 'compare' && shownLanes.length === 0 && <div className="compare-row compare-busy"><span className="activity-spinner spinner-xs" /> Comparing the replies…</div>}
            {collabRun && collabActive && <CollabCard run={collabRun} providers={providers} onOpenFile={cwd ? (rel) => setOpenArtifact(rel) : undefined} />}
            {error && <div className="msg-error">⚠ {error}</div>}
          </div>
        </div>
        <div className="conv-composer">
          {!atBottom && <button className="scroll-latest" onClick={scrollToBottom} title="Scroll to latest"><Icon name="chevron-down" size="nav" /></button>}
          <div className="conv-composer-inner">
            {compressing && <div className="compressing-note"><span className="activity-spinner" /> Compressing conversation…</div>}
            {memSaved && <div className="mem-saved-note">Saved to project memory</div>}
            <Composer
              providers={providers}
              onSend={sendWithAttachments}
              onStartCollab={startCollab}
              collabAvailable={!!cwd}
              collabBusy={collabActive}
              onQuickMemory={quickMemory}
              onProviderChange={setComposerProvider}
              busy={isStreaming}
              onStop={() => cancelRun(conversation.id)}
              inject={inject}
              placeholder="Ask anything…"
              defaultProvider={conversation.provider}
              folderPath={cwd}
              enableSkills
              defaultModel={conversation.model}
              defaultPermissionMode={permDefault}
              onPermissionModeChange={(m) => { api.conversations.setPermissionMode(conversation.id, m).catch(failed('Remember permission mode')) }}
              draftKey={conversation.id}
            />
            <Button variant="link" className="inspect-link" onClick={() => setShowInspect(true)}>Inspect context</Button>
          </div>
        </div>
      </div>

      {media && <MediaViewer src={media.src} alt={media.alt} root={cwd} relPath={media.rel} onClose={() => setMedia(null)} />}
      <aside className="chat-side">
        <ResizeHandle varName="--context-panel-w" edge="left" min={240} max={1200} />
        {openArtifact && cwd ? (
          <ArtifactViewer root={cwd} relPath={openArtifact} onClose={() => setOpenArtifact(null)} popout />
        ) : null}
        <ChatSidePanel
          hidden={!!(openArtifact && cwd)} conversationId={conversation.id} cwd={cwd} composerProvider={composerProvider}
          agentName={providerName(providers, composerProvider)} artifacts={artifacts} workingFiles={workingFiles}
          onOpen={openArtifactFn} onBrowseFiles={onBrowseFiles}
        />
      </aside>

      {sel && (
        <div className="sel-menu" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}>
          <button onClick={explainSelection}>Explain this</button>
          <button onClick={replyToSelection}>Reply</button>
          <button onClick={lookupSelection}>Lookup</button>
        </div>
      )}
      {showInspect && <ContextInspector conversationId={conversation.id} providerId={composerProvider} onClose={() => setShowInspect(false)} />}
      {saveContent !== null && cwd && <SaveToProject folderPath={cwd} content={saveContent} onClose={() => setSaveContent(null)} />}
      {saveOutcomeFor !== null && <SaveOutcomeModal conversationId={conversation.id} projectId={conversation.projectId} messageId={saveOutcomeFor} onClose={() => setSaveOutcomeFor(null)} onSaved={(o) => { setSaveOutcomeFor(null); notify(`Saved ${o.id} to the decisions log`) }} />}
      {saveSkill !== null && <SaveAsSkillModal content={saveSkill} cwd={cwd} onClose={() => setSaveSkill(null)} onSaved={() => setSaveSkill(null)} />}
    </div>
  )
}
