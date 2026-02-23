//! Embedded SQLite state management for Tugstate
//!
//! Provides `StateDb` for managing plan execution state via an embedded SQLite
//! database. The database tracks steps, substeps, checklist items, dependencies,
//! and artifacts for each initialized plan.

use crate::error::TugError;
use crate::session::now_iso8601;
use crate::types::{Checkpoint, TugPlan};
use rusqlite::{Connection, TransactionBehavior};
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

    /// Initialize a plan in the database.
    ///
    /// Populates plans, steps, step_deps, and checklist_items tables in a single
    /// transaction. Returns `already_initialized: true` if the plan already exists.
    pub fn init_plan(
        &mut self,
        plan_path: &str,
        plan: &TugPlan,
        plan_hash: &str,
    ) -> Result<InitResult, TugError> {
        // Check if already initialized
        let exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM plans WHERE plan_path = ?1",
                [plan_path],
                |_row| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            return Ok(InitResult {
                already_initialized: true,
                step_count: 0,
                substep_count: 0,
                dep_count: 0,
                checklist_count: 0,
            });
        }

        // Begin transaction
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to begin transaction: {}", e),
            })?;

        // Insert plan row
        let now = now_iso8601();
        tx.execute(
            "INSERT INTO plans (plan_path, plan_hash, phase_title, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'active', ?4, ?5)",
            rusqlite::params![
                plan_path,
                plan_hash,
                plan.phase_title.as_deref(),
                &now,
                &now
            ],
        )
        .map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to insert plan: {}", e),
        })?;

        // Insert steps and substeps with interleaved step_index
        let mut step_index: i32 = 0;
        let mut step_count = 0;
        let mut substep_count = 0;

        for step in &plan.steps {
            // Insert top-level step
            tx.execute(
                "INSERT INTO steps (plan_path, anchor, parent_anchor, step_index, title, status)
                 VALUES (?1, ?2, NULL, ?3, ?4, 'pending')",
                rusqlite::params![plan_path, &step.anchor, step_index, &step.title],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to insert step {}: {}", step.anchor, e),
            })?;
            step_count += 1;
            step_index += 1;

            // Insert substeps
            for substep in &step.substeps {
                tx.execute(
                    "INSERT INTO steps (plan_path, anchor, parent_anchor, step_index, title, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'pending')",
                    rusqlite::params![
                        plan_path,
                        &substep.anchor,
                        &step.anchor,
                        step_index,
                        &substep.title
                    ],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to insert substep {}: {}", substep.anchor, e),
                })?;
                substep_count += 1;
                step_index += 1;
            }
        }

        // Insert dependencies
        let mut dep_count = 0;
        for step in &plan.steps {
            for dep in &step.depends_on {
                tx.execute(
                    "INSERT INTO step_deps (plan_path, step_anchor, depends_on) VALUES (?1, ?2, ?3)",
                    rusqlite::params![plan_path, &step.anchor, dep],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to insert dependency: {}", e),
                })?;
                dep_count += 1;
            }
            for substep in &step.substeps {
                for dep in &substep.depends_on {
                    tx.execute(
                        "INSERT INTO step_deps (plan_path, step_anchor, depends_on) VALUES (?1, ?2, ?3)",
                        rusqlite::params![plan_path, &substep.anchor, dep],
                    )
                    .map_err(|e| TugError::StateDbQuery {
                        reason: format!("failed to insert substep dependency: {}", e),
                    })?;
                    dep_count += 1;
                }
            }
        }

        // Insert checklist items
        let mut checklist_count = 0;
        for step in &plan.steps {
            checklist_count +=
                insert_checklist_items(&tx, plan_path, &step.anchor, &step.tasks, "task")?;
            checklist_count +=
                insert_checklist_items(&tx, plan_path, &step.anchor, &step.tests, "test")?;
            checklist_count += insert_checklist_items(
                &tx,
                plan_path,
                &step.anchor,
                &step.checkpoints,
                "checkpoint",
            )?;

            for substep in &step.substeps {
                checklist_count += insert_checklist_items(
                    &tx,
                    plan_path,
                    &substep.anchor,
                    &substep.tasks,
                    "task",
                )?;
                checklist_count += insert_checklist_items(
                    &tx,
                    plan_path,
                    &substep.anchor,
                    &substep.tests,
                    "test",
                )?;
                checklist_count += insert_checklist_items(
                    &tx,
                    plan_path,
                    &substep.anchor,
                    &substep.checkpoints,
                    "checkpoint",
                )?;
            }
        }

        // Commit transaction
        tx.commit().map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to commit transaction: {}", e),
        })?;

        Ok(InitResult {
            already_initialized: false,
            step_count,
            substep_count,
            dep_count,
            checklist_count,
        })
    }
}

/// Result from init_plan operation
pub struct InitResult {
    /// True if the plan was already initialized (idempotent return)
    pub already_initialized: bool,
    /// Number of top-level steps created
    pub step_count: usize,
    /// Number of substeps created
    pub substep_count: usize,
    /// Number of dependency edges created
    pub dep_count: usize,
    /// Number of checklist items created
    pub checklist_count: usize,
}

/// Helper to insert checklist items for a step
fn insert_checklist_items(
    tx: &rusqlite::Transaction,
    plan_path: &str,
    anchor: &str,
    items: &[Checkpoint],
    kind: &str,
) -> Result<usize, TugError> {
    let mut count = 0;
    for (ordinal, item) in items.iter().enumerate() {
        tx.execute(
            "INSERT INTO checklist_items (plan_path, step_anchor, kind, ordinal, text, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'open')",
            rusqlite::params![plan_path, anchor, kind, ordinal as i32, &item.text],
        )
        .map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to insert checklist item: {}", e),
        })?;
        count += 1;
    }
    Ok(count)
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

    // Helper to create a test plan with substeps
    fn make_test_plan() -> TugPlan {
        use crate::types::*;
        TugPlan {
            phase_title: Some("Test Phase".to_string()),
            steps: vec![
                Step {
                    anchor: "step-0".to_string(),
                    title: "Step Zero".to_string(),
                    tasks: vec![Checkpoint {
                        checked: false,
                        text: "Task 1".to_string(),
                        kind: CheckpointKind::Task,
                        line: 1,
                    }],
                    tests: vec![Checkpoint {
                        checked: false,
                        text: "Test 1".to_string(),
                        kind: CheckpointKind::Test,
                        line: 2,
                    }],
                    checkpoints: vec![],
                    substeps: vec![],
                    depends_on: vec![],
                    ..Default::default()
                },
                Step {
                    anchor: "step-1".to_string(),
                    title: "Step One".to_string(),
                    depends_on: vec!["step-0".to_string()],
                    tasks: vec![],
                    tests: vec![],
                    checkpoints: vec![Checkpoint {
                        checked: false,
                        text: "Check 1".to_string(),
                        kind: CheckpointKind::Checkpoint,
                        line: 3,
                    }],
                    substeps: vec![
                        Substep {
                            anchor: "step-1-1".to_string(),
                            title: "Substep 1.1".to_string(),
                            depends_on: vec![],
                            tasks: vec![
                                Checkpoint {
                                    checked: false,
                                    text: "Sub task 1".to_string(),
                                    kind: CheckpointKind::Task,
                                    line: 4,
                                },
                                Checkpoint {
                                    checked: false,
                                    text: "Sub task 2".to_string(),
                                    kind: CheckpointKind::Task,
                                    line: 5,
                                },
                            ],
                            tests: vec![],
                            checkpoints: vec![],
                            ..Default::default()
                        },
                        Substep {
                            anchor: "step-1-2".to_string(),
                            title: "Substep 1.2".to_string(),
                            depends_on: vec!["step-1-1".to_string()],
                            tasks: vec![],
                            tests: vec![Checkpoint {
                                checked: false,
                                text: "Sub test".to_string(),
                                kind: CheckpointKind::Test,
                                line: 6,
                            }],
                            checkpoints: vec![],
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                Step {
                    anchor: "step-2".to_string(),
                    title: "Step Two".to_string(),
                    depends_on: vec!["step-1".to_string()],
                    tasks: vec![],
                    tests: vec![],
                    checkpoints: vec![],
                    substeps: vec![],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn test_init_plan_creates_correct_counts() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        let result = db
            .init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        assert!(!result.already_initialized);
        assert_eq!(result.step_count, 3); // step-0, step-1, step-2
        assert_eq!(result.substep_count, 2); // step-1-1, step-1-2
        assert_eq!(result.dep_count, 3); // step-1->step-0, step-1-2->step-1-1, step-2->step-1
        assert_eq!(result.checklist_count, 6); // task1, test1, check1, sub-task1, sub-task2, sub-test
    }

    #[test]
    fn test_init_plan_is_idempotent() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        let r1 = db
            .init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();
        assert!(!r1.already_initialized);

        let r2 = db
            .init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();
        assert!(r2.already_initialized);
        assert_eq!(r2.step_count, 0);
    }

    #[test]
    fn test_init_plan_step_index_interleaved() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Query step_index values
        let mut stmt = db
            .conn
            .prepare(
                "SELECT anchor, step_index FROM steps WHERE plan_path = ?1 ORDER BY step_index",
            )
            .unwrap();
        let rows: Vec<(String, i32)> = stmt
            .query_map([".tugtool/tugplan-test.md"], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(
            rows,
            vec![
                ("step-0".to_string(), 0),
                ("step-1".to_string(), 1),
                ("step-1-1".to_string(), 2),
                ("step-1-2".to_string(), 3),
                ("step-2".to_string(), 4),
            ]
        );
    }
}
