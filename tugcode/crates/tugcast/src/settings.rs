//! Settings persistence for tugcast
//!
//! Provides `DeckSettings` for storing deck layout and theme,
//! `SettingsState` for sharing settings path and write serialization
//! across axum handlers, and `load_settings`/`save_settings` for
//! atomic file I/O.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Persisted deck settings: layout and theme.
///
/// Both fields are optional and use `skip_serializing_if` so that
/// absent fields are omitted from the JSON file, keeping it minimal.
// Allow dead_code: DeckSettings is used in handlers wired in server.rs in the next step.
#[allow(dead_code)]
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
// Allow dead_code: SettingsState is fully wired in server.rs in the next step.
#[allow(dead_code)]
pub(crate) struct SettingsState {
    pub path: Option<PathBuf>,
    pub lock: tokio::sync::Mutex<()>,
}

/// Load settings from `path`, returning `DeckSettings::default()` on
/// any error (missing file, invalid JSON, I/O failure).
// Allow dead_code: called from axum handlers wired in server.rs in the next step.
#[allow(dead_code)]
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
// Allow dead_code: called from axum handlers wired in server.rs in the next step.
#[allow(dead_code)]
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

/// Construct an `Arc<SettingsState>` from an optional source tree path.
///
/// Convenience helper used in `build_app`.
// Allow dead_code: wired into build_app in server.rs in the next step.
#[allow(dead_code)]
pub(crate) fn make_settings_state(source_tree: Option<&Path>) -> Arc<SettingsState> {
    let path = source_tree.map(|t| t.join(".tugtool/deck-settings.json"));
    Arc::new(SettingsState {
        path,
        lock: tokio::sync::Mutex::new(()),
    })
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
