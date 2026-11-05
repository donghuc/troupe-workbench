// Motion (D-148): Lottie animations on the Image Creation canvas. Pure rules here — which agents,
// the prompt each run gets, and the check every animation must pass before it's shown.
import type { ProviderId } from './types'
import { motionGuide, REVIEW_BLOCKERS } from './motionGuide'

/** Agents that write Lottie well (Hien, 2026-11-04): picked per run on the Animate card. */
export const MOTION_AGENTS: ProviderId[] = ['claude-code', 'codex', 'grok']
export const isMotionAgent = (id: string): id is ProviderId => (MOTION_AGENTS as string[]).includes(id)
export const ANIMATION_FILE = 'animation.json'
export const WORK_DIR = 'work'                // per-run scratch: builder scripts etc. (never shown)
/** 0 = Auto (the default, Hien 2026-11-05): the agent picks the natural length — one cycle for a loop. */
export const DEFAULT_SECONDS = 0
export const SECONDS_CHOICES = [0, 1, 1.5, 2, 2.4, 3, 4, 5, 6, 8, 10]
export const secondsLabel = (s: number): string => (s > 0 ? `${s} s` : 'Auto')

/** Preview frames on the Result card. Custom = the animation's own size. */
export const DEVICES = [
  { id: 'mobile', label: 'Mobile', w: 390, h: 844 },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
  { id: 'custom', label: 'Custom', w: 0, h: 0 }
] as const
export type DeviceId = typeof DEVICES[number]['id']

export const isMotionAsset = (p: string): boolean => /\.(svg|png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i.test(p)
export const isVideo = (p: string): boolean => /\.(mp4|mov|webm|m4v)$/i.test(p)
export const isRaster = (p: string): boolean => /\.(png|jpe?g|webp|gif)$/i.test(p)

export interface MotionRunInput {
  agent: ProviderId
  model: string
  prompt: string
  refs: string[]               // relative to the Motion folder
  seconds: number              // 0 = Auto
  /** Ask for a change: the current animation (relative path) and what to change. */
  base?: string
  change?: string
}

const LOTTIE_RULES = `Lottie rules (the file is checked, and rejected if it breaks them; it plays in lottie-web 5.12, SVG renderer):
- One JSON object: {"v":"5.7.0","fr":<30 or 60>,"ip":0,"op":<frames>,"w":<width>,"h":<height>,"nm":"<name>","ddd":0,"assets":[],"layers":[…]}. op = seconds × fr. Pick a canvas that fits the artwork with a margin; keep everything inside it in every frame.
- Use shape layers ("ty":4) with "ind" (unique number), "nm", "ip", "op", "st":0, "ks" (transform) and "shapes". Parent layers ("parent": ind) are fine for rigs (a body that carries arms and face).
- Transform "ks": {"a":anchor,"p":position,"s":scale %,"r":rotation °,"o":opacity 0–100}. Every property is {"a":0,"k":value} when static, or {"a":1,"k":[keyframes]} when animated.
- A keyframe is {"t":frame,"s":[values],"o":{"x":[x1],"y":[y1]},"i":{"x":[x2],"y":[y2]}} with the curve from the Motion guide's anchors (repeat the numbers per dimension for position/scale); the last keyframe has only "t" and "s". Values are always arrays ([x,y], [100,100], [45], [0]).
- Shapes go in groups: {"ty":"gr","nm":"…","it":[ paths {"ty":"sh","ks":{"a":0,"k":{"c":true,"v":[[x,y],…],"i":[[x,y],…],"o":[[x,y],…]}}}, ellipses {"ty":"el"…}, rects {"ty":"rc"…}, then fill {"ty":"fl"…}, gradient fill {"ty":"gf"…} for shading, and/or stroke {"ty":"st"…}, and the group transform {"ty":"tr"…} last ]}.
- Colours are 0–1 numbers. No expressions, no text layers, no external files. Transparent background unless the brief asks for one.
- Name layers after what they are ("body", "leg-left", "wordmark") so later changes can find them.`

/** How to work — written for quality: the agent must look at its work (D-148, 2026-11-05: runs that
 *  never rendered anything came out far worse). Troupe renders the animation's frames itself and
 *  shows them in a review pass, so agents don't start browsers (their headless Chrome crashed). */
export const FRAMES_DIR = 'frames'   // inside work/: Troupe's renders (sheet.png + frame-NNNN.png)
/** A shared, reusable place for the agent's render tools, so later runs skip the install. */
const MOTION_TOOLS_DIR = '/tmp/troupe-motion-tools'
// What worked (D-148, 2026-11-05 logs): the best runs rendered their own frames while building —
// lottie-web in jsdom, rasterised with resvg — looked, fixed and rendered again. Real browsers
// (Playwright/Chrome) crashed in the agent's sandbox, so they're ruled out, not rendering itself.
const RENDER_RECIPE = `Render with lottie-web's SVG renderer in jsdom and rasterise the SVG with @resvg/resvg-js — no real browser (Playwright, Puppeteer and Chrome crash here). Keep these tools in ${MOTION_TOOLS_DIR} and reuse them if they're already there: npm install --prefix ${MOTION_TOOLS_DIR} lottie-web@5.12.2 jsdom @resvg/resvg-js`
const workSteps = (o: { outFile: string; refs: boolean; base?: string }) => {
  const work = o.outFile.replace(/[^/]+$/, WORK_DIR)
  const baseWork = o.base?.replace(/[^/]+$/, WORK_DIR)
  const look = `render frames to PNG in ${work}/ and open them (look at the pictures — don't just check the JSON)`
  const steps = o.base ? [
    `1. Open ${o.base} and note what each layer is. Troupe's frames of it are in ${baseWork}/${FRAMES_DIR}/sheet.png — look at them.`,
    `2. Make the change. ${baseWork}/ may hold the script that built it (and a render script) — copy them into ${work}/, edit and re-run rather than hand-editing JSON. Keep everything else exactly as it is.`,
    `3. ${look[0].toUpperCase()}${look.slice(1)}: the change shows, everything else looks as before, nothing is cut off. Fix and render again until it's right.`,
    `4. Write the full updated animation to ${o.outFile}. Don't modify ${o.base}.`
  ] : [
    ...(o.refs ? ['1. Look at every reference closely first. When the brief says to keep a character or design, match it faithfully: silhouette, proportions, colours, face, small details.'] : ['1. Decide the look and the motion before you write anything.']),
    `2. Draw the still artwork first as vector shapes (an SVG in ${work}/), rasterise it to PNG and open it${o.refs ? ' next to the references. Fix it until it matches' : '. Fix it until it looks finished'} — most of the quality comes from this step. For words, outline real font glyphs (fontTools or opentype.js with a font on this computer) — don't draw letters by hand.`,
    `3. Build the Lottie from those shapes (a script in ${work}/) and animate it as the brief says. Loop only when the brief asks for a loop (or a loader); otherwise end on the finished picture.`,
    `4. ${look[0].toUpperCase()}${look.slice(1)} — several points across the timeline. Check the artwork still matches, nothing leaves the canvas, the timing and easing feel right, and a loop's end leads back into its start. Fix and render again until it's right.`,
    `5. Write the final file to ${o.outFile}.`
  ]
  return ['How to work:', ...steps, RENDER_RECIPE + '.', 'After you finish, Troupe renders frames with the player that shows the animation and gives them back to you for a last check.',
    `Keep scripts, SVGs and renders in ${work}/ — don't write anywhere else in this folder.`]
}

/** The review pass: Troupe's rendered frames go back to the agent, which fixes the file or leaves it. */
export function reviewPrompt(o: { outFile: string; sheet: string; frames: string[]; brief?: string; change?: string; refs: string[]; checks?: string[] }): string {
  return [
    `Troupe rendered the animation you wrote to ${o.outFile} with the player that will show it (lottie-web 5.12, SVG renderer).`,
    `- Contact sheet, start · ¼ · ½ · ¾ · end: ${o.sheet}`,
    `- The same frames one by one: ${o.frames.join(', ')}`,
    'The checkerboard behind the frames means "transparent".',
    ...(o.checks?.length ? ['', 'Troupe measured 16 frames across the timeline (facts, not opinions — fix anything marked "Cut off" or "barely moves"):', ...o.checks.map((c) => `- ${c}`)] : []),
    ...(o.brief ? ['', `Brief: ${o.brief.trim()}`] : []),
    ...(o.change ? ['', `Change requested: ${o.change.trim()}`] : []),
    ...(o.refs.length ? ['', 'References:', ...o.refs.map((r) => `- ${r}`)] : []),
    '',
    'Open the contact sheet (and the references). For each frame, say to yourself what you actually see, then compare it with what should be there:',
    '- Does the artwork match the references and the brief — shapes, proportions, colours, face, small details?',
    '- Is anything cut off, outside the canvas, missing, misplaced or overlapping wrongly?',
    '- Does the motion do what was asked? If the brief asks for a loop, do the start and end match? If not, does it end on the finished picture?',
    ...(o.change ? ['- Is the requested change visible, with everything else as before?'] : []),
    'Automatic fails — fix any of these you see:',
    ...REVIEW_BLOCKERS.map((b) => `- ${b}`),
    '',
    `If something is wrong, fix ${o.outFile} in place (edit and re-run your script in its work/ folder if there is one) and keep what already works. If it all looks right, change nothing.`,
    'Don\'t start a real browser (Playwright, Puppeteer, Chrome). To check a fix, render with the jsdom + resvg tools from your build if you have them.',
    '',
    LOTTIE_RULES,
    '',
    'Reply in one or two sentences: what you fixed, or "Looks right".'
  ].join('\n')
}

/** The prompt for one Animate run, or for an "Ask for a change" on a Result. */
export function buildMotionPrompt(o: { prompt: string; refs: string[]; seconds: number; outFile: string; base?: string; change?: string }): string {
  const kind = (r: string) => isVideo(r) ? ' (video: a reference for timing and feel only — Lottie can\'t contain video)'
    : /\.svg$/i.test(r) ? ' (SVG: rebuild its shapes as Lottie layers, keeping its look exactly)'
    : /\.json$/i.test(r) ? ' (an earlier Lottie animation: build on it — reuse its layers and style)' : ' (image: redraw what it shows as vector shapes, keeping its look)'
  const refs = o.refs.map((r) => `- ${r}${kind(r)}`)
  if (o.base && o.change) {
    return [
      'You are editing an existing Lottie animation.',
      '',
      `Current animation: ${o.base}`,
      `Change requested: ${o.change.trim()}`,
      'Keep everything the request doesn\'t mention exactly as it is (layers, names, colours, timing).',
      '',
      ...workSteps({ outFile: o.outFile, refs: false, base: o.base }),
      '',
      motionGuide(o.change, []),
      '',
      LOTTIE_RULES,
      '',
      'When done, reply in one or two sentences: what you changed and what you checked.'
    ].join('\n')
  }
  return [
    'Make a Lottie animation (Bodymovin JSON) for this brief.',
    '',
    `Brief: ${o.prompt.trim()}`,
    o.seconds > 0 ? `Length: ${o.seconds} s.` : 'Length: you choose — the natural duration for this motion: for a loop, exactly one cycle (a walk or bounce is usually 1–1.5 s); for a reveal or intro, 2–3 s. Say what you chose in your reply.',
    ...(refs.length ? ['', 'Assets and references in this folder:', ...refs] : []),
    '',
    ...workSteps({ outFile: o.outFile, refs: refs.length > 0 }),
    '',
    motionGuide(o.prompt, o.refs),
    '',
    LOTTIE_RULES,
    '',
    'When done, reply in one or two sentences: what you made and what you checked.'
  ].join('\n')
}

export function repairPrompt(outFile: string, problems: string[]): string {
  return [
    `The animation in ${outFile} didn't pass the check:`,
    ...problems.slice(0, 12).map((p) => `- ${p}`),
    '',
    `Fix ${outFile} in place so it passes. Keep the animation the same otherwise.`,
    '',
    LOTTIE_RULES
  ].join('\n')
}

export interface LottieInfo { w: number; h: number; fr: number; frames: number; seconds: number; layers: number }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Check an animation is a Lottie the player can load. Problems are short, for the agent's repair round. */
export function validateLottie(text: string): { ok: true; info: LottieInfo } | { ok: false; problems: string[] } {
  let j: any   // eslint-disable-line @typescript-eslint/no-explicit-any
  try { j = JSON.parse(text) } catch (e) { return { ok: false, problems: [`Not valid JSON: ${String((e as Error).message).slice(0, 120)}`] } }
  const p: string[] = []
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, problems: ['The file must be one JSON object'] }
  for (const k of ['fr', 'ip', 'op', 'w', 'h'] as const) if (!isNum(j[k])) p.push(`"${k}" must be a number`)
  if (isNum(j.fr) && (j.fr <= 0 || j.fr > 120)) p.push('"fr" must be between 1 and 120')
  if (isNum(j.ip) && isNum(j.op) && j.op <= j.ip) p.push('"op" must be greater than "ip"')
  if (isNum(j.w) && isNum(j.h) && (j.w <= 0 || j.h <= 0 || j.w > 8000 || j.h > 8000)) p.push('"w" and "h" must be between 1 and 8000')
  if (!Array.isArray(j.layers) || !j.layers.length) p.push('"layers" must be a non-empty array')
  const prop = (v: any, where: string) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (v === undefined) return
    if (!v || typeof v !== 'object' || !('k' in v)) { p.push(`${where} must be {"a":0|1,"k":…}`); return }
    if (v.a === 1) {
      if (!Array.isArray(v.k) || !v.k.length) { p.push(`${where} is animated but has no keyframes`); return }
      for (const kf of v.k) if (!kf || !isNum(kf.t)) { p.push(`${where}: every keyframe needs a number "t"`); break }
    }
  }
  if (Array.isArray(j.layers)) {
    const inds = new Set<number>()
    j.layers.forEach((l: any, i: number) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const at = `layer ${i + 1}${typeof l?.nm === 'string' ? ` ("${l.nm}")` : ''}`
      if (!l || typeof l !== 'object') { p.push(`${at} is not an object`); return }
      if (!isNum(l.ty)) p.push(`${at}: "ty" must be a number`)
      if (l.ty === 5) p.push(`${at}: text layers aren't allowed`)
      if (isNum(l.ind)) { if (inds.has(l.ind)) p.push(`${at}: "ind" ${l.ind} is used twice`); inds.add(l.ind) }
      if (!l.ks || typeof l.ks !== 'object') p.push(`${at}: missing transform "ks"`)
      else for (const k of ['a', 'p', 's', 'r', 'o']) prop(l.ks[k], `${at} ks.${k}`)
      if (l.ty === 4 && !Array.isArray(l.shapes)) p.push(`${at}: a shape layer needs "shapes"`)
      if (typeof JSON.stringify(l).match(/"x"\s*:\s*"/)?.[0] === 'string') p.push(`${at}: expressions aren't allowed`)
    })
  }
  if (p.length) return { ok: false, problems: [...new Set(p)] }
  const frames = j.op - j.ip
  return { ok: true, info: { w: j.w, h: j.h, fr: j.fr, frames, seconds: Math.round((frames / j.fr) * 100) / 100, layers: j.layers.length } }
}
