//! Read-only `sessions.db` access — the attribution ledger's `file_events` and
//! `sessions` tables.
//!
//! `tugchanges-core` reads the ledger with read-only `rusqlite`
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

/// Every session other than `exclude` that has a `file_events` row for the
/// repo-relative `file_path`, paired with the row's `project_dir` (Spec S02).
/// Read-only; `DISTINCT` so a session touching the path many times counts once.
pub(crate) fn sessions_for_path(
    conn: &Connection,
    file_path: &str,
    exclude: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT tug_session_id, project_dir
             FROM file_events
             WHERE file_path = ?1 AND tug_session_id != ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![file_path, exclude], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// The subset of [`sessions_for_path`] whose `project_dir` canonicalizes to the
/// same on-disk directory as `repo_root` — the genuine foreign claimants of a
/// path (Spec S02). A row whose `project_dir` (or `repo_root` itself) fails to
/// canonicalize, or resolves elsewhere, is not foreign: a legacy absolute-path
/// or cross-repo row degrades to `unattributed` at the read side — visible,
/// never silently dropped.
pub(crate) fn foreign_sessions_for_path(
    conn: &Connection,
    file_path: &str,
    exclude: &str,
    repo_root: &Path,
) -> Result<Vec<String>, String> {
    let canon_root = match std::fs::canonicalize(repo_root) {
        Ok(p) => p,
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    for (session, project_dir) in sessions_for_path(conn, file_path, exclude)? {
        if let Ok(canon_proj) = std::fs::canonicalize(&project_dir) {
            if canon_proj == canon_root {
                out.push(session);
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Seed a `sessions.db` with `(tug_session_id, file_path, project_dir)` rows.
    fn seed(rows: &[(&str, &str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        for (i, (session, file_path, project_dir)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', 'edit', 'exact', 0, ?4, ?5)",
                rusqlite::params![session, format!("tu-{i}"), file_path, project_dir, i as i64],
            )
            .unwrap();
        }
        dir
    }

    #[test]
    fn foreign_query_excludes_self_and_off_repo_project_dirs() {
        let repo = tempfile::tempdir().unwrap();
        let other_repo = tempfile::tempdir().unwrap();
        let repo_dir = repo.path().to_string_lossy().into_owned();
        let other_dir = other_repo.path().to_string_lossy().into_owned();

        let db = seed(&[
            ("mine", "foo.rs", &repo_dir),
            ("theirs", "foo.rs", &repo_dir),
            ("elsewhere", "foo.rs", &other_dir),
        ]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        // Raw pairs: everyone but `mine`.
        let pairs = sessions_for_path(&conn, "foo.rs", "mine").unwrap();
        let ids: Vec<&str> = pairs.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"theirs") && ids.contains(&"elsewhere"));

        // Repo-matched foreigns: only `theirs` (same repo_root); `elsewhere`'s
        // project_dir resolves to a different directory, so it is not foreign.
        let foreign = foreign_sessions_for_path(&conn, "foo.rs", "mine", repo.path()).unwrap();
        assert_eq!(foreign, vec!["theirs".to_string()]);
    }
}
