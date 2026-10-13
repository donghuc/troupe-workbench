import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupPlan, cleanLine, lastErrorLine, commandFileContents } from './setupRules'
import { runSetupCommand } from './setupProcess'
import { BUILTIN_RECIPES } from '../../shared/agentRecipes'

describe('agent setup rules (2.3 A2)', () => {
  it('plans each step from the bundled recipe', () => {
    expect(setupPlan(BUILTIN_RECIPES['claude-code'], 'install')).toEqual({ mode: 'run', cmd: BUILTIN_RECIPES['claude-code'].install!.cmd })
    expect(setupPlan(BUILTIN_RECIPES.gemini, 'signIn').mode).toBe('terminal')   // interactive-only
    expect(setupPlan(BUILTIN_RECIPES.grok, 'install').mode).toBe('none')       // docs link only
    expect(setupPlan({ ...BUILTIN_RECIPES.codex, install: { cmd: 'x', host: 'a.b', manualOnly: true } }, 'install').mode).toBe('terminal')
  })
  it('cleans colour codes and progress redraws', () => {
    expect(cleanLine('\u001b[32m✔ done\u001b[0m')).toBe('✔ done')
    expect(cleanLine('10%\r50%\r100%   ')).toBe('100%')
    expect(cleanLine('\u001b[2K\r')).toBe('')
  })
  it('picks the line that explains a failure', () => {
    expect(lastErrorLine(['Downloading', 'Error: permission denied', 'cleanup'])).toBe('Error: permission denied')
    expect(lastErrorLine(['one', 'two'])).toBe('two')
    expect(lastErrorLine([])).toMatch(/without saying why/)
  })
  it('writes a .command file that echoes then runs the command', () => {
    const f = commandFileContents("codex login --say 'hi'", '/bin/zsh')
    expect(f.startsWith('#!/bin/zsh -l\n')).toBe(true)
    expect(f).toContain("codex login --say 'hi'")
    expect(f).toContain(`echo '$ codex login --say '\\''hi'\\'''`)
  })
})

describe('setup process (fake installers)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'troupe-setup-'))
  const script = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p }
  const env = { PATH: `${dir}:/usr/bin:/bin` }
  it('streams lines and succeeds', async () => {
    const lines: string[] = []
    const h = runSetupCommand(script('ok.sh', 'echo one; echo two 1>&2; exit 0'), { env, timeoutMs: 5000, onLine: (l) => lines.push(l), shell: '/bin/sh' })
    expect(await h.done).toMatchObject({ ok: true, code: 0 })
    expect(lines.sort()).toEqual(['one', 'two'])
  })
  it('fails with the error line', async () => {
    const h = runSetupCommand(script('bad.sh', 'echo downloading; echo "error: no network" 1>&2; exit 3'), { env, timeoutMs: 5000, onLine: () => {}, shell: '/bin/sh' })
    expect(await h.done).toMatchObject({ ok: false, code: 3, error: 'error: no network' })
  })
  it('stops a hung step on timeout and on cancel', async () => {
    const hang = script('hang.sh', 'sleep 30')
    const t = runSetupCommand(hang, { env, timeoutMs: 300, onLine: () => {}, shell: '/bin/sh' })
    expect(await t.done).toMatchObject({ ok: false, timedOut: true })
    const c = runSetupCommand(hang, { env, timeoutMs: 5000, onLine: () => {}, shell: '/bin/sh' })
    setTimeout(() => c.cancel(), 200)
    expect(await c.done).toMatchObject({ ok: false, cancelled: true, error: 'Cancelled.' })
  }, 10000)
})
