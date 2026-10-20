import { describe, it, expect } from 'vitest'
import { findWinBin, shimTarget, winLaunch, cmdArgs, escapeCmdArg, envPath, type WinFs } from './winBin'
import { winExtraDirs, expandWinVars, parseRegPath, joinWinPath, withWinPath } from './winEnv'

const fakeFs = (files: Record<string, string>): WinFs => {
  const low = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]))
  return { exists: (p) => p.toLowerCase() in low, read: (p) => low[p.toLowerCase()] ?? null }
}

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`

describe('Windows binary lookup (D-120)', () => {
  const env = { Path: 'C:\\Users\\h\\.local\\bin;C:\\Users\\h\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs', PATHEXT: '.COM;.EXE;.BAT;.CMD' }

  it('reads PATH whatever its case', () => {
    expect(envPath({ Path: 'a' })).toBe('a')
    expect(envPath({ PATH: 'b' })).toBe('b')
  })

  it('finds an .exe through PATHEXT', () => {
    const fs = fakeFs({ 'C:\\Users\\h\\.local\\bin\\claude.exe': '' })
    expect(findWinBin('claude', env, fs)).toBe('C:\\Users\\h\\.local\\bin\\claude.exe')
    expect(winLaunch('claude', env, fs, 'Troupe.exe')).toEqual({ file: 'C:\\Users\\h\\.local\\bin\\claude.exe', prefix: [] })
  })

  it('returns null when missing', () => {
    expect(winLaunch('grok', env, fakeFs({}), 'Troupe.exe')).toBeNull()
  })

  it('runs an npm shim as node + script (no cmd.exe)', () => {
    const fs = fakeFs({
      'C:\\Users\\h\\AppData\\Roaming\\npm\\codex.cmd': NPM_SHIM,
      'C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': '',
      'C:\\Program Files\\nodejs\\node.exe': ''
    })
    expect(shimTarget('C:\\Users\\h\\AppData\\Roaming\\npm\\codex.cmd', NPM_SHIM)).toBe('C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js')
    expect(winLaunch('codex', env, fs, 'Troupe.exe')).toEqual({
      file: 'C:\\Program Files\\nodejs\\node.exe',
      prefix: ['C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']
    })
  })

  it('falls back to Troupe as node when node.exe is missing', () => {
    const fs = fakeFs({
      'C:\\Users\\h\\AppData\\Roaming\\npm\\codex.cmd': NPM_SHIM,
      'C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': ''
    })
    expect(winLaunch('codex', env, fs, 'Troupe.exe')).toMatchObject({ file: 'Troupe.exe', runAsNode: true })
  })

  it('runs a shim that points at an .exe directly', () => {
    const shim = '@"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n'
    const fs = fakeFs({
      'C:\\Users\\h\\AppData\\Roaming\\npm\\claude.cmd': shim,
      'C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe': ''
    })
    expect(winLaunch('claude', env, fs, 'Troupe.exe')?.file).toBe('C:\\Users\\h\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')
  })

  it('an unknown batch file goes through cmd.exe with every argument escaped', () => {
    const fs = fakeFs({ 'C:\\tools\\agent.bat': 'echo hi' })
    const l = winLaunch('agent', { Path: 'C:\\tools', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, fs, 'Troupe.exe')
    expect(l).toEqual({ file: 'C:\\Windows\\system32\\cmd.exe', prefix: [], batch: 'C:\\tools\\agent.bat' })
    const a = cmdArgs('C:\\tools\\agent.bat', ['-p', 'a & calc', '50%'])
    expect(a.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(a[3]).toBe('"C:\\tools\\agent.bat ^"-p^" ^"a^ ^&^ calc^" ^"50^%^""')
  })

  it('escapes quotes and trailing backslashes', () => {
    expect(escapeCmdArg('say "hi"', false)).toBe('^"say^ \\^"hi\\^"^"')
    expect(escapeCmdArg('C:\\dir\\', false)).toBe('^"C:\\dir\\\\^"')
  })
})

describe('Windows PATH (D-120)', () => {
  it('lists the installers\' folders', () => {
    const d = winExtraDirs({ USERPROFILE: 'C:\\Users\\h', LOCALAPPDATA: 'C:\\Users\\h\\AppData\\Local', APPDATA: 'C:\\Users\\h\\AppData\\Roaming' })
    expect(d).toContain('C:\\Users\\h\\.local\\bin')
    expect(d).toContain('C:\\Users\\h\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin')
    expect(d).toContain('C:\\Users\\h\\AppData\\Roaming\\npm')
  })
  it('parses reg query and expands %VARS%', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\x\r\n\r\n'
    expect(expandWinVars(parseRegPath(out)!, { userprofile: 'C:\\Users\\h' })).toBe('C:\\Users\\h\\.local\\bin;C:\\x')
    expect(parseRegPath('nothing')).toBeNull()
  })
  it('joins without duplicates, ignoring case and trailing slashes', () => {
    expect(joinWinPath(['C:\\a;C:\\B\\', 'c:\\b;C:\\c', null])).toBe('C:\\a;C:\\B\\;C:\\c')
  })
  it('keeps exactly one PATH key', () => {
    const e = withWinPath({ Path: 'x', PATH: 'y', Other: '1' }, 'z')
    expect(Object.keys(e).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['PATH'])
    expect(e.PATH).toBe('z'); expect(e.Other).toBe('1')
  })
})
