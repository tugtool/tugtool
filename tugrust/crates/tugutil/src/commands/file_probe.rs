//! `tugutil file probe` — apply a patch, run a command against it, put the tree
//! back exactly as it was.
//!
//! This is the shape most shell-authored edits are actually reaching for: patch
//! a token, run one test, revert. Done in the shell that is three commands, the
//! middle one of which is unreadable to the attribution grammar and the last of
//! which (`git checkout --`) destroys any uncommitted work that was already
//! there.
//!
//! A probe that restores changed nothing, so the correct record of one is **no
//! record**: this verb prints no receipt. It goes further than that — restoring
//! the original **mtime** as well as the original bytes means the relay's
//! status+mtime worktree fingerprint reads identical before and after, so the
//! Bash bracket around the probe mints nothing either. Routing a probe through
//! this verb therefore removes a false `bash` hint that doing it by hand
//! creates.

use std::ffi::c_int;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::SystemTime;

use crate::changes::AppError;
use crate::commands::file::{absolute, normalize};

/// The running child's pid, for the signal handler to forward to. Zero when no
/// child is running.
static PROBE_CHILD: AtomicI32 = AtomicI32::new(0);

/// Forward a terminating signal to the child rather than dying on it, so the
/// wait below returns and the restore still runs. `kill` is async-signal-safe;
/// nothing else here needs to be.
extern "C" fn forward_to_child(sig: c_int) {
    let pid = PROBE_CHILD.load(Ordering::SeqCst);
    if pid > 0 {
        unsafe {
            libc::kill(pid, sig);
        }
    }
}

/// One file the probe is responsible for putting back.
struct Saved {
    /// Where it lives in the tree.
    target: PathBuf,
    /// Its bytes, held in the snapshot directory. `None` when the file did not
    /// exist — restoring it means removing whatever the patch created.
    stored: Option<PathBuf>,
    /// Its modification time, restored alongside the bytes.
    modified: Option<SystemTime>,
}

/// Every file the probe touched, and where the originals are held.
struct Snapshot {
    dir: PathBuf,
    files: Vec<Saved>,
}

impl Snapshot {
    fn take(dir: PathBuf, targets: &[PathBuf]) -> Result<Self, AppError> {
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Exit1(format!("{}: {e}", dir.display())))?;

        let mut files = Vec::new();
        for (index, target) in targets.iter().enumerate() {
            if !target.exists() {
                files.push(Saved {
                    target: target.clone(),
                    stored: None,
                    modified: None,
                });
                continue;
            }
            // Indexed rather than named after the target, so two targets with
            // the same file name cannot collide in the snapshot directory.
            let stored = dir.join(format!("{index}.orig"));
            std::fs::copy(target, &stored)
                .map_err(|e| AppError::Exit1(format!("{}: {e}", target.display())))?;
            let modified = std::fs::metadata(target).and_then(|m| m.modified()).ok();
            files.push(Saved {
                target: target.clone(),
                stored: Some(stored),
                modified,
            });
        }
        Ok(Snapshot { dir, files })
    }

    /// Put every target back byte- and mtime-identical, and remove the files the
    /// patch created. Reports every path it could not restore rather than
    /// stopping at the first.
    fn restore(&self) -> Result<(), String> {
        let mut failures = Vec::new();
        for saved in &self.files {
            match &saved.stored {
                Some(stored) => {
                    if let Err(err) = std::fs::copy(stored, &saved.target) {
                        failures.push(format!("{}: {err}", saved.target.display()));
                        continue;
                    }
                    // The mtime is not cosmetic: the relay fingerprints it, so a
                    // restored-but-touched file would still mint a hint row.
                    if let Some(when) = saved.modified {
                        let _ = std::fs::OpenOptions::new()
                            .write(true)
                            .open(&saved.target)
                            .and_then(|f| f.set_modified(when));
                    }
                }
                None => {
                    if saved.target.exists() {
                        if let Err(err) = std::fs::remove_file(&saved.target) {
                            failures.push(format!("{}: {err}", saved.target.display()));
                        }
                    }
                }
            }
        }
        if failures.is_empty() {
            let _ = std::fs::remove_dir_all(&self.dir);
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }
}

/// Holds the snapshot for the duration of the probe. `restore_now` is called on
/// every normal path; the `Drop` is the backstop for a panic, so no exit short
/// of `SIGKILL` leaves the tree carrying the patch.
struct Restorer {
    snapshot: Snapshot,
    done: bool,
}

impl Restorer {
    fn restore_now(&mut self) -> Result<(), String> {
        if self.done {
            return Ok(());
        }
        self.done = true;
        self.snapshot.restore()
    }
}

impl Drop for Restorer {
    fn drop(&mut self) {
        if let Err(err) = self.restore_now() {
            eprintln!(
                "error: probe could not restore {err}\n\
                 error: the originals are in {}",
                self.snapshot.dir.display()
            );
        }
    }
}

pub fn run_probe(
    patch: Option<String>,
    extra_paths: &[String],
    command: &[String],
) -> Result<(), AppError> {
    let Some((program, args)) = command.split_first() else {
        return Err(AppError::Exit1(
            "no command to run — pass it after `--`".to_string(),
        ));
    };

    let patch_text = match &patch {
        Some(source) => Some(read_patch(source)?),
        None => None,
    };

    let mut targets: Vec<PathBuf> = Vec::new();
    if let Some(text) = &patch_text {
        targets.extend(patch_targets(text));
    }
    for path in extra_paths {
        targets.push(absolute(Path::new(path)));
    }
    targets.sort();
    targets.dedup();

    if targets.is_empty() {
        return Err(AppError::Exit1(
            "the patch names no files and no --path was given — nothing to protect".to_string(),
        ));
    }

    // Validate before touching anything: a patch that will not apply must leave
    // the tree exactly as it found it.
    if let Some(text) = &patch_text {
        git_apply(text, true)?;
    }

    let dir = std::env::temp_dir().join(format!("tug-probe-{}", std::process::id()));
    let snapshot = Snapshot::take(dir, &targets)?;
    let mut restorer = Restorer {
        snapshot,
        done: false,
    };

    if let Some(text) = &patch_text {
        if let Err(err) = git_apply(text, false) {
            // The patch checked out and then failed anyway — restore before
            // reporting, so the caller is never handed a half-patched tree.
            restore_or_report(&mut restorer)?;
            return Err(err);
        }
    }

    let status = run_child(program, args);

    // The child is done, so the patch has served its purpose. Restore first and
    // report second: a restore failure outranks the child's own verdict.
    restore_or_report(&mut restorer)?;

    match status {
        Ok(code) if code == 0 => Ok(()),
        Ok(code) => Err(AppError::ExitStatus(code)),
        Err(err) => Err(AppError::Exit1(err)),
    }
}

fn restore_or_report(restorer: &mut Restorer) -> Result<(), AppError> {
    restorer.restore_now().map_err(|err| {
        AppError::Exit1(format!(
            "probe could not restore {err}\nthe originals are in {}",
            restorer.snapshot.dir.display()
        ))
    })
}

/// Run the command with stdio inherited — its output is its own, passed through
/// unchanged so the probe composes wherever the shell form it replaces did.
fn run_child(program: &str, args: &[String]) -> Result<u8, String> {
    let mut child = std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|e| format!("{program}: {e}"))?;

    PROBE_CHILD.store(child.id() as i32, Ordering::SeqCst);
    let previous = install_signal_handlers();

    let status = child.wait();

    restore_signal_handlers(previous);
    PROBE_CHILD.store(0, Ordering::SeqCst);

    let status = status.map_err(|e| format!("{program}: {e}"))?;
    match status.code() {
        Some(code) => Ok(code.clamp(0, 255) as u8),
        // Killed by a signal. Report the shell's convention so a ^C'd probe
        // does not read as success.
        None => Ok(130),
    }
}

fn install_signal_handlers() -> [libc::sighandler_t; 2] {
    let handler = forward_to_child as extern "C" fn(c_int) as *const () as libc::sighandler_t;
    unsafe {
        [
            libc::signal(libc::SIGINT, handler),
            libc::signal(libc::SIGTERM, handler),
        ]
    }
}

fn restore_signal_handlers(previous: [libc::sighandler_t; 2]) {
    unsafe {
        libc::signal(libc::SIGINT, previous[0]);
        libc::signal(libc::SIGTERM, previous[1]);
    }
}

/// Read the diff from a file, or from stdin when the source is `-`.
pub(super) fn read_patch(source: &str) -> Result<String, AppError> {
    if source == "-" {
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| AppError::Exit1(format!("stdin: {e}")))?;
        return Ok(buf);
    }
    std::fs::read_to_string(source).map_err(|e| AppError::Exit1(format!("{source}: {e}")))
}

/// Every path a unified diff names, resolved against the current directory —
/// which is where `git apply` resolves them too.
///
/// Both sides are read, not just `+++`: a deletion's `+++` is `/dev/null` and
/// the file that has to be protected is the one on the `---` side.
pub(super) fn patch_targets(patch: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in patch.lines() {
        let rest = match line.strip_prefix("+++ ").or_else(|| line.strip_prefix("--- ")) {
            Some(rest) => rest,
            None => continue,
        };
        // `git diff` appends a tab and a timestamp on some producers.
        let raw = rest.split('\t').next().unwrap_or(rest).trim();
        if raw.is_empty() || raw == "/dev/null" {
            continue;
        }
        // Strip the `a/` or `b/` prefix `git apply` strips by default (`-p1`).
        let stripped = match raw.split_once('/') {
            Some((_, rest)) if !rest.is_empty() => rest,
            _ => raw,
        };
        let resolved = normalize(&absolute(Path::new(stripped)));
        if !out.contains(&resolved) {
            out.push(resolved);
        }
    }
    out
}

/// Apply the diff with git, or just validate it when `check_only`.
pub(super) fn git_apply(patch: &str, check_only: bool) -> Result<(), AppError> {
    use std::io::Write;
    use std::process::Stdio;

    let mut command = std::process::Command::new("git");
    command.arg("apply");
    if check_only {
        command.arg("--check");
    }
    command
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| AppError::Exit1(format!("git apply: {e}")))?;
    child
        .stdin
        .take()
        .ok_or_else(|| AppError::Exit1("git apply: no stdin".to_string()))?
        .write_all(patch.as_bytes())
        .map_err(|e| AppError::Exit1(format!("git apply: {e}")))?;

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Exit1(format!("git apply: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Exit1(format!(
            "git apply: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_patch_names_both_sides_and_ignores_dev_null() {
        let patch = "\
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-a
+b
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+fresh
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
";
        let targets = patch_targets(patch);
        let names: Vec<String> = targets
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["x.ts", "new.ts", "gone.ts"]);
        assert!(targets.iter().all(|p| p.is_absolute()));
    }

    #[test]
    fn one_leading_component_is_stripped_exactly_as_git_apply_strips_it() {
        // `git apply` defaults to `-p1` whatever the first component is called,
        // so the snapshot has to resolve the same way or it would protect a
        // path the patch never writes.
        let targets = patch_targets("--- src/x.ts\n+++ src/x.ts\n");
        assert_eq!(targets.len(), 1);
        assert!(targets[0].ends_with("x.ts"), "got {:?}", targets[0]);
    }
}
