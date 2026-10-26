# Changelog

All notable, user-facing changes to AI Workbench are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**.

Each version here matches a packaged build — the dmg is named
`AI Workbench-<version>-<arch>.dmg`, so the version in this file, in
`package.json`, and on the dmg must always agree.

> How to write an entry (keep it user-facing):
> - One `## [x.y.z] - YYYY-MM-DD` heading per released build; put the newest on top.
> - Keep an `## [Unreleased]` section at the top while working; rename it to the
>   version and add the date on the day you package the dmg.
> - Group lines under **Added**, **Changed**, **Fixed**, **Removed** (omit empty groups).
> - Write what a *user* sees ("Attach PDFs to a message"), not how it was built
>   or which file changed — the engineering log (`management/DECISIONS.md`) covers that.
> - Bumping rules: PATCH = fixes/small tweaks, MINOR = new features (backward-compatible),
>   MAJOR = breaking changes or a data format users can't roll back from.

## [2.16.1] - 2026-10-26

### Fixed
- A Collab run can no longer leave its chat locked until restart (no project folder, a missing task, or an error while handling an agent's finish — that now pauses the run with the reason).
- After Stop on an `@all` message, a stopped agent finishing late can no longer disturb the next message.
- Queued messages wait while Collab waits for you (a plan to approve, a paused run) — including messages sent after the plan is ready (**Run anyway** sends them now) — pause after a Collab Stop or failure, and no longer push out a stopped run's wrap-up.
- Image Creation: two results finishing on the same canvas (or a result and an autosave) can no longer overwrite each other.
- Checking agents no longer freezes the app for a few seconds; agents are checked at once, each with a 10 s limit.
- Faster launch: the database backup is made only before an upgrade, not every time.
- Attaching a PDF no longer freezes the app while its text is read.
- Switching or removing a voice model while a transcription runs no longer frees it mid-transcription.
- Quitting waits briefly for running agents to stop and save what they wrote.
- A queue kept across a restart stores attached files by path only, not their text.

## [2.16.0] - 2026-10-26

### Added
- Send while an agent is working: the message waits in a queue above the composer and runs as soon as the reply finishes, each as its own turn. Edit or remove any queued message. Stop or a failed reply pauses the queue until you **Resume**; a queue left at quit is kept, paused.

### Fixed
- Links to files whose names contain &, a comma, ; or # (for example "Systems & Ops.pdf") open again.

## [2.15.1] - 2026-10-26

### Added
- Pin projects: a **Pinned** section above Projects in the sidebar. Pin / Unpin from the project's ⋮ menu; drag to reorder within the section.
- **Copy project ID** and **Copy chat ID** in the sidebar ⋮ menus, to paste into an agent or the `troupe` command.

### Fixed
- An open artifact keeps its own width: widening it to read no longer leaves the chat side panel wide after you close it.
- Menus near the bottom of the window (sidebar chats and projects, message menus) open upwards instead of being cut off.

## [2.15.0] - 2026-10-26

### Added
- Bots can manage scheduled tasks through the `troupe` command: `schedules add`, `show`, `edit`, `pause`, `resume` and `delete`, next to `run`.
- A task a bot creates starts paused and waits in Tasks — **Approve and turn on** or **Discard task**.
- **Bots can manage this task** switch in Tasks: bots edit and delete only the tasks they made and the ones you hand over. Your other tasks they can only list, run, pause and resume.
- A bot never gets Full access or a higher mode for a task. On a Full-access task, its edits and deletion wait for your approval, with the change shown before → after.

### Changed
- The Tasks list updates live when a bot changes a task, and keeps a task's model when you edit it in the app.
- Database schema v25 (who made each task, whether bots may manage it, a change waiting for you). Older Troupe builds can't open the data afterwards.

## [2.14.2] - 2026-10-21

### Fixed
- The Copy button in the full-size image preview did nothing (no hover, no click): it sat over the window's title-bar drag area. Same fix for dialogs and the command palette near the top of the window.
- Copy image works for every format the app can show (WebP, GIF and others, not only PNG and JPEG) — in the image preview, the artifact viewer, Image creation cards and the Saved panel — and says so when it can't copy.

## [2.14.1] - 2026-10-21

### Changed
- Grok gets its prompt from a file instead of the command line: no length limit (Windows capped it), and the prompt no longer shows in the process list.
- Grok's ground rules (the work folder, what the permission mode allows) go into its system prompt instead of the top of your message.
- Web access off in Settings ▸ Tools now also switches off Grok's own web search.
- Settings ▸ Tools ▸ Grok shows where each MCP server comes from (Grok's config or Claude's — Grok loads both) and has one switch for them all, because Grok can't leave out a single server. Off means Grok gets no MCP tools.
- Removing an MCP server removes it from Grok's own config too, and says which agents it was removed from.

## [2.14.0] - 2026-10-21

### Added
- Image Creation: tell the agent what each reference image is for. Every image input on a Processor has a small chip — Any use, For color, For style, For subject or For composition — and the agent gets the images listed by input number with that instruction.

### Changed
- Deleting a chat also deletes the files you attached in it (Troupe's copies in the project — your originals stay). The confirmation says how many.
- Your message bubbles are light blue in every mode, with dark text, so they stay readable in dark mode.
- Google Sans is now part of the app, so it looks the same offline.
- Opening a program, script or installer from Troupe on the Mac (an `.app`, `.command`, `.pkg`, or any executable file) asks first.
- Windows: the project's `.workbench` folder is hidden in Explorer, as it is in Finder.

### Fixed
- The Collab card's task ticks no longer sit on a grey box.
- Audio files in the artifact viewer sit on a white panel, like file cards.

### Security
- A folder becomes a project folder only when you pick it in the folder dialog.
- The app is built with Electron's hardening switches on (no `NODE_OPTIONS`, no debugger flags, app code only from its own archive).

## [2.13.0] - 2026-10-21

### Changed
- The sidebar dot for a chat with unread replies is terracotta, like the dot of a chat whose agent is working.
- A tidier composer: + and the permission mode on the left, the agent & model, mic and Send on the right.
- Start a Collab run by typing `@collab` in your message (it's in the @ menu too); a chip shows it's on and ✕ turns it off. The Chat / Collab switch is gone.
- Under the composer, **Context** now shows roughly how many tokens your next message sends; click it for the details.

### Fixed
- Voice input: switching to another chat while your words are being transcribed no longer loses them — they appear in the composer when you come back (or are waiting in that chat's draft). Leaving while still recording transcribes what you said too.

### Removed
- The language chip next to the mic. The dictation language is set in Settings ▸ Tools ▸ Voice.

## [2.12.0] - 2026-10-20

### Changed
- Voice input always uses a language: the one you used last, or your system's language at first — never a guess, which turned an English sentence into Portuguese. A small EN / VI chip next to the mic switches it in one click.
- (Windows) Voice input runs on the graphics card when there is one (Vulkan, part of every NVIDIA, AMD and Intel driver), with nothing to set up; without one it uses the processor as before. Settings ▸ Tools ▸ Voice says which, and shows how long each model took on this computer ("about 4 s per 20 s of speech").
- Attachments: each chat keeps its own (in the project's `.workbench/attachments/<chat>/`), and agents are told to open only the ones their chat gives them. The message box says a dropped file is copied into the project where its agents can open it, and **Attachments in this project…** (in the + menu, or Manage next to the file) lists them by chat to show or delete. File names keep their Vietnamese letters.
- Collab in Read-only now works for goals that produce files: agents read the project but don't change it — each Maker puts its files in its reply and Troupe saves them. The plan card says what the run allows and has **Switch to Auto** / **Switch to Read-only** before you approve (`troupe collab mode <run> read|auto` from the command line).
- Collab: the Planner is told what each agent can do in this run (its mode and your Tools settings), not in general. When a task needs something no agent in the run may do — like changing files in a Read-only run — Troupe pauses with **Switch run to Auto, retry** (or the setting to turn on, or skip) instead of passing the task from agent to agent.
- Collab: Troupe writes the plan and status log itself; agents report in their reply. A read-only Collab no longer fails trying to write PLAN.md and STATUS.md.

### Fixed
- Collab: a Reviewer gets Troupe's record of the attempt — who made it and exactly which files changed in the project while it worked — so it reviews the work instead of blocking because it can't prove the history (a folder without git, "who wrote this file?").
- Collab: when a review moves to another agent, the status log and the wrap-up give the reviewer's real reason instead of always "couldn't open the files".
- `troupe collab mode` says what it did ("Switched to Auto …"), and `collab status` shows the run's mode.
- Grok could still run terminal commands in Auto and Read-only and then stopped at a permission prompt (the tool was never actually removed). Troupe now names the tools Grok may use, and the shell isn't one of them.
- `troupe runs` shows a Collab whose chat was deleted as "deleted" instead of "started".
- `troupe runs` showed a finished Collab as "started"; it now shows how the run stands (done, paused, stopped, error or running).
- (Windows) `troupe send <chat> -` (the message from stdin) failed with "the value of argument "name" is not valid". The command no longer passes its arguments through PowerShell; an installed `troupe` command updates itself when Troupe starts.

## [2.11.0] - 2026-10-20

### Added
- Voice input: click the mic in the message box (or press ⌘⇧Space, Ctrl+Shift+Space on Windows), talk, and press again to stop — your words appear in the message for you to edit before sending; Esc throws the recording away. Speech is turned into text on your computer by Whisper; nothing is sent anywhere. Download a model once in Settings ▸ Tools ▸ Voice: Fast (60 MB), Balanced (190 MB, good for English and Vietnamese) or Best (574 MB). The first time, your Mac asks to allow the microphone.
- Audio files (MP3, M4A, WAV, AAC, OGG, Opus, FLAC) play right in the chat, the artifact viewer and Browse files.

### Changed
- Image Creation stays smooth with hundreds of cards: panning, zooming and dragging no longer redraw every card, only cards near the view are drawn, and below 40% zoom cards show a light preview instead of their images.
- Image Creation shows small preview copies of images on cards and in the Saved panel (made once and cached), and loads them as they come into view. Opening an image still shows the full file.
- The pulsing dot for a chat whose agent is running is terracotta again (the open chat has no dot colour of its own).
- Your message bubbles have their light terracotta tint again.

## [2.10.0] - 2026-10-20

### Added
- (Windows) A personal Windows build: an unsigned per-user installer from the private repo's CI, with everything the Mac app has except Gemini (its CLI hangs when another app runs it on Windows). Close hides Troupe to the tray so scheduled tasks and the `troupe` command keep running; Quit is in the tray menu.
- (Windows) Agent setup installs Claude, Codex and Grok with their official PowerShell installers, and opens sign-ins in a PowerShell window.
- (Windows) The `troupe` command: Settings ▸ Tools ▸ Command line installs `troupe.cmd` and adds it to your PATH.
- Collab: every finished or stopped run ends with the Planner's short wrap-up — what was delivered, the files, decisions for you and follow-ups — in the chat and on the Done card.
- Collab: before you approve a plan, the card lists what to check — contradictions in the goal, files that would land outside the deliverables folder, two tasks writing one file, a task that doesn't wait for the file it reads, no final review.
- Collab: a failed final review now comes with fixes from the Planner (which task to redo, with the findings) instead of just pausing.
- Collab: the Planner can choose which agent reviews each task (e.g. a different agent from the Maker); you can change it in the plan before running.
- Collab: each task shows how long it took. `troupe collab list` works without a project, and `collab status` shows timings and the wrap-up.

### Changed
- Each colour has one job. Terracotta is only for the main action in a view (Send, Save, Run, Continue, Add) and for links. Toggles, checkboxes and selected items are ink; selected model chips get a neutral fill and a check. Saved and Copied are green; running and busy dots are blue.
- Delete, Remove, Clear, Reset and Stop show a trash (or matching) icon with the label in red, in menus and confirm dialogs.
- Image Creation, Notes and project lists show short dates ("Oct 8"; the year only when it isn't this year).
- Collab: the Planner, Maker and Reviewer replies show as one line each in the chat (click to read); the Done card sits after the run's last message, not above it.
- Collab: the budget is sized to the plan instead of a flat 24 agent runs, and agent time limits are shorter (a stuck Reviewer waits 15 min, not 45).
- Collab: Makers see the run's goal. If the goal itself is wrong, the Planner proposes a corrected goal and you confirm it — it's never changed without you.
- Collab: a Maker that reports done but didn't change its files fails at once, without a review run; and after one automatic fix, the same failure asks you instead of retrying.
- Collab: the wrap-up and `collab status` keep every attempt — who tried, what failed, who took over — even after a task is given to another agent. The Done card shows a plain one-line result instead of repeating the wrap-up.
- Collab: Troupe creates the deliverables folders before a Maker starts.
- The `troupe` command gives up after 90 s with a clear message instead of waiting forever (except `--wait`).
- (Windows) With "Sandbox in Auto" on, Auto doesn't run Claude's shell commands, because Claude Code has no sandbox on native Windows. Full access still can.

### Fixed
- Grok can now write files and fetch web pages in Auto and as a Collab Maker. Every tool it may use is pre-approved, and tools that would ask for permission are left out, because a background run can't answer a prompt and Grok used to stop with nothing written. In Auto it has no shell.
- When Grok does stop early, the reply says why, e.g. "Grok was blocked asking permission for `web_fetch`"; in Collab that becomes the task's finding and the Planner won't suggest a plain retry.
- Collab: Codex can read files when it reviews (read-only commands such as `cat` and `rg`). A reviewer that can't open the files no longer fails the work: the review moves to another agent.
- Collab: when a task is handed to the agent that was reviewing it, the review moves to another agent, so nobody reviews their own work.
- Collab: "No changes were written" no longer fails a Maker that rightly left a file alone after a review that couldn't be done.

## [2.9.0] - 2026-10-19

### Added
- More `troupe` commands (see CLI.md):
  - `troupe runs --since 10:00`: what ran, from where, and whether it failed. A run that failed before replying is now remembered too.
  - `troupe schedules` lists your scheduled tasks; `troupe schedules run` starts one now.
  - `troupe files` and `troupe cat` read project files. They're read-only, and keys and credentials stay hidden.
  - `send --attach` passes files with a message, up to 5.
  - `troupe status` now lists the files a run changed.
  - `troupe rename` renames a chat. `troupe delete` deletes it, but only for chats started from the command line.
  - `troupe search` searches all chats; `troupe context` shows a project's instructions and memory.
  - `send --think debate|critique|research` runs a thinking mode.
  - Collab: `troupe collab start`, `status`, `approve`, `fix`, `retry` and the rest. Nothing runs until the plan is approved.
- A busy chat now gets its own exit code (4), and `send --wait-free` waits for the chat instead of failing.

### Fixed
- `troupe` no longer prints curl's own "curl: (22) … error: 409" line when Troupe refuses a request; you get only Troupe's message, on stderr (found by Grok Bot's first test).

## [2.8.0] - 2026-10-19

### Added
- The `troupe` command: list projects, start or continue chats and get the replies from a terminal — or let a bot on your Mac, like Grok Bot, do it. Turn it on in Settings ▸ Tools ▸ Command line, then click Install. It works only while Troupe is open, only for your user, and never with Full access; image creation, settings and project setup stay in the app. See CLI.md.
- Chats started from the command line or by a scheduled task now appear in the sidebar right away.

## [2.7.0] - 2026-10-19

### Changed
- Every two- or three-way switch (theme, Chat/Collab, Preview/Edit, file sort, schedule options, the agent picker in Tools) now looks and works the same: arrow keys move the choice, and screen readers announce it as a choice group.

### Security
- In Auto, Claude's shell commands now run in a sandbox: they can change files only in the project (and its added folders), reach only package registries, GitHub and sites you list in Settings ▸ Tools, and can't read folders like `~/.ssh`. If the sandbox can't start, the run stops with the reason instead of running unprotected. Full access is unchanged; the sandbox can be switched off in Settings ▸ Tools.
- An HTML file opened in the file preview could read other files in the same project folder and send them to a website. HTML and SVG files now load under a policy that blocks reading project files from script; their images, styles and scripts still load.
- Links opened from a preview or a reply only go to web (http/https) and email addresses. Other kinds (network shares, links that launch other apps) are ignored.
- File access now follows symlinks to where they really point: a link inside a project that points outside it can no longer be read or written through.
- Deleting or editing a skill checks its name, so a malformed request can't reach outside the skills folder.
### Fixed
- When Claude stops before replying, the chat shows the reason it gave instead of "error_during_execution".

## [2.6.1] - 2026-10-15

### Changed
- Collab plan review is a short numbered list — each task shows what it produces, which agent does it and what it waits for. Open a task to edit it; the ⋮ menu on each row moves or deletes it.

### Fixed
- The confirm dialog for removing an agent (and other confirmations opened from Settings) appeared behind the Settings window. It now always opens on top.
- Clicking outside Settings (or any dialog with a form, such as Add agent) closed it and threw away what you'd entered. Dialogs now close only with Esc, ✕ or their buttons; Esc closes just the dialog on top (e.g. Add agent, not Settings behind it).

## [2.6.0] - 2026-10-14

### Added
- Fix a stuck Collab task without starting over. When a run pauses, one panel shows what's stuck and why, a recommended fix you apply with one click, and the alternatives: retry with instructions to the agent, use another agent, or skip the task.
- When a Collab task keeps failing for the same reason, Troupe stops retrying it and asks the planner for a fix. Fixes that keep your goal intact are applied automatically; anything that changes the goal, or needs you to do something first (like adding a missing file), waits for you.
- The Collab card shows how many agent runs went to retries.

### Changed
- An agent that reports it's blocked now goes straight to the planner instead of another review.
- Collab tasks that skipped or changed hands are noted in the plan and the status log, and later tasks and the final review are told about it.

### Fixed
- Review findings in the Collab status log were numbered twice ("1. 1.").

## [2.5.0] - 2026-10-14

### Added
- Browse files shows files the way the artifact viewer does: images, videos, PDFs, web pages, tables and JSON open as previews instead of raw text.
- Files Troupe can't preview (Word, PowerPoint, Keynote, design files, audio, archives…) say so, with **Show in Finder** and **Open in default app** buttons.
- Collab works with agents you added yourself (OpenCode, Cursor CLI…): Troupe gives them the files they need and saves what they write from their reply.

### Changed
- New typeface: Google Sans for the interface, Google Sans Code for code.
- Delete and remove confirmations open in Troupe's own dialog instead of a system alert; Esc cancels.
- The file tree starts with folders closed, opens the folders of the file you open, and shows "Empty folder" for folders with nothing to list.
- Collab checks that a task's files were actually written before reviewing it, and tells the planner what each agent can do (files, web, shell), so tasks go to agents that can do them.
- Badges, buttons and menus look the same everywhere; panels and the white background of artifacts were tidied up.

### Fixed
- Menus in the sidebar didn't close when you clicked outside them. Every menu now closes on a click outside, Esc, or switching windows.
- Opening an image or other binary file in Browse files showed its bytes as text.
- A Collab run could get stuck retrying a task whose agent never wrote its file; it now goes straight back to that agent with the reason and pauses with clear next steps.
- The typing cursor while an agent replies now blinks as intended.

## [2.4.1] - 2026-10-13

### Changed
- Replies from added agents (OpenCode, Cursor CLI…) now say which model answered, like Codex and Claude do; "default model" when none was picked.

### Fixed
- Sign in / Install in Terminal for OpenCode and Cursor CLI could say "command not found" even though Troupe had found the agent: the Terminal window now searches the same folders Troupe does, and Cursor signs in with whichever of its command names is installed.
- Cursor CLI showed "Found on your Mac" when it wasn't installed: another tool's `agent` command (Grok's) was taken for Cursor's. A preset now counts as found only if the command really belongs to it.
- Cursor CLI wouldn't answer ("Pass --trust…"): its ready-made command now trusts the project folder and lets Cursor make changes outside Read-only (`--trust --force`). Added agents made from a ready-made command pick up fixes like this automatically unless you've edited them.

## [2.4.0] - 2026-10-13

Add your own agents. No database change.

### Added
- **Add any command-line agent.** Settings ▸ Agents ▸ **+ Add agent**: type the command that runs one prompt (for example `opencode run {prompt}`), click **Test** — Troupe runs it once in an empty folder — and add it. It then works like the others: `@handle` mentions, `@all` and Compare, thinking modes, Collab tasks and schedules. Added agents show replies only (a **Basic** tag), can't plan or review a Collab run, and can be edited or removed (past messages keep their name).
- **Ready-made OpenCode and Cursor CLI.** If either is installed, it's one click to fill in the form; if not, Troupe can open its official installer in Terminal.

### Changed
- **Settings ▸ Agents is tidier.** One compact row per agent; open it to choose which models its picker shows, add a model in place, and (for added agents) edit the command, sign in or add an API key, or remove it. The separate "More models" box and Codex section are folded into the agents themselves.

## [2.3.0] - 2026-10-13

Set up your agents without Terminal. No database change.

### Added
- **Set up agents from inside Troupe.** The welcome and Settings ▸ Agents can install Claude, Codex and Gemini and sign you in with a button: Troupe shows the official installer command and where it downloads from, and runs it only after you confirm. Sign-ins that need a terminal open in a Terminal window, and Troupe notices when you're done. Every command is still there to copy if you prefer Terminal.

### Changed
- Codex installs with OpenAI's standalone installer; Node.js is no longer needed.

### Fixed
- **A signed-out Codex showed as Ready.** Troupe read Codex's "Not logged in" as signed in, so runs failed later instead of the agent being flagged. It now shows "not signed in" with a Sign in button.

## [2.2.1] - 2026-10-13

### Fixed
- **"Troupe is damaged and can't be opened"** when installing the dmg downloaded from GitHub. The release build is now ad-hoc signed, so macOS shows the usual first-launch prompt instead (Privacy & Security ▸ Open Anyway). Already installed 2.2.0? Run `xattr -dr com.apple.quarantine /Applications/Troupe.app`, or install 2.2.1.

## [2.2.0] - 2026-10-13

Ready for new users: a welcome that sets you up, Copy diagnostics for bug reports, and the decision log under its own name. No database change.

### Added
- **Welcome for new users.** The first launch walks through three short screens: which agents are ready (with the install or sign-in command to copy for any that aren't, and a Re-check button), your first project (a folder or scratch mode), and how permission modes work, ending with a one-click first question that runs read-only — with two or more agents it asks them all and shows a Compare card. Existing users never see it; Settings ▸ About ▸ Show welcome opens it again.

- **Copy diagnostics** in Settings ▸ About: versions, each agent's state and the recent log in one paste for a bug report. Your home folder and anything that looks like a key or token are removed first.

### Changed
- **The decision log is now `TROUPE-DECISIONS.md`.** Troupe used to write `DECISIONS.md`, which could collide with a project's own file of that name. A `DECISIONS.md` that Troupe wrote is renamed the first time the project is used; a `DECISIONS.md` of your own is left untouched and no longer read as the log.
- Agents keep build output and caches (Xcode DerivedData, Gradle or npm build folders, package caches) at the tool's default location instead of inside your project folder, where they could add gigabytes.
- Checking your agents (Settings, the welcome's Re-check) now finds a CLI you installed while Troupe was open.

## [2.1.0] - 2026-10-12

Image Creation gets multiple canvases, an Add card panel and multi-select; videos play in the file viewer.

### Added
- Image Creation: several canvases, shown as tabs in the header. Add one with +, double-click a tab to rename it, and use its ⋮ menu to rename, duplicate, clear or delete it. Images keep generating when you switch tabs and land on the right canvas.
- Image Creation: an Add card panel pinned to the top left of the canvas. Click a tile, drag it onto the canvas, or press P / M / R / O for Prompt, Media, Processor or Output.
- Image Creation: drag a saved image (or an Output image) onto a Media card to use it as a reference, or onto empty canvas to make a new Media card.
- Image Creation: select several cards and move them together. Shift-click to add or remove a card, shift-drag on empty canvas to box-select, ⌘A to select all. Delete removes every selected card.

### Changed
- Image Creation: the header now reads "Image Creation" without the folder name; the canvas tabs live there.
- Image Creation: new cards are placed in a free spot instead of on top of existing ones.

### Fixed
- MP4 and other video files play in the file viewer again, and you can seek in them. If a video's format can't play inside the app, you get a message and an "Open in default app" button.
- Image Creation: a new Processor defaults to Codex instead of Claude · SVG.
- Image Creation: deleting a version on a duplicated canvas no longer removes images the other canvas still shows.

## [2.0.0] - 2026-10-12

Faster, smaller, and ready to grow. **One-way database change (schema v23):** after 2.0
opens your data, 1.x builds can no longer open it. A backup of the old database is
written next to it first (`workbench.pre-v22.bak`, now including any unsaved changes).

### Changed
- **Streaming no longer slows the app down.** While an agent replies, Troupe used to
  redraw and re-read the entire chat many times a second, so long chats stuttered and the
  window fell behind the reply. In a 200-message chat with a long reply, the work per
  reply dropped about 10× (89 s of processing for a 20 s reply → 9 s). The reply being
  written now refreshes a few times a second instead of on every word.
- **Search is instant at any size.** Messages are indexed. Every word you type must
  appear, in any order, and accents don't matter ("viet nam" finds "Việt Nam"). Words
  match from their start; if that finds nothing, Troupe falls back to matching anywhere
  inside words (e.g. "Config" in `codexConfig`).
- **Smaller download and faster start.** The app is about a third smaller (376 → ~260 MB;
  the dmg ~50 MB lighter): it no longer carries libraries for other operating systems,
  60 interface languages it never shows, or copies of code that was already built in.
  Settings, Schedules, Image and the PDF viewer load the first time you open them.
- **Turns start just as fast in long chats.** Each message no longer re-reads the whole
  history several times.
- **Less background work on code projects.** The file watcher skips build output and
  dependency folders (dist, build, Pods, node_modules, …), like the file tree already did.

### Fixed
- **Stop really stops a stuck agent.** If an agent's command-line tool ignored the stop
  signal, it kept running; it is now force-quit after 1.5 seconds.
- **Dropping an .html file on the window** could replace Troupe's page with that file.
  The window now stays on the app, and web links open in your browser.
- **The pre-update database backup could miss your latest changes** if Troupe had last
  quit unexpectedly. It now includes them.

## [1.6.2] - 2026-10-12

MCP servers added by hand now work in Auto mode. No database change.

### Fixed
- **MCP servers with a dash in the name were always refused in Auto mode.** A server added as `market-data` (or `chrome-devtools`, `browser-cdp`) was pre-approved under the wrong spelling, so every tool call came back "you haven't granted it yet" even after signing in. Dashed names now match.
- **OAuth MCP servers showed as "failed".** A hosted server waiting for its one-time sign-in (`✗ Needs authentication`) is now shown as "sign in", with the Terminal steps under the row; the headless runs reuse the login afterwards.
- **Add MCP server said nothing when the name had a space.** The button just greyed out. It now explains that the name is an identifier and offers the dashed form in one click.

## [1.6.1] - 2026-10-08

Small fixes after 1.6.0. No database change.

### Added
- **Image: delete with the keyboard.** Select a card and press Delete (or Backspace) to remove it — cards with content still ask first. Escape deselects. Clicking a card now also leaves any text box you were typing in, so Delete and ⌘V go to the card.

### Fixed
- **Images no longer break the text flow.** A screenshot an agent mentions mid-sentence, or after "Screenshots:", used to sit inline and wrap the paragraph around a 200px thumbnail. Media now always takes its own row where the agent placed it; the text around it stays put.
- **Attachments kept when you leave a chat.** An image or file attached in the composer disappeared after switching to Image (or any other view, or another chat) and coming back. Attachments now stay with their chat like unsent text does, until you send — they don't survive quitting the app.

## [1.6.0] - 2026-10-05

New: **Image** — a canvas for making images with your agents. No database change (the Image folder is a setting; everything else lives in that folder).

### Added
- **Image** in the sidebar, below Projects: an open canvas where you place cards and connect them. **Prompt** (your description) and **Media** (reference images — drop, paste with ⌘V, or choose) feed a **Processor**, which runs one agent with the model you pick and makes up to four images; an **Output** card shows the result. Start from the one-click "Prompt → Processor → Output" template, add inputs with "+ Add input", drag from a card's dot to connect, click a line to disconnect.
- **Agents for images:** Codex and Grok generate images (Codex gets your references attached directly); Gemini is offered but untested; **Claude · SVG** draws vector illustrations instead, since it has no image model. Models come from Settings ▸ Agents.
- **Output cards** keep every version (v1, v2…), say when the inputs changed since the last run, and offer copy, open in its own window and Show in Finder. Hover an image and choose **Use as reference** to pass it on to the next Processor (image-to-image); otherwise the latest run's images go.
- **Save** (download icon) copies an image into `saved/` with a readable name (date + prompt words); **Delete version** clears a run you don't need — saved copies stay. A **Saved** panel (top-right toggle) lists everything you kept.
- **One folder holds everything:** the canvas, your references (`inputs/`), every generated image (`outputs/`), the ones you keep (`saved/`) and old canvases (`.history/`). It's chosen and changed in the new **Settings ▸ Image** tab. **Clear canvas** starts blank, keeps every image and a copy of the old canvas.
- Canvas controls: pan by dragging the background or two-finger scroll; zoom with ⌘/Ctrl + scroll, pinch, or the zoom bar at the bottom right (click the % for 100%). Click a card to select it; ⌘V pastes images into the selected Media card, or into a new one.

### Fixed
- **Narrow table columns.** Short columns in Markdown tables ("#", "Sev") wrapped to one letter per line while the wide column had room to spare, in both replies and the Markdown viewer. Columns are now sized by whole words; headers never wrap.

### Known limits
- Two runs of the **same agent at the same time** can mix up which images belong to which Output (Codex and Grok save into their own caches first). Different agents in parallel are fine.
- The Codex model list can include models your installed `codex` CLI can't run with a ChatGPT account when the Codex app is newer than the CLI — keep the CLI updated (`npm install -g @openai/codex@latest`).

## [1.5.5] - 2026-09-30

Multi-agent image hygiene. No database change.

### Fixed
- **Grok showed another agent's images.** Grok's reply picks up images that appeared in the project during its run; when Codex generated avatars in a parallel chat of the same project, Grok's reply displayed them as its own. Files written by other agents in the meantime are now left out.
- **Grok's image originals no longer clutter `generated/`.** Every `imagine` output was copied to `generated/grok-<id>-<n>.jpg`, so a multi-step icon task left twenty loose files there. Recovered originals now go to `generated/grok/`, are skipped when Grok already saved the same image into the project, and when Grok post-processed its own output (final PNGs in `icons/`), only the originals its reply links are kept.

### Changed
- **Recent artifacts** now also lists deliverable files an agent wrote (HTML, images, PDF, Markdown, Office, CSV) even when the reply didn't link them; before, an unlinked new HTML file only appeared under Working files. Reads, code and config still stay under Working files.

## [1.5.4] - 2026-09-29

Files stay where Troupe can open them, and the window gets a sidebar toggle and Back/Forward. No database change.

### Added
- **Hide/show the sidebar** (button beside the traffic lights, or ⌘\), and **Back / Forward** through everything you've opened in this window — project pages, chats, files, Notes, Memory, Tasks, Skills (⌘[ and ⌘]).
- **Files outside the project.** When a reply links a file Troupe can't open (saved outside the project folder, or reached through `../`), the link now says so and offers **Finder** or **Copy into project**, which copies it to `imported/` and opens it.

### Changed
- Every agent now gets one line of working-folder rules with each run: save screenshots and generated files inside the project folder and link them relatively; search only inside the project folder and the added folders, never the home folder, Desktop, Documents or Downloads, and never via AppleScript or other apps. This is what was producing broken screenshot links and the flood of macOS permission prompts.

### Fixed
- The sidebar remembers which projects you collapsed across restarts.

## [1.5.3] - 2026-09-28

Browsing in your own Chrome, an honest Web switch, and small UI fixes. No database change.

### Added
- **Chrome browser switch (Settings ▸ Tools).** Claude can browse in your own Chrome, signed in as you, through the Claude in Chrome extension: tabs open in your browser and stay open, so pages that need a login (Confluence, Google Docs, internal tools) just work. Off by default; not used in Read-only chats. Requires the extension and a one-time `claude --chrome` setup in Terminal. With the switch on, Claude is told which route is which: search for finding, fetch for public pages, Chrome for anything behind a login.

### Fixed
- **Web access switch now applies to Codex too.** Off used to stop only Claude's search; Codex kept searching through its own setting. Off now disables Codex's built-in web search for the run as well (Grok and Gemini are still not covered).
- Long URLs and unbroken strings no longer overflow the message bubble; they wrap inside it (user messages, replies and inline code).

### Changed
- **Chat side panel, Tools & sources:** now a two-row card in the same style as Settings — MCP servers and Built-in tools, names as the subtitle, count on the right; click a row to unfold the full list with each server's status. Long lists wrap instead of overflowing. The Browse folder button is now the same folder icon as on the project page.
- **Shorter helper text** across the project page, Settings, Collab plan and context inspector; explanations only appear where they change what you'd do.

## [1.5.2] - 2026-09-25

Small fixes and UI tidying. No database change.

### Fixed
- **First message from the project page kept only the text.** Attachments, the chosen model, the permission level and selected passages were dropped when a chat was started from the project home; they now arrive with the message, exactly as when sent inside a chat.

### Changed
- **Chat side panel:** a **Browse folder** button next to Recent artifacts opens the project's file browser (Back returns to the chat). The Tools & sources block is now two compact lines — MCP servers and built-in tools by name, status on hover — instead of a list with labels and chips.
- **Settings:** one vertical rhythm across all tabs — every tab is now built from the same Field and Section blocks, so spacing can't drift per tab. The Commands tab now lists `@debate`, `@critique`, `@research`, Compare replies and the current reply-menu actions.

## [1.5.1] - 2026-09-25

A small fix release for scheduled tasks. No database change.

### Fixed
- **Scheduled tasks run even when no Troupe window is open.** Closing the last window keeps Troupe running on your Mac; tasks fire on time and their replies are waiting in the thread when you open a window again.
- **"Same thread" tasks no longer repeat the prompt every run.** The task instruction is pinned into the thread's context (visible in the context inspector), so each run only adds a short dated marker — and editing the task's prompt applies from the next run.
- **A missed daily run now tells you.** When Troupe wasn't running at the scheduled time, you get a notification saying the run was skipped and when it runs next, instead of a silent skip.

## [1.5.0] - 2026-09-25

This release is about reading less and deciding faster: several agents answer, Troupe compares them, and what you decide is kept where every agent can see it. It adds a small database update (v22), so older versions of Troupe won't open the data afterwards.

### Added
- **Thinking modes: `@debate`, `@critique`, `@research`.** Mention one in your message (the @ menu offers them); a fixed cast of agents (set once in Settings ▸ Thinking) argues for and against with a judge, or produces → attacks → responds, or gathers sources → checks them. Every run ends with a Compare card. The rules each role follows are editable "Mode:" skills.
- **Decisions on the Project page:** a card showing the log's size and latest entry, with a **Check context** action that asks a fresh chat what the project has decided and shows what it gets wrong.
- Memory lines saved with `#` are dated, and the context inspector points out facts older than 90 days. "Add to Memory" is now "Add fact to Memory"; decisions go through Save outcome.
- **Save outcome.** On any reply (⋯ menu) or on a Compare card: the drafting agent writes a short record — decision, insight or open question, with the reason, what else was considered and what's still open — you glance, adjust if needed, and save. Records go to the project's `DECISIONS.md` (newest first), and every agent gets the log's index plus the latest three entries with each message. The editor warns when a new record contradicts project memory or an earlier entry.
- **Compare card after `@all`.** When every agent has answered, one short extra run writes a card on top: a verdict (or the angles taken, or the answer), where the agents agree, where they disagree and why, what only one of them raised, and what's still open. The full replies collapse to one line each underneath; click to expand. A **Compare replies** button does the same for turn-by-turn debates. Settings ▸ Thinking picks the agent that writes it and can turn the automatic card off.

### Fixed
- **Replies from `@all` no longer flicker or reshuffle** while agents are answering and when the last one finishes.

### Changed
- **`@all` works anywhere in a message** ("Hello @all, how are you?"), not only at the start.
- **Settings stays open after Save.** The button confirms "Saved", and Cancel becomes Close.

## [1.4.0] - 2026-09-25

### Added
- **Gemini joins as a fourth agent** (`@gemini`), through Google's Antigravity CLI (`agy`). It offers the newest Gemini Flash and Pro models.
- **One "More models" field for every agent** in Settings ▸ Agents: add any model as `agent: model-id | Label`.
- **Settings ▸ Tools:** one place to switch MCP servers and built-in tools (web access, shell commands) on or off for every project. Servers are grouped into your own servers, claude.ai connectors, and plugins, and each plugin can be switched off as a whole.
- **Codex's model list is read automatically** from Codex itself, so new models appear in the picker without typing them, and models Codex is retiring are marked in Settings ▸ Agents. The Codex field is now **More models**, for anything not on Codex's list.

### Changed
- **Each agent shows its three newest models** by default (Claude: Opus, Sonnet, Fable). Haiku and older models can be added under More models; your Codex extra models moved there automatically.
- The chat's **Tools & sources panel now only shows what's active**, with a **Manage** link to Settings ▸ Tools. MCP servers switched off in any project in 1.3.4 are now off everywhere.

### Fixed
- **Codex no longer fails to start** ("Error loading config.toml: invalid transport") when a Claude connector's name was switched off for it.
- In Read-only chats, **Gemini is told up front that it can't run commands or edit files**, so research turns don't end with an empty reply; if a tool is still refused, the reply says which one and how to allow it.

## [1.3.4] - 2026-09-24

### Added
- **Switch MCP servers off per project** (Tools & sources panel): the agent starts without them in that project, so their tools stop costing tokens on every message.
- **Cached tokens in the token line** for Codex (e.g. "23k in · 11k cached"), so you can see how much of each reply's input was reused.
- The context inspector **warns when project or global memory grows past 4 KB**, since memory is read on every message.
- **Easier first launch:** on a new install, agents whose CLI isn't installed are switched off automatically (with a note saying so), and the agent picker marks agents that are **Not installed** or **Signed out**.
- **Turn individual models on or off** in Settings ▸ Agents (e.g. hide Fable or Haiku). Hidden models leave the model pickers; a chat set to one uses the agent's default instead.
- **Redesigned Settings ▸ Agents:** each agent shows whether it's ready to use, with a switch; permissions and Codex settings are grouped with short explanations.
- **Turn agents on or off** in Settings ▸ Agents. Agents that are off disappear from the agent picker, @mentions, @all, Collab and Schedules; a message or scheduled task that names one is refused with a clear message.

### Changed
- **Large pinned files (over 8 KB) are sent as a reference** the agent opens when needed, instead of in full on every message. The inspector lists which ones.
- After a conversation has a summary, older turns since the summary are shortened more, keeping the latest two in full.

### Fixed
- **Plugin MCP servers show their real names** in Tools & sources (they all showed as "plugin"), and their tools now work in Auto mode.
- **Codex replies show which model answered** under the reply, like Claude's (Codex doesn't report it itself, so it's the model Troupe ran it with — for Default, the one set in your Codex config).
- The context inspector and message headers now say **Grok** for Grok (they showed "Claude").

## [1.3.3] - 2026-09-23

### Added
- **Search file names in Files.** Typing in the Files search box now lists matching file names first (any file type, words in any order — "design master" finds `ATLAS-DESIGN-MASTER.md`), then matches inside files.

### Changed
- **File cards show a file-type thumbnail** (Markdown, text, document, PDF, spreadsheet, data, presentation, web page, image, video).

### Fixed
- **Safer Codex settings edits.** Adding or removing an MCP server now checks that `~/.codex/config.toml` stays valid and that nothing else in it changes before saving, keeps a backup (`config.toml.bak`), and tells you if Codex couldn't be updated.
- **Large folders no longer slow the file browser.** Build output, dependency folders and app/Xcode bundles are listed but not opened (click **Show contents** to load one), and very deep or very large folders are capped.

## [1.3.2] - 2026-09-23

### Added
- **File cards in the conversation.** Files an agent links or writes in a reply, and files you attach, show as cards with a readable title and type ("Atlas design master · Document · MD"); click to open, or pop out / show in Finder. Passages you sent with a message show above it as quote cards with a little surrounding text and a source tag that opens the file.
- **Reply on selected text collects passages in a chip** above the message box, like Codex. Reply as many times as you like, across replies and files; click the chip to review or remove passages. The agent receives each passage with where it came from (file › heading or PDF page, or which agent's reply); your sent message shows what you typed, with the passages as quote cards above it. **Explain this** also says where the text came from.
- **Artifact viewer font size** in Settings ▸ Appearance (12–22 px). Applies to Markdown, text, CSV and JSON files in the viewer and in pop-out windows; pop-outs now also follow your theme.

### Fixed
- **The app cleans up after itself.** Temporary files from agent runs and PDF reading are deleted when done (and leftovers from older versions are cleared at startup), agent error output is capped, and the app log starts a new file at about 5 MB instead of growing forever.
- **File links in agent replies open again.** Links written as `file://…` (and `file.md:12`-style links) did nothing when clicked; they now open in the viewer and appear in the artifact list.

## [1.3.1] - 2026-09-23

### Fixed
- **Collab tasks assigned to Codex no longer fail at once.** A task moved to another agent used to inherit the run's model (e.g. Opus), which Codex rejects. Each agent's "Default" now means its own default model.
- **Resume retries failed tasks.** After a crash or a failed review, Resume runs the same task again, with the reviewer's findings, instead of skipping it.
- **Reviewers can check sources.** Reviewers stay read-only on your files but can now search and open web pages, so research tasks with cited links can pass review.
- **Editing a plan keeps task dependencies.** Changing a task's agent or order no longer removes which tasks it waits for, and the final review waits until all earlier work has passed.
- **Reviewers no longer report that they couldn't write the status log.** The app records their verdict itself.
- **A run with failed tasks isn't marked done.** It stays in "needs attention" so you can resume or stop it.

### Changed
- **Collab output goes to a visible folder.** What agents produce is saved in a normal project folder (e.g. `collab/2026-09-23-…`), shown in Files, instead of the hidden `.workbench` folder. The collab card links the **Plan**, the **Status log** and the **Deliverables** folder.
- **Built-in Collab skills are updated automatically** if you never edited them. Edited ones keep your changes; use **Reset to default** to get the new version.

## [1.3.0] - 2026-09-23

### Added
- **Each chat remembers its permission mode.** Read-only, Auto or Full access stays set per conversation, across switching chats and restarting the app. New chats start with the mode you picked last.
- **See which model actually answered.** The token line under a reply now shows the model the agent reported using.
- **Errors are shown instead of swallowed.** When an action fails (starting a collab on a busy chat, saving a skill, a `#` quick note to memory, removing an MCP server) a message says what went wrong, with **Copy details**. Errors are also written to the app log.

### Changed
- **Tidier artifact panel.** Files an agent linked in its reply are listed as before; files it only read or edited along the way are grouped under a collapsible **Working files** row, and files that no longer exist are hidden.
- **Full-size Dock icon on macOS 26 (Tahoe).** The icon is now built in Apple's new format so the system no longer shrinks it inside a grey tile.
- **One broken panel no longer blanks the app.** If the sidebar, a view or a dialog hits an error, only that part shows an error panel with **Try again** and **Reload window**; running agents are not affected.

### Removed
- **Claude Opus Plan preset.** It ran Sonnet in the app, because the "plan" model only switches to Opus inside Claude Code's interactive plan mode. Pick **Opus** directly.

## [1.2.0] - 2026-09-21

### Changed
- **A conversation that is already running stays running.** If you reload the window or open a second one mid-reply, the streaming reply, the activity label and any queued @mention chain are still there — the app no longer forgets an in-progress turn.
- **One turn at a time per conversation.** Sending while an agent is still working is refused with a clear message instead of starting a second, overlapping run. Scheduled tasks that come due while their thread is busy are skipped to their next slot (with a notification), and Collab holds the thread while its agents work.
- **Tighter file access.** The app only reads or writes inside folders you have connected to a project (or its own attachment store), and the interface now runs under a Content-Security-Policy.

### Fixed
- Distinct icons for **Open in new window** and **Open in Preview** on artifacts.

## [1.1.0] - 2026-09-21

### Changed
- **Updated the app's runtime** (Electron 33 → 44) for current security fixes. Also fixed the Files search box not accepting clicks, and PDF and HTML artifacts not displaying, both of which broke under the new runtime.

### Added
- **Choose more models.** Claude adds **Opus Plan** and **Fable** presets, and **Codex models are now editable** in Settings ▸ Agents (add your own model IDs, which show up in the picker under Codex). The Codex image-generation model is configurable there too.

### Fixed
- **Settings window no longer jumps in size between tabs.** It keeps a steady height, and a tab with a lot of content scrolls inside its panel.
- **Scheduled daily tasks no longer run at the wrong time after the app was closed.** If a daily task's time passed while the app was off (e.g. over a weekend), it's skipped to its next scheduled time instead of firing the moment you reopen the app — and it no longer double-runs the same day.

## [1.0.5] - 2026-09-18

### Fixed
- **Grok can show video, not just images.** When Grok generates a video (its `imagine` tool), Troupe now recovers it and plays it inline, in the lightbox, and in the artifact viewer. (Requires Grok's video setup on your side — privacy/ZDR off or a personal storage bucket.)
- **Grok replies read cleaner.** Fixed missing spaces between sentences in Grok's responses, and Grok-generated images now sit on their own line instead of being wedged into the middle of the text.
- **Grok-generated images now show up.** Grok saves images inside its own session folder and linked them with a path that didn't resolve, so they appeared broken; Workbench now recovers the image into your project and shows it inline. Any image that still can't be found renders a tidy “Image unavailable” chip instead of a broken-image icon.
- **Grok now shows why a reply failed instead of coming back blank.** When a Grok run fails — most commonly hitting the free Grok Build usage limit — you now see the actual error (with the upgrade/try-again link) instead of an empty message. (Plus behind-the-scenes diagnostics to catch this faster next time.)

## [1.0.4] - 2026-09-18

### Added
- **Copy an image to the clipboard.** Both the artifact viewer and the full-screen media lightbox now have a Copy button that puts the actual image on your clipboard (paste it into any app).

### Changed
- **The app is now called Troupe**, with a new icon and a company-neutral bundle id (`com.troupe.app`). The app, window/dock/menu name, and installer are all "Troupe". Your data carries over (the data folder is unchanged); because the bundle id changed, install Troupe and then delete the old app.
- **Artifact viewer uses a centered reading column.** Documents and text open in a comfortably-wide, centered column instead of a narrow left-aligned one, so a wide or popped-out viewer no longer leaves large empty space; wide tables still scroll within the column.
- **Collab can route tasks to Grok.** The planner may now assign work tasks to Grok (not just Claude/Codex); Grok was already selectable manually and as a run's lead agent.

## [1.0.3] - 2026-09-18

### Added
- **Grok agent.** Grok (xAI's `grok` CLI) is now selectable in the agent picker, with `@grok` mentions, `@all`, and Collab support — alongside Claude and Codex.
- **Media viewer for inline images.** Clicking an image in a reply opens it in a full-screen lightbox (Esc or click to close); a small “Open as artifact” button under each image opens it in the side artifact viewer.
- **Generated images preview inline in chat.** When an agent creates or links an image in the project folder, it shows as a clickable thumbnail in the reply instead of a plain text link.
- **Recover Codex images the CLI drops.** A known Codex CLI bug generates the image but fails to deliver it (you'd see “image generated” with no picture). Workbench now recovers it from Codex's cache and shows it inline, saved to a `generated/` folder in your project.
- **More reliable Codex image generation.** Image requests to Codex now run on an image-capable model, so they stop intermittently returning a description with no picture.
- **Codex tool failures are now visible.** A failed Codex tool call shows as a note in the reply instead of the model silently claiming success, and Codex tool activity + errors are recorded in the log.
- **Unread indicator on chats.** When an agent finishes replying in a chat you're not viewing, that chat's dot in the sidebar becomes an unread marker; opening the chat clears it.
- **Reorder your projects.** Drag a project in the sidebar to set your own order.
- **Settings ▸ About.** Shows the app version and build info, with a **Reveal logs in Finder** button for bug reports.

### Changed
- **Streaming indicator is now a scuttling spider.** While an agent is still writing, a small spider crawls at the end of the text; it disappears when the reply is done, and stays still with reduced motion.

### Fixed
- **Saving an edited scheduled task works again.** Editing a task and clicking Save no longer silently fails.
- **Tools & Sources panel follows the selected agent.** Switching the agent in the composer updates the panel's tools, MCP list, and label to that agent.
- **Codex replies no longer run sentences together.** Multi-segment Codex answers are now separated by paragraph breaks instead of being glued together.

## [1.0.2] - 2026-09-17

### Added
- **Select and copy text in PDFs.** Drag-select or double-click text on a PDF page and copy it with ⌘C; a one-click Copy grabs the current page's text. (Image-only/scanned PDFs have no selectable text.)
- **Additional folders per project.** A project keeps one primary folder as its home, and you can now add extra folders the agent may read and edit — for work that spans more than one directory.
- **Adopt AGENTS.md.** Fold an existing hand-written `AGENTS.md` into Workbench-managed memory, so Claude and Codex share the same memory instead of one agent running on a different copy.

### Changed
- **Memory now reaches both agents reliably, and the inspector tells the truth.** A project's memory (and global memory) is delivered to both Claude and Codex — loaded natively when the agent's own file already matches, and injected by Workbench otherwise, never both and never neither. Previously a project's memory could reach one agent but silently not the other.
- **The context inspector shows exactly what each agent receives** — Global and Project instructions and memory, each badged as loaded natively, injected by Workbench, or not delivered.
- **Connecting a folder migrates memory.** Adding a folder to a folderless project now moves its saved memory into the folder's `CLAUDE.md` instead of orphaning it.

### Fixed
- **PDF viewer correctness.** Pages no longer blank or half-draw when you flip quickly; open documents are released when you switch away (no pile-up on large files); zoom and page reset properly between documents; zoom continues from the fit scale instead of snapping; the page re-fits when you widen the panel; and opening/failed states are honest (a real error card with "Open in Preview"). Added a jump-to-page box.

## [1.0.1] - 2026-09-17

### Added
- **Collab mode (beta).** Describe a goal and a lead agent drafts a plan you can edit and
  reorder; on your confirm, agents carry out each task in turn, with a read-only reviewer
  checking each result against its acceptance criteria before it counts as done. You can
  assign a provider (Claude or Codex) and model per task — the planner suggests them —
  while planning and review always run on a strong model. It pauses for you if a task keeps
  failing or the run budget is reached, and keeps one run active per conversation. Requires
  a project folder.
- **Built-in collaboration & role skills** — Collaboration protocol, Planner, Maker, and
  Reviewer. Editable, each with "Reset to default".
- **Richer artifacts** — view interactive HTML, CSV as a table, JSON as a tree, and PDFs,
  all inside the app.
- **Attach PDFs and other files** to a message, including in projects without a folder.
  PDF text is read automatically so agents can use it.
- **Open any attachment in the viewer** — Markdown, text, JSON, images, and PDFs are all
  clickable.
- **Inline image thumbnails** for attachments and agent-generated screenshots.
- **Wrap toggle on message code blocks**, so long lines (like JSON) read without scrolling
  sideways.

### Changed
- Skills can be applied per role and reach any provider (Claude or Codex) the same way.
- Review steps always run read-only, regardless of the run's permission mode.

### Fixed
- The file browser no longer flattens subfolders into one list.
- PDFs no longer render blank in the viewer, and zoom now scales both axes.
- "Upload files…" now opens the picker and actually attaches the files you choose.
- Account-level MCP connectors (e.g. Figma) now work in Automatic mode, not only Full access.
- Project folders no longer collect stray MCP trace/output files.

## [1.0.0] - 2026-09-15

_First installable macOS build._

### Added
- Packaged, installable macOS app (dmg + zip).
- A local-first workbench that unifies the Claude Code and Codex agents in one place:
  projects, conversations, file-based memory, skills, scheduled tasks, an MCP/tools
  panel, a file browser with content search, and per-message permission modes.
