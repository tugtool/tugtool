//! Dev mode: file watcher, manifest-based serving, and dev asset serving

use arc_swap::ArcSwap;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn};
use tugcast_core::{FeedId, Frame};

// Keep in sync with build.rs copy
#[derive(Debug, Deserialize)]
#[cfg_attr(not(test), allow(dead_code))]
struct AssetManifest {
    files: HashMap<String, String>,
    dirs: Option<HashMap<String, DirEntry>>,
    build: Option<BuildConfig>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(not(test), allow(dead_code))]
struct DirEntry {
    src: String,
    pattern: String,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(not(test), allow(dead_code))]
struct BuildConfig {
    fallback: String,
}

/// Dev mode state: parsed manifest with resolved absolute paths
#[derive(Clone, Debug)]
pub(crate) struct DevState {
    pub files: HashMap<String, PathBuf>,
    pub index_path: PathBuf,
    pub dirs: Vec<(String, PathBuf, glob::Pattern)>,
    pub fallback: PathBuf,
    pub source_tree: PathBuf,
}

/// Shared dev state type for lock-free runtime swapping
pub(crate) type SharedDevState = Arc<ArcSwap<Option<DevState>>>;

/// Dev runtime: holds file watcher for RAII cleanup
pub(crate) struct DevRuntime {
    pub(crate) _watcher: RecommendedWatcher,
}

/// Create a new shared dev state initialized to None
pub(crate) fn new_shared_dev_state() -> SharedDevState {
    Arc::new(ArcSwap::from_pointee(None))
}

/// Enable dev mode: load manifest, start file watcher, populate shared state
pub(crate) async fn enable_dev_mode(
    source_tree: PathBuf,
    shared_state: &SharedDevState,
    client_action_tx: broadcast::Sender<Frame>,
) -> Result<DevRuntime, String> {
    // Resolve symlinks without canonicalize(), which on macOS resolves through
    // the /Users firmlink to /System/Volumes/Data/Users — a path FSEvents ignores.
    let source_tree = resolve_symlinks(&source_tree)
        .map_err(|e| format!("failed to resolve source_tree {}: {}", source_tree.display(), e))?;

    // Load manifest via spawn_blocking (blocking filesystem I/O)
    let source = source_tree.clone();
    let state = tokio::task::spawn_blocking(move || load_manifest(&source))
        .await
        .map_err(|e| format!("manifest load task panicked: {}", e))??;

    // Validate manifest (logs warnings)
    validate_manifest(&state);

    // Derive watch directories
    let watch_dirs = watch_dirs_from_manifest(&state);

    // Create file watcher (passing shared_state clone for debounce gating)
    let watcher = dev_file_watcher(&watch_dirs, client_action_tx, shared_state.clone())?;

    // Store loaded DevState into shared state
    shared_state.store(Arc::new(Some(state)));

    info!(source_tree = ?source_tree, "dev mode enabled");

    Ok(DevRuntime { _watcher: watcher })
}

/// Disable dev mode: clear shared state, drop file watcher
pub(crate) fn disable_dev_mode(runtime: DevRuntime, shared_state: &SharedDevState) {
    // Clear shared state
    shared_state.store(Arc::new(None));

    // Drop runtime (stops file watcher)
    drop(runtime);

    info!("dev mode disabled");
}

/// Load and parse the asset manifest from source tree
pub(crate) fn load_manifest(source_tree: &Path) -> Result<DevState, String> {
    let manifest_path = source_tree.join("tugdeck/assets.toml");
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read {}: {}", manifest_path.display(), e))?;

    let manifest: AssetManifest = toml::from_str(&manifest_content)
        .map_err(|e| format!("failed to parse {}: {}", manifest_path.display(), e))?;

    let tugdeck_dir = source_tree.join("tugdeck");

    // Resolve files map to absolute paths
    let mut files = HashMap::new();
    for (url_key, src_path) in manifest.files {
        let abs_path = tugdeck_dir.join(&src_path);
        files.insert(url_key, abs_path);
    }

    // Extract index.html path
    let index_path = files
        .get("index.html")
        .ok_or_else(|| "manifest missing required entry: index.html".to_string())?
        .clone();

    // Resolve dirs to (prefix, abs_path, compiled_pattern)
    let mut dirs = Vec::new();
    if let Some(dirs_map) = manifest.dirs {
        for (prefix, entry) in dirs_map {
            let abs_path = tugdeck_dir.join(&entry.src);
            let pattern = glob::Pattern::new(&entry.pattern)
                .map_err(|e| format!("invalid glob pattern '{}': {}", entry.pattern, e))?;
            dirs.push((prefix, abs_path, pattern));
        }
    }

    // Resolve fallback
    let fallback = if let Some(build) = manifest.build {
        tugdeck_dir.join(&build.fallback)
    } else {
        tugdeck_dir.join("dist")
    };

    Ok(DevState {
        files,
        index_path,
        dirs,
        fallback,
        source_tree: source_tree.to_path_buf(),
    })
}

/// Validate manifest at startup: warn about missing files/directories
pub(crate) fn validate_manifest(state: &DevState) {
    for (url_key, path) in &state.files {
        if !path.exists() {
            warn!(
                "manifest [files] entry '{}' -> {} does not exist",
                url_key,
                path.display()
            );
        }
    }

    for (prefix, dir_path, _) in &state.dirs {
        if !dir_path.exists() {
            warn!(
                "manifest [dirs] entry '{}' -> {} does not exist",
                prefix,
                dir_path.display()
            );
        }
    }

    if !state.fallback.exists() {
        warn!(
            "manifest [build].fallback -> {} does not exist",
            state.fallback.display()
        );
    }
}

/// Derive watch directories from manifest, with deduplication to avoid overlapping recursive watches
pub(crate) fn watch_dirs_from_manifest(state: &DevState) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // Collect parent directories of all files
    for path in state.files.values() {
        if let Some(parent) = path.parent() {
            dirs.push(parent.to_path_buf());
        }
    }

    // Collect all dir source paths
    for (_, dir_path, _) in &state.dirs {
        dirs.push(dir_path.clone());
    }

    // Add the fallback directory
    dirs.push(state.fallback.clone());

    // Deduplicate: sort by path component count (depth), then filter
    dirs.sort_by_key(|p| p.components().count());
    dirs.dedup();

    // Filter out subdirectories of already-watched ancestors
    let mut result = Vec::new();
    for candidate in dirs {
        let is_subdir_of_watched = result
            .iter()
            .any(|watched: &PathBuf| candidate.starts_with(watched));
        if !is_subdir_of_watched {
            result.push(candidate);
        }
    }

    result
}

/// Serve dev asset with three-tier lookup and path safety
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

    // Special case: index.html served from disk
    if lookup_key == "index.html" {
        return serve_dev_index_impl(dev_state).await;
    }

    // Tier 1: Check files map for exact match
    if let Some(file_path) = dev_state.files.get(&lookup_key) {
        return serve_file_with_safety(file_path, dev_state).await;
    }

    // Tier 2: Check dirs for prefix match with glob filter
    for (prefix, dir_path, pattern) in &dev_state.dirs {
        if let Some(remainder) = lookup_key.strip_prefix(&format!("{}/", prefix)) {
            // Check if remainder matches the glob pattern (basename only)
            let filename = remainder.split('/').next_back().unwrap_or("");
            if pattern.matches(filename) {
                let candidate = dir_path.join(remainder);
                return serve_file_with_safety(&candidate, dev_state).await;
            }
        }
    }

    // Tier 3: Fallback directory
    let fallback_path = dev_state.fallback.join(&lookup_key);
    serve_file_with_safety(&fallback_path, dev_state).await
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

    // Verify the path starts with an allowed root (tugdeck/ subtree or fallback)
    // We must canonicalize the roots too for comparison, but handle case where they don't exist yet
    let tugdeck_root = dev_state.source_tree.join("tugdeck");

    // For path safety, check if the canonical path starts with either:
    // 1. The canonical tugdeck root (if it exists)
    // 2. The canonical fallback (if it exists)
    // 3. Or if canonicalization fails, check against non-canonicalized paths as fallback
    let mut allowed = false;

    if let Ok(canonical_tugdeck) = tugdeck_root.canonicalize() {
        if canonical_path.starts_with(&canonical_tugdeck) {
            allowed = true;
        }
    }

    if !allowed {
        if let Ok(canonical_fallback) = dev_state.fallback.canonicalize() {
            if canonical_path.starts_with(&canonical_fallback) {
                allowed = true;
            }
        }
    }

    // Fallback: if both roots don't exist or canonicalization failed,
    // check if the original candidate path starts with the non-canonicalized roots
    if !allowed
        && (candidate.starts_with(&tugdeck_root) || candidate.starts_with(&dev_state.fallback))
    {
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

/// Check whether a notify event contains paths with reload-worthy extensions
fn has_reload_extension(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| {
        p.extension()
            .is_some_and(|ext| ext == "html" || ext == "css" || ext == "js")
    })
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
        watcher
            .watch(dir, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {}: {}", dir.display(), e))?;
        info!("dev: watching {}", dir.display());
    }

    // Quiet-period debounce task with dev state gating
    let debounce_state = shared_state;
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
        }
    });

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_manifest_valid() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let manifest_content = r#"
[files]
"index.html" = "index.html"
"tokens.css" = "styles/tokens.css"

[dirs]
"fonts" = { src = "styles/fonts", pattern = "*.woff2" }

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir.join("assets.toml"), manifest_content).unwrap();

        let state = load_manifest(temp_dir.path()).unwrap();
        assert_eq!(state.files.len(), 2);
        assert!(state.files.contains_key("index.html"));
        assert!(state.files.contains_key("tokens.css"));
        assert_eq!(state.dirs.len(), 1);
        assert_eq!(state.dirs[0].0, "fonts");
    }

    #[test]
    fn test_load_manifest_missing() {
        use tempfile::TempDir;
        let temp_dir = TempDir::new().unwrap();
        let result = load_manifest(temp_dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_watch_dirs_deduplication() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        let styles_dir = tugdeck_dir.join("styles");
        let fonts_dir = styles_dir.join("fonts");
        fs::create_dir_all(&fonts_dir).unwrap();

        let mut state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![(
                "fonts".to_string(),
                fonts_dir.clone(),
                glob::Pattern::new("*.woff2").unwrap(),
            )],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        // Add a file in the styles directory
        state
            .files
            .insert("tokens.css".to_string(), styles_dir.join("tokens.css"));

        let watch_dirs = watch_dirs_from_manifest(&state);

        // Should include styles/ but NOT fonts/ (since fonts/ is a subdirectory of styles/)
        assert!(watch_dirs.iter().any(|p| p == &styles_dir));
        // fonts/ should be filtered out by deduplication
        let fonts_count = watch_dirs.iter().filter(|p| *p == &fonts_dir).count();
        assert_eq!(
            fonts_count, 0,
            "fonts/ should be deduplicated since styles/ is already watched"
        );
    }

    #[test]
    fn test_validate_manifest_warns_missing() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        // Create DevState with nonexistent paths
        let mut files = HashMap::new();
        files.insert("missing.css".to_string(), tugdeck_dir.join("missing.css"));

        let state = DevState {
            files,
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![(
                "missing-fonts".to_string(),
                tugdeck_dir.join("missing-fonts"),
                glob::Pattern::new("*.woff2").unwrap(),
            )],
            fallback: tugdeck_dir.join("missing-dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        // Should not panic, just log warnings
        validate_manifest(&state);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_path_traversal_dotdot() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        // Create minimal state
        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

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
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

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
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        let uri = Uri::from_static("/%252e%252e%252f%252e%252e%252fetc%252fpasswd");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_files_lookup() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        let styles_dir = tugdeck_dir.join("styles");
        fs::create_dir_all(&styles_dir).unwrap();

        // Create a CSS file
        fs::write(styles_dir.join("tokens.css"), "body { color: red; }").unwrap();

        let mut files = HashMap::new();
        files.insert("tokens.css".to_string(), styles_dir.join("tokens.css"));

        let state = DevState {
            files,
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        let uri = Uri::from_static("/tokens.css");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(body.contains("color: red"));
    }

    #[tokio::test]
    async fn test_serve_dev_asset_dirs_lookup_with_glob() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        let fonts_dir = tugdeck_dir.join("styles/fonts");
        fs::create_dir_all(&fonts_dir).unwrap();

        // Create a font file
        fs::write(fonts_dir.join("Hack-Regular.woff2"), b"fake font data").unwrap();

        let dirs = vec![(
            "fonts".to_string(),
            fonts_dir,
            glob::Pattern::new("*.woff2").unwrap(),
        )];

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs,
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        let uri = Uri::from_static("/fonts/Hack-Regular.woff2");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body_bytes[..], b"fake font data");
    }

    #[tokio::test]
    async fn test_serve_dev_asset_dirs_lookup_glob_mismatch() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        let fonts_dir = tugdeck_dir.join("styles/fonts");
        fs::create_dir_all(&fonts_dir).unwrap();

        // Create a file that doesn't match the glob pattern
        fs::write(fonts_dir.join("readme.txt"), "not a font").unwrap();

        let dirs = vec![(
            "fonts".to_string(),
            fonts_dir,
            glob::Pattern::new("*.woff2").unwrap(),
        )];

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs,
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        // Request a file that doesn't match the glob pattern
        let uri = Uri::from_static("/fonts/readme.txt");
        let response = serve_dev_asset(uri, &state).await;

        // Should fall through to fallback/404 since glob pattern doesn't match
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_fallback() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        let dist_dir = tugdeck_dir.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();

        // Create a JS file in dist
        fs::write(dist_dir.join("app.js"), "console.log('hello');").unwrap();

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: dist_dir,
            source_tree: temp_dir.path().to_path_buf(),
        };

        let uri = Uri::from_static("/app.js");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::OK);

        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(body.contains("console.log"));
    }

    #[tokio::test]
    async fn test_serve_dev_asset_404_unknown() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let state = DevState {
            files: HashMap::new(),
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        let uri = Uri::from_static("/nonexistent.css");
        let response = serve_dev_asset(uri, &state).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_serve_dev_asset_index_html_injection() {
        use axum::http::Uri;
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        // Create index.html
        let original_html = "<html><body>Test</body></html>";
        fs::write(tugdeck_dir.join("index.html"), original_html).unwrap();

        let mut files = HashMap::new();
        files.insert("index.html".to_string(), tugdeck_dir.join("index.html"));

        let state = DevState {
            files,
            index_path: tugdeck_dir.join("index.html"),
            dirs: vec![],
            fallback: tugdeck_dir.join("dist"),
            source_tree: temp_dir.path().to_path_buf(),
        };

        // Request /index.html (not /) to test special case in serve_dev_asset
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

        // Create a fixture with a valid DevState
        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let manifest_content = r#"
[files]
"index.html" = "index.html"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir.join("assets.toml"), manifest_content).unwrap();

        let state = load_manifest(temp_dir.path()).unwrap();
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

        // Create a TempDir with a valid tugdeck/assets.toml manifest
        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let manifest_content = r#"
[files]
"index.html" = "index.html"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir.join("assets.toml"), manifest_content).unwrap();

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

        // Create a TempDir with NO tugdeck directory (invalid path)
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

        // Enable dev mode with valid manifest
        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let manifest_content = r#"
[files]
"index.html" = "index.html"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir.join("assets.toml"), manifest_content).unwrap();

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

        // Create two TempDirs each with valid manifests
        let temp_dir1 = TempDir::new().unwrap();
        let tugdeck_dir1 = temp_dir1.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir1).unwrap();

        let manifest_content1 = r#"
[files]
"index.html" = "index.html"
"file1.css" = "file1.css"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir1.join("assets.toml"), manifest_content1).unwrap();

        let temp_dir2 = TempDir::new().unwrap();
        let tugdeck_dir2 = temp_dir2.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir2).unwrap();

        let manifest_content2 = r#"
[files]
"index.html" = "index.html"
"file2.css" = "file2.css"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir2.join("assets.toml"), manifest_content2).unwrap();

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

        // Create a TempDir with valid manifest and a real .html file
        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir_all(&tugdeck_dir).unwrap();

        let manifest_content = r#"
[files]
"index.html" = "index.html"

[build]
fallback = "dist"
"#;
        fs::write(tugdeck_dir.join("assets.toml"), manifest_content).unwrap();

        // Create the index.html file
        fs::write(tugdeck_dir.join("index.html"), "<html></html>").unwrap();

        let shared = new_shared_dev_state();
        let (client_action_tx, _) = broadcast::channel(16);
        let mut client_action_rx = client_action_tx.subscribe();

        // Enable dev mode
        let runtime = enable_dev_mode(temp_dir.path().to_path_buf(), &shared, client_action_tx)
            .await
            .unwrap();

        // Modify the .html file to trigger a file event
        fs::write(
            tugdeck_dir.join("index.html"),
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
}
