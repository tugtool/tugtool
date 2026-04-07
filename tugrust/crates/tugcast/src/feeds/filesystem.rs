//! Filesystem feed implementation
//!
//! Thin broadcast consumer: subscribes to the FileWatcher broadcast channel
//! and forwards Vec<FsEvent> batches as Frame::new(FeedId::FILESYSTEM, json).

use std::path::PathBuf;

use async_trait::async_trait;
use tokio::sync::{broadcast, watch};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use tugcast_core::types::FsEvent;
use tugcast_core::{FeedId, Frame, SnapshotFeed};

/// Filesystem feed — thin consumer of the FileWatcher broadcast channel.
pub struct FilesystemFeed {
    watch_dir: PathBuf,
    event_tx: broadcast::Sender<Vec<FsEvent>>,
}

impl FilesystemFeed {
    /// Create a new filesystem feed.
    ///
    /// `watch_dir` is used only for logging. `event_tx` is the broadcast sender
    /// created by the FileWatcher; `run()` calls `subscribe()` on it to get its
    /// own receiver.
    pub fn new(watch_dir: PathBuf, event_tx: broadcast::Sender<Vec<FsEvent>>) -> Self {
        Self {
            watch_dir,
            event_tx,
        }
    }
}

#[async_trait]
impl SnapshotFeed for FilesystemFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::FILESYSTEM
    }

    fn name(&self) -> &str {
        "filesystem"
    }

    async fn run(&self, tx: watch::Sender<Frame>, cancel: CancellationToken) {
        let mut rx = self.event_tx.subscribe();
        info!(dir = ?self.watch_dir, "filesystem feed started");

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    info!("filesystem feed shutting down");
                    break;
                }
                result = rx.recv() => {
                    match result {
                        Ok(batch) => {
                            let json = serde_json::to_vec(&batch).unwrap_or_default();
                            let frame = Frame::new(FeedId::FILESYSTEM, json);
                            let _ = tx.send(frame);
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!(skipped = n, "filesystem feed lagged, skipping messages");
                            // Continue — the watcher is still running and we'll receive future batches
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            info!("filesystem feed broadcast closed, shutting down");
                            break;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;
    use tempfile::TempDir;
    use tokio::time::sleep;

    use crate::feeds::file_watcher::FileWatcher;

    #[test]
    fn test_feed_id_and_name() {
        let (tx, _) = broadcast::channel(256);
        let feed = FilesystemFeed::new(PathBuf::from("/tmp/test"), tx);
        assert_eq!(feed.feed_id(), FeedId::FILESYSTEM);
        assert_eq!(feed.name(), "filesystem");
    }

    /// Integration test: FilesystemFeed produces correct wire format when consuming
    /// FileWatcher broadcast.
    #[tokio::test]
    async fn test_filesystem_feed_integration() {
        let temp_dir = TempDir::new().unwrap();
        let watch_path = temp_dir.path().to_path_buf();

        // Create .gitignore file
        fs::write(watch_path.join(".gitignore"), "ignored_dir/\n").unwrap();

        // Create ignored directory
        fs::create_dir(watch_path.join("ignored_dir")).unwrap();

        // Create the broadcast channel and FileWatcher
        let (broadcast_tx, _) = broadcast::channel::<Vec<FsEvent>>(256);
        let file_watcher = FileWatcher::new(watch_path.clone());

        // Create the FilesystemFeed (subscribes to broadcast_tx)
        let feed = FilesystemFeed::new(watch_path.clone(), broadcast_tx.clone());

        // Create watch channel
        let (fs_watch_tx, mut fs_watch_rx) = watch::channel(Frame::new(FeedId::FILESYSTEM, vec![]));

        // Spawn the FileWatcher in the background
        let cancel = CancellationToken::new();
        let watcher_cancel = cancel.clone();
        let watcher_broadcast_tx = broadcast_tx.clone();
        tokio::spawn(async move {
            file_watcher.run(watcher_broadcast_tx, watcher_cancel).await;
        });

        // Spawn the FilesystemFeed in the background
        let feed_cancel = cancel.clone();
        let feed_task = tokio::spawn(async move {
            feed.run(fs_watch_tx, feed_cancel).await;
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

        // Create a file in ignored directory (should be filtered by FileWatcher)
        let ignored_file = watch_path.join("ignored_dir/secret.txt");
        fs::write(&ignored_file, "ignored").unwrap();

        // Wait for debounce and processing
        sleep(Duration::from_millis(400)).await;

        // Check for events
        fs_watch_rx.changed().await.unwrap();
        let frame = fs_watch_rx.borrow_and_update().clone();

        assert_eq!(frame.feed_id, FeedId::FILESYSTEM);

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
}
