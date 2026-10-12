import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CliProcess, mediaFilesSince } from './cliProcess'
import type { AgentEvent } from '../../shared/agent'

// A fake CLI: node running an inline script. process.execPath is node under Vitest.
const node = process.execPath
const env = process.env
async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out }

describe('CliProcess.jsonl (D-096)', () => {
  it('passes stdin, maps JSON lines, skips blank and non-JSON lines', async () => {
    const script = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log('noise');console.log('');console.log(JSON.stringify({t:'text',v:s.toUpperCase()}));console.log(JSON.stringify({t:'done'}))})`
    const raw: string[] = []
    const evs = await collect(new CliProcess().jsonl({
      bin: node, args: ['-e', script], stdin: 'hello', env, onRaw: (l) => raw.push(l),
      onJson: (e, push) => { if (e.t === 'text') push({ type: 'text_delta', text: e.v }); if (e.t === 'done') push({ type: 'complete', usage: {} }) }
    }))
    expect(evs).toEqual([{ type: 'text_delta', text: 'HELLO' }, { type: 'complete', usage: {} }])
    expect(raw).toEqual(['noise', '{"t":"text","v":"HELLO"}', '{"t":"done"}'])
  })

  it('reports a non-zero exit with stderr, and a mapping throw goes to onMapError', async () => {
    const errs: unknown[] = []
    const evs = await collect(new CliProcess().jsonl({
      bin: node, args: ['-e', `console.log('{"x":1}');console.error('boom: quota');process.exit(3)`], env,
      onJson: () => { throw new Error('bad frame') }, onMapError: (e) => errs.push(e)
    }))
    expect(evs).toEqual([{ type: 'error', message: 'boom: quota', fatal: true }])
    expect(errs).toHaveLength(1)
  })

  it('lets the provider decide what an exit means', async () => {
    const evs = await collect(new CliProcess().jsonl({
      bin: node, args: ['-e', 'process.exit(0)'], env, onJson: () => {},
      onClose: (code, _err, push) => push({ type: 'status', message: `closed ${code}` })
    }))
    expect(evs).toEqual([{ type: 'status', message: 'closed 0' }])
  })

  it('a missing binary is one fatal error, not a hang', async () => {
    const evs = await collect(new CliProcess().jsonl({ bin: 'definitely-not-a-cli-xyz', args: [], env, label: 'xyz', onJson: () => {} }))
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ type: 'error', fatal: true })
    expect((evs[0] as { message: string }).message).toMatch(/^Failed to start xyz/)
  })

  it('cancel stops a running CLI; SIGKILL follows if it ignores SIGTERM', async () => {
    const p = new CliProcess()
    const t0 = Date.now()
    const run = collect(p.jsonl({ bin: node, args: ['-e', `process.on('SIGTERM',()=>{});console.log('{"a":1}');setInterval(()=>{},1000)`], env, onJson: (_e, push) => push({ type: 'status', message: 'up' }) }))
    await new Promise((r) => setTimeout(r, 300))
    expect(p.running).toBe(true)
    p.cancel()
    const evs = await run
    expect(evs[0]).toEqual({ type: 'status', message: 'up' })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(p.running).toBe(false)
  }, 10000)
})

describe('CliProcess.exec', () => {
  it('collects stdout, stderr and the exit code', async () => {
    const r = await new CliProcess().exec(node, ['-e', `process.stdout.write('out');process.stderr.write('err');process.exit(2)`], undefined, env)
    expect(r).toEqual({ code: 2, stdout: 'out', stderr: 'err' })
  })
  it('resolves with code -1 for a missing binary', async () => {
    const r = await new CliProcess().exec('definitely-not-a-cli-xyz', [], undefined, env)
    expect(r.code).toBe(-1)
  })
})

describe('mediaFilesSince', () => {
  it('finds new media, newest first, optionally one level deep', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-media-'))
    mkdirSync(join(root, 'sub'))
    const mk = (rel: string, secs: number) => { const f = join(root, rel); writeFileSync(f, 'x'); utimesSync(f, secs, secs); return f }
    const old = mk('old.png', 1000)
    const a = mk('a.png', 3000)
    const nestedF = mk('sub/b.jpg', 4000)
    mk('note.txt', 5000)
    expect(await mediaFilesSince([root], 2000 * 1000, /\.(png|jpe?g)$/i)).toEqual([a])
    expect(await mediaFilesSince([root], 2000 * 1000, /\.(png|jpe?g)$/i, true)).toEqual([nestedF, a])
    expect(await mediaFilesSince([root, join(root, 'missing')], 0, /\.png$/i)).toEqual([a, old])
  })
})
