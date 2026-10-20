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
troupe context "Personal finance"        # a project's instructions and memory (read-only)
troupe chats "Workbench sandbox"         # a project's chats (name, part of a name, or id)
troupe show <chat> --last 5              # read the last messages
troupe search "rebalance"                # search every chat
troupe rename <chat> "CLI test"          # rename a chat
troupe delete <chat>                     # delete a chat started from the command line
troupe agents                            # agents you can use, and their models
```

**Sending and runs**
```
troupe send "Workbench sandbox" "summarise PLAN.md"        # new chat → prints a run id
troupe send <chat> "now draft the plan" --agent codex      # continue a chat
troupe send "Personal finance" "what do you see?" --attach ~/Desktop/ssi.png
troupe send "Idea Research" "remote work is better" --think debate
troupe status <run> --wait 600           # running / done / error / stopped, the reply, and files changed
troupe stop <run>
troupe runs --since 10:00                # what ran since 10:00, and whether it failed (also 2h, 1d, a date)
```
Send options: `--agent NAME`, `--model MODEL`, `--mode read|auto` (default `auto`), `--think debate|critique|research`, `--attach FILE` (up to 5, 20 MB each), `--wait-free SECONDS` (if the chat is busy, wait for it instead of failing), `--new` (new chat even if you gave a chat id). `@codex @claude` at the start of a message chains agents. Use `-` as the message to read it from stdin: `cat brief.md | troupe send "Workbench sandbox" -`.

`runs` options: `--since`, `--project NAME`, `--source cli|app|schedule`.

**Scheduled tasks**
```
troupe schedules                         # list them, with next and last run
troupe schedules run "Positive news"     # run one now
```

**Project files (read-only)**
```
troupe files "Personal finance" [folder] # list files
troupe cat "Personal finance" docs/portfolio-management.md
```
Text files only, up to 5 MB, inside the project folder. Keys and credentials (`.env`, `*.pem`, `id_rsa`, `.ssh/` …) are never listed, shown or attached.

**Collab**
```
troupe collab start "Workbench sandbox" "Build a rebalancing sheet"   # the Planner drafts a plan
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

- **Can:** everything above — chats, runs, scheduled tasks, read-only project files, Collab.
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
- Scheduled tasks: `troupe schedules`, `troupe schedules run "<task>"`.
- Clean up your test chats: `troupe delete <chat>` (only chats you started).

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
