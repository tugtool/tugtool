//! Embedded SQLite state management for Tugstate
//!
//! Provides `StateDb` for managing plan execution state via an embedded SQLite
//! database. The database tracks steps, substeps, checklist items, dependencies,
//! and artifacts for each initialized plan.

use crate::error::TugError;
use crate::session::now_iso8601;
use crate::types::{Checkpoint, TugPlan};
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Compute an ISO 8601 timestamp `secs` seconds from now
fn iso8601_after_secs(secs: u64) -> String {
    let future = SystemTime::now() + Duration::from_secs(secs);
    let duration = future
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system time should be after epoch");
    let seconds = duration.as_secs();
    let nanos = duration.subsec_nanos();
    let millis = nanos / 1_000_000;

    // Convert to UTC time components
    let days_since_epoch = seconds / 86400;
    let seconds_of_day = seconds % 86400;
    let hours = seconds_of_day / 3600;
    let minutes = (seconds_of_day % 3600) / 60;
    let secs = seconds_of_day % 60;

    // Simple algorithm to convert days since epoch to year/month/day
    // This is a simplified version - assumes post-2000 dates
    let mut year = 1970;
    let mut remaining_days = days_since_epoch;

    // Fast-forward by 400-year cycles (146097 days per cycle)
    let cycles = remaining_days / 146097;
    year += cycles * 400;
    remaining_days %= 146097;

    // Then by years
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    // Find month and day
    let days_in_months = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &days_in_month in &days_in_months {
        if remaining_days < days_in_month {
            break;
        }
        remaining_days -= days_in_month;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, secs, millis
    )
}

fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

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

    /// List all plan paths in the database.
    ///
    /// Used by the doctor health check to detect orphaned plans.
    pub fn list_plan_paths(&self) -> Result<Vec<String>, TugError> {
        let mut stmt = self
            .conn
            .prepare("SELECT plan_path FROM plans ORDER BY plan_path")
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to prepare plan path query: {}", e),
            })?;

        let paths = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query plan paths: {}", e),
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(paths)
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
        // Test-only failure injection for integration testing
        #[cfg(debug_assertions)]
        {
            if std::env::var("TUGSTATE_FORCE_INIT_FAIL").as_deref() == Ok("1") {
                return Err(TugError::StateDbQuery {
                    reason: "forced init failure for testing (TUGSTATE_FORCE_INIT_FAIL=1)"
                        .to_string(),
                });
            }
        }

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

    /// Verify that the plan hash matches the stored hash in the database.
    pub fn verify_plan_hash(&self, plan_path: &str, current_hash: &str) -> Result<(), TugError> {
        let stored_hash: String = self
            .conn
            .query_row(
                "SELECT plan_hash FROM plans WHERE plan_path = ?1",
                [plan_path],
                |row| row.get(0),
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query plan hash: {}", e),
            })?;

        if stored_hash != current_hash {
            return Err(TugError::StatePlanHashMismatch {
                plan_path: plan_path.to_string(),
            });
        }

        Ok(())
    }

    /// Claim the next available step for execution.
    pub fn claim_step(
        &mut self,
        plan_path: &str,
        worktree: &str,
        lease_duration_secs: u64,
        current_hash: &str,
    ) -> Result<ClaimResult, TugError> {
        // Verify plan hash
        self.verify_plan_hash(plan_path, current_hash)?;

        // Begin exclusive transaction
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to begin transaction: {}", e),
            })?;

        let now = now_iso8601();
        let lease_expires = iso8601_after_secs(lease_duration_secs);

        // Find next claimable top-level step
        let claimable = tx
            .query_row(
                "SELECT s.anchor, s.title, s.step_index, s.status, s.lease_expires_at
                 FROM steps s
                 WHERE s.plan_path = ?1
                   AND s.parent_anchor IS NULL
                   AND (s.status = 'pending' OR (s.status IN ('claimed', 'in_progress') AND s.lease_expires_at < ?2))
                   AND NOT EXISTS (
                       SELECT 1 FROM step_deps d
                       JOIN steps dep ON d.plan_path = dep.plan_path AND d.depends_on = dep.anchor
                       WHERE d.plan_path = ?1 AND d.step_anchor = s.anchor AND dep.status != 'completed'
                   )
                 ORDER BY s.step_index
                 LIMIT 1",
                rusqlite::params![plan_path, &now],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            );

        match claimable {
            Ok((anchor, title, index, status, _old_lease)) => {
                let reclaimed = status != "pending";

                // Update the parent step
                tx.execute(
                    "UPDATE steps SET status = 'claimed', claimed_by = ?1, claimed_at = ?2,
                     lease_expires_at = ?3, heartbeat_at = ?2
                     WHERE plan_path = ?4 AND anchor = ?5",
                    rusqlite::params![worktree, &now, &lease_expires, plan_path, &anchor],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to update claimed step: {}", e),
                })?;

                // Update non-completed substeps to claimed
                tx.execute(
                    "UPDATE steps SET status = 'claimed', claimed_by = ?1, claimed_at = ?2,
                     lease_expires_at = ?3, heartbeat_at = ?2
                     WHERE plan_path = ?4 AND parent_anchor = ?5 AND status != 'completed'",
                    rusqlite::params![worktree, &now, &lease_expires, plan_path, &anchor],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to update substeps: {}", e),
                })?;

                // If reclaimed, reset checklist items for non-completed substeps back to 'open'
                if reclaimed {
                    tx.execute(
                        "UPDATE checklist_items SET status = 'open', updated_at = NULL
                         WHERE plan_path = ?1 AND step_anchor IN (
                             SELECT anchor FROM steps WHERE plan_path = ?1 AND parent_anchor = ?2 AND status = 'claimed'
                         )",
                        rusqlite::params![plan_path, &anchor],
                    )
                    .map_err(|e| TugError::StateDbQuery {
                        reason: format!("failed to reset checklist items: {}", e),
                    })?;
                }

                // Count remaining ready steps
                let remaining_ready: usize = tx
                    .query_row(
                        "SELECT COUNT(*) FROM steps s
                         WHERE s.plan_path = ?1
                           AND s.parent_anchor IS NULL
                           AND s.status = 'pending'
                           AND NOT EXISTS (
                               SELECT 1 FROM step_deps d
                               JOIN steps dep ON d.plan_path = dep.plan_path AND d.depends_on = dep.anchor
                               WHERE d.plan_path = ?1 AND d.step_anchor = s.anchor AND dep.status != 'completed'
                           )",
                        [plan_path],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                // Count total remaining steps
                let total_remaining: usize = tx
                    .query_row(
                        "SELECT COUNT(*) FROM steps WHERE plan_path = ?1 AND parent_anchor IS NULL AND status != 'completed'",
                        [plan_path],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                tx.commit().map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to commit claim transaction: {}", e),
                })?;

                Ok(ClaimResult::Claimed {
                    anchor,
                    title,
                    index,
                    remaining_ready,
                    total_remaining: total_remaining - 1, // Exclude the just-claimed step
                    lease_expires,
                    reclaimed,
                })
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // No claimable steps found - check if all completed
                let total: i32 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM steps WHERE plan_path = ?1 AND parent_anchor IS NULL",
                        [plan_path],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                let completed: i32 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM steps WHERE plan_path = ?1 AND parent_anchor IS NULL AND status = 'completed'",
                        [plan_path],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                if total > 0 && completed == total {
                    Ok(ClaimResult::AllCompleted)
                } else {
                    let blocked = (total - completed) as usize;
                    Ok(ClaimResult::NoReadySteps {
                        all_completed: false,
                        blocked,
                    })
                }
            }
            Err(e) => Err(TugError::StateDbQuery {
                reason: format!("failed to query claimable steps: {}", e),
            }),
        }
    }

    /// Check if the given worktree owns the step (or its parent if it's a substep).
    pub fn check_ownership(
        &self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
    ) -> Result<(), TugError> {
        let result: Option<String> = self
            .conn
            .query_row(
                "SELECT claimed_by FROM steps
                 WHERE plan_path = ?1
                   AND anchor = COALESCE(
                       (SELECT parent_anchor FROM steps WHERE plan_path = ?2 AND anchor = ?3),
                       ?4
                   )
                   AND status IN ('claimed', 'in_progress')",
                rusqlite::params![plan_path, plan_path, anchor, anchor],
                |row| row.get(0),
            )
            .ok();

        match result {
            Some(claimed_by) if claimed_by == worktree => Ok(()),
            Some(claimed_by) => Err(TugError::StateOwnershipViolation {
                anchor: anchor.to_string(),
                claimed_by,
                worktree: worktree.to_string(),
            }),
            None => Err(TugError::StateStepNotClaimed {
                anchor: anchor.to_string(),
                current_status: "unknown or completed".to_string(),
            }),
        }
    }

    /// Start a claimed step, transitioning it from 'claimed' to 'in_progress'.
    pub fn start_step(
        &self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
    ) -> Result<(), TugError> {
        let now = now_iso8601();
        let rows_affected = self
            .conn
            .execute(
                "UPDATE steps SET status = 'in_progress', started_at = ?1
                 WHERE plan_path = ?2 AND anchor = ?3 AND claimed_by = ?4 AND status = 'claimed'",
                rusqlite::params![&now, plan_path, anchor, worktree],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to start step: {}", e),
            })?;

        if rows_affected == 0 {
            // Check ownership
            self.check_ownership(plan_path, anchor, worktree)?;
            // If ownership is fine, step is not in claimed status
            return Err(TugError::StateStepNotClaimed {
                anchor: anchor.to_string(),
                current_status: "not claimed".to_string(),
            });
        }

        Ok(())
    }

    /// Renew the lease on a step via heartbeat.
    pub fn heartbeat_step(
        &self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
        lease_duration_secs: u64,
    ) -> Result<String, TugError> {
        let now = now_iso8601();
        let lease_expires = iso8601_after_secs(lease_duration_secs);

        let rows_affected = self
            .conn
            .execute(
                "UPDATE steps SET heartbeat_at = ?1, lease_expires_at = ?2
                 WHERE plan_path = ?3 AND anchor = ?4 AND claimed_by = ?5 AND status IN ('claimed', 'in_progress')",
                rusqlite::params![&now, &lease_expires, plan_path, anchor, worktree],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to update heartbeat: {}", e),
            })?;

        if rows_affected == 0 {
            // Check ownership
            self.check_ownership(plan_path, anchor, worktree)?;
            return Err(TugError::StateStepNotClaimed {
                anchor: anchor.to_string(),
                current_status: "not claimed or in progress".to_string(),
            });
        }

        Ok(lease_expires)
    }

    /// Update checklist item(s) for a step.
    pub fn update_checklist(
        &self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
        updates: &[ChecklistUpdate],
    ) -> Result<UpdateResult, TugError> {
        // Check ownership first
        self.check_ownership(plan_path, anchor, worktree)?;

        let now = now_iso8601();
        let mut total_updated = 0;

        for update in updates {
            let rows_affected = match update {
                ChecklistUpdate::Individual {
                    kind,
                    ordinal,
                    status,
                } => self.conn.execute(
                    "UPDATE checklist_items SET status = ?1, updated_at = ?2
                         WHERE plan_path = ?3 AND step_anchor = ?4 AND kind = ?5 AND ordinal = ?6",
                    rusqlite::params![status, &now, plan_path, anchor, kind, ordinal],
                ),
                ChecklistUpdate::BulkByKind { kind, status } => self.conn.execute(
                    "UPDATE checklist_items SET status = ?1, updated_at = ?2
                         WHERE plan_path = ?3 AND step_anchor = ?4 AND kind = ?5",
                    rusqlite::params![status, &now, plan_path, anchor, kind],
                ),
                ChecklistUpdate::AllItems { status } => self.conn.execute(
                    "UPDATE checklist_items SET status = ?1, updated_at = ?2
                         WHERE plan_path = ?3 AND step_anchor = ?4",
                    rusqlite::params![status, &now, plan_path, anchor],
                ),
            }
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to update checklist: {}", e),
            })?;

            total_updated += rows_affected;
        }

        Ok(UpdateResult {
            items_updated: total_updated,
        })
    }

    /// Record an artifact breadcrumb for a step.
    pub fn record_artifact(
        &self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
        kind: &str,
        summary: &str,
    ) -> Result<i64, TugError> {
        // Check ownership first
        self.check_ownership(plan_path, anchor, worktree)?;

        let now = now_iso8601();
        let truncated_summary = if summary.len() > 500 {
            &summary[..500]
        } else {
            summary
        };

        self.conn
            .execute(
                "INSERT INTO step_artifacts (plan_path, step_anchor, kind, summary, recorded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![plan_path, anchor, kind, truncated_summary, &now],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to record artifact: {}", e),
            })?;

        Ok(self.conn.last_insert_rowid())
    }

    /// Complete a step, optionally forcing completion despite incomplete items/substeps.
    pub fn complete_step(
        &mut self,
        plan_path: &str,
        anchor: &str,
        worktree: &str,
        force: bool,
        force_reason: Option<&str>,
    ) -> Result<CompleteResult, TugError> {
        // Begin exclusive transaction
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to begin transaction: {}", e),
            })?;

        let now = now_iso8601();

        // Check if this is a top-level step or substep
        let is_substep: bool = tx
            .query_row(
                "SELECT parent_anchor IS NOT NULL FROM steps WHERE plan_path = ?1 AND anchor = ?2",
                rusqlite::params![plan_path, anchor],
                |row| row.get(0),
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query step: {}", e),
            })?;

        if !force {
            // Strict mode: check all checklist items are completed
            let incomplete_items: usize = tx
                .query_row(
                    "SELECT COUNT(*) FROM checklist_items
                     WHERE plan_path = ?1 AND step_anchor = ?2 AND status != 'completed'",
                    rusqlite::params![plan_path, anchor],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if incomplete_items > 0 {
                return Err(TugError::StateIncompleteChecklist {
                    anchor: anchor.to_string(),
                    incomplete_count: incomplete_items,
                });
            }

            // If top-level step, check all substeps are completed
            if !is_substep {
                let incomplete_substeps: usize = tx
                    .query_row(
                        "SELECT COUNT(*) FROM steps
                         WHERE plan_path = ?1 AND parent_anchor = ?2 AND status != 'completed'",
                        rusqlite::params![plan_path, anchor],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                if incomplete_substeps > 0 {
                    return Err(TugError::StateIncompleteSubsteps {
                        anchor: anchor.to_string(),
                        incomplete_count: incomplete_substeps,
                    });
                }
            }
        } else {
            // Force mode: auto-complete remaining checklist items
            tx.execute(
                "UPDATE checklist_items SET status = 'completed', updated_at = ?1
                 WHERE plan_path = ?2 AND step_anchor = ?3 AND status != 'completed'",
                rusqlite::params![&now, plan_path, anchor],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to force-complete checklist items: {}", e),
            })?;

            // Force mode: auto-complete remaining substeps (if top-level step)
            if !is_substep {
                tx.execute(
                    "UPDATE steps SET status = 'completed', completed_at = ?1
                     WHERE plan_path = ?2 AND parent_anchor = ?3 AND status != 'completed'",
                    rusqlite::params![&now, plan_path, anchor],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to force-complete substeps: {}", e),
                })?;
            }
        }

        // Update the step to completed
        let reason = if force {
            force_reason.unwrap_or("forced completion")
        } else {
            ""
        };

        let rows_affected = tx
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = ?1, complete_reason = ?2
                 WHERE plan_path = ?3 AND anchor = ?4 AND claimed_by = ?5 AND status IN ('claimed', 'in_progress')",
                rusqlite::params![&now, reason, plan_path, anchor, worktree],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to complete step: {}", e),
            })?;

        if rows_affected == 0 {
            // No rows updated means either not claimed by this worktree or already completed
            return Err(TugError::StateStepNotClaimed {
                anchor: anchor.to_string(),
                current_status: "not claimed by this worktree or already completed".to_string(),
            });
        }

        // If this is a top-level step, check if all top-level steps are now completed
        let mut all_completed = false;
        if !is_substep {
            let remaining: i32 = tx
                .query_row(
                    "SELECT COUNT(*) FROM steps
                     WHERE plan_path = ?1 AND parent_anchor IS NULL AND status != 'completed'",
                    rusqlite::params![plan_path],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if remaining == 0 {
                // Mark plan as done
                tx.execute(
                    "UPDATE plans SET status = 'done', updated_at = ?1 WHERE plan_path = ?2",
                    rusqlite::params![&now, plan_path],
                )
                .map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to update plan status: {}", e),
                })?;
                all_completed = true;
            }
        }

        tx.commit().map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to commit completion transaction: {}", e),
        })?;

        Ok(CompleteResult {
            completed: true,
            forced: force,
            all_steps_completed: all_completed,
        })
    }

    /// Query plan state for show command
    pub fn show_plan(&self, plan_path: &str) -> Result<PlanState, TugError> {
        // Query plan metadata
        let (plan_hash, phase_title, status, created_at, updated_at): (
            String,
            Option<String>,
            String,
            String,
            String,
        ) = self
            .conn
            .query_row(
                "SELECT plan_hash, phase_title, status, created_at, updated_at
                 FROM plans WHERE plan_path = ?1",
                rusqlite::params![plan_path],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query plan: {}", e),
            })?;

        // Query all top-level steps (those with parent_anchor = NULL)
        let mut stmt = self
            .conn
            .prepare(
                "SELECT anchor, title, step_index, status, claimed_by, lease_expires_at,
                        completed_at, commit_hash, complete_reason
                 FROM steps WHERE plan_path = ?1 AND parent_anchor IS NULL
                 ORDER BY step_index",
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to prepare step query: {}", e),
            })?;

        let mut steps = Vec::new();
        let step_rows = stmt
            .query_map(rusqlite::params![plan_path], |row| {
                Ok((
                    row.get::<_, String>(0)?,         // anchor
                    row.get::<_, String>(1)?,         // title
                    row.get::<_, i32>(2)?,            // step_index
                    row.get::<_, String>(3)?,         // status
                    row.get::<_, Option<String>>(4)?, // claimed_by
                    row.get::<_, Option<String>>(5)?, // lease_expires_at
                    row.get::<_, Option<String>>(6)?, // completed_at
                    row.get::<_, Option<String>>(7)?, // commit_hash
                    row.get::<_, Option<String>>(8)?, // complete_reason
                ))
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query steps: {}", e),
            })?;

        for row in step_rows {
            let (
                anchor,
                title,
                step_index,
                status,
                claimed_by,
                lease_expires_at,
                completed_at,
                commit_hash,
                complete_reason,
            ) = row.map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to read step row: {}", e),
            })?;

            let checklist = self.query_checklist_summary(plan_path, &anchor)?;
            let substeps = self.query_substeps(plan_path, &anchor)?;
            let artifacts = self.query_artifacts(plan_path, &anchor)?;

            steps.push(StepState {
                anchor,
                title,
                step_index,
                parent_anchor: None,
                status,
                claimed_by,
                lease_expires_at,
                completed_at,
                commit_hash,
                complete_reason,
                checklist,
                substeps,
                artifacts,
            });
        }

        Ok(PlanState {
            plan_path: plan_path.to_string(),
            plan_hash,
            phase_title,
            status,
            steps,
            created_at,
            updated_at,
        })
    }

    /// Helper: query checklist summary for a step
    fn query_checklist_summary(
        &self,
        plan_path: &str,
        anchor: &str,
    ) -> Result<ChecklistSummary, TugError> {
        let (tasks_total, tasks_completed): (i32, i32) = self
            .conn
            .query_row(
                "SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)
                 FROM checklist_items WHERE plan_path = ?1 AND step_anchor = ?2 AND kind = 'task'",
                rusqlite::params![plan_path, anchor],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        let (tests_total, tests_completed): (i32, i32) = self
            .conn
            .query_row(
                "SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)
                 FROM checklist_items WHERE plan_path = ?1 AND step_anchor = ?2 AND kind = 'test'",
                rusqlite::params![plan_path, anchor],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        let (checkpoints_total, checkpoints_completed): (i32, i32) = self
            .conn
            .query_row(
                "SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)
                 FROM checklist_items WHERE plan_path = ?1 AND step_anchor = ?2 AND kind = 'checkpoint'",
                rusqlite::params![plan_path, anchor],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        Ok(ChecklistSummary {
            tasks_total: tasks_total as usize,
            tasks_completed: tasks_completed as usize,
            tests_total: tests_total as usize,
            tests_completed: tests_completed as usize,
            checkpoints_total: checkpoints_total as usize,
            checkpoints_completed: checkpoints_completed as usize,
        })
    }

    /// Helper: query substeps for a parent step
    fn query_substeps(
        &self,
        plan_path: &str,
        parent_anchor: &str,
    ) -> Result<Vec<StepState>, TugError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT anchor, title, step_index, status, claimed_by, lease_expires_at,
                        completed_at, commit_hash, complete_reason
                 FROM steps WHERE plan_path = ?1 AND parent_anchor = ?2
                 ORDER BY step_index",
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to prepare substep query: {}", e),
            })?;

        let mut substeps = Vec::new();
        let rows = stmt
            .query_map(rusqlite::params![plan_path, parent_anchor], |row| {
                Ok((
                    row.get::<_, String>(0)?,         // anchor
                    row.get::<_, String>(1)?,         // title
                    row.get::<_, i32>(2)?,            // step_index
                    row.get::<_, String>(3)?,         // status
                    row.get::<_, Option<String>>(4)?, // claimed_by
                    row.get::<_, Option<String>>(5)?, // lease_expires_at
                    row.get::<_, Option<String>>(6)?, // completed_at
                    row.get::<_, Option<String>>(7)?, // commit_hash
                    row.get::<_, Option<String>>(8)?, // complete_reason
                ))
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query substeps: {}", e),
            })?;

        for row in rows {
            let (
                anchor,
                title,
                step_index,
                status,
                claimed_by,
                lease_expires_at,
                completed_at,
                commit_hash,
                complete_reason,
            ) = row.map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to read substep row: {}", e),
            })?;

            let checklist = self.query_checklist_summary(plan_path, &anchor)?;
            let artifacts = self.query_artifacts(plan_path, &anchor)?;

            substeps.push(StepState {
                anchor,
                title,
                step_index,
                parent_anchor: Some(parent_anchor.to_string()),
                status,
                claimed_by,
                lease_expires_at,
                completed_at,
                commit_hash,
                complete_reason,
                checklist,
                substeps: vec![], // substeps don't have sub-substeps
                artifacts,
            });
        }

        Ok(substeps)
    }

    /// Helper: query artifacts for a step
    fn query_artifacts(
        &self,
        plan_path: &str,
        anchor: &str,
    ) -> Result<Vec<ArtifactSummary>, TugError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT kind, summary, recorded_at
                 FROM step_artifacts WHERE plan_path = ?1 AND step_anchor = ?2
                 ORDER BY recorded_at",
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to prepare artifact query: {}", e),
            })?;

        let mut artifacts = Vec::new();
        let rows = stmt
            .query_map(rusqlite::params![plan_path, anchor], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query artifacts: {}", e),
            })?;

        for row in rows {
            let (kind, summary, recorded_at) = row.map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to read artifact row: {}", e),
            })?;
            artifacts.push(ArtifactSummary {
                kind,
                summary,
                recorded_at,
            });
        }

        Ok(artifacts)
    }

    /// List ready steps for claiming
    pub fn ready_steps(&self, plan_path: &str) -> Result<ReadyResult, TugError> {
        let now = now_iso8601();

        // Query all top-level steps with their dependency status
        let mut ready = Vec::new();
        let mut blocked = Vec::new();
        let mut completed = Vec::new();
        let mut expired_claim = Vec::new();

        let mut stmt = self
            .conn
            .prepare(
                "SELECT anchor, title, step_index, status, lease_expires_at
                 FROM steps WHERE plan_path = ?1 AND parent_anchor IS NULL
                 ORDER BY step_index",
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to prepare ready query: {}", e),
            })?;

        let rows = stmt
            .query_map(rusqlite::params![plan_path], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query ready steps: {}", e),
            })?;

        for row in rows {
            let (anchor, title, step_index, status, lease_expires_at) =
                row.map_err(|e| TugError::StateDbQuery {
                    reason: format!("failed to read ready row: {}", e),
                })?;

            let info = StepInfo {
                anchor: anchor.clone(),
                title,
                step_index,
            };

            if status == "completed" {
                completed.push(info);
            } else if let Some(lease_expiry) = lease_expires_at {
                if status == "claimed" || status == "in_progress" {
                    if lease_expiry < now {
                        expired_claim.push(info);
                    } else {
                        // Active claim
                        blocked.push(info);
                    }
                }
            } else if status == "pending" {
                // Check if all dependencies are completed
                let deps_completed: bool = self
                    .conn
                    .query_row(
                        "SELECT COUNT(*) = 0 FROM step_deps d
                         JOIN steps s ON d.plan_path = s.plan_path AND d.depends_on = s.anchor
                         WHERE d.plan_path = ?1 AND d.step_anchor = ?2 AND s.status != 'completed'",
                        rusqlite::params![plan_path, &anchor],
                        |row| row.get::<_, bool>(0),
                    )
                    .unwrap_or(true);

                if deps_completed {
                    ready.push(info);
                } else {
                    blocked.push(info);
                }
            }
        }

        Ok(ReadyResult {
            ready,
            blocked,
            completed,
            expired_claim,
        })
    }

    /// Reset a step to pending status
    pub fn reset_step(&mut self, plan_path: &str, anchor: &str) -> Result<(), TugError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to begin transaction: {}", e),
            })?;

        // Check if step is completed
        let status: String = tx
            .query_row(
                "SELECT status FROM steps WHERE plan_path = ?1 AND anchor = ?2",
                rusqlite::params![plan_path, anchor],
                |row| row.get(0),
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query step status: {}", e),
            })?;

        if status == "completed" {
            return Err(TugError::StateStepNotClaimed {
                anchor: anchor.to_string(),
                current_status: "cannot reset completed step".to_string(),
            });
        }

        // Check if this is a top-level step
        let is_substep: bool = tx
            .query_row(
                "SELECT parent_anchor IS NOT NULL FROM steps WHERE plan_path = ?1 AND anchor = ?2",
                rusqlite::params![plan_path, anchor],
                |row| row.get(0),
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to query step type: {}", e),
            })?;

        let now = now_iso8601();

        // Reset the step
        tx.execute(
            "UPDATE steps SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
                              lease_expires_at = NULL, heartbeat_at = NULL, started_at = NULL
             WHERE plan_path = ?1 AND anchor = ?2",
            rusqlite::params![plan_path, anchor],
        )
        .map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to reset step: {}", e),
        })?;

        // Reset non-completed checklist items
        tx.execute(
            "UPDATE checklist_items SET status = 'open', updated_at = ?1
             WHERE plan_path = ?2 AND step_anchor = ?3 AND status != 'completed'",
            rusqlite::params![&now, plan_path, anchor],
        )
        .map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to reset checklist items: {}", e),
        })?;

        // If top-level step, cascade to non-completed substeps
        if !is_substep {
            // Reset non-completed substeps
            tx.execute(
                "UPDATE steps SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
                                  lease_expires_at = NULL, heartbeat_at = NULL, started_at = NULL
                 WHERE plan_path = ?1 AND parent_anchor = ?2 AND status != 'completed'",
                rusqlite::params![plan_path, anchor],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to reset substeps: {}", e),
            })?;

            // Reset checklist items for those substeps
            tx.execute(
                "UPDATE checklist_items SET status = 'open', updated_at = ?1
                 WHERE plan_path = ?2 AND step_anchor IN (
                     SELECT anchor FROM steps WHERE plan_path = ?2 AND parent_anchor = ?3 AND status != 'completed'
                 ) AND status != 'completed'",
                rusqlite::params![&now, plan_path, anchor],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to reset substep checklist items: {}", e),
            })?;
        }

        tx.commit().map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to commit reset transaction: {}", e),
        })?;

        Ok(())
    }

    /// Reconcile state from git trailers
    pub fn reconcile(
        &mut self,
        plan_path: &str,
        entries: &[ReconcileEntry],
        force: bool,
    ) -> Result<ReconcileResult, TugError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to begin transaction: {}", e),
            })?;

        let now = now_iso8601();
        let mut reconciled_count = 0;
        let mut skipped_count = 0;
        let mut skipped_mismatches = Vec::new();

        for entry in entries {
            if entry.plan_path != plan_path {
                continue; // Skip entries for other plans
            }

            // Check if step exists and its current status
            let existing: Option<(String, Option<String>)> = tx
                .query_row(
                    "SELECT status, commit_hash FROM steps WHERE plan_path = ?1 AND anchor = ?2",
                    rusqlite::params![plan_path, &entry.step_anchor],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((status, Some(db_hash))) if status == "completed" => {
                    // Step already completed
                    if db_hash != entry.commit_hash {
                        // Hash mismatch
                        if force {
                            // Force mode: overwrite
                            tx.execute(
                                "UPDATE steps SET commit_hash = ?1
                                 WHERE plan_path = ?2 AND anchor = ?3",
                                rusqlite::params![
                                    &entry.commit_hash,
                                    plan_path,
                                    &entry.step_anchor
                                ],
                            )
                            .map_err(|e| TugError::StateDbQuery {
                                reason: format!("failed to update commit hash: {}", e),
                            })?;
                            reconciled_count += 1;
                        } else {
                            // Default mode: skip and record mismatch
                            skipped_count += 1;
                            skipped_mismatches.push(SkippedMismatch {
                                step_anchor: entry.step_anchor.clone(),
                                db_hash: db_hash.clone(),
                                git_hash: entry.commit_hash.clone(),
                            });
                        }
                    }
                    // else: hashes match, nothing to do
                }
                Some((status, _)) if status != "completed" => {
                    // Step not completed yet - mark it as completed
                    tx.execute(
                        "UPDATE steps SET status = 'completed', completed_at = ?1, commit_hash = ?2
                         WHERE plan_path = ?3 AND anchor = ?4",
                        rusqlite::params![&now, &entry.commit_hash, plan_path, &entry.step_anchor],
                    )
                    .map_err(|e| TugError::StateDbQuery {
                        reason: format!("failed to reconcile step: {}", e),
                    })?;

                    // Auto-complete all checklist items
                    tx.execute(
                        "UPDATE checklist_items SET status = 'completed', updated_at = ?1
                         WHERE plan_path = ?2 AND step_anchor = ?3",
                        rusqlite::params![&now, plan_path, &entry.step_anchor],
                    )
                    .map_err(|e| TugError::StateDbQuery {
                        reason: format!("failed to complete checklist items: {}", e),
                    })?;

                    reconciled_count += 1;
                }
                None => {
                    // Step doesn't exist - skip silently (may be from old plan version)
                }
                _ => {
                    // Completed but no commit hash - set it
                    tx.execute(
                        "UPDATE steps SET commit_hash = ?1
                         WHERE plan_path = ?2 AND anchor = ?3",
                        rusqlite::params![&entry.commit_hash, plan_path, &entry.step_anchor],
                    )
                    .map_err(|e| TugError::StateDbQuery {
                        reason: format!("failed to set commit hash: {}", e),
                    })?;
                    reconciled_count += 1;
                }
            }
        }

        tx.commit().map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to commit reconcile transaction: {}", e),
        })?;

        Ok(ReconcileResult {
            reconciled_count,
            skipped_count,
            skipped_mismatches,
        })
    }
}

/// Checklist update operation
#[derive(Debug)]
pub enum ChecklistUpdate {
    /// Update a single item by kind and ordinal
    Individual {
        kind: String,
        ordinal: i32,
        status: String,
    },
    /// Update all items of a specific kind
    BulkByKind { kind: String, status: String },
    /// Update all items for the step
    AllItems { status: String },
}

/// Result from update_checklist operation
#[derive(Debug)]
pub struct UpdateResult {
    /// Number of checklist items updated
    pub items_updated: usize,
}

/// Result from complete_step operation
#[derive(Debug)]
pub struct CompleteResult {
    /// True if step was completed
    pub completed: bool,
    /// True if completion was forced
    pub forced: bool,
    /// True if all steps in the plan are now completed
    pub all_steps_completed: bool,
}

/// Result from claim_step operation
#[derive(Debug)]
pub enum ClaimResult {
    /// Successfully claimed a step
    Claimed {
        anchor: String,
        title: String,
        index: i32,
        remaining_ready: usize,
        total_remaining: usize,
        lease_expires: String,
        reclaimed: bool,
    },
    /// No steps ready for claiming (but not all completed)
    NoReadySteps { all_completed: bool, blocked: usize },
    /// All steps completed
    AllCompleted,
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

/// Checklist summary counts by kind and status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistSummary {
    pub tasks_total: usize,
    pub tasks_completed: usize,
    pub tests_total: usize,
    pub tests_completed: usize,
    pub checkpoints_total: usize,
    pub checkpoints_completed: usize,
}

/// Artifact summary for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactSummary {
    pub kind: String,
    pub summary: String,
    pub recorded_at: String,
}

/// Step state for show command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepState {
    pub anchor: String,
    pub title: String,
    pub step_index: i32,
    pub parent_anchor: Option<String>,
    pub status: String,
    pub claimed_by: Option<String>,
    pub lease_expires_at: Option<String>,
    pub completed_at: Option<String>,
    pub commit_hash: Option<String>,
    pub complete_reason: Option<String>,
    pub checklist: ChecklistSummary,
    pub substeps: Vec<StepState>,
    pub artifacts: Vec<ArtifactSummary>,
}

/// Plan state for show command
#[derive(Debug, Serialize, Deserialize)]
pub struct PlanState {
    pub plan_path: String,
    pub plan_hash: String,
    pub phase_title: Option<String>,
    pub status: String,
    pub steps: Vec<StepState>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result from ready_steps operation
#[derive(Debug, Serialize, Deserialize)]
pub struct ReadyResult {
    pub ready: Vec<StepInfo>,
    pub blocked: Vec<StepInfo>,
    pub completed: Vec<StepInfo>,
    pub expired_claim: Vec<StepInfo>,
}

/// Basic step information for ready command
#[derive(Debug, Serialize, Deserialize)]
pub struct StepInfo {
    pub anchor: String,
    pub title: String,
    pub step_index: i32,
}

/// Entry parsed from git trailers for reconcile
#[derive(Debug, Serialize, Deserialize)]
pub struct ReconcileEntry {
    pub step_anchor: String,
    pub plan_path: String,
    pub commit_hash: String,
}

/// A skipped mismatch during reconcile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedMismatch {
    pub step_anchor: String,
    pub db_hash: String,
    pub git_hash: String,
}

/// Result from reconcile operation
#[derive(Debug, Serialize, Deserialize)]
pub struct ReconcileResult {
    pub reconciled_count: usize,
    pub skipped_count: usize,
    pub skipped_mismatches: Vec<SkippedMismatch>,
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

    #[test]
    fn test_claim_returns_first_ready_step() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        let result = db
            .claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        match result {
            ClaimResult::Claimed { anchor, index, .. } => {
                assert_eq!(anchor, "step-0");
                assert_eq!(index, 0);
            }
            _ => panic!("Expected Claimed, got: {:?}", result),
        }
    }

    #[test]
    fn test_claim_respects_dependency_graph() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim step-0
        let result = db
            .claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        assert!(matches!(result, ClaimResult::Claimed { .. }));

        // Try to claim again - step-1 depends on step-0 which is still claimed
        // step-2 depends on step-1, so neither should be available
        let result2 = db
            .claim_step(".tugtool/tugplan-test.md", "wt-b", 7200, "abc123hash")
            .unwrap();

        match result2 {
            ClaimResult::NoReadySteps { blocked, .. } => {
                // step-0 is claimed (not completed), step-1 depends on step-0, step-2 depends on step-1
                // So all 3 remaining steps are blocked
                assert_eq!(blocked, 3);
            }
            _ => panic!("Expected NoReadySteps, got: {:?}", result2),
        }
    }

    #[test]
    fn test_claim_expired_lease_reclaims() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim step-0 as wt-a
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        // Manually set lease to expired (past timestamp)
        db.conn
            .execute(
                "UPDATE steps SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE anchor = 'step-0'",
                [],
            )
            .unwrap();

        // Reclaim as wt-b
        let result = db
            .claim_step(".tugtool/tugplan-test.md", "wt-b", 7200, "abc123hash")
            .unwrap();

        match result {
            ClaimResult::Claimed {
                anchor, reclaimed, ..
            } => {
                assert_eq!(anchor, "step-0");
                assert!(reclaimed);
            }
            _ => panic!("Expected Claimed with reclaimed=true"),
        }

        // Verify claimed_by was updated
        let claimed_by: String = db
            .conn
            .query_row(
                "SELECT claimed_by FROM steps WHERE plan_path = '.tugtool/tugplan-test.md' AND anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(claimed_by, "wt-b");
    }

    #[test]
    fn test_reclaim_preserves_completed_substeps() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Complete step-0 so step-1 can be claimed
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed' WHERE anchor = 'step-0'",
                [],
            )
            .unwrap();

        // Claim step-1 (which has substeps)
        let result = db
            .claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        // Verify we got step-1
        match result {
            ClaimResult::Claimed { anchor, .. } => {
                assert_eq!(anchor, "step-1");
            }
            _ => panic!("Expected to claim step-1"),
        }

        // Mark substep step-1-1 as completed
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = '2024-01-01T00:00:00.000Z'
                 WHERE anchor = 'step-1-1'",
                [],
            )
            .unwrap();

        // Mark one checklist item of step-1-1 as done
        db.conn
            .execute(
                "UPDATE checklist_items SET status = 'done', updated_at = '2024-01-01T00:00:00.000Z'
                 WHERE step_anchor = 'step-1-1' AND kind = 'task' AND ordinal = 0",
                [],
            )
            .unwrap();

        // Expire the lease on step-1
        db.conn
            .execute(
                "UPDATE steps SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE anchor = 'step-1'",
                [],
            )
            .unwrap();

        // Reclaim step-1 as wt-b
        db.claim_step(".tugtool/tugplan-test.md", "wt-b", 7200, "abc123hash")
            .unwrap();

        // Verify completed substep is still completed
        let substep_status: String = db
            .conn
            .query_row(
                "SELECT status FROM steps WHERE anchor = 'step-1-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(substep_status, "completed");

        // Verify completed checklist item is still done
        let item_status: String = db
            .conn
            .query_row(
                "SELECT status FROM checklist_items WHERE step_anchor = 'step-1-1' AND kind = 'task' AND ordinal = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(item_status, "done");

        // Verify non-completed substep (step-1-2) was reclaimed
        let substep2_claimed: String = db
            .conn
            .query_row(
                "SELECT claimed_by FROM steps WHERE anchor = 'step-1-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(substep2_claimed, "wt-b");
    }

    #[test]
    fn test_claim_all_completed() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Mark all top-level steps as completed
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed' WHERE parent_anchor IS NULL",
                [],
            )
            .unwrap();

        // Try to claim - should return AllCompleted
        let result = db
            .claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        assert!(matches!(result, ClaimResult::AllCompleted));
    }

    #[test]
    fn test_claim_plan_hash_mismatch() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Try to claim with wrong hash
        let result = db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "wrong-hash");

        assert!(result.is_err());
        match result.unwrap_err() {
            TugError::StatePlanHashMismatch { .. } => {} // expected
            other => panic!("Expected StatePlanHashMismatch, got: {:?}", other),
        }
    }

    #[test]
    fn test_start_succeeds_for_claimer() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        // Start it
        let result = db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a");
        assert!(result.is_ok());

        // Verify status is now in_progress
        let status: String = db
            .conn
            .query_row(
                "SELECT status FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "in_progress");
    }

    #[test]
    fn test_start_fails_for_different_worktree() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim step-0 as wt-a
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        // Try to start as wt-b
        let result = db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-b");
        assert!(result.is_err());

        match result.unwrap_err() {
            TugError::StateOwnershipViolation { .. } => {} // expected
            other => panic!("Expected StateOwnershipViolation, got: {:?}", other),
        }
    }

    #[test]
    fn test_start_fails_when_not_claimed() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Try to start without claiming
        let result = db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a");
        assert!(result.is_err());

        match result.unwrap_err() {
            TugError::StateStepNotClaimed { .. } => {} // expected
            other => panic!("Expected StateStepNotClaimed, got: {:?}", other),
        }
    }

    #[test]
    fn test_heartbeat_extends_lease() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim and start step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a")
            .unwrap();

        // Get original lease
        let original_lease: String = db
            .conn
            .query_row(
                "SELECT lease_expires_at FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Sleep briefly to ensure timestamp changes (now_iso8601 has millisecond precision)
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Send heartbeat
        let new_lease = db
            .heartbeat_step(".tugtool/tugplan-test.md", "step-0", "wt-a", 7200)
            .unwrap();

        // Verify lease was extended (new lease should be different from original)
        assert_ne!(new_lease, original_lease);

        // Verify it was updated in DB
        let db_lease: String = db
            .conn
            .query_row(
                "SELECT lease_expires_at FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(db_lease, new_lease);
    }

    #[test]
    fn test_heartbeat_fails_for_non_claimer() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim and start step-0 as wt-a
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a")
            .unwrap();

        // Try to heartbeat as wt-b
        let result = db.heartbeat_step(".tugtool/tugplan-test.md", "step-0", "wt-b", 7200);
        assert!(result.is_err());

        match result.unwrap_err() {
            TugError::StateOwnershipViolation { .. } => {} // expected
            other => panic!("Expected StateOwnershipViolation, got: {:?}", other),
        }
    }

    // Helper: setup a test with plan initialized and step-0 claimed and started
    fn setup_claimed_plan() -> (TempDir, StateDb) {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim and start step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a")
            .unwrap();

        (temp, db)
    }

    #[test]
    fn test_update_checklist_individual() {
        let (_temp, db) = setup_claimed_plan();

        // Update task 1 (0-indexed in storage)
        let updates = vec![ChecklistUpdate::Individual {
            kind: "task".to_string(),
            ordinal: 0,
            status: "completed".to_string(),
        }];

        let result = db
            .update_checklist(".tugtool/tugplan-test.md", "step-0", "wt-a", &updates)
            .unwrap();

        assert_eq!(result.items_updated, 1);

        // Verify it was updated
        let status: String = db
            .conn
            .query_row(
                "SELECT status FROM checklist_items WHERE step_anchor = 'step-0' AND kind = 'task' AND ordinal = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "completed");
    }

    #[test]
    fn test_update_checklist_bulk_by_kind() {
        let (_temp, db) = setup_claimed_plan();

        // Update all tasks
        let updates = vec![ChecklistUpdate::BulkByKind {
            kind: "task".to_string(),
            status: "in_progress".to_string(),
        }];

        let result = db
            .update_checklist(".tugtool/tugplan-test.md", "step-0", "wt-a", &updates)
            .unwrap();

        // step-0 has 1 task
        assert_eq!(result.items_updated, 1);
    }

    #[test]
    fn test_update_checklist_all_items() {
        let (_temp, db) = setup_claimed_plan();

        // Update all checklist items
        let updates = vec![ChecklistUpdate::AllItems {
            status: "completed".to_string(),
        }];

        let result = db
            .update_checklist(".tugtool/tugplan-test.md", "step-0", "wt-a", &updates)
            .unwrap();

        // step-0 has 1 task + 1 test = 2 items
        assert_eq!(result.items_updated, 2);
    }

    #[test]
    fn test_update_checklist_ownership_enforced() {
        let (_temp, db) = setup_claimed_plan();

        // Try to update as different worktree
        let updates = vec![ChecklistUpdate::AllItems {
            status: "completed".to_string(),
        }];

        let result = db.update_checklist(".tugtool/tugplan-test.md", "step-0", "wt-b", &updates);

        assert!(result.is_err());
        match result.unwrap_err() {
            TugError::StateOwnershipViolation { .. } => {} // expected
            other => panic!("Expected StateOwnershipViolation, got: {:?}", other),
        }
    }

    #[test]
    fn test_record_artifact() {
        let (_temp, db) = setup_claimed_plan();

        let artifact_id = db
            .record_artifact(
                ".tugtool/tugplan-test.md",
                "step-0",
                "wt-a",
                "architect_strategy",
                "Test strategy summary",
            )
            .unwrap();

        assert!(artifact_id > 0);

        // Verify it was recorded
        let count: i32 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM step_artifacts WHERE step_anchor = 'step-0' AND kind = 'architect_strategy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_record_artifact_truncates_long_summary() {
        let (_temp, db) = setup_claimed_plan();

        // Create a 600-character summary (all ASCII)
        let long_summary = "a".repeat(600);

        let artifact_id = db
            .record_artifact(
                ".tugtool/tugplan-test.md",
                "step-0",
                "wt-a",
                "auditor_summary",
                &long_summary,
            )
            .unwrap();

        assert!(artifact_id > 0);

        // Verify it was truncated to 500 characters
        let summary: String = db
            .conn
            .query_row(
                "SELECT summary FROM step_artifacts WHERE id = ?",
                [artifact_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(summary.len(), 500);
    }

    #[test]
    fn test_complete_step_strict_mode_success() {
        let (_temp, mut db) = setup_claimed_plan();

        // Mark all checklist items as completed
        db.conn
            .execute(
                "UPDATE checklist_items SET status = 'completed' WHERE step_anchor = 'step-0'",
                [],
            )
            .unwrap();

        // Complete in strict mode
        let result = db
            .complete_step(".tugtool/tugplan-test.md", "step-0", "wt-a", false, None)
            .unwrap();

        assert!(result.completed);
        assert!(!result.forced);
        assert!(!result.all_steps_completed); // step-1 and step-2 still pending

        // Verify status is completed
        let status: String = db
            .conn
            .query_row(
                "SELECT status FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "completed");
    }

    #[test]
    fn test_complete_step_strict_mode_fails_incomplete_checklist() {
        let (_temp, mut db) = setup_claimed_plan();

        // Don't complete checklist items - try to complete step in strict mode
        let result = db.complete_step(".tugtool/tugplan-test.md", "step-0", "wt-a", false, None);

        assert!(result.is_err());
        match result.unwrap_err() {
            TugError::StateIncompleteChecklist {
                incomplete_count, ..
            } => {
                assert_eq!(incomplete_count, 2); // 1 task + 1 test
            }
            other => panic!("Expected StateIncompleteChecklist, got: {:?}", other),
        }
    }

    #[test]
    fn test_complete_step_force_mode() {
        let (_temp, mut db) = setup_claimed_plan();

        // Force complete without completing checklist items
        let result = db
            .complete_step(
                ".tugtool/tugplan-test.md",
                "step-0",
                "wt-a",
                true,
                Some("testing force mode"),
            )
            .unwrap();

        assert!(result.completed);
        assert!(result.forced);

        // Verify checklist items were auto-completed
        let completed_count: i32 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM checklist_items WHERE step_anchor = 'step-0' AND status = 'completed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed_count, 2); // 1 task + 1 test

        // Verify complete_reason was recorded
        let reason: String = db
            .conn
            .query_row(
                "SELECT complete_reason FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reason, "testing force mode");
    }

    #[test]
    fn test_complete_all_steps_sets_plan_done() {
        let (_temp, mut db) = setup_claimed_plan();

        // Complete all checklist items for step-0
        db.conn
            .execute(
                "UPDATE checklist_items SET status = 'completed' WHERE step_anchor = 'step-0'",
                [],
            )
            .unwrap();

        // Complete step-0
        db.complete_step(".tugtool/tugplan-test.md", "step-0", "wt-a", false, None)
            .unwrap();

        // Force complete step-1 and step-2 (simulating all steps done)
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed' WHERE anchor IN ('step-1', 'step-2')",
                [],
            )
            .unwrap();

        // Claim and complete a final step to trigger plan-done logic
        // Actually, the plan-done logic only triggers when completing the LAST step
        // Let's manually verify the intermediate state, then simulate completing the last step

        // First, verify plan status is still active
        let plan_status: String = db
            .conn
            .query_row(
                "SELECT status FROM plans WHERE plan_path = '.tugtool/tugplan-test.md'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(plan_status, "active");

        // Now manually mark all steps as completed except one, then complete that one properly
        // Reset: mark step-2 as not completed
        db.conn
            .execute(
                "UPDATE steps SET status = 'pending' WHERE anchor = 'step-2'",
                [],
            )
            .unwrap();

        // Complete step-0 (already done above)
        // Manually complete step-1
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = ?1 WHERE anchor = 'step-1'",
                [now_iso8601()],
            )
            .unwrap();

        // Claim, start, and complete step-2 (the last step)
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-2", "wt-a")
            .unwrap();
        db.conn
            .execute(
                "UPDATE checklist_items SET status = 'completed' WHERE step_anchor = 'step-2'",
                [],
            )
            .unwrap();

        let result = db
            .complete_step(".tugtool/tugplan-test.md", "step-2", "wt-a", false, None)
            .unwrap();

        assert!(result.all_steps_completed);

        // Verify plan status is now 'done'
        let plan_status: String = db
            .conn
            .query_row(
                "SELECT status FROM plans WHERE plan_path = '.tugtool/tugplan-test.md'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(plan_status, "done");
    }

    // Step 6 tests: show, ready, reset, reconcile

    #[test]
    fn test_show_returns_correct_checklist_counts() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        let plan_state = db.show_plan(".tugtool/tugplan-test.md").unwrap();

        assert_eq!(plan_state.steps.len(), 3); // step-0, step-1, step-2

        // step-0 has 1 task and 1 test
        let step0 = &plan_state.steps[0];
        assert_eq!(step0.anchor, "step-0");
        assert_eq!(step0.checklist.tasks_total, 1);
        assert_eq!(step0.checklist.tests_total, 1);
        assert_eq!(step0.checklist.checkpoints_total, 0);
    }

    #[test]
    fn test_show_includes_substeps() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        let plan_state = db.show_plan(".tugtool/tugplan-test.md").unwrap();

        // step-1 has 2 substeps
        let step1 = &plan_state.steps[1];
        assert_eq!(step1.anchor, "step-1");
        assert_eq!(step1.substeps.len(), 2);
        assert_eq!(step1.substeps[0].anchor, "step-1-1");
        assert_eq!(step1.substeps[1].anchor, "step-1-2");
    }

    #[test]
    fn test_show_annotates_force_completed() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim, start, and force-complete step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a")
            .unwrap();
        db.complete_step(
            ".tugtool/tugplan-test.md",
            "step-0",
            "wt-a",
            true,
            Some("testing force mode"),
        )
        .unwrap();

        let plan_state = db.show_plan(".tugtool/tugplan-test.md").unwrap();

        let step0 = &plan_state.steps[0];
        assert_eq!(
            step0.complete_reason,
            Some("testing force mode".to_string())
        );
    }

    #[test]
    fn test_ready_returns_correct_categorization() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        let ready = db.ready_steps(".tugtool/tugplan-test.md").unwrap();

        // Only step-0 should be ready (no dependencies)
        assert_eq!(ready.ready.len(), 1);
        assert_eq!(ready.ready[0].anchor, "step-0");

        // step-1 and step-2 are blocked by dependencies
        assert_eq!(ready.blocked.len(), 2);

        assert_eq!(ready.completed.len(), 0);
        assert_eq!(ready.expired_claim.len(), 0);
    }

    #[test]
    fn test_ready_expired_lease_appears_in_ready() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();

        // Manually expire the lease
        db.conn
            .execute(
                "UPDATE steps SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE anchor = 'step-0'",
                [],
            )
            .unwrap();

        let ready = db.ready_steps(".tugtool/tugplan-test.md").unwrap();

        // step-0 should appear in expired_claim
        assert_eq!(ready.expired_claim.len(), 1);
        assert_eq!(ready.expired_claim[0].anchor, "step-0");
    }

    #[test]
    fn test_reset_clears_claim_fields() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Claim and start step-0
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-0", "wt-a")
            .unwrap();

        // Reset step-0
        db.reset_step(".tugtool/tugplan-test.md", "step-0").unwrap();

        // Verify status is pending and claim fields are cleared
        let (status, claimed_by): (String, Option<String>) = db
            .conn
            .query_row(
                "SELECT status, claimed_by FROM steps WHERE anchor = 'step-0'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(status, "pending");
        assert_eq!(claimed_by, None);
    }

    #[test]
    fn test_reset_cascades_to_substeps() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Complete step-0 so step-1 can be claimed
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed' WHERE anchor = 'step-0'",
                [],
            )
            .unwrap();

        // Claim and start step-1 (which has substeps)
        db.claim_step(".tugtool/tugplan-test.md", "wt-a", 7200, "abc123hash")
            .unwrap();
        db.start_step(".tugtool/tugplan-test.md", "step-1", "wt-a")
            .unwrap();

        // Reset step-1
        db.reset_step(".tugtool/tugplan-test.md", "step-1").unwrap();

        // Verify step-1 is pending
        let status: String = db
            .conn
            .query_row(
                "SELECT status FROM steps WHERE anchor = 'step-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "pending");

        // Verify substeps were also reset
        let substep_statuses: Vec<String> = db
            .conn
            .prepare("SELECT status FROM steps WHERE parent_anchor = 'step-1' ORDER BY step_index")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(substep_statuses, vec!["pending", "pending"]);
    }

    #[test]
    fn test_reset_does_not_affect_completed_steps() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Complete step-0
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = ?1 WHERE anchor = 'step-0'",
                [now_iso8601()],
            )
            .unwrap();

        // Try to reset step-0 - should fail
        let result = db.reset_step(".tugtool/tugplan-test.md", "step-0");
        assert!(result.is_err());
    }

    #[test]
    fn test_reconcile_marks_uncompleted_steps() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Create reconcile entries for step-0 and step-1
        let entries = vec![
            ReconcileEntry {
                step_anchor: "step-0".to_string(),
                plan_path: ".tugtool/tugplan-test.md".to_string(),
                commit_hash: "abc123".to_string(),
            },
            ReconcileEntry {
                step_anchor: "step-1".to_string(),
                plan_path: ".tugtool/tugplan-test.md".to_string(),
                commit_hash: "def456".to_string(),
            },
        ];

        let result = db
            .reconcile(".tugtool/tugplan-test.md", &entries, false)
            .unwrap();

        assert_eq!(result.reconciled_count, 2);
        assert_eq!(result.skipped_count, 0);

        // Verify steps are marked as completed
        let count: i32 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM steps WHERE anchor IN ('step-0', 'step-1') AND status = 'completed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_reconcile_skips_hash_mismatch_in_default_mode() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Mark step-0 as completed with a commit hash
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = ?1, commit_hash = 'original_hash' WHERE anchor = 'step-0'",
                [now_iso8601()],
            )
            .unwrap();

        // Try to reconcile with a different hash
        let entries = vec![ReconcileEntry {
            step_anchor: "step-0".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            commit_hash: "new_hash".to_string(),
        }];

        let result = db
            .reconcile(".tugtool/tugplan-test.md", &entries, false)
            .unwrap();

        assert_eq!(result.reconciled_count, 0);
        assert_eq!(result.skipped_count, 1);
        assert_eq!(result.skipped_mismatches.len(), 1);
        assert_eq!(result.skipped_mismatches[0].step_anchor, "step-0");
        assert_eq!(result.skipped_mismatches[0].db_hash, "original_hash");
        assert_eq!(result.skipped_mismatches[0].git_hash, "new_hash");
    }

    #[test]
    fn test_reconcile_force_mode_overwrites_hashes() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let mut db = StateDb::open(&db_path).unwrap();
        let plan = make_test_plan();

        db.init_plan(".tugtool/tugplan-test.md", &plan, "abc123hash")
            .unwrap();

        // Mark step-0 as completed with a commit hash
        db.conn
            .execute(
                "UPDATE steps SET status = 'completed', completed_at = ?1, commit_hash = 'original_hash' WHERE anchor = 'step-0'",
                [now_iso8601()],
            )
            .unwrap();

        // Reconcile with force mode
        let entries = vec![ReconcileEntry {
            step_anchor: "step-0".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            commit_hash: "new_hash".to_string(),
        }];

        let result = db
            .reconcile(".tugtool/tugplan-test.md", &entries, true)
            .unwrap();

        assert_eq!(result.reconciled_count, 1);
        assert_eq!(result.skipped_count, 0);

        // Verify hash was updated
        let hash: String = db
            .conn
            .query_row(
                "SELECT commit_hash FROM steps WHERE anchor = 'step-0'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hash, "new_hash");
    }
}
