import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { INVOKE_PATHS } from '../shared/contract'
import type { WorkbenchApi } from '../shared/api'

// D-097: requests are wired from the contract — api.<ns>.<method>(...args) invokes the
// channel '<ns>.<method>'. Only push subscriptions are written out by hand.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tree = Record<string, Record<string, unknown>>
const api: Tree = {}
for (const path of INVOKE_PATHS) {
  const [ns, method] = path.split('.')
  ;(api[ns] ??= {})[method] = (...args: unknown[]) => ipcRenderer.invoke(path, ...args)
}

/** Subscribe to a push channel; returns the unsubscribe function. */
const on = (channel: string, withPayload = true) => (cb: (payload?: any) => void): (() => void) => {
  const l = (_e: IpcRendererEvent, payload: unknown) => (withPayload ? cb(payload) : cb())
  ipcRenderer.on(channel, l)
  return () => { ipcRenderer.removeListener(channel, l) }
}
const subscriptions: Record<string, Record<string, unknown>> = {
  files: { onChanged: on(IPC.filesChanged) },
  conversations: { onCompressing: on(IPC.convCompressing), onChanged: on(IPC.conversationsChanged, false) },
  schedules: { onChanged: on(IPC.schedulesChanged, false) },
  turns: { onChanged: on(IPC.turnsChanged), onDelta: on(IPC.turnsDelta) },
  queue: { onChanged: on(IPC.queueChanged) },
  skills: { onChanged: on(IPC.skillsChanged, false) },
  image: { onEvent: on(IPC.imageEvent), onDone: on(IPC.imageDone) },
  collab: { onChanged: on(IPC.collabChanged) },
  agents: { onEvent: on(IPC.agentSetup) },
  customAgents: { onChanged: on(IPC.customAgentsChanged) },
  voice: { onEvent: on(IPC.voiceDownload) }
}
for (const [ns, fns] of Object.entries(subscriptions)) Object.assign((api[ns] ??= {}), fns)

const bridge = { platform: process.platform, ...api } as unknown as WorkbenchApi
contextBridge.exposeInMainWorld('workbench', bridge)
