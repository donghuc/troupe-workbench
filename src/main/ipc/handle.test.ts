import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, shell: { openExternal: () => {} } }))
vi.mock('../util/logger', () => ({ logError: () => {} }))
const { isAppUrl } = await import('./handle')

const APP = 'file:///Applications/Troupe.app/Contents/Resources/app.asar/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('isAppUrl (D-097, tightened D-100)', () => {
  it('trusts exactly the packaged index.html, with or without a query', () => {
    expect(isAppUrl(APP, undefined, APP)).toBe(true)
    expect(isAppUrl(`${APP}?artifact=1&root=%2Fx&path=a.md`, undefined, APP)).toBe(true)
    expect(isAppUrl(`${APP}#top`, undefined, APP)).toBe(true)
  })
  it('refuses any other file:// page (a dropped or linked .html)', () => {
    expect(isAppUrl('file:///Users/me/Downloads/evil.html', undefined, APP)).toBe(false)
    expect(isAppUrl('file:///Applications/Troupe.app/Contents/Resources/app.asar/out/renderer/other.html', undefined, APP)).toBe(false)
  })
  it('compares percent-encoded and plain paths alike', () => {
    const spaced = 'file:///Users/me/My%20Apps/out/renderer/index.html'
    expect(isAppUrl('file:///Users/me/My Apps/out/renderer/index.html', undefined, spaced)).toBe(true)
  })
  it('trusts the dev server origin only', () => {
    expect(isAppUrl(DEV, DEV, APP)).toBe(true)
    expect(isAppUrl('http://localhost:5173/?artifact=a', 'http://localhost:5173', APP)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', DEV, APP)).toBe(false)
    expect(isAppUrl(DEV, undefined, APP)).toBe(false)
    expect(isAppUrl('https://example.com/', DEV, APP)).toBe(false)
    expect(isAppUrl('wbfile://file/?root=x&path=a.html', DEV, APP)).toBe(false)
    expect(isAppUrl('', undefined, APP)).toBe(false)
  })
})
