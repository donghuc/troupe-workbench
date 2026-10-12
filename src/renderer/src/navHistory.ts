import { useEffect, useRef, useState } from 'react'

// D-086 window history, extracted from App (D-098). Every view change is a step; Back and
// Forward walk the steps. Pure stack rules below, the hook wires them to React.

export interface NavStack { stack: string[]; i: number; target: string | null }
export const NAV_MAX = 60

/** Record that the window is now at `key`. Returns false when nothing changed. */
export function recordLoc(h: NavStack, key: string): boolean {
  if (h.target) { if (h.target === key) h.target = null; else return false }   // intermediate states while Back/Forward apply
  if (h.stack[h.i] === key) return false
  h.stack = [...h.stack.slice(0, h.i + 1), key].slice(-NAV_MAX); h.i = h.stack.length - 1
  return true
}

/** Move one step back (-1) or forward (+1). Returns the key to go to, or null at an end. */
export function stepLoc(h: NavStack, dir: -1 | 1): string | null {
  const n = h.i + dir
  if (n < 0 || n >= h.stack.length) return null
  h.i = n; h.target = h.stack[n]
  return h.stack[n]
}

/** `locKey` = the current view, serialized; `apply` switches the window to a stored key. */
export function useNavHistory(locKey: string, apply: (key: string) => void) {
  const hist = useRef<NavStack>({ stack: [locKey], i: 0, target: null })
  const [, bump] = useState(0)
  useEffect(() => { if (recordLoc(hist.current, locKey)) bump((n) => n + 1) }, [locKey])
  const go = (dir: -1 | 1) => {
    const key = stepLoc(hist.current, dir)
    if (key === null) return
    setTimeout(() => { if (hist.current.target === key) hist.current.target = null }, 800)   // never wedge if the target can't be reached (deleted chat)
    apply(key)
    bump((n) => n + 1)
  }
  return { canBack: hist.current.i > 0, canForward: hist.current.i < hist.current.stack.length - 1, goBack: () => go(-1), goForward: () => go(1) }
}
