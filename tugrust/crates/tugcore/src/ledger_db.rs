//! The single chokepoint for opening Tug's SQLite ledger databases.
//!
//! Every writable open of a ledger file (`sessions.db`, the attached
//! machine-global `changes.db`, `shell_exchanges.db`, `tugbank.db`) goes
//! through [`open`] / [`attach`], so every writer — long-lived tugcast or
//! a short-lived CLI — runs the identical pragma set. Heterogeneous
//! configurations sharing one WAL database is the failure neighborhood of
//! the 2026-07-27 corruption incident; this module makes "one true way to
//! open a ledger" a compile-time property, enforced by the
//! `no_ad_hoc_ledger_opens` source scan below.
//!
//! Pragmas applied (connection-wide unless noted):
//! - `journal_mode = WAL` — multi-process-safe journaling.
//! - `busy_timeout = 5000` — writers queue instead of erroring.
//! - `synchronous = NORMAL` — WAL-appropriate durability.
//! - `cell_size_check = ON` — page-level corruption errors at the
//!   statement that touches it instead of festering silently.

use std::path::Path;

use rusqlite::Connection;

/// Open (or create) a ledger database with the unified pragma set.
pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

/// Apply the unified pragma set to an existing connection — the shared
/// half of [`open`], exposed for callers that construct connections in
/// special ways (in-memory ledgers, injected test connections).
pub fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.pragma_update(None, "busy_timeout", 5000i64)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "cell_size_check", true)?;
    Ok(())
}

/// Attach another ledger database under `schema` and bring it up to the
/// same journaling contract (`journal_mode`/`synchronous` are per-database
/// for an attach; `busy_timeout`/`cell_size_check` are connection-wide and
/// already applied by [`open`]).
pub fn attach(conn: &Connection, schema: &str, path: &Path) -> rusqlite::Result<()> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS {schema}"),
        rusqlite::params![path.to_string_lossy()],
    )?;
    let db = rusqlite::DatabaseName::Attached(schema);
    conn.pragma_update(Some(db), "journal_mode", "WAL")?;
    conn.pragma_update(Some(db), "synchronous", "NORMAL")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_applies_unified_pragmas() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path().join("x.db")).unwrap();
        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal, "wal");
        let busy: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(busy, 5000);
        let sync: i64 = conn
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sync, 1, "NORMAL");
        let cell: i64 = conn
            .query_row("PRAGMA cell_size_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cell, 1);
    }

    #[test]
    fn attach_brings_sibling_to_wal() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path().join("main.db")).unwrap();
        attach(&conn, "changes", &dir.path().join("changes.db")).unwrap();
        let journal: String = conn
            .query_row("PRAGMA changes.journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal, "wal");
    }

    /// The enforcement half of the chokepoint: no production source in the
    /// workspace may call `Connection::open(` directly — writable ad-hoc
    /// opens are exactly how a divergent configuration reaches a shared
    /// WAL database. Read-only opens (`open_with_flags` + READ_ONLY),
    /// in-memory opens, and `#[cfg(test)]` code are exempt.
    #[test]
    fn no_ad_hoc_ledger_opens() {
        let crates_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crates dir")
            .to_path_buf();
        let mut offenders = Vec::new();
        let mut stack = vec![crates_root.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).expect("read_dir") {
                let entry = entry.expect("dir entry");
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if path.is_dir() {
                    // Only production sources: skip target output and
                    // per-crate `tests/` (integration tests may open raw).
                    if name == "target" || name == "tests" || name == "fixtures" {
                        continue;
                    }
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                // The chokepoint itself, and the integrity prober whose
                // quick_check open is deliberately raw (it must open a
                // possibly-corrupt file without side effects).
                if path == crates_root.join("tugcore/src/ledger_db.rs")
                    || path == crates_root.join("tugcast/src/ledger_integrity.rs")
                {
                    continue;
                }
                let text = std::fs::read_to_string(&path).expect("read source");
                // Ignore everything at and after the file's test module —
                // the workspace convention is a trailing `#[cfg(test)]`
                // followed (possibly through more attributes) by `mod …`.
                // A lone `#[cfg(test)]` on a single item must NOT truncate
                // the scan, so require the `mod` to follow.
                let production = match test_module_start(&text) {
                    Some(cut) => &text[..cut],
                    None => &text[..],
                };
                if production.contains("Connection::open(") {
                    offenders.push(path.display().to_string());
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "ad-hoc `Connection::open(` outside tugcore::ledger_db — route these through the chokepoint: {offenders:#?}"
        );
    }

    /// Byte offset where a file's `#[cfg(test)] … mod …` block starts, or
    /// `None` when the file has no test module.
    fn test_module_start(text: &str) -> Option<usize> {
        let mut search_from = 0;
        while let Some(rel) = text[search_from..].find("#[cfg(test)]") {
            let at = search_from + rel;
            let after = &text[at + "#[cfg(test)]".len()..];
            let is_module = after
                .lines()
                .map(str::trim_start)
                .find(|l| !l.is_empty() && !l.starts_with("#["))
                .is_some_and(|l| l.starts_with("mod ") || l.starts_with("pub mod "));
            if is_module {
                return Some(at);
            }
            search_from = at + 1;
        }
        None
    }
}
