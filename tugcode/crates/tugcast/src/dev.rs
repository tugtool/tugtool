//! Dev mode: file watcher, Vite dist/-based serving, and dev asset serving

use arc_swap::ArcSwap;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tracing::{info, warn};
use tugcast_core::{FeedId, Frame};

/// Dev mode state: resolved paths for Vite dist/ serving
#[derive(Clone, Debug)]
pub(crate) struct DevState {
    /// Absolute path to the Vite dist/ directory (e.g. `.../tugdeck/dist`)
    pub dist_dir: PathBuf,
    /// Absolute path to dist/index.html
    pub index_path: PathBuf,
    /// Absolute path to the source tree root (parent of tugdeck/)
    pub source_tree: PathBuf,
}

/// Shared dev state type for lock-free runtime swapping
pub(crate) type SharedDevState = Arc<ArcSwap<Option<DevState>>>;

/// Tracks file change state across three watcher categories.
///
/// Per-category dirty flags indicate which categories have pending changes.
/// `code_count` is a single combined counter for code (frontend + backend),
/// incremented by both `mark_frontend()` and `mark_backend()`.
/// `app_count` is a separate counter for app (app sources).
#[derive(Debug, Default)]
pub(crate) struct DevChangeTracker {
    pub frontend_dirty: bool,
    pub backend_dirty: bool,
    pub app_dirty: bool,
    pub code_count: u32,
    pub app_count: u32,
}

/// Shared change tracker type for thread-safe access from watcher tasks
pub(crate) type SharedChangeTracker = Arc<std::sync::Mutex<DevChangeTracker>>;

impl DevChangeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark a frontend (compiled JS) change. Increments the shared code_count.
    pub fn mark_frontend(&mut self) {
        self.frontend_dirty = true;
        self.code_count += 1;
    }

    /// Mark a backend (tugcast binary) change. Increments the shared code_count.
    pub fn mark_backend(&mut self) {
        self.backend_dirty = true;
        self.code_count += 1;
    }

    /// Mark an app source (.swift) change.
    pub fn mark_app(&mut self) {
        self.app_dirty = true;
        self.app_count += 1;
    }

    /// Take a snapshot of the current dirty state for notification payloads.
    /// Returns (changes_vec, code_count, app_count).
    pub fn snapshot(&self) -> (Vec<&'static str>, u32, u32) {
        let mut changes = Vec::new();
        if self.frontend_dirty {
            changes.push("frontend");
        }
        if self.backend_dirty {
            changes.push("backend");
        }
        if self.app_dirty {
            changes.push("app");
        }
        (changes, self.code_count, self.app_count)
    }

    /// Clear styles+code state after a restart operation.
    /// Preserves app state.
    #[allow(dead_code)]
    pub fn clear_restart(&mut self) {
        self.frontend_dirty = false;
        self.backend_dirty = false;
        self.code_count = 0;
    }

    /// Clear all state after a relaunch or full reset.
    #[allow(dead_code)]
    pub fn clear_all(&mut self) {
        self.frontend_dirty = false;
        self.backend_dirty = false;
        self.app_dirty = false;
        self.code_count = 0;
        self.app_count = 0;
    }
}

/// Dev runtime: holds file watcher and change tracker for RAII cleanup
pub(crate) struct DevRuntime {
    pub(crate) _watcher: RecommendedWatcher,
    pub(crate) _compiled_watcher: tokio::task::JoinHandle<()>,
    pub(crate) _app_watcher: RecommendedWatcher,
    #[allow(dead_code)]
    pub(crate) change_tracker: SharedChangeTracker,
}

/// Create a new shared dev state initialized to None
pub(crate) fn new_shared_dev_state() -> SharedDevState {
    Arc::new(ArcSwap::from_pointee(None))
}

/// Enable dev mode: load dev state, start file watcher, populate shared state
pub(crate) async fn enable_dev_mode(
    source_tree: PathBuf,
    shared_state: &SharedDevState,
    client_action_tx: broadcast::Sender<Frame>,
) -> Result<DevRuntime, String> {
    // Resolve symlinks without canonicalize(), which on macOS resolves through
    // the /Users firmlink to /System/Volumes/Data/Users — a path FSEvents ignores.
    let source_tree = resolve_symlinks(&source_tree).map_err(|e| {
        format!(
            "failed to resolve source_tree {}: {}",
            source_tree.display(),
            e
        )
    })?;

    // Load dev state via spawn_blocking (blocking filesystem I/O)
    let source = source_tree.clone();
    let state = tokio::task::spawn_blocking(move || load_dev_state(&source))
        .await
        .map_err(|e| format!("dev state load task panicked: {}", e))??;

    // Validate dev state (logs warnings)
    validate_dev_state(&state);

    // Derive watch directories
    let watch_dirs = watch_dirs(&state);

    // Create change tracker
    let change_tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));

    // Create styles watcher: HTML/CSS file watcher for live reload
    let watcher = dev_file_watcher(
        &watch_dirs,
        client_action_tx.clone(),
        shared_state.clone(),
        change_tracker.clone(),
    )?;

    // Create code watcher: compiled code (frontend + backend) mtime poller.
    // Vite always produces dist/index.html with stable naming; JS/CSS assets
    // have content-hashed filenames (e.g. assets/index-abc123.js). Polling
    // dist/index.html detects any rebuild that updates the entry point.
    let frontend_path = source_tree.join("tugdeck/dist/index.html");
    let backend_path = source_tree.join("tugcode/target/debug/tugcast");
    let compiled_watcher = dev_compiled_watcher(
        frontend_path,
        backend_path,
        change_tracker.clone(),
        client_action_tx.clone(),
    );

    // Create app watcher: app sources (.swift files) notify watcher
    let app_sources_dir = source_tree.join("tugapp/Sources");
    let app_watcher = dev_app_watcher(app_sources_dir, change_tracker.clone(), client_action_tx)?;

    // Store loaded DevState into shared state
    shared_state.store(Arc::new(Some(state)));

    info!(source_tree = ?source_tree, "dev mode enabled");

    Ok(DevRuntime {
        _watcher: watcher,
        _compiled_watcher: compiled_watcher,
        _app_watcher: app_watcher,
        change_tracker,
    })
}

/// Disable dev mode: clear shared state, drop file watchers
pub(crate) fn disable_dev_mode(runtime: DevRuntime, shared_state: &SharedDevState) {
    // Clear shared state
    shared_state.store(Arc::new(None));

    // Abort the compiled watcher polling task (drop alone does not abort spawned tokio tasks)
    runtime._compiled_watcher.abort();

    // Drop runtime (stops file watchers for styles and app)
    drop(runtime);

    info!("dev mode disabled");
}

/// Load dev state from source tree: verify dist/index.html exists
pub(crate) fn load_dev_state(source_tree: &Path) -> Result<DevState, String> {
    let dist_dir = source_tree.join("tugdeck/dist");
    let index_path = dist_dir.join("index.html");

    if !index_path.exists() {
        return Err(format!(
            "tugdeck/dist/index.html not found at {}; run `bun run build` first",
            index_path.display()
        ));
    }

    Ok(DevState {
        dist_dir,
        index_path,
        source_tree: source_tree.to_path_buf(),
    })
}

/// Validate dev state at startup: warn about missing dist directory or index.html
pub(crate) fn validate_dev_state(state: &DevState) {
    if !state.dist_dir.exists() {
        warn!(
            "dev state dist_dir {} does not exist",
            state.dist_dir.display()
        );
    }

    if !state.index_path.exists() {
        warn!(
            "dev state index_path {} does not exist",
            state.index_path.display()
        );
    }
}

/// Derive watch directories: [dist_dir, source_tree/tugdeck/src]
pub(crate) fn watch_dirs(state: &DevState) -> Vec<PathBuf> {
    vec![
        state.dist_dir.clone(),
        state.source_tree.join("tugdeck/src"),
    ]
}

/// Serve dev asset: single-directory lookup against dist_dir with path safety
pub(crate) async fn serve_dev_asset(uri: Uri, dev_state: &DevState) -> Response {
    // Path safety: decode percent-encoding and normalize
    let raw_path = uri.path();
    let decoded = match percent_encoding::percent_decode_str(raw_path).decode_utf8() {
        Ok(s) => s,
        Err(e) => {
            warn!("Invalid UTF-8 in path {}: {}", raw_path, e);
            return (StatusCode::NOT_FOUND, "Invalid UTF-8 in path").into_response();
        }
    };

    // Trim leading '/' and normalize by resolving . and .. segments
    let trimmed = decoded.trim_start_matches('/');
    let mut components = Vec::new();
    for part in trimmed.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                if components.is_empty() {
                    // Attempted to escape root
                    return (StatusCode::NOT_FOUND, "Path traversal not allowed").into_response();
                }
                components.pop();
            }
            _ => components.push(part),
        }
    }
    let lookup_key = components.join("/");

    // Special case: serve index.html for root or /index.html
    if lookup_key.is_empty() || lookup_key == "index.html" {
        return serve_dev_index_impl(dev_state).await;
    }

    // Single-directory lookup: resolve path under dist_dir
    let candidate = dev_state.dist_dir.join(&lookup_key);
    serve_file_with_safety(&candidate, dev_state).await
}

/// Serve a file with path safety verification
async fn serve_file_with_safety(candidate: &Path, dev_state: &DevState) -> Response {
    // Canonicalize using parent-directory strategy: canonicalize parent, then append filename
    let parent = match candidate.parent() {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Invalid path").into_response(),
    };

    let canonical_parent = match parent.canonicalize() {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "Not found").into_response(),
    };

    let filename = match candidate.file_name() {
        Some(f) => f,
        None => return (StatusCode::NOT_FOUND, "Not found").into_response(),
    };

    let canonical_path = canonical_parent.join(filename);

    // Verify the path starts with the canonical dist_dir root
    let mut allowed = false;

    if let Ok(canonical_dist) = dev_state.dist_dir.canonicalize() {
        if canonical_path.starts_with(&canonical_dist) {
            allowed = true;
        }
    }

    // Fallback: if dist_dir doesn't exist or canonicalization failed,
    // check if the original candidate path starts with dist_dir
    if !allowed && candidate.starts_with(&dev_state.dist_dir) {
        allowed = true;
    }

    if !allowed {
        return (StatusCode::NOT_FOUND, "Path outside allowed roots").into_response();
    }

    // Read and serve the file
    match tokio::fs::read(&canonical_path).await {
        Ok(content) => {
            let content_type =
                crate::server::content_type_for(canonical_path.to_str().unwrap_or(""));
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                content,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

/// Serve index.html (public handler for / and /index.html routes)
pub(crate) async fn serve_dev_index(dev_state: &DevState) -> Response {
    serve_dev_index_impl(dev_state).await
}

/// Internal implementation of index serving
async fn serve_dev_index_impl(dev_state: &DevState) -> Response {
    match std::fs::read(&dev_state.index_path) {
        Ok(content) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            content,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

/// Resolve symlinks in a path, producing a path FSEvents can watch.
///
/// On macOS, `canonicalize()` resolves through the `/Users` firmlink to
/// `/System/Volumes/Data/Users`, producing paths that FSEvents ignores.
/// This function resolves symlinks and then normalizes the firmlink
/// prefix back to `/Users/` so FSEvents works correctly.
pub(crate) fn resolve_symlinks(path: &Path) -> std::io::Result<PathBuf> {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        resolved.push(component);
        if resolved.symlink_metadata()?.file_type().is_symlink() {
            let target = std::fs::read_link(&resolved)?;
            if target.is_absolute() {
                resolved = target;
            } else {
                resolved.pop();
                resolved.push(target);
            }
        }
    }

    // macOS firmlink normalization: FSEvents expects /Users/..., not
    // /System/Volumes/Data/Users/... which canonicalize/read_link may produce.
    #[cfg(target_os = "macos")]
    {
        const FIRMLINK_PREFIX: &str = "/System/Volumes/Data/Users/";
        if let Some(path_str) = resolved.to_str() {
            if let Some(suffix) = path_str.strip_prefix(FIRMLINK_PREFIX) {
                resolved = PathBuf::from(format!("/Users/{}", suffix));
            }
        }
    }

    Ok(resolved)
}

/// Shorten a path by reversing macOS `/etc/synthetic.conf` firmlinks.
///
/// On macOS, synthetic.conf maps short names to real paths, e.g.:
///   `u\t/Users/kocienda/Mounts/u`
/// This function reverses that mapping for display: given
/// `/Users/kocienda/Mounts/u/src/tugtool`, it returns `/u/src/tugtool`.
///
/// On non-macOS platforms, returns the path unchanged.
pub(crate) fn shorten_synthetic_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Ok(contents) = std::fs::read_to_string("/etc/synthetic.conf") {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                // Format: name<TAB>target
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    let name = parts[0].trim();
                    let raw_target = parts[1].trim();
                    // Normalize the target through resolve_symlinks so it matches
                    // the same form as the input path
                    let target = resolve_symlinks(Path::new(raw_target))
                        .unwrap_or_else(|_| PathBuf::from(raw_target));
                    if let Some(suffix) = path
                        .to_str()
                        .and_then(|p| p.strip_prefix(target.to_str().unwrap_or("")))
                    {
                        return PathBuf::from(format!("/{}{}", name, suffix));
                    }
                }
            }
        }
    }
    path.to_path_buf()
}

/// Build and send a dev_notification Control frame.
///
/// For `"reloaded"` type: sends `{"action":"dev_notification","type":"reloaded","timestamp":...}`
/// For `"restart_available"` type: includes `changes` array, `count`, and `timestamp` from tracker snapshot
/// For `"relaunch_available"` type: includes `changes` array, `count`, and `timestamp` from tracker snapshot
pub(crate) fn send_dev_notification(
    notification_type: &str,
    tracker: &SharedChangeTracker,
    client_action_tx: &broadcast::Sender<Frame>,
) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let payload = if notification_type == "reloaded" {
        // styles: no changes array or count
        let json = serde_json::json!({
            "action": "dev_notification",
            "type": "reloaded",
            "timestamp": timestamp,
        });
        serde_json::to_vec(&json).unwrap_or_default()
    } else {
        // code or app: include changes and count from tracker snapshot
        let guard = tracker.lock().unwrap();
        let (changes, code_count, app_count) = guard.snapshot();
        let count = if notification_type == "restart_available" {
            code_count
        } else {
            app_count
        };
        // Build JSON using serde_json for safety
        let json = serde_json::json!({
            "action": "dev_notification",
            "type": notification_type,
            "changes": changes,
            "count": count,
            "timestamp": timestamp,
        });
        serde_json::to_vec(&json).unwrap_or_default()
    };

    let frame = Frame::new(FeedId::Control, payload);
    let _ = client_action_tx.send(frame);
}

/// Read mtime for a file path. Returns None if file does not exist or is unreadable.
fn read_mtime(path: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Check if mtime has changed and stabilize. Returns Some(new_mtime) if change confirmed.
async fn check_and_stabilize(
    path: &Path,
    last_mtime: &Option<std::time::SystemTime>,
) -> Option<std::time::SystemTime> {
    let current_mtime = read_mtime(path);

    // No change if mtime is the same
    if current_mtime == *last_mtime {
        return None;
    }

    // Mtime changed (or file appeared/disappeared). Enter stabilization.
    let mut stabilizing_mtime = current_mtime;
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let new_mtime = read_mtime(path);

        // If mtime changed during stabilization, restart the wait
        if new_mtime != stabilizing_mtime {
            stabilizing_mtime = new_mtime;
            continue;
        }

        // Mtime stable for 500ms
        // Return the stabilized mtime if it's different from the last known value
        if new_mtime != *last_mtime {
            return new_mtime;
        } else {
            // Stabilized back to the original value (should not happen, but handle it)
            return None;
        }
    }
}

/// Check whether a notify event contains paths with reload-worthy extensions
fn has_reload_extension(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| {
        p.extension()
            .is_some_and(|ext| ext == "html" || ext == "css")
    })
}

/// Check whether a notify event contains paths with .swift extension
fn has_swift_extension(event: &notify::Event) -> bool {
    event
        .paths
        .iter()
        .any(|p| p.extension().is_some_and(|ext| ext == "swift"))
}

/// Start file watcher for dev mode live reload
///
/// Uses a quiet-period debounce: after the first qualifying file event,
/// keeps consuming events until 100ms of silence, then fires a single
/// reload signal. No polling, no fixed delays.
pub(crate) fn dev_file_watcher(
    watch_dirs: &[PathBuf],
    client_action_tx: broadcast::Sender<Frame>,
    shared_state: SharedDevState,
    tracker: SharedChangeTracker,
) -> Result<RecommendedWatcher, String> {
    // Bridge notify's sync callback into the tokio world.
    // UnboundedSender::send() is non-async, safe to call from notify's thread.
    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();

    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let _ = event_tx.send(res);
        })
        .map_err(|e| format!("failed to create dev file watcher: {}", e))?;

    for dir in watch_dirs {
        if dir.exists() {
            watcher
                .watch(dir, RecursiveMode::Recursive)
                .map_err(|e| format!("failed to watch {}: {}", dir.display(), e))?;
            info!("dev: watching {}", dir.display());
        } else {
            warn!(
                "dev: watch directory {} does not exist, skipping",
                dir.display()
            );
        }
    }

    // Quiet-period debounce task with dev state gating
    let debounce_state = shared_state;
    let debounce_tracker = tracker;
    tokio::spawn(async move {
        let quiet_period = Duration::from_millis(100);
        loop {
            // Phase 1: Wait (suspended, zero CPU) for a qualifying event
            loop {
                match event_rx.recv().await {
                    Some(Ok(event)) if has_reload_extension(&event) => break,
                    Some(_) => continue,
                    None => return, // channel closed
                }
            }

            // Phase 2: Consume events until quiet_period of silence
            loop {
                match tokio::time::timeout(quiet_period, event_rx.recv()).await {
                    Ok(Some(_)) => continue, // more events — restart quiet period
                    Ok(None) => return,      // channel closed
                    Err(_) => break,         // timeout — silence achieved
                }
            }

            // Phase 3: Gate on dev state, then fire reload
            if debounce_state.load().is_none() {
                continue; // dev mode disabled during debounce
            }
            let payload = br#"{"action":"reload_frontend"}"#;
            let frame = Frame::new(FeedId::Control, payload.to_vec());
            let _ = client_action_tx.send(frame);
            info!("dev: triggered reload");

            // Send dev_notification with type "reloaded"
            send_dev_notification("reloaded", &debounce_tracker, &client_action_tx);
            info!("dev: sent dev_notification type=reloaded");
        }
    });

    Ok(watcher)
}

/// Start compiled code watcher (code) using mtime polling
///
/// Polls two exact file paths every 2 seconds: frontend (dist/index.html) and backend (tugcast binary).
/// On stable mtime change (after 500ms stabilization), marks the appropriate tracker category
/// and sends a restart_available notification.
pub(crate) fn dev_compiled_watcher(
    frontend_path: PathBuf,
    backend_path: PathBuf,
    tracker: SharedChangeTracker,
    client_action_tx: broadcast::Sender<Frame>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Read initial mtimes (None if file does not exist)
        let mut frontend_mtime = read_mtime(&frontend_path);
        let mut backend_mtime = read_mtime(&backend_path);

        info!(
            "dev: compiled watcher monitoring frontend={} backend={}",
            frontend_path.display(),
            backend_path.display()
        );

        loop {
            interval.tick().await;

            // Check frontend path
            if let Some(new_mtime) = check_and_stabilize(&frontend_path, &frontend_mtime).await {
                frontend_mtime = Some(new_mtime);
                tracker.lock().unwrap().mark_frontend();
                send_dev_notification("restart_available", &tracker, &client_action_tx);
                info!("dev: compiled watcher detected frontend change");
            }

            // Check backend path
            if let Some(new_mtime) = check_and_stabilize(&backend_path, &backend_mtime).await {
                backend_mtime = Some(new_mtime);
                tracker.lock().unwrap().mark_backend();
                send_dev_notification("restart_available", &tracker, &client_action_tx);
                info!("dev: compiled watcher detected backend change");
            }
        }
    })
}

/// Start app sources watcher (app) using notify events
///
/// Watches tugapp/Sources/ recursively for .swift file changes. Uses the same
/// quiet-period debounce as styles (100ms silence window). On change, marks
/// the app tracker category and sends a relaunch_available notification.
pub(crate) fn dev_app_watcher(
    app_sources_dir: PathBuf,
    tracker: SharedChangeTracker,
    client_action_tx: broadcast::Sender<Frame>,
) -> Result<RecommendedWatcher, String> {
    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();

    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let _ = event_tx.send(res);
        })
        .map_err(|e| format!("failed to create dev app watcher: {}", e))?;

    // Watch app sources directory if it exists
    if app_sources_dir.exists() {
        watcher
            .watch(&app_sources_dir, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {}: {}", app_sources_dir.display(), e))?;
        info!("dev: watching app sources {}", app_sources_dir.display());
    } else {
        warn!(
            "dev: app sources directory {} does not exist, skipping app watcher",
            app_sources_dir.display()
        );
    }

    // Quiet-period debounce task
    tokio::spawn(async move {
        let quiet_period = Duration::from_millis(100);
        loop {
            // Phase 1: Wait for a .swift file event
            loop {
                match event_rx.recv().await {
                    Some(Ok(event)) if has_swift_extension(&event) => break,
                    Some(_) => continue,
                    None => return,
                }
            }

            // Phase 2: Consume events until quiet
            loop {
                match tokio::time::timeout(quiet_period, event_rx.recv()).await {
                    Ok(Some(_)) => continue,
                    Ok(None) => return,
                    Err(_) => break,
                }
            }

            // Phase 3: Mark and notify
            tracker.lock().unwrap().mark_app();
            send_dev_notification("relaunch_available", &tracker, &client_action_tx);
            info!("dev: sent dev_notification type=relaunch_available");
        }
    });

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_dev_state_valid() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();
        assert_eq!(state.dist_dir, dist_dir);
        assert_eq!(state.index_path, dist_dir.join("index.html"));
        assert_eq!(state.source_tree, temp_dir.path());
    }

    #[test]
    fn test_load_dev_state_missing_dist() {
        use tempfile::TempDir;
        let temp_dir = TempDir::new().unwrap();
        // No tugdeck/dist/index.html
        let result = load_dev_state(temp_dir.path());
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .contains("tugdeck/dist/index.html not found")
        );
    }

    #[test]
    fn test_load_dev_state_missing_index_html() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        // Create dist dir but no index.html
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();

        let result = load_dev_state(temp_dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_watch_dirs_returns_dist_and_src() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();
        let dirs = watch_dirs(&state);

        assert_eq!(dirs.len(), 2);
        assert!(dirs.iter().any(|p| p == &dist_dir));
        assert!(
            dirs.iter()
                .any(|p| p == &temp_dir.path().join("tugdeck/src"))
        );
    }

    #[test]
    fn test_validate_dev_state_warns_missing() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");

        // Create DevState with nonexistent paths
        let state = DevState {
            dist_dir: dist_dir.clone(),
            index_path: dist_dir.join("index.html"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        // Should not panic, just log warnings
        validate_dev_state(&state);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_path_traversal_dotdot() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/../../../etc/passwd");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_path_traversal_encoded() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/%2e%2e/secret");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_path_traversal_double_encoded() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/%252e%252e%252f%252e%252e%252fetc%252fpasswd");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_hashed_js_from_dist_assets() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        let assets_dir = dist_dir.join("assets");
        fs::create_dir_all(&assets_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        // Create a hashed JS file (Vite output pattern)
        fs::write(assets_dir.join("index-abc123.js"), "console.log('hello');").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/assets/index-abc123.js");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(body.contains("console.log"));
    }

    #[tokio::test]
    async fn test_serve_dev_asset_font_from_dist_fonts() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        let fonts_dir = dist_dir.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        // Create a font file
        fs::write(fonts_dir.join("hack-regular.woff2"), b"fake font data").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/fonts/hack-regular.woff2");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body_bytes[..], b"fake font data");
    }

    #[tokio::test]
    async fn test_serve_dev_asset_404_not_in_dist() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        let uri = Uri::from_static("/nonexistent.css");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_index_html() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();

        let original_html = "<html><body>Test</body></html>";
        fs::write(dist_dir.join("index.html"), original_html).unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();

        // Request /index.html
        let uri = Uri::from_static("/index.html");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();
        // Verify reload script was NOT injected
        assert!(!body.contains(r#"<script src="/dev/reload.js"></script>"#));
        assert_eq!(body, original_html);
    }

    #[test]
    fn test_new_shared_dev_state_is_none() {
        let shared = new_shared_dev_state();
        assert!(shared.load().is_none());
    }

    #[test]
    fn test_shared_dev_state_store_load() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let state = load_dev_state(temp_dir.path()).unwrap();
        let shared = new_shared_dev_state();

        // Store the state
        shared.store(Arc::new(Some(state)));

        // Load and verify
        assert!(shared.load().is_some());
    }

    #[tokio::test]
    async fn test_enable_dev_mode_valid() {
        use std::fs;
        use tempfile::TempDir;

        // Create a TempDir with a valid tugdeck/dist/index.html
        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);

        let result =
            enable_dev_mode(temp_dir.path().to_path_buf(), &shared, client_action_tx).await;

        assert!(result.is_ok());
        assert!(shared.load().is_some());

        // Drop runtime to clean up the watcher
        drop(result.unwrap());
    }

    #[tokio::test]
    async fn test_enable_dev_mode_invalid_path() {
        use tempfile::TempDir;

        // Create a TempDir with NO tugdeck/dist directory (invalid path)
        let temp_dir = TempDir::new().unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);

        let result =
            enable_dev_mode(temp_dir.path().to_path_buf(), &shared, client_action_tx).await;

        assert!(result.is_err());
        assert!(shared.load().is_none());
    }

    #[tokio::test]
    async fn test_disable_dev_mode_clears_state() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);

        let runtime = enable_dev_mode(temp_dir.path().to_path_buf(), &shared, client_action_tx)
            .await
            .unwrap();

        assert!(shared.load().is_some());

        // Disable dev mode
        disable_dev_mode(runtime, &shared);

        assert!(shared.load().is_none());
    }

    #[tokio::test]
    async fn test_enable_disable_enable_different_path() {
        use std::fs;
        use tempfile::TempDir;

        // Create two TempDirs each with valid dist structures
        let temp_dir1 = TempDir::new().unwrap();
        let dist_dir1 = temp_dir1.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir1).unwrap();
        fs::write(dist_dir1.join("index.html"), "<html>dir1</html>").unwrap();

        let temp_dir2 = TempDir::new().unwrap();
        let dist_dir2 = temp_dir2.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir2).unwrap();
        fs::write(dist_dir2.join("index.html"), "<html>dir2</html>").unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);

        // Enable with path1
        let runtime1 = enable_dev_mode(
            temp_dir1.path().to_path_buf(),
            &shared,
            client_action_tx.clone(),
        )
        .await
        .unwrap();
        assert!(shared.load().is_some());

        // Disable
        disable_dev_mode(runtime1, &shared);

        // Enable with path2
        let runtime2 = enable_dev_mode(temp_dir2.path().to_path_buf(), &shared, client_action_tx)
            .await
            .unwrap();

        // Verify the source_tree in the loaded state matches path2 (resolved)
        let expected = resolve_symlinks(temp_dir2.path()).unwrap();
        let guard = shared.load();
        if let Some(ref state) = **guard {
            assert_eq!(state.source_tree, expected);
        } else {
            panic!("Expected Some(DevState) after enable");
        }

        drop(runtime2);
    }

    #[tokio::test]
    async fn test_debounce_gating_after_disable() {
        use std::fs;
        use tempfile::TempDir;

        // Create a TempDir with a valid dist/index.html
        let temp_dir = TempDir::new().unwrap();
        let dist_dir = temp_dir.path().join("tugdeck/dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("index.html"), "<html></html>").unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);
        let mut client_action_rx = client_action_tx.subscribe();

        // Enable dev mode
        let runtime = enable_dev_mode(temp_dir.path().to_path_buf(), &shared, client_action_tx)
            .await
            .unwrap();

        // Modify the index.html file to trigger a file event
        fs::write(
            dist_dir.join("index.html"),
            "<html><body>modified</body></html>",
        )
        .unwrap();

        // Immediately disable dev mode (before the 100ms debounce fires)
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        disable_dev_mode(runtime, &shared);

        // Wait 200ms (enough for debounce to complete)
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Assert client_action_rx.try_recv() returns Err (no reload was sent)
        assert!(
            client_action_rx.try_recv().is_err(),
            "Expected no reload after disable during debounce"
        );
    }

    #[test]
    fn test_change_tracker_new_is_clean() {
        let tracker = DevChangeTracker::new();
        assert!(!tracker.frontend_dirty);
        assert!(!tracker.backend_dirty);
        assert!(!tracker.app_dirty);
        assert_eq!(tracker.code_count, 0);
        assert_eq!(tracker.app_count, 0);
    }

    #[test]
    fn test_change_tracker_mark_frontend() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_frontend();
        assert!(tracker.frontend_dirty);
        assert!(!tracker.backend_dirty);
        assert!(!tracker.app_dirty);
        assert_eq!(tracker.code_count, 1);
        assert_eq!(tracker.app_count, 0);
    }

    #[test]
    fn test_change_tracker_mark_backend() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_backend();
        assert!(!tracker.frontend_dirty);
        assert!(tracker.backend_dirty);
        assert!(!tracker.app_dirty);
        assert_eq!(tracker.code_count, 1);
        assert_eq!(tracker.app_count, 0);
    }

    #[test]
    fn test_change_tracker_combined_count() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_frontend();
        tracker.mark_frontend();
        tracker.mark_backend();
        assert!(tracker.frontend_dirty);
        assert!(tracker.backend_dirty);
        assert!(!tracker.app_dirty);
        assert_eq!(tracker.code_count, 3);
        assert_eq!(tracker.app_count, 0);
    }

    #[test]
    fn test_change_tracker_mark_app() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_app();
        assert!(!tracker.frontend_dirty);
        assert!(!tracker.backend_dirty);
        assert!(tracker.app_dirty);
        assert_eq!(tracker.code_count, 0);
        assert_eq!(tracker.app_count, 1);
    }

    #[test]
    fn test_change_tracker_clear_restart() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_frontend();
        tracker.mark_backend();
        tracker.mark_app();
        assert_eq!(tracker.code_count, 2);
        assert_eq!(tracker.app_count, 1);

        tracker.clear_restart();
        assert!(!tracker.frontend_dirty);
        assert!(!tracker.backend_dirty);
        assert!(tracker.app_dirty); // app state preserved
        assert_eq!(tracker.code_count, 0);
        assert_eq!(tracker.app_count, 1); // app count preserved
    }

    #[test]
    fn test_change_tracker_clear_all() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_frontend();
        tracker.mark_backend();
        tracker.mark_app();

        tracker.clear_all();
        assert!(!tracker.frontend_dirty);
        assert!(!tracker.backend_dirty);
        assert!(!tracker.app_dirty);
        assert_eq!(tracker.code_count, 0);
        assert_eq!(tracker.app_count, 0);
    }

    #[test]
    fn test_change_tracker_snapshot() {
        let mut tracker = DevChangeTracker::new();
        tracker.mark_frontend();
        tracker.mark_backend();
        assert_eq!(tracker.code_count, 2);

        let (changes, code_count, app_count) = tracker.snapshot();
        assert_eq!(changes, vec!["frontend", "backend"]);
        assert_eq!(code_count, 2);
        assert_eq!(app_count, 0);

        // Add app change
        tracker.mark_app();
        let (changes, code_count, app_count) = tracker.snapshot();
        assert_eq!(changes, vec!["frontend", "backend", "app"]);
        assert_eq!(code_count, 2);
        assert_eq!(app_count, 1);
    }

    #[tokio::test]
    async fn test_send_dev_notification_reloaded() {
        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        let (client_action_tx, mut rx) = broadcast::channel(16);

        send_dev_notification("reloaded", &tracker, &client_action_tx);

        let frame = rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::Control);

        let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(json["action"], "dev_notification");
        assert_eq!(json["type"], "reloaded");
        assert!(json.get("changes").is_none());
        assert!(json.get("count").is_none());
        assert!(json.get("timestamp").is_some());
        assert!(json["timestamp"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_send_dev_notification_restart_available() {
        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        {
            let mut guard = tracker.lock().unwrap();
            guard.mark_frontend();
            guard.mark_backend();
        }

        let (client_action_tx, mut rx) = broadcast::channel(16);
        send_dev_notification("restart_available", &tracker, &client_action_tx);

        let frame = rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::Control);

        let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(json["action"], "dev_notification");
        assert_eq!(json["type"], "restart_available");
        assert_eq!(json["changes"], serde_json::json!(["frontend", "backend"]));
        assert_eq!(json["count"], 2);
        assert!(json.get("timestamp").is_some());
        assert!(json["timestamp"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_send_dev_notification_relaunch_available() {
        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        {
            let mut guard = tracker.lock().unwrap();
            guard.mark_app();
        }

        let (client_action_tx, mut rx) = broadcast::channel(16);
        send_dev_notification("relaunch_available", &tracker, &client_action_tx);

        let frame = rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::Control);

        let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(json["action"], "dev_notification");
        assert_eq!(json["type"], "relaunch_available");
        assert_eq!(json["changes"], serde_json::json!(["app"]));
        assert_eq!(json["count"], 1);
        assert!(json.get("timestamp").is_some());
        assert!(json["timestamp"].as_u64().unwrap() > 0);
    }

    #[test]
    fn test_has_reload_extension_excludes_js() {
        use notify::{Event, EventKind};
        use std::path::PathBuf;

        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any,
            )),
            paths: vec![PathBuf::from("test.js")],
            attrs: Default::default(),
        };

        assert!(!has_reload_extension(&event));
    }

    #[test]
    fn test_has_reload_extension_includes_css_html() {
        use notify::{Event, EventKind};
        use std::path::PathBuf;

        let css_event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any,
            )),
            paths: vec![PathBuf::from("test.css")],
            attrs: Default::default(),
        };
        assert!(has_reload_extension(&css_event));

        let html_event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any,
            )),
            paths: vec![PathBuf::from("test.html")],
            attrs: Default::default(),
        };
        assert!(has_reload_extension(&html_event));
    }

    #[test]
    fn test_has_swift_extension() {
        use notify::{Event, EventKind};
        use std::path::PathBuf;

        let swift_event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any,
            )),
            paths: vec![PathBuf::from("test.swift")],
            attrs: Default::default(),
        };
        assert!(has_swift_extension(&swift_event));

        let other_event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Any,
            )),
            paths: vec![PathBuf::from("test.rs")],
            attrs: Default::default(),
        };
        assert!(!has_swift_extension(&other_event));
    }

    #[tokio::test]
    async fn test_compiled_watcher_detects_mtime_change() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let frontend_path = temp_dir.path().join("index.html");
        let backend_path = temp_dir.path().join("tugcast");

        // Create the frontend file
        fs::write(&frontend_path, b"initial content").unwrap();
        // Backend does not exist initially

        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        let (client_action_tx, mut rx) = broadcast::channel(16);

        let _handle = dev_compiled_watcher(
            frontend_path.clone(),
            backend_path,
            tracker.clone(),
            client_action_tx,
        );

        // Wait for initial scan
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Modify the frontend file
        tokio::time::sleep(Duration::from_millis(100)).await;
        fs::write(&frontend_path, b"modified content").unwrap();

        // Wait for detection (2s poll + 500ms stabilization + buffer)
        match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Ok(frame)) => {
                assert_eq!(frame.feed_id, FeedId::Control);
                let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
                assert_eq!(json["action"], "dev_notification");
                assert_eq!(json["type"], "restart_available");

                // Verify tracker was marked
                let guard = tracker.lock().unwrap();
                assert!(guard.frontend_dirty);
                assert_eq!(guard.code_count, 1);
            }
            Ok(Err(e)) => panic!("broadcast recv error: {}", e),
            Err(_) => panic!("Timeout waiting for compiled watcher notification"),
        }
    }

    #[tokio::test]
    async fn test_compiled_watcher_missing_at_start() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let frontend_path = temp_dir.path().join("index.html");
        let backend_path = temp_dir.path().join("tugcast");

        // Both files do not exist initially
        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        let (client_action_tx, mut rx) = broadcast::channel(16);

        let _handle = dev_compiled_watcher(
            frontend_path.clone(),
            backend_path,
            tracker.clone(),
            client_action_tx,
        );

        // Wait a bit - should not panic, no notification
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(
            rx.try_recv().is_err(),
            "Expected no notification while files missing"
        );

        // Create the frontend file
        fs::write(&frontend_path, b"new content").unwrap();

        // Wait for detection
        match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Ok(frame)) => {
                assert_eq!(frame.feed_id, FeedId::Control);
                let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
                assert_eq!(json["type"], "restart_available");
            }
            Ok(Err(e)) => panic!("broadcast recv error: {}", e),
            Err(_) => panic!("Timeout waiting for notification after file appears"),
        }
    }

    #[tokio::test]
    async fn test_compiled_watcher_stabilization() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let frontend_path = temp_dir.path().join("index.html");
        let backend_path = temp_dir.path().join("tugcast");

        // Create the frontend file
        fs::write(&frontend_path, b"initial").unwrap();

        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        let (client_action_tx, mut rx) = broadcast::channel(16);

        let _handle = dev_compiled_watcher(
            frontend_path.clone(),
            backend_path,
            tracker.clone(),
            client_action_tx,
        );

        // Wait for initial scan
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Modify the file
        fs::write(&frontend_path, b"modified1").unwrap();

        // Quickly modify again (within stabilization window)
        tokio::time::sleep(Duration::from_millis(200)).await;
        fs::write(&frontend_path, b"modified2").unwrap();

        // Should receive only one notification after stabilization
        match tokio::time::timeout(Duration::from_secs(6), rx.recv()).await {
            Ok(Ok(frame)) => {
                assert_eq!(frame.feed_id, FeedId::Control);
                // Verify only one notification (try_recv should fail)
                tokio::time::sleep(Duration::from_millis(100)).await;
                assert!(
                    rx.try_recv().is_err(),
                    "Expected only one notification after stabilization"
                );
            }
            Ok(Err(e)) => panic!("broadcast recv error: {}", e),
            Err(_) => panic!("Timeout waiting for stabilized notification"),
        }
    }

    #[tokio::test]
    async fn test_app_watcher_detects_swift_change() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let app_sources_dir = temp_dir.path().join("Sources");
        fs::create_dir_all(&app_sources_dir).unwrap();

        let tracker = Arc::new(std::sync::Mutex::new(DevChangeTracker::new()));
        let (client_action_tx, mut rx) = broadcast::channel(16);

        let _watcher =
            dev_app_watcher(app_sources_dir.clone(), tracker.clone(), client_action_tx).unwrap();

        // Create a .swift file
        let swift_file = app_sources_dir.join("Test.swift");
        fs::write(&swift_file, "struct Test {}").unwrap();

        // Wait for notification (100ms debounce + buffer)
        match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
            Ok(Ok(frame)) => {
                assert_eq!(frame.feed_id, FeedId::Control);
                let json: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
                assert_eq!(json["action"], "dev_notification");
                assert_eq!(json["type"], "relaunch_available");

                // Verify tracker was marked
                let guard = tracker.lock().unwrap();
                assert!(guard.app_dirty);
                assert_eq!(guard.app_count, 1);
            }
            Ok(Err(e)) => panic!("broadcast recv error: {}", e),
            Err(_) => panic!("Timeout waiting for app watcher notification"),
        }
    }
}
