// troupe — Windows client (D-120). Same commands, options, output and exit codes as the
// macOS bash script (resources/troupe). Run by troupe.cmd as
// `Troupe.exe troupe-cli.mjs …` with ELECTRON_RUN_AS_NODE=1; talks to the running app over
// its named pipe, with the per-launch token from the app's folder.
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const USAGE = `Usage: troupe <command> [arguments] [--json]

Projects and chats
  projects                              List projects
  context <project>                     A project's instructions and memory (read-only)
  chats <project>                       List a project's chats (name or id)
  show <chat> [--last N]                Read the last N messages (default 10)
  search "<words>"                      Search all chats
  rename <chat> "<new name>"            Rename a chat
  delete <chat>                         Delete a chat started from the command line
  agents                                Agents you can use, with their models

Sending
  send <project> <message>              Start a new chat; prints a run id
  send <chat> <message>                 Continue a chat
       --agent NAME   --model M   --mode read|auto   --think debate|critique|research
       --attach FILE (up to 5)   --wait-free SECONDS (wait if the chat is busy)   --new
       Use - as the message to read it from stdin. @codex @claude in a message chains agents.
  status <run> [--wait SECONDS]         Running, done, error or stopped — reply and files changed
  stop <run>                            Stop a running reply
  runs [--since 10:00|2h|1d] [--project P] [--source cli|app|schedule]
                                        What ran, when, and whether it failed

Scheduled tasks
  schedules                             List scheduled tasks
  schedules show <task>                 Settings and prompt (prompt only for tasks bots can manage)
  schedules run|pause|resume <task>     Run one now, pause it, or turn it back on
  schedules add <project> "<title>" --prompt "…" (--daily 08:30 | --every 2h)
       [--agent A] [--model M] [--mode read|auto] [--same-chat|--new-chat]
       New tasks wait for your approval in Troupe ▸ Tasks. Use --prompt - to read it from stdin.
  schedules edit <task> [--title …] [--prompt …] [--daily …|--every …] [--agent …] [--model …] [--mode …]
  schedules delete <task>               Only tasks bots can manage; Full-access ones wait for you

Project files (read-only)
  files <project> [folder]              List files
  cat <project> <path>                  Print a text file

Collab
  collab start <project> "<goal>" [--agent A] [--model M] [--mode read|auto]
  collab list [project]                 Collab runs (all projects when none is named)
  collab status <run|chat> [--wait SECONDS]
  collab approve <run>   collab reject <run>   collab stop <run>   collab resume <run>
  collab fix <run> <n>                  Apply the Planner's fix n
  collab mode <run> read|auto           Switch a run before approving it, or while it's paused
  collab retry|skip|ask <run> <task n> [--note "…"]

  --json   machine-readable output

Runs use Read-only or Auto (sandboxed); Full access isn't available here.
Exit codes: 0 ok · 1 refused · 2 bad usage · 3 Troupe not reachable · 4 chat busy`

const PIPE = process.env.TROUPE_PIPE || ''
const TOKEN_FILE = process.env.TROUPE_TOKEN_FILE || ''

const die = (msg) => { process.stderr.write(`troupe: ${msg}\n`); process.exit(2) }
const argv = process.argv.slice(2)
if (!argv.length) { process.stderr.write(USAGE + '\n'); process.exit(2) }
const cmd = argv.shift()
const body = new URLSearchParams()
const add = (k, v) => body.append(k, v)
const need = (n, usage) => { if (argv.length < n) die(`usage: ${usage}`) }
let stdinMsg = false

switch (cmd) {
  case '-h': case '--help': case 'help': process.stdout.write(USAGE + '\n'); process.exit(0)
  case 'projects': case 'agents': case 'runs': break
  case 'chats': case 'context': need(1, `troupe ${cmd} <project>`); add('project', argv.shift()); break
  case 'show': case 'delete': need(1, `troupe ${cmd} <chat>`); add('chat', argv.shift()); break
  case 'rename': need(2, 'troupe rename <chat> "<new name>"'); add('chat', argv.shift()); add('title', argv.shift()); break
  case 'search': need(1, 'troupe search "<words>"'); add('query', argv.shift()); break
  case 'send': {
    need(2, 'troupe send <project|chat> <message|->')
    add('to', argv.shift())
    const m = argv.shift()
    if (m === '-') stdinMsg = true; else add('message', m)
    break
  }
  case 'status': case 'stop': need(1, `troupe ${cmd} <run>`); add('run', argv.shift()); break
  case 'schedules':
    if (argv.length && !argv[0].startsWith('--')) {
      const sub = argv.shift(); add('do', sub)
      if (['run', 'show', 'pause', 'resume', 'delete', 'edit'].includes(sub)) { need(1, `troupe schedules ${sub} <task>`); add('task', argv.shift()) }
      else if (sub === 'add') { need(2, 'troupe schedules add <project> "<title>" --prompt "…" --daily 08:30'); add('project', argv.shift()); add('title', argv.shift()) }
      else if (sub !== 'list') die(`unknown schedules command: ${sub} (try: troupe --help)`)
    }
    break
  case 'files':
    need(1, 'troupe files <project> [folder]'); add('project', argv.shift())
    if (argv.length && !argv[0].startsWith('--')) add('path', argv.shift())
    break
  case 'cat': need(2, 'troupe cat <project> <path>'); add('project', argv.shift()); add('path', argv.shift()); break
  case 'collab': {
    need(1, 'troupe collab <start|list|status|approve|reject|stop|resume|fix|retry|skip|ask|mode> …')
    const sub = argv.shift(); add('do', sub)
    switch (sub) {
      case 'start': need(2, 'troupe collab start <project> "<goal>"'); add('project', argv.shift()); add('goal', argv.shift()); break
      case 'list': if (argv.length && !argv[0].startsWith('--')) add('project', argv.shift()); break
      case 'status': case 'approve': case 'reject': case 'stop': case 'resume': need(1, `troupe collab ${sub} <run>`); add('run', argv.shift()); break
      case 'fix': need(2, 'troupe collab fix <run> <n>'); add('run', argv.shift()); add('n', argv.shift()); break
      case 'mode': need(2, 'troupe collab mode <run> read|auto'); add('run', argv.shift()); add('mode', argv.shift()); break
      case 'retry': case 'skip': case 'ask': need(2, `troupe collab ${sub} <run> <task n>`); add('run', argv.shift()); add('task', argv.shift()); break
      default: die(`unknown collab command: ${sub} (try: troupe --help)`)
    }
    break
  }
  default: die(`unknown command: ${cmd} (try: troupe --help)`)
}

const VALUED = new Set(['--agent', '--model', '--mode', '--last', '--wait', '--think', '--since', '--project', '--source', '--note', '--title', '--daily', '--every'])
let stdinPrompt = false
while (argv.length) {
  const a = argv.shift()
  if (a === '--json') add('format', 'json')
  else if (a === '--new') add('new', '1')
  else if (a === '--same-chat') add('chat', 'same')
  else if (a === '--new-chat') add('chat', 'new')
  else if (a === '--prompt') { if (!argv.length) die('--prompt needs text (or - for stdin)'); const v = argv.shift(); if (v === '-') stdinPrompt = true; else add('prompt', v) }
  else if (a === '--attach') {
    if (!argv.length) die('--attach needs a file')
    const f = argv.shift()
    add('attach', isAbsolute(f) ? f : resolve(process.cwd(), f))
  } else if (a === '--wait-free') { if (!argv.length) die('--wait-free needs seconds'); add('waitfree', argv.shift()) }
  else if (VALUED.has(a)) { if (!argv.length) die(`${a} needs a value`); add(a.slice(2), argv.shift()) }
  else die(`unknown option: ${a} (try: troupe --help)`)
}

const unreachable = (msg) => { process.stderr.write(`troupe: ${msg}\n`); process.exit(3) }
async function main() {
  if (stdinMsg || stdinPrompt) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    add(stdinMsg ? 'message' : 'prompt', Buffer.concat(chunks).toString('utf8'))
  }
  let token = ''
  try { token = readFileSync(TOKEN_FILE, 'utf8').trim() } catch { /* app not open */ }
  if (!PIPE || !token) unreachable("can't reach Troupe. Open the app and turn on Settings ▸ Tools ▸ Command line.")
  const data = Buffer.from(body.toString())
  const req = request({
    socketPath: PIPE, path: `/v1/${cmd}`, method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': data.length, 'x-troupe-token': token, 'x-troupe-sent': String(Math.floor(Date.now() / 1000)) }
  }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => {
      let text = Buffer.concat(chunks).toString('utf8')
      if (text.endsWith('\n')) text = text.slice(0, -1)
      const code = res.statusCode ?? 0
      if (code >= 200 && code < 300) { process.stdout.write(text + '\n'); process.exit(0) }
      process.stderr.write(text + '\n')
      process.exit(code === 409 ? 4 : 1)
    })
  })
  req.on('error', () => unreachable("can't reach Troupe (is the app still open, with Settings ▸ Tools ▸ Command line on?)."))
  // Commands that don't wait answer at once; give up after 90 s instead of hanging (D-121).
  if (!body.has('wait') && !body.has('waitfree')) req.setTimeout(90_000, () => { req.destroy(); unreachable("Troupe didn't answer within 90 s. It may be busy; bring the app to the front and try again.") })
  req.end(data)
}
void main()
