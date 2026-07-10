//! ShellLedger — sqlite-backed persistence for shell-route exchanges.
//!
//! Each settled `$`-route command/output exchange is recorded here, keyed by
//! `tug_session_id`. The deck fetches a session's tail on restore via the
//! `list_shell_exchanges` CONTROL read so a Developer ▸ Reload (or app
//! relaunch) can reconstruct the transcript's shell rows — the *record* is
//! durable even though the live shell child is not ([Q04], [P07]).
//!
//! Its own sqlite file, separate from `sessions.db`: the two stores have
//! unrelated lifecycles (the session ledger tracks claude sessions; this
//! tracks shell output), and a corrupt shell db must never take the session
//! ledger down. Writes serialize through a single `Mutex<Connection>`.
//!
//! Only *settled* exchanges are recorded (insert-on-`exchange_complete`); an
//! exchange in flight at a crash is lost, which matches the "record of what
//! happened" doctrine — it never settled. Per session the table is capped at
//! [`MAX_EXCHANGES_PER_SESSION`]; the oldest rows past the cap are evicted on
//! insert (logged, not silent).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use tracing::warn;

/// Per-session row cap. Human-typed command volume is modest; the tail is what
/// the transcript needs, so old exchanges age out.
pub const MAX_EXCHANGES_PER_SESSION: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum ShellLedgerError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// A settled exchange to record. `tug_session_id` is the routing key; the
/// per-session `seq` is assigned on insert (monotonic within a session).
#[derive(Debug, Clone)]
pub struct NewShellExchange {
    pub tug_session_id: String,
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub cwd: String,
    pub cwd_after: Option<String>,
    pub started_at_ms: i64,
    pub settled_at_ms: i64,
}

/// A persisted exchange row, serialized into the `list_shell_exchanges_ok`
/// CONTROL response. The deck maps these onto its `ShellExchangeMessage`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ShellExchangeRow {
    pub id: i64,
    pub tug_session_id: String,
    pub seq: i64,
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub cwd: String,
    pub cwd_after: Option<String>,
    pub started_at_ms: i64,
    pub settled_at_ms: i64,
}

pub struct ShellLedger {
    db: Mutex<Connection>,
}

impl ShellLedger {
    /// Default db path: alongside `sessions.db` (per-instance when
    /// `TUG_INSTANCE_ID` is set), named `shell_exchanges.db`.
    pub fn default_path() -> Option<PathBuf> {
        let sessions = crate::session_ledger::SessionLedger::default_path()?;
        Some(sessions.with_file_name("shell_exchanges.db"))
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, ShellLedgerError> {
        let conn = Connection::open(path)?;
        Self::from_conn(conn)
    }

    /// In-memory ledger for tests.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn open_in_memory() -> Result<Self, ShellLedgerError> {
        let conn = Connection::open_in_memory()?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> Result<Self, ShellLedgerError> {
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS shell_exchanges (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                tug_session_id TEXT    NOT NULL,
                seq            INTEGER NOT NULL,
                command        TEXT    NOT NULL,
                output         TEXT    NOT NULL,
                exit_code      INTEGER,
                cwd            TEXT    NOT NULL,
                cwd_after      TEXT,
                started_at_ms  INTEGER NOT NULL,
                settled_at_ms  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_shell_exchanges_session
                ON shell_exchanges(tug_session_id, id);
            ",
        )?;
        Ok(Self { db: Mutex::new(conn) })
    }

    /// Record a settled exchange, assigning the next per-session `seq`, then
    /// evict the oldest rows past the per-session cap (logged).
    pub fn record_exchange(&self, ex: &NewShellExchange) -> Result<(), ShellLedgerError> {
        let conn = self.db.lock().expect("shell ledger mutex");
        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM shell_exchanges WHERE tug_session_id = ?1",
            params![ex.tug_session_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO shell_exchanges
                (tug_session_id, seq, command, output, exit_code, cwd, cwd_after, started_at_ms, settled_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                ex.tug_session_id,
                seq,
                ex.command,
                ex.output,
                ex.exit_code,
                ex.cwd,
                ex.cwd_after,
                ex.started_at_ms,
                ex.settled_at_ms,
            ],
        )?;
        // Cap eviction: delete the oldest rows beyond the cap for this session.
        let evicted = conn.execute(
            "DELETE FROM shell_exchanges
             WHERE tug_session_id = ?1
               AND id NOT IN (
                   SELECT id FROM shell_exchanges
                   WHERE tug_session_id = ?1
                   ORDER BY id DESC LIMIT ?2
               )",
            params![ex.tug_session_id, MAX_EXCHANGES_PER_SESSION as i64],
        )?;
        if evicted > 0 {
            warn!(
                session = %ex.tug_session_id,
                evicted,
                cap = MAX_EXCHANGES_PER_SESSION,
                "shell ledger: evicted oldest exchanges past the per-session cap",
            );
        }
        Ok(())
    }

    /// List a session's exchanges oldest-first (the transcript's natural order).
    pub fn list_exchanges(
        &self,
        tug_session_id: &str,
    ) -> Result<Vec<ShellExchangeRow>, ShellLedgerError> {
        let conn = self.db.lock().expect("shell ledger mutex");
        let mut stmt = conn.prepare(
            "SELECT id, tug_session_id, seq, command, output, exit_code, cwd, cwd_after,
                    started_at_ms, settled_at_ms
             FROM shell_exchanges WHERE tug_session_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt
            .query_map(params![tug_session_id], |row| {
                Ok(ShellExchangeRow {
                    id: row.get(0)?,
                    tug_session_id: row.get(1)?,
                    seq: row.get(2)?,
                    command: row.get(3)?,
                    output: row.get(4)?,
                    exit_code: row.get(5)?,
                    cwd: row.get(6)?,
                    cwd_after: row.get(7)?,
                    started_at_ms: row.get(8)?,
                    settled_at_ms: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ex(sid: &str, cmd: &str, code: Option<i32>) -> NewShellExchange {
        NewShellExchange {
            tug_session_id: sid.to_string(),
            command: cmd.to_string(),
            output: format!("out:{cmd}\n"),
            exit_code: code,
            cwd: "/proj".to_string(),
            cwd_after: Some("/proj".to_string()),
            started_at_ms: 1000,
            settled_at_ms: 1012,
        }
    }

    #[test]
    fn insert_and_list_round_trip_oldest_first() {
        let led = ShellLedger::open_in_memory().unwrap();
        led.record_exchange(&ex("s1", "echo a", Some(0))).unwrap();
        led.record_exchange(&ex("s1", "false", Some(1))).unwrap();
        let rows = led.list_exchanges("s1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].command, "echo a");
        assert_eq!(rows[0].seq, 1);
        assert_eq!(rows[1].command, "false");
        assert_eq!(rows[1].seq, 2);
        assert_eq!(rows[1].exit_code, Some(1));
    }

    #[test]
    fn null_exit_code_round_trips() {
        let led = ShellLedger::open_in_memory().unwrap();
        led.record_exchange(&ex("s1", "sleep 60", None)).unwrap();
        let rows = led.list_exchanges("s1").unwrap();
        assert_eq!(rows[0].exit_code, None);
    }

    #[test]
    fn per_session_isolation() {
        let led = ShellLedger::open_in_memory().unwrap();
        led.record_exchange(&ex("sa", "a1", Some(0))).unwrap();
        led.record_exchange(&ex("sb", "b1", Some(0))).unwrap();
        led.record_exchange(&ex("sa", "a2", Some(0))).unwrap();
        let a = led.list_exchanges("sa").unwrap();
        let b = led.list_exchanges("sb").unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 1);
        // Per-session seq is independent.
        assert_eq!(a[0].seq, 1);
        assert_eq!(a[1].seq, 2);
        assert_eq!(b[0].seq, 1);
    }

    #[test]
    fn cap_evicts_oldest() {
        let led = ShellLedger::open_in_memory().unwrap();
        for i in 0..(MAX_EXCHANGES_PER_SESSION + 5) {
            led.record_exchange(&ex("s1", &format!("cmd{i}"), Some(0))).unwrap();
        }
        let rows = led.list_exchanges("s1").unwrap();
        assert_eq!(rows.len(), MAX_EXCHANGES_PER_SESSION);
        // The 5 oldest were evicted; the newest survive.
        assert_eq!(rows.last().unwrap().command, format!("cmd{}", MAX_EXCHANGES_PER_SESSION + 4));
        assert_eq!(rows.first().unwrap().command, "cmd5");
    }
}
