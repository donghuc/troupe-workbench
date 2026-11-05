import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

// D-148: a Motion run end to end with a fake agent — first pass, Troupe's frames, review pass.
let root = ''
const calls: { prompt: string; images: string[] }[] = []
let script: ((prompt: string) => void)[] = []
const done: { files: string[]; error?: string }[] = []

vi.mock('electron', () => ({}))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {} }))
vi.mock('../database/settingsRepo', () => ({ getSetting: () => null }))
vi.mock('./motionFrames', () => ({
  renderFrames: async (_t: string, dir: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'sheet.png'), 'png'); return { sheet: join(dir, 'sheet.png'), frames: [join(dir, 'frame-0000.png')] } }
}))
vi.mock('../providers/registry', () => ({
  createProvider: () => ({
    cancel: async () => {},
    run: async function* (req: { prompt: string; images?: string[] }) { calls.push({ prompt: req.prompt, images: req.images ?? [] }); script.shift()?.(req.prompt); yield { type: 'text_delta', text: 'ok' } }
  })
}))
vi.mock('./imageService', () => ({
  requireFolder: () => root, trackRun: () => {}, untrackRun: () => {},
  sendToWindow: (_s: unknown, ch: string, d: { files: string[]; error?: string }) => { if (/done/i.test(ch)) done.push(d) }
}))

const { startMotionRun } = await import('./motionService')
const anim = (layers = 1) => JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100, ddd: 0, assets: [], layers: Array.from({ length: layers }, (_, i) => ({ ty: 4, ind: i + 1, nm: `l${i}`, ip: 0, op: 30, st: 0, ks: { p: { a: 0, k: [50, 50] } }, shapes: [] })) })
const outOf = (prompt: string) => /(outputs\/run-[a-z0-9]+\/animation\.json)/i.exec(prompt)![1]
const write = (rel: string, text: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
const finished = async () => { for (let i = 0; i < 200 && !done.length; i++) await new Promise((r) => setTimeout(r, 5)); return done[0] }

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mot-run-')); calls.length = 0; done.length = 0; script = [] })

describe('Motion run with the review pass', () => {
  it('stops reviewing once the agent changes nothing', async () => {
    script = [(p) => write(outOf(p), anim(1)), () => {}]
    startMotionRun({} as never, { agent: 'codex', model: '', prompt: 'a dot', refs: [], seconds: 1 })
    await finished()
    expect(calls).toHaveLength(2)
  })
  it('shows the agent Troupe\'s frames and keeps its fix', async () => {
    // pass 1 writes, review 1 fixes, review 2 leaves it ("Looks right")
    script = [(p) => write(outOf(p), anim(1)), (p) => write(outOf(p), anim(2)), () => {}]
    startMotionRun({} as never, { agent: 'codex', model: '', prompt: 'a dot', refs: [], seconds: 1 })
    const d = await finished()
    expect(d.files).toHaveLength(1)
    expect(calls).toHaveLength(3)
    expect(calls[2].prompt).toContain('Troupe rendered the animation')
    expect(calls[1].prompt).toContain('Troupe rendered the animation')
    expect(calls[1].images[0]).toMatch(/work\/frames\/sheet\.png$/)
    expect(JSON.parse(readFileSync(join(root, d.files[0]), 'utf8')).layers).toHaveLength(2)
  })
  it('undoes a review that breaks the file', async () => {
    script = [(p) => write(outOf(p), anim(1)), (p) => write(outOf(p), '{broken')]
    startMotionRun({} as never, { agent: 'codex', model: '', prompt: 'a dot', refs: [], seconds: 1 })
    const d = await finished()
    expect(JSON.parse(readFileSync(join(root, d.files[0]), 'utf8')).layers).toHaveLength(1)
  })
})
