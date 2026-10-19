# The `troupe` command

Work with Troupe from a terminal, or let a bot on your Mac (for example Grok Bot) do it: list projects, start or continue chats, wait for replies. The app does the work, so everything shows up live in its window.

## Turn it on

1. Open Troupe ▸ Settings ▸ Tools ▸ **Command line**.
2. Switch on **Allow command-line access** and click **Save**.
3. Click **Install** next to *troupe command*. It shows where the command went (for example `/opt/homebrew/bin/troupe`). If it says it isn't on your PATH, call it by that full path.

Troupe must be open. The command talks to it over a private socket that only your macOS user can open; there is no network port. It uses only `bash` and `curl` (both built into macOS) and writes no files.

## Commands

```
troupe projects                          # list projects
troupe chats "Workbench sandbox"         # a project's chats (name, part of a name, or id)
troupe show <chat-id> --last 5           # read the last messages
troupe send "Workbench sandbox" "summarise PLAN.md"            # new chat → prints a run id
troupe send <chat-id> "now draft the plan" --agent codex       # continue a chat
troupe status <run-id> --wait 600        # running / done / error, with the reply
troupe stop <run-id>                     # stop a running reply
troupe agents                            # agents you can use, and their models
```

Options: `--agent NAME`, `--model MODEL`, `--mode read|auto` (default `auto`), `--new` (start a new chat even if you gave a chat id), `--json` (machine-readable output). Use `-` as the message to read it from stdin: `cat brief.md | troupe send "Workbench sandbox" -`.

Exit codes: `0` ok, `1` Troupe refused the request (the reason is printed), `2` bad usage, `3` Troupe isn't reachable (not open, or command-line access is off).

## What it can and can't do

- **Can:** list projects and chats, read messages, send messages (new or follow-up), wait for and stop replies.
- **Can't:** create images, change settings, edit memory, notes or skills, create or delete projects, or touch the database directly.
- Runs use **Read-only** or **Auto** (with the shell sandbox). **Full access is never available** from the command line.
- Messages sent this way are marked *Sent from the command line* in the chat.

## Instructions to give Grok Bot

> You can work with my Troupe app through the `troupe` command on my Mac (full path: `/opt/homebrew/bin/troupe` — use the path Troupe's Settings shows). Start with `troupe projects` and `troupe agents`. To ask an agent something, run `troupe send "<project>" "<message>" --json`, take the `run` id from the output, then run `troupe status <run> --wait 600` until the state is `done`, `error` or `stopped`; repeat if it still says `running`. Continue a chat with `troupe send <chat-id> "<message>"`. Use `--mode read` when the agent only needs to look, not change files. Never try other ways to change Troupe or its files.
