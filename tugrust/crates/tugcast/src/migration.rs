//! One-time migrations executed at tugcast startup.
//!
//! Two unrelated migrations live here for proximity, gated separately:
//!
//! 1. `migrate_settings_to_tugbank` (debug builds only): reads
//!    `.tugtool/deck-settings.json` from the source tree, writes the
//!    `layout` and `theme` fields into the appropriate tugbank
//!    domains, and deletes the flat file. This migration only
//!    matters on developer machines that predate the tugbank
//!    transition; production has never seen a `deck-settings.json`.
//!
//! 2. `migrate_legacy_tugbank` (all builds): per [D06], on the first
//!    launch of `(release, main)`, copies the legacy
//!    `~/.tugbank.db` into `<data-dir>/tugbank.db`. The legacy file
//!    is never written to, moved, or deleted by Tug code — it stays
//!    as a backup. A marker file `.migrated-from-legacy` inside the
//!    data dir guarantees the copy runs at most once. Skipped
//!    silently for non-`release-main` instances.

use std::path::Path;

use tracing::{info, warn};
#[cfg(any(debug_assertions, test))]
use tugbank_core::{TugbankClient, Value};

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
#[cfg(any(debug_assertions, test))]
pub(crate) fn migrate_settings_to_tugbank(
    source_tree: &Path,
    client: &TugbankClient,
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
            client.set(
                "dev.tugtool.deck.layout",
                "layout",
                Value::Json(layout_val.clone()),
            )?;
            layout_written = true;
        }
    }

    // Write theme as Value::String if present in the parsed settings.
    if let Some(theme_val) = parsed.get("theme") {
        if let Some(theme_str) = theme_val.as_str() {
            client.set(
                "dev.tugtool.app",
                "theme",
                Value::String(theme_str.to_owned()),
            )?;
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

/// Marker filename written inside the per-instance data dir after a
/// successful legacy tugbank migration. Its presence is the
/// idempotence guard — once written, the migration never re-runs.
pub(crate) const LEGACY_MIGRATION_MARKER: &str = ".migrated-from-legacy";

/// Outcome of [`migrate_legacy_tugbank`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LegacyMigration {
    /// Migration was performed: the legacy DB was copied into the
    /// per-instance data dir and the marker was written.
    Migrated,
    /// The marker already existed (this is a repeat launch). No work
    /// performed; legacy DB untouched.
    AlreadyMigrated,
    /// The legacy DB does not exist. Nothing to migrate; marker is
    /// written anyway so future legacy DBs aren't accidentally
    /// pulled in.
    NoLegacyDb,
    /// This instance is not `release-main`. Migration is silently
    /// skipped per [D06].
    SkippedNotReleaseMain,
}

/// Copy the legacy `~/.tugbank.db` into the per-instance tugbank for
/// `(release, main)` on first launch, per [D06].
///
/// Idempotence: a sentinel file at
/// `<data-dir>/.migrated-from-legacy` is written after the copy
/// finishes. Subsequent launches see the marker and return
/// [`LegacyMigration::AlreadyMigrated`].
///
/// Crash safety: the legacy DB is copied to `<data-dir>/tugbank.db.tmp`,
/// fsynced, then atomically renamed over `<data-dir>/tugbank.db`.
/// The marker is written *after* the rename succeeds, so an interrupted
/// migration leaves nothing claiming "done" yet still has the original
/// legacy file intact (Tug code never modifies it).
///
/// `instance_id` is the value of `TUG_INSTANCE_ID`; migration is a
/// no-op when it isn't `"release-main"`.
pub(crate) fn migrate_legacy_tugbank(
    instance_id: Option<&str>,
    legacy_path: &Path,
    per_instance_dir: &Path,
) -> std::io::Result<LegacyMigration> {
    if instance_id != Some("release-main") {
        return Ok(LegacyMigration::SkippedNotReleaseMain);
    }

    let marker = per_instance_dir.join(LEGACY_MIGRATION_MARKER);
    if marker.exists() {
        return Ok(LegacyMigration::AlreadyMigrated);
    }

    std::fs::create_dir_all(per_instance_dir)?;

    if !legacy_path.exists() {
        // No legacy DB to copy. Write the marker so a future copy of
        // the legacy file (e.g. a backup the user drops in by hand)
        // doesn't get silently migrated on the next launch.
        write_marker_atomically(&marker)?;
        info!(
            legacy = %legacy_path.display(),
            marker = %marker.display(),
            "no legacy ~/.tugbank.db found; marking release-main as migrated"
        );
        return Ok(LegacyMigration::NoLegacyDb);
    }

    let dest = per_instance_dir.join("tugbank.db");
    let tmp = per_instance_dir.join("tugbank.db.tmp");

    // Copy + fsync + rename. `std::fs::copy` writes file contents and
    // sets permissions but does not fsync; we open the destination
    // again to sync its contents and metadata before the rename.
    std::fs::copy(legacy_path, &tmp)?;
    let f = std::fs::File::open(&tmp)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, &dest)?;

    write_marker_atomically(&marker)?;

    info!(
        legacy = %legacy_path.display(),
        dest = %dest.display(),
        marker = %marker.display(),
        "migrated legacy ~/.tugbank.db into release-main"
    );
    Ok(LegacyMigration::Migrated)
}

/// Write the migration marker atomically. The marker is a small
/// timestamped text file — the content is informational; what
/// matters is the file's *existence*.
fn write_marker_atomically(marker: &Path) -> std::io::Result<()> {
    let tmp = marker.with_extension("tmp");
    std::fs::write(
        &tmp,
        chrono::Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            .as_bytes(),
    )?;
    std::fs::rename(&tmp, marker)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_client(tmp: &TempDir) -> TugbankClient {
        let db_path = tmp.path().join("test.db");
        TugbankClient::open(&db_path).expect("open client")
    }

    fn write_settings_file(source_tree: &Path, contents: &str) {
        let dir = source_tree.join(".tugtool");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("deck-settings.json"), contents).unwrap();
    }

    fn settings_file_path(source_tree: &Path) -> std::path::PathBuf {
        source_tree.join(".tugtool").join("deck-settings.json")
    }

    #[test]
    fn test_migrate_both_layout_and_theme() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);
        write_settings_file(
            tmp.path(),
            r#"{"layout":{"version":5,"cards":[]},"theme":"brio"}"#,
        );

        migrate_settings_to_tugbank(tmp.path(), &client).unwrap();

        let layout = client.get("dev.tugtool.deck.layout", "layout").unwrap();
        assert!(
            matches!(layout, Some(Value::Json(_))),
            "layout should be Value::Json, got {layout:?}"
        );
        if let Some(Value::Json(v)) = layout {
            assert_eq!(v["version"], 5);
        }
        assert_eq!(
            client.get("dev.tugtool.app", "theme").unwrap(),
            Some(Value::String("brio".to_owned()))
        );
        assert!(
            !settings_file_path(tmp.path()).exists(),
            "flat file should be deleted after migration"
        );
    }

    #[test]
    fn test_migrate_layout_only() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);
        write_settings_file(tmp.path(), r#"{"layout":{"version":5,"cards":[]}}"#);

        migrate_settings_to_tugbank(tmp.path(), &client).unwrap();

        assert!(
            client
                .get("dev.tugtool.deck.layout", "layout")
                .unwrap()
                .is_some(),
            "layout should be written"
        );
        assert_eq!(
            client.get("dev.tugtool.app", "theme").unwrap(),
            None,
            "theme should not be written"
        );
        assert!(!settings_file_path(tmp.path()).exists());
    }

    #[test]
    fn test_migrate_theme_only() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);
        write_settings_file(tmp.path(), r#"{"theme":"bluenote"}"#);

        migrate_settings_to_tugbank(tmp.path(), &client).unwrap();

        assert_eq!(
            client.get("dev.tugtool.deck.layout", "layout").unwrap(),
            None
        );
        assert_eq!(
            client.get("dev.tugtool.app", "theme").unwrap(),
            Some(Value::String("bluenote".to_owned()))
        );
        assert!(!settings_file_path(tmp.path()).exists());
    }

    #[test]
    fn test_migrate_missing_file_is_noop() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);

        let result = migrate_settings_to_tugbank(tmp.path(), &client);
        assert!(result.is_ok());
        assert_eq!(
            client.get("dev.tugtool.deck.layout", "layout").unwrap(),
            None
        );
        assert_eq!(client.get("dev.tugtool.app", "theme").unwrap(), None);
    }

    #[test]
    fn test_migrate_corrupt_file_writes_nothing_and_deletes() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);
        write_settings_file(tmp.path(), "this is not valid json }{");

        migrate_settings_to_tugbank(tmp.path(), &client).unwrap();

        assert_eq!(
            client.get("dev.tugtool.deck.layout", "layout").unwrap(),
            None
        );
        assert_eq!(client.get("dev.tugtool.app", "theme").unwrap(), None);
        assert!(
            !settings_file_path(tmp.path()).exists(),
            "corrupt flat file should still be deleted"
        );
    }

    #[test]
    fn test_migrate_empty_json_writes_nothing() {
        let tmp = TempDir::new().unwrap();
        let client = temp_client(&tmp);
        write_settings_file(tmp.path(), "{}");

        migrate_settings_to_tugbank(tmp.path(), &client).unwrap();

        assert_eq!(
            client.get("dev.tugtool.deck.layout", "layout").unwrap(),
            None
        );
        assert_eq!(client.get("dev.tugtool.app", "theme").unwrap(), None);
        assert!(!settings_file_path(tmp.path()).exists());
    }

    // ── Legacy tugbank migration tests ─────────────────────────────

    fn write_legacy_db(path: &Path, contents: &[u8]) {
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn legacy_migration_runs_on_release_main_when_legacy_present() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join("legacy.db");
        let per_instance = tmp.path().join("instances/release-main");
        write_legacy_db(&legacy, b"LEGACY-CONTENT");

        let result = migrate_legacy_tugbank(Some("release-main"), &legacy, &per_instance).unwrap();
        assert_eq!(result, LegacyMigration::Migrated);

        let dest = per_instance.join("tugbank.db");
        assert!(dest.exists());
        assert_eq!(std::fs::read(&dest).unwrap(), b"LEGACY-CONTENT");
        assert!(per_instance.join(LEGACY_MIGRATION_MARKER).exists());
        // Legacy unchanged.
        assert_eq!(std::fs::read(&legacy).unwrap(), b"LEGACY-CONTENT");
        // Temp file gone.
        assert!(!per_instance.join("tugbank.db.tmp").exists());
    }

    #[test]
    fn legacy_migration_is_noop_after_first_run() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join("legacy.db");
        let per_instance = tmp.path().join("instances/release-main");
        write_legacy_db(&legacy, b"v1");

        assert_eq!(
            migrate_legacy_tugbank(Some("release-main"), &legacy, &per_instance).unwrap(),
            LegacyMigration::Migrated
        );

        // Simulate post-migration drift in the legacy file; the
        // second run must NOT touch the per-instance copy.
        std::fs::write(&legacy, b"v2-DO-NOT-MIGRATE").unwrap();
        assert_eq!(
            migrate_legacy_tugbank(Some("release-main"), &legacy, &per_instance).unwrap(),
            LegacyMigration::AlreadyMigrated
        );
        assert_eq!(
            std::fs::read(per_instance.join("tugbank.db")).unwrap(),
            b"v1"
        );
    }

    #[test]
    fn legacy_migration_skipped_for_non_release_main() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join("legacy.db");
        let per_instance = tmp.path().join("instances/debug-foo");
        write_legacy_db(&legacy, b"legacy");

        let result = migrate_legacy_tugbank(Some("debug-foo"), &legacy, &per_instance).unwrap();
        assert_eq!(result, LegacyMigration::SkippedNotReleaseMain);
        assert!(!per_instance.join("tugbank.db").exists());
        assert!(!per_instance.join(LEGACY_MIGRATION_MARKER).exists());
    }

    #[test]
    fn legacy_migration_skipped_when_no_instance_id() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join("legacy.db");
        let per_instance = tmp.path().join("instances/none");
        write_legacy_db(&legacy, b"legacy");

        let result = migrate_legacy_tugbank(None, &legacy, &per_instance).unwrap();
        assert_eq!(result, LegacyMigration::SkippedNotReleaseMain);
    }

    #[test]
    fn legacy_migration_marks_done_even_without_legacy_db() {
        let tmp = TempDir::new().unwrap();
        let legacy = tmp.path().join("legacy.db"); // does not exist
        let per_instance = tmp.path().join("instances/release-main");

        let result = migrate_legacy_tugbank(Some("release-main"), &legacy, &per_instance).unwrap();
        assert_eq!(result, LegacyMigration::NoLegacyDb);
        assert!(per_instance.join(LEGACY_MIGRATION_MARKER).exists());
        assert!(!per_instance.join("tugbank.db").exists());
    }
}
