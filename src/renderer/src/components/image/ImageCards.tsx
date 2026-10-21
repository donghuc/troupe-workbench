import { memo, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { OS_WORDS } from '../../../../shared/platform'
import Icon from '../Icon'
import { shortDate } from '../../dates'
import ProviderAvatar from '../ProviderAvatar'
import { api } from '../../api'
import { failed, notify } from '../../notices'
import { presetsFor } from '../../models'
import { CARD_LABEL, isVectorAgent, OUTPUT_SLOT, REF_ROLES, withRole, type Card, type RefRole, type CardView as CardDerived } from '../../../../shared/imageCanvas'
import type { ProviderId, ProviderInfo } from '../../../../shared/types'
import type { CardUi, CardLink } from './ImageCanvas'
import { thumbUrl, IMAGE_REF_TYPE } from './geometry'
import { Button, IconButton } from '../ui/Button'

export interface RunState { runId: string; label: string; startedAt: number; hash: string }

/** What a card shows from outside itself (image perf, 2026-10): its derived view (input
 *  labels, last run, stale) plus run and import state. Plain data, kept stable when unchanged. */
export type CardData = CardDerived & { run?: RunState; busy?: boolean }

/** Stable across renders (only agents or the folder change it): callbacks read the latest
 *  canvas through refs, so cards don't re-render when other cards change. */
export interface CardCtx {
  root: string
  agents: ProviderInfo[]                      // image-capable agents that are on
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
}
interface CardProps<K extends Card['kind']> { card: CardOf<K>; ui: CardUi; ctx: CardCtx; d: CardData; link: CardLink | null; lod: boolean }

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

const OutPort = ({ ui, link }: { ui: CardUi; link: CardLink | null }) => (
  <span className={`img-port img-port-out${link?.fromHere ? ' active' : ''}`} title="Drag to connect" onPointerDown={ui.startConnect} />
)
const InPort = ({ card, slot, link, filled }: { card: Card; slot: string; link: CardLink | null; filled: boolean }) => {
  const st = link?.slots[slot]
  return <span className={`img-port img-port-in${filled ? ' filled' : ''}${st ? ' ' + st : ''}`} data-card={card.id} data-slot={slot} />
}
// Below 40% zoom a card draws a light placeholder instead of its body (no images, no fields).
const Placeholder = ({ text }: { text: string }) => <div className="img-card-body img-lod">{text}</div>

export const readBase64 = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''))
  r.onerror = () => rej(r.error)
  r.readAsDataURL(f)
})

// ── Prompt ────────────────────────────────────────────────────────────────────
function PromptCard({ card, ui, ctx, link, lod }: CardProps<'prompt'>) {
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx} />
      <OutPort ui={ui} link={link} />
      {lod ? <Placeholder text={card.data.text.trim().slice(0, 80) || 'Empty prompt'} /> : <div className="img-card-body">
        <textarea className="field-textarea img-prompt img-nowheel" placeholder="Describe the image you want…" value={card.data.text}
          onChange={(e) => { const text = e.target.value; ctx.patch(card.id, (k) => (k.kind === 'prompt' ? { ...k, data: { text } } : k)) }} />
      </div>}
    </>
  )
}

// ── Media ─────────────────────────────────────────────────────────────────────
function MediaCard({ card, ui, ctx, d, link, lod }: CardProps<'media'>) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const busy = !!d.busy
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
      <OutPort ui={ui} link={link} />
      {lod ? <Placeholder text={files.length ? `${files.length} image${files.length > 1 ? 's' : ''}` : 'No images'} /> : <div className={`img-card-body img-media${over ? ' over' : ''}`}
        onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {files.length > 0 && (
          <div className="img-thumbs">
            {files.map((f) => (
              <div key={f} className="img-thumb">
                <img src={thumbUrl(ctx.root, f, 200)} alt="" loading="lazy" decoding="async" onClick={() => ctx.openImage(f)} />
                <button className="img-thumb-x" title="Remove" onClick={() => ctx.patch(card.id, (k) => (k.kind === 'media' ? { ...k, data: { files: k.data.files.filter((x) => x !== f) } } : k))}><Icon name="close" size="xs" /></button>
              </div>
            ))}
          </div>
        )}
        <button className="img-drop" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <><span className="activity-spinner" /> Adding…</> : <><Icon name="image" size="md" /> {files.length ? 'Add more' : `Drop, paste (${OS_WORDS.mod}V) or choose images`}</>}
        </button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>}
    </>
  )
}

// ── Processor ─────────────────────────────────────────────────────────────────
function useTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(t) }, [on])
}

function ProcessorCard({ card, ui, ctx, d, link, lod }: CardProps<'processor'>) {
  const run = d.run
  useTick(!!run)
  const { agent, model, count, slots } = card.data
  const agentOn = ctx.agents.some((a) => a.id === agent)
  const models = presetsFor(agent)
  const set = (d: Partial<CardOf<'processor'>['data']>) => ctx.patch(card.id, (k) => (k.kind === 'processor' ? { ...k, data: { ...k.data, ...d } } : k))
  const last = d.lastRun
  return (
    <>
      <Head card={card} ui={ui} ctx={ctx}><ProviderAvatar id={agent} size="sm" /></Head>
      <OutPort ui={ui} link={link} />
      <div className="img-slots">
        {slots.map((s, i) => {
          const v = d.slots?.find((x) => x.slot === s)
          const label = v?.label ?? 'Empty — drag an output here'
          return (
            <div key={s} className="img-slot" data-card={card.id} data-slot={s}>
              <InPort card={card} slot={s} link={link} filled={!!v?.filled} />
              <span className={`img-slot-label truncate${v?.filled ? '' : ' empty'}`} title={label}>{i + 1}. {label}</span>
              {v?.image && (
                // D-131: what this image input is for — said to the agent next to its files.
                <select className={`img-role${v.role && v.role !== 'any' ? ' set' : ''}`} value={v.role ?? 'any'} disabled={!!run} title="What the agent should take from these images"
                  aria-label={`Input ${i + 1} is for`} onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => ctx.patch(card.id, (k) => (k.kind === 'processor' ? { ...k, data: withRole(k.data, s, e.target.value as RefRole) } : k))}>
                  {REF_ROLES.map((r) => <option key={r.id} value={r.id}>{r.id === 'any' ? 'Any use' : `For ${r.label.toLowerCase()}`}</option>)}
                </select>
              )}
              {slots.length > 1 && <IconButton className="img-slot-x" title="Remove input" onClick={() => ctx.removeSlot(card.id, s)}><Icon name="close" size="xs" /></IconButton>}
            </div>
          )
        })}
      </div>
      {lod ? <Placeholder text={run ? run.label : `${agent}${model ? ` · ${model}` : ''}`} /> : <div className="img-card-body img-proc">
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
            {last?.error && !last.ok
              ? <span className="img-run-error truncate" title={last.error}>{last.error}</span>
              : <span className="img-run-hint truncate">{last ? `Last run ${timeAgo(last.at)}` : 'Connects to an Output card on run'}</span>}
            <Button variant="primary" size="sm" disabled={!agentOn} onClick={() => ctx.run(card.id)}><Icon name="send" size="sm" /> Run</Button>
          </div>
        )}
      </div>}
    </>
  )
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
function OutputCard({ card, ui, ctx, d, link, lod }: CardProps<'output'>) {
  const runs = card.data.runs
  const [viewId, setViewId] = useState<string | null>(null)
  const lastId = runs[runs.length - 1]?.id ?? null
  // Follow the newest run unless the user picked an older version.
  const prevLast = useRef(lastId)
  useEffect(() => { if (prevLast.current !== lastId) { prevLast.current = lastId; setViewId(null) } }, [lastId])
  const shown = runs.find((r) => r.id === viewId) ?? runs[runs.length - 1]
  const proc = d.procId
  const running = d.run
  const stale = !!(shown && d.stale && !running && shown.id === lastId)
  // Selecting only matters when this Output feeds another card (D-088, Hien 2026-10-05:
  // a bare check read as "approve"). Unconnected → no toggle, no selection outline.
  const feedsOn = !!d.feedsOn
  const sel = new Set(feedsOn ? card.data.selected : [])
  const hint = d.hint ?? ''
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
      <InPort card={card} slot={OUTPUT_SLOT} link={link} filled={!!proc} />
      <OutPort ui={ui} link={link} />
      {lod ? <Placeholder text={shown ? `${shown.files.length} image${shown.files.length === 1 ? '' : 's'}${runs.length > 1 ? ` · v${runs.length}` : ''}` : 'No images yet'} /> : <div className="img-card-body img-output" data-card={card.id} data-slot={OUTPUT_SLOT}>
        {stale && <div className="img-stale">Inputs changed since this run — run again to update.</div>}
        {running && <div className="img-generating"><span className="activity-spinner" /> {running.label}</div>}
        {!running && !shown && <div className="img-output-empty">{proc ? 'Press Run on the Processor.' : 'Connect a Processor here.'}</div>}
        {shown && !shown.files.length && !running && <div className="img-run-error">{shown.error || 'No image'}</div>}
        {shown && shown.files.length > 0 && (
          <div className={`img-gallery img-nowheel${shown.files.length === 1 ? ' single' : ''}`}>
            {shown.files.map((f) => (
              <figure key={f} className={`img-shot${sel.has(f) ? ' selected' : ''}`}>
                <img src={thumbUrl(ctx.root, f, shown.files.length === 1 ? 680 : 400)} alt="" loading="lazy" decoding="async" onClick={() => ctx.openImage(f)} draggable
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
      </div>}
    </>
  )
}

type AnyCardProps = { card: Card; ui: CardUi; ctx: CardCtx; d: CardData; link: CardLink | null; lod: boolean }
export const CardView = memo(function CardView(p: AnyCardProps) {
  switch (p.card.kind) {
    case 'prompt': return <PromptCard {...p} card={p.card} />
    case 'media': return <MediaCard {...p} card={p.card} />
    case 'processor': return <ProcessorCard {...p} card={p.card} />
    case 'output': return <OutputCard {...p} card={p.card} />
  }
})
