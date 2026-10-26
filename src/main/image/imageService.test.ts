import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// D-102: canvases on disk, against a real temporary Image folder.
let folder = ''
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../database/settingsRepo', () => ({ getSetting: (k: string) => (k === 'image_folder' ? folder : null), setSetting: () => {} }))
vi.mock('../providers/registry', () => ({ createProvider: () => undefined }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))

const svc = await import('./imageService')
const { makeCard, emptyCanvas, outputsOf } = await import('../../shared/imageCanvas')
const legacy = { version: 1, cards: [{ id: 'p1', kind: 'prompt', x: 10, y: 20, data: { text: 'old canvas' } }], edges: [], view: { x: 0, y: 0, zoom: 1 } }

beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'troupe-img-')) })

describe('canvases on disk', () => {
  it('moves the old canvas.json into the first tab', async () => {
    writeFileSync(join(folder, 'canvas.json'), JSON.stringify(legacy))
    const ix = await svc.canvasIndex()
    expect(ix.tabs).toEqual([{ id: ix.active, name: 'Canvas 1' }])
    expect(existsSync(join(folder, 'canvas.json'))).toBe(false)
    const c = await svc.loadCanvas(ix.active)
    expect((c.cards[0] as any).data.text).toBe('old canvas')
    expect(JSON.parse(readFileSync(join(folder, 'canvases', 'index.json'), 'utf8')).active).toBe(ix.active)
  })

  it('starts with one blank canvas when there was none', async () => {
    const ix = await svc.canvasIndex()
    expect(ix.tabs.length).toBe(1)
    expect((await svc.loadCanvas(ix.active)).cards).toEqual([])
  })

  it('creates, renames, duplicates and switches', async () => {
    const first = (await svc.canvasIndex()).active
    await svc.saveCanvas(first, legacy as any)
    let ix = await svc.createCanvas(first)
    expect(ix.tabs.map((t) => t.name)).toEqual(['Canvas 1', 'Canvas 2'])
    const second = ix.active
    ix = await svc.renameCanvas(second, 'Logos')
    expect(ix.tabs[1].name).toBe('Logos')
    ix = await svc.duplicateCanvas(first)
    expect(ix.tabs.map((t) => t.name)).toEqual(['Canvas 1', 'Canvas 1 copy', 'Logos'])
    expect(((await svc.loadCanvas(ix.active)).cards[0] as any).data.text).toBe('old canvas')
    ix = await svc.setActiveCanvas(second)
    expect(ix.active).toBe(second)
  })

  it('deleting keeps a copy in .history; deleting the last leaves a blank canvas', async () => {
    const first = (await svc.canvasIndex()).active
    await svc.saveCanvas(first, legacy as any)
    const ix = await svc.deleteCanvas(first)
    expect(ix.tabs.length).toBe(1)
    expect(ix.active).not.toBe(first)
    expect(readdirSync(join(folder, '.history')).some((f) => f.startsWith(`deleted-${first}`))).toBe(true)
    // a late autosave of the deleted canvas must not bring it back
    await svc.saveCanvas(first, legacy as any)
    expect(existsSync(join(folder, 'canvases', `${first}.json`))).toBe(false)
  })

  it('clear snapshots then empties one canvas', async () => {
    const first = (await svc.canvasIndex()).active
    await svc.saveCanvas(first, legacy as any)
    expect((await svc.clearCanvas(first)).cards).toEqual([])
    expect(readdirSync(join(folder, '.history')).some((f) => f.startsWith(`cleared-${first}`))).toBe(true)
  })

  it('keeps a run folder another canvas still uses', async () => {
    const first = (await svc.canvasIndex()).active
    const withRun = { ...legacy, cards: [{ id: 'o1', kind: 'output', x: 0, y: 0, data: { runs: [{ id: 'run-abc', at: '', agent: 'codex', model: '', files: ['outputs/run-abc/image-1.png'], inputsHash: '' }], selected: [], saved: {} } }] }
    await svc.saveCanvas(first, withRun as any)
    const copy = (await svc.duplicateCanvas(first)).active
    mkdirSync(join(folder, 'outputs', 'run-abc'), { recursive: true })
    writeFileSync(join(folder, 'outputs', 'run-abc', 'image-1.png'), 'x')
    expect(await svc.deleteRun('run-abc', copy)).toBe(false)          // first canvas still lists it
    expect(existsSync(join(folder, 'outputs', 'run-abc'))).toBe(true)
    await svc.saveCanvas(first, legacy as any)                          // first canvas drops the run
    expect(await svc.deleteRun('run-abc', copy)).toBe(true)
    expect(existsSync(join(folder, 'outputs', 'run-abc'))).toBe(false)
  })

  it('rejects ids that would escape the canvases folder', async () => {
    await expect(svc.loadCanvas('../../etc')).resolves.toEqual(expect.objectContaining({ cards: [] }))
    await expect(svc.clearCanvas('../x')).rejects.toThrow()
  })
  it('two run results and an autosave on one canvas all land; no temp file is shared (audit P0-4)', async () => {
    const id = (await svc.canvasIndex()).active
    const p = makeCard('processor', 0, 0)
    const base = { ...emptyCanvas(), cards: [p] }
    await svc.saveCanvas(id, base)
    const rec = (n: string) => ({ id: n, at: 't', files: [`${n}.png`], inputsHash: 'h' })
    await Promise.all([
      svc.applyRunResultTo(id, p.id, rec('r1')),
      svc.applyRunResultTo(id, p.id, rec('r2')),
      svc.applyRunResultTo(id, p.id, rec('r3'))
    ])
    const c = await svc.loadCanvas(id)
    const outs = outputsOf(c, p.id)
    expect(outs).toHaveLength(1)
    expect((outs[0] as any).data.runs.map((r: any) => r.id).sort()).toEqual(['r1', 'r2', 'r3'])
    expect(readdirSync(join(folder, 'canvases')).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
