//! Read-only ledger access — the attribution ledger's `file_events` table
//! (the **machine-global** `changes.db`, [D112]) and the per-instance
//! `sessions.db`'s `sessions` table.
//!
//! `tugchanges-core` reads both with read-only `rusqlite`
//! (`SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, WAL-safe against tugcast's
//! concurrent writers) and never writes them — the ledger is tugcast's to own
//! ([P03]). It couples to the schema by raw SQL, exactly as the ported `tugutil`
//! did.
//!
//! **Schema source of truth:** the `file_events`/`sessions` columns this module
//! hand-mirrors are defined by `tugcast/src/feeds/attribution.rs` (the writer)
//! and `tugcast/src/session_ledger.rs` (the table DDL). A schema change there
//! must update this query; the contract test in `changes.rs` guards the shape.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// A single decoded `file_events` row, in `at`-ascending order. `at` (epoch
/// ms) feeds the row-liveness rule: a row is live only while it postdates the
/// last commit that touched its path — spent rows neither attribute nor
/// contend.
pub(crate) struct EventRow {
    pub file_path: String,
    pub op: String,
    pub origin: String,
    pub at: i64,
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
            "SELECT file_path, op, origin, at
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
                at: r.get::<_, i64>(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// One other session's claim on a path: its `project_dir` and its newest
/// **proof** row's `at` (`None` when it has only `bash`/`turn` bracket rows
/// for the path). The proof/correlation split is the load-bearing
/// distinction: a bracket row is a whole-tree-delta *claim*, not proof of
/// authorship — only proof rows (`exact` live, `replay` backfill; the tool
/// input names the file) establish ownership ([D112]).
pub(crate) struct PathClaim {
    pub session: String,
    pub project_dir: String,
    pub max_proof_at: Option<i64>,
}

/// Every session other than `exclude` that has a `file_events` row for the
/// repo-relative `file_path`, as [`PathClaim`]s (Spec S02). Grouped so a
/// session touching the path many times counts once, carrying its newest
/// proof row's `at` for the caller's liveness + authorship cuts.
pub(crate) fn sessions_for_path(
    conn: &Connection,
    file_path: &str,
    exclude: &str,
) -> Result<Vec<PathClaim>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT tug_session_id, project_dir,
                    MAX(CASE WHEN origin IN ('exact', 'replay') THEN at END)
             FROM file_events
             WHERE file_path = ?1 AND tug_session_id != ?2
             GROUP BY tug_session_id, project_dir",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![file_path, exclude], |r| {
            Ok(PathClaim {
                session: r.get::<_, String>(0)?,
                project_dir: r.get::<_, String>(1)?,
                max_proof_at: r.get::<_, Option<i64>>(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Other sessions with a **live proof** claim on `file_path` — the genuine
/// cross-session owners. A session qualifies when its `project_dir`
/// canonicalizes to the same on-disk directory as `repo_root` and it has a
/// proof row at or after `min_live_at_ms` (the row-liveness cut). Bracket
/// (`bash`/`turn`) rows never qualify a session here: a whole-tree fingerprint
/// delta cannot distinguish this session's own writes from another session's
/// concurrent save or a build's churn, so it is not authorship ([D112]). A row
/// whose `project_dir` (or `repo_root`) fails to canonicalize, or resolves
/// elsewhere, is not foreign — it degrades to `unattributed`, visible.
pub(crate) fn foreign_proof_sessions_for_path(
    conn: &Connection,
    file_path: &str,
    exclude: &str,
    repo_root: &Path,
    min_live_at_ms: i64,
) -> Result<Vec<String>, String> {
    let canon_root = match std::fs::canonicalize(repo_root) {
        Ok(p) => p,
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    for claim in sessions_for_path(conn, file_path, exclude)? {
        let Some(exact_at) = claim.max_proof_at else {
            continue;
        };
        if exact_at < min_live_at_ms {
            continue;
        }
        if let Ok(canon_proj) = std::fs::canonicalize(&claim.project_dir) {
            if canon_proj == canon_root {
                out.push(claim.session);
            }
        }
    }
    Ok(out)
}

/// Whether a row's `origin` is **proof** of authorship — the tool input named
/// the file (`exact` live, `replay` backfill of the same). `bash`/`turn`
/// bracket rows are correlation (a whole-tree fingerprint delta), never proof.
/// Mirrors `tugcast::feeds::attribution::origin_is_proof` (the writer side).
pub(crate) fn origin_is_proof(origin: &str) -> bool {
    matches!(origin, "exact" | "replay")
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
/// `tugcast::session_ledger::SessionLedger::default_path`: the `TUG_SESSIONS_DB`
/// override when set, else the per-instance location when `TUG_INSTANCE_ID` is
/// set, else the legacy single-instance path under the platform data dir.
pub(crate) fn resolve_sessions_db_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os(tugcore::instance::ENV_SESSIONS_DB).filter(|v| !v.is_empty())
    {
        return Some(PathBuf::from(p));
    }
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

/// The machine-global changes-ledger path ([D112]): one `changes.db` for
/// every app instance, holding the `file_events` rows. Mirrors
/// `tugcore::instance::changes_db_path()` (honoring the `TUG_CHANGES_DB`
/// test-isolation override) — deliberately independent of `TUG_INSTANCE_ID`.
pub(crate) fn resolve_changes_db_path() -> PathBuf {
    tugcore::instance::changes_db_path()
}

/// Whether `session` holds any `file_events` row at all — the shared-ledger
/// half of the "known session" test (a session recorded by another instance
/// has rows here but no `sessions` row in this instance's `sessions.db`).
pub(crate) fn session_has_events(conn: &Connection, session: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM file_events WHERE tug_session_id = ?1)",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Seed a `sessions.db` with `(tug_session_id, file_path, origin, project_dir, at)`
    /// rows — origin explicit so the exact-vs-bracket authorship split is testable.
    fn seed(rows: &[(&str, &str, &str, &str, i64)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        for (i, (session, file_path, origin, project_dir, at)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', 'edit', ?4, 0, ?5, ?6)",
                rusqlite::params![session, format!("tu-{i}"), file_path, origin, project_dir, at],
            )
            .unwrap();
        }
        dir
    }

    #[test]
    fn foreign_exact_query_excludes_self_and_off_repo_project_dirs() {
        let repo = tempfile::tempdir().unwrap();
        let other_repo = tempfile::tempdir().unwrap();
        let repo_dir = repo.path().to_string_lossy().into_owned();
        let other_dir = other_repo.path().to_string_lossy().into_owned();

        let db = seed(&[
            ("mine", "foo.rs", "exact", &repo_dir, 5),
            ("theirs", "foo.rs", "exact", &repo_dir, 5),
            ("elsewhere", "foo.rs", "exact", &other_dir, 5),
        ]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        // Raw claims: everyone but `mine`.
        let claims = sessions_for_path(&conn, "foo.rs", "mine").unwrap();
        let ids: Vec<&str> = claims.iter().map(|c| c.session.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"theirs") && ids.contains(&"elsewhere"));

        // Repo-matched exact foreigns: only `theirs`; `elsewhere` resolves off-repo.
        let foreign =
            foreign_proof_sessions_for_path(&conn, "foo.rs", "mine", repo.path(), 0).unwrap();
        assert_eq!(foreign, vec!["theirs".to_string()]);
    }

    #[test]
    fn only_exact_rows_establish_foreign_ownership() {
        // The pinned regression: another session that merely *bracket-grabbed*
        // a file (bash/turn, a whole-tree delta contaminated by concurrent
        // saves or build churn) is NOT a cross-session owner — only its exact
        // rows count.
        let repo = tempfile::tempdir().unwrap();
        let repo_dir = repo.path().to_string_lossy().into_owned();
        let db = seed(&[
            ("bracketer", "foo.rs", "bash", &repo_dir, 5),
            ("bracketer", "foo.rs", "turn", &repo_dir, 6),
        ]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        assert!(
            foreign_proof_sessions_for_path(&conn, "foo.rs", "mine", repo.path(), 0)
                .unwrap()
                .is_empty(),
            "bracket-only rows never establish foreign ownership"
        );
    }

    #[test]
    fn replay_rows_are_proof_class_evidence() {
        // A `replay` row is an exact-tool backfill — the tool input named the
        // file — so it establishes ownership exactly like a live `exact` row.
        let repo = tempfile::tempdir().unwrap();
        let repo_dir = repo.path().to_string_lossy().into_owned();
        let db = seed(&[("resumed", "foo.rs", "replay", &repo_dir, 5)]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        assert_eq!(
            foreign_proof_sessions_for_path(&conn, "foo.rs", "mine", repo.path(), 0).unwrap(),
            vec!["resumed".to_string()]
        );
    }

    #[test]
    fn foreign_exact_query_drops_spent_rows_behind_the_liveness_cut() {
        let repo = tempfile::tempdir().unwrap();
        let repo_dir = repo.path().to_string_lossy().into_owned();
        let db = seed(&[("theirs", "foo.rs", "exact", &repo_dir, 1)]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        // Below the cut → live claimant; above → spent, no claim.
        assert_eq!(
            foreign_proof_sessions_for_path(&conn, "foo.rs", "mine", repo.path(), 1).unwrap(),
            vec!["theirs".to_string()]
        );
        assert!(
            foreign_proof_sessions_for_path(&conn, "foo.rs", "mine", repo.path(), 2)
                .unwrap()
                .is_empty(),
            "a spent exact row never contends"
        );
    }
}
