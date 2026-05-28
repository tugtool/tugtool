//! Per-host Tug instance registry.
//!
//! Each running tugcast writes a single JSON record into
//! `$TMPDIR/tug-instances.json` describing its identity, claimed
//! ports, and parent bundle. The registry is the authoritative
//! "what's running right now" lookup for external tools — `tugutil
//! tell`, `tugutil instance list`, and Swift's CLI-discovery path
//! all read it without re-hashing.
//!
//! # Concurrency
//!
//! Read path: open the file read-only, `flock(LOCK_SH)`, parse,
//! prune dead entries on the in-memory copy, release the lock, return
//! the live set. The on-disk file is not modified.
//!
//! Write path: open the file read-write (creating it if necessary),
//! `flock(LOCK_EX)`, read current contents, prune dead entries,
//! upsert the supplied record, serialize to `<path>.tmp`, fsync,
//! `rename(2)` over the original. The rename is atomic on POSIX so
//! a reader cannot observe a half-written file. See [Q01] for the
//! decision rationale.
//!
//! # Liveness
//!
//! "Live" means `kill(pid, 0) == 0`. A `ESRCH` reply means the PID is
//! gone (process exited, system rebooted, …) and the entry is pruned.
//!
//! See [`#registry-format`](roadmap/tug-multi-instance.md#registry-format)
//! for the on-disk schema.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Filename used inside the per-user runtime directory.
pub const REGISTRY_FILENAME: &str = "tug-instances.json";

/// Current on-disk schema version. Bumped only on incompatible
/// changes; readers tolerate forward-compatible additions inside the
/// `Instance` record.
pub const REGISTRY_VERSION: u32 = 1;

/// A single registered tugcast instance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Instance {
    /// Canonical per-instance identifier (`<profile>-<branch-slug>`).
    pub instance_id: String,
    /// Build profile (`production` or `development`).
    pub profile: String,
    /// Branch the bundle was built from.
    pub branch: String,
    /// `CFBundleIdentifier` of the parent app bundle.
    pub bundle_id: String,
    /// Absolute path to the parent app bundle.
    pub bundle_path: PathBuf,
    /// Tugcast process PID.
    pub pid: i32,
    /// TCP port tugcast bound for HTTP/WS.
    pub tugcast_port: u16,
    /// TCP port Vite bound (or `0` when Vite is not running).
    pub vite_port: u16,
    /// Tmux session name tugcast attached to.
    pub tmux_session: String,
    /// Per-instance data directory.
    pub data_dir: PathBuf,
    /// ISO-8601 UTC timestamp of registration.
    pub started_at: String,
}

/// On-disk schema. Wrapped so the version is explicit.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OnDisk {
    version: u32,
    #[serde(default)]
    instances: Vec<Instance>,
}

impl Default for OnDisk {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            instances: Vec::new(),
        }
    }
}

/// Errors that can be returned by registry operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported registry version {0} (this build understands {REGISTRY_VERSION})")]
    UnsupportedVersion(u32),
}

/// Resolve the registry file path.
///
/// Lives next to other runtime sockets in `$TMPDIR` so the registry
/// is per-user and per-host. `$TMPDIR` is the macOS per-user runtime
/// directory; on Linux it resolves via `std::env::temp_dir`.
pub fn registry_path() -> PathBuf {
    std::env::temp_dir().join(REGISTRY_FILENAME)
}

/// Read all live instances. Returns an empty vec when the file does
/// not yet exist.
pub fn load() -> Result<Vec<Instance>, Error> {
    load_from(&registry_path())
}

/// Read live instances from an arbitrary registry path. Public for
/// tests; production code uses [`load`].
pub fn load_from(path: &Path) -> Result<Vec<Instance>, Error> {
    let file = match OpenOptions::new().read(true).open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let _guard = LockGuard::shared(&file)?;
    let on_disk = read_on_disk(&file)?;
    Ok(on_disk
        .instances
        .into_iter()
        .filter(|i| is_pid_live(i.pid))
        .collect())
}

/// Find the live instance with `instance_id`, if any.
pub fn find_by_id(instance_id: &str) -> Result<Option<Instance>, Error> {
    Ok(load()?.into_iter().find(|i| i.instance_id == instance_id))
}

/// Find the live instance whose `bundle_path` is an ancestor of `cwd`.
///
/// Used by `tugutil tell` when no `--instance` flag is passed and the
/// shell is inside a worktree owned by a running dev instance. The
/// match is purely path-prefix based; the more sophisticated CLI
/// discovery resolution in [D09] layers on top of this primitive.
pub fn find_for_cwd(cwd: &Path) -> Result<Option<Instance>, Error> {
    let cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    Ok(load()?
        .into_iter()
        .find(|i| cwd.starts_with(&i.bundle_path) || i.bundle_path.starts_with(&cwd)))
}

/// Alias for [`load`] — every instance returned by `load` is live by
/// definition. Provided so call sites can read more naturally.
pub fn list_live() -> Result<Vec<Instance>, Error> {
    load()
}

/// Upsert `instance` into the registry.
///
/// Replaces any existing entry that shares `instance.instance_id` —
/// e.g. a record left behind by a crashed predecessor whose PID has
/// since been recycled. The write is atomic; readers see either the
/// pre-call or post-call snapshot, never a partial write.
pub fn register(instance: Instance) -> Result<(), Error> {
    register_at(&registry_path(), instance)
}

/// Same as [`register`] but targets an arbitrary path. Tests use this
/// to avoid touching the real `$TMPDIR/tug-instances.json`.
pub fn register_at(path: &Path, instance: Instance) -> Result<(), Error> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    let _guard = LockGuard::exclusive(&file)?;

    let mut on_disk = read_on_disk(&file).unwrap_or_default();
    on_disk.version = REGISTRY_VERSION;
    on_disk.instances.retain(|i| {
        // Drop any prior entry for this identity AND any entry whose
        // PID no longer exists. The combination keeps the file small
        // and the listing accurate after a crash-and-recover cycle.
        i.instance_id != instance.instance_id && is_pid_live(i.pid)
    });
    on_disk.instances.push(instance);

    write_atomically(path, &on_disk)
}

/// Remove the entry whose `instance_id` matches, if present.
///
/// Used during graceful shutdown so a `tugutil instance list`
/// immediately after the crash window does not show a stale entry
/// that would otherwise survive until the next register cycle.
pub fn unregister(instance_id: &str) -> Result<(), Error> {
    unregister_at(&registry_path(), instance_id)
}

/// Same as [`unregister`] but targets an arbitrary path.
pub fn unregister_at(path: &Path, instance_id: &str) -> Result<(), Error> {
    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let _guard = LockGuard::exclusive(&file)?;
    let mut on_disk = read_on_disk(&file).unwrap_or_default();
    on_disk.version = REGISTRY_VERSION;
    let before = on_disk.instances.len();
    on_disk
        .instances
        .retain(|i| i.instance_id != instance_id && is_pid_live(i.pid));
    if on_disk.instances.len() == before
        && !on_disk
            .instances
            .iter()
            .any(|i| i.instance_id == instance_id)
    {
        // Nothing changed semantically; skip the rewrite to keep
        // mtime stable for observers.
        return Ok(());
    }
    write_atomically(path, &on_disk)
}

// ── Internals ────────────────────────────────────────────────────────────────

fn read_on_disk(mut file: &File) -> Result<OnDisk, Error> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    if bytes.is_empty() {
        return Ok(OnDisk::default());
    }
    let parsed: OnDisk = serde_json::from_slice(&bytes)?;
    if parsed.version != REGISTRY_VERSION {
        return Err(Error::UnsupportedVersion(parsed.version));
    }
    Ok(parsed)
}

fn write_atomically(path: &Path, on_disk: &OnDisk) -> Result<(), Error> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut tmp_file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        let bytes = serde_json::to_vec_pretty(on_disk)?;
        tmp_file.write_all(&bytes)?;
        tmp_file.write_all(b"\n")?;
        tmp_file.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn is_pid_live(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // `kill(pid, 0)` is the canonical "does this PID exist" probe
    // on POSIX: it sends no signal but returns ESRCH iff the PID
    // is gone. EPERM also implies "exists" (we're not allowed to
    // signal it, but the process is there).
    let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if ret == 0 {
        return true;
    }
    let err = std::io::Error::last_os_error();
    err.raw_os_error() == Some(libc::EPERM)
}

/// RAII guard around an advisory file lock. Drops the lock when the
/// guard goes out of scope so panics, early returns, and `?`s all
/// release cleanly.
struct LockGuard<'a> {
    file: &'a File,
}

impl<'a> LockGuard<'a> {
    fn shared(file: &'a File) -> std::io::Result<Self> {
        flock(file, libc::LOCK_SH)?;
        Ok(Self { file })
    }

    fn exclusive(file: &'a File) -> std::io::Result<Self> {
        flock(file, libc::LOCK_EX)?;
        Ok(Self { file })
    }
}

impl Drop for LockGuard<'_> {
    fn drop(&mut self) {
        let _ = flock(self.file, libc::LOCK_UN);
    }
}

fn flock(file: &File, op: i32) -> std::io::Result<()> {
    // SAFETY: `file.as_raw_fd()` is a valid borrowed fd for the
    // lifetime of `file`; `flock` only stores the lock in the kernel
    // and does not retain the fd.
    let ret = unsafe { libc::flock(file.as_raw_fd(), op) };
    if ret == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// Format a UTC RFC-3339 / ISO-8601 timestamp for the `started_at`
/// field. Free function so external callers do not need to take a
/// dependency on chrono to build an `Instance`.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::tempdir;

    fn fixture(instance_id: &str, pid: i32) -> Instance {
        Instance {
            instance_id: instance_id.to_owned(),
            profile: "development".to_owned(),
            branch: instance_id.trim_start_matches("development-").to_owned(),
            bundle_id: format!("dev.tugtool.app.{instance_id}"),
            bundle_path: PathBuf::from("/tmp/Tug.app"),
            pid,
            tugcast_port: 55300,
            vite_port: 55200,
            tmux_session: format!("cc-{instance_id}"),
            data_dir: PathBuf::from(format!("/tmp/data/{instance_id}")),
            started_at: now_rfc3339(),
        }
    }

    /// `kill(pid, 0)` against PID 1 is guaranteed to exist on POSIX
    /// (it's launchd / init) but the current process can't actually
    /// signal it — exercising the EPERM branch of `is_pid_live`.
    const ALIVE_PID: i32 = 1;
    const DEAD_PID: i32 = 0x3FFF_FFFE; // very unlikely to exist

    #[test]
    fn is_pid_live_recognises_init() {
        assert!(is_pid_live(ALIVE_PID));
    }

    #[test]
    fn is_pid_live_rejects_zero_or_negative() {
        assert!(!is_pid_live(0));
        assert!(!is_pid_live(-1));
    }

    #[test]
    fn round_trip_empty_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        // No file yet — load returns empty.
        assert!(load_from(&path).unwrap().is_empty());
    }

    #[test]
    fn register_then_find() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        register_at(&path, fixture("development-foo", ALIVE_PID)).unwrap();
        let listed = load_from(&path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].instance_id, "development-foo");
    }

    #[test]
    fn register_replaces_existing_id() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        let mut a = fixture("development-foo", ALIVE_PID);
        a.tugcast_port = 55310;
        register_at(&path, a).unwrap();

        let mut b = fixture("development-foo", ALIVE_PID);
        b.tugcast_port = 55320;
        register_at(&path, b).unwrap();

        let listed = load_from(&path).unwrap();
        assert_eq!(listed.len(), 1, "expected upsert, got {listed:?}");
        assert_eq!(listed[0].tugcast_port, 55320);
    }

    #[test]
    fn load_prunes_dead_pids_in_memory() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        // Write a dead entry directly (bypassing register, which
        // would prune at write time too).
        let on_disk = OnDisk {
            version: REGISTRY_VERSION,
            instances: vec![fixture("development-foo", DEAD_PID)],
        };
        write_atomically(&path, &on_disk).unwrap();

        let listed = load_from(&path).unwrap();
        assert!(listed.is_empty(), "dead PID should be pruned");
        // The on-disk copy is untouched by a read-only load.
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("development-foo"));
    }

    #[test]
    fn register_prunes_dead_predecessors() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        let on_disk = OnDisk {
            version: REGISTRY_VERSION,
            instances: vec![
                fixture("development-foo", DEAD_PID),
                fixture("development-bar", DEAD_PID),
            ],
        };
        write_atomically(&path, &on_disk).unwrap();

        register_at(&path, fixture("development-baz", ALIVE_PID)).unwrap();

        let listed = load_from(&path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].instance_id, "development-baz");

        // After the write the dead entries should be physically gone.
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("development-foo"));
        assert!(!raw.contains("development-bar"));
    }

    #[test]
    fn unregister_removes_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        register_at(&path, fixture("development-foo", ALIVE_PID)).unwrap();
        register_at(&path, fixture("development-bar", ALIVE_PID)).unwrap();
        unregister_at(&path, "development-foo").unwrap();

        let listed = load_from(&path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].instance_id, "development-bar");
    }

    #[test]
    fn unregister_missing_is_noop() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        unregister_at(&path, "development-foo").unwrap();
        assert!(load_from(&path).unwrap().is_empty());
    }

    #[test]
    fn load_returns_unsupported_version_error() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("reg.json");
        std::fs::write(&path, br#"{"version": 9999, "instances": []}"#).unwrap();
        match load_from(&path) {
            Err(Error::UnsupportedVersion(9999)) => {}
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[test]
    fn now_rfc3339_parses() {
        let s = now_rfc3339();
        chrono::DateTime::parse_from_rfc3339(&s).expect("parses");
    }

    /// `find_by_id` and `find_for_cwd` go through the public
    /// `registry_path()` so they touch the user's real `$TMPDIR`
    /// file. Serialize and snapshot so we don't leak state across
    /// runs.
    #[test]
    #[serial]
    fn find_by_id_round_trip_in_tmpdir() {
        let real = registry_path();
        let backup = std::fs::read(&real).ok();
        let _restore = scopeguard(|| match &backup {
            Some(bytes) => {
                let _ = std::fs::write(&real, bytes);
            }
            None => {
                let _ = std::fs::remove_file(&real);
            }
        });

        register(fixture("development-find-by-id-test", ALIVE_PID)).unwrap();
        let got = find_by_id("development-find-by-id-test").unwrap();
        assert!(got.is_some());
        unregister("development-find-by-id-test").unwrap();
    }

    /// Tiny scoped-defer helper: returns a guard that runs `f` on
    /// drop. Local to this module to keep the public API surface
    /// clean.
    struct Guard<F: FnMut()>(Option<F>);
    impl<F: FnMut()> Drop for Guard<F> {
        fn drop(&mut self) {
            if let Some(mut f) = self.0.take() {
                f();
            }
        }
    }
    fn scopeguard<F: FnMut()>(f: F) -> Guard<F> {
        Guard(Some(f))
    }
}
