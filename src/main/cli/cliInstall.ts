import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Installing the `troupe` command (D-117): a two-line wrapper in a bin folder that runs the
// script shipped inside the app, so updating Troupe updates the command too. Pure apart from
// the file system; the caller passes where the bundled script lives and the login PATH.

export const WRAPPER_MARK = '# troupe-cli-wrapper'

export function wrapperFor(script: string): string {
  return `#!/bin/bash\n${WRAPPER_MARK} — installed by Troupe (Settings ▸ Tools ▸ Command line)\nexec /bin/bash ${JSON.stringify(script)} "$@"\n`
}

const writable = (dir: string): boolean => { try { accessSync(dir, constants.W_OK); return true } catch { return false } }

/** First bin folder we may write to: Homebrew's, /usr/local/bin, else ~/.local/bin (created). */
function pickBinDir(candidates = ['/opt/homebrew/bin', '/usr/local/bin'], home = homedir()): string {
  for (const d of candidates) if (existsSync(d) && writable(d)) return d
  const local = join(home, '.local', 'bin'); mkdirSync(local, { recursive: true }); return local
}

export interface InstallResult { path: string; onPath: boolean }

export function installCommand(script: string, loginPath: string, dir = pickBinDir()): InstallResult {
  const target = join(dir, 'troupe')
  if (existsSync(target) && !readFileSync(target, 'utf8').includes(WRAPPER_MARK)) {
    throw new Error(`${target} already exists and wasn't installed by Troupe. Remove it first.`)
  }
  writeFileSync(target, wrapperFor(script), { mode: 0o755 })
  return { path: target, onPath: loginPath.split(':').includes(dir) }
}

// ── Windows (D-120) ─────────────────────────────────────────────────────────
// `troupe.cmd` in %LOCALAPPDATA%\Troupe\bin hands its arguments to `troupe-run.ps1` next to it,
// which runs the bundled Node client (troupe-cli.mjs) with Troupe's own executable acting
// as node. Troupe.exe is a GUI program, so a console can't show its output directly (CI,
// 2026-10-19: no output, no exit code); the .ps1 starts it with redirected pipes, relays
// stdin/stdout/stderr and returns its exit code. Pipe name and token file are written in.
// The folder is added to the user PATH by the caller.

const psq = (v: string) => `'${v.replace(/'/g, "''")}'`

// Arguments don't go through PowerShell's own parser: Windows PowerShell 5.1 refuses a bare
// "-" on a -File command line ("the value of argument "name" is not valid" — Zoey's Windows
// test, 2026-10-20), and `send <chat> -` is how a message comes from stdin. troupe.cmd runs a
// fixed -Command and puts the caller's arguments after a `#TROUPE#` comment; the script takes
// them, untouched, from its own command line and hands them to Troupe.exe as they were typed.
export const WIN_ARGS_MARK = '#TROUPE#'

export function winWrapperFor(): string {
  return [
    '@echo off',
    `rem ${WRAPPER_MARK} — installed by Troupe (Settings ▸ Tools ▸ Command line)`,
    'setlocal',
    'set "TROUPE_BIN=%~dp0"',
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& (Join-Path $env:TROUPE_BIN 'troupe-run.ps1'); exit $LASTEXITCODE" ${WIN_ARGS_MARK} %*`,
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}

export function winScriptFor(exe: string, script: string, pipe: string, tokenFile: string): string {
  return [
    `# ${WRAPPER_MARK} — installed by Troupe (Settings ▸ Tools ▸ Command line)`,
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    // Quote one argument the way CommandLineToArgvW reads it back.
    'function Q([string]$a) {',
    "  if ($a -eq '') { return '\"\"' }",
    "  if ($a -notmatch '[\\s\"]') { return $a }",
    "  $b = $a -replace '(\\\\*)\"', '$1$1\\\"'",
    "  $b = $b -replace '(\\\\+)$', '$1$1'",
    "  return '\"' + $b + '\"'",
    '}',
    ...WIN_SPLIT_ARGS,
    // The caller's arguments, exactly as typed, from after the marker troupe.cmd put in.
    '$cl = [Environment]::CommandLine',
    `$at = $cl.IndexOf(${psq(WIN_ARGS_MARK)})`,
    `$raw = if ($at -ge 0) { $cl.Substring($at + ${WIN_ARGS_MARK.length}).Trim() } else { '' }`,
    '$argv = Split-Args $raw',
    '$psi = New-Object System.Diagnostics.ProcessStartInfo',
    `$psi.FileName = ${psq(exe)}`,
    `$psi.Arguments = (Q ${psq(script)}) + ' ' + $raw`,
    '$psi.UseShellExecute = $false',
    '$psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true',
    '$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8',
    "$psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'",
    `$psi.EnvironmentVariables['TROUPE_PIPE'] = ${psq(pipe)}`,
    `$psi.EnvironmentVariables['TROUPE_TOKEN_FILE'] = ${psq(tokenFile)}`,
    '$p = [System.Diagnostics.Process]::Start($psi)',
    '$err = $p.StandardError.ReadToEndAsync()',
    // Read stdin only for `send … -` (message from stdin). A tool that runs troupe with stdin
    // left open would otherwise wait here forever (Grok Bot, 2026-10-19).
    "if (($argv -contains '-') -and [Console]::IsInputRedirected) { $p.StandardInput.Write([Console]::In.ReadToEnd()) }",
    '$p.StandardInput.Close()',
    '$out = $p.StandardOutput.ReadToEnd()',
    '$p.WaitForExit()',
    '[Console]::Out.Write($out)',
    '[Console]::Error.Write($err.Result)',
    'exit $p.ExitCode',
    ''
  ].join('\r\n')
}

/** Split-Args: the CommandLineToArgvW rules (backslashes before a quote, quoted spaces), in PowerShell. */
const WIN_SPLIT_ARGS = [
  'function Split-Args([string]$s) {',
  '  $out = New-Object System.Collections.Generic.List[string]',
  '  $cur = New-Object System.Text.StringBuilder; $inQ = $false; $has = $false; $i = 0',
  '  while ($i -lt $s.Length) {',
  '    $c = $s[$i]',
  "    if ($c -eq [char]92) {",
  '      $n = 0; while ($i -lt $s.Length -and $s[$i] -eq [char]92) { $n++; $i++ }',
  "      if ($i -lt $s.Length -and $s[$i] -eq [char]34) { [void]$cur.Append([string][char]92 * [math]::Floor($n / 2)); if ($n % 2) { [void]$cur.Append([char]34); $i++ } }",
  "      else { [void]$cur.Append([string][char]92 * $n) }",
  '      $has = $true; continue',
  '    }',
  '    if ($c -eq [char]34) { $inQ = -not $inQ; $has = $true; $i++; continue }',
  "    if (-not $inQ -and ($c -eq ' ' -or $c -eq [char]9)) { if ($has) { $out.Add($cur.ToString()); [void]$cur.Clear(); $has = $false }; $i++; continue }",
  '    [void]$cur.Append($c); $has = $true; $i++',
  '  }',
  '  if ($has) { $out.Add($cur.ToString()) }',
  '  return ,$out.ToArray()',
  '}'
]

export function installCommandWin(exe: string, script: string, pipe: string, tokenFile: string, dir: string, userPath: string): InstallResult {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'troupe.cmd')
  // Not troupe.ps1: PowerShell would run that directly for `troupe` (blocked where scripts are off).
  const ps1 = join(dir, 'troupe-run.ps1')
  for (const f of [target, ps1]) {
    if (existsSync(f) && !readFileSync(f, 'utf8').includes(WRAPPER_MARK)) {
      throw new Error(`${f} already exists and wasn't installed by Troupe. Remove it first.`)
    }
  }
  // The first Windows builds wrote troupe.ps1, which PowerShell picks for `troupe`; remove ours.
  const old = join(dir, 'troupe.ps1')
  try { if (existsSync(old) && readFileSync(old, 'utf8').includes(WRAPPER_MARK)) unlinkSync(old) } catch { /* leave it */ }
  writeFileSync(target, winWrapperFor())
  writeFileSync(ps1, '﻿' + winScriptFor(exe, script, pipe, tokenFile))   // BOM: Windows PowerShell reads it as UTF-8
  const norm = (d: string) => d.replace(/[\\/]+$/, '').toLowerCase()
  return { path: target, onPath: userPath.split(';').some((d) => norm(d) === norm(dir)) }
}
