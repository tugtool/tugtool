//! JSON output formatting per Spec S05

use serde::{Deserialize, Serialize};
use tugtool_core::{Severity, ValidationIssue};

const SCHEMA_VERSION: &str = "1";

/// JSON response envelope per Spec S05
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonResponse<T> {
    /// Schema version for forward compatibility
    pub schema_version: String,
    /// Command that generated this response
    pub command: String,
    /// Status: "ok" or "error"
    pub status: String,
    /// Command-specific payload
    pub data: T,
    /// Validation issues, warnings, etc.
    pub issues: Vec<JsonIssue>,
}

impl<T> JsonResponse<T> {
    /// Create a successful response
    pub fn ok(command: &str, data: T) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            command: command.to_string(),
            status: "ok".to_string(),
            data,
            issues: vec![],
        }
    }

    /// Create a successful response with issues
    pub fn ok_with_issues(command: &str, data: T, issues: Vec<JsonIssue>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            command: command.to_string(),
            status: "ok".to_string(),
            data,
            issues,
        }
    }

    /// Create an error response
    pub fn error(command: &str, data: T, issues: Vec<JsonIssue>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            command: command.to_string(),
            status: "error".to_string(),
            data,
            issues,
        }
    }
}

/// Issue object structure per Spec S05
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonIssue {
    /// Error/warning code (e.g., "E001")
    pub code: String,
    /// Severity level
    pub severity: String,
    /// Human-readable message
    pub message: String,
    /// Project-root-relative file path using forward slashes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Line number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    /// Anchor reference (always starts with # if present)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
}

impl From<&ValidationIssue> for JsonIssue {
    fn from(issue: &ValidationIssue) -> Self {
        let severity = match issue.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Info => "info",
        };
        Self {
            code: issue.code.clone(),
            severity: severity.to_string(),
            message: issue.message.clone(),
            file: None, // Set by the caller with proper path
            line: issue.line,
            anchor: issue.anchor.clone(),
        }
    }
}

impl JsonIssue {
    /// Set the file path
    pub fn with_file(mut self, file: &str) -> Self {
        self.file = Some(file.to_string());
        self
    }
}

/// Data payload for init command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitData {
    /// Path to the created directory
    pub path: String,
    /// Files created
    pub files_created: Vec<String>,
}

/// Data payload for init --check command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitCheckData {
    /// Whether the project is initialized
    pub initialized: bool,
    /// Path to .tug directory
    pub path: String,
}

/// Parse diagnostic (P-code) for JSON output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonDiagnostic {
    /// Diagnostic code (e.g., "P001", "P006")
    pub code: String,
    /// Human-readable message
    pub message: String,
    /// Line number where the diagnostic was triggered
    pub line: Option<usize>,
    /// Optional suggestion for fixing the issue
    pub suggestion: Option<String>,
    /// File path (optional, for aggregate output)
    pub file: Option<String>,
}

impl From<&tugtool_core::ParseDiagnostic> for JsonDiagnostic {
    fn from(diagnostic: &tugtool_core::ParseDiagnostic) -> Self {
        Self {
            code: diagnostic.code.clone(),
            message: diagnostic.message.clone(),
            line: Some(diagnostic.line),
            suggestion: diagnostic.suggestion.clone(),
            file: None, // Set by caller
        }
    }
}

impl JsonDiagnostic {
    /// Set the file path for this diagnostic
    pub fn with_file(mut self, file: &str) -> Self {
        self.file = Some(file.to_string());
        self
    }
}

/// Data payload for validate command
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidateData {
    /// Validated files
    pub files: Vec<ValidatedFile>,
    /// Parse diagnostics (P-codes) across all validated files
    #[serde(default)]
    pub diagnostics: Vec<JsonDiagnostic>,
}

/// A validated file entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedFile {
    /// Project-root-relative path
    pub path: String,
    /// Whether the file is valid (no errors)
    pub valid: bool,
    /// Number of errors
    pub error_count: usize,
    /// Number of warnings
    pub warning_count: usize,
    /// Number of diagnostics
    pub diagnostic_count: usize,
}

/// Data payload for list command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListData {
    /// List of plans
    pub plans: Vec<PlanSummary>,
}

/// Summary of a plan for list command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanSummary {
    /// Name without prefix/extension
    pub name: String,
    /// Status from metadata
    pub status: String,
    /// Progress (done/total checkboxes)
    pub progress: Progress,
    /// Last updated date
    pub updated: String,
}

/// Progress tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    /// Number of completed items
    pub done: usize,
    /// Total number of items
    pub total: usize,
}

/// Data payload for status command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusData {
    /// Plan name
    pub name: String,
    /// Status from metadata
    pub status: String,
    /// Overall progress
    pub progress: Progress,
    /// Step-by-step status
    pub steps: Vec<StepStatus>,
    /// All steps in the plan
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_steps: Option<Vec<StepInfo>>,
    /// Steps with all checkboxes checked
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_steps: Option<Vec<StepInfo>>,
    /// Steps with unchecked checkboxes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_steps: Option<Vec<StepInfo>>,
    /// First remaining step, or None if all done
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_step: Option<StepInfo>,
    /// Map of step anchor (with #) to bead ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_mapping: Option<std::collections::HashMap<String, String>>,
    /// Map of step anchor (with #) to dependency anchors (with #)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<std::collections::HashMap<String, Vec<String>>>,
    /// Mode: "full" or null (for --full flag)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// Plan file path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Phase title from plan
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_title: Option<String>,
    /// Total number of steps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_step_count: Option<usize>,
    /// Number of completed steps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_step_count: Option<usize>,
    /// Number of ready steps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_step_count: Option<usize>,
    /// Number of blocked steps
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_step_count: Option<usize>,
    /// Bead-enriched step status (for --full)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_steps: Option<Vec<BeadStepStatus>>,
}

/// Status of a single step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepStatus {
    /// Step title
    pub title: String,
    /// Step anchor (with #)
    pub anchor: String,
    /// Number of completed items
    pub done: usize,
    /// Total number of items
    pub total: usize,
    /// Substeps (if any)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub substeps: Vec<SubstepStatus>,
}

/// Status of a substep
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstepStatus {
    /// Substep title
    pub title: String,
    /// Substep anchor (with #)
    pub anchor: String,
    /// Number of completed items
    pub done: usize,
    /// Total number of items
    pub total: usize,
}

/// Lightweight step information for extended status queries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepInfo {
    /// Step anchor (with #)
    pub anchor: String,
    /// Step title
    pub title: String,
    /// Step number (e.g., "0", "1", "2-1")
    pub number: String,
    /// Bead ID if assigned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_id: Option<String>,
}

/// Bead-enriched step status for --full view (Table T01)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeadStepStatus {
    /// Step anchor (with #)
    pub anchor: String,
    /// Step title
    pub title: String,
    /// Step number (e.g., "0", "1", "2-1")
    pub number: String,
    /// Bead status: "complete", "ready", "blocked", or null if no bead
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_status: Option<String>,
    /// Bead ID if assigned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_id: Option<String>,
    /// Commit hash from close_reason (if "Committed: <hash> -- <summary>")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    /// Commit summary from close_reason
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_summary: Option<String>,
    /// Raw close_reason string
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_reason: Option<String>,
    /// Number of task checkboxes in step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_count: Option<usize>,
    /// Number of test checkboxes in step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_count: Option<usize>,
    /// Number of checkpoints in step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_count: Option<usize>,
    /// List of step anchors this step is blocked by
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_by: Option<Vec<String>>,
}

/// Data payload for log rotate command (Spec S01)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)] // Will be used in step-1 implementation
pub struct RotateData {
    /// Whether rotation occurred
    pub rotated: bool,
    /// Path to archived file if rotated
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_path: Option<String>,
    /// Original line count
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_lines: Option<usize>,
    /// Original byte count
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_bytes: Option<usize>,
    /// Reason for rotation (Table T01)
    pub reason: String,
}

/// Data payload for log prepend command (Spec S02)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrependData {
    /// Whether entry was added
    pub entry_added: bool,
    /// Step anchor
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    /// Plan path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Timestamp of entry
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Data payload for doctor command (Spec S03)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorData {
    /// Individual health checks
    pub checks: Vec<HealthCheck>,
    /// Summary statistics
    pub summary: DoctorSummary,
}

/// Summary of doctor results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSummary {
    /// Number of checks that passed
    pub passed: usize,
    /// Number of checks with warnings
    pub warnings: usize,
    /// Number of checks that failed
    pub failures: usize,
}

/// Individual health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    /// Check name (e.g., "initialized", "log_size")
    pub name: String,
    /// Status: "pass", "warn", or "fail"
    pub status: String,
    /// Human-readable message
    pub message: String,
    /// Optional structured details
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

/// Data payload for beads close command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeadsCloseData {
    /// Bead ID that was closed
    pub bead_id: String,
    /// Whether the bead was closed successfully
    pub closed: bool,
    /// Optional reason for closing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Whether log rotation was triggered
    pub log_rotated: bool,
    /// Path to archived log if rotation occurred
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_path: Option<String>,
}

/// Data payload for commit command (Spec S01)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitData {
    /// Whether the git commit was created
    pub committed: bool,
    /// Full git commit hash, null if not committed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    /// Whether the bead was closed successfully
    pub bead_closed: bool,
    /// Bead ID that was closed, null if not closed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_id: Option<String>,
    /// Whether the implementation log was updated
    pub log_updated: bool,
    /// Whether log rotation occurred before prepend
    pub log_rotated: bool,
    /// Path to archived log file if rotation occurred
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_path: Option<String>,
    /// List of files that were staged
    pub files_staged: Vec<String>,
    /// True if commit succeeded but bead close failed
    #[serde(alias = "needs_reconcile")] // v1 compat
    pub bead_close_failed: bool,
    /// Any non-fatal warnings encountered
    pub warnings: Vec<String>,
}

/// Data payload for open-pr command (Spec S02)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPrData {
    /// Whether both push and PR creation succeeded
    pub success: bool,
    /// Whether the branch was pushed to remote
    pub pushed: bool,
    /// Whether the PR was created
    pub pr_created: bool,
    /// GitHub repo in `owner/repo` format
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    /// Full URL to the created PR
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    /// PR number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<i64>,
}

/// Data payload for resolve command (Spec S02)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveData {
    /// Resolved plan path (relative to project root), present on success
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Extracted slug (name portion without prefix/extension), present on success
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    /// Which cascade stage matched (exact, filename, slug, prefix, auto), present on success
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    /// List of candidate paths (present on error: ambiguous or not-found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<String>>,
}

/// Data payload for tell command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TellData {
    /// Server response status
    pub server_status: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commit_data_serialization() {
        let data = CommitData {
            committed: true,
            commit_hash: Some("abc1234".to_string()),
            bead_closed: true,
            bead_id: Some("bd-123".to_string()),
            log_updated: true,
            log_rotated: false,
            archived_path: None,
            files_staged: vec!["a.rs".to_string(), "b.rs".to_string()],
            bead_close_failed: false,
            warnings: vec![],
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: CommitData = serde_json::from_str(&json).unwrap();

        assert!(deserialized.committed);
        assert_eq!(deserialized.commit_hash, Some("abc1234".to_string()));
        assert!(deserialized.bead_closed);
        assert_eq!(deserialized.bead_id, Some("bd-123".to_string()));
        assert!(deserialized.log_updated);
        assert!(!deserialized.log_rotated);
        assert_eq!(deserialized.archived_path, None);
        assert_eq!(deserialized.files_staged, vec!["a.rs", "b.rs"]);
        assert!(!deserialized.bead_close_failed);
        assert_eq!(deserialized.warnings.len(), 0);
    }

    #[test]
    fn test_commit_data_with_warnings() {
        let data = CommitData {
            committed: true,
            commit_hash: Some("def5678".to_string()),
            bead_closed: false,
            bead_id: None,
            log_updated: true,
            log_rotated: true,
            archived_path: Some(".tugtool/archive/log-2026-02-11.md".to_string()),
            files_staged: vec!["x.rs".to_string()],
            bead_close_failed: true,
            warnings: vec!["Bead close failed".to_string()],
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: CommitData = serde_json::from_str(&json).unwrap();

        assert!(deserialized.bead_close_failed);
        assert_eq!(deserialized.warnings, vec!["Bead close failed"]);
        assert_eq!(
            deserialized.archived_path,
            Some(".tugtool/archive/log-2026-02-11.md".to_string())
        );
    }

    #[test]
    fn test_open_pr_data_serialization() {
        let data = OpenPrData {
            success: true,
            pushed: true,
            pr_created: true,
            repo: Some("owner/repo".to_string()),
            pr_url: Some("https://github.com/owner/repo/pull/42".to_string()),
            pr_number: Some(42),
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: OpenPrData = serde_json::from_str(&json).unwrap();

        assert!(deserialized.success);
        assert!(deserialized.pushed);
        assert!(deserialized.pr_created);
        assert_eq!(deserialized.repo, Some("owner/repo".to_string()));
        assert_eq!(
            deserialized.pr_url,
            Some("https://github.com/owner/repo/pull/42".to_string())
        );
        assert_eq!(deserialized.pr_number, Some(42));
    }

    #[test]
    fn test_open_pr_data_partial_success() {
        let data = OpenPrData {
            success: false,
            pushed: true,
            pr_created: false,
            repo: Some("owner/repo".to_string()),
            pr_url: None,
            pr_number: None,
        };

        let json = serde_json::to_string(&data).unwrap();
        let deserialized: OpenPrData = serde_json::from_str(&json).unwrap();

        assert!(!deserialized.success);
        assert!(deserialized.pushed);
        assert!(!deserialized.pr_created);
        assert_eq!(deserialized.pr_url, None);
        assert_eq!(deserialized.pr_number, None);
    }

    #[test]
    fn test_bead_step_status_serialization_full() {
        let status = BeadStepStatus {
            anchor: "#step-0".to_string(),
            title: "Add authentication".to_string(),
            number: "0".to_string(),
            bead_status: Some("complete".to_string()),
            bead_id: Some("bd-abc123".to_string()),
            commit_hash: Some("abc123d".to_string()),
            commit_summary: Some("feat(auth): add login".to_string()),
            close_reason: Some("Committed: abc123d -- feat(auth): add login".to_string()),
            task_count: Some(5),
            test_count: Some(3),
            checkpoint_count: Some(2),
            blocked_by: Some(vec!["#step-1".to_string()]),
        };

        let json = serde_json::to_string(&status).unwrap();
        let deserialized: BeadStepStatus = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.anchor, "#step-0");
        assert_eq!(deserialized.title, "Add authentication");
        assert_eq!(deserialized.number, "0");
        assert_eq!(deserialized.bead_status, Some("complete".to_string()));
        assert_eq!(deserialized.bead_id, Some("bd-abc123".to_string()));
        assert_eq!(deserialized.commit_hash, Some("abc123d".to_string()));
        assert_eq!(
            deserialized.commit_summary,
            Some("feat(auth): add login".to_string())
        );
        assert_eq!(
            deserialized.close_reason,
            Some("Committed: abc123d -- feat(auth): add login".to_string())
        );
        assert_eq!(deserialized.task_count, Some(5));
        assert_eq!(deserialized.test_count, Some(3));
        assert_eq!(deserialized.checkpoint_count, Some(2));
        assert_eq!(deserialized.blocked_by, Some(vec!["#step-1".to_string()]));
    }

    #[test]
    fn test_bead_step_status_serialization_optional_omitted() {
        let status = BeadStepStatus {
            anchor: "#step-1".to_string(),
            title: "Add password reset".to_string(),
            number: "1".to_string(),
            bead_status: None,
            bead_id: None,
            commit_hash: None,
            commit_summary: None,
            close_reason: None,
            task_count: None,
            test_count: None,
            checkpoint_count: None,
            blocked_by: None,
        };

        let json = serde_json::to_string(&status).unwrap();

        // Verify optional fields are omitted from JSON
        assert!(!json.contains("bead_status"));
        assert!(!json.contains("bead_id"));
        assert!(!json.contains("commit_hash"));
        assert!(!json.contains("commit_summary"));
        assert!(!json.contains("close_reason"));
        assert!(!json.contains("task_count"));
        assert!(!json.contains("test_count"));
        assert!(!json.contains("checkpoint_count"));
        assert!(!json.contains("blocked_by"));

        // Verify required fields are present
        assert!(json.contains("\"anchor\""));
        assert!(json.contains("\"title\""));
        assert!(json.contains("\"number\""));
    }
}

/// Data payload for state init command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateInitData {
    /// Plan file path (relative to repo root)
    pub plan_path: String,
    /// SHA-256 hash of the plan file
    pub plan_hash: String,
    /// True if the plan was already initialized
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
