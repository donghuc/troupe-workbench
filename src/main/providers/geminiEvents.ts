import type { AgentEvent } from '../../shared/agent'

// Maps one line of `agy --output-format stream-json` to Troupe's AgentEvents (D-079).
// Pure (no electron) so it is unit-tested. Observed shape (agy, 2026-09):
//   {"event":"init","conversation_id":"…","init":{cwd, tools, permission_mode}}
//   {"event":"step_update","step_update":{step_index, state:"ACTIVE"|"DONE"|…, step_type, text_delta?, usage?}}
//   {"event":"result","result":{conversation_id, status:"SUCCESS"|…, response, usage:{input_tokens, output_tokens, thinking_tokens, cache_read_tokens}}}
// Tool steps are not documented yet: any step_type other than user_input/agent_response is
// shown as a tool (start on first sight, end when it leaves ACTIVE). WB_GEMINI_RAW logs lines.
export interface GeminiParseState { textStep: number | null; sawText: boolean; openTools: Set<number> }
export const newGeminiState = (): GeminiParseState => ({ textStep: null, sawText: false, openTools: new Set() })

const FILE_TOOL = /write|replace|edit|sed_file|notebook_edit/i

export function geminiEvents(e: any, st: GeminiParseState, model?: string): AgentEvent[] {
  const out: AgentEvent[] = []
  if (!e || typeof e !== 'object') return out
  if (e.event === 'init') {
    if (e.conversation_id) out.push({ type: 'session_started', providerSessionId: String(e.conversation_id), model: model || undefined })
    out.push({ type: 'status', message: 'Working…' })
  } else if (e.event === 'step_update') {
    const s = e.step_update ?? {}
    const idx = typeof s.step_index === 'number' ? s.step_index : -1
    const kind = String(s.step_type ?? '')
    if (kind === 'user_input') return out
    if (kind === 'agent_response') {
      if (typeof s.text_delta === 'string' && s.text_delta) {
        // A new response step after a tool gets a paragraph break, not glued text.
        const sep = st.sawText && st.textStep !== null && st.textStep !== idx ? '\n\n' : ''
        out.push({ type: 'text_delta', text: sep + s.text_delta })
        st.sawText = true
        st.textStep = idx
      }
      return out
    }
    if (!kind) return out
    const tool = String(s.tool_name ?? s.tool ?? kind)
    const failed = /ERROR|FAIL/i.test(String(s.state ?? ''))
    if (!st.openTools.has(idx) && s.state === 'ACTIVE') {
      st.openTools.add(idx)
      out.push({ type: 'tool_start', tool, input: s.input ?? s.args ?? s.command, itemId: `g${idx}` })
    } else if (s.state && s.state !== 'ACTIVE') {
      if (!st.openTools.has(idx)) out.push({ type: 'tool_start', tool, input: s.input ?? s.args ?? s.command, itemId: `g${idx}` })
      st.openTools.delete(idx)
      out.push({ type: 'tool_end', tool, isError: failed, itemId: `g${idx}` })
      const path = s.file_path ?? s.path ?? s.target_file
      if (!failed && typeof path === 'string' && FILE_TOOL.test(tool)) out.push({ type: 'file_changed', path })
    }
  } else if (e.event === 'result') {
    const r = e.result ?? {}
    if (r.status && r.status !== 'SUCCESS') out.push({ type: 'error', message: String(r.error ?? r.message ?? `Gemini finished with status ${r.status}`), fatal: true })
    // No streamed text (e.g. an older agy) → fall back to the final response.
    if (!st.sawText && typeof r.response === 'string' && r.response) { out.push({ type: 'text_delta', text: r.response }); st.sawText = true }
    // Headless agy silently refuses tools that need approval and may then return nothing.
    // Say what was blocked and how to allow it, instead of showing a blank reply.
    const denied = Array.isArray(r.denied_actions) ? r.denied_actions : []
    if (denied.length) {
      const names = [...new Set(denied.map((d: any) => String(d?.action ?? d?.display_name ?? 'a tool')))]
      const rules = names.map((n) => `\`${n}(*)\``).join(', ')
      out.push({ type: 'text_delta', text: `${st.sawText ? '\n\n' : ''}> Gemini was not allowed to use: ${names.join(', ')}. In Read-only mode agy refuses tools that need approval. Allow them in \`~/.gemini/antigravity-cli/settings.json\` under \`permissions.allow\` (e.g. ${rules}), or switch this chat to Auto.` })
      st.sawText = true
    }
    const u = r.usage ?? {}
    out.push({
      type: 'complete',
      usage: {
        // agy's input_tokens appears to be the whole prompt; split off the cached part like Codex (D-075).
        inputTokens: Math.max(0, (u.input_tokens ?? 0) - (u.cache_read_tokens ?? 0)) || undefined,
        cacheReadTokens: u.cache_read_tokens || undefined,
        outputTokens: u.output_tokens
      }
    })
  }
  return out
}

/** Permission mode → agy flags (D-079). Read-only keeps agy's default, which quietly
 *  refuses tools that need approval (edits, commands) in a headless run. Auto lets it
 *  edit, with shell commands confined by agy's OS sandbox; Full access skips all checks. */
export function geminiPermissionArgs(mode: 'read' | 'auto' | 'full'): string[] {
  if (mode === 'read') return []
  if (mode === 'full') return ['--dangerously-skip-permissions']
  return ['--dangerously-skip-permissions', '--sandbox']
}
