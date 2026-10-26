import type { WorkbenchApi } from './api'

// D-097: the IPC contract. Every request the renderer can make is a method on
// WorkbenchApi (shared/api.ts); its channel name is simply its path ('projects.list').
// The preload wires itself from INVOKE_PATHS, and main registers handlers with
// handle(path, fn) (main/ipc/handle.ts), which takes its argument types from the API.
// Adding a request = one method in api.ts + one line here + one handle() in main.
// Push channels (main → window) are in shared/ipc.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => any
/** Method names that subscribe to pushes instead of invoking (onChanged, onEvent, …). */
type EventName = `on${'Changed' | 'Delta' | 'Event' | 'Done' | 'Compressing'}`
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Fn
    ? (K extends EventName ? never : `${P}${K}`)
    : T[K] extends object ? Paths<T[K], `${P}${K}.`> : never
}[keyof T & string]

/** Every invokable API method, as 'namespace.method'. */
export type InvokePath = Paths<WorkbenchApi>
type At<T, P extends string> = P extends `${infer A}.${infer B}` ? (A extends keyof T ? At<T[A], B> : never) : P extends keyof T ? T[P] : never
/** The API signature behind a path. */
export type InvokeFn<P extends InvokePath> = At<WorkbenchApi, P> extends Fn ? At<WorkbenchApi, P> : never

export const INVOKE_PATHS = [
  'projects.list',
  'projects.get',
  'projects.create',
  'projects.update',
  'projects.touch',
  'projects.remove',
  'projects.connectFolder',
  'projects.addFolder',
  'projects.removeFolder',
  'projects.reorder',

  'dialog.selectFolder',

  'files.listTree',
  'files.readFile',
  'files.readDataUrl',
  'files.writeBinary',
  'files.writeFile',
  'files.watchStart',
  'files.watchStop',
  'files.search',
  'files.existing',
  'files.extractText',

  'attachments.saveBinary',
  'attachments.extractPdf',
  'attachments.list',
  'attachments.remove',

  'schedules.list',
  'schedules.create',
  'schedules.update',
  'schedules.remove',
  'schedules.runNow',
  'schedules.setBotManaged',
  'schedules.review',

  'outcomes.draft',
  'outcomes.save',
  'outcomes.list',
  'outcomes.check',

  'projectMemory.read',
  'projectMemory.write',
  'projectMemory.globalRead',
  'projectMemory.globalWrite',
  'projectMemory.overview',
  'projectMemory.adopt',

  'conversations.list',
  'conversations.recent',
  'conversations.get',
  'conversations.create',
  'conversations.rename',
  'conversations.remove',
  'conversations.attachmentCount',
  'conversations.setPinned',
  'conversations.setPermissionMode',
  'conversations.branch',
  'conversations.export',
  'conversations.search',
  'conversations.compressNow',

  'messages.list',
  'messages.deleteFrom',
  'messages.append',

  'providers.list',
  'agents.setupStart',
  'agents.setupCancel',
  'agents.check',
  'customAgents.list',
  'customAgents.save',
  'customAgents.remove',
  'customAgents.test',
  'customAgents.presets',

  'turns.start',
  'turns.regenerate',
  'turns.cancel',
  'turns.compare',
  'turns.get',
  'turns.snapshot',
  'queue.send',
  'queue.get',
  'queue.edit',
  'queue.remove',
  'queue.resume',
  'queue.clear',

  'context.list',
  'context.add',
  'context.remove',
  'context.inspect',

  'settings.get',
  'settings.set',

  'system.mcpAdd',
  'system.mcpRemove',
  'system.tools',
  'system.lookup',
  'system.openArtifactWindow',
  'system.revealItem',
  'system.revealOutside',
  'system.importOutside',
  'system.openItem',
  'system.appInfo',
  'system.diagnostics',
  'system.autoModels',
  'system.openLogs',
  'system.logRendererError',
  'system.copyImage',
  'system.cliStatus',
  'system.cliInstall',

  'notes.list',
  'notes.get',
  'notes.create',
  'notes.update',
  'notes.remove',

  'skills.list',
  'skills.create',
  'skills.update',
  'skills.remove',
  'skills.draft',
  'skills.reset',

  'voice.status',
  'voice.download',
  'voice.cancelDownload',
  'voice.remove',
  'voice.setPrefs',
  'voice.prepare',
  'voice.transcribe',
  'voice.cancel',
  'voice.micAccess',
  'image.folder',
  'image.pickFolder',
  'image.canvases',
  'image.load',
  'image.save',
  'image.applyRunResult',
  'image.clear',
  'image.setActive',
  'image.createCanvas',
  'image.renameCanvas',
  'image.duplicateCanvas',
  'image.deleteCanvas',
  'image.importMedia',
  'image.run',
  'image.cancel',
  'image.saveImage',
  'image.unsaveImage',
  'image.deleteRun',

  'collab.start',
  'collab.confirmPlan',
  'collab.stop',
  'collab.setMode',
  'collab.resume',
  'collab.recover',
  'collab.applyRepair',
  'collab.get',
  'collab.list',
] as const

// Compile-time: the list and the API must match exactly, both ways.
type Listed = typeof INVOKE_PATHS[number]
type MustBeEmpty<T extends never> = T
export type _MissingFromList = MustBeEmpty<Exclude<InvokePath, Listed>>
export type _NotInApi = MustBeEmpty<Exclude<Listed, InvokePath>>
