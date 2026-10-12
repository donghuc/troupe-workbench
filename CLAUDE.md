# Troupe — rules for agents working in this repo

Read this before changing anything. It is short on purpose; the code comments carry the detail, and `D-nnn` / `B-nnn` references in them point at the maintainer's decision and bug logs (kept outside the repo).

## Loop
- `npm run check` (typecheck both tsconfigs, Vitest, knip) must pass before every commit. Tests sit next to their modules as `*.test.ts`; DB code runs on an in-memory SQLite with every migration (`src/main/testing/memoryDb.ts`); providers run end to end against fake CLIs on PATH.
- Every user-visible change gets one line in `CHANGELOG.md` under `[Unreleased]`, written for a user, not an engineer. `npm run dist` refuses to package while package.json and the newest CHANGELOG heading disagree.
- Do not launch the app, write to `~/.claude` / `~/.codex` / `~/.grok` / `~/.gemini`, or open a live `workbench.db` to verify work. Verify with tests; the maintainer verifies in the GUI.

## Architecture rules that are easy to break
- Troupe owns conversation continuity: no provider-native resume. The transcript (or a compressed snapshot) is injected every turn. Turn sequencing and the per-conversation lock live in main (`agent/turns.ts`); the renderer mirrors state via `turns:changed` and never calls `agent.run` directly. A busy conversation refuses a second send.
- The primary project folder owns memory, skills, `.mcp.json`, attachments and the file browser. Additional folders are read-write access only (`--add-dir`), never second roots.
- Memory delivery: a provider loads project memory natively only when its own file is a faithful copy of the canonical `CLAUDE.md`; otherwise Troupe injects it. Never both, never neither. `AGENTS.md` is a generated mirror — edit `CLAUDE.md`.
- Memory is manual and file-based. Nothing writes it automatically.
- Headless runs cannot prompt. Permission modes pre-approve tools via `--allowedTools` (Claude) and sandbox flags (Codex); MCP server names are allow-listed as `mcp__<server>` with Claude's spelling (dots/spaces → `_`, dashes kept — both spellings are passed).
- The renderer reaches privileged work only through the typed bridge (`src/preload/index.ts`, contract in `src/shared/`). `contextIsolation`, `sandbox: true`, no `nodeIntegration`.
- Files created by agents must stay inside the project folder; links in replies are project-relative. Paths outside the allowed roots render as an "outside project" chip, never open.

## UI rules
- Components never set outer margins; the parent owns the gaps. Forms and settings are a `<Stack>` of `<Field label hint>` and `<Section title>` (`renderer/src/components/Form.tsx`). Spacing values only from `--sp-*` tokens; no `A + B { margin }` adjacency rules.
- Helper text only where a setting needs it, one short sentence. A disabled control says why.
- Markdown: tables size columns by words (`overflow-wrap: break-word` in cells); media takes its own row; long URLs wrap.

## Conventions
- One file per IPC domain in `src/main/ipc/`, registered with `handle('ns.method', fn)`.
- Pure logic goes in `src/shared/` or a `*.ts` next to its service and gets a unit test; Electron-touching code stays thin.
- Commit messages: imperative subject, a short body saying what changed for the user and why.
