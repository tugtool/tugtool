//! Settings persistence for tugcast
//!
//! Provides `DeckSettings` for storing deck layout and theme,
//! `SettingsState` for sharing settings path and write serialization
//! across axum handlers, and `load_settings`/`save_settings` for
//! atomic file I/O.
//!
//! HTTP handlers `get_settings` and `post_settings` implement
//! `GET /api/settings` and `POST /api/settings` respectively.

use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Extension;
use axum::body::Bytes;
use axum::extract::ConnectInfo;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tracing::warn;

/// Persisted deck settings: layout and theme.
///
/// Both fields are optional and use `skip_serializing_if` so that
/// absent fields are omitted from the JSON file, keeping it minimal.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct DeckSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}

/// Shared state for settings handlers.
///
/// `path` is `None` when no `source_tree` is configured (graceful
/// degradation per [D06]). `lock` serializes read-modify-write
/// operations in `post_settings` to prevent concurrent POST races.
pub(crate) struct SettingsState {
    pub path: Option<PathBuf>,
    pub lock: tokio::sync::Mutex<()>,
}

/// Load settings from `path`, returning `DeckSettings::default()` on
/// any error (missing file, invalid JSON, I/O failure).
pub(crate) async fn load_settings(path: &Path) -> DeckSettings {
    match tokio::fs::read_to_string(path).await {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => DeckSettings::default(),
    }
}

/// Save `settings` to `path` atomically.
///
/// Creates parent directories if missing, writes to a temp file in the
/// same directory, then renames to the target path. `rename(2)` is
/// atomic on POSIX filesystems, preventing partial writes from
/// corrupting the settings file.
pub(crate) async fn save_settings(path: &Path, settings: &DeckSettings) -> Result<(), io::Error> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let json = serde_json::to_string(settings)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    // Write to a temp file in the same directory, then rename
    let temp_path = path.with_extension("tmp");
    tokio::fs::write(&temp_path, json.as_bytes()).await?;
    tokio::fs::rename(&temp_path, path).await?;

    Ok(())
}

// ── HTTP handlers ──────────────────────────────────────────────────────────

/// Handle GET /api/settings
///
/// Returns the current deck settings as JSON. Restricted to loopback
/// connections (403 for non-loopback). Returns `{}` when `source_tree`
/// is not configured or the settings file does not exist.
pub(crate) async fn get_settings(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(state): Extension<Arc<SettingsState>>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!(
            "get_settings: rejected non-loopback connection from {}",
            addr
        );
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }

    let settings = match &state.path {
        Some(path) => load_settings(path).await,
        None => DeckSettings::default(),
    };

    (
        StatusCode::OK,
        axum::Json(
            serde_json::to_value(&settings)
                .unwrap_or(serde_json::Value::Object(Default::default())),
        ),
    )
        .into_response()
}

/// Handle POST /api/settings
///
/// Merges the posted JSON into the stored settings using null-as-delete
/// semantics per [D09]:
/// - Field present with non-null value → overwrite existing field.
/// - Field absent from body → preserve existing value.
/// - Field explicitly set to `null` → remove field from stored settings.
///
/// Restricted to loopback connections. When `source_tree` is not
/// configured, silently discards the payload and returns `{"status":"ok"}`.
pub(crate) async fn post_settings(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(state): Extension<Arc<SettingsState>>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!(
            "post_settings: rejected non-loopback connection from {}",
            addr
        );
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }

    // Parse body as raw JSON value for null-as-delete merge logic
    let posted: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"status": "error", "message": "invalid JSON"})),
            )
                .into_response();
        }
    };

    // Graceful degradation: no source_tree configured, silently discard
    let path = match &state.path {
        Some(p) => p.clone(),
        None => {
            return (
                StatusCode::OK,
                axum::Json(serde_json::json!({"status": "ok"})),
            )
                .into_response();
        }
    };

    // Acquire the write lock to serialize the read-modify-write cycle
    let _guard = state.lock.lock().await;

    // Load existing settings as a raw JSON object for field-level merge
    let mut stored: serde_json::Map<String, serde_json::Value> = {
        let existing = load_settings(&path).await;
        match serde_json::to_value(&existing) {
            Ok(serde_json::Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        }
    };

    // Apply null-as-delete merge from posted object
    if let serde_json::Value::Object(posted_map) = posted {
        for (key, value) in posted_map {
            if value.is_null() {
                // Explicit null → delete the field
                stored.remove(&key);
            } else {
                // Non-null value → overwrite
                stored.insert(key, value);
            }
        }
    }

    // Deserialize merged map back to DeckSettings for atomic write
    let merged: DeckSettings =
        serde_json::from_value(serde_json::Value::Object(stored)).unwrap_or_default();

    if let Err(e) = save_settings(&path, &merged).await {
        warn!("post_settings: failed to save settings: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"status": "error", "message": "failed to save"})),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        axum::Json(serde_json::json!({"status": "ok"})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ── DeckSettings serialization round-trip ──────────────────────────────

    #[test]
    fn test_deck_settings_round_trip_full() {
        let original = DeckSettings {
            layout: Some(serde_json::json!({"version": 5, "cards": []})),
            theme: Some("brio".to_string()),
        };
        let json = serde_json::to_string(&original).unwrap();
        let restored: DeckSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.layout, original.layout);
        assert_eq!(restored.theme, original.theme);
    }

    #[test]
    fn test_deck_settings_round_trip_empty() {
        let original = DeckSettings::default();
        let json = serde_json::to_string(&original).unwrap();
        // Both fields are None → serialized as `{}`
        assert_eq!(json, "{}");
        let restored: DeckSettings = serde_json::from_str(&json).unwrap();
        assert!(restored.layout.is_none());
        assert!(restored.theme.is_none());
    }

    #[test]
    fn test_deck_settings_round_trip_layout_only() {
        let original = DeckSettings {
            layout: Some(serde_json::json!({"version": 5})),
            theme: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        assert!(!json.contains("theme"));
        let restored: DeckSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.layout, original.layout);
        assert!(restored.theme.is_none());
    }

    #[test]
    fn test_deck_settings_round_trip_theme_only() {
        let original = DeckSettings {
            layout: None,
            theme: Some("harmony".to_string()),
        };
        let json = serde_json::to_string(&original).unwrap();
        assert!(!json.contains("layout"));
        let restored: DeckSettings = serde_json::from_str(&json).unwrap();
        assert!(restored.layout.is_none());
        assert_eq!(restored.theme.as_deref(), Some("harmony"));
    }

    // ── load_settings ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_load_settings_missing_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.json");
        let settings = load_settings(&path).await;
        assert!(settings.layout.is_none());
        assert!(settings.theme.is_none());
    }

    #[tokio::test]
    async fn test_load_settings_valid_json_returns_parsed() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        let content = r#"{"layout":{"version":5,"cards":[]},"theme":"bluenote"}"#;
        tokio::fs::write(&path, content).await.unwrap();

        let settings = load_settings(&path).await;
        assert_eq!(
            settings.layout,
            Some(serde_json::json!({"version": 5, "cards": []}))
        );
        assert_eq!(settings.theme.as_deref(), Some("bluenote"));
    }

    #[tokio::test]
    async fn test_load_settings_invalid_json_returns_default() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        tokio::fs::write(&path, b"not valid json").await.unwrap();

        let settings = load_settings(&path).await;
        assert!(settings.layout.is_none());
        assert!(settings.theme.is_none());
    }

    // ── save_settings ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_save_settings_creates_file_with_correct_content() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");

        let settings = DeckSettings {
            layout: Some(serde_json::json!({"version": 5})),
            theme: Some("brio".to_string()),
        };

        save_settings(&path, &settings).await.unwrap();

        let content = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["theme"], "brio");
        assert_eq!(parsed["layout"]["version"], 5);
    }

    #[tokio::test]
    async fn test_save_settings_creates_parent_directory() {
        let tmp = TempDir::new().unwrap();
        // Nested directory that does not yet exist
        let path = tmp.path().join("nested").join("dir").join("settings.json");

        let settings = DeckSettings {
            layout: None,
            theme: Some("harmony".to_string()),
        };

        save_settings(&path, &settings).await.unwrap();
        assert!(path.exists());

        let content = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["theme"], "harmony");
    }

    #[tokio::test]
    async fn test_save_settings_overwrites_existing_file_atomically() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");

        // Write initial content
        let initial = DeckSettings {
            layout: None,
            theme: Some("brio".to_string()),
        };
        save_settings(&path, &initial).await.unwrap();

        // Overwrite with new content
        let updated = DeckSettings {
            layout: Some(serde_json::json!({"version": 5})),
            theme: Some("bluenote".to_string()),
        };
        save_settings(&path, &updated).await.unwrap();

        let content = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["theme"], "bluenote");
        assert_eq!(parsed["layout"]["version"], 5);
    }
}
