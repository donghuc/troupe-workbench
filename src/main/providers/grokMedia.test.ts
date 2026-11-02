import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../util/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {} }))
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const { newImagesInCwd, recoverGrokSessionImages } = await import('./GrokProvider')

// B-076: grok made 3 clips + a still in its session folder, stitched the clips into
// generated/grok/daughter-abroad.mp4, and Troupe still copied the raw clips in and attached them.
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'gh-'))
  const cwd = mkdtempSync(join(tmpdir(), 'anim-'))
  const since = Date.now() - 60_000
  const sess = join(home, '.grok', 'sessions', encodeURIComponent(cwd), '01a19b9c-x')
  mkdirSync(join(sess, 'videos'), { recursive: true }); mkdirSync(join(sess, 'images'), { recursive: true })
  for (const n of [1, 2, 3]) writeFileSync(join(sess, 'videos', `${n}.mp4`), `clip${n}`)
  writeFileSync(join(sess, 'images', '6.jpg'), 'still')
  return { home, cwd, since }
}

describe('Grok media in the project (B-076)', () => {
  it('finds grok\'s own video in generated/grok/ and copies none of its raw clips', async () => {
    const { home, cwd, since } = setup()
    mkdirSync(join(cwd, 'generated', 'grok'), { recursive: true })
    writeFileSync(join(cwd, 'generated', 'grok', 'daughter-abroad.mp4'), 'stitched 15 s')
    mkdirSync(join(cwd, 'animations', 'daughter-abroad', 'frames'), { recursive: true })
    writeFileSync(join(cwd, 'animations', 'daughter-abroad', 'frames', 'shot1-start.jpg'), 'frame')
    const reply = 'Here it is: [daughter-abroad.mp4](generated/grok/daughter-abroad.mp4)'
    const own = await newImagesInCwd(cwd, since, reply)
    expect(own).toEqual([join(cwd, 'generated', 'grok', 'daughter-abroad.mp4')])   // frames it checked aren't output
    const r = await recoverGrokSessionImages(cwd, since, { text: reply, skipSizes: new Set(), onlyReferenced: own.length > 0 }, home)
    expect(r.images).toEqual([])
    expect(readdirSync(join(cwd, 'generated', 'grok'))).toEqual(['daughter-abroad.mp4'])
  })
  it('finds a video the reply links anywhere in the project', async () => {
    const { cwd, since } = setup()
    mkdirSync(join(cwd, 'animations', 'out'), { recursive: true })
    writeFileSync(join(cwd, 'animations', 'out', 'final.mp4'), 'v')
    expect(await newImagesInCwd(cwd, since, 'Saved to `animations/out/final.mp4`.')).toEqual([join(cwd, 'animations', 'out', 'final.mp4')])
    expect(await newImagesInCwd(cwd, since, 'See [x](../../etc/passwd.jpg)')).toEqual([])   // never outside the project
  })
  it('still recovers grok\'s media when it saved nothing into the project', async () => {
    const { home, cwd, since } = setup()
    const reply = 'Done: ![clip](videos/1.mp4)'
    expect(await newImagesInCwd(cwd, since, reply)).toEqual([])
    const r = await recoverGrokSessionImages(cwd, since, { text: reply, skipSizes: new Set(), onlyReferenced: false }, home)
    expect(r.images.map((i) => i.orig).sort()).toEqual(['images/6.jpg', 'videos/1.mp4', 'videos/2.mp4', 'videos/3.mp4'])
    expect(existsSync(join(cwd, 'generated', 'grok'))).toBe(true)
  })
})
