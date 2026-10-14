import { describe, expect, it } from 'vitest'
import { extOf, kindOf, previewRefusal } from './fileKinds'

describe('kindOf', () => {
  it('routes previewable types', () => {
    expect(kindOf('generated/beautiful-girl.jpg')).toBe('image')
    expect(kindOf('a/b/Plan.MD')).toBe('md')
    expect(kindOf('x.pdf')).toBe('pdf')
    expect(kindOf('clip.mov')).toBe('video')
    expect(kindOf('data.tsv')).toBe('csv')
  })
  it('never reads known binaries as text', () => {
    for (const f of ['deck.pptx', 'song.mp3', 'photo.HEIC', 'Archive.zip', 'font.woff2', 'design.fig']) expect(kindOf(f)).toBe('unsupported')
  })
  it('tries unknown and extension-less files as text', () => {
    expect(kindOf('notes.log')).toBe('text')
    expect(kindOf('Makefile')).toBe('text')
    expect(extOf('.gitignore')).toBe('')
  })
  it('recognises the main-process refusals', () => {
    expect(previewRefusal(new Error("Error invoking remote method 'files.readFile': Error: FILE_BINARY"))).toBe('binary')
    expect(previewRefusal(new Error('FILE_TOO_LARGE'))).toBe('too-large')
    expect(previewRefusal(new Error('ENOENT'))).toBeNull()
  })
})
