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
pub struct UpdateResult {
    /// Number of checklist items updated
    pub items_updated: usize,
}

/// Result from complete_step operation
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
}
