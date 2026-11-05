import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import Icon from '../Icon'
import { Button, IconButton } from '../ui/Button'
import { Menu, MenuItem } from '../ui/Menu'
import { api } from '../../api'
import { DEVICES, validateLottie, type DeviceId, type LottieInfo } from '../../../../shared/motion'
import { OUTPUT_W, OUTPUT_H, tidyPlayer, type Card, type PlayerState } from '../../../../shared/imageCanvas'
import { CARD_W } from './geometry'
import type { CardCtx, CardData } from './ImageCards'

type OutputCard = Extract<Card, { kind: 'output' }>
type Anim = { play(): void; pause(): void; setSpeed(s: number): void; destroy(): void; loop: boolean | number; goToAndPlay(v: number, f?: boolean): void; goToAndStop(v: number, f?: boolean): void; isPaused: boolean; currentFrame: number; totalFrames: number; addEventListener(n: string, cb: () => void): void }
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]
// Preview background: a checkerboard shows transparency (a white character on white vanished).
const BACKGROUNDS = [{ id: 'checker', label: 'Transparent (checkerboard)' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }] as const
type Bg = typeof BACKGROUNDS[number]['id']
const DEFAULT_H = 340
const clamp = (v: number, r: { min: number; max: number }) => Math.round(Math.max(r.min, Math.min(r.max, v)))

/** The Result card's body in Motion (D-148): a Lottie player in a device frame. Its controls act
 *  on the animation only — a run is stopped on the Animate card; a change run next to Apply. */
export default function MotionResult({ card, ctx, d }: { card: OutputCard; ctx: CardCtx; d: CardData }) {
  const runs = card.data.runs
  const good = [...runs].reverse().find((r) => r.files.length > 0)
  const last = runs[runs.length - 1]
  const file = good?.files[0] ?? null
  const running = d.run
  const changing = !!running && running.outId === card.id   // a change asked for on this card
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const anim = useRef<Anim | null>(null)
  const [info, setInfo] = useState<{ info: LottieInfo; kb: number } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The player's state lives on the card (D-148), so zooming out, switching tabs or reopening
  // the canvas brings each animation back as it was left — paused where it stopped, or playing.
  const kept = card.data.player
  const [device, setDevice] = useState<DeviceId>(kept?.device ?? 'mobile')
  const [playing, setPlaying] = useState(!kept?.paused)
  const [loop, setLoop] = useState(kept?.loop !== false)
  const [speed, setSpeed] = useState(kept?.speed ?? 1)
  const remember = (p: Partial<Record<keyof PlayerState, unknown>>) => ctx.patch(card.id, (k) => {
    if (k.kind !== 'output') return k
    const player = tidyPlayer({ ...k.data.player, ...p })
    const { player: _old, ...rest } = k.data
    return { ...k, data: player ? { ...rest, player } : rest }
  })
  const [menu, setMenu] = useState(false)
  const [change, setChange] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [bg, setBg] = useState<Bg>(() => { try { const v = localStorage.getItem('motion.bg'); return v === 'light' || v === 'dark' ? v : 'checker' } catch { return 'checker' } })
  const pickBg = (v: Bg) => { setBg(v); try { localStorage.setItem('motion.bg', v) } catch { /* storage unavailable */ } }

  useEffect(() => {
    if (!file || !host.current) return
    let gone = false
    setLoadError(null)
    void (async () => {
      try {
        const text: string = await api.files.readFile(ctx.root, file)
        const check = validateLottie(text)
        if (!check.ok) throw new Error(check.problems[0])
        const lottie = (await import('lottie-web/build/player/lottie_light')).default
        if (gone || !host.current) return
        anim.current?.destroy()
        host.current.innerHTML = ''
        const a = lottie.loadAnimation({ container: host.current, renderer: 'svg', loop, autoplay: playing, animationData: JSON.parse(text), rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } }) as unknown as Anim
        a.setSpeed(speed)
        const at = card.data.player?.paused ? card.data.player.frame : undefined
        if (!playing && at) a.goToAndStop(Math.min(at, Math.max(0, a.totalFrames - 1)), true)
        a.addEventListener('complete', () => { setPlaying(false); remember({ paused: true, frame: Math.max(0, a.totalFrames - 1) }) })
        anim.current = a
        setLoaded(true)
        setInfo({ info: check.info, kb: Math.max(1, Math.round(text.length / 1024)) })
      } catch (e) { if (!gone) setLoadError(e instanceof Error ? e.message : String(e)) }
    })()
    return () => { gone = true; anim.current?.destroy(); anim.current = null; setLoaded(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, ctx.root])

  const togglePlay = () => {
    const a = anim.current; if (!a) return
    if (playing) { a.pause(); setPlaying(false); remember({ paused: true, frame: a.currentFrame }); return }
    // A one-shot that reached its end starts over; one paused part-way carries on from there.
    if (!loop && a.currentFrame >= a.totalFrames - 1) a.goToAndPlay(0, true); else a.play()
    setPlaying(true); remember({ paused: undefined, frame: undefined })
  }
  const toggleLoop = () => {
    const v = !loop; setLoop(v)
    const resume = v && !playing && !!anim.current
    if (anim.current) { anim.current.loop = v; if (resume) { anim.current.play(); setPlaying(true) } }
    remember({ loop: v ? undefined : false, ...(resume ? { paused: undefined, frame: undefined } : {}) })
  }
  const pickSpeed = (s: number) => { setSpeed(s); anim.current?.setSpeed(s); remember({ speed: s }) }
  const pickDevice = (id: DeviceId) => { setDevice(id); remember({ device: id }) }

  // Resize grip (bottom-right of the preview): drags the card's width and the preview's height.
  // Canvas zoom is read from the element's on-screen size vs. its layout size.
  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation()
    const el = stage.current; if (!el) return
    const zoom = el.getBoundingClientRect().width / el.offsetWidth || 1
    const x0 = e.clientX, y0 = e.clientY
    const w0 = card.data.w ?? CARD_W.output, h0 = card.data.h ?? DEFAULT_H
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    let raf = 0
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const w = clamp(w0 + (ev.clientX - x0) / zoom, OUTPUT_W), h = clamp(h0 + (ev.clientY - y0) / zoom, OUTPUT_H)
        ctx.patch(card.id, (k) => (k.kind === 'output' ? { ...k, data: { ...k.data, w, h } } : k))
      })
    }
    const up = () => { cancelAnimationFrame(raf); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up)
  }

  const dev = DEVICES.find((x) => x.id === device)!
  const ar = dev.w ? dev.w / dev.h : info ? info.info.w / info.info.h : 1
  const canUndo = runs.length > 1 && !running
  const apply = () => { const t = change.trim(); if (!t || !file) return; ctx.motion.change(card.id, file, t); setChange('') }
  const ready = !!file && loaded

  return (
    <div className="img-card-body mot-result img-nowheel">
      <div className="mot-top">
      <div className="mot-devices" role="group" aria-label="Preview size">
        {DEVICES.map((x) => <button key={x.id} className={device === x.id ? 'on' : ''} aria-pressed={device === x.id} onClick={() => pickDevice(x.id)}
          title={x.w ? `${x.w} × ${x.h}` : info ? `The animation's own size: ${info.info.w} × ${info.info.h}` : 'The animation\'s own size'}>{x.label}</button>)}
      </div>
      <div className="mot-bgs" role="group" aria-label="Preview background">
        {BACKGROUNDS.map((b) => <button key={b.id} className={`mot-bg-swatch mot-bg-${b.id}${bg === b.id ? ' on' : ''}`} aria-pressed={bg === b.id} title={b.label} aria-label={b.label} onClick={() => pickBg(b.id)} />)}
      </div>
      </div>
      <div className="mot-stage" ref={stage} style={{ height: card.data.h ?? DEFAULT_H }}>
        <div className={`mot-frame mot-${device} mot-bg-${bg}`} style={{ ['--ar' as string]: String(ar) }}>
          {file ? <div ref={host} className="mot-player" /> : <div className="mot-empty">{running ? '' : d.procId ? 'Press Run on the Animate card.' : 'Connect an Animate card here.'}</div>}
        </div>
        {/* Status only — no controls here, so nothing in the preview can stop a run. */}
        {running && <div className="mot-status" role="status"><span className="activity-spinner" /> <span className="truncate">{changing ? 'Changing: ' : ''}{running.label}</span></div>}
        <div className="mot-grip" title="Drag to resize" onPointerDown={startResize} />
      </div>
      {last && !last.files.length && !running && <div className="img-run-error" title={last.error}>{last.error || 'No animation'}</div>}
      {loadError && <div className="img-run-error" title={loadError}>Couldn’t play this animation: {loadError}</div>}
      <div className="mot-controls">
        <button className="mot-play" onClick={togglePlay} disabled={!ready} title={ready && playing ? 'Pause' : 'Play'} aria-label={ready && playing ? 'Pause' : 'Play'}>
          {ready && playing ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" /><rect x="7.4" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>}
        </button>
        <label className="mot-loop"><input type="checkbox" checked={loop} onChange={toggleLoop} disabled={!ready} /> Loop</label>
        <span className="mot-meta truncate">{info ? `${info.info.seconds} s · ${info.info.fr} fps · ${info.kb} KB` : ''}</span>
        <span className="mot-spacer" />
        <label className="mot-speed">
          <span>Speed</span>
          <select className="field-input" value={speed} disabled={!ready} onChange={(e) => pickSpeed(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      </div>
      {good?.change && <div className="mot-changed truncate" title={good.change}>Last change: “{good.change}”</div>}
      <textarea className="field-textarea mot-change" rows={3} placeholder="Ask for a change… e.g. make the leaves slower and the wordmark bounce" value={change} disabled={!file || !!running}
        onChange={(e) => setChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply() } }} />
      <div className="mot-actions">
        <IconButton className="mot-undo" disabled={!canUndo} title={canUndo ? 'Undo — go back to the animation before the last run' : 'Nothing to undo'} aria-label="Undo" onClick={() => ctx.motion.undo(card.id)}><Icon name="undo" size="sm" /></IconButton>
        <span className="mot-export">
          <Button size="sm" disabled={!file} onClick={() => setMenu((v) => !v)}><Icon name="download" size="sm" /> Export</Button>
          <Menu open={menu} onClose={() => setMenu(false)}>
            <MenuItem onClick={() => { setMenu(false); if (file) ctx.motion.save(card.id, file) }}>Save to this tab’s saved folder</MenuItem>
            <MenuItem onClick={() => { setMenu(false); if (file) ctx.motion.exportLottie(file) }}>Lottie (.json)…</MenuItem>
            <MenuItem disabled>dotLottie, GIF, SVG — next version</MenuItem>
          </Menu>
        </span>
        <span className="mot-spacer" />
        {changing
          ? <Button size="sm" onClick={() => ctx.stop(running.runId)} title="Stop this change (the animation stays as it was)"><Icon name="stop" size="sm" /> Stop change</Button>
          : <Button size="sm" variant="primary" disabled={!change.trim() || !file || !!running} onClick={apply}>Apply</Button>}
      </div>
    </div>
  )
}
