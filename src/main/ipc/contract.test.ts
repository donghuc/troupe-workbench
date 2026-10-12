import { describe, it, expect, vi } from 'vitest'
import { INVOKE_PATHS } from '../../shared/contract'

// D-097: runtime half of the contract. The compiler checks the list against the API;
// these check that main registers a handler for every path (exactly once) and that the
// preload exposes every method, invoking the channel of the same name.
const registered: string[] = []
const invoked: Array<[string, unknown[]]> = []
let exposed: any = null   // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('electron', () => {
  const stub: any = new Proxy(() => stub, { get: (_t, k) => (k === 'then' ? undefined : stub) })   // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    ipcMain: { handle: (ch: string) => registered.push(ch), on: () => {} },
    ipcRenderer: { invoke: (ch: string, ...a: unknown[]) => { invoked.push([ch, a]); return Promise.resolve() }, on: () => {}, removeListener: () => {} },
    contextBridge: { exposeInMainWorld: (_k: string, v: unknown) => { exposed = v } },
    app: stub, BrowserWindow: stub, dialog: stub, shell: stub, clipboard: stub, nativeImage: stub, protocol: stub, net: stub, Notification: stub, webContents: stub, Menu: stub, systemPreferences: stub
  }
})

describe('IPC contract at runtime (D-097)', () => {
  it('main registers every path exactly once, and nothing else', async () => {
    const mods = await Promise.all([
      import('./agent'), import('./collab'), import('./context'), import('./conversations'), import('./files'), import('./image'),
      import('./memory'), import('./notes'), import('./projects'), import('./schedules'), import('./skills'), import('./system')
    ])
    for (const m of mods) for (const [name, fn] of Object.entries(m)) if (name.startsWith('register') && typeof fn === 'function') (fn as () => void)()
    expect([...registered].sort()).toEqual([...INVOKE_PATHS].sort())
    expect(new Set(registered).size).toBe(registered.length)
  })

  it('the preload exposes every method and invokes its own path', async () => {
    await import('../../preload/index')
    for (const path of INVOKE_PATHS) {
      const [ns, method] = path.split('.')
      expect(typeof exposed[ns]?.[method], path).toBe('function')
      await exposed[ns][method]('a', 2)
      expect(invoked.at(-1)).toEqual([path, ['a', 2]])
    }
    for (const [ns, m] of [['files', 'onChanged'], ['turns', 'onDelta'], ['turns', 'onChanged'], ['collab', 'onChanged'], ['skills', 'onChanged'], ['image', 'onDone']]) {
      expect(typeof exposed[ns][m](() => {}), `${ns}.${m}`).toBe('function')   // returns an unsubscribe
    }
    expect(typeof exposed.platform).toBe('string')
  })
})
