// One place for app-level notices (audit #14): info toasts that used to live in
// App.tsx state, plus errors from IPC calls, render crashes, and anything that
// escapes as an unhandled rejection. Every error is also written to main.log.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { cleanErrorMessage, errorStack, formatErrorDetails } from '../../shared/errors'

export type Notice = { id: number; kind: 'info' | 'error'; text: string; details?: string }

let notices: Notice[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const timers = new Map<number, number>()

const MAX_VISIBLE = 3
const INFO_MS = 8000
const ERROR_MS = 15000

export function dismissNotice(id: number): void {
  const t = timers.get(id); if (t) { window.clearTimeout(t); timers.delete(id) }
  const next = notices.filter((n) => n.id !== id)
  if (next.length !== notices.length) { notices = next; emit() }
}

function push(n: Omit<Notice, 'id'>, ms: number): void {
  // Same text already showing → refresh it instead of stacking duplicates.
  const dup = notices.find((x) => x.kind === n.kind && x.text === n.text)
  if (dup) dismissNotice(dup.id)
  const notice = { ...n, id: nextId++ }
  notices = [...notices, notice].slice(-MAX_VISIBLE)
  timers.set(notice.id, window.setTimeout(() => dismissNotice(notice.id), ms))
  emit()
}

export const notify = (text: string): void => push({ kind: 'info', text }, INFO_MS)

/** Record an error: main.log always, a toast unless `silent`. `where` names the user action ("Save skill"). */
export function reportError(where: string, err: unknown, opts: { silent?: boolean; extra?: string } = {}): void {
  const message = cleanErrorMessage(err)
  try { void api.system.logRendererError(where, message, errorStack(err) ?? opts.extra).catch(() => {}) } catch { /* preload missing in tests */ }
  console.error(`[${where}]`, err)
  if (!opts.silent) push({ kind: 'error', text: `${where} failed: ${message}`, details: formatErrorDetails(where, err, opts.extra) }, ERROR_MS)
}

/** `.catch(failed('Start collab'))` — report and resolve to undefined. */
export const failed = (where: string) => (err: unknown): undefined => { reportError(where, err); return undefined }

export function useNotices(): Notice[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => notices)
}

let installed = false
/** Catch what nothing else caught. Call once per window, before render. */
export function installGlobalErrorHandlers(): void {
  if (installed) return
  installed = true
  window.addEventListener('unhandledrejection', (e) => reportError('Background task', e.reason))
  window.addEventListener('error', (e) => {
    // Resource load errors (img/script) have no `error`; ResizeObserver loop noise is benign.
    if (!e.error || /ResizeObserver loop/.test(e.message)) return
    reportError('Unexpected error', e.error)
  })
}

// Open Settings on a given tab from anywhere (App listens). D-077.
export const OPEN_SETTINGS_EVENT = 'troupe:open-settings'
export const openSettings = (tab: string): void => { window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: tab })) }
export const SETTINGS_SAVED_EVENT = 'troupe:settings-saved'
// The Image folder changed in Settings ▸ Image (D-088); the Image view reloads its canvas.
export const IMAGE_FOLDER_EVENT = 'troupe:image-folder'
