//! Read-only `sessions.db` access — the attribution ledger's `file_events` and
//! `sessions` tables.
//!
//! `tugmark-core` reads the ledger with read-only `rusqlite`
//! (`SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, WAL-safe against tugcast's
//! concurrent writer) and never writes it — the ledger is tugcast's to own
//! ([P03]). It couples to the schema by raw SQL, exactly as the ported `tugutil`
//! did.
//!
//! **Schema source of truth:** the `file_events`/`sessions` columns this module
//! hand-mirrors are defined by `tugcast/src/feeds/attribution.rs` (the writer)
//! and `tugcast/src/session_ledger.rs` (the table DDL). A schema change there
//! must update this query; the contract test in `changes.rs` guards the shape.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// A single decoded `file_events` row, in `at`-ascending order.
pub(crate) struct EventRow {
    pub file_path: String,
    pub op: String,
    pub origin: String,
    pub ambiguous: bool,
}

/// Open `sessions.db` read-only. WAL semantics make a read-only open safe while
/// tugcast writes concurrently.
pub(crate) fn open_readonly(db_path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("cannot open session ledger {}: {e}", db_path.display()))
}

/// All `file_events` for `session`, oldest-first (matching the ledger's own
/// `file_events_for_session` order).
pub(crate) fn query_events(conn: &Connection, session: &str) -> Result<Vec<EventRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT file_path, op, origin, ambiguous
             FROM file_events
             WHERE tug_session_id = ?1
             ORDER BY at ASC, tool_use_id ASC, file_path ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session], |r| {
            Ok(EventRow {
                file_path: r.get::<_, String>(0)?,
                op: r.get::<_, String>(1)?,
                origin: r.get::<_, String>(2)?,
                ambiguous: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Whether a `sessions` row exists for `session` — the "known vs unknown" test
/// that separates a valid session with no changes (exit 0, empty list) from a
/// bogus id (exit 2).
pub(crate) fn session_exists(conn: &Connection, session: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE session_id = ?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Resolve the on-disk `sessions.db` path, mirroring
/// `tugcast::session_ledger::SessionLedger::default_path`: the per-instance
/// location when `TUG_INSTANCE_ID` is set, else the legacy single-instance path
/// under the platform data dir.
pub(crate) fn resolve_sessions_db_path() -> Option<PathBuf> {
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
