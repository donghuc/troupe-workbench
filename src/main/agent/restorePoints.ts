// Restore points (D-151): before a chat turn that can write files (Auto / Full), Troupe records
// the project folder in its OWN git store at <project>/.workbench/snapshots (a bare repo used with
// the project as its work tree — the project's own .git is never touched), and again when the
// turn ends. The difference is the turn's Changes card; Restore puts the files back from the
// "before" snapshot. Snapshots are root commits under refs/troupe/<ms>-<label>, pruned after
// 30 days. Without git (no Xcode command-line tools) restore points are off and say so.
import { execFile } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { whichWin } from '../platform/proc'
import { logInfo, logWarn } from '../util/logger'
import { snapshotFileLimit, parseNumstat, parseNameStatus, mergeChanges, type ChangedFile } from '../../shared/changes'

const SNAPSHOT_DIR = join('.workbench', 'snapshots')
const KEEP_MS = 30 * 24 * 3600_000
const TIMEOUT_MS = 60_000
// Never snapshot these (the project's own .gitignore also applies).
const EXCLUDE = ['/.workbench/', '.git/', 'node_modules/', '.DS_Store', '*.mp4', '*.mov', '*.m4v', '*.webm', '*.zip', '*.dmg', '*.pkg', '*.iso',
  '*.gguf', '*.safetensors', '*.onnx', '*.bin', '*.sqlite', '*.db', '*.psd', '*.sketch'].join('\n') + '\n'

let gitBin: string | null | undefined
/** The git to use, or null. On macOS /usr/bin/git is only a stub that opens an installer
 *  dialog when the command-line tools are missing, so it's used only when they're there. */
export function findGit(): string | null {
  if (gitBin !== undefined) return gitBin
  if (process.platform === 'win32') gitBin = whichWin('git', process.env)
  else if (process.platform === 'darwin') {
    const real = ['/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p))
    const clt = existsSync('/Library/Developer/CommandLineTools/usr/bin/git') || existsSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git')
    gitBin = real ?? (clt ? '/usr/bin/git' : null)
  } else gitBin = ['/usr/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p)) ?? null
  return gitBin
}

// One git operation at a time per project, so a turn's "after" can't interleave with the next "before".
const queues = new Map<string, Promise<unknown>>()
function serial<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(root) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  queues.set(root, next.catch(() => undefined))
  return next
}
const tooBig = new Set<string>()   // projects whose snapshot timed out this session

function git(root: string, args: string[], opts: { timeout?: number; maxBuffer?: number; plain?: boolean } = {}): Promise<string> {
  const bin = findGit()
  if (!bin) return Promise.reject(new Error('git is not installed'))
  const env = {
    ...process.env, ...(opts.plain ? {} : { GIT_DIR: join(root, SNAPSHOT_DIR), GIT_WORK_TREE: root }),
    GIT_AUTHOR_NAME: 'Troupe', GIT_AUTHOR_EMAIL: 'troupe@localhost', GIT_COMMITTER_NAME: 'Troupe', GIT_COMMITTER_EMAIL: 'troupe@localhost',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'
  }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd: root, env, timeout: opts.timeout ?? TIMEOUT_MS, maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout))
    })
  })
}

async function ensureStore(root: string): Promise<void> {
  const dir = join(root, SNAPSHOT_DIR)
  if (existsSync(join(dir, 'HEAD'))) return
  mkdirSync(dir, { recursive: true })
  await git(root, ['init', '--bare', '-q', dir], { plain: true })
  mkdirSync(join(dir, 'info'), { recursive: true })
  writeFileSync(join(dir, 'info', 'exclude'), EXCLUDE)
  for (const [k, v] of [['core.autocrlf', 'false'], ['core.quotepath', 'false'], ['gc.auto', '0'], ['core.bare', 'false'], ['core.logAllRefUpdates', 'false']]) await git(root, ['config', k, v])
}

/** Snapshot the project folder now. Returns the snapshot id, or null (with the reason logged). */
export function takeSnapshot(root: string, label: string): Promise<{ id: string } | { error: string }> {
  if (!findGit()) return Promise.resolve({ error: 'no-git' })
  if (tooBig.has(root)) return Promise.resolve({ error: 'too-big' })
  return serial(root, async () => {
    try {
      await ensureStore(root)
      await git(root, ['add', '-A', '--ignore-errors', '.'])
      const count = (await git(root, ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })).split('\0').filter(Boolean).length
      if (count > snapshotFileLimit) { tooBig.add(root); return { error: 'too-big' } }
      const tree = (await git(root, ['write-tree'])).trim()
      const id = (await git(root, ['commit-tree', tree, '-m', label])).trim()
      await git(root, ['update-ref', `refs/troupe/${Date.now()}-${label.replace(/[^\w.-]/g, '_')}`, id])
      return { id }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/timed out|ETIMEDOUT|killed/i.test(msg)) tooBig.add(root)
      logWarn('[restore] snapshot failed', { root, label, err: msg.slice(0, 300) })
      return { error: /timed out|killed/i.test(msg) ? 'too-big' : 'failed' }
    }
  })
}

/** What changed between two snapshots. */
export function diffSnapshots(root: string, a: string, b: string): Promise<ChangedFile[]> {
  return serial(root, async () => {
    const [num, names] = await Promise.all([
      git(root, ['diff', '--no-renames', '--numstat', '-z', a, b]),
      git(root, ['diff', '--no-renames', '--name-status', '-z', a, b])
    ])
    return mergeChanges(parseNameStatus(names), parseNumstat(num))
  })
}

/** The before/after of one file, as a unified diff (capped). */
export function fileDiff(root: string, a: string, b: string, path: string): Promise<string> {
  return serial(root, () => git(root, ['diff', '--no-renames', '--no-color', '-U3', a, b, '--', path], { maxBuffer: 2 * 1024 * 1024 }))
}

/** Put `paths` back as they are in snapshot `id`: files in it are written back, files not in it
 *  are deleted (they didn't exist then). Returns the files it couldn't restore. */
export function restorePaths(root: string, id: string, paths: string[], remove: (abs: string) => Promise<void>): Promise<string[]> {
  return serial(root, async () => {
    const inSnap = new Set((await git(root, ['ls-tree', '-r', '-z', '--name-only', id, '--', ...paths])).split('\0').filter(Boolean))
    const failed: string[] = []
    const back = paths.filter((p) => inSnap.has(p))
    if (back.length) {
      try { await git(root, ['checkout', id, '--', ...back]) } catch (e) { logWarn('[restore] checkout failed', { err: String(e).slice(0, 300) }); failed.push(...back) }
    }
    for (const p of paths.filter((x) => !inSnap.has(x))) {
      const abs = join(root, p)
      if (!existsSync(abs)) continue
      try { await remove(abs) } catch { failed.push(p) }
    }
    return failed
  })
}

let prunedAt = new Map<string, number>()
/** Drop snapshots older than 30 days (at most once a day per project). */
export function pruneSnapshots(root: string, now = Date.now()): Promise<number> {
  if (!findGit() || !existsSync(join(root, SNAPSHOT_DIR, 'HEAD'))) return Promise.resolve(0)
  if (now - (prunedAt.get(root) ?? 0) < 24 * 3600_000) return Promise.resolve(0)
  prunedAt.set(root, now)
  return serial(root, async () => {
    const refs = (await git(root, ['for-each-ref', '--format=%(refname)', 'refs/troupe/'])).split('\n').filter(Boolean)
    const old = refs.filter((r) => { const ms = Number(r.split('/').pop()!.split('-')[0]); return Number.isFinite(ms) && now - ms > KEEP_MS })
    for (const r of old) await git(root, ['update-ref', '-d', r])
    if (old.length) { await git(root, ['gc', '--prune=now', '--quiet'], { timeout: 120_000 }); logInfo('[restore] pruned', { root, n: old.length }) }
    return old.length
  })
}

/** For tests only. */
export function _resetForTests(): void { gitBin = undefined; queues.clear(); tooBig.clear(); prunedAt = new Map() }
