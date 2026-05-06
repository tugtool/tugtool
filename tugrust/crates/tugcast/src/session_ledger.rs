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
//! # Schema
//!
//! Two tables: `sessions` (one row per claude session, lifecycle state
//! and metadata) and `turns` (a *submission journal* — one row per
//! pending user submission, deleted as soon as claude acknowledges).
//! Cascade-on-`sessions`-DELETE for the journal is implemented via the
//! `turns_cascade_delete_on_session` trigger rather than a foreign-key
//! constraint: the supervisor inserts journal rows at user-message
//! dispatch time, before claude emits `session_init` and before the
//! bridge populates the `sessions` row, so an `INSERT`-time FK check
//! would chicken-and-egg. The trigger preserves the user-visible
//! "Forget cascades to journal" contract without coupling INSERT
//! ordering across the dispatch and bridge code paths.
//!
//! Bootstrap creates both tables and the cascade trigger via
//! `CREATE … IF NOT EXISTS`. There is no `migrations` table and no
//! versioning machinery: tugtool is a single-developer dogfooding tool
//! with no production users, so the right move when the schema changes
//! is to delete the on-disk `sessions.db` and let the next open
//! recreate it. See [DM08] in the mid-turn-replay plan for the
//! no-migration policy.
//!
//! # Concurrency
//!
//! Writes serialize through a single `Mutex<Connection>` inside the ledger.
//! Sqlite runs in WAL mode with a 5-second `busy_timeout`. The supervisor's
//! write cadence — one write per `session_init` / `turn_complete` /
//! `resume_failed` / close — fits comfortably under those settings.
//! Journal writes (`insert_pending_turn`,
//! `delete_oldest_pending_for_session`) are single-statement and don't
//! need explicit transactions; sqlite's per-statement implicit
//! transaction is enough.

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

/// One row of the `turns` submission journal. Authored by tugcast at
/// user-submit time (`insert_pending_turn`) and deleted by the merger's
/// `turn_complete` intercept (FIFO match) once claude acknowledges the
/// submission. While the row exists, the user submission is "pending" —
/// claude hasn't yet recorded it in JSONL. The journal's only durable
/// role is plugging the gap between user-submit and JSONL-acknowledge so
/// `runReplay` can render the submission as awaiting-response on
/// resume. See [DM08] in the mid-turn-replay plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalRow {
    pub journal_id: String,
    pub session_id: String,
    pub user_text: String,
    pub user_attachments: Vec<serde_json::Value>,
    pub created_at: i64,
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
                journal_id        TEXT PRIMARY KEY,
                session_id        TEXT NOT NULL,
                user_text         TEXT NOT NULL,
                user_attachments  BLOB NOT NULL,
                created_at        INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS turns_session_created
                ON turns(session_id, created_at);

            CREATE TRIGGER IF NOT EXISTS turns_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM turns WHERE session_id = OLD.session_id;
            END;
            ",
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

    // ── submission journal ───────────────────────────────────────────────────
    //
    // The `turns` table is a journal of pending user submissions: tugcast
    // inserts a row at user-message dispatch (the supervisor's
    // `dispatch_one` intercept), and the merger's `turn_complete`
    // intercept deletes the oldest pending row for the session via
    // `delete_oldest_pending_for_session` (FIFO match) once claude
    // acknowledges. tugcode reads pending rows for a session via the
    // cross-process bun:sqlite handle in `runReplay` and emits a synthetic
    // `user_message_replay` for any row whose `user_text` does not appear
    // as a `user_message` line in the JSONL — that's the never-drop
    // recovery for the gap between user-submit and JSONL-acknowledge.
    // See [DM08] in the mid-turn-replay plan.

    /// Insert a fresh row in the journal. `user_attachments` is encoded
    /// as a JSON array and stored as BLOB; the empty case (`&[]`)
    /// round-trips as `[]`. The caller mints `journal_id` (the supervisor
    /// uses `Uuid::new_v4().to_string()` so the id is unique across the
    /// whole database) and persists it before forwarding the
    /// `user_message` frame to tugcode — that ordering is the durability
    /// guarantee documented in [Never-drop chain audit row 4](#step-5-never-drop).
    pub fn insert_pending_turn(
        &self,
        session_id: &str,
        journal_id: &str,
        user_text: &str,
        user_attachments: &[serde_json::Value],
        now: i64,
    ) -> Result<(), LedgerError> {
        let attachments_blob = serde_json::to_vec(user_attachments)?;
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "INSERT INTO turns (
                journal_id, session_id, user_text, user_attachments, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![journal_id, session_id, user_text, attachments_blob, now],
        )?;
        Ok(())
    }

    /// Delete the oldest pending row for `session_id` (FIFO match by
    /// `created_at` ASC). Called from the merger's `turn_complete`
    /// intercept (narrowed in [Step 5.3](#step-5-3) to delete-on-ack
    /// rather than mark-complete-by-id). Returns the deleted row's
    /// content so the caller can log it; returns `Ok(None)` if there
    /// were no pending rows for the session (a `turn_complete` arrived
    /// for a session whose journal is already empty — claude responding
    /// to a turn the journal didn't see, e.g. resume-after-bootstrap-of-
    /// older-tugcode-data).
    pub fn delete_oldest_pending_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<JournalRow>, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let row = tx
            .query_row(
                "SELECT journal_id, session_id, user_text, user_attachments, created_at
                 FROM turns
                 WHERE session_id = ?1
                 ORDER BY created_at ASC, journal_id ASC
                 LIMIT 1",
                params![session_id],
                journal_row_from_query,
            )
            .optional()?;
        let Some(decoded) = row else {
            tx.commit()?;
            return Ok(None);
        };
        let row = decoded?;
        tx.execute(
            "DELETE FROM turns WHERE journal_id = ?1",
            params![row.journal_id],
        )?;
        tx.commit()?;
        Ok(Some(row))
    }

    /// All pending journal rows for `session_id`, ordered by `created_at`
    /// ASC (FIFO). This is the read surface tugcode's `runReplay`
    /// consumes through the cross-process `bun:sqlite` handle: for each
    /// row whose `user_text` does NOT appear as a `user_message` line in
    /// the JSONL, `runReplay` emits a synthetic `user_message_replay`
    /// frame to render the submission as awaiting-response. See
    /// [DM08]'s pending-row replay description in the mid-turn-replay plan.
    pub fn list_pending_turns_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<JournalRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT journal_id, session_id, user_text, user_attachments, created_at
             FROM turns
             WHERE session_id = ?1
             ORDER BY created_at ASC, journal_id ASC",
        )?;
        let rows = stmt
            .query_map(params![session_id], journal_row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
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

/// Decode one row from a `SELECT journal_id, session_id, user_text,
/// user_attachments, created_at FROM turns` cursor. Same closure type as
/// `row_from_query`: returns `rusqlite::Result<Result<JournalRow,
/// LedgerError>>` so callers can distinguish BLOB-JSON-decode errors
/// from sqlite-level errors and surface them through `LedgerError`.
fn journal_row_from_query(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<JournalRow, LedgerError>> {
    let journal_id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let user_text: String = row.get(2)?;
    let attachments_blob: Vec<u8> = row.get(3)?;
    let created_at: i64 = row.get(4)?;
    let user_attachments: Vec<serde_json::Value> = match serde_json::from_slice(&attachments_blob) {
        Ok(v) => v,
        Err(e) => return Ok(Err(LedgerError::Serde(e))),
    };
    Ok(Ok(JournalRow {
        journal_id,
        session_id,
        user_text,
        user_attachments,
        created_at,
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
    fn schema_bootstrap_creates_only_two_tables_and_no_migrations_table() {
        // Pin the no-migration policy ([DM08] — mid-turn-replay [Step 5.2](#step-5-2)):
        // bootstrap creates exactly `sessions` and `turns`, no `migrations` table.
        let l = fresh();
        let conn = l.db.lock().expect("ledger mutex");
        assert!(has_table(&conn, "sessions"));
        assert!(has_table(&conn, "turns"));
        assert!(!has_table(&conn, "migrations"));
    }

    #[test]
    fn turns_table_has_narrowed_journal_columns() {
        // Pin the narrowed schema. Five columns; no `claude_message_id`,
        // `partial_text`, `state`, `completed_at`, `ordinal`.
        let l = fresh();
        let conn = l.db.lock().expect("ledger mutex");
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info('turns') ORDER BY cid")
            .unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            columns,
            vec![
                "journal_id".to_string(),
                "session_id".to_string(),
                "user_text".to_string(),
                "user_attachments".to_string(),
                "created_at".to_string(),
            ],
        );
    }

    #[test]
    fn insert_pending_turn_round_trips_via_list_pending_turns_for_session() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.insert_pending_turn("s1", "j1", "hello", &[], millis(0))
            .unwrap();
        let rows = l.list_pending_turns_for_session("s1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].journal_id, "j1");
        assert_eq!(rows[0].session_id, "s1");
        assert_eq!(rows[0].user_text, "hello");
        assert!(rows[0].user_attachments.is_empty());
    }

    #[test]
    fn insert_pending_turn_persists_user_attachments_round_trip() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let attachments = vec![
            serde_json::json!({"filename": "a.txt", "content": "hi", "media_type": "text/plain"}),
        ];
        l.insert_pending_turn("s1", "j1", "with attachment", &attachments, millis(0))
            .unwrap();
        let rows = l.list_pending_turns_for_session("s1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_attachments.len(), 1);
        assert_eq!(rows[0].user_attachments[0]["filename"], "a.txt");
    }

    #[test]
    fn list_pending_turns_for_session_orders_by_created_at_asc() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.insert_pending_turn("s1", "j_oldest", "first", &[], 1_000)
            .unwrap();
        l.insert_pending_turn("s1", "j_middle", "second", &[], 2_000)
            .unwrap();
        l.insert_pending_turn("s1", "j_newest", "third", &[], 3_000)
            .unwrap();
        let rows = l.list_pending_turns_for_session("s1").unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.journal_id.as_str()).collect();
        assert_eq!(ids, vec!["j_oldest", "j_middle", "j_newest"]);
    }

    #[test]
    fn list_pending_turns_for_session_filters_by_session() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        l.insert_pending_turn("s1", "j_s1", "for s1", &[], millis(0))
            .unwrap();
        l.insert_pending_turn("s2", "j_s2", "for s2", &[], millis(0))
            .unwrap();
        let s1_rows = l.list_pending_turns_for_session("s1").unwrap();
        let s2_rows = l.list_pending_turns_for_session("s2").unwrap();
        assert_eq!(s1_rows.len(), 1);
        assert_eq!(s1_rows[0].user_text, "for s1");
        assert_eq!(s2_rows.len(), 1);
        assert_eq!(s2_rows[0].user_text, "for s2");
    }

    #[test]
    fn delete_oldest_pending_for_session_fifo_order() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.insert_pending_turn("s1", "j_oldest", "first", &[], 1_000)
            .unwrap();
        l.insert_pending_turn("s1", "j_middle", "second", &[], 2_000)
            .unwrap();
        l.insert_pending_turn("s1", "j_newest", "third", &[], 3_000)
            .unwrap();

        let popped = l.delete_oldest_pending_for_session("s1").unwrap();
        assert_eq!(
            popped.as_ref().map(|r| r.journal_id.as_str()),
            Some("j_oldest")
        );
        assert_eq!(popped.as_ref().map(|r| r.user_text.as_str()), Some("first"));

        let popped = l.delete_oldest_pending_for_session("s1").unwrap();
        assert_eq!(
            popped.as_ref().map(|r| r.journal_id.as_str()),
            Some("j_middle")
        );

        let popped = l.delete_oldest_pending_for_session("s1").unwrap();
        assert_eq!(
            popped.as_ref().map(|r| r.journal_id.as_str()),
            Some("j_newest")
        );

        // Fourth pop returns None — empty journal.
        assert!(l.delete_oldest_pending_for_session("s1").unwrap().is_none(),);
    }

    #[test]
    fn delete_oldest_pending_for_session_returns_none_on_empty_journal() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        // Session exists but no pending rows.
        assert!(l.delete_oldest_pending_for_session("s1").unwrap().is_none(),);
    }

    #[test]
    fn delete_oldest_pending_for_session_returns_none_on_unknown_session() {
        let l = fresh();
        assert!(
            l.delete_oldest_pending_for_session("never-existed")
                .unwrap()
                .is_none(),
        );
    }

    #[test]
    fn delete_oldest_pending_for_session_does_not_touch_other_sessions() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        l.insert_pending_turn("s1", "j_s1", "for s1", &[], 1_000)
            .unwrap();
        l.insert_pending_turn("s2", "j_s2", "for s2", &[], 1_000)
            .unwrap();

        l.delete_oldest_pending_for_session("s1").unwrap();

        let s2_rows = l.list_pending_turns_for_session("s2").unwrap();
        assert_eq!(s2_rows.len(), 1, "s2's pending row must be untouched");
    }

    #[test]
    fn cascade_delete_removes_journal_when_session_deleted() {
        // Pin the `turns_cascade_delete_on_session` trigger: forgetting
        // a session also removes its journal rows.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        l.insert_pending_turn("s1", "j1", "to be cascaded", &[], millis(0))
            .unwrap();
        assert_eq!(l.list_pending_turns_for_session("s1").unwrap().len(), 1,);

        l.forget("s1").unwrap();

        assert_eq!(
            l.list_pending_turns_for_session("s1").unwrap().len(),
            0,
            "cascade trigger must purge journal rows when the parent session row is deleted",
        );
    }
}
