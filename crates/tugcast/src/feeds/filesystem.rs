//! Filesystem feed implementation
//!
//! Watches a directory for filesystem events and broadcasts them as FsEvent snapshots.

use std::path::{Path, PathBuf};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use async_trait::async_trait;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use tokio::sync::watch;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use tugcast_core::types::FsEvent;
use tugcast_core::{FeedId, Frame, SnapshotFeed};

/// Debounce window for batching filesystem events
const DEBOUNCE_MILLIS: u64 = 100;

/// Poll interval when no events are available
const POLL_MILLIS: u64 = 50;

/// Filesystem feed that watches a directory and broadcasts FsEvent batches
pub struct FilesystemFeed {
    watch_dir: PathBuf,
}

impl FilesystemFeed {
    /// Create a new filesystem feed watching the given directory
    pub fn new(watch_dir: PathBuf) -> Self {
        Self { watch_dir }
    }
}

/// Build gitignore matcher from .gitignore file in the watch directory
fn build_gitignore(watch_dir: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(watch_dir);
    let gitignore_path = watch_dir.join(".gitignore");

    if gitignore_path.exists() {
        if let Some(err) = builder.add(&gitignore_path) {
            warn!(path = ?gitignore_path, error = %err, "failed to load .gitignore");
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
fn is_ignored(path: &Path, watch_dir: &Path, gitignore: &Gitignore) -> bool {
    let relative = match path.strip_prefix(watch_dir) {
        Ok(rel) => rel,
        Err(_) => path,
    };

    // Check if this path is a directory by checking filesystem, or assume file if not exists
    let is_dir = path.is_dir();

    // Check the path itself
    if gitignore.matched(relative, is_dir).is_ignore() {
        return true;
    }

    // For files, also check if any parent directory is ignored
    if !is_dir {
        for ancestor in relative.ancestors().skip(1) {
            if ancestor == Path::new("") {
                break;
            }
            if gitignore.matched(ancestor, true).is_ignore() {
                return true;
            }
        }
    }

    false
}

/// Check if an FsEvent should be ignored
fn is_fsevent_ignored(event: &FsEvent, watch_dir: &Path, gitignore: &Gitignore) -> bool {
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

/// Convert notify Event to FsEvent values
fn convert_event(event: &Event, watch_dir: &Path) -> Vec<FsEvent> {
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

        EventKind::Modify(ModifyKind::Data(_))
        | EventKind::Modify(ModifyKind::Any)
        | EventKind::Modify(ModifyKind::Metadata(_)) => event
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

#[async_trait]
impl SnapshotFeed for FilesystemFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::Filesystem
    }

    fn name(&self) -> &str {
        "filesystem"
    }

    async fn run(&self, tx: watch::Sender<Frame>, cancel: CancellationToken) {
        // Build gitignore matcher
        let gitignore = build_gitignore(&self.watch_dir);

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
        info!(dir = ?self.watch_dir, "filesystem feed started");

        // Debounce loop
        let debounce_duration = Duration::from_millis(DEBOUNCE_MILLIS);
        let poll_duration = Duration::from_millis(POLL_MILLIS);
        let mut batch: Vec<FsEvent> = Vec::new();

        loop {
            // Check for cancellation
            if cancel.is_cancelled() {
                info!("filesystem feed shutting down");
                break;
            }

            // Drain all available events from the std channel (non-blocking)
            let mut received_events = false;
            loop {
                match event_rx.try_recv() {
                    Ok(Ok(event)) => {
                        received_events = true;
                        // Convert and filter events
                        let fs_events = convert_event(&event, &self.watch_dir);
                        for ev in fs_events {
                            if !is_fsevent_ignored(&ev, &self.watch_dir, &gitignore) {
                                batch.push(ev);
                            }
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

            // If we received events, wait for debounce window and flush
            if received_events && !batch.is_empty() {
                sleep(debounce_duration).await;

                // Drain any more events that arrived during debounce
                loop {
                    match event_rx.try_recv() {
                        Ok(Ok(event)) => {
                            let fs_events = convert_event(&event, &self.watch_dir);
                            for ev in fs_events {
                                if !is_fsevent_ignored(&ev, &self.watch_dir, &gitignore) {
                                    batch.push(ev);
                                }
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

                // Flush batch
                if !batch.is_empty() {
                    let json = serde_json::to_vec(&batch).unwrap_or_default();
                    let frame = Frame::new(FeedId::Filesystem, json);
                    let _ = tx.send(frame);
                    debug!(count = batch.len(), "filesystem events flushed");
                    batch.clear();
                }
            } else {
                // No events -- sleep briefly to avoid busy-polling
                sleep(poll_duration).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{event::CreateKind, event::DataChange, event::RemoveKind};
    use std::fs;
    use tempfile::TempDir;

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

    #[test]
    fn test_relative_path_computation() {
        let watch_dir = PathBuf::from("/home/user/project");
        let path = PathBuf::from("/home/user/project/src/main.rs");

        let relative = path
            .strip_prefix(&watch_dir)
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(relative, "src/main.rs");
    }

    #[test]
    fn test_gitignore_filtering() {
        let temp_dir = TempDir::new().unwrap();

        // Create the directories for testing
        fs::create_dir(temp_dir.path().join("target")).unwrap();
        fs::create_dir(temp_dir.path().join("target/debug")).unwrap();
        fs::create_dir(temp_dir.path().join("node_modules")).unwrap();
        fs::create_dir(temp_dir.path().join("src")).unwrap();

        let mut builder = GitignoreBuilder::new(temp_dir.path());

        // Add patterns
        builder.add_line(None, "target/").unwrap();
        builder.add_line(None, "node_modules/").unwrap();

        let gitignore = builder.build().unwrap();

        // Test ignored paths
        let target_path = temp_dir.path().join("target/debug/foo");
        let node_modules_path = temp_dir.path().join("node_modules/bar");
        let src_path = temp_dir.path().join("src/main.rs");

        assert!(is_ignored(&target_path, temp_dir.path(), &gitignore));
        assert!(is_ignored(&node_modules_path, temp_dir.path(), &gitignore));
        assert!(!is_ignored(&src_path, temp_dir.path(), &gitignore));
    }

    #[tokio::test]
    async fn test_filesystem_feed_integration() {
        let temp_dir = TempDir::new().unwrap();
        let watch_path = temp_dir.path().to_path_buf();

        // Create .gitignore file
        fs::write(watch_path.join(".gitignore"), "ignored_dir/\n").unwrap();

        // Create ignored directory
        fs::create_dir(watch_path.join("ignored_dir")).unwrap();

        // Create filesystem feed
        let feed = FilesystemFeed::new(watch_path.clone());

        // Create watch channel
        let (tx, mut rx) = watch::channel(Frame::new(FeedId::Filesystem, vec![]));

        // Create cancellation token
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        // Spawn feed in background
        let feed_task = tokio::spawn(async move {
            feed.run(tx, cancel_clone).await;
        });

        // Wait for watcher to initialize
        sleep(Duration::from_millis(150)).await;

        // Create a file
        let test_file = watch_path.join("test.txt");
        fs::write(&test_file, "hello").unwrap();

        // Modify the file
        sleep(Duration::from_millis(50)).await;
        fs::write(&test_file, "hello world").unwrap();

        // Remove the file
        sleep(Duration::from_millis(50)).await;
        fs::remove_file(&test_file).unwrap();

        // Create a file in ignored directory
        let ignored_file = watch_path.join("ignored_dir/secret.txt");
        fs::write(&ignored_file, "ignored").unwrap();

        // Wait for debounce and processing
        sleep(Duration::from_millis(400)).await;

        // Check for events
        rx.changed().await.unwrap();
        let frame = rx.borrow_and_update().clone();

        assert_eq!(frame.feed_id, FeedId::Filesystem);

        let events: Vec<FsEvent> = serde_json::from_slice(&frame.payload).unwrap();

        // Verify we got events for the non-ignored file
        assert!(!events.is_empty(), "should have received filesystem events");

        // Verify no events from ignored_dir
        for event in &events {
            match event {
                FsEvent::Created { path }
                | FsEvent::Modified { path }
                | FsEvent::Removed { path } => {
                    assert!(
                        !path.starts_with("ignored_dir/"),
                        "should not have events from ignored_dir"
                    );
                }
                FsEvent::Renamed { from, to } => {
                    assert!(!from.starts_with("ignored_dir/"));
                    assert!(!to.starts_with("ignored_dir/"));
                }
            }
        }

        // Cancel and wait for cleanup
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), feed_task).await;
    }

    #[test]
    fn test_feed_id_and_name() {
        let feed = FilesystemFeed::new(PathBuf::from("/tmp/test"));
        assert_eq!(feed.feed_id(), FeedId::Filesystem);
        assert_eq!(feed.name(), "filesystem");
    }
}
