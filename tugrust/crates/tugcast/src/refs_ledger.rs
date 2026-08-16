//! RefsLedger — the latest match-or-search run, per session.
//!
//! Exactly one run is kept for each `tug_session_id`: a completed run
//! replaces whatever was there. That is the model the original tools had —
//! one refs file each run overwrote — and it is what makes `/ref 3` mean
//! something definite after a reload. The deck reads it back through the
//! `list_refs` CONTROL op when a card mounts.
//!
//! Its own sqlite file, separate from `sessions.db` and from the shell
//! ledger: unrelated lifecycles, and a corrupt search history must never
//! take a session record down. Writes serialize through a single
//! `Mutex<Connection>`.
//!
//! Only a *settled, uncancelled* run is recorded. A run that was cancelled
//! or superseded holds a partial list, and restoring a partial list would
//! silently renumber what `/ref N` resolves to.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::feeds::text_ref::TextRef;

#[derive(Debug, thiserror::Error)]
pub enum RefsLedgerError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// A completed run to record.
#[derive(Debug, Clone)]
pub struct NewRefsRun {
    pub tug_session_id: String,
    pub run_id: String,
    pub op_kind: String,
    pub command: String,
    pub refs: Vec<TextRef>,
    pub settled_at_ms: i64,
}

/// The persisted run, serialized into the `list_refs_ok` CONTROL response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RefsRunRow {
    pub run_id: String,
    pub op_kind: String,
    pub command: String,
    pub refs: Vec<TextRef>,
    pub settled_at_ms: i64,
}

pub struct RefsLedger {
    db: Mutex<Connection>,
}

impl RefsLedger {
    /// Default db path: alongside `sessions.db` (per-instance when
    /// `TUG_INSTANCE_ID` is set), named `refs.db`.
    pub fn default_path() -> Option<PathBuf> {
        let sessions = crate::session_ledger::SessionLedger::default_path()?;
        Some(sessions.with_file_name("refs.db"))
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, RefsLedgerError> {
        // Integrity gate: quarantine a corrupt file and salvage readable
        // rows into the fresh one (see `ledger_integrity`).
        let gate = crate::ledger_integrity::integrity_gate(path.as_ref(), "refs");
        let conn = tugcore::ledger_db::open(path)?;
        let ledger = Self::from_conn(conn)?;
        if let crate::ledger_integrity::GateOutcome::Quarantined { corrupt_path } = &gate {
            let db = ledger.db.lock().expect("refs ledger poisoned");
            crate::ledger_integrity::salvage_into(&db, "main", corrupt_path, &["refs_runs"], "refs");
        }
        Ok(ledger)
    }

    /// In-memory ledger for tests.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn open_in_memory() -> Result<Self, RefsLedgerError> {
        let conn = Connection::open_in_memory()?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> Result<Self, RefsLedgerError> {
        tugcore::ledger_db::apply_pragmas(&conn)?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS refs_runs (
                tug_session_id TEXT    PRIMARY KEY,
                run_id         TEXT    NOT NULL,
                op_kind        TEXT    NOT NULL,
                command        TEXT    NOT NULL,
                refs_json      TEXT    NOT NULL,
                settled_at_ms  INTEGER NOT NULL
            );
            ",
        )?;
        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    /// Record a completed run, replacing this session's previous one.
    pub fn record_run(&self, run: &NewRefsRun) -> Result<(), RefsLedgerError> {
        let refs_json = serde_json::to_string(&run.refs)?;
        let conn = self.db.lock().expect("refs ledger mutex");
        conn.execute(
            "INSERT INTO refs_runs
                (tug_session_id, run_id, op_kind, command, refs_json, settled_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(tug_session_id) DO UPDATE SET
                run_id = excluded.run_id,
                op_kind = excluded.op_kind,
                command = excluded.command,
                refs_json = excluded.refs_json,
                settled_at_ms = excluded.settled_at_ms",
            params![
                run.tug_session_id,
                run.run_id,
                run.op_kind,
                run.command,
                refs_json,
                run.settled_at_ms,
            ],
        )?;
        Ok(())
    }

    /// The session's latest run, or `None` if it has never completed one.
    pub fn list_refs(&self, tug_session_id: &str) -> Result<Option<RefsRunRow>, RefsLedgerError> {
        let conn = self.db.lock().expect("refs ledger mutex");
        let row = conn
            .query_row(
                "SELECT run_id, op_kind, command, refs_json, settled_at_ms
                 FROM refs_runs WHERE tug_session_id = ?1",
                params![tug_session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((run_id, op_kind, command, refs_json, settled_at_ms)) = row else {
            return Ok(None);
        };
        Ok(Some(RefsRunRow {
            run_id,
            op_kind,
            command,
            // A row whose payload no longer parses is a row from a shape
            // that has since changed; an empty list restores nothing rather
            // than failing the whole read.
            refs: serde_json::from_str(&refs_json).unwrap_or_default(),
            settled_at_ms,
        }))
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn run(session: &str, run_id: &str, paths: &[&str]) -> NewRefsRun {
        NewRefsRun {
            tug_session_id: session.into(),
            run_id: run_id.into(),
            op_kind: "match".into(),
            command: format!("/match {run_id}"),
            refs: paths
                .iter()
                .enumerate()
                .map(|(i, path)| TextRef::filename(i as u32 + 1, *path))
                .collect(),
            settled_at_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn a_new_run_clobbers_the_previous_one() {
        let ledger = RefsLedger::open_in_memory().unwrap();
        ledger.record_run(&run("s1", "run-1", &["a.ts", "b.ts"])).unwrap();
        ledger.record_run(&run("s1", "run-2", &["c.ts"])).unwrap();

        let latest = ledger.list_refs("s1").unwrap().unwrap();
        assert_eq!(latest.run_id, "run-2");
        assert_eq!(latest.command, "/match run-2");
        assert_eq!(
            latest.refs.iter().map(|r| r.path.as_str()).collect::<Vec<&str>>(),
            vec!["c.ts"],
        );
    }

    #[test]
    fn sessions_do_not_disturb_each_other() {
        let ledger = RefsLedger::open_in_memory().unwrap();
        ledger.record_run(&run("s1", "run-1", &["a.ts"])).unwrap();
        ledger.record_run(&run("s2", "run-2", &["b.ts"])).unwrap();
        ledger.record_run(&run("s1", "run-3", &["c.ts"])).unwrap();

        assert_eq!(ledger.list_refs("s2").unwrap().unwrap().run_id, "run-2");
        assert_eq!(ledger.list_refs("s1").unwrap().unwrap().run_id, "run-3");
    }

    #[test]
    fn a_session_with_no_run_reads_as_nothing() {
        let ledger = RefsLedger::open_in_memory().unwrap();
        assert!(ledger.list_refs("never-searched").unwrap().is_none());
    }

    #[test]
    fn content_refs_round_trip_through_storage() {
        let ledger = RefsLedger::open_in_memory().unwrap();
        let stored = NewRefsRun {
            tug_session_id: "s1".into(),
            run_id: "run-1".into(),
            op_kind: "search".into(),
            command: "/search héllo".into(),
            refs: vec![TextRef::content(
                1,
                "src/a.ts",
                12,
                vec![(2, 7), (9, 14)],
                crate::feeds::text_ref::LinePreview::whole("  héllo and héllo"),
            )],
            settled_at_ms: 42,
        };
        ledger.record_run(&stored).unwrap();

        let latest = ledger.list_refs("s1").unwrap().unwrap();
        assert_eq!(latest.refs, stored.refs);
        assert_eq!(latest.op_kind, "search");
        assert_eq!(latest.settled_at_ms, 42);
    }
}
