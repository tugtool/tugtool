//! Workspace registry — per-project feed bundle owner.
//!
//! A `WorkspaceEntry` owns one canonicalized project's FileWatcher,
//! FilesystemFeed, FileTreeFeed, and GitFeed, plus the watch receivers main.rs
//! wires into the router. The `WorkspaceRegistry` deduplicates entries by
//! canonicalized path so concurrent callers asking for the same workspace
//! share a single feed bundle.
//!
//! W1 scope: bootstrap-only. `main.rs` calls `get_or_create` exactly once for
//! the startup `--dir`. W2 adds per-session `get_or_create` calls from
//! `AgentSupervisor::spawn_session_worker` and introduces `release()`.
//!
//! See `roadmap/tugplan-workspace-registry-w1.md` specs S01/S02.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use thiserror::Error;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tugcast_core::SnapshotFeed;
use tugcast_core::protocol::{FeedId, Frame};

use crate::feeds::file_watcher::FileWatcher;
use crate::feeds::filesystem::FilesystemFeed;
use crate::feeds::filetree::{FileTreeFeed, FileTreeQuery};
use crate::feeds::git::GitFeed;
use crate::feeds::path_resolver::PathResolver;

/// Errors from [`WorkspaceRegistry`] operations.
///
/// W1 returned infallible `Arc<WorkspaceEntry>` because the bootstrap path
/// was the only caller and the underlying operations (canonicalize + spawn)
/// are infallible by construction. W2 introduces two real failure modes:
/// user-supplied `project_dir` paths that do not resolve to a directory
/// ([`InvalidProjectDir`]), and `release` calls on a key that is not in
/// the map ([`UnknownKey`], typically a double-close race).
///
/// [`InvalidProjectDir`]: WorkspaceError::InvalidProjectDir
/// [`UnknownKey`]: WorkspaceError::UnknownKey
#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("invalid project directory {path:?}: {reason}")]
    InvalidProjectDir {
        path: PathBuf,
        reason: &'static str,
    },

    /// Returned from `WorkspaceRegistry::release` when the key is not
    /// present in the map. Unused in production until Step 6 wires the
    /// supervisor's close/reset handlers into `release`; exercised by
    /// `test_release_unknown_key_returns_error` in the meantime.
    #[allow(dead_code)]
    #[error("unknown workspace key: {0}")]
    UnknownKey(String),
}

/// Canonical workspace identifier — wraps an `Arc<str>` so clones are cheap
/// and the same canonical path hashes/compares equal across instances.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct WorkspaceKey(Arc<str>);

impl WorkspaceKey {
    /// Obtain a cheap `Arc<str>` handle — used by feed constructors in #step-3.
    pub fn arc(&self) -> Arc<str> {
        Arc::clone(&self.0)
    }
}

impl AsRef<str> for WorkspaceKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Owner of one workspace's feed bundle.
///
/// Exposes the same surface `main.rs` wires into the router today:
/// the three watch receivers, the FILETREE query sender, and the four spawned
/// task handles. See Spec S01 for rationale.
pub struct WorkspaceEntry {
    /// Canonical key — also the map key in `WorkspaceRegistry`.
    /// Retained for test sanity-checks and for W2 `release()` back-reference
    /// when the registry learns to drop entries on session end.
    #[allow(dead_code)]
    pub workspace_key: WorkspaceKey,
    /// Original path input to `get_or_create`. Retained for W2, when
    /// `AgentSupervisor::spawn_session_worker` will read it to pass as the
    /// spawned Claude Code process's cwd (replacing `AgentSupervisorConfig::project_dir`).
    #[allow(dead_code)]
    pub project_dir: PathBuf,
    /// Router watch receivers.
    pub fs_watch_rx: watch::Receiver<Frame>,
    pub ft_watch_rx: watch::Receiver<Frame>,
    pub git_watch_rx: watch::Receiver<Frame>,
    /// FILETREE_QUERY input for the adapter in main.rs.
    pub ft_query_tx: mpsc::Sender<FileTreeQuery>,
    /// Spawned task handles. Retained so tests can assert `!is_finished()`
    /// and so W2 teardown can abort/join them when `release()` lands.
    #[allow(dead_code)]
    pub file_watcher_task: JoinHandle<()>,
    #[allow(dead_code)]
    pub filesystem_task: JoinHandle<()>,
    #[allow(dead_code)]
    pub filetree_task: JoinHandle<()>,
    #[allow(dead_code)]
    pub git_task: JoinHandle<()>,
    /// Cancellation token owned by this entry. Cloned into each spawned
    /// task at construction; `release` fires it when the refcount hits
    /// zero so the four tasks exit cleanly. Retained on the struct
    /// (rather than only cloned into tasks) so `release` has something
    /// to fire without needing to reach into the tasks themselves.
    ///
    /// Read only by `WorkspaceRegistry::release` (and tests). Production
    /// callers don't touch it until Step 6 wires the supervisor into
    /// `release`, hence the allow.
    #[allow(dead_code)]
    pub cancel: CancellationToken,
    /// Outstanding session count for this workspace. Bumped by
    /// `get_or_create` on a cache hit, decremented by `release`, and
    /// drives the teardown transition when it reaches zero. All mutations
    /// happen while the `WorkspaceRegistry::inner` mutex is held, so
    /// `Relaxed` ordering is sufficient — the atomic is belt-and-suspenders
    /// for visibility, not for cross-thread correctness ([D08]).
    pub ref_count: AtomicUsize,
}

impl WorkspaceEntry {
    /// Construct a workspace entry — creates all four feeds and spawns their
    /// tasks. Synchronous (does not `.await`), so it is safe to call while
    /// holding `WorkspaceRegistry::inner`'s std Mutex.
    ///
    /// In #step-2 the feed constructors do not yet take `workspace_key`;
    /// #step-3 adds that pass-through via `workspace_key.arc()`. Similarly,
    /// the three watch channels are initialized with empty-payload frames,
    /// matching today's `main.rs` bootstrap exactly — seeding is not needed
    /// because the tugcast router strips empty-payload frames from the
    /// LIVE-state initial snapshot send (see Spec S01 and router.rs).
    fn new(
        project_dir: PathBuf,
        workspace_key: WorkspaceKey,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        let file_watcher = FileWatcher::new(project_dir.clone());
        let fs_broadcast_tx = FileWatcher::create_sender();

        // Walk before the FileWatcher task consumes `file_watcher`.
        let (initial_files, ft_truncated) = file_watcher.walk();

        // FILETREE query channel.
        let (ft_query_tx, ft_query_rx) = mpsc::channel::<FileTreeQuery>(16);

        // Watch channels — empty payload, same as today's main.rs.
        let (fs_watch_tx, fs_watch_rx) = watch::channel(Frame::new(FeedId::FILESYSTEM, vec![]));
        let (ft_watch_tx, ft_watch_rx) = watch::channel(Frame::new(FeedId::FILETREE, vec![]));
        let (git_watch_tx, git_watch_rx) = watch::channel(Frame::new(FeedId::GIT, vec![]));

        // Construct feeds — pass `workspace_key.arc()` as a cheap Arc<str>
        // clone per [D02].
        let fs_feed = FilesystemFeed::new(
            project_dir.clone(),
            fs_broadcast_tx.clone(),
            workspace_key.arc(),
        );
        let ft_feed = FileTreeFeed::new(
            project_dir.clone(),
            initial_files,
            ft_truncated,
            fs_broadcast_tx.clone(),
            ft_query_rx,
            workspace_key.arc(),
        );
        let git_feed = GitFeed::new(project_dir.clone(), workspace_key.arc());

        // Spawn the four tasks with cancel-clone, mirroring main.rs.
        let fw_cancel = cancel.clone();
        let file_watcher_task = tokio::spawn(async move {
            file_watcher.run(fs_broadcast_tx, fw_cancel).await;
        });

        let fs_cancel = cancel.clone();
        let filesystem_task = tokio::spawn(async move {
            fs_feed.run(fs_watch_tx, fs_cancel).await;
        });

        let ft_cancel = cancel.clone();
        let filetree_task = tokio::spawn(async move {
            ft_feed.run(ft_watch_tx, ft_cancel).await;
        });

        let git_cancel = cancel.clone();
        let git_task = tokio::spawn(async move {
            git_feed.run(git_watch_tx, git_cancel).await;
        });

        Arc::new(Self {
            workspace_key,
            project_dir,
            fs_watch_rx,
            ft_watch_rx,
            git_watch_rx,
            ft_query_tx,
            file_watcher_task,
            filesystem_task,
            filetree_task,
            git_task,
            cancel,
            ref_count: AtomicUsize::new(1),
        })
    }
}

/// Dedup registry of workspace entries keyed by canonical path.
///
/// W2 introduces refcounting: `get_or_create` bumps an entry's `ref_count`
/// on a cache hit, and `release` decrements it, tearing the entry down
/// when the count reaches zero. All mutations happen under the held
/// `inner` mutex, which serializes the check-construct-insert and the
/// read-decrement-teardown sequences — two threads cannot race to both
/// construct the same workspace, nor can one thread decrement to zero
/// while another is bumping the same entry.
pub struct WorkspaceRegistry {
    /// The std Mutex is held across the check-construct-insert sequence
    /// and across the `release` decrement so that concurrent callers
    /// cannot both miss, both construct, and both insert, orphaning a
    /// set of spawned tasks. `WorkspaceEntry::new` is synchronous and
    /// never `.await`s while holding the lock.
    inner: Mutex<HashMap<WorkspaceKey, Arc<WorkspaceEntry>>>,
}

impl WorkspaceRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Look up or construct the workspace entry for `project_dir`.
    ///
    /// Validates that `project_dir` exists and is a directory via
    /// `std::fs::metadata` before canonicalizing — [`PathResolver::watch_path`]
    /// is infallible by design (returns the original on failure), so
    /// validation has to happen here or nowhere. Paths that do not exist,
    /// cannot be read, or point at a non-directory are rejected with
    /// [`WorkspaceError::InvalidProjectDir`].
    ///
    /// On success, canonicalizes via `PathResolver::watch_path()` so
    /// textually-distinct paths that resolve to the same directory
    /// (macOS firmlinks, symlinks, `..`-components) share a single entry.
    /// If an entry for the canonical key already exists, bumps its
    /// refcount under the held mutex and returns the existing `Arc`. If
    /// not, constructs a fresh entry with `ref_count = 1` and inserts it.
    pub fn get_or_create(
        &self,
        project_dir: &Path,
        cancel: CancellationToken,
    ) -> Result<Arc<WorkspaceEntry>, WorkspaceError> {
        // 1. Validate existence + directory-ness.
        let metadata =
            std::fs::metadata(project_dir).map_err(|e| WorkspaceError::InvalidProjectDir {
                path: project_dir.to_path_buf(),
                reason: match e.kind() {
                    std::io::ErrorKind::NotFound => "does_not_exist",
                    std::io::ErrorKind::PermissionDenied => "permission_denied",
                    _ => "metadata_error",
                },
            })?;
        if !metadata.is_dir() {
            return Err(WorkspaceError::InvalidProjectDir {
                path: project_dir.to_path_buf(),
                reason: "not_a_directory",
            });
        }

        // 2. Canonicalize.
        let canonical: String = PathResolver::new(project_dir.to_path_buf())
            .watch_path()
            .to_string_lossy()
            .into_owned();
        let workspace_key = WorkspaceKey(Arc::from(canonical));

        // 3. Held-mutex check-or-construct.
        let mut map = self.inner.lock().expect("WorkspaceRegistry mutex poisoned");

        if let Some(existing) = map.get(&workspace_key) {
            existing.ref_count.fetch_add(1, Ordering::Relaxed);
            return Ok(Arc::clone(existing));
        }

        let entry = WorkspaceEntry::new(project_dir.to_path_buf(), workspace_key.clone(), cancel);
        map.insert(workspace_key, Arc::clone(&entry));
        Ok(entry)
    }

    /// Decrement the refcount for `key` and, if it reaches zero, fire
    /// the entry's cancel token, remove it from the map, and drop the
    /// `Arc<WorkspaceEntry>`. The spawned tasks (file watcher, filesystem,
    /// filetree, git) see the cancel and exit on their own; we don't
    /// join them here — Step 5 scope is "refcount + teardown trigger,"
    /// not explicit task lifetime management.
    ///
    /// Returns [`WorkspaceError::UnknownKey`] if the key is not present
    /// in the map. Callers typically log and ignore this — it indicates
    /// a double-`release` or a `release` without a matching
    /// `get_or_create`, both of which are logic errors in the caller,
    /// not error conditions to propagate.
    ///
    /// Unused by production code until Step 6 wires the supervisor's
    /// close/reset handlers into `release`; exercised by the Step 5
    /// tests in the meantime.
    #[allow(dead_code)]
    pub fn release(&self, key: &WorkspaceKey) -> Result<(), WorkspaceError> {
        let mut map = self.inner.lock().expect("WorkspaceRegistry mutex poisoned");
        let Some(entry) = map.get(key) else {
            return Err(WorkspaceError::UnknownKey(key.as_ref().to_string()));
        };
        // `fetch_sub` returns the *previous* value. `prev == 1` means the
        // new count is 0 — time to tear down.
        let prev = entry.ref_count.fetch_sub(1, Ordering::Relaxed);
        if prev == 1 {
            entry.cancel.cancel();
            map.remove(key);
            // The Arc<WorkspaceEntry> we just removed drops here, and
            // with it the FileWatcher OS handle. Spawned tasks exit on
            // their own as the cancel token propagates.
        }
        Ok(())
    }
}

impl Default for WorkspaceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    /// Short helper — drain the runtime briefly and drop the registry so
    /// FileWatcher OS handles are released between tests.
    async fn drain_and_drop(registry: WorkspaceRegistry, cancel: CancellationToken) {
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::task::yield_now().await
        })
        .await;
        drop(registry);
    }

    #[tokio::test]
    async fn test_workspace_registry_bootstrap_construction() {
        let dir = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();

        let registry = WorkspaceRegistry::new();
        let entry = registry
            .get_or_create(dir.path(), cancel.clone())
            .expect("bootstrap tempdir is a valid workspace");

        assert!(!entry.file_watcher_task.is_finished());
        assert!(!entry.filesystem_task.is_finished());
        assert!(!entry.filetree_task.is_finished());
        assert!(!entry.git_task.is_finished());
        let key: &str = entry.workspace_key.as_ref();
        assert!(!key.is_empty());
        assert_eq!(
            entry.ref_count.load(Ordering::Relaxed),
            1,
            "fresh entry starts at refcount 1"
        );

        drop(entry);
        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_workspace_registry_deduplicates_canonical_paths() {
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();

        // Two textually-distinct inputs that canonicalize to the same directory.
        let first = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("first get_or_create");
        let indirect = tmp
            .path()
            .join("..")
            .join(tmp.path().file_name().expect("tempdir has name"));
        let second = registry
            .get_or_create(&indirect, cancel.clone())
            .expect("second get_or_create");

        assert!(
            Arc::ptr_eq(&first, &second),
            "dedup failed: registry returned a fresh entry for a path that canonicalizes to the same workspace"
        );

        {
            let map = registry.inner.lock().expect("mutex not poisoned");
            assert_eq!(map.len(), 1, "expected exactly one deduped entry");
        }
        assert_eq!(
            first.ref_count.load(Ordering::Relaxed),
            2,
            "two get_or_create calls must bump refcount to 2"
        );

        drop(first);
        drop(second);
        drain_and_drop(registry, cancel).await;
    }

    // ---- W2 Step 5: refcount + release ----

    #[tokio::test]
    async fn test_get_or_create_bumps_existing_refcount() {
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();

        let first = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("first");
        let second = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("second");

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(first.ref_count.load(Ordering::Relaxed), 2);
        {
            let map = registry.inner.lock().expect("mutex");
            assert_eq!(map.len(), 1);
        }

        drop(first);
        drop(second);
        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_release_decrements_refcount() {
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();

        let first = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("first");
        let _second = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("second");
        assert_eq!(first.ref_count.load(Ordering::Relaxed), 2);

        let key = first.workspace_key.clone();
        registry.release(&key).expect("first release");
        assert_eq!(first.ref_count.load(Ordering::Relaxed), 1);
        {
            let map = registry.inner.lock().expect("mutex");
            assert_eq!(map.len(), 1, "entry still present after first release");
        }

        drop(first);
        drop(_second);
        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_release_triggers_teardown_at_zero() {
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();

        let entry = registry
            .get_or_create(tmp.path(), cancel.clone())
            .expect("get_or_create");
        let key = entry.workspace_key.clone();
        // Grab the entry's own cancel token to observe the teardown signal
        // separately from the test-level cancel we pass in.
        let entry_cancel = entry.cancel.clone();
        drop(entry);

        registry.release(&key).expect("release to zero");
        {
            let map = registry.inner.lock().expect("mutex");
            assert_eq!(
                map.len(),
                0,
                "entry removed from map after refcount hit zero"
            );
        }
        assert!(
            entry_cancel.is_cancelled(),
            "release fires the entry's cancel token when refcount hits zero"
        );

        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_release_unknown_key_returns_error() {
        let registry = WorkspaceRegistry::new();
        let bogus_key = WorkspaceKey(Arc::from("/nonexistent/canonical/path"));
        let err = registry.release(&bogus_key).unwrap_err();
        match err {
            WorkspaceError::UnknownKey(s) => {
                assert_eq!(s, "/nonexistent/canonical/path");
            }
            other => panic!("expected UnknownKey, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_get_or_create_rejects_nonexistent_path() {
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();
        let result = registry.get_or_create(
            Path::new("/nonexistent/workspace-registry-test-xyz"),
            cancel.clone(),
        );
        match result {
            Ok(_) => panic!("expected InvalidProjectDir"),
            Err(WorkspaceError::InvalidProjectDir { reason, path }) => {
                assert_eq!(reason, "does_not_exist");
                assert_eq!(
                    path,
                    PathBuf::from("/nonexistent/workspace-registry-test-xyz")
                );
            }
            Err(other) => panic!("expected InvalidProjectDir, got {other:?}"),
        }
        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_get_or_create_rejects_file_path() {
        let tmp = TempDir::new().expect("create tempdir");
        let file_path = tmp.path().join("regular-file.txt");
        std::fs::write(&file_path, b"not a directory").expect("write file");

        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();
        let result = registry.get_or_create(&file_path, cancel.clone());
        match result {
            Ok(_) => panic!("expected InvalidProjectDir"),
            Err(WorkspaceError::InvalidProjectDir { reason, .. }) => {
                assert_eq!(reason, "not_a_directory");
            }
            Err(other) => panic!("expected InvalidProjectDir, got {other:?}"),
        }
        drain_and_drop(registry, cancel).await;
    }

    #[tokio::test]
    async fn test_concurrent_get_or_create_serializes_construction() {
        // Two tasks race to get_or_create on the same path. The held-mutex
        // check-or-construct must guarantee exactly one construction: both
        // tasks return the same Arc, the map holds one entry, and the
        // refcount is 2.
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = Arc::new(WorkspaceRegistry::new());

        let path_a = tmp.path().to_path_buf();
        let path_b = tmp.path().to_path_buf();
        let reg_a = Arc::clone(&registry);
        let reg_b = Arc::clone(&registry);
        let cancel_a = cancel.clone();
        let cancel_b = cancel.clone();

        let t_a = tokio::task::spawn_blocking(move || {
            reg_a.get_or_create(&path_a, cancel_a).expect("race a")
        });
        let t_b = tokio::task::spawn_blocking(move || {
            reg_b.get_or_create(&path_b, cancel_b).expect("race b")
        });
        let entry_a = t_a.await.expect("join a");
        let entry_b = t_b.await.expect("join b");

        assert!(
            Arc::ptr_eq(&entry_a, &entry_b),
            "held-mutex must serialize construction; both tasks must observe the same Arc"
        );
        assert_eq!(entry_a.ref_count.load(Ordering::Relaxed), 2);
        {
            let map = registry.inner.lock().expect("mutex");
            assert_eq!(map.len(), 1);
        }

        drop(entry_a);
        drop(entry_b);
        // Can't `drop(registry)` on an Arc<WorkspaceRegistry> directly, but
        // the Arcs taken by the tasks are already released. Cancel + yield
        // lets the background tasks wind down.
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::task::yield_now().await
        })
        .await;
    }
}
