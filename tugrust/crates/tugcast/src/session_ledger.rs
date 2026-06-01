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
//! - `INSERT  state="live", card_id=<card_id>` on `spawn_session_ok`.
//! - `UPDATE  state="closed"`                  on `close_session` or tugcode exit.
//! - `UPDATE  state="failed"`                  on `resume_failed` (replaces the previous row-removal).
//! - `DELETE` on cap/age eviction or explicit trash.
//!
//! `card_id` is set when the session first binds to a card and is preserved
//! across the row's lifetime — `mark_closed` and `mark_failed` retain it as
//! the "last bound" record so client-side restore can reconstruct the
//! card↔session mapping after a tugcast restart. Liveness is encoded
//! exclusively in `state`, not by nullity of `card_id`.
//!
//! # Eviction
//!
//! - **Cap per workspace** — `DEV_LEDGER_MAX_PER_WORKSPACE` (20). On
//!   `record_spawn`, the oldest non-live row by `last_used_at` is evicted if
//!   the workspace already holds the cap.
//! - **Age expiry** — `DEV_LEDGER_MAX_AGE_DAYS` (90). Tugcast startup sweeps
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
//! "Trash cascades to journal" contract without coupling INSERT
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
pub const DEV_LEDGER_MAX_PER_WORKSPACE: usize = 20;

/// Days since `last_used_at` after which a non-live row is age-evicted on
/// startup sweep.
pub const DEV_LEDGER_MAX_AGE_DAYS: i64 = 90;

/// Days a `.tug-trash/<deletedAt>/` directory survives before the startup
/// trash sweep removes it. Wired in step 8.
pub const DEV_TRASH_SWEEP_AGE_DAYS: i64 = 7;

/// Maximum number of characters of the most-recent user prompt the ledger
/// stores. The picker truncates further at display time.
pub const USER_PROMPT_MAX_CHARS: usize = 256;

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
    pub last_user_prompt: Option<String>,
    pub state: SessionState,
    /// The card this session is bound to. Set on `record_spawn` and never
    /// cleared by lifecycle transitions; combined with `state` it answers
    /// "which session was last bound to this card, and is it still live?"
    pub card_id: Option<String>,
    /// User-assigned session name (`/rename`), or `None` when unnamed. Survives
    /// re-spawn/resume (never cleared by lifecycle transitions); the chooser
    /// shows it as the row title and the Z4B session chip shows it as its value.
    pub name: Option<String>,
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

/// One row of the `turn_telemetry` table — the per-turn cost + multi-
/// clock timing block. Written by `record_turn_telemetry` from the
/// supervisor's inbound handler; read by `list_turn_telemetry` at
/// resume time and inlined onto replayed `turn_complete` wire events
/// by the supervisor's replay path.
///
/// The shape is the wire-shape of tugdeck's `TurnTelemetry`
/// interface (see `tugdeck/src/lib/code-session-store/telemetry.ts`
/// `TurnTelemetry`) — every field is round-trippable. `ttft_ms` and
/// `ttftc_ms` are nullable per the tugdeck data model (a turn that
/// produced no assistant output or no tool calls has no first-event
/// timestamp).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnTelemetryRow {
    pub session_id: String,
    pub msg_id: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub total_cost_usd: f64,
    pub wall_clock_ms: i64,
    pub awaiting_approval_ms: i64,
    pub transport_downtime_ms: i64,
    pub active_ms: i64,
    pub ttft_ms: Option<i64>,
    pub ttftc_ms: Option<i64>,
    pub reconnect_count: i64,
    pub max_stream_gap_ms: i64,
    pub ended_at: i64,
    /// `window(0)` — the session's resident context before any turn.
    /// Session-level rather than per-turn (every row of a session
    /// carries the same value); persisted here so a resumed session
    /// restores it. `None` for a session that never observed a first
    /// telemetry iteration, and for rows written before this field.
    pub session_init_tokens: Option<i64>,
}

/// One row of the `session_metadata` table — the LIVE-ONLY
/// `system_metadata` payload Claude Code emits on `session_init` and
/// that JSONL never preserves. Written by the bridge intercept on
/// every outbound `system_metadata` line (merged against the existing
/// row, then persisted); read on subsequent intercepts so the merge
/// has a current baseline.
///
/// `payload` is the raw JSON BLOB — the merge rule operates on the
/// parsed `serde_json::Value` rather than on per-column scalars, so
/// fields Anthropic adds in the future land here without a schema
/// change. `captured_at` is the wall-clock millisecond timestamp when
/// the row was last written (for debugging / staleness audits).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMetadataRow {
    pub session_id: String,
    pub payload: Vec<u8>,
    pub captured_at: i64,
}

/// One row of the `context_breakdown_latest` table — the most-recent
/// `/context`-style per-category token breakdown for a session,
/// persisted verbatim as the JSON wire frame tugcode emits. Written
/// by `record_context_breakdown` from the supervisor's inbound
/// handler when tugdeck dispatches the persist action; read at session
/// bind so the snapshot's `lastContextBreakdown` populates before the
/// popover opens.
///
/// One row per session — UPSERT semantics by `session_id`. The "latest"
/// shape (vs. an append-only history table) matches the popover's
/// access pattern: it only ever wants the current breakdown. A future
/// "context-growth over time" surface can add a separate
/// `context_breakdown_history` table without migrating this one.
///
/// Payload is stored as a JSON BLOB rather than per-column for the
/// same reason `session_metadata` is: the access pattern is pure PK
/// lookup, the consumer (popover renderer) reads a fixed-shape struct
/// from the parsed JSON, and the wire-frame TypeScript types already
/// validate the shape on both write and read. Per-column storage
/// would duplicate that validation without buying us indexed-field
/// queries we don't need. Promoting a new category in the future
/// becomes a TypeScript-only change. Trade-off: no `WHERE
/// messages_tokens > X` queries, but the only access pattern is `WHERE
/// session_id = ?`.
///
/// MCP is intentionally absent from the persisted payload — Tug
/// treats MCP as out of scope; the wire frame the renderer paints
/// carries no `mcp_tools` category. See the spike companion document
/// for the architectural decision.
///
/// `captured_at` is the wall-clock millisecond timestamp when the row
/// was last written (for debugging / staleness audits). Distinct from
/// any time-related field the payload itself may carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextBreakdownRow {
    pub session_id: String,
    pub payload: Vec<u8>,
    pub captured_at: i64,
}

/// One row of the `session_state_changes` table — a single transition
/// of the indicator-tone triple `(phase, transport_state,
/// interrupt_in_flight)` for a given session. Persisted by
/// `record_session_state_change` from the supervisor's inbound handler
/// when tugdeck's dispatch-wrapper observes the triple change; read
/// by the popover (Step 20.4.9) via `list_session_state_changes`.
///
/// The persisted axes are exactly the props
/// [`TugStateIndicator`](#step-20-4-2) reads — see the parent step's
/// "Coverage and known collapses" note for the signals the indicator
/// tracks but this ledger intentionally does NOT capture
/// (transcript-length, `pendingApproval` vs `pendingQuestion`,
/// `queuedSends`, `turnEndReason`, DRILLDOWN_OPEN).
///
/// Append-only per session; retention is unbounded. Rows are deleted
/// when the parent session row is deleted, via the cascade trigger.
///
/// `at_ms` is the wall-clock millisecond when the new triple landed
/// on the snapshot; `id` is the sqlite-assigned autoincrement primary
/// key (preserves insertion order regardless of clock skew on `at_ms`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionStateChangeRow {
    pub id: i64,
    pub session_id: String,
    pub at_ms: i64,
    pub phase: String,
    pub transport_state: String,
    pub interrupt_in_flight: bool,
}

/// Result of a successful `trash` call.
///
/// `jsonl_moved_to` is `None` when the JSONL file is missing or the
/// trash directory cannot be created; in that case the ledger row is
/// still deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashOutcome {
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
        // Per-instance path when TUG_INSTANCE_ID is set; otherwise
        // fall back to the legacy single-instance location for
        // backward compatibility with standalone tugcast launches.
        if let Some(p) = tugcore::instance::sessions_db_path() {
            return Some(p);
        }
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

    /// The `(name, declared-type)` columns the current `turn_telemetry`
    /// `CREATE TABLE` defines, in order. The self-healing guard in
    /// {@link bootstrap_schema} compares an on-disk table against this;
    /// a mismatch means the schema drifted and the table is rebuilt.
    const TURN_TELEMETRY_SCHEMA: &'static [(&'static str, &'static str)] = &[
        ("session_id", "TEXT"),
        ("msg_id", "TEXT"),
        ("input_tokens", "INTEGER"),
        ("output_tokens", "INTEGER"),
        ("cache_creation_input_tokens", "INTEGER"),
        ("cache_read_input_tokens", "INTEGER"),
        ("total_cost_usd", "REAL"),
        ("wall_clock_ms", "INTEGER"),
        ("awaiting_approval_ms", "INTEGER"),
        ("transport_downtime_ms", "INTEGER"),
        ("active_ms", "INTEGER"),
        ("ttft_ms", "INTEGER"),
        ("ttftc_ms", "INTEGER"),
        ("reconnect_count", "INTEGER"),
        ("max_stream_gap_ms", "INTEGER"),
        ("ended_at", "INTEGER"),
        ("session_init_tokens", "INTEGER"),
    ];

    fn bootstrap_schema(conn: &Connection) -> Result<(), LedgerError> {
        // Self-healing schema guard. `CREATE TABLE IF NOT EXISTS` does
        // not alter a table that already exists, so when a typed
        // table's column set changes, an on-disk DB created before the
        // change keeps its stale shape — and every `INSERT` that lists
        // the new column set then fails. For `turn_telemetry` that
        // failure is *silent*: the supervisor treats a telemetry-write
        // error as non-fatal, so the symptom is total loss of per-turn
        // metrics across reloads with nothing logged at the surface.
        //
        // `turn_telemetry` is a rebuildable cache of per-turn metrics —
        // per [DM08] there is nothing in it worth preserving — so a
        // drifted schema is resolved by DROPPING the stale table here;
        // the `CREATE TABLE IF NOT EXISTS` below then rebuilds it (and
        // its index) fresh. This is NOT a migration: it preserves no
        // data. It is the [DM08] delete-and-recreate, made automatic so
        // a schema change cannot silently strand telemetry again. The
        // mechanism ({@link rebuild_table_if_schema_drifted}) is
        // general; it is wired only for `turn_telemetry` — the table
        // whose drift was observed — and a future change to another
        // typed table can opt in with one more call.
        Self::rebuild_table_if_schema_drifted(conn, "turn_telemetry", Self::TURN_TELEMETRY_SCHEMA)?;
        Self::migrate_sessions_first_to_last_user_prompt(conn)?;
        Self::migrate_sessions_add_name(conn)?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                session_id        TEXT PRIMARY KEY,
                workspace_key     TEXT NOT NULL,
                project_dir       TEXT NOT NULL,
                created_at        INTEGER NOT NULL,
                last_used_at      INTEGER NOT NULL,
                turn_count        INTEGER NOT NULL DEFAULT 0,
                last_user_prompt  TEXT,
                state             TEXT NOT NULL,
                card_id           TEXT,
                name              TEXT
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

            -- Per-turn telemetry — cost + multi-clock timing block,
            -- one row per committed turn. Written by the supervisor
            -- on receipt of a `record_turn_telemetry` inbound message
            -- from tugdeck (the reducer dispatches this from
            -- `handleTurnComplete` on the live path); read at
            -- `spawn_session(mode=resume)` and inlined onto replayed
            -- `turn_complete` events so the client reducer's merge
            -- function adopts the persisted values. Cascade-on-DELETE
            -- mirrors the `turns` journal pattern so eviction of a
            -- `sessions` row (cap / age policy) takes its telemetry
            -- with it.
            --
            -- `(session_id, msg_id)` PK: msg_id is Claude-assigned,
            -- carried through JSONL, survives replay unchanged. The
            -- client-only `turn_key` is intentionally absent — it is
            -- re-minted fresh on every reload and cannot cross
            -- persistence boundaries. See plan `#step-20-3-3` for
            -- the design rationale.
            CREATE TABLE IF NOT EXISTS turn_telemetry (
                session_id                  TEXT NOT NULL,
                msg_id                      TEXT NOT NULL,
                input_tokens                INTEGER NOT NULL DEFAULT 0,
                output_tokens               INTEGER NOT NULL DEFAULT 0,
                cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
                total_cost_usd              REAL    NOT NULL DEFAULT 0,
                wall_clock_ms               INTEGER NOT NULL DEFAULT 0,
                awaiting_approval_ms        INTEGER NOT NULL DEFAULT 0,
                transport_downtime_ms       INTEGER NOT NULL DEFAULT 0,
                active_ms                   INTEGER NOT NULL DEFAULT 0,
                ttft_ms                     INTEGER,
                ttftc_ms                    INTEGER,
                reconnect_count             INTEGER NOT NULL DEFAULT 0,
                max_stream_gap_ms           INTEGER NOT NULL DEFAULT 0,
                ended_at                    INTEGER NOT NULL,
                -- `window(0)` — the session's resident context before
                -- any turn. Session-level, not per-turn: every row of a
                -- session carries the same value. Persisted here (on the
                -- channel that already round-trips) so a resumed session
                -- restores it from the first replayed `turn_complete`.
                -- Nullable: a turn whose session never observed a first
                -- iteration has no value to record.
                session_init_tokens         INTEGER,
                PRIMARY KEY (session_id, msg_id)
            );

            CREATE INDEX IF NOT EXISTS turn_telemetry_session_order
                ON turn_telemetry(session_id, ended_at);

            CREATE TRIGGER IF NOT EXISTS turn_telemetry_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM turn_telemetry WHERE session_id = OLD.session_id;
            END;

            -- Per-session LIVE-ONLY metadata — the full `system_metadata`
            -- payload Claude Code emits on `session_init` (model with
            -- the `[1m]` suffix, cwd, permissionMode, tools,
            -- slash_commands, plugins, agents, skills, mcp_servers,
            -- version, output_style, fast_mode_state, apiKeySource).
            -- JSONL does not preserve any of these per-message — the
            -- replay path in `tugcode/src/replay.ts` synthesizes a
            -- bare-name `system_metadata` with every other field empty,
            -- which without persistence would clobber the live values
            -- the user already saw. The bridge captures the live
            -- payload, merges it with the persisted one on every
            -- forward, and rewrites the wire line so the client always
            -- receives the most-informationally-rich version.
            --
            -- Payload is stored as a JSON BLOB rather than per-column
            -- so future Anthropic fields land here without a schema
            -- migration. Trade-off: no indexed queries on individual
            -- fields, but the only access pattern is PK lookup.
            CREATE TABLE IF NOT EXISTS session_metadata (
                session_id  TEXT PRIMARY KEY,
                payload     BLOB NOT NULL,
                captured_at INTEGER NOT NULL
            );

            CREATE TRIGGER IF NOT EXISTS session_metadata_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM session_metadata WHERE session_id = OLD.session_id;
            END;

            -- Latest per-session `/context`-style breakdown — one row
            -- per session, UPSERT on receipt of a
            -- `record_context_breakdown` inbound action from tugdeck.
            -- The reducer dispatches the action after consuming each
            -- `context_breakdown` frame from tugcode, mirroring the
            -- `record_turn_telemetry` pattern (reducer is the
            -- persistence boundary; supervisor writes; ledger stores).
            --
            -- Read at session bind so the snapshot's
            -- `lastContextBreakdown` populates before the popover
            -- opens, then overwritten by the next live
            -- `context_breakdown` frame.
            --
            -- Payload is stored as a JSON BLOB rather than per-column
            -- so future categories (or the deprecation of existing
            -- ones, if Anthropic reshapes `/context`) land here
            -- without a schema migration. Trade-off: no indexed
            -- queries on individual category tokens, but the only
            -- access pattern is PK lookup by session_id. Mirrors the
            -- `session_metadata` decision in the same file. The wire-
            -- frame TypeScript types validate the payload shape on
            -- both write and read paths; the sqlite layer is pure
            -- persistence.
            --
            -- MCP is intentionally absent from the wire frame's
            -- categories union, so no MCP bytes ever reach this table.
            CREATE TABLE IF NOT EXISTS context_breakdown_latest (
                session_id  TEXT PRIMARY KEY,
                payload     BLOB NOT NULL,
                captured_at INTEGER NOT NULL
            );

            CREATE TRIGGER IF NOT EXISTS context_breakdown_latest_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM context_breakdown_latest WHERE session_id = OLD.session_id;
            END;

            -- Append-only log of indicator-tone triple transitions —
            -- one row per distinct `(phase, transport_state,
            -- interrupt_in_flight)` change for a given session.
            -- Written by `record_session_state_change` from the
            -- supervisor's inbound handler, after tugdeck's dispatch-
            -- wrapper observes the triple has changed. Read by the
            -- popover (Step 20.4.9) via `list_session_state_changes`.
            --
            -- Per-column storage (not BLOB) because the popover's
            -- access pattern reads structured fields and the row shape
            -- is small + fixed by the indicator's prop set. Promoting
            -- a new tone-bearing axis means co-evolving indicator
            -- props, matrix definitions, and this schema in the same
            -- step.
            --
            -- Dedupe: the writer skips the insert if the new triple
            -- equals the most recent persisted triple for the session.
            -- The SQL layer trusts the writer; no UNIQUE constraint
            -- (the natural-key set is the triple plus its position in
            -- the history, which the autoincrement PK already covers).
            CREATE TABLE IF NOT EXISTS session_state_changes (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id          TEXT NOT NULL,
                at_ms               INTEGER NOT NULL,
                phase               TEXT NOT NULL,
                transport_state     TEXT NOT NULL,
                interrupt_in_flight INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS session_state_changes_session_at
                ON session_state_changes(session_id, at_ms);

            CREATE TRIGGER IF NOT EXISTS session_state_changes_cascade_delete_on_session
            AFTER DELETE ON sessions
            FOR EACH ROW
            BEGIN
                DELETE FROM session_state_changes WHERE session_id = OLD.session_id;
            END;
            ",
        )?;
        Ok(())
    }

    /// The `(name, declared-type)` columns of `table`, in definition
    /// order, as `PRAGMA table_info` reports them. Empty when the
    /// table does not exist.
    fn table_columns(conn: &Connection, table: &str) -> Result<Vec<(String, String)>, LedgerError> {
        // `table` is a compile-time constant from `bootstrap_schema`,
        // never caller input — the `format!` carries no injection risk.
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;
        let mut columns = Vec::new();
        for row in rows {
            columns.push(row?);
        }
        Ok(columns)
    }

    /// One-shot rename: the `sessions.first_user_prompt` column became
    /// `last_user_prompt` when the picker switched from "first prompt
    /// ever" to "most recent prompt" semantics. Existing values stay —
    /// they become the most-recent prompt until the next user message
    /// overwrites them. No-op when the table is absent (fresh DB) or
    /// the rename has already run.
    fn migrate_sessions_first_to_last_user_prompt(conn: &Connection) -> Result<(), LedgerError> {
        let cols = Self::table_columns(conn, "sessions")?;
        let has_old = cols.iter().any(|(n, _)| n == "first_user_prompt");
        let has_new = cols.iter().any(|(n, _)| n == "last_user_prompt");
        if has_old && !has_new {
            conn.execute(
                "ALTER TABLE sessions RENAME COLUMN first_user_prompt TO last_user_prompt",
                [],
            )?;
        }
        Ok(())
    }

    /// Self-healing add of the `sessions.name` column ([#step-13d], `/rename`).
    /// A no-op when the table is absent (the `CREATE TABLE IF NOT EXISTS` below
    /// then defines `name` directly) or already has the column — so it only
    /// ALTERs a pre-existing table that predates the column.
    fn migrate_sessions_add_name(conn: &Connection) -> Result<(), LedgerError> {
        let cols = Self::table_columns(conn, "sessions")?;
        if cols.is_empty() {
            return Ok(());
        }
        if !cols.iter().any(|(n, _)| n == "name") {
            conn.execute("ALTER TABLE sessions ADD COLUMN name TEXT", [])?;
        }
        Ok(())
    }

    /// Drop `table` when its on-disk column set no longer matches
    /// `expected` — the [DM08] delete-and-recreate, made automatic.
    /// No-op when the table is absent (the `CREATE TABLE IF NOT EXISTS`
    /// will build it fresh) or already matches. See the call site in
    /// {@link bootstrap_schema} for the rationale.
    fn rebuild_table_if_schema_drifted(
        conn: &Connection,
        table: &str,
        expected: &[(&str, &str)],
    ) -> Result<(), LedgerError> {
        let actual = Self::table_columns(conn, table)?;
        if actual.is_empty() {
            return Ok(());
        }
        let matches = actual.len() == expected.len()
            && actual
                .iter()
                .zip(expected)
                .all(|((an, at), (en, et))| an.as_str() == *en && at.as_str() == *et);
        if !matches {
            // Dropping the table also drops its indexes; the
            // cascade trigger lives on `sessions` and survives. The
            // batch below recreates table + index.
            conn.execute(&format!("DROP TABLE {table}"), [])?;
        }
        Ok(())
    }

    /// All rows in the workspace, ordered newest-first by `last_used_at`.
    pub fn list_for_workspace(&self, workspace_key: &str) -> Result<Vec<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, last_user_prompt, state, card_id, name
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
                    turn_count, last_user_prompt, state, card_id, name
             FROM sessions
             WHERE project_dir = ?1
             ORDER BY last_used_at DESC",
        )?;
        let rows = stmt
            .query_map(params![project_dir], row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    }

    /// All non-failed rows that carry a `card_id`, ordered newest-first
    /// by `last_used_at`. The client-side restore consumes this through
    /// the `list_card_bindings` CONTROL verb: for each dev card in the
    /// deck, the most recent matching row drives either
    /// `spawn_session(mode=resume)` (if `turn_count > 0`, i.e. claude
    /// has a JSONL on disk) or `spawn_session(mode=new)` with a fresh
    /// session id but the same `project_dir` (if `turn_count == 0`,
    /// the card was bound to a project but no real conversation
    /// happened). Either way the card opens to its bound project on
    /// relaunch — no picker, no misleading "Couldn't resume" banner.
    ///
    /// Filters:
    ///
    /// - `card_id IS NOT NULL` — the row was spawned through a dev
    ///   card path (not a headless test).
    /// - `state != 'failed'` — failed rows are known-unrecoverable.
    pub fn list_with_card_id(&self) -> Result<Vec<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, last_user_prompt, state, card_id, name
             FROM sessions
             WHERE card_id IS NOT NULL
               AND state != 'failed'
             ORDER BY last_used_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().collect()
    }

    /// Look up a single row by session id.
    pub fn get(&self, session_id: &str) -> Result<Option<SessionRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_key, project_dir, created_at, last_used_at,
                    turn_count, last_user_prompt, state, card_id, name
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
                last_user_prompt, state, card_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, 'live', ?6)
             ON CONFLICT(session_id) DO UPDATE SET
                workspace_key = excluded.workspace_key,
                project_dir   = excluded.project_dir,
                last_used_at  = excluded.last_used_at,
                state         = 'live',
                card_id       = excluded.card_id",
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

    /// Set `last_user_prompt` to the supplied snippet, overwriting any
    /// previous value. The picker shows this so the user recognizes
    /// the most-recent thread of conversation. The caller is responsible
    /// for truncation; the `truncate_user_prompt` helper is provided for
    /// consistency.
    pub fn record_user_prompt(&self, session_id: &str, prompt: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let affected = conn.execute(
            "UPDATE sessions
             SET last_user_prompt = ?2
             WHERE session_id = ?1",
            params![session_id, prompt],
        )?;
        if affected == 0 {
            return Err(LedgerError::NotFound(session_id.to_owned()));
        }
        Ok(())
    }

    /// Set (or clear) the user-assigned session `name` ([#step-13d], `/rename`).
    /// `None` clears it. Survives re-spawn/resume since `record_spawn` never
    /// touches the column. `NotFound` if the session id is unknown.
    pub fn rename(&self, session_id: &str, name: Option<&str>) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let affected = conn.execute(
            "UPDATE sessions
             SET name = ?2
             WHERE session_id = ?1",
            params![session_id, name],
        )?;
        if affected == 0 {
            return Err(LedgerError::NotFound(session_id.to_owned()));
        }
        Ok(())
    }

    /// Increment `turn_count` and bump `last_used_at`. No-op if the row is
    /// not in `live` state — see the `trash` race-mitigation note in the
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

    /// Transition a row to `closed`. `card_id` is preserved across
    /// transitions so the client-side restore can ask "which session
    /// was last bound to this card?" after a tugcast restart.
    pub fn mark_closed(&self, session_id: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "UPDATE sessions
             SET state = 'closed'
             WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// Transition a row to `failed`. Replaces the previous "remove on
    /// resume_failed" semantics — the row is retained as a diagnostic crumb.
    /// `card_id` is preserved across transitions; see [`mark_closed`].
    pub fn mark_failed(&self, session_id: &str) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "UPDATE sessions
             SET state = 'failed'
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
    pub fn trash(&self, session_id: &str) -> Result<TrashOutcome, LedgerError> {
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
                    "cannot trash a live session".to_owned(),
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
        Ok(TrashOutcome {
            session_id: session_id.to_owned(),
            jsonl_moved_to: trash_path,
        })
    }

    /// Drop every non-live row whose `project_dir` matches `project_dir`
    /// literally and move each row's JSONL to trash. Returns the session
    /// ids of the dropped rows so the caller can broadcast `session_updated
    /// { removed: true }` pushes. Used by recents-eviction → ledger-eviction
    /// coupling: when a dev recent-projects entry ages out, the matching
    /// ledger rows are dropped in lockstep so the picker doesn't surface
    /// sessions for a path the user no longer recognizes. The JSONLs go to
    /// trash so the user can `mv` them back if they recognize the loss.
    pub fn trash_for_project_dir(&self, project_dir: &str) -> Result<Vec<String>, LedgerError> {
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
             SET state = 'closed'
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

    /// Upsert one `turn_telemetry` row. Idempotent on
    /// `(session_id, msg_id)` via `INSERT OR REPLACE` — the supervisor
    /// may receive a repeat `record_turn_telemetry` from a reconnecting
    /// client that already committed the same turn locally, and the
    /// repeat should be a no-op write (same values overwriting same
    /// values), not a duplicate-key error.
    ///
    /// Single statement; sqlite's implicit per-statement transaction is
    /// enough. No explicit transaction needed for the write cadence we
    /// expect (one per `turn_complete`).
    pub fn record_turn_telemetry(&self, row: &TurnTelemetryRow) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "INSERT OR REPLACE INTO turn_telemetry (
                session_id, msg_id,
                input_tokens, output_tokens,
                cache_creation_input_tokens, cache_read_input_tokens,
                total_cost_usd,
                wall_clock_ms, awaiting_approval_ms, transport_downtime_ms, active_ms,
                ttft_ms, ttftc_ms,
                reconnect_count, max_stream_gap_ms,
                ended_at,
                session_init_tokens
            ) VALUES (
                ?1, ?2,
                ?3, ?4,
                ?5, ?6,
                ?7,
                ?8, ?9, ?10, ?11,
                ?12, ?13,
                ?14, ?15,
                ?16,
                ?17
            )",
            params![
                row.session_id,
                row.msg_id,
                row.input_tokens,
                row.output_tokens,
                row.cache_creation_input_tokens,
                row.cache_read_input_tokens,
                row.total_cost_usd,
                row.wall_clock_ms,
                row.awaiting_approval_ms,
                row.transport_downtime_ms,
                row.active_ms,
                row.ttft_ms,
                row.ttftc_ms,
                row.reconnect_count,
                row.max_stream_gap_ms,
                row.ended_at,
                row.session_init_tokens,
            ],
        )?;
        Ok(())
    }

    /// All telemetry rows for a session, ordered oldest-to-newest by
    /// `ended_at`. The supervisor's replay path builds a
    /// `HashMap<msg_id, TurnTelemetryRow>` from this and inlines the
    /// matching row onto each replayed `turn_complete` event.
    pub fn list_turn_telemetry(
        &self,
        session_id: &str,
    ) -> Result<Vec<TurnTelemetryRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT session_id, msg_id,
                    input_tokens, output_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens,
                    total_cost_usd,
                    wall_clock_ms, awaiting_approval_ms, transport_downtime_ms, active_ms,
                    ttft_ms, ttftc_ms,
                    reconnect_count, max_stream_gap_ms,
                    ended_at,
                    session_init_tokens
             FROM turn_telemetry
             WHERE session_id = ?1
             ORDER BY ended_at ASC, msg_id ASC",
        )?;
        let rows = stmt
            .query_map(params![session_id], turn_telemetry_row_from_query)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Upsert one `session_metadata` row. Idempotent on `session_id`
    /// via `INSERT OR REPLACE` — the bridge intercept runs the merge
    /// on every outbound `system_metadata` line, so a steady-state
    /// session writes the same merged payload on every subsequent
    /// hit, which should be a no-op overwrite, not a duplicate-key
    /// error.
    ///
    /// `payload` is the merged JSON serialized as bytes. The merge
    /// itself happens in `merge_session_metadata` (this method is the
    /// pure persistence write).
    pub fn record_session_metadata(
        &self,
        session_id: &str,
        payload: &[u8],
        captured_at: i64,
    ) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "INSERT OR REPLACE INTO session_metadata (session_id, payload, captured_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, payload, captured_at],
        )?;
        Ok(())
    }

    /// Fetch the persisted `session_metadata` row for `session_id`, or
    /// `None` if no row exists (first-observation case; the merge
    /// degenerates to "take incoming verbatim").
    pub fn get_session_metadata(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionMetadataRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let row = conn
            .query_row(
                "SELECT session_id, payload, captured_at
                 FROM session_metadata
                 WHERE session_id = ?1",
                params![session_id],
                |row| {
                    Ok(SessionMetadataRow {
                        session_id: row.get(0)?,
                        payload: row.get(1)?,
                        captured_at: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Upsert the per-session `/context`-style breakdown. Idempotent on
    /// `session_id` via `INSERT OR REPLACE` — every fresh frame from
    /// tugcode produces one persist action, and the only persisted row
    /// for a session is always the most recent.
    ///
    /// `payload` is the wire-frame JSON serialized as bytes (the
    /// supervisor receives the frame, hands the raw payload here, and
    /// re-emits the same bytes at bind time). This module does not
    /// parse or validate the payload — the wire-frame TypeScript
    /// types do that on both ends.
    pub fn record_context_breakdown(
        &self,
        session_id: &str,
        payload: &[u8],
        captured_at: i64,
    ) -> Result<(), LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        conn.execute(
            "INSERT OR REPLACE INTO context_breakdown_latest (session_id, payload, captured_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, payload, captured_at],
        )?;
        Ok(())
    }

    /// Fetch the persisted breakdown row for `session_id`, or `None`
    /// if no row exists. The popover's fallback path renders the
    /// pre-existing `cost_update`-derived view when `None` — see the
    /// "Fallback contract" section of the parent plan step.
    pub fn get_context_breakdown(
        &self,
        session_id: &str,
    ) -> Result<Option<ContextBreakdownRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let row = conn
            .query_row(
                "SELECT session_id, payload, captured_at
                 FROM context_breakdown_latest
                 WHERE session_id = ?1",
                params![session_id],
                |row| {
                    Ok(ContextBreakdownRow {
                        session_id: row.get(0)?,
                        payload: row.get(1)?,
                        captured_at: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Append a `session_state_changes` row for `session_id`. Dedupes
    /// against the most recent persisted row for the same session: if
    /// the new `(phase, transport_state, interrupt_in_flight)` triple
    /// equals the most recent row's triple, this is a no-op (the
    /// caller has already deduped locally; this is the SQL-layer
    /// safety net for races where two dispatches see the same
    /// previous-state but one writes its row before the other
    /// finishes its comparison).
    ///
    /// Returns `Ok(true)` if a row was written, `Ok(false)` if the
    /// dedupe skipped it.
    pub fn record_session_state_change(
        &self,
        session_id: &str,
        at_ms: i64,
        phase: &str,
        transport_state: &str,
        interrupt_in_flight: bool,
    ) -> Result<bool, LedgerError> {
        let mut conn = self.db.lock().expect("ledger mutex");
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let most_recent: Option<(String, String, i64)> = tx
            .query_row(
                "SELECT phase, transport_state, interrupt_in_flight
                 FROM session_state_changes
                 WHERE session_id = ?1
                 ORDER BY id DESC
                 LIMIT 1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((prev_phase, prev_transport, prev_interrupt)) = most_recent {
            let prev_interrupt_bool = prev_interrupt != 0;
            if prev_phase == phase
                && prev_transport == transport_state
                && prev_interrupt_bool == interrupt_in_flight
            {
                return Ok(false);
            }
        }
        tx.execute(
            "INSERT INTO session_state_changes
                (session_id, at_ms, phase, transport_state, interrupt_in_flight)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                session_id,
                at_ms,
                phase,
                transport_state,
                interrupt_in_flight as i64,
            ],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// Return every `session_state_changes` row for `session_id`,
    /// oldest-first by `id` (which is monotonic). Empty vec if no rows
    /// exist for the session.
    pub fn list_session_state_changes(
        &self,
        session_id: &str,
    ) -> Result<Vec<SessionStateChangeRow>, LedgerError> {
        let conn = self.db.lock().expect("ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT id, session_id, at_ms, phase, transport_state, interrupt_in_flight
             FROM session_state_changes
             WHERE session_id = ?1
             ORDER BY id ASC",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                let interrupt_int: i64 = row.get(5)?;
                Ok(SessionStateChangeRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    at_ms: row.get(2)?,
                    phase: row.get(3)?,
                    transport_state: row.get(4)?,
                    interrupt_in_flight: interrupt_int != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
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
    let last_user_prompt: Option<String> = row.get(6)?;
    let state_str: String = row.get(7)?;
    let card_id: Option<String> = row.get(8)?;
    let name: Option<String> = row.get(9)?;
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
        last_user_prompt,
        state,
        card_id,
        name,
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

/// Decode one row from a `SELECT … FROM turn_telemetry` cursor matching
/// the column order in `list_turn_telemetry`. No fallible decode beyond
/// rusqlite's own type coercion — every column is a fixed scalar — so
/// the outer `Result` wrapper just keeps the function-signature shape
/// consistent with the other row decoders in this module.
fn turn_telemetry_row_from_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<TurnTelemetryRow> {
    Ok(TurnTelemetryRow {
        session_id: row.get(0)?,
        msg_id: row.get(1)?,
        input_tokens: row.get(2)?,
        output_tokens: row.get(3)?,
        cache_creation_input_tokens: row.get(4)?,
        cache_read_input_tokens: row.get(5)?,
        total_cost_usd: row.get(6)?,
        wall_clock_ms: row.get(7)?,
        awaiting_approval_ms: row.get(8)?,
        transport_downtime_ms: row.get(9)?,
        active_ms: row.get(10)?,
        ttft_ms: row.get(11)?,
        ttftc_ms: row.get(12)?,
        reconnect_count: row.get(13)?,
        max_stream_gap_ms: row.get(14)?,
        ended_at: row.get(15)?,
        session_init_tokens: row.get(16)?,
    })
}

/// Truncate a user-prompt to at most `USER_PROMPT_MAX_CHARS` chars
/// (Unicode-scalar count, not bytes). Cheap helper for callers that
/// want to forward the user's latest message into `record_user_prompt`.
pub fn truncate_user_prompt(prompt: &str) -> String {
    if prompt.chars().count() <= USER_PROMPT_MAX_CHARS {
        return prompt.to_owned();
    }
    prompt.chars().take(USER_PROMPT_MAX_CHARS).collect()
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
        target: "dev::session-lifecycle",
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
            target: "dev::session-lifecycle",
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
        assert_eq!(row.last_user_prompt, None);
        assert_eq!(row.state, SessionState::Live);
        assert_eq!(row.card_id.as_deref(), Some("card-1"));
    }

    #[test]
    fn record_user_prompt_overwrites_on_each_call() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.record_user_prompt("s1", "Hello, world").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.last_user_prompt.as_deref(), Some("Hello, world"));

        // Subsequent calls overwrite — the picker shows the most-recent
        // prompt, so a later turn replaces the snippet.
        l.record_user_prompt("s1", "Different prompt").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.last_user_prompt.as_deref(), Some("Different prompt"));
    }

    #[test]
    fn record_user_prompt_missing_session_errors() {
        let l = fresh();
        let err = l.record_user_prompt("nope", "Hi").unwrap_err();
        assert!(matches!(err, LedgerError::NotFound(ref id) if id == "nope"));
    }

    #[test]
    fn rename_sets_clears_and_survives_respawn() {
        let l = fresh();
        let now = millis(0);
        seed_live(&l, "s1", WS_A, "card-1", now);
        assert_eq!(l.get("s1").unwrap().unwrap().name, None);

        // Set a name (trimmed by the parser; the ledger stores verbatim).
        l.rename("s1", Some("My session")).unwrap();
        assert_eq!(l.get("s1").unwrap().unwrap().name.as_deref(), Some("My session"));

        // A re-spawn (resume) must NOT clear the name.
        l.record_spawn("s1", WS_A, "/proj", "card-1", now + 1_000).unwrap();
        assert_eq!(l.get("s1").unwrap().unwrap().name.as_deref(), Some("My session"));

        // Clearing sets it back to NULL.
        l.rename("s1", None).unwrap();
        assert_eq!(l.get("s1").unwrap().unwrap().name, None);
    }

    #[test]
    fn rename_missing_session_errors() {
        let l = fresh();
        let err = l.rename("nope", Some("X")).unwrap_err();
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
    fn mark_closed_preserves_card_binding() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Closed);
        // card_id is preserved across the close transition so the
        // client-side restore can reconstruct the card→session map.
        assert_eq!(r.card_id.as_deref(), Some("card-1"));
    }

    #[test]
    fn mark_failed_retains_row_and_card_binding() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.mark_failed("s1").unwrap();
        let r = l.get("s1").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Failed);
        assert_eq!(r.card_id.as_deref(), Some("card-1"));
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
        assert_eq!(r.card_id.as_deref(), Some("card-2"));
    }

    // ── list_with_card_id ────────────────────────────────────────────────────

    /// Both turn-having and zero-turn rows are returned. The client
    /// distinguishes them by `turn_count` and uses `mode=resume` for
    /// real conversations, `mode=new` (with same project_dir) for
    /// bound-but-empty sessions. This keeps the card's project
    /// binding across relaunches even when no conversation happened
    /// before the user quit.
    #[test]
    fn list_with_card_id_includes_zero_turn_rows() {
        let l = fresh();
        // s_used: had a real conversation.
        seed_live(&l, "s_used", WS_A, "card-1", millis(1));
        l.record_turn("s_used", millis(2)).unwrap();
        // s_unused: spawn happened but no turns. Still surfaced so
        // the client retains the card→project binding on restore.
        seed_live(&l, "s_unused", WS_A, "card-2", millis(3));

        let rows = l.list_with_card_id().unwrap();
        let mut ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["s_unused", "s_used"]);
        // turn_count is preserved on the row so the client can branch.
        let used = rows.iter().find(|r| r.session_id == "s_used").unwrap();
        let unused = rows.iter().find(|r| r.session_id == "s_unused").unwrap();
        assert_eq!(used.turn_count, 1);
        assert_eq!(unused.turn_count, 0);
    }

    /// `card_id IS NULL` rows (headless tests, pre-binding spawns) are
    /// also excluded — restore is per-card, so a row without a card
    /// can't be matched to any deck card.
    #[test]
    fn list_with_card_id_excludes_null_card_id() {
        let l = fresh();
        // Insert a row directly with no card binding by recording a
        // spawn under "(empty)" then nulling the binding. The
        // `record_spawn` API requires a card_id, so we use raw SQL.
        let conn = l.db.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (session_id, workspace_key, project_dir,
                                   created_at, last_used_at, turn_count,
                                   last_user_prompt, state, card_id)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL, 'live', NULL)",
            params!["headless", WS_A, "/proj", millis(0), millis(0)],
        )
        .unwrap();
        drop(conn);

        let rows = l.list_with_card_id().unwrap();
        assert!(rows.is_empty());
    }

    /// `state == 'failed'` rows are excluded — they're known
    /// unrecoverable, restoring would just resume_failed again.
    #[test]
    fn list_with_card_id_excludes_failed_rows() {
        let l = fresh();
        seed_live(&l, "s_failed", WS_A, "card-1", millis(0));
        l.record_turn("s_failed", millis(1)).unwrap();
        l.mark_failed("s_failed").unwrap();

        seed_live(&l, "s_ok", WS_A, "card-2", millis(2));
        l.record_turn("s_ok", millis(3)).unwrap();

        let rows = l.list_with_card_id().unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s_ok"]);
    }

    /// Closed rows that had real turns are still resumable — that's
    /// the whole point: a card whose user had a conversation, closed
    /// it, then reopened expects to see history.
    #[test]
    fn list_with_card_id_includes_closed_rows_with_turns() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "card-1", millis(0));
        l.record_turn("s1", millis(1)).unwrap();
        l.mark_closed("s1").unwrap();

        let rows = l.list_with_card_id().unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s1"]);
        assert_eq!(rows[0].state, SessionState::Closed);
        assert_eq!(rows[0].card_id.as_deref(), Some("card-1"));
    }

    /// Newest-first ordering by `last_used_at` so the client can pick
    /// the most recent binding per card. `millis(N)` returns a
    /// timestamp N days *ago*, so smaller `N` is more recent.
    #[test]
    fn list_with_card_id_orders_newest_first() {
        let l = fresh();
        // "fresh" was used most recently (smallest days-ago).
        seed_live(&l, "fresh", WS_A, "card-1", millis(5));
        l.record_turn("fresh", millis(1)).unwrap();
        // "stale" was used long ago.
        seed_live(&l, "stale", WS_A, "card-2", millis(20));
        l.record_turn("stale", millis(15)).unwrap();
        // "mid" sits between them.
        seed_live(&l, "mid", WS_A, "card-3", millis(10));
        l.record_turn("mid", millis(8)).unwrap();

        let rows = l.list_with_card_id().unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["fresh", "mid", "stale"]);
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

    // ── trash ───────────────────────────────────────────────────────────────

    #[test]
    fn trash_removes_closed_row() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c1", millis(0));
        l.mark_closed("s1").unwrap();

        let outcome = l.trash("s1").unwrap();
        assert_eq!(outcome.session_id, "s1");
        assert_eq!(outcome.jsonl_moved_to, None);
        assert!(l.get("s1").unwrap().is_none());
    }

    #[test]
    fn trash_refuses_live_row() {
        let l = fresh();
        seed_live(&l, "s1", WS_A, "c1", millis(0));
        let err = l.trash("s1").unwrap_err();
        assert!(matches!(err, LedgerError::InvalidState(_)));
        assert!(l.get("s1").unwrap().is_some(), "row must remain");
    }

    #[test]
    fn trash_missing_session_errors() {
        let l = fresh();
        let err = l.trash("nope").unwrap_err();
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
            .evict_oldest_closed(WS_A, DEV_LEDGER_MAX_PER_WORKSPACE)
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
            .evict_oldest_closed(WS_A, DEV_LEDGER_MAX_PER_WORKSPACE)
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
            .evict_oldest_closed(WS_A, DEV_LEDGER_MAX_PER_WORKSPACE)
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
        let max_age_ms = DEV_LEDGER_MAX_AGE_DAYS * 86_400_000;

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
        let max_age_ms = DEV_LEDGER_MAX_AGE_DAYS * 86_400_000;

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
        let max_age_ms = DEV_LEDGER_MAX_AGE_DAYS * 86_400_000;

        seed_live(&l, "stale", WS_A, "c", millis(120));
        l.mark_failed("stale").unwrap();

        let swept = l.sweep_expired(max_age_ms, now).unwrap();
        assert_eq!(swept, vec!["stale".to_owned()]);
        assert!(l.get("stale").unwrap().is_none());
    }

    // ── trash_for_project_dir ───────────────────────────────────────────────

    #[test]
    fn trash_for_project_dir_drops_matching_rows_only() {
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

        let dropped = l.trash_for_project_dir("/proj").unwrap();
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
        // card_id is preserved across the demote transition so the
        // client-side restore retains the binding after a tugcast crash.
        assert_eq!(r.card_id.as_deref(), Some("c1"));

        let r = l.get("live2").unwrap().unwrap();
        assert_eq!(r.state, SessionState::Closed);
        assert_eq!(r.card_id.as_deref(), Some("c2"));

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
    fn truncate_user_prompt_truncates_at_char_count_not_bytes() {
        // A multi-byte char repeated past the limit must not be sliced
        // mid-codepoint (`String::truncate` would panic; chars().take is
        // safe).
        let s: String = "🌊".repeat(USER_PROMPT_MAX_CHARS + 5);
        let out = truncate_user_prompt(&s);
        assert_eq!(out.chars().count(), USER_PROMPT_MAX_CHARS);
    }

    #[test]
    fn truncate_user_prompt_returns_short_inputs_unchanged() {
        let s = "Hello, world";
        assert_eq!(truncate_user_prompt(s), s);
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
    fn trash_moves_jsonl_to_trash() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        write_jsonl(tmp.path(), "/proj/x", "sess-doomed");

        l.record_spawn("sess-doomed", "ws-1", "/proj/x", "c1", millis(0))
            .unwrap();
        l.mark_closed("sess-doomed").unwrap();

        let outcome = l.trash("sess-doomed").unwrap();
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
    fn trash_succeeds_even_when_jsonl_is_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());
        // No JSONL on disk — only the ledger row.
        l.record_spawn("ghost", "ws-1", "/proj/x", "c1", millis(0))
            .unwrap();
        l.mark_closed("ghost").unwrap();

        let outcome = l.trash("ghost").unwrap();
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
    /// — the very path that creates the orphan (Trash every row for a
    /// project) leaves no ledger trace pointing back at the trash dir.
    #[test]
    fn sweep_trash_recovers_orphaned_project_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let l = fresh_ledger_with_root(tmp.path());

        // Build a trash subdir under a project_dir that the ledger has
        // NO rows for — simulating the post-Trash-everything state.
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
        // Pin the `turns_cascade_delete_on_session` trigger: trashing
        // a session also removes its journal rows.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        l.insert_pending_turn("s1", "j1", "to be cascaded", &[], millis(0))
            .unwrap();
        assert_eq!(l.list_pending_turns_for_session("s1").unwrap().len(), 1,);

        l.trash("s1").unwrap();

        assert_eq!(
            l.list_pending_turns_for_session("s1").unwrap().len(),
            0,
            "cascade trigger must purge journal rows when the parent session row is deleted",
        );
    }

    // ---- turn_telemetry table ------------------------------------------

    fn sample_telemetry(session_id: &str, msg_id: &str, ended_at: i64) -> TurnTelemetryRow {
        TurnTelemetryRow {
            session_id: session_id.to_owned(),
            msg_id: msg_id.to_owned(),
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            total_cost_usd: 0.0123,
            wall_clock_ms: 4_000,
            awaiting_approval_ms: 200,
            transport_downtime_ms: 100,
            active_ms: 3_700,
            ttft_ms: Some(150),
            ttftc_ms: Some(300),
            reconnect_count: 0,
            max_stream_gap_ms: 90,
            ended_at,
            session_init_tokens: Some(18_575),
        }
    }

    #[test]
    fn record_turn_telemetry_round_trip_preserves_every_field() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let row = sample_telemetry("s1", "msg-A", 1_000);
        l.record_turn_telemetry(&row).unwrap();
        let read = l.list_turn_telemetry("s1").unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0], row);
    }

    #[test]
    fn record_turn_telemetry_persists_null_session_init_tokens() {
        // `window(0)` is nullable — a session that never observed a
        // first telemetry iteration records `None`, round-tripped as
        // SQL NULL.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let mut row = sample_telemetry("s1", "msg-A", 1_000);
        row.session_init_tokens = None;
        l.record_turn_telemetry(&row).unwrap();
        let read = l.list_turn_telemetry("s1").unwrap();
        assert_eq!(read[0].session_init_tokens, None);
    }

    #[test]
    fn opening_a_db_with_a_drifted_turn_telemetry_schema_rebuilds_it() {
        // Reproduces the silent-telemetry-loss failure: a DB created
        // before a `turn_telemetry` column change keeps its stale
        // shape, and every post-change `INSERT` fails. The bootstrap
        // guard must DROP the drifted table so the `CREATE TABLE`
        // rebuilds it — without it, this is invisible data loss.
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();
        // A `turn_telemetry` of the prior 16-column shape (no
        // `session_init_tokens`), carrying a row.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE turn_telemetry (
                    session_id                  TEXT NOT NULL,
                    msg_id                      TEXT NOT NULL,
                    input_tokens                INTEGER NOT NULL DEFAULT 0,
                    output_tokens               INTEGER NOT NULL DEFAULT 0,
                    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
                    total_cost_usd              REAL    NOT NULL DEFAULT 0,
                    wall_clock_ms               INTEGER NOT NULL DEFAULT 0,
                    awaiting_approval_ms        INTEGER NOT NULL DEFAULT 0,
                    transport_downtime_ms       INTEGER NOT NULL DEFAULT 0,
                    active_ms                   INTEGER NOT NULL DEFAULT 0,
                    ttft_ms                     INTEGER,
                    ttftc_ms                    INTEGER,
                    reconnect_count             INTEGER NOT NULL DEFAULT 0,
                    max_stream_gap_ms           INTEGER NOT NULL DEFAULT 0,
                    ended_at                    INTEGER NOT NULL,
                    PRIMARY KEY (session_id, msg_id)
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO turn_telemetry (session_id, msg_id, ended_at)
                 VALUES ('stale', 'm', 1)",
                [],
            )
            .unwrap();
        }
        // Open via SessionLedger — bootstrap's guard sees the drift
        // and rebuilds the table.
        let l = SessionLedger::open(&path).unwrap();
        // A write that lists `session_init_tokens` now succeeds — it
        // would have failed against the stale 16-column shape.
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let row = sample_telemetry("s1", "msg-A", 1_000);
        l.record_turn_telemetry(&row).unwrap();
        assert_eq!(l.list_turn_telemetry("s1").unwrap(), vec![row]);
        // The rebuild dropped the stale row — recreate, not migrate.
        assert_eq!(l.list_turn_telemetry("stale").unwrap().len(), 0);
    }

    #[test]
    fn bootstrap_leaves_a_matching_turn_telemetry_untouched() {
        // The guard is a no-op on a current-shape DB: reopening keeps
        // the rows. (Drift-only — never a gratuitous rebuild.)
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();
        {
            let l = SessionLedger::open(&path).unwrap();
            seed_live(&l, "s1", "ws", "card-1", millis(0));
            l.record_turn_telemetry(&sample_telemetry("s1", "msg-A", 1_000))
                .unwrap();
        }
        let l = SessionLedger::open(&path).unwrap();
        assert_eq!(l.list_turn_telemetry("s1").unwrap().len(), 1);
    }

    #[test]
    fn record_turn_telemetry_persists_nullable_ttft_fields_as_null() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let mut row = sample_telemetry("s1", "msg-A", 1_000);
        row.ttft_ms = None;
        row.ttftc_ms = None;
        l.record_turn_telemetry(&row).unwrap();
        let read = l.list_turn_telemetry("s1").unwrap();
        assert_eq!(read[0].ttft_ms, None);
        assert_eq!(read[0].ttftc_ms, None);
    }

    #[test]
    fn record_turn_telemetry_idempotent_on_session_msg_pk() {
        // A repeat write for the same `(session_id, msg_id)` overwrites
        // — INSERT OR REPLACE — instead of erroring on the PK
        // constraint. This is what defends the supervisor's inbound
        // handler against a reconnecting client that re-emits the
        // same `record_turn_telemetry` after recovery.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let row_v1 = sample_telemetry("s1", "msg-A", 1_000);
        l.record_turn_telemetry(&row_v1).unwrap();
        let mut row_v2 = row_v1.clone();
        row_v2.total_cost_usd = 9.99;
        l.record_turn_telemetry(&row_v2).unwrap();
        let read = l.list_turn_telemetry("s1").unwrap();
        assert_eq!(read.len(), 1, "INSERT OR REPLACE keeps one row per PK");
        assert_eq!(read[0].total_cost_usd, 9.99);
    }

    #[test]
    fn list_turn_telemetry_orders_by_ended_at_ascending() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-newest", 3_000))
            .unwrap();
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-middle", 2_000))
            .unwrap();
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-oldest", 1_000))
            .unwrap();
        let read = l.list_turn_telemetry("s1").unwrap();
        let ids: Vec<&str> = read.iter().map(|r| r.msg_id.as_str()).collect();
        assert_eq!(ids, vec!["msg-oldest", "msg-middle", "msg-newest"]);
    }

    #[test]
    fn list_turn_telemetry_filters_by_session() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-1", 1_000))
            .unwrap();
        l.record_turn_telemetry(&sample_telemetry("s2", "msg-1", 1_000))
            .unwrap();
        assert_eq!(l.list_turn_telemetry("s1").unwrap().len(), 1);
        assert_eq!(l.list_turn_telemetry("s2").unwrap().len(), 1);
    }

    #[test]
    fn list_turn_telemetry_empty_for_unknown_session() {
        let l = fresh();
        assert_eq!(l.list_turn_telemetry("never-existed").unwrap().len(), 0);
    }

    #[test]
    fn cascade_delete_removes_turn_telemetry_when_session_deleted() {
        // Pin the `turn_telemetry_cascade_delete_on_session` trigger:
        // trashing a session also removes its telemetry rows. The
        // user-visible "trash cascades" contract extends to telemetry.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-A", 1_000))
            .unwrap();
        l.record_turn_telemetry(&sample_telemetry("s1", "msg-B", 2_000))
            .unwrap();
        assert_eq!(l.list_turn_telemetry("s1").unwrap().len(), 2);

        l.trash("s1").unwrap();

        assert_eq!(
            l.list_turn_telemetry("s1").unwrap().len(),
            0,
            "cascade trigger must purge turn_telemetry rows when the parent session row is deleted",
        );
    }

    // ---- session_metadata table ----------------------------------------

    fn sample_metadata_payload(model: &str) -> Vec<u8> {
        serde_json::json!({
            "type": "system_metadata",
            "session_id": "s1",
            "cwd": "/home/user/project",
            "tools": ["Read", "Bash"],
            "model": model,
            "permissionMode": "default",
            "slash_commands": ["help"],
            "plugins": [],
            "agents": [],
            "skills": ["tugplug:plan"],
            "mcp_servers": [],
            "version": "2.1.105",
            "output_style": "",
            "fast_mode_state": "",
            "apiKeySource": "anthropic",
            "ipc_version": 2,
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn record_session_metadata_round_trip() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let payload = sample_metadata_payload("claude-opus-4-7[1m]");
        l.record_session_metadata("s1", &payload, 5_000).unwrap();
        let read = l.get_session_metadata("s1").unwrap().unwrap();
        assert_eq!(read.session_id, "s1");
        assert_eq!(read.payload, payload);
        assert_eq!(read.captured_at, 5_000);
    }

    #[test]
    fn get_session_metadata_returns_none_for_unknown_session() {
        let l = fresh();
        assert!(l.get_session_metadata("never-existed").unwrap().is_none());
    }

    #[test]
    fn record_session_metadata_idempotent_on_session_pk() {
        // Steady-state operation: the bridge intercept runs the merge
        // on every outbound `system_metadata` line. Writes for the same
        // session must overwrite, not duplicate-key.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let v1 = sample_metadata_payload("claude-opus-4-7");
        let v2 = sample_metadata_payload("claude-opus-4-7[1m]");
        l.record_session_metadata("s1", &v1, 1_000).unwrap();
        l.record_session_metadata("s1", &v2, 2_000).unwrap();
        let read = l.get_session_metadata("s1").unwrap().unwrap();
        assert_eq!(read.payload, v2);
        assert_eq!(read.captured_at, 2_000);
    }

    #[test]
    fn record_session_metadata_accepts_malformed_blob() {
        // The schema column type is BLOB with no JSON validation, so
        // the ledger persists whatever bytes the caller hands it.
        // Round-trip succeeds; downstream JSON deserialization is the
        // bridge's responsibility (and the bridge falls back to
        // pass-through on a parse error — see Task 3).
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let garbage = b"this-is-not-json".to_vec();
        l.record_session_metadata("s1", &garbage, 1_000).unwrap();
        let read = l.get_session_metadata("s1").unwrap().unwrap();
        assert_eq!(read.payload, garbage);
    }

    #[test]
    fn cascade_delete_removes_session_metadata_when_session_deleted() {
        // Pin the `session_metadata_cascade_delete_on_session` trigger:
        // trashing a session also removes its metadata row. Mirrors
        // the `turn_telemetry` cascade contract.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        l.record_session_metadata("s1", &sample_metadata_payload("claude-opus-4-7"), 1_000)
            .unwrap();
        assert!(l.get_session_metadata("s1").unwrap().is_some());

        l.trash("s1").unwrap();

        assert!(
            l.get_session_metadata("s1").unwrap().is_none(),
            "cascade trigger must purge session_metadata when parent session row is deleted",
        );
    }

    // ---- context_breakdown_latest table --------------------------------

    fn sample_breakdown_payload(messages_tokens: i64, autocompact_enabled: bool) -> Vec<u8> {
        let mut categories = vec![
            serde_json::json!({ "id": "system_prompt", "label": "System prompt", "tokens": 4_200 }),
            serde_json::json!({ "id": "system_tools",  "label": "System tools",  "tokens": 9_100 }),
            serde_json::json!({ "id": "custom_agents", "label": "Custom agents", "tokens": 14_600 }),
            serde_json::json!({ "id": "memory_files",  "label": "Memory files",  "tokens": 1_080 }),
            serde_json::json!({ "id": "skills",        "label": "Skills",        "tokens": 10_700 }),
            serde_json::json!({ "id": "messages",      "label": "Messages",      "tokens": messages_tokens }),
        ];
        if autocompact_enabled {
            categories.push(serde_json::json!({
                "id": "autocompact_buffer",
                "label": "Autocompact buffer",
                "tokens": 33_000,
            }));
        }
        serde_json::json!({
            "type": "context_breakdown",
            "tug_session_id": "s1",
            "context_max": 200_000,
            "categories": categories,
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn record_context_breakdown_round_trip() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let payload = sample_breakdown_payload(38_500, false);
        l.record_context_breakdown("s1", &payload, 5_000).unwrap();
        let read = l.get_context_breakdown("s1").unwrap().unwrap();
        assert_eq!(read.session_id, "s1");
        assert_eq!(read.payload, payload);
        assert_eq!(read.captured_at, 5_000);
    }

    #[test]
    fn get_context_breakdown_returns_none_for_unknown_session() {
        let l = fresh();
        assert!(l.get_context_breakdown("never-existed").unwrap().is_none());
    }

    #[test]
    fn record_context_breakdown_idempotent_on_session_pk() {
        // Steady-state operation: tugcode emits a fresh frame on every
        // turn_complete, and the reducer dispatches one persist per
        // frame. Writes for the same session must overwrite, not
        // duplicate-key. Mirrors `record_session_metadata` semantics.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let v1 = sample_breakdown_payload(10_000, false);
        let v2 = sample_breakdown_payload(42_000, true);
        l.record_context_breakdown("s1", &v1, 1_000).unwrap();
        l.record_context_breakdown("s1", &v2, 2_000).unwrap();
        let read = l.get_context_breakdown("s1").unwrap().unwrap();
        assert_eq!(read.payload, v2);
        assert_eq!(read.captured_at, 2_000);
    }

    #[test]
    fn record_context_breakdown_accepts_arbitrary_blob() {
        // The schema column type is BLOB with no JSON validation, so
        // the ledger persists whatever bytes the caller hands it.
        // Round-trip succeeds; downstream JSON deserialization is the
        // supervisor / renderer's responsibility (and the renderer
        // already falls back to the cost_update-derived view on a
        // parse failure — see the "Fallback contract" section of the
        // parent plan step).
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        let garbage = b"this-is-not-json".to_vec();
        l.record_context_breakdown("s1", &garbage, 1_000).unwrap();
        let read = l.get_context_breakdown("s1").unwrap().unwrap();
        assert_eq!(read.payload, garbage);
    }

    #[test]
    fn get_context_breakdown_filters_by_session() {
        // Sessions are isolated; a write to one must not surface on a
        // read of another. The popover binds per-session, so cross-
        // session bleed would surface as the wrong breakdown in the
        // wrong card.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        let p1 = sample_breakdown_payload(10_000, false);
        let p2 = sample_breakdown_payload(88_000, true);
        l.record_context_breakdown("s1", &p1, 1_000).unwrap();
        l.record_context_breakdown("s2", &p2, 1_000).unwrap();
        assert_eq!(l.get_context_breakdown("s1").unwrap().unwrap().payload, p1);
        assert_eq!(l.get_context_breakdown("s2").unwrap().unwrap().payload, p2);
    }

    #[test]
    fn cascade_delete_removes_context_breakdown_when_session_deleted() {
        // Pin the `context_breakdown_latest_cascade_delete_on_session`
        // trigger: trashing a session also removes its breakdown row.
        // The user-visible "trash cascades" contract extends to the
        // context breakdown.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.mark_closed("s1").unwrap();
        l.record_context_breakdown("s1", &sample_breakdown_payload(5_000, false), 1_000)
            .unwrap();
        assert!(l.get_context_breakdown("s1").unwrap().is_some());

        l.trash("s1").unwrap();

        assert!(
            l.get_context_breakdown("s1").unwrap().is_none(),
            "cascade trigger must purge context_breakdown_latest when parent session row is deleted",
        );
    }

    // ---- session_state_changes table -----------------------------------

    #[test]
    fn record_session_state_change_appends_distinct_triples() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        assert!(
            l.record_session_state_change("s1", 100, "idle", "online", false)
                .unwrap()
        );
        assert!(
            l.record_session_state_change("s1", 200, "submitting", "online", false)
                .unwrap()
        );
        assert!(
            l.record_session_state_change("s1", 300, "submitting", "offline", false)
                .unwrap()
        );
        let rows = l.list_session_state_changes("s1").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].phase, "idle");
        assert_eq!(rows[0].transport_state, "online");
        assert!(!rows[0].interrupt_in_flight);
        assert_eq!(rows[1].phase, "submitting");
        assert_eq!(rows[2].transport_state, "offline");
        // ids are monotonic in insertion order
        assert!(rows[0].id < rows[1].id);
        assert!(rows[1].id < rows[2].id);
        // at_ms is preserved verbatim
        assert_eq!(rows[0].at_ms, 100);
        assert_eq!(rows[1].at_ms, 200);
        assert_eq!(rows[2].at_ms, 300);
    }

    #[test]
    fn record_session_state_change_dedupes_against_most_recent_triple() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        assert!(
            l.record_session_state_change("s1", 100, "idle", "online", false)
                .unwrap()
        );
        // Same triple — dedupes (returns false; no row written).
        assert!(
            !l.record_session_state_change("s1", 150, "idle", "online", false)
                .unwrap()
        );
        assert!(
            !l.record_session_state_change("s1", 200, "idle", "online", false)
                .unwrap()
        );
        // A real change — accepted.
        assert!(
            l.record_session_state_change("s1", 300, "submitting", "online", false)
                .unwrap()
        );
        // Now back to the original triple — accepted again, because
        // the dedupe is against the MOST RECENT row, not "has this
        // ever been written."
        assert!(
            l.record_session_state_change("s1", 400, "idle", "online", false)
                .unwrap()
        );
        let rows = l.list_session_state_changes("s1").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].at_ms, 100);
        assert_eq!(rows[1].at_ms, 300);
        assert_eq!(rows[2].at_ms, 400);
    }

    #[test]
    fn record_session_state_change_detects_interrupt_axis_flip() {
        // Dedupe must compare ALL three axes — flipping
        // `interrupt_in_flight` without changing phase or transport
        // produces a new row.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.record_session_state_change("s1", 100, "submitting", "online", false)
            .unwrap();
        assert!(
            l.record_session_state_change("s1", 200, "submitting", "online", true)
                .unwrap()
        );
        assert!(
            l.record_session_state_change("s1", 300, "submitting", "online", false)
                .unwrap()
        );
        let rows = l.list_session_state_changes("s1").unwrap();
        assert_eq!(rows.len(), 3);
        let flags: Vec<bool> = rows.iter().map(|r| r.interrupt_in_flight).collect();
        assert_eq!(flags, vec![false, true, false]);
    }

    #[test]
    fn list_session_state_changes_filters_by_session() {
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        l.record_session_state_change("s1", 100, "idle", "online", false)
            .unwrap();
        l.record_session_state_change("s2", 200, "submitting", "online", false)
            .unwrap();
        l.record_session_state_change("s1", 300, "submitting", "online", false)
            .unwrap();
        let s1 = l.list_session_state_changes("s1").unwrap();
        let s2 = l.list_session_state_changes("s2").unwrap();
        assert_eq!(s1.len(), 2);
        assert_eq!(s2.len(), 1);
        assert!(s1.iter().all(|r| r.session_id == "s1"));
        assert!(s2.iter().all(|r| r.session_id == "s2"));
    }

    #[test]
    fn list_session_state_changes_returns_empty_for_unknown_session() {
        let l = fresh();
        assert_eq!(
            l.list_session_state_changes("never-existed").unwrap().len(),
            0
        );
    }

    #[test]
    fn cascade_delete_removes_session_state_changes_when_session_deleted() {
        // Pin the `session_state_changes_cascade_delete_on_session`
        // trigger: trashing a session must take its state-change log
        // with it. Same "trash cascades" contract as the other
        // session-scoped tables in this file.
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        l.record_session_state_change("s1", 100, "idle", "online", false)
            .unwrap();
        l.record_session_state_change("s1", 200, "submitting", "online", false)
            .unwrap();
        l.mark_closed("s1").unwrap();
        assert_eq!(l.list_session_state_changes("s1").unwrap().len(), 2);

        l.trash("s1").unwrap();

        assert_eq!(
            l.list_session_state_changes("s1").unwrap().len(),
            0,
            "cascade trigger must purge session_state_changes when parent session row is deleted",
        );
    }

    #[test]
    fn record_session_state_change_writes_independently_per_session() {
        // Dedupe is scoped to the session: writing triple X for s1 must
        // not block triple X for s2 (cross-session bleed would mean a
        // popover renders the wrong card's history).
        let l = fresh();
        seed_live(&l, "s1", "ws", "card-1", millis(0));
        seed_live(&l, "s2", "ws", "card-2", millis(0));
        assert!(
            l.record_session_state_change("s1", 100, "idle", "online", false)
                .unwrap()
        );
        assert!(
            l.record_session_state_change("s2", 100, "idle", "online", false)
                .unwrap()
        );
        assert_eq!(l.list_session_state_changes("s1").unwrap().len(), 1);
        assert_eq!(l.list_session_state_changes("s2").unwrap().len(), 1);
    }

    #[test]
    fn default_path_routes_via_tug_instance_id() {
        use std::ffi::OsString;
        use std::sync::Mutex;

        // `default_path` reads from the process environment. Use a mutex
        // to serialize the two cases (set / unset) so other tests using
        // env-var-keyed paths can't race us.
        static ENV_MUTEX: Mutex<()> = Mutex::new(());
        let _guard = ENV_MUTEX.lock().unwrap();

        let prior: Option<OsString> = std::env::var_os("TUG_INSTANCE_ID");
        unsafe {
            std::env::set_var("TUG_INSTANCE_ID", "ledger-test");
        }
        let p = SessionLedger::default_path().expect("default_path with id");
        assert!(
            p.ends_with("Tug/instances/ledger-test/sessions.db"),
            "expected per-instance path, got {}",
            p.display()
        );

        unsafe {
            std::env::remove_var("TUG_INSTANCE_ID");
        }
        let p = SessionLedger::default_path().expect("default_path legacy");
        assert!(
            p.ends_with("sessions.db") && !p.to_string_lossy().contains("/instances/"),
            "expected legacy path, got {}",
            p.display()
        );

        unsafe {
            match prior {
                Some(v) => std::env::set_var("TUG_INSTANCE_ID", v),
                None => std::env::remove_var("TUG_INSTANCE_ID"),
            }
        }
    }
}
