//! PathResolver — robust path resolution for file watching.
//!
//! Resolves a user-provided directory path to the form that the OS file
//! watching API (FSEvents on macOS, inotify on Linux) actually accepts.
//! Handles symlinks, synthetic firmlinks (macOS synthetic.conf), APFS
//! firmlinks (/System/Volumes/Data ↔ /Users), and Linux bind mounts.
//!
//! Uses (device, inode) as the fundamental identity — the only reliable
//! way to determine that two paths refer to the same directory.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tracing::{debug, info};

/// Resolved path information for a watch directory.
pub struct PathResolver {
    /// The original path as provided by the caller.
    original: PathBuf,
    /// The resolved path to register with FSEvents/inotify.
    /// This is the form that actually produces events.
    primary: PathBuf,
    /// (device, inode) identity of the watch directory.
    #[cfg(unix)]
    identity: (u64, u64),
    /// Alternative path forms discovered during resolution or lazily at
    /// runtime. Used as fallbacks for strip_prefix when event paths use
    /// an unexpected form.
    alt_prefixes: Mutex<Vec<PathBuf>>,
    /// Whether the watch path is under an autofs mount (macOS).
    #[allow(dead_code)]
    pub is_autofs: bool,
}

impl PathResolver {
    /// Create a resolver from a user-provided path.
    ///
    /// Resolves through symlinks, synthetic firmlinks (macOS), APFS data
    /// volume firmlinks, and Linux bind mounts to find the form that the
    /// OS file watching API accepts. All resolution is verified with
    /// (dev, ino) identity comparison.
    pub fn new(path: PathBuf) -> Self {
        #[cfg(unix)]
        let identity = get_identity(&path).unwrap_or((0, 0));

        let mut seen = HashSet::new();
        seen.insert(path.clone());

        // Phase 1: resolve symlinks via canonicalize.
        let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
        seen.insert(canonical.clone());

        // Phase 2: resolve synthetic firmlinks (macOS).
        #[cfg(target_os = "macos")]
        let synthetic_resolved = resolve_synthetic(&path);
        #[cfg(not(target_os = "macos"))]
        let synthetic_resolved: Option<PathBuf> = None;

        if let Some(ref sr) = synthetic_resolved {
            seen.insert(sr.clone());
        }

        // Phase 3: resolve APFS data volume firmlinks (macOS).
        #[cfg(target_os = "macos")]
        let firmlink_resolved = resolve_apfs_firmlink(&canonical);
        #[cfg(not(target_os = "macos"))]
        let firmlink_resolved: Option<PathBuf> = None;

        if let Some(ref fr) = firmlink_resolved {
            seen.insert(fr.clone());
        }

        // Phase 4: resolve Linux bind mounts.
        #[cfg(target_os = "linux")]
        let bind_resolved = resolve_bind_mounts(&path);
        #[cfg(not(target_os = "linux"))]
        let bind_resolved: Option<PathBuf> = None;

        if let Some(ref br) = bind_resolved {
            seen.insert(br.clone());
        }

        // Choose the primary (the form to register with the watcher).
        // Priority: synthetic-resolved > firmlink-resolved > canonical > original.
        let primary = synthetic_resolved
            .clone()
            .or(firmlink_resolved.clone())
            .unwrap_or_else(|| canonical.clone());

        // Build alt_prefixes from all discovered forms except the primary.
        let alt_prefixes: Vec<PathBuf> = seen.into_iter().filter(|p| *p != primary).collect();

        // Check for autofs.
        #[cfg(target_os = "macos")]
        let is_autofs = check_autofs(&primary);
        #[cfg(not(target_os = "macos"))]
        let is_autofs = false;

        info!(
            original = %path.display(),
            primary = %primary.display(),
            alt_count = alt_prefixes.len(),
            is_autofs,
            "PathResolver initialized"
        );
        for alt in &alt_prefixes {
            debug!(alt = %alt.display(), "PathResolver alt prefix");
        }

        Self {
            original: path,
            primary,
            #[cfg(unix)]
            identity,
            alt_prefixes: Mutex::new(alt_prefixes),
            is_autofs,
        }
    }

    /// The resolved path to register with FSEvents/inotify.
    pub fn watch_path(&self) -> &Path {
        &self.primary
    }

    /// The original path as provided by the caller.
    #[allow(dead_code)]
    pub fn original_path(&self) -> &Path {
        &self.original
    }

    /// Convert an absolute event path to a relative path string.
    ///
    /// Tries strip_prefix against all known path forms (fast path), then
    /// falls back to inode-based resolution for unknown forms.
    pub fn to_relative(&self, abs_path: &Path) -> Option<String> {
        // Fast path: try primary.
        if let Ok(rel) = abs_path.strip_prefix(&self.primary) {
            return Some(rel.to_string_lossy().to_string());
        }

        // Try alt prefixes.
        if let Ok(alts) = self.alt_prefixes.lock() {
            for alt in alts.iter() {
                if let Ok(rel) = abs_path.strip_prefix(alt) {
                    return Some(rel.to_string_lossy().to_string());
                }
            }
        }

        // Slow path: inode-based resolution.
        #[cfg(unix)]
        if let Some(discovered) = self.resolve_by_inode(abs_path) {
            if let Ok(rel) = abs_path.strip_prefix(&discovered) {
                if let Ok(mut alts) = self.alt_prefixes.lock() {
                    if !alts.contains(&discovered) {
                        info!(
                            discovered = %discovered.display(),
                            "PathResolver discovered alt prefix via inode"
                        );
                        alts.push(discovered);
                    }
                }
                return Some(rel.to_string_lossy().to_string());
            }
        }

        // For removed files: try the parent (file is gone, can't stat it).
        if let (Some(parent), Some(file_name)) = (abs_path.parent(), abs_path.file_name()) {
            if let Some(rel_parent) = self.to_relative(parent) {
                let rel = PathBuf::from(rel_parent).join(file_name);
                return Some(rel.to_string_lossy().to_string());
            }
        }

        None
    }

    /// Walk up the path's parent chain looking for a directory with the
    /// same (device, inode) as our watch directory.
    #[cfg(unix)]
    fn resolve_by_inode(&self, path: &Path) -> Option<PathBuf> {
        let (target_dev, target_ino) = self.identity;
        if target_dev == 0 && target_ino == 0 {
            return None;
        }

        let mut ancestor = path.to_path_buf();
        loop {
            if !ancestor.pop() {
                return None;
            }
            if let Some(id) = get_identity(&ancestor) {
                if id == (target_dev, target_ino) {
                    return Some(ancestor);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn get_identity(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.dev(), meta.ino()))
}

#[cfg(unix)]
#[allow(dead_code)] // used only from #[cfg(target_os = "macos")] functions
fn same_identity(a: &Path, b: &Path) -> bool {
    match (get_identity(a), get_identity(b)) {
        (Some(ia), Some(ib)) => ia == ib,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// macOS: synthetic.conf resolution
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn resolve_synthetic(path: &Path) -> Option<PathBuf> {
    let conf = std::fs::read_to_string("/etc/synthetic.conf").ok()?;
    let path_str = path.to_str()?;

    for line in conf.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let syn_root = format!("/{}", parts[0]);
        let target = parts[1].trim();

        if path_str == syn_root || path_str.starts_with(&format!("{}/", syn_root)) {
            let rest = &path_str[syn_root.len()..];
            let resolved_target =
                resolve_apfs_firmlink_str(target).unwrap_or_else(|| target.to_string());
            let full = format!("{}{}", resolved_target, rest);
            let full_path = PathBuf::from(&full);

            if full_path.exists() && same_identity(path, &full_path) {
                return Some(full_path);
            }

            let fallback = PathBuf::from(format!("{}{}", target, rest));
            if fallback.exists() && same_identity(path, &fallback) {
                return Some(fallback);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// macOS: APFS firmlink resolution
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn resolve_apfs_firmlink(path: &Path) -> Option<PathBuf> {
    let path_str = path.to_str()?;
    let resolved = resolve_apfs_firmlink_str(path_str)?;
    let resolved_path = PathBuf::from(&resolved);
    if resolved_path.exists() && same_identity(path, &resolved_path) {
        Some(resolved_path)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn resolve_apfs_firmlink_str(path_str: &str) -> Option<String> {
    let prefix = "/System/Volumes/Data";
    if let Some(without) = path_str.strip_prefix(prefix) {
        if !without.is_empty() && Path::new(without).exists() {
            return Some(without.to_string());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// macOS: autofs detection
// ---------------------------------------------------------------------------

/// Check whether a path is under an autofs mount using statfs(2).
#[cfg(target_os = "macos")]
fn check_autofs(path: &Path) -> bool {
    use std::ffi::CString;
    let c_path = match CString::new(path.to_string_lossy().as_bytes()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    unsafe {
        let mut stat: libc::statfs = std::mem::zeroed();
        if libc::statfs(c_path.as_ptr(), &mut stat) == 0 {
            // autofs filesystem type name on macOS
            let fstypename = std::ffi::CStr::from_ptr(stat.f_fstypename.as_ptr());
            if let Ok(name) = fstypename.to_str() {
                return name == "autofs";
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Linux: bind mount resolution
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn resolve_bind_mounts(path: &Path) -> Option<PathBuf> {
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").ok()?;

    for line in mountinfo.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        let mount_point = fields[4];
        if path.starts_with(mount_point) && mount_point != "/" {
            let dev = fields[2];
            for other_line in mountinfo.lines() {
                let other_fields: Vec<&str> = other_line.split_whitespace().collect();
                if other_fields.len() < 5 {
                    continue;
                }
                if other_fields[2] == dev && other_fields[4] != mount_point {
                    let alt_mount = other_fields[4];
                    let rest = path.strip_prefix(mount_point).ok()?;
                    let alt_path = PathBuf::from(alt_mount).join(rest);
                    if alt_path.exists() && same_identity(path, &alt_path) {
                        return Some(alt_path);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
fn resolve_bind_mounts(_path: &Path) -> Option<PathBuf> {
    None
}
