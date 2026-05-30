//! JSON output formatting for `tug` CLI `--json` mode

use serde::{Deserialize, Serialize};
use tugutil_core::{Severity, ValidationIssue};

const SCHEMA_VERSION: &str = "1";

/// JSON response envelope for `tug` CLI `--json` output
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

/// Issue object structure for `tug` JSON output
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

impl From<&tugutil_core::ParseDiagnostic> for JsonDiagnostic {
    fn from(diagnostic: &tugutil_core::ParseDiagnostic) -> Self {
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

/// Data payload for `tug resolve --json`
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
