//! ShellLedger — sqlite-backed persistence for shell-route exchanges.
//!
//! Each settled `$`-route command/output exchange is recorded here, keyed by
//! `tug_session_id`. The deck fetches a session's tail on restore via the
//! `list_shell_exchanges` CONTROL read so a Maker ▸ Reload (or app
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

use rusqlite::{Connection, params};
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

/// A card→session summary for {@link ShellLedger::reconcile_orphaned_rows}.
/// The caller (`main`) maps `SessionLedger::list_with_card_id` rows to this,
/// keeping the ledger's most-recent-first (`last_used_at DESC`) order.
#[derive(Debug, Clone)]
pub struct SessionForReconcile {
    pub session_id: String,
    pub card_id: String,
    pub turn_count: i64,
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
        Ok(Self {
            db: Mutex::new(conn),
        })
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

    /// Distinct session ids that currently own at least one exchange.
    pub fn session_ids_with_rows(
        &self,
    ) -> Result<std::collections::HashSet<String>, ShellLedgerError> {
        let conn = self.db.lock().expect("shell ledger mutex");
        let mut stmt = conn.prepare("SELECT DISTINCT tug_session_id FROM shell_exchanges")?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        Ok(ids)
    }

    /// Move every exchange from `from` onto `to`, preserving `seq` (the caller
    /// only re-keys onto an empty target, so seqs stay unique). Returns the
    /// number of rows moved.
    pub fn rekey_session(&self, from: &str, to: &str) -> Result<usize, ShellLedgerError> {
        let conn = self.db.lock().expect("shell ledger mutex");
        let moved = conn.execute(
            "UPDATE shell_exchanges SET tug_session_id = ?2 WHERE tug_session_id = ?1",
            params![from, to],
        )?;
        Ok(moved)
    }

    /// Recover shell rows orphaned by the pre-F1 fresh-spawn bug ([P07]).
    ///
    /// Before F1, a shell-only session (no JSONL, `turn_count == 0`) was
    /// re-spawned under a FRESH session id on relaunch, orphaning its shell
    /// ledger rows (keyed by the old id) while the card bound to the new,
    /// empty session. This moves those rows onto the card's current session so
    /// they show again.
    ///
    /// Conservative by construction — it only acts on a card whose CURRENT
    /// session is itself empty (zero-turn AND no shell rows), i.e. the exact
    /// bug aftermath. If the user has since used the new session (any turn or
    /// shell row), nothing moves. Idempotent: re-keying clears the orphan, so a
    /// second pass finds nothing.
    ///
    /// `sessions` must be ordered most-recent-first per card (the shape
    /// `SessionLedger::list_with_card_id` returns: `last_used_at DESC`).
    pub fn reconcile_orphaned_rows(
        &self,
        sessions: &[SessionForReconcile],
    ) -> Result<usize, ShellLedgerError> {
        let with_rows = self.session_ids_with_rows()?;
        if with_rows.is_empty() {
            return Ok(0);
        }
        // Group by card_id, preserving the caller's most-recent-first order.
        let mut order: Vec<&str> = Vec::new();
        let mut groups: std::collections::HashMap<&str, Vec<&SessionForReconcile>> =
            std::collections::HashMap::new();
        for s in sessions {
            let key = s.card_id.as_str();
            if !groups.contains_key(key) {
                order.push(key);
                groups.insert(key, Vec::new());
            }
            groups.get_mut(key).expect("just inserted").push(s);
        }
        let mut moved_total = 0;
        for card in order {
            let group = &groups[card];
            let primary = group[0];
            // Only touch a card whose CURRENT session is empty — the exact
            // aftermath of the bug. If the new session has any turn or shell
            // row, the user has moved on; leave everything untouched.
            if primary.turn_count > 0 || with_rows.contains(&primary.session_id) {
                continue;
            }
            // Adopt the most-recent OTHER zero-turn session that still owns rows.
            let orphan = group
                .iter()
                .skip(1)
                .find(|s| s.turn_count == 0 && with_rows.contains(&s.session_id));
            if let Some(orphan) = orphan {
                let moved = self.rekey_session(&orphan.session_id, &primary.session_id)?;
                if moved > 0 {
                    tracing::info!(
                        card = %card,
                        from = %orphan.session_id,
                        to = %primary.session_id,
                        moved,
                        "shell ledger: recovered orphaned exchanges onto the card's current session",
                    );
                    moved_total += moved;
                }
            }
        }
        Ok(moved_total)
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

    fn sess(session_id: &str, card_id: &str, turn_count: i64) -> SessionForReconcile {
        SessionForReconcile {
            session_id: session_id.to_string(),
            card_id: card_id.to_string(),
            turn_count,
        }
    }

    #[test]
    fn reconcile_moves_orphan_rows_onto_the_cards_empty_current_session() {
        let led = ShellLedger::open_in_memory().unwrap();
        // The lost session (`old`) has a shell row; the card's current session
        // (`new`) is empty. Ordered most-recent-first: new, old.
        led.record_exchange(&ex("old", "ls", Some(0))).unwrap();
        let sessions = [sess("new", "card-1", 0), sess("old", "card-1", 0)];

        let moved = led.reconcile_orphaned_rows(&sessions).unwrap();
        assert_eq!(moved, 1);
        assert_eq!(led.list_exchanges("old").unwrap().len(), 0);
        let recovered = led.list_exchanges("new").unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].command, "ls");

        // Idempotent: a second pass finds no orphan.
        assert_eq!(led.reconcile_orphaned_rows(&sessions).unwrap(), 0);
    }

    #[test]
    fn reconcile_leaves_a_used_current_session_untouched() {
        let led = ShellLedger::open_in_memory().unwrap();
        led.record_exchange(&ex("old", "ls", Some(0))).unwrap();

        // Current session has a real Claude turn — the user moved on.
        let with_turn = [sess("new", "card-1", 3), sess("old", "card-1", 0)];
        assert_eq!(led.reconcile_orphaned_rows(&with_turn).unwrap(), 0);
        assert_eq!(led.list_exchanges("old").unwrap().len(), 1);

        // Current session already owns a shell row — likewise untouched.
        led.record_exchange(&ex("new", "pwd", Some(0))).unwrap();
        let with_row = [sess("new", "card-1", 0), sess("old", "card-1", 0)];
        assert_eq!(led.reconcile_orphaned_rows(&with_row).unwrap(), 0);
        assert_eq!(led.list_exchanges("old").unwrap().len(), 1);
    }

    #[test]
    fn reconcile_ignores_orphans_from_a_different_card() {
        let led = ShellLedger::open_in_memory().unwrap();
        led.record_exchange(&ex("old", "ls", Some(0))).unwrap();
        // `old` belongs to card-2, the empty current session to card-1 — no
        // cross-card adoption.
        let sessions = [sess("new", "card-1", 0), sess("old", "card-2", 0)];
        assert_eq!(led.reconcile_orphaned_rows(&sessions).unwrap(), 0);
        assert_eq!(led.list_exchanges("old").unwrap().len(), 1);
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
            led.record_exchange(&ex("s1", &format!("cmd{i}"), Some(0)))
                .unwrap();
        }
        let rows = led.list_exchanges("s1").unwrap();
        assert_eq!(rows.len(), MAX_EXCHANGES_PER_SESSION);
        // The 5 oldest were evicted; the newest survive.
        assert_eq!(
            rows.last().unwrap().command,
            format!("cmd{}", MAX_EXCHANGES_PER_SESSION + 4)
        );
        assert_eq!(rows.first().unwrap().command, "cmd5");
    }
}
