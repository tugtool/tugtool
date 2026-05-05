//! SessionLedger — sqlite-backed per-session metadata for the tugcast supervisor.
//!
//! One row per claude session. Each row carries the workspace key, project dir,
//! created/last-used timestamps, turn count, first-prompt snippet, lifecycle
//! state, and (when the session is live) the bound card id. The ledger replaces
//! the previous tugbank-backed `sessions` map and `live-sessions` set with a
//! purpose-built store: row-level queries, atomic eviction, indexed lookup by
//! workspace, single source of truth for "is this session live, and where".
//!
//! # State machine
//!
//! `state` is one of `live` | `closed` | `failed`. Allowed transitions:
//!
//! - `INSERT  state="live", card_id_live=<card_id>` on `spawn_session_ok`.
//! - `UPDATE  state="closed", card_id_live=NULL`    on `close_session` or tugcode exit.
//! - `UPDATE  state="failed", card_id_live=NULL`    on `resume_failed` (replaces the previous row-removal).
//! - `DELETE` on cap/age eviction or explicit forget.
//!
//! # Eviction
//!
//! - **Cap per workspace** — `TIDE_LEDGER_MAX_PER_WORKSPACE` (20). On
//!   `record_spawn`, the oldest non-live row by `last_used_at` is evicted if
//!   the workspace already holds the cap.
//! - **Age expiry** — `TIDE_LEDGER_MAX_AGE_DAYS` (90). Tugcast startup sweeps
//!   any non-live row whose `last_used_at` is older than the cap.
//!
//! Live rows are never evicted by either policy. A long-pinned card keeps its
//! ledger row regardless of age.
//!
//! # Schema versioning
//!
//! - **v1** — `sessions` table only.
//! - **v2** — adds `turns` (per-turn rows keyed by tugcast-minted
//!   `tug_turn_id`) and a `migrations` table that records each applied
//!   schema version. Cascade-on-`sessions`-DELETE is implemented via the
//!   `turns_cascade_delete_on_session` trigger rather than a foreign-key
//!   constraint: the supervisor inserts turns rows at user-message
//!   dispatch time, before claude emits `session_init` and before the
//!   bridge populates the `sessions` row, so an `INSERT`-time FK check
//!   would chicken-and-egg. The trigger preserves the user-visible
//!   "Forget cascades to turns" contract without coupling INSERT
//!   ordering across the dispatch and bridge code paths.
//!
//! Bootstrap is purely additive: `CREATE TABLE IF NOT EXISTS` for every
//! table, `CREATE INDEX IF NOT EXISTS` for every index,
//! `CREATE TRIGGER IF NOT EXISTS` for cascades, and
//! `INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (N, ?)`
//! for the current schema version. A v1 file therefore upgrades to v2 in
//! place on first open: the new tables and trigger appear, the
//! migrations marker is written, and existing `sessions` rows are
//! preserved unchanged. Future schema variants must add their additive
//! DDL, INSERT a row into `migrations` keyed on the new version, and
//! update this section.
//!
//! # Concurrency
//!
//! Writes serialize through a single `Mutex<Connection>` inside the ledger.
//! Sqlite runs in WAL mode with a 5-second `busy_timeout`. The supervisor's
//! write cadence — one write per `session_init` / `turn_complete` /
//! `resume_failed` / close — fits comfortably under those settings.
//! Per-turn writes (`insert_pending_turn`, `mark_turn_complete`,
//! `mark_turn_interrupted`) wrap their read-modify-write into an
//! `IMMEDIATE` transaction so concurrent ledger handles on the same file
//! cannot produce duplicate ordinals or trample state transitions.

// The ledger surface is authored ahead of the supervisor wiring that consumes
// it; suppress dead-code warnings for the public API until the bridge swap
// lands. Same pattern `agent_supervisor.rs` uses for phased rollouts.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Maximum non-live rows per workspace before cap eviction kicks in on spawn.
pub const TIDE_LEDGER_MAX_PER_WORKSPACE: usize = 20;

/// Days since `last_used_at` after which a non-live row is age-evicted on
/// startup sweep.
pub const TIDE_LEDGER_MAX_AGE_DAYS: i64 = 90;

/// Days a `.tug-trash/<deletedAt>/` directory survives before the startup
/// trash sweep removes it. Wired in step 8.
pub const TIDE_TRASH_SWEEP_AGE_DAYS: i64 = 7;

/// Maximum number of characters of the first user prompt the ledger stores.
/// The picker truncates further at display time.
pub const FIRST_USER_PROMPT_MAX_CHARS: usize = 256;

/// Errors emitted by ledger operations.
#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("session not found: {0}")]
    NotFound(String),

    #[error("invalid session state in row: {0}")]
    InvalidState(String),

    #[error("invalid turn state in row: {0}")]
    InvalidTurnState(String),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Lifecycle state of a row in the ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Live,
    Closed,
    Failed,
}

impl SessionState {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionState::Live => "live",
            SessionState::Closed => "closed",
            SessionState::Failed => "failed",
        }
    }
}

impl std::str::FromStr for SessionState {
    type Err = LedgerError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "live" => Ok(SessionState::Live),
            "closed" => Ok(SessionState::Closed),
            "failed" => Ok(SessionState::Failed),
            other => Err(LedgerError::InvalidState(other.to_owned())),
        }
    }
}

/// One row of the `sessions` table, also the wire shape for the CONTROL
/// `list_sessions` response and the `session_updated` push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionRow {
    pub session_id: String,
    pub workspace_key: String,
    pub project_dir: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub turn_count: i64,
    pub first_user_prompt: Option<String>,
    pub state: SessionState,
    pub card_id_live: Option<String>,
}

/// Lifecycle state of one row in the `turns` table.
///
/// - `Pending` — tugcast minted a `tug_turn_id` and persisted the row when
///   the user submitted the prompt; claude has not (yet) acknowledged
///   completion. The row's `claude_message_id` is `NULL` and
///   `completed_at` is unset.
/// - `Complete` — claude emitted `turn_complete` for this turn; the row
///   carries the matched `claude_message_id` and `completed_at`.
/// - `Interrupted` — the user (or a crash recovery sweep) cancelled the
///   pending turn; `partial_text` may carry whatever assistant text had
///   streamed so far, and `completed_at` is the cancel timestamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurnState {
    Pending,
    Complete,
    Interrupted,
}

impl TurnState {
    pub fn as_str(self) -> &'static str {
        match self {
            TurnState::Pending => "pending",
            TurnState::Complete => "complete",
            TurnState::Interrupted => "interrupted",
        }
    }
}

impl std::str::FromStr for TurnState {
    type Err = LedgerError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(TurnState::Pending),
            "complete" => Ok(TurnState::Complete),
            "interrupted" => Ok(TurnState::Interrupted),
            other => Err(LedgerError::InvalidTurnState(other.to_owned())),
        }
    }
}

/// One row of the `turns` table. Authored by tugcast at user-submit time
/// (`insert_pending_turn`) and updated on `turn_complete` /
/// `turn_cancelled` (`mark_turn_complete` / `mark_turn_interrupted`).
/// `tugcode`'s replay path reads these rows in `ordinal` order to
/// reconstruct the transcript across reload, restart, and crash boundaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnRow {
    pub tug_turn_id: String,
    pub session_id: String,
    pub ordinal: i64,
    pub claude_message_id: Option<String>,
    pub user_text: String,
    pub user_attachments: Vec<serde_json::Value>,
    pub state: TurnState,
    pub partial_text: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

/// Result of a successful `forget` call.
///
/// `jsonl_moved_to` is `None` until step 8 wires the trash move. Until then
/// `forget` only deletes the ledger row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgetOutcome {
    pub session_id: String,
    pub jsonl_moved_to: Option<PathBuf>,
}

/// SQLite-backed per-session metadata store.
pub struct SessionLedger {
    db: Mutex<Connection>,
    /// Root directory where claude code stores per-project session JSONLs:
    /// `<root>/<encoded-project-dir>/<sessionId>.jsonl`. Production defaults
    /// to `~/.claude/projects/`; tests inject a tempdir so trash mechanics
    /// don't touch the real filesystem.
    claude_projects_root: PathBuf,
}

impl SessionLedger {
    /// Open or create the ledger at `path`. Applies pragmas and runs the
    /// idempotent schema bootstrap. Safe to call against an existing file.
    /// Uses the default claude projects root (`~/.claude/projects/`).
    pub fn open(path: impl AsRef<Path>) -> Result<Self, LedgerError> {
        Self::open_with_claude_root(path, default_claude_projects_root())
    }

    /// Open the ledger with an explicit `claude_projects_root`. Tests pass
    /// a tempdir; production uses the default.
    pub fn open_with_claude_root(
        path: impl AsRef<Path>,
        claude_projects_root: PathBuf,
    ) -> Result<Self, LedgerError> {
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        Ok(Self {
            db: Mutex::new(conn),
            claude_projects_root,
        })
    }

    /// Open an in-memory ledger. Test-only convenience; never used by
    /// production callers. Uses a placeholder claude root that no test
    /// should write through (tests using trash should use
    /// `open_with_claude_root` against a tempdir).
    pub fn open_in_memory() -> Result<Self, LedgerError> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        Ok(Self {
            db: Mutex::new(conn),
            claude_projects_root: PathBuf::from("/tmp/tugcast-tests-no-trash"),
        })
    }

    /// Default on-disk location for the ledger:
    ///
    /// - macOS: `~/Library/Application Support/Tug/sessions.db`
    /// - Linux: `$XDG_DATA_HOME/tugcast/sessions.db` (falling back to
    ///   `~/.local/share/tugcast/sessions.db`)
    ///
    /// Returns `None` only if no home directory can be resolved, which
    /// indicates a misconfigured environment; callers should treat that as
    /// a fatal startup error.
    pub fn default_path() -> Option<PathBuf> {
        let base = dirs::data_dir()?;
        #[cfg(target_os = "macos")]
        let dir = base.join("Tug");
        #[cfg(not(target_os = "macos"))]
        let dir = base.join("tugcast");
        Some(dir.join("sessions.db"))
    }

    /// Configured claude projects root. Exposed so the supervisor's batch
    /// trash sweep can iterate `<root>/*/.tug-trash/` without re-resolving.
    pub fn claude_projects_root(&self) -> &Path {
        &self.claude_projects_root
    }

    fn configure(conn: &Connection) -> Result<(), LedgerError> {
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.pragma_update(None, "busy_timeout", 5000i64)?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::bootstrap_schema(conn)?;
        Ok(())
    }

    fn bootstrap_schema(conn: &Connection) -> Result<(), LedgerError> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                session_id        TEXT PRIMARY KEY,
                workspace_key     TEXT NOT NULL,
                project_dir       TEXT NOT NULL,
                created_at        INTEGER NOT NULL,
                last_used_at      INTEGER NOT NULL,
                turn_count        INTEGER NOT NULL DEFAULT 0,
                first_user_prompt TEXT,
                state             TEXT NOT NULL,
                card_id_live      TEXT
            );

            CREATE INDEX IF NOT EXISTS sessions_workspace_recent
                ON sessions(workspace_key, last_used_at DESC);

            CREATE TABLE IF NOT EXISTS turns (
                tug_turn_id        TEXT PRIMARY KEY,
                session_id         TEXT NOT NULL,
                ordinal            INTEGER NOT NULL,
                claude_message_id  TEXT,
                user_text          TEXT NOT NULL,
                user_attachments   BLOB NOT NULL,
                state              TEXT NOT NULL,
                partial_text       TEXT,
                created_at         INTEGER NOT NULL,
                completed_at       INTEGER
            );

            CREATE INDEX IF NOT EXISTS turns_session_ordinal
                ON turns(session_id, ordinal);

            CREATE INDEX IF NOT EXISTS turns_claude_message_id
                ON turns(claude_message_id);

            CREATE TRIGGER IF NOT EXISTS turns_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM turns WHERE session_id = OLD.session_id;
            END;

            CREATE TABLE IF NOT EXISTS migrations (
                version    INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            ",
        )?;
        // Mark v2 applied. `INSERT OR IGNORE` keeps re-opens of an
        // already-v2 database silent (the PRIMARY KEY rejects duplicate
        // versions; we want re-open to be a no-op, not an error). v1
        // files have no `migrations` table at all — the additive DDL
        // above creates it on the spot, so this insert lands the v=2
        // marker on the first upgrade and stays put on subsequent opens.
        conn.execute(
            "INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (2, ?1)",
            params![now_millis()],
        )?;
        Ok(())
    }

    /// All rows in the workspace, ordered newest-first by `last_used_at`.
    pub fn list_for_workspace(&self, workspace_key: &str) -> Result<Vec<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, first_user_prompt, state, card_id_live
             FROM sessions
             WHERE workspace_key = ?1
             ORDER BY last_used_at DESC",
        )?;
        let rows = stmt
            .query_map(params![workspace_key], row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    }

    /// All rows whose `project_dir` matches `project_dir` literally,
    /// ordered newest-first by `last_used_at`. The picker uses this for
    /// its "what sessions did I have under this typed path?" query — the
    /// raw user-typed path matches the value originally recorded at
    /// `record_spawn` time, so no client-side canonicalization is needed.
    /// `list_for_workspace` matches against the canonical key and stays
    /// for the supervisor's resume-resolution path.
    pub fn list_for_project_dir(&self, project_dir: &str) -> Result<Vec<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, first_user_prompt, state, card_id_live
             FROM sessions
             WHERE project_dir = ?1
             ORDER BY last_used_at DESC",
        )?;
        let rows = stmt
            .query_map(params![project_dir], row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    }

    /// Look up a single row by session id.
    pub fn get(&self, session_id: &str) -> Result<Option<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, first_user_prompt, state, card_id_live
             FROM sessions
             WHERE session_id = ?1
             LIMIT 1",
        )?;
        let row = stmt
            .query_row(params![session_id], row_from_query)
            .optional()?;
        match row {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    /// Insert a new live row, or transition an existing row back to live and
    /// rebind it to `card_id`. `created_at` is preserved across resumes.
    pub fn record_spawn(
        &self,
        session_id: &str,
        workspace_key: &str,
        project_dir: &str,
        card_id: &str,
        now: i64,
    ) -> Result<(), LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing_created_at: Option<i64> = tx
            .query_row(
                "SELECT created_at FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?;
        let created_at = existing_created_at.unwrap_or(now);
        tx.execute(
            "INSERT INTO sessions (
                session_id, workspace_key, project_dir,
                created_at, last_used_at, turn_count,
                first_user_prompt, state, card_id_live
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, 'live', ?6)
             ON CONFLICT(session_id) DO UPDATE SET
                workspace_key = excluded.workspace_key,
                project_dir   = excluded.project_dir,
                last_used_at  = excluded.last_used_at,
                state         = 'live',
                card_id_live  = excluded.card_id_live",
            params![
                session_id,
                workspace_key,
                project_dir,
                created_at,
                now,
                card_id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Set `first_user_prompt` if not already set. The caller is responsible
    /// for truncation; the `truncate_first_prompt` helper is provided for
    /// consistency.
    pub fn record_first_prompt(&self, session_id: &str, prompt: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let affected = conn.execute(
            "UPDATE sessions
             SET first_user_prompt = ?2
             WHERE session_id = ?1 AND first_user_prompt IS NULL",
            params![session_id, prompt],
        )?;
        if affected == 0 {
            // Either the row doesn't exist, or first_user_prompt is already
            // populated. Both are acceptable no-ops; the latter preserves
            // the original conversation snippet across resumes.
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM sessions WHERE session_id = ?1",
                    params![session_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            if !exists {
                return Err(LedgerError::NotFound(session_id.to_owned()));
            }
        }
        Ok(())
    }

    /// Increment `turn_count` and bump `last_used_at`. No-op if the row is
    /// not in `live` state — see the `forget` race-mitigation note in the
    /// plan's risk table.
    pub fn record_turn(&self, session_id: &str, now: i64) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let affected = conn.execute(
            "UPDATE sessions
             SET turn_count = turn_count + 1,
                 last_used_at = ?2
             WHERE session_id = ?1 AND state = 'live'",
            params![session_id, now],
        )?;
        if affected == 0 {
            // Row may be absent (forgotten under us) or non-live (closed/failed
            // out from under a late turn). Both are acceptable no-ops.
        }
        Ok(())
    }

    /// Transition a row to `closed`.
    pub fn mark_closed(&self, session_id: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "UPDATE sessions
             SET state = 'closed', card_id_live = NULL
             WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// Transition a row to `failed`. Replaces the previous "remove on
    /// resume_failed" semantics — the row is retained as a diagnostic crumb.
    pub fn mark_failed(&self, session_id: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "UPDATE sessions
             SET state = 'failed', card_id_live = NULL
             WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// Delete the ledger row for `session_id` and move its claude-side
    /// JSONL to in-place trash so the user can recover for 7 days.
    ///
    /// Refuses if the row is currently live — callers must close the card
    /// first. JSONL move is best-effort: if the file is missing or the
    /// trash directory cannot be created, the row deletion still
    /// succeeds; `jsonl_moved_to` is `None` in that case and the caller
    /// can read tracing logs to understand why.
    pub fn forget(&self, session_id: &str) -> Result<ForgetOutcome, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        // Read state + project_dir under the same lock so the JSONL move
        // afterwards has the canonical project_dir we recorded at spawn.
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT state, project_dir FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let project_dir = match row {
            None => return Err(LedgerError::NotFound(session_id.to_owned())),
            Some((state, _)) if state == "live" => {
                return Err(LedgerError::InvalidState(
                    "cannot forget a live session".to_owned(),
                ));
            }
            Some((_, pd)) => pd,
        };
        tx.execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.commit()?;
        drop(conn);

        let trash_path = move_jsonl_to_trash(
            &self.claude_projects_root,
            &project_dir,
            session_id,
            now_millis(),
        );
        Ok(ForgetOutcome {
            session_id: session_id.to_owned(),
            jsonl_moved_to: trash_path,
        })
    }

    /// Drop every non-live row whose `project_dir` matches `project_dir`
    /// literally and move each row's JSONL to trash. Returns the session
    /// ids of the dropped rows so the caller can broadcast `session_updated
    /// { removed: true }` pushes. Used by recents-eviction → ledger-eviction
    /// coupling: when a tide recent-projects entry ages out, the matching
    /// ledger rows are dropped in lockstep so the picker doesn't surface
    /// sessions for a path the user no longer recognizes. The JSONLs go to
    /// trash so the user can `mv` them back if they recognize the loss.
    pub fn forget_for_project_dir(&self, project_dir: &str) -> Result<Vec<String>, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let doomed: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT session_id FROM sessions
                 WHERE project_dir = ?1 AND state != 'live'",
            )?;
            stmt.query_map(params![project_dir], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for id in &doomed {
            tx.execute("DELETE FROM sessions WHERE session_id = ?1", params![id])?;
        }
        tx.commit()?;
        drop(conn);

        let now = now_millis();
        for id in &doomed {
            move_jsonl_to_trash(&self.claude_projects_root, project_dir, id, now);
        }
        Ok(doomed)
    }

    /// Walk every project subdirectory under `claude_projects_root`,
    /// looking for `.tug-trash/<deletedAt>/` subdirs whose timestamp is
    /// older than `max_age_ms`. Called from `main.rs` at tugcast startup.
    ///
    /// Returns the count of subdirectories removed across all projects.
    /// IO errors are logged via tracing and swallowed — a partial sweep
    /// is preferable to bringing tugcast startup down.
    ///
    /// Filesystem-driven (not ledger-driven) so the sweep finds trash
    /// dirs even when their parent project's last ledger row was forgotten
    /// — that's the path that creates the orphan in the first place. The
    /// scan touches at most a few dozen subdirs (one per claude project),
    /// so the cost is negligible compared to the alternative of leaking
    /// trash dirs forever.
    pub fn sweep_trash(&self, max_age_ms: i64, now: i64) -> usize {
        let cutoff = now.saturating_sub(max_age_ms);
        let entries = match std::fs::read_dir(&self.claude_projects_root) {
            Ok(it) => it,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return 0,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    root = %self.claude_projects_root.display(),
                    "sweep_trash: read_dir failed",
                );
                return 0;
            }
        };
        let mut count = 0usize;
        for entry_result in entries {
            let Ok(entry) = entry_result else {
                continue;
            };
            // Only descend into directories (each project root is a dir).
            // file_type() avoids one syscall per stat() call when the
            // dirent already carries the type, which it does on macOS +
            // Linux APFS/ext.
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            let trash_root = entry.path().join(".tug-trash");
            count += sweep_trash_dir(&trash_root, cutoff);
        }
        count
    }

    /// If the workspace already holds at least `cap` non-live rows, evict
    /// the oldest (lowest `last_used_at`). Returns the session ids of the
    /// evicted rows so the caller can broadcast `session_updated
    /// { removed: true }` pushes. Live rows are never evicted.
    ///
    /// Intended to be called after `record_spawn`, so the just-inserted row
    /// is never the eviction target (it's live).
    pub fn evict_oldest_closed(
        &self,
        workspace_key: &str,
        cap: usize,
    ) -> Result<Vec<String>, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let non_live_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM sessions
             WHERE workspace_key = ?1 AND state != 'live'",
            params![workspace_key],
            |row| row.get(0),
        )?;
        if (non_live_count as usize) <= cap {
            tx.commit()?;
            return Ok(Vec::new());
        }
        // We're over the cap — drop the oldest. Plural-safe: if the cap was
        // exceeded by more than one (e.g., a clock skew or a code path that
        // skipped eviction earlier), this brings the workspace back to cap.
        let to_remove = (non_live_count as usize) - cap;
        // Collect the doomed ids first so we can return them after the
        // delete commits.
        let doomed: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT session_id FROM sessions
                 WHERE workspace_key = ?1 AND state != 'live'
                 ORDER BY last_used_at ASC
                 LIMIT ?2",
            )?;
            stmt.query_map(params![workspace_key, to_remove as i64], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        for id in &doomed {
            tx.execute("DELETE FROM sessions WHERE session_id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(doomed)
    }

    /// Demote any rows still marked `live` (and bound to a card) into the
    /// `closed` state. Called once at tugcast startup: a previous tugcast
    /// process that crashed without cleanly closing its sessions will have
    /// left `state="live"` rows behind that no longer reflect any running
    /// subprocess. Returns the number of rows demoted.
    pub fn demote_live_to_closed(&self) -> Result<usize, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let count = conn.execute(
            "UPDATE sessions
             SET state = 'closed', card_id_live = NULL
             WHERE state = 'live'",
            [],
        )?;
        Ok(count)
    }

    /// Remove every non-live row whose `last_used_at` is older than
    /// `now - max_age_ms`. Returns the session ids of the swept rows so
    /// the caller can broadcast `session_updated { removed: true }` pushes.
    pub fn sweep_expired(&self, max_age_ms: i64, now: i64) -> Result<Vec<String>, LedgerError> {
        let cutoff = now - max_age_ms;
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let doomed: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT session_id FROM sessions
                 WHERE state != 'live' AND last_used_at < ?1",
            )?;
            stmt.query_map(params![cutoff], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for id in &doomed {
            tx.execute("DELETE FROM sessions WHERE session_id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(doomed)
    }

    /// All distinct workspace keys currently represented in the ledger.
    /// Used by the trash sweep in step 8 to enumerate workspace dirs.
    pub fn distinct_workspaces(&self) -> Result<Vec<String>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt =
            conn.prepare("SELECT DISTINCT workspace_key FROM sessions ORDER BY workspace_key")?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(names)
    }

    // ── turns table ──────────────────────────────────────────────────────────
    //
    // These methods are the per-turn write/read surface. The supervisor
    // (`agent_supervisor.rs`) calls them from its dispatcher and merger
    // intercepts; tugcode reads through them via cross-process bun:sqlite.
    // All methods are crate-public; callers outside tugcast use the
    // supervisor as the entry point.

    /// Insert a fresh `pending` row keyed on `tug_turn_id`. The ordinal is
    /// computed inside an `IMMEDIATE` transaction so two ledger handles
    /// racing on the same file cannot land the same ordinal — the
    /// transaction takes a `RESERVED` lock that blocks the other writer
    /// until our INSERT commits.
    ///
    /// `user_attachments` is encoded as a JSON array and stored as BLOB.
    /// The empty case (`&[]`) round-trips as `[]`. `claude_message_id`
    /// stays `NULL` until `mark_turn_complete` (or, for cancelled turns,
    /// `mark_turn_interrupted` does not need it because the wire shape
    /// already carries it on `turn_cancelled`).
    pub fn insert_pending_turn(
        &self,
        session_id: &str,
        tug_turn_id: &str,
        user_text: &str,
        user_attachments: &[serde_json::Value],
        now: i64,
    ) -> Result<(), LedgerError> {
        let attachments_blob = serde_json::to_vec(user_attachments)?;
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let next_ordinal: i64 = tx.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM turns WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO turns (
                tug_turn_id, session_id, ordinal, claude_message_id,
                user_text, user_attachments, state, partial_text,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'pending', NULL, ?6, NULL)",
            params![
                tug_turn_id,
                session_id,
                next_ordinal,
                user_text,
                attachments_blob,
                now,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Transition a `pending` row to `complete`, recording the matched
    /// `claude_message_id` and `completed_at`. Returns `NotFound` if the
    /// row doesn't exist; `InvalidTurnState` if the row is already
    /// `complete` or `interrupted` (defensive — a duplicate `turn_complete`
    /// upstream is a bug, not a no-op).
    pub fn mark_turn_complete(
        &self,
        tug_turn_id: &str,
        claude_message_id: &str,
        completed_at: i64,
    ) -> Result<(), LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current_state: Option<String> = tx
            .query_row(
                "SELECT state FROM turns WHERE tug_turn_id = ?1",
                params![tug_turn_id],
                |row| row.get(0),
            )
            .optional()?;
        match current_state {
            None => return Err(LedgerError::NotFound(tug_turn_id.to_owned())),
            Some(s) if s == TurnState::Pending.as_str() => {}
            Some(other) => return Err(LedgerError::InvalidTurnState(other)),
        }
        tx.execute(
            "UPDATE turns
             SET state = 'complete',
                 claude_message_id = ?2,
                 completed_at = ?3
             WHERE tug_turn_id = ?1",
            params![tug_turn_id, claude_message_id, completed_at],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Transition a `pending` row to `interrupted`, capturing whatever
    /// `partial_text` had streamed so far and (when known) claude's
    /// own message id from the cancelled assistant turn. `NotFound` /
    /// `InvalidTurnState` follow the same shape as `mark_turn_complete`.
    ///
    /// `claude_message_id` is `Some` only when the cancel happened
    /// after `message_start` (so the wire-side `turn_cancelled` carries
    /// the id); a `None` here means "no id known yet, leave the row's
    /// existing claude_message_id alone." `COALESCE(?, claude_message_id)`
    /// in the SQL preserves any prior value rather than clobbering it
    /// to NULL.
    pub fn mark_turn_interrupted(
        &self,
        tug_turn_id: &str,
        claude_message_id: Option<&str>,
        partial_text: Option<&str>,
        completed_at: i64,
    ) -> Result<(), LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current_state: Option<String> = tx
            .query_row(
                "SELECT state FROM turns WHERE tug_turn_id = ?1",
                params![tug_turn_id],
                |row| row.get(0),
            )
            .optional()?;
        match current_state {
            None => return Err(LedgerError::NotFound(tug_turn_id.to_owned())),
            Some(s) if s == TurnState::Pending.as_str() => {}
            Some(other) => return Err(LedgerError::InvalidTurnState(other)),
        }
        tx.execute(
            "UPDATE turns
             SET state = 'interrupted',
                 claude_message_id = COALESCE(?2, claude_message_id),
                 partial_text = ?3,
                 completed_at = ?4
             WHERE tug_turn_id = ?1",
            params![tug_turn_id, claude_message_id, partial_text, completed_at],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Snapshot the running `partial_text` for crash recovery. No-op if
    /// the row is missing or no longer `pending` — the snapshot is best-
    /// effort and the terminal `mark_turn_complete` /
    /// `mark_turn_interrupted` writes the authoritative value. Idempotent
    /// re-writes with the same value are fine.
    pub fn record_partial_text(
        &self,
        tug_turn_id: &str,
        partial_text: &str,
    ) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "UPDATE turns
             SET partial_text = ?2
             WHERE tug_turn_id = ?1 AND state = 'pending'",
            params![tug_turn_id, partial_text],
        )?;
        Ok(())
    }

    /// All turns for `session_id`, ordered ascending by `ordinal`. This is
    /// the read surface tugcode's `runReplay` consumes to rebuild the
    /// transcript on cold-boot.
    pub fn list_turns_for_session(&self, session_id: &str) -> Result<Vec<TurnRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT tug_turn_id, session_id, ordinal, claude_message_id,
                    user_text, user_attachments, state, partial_text,
                    created_at, completed_at
             FROM turns
             WHERE session_id = ?1
             ORDER BY ordinal ASC",
        )?;
        let rows = stmt
            .query_map(params![session_id], turn_row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    }

    /// Single-row lookup by `tug_turn_id`.
    pub fn get_turn(&self, tug_turn_id: &str) -> Result<Option<TurnRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT tug_turn_id, session_id, ordinal, claude_message_id,
                    user_text, user_attachments, state, partial_text,
                    created_at, completed_at
             FROM turns
             WHERE tug_turn_id = ?1
             LIMIT 1",
        )?;
        let row = stmt
            .query_row(params![tug_turn_id], turn_row_from_query)
            .optional()?;
        match row {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    /// One-time JSONL → ledger migration for sessions that pre-date
    /// the `turns` table. Walks the on-disk JSONL via the minimal
    /// `jsonl_reader` parser, mints a fresh `tug_turn_id` per
    /// historical turn, and bulk-inserts rows in a single immediate
    /// transaction. Returns the number of rows inserted (`0` for no-op
    /// paths: already-bootstrapped, missing JSONL, empty JSONL).
    ///
    /// **Idempotency** is gated by [`Self::list_turns_for_session`]:
    /// any rows already present for the session short-circuit the
    /// function with `Ok(0)`. Bootstrap is "all or nothing" — a
    /// partial bootstrap shouldn't happen, so the whole-session gate
    /// avoids the trap of "skip by `claude_message_id`" (which can't
    /// disambiguate mid-turn entries that are still `null`-id at
    /// bootstrap time). Live tugcode that's already inserting rows
    /// for this session via `dispatch_one` (Step 4.3) takes
    /// precedence — bootstrap won't try to re-create those.
    ///
    /// Per-row state mapping:
    ///   - JSONL turn closed by `stop_reason: "end_turn"` →
    ///     [`TurnState::Complete`] with `claude_message_id` set from
    ///     the terminal assistant entry's `message.id`.
    ///   - JSONL trailing turn at EOF (no terminal) →
    ///     [`TurnState::Interrupted`] with `claude_message_id` from
    ///     the latest assistant entry seen for the turn (or `NULL` if
    ///     no assistant content reached the JSONL before the
    ///     truncation). `partial_text` stays `NULL` — the historical
    ///     content is still in the JSONL and `runReplay` will pick it
    ///     up via `extractTurnContent` keyed on `claude_message_id`.
    ///
    /// `completed_at` is set to `now` for every row so the migration
    /// timestamp reflects "row inserted by bootstrap" rather than
    /// stamping the historical conversation time (which we don't
    /// have to millisecond accuracy and which the picker doesn't read
    /// from this column anyway).
    ///
    /// JSONL path: `<claude_projects_root>/<encode(project_dir)>/<session_id>.jsonl`.
    /// Missing file → `Ok(0)` with a tracing line; malformed lines
    /// inside the JSONL are silently skipped by the parser (same
    /// permissiveness the TS translator uses on the live path).
    pub fn bootstrap_turns_from_jsonl(
        &self,
        session_id: &str,
        project_dir: &str,
        now: i64,
    ) -> Result<usize, LedgerError> {
        // Whole-session idempotency gate.
        if !self.list_turns_for_session(session_id)?.is_empty() {
            return Ok(0);
        }

        // Resolve `project_dir` to the same user-facing form that
        // claude code's `getcwd()` (and Node's `fs.realpath`, which
        // tugcode's TS-side `runReplay` uses) produces. The on-disk
        // JSONL lives under the encoded form of THAT path — matching
        // it is the load-bearing requirement for bootstrap to find
        // the file. Two ways the raw `project_dir` can differ from
        // claude's view:
        //
        //   1. **Symlink in the path** (e.g. user-managed
        //      `/u/src/tugtool` → `/Users/<u>/Mounts/u/src/tugtool`).
        //      Claude resolves the symlink; tugcast must too.
        //   2. **macOS APFS firmlink** (`/Users` ↔
        //      `/System/Volumes/Data/Users`). Claude / Node /
        //      `getcwd()` stop at the user-facing `/Users/...` form;
        //      Rust's `std::fs::canonicalize` traverses through to
        //      `/System/Volumes/Data/Users/...`. Strip the firmlink
        //      prefix so the encoding matches what's on disk.
        //
        // Without (1), bootstrap silently no-ops on every dev machine
        // that uses a symlinked project path. Without (2), bootstrap
        // looks under `-System-Volumes-Data-Users-...` while the
        // JSONL is at `-Users-...` — same silent miss, just with a
        // different wrong path. Falls back to raw `project_dir` if
        // canonicalize fails (deleted directory / fixture); the
        // downstream `read_to_string` reports `NotFound` and
        // bootstrap no-ops cleanly.
        let canonical_project_dir = canonical_project_dir_for_jsonl(project_dir);
        let encoded = encode_claude_project_name(&canonical_project_dir);
        let jsonl_path = self
            .claude_projects_root
            .join(encoded)
            .join(format!("{session_id}.jsonl"));

        let jsonl = match std::fs::read_to_string(&jsonl_path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tracing::info!(
                    target: "tide::ledger",
                    event = "bootstrap_jsonl_missing",
                    session_id,
                    project_dir,
                    canonical_project_dir = canonical_project_dir.as_str(),
                    path = %jsonl_path.display(),
                );
                return Ok(0);
            }
            Err(e) => return Err(LedgerError::Io(e)),
        };

        let parsed = crate::jsonl_reader::parse_turns_from_jsonl(&jsonl);
        if parsed.is_empty() {
            return Ok(0);
        }

        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let inserted = parsed.len();
        for (ordinal, turn) in parsed.iter().enumerate() {
            let tug_turn_id = uuid::Uuid::new_v4().to_string();
            let attachments_blob = serde_json::to_vec(&turn.user_attachments)?;
            let state_str = match turn.state {
                crate::jsonl_reader::ParsedTurnState::Complete => "complete",
                crate::jsonl_reader::ParsedTurnState::Interrupted => "interrupted",
            };
            tx.execute(
                "INSERT INTO turns (
                    tug_turn_id, session_id, ordinal, claude_message_id,
                    user_text, user_attachments, state, partial_text,
                    created_at, completed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?8)",
                params![
                    tug_turn_id,
                    session_id,
                    ordinal as i64,
                    turn.claude_message_id,
                    turn.user_text,
                    attachments_blob,
                    state_str,
                    now,
                ],
            )?;
        }
        tx.commit()?;

        tracing::info!(
            target: "tide::ledger",
            event = "bootstrap",
            session_id,
            project_dir,
            count = inserted,
        );

        Ok(inserted)
    }

    /// Reconcile every `pending` row owned by `session_id` to
    /// `interrupted`. Used by the supervisor's spawn-worker hook
    /// (mid-turn-replay step 4.7) just before launching a fresh
    /// tugcode subprocess for a session whose previous tugcode is
    /// gone — any rows still in `pending` at that moment are orphans
    /// from the prior tugcode (clean exit before claude responded, or
    /// crash mid-stream). Marking them `interrupted` lets the
    /// next `runReplay` surface them as `turn_cancelled` rather than
    /// leaving them stuck in a stale `pending` state forever.
    ///
    /// Policy: `partial_text` is left as `NULL` (we don't have the
    /// streamed content; only the row's `user_text` survives), and
    /// `claude_message_id` is preserved (`COALESCE`) — if a future
    /// crash-recovery snapshot path populates it before this call
    /// runs, we keep the value for the next run's JSONL lookup.
    /// `completed_at` is set to `now` so the cancel timestamp
    /// reflects when the supervisor reconciled, not when the original
    /// turn started.
    ///
    /// Returns the `tug_turn_id`s of every reconciled row so the
    /// caller can emit telemetry (one warn line per orphan in
    /// production helps surface tugcode-crash patterns). Wraps the
    /// SELECT-then-UPDATE in an immediate transaction so a concurrent
    /// `mark_turn_complete` on the same row can't race the
    /// reconciliation; whichever wins commits its full state
    /// transition.
    pub fn reconcile_pending_for_session(
        &self,
        session_id: &str,
        now: i64,
    ) -> Result<Vec<String>, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let pending_ids: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT tug_turn_id FROM turns
                 WHERE session_id = ?1 AND state = 'pending'
                 ORDER BY ordinal ASC",
            )?;
            stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        if pending_ids.is_empty() {
            tx.commit()?;
            return Ok(Vec::new());
        }
        // Bulk UPDATE — every pending row owned by this session goes
        // to interrupted. partial_text stays NULL (we have no content);
        // claude_message_id preserved via COALESCE if it was set.
        tx.execute(
            "UPDATE turns
             SET state = 'interrupted',
                 completed_at = ?2
             WHERE session_id = ?1 AND state = 'pending'",
            params![session_id, now],
        )?;
        tx.commit()?;
        Ok(pending_ids)
    }

    /// Lookup by claude's message id. Used by the JSONL-bootstrap
    /// migration in 4.8 ("did we already mint a tug_turn_id for this
    /// claude_message_id?") and by replay in 4.6 to back-reference partial
    /// content stored in the JSONL. If multiple rows somehow share a
    /// `claude_message_id` (legacy data, JSONL replay edge case), the
    /// row with the highest `ordinal` wins.
    pub fn get_turn_by_claude_message_id(
        &self,
        claude_message_id: &str,
    ) -> Result<Option<TurnRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT tug_turn_id, session_id, ordinal, claude_message_id,
                    user_text, user_attachments, state, partial_text,
                    created_at, completed_at
             FROM turns
             WHERE claude_message_id = ?1
             ORDER BY ordinal DESC
             LIMIT 1",
        )?;
        let row = stmt
            .query_row(params![claude_message_id], turn_row_from_query)
            .optional()?;
        match row {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }
}

/// Decode one row from a `SELECT … FROM sessions` cursor matching the column
/// order documented inline at every callsite. The closure type makes
/// `query_map` happy: it returns `rusqlite::Result<Result<SessionRow, LedgerError>>`
/// so the outer collector can flatten with `?`.
fn row_from_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<SessionRow, LedgerError>> {
    let session_id: String = row.get(0)?;
    let workspace_key: String = row.get(1)?;
    let project_dir: String = row.get(2)?;
    let created_at: i64 = row.get(3)?;
    let last_used_at: i64 = row.get(4)?;
    let turn_count: i64 = row.get(5)?;
    let first_user_prompt: Option<String> = row.get(6)?;
    let state_str: String = row.get(7)?;
    let card_id_live: Option<String> = row.get(8)?;
    let state = match state_str.parse::<SessionState>() {
        Ok(s) => s,
        Err(e) => return Ok(Err(e)),
    };
    Ok(Ok(SessionRow {
        session_id,
        workspace_key,
        project_dir,
        created_at,
        last_used_at,
        turn_count,
        first_user_prompt,
        state,
        card_id_live,
    }))
}

/// Decode one row from a `SELECT … FROM turns` cursor matching the column
/// order documented inline at every callsite. Same closure type as
/// `row_from_query`: returns `rusqlite::Result<Result<TurnRow,
/// LedgerError>>` so callers can distinguish row-decode errors (state
/// string parse, BLOB JSON parse) from sqlite-level errors and surface
/// them through `LedgerError`.
fn turn_row_from_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<TurnRow, LedgerError>> {
    let tug_turn_id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let ordinal: i64 = row.get(2)?;
    let claude_message_id: Option<String> = row.get(3)?;
    let user_text: String = row.get(4)?;
    let attachments_blob: Vec<u8> = row.get(5)?;
    let state_str: String = row.get(6)?;
    let partial_text: Option<String> = row.get(7)?;
    let created_at: i64 = row.get(8)?;
    let completed_at: Option<i64> = row.get(9)?;
    let user_attachments: Vec<serde_json::Value> = match serde_json::from_slice(&attachments_blob) {
        Ok(v) => v,
        Err(e) => return Ok(Err(LedgerError::Serde(e))),
    };
    let state = match state_str.parse::<TurnState>() {
        Ok(s) => s,
        Err(e) => return Ok(Err(e)),
    };
    Ok(Ok(TurnRow {
        tug_turn_id,
        session_id,
        ordinal,
        claude_message_id,
        user_text,
        user_attachments,
        state,
        partial_text,
        created_at,
        completed_at,
    }))
}

/// Truncate a first-user-prompt to at most `FIRST_USER_PROMPT_MAX_CHARS`
/// chars (Unicode-scalar count, not bytes). Cheap helper for callers that
/// want to forward the user's first message into `record_first_prompt`.
pub fn truncate_first_prompt(prompt: &str) -> String {
    if prompt.chars().count() <= FIRST_USER_PROMPT_MAX_CHARS {
        return prompt.to_owned();
    }
    prompt.chars().take(FIRST_USER_PROMPT_MAX_CHARS).collect()
}

/// Current wall-clock time in unix milliseconds. Returns 0 if the system
/// clock is set before 1970, which doesn't happen on machines we run on.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Default location of claude code's per-project session JSONLs:
/// `~/.claude/projects/`. Production callers pass this to
/// `SessionLedger::open_with_claude_root` (or rely on `open` which
/// resolves it implicitly).
pub fn default_claude_projects_root() -> PathBuf {
    let home = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()));
    home.join(".claude").join("projects")
}

/// Resolve `project_dir` to the user-facing form claude itself uses
/// when writing JSONLs (and that tugcode's `runReplay` uses when
/// reading them). Two transformations:
///
///   1. Resolve symlinks via `std::fs::canonicalize`. A user-typed
///      path like `/u/src/tugtool` (symlink) becomes the realpath of
///      the symlink target.
///   2. Strip the macOS APFS firmlink prefix (`/System/Volumes/Data`)
///      if present. macOS firmlinks set up `/Users` to be
///      bidirectionally accessible at `/System/Volumes/Data/Users`,
///      and Rust's `canonicalize` (via `realpath(3)`) traverses
///      through to the latter. Claude code's `getcwd()` and Node's
///      `fs.realpath` both stop at `/Users/...` — that's the form
///      claude writes its on-disk path encoding under, and the form
///      tugcode resolves to in `runReplay`'s `realpath` step. Strip
///      the prefix so tugcast's encoding matches what's on disk.
///
/// Falls back to the raw input on canonicalize failure (deleted
/// directory, fixture path that doesn't exist) — downstream callers
/// then see a `NotFound` from the I/O attempt and treat it as a
/// no-op.
pub fn canonical_project_dir_for_jsonl(project_dir: &str) -> String {
    let canonical = match std::fs::canonicalize(project_dir) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => return project_dir.to_owned(),
    };
    // macOS firmlink workaround. The "/System/Volumes/Data" prefix
    // alone is not a valid path; require a trailing slash + content
    // before stripping.
    if let Some(stripped) = canonical.strip_prefix("/System/Volumes/Data")
        && stripped.starts_with('/')
    {
        return stripped.to_owned();
    }
    canonical
}

/// Encode a project_dir into the directory name claude code uses under
/// `~/.claude/projects/`. claude's convention replaces `/` and `.` in the
/// absolute path with `-`, producing a flat name that's filesystem-safe
/// and hashable. Mirrors what's been observed on macOS installs.
pub fn encode_claude_project_name(project_dir: &str) -> String {
    project_dir
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

/// Move `<root>/<encoded>/<sessionId>.jsonl` to
/// `<root>/<encoded>/.tug-trash/<deletedAt>/<sessionId>.jsonl`. Best-
/// effort: returns the destination path on success or `None` if the
/// source file is missing or the move fails. Logs at warn-level on
/// error but never propagates — the row deletion that motivates this
/// move has already committed and shouldn't roll back over a filesystem
/// hiccup.
fn move_jsonl_to_trash(
    claude_projects_root: &Path,
    project_dir: &str,
    session_id: &str,
    deleted_at_ms: i64,
) -> Option<PathBuf> {
    let encoded = encode_claude_project_name(project_dir);
    let project_root = claude_projects_root.join(&encoded);
    let source = project_root.join(format!("{session_id}.jsonl"));
    if !source.exists() {
        // Nothing to move — the JSONL was never created or already
        // disappeared. Not an error; the row was the last reference.
        return None;
    }
    let trash_dir = project_root
        .join(".tug-trash")
        .join(deleted_at_ms.to_string());
    if let Err(err) = std::fs::create_dir_all(&trash_dir) {
        tracing::warn!(
            error = %err,
            session_id,
            project_dir,
            trash_dir = %trash_dir.display(),
            "failed to create trash dir; leaving JSONL in place",
        );
        return None;
    }
    let dest = trash_dir.join(format!("{session_id}.jsonl"));
    if let Err(err) = std::fs::rename(&source, &dest) {
        tracing::warn!(
            error = %err,
            session_id,
            project_dir,
            dest = %dest.display(),
            "failed to move JSONL to trash; leaving in place",
        );
        return None;
    }
    tracing::info!(
        target: "tide::session-lifecycle",
        event = "ledger.trash_jsonl",
        session_id,
        project_dir,
        dest = %dest.display(),
    );
    Some(dest)
}

/// Walk `<trash_root>/*/` and remove any subdirectory whose name (a
/// `<deletedAt>` unix-millis stamp) is older than `cutoff`. Returns the
/// count of removed subdirs. Best-effort: missing root, missing entries,
/// or rmdir failures are logged but never propagated.
fn sweep_trash_dir(trash_root: &Path, cutoff: i64) -> usize {
    let entries = match std::fs::read_dir(trash_root) {
        Ok(it) => it,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return 0,
        Err(err) => {
            tracing::warn!(
                error = %err,
                trash_root = %trash_root.display(),
                "sweep_trash_dir read_dir failed",
            );
            return 0;
        }
    };
    let mut count = 0usize;
    for entry_result in entries {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = match entry.file_name().to_str().map(|s| s.to_owned()) {
            Some(n) => n,
            None => continue,
        };
        let stamp: i64 = match name.parse() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if stamp >= cutoff {
            continue;
        }
        let path = entry.path();
        if let Err(err) = std::fs::remove_dir_all(&path) {
            tracing::warn!(
                error = %err,
                path = %path.display(),
                "sweep_trash remove_dir_all failed",
            );
            continue;
        }
        count += 1;
        tracing::info!(
            target: "tide::session-lifecycle",
            event = "ledger.trash_swept",
            path = %path.display(),
            stamp_ms = stamp,
        );
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    const WS_A: &str = "ws-alpha";
    const WS_B: &str = "ws-beta";

    fn millis(days_ago: i64) -> i64 {
        let now = 1_700_000_000_000_i64;
        now - days_ago * 86_400_000
    }

    fn fresh() -> SessionLedger {
        SessionLedger::open_in_memory().expect("open in-memory ledger")
    }

    fn seed_live(ledger: &SessionLedger, id: &str, ws: &str, card: &str, now: i64) {
        ledger
            .record_spawn(id, ws, "/proj", card, now)
            .expect("record_spawn");
    }

    // ── CRUD round-trip per state transition ─────────────────────────────────

    #[test]
    fn record_spawn_inserts_live_row() {
        let l = fresh();
        let now = millis(0);
        l.record_spawn("s1", WS_A, "/proj/alpha", "card-1", now)
            .unwrap();

        let row = l.get("s1").unwrap().expect("row exists");
        assert_eq!(row.session_id, "s1");
        assert_eq!(row.workspace_key, WS_A);
        assert_eq!(row.project_dir, "/proj/alpha");
        assert_eq!(row.created_at, now);
        assert_eq!(row.last_used_at, now);
        assert_eq!(row.turn_count, 0);
        assert_eq!(row.first_user_prompt, None);
        assert_eq!(row.state, SessionState::Live);
        assert_eq!(row.card_id_live.as_deref(), Some("card-1"));
    }

    #[test]
    fn record_first_prompt_sets_only_when_null() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.record_first_prompt("s1", "Hello, world").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.first_user_prompt.as_deref(), Some("Hello, world"));

        // Second call leaves the snippet untouched (we want the first prompt
        // to survive resumes, not be overwritten by a later turn).
        l.record_first_prompt("s1", "Different prompt").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.first_user_prompt.as_deref(), Some("Hello, world"));
    }

    #[test]
    fn record_first_prompt_missing_session_errors() {
        let l = fresh();
        let err = l.record_first_prompt("nope", "Hi").unwrap_err();
        assert!(matches!(err, LedgerError::NotFound(ref id) if id == "nope"));
    }

    #[test]
    fn record_turn_increments_count_and_updates_last_used() {
        let l = fresh();
        let t0 = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", t0);

        let t1 = t0 + 1_000;
        l.record_turn("s1", t1).unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.turn_count, 1);
        assert_eq!(r.last_used_at, t1);

        let t2 = t0 + 2_000;
        l.record_turn("s1", t2).unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.turn_count, 2);
        assert_eq!(r.last_used_at, t2);
    }

    #[test]
    fn record_turn_no_op_on_closed_row() {
        let l = fresh();
        let t0 = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", t0);
        l.mark_closed("s1").unwrap();

        // A late turn write must not resurrect the row.
        l.record_turn("s1", t0 + 1_000).unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.turn_count, 0);
        assert_eq!(r.state, SessionState::Closed);
    }

    #[test]
    fn mark_closed_clears_card_binding() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Closed);
        assert_eq!(r.card_id_live, None);
    }

    #[test]
    fn mark_failed_retains_row_and_clears_binding() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.mark_failed("s1").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Failed);
        assert_eq!(r.card_id_live, None);
    }

    #[test]
    fn record_spawn_preserves_created_at_on_resume() {
        let l = fresh();
        let t0 = millis(2);
        seed_live(&l, "s1", WS_A, "card-1", t0);
        l.mark_closed("s1").unwrap();

        let t1 = millis(0);
        l.record_spawn("s1", WS_A, "/proj/alpha", "card-2", t1)
            .unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.created_at, t0, "created_at must survive resume");
        assert_eq!(r.last_used_at, t1);
        assert_eq!(r.state, SessionState::Live);
        assert_eq!(r.card_id_live.as_deref(), Some("card-2"));
    }

    // ── list_for_workspace ───────────────────────────────────────────────────

    #[test]
    fn list_for_workspace_orders_newest_first() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c1", millis(3));
        seed_live(&l, "s2", WS_A, "c2", millis(1));
        seed_live(&l, "s3", WS_A, "c3", millis(2));
        seed_live(&l, "other", WS_B, "cb", millis(0));

        let rows = l.list_for_workspace(WS_A).unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s2", "s3", "s1"]);
    }

    // ── forget ───────────────────────────────────────────────────────────────

    #[test]
    fn forget_removes_closed_row() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c1", millis(0));
        l.mark_closed("s1").unwrap();

        let outcome = l.forget("s1").unwrap();
        assert_eq!(outcome.session_id, "s1");
        assert_eq!(outcome.jsonl_moved_to, None);
        assert!(l.get("s1").unwrap().is_none());
    }

    #[test]
    fn forget_refuses_live_row() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c1", millis(0));
        let err = l.forget("s1").unwrap_err();
        assert!(matches!(err, LedgerError::InvalidState(_)));
        assert!(l.get("s1").unwrap().is_some(), "row must remain");
    }

    #[test]
    fn forget_missing_session_errors() {
        let l = fresh();
        let err = l.forget("nope").unwrap_err();
        assert!(matches!(err, LedgerError::NotFound(ref id) if id == "nope"));
    }

    // ── eviction ─────────────────────────────────────────────────────────────

    #[test]
    fn evict_oldest_closed_no_op_under_cap() {
        let l = fresh();
        for i in 0..5 {
            let id = format!("s{i}");
            seed_live(&l, &id, WS_A, "c", millis(i));
            l.mark_closed(&id).unwrap();
        }
        assert_eq!(l.evict_oldest_closed(WS_A, 20).unwrap().len(), 0);
        assert_eq!(l.list_for_workspace(WS_A).unwrap().len(), 5);
    }

    #[test]
    fn evict_oldest_closed_removes_oldest_when_at_cap_plus_one() {
        let l = fresh();
        // Insert 21 closed rows: s0 oldest (millis(20)) → s20 newest (millis(0))
        for i in 0..21 {
            let id = format!("s{i}");
            seed_live(&l, &id, WS_A, "c", millis(20 - i));
            l.mark_closed(&id).unwrap();
        }
        // Sanity: 21 rows.
        assert_eq!(l.list_for_workspace(WS_A).unwrap().len(), 21);

        let evicted = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        assert_eq!(evicted, vec!["s0".to_owned()]);
        // s0 was oldest; should be gone.
        assert!(l.get("s0").unwrap().is_none());
        // The cap is exact afterwards.
        assert_eq!(l.list_for_workspace(WS_A).unwrap().len(), 20);
    }

    #[test]
    fn evict_oldest_closed_never_targets_live_rows() {
        let l = fresh();
        // 19 live rows + 2 closed, both older than the live ones.
        for i in 0..19 {
            let id = format!("live{i}");
            seed_live(&l, &id, WS_A, "c", millis(0));
        }
        seed_live(&l, "closed0", WS_A, "c", millis(20));
        l.mark_closed("closed0").unwrap();
        seed_live(&l, "closed1", WS_A, "c", millis(15));
        l.mark_closed("closed1").unwrap();
        assert_eq!(l.list_for_workspace(WS_A).unwrap().len(), 21);

        let evicted = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        // Only the non-live count crossed the cap (2 non-live > 20 cap is
        // false, so eviction is a no-op). The plan's intent is "cap on
        // non-live rows so live rows are never the eviction target". The
        // eviction never touches live rows; with only 2 non-live, nothing
        // gets evicted.
        assert!(evicted.is_empty());
    }

    #[test]
    fn evict_oldest_closed_caps_non_live_count() {
        let l = fresh();
        // 21 closed rows + 5 live rows.
        for i in 0..21 {
            let id = format!("c{i}");
            seed_live(&l, &id, WS_A, "c", millis(40 - i));
            l.mark_closed(&id).unwrap();
        }
        for i in 0..5 {
            let id = format!("live{i}");
            seed_live(&l, &id, WS_A, "c", millis(0));
        }

        let evicted = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        assert_eq!(evicted, vec!["c0".to_owned()]);
        assert!(l.get("c0").unwrap().is_none(), "oldest closed evicted");
        for i in 0..5 {
            assert!(
                l.get(&format!("live{i}")).unwrap().is_some(),
                "live{i} must survive"
            );
        }
    }

    // ── sweep_expired ────────────────────────────────────────────────────────

    #[test]
    fn sweep_expired_removes_stale_non_live_rows() {
        let l = fresh();
        let now = millis(0);
        let max_age_ms = TIDE_LEDGER_MAX_AGE_DAYS * 86_400_000;

        // 91-day-old closed row — should be swept.
        seed_live(&l, "old", WS_A, "c", millis(91));
        l.mark_closed("old").unwrap();
        // 89-day-old closed row — survives.
        seed_live(&l, "fresh", WS_A, "c", millis(89));
        l.mark_closed("fresh").unwrap();

        let swept = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(swept, vec!["old".to_owned()]);
        assert!(l.get("old").unwrap().is_none());
        assert!(l.get("fresh").unwrap().is_some());
    }

    #[test]
    fn sweep_expired_leaves_live_rows_untouched() {
        let l = fresh();
        let now = millis(0);
        let max_age_ms = TIDE_LEDGER_MAX_AGE_DAYS * 86_400_000;

        // Live row with a stale `last_used_at` (e.g., a card pinned open for
        // months). Sweep must not touch it.
        seed_live(&l, "pinned", WS_A, "card-pin", millis(200));
        let swept = l.sweep_expired(max_age_ms, now).unwrap();
        assert!(swept.is_empty());
        let r = l.get("pinned").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Live);
    }

    #[test]
    fn sweep_expired_removes_failed_rows_too() {
        let l = fresh();
        let now = millis(0);
        let max_age_ms = TIDE_LEDGER_MAX_AGE_DAYS * 86_400_000;

        seed_live(&l, "stale", WS_A, "c", millis(120));
        l.mark_failed("stale").unwrap();

        let swept = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(swept, vec!["stale".to_owned()]);
        assert!(l.get("stale").unwrap().is_none());
    }

    // ── forget_for_project_dir ───────────────────────────────────────────────

    #[test]
    fn forget_for_project_dir_drops_matching_rows_only() {
        let l = fresh();
        seed_live(&l, "matched-1", WS_A, "c", millis(0));
        l.mark_closed("matched-1").unwrap();
        seed_live(&l, "matched-2", WS_A, "c", millis(0));
        l.mark_failed("matched-2").unwrap();
        // Live match — survives (we don't reach into a card that's still open).
        seed_live(&l, "matched-live", WS_A, "card-x", millis(0));
        // Different project_dir — also survives.
        ledger_helper_record(&l, "other", WS_A, "/other/path", "c", millis(0));
        l.mark_closed("other").unwrap();

        let dropped = l.forget_for_project_dir("/proj").unwrap();
        let mut sorted = dropped.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["matched-1".to_owned(), "matched-2".to_owned()]);
        assert!(l.get("matched-1").unwrap().is_none());
        assert!(l.get("matched-2").unwrap().is_none());
        assert!(l.get("matched-live").unwrap().is_some());
        assert!(l.get("other").unwrap().is_some());
    }

    fn ledger_helper_record(
        ledger: &SessionLedger,
        id: &str,
        ws: &str,
        project_dir: &str,
        card: &str,
        now: i64,
    ) {
        ledger
            .record_spawn(id, ws, project_dir, card, now)
            .expect("record_spawn");
    }

    // ── demote_live_to_closed ────────────────────────────────────────────────

    #[test]
    fn demote_live_to_closed_transitions_only_live_rows() {
        let l = fresh();
        seed_live(&l, "live1", WS_A, "c1", millis(0));
        seed_live(&l, "live2", WS_A, "c2", millis(0));
        seed_live(&l, "closed1", WS_A, "c3", millis(1));
        l.mark_closed("closed1").unwrap();
        seed_live(&l, "failed1", WS_A, "c4", millis(2));
        l.mark_failed("failed1").unwrap();

        let demoted = l.demote_live_to_closed().unwrap();
        assert_eq!(demoted, 2);

        let r = l.get("live1").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Closed);
        assert_eq!(r.card_id_live, None);

        let r = l.get("live2").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Closed);
        assert_eq!(r.card_id_live, None);

        // Already-closed and failed rows untouched.
        assert_eq!(
            l.get("closed1").unwrap().unwrap().state,
            SessionState::Closed
        );
        assert_eq!(
            l.get("failed1").unwrap().unwrap().state,
            SessionState::Failed
        );
    }

    #[test]
    fn demote_live_to_closed_no_op_when_no_live_rows() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c", millis(0));
        l.mark_closed("s1").unwrap();
        assert_eq!(l.demote_live_to_closed().unwrap(), 0);
    }

    // ── idempotent open ──────────────────────────────────────────────────────

    #[test]
    fn open_existing_file_is_idempotent() {
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();
        // First open seeds the schema.
        let l1 = SessionLedger::open(&path).unwrap();
        l1.record_spawn("s1", WS_A, "/proj", "c1", millis(0))
            .unwrap();
        drop(l1);
        // Second open re-runs the idempotent DDL and finds the row intact.
        let l2 = SessionLedger::open(&path).unwrap();
        let r = l2.get("s1").unwrap().expect("row survives reopen");
        assert_eq!(r.session_id, "s1");
    }

    #[test]
    fn distinct_workspaces_returns_unique_keys_sorted() {
        let l = fresh();
        seed_live(&l, "a1", WS_A, "c", millis(0));
        seed_live(&l, "a2", WS_A, "c", millis(1));
        seed_live(&l, "b1", WS_B, "c", millis(0));

        let ws = l.distinct_workspaces().unwrap();
        assert_eq!(ws, vec![WS_A.to_owned(), WS_B.to_owned()]);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    #[test]
    fn truncate_first_prompt_truncates_at_char_count_not_bytes() {
        // A multi-byte char repeated past the limit must not be sliced
        // mid-codepoint (`String::truncate` would panic; chars().take is
        // safe).
        let s: String = "🌊".repeat(FIRST_USER_PROMPT_MAX_CHARS + 5);
        let out = truncate_first_prompt(&s);
        assert_eq!(out.chars().count(), FIRST_USER_PROMPT_MAX_CHARS);
    }

    #[test]
    fn truncate_first_prompt_returns_short_inputs_unchanged() {
        let s = "Hello, world";
        assert_eq!(truncate_first_prompt(s), s);
    }

    #[test]
    fn encode_claude_project_name_replaces_slashes_and_dots() {
        assert_eq!(
            encode_claude_project_name("/Users/ken/src/foo.bar"),
            "-Users-ken-src-foo-bar"
        );
        assert_eq!(
            encode_claude_project_name("/u/src/tugtool"),
            "-u-src-tugtool"
        );
    }

    // ── trash mechanics (move + sweep) ───────────────────────────────────────
    //
    // Trash tests use a tempdir as the claude-projects-root so the move
    // operations don't touch `~/.claude/projects/` on the dev machine.

    fn fresh_ledger_with_root(root: &Path) -> SessionLedger {
        // Use an in-memory db but explicit claude root.
        let conn = Connection::open_in_memory().expect("open_in_memory");
        SessionLedger::configure(&conn).expect("configure");
        SessionLedger {
            db: Mutex::new(conn),
            claude_projects_root: root.to_path_buf(),
        }
    }

    fn write_jsonl(root: &Path, project_dir: &str, session_id: &str) -> PathBuf {
        let encoded = encode_claude_project_name(project_dir);
        let project_root = root.join(encoded);
        std::fs::create_dir_all(&project_root).expect("mkdir project root");
        let path = project_root.join(format!("{session_id}.jsonl"));
        std::fs::write(&path, b"{\"type\":\"placeholder\"}\n").expect("write jsonl");
        path
    }

    #[test]
    fn forget_moves_jsonl_to_trash() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        write_jsonl(tmp.path(), "/proj/x", "sess-doomed");

        l.record_spawn("sess-doomed", "ws-1", "/proj/x", "c1", millis(0))
            .unwrap();
        l.mark_closed("sess-doomed").unwrap();

        let outcome = l.forget("sess-doomed").unwrap();
        let dest = outcome.jsonl_moved_to.expect("moved to trash");
        assert!(dest.exists(), "trashed jsonl should exist at {dest:?}");
        // Source must be gone.
        let original = tmp
            .path()
            .join(encode_claude_project_name("/proj/x"))
            .join("sess-doomed.jsonl");
        assert!(!original.exists());
        // Trash structure: `<encoded>/.tug-trash/<deletedAt>/<sessionId>.jsonl`.
        assert!(dest.to_string_lossy().contains(".tug-trash"));
    }

    #[test]
    fn forget_succeeds_even_when_jsonl_is_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        // No JSONL on disk — only the ledger row.
        l.record_spawn("ghost", "ws-1", "/proj/x", "c1", millis(0))
            .unwrap();
        l.mark_closed("ghost").unwrap();

        let outcome = l.forget("ghost").unwrap();
        assert!(outcome.jsonl_moved_to.is_none());
        // Row deletion still committed.
        assert!(l.get("ghost").unwrap().is_none());
    }

    #[test]
    fn sweep_trash_removes_subdirs_older_than_cutoff() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());

        let trash_root = tmp
            .path()
            .join(encode_claude_project_name("/proj/x"))
            .join(".tug-trash");
        // Create three subdirs: 8 days ago (sweep), 6 days ago (keep),
        // 30 days ago (sweep).
        let now = millis(0);
        let day = 86_400_000_i64;
        let stale_old = now - 30 * day;
        let stale_mid = now - 8 * day;
        let fresh = now - 6 * day;
        for stamp in [stale_old, stale_mid, fresh] {
            let dir = trash_root.join(stamp.to_string());
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("placeholder.jsonl"), b"x").unwrap();
        }

        let removed = l.sweep_trash(7 * day, now);
        assert_eq!(removed, 2, "expected 8d and 30d dirs swept, 6d kept");
        assert!(!trash_root.join(stale_old.to_string()).exists());
        assert!(!trash_root.join(stale_mid.to_string()).exists());
        assert!(trash_root.join(fresh.to_string()).exists());
    }

    #[test]
    fn sweep_trash_no_op_when_root_missing() {
        // Root path does not exist on disk at all.
        let tmp = tempfile::tempdir().expect("tempdir");
        let nonexistent_root = tmp.path().join("does-not-exist");
        let l = fresh_ledger_with_root(&nonexistent_root);
        let removed = l.sweep_trash(7 * 86_400_000, millis(0));
        assert_eq!(removed, 0);
    }

    #[test]
    fn sweep_trash_no_op_when_no_project_dirs_have_trash() {
        // Project dirs exist under the root, but none of them has a
        // `.tug-trash/` subdir. Sweep is a no-op.
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        std::fs::create_dir_all(tmp.path().join("-proj-clean")).unwrap();
        std::fs::create_dir_all(tmp.path().join("-proj-also-clean")).unwrap();
        let removed = l.sweep_trash(7 * 86_400_000, millis(0));
        assert_eq!(removed, 0);
    }

    /// Regression: A4 from the post-ship audit. Trash subdirs must be
    /// swept even when the ledger has no rows referencing the project_dir
    /// — the very path that creates the orphan (Forget every row for a
    /// project) leaves no ledger trace pointing back at the trash dir.
    #[test]
    fn sweep_trash_recovers_orphaned_project_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());

        // Build a trash subdir under a project_dir that the ledger has
        // NO rows for — simulating the post-Forget-everything state.
        let orphan_root = tmp
            .path()
            .join(encode_claude_project_name("/proj/orphan"))
            .join(".tug-trash");
        let now = millis(0);
        let day = 86_400_000_i64;
        let stale = now - 30 * day;
        let stale_dir = orphan_root.join(stale.to_string());
        std::fs::create_dir_all(&stale_dir).unwrap();
        std::fs::write(stale_dir.join("ghost.jsonl"), b"orphan").unwrap();

        // Sanity: the ledger knows nothing about /proj/orphan.
        let workspaces = l.distinct_workspaces().unwrap();
        assert!(!workspaces.contains(&"/proj/orphan".to_owned()));

        // Sweep finds and removes the orphaned dir anyway.
        let removed = l.sweep_trash(7 * day, now);
        assert_eq!(removed, 1);
        assert!(!stale_dir.exists());
    }

    // ── turns table ──────────────────────────────────────────────────────────
    //
    // Schema bootstrap, in-place v1→v2 migration, idempotent re-open,
    // CRUD round-trips per state, ordinal race under concurrent ledger
    // handles on the same file, and a failure-first proof that the
    // race protection is meaningful.

    fn has_table(conn: &Connection, name: &str) -> bool {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                params![name],
                |row| row.get(0),
            )
            .unwrap();
        count == 1
    }

    #[test]
    fn schema_bootstrap_creates_v2_tables_and_marker() {
        let l = fresh();
        let conn = l.db.lock().expect("ledger mutex");
        assert!(has_table(&conn, "sessions"));
        assert!(has_table(&conn, "turns"));
        assert!(has_table(&conn, "migrations"));

        let v: i64 = conn
            .query_row(
                "SELECT version FROM migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(v, 2);

        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn schema_bootstrap_migrates_v1_file_to_v2() {
        // Pin the in-place v1→v2 upgrade path real users on existing
        // ledger files will hit. Hand-build a v1 file (sessions table
        // only, no turns, no migrations), seed a few rows, then open via
        // SessionLedger and verify the new tables appear, the v=2 marker
        // is written, and the existing rows survive unchanged.
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();

        {
            let conn = Connection::open(&path).expect("open v1 file");
            // v1 schema: sessions only.
            conn.execute_batch(
                "
                CREATE TABLE sessions (
                    session_id        TEXT PRIMARY KEY,
                    workspace_key     TEXT NOT NULL,
                    project_dir       TEXT NOT NULL,
                    created_at        INTEGER NOT NULL,
                    last_used_at      INTEGER NOT NULL,
                    turn_count        INTEGER NOT NULL DEFAULT 0,
                    first_user_prompt TEXT,
                    state             TEXT NOT NULL,
                    card_id_live      TEXT
                );
                CREATE INDEX sessions_workspace_recent
                    ON sessions(workspace_key, last_used_at DESC);
                ",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, workspace_key, project_dir,
                    created_at, last_used_at, turn_count,
                    first_user_prompt, state, card_id_live
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    "legacy-1",
                    "ws-old",
                    "/proj/old",
                    1_000_i64,
                    1_000_i64,
                    5_i64,
                    "old prompt",
                    "closed",
                    Option::<String>::None,
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, workspace_key, project_dir,
                    created_at, last_used_at, turn_count,
                    first_user_prompt, state, card_id_live
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    "legacy-2",
                    "ws-old",
                    "/proj/old",
                    2_000_i64,
                    2_000_i64,
                    0_i64,
                    Option::<String>::None,
                    "failed",
                    Option::<String>::None,
                ],
            )
            .unwrap();
        }

        let l = SessionLedger::open(&path).unwrap();

        {
            let conn = l.db.lock().expect("ledger mutex");
            assert!(has_table(&conn, "turns"));
            assert!(has_table(&conn, "migrations"));

            let v: i64 = conn
                .query_row(
                    "SELECT version FROM migrations WHERE version = 2",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(v, 2);

            let total: i64 = conn
                .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
                .unwrap();
            assert_eq!(total, 1);
        }

        let r1 = l.get("legacy-1").unwrap().expect("legacy-1 preserved");
        assert_eq!(r1.workspace_key, "ws-old");
        assert_eq!(r1.project_dir, "/proj/old");
        assert_eq!(r1.turn_count, 5);
        assert_eq!(r1.first_user_prompt.as_deref(), Some("old prompt"));
        assert_eq!(r1.state, SessionState::Closed);

        let r2 = l.get("legacy-2").unwrap().expect("legacy-2 preserved");
        assert_eq!(r2.state, SessionState::Failed);
    }

    #[test]
    fn migrations_marker_idempotent_across_reopens() {
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();

        for _ in 0..3 {
            let l = SessionLedger::open(&path).unwrap();
            drop(l);
        }

        let l = SessionLedger::open(&path).unwrap();
        let conn = l.db.lock().expect("ledger mutex");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            count, 1,
            "INSERT OR IGNORE keeps the v=2 marker singular across re-opens"
        );
        assert!(has_table(&conn, "turns"));
    }

    #[test]
    fn insert_pending_turn_assigns_sequential_per_session_ordinals() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        seed_live(&l, "s2", WS_A, "card-2", now);

        l.insert_pending_turn("s1", "t1", "first", &[], now)
            .unwrap();
        l.insert_pending_turn("s1", "t2", "second", &[], now)
            .unwrap();
        l.insert_pending_turn("s2", "t3", "first-of-s2", &[], now)
            .unwrap();

        let r1 = l.get_turn("t1").unwrap().expect("t1");
        assert_eq!(r1.session_id, "s1");
        assert_eq!(r1.ordinal, 0);
        assert_eq!(r1.state, TurnState::Pending);
        assert_eq!(r1.claude_message_id, None);
        assert_eq!(r1.user_text, "first");
        assert_eq!(r1.partial_text, None);
        assert_eq!(r1.completed_at, None);
        assert!(r1.user_attachments.is_empty());

        let r2 = l.get_turn("t2").unwrap().expect("t2");
        assert_eq!(r2.ordinal, 1);

        // Ordinals are per-session, not global.
        let r3 = l.get_turn("t3").unwrap().expect("t3");
        assert_eq!(r3.session_id, "s2");
        assert_eq!(r3.ordinal, 0);
    }

    #[test]
    fn insert_pending_turn_persists_user_attachments() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        let attachments = vec![
            serde_json::json!({"path": "/tmp/foo.txt", "size": 42}),
            serde_json::json!({"path": "/tmp/bar.png", "kind": "image"}),
        ];
        l.insert_pending_turn("s1", "t1", "with-att", &attachments, now)
            .unwrap();

        let r = l.get_turn("t1").unwrap().expect("t1");
        assert_eq!(r.user_attachments, attachments);
    }

    #[test]
    fn mark_turn_complete_transitions_pending_to_complete() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();

        let completed = now + 5_000;
        l.mark_turn_complete("t1", "msg_abc", completed).unwrap();

        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(r.state, TurnState::Complete);
        assert_eq!(r.claude_message_id.as_deref(), Some("msg_abc"));
        assert_eq!(r.completed_at, Some(completed));
        // user_text and ordinal preserved.
        assert_eq!(r.user_text, "hello");
        assert_eq!(r.ordinal, 0);
    }

    #[test]
    fn mark_turn_complete_on_already_complete_returns_invalid_state() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();
        l.mark_turn_complete("t1", "msg_abc", now + 1_000).unwrap();

        let err = l
            .mark_turn_complete("t1", "msg_def", now + 2_000)
            .unwrap_err();
        assert!(
            matches!(err, LedgerError::InvalidTurnState(ref s) if s == "complete"),
            "expected InvalidTurnState(\"complete\"); got {err:?}",
        );
    }

    #[test]
    fn mark_turn_complete_on_missing_row_returns_not_found() {
        let l = fresh();
        let err = l
            .mark_turn_complete("ghost", "msg_abc", millis(0))
            .unwrap_err();
        assert!(matches!(err, LedgerError::NotFound(ref id) if id == "ghost"));
    }

    #[test]
    fn mark_turn_interrupted_records_partial_text_and_state() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();

        let cancelled_at = now + 3_000;
        l.mark_turn_interrupted(
            "t1",
            Some("msg_01XYZ"),
            Some("partial response..."),
            cancelled_at,
        )
        .unwrap();

        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(r.state, TurnState::Interrupted);
        assert_eq!(r.claude_message_id.as_deref(), Some("msg_01XYZ"));
        assert_eq!(r.partial_text.as_deref(), Some("partial response..."));
        assert_eq!(r.completed_at, Some(cancelled_at));
    }

    #[test]
    fn mark_turn_interrupted_accepts_null_partial_text_and_claude_id() {
        // A cancel before claude streamed `message_start` carries
        // neither claude_message_id nor partial_text. Both are None;
        // the row goes to interrupted, both columns stay NULL.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();

        l.mark_turn_interrupted("t1", None, None, now + 3_000)
            .unwrap();
        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(r.state, TurnState::Interrupted);
        assert_eq!(r.partial_text, None);
        assert_eq!(r.claude_message_id, None);
    }

    #[test]
    fn mark_turn_interrupted_preserves_existing_claude_message_id() {
        // If the row's claude_message_id was set earlier (e.g., a
        // future code path stamps it before cancel), passing None for
        // claude_message_id must NOT clobber it. The COALESCE in the
        // UPDATE preserves the existing value.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();

        // Pre-populate claude_message_id while still pending.
        {
            let conn = l.db.lock().expect("ledger mutex");
            conn.execute(
                "UPDATE turns SET claude_message_id = ?2 WHERE tug_turn_id = ?1",
                params!["t1", "msg_pre"],
            )
            .unwrap();
        }

        l.mark_turn_interrupted("t1", None, Some("partial..."), now + 3_000)
            .unwrap();
        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(
            r.claude_message_id.as_deref(),
            Some("msg_pre"),
            "None must not clobber an existing claude_message_id",
        );
        assert_eq!(r.partial_text.as_deref(), Some("partial..."));
    }

    #[test]
    fn record_partial_text_persists_latest_value() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();

        l.record_partial_text("t1", "first chunk").unwrap();
        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(r.partial_text.as_deref(), Some("first chunk"));

        l.record_partial_text("t1", "first chunk + second chunk")
            .unwrap();
        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(
            r.partial_text.as_deref(),
            Some("first chunk + second chunk")
        );
    }

    #[test]
    fn record_partial_text_no_op_on_non_pending_or_missing() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "t1", "hello", &[], now)
            .unwrap();
        l.mark_turn_complete("t1", "msg_abc", now + 1_000).unwrap();

        // Already complete — must not overwrite partial_text.
        l.record_partial_text("t1", "should-be-ignored").unwrap();
        let r = l.get_turn("t1").unwrap().unwrap();
        assert_eq!(r.partial_text, None);

        // Missing — silent no-op (best-effort snapshot).
        l.record_partial_text("ghost", "ignored").unwrap();
    }

    #[test]
    fn list_turns_for_session_orders_by_ordinal_asc() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);

        // Bypass insert_pending_turn (which auto-assigns ordinals) and use
        // raw SQL so we can verify ORDER BY against non-monotonic input.
        {
            let conn = l.db.lock().expect("ledger mutex");
            for (id, ordinal) in [("ta", 5_i64), ("tb", 1), ("tc", 3)] {
                conn.execute(
                    "INSERT INTO turns (
                        tug_turn_id, session_id, ordinal, claude_message_id,
                        user_text, user_attachments, state, partial_text,
                        created_at, completed_at
                     ) VALUES (?1, ?2, ?3, NULL, '', X'5b5d', 'pending', NULL, ?4, NULL)",
                    params![id, "s1", ordinal, now],
                )
                .unwrap();
            }
        }

        let rows = l.list_turns_for_session("s1").unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.tug_turn_id.as_str()).collect();
        assert_eq!(ids, vec!["tb", "tc", "ta"]);
    }

    #[test]
    fn list_turns_for_session_filters_by_session() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        seed_live(&l, "s2", WS_A, "card-2", now);
        l.insert_pending_turn("s1", "t1", "a", &[], now).unwrap();
        l.insert_pending_turn("s2", "t2", "b", &[], now).unwrap();

        let s1 = l.list_turns_for_session("s1").unwrap();
        assert_eq!(s1.len(), 1);
        assert_eq!(s1[0].tug_turn_id, "t1");

        let s2 = l.list_turns_for_session("s2").unwrap();
        assert_eq!(s2.len(), 1);
        assert_eq!(s2[0].tug_turn_id, "t2");

        let none = l.list_turns_for_session("never").unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn get_turn_and_get_turn_by_claude_message_id_roundtrip() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        let attachments = vec![serde_json::json!({"path": "/tmp/foo.txt", "size": 42})];
        l.insert_pending_turn("s1", "t1", "with-att", &attachments, now)
            .unwrap();

        let r = l.get_turn("t1").unwrap().expect("by tug_turn_id");
        assert_eq!(r.user_text, "with-att");
        assert_eq!(r.user_attachments, attachments);

        // Pre-completion: claude_message_id index lookup returns None.
        assert!(l.get_turn_by_claude_message_id("never").unwrap().is_none());
        assert!(
            l.get_turn_by_claude_message_id("msg_abc")
                .unwrap()
                .is_none()
        );

        l.mark_turn_complete("t1", "msg_abc", now + 1_000).unwrap();

        let r = l
            .get_turn_by_claude_message_id("msg_abc")
            .unwrap()
            .expect("by claude id");
        assert_eq!(r.tug_turn_id, "t1");
        assert_eq!(r.state, TurnState::Complete);
        assert_eq!(r.completed_at, Some(now + 1_000));

        // Non-existent tug_turn_id → None.
        assert!(l.get_turn("ghost").unwrap().is_none());
    }

    #[test]
    fn cascade_delete_removes_turns_when_session_deleted() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        seed_live(&l, "s2", WS_A, "card-2", now);
        l.insert_pending_turn("s1", "t1", "a", &[], now).unwrap();
        l.insert_pending_turn("s1", "t2", "b", &[], now).unwrap();
        l.insert_pending_turn("s2", "t3", "c", &[], now).unwrap();

        {
            let conn = l.db.lock().expect("ledger mutex");
            conn.execute("DELETE FROM sessions WHERE session_id = 's1'", [])
                .unwrap();
        }

        // s1's turns gone via FK cascade.
        assert!(l.get_turn("t1").unwrap().is_none());
        assert!(l.get_turn("t2").unwrap().is_none());
        assert!(l.list_turns_for_session("s1").unwrap().is_empty());
        // s2's turn untouched.
        assert!(l.get_turn("t3").unwrap().is_some());
    }

    #[test]
    fn insert_pending_turn_no_duplicate_ordinals_under_concurrency() {
        // Cross-handle concurrency: each thread opens its own
        // SessionLedger pointing at the same file, so the protection has
        // to come from sqlite + IMMEDIATE transactions (not from the
        // process-local mutex). With the IMMEDIATE tx on read-modify-
        // write, ordinals stay unique and contiguous; without it the
        // failure-first test below shows duplicates.
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();

        {
            let l_seed = SessionLedger::open(&path).unwrap();
            l_seed
                .record_spawn("s1", WS_A, "/proj", "card-1", millis(0))
                .unwrap();
        }

        let n_per_thread = 10usize;
        let n_threads = 4usize;

        let handles: Vec<_> = (0..n_threads)
            .map(|t| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let l = SessionLedger::open(&path).expect("open ledger handle");
                    for i in 0..n_per_thread {
                        let id = format!("real-t{t}-i{i}");
                        l.insert_pending_turn("s1", &id, "x", &[], millis(0))
                            .unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let l = SessionLedger::open(&path).unwrap();
        let rows = l.list_turns_for_session("s1").unwrap();
        assert_eq!(rows.len(), n_per_thread * n_threads);

        let mut ordinals: Vec<i64> = rows.iter().map(|r| r.ordinal).collect();
        ordinals.sort();
        let expected: Vec<i64> = (0..(n_per_thread * n_threads) as i64).collect();
        assert_eq!(
            ordinals, expected,
            "ordinals must be unique and contiguous from 0",
        );
    }

    #[test]
    fn reconcile_pending_for_session_marks_all_pending_interrupted() {
        // Multiple pending rows for one session: every one transitions
        // to `interrupted`; the function returns all reconciled ids in
        // ordinal order. Rows for unrelated sessions are untouched.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        seed_live(&l, "s2", WS_A, "card-2", now);
        l.insert_pending_turn("s1", "t1a", "first", &[], now)
            .unwrap();
        l.insert_pending_turn("s1", "t1b", "second", &[], now)
            .unwrap();
        l.insert_pending_turn("s2", "t2a", "other-session", &[], now)
            .unwrap();

        let cancelled_at = now + 5_000;
        let reconciled = l.reconcile_pending_for_session("s1", cancelled_at).unwrap();
        assert_eq!(reconciled, vec!["t1a".to_owned(), "t1b".to_owned()]);

        for id in ["t1a", "t1b"] {
            let r = l.get_turn(id).unwrap().unwrap();
            assert_eq!(r.state, TurnState::Interrupted);
            assert_eq!(r.partial_text, None);
            assert_eq!(r.completed_at, Some(cancelled_at));
            // user_text preserved.
            assert!(!r.user_text.is_empty());
        }
        // Unrelated session's pending row is NOT touched.
        let other = l.get_turn("t2a").unwrap().unwrap();
        assert_eq!(other.state, TurnState::Pending);
    }

    #[test]
    fn reconcile_pending_for_session_skips_complete_and_interrupted_rows() {
        // Mixed-state set: complete + interrupted + pending. Only the
        // pending row reconciles; the others are untouched.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "tt-complete", "done", &[], now)
            .unwrap();
        l.mark_turn_complete("tt-complete", "msg_complete", now + 1_000)
            .unwrap();
        l.insert_pending_turn("s1", "tt-interrupted", "stopped", &[], now)
            .unwrap();
        l.mark_turn_interrupted("tt-interrupted", None, Some("partial..."), now + 2_000)
            .unwrap();
        l.insert_pending_turn("s1", "tt-pending", "still going", &[], now)
            .unwrap();

        let reconciled = l.reconcile_pending_for_session("s1", now + 10_000).unwrap();
        assert_eq!(reconciled, vec!["tt-pending".to_owned()]);

        // Complete row preserved.
        let c = l.get_turn("tt-complete").unwrap().unwrap();
        assert_eq!(c.state, TurnState::Complete);
        assert_eq!(c.claude_message_id.as_deref(), Some("msg_complete"));

        // Interrupted row preserved (cancelled_at unchanged).
        let i = l.get_turn("tt-interrupted").unwrap().unwrap();
        assert_eq!(i.state, TurnState::Interrupted);
        assert_eq!(i.completed_at, Some(now + 2_000));
        assert_eq!(i.partial_text.as_deref(), Some("partial..."));

        // Pending → interrupted with NULL partial_text and the
        // reconciliation timestamp.
        let p = l.get_turn("tt-pending").unwrap().unwrap();
        assert_eq!(p.state, TurnState::Interrupted);
        assert_eq!(p.partial_text, None);
        assert_eq!(p.completed_at, Some(now + 10_000));
    }

    #[test]
    fn reconcile_pending_for_session_returns_empty_when_none_pending() {
        // No pending rows: return Ok([]) without writing anything.
        // Pins the no-op fast path.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "tt-1", "x", &[], now).unwrap();
        l.mark_turn_complete("tt-1", "msg_1", now + 1_000).unwrap();

        let reconciled = l.reconcile_pending_for_session("s1", now + 5_000).unwrap();
        assert!(reconciled.is_empty());
        let r = l.get_turn("tt-1").unwrap().unwrap();
        // Complete row's completed_at unchanged.
        assert_eq!(r.completed_at, Some(now + 1_000));
    }

    #[test]
    fn reconcile_pending_for_session_unknown_session_is_no_op() {
        let l = fresh();
        let reconciled = l
            .reconcile_pending_for_session("never-existed", millis(0))
            .unwrap();
        assert!(reconciled.is_empty());
    }

    #[test]
    fn reconcile_pending_for_session_preserves_existing_claude_message_id() {
        // Stretch case: a future code path stamps claude_message_id on
        // a pending row before the reconciliation runs (e.g., a
        // partial-snapshot path lands the id ahead of cancel). The
        // reconcile UPDATE doesn't touch claude_message_id — only
        // state, completed_at. Pinned so a future "always NULL it"
        // refactor can't silently drop a known back-reference.
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        l.insert_pending_turn("s1", "tt-1", "x", &[], now).unwrap();
        {
            let conn = l.db.lock().expect("ledger mutex");
            conn.execute(
                "UPDATE turns SET claude_message_id = 'msg_pre'
                 WHERE tug_turn_id = 'tt-1'",
                [],
            )
            .unwrap();
        }

        let reconciled = l.reconcile_pending_for_session("s1", now + 1_000).unwrap();
        assert_eq!(reconciled, vec!["tt-1".to_owned()]);
        let r = l.get_turn("tt-1").unwrap().unwrap();
        assert_eq!(r.state, TurnState::Interrupted);
        assert_eq!(
            r.claude_message_id.as_deref(),
            Some("msg_pre"),
            "claude_message_id preserved across reconciliation",
        );
    }

    /// Failure-first proof: if `insert_pending_turn` released the lock
    /// between its SELECT max(ordinal) and INSERT, racing handles would
    /// produce duplicate ordinals. We model that buggy variant here and
    /// assert duplicates surface — without this the no-duplicates test
    /// above could pass even if the production code lost its protection.
    fn buggy_insert_with_split_locks(
        ledger: &SessionLedger,
        session_id: &str,
        tug_turn_id: &str,
        now: i64,
    ) -> Result<(), LedgerError> {
        let next_ordinal: i64 = {
            let conn = ledger.db.lock().expect("ledger mutex");
            conn.query_row(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM turns WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )?
        };
        // Drop the lock and sleep to widen the race window. Other ledger
        // handles can now read the same max ordinal and race us into
        // INSERT with a duplicate value.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let conn = ledger.db.lock().expect("ledger mutex");
        conn.execute(
            "INSERT INTO turns (
                tug_turn_id, session_id, ordinal, claude_message_id,
                user_text, user_attachments, state, partial_text,
                created_at, completed_at
             ) VALUES (?1, ?2, ?3, NULL, '', X'5b5d', 'pending', NULL, ?4, NULL)",
            params![tug_turn_id, session_id, next_ordinal, now],
        )?;
        Ok(())
    }

    #[test]
    fn buggy_split_lock_inserter_produces_duplicate_ordinals() {
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();

        {
            let l_seed = SessionLedger::open(&path).unwrap();
            l_seed
                .record_spawn("s1", WS_A, "/proj", "card-1", millis(0))
                .unwrap();
        }

        let n_per_thread = 5usize;
        let n_threads = 4usize;

        let handles: Vec<_> = (0..n_threads)
            .map(|t| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let l = SessionLedger::open(&path).expect("open ledger handle");
                    for i in 0..n_per_thread {
                        let id = format!("buggy-t{t}-i{i}");
                        buggy_insert_with_split_locks(&l, "s1", &id, millis(0)).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let l = SessionLedger::open(&path).unwrap();
        let rows = l.list_turns_for_session("s1").unwrap();
        assert_eq!(rows.len(), n_per_thread * n_threads);

        let mut ordinals: Vec<i64> = rows.iter().map(|r| r.ordinal).collect();
        ordinals.sort();
        let mut deduped = ordinals.clone();
        deduped.dedup();
        assert!(
            deduped.len() < ordinals.len(),
            "buggy split-lock inserter must produce duplicate ordinals \
             (proves the production no-duplicates test is meaningful); \
             ordinals={ordinals:?}",
        );
    }

    // ── bootstrap_turns_from_jsonl (mid-turn-replay step 4.8) ────────────────
    //
    // Migration path for sessions that pre-date the turns table.
    // Idempotency via `list_turns_for_session` short-circuit; per-row
    // state derived from the JSONL parser's `ParsedTurnState`.

    fn write_jsonl_content(
        root: &Path,
        project_dir: &str,
        session_id: &str,
        content: &str,
    ) -> PathBuf {
        let encoded = encode_claude_project_name(project_dir);
        let project_root = root.join(encoded);
        std::fs::create_dir_all(&project_root).expect("mkdir project root");
        let path = project_root.join(format!("{session_id}.jsonl"));
        std::fs::write(&path, content).expect("write jsonl");
        path
    }

    /// JSONL with N consecutive complete turns (each `user → assistant
    /// end_turn`). Lets the historical-bootstrap test fixture stay
    /// compact.
    fn jsonl_with_complete_turns(n: usize) -> String {
        let mut lines: Vec<String> = Vec::new();
        for i in 0..n {
            lines.push(
                serde_json::json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": format!("u{i}") }]
                    }
                })
                .to_string(),
            );
            lines.push(
                serde_json::json!({
                    "type": "assistant",
                    "message": {
                        "id": format!("msg_claude_{i}"),
                        "stop_reason": "end_turn",
                        "content": [{ "type": "text", "text": format!("a{i}") }]
                    }
                })
                .to_string(),
            );
        }
        lines.join("\n") + "\n"
    }

    #[test]
    fn bootstrap_inserts_consecutive_ordinals_for_complete_turns() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        write_jsonl_content(
            tmp.path(),
            "/proj/legacy",
            "sess-legacy",
            &jsonl_with_complete_turns(5),
        );

        let inserted = l
            .bootstrap_turns_from_jsonl("sess-legacy", "/proj/legacy", millis(0))
            .unwrap();
        assert_eq!(inserted, 5);

        let rows = l.list_turns_for_session("sess-legacy").unwrap();
        assert_eq!(rows.len(), 5);
        for (i, row) in rows.iter().enumerate() {
            assert_eq!(row.ordinal, i as i64);
            assert_eq!(row.user_text, format!("u{i}"));
            assert_eq!(
                row.claude_message_id.as_deref(),
                Some(format!("msg_claude_{i}").as_str()),
            );
            assert_eq!(row.state, TurnState::Complete);
            assert_eq!(row.partial_text, None);
            // Tug_turn_id is freshly minted (UUID).
            assert_eq!(row.tug_turn_id.len(), 36);
            // completed_at == now passed in.
            assert_eq!(row.completed_at, Some(millis(0)));
        }
    }

    #[test]
    fn bootstrap_is_idempotent_on_re_run() {
        // Running bootstrap twice on the same session: second call is
        // a no-op (returns 0 because rows already exist).
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        write_jsonl_content(
            tmp.path(),
            "/proj/idem",
            "sess-idem",
            &jsonl_with_complete_turns(2),
        );

        let first = l
            .bootstrap_turns_from_jsonl("sess-idem", "/proj/idem", millis(0))
            .unwrap();
        assert_eq!(first, 2);
        let second = l
            .bootstrap_turns_from_jsonl("sess-idem", "/proj/idem", millis(0) + 1_000)
            .unwrap();
        assert_eq!(second, 0, "second call must short-circuit on existing rows");
        // Total rows unchanged.
        let rows = l.list_turns_for_session("sess-idem").unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn bootstrap_partial_jsonl_yields_complete_then_interrupted() {
        // 3 complete turns + 1 mid-turn (no end_turn). Bootstrap
        // classifies the trailing turn as interrupted.
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        let mut content = jsonl_with_complete_turns(3);
        content.push_str(
            &serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": "uX" }]
                }
            })
            .to_string(),
        );
        content.push('\n');
        content.push_str(
            &serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_partial",
                    "stop_reason": null,
                    "content": [{ "type": "text", "text": "aX..." }]
                }
            })
            .to_string(),
        );
        content.push('\n');
        write_jsonl_content(tmp.path(), "/proj/partial", "sess-partial", &content);

        let inserted = l
            .bootstrap_turns_from_jsonl("sess-partial", "/proj/partial", millis(0))
            .unwrap();
        assert_eq!(inserted, 4);

        let rows = l.list_turns_for_session("sess-partial").unwrap();
        // First 3 complete.
        for (i, row) in rows.iter().enumerate().take(3) {
            assert_eq!(row.state, TurnState::Complete);
            assert_eq!(row.user_text, format!("u{i}"));
            assert_eq!(
                row.claude_message_id.as_deref(),
                Some(format!("msg_claude_{i}").as_str()),
            );
        }
        // Trailing turn: interrupted, with claude_message_id captured.
        assert_eq!(rows[3].state, TurnState::Interrupted);
        assert_eq!(rows[3].user_text, "uX");
        assert_eq!(rows[3].claude_message_id.as_deref(), Some("msg_partial"));
        assert_eq!(rows[3].partial_text, None);
    }

    #[test]
    fn bootstrap_skips_malformed_lines() {
        // Surrounding turns insert; the malformed line is silently
        // dropped by the parser. Pin so a future "fail-on-malformed"
        // refactor can't silently break legacy migration.
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        let content = format!(
            "{}\nthis is not json\n{}\n",
            serde_json::to_string(&serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u" }] }
            }))
            .unwrap(),
            serde_json::to_string(&serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_after_garbage",
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "a" }]
                }
            }))
            .unwrap(),
        );
        write_jsonl_content(tmp.path(), "/proj/malf", "sess-malf", &content);

        let inserted = l
            .bootstrap_turns_from_jsonl("sess-malf", "/proj/malf", millis(0))
            .unwrap();
        assert_eq!(inserted, 1);
        let rows = l.list_turns_for_session("sess-malf").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_text, "u");
        assert_eq!(
            rows[0].claude_message_id.as_deref(),
            Some("msg_after_garbage"),
        );
    }

    #[test]
    fn bootstrap_missing_jsonl_returns_zero() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        // No JSONL file written.
        let inserted = l
            .bootstrap_turns_from_jsonl("sess-missing", "/proj/none", millis(0))
            .unwrap();
        assert_eq!(inserted, 0);
        assert!(l.list_turns_for_session("sess-missing").unwrap().is_empty());
    }

    #[test]
    fn bootstrap_empty_jsonl_returns_zero() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        write_jsonl_content(tmp.path(), "/proj/empty", "sess-empty", "");
        let inserted = l
            .bootstrap_turns_from_jsonl("sess-empty", "/proj/empty", millis(0))
            .unwrap();
        assert_eq!(inserted, 0);
    }

    #[cfg(unix)]
    #[test]
    fn bootstrap_canonicalizes_symlinked_project_dir_before_path_encoding() {
        // Regression pin for the dev-machine symlink case (the user's
        // own path: `/u/src/tugtool` symlinks to
        // `/Users/<u>/Mounts/u/src/tugtool`). Claude resolves its cwd
        // via `getcwd()` and writes the JSONL under the resolved
        // path's encoded form. Bootstrap must do the SAME resolution
        // (via `canonical_project_dir_for_jsonl`) or it silently
        // no-ops on every symlinked session.
        let tmp = tempfile::tempdir().expect("tempdir");
        let canonical_dir = tmp.path().join("real-project");
        std::fs::create_dir_all(&canonical_dir).unwrap();
        // Use the SAME helper bootstrap uses, so the test isn't
        // sensitive to host-temp-dir hops (`/tmp` ↔ `/private/tmp`,
        // `/var/folders/...` ↔ `/private/var/folders/...`, macOS
        // firmlink prefix `/System/Volumes/Data`, etc.). Production
        // uses this helper internally; the test's fixture must agree
        // with it for the assertion to exercise the right contract.
        let canonical_str =
            canonical_project_dir_for_jsonl(canonical_dir.to_string_lossy().as_ref());

        // Create a symlink pointing at the canonical path.
        let symlink_dir = tmp.path().join("link-to-real-project");
        std::os::unix::fs::symlink(&canonical_dir, &symlink_dir)
            .expect("create symlink for fixture");
        let symlink_str = symlink_dir.to_string_lossy().into_owned();
        assert_ne!(
            symlink_str, canonical_str,
            "symlink-form and resolved-form must differ for the test to \
             actually exercise the canonicalization step",
        );

        // Seed the JSONL under the resolved-form encoding (what
        // claude itself writes).
        let claude_root = tmp.path().join("claude_root");
        std::fs::create_dir_all(&claude_root).unwrap();
        write_jsonl_content(
            &claude_root,
            &canonical_str,
            "sess-symlink",
            &jsonl_with_complete_turns(2),
        );

        let l = fresh_ledger_with_root(&claude_root);

        // Drive bootstrap with the SYMLINK path (mirrors what
        // tugdeck/tugcast carry when the user opened the session via
        // the symlink).
        let inserted = l
            .bootstrap_turns_from_jsonl("sess-symlink", &symlink_str, millis(0))
            .unwrap();
        assert_eq!(
            inserted, 2,
            "bootstrap must resolve the symlinked project_dir to the same \
             form claude/getcwd produces before encoding; otherwise the \
             migration silently no-ops on every dev machine with symlinked \
             project paths",
        );

        let rows = l.list_turns_for_session("sess-symlink").unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn canonical_project_dir_for_jsonl_strips_macos_firmlink_prefix() {
        // macOS APFS firmlinks: `/Users` is bidirectionally
        // accessible at `/System/Volumes/Data/Users`. Rust's
        // `std::fs::canonicalize` traverses through to the latter on
        // some macOS configurations, but claude's `getcwd()` and
        // Node's `fs.realpath` stop at the former (which is also
        // where claude writes its JSONLs on disk). Pin that
        // `canonical_project_dir_for_jsonl` strips the firmlink
        // prefix so tugcast's encoding matches the on-disk reality.
        //
        // The actual value `canonicalize` returns for `/Users` on a
        // given macOS host is environment-specific (firmlink
        // configuration changes across macOS versions). What matters
        // is the contract: if the resolved form starts with
        // `/System/Volumes/Data/`, the helper strips that prefix.
        let resolved = canonical_project_dir_for_jsonl("/Users");
        assert!(
            !resolved.starts_with("/System/Volumes/Data"),
            "canonical_project_dir_for_jsonl must strip the macOS firmlink \
             prefix; got `{resolved}`",
        );
    }

    #[test]
    fn bootstrap_carries_user_attachments_through() {
        // Attachments survive the round-trip through the parser, the
        // BLOB encoding, and back through the row read.
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        let content = format!(
            "{}\n{}\n",
            serde_json::to_string(&serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "describe" },
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "abc" } }
                ] }
            }))
            .unwrap(),
            serde_json::to_string(&serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_x",
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "ok" }]
                }
            }))
            .unwrap(),
        );
        write_jsonl_content(tmp.path(), "/proj/att", "sess-att", &content);

        let inserted = l
            .bootstrap_turns_from_jsonl("sess-att", "/proj/att", millis(0))
            .unwrap();
        assert_eq!(inserted, 1);
        let rows = l.list_turns_for_session("sess-att").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_attachments.len(), 1);
        assert_eq!(rows[0].user_attachments[0]["type"], "image");
        assert_eq!(
            rows[0].user_attachments[0]["source"]["media_type"],
            "image/png",
        );
    }
}
