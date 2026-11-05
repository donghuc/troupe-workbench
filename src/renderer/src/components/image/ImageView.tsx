import { confirmDialog } from '../ui/ConfirmDialog'
import { OS_WORDS } from '../../../../shared/platform'
import { Button, IconButton } from '../ui/Button'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Icon from '../Icon'
import MediaViewer from '../MediaViewer'
import { api } from '../../api'
import { failed, notify, openSettings, IMAGE_FOLDER_EVENT } from '../../notices'
import { useAgentList } from '../../agents'
import ImageCanvas from './ImageCanvas'
import { readBase64, type CardCtx, type CardData, type RunState } from './ImageCards'
import SavedPanel from './SavedPanel'
import CardPalette, { CARD_DRAG_TYPE, CARD_SHORTCUTS, type PaletteKind } from './CardPalette'
import CanvasTabs from './CanvasTabs'
import { fileUrl, CARD_W, IMAGE_REF_TYPE, cardWidth } from './geometry'
import {
  emptyCanvas, makeCard, connect, canConnect, removeCard, removeSlot, updateCard, gatherInputs, validateRun, inputsHash,
  outputsOf, newId, isImageAgent, withoutRun, findFreeSpot, IMAGE_AGENTS, OUTPUT_SLOT, cardLabel, runSize, isAnimateCard, isAnimationFile, isImagePath,
  type Canvas, type Card, type CardKind, type RunRecord, type ImageRunEvent, type ImageRunDone,
  applyRunResult, type CanvasIndex, cardViews, indexCanvas, stabilize
} from '../../../../shared/imageCanvas'
import { MOTION_AGENTS, DEFAULT_SECONDS, isMotionAgent, isMotionAsset } from '../../../../shared/motion'
import type { ProviderId } from '../../../../shared/types'

type LiveRun = RunState & { canvasId: string; pid: string; agent?: ProviderId; model?: string; animate?: boolean }
const ANIM_OUTPUT = { w: 460, h: 440 }   // an animation Output starts with a roomier player; its grip resizes it
const KEEP_GOOD_RUNS = 2   // animation Outputs: the current one + the one Undo goes back to
/** Does this Output hold the other kind of result than `animate`? Then a run gets a fresh Output. */
const holdsOtherKind = (k: Card, animate: boolean): boolean => k.kind === 'output' && k.data.runs.some((r) => r.files.length > 0 && r.files.some(isAnimationFile) !== animate)
const addRunTo = (c: Canvas, outId: string, rec: RunRecord): Canvas =>
  updateCard(c, outId, (k) => (k.kind === 'output' ? { ...k, data: { ...k.data, runs: [...k.data.runs, rec].slice(-30) } } : k))

// Image (D-088): canvases kept in one global folder. Prompt + Media → an Image card (image agent)
// or an Animate card (Lottie, D-148) → Output. Sits below Projects in the sidebar.
export default function ImageView({ active = true }: { active?: boolean }) {
  const store = api.image
  const [folder, setFolder] = useState<string | null | undefined>(undefined)
  const [canvas, setCanvas] = useState<Canvas>(emptyCanvas)
  const [loaded, setLoaded] = useState(false)
  // Canvases (D-102): the tab list + active tab; `canvas` is the active one.
  const [index, setIndex] = useState<CanvasIndex | null>(null)
  const indexRef = useRef(index); indexRef.current = index
  const canvasId = index?.active ?? null
  const canvasIdRef = useRef(canvasId); canvasIdRef.current = canvasId
  // Runs in flight across all canvases, by runId. A run keeps going when you switch tabs; its
  // result lands on its own canvas (on screen, or loaded from disk and saved back).
  const [runs, setRuns] = useState<Record<string, LiveRun>>({})
  const runsRef = useRef(runs); runsRef.current = runs
  // The active canvas's runs keyed by processor id — what the cards read.
  const running = useMemo(() => {
    const out: Record<string, RunState> = {}
    for (const r of Object.values(runs)) if (r.canvasId === canvasId) out[r.pid] = r
    return out
  }, [runs, canvasId])
  const [viewing, setViewing] = useState<string | null>(null)
  const [savedOpen, setSavedOpen] = useState<boolean>(() => { try { return localStorage.getItem('image.savedPanel') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('image.savedPanel', savedOpen ? '1' : '0') } catch { /* storage unavailable */ } }, [savedOpen])
  const [savedVersion, setSavedVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedRef = useRef(selectedIds); selectedRef.current = selectedIds
  const [importing, setImporting] = useState<string[]>([])
  const wrap = useRef<HTMLDivElement>(null)
  // Rendered card heights, measured by the canvas (placement, box-select, culling).
  const heights = useMemo(() => new Map<string, number>(), [])
  const importingRef = useRef(importing); importingRef.current = importing
  const folderRef = useRef(folder); folderRef.current = folder
  const canvasRef = useRef(canvas); canvasRef.current = canvas
  const runningRef = useRef(running); runningRef.current = running
  const allAgents = useAgentList()
  // In IMAGE_AGENTS order (Codex first, Claude · SVG last), so a new Processor defaults to a
  // real image generator — the app's own agent order starts with Claude.
  const agents = useMemo(() => allAgents.filter((a) => isImageAgent(a.id)).sort((a, b) => IMAGE_AGENTS.indexOf(a.id) - IMAGE_AGENTS.indexOf(b.id)), [allAgents])
  const motionAgents = useMemo(() => allAgents.filter((a) => isMotionAgent(a.id)).sort((a, b) => MOTION_AGENTS.indexOf(a.id) - MOTION_AGENTS.indexOf(b.id)), [allAgents])
  const defaultAgent = agents[0]?.id ?? IMAGE_AGENTS[0]
  const defaultMotionAgent = motionAgents[0]?.id ?? MOTION_AGENTS[0]
  const busyCanvases = useMemo(() => new Set(Object.values(runs).map((r) => r.canvasId)), [runs])

  const openCanvas = async (id: string) => {
    setLoaded(false)
    setSelectedIds([])
    setCanvas(await store.load(id).catch((e: unknown) => { failed('Open canvas')(e); return emptyCanvas() }))
    setLoaded(true)
  }
  const load = async () => {
    setLoaded(false)
    const f: string | null = await store.folder().catch(() => null)
    setFolder(f)
    if (!f) return
    const ix: CanvasIndex | undefined = await store.canvases().catch(failed('Open canvases'))
    if (!ix) return
    setIndex(ix)
    await openCanvas(ix.active)
  }
  useEffect(() => { void load() }, [])
  // The folder is set in Settings ▸ Image only. When it changes, stop runs writing into the
  // old folder (their results would land on the wrong canvas) and open the new canvas.
  useEffect(() => {
    const onChange = () => {
      for (const r of Object.values(runsRef.current)) void store.cancel(r.runId).catch(() => {})
      setRuns({})
      setIndex(null)
      pending.current = null   // never write the old canvas into the new folder (load() also cancels the pending autosave)
      void load()
    }
    window.addEventListener(IMAGE_FOLDER_EVENT, onChange)
    return () => window.removeEventListener(IMAGE_FOLDER_EVENT, onChange)
  }, [])

  // Autosave (debounced) to canvas.json; flushed when leaving the view.
  const pending = useRef<{ id: string; canvas: Canvas } | null>(null)
  const flush = () => { const p = pending.current; pending.current = null; if (p) return store.save(p.id, p.canvas).catch(failed('Save canvas')); return Promise.resolve() }
  useEffect(() => {
    if (!loaded || !canvasId) return
    pending.current = { id: canvasId, canvas }
    const t = setTimeout(() => { void flush() }, 400)
    return () => clearTimeout(t)
  }, [canvas, loaded, canvasId])
  useEffect(() => () => { void flush() }, [])

  // Run progress and results from main.
  useEffect(() => {
    const offEv = api.image.onEvent(({ runId, label }: ImageRunEvent) => {
      setRuns((m) => (m[runId] ? { ...m, [runId]: { ...m[runId], label } } : m))
    })
    const offDone = api.image.onDone(({ runId, files, error }: ImageRunDone) => {
      const st = runsRef.current[runId]
      if (!st) return
      setRuns((m) => { const n = { ...m }; delete n[runId]; return n })
      const rec = { id: runId, at: new Date().toISOString(), files, ...(error ? { error } : {}), inputsHash: st.hash, ...(st.change ? { change: st.change } : {}) }
      const gap = CARD_W.processor + 60
      if (st.outId) {
        // "Ask for a change" on an animation: the new run belongs to that one Output card.
        const full: RunRecord = { ...rec, agent: st.agent ?? 'claude-code', model: st.model ?? '' }
        if (st.canvasId === canvasIdRef.current) setCanvas((c) => addRunTo(c, st.outId!, full))
        else void store.load(st.canvasId).then((c) => store.save(st.canvasId, addRunTo(c, st.outId!, full))).catch(failed('Save run result'))
      } else if (st.canvasId === canvasIdRef.current) {
        setCanvas((c) => applyRunResult(c, st.pid, rec, gap))
      } else {
        // Finished on a canvas that isn't on screen: update its file directly.
        void store.applyRunResult(st.canvasId, st.pid, rec, gap).catch(failed('Save run result'))
        const name = indexRef.current?.tabs.find((t) => t.id === st.canvasId)?.name
        if (!error && name) notify(`${st.animate ? 'Animation' : 'Images'} ready in “${name}”`)
      }
      if (error && error !== 'Stopped' && !files.length) notify(`${st.animate ? 'Animation' : 'Image'} run failed: ${error.slice(0, 160)}`)
    })
    return () => { offEv(); offDone() }
  }, [])

  const change = (fn: (c: Canvas) => Canvas) => setCanvas(fn)
  const onViewCommit = useMemo(() => (view: Canvas['view']) => setCanvas((c) => ({ ...c, view })), [])
  const onRemoveEdge = useMemo(() => (id: string) => setCanvas((c) => ({ ...c, edges: c.edges.filter((e) => e.id !== id) })), [])

  // New cards land near the middle of what's on screen, nudged so they don't stack.
  // Where a new card goes: the middle of the view, moved to the nearest free space so it
  // never lands on top of another card. Heights are read from the rendered cards.
  const spot = (kind: CardKind = 'processor'): { x: number; y: number } => {
    const r = wrap.current?.getBoundingClientRect()
    const v = canvasRef.current.view
    const cx = ((r ? r.width / 2 : 400) - v.x) / v.zoom - CARD_W[kind] / 2
    const cy = ((r ? r.height / 2 : 300) - v.y) / v.zoom - 120
    const taken = canvasRef.current.cards.map((k) => ({ x: k.x, y: k.y, w: cardWidth(k), h: heights.get(k.id) ?? 240 }))
    const p = findFreeSpot(taken, { x: Math.round(cx), y: Math.round(cy) }, { w: CARD_W[kind], h: 240 })
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }
  const sized = (k: Card): Card => (k.kind === 'output' ? { ...k, data: { ...k.data, w: ANIM_OUTPUT.w, h: ANIM_OUTPUT.h } } : k)
  const addCard = (pk: PaletteKind, at?: { x: number; y: number }) => {
    const animate = pk === 'animate'
    const kind: CardKind = animate ? 'processor' : pk
    const p = at ?? spot(kind)
    const card = makeCard(kind, Math.round(p.x), Math.round(p.y), { agent: animate ? defaultMotionAgent : defaultAgent, animate })
    change((c) => ({ ...c, cards: [...c.cards, card] }))
    setSelectedIds([card.id])
  }
  const addCardRef = useRef(addCard); addCardRef.current = addCard
  // A tile dragged from the Add card panel lands with its top-left at the drop point.
  const onStageDragOver = (e: DragEvent) => { if (e.dataTransfer.types.includes(CARD_DRAG_TYPE) || e.dataTransfer.types.includes(IMAGE_REF_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }
  const onStageDrop = (e: DragEvent) => {
    // A folder image dropped on empty canvas → a new Media card holding it, where it was dropped.
    const ref = e.dataTransfer.getData(IMAGE_REF_TYPE)
    if (ref) {
      e.preventDefault()
      const r = wrap.current?.getBoundingClientRect(); const v = canvasRef.current.view
      const at = r ? { x: (e.clientX - r.left - v.x) / v.zoom - 20, y: (e.clientY - r.top - v.y) / v.zoom - 20 } : spot('media')
      const m = makeCard('media', Math.round(at.x), Math.round(at.y))
      change((c) => ({ ...c, cards: [...c.cards, m] }))
      setSelectedIds([m.id])
      void addMediaRefsRef.current(m.id, [ref])
      return
    }
    const kind = e.dataTransfer.getData(CARD_DRAG_TYPE) as PaletteKind
    if (!kind) return
    e.preventDefault()
    const r = wrap.current?.getBoundingClientRect(); const v = canvasRef.current.view
    if (!r) { addCard(kind); return }
    addCard(kind, { x: (e.clientX - r.left - v.x) / v.zoom - 20, y: (e.clientY - r.top - v.y) / v.zoom - 20 })
  }

  // The starter cards; `chain` adds the Image → Animate flow: the image Output feeds an Animate card
  // with its own motion prompt, into a player Output.
  const addTemplate = (chain: boolean) => {
    const { x, y } = spot()
    const a = makeCard('prompt', x - 360, y - 60)
    const b = makeCard('media', x - 380, y + 160)
    const p = makeCard('processor', x + 20, y - 40, { agent: defaultAgent })
    const o = makeCard('output', x + 400, y - 60)
    const slot0 = p.kind === 'processor' ? p.data.slots[0] : ''
    if (p.kind === 'processor') p.data.slots.push(newId('s'))
    const slot1 = p.kind === 'processor' ? p.data.slots[1] : ''
    change((c) => {
      let n: Canvas = { ...c, cards: [...c.cards, a, b, p, o] }
      n = connect(n, a.id, p.id, slot0); n = connect(n, b.id, p.id, slot1); n = connect(n, p.id, o.id, OUTPUT_SLOT)
      if (!chain) return n
      const mp = makeCard('prompt', x + 400, y + 380)
      if (mp.kind === 'prompt') mp.data.text = ''
      const q = makeCard('processor', x + 800, y - 40, { agent: defaultMotionAgent, animate: true })
      if (q.kind === 'processor') q.data.slots.push(newId('s'))
      const qs = q.kind === 'processor' ? q.data.slots : []
      const o2 = sized(makeCard('output', x + 1180, y - 60))
      n = { ...n, cards: [...n.cards, mp, q, o2] }
      n = connect(n, o.id, q.id, qs[0]); n = connect(n, mp.id, q.id, qs[1]); n = connect(n, q.id, o2.id, OUTPUT_SLOT)
      return n
    })
  }

  const hasContent = (k: Card) => (k.kind === 'prompt' && !!k.data.text.trim()) || (k.kind === 'media' && k.data.files.length > 0) || (k.kind === 'output' && k.data.runs.length > 0)

  // Import images into a Media card (choose / drop / paste all land here).
  const addMedia = async (cardId: string, files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || isMotionAsset(f.name))
    if (!imgs.length) { if (files.length) notify('Use images, SVG or video here.'); return }
    setImporting((l) => [...l, cardId])
    try {
      const rels: string[] = []
      for (const f of imgs) rels.push(await store.importMedia(await readBase64(f), f.name || 'pasted.png'))
      change((c) => updateCard(c, cardId, (k) => (k.kind === 'media' ? { ...k, data: { files: [...k.data.files, ...rels] } } : k)))
    } catch (e) { failed('Add files')(e) } finally { setImporting((l) => l.filter((x) => x !== cardId)) }
  }

  // An image already in the folder (dragged from the Saved panel or an Output card) is copied
  // into inputs/, so the Media card keeps working if the saved copy is removed later.
  const addMediaRefs = async (cardId: string, rels: string[]) => {
    if (!folder || !rels.length) return
    setImporting((l) => [...l, cardId])
    try {
      const out: string[] = []
      for (const rel of rels) {
        const dataUrl: string = await api.files.readDataUrl(folder, rel)
        out.push(await store.importMedia(dataUrl.replace(/^data:[^,]*,/, ''), rel.split('/').pop() || 'image.png'))
      }
      change((c) => updateCard(c, cardId, (k) => (k.kind === 'media' ? { ...k, data: { files: [...k.data.files, ...out] } } : k)))
    } catch (e) { failed('Add image')(e) } finally { setImporting((l) => l.filter((x) => x !== cardId)) }
  }

  const addMediaRefsRef = useRef(addMediaRefs); addMediaRefsRef.current = addMediaRefs
  // ⌘V anywhere on the canvas: images go into the selected Media card, or a new Media card
  // when none is selected (Hien, 2026-10-05: pasting needed a click on one exact spot).
  // Pasting into a text field stays a normal text paste.
  const addMediaRef = useRef(addMedia); addMediaRef.current = addMedia
  useEffect(() => {
    if (!active || !folder || !loaded) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, [contenteditable="true"]') || t.closest('.modal, .media-viewer'))) return
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f && f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      const one = selectedRef.current.length === 1 ? selectedRef.current[0] : null
      const sel = canvasRef.current.cards.find((k) => k.id === one)
      if (sel?.kind === 'media') { void addMediaRef.current(sel.id, files); return }
      const p = spot('media')
      const m = makeCard('media', p.x, p.y)
      change((c) => ({ ...c, cards: [...c.cards, m] }))
      setSelectedIds([m.id])
      void addMediaRef.current(m.id, files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, folder, loaded])

  // Stable while the folder and agent list stay the same: every callback reads the latest
  // state through refs, so editing one card doesn't re-render the others (image perf).
  const ctx: CardCtx = useMemo(() => ({
    addMedia: (id, files) => addMediaRef.current(id, files),
    addMediaRefs: (id, rels) => addMediaRefsRef.current(id, rels),
    root: folder || '', agents, motionAgents,
    patch: (id, fn) => change((c) => updateCard(c, id, fn)),
    remove: async (id) => {
      const k = canvasRef.current.cards.find((x) => x.id === id)
      if (!k) return
      if (runningRef.current[id]) { notify('Stop the run before removing this card.'); return }
      if (hasContent(k) && !(await confirmDialog({ title: `Remove this ${cardLabel(k)} card?`, message: 'Its files stay in the folder.', confirmLabel: 'Remove' }))) return
      change((c) => removeCard(c, id))
    },
    addSlot: (id) => change((c) => updateCard(c, id, (k) => (k.kind === 'processor' ? { ...k, data: { ...k.data, slots: [...k.data.slots, newId('s')] } } : k))),
    removeSlot: (id, slot) => change((c) => removeSlot(c, id, slot)),
    run: async (id) => {
      const c = canvasRef.current
      const p = c.cards.find((k) => k.id === id)
      if (!p || p.kind !== 'processor' || runningRef.current[id]) return
      const inputs = gatherInputs(c, id)
      const problem = validateRun(inputs)
      if (problem) { notify(problem); return }
      const animate = isAnimateCard(p)
      // An Output holding the other kind (images on an Animate card, or the reverse) is
      // disconnected and a fresh one takes its place, so one Output never mixes both.
      const outs = outputsOf(c, id)
      const other = outs.filter((o) => holdsOtherKind(o, animate))
      if (other.length || !outs.length) {   // every run needs somewhere to land
        const o = makeCard('output', p.x + CARD_W.processor + 60, p.y + (other.length ? 40 : 0))
        const fresh = animate ? sized(o) : o
        change((cur) => connect({ ...cur, cards: [...cur.cards, fresh], edges: cur.edges.filter((e) => !(e.from === id && other.some((x) => x.id === e.to))) }, id, fresh.id, OUTPUT_SLOT))
      }
      const { agent, model, count } = p.data
      const seconds = p.data.seconds ?? DEFAULT_SECONDS
      const hash = inputsHash(inputs, agent, model, runSize(p.data))
      try {
        const runId: string = animate
          ? await api.motion.run({ agent, model, prompt: inputs.prompt, refs: inputs.refs, seconds })
          // An Image card takes only pictures from its inputs (an animation or a video can't be a reference).
          : await api.image.run({ agent, model, prompt: inputs.prompt, refs: inputs.refs.filter(isImagePath), groups: inputs.groups?.map((g) => ({ ...g, refs: g.refs.filter(isImagePath) })).filter((g) => g.refs.length), count })
        const cid = canvasIdRef.current
        if (cid) setRuns((m) => ({ ...m, [runId]: { runId, label: 'Starting…', startedAt: Date.now(), hash, canvasId: cid, pid: id, animate } }))
      } catch (e) { failed('Run')(e) }
    },
    // By card id, or by run id (an Output stops the change run filling it).
    stop: (id) => { const r = runningRef.current[id] ?? Object.values(runningRef.current).find((x) => x.runId === id); if (r) store.cancel(r.runId).catch(failed('Stop')) },
    openImage: (rel) => setViewing(rel),
    toggleSaved: async (outputId, rel, hint) => {
      const o = canvasRef.current.cards.find((k) => k.id === outputId)
      if (!o || o.kind !== 'output') return
      const setLink = (v: string | null) => change((c) => updateCard(c, outputId, (k) => {
        if (k.kind !== 'output') return k
        const saved = { ...k.data.saved }
        if (v) saved[rel] = v; else delete saved[rel]
        return { ...k, data: { ...k.data, saved } }
      }))
      try {
        const cur = o.data.saved[rel]
        if (cur) { await api.image.unsaveImage(cur); setLink(null) }
        else { const dest: string = await api.image.saveImage(rel, hint, canvasIdRef.current ?? ''); setLink(dest); notify(`Saved to ${dest}`) }
        setSavedVersion((v) => v + 1)
      } catch (e) { failed('Save image')(e) }
    },
    deleteRun: async (runId) => {
      const c = canvasRef.current
      const owners = c.cards.filter((k) => k.kind === 'output' && k.data.runs.some((r) => r.id === runId))
      const savedCount = owners.reduce((n, k) => n + (k.kind === 'output' ? (k.data.runs.find((r) => r.id === runId)?.files ?? []).filter((f) => k.data.saved[f]).length : 0), 0)
      if (!(await confirmDialog({ title: 'Delete this version?', message: `Its images are removed from outputs/.${savedCount ? ` ${savedCount} saved cop${savedCount > 1 ? 'ies stay' : 'y stays'} in saved/.` : ''}`, confirmLabel: 'Delete' }))) return
      try {
        await store.deleteRun(runId, canvasIdRef.current ?? '')
        change((cur) => ({ ...cur, cards: cur.cards.map((k) => withoutRun(k, runId)) }))
      } catch (e) { failed('Delete version')(e) }
    },
    motion: {
      change: async (outId, file, text) => {
        const c = canvasRef.current
        const o = c.cards.find((k) => k.id === outId)
        if (!o || o.kind !== 'output' || runningRef.current[outId]) return
        const e = c.edges.find((x) => x.to === outId && x.slot === OUTPUT_SLOT)
        const p = c.cards.find((k) => k.id === e?.from)
        const last = [...o.data.runs].reverse().find((r) => r.files.length)
        const agent = p?.kind === 'processor' ? p.data.agent : last?.agent
        const model = p?.kind === 'processor' ? p.data.model : last?.model ?? ''
        const seconds = p?.kind === 'processor' ? p.data.seconds ?? DEFAULT_SECONDS : DEFAULT_SECONDS
        if (!agent) return
        try {
          const runId: string = await api.motion.run({ agent, model, prompt: '', refs: [], seconds, base: file, change: text })
          const cid = canvasIdRef.current
          if (cid) setRuns((m) => ({ ...m, [runId]: { runId, label: 'Changing the animation…', startedAt: Date.now(), hash: last?.inputsHash ?? '', canvasId: cid, pid: outId, outId, change: text, agent, model, animate: true } }))
        } catch (err) { failed('Ask for a change')(err) }
      },
      undo: (outId) => {
        const c = canvasRef.current
        const o = c.cards.find((k) => k.id === outId)
        if (!o || o.kind !== 'output' || o.data.runs.length < 2 || runningRef.current[outId]) return
        const last = o.data.runs[o.data.runs.length - 1]
        const elsewhere = c.cards.some((k) => k.id !== outId && k.kind === 'output' && k.data.runs.some((r) => r.id === last.id))
        change((cur) => updateCard(cur, outId, (k) => withoutRun(k, last.id)))
        if (!elsewhere) void store.deleteRun(last.id, canvasIdRef.current ?? '').catch(() => {})
      },
      save: async (outId, file) => {
        try {
          const dest: string = await api.image.saveImage(file, prevDerived.current?.get(outId)?.hint ?? '', canvasIdRef.current ?? '')
          change((c) => updateCard(c, outId, (k) => (k.kind === 'output' ? { ...k, data: { ...k.data, saved: { ...k.data.saved, [file]: dest } } } : k)))
          notify(`Saved to ${dest}`)
          setSavedVersion((v) => v + 1)
        } catch (e) { failed('Save animation')(e) }
      },
      exportLottie: async (file) => {
        const name = indexRef.current?.tabs.find((t) => t.id === canvasIdRef.current)?.name ?? 'animation'
        const to = await api.motion.exportLottie(file, name).catch(failed('Export'))
        if (to) notify(`Exported to ${to}`)
      }
    }
  }), [folder, agents, motionAgents])

  // An animation Output keeps its current animation and the one Undo goes back to; older runs'
  // folders are deleted (unless another card still shows them). Image Outputs keep every version.
  const isAnimOutput = (k: Card) => k.kind === 'output' && k.data.runs.some((r) => r.files.some(isAnimationFile))
  useEffect(() => {
    if (!loaded) return
    const drop = new Set<string>()
    for (const k of canvas.cards) {
      if (k.kind !== 'output' || !isAnimOutput(k) || runningRef.current[k.id]) continue
      const good = k.data.runs.map((r, i) => (r.files.length ? i : -1)).filter((i) => i >= 0)
      if (good.length <= KEEP_GOOD_RUNS) continue
      for (const r of k.data.runs.slice(0, good[good.length - KEEP_GOOD_RUNS])) drop.add(r.id)
    }
    if (!drop.size) return
    // Drop per card first; delete a folder only when no card refers to that run any more.
    const next = canvas.cards.map((k) => {
      if (k.kind !== 'output' || !isAnimOutput(k)) return k
      const good = k.data.runs.map((r, i) => (r.files.length ? i : -1)).filter((i) => i >= 0)
      if (good.length <= KEEP_GOOD_RUNS || runningRef.current[k.id]) return k
      return k.data.runs.slice(0, good[good.length - KEEP_GOOD_RUNS]).reduce((acc, r) => withoutRun(acc, r.id), k as Card)
    })
    const still = new Set(next.flatMap((k) => (k.kind === 'output' ? k.data.runs.map((r) => r.id) : [])))
    setCanvas((c) => ({ ...c, cards: c.cards.map((k) => next.find((n) => n.id === k.id) ?? k) }))
    for (const id of drop) if (!still.has(id) && !runsRef.current[id]) void store.deleteRun(id, canvasIdRef.current ?? '').catch(() => {})
  }, [canvas.cards, loaded])

  // Delete / Backspace removes the selected card (same confirm as its ✕ when it has content);
  // Escape deselects. Ignored while typing in a field or when a dialog/lightbox is open.
  const removeRef = useRef(ctx.remove); removeRef.current = ctx.remove
  // Several selected cards go in one step, with one confirm if any of them has content.
  const removeMany = async (ids: string[]) => {
    const ks = canvasRef.current.cards.filter((k) => ids.includes(k.id))
    if (ks.some((k) => runningRef.current[k.id])) { notify('Stop the run before removing these cards.'); return }
    if (ks.some(hasContent) && !(await confirmDialog({ title: `Remove ${ks.length} cards?`, message: 'Image files stay in the folder.', confirmLabel: 'Remove' }))) return
    change((c) => ks.reduce((acc, k) => removeCard(acc, k.id), c))
  }
  const removeManyRef = useRef(removeMany); removeManyRef.current = removeMany
  // A removed card can't stay selected (whichever way it was removed).
  useEffect(() => {
    if (!selectedIds.length) return
    const ids = new Set(canvas.cards.map((k) => k.id))
    const keep = selectedIds.filter((id) => ids.has(id))
    if (keep.length !== selectedIds.length) setSelectedIds(keep)
  }, [canvas.cards, selectedIds])
  // What each card shows from other cards, run state and imports — one index per canvas
  // version, and the same object for a card whose view didn't change (memoized cards).
  const prevDerived = useRef<Map<string, CardData> | null>(null)
  // Moving cards changes only positions: if every card's data, the edges, runs and imports are
  // the same objects as last time, the views are too (a card drag skips the work entirely).
  const lastInputs = useRef<{ datas: unknown[]; edges: unknown; running: unknown; importing: unknown } | null>(null)
  const derived = useMemo(() => {
    const li = lastInputs.current
    if (li && prevDerived.current && li.edges === canvas.edges && li.running === running && li.importing === importing &&
      li.datas.length === canvas.cards.length && canvas.cards.every((k, i) => k.data === li.datas[i] && prevDerived.current!.has(k.id))) return prevDerived.current
    lastInputs.current = { datas: canvas.cards.map((k) => k.data), edges: canvas.edges, running, importing }
    const ix = indexCanvas(canvas)
    const views = cardViews(canvas, (pid) => !!running[pid], ix) as Map<string, CardData>
    const busy = new Set(importing)
    for (const [id, v] of views) {
      const k = ix.byId.get(id)
      if (k?.kind === 'processor' && running[id]) views.set(id, { ...v, run: running[id] })
      else if (k?.kind === 'output' && running[id]) views.set(id, { ...v, run: running[id] })   // Motion: a change run on this Result
      else if (k?.kind === 'output' && v.procId && running[v.procId]) views.set(id, { ...v, run: running[v.procId] })
      else if (k?.kind === 'media' && busy.has(id)) views.set(id, { ...v, busy: true })
    }
    return (prevDerived.current = stabilize(prevDerived.current, views))
  }, [canvas.cards, canvas.edges, running, importing])
  useEffect(() => {
    if (!active || !folder || !loaded) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.modal, .media-viewer'))) return
      if (document.querySelector('.modal, .media-viewer')) return
      // P / M / R / O add a Prompt, Media, Processor (R = run) or Output card (D-102).
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const kind = CARD_SHORTCUTS[e.key.toLowerCase()]
        if (kind) { e.preventDefault(); addCardRef.current(kind); return }
      }
      // ⌘A selects every card on this canvas.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelectedIds(canvasRef.current.cards.map((k) => k.id)); return }
      const ids = selectedRef.current
      if (!ids.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (ids.length === 1) removeRef.current(ids[0])
        else removeManyRef.current(ids)
      } else if (e.key === 'Escape') setSelectedIds([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, folder, loaded])

  const onConnect = (from: string, to: string, slot: string) => {
    const chk = canConnect(canvasRef.current, from, to, slot)
    if (!chk.ok) { notify(chk.reason); return }
    change((c) => connect(c, from, to, slot))
  }

  // ── Canvas tabs (D-102) ──
  const switchTo = async (id: string) => {
    if (id === canvasIdRef.current) return
    await flush()
    const ix: CanvasIndex | undefined = await store.setActive(id).catch(failed('Switch canvas'))
    if (!ix) return
    setIndex(ix)
    await openCanvas(ix.active)
  }
  const afterIndexChange = async (ix: CanvasIndex | undefined) => {
    if (!ix) return
    const changed = ix.active !== canvasIdRef.current
    setIndex(ix)
    if (changed) await openCanvas(ix.active)
  }
  const createCanvas = async () => { await flush(); await afterIndexChange(await store.createCanvas(canvasIdRef.current ?? undefined).catch(failed('New canvas'))) }
  const duplicateCanvas = async (id: string) => { await flush(); await afterIndexChange(await store.duplicateCanvas(id).catch(failed('Duplicate canvas'))) }
  const renameCanvas = async (id: string, name: string) => { const ix = await store.renameCanvas(id, name).catch(failed('Rename canvas')); if (ix) setIndex(ix) }
  const nameOf = (id: string) => index?.tabs.find((t) => t.id === id)?.name ?? 'this canvas'
  const clearCanvas = async (id: string) => {
    if (busyCanvases.has(id)) { notify('Stop the running images on that canvas before clearing it.'); return }
    if (!(await confirmDialog({ title: `Clear “${nameOf(id)}”?`, message: 'Every card is removed. Your images stay in the folder, and the old canvas is kept in .history/.', confirmLabel: 'Clear' }))) return
    if (id === canvasIdRef.current) {
      pending.current = null
      const c: Canvas | undefined = await store.clear(id).catch(failed('Clear canvas'))
      if (c) { setSelectedIds([]); setCanvas(c) }
    } else await store.clear(id).catch(failed('Clear canvas'))
  }
  const deleteCanvas = async (id: string) => {
    if (busyCanvases.has(id)) { notify('Stop the running images on that canvas before deleting it.'); return }
    if (!(await confirmDialog({ title: `Delete “${nameOf(id)}”?`, message: 'Its images stay in the folder, and the canvas is kept in .history/.', confirmLabel: 'Delete' }))) return
    if (id === canvasIdRef.current) pending.current = null   // don't write it back after deleting
    await afterIndexChange(await store.deleteCanvas(id).catch(failed('Delete canvas')))
  }

  // Zoom around the middle of the visible canvas, so what you're looking at stays put.
  const zoomTo = (fn: (z: number) => number) => change((c) => {
    const r = wrap.current?.getBoundingClientRect()
    const mx = r ? r.width / 2 : 0, my = r ? r.height / 2 : 0
    const z = Math.max(0.25, Math.min(2, Math.round(fn(c.view.zoom) * 100) / 100))
    const k = z / c.view.zoom
    return { ...c, view: { zoom: z, x: mx - (mx - c.view.x) * k, y: my - (my - c.view.y) * k } }
  })
  const zoomIn = () => zoomTo((z) => z * 1.2)
  const zoomOut = () => zoomTo((z) => z / 1.2)
  const resetZoom = () => zoomTo(() => 1)

  return (
    <div className="img-view">
      <div className="img-head">
        <span className="md-head-title">Image Creation</span>
        {folder && index && (
          <>
            <span className="img-head-sep" />
            <CanvasTabs index={index} busy={busyCanvases} onSelect={(id) => void switchTo(id)} onCreate={() => void createCanvas()}
              onRename={(id, n) => void renameCanvas(id, n)} onDuplicate={(id) => void duplicateCanvas(id)}
              onClear={(id) => void clearCanvas(id)} onDelete={(id) => void deleteCanvas(id)} />
            <IconButton className={`img-saved-toggle${savedOpen ? ' on' : ''}`} aria-pressed={savedOpen} title={savedOpen ? 'Hide saved images' : 'Show saved images'} onClick={() => setSavedOpen((v) => !v)}><Icon name="sidebar" size="nav" /></IconButton>
          </>
        )}
      </div>

      {folder === undefined && <div className="md-placeholder">Loading…</div>}

      {folder === null && (
        <div className="img-gate">
          <div className="img-gate-icon"><Icon name="image" size="xl" /></div>
          <h2>Connect a folder to use Image</h2>
          <p>Image keeps the canvases, your references, and every generated image and animation in one folder on your {OS_WORDS.computer}, so nothing is lost when you clear the canvas. Choose it in Settings ▸ Image.</p>
          <Button variant="primary" onClick={() => openSettings('image')}><Icon name="settings" size="md" /> Open Settings ▸ Image</Button>
        </div>
      )}

      {folder && loaded && (
        <div className="img-body">
        <div className="img-stage" ref={wrap} onDragOver={onStageDragOver} onDrop={onStageDrop}>
          <CardPalette onAdd={(k) => addCard(k)} />
          <ImageCanvas
            canvas={canvas}
            onChange={change}
            onViewCommit={onViewCommit}
            ctx={ctx}
            derived={derived}
            heights={heights}
            onConnect={onConnect}
            onRemoveEdge={onRemoveEdge}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            empty={
              <div className="img-empty">
                <p>Feed a Prompt and Media into an Image card to make pictures, or into an Animate card to make a Lottie animation — or connect an image Output into Animate to bring it to life.</p>
                <div className="img-empty-actions">
                  <Button variant="primary" onClick={() => addTemplate(false)}><Icon name="plus" size="sm" /> Prompt → Image → Output</Button>
                  <Button onClick={() => addTemplate(true)}><Icon name="film" size="sm" /> Image → Animate</Button>
                </div>
                {!agents.length && <p className="img-empty-warn">No agent that can make images is on. Turn on Codex, Grok, Gemini or Claude in Settings ▸ Agents.</p>}
              </div>
            }
          />
          <div className="img-zoombar" role="group" aria-label="Zoom">
            <button title="Zoom out" onClick={zoomOut} disabled={canvas.view.zoom <= 0.25}><Icon name="minus" size="md" /></button>
            <button className="img-zoom-level" title="Zoom to 100% (⌘/ctrl + scroll to zoom)" onClick={resetZoom}>{Math.round(canvas.view.zoom * 100)}%</button>
            <button title="Zoom in" onClick={zoomIn} disabled={canvas.view.zoom >= 2}><Icon name="plus" size="md" /></button>
          </div>
        </div>
        {savedOpen && <SavedPanel root={folder} version={savedVersion} onOpen={setViewing} onClose={() => setSavedOpen(false)} />}
        </div>
      )}

      {viewing && folder && <MediaViewer src={fileUrl(folder, viewing)} root={folder} relPath={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
