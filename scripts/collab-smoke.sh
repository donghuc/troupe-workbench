#!/bin/bash
# Collab smoke test for D-108/D-109 (deliverables check, text-only agents, stall → Planner
# repair, retry with note, skip). Collab runs need the app UI, so this script does the
# setup and the checking; you start the runs in Troupe.
#
#   scripts/collab-smoke.sh setup     back up the database, create the scratch project folder
#   scripts/collab-smoke.sh check     inspect the runs and STATUS logs, print PASS/FAIL per test
#   scripts/collab-smoke.sh restore   put the backed-up database back (quit Troupe first)
set -u
DATA="$HOME/Library/Application Support/AI Workbench"
DB="$DATA/workbench.db"
BACKUP="$HOME/Desktop/troupe-backup-before-2.5.0"
# Scratch project folder: TROUPE_TEST_DIR, else ~/Documents/TroupeCollabTest if it exists, else ~/TroupeCollabTest.
if [ -n "${TROUPE_TEST_DIR:-}" ]; then SCRATCH="$TROUPE_TEST_DIR"
elif [ -d "$HOME/Documents/TroupeCollabTest" ]; then SCRATCH="$HOME/Documents/TroupeCollabTest"
else SCRATCH="$HOME/TroupeCollabTest"; fi
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

# Troupe is "running" if something has the database open (more precise than matching
# process names, which also hit unrelated apps whose paths contain "Workbench").
app_running() {
  local pids; pids=$(lsof -t "$DB" "$DB-wal" 2>/dev/null | sort -u)
  [ -z "$pids" ] && return 1
  echo "These processes have the Troupe database open:"
  for p in $pids; do ps -o pid=,comm= -p "$p"; done
  return 0
}

setup() {
  if app_running; then red "Quit Troupe (and any npm run dev) first, then run setup again."; exit 1; fi
  if [ -d "$BACKUP" ]; then echo "Backup already exists: $BACKUP (kept as is)"
  else mkdir -p "$BACKUP" && cp "$DB"* "$BACKUP"/ && green "Backed up the database to $BACKUP"; fi
  mkdir -p "$SCRATCH"
  cat > "$SCRATCH/README.md" <<'MD'
# Lantern

Lantern is a small desktop app that keeps a reading list. You paste a link, Lantern saves
the page as clean text, tags it by topic, and reminds you on Sunday mornings of what you
saved but never read. Everything stays on your Mac; there is no account and no sync.
The app is built with Electron and SQLite. Version 0.3 adds full-text search and an
export to Markdown. Known limits: no PDF support yet, and pages behind a login save empty.
MD
  green "Scratch project folder ready: $SCRATCH"
  echo
  bold "Now, in Troupe (npm run dev from the Workbench folder):"
  cat <<TXT
  1. Settings › Agents › Add agent › custom
       Name: Dummy    Command: echo "I can't help with that."    Output: plain text
  2. New project "Collab test" with folder: $SCRATCH
  3. In that project, start three chats, switch the composer to Collab, and send:

     A) Write five short haiku about rain into poems/rain.md. Give the writing task to x-opencode.

     B) Write a 100-word summary of README.md into notes/summary.md. Give the writing task to Dummy.
        (Let it run until it is fixed or pauses. If it pauses with the Planner's options, click one.)

     C) Write a 100-word summary of README.md into notes/summary-c.md. Give the writing task to Dummy.
        When it pauses: type "Write the summary yourself, plain prose" and press Retry with note.
        When it pauses again: press Skip task and confirm. Let the run finish.

  4. Run:  scripts/collab-smoke.sh check
TXT
}

# Plain (not -readonly) open: a read-only handle can miss rows still in the WAL journal
# while Troupe is running. We only ever SELECT.
q() { sqlite3 -list -noheader -cmd ".timeout 3000" "$DB" "$1"; }

check() {
  [ -f "$DB" ] || { red "No database at $DB"; exit 1; }
  local pass=0 fail=0
  ok()  { green "  ✓ $*"; pass=$((pass+1)); }
  bad() { red   "  ✗ $*"; fail=$((fail+1)); }
  # Find the newest run by its goal text in ANY project, and say so if it isn't the scratch folder.
  run_for() {
    local row; row=$(q "SELECT id || '|' || project_cwd FROM collab_runs WHERE goal LIKE '%$1%' ORDER BY created_at DESC LIMIT 1;")
    [ -z "$row" ] && return
    local cwd="${row#*|}"
    [ "$cwd" != "$SCRATCH" ] && echo "  (note: this run is in $cwd, not $SCRATCH)" >&2
    echo "${row%%|*}"
  }
  status_of() { local cwd; cwd=$(q "SELECT project_cwd FROM collab_runs WHERE id='$1';"); cat "$cwd/.workbench/collab/$1/STATUS.md" 2>/dev/null; }
  bold "Newest Collab runs in the database:"
  q "SELECT '  ' || datetime(created_at/1000,'unixepoch','localtime') || ' · ' || status || ' · ' || project_cwd || ' · ' || substr(replace(goal, char(10), ' '),1,60) FROM collab_runs ORDER BY created_at DESC LIMIT 5;"
  echo

  bold "A) text-only agent — Troupe saves its file from the reply"
  local A; A=$(run_for 'haiku about rain')
  if [ -z "$A" ]; then bad "no run found (goal containing 'haiku about rain' in $SCRATCH)"; else
    local SA; SA=$(status_of "$A")
    echo "$SA" | grep -q "saved .*poems/rain.md.* reply" && ok "STATUS: file saved from the agent's reply" || bad "STATUS has no 'saved poems/rain.md from … reply' line"
    local CA; CA=$(q "SELECT project_cwd FROM collab_runs WHERE id='$A';")
    [ -s "$CA/poems/rain.md" ] && ok "poems/rain.md exists ($(wc -l < "$CA/poems/rain.md" | tr -d ' ') lines)" || bad "poems/rain.md missing or empty"
    [ "$(q "SELECT status FROM collab_tasks WHERE run_id='$A' AND scope LIKE '%rain.md%' LIMIT 1;")" = "passed" ] && ok "writing task passed review" || bad "writing task did not pass (status: $(q "SELECT status FROM collab_tasks WHERE run_id='$A' AND scope LIKE '%rain.md%' LIMIT 1;"))"
  fi

  bold "B) same failure twice → Planner repair"
  local B; B=$(run_for 'notes/summary.md')
  if [ -z "$B" ]; then bad "no run found (goal containing 'notes/summary.md')"; else
    local SB; SB=$(status_of "$B")
    echo "$SB" | grep -q "— stuck: " && ok "stuck task detected without your help ($(echo "$SB" | grep -m1 -o 'stuck: [^.]*'))" || bad "no 'stuck:' entry — the same failure was retried without asking the Planner"
    echo "$SB" | grep -q "Planner · repair" && ok "Planner proposed a repair" || bad "no 'Planner · repair' entry"
    if echo "$SB" | grep -q "Plan change"; then ok "a fix was applied ($(echo "$SB" | grep -m1 'Plan change' | sed 's/^## //'))"
    elif [ -n "$(q "SELECT repair_json FROM collab_runs WHERE id='$B';")" ]; then ok "fix options waiting on the card (click one to finish)"
    else bad "no fix applied and none waiting"; fi
    local RR; RR=$(q "SELECT json_extract(spent_json,'$.retryRuns') FROM collab_runs WHERE id='$B';")
    [ "${RR:-0}" -gt 0 ] 2>/dev/null && ok "retry runs counted: $RR" || bad "retryRuns not counted"
  fi

  bold "C) Retry with note, then Skip"
  local C; C=$(run_for 'notes/summary-c.md')
  if [ -z "$C" ]; then bad "no run found (goal containing 'notes/summary-c.md')"; else
    local SC; SC=$(status_of "$C")
    echo "$SC" | grep -q "retry with a note" && ok "retry with your note logged" || bad "no 'retry with a note' entry"
    echo "$SC" | grep -q "skipped" && ok "skip logged" || bad "no skip entry"
    [ "$(q "SELECT count(*) FROM collab_tasks WHERE run_id='$C' AND status='skipped';")" -ge 1 ] && ok "task marked skipped" || bad "no skipped task"
    local RS; RS=$(q "SELECT status FROM collab_runs WHERE id='$C';")
    [ "$RS" = "done" ] && ok "run finished after the skip" || bad "run status is '$RS' (expected done)"
  fi

  echo
  if [ $fail -eq 0 ]; then green "All $pass checks passed."; else red "$fail failed, $pass passed — paste this output and the STATUS log of the failing run."; fi
  echo "STATUS logs: <project folder>/.workbench/collab/<run>/STATUS.md"
}

restore() {
  if app_running; then red "Quit Troupe first."; exit 1; fi
  [ -d "$BACKUP" ] || { red "No backup at $BACKUP"; exit 1; }
  rm -f "$DATA/workbench.db-wal" "$DATA/workbench.db-shm"   # never mix a newer journal with the old database
  cp "$BACKUP"/workbench.db* "$DATA"/ && green "Restored the database from $BACKUP (installed 2.4.1 will open again)."
}

case "${1:-}" in setup) setup ;; check) check ;; restore) restore ;; *) echo "usage: $0 setup|check|restore"; exit 1 ;; esac
