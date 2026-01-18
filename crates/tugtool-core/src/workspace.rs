//! WorkspaceSnapshot and file inventory for refactoring transactions.
//!
//! This module provides the core abstraction for tracking workspace state:
//! - Immutable file inventory with content hashes
//! - Deterministic file ordering (sorted by path)
//! - Stable FileId assignment within a snapshot
//! - Snapshot creation modes (InPlace, SandboxCopy)

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::SystemTime;
use walkdir::WalkDir;

use crate::patch::{ContentHash, FileId, WorkspaceSnapshotId};

// ============================================================================
// Language Detection
// ============================================================================

/// Supported programming languages for refactoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// Python source files (.py)
    Python,
    /// Rust source files (.rs)
    Rust,
    /// Unknown or unsupported language
    Unknown,
}

impl Language {
    /// Detect language from file extension.
    pub fn from_path(path: &Path) -> Self {
        match path.extension().and_then(|e| e.to_str()) {
            Some("py") => Language::Python,
            Some("rs") => Language::Rust,
            _ => Language::Unknown,
        }
    }

    /// Get the typical file extension for this language.
    pub fn extension(&self) -> Option<&'static str> {
        match self {
            Language::Python => Some("py"),
            Language::Rust => Some("rs"),
            Language::Unknown => None,
        }
    }

    /// Get glob patterns for this language.
    pub fn glob_patterns(&self) -> &'static [&'static str] {
        match self {
            Language::Python => &["**/*.py"],
            Language::Rust => &["**/*.rs"],
            Language::Unknown => &[],
        }
    }
}

impl fmt::Display for Language {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Language::Python => write!(f, "python"),
            Language::Rust => write!(f, "rust"),
            Language::Unknown => write!(f, "unknown"),
        }
    }
}

// ============================================================================
// File Information
// ============================================================================

/// Information about a single file in the workspace snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileInfo {
    /// Relative path from workspace root (always forward slashes for consistency).
    pub path: String,
    /// SHA-256 hash of file content.
    pub content_hash: ContentHash,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Detected programming language.
    pub language: Language,
    /// File modification time (for change detection).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<SystemTime>,
}

impl FileInfo {
    /// Create a new FileInfo from a file path.
    ///
    /// Reads the file to compute its hash and size.
    pub fn from_file(workspace_root: &Path, relative_path: &str) -> io::Result<Self> {
        let full_path = workspace_root.join(relative_path);
        let content = fs::read(&full_path)?;
        let metadata = fs::metadata(&full_path)?;

        Ok(FileInfo {
            path: relative_path.to_string(),
            content_hash: ContentHash::compute(&content),
            size_bytes: metadata.len(),
            language: Language::from_path(Path::new(relative_path)),
            mtime: metadata.modified().ok(),
        })
    }

    /// Create a FileInfo from existing content (for testing or cached scenarios).
    pub fn from_content(path: &str, content: &[u8]) -> Self {
        FileInfo {
            path: path.to_string(),
            content_hash: ContentHash::compute(content),
            size_bytes: content.len() as u64,
            language: Language::from_path(Path::new(path)),
            mtime: None,
        }
    }
}

// ============================================================================
// Snapshot Mode
// ============================================================================

/// Mode for creating and operating on workspace snapshots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum SnapshotMode {
    /// Operate directly on the working tree.
    ///
    /// Edits are applied in-place. Suitable for:
    /// - Preview operations (read-only)
    /// - Trusted agents with git backup
    /// - Performance-critical scenarios
    InPlace,

    /// Copy workspace to temp directory for safe operations.
    ///
    /// The SandboxCopy mode provides atomic semantics:
    /// 1. Copy workspace to temp dir
    /// 2. Apply patches in sandbox
    /// 3. Run verification (tests, type checking)
    /// 4. Only if verification passes: emit patches back to real workspace
    ///
    /// This is the recommended mode for verification per [D05].
    #[default]
    SandboxCopy,
}

impl fmt::Display for SnapshotMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SnapshotMode::InPlace => write!(f, "in_place"),
            SnapshotMode::SandboxCopy => write!(f, "sandbox_copy"),
        }
    }
}

// ============================================================================
// Snapshot Configuration
// ============================================================================

/// Configuration for workspace snapshot creation.
#[derive(Debug, Clone, Default)]
pub struct SnapshotConfig {
    /// Languages to include (empty = all supported languages).
    pub languages: Vec<Language>,
    /// Additional glob patterns to include.
    pub include_patterns: Vec<String>,
    /// Glob patterns to exclude (in addition to defaults).
    pub exclude_patterns: Vec<String>,
    /// Whether to follow symlinks.
    pub follow_symlinks: bool,
    /// Maximum file size to include (bytes). Files larger are skipped.
    pub max_file_size: Option<u64>,
}

impl SnapshotConfig {
    /// Create a new config for a specific language.
    pub fn for_language(language: Language) -> Self {
        SnapshotConfig {
            languages: vec![language],
            ..Default::default()
        }
    }

    /// Create a config that includes all supported languages.
    pub fn all_languages() -> Self {
        SnapshotConfig {
            languages: vec![Language::Python, Language::Rust],
            ..Default::default()
        }
    }

    /// Add an exclude pattern.
    pub fn exclude(mut self, pattern: &str) -> Self {
        self.exclude_patterns.push(pattern.to_string());
        self
    }
}

// ============================================================================
// Default Exclusion Patterns
// ============================================================================

/// Default directories to exclude from workspace snapshots.
const DEFAULT_EXCLUDE_DIRS: &[&str] = &[
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
    "*.egg-info",
    ".tox",
    ".nox",
    ".coverage",
    "htmlcov",
    ".hypothesis",
];

/// Check if a path should be excluded based on default patterns.
fn should_exclude(path: &Path) -> bool {
    // Check each component of the path
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_string_lossy();
            for pattern in DEFAULT_EXCLUDE_DIRS {
                if let Some(suffix) = pattern.strip_prefix('*') {
                    // Simple suffix match for patterns like "*.egg-info"
                    if name_str.ends_with(suffix) {
                        return true;
                    }
                } else if name_str == *pattern {
                    return true;
                }
            }
        }
    }
    false
}

// ============================================================================
// Workspace Snapshot
// ============================================================================

/// Immutable view of files and hashes used as the basis for planning and applying changes.
///
/// A WorkspaceSnapshot captures the exact state of the workspace at a point in time:
/// - All files matching the language filter
/// - Content hashes for each file
/// - Deterministic file ordering (sorted by path)
/// - Stable FileId assignment
///
/// Snapshots are used to:
/// 1. Detect if files changed between analyze and apply (SnapshotMismatch error)
/// 2. Validate patch preconditions
/// 3. Cache analysis results
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceSnapshot {
    /// Unique identifier for this snapshot.
    pub snapshot_id: WorkspaceSnapshotId,
    /// When the snapshot was created.
    pub created_at: SystemTime,
    /// Workspace root directory (absolute path).
    pub workspace_root: PathBuf,
    /// Number of files in the snapshot.
    pub file_count: usize,
    /// Total bytes across all files.
    pub total_bytes: u64,
    /// File information indexed by FileId.
    files: Vec<FileInfo>,
    /// Map from relative path to FileId for fast lookup.
    #[serde(skip)]
    path_to_id: HashMap<String, FileId>,
    /// Thread-safe cached file contents (lazy-loaded).
    /// Uses RwLock for safe concurrent access.
    #[serde(skip)]
    content_cache: RwLock<HashMap<FileId, Vec<u8>>>,
}

impl Clone for WorkspaceSnapshot {
    fn clone(&self) -> Self {
        let cache = self
            .content_cache
            .read()
            .expect("content_cache RwLock poisoned");
        WorkspaceSnapshot {
            snapshot_id: self.snapshot_id.clone(),
            created_at: self.created_at,
            workspace_root: self.workspace_root.clone(),
            file_count: self.file_count,
            total_bytes: self.total_bytes,
            files: self.files.clone(),
            path_to_id: self.path_to_id.clone(),
            content_cache: RwLock::new(cache.clone()),
        }
    }
}

impl WorkspaceSnapshot {
    /// Create a new snapshot by scanning the workspace.
    ///
    /// Files are ordered deterministically by path (lexicographic sort).
    /// FileIds are assigned based on this ordering and are stable within the snapshot.
    pub fn create(workspace_root: &Path, config: &SnapshotConfig) -> io::Result<Self> {
        let workspace_root = workspace_root.canonicalize()?;
        let mut file_infos: Vec<FileInfo> = Vec::new();

        // Walk the workspace and collect file information
        for entry in WalkDir::new(&workspace_root)
            .follow_links(config.follow_symlinks)
            .into_iter()
            .filter_entry(|e| !should_exclude(e.path()))
        {
            let entry = entry?;
            if !entry.file_type().is_file() {
                continue;
            }

            let full_path = entry.path();
            let relative_path = full_path
                .strip_prefix(&workspace_root)
                .map_err(io::Error::other)?;

            // Convert to forward slashes for consistency
            let relative_str = relative_path
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");

            // Check language filter
            let language = Language::from_path(full_path);
            if !config.languages.is_empty() && !config.languages.contains(&language) {
                // Skip files not matching language filter (unless it's a config file)
                if language == Language::Unknown && !is_config_file(&relative_str) {
                    continue;
                }
                if language != Language::Unknown && !config.languages.contains(&language) {
                    continue;
                }
            }

            // Check file size
            let metadata = fs::metadata(full_path)?;
            if let Some(max_size) = config.max_file_size {
                if metadata.len() > max_size {
                    continue;
                }
            }

            // Check custom exclude patterns
            let should_skip = config.exclude_patterns.iter().any(|pattern| {
                // Simple glob matching (supports * wildcard)
                if pattern.contains('*') {
                    let parts: Vec<&str> = pattern.split('*').collect();
                    if parts.len() == 2 {
                        relative_str.starts_with(parts[0]) && relative_str.ends_with(parts[1])
                    } else {
                        false
                    }
                } else {
                    relative_str.contains(pattern)
                }
            });
            if should_skip {
                continue;
            }

            file_infos.push(FileInfo::from_file(&workspace_root, &relative_str)?);
        }

        // Sort files by path for deterministic ordering
        file_infos.sort_by(|a, b| a.path.cmp(&b.path));

        // Build path-to-id map
        let path_to_id: HashMap<String, FileId> = file_infos
            .iter()
            .enumerate()
            .map(|(idx, info)| (info.path.clone(), FileId::new(idx as u32)))
            .collect();

        // Calculate totals
        let total_bytes: u64 = file_infos.iter().map(|f| f.size_bytes).sum();

        // Generate snapshot ID from content hashes (deterministic)
        let snapshot_id = generate_snapshot_id(&file_infos);

        Ok(WorkspaceSnapshot {
            snapshot_id,
            created_at: SystemTime::now(),
            workspace_root,
            file_count: file_infos.len(),
            total_bytes,
            files: file_infos,
            path_to_id,
            content_cache: RwLock::new(HashMap::new()),
        })
    }

    /// Create a snapshot from a list of files (for testing or synthetic scenarios).
    pub fn from_files(workspace_root: PathBuf, files: Vec<FileInfo>) -> Self {
        let mut files = files;
        // Sort for deterministic ordering
        files.sort_by(|a, b| a.path.cmp(&b.path));

        let path_to_id: HashMap<String, FileId> = files
            .iter()
            .enumerate()
            .map(|(idx, info)| (info.path.clone(), FileId::new(idx as u32)))
            .collect();

        let total_bytes: u64 = files.iter().map(|f| f.size_bytes).sum();
        let snapshot_id = generate_snapshot_id(&files);

        WorkspaceSnapshot {
            snapshot_id,
            created_at: SystemTime::now(),
            workspace_root,
            file_count: files.len(),
            total_bytes,
            files,
            path_to_id,
            content_cache: RwLock::new(HashMap::new()),
        }
    }

    /// Create an empty snapshot (for testing or placeholder scenarios).
    pub fn new_empty(workspace_root: &Path, snapshot_id: WorkspaceSnapshotId) -> Self {
        WorkspaceSnapshot {
            snapshot_id,
            created_at: SystemTime::now(),
            workspace_root: workspace_root.to_path_buf(),
            file_count: 0,
            total_bytes: 0,
            files: Vec::new(),
            path_to_id: HashMap::new(),
            content_cache: RwLock::new(HashMap::new()),
        }
    }

    /// Restore internal indexes after deserialization.
    ///
    /// This method must be called after deserializing a `WorkspaceSnapshot` from JSON,
    /// as the `path_to_id` field is not serialized (marked with `#[serde(skip)]`).
    pub fn restore_indexes(&mut self) {
        self.path_to_id = self
            .files
            .iter()
            .enumerate()
            .map(|(idx, info)| (info.path.clone(), FileId::new(idx as u32)))
            .collect();
    }

    /// Get the FileId for a given relative path.
    pub fn file_id(&self, path: &str) -> Option<FileId> {
        self.path_to_id.get(path).copied()
    }

    /// Get the FileInfo for a given FileId.
    pub fn file_info(&self, file_id: FileId) -> Option<&FileInfo> {
        self.files.get(file_id.0 as usize)
    }

    /// Get the FileInfo for a given path.
    pub fn file_info_by_path(&self, path: &str) -> Option<&FileInfo> {
        self.file_id(path).and_then(|id| self.file_info(id))
    }

    /// Get all files in the snapshot (in deterministic order).
    pub fn files(&self) -> &[FileInfo] {
        &self.files
    }

    /// Iterate over all (FileId, FileInfo) pairs in order.
    pub fn iter(&self) -> impl Iterator<Item = (FileId, &FileInfo)> {
        self.files
            .iter()
            .enumerate()
            .map(|(idx, info)| (FileId::new(idx as u32), info))
    }

    /// Get the number of files in the snapshot.
    pub fn len(&self) -> usize {
        self.file_count
    }

    /// Check if the snapshot is empty.
    pub fn is_empty(&self) -> bool {
        self.file_count == 0
    }

    /// Get file content, loading from disk if not cached.
    ///
    /// Thread-safe: can be called concurrently from multiple threads.
    /// Returns owned data to avoid lifetime issues with the internal lock.
    pub fn get_content(&self, file_id: FileId) -> io::Result<Vec<u8>> {
        // First, try to get from cache with a read lock
        {
            let cache = self
                .content_cache
                .read()
                .expect("content_cache RwLock poisoned");
            if let Some(content) = cache.get(&file_id) {
                return Ok(content.clone());
            }
        }

        // Not in cache - need to load from disk
        let info = self.file_info(file_id).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("FileId not found: {}", file_id),
            )
        })?;
        let full_path = self.workspace_root.join(&info.path);
        let content = fs::read(full_path)?;

        // Insert into cache with write lock
        {
            let mut cache = self
                .content_cache
                .write()
                .expect("content_cache RwLock poisoned");
            cache.insert(file_id, content.clone());
        }

        Ok(content)
    }

    /// Preload content for all files into the cache.
    ///
    /// Thread-safe: can be called concurrently from multiple threads.
    pub fn preload_all(&self) -> io::Result<()> {
        let file_ids: Vec<FileId> = (0..self.file_count as u32).map(FileId::new).collect();
        for file_id in file_ids {
            self.get_content(file_id)?;
        }
        Ok(())
    }

    /// Clear the content cache to free memory.
    ///
    /// Thread-safe: can be called concurrently from multiple threads.
    pub fn clear_cache(&self) {
        let mut cache = self
            .content_cache
            .write()
            .expect("content_cache RwLock poisoned");
        cache.clear();
    }

    /// Validate that the snapshot still matches the filesystem.
    ///
    /// Returns a list of files that have changed (or been deleted).
    ///
    /// # TOCTOU Warning (Time-of-Check-Time-of-Use)
    ///
    /// This method is **advisory only**. A file can change between when this method
    /// checks it and when you subsequently use the snapshot data. Do NOT rely on this
    /// for correctness guarantees.
    ///
    /// For safe concurrent access patterns, use **Optimistic Concurrency Control (OCC)**:
    /// 1. Capture the snapshot ID before operations
    /// 2. Perform your work
    /// 3. Re-verify the snapshot ID matches before committing changes
    ///
    /// The OCC pattern is implemented in `Session::save_snapshot_atomic` and
    /// `PatchSet::apply` which check `Precondition::SnapshotIsCurrent`.
    pub fn validate(&self) -> io::Result<Vec<SnapshotMismatch>> {
        let mut mismatches = Vec::new();

        for (file_id, info) in self.iter() {
            let full_path = self.workspace_root.join(&info.path);

            if !full_path.exists() {
                mismatches.push(SnapshotMismatch {
                    file_id,
                    path: info.path.clone(),
                    kind: MismatchKind::Deleted,
                });
                continue;
            }

            let content = fs::read(&full_path)?;
            let current_hash = ContentHash::compute(&content);

            if current_hash != info.content_hash {
                mismatches.push(SnapshotMismatch {
                    file_id,
                    path: info.path.clone(),
                    kind: MismatchKind::ContentChanged {
                        expected: info.content_hash.clone(),
                        actual: current_hash,
                    },
                });
            }
        }

        Ok(mismatches)
    }

    /// Check if the snapshot is still current (no files have changed).
    ///
    /// **Note:** This has the same TOCTOU limitations as [`validate()`](Self::validate).
    /// Use OCC patterns for correctness guarantees.
    pub fn is_current(&self) -> io::Result<bool> {
        Ok(self.validate()?.is_empty())
    }
}

/// Generate a deterministic snapshot ID from file hashes.
fn generate_snapshot_id(files: &[FileInfo]) -> WorkspaceSnapshotId {
    let mut hasher = Sha256::new();

    // Hash all file paths and content hashes in order
    for file in files {
        hasher.update(file.path.as_bytes());
        hasher.update(b":");
        hasher.update(file.content_hash.0.as_bytes());
        hasher.update(b"\n");
    }

    let result = hasher.finalize();
    // Use first 12 hex chars for readable ID
    let hex = hex::encode(&result[..6]);
    WorkspaceSnapshotId::new(format!("snap_{}", hex))
}

/// Check if a file is a configuration file that should be included regardless of language.
fn is_config_file(path: &str) -> bool {
    let config_files = [
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

    let filename = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    config_files.contains(&filename)
}

// ============================================================================
// Snapshot Validation
// ============================================================================

/// A mismatch between snapshot and current filesystem state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotMismatch {
    /// The file ID in the snapshot.
    pub file_id: FileId,
    /// The relative path of the file.
    pub path: String,
    /// The kind of mismatch.
    pub kind: MismatchKind,
}

/// The kind of mismatch between snapshot and filesystem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MismatchKind {
    /// File was deleted from the filesystem.
    Deleted,
    /// File content changed.
    ContentChanged {
        expected: ContentHash,
        actual: ContentHash,
    },
}

impl fmt::Display for SnapshotMismatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            MismatchKind::Deleted => write!(f, "{}: deleted", self.path),
            MismatchKind::ContentChanged { expected, actual } => {
                write!(
                    f,
                    "{}: content changed (expected {}, got {})",
                    self.path, expected, actual
                )
            }
        }
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

    /// Create a test workspace with some files.
    fn create_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create Python files
        let src_dir = dir.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();

        File::create(src_dir.join("main.py"))
            .unwrap()
            .write_all(b"def main():\n    pass\n")
            .unwrap();

        File::create(src_dir.join("utils.py"))
            .unwrap()
            .write_all(b"def helper():\n    return 42\n")
            .unwrap();

        // Create Rust files
        File::create(src_dir.join("lib.rs"))
            .unwrap()
            .write_all(b"pub fn greet() {}\n")
            .unwrap();

        // Create a config file
        File::create(dir.path().join("pyproject.toml"))
            .unwrap()
            .write_all(b"[project]\nname = \"test\"\n")
            .unwrap();

        dir
    }

    // ========================================================================
    // Hashing Stability Tests
    // ========================================================================

    mod hashing_tests {
        use super::*;

        #[test]
        fn test_same_bytes_produce_same_hash() {
            let content = b"def foo():\n    pass\n";

            let hash1 = ContentHash::compute(content);
            let hash2 = ContentHash::compute(content);

            assert_eq!(hash1, hash2);
        }

        #[test]
        fn test_different_bytes_produce_different_hash() {
            let content1 = b"def foo():\n    pass\n";
            let content2 = b"def bar():\n    pass\n";

            let hash1 = ContentHash::compute(content1);
            let hash2 = ContentHash::compute(content2);

            assert_ne!(hash1, hash2);
        }

        #[test]
        fn test_snapshot_id_is_deterministic() {
            let files = vec![
                FileInfo::from_content("src/a.py", b"# file a"),
                FileInfo::from_content("src/b.py", b"# file b"),
            ];

            let id1 = generate_snapshot_id(&files);
            let id2 = generate_snapshot_id(&files);

            assert_eq!(id1, id2);
        }

        #[test]
        fn test_snapshot_id_changes_with_content() {
            let files1 = vec![
                FileInfo::from_content("src/a.py", b"# file a"),
                FileInfo::from_content("src/b.py", b"# file b"),
            ];

            let files2 = vec![
                FileInfo::from_content("src/a.py", b"# file a modified"),
                FileInfo::from_content("src/b.py", b"# file b"),
            ];

            let id1 = generate_snapshot_id(&files1);
            let id2 = generate_snapshot_id(&files2);

            assert_ne!(id1, id2);
        }
    }

    // ========================================================================
    // File Ordering Tests
    // ========================================================================

    mod ordering_tests {
        use super::*;

        #[test]
        fn test_files_are_sorted_by_path() {
            // Create files in non-sorted order
            let files = vec![
                FileInfo::from_content("z/file.py", b"z"),
                FileInfo::from_content("a/file.py", b"a"),
                FileInfo::from_content("m/file.py", b"m"),
            ];

            let snapshot = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files);

            let paths: Vec<&str> = snapshot.files().iter().map(|f| f.path.as_str()).collect();
            assert_eq!(paths, vec!["a/file.py", "m/file.py", "z/file.py"]);
        }

        #[test]
        fn test_ordering_is_stable_across_creations() {
            let files1 = vec![
                FileInfo::from_content("b.py", b"b"),
                FileInfo::from_content("a.py", b"a"),
                FileInfo::from_content("c.py", b"c"),
            ];

            let files2 = vec![
                FileInfo::from_content("c.py", b"c"),
                FileInfo::from_content("a.py", b"a"),
                FileInfo::from_content("b.py", b"b"),
            ];

            let snap1 = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files1);
            let snap2 = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files2);

            // Both should produce same ordering
            let paths1: Vec<&str> = snap1.files().iter().map(|f| f.path.as_str()).collect();
            let paths2: Vec<&str> = snap2.files().iter().map(|f| f.path.as_str()).collect();

            assert_eq!(paths1, paths2);
            assert_eq!(paths1, vec!["a.py", "b.py", "c.py"]);
        }

        #[test]
        fn test_identical_tree_produces_identical_snapshot() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::all_languages();

            let snap1 = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();
            let snap2 = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Same files in same order
            assert_eq!(snap1.file_count, snap2.file_count);
            assert_eq!(snap1.snapshot_id, snap2.snapshot_id);

            for (f1, f2) in snap1.files().iter().zip(snap2.files().iter()) {
                assert_eq!(f1.path, f2.path);
                assert_eq!(f1.content_hash, f2.content_hash);
            }
        }
    }

    // ========================================================================
    // FileId Stability Tests
    // ========================================================================

    mod file_id_tests {
        use super::*;

        #[test]
        fn test_file_id_is_stable_within_snapshot() {
            let files = vec![
                FileInfo::from_content("alpha.py", b"a"),
                FileInfo::from_content("beta.py", b"b"),
                FileInfo::from_content("gamma.py", b"g"),
            ];

            let snapshot = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files);

            // FileIds should be deterministic based on sorted order
            assert_eq!(snapshot.file_id("alpha.py"), Some(FileId::new(0)));
            assert_eq!(snapshot.file_id("beta.py"), Some(FileId::new(1)));
            assert_eq!(snapshot.file_id("gamma.py"), Some(FileId::new(2)));

            // Look up by FileId should return correct info
            assert_eq!(
                snapshot.file_info(FileId::new(0)).map(|f| f.path.as_str()),
                Some("alpha.py")
            );
            assert_eq!(
                snapshot.file_info(FileId::new(1)).map(|f| f.path.as_str()),
                Some("beta.py")
            );
            assert_eq!(
                snapshot.file_info(FileId::new(2)).map(|f| f.path.as_str()),
                Some("gamma.py")
            );
        }

        #[test]
        fn test_file_id_lookup_nonexistent() {
            let files = vec![FileInfo::from_content("only.py", b"x")];
            let snapshot = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files);

            assert_eq!(snapshot.file_id("missing.py"), None);
            assert_eq!(snapshot.file_info(FileId::new(99)), None);
        }

        #[test]
        fn test_file_id_matches_iteration_order() {
            let files = vec![
                FileInfo::from_content("z.py", b"z"),
                FileInfo::from_content("a.py", b"a"),
            ];

            let snapshot = WorkspaceSnapshot::from_files(PathBuf::from("/test"), files);

            // Iteration should be in sorted order with correct FileIds
            let pairs: Vec<_> = snapshot.iter().collect();

            assert_eq!(pairs.len(), 2);
            assert_eq!(pairs[0].0, FileId::new(0));
            assert_eq!(pairs[0].1.path, "a.py");
            assert_eq!(pairs[1].0, FileId::new(1));
            assert_eq!(pairs[1].1.path, "z.py");
        }
    }

    // ========================================================================
    // Content Hash Verification Tests
    // ========================================================================

    mod content_hash_tests {
        use super::*;

        #[test]
        fn test_content_hash_matches_file_bytes() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Find main.py
            let main_info = snapshot.file_info_by_path("src/main.py").unwrap();

            // Read actual file bytes
            let actual_bytes = fs::read(workspace.path().join("src/main.py")).unwrap();
            let actual_hash = ContentHash::compute(&actual_bytes);

            assert_eq!(main_info.content_hash, actual_hash);
        }

        #[test]
        fn test_content_hash_detects_changes() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Modify a file
            let main_path = workspace.path().join("src/main.py");
            fs::write(&main_path, b"def main():\n    print('modified')\n").unwrap();

            // Validation should detect the change
            let mismatches = snapshot.validate().unwrap();

            assert_eq!(mismatches.len(), 1);
            assert_eq!(mismatches[0].path, "src/main.py");
            assert!(matches!(
                mismatches[0].kind,
                MismatchKind::ContentChanged { .. }
            ));
        }

        #[test]
        fn test_content_hash_detects_deletion() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Delete a file
            fs::remove_file(workspace.path().join("src/utils.py")).unwrap();

            // Validation should detect the deletion
            let mismatches = snapshot.validate().unwrap();

            assert_eq!(mismatches.len(), 1);
            assert_eq!(mismatches[0].path, "src/utils.py");
            assert!(matches!(mismatches[0].kind, MismatchKind::Deleted));
        }

        #[test]
        fn test_is_current_returns_true_when_unchanged() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            assert!(snapshot.is_current().unwrap());
        }

        #[test]
        fn test_is_current_returns_false_when_changed() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Modify a file
            fs::write(workspace.path().join("src/main.py"), b"# changed content\n").unwrap();

            assert!(!snapshot.is_current().unwrap());
        }
    }

    // ========================================================================
    // Language Detection Tests
    // ========================================================================

    mod language_tests {
        use super::*;

        #[test]
        fn test_language_detection_python() {
            assert_eq!(Language::from_path(Path::new("foo.py")), Language::Python);
            assert_eq!(
                Language::from_path(Path::new("src/main.py")),
                Language::Python
            );
        }

        #[test]
        fn test_language_detection_rust() {
            assert_eq!(Language::from_path(Path::new("foo.rs")), Language::Rust);
            assert_eq!(Language::from_path(Path::new("src/lib.rs")), Language::Rust);
        }

        #[test]
        fn test_language_detection_unknown() {
            assert_eq!(
                Language::from_path(Path::new("README.md")),
                Language::Unknown
            );
            assert_eq!(
                Language::from_path(Path::new("file.txt")),
                Language::Unknown
            );
        }
    }

    // ========================================================================
    // Exclusion Pattern Tests
    // ========================================================================

    mod exclusion_tests {
        use super::*;

        #[test]
        fn test_excludes_default_dirs() {
            assert!(should_exclude(Path::new(".git/config")));
            assert!(should_exclude(Path::new("node_modules/package/index.js")));
            assert!(should_exclude(Path::new("__pycache__/foo.pyc")));
            assert!(should_exclude(Path::new("target/debug/main")));
            assert!(should_exclude(Path::new(".venv/bin/python")));
        }

        #[test]
        fn test_does_not_exclude_source_files() {
            assert!(!should_exclude(Path::new("src/main.py")));
            assert!(!should_exclude(Path::new("lib/utils.rs")));
        }

        #[test]
        fn test_excludes_egg_info_pattern() {
            assert!(should_exclude(Path::new("mypackage.egg-info/PKG-INFO")));
        }
    }

    // ========================================================================
    // Snapshot Creation Tests
    // ========================================================================

    mod snapshot_creation_tests {
        use super::*;

        #[test]
        fn test_create_snapshot_python_only() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Should only have Python files
            for file in snapshot.files() {
                assert!(file.path.ends_with(".py") || is_config_file(&file.path));
            }
        }

        #[test]
        fn test_create_snapshot_all_languages() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::all_languages();

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // Should have both Python and Rust files
            let has_python = snapshot.files().iter().any(|f| f.path.ends_with(".py"));
            let has_rust = snapshot.files().iter().any(|f| f.path.ends_with(".rs"));

            assert!(has_python);
            assert!(has_rust);
        }

        #[test]
        fn test_snapshot_respects_custom_exclude() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python).exclude("utils");

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            // utils.py should be excluded
            assert!(snapshot.file_id("src/utils.py").is_none());
            // main.py should still be present
            assert!(snapshot.file_id("src/main.py").is_some());
        }
    }

    // ========================================================================
    // Content Cache Tests
    // ========================================================================

    mod cache_tests {
        use super::*;

        #[test]
        fn test_content_cache_loads_on_demand() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            let file_id = snapshot.file_id("src/main.py").unwrap();

            // Cache should be empty initially
            assert!(snapshot.content_cache.read().unwrap().is_empty());

            // Load content (no longer needs &mut self)
            let content = snapshot.get_content(file_id).unwrap();
            assert!(!content.is_empty());

            // Cache should now have the content
            assert!(snapshot
                .content_cache
                .read()
                .unwrap()
                .contains_key(&file_id));
        }

        #[test]
        fn test_clear_cache() {
            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);

            let snapshot = WorkspaceSnapshot::create(workspace.path(), &config).unwrap();

            let file_id = snapshot.file_id("src/main.py").unwrap();
            snapshot.get_content(file_id).unwrap();

            assert!(!snapshot.content_cache.read().unwrap().is_empty());

            snapshot.clear_cache();

            assert!(snapshot.content_cache.read().unwrap().is_empty());
        }

        #[test]
        fn test_content_cache_is_thread_safe() {
            use std::sync::Arc;
            use std::thread;

            let workspace = create_test_workspace();
            let config = SnapshotConfig::for_language(Language::Python);
            let snapshot = Arc::new(WorkspaceSnapshot::create(workspace.path(), &config).unwrap());

            let file_id = snapshot.file_id("src/main.py").unwrap();

            // Spawn multiple threads that all try to get content concurrently
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    let snapshot = Arc::clone(&snapshot);
                    thread::spawn(move || {
                        let content = snapshot.get_content(file_id).unwrap();
                        assert!(!content.is_empty());
                        content.len()
                    })
                })
                .collect();

            // All threads should succeed and get the same content
            let results: Vec<usize> = handles.into_iter().map(|h| h.join().unwrap()).collect();
            assert!(results.iter().all(|&len| len == results[0]));
        }
    }

    // ========================================================================
    // Snapshot Mode Tests
    // ========================================================================

    mod mode_tests {
        use super::*;

        #[test]
        fn test_default_mode_is_sandbox_copy() {
            assert_eq!(SnapshotMode::default(), SnapshotMode::SandboxCopy);
        }

        #[test]
        fn test_mode_display() {
            assert_eq!(format!("{}", SnapshotMode::InPlace), "in_place");
            assert_eq!(format!("{}", SnapshotMode::SandboxCopy), "sandbox_copy");
        }
    }

    // ========================================================================
    // Audit Regression Tests
    // ========================================================================

    mod audit_regression_tests {
        use super::*;

        // S2-10: Deserialization must restore path_to_id index
        #[test]
        fn snapshot_deserialize_restores_path_to_id() {
            // Create a snapshot with files
            let files = vec![
                FileInfo {
                    path: "src/main.py".to_string(),
                    content_hash: ContentHash::compute(b"print('hello')"),
                    language: Language::Python,
                    size_bytes: 14,
                    mtime: None,
                },
                FileInfo {
                    path: "src/utils.py".to_string(),
                    content_hash: ContentHash::compute(b"def helper(): pass"),
                    language: Language::Python,
                    size_bytes: 18,
                    mtime: None,
                },
            ];

            let snapshot = WorkspaceSnapshot::from_files(std::path::PathBuf::from("/test"), files);

            // Verify file_id works before serialization
            assert!(snapshot.file_id("src/main.py").is_some());
            assert!(snapshot.file_id("src/utils.py").is_some());
            assert_eq!(snapshot.file_id("src/main.py").unwrap(), FileId::new(0));
            assert_eq!(snapshot.file_id("src/utils.py").unwrap(), FileId::new(1));

            // Serialize to JSON
            let json = serde_json::to_string(&snapshot).unwrap();

            // Deserialize - path_to_id will be empty due to #[serde(skip)]
            let mut restored: WorkspaceSnapshot = serde_json::from_str(&json).unwrap();

            // Before restore_indexes, file_id should fail
            // (This documents the bug that was fixed)
            // Note: In the buggy code, this would return None
            // After the fix, we must call restore_indexes

            // Call restore_indexes to fix the path_to_id map
            restored.restore_indexes();

            // Now file_id should work again
            assert!(
                restored.file_id("src/main.py").is_some(),
                "file_id should work after restore_indexes"
            );
            assert!(
                restored.file_id("src/utils.py").is_some(),
                "file_id should work after restore_indexes"
            );
            assert_eq!(restored.file_id("src/main.py").unwrap(), FileId::new(0));
            assert_eq!(restored.file_id("src/utils.py").unwrap(), FileId::new(1));
        }

        #[test]
        fn snapshot_without_restore_indexes_has_broken_lookup() {
            // This test documents the expected behavior of the bug
            let files = vec![FileInfo {
                path: "test.py".to_string(),
                content_hash: ContentHash::compute(b"pass"),
                language: Language::Python,
                size_bytes: 4,
                mtime: None,
            }];

            let snapshot = WorkspaceSnapshot::from_files(std::path::PathBuf::from("/test"), files);

            let json = serde_json::to_string(&snapshot).unwrap();
            let restored: WorkspaceSnapshot = serde_json::from_str(&json).unwrap();

            // Without restore_indexes, file_id returns None
            // This is the buggy behavior - caller must call restore_indexes
            assert!(
                restored.file_id("test.py").is_none(),
                "Without restore_indexes, path_to_id is empty after deserialization"
            );
        }
    }
}
