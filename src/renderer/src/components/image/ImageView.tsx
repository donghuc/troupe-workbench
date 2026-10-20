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
import { CardView, readBase64, type CardCtx, type RunState } from './ImageCards'
import SavedPanel from './SavedPanel'
import CardPalette, { CARD_DRAG_TYPE, CARD_SHORTCUTS } from './CardPalette'
import CanvasTabs from './CanvasTabs'
import { fileUrl, CARD_W, IMAGE_REF_TYPE } from './geometry'
import {
  emptyCanvas, makeCard, connect, canConnect, removeCard, removeSlot, updateCard, gatherInputs, validateRun, inputsHash,
  outputsOf, newId, isImageAgent, withoutRun, findFreeSpot, IMAGE_AGENTS, OUTPUT_SLOT, CARD_LABEL,
  type Canvas, type Card, type CardKind, type RunRecord, type ImageRunEvent, type ImageRunDone,
  applyRunResult, type CanvasIndex
} from '../../../../shared/imageCanvas'

// Image (D-088): a single open canvas, kept as canvas.json in one global folder.
// Prompt + Media → Processor (one image agent) → Output. Sits below Projects in the sidebar.
export default function ImageView({ active = true }: { active?: boolean }) {
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
  const [runs, setRuns] = useState<Record<string, RunState & { canvasId: string; pid: string }>>({})
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
  const canvasRef = useRef(canvas); canvasRef.current = canvas
  const runningRef = useRef(running); runningRef.current = running
  const allAgents = useAgentList()
  // In IMAGE_AGENTS order (Codex first, Claude · SVG last), so a new Processor defaults to a
  // real image generator — the app's own agent order starts with Claude.
  const agents = useMemo(() => allAgents.filter((a) => isImageAgent(a.id)).sort((a, b) => IMAGE_AGENTS.indexOf(a.id) - IMAGE_AGENTS.indexOf(b.id)), [allAgents])
  const defaultAgent = agents[0]?.id ?? IMAGE_AGENTS[0]
  const busyCanvases = useMemo(() => new Set(Object.values(runs).map((r) => r.canvasId)), [runs])

  const openCanvas = async (id: string) => {
    setLoaded(false)
    setSelectedIds([])
    setCanvas(await api.image.load(id).catch((e: unknown) => { failed('Open canvas')(e); return emptyCanvas() }))
    setLoaded(true)
  }
  const load = async () => {
    setLoaded(false)
    const f: string | null = await api.image.folder().catch(() => null)
    setFolder(f)
    if (!f) return
    const ix: CanvasIndex | undefined = await api.image.canvases().catch(failed('Open canvases'))
    if (!ix) return
    setIndex(ix)
    await openCanvas(ix.active)
  }
  useEffect(() => { void load() }, [])
  // The folder is set in Settings ▸ Image only. When it changes, stop runs writing into the
  // old folder (their results would land on the wrong canvas) and open the new canvas.
  useEffect(() => {
    const onChange = () => {
      for (const r of Object.values(runsRef.current)) void api.image.cancel(r.runId).catch(() => {})
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
  const flush = () => { const p = pending.current; pending.current = null; if (p) return api.image.save(p.id, p.canvas).catch(failed('Save canvas')); return Promise.resolve() }
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
      const rec = { id: runId, at: new Date().toISOString(), files, ...(error ? { error } : {}), inputsHash: st.hash }
      const gap = CARD_W.processor + 60
      if (st.canvasId === canvasIdRef.current) {
        setCanvas((c) => applyRunResult(c, st.pid, rec, gap))
      } else {
        // Finished on a canvas that isn't on screen: update its file directly.
        void api.image.load(st.canvasId).then((c: Canvas) => api.image.save(st.canvasId, applyRunResult(c, st.pid, rec, gap))).catch(failed('Save run result'))
        const name = indexRef.current?.tabs.find((t) => t.id === st.canvasId)?.name
        if (!error && name) notify(`Images ready in “${name}”`)
      }
      if (error && error !== 'Stopped' && !files.length) notify(`Image run failed: ${error.slice(0, 160)}`)
    })
    return () => { offEv(); offDone() }
  }, [])

  const change = (fn: (c: Canvas) => Canvas) => setCanvas(fn)

  // New cards land near the middle of what's on screen, nudged so they don't stack.
  // Where a new card goes: the middle of the view, moved to the nearest free space so it
  // never lands on top of another card. Heights are read from the rendered cards.
  const spot = (kind: CardKind = 'processor'): { x: number; y: number } => {
    const r = wrap.current?.getBoundingClientRect()
    const v = canvasRef.current.view
    const cx = ((r ? r.width / 2 : 400) - v.x) / v.zoom - CARD_W[kind] / 2
    const cy = ((r ? r.height / 2 : 300) - v.y) / v.zoom - 120
    const taken = canvasRef.current.cards.map((k) => {
      const el = wrap.current?.querySelector(`[data-card-id="${k.id}"]`) as HTMLElement | null
      return { x: k.x, y: k.y, w: CARD_W[k.kind], h: el?.offsetHeight ?? 240 }
    })
    const p = findFreeSpot(taken, { x: Math.round(cx), y: Math.round(cy) }, { w: CARD_W[kind], h: 240 })
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }
  const addCard = (kind: CardKind, at?: { x: number; y: number }) => {
    const p = at ?? spot(kind)
    const card = makeCard(kind, Math.round(p.x), Math.round(p.y), { agent: defaultAgent })
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
    const kind = e.dataTransfer.getData(CARD_DRAG_TYPE) as CardKind
    if (!kind) return
    e.preventDefault()
    const r = wrap.current?.getBoundingClientRect(); const v = canvasRef.current.view
    if (!r) { addCard(kind); return }
    addCard(kind, { x: (e.clientX - r.left - v.x) / v.zoom - 20, y: (e.clientY - r.top - v.y) / v.zoom - 20 })
  }

  const addTemplate = () => {
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
      return n
    })
  }

  const hasContent = (k: Card) => (k.kind === 'prompt' && !!k.data.text.trim()) || (k.kind === 'media' && k.data.files.length > 0) || (k.kind === 'output' && k.data.runs.length > 0)

  // Import images into a Media card (choose / drop / paste all land here).
  const addMedia = async (cardId: string, files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) { if (files.length) notify('Only images can be used as references.'); return }
    setImporting((l) => [...l, cardId])
    try {
      const rels: string[] = []
      for (const f of imgs) rels.push(await api.image.importMedia(await readBase64(f), f.name || 'pasted.png'))
      change((c) => updateCard(c, cardId, (k) => (k.kind === 'media' ? { ...k, data: { files: [...k.data.files, ...rels] } } : k)))
    } catch (e) { failed('Add images')(e) } finally { setImporting((l) => l.filter((x) => x !== cardId)) }
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
        out.push(await api.image.importMedia(dataUrl.replace(/^data:[^,]*,/, ''), rel.split('/').pop() || 'image.png'))
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

  const ctx: CardCtx = {
    addMedia, addMediaRefs, importing,
    canvas, root: folder || '', agents, running,
    patch: (id, fn) => change((c) => updateCard(c, id, fn)),
    remove: async (id) => {
      const k = canvasRef.current.cards.find((x) => x.id === id)
      if (!k) return
      if (running[id]) { notify('Stop the run before removing this card.'); return }
      if (hasContent(k) && !(await confirmDialog({ title: `Remove this ${CARD_LABEL[k.kind]} card?`, message: 'Image files stay in the folder.', confirmLabel: 'Remove' }))) return
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
      if (!outputsOf(c, id).length) {   // every run needs somewhere to land
        const o = makeCard('output', p.x + CARD_W.processor + 60, p.y)
        change((cur) => connect({ ...cur, cards: [...cur.cards, o] }, id, o.id, OUTPUT_SLOT))
      }
      const { agent, model, count } = p.data
      const hash = inputsHash(inputs, agent, model, count)
      try {
        const runId: string = await api.image.run({ agent, model, prompt: inputs.prompt, refs: inputs.refs, count })
        const cid = canvasIdRef.current
        if (cid) setRuns((m) => ({ ...m, [runId]: { runId, label: 'Starting…', startedAt: Date.now(), hash, canvasId: cid, pid: id } }))
      } catch (e) { failed('Run')(e) }
    },
    stop: (id) => { const r = runningRef.current[id]; if (r) api.image.cancel(r.runId).catch(failed('Stop')) },
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
        else { const dest: string = await api.image.saveImage(rel, hint); setLink(dest); notify(`Saved to ${dest}`) }
        setSavedVersion((v) => v + 1)
      } catch (e) { failed('Save image')(e) }
    },
    deleteRun: async (runId) => {
      const c = canvasRef.current
      const owners = c.cards.filter((k) => k.kind === 'output' && k.data.runs.some((r) => r.id === runId))
      const savedCount = owners.reduce((n, k) => n + (k.kind === 'output' ? (k.data.runs.find((r) => r.id === runId)?.files ?? []).filter((f) => k.data.saved[f]).length : 0), 0)
      if (!(await confirmDialog({ title: 'Delete this version?', message: `Its images are removed from outputs/.${savedCount ? ` ${savedCount} saved cop${savedCount > 1 ? 'ies stay' : 'y stays'} in saved/.` : ''}`, confirmLabel: 'Delete' }))) return
      try {
        await api.image.deleteRun(runId, canvasIdRef.current ?? '')
        change((cur) => ({ ...cur, cards: cur.cards.map((k) => withoutRun(k, runId)) }))
      } catch (e) { failed('Delete version')(e) }
    }
  }

  // Delete / Backspace removes the selected card (same confirm as its ✕ when it has content);
  // Escape deselects. Ignored while typing in a field or when a dialog/lightbox is open.
  const removeRef = useRef(ctx.remove); removeRef.current = ctx.remove
  // Several selected cards go in one step, with one confirm if any of them has content.
  const removeMany = async (ids: string[]) => {
    const ks = canvasRef.current.cards.filter((k) => ids.includes(k.id))
    if (ks.some((k) => running[k.id])) { notify('Stop the run before removing these cards.'); return }
    if (ks.some(hasContent) && !(await confirmDialog({ title: `Remove ${ks.length} cards?`, message: 'Image files stay in the folder.', confirmLabel: 'Remove' }))) return
    change((c) => ks.reduce((acc, k) => removeCard(acc, k.id), c))
  }
  const removeManyRef = useRef(removeMany); removeManyRef.current = removeMany
  // A removed card can't stay selected (whichever way it was removed).
  useEffect(() => {
    const keep = selectedIds.filter((id) => canvas.cards.some((k) => k.id === id))
    if (keep.length !== selectedIds.length) setSelectedIds(keep)
  }, [canvas, selectedIds])
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
    const ix: CanvasIndex | undefined = await api.image.setActive(id).catch(failed('Switch canvas'))
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
  const createCanvas = async () => { await flush(); await afterIndexChange(await api.image.createCanvas(canvasIdRef.current ?? undefined).catch(failed('New canvas'))) }
  const duplicateCanvas = async (id: string) => { await flush(); await afterIndexChange(await api.image.duplicateCanvas(id).catch(failed('Duplicate canvas'))) }
  const renameCanvas = async (id: string, name: string) => { const ix = await api.image.renameCanvas(id, name).catch(failed('Rename canvas')); if (ix) setIndex(ix) }
  const nameOf = (id: string) => index?.tabs.find((t) => t.id === id)?.name ?? 'this canvas'
  const clearCanvas = async (id: string) => {
    if (busyCanvases.has(id)) { notify('Stop the running images on that canvas before clearing it.'); return }
    if (!(await confirmDialog({ title: `Clear “${nameOf(id)}”?`, message: 'Every card is removed. Your images stay in the folder, and the old canvas is kept in .history/.', confirmLabel: 'Clear' }))) return
    if (id === canvasIdRef.current) {
      pending.current = null
      const c: Canvas | undefined = await api.image.clear(id).catch(failed('Clear canvas'))
      if (c) { setSelectedIds([]); setCanvas(c) }
    } else await api.image.clear(id).catch(failed('Clear canvas'))
  }
  const deleteCanvas = async (id: string) => {
    if (busyCanvases.has(id)) { notify('Stop the running images on that canvas before deleting it.'); return }
    if (!(await confirmDialog({ title: `Delete “${nameOf(id)}”?`, message: 'Its images stay in the folder, and the canvas is kept in .history/.', confirmLabel: 'Delete' }))) return
    if (id === canvasIdRef.current) pending.current = null   // don't write it back after deleting
    await afterIndexChange(await api.image.deleteCanvas(id).catch(failed('Delete canvas')))
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
          <p>Image keeps the canvas, your reference images and every generated image in one folder on your {OS_WORDS.computer}, so nothing is lost when you clear the canvas. Choose it in Settings ▸ Image.</p>
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
            onConnect={onConnect}
            onRemoveEdge={(id) => change((c) => ({ ...c, edges: c.edges.filter((e) => e.id !== id) }))}
            renderCard={(k, ui) => <CardView card={k} ui={ui} ctx={ctx} />}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            empty={
              <div className="img-empty">
                <p>Add a Prompt and Media, feed them into a Processor, and see the result in an Output.</p>
                <Button variant="primary" onClick={addTemplate}><Icon name="plus" size="sm" /> Start with Prompt → Processor → Output</Button>
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
