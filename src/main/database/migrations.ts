import type Database from 'better-sqlite3'

// Ordered migrations. Each bumps PRAGMA user_version. Never edit a shipped
// migration — add a new one. (Spec §63 Phase 11: migration strategy.)
const migrations: Array<(db: Database.Database) => void> = [
  // v1 — projects + settings
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        folder_path TEXT,
        created_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  },
  // v2 — conversations + messages
  (db) => {
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_conversations_project ON conversations(project_id, updated_at DESC);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,              -- 'user' | 'assistant'
        provider TEXT,                   -- provider that produced an assistant msg
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata TEXT,                   -- JSON blob, optional
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at ASC);
    `)
  },
  // v3 — provider session mapping (conversation <-> provider-native session id)
  (db) => {
    db.exec(`
      CREATE TABLE provider_sessions (
        conversation_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, provider_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
  },
  // v4 — persistent context files selected for a project (spec §13)
  (db) => {
    db.exec(`
      CREATE TABLE project_context (
        project_id TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, rel_path),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `)
  },
  // v5 — Project Memory (separate from Instructions, spec §11) + session snapshots (§35)
  (db) => {
    db.exec(`
      ALTER TABLE projects ADD COLUMN memory TEXT NOT NULL DEFAULT '';
      CREATE TABLE session_snapshots (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        through_count INTEGER NOT NULL,
        provider_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_snapshots_conv ON session_snapshots(conversation_id, created_at DESC);
    `)
  },
  // v6 — global reusable skills (spec §57; D-010)
  (db) => {
    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  },
  // v7 — pinned conversations
  (db) => {
    db.exec(`ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`)
  },
  // v8 — per-conversation model override (spec §24)
  (db) => {
    db.exec(`ALTER TABLE conversations ADD COLUMN model TEXT;`)
  },
  // v9 — seed the default "Explain this" skill (stable id, used by the
  // selected-text "Explain this" action). User-editable; stays deleted if removed.
  (db) => {
    const now = Date.now()
    const body = [
      "When the user selects text and asks you to explain it, explain that specific selection — nothing else.",
      "",
      "- If the selection is ordinary prose or content, explain what it means in plain language: restate the idea simply, clear up anything ambiguous, and add a short example only if it genuinely helps.",
      "- If the selection is (or contains) a technical term, concept, abbreviation, acronym, or piece of jargon, define it: spell out any acronym in full, say what it means, and note why it matters in this context.",
      "- Match the depth to the selection — a single term gets a tight definition; a passage gets a short explanation of its meaning and significance.",
      "- Stay focused on the selected text. Don't summarise the whole conversation or wander off-topic. Prefer a few clear sentences over an essay."
    ].join("\n")
    db.prepare('INSERT OR IGNORE INTO skills (id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('explain-this', 'Explain this', body, now, now)
  },
  // v10 — skill auto-matching: keywords that attach a skill to a prompt
  (db) => {
    db.exec(`ALTER TABLE skills ADD COLUMN triggers TEXT NOT NULL DEFAULT '';`)
  },
  // v11 — Notes: global capture surface, independent of projects
  (db) => {
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
    `)
  },
  // v12 — Scheduled tasks: run a prompt on an interval or daily time
  (db) => {
    db.exec(`
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        permission_mode TEXT NOT NULL DEFAULT 'auto',
        kind TEXT NOT NULL DEFAULT 'interval',
        interval_min INTEGER NOT NULL DEFAULT 60,
        at_min INTEGER NOT NULL DEFAULT 540,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_schedules_next ON schedules(enabled, next_run_at);
    `)
  },
  // v13 — scheduled task target: 'new' thread each run, or reuse one 'same' thread
  (db) => {
    db.exec(`
      ALTER TABLE schedules ADD COLUMN target TEXT NOT NULL DEFAULT 'new';
      ALTER TABLE schedules ADD COLUMN conv_id TEXT;
    `)
  },
  // v14 — Collab mode: multi-agent runs (D-049 / Collab design). A run belongs to a
  // conversation; its tasks execute sequentially (maker -> reviewer) in P3.
  (db) => {
    db.exec(`
      CREATE TABLE collab_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        project_cwd TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL,
        permission_mode TEXT NOT NULL DEFAULT 'auto',
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planning',
        budget_json TEXT NOT NULL DEFAULT '{}',
        spent_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_collab_runs_conv ON collab_runs(conversation_id, created_at DESC);
      CREATE TABLE collab_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'work',      -- 'work' (maker->reviewer) | 'review' (reviewer-only)
        scope TEXT NOT NULL DEFAULT '',
        acceptance TEXT NOT NULL DEFAULT '',
        depends_on TEXT NOT NULL DEFAULT '[]',  -- json array of task ids
        status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|passed|failed|skipped
        attempts INTEGER NOT NULL DEFAULT 0,
        last_verdict TEXT,                      -- json {verdict, findings[]}
        maker_run_id TEXT,
        reviewer_run_id TEXT,
        FOREIGN KEY (run_id) REFERENCES collab_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_collab_tasks_run ON collab_tasks(run_id, seq ASC);
    `)
  },
  // v15 — Collab: store each Maker's compact handoff ({status, filesChanged, verify})
  // so downstream agents get a lean summary instead of re-reading the verbose STATUS.md.
  (db) => {
    db.exec(`ALTER TABLE collab_tasks ADD COLUMN handoff TEXT;`)
  },
  // v16 — Collab: per-task provider/model (D-052). Run keeps a default Maker model;
  // each task may override provider+model. Planner/Reviewer always run strong (code).
  (db) => {
    db.exec(`
      ALTER TABLE collab_runs ADD COLUMN model TEXT NOT NULL DEFAULT '';
      ALTER TABLE collab_tasks ADD COLUMN provider TEXT;
      ALTER TABLE collab_tasks ADD COLUMN model TEXT;
    `)
  },
  // v17 — Multi-folder projects (D-054). A project keeps exactly one PRIMARY folder
  // (still `projects.folder_path`, so the ~50 readers of `folderPath` are untouched)
  // and may add N additional folders the agent may read and edit via `--add-dir`.
  // The `is_primary` flag means the full multi-root version needs no second migration.
  (db) => {
    db.exec(`
      CREATE TABLE project_folders (
        project_id TEXT NOT NULL,
        path       TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        added_at   INTEGER NOT NULL,
        PRIMARY KEY (project_id, path),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO project_folders (project_id, path, is_primary, added_at)
        SELECT id, folder_path, 1, created_at FROM projects WHERE folder_path IS NOT NULL;
    `)
  }  ,
  // v18 — Manual project ordering (drag to reorder). Backfill from created_at DESC
  // so the initial manual order matches the list users see today (newest first).
  (db) => {
    db.exec(`ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`)
    db.exec(`UPDATE projects SET sort_order = (SELECT COUNT(*) FROM projects p2 WHERE p2.created_at > projects.created_at);`)
  },
  // v19 — Turn lock (D-061). Main owns turn orchestration; this row exists only so a
  // startup sweep can tell that a previous process died mid-turn. Streaming state is
  // memory-only and is not persisted.
  (db) => {
    db.exec(`
      CREATE TABLE turns (
        conversation_id TEXT PRIMARY KEY,
        chain TEXT NOT NULL,
        parallel INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `)
  },
  // v20 — Remember the permission mode per conversation (Hien, 2026-09-21): the
  // composer reset to Auto on every chat switch. NULL = never chosen → the app-wide
  // last choice (setting last_permission_mode), then 'auto'.
  (db) => { db.exec(`ALTER TABLE conversations ADD COLUMN permission_mode TEXT;`) },
  // v21 — Collab deliverables folder (D-064). PLAN.md/STATUS.md stay in the hidden
  // .workbench/collab/<run>/; the work itself goes to a visible project folder chosen
  // at planning. '' = older runs (deliverables were written inside the run folder).
  (db) => { db.exec(`ALTER TABLE collab_runs ADD COLUMN output_dir TEXT NOT NULL DEFAULT '';`) },
  // v22 — Decisions log for projects without a folder (D-081 step 5). Projects with a
  // folder keep it in <folder>/DECISIONS.md; this column mirrors the `memory` fallback.
  (db) => { db.exec(`ALTER TABLE projects ADD COLUMN decisions TEXT NOT NULL DEFAULT '';`) },
  // v23 — Full-text search over messages (D-095). External-content FTS5 keyed on the
  // messages rowid (nothing VACUUMs this DB, and messages are never UPDATEd — the update
  // trigger is there for safety). Triggers also fire on the ON DELETE CASCADE from
  // conversations. Diacritics fold ("viet" finds "Việt"). Built once from existing rows.
  (db) => {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
    `)
  },
  // v24 — Collab recovery (D-109): per-task recovery state (note for the next attempt,
  // failure signature, repairs, skip note, plan-change history) and a Planner repair
  // proposal waiting on the run for the user's choice.
  (db) => {
    db.exec(`
      ALTER TABLE collab_tasks ADD COLUMN meta TEXT;
      ALTER TABLE collab_runs ADD COLUMN repair_json TEXT;
    `)
  },
  // v25 — scheduled tasks from the command line (D-134): who made a task, whether bots may
  // manage it, and a bot's change waiting for approval (JSON).
  (db) => {
    db.exec(`
      ALTER TABLE schedules ADD COLUMN created_via TEXT NOT NULL DEFAULT 'app';
      ALTER TABLE schedules ADD COLUMN bot_managed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE schedules ADD COLUMN pending TEXT;
    `)
  }
]

/** Back up the DB file before migrating only when a migration will actually run (audit #6:
 *  it used to copy the whole file on every launch, on the main thread, before the window). */
export function shouldBackup(before: number, latest = migrations.length): boolean { return before > 0 && before < latest }

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > migrations.length) {
    throw new Error(
      `Database schema v${current} is newer than this app supports (v${migrations.length}). ` +
      'Update AI Workbench to open this data.'
    )
  }
  for (let v = current; v < migrations.length; v++) {
    const migrate = migrations[v]
    const tx = db.transaction(() => {
      migrate(db)
      db.pragma(`user_version = ${v + 1}`)
    })
    tx()
  }
}
