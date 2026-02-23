//! Embedded SQLite state management for Tugstate
//!
//! Provides `StateDb` for managing plan execution state via an embedded SQLite
//! database. The database tracks steps, substeps, checklist items, dependencies,
//! and artifacts for each initialized plan.

use crate::error::TugError;
use rusqlite::Connection;
use std::path::Path;

/// Embedded SQLite state database manager.
///
/// Wraps a `rusqlite::Connection` and provides methods for all state operations:
/// schema creation, plan initialization, step claiming, checklist updates, etc.
pub struct StateDb {
    pub(crate) conn: Connection,
}

impl StateDb {
    /// Open (or create) the state database at the given path.
    ///
    /// Sets WAL mode and busy timeout, then creates schema if not present.
    /// This operation is idempotent.
    pub fn open(path: &Path) -> Result<Self, TugError> {
        let conn = Connection::open(path).map_err(|e| TugError::StateDbOpen {
            reason: format!("failed to open database: {}", e),
        })?;

        // Set WAL mode and busy timeout
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
            .map_err(|e| TugError::StateDbOpen {
                reason: format!("failed to set PRAGMA: {}", e),
            })?;

        // Create schema (idempotent)
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
    plan_path    TEXT PRIMARY KEY,
    plan_hash    TEXT NOT NULL,
    phase_title  TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
    plan_path        TEXT NOT NULL REFERENCES plans(plan_path),
    anchor           TEXT NOT NULL,
    parent_anchor    TEXT,
    step_index       INTEGER NOT NULL,
    title            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    claimed_by       TEXT,
    claimed_at       TEXT,
    lease_expires_at TEXT,
    heartbeat_at     TEXT,
    started_at       TEXT,
    completed_at     TEXT,
    commit_hash      TEXT,
    complete_reason  TEXT,
    PRIMARY KEY (plan_path, anchor),
    FOREIGN KEY (plan_path, parent_anchor) REFERENCES steps(plan_path, anchor)
);

CREATE TABLE IF NOT EXISTS step_deps (
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    depends_on   TEXT NOT NULL,
    PRIMARY KEY (plan_path, step_anchor, depends_on),
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor),
    FOREIGN KEY (plan_path, depends_on) REFERENCES steps(plan_path, anchor)
);

CREATE TABLE IF NOT EXISTS checklist_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    kind         TEXT NOT NULL,
    ordinal      INTEGER NOT NULL,
    text         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    updated_at   TEXT,
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor)
);

CREATE TABLE IF NOT EXISTS step_artifacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    kind         TEXT NOT NULL,
    summary      TEXT NOT NULL,
    recorded_at  TEXT NOT NULL,
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor)
);

CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(plan_path, status) WHERE parent_anchor IS NULL;
CREATE INDEX IF NOT EXISTS idx_steps_parent ON steps(plan_path, parent_anchor) WHERE parent_anchor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_steps_lease ON steps(plan_path, status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_checklist_step ON checklist_items(plan_path, step_anchor);
CREATE INDEX IF NOT EXISTS idx_artifacts_step ON step_artifacts(plan_path, step_anchor);
            "#,
        )
        .map_err(|e| TugError::StateDbOpen {
            reason: format!("failed to create schema: {}", e),
        })?;

        // Insert schema version (idempotent via NOT EXISTS check)
        conn.execute(
            "INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version)",
            [],
        )
        .map_err(|e| TugError::StateDbOpen {
            reason: format!("failed to insert schema version: {}", e),
        })?;

        Ok(StateDb { conn })
    }

    /// Query the schema version from the database.
    pub fn schema_version(&self) -> Result<i32, TugError> {
        self.conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
                row.get(0)
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query schema version: {}", e),
            })
    }
}

/// Compute SHA-256 hash of a plan file, returned as lowercase hex string.
pub fn compute_plan_hash(path: &Path) -> Result<String, TugError> {
    use sha2::{Digest, Sha256};
    let content = std::fs::read(path).map_err(|e| TugError::StateDbQuery {
        reason: format!("failed to read plan file for hashing: {}", e),
    })?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let digest = hasher.finalize();
    Ok(format!("{:x}", digest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_open_creates_db_and_schema_version_is_1() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).expect("open should succeed");
        assert!(db_path.exists(), "state.db file should be created");
        assert_eq!(db.schema_version().unwrap(), 1);
    }

    #[test]
    fn test_open_is_idempotent() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let _db1 = StateDb::open(&db_path).expect("first open should succeed");
        let db2 = StateDb::open(&db_path).expect("second open should succeed");
        assert_eq!(db2.schema_version().unwrap(), 1);
    }

    #[test]
    fn test_schema_has_all_expected_tables() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        let mut stmt = db
            .conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"schema_version".to_string()));
        assert!(tables.contains(&"plans".to_string()));
        assert!(tables.contains(&"steps".to_string()));
        assert!(tables.contains(&"step_deps".to_string()));
        assert!(tables.contains(&"checklist_items".to_string()));
        assert!(tables.contains(&"step_artifacts".to_string()));
    }

    #[test]
    fn test_compute_plan_hash_consistent() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("plan.md");
        fs::write(&file, "# Test plan\nSome content").unwrap();

        let hash1 = compute_plan_hash(&file).unwrap();
        let hash2 = compute_plan_hash(&file).unwrap();
        assert_eq!(hash1, hash2, "same content should produce same hash");
        // SHA-256 produces a 64-char hex string
        assert_eq!(hash1.len(), 64, "SHA-256 hex should be 64 chars");
        // Verify it's lowercase hex
        assert!(
            hash1
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase())
        );
    }
}
