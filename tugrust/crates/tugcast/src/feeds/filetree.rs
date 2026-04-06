//! FileTreeFeed — query/response file completion feed.
//!
//! Maintains a `BTreeSet<String>` of relative file paths from the project tree.
//! Receives queries via mpsc, scores them with the fuzzy scorer, and responds
//! with top-N scored results via a watch channel.
//!
//! This is a custom async task, NOT a `SnapshotFeed` implementor — the trait
//! can't express the dual-input nature of query + file events.


use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use tokio::sync::{broadcast, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use tugcast_core::types::{FsEvent, ScoredResult};
use tugcast_core::{FeedId, FileTreeSnapshot, Frame};

use super::file_watcher::FileWatcher;
use super::fuzzy_scorer::score_file_path;

/// Maximum number of results returned per query.
const MAX_RESULTS: usize = 8;

/// Parsed query from FILETREE_QUERY payload.
#[derive(Debug, Clone)]
pub struct FileTreeQuery {
    pub query: String,
    pub root: Option<PathBuf>,
}

/// File tree feed that maintains an index and responds to scored queries.
pub struct FileTreeFeed {
    /// The original root (for watcher_aligned checks).
    original_root: PathBuf,
    /// The current indexed root.
    current_root: PathBuf,
    /// The file index.
    files: BTreeSet<String>,
    /// Whether the file index exceeded the cap.
    truncated: bool,
    /// True when current_root matches original_root (safe to apply FileWatcher events).
    watcher_aligned: bool,
    /// Broadcast sender to subscribe for FileWatcher events.
    event_tx: broadcast::Sender<Vec<FsEvent>>,
    /// Receives queries from the router.
    query_rx: mpsc::Receiver<FileTreeQuery>,
}

impl FileTreeFeed {
    pub fn new(
        root: PathBuf,
        initial_files: BTreeSet<String>,
        truncated: bool,
        event_tx: broadcast::Sender<Vec<FsEvent>>,
        query_rx: mpsc::Receiver<FileTreeQuery>,
    ) -> Self {
        Self {
            original_root: root.clone(),
            current_root: root,
            files: initial_files,
            truncated,
            watcher_aligned: true,
            event_tx,
            query_rx,
        }
    }

    /// Run the feed loop. Custom async task — not SnapshotFeed.
    pub async fn run(mut self, watch_tx: watch::Sender<Frame>, cancel: CancellationToken) {
        let mut event_rx = self.event_tx.subscribe();

        // Send empty initial response.
        let initial = FileTreeSnapshot {
            query: String::new(),
            results: vec![],
            truncated: self.truncated,
        };
        let _ = Self::send_response(&watch_tx, &initial);

        loop {
            tokio::select! {
                biased;

                _ = cancel.cancelled() => {
                    debug!("FileTreeFeed: cancelled");
                    break;
                }

                // FileWatcher events — only when aligned.
                result = event_rx.recv(), if self.watcher_aligned => {
                    match result {
                        Ok(events) => self.apply_events(&events),
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!("FileTreeFeed: lagged by {n} batches, index may be stale");
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            debug!("FileTreeFeed: broadcast closed");
                            break;
                        }
                    }
                }

                // Query input.
                Some(query) = self.query_rx.recv() => {
                    let response = self.handle_query(&query);
                    let _ = Self::send_response(&watch_tx, &response);
                }
            }
        }
    }

    /// Apply filesystem events to the BTreeSet.
    fn apply_events(&mut self, events: &[FsEvent]) {
        for event in events {
            match event {
                FsEvent::Created { path } => {
                    self.files.insert(path.clone());
                }
                FsEvent::Removed { path } => {
                    self.files.remove(path);
                }
                FsEvent::Renamed { from, to } => {
                    self.files.remove(from);
                    self.files.insert(to.clone());
                }
                FsEvent::Modified { .. } => {
                    // File saves don't change the file list.
                }
            }
        }
    }

    /// Handle a query and produce a response.
    fn handle_query(&mut self, ftq: &FileTreeQuery) -> FileTreeSnapshot {
        // Retarget if requested [D09].
        if let Some(ref new_root) = ftq.root {
            if *new_root != self.current_root {
                self.retarget(new_root);
            }
        }

        let query = &ftq.query;

        // Off-board completion [D10]: absolute paths bypass the index.
        if query.starts_with('/') || query.starts_with('~') {
            return self.off_board_query(query);
        }

        // Empty query: root-level files alphabetically.
        if query.is_empty() {
            return self.empty_query();
        }

        // Normal query: pre-filter + fuzzy score.
        self.scored_query(query)
    }

    /// Retarget to a new root directory [D09].
    fn retarget(&mut self, new_root: &Path) {
        let watcher = FileWatcher::new(new_root.to_path_buf());
        let (files, truncated) = watcher.walk();
        self.files = files;
        self.truncated = truncated;
        self.current_root = new_root.to_path_buf();
        self.watcher_aligned = self.current_root == self.original_root;
        debug!(
            "FileTreeFeed: retargeted to {:?} ({} files, aligned={})",
            self.current_root,
            self.files.len(),
            self.watcher_aligned,
        );
    }

    /// Off-board completion: readdir + prefix match [D10].
    fn off_board_query(&self, query: &str) -> FileTreeSnapshot {
        let expanded = if query.starts_with('~') {
            if let Ok(home) = std::env::var("HOME") {
                format!("{}{}", home, &query[1..])
            } else {
                query.to_string()
            }
        } else {
            query.to_string()
        };

        let (parent_dir, name_prefix) = match expanded.rfind('/') {
            Some(i) => {
                let dir = if i == 0 { "/" } else { &expanded[..i] };
                let prefix = &expanded[i + 1..];
                (dir.to_string(), prefix.to_lowercase())
            }
            None => {
                return FileTreeSnapshot {
                    query: query.to_string(),
                    results: vec![],
                    truncated: self.truncated,
                };
            }
        };

        let mut entries: Vec<String> = Vec::new();
        if let Ok(read_dir) = std::fs::read_dir(&parent_dir) {
            for entry in read_dir.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if name_prefix.is_empty() || name.to_lowercase().starts_with(&name_prefix) {
                        let full_path = if parent_dir == "/" {
                            format!("/{name}")
                        } else {
                            format!("{parent_dir}/{name}")
                        };
                        entries.push(full_path);
                    }
                }
            }
        }

        entries.sort();
        entries.truncate(MAX_RESULTS);

        FileTreeSnapshot {
            query: query.to_string(),
            results: entries
                .into_iter()
                .map(|path| ScoredResult {
                    path,
                    score: 0,
                    matches: vec![],
                })
                .collect(),
            truncated: self.truncated,
        }
    }

    /// Empty query: return root-level files (no `/` in path).
    fn empty_query(&self) -> FileTreeSnapshot {
        let results: Vec<ScoredResult> = self
            .files
            .iter()
            .filter(|p| !p.contains('/'))
            .take(MAX_RESULTS)
            .map(|p| ScoredResult {
                path: p.clone(),
                score: 0,
                matches: vec![],
            })
            .collect();

        FileTreeSnapshot {
            query: String::new(),
            results,
            truncated: self.truncated,
        }
    }

    /// Normal scored query: pre-filter + fuzzy score + top N.
    fn scored_query(&self, query: &str) -> FileTreeSnapshot {
        let mut scored: Vec<ScoredResult> = self
            .files
            .iter()
            .filter_map(|path| {
                let m = score_file_path(query, path)?;
                Some(ScoredResult {
                    path: path.clone(),
                    score: m.score,
                    matches: m.matches,
                })
            })
            .collect();

        // Sort by descending score, then ascending path length, then lexicographic.
        scored.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.path.len().cmp(&b.path.len()))
                .then_with(|| a.path.cmp(&b.path))
        });
        scored.truncate(MAX_RESULTS);

        FileTreeSnapshot {
            query: query.to_string(),
            results: scored,
            truncated: self.truncated,
        }
    }

    /// Serialize and send a response frame.
    fn send_response(
        watch_tx: &watch::Sender<Frame>,
        snapshot: &FileTreeSnapshot,
    ) -> Result<(), ()> {
        let json = serde_json::to_vec(snapshot).map_err(|_| ())?;
        watch_tx.send_modify(|frame| {
            *frame = Frame::new(FeedId::FILETREE, json.clone());
        });
        Ok(())
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_files(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|s| s.to_string()).collect()
    }

    // -----------------------------------------------------------------------
    // BTreeSet event handling
    // -----------------------------------------------------------------------

    #[test]
    fn apply_created_inserts() {
        let mut feed = test_feed(make_files(&["a.rs"]));
        feed.apply_events(&[FsEvent::Created {
            path: "b.rs".to_string(),
        }]);
        assert!(feed.files.contains("b.rs"));
    }

    #[test]
    fn apply_removed_deletes() {
        let mut feed = test_feed(make_files(&["a.rs", "b.rs"]));
        feed.apply_events(&[FsEvent::Removed {
            path: "a.rs".to_string(),
        }]);
        assert!(!feed.files.contains("a.rs"));
        assert!(feed.files.contains("b.rs"));
    }

    #[test]
    fn apply_renamed_swaps() {
        let mut feed = test_feed(make_files(&["old.rs"]));
        feed.apply_events(&[FsEvent::Renamed {
            from: "old.rs".to_string(),
            to: "new.rs".to_string(),
        }]);
        assert!(!feed.files.contains("old.rs"));
        assert!(feed.files.contains("new.rs"));
    }

    #[test]
    fn apply_modified_ignored() {
        let mut feed = test_feed(make_files(&["a.rs"]));
        feed.apply_events(&[FsEvent::Modified {
            path: "a.rs".to_string(),
        }]);
        assert_eq!(feed.files.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Scored query
    // -----------------------------------------------------------------------

    #[test]
    fn scored_query_returns_ranked_results() {
        let files = make_files(&[
            "src/lib/session-metadata-store.ts",
            "src/lib/shell-metadata-store.ts",
            "src/components/button.tsx",
        ]);
        let feed = test_feed(files);
        let response = feed.scored_query("sms");
        assert!(!response.results.is_empty());
        assert_eq!(response.query, "sms");
        // Results should be sorted by descending score.
        for w in response.results.windows(2) {
            assert!(w[0].score >= w[1].score);
        }
    }

    #[test]
    fn scored_query_returns_max_8() {
        let files: BTreeSet<String> = (0..20)
            .map(|i| format!("file_{i:02}.txt"))
            .collect();
        let feed = test_feed(files);
        let response = feed.scored_query("file");
        assert!(response.results.len() <= MAX_RESULTS);
    }

    #[test]
    fn scored_query_nonmatch_returns_empty() {
        let feed = test_feed(make_files(&["model.ts"]));
        let response = feed.scored_query("xyz");
        assert!(response.results.is_empty());
    }

    #[test]
    fn scored_query_has_match_positions() {
        let feed = test_feed(make_files(&["session-metadata-store.ts"]));
        let response = feed.scored_query("sms");
        assert!(!response.results.is_empty());
        assert!(!response.results[0].matches.is_empty());
    }

    // -----------------------------------------------------------------------
    // Empty query
    // -----------------------------------------------------------------------

    #[test]
    fn empty_query_returns_root_level_only() {
        let files = make_files(&[
            "Cargo.toml",
            "README.md",
            "src/main.rs",
            "src/lib.rs",
            ".gitignore",
        ]);
        let feed = test_feed(files);
        let response = feed.empty_query();
        // Only root-level files (no `/`).
        for r in &response.results {
            assert!(!r.path.contains('/'), "path should be root-level: {}", r.path);
        }
        assert_eq!(response.results.len(), 3); // Cargo.toml, README.md, .gitignore
    }

    #[test]
    fn empty_query_alphabetical() {
        let files = make_files(&["z.txt", "a.txt", "m.txt"]);
        let feed = test_feed(files);
        let response = feed.empty_query();
        let paths: Vec<&str> = response.results.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(paths, vec!["a.txt", "m.txt", "z.txt"]);
    }

    #[test]
    fn empty_query_max_8() {
        let files: BTreeSet<String> = (0..20)
            .map(|i| format!("file_{i:02}.txt"))
            .collect();
        let feed = test_feed(files);
        let response = feed.empty_query();
        assert!(response.results.len() <= MAX_RESULTS);
    }

    // -----------------------------------------------------------------------
    // Off-board query [D10]
    // -----------------------------------------------------------------------

    #[test]
    fn off_board_with_nonexistent_parent_returns_empty() {
        let feed = test_feed(BTreeSet::new());
        let response = feed.off_board_query("/nonexistent_dir_xyz_123/te");
        assert!(response.results.is_empty());
        assert_eq!(response.query, "/nonexistent_dir_xyz_123/te");
    }

    #[test]
    fn off_board_paths_are_absolute() {
        let feed = test_feed(BTreeSet::new());
        // /tmp should exist on macOS/Linux.
        let response = feed.off_board_query("/tmp/");
        for r in &response.results {
            assert!(r.path.starts_with('/'), "off-board path should be absolute: {}", r.path);
            assert_eq!(r.score, 0);
            assert!(r.matches.is_empty());
        }
    }

    #[test]
    fn off_board_prefix_filters() {
        // Create a temp dir with known contents.
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("test_alpha.txt"), "").unwrap();
        std::fs::write(tmp.path().join("test_beta.txt"), "").unwrap();
        std::fs::write(tmp.path().join("other.txt"), "").unwrap();

        let feed = test_feed(BTreeSet::new());
        let query = format!("{}/test_", tmp.path().display());
        let response = feed.off_board_query(&query);
        assert_eq!(response.results.len(), 2);
        for r in &response.results {
            assert!(r.path.contains("test_"));
        }
    }

    #[test]
    fn off_board_tilde_expansion() {
        let feed = test_feed(BTreeSet::new());
        let response = feed.off_board_query("~/");
        // Should expand ~ to $HOME and list entries.
        // We can't assert specific contents, but it shouldn't panic.
        assert_eq!(response.query, "~/");
    }

    // -----------------------------------------------------------------------
    // Retarget [D09]
    // -----------------------------------------------------------------------

    #[test]
    fn retarget_replaces_index() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("new_file.txt"), "").unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();

        let mut feed = test_feed(make_files(&["old_file.rs"]));
        assert!(feed.files.contains("old_file.rs"));

        feed.retarget(tmp.path());
        assert!(!feed.files.contains("old_file.rs"));
        assert!(feed.files.contains("new_file.txt"));
        assert_eq!(feed.current_root, tmp.path());
        assert!(!feed.watcher_aligned);
    }

    #[test]
    fn retarget_back_to_original_restores_alignment() {
        let original = tempfile::tempdir().unwrap();
        std::fs::write(original.path().join("orig.txt"), "").unwrap();
        std::fs::create_dir_all(original.path().join(".git")).unwrap();

        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("other.txt"), "").unwrap();
        std::fs::create_dir_all(other.path().join(".git")).unwrap();

        let (tx, _) = broadcast::channel(16);
        let (_qtx, qrx) = mpsc::channel(16);
        let watcher = FileWatcher::new(original.path().to_path_buf());
        let (files, truncated) = watcher.walk();

        let mut feed = FileTreeFeed::new(
            original.path().to_path_buf(),
            files,
            truncated,
            tx,
            qrx,
        );
        assert!(feed.watcher_aligned);

        feed.retarget(other.path());
        assert!(!feed.watcher_aligned);

        feed.retarget(original.path());
        assert!(feed.watcher_aligned);
    }

    // -----------------------------------------------------------------------
    // handle_query dispatch
    // -----------------------------------------------------------------------

    #[test]
    fn handle_query_dispatches_correctly() {
        let files = make_files(&["model.ts", "src/lib.rs"]);
        let mut feed = test_feed(files);

        // Normal query.
        let r = feed.handle_query(&FileTreeQuery {
            query: "model".to_string(),
            root: None,
        });
        assert!(!r.results.is_empty());

        // Empty query.
        let r = feed.handle_query(&FileTreeQuery {
            query: String::new(),
            root: None,
        });
        assert_eq!(r.query, "");
        // Should only return root-level.
        for result in &r.results {
            assert!(!result.path.contains('/'));
        }

        // Off-board query.
        let r = feed.handle_query(&FileTreeQuery {
            query: "/nonexistent_xyz/".to_string(),
            root: None,
        });
        assert!(r.results.is_empty());
    }

    // -----------------------------------------------------------------------
    // Response serialization
    // -----------------------------------------------------------------------

    #[test]
    fn response_serializes_to_spec_s01b() {
        let snapshot = FileTreeSnapshot {
            query: "sms".to_string(),
            results: vec![ScoredResult {
                path: "src/lib/session-metadata-store.ts".to_string(),
                score: 72,
                matches: vec![(0, 1), (8, 9), (17, 18)],
            }],
            truncated: false,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["query"], "sms");
        assert!(json["results"].is_array());
        assert_eq!(json["results"][0]["path"], "src/lib/session-metadata-store.ts");
        assert_eq!(json["results"][0]["score"], 72);
        assert_eq!(json["truncated"], false);
    }

    // -----------------------------------------------------------------------
    // Test helper
    // -----------------------------------------------------------------------

    fn test_feed(files: BTreeSet<String>) -> FileTreeFeed {
        let (tx, _) = broadcast::channel(16);
        let (_qtx, qrx) = mpsc::channel(16);
        FileTreeFeed::new(PathBuf::from("/test"), files, false, tx, qrx)
    }
}
