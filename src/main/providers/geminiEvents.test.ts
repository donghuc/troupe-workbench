import { describe, it, expect } from 'vitest'
import { geminiEvents, geminiPermissionArgs, newGeminiState } from './geminiEvents'
import { parseAgyModels } from '../../shared/models'

const AGY_MODELS = `gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low      Gemini 3.8 Flash (Low)
gemini-3.7-flash-high     Gemini 3.7 Flash (High)
gemini-3.6-flash-low      Gemini 3.6 Flash (Low)
gemini-3.1-pro-high       Gemini 3.1 Pro (High)
gemini-3.1-pro-low        Gemini 3.1 Pro (Low)
claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking  Claude Opus 4.6 (Thinking)
gpt-oss-120b-medium       GPT-OSS 120B (Medium)`

describe('Gemini via agy (D-079)', () => {
  it('offers only Gemini, newest per tier, without effort variants', () => {
    expect(parseAgyModels(AGY_MODELS)).toEqual([
      { v: 'gemini-3.8-flash', l: 'Gemini 3.8 Flash' },
      { v: 'gemini-3.1-pro', l: 'Gemini 3.1 Pro' }
    ])
    expect(parseAgyModels('gemini-3.10-flash-lite  Gemini 3.10 Flash Lite\ngemini-3.9-flash-lite  x')).toEqual([{ v: 'gemini-3.10-flash-lite', l: 'Gemini 3.10 Flash Lite' }])
    expect(parseAgyModels('')).toEqual([])
  })

  it('maps a streamed run to agent events', () => {
    const st = newGeminiState()
    const lines = [
      { event: 'init', conversation_id: 'c1', init: { cwd: '/x' } },
      { event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } },
      { event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hi there!' } },
      { event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'write_to_file' } },
      { event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'write_to_file', file_path: '/x/a.md' } },
      { event: 'step_update', step_update: { step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Done.' } },
      { event: 'result', result: { status: 'SUCCESS', response: 'Hi there!\n\nDone.', usage: { input_tokens: 12740, output_tokens: 199, thinking_tokens: 189, cache_read_tokens: 2000 } } }
    ]
    const evs = lines.flatMap((l) => geminiEvents(l, st, 'gemini-3.8-flash'))
    expect(evs[0]).toEqual({ type: 'session_started', providerSessionId: 'c1', model: 'gemini-3.8-flash' })
    expect(evs.filter((e) => e.type === 'text_delta').map((e: any) => e.text)).toEqual(['Hi there!', '\n\nDone.'])
    expect(evs.filter((e) => e.type === 'tool_start' || e.type === 'tool_end' || e.type === 'file_changed').map((e) => e.type)).toEqual(['tool_start', 'tool_end', 'file_changed'])
    expect(evs.at(-1)).toEqual({ type: 'complete', usage: { inputTokens: 10740, cacheReadTokens: 2000, outputTokens: 199 } })
  })

  it('reports a failed result and falls back to the final text', () => {
    const st = newGeminiState()
    const evs = geminiEvents({ event: 'result', result: { status: 'ERROR', error: 'quota exceeded', response: '', usage: {} } }, st)
    expect(evs[0]).toEqual({ type: 'error', message: 'quota exceeded', fatal: true })
    const st2 = newGeminiState()
    expect(geminiEvents({ event: 'result', result: { status: 'SUCCESS', response: 'Only final', usage: {} } }, st2)[0]).toEqual({ type: 'text_delta', text: 'Only final' })
  })

  it('maps permission modes to agy flags', () => {
    expect(geminiPermissionArgs('read')).toEqual([])
    expect(geminiPermissionArgs('auto')).toEqual(['--dangerously-skip-permissions', '--sandbox'])
    expect(geminiPermissionArgs('full')).toEqual(['--dangerously-skip-permissions'])
  })

  it('explains tools agy refused instead of a blank reply', () => {
    const st = newGeminiState()
    const evs = geminiEvents({ event: 'result', result: { status: 'SUCCESS', response: '', usage: {}, denied_actions: [{ action: 'read_url', display_name: 'ReadUrlContent' }] } }, st)
    expect(evs[0].type).toBe('text_delta')
    expect((evs[0] as any).text).toContain('read_url(*)')
  })
})
