//! Patch IR: Edit, Anchor, PatchSet for atomic refactoring transactions.
//!
//! This module implements the core patch infrastructure for tug:
//! - Anchored edits with preconditions
//! - Conflict detection (overlapping spans, ambiguous anchors)
//! - Atomic apply semantics (all-or-nothing)
//! - Patch materialization (unified diff, JSON)

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;

use crate::text::byte_offset_to_position;

/// Hash type for content verification (SHA-256, stored as hex string for JSON compatibility).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ContentHash(pub String);

impl ContentHash {
    /// Compute SHA-256 hash of the given bytes, returning hex-encoded string.
    pub fn compute(data: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        ContentHash(hex::encode(result))
    }

    /// Create from an existing hex string without validation.
    ///
    /// # Warning
    /// This method does not validate that the input is valid hex or has the
    /// expected length for a SHA-256 hash. Use only when the input is known
    /// to be valid (e.g., from a trusted source or in tests).
    pub fn from_hex_unchecked(hex: &str) -> Self {
        ContentHash(hex.to_string())
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ============================================================================
// Core Types
// ============================================================================

/// Identifies the exact snapshot this patch is based on.
///
/// A snapshot ID is stable within a session and represents a specific point-in-time
/// view of the workspace. Different file contents produce different snapshot IDs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WorkspaceSnapshotId(pub String);

impl WorkspaceSnapshotId {
    /// Create a new snapshot ID with the given identifier.
    pub fn new(id: impl Into<String>) -> Self {
        WorkspaceSnapshotId(id.into())
    }
}

impl fmt::Display for WorkspaceSnapshotId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Stable file identifier within a snapshot.
///
/// Maps to a concrete `path` and `content_hash`. Stable within a snapshot;
/// may differ across snapshots if file content changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct FileId(pub u32);

impl FileId {
    /// Create a new file ID.
    pub fn new(id: u32) -> Self {
        FileId(id)
    }
}

impl fmt::Display for FileId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "file_{}", self.0)
    }
}

/// Byte offsets into file content (snapshot-scoped).
///
/// Spans are half-open intervals: `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Span {
    /// Start byte offset (inclusive).
    pub start: u64,
    /// End byte offset (exclusive).
    pub end: u64,
}

impl Span {
    /// Create a new span.
    ///
    /// # Panics
    /// Panics if `start > end`.
    pub fn new(start: u64, end: u64) -> Self {
        assert!(
            start <= end,
            "Span start ({}) must be <= end ({})",
            start,
            end
        );
        Span { start, end }
    }

    /// Length of the span in bytes.
    pub fn len(&self) -> u64 {
        self.end.saturating_sub(self.start)
    }

    /// Check if span is empty.
    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    /// Check if this span overlaps with another.
    ///
    /// Two spans overlap if they share any byte positions.
    /// Adjacent spans (one ends where another starts) do NOT overlap.
    pub fn overlaps(&self, other: &Span) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// Check if this span contains another span entirely.
    pub fn contains(&self, other: &Span) -> bool {
        self.start <= other.start && other.end <= self.end
    }
}

impl fmt::Display for Span {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}, {})", self.start, self.end)
    }
}

// ============================================================================
// Anchor Model
// ============================================================================

/// How an edit finds and validates its target location.
///
/// Anchors provide the connection between a logical edit intent and the
/// actual byte positions in a file. They include verification data to
/// ensure the edit applies to the expected content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Anchor {
    /// Exact span with hash verification (strongest guarantee).
    ///
    /// The edit will only apply if the bytes at `span` hash to `expected_before_hash`.
    SpanExact {
        /// The exact byte range to edit.
        span: Span,
        /// SHA-256 hash of the bytes in `span` before the edit.
        expected_before_hash: ContentHash,
    },

    /// Span with context for fallback matching (when spans may have shifted).
    ///
    /// Used when the exact position may have moved due to prior edits, but
    /// we can locate the target using surrounding context.
    SpanWithContext {
        /// Best known location (may be approximate after prior edits).
        approx_span: Span,
        /// Context bytes before the target (bounded length, typically 32-256 bytes).
        prefix_context: String,
        /// Context bytes after the target (bounded length).
        suffix_context: String,
        /// Optional hash of the target bytes (for extra verification).
        expected_before_hash: Option<ContentHash>,
        /// Maximum bytes to search in each direction from `approx_span.start`.
        search_window: u32,
    },
}

impl Anchor {
    /// Create a SpanExact anchor.
    pub fn span_exact(span: Span, content: &[u8]) -> Self {
        let hash = ContentHash::compute(content);
        Anchor::SpanExact {
            span,
            expected_before_hash: hash,
        }
    }

    /// Create a SpanWithContext anchor.
    ///
    /// # Panics
    /// Panics if both `prefix` and `suffix` are empty AND `expected_hash` is `None`.
    /// At least one of these must be provided for reliable anchor resolution.
    pub fn span_with_context(
        approx_span: Span,
        prefix: impl Into<String>,
        suffix: impl Into<String>,
        expected_hash: Option<ContentHash>,
        search_window: u32,
    ) -> Self {
        let prefix_context = prefix.into();
        let suffix_context = suffix.into();

        // Validate that we have some way to verify the anchor
        assert!(
            !prefix_context.is_empty() || !suffix_context.is_empty() || expected_hash.is_some(),
            "SpanWithContext requires at least one of: non-empty prefix, non-empty suffix, or expected_hash"
        );

        Anchor::SpanWithContext {
            approx_span,
            prefix_context,
            suffix_context,
            expected_before_hash: expected_hash,
            search_window,
        }
    }

    /// Get the primary span for this anchor (exact or approximate).
    pub fn span(&self) -> Span {
        match self {
            Anchor::SpanExact { span, .. } => *span,
            Anchor::SpanWithContext { approx_span, .. } => *approx_span,
        }
    }
}

/// Result of attempting to resolve an anchor against file content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnchorResolution {
    /// Anchor resolved successfully to a specific span.
    Resolved(Span),
    /// Anchor hash mismatch - content at span doesn't match expected hash.
    HashMismatch {
        span: Span,
        expected: ContentHash,
        actual: ContentHash,
    },
    /// Context search found no matches.
    NotFound { approx_span: Span },
    /// Context search found multiple matches (ambiguous).
    Ambiguous { matches: Vec<Span> },
    /// Span is out of bounds for the file content.
    OutOfBounds { span: Span, file_len: u64 },
}

impl Anchor {
    /// Resolve this anchor against the given file content.
    ///
    /// Returns the resolved span or an error describing why resolution failed.
    pub fn resolve(&self, content: &[u8]) -> AnchorResolution {
        match self {
            Anchor::SpanExact {
                span,
                expected_before_hash,
            } => {
                // Check bounds
                if span.end as usize > content.len() {
                    return AnchorResolution::OutOfBounds {
                        span: *span,
                        file_len: content.len() as u64,
                    };
                }

                // Verify hash
                let slice = &content[span.start as usize..span.end as usize];
                let actual_hash = ContentHash::compute(slice);
                if &actual_hash != expected_before_hash {
                    return AnchorResolution::HashMismatch {
                        span: *span,
                        expected: expected_before_hash.clone(),
                        actual: actual_hash,
                    };
                }

                AnchorResolution::Resolved(*span)
            }

            Anchor::SpanWithContext {
                approx_span,
                prefix_context,
                suffix_context,
                expected_before_hash,
                search_window,
            } => {
                // Build the pattern to search for: prefix + target + suffix
                // We need to find where prefix ends and suffix begins

                let target_len = approx_span.len() as usize;
                let prefix_bytes = prefix_context.as_bytes();
                let suffix_bytes = suffix_context.as_bytes();

                // Calculate search bounds
                let search_start =
                    (approx_span.start as usize).saturating_sub(*search_window as usize);
                let search_end = std::cmp::min(
                    (approx_span.end as usize).saturating_add(*search_window as usize),
                    content.len(),
                );

                if search_end <= search_start {
                    return AnchorResolution::NotFound {
                        approx_span: *approx_span,
                    };
                }

                let search_region = &content[search_start..search_end];
                let mut matches = Vec::new();

                // Search for occurrences of prefix followed by target_len bytes followed by suffix
                // Use find() for efficient substring search when we have a prefix
                let mut search_pos = 0;
                while search_pos < search_region.len() {
                    // Find next occurrence of prefix (or start from search_pos if no prefix)
                    let prefix_pos = if prefix_bytes.is_empty() {
                        Some(search_pos)
                    } else {
                        // Search for prefix starting from search_pos
                        let remaining = &search_region[search_pos..];
                        remaining
                            .windows(prefix_bytes.len())
                            .position(|w| w == prefix_bytes)
                            .map(|p| search_pos + p)
                    };

                    let Some(i) = prefix_pos else {
                        break; // No more prefix matches
                    };

                    // Calculate where the target would be
                    let target_start = i + prefix_bytes.len();
                    let target_end = target_start + target_len;

                    if target_end > search_region.len() {
                        break; // Can't fit target + suffix in remaining space
                    }

                    // Check if suffix matches after target
                    let suffix_start = target_end;
                    let suffix_end = suffix_start + suffix_bytes.len();

                    if suffix_end > search_region.len() {
                        search_pos = i + 1;
                        continue;
                    }

                    if !suffix_bytes.is_empty()
                        && &search_region[suffix_start..suffix_end] != suffix_bytes
                    {
                        search_pos = i + 1;
                        continue;
                    }

                    // Found a potential match
                    let actual_start = (search_start + target_start) as u64;
                    let actual_end = (search_start + target_end) as u64;
                    let found_span = Span::new(actual_start, actual_end);

                    // If we have an expected hash, verify it
                    if let Some(expected_hash) = expected_before_hash {
                        let target_bytes = &content[actual_start as usize..actual_end as usize];
                        let actual_hash = ContentHash::compute(target_bytes);
                        if &actual_hash != expected_hash {
                            search_pos = i + 1;
                            continue; // Hash mismatch, not a valid match
                        }
                    }

                    // Check if this match overlaps with a previous match
                    // If so, skip it (keep only the first of overlapping matches)
                    let overlaps_existing = matches
                        .iter()
                        .any(|existing: &Span| found_span.overlaps(existing));

                    if !overlaps_existing {
                        matches.push(found_span);
                    }

                    // Move past the current prefix to find next non-overlapping match
                    // Skip to after the current target to avoid finding overlapping matches
                    search_pos = target_end;
                }

                match matches.len() {
                    0 => AnchorResolution::NotFound {
                        approx_span: *approx_span,
                    },
                    1 => AnchorResolution::Resolved(matches[0]),
                    _ => AnchorResolution::Ambiguous { matches },
                }
            }
        }
    }
}

// ============================================================================
// Preconditions
// ============================================================================

/// Checks that must pass before any edit can apply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Precondition {
    /// Snapshot ID must match the session's current base snapshot.
    SnapshotIsCurrent(WorkspaceSnapshotId),

    /// File content hash must match.
    FileHashMatches {
        file_id: FileId,
        content_hash: ContentHash,
    },

    /// Edits in a file must not overlap once ordered.
    NoOverlaps,
}

// ============================================================================
// Conflict Detection
// ============================================================================

/// A detected overlap or invalidation that prevents apply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Conflict {
    /// Two edits have overlapping spans in the same file.
    OverlappingSpans {
        file_id: FileId,
        edit1_span: Span,
        edit2_span: Span,
    },

    /// An anchor resolved to zero matches.
    AnchorNotFound { file_id: FileId, anchor: Anchor },

    /// An anchor resolved to multiple matches.
    AnchorAmbiguous {
        file_id: FileId,
        anchor: Anchor,
        match_count: usize,
    },

    /// Anchor hash mismatch.
    AnchorHashMismatch {
        file_id: FileId,
        span: Span,
        expected: ContentHash,
        actual: ContentHash,
    },

    /// Precondition failed.
    PreconditionFailed {
        precondition: Precondition,
        reason: String,
    },

    /// Span is out of bounds for the file.
    SpanOutOfBounds {
        file_id: FileId,
        span: Span,
        file_len: u64,
    },

    /// File not found in context.
    FileMissing { file_id: FileId },

    /// IO error during patch application (e.g., file write failure).
    IoError { file_path: String, message: String },
}

// ============================================================================
// Edit Operations
// ============================================================================

/// The kind of edit operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditKind {
    /// Insert text at `anchor.span.start`.
    Insert,
    /// Delete the bytes in `anchor.span`.
    Delete,
    /// Replace the bytes in `anchor.span` with new text.
    Replace,
}

/// Optional labels for provenance tracking.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditLabels {
    /// The refactor operation that generated this edit.
    pub refactor_op_id: Option<String>,
    /// The symbol this edit relates to.
    pub symbol_id: Option<String>,
    /// Human-readable reason for the edit.
    pub reason: Option<String>,
}

/// A single atomic text change anchored in one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edit {
    /// Stable identifier for ordering.
    pub id: u32,
    /// The file this edit applies to.
    pub file_id: FileId,
    /// The kind of operation.
    pub kind: EditKind,
    /// How to find/verify the target location.
    pub anchor: Anchor,
    /// The new text (empty for Delete).
    pub text: String,
    /// Optional provenance labels.
    pub labels: EditLabels,
}

impl Edit {
    /// Create an Insert edit.
    ///
    /// # Panics
    /// Panics if the anchor's span is not empty (i.e., `span.start != span.end`).
    /// For Insert operations, only the insertion point (`span.start`) is used.
    pub fn insert(id: u32, file_id: FileId, anchor: Anchor, text: impl Into<String>) -> Self {
        let span = anchor.span();
        assert!(
            span.is_empty(),
            "Insert anchor span must be empty (start == end), got {:?}",
            span
        );
        Edit {
            id,
            file_id,
            kind: EditKind::Insert,
            anchor,
            text: text.into(),
            labels: EditLabels::default(),
        }
    }

    /// Create a Delete edit.
    ///
    /// # Panics
    /// Panics if the anchor's span is empty (i.e., `span.start == span.end`).
    /// Delete operations must specify a non-empty range to delete.
    pub fn delete(id: u32, file_id: FileId, anchor: Anchor) -> Self {
        let span = anchor.span();
        assert!(
            !span.is_empty(),
            "Delete anchor span must be non-empty (start != end), got {:?}",
            span
        );
        Edit {
            id,
            file_id,
            kind: EditKind::Delete,
            anchor,
            text: String::new(),
            labels: EditLabels::default(),
        }
    }

    /// Create a Replace edit.
    pub fn replace(id: u32, file_id: FileId, anchor: Anchor, text: impl Into<String>) -> Self {
        Edit {
            id,
            file_id,
            kind: EditKind::Replace,
            anchor,
            text: text.into(),
            labels: EditLabels::default(),
        }
    }

    /// Add labels to this edit.
    pub fn with_labels(mut self, labels: EditLabels) -> Self {
        self.labels = labels;
        self
    }

    /// Get the anchor's span.
    pub fn span(&self) -> Span {
        self.anchor.span()
    }
}

// ============================================================================
// PatchSet
// ============================================================================

/// An ordered set of edits with metadata, applied atomically.
///
/// A PatchSet represents a complete, self-contained set of changes that
/// either all succeed or all fail. It includes preconditions that must
/// be verified before any edits are applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchSet {
    /// The snapshot this patch is based on.
    pub snapshot_id: WorkspaceSnapshotId,

    /// Preconditions that must pass before applying.
    pub preconditions: Vec<Precondition>,

    /// The edits to apply, in deterministic order.
    pub edits: Vec<Edit>,

    /// Mapping from FileId to file path (for materialization).
    pub file_paths: HashMap<FileId, String>,
}

impl PatchSet {
    /// Create a new empty PatchSet for the given snapshot.
    pub fn new(snapshot_id: WorkspaceSnapshotId) -> Self {
        PatchSet {
            snapshot_id,
            preconditions: Vec::new(),
            edits: Vec::new(),
            file_paths: HashMap::new(),
        }
    }

    /// Add a precondition.
    pub fn with_precondition(mut self, precondition: Precondition) -> Self {
        self.preconditions.push(precondition);
        self
    }

    /// Add an edit.
    pub fn with_edit(mut self, edit: Edit) -> Self {
        self.edits.push(edit);
        self
    }

    /// Register a file path mapping.
    pub fn with_file_path(mut self, file_id: FileId, path: impl Into<String>) -> Self {
        self.file_paths.insert(file_id, path.into());
        self
    }

    /// Check if this PatchSet contains any edits.
    ///
    /// This allows distinguishing between:
    /// - "No edits needed" (refactor found nothing to change)
    /// - "All edits filtered out" (edits were generated but removed by filtering)
    ///
    /// An empty PatchSet applied successfully is a valid no-op, but callers may
    /// want to warn users or handle this case differently.
    pub fn has_edits(&self) -> bool {
        !self.edits.is_empty()
    }

    /// Get the number of edits in this PatchSet.
    pub fn edit_count(&self) -> usize {
        self.edits.len()
    }

    /// Get the number of unique files affected by edits in this PatchSet.
    pub fn file_count(&self) -> usize {
        self.edits
            .iter()
            .map(|e| &e.file_id)
            .collect::<std::collections::HashSet<_>>()
            .len()
    }

    /// Sort edits in deterministic order: by file path, then by span start, then by edit ID.
    pub fn sort_edits(&mut self) {
        self.edits.sort_by(|a, b| {
            // First by file path
            let path_a = self.file_paths.get(&a.file_id).map(String::as_str);
            let path_b = self.file_paths.get(&b.file_id).map(String::as_str);
            match path_a.cmp(&path_b) {
                std::cmp::Ordering::Equal => {}
                other => return other,
            }

            // Then by span start
            match a.span().start.cmp(&b.span().start) {
                std::cmp::Ordering::Equal => {}
                other => return other,
            }

            // Finally by edit ID for stability
            a.id.cmp(&b.id)
        });
    }

    /// Detect conflicts within this PatchSet.
    ///
    /// Returns a list of all detected conflicts. An empty list means no conflicts.
    #[must_use]
    pub fn detect_conflicts(&self) -> Vec<Conflict> {
        let mut conflicts = Vec::new();

        // Group edits by file
        let mut edits_by_file: HashMap<&FileId, Vec<&Edit>> = HashMap::new();
        for edit in &self.edits {
            edits_by_file.entry(&edit.file_id).or_default().push(edit);
        }

        // Check for overlapping spans within each file
        for (file_id, edits) in edits_by_file {
            for i in 0..edits.len() {
                for j in (i + 1)..edits.len() {
                    let span_i = edits[i].span();
                    let span_j = edits[j].span();

                    if span_i.overlaps(&span_j) {
                        conflicts.push(Conflict::OverlappingSpans {
                            file_id: *file_id,
                            edit1_span: span_i,
                            edit2_span: span_j,
                        });
                    }
                }
            }
        }

        conflicts
    }

    /// Check if precondition NoOverlaps would be satisfied.
    pub fn has_no_overlaps(&self) -> bool {
        self.detect_conflicts().is_empty()
    }
}

// ============================================================================
// Atomic Apply
// ============================================================================

/// Result of attempting to apply a PatchSet.
#[derive(Debug, Clone)]
pub enum ApplyResult {
    /// All edits applied successfully.
    Success {
        /// The new content for each modified file.
        modified_files: HashMap<FileId, Vec<u8>>,
    },

    /// Apply failed due to conflicts or precondition failures.
    Failed {
        /// The conflicts/failures that prevented apply.
        conflicts: Vec<Conflict>,
    },
}

/// Context for applying a PatchSet.
pub struct ApplyContext {
    /// Current snapshot ID.
    pub snapshot_id: WorkspaceSnapshotId,
    /// File contents, keyed by FileId.
    pub file_contents: HashMap<FileId, Vec<u8>>,
    /// File content hashes, keyed by FileId.
    pub file_hashes: HashMap<FileId, ContentHash>,
}

impl PatchSet {
    /// Apply this PatchSet atomically.
    ///
    /// Either all edits apply successfully, or none do (no partial application).
    ///
    /// # Ordering
    ///
    /// Edits are applied in reverse offset order within each file to preserve
    /// span validity. The overall file order is deterministic (sorted by path).
    #[must_use]
    pub fn apply(&self, ctx: &ApplyContext) -> ApplyResult {
        let mut conflicts = Vec::new();

        // Check preconditions
        for precondition in &self.preconditions {
            match precondition {
                Precondition::SnapshotIsCurrent(expected) => {
                    if expected != &ctx.snapshot_id {
                        conflicts.push(Conflict::PreconditionFailed {
                            precondition: precondition.clone(),
                            reason: format!(
                                "Snapshot mismatch: expected {}, got {}",
                                expected, ctx.snapshot_id
                            ),
                        });
                    }
                }
                Precondition::FileHashMatches {
                    file_id,
                    content_hash,
                } => {
                    if let Some(actual) = ctx.file_hashes.get(file_id) {
                        if actual != content_hash {
                            conflicts.push(Conflict::PreconditionFailed {
                                precondition: precondition.clone(),
                                reason: format!(
                                    "File hash mismatch for {:?}: expected {}, got {}",
                                    file_id, content_hash, actual
                                ),
                            });
                        }
                    } else {
                        conflicts.push(Conflict::FileMissing { file_id: *file_id });
                    }
                }
                Precondition::NoOverlaps => {
                    conflicts.extend(self.detect_conflicts());
                }
            }
        }

        // Resolve all anchors and check for anchor-related conflicts
        let mut resolved_edits: Vec<(FileId, Span, &Edit)> = Vec::new();

        for edit in &self.edits {
            let content = match ctx.file_contents.get(&edit.file_id) {
                Some(c) => c,
                None => {
                    conflicts.push(Conflict::FileMissing {
                        file_id: edit.file_id,
                    });
                    continue;
                }
            };

            match edit.anchor.resolve(content) {
                AnchorResolution::Resolved(span) => {
                    resolved_edits.push((edit.file_id, span, edit));
                }
                AnchorResolution::HashMismatch {
                    span,
                    expected,
                    actual,
                } => {
                    conflicts.push(Conflict::AnchorHashMismatch {
                        file_id: edit.file_id,
                        span,
                        expected,
                        actual,
                    });
                }
                AnchorResolution::NotFound { .. } => {
                    conflicts.push(Conflict::AnchorNotFound {
                        file_id: edit.file_id,
                        anchor: edit.anchor.clone(),
                    });
                }
                AnchorResolution::Ambiguous { matches } => {
                    conflicts.push(Conflict::AnchorAmbiguous {
                        file_id: edit.file_id,
                        anchor: edit.anchor.clone(),
                        match_count: matches.len(),
                    });
                }
                AnchorResolution::OutOfBounds { span, file_len } => {
                    conflicts.push(Conflict::SpanOutOfBounds {
                        file_id: edit.file_id,
                        span,
                        file_len,
                    });
                }
            }
        }

        // If any conflicts, fail without modifying anything
        if !conflicts.is_empty() {
            return ApplyResult::Failed { conflicts };
        }

        // Group resolved edits by file
        let mut edits_by_file: HashMap<FileId, Vec<(Span, &Edit)>> = HashMap::new();
        for (file_id, span, edit) in resolved_edits {
            edits_by_file.entry(file_id).or_default().push((span, edit));
        }

        // Apply edits to each file
        let mut modified_files = HashMap::new();

        for (file_id, mut file_edits) in edits_by_file {
            let mut content = ctx.file_contents.get(&file_id).unwrap().clone();

            // Sort by span start descending (apply from end to start to preserve offsets)
            file_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

            for (span, edit) in file_edits {
                let start = span.start as usize;
                let end = span.end as usize;

                match edit.kind {
                    EditKind::Insert => {
                        // Insert at start position
                        let text_bytes = edit.text.as_bytes();
                        content.splice(start..start, text_bytes.iter().copied());
                    }
                    EditKind::Delete => {
                        // Delete the span
                        content.drain(start..end);
                    }
                    EditKind::Replace => {
                        // Replace the span with new text
                        let text_bytes = edit.text.as_bytes();
                        content.splice(start..end, text_bytes.iter().copied());
                    }
                }
            }

            modified_files.insert(file_id, content);
        }

        ApplyResult::Success { modified_files }
    }
}

// ============================================================================
// Patch Materialization
// ============================================================================

/// A single edit as it appears in output (for JSON serialization).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputEdit {
    /// Workspace-relative file path.
    pub file: String,
    /// Byte range being replaced.
    pub span: Span,
    /// Original text (for verification).
    pub old_text: String,
    /// Replacement text.
    pub new_text: String,
    /// 1-indexed line number (for display).
    pub line: u32,
    /// 1-indexed column (for display).
    pub col: u32,
}

/// Materialized patch output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterializedPatch {
    /// Individual edits (ordered by file, then span.start).
    pub edits: Vec<OutputEdit>,
    /// Standard unified diff format.
    pub unified_diff: String,
}

impl PatchSet {
    /// Materialize this PatchSet to output format.
    ///
    /// Requires file contents to compute old_text and line/col positions.
    pub fn materialize(&self, file_contents: &HashMap<FileId, Vec<u8>>) -> MaterializedPatch {
        let mut output_edits = Vec::new();
        let mut diff_sections: HashMap<String, Vec<(Span, String, String)>> = HashMap::new();

        // Sort edits for deterministic output
        let mut sorted_edits = self.edits.clone();
        sorted_edits.sort_by(|a, b| {
            let path_a = self.file_paths.get(&a.file_id).map(String::as_str);
            let path_b = self.file_paths.get(&b.file_id).map(String::as_str);
            match path_a.cmp(&path_b) {
                std::cmp::Ordering::Equal => a.span().start.cmp(&b.span().start),
                other => other,
            }
        });

        for edit in &sorted_edits {
            let path = self
                .file_paths
                .get(&edit.file_id)
                .cloned()
                .unwrap_or_else(|| format!("file_{}", edit.file_id.0));

            let content = file_contents.get(&edit.file_id);
            let span = edit.span();

            let (old_text, line, col) = if let Some(content) = content {
                let old_bytes = if (span.end as usize) <= content.len() {
                    &content[span.start as usize..span.end as usize]
                } else {
                    &[]
                };
                let old_text = String::from_utf8_lossy(old_bytes).to_string();

                // Calculate line and column
                let (line, col) = byte_offset_to_position(content, span.start);

                (old_text, line, col)
            } else {
                (String::new(), 1, 1)
            };

            let new_text = match edit.kind {
                EditKind::Delete => String::new(),
                _ => edit.text.clone(),
            };

            output_edits.push(OutputEdit {
                file: path.clone(),
                span,
                old_text: old_text.clone(),
                new_text: new_text.clone(),
                line,
                col,
            });

            // Collect for unified diff
            diff_sections
                .entry(path)
                .or_default()
                .push((span, old_text, new_text));
        }

        // Generate unified diff
        let unified_diff = generate_unified_diff(&diff_sections, file_contents, &self.file_paths);

        MaterializedPatch {
            edits: output_edits,
            unified_diff,
        }
    }
}

/// Generate a unified diff from the collected edits.
fn generate_unified_diff(
    diff_sections: &HashMap<String, Vec<(Span, String, String)>>,
    file_contents: &HashMap<FileId, Vec<u8>>,
    file_paths: &HashMap<FileId, String>,
) -> String {
    let mut diff = String::new();

    // Reverse lookup: path -> file_id
    let path_to_id: HashMap<&str, &FileId> = file_paths
        .iter()
        .map(|(id, path)| (path.as_str(), id))
        .collect();

    // Sort paths for deterministic output
    let mut paths: Vec<&String> = diff_sections.keys().collect();
    paths.sort();

    for path in paths {
        let edits = &diff_sections[path];
        if edits.is_empty() {
            continue;
        }

        // Get file content
        let content = if let Some(file_id) = path_to_id.get(path.as_str()) {
            file_contents
                .get(*file_id)
                .map(|v| String::from_utf8_lossy(v).to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        diff.push_str(&format!("--- a/{}\n", path));
        diff.push_str(&format!("+++ b/{}\n", path));

        // Generate hunks for each edit
        // NOTE: This is a simplified unified diff generator that creates one hunk per edit.
        // For proper context lines and hunk coalescing, consider using the `similar` crate.
        for (span, old_text, new_text) in edits {
            let (line, _) = byte_offset_to_position(content.as_bytes(), span.start);

            // Count actual lines (0 for empty text is valid in unified diff format)
            let old_lines: Vec<&str> = if old_text.is_empty() {
                vec![]
            } else {
                old_text.lines().collect()
            };
            let new_lines: Vec<&str> = if new_text.is_empty() {
                vec![]
            } else {
                new_text.lines().collect()
            };

            // Track if text ends without newline (for "\ No newline at end of file" marker)
            let old_missing_newline = !old_text.is_empty() && !old_text.ends_with('\n');
            let new_missing_newline = !new_text.is_empty() && !new_text.ends_with('\n');

            let old_count = old_lines.len();
            let new_count = new_lines.len();

            diff.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                line, old_count, line, new_count
            ));

            for (i, old_line) in old_lines.iter().enumerate() {
                diff.push_str(&format!("-{}\n", old_line));
                // Add "no newline" marker after last line if original text didn't end with newline
                if old_missing_newline && i == old_lines.len() - 1 {
                    diff.push_str("\\ No newline at end of file\n");
                }
            }
            for (i, new_line) in new_lines.iter().enumerate() {
                diff.push_str(&format!("+{}\n", new_line));
                // Add "no newline" marker after last line if new text doesn't end with newline
                if new_missing_newline && i == new_lines.len() - 1 {
                    diff.push_str("\\ No newline at end of file\n");
                }
            }
        }
    }

    diff
}

// ============================================================================
// Preview Result
// ============================================================================

/// Result of previewing a PatchSet (without applying).
#[derive(Debug, Clone)]
pub struct PreviewResult {
    /// Resolved spans for each edit.
    pub resolved_edits: Vec<ResolvedEdit>,
    /// Conflicts detected during preview.
    pub conflicts: Vec<Conflict>,
    /// Whether the preview is valid (no conflicts).
    pub is_valid: bool,
}

/// An edit with its anchor resolved.
#[derive(Debug, Clone)]
pub struct ResolvedEdit {
    /// The original edit.
    pub edit_id: u32,
    /// The file ID.
    pub file_id: FileId,
    /// The resolved span.
    pub resolved_span: Span,
    /// The file path.
    pub file_path: String,
}

impl PatchSet {
    /// Preview this PatchSet without applying it.
    ///
    /// Resolves all anchors and reports any conflicts.
    #[must_use]
    pub fn preview(&self, file_contents: &HashMap<FileId, Vec<u8>>) -> PreviewResult {
        let mut resolved_edits = Vec::new();
        let mut conflicts = Vec::new();

        // Resolve all anchors
        for edit in &self.edits {
            let content = match file_contents.get(&edit.file_id) {
                Some(c) => c,
                None => {
                    conflicts.push(Conflict::PreconditionFailed {
                        precondition: Precondition::FileHashMatches {
                            file_id: edit.file_id,
                            content_hash: ContentHash::from_hex_unchecked(""),
                        },
                        reason: format!("File {:?} not found", edit.file_id),
                    });
                    continue;
                }
            };

            let file_path = self
                .file_paths
                .get(&edit.file_id)
                .cloned()
                .unwrap_or_else(|| format!("file_{}", edit.file_id.0));

            match edit.anchor.resolve(content) {
                AnchorResolution::Resolved(span) => {
                    resolved_edits.push(ResolvedEdit {
                        edit_id: edit.id,
                        file_id: edit.file_id,
                        resolved_span: span,
                        file_path,
                    });
                }
                AnchorResolution::HashMismatch {
                    span,
                    expected,
                    actual,
                } => {
                    conflicts.push(Conflict::AnchorHashMismatch {
                        file_id: edit.file_id,
                        span,
                        expected,
                        actual,
                    });
                }
                AnchorResolution::NotFound { .. } => {
                    conflicts.push(Conflict::AnchorNotFound {
                        file_id: edit.file_id,
                        anchor: edit.anchor.clone(),
                    });
                }
                AnchorResolution::Ambiguous { matches } => {
                    conflicts.push(Conflict::AnchorAmbiguous {
                        file_id: edit.file_id,
                        anchor: edit.anchor.clone(),
                        match_count: matches.len(),
                    });
                }
                AnchorResolution::OutOfBounds { span, file_len } => {
                    conflicts.push(Conflict::SpanOutOfBounds {
                        file_id: edit.file_id,
                        span,
                        file_len,
                    });
                }
            }
        }

        // Check for overlapping spans among resolved edits
        let mut edits_by_file: HashMap<FileId, Vec<&ResolvedEdit>> = HashMap::new();
        for edit in &resolved_edits {
            edits_by_file.entry(edit.file_id).or_default().push(edit);
        }

        for (file_id, file_edits) in edits_by_file {
            for i in 0..file_edits.len() {
                for j in (i + 1)..file_edits.len() {
                    if file_edits[i]
                        .resolved_span
                        .overlaps(&file_edits[j].resolved_span)
                    {
                        conflicts.push(Conflict::OverlappingSpans {
                            file_id,
                            edit1_span: file_edits[i].resolved_span,
                            edit2_span: file_edits[j].resolved_span,
                        });
                    }
                }
            }
        }

        let is_valid = conflicts.is_empty();

        PreviewResult {
            resolved_edits,
            conflicts,
            is_valid,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to create test content
    fn test_content() -> Vec<u8> {
        b"def process_data(x):\n    return x * 2\n".to_vec()
    }

    mod content_hash_tests {
        use super::*;

        #[test]
        fn content_hash_compute_produces_hex() {
            let hash = ContentHash::compute(b"hello");
            // SHA-256 produces 64 hex characters
            assert_eq!(hash.0.len(), 64);
            assert!(hash.0.chars().all(|c| c.is_ascii_hexdigit()));
        }

        #[test]
        fn content_hash_from_hex_unchecked_accepts_any_string() {
            // This test documents that from_hex_unchecked does NOT validate input
            let valid_hex = ContentHash::from_hex_unchecked("deadbeef");
            assert_eq!(valid_hex.0, "deadbeef");

            let invalid_hex = ContentHash::from_hex_unchecked("not-valid-hex!");
            assert_eq!(invalid_hex.0, "not-valid-hex!");

            let empty = ContentHash::from_hex_unchecked("");
            assert_eq!(empty.0, "");
        }

        #[test]
        fn content_hash_display() {
            let hash = ContentHash::from_hex_unchecked("abc123");
            assert_eq!(format!("{}", hash), "abc123");
        }
    }

    mod span_tests {
        use super::*;

        #[test]
        fn span_creation() {
            let span = Span::new(10, 20);
            assert_eq!(span.start, 10);
            assert_eq!(span.end, 20);
            assert_eq!(span.len(), 10);
            assert!(!span.is_empty());
        }

        #[test]
        fn span_empty() {
            let span = Span::new(10, 10);
            assert!(span.is_empty());
            assert_eq!(span.len(), 0);
        }

        #[test]
        fn span_overlap_detection() {
            let span1 = Span::new(10, 20);
            let span2 = Span::new(15, 25);
            let span3 = Span::new(20, 30);
            let span4 = Span::new(5, 15);

            // Overlapping spans
            assert!(span1.overlaps(&span2));
            assert!(span2.overlaps(&span1));

            // Adjacent spans don't overlap
            assert!(!span1.overlaps(&span3));
            assert!(!span3.overlaps(&span1));

            // Overlapping at start
            assert!(span1.overlaps(&span4));
            assert!(span4.overlaps(&span1));
        }

        #[test]
        fn span_contains() {
            let outer = Span::new(10, 30);
            let inner = Span::new(15, 25);
            let partial = Span::new(20, 40);

            assert!(outer.contains(&inner));
            assert!(!inner.contains(&outer));
            assert!(!outer.contains(&partial));
        }
    }

    mod anchor_tests {
        use super::*;

        #[test]
        fn anchor_span_exact_success() {
            let content = test_content();
            // "process_data" is at bytes 4-16
            let target = &content[4..16];
            let span = Span::new(4, 16);
            let anchor = Anchor::span_exact(span, target);

            match anchor.resolve(&content) {
                AnchorResolution::Resolved(resolved) => {
                    assert_eq!(resolved, span);
                }
                other => panic!("Expected Resolved, got {:?}", other),
            }
        }

        #[test]
        fn anchor_span_exact_hash_mismatch() {
            let content = test_content();
            let span = Span::new(4, 16);
            // Create anchor with wrong hash
            let anchor = Anchor::SpanExact {
                span,
                expected_before_hash: ContentHash::from_hex_unchecked("deadbeef"),
            };

            match anchor.resolve(&content) {
                AnchorResolution::HashMismatch { expected, .. } => {
                    assert_eq!(expected.0, "deadbeef");
                }
                other => panic!("Expected HashMismatch, got {:?}", other),
            }
        }

        #[test]
        fn anchor_span_exact_out_of_bounds() {
            let content = test_content();
            let span = Span::new(100, 200);
            let anchor = Anchor::SpanExact {
                span,
                expected_before_hash: ContentHash::from_hex_unchecked("abc"),
            };

            match anchor.resolve(&content) {
                AnchorResolution::OutOfBounds { file_len, .. } => {
                    assert_eq!(file_len, content.len() as u64);
                }
                other => panic!("Expected OutOfBounds, got {:?}", other),
            }
        }

        #[test]
        fn anchor_with_context_success() {
            let content = b"prefix_TARGET_suffix and more text".to_vec();
            let anchor = Anchor::span_with_context(
                Span::new(7, 13), // approximate location of "TARGET"
                "prefix_",
                "_suffix",
                None,
                50,
            );

            match anchor.resolve(&content) {
                AnchorResolution::Resolved(span) => {
                    let found = &content[span.start as usize..span.end as usize];
                    assert_eq!(found, b"TARGET");
                }
                other => panic!("Expected Resolved, got {:?}", other),
            }
        }

        #[test]
        fn anchor_with_context_not_found() {
            let content = b"no match here".to_vec();
            let anchor = Anchor::span_with_context(Span::new(0, 6), "prefix_", "_suffix", None, 50);

            match anchor.resolve(&content) {
                AnchorResolution::NotFound { .. } => {}
                other => panic!("Expected NotFound, got {:?}", other),
            }
        }

        #[test]
        fn anchor_with_context_ambiguous() {
            let content = b"prefix_A_suffix and prefix_B_suffix".to_vec();
            let anchor = Anchor::span_with_context(
                Span::new(7, 8), // looking for single char between prefix and suffix
                "prefix_",
                "_suffix",
                None,
                100,
            );

            match anchor.resolve(&content) {
                AnchorResolution::Ambiguous { matches } => {
                    assert_eq!(matches.len(), 2);
                }
                other => panic!("Expected Ambiguous, got {:?}", other),
            }
        }
    }

    mod conflict_tests {
        use super::*;

        #[test]
        fn detect_overlapping_spans() {
            let file_id = FileId::new(1);
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit1 = Edit::replace(
                1,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(10, 20),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "new1",
            );

            let edit2 = Edit::replace(
                2,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(15, 25),
                    expected_before_hash: ContentHash::from_hex_unchecked("def"),
                },
                "new2",
            );

            let patch = PatchSet::new(snapshot_id).with_edit(edit1).with_edit(edit2);

            let conflicts = patch.detect_conflicts();
            assert_eq!(conflicts.len(), 1);

            match &conflicts[0] {
                Conflict::OverlappingSpans {
                    edit1_span,
                    edit2_span,
                    ..
                } => {
                    assert_eq!(edit1_span.start, 10);
                    assert_eq!(edit2_span.start, 15);
                }
                other => panic!("Expected OverlappingSpans, got {:?}", other),
            }
        }

        #[test]
        fn no_conflict_for_adjacent_spans() {
            let file_id = FileId::new(1);
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit1 = Edit::replace(
                1,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(10, 20),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "new1",
            );

            let edit2 = Edit::replace(
                2,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(20, 30),
                    expected_before_hash: ContentHash::from_hex_unchecked("def"),
                },
                "new2",
            );

            let patch = PatchSet::new(snapshot_id).with_edit(edit1).with_edit(edit2);

            let conflicts = patch.detect_conflicts();
            assert!(conflicts.is_empty());
        }

        #[test]
        fn no_conflict_different_files() {
            let file1 = FileId::new(1);
            let file2 = FileId::new(2);
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit1 = Edit::replace(
                1,
                file1,
                Anchor::SpanExact {
                    span: Span::new(10, 20),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "new1",
            );

            let edit2 = Edit::replace(
                2,
                file2,
                Anchor::SpanExact {
                    span: Span::new(10, 20),
                    expected_before_hash: ContentHash::from_hex_unchecked("def"),
                },
                "new2",
            );

            let patch = PatchSet::new(snapshot_id).with_edit(edit1).with_edit(edit2);

            let conflicts = patch.detect_conflicts();
            assert!(conflicts.is_empty());
        }
    }

    mod atomicity_tests {
        use super::*;

        #[test]
        fn apply_fails_on_snapshot_mismatch() {
            let file_id = FileId::new(1);
            let content = test_content();
            let snapshot_id = WorkspaceSnapshotId::new("expected");

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(4, 16), &content[4..16]),
                "transform_data",
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_precondition(Precondition::SnapshotIsCurrent(snapshot_id))
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let ctx = ApplyContext {
                snapshot_id: WorkspaceSnapshotId::new("actual"), // Different!
                file_contents: [(file_id.clone(), content.clone())].into(),
                file_hashes: [(file_id, ContentHash::compute(&content))].into(),
            };

            match patch.apply(&ctx) {
                ApplyResult::Failed { conflicts } => {
                    assert!(!conflicts.is_empty());
                    // File should not be modified
                }
                ApplyResult::Success { .. } => {
                    panic!("Should have failed due to snapshot mismatch");
                }
            }
        }

        #[test]
        fn apply_fails_on_file_hash_mismatch() {
            let file_id = FileId::new(1);
            let content = test_content();
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let wrong_hash = ContentHash::from_hex_unchecked("wrong");

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(4, 16), &content[4..16]),
                "transform_data",
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_precondition(Precondition::FileHashMatches {
                    file_id: file_id.clone(),
                    content_hash: wrong_hash,
                })
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let ctx = ApplyContext {
                snapshot_id,
                file_contents: [(file_id.clone(), content.clone())].into(),
                file_hashes: [(file_id, ContentHash::compute(&content))].into(),
            };

            match patch.apply(&ctx) {
                ApplyResult::Failed { conflicts } => {
                    assert!(!conflicts.is_empty());
                }
                ApplyResult::Success { .. } => {
                    panic!("Should have failed due to hash mismatch");
                }
            }
        }

        #[test]
        fn apply_fails_on_anchor_mismatch() {
            let file_id = FileId::new(1);
            let content = test_content();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(4, 16),
                    expected_before_hash: ContentHash::from_hex_unchecked("wrong"),
                },
                "transform_data",
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let ctx = ApplyContext {
                snapshot_id,
                file_contents: [(file_id.clone(), content.clone())].into(),
                file_hashes: [(file_id, ContentHash::compute(&content))].into(),
            };

            match patch.apply(&ctx) {
                ApplyResult::Failed { conflicts } => {
                    assert!(!conflicts.is_empty());
                    assert!(conflicts
                        .iter()
                        .any(|c| matches!(c, Conflict::AnchorHashMismatch { .. })));
                }
                ApplyResult::Success { .. } => {
                    panic!("Should have failed due to anchor mismatch");
                }
            }
        }

        #[test]
        fn apply_success_replaces_content() {
            let file_id = FileId::new(1);
            let content = test_content();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            // Replace "process_data" with "transform_data"
            let target = &content[4..16];
            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(4, 16), target),
                "transform_data",
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let ctx = ApplyContext {
                snapshot_id,
                file_contents: [(file_id.clone(), content.clone())].into(),
                file_hashes: [(file_id.clone(), ContentHash::compute(&content))].into(),
            };

            match patch.apply(&ctx) {
                ApplyResult::Success { modified_files } => {
                    let new_content = modified_files.get(&file_id).unwrap();
                    let new_str = String::from_utf8_lossy(new_content);
                    assert!(new_str.contains("transform_data"));
                    assert!(!new_str.contains("process_data"));
                }
                ApplyResult::Failed { conflicts } => {
                    panic!(
                        "Apply should have succeeded, got conflicts: {:?}",
                        conflicts
                    );
                }
            }
        }

        #[test]
        fn apply_multiple_edits_reverse_order() {
            let file_id = FileId::new(1);
            // Content: "aaa bbb ccc"
            let content = b"aaa bbb ccc".to_vec();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            // Edit 1: replace "aaa" at 0-3
            let edit1 = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(0, 3), b"aaa"),
                "AAA",
            );

            // Edit 2: replace "ccc" at 8-11
            let edit2 = Edit::replace(
                2,
                file_id.clone(),
                Anchor::span_exact(Span::new(8, 11), b"ccc"),
                "CCC",
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_edit(edit1)
                .with_edit(edit2)
                .with_file_path(file_id.clone(), "test.txt");

            let ctx = ApplyContext {
                snapshot_id,
                file_contents: [(file_id.clone(), content.clone())].into(),
                file_hashes: [(file_id.clone(), ContentHash::compute(&content))].into(),
            };

            match patch.apply(&ctx) {
                ApplyResult::Success { modified_files } => {
                    let new_content = modified_files.get(&file_id).unwrap();
                    let new_str = String::from_utf8_lossy(new_content);
                    assert_eq!(new_str, "AAA bbb CCC");
                }
                ApplyResult::Failed { conflicts } => {
                    panic!(
                        "Apply should have succeeded, got conflicts: {:?}",
                        conflicts
                    );
                }
            }
        }
    }

    mod ordering_tests {
        use super::*;

        #[test]
        fn deterministic_edit_sorting() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file1 = FileId::new(1);
            let file2 = FileId::new(2);

            let edit1 = Edit::replace(
                3,
                file1.clone(),
                Anchor::SpanExact {
                    span: Span::new(20, 30),
                    expected_before_hash: ContentHash::from_hex_unchecked("c"),
                },
                "c",
            );

            let edit2 = Edit::replace(
                1,
                file2.clone(),
                Anchor::SpanExact {
                    span: Span::new(10, 20),
                    expected_before_hash: ContentHash::from_hex_unchecked("a"),
                },
                "a",
            );

            let edit3 = Edit::replace(
                2,
                file1.clone(),
                Anchor::SpanExact {
                    span: Span::new(10, 15),
                    expected_before_hash: ContentHash::from_hex_unchecked("b"),
                },
                "b",
            );

            let mut patch = PatchSet::new(snapshot_id)
                .with_edit(edit1)
                .with_edit(edit2)
                .with_edit(edit3)
                .with_file_path(file1.clone(), "a.py")
                .with_file_path(file2.clone(), "b.py");

            patch.sort_edits();

            // Should be ordered by: file path, then span start, then edit id
            assert_eq!(patch.edits[0].id, 2); // a.py, span 10-15
            assert_eq!(patch.edits[1].id, 3); // a.py, span 20-30
            assert_eq!(patch.edits[2].id, 1); // b.py, span 10-20
        }

        #[test]
        fn deterministic_json_output() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(1);

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::SpanExact {
                    span: Span::new(0, 5),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "hello",
            );

            let patch1 = PatchSet::new(snapshot_id.clone())
                .with_edit(edit.clone())
                .with_file_path(file_id.clone(), "test.py");

            let patch2 = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.py");

            let json1 = serde_json::to_string(&patch1).unwrap();
            let json2 = serde_json::to_string(&patch2).unwrap();

            assert_eq!(json1, json2);
        }
    }

    mod materialization_tests {
        use super::*;

        #[test]
        fn materialize_produces_output_edits() {
            let file_id = FileId::new(1);
            let content = b"def foo(): pass".to_vec();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(4, 7), b"foo"),
                "bar",
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let materialized = patch.materialize(&[(file_id, content)].into());

            assert_eq!(materialized.edits.len(), 1);
            assert_eq!(materialized.edits[0].file, "test.py");
            assert_eq!(materialized.edits[0].old_text, "foo");
            assert_eq!(materialized.edits[0].new_text, "bar");
            assert_eq!(materialized.edits[0].line, 1);
            assert_eq!(materialized.edits[0].col, 5); // 1-indexed, after "def "
        }

        #[test]
        fn materialize_produces_unified_diff() {
            let file_id = FileId::new(1);
            let content = b"def foo(): pass".to_vec();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            let edit = Edit::replace(
                1,
                file_id.clone(),
                Anchor::span_exact(Span::new(4, 7), b"foo"),
                "bar",
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id.clone(), "test.py");

            let materialized = patch.materialize(&[(file_id, content)].into());

            assert!(materialized.unified_diff.contains("--- a/test.py"));
            assert!(materialized.unified_diff.contains("+++ b/test.py"));
            assert!(materialized.unified_diff.contains("-foo"));
            assert!(materialized.unified_diff.contains("+bar"));
        }
    }

    // ========================================================================
    // Regression tests for audit findings
    // ========================================================================

    mod audit_regression_tests {
        use super::*;

        // S2-01: Unified diff line count should be 0 for empty text, not 1
        #[test]
        fn unified_diff_insert_has_zero_old_lines() {
            let snapshot_id = WorkspaceSnapshotId("snap_test".into());
            let file_id = FileId::new(0);
            let content = b"hello world";

            // Insert at position 5 (after "hello")
            let edit = Edit::insert(
                1,
                file_id,
                Anchor::span_exact(Span::new(5, 5), b""),
                " beautiful",
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.txt");

            let materialized = patch.materialize(&[(file_id, content.to_vec())].into());

            // For an insert, old line count should be 0
            // Format: @@ -line,count +line,count @@
            assert!(
                materialized.unified_diff.contains("@@ -1,0 +1,"),
                "Insert should have 0 old lines, got: {}",
                materialized.unified_diff
            );
        }

        #[test]
        fn unified_diff_delete_has_zero_new_lines() {
            let snapshot_id = WorkspaceSnapshotId("snap_test".into());
            let file_id = FileId::new(0);
            let content = b"hello world";

            // Delete " world" (positions 5-11)
            let edit = Edit::delete(1, file_id, Anchor::span_exact(Span::new(5, 11), b" world"));

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.txt");

            let materialized = patch.materialize(&[(file_id, content.to_vec())].into());

            // For a delete, new line count should be 0
            assert!(
                materialized.unified_diff.contains(",0 @@"),
                "Delete should have 0 new lines, got: {}",
                materialized.unified_diff
            );
        }

        // S2-02: Insert with non-empty span should panic
        #[test]
        #[should_panic(expected = "Insert anchor span must be empty")]
        fn insert_with_nonempty_span_panics() {
            let file_id = FileId::new(0);
            // This should panic - Insert requires empty span
            let _edit = Edit::insert(
                1,
                file_id,
                Anchor::span_exact(Span::new(0, 5), b"hello"), // Non-empty span!
                "world",
            );
        }

        // S2-03: Span::new with start > end should panic
        #[test]
        #[should_panic(expected = "Span start")]
        fn span_new_invalid_range_panics() {
            let _span = Span::new(10, 5); // start > end should panic
        }

        #[test]
        fn span_len_is_correct() {
            let span = Span::new(5, 10);
            assert_eq!(span.len(), 5);

            let empty = Span::new(5, 5);
            assert_eq!(empty.len(), 0);
            assert!(empty.is_empty());
        }

        // S2-04: SpanWithContext with no context and no hash should panic
        #[test]
        #[should_panic(expected = "SpanWithContext requires at least one of")]
        fn span_with_context_no_verification_panics() {
            let _anchor = Anchor::span_with_context(
                Span::new(0, 5),
                "",   // empty prefix
                "",   // empty suffix
                None, // no hash
                100,
            );
        }

        #[test]
        fn span_with_context_prefix_only_ok() {
            // Should not panic - has prefix
            let anchor = Anchor::span_with_context(Span::new(0, 5), "prefix", "", None, 100);
            assert_eq!(anchor.span(), Span::new(0, 5));
        }

        #[test]
        fn span_with_context_suffix_only_ok() {
            // Should not panic - has suffix
            let anchor = Anchor::span_with_context(Span::new(0, 5), "", "suffix", None, 100);
            assert_eq!(anchor.span(), Span::new(0, 5));
        }

        #[test]
        fn span_with_context_hash_only_ok() {
            // Should not panic - has hash
            let anchor = Anchor::span_with_context(
                Span::new(0, 5),
                "",
                "",
                Some(ContentHash::compute(b"hello")),
                100,
            );
            assert_eq!(anchor.span(), Span::new(0, 5));
        }

        // S2-18: Conflict types should be correct
        #[test]
        fn conflict_io_error_has_file_path() {
            let conflict = Conflict::IoError {
                file_path: "test.py".to_string(),
                message: "Permission denied".to_string(),
            };

            if let Conflict::IoError { file_path, message } = conflict {
                assert_eq!(file_path, "test.py");
                assert_eq!(message, "Permission denied");
            } else {
                panic!("Expected IoError conflict");
            }
        }

        #[test]
        fn conflict_span_out_of_bounds_has_details() {
            let conflict = Conflict::SpanOutOfBounds {
                file_id: FileId::new(0),
                span: Span::new(100, 200),
                file_len: 50,
            };

            if let Conflict::SpanOutOfBounds { span, file_len, .. } = conflict {
                assert_eq!(span.start, 100);
                assert_eq!(span.end, 200);
                assert_eq!(file_len, 50);
            } else {
                panic!("Expected SpanOutOfBounds conflict");
            }
        }

        #[test]
        fn unified_diff_no_newline_marker_when_missing_trailing_newline() {
            let file_id = FileId::new(1);
            // Content without trailing newline
            let content = b"hello world".to_vec();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            // Replace "world" (no trailing newline in replacement)
            let edit = Edit::replace(
                1,
                file_id,
                Anchor::span_exact(Span::new(6, 11), b"world"),
                "universe", // No trailing newline
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.txt");

            let materialized = patch.materialize(&[(file_id, content)].into());

            // Both old and new text don't end with newline, so marker should appear
            assert!(
                materialized
                    .unified_diff
                    .contains("\\ No newline at end of file"),
                "Should have 'No newline at end of file' marker, got: {}",
                materialized.unified_diff
            );
        }

        #[test]
        fn unified_diff_no_marker_when_has_trailing_newline() {
            let file_id = FileId::new(1);
            // Content WITH trailing newline
            let content = b"hello world\n".to_vec();
            let snapshot_id = WorkspaceSnapshotId::new("test");

            // Replace "world\n" with "universe\n"
            let edit = Edit::replace(
                1,
                file_id,
                Anchor::span_exact(Span::new(6, 12), b"world\n"),
                "universe\n", // With trailing newline
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.txt");

            let materialized = patch.materialize(&[(file_id, content)].into());

            // Both old and new text end with newline, so no marker should appear
            assert!(
                !materialized.unified_diff.contains("\\ No newline at end of file"),
                "Should NOT have 'No newline at end of file' marker when text ends with newline, got: {}",
                materialized.unified_diff
            );
        }

        #[test]
        fn span_with_context_deduplicates_overlapping_matches() {
            // Content with overlapping prefix matches: "aaaaab"
            // Prefix "aa" matches at positions 0, 1, 2, 3 (overlapping!)
            // With target_len=2, we could match:
            // - pos 0: prefix[0..2]="aa", target[2..4]="aa"
            // - pos 1: prefix[1..3]="aa", target[3..5]="ab"
            // - pos 2: prefix[2..4]="aa", target[4..6]="ab"
            // These target spans overlap, so we should deduplicate
            let content = b"aaaaab".to_vec();

            let anchor = Anchor::span_with_context(
                Span::new(2, 4), // approximate location
                "aa",            // prefix
                "",              // no suffix
                None,            // no hash
                10,              // search window
            );

            match anchor.resolve(&content) {
                AnchorResolution::Resolved(span) => {
                    // Should find the first non-overlapping match
                    assert_eq!(span, Span::new(2, 4));
                }
                AnchorResolution::Ambiguous { matches } => {
                    // If still ambiguous, matches should not overlap
                    for i in 0..matches.len() {
                        for j in (i + 1)..matches.len() {
                            assert!(
                                !matches[i].overlaps(&matches[j]),
                                "Matches should not overlap: {:?} and {:?}",
                                matches[i],
                                matches[j]
                            );
                        }
                    }
                }
                other => panic!("Expected Resolved or Ambiguous, got {:?}", other),
            }
        }

        #[test]
        fn span_with_context_finds_distinct_non_overlapping_matches() {
            // Two completely distinct matches that don't overlap
            let content = b"prefix_A_suffix XXXX prefix_B_suffix".to_vec();

            let anchor = Anchor::span_with_context(
                Span::new(7, 8), // looking for single char
                "prefix_",
                "_suffix",
                None,
                100,
            );

            match anchor.resolve(&content) {
                AnchorResolution::Ambiguous { matches } => {
                    // Should find exactly 2 non-overlapping matches
                    assert_eq!(matches.len(), 2);
                    assert!(!matches[0].overlaps(&matches[1]));
                }
                other => panic!("Expected Ambiguous with 2 matches, got {:?}", other),
            }
        }

        #[test]
        fn patchset_has_edits_empty() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let patch = PatchSet::new(snapshot_id);

            assert!(!patch.has_edits());
            assert_eq!(patch.edit_count(), 0);
            assert_eq!(patch.file_count(), 0);
        }

        #[test]
        fn patchset_has_edits_with_edits() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(1);

            let edit = Edit::replace(
                1,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(0, 5),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "hello",
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit)
                .with_file_path(file_id, "test.py");

            assert!(patch.has_edits());
            assert_eq!(patch.edit_count(), 1);
            assert_eq!(patch.file_count(), 1);
        }

        #[test]
        fn patchset_file_count_multiple_files() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file1 = FileId::new(1);
            let file2 = FileId::new(2);

            let edit1 = Edit::replace(
                1,
                file1,
                Anchor::SpanExact {
                    span: Span::new(0, 5),
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
                "hello",
            );
            let edit2 = Edit::replace(
                2,
                file2,
                Anchor::SpanExact {
                    span: Span::new(0, 5),
                    expected_before_hash: ContentHash::from_hex_unchecked("def"),
                },
                "world",
            );
            let edit3 = Edit::replace(
                3,
                file1, // Same file as edit1
                Anchor::SpanExact {
                    span: Span::new(10, 15),
                    expected_before_hash: ContentHash::from_hex_unchecked("ghi"),
                },
                "foo",
            );

            let patch = PatchSet::new(snapshot_id)
                .with_edit(edit1)
                .with_edit(edit2)
                .with_edit(edit3)
                .with_file_path(file1, "test1.py")
                .with_file_path(file2, "test2.py");

            assert!(patch.has_edits());
            assert_eq!(patch.edit_count(), 3);
            assert_eq!(patch.file_count(), 2); // Only 2 unique files
        }

        #[test]
        fn apply_missing_file_produces_file_missing_conflict() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(0);
            let edit = Edit::replace(
                1,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(0, 5),
                    expected_before_hash: ContentHash::compute(b"hello"),
                },
                "world",
            );

            let patch = PatchSet::new(snapshot_id.clone()).with_edit(edit);

            // Apply context with empty file_contents (file missing)
            let ctx = ApplyContext {
                snapshot_id,
                file_contents: HashMap::new(),
                file_hashes: HashMap::new(),
            };

            let result = patch.apply(&ctx);

            match result {
                ApplyResult::Failed { conflicts } => {
                    assert_eq!(conflicts.len(), 1);
                    match &conflicts[0] {
                        Conflict::FileMissing {
                            file_id: missing_id,
                        } => {
                            assert_eq!(missing_id, &file_id);
                        }
                        other => panic!("Expected FileMissing, got {:?}", other),
                    }
                }
                ApplyResult::Success { .. } => panic!("Expected failure for missing file"),
            }
        }

        #[test]
        fn apply_out_of_bounds_uses_span_out_of_bounds_conflict() {
            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(0);
            let content = b"short";

            // Edit with span beyond file content
            let edit = Edit::replace(
                1,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(0, 100), // Beyond content length
                    expected_before_hash: ContentHash::compute(content),
                },
                "replacement",
            );

            let patch = PatchSet::new(snapshot_id.clone()).with_edit(edit);

            let mut file_contents = HashMap::new();
            file_contents.insert(file_id, content.to_vec());

            let ctx = ApplyContext {
                snapshot_id,
                file_contents,
                file_hashes: HashMap::new(),
            };

            let result = patch.apply(&ctx);

            match result {
                ApplyResult::Failed { conflicts } => {
                    assert_eq!(conflicts.len(), 1);
                    match &conflicts[0] {
                        Conflict::SpanOutOfBounds {
                            file_id: oob_file,
                            span,
                            file_len,
                        } => {
                            assert_eq!(oob_file, &file_id);
                            assert_eq!(span.end, 100);
                            assert_eq!(*file_len, content.len() as u64);
                        }
                        other => panic!("Expected SpanOutOfBounds, got {:?}", other),
                    }
                }
                ApplyResult::Success { .. } => panic!("Expected failure for OOB span"),
            }
        }

        #[test]
        #[should_panic(expected = "Delete anchor span must be non-empty")]
        fn edit_delete_empty_span_panics() {
            let file_id = FileId::new(0);
            let empty_span = Span::new(5, 5); // Empty span

            Edit::delete(
                1,
                file_id,
                Anchor::SpanExact {
                    span: empty_span,
                    expected_before_hash: ContentHash::from_hex_unchecked("abc"),
                },
            );
        }
    }
}
