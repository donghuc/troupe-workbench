import { app, BrowserWindow, net, session, systemPreferences } from 'electron'
import { join } from 'path'
import { handle, isAppUrl } from './handle'
import { IPC } from '../../shared/ipc'
import { getSetting, setSetting } from '../database/settingsRepo'
import { createVoiceService, type VoiceService, type WhisperCtx } from '../voice/voiceService'
import { voiceModel, voiceLanguage, VOICE_MODEL_SETTING, VOICE_LANGUAGE_SETTING, type VoiceModelId } from '../../shared/voice'
import { logInfo } from '../util/logger'

let service: VoiceService | null = null

const modelId = (v: unknown): VoiceModelId => {
  const m = voiceModel(typeof v === 'string' ? v : '')
  if (!m) throw new Error('Unknown voice model.')
  return m.id
}

/** Microphone requests only from the app's own page, audio only (D-124). Other permissions keep Electron's default. */
export function allowMediaFromAppOnly(perm: string, requestingUrl: string, mediaTypes: string[] | undefined): boolean {
  if (perm !== 'media') return true
  return isAppUrl(requestingUrl) && !!mediaTypes?.length && mediaTypes.every((t) => t === 'audio')
}

/**
 * Load whisper.cpp on the graphics card when there is one, with nothing for the user to set up:
 * Apple silicon → Metal (in the default build). Windows → the Vulkan build, which every
 * NVIDIA, AMD and Intel driver supports; if it can't load or start (no Vulkan driver, no
 * usable GPU), the processor build. Best took ~2 min for 20 s on the processor alone.
 */
async function loadWhisper(filePath: string): Promise<WhisperCtx> {
  const { initWhisper } = await import('@fugood/whisper.node')
  const file = filePath.split(/[\\/]/).pop()
  if (process.platform === 'win32') {
    try {
      await import('@fugood/node-whisper-win32-x64-vulkan')   // throws if the GPU build can't load here
      const ctx = (await initWhisper({ filePath, useGpu: true }, 'vulkan')) as unknown as WhisperCtx
      ctx.backend = 'gpu'
      logInfo('voice: model loaded', { file, backend: 'vulkan' })
      return ctx
    } catch (e) {
      logInfo('voice: graphics card not usable, using the processor', { error: String(e).slice(0, 200) })
    }
    const ctx = (await initWhisper({ filePath, useGpu: false })) as unknown as WhisperCtx
    ctx.backend = 'cpu'
    logInfo('voice: model loaded', { file, backend: 'cpu' })
    return ctx
  }
  // Metal on Apple silicon; flash attention speeds up the encoder there.
  const ctx = (await initWhisper({ filePath, useGpu: true, useFlashAttn: true })) as unknown as WhisperCtx
  ctx.backend = process.platform === 'darwin' && process.arch === 'arm64' ? 'gpu' : 'cpu'
  logInfo('voice: model loaded', { file, backend: ctx.backend === 'gpu' ? 'metal' : 'cpu' })
  return ctx
}

// Voice input (D-124).
function voice(): VoiceService {
  return (service ??= createVoiceService({
    dir: join(app.getPath('userData'), 'voice'),
    fetch: (url, init) => net.fetch(url, init),
    initWhisper: loadWhisper,
    getSetting,
    setSetting,
    systemLocale: () => app.getPreferredSystemLanguages?.()[0] ?? app.getLocale(),
    log: (msg, data) => logInfo(msg, data),
    emit: (e) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.voiceDownload, e) }
  }))
}

export function registerVoiceIpc(): void {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const d = details as { requestingUrl?: string; mediaTypes?: string[] }
    cb(allowMediaFromAppOnly(perm, d.requestingUrl ?? wc.getURL(), d.mediaTypes))
  })
  handle('voice.status', () => voice().status())
  handle('voice.download', (_e, id: string) => voice().download(modelId(id)))
  handle('voice.cancelDownload', (_e, id: string) => { voice().cancelDownload(modelId(id)) })
  handle('voice.remove', (_e, id: string) => voice().remove(modelId(id)))
  handle('voice.setPrefs', (_e, prefs: { model?: string; language?: string }) => {
    if (prefs?.model !== undefined) setSetting(VOICE_MODEL_SETTING, modelId(prefs.model))
    if (prefs?.language !== undefined) setSetting(VOICE_LANGUAGE_SETTING, voiceLanguage(prefs.language, 'en'))
    return voice().status()
  })
  handle('voice.prepare', () => voice().prepare())
  handle('voice.transcribe', (_e, pcm: ArrayBuffer) => voice().transcribe(pcm))
  handle('voice.cancel', () => voice().cancel())
  // macOS asks once per app; Windows answers from Settings ▸ Privacy ▸ Microphone.
  handle('voice.micAccess', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'granted'
    const st = systemPreferences.getMediaAccessStatus('microphone')
    if (st === 'granted' || process.platform === 'win32') return st
    if (st === 'not-determined') return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
    return st
  })
}

export function releaseVoice(): void { void service?.release() }
