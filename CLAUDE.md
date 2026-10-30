# Troupe — rules for agents working in this repo

Read this before changing anything. It is short on purpose; the code comments carry the detail, and `D-nnn` / `B-nnn` references in them point at the maintainer's decision and bug logs (kept outside the repo).

## Loop
- `npm run check` (typecheck both tsconfigs, Vitest, knip) must pass before every commit. Tests sit next to their modules as `*.test.ts`; DB code runs on an in-memory SQLite with every migration (`src/main/testing/memoryDb.ts`); providers run end to end against fake CLIs on PATH.
- Every user-visible change gets one line in `CHANGELOG.md` under `[Unreleased]`, written for a user, not an engineer. `npm run dist` refuses to package while package.json and the newest CHANGELOG heading disagree.
- Do not launch the app, write to `~/.claude` / `~/.codex` / `~/.grok` / `~/.gemini`, or open a live `workbench.db` to verify work. Verify with tests; the maintainer verifies in the GUI.

## Architecture rules that are easy to break
- Troupe owns conversation continuity: its database is the record, and the transcript (or a compressed snapshot) is injected every turn. The one exception is the guarded resume for Claude (`shared/resumeGuard.ts`, `agent/runner.ts`): resume and fork the previous reply's session only when the same agent answered the message right before and nothing else changed (no other message, edit or delete; same folder, model and project context; within the cache window). Anything else, or a failed resume, runs fresh with the transcript. A provider's session is never the only copy.
- Turn sequencing and the per-conversation lock live in main (`agent/turns.ts`); the renderer mirrors state via `turns:changed` and never calls `agent.run` directly. In the app, a send to a busy chat goes to the message queue (`agent/turnQueue.ts`: each message its own turn; Stop or a failed reply pauses it). The command line, the scheduler and regenerate still get "busy".
- The primary project folder owns memory, skills, `.mcp.json`, attachments and the file browser. Additional folders are read-write access only (`--add-dir`), never second roots.
- Memory delivery: a provider loads project memory natively only when its own file is a faithful copy of the canonical `CLAUDE.md`; otherwise Troupe injects it. Never both, never neither. `AGENTS.md` is a generated mirror — edit `CLAUDE.md`.
- Memory is manual and file-based. Nothing writes it automatically.
- Headless runs cannot prompt. Permission modes pre-approve tools via `--allowedTools` (Claude) and sandbox flags (Codex); MCP server names are allow-listed as `mcp__<server>` with Claude's spelling (dots/spaces → `_`, dashes kept — both spellings are passed).
- Claude runs wait for MCP servers and use tool search (`shared/claudeConnectors.ts`), so the tool list is the same on every step and stays cached. Don't drop either: late-connecting claude.ai connectors otherwise change the list mid-message, and large ones (hundreds of tools) are sent in full on every step.
- The renderer reaches privileged work only through the typed bridge (`src/preload/index.ts`, contract in `src/shared/`). `contextIsolation`, `sandbox: true`, no `nodeIntegration`.
- Files created by agents must stay inside the project folder; links in replies are project-relative. Paths outside the allowed roots render as an "outside project" chip, never open.

## UI rules
- Components never set outer margins; the parent owns the gaps. Forms and settings are a `<Stack>` of `<Field label hint>` and `<Section title>` (`renderer/src/components/Form.tsx`). Spacing values only from `--sp-*` tokens; no `A + B { margin }` adjacency rules.
- Colours have one job each: the accent (terracotta) only for the single main action in a view and for text links; toggles, checkboxes and selected items use ink; delete-type actions use danger with an icon and the label; success stays green. Exceptions: a running chat's dot and your message bubble use the accent.
- Design tokens come from `src/renderer/src/styles/tokens.figma.json`; run `npm run tokens` to regenerate `tokens.css` / `tokens.ts`. Never edit `tokens.css` by hand.
- Helper text only where a setting needs it, one short sentence. A disabled control says why.
- Markdown: tables size columns by words (`overflow-wrap: break-word` in cells); media takes its own row; long URLs wrap.

## Conventions
- One file per IPC domain in `src/main/ipc/`, registered with `handle('ns.method', fn)`.
- Pure logic goes in `src/shared/` or a `*.ts` next to its service and gets a unit test; Electron-touching code stays thin.
- Commit messages: imperative subject, a short body saying what changed for the user and why.
