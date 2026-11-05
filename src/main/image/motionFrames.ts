// Motion (D-148, 2026-11-05): Troupe renders key frames of an animation itself, with the same
// lottie-web player the Result card uses, so agents can check their work without starting a
// browser (their own headless-Chrome attempts crashed Chrome inside Codex's sandbox).
// A hidden, sandboxed window plays nothing: it seeks to each frame, serialises the SVG and
// rasterises it on a canvas in the page — no screen capture involved.
import { BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { logInfo } from '../util/logger'

/** Where in the animation to look: start, quarters, last frame. */
const FRAME_POINTS = [0, 0.25, 0.5, 0.75, 1] as const
const FRAME_LABELS = ['start', '¼', '½', '¾', 'end']
const MAX_SIDE = 512

/** Frame numbers to render for an animation from ip to op (op is exclusive in Lottie). */
export function framesToRender(ip: number, op: number): number[] {
  const last = Math.max(ip, op - 1)
  return FRAME_POINTS.map((f) => Math.round(ip + f * (last - ip)))
}

let lottieSrc: string | null = null
async function lottieSource(): Promise<string> {
  if (lottieSrc) return lottieSrc
  lottieSrc = await fsp.readFile(require.resolve('lottie-web/build/player/lottie_light.min.js'), 'utf8')
  return lottieSrc
}

// Runs inside the hidden page. Returns one PNG per frame (base64) and a contact sheet.
const PAGE_SCRIPT = (data: string, frames: number[], labels: string[], maxSide: number, probe: number[], ends: number[]) => `(async () => {
  const anim = ${data};
  const scale = Math.min(1, ${maxSide} / Math.max(anim.w, anim.h));
  const W = Math.max(1, Math.round(anim.w * scale)), H = Math.max(1, Math.round(anim.h * scale));
  const box = document.createElement('div'); box.style.cssText = 'width:' + W + 'px;height:' + H + 'px';
  document.body.appendChild(box);
  const a = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: anim, rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
  await new Promise((r) => { if (a.isLoaded) r(); else a.addEventListener('DOMLoaded', r); setTimeout(r, 3000) });
  // A checkerboard behind every frame: transparency and white artwork both stay visible.
  const checker = (ctx, w, h) => { const s = 12; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { ctx.fillStyle = ((x + y) / s) % 2 ? '#c8c8c8' : '#e8e8e8'; ctx.fillRect(x, y, s, s) } };
  const draw = async (f, w, h, bg) => {
    a.goToAndStop(f, true);
    await new Promise((r) => setTimeout(r, 0));   // not rAF: a hidden window may never paint
    const svg = box.querySelector('svg').cloneNode(true);
    svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (bg) checker(ctx, w, h); ctx.drawImage(img, 0, 0, w, h);
    return c;
  };
  const shots = [];
  for (const f of ${JSON.stringify(frames)}) shots.push(await draw(f, W, H, true));
  // Measurements (D-148): small transparent renders across the timeline, so the agent is told
  // facts — edges touched, how much moves, whether the loop joins — not just shown pictures.
  const ms = Math.min(1, 160 / Math.max(W, H)), mw = Math.max(1, Math.round(W * ms)), mh = Math.max(1, Math.round(H * ms));
  const px = [];
  for (const f of ${JSON.stringify(probe)}) px.push((await draw(f, mw, mh, false)).getContext('2d').getImageData(0, 0, mw, mh).data);
  const T = 40, opaque = (d, i) => d[i + 3] > T;
  const edges = px.map((d) => {
    const hit = { top: false, bottom: false, left: false, right: false };
    for (let x = 0; x < mw; x++) { if (opaque(d, x * 4)) hit.top = true; if (opaque(d, ((mh - 1) * mw + x) * 4)) hit.bottom = true }
    for (let y = 0; y < mh; y++) { if (opaque(d, (y * mw) * 4)) hit.left = true; if (opaque(d, (y * mw + mw - 1) * 4)) hit.right = true }
    return hit;
  });
  const area = px.map((d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (opaque(d, i)) n++; return n });
  // Smallest gap between the artwork and each edge over all frames (share of width / height).
  const gap = { left: 1, right: 1, top: 1, bottom: 1 };
  px.forEach((d) => { for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (opaque(d, (y * mw + x) * 4)) { gap.left = Math.min(gap.left, x / mw); gap.right = Math.min(gap.right, (mw - 1 - x) / mw); gap.top = Math.min(gap.top, y / mh); gap.bottom = Math.min(gap.bottom, (mh - 1 - y) / mh) } });
  const diff = (p, q, ap, aq) => { let n = 0; for (let i = 0; i < p.length; i += 4) { const da = Math.abs(p[i + 3] - q[i + 3]); const dc = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); if (da > T || ((opaque(p, i) || opaque(q, i)) && dc > 60)) n++ } return n / Math.max(1, ap, aq) };
  const steps = []; for (let i = 1; i < px.length; i++) steps.push(diff(px[i - 1], px[i], area[i - 1], area[i]));
  const seam = diff(px[0], px[px.length - 1], area[0], area[px.length - 1]);
  // Speed at the seam: change over the first and the last frame step (a loop that eases to a
  // stop at its end but starts at full speed hitches when it restarts).
  const ep = []; for (const f of ${JSON.stringify(ends)}) ep.push((await draw(f, mw, mh, false)).getContext('2d').getImageData(0, 0, mw, mh).data);
  const ea = ep.map((d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (opaque(d, i)) n++; return n });
  const speed = { start: diff(ep[0], ep[1], ea[0], ea[1]), end: diff(ep[2], ep[3], ea[2], ea[3]) };
  // Contact sheet: frames in a row, each labelled with its place and frame number.
  const pad = 8, lab = 22, cols = shots.length;
  const sheet = document.createElement('canvas'); sheet.width = cols * W + (cols + 1) * pad; sheet.height = H + lab + 2 * pad;
  const sx = sheet.getContext('2d'); sx.fillStyle = '#ffffff'; sx.fillRect(0, 0, sheet.width, sheet.height);
  sx.fillStyle = '#222'; sx.font = '14px -apple-system, Helvetica, Arial, sans-serif';
  shots.forEach((c, i) => { const x = pad + i * (W + pad); sx.drawImage(c, x, pad + lab); sx.strokeStyle = '#999'; sx.strokeRect(x + 0.5, pad + lab + 0.5, W - 1, H - 1); sx.fillText(${JSON.stringify(labels)}[i] + ' · frame ' + ${JSON.stringify(frames)}[i], x, pad + 15) });
  const b64 = (c) => c.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
  a.destroy();
  return { frames: shots.map(b64), sheet: b64(sheet), metrics: { edges, area: area.map((n) => n / (mw * mh)), steps, seam, gap, speed } };
})()`

export interface FrameMetrics {
  edges: { top: boolean; bottom: boolean; left: boolean; right: boolean }[]   // per probe frame: artwork touches that edge
  area: number[]     // share of the canvas covered, per probe frame
  steps: number[]    // share of the artwork that changes between neighbouring probe frames
  seam: number       // … between the first and last frame
  gap?: { left: number; right: number; top: number; bottom: number }   // smallest margin to each edge, over all frames
  speed?: { start: number; end: number }   // share of the artwork changing over the first / last frame step
}
export interface RenderedFrames { sheet: string; frames: string[]; metrics?: FrameMetrics; probe: number[] }   // paths absolute

/** Frames probed for the measurements: 16 evenly spread, first and last included. */
export function probeFrames(ip: number, op: number, n = 16): number[] {
  const last = Math.max(ip, op - 1)
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(ip + (i / (n - 1)) * (last - ip))))]
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
/** Plain findings for the review pass. Empty when nothing stands out. */
export function describeMetrics(m: FrameMetrics, probe: number[]): string[] {
  const out: string[] = []
  const full = m.edges.every((e) => e.top && e.bottom && e.left && e.right) && m.area.every((a) => a > 0.97)
  if (full) out.push('The artwork fills the whole canvas in every frame (a background?) — the brief wants a transparent background unless it asks for one.')
  else {
    const sides = ['left', 'right', 'top', 'bottom'] as const
    for (const side of sides) {
      const at = probe.filter((_, i) => m.edges[i]?.[side])
      if (at.length) out.push(`Cut off: the artwork touches the ${side} edge of the canvas in ${at.length === probe.length ? 'every frame' : `frames ${at.slice(0, 6).join(', ')}${at.length > 6 ? '…' : ''}`}. Leave a margin — move, scale down, or widen the canvas.`)
      else if (m.gap && m.gap[side] < 0.03) out.push(`Very close to the ${side} edge (${pct(m.gap[side])} margin at the closest frame) — a little more room would be safer.`)
    }
  }
  const avg = m.steps.reduce((s, v) => s + v, 0) / Math.max(1, m.steps.length)
  const max = Math.max(0, ...m.steps)
  if (max < 0.03) out.push(`Movement: at most ${pct(max)} of the artwork changes between frames — it barely moves. Make the motion clearly visible at loader size.`)
  else out.push(`Movement: on average ${pct(avg)} of the artwork changes between neighbouring frames (most ${pct(max)}).`)
  out.push(`Loop: the first and last frames differ by ${pct(m.seam)} of the artwork${m.seam > 0.04 ? ' — if this should loop, it will jump when it restarts.' : ' — they join up.'}`)
  if (m.speed && m.seam <= 0.04) {
    const { start, end } = m.speed
    const hi = Math.max(start, end), lo = Math.min(start, end)
    if (hi > 0.01 && hi > 3 * Math.max(lo, 0.002)) out.push(`Loop speed: ${pct(start)} of the artwork changes over the first frame step but ${pct(end)} over the last — it ${end < start ? 'slows to a stop at the end and starts at full speed' : 'starts from a stop and ends at speed'}, so the loop will hitch. Make the speed match across the seam.`)
  }
  return out
}

/** Render key frames of a checked Lottie (its JSON text) into outDir. */
export async function renderFrames(json: string, outDir: string): Promise<RenderedFrames> {
  const j = JSON.parse(json) as { ip: number; op: number }
  const frames = framesToRender(j.ip, j.op)
  const probe = probeFrames(j.ip, j.op)
  const last = Math.max(j.ip, j.op - 1)
  const ends = [j.ip, Math.min(last, j.ip + 1), Math.max(j.ip, last - 1), last]
  const win = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, offscreen: false, backgroundThrottling: false, spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    await win.loadURL('about:blank')
    await win.webContents.executeJavaScript(await lottieSource())
    const out = await Promise.race([
      win.webContents.executeJavaScript(PAGE_SCRIPT(json, frames, FRAME_LABELS, MAX_SIDE, probe, ends)) as Promise<{ frames: string[]; sheet: string; metrics?: FrameMetrics }>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Rendering frames took too long')), 30_000))
    ])
    await fsp.mkdir(outDir, { recursive: true })
    const paths: string[] = []
    for (let i = 0; i < out.frames.length; i++) {
      const p = join(outDir, `frame-${String(frames[i]).padStart(4, '0')}.png`)
      await fsp.writeFile(p, Buffer.from(out.frames[i], 'base64'))
      paths.push(p)
    }
    const sheet = join(outDir, 'sheet.png')
    await fsp.writeFile(sheet, Buffer.from(out.sheet, 'base64'))
    logInfo('[motion] frames rendered', { frames, metrics: out.metrics ? describeMetrics(out.metrics, probe) : null })
    return { sheet, frames: paths, metrics: out.metrics, probe }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
