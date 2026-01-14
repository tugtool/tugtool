//! JSON output types and serialization for CLI and MCP responses.
//!
//! This module defines the exact JSON schema for all CLI and MCP outputs per
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
//! 1. **Always JSON:** All CLI output is valid JSON (no mixed text/JSON)
//! 2. **Status first:** Every response has `status` as first field
//! 3. **Deterministic:** Same input -> same output (field order, array ordering)
//! 4. **Nullable vs absent:** Explicit `null` for "no value"; absent field means "not applicable"
//! 5. **Versioned:** Schema version in response enables forward compatibility

use std::io::{self, Write};

use serde::{Deserialize, Serialize, Serializer};

use crate::error::{TugError, OutputErrorCode};

// Re-export types from patch module for convenience
pub use crate::patch::{MaterializedPatch as Patch, OutputEdit as Edit, Span};

/// Current schema version for all responses.
pub const SCHEMA_VERSION: &str = "1";

// ============================================================================
// Common Types (26.0.7 spec)
// ============================================================================

/// Location in a source file.
///
/// Per 26.0.7 spec #type-location:
/// - `file`: Workspace-relative path (required)
/// - `line`: 1-indexed line number (required)
/// - `col`: 1-indexed column, UTF-8 bytes (required)
/// - `byte_start`: Byte offset from file start (optional)
/// - `byte_end`: Byte offset end, exclusive (optional)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Location {
    /// File path (workspace-relative).
    pub file: String,
    /// Line number (1-indexed).
    pub line: u32,
    /// Column number (1-indexed, UTF-8 bytes).
    pub col: u32,
    /// Byte offset from file start (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_start: Option<u64>,
    /// Byte offset end, exclusive (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_end: Option<u64>,
}

impl Location {
    /// Create a new location without byte offsets.
    pub fn new(file: impl Into<String>, line: u32, col: u32) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: None,
            byte_end: None,
        }
    }

    /// Create a location with byte start offset (byte_end computed from name length).
    pub fn with_byte_start(file: impl Into<String>, line: u32, col: u32, byte_start: u64) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: Some(byte_start),
            byte_end: None,
        }
    }

    /// Create a location with full byte span.
    pub fn with_span(
        file: impl Into<String>,
        line: u32,
        col: u32,
        byte_start: u64,
        byte_end: u64,
    ) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: Some(byte_start),
            byte_end: Some(byte_end),
        }
    }

    /// Parse a location from "path:line:col" format.
    ///
    /// This parsing is robust against paths containing colons (e.g., Windows paths).
    pub fn parse(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.rsplitn(3, ':').collect();
        if parts.len() != 3 {
            return None;
        }
        let col: u32 = parts[0].parse().ok()?;
        let line: u32 = parts[1].parse().ok()?;
        let file = parts[2].to_string();
        Some(Location::new(file, line, col))
    }

    /// Comparison key for deterministic sorting: (file, line, col).
    fn sort_key(&self) -> (&str, u32, u32) {
        (&self.file, self.line, self.col)
    }
}

impl PartialOrd for Location {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Location {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.sort_key().cmp(&other.sort_key())
    }
}

/// Symbol information for JSON output.
///
/// Named `SymbolInfo` to distinguish from `facts::Symbol` (internal graph type).
/// The "Info" suffix indicates this is an information carrier for serialization.
///
/// Per 26.0.7 spec #type-symbol:
/// - `id`: Stable symbol ID within snapshot (required)
/// - `name`: Symbol name (required)
/// - `kind`: One of: function, class, method, variable, parameter, module, import (required)
/// - `location`: Definition location (required)
/// - `container`: Parent symbol ID for methods in classes (optional)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    /// Symbol ID (stable within snapshot).
    pub id: String,
    /// Symbol name.
    pub name: String,
    /// Symbol kind (function, class, method, variable, parameter, module, import).
    pub kind: String,
    /// Definition location.
    pub location: Location,
    /// Parent symbol ID (for methods in classes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

impl SymbolInfo {
    /// Create a Symbol from internal FactsStore types.
    ///
    /// This is the primary constructor used during rename analysis.
    /// The `container` field is populated when the symbol is a method inside a class.
    #[allow(clippy::too_many_arguments)]
    pub fn from_facts(
        symbol_id: &str,
        name: &str,
        kind: &str,
        file: &str,
        line: u32,
        col: u32,
        byte_start: u64,
        byte_end: u64,
        container: Option<String>,
    ) -> Self {
        SymbolInfo {
            id: symbol_id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            location: Location::with_span(file, line, col, byte_start, byte_end),
            container,
        }
    }
}

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
                (Some(serde_json::json!({ "candidates": candidates_json })), None)
            }
            TugError::InvalidArguments { details, .. } => (details.clone(), None),
            TugError::FileNotFound { path } => {
                (Some(serde_json::json!({ "path": path })), None)
            }
            TugError::ApplyError { file, .. } => {
                let details = file
                    .as_ref()
                    .map(|f| serde_json::json!({ "file": f }));
                (details, None)
            }
            TugError::VerificationFailed { mode, output, exit_code } => {
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
    sorted_edits.sort_by(|a, b| {
        match a.file.cmp(&b.file) {
            std::cmp::Ordering::Equal => a.span.start.cmp(&b.span.start),
            other => other,
        }
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
/// This is the single output path for both CLI and MCP, ensuring consistency.
/// The output is deterministic: same input produces identical bytes.
pub fn emit_response<T: Serialize>(response: &T, writer: &mut impl Write) -> io::Result<()> {
    // Use serde_json's pretty printer
    let json = serde_json::to_string_pretty(response)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    writeln!(writer, "{}", json)
}

/// Emit a response as compact JSON (single line) to a writer.
pub fn emit_response_compact<T: Serialize>(response: &T, writer: &mut impl Write) -> io::Result<()> {
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
        fn analyze_impact_references_sorted() {
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
            assert!(parsed["error"]["message"].as_str().unwrap().contains("no symbol found"));
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
            let v = Verification::passed("syntax", vec![
                VerificationCheck::passed("compileall", Some(150)),
            ]);
            let json = serde_json::to_string(&v).unwrap();
            assert!(json.contains("\"status\":\"passed\""));
            assert!(json.contains("\"mode\":\"syntax\""));
        }

        #[test]
        fn verification_failed() {
            let v = Verification::failed("syntax", vec![
                VerificationCheck::failed("compileall", "SyntaxError: invalid syntax"),
            ]);
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
}
