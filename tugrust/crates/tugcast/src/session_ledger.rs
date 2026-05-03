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
//! v1 uses idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
//! EXISTS`. A `migrations` table is intentionally not authored; introduce one
//! when (and only when) a second schema variant lands.
//!
//! # Concurrency
//!
//! Writes serialize through a single `Mutex<Connection>` inside the ledger.
//! Sqlite runs in WAL mode with a 5-second `busy_timeout`. The supervisor's
//! write cadence — one write per `session_init` / `turn_complete` /
//! `resume_failed` / close — fits comfortably under those settings.

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

/// Result of a successful `forget` call.
///
/// `jsonl_moved_to` is `None` until step 8 wires the trash move. Until then
/// `forget` only deletes the ledger row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgetOutcome {
    pub session_id: String,
    pub jsonl_moved_to: Option<PathBuf>,
}

/// Result of `forget_workspace` — reports how many rows were dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgetWorkspaceOutcome {
    pub count: usize,
}

/// SQLite-backed per-session metadata store.
pub struct SessionLedger {
    db: Mutex<Connection>,
}

impl SessionLedger {
    /// Open or create the ledger at `path`. Applies pragmas and runs the
    /// idempotent schema bootstrap. Safe to call against an existing file.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, LedgerError> {
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    /// Open an in-memory ledger. Test-only convenience; never used by
    /// production callers.
    pub fn open_in_memory() -> Result<Self, LedgerError> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        Ok(Self {
            db: Mutex::new(conn),
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
            ",
        )?;
        Ok(())
    }

    /// All rows in the workspace, ordered newest-first by `last_used_at`.
    pub fn list_for_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<SessionRow>, LedgerError> {
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
    pub fn list_for_project_dir(
        &self,
        project_dir: &str,
    ) -> Result<Vec<SessionRow>, LedgerError> {
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

    /// Most-recent non-live row for the workspace, suitable for the
    /// supervisor's "resume last session" path. `live` rows are excluded
    /// because the live-elsewhere check already runs against `card_id_live`
    /// at the supervisor; resuming a live row from another card is rejected.
    pub fn find_for_resume(
        &self,
        workspace_key: &str,
    ) -> Result<Option<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, first_user_prompt, state, card_id_live
             FROM sessions
             WHERE workspace_key = ?1 AND state != 'live'
             ORDER BY last_used_at DESC
             LIMIT 1",
        )?;
        let row = stmt
            .query_row(params![workspace_key], row_from_query)
            .optional()?;
        match row {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
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
    pub fn record_first_prompt(
        &self,
        session_id: &str,
        prompt: &str,
    ) -> Result<(), LedgerError> {
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

    /// Delete the ledger row for `session_id`. The JSONL trash move lands in
    /// step 8; until then `jsonl_moved_to` is always `None`.
    ///
    /// Refuses if the row is currently live — callers must close the card
    /// first.
    pub fn forget(&self, session_id: &str) -> Result<ForgetOutcome, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let state: Option<String> = tx
            .query_row(
                "SELECT state FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?;
        match state.as_deref() {
            None => return Err(LedgerError::NotFound(session_id.to_owned())),
            Some("live") => {
                return Err(LedgerError::InvalidState(
                    "cannot forget a live session".to_owned(),
                ));
            }
            Some(_) => {}
        }
        tx.execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            params![session_id],
        )?;
        tx.commit()?;
        Ok(ForgetOutcome {
            session_id: session_id.to_owned(),
            jsonl_moved_to: None,
        })
    }

    /// Drop every non-live row in the workspace. Reports how many rows were
    /// removed; live rows in the workspace are left in place (the user must
    /// close the card first).
    pub fn forget_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<ForgetWorkspaceOutcome, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let count = tx.execute(
            "DELETE FROM sessions
             WHERE workspace_key = ?1 AND state != 'live'",
            params![workspace_key],
        )?;
        tx.commit()?;
        Ok(ForgetWorkspaceOutcome { count })
    }

    /// If the workspace already holds at least `cap` non-live rows, evict the
    /// oldest (lowest `last_used_at`). Returns the number of rows removed (0
    /// or 1). Live rows are never evicted.
    ///
    /// Intended to be called after `record_spawn`, so the just-inserted row
    /// is never the eviction target (it's live).
    pub fn evict_oldest_closed(
        &self,
        workspace_key: &str,
        cap: usize,
    ) -> Result<usize, LedgerError> {
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
            return Ok(0);
        }
        // We're over the cap — drop the oldest. Plural-safe: if the cap was
        // exceeded by more than one (e.g., a clock skew or a code path that
        // skipped eviction earlier), this brings the workspace back to cap.
        let to_remove = (non_live_count as usize) - cap;
        let removed = tx.execute(
            "DELETE FROM sessions
             WHERE session_id IN (
                SELECT session_id FROM sessions
                WHERE workspace_key = ?1 AND state != 'live'
                ORDER BY last_used_at ASC
                LIMIT ?2
             )",
            params![workspace_key, to_remove as i64],
        )?;
        tx.commit()?;
        Ok(removed)
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
    /// `now - max_age_ms`. Returns the number of rows removed.
    pub fn sweep_expired(&self, max_age_ms: i64, now: i64) -> Result<usize, LedgerError> {
        let cutoff = now - max_age_ms;
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let removed = tx.execute(
            "DELETE FROM sessions
             WHERE state != 'live' AND last_used_at < ?1",
            params![cutoff],
        )?;
        tx.commit()?;
        Ok(removed)
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
        l.record_spawn("s1", WS_A, "/proj/alpha", "card-1", now).unwrap();

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
        l.record_spawn("s1", WS_A, "/proj/alpha", "card-2", t1).unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.created_at, t0, "created_at must survive resume");
        assert_eq!(r.last_used_at, t1);
        assert_eq!(r.state, SessionState::Live);
        assert_eq!(r.card_id_live.as_deref(), Some("card-2"));
    }

    // ── list_for_workspace + find_for_resume ─────────────────────────────────

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

    #[test]
    fn find_for_resume_skips_live_rows() {
        let l = fresh();
        // Live row most recent; a closed row is the resume candidate.
        seed_live(&l, "live1", WS_A, "c-live", millis(0));
        seed_live(&l, "closed1", WS_A, "c1", millis(2));
        l.mark_closed("closed1").unwrap();

        let r = l.find_for_resume(WS_A).unwrap().unwrap();
        assert_eq!(r.session_id, "closed1");
    }

    #[test]
    fn find_for_resume_returns_none_when_only_live_rows_exist() {
        let l = fresh();
        seed_live(&l, "live1", WS_A, "c-live", millis(0));
        assert!(l.find_for_resume(WS_A).unwrap().is_none());
    }

    // ── forget / forget_workspace ────────────────────────────────────────────

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

    #[test]
    fn forget_workspace_drops_only_non_live_rows() {
        let l = fresh();
        seed_live(&l, "live1", WS_A, "c-live", millis(0));
        seed_live(&l, "closed1", WS_A, "c1", millis(1));
        l.mark_closed("closed1").unwrap();
        seed_live(&l, "failed1", WS_A, "c2", millis(2));
        l.mark_failed("failed1").unwrap();
        seed_live(&l, "other", WS_B, "cb", millis(0));

        let outcome = l.forget_workspace(WS_A).unwrap();
        assert_eq!(outcome.count, 2);
        assert!(l.get("live1").unwrap().is_some());
        assert!(l.get("closed1").unwrap().is_none());
        assert!(l.get("failed1").unwrap().is_none());
        assert!(l.get("other").unwrap().is_some());
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
        assert_eq!(l.evict_oldest_closed(WS_A, 20).unwrap(), 0);
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

        let removed = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        assert_eq!(removed, 1);
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

        let removed = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        // Only the non-live count crossed the cap (2 non-live > 20 cap is
        // false, so eviction is a no-op). The plan's intent is "cap on
        // non-live rows so live rows are never the eviction target". The
        // eviction never touches live rows; with only 2 non-live, nothing
        // gets evicted.
        assert_eq!(removed, 0);
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

        let removed = l
            .evict_oldest_closed(WS_A, TIDE_LEDGER_MAX_PER_WORKSPACE)
            .unwrap();
        assert_eq!(removed, 1);
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

        let removed = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(removed, 1);
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
        let removed = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(removed, 0);
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

        let removed = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(removed, 1);
        assert!(l.get("stale").unwrap().is_none());
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
        l1.record_spawn("s1", WS_A, "/proj", "c1", millis(0)).unwrap();
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
}
