//! Shared FileWatcher service
//!
//! Owns the notify watcher, gitignore handling, and directory walk.
//! Broadcasts `Vec<FsEvent>` batches to all subscribers via a broadcast channel.
//! Both FilesystemFeed and FileTreeFeed consume a clone of the broadcast sender.

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use tokio::sync::broadcast;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use tugcast_core::types::FsEvent;

/// Broadcast channel buffer capacity
const BROADCAST_CAPACITY: usize = 256;

/// Debounce window for batching filesystem events
pub(crate) const DEBOUNCE_MILLIS: u64 = 100;

/// Poll interval when no events are available
pub(crate) const POLL_MILLIS: u64 = 50;

/// Maximum number of files returned by walk()
// Used by FileTreeFeed (wired in step-4/step-5)
#[allow(dead_code)]
const WALK_CAP: usize = 50_000;

/// Shared filesystem watcher service.
///
/// Owns the notify watcher, gitignore handling, and initial directory walk.
/// Broadcasts `Vec<FsEvent>` batches to all subscribers.
pub struct FileWatcher {
    watch_dir: PathBuf,
}

impl FileWatcher {
    /// Create a new FileWatcher for the given directory.
    pub fn new(watch_dir: PathBuf) -> Self {
        Self { watch_dir }
    }

    /// Create a broadcast sender for distributing events to multiple consumers.
    ///
    /// Call this once, then pass clones of the returned sender to each feed.
    pub fn create_sender() -> broadcast::Sender<Vec<FsEvent>> {
        broadcast::channel(BROADCAST_CAPACITY).0
    }

    /// Walk the directory tree and return a sorted set of relative file paths.
    ///
    /// Uses `ignore::WalkBuilder` for proper nested `.gitignore` support.
    /// Skips `.git/` directories. Returns at most `WALK_CAP` files.
    ///
    /// Returns `(paths, truncated)` where `truncated` is true if the cap was hit.
    // Used by FileTreeFeed (wired in step-4/step-5)
    #[allow(dead_code)]
    pub fn walk(&self) -> (BTreeSet<String>, bool) {
        self.walk_with_cap(WALK_CAP)
    }

    /// Walk the directory tree with an explicit file count cap.
    ///
    /// This is the implementation backing `walk()`. Exposed for testing so that
    /// the truncation path can be exercised without creating 50,000 real files.
    pub(crate) fn walk_with_cap(&self, cap: usize) -> (BTreeSet<String>, bool) {
        let mut files: BTreeSet<String> = BTreeSet::new();
        let mut truncated = false;

        let walker = WalkBuilder::new(&self.watch_dir)
            .hidden(false)
            .git_ignore(true)
            .git_global(false)
            .git_exclude(false)
            .require_git(false)
            .build();

        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!(error = %e, "error walking directory");
                    continue;
                }
            };

            // Skip directories (we only want files)
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }

            let path = entry.path();

            // Strip the watch directory prefix to get the relative path
            let relative = match path.strip_prefix(&self.watch_dir) {
                Ok(rel) => rel.to_string_lossy().to_string(),
                Err(_) => continue,
            };

            // Skip .git/ contents (WalkBuilder should handle this via git_ignore,
            // but be explicit for safety)
            if relative.starts_with(".git/") || relative == ".git" {
                continue;
            }

            if files.len() >= cap {
                truncated = true;
                break;
            }

            files.insert(relative);
        }

        (files, truncated)
    }

    /// Start the filesystem watcher and broadcast events to all subscribers.
    ///
    /// Creates a `notify::RecommendedWatcher`, debounces events (100ms),
    /// converts to `Vec<FsEvent>`, filters via gitignore, detects `.gitignore`
    /// changes and rebuilds the matcher, then broadcasts batches.
    pub async fn run(self, tx: broadcast::Sender<Vec<FsEvent>>, cancel: CancellationToken) {
        // Build initial gitignore matcher
        let mut gitignore = build_gitignore(&self.watch_dir);

        // Create std::sync::mpsc channel for notify watcher
        let (event_tx, event_rx) = std_mpsc::channel();

        // Create watcher (must stay alive for the duration)
        let mut watcher = match notify::recommended_watcher(event_tx) {
            Ok(w) => w,
            Err(e) => {
                error!(error = %e, "failed to create filesystem watcher");
                return;
            }
        };

        // Start watching
        if let Err(e) = watcher.watch(&self.watch_dir, RecursiveMode::Recursive) {
            error!(dir = ?self.watch_dir, error = %e, "failed to watch directory");
            return;
        }
        info!(dir = ?self.watch_dir, "file watcher started");

        let debounce_duration = Duration::from_millis(DEBOUNCE_MILLIS);
        let poll_duration = Duration::from_millis(POLL_MILLIS);
        let mut batch: Vec<FsEvent> = Vec::new();

        loop {
            if cancel.is_cancelled() {
                info!("file watcher shutting down");
                break;
            }

            // Drain all available events from the std channel (non-blocking)
            let mut received_events = false;
            let mut gitignore_changed = false;

            loop {
                match event_rx.try_recv() {
                    Ok(Ok(event)) => {
                        received_events = true;
                        // Check for .gitignore changes before filtering
                        if is_gitignore_event(&event) {
                            gitignore_changed = true;
                        }
                        let fs_events = convert_event(&event, &self.watch_dir);
                        for ev in fs_events {
                            batch.push(ev);
                        }
                    }
                    Ok(Err(e)) => {
                        warn!(error = %e, "filesystem watcher error");
                    }
                    Err(std_mpsc::TryRecvError::Empty) => break,
                    Err(std_mpsc::TryRecvError::Disconnected) => {
                        error!("filesystem watcher channel disconnected");
                        return;
                    }
                }
            }

            if received_events && !batch.is_empty() {
                sleep(debounce_duration).await;

                // Drain any more events that arrived during debounce
                loop {
                    match event_rx.try_recv() {
                        Ok(Ok(event)) => {
                            if is_gitignore_event(&event) {
                                gitignore_changed = true;
                            }
                            let fs_events = convert_event(&event, &self.watch_dir);
                            for ev in fs_events {
                                batch.push(ev);
                            }
                        }
                        Ok(Err(e)) => {
                            warn!(error = %e, "filesystem watcher error");
                        }
                        Err(std_mpsc::TryRecvError::Empty) => break,
                        Err(std_mpsc::TryRecvError::Disconnected) => {
                            error!("filesystem watcher channel disconnected");
                            return;
                        }
                    }
                }

                // Rebuild gitignore if a .gitignore file changed
                if gitignore_changed {
                    debug!(".gitignore changed, rebuilding matcher");
                    gitignore = build_gitignore(&self.watch_dir);
                }

                // Filter via gitignore and deduplicate
                batch.retain(|ev| !is_fsevent_ignored(ev, &self.watch_dir, &gitignore));
                deduplicate_batch(&mut batch);

                if !batch.is_empty() {
                    let count = batch.len();
                    // send() returns Err only if there are no receivers; that's fine
                    let _ = tx.send(batch.clone());
                    debug!(count, "file watcher events broadcast");
                    batch.clear();
                }
            } else {
                sleep(poll_duration).await;
            }
        }
    }
}

/// Check if a notify Event touches a .gitignore file
pub(crate) fn is_gitignore_event(event: &Event) -> bool {
    event.paths.iter().any(|p| {
        p.file_name()
            .map(|n| n == ".gitignore")
            .unwrap_or(false)
    })
}

/// Build gitignore matcher from all .gitignore files found under the watch directory.
///
/// Uses `WalkBuilder` to discover `.gitignore` files at every directory level
/// (matching the coverage of `walk()`), then loads each one into a
/// `GitignoreBuilder`. This ensures that when a nested `.gitignore` changes and
/// the matcher is rebuilt, the new rules are picked up.
pub(crate) fn build_gitignore(watch_dir: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(watch_dir);

    // Walk the directory tree to discover .gitignore files at all levels.
    // We do NOT apply gitignore filtering during this walk — we want to find
    // all .gitignore files even inside otherwise-ignored directories.
    let walker = WalkBuilder::new(watch_dir)
        .hidden(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warn!(error = %e, "error walking directory while building gitignore");
                continue;
            }
        };

        // Only interested in files named exactly ".gitignore"
        if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            if entry.file_name() == ".gitignore" {
                let path = entry.path();
                if let Some(err) = builder.add(path) {
                    warn!(path = ?path, error = %err, "failed to load .gitignore");
                }
            }
        }
    }

    match builder.build() {
        Ok(gi) => gi,
        Err(e) => {
            warn!(error = %e, "failed to build gitignore matcher, using empty matcher");
            GitignoreBuilder::new(watch_dir).build().unwrap()
        }
    }
}

/// Check if a path should be ignored according to gitignore rules
pub(crate) fn is_ignored(path: &Path, watch_dir: &Path, gitignore: &Gitignore) -> bool {
    let relative = match path.strip_prefix(watch_dir) {
        Ok(rel) => rel,
        Err(_) => path,
    };

    // Always ignore the .git directory itself
    if relative.starts_with(".git") {
        return true;
    }

    // Check if this path is a directory by checking filesystem, or assume file if not exists
    let is_dir = path.is_dir();

    // Check the path itself
    if gitignore.matched(relative, is_dir).is_ignore() {
        return true;
    }

    // Check if any parent directory is ignored (matched() does not propagate
    // directory-level ignores to children, so we must walk up explicitly)
    for ancestor in relative.ancestors().skip(1) {
        if ancestor == Path::new("") {
            break;
        }
        if gitignore.matched(ancestor, true).is_ignore() {
            return true;
        }
    }

    false
}

/// Check if an FsEvent should be ignored
pub(crate) fn is_fsevent_ignored(event: &FsEvent, watch_dir: &Path, gitignore: &Gitignore) -> bool {
    match event {
        FsEvent::Created { path } | FsEvent::Modified { path } | FsEvent::Removed { path } => {
            let full_path = watch_dir.join(path);
            is_ignored(&full_path, watch_dir, gitignore)
        }
        FsEvent::Renamed { from, to } => {
            let from_path = watch_dir.join(from);
            let to_path = watch_dir.join(to);
            is_ignored(&from_path, watch_dir, gitignore)
                && is_ignored(&to_path, watch_dir, gitignore)
        }
    }
}

/// Remove redundant Modified events from a batch.
///
/// macOS FSEvents fires modify events for parent directories when their contents
/// change, and also fires redundant modify events alongside create/remove events
/// for the same file. This function drops Modified events for any path that also
/// has a Created or Removed event in the same batch, and drops Modified events
/// for paths that look like directories (end with "" which is the watch root).
pub(crate) fn deduplicate_batch(batch: &mut Vec<FsEvent>) {
    // Collect paths that have a Created, Removed, or Renamed event
    let mut non_modify_paths: HashSet<String> = HashSet::new();
    for ev in batch.iter() {
        match ev {
            FsEvent::Created { path } | FsEvent::Removed { path } => {
                non_modify_paths.insert(path.clone());
            }
            FsEvent::Renamed { from, to } => {
                non_modify_paths.insert(from.clone());
                non_modify_paths.insert(to.clone());
            }
            FsEvent::Modified { .. } => {}
        }
    }

    // Drop Modified events for paths that already have create/remove/rename,
    // and drop Modified events for the watch root (empty path = directory itself)
    batch.retain(|ev| {
        if let FsEvent::Modified { path } = ev {
            if path.is_empty() || non_modify_paths.contains(path.as_str()) {
                return false;
            }
        }
        true
    });
}

/// Convert notify Event to FsEvent values
pub(crate) fn convert_event(event: &Event, watch_dir: &Path) -> Vec<FsEvent> {
    let to_relative = |p: &Path| -> String {
        p.strip_prefix(watch_dir)
            .unwrap_or(p)
            .to_string_lossy()
            .to_string()
    };

    match &event.kind {
        EventKind::Create(_) => event
            .paths
            .iter()
            .map(|p| FsEvent::Created {
                path: to_relative(p),
            })
            .collect(),

        // Only Data changes are real file modifications.
        // Metadata (timestamps, permissions) and Any (ambiguous, often directory
        // listing changes) are noise — they fire alongside Create/Remove events.
        EventKind::Modify(ModifyKind::Data(_)) => event
            .paths
            .iter()
            .map(|p| FsEvent::Modified {
                path: to_relative(p),
            })
            .collect(),

        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            if event.paths.len() >= 2 {
                vec![FsEvent::Renamed {
                    from: to_relative(&event.paths[0]),
                    to: to_relative(&event.paths[1]),
                }]
            } else {
                vec![]
            }
        }

        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => event
            .paths
            .iter()
            .map(|p| FsEvent::Removed {
                path: to_relative(p),
            })
            .collect(),

        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => event
            .paths
            .iter()
            .map(|p| FsEvent::Created {
                path: to_relative(p),
            })
            .collect(),

        EventKind::Remove(_) => event
            .paths
            .iter()
            .map(|p| FsEvent::Removed {
                path: to_relative(p),
            })
            .collect(),

        // Skip other event kinds (Access, Any, Other)
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{event::CreateKind, event::DataChange, event::RemoveKind};
    use std::fs;
    use tempfile::TempDir;

    // ── walk() tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_walk_returns_relative_paths() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        fs::write(root.join("Cargo.toml"), "[package]").unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("src/lib.rs"), "pub fn hello() {}").unwrap();

        let watcher = FileWatcher::new(root);
        let (files, truncated) = watcher.walk();

        assert!(!truncated);
        assert!(files.contains("Cargo.toml"), "should contain Cargo.toml");
        assert!(files.contains("src/main.rs"), "should contain src/main.rs");
        assert!(files.contains("src/lib.rs"), "should contain src/lib.rs");
        // Directories should not be included
        assert!(!files.contains("src"), "should not contain directory entry");
    }

    #[test]
    fn test_walk_respects_gitignore() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        // Create .gitignore
        fs::write(root.join(".gitignore"), "target/\nnode_modules/\n").unwrap();

        // Create ignored and non-ignored files
        fs::create_dir(root.join("target")).unwrap();
        fs::create_dir(root.join("target/debug")).unwrap();
        fs::write(root.join("target/debug/binary"), "").unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/foo.js"), "").unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();

        let watcher = FileWatcher::new(root);
        let (files, truncated) = watcher.walk();

        assert!(!truncated);
        assert!(files.contains("src/main.rs"), "should include src/main.rs");
        assert!(
            !files.contains("target/debug/binary"),
            "should not include target/ contents"
        );
        assert!(
            !files.contains("node_modules/foo.js"),
            "should not include node_modules/ contents"
        );
    }

    #[test]
    fn test_walk_respects_nested_gitignore() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        // Root .gitignore
        fs::write(root.join(".gitignore"), "*.log\n").unwrap();

        // Subdirectory with its own .gitignore that unignores *.log
        fs::create_dir(root.join("logs")).unwrap();
        fs::write(root.join("logs/.gitignore"), "!*.log\n").unwrap();
        fs::write(root.join("logs/app.log"), "log content").unwrap();
        fs::write(root.join("debug.log"), "debug").unwrap();

        // A normal file that should always be included
        fs::write(root.join("README.md"), "readme").unwrap();

        let watcher = FileWatcher::new(root);
        let (files, truncated) = watcher.walk();

        assert!(!truncated);
        assert!(files.contains("README.md"), "should include README.md");
        // Root-level .log file is ignored by root .gitignore
        assert!(!files.contains("debug.log"), "should not include debug.log");
        // logs/app.log is re-included by nested .gitignore
        assert!(
            files.contains("logs/app.log"),
            "should include logs/app.log (nested gitignore override)"
        );
    }

    #[test]
    fn test_walk_skips_git_directory() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        // Simulate a .git directory
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();

        let watcher = FileWatcher::new(root);
        let (files, truncated) = watcher.walk();

        assert!(!truncated);
        assert!(files.contains("README.md"));
        assert!(
            !files.iter().any(|f| f.starts_with(".git")),
            "should not include .git/ contents"
        );
    }

    #[test]
    fn test_walk_with_cap_truncates_when_exceeded() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        // Create 5 files
        for i in 0..5u32 {
            fs::write(root.join(format!("file{i}.txt")), "data").unwrap();
        }

        let watcher = FileWatcher::new(root);

        // Cap of 3 with 5 files: should return exactly 3 files and truncated=true
        let (files, truncated) = watcher.walk_with_cap(3);
        assert!(truncated, "expected truncated=true when file count exceeds cap");
        assert_eq!(files.len(), 3, "expected exactly cap files returned");

        // Cap of 10 with 5 files: should return all 5 and truncated=false
        let (files, truncated) = watcher.walk_with_cap(10);
        assert!(!truncated, "expected truncated=false when file count is within cap");
        assert_eq!(files.len(), 5, "expected all 5 files returned");
    }

    // ── convert_event() tests ─────────────────────────────────────────────────

    #[test]
    fn test_convert_event_create() {
        let watch_dir = PathBuf::from("/tmp/test");
        let event = Event {
            kind: EventKind::Create(CreateKind::File),
            paths: vec![PathBuf::from("/tmp/test/file.txt")],
            attrs: Default::default(),
        };

        let fs_events = convert_event(&event, &watch_dir);
        assert_eq!(fs_events.len(), 1);
        match &fs_events[0] {
            FsEvent::Created { path } => assert_eq!(path, "file.txt"),
            _ => panic!("expected Created event"),
        }
    }

    #[test]
    fn test_convert_event_modify() {
        let watch_dir = PathBuf::from("/tmp/test");
        let event = Event {
            kind: EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            paths: vec![PathBuf::from("/tmp/test/file.txt")],
            attrs: Default::default(),
        };

        let fs_events = convert_event(&event, &watch_dir);
        assert_eq!(fs_events.len(), 1);
        match &fs_events[0] {
            FsEvent::Modified { path } => assert_eq!(path, "file.txt"),
            _ => panic!("expected Modified event"),
        }
    }

    #[test]
    fn test_convert_event_remove() {
        let watch_dir = PathBuf::from("/tmp/test");
        let event = Event {
            kind: EventKind::Remove(RemoveKind::File),
            paths: vec![PathBuf::from("/tmp/test/file.txt")],
            attrs: Default::default(),
        };

        let fs_events = convert_event(&event, &watch_dir);
        assert_eq!(fs_events.len(), 1);
        match &fs_events[0] {
            FsEvent::Removed { path } => assert_eq!(path, "file.txt"),
            _ => panic!("expected Removed event"),
        }
    }

    #[test]
    fn test_convert_event_rename_both() {
        let watch_dir = PathBuf::from("/tmp/test");
        let event = Event {
            kind: EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            paths: vec![
                PathBuf::from("/tmp/test/old.txt"),
                PathBuf::from("/tmp/test/new.txt"),
            ],
            attrs: Default::default(),
        };

        let fs_events = convert_event(&event, &watch_dir);
        assert_eq!(fs_events.len(), 1);
        match &fs_events[0] {
            FsEvent::Renamed { from, to } => {
                assert_eq!(from, "old.txt");
                assert_eq!(to, "new.txt");
            }
            _ => panic!("expected Renamed event"),
        }
    }

    // ── deduplicate_batch() tests ──────────────────────────────────────────────

    #[test]
    fn test_deduplicate_removes_modified_when_created() {
        let mut batch = vec![
            FsEvent::Created {
                path: "file.txt".to_string(),
            },
            FsEvent::Modified {
                path: "file.txt".to_string(),
            },
        ];
        deduplicate_batch(&mut batch);
        assert_eq!(batch.len(), 1);
        assert!(matches!(batch[0], FsEvent::Created { .. }));
    }

    #[test]
    fn test_deduplicate_removes_modified_when_removed() {
        let mut batch = vec![
            FsEvent::Modified {
                path: "gone.txt".to_string(),
            },
            FsEvent::Removed {
                path: "gone.txt".to_string(),
            },
        ];
        deduplicate_batch(&mut batch);
        assert_eq!(batch.len(), 1);
        assert!(matches!(batch[0], FsEvent::Removed { .. }));
    }

    #[test]
    fn test_deduplicate_keeps_standalone_modified() {
        let mut batch = vec![FsEvent::Modified {
            path: "changed.txt".to_string(),
        }];
        deduplicate_batch(&mut batch);
        assert_eq!(batch.len(), 1);
    }

    #[test]
    fn test_deduplicate_removes_empty_path_modified() {
        let mut batch = vec![
            FsEvent::Modified {
                path: "".to_string(),
            },
            FsEvent::Created {
                path: "real.txt".to_string(),
            },
        ];
        deduplicate_batch(&mut batch);
        assert_eq!(batch.len(), 1);
        assert!(matches!(batch[0], FsEvent::Created { .. }));
    }

    // ── build_gitignore() tests ───────────────────────────────────────────────

    #[test]
    fn test_build_gitignore_loads_root_gitignore() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        fs::write(root.join(".gitignore"), "*.log\n").unwrap();
        fs::write(root.join("debug.log"), "data").unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();

        let gitignore = build_gitignore(&root);

        // debug.log is matched by *.log rule
        let log_path = Path::new("debug.log");
        assert!(
            gitignore.matched(log_path, false).is_ignore(),
            "*.log should be ignored"
        );

        // README.md is not ignored
        let readme_path = Path::new("README.md");
        assert!(
            !gitignore.matched(readme_path, false).is_ignore(),
            "README.md should not be ignored"
        );
    }

    #[test]
    fn test_build_gitignore_discovers_nested_gitignore() {
        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path().to_path_buf();

        // Nested subdir with its own .gitignore that ignores *.tmp
        // (no root .gitignore — this rule only exists in a subdirectory)
        fs::create_dir(root.join("work")).unwrap();
        fs::write(root.join("work/.gitignore"), "*.tmp\n").unwrap();
        fs::write(root.join("work/scratch.tmp"), "").unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();

        let gitignore = build_gitignore(&root);

        // The nested .gitignore rule should be loaded, so *.tmp is ignored
        // (GitignoreBuilder without directory scoping, so **/*.tmp matches globally)
        let nested_tmp = Path::new("work/scratch.tmp");
        assert!(
            gitignore.matched(nested_tmp, false).is_ignore(),
            "work/scratch.tmp should be ignored by nested .gitignore"
        );

        // README.md should not be ignored
        let readme = Path::new("README.md");
        assert!(
            !gitignore.matched(readme, false).is_ignore(),
            "README.md should not be ignored"
        );
    }
}
