// Claude Code's `--output-format stream-json` frames → AgentEvents. Extracted from the
// Claude provider (2.4) so user-added agents that print the same format reuse it. Pure.
import type { AgentEvent } from '../../shared/agent'

export interface ClaudeStreamState { sawTextDelta: boolean; fallbackText: string }
export const newClaudeState = (): ClaudeStreamState => ({ sawTextDelta: false, fallbackText: '' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function claudeEvents(e: any, st: ClaudeStreamState): AgentEvent[] {
  const out: AgentEvent[] = []
  if (e.type === 'system' && e.subtype === 'init') {
    out.push({ type: 'session_started', providerSessionId: e.session_id, model: e.model })
  } else if (e.type === 'stream_event') {
    const inner = e.event
    if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
      st.sawTextDelta = true
      out.push({ type: 'text_delta', text: inner.delta.text })
    }
  } else if (e.type === 'assistant') {
    for (const b of e.message?.content ?? []) {
      if (b.type === 'tool_use') out.push({ type: 'tool_start', tool: b.name, input: b.input, itemId: b.id })
      else if (b.type === 'text' && typeof b.text === 'string') st.fallbackText = b.text
    }
  } else if (e.type === 'user') {
    for (const b of e.message?.content ?? []) {
      if (b?.type === 'tool_result') out.push({ type: 'tool_end', tool: 'tool', isError: !!b.is_error, itemId: b.tool_use_id })
    }
  } else if (e.type === 'result') {
    if (!st.sawTextDelta && st.fallbackText.trim()) out.push({ type: 'text_delta', text: st.fallbackText })
    const errored = e.is_error === true || (typeof e.subtype === 'string' && e.subtype.startsWith('error'))
    const producedText = st.sawTextDelta || !!st.fallbackText.trim()
    if (errored && !producedText) {
      // An error with no text (a usage limit, or an execution error that exits cleanly) is
      // surfaced instead of a silent blank complete (B-041).
      // e.errors carries the reason for startup failures, e.g. "Sandbox required but unavailable…" (D-115).
      const listed = Array.isArray(e.errors) ? e.errors.filter((x: unknown) => typeof x === 'string' && x.trim()).join('\n') : ''
      const msg = (typeof e.result === 'string' && e.result.trim()) || listed || e.subtype || 'The agent reported an error'
      out.push({ type: 'error', message: String(msg), fatal: true })
    }
    // Fresh input, cache-read and cache-write stay separate so the UI can show whether
    // prompt caching is helping across turns.
    const u = e.usage ?? {}
    out.push({
      type: 'complete',
      usage: { inputTokens: u.input_tokens, cacheReadTokens: u.cache_read_input_tokens, cacheCreationTokens: u.cache_creation_input_tokens, outputTokens: u.output_tokens, costUsd: e.total_cost_usd }
    })
  }
  return out
}
