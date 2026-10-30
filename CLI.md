# The `troupe` command

Work with Troupe from a terminal, or let a bot on your Mac (for example Grok Bot) do it: list projects, start or continue chats, see what ran, read project files, run scheduled tasks and drive Collab. The app does the work, so everything shows up live in its window.

## Turn it on

1. Open Troupe ▸ Settings ▸ Tools ▸ **Command line**.
2. Switch on **Allow command-line access** and click **Save**.
3. Click **Install** next to *troupe command*. It shows where the command went (for example `/opt/homebrew/bin/troupe`). If it says it isn't on your PATH, call it by that full path.

Troupe must be open. The command talks to it over a private socket that only your macOS user can open; there is no network port. It uses only `bash` and `curl` (both built into macOS) and writes no files.

## Commands

**Projects and chats**
```
troupe projects                          # list projects
troupe context "My project"              # a project's instructions and memory (read-only)
troupe chats "Workbench sandbox"         # a project's chats (name, part of a name, or id)
troupe show <chat> --last 5              # read the last messages
troupe search "release notes"            # search every chat
troupe rename <chat> "CLI test"          # rename a chat
troupe delete <chat>                     # delete a chat started from the command line
troupe agents                            # agents you can use, and their models
troupe version                           # Troupe's version (also --version)
```

`show` and `status` print each reply's token use after its time — `91.3k in · 87.9k cached · 381 out · $0.0524 · resumed` — and with `--json` each reply has `usage`: `input` (everything the agent read, cached or not), `cacheRead`, `cacheWrite`, `output`, `costUsd`, `mode` (`resume` = continued its own session, `shared` = sent the conversation, `fresh`) and `model`.

**Sending and runs**
```
troupe send "Workbench sandbox" "summarise PLAN.md"        # new chat → prints a run id
troupe send <chat> "now draft the plan" --agent codex      # continue a chat
troupe send "My project" "what do you see?" --attach ~/Desktop/screenshot.png
troupe send "Research" "remote work is better" --think debate
troupe status <run> --wait 600           # running / done / error / stopped, the reply, and files changed
troupe stop <run>
troupe runs --since 10:00                # what ran since 10:00, and whether it failed (also 2h, 1d, a date)
```
Send options: `--agent NAME`, `--model MODEL`, `--mode read|auto` (default `auto`), `--think debate|critique|research`, `--attach FILE` (up to 5, 20 MB each), `--wait-free SECONDS` (if the chat is busy, wait for it instead of failing), `--new` (new chat even if you gave a chat id). `@codex @claude` at the start of a message chains agents. Use `-` as the message to read it from stdin: `cat brief.md | troupe send "Workbench sandbox" -`.

`runs` options: `--since`, `--project NAME`, `--source cli|app|schedule`.

**Scheduled tasks**
```
troupe schedules                         # list them, with next and last run
troupe schedules show "Positive news"    # settings, and the prompt if bots can manage it
troupe schedules run "Positive news"     # run one now
troupe schedules pause "Positive news"   # …and resume
troupe schedules add "My project" "Morning brief" --prompt "Summarise yesterday's chats" --daily 08:30 --mode read
troupe schedules edit "Morning brief" --every 2h --prompt -   # prompt from stdin
troupe schedules delete "Morning brief"
```
`add` options: `--daily HH:MM` or `--every 30m|2h` (at most every 15 minutes), `--agent`, `--model`, `--mode read|auto`, `--same-chat` / `--new-chat`.

How bots and your tasks get along:
- A task made from the command line **starts paused** and waits for you in Troupe ▸ Tasks (**Approve and turn on** or **Discard task**). It can't run before that.
- Bots can list, run, pause and resume every task. They can **edit and delete** only tasks handed over to them: the ones they made, and any you switch on with **Bots can manage this task** in Tasks.
- A bot can never use Full access or raise a task's mode; it can lower it.
- On a handed-over **Full-access** task, a bot's edit (other than lowering the mode) or delete **waits for your approval** in Tasks, and the task is paused until you decide.
- At most 20 tasks made from the command line.

**Project files (read-only)**
```
troupe files "My project" [folder]       # list files
troupe cat "My project" docs/notes.md
```
Text files only, up to 5 MB, inside the project folder. Keys and credentials (`.env`, `*.pem`, `id_rsa`, `.ssh/` …) are never listed, shown or attached.

**Collab**
```
troupe collab start "Workbench sandbox" "Draft a project checklist"   # the Planner drafts a plan
troupe collab status <run|chat> --wait 600   # plan, task progress, and fixes when it's stuck
troupe collab approve <run>                  # run the plan        (troupe collab reject <run> to drop it)
troupe collab fix <run> <n>                  # apply the Planner's fix n
troupe collab mode <run> read|auto           # switch Read-only ⇄ Auto before approving, or while paused
troupe collab retry <run> <task n> --note "use ISO dates"   # or: skip, ask (ask the Planner)
troupe collab resume <run>     troupe collab stop <run>     troupe collab list [project]   # all projects when none is named
```

Add `--json` to any command for machine-readable output.

Exit codes: `0` ok · `1` Troupe refused (the reason is printed on stderr — `error: …`, or `{"error": …}` with `--json`) · `2` bad usage · `3` Troupe isn't reachable (not open, or command-line access is off) · `4` the chat is busy (or the Collab run isn't in a state for that).

## What it can and can't do

- **Can:** everything above — chats, runs, scheduled tasks (bots' changes follow the rules above), read-only project files, Collab.
- **Can't:** create images, change settings, edit memory, notes or skills, create or delete projects, delete chats you started in the app, or touch the database directly.
- Runs use **Read-only** or **Auto** (with the shell sandbox). **Full access is never available** from the command line.
- Messages sent this way are marked *Sent from the command line* in the chat.

## Guide to give Grok Bot

````markdown
# Working with Troupe via the `troupe` command

Troupe is my macOS app that runs AI agents (Claude, Codex, Grok…) inside project chats.
Use it only through `/opt/homebrew/bin/troupe` (Troupe must be open). Never edit Troupe's
data, settings or database directly. Run `troupe --help` for every command.

## Daily loop
- What happened: `troupe runs --since <time> --json` (state done/error/stopped, files changed).
- Ask an agent: `troupe send "<project>" "<message>" --json` → keep `run` and `chat`;
  then `troupe status <run> --wait 600` until done/error/stopped. Follow up on the same chat id.
- If a chat is busy (exit code 4), add `--wait-free 300` instead of retrying.
- Read a project file: `troupe cat "<project>" <path>`; list them: `troupe files "<project>"`.
- Pass a file: `--attach <absolute path>` (up to 5).
- Scheduled tasks: `troupe schedules`, `troupe schedules run "<task>"`. Ask me before you add, edit or delete a task;
  a task you add stays paused until I approve it in Troupe, and edits to Full-access tasks wait for me too.
- Which Troupe is running: `troupe version`.
- Clean up your test chats: `troupe delete <chat>` (only chats you started).
- Token use and cost of a reply: `usage` in `troupe status <run> --json` or `troupe show <chat> --json` — never read the database for it.

## Modes
- `--mode read` when the agent only needs to look; `--mode auto` when it should change files.
- `--think debate|critique|research` for a structured multi-agent answer.

## Collab (multi-agent runs)
- Start: `troupe collab start "<project>" "<goal>"`, then `troupe collab status <run> --wait 600`.
- ALWAYS show me the plan and ask before `troupe collab approve` — including every line under
  "Check before running" (goal conflicts, files outside the deliverables folder). Don't pick a side for me.
- When it's stuck, show me the reason and the fixes; apply one with `troupe collab fix <run> <n>`
  only after I choose — except a fix marked (recommended) that doesn't change the goal.
  A fix marked "(changes the goal — ask the user)" is always my call.
- Switching a run to Auto (`troupe collab mode <run> auto`, or the fix "Switch run to Auto, retry") lets agents change files: always ask me first.
- When it finishes or is stopped, show me the wrap-up from `troupe collab status <run>`.
- Commands answer within 90 s; if one says "Troupe didn't answer", tell me — don't retry in a loop.

## Rules
- Report the agent's actual reply and the files it changed, not just "done".
- No image creation, settings, or project creation/deletion — I do those in the app.
````
