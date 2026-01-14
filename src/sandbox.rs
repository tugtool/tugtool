//! SandboxCopy subsystem for verification isolation.
//!
//! Provides safe, atomic semantics for refactoring operations:
//! 1. Copy workspace to temp directory
//! 2. Apply patches in sandbox
//! 3. Run verification (tests, type checking)
//! 4. Only if verification passes: emit patches back to real workspace
//!
//! Per [D05], verification always uses SandboxCopy mode.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracing::{debug, warn};
use wait_timeout::ChildExt;
use walkdir::WalkDir;

use crate::patch::{
    AnchorResolution, ApplyContext, ApplyResult, Conflict, ContentHash, EditKind, FileId, PatchSet,
    Span,
};
use crate::workspace::{Language, WorkspaceSnapshot};

// ============================================================================
// Sandbox Configuration
// ============================================================================

/// Configuration for sandbox creation and operation.
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// Language filter for files to copy.
    pub language: Option<Language>,
    /// Custom directory for sandbox (default: system temp).
    pub sandbox_dir: Option<PathBuf>,
    /// Whether to preserve sandbox on failure.
    pub keep_sandbox: bool,
    /// Whether to include files ignored by .gitignore.
    pub include_ignored: bool,
    /// Verification timeout in seconds.
    pub verification_timeout: Duration,
    /// Additional environment variables for verification commands.
    pub extra_env: HashMap<String, String>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        SandboxConfig {
            language: None,
            sandbox_dir: None,
            keep_sandbox: false,
            include_ignored: false,
            verification_timeout: Duration::from_secs(300), // 5 minutes
            extra_env: HashMap::new(),
        }
    }
}

impl SandboxConfig {
    /// Create a config for a specific language.
    pub fn for_language(language: Language) -> Self {
        SandboxConfig {
            language: Some(language),
            ..Default::default()
        }
    }

    /// Enable keep_sandbox flag.
    pub fn keep_on_failure(mut self) -> Self {
        self.keep_sandbox = true;
        self
    }

    /// Set verification timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.verification_timeout = timeout;
        self
    }
}

// ============================================================================
// Default Exclusions
// ============================================================================

/// Directories to always exclude from sandbox copies.
const EXCLUDE_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "target",
    ".venv",
    "venv",
    ".env",
    "env",
    "build",
    "dist",
    ".eggs",
    ".tox",
    ".nox",
    ".coverage",
    "htmlcov",
    ".hypothesis",
];

/// File patterns to always exclude.
const EXCLUDE_PATTERNS: &[&str] = &[
    "*.pyc",
    "*.pyo",
    "*.egg-info",
    "*.so",
    "*.dylib",
    "*.dll",
    "*.log",
    "*.tmp",
];

/// Config files to always include (regardless of language filter).
const CONFIG_FILES: &[&str] = &[
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "pytest.ini",
    "tox.ini",
    "mypy.ini",
    ".flake8",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain",
    "rust-toolchain.toml",
];

/// Check if a path should be excluded.
fn should_exclude(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_string_lossy();

            // Check excluded directories
            if EXCLUDE_DIRS.contains(&name_str.as_ref()) {
                return true;
            }

            // Check excluded patterns
            for pattern in EXCLUDE_PATTERNS {
                if let Some(suffix) = pattern.strip_prefix('*') {
                    if name_str.ends_with(suffix) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Check if a file is a config file that should always be included.
fn is_config_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| CONFIG_FILES.contains(&n))
        .unwrap_or(false)
}

// ============================================================================
// Symlink Handling
// ============================================================================

/// Result of checking a symlink.
#[derive(Debug)]
pub enum SymlinkCheck {
    /// Symlink points within workspace, should copy target content.
    WithinWorkspace(PathBuf),
    /// Symlink points outside workspace, should skip with warning.
    OutsideWorkspace(PathBuf),
    /// Not a symlink.
    NotSymlink,
    /// Error reading symlink.
    Error(io::Error),
}

/// Check if a symlink points within the workspace.
///
/// Returns `SymlinkCheck::Error` for canonicalization failures (e.g., symlink loops,
/// broken symlinks, permission errors). This is important because symlink loops would
/// otherwise be silently treated as "outside workspace".
fn check_symlink(path: &Path, workspace_root: &Path) -> SymlinkCheck {
    if !path.is_symlink() {
        return SymlinkCheck::NotSymlink;
    }

    match fs::read_link(path) {
        Ok(target) => {
            // Resolve to absolute path
            let absolute_target = if target.is_absolute() {
                target.clone()
            } else {
                path.parent()
                    .map(|p| p.join(&target))
                    .unwrap_or(target.clone())
            };

            // Canonicalize target path - this can fail for symlink loops, broken symlinks, etc.
            let canonical_target = match absolute_target.canonicalize() {
                Ok(p) => p,
                Err(e) => return SymlinkCheck::Error(e),
            };

            // Canonicalize workspace - should succeed, but handle errors
            let canonical_workspace = match workspace_root.canonicalize() {
                Ok(p) => p,
                Err(e) => return SymlinkCheck::Error(e),
            };

            // Compare canonicalized paths
            if canonical_target.starts_with(&canonical_workspace) {
                SymlinkCheck::WithinWorkspace(canonical_target)
            } else {
                SymlinkCheck::OutsideWorkspace(canonical_target)
            }
        }
        Err(e) => SymlinkCheck::Error(e),
    }
}

// ============================================================================
// Sandbox Handle
// ============================================================================

/// Handle for a sandbox directory, managing its lifecycle.
///
/// A sandbox provides isolation for refactoring verification:
/// - Files are copied to a temp directory
/// - Patches are applied in the sandbox
/// - Verification commands run with sandbox as cwd
/// - Sandbox is cleaned up on dispose (unless keep_sandbox is set)
pub struct SandboxHandle {
    /// The temp directory (automatically cleaned up on drop unless persisted).
    temp_dir: Option<TempDir>,
    /// Path to the sandbox root (contains workspace/ and .tug_meta/).
    sandbox_root: PathBuf,
    /// Path to the mirrored workspace directory.
    workspace_dir: PathBuf,
    /// Path to the metadata directory.
    meta_dir: PathBuf,
    /// Original workspace root.
    original_root: PathBuf,
    /// Configuration.
    config: SandboxConfig,
    /// Files that were copied (for manifest).
    copied_files: Vec<String>,
    /// Symlinks that were skipped (outside workspace).
    skipped_symlinks: Vec<(PathBuf, PathBuf)>,
    /// Whether the sandbox should be preserved.
    persist: bool,
}

impl SandboxHandle {
    /// Create a new sandbox by copying files from workspace.
    pub fn create(workspace_root: &Path, config: SandboxConfig) -> io::Result<Self> {
        let workspace_root = workspace_root.canonicalize()?;

        // Create temp directory
        let temp_dir = if let Some(ref base) = config.sandbox_dir {
            TempDir::with_prefix_in("tug_sandbox_", base)?
        } else {
            TempDir::with_prefix("tug_sandbox_")?
        };

        let sandbox_root = temp_dir.path().to_path_buf();
        let workspace_dir = sandbox_root.join("workspace");
        let meta_dir = sandbox_root.join(".tug_meta");

        // Create directory structure
        fs::create_dir_all(&workspace_dir)?;
        fs::create_dir_all(&meta_dir)?;

        let mut handle = SandboxHandle {
            temp_dir: Some(temp_dir),
            sandbox_root,
            workspace_dir,
            meta_dir,
            original_root: workspace_root.clone(),
            config,
            copied_files: Vec::new(),
            skipped_symlinks: Vec::new(),
            persist: false,
        };

        // Copy files to sandbox
        handle.copy_workspace_files()?;

        // Write metadata
        handle.write_metadata()?;

        Ok(handle)
    }

    /// Copy workspace files to sandbox.
    fn copy_workspace_files(&mut self) -> io::Result<()> {
        for entry in WalkDir::new(&self.original_root)
            .follow_links(false) // Handle symlinks manually
            .into_iter()
            .filter_entry(|e| !should_exclude(e.path()))
        {
            let entry = entry?;
            let source_path = entry.path();

            // Skip the root itself
            if source_path == self.original_root {
                continue;
            }

            let relative_path = source_path
                .strip_prefix(&self.original_root)
                .map_err(io::Error::other)?;

            let dest_path = self.workspace_dir.join(relative_path);

            if entry.file_type().is_dir() {
                fs::create_dir_all(&dest_path)?;
                continue;
            }

            // Check symlinks
            if source_path.is_symlink() {
                match check_symlink(source_path, &self.original_root) {
                    SymlinkCheck::WithinWorkspace(target) => {
                        // Copy target content
                        if target.is_file() {
                            if let Some(parent) = dest_path.parent() {
                                fs::create_dir_all(parent)?;
                            }
                            fs::copy(&target, &dest_path)?;
                            self.copied_files
                                .push(relative_path.to_string_lossy().to_string());
                        }
                    }
                    SymlinkCheck::OutsideWorkspace(target) => {
                        warn!(
                            "Skipping symlink outside workspace: {} -> {}",
                            source_path.display(),
                            target.display()
                        );
                        self.skipped_symlinks
                            .push((source_path.to_path_buf(), target));
                    }
                    SymlinkCheck::NotSymlink => {}
                    SymlinkCheck::Error(e) => {
                        warn!("Error reading symlink {}: {}", source_path.display(), e);
                    }
                }
                continue;
            }

            // Regular file - check if it should be included
            if !entry.file_type().is_file() {
                continue;
            }

            // Check language filter
            if let Some(ref lang) = self.config.language {
                let file_lang = Language::from_path(source_path);
                if file_lang != *lang
                    && file_lang != Language::Unknown
                    && !is_config_file(source_path)
                {
                    continue;
                }
                // Include Unknown language only if it's a config file
                if file_lang == Language::Unknown && !is_config_file(source_path) {
                    continue;
                }
            }

            // Copy the file
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source_path, &dest_path)?;
            self.copied_files
                .push(relative_path.to_string_lossy().to_string());

            debug!("Copied: {}", relative_path.display());
        }

        Ok(())
    }

    /// Write sandbox metadata files.
    fn write_metadata(&self) -> io::Result<()> {
        // Write original root path
        fs::write(
            self.meta_dir.join("original_root"),
            self.original_root.to_string_lossy().as_bytes(),
        )?;

        // Write file manifest
        let manifest = self.copied_files.join("\n");
        fs::write(self.meta_dir.join("file_manifest"), manifest)?;

        Ok(())
    }

    /// Get the sandbox root directory.
    pub fn sandbox_root(&self) -> &Path {
        &self.sandbox_root
    }

    /// Get the workspace directory within the sandbox.
    pub fn workspace_dir(&self) -> &Path {
        &self.workspace_dir
    }

    /// Get the original workspace root.
    pub fn original_root(&self) -> &Path {
        &self.original_root
    }

    /// Get the list of files that were copied.
    pub fn copied_files(&self) -> &[String] {
        &self.copied_files
    }

    /// Get symlinks that were skipped (outside workspace).
    pub fn skipped_symlinks(&self) -> &[(PathBuf, PathBuf)] {
        &self.skipped_symlinks
    }

    /// Apply a PatchSet to the sandbox.
    pub fn apply_patch(&self, patch: &PatchSet, snapshot: &WorkspaceSnapshot) -> ApplyResult {
        // Build apply context from sandbox files
        let mut file_contents: HashMap<FileId, Vec<u8>> = HashMap::new();
        let mut file_hashes: HashMap<FileId, ContentHash> = HashMap::new();

        for (file_id, file_path) in &patch.file_paths {
            let sandbox_path = self.workspace_dir.join(file_path);
            if let Ok(content) = fs::read(&sandbox_path) {
                let hash = ContentHash::compute(&content);
                file_hashes.insert(*file_id, hash);
                file_contents.insert(*file_id, content);
            }
        }

        let ctx = ApplyContext {
            snapshot_id: snapshot.snapshot_id.clone(),
            file_contents,
            file_hashes,
        };

        // Apply patch
        let result = patch.apply(&ctx);

        // If successful, write modified files to sandbox
        if let ApplyResult::Success { ref modified_files } = result {
            for (file_id, content) in modified_files {
                if let Some(file_path) = patch.file_paths.get(file_id) {
                    let sandbox_path = self.workspace_dir.join(file_path);
                    if let Err(e) = fs::write(&sandbox_path, content) {
                        return ApplyResult::Failed {
                            conflicts: vec![Conflict::IoError {
                                file_path: file_path.clone(),
                                message: e.to_string(),
                            }],
                        };
                    }
                }
            }

            // Write patch metadata
            let patch_json = serde_json::to_string_pretty(patch).unwrap_or_default();
            let _ = fs::write(self.meta_dir.join("patch_applied"), patch_json);
        }

        result
    }

    /// Run a verification command in the sandbox.
    ///
    /// Respects the configured `verification_timeout`. If the command exceeds
    /// the timeout, it is killed and a timeout result is returned.
    pub fn run_verifier(&self, command: &[String]) -> io::Result<VerificationResult> {
        if command.is_empty() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Empty command"));
        }

        let start = Instant::now();
        let timeout = self.config.verification_timeout;

        let mut cmd = Command::new(&command[0]);
        cmd.args(&command[1..])
            .current_dir(&self.workspace_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Set environment
        cmd.env("TUG_SANDBOX", "1");
        for (key, value) in &self.config.extra_env {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn()?;

        // Wait with timeout using OS-level waiting (no polling)
        match child.wait_timeout(timeout)? {
            Some(status) => {
                // Process completed within timeout
                let duration = start.elapsed();

                // Read stdout/stderr from the completed process
                let stdout = child
                    .stdout
                    .take()
                    .map(|mut s| {
                        let mut buf = Vec::new();
                        std::io::Read::read_to_end(&mut s, &mut buf).ok();
                        buf
                    })
                    .unwrap_or_default();

                let stderr = child
                    .stderr
                    .take()
                    .map(|mut s| {
                        let mut buf = Vec::new();
                        std::io::Read::read_to_end(&mut s, &mut buf).ok();
                        buf
                    })
                    .unwrap_or_default();

                Ok(VerificationResult {
                    success: status.success(),
                    exit_code: status.code(),
                    stdout: String::from_utf8_lossy(&stdout).to_string(),
                    stderr: String::from_utf8_lossy(&stderr).to_string(),
                    duration,
                    command: command.to_vec(),
                })
            }
            None => {
                // Timeout - kill the process
                let _ = child.kill();
                let _ = child.wait(); // Reap the zombie

                let duration = start.elapsed();
                warn!(
                    "Verification command timed out after {:?}: {:?}",
                    duration, command
                );

                Ok(VerificationResult {
                    success: false,
                    exit_code: None,
                    stdout: String::new(),
                    stderr: format!(
                        "Command timed out after {:?} (limit: {:?})",
                        duration, timeout
                    ),
                    duration,
                    command: command.to_vec(),
                })
            }
        }
    }

    /// Mark this sandbox to be preserved (not cleaned up on drop).
    pub fn persist(&mut self) {
        self.persist = true;
        if let Some(temp_dir) = self.temp_dir.take() {
            let path = temp_dir.keep(); // Prevents cleanup
            self.sandbox_root = path.clone();
            self.workspace_dir = path.join("workspace");
            self.meta_dir = path.join(".tug_meta");
        }
    }

    /// Explicitly dispose the sandbox.
    ///
    /// If keep_sandbox is configured and there was an error, the sandbox is preserved.
    pub fn dispose(mut self, had_error: bool) -> Option<PathBuf> {
        if had_error && self.config.keep_sandbox {
            self.persist();
            Some(self.sandbox_root.clone())
        } else {
            // Let temp_dir drop naturally (cleanup happens automatically)
            None
        }
    }
}

impl Drop for SandboxHandle {
    fn drop(&mut self) {
        // TempDir cleans up automatically when dropped
        // If persist was called, temp_dir is None and path won't be deleted
    }
}

// ============================================================================
// Verification Result
// ============================================================================

/// Result of running a verification command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    /// Whether the command succeeded (exit code 0).
    pub success: bool,
    /// Exit code if available.
    pub exit_code: Option<i32>,
    /// Captured stdout.
    pub stdout: String,
    /// Captured stderr.
    pub stderr: String,
    /// How long the command took.
    #[serde(with = "duration_serde")]
    pub duration: Duration,
    /// The command that was run.
    pub command: Vec<String>,
}

/// Serde helper for serializing `Duration` as `f64` seconds.
///
/// # Precision Limitation
///
/// This serialization uses `f64` which has ~15-17 significant decimal digits.
/// For typical command durations (milliseconds to hours), this provides
/// sub-microsecond precision. However, precision degrades for:
///
/// - Very small durations: sub-nanosecond precision is lost
/// - Very large durations: precision loss occurs beyond ~285 years
///
/// For verification command timing, this precision is more than adequate.
mod duration_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        duration.as_secs_f64().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
    where
        D: Deserializer<'de>,
    {
        let secs = f64::deserialize(deserializer)?;
        Ok(Duration::from_secs_f64(secs))
    }
}

impl VerificationResult {
    /// Create a successful result.
    pub fn success(duration: Duration, command: Vec<String>) -> Self {
        VerificationResult {
            success: true,
            exit_code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
            duration,
            command,
        }
    }

    /// Create a failed result.
    pub fn failed(
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        duration: Duration,
        command: Vec<String>,
    ) -> Self {
        VerificationResult {
            success: false,
            exit_code,
            stdout,
            stderr,
            duration,
            command,
        }
    }
}

// ============================================================================
// Refactor Report
// ============================================================================

/// Summary report for a refactoring operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefactorReport {
    /// Number of files changed.
    pub files_changed: usize,
    /// Total bytes inserted.
    pub bytes_inserted: usize,
    /// Total bytes deleted.
    pub bytes_deleted: usize,
    /// Per-file edit counts.
    pub per_file_edits: HashMap<String, usize>,
    /// Warnings (non-fatal issues).
    pub warnings: Vec<RefactorWarning>,
    /// Errors (fatal issues).
    pub errors: Vec<RefactorError>,
}

/// A warning during refactoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefactorWarning {
    /// Warning code.
    pub code: String,
    /// Warning message.
    pub message: String,
    /// Location if applicable.
    pub location: Option<WarningLocation>,
}

/// Location for a warning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarningLocation {
    /// File path.
    pub file: String,
    /// Line number (1-indexed).
    pub line: u32,
    /// Column number (1-indexed).
    pub col: u32,
}

/// An error during refactoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefactorError {
    /// Error code.
    pub code: String,
    /// Error message.
    pub message: String,
    /// Location if applicable.
    pub location: Option<WarningLocation>,
}

impl RefactorReport {
    /// Create an empty report.
    pub fn new() -> Self {
        RefactorReport {
            files_changed: 0,
            bytes_inserted: 0,
            bytes_deleted: 0,
            per_file_edits: HashMap::new(),
            warnings: Vec::new(),
            errors: Vec::new(),
        }
    }

    /// Add a warning.
    pub fn warn(&mut self, code: &str, message: &str) {
        self.warnings.push(RefactorWarning {
            code: code.to_string(),
            message: message.to_string(),
            location: None,
        });
    }

    /// Add an error.
    pub fn error(&mut self, code: &str, message: &str) {
        self.errors.push(RefactorError {
            code: code.to_string(),
            message: message.to_string(),
            location: None,
        });
    }

    /// Check if there are any errors.
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }
}

impl Default for RefactorReport {
    fn default() -> Self {
        Self::new()
    }
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
                        precondition: crate::patch::Precondition::FileHashMatches {
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
// Helper: Build RefactorReport from ApplyResult
// ============================================================================

impl RefactorReport {
    /// Build a report from a successful apply result.
    ///
    /// Note: `original_contents` is retained for API compatibility but is no longer
    /// used for byte calculations. Byte counts are now calculated from actual edit
    /// spans and replacement text lengths, which provides accurate counts even when
    /// insertions and deletions of equal size occur in the same file.
    pub fn from_apply_result(
        result: &ApplyResult,
        patch: &PatchSet,
        _original_contents: &HashMap<FileId, Vec<u8>>,
    ) -> Self {
        let mut report = RefactorReport::new();

        match result {
            ApplyResult::Success { modified_files } => {
                report.files_changed = modified_files.len();

                for file_id in modified_files.keys() {
                    let file_path = patch
                        .file_paths
                        .get(file_id)
                        .cloned()
                        .unwrap_or_else(|| format!("file_{}", file_id.0));

                    // Count edits for this file and calculate bytes from actual edits
                    let file_edits: Vec<_> = patch
                        .edits
                        .iter()
                        .filter(|e| e.file_id == *file_id)
                        .collect();
                    report
                        .per_file_edits
                        .insert(file_path.clone(), file_edits.len());

                    for edit in file_edits {
                        let span_len = edit.anchor.span().len() as usize;
                        let text_len = edit.text.len();

                        match edit.kind {
                            EditKind::Insert => {
                                report.bytes_inserted += text_len;
                            }
                            EditKind::Delete => {
                                report.bytes_deleted += span_len;
                            }
                            EditKind::Replace => {
                                report.bytes_deleted += span_len;
                                report.bytes_inserted += text_len;
                            }
                        }
                    }
                }
            }
            ApplyResult::Failed { conflicts } => {
                for conflict in conflicts {
                    report.error("ApplyFailed", &format!("{:?}", conflict));
                }
            }
        }

        report
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    use crate::patch::{Anchor, Edit, WorkspaceSnapshotId};

    /// Create a test workspace with various files.
    fn create_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create source files
        let src_dir = dir.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();

        File::create(src_dir.join("main.py"))
            .unwrap()
            .write_all(b"def main():\n    print('hello')\n")
            .unwrap();

        File::create(src_dir.join("utils.py"))
            .unwrap()
            .write_all(b"def helper():\n    return 42\n")
            .unwrap();

        // Create test files
        let tests_dir = dir.path().join("tests");
        fs::create_dir_all(&tests_dir).unwrap();

        File::create(tests_dir.join("test_main.py"))
            .unwrap()
            .write_all(b"def test_main():\n    assert True\n")
            .unwrap();

        // Create config file
        File::create(dir.path().join("pyproject.toml"))
            .unwrap()
            .write_all(b"[project]\nname = \"test\"\n")
            .unwrap();

        // Create __pycache__ (should be excluded)
        let cache_dir = dir.path().join("__pycache__");
        fs::create_dir_all(&cache_dir).unwrap();
        File::create(cache_dir.join("main.cpython-311.pyc"))
            .unwrap()
            .write_all(b"compiled")
            .unwrap();

        dir
    }

    // ========================================================================
    // File Selection Tests
    // ========================================================================

    mod file_selection_tests {
        use super::*;

        #[test]
        fn test_sandbox_excludes_pycache() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // __pycache__ should not be copied
            assert!(!sandbox.workspace_dir().join("__pycache__").exists());

            // But source files should be copied
            assert!(sandbox.workspace_dir().join("src/main.py").exists());
        }

        #[test]
        fn test_sandbox_includes_config_files() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Config file should be included
            assert!(sandbox.workspace_dir().join("pyproject.toml").exists());
        }

        #[test]
        fn test_sandbox_respects_language_filter() {
            let workspace = create_test_workspace();

            // Add a Rust file
            let src_dir = workspace.path().join("src");
            File::create(src_dir.join("lib.rs"))
                .unwrap()
                .write_all(b"pub fn greet() {}")
                .unwrap();

            let config = SandboxConfig::for_language(Language::Python);
            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Python files should be copied
            assert!(sandbox.workspace_dir().join("src/main.py").exists());
            // Rust file should NOT be copied (different language)
            assert!(!sandbox.workspace_dir().join("src/lib.rs").exists());
        }
    }

    // ========================================================================
    // Cleanup Tests
    // ========================================================================

    mod cleanup_tests {
        use super::*;

        #[test]
        fn test_sandbox_cleanup_on_success() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();
            let sandbox_path = sandbox.sandbox_root().to_path_buf();

            // Sandbox exists
            assert!(sandbox_path.exists());

            // Dispose without error
            let preserved = sandbox.dispose(false);
            assert!(preserved.is_none());

            // Sandbox should be cleaned up
            assert!(!sandbox_path.exists());
        }

        #[test]
        fn test_sandbox_cleanup_on_failure_without_keep() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();
            let sandbox_path = sandbox.sandbox_root().to_path_buf();

            // Dispose with error, but keep_sandbox is false
            let preserved = sandbox.dispose(true);
            assert!(preserved.is_none());

            // Sandbox should be cleaned up
            assert!(!sandbox_path.exists());
        }

        #[test]
        fn test_sandbox_preserved_with_keep_sandbox() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python).keep_on_failure();

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();
            let sandbox_path = sandbox.sandbox_root().to_path_buf();

            // Dispose with error, keep_sandbox is true
            let preserved = sandbox.dispose(true);
            assert!(preserved.is_some());
            assert_eq!(preserved.unwrap(), sandbox_path);

            // Sandbox should be preserved
            assert!(sandbox_path.exists());

            // Clean up manually
            fs::remove_dir_all(&sandbox_path).ok();
        }

        #[test]
        fn test_sandbox_cleanup_on_drop() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox_path;
            {
                let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();
                sandbox_path = sandbox.sandbox_root().to_path_buf();
                assert!(sandbox_path.exists());
                // sandbox drops here
            }

            // Sandbox should be cleaned up after drop
            assert!(!sandbox_path.exists());
        }
    }

    // ========================================================================
    // Verification Tests
    // ========================================================================

    mod verification_tests {
        use super::*;

        #[test]
        fn test_verification_runs_in_sandbox_cwd() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Run pwd to verify cwd
            #[cfg(unix)]
            let result = sandbox.run_verifier(&["pwd".to_string()]).unwrap();

            #[cfg(unix)]
            {
                assert!(result.success);
                let output_path = PathBuf::from(result.stdout.trim());
                assert_eq!(output_path, sandbox.workspace_dir().canonicalize().unwrap());
            }
        }

        #[test]
        fn test_verification_sets_environment() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Check TUG_SANDBOX env var
            #[cfg(unix)]
            let result = sandbox
                .run_verifier(&[
                    "sh".to_string(),
                    "-c".to_string(),
                    "echo $TUG_SANDBOX".to_string(),
                ])
                .unwrap();

            #[cfg(unix)]
            {
                assert!(result.success);
                assert_eq!(result.stdout.trim(), "1");
            }
        }

        #[test]
        #[cfg(unix)]
        fn test_verification_timeout_kills_long_running_command() {
            let workspace = create_test_workspace();
            // Set a very short timeout (500ms)
            let config = SandboxConfig::for_language(Language::Python)
                .with_timeout(Duration::from_millis(500));

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Run a command that sleeps for 10 seconds (should be killed)
            let result = sandbox
                .run_verifier(&["sleep".to_string(), "10".to_string()])
                .unwrap();

            // Should fail due to timeout
            assert!(!result.success);
            assert!(
                result.exit_code.is_none(),
                "Killed process should have no exit code"
            );
            assert!(
                result.stderr.contains("timed out"),
                "stderr should mention timeout: {}",
                result.stderr
            );
            // Duration should be close to the timeout (500ms), not 10 seconds
            assert!(
                result.duration < Duration::from_secs(2),
                "Should have timed out quickly, not waited 10s: {:?}",
                result.duration
            );
        }

        #[test]
        #[cfg(unix)]
        fn test_verification_completes_before_timeout() {
            let workspace = create_test_workspace();
            // Set a long timeout (30s)
            let config =
                SandboxConfig::for_language(Language::Python).with_timeout(Duration::from_secs(30));

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Run a quick command
            let result = sandbox
                .run_verifier(&["echo".to_string(), "fast".to_string()])
                .unwrap();

            // Should succeed quickly
            assert!(result.success);
            assert_eq!(result.stdout.trim(), "fast");
            assert!(
                result.duration < Duration::from_secs(5),
                "Quick command should complete fast: {:?}",
                result.duration
            );
        }
    }

    // ========================================================================
    // Symlink Tests
    // ========================================================================

    mod symlink_tests {
        use super::*;

        #[test]
        #[cfg(unix)]
        fn test_symlink_within_workspace() {
            let workspace = create_test_workspace();

            // Create a symlink within workspace
            let src_dir = workspace.path().join("src");
            let link_path = src_dir.join("main_link.py");
            std::os::unix::fs::symlink(src_dir.join("main.py"), &link_path).unwrap();

            let config = SandboxConfig::for_language(Language::Python);
            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // The symlink target content should be copied
            let copied_link = sandbox.workspace_dir().join("src/main_link.py");
            assert!(copied_link.exists());

            // It should be a regular file (not a symlink) with the same content
            assert!(!copied_link.is_symlink());
            let content = fs::read_to_string(&copied_link).unwrap();
            assert!(content.contains("def main()"));
        }

        #[test]
        #[cfg(unix)]
        fn test_symlink_outside_workspace_skipped() {
            let workspace = create_test_workspace();

            // Create a symlink pointing outside workspace
            let src_dir = workspace.path().join("src");
            let link_path = src_dir.join("external_link.py");
            std::os::unix::fs::symlink("/etc/passwd", &link_path).unwrap();

            let config = SandboxConfig::for_language(Language::Python);
            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // The external symlink should be skipped
            assert!(!sandbox
                .workspace_dir()
                .join("src/external_link.py")
                .exists());

            // And recorded in skipped_symlinks
            assert!(!sandbox.skipped_symlinks().is_empty());
        }
    }

    // ========================================================================
    // Apply Engine Tests
    // ========================================================================

    mod apply_engine_tests {
        use super::*;

        fn create_simple_patch() -> (PatchSet, HashMap<FileId, Vec<u8>>) {
            let file_id = FileId::new(0);
            let content = b"def foo():\n    pass\n";

            let anchor = Anchor::SpanExact {
                span: Span::new(4, 7), // "foo"
                expected_before_hash: ContentHash::compute(b"foo"),
            };

            let edit = Edit::replace(0, file_id, anchor, "bar");

            let mut patch = PatchSet::new(WorkspaceSnapshotId::new("test"));
            patch.edits.push(edit);
            patch.file_paths.insert(file_id, "test.py".to_string());

            let mut contents = HashMap::new();
            contents.insert(file_id, content.to_vec());

            (patch, contents)
        }

        #[test]
        fn test_preview_reports_conflicts() {
            let file_id = FileId::new(0);
            let content = b"def foo():\n    pass\n";

            // Create overlapping edits
            let anchor1 = Anchor::SpanExact {
                span: Span::new(4, 7),
                expected_before_hash: ContentHash::compute(b"foo"),
            };
            let anchor2 = Anchor::SpanExact {
                span: Span::new(5, 8), // Overlaps with anchor1
                expected_before_hash: ContentHash::compute(b"oo("),
            };

            let mut patch = PatchSet::new(WorkspaceSnapshotId::new("test"));
            patch.edits.push(Edit::replace(0, file_id, anchor1, "bar"));
            patch.edits.push(Edit::replace(1, file_id, anchor2, "xxx"));
            patch.file_paths.insert(file_id, "test.py".to_string());

            let mut contents = HashMap::new();
            contents.insert(file_id, content.to_vec());

            let preview = patch.preview(&contents);

            assert!(!preview.is_valid);
            assert!(!preview.conflicts.is_empty());

            // Should detect overlapping spans
            let has_overlap_conflict = preview
                .conflicts
                .iter()
                .any(|c| matches!(c, Conflict::OverlappingSpans { .. }));
            assert!(has_overlap_conflict);
        }

        #[test]
        fn test_preview_reports_missing_anchor() {
            let file_id = FileId::new(0);
            let content = b"def foo():\n    pass\n";

            // Create anchor that won't be found
            let anchor = Anchor::SpanExact {
                span: Span::new(4, 7),
                expected_before_hash: ContentHash::compute(b"xxx"), // Wrong hash
            };

            let mut patch = PatchSet::new(WorkspaceSnapshotId::new("test"));
            patch.edits.push(Edit::replace(0, file_id, anchor, "bar"));
            patch.file_paths.insert(file_id, "test.py".to_string());

            let mut contents = HashMap::new();
            contents.insert(file_id, content.to_vec());

            let preview = patch.preview(&contents);

            assert!(!preview.is_valid);

            // Should report hash mismatch
            let has_hash_conflict = preview
                .conflicts
                .iter()
                .any(|c| matches!(c, Conflict::AnchorHashMismatch { .. }));
            assert!(has_hash_conflict);
        }

        #[test]
        fn test_apply_enforces_atomicity() {
            let file_id = FileId::new(0);
            let content = b"def foo():\n    pass\n";

            // Create one valid edit and one invalid edit
            let anchor1 = Anchor::SpanExact {
                span: Span::new(4, 7),
                expected_before_hash: ContentHash::compute(b"foo"),
            };
            let anchor2 = Anchor::SpanExact {
                span: Span::new(100, 110), // Out of bounds
                expected_before_hash: ContentHash::compute(b"nonexistent"),
            };

            let mut patch = PatchSet::new(WorkspaceSnapshotId::new("test"));
            patch.edits.push(Edit::replace(0, file_id, anchor1, "bar"));
            patch.edits.push(Edit::replace(1, file_id, anchor2, "xxx"));
            patch.file_paths.insert(file_id, "test.py".to_string());

            let mut contents = HashMap::new();
            contents.insert(file_id, content.to_vec());

            let ctx = ApplyContext {
                snapshot_id: WorkspaceSnapshotId::new("test"),
                file_contents: contents.clone(),
                file_hashes: HashMap::new(),
            };

            let result = patch.apply(&ctx);

            // Should fail (not partial apply)
            assert!(matches!(result, ApplyResult::Failed { .. }));

            // Original content should be unchanged
            assert_eq!(contents.get(&file_id).unwrap(), content);
        }

        #[test]
        fn test_apply_success() {
            let (patch, contents) = create_simple_patch();

            let ctx = ApplyContext {
                snapshot_id: WorkspaceSnapshotId::new("test"),
                file_contents: contents,
                file_hashes: HashMap::new(),
            };

            let result = patch.apply(&ctx);

            if let ApplyResult::Success { modified_files } = result {
                let new_content = modified_files.get(&FileId::new(0)).unwrap();
                let new_str = String::from_utf8_lossy(new_content);
                assert!(new_str.contains("def bar()"));
                assert!(!new_str.contains("def foo()"));
            } else {
                panic!("Expected success");
            }
        }
    }

    // ========================================================================
    // Directory Structure Tests
    // ========================================================================

    mod structure_tests {
        use super::*;

        #[test]
        fn test_sandbox_directory_structure() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Check structure
            assert!(sandbox.workspace_dir().exists());
            assert!(sandbox.sandbox_root().join(".tug_meta").exists());
            assert!(sandbox
                .sandbox_root()
                .join(".tug_meta/original_root")
                .exists());
            assert!(sandbox
                .sandbox_root()
                .join(".tug_meta/file_manifest")
                .exists());
        }

        #[test]
        fn test_sandbox_metadata_files() {
            let workspace = create_test_workspace();
            let config = SandboxConfig::for_language(Language::Python);

            let sandbox = SandboxHandle::create(workspace.path(), config).unwrap();

            // Check original_root content
            let original_root =
                fs::read_to_string(sandbox.sandbox_root().join(".tug_meta/original_root")).unwrap();
            assert!(original_root.contains(workspace.path().to_str().unwrap()));

            // Check file_manifest content
            let manifest =
                fs::read_to_string(sandbox.sandbox_root().join(".tug_meta/file_manifest")).unwrap();
            assert!(manifest.contains("src/main.py"));
        }
    }

    // ========================================================================
    // Exclusion Pattern Tests
    // ========================================================================

    mod exclusion_tests {
        use super::*;

        #[test]
        fn test_should_exclude_git() {
            assert!(should_exclude(Path::new(".git/config")));
            assert!(should_exclude(Path::new("some/path/.git/HEAD")));
        }

        #[test]
        fn test_should_exclude_node_modules() {
            assert!(should_exclude(Path::new("node_modules/package/index.js")));
        }

        #[test]
        fn test_should_exclude_target() {
            assert!(should_exclude(Path::new("target/debug/main")));
        }

        #[test]
        fn test_should_not_exclude_source() {
            assert!(!should_exclude(Path::new("src/main.py")));
            assert!(!should_exclude(Path::new("lib/utils.rs")));
        }

        #[test]
        fn test_is_config_file() {
            assert!(is_config_file(Path::new("pyproject.toml")));
            assert!(is_config_file(Path::new("Cargo.toml")));
            assert!(is_config_file(Path::new("pytest.ini")));
            assert!(!is_config_file(Path::new("main.py")));
        }

        #[test]
        fn test_check_symlink_returns_error_for_broken_symlink() {
            let workspace = create_test_workspace();

            // Create a broken symlink (points to non-existent target)
            let broken_link = workspace.path().join("broken_link");

            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                symlink("/nonexistent/path/that/does/not/exist", &broken_link).unwrap();

                let result = check_symlink(&broken_link, workspace.path());

                // Should be Error (not OutsideWorkspace) because canonicalize fails
                assert!(
                    matches!(result, SymlinkCheck::Error(_)),
                    "Broken symlink should return Error, got {:?}",
                    result
                );
            }

            #[cfg(windows)]
            {
                // On Windows, symlink creation requires elevated privileges
                // Skip this test on Windows
            }
        }

        #[test]
        fn test_check_symlink_within_workspace() {
            let workspace = create_test_workspace();

            // Create a file and a symlink to it within the workspace
            let target_file = workspace.path().join("target.txt");
            fs::write(&target_file, "content").unwrap();

            let symlink_path = workspace.path().join("link_to_target");

            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                symlink(&target_file, &symlink_path).unwrap();

                let result = check_symlink(&symlink_path, workspace.path());

                assert!(
                    matches!(result, SymlinkCheck::WithinWorkspace(_)),
                    "Symlink to file within workspace should be WithinWorkspace, got {:?}",
                    result
                );
            }

            #[cfg(windows)]
            {
                // Skip on Windows
            }
        }

        #[test]
        fn test_check_symlink_outside_workspace() {
            let workspace = create_test_workspace();

            // Create a symlink to something outside the workspace
            let symlink_path = workspace.path().join("link_to_outside");

            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;
                // Link to /tmp which should exist and be outside our workspace
                symlink("/tmp", &symlink_path).unwrap();

                let result = check_symlink(&symlink_path, workspace.path());

                assert!(
                    matches!(result, SymlinkCheck::OutsideWorkspace(_)),
                    "Symlink to /tmp should be OutsideWorkspace, got {:?}",
                    result
                );
            }

            #[cfg(windows)]
            {
                // Skip on Windows
            }
        }

        #[test]
        fn test_check_symlink_not_symlink() {
            let workspace = create_test_workspace();

            // Create a regular file
            let regular_file = workspace.path().join("regular.txt");
            fs::write(&regular_file, "content").unwrap();

            let result = check_symlink(&regular_file, workspace.path());

            assert!(
                matches!(result, SymlinkCheck::NotSymlink),
                "Regular file should return NotSymlink, got {:?}",
                result
            );
        }

        #[test]
        fn refactor_report_byte_counts_from_edits() {
            use crate::patch::{Anchor, Edit, PatchSet, WorkspaceSnapshotId};

            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(0);

            // Create edits: delete 10 bytes, insert 10 bytes (equal amounts)
            // Old behavior would show 0 change; new behavior should show both
            let delete_edit = Edit::replace(
                1,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(0, 10), // Delete 10 bytes
                    expected_before_hash: ContentHash::compute(b"0123456789"),
                },
                "", // Replace with nothing = delete
            );

            let insert_edit = Edit::insert(
                2,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(20, 20), // Insert point
                    expected_before_hash: ContentHash::compute(b""),
                },
                "abcdefghij", // Insert 10 bytes
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_edit(delete_edit)
                .with_edit(insert_edit)
                .with_file_path(file_id, "test.py");

            // Simulate successful apply
            let mut modified_files = HashMap::new();
            modified_files.insert(file_id, b"modified content".to_vec());

            let result = ApplyResult::Success { modified_files };

            // Original contents (same length as final, so old algo would show 0 change)
            let mut original_contents = HashMap::new();
            original_contents.insert(file_id, b"original content".to_vec());

            let report = RefactorReport::from_apply_result(&result, &patch, &original_contents);

            // New behavior: counts actual edit spans and text lengths
            assert_eq!(report.bytes_deleted, 10, "Should count 10 bytes deleted");
            assert_eq!(report.bytes_inserted, 10, "Should count 10 bytes inserted");
            assert_eq!(report.files_changed, 1);
        }

        #[test]
        fn refactor_report_replace_counts_both_deleted_and_inserted() {
            use crate::patch::{Anchor, Edit, PatchSet, WorkspaceSnapshotId};

            let snapshot_id = WorkspaceSnapshotId::new("test");
            let file_id = FileId::new(0);

            // Replace 5 bytes with 15 bytes
            let replace_edit = Edit::replace(
                1,
                file_id,
                Anchor::SpanExact {
                    span: Span::new(0, 5), // Delete 5 bytes
                    expected_before_hash: ContentHash::compute(b"hello"),
                },
                "hello world!!!", // Insert 14 bytes
            );

            let patch = PatchSet::new(snapshot_id.clone())
                .with_edit(replace_edit)
                .with_file_path(file_id, "test.py");

            let mut modified_files = HashMap::new();
            modified_files.insert(file_id, b"hello world!!! rest".to_vec());

            let result = ApplyResult::Success { modified_files };
            let original_contents = HashMap::new();

            let report = RefactorReport::from_apply_result(&result, &patch, &original_contents);

            assert_eq!(
                report.bytes_deleted, 5,
                "Replace should count span as deleted"
            );
            assert_eq!(
                report.bytes_inserted, 14,
                "Replace should count replacement text as inserted"
            );
        }
    }
}
