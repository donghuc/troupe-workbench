import { describe, expect, it } from 'vitest'
import { cleanTranscript, insertAtCaret, toPcm16, voiceLanguage, formatElapsed, VOICE_MODELS, DEFAULT_VOICE_MODEL } from './voice'

describe('voice helpers (D-124)', () => {
  it('converts float samples to 16-bit little-endian PCM, clipping', () => {
    const v = new DataView(toPcm16(new Float32Array([0, 1, -1, 0.5, 2])))
    expect(v.byteLength).toBe(10)
    expect([0, 2, 4, 6, 8].map((o) => v.getInt16(o, true))).toEqual([0, 32767, -32768, 16383, 32767])
  })

  it('drops whisper noise tags and tidies spaces', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('')
    expect(cleanTranscript(' Hello  there. (music) [Music] ♪')).toBe('Hello there.')
    expect(cleanTranscript('Xin chào,  hôm nay \n tôi')).toBe('Xin chào, hôm nay\ntôi')
  })

  it('inserts at the caret with spaces only where words would touch', () => {
    expect(insertAtCaret('', 0, 0, 'hi')).toEqual({ text: 'hi', caret: 2 })
    expect(insertAtCaret('Ask', 3, 3, 'claude')).toEqual({ text: 'Ask claude', caret: 10 })
    expect(insertAtCaret('Ask ', 4, 4, 'claude')).toEqual({ text: 'Ask claude', caret: 10 })
    expect(insertAtCaret('ab', 1, 1, 'X')).toEqual({ text: 'a X b', caret: 3 })
    expect(insertAtCaret('one two.', 7, 7, 'three')).toEqual({ text: 'one two three.', caret: 13 })
    expect(insertAtCaret('replace me now', 8, 10, 'you')).toEqual({ text: 'replace you now', caret: 11 })
    expect(insertAtCaret('x', 5, 9, 'y')).toEqual({ text: 'x y', caret: 3 })
    expect(insertAtCaret('keep', 2, 2, '')).toEqual({ text: 'keep', caret: 2 })
  })

  it('knows its languages and models', () => {
    expect(voiceLanguage('vi')).toBe('vi')
    expect(voiceLanguage('xx')).toBe('auto')
    expect(voiceLanguage(null)).toBe('auto')
    expect(VOICE_MODELS.some((m) => m.id === DEFAULT_VOICE_MODEL)).toBe(true)
    expect(VOICE_MODELS.every((m) => /^[0-9a-f]{64}$/.test(m.sha256) && m.bytes > 0)).toBe(true)
    expect(formatElapsed(65)).toBe('1:05')
  })
})
