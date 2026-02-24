//! Dash state management
//!
//! Provides types and functions for managing dash (lightweight worktree-based work units) state
//! in the embedded SQLite database.

use crate::error::TugError;
use crate::session::now_iso8601;
use rusqlite::OptionalExtension;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Dash lifecycle status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DashStatus {
    Active,
    Joined,
    Released,
}

impl DashStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            DashStatus::Active => "active",
            DashStatus::Joined => "joined",
            DashStatus::Released => "released",
        }
    }

    pub fn parse_status(s: &str) -> Result<Self, TugError> {
        match s {
            "active" => Ok(DashStatus::Active),
            "joined" => Ok(DashStatus::Joined),
            "released" => Ok(DashStatus::Released),
            _ => Err(TugError::StateDbQuery {
                reason: format!("invalid dash status: {}", s),
            }),
        }
    }
}

/// Dash metadata from the dashes table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashInfo {
    pub name: String,
    pub description: Option<String>,
    pub branch: String,
    pub worktree: String,
    pub base_branch: String,
    pub status: DashStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// A single round record from the dash_rounds table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashRound {
    pub id: i64,
    pub dash_name: String,
    pub instruction: Option<String>,
    pub summary: Option<String>,
    pub files_created: Option<Vec<String>>,
    pub files_modified: Option<Vec<String>>,
    pub commit_hash: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

/// Round metadata to be passed via stdin to `tugcode dash commit`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashRoundMeta {
    pub instruction: Option<String>,
    pub summary: Option<String>,
    pub files_created: Option<Vec<String>>,
    pub files_modified: Option<Vec<String>>,
}

/// Validate a dash name per [D03]
///
/// Names must:
/// - Match pattern: `^[a-z][a-z0-9-]*[a-z0-9]$`
/// - Be at least 2 characters
/// - Not be a reserved word: "release", "join", "status"
pub fn validate_dash_name(name: &str) -> Result<(), TugError> {
    // Reserved words check
    if name == "release" || name == "join" || name == "status" {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: format!("'{}' is a reserved word", name),
        });
    }

    // Minimum length
    if name.len() < 2 {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must be at least 2 characters".to_string(),
        });
    }

    // Pattern validation
    let chars: Vec<char> = name.chars().collect();

    // Must start with lowercase letter
    if !chars[0].is_ascii_lowercase() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must start with a lowercase letter".to_string(),
        });
    }

    // Must end with lowercase letter or digit
    if !chars[chars.len() - 1].is_ascii_lowercase() && !chars[chars.len() - 1].is_ascii_digit() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must end with a lowercase letter or digit".to_string(),
        });
    }

    // All characters must be lowercase letter, digit, or hyphen
    for ch in chars.iter() {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && *ch != '-' {
            return Err(TugError::DashNameInvalid {
                name: name.to_string(),
                reason: "name must contain only lowercase letters, digits, and hyphens".to_string(),
            });
        }
    }

    Ok(())
}

/// Detect the default branch using a four-step fallback chain per [D12]
///
/// 1. Try `git symbolic-ref refs/remotes/origin/HEAD` (extract branch name)
/// 2. If that fails: check if `main` exists locally
/// 3. If that fails: check if `master` exists locally
/// 4. If all fail: error with message listing available local branches
pub fn detect_default_branch(repo_root: &Path) -> Result<String, TugError> {
    // Step 1: Try origin/HEAD
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("symbolic-ref")
        .arg("refs/remotes/origin/HEAD")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let symref = String::from_utf8_lossy(&output.stdout);
            // Format is "refs/remotes/origin/<branch>"
            if let Some(branch) = symref.trim().strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
    }

    // Step 2: Check if main exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("main")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("main".to_string());
        }
    }

    // Step 3: Check if master exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("master")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("master".to_string());
        }
    }

    // Step 4: Error with available branches
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output()
        .map_err(|e| TugError::WorktreeCreationFailed {
            reason: format!("failed to list branches: {}", e),
        })?;

    let branches = String::from_utf8_lossy(&output.stdout);
    let branch_list: Vec<&str> = branches.lines().collect();

    Err(TugError::BaseBranchNotFound {
        branch: format!(
            "Could not detect default branch. Available local branches: {}",
            branch_list.join(", ")
        ),
    })
}

impl crate::state::StateDb {
    /// Create a new dash or return existing active dash (idempotent per [D05])
    ///
    /// If a dash with this name exists and is active, returns `(dash_info, created=false)`.
    /// If a dash with this name exists but is joined/released, reactivates it in place
    /// (UPDATE status to active, overwrite metadata, return `created=true`).
    /// If no dash exists, INSERT new row and return `created=true`.
    pub fn create_dash(
        &self,
        name: &str,
        description: Option<&str>,
        branch: &str,
        worktree: &str,
        base_branch: &str,
    ) -> Result<(DashInfo, bool), TugError> {
        // Check if dash exists
        let existing: Option<DashInfo> = self.conn.query_row(
            "SELECT name, description, branch, worktree, base_branch, status, created_at, updated_at FROM dashes WHERE name = ?1",
            params![name],
            |row| {
                let status_str: String = row.get(5)?;
                let status = DashStatus::parse_status(&status_str).map_err(|_| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "invalid status",
                        )),
                    )
                })?;

                Ok(DashInfo {
                    name: row.get(0)?,
                    description: row.get(1)?,
                    branch: row.get(2)?,
                    worktree: row.get(3)?,
                    base_branch: row.get(4)?,
                    status,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        ).optional().map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to query dash: {}", e),
        })?;

        if let Some(existing_dash) = existing {
            if existing_dash.status == DashStatus::Active {
                // Idempotent: return existing active dash
                return Ok((existing_dash, false));
            }

            // Reactivate terminated dash in place
            let now = now_iso8601();
            self.conn.execute(
                "UPDATE dashes SET description = ?1, branch = ?2, worktree = ?3, base_branch = ?4, status = ?5, created_at = ?6, updated_at = ?7 WHERE name = ?8",
                params![description, branch, worktree, base_branch, "active", &now, &now, name],
            ).map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to reactivate dash: {}", e),
            })?;

            return Ok((
                DashInfo {
                    name: name.to_string(),
                    description: description.map(|s| s.to_string()),
                    branch: branch.to_string(),
                    worktree: worktree.to_string(),
                    base_branch: base_branch.to_string(),
                    status: DashStatus::Active,
                    created_at: now.clone(),
                    updated_at: now,
                },
                true,
            ));
        }

        // Create new dash
        let now = now_iso8601();
        self.conn.execute(
            "INSERT INTO dashes (name, description, branch, worktree, base_branch, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![name, description, branch, worktree, base_branch, "active", &now, &now],
        ).map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to create dash: {}", e),
        })?;

        Ok((
            DashInfo {
                name: name.to_string(),
                description: description.map(|s| s.to_string()),
                branch: branch.to_string(),
                worktree: worktree.to_string(),
                base_branch: base_branch.to_string(),
                status: DashStatus::Active,
                created_at: now.clone(),
                updated_at: now,
            },
            true,
        ))
    }

    /// Get a dash by name
    pub fn get_dash(&self, name: &str) -> Result<Option<DashInfo>, TugError> {
        self.conn
            .query_row(
                "SELECT name, description, branch, worktree, base_branch, status, created_at, updated_at FROM dashes WHERE name = ?1",
                params![name],
                |row| {
                    let status_str: String = row.get(5)?;
                    let status = DashStatus::parse_status(&status_str).map_err(|_| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5,
                            rusqlite::types::Type::Text,
                            Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "invalid status",
                            )),
                        )
                    })?;

                    Ok(DashInfo {
                        name: row.get(0)?,
                        description: row.get(1)?,
                        branch: row.get(2)?,
                        worktree: row.get(3)?,
                        base_branch: row.get(4)?,
                        status,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to get dash: {}", e),
            })
    }

    /// List dashes with round counts
    ///
    /// If `active_only` is true, only returns dashes with status='active'.
    /// Otherwise returns all dashes.
    pub fn list_dashes(&self, active_only: bool) -> Result<Vec<(DashInfo, i64)>, TugError> {
        let sql = if active_only {
            r#"
SELECT d.name, d.description, d.branch, d.worktree, d.base_branch, d.status, d.created_at, d.updated_at,
       COUNT(r.id) as round_count
FROM dashes d
LEFT JOIN dash_rounds r ON d.name = r.dash_name
WHERE d.status = 'active'
GROUP BY d.name
ORDER BY d.created_at DESC
            "#
        } else {
            r#"
SELECT d.name, d.description, d.branch, d.worktree, d.base_branch, d.status, d.created_at, d.updated_at,
       COUNT(r.id) as round_count
FROM dashes d
LEFT JOIN dash_rounds r ON d.name = r.dash_name
GROUP BY d.name
ORDER BY d.created_at DESC
            "#
        };

        let mut stmt = self.conn.prepare(sql).map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to prepare list query: {}", e),
        })?;

        let rows = stmt
            .query_map([], |row| {
                let status_str: String = row.get(5)?;
                let status = DashStatus::parse_status(&status_str).map_err(|_| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "invalid status",
                        )),
                    )
                })?;

                let dash_info = DashInfo {
                    name: row.get(0)?,
                    description: row.get(1)?,
                    branch: row.get(2)?,
                    worktree: row.get(3)?,
                    base_branch: row.get(4)?,
                    status,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                };
                let round_count: i64 = row.get(8)?;

                Ok((dash_info, round_count))
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to execute list query: {}", e),
            })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to read list row: {}", e),
            })?);
        }

        Ok(result)
    }

    /// Update dash status (active -> joined/released)
    pub fn update_dash_status(&self, name: &str, status: DashStatus) -> Result<(), TugError> {
        let now = now_iso8601();
        let rows_affected = self
            .conn
            .execute(
                "UPDATE dashes SET status = ?1, updated_at = ?2 WHERE name = ?3",
                params![status.as_str(), &now, name],
            )
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to update dash status: {}", e),
            })?;

        if rows_affected == 0 {
            return Err(TugError::DashNotFound {
                name: name.to_string(),
            });
        }

        Ok(())
    }

    /// Record a dash round (always records, even if no git commit per [D06])
    ///
    /// Returns the round ID.
    pub fn record_round(
        &self,
        dash_name: &str,
        instruction: Option<&str>,
        summary: Option<&str>,
        files_created: Option<&[String]>,
        files_modified: Option<&[String]>,
        commit_hash: Option<&str>,
    ) -> Result<i64, TugError> {
        let now = now_iso8601();

        let files_created_json = files_created.and_then(|f| serde_json::to_string(f).ok());
        let files_modified_json = files_modified.and_then(|f| serde_json::to_string(f).ok());

        self.conn.execute(
            "INSERT INTO dash_rounds (dash_name, instruction, summary, files_created, files_modified, commit_hash, started_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                dash_name,
                instruction,
                summary,
                files_created_json,
                files_modified_json,
                commit_hash,
                &now,
                &now,
            ],
        ).map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to record round: {}", e),
        })?;

        let round_id = self.conn.last_insert_rowid();
        Ok(round_id)
    }

    /// Get dash rounds, optionally filtering to current incarnation only
    ///
    /// If `current_incarnation_only` is true (default), only returns rounds where
    /// `started_at >= dash.created_at` (current incarnation).
    /// If false, returns all rounds across all incarnations.
    pub fn get_dash_rounds(
        &self,
        dash_name: &str,
        current_incarnation_only: bool,
    ) -> Result<Vec<DashRound>, TugError> {
        let sql = if current_incarnation_only {
            r#"
SELECT r.id, r.dash_name, r.instruction, r.summary, r.files_created, r.files_modified, r.commit_hash, r.started_at, r.completed_at
FROM dash_rounds r
JOIN dashes d ON r.dash_name = d.name
WHERE r.dash_name = ?1 AND r.started_at >= d.created_at
ORDER BY r.id ASC
            "#
        } else {
            r#"
SELECT id, dash_name, instruction, summary, files_created, files_modified, commit_hash, started_at, completed_at
FROM dash_rounds
WHERE dash_name = ?1
ORDER BY id ASC
            "#
        };

        let mut stmt = self.conn.prepare(sql).map_err(|e| TugError::StateDbQuery {
            reason: format!("failed to prepare rounds query: {}", e),
        })?;

        let rows = stmt
            .query_map(params![dash_name], |row| {
                let files_created_json: Option<String> = row.get(4)?;
                let files_modified_json: Option<String> = row.get(5)?;

                let files_created = files_created_json.and_then(|s| serde_json::from_str(&s).ok());
                let files_modified =
                    files_modified_json.and_then(|s| serde_json::from_str(&s).ok());

                Ok(DashRound {
                    id: row.get(0)?,
                    dash_name: row.get(1)?,
                    instruction: row.get(2)?,
                    summary: row.get(3)?,
                    files_created,
                    files_modified,
                    commit_hash: row.get(6)?,
                    started_at: row.get(7)?,
                    completed_at: row.get(8)?,
                })
            })
            .map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to execute rounds query: {}", e),
            })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| TugError::StateDbQuery {
                reason: format!("failed to read round row: {}", e),
            })?);
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StateDb;
    use tempfile::TempDir;

    #[test]
    fn test_validate_dash_name_valid() {
        assert!(validate_dash_name("ab").is_ok());
        assert!(validate_dash_name("login-page").is_ok());
        assert!(validate_dash_name("fix-bug").is_ok());
        assert!(validate_dash_name("test-123").is_ok());
        assert!(validate_dash_name("a1").is_ok());
    }

    #[test]
    fn test_validate_dash_name_invalid() {
        // Too short
        assert!(validate_dash_name("a").is_err());

        // Reserved words
        assert!(validate_dash_name("release").is_err());
        assert!(validate_dash_name("join").is_err());
        assert!(validate_dash_name("status").is_err());

        // Uppercase
        assert!(validate_dash_name("Login-Page").is_err());

        // Special chars
        assert!(validate_dash_name("login_page").is_err());
        assert!(validate_dash_name("login.page").is_err());

        // Leading hyphen
        assert!(validate_dash_name("-login").is_err());

        // Trailing hyphen
        assert!(validate_dash_name("login-").is_err());

        // Starts with digit
        assert!(validate_dash_name("1login").is_err());
    }

    #[test]
    fn test_create_dash_new() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        let (dash, created) = db
            .create_dash(
                "test-dash",
                Some("test description"),
                "tugdash/test-dash",
                "/path/to/worktree",
                "main",
            )
            .unwrap();

        assert!(created);
        assert_eq!(dash.name, "test-dash");
        assert_eq!(dash.description, Some("test description".to_string()));
        assert_eq!(dash.branch, "tugdash/test-dash");
        assert_eq!(dash.base_branch, "main");
        assert_eq!(dash.status, DashStatus::Active);
    }

    #[test]
    fn test_create_dash_idempotent() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        let (dash1, created1) = db
            .create_dash(
                "test-dash",
                Some("description"),
                "tugdash/test-dash",
                "/path/to/worktree",
                "main",
            )
            .unwrap();
        assert!(created1);

        let (dash2, created2) = db
            .create_dash(
                "test-dash",
                Some("updated description"),
                "tugdash/test-dash",
                "/path/to/worktree",
                "main",
            )
            .unwrap();
        assert!(!created2); // Idempotent: existing active dash
        assert_eq!(dash1.name, dash2.name);
        assert_eq!(dash2.description, Some("description".to_string())); // Original description preserved
    }

    #[test]
    fn test_create_dash_reactivate() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        // Create and join
        let (dash1, _) = db
            .create_dash(
                "test-dash",
                Some("description"),
                "tugdash/test-dash",
                "/path/to/worktree",
                "main",
            )
            .unwrap();
        db.update_dash_status("test-dash", DashStatus::Joined)
            .unwrap();

        // Wait to ensure timestamp difference
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Reactivate
        let (dash2, created) = db
            .create_dash(
                "test-dash",
                Some("new description"),
                "tugdash/test-dash-new",
                "/path/to/new-worktree",
                "develop",
            )
            .unwrap();

        assert!(created); // Reactivation returns created=true
        assert_eq!(dash2.name, "test-dash");
        assert_eq!(dash2.description, Some("new description".to_string()));
        assert_eq!(dash2.branch, "tugdash/test-dash-new");
        assert_eq!(dash2.base_branch, "develop");
        assert_eq!(dash2.status, DashStatus::Active);
        assert_ne!(dash1.created_at, dash2.created_at); // New created_at
    }

    #[test]
    fn test_get_dash() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        assert!(db.get_dash("nonexistent").unwrap().is_none());

        db.create_dash(
            "test-dash",
            Some("description"),
            "tugdash/test-dash",
            "/path/to/worktree",
            "main",
        )
        .unwrap();

        let dash = db.get_dash("test-dash").unwrap();
        assert!(dash.is_some());
        assert_eq!(dash.unwrap().name, "test-dash");
    }

    #[test]
    fn test_record_round_with_commit() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        db.create_dash(
            "test-dash",
            Some("description"),
            "tugdash/test-dash",
            "/path/to/worktree",
            "main",
        )
        .unwrap();

        let round_id = db
            .record_round(
                "test-dash",
                Some("add login"),
                Some("Added login page"),
                Some(&vec!["src/login.rs".to_string()]),
                Some(&vec!["src/main.rs".to_string()]),
                Some("abc123"),
            )
            .unwrap();

        assert!(round_id > 0);

        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert_eq!(rounds[0].id, round_id);
        assert_eq!(rounds[0].instruction, Some("add login".to_string()));
        assert_eq!(rounds[0].commit_hash, Some("abc123".to_string()));
    }

    #[test]
    fn test_record_round_without_commit() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        db.create_dash(
            "test-dash",
            Some("description"),
            "tugdash/test-dash",
            "/path/to/worktree",
            "main",
        )
        .unwrap();

        let round_id = db
            .record_round(
                "test-dash",
                Some("explore codebase"),
                Some("Explored the codebase"),
                None,
                None,
                None, // No commit hash
            )
            .unwrap();

        assert!(round_id > 0);

        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert_eq!(rounds[0].commit_hash, None);
    }

    #[test]
    fn test_get_dash_rounds_current_incarnation_only() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        // Create dash and add a round
        db.create_dash(
            "test-dash",
            Some("description"),
            "tugdash/test-dash",
            "/path/to/worktree",
            "main",
        )
        .unwrap();
        db.record_round(
            "test-dash",
            Some("first round"),
            None,
            None,
            None,
            Some("commit1"),
        )
        .unwrap();

        // Join (terminate)
        db.update_dash_status("test-dash", DashStatus::Joined)
            .unwrap();

        // Reactivate and add new round
        std::thread::sleep(std::time::Duration::from_millis(10)); // Ensure different timestamp
        db.create_dash(
            "test-dash",
            Some("new description"),
            "tugdash/test-dash-new",
            "/path/to/new",
            "main",
        )
        .unwrap();
        db.record_round(
            "test-dash",
            Some("second round"),
            None,
            None,
            None,
            Some("commit2"),
        )
        .unwrap();

        // Current incarnation only should return only the second round
        let current_rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(current_rounds.len(), 1);
        assert_eq!(
            current_rounds[0].instruction,
            Some("second round".to_string())
        );

        // All rounds should return both
        let all_rounds = db.get_dash_rounds("test-dash", false).unwrap();
        assert_eq!(all_rounds.len(), 2);
    }

    #[test]
    fn test_list_dashes_active_only() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        db.create_dash("dash1", Some("d1"), "tugdash/dash1", "/path1", "main")
            .unwrap();
        db.create_dash("dash2", Some("d2"), "tugdash/dash2", "/path2", "main")
            .unwrap();
        db.update_dash_status("dash2", DashStatus::Joined).unwrap();

        let active = db.list_dashes(true).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].0.name, "dash1");

        let all = db.list_dashes(false).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_update_dash_status() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let db = StateDb::open(&db_path).unwrap();

        db.create_dash(
            "test-dash",
            Some("description"),
            "tugdash/test-dash",
            "/path/to/worktree",
            "main",
        )
        .unwrap();

        db.update_dash_status("test-dash", DashStatus::Joined)
            .unwrap();

        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Joined);
    }
}
