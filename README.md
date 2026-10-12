# Troupe (code name: AI Workbench)

> **Status:** macOS on Apple silicon only · single maintainer · built for one designer's daily workflow and shared as-is. Issues and PRs are welcome; response times are best-effort. Licensed under [Apache-2.0](LICENSE).

A local-first macOS desktop app that runs several AI coding agents — **Claude Code**, **Codex**, **Grok** and **Gemini** (Antigravity `agy`) CLIs — headless against one shared conversation per project. A thinking workspace and orchestrator, not an IDE: projects map to real folders, agents read and edit those files directly, and every piece of state lives in a local SQLite database. Nothing is hosted.

> **Naming.** "AI Workbench" is the code name (package `ai-workbench`, the docs, and the data folder `~/Library/Application Support/AI Workbench`). **Troupe** is the user-facing name (icon, dock, installer) since 1.0.4.

## What it does

- **Projects = folders.** One primary folder per project (owns memory, skills, MCP config, the file browser) plus optional additional folders the agents may read and edit (`--add-dir`).
- **One conversation, several agents.** `@claude` / `@codex` / `@grok` / `@gemini` route a turn; `@all` runs every agent on the same prompt independently and ends with a Compare card; `@debate` / `@critique` / `@research` run a fixed cast of agents through a thinking mode. Outcomes are saved to the project's `DECISIONS.md` and sent to every agent. Workbench owns continuity: no provider-native resume — the transcript (or a compressed snapshot) is injected every turn.
- **Memory that both CLIs load natively.** Project memory is the folder's `CLAUDE.md`, mirrored to `AGENTS.md`; a provider loads it natively only when its file is a faithful copy, otherwise Workbench injects it. The Context Inspector shows exactly what each provider receives.
- **Collab mode.** Planner → Maker → Reviewer loops over a task list with budgets, retries and a human confirmation step.
- **Image Creation.** A node canvas (Prompt · Media · Processor · Output cards) for making images with the same agents — Codex, Grok, Gemini, or Claude drawing SVG. Several canvases as tabs; everything lives in one folder chosen in Settings ▸ Image.
- **Scheduled tasks, skills, notes, artifacts** (Markdown, HTML, images, video, CSV, JSON, PDF viewer), per-thread permission modes (Read-only / Auto / Full).
- **Tools.** MCP servers and built-in tools are switched on or off globally in Settings ▸ Tools; Claude can browse in your own Chrome through the Claude in Chrome extension.

## Stack

Electron (main / preload / renderer) built with electron-vite · React + TypeScript · better-sqlite3 with versioned migrations · Vitest for unit tests. Security: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`; the renderer reaches privileged work only through the typed bridge in `src/preload/index.ts`.

## Requirements

- macOS 14 or later on Apple silicon (M1 or newer). Intel builds are not produced.
- At least one agent CLI installed and signed in: [`claude`](https://docs.claude.com/en/docs/claude-code) (the primary one), and optionally [`codex`](https://github.com/openai/codex), `grok`, or Google's Antigravity `agy`. Troupe ships no model and no API keys of its own — it drives the CLIs you already pay for. Agents that aren't installed are switched off at first launch.
- To build from source: Node.js 22 and Xcode Command Line Tools (for the `better-sqlite3` native module).

## Install the app

Download the latest `Troupe-<version>-arm64.dmg` from [Releases](../../releases), drag Troupe to Applications, then on first launch use **right-click ▸ Open** (or Privacy & Security ▸ *Open Anyway*). The build is not notarised, so Gatekeeper shows a warning once. Step-by-step, including installing and signing in to each CLI: [INSTALL.md](INSTALL.md).

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
- **Browser.** With the Chrome switch on, Claude runs with `--chrome` and acts in your signed-in Chrome through the Claude in Chrome extension.

## Docs and decisions

The decision log, bug log and product docs that explain *why* the app is the way it is are kept by the maintainer outside this repo; code comments reference entries as `D-nnn` (decisions) and `B-nnn` (bugs). Release notes are in [CHANGELOG.md](CHANGELOG.md). A repo-level [CLAUDE.md](CLAUDE.md) carries the standing rules for anyone working on the code with an agent.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: `npm run check` must pass, UI follows the layout primitives in `components/Form.tsx`, and behaviour changes come with a CHANGELOG line under `[Unreleased]`. Security issues: [SECURITY.md](SECURITY.md).
