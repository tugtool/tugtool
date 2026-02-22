//! Beads integration utilities
//!
//! Provides types and functions for interacting with the beads CLI
//! conforming to the Beads JSON Contract.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::error::TugError;

/// Body content threshold for using temporary file instead of command line argument
/// Set to 64KB to avoid ARG_MAX issues on most systems
const BODY_FILE_THRESHOLD: usize = 64 * 1024;

/// Issue object returned by `bd create --json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
}

/// IssueDetails returned by `bd show <id> --json`
/// May be returned as array or single object
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueDetails {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
    #[serde(default)]
    pub dependencies: Vec<DependencyRef>,
    #[serde(default)]
    pub dependents: Vec<DependencyRef>,
    #[serde(default)]
    pub design: Option<String>,
    #[serde(default)]
    pub acceptance_criteria: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub close_reason: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// Dependency reference in IssueDetails
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyRef {
    pub id: String,
    #[serde(default)]
    pub dependency_type: String,
}

/// Dependency with metadata from `bd dep list --json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueWithDependencyMetadata {
    pub id: String,
    #[serde(default)]
    pub dependency_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub issue_type: String,
}

/// Result of dep add/remove operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepResult {
    pub status: String,
    #[serde(default)]
    pub issue_id: String,
    #[serde(default)]
    pub depends_on_id: String,
    #[serde(rename = "type", default)]
    pub dep_type: String,
}

/// Status of a step relative to beads
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BeadStatus {
    /// Bead is closed (complete)
    Complete,
    /// Bead is open and all dependencies are complete
    Ready,
    /// Bead is open and waiting on dependencies
    Blocked,
    /// No bead linked yet
    Pending,
}

impl std::fmt::Display for BeadStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BeadStatus::Complete => write!(f, "complete"),
            BeadStatus::Ready => write!(f, "ready"),
            BeadStatus::Blocked => write!(f, "blocked"),
            BeadStatus::Pending => write!(f, "pending"),
        }
    }
}

/// Parsed close reason with structured fields
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseReasonParsed {
    /// Commit hash extracted from "Committed: <hash> -- <summary>" format
    pub commit_hash: Option<String>,
    /// Commit summary extracted from "Committed: <hash> -- <summary>" format
    pub commit_summary: Option<String>,
    /// Original close_reason string
    pub raw: String,
}

/// Beads CLI wrapper
#[derive(Debug, Clone)]
pub struct BeadsCli {
    /// Path to the bd binary
    pub bd_path: String,
    /// Extra environment variables set on every spawned Command
    env_vars: HashMap<String, String>,
}

impl Default for BeadsCli {
    fn default() -> Self {
        Self {
            bd_path: "bd".to_string(),
            env_vars: Self::default_env_vars(),
        }
    }
}

impl BeadsCli {
    /// Create a new BeadsCli with the specified path
    pub fn new(bd_path: String) -> Self {
        Self {
            bd_path,
            env_vars: Self::default_env_vars(),
        }
    }

    /// Return default environment variables for bd commands
    fn default_env_vars() -> HashMap<String, String> {
        let mut env_vars = HashMap::new();
        env_vars.insert("BEADS_NO_DAEMON".to_string(), "1".to_string());
        env_vars.insert("BEADS_NO_AUTO_FLUSH".to_string(), "1".to_string());
        env_vars
    }

    /// Set an environment variable that will be passed to every bd command
    pub fn set_env(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.env_vars.insert(key.into(), value.into());
    }

    /// Build a Command with the bd path and any configured env vars applied.
    /// If working_dir is provided, sets the command's current directory AND
    /// passes `--db <working_dir>/.beads/beads.db` to bypass bd's auto-discovery
    /// (which refuses to run inside git worktrees).
    fn cmd_with_dir(&self, working_dir: Option<&Path>) -> Command {
        let mut cmd = Command::new(&self.bd_path);
        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }
        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
            cmd.arg("--db").arg(dir.join(".beads/beads.db"));
        }
        cmd
    }

    /// Write content to a temporary file and return the path
    /// Used when content exceeds BODY_FILE_THRESHOLD to avoid ARG_MAX issues
    fn write_temp_body_file(content: &str) -> Result<std::path::PathBuf, TugError> {
        use std::env;
        use std::fs::File;

        let temp_dir = env::temp_dir();
        let filename = format!("beads-body-{}.txt", std::process::id());
        let path = temp_dir.join(filename);

        let mut file = File::create(&path)
            .map_err(|e| TugError::BeadsCommand(format!("failed to create temp file: {}", e)))?;

        file.write_all(content.as_bytes())
            .map_err(|e| TugError::BeadsCommand(format!("failed to write temp file: {}", e)))?;

        Ok(path)
    }

    /// Check if beads CLI is installed
    /// working_dir is optional - if provided, commands will run in that directory
    pub fn is_installed(&self, working_dir: Option<&Path>) -> bool {
        self.cmd_with_dir(working_dir)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Check if beads is initialized (`.beads/` directory exists).
    ///
    /// Checks only the given directory; does not walk parent directories.
    pub fn is_initialized(&self, project_root: &Path) -> bool {
        project_root.join(".beads").is_dir()
    }

    /// Initialize beads in a directory (runs `bd init`).
    ///
    /// Idempotent: succeeds if beads is already initialized (locally or in a parent directory).
    pub fn init(&self, working_dir: &Path) -> Result<(), TugError> {
        self.init_with_prefix(working_dir, None)
    }

    /// Initialize beads in a directory with optional prefix.
    ///
    /// Bypasses `bd init` (which refuses to run inside git worktrees) by
    /// manually creating the `.beads/` directory and bootstrapping the database
    /// via `bd --db <path> config set issue_prefix <prefix>`. The first `--db`
    /// command auto-creates the SQLite database with the full schema.
    ///
    /// Idempotent: succeeds if beads is already initialized.
    pub fn init_with_prefix(
        &self,
        working_dir: &Path,
        prefix: Option<&str>,
    ) -> Result<(), TugError> {
        let beads_dir = working_dir.join(".beads");

        // Already initialized — nothing to do
        if beads_dir.is_dir() {
            return Ok(());
        }

        // Create .beads/ directory
        std::fs::create_dir_all(&beads_dir).map_err(|e| {
            TugError::BeadsCommand(format!("failed to create .beads directory: {}", e))
        })?;

        // Bootstrap the database by setting issue_prefix via --db.
        // This auto-creates the SQLite DB with the full schema.
        let db_path = beads_dir.join("beads.db");
        let prefix_value = prefix.unwrap_or("bd");

        let mut cmd = Command::new(&self.bd_path);
        for (k, v) in &self.env_vars {
            cmd.env(k, v);
        }
        cmd.current_dir(working_dir);
        cmd.arg("--db")
            .arg(&db_path)
            .arg("config")
            .arg("set")
            .arg("issue_prefix")
            .arg(prefix_value);

        let output = cmd
            .output()
            .map_err(|e| TugError::BeadsCommand(format!("failed to bootstrap beads db: {}", e)))?;

        if !output.status.success() {
            // Clean up on failure
            let _ = std::fs::remove_dir_all(&beads_dir);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "failed to bootstrap beads db: {}",
                stderr.trim()
            )));
        }

        Ok(())
    }

    /// Create a new bead
    #[allow(clippy::too_many_arguments)] // Backward compatibility requires optional parameters
    pub fn create(
        &self,
        title: &str,
        description: Option<&str>,
        parent: Option<&str>,
        issue_type: Option<&str>,
        priority: Option<i32>,
        design: Option<&str>,
        acceptance: Option<&str>,
        notes: Option<&str>,
        working_dir: Option<&Path>,
    ) -> Result<Issue, TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("create").arg("--json").arg(title);

        let mut temp_files = Vec::new();

        if let Some(desc) = description {
            if desc.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(desc)?;
                cmd.arg("--description").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--description").arg(desc);
            }
        }
        if let Some(p) = parent {
            cmd.arg("--parent").arg(p);
        }
        if let Some(t) = issue_type {
            cmd.arg("--type").arg(t);
        }
        if let Some(pri) = priority {
            cmd.arg(format!("-p{}", pri));
        }
        if let Some(d) = design {
            if d.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(d)?;
                cmd.arg("--design").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--design").arg(d);
            }
        }
        if let Some(a) = acceptance {
            if a.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(a)?;
                cmd.arg("--acceptance").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--acceptance").arg(a);
            }
        }
        if let Some(n) = notes {
            if n.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(n)?;
                cmd.arg("--notes").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--notes").arg(n);
            }
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd create: {}", e))
            }
        })?;

        // Clean up temp files
        for path in temp_files {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd create failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout)
            .map_err(|e| TugError::BeadsCommand(format!("failed to parse bd create output: {}", e)))
    }

    /// Show a bead by ID
    /// Returns IssueDetails, handling both array and object responses
    pub fn show(&self, id: &str, working_dir: Option<&Path>) -> Result<IssueDetails, TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .arg("show")
            .arg(id)
            .arg("--json")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd show: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd show failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Try parsing as array first, then as single object
        if let Ok(arr) = serde_json::from_str::<Vec<IssueDetails>>(&stdout) {
            if let Some(issue) = arr.into_iter().next() {
                return Ok(issue);
            }
            return Err(TugError::BeadsCommand(
                "bd show returned empty array".to_string(),
            ));
        }

        serde_json::from_str(&stdout)
            .map_err(|e| TugError::BeadsCommand(format!("failed to parse bd show output: {}", e)))
    }

    /// Check if a bead exists
    pub fn bead_exists(&self, id: &str, working_dir: Option<&Path>) -> bool {
        self.show(id, working_dir).is_ok()
    }

    /// Update the description field of a bead
    pub fn update_description(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("update").arg(id).arg("--description");

        let temp_file = if content.len() > BODY_FILE_THRESHOLD {
            let path = Self::write_temp_body_file(content)?;
            cmd.arg(format!("@{}", path.display()));
            Some(path)
        } else {
            cmd.arg(content);
            None
        };

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd update: {}", e))
            }
        })?;

        // Clean up temp file
        if let Some(path) = temp_file {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd update --description failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Update the design field of a bead
    pub fn update_design(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("update").arg(id).arg("--design");

        let temp_file = if content.len() > BODY_FILE_THRESHOLD {
            let path = Self::write_temp_body_file(content)?;
            cmd.arg(format!("@{}", path.display()));
            Some(path)
        } else {
            cmd.arg(content);
            None
        };

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd update: {}", e))
            }
        })?;

        // Clean up temp file
        if let Some(path) = temp_file {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd update --design failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Update the acceptance_criteria field of a bead
    pub fn update_acceptance(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("update").arg(id).arg("--acceptance");

        let temp_file = if content.len() > BODY_FILE_THRESHOLD {
            let path = Self::write_temp_body_file(content)?;
            cmd.arg(format!("@{}", path.display()));
            Some(path)
        } else {
            cmd.arg(content);
            None
        };

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd update: {}", e))
            }
        })?;

        // Clean up temp file
        if let Some(path) = temp_file {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd update --acceptance failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Update the notes field of a bead (replaces existing content)
    pub fn update_notes(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("update").arg(id).arg("--notes");

        let temp_file = if content.len() > BODY_FILE_THRESHOLD {
            let path = Self::write_temp_body_file(content)?;
            cmd.arg(format!("@{}", path.display()));
            Some(path)
        } else {
            cmd.arg(content);
            None
        };

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd update: {}", e))
            }
        })?;

        // Clean up temp file
        if let Some(path) = temp_file {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd update --notes failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Append content to the notes field of a bead
    /// Uses "---" separator convention per D03
    pub fn append_notes(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        // Fetch current notes
        let details = self.show(id, working_dir)?;
        let current_notes = details.notes.unwrap_or_default();

        // Build new notes with separator
        let new_notes = if current_notes.is_empty() {
            content.to_string()
        } else {
            format!("{}\n\n---\n\n{}", current_notes, content)
        };

        // Update with combined content
        self.update_notes(id, &new_notes, working_dir)
    }

    /// Append content to the design field of a bead
    /// Uses "---" separator convention per D03
    pub fn append_design(
        &self,
        id: &str,
        content: &str,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        // Fetch current design
        let details = self.show(id, working_dir)?;
        let current_design = details.design.unwrap_or_default();

        // Build new design with separator
        let new_design = if current_design.is_empty() {
            content.to_string()
        } else {
            format!("{}\n\n---\n\n{}", current_design, content)
        };

        // Update with combined content
        self.update_design(id, &new_design, working_dir)
    }

    /// Add a dependency edge
    pub fn dep_add(
        &self,
        from_id: &str,
        to_id: &str,
        working_dir: Option<&Path>,
    ) -> Result<DepResult, TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .arg("dep")
            .arg("add")
            .arg(from_id)
            .arg(to_id)
            .arg("--json")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd dep add: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd dep add failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd dep add output: {}", e))
        })
    }

    /// Remove a dependency edge
    pub fn dep_remove(
        &self,
        from_id: &str,
        to_id: &str,
        working_dir: Option<&Path>,
    ) -> Result<DepResult, TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .arg("dep")
            .arg("remove")
            .arg(from_id)
            .arg(to_id)
            .arg("--json")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd dep remove: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd dep remove failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd dep remove output: {}", e))
        })
    }

    /// List dependencies for a bead
    pub fn dep_list(
        &self,
        id: &str,
        working_dir: Option<&Path>,
    ) -> Result<Vec<IssueWithDependencyMetadata>, TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .arg("dep")
            .arg("list")
            .arg(id)
            .arg("--json")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd dep list: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd dep list failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd dep list output: {}", e))
        })
    }

    /// Close a bead
    pub fn close(
        &self,
        id: &str,
        reason: Option<&str>,
        working_dir: Option<&Path>,
    ) -> Result<(), TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("close").arg(id);

        if let Some(r) = reason {
            cmd.arg("--reason").arg(r);
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd close: {}", e))
            }
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd close failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Sync beads state
    pub fn sync(&self, working_dir: Option<&Path>) -> Result<(), TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .arg("sync")
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd sync: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd sync failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Batch check existence of multiple bead IDs in a single subprocess call.
    /// Uses: `bd list --id=<ids> --json --limit 0 --all`
    /// Returns a set of IDs that exist.
    pub fn list_by_ids(
        &self,
        ids: &[String],
        working_dir: Option<&Path>,
    ) -> Result<std::collections::HashSet<String>, TugError> {
        use std::collections::HashSet;

        if ids.is_empty() {
            return Ok(HashSet::new());
        }

        let ids_arg = ids.join(",");
        let output = self
            .cmd_with_dir(working_dir)
            .args(["list", "--id", &ids_arg, "--json", "--limit", "0", "--all"])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd list: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd list failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let issues: Vec<Issue> = serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd list output: {}", e))
        })?;

        Ok(issues.into_iter().map(|i| i.id).collect())
    }

    /// Create a bead with inline dependencies (reduces subprocess calls).
    /// Uses: `bd create --deps "dep1,dep2"`
    #[allow(clippy::too_many_arguments)] // Backward compatibility requires optional parameters
    pub fn create_with_deps(
        &self,
        title: &str,
        description: Option<&str>,
        parent: Option<&str>,
        deps: &[String],
        issue_type: Option<&str>,
        priority: Option<i32>,
        design: Option<&str>,
        acceptance: Option<&str>,
        notes: Option<&str>,
        working_dir: Option<&Path>,
    ) -> Result<Issue, TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("create").arg("--json").arg(title);

        let mut temp_files = Vec::new();

        if let Some(desc) = description {
            if desc.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(desc)?;
                cmd.arg("--description").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--description").arg(desc);
            }
        }
        if let Some(p) = parent {
            cmd.arg("--parent").arg(p);
        }
        if !deps.is_empty() {
            cmd.arg("--deps").arg(deps.join(","));
        }
        if let Some(t) = issue_type {
            cmd.arg("--type").arg(t);
        }
        if let Some(pri) = priority {
            cmd.arg(format!("-p{}", pri));
        }
        if let Some(d) = design {
            if d.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(d)?;
                cmd.arg("--design").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--design").arg(d);
            }
        }
        if let Some(a) = acceptance {
            if a.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(a)?;
                cmd.arg("--acceptance").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--acceptance").arg(a);
            }
        }
        if let Some(n) = notes {
            if n.len() > BODY_FILE_THRESHOLD {
                let path = Self::write_temp_body_file(n)?;
                cmd.arg("--notes").arg(format!("@{}", path.display()));
                temp_files.push(path);
            } else {
                cmd.arg("--notes").arg(n);
            }
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd create: {}", e))
            }
        })?;

        // Clean up temp files
        for path in temp_files {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd create failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout)
            .map_err(|e| TugError::BeadsCommand(format!("failed to parse bd create output: {}", e)))
    }

    /// Get all children of a parent bead in a single subprocess call.
    /// Uses: `bd children <id> --json`
    pub fn children(
        &self,
        parent_id: &str,
        working_dir: Option<&Path>,
    ) -> Result<Vec<Issue>, TugError> {
        let output = self
            .cmd_with_dir(working_dir)
            .args(["children", parent_id, "--json"])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    TugError::BeadsNotInstalled
                } else {
                    TugError::BeadsCommand(format!("failed to run bd children: {}", e))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd children failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd children output: {}", e))
        })
    }

    /// Find a bead by title using server-side substring matching.
    /// Uses: `bd list --title-contains <title> [--parent <parent>] --json --limit 1`
    /// Returns the first match or None if no bead found.
    pub fn find_by_title(
        &self,
        title: &str,
        parent: Option<&str>,
        working_dir: Option<&Path>,
    ) -> Result<Option<Issue>, TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.args(["list", "--title-contains", title, "--json", "--limit", "1"]);

        if let Some(p) = parent {
            cmd.args(["--parent", p]);
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd list: {}", e))
            }
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd list failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let issues: Vec<Issue> = serde_json::from_str(&stdout).map_err(|e| {
            TugError::BeadsCommand(format!("failed to parse bd list output: {}", e))
        })?;

        Ok(issues.into_iter().next())
    }

    /// Get all ready beads (open beads with all dependencies complete).
    /// Uses: `bd ready --json` (all ready beads) or `bd ready <parent_id> --json` (ready children of parent).
    pub fn ready(
        &self,
        parent_id: Option<&str>,
        working_dir: Option<&Path>,
    ) -> Result<Vec<Issue>, TugError> {
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.arg("ready");

        if let Some(parent) = parent_id {
            cmd.args(["--parent", parent]);
        }

        cmd.args(["--limit", "0"]);
        cmd.arg("--json");

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd ready: {}", e))
            }
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::BeadsCommand(format!(
                "bd ready failed: {}",
                stderr
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout)
            .map_err(|e| TugError::BeadsCommand(format!("failed to parse bd ready output: {}", e)))
    }

    /// Get detailed information for all children of a parent bead.
    /// Tries `bd children <id> --detailed --json` first. If --detailed flag is not supported,
    /// falls back to calling children() followed by show() for each child.
    pub fn list_children_detailed(
        &self,
        parent_id: &str,
        working_dir: Option<&Path>,
    ) -> Result<Vec<IssueDetails>, TugError> {
        // Try primary path: bd children <id> --detailed --json
        let mut cmd = self.cmd_with_dir(working_dir);
        cmd.args(["children", parent_id, "--detailed", "--json"]);

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::BeadsNotInstalled
            } else {
                TugError::BeadsCommand(format!("failed to run bd children: {}", e))
            }
        })?;

        if output.status.success() {
            // Primary path succeeded, parse as Vec<IssueDetails>
            let stdout = String::from_utf8_lossy(&output.stdout);
            return serde_json::from_str(&stdout).map_err(|e| {
                TugError::BeadsCommand(format!(
                    "failed to parse bd children --detailed output: {}",
                    e
                ))
            });
        }

        // Primary path failed (likely --detailed not supported), fall back to N x show()
        let children = self.children(parent_id, working_dir)?;
        let mut details = Vec::new();

        for child in children {
            let detail = self.show(&child.id, working_dir)?;
            details.push(detail);
        }

        Ok(details)
    }
}

/// Validate bead ID format
/// Pattern: ^[a-z0-9][a-z0-9-]*-[a-z0-9]+(\.[0-9]+)*$
pub fn is_valid_bead_id(id: &str) -> bool {
    use regex::Regex;
    use std::sync::LazyLock;

    static BEAD_ID_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]*-[a-z0-9]+(\.[0-9]+)*$").unwrap());

    BEAD_ID_REGEX.is_match(id)
}

/// Parse close_reason string into structured fields
///
/// Expects format: "Committed: <hash> -- <summary>"
/// Falls back to raw text if format doesn't match.
///
/// # Examples
///
/// ```
/// use tug_core::parse_close_reason;
///
/// let parsed = parse_close_reason("Committed: abc123d -- feat(api): add client");
/// assert_eq!(parsed.commit_hash, Some("abc123d".to_string()));
/// assert_eq!(parsed.commit_summary, Some("feat(api): add client".to_string()));
///
/// let parsed = parse_close_reason("Manually closed");
/// assert_eq!(parsed.commit_hash, None);
/// assert_eq!(parsed.commit_summary, None);
/// assert_eq!(parsed.raw, "Manually closed");
/// ```
pub fn parse_close_reason(close_reason: &str) -> CloseReasonParsed {
    let raw = close_reason.to_string();

    // Check if it starts with "Committed: "
    if let Some(after_prefix) = close_reason.strip_prefix("Committed: ") {
        // Split on " -- " to separate hash from summary
        if let Some(pos) = after_prefix.find(" -- ") {
            let hash = after_prefix[..pos].trim().to_string();
            let summary = after_prefix[pos + 4..].trim().to_string();
            CloseReasonParsed {
                commit_hash: Some(hash),
                commit_summary: Some(summary),
                raw,
            }
        } else {
            // Has "Committed: " prefix but no " -- " separator
            let hash = after_prefix.trim().to_string();
            CloseReasonParsed {
                commit_hash: Some(hash),
                commit_summary: None,
                raw,
            }
        }
    } else {
        // Non-standard format
        CloseReasonParsed {
            commit_hash: None,
            commit_summary: None,
            raw,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_bead_id() {
        assert!(is_valid_bead_id("bd-abc123"));
        assert!(is_valid_bead_id("bd-fake-1"));
        assert!(is_valid_bead_id("bd-fake-1.1"));
        assert!(is_valid_bead_id("bd-fake-1.2.3"));
        assert!(is_valid_bead_id("gt-abc1"));

        assert!(!is_valid_bead_id(""));
        assert!(!is_valid_bead_id("bd"));
        assert!(!is_valid_bead_id("bd-"));
        assert!(!is_valid_bead_id("-abc123"));
        assert!(!is_valid_bead_id("BD-ABC123")); // Must be lowercase
    }

    #[test]
    fn test_bead_status_display() {
        assert_eq!(format!("{}", BeadStatus::Complete), "complete");
        assert_eq!(format!("{}", BeadStatus::Ready), "ready");
        assert_eq!(format!("{}", BeadStatus::Blocked), "blocked");
        assert_eq!(format!("{}", BeadStatus::Pending), "pending");
    }

    #[test]
    fn test_issue_details_serde_without_rich_fields() {
        // Test backward compatibility: IssueDetails without new fields should deserialize correctly
        let json = r#"{
            "id": "bd-test1",
            "title": "Test Issue",
            "description": "Test description",
            "status": "open",
            "priority": 2,
            "issue_type": "task",
            "dependencies": [],
            "dependents": []
        }"#;

        let details: IssueDetails = serde_json::from_str(json).unwrap();
        assert_eq!(details.id, "bd-test1");
        assert_eq!(details.title, "Test Issue");
        assert_eq!(details.description, "Test description");
        assert!(details.design.is_none());
        assert!(details.acceptance_criteria.is_none());
        assert!(details.notes.is_none());
    }

    #[test]
    fn test_issue_details_serde_with_rich_fields() {
        // Test new fields serialize and deserialize correctly
        let json = "{
            \"id\": \"bd-test2\",
            \"title\": \"Rich Issue\",
            \"description\": \"Description\",
            \"status\": \"open\",
            \"priority\": 1,
            \"issue_type\": \"feature\",
            \"dependencies\": [],
            \"dependents\": [],
            \"design\": \"Design content\",
            \"acceptance_criteria\": \"Acceptance content\",
            \"notes\": \"Notes content\"
        }";

        let details: IssueDetails = serde_json::from_str(json).unwrap();
        assert_eq!(details.id, "bd-test2");
        assert_eq!(details.design, Some("Design content".to_string()));
        assert_eq!(
            details.acceptance_criteria,
            Some("Acceptance content".to_string())
        );
        assert_eq!(details.notes, Some("Notes content".to_string()));
    }

    #[test]
    fn test_issue_details_roundtrip() {
        // Test that IssueDetails with all fields round-trips correctly
        let original = IssueDetails {
            id: "bd-test3".to_string(),
            title: "Full Issue".to_string(),
            description: "Full description".to_string(),
            status: "open".to_string(),
            priority: 3,
            issue_type: "bug".to_string(),
            dependencies: vec![],
            dependents: vec![],
            design: Some("Design content".to_string()),
            acceptance_criteria: Some("Acceptance content".to_string()),
            notes: Some("Notes content".to_string()),
            close_reason: Some("Completed".to_string()),
            metadata: Some(serde_json::json!({"key": "value"})),
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: IssueDetails = serde_json::from_str(&json).unwrap();

        assert_eq!(original.id, deserialized.id);
        assert_eq!(original.title, deserialized.title);
        assert_eq!(original.design, deserialized.design);
        assert_eq!(
            original.acceptance_criteria,
            deserialized.acceptance_criteria
        );
        assert_eq!(original.notes, deserialized.notes);
        assert_eq!(original.close_reason, deserialized.close_reason);
        assert_eq!(original.metadata, deserialized.metadata);
    }

    #[test]
    fn test_parse_close_reason_valid() {
        let parsed = parse_close_reason("Committed: abc123d -- feat(api): add client");
        assert_eq!(parsed.commit_hash, Some("abc123d".to_string()));
        assert_eq!(
            parsed.commit_summary,
            Some("feat(api): add client".to_string())
        );
        assert_eq!(parsed.raw, "Committed: abc123d -- feat(api): add client");
    }

    #[test]
    fn test_parse_close_reason_non_standard() {
        let parsed = parse_close_reason("Manually closed");
        assert_eq!(parsed.commit_hash, None);
        assert_eq!(parsed.commit_summary, None);
        assert_eq!(parsed.raw, "Manually closed");
    }

    #[test]
    fn test_parse_close_reason_empty() {
        let parsed = parse_close_reason("");
        assert_eq!(parsed.commit_hash, None);
        assert_eq!(parsed.commit_summary, None);
        assert_eq!(parsed.raw, "");
    }

    #[test]
    fn test_parse_close_reason_no_separator() {
        let parsed = parse_close_reason("Committed: abc123d");
        assert_eq!(parsed.commit_hash, Some("abc123d".to_string()));
        assert_eq!(parsed.commit_summary, None);
        assert_eq!(parsed.raw, "Committed: abc123d");
    }

    #[test]
    fn test_beadscli_default_env_vars() {
        let cli = BeadsCli::default();
        assert_eq!(cli.env_vars.get("BEADS_NO_DAEMON"), Some(&"1".to_string()));
        assert_eq!(
            cli.env_vars.get("BEADS_NO_AUTO_FLUSH"),
            Some(&"1".to_string())
        );
        assert_eq!(cli.env_vars.len(), 2);
    }

    #[test]
    fn test_beadscli_new_env_vars() {
        let cli = BeadsCli::new("bd".to_string());
        assert_eq!(cli.env_vars.get("BEADS_NO_DAEMON"), Some(&"1".to_string()));
        assert_eq!(
            cli.env_vars.get("BEADS_NO_AUTO_FLUSH"),
            Some(&"1".to_string())
        );
        assert_eq!(cli.env_vars.len(), 2);
    }

    #[test]
    fn test_is_initialized_false_when_beads_only_in_parent() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let parent = temp_dir.path();
        let child = parent.join("child");
        fs::create_dir(&child).unwrap();

        // Create .beads/ in parent
        let beads_dir = parent.join(".beads");
        fs::create_dir(&beads_dir).unwrap();

        // is_initialized should return false for child (no walk-up)
        let cli = BeadsCli::default();
        assert!(!cli.is_initialized(&child));
    }

    #[test]
    fn test_is_initialized_true_when_beads_in_given_directory() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dir = temp_dir.path();

        // Create .beads/ in given directory
        let beads_dir = dir.join(".beads");
        fs::create_dir(&beads_dir).unwrap();

        // is_initialized should return true
        let cli = BeadsCli::default();
        assert!(cli.is_initialized(dir));
    }
}
