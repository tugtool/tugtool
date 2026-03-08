//! One-time migration from the legacy flat-file settings backend to tugbank.
//!
//! Reads `.tugtool/deck-settings.json` from the source tree root, writes the
//! `layout` and `theme` fields into the appropriate tugbank domains, and then
//! deletes the flat file so the migration never re-runs.
//!
//! The migration is idempotent via file-existence guard: if the flat file is
//! absent, this function is a no-op. See [D01] in the plan for the full
//! rationale.

use std::path::Path;

use tracing::{info, warn};
use tugbank_core::{DefaultsStore, Value};

/// Migrate legacy deck-settings.json to tugbank domains.
///
/// Reads the flat file at `{source_tree}/.tugtool/deck-settings.json`.
/// If the file exists:
///   1. Parse as `serde_json::Value` and extract `layout`/`theme` fields
///   2. If parsing succeeds and `layout` is present, write `Value::Json(v)`
///      to domain `dev.tugtool.deck.layout`, key `layout`
///   3. If parsing succeeds and `theme` is present, write `Value::String(s)`
///      to domain `dev.tugtool.app`, key `theme`
///   4. If parsing fails completely (not valid JSON), log `warn!` and
///      write nothing to tugbank -- the data is unrecoverable
///   5. Delete the flat file unconditionally (even on parse failure, to
///      prevent the migration from re-running and logging on every startup)
///   6. Log migration result at info level
///
/// If the file does not exist, this function is a no-op.
// Step 2 wires the call site in main.rs; suppress dead_code until then.
#[allow(dead_code)]
pub(crate) fn migrate_settings_to_tugbank(
    source_tree: &Path,
    store: &DefaultsStore,
) -> Result<(), Box<dyn std::error::Error>> {
    let settings_path = source_tree.join(".tugtool").join("deck-settings.json");

    if !settings_path.exists() {
        info!("no legacy settings file found, skipping migration");
        return Ok(());
    }

    let contents = std::fs::read_to_string(&settings_path)?;

    // Parse the flat file. On failure, log a warning, skip writes, but still
    // delete the flat file to prevent repeated warnings on every startup (R01).
    let parsed: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                path = %settings_path.display(),
                error = %e,
                "failed to parse legacy settings file during migration — layout is unrecoverable, skipping writes"
            );
            // Delete unconditionally to prevent repeated warnings.
            if let Err(del_err) = std::fs::remove_file(&settings_path) {
                warn!(
                    path = %settings_path.display(),
                    error = %del_err,
                    "failed to delete corrupt legacy settings file"
                );
            }
            return Ok(());
        }
    };

    let mut layout_written = false;
    let mut theme_written = false;

    // Write layout as Value::Json if present in the parsed settings.
    if let Some(layout_val) = parsed.get("layout") {
        if !layout_val.is_null() {
            let handle = store.domain("dev.tugtool.deck.layout")?;
            handle.set("layout", Value::Json(layout_val.clone()))?;
            layout_written = true;
        }
    }

    // Write theme as Value::String if present in the parsed settings.
    if let Some(theme_val) = parsed.get("theme") {
        if let Some(theme_str) = theme_val.as_str() {
            let handle = store.domain("dev.tugtool.app")?;
            handle.set("theme", Value::String(theme_str.to_owned()))?;
            theme_written = true;
        }
    }

    // Delete the flat file unconditionally after processing.
    if let Err(del_err) = std::fs::remove_file(&settings_path) {
        warn!(
            path = %settings_path.display(),
            error = %del_err,
            "failed to delete legacy settings file after migration"
        );
    }

    info!(
        layout_written,
        theme_written, "migrated deck settings to tugbank"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tugbank_core::DefaultsStore;

    fn temp_store(tmp: &TempDir) -> DefaultsStore {
        let db_path = tmp.path().join("test.db");
        DefaultsStore::open(&db_path).expect("open store")
    }

    fn write_settings_file(source_tree: &Path, contents: &str) {
        let dir = source_tree.join(".tugtool");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("deck-settings.json"), contents).unwrap();
    }

    fn settings_file_path(source_tree: &Path) -> std::path::PathBuf {
        source_tree.join(".tugtool").join("deck-settings.json")
    }

    // T01: Migration with both layout and theme writes both keys and deletes flat file
    #[test]
    fn test_migrate_both_layout_and_theme() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        let contents = r#"{"layout":{"version":5,"cards":[]},"theme":"brio"}"#;
        write_settings_file(tmp.path(), contents);

        migrate_settings_to_tugbank(tmp.path(), &store).unwrap();

        // Layout key written to dev.tugtool.deck.layout
        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        let layout = layout_handle.get("layout").unwrap();
        assert!(
            matches!(layout, Some(Value::Json(_))),
            "layout should be Value::Json, got {layout:?}"
        );
        if let Some(Value::Json(v)) = layout {
            assert_eq!(v["version"], 5);
        }

        // Theme key written to dev.tugtool.app
        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        let theme = theme_handle.get("theme").unwrap();
        assert_eq!(theme, Some(Value::String("brio".to_owned())));

        // Flat file deleted
        assert!(
            !settings_file_path(tmp.path()).exists(),
            "flat file should be deleted after migration"
        );
    }

    // T02: Migration with layout only writes layout key, no theme key
    #[test]
    fn test_migrate_layout_only() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        let contents = r#"{"layout":{"version":5,"cards":[]}}"#;
        write_settings_file(tmp.path(), contents);

        migrate_settings_to_tugbank(tmp.path(), &store).unwrap();

        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        assert!(
            layout_handle.get("layout").unwrap().is_some(),
            "layout should be written"
        );

        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        assert_eq!(
            theme_handle.get("theme").unwrap(),
            None,
            "theme should not be written"
        );

        assert!(!settings_file_path(tmp.path()).exists());
    }

    // T03: Migration with theme only writes theme key, no layout key
    #[test]
    fn test_migrate_theme_only() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        let contents = r#"{"theme":"bluenote"}"#;
        write_settings_file(tmp.path(), contents);

        migrate_settings_to_tugbank(tmp.path(), &store).unwrap();

        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        assert_eq!(
            layout_handle.get("layout").unwrap(),
            None,
            "layout should not be written"
        );

        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        assert_eq!(
            theme_handle.get("theme").unwrap(),
            Some(Value::String("bluenote".to_owned()))
        );

        assert!(!settings_file_path(tmp.path()).exists());
    }

    // T04: Migration with missing flat file is a no-op (returns Ok, no writes)
    #[test]
    fn test_migrate_missing_file_is_noop() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        // No flat file created — should be a no-op
        let result = migrate_settings_to_tugbank(tmp.path(), &store);
        assert!(result.is_ok());

        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        assert_eq!(layout_handle.get("layout").unwrap(), None);

        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        assert_eq!(theme_handle.get("theme").unwrap(), None);
    }

    // T05: Migration with corrupt/unparseable flat file logs warning, writes nothing,
    // and still deletes the flat file
    #[test]
    fn test_migrate_corrupt_file_writes_nothing_and_deletes() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        write_settings_file(tmp.path(), "this is not valid json }{");

        migrate_settings_to_tugbank(tmp.path(), &store).unwrap();

        // Nothing written to tugbank
        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        assert_eq!(layout_handle.get("layout").unwrap(), None);

        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        assert_eq!(theme_handle.get("theme").unwrap(), None);

        // Flat file still deleted
        assert!(
            !settings_file_path(tmp.path()).exists(),
            "corrupt flat file should still be deleted"
        );
    }

    // T06: Migration with empty JSON `{}` is a no-op (no keys written, file still deleted)
    #[test]
    fn test_migrate_empty_json_writes_nothing() {
        let tmp = TempDir::new().unwrap();
        let store = temp_store(&tmp);

        write_settings_file(tmp.path(), "{}");

        migrate_settings_to_tugbank(tmp.path(), &store).unwrap();

        let layout_handle = store.domain("dev.tugtool.deck.layout").unwrap();
        assert_eq!(layout_handle.get("layout").unwrap(), None);

        let theme_handle = store.domain("dev.tugtool.app").unwrap();
        assert_eq!(theme_handle.get("theme").unwrap(), None);

        // File is still deleted even with empty JSON
        assert!(!settings_file_path(tmp.path()).exists());
    }
}
