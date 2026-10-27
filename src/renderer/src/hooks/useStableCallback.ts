import { useCallback, useRef } from 'react'

/** A function whose identity never changes but that always calls the latest `fn` — so passing it
 *  to a memo()'d child doesn't re-render that child on every parent render (audit #17: the
 *  composer, queue and Collab card re-rendered on every streamed word). */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
