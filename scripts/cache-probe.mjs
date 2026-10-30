#!/usr/bin/env node
// D-146: why doesn't Troupe's context come from the prompt cache between turns?
//
//   node scripts/cache-probe.mjs diff <a.json> <b.json>
//       What changed between two saved Claude runs (flags, appended context).
//   node scripts/cache-probe.mjs probe <run.json> [--model <id>]
//       Re-runs that run's flags twice per variant (all flags, then one left out at a time)
//       with a tiny prompt, and prints what the SECOND run read from / wrote to the cache.
//       A variant whose second run still writes a lot is the one that breaks caching.
//
// Runs come from Troupe started with TROUPE_DEBUG_PROMPT=<folder> (one JSON per Claude run).
// The probe calls `claude` for real: about 12 short runs.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const [cmd, ...rest] = process.argv.slice(2)
const load = (f) => JSON.parse(readFileSync(f, 'utf8'))

/** ['--a', 'x', 'y', '--b'] → [['--a', ['x', 'y']], ['--b', []]]; '-p' is a flag too. */
function groups(args) {
  const out = []
  for (const a of args) {
    if (a.startsWith('-')) out.push([a, []])
    else if (out.length) out[out.length - 1][1].push(a)
  }
  return out
}

function firstDiff(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (i === a.length && i === b.length) return null
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 80), i + 160))
  return `differs at character ${i} of ${a.length} / ${b.length}\n  A: ${ctx(a)}\n  B: ${ctx(b)}`
}

if (cmd === 'diff') {
  const [fa, fb] = rest
  if (!fa || !fb) { console.error('usage: diff <a.json> <b.json>'); process.exit(2) }
  const a = load(fa), b = load(fb)
  const ga = new Map(groups(a.args).map(([k, v]) => [k, v.join(' ')]))
  const gb = new Map(groups(b.args).map(([k, v]) => [k, v.join(' ')]))
  let same = true
  for (const k of new Set([...ga.keys(), ...gb.keys()])) {
    if (k === '--append-system-prompt-file' || k === '--resume') continue // a temp path / not in the prompt
    if (ga.get(k) !== gb.get(k)) { same = false; console.log(`flag ${k}:\n  A: ${ga.get(k) ?? '(absent)'}\n  B: ${gb.get(k) ?? '(absent)'}`) }
  }
  if (a.cwd !== b.cwd) { same = false; console.log(`cwd: ${a.cwd} → ${b.cwd}`) }
  const d = firstDiff(a.sys ?? '', b.sys ?? '')
  if (d) { same = false; console.log(`appended context ${d}`) }
  console.log(same ? 'Flags, folder and appended context are identical.' : '')
  process.exit(0)
}

if (cmd === 'probe') {
  const file = rest[0]
  if (!file) { console.error('usage: probe <run.json> [--model <id>]'); process.exit(2) }
  const run = load(file)
  const mi = rest.indexOf('--model')
  const tmp = mkdtempSync(join(tmpdir(), 'cache-probe-'))
  const sysFile = join(tmp, 'context.md')
  writeFileSync(sysFile, run.sys ?? '', 'utf8')
  // Keep what shapes the prompt; drop output/streaming flags and resume.
  const skip = new Set(['-p', '--output-format', '--verbose', '--resume'])
  const base = groups(run.args).filter(([k]) => !skip.has(k))
    .map(([k, v]) => (k === '--append-system-prompt-file' ? [k, [sysFile]] : k === '--model' && mi > 0 ? [k, [rest[mi + 1]]] : [k, v]))
  if (mi > 0 && !base.some(([k]) => k === '--model')) base.push(['--model', [rest[mi + 1]]])
  const variants = [['all flags (as Troupe)', null], ...base.filter(([k]) => k !== '--model' && k !== '--permission-mode').map(([k]) => [`without ${k}`, k])]

  const once = (gs) => {
    const argv = ['-p', '--output-format', 'json', ...gs.flatMap(([k, v]) => [k, ...v])]
    const r = spawnSync('claude', argv, { cwd: run.cwd || process.cwd(), env: { ...process.env, ...(run.env ?? {}) }, input: 'Reply with just OK', encoding: 'utf8', maxBuffer: 1 << 26 })
    try { const u = JSON.parse(r.stdout).usage ?? {}; return { w: u.cache_creation_input_tokens ?? 0, r: u.cache_read_input_tokens ?? 0 } }
    catch { return { err: (r.stderr || r.stdout || '').trim().slice(0, 200) } }
  }
  console.log(`folder: ${run.cwd}\nsecond run of each pair (the first one warms the cache):\n`)
  for (const [label, drop] of variants) {
    const gs = base.filter(([k]) => k !== drop)
    once(gs); const s = once(gs)
    console.log(s.err ? `${label.padEnd(44)} error: ${s.err}` : `${label.padEnd(44)} cache_read ${String(s.r).padStart(7)}   cache_write ${String(s.w).padStart(7)}`)
  }
  rmSync(tmp, { recursive: true, force: true })
  console.log('\nLow cache_write on the second run = cached. If "all flags" writes a lot and one "without" line does not, that flag is the cause.')
  process.exit(0)
}

if (cmd === 'resume-probe') {
  // Which of Troupe's settings stops a RESUMED run from reusing the cached history? Each variant:
  // a fresh run, then a run resuming it (forked); prints what the resumed run wrote to the cache.
  // All variants wait for MCP servers, so the tool list itself can't change between the two runs.
  const file = rest[0]
  if (!file) { console.error('usage: resume-probe <run.json> [--model <id>]'); process.exit(2) }
  const run = load(file)
  const mi = rest.indexOf('--model')
  const model = mi > 0 ? rest[mi + 1] : (groups(run.args).find(([k]) => k === '--model')?.[1][0])
  const tmp = mkdtempSync(join(tmpdir(), 'resume-probe-'))
  const sysFile = join(tmp, 'context.md')
  writeFileSync(sysFile, run.sys ?? '', 'utf8')
  const skip = new Set(['-p', '--output-format', '--verbose', '--resume', '--model'])
  const flags = groups(run.args).filter(([k]) => !skip.has(k)).map(([k, v]) => (k === '--append-system-prompt-file' ? [k, [sysFile]] : [k, v]))
  const wait = { MCP_CONNECTION_NONBLOCKING: 'false' }
  const ts = { ENABLE_TOOL_SEARCH: 'true' }
  const variants = [
    ['plain claude', [], {}],
    ['plain + tool search', [], ts],
    ...flags.map(([k, v]) => [`plain + ${k}`, [[k, v]], {}]),
    ['all Troupe flags, no tool search', flags, {}],
    ['all Troupe flags + tool search (as Troupe)', flags, ts]
  ]
  const once = (gs, env, resumeId) => {
    const argv = ['-p', '--output-format', 'json', ...(model ? ['--model', model] : []), ...gs.flatMap(([k, v]) => [k, ...v]), ...(resumeId ? ['--resume', resumeId, '--fork-session'] : [])]
    const r = spawnSync('claude', argv, { cwd: run.cwd || process.cwd(), env: { ...process.env, ...wait, ...env }, input: resumeId ? 'Now reply with just OK again' : 'Reply with just OK', encoding: 'utf8', maxBuffer: 1 << 26 })
    try { const j = JSON.parse(r.stdout); return { id: j.session_id, w: j.usage?.cache_creation_input_tokens ?? 0, r: j.usage?.cache_read_input_tokens ?? 0 } }
    catch { return { err: (r.stderr || r.stdout || '').trim().slice(0, 160) } }
  }
  console.log('resumed run of each pair — a small cache_write means the history was reused:\n')
  for (const [label, gs, env] of variants) {
    const a = once(gs, env)
    const b = a.err ? a : once(gs, env, a.id)
    console.log(b.err ? `${label.padEnd(46)} error: ${b.err}` : `${label.padEnd(46)} cache_read ${String(b.r).padStart(7)}   cache_write ${String(b.w).padStart(7)}`)
  }
  rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
}

if (cmd === 'capture') {
  // Runs that run's flags twice through a local pass-through to the API and shows where the
  // two requests' tools + system prompt first differ — the part Claude Code changes per session.
  const file = rest[0]
  if (!file) { console.error('usage: capture <run.json> [--model <id>] [--without <flag>] [--resume [--no-fork]] [--env K=V] [--bare]'); process.exit(2) }
  const run = load(file)
  const mi = rest.indexOf('--model'), wi = rest.indexOf('--without')
  const tmp = mkdtempSync(join(tmpdir(), 'cache-capture-'))
  const sysFile = join(tmp, 'context.md')
  writeFileSync(sysFile, run.sys ?? '', 'utf8')
  const skip = new Set(['-p', '--output-format', '--verbose', '--resume', ...(wi > 0 ? [rest[wi + 1]] : [])])
  const base = groups(run.args).filter(([k]) => !skip.has(k))
    .map(([k, v]) => (k === '--append-system-prompt-file' ? [k, [sysFile]] : k === '--model' && mi > 0 ? [k, [rest[mi + 1]]] : [k, v]))
  if (mi > 0 && !base.some(([k]) => k === '--model')) base.push(['--model', [rest[mi + 1]]])

  const { createServer } = await import('http')
  const upstream = new URL(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
  const { request } = await import(upstream.protocol === 'http:' ? 'http' : 'https')
  let current = []           // request bodies of the run in progress
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      try { const j = JSON.parse(body.toString('utf8')); if (Array.isArray(j.tools) && j.system) current.push({ extra: Object.fromEntries(Object.entries(j).filter(([k]) => !['tools', 'system', 'messages'].includes(k))), tools: j.tools, system: j.system, messages: j.messages, model: j.model, url: req.url, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => /^(anthropic-|x-app|user-agent)/i.test(k) && !/key|auth/i.test(k))) }) } catch { /* not JSON */ }
      const headers = { ...req.headers, host: upstream.host }
      const up = request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443), path: req.url, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res)
      })
      up.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
      up.end(body)
    })
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const { spawn } = await import('child_process')
  const resumeMode = rest.includes('--resume')
  const envOver = Object.fromEntries(rest.flatMap((x, i) => (x === '--env' && rest[i + 1]?.includes('=') ? [[rest[i + 1].split('=')[0], rest[i + 1].split('=').slice(1).join('=')]] : [])))
  if (rest.includes('--bare')) { for (let i = base.length - 1; i >= 0; i--) if (base[i][0] !== '--model') base.splice(i, 1) }
  const once = (resumeId) => new Promise((ok) => {
    current = []
    const argv = ['-p', '--output-format', 'json', ...base.flatMap(([k, v]) => [k, ...v]), ...(resumeId ? ['--resume', resumeId, ...(rest.includes('--no-fork') ? [] : ['--fork-session'])] : [])]
    const p = spawn('claude', argv, { cwd: run.cwd || process.cwd(), env: { ...process.env, ...(rest.includes('--bare') ? {} : (run.env ?? {})), ...envOver, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } })
    const t0 = Date.now()
    let out = '', stdout = ''; p.stdout.on('data', (d) => { out += d; stdout += d }); p.stderr.on('data', (d) => { out += d })
    p.stdin.end(resumeId ? 'Now reply with just OK again' : 'Reply with just OK')
    p.on('close', () => { let j = {}; try { j = JSON.parse(stdout) } catch { /* not JSON */ } ok({ reqs: current, out, ms: Date.now() - t0, session: j.session_id, usage: j.usage }) })
  })
  const a = await once()
  const b = await once(resumeMode ? a.session : undefined)
  server.close(); rmSync(tmp, { recursive: true, force: true })
  if (!a.reqs.length || !b.reqs.length) { console.log('No API request was seen — Claude may not accept a local address here.\n' + (b.out || a.out).slice(0, 400)); process.exit(1) }
  const main = (reqs) => reqs.reduce((x, y) => (JSON.stringify(y).length > JSON.stringify(x).length ? y : x))
  const ra = main(a.reqs), rb = main(b.reqs)
  const ta = JSON.stringify(ra.tools), tb = JSON.stringify(rb.tools)
  const sa = JSON.stringify(ra.system, null, 1), sb = JSON.stringify(rb.system, null, 1)
  console.log(`tools: ${ra.tools.length} / ${rb.tools.length} — ${ta === tb ? 'identical' : 'DIFFERENT, ' + firstDiff(ta, tb)}`)
  console.log(`system prompt: ${sa === sb ? 'identical' : 'DIFFERENT, ' + firstDiff(sa, sb)}`)
  // The first user message (Claude Code's reminders + the prompt) and the request headers.
  const ma = JSON.stringify(ra.messages, null, 1), mb = JSON.stringify(rb.messages, null, 1)
  console.log(`messages: ${ma === mb ? 'identical' : 'DIFFERENT, ' + firstDiff(ma, mb)}`)
  const ha = JSON.stringify(ra.headers), hb = JSON.stringify(rb.headers)
  // Request settings besides tools/system/messages (thinking, effort, tool choice…): a change in
  // thinking settings makes the API drop the cached messages while tools and system stay cached.
  const xa = JSON.stringify(ra.extra), xb = JSON.stringify(rb.extra)
  console.log(`other request settings: ${xa === xb ? 'identical' : 'DIFFERENT'}\n  run 1: ${xa.slice(0, 600)}\n  run 2: ${xb.slice(0, 600)}`)
  console.log(`headers: ${ha === hb ? 'identical' : 'DIFFERENT, ' + firstDiff(ha, hb)}`)
  const marks = (r) => JSON.stringify([...JSON.stringify(r).matchAll(/"cache_control":\{[^}]*\}/g)].map((m) => m[0]))
  console.log(`cache marks: ${marks(ra)}`)
  // Which servers the tools came from, per run (MCP servers that connect late change the list).
  const bySource = (tools) => {
    const m = new Map()
    for (const t of tools) { const k = /^mcp__(.+?)__/.exec(t.name)?.[1] ?? 'built-in'; const c = m.get(k) ?? { n: 0, deferred: 0, chars: 0 }; c.n++; if (t.defer_loading) c.deferred++; c.chars += JSON.stringify(t).length; m.set(k, c) }
    return [...m].map(([k, c]) => `${k} ${c.n}${c.deferred ? ` (${c.deferred} deferred)` : ''} ~${Math.round(c.chars / 4 / 1000)}k tok`).join(', ')
  }
  console.log(`tools run 1: ${bySource(ra.tools)}`)
  console.log(`tools run 2: ${bySource(rb.tools)}`)
  // With tool search, connector tools aren't in the tool list; Claude Code names them in a message.
  const named = (r) => { const m = new Map(); for (const x of JSON.stringify(r.messages).matchAll(/mcp__([A-Za-z0-9_-]+?)__[A-Za-z0-9_-]+/g)) m.set(x[1], (m.get(x[1]) ?? new Set()).add(x[0])); return [...m].map(([k, v]) => `${k} ${v.size}`).join(', ') || 'none' }
  console.log(`tools named in messages, run 1: ${named(ra)}`)
  console.log(`tools named in messages, run 2: ${named(rb)}`)
  console.log(`time per run: ${(a.ms / 1000).toFixed(1)} s / ${(b.ms / 1000).toFixed(1)} s`)
  if (resumeMode) {
    // Run 2 resumed run 1 (as a fork). Is Troupe's context still in its system prompt, does its
    // first message start exactly like run 1's, and what did it read from / write to the cache?
    const tail = (run.sys ?? '').trim().slice(-200)
    console.log(`resume: session ${a.session ?? '?'} → ${b.session ?? '?'}${a.session && a.session === b.session ? ' (same id!)' : ''}`)
    console.log(`Troupe context in run 2's system prompt: ${tail ? (JSON.stringify(rb.system).includes(JSON.stringify(tail).slice(1, -1)) ? 'yes' : 'NO') : '(none in this run)'}`)
    const m1 = JSON.stringify(ra.messages[0]), m2 = JSON.stringify(rb.messages[0])
    console.log(`run 2 replays run 1's first message unchanged: ${m1 === m2 ? 'yes' : 'NO, ' + firstDiff(m1, m2)}`)
    // Where run 2's cache marks sit: per message, its role, number of blocks and which carry a mark.
    const shape = (msgs) => msgs.map((m, i) => { const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]; const marked = blocks.map((b, j) => (b.cache_control ? j : -1)).filter((j) => j >= 0); return `#${i} ${m.role} ${blocks.length} blocks${marked.length ? ` (mark on ${marked.join(',')})` : ''}` }).join(' | ')
    console.log(`run 1 messages: ${shape(ra.messages)}`)
    console.log(`run 2 messages: ${shape(rb.messages)}`)
    console.log(`system marks run 1 / 2: ${JSON.stringify(ra.system.map?.((b) => !!b.cache_control))} / ${JSON.stringify(rb.system.map?.((b) => !!b.cache_control))}`)
    console.log(`run 2 usage: cache_read ${b.usage?.cache_read_input_tokens ?? '?'}, cache_write ${b.usage?.cache_creation_input_tokens ?? '?'}`)
  }
  console.log(`requests per run: ${a.reqs.length} / ${b.reqs.length}; url ${ra.url}`)
  process.exit(0)
}

console.error('usage: node scripts/cache-probe.mjs resume-probe <run.json> [--model <id>] | diff <a.json> <b.json> | probe <run.json> [--model <id>] | capture <run.json> [--model <id>] [--without <flag>] [--resume [--no-fork]] [--env K=V] [--bare]')
process.exit(2)
