import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { OS_WORDS } from '../../../../shared/platform'
import Icon from '../Icon'
import { shortDate } from '../../dates'
import ProviderAvatar from '../ProviderAvatar'
import { api } from '../../api'
import { failed, notify } from '../../notices'
import { presetsFor } from '../../models'
import {
  CARD_LABEL, gatherInputs, inputsHash, processorOf, outputImages, isVectorAgent, OUTPUT_SLOT,
  type Canvas, type Card, type RunRecord
} from '../../../../shared/imageCanvas'
import type { ProviderId, ProviderInfo } from '../../../../shared/types'
import type { CardUi } from './ImageCanvas'
import { fileUrl, IMAGE_REF_TYPE } from './geometry'
import { Button, IconButton } from '../ui/Button'

export interface RunState { runId: string; label: string; startedAt: number; hash: string }

export interface CardCtx {
  canvas: Canvas
  root: string
  agents: ProviderInfo[]                      // image-capable agents that are on
  running: Record<string, RunState>           // by processor id
  patch: (id: string, fn: (k: Card) => Card) => void
  remove: (id: string) => void
  addSlot: (id: string) => void
  removeSlot: (id: string, slot: string) => void
  run: (id: string) => void
  stop: (id: string) => void
  openImage: (rel: string) => void
  toggleSaved: (outputId: string, rel: string, hint: string) => void   // copy into saved/ or remove that copy
  deleteRun: (runId: string) => void                                   // delete a version and its outputs/ folder
  addMedia: (cardId: string, files: File[]) => Promise<void>             // import images into a Media card
  addMediaRefs: (cardId: string, rels: string[]) => Promise<void>        // copy folder images (saved/, outputs/) into a Media card
  importing: string[]                                                  // Media cards currently importing
}

type CardOf<K extends Card['kind']> = Extract<Card, { kind: K }>

// ── Shared chrome ─────────────────────────────────────────────────────────────
function Head({ card, ui, ctx, children }: { card: Card; ui: CardUi; ctx: CardCtx; children?: ReactNode }) {
  return (
    <div className="img-card-head" onPointerDown={ui.startDrag}>
      <span className={`img-kind img-kind-${card.kind}`}>{CARD_LABEL[card.kind]}</span>
      <span className="img-card-head-extra">{children}</span>
      <IconButton className="img-card-x" title="Remove card" onPointerDown={(e) => e.stopPropagation()}
        onClick={() => ctx.remove(card.id)}><Icon name="close" size="sm" /></IconButton>
    </div>
  )
}

const OutPort = ({ ui }: { ui: CardUi }) => (
  <span className={`img-port img-port-out${ui.connectingFromHere ? ' active' : ''}`} title="Drag to connect" onPointerDown={ui.startConnect} />
)
const InPort = ({ card, slot, ui, filled }: { card: Card; slot: string; ui: CardUi; filled: boolean }) => {
  const st = ui.slotState(slot)
  return <span className={`img-port img-port-in${filled ? ' filled' : ''}${st ? ' ' + st : ''}`} data-card={card.id} data-slot={slot} />
}

export const readBase64 = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''))
  r.onerror = () => rej(r.error)
  r.readAsDataURL(f)
})

// ── Prompt ────────────────────────────────────────────────────────────────────
function PromptCard({ card, ui, ctx }: { card: CardOf<'prompt'>; ui: CardUi; ctx: CardCtx }) {
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx} />
      <OutPort ui={ui} />
      <div className="img-card-body">
        <textarea className="field-textarea img-prompt img-nowheel" placeholder="Describe the image you want…" value={card.data.text}
          onChange={(e) => { const text = e.target.value; ctx.patch(card.id, (k) => (k.kind === 'prompt' ? { ...k, data: { text } } : k)) }} />
      </div>
    </>
  )
}

// ── Media ─────────────────────────────────────────────────────────────────────
function MediaCard({ card, ui, ctx }: { card: CardOf<'media'>; ui: CardUi; ctx: CardCtx }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const busy = ctx.importing.includes(card.id)
  const add = (files: File[]) => ctx.addMedia(card.id, files)
  // Files from Finder, or an image already in the folder (Saved panel / Output card).
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(IMAGE_REF_TYPE)
  const onDrop = (e: DragEvent) => {
    setOver(false)
    const ref = e.dataTransfer.getData(IMAGE_REF_TYPE)
    if (ref) { e.preventDefault(); e.stopPropagation(); void ctx.addMediaRefs(card.id, [ref]); return }
    if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void add([...e.dataTransfer.files]) }
  }
  const files = card.data.files
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx}>{files.length > 0 && <span className="img-meta">{files.length} image{files.length > 1 ? 's' : ''}</span>}</Head>
      <OutPort ui={ui} />
      <div className={`img-card-body img-media${over ? ' over' : ''}`}
        onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {files.length > 0 && (
          <div className="img-thumbs">
            {files.map((f) => (
              <div key={f} className="img-thumb">
                <img src={fileUrl(ctx.root, f)} alt="" onClick={() => ctx.openImage(f)} />
                <button className="img-thumb-x" title="Remove" onClick={() => ctx.patch(card.id, (k) => (k.kind === 'media' ? { ...k, data: { files: k.data.files.filter((x) => x !== f) } } : k))}><Icon name="close" size="xs" /></button>
              </div>
            ))}
          </div>
        )}
        <button className="img-drop" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <><span className="activity-spinner" /> Adding…</> : <><Icon name="image" size="md" /> {files.length ? 'Add more' : `Drop, paste (${OS_WORDS.mod}V) or choose images`}</>}
        </button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
    </>
  )
}

// ── Processor ─────────────────────────────────────────────────────────────────
function sourceLabel(src: Card | undefined): string {
  if (!src) return 'Empty — drag an output here'
  if (src.kind === 'prompt') return src.data.text.trim() ? `Prompt · “${src.data.text.trim().slice(0, 28)}${src.data.text.trim().length > 28 ? '…' : ''}”` : 'Prompt · empty'
  if (src.kind === 'media') return `Media · ${src.data.files.length} image${src.data.files.length === 1 ? '' : 's'}`
  if (src.kind === 'output') { const n = outputImages(src).length; return `Output · ${n} image${n === 1 ? '' : 's'}` }
  return CARD_LABEL[src.kind]
}

function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(t) }, [on])
}

function ProcessorCard({ card, ui, ctx }: { card: CardOf<'processor'>; ui: CardUi; ctx: CardCtx }) {
  const run = ctx.running[card.id]
  useTick(!!run)
  const { agent, model, count, slots } = card.data
  const agentOn = ctx.agents.some((a) => a.id === agent)
  const models = presetsFor(agent)
  const set = (d: Partial<CardOf<'processor'>['data']>) => ctx.patch(card.id, (k) => (k.kind === 'processor' ? { ...k, data: { ...k.data, ...d } } : k))
  const last = lastRunOf(ctx.canvas, card.id)
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx}><ProviderAvatar id={agent} size="sm" /></Head>
      <OutPort ui={ui} />
      <div className="img-slots">
        {slots.map((s, i) => {
          const e = ctx.canvas.edges.find((x) => x.to === card.id && x.slot === s)
          const src = e && ctx.canvas.cards.find((k) => k.id === e.from)
          return (
            <div key={s} className="img-slot" data-card={card.id} data-slot={s}>
              <InPort card={card} slot={s} ui={ui} filled={!!src} />
              <span className={`img-slot-label truncate${src ? '' : ' empty'}`} title={sourceLabel(src)}>{i + 1}. {sourceLabel(src)}</span>
              {slots.length > 1 && <IconButton className="img-slot-x" title="Remove input" onClick={() => ctx.removeSlot(card.id, s)}><Icon name="close" size="xs" /></IconButton>}
            </div>
          )
        })}
      </div>
      <div className="img-card-body img-proc">
        <button className="img-add-slot" onClick={() => ctx.addSlot(card.id)}><Icon name="plus" size="sm" /> Add input</button>
        <div className="img-proc-row">
          <label className="img-field">
            <span>Agent</span>
            <select className="field-input" value={agent} disabled={!!run} onChange={(e) => set({ agent: e.target.value as ProviderId, model: '' })}>
              {!agentOn && <option value={agent}>{agent} (off)</option>}
              {ctx.agents.map((a) => <option key={a.id} value={a.id}>{a.name}{isVectorAgent(a.id) ? ' · SVG' : ''}{a.installed ? '' : ' (not installed)'}</option>)}
            </select>
          </label>
          <label className="img-field">
            <span>Model</span>
            <select className="field-input" value={model} disabled={!!run} onChange={(e) => set({ model: e.target.value })}>
              {!models.some((m) => m.v === model) && <option value={model}>{model}</option>}
              {models.map((m) => <option key={m.v || 'default'} value={m.v}>{m.l}</option>)}
            </select>
          </label>
          <label className="img-field img-field-count">
            <span>Images</span>
            <select className="field-input" value={count} disabled={!!run} onChange={(e) => set({ count: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {isVectorAgent(agent) && <div className="img-proc-note">Claude has no image model — it draws vector illustrations (SVG), not photos.</div>}
        {run ? (
          <div className="img-run-row">
            <span className="activity-spinner" />
            <span className="img-run-label truncate">{run.label}</span>
            <span className="img-run-time">{Math.round((Date.now() - run.startedAt) / 1000)}s</span>
            <Button size="sm" onClick={() => ctx.stop(card.id)}><Icon name="stop" size="sm" /> Stop</Button>
          </div>
        ) : (
          <div className="img-run-row">
            {last?.error && !last.files.length
              ? <span className="img-run-error truncate" title={last.error}>{last.error}</span>
              : <span className="img-run-hint truncate">{last ? `Last run ${timeAgo(last.at)}` : 'Connects to an Output card on run'}</span>}
            <Button variant="primary" size="sm" disabled={!agentOn} onClick={() => ctx.run(card.id)}><Icon name="send" size="sm" /> Run</Button>
          </div>
        )}
      </div>
    </>
  )
}

function lastRunOf(c: Canvas, processorId: string): RunRecord | undefined {
  let best: RunRecord | undefined
  for (const e of c.edges) {
    if (e.from !== processorId) continue
    const o = c.cards.find((k) => k.id === e.to)
    if (o?.kind !== 'output') continue
    const r = o.data.runs[o.data.runs.length - 1]
    if (r && (!best || r.at > best.at)) best = r
  }
  return best
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s)) return ''
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return shortDate(iso)
}

// ── Output ────────────────────────────────────────────────────────────────────
function OutputCard({ card, ui, ctx }: { card: CardOf<'output'>; ui: CardUi; ctx: CardCtx }) {
  const runs = card.data.runs
  const [viewId, setViewId] = useState<string | null>(null)
  const lastId = runs[runs.length - 1]?.id ?? null
  // Follow the newest run unless the user picked an older version.
  const prevLast = useRef(lastId)
  useEffect(() => { if (prevLast.current !== lastId) { prevLast.current = lastId; setViewId(null) } }, [lastId])
  const shown = runs.find((r) => r.id === viewId) ?? runs[runs.length - 1]
  const proc = processorOf(ctx.canvas, card.id)
  const running = proc ? ctx.running[proc.id] : undefined
  const stale = !!(shown && proc && proc.kind === 'processor' && !running && shown.id === lastId && shown.inputsHash &&
    shown.inputsHash !== inputsHash(gatherInputs(ctx.canvas, proc.id), proc.data.agent, proc.data.model, proc.data.count))
  // Selecting only matters when this Output feeds another card (D-088, Hien 2026-10-05:
  // a bare check read as "approve"). Unconnected → no toggle, no selection outline.
  const feedsOn = ctx.canvas.edges.some((e) => e.from === card.id)
  const sel = new Set(feedsOn ? card.data.selected : [])
  const hint = proc ? gatherInputs(ctx.canvas, proc.id).prompt : ''
  const toggle = (f: string) => ctx.patch(card.id, (k) => (k.kind === 'output'
    ? { ...k, data: { ...k.data, selected: k.data.selected.includes(f) ? k.data.selected.filter((x) => x !== f) : [...k.data.selected, f] } } : k))
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx}>
        {runs.length > 1 && (
          <select className="img-version" value={shown?.id} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setViewId(e.target.value)} title="Version">
            {runs.map((r, i) => <option key={r.id} value={r.id}>v{i + 1}{r.files.length ? '' : ' · failed'}</option>)}
          </select>
        )}
        {shown && <ProviderAvatar id={shown.agent} size="sm" />}
      </Head>
      <InPort card={card} slot={OUTPUT_SLOT} ui={ui} filled={!!proc} />
      <OutPort ui={ui} />
      <div className="img-card-body img-output" data-card={card.id} data-slot={OUTPUT_SLOT}>
        {stale && <div className="img-stale">Inputs changed since this run — run again to update.</div>}
        {running && <div className="img-generating"><span className="activity-spinner" /> {running.label}</div>}
        {!running && !shown && <div className="img-output-empty">{proc ? 'Press Run on the Processor.' : 'Connect a Processor here.'}</div>}
        {shown && !shown.files.length && !running && <div className="img-run-error">{shown.error || 'No image'}</div>}
        {shown && shown.files.length > 0 && (
          <div className={`img-gallery img-nowheel${shown.files.length === 1 ? ' single' : ''}`}>
            {shown.files.map((f) => (
              <figure key={f} className={`img-shot${sel.has(f) ? ' selected' : ''}`}>
                <img src={fileUrl(ctx.root, f)} alt="" onClick={() => ctx.openImage(f)} draggable
                  onDragStart={(e) => { e.dataTransfer.setData(IMAGE_REF_TYPE, f); e.dataTransfer.effectAllowed = 'copy' }} />
                {card.data.saved[f] && <span className="img-saved-chip" title={card.data.saved[f]}><Icon name="check" size="xs" /> Saved</span>}
                <div className="img-shot-actions">
                  <button className={card.data.saved[f] ? 'on' : ''} aria-pressed={!!card.data.saved[f]}
                    title={card.data.saved[f] ? `Saved as ${card.data.saved[f]} — click to remove that copy` : 'Save — copy into the saved/ folder'}
                    onClick={() => ctx.toggleSaved(card.id, f, hint)}><Icon name={card.data.saved[f] ? 'check' : 'download'} size="sm" /></button>
                  {!/\.svg$/i.test(f) && <button title="Copy image" onClick={() => api.system.copyImage(ctx.root, f).then((ok: boolean) => ok && notify('Image copied')).catch(failed('Copy image'))}><Icon name="copy" size="sm" /></button>}
                  <button title="Open in its own window" onClick={() => api.system.openArtifactWindow(ctx.root, f).catch(failed('Open window'))}><Icon name="popout" size="sm" /></button>
                  <button title={OS_WORDS.showInFolder} onClick={() => api.system.revealItem(ctx.root, f).catch(failed(OS_WORDS.showInFolder))}><Icon name="folder-open" size="sm" /></button>
                </div>
                  {feedsOn && (
                    <button className={`img-shot-ref${sel.has(f) ? ' on' : ''}`} aria-pressed={sel.has(f)}
                      title={sel.has(f) ? 'Sent to the next card as a reference — click to stop' : 'Send only this image to the next card (otherwise all images of the latest run go)'}
                      onClick={() => toggle(f)}>
                      <Icon name={sel.has(f) ? 'check' : 'link'} size="xs" /> {sel.has(f) ? 'Reference' : 'Use as reference'}
                    </button>
                  )}
              </figure>
            ))}
          </div>
        )}
        {shown && (
          <div className="img-output-meta">
            <span>{timeAgo(shown.at)}{shown.model ? ` · ${shown.model}` : ''}{Object.keys(card.data.saved).length ? ` · ${Object.keys(card.data.saved).length} saved` : ''}</span>
            {!running && <button className="img-link-btn danger" title="Delete this version's images from outputs/ (saved copies stay)" onClick={() => ctx.deleteRun(shown.id)}><Icon name="trash" size="xs" />Delete version</button>}
          </div>
        )}
        {feedsOn && shown && shown.files.length > 0 && (
          <div className="img-ref-hint">{sel.size ? `${sel.size} image${sel.size > 1 ? 's' : ''} sent to the next card as reference.` : 'All images of the latest run go to the next card. Hover an image and choose “Use as reference” to send only that one.'}</div>
        )}
      </div>
    </>
  )
}

export function CardView({ card, ui, ctx }: { card: Card; ui: CardUi; ctx: CardCtx }) {
  switch (card.kind) {
    case 'prompt': return <PromptCard card={card} ui={ui} ctx={ctx} />
    case 'media': return <MediaCard card={card} ui={ui} ctx={ctx} />
    case 'processor': return <ProcessorCard card={card} ui={ui} ctx={ctx} />
    case 'output': return <OutputCard card={card} ui={ui} ctx={ctx} />
  }
}
