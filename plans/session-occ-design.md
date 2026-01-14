# Optimistic Concurrency Control for Session Management

**Date:** 2026-01-12
**Status:** Design Proposal
**Scope:** tug session management (`crates/tug/src/session.rs`)

## Executive Summary

This document proposes replacing the `fs2` file-based locking in tug's session management with **Optimistic Concurrency Control (OCC)** using content hashing. This approach eliminates the fragility of file locks while providing robust conflict detection that works reliably across all platforms.

The core insight: **compute a hash over the data we expect to edit; if that hash changes during our processing, bail and let the caller retry.**

---

## Problem Statement

The current session management uses `fs2::FileExt` for file locking:

```rust
// Current approach (fragile)
fn acquire_lock(session_dir: &Path, options: &SessionOptions) -> SessionResult<File> {
    let lock_file = OpenOptions::new().create(true).open(lock_path)?;
    lock_file.try_lock_exclusive()?;  // fs2 lock
    Ok(lock_file)
}
```

**Problems with file locks:**

| Issue | Impact |
|-------|--------|
| Stale locks | Process crashes leave orphan lock files that block future operations |
| NFS issues | Advisory locks don't work reliably over network filesystems |
| Platform differences | Windows and Unix have subtly different lock semantics |
| Cleanup burden | Requires PID tracking, orphan detection, timeout handling |
| No graceful degradation | Either locked or not - no partial progress possible |

---

## Design Decision: Why OCC?

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| **File locks (current)** | Simple mental model | Fragile, platform-specific, stale locks |
| **PID files** | Can detect dead processes | Still leaves orphans, race conditions on check-then-use |
| **Database (SQLite)** | ACID guarantees | Heavy dependency, overkill for CLI tool |
| **Flock + timeout** | Automatic release on crash | Still has NFS issues, timeout choice is arbitrary |
| **OCC with hashing** | No cleanup needed, crash-safe, portable | Requires retry logic for conflicts |

### Why OCC Wins

1. **No external state to corrupt** - Hash is computed from actual file contents
2. **Process crashes leave no trace** - No lock files, no PID files to clean up
3. **Works identically everywhere** - macOS, Linux, Windows, NFS, SSHFS
4. **Aligns with git** - Same pattern git uses for refs and index operations
5. **Infrastructure exists** - `ContentHash` and SHA-256 already in codebase

---

## Design Overview

### The Pattern

```
Read Phase           Work Phase           Write Phase
    |                    |                    |
    v                    v                    v
[Compute Version] -> [Do Work] -> [Verify Version] -> [Atomic Write]
                                       |
                                       v
                              [Version Changed?]
                                   /       \
                                 Yes        No
                                  |          |
                                  v          v
                          [Abort/Retry]  [Success]
```

### Key Principles

1. **Read version, do work, verify before write** - The core OCC pattern
2. **Content is truth** - Hash of actual content, not metadata timestamps
3. **Fail-safe** - On any uncertainty, abort and let caller retry
4. **Atomic writes** - Use temp-file + rename for crash safety

---

## Data Structures

### Session Version Token

```rust
/// Version token for optimistic concurrency control.
///
/// Computed from the content hashes of all mutable session state.
/// If any file changes, the token changes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionVersion {
    /// SHA-256 hash of the combined session state
    pub hash: String,
    /// Timestamp for debugging/logging (not used for comparison)
    pub computed_at: String,
}

impl SessionVersion {
    /// Compute version from session state files.
    ///
    /// Includes:
    /// - session.json (metadata)
    /// - snapshots/current.json (current snapshot reference)
    /// - workers/*.pid (worker process state)
    ///
    /// Does NOT include:
    /// - Historical snapshots (snapshots/<id>.json) - immutable after creation
    /// - Facts cache (facts_cache/*) - derived data, can be regenerated
    /// - Logs (logs/*) - append-only, not critical for correctness
    pub fn compute(session_dir: &Path) -> io::Result<Self> {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();

        // 1. Hash session.json content
        let session_json = session_dir.join("session.json");
        if session_json.exists() {
            hasher.update(&fs::read(&session_json)?);
            hasher.update(b"\x00");  // null byte separator
        }

        // 2. Hash current snapshot reference
        let current_json = session_dir.join("snapshots/current.json");
        if current_json.exists() {
            hasher.update(&fs::read(&current_json)?);
            hasher.update(b"\x00");
        }

        // 3. Hash worker state (sorted for determinism)
        let workers_dir = session_dir.join("workers");
        if workers_dir.exists() {
            let mut worker_files: Vec<_> = fs::read_dir(&workers_dir)?
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension()
                        .map(|ext| ext == "pid")
                        .unwrap_or(false)
                })
                .collect();

            // Sort by filename for deterministic ordering
            worker_files.sort_by_key(|e| e.path());

            for entry in worker_files {
                hasher.update(&fs::read(entry.path())?);
                hasher.update(b"\x00");
            }
        }

        let result = hasher.finalize();
        Ok(SessionVersion {
            hash: hex::encode(result),
            computed_at: format_timestamp(SystemTime::now()),
        })
    }
}
```

### Modified Session Handle

```rust
/// Session handle with optimistic concurrency control.
///
/// Unlike the lock-based approach, this handle does NOT hold an exclusive
/// lock. Instead, it captures a version token on open and verifies it
/// before any write operation.
///
/// # Concurrency Model
///
/// Multiple processes can open the same session simultaneously for reading.
/// When writing:
/// 1. Verify the session hasn't changed since we opened it
/// 2. Write atomically using temp-file + rename
/// 3. If version mismatch, return error for caller to retry
///
/// # Example
///
/// ```rust,ignore
/// let mut session = Session::open(&workspace, SessionOptions::default())?;
///
/// // Do some work
/// session.metadata_mut().config.python_resolved = true;
///
/// // Save with automatic version verification
/// match session.save() {
///     Ok(()) => println!("Saved successfully"),
///     Err(SessionError::ConcurrentModification { .. }) => {
///         println!("Session was modified - retry needed");
///     }
///     Err(e) => return Err(e),
/// }
/// ```
pub struct Session {
    /// Path to the workspace root.
    workspace_root: PathBuf,
    /// Path to the session directory (.tug/).
    session_dir: PathBuf,
    /// Session metadata (from session.json).
    metadata: SessionMetadata,
    /// Version token captured when session was opened.
    /// Used to detect concurrent modifications.
    base_version: SessionVersion,
    /// Tracks whether we've made any changes that need to be written.
    dirty: bool,
    /// Options used to open the session.
    #[allow(dead_code)]
    options: SessionOptions,
}
```

### New Error Variant

```rust
#[derive(Debug, Error)]
pub enum SessionError {
    // ... existing variants ...

    /// Session was modified by another process during our operation.
    ///
    /// This error indicates that between opening the session and attempting
    /// to write, another process modified the session state. The caller should
    /// typically:
    /// 1. Re-open the session to get fresh state
    /// 2. Re-apply their changes
    /// 3. Try to save again
    ///
    /// See `with_retry()` helper for automatic retry logic.
    #[error("session was modified concurrently (expected version {expected_hash}, found {actual_hash})")]
    ConcurrentModification {
        expected_hash: String,
        actual_hash: String,
    },
}
```

---

## Read/Write Protocol

### Opening a Session (Read Phase)

```rust
impl Session {
    /// Open a session for reading and potentially writing.
    ///
    /// This captures the current state version but does NOT acquire any lock.
    /// Multiple processes can open the same session simultaneously.
    pub fn open(workspace_root: impl AsRef<Path>, options: SessionOptions) -> SessionResult<Self> {
        let workspace_root = workspace_root.as_ref();

        // Validate workspace exists
        if !workspace_root.exists() {
            return Err(SessionError::WorkspaceNotFound {
                expected: workspace_root.to_path_buf(),
            });
        }

        let workspace_root = workspace_root.canonicalize()?;
        let session_dir = Self::resolve_session_dir(&workspace_root, &options);

        // Handle --fresh flag
        if options.fresh && session_dir.exists() {
            Self::atomic_fresh_reset(&session_dir)?;
        }

        // Create structure if needed (idempotent operation)
        Self::ensure_session_structure(&session_dir)?;

        // Load metadata
        let metadata = Self::load_or_create_metadata(&session_dir, &workspace_root)?;

        // Validate workspace root matches
        let current_hash = hash_path(&workspace_root);
        if metadata.workspace_root_hash != current_hash {
            return Err(SessionError::WorkspaceRootMismatch {
                session_root: metadata.workspace_root.clone(),
                current_root: workspace_root.clone(),
            });
        }

        // Capture version token for OCC
        let base_version = SessionVersion::compute(&session_dir)?;

        Ok(Session {
            workspace_root,
            session_dir,
            metadata,
            base_version,
            dirty: false,
            options,
        })
    }
}
```

### Modifying Session State

```rust
impl Session {
    /// Get mutable access to session metadata.
    ///
    /// Marks the session as dirty, requiring a save() call to persist changes.
    pub fn metadata_mut(&mut self) -> &mut SessionMetadata {
        self.dirty = true;
        &mut self.metadata
    }
}
```

### Writing Session State (Verify-and-Write Phase)

```rust
impl Session {
    /// Save session changes with optimistic concurrency verification.
    ///
    /// # Errors
    ///
    /// Returns `Err(SessionError::ConcurrentModification)` if the session
    /// was modified by another process since we opened it.
    ///
    /// # Atomicity
    ///
    /// Writes are atomic: either all changes are persisted, or none are.
    /// A crash during save() will not corrupt the session.
    pub fn save(&mut self) -> SessionResult<()> {
        if !self.dirty {
            return Ok(());  // Nothing to save
        }

        // Step 1: Compute current version
        let current_version = SessionVersion::compute(&self.session_dir)?;

        // Step 2: Verify version matches our base
        if current_version != self.base_version {
            return Err(SessionError::ConcurrentModification {
                expected_hash: self.base_version.hash.clone(),
                actual_hash: current_version.hash,
            });
        }

        // Step 3: Write atomically using temp + rename
        self.metadata.touch();
        self.atomic_write_metadata()?;

        // Step 4: Update our base version to the new state
        self.base_version = SessionVersion::compute(&self.session_dir)?;
        self.dirty = false;

        Ok(())
    }

    /// Atomically write metadata using temp file + rename.
    ///
    /// This pattern ensures crash safety:
    /// - If we crash before rename: temp file is orphaned (harmless)
    /// - If we crash during rename: atomic on POSIX, near-atomic on Windows
    /// - If we crash after rename: write completed successfully
    fn atomic_write_metadata(&self) -> SessionResult<()> {
        let metadata_path = self.session_dir.join("session.json");
        let temp_path = self.session_dir.join(".session.json.tmp");

        // Write to temp file
        let content = serde_json::to_string_pretty(&self.metadata)?;
        fs::write(&temp_path, &content)?;

        // Sync to disk for extra safety (optional, adds ~1ms)
        // let file = fs::File::open(&temp_path)?;
        // file.sync_all()?;

        // Atomic rename
        fs::rename(&temp_path, &metadata_path)?;

        Ok(())
    }
}
```

### Saving Snapshots (With OCC)

```rust
impl Session {
    /// Save a snapshot with optimistic concurrency verification.
    ///
    /// # Errors
    ///
    /// Returns `Err(SessionError::ConcurrentModification)` if another
    /// process modified the session while we were working.
    pub fn save_snapshot(&mut self, snapshot: &WorkspaceSnapshot) -> SessionResult<()> {
        // Verify version before any writes
        let current_version = SessionVersion::compute(&self.session_dir)?;
        if current_version != self.base_version {
            return Err(SessionError::ConcurrentModification {
                expected_hash: self.base_version.hash.clone(),
                actual_hash: current_version.hash,
            });
        }

        let snapshot_id = snapshot.snapshot_id.0.clone();
        let snapshots_dir = self.snapshots_dir();

        // Write snapshot file atomically
        let snapshot_path = snapshots_dir.join(format!("{}.json", snapshot_id));
        let temp_path = snapshots_dir.join(format!(".{}.json.tmp", snapshot_id));

        let content = serde_json::to_string_pretty(snapshot)?;
        fs::write(&temp_path, &content)?;
        fs::rename(&temp_path, &snapshot_path)?;

        // Update current.json atomically
        let current_path = snapshots_dir.join("current.json");
        let current_temp = snapshots_dir.join(".current.json.tmp");
        fs::write(&current_temp, &content)?;
        fs::rename(&current_temp, &current_path)?;

        // Update metadata
        self.metadata.config.current_snapshot_id = Some(snapshot_id);
        self.dirty = true;

        // Save metadata (includes version verification)
        self.save()?;

        // Enforce retention policy
        self.enforce_snapshot_retention(5)?;

        Ok(())
    }
}
```

---

## Conflict Detection and Handling

### When Conflicts Occur

```
Process A                    Process B
    |                            |
    v                            v
Open Session                 Open Session
(base_version = V1)          (base_version = V1)
    |                            |
    v                            |
Modify metadata                  |
    |                            |
    v                            v
Save()                       Modify metadata
  - Verify: V1 == V1 (ok)        |
  - Write atomically             |
  - base_version = V2            |
    |                            v
    |                        Save()
    |                          - Verify: V1 != V2 (CONFLICT!)
    |                          - Return ConcurrentModification
    |                            |
    |                            v
    |                        Retry Logic
    |                          - Re-open session
    |                          - Re-apply changes
    |                          - Try save again
```

### Retry Helper

```rust
/// Execute an operation with automatic retry on concurrent modification.
///
/// # Arguments
///
/// * `operation` - A closure that opens a session, does work, and saves
/// * `max_retries` - Maximum number of retry attempts (0 = no retries)
///
/// # Example
///
/// ```rust,ignore
/// let result = with_retry(|| {
///     let mut session = Session::open(&workspace, SessionOptions::default())?;
///     let snapshot = WorkspaceSnapshot::create(&workspace, &config)?;
///     session.save_snapshot(&snapshot)?;
///     Ok(snapshot.snapshot_id.clone())
/// }, 3)?;
/// ```
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
                // Exponential backoff: 50ms, 100ms, 200ms, ...
                let delay_ms = 50 * (1 << attempts.min(5));
                std::thread::sleep(Duration::from_millis(delay_ms));
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}
```

---

## Atomic Operations

### Atomic File Write Pattern

```rust
/// Write content to a file atomically using temp + rename.
///
/// This ensures that readers either see the old content or the new content,
/// never a partially-written file.
fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    // Use hidden temp file in same directory
    let temp_path = path.with_file_name(format!(
        ".{}.tmp",
        path.file_name().unwrap().to_string_lossy()
    ));

    // Write content to temp file
    fs::write(&temp_path, content)?;

    // Atomic rename (POSIX guarantees atomicity for same-filesystem rename)
    fs::rename(&temp_path, path)?;

    Ok(())
}
```

### Atomic Fresh Reset Pattern

```rust
impl Session {
    /// Atomically reset session to fresh state.
    ///
    /// Uses directory rename to ensure atomicity - another process reading
    /// the session will either see the old state or the new state, never
    /// a partially-reset session.
    fn atomic_fresh_reset(session_dir: &Path) -> io::Result<()> {
        // Create new empty session in temp location
        let parent = session_dir.parent().unwrap_or(Path::new("."));
        let temp_dir = parent.join(".tug.fresh.tmp");

        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(&temp_dir)?;

        // Create subdirectory structure
        for subdir in &["python", "workers", "snapshots", "facts_cache", "logs"] {
            fs::create_dir_all(temp_dir.join(subdir))?;
        }

        // Atomic swap: old -> trash, new -> place
        let trash_dir = parent.join(".tug.old.tmp");

        if session_dir.exists() {
            // Move old to trash
            if trash_dir.exists() {
                fs::remove_dir_all(&trash_dir)?;
            }
            fs::rename(session_dir, &trash_dir)?;
        }

        // Move new into place
        fs::rename(&temp_dir, session_dir)?;

        // Clean up trash (best effort, non-critical)
        let _ = fs::remove_dir_all(&trash_dir);

        Ok(())
    }
}
```

---

## Comparison with Prior Art

### Git's Approach

Git uses a similar pattern for refs:

```
1. Read ref value (e.g., HEAD -> abc123)
2. Do work (create new commit def456)
3. Create .lock file with new value
4. Rename .lock to ref (atomic compare-and-swap semantics)
```

Git's `.lock` files aren't traditional locks - they're temp files for atomic rename. The "lock" is just a naming convention indicating work in progress.

**Key insight:** Git's `git reflog` provides recovery if things go wrong. Our approach doesn't need reflog because session state is easily reconstructable.

### SQLite's Write-Ahead Log (WAL)

```
1. Write changes to WAL file
2. At checkpoint, verify no conflicts
3. Apply WAL entries to main database
```

Our approach is simpler because:
- Each operation is self-contained (no transaction log needed)
- Session state is small (<100KB typically)
- Full re-read on conflict is acceptable

### etcd / CockroachDB MVCC

Distributed databases use Multi-Version Concurrency Control:

```
1. Version numbers on all data
2. Optimistic execution (no locks)
3. Conflict detection at commit time
4. Retry with fresh version on conflict
```

Our `SessionVersion` hash serves the same purpose as their version numbers.

---

## Migration Path

### Phase 1: Add OCC Infrastructure (Non-Breaking)

Add new types alongside existing lock-based code:

```rust
// New file: session_version.rs
impl SessionVersion { ... }

// In session.rs, add methods:
impl Session {
    /// Compute and return current session version.
    pub fn version(&self) -> &SessionVersion {
        &self.base_version
    }

    /// Check if session has been modified externally.
    pub fn is_stale(&self) -> SessionResult<bool> {
        let current = SessionVersion::compute(&self.session_dir)?;
        Ok(current != self.base_version)
    }
}
```

### Phase 2: Replace Lock Acquisition

Remove `fs2` dependency and lock-related code:

```diff
// Cargo.toml
- fs2 = "0.4"

// session.rs
 pub struct Session {
     workspace_root: PathBuf,
     session_dir: PathBuf,
     metadata: SessionMetadata,
-    lock_file: Option<File>,
+    base_version: SessionVersion,
+    dirty: bool,
     options: SessionOptions,
 }
```

### Phase 3: Update All Write Operations

Ensure all state-modifying methods:
1. Mark session as dirty
2. Verify version in save()
3. Use atomic write pattern

```rust
// Before (lock-based)
pub fn register_worker(&self, name: &str, pid: u32) -> SessionResult<()> {
    let pid_path = self.workers_dir().join(format!("{}.pid", name));
    let info = WorkerInfo::new(name, pid);
    fs::write(&pid_path, serde_json::to_string(&info)?)?;
    Ok(())
}

// After (OCC-based)
pub fn register_worker(&mut self, name: &str, pid: u32) -> SessionResult<()> {
    // Verify before write
    let current = SessionVersion::compute(&self.session_dir)?;
    if current != self.base_version {
        return Err(SessionError::ConcurrentModification { ... });
    }

    // Atomic write
    let pid_path = self.workers_dir().join(format!("{}.pid", name));
    let temp_path = self.workers_dir().join(format!(".{}.pid.tmp", name));
    let info = WorkerInfo::new(name, pid);
    fs::write(&temp_path, serde_json::to_string(&info)?)?;
    fs::rename(&temp_path, &pid_path)?;

    // Update version
    self.base_version = SessionVersion::compute(&self.session_dir)?;
    Ok(())
}
```

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod occ_tests {
    use super::*;

    #[test]
    fn test_version_is_deterministic() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let v1 = SessionVersion::compute(session.session_dir()).unwrap();
        let v2 = SessionVersion::compute(session.session_dir()).unwrap();

        assert_eq!(v1, v2, "Same state should produce same version");
    }

    #[test]
    fn test_version_changes_on_metadata_change() {
        let workspace = create_test_workspace();
        let mut session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let v1 = session.version().clone();

        session.metadata_mut().config.python_resolved = true;
        session.save().unwrap();

        let v2 = session.version().clone();
        assert_ne!(v1, v2, "Version should change after save");
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

        assert!(result.is_ok(), "Should save when no concurrent modification");
    }

    #[test]
    fn test_atomic_write_survives_crash() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        // Simulate crash: temp file exists but rename didn't happen
        let temp_file = session.session_dir().join(".session.json.tmp");
        fs::write(&temp_file, "corrupted partial write").unwrap();

        // Should be able to open session (ignores temp files)
        let session2 = Session::open(workspace.path(), SessionOptions::default());
        assert!(session2.is_ok(), "Should open despite orphan temp file");

        // Original session.json should be intact
        let session2 = session2.unwrap();
        assert!(session2.metadata().version == "1");
    }

    #[test]
    fn test_version_includes_worker_state() {
        let workspace = create_test_workspace();
        let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

        let v1 = session.version().clone();

        // Externally add a worker file (simulating another process)
        let worker_file = session.workers_dir().join("test.pid");
        fs::write(&worker_file, r#"{"pid":12345,"name":"test","started_at":"2024-01-01T00:00:00Z"}"#).unwrap();

        let v2 = SessionVersion::compute(session.session_dir()).unwrap();
        assert_ne!(v1, v2, "Version should change when workers change");
    }
}
```

### Integration Tests

```rust
#[test]
fn test_parallel_sessions_with_retry() {
    let workspace = create_test_workspace();
    let path = workspace.path().to_path_buf();

    // Spawn multiple threads that all try to save snapshots
    let handles: Vec<_> = (0..4)
        .map(|i| {
            let path = path.clone();
            std::thread::spawn(move || {
                with_retry(|| {
                    let mut session = Session::open(&path, SessionOptions::default())?;
                    session.metadata_mut().config.python_resolved = true;
                    session.save()
                }, 5)
            })
        })
        .collect();

    // All should eventually succeed
    for (i, handle) in handles.into_iter().enumerate() {
        assert!(
            handle.join().unwrap().is_ok(),
            "Thread {} should succeed with retries", i
        );
    }
}

#[test]
fn test_high_contention_eventually_succeeds() {
    let workspace = create_test_workspace();
    let path = workspace.path().to_path_buf();
    let success_count = Arc::new(AtomicUsize::new(0));

    // 10 threads, each trying 10 times
    let handles: Vec<_> = (0..10)
        .map(|_| {
            let path = path.clone();
            let counter = Arc::clone(&success_count);
            std::thread::spawn(move || {
                for _ in 0..10 {
                    let result = with_retry(|| {
                        let mut session = Session::open(&path, SessionOptions::default())?;
                        session.metadata_mut().touch();
                        session.save()
                    }, 10);

                    if result.is_ok() {
                        counter.fetch_add(1, Ordering::SeqCst);
                    }
                }
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    // Should have high success rate with retries
    let successes = success_count.load(Ordering::SeqCst);
    assert!(
        successes >= 90, // At least 90% success rate
        "Expected high success rate, got {}/100", successes
    );
}
```

---

## Performance Considerations

### Hash Computation Cost

Computing `SessionVersion` requires reading:

| File | Typical Size | Read Time |
|------|--------------|-----------|
| session.json | ~1 KB | <0.1 ms |
| snapshots/current.json | ~10 KB | <0.1 ms |
| workers/*.pid (0-3 files) | ~300 bytes total | <0.1 ms |

**Total: ~15 KB read + SHA-256 hash = <1 ms on any modern system**

This is negligible compared to actual session operations (snapshot creation, worker spawning).

### Comparison with File Locking

| Operation | File Lock | OCC |
|-----------|-----------|-----|
| Open session | ~1 ms (syscall) | ~1 ms (read + hash) |
| Check if locked | ~0.1 ms (syscall) | ~1 ms (read + hash) |
| Write (no contention) | ~1 ms | ~2 ms (verify + write + rename) |
| Write (contention) | Block or fail | Fail fast, enable retry |
| Crash recovery | Need cleanup | Automatic |

**OCC is slightly slower per-operation but more predictable and robust.**

---

## Summary

### What We Gain

1. **Crash safety** - No orphan locks, no cleanup needed after crashes
2. **Platform independence** - Works identically on macOS, Linux, Windows, NFS
3. **Simplicity** - Remove fs2 dependency, PID tracking, orphan detection
4. **Debuggability** - Version hashes are inspectable and deterministic
5. **Composability** - Easy to build retry logic, progress reporting

### What We Trade Off

1. **Last-writer-wins risk** - Without blocking, rapid writes could conflict
   - **Mitigation:** Version verification catches this; retry logic handles it

2. **No blocking waits** - Can't wait for another process to finish
   - **Mitigation:** Retry with backoff achieves same effect with better semantics

3. **Slightly more verification code** - Must verify before every write
   - **Mitigation:** Pattern is consistent and can be factored into helpers

### Recommendation

**Implement OCC as described.** The benefits of crash safety, platform independence, and elimination of stale lock issues far outweigh the minor complexity of version verification. The pattern is well-established (git, databases) and fits naturally with the existing content-hash infrastructure in tug.
