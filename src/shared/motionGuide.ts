// Motion guide for the Animate card (D-148, Hien 2026-11-05): the design knowledge an agent gets
// with each run — easing by role, timing per kind of animation, loop and review rules, and a short
// recipe picked from the brief.
//
// Adapted from diffusionstudio/lottie (skills/text-to-lottie: references/motion-taste.md,
// references/recipe-loaders-icons.md, references/svg-compatibility.md, evals/output-rubric.md)
// https://github.com/diffusionstudio/lottie
// Copyright (c) 2026 Diffusion Studio Inc. — MIT License:
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or substantial portions of
//   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
//   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
// The character recipe is Troupe's own (diffusionstudio has none).

/** Easing anchors, cubic-bezier x1,y1,x2,y2. In a Lottie keyframe: "o" = {x:[x1],y:[y1]}, "i" = {x:[x2],y:[y2]}. */
const EASING_ANCHORS: { name: string; use: string; bezier: [number, number, number, number] }[] = [
  { name: 'entrance-sharp', use: 'entering, mask-wipe deceleration', bezier: [0.20, 0.75, 0.34, 0.94] },
  { name: 'settle-soft', use: 'settling, landing, logo lockup', bezier: [0.00, 0.65, 0.51, 0.99] },
  { name: 'kinetic-ui', use: 'expressive small state move (toggle, accent)', bezier: [0.85, 0.46, 0.14, 0.53] },
  { name: 'expressive-pop', use: 'the focal element\'s flourish, the active word', bezier: [0.94, 0.75, 0.34, 0.94] },
  { name: 'travel-balanced', use: 'object travel, bob, state-to-state, camera', bezier: [1.00, 0.49, 0.00, 0.55] },
  { name: 'exit-accelerate', use: 'exiting', bezier: [1.00, 0.02, 0.54, 0.42] },
  { name: 'travel-cut', use: 'only for motion interrupted by a cut or mask', bezier: [0.15, 0.85, 0.95, 0.05] }
]

const anchors = EASING_ANCHORS.map((a) => `  - ${a.name} (${a.bezier.join(', ')}): ${a.use}`).join('\n')

const CORE = `Motion guide (adapted from diffusionstudio/lottie, MIT):
- Stage motion in beats: anticipation → action → settle (→ hold). The focal subject gets the clearest timing and the strongest curve; supporting parts use quieter curves and follow 2–8 frames later (4–14 for expressive scenes). Don't animate every property on every layer — stillness gives contrast.
- Easing by role — never linear unless the motion is mechanical (spinner rotation, progress). Don't use one ease for every layer. Anchors (x1, y1, x2, y2):
${anchors}
  Derive a new curve from the nearest anchor only when none fits.
- Overshoot is small and off by default: one settle-back keyframe past the target, then ease back (or end-keyframe i.y ≈ 1.08–1.2). Anticipation: a slight pull the opposite way before a fast move.
- Timing at 60 fps: UI micro-interactions 12–30 frames · state icons 30–75 · logo marks 45–120 · text reveals 45–150 · loaders loop over 60–120.
- Loops: match first and last frames in position, opacity, colour AND speed (no hitch at the seam). Use whole cycles, closed rotations or wrapped drift. Repeated parts get phase offsets, not lockstep.
- One-shots: the final frame must work as a still poster.
- Renderer-safe: bake anything computed into keyframes; no blur, glow, glass, 3D or displacement — fake them with plain shapes and tonal fills. Path morphs need matching vertex counts, otherwise swap or mask.`

const RECIPES = {
  character: `Recipe — character / mascot (Troupe):
- Rig it: one layer per body part, parented to the body ("parent": ind); put each anchor point on the joint it turns around (hips for legs, shoulders for arms, neck for head, base for a crest or ears).
- Walk in place = 2 steps per cycle: contact → down (body lowest, slight squash) → passing (body highest, slight stretch) → contact with the other foot. The body bobs twice per cycle; feet alternate, the planted foot stays put while the lifted one moves on an arc; arms swing against the legs.
- Squash and stretch keep volume: scale x up when y goes down (e.g. 104/96), small enough to keep the face undistorted.
- Secondary parts (crest, hair, ears, tail) follow the body 2–4 frames late and settle (overlap) — never in lockstep with it.
- Bob and steps use travel-balanced / settle-soft curves, not linear. A cycle of 60–72 frames at 60 fps (1–1.2 s) reads well; the loop's last frames move at the same speed as its first.
- Keep the silhouette readable at loader size; keep the face (eyes, brows, mouth) intact.`,
  loader: `Recipe — loaders, icons, state feedback (adapted from diffusionstudio/lottie):
- Loaders loop seamlessly over 60–120 frames (matching endpoints or a period-locked cycle); linear easing only for rotation or progress sweeps. State feedback (success/error/warning) plays 30–75 frames and ends on a stable final pose.
- One primitive or icon idea, repeated with phase offsets — not unrelated moving parts. At most one charm gesture (blink, bounce, pulse, draw-on).
- Trim paths for strokes, check marks, rings. Keep geometry crisp at small sizes. Transparent background.
- Avoid: visible seams, lockstep repeats, icons that become unrecognisable mid-motion, playful motion on errors, frantic timing.`,
  logo: `Recipe — logo / wordmark (adapted from diffusionstudio/lottie):
- Separate the mark, wordmark and accents. Reveal in importance order: the mark first, the wordmark after it, accents last.
- 45–120 frames; build → settle → hold, the hold long enough to read. Prefer mask-wipes and trim-path draw-ons over plain fades; one main flourish.
- Keep the source geometry exact; transparent background.`,
  typography: `Recipe — text / titles (adapted from diffusionstudio/lottie):
- Treat kinetic type as phrase performance: the key word gets the strongest motion (expressive-pop or entrance-sharp), supporting words settle-soft. Offset words so they don't share identical keyframes; keep reading order.
- Reveals 45–150 frames depending on length; mask-wipe with entrance-sharp, revealed content settle-soft.
- Outline real font glyphs (no text layers here) and keep spacing, line breaks and optical centring right.`,
  svg: `Recipe — animating supplied SVGs (adapted from diffusionstudio/lottie):
- Keep the viewBox and scale the composition around it; inline styles; resolve nested transforms; use meaningful layer names.
- Check fill rules, holes and compound paths after conversion (even-odd vs non-zero). Expand strokes to fills unless the stroke is drawn on with trim paths. Rebuild filters and shadows as plain shapes.
- Animate semantic parts, not arbitrary path fragments. Compare the settled frame with the source SVG at the same scale.`
} as const
export type RecipeId = keyof typeof RECIPES

/** Pick the recipe(s) for a brief: one primary by what's being animated, plus SVG when SVGs are supplied. */
export function pickRecipes(brief: string, refs: string[]): RecipeId[] {
  const t = brief.toLowerCase()
  const out: RecipeId[] = []
  if (/\b(character|mascot|creature|person|walk(s|ing)?|run(s|ning)?|jump(s|ing)?|wav(e|es|ing)|dance|he|she|they|his|her)\b/.test(t)) out.push('character')
  else if (/\b(logo|wordmark|brand|lockup)\b/.test(t)) out.push('logo')
  else if (/\b(title|text|typograph\w*|quote|headline|word|words|letters?)\b/.test(t)) out.push('typography')
  if (/\b(load(er|ing)|spinner|progress|icon|badge|success|error|warning|empty)\b/.test(t) && !out.includes('character')) out.push('loader')
  if (refs.some((r) => /\.svg$/i.test(r))) out.push('svg')
  return out
}

/** The guide text for a run: the core rules plus the picked recipes. */
export function motionGuide(brief: string, refs: string[]): string {
  return [CORE, ...pickRecipes(brief, refs).map((id) => RECIPES[id])].join('\n\n')
}

/** Automatic fails for the review pass (adapted from diffusionstudio/lottie's output rubric). */
export const REVIEW_BLOCKERS = [
  'no clear focal subject, or supporting parts competing with it',
  'linear or identical easing on organic motion; every part moving in lockstep',
  'a loop that jumps or hitches at the seam (position, or speed)',
  'a one-shot whose final frame doesn\'t work as a still',
  'cropped, missing or distorted parts of the subject; artwork that no longer matches the references',
  'motion so small it can\'t be seen at the size it will be shown, or frantic timing'
]
