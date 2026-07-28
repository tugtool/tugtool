//! Append-only journal for the machine-global changes ledger.
//!
//! Every mutation of the shared `changes.*` tables is appended here as one
//! JSON line **before** it is applied to SQLite, making the journal — a
//! plain fsync'd append-only file, effectively incorruptible — the durable
//! record and the database a rebuildable index. When the open-time
//! integrity gate quarantines a corrupt `changes.db`, the fresh database
//! is reconstructed as: bootstrap schema → salvage readable rows →
//! **replay this journal**, whose records are idempotent (inserts land on
//! `ON CONFLICT DO NOTHING` / `INSERT OR REPLACE` keys, deletes re-delete)
//! so re-applying rows the salvage already carried is harmless, and
//! deletes the salvage resurrected are re-applied.
//!
//! The journal lives beside the database (`changes.db.journal.jsonl` for
//! `changes.db`). It begins at the moment this code first runs on a
//! machine — rows older than the journal come from salvage and the
//! `VACUUM INTO` snapshots, never from here. At open, an oversized
//! journal is rotated to `<name>.old` (one prior generation kept); the
//! snapshots cover history beyond that horizon.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::session_ledger::{ChangesetDraftRow, FileEventRewrite, FileEventRow};

/// Rotate the journal at open when it exceeds this size. Attribution rows
/// are ~200 bytes; this horizon is years of normal use.
const ROTATE_BYTES: u64 = 32 * 1024 * 1024;

/// One journaled mutation of the shared changes tables.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum Record {
    /// `record_file_event` — idempotent insert on the natural PK.
    #[serde(rename = "fe")]
    FileEvent { row: FileEventRow },
    /// Session eviction / deletion: drop every attribution row of one session.
    #[serde(rename = "fe_del_session")]
    DeleteSession { session: String },
    /// Ownership severing ([D120]): drop other sessions' rows for paths.
    #[serde(rename = "fe_sever")]
    Sever {
        project_dir: String,
        paths: Vec<String>,
        keep_session: String,
    },
    /// Legacy-row canonicalization rewrite (collision-safe, idempotent).
    #[serde(rename = "fe_rewrite")]
    Rewrite {
        canonical_project_dir: String,
        rewrite: FileEventRewrite,
    },
    /// Maintained draft upsert (`INSERT OR REPLACE` on the owner key).
    #[serde(rename = "draft")]
    Draft { row: ChangesetDraftRow },
    /// Maintained draft deletion by owner key.
    #[serde(rename = "draft_del")]
    DraftDelete {
        owner_kind: String,
        owner_id: String,
        project_dir: String,
    },
}

impl Record {
    /// Whether this record creates or reshapes rows, as opposed to
    /// removing them. Deletes are shape-safe and stay allowed when the
    /// `user_version` gate has locked this build out of the shared tables
    /// ([LR5]); inserts and updates against an unknown shape are not.
    pub fn shapes_rows(&self) -> bool {
        match self {
            Record::FileEvent { .. } | Record::Rewrite { .. } | Record::Draft { .. } => true,
            Record::DeleteSession { .. } | Record::Sever { .. } | Record::DraftDelete { .. } => {
                false
            }
        }
    }
}

/// Open journal handle. Appends serialize under an internal lock; every
/// append is flushed with `sync_data` so a crash never loses an
/// acknowledged attribution row.
pub struct ChangesJournal {
    file: Mutex<File>,
    path: PathBuf,
}

/// `<changes-db-path>.journal.jsonl`.
pub fn journal_path_for(changes_db: &Path) -> PathBuf {
    let mut name = changes_db.as_os_str().to_owned();
    name.push(".journal.jsonl");
    PathBuf::from(name)
}

impl ChangesJournal {
    /// Open (creating if needed) the journal beside `changes_db`,
    /// rotating an oversized file to `<name>.old` first. Returns `None`
    /// (with a loud log) when the journal cannot be opened — the ledger
    /// still works, minus journal durability.
    pub fn open(changes_db: &Path) -> Option<Self> {
        let path = journal_path_for(changes_db);
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > ROTATE_BYTES {
                let old = path.with_extension("jsonl.old");
                if let Err(err) = std::fs::rename(&path, &old) {
                    tracing::warn!(journal = %path.display(), error = %err, "journal rotation failed; continuing to append");
                }
            }
        }
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(file) => Some(Self {
                file: Mutex::new(file),
                path,
            }),
            Err(err) => {
                tracing::error!(
                    journal = %path.display(),
                    error = %err,
                    "cannot open changes journal — attribution mutations will not be journaled"
                );
                None
            }
        }
    }

    /// Append one record durably. Failures are logged, never propagated —
    /// the SQLite write (which follows) is still the serving copy.
    pub fn append(&self, record: &Record) {
        let mut line = match serde_json::to_vec(record) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(error = %err, "changes journal record failed to serialize");
                return;
            }
        };
        line.push(b'\n');
        let mut file = self.file.lock().expect("journal mutex poisoned");
        if let Err(err) = file.write_all(&line).and_then(|()| file.sync_data()) {
            tracing::error!(
                journal = %self.path.display(),
                error = %err,
                "changes journal append failed"
            );
        }
    }

    /// Read every parseable record from the journal at `path`, oldest
    /// first, tolerating a torn final line. Missing file → empty.
    pub fn read_records(path: &Path) -> Vec<Record> {
        let Ok(text) = std::fs::read_to_string(path) else {
            return Vec::new();
        };
        let mut records = Vec::new();
        let mut dropped = 0usize;
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Record>(line) {
                Ok(rec) => records.push(rec),
                Err(_) => dropped += 1,
            }
        }
        if dropped > 0 {
            tracing::warn!(
                journal = %path.display(),
                dropped,
                "unparseable journal lines skipped during replay"
            );
        }
        records
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> FileEventRow {
        FileEventRow {
            tug_session_id: "s1".into(),
            tool_use_id: "t1".into(),
            file_path: "src/a.rs".into(),
            tool_name: "Write".into(),
            op: "modified".into(),
            origin: "exact".into(),
            ambiguous: false,
            parent_tool_use_id: None,
            project_dir: "/proj".into(),
            at: 42,
        }
    }

    #[test]
    fn append_then_read_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("changes.db");
        let journal = ChangesJournal::open(&db).unwrap();
        journal.append(&Record::FileEvent { row: sample_row() });
        journal.append(&Record::DeleteSession {
            session: "s9".into(),
        });
        let records = ChangesJournal::read_records(&journal_path_for(&db));
        assert_eq!(records.len(), 2);
        assert!(matches!(&records[0], Record::FileEvent { row } if row.file_path == "src/a.rs"));
        assert!(matches!(&records[1], Record::DeleteSession { session } if session == "s9"));
    }

    #[test]
    fn torn_final_line_is_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("changes.db");
        let journal = ChangesJournal::open(&db).unwrap();
        journal.append(&Record::FileEvent { row: sample_row() });
        let path = journal_path_for(&db);
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"t\":\"fe\",\"row\":{\"tug_ses"); // torn write
        std::fs::write(&path, text).unwrap();
        let records = ChangesJournal::read_records(&path);
        assert_eq!(records.len(), 1);
    }
}
