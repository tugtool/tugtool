//! Embedded SQLite state database (`StateDb`).
//!
//! Owns the database connection + schema. The only surviving consumer is
//! the `dash` flow, whose round-storage methods live in `dash.rs` (a
//! separate `impl StateDb`). The schema is just two tables: `dashes`
//! (one row per dash) and `dash_rounds` (one row per recorded commit).

use crate::error::TugError;
use rusqlite::Connection;
use std::path::Path;

/// Embedded SQLite state database manager.
///
/// Wraps a `rusqlite::Connection` and owns the dash schema. All data
/// operations live on the `impl StateDb` in `dash.rs`.
pub struct StateDb {
    pub(crate) conn: Connection,
}

impl StateDb {
    /// Open (or create) the state database at the given path.
    ///
    /// Sets WAL mode and busy timeout, then creates the dash schema if not
    /// present. This operation is idempotent.
    pub fn open(path: &Path) -> Result<Self, TugError> {
        let conn = Connection::open(path).map_err(|e| TugError::StateDbOpen {
            reason: format!("failed to open database: {}", e),
        })?;

        // Set WAL mode and busy timeout
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
            .map_err(|e| TugError::StateDbOpen {
                reason: format!("failed to set PRAGMA: {}", e),
            })?;

        // Create the dash schema (idempotent).
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS dashes (
    name        TEXT PRIMARY KEY,
    description TEXT,
    branch      TEXT NOT NULL,
    worktree    TEXT NOT NULL,
    base_branch TEXT NOT NULL DEFAULT 'main',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_rounds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dash_name      TEXT NOT NULL REFERENCES dashes(name),
    instruction    TEXT,
    summary        TEXT,
    files_created  TEXT,
    files_modified TEXT,
    commit_hash    TEXT,
    started_at     TEXT NOT NULL,
    completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_dash_rounds_name ON dash_rounds(dash_name);
            "#,
        )
        .map_err(|e| TugError::StateDbOpen {
            reason: format!("failed to create schema: {}", e),
        })?;

        Ok(StateDb { conn })
    }
}
