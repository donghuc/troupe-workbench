// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Voice input (D-124): click → recording pill → stop → the words go to the composer; Esc
// and ✕ discard; the shortcut reaches the button; no model → Settings. The recorder and
// main are faked (jsdom has no microphone).
const calls: string[] = []
let active: string | null = 'small'
const statusListeners: ((s: unknown) => void)[] = []
vi.mock('../voice', async () => {
  const real = await vi.importActual<typeof import('../voice')>('../voice')
  return {
    ...real,
    onVoiceStatus: (cb: (s: unknown) => void) => { statusListeners.push(cb); cb({ active }); return () => {} },
    startRecording: async () => { calls.push('start'); return { finish: async () => { calls.push('finish'); return new ArrayBuffer(32_000) }, discard: () => calls.push('discard') } }
  }
})
const transcribe = vi.fn(async () => ({ text: ' [BLANK_AUDIO] Hello  Troupe ', ms: 5 }))
;(globalThis as unknown as { window: Record<string, unknown> }).window.workbench = {
  voice: { transcribe, prepare: async () => { calls.push('prepare') }, cancel: async () => { calls.push('cancel') }, status: async () => ({ active }), onEvent: () => () => {}, micAccess: async () => 'granted' }
}
const notices: string[] = []
vi.mock('../notices', () => ({ notify: (m: string) => notices.push(m), reportError: (w: string, e: unknown) => notices.push(`${w}: ${String(e)}`), openSettings: (t: string) => notices.push(`open ${t}`) }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: VoiceButton } = await import('./VoiceButton')

async function mount(owner?: string) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const scope = createRef<HTMLDivElement>()
  const texts: string[] = []
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement('div', { ref: scope, tabIndex: -1 }, createElement(VoiceButton, { scope, owner, onText: (t: string) => texts.push(t) })))
  })
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  const click = async (sel: string) => { await act(async () => { q(sel)!.click() }) }
  return { host, q, click, texts, scope, unmount: () => act(async () => root.unmount()) }
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => { calls.length = 0; notices.length = 0; active = 'small'; transcribe.mockClear() })

describe('VoiceButton (D-124)', () => {
  it('records, stops and inserts the cleaned words', async () => {
    const m = await mount()
    await m.click('.mic-btn')
    expect(m.q('.voice-pill.recording')).not.toBeNull()
    await m.click('button[aria-label="Stop and transcribe"]')
    await flush()
    expect(calls).toEqual(['start', 'prepare', 'finish'])
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(m.texts).toEqual(['Hello Troupe'])
    expect(m.q('.mic-btn')).not.toBeNull()
    await m.unmount()
  })

  it('Esc discards a recording without transcribing', async () => {
    const m = await mount()
    await m.click('.mic-btn')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(calls).toEqual(['start', 'prepare', 'discard'])
    expect(transcribe).not.toHaveBeenCalled()
    expect(m.q('.mic-btn')).not.toBeNull()
    await m.unmount()
  })

  it('the shortcut starts and stops the focused composer’s recording', async () => {
    const m = await mount()
    await act(async () => { m.scope.current!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    const key = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', shiftKey: true, metaKey: true, ctrlKey: false })) })
    await key()
    expect(m.q('.voice-pill.recording')).not.toBeNull()
    await key(); await flush()
    expect(m.texts).toEqual(['Hello Troupe'])
    await m.unmount()
  })

  it('without a model it opens Settings ▸ Tools instead of recording', async () => {
    active = null
    const m = await mount()
    await m.click('.mic-btn')
    expect(calls).toEqual([])
    expect(notices[0]).toBe('open tools')
    await m.unmount()
  })

  it('leaving the chat while it transcribes keeps the words: back in time → in the composer', async () => {
    let done!: (v: { text: string; ms: number }) => void
    transcribe.mockImplementationOnce(() => new Promise((r) => { done = r }))
    const a = await mount('chat-a')
    await a.click('.mic-btn')
    await a.click('button[aria-label="Stop and transcribe"]')
    await flush()
    expect(a.q('.voice-pill')).not.toBeNull()          // Transcribing…
    await a.unmount()
    const b = await mount('chat-a')                      // came back
    expect(b.q('.voice-pill')?.textContent).toContain('Transcribing')
    await act(async () => { done({ text: 'kept words', ms: 5 }) })
    await flush()
    expect(b.texts).toEqual(['kept words'])
    expect(a.texts).toEqual([])
    expect(localStorage.getItem('draft:chat-a')).toBeNull()
    await b.unmount()
  })

  it('…still away when it finishes → added to that chat’s draft', async () => {
    localStorage.setItem('draft:chat-b', 'Ask Claude')
    let done!: (v: { text: string; ms: number }) => void
    transcribe.mockImplementationOnce(() => new Promise((r) => { done = r }))
    const a = await mount('chat-b')
    await a.click('.mic-btn')
    await a.unmount()                                    // left while recording: still transcribed
    expect(calls).toContain('finish')
    await flush()
    await act(async () => { done({ text: 'about the plan', ms: 5 }) })
    await flush()
    expect(localStorage.getItem('draft:chat-b')).toBe('Ask Claude about the plan')
    expect(a.texts).toEqual([])
  })
})
