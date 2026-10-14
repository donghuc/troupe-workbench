import type { Card, CardKind } from '../../../../shared/imageCanvas'

import { dim } from '../../styles/tokens'

// Fixed card geometry, so ports and edges are computed, never measured (D-088).
// One source: the Figma tokens (tokens.ts here, the same names as CSS vars in app.css).
const HEAD_H = dim['layout/img-card-head-height']
const SLOTS_PAD = dim['space/2']
const SLOT_H = dim['layout/img-slot-height']
export const CARD_W: Record<CardKind, number> = {
  prompt: dim['layout/img-card-prompt-width'],
  media: dim['layout/img-card-media-width'],
  processor: dim['layout/img-card-processor-width'],
  output: dim['layout/img-card-output-width']
}

export interface Pt { x: number; y: number }

export const outPort = (k: Card): Pt => ({ x: k.x + CARD_W[k.kind], y: k.y + HEAD_H / 2 })

export function inPort(k: Card, slot: string): Pt {
  if (k.kind === 'processor') {
    const i = Math.max(0, k.data.slots.indexOf(slot))
    return { x: k.x, y: k.y + HEAD_H + SLOTS_PAD + i * SLOT_H + SLOT_H / 2 }
  }
  return { x: k.x, y: k.y + HEAD_H / 2 }
}

export function edgePath(a: Pt, b: Pt): string {
  const dx = Math.max(60, Math.abs(b.x - a.x) / 2)
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

export const fileUrl = (root: string, rel: string): string =>
  `wbfile://file/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`

/** Drag payload for an image already in the Image folder (Saved panel, Output cards):
 *  its folder-relative path. Dropped on a Media card it's added as a reference. */
export const IMAGE_REF_TYPE = 'application/x-troupe-image-ref'
