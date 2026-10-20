import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ps1FileContents, powershellArgs } from '../agents/setupRules'
import { installCommandWin, winWrapperFor, winScriptFor, WRAPPER_MARK } from '../cli/cliInstall'

describe('Windows setup and troupe.cmd (D-120)', () => {
  it('the PowerShell file quotes the PATH and shows the command first', () => {
    const f = ps1FileContents("claude auth login", "C:\\Users\\h's\\bin")
    expect(f).toContain("$env:PATH = 'C:\\Users\\h''s\\bin'")
    expect(f.split('\r\n')).toContain('claude auth login')
    expect(powershellArgs('irm https://claude.ai/install.ps1 | iex')).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'])
  })
  it('troupe.cmd hands off to troupe-run.ps1, which knows Troupe, the client, the pipe and the token file', () => {
    expect(winWrapperFor()).toContain('-File "%~dp0troupe-run.ps1" %*')
    const ps = winScriptFor("C:\\Troupe\\Troupe.exe", "C:\\Troupe's\\troupe-cli.mjs", '\\\\.\\pipe\\troupe-h', 'C:\\AppData\\cli-token')
    expect(ps).toContain("$psi.FileName = 'C:\\Troupe\\Troupe.exe'")
    expect(ps).toContain("@('C:\\Troupe''s\\troupe-cli.mjs')")
    expect(ps).toContain("['ELECTRON_RUN_AS_NODE'] = '1'")
    expect(ps).toContain(WRAPPER_MARK)
  })
  it('installs into the folder, refuses to overwrite a foreign file, reports PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-'))
    const r = installCommandWin('T.exe', 's.mjs', 'p', 't', dir, `C:\\x;${dir}\\`)
    expect(r.onPath).toBe(true)
    expect(readFileSync(join(dir, 'troupe-run.ps1'), 'utf8')).toContain('s.mjs')
    writeFileSync(r.path, 'someone else')
    expect(() => installCommandWin('T.exe', 's.mjs', 'p', 't', dir, '')).toThrow(/already exists/)
  })
})
