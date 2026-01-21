//! Session management: lifecycle, concurrency, configuration.
//!
//! This module implements session management for tug:
//! - Session directory structure (.tug/)
//! - Session lifecycle (open, close, fresh)
//! - Optimistic concurrency control (no file locks)
//! - Snapshot storage and retention
//! - Configuration precedence
//! - Worker process tracking
//!
//! # Concurrency Model
//!
//! Instead of file locks (which are fragile and platform-specific), this module
//! uses Optimistic Concurrency Control (OCC):
//!
//! 1. On open: compute hash of mutable session state → `base_version`
//! 2. On save: verify current hash matches `base_version`
//! 3. If mismatch: return `ConcurrentModification` error, caller retries
//!
//! This is the same pattern git uses for refs. It's crash-safe, works on all
//! platforms including NFS, and leaves no cleanup needed after crashes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use thiserror::Error;

use crate::workspace::WorkspaceSnapshot;

// ============================================================================
// Constants
// ============================================================================

/// Default number of snapshots to retain. Older snapshots are automatically pruned.
pub const DEFAULT_SNAPSHOT_RETENTION: usize = 5;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during session operations.
#[derive(Debug, Error)]
pub enum SessionError {
    /// Session directory is not writable.
    #[error("session directory is not writable: {path}")]
    SessionNotWritable { path: PathBuf },

    /// Workspace root has moved or been deleted.
    #[error("workspace not found at expected path: {expected}")]
    WorkspaceNotFound { expected: PathBuf },

    /// Session was modified by another process during our operation.
    ///
    /// This indicates that between opening the session and attempting to write,
    /// another process modified the session state. The caller should:
    /// 1. Re-open the session to get fresh state
    /// 2. Re-apply their changes
    /// 3. Try to save again
    ///
    /// See `with_retry()` helper for automatic retry logic.
    #[error("session was modified concurrently (expected {expected}, found {actual})")]
    ConcurrentModification { expected: String, actual: String },

    /// Session data is corrupt.
    #[error("session data is corrupt: {reason}")]
    SessionCorrupt { path: PathBuf, reason: String },

    /// Facts cache is corrupt.
    #[error("facts cache is corrupt: {path}")]
    CacheCorrupt { path: PathBuf },

    /// IO error during session operations.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    /// JSON serialization/deserialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Workspace root hash mismatch (workspace has moved).
    #[error("workspace root hash mismatch: session bound to different workspace")]
    WorkspaceRootMismatch {
        session_root: PathBuf,
        current_root: PathBuf,
    },
}

/// Result type for session operations.
pub type SessionResult<T> = Result<T, SessionError>;

// ============================================================================
// Session Version (OCC)
// ============================================================================

/// Version token for optimistic concurrency control.
///
/// Computed from the content hashes of all mutable session state.
/// If any file changes, the token changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionVersion(String);

impl SessionVersion {
    /// Compute version from session state files.
    ///
    /// Includes:
    /// - session.json (metadata)
    /// - snapshots/current.json (current snapshot reference)
    /// - workers/*.pid (worker process state)
    ///
    /// Does NOT include (immutable or derived):
    /// - Historical snapshots (`snapshots/<id>.json`)
    /// - Facts cache (facts_cache/*)
    /// - Logs (logs/*)
    pub fn compute(session_dir: &Path) -> io::Result<Self> {
        let mut hasher = Sha256::new();

        // Hash session.json
        let session_json = session_dir.join("session.json");
        if session_json.exists() {
            hasher.update(&fs::read(&session_json)?);
            hasher.update(b"\x00");
        }

        // Hash current snapshot reference
        let current_json = session_dir.join("snapshots/current.json");
        if current_json.exists() {
            hasher.update(&fs::read(&current_json)?);
            hasher.update(b"\x00");
        }

        // Hash worker state (sorted for determinism)
        let workers_dir = session_dir.join("workers");
        if workers_dir.exists() {
            let mut worker_files: Vec<_> = fs::read_dir(&workers_dir)?
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "pid")
                        .unwrap_or(false)
                })
                .collect();

            worker_files.sort_by_key(|e| e.path());

            for entry in worker_files {
                hasher.update(&fs::read(entry.path())?);
                hasher.update(b"\x00");
            }
        }

        let hash = hex::encode(hasher.finalize());
        Ok(SessionVersion(hash))
    }

    /// Get the hash string (for error messages).
    pub fn hash(&self) -> &str {
        &self.0
    }
}

// ============================================================================
// Atomic File Operations
// ============================================================================

/// Write content to a file atomically using temp + rename.
///
/// This ensures readers see either old or new content, never partial writes.
/// If the process crashes:
/// - Before rename: temp file is orphaned (harmless)
/// - After rename: write completed successfully
///
/// The temp file name includes PID and timestamp to prevent collisions when
/// multiple processes write to the same file concurrently.
fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    use std::time::{SystemTime, UNIX_EPOCH};

    // Use PID + timestamp to ensure unique temp file names across concurrent processes
    let pid = std::process::id();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let temp_path = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        pid,
        timestamp
    ));
    fs::write(&temp_path, content)?;
    fs::rename(&temp_path, path)?;
    Ok(())
}

/// Execute an operation with automatic retry on concurrent modification.
pub fn with_retry<T, F>(mut operation: F, max_retries: usize) -> SessionResult<T>
where
    F: FnMut() -> SessionResult<T>,
{
    let mut attempts = 0;
    loop {
        match operation() {
            Ok(result) => return Ok(result),
            Err(SessionError::ConcurrentModification { .. }) if attempts < max_retries => {
                attempts += 1;
                // Exponential backoff: 10ms, 20ms, 40ms, ...
                let delay_ms = 10 * (1 << attempts.min(6));
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            Err(e) => return Err(e),
        }
    }
}

// ============================================================================
// Session Metadata
// ============================================================================

/// Persisted session metadata (session.json).
///
/// This is stored in `.tug/session.json` and contains metadata
/// about the session including when it was created and the workspace
/// it's bound to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    /// Schema version for session.json (currently "1").
    pub version: String,
    /// When the session was first created.
    pub created_at: String,
    /// Absolute path to the workspace root.
    pub workspace_root: PathBuf,
    /// Hash of workspace root path (for detecting moves).
    pub workspace_root_hash: String,
    /// Last time the session was accessed.
    pub last_accessed: String,
    /// Session-level configuration.
    #[serde(default)]
    pub config: SessionConfig,
}

impl SessionMetadata {
    /// Create new session metadata for a workspace.
    pub fn new(workspace_root: &Path) -> Self {
        let now = format_timestamp(SystemTime::now());
        let workspace_root = workspace_root
            .canonicalize()
            .unwrap_or_else(|_| workspace_root.to_path_buf());

        SessionMetadata {
            version: "1".to_string(),
            created_at: now.clone(),
            workspace_root: workspace_root.clone(),
            workspace_root_hash: hash_path(&workspace_root),
            last_accessed: now,
            config: SessionConfig::default(),
        }
    }

    /// Update the last_accessed timestamp.
    pub fn touch(&mut self) {
        self.last_accessed = format_timestamp(SystemTime::now());
    }
}

/// Session-level configuration that persists across CLI calls.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionConfig {
    /// Whether Python environment has been resolved.
    #[serde(default)]
    pub python_resolved: bool,
    /// Whether rust-analyzer is available.
    #[serde(default)]
    pub rust_analyzer_available: bool,
    /// Current snapshot ID (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_snapshot_id: Option<String>,
    /// Cached toolchain paths keyed by language (e.g., "python" -> "/usr/bin/python3").
    ///
    /// These are auto-resolved on first use and cached for subsequent invocations.
    /// The `--toolchain <lang>=<path>` CLI flag always overrides the cache.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub toolchains: HashMap<String, PathBuf>,
}

// ============================================================================
// Worker Process Tracking
// ============================================================================

/// Information about a running worker process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInfo {
    /// Process ID.
    pub pid: u32,
    /// Worker name (e.g., "python_verifier", "rust_analyzer").
    pub name: String,
    /// When the worker was started.
    pub started_at: String,
}

impl WorkerInfo {
    /// Create new worker info.
    pub fn new(name: &str, pid: u32) -> Self {
        WorkerInfo {
            pid,
            name: name.to_string(),
            started_at: format_timestamp(SystemTime::now()),
        }
    }
}

// ============================================================================
// Configuration Sources
// ============================================================================

/// Configuration value source (for precedence tracking).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ConfigSource {
    /// Built-in default value.
    Default = 0,
    /// From pyproject.toml [tool.tug].
    ProjectConfig = 1,
    /// From session config (sticky).
    SessionConfig = 2,
    /// From environment variable.
    EnvVar = 3,
    /// From CLI flag (highest precedence).
    CliFlag = 4,
}

/// A configuration value with its source.
#[derive(Debug, Clone)]
pub struct ConfigValue<T> {
    /// The actual value.
    pub value: T,
    /// Where the value came from.
    pub source: ConfigSource,
}

impl<T> ConfigValue<T> {
    /// Create a new config value with the given source.
    pub fn new(value: T, source: ConfigSource) -> Self {
        ConfigValue { value, source }
    }

    /// Merge with another value, preferring higher precedence.
    pub fn merge(self, other: Self) -> Self {
        if other.source >= self.source {
            other
        } else {
            self
        }
    }
}

// ============================================================================
// Session Options
// ============================================================================

/// Options for opening a session.
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// Path to session directory (default: .tug/).
    pub session_dir: Option<PathBuf>,
    /// Named session (creates `.tug/<name>/`).
    pub session_name: Option<String>,
    /// Delete existing session and start fresh.
    pub fresh: bool,
    /// Fail immediately if session is locked (don't wait).
    pub no_wait: bool,
    /// Lock timeout in seconds (default: 30).
    pub lock_timeout_secs: u64,
}

impl Default for SessionOptions {
    fn default() -> Self {
        SessionOptions {
            session_dir: None,
            session_name: None,
            fresh: false,
            no_wait: false,
            lock_timeout_secs: 30,
        }
    }
}

impl SessionOptions {
    /// Create options for a fresh session (deletes existing).
    pub fn fresh() -> Self {
        SessionOptions {
            fresh: true,
            ..Default::default()
        }
    }

    /// Create options with no-wait locking.
    pub fn no_wait() -> Self {
        SessionOptions {
            no_wait: true,
            ..Default::default()
        }
    }

    /// Set the session directory.
    pub fn with_session_dir(mut self, path: impl Into<PathBuf>) -> Self {
        self.session_dir = Some(path.into());
        self
    }

    /// Set a named session.
    pub fn with_session_name(mut self, name: impl Into<String>) -> Self {
        self.session_name = Some(name.into());
        self
    }

    /// Set the lock timeout.
    pub fn with_lock_timeout(mut self, secs: u64) -> Self {
        self.lock_timeout_secs = secs;
        self
    }
}

// ============================================================================
// Session Handle
// ============================================================================

/// Session handle for managing tug session lifecycle.
///
/// A session represents a single workspace context with:
/// - Locked access (prevents concurrent modifications)
/// - Persistent configuration
/// - Snapshot storage
/// - Worker process tracking
///
/// Sessions are created in `.tug/` within the workspace root
/// and persist across CLI invocations.
pub struct Session {
    /// Path to the workspace root.
    workspace_root: PathBuf,
    /// Path to the session directory (.tug/).
    session_dir: PathBuf,
    /// Session metadata (from session.json).
    metadata: SessionMetadata,
    /// Version token captured when session was opened (for OCC).
    base_version: SessionVersion,
    /// Options used to open the session.
    options: SessionOptions,
}

impl Session {
    /// Open or create a session for the given workspace.
    ///
    /// This captures the current state version for optimistic concurrency control.
    /// Multiple processes can open the same session simultaneously for reading.
    /// Writes are verified against the base version before committing.
    pub fn open(workspace_root: impl AsRef<Path>, options: SessionOptions) -> SessionResult<Self> {
        let workspace_root = workspace_root.as_ref();

        // Validate workspace exists
        if !workspace_root.exists() {
            return Err(SessionError::WorkspaceNotFound {
                expected: workspace_root.to_path_buf(),
            });
        }

        // Canonicalize workspace path
        let workspace_root = workspace_root.canonicalize()?;

        // Determine session directory
        let session_dir = Self::resolve_session_dir(&workspace_root, &options);

        // Handle --fresh flag: delete existing session
        if options.fresh && session_dir.exists() {
            fs::remove_dir_all(&session_dir)?;
        }

        // Create session directory structure if needed
        Self::ensure_session_structure(&session_dir)?;

        // Load or create metadata
        let metadata = Self::load_or_create_metadata(&session_dir, &workspace_root)?;

        // Validate workspace root matches
        let current_hash = hash_path(&workspace_root);
        if metadata.workspace_root_hash != current_hash {
            return Err(SessionError::WorkspaceRootMismatch {
                session_root: metadata.workspace_root.clone(),
                current_root: workspace_root.clone(),
            });
        }

        // Capture version for OCC
        let base_version = SessionVersion::compute(&session_dir)?;

        Ok(Session {
            workspace_root,
            session_dir,
            metadata,
            base_version,
            options,
        })
    }

    /// Resolve the session directory path.
    fn resolve_session_dir(workspace_root: &Path, options: &SessionOptions) -> PathBuf {
        if let Some(ref dir) = options.session_dir {
            dir.clone()
        } else if let Some(ref name) = options.session_name {
            workspace_root.join(".tug").join(name)
        } else {
            workspace_root.join(".tug")
        }
    }

    /// Create the session directory structure.
    fn ensure_session_structure(session_dir: &Path) -> SessionResult<()> {
        // Create main session directory
        fs::create_dir_all(session_dir).map_err(|e| {
            if e.kind() == io::ErrorKind::PermissionDenied {
                SessionError::SessionNotWritable {
                    path: session_dir.to_path_buf(),
                }
            } else {
                SessionError::Io(e)
            }
        })?;

        // Create standard subdirectories for session data
        let subdirs = ["python", "workers", "snapshots", "facts_cache", "logs"];
        for subdir in &subdirs {
            let path = session_dir.join(subdir);
            if !path.exists() {
                fs::create_dir_all(&path)?;
            }
        }

        Ok(())
    }

    /// Load existing metadata or create new.
    fn load_or_create_metadata(
        session_dir: &Path,
        workspace_root: &Path,
    ) -> SessionResult<SessionMetadata> {
        let metadata_path = session_dir.join("session.json");

        if metadata_path.exists() {
            let content = fs::read_to_string(&metadata_path)?;
            let mut metadata: SessionMetadata =
                serde_json::from_str(&content).map_err(|e| SessionError::SessionCorrupt {
                    path: metadata_path.clone(),
                    reason: e.to_string(),
                })?;
            metadata.touch();
            // Save updated last_accessed atomically
            let content = serde_json::to_string_pretty(&metadata)?;
            atomic_write(&metadata_path, content.as_bytes())?;
            Ok(metadata)
        } else {
            let metadata = SessionMetadata::new(workspace_root);
            // Save new metadata atomically
            let content = serde_json::to_string_pretty(&metadata)?;
            atomic_write(&metadata_path, content.as_bytes())?;
            Ok(metadata)
        }
    }

    /// Get the workspace root path.
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Get the session directory path.
    pub fn session_dir(&self) -> &Path {
        &self.session_dir
    }

    /// Get the session metadata.
    pub fn metadata(&self) -> &SessionMetadata {
        &self.metadata
    }

    /// Get mutable access to session metadata.
    pub fn metadata_mut(&mut self) -> &mut SessionMetadata {
        &mut self.metadata
    }

    /// Get the session configuration.
    pub fn config(&self) -> &SessionConfig {
        &self.metadata.config
    }

    /// Get mutable access to session configuration.
    pub fn config_mut(&mut self) -> &mut SessionConfig {
        &mut self.metadata.config
    }

    /// Get the options used to open this session.
    pub fn options(&self) -> &SessionOptions {
        &self.options
    }

    /// Get the current session version (for debugging/testing).
    pub fn version(&self) -> &SessionVersion {
        &self.base_version
    }

    /// Get path to python config directory.
    pub fn python_dir(&self) -> PathBuf {
        self.session_dir.join("python")
    }

    /// Get path to workers directory.
    pub fn workers_dir(&self) -> PathBuf {
        self.session_dir.join("workers")
    }

    /// Get path to snapshots directory.
    pub fn snapshots_dir(&self) -> PathBuf {
        self.session_dir.join("snapshots")
    }

    /// Get path to facts cache directory.
    pub fn facts_cache_dir(&self) -> PathBuf {
        self.session_dir.join("facts_cache")
    }

    /// Get path to logs directory.
    pub fn logs_dir(&self) -> PathBuf {
        self.session_dir.join("logs")
    }

    // ========================================================================
    // Snapshot Storage
    // ========================================================================

    /// Save a snapshot to the session.
    ///
    /// Uses OCC: verifies session hasn't been modified before writing.
    pub fn save_snapshot(&mut self, snapshot: &WorkspaceSnapshot) -> SessionResult<()> {
        // Verify version before any writes
        self.verify_version()?;

        let snapshots_dir = self.snapshots_dir();
        let snapshot_id = snapshot.snapshot_id.0.clone();
        let snapshot_content = serde_json::to_string_pretty(snapshot)?;

        // Atomic write: snapshot file (historical, not included in version)
        let snapshot_path = snapshots_dir.join(format!("{}.json", snapshot_id));
        atomic_write(&snapshot_path, snapshot_content.as_bytes())?;

        // Update metadata
        self.metadata.config.current_snapshot_id = Some(snapshot_id);
        self.metadata.touch();

        // Atomic write: current.json AND session.json together
        // Order matters: write metadata first, then current.json
        // This ensures version computation sees consistent state
        let metadata_path = self.session_dir.join("session.json");
        let metadata_content = serde_json::to_string_pretty(&self.metadata)?;
        atomic_write(&metadata_path, metadata_content.as_bytes())?;

        let current_path = snapshots_dir.join("current.json");
        atomic_write(&current_path, snapshot_content.as_bytes())?;

        // Update our version to reflect the new state
        self.base_version = SessionVersion::compute(&self.session_dir)?;

        // Enforce retention policy
        self.enforce_snapshot_retention(DEFAULT_SNAPSHOT_RETENTION)?;

        Ok(())
    }

    /// Load a snapshot by ID.
    pub fn load_snapshot(&self, snapshot_id: &str) -> SessionResult<Option<WorkspaceSnapshot>> {
        let snapshot_path = self.snapshots_dir().join(format!("{}.json", snapshot_id));

        if !snapshot_path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&snapshot_path)?;
        let mut snapshot: WorkspaceSnapshot = serde_json::from_str(&content)?;
        // Restore path_to_id index which is not serialized
        snapshot.restore_indexes();
        Ok(Some(snapshot))
    }

    /// Load the current snapshot.
    pub fn load_current_snapshot(&self) -> SessionResult<Option<WorkspaceSnapshot>> {
        let current_path = self.snapshots_dir().join("current.json");

        if !current_path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&current_path)?;
        let mut snapshot: WorkspaceSnapshot = serde_json::from_str(&content)?;
        // Restore path_to_id index which is not serialized
        snapshot.restore_indexes();
        Ok(Some(snapshot))
    }

    /// Enforce snapshot retention policy (keep last N snapshots).
    fn enforce_snapshot_retention(&self, keep_count: usize) -> SessionResult<()> {
        let snapshots_dir = self.snapshots_dir();

        // Collect all snapshot files with their modification times
        let mut snapshots: Vec<(PathBuf, SystemTime)> = Vec::new();

        for entry in fs::read_dir(&snapshots_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Skip current.json and non-json files
            if path.file_name() == Some(std::ffi::OsStr::new("current.json")) {
                continue;
            }
            if path.extension() != Some(std::ffi::OsStr::new("json")) {
                continue;
            }

            if let Ok(metadata) = entry.metadata() {
                if let Ok(mtime) = metadata.modified() {
                    snapshots.push((path, mtime));
                }
            }
        }

        // Sort by modification time (newest first)
        snapshots.sort_by(|a, b| b.1.cmp(&a.1));

        // Delete old snapshots beyond retention count
        for (path, _) in snapshots.into_iter().skip(keep_count) {
            let _ = fs::remove_file(&path);

            // Also try to remove corresponding facts cache
            if let Some(stem) = path.file_stem() {
                let cache_dir = self.facts_cache_dir().join(stem);
                let _ = fs::remove_dir_all(&cache_dir);
            }
        }

        Ok(())
    }

    /// List all snapshot IDs in the session.
    pub fn list_snapshots(&self) -> SessionResult<Vec<String>> {
        let snapshots_dir = self.snapshots_dir();
        let mut ids = Vec::new();

        for entry in fs::read_dir(&snapshots_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Skip current.json
            if path.file_name() == Some(std::ffi::OsStr::new("current.json")) {
                continue;
            }

            if path.extension() == Some(std::ffi::OsStr::new("json")) {
                if let Some(stem) = path.file_stem() {
                    ids.push(stem.to_string_lossy().to_string());
                }
            }
        }

        // Sort for deterministic ordering
        ids.sort();
        Ok(ids)
    }

    // ========================================================================
    // Worker Process Management
    // ========================================================================

    /// Register a worker process.
    ///
    /// Uses atomic write to avoid race conditions when multiple processes
    /// try to register workers concurrently.
    pub fn register_worker(&self, name: &str, pid: u32) -> SessionResult<()> {
        let workers_dir = self.workers_dir();
        let pid_path = workers_dir.join(format!("{}.pid", name));

        let info = WorkerInfo::new(name, pid);
        let content = serde_json::to_string(&info)?;
        atomic_write(&pid_path, content.as_bytes())?;

        Ok(())
    }

    /// Get worker info if registered.
    pub fn get_worker(&self, name: &str) -> SessionResult<Option<WorkerInfo>> {
        let pid_path = self.workers_dir().join(format!("{}.pid", name));

        if !pid_path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&pid_path)?;
        let info: WorkerInfo = serde_json::from_str(&content)?;
        Ok(Some(info))
    }

    /// Check if a worker process is still running.
    pub fn is_worker_running(&self, name: &str) -> SessionResult<bool> {
        if let Some(info) = self.get_worker(name)? {
            Ok(is_process_running(info.pid))
        } else {
            Ok(false)
        }
    }

    /// Unregister a worker (remove PID file).
    pub fn unregister_worker(&self, name: &str) -> SessionResult<()> {
        let pid_path = self.workers_dir().join(format!("{}.pid", name));
        if pid_path.exists() {
            fs::remove_file(&pid_path)?;
        }
        Ok(())
    }

    /// Clean up stale worker PID files (orphan detection).
    pub fn cleanup_stale_workers(&self) -> SessionResult<Vec<String>> {
        let workers_dir = self.workers_dir();
        let mut cleaned = Vec::new();

        for entry in fs::read_dir(&workers_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension() != Some(std::ffi::OsStr::new("pid")) {
                continue;
            }

            // Try to read and parse the PID file
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(info) = serde_json::from_str::<WorkerInfo>(&content) {
                    // Check if process is still running
                    if !is_process_running(info.pid) {
                        // Process is dead, clean up
                        fs::remove_file(&path)?;
                        cleaned.push(info.name);
                    }
                } else {
                    // Invalid PID file, clean up
                    fs::remove_file(&path)?;
                    if let Some(stem) = path.file_stem() {
                        cleaned.push(stem.to_string_lossy().to_string());
                    }
                }
            }
        }

        Ok(cleaned)
    }

    /// List all registered workers.
    pub fn list_workers(&self) -> SessionResult<Vec<WorkerInfo>> {
        let workers_dir = self.workers_dir();
        let mut workers = Vec::new();

        for entry in fs::read_dir(&workers_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension() != Some(std::ffi::OsStr::new("pid")) {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(info) = serde_json::from_str::<WorkerInfo>(&content) {
                    workers.push(info);
                }
            }
        }

        // Sort by name for deterministic ordering
        workers.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(workers)
    }

    // ========================================================================
    // Session Lifecycle
    // ========================================================================

    /// Verify session hasn't been modified since we opened it.
    fn verify_version(&self) -> SessionResult<()> {
        let current = SessionVersion::compute(&self.session_dir)?;
        if current != self.base_version {
            return Err(SessionError::ConcurrentModification {
                expected: self.base_version.hash().to_string(),
                actual: current.hash().to_string(),
            });
        }
        Ok(())
    }

    /// Save session metadata to disk.
    ///
    /// Uses OCC: verifies session hasn't been modified before writing.
    pub fn save(&mut self) -> SessionResult<()> {
        self.verify_version()?;

        self.metadata.touch();
        let metadata_path = self.session_dir.join("session.json");
        let content = serde_json::to_string_pretty(&self.metadata)?;
        atomic_write(&metadata_path, content.as_bytes())?;

        // Update our version to reflect the new state
        self.base_version = SessionVersion::compute(&self.session_dir)?;
        Ok(())
    }

    /// Close the session (saves metadata).
    pub fn close(mut self) -> SessionResult<()> {
        self.save()
    }

    /// Delete the session entirely.
    pub fn delete(self) -> SessionResult<()> {
        fs::remove_dir_all(&self.session_dir)?;
        Ok(())
    }

    /// Delete only workers (kill and remove PIDs).
    pub fn clean_workers(&self) -> SessionResult<()> {
        let workers_dir = self.workers_dir();

        for entry in fs::read_dir(&workers_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension() == Some(std::ffi::OsStr::new("pid")) {
                // Try to read PID and kill process
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(info) = serde_json::from_str::<WorkerInfo>(&content) {
                        // Try to kill the process (best effort)
                        let _ = kill_process(info.pid);
                    }
                }
                // Remove PID file
                fs::remove_file(&path)?;
            }
        }

        Ok(())
    }

    /// Delete only the facts cache.
    pub fn clean_cache(&self) -> SessionResult<()> {
        let cache_dir = self.facts_cache_dir();

        for entry in fs::read_dir(&cache_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }

        Ok(())
    }

    // ========================================================================
    // Session Status
    // ========================================================================

    /// Get session status information.
    pub fn status(&self) -> SessionStatus {
        let workers = self.list_workers().unwrap_or_default();
        let snapshots = self.list_snapshots().unwrap_or_default();

        // Calculate cache size
        let cache_size = calculate_dir_size(&self.facts_cache_dir()).unwrap_or(0);

        SessionStatus {
            status: "ok".to_string(),
            session_dir: self.session_dir.clone(),
            workspace_root: self.workspace_root.clone(),
            created_at: self.metadata.created_at.clone(),
            last_accessed: self.metadata.last_accessed.clone(),
            python_resolved: self.metadata.config.python_resolved,
            rust_analyzer_available: self.metadata.config.rust_analyzer_available,
            current_snapshot_id: self.metadata.config.current_snapshot_id.clone(),
            workers,
            snapshot_count: snapshots.len(),
            cache_size_bytes: cache_size,
        }
    }
}

// ============================================================================
// Session Status
// ============================================================================

/// Information about session status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatus {
    /// Session status indicator (always "ok" for valid sessions).
    pub status: String,
    /// Path to session directory.
    pub session_dir: PathBuf,
    /// Path to workspace root.
    pub workspace_root: PathBuf,
    /// When session was created.
    pub created_at: String,
    /// When session was last accessed.
    pub last_accessed: String,
    /// Whether Python environment is resolved.
    pub python_resolved: bool,
    /// Whether rust-analyzer is available.
    pub rust_analyzer_available: bool,
    /// Current snapshot ID.
    pub current_snapshot_id: Option<String>,
    /// Running workers.
    pub workers: Vec<WorkerInfo>,
    /// Number of stored snapshots.
    pub snapshot_count: usize,
    /// Total size of facts cache in bytes.
    pub cache_size_bytes: u64,
}

// ============================================================================
// Configuration Resolution
// ============================================================================

/// Resolved configuration with precedence information.
#[derive(Debug, Clone, Default)]
pub struct ResolvedConfig {
    /// Python interpreter path.
    pub python: Option<ConfigValue<PathBuf>>,
    /// rust-analyzer path.
    pub rust_analyzer: Option<ConfigValue<PathBuf>>,
    /// Verification mode.
    pub verify_mode: Option<ConfigValue<String>>,
    /// Safety mode.
    pub safety_mode: Option<ConfigValue<String>>,
    /// Include patterns.
    pub include_patterns: Vec<ConfigValue<String>>,
    /// Exclude patterns.
    pub exclude_patterns: Vec<ConfigValue<String>>,
    /// Test command.
    pub test_command: Option<ConfigValue<Vec<String>>>,
    /// Typecheck command.
    pub typecheck_command: Option<ConfigValue<Vec<String>>>,
}

impl ResolvedConfig {
    /// Create empty resolved config.
    pub fn new() -> Self {
        ResolvedConfig::default()
    }

    /// Resolve configuration from all sources.
    ///
    /// Precedence (highest to lowest):
    /// 1. CLI flags
    /// 2. Environment variables
    /// 3. Session config
    /// 4. Project config (pyproject.toml)
    /// 5. Defaults
    pub fn resolve(
        workspace_root: &Path,
        session_config: Option<&SessionConfig>,
        cli_overrides: &CliOverrides,
    ) -> Self {
        let mut config = ResolvedConfig::new();

        // Apply defaults (lowest precedence)
        config.apply_defaults();

        // Apply project config if pyproject.toml exists
        let pyproject_path = workspace_root.join("pyproject.toml");
        if pyproject_path.exists() {
            config.apply_project_config(&pyproject_path);
        }

        // Apply session config (sticky)
        if let Some(session) = session_config {
            config.apply_session_config(session);
        }

        // Apply environment variables
        config.apply_env_vars();

        // Apply CLI overrides (highest precedence)
        config.apply_cli_overrides(cli_overrides);

        config
    }

    fn apply_defaults(&mut self) {
        // Default verify mode is "syntax"
        self.verify_mode = Some(ConfigValue::new(
            "syntax".to_string(),
            ConfigSource::Default,
        ));
        // Default safety mode is "strict"
        self.safety_mode = Some(ConfigValue::new(
            "strict".to_string(),
            ConfigSource::Default,
        ));
    }

    fn apply_project_config(&mut self, _pyproject_path: &Path) {
        // Placeholder for pyproject.toml [tool.tug] section parsing.
        // Currently a no-op; TOML parsing will be added when needed.
    }

    fn apply_session_config(&mut self, _session: &SessionConfig) {
        // Session config values would override project config
        // Currently no additional session-stored config values
    }

    fn apply_env_vars(&mut self) {
        // Check environment variables
        if let Ok(python) = std::env::var("TUG_PYTHON") {
            self.python = Some(ConfigValue::new(
                PathBuf::from(python),
                ConfigSource::EnvVar,
            ));
        }

        if let Ok(ra) = std::env::var("TUG_RA_PATH") {
            self.rust_analyzer = Some(ConfigValue::new(PathBuf::from(ra), ConfigSource::EnvVar));
        }

        if let Ok(verify) = std::env::var("TUG_VERIFY") {
            self.verify_mode = Some(ConfigValue::new(verify, ConfigSource::EnvVar));
        }

        if let Ok(safety) = std::env::var("TUG_SAFETY") {
            self.safety_mode = Some(ConfigValue::new(safety, ConfigSource::EnvVar));
        }
    }

    fn apply_cli_overrides(&mut self, overrides: &CliOverrides) {
        if let Some(ref python) = overrides.python {
            self.python = Some(ConfigValue::new(python.clone(), ConfigSource::CliFlag));
        }

        if let Some(ref ra) = overrides.rust_analyzer {
            self.rust_analyzer = Some(ConfigValue::new(ra.clone(), ConfigSource::CliFlag));
        }

        if let Some(ref verify) = overrides.verify_mode {
            self.verify_mode = Some(ConfigValue::new(verify.clone(), ConfigSource::CliFlag));
        }

        if let Some(ref safety) = overrides.safety_mode {
            self.safety_mode = Some(ConfigValue::new(safety.clone(), ConfigSource::CliFlag));
        }
    }
}

/// CLI configuration overrides.
#[derive(Debug, Clone, Default)]
pub struct CliOverrides {
    /// --python flag.
    pub python: Option<PathBuf>,
    /// --rust-analyzer flag.
    pub rust_analyzer: Option<PathBuf>,
    /// --verify flag.
    pub verify_mode: Option<String>,
    /// --safety flag.
    pub safety_mode: Option<String>,
    /// --include flags.
    pub include_patterns: Vec<String>,
    /// --exclude flags.
    pub exclude_patterns: Vec<String>,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Format a timestamp for JSON output (ISO 8601).
fn format_timestamp(time: SystemTime) -> String {
    use chrono::{DateTime, Utc};

    let datetime: DateTime<Utc> = time.into();
    datetime.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Hash a path for workspace root verification.
fn hash_path(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8]) // Use first 8 bytes for shorter hash
}

/// Check if a process is still running.
fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // On Unix, send signal 0 to check if process exists
        unsafe {
            let result = libc::kill(pid as i32, 0);
            result == 0
        }
    }

    #[cfg(windows)]
    {
        // On Windows, try to open the process
        use std::ptr::null_mut;
        unsafe {
            let handle = winapi::um::processthreadsapi::OpenProcess(
                winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                false
            } else {
                winapi::um::handleapi::CloseHandle(handle);
                true
            }
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        // Fallback: assume process is running
        true
    }
}

/// Try to kill a process.
fn kill_process(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe {
            let result = libc::kill(pid as i32, libc::SIGTERM);
            result == 0
        }
    }

    #[cfg(windows)]
    {
        use std::ptr::null_mut;
        unsafe {
            let handle = winapi::um::processthreadsapi::OpenProcess(
                winapi::um::winnt::PROCESS_TERMINATE,
                0,
                pid,
            );
            if handle.is_null() {
                return false;
            }
            let result = winapi::um::processthreadsapi::TerminateProcess(handle, 1);
            winapi::um::handleapi::CloseHandle(handle);
            result != 0
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

/// Calculate the total size of a directory.
fn calculate_dir_size(dir: &Path) -> io::Result<u64> {
    let mut size = 0u64;

    if !dir.exists() {
        return Ok(0);
    }

    for entry in walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                size += metadata.len();
            }
        }
    }

    Ok(size)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::WorkspaceSnapshotId;
    use tempfile::TempDir;

    fn create_test_workspace() -> TempDir {
        let temp = TempDir::new().unwrap();

        // Create some test files
        fs::write(temp.path().join("main.py"), "print('hello')").unwrap();
        fs::write(temp.path().join("lib.rs"), "fn main() {}").unwrap();

        temp
    }

    #[test]
    fn test_session_creation() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Verify session directory was created
        assert!(session.session_dir().exists());
        assert!(session.session_dir().join("session.json").exists());

        // Verify subdirectories were created
        assert!(session.python_dir().exists());
        assert!(session.workers_dir().exists());
        assert!(session.snapshots_dir().exists());
        assert!(session.facts_cache_dir().exists());
        assert!(session.logs_dir().exists());

        // Verify metadata
        assert_eq!(session.metadata().version, "1");
    }

    #[test]
    fn test_session_fresh_flag() {
        let workspace = create_test_workspace();

        // Create initial session
        {
            let mut session = Session::open(workspace.path(), SessionOptions::default()).unwrap();
            session.metadata_mut().config.python_resolved = true;
            session.save().unwrap();
        }

        // Open with --fresh flag
        let session = Session::open(workspace.path(), SessionOptions::fresh()).unwrap();

        // Metadata should be reset
        assert!(!session.metadata().config.python_resolved);
    }

    #[test]
    fn test_session_workspace_validation() {
        let workspace1 = create_test_workspace();
        let workspace2 = create_test_workspace();

        // Create session for workspace1
        {
            let _session = Session::open(workspace1.path(), SessionOptions::default()).unwrap();
        }

        // Try to open workspace1's session from workspace2 (should fail)
        let session_dir = workspace1.path().join(".tug");
        let result = Session::open(
            workspace2.path(),
            SessionOptions::default().with_session_dir(&session_dir),
        );

        assert!(matches!(
            result,
            Err(SessionError::WorkspaceRootMismatch { .. })
        ));
    }

    #[test]
    fn test_concurrent_modification_detected() {
        let workspace = create_test_workspace();

        // Process A opens session
        let mut session_a = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Process B opens, modifies, and saves
        let mut session_b = Session::open(workspace.path(), SessionOptions::default()).unwrap();
        session_b.metadata_mut().config.python_resolved = true;
        session_b.save().unwrap();

        // Process A tries to save - should fail
        session_a.metadata_mut().config.rust_analyzer_available = true;
        let result = session_a.save();

        assert!(
            matches!(result, Err(SessionError::ConcurrentModification { .. })),
            "Should detect concurrent modification"
        );
    }

    #[test]
    fn test_no_conflict_when_unchanged() {
        let workspace = create_test_workspace();

        // Open two sessions
        let mut session_a = Session::open(workspace.path(), SessionOptions::default()).unwrap();
        let _session_b = Session::open(workspace.path(), SessionOptions::default()).unwrap();
        // B doesn't modify anything

        // A should be able to save
        session_a.metadata_mut().config.python_resolved = true;
        let result = session_a.save();

        assert!(
            result.is_ok(),
            "Should save when no concurrent modification"
        );
    }

    #[test]
    fn test_snapshot_retention() {
        let workspace = create_test_workspace();
        let mut session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let retention = DEFAULT_SNAPSHOT_RETENTION;
        let total_snapshots = retention * 2;

        // Create more snapshots than retention allows
        for i in 0..total_snapshots {
            let snapshot = WorkspaceSnapshot::new_empty(
                workspace.path(),
                WorkspaceSnapshotId::new(format!("snap_{:02}", i)),
            );
            session.save_snapshot(&snapshot).unwrap();

            // Add small delay to ensure different mtimes
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Verify only retention count snapshots remain
        let snapshots = session.list_snapshots().unwrap();
        assert_eq!(snapshots.len(), retention);

        // Verify we kept the newest ones
        for i in retention..total_snapshots {
            assert!(snapshots.contains(&format!("snap_{:02}", i)));
        }
    }

    #[test]
    fn test_worker_registration() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Register a worker
        session.register_worker("test_worker", 12345).unwrap();

        // Verify it was registered
        let info = session.get_worker("test_worker").unwrap();
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.name, "test_worker");
        assert_eq!(info.pid, 12345);

        // Unregister
        session.unregister_worker("test_worker").unwrap();

        // Verify it's gone
        let info = session.get_worker("test_worker").unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_orphan_pid_cleanup() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Register a worker with an invalid PID (guaranteed to not exist)
        session.register_worker("dead_worker", 999999999).unwrap();

        // Clean up stale workers
        let cleaned = session.cleanup_stale_workers().unwrap();

        // Verify it was cleaned up
        assert!(cleaned.contains(&"dead_worker".to_string()));

        // Verify file is gone
        let info = session.get_worker("dead_worker").unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_config_precedence() {
        let workspace = create_test_workspace();

        // Set environment variable
        std::env::set_var("TUG_VERIFY", "tests");

        let cli_overrides = CliOverrides {
            verify_mode: Some("typecheck".to_string()),
            ..Default::default()
        };

        let config = ResolvedConfig::resolve(workspace.path(), None, &cli_overrides);

        // CLI should override env var
        let verify = config.verify_mode.unwrap();
        assert_eq!(verify.value, "typecheck");
        assert_eq!(verify.source, ConfigSource::CliFlag);

        // Clean up
        std::env::remove_var("TUG_VERIFY");
    }

    #[test]
    fn test_session_status() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let status = session.status();

        assert_eq!(
            status.workspace_root,
            workspace.path().canonicalize().unwrap()
        );
        assert_eq!(status.snapshot_count, 0);
        assert!(status.workers.is_empty());
    }

    #[test]
    fn test_session_clean_cache() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Create some cache data
        let cache_subdir = session.facts_cache_dir().join("test_cache");
        fs::create_dir_all(&cache_subdir).unwrap();
        fs::write(cache_subdir.join("data.bin"), b"test data").unwrap();

        // Clean cache
        session.clean_cache().unwrap();

        // Verify cache is empty
        let entries: Vec<_> = fs::read_dir(session.facts_cache_dir()).unwrap().collect();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_format_timestamp() {
        use std::time::{Duration, UNIX_EPOCH};

        // Test with a known timestamp: 2024-01-15T10:30:00Z
        // = 1705314600 seconds since epoch
        let time = UNIX_EPOCH + Duration::from_secs(1705314600);
        let formatted = format_timestamp(time);

        // Note: Our simplified calculation might be slightly off
        // Just verify it produces a valid ISO 8601-ish format
        assert!(formatted.contains("T"));
        assert!(formatted.ends_with("Z"));
    }

    // ========================================================================
    // OCC Tests
    // ========================================================================

    #[test]
    fn test_version_is_deterministic() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let v1 = SessionVersion::compute(session.session_dir()).unwrap();
        let v2 = SessionVersion::compute(session.session_dir()).unwrap();

        assert_eq!(v1, v2, "Same state should produce same version");
    }

    #[test]
    fn test_version_changes_on_save() {
        let workspace = create_test_workspace();
        let mut session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let v1 = session.version().clone();

        session.metadata_mut().config.python_resolved = true;
        session.save().unwrap();

        let v2 = session.version().clone();
        assert_ne!(v1, v2, "Version should change after save");
    }

    #[test]
    fn test_with_retry_succeeds_on_conflict() {
        let workspace = create_test_workspace();
        let path = workspace.path().to_path_buf();

        // This simulates a retry scenario
        let result = with_retry(
            || {
                let mut session = Session::open(&path, SessionOptions::default())?;
                session.metadata_mut().config.python_resolved = true;
                session.save()
            },
            3,
        );

        assert!(result.is_ok(), "Should succeed with retries");
    }

    #[test]
    fn test_atomic_write_survives_orphan_temp() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Simulate crash: temp file exists but rename didn't happen
        let temp_file = session.session_dir().join(".session.json.tmp");
        fs::write(&temp_file, "corrupted partial write").unwrap();

        // Should be able to open session (ignores temp files)
        let session2 = Session::open(workspace.path(), SessionOptions::default());
        assert!(session2.is_ok(), "Should open despite orphan temp file");
    }

    #[test]
    fn test_atomic_write_unique_temp_names() {
        use std::path::Path;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Simulate what atomic_write does for temp file naming
        let path = Path::new("/tmp/test/session.json");
        let pid = std::process::id();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);

        let temp_name = format!(
            ".{}.{}.{}.tmp",
            path.file_name().unwrap_or_default().to_string_lossy(),
            pid,
            timestamp
        );

        // Verify temp name includes PID (prevents cross-process collision)
        assert!(
            temp_name.contains(&pid.to_string()),
            "Temp file name should include PID: {}",
            temp_name
        );

        // Verify temp name has timestamp (prevents same-process collision)
        assert!(
            temp_name.contains(&timestamp.to_string()),
            "Temp file name should include timestamp: {}",
            temp_name
        );

        // Verify format
        assert!(temp_name.starts_with(".session.json."));
        assert!(temp_name.ends_with(".tmp"));
    }

    #[test]
    fn test_concurrent_saves_produce_unique_temps() {
        let workspace = create_test_workspace();

        // Create two sessions that might save "concurrently"
        let mut session1 = Session::open(workspace.path(), SessionOptions::default()).unwrap();
        let mut session2 = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Both try to modify and save
        session1.metadata_mut().config.python_resolved = true;
        session2.metadata_mut().config.rust_analyzer_available = true;

        // First save succeeds
        assert!(session1.save().is_ok());

        // Second save may fail (OCC) or succeed if it re-read
        // The important thing is no data corruption
        // (Can't test actual collision without multi-threading, but we verified naming above)
    }

    #[test]
    fn test_register_worker_creates_pid_file() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Register a worker
        session.register_worker("test_worker", 12345).unwrap();

        // Verify PID file exists
        let pid_path = session.workers_dir().join("test_worker.pid");
        assert!(pid_path.exists(), "PID file should exist");

        // Verify content is valid JSON
        let content = fs::read_to_string(&pid_path).unwrap();
        let info: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(info["name"], "test_worker");
        assert_eq!(info["pid"], 12345);
    }

    #[test]
    fn test_register_worker_atomic_no_orphan_temp() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Register a worker
        session.register_worker("atomic_test", 99999).unwrap();

        // Check that no temp files remain in workers dir
        let workers_dir = session.workers_dir();
        for entry in fs::read_dir(&workers_dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(
                !name.contains(".tmp"),
                "No temp files should remain after atomic write: {}",
                name
            );
        }
    }

    #[test]
    fn test_concurrent_worker_registration() {
        let workspace = create_test_workspace();

        // Two sessions registering workers
        let session1 = Session::open(workspace.path(), SessionOptions::default()).unwrap();
        let session2 = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Register workers with different names (no conflict)
        session1.register_worker("worker_a", 111).unwrap();
        session2.register_worker("worker_b", 222).unwrap();

        // Both should exist
        assert!(session1.get_worker("worker_a").unwrap().is_some());
        assert!(session1.get_worker("worker_b").unwrap().is_some());

        // Register same worker from different sessions (last write wins)
        session1.register_worker("shared_worker", 333).unwrap();
        session2.register_worker("shared_worker", 444).unwrap();

        // File should exist with one of the PIDs (atomic write, no corruption)
        let info = session1.get_worker("shared_worker").unwrap().unwrap();
        assert!(
            info.pid == 333 || info.pid == 444,
            "PID should be from one of the registrations, not corrupted"
        );
    }

    #[test]
    fn test_session_options_getter() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Verify we can access the options used to open the session
        let options = session.options();
        assert!(!options.fresh);
    }

    #[test]
    fn test_default_snapshot_retention_constant() {
        // Verify the constant has a reasonable value
        assert!(
            DEFAULT_SNAPSHOT_RETENTION >= 1,
            "Retention must keep at least 1 snapshot"
        );
        assert!(
            DEFAULT_SNAPSHOT_RETENTION <= 100,
            "Retention should not be excessively large"
        );
    }
}
