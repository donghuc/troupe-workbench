// Small previews for Image Creation cards (image perf, 2026-10). Agent output is 1–1.5k px,
// but a card shows it about 160 px wide: decoding the original for every card cost 4–9 MB of
// bitmap each and a whole-file read per image. `wbfile://…&w=N` asks for a copy at most N px
// wide; it's made once and cached under userData/thumbs, keyed by path + size + mtime, so an
// edited file gets a new thumbnail.
import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'

const RASTER = /\.(png|jpe?g|webp)$/i
/** Widths the renderer may ask for (anything else is snapped up to the next one). */
const THUMB_WIDTHS = [200, 400, 680] as const
export const snapWidth = (w: number): number => THUMB_WIDTHS.find((x) => x >= w) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1]

export interface ThumbImage { isEmpty(): boolean; getSize(): { width: number; height: number }; resize(o: { width: number; quality?: 'good' | 'better' | 'best' }): ThumbImage; toJPEG(q: number): Buffer; toPNG(): Buffer }
export interface ThumbDeps {
  dir: string
  /** OS thumbnailer when there is one (macOS QuickLook, Windows shell) — decodes off the main thread. */
  osThumb?: (abs: string, w: number) => Promise<ThumbImage>
  /** Fallback decode (synchronous, main thread). */
  decode: (abs: string) => ThumbImage
}

const inFlight = new Map<string, Promise<{ body: Buffer; mime: string } | null>>()
let active = 0
const queue: (() => void)[] = []
// At most 3 decodes at once: opening a big canvas asks for hundreds.
const slot = <T>(fn: () => Promise<T>): Promise<T> => new Promise((res, rej) => {
  const run = () => { active++; fn().then(res, rej).finally(() => { active--; queue.shift()?.() }) }
  if (active < 3) run(); else queue.push(run)
})

/** The thumbnail bytes, or null when the original should be served (SVG, GIF, small or unreadable). */
export async function thumbnail(abs: string, width: number, deps: ThumbDeps): Promise<{ body: Buffer; mime: string } | null> {
  if (!RASTER.test(abs)) return null
  const w = snapWidth(width)
  const st = await fsp.stat(abs)
  const png = /\.png$/i.test(abs)
  const key = createHash('sha1').update(`${abs}\0${st.size}\0${st.mtimeMs}\0${w}`).digest('hex')
  const file = join(deps.dir, `${key}.${png ? 'png' : 'jpg'}`)
  const mime = png ? 'image/png' : 'image/jpeg'
  try { return { body: await fsp.readFile(file), mime } } catch { /* not cached yet */ }
  const pending = inFlight.get(file)
  if (pending) return pending
  const job = slot(async () => {
    let img: ThumbImage | null = null
    if (deps.osThumb) { try { img = await deps.osThumb(abs, w) } catch { img = null } }
    if (!img || img.isEmpty()) img = deps.decode(abs)
    if (img.isEmpty()) return null
    if (img.getSize().width > w) img = img.resize({ width: w, quality: 'good' })
    const body = png ? img.toPNG() : img.toJPEG(85)
    await fsp.mkdir(deps.dir, { recursive: true })
    await fsp.writeFile(file, body)
    return { body, mime }
  }).finally(() => inFlight.delete(file))
  inFlight.set(file, job)
  return job
}

/** Drop thumbnails not used for `days` (run at startup; the cache is only a cache). */
export async function pruneThumbs(dir: string, days = 30): Promise<number> {
  let n = 0
  const cutoff = Date.now() - days * 86_400_000
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    const p = join(dir, f)
    try { if ((await fsp.stat(p)).atimeMs < cutoff) { await fsp.unlink(p); n++ } } catch { /* gone */ }
  }
  return n
}
