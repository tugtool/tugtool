//! JSON output types and serialization for CLI responses.
//!
//! This module defines the exact JSON schema for all CLI outputs per
//! the 26.0.7 JSON Output Schema specification. These types form the **agent contract**.
//!
//! ## Type Consolidation (Option A)
//!
//! These types were migrated from `python/rename.rs` to serve as the single source
//! of truth for output types. The migration reconciled internal types with the
//! 26.0.7 spec:
//!
//! | Internal Type (old) | Output Type (new) | Changes |
//! |---------------------|-------------------|---------|
//! | `Location { byte_offset? }` | `Location { byte_start?, byte_end? }` | Renamed field, added byte_end |
//! | `SymbolInfo { ... }` | `SymbolInfo { ..., container? }` | Added container |
//! | `ReferenceInfo { ... }` | `ReferenceInfo { ... }` | No change |
//!
//! ## Design Principles (List L18)
//!
//! 1. **Structured JSON:** All structured CLI output is valid JSON; `emit` may output plain
//!    unified diff by default (with optional JSON envelope)
//! 2. **Status first:** Every response has `status` as first field
//! 3. **Deterministic:** Same input -> same output (field order, array ordering)
//! 4. **Nullable vs absent:** Explicit `null` for "no value"; absent field means "not applicable"
//! 5. **Versioned:** Schema version in response enables forward compatibility

use std::io::{self, Write};

use serde::{Deserialize, Serialize, Serializer};

use crate::error::{OutputErrorCode, TugError};

// Re-export common types from the types module for convenience
pub use crate::types::{Location, SymbolInfo};

// Re-export types from patch module for convenience
pub use crate::patch::{MaterializedPatch as Patch, OutputEdit as Edit, Span};

/// Current schema version for all responses.
pub const SCHEMA_VERSION: &str = "1";

/// Reference information for JSON output.
///
/// Named `ReferenceInfo` to distinguish from `facts::Reference` (internal graph type).
/// The "Info" suffix indicates this is an information carrier for serialization.
///
/// Per 26.0.7 spec #type-reference:
/// - `location`: Reference location (required)
/// - `kind`: One of: definition, call, reference, import, attribute (required)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceInfo {
    /// Location of the reference.
    pub location: Location,
    /// Kind of reference (definition, call, reference, import, attribute).
    pub kind: String,
}

impl ReferenceInfo {
    /// Create a new Reference.
    pub fn new(location: Location, kind: impl Into<String>) -> Self {
        ReferenceInfo {
            location,
            kind: kind.into(),
        }
    }
}

/// Warning information for JSON output.
///
/// Per 26.0.7 spec #type-warning:
/// - `code`: Stable warning code (required)
/// - `message`: Human-readable message (required)
/// - `location`: Where the warning applies (optional)
/// - `suggestion`: Suggested action (optional)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Warning {
    /// Stable warning code.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Where the warning applies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
    /// Suggested action.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

impl Warning {
    /// Create a simple warning without location.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Warning {
            code: code.into(),
            message: message.into(),
            location: None,
            suggestion: None,
        }
    }

    /// Create a warning with location.
    pub fn with_location(
        code: impl Into<String>,
        message: impl Into<String>,
        location: Location,
    ) -> Self {
        Warning {
            code: code.into(),
            message: message.into(),
            location: Some(location),
            suggestion: None,
        }
    }
}

// ============================================================================
// Impact and Summary Types (26.0.7 spec)
// ============================================================================

/// Impact assessment for analyze-impact response.
///
/// Per 26.0.7 spec #cmd-analyze-impact:
/// - `files_affected`: Number of files that will change (required)
/// - `references_count`: Total reference count (required)
/// - `edits_estimated`: Estimated edit count (required)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Impact {
    /// Number of files that will change.
    pub files_affected: u32,
    /// Total reference count.
    pub references_count: u32,
    /// Estimated edit count.
    pub edits_estimated: u32,
}

impl Impact {
    /// Create a new impact assessment.
    pub fn new(files_affected: u32, references_count: u32, edits_estimated: u32) -> Self {
        Impact {
            files_affected,
            references_count,
            edits_estimated,
        }
    }
}

/// Edit summary for run response.
///
/// Per 26.0.7 spec #cmd-run:
/// - `files_changed`: Files modified (required)
/// - `edits_count`: Total edits (required)
/// - `bytes_added`: Net bytes added (required)
/// - `bytes_removed`: Net bytes removed (required)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    /// Files modified.
    pub files_changed: u32,
    /// Total edits.
    pub edits_count: u32,
    /// Net bytes added.
    pub bytes_added: i64,
    /// Net bytes removed.
    pub bytes_removed: i64,
}

impl Summary {
    /// Create a new summary.
    pub fn new(files_changed: u32, edits_count: u32, bytes_added: i64, bytes_removed: i64) -> Self {
        Summary {
            files_changed,
            edits_count,
            bytes_added,
            bytes_removed,
        }
    }

    /// Create from a patch.
    pub fn from_patch(patch: &Patch) -> Self {
        let mut files = std::collections::HashSet::new();
        let mut bytes_added: i64 = 0;
        let mut bytes_removed: i64 = 0;

        for edit in &patch.edits {
            files.insert(&edit.file);
            bytes_added += edit.new_text.len() as i64;
            bytes_removed += edit.old_text.len() as i64;
        }

        Summary {
            files_changed: files.len() as u32,
            edits_count: patch.edits.len() as u32,
            bytes_added: bytes_added - bytes_removed.min(bytes_added),
            bytes_removed: bytes_removed - bytes_added.min(bytes_removed),
        }
    }
}

// ============================================================================
// Verification Types (26.0.7 spec)
// ============================================================================

/// Verification result for run response.
///
/// Per 26.0.7 spec #cmd-run:
/// - `status`: "passed", "failed", "skipped" (required)
/// - `mode`: "none", "syntax", "tests", "typecheck" (required)
/// - `checks`: Individual check results (required)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verification {
    /// Verification status.
    pub status: String,
    /// Verification mode.
    pub mode: String,
    /// Individual check results.
    pub checks: Vec<VerificationCheck>,
}

impl Verification {
    /// Create a passed verification result.
    pub fn passed(mode: &str, checks: Vec<VerificationCheck>) -> Self {
        Verification {
            status: "passed".to_string(),
            mode: mode.to_string(),
            checks,
        }
    }

    /// Create a failed verification result.
    pub fn failed(mode: &str, checks: Vec<VerificationCheck>) -> Self {
        Verification {
            status: "failed".to_string(),
            mode: mode.to_string(),
            checks,
        }
    }

    /// Create a skipped verification result.
    pub fn skipped() -> Self {
        Verification {
            status: "skipped".to_string(),
            mode: "none".to_string(),
            checks: vec![],
        }
    }
}

/// Individual verification check result.
///
/// Per 26.0.7 spec #cmd-run:
/// - `name`: Check name (e.g., "compileall", "pytest") (required)
/// - `status`: "passed" or "failed" (required)
/// - `duration_ms`: Check duration in milliseconds (optional)
/// - `output`: Check output on failure (optional)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationCheck {
    /// Check name (e.g., "compileall", "pytest").
    pub name: String,
    /// Check status.
    pub status: String,
    /// Check duration in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Check output on failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

impl VerificationCheck {
    /// Create a passed check.
    pub fn passed(name: impl Into<String>, duration_ms: Option<u64>) -> Self {
        VerificationCheck {
            name: name.into(),
            status: "passed".to_string(),
            duration_ms,
            output: None,
        }
    }

    /// Create a failed check.
    pub fn failed(name: impl Into<String>, output: impl Into<String>) -> Self {
        VerificationCheck {
            name: name.into(),
            status: "failed".to_string(),
            duration_ms: None,
            output: Some(output.into()),
        }
    }
}

// ============================================================================
// Error Types (26.0.7 spec)
// ============================================================================

/// Error information for error responses.
///
/// Per 26.0.7 spec #type-error:
/// - `code`: Numeric error code (required)
/// - `message`: Human-readable message (required)
/// - `details`: Error-specific structured data (optional)
/// - `location`: Where the error occurred (optional)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    /// Numeric error code (from Table T26).
    pub code: u8,
    /// Human-readable message.
    pub message: String,
    /// Error-specific structured data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    /// Where the error occurred.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
}

impl ErrorInfo {
    /// Create from a TugError.
    pub fn from_error(err: &TugError) -> Self {
        let code = OutputErrorCode::from(err).code();
        let message = err.to_string();

        let (details, location) = match err {
            TugError::SymbolNotFound { file, line, col } => {
                (None, Some(Location::new(file.clone(), *line, *col)))
            }
            TugError::AmbiguousSymbol { candidates } => {
                let candidates_json: Vec<_> = candidates
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "id": c.id,
                            "kind": c.kind,
                            "location": {
                                "file": c.location.file,
                                "line": c.location.line,
                                "col": c.location.col
                            }
                        })
                    })
                    .collect();
                (
                    Some(serde_json::json!({ "candidates": candidates_json })),
                    None,
                )
            }
            TugError::InvalidArguments { details, .. } => (details.clone(), None),
            TugError::FileNotFound { path } => (Some(serde_json::json!({ "path": path })), None),
            TugError::ApplyError { file, .. } => {
                let details = file.as_ref().map(|f| serde_json::json!({ "file": f }));
                (details, None)
            }
            TugError::VerificationFailed {
                mode,
                output,
                exit_code,
            } => {
                let details = serde_json::json!({
                    "mode": mode,
                    "output": output,
                    "exit_code": exit_code
                });
                (Some(details), None)
            }
            _ => (None, None),
        };

        ErrorInfo {
            code,
            message,
            details,
            location,
        }
    }
}

// ============================================================================
// Response Structs (26.0.7 spec)
// ============================================================================

/// Response for analyze-impact command.
///
/// Per 26.0.7 spec #cmd-analyze-impact (Spec S17).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeImpactResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Workspace snapshot ID.
    pub snapshot_id: String,
    /// The target symbol.
    pub symbol: SymbolInfo,
    /// All references (ordered by file, then line, then col).
    #[serde(serialize_with = "serialize_sorted_references")]
    pub references: Vec<ReferenceInfo>,
    /// Summary statistics.
    pub impact: Impact,
    /// Warnings (may be empty).
    #[serde(serialize_with = "serialize_sorted_warnings")]
    pub warnings: Vec<Warning>,
}

impl AnalyzeImpactResponse {
    /// Create a new analyze-impact response.
    pub fn new(
        snapshot_id: impl Into<String>,
        symbol: SymbolInfo,
        references: Vec<ReferenceInfo>,
        impact: Impact,
        warnings: Vec<Warning>,
    ) -> Self {
        AnalyzeImpactResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id: snapshot_id.into(),
            symbol,
            references,
            impact,
            warnings,
        }
    }
}

/// Response for run command (without --apply).
///
/// Per 26.0.7 spec #cmd-run (Spec S18).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Workspace snapshot ID.
    pub snapshot_id: String,
    /// The generated patch.
    #[serde(serialize_with = "serialize_sorted_patch")]
    pub patch: Patch,
    /// Edit statistics.
    pub summary: Summary,
    /// Verification results.
    pub verification: Verification,
    /// Warnings (may be empty).
    #[serde(serialize_with = "serialize_sorted_warnings")]
    pub warnings: Vec<Warning>,
    /// Token for potential future undo.
    pub undo_token: String,
    /// Whether changes were applied (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied: Option<bool>,
    /// Files that were modified (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_written: Option<Vec<String>>,
}

impl RunResponse {
    /// Create a new run response (dry run, no apply).
    pub fn new(
        snapshot_id: impl Into<String>,
        patch: Patch,
        verification: Verification,
        warnings: Vec<Warning>,
        undo_token: impl Into<String>,
    ) -> Self {
        let summary = Summary::from_patch(&patch);
        RunResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id: snapshot_id.into(),
            patch,
            summary,
            verification,
            warnings,
            undo_token: undo_token.into(),
            applied: None,
            files_written: None,
        }
    }

    /// Create a run response with apply results.
    pub fn with_apply(
        snapshot_id: impl Into<String>,
        patch: Patch,
        verification: Verification,
        warnings: Vec<Warning>,
        undo_token: impl Into<String>,
        files_written: Vec<String>,
    ) -> Self {
        let summary = Summary::from_patch(&patch);
        RunResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id: snapshot_id.into(),
            patch,
            summary,
            verification,
            warnings,
            undo_token: undo_token.into(),
            applied: Some(true),
            files_written: Some(files_written),
        }
    }
}

/// Response for snapshot command.
///
/// Per 26.0.7 spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Workspace snapshot ID.
    pub snapshot_id: String,
    /// Number of files in snapshot.
    pub file_count: u32,
    /// Total bytes in snapshot.
    pub total_bytes: u64,
}

impl SnapshotResponse {
    /// Create a new snapshot response.
    pub fn new(snapshot_id: impl Into<String>, file_count: u32, total_bytes: u64) -> Self {
        SnapshotResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id: snapshot_id.into(),
            file_count,
            total_bytes,
        }
    }
}

/// Response for verify command.
///
/// Per 26.0.7 spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Verification mode.
    pub mode: String,
    /// Whether verification passed.
    pub passed: bool,
    /// Verification output (on failure).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Exit code from verification command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

impl VerifyResponse {
    /// Create a passed verify response.
    pub fn passed(mode: impl Into<String>) -> Self {
        VerifyResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            mode: mode.into(),
            passed: true,
            output: None,
            exit_code: None,
        }
    }

    /// Create a failed verify response.
    pub fn failed(mode: impl Into<String>, output: impl Into<String>, exit_code: i32) -> Self {
        VerifyResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            mode: mode.into(),
            passed: false,
            output: Some(output.into()),
            exit_code: Some(exit_code),
        }
    }
}

/// Worker status for session status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerStatus {
    /// Worker status: "running", "stopped".
    pub status: String,
    /// Process ID if running.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

/// Cache statistics for session status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    /// Number of cached snapshots.
    pub snapshots: u32,
    /// Facts cache size in bytes.
    pub facts_cache_size_bytes: u64,
}

/// Response for session status command.
///
/// Per 26.0.7 spec #session-status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatusResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Workspace root path.
    pub workspace: String,
    /// Current snapshot ID (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    /// Worker statuses.
    pub workers: std::collections::HashMap<String, WorkerStatus>,
    /// Cache statistics.
    pub cache_stats: CacheStats,
}

impl SessionStatusResponse {
    /// Create a new session status response.
    pub fn new(
        workspace: impl Into<String>,
        snapshot_id: Option<String>,
        workers: std::collections::HashMap<String, WorkerStatus>,
        cache_stats: CacheStats,
    ) -> Self {
        SessionStatusResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            workspace: workspace.into(),
            snapshot_id,
            workers,
            cache_stats,
        }
    }
}

// ============================================================================
// Fixture Response Types (Phase 7)
// ============================================================================

/// Response for fixture fetch command.
///
/// Per Phase 7 Spec S03: fixture fetch Response Schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureFetchResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// List of fixture results.
    pub fixtures: Vec<FixtureFetchResult>,
}

impl FixtureFetchResponse {
    /// Create a new fixture fetch response.
    pub fn new(fixtures: Vec<FixtureFetchResult>) -> Self {
        FixtureFetchResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            fixtures,
        }
    }
}

/// Individual fixture fetch result.
///
/// Per Phase 7 Spec S03.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureFetchResult {
    /// Fixture name.
    pub name: String,
    /// Action taken: "fetched", "up-to-date", "updated".
    pub action: String,
    /// Relative path to fixture directory.
    pub path: String,
    /// Git repository URL.
    pub repository: String,
    /// Git ref (tag/branch).
    #[serde(rename = "ref")]
    pub git_ref: String,
    /// Commit SHA.
    pub sha: String,
}

impl FixtureFetchResult {
    /// Create a new fixture fetch result.
    pub fn new(
        name: impl Into<String>,
        action: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        sha: impl Into<String>,
    ) -> Self {
        FixtureFetchResult {
            name: name.into(),
            action: action.into(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            sha: sha.into(),
        }
    }
}

/// Response for fixture update command.
///
/// Per Phase 7 Spec S04: fixture update Response Schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureUpdateResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Update details.
    pub fixture: FixtureUpdateResult,
    /// Optional warning (e.g., when ref is a branch).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

impl FixtureUpdateResponse {
    /// Create a new fixture update response.
    pub fn new(fixture: FixtureUpdateResult, warning: Option<String>) -> Self {
        FixtureUpdateResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            fixture,
            warning,
        }
    }
}

/// Individual fixture update result.
///
/// Per Phase 7 Spec S04.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureUpdateResult {
    /// Fixture name.
    pub name: String,
    /// Previous git ref.
    pub previous_ref: String,
    /// Previous commit SHA.
    pub previous_sha: String,
    /// New git ref.
    pub new_ref: String,
    /// New commit SHA.
    pub new_sha: String,
    /// Path to lock file.
    pub lock_file: String,
}

impl FixtureUpdateResult {
    /// Create a new fixture update result.
    pub fn new(
        name: impl Into<String>,
        previous_ref: impl Into<String>,
        previous_sha: impl Into<String>,
        new_ref: impl Into<String>,
        new_sha: impl Into<String>,
        lock_file: impl Into<String>,
    ) -> Self {
        FixtureUpdateResult {
            name: name.into(),
            previous_ref: previous_ref.into(),
            previous_sha: previous_sha.into(),
            new_ref: new_ref.into(),
            new_sha: new_sha.into(),
            lock_file: lock_file.into(),
        }
    }
}

/// Response for fixture list command.
///
/// Per Phase 7 Addendum Spec S09: fixture list Response Schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureListResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// List of fixtures from lock files.
    pub fixtures: Vec<FixtureListItem>,
}

impl FixtureListResponse {
    /// Create a new fixture list response.
    pub fn new(fixtures: Vec<FixtureListItem>) -> Self {
        FixtureListResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            fixtures,
        }
    }
}

/// Individual fixture in list response.
///
/// Per Phase 7 Addendum Spec S09.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureListItem {
    /// Fixture name.
    pub name: String,
    /// Git repository URL.
    pub repository: String,
    /// Git ref (tag/branch).
    #[serde(rename = "ref")]
    pub git_ref: String,
    /// Expected commit SHA.
    pub sha: String,
    /// Relative path to lock file.
    pub lock_file: String,
}

impl FixtureListItem {
    /// Create a new fixture list item.
    pub fn new(
        name: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        sha: impl Into<String>,
        lock_file: impl Into<String>,
    ) -> Self {
        FixtureListItem {
            name: name.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            sha: sha.into(),
            lock_file: lock_file.into(),
        }
    }
}

/// Response for fixture status command.
///
/// Per Phase 7 Addendum Spec S10: fixture status Response Schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureStatusResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// List of fixture statuses.
    pub fixtures: Vec<FixtureStatusItem>,
}

impl FixtureStatusResponse {
    /// Create a new fixture status response.
    pub fn new(fixtures: Vec<FixtureStatusItem>) -> Self {
        FixtureStatusResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            fixtures,
        }
    }
}

/// Individual fixture in status response.
///
/// Per Phase 7 Addendum Spec S10.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureStatusItem {
    /// Fixture name.
    pub name: String,
    /// State: "fetched", "missing", "sha-mismatch", "not-a-git-repo", "error".
    pub state: String,
    /// Expected path to fixture directory.
    pub path: String,
    /// Git repository URL.
    pub repository: String,
    /// Git ref (tag/branch).
    #[serde(rename = "ref")]
    pub git_ref: String,
    /// SHA from lock file.
    pub expected_sha: String,
    /// Actual SHA if fixture exists and is a git repo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_sha: Option<String>,
    /// Error message if state is "error".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FixtureStatusItem {
    /// Create a new fixture status item.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        name: impl Into<String>,
        state: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        expected_sha: impl Into<String>,
        actual_sha: Option<String>,
        error: Option<String>,
    ) -> Self {
        FixtureStatusItem {
            name: name.into(),
            state: state.into(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: expected_sha.into(),
            actual_sha,
            error,
        }
    }

    /// Create a fixture status item for a fetched fixture.
    pub fn fetched(
        name: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        sha: impl Into<String>,
    ) -> Self {
        let sha_str = sha.into();
        FixtureStatusItem {
            name: name.into(),
            state: "fetched".to_string(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: sha_str.clone(),
            actual_sha: Some(sha_str),
            error: None,
        }
    }

    /// Create a fixture status item for a missing fixture.
    pub fn missing(
        name: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        expected_sha: impl Into<String>,
    ) -> Self {
        FixtureStatusItem {
            name: name.into(),
            state: "missing".to_string(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: expected_sha.into(),
            actual_sha: None,
            error: None,
        }
    }

    /// Create a fixture status item for a SHA mismatch.
    pub fn sha_mismatch(
        name: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        expected_sha: impl Into<String>,
        actual_sha: impl Into<String>,
    ) -> Self {
        FixtureStatusItem {
            name: name.into(),
            state: "sha-mismatch".to_string(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: expected_sha.into(),
            actual_sha: Some(actual_sha.into()),
            error: None,
        }
    }

    /// Create a fixture status item for a directory that is not a git repo.
    pub fn not_a_git_repo(
        name: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        expected_sha: impl Into<String>,
    ) -> Self {
        FixtureStatusItem {
            name: name.into(),
            state: "not-a-git-repo".to_string(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: expected_sha.into(),
            actual_sha: None,
            error: None,
        }
    }

    /// Create a fixture status item for an error state.
    pub fn error(
        name: impl Into<String>,
        path: impl Into<String>,
        repository: impl Into<String>,
        git_ref: impl Into<String>,
        expected_sha: impl Into<String>,
        error_msg: impl Into<String>,
    ) -> Self {
        FixtureStatusItem {
            name: name.into(),
            state: "error".to_string(),
            path: path.into(),
            repository: repository.into(),
            git_ref: git_ref.into(),
            expected_sha: expected_sha.into(),
            actual_sha: None,
            error: Some(error_msg.into()),
        }
    }
}

/// Error response.
///
/// Per 26.0.7 spec #error-response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// Status: "error".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Snapshot ID (may be absent on some errors).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    /// Error information.
    pub error: ErrorInfo,
}

impl ErrorResponse {
    /// Create an error response from a TugError.
    pub fn from_error(err: &TugError, snapshot_id: Option<String>) -> Self {
        ErrorResponse {
            status: "error".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id,
            error: ErrorInfo::from_error(err),
        }
    }

    /// Create an error response with just code and message.
    pub fn new(code: u8, message: impl Into<String>, snapshot_id: Option<String>) -> Self {
        ErrorResponse {
            status: "error".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            snapshot_id,
            error: ErrorInfo {
                code,
                message: message.into(),
                details: None,
                location: None,
            },
        }
    }
}

// ============================================================================
// Doctor Response Types (Phase 10)
// ============================================================================

/// Check status for doctor checks.
///
/// Per Phase 10 Spec S02:
/// - `passed`: Check succeeded with expected results
/// - `warning`: Check succeeded but result may indicate a problem
/// - `failed`: Check detected an error condition
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    /// Check passed successfully.
    Passed,
    /// Check passed but with a warning condition.
    Warning,
    /// Check failed.
    Failed,
}

impl std::fmt::Display for CheckStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CheckStatus::Passed => write!(f, "passed"),
            CheckStatus::Warning => write!(f, "warning"),
            CheckStatus::Failed => write!(f, "failed"),
        }
    }
}

/// Individual check result for doctor response.
///
/// Per Phase 10 Spec S02:
/// - `name`: Check name (e.g., "workspace_root", "python_files")
/// - `status`: One of "passed", "warning", "failed"
/// - `message`: Human-readable description of the check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    /// Check name (e.g., "workspace_root", "python_files").
    pub name: String,
    /// Check status.
    pub status: CheckStatus,
    /// Human-readable message describing the result.
    pub message: String,
}

impl CheckResult {
    /// Create a passed check result.
    pub fn passed(name: impl Into<String>, message: impl Into<String>) -> Self {
        CheckResult {
            name: name.into(),
            status: CheckStatus::Passed,
            message: message.into(),
        }
    }

    /// Create a warning check result.
    pub fn warning(name: impl Into<String>, message: impl Into<String>) -> Self {
        CheckResult {
            name: name.into(),
            status: CheckStatus::Warning,
            message: message.into(),
        }
    }

    /// Create a failed check result.
    pub fn failed(name: impl Into<String>, message: impl Into<String>) -> Self {
        CheckResult {
            name: name.into(),
            status: CheckStatus::Failed,
            message: message.into(),
        }
    }
}

/// Summary counts for doctor response.
///
/// Per Phase 10 Spec S02.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSummary {
    /// Total number of checks.
    pub total: u32,
    /// Number of passed checks.
    pub passed: u32,
    /// Number of warning checks.
    pub warnings: u32,
    /// Number of failed checks.
    pub failed: u32,
}

impl DoctorSummary {
    /// Create a summary from a list of check results.
    pub fn from_checks(checks: &[CheckResult]) -> Self {
        let mut passed = 0;
        let mut warnings = 0;
        let mut failed = 0;

        for check in checks {
            match check.status {
                CheckStatus::Passed => passed += 1,
                CheckStatus::Warning => warnings += 1,
                CheckStatus::Failed => failed += 1,
            }
        }

        DoctorSummary {
            total: checks.len() as u32,
            passed,
            warnings,
            failed,
        }
    }
}

/// Response for doctor command.
///
/// Per Phase 10 Spec S02: Doctor Response Schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorResponse {
    /// Status: "ok" if all checks passed or warning, "failed" if any failed.
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// List of individual check results.
    pub checks: Vec<CheckResult>,
    /// Summary counts.
    pub summary: DoctorSummary,
}

impl DoctorResponse {
    /// Create a new doctor response from check results.
    ///
    /// Status is "ok" if all checks are passed or warning, "failed" if any check failed.
    pub fn new(checks: Vec<CheckResult>) -> Self {
        let summary = DoctorSummary::from_checks(&checks);
        let status = if summary.failed > 0 {
            "failed".to_string()
        } else {
            "ok".to_string()
        };

        DoctorResponse {
            status,
            schema_version: SCHEMA_VERSION.to_string(),
            checks,
            summary,
        }
    }
}

// ============================================================================
// Filter List Response Types (Phase 12.7)
// ============================================================================

/// Summary of active filters for introspection.
///
/// Per Phase 12.7 Spec S11: Filter Output / Introspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSummary {
    /// Glob patterns from `-- <patterns...>`.
    pub glob_patterns: Vec<String>,
    /// Expression filters from `--filter`.
    pub expressions: Vec<String>,
    /// JSON filter from `--filter-json` (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_filter: Option<serde_json::Value>,
    /// Whether content predicates are enabled.
    pub content_enabled: bool,
}

impl FilterSummary {
    /// Create a new filter summary.
    pub fn new(
        glob_patterns: Vec<String>,
        expressions: Vec<String>,
        json_filter: Option<serde_json::Value>,
        content_enabled: bool,
    ) -> Self {
        FilterSummary {
            glob_patterns,
            expressions,
            json_filter,
            content_enabled,
        }
    }
}

/// Response for `--filter-list` introspection mode.
///
/// Per Phase 12.7 Spec S11: Filter Output / Introspection.
/// Outputs matched files as JSON without performing the refactoring operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterListResponse {
    /// Status: "ok".
    pub status: String,
    /// Schema version for compatibility.
    pub schema_version: String,
    /// Sorted list of relative paths that match the filters.
    pub files: Vec<String>,
    /// Count of matched files.
    pub count: usize,
    /// Summary of active filters.
    pub filter_summary: FilterSummary,
}

impl FilterListResponse {
    /// Create a new filter list response.
    pub fn new(files: Vec<String>, filter_summary: FilterSummary) -> Self {
        let count = files.len();
        FilterListResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            files,
            count,
            filter_summary,
        }
    }
}

// ============================================================================
// Alias Output Types (Phase 10)
// ============================================================================

/// Alias information for impact analysis output.
///
/// Per Phase 10 Spec S05: Impact Analysis Alias Output.
/// Represents a value-level alias that exists in the codebase.
///
/// Example JSON:
/// ```json
/// {
///     "alias_name": "b",
///     "source_name": "bar",
///     "file": "consumer.py",
///     "line": 3,
///     "col": 1,
///     "scope": ["module", "function:process"],
///     "is_import_alias": false,
///     "confidence": 1.0
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AliasOutput {
    /// The name of the alias binding (the LHS of the assignment).
    /// Example: In `b = bar`, this is "b".
    pub alias_name: String,

    /// The name of the source being aliased (the RHS of the assignment).
    /// Example: In `b = bar`, this is "bar".
    pub source_name: String,

    /// The file containing the alias.
    pub file: String,

    /// Line number (1-indexed) where the alias is defined.
    pub line: u32,

    /// Column number (1-indexed) where the alias is defined.
    pub col: u32,

    /// Scope path where the alias is defined.
    /// Example: `["module", "function:process"]` for an alias inside a function.
    pub scope: Vec<String>,

    /// Whether the source of the alias is an imported name.
    pub is_import_alias: bool,

    /// Confidence score for the alias (1.0 for simple assignments).
    pub confidence: f32,
}

impl AliasOutput {
    /// Create a new AliasOutput.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        alias_name: impl Into<String>,
        source_name: impl Into<String>,
        file: impl Into<String>,
        line: u32,
        col: u32,
        scope: Vec<String>,
        is_import_alias: bool,
        confidence: f32,
    ) -> Self {
        AliasOutput {
            alias_name: alias_name.into(),
            source_name: source_name.into(),
            file: file.into(),
            line,
            col,
            scope,
            is_import_alias,
            confidence,
        }
    }
}

// ============================================================================
// Deterministic Sorting
// ============================================================================

/// Serialize references sorted by (file, line, col).
fn serialize_sorted_references<S>(refs: &[ReferenceInfo], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut sorted: Vec<_> = refs.iter().collect();
    sorted.sort_by(|a, b| a.location.cmp(&b.location));
    sorted.serialize(serializer)
}

/// Serialize warnings sorted by location (if present).
fn serialize_sorted_warnings<S>(warnings: &[Warning], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut sorted: Vec<_> = warnings.iter().collect();
    sorted.sort_by(|a, b| match (&a.location, &b.location) {
        (Some(loc_a), Some(loc_b)) => loc_a.cmp(loc_b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.code.cmp(&b.code),
    });
    sorted.serialize(serializer)
}

/// Serialize patch with edits sorted by (file, span.start).
fn serialize_sorted_patch<S>(patch: &Patch, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    // Create a copy with sorted edits
    let mut sorted_edits = patch.edits.clone();
    sorted_edits.sort_by(|a, b| match a.file.cmp(&b.file) {
        std::cmp::Ordering::Equal => a.span.start.cmp(&b.span.start),
        other => other,
    });

    let sorted_patch = Patch {
        edits: sorted_edits,
        unified_diff: patch.unified_diff.clone(),
    };

    sorted_patch.serialize(serializer)
}

// ============================================================================
// Response Emission
// ============================================================================

/// Emit a response as pretty-printed JSON to a writer.
///
/// This is the single output path for CLI, ensuring consistency.
/// The output is deterministic: same input produces identical bytes.
pub fn emit_response<T: Serialize>(response: &T, writer: &mut impl Write) -> io::Result<()> {
    // Use serde_json's pretty printer
    let json = serde_json::to_string_pretty(response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    writeln!(writer, "{}", json)
}

/// Emit a response as compact JSON (single line) to a writer.
pub fn emit_response_compact<T: Serialize>(
    response: &T,
    writer: &mut impl Write,
) -> io::Result<()> {
    let json = serde_json::to_string(response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    writeln!(writer, "{}", json)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod location_tests {
        use super::*;

        #[test]
        fn location_new_serializes_without_byte_offsets() {
            let loc = Location::new("test.py", 42, 8);
            let json = serde_json::to_string(&loc).unwrap();
            // Should NOT include byte_start or byte_end when None
            assert!(!json.contains("byte_start"));
            assert!(!json.contains("byte_end"));
            assert!(json.contains("\"file\":\"test.py\""));
            assert!(json.contains("\"line\":42"));
            assert!(json.contains("\"col\":8"));
        }

        #[test]
        fn location_with_span_serializes_all_fields() {
            let loc = Location::with_span("src/main.py", 42, 8, 1234, 1245);
            let json = serde_json::to_string(&loc).unwrap();
            assert!(json.contains("\"byte_start\":1234"));
            assert!(json.contains("\"byte_end\":1245"));
        }

        #[test]
        fn location_parse_valid() {
            let loc = Location::parse("src/utils.py:42:5").unwrap();
            assert_eq!(loc.file, "src/utils.py");
            assert_eq!(loc.line, 42);
            assert_eq!(loc.col, 5);
            assert_eq!(loc.byte_start, None);
            assert_eq!(loc.byte_end, None);
        }

        #[test]
        fn location_parse_windows_path() {
            // Windows paths have colons - rsplitn should handle this
            let loc = Location::parse("C:/Users/foo/src/utils.py:10:3").unwrap();
            assert_eq!(loc.file, "C:/Users/foo/src/utils.py");
            assert_eq!(loc.line, 10);
            assert_eq!(loc.col, 3);
        }

        #[test]
        fn location_parse_invalid() {
            assert!(Location::parse("src/utils.py").is_none());
            assert!(Location::parse("src/utils.py:42").is_none());
            assert!(Location::parse("src/utils.py:abc:5").is_none());
        }

        #[test]
        fn location_json_matches_spec() {
            // Per 26.0.7 spec: {"file":"src/main.py","line":42,"col":8}
            let loc = Location::new("src/main.py", 42, 8);
            let json = serde_json::to_string(&loc).unwrap();
            // Verify it parses back correctly
            let parsed: Location = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.file, "src/main.py");
            assert_eq!(parsed.line, 42);
            assert_eq!(parsed.col, 8);
        }

        #[test]
        fn location_to_json_matches_spec_exactly() {
            // Test from plan: OutputLocation::new("test.py", 42, 8).to_json() matches {"file":"test.py","line":42,"col":8}
            let loc = Location::new("test.py", 42, 8);
            let json = serde_json::to_string(&loc).unwrap();
            // Parse and verify structure
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed["file"], "test.py");
            assert_eq!(parsed["line"], 42);
            assert_eq!(parsed["col"], 8);
            // Ensure no extra fields
            assert!(parsed.get("byte_start").is_none());
            assert!(parsed.get("byte_end").is_none());
        }
    }

    mod symbol_info_tests {
        use super::*;

        #[test]
        fn symbol_without_container() {
            let sym = SymbolInfo::from_facts(
                "sym_abc123",
                "process_data",
                "function",
                "src/utils.py",
                42,
                4,
                1000,
                1012,
                None,
            );
            let json = serde_json::to_string(&sym).unwrap();
            // Should NOT include container when None
            assert!(!json.contains("container"));
            assert!(json.contains("\"id\":\"sym_abc123\""));
            assert!(json.contains("\"name\":\"process_data\""));
            assert!(json.contains("\"kind\":\"function\""));
        }

        #[test]
        fn symbol_with_container() {
            let sym = SymbolInfo::from_facts(
                "sym_method",
                "do_work",
                "method",
                "src/utils.py",
                50,
                8,
                1500,
                1507,
                Some("sym_class".to_string()),
            );
            let json = serde_json::to_string(&sym).unwrap();
            assert!(json.contains("\"container\":\"sym_class\""));
        }

        #[test]
        fn symbol_serialization_includes_optional_container_when_present() {
            // Test from plan
            let sym = SymbolInfo::from_facts(
                "sym_001",
                "method_name",
                "method",
                "test.py",
                10,
                4,
                100,
                110,
                Some("sym_class".to_string()),
            );
            let json = serde_json::to_string(&sym).unwrap();
            assert!(json.contains("\"container\":\"sym_class\""));
        }
    }

    mod reference_info_tests {
        use super::*;

        #[test]
        fn reference_serialization() {
            let reference = ReferenceInfo::new(Location::new("src/main.py", 15, 8), "call");
            let json = serde_json::to_string(&reference).unwrap();
            assert!(json.contains("\"kind\":\"call\""));
            assert!(json.contains("\"file\":\"src/main.py\""));
        }

        #[test]
        fn reference_kinds_serialize_to_lowercase() {
            // Test from plan: OutputReference kind serializes to lowercase strings
            for kind in ["definition", "call", "reference", "import", "attribute"] {
                let reference = ReferenceInfo::new(Location::new("test.py", 1, 1), kind);
                let json = serde_json::to_string(&reference).unwrap();
                assert!(json.contains(&format!("\"kind\":\"{}\"", kind)));
            }
        }
    }

    mod warning_tests {
        use super::*;

        #[test]
        fn warning_without_location() {
            let warning = Warning::new("DynamicReference", "Found dynamic attribute access");
            let json = serde_json::to_string(&warning).unwrap();
            assert!(!json.contains("location"));
            assert!(!json.contains("suggestion"));
        }

        #[test]
        fn warning_with_location() {
            let warning = Warning::with_location(
                "DynamicReference",
                "Found dynamic attribute access",
                Location::new("test.py", 10, 5),
            );
            let json = serde_json::to_string(&warning).unwrap();
            assert!(json.contains("\"location\""));
            assert!(json.contains("\"file\":\"test.py\""));
        }
    }

    mod edit_tests {
        use super::*;

        #[test]
        fn edit_includes_span_and_line_col() {
            // Test from plan: OutputEdit includes both span and line/col fields
            let edit = Edit {
                file: "src/utils.py".to_string(),
                span: Span::new(1004, 1016),
                old_text: "process_data".to_string(),
                new_text: "transform_data".to_string(),
                line: 42,
                col: 4,
            };
            let json = serde_json::to_string(&edit).unwrap();
            assert!(json.contains("\"span\""));
            assert!(json.contains("\"start\":1004"));
            assert!(json.contains("\"end\":1016"));
            assert!(json.contains("\"line\":42"));
            assert!(json.contains("\"col\":4"));
        }
    }

    mod response_tests {
        use super::*;

        #[test]
        fn analyze_references_sorted() {
            // Test from plan: AnalyzeImpactResponse references are sorted by (file, line, col)
            let refs = vec![
                ReferenceInfo::new(Location::new("b.py", 10, 5), "call"),
                ReferenceInfo::new(Location::new("a.py", 20, 1), "reference"),
                ReferenceInfo::new(Location::new("a.py", 10, 5), "definition"),
            ];

            let response = AnalyzeImpactResponse::new(
                "snap_123",
                SymbolInfo::from_facts("sym_1", "foo", "function", "a.py", 10, 5, 100, 103, None),
                refs,
                Impact::new(2, 3, 3),
                vec![],
            );

            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            let references = parsed["references"].as_array().unwrap();
            assert_eq!(references[0]["location"]["file"], "a.py");
            assert_eq!(references[0]["location"]["line"], 10);
            assert_eq!(references[1]["location"]["file"], "a.py");
            assert_eq!(references[1]["location"]["line"], 20);
            assert_eq!(references[2]["location"]["file"], "b.py");
        }

        #[test]
        fn run_response_edits_sorted() {
            // Test from plan: RunResponse edits are sorted by (file, span.start)
            let patch = Patch {
                edits: vec![
                    Edit {
                        file: "b.py".to_string(),
                        span: Span::new(100, 110),
                        old_text: "foo".to_string(),
                        new_text: "bar".to_string(),
                        line: 5,
                        col: 1,
                    },
                    Edit {
                        file: "a.py".to_string(),
                        span: Span::new(200, 210),
                        old_text: "foo".to_string(),
                        new_text: "bar".to_string(),
                        line: 10,
                        col: 1,
                    },
                    Edit {
                        file: "a.py".to_string(),
                        span: Span::new(50, 60),
                        old_text: "foo".to_string(),
                        new_text: "bar".to_string(),
                        line: 2,
                        col: 1,
                    },
                ],
                unified_diff: "".to_string(),
            };

            let response = RunResponse::new(
                "snap_123",
                patch,
                Verification::skipped(),
                vec![],
                "undo_123",
            );

            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            let edits = parsed["patch"]["edits"].as_array().unwrap();
            // Should be sorted: a.py:50, a.py:200, b.py:100
            assert_eq!(edits[0]["file"], "a.py");
            assert_eq!(edits[0]["span"]["start"], 50);
            assert_eq!(edits[1]["file"], "a.py");
            assert_eq!(edits[1]["span"]["start"], 200);
            assert_eq!(edits[2]["file"], "b.py");
        }

        #[test]
        fn error_response_structure_matches_spec() {
            // Test from plan: ErrorResponse structure matches {"status":"error","error":{"code":3,"message":"..."}}
            let err = TugError::symbol_not_found("src/main.py", 42, 8);
            let response = ErrorResponse::from_error(&err, Some("snap_123".to_string()));

            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["status"], "error");
            assert_eq!(parsed["error"]["code"], 3); // ResolutionError
            assert!(parsed["error"]["message"]
                .as_str()
                .unwrap()
                .contains("no symbol found"));
        }
    }

    mod emit_tests {
        use super::*;

        #[test]
        fn emit_response_produces_valid_json() {
            // Test from plan: emit_response produces valid JSON parseable by serde_json::from_str
            let response = SnapshotResponse::new("snap_123", 10, 5000);

            let mut output = Vec::new();
            emit_response(&response, &mut output).unwrap();

            let json_str = String::from_utf8(output).unwrap();
            let _parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        }

        #[test]
        fn emit_response_is_deterministic() {
            // Test from plan: emit_response output is deterministic (same input → same bytes)
            let refs = vec![
                ReferenceInfo::new(Location::new("b.py", 10, 5), "call"),
                ReferenceInfo::new(Location::new("a.py", 5, 1), "definition"),
            ];

            let response = AnalyzeImpactResponse::new(
                "snap_123",
                SymbolInfo::from_facts("sym_1", "foo", "function", "a.py", 5, 1, 50, 53, None),
                refs,
                Impact::new(2, 2, 2),
                vec![],
            );

            let mut output1 = Vec::new();
            let mut output2 = Vec::new();
            emit_response(&response, &mut output1).unwrap();
            emit_response(&response, &mut output2).unwrap();

            assert_eq!(output1, output2, "emit_response must be deterministic");
        }
    }

    mod impact_tests {
        use super::*;

        #[test]
        fn impact_serialization() {
            let impact = Impact::new(3, 15, 15);
            let json = serde_json::to_string(&impact).unwrap();
            assert!(json.contains("\"files_affected\":3"));
            assert!(json.contains("\"references_count\":15"));
            assert!(json.contains("\"edits_estimated\":15"));
        }
    }

    mod summary_tests {
        use super::*;

        #[test]
        fn summary_from_patch() {
            let patch = Patch {
                edits: vec![
                    Edit {
                        file: "a.py".to_string(),
                        span: Span::new(0, 3),
                        old_text: "foo".to_string(),
                        new_text: "foobar".to_string(),
                        line: 1,
                        col: 1,
                    },
                    Edit {
                        file: "b.py".to_string(),
                        span: Span::new(0, 3),
                        old_text: "foo".to_string(),
                        new_text: "bar".to_string(),
                        line: 1,
                        col: 1,
                    },
                ],
                unified_diff: "".to_string(),
            };

            let summary = Summary::from_patch(&patch);
            assert_eq!(summary.files_changed, 2);
            assert_eq!(summary.edits_count, 2);
            // "foo" -> "foobar" adds 3 bytes, "foo" -> "bar" adds 0 bytes
            assert_eq!(summary.bytes_added, 3);
            assert_eq!(summary.bytes_removed, 0);
        }
    }

    mod verification_tests {
        use super::*;

        #[test]
        fn verification_passed() {
            let v = Verification::passed(
                "syntax",
                vec![VerificationCheck::passed("compileall", Some(150))],
            );
            let json = serde_json::to_string(&v).unwrap();
            assert!(json.contains("\"status\":\"passed\""));
            assert!(json.contains("\"mode\":\"syntax\""));
        }

        #[test]
        fn verification_failed() {
            let v = Verification::failed(
                "syntax",
                vec![VerificationCheck::failed(
                    "compileall",
                    "SyntaxError: invalid syntax",
                )],
            );
            let json = serde_json::to_string(&v).unwrap();
            assert!(json.contains("\"status\":\"failed\""));
        }

        #[test]
        fn verification_skipped() {
            let v = Verification::skipped();
            let json = serde_json::to_string(&v).unwrap();
            assert!(json.contains("\"status\":\"skipped\""));
            assert!(json.contains("\"mode\":\"none\""));
        }
    }

    mod fixture_list_tests {
        use super::*;

        #[test]
        fn fixture_list_response_serializes_to_expected_json() {
            let fixtures = vec![FixtureListItem::new(
                "temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
                "fixtures/temporale.lock",
            )];

            let response = FixtureListResponse::new(fixtures);
            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["status"], "ok");
            assert_eq!(parsed["schema_version"], "1");
            assert_eq!(parsed["fixtures"].as_array().unwrap().len(), 1);

            let fixture = &parsed["fixtures"][0];
            assert_eq!(fixture["name"], "temporale");
            assert_eq!(
                fixture["repository"],
                "https://github.com/tugtool/temporale"
            );
            assert_eq!(fixture["ref"], "v0.1.0");
            assert_eq!(fixture["sha"], "9f21df0322b7aa39ca7f599b128f66c07ecec42f");
            assert_eq!(fixture["lock_file"], "fixtures/temporale.lock");
        }

        #[test]
        fn fixture_list_response_empty_fixtures() {
            let response = FixtureListResponse::new(vec![]);
            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["status"], "ok");
            assert_eq!(parsed["fixtures"].as_array().unwrap().len(), 0);
        }
    }

    mod fixture_status_tests {
        use super::*;

        #[test]
        fn fixture_status_response_serializes_to_expected_json() {
            let fixtures = vec![FixtureStatusItem::fetched(
                "temporale",
                ".tug/fixtures/temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
            )];

            let response = FixtureStatusResponse::new(fixtures);
            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["status"], "ok");
            assert_eq!(parsed["schema_version"], "1");
            assert_eq!(parsed["fixtures"].as_array().unwrap().len(), 1);

            let fixture = &parsed["fixtures"][0];
            assert_eq!(fixture["name"], "temporale");
            assert_eq!(fixture["state"], "fetched");
            assert_eq!(fixture["path"], ".tug/fixtures/temporale");
            assert_eq!(
                fixture["repository"],
                "https://github.com/tugtool/temporale"
            );
            assert_eq!(fixture["ref"], "v0.1.0");
            assert_eq!(
                fixture["expected_sha"],
                "9f21df0322b7aa39ca7f599b128f66c07ecec42f"
            );
            assert_eq!(
                fixture["actual_sha"],
                "9f21df0322b7aa39ca7f599b128f66c07ecec42f"
            );
        }

        #[test]
        fn fixture_status_item_with_optional_fields_serializes_correctly() {
            // Test missing state - no actual_sha or error
            let missing = FixtureStatusItem::missing(
                "temporale",
                ".tug/fixtures/temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
            );

            let json = serde_json::to_string(&missing).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["state"], "missing");
            // actual_sha and error should be absent (not null)
            assert!(parsed.get("actual_sha").is_none());
            assert!(parsed.get("error").is_none());
        }

        #[test]
        fn fixture_status_item_sha_mismatch() {
            let mismatch = FixtureStatusItem::sha_mismatch(
                "temporale",
                ".tug/fixtures/temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "expected123",
                "actual456",
            );

            let json = serde_json::to_string(&mismatch).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["state"], "sha-mismatch");
            assert_eq!(parsed["expected_sha"], "expected123");
            assert_eq!(parsed["actual_sha"], "actual456");
            assert!(parsed.get("error").is_none());
        }

        #[test]
        fn fixture_status_item_not_a_git_repo() {
            let not_git = FixtureStatusItem::not_a_git_repo(
                "temporale",
                ".tug/fixtures/temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "expected123",
            );

            let json = serde_json::to_string(&not_git).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["state"], "not-a-git-repo");
            assert!(parsed.get("actual_sha").is_none());
            assert!(parsed.get("error").is_none());
        }

        #[test]
        fn fixture_status_item_error_state() {
            let error = FixtureStatusItem::error(
                "temporale",
                ".tug/fixtures/temporale",
                "https://github.com/tugtool/temporale",
                "v0.1.0",
                "expected123",
                "git command failed: exit code 128",
            );

            let json = serde_json::to_string(&error).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["state"], "error");
            assert!(parsed.get("actual_sha").is_none());
            assert_eq!(parsed["error"], "git command failed: exit code 128");
        }
    }

    mod alias_output_tests {
        use super::*;

        /// AO-01: Serializes to JSON correctly
        #[test]
        fn test_alias_output_serialize() {
            let alias = AliasOutput::new(
                "b",
                "bar",
                "consumer.py",
                3,
                1,
                vec!["module".to_string(), "function:process".to_string()],
                false,
                1.0,
            );

            let json = serde_json::to_string(&alias).unwrap();

            // Verify it produces valid JSON
            let _: serde_json::Value = serde_json::from_str(&json).unwrap();

            // Verify key fields are present
            assert!(json.contains("\"alias_name\":\"b\""));
            assert!(json.contains("\"source_name\":\"bar\""));
            assert!(json.contains("\"file\":\"consumer.py\""));
        }

        /// AO-02: Deserializes from JSON correctly (round-trip)
        #[test]
        fn test_alias_output_deserialize() {
            let original = AliasOutput::new(
                "my_alias",
                "original_name",
                "src/module.py",
                42,
                8,
                vec!["module".to_string(), "class:MyClass".to_string()],
                true,
                0.95,
            );

            // Serialize
            let json = serde_json::to_string(&original).unwrap();

            // Deserialize
            let deserialized: AliasOutput = serde_json::from_str(&json).unwrap();

            // Verify round-trip
            assert_eq!(original, deserialized);
        }

        /// AO-03: All fields present in output
        #[test]
        fn test_alias_output_all_fields() {
            let alias = AliasOutput::new(
                "b",
                "bar",
                "consumer.py",
                3,
                1,
                vec!["module".to_string(), "function:process".to_string()],
                false,
                1.0,
            );

            let json = serde_json::to_string(&alias).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            // Verify all required fields are present
            assert_eq!(parsed["alias_name"], "b");
            assert_eq!(parsed["source_name"], "bar");
            assert_eq!(parsed["file"], "consumer.py");
            assert_eq!(parsed["line"], 3);
            assert_eq!(parsed["col"], 1);
            assert!(parsed["scope"].is_array());
            assert_eq!(parsed["scope"].as_array().unwrap().len(), 2);
            assert_eq!(parsed["scope"][0], "module");
            assert_eq!(parsed["scope"][1], "function:process");
            assert_eq!(parsed["is_import_alias"], false);
            // Check confidence is approximately 1.0 (f32 comparison)
            let confidence = parsed["confidence"].as_f64().unwrap();
            assert!((confidence - 1.0).abs() < 0.001);
        }

        /// AO-04: Schema matches Spec S05
        #[test]
        fn test_alias_output_schema() {
            // Golden test: verify exact JSON structure matches Spec S05
            let alias = AliasOutput::new(
                "b",
                "bar",
                "consumer.py",
                3,
                1,
                vec!["module".to_string(), "function:process".to_string()],
                false,
                1.0,
            );

            let json = serde_json::to_string_pretty(&alias).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            // Per Spec S05, the output should have exactly these fields
            let obj = parsed.as_object().unwrap();

            // Verify field names match spec exactly
            assert!(obj.contains_key("alias_name"), "Missing 'alias_name' field");
            assert!(
                obj.contains_key("source_name"),
                "Missing 'source_name' field"
            );
            assert!(obj.contains_key("file"), "Missing 'file' field");
            assert!(obj.contains_key("line"), "Missing 'line' field");
            assert!(obj.contains_key("col"), "Missing 'col' field");
            assert!(obj.contains_key("scope"), "Missing 'scope' field");
            assert!(
                obj.contains_key("is_import_alias"),
                "Missing 'is_import_alias' field"
            );
            assert!(obj.contains_key("confidence"), "Missing 'confidence' field");

            // Verify no extra fields
            assert_eq!(
                obj.len(),
                8,
                "AliasOutput should have exactly 8 fields per Spec S05"
            );

            // Verify types
            assert!(obj["alias_name"].is_string());
            assert!(obj["source_name"].is_string());
            assert!(obj["file"].is_string());
            assert!(obj["line"].is_number());
            assert!(obj["col"].is_number());
            assert!(obj["scope"].is_array());
            assert!(obj["is_import_alias"].is_boolean());
            assert!(obj["confidence"].is_number());
        }

        #[test]
        fn test_alias_output_empty_scope() {
            let alias = AliasOutput::new("x", "y", "test.py", 1, 1, vec![], false, 1.0);

            let json = serde_json::to_string(&alias).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["scope"].as_array().unwrap().len(), 0);
        }

        #[test]
        fn test_alias_output_import_alias_true() {
            let alias = AliasOutput::new(
                "np",
                "numpy",
                "data.py",
                1,
                1,
                vec!["module".to_string()],
                true, // is_import_alias
                1.0,
            );

            let json = serde_json::to_string(&alias).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["is_import_alias"], true);
        }

        #[test]
        fn test_alias_output_low_confidence() {
            let alias = AliasOutput::new(
                "maybe_alias",
                "complex_expr",
                "uncertain.py",
                10,
                5,
                vec!["module".to_string()],
                false,
                0.5, // lower confidence
            );

            let json = serde_json::to_string(&alias).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            let confidence = parsed["confidence"].as_f64().unwrap();
            assert!((confidence - 0.5).abs() < 0.001);
        }
    }
}
