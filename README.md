# Troupe

**Ask several AI agents, see where they agree, and keep what you decide.**

Troupe is a local-first Mac app for thinking with AI agents — Claude Code, Codex, Grok and Gemini — over your own folders. Ask one question to all of them and get a Compare card: where they agree, where they disagree, what only one of them noticed. Make them debate, critique each other or research together. Save the outcome to a decision log that every agent reads from then on. It's a thinking workspace, not a code editor: it drives the agent CLIs you already pay for, keeps everything on your Mac, and shows exactly what each agent is told.

> **Status:** macOS on Apple silicon only · single maintainer · built for one designer's daily workflow and shared as-is. Issues and PRs are welcome; response times are best-effort. Licensed under [Apache-2.0](LICENSE).

## What it does

**Think across agents**
- **`@all` + Compare.** Every ready agent answers the same prompt independently, then a Compare card summarises the verdict, the agreements, the disagreements and what only one agent raised.
- **Thinking modes.** `@debate` (for / against + a judge), `@critique` (produce → attack → respond) and `@research` (gather → check) run a fixed cast of agents through a structured exchange.
- **A decision log every agent reads.** Save a reply or a Compare card as a dated decision, insight or open question in the project's `TROUPE-DECISIONS.md`; every agent gets its index with each message, and contradictions are flagged.
- **See what each agent is told.** The Context Inspector shows the exact context each agent receives, in order and with sizes; Check context quizzes a fresh chat on what the project decided.

**Work on real files**
- **Projects are folders.** Agents read and edit the files in a project's folder (plus any additional folders you add). Memory is the folder's `CLAUDE.md`, mirrored to `AGENTS.md` and delivered to each agent the way it can load it.
- **One conversation, several agents.** `@claude` / `@codex` / `@grok` / `@gemini` route a turn; Troupe owns continuity, so agents can be switched or combined in one thread.
- **Bring any CLI agent.** Add OpenCode, Cursor CLI or any command-line agent in Settings ▸ Agents, test it, and use it alongside the others.
- **Collab mode.** A lead agent drafts a task plan; agents carry out each task with a read-only reviewer gate, budgets and retries.
- **Artifacts in place.** Markdown, HTML, images, video, audio, CSV, JSON and PDF open in the app; files outside the project offer *Copy into project*.

**Around it**
- **Image Creation** — a node canvas (Prompt · Media · Processor · Output) for making images with Codex, Grok, Gemini, or Claude drawing SVG.
- **Voice input** — dictate into the message box; Whisper runs on your Mac, models download once in Settings ▸ Tools ▸ Voice.
- **Scheduled tasks, skills, notes**, per-chat permission modes (Read-only / Auto / Full access), MCP servers and Claude in Chrome, all switched on or off in Settings.

> **Naming.** "AI Workbench" is the code name (package `ai-workbench` and the data folder `~/Library/Application Support/AI Workbench`). **Troupe** is the app's name.

## Stack

Electron (main / preload / renderer) built with electron-vite · React + TypeScript · better-sqlite3 with versioned migrations · Vitest for unit tests. Security: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`; the renderer reaches privileged work only through the typed bridge in `src/preload/index.ts`.

## Requirements

- macOS 14 or later on Apple silicon (M1 or newer). Intel builds are not produced.
- At least one agent CLI installed and signed in: [`claude`](https://docs.claude.com/en/docs/claude-code) (the primary one), and optionally [`codex`](https://github.com/openai/codex), `grok`, or Google's Antigravity `agy`. Troupe ships no model and no API keys of its own — it drives the CLIs you already pay for. Agents that aren't installed are switched off at first launch.
- To build from source: Node.js 22 and Xcode Command Line Tools (for the `better-sqlite3` native module).

## Install the app

Download the latest `Troupe-<version>-arm64.dmg` from [Releases](../../releases) and drag Troupe to Applications. The app isn't notarised (no Apple Developer ID), so the first launch is blocked once: open **System Settings ▸ Privacy & Security** and click **Open Anyway**. Step-by-step, including installing and signing in to each CLI: [INSTALL.md](INSTALL.md).

## Run from source

```bash
npm install
npm run dev        # app window with hot reload (main-process changes need a restart)
npm run check      # typecheck + unit tests + knip (unused code) — run before every commit
npm run test       # unit tests only
npm run build      # production build to out/
npm run dist       # version check + build + package (dmg/zip) into dist/
```

The app resolves your login-shell PATH, so version-manager installs of the CLIs work. Main-process changes need a dev-server restart; renderer changes hot-reload.

## Layout

```
src/
  main/       Electron main process
    agent/      run loop (runner), transcript handoff, compression
    providers/  one adapter per CLI (ClaudeCode, Codex, Grok, Gemini) over a shared runner (cliProcess.ts)
    context/    context assembly, memory delivery (pure) and memory I/O
    collab/     multi-agent orchestration + pure parsers
    schedules/  scheduler + next-run maths (pure)
    tools/      MCP registration, Codex config editing (pure)
    image/      Image Creation: canvas files, runs, saved images
    filesystem/ folder tree, watcher, wbfile:// byte ranges
    database/   better-sqlite3 + migrations (schema v23)
    ipc/        one file per IPC domain, registered with handle('ns.method', fn)
  preload/    contextBridge API, generated from the typed contract
  renderer/   React UI
  shared/     types, pure rules and the IPC contract (api.ts + contract.ts)
```

Tests sit next to their modules as `*.test.ts` (Vitest). Pure modules are tested directly; DB-backed code runs on an in-memory SQLite with every migration (`src/main/testing/memoryDb.ts`); providers run end to end against fake CLIs on PATH. Window behaviour (navigation, packaged launch) is verified in the GUI.

## What Troupe touches on your Mac

Troupe is an agent runner, so it is worth being precise about its footprint.

- **Your project folders.** Agents read and edit files in the project folder (and any additional folders you add) through their own CLIs. Every run receives a working-folder rule: save created files inside the project, don't scan the home folder.
- **The CLIs' own config.** Adding an MCP server in Settings ▸ Tools runs `claude mcp add` (writes `~/.claude.json`) and edits `~/.codex/config.toml` so both runtimes see it. Nothing else under `~/.claude`, `~/.codex`, `~/.grok` or `~/.gemini` is written.
- **Troupe's own data.** One SQLite database, attachments and a rotating log in `~/Library/Application Support/AI Workbench/`. Nothing is sent anywhere by Troupe itself; the CLIs talk to their vendors as they normally would.
- **Permission modes.** *Read-only* and *Auto* pre-approve a bounded tool set for headless runs (Auto accepts edits inside the project). *Full access* maps to `claude --permission-mode bypassPermissions` and `codex --dangerously-bypass-approvals-and-sandbox`: no sandbox, no prompts. Codex can only call MCP tools in Full access — a limitation of `codex exec`, not a choice of ours.
- **Command line (off by default).** With Settings ▸ Tools ▸ Command line on, the `troupe` command (and bots on your Mac) can list projects and chat through a private socket in the app's folder — no network port, never Full access. See [CLI.md](CLI.md).
- **Microphone (voice input).** Only while you record; audio stays on your Mac and is transcribed by whisper.cpp. The only download is the model you pick in Settings ▸ Tools ▸ Voice, from Hugging Face (`huggingface.co/ggerganov/whisper.cpp`), checked against its SHA-256 and kept in the app's folder.
- **Browser.** With the Chrome switch on, Claude runs with `--chrome` and acts in your signed-in Chrome through the Claude in Chrome extension.

## Docs and decisions

The decision log, bug log and product docs that explain *why* the app is the way it is are kept by the maintainer outside this repo; code comments reference entries as `D-nnn` (decisions) and `B-nnn` (bugs). Release notes are in [CHANGELOG.md](CHANGELOG.md). A repo-level [CLAUDE.md](CLAUDE.md) carries the standing rules for anyone working on the code with an agent.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: `npm run check` must pass, UI follows the layout primitives in `components/Form.tsx`, and behaviour changes come with a CHANGELOG line under `[Unreleased]`. Security issues: [SECURITY.md](SECURITY.md).
