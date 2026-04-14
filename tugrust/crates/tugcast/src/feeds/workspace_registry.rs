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
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tugcast_core::protocol::{FeedId, Frame};
use tugcast_core::SnapshotFeed;

use crate::feeds::file_watcher::FileWatcher;
use crate::feeds::filesystem::FilesystemFeed;
use crate::feeds::filetree::{FileTreeFeed, FileTreeQuery};
use crate::feeds::git::GitFeed;
use crate::feeds::path_resolver::PathResolver;

/// Canonical workspace identifier — wraps an `Arc<str>` so clones are cheap
/// and the same canonical path hashes/compares equal across instances.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct WorkspaceKey(Arc<str>);

impl WorkspaceKey {
    /// View the canonical path string.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Obtain a cheap `Arc<str>` handle — used by feed constructors in #step-3.
    pub fn arc(&self) -> Arc<str> {
        Arc::clone(&self.0)
    }
}

/// Owner of one workspace's feed bundle.
///
/// Exposes the same surface `main.rs` wires into the router today:
/// the three watch receivers, the FILETREE query sender, and the four spawned
/// task handles. See Spec S01 for rationale.
pub struct WorkspaceEntry {
    /// Canonical key — also the map key in `WorkspaceRegistry`.
    pub workspace_key: WorkspaceKey,
    /// Original path input to `get_or_create`, retained for logging and
    /// (in W2) for passing as the spawned session's cwd.
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
        })
    }
}

/// Dedup registry of workspace entries keyed by canonical path.
///
/// W1 is bootstrap-only: `main.rs` calls `get_or_create` once at startup.
/// No `release()` — entries live for the process lifetime (see [D04]).
pub struct WorkspaceRegistry {
    /// The std Mutex is held across the check-construct-insert sequence so
    /// that concurrent callers in W2 cannot both miss, both construct, and
    /// both insert, orphaning a set of spawned tasks. `WorkspaceEntry::new`
    /// is synchronous and never `.await`s while holding the lock.
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
    /// Canonicalizes via `PathResolver::watch_path()` so textually-distinct
    /// paths that resolve to the same directory (macOS firmlinks, symlinks,
    /// `..`-components) share a single entry. Returns `Arc<WorkspaceEntry>`
    /// directly — no `Result` wrapper in W1 because every underlying
    /// operation is infallible (see [D04]).
    pub fn get_or_create(
        &self,
        project_dir: &Path,
        cancel: CancellationToken,
    ) -> Arc<WorkspaceEntry> {
        let canonical: String = PathResolver::new(project_dir.to_path_buf())
            .watch_path()
            .to_string_lossy()
            .into_owned();
        let workspace_key = WorkspaceKey(Arc::from(canonical));

        let mut map = self
            .inner
            .lock()
            .expect("WorkspaceRegistry mutex poisoned");

        if let Some(existing) = map.get(&workspace_key) {
            return Arc::clone(existing);
        }

        let entry = WorkspaceEntry::new(project_dir.to_path_buf(), workspace_key.clone(), cancel);
        map.insert(workspace_key, Arc::clone(&entry));
        entry
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

    #[tokio::test]
    async fn test_workspace_registry_bootstrap_construction() {
        let dir = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();

        let registry = WorkspaceRegistry::new();
        let entry = registry.get_or_create(dir.path(), cancel.clone());

        assert!(!entry.file_watcher_task.is_finished());
        assert!(!entry.filesystem_task.is_finished());
        assert!(!entry.filetree_task.is_finished());
        assert!(!entry.git_task.is_finished());
        assert!(!entry.workspace_key.as_str().is_empty());

        // Cleanup: cancel tasks, give the runtime a bounded window, then drop
        // the registry so the entry's FileWatcher OS handle is released.
        drop(entry);
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::task::yield_now().await
        })
        .await;
        drop(registry);
    }

    #[tokio::test]
    async fn test_workspace_registry_deduplicates_canonical_paths() {
        let tmp = TempDir::new().expect("create tempdir");
        let cancel = CancellationToken::new();
        let registry = WorkspaceRegistry::new();

        // Two textually-distinct inputs that canonicalize to the same directory.
        let first = registry.get_or_create(tmp.path(), cancel.clone());
        let indirect = tmp
            .path()
            .join("..")
            .join(tmp.path().file_name().expect("tempdir has name"));
        let second = registry.get_or_create(&indirect, cancel.clone());

        assert!(
            Arc::ptr_eq(&first, &second),
            "dedup failed: registry returned a fresh entry for a path that canonicalizes to the same workspace"
        );

        {
            let map = registry.inner.lock().expect("mutex not poisoned");
            assert_eq!(map.len(), 1, "expected exactly one deduped entry");
        }

        drop(first);
        drop(second);
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::task::yield_now().await
        })
        .await;
        drop(registry);
    }
}
