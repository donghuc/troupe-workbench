import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'fs'
import { shouldRotate } from './limits'
import { join } from 'path'

let logFile: string | null = null
function file(): string {
  if (!logFile) {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
  }
  return logFile
}

type Level = 'info' | 'warn' | 'error'
// Rotation (audit #10): at ~5 MB main.log becomes main.1.log (replacing the previous
// one), so the log never grows without bound. Size is checked on the first write and
// then every 200 writes, not on every line.
let writesSinceCheck = 200
function rotateIfNeeded(): void {
  if (++writesSinceCheck < 200) return
  writesSinceCheck = 0
  try {
    const f = file()
    if (shouldRotate(statSync(f).size)) renameSync(f, f.replace(/\.log$/, '.1.log'))
  } catch { /* missing file or rename failed — keep appending */ }
}

function write(level: Level, msg: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra !== undefined ? ' ' + safe(extra) : ''}\n`
  rotateIfNeeded()
  try { appendFileSync(file(), line) } catch { /* best-effort */ }
  if (level === 'error') console.error(line.trimEnd())
  else console.log(line.trimEnd())
}
function safe(v: unknown): string { try { return JSON.stringify(v) } catch { return String(v) } }

export const logInfo = (msg: string, extra?: unknown) => write('info', msg, extra)
export const logWarn = (msg: string, extra?: unknown) => write('warn', msg, extra)
export const logError = (msg: string, extra?: unknown) => write('error', msg, extra)
export function logPath(): string { return file() }
