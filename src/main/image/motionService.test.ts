import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({}))
vi.mock('../database/settingsRepo', () => ({ getSetting: () => null }))
vi.mock('../providers/registry', () => ({ createProvider: () => null }))
vi.mock('./imageService', () => ({ requireFolder: () => '', trackRun: () => {}, untrackRun: () => {}, sendToWindow: () => {} }))

const { strayCandidates, sweepStrays } = await import('./motionService')

describe('Motion strays (D-148)', () => {
  it('moves files the agent left outside its run folder into the run\'s work/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mot-'))
    for (const d of ['inputs', 'canvases', 'outputs/run-a', 'outputs/run-b']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'inputs/logo.svg'), '<svg/>')
    writeFileSync(join(root, 'notes.txt'), 'old')
    const before = await strayCandidates(root)
    // during the run: the agent's builder + preview, Troupe's own writes, another run's file
    writeFileSync(join(root, 'build.js'), '//'); mkdirSync(join(root, 'tools')); writeFileSync(join(root, 'tools/preview.html'), '<p>')
    writeFileSync(join(root, 'inputs/new.png'), ''); writeFileSync(join(root, 'canvases/t2.json'), '{}'); writeFileSync(join(root, 'outputs/run-b/animation.json'), '{}')
    writeFileSync(join(root, 'outputs/run-a/animation.json'), '{}')
    const moved = await sweepStrays(root, before, 'outputs/run-a')
    expect(moved.sort()).toEqual(['build.js', 'tools/preview.html'])
    expect(existsSync(join(root, 'outputs/run-a/work/build.js'))).toBe(true)
    expect(existsSync(join(root, 'outputs/run-a/work/tools/preview.html'))).toBe(true)
    for (const keep of ['notes.txt', 'inputs/new.png', 'canvases/t2.json', 'outputs/run-b/animation.json', 'outputs/run-a/animation.json']) expect(existsSync(join(root, keep))).toBe(true)
  })
})
