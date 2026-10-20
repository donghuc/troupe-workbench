import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { thumbnail, snapWidth, type ThumbImage } from './thumbs'

const img = (width: number, log: string[]): ThumbImage => ({
  isEmpty: () => false, getSize: () => ({ width, height: width }),
  resize: (o) => { log.push(`resize ${o.width}`); return img(o.width, log) },
  toJPEG: () => Buffer.from(`jpg ${width}`), toPNG: () => Buffer.from(`png ${width}`)
})

describe('Image Creation thumbnails (image perf)', () => {
  const src = mkdtempSync(join(tmpdir(), 'th-'))
  const big = join(src, 'big.png'); writeFileSync(big, 'x')
  const svg = join(src, 'a.svg'); writeFileSync(svg, '<svg/>')
  it('snaps widths to a few sizes', () => { expect([150, 200, 320, 401, 2000].map(snapWidth)).toEqual([200, 200, 400, 680, 680]) })
  it('makes one cached copy per size; serves SVGs as they are', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-')), log: string[] = []
    const deps = { dir, decode: () => { log.push('decode'); return img(1536, log) } }
    const [a, b] = await Promise.all([thumbnail(big, 380, deps), thumbnail(big, 380, deps)])
    expect(a).toEqual({ body: Buffer.from('png 400'), mime: 'image/png' })
    expect(b).toEqual(a)
    expect(log).toEqual(['decode', 'resize 400'])          // two requests, one decode
    expect(await thumbnail(big, 400, deps)).toEqual(a)     // from disk now
    expect(log).toEqual(['decode', 'resize 400'])
    expect(readdirSync(dir)).toHaveLength(1)
    expect(await thumbnail(svg, 400, deps)).toBeNull()
  })
  it('prefers the OS thumbnailer and never upscales', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-')), log: string[] = []
    const small = join(src, 'small.jpg'); writeFileSync(small, 'y')
    const deps = { dir, osThumb: async () => { log.push('os'); return img(120, log) }, decode: () => { log.push('decode'); return img(120, log) } }
    expect(await thumbnail(small, 200, deps)).toEqual({ body: Buffer.from('jpg 120'), mime: 'image/jpeg' })
    expect(log).toEqual(['os'])
  })
})
