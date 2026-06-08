//! Per-instance identity and path helpers.
//!
//! Every long-lived per-instance resource (tugbank DB, session
//! ledger, notify socket, log directory, bundle-path marker) derives
//! its path from a single environment variable: `TUG_INSTANCE_ID`,
//! set by Swift at launch and inherited by every spawned child
//! (see [D12]). When the variable is unset, callers see legacy
//! single-instance paths so the helpers are safe to drop into
//! existing code with no behavioral change for unmodified callers.
//!
//! The instance ID itself is `<profile>-<branch-slug>` — for
//! example `release-main` or `debug-dev-wake-1`. Tug code
//! does not parse the ID; downstream readers treat it as an opaque
//! filesystem-safe token.
//!
//! [D12]: roadmap/tug-multi-instance.md#d12-instance-env-var

use std::env;
use std::path::PathBuf;

/// Environment variable name carrying the runtime instance ID.
pub const ENV_INSTANCE_ID: &str = "TUG_INSTANCE_ID";

/// Environment variable name carrying the absolute path of the
/// running app bundle. Swift sets this when spawning tugcast so
/// tugcast can write the per-instance bundle-path marker.
pub const ENV_BUNDLE_PATH: &str = "TUG_BUNDLE_PATH";

/// File name of the per-instance bundle-path marker. The marker
/// anchors `tugutil instance prune`'s orphan detection: a data dir
/// is reachable iff `cat <data-dir>/<MARKER>` points at an extant
/// bundle.
pub const BUNDLE_PATH_MARKER: &str = "bundle-path";

/// Resolve the runtime instance ID from `TUG_INSTANCE_ID`.
///
/// Returns `None` when the variable is unset or empty. An empty
/// value is treated the same as unset — neither a sensible default
/// nor an error — because `TUG_INSTANCE_ID=` from a shell would
/// otherwise resolve to a data dir under `instances//`.
pub fn instance_id() -> Option<String> {
    env::var(ENV_INSTANCE_ID).ok().filter(|s| !s.is_empty())
}

/// Short, fixed-width token for an arbitrary instance ID (FNV-1a
/// 32-bit, lower-hex). Pure function of the ID — use this to key
/// resources for an instance *other* than the current process's (e.g.
/// reaping a removed worktree's tmux server). Mirrors
/// `InstanceConfig.shortToken` in Swift (identical FNV-1a + `%08x`).
pub fn short_token_for(instance_id: &str) -> String {
    format!("{:08x}", crate::ports::fnv1a_32(instance_id.as_bytes()))
}

/// Short, fixed-width token derived from the *runtime* instance ID.
/// Returns `None` when no instance ID is set.
///
/// Fixed-length resource names that must stay under the Unix-domain
/// socket path limit (`sockaddr_un.sun_path` is ~104 bytes on macOS)
/// key on this rather than the raw ID: the app-test harness mints
/// `apptest-<uuid>`, whose full ID plus the `$TMPDIR` prefix overflows
/// `sun_path` and fails to bind. Same ID → same token.
pub fn short_token() -> Option<String> {
    instance_id().map(|id| short_token_for(&id))
}

/// Per-instance tmux server socket label for an arbitrary instance ID:
/// `tug-<short_token>`. Pure function of the ID.
pub fn tmux_socket_label_for(instance_id: &str) -> String {
    format!("tug-{}", short_token_for(instance_id))
}

/// Per-instance tmux server socket label for the runtime instance:
/// `tug-<short_token>`.
///
/// Passed as `tmux -L <label>` so every instance owns a private tmux
/// server — a tmux operation in one instance can never reach another
/// instance's sessions or server. Returns `None` when no instance ID
/// is set (legacy / standalone launches use the default tmux server).
pub fn tmux_socket_label() -> Option<String> {
    instance_id().map(|id| tmux_socket_label_for(&id))
}

/// Per-instance data directory.
///
/// - With `TUG_INSTANCE_ID=<id>`: `<base>/Tug/instances/<id>/`
/// - Without: legacy `<base>/Tug/`
///
/// where `<base>` is `dirs::data_dir()` on macOS, `~/Library/
/// Application Support`. Falls back to the system temp directory
/// if no home directory is resolvable.
///
/// This function does *not* create the directory — callers that
/// need a writable path on disk should `fs::create_dir_all` it.
pub fn data_dir() -> PathBuf {
    let base = base_data_dir();
    match instance_id() {
        Some(id) => base.join("instances").join(id),
        None => base,
    }
}

/// Per-instance log directory: `<data-dir>/Logs/`.
///
/// With `TUG_INSTANCE_ID` set this is per-instance; without it,
/// callers see the legacy single-instance log path
/// (`~/Library/Application Support/Tug/Logs/`).
pub fn log_dir() -> PathBuf {
    data_dir().join("Logs")
}

/// Per-instance tugbank database path.
///
/// Returns `Some(<data-dir>/tugbank.db)` when `TUG_INSTANCE_ID` is
/// set, otherwise `None`. Callers fall back to their existing
/// path resolution (e.g. `~/.tugbank.db`) when this returns `None`.
pub fn tugbank_db_path() -> Option<PathBuf> {
    instance_id().map(|_| data_dir().join("tugbank.db"))
}

/// Per-instance session ledger database path.
///
/// Returns `Some(<data-dir>/sessions.db)` when `TUG_INSTANCE_ID`
/// is set, otherwise `None`.
pub fn sessions_db_path() -> Option<PathBuf> {
    instance_id().map(|_| data_dir().join("sessions.db"))
}

/// Per-instance tugbank notify socket path.
///
/// - With `TUG_INSTANCE_ID=<id>`: `$TMPDIR/tugbank-notify-<short_token>.sock`
/// - Without: legacy `$TMPDIR/tugbank-notify.sock`
///
/// Keyed on [`short_token`] rather than the raw ID so the path stays
/// under `sun_path`'s ~104-byte limit even for long IDs (the app-test
/// harness mints `apptest-<uuid>`). Swift's
/// `InstanceConfig.notifySocketPath` resolves the identical path.
///
/// `$TMPDIR` is the per-user runtime directory on macOS, picked up
/// via `std::env::temp_dir()`.
pub fn notify_socket_path() -> PathBuf {
    let dir = env::temp_dir();
    match short_token() {
        Some(tok) => dir.join(format!("tugbank-notify-{tok}.sock")),
        None => dir.join("tugbank-notify.sock"),
    }
}

/// Path to the per-instance bundle-path marker file.
///
/// Tugcast writes the absolute path of its containing app bundle to
/// this file on first launch when `TUG_BUNDLE_PATH` is set in the
/// environment. `tugutil instance prune` later compares the marker
/// against the live filesystem to identify orphaned data dirs whose
/// bundles have been moved or removed.
///
/// The marker lives inside the data dir; without `TUG_INSTANCE_ID`
/// this returns the legacy `Tug/bundle-path` path, which no normal
/// flow writes — it exists for symmetry only.
pub fn bundle_path_marker() -> PathBuf {
    data_dir().join(BUNDLE_PATH_MARKER)
}

/// Read the path Swift passed via `TUG_BUNDLE_PATH`, if any.
///
/// Returns `None` when the variable is unset or empty.
pub fn bundle_path_from_env() -> Option<PathBuf> {
    env::var(ENV_BUNDLE_PATH)
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Outcome of a [`write_bundle_path_marker`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerWrite {
    /// The marker did not exist (or differed from `path`) and was written.
    Written,
    /// The marker already contained `path` byte-for-byte; no write was performed.
    Unchanged,
    /// `TUG_INSTANCE_ID` or `TUG_BUNDLE_PATH` was unset; nothing was written.
    /// Tugcast launched standalone for testing falls into this branch.
    Skipped,
}

/// Write the per-instance bundle-path marker if both
/// `TUG_INSTANCE_ID` and `TUG_BUNDLE_PATH` are set.
///
/// Tugcast calls this once at startup, after creating the per-instance
/// data dir, so `tugutil instance prune` (Step 14) has an anchor to
/// detect orphaned data dirs whose owning bundle has been moved or
/// removed.
///
/// To avoid needless filesystem churn (and to keep mtimes stable for
/// observers), the function reads the existing marker and skips the
/// write when its content already matches the desired path. Any I/O
/// error during the existence-check is treated as "marker absent" so
/// the next write attempt proceeds.
///
/// Returns a [`MarkerWrite`] describing what happened.
pub fn write_bundle_path_marker() -> std::io::Result<MarkerWrite> {
    let Some(bundle) = bundle_path_from_env() else {
        return Ok(MarkerWrite::Skipped);
    };
    if instance_id().is_none() {
        return Ok(MarkerWrite::Skipped);
    }

    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;

    let marker = dir.join(BUNDLE_PATH_MARKER);
    let desired = bundle.to_string_lossy().into_owned();

    if let Ok(existing) = std::fs::read_to_string(&marker)
        && existing == desired
    {
        return Ok(MarkerWrite::Unchanged);
    }

    std::fs::write(&marker, desired.as_bytes())?;
    Ok(MarkerWrite::Written)
}

fn base_data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(env::temp_dir).join("Tug")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::ffi::OsString;

    /// RAII guard that restores `TUG_INSTANCE_ID` and `TUG_BUNDLE_PATH`
    /// to their original values when dropped. Tests that mutate the
    /// process environment use this so a panic mid-test cannot leak
    /// state into the next.
    struct EnvGuard {
        instance: Option<OsString>,
        bundle: Option<OsString>,
    }

    impl EnvGuard {
        fn snapshot() -> Self {
            Self {
                instance: env::var_os(ENV_INSTANCE_ID),
                bundle: env::var_os(ENV_BUNDLE_PATH),
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.instance {
                    Some(v) => env::set_var(ENV_INSTANCE_ID, v),
                    None => env::remove_var(ENV_INSTANCE_ID),
                }
                match &self.bundle {
                    Some(v) => env::set_var(ENV_BUNDLE_PATH, v),
                    None => env::remove_var(ENV_BUNDLE_PATH),
                }
            }
        }
    }

    fn set_instance(id: Option<&str>) {
        unsafe {
            match id {
                Some(v) => env::set_var(ENV_INSTANCE_ID, v),
                None => env::remove_var(ENV_INSTANCE_ID),
            }
        }
    }

    fn set_bundle(path: Option<&str>) {
        unsafe {
            match path {
                Some(v) => env::set_var(ENV_BUNDLE_PATH, v),
                None => env::remove_var(ENV_BUNDLE_PATH),
            }
        }
    }

    #[test]
    #[serial]
    fn instance_id_reads_env() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("test-id"));
        assert_eq!(instance_id().as_deref(), Some("test-id"));
    }

    #[test]
    #[serial]
    fn instance_id_none_when_unset() {
        let _g = EnvGuard::snapshot();
        set_instance(None);
        assert_eq!(instance_id(), None);
    }

    #[test]
    #[serial]
    fn instance_id_none_when_empty() {
        let _g = EnvGuard::snapshot();
        set_instance(Some(""));
        assert_eq!(instance_id(), None);
    }

    #[test]
    #[serial]
    fn data_dir_with_instance_id_uses_instances_subdir() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("debug-foo"));
        let dir = data_dir();
        assert!(
            dir.ends_with("Tug/instances/debug-foo"),
            "expected .../Tug/instances/debug-foo, got {}",
            dir.display()
        );
    }

    #[test]
    #[serial]
    fn data_dir_legacy_when_instance_id_unset() {
        let _g = EnvGuard::snapshot();
        set_instance(None);
        let dir = data_dir();
        assert!(
            dir.ends_with("Tug"),
            "expected legacy .../Tug, got {}",
            dir.display()
        );
    }

    #[test]
    #[serial]
    fn log_dir_is_under_data_dir() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("debug-bar"));
        let dir = log_dir();
        assert!(dir.ends_with("Tug/instances/debug-bar/Logs"));
    }

    #[test]
    #[serial]
    fn log_dir_legacy_when_instance_id_unset() {
        let _g = EnvGuard::snapshot();
        set_instance(None);
        let dir = log_dir();
        assert!(dir.ends_with("Tug/Logs"));
    }

    #[test]
    #[serial]
    fn tugbank_and_sessions_db_paths_none_when_unset() {
        let _g = EnvGuard::snapshot();
        set_instance(None);
        assert_eq!(tugbank_db_path(), None);
        assert_eq!(sessions_db_path(), None);
    }

    #[test]
    #[serial]
    fn tugbank_and_sessions_db_paths_some_when_set() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("debug-baz"));
        let tb = tugbank_db_path().expect("expected Some when ID set");
        let sl = sessions_db_path().expect("expected Some when ID set");
        assert!(tb.ends_with("Tug/instances/debug-baz/tugbank.db"));
        assert!(sl.ends_with("Tug/instances/debug-baz/sessions.db"));
    }

    #[test]
    #[serial]
    fn notify_socket_path_suffixed_when_id_set() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("debug-qux"));
        let sock = notify_socket_path();
        let name = sock.file_name().unwrap().to_str().unwrap();
        // Keyed on the short token, not the raw ID, so the path stays
        // under sun_path even for long IDs.
        let tok = short_token().unwrap();
        assert_eq!(name, format!("tugbank-notify-{tok}.sock"));
        // The token is fixed-width 8-hex, so the socket name length is
        // bounded regardless of how long the instance ID grows.
        assert_eq!(tok.len(), 8);
    }

    #[test]
    #[serial]
    fn short_token_and_tmux_label_track_instance_id() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("apptest-27b5400c-7d5e-4a9a-99a0-4f787deb6d80"));
        let tok = short_token().expect("token when ID set");
        assert_eq!(tok.len(), 8);
        assert_eq!(tmux_socket_label().unwrap(), format!("tug-{tok}"));
        set_instance(None);
        assert_eq!(short_token(), None);
        assert_eq!(tmux_socket_label(), None);
    }

    #[test]
    #[serial]
    fn notify_socket_path_legacy_when_id_unset() {
        let _g = EnvGuard::snapshot();
        set_instance(None);
        let sock = notify_socket_path();
        let name = sock.file_name().unwrap().to_str().unwrap();
        assert_eq!(name, "tugbank-notify.sock");
    }

    #[test]
    #[serial]
    fn bundle_path_marker_under_data_dir() {
        let _g = EnvGuard::snapshot();
        set_instance(Some("debug-marker"));
        let marker = bundle_path_marker();
        assert!(marker.ends_with("Tug/instances/debug-marker/bundle-path"));
    }

    #[test]
    #[serial]
    fn bundle_path_from_env_reads_var() {
        let _g = EnvGuard::snapshot();
        set_bundle(Some("/Applications/Tug.app"));
        assert_eq!(
            bundle_path_from_env(),
            Some(PathBuf::from("/Applications/Tug.app"))
        );
    }

    #[test]
    #[serial]
    fn bundle_path_from_env_none_when_unset_or_empty() {
        let _g = EnvGuard::snapshot();
        set_bundle(None);
        assert_eq!(bundle_path_from_env(), None);
        set_bundle(Some(""));
        assert_eq!(bundle_path_from_env(), None);
    }

    /// Redirect `data_dir()` for one test by overriding the home env
    /// variables `dirs::data_dir()` reads. On macOS `dirs` consults
    /// `HOME`; on Linux it consults `XDG_DATA_HOME`. Restoring both on
    /// drop covers either platform without conditional compilation.
    struct HomeGuard {
        home: Option<OsString>,
        xdg: Option<OsString>,
    }

    impl HomeGuard {
        fn redirect(to: &std::path::Path) -> Self {
            let g = Self {
                home: env::var_os("HOME"),
                xdg: env::var_os("XDG_DATA_HOME"),
            };
            unsafe {
                env::set_var("HOME", to);
                env::set_var("XDG_DATA_HOME", to.join(".local/share"));
            }
            g
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.home {
                    Some(v) => env::set_var("HOME", v),
                    None => env::remove_var("HOME"),
                }
                match &self.xdg {
                    Some(v) => env::set_var("XDG_DATA_HOME", v),
                    None => env::remove_var("XDG_DATA_HOME"),
                }
            }
        }
    }

    #[test]
    #[serial]
    fn write_marker_skipped_when_env_unset() {
        let _e = EnvGuard::snapshot();
        let tmp = tempfile::tempdir().unwrap();
        let _h = HomeGuard::redirect(tmp.path());
        set_instance(None);
        set_bundle(None);
        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Skipped);
        set_instance(Some("debug-foo"));
        set_bundle(None);
        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Skipped);
        set_instance(None);
        set_bundle(Some("/Applications/Tug.app"));
        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Skipped);
    }

    #[test]
    #[serial]
    fn write_marker_writes_then_no_op_on_repeat() {
        let _e = EnvGuard::snapshot();
        let tmp = tempfile::tempdir().unwrap();
        let _h = HomeGuard::redirect(tmp.path());
        set_instance(Some("debug-write"));
        set_bundle(Some("/Applications/Tug.app"));

        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Written);
        let marker = bundle_path_marker();
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            "/Applications/Tug.app"
        );

        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Unchanged);
    }

    #[test]
    #[serial]
    fn write_marker_rewrites_when_path_changes() {
        let _e = EnvGuard::snapshot();
        let tmp = tempfile::tempdir().unwrap();
        let _h = HomeGuard::redirect(tmp.path());
        set_instance(Some("debug-rewrite"));
        set_bundle(Some("/Applications/Tug.app"));
        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Written);

        set_bundle(Some("/Users/x/build/Tug.app"));
        assert_eq!(write_bundle_path_marker().unwrap(), MarkerWrite::Written);
        let marker = bundle_path_marker();
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            "/Users/x/build/Tug.app"
        );
    }
}
