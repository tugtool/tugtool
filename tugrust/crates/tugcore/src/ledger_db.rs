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

use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

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

/// Attach another ledger database under `schema` **read-only** — the
/// non-owner half of the single-writer contract ([LR8]): a mutation that
/// escapes the forwarding route fails loudly instead of quietly joining a
/// second writer to the shared WAL. The journaling pragmas are the
/// owner's to set; a read-only attach cannot (and must not) touch them.
pub fn attach_read_only(conn: &Connection, schema: &str, path: &Path) -> rusqlite::Result<()> {
    let uri = format!("file:{}?mode=ro", uri_encode_path(&path.to_string_lossy()));
    conn.execute(
        &format!("ATTACH DATABASE ?1 AS {schema}"),
        rusqlite::params![uri],
    )?;
    Ok(())
}

/// Percent-encode a filesystem path for a SQLite `file:` URI, leaving the
/// path separator and the unreserved set intact.
fn uri_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// ── Writer ownership ─────────────────────────────────────────────────────────

/// Suffix of the writer-claim lockfile beside a ledger database.
const WRITER_LOCK_SUFFIX: &str = ".writer-lock";

/// Identity the claim holder publishes for non-owners to reach it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriterOwner {
    /// Per-instance id (`<profile>-<branch-slug>`), or `"standalone"`.
    pub instance_id: String,
    /// PID of the owning process.
    pub pid: i32,
    /// Loopback port its HTTP API is bound to; `0` when it has none.
    pub port: u16,
}

/// An held writer claim. Dropping it (or the process dying) releases the
/// claim — `flock(2)` locks are owned by the open file description, so
/// there is no stale-lock protocol to get wrong.
pub struct WriterLock {
    file: File,
    path: PathBuf,
}

impl WriterLock {
    /// The lockfile this claim is held on.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for WriterLock {
    fn drop(&mut self) {
        let _ = flock(&self.file, libc::LOCK_UN);
    }
}

/// The claim lockfile for `db_path` (`<db>.writer-lock`). Never renamed:
/// `flock` is per-inode, so a replaced file would let two processes each
/// believe they hold the exclusive claim.
pub fn writer_lock_path(db_path: &Path) -> PathBuf {
    let mut name = db_path.as_os_str().to_owned();
    name.push(WRITER_LOCK_SUFFIX);
    PathBuf::from(name)
}

/// Try to claim write ownership of the ledger at `db_path`.
///
/// Returns the held claim, or `None` when another live process already
/// owns it (or the lockfile cannot be opened). On success the caller's
/// `owner` identity is written into the lockfile so non-owners can find
/// the owner's API — diagnostics and routing only; the *claim* is the
/// `flock`, never the file's content.
pub fn claim_writer(db_path: &Path, owner: &WriterOwner) -> Option<WriterLock> {
    let path = writer_lock_path(db_path);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
    {
        Ok(f) => f,
        Err(err) => {
            tracing_warn(&format!(
                "cannot open writer lockfile {}: {err}",
                path.display()
            ));
            return None;
        }
    };
    if flock(&file, libc::LOCK_EX | libc::LOCK_NB).is_err() {
        return None;
    }
    let mut lock = WriterLock { file, path };
    lock.publish(owner);
    Some(lock)
}

impl WriterLock {
    /// Overwrite the lockfile content with the holder's identity. Failures
    /// are non-fatal: the claim is the lock, not the bytes.
    fn publish(&mut self, owner: &WriterOwner) {
        let bytes = match serde_json::to_vec(owner) {
            Ok(b) => b,
            Err(_) => return,
        };
        let write = self
            .file
            .set_len(0)
            .and_then(|()| self.file.seek(SeekFrom::Start(0)))
            .and_then(|_| self.file.write_all(&bytes))
            .and_then(|()| self.file.write_all(b"\n"))
            .and_then(|()| self.file.sync_data());
        if let Err(err) = write {
            tracing_warn(&format!(
                "cannot publish writer identity to {}: {err}",
                self.path.display()
            ));
        }
    }
}

/// Read the published owner identity for `db_path`, or `None` when no
/// claim has ever been published (or the content is unreadable).
pub fn read_writer_owner(db_path: &Path) -> Option<WriterOwner> {
    let text = std::fs::read_to_string(writer_lock_path(db_path)).ok()?;
    serde_json::from_str(text.trim()).ok()
}

fn flock(file: &File, op: i32) -> std::io::Result<()> {
    // SAFETY: `as_raw_fd` is a valid borrowed fd for the life of `file`;
    // `flock` records the lock in the kernel and does not retain the fd.
    let ret = unsafe { libc::flock(file.as_raw_fd(), op) };
    if ret == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// tugcore carries no tracing dependency; ledger-claim problems are rare
/// and worth seeing, so they go to stderr where the host log captures them.
fn tracing_warn(message: &str) {
    eprintln!("tugcore::ledger_db: {message}");
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

    #[test]
    fn read_only_attach_reads_but_refuses_writes() {
        let dir = tempfile::tempdir().unwrap();
        // A path with characters that must survive URI encoding.
        let shared = dir.path().join("has space+hash#/changes.db");
        std::fs::create_dir_all(shared.parent().unwrap()).unwrap();
        {
            let writer = open(&shared).unwrap();
            writer
                .execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('seed');")
                .unwrap();
        }
        let conn = open(dir.path().join("main.db")).unwrap();
        attach_read_only(&conn, "changes", &shared).unwrap();
        let seen: String = conn
            .query_row("SELECT v FROM changes.t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(seen, "seed");
        let write = conn.execute("INSERT INTO changes.t VALUES ('nope')", []);
        assert!(write.is_err(), "read-only attach must refuse writes");
    }

    fn owner(port: u16) -> WriterOwner {
        WriterOwner {
            instance_id: "test".into(),
            pid: std::process::id() as i32,
            port,
        }
    }

    #[test]
    fn one_claim_at_a_time_and_drop_releases() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("changes.db");
        let first = claim_writer(&db, &owner(1)).expect("first claim");
        assert!(
            claim_writer(&db, &owner(2)).is_none(),
            "a second claim must fail while the first is held"
        );
        assert_eq!(read_writer_owner(&db).unwrap().port, 1);
        drop(first);
        let second = claim_writer(&db, &owner(2)).expect("claim after release");
        assert_eq!(read_writer_owner(&db).unwrap().port, 2);
        assert_eq!(second.path(), writer_lock_path(&db));
    }

    #[test]
    fn owner_is_unreadable_before_any_claim() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_writer_owner(&dir.path().join("changes.db")).is_none());
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
