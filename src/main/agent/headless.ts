import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'

// Runs started without a window (scheduled tasks D-084, the command line D-117). Turn
// state is broadcast to every open window anyway and replies are persisted, so with no
// window the per-run events simply have nowhere to go — this stand-in swallows them.
const headlessSender = { isDestroyed: () => true, send: () => {} } as unknown as WebContents

/** A live window to attach a run to, or the headless stand-in. */
export function senderForRun(): WebContents {
  return BrowserWindow.getAllWindows().find((w) => !w.webContents.isDestroyed())?.webContents ?? headlessSender
}
export const isHeadless = (s: WebContents): boolean => s === headlessSender

/** Tell every window its chat lists are stale (a chat was created outside the window). */
export function broadcastConversationsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) { if (!w.webContents.isDestroyed()) w.webContents.send(IPC.conversationsChanged) }
}
