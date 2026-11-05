// Motion runs (D-148): an agent (Claude, Codex or Grok, picked per run) writes one Lottie file into
// outputs/run-<id>/animation.json in the Motion folder. Troupe checks it loads (validateLottie);
// if not, the agent gets one repair round with the problems. "Ask for a change" is a run too: it
// edits the current animation into a new run folder, so the previous one stays for Undo.
import { promises as fsp, existsSync } from 'fs'
import { dirname, join, relative, sep } from 'path'
import type { WebContents } from 'electron'
import { getSetting } from '../database/settingsRepo'
import { createProvider } from '../providers/registry'
import { ensureInside } from '../filesystem/fsService'
import { logInfo } from '../util/logger'
import { mcpOffFor, MCP_OFF_SETTING } from '../../shared/projectMcp'
import { DISABLED_AGENTS_SETTING, enabledProviderIds, agentEntry } from '../../shared/providers'
import { IPC } from '../../shared/ipc'
import { OUTPUTS_DIR, INPUTS_DIR, SAVED_DIR, HISTORY_DIR, CANVASES_DIR, newId, isImagePath, type ImageRunDone, type ImageRunEvent } from '../../shared/imageCanvas'
import { ANIMATION_FILE, WORK_DIR, FRAMES_DIR, buildMotionPrompt, isMotionAgent, isRaster, repairPrompt, reviewPrompt, validateLottie, type MotionRunInput } from '../../shared/motion'
import { renderFrames, describeMetrics } from './motionFrames'
import { requireFolder, trackRun, untrackRun, sendToWindow } from './imageService'
import type { AgentEvent } from '../../shared/agent'

const REVIEW_ROUNDS = 2
const RUN_TIMEOUT_MS = 20 * 60 * 1000   // the agent renders and checks its own frames (D-148)
const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/')

// Folders Troupe itself writes to during a run (tabs, imports, saves, other runs): never swept.
const KEEP_TOP = new Set([INPUTS_DIR, SAVED_DIR, HISTORY_DIR, CANVASES_DIR])

/** Every file the agent could have left behind: the Motion folder minus Troupe's own folders. */
export async function strayCandidates(root: string): Promise<Set<string>> {
  const out = new Set<string>()
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 6 || out.size > 5000) return
    let ents: import('fs').Dirent[]
    try { ents = await fsp.readdir(join(root, rel), { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (!rel && KEEP_TOP.has(e.name)) continue
      if (rel === OUTPUTS_DIR && e.isDirectory() && e.name.startsWith('run-')) continue
      if (e.name === 'node_modules') continue
      if (e.isFile() && isImagePath(e.name)) continue   // an Image run's agent may be saving here — that run collects it
      if (e.isDirectory()) await walk(r, depth + 1)
      else if (e.isFile()) out.add(r)
    }
  }
  await walk('', 0)
  return out
}

/** Move files the agent wrote outside its run folder (builder scripts, preview HTML…) into the
 *  run's work/ folder, so the Motion folder stays clean and pruning the run removes them. */
export async function sweepStrays(root: string, before: Set<string>, runDir: string): Promise<string[]> {
  const moved: string[] = []
  for (const r of await strayCandidates(root)) {
    if (before.has(r)) continue
    const to = join(root, runDir, WORK_DIR, r)
    try { await fsp.mkdir(dirname(to), { recursive: true }); await fsp.rename(join(root, r), to); moved.push(r) } catch { /* leave it */ }
  }
  return moved
}

export function startMotionRun(sender: WebContents, input: MotionRunInput): string {
  const root = requireFolder()   // the Image folder: Animate cards live on the Image canvas
  if (!isMotionAgent(input.agent)) throw new Error('This agent doesn’t make animations here — pick Claude, Codex or Grok')
  if (!enabledProviderIds(getSetting(DISABLED_AGENTS_SETTING)).includes(input.agent)) throw new Error(`${agentEntry(input.agent).label} is turned off in Settings ▸ Agents.`)
  const changing = !!(input.base && input.change?.trim())
  if (!changing && !input.prompt?.trim()) throw new Error('The prompt is empty')
  const refs = (input.refs ?? []).filter((r) => typeof r === 'string').map((r) => ensureInside(root, r)).filter((p) => existsSync(p)).map((a) => toRel(root, a))
  const base = changing ? toRel(root, ensureInside(root, input.base!)) : undefined
  if (base && !existsSync(join(root, base))) throw new Error('The current animation is gone — run the Animate card again')
  const provider = createProvider(input.agent)
  if (!provider) throw new Error('Agent not available')

  const runId = newId('run-')
  const outFile = `${OUTPUTS_DIR}/${runId}/${ANIMATION_FILE}`
  const outAbs = ensureInside(root, outFile)
  const seconds = Number.isFinite(input.seconds) && input.seconds > 0 ? Math.min(60, input.seconds) : 0   // 0 = Auto
  const prompt = buildMotionPrompt({ prompt: input.prompt ?? '', refs, seconds, outFile, base, change: input.change })
  const mcpOff = mcpOffFor(getSetting(MCP_OFF_SETTING), input.agent)
  const entry = { provider, cancelled: false }
  trackRun(runId, entry)
  const ev = (label: string) => sendToWindow(sender, IPC.imageEvent, { runId, label } satisfies ImageRunEvent)
  const done = (d: Omit<ImageRunDone, 'runId'>) => { untrackRun(runId); sendToWindow(sender, IPC.imageDone, { runId, ...d } satisfies ImageRunDone) }
  const images = refs.filter(isRaster).map((r) => join(root, r))

  const pass = async (text: string, attach: string[] = images): Promise<{ reply: string; fatal: string }> => {
    let reply = '', fatal = ''
    for await (const e of provider.run({ prompt: text, context: {}, cwd: root, model: input.model || undefined, permissionMode: 'auto', mcpOff, images: attach }) as AsyncIterable<AgentEvent>) {
      if (e.type === 'text_delta') reply += e.text
      else if (e.type === 'status') ev(e.message)
      else if (e.type === 'tool_start') ev(`Running ${e.tool}…`)
      else if (e.type === 'error' && e.fatal) fatal = fatal || e.message
      if (entry.cancelled) break
    }
    return { reply, fatal }
  }

  void (async () => {
    const since = Date.now()
    let timedOut = false
    let before: Set<string> | null = null
    const timer = setTimeout(() => { timedOut = true; entry.cancelled = true; void provider.cancel() }, RUN_TIMEOUT_MS)
    logInfo('[motion] run start', { runId, agent: input.agent, model: input.model || 'default', refs: refs.length, change: changing })
    try {
      await fsp.mkdir(join(root, OUTPUTS_DIR, runId), { recursive: true })
      before = await strayCandidates(root)
      const sweep = async () => { const m = await sweepStrays(root, before!, `${OUTPUTS_DIR}/${runId}`); if (m.length) logInfo('[motion] moved strays to work/', { runId, files: m.slice(0, 10) }) }
      ev(changing ? 'Changing the animation…' : 'Starting…')
      let r = await pass(prompt)
      await sweep()
      if (entry.cancelled) { done({ files: [], error: timedOut ? 'Timed out after 20 minutes' : 'Stopped' }); return }
      const read = async () => { try { return await fsp.readFile(outAbs, 'utf8') } catch { return null } }
      let text = await read()
      let check = text === null ? null : validateLottie(text)
      if (text !== null && check && !check.ok) {
        // One repair round: the agent sees exactly what's wrong.
        logInfo('[motion] repair round', { runId, problems: check.problems.slice(0, 5) })
        ev('Fixing the animation…')
        r = await pass(repairPrompt(outFile, check.problems))
        await sweep()
        if (entry.cancelled) { done({ files: [], error: timedOut ? 'Timed out after 20 minutes' : 'Stopped' }); return }
        text = await read(); check = text === null ? null : validateLottie(text)
      }
      if (text === null || !check) {
        const said = r.reply.trim().replace(/\s+/g, ' ').slice(0, 240)
        done({ files: [], error: r.fatal || `${agentEntry(input.agent).label} finished without writing the animation.${said ? ` It said: “${said}”` : ''}` })
        return
      }
      if (!check.ok) { done({ files: [], error: `The animation didn’t pass the check: ${check.problems.slice(0, 3).join('; ')}` }); return }

      // Review pass: Troupe renders key frames with its own player and the agent looks at them.
      // A review that breaks the file is undone; a timeout during it keeps the file it started from.
      const framesDir = join(root, OUTPUTS_DIR, runId, WORK_DIR, FRAMES_DIR)
      const render = async (t: string) => { try { return await renderFrames(t, framesDir) } catch (e) { logInfo('[motion] frames failed', { runId, error: e instanceof Error ? e.message : String(e) }); return null } }
      // Up to two rounds: a second look only when the first one changed the file.
      for (let round = 1; round <= REVIEW_ROUNDS && !entry.cancelled; round++) {
        ev(round === 1 ? 'Rendering frames…' : 'Rendering the fixed frames…')
        const shots = await render(text)
        if (!shots) break
        const good: string = text
        ev(round === 1 ? 'Checking the frames…' : 'Checking the fix…')
        const checks = shots.metrics ? describeMetrics(shots.metrics, shots.probe) : []
        await pass(reviewPrompt({ outFile, sheet: toRel(root, shots.sheet), frames: shots.frames.map((f) => toRel(root, f)), brief: changing ? undefined : input.prompt, change: changing ? input.change : undefined, refs, checks }), [shots.sheet, ...images])
        await sweep()
        if (entry.cancelled && !timedOut) { done({ files: [], error: 'Stopped' }); return }
        const t2 = await read(); const c2 = t2 === null ? null : validateLottie(t2)
        if (t2 === null || !c2 || !c2.ok) { await fsp.writeFile(outAbs, good); logInfo('[motion] review broke the file — kept the reviewed one', { runId, round }); break }
        if (t2 === good) break   // "Looks right"
        text = t2; check = c2
        logInfo('[motion] review changed the animation', { runId, round })
        if (round === REVIEW_ROUNDS && !entry.cancelled) await render(t2)   // frames of the final file, for later changes
      }
      logInfo('[motion] run done', { runId, secs: Math.round((Date.now() - since) / 1000), ...check.info })
      done({ files: [outFile] })
    } catch (e) {
      done({ files: [], error: e instanceof Error ? e.message : String(e) })
    } finally {
      clearTimeout(timer)
      if (before && entry.cancelled) await sweepStrays(root, before, `${OUTPUTS_DIR}/${runId}`).catch(() => [])
    }
  })()
  return runId
}
