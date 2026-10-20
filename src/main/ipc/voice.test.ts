import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, shell: { openExternal: () => {} }, app: {}, BrowserWindow: {}, net: {}, session: {}, systemPreferences: {} }))
vi.mock('../util/logger', () => ({ logError: () => {}, logInfo: () => {} }))
vi.mock('../database/settingsRepo', () => ({ getSetting: () => null, setSetting: () => {} }))
const { allowMediaFromAppOnly } = await import('./voice')

describe('microphone permission (D-124)', () => {
  const dev = process.env.ELECTRON_RENDERER_URL
  it('lets only the app page record audio; other permissions keep the default', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    expect(allowMediaFromAppOnly('media', 'http://localhost:5173/', ['audio'])).toBe(true)
    expect(allowMediaFromAppOnly('media', 'http://localhost:5173/', ['audio', 'video'])).toBe(false)
    expect(allowMediaFromAppOnly('media', 'http://localhost:5173/', [])).toBe(false)
    expect(allowMediaFromAppOnly('media', 'wbfile://file/?root=x&path=a.html', ['audio'])).toBe(false)
    expect(allowMediaFromAppOnly('media', 'https://example.com/', ['audio'])).toBe(false)
    expect(allowMediaFromAppOnly('clipboard-sanitized-write', 'wbfile://x', undefined)).toBe(true)
    process.env.ELECTRON_RENDERER_URL = dev
  })
})
