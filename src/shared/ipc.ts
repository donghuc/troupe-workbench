// Push channels, main → window (webContents.send / ipcRenderer.on). Requests from the
// window to main are in shared/contract.ts (D-097): their channel is their API path.
export const IPC = {
  filesChanged: 'files:changed',
  turnsChanged: 'turns:changed',
  turnsDelta: 'turns:delta',   // D-094: appended lane text only
  convCompressing: 'conv:compressing',   // main -> renderer
  skillsChanged: 'skills:changed',
  collabChanged: 'collab:changed',
  imageEvent: 'image:event',   // main -> renderer
  imageDone: 'image:done',      // main -> renderer
  agentSetup: 'agents:setup',   // 2.3: install / sign-in output lines and results
  customAgentsChanged: 'customAgents:changed',   // 2.4: the user-added agent list
  conversationsChanged: 'conversations:changed',
  schedulesChanged: 'schedules:changed',
  voiceDownload: 'voice:download',   // D-124: model download progress   // D-117: a chat was created outside the window (CLI, scheduler)
} as const
