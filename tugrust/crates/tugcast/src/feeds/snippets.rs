//! SNIPPETS feed for tugcast.
//!
//! Reads the machine-global `snippets.json` and pushes it — the whole document
//! plus its content hash — to every WebSocket client via a `watch::Sender<Frame>`,
//! republishing on every file change. Because each running build's tugcast
//! watches the same file, a write by any build (via `PUT /api/snippets`)
//! propagates to every running frontend, giving cross-build live sync for free.
//!
//! # Frame format (Spec S02)
//!
//! ```json
//! { "doc": { "version": 1, "snippets": [...] }, "hash": "<sha256 hex>", "error": null }
//! ```
//!
//! On a corrupt / unreadable file the last good document is retained and the
//! frame carries `hash: null` and a human-readable `error`.
//!
//! # Watching
//!
//! The `notify` watcher watches the file's **parent directory**, not the file
//! itself: atomic writes replace the file via `rename`, so a watch on the old
//! inode goes stale. Events are filtered to the target filename.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Config, PollWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tokio::sync::{Notify, mpsc, watch};
use tracing::{debug, warn};
use tugcast_core::{FeedId, Frame};

use crate::snippets::{ReadOutcome, SnippetsDoc, read_snippets};

/// Debounce window coalescing a burst of filesystem events into one rebuild.
const DEBOUNCE_MILLIS: u64 = 100;

/// Poll interval for the file watcher. A `PollWatcher` (rather than the OS
/// event backend) keeps cross-build sync robust across sandboxes and the
/// `/private/var` firmlink, and 250 ms is comfortably inside the ~1 s sync
/// budget. The `PUT` nudge gives the writing build instant feedback, so this
/// interval only governs how fast *other* builds see a change.
const POLL_MILLIS: u64 = 250;

/// Build a SNIPPETS frame from a read outcome, retaining the last good
/// document when the on-disk file is unreadable (`error` present).
fn frame_from_outcome(outcome: &ReadOutcome, last_good: &mut SnippetsDoc) -> Frame {
    let payload = if outcome.error.is_some() {
        json!({ "doc": &*last_good, "hash": serde_json::Value::Null, "error": outcome.error })
    } else {
        *last_good = outcome.doc.clone();
        json!({ "doc": outcome.doc, "hash": outcome.hash, "error": serde_json::Value::Null })
    };
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    Frame::new(FeedId::SNIPPETS, bytes)
}

/// Install a `notify` watcher on `path`'s parent directory that sends `()` on
/// every change touching the target filename. Returns the watcher, which the
/// caller must keep alive for events to keep flowing.
fn install_watcher(path: &Path, fs_tx: mpsc::UnboundedSender<()>) -> Option<PollWatcher> {
    let parent = path.parent()?.to_path_buf();
    let _ = std::fs::create_dir_all(&parent);
    let filename = path.file_name()?.to_os_string();

    let config = Config::default()
        .with_poll_interval(Duration::from_millis(POLL_MILLIS))
        .with_compare_contents(true);

    let mut watcher = PollWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res
                && event
                    .paths
                    .iter()
                    .any(|p| p.file_name() == Some(filename.as_os_str()))
            {
                let _ = fs_tx.send(());
            }
        },
        config,
    )
    .map_err(|e| warn!(error = %e, "snippets_feed: failed to create watcher"))
    .ok()?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(
            |e| warn!(error = %e, dir = %parent.display(), "snippets_feed: failed to watch dir"),
        )
        .ok()?;

    Some(watcher)
}

/// Start the SNIPPETS feed.
///
/// Reads `snippets.json` at `path`, sends an initial frame, and returns the
/// `watch::Receiver<Frame>` for wiring into `snapshot_watches` plus a
/// [`Notify`] the `PUT` handler pulses to force an immediate rebuild (so the
/// writer's own frontend doesn't wait on the watcher debounce).
///
/// The spawned task holds the `watch::Sender` and the notify watcher; it exits
/// when all receivers are dropped (`tx.closed()`), mirroring `defaults_feed`.
pub fn snippets_feed(path: PathBuf) -> (watch::Receiver<Frame>, Arc<Notify>) {
    let mut last_good = SnippetsDoc::empty();
    let initial = frame_from_outcome(&read_snippets(&path), &mut last_good);
    let (tx, rx) = watch::channel(initial);
    let nudge = Arc::new(Notify::new());

    let task_nudge = Arc::clone(&nudge);
    tokio::spawn(async move {
        let (fs_tx, mut fs_rx) = mpsc::unbounded_channel::<()>();
        // Held for the task's lifetime so the OS watch stays registered.
        let _watcher = install_watcher(&path, fs_tx);

        loop {
            tokio::select! {
                _ = tx.closed() => {
                    debug!("snippets_feed: all receivers dropped, task exiting");
                    break;
                }
                _ = task_nudge.notified() => {}
                recv = fs_rx.recv() => {
                    if recv.is_none() {
                        // Watcher gone (install failed or dropped): stop reacting
                        // to fs events but keep serving PUT-driven rebuilds.
                        std::future::pending::<()>().await;
                    }
                    // Coalesce a burst of rename/create/modify events.
                    tokio::time::sleep(Duration::from_millis(DEBOUNCE_MILLIS)).await;
                    while fs_rx.try_recv().is_ok() {}
                }
            }

            let frame = frame_from_outcome(&read_snippets(&path), &mut last_good);
            if tx.send(frame).is_err() {
                break;
            }
        }
    });

    (rx, nudge)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snippets::{Snippet, write_snippets_atomic};

    fn parse_frame(frame: &Frame) -> serde_json::Value {
        assert_eq!(frame.feed_id, FeedId::SNIPPETS);
        serde_json::from_slice(&frame.payload).expect("frame payload is JSON")
    }

    fn sample_doc() -> SnippetsDoc {
        SnippetsDoc {
            version: 1,
            snippets: vec![Snippet {
                id: "sn_a".into(),
                text: "body".into(),
            }],
        }
    }

    #[tokio::test]
    async fn initial_frame_reflects_existing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        write_snippets_atomic(&path, &sample_doc()).unwrap();

        let (rx, _nudge) = snippets_feed(path);
        let frame = rx.borrow();
        let json = parse_frame(&frame);
        assert_eq!(json["doc"]["snippets"][0]["id"], "sn_a");
        assert!(json["hash"].is_string());
        assert!(json["error"].is_null());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn external_write_triggers_new_frame() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");

        let (mut rx, _nudge) = snippets_feed(path.clone());
        // Initial frame is the empty document.
        assert!(parse_frame(&rx.borrow_and_update())["error"].is_null());

        // Let the feed task start and the PollWatcher establish its baseline on
        // the (empty) directory before we write — otherwise the write lands in
        // the baseline and no change is ever observed.
        tokio::time::sleep(Duration::from_millis(POLL_MILLIS * 3)).await;

        // An external writer replaces the file.
        write_snippets_atomic(&path, &sample_doc()).unwrap();

        // The watcher fires; wait for the next frame (bounded).
        tokio::time::timeout(Duration::from_secs(10), rx.changed())
            .await
            .expect("frame within timeout")
            .expect("sender alive");
        let json = parse_frame(&rx.borrow());
        assert_eq!(json["doc"]["snippets"][0]["id"], "sn_a");
    }

    #[tokio::test]
    async fn nudge_forces_rebuild() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");

        let (mut rx, nudge) = snippets_feed(path.clone());
        rx.borrow_and_update();

        // Write, then pulse the nudge — the rebuild should not depend on the
        // filesystem watcher's debounce.
        write_snippets_atomic(&path, &sample_doc()).unwrap();
        nudge.notify_one();

        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("frame within timeout")
            .expect("sender alive");
        let json = parse_frame(&rx.borrow());
        assert_eq!(json["doc"]["snippets"][0]["id"], "sn_a");
    }

    #[tokio::test]
    async fn corrupt_file_retains_last_good_doc() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        write_snippets_atomic(&path, &sample_doc()).unwrap();

        let (mut rx, nudge) = snippets_feed(path.clone());
        rx.borrow_and_update();

        // Corrupt the file, then force a rebuild.
        std::fs::write(&path, b"{ not json").unwrap();
        nudge.notify_one();

        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("frame within timeout")
            .expect("sender alive");
        let json = parse_frame(&rx.borrow());
        // Last good doc retained; error set; hash null.
        assert_eq!(json["doc"]["snippets"][0]["id"], "sn_a");
        assert!(json["error"].is_string());
        assert!(json["hash"].is_null());
    }
}
