//! The join conflict resolution ladder ([P31]).
//!
//! A conflicted join is not a dead end. This module works the conflict as hard
//! as it can **off to the side** — never touching the user's checkouts — and,
//! when every file resolves, hands back a pre-built candidate commit for
//! [`crate::ops::join_in`] to fast-forward the base onto ([P31], Spec S12). The
//! rungs, in order:
//!
//! 1. **Replay probe** — replay the dash's rounds one at a time in memory
//!    (`merge-tree --merge-base=<round^>` + `commit-tree`, git ≥ 2.40); a clean
//!    replay lands as the replayed rounds (shape change accepted).
//! 2. **rerere** — a scratch detached worktree replays previously recorded
//!    conflict resolutions (shared `rr-cache`).
//! 3. **merge-file** — an opportunistic per-file 3-way re-merge (histogram).
//! 4. **structured-merge driver** — a PATH-discovered, configurable command
//!    (mergiraf by default), never bundled.
//! 5. **AI** ([P32]) — the [`FileMerger`] seam; tugcast injects the scribe, the
//!    CLI passes `None`.
//!
//! Every rung's per-file outcome is recorded so callers can report exactly what
//! happened. Non-content conflicts (delete/modify, binary, mode) short-circuit
//! straight to unresolved — text tools never guess at structure.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::ops::{
    branch_exists, branch_name, commit_worktree_dirt, dash_base, git_output, git_stdout,
    integrate_message, worktree_path,
};

/// Which rung resolved a file ([P31]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolvedBy {
    /// The whole dash replayed clean; no per-file work (shape = replay).
    Replay,
    /// A previously recorded `rerere` resolution replayed.
    Rerere,
    /// `git merge-file` re-merged the three blobs cleanly.
    MergeFile,
    /// A structured-merge driver (mergiraf or a configured command) resolved it.
    Driver,
    /// The AI file-merge seam ([P32]) produced a validated result.
    Ai,
}

/// One conflicted file's three blob stages plus the dash's intent, handed to the
/// AI rung ([P32]). `base` is `None` for an add/add conflict.
pub struct FileMergeRequest {
    pub path: String,
    pub base: Option<Vec<u8>>,
    pub ours: Option<Vec<u8>>,
    pub theirs: Option<Vec<u8>>,
    /// The dash's maintained draft + round subjects — what the dash was doing.
    pub intent: String,
}

/// The AI rung's seam ([P32]). tugcast implements it with the scribe sidecar;
/// the `tugdash` CLI passes `None`. A `None` return leaves the file unresolved.
pub trait FileMerger: Send + Sync {
    fn merge(&self, req: &FileMergeRequest) -> Option<Vec<u8>>;
}

/// One file's resolution, for reporting.
#[derive(Debug, Clone, Serialize)]
pub struct FileResolution {
    pub path: String,
    pub resolved_by: ResolvedBy,
}

/// The shape the join will land as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JoinShape {
    Squash,
    Replay,
}

/// The ladder's outcome. `candidate_commit` is present iff every conflict
/// resolved (the pre-built join commit, or the replayed head); when any file
/// stays unresolved it is `None` and `unresolved` names them.
#[derive(Debug, Clone, Serialize)]
pub struct ResolveOutcome {
    pub shape: JoinShape,
    pub resolved: Vec<FileResolution>,
    pub unresolved: Vec<String>,
    pub candidate_commit: Option<String>,
    pub base_branch: String,
    pub warnings: Vec<String>,
}

/// Like [`resolve_conflicts`], but discovering the repo root from the process
/// cwd (the `tugdash` CLI entry point).
pub fn resolve_conflicts_cwd(
    name: &str,
    merger: Option<&dyn FileMerger>,
) -> Result<ResolveOutcome, String> {
    let repo = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;
    resolve_conflicts(&repo, name, merger)
}

/// Run the resolution ladder against a dash's current conflict set ([P31]).
///
/// Commits outstanding dash-worktree dirt first (so the branch tip is the real
/// state), then walks the rungs. Never touches the base or dash checkouts — a
/// candidate commit is built off to the side and landed separately by
/// [`crate::ops::join_in`] with the staleness guard.
pub fn resolve_conflicts(
    repo: &Path,
    name: &str,
    merger: Option<&dyn FileMerger>,
) -> Result<ResolveOutcome, String> {
    let branch = branch_name(name);
    if !branch_exists(repo, &branch) {
        return Err(format!("Dash not found: {}", name));
    }
    let base_branch = dash_base(repo, name)?;
    let worktree = worktree_path(repo, name);
    let mut warnings = Vec::new();

    // Preamble: the tip must reflect the dash's real state before we resolve.
    commit_worktree_dirt(&worktree)?;

    let base_head = git_stdout(repo, &["rev-parse", &base_branch])?;

    // Rung 1 — replay probe (in-memory per round; git ≥ 2.40).
    if let Some(candidate) = replay_probe(repo, &base_head, &base_branch, &branch)? {
        return Ok(ResolveOutcome {
            shape: JoinShape::Replay,
            resolved: Vec::new(),
            unresolved: Vec::new(),
            candidate_commit: Some(candidate),
            base_branch,
            warnings,
        });
    }

    // The squash conflict set: candidate tree (markers baked in) + per-path
    // stage blobs.
    let (cand_tree, stages) = merge_tree_stages(repo, &base_branch, &branch)?;
    let msg = integrate_message(repo, name, &branch, None);

    if stages.is_empty() {
        // The one-shot squash is actually clean — commit its tree directly.
        let candidate = commit_tree(repo, &cand_tree, &base_head, &msg)?;
        return Ok(ResolveOutcome {
            shape: JoinShape::Squash,
            resolved: Vec::new(),
            unresolved: Vec::new(),
            candidate_commit: Some(candidate),
            base_branch,
            warnings,
        });
    }

    // Rungs 2–5, per file. A scratch tempdir holds the merge-file / driver
    // working files; the rerere rung has its own scratch worktree.
    let scratch = tempfile::tempdir().map_err(|e| format!("resolve: tempdir: {}", e))?;
    let intent = resolve_intent(repo, &base_branch, &branch);

    let rerere_resolved = rerere_rung(repo, &base_head, &branch, &stages, &mut warnings);

    let mut resolved: Vec<ResolvedFile> = Vec::new();
    let mut unresolved: Vec<String> = Vec::new();

    for (path, raw) in &stages {
        // Recorded resolution replayed by rerere.
        if let Some(oid) = rerere_resolved.get(path) {
            resolved.push(ResolvedFile {
                path: path.clone(),
                by: ResolvedBy::Rerere,
                blob_oid: oid.clone(),
                mode: raw.merged_mode(),
            });
            continue;
        }

        // Load the three blobs; non-content conflicts short-circuit.
        let loaded = match raw.load(repo) {
            Some(l) => l,
            None => {
                unresolved.push(path.clone());
                continue;
            }
        };

        // Rung 3 — opportunistic merge-file re-merge.
        if let Some(bytes) = merge_file_rung(scratch.path(), path, &loaded) {
            let oid = hash_blob(repo, &bytes)?;
            resolved.push(ResolvedFile {
                path: path.clone(),
                by: ResolvedBy::MergeFile,
                blob_oid: oid,
                mode: raw.merged_mode(),
            });
            continue;
        }

        // Rung 4 — structured-merge driver.
        if let Some(bytes) = driver_rung(repo, scratch.path(), path, &loaded) {
            let oid = hash_blob(repo, &bytes)?;
            resolved.push(ResolvedFile {
                path: path.clone(),
                by: ResolvedBy::Driver,
                blob_oid: oid,
                mode: raw.merged_mode(),
            });
            continue;
        }

        // Rung 5 — AI.
        if let Some(m) = merger {
            let req = FileMergeRequest {
                path: path.clone(),
                base: loaded.base.clone(),
                ours: loaded.ours.clone(),
                theirs: loaded.theirs.clone(),
                intent: intent.clone(),
            };
            if let Some(bytes) = m.merge(&req) {
                if is_clean_merge(&bytes) {
                    let oid = hash_blob(repo, &bytes)?;
                    resolved.push(ResolvedFile {
                        path: path.clone(),
                        by: ResolvedBy::Ai,
                        blob_oid: oid,
                        mode: raw.merged_mode(),
                    });
                    continue;
                }
            }
        }

        unresolved.push(path.clone());
    }

    // Teach rerere the resolutions it didn't already know (driver/AI), so an
    // identical future conflict skips the expensive rungs ([P31]). Best-effort.
    let taught: Vec<&ResolvedFile> = resolved
        .iter()
        .filter(|r| matches!(r.by, ResolvedBy::Driver | ResolvedBy::Ai))
        .collect();
    if !taught.is_empty() {
        record_rerere(repo, &base_head, &branch, &taught, &mut warnings);
    }

    let resolved_report: Vec<FileResolution> = resolved
        .iter()
        .map(|r| FileResolution {
            path: r.path.clone(),
            resolved_by: r.by,
        })
        .collect();

    if !unresolved.is_empty() {
        return Ok(ResolveOutcome {
            shape: JoinShape::Squash,
            resolved: resolved_report,
            unresolved,
            candidate_commit: None,
            base_branch,
            warnings,
        });
    }

    // Everything resolved — patch the candidate tree and build the commit.
    let final_tree = patch_tree(repo, scratch.path(), &cand_tree, &resolved)?;
    let candidate = commit_tree(repo, &final_tree, &base_head, &msg)?;

    Ok(ResolveOutcome {
        shape: JoinShape::Squash,
        resolved: resolved_report,
        unresolved: Vec::new(),
        candidate_commit: Some(candidate),
        base_branch,
        warnings,
    })
}

// ---------------------------------------------------------------------------
// Rung 1 — replay probe
// ---------------------------------------------------------------------------

/// Replay the dash's rounds one at a time onto the current base, in memory
/// (`merge-tree --merge-base=<round^>` + `commit-tree`). Returns the replayed
/// head when every round is clean, else `None` (a conflicting round, no rounds,
/// or git < 2.40). Touches nothing.
fn replay_probe(
    repo: &Path,
    base_head: &str,
    base_branch: &str,
    branch: &str,
) -> Result<Option<String>, String> {
    if !git_supports_merge_base_flag(repo) {
        return Ok(None);
    }
    let rounds_out = git_stdout(
        repo,
        &[
            "rev-list",
            "--reverse",
            &format!("{}..{}", base_branch, branch),
        ],
    )?;
    let rounds: Vec<&str> = rounds_out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();
    if rounds.is_empty() {
        return Ok(None);
    }

    let mut acc = base_head.to_string();
    for round in rounds {
        let parent = format!("{}^", round);
        let out = git_output(
            repo,
            &[
                "merge-tree",
                "--write-tree",
                &format!("--merge-base={}", parent),
                &acc,
                round,
            ],
        )?;
        if !out.status.success() {
            // A round conflicts against the running base — probe fails.
            return Ok(None);
        }
        let tree = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let msg = git_stdout(repo, &["log", "-1", "--format=%B", round])?;
        acc = commit_tree(repo, &tree, &acc, &msg)?;
    }
    Ok(Some(acc))
}

/// Whether `git` here supports `merge-tree --merge-base` (git ≥ 2.40).
fn git_supports_merge_base_flag(repo: &Path) -> bool {
    let out = git_stdout(repo, &["--version"]).unwrap_or_default();
    let ver = out.split_whitespace().nth(2).unwrap_or("");
    let mut parts = ver.split('.');
    let major: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    major > 2 || (major == 2 && minor >= 40)
}

// ---------------------------------------------------------------------------
// merge-tree stage parsing
// ---------------------------------------------------------------------------

/// The raw (mode, oid) of each present stage for one conflicted path.
#[derive(Default, Clone)]
struct RawStages {
    base: Option<(String, String)>,   // stage 1
    ours: Option<(String, String)>,   // stage 2
    theirs: Option<(String, String)>, // stage 3
}

/// The three loaded blob bodies for a content conflict.
struct LoadedStages {
    base: Option<Vec<u8>>,
    ours: Option<Vec<u8>>,
    theirs: Option<Vec<u8>>,
}

impl RawStages {
    /// The mode the merged file should carry (the ours-stage mode, else theirs).
    fn merged_mode(&self) -> String {
        self.ours
            .as_ref()
            .or(self.theirs.as_ref())
            .map(|(m, _)| m.clone())
            .unwrap_or_else(|| "100644".to_string())
    }

    /// Load the blob bodies, or `None` when this is a **non-content** conflict:
    /// a delete/modify (missing ours or theirs stage), a mode conflict (ours and
    /// theirs modes differ), or a binary file (a NUL byte in any stage). Text
    /// rungs never touch these.
    fn load(&self, repo: &Path) -> Option<LoadedStages> {
        let ours = self.ours.as_ref()?;
        let theirs = self.theirs.as_ref()?;
        if ours.0 != theirs.0 {
            return None; // mode conflict
        }
        let base = match &self.base {
            Some((_, oid)) => Some(cat_blob(repo, oid).ok()?),
            None => None,
        };
        let ours_b = cat_blob(repo, &ours.1).ok()?;
        let theirs_b = cat_blob(repo, &theirs.1).ok()?;
        if is_binary(&ours_b) || is_binary(&theirs_b) || base.as_deref().is_some_and(is_binary) {
            return None;
        }
        Some(LoadedStages {
            base,
            ours: Some(ours_b),
            theirs: Some(theirs_b),
        })
    }
}

/// Parse `git merge-tree --write-tree -z <base> <branch>`: the toplevel tree OID
/// plus the per-path stage entries. An empty split field ends the
/// conflicted-file-info section; the informational messages after it are
/// ignored. A clean merge yields an empty stage map.
fn merge_tree_stages(
    repo: &Path,
    base: &str,
    branch: &str,
) -> Result<(String, BTreeMap<String, RawStages>), String> {
    let out = git_output(repo, &["merge-tree", "--write-tree", "-z", base, branch])?;
    let stdout = out.stdout;
    let mut fields = stdout.split(|&b| b == 0);
    let tree = String::from_utf8_lossy(fields.next().unwrap_or_default())
        .trim()
        .to_string();
    let mut map: BTreeMap<String, RawStages> = BTreeMap::new();
    for field in fields {
        if field.is_empty() {
            break; // end of the conflicted-file-info section
        }
        // "<mode> <oid> <stage>\t<path>"
        let s = String::from_utf8_lossy(field);
        let Some((meta, path)) = s.split_once('\t') else {
            continue;
        };
        let mut parts = meta.split_whitespace();
        let mode = parts.next().unwrap_or("").to_string();
        let oid = parts.next().unwrap_or("").to_string();
        let stage: u8 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let entry = map.entry(path.to_string()).or_default();
        match stage {
            1 => entry.base = Some((mode, oid)),
            2 => entry.ours = Some((mode, oid)),
            3 => entry.theirs = Some((mode, oid)),
            _ => {}
        }
    }
    Ok((tree, map))
}

// ---------------------------------------------------------------------------
// Rung 2 — rerere (scratch worktree)
// ---------------------------------------------------------------------------

/// Replay recorded conflict resolutions ([P31]) in a scratch detached worktree:
/// merge the branch into a checkout of the base head (rerere auto-applies +
/// stages known resolutions), then harvest the paths that came out marker-free.
/// Returns `path → resolved blob oid`. Best-effort — any failure yields an empty
/// map (the per-file rungs still run) and pushes a warning.
fn rerere_rung(
    repo: &Path,
    base_head: &str,
    branch: &str,
    stages: &BTreeMap<String, RawStages>,
    warnings: &mut Vec<String>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    // Nothing recorded and nothing to harvest against ⇒ skip the checkout cost.
    if !has_rr_cache(repo) {
        return out;
    }
    let scratch = match ScratchWorktree::open(repo, base_head) {
        Ok(s) => s,
        Err(e) => {
            warnings.push(format!("rerere rung skipped: {}", e));
            return out;
        }
    };
    // A conflicting merge is expected; rerere (autoUpdate) resolves + stages the
    // known ones. We ignore the exit status and inspect the working tree.
    let _ = git_output(scratch.path(), &["merge", "--no-edit", branch]);
    for path in stages.keys() {
        let file = scratch.path().join(path);
        if let Ok(bytes) = std::fs::read(&file) {
            if !bytes.is_empty() && is_clean_merge(&bytes) {
                if let Ok(oid) = hash_blob(repo, &bytes) {
                    out.insert(path.clone(), oid);
                }
            }
        }
    }
    let _ = git_output(scratch.path(), &["merge", "--abort"]);
    out
}

/// Teach rerere the driver/AI resolutions ([P31]) so an identical future
/// conflict replays for free: reproduce the conflict in a scratch worktree
/// (rerere records the preimage), write our resolutions, then `git rerere` to
/// record them. Best-effort; warnings on failure.
fn record_rerere(
    repo: &Path,
    base_head: &str,
    branch: &str,
    taught: &[&ResolvedFile],
    warnings: &mut Vec<String>,
) {
    ensure_rerere_config(repo);
    let scratch = match ScratchWorktree::open(repo, base_head) {
        Ok(s) => s,
        Err(e) => {
            warnings.push(format!("rerere record skipped: {}", e));
            return;
        }
    };
    // Conflict so rerere snapshots the preimage.
    let _ = git_output(scratch.path(), &["merge", "--no-edit", branch]);
    let mut wrote = false;
    for r in taught {
        let file = scratch.path().join(&r.path);
        if let Ok(bytes) = cat_blob(repo, &r.blob_oid) {
            if std::fs::write(&file, &bytes).is_ok() {
                let _ = git_output(scratch.path(), &["add", "--", &r.path]);
                wrote = true;
            }
        }
    }
    if wrote {
        // Record resolutions for the now-marker-free files.
        let _ = git_output(scratch.path(), &["rerere"]);
    }
    let _ = git_output(scratch.path(), &["merge", "--abort"]);
}

fn has_rr_cache(repo: &Path) -> bool {
    let dir = git_stdout(repo, &["rev-parse", "--git-path", "rr-cache"]).unwrap_or_default();
    if dir.is_empty() {
        return false;
    }
    let path = if Path::new(&dir).is_absolute() {
        std::path::PathBuf::from(&dir)
    } else {
        repo.join(&dir)
    };
    std::fs::read_dir(&path)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false)
}

/// A scratch detached worktree that removes itself on drop.
struct ScratchWorktree {
    repo: std::path::PathBuf,
    dir: tempfile::TempDir,
}

impl ScratchWorktree {
    fn open(repo: &Path, at: &str) -> Result<Self, String> {
        let dir = tempfile::tempdir().map_err(|e| format!("scratch tempdir: {}", e))?;
        let out = git_output(
            repo,
            &[
                "worktree",
                "add",
                "--detach",
                &dir.path().to_string_lossy(),
                at,
            ],
        )?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(Self {
            repo: repo.to_path_buf(),
            dir,
        })
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }
}

impl Drop for ScratchWorktree {
    fn drop(&mut self) {
        let _ = git_output(
            &self.repo,
            &[
                "worktree",
                "remove",
                "--force",
                &self.dir.path().to_string_lossy(),
            ],
        );
    }
}

// ---------------------------------------------------------------------------
// Rung 3 — merge-file
// ---------------------------------------------------------------------------

/// An opportunistic per-file 3-way re-merge with `git merge-file` (histogram
/// diff). Accepts only a clean (exit 0) result. Returns the merged bytes or
/// `None`. An add/add conflict (no base) has no 3-way and is skipped.
fn merge_file_rung(scratch: &Path, path: &str, loaded: &LoadedStages) -> Option<Vec<u8>> {
    let base = loaded.base.as_ref()?;
    let ours = loaded.ours.as_ref()?;
    let theirs = loaded.theirs.as_ref()?;
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt");
    let ours_f = write_scratch(scratch, "ours", ext, ours)?;
    let base_f = write_scratch(scratch, "base", ext, base)?;
    let theirs_f = write_scratch(scratch, "theirs", ext, theirs)?;
    let out = Command::new("git")
        .args([
            "-c",
            "diff.algorithm=histogram",
            "merge-file",
            "-p",
            "--zdiff3",
        ])
        .arg(&ours_f)
        .arg(&base_f)
        .arg(&theirs_f)
        .output()
        .ok()?;
    if out.status.success() && is_clean_merge(&out.stdout) {
        Some(out.stdout)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Rung 4 — structured-merge driver
// ---------------------------------------------------------------------------

/// A structured-merge driver ([P31]): the configured `tugdash.mergedriver`
/// command (or `mergiraf` when present), invoked with the three stage files and
/// an output file. Convention — the command receives, positionally:
/// `<base> <ours> <theirs> <output> <ext>` and must write the merged result to
/// `<output>` (exit 0). We validate the output has no conflict markers before
/// accepting. Absent tool ⇒ `None` (rung skipped), never bundled.
fn driver_rung(repo: &Path, scratch: &Path, path: &str, loaded: &LoadedStages) -> Option<Vec<u8>> {
    let base = loaded.base.as_ref()?;
    let ours = loaded.ours.as_ref()?;
    let theirs = loaded.theirs.as_ref()?;
    let program = driver_program(repo)?;
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt");
    let base_f = write_scratch(scratch, "d-base", ext, base)?;
    let ours_f = write_scratch(scratch, "d-ours", ext, ours)?;
    let theirs_f = write_scratch(scratch, "d-theirs", ext, theirs)?;
    let out_f = scratch.join(format!("d-out.{}", ext));

    let mut parts = program.split_whitespace();
    let bin = parts.next()?;
    let mut cmd = Command::new(bin);
    for arg in parts {
        cmd.arg(arg);
    }
    let status = cmd
        .arg(&base_f)
        .arg(&ours_f)
        .arg(&theirs_f)
        .arg(&out_f)
        .arg(ext)
        .status()
        .ok()?;
    if !status.success() {
        return None;
    }
    let bytes = std::fs::read(&out_f).ok()?;
    if !bytes.is_empty() && is_clean_merge(&bytes) {
        Some(bytes)
    } else {
        None
    }
}

/// The structured-merge driver command: `tugdash.mergedriver` when configured,
/// else `mergiraf` when it is on `PATH`, else `None`.
fn driver_program(repo: &Path) -> Option<String> {
    if let Some(cmd) = crate::ops::config_get(repo, "tugdash.mergedriver") {
        return Some(cmd);
    }
    if on_path("mergiraf") {
        return Some("mergiraf".to_string());
    }
    None
}

fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let p = dir.join(bin);
                p.is_file()
            })
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Candidate construction
// ---------------------------------------------------------------------------

/// A file resolved by some rung, ready to patch into the candidate tree.
struct ResolvedFile {
    path: String,
    by: ResolvedBy,
    blob_oid: String,
    mode: String,
}

/// Patch the merge-tree candidate tree with each resolved blob, via a temp index
/// (the repo's real index is never touched). Returns the new tree OID.
fn patch_tree(
    repo: &Path,
    scratch: &Path,
    base_tree: &str,
    resolved: &[ResolvedFile],
) -> Result<String, String> {
    let index = scratch.join("resolve-index");
    git_with_index(repo, &index, &["read-tree", base_tree])?;
    for r in resolved {
        git_with_index(
            repo,
            &index,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("{},{},{}", r.mode, r.blob_oid, r.path),
            ],
        )?;
    }
    git_with_index(repo, &index, &["write-tree"])
}

/// `git commit-tree <tree> -p <parent> -m <msg>` → the new commit OID.
fn commit_tree(repo: &Path, tree: &str, parent: &str, msg: &str) -> Result<String, String> {
    let out = git_output(repo, &["commit-tree", tree, "-p", parent, "-m", msg])?;
    if !out.status.success() {
        return Err(format!(
            "commit-tree failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ---------------------------------------------------------------------------
// git plumbing helpers
// ---------------------------------------------------------------------------

/// Run a git command with an explicit `GIT_INDEX_FILE`, returning trimmed
/// stdout on success.
fn git_with_index(repo: &Path, index: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_INDEX_FILE", index)
        .output()
        .map_err(|e| format!("git {}: {}", args.join(" "), e))?;
    if !out.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Read a blob body by OID.
fn cat_blob(repo: &Path, oid: &str) -> Result<Vec<u8>, String> {
    let out = git_output(repo, &["cat-file", "blob", oid])?;
    if !out.status.success() {
        return Err(format!(
            "cat-file {} failed: {}",
            oid,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// Write `bytes` as a loose blob (`git hash-object -w --stdin`) → its OID.
fn hash_blob(repo: &Path, bytes: &[u8]) -> Result<String, String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("hash-object: {}", e))?;
    child
        .stdin
        .take()
        .ok_or("hash-object: no stdin")?
        .write_all(bytes)
        .map_err(|e| format!("hash-object write: {}", e))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("hash-object wait: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "hash-object failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Write bytes to a uniquely named scratch file carrying the real extension, so
/// extension-based tools (mergiraf) detect the language. Returns the path.
fn write_scratch(scratch: &Path, tag: &str, ext: &str, bytes: &[u8]) -> Option<std::path::PathBuf> {
    let file = scratch.join(format!("{}.{}", tag, ext));
    std::fs::write(&file, bytes).ok()?;
    Some(file)
}

/// The dash's intent for the AI rung ([P32]): its maintained draft + round
/// subjects.
fn resolve_intent(repo: &Path, base_branch: &str, branch: &str) -> String {
    let mut parts = Vec::new();
    if let Some(draft) = crate::ops::dash_draft_message(repo, branch) {
        parts.push(draft);
    }
    if let Ok(subjects) = git_stdout(
        repo,
        &[
            "log",
            "--format=%s",
            &format!("{}..{}", base_branch, branch),
        ],
    ) {
        if !subjects.trim().is_empty() {
            parts.push(format!("Round subjects:\n{}", subjects.trim()));
        }
    }
    parts.join("\n\n")
}

/// Ensure `rerere.enabled` + `rerere.autoUpdate` are set on the repo (idempotent).
pub(crate) fn ensure_rerere_config(repo: &Path) {
    let _ = git_output(repo, &["config", "rerere.enabled", "true"]);
    let _ = git_output(repo, &["config", "rerere.autoUpdate", "true"]);
}

/// Whether a byte body looks binary (a NUL byte in the first 8 KiB).
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|&b| b == 0)
}

/// Whether merged text is conflict-free — no `git` conflict markers.
fn is_clean_merge(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    !text.lines().any(|l| {
        l.starts_with("<<<<<<<")
            || l.starts_with("=======")
            || l.starts_with(">>>>>>>")
            || l.starts_with("|||||||")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    fn set(dir: &Path, rel: &str, content: &str) {
        std::fs::write(dir.join(rel), content).unwrap();
    }

    /// A repo on `main` with base commit `A`, a `tugdash/demo` dash, and helpers
    /// wired (user config, rerere off by default — tests opt in).
    fn init(rounds_on_branch: &[(&str, &str, &str)]) -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        git(repo, &["init", "-b", "main"]);
        git(repo, &["config", "user.name", "t"]);
        git(repo, &["config", "user.email", "t@t"]);
        set(repo, "f.txt", "A\n");
        git(repo, &["add", "-A"]);
        git(repo, &["commit", "-m", "base"]);
        git(repo, &["branch", "tugdash/demo"]);
        git(repo, &["config", "branch.tugdash/demo.tugbase", "main"]);
        // Rounds land on the branch (checked out via a switch, no worktree).
        git(repo, &["switch", "-q", "tugdash/demo"]);
        for (rel, content, msg) in rounds_on_branch {
            set(repo, rel, content);
            git(repo, &["add", "-A"]);
            git(repo, &["commit", "-m", msg]);
        }
        git(repo, &["switch", "-q", "main"]);
        temp
    }

    // ---- unit rungs ----

    #[test]
    fn merge_file_rung_resolves_disjoint_edits_and_declines_overlap() {
        let scratch = tempfile::tempdir().unwrap();
        let disjoint = LoadedStages {
            base: Some(b"l1\nl2\nl3\n".to_vec()),
            ours: Some(b"X\nl2\nl3\n".to_vec()),
            theirs: Some(b"l1\nl2\nY\n".to_vec()),
        };
        let merged = merge_file_rung(scratch.path(), "f.txt", &disjoint).expect("disjoint merges");
        let text = String::from_utf8_lossy(&merged);
        assert!(
            text.contains("X") && text.contains("Y"),
            "both edits present: {text}"
        );
        assert!(is_clean_merge(&merged));

        let overlap = LoadedStages {
            base: Some(b"A\n".to_vec()),
            ours: Some(b"B\n".to_vec()),
            theirs: Some(b"C\n".to_vec()),
        };
        assert!(
            merge_file_rung(scratch.path(), "f.txt", &overlap).is_none(),
            "overlap declines"
        );
    }

    #[test]
    fn is_binary_and_clean_merge_detectors() {
        assert!(is_binary(b"ab\0cd"));
        assert!(!is_binary(b"plain text\n"));
        assert!(is_clean_merge(b"resolved\n"));
        assert!(!is_clean_merge(
            b"a\n<<<<<<< ours\nb\n=======\nc\n>>>>>>> theirs\n"
        ));
    }

    // ---- ladder end-to-end ----

    #[test]
    fn replay_probe_resolves_base_already_advanced_and_lands_replay_shape() {
        // branch: A→B→C. main separately advances A→B (same as round 1), so the
        // one-shot squash conflicts (B vs C) but round-by-round replay is clean.
        let temp = init(&[("f.txt", "B\n", "r1"), ("f.txt", "C\n", "r2")]);
        let repo = temp.path();
        set(repo, "f.txt", "B\n");
        git(repo, &["commit", "-am", "main advances to B"]);

        // Sanity: the plain squash really does conflict.
        let (_t, stages) = merge_tree_stages(repo, "main", "tugdash/demo").unwrap();
        assert!(!stages.is_empty(), "squash conflicts");

        let outcome = resolve_conflicts(repo, "demo", None).unwrap();
        assert_eq!(outcome.shape, JoinShape::Replay);
        assert!(outcome.unresolved.is_empty());
        let candidate = outcome.candidate_commit.expect("replay candidate");
        // The candidate's f.txt is the dash's final state, C.
        let show = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["show", &format!("{candidate}:f.txt")])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "C\n");
    }

    #[test]
    fn unresolvable_overlap_leaves_no_candidate() {
        // branch A→B; main A→C. Overlapping single-line change, no rerere/driver.
        let temp = init(&[("f.txt", "B\n", "r1")]);
        let repo = temp.path();
        set(repo, "f.txt", "C\n");
        git(repo, &["commit", "-am", "main to C"]);

        let outcome = resolve_conflicts(repo, "demo", None).unwrap();
        assert!(outcome.candidate_commit.is_none(), "no candidate");
        assert_eq!(outcome.unresolved, vec!["f.txt".to_string()]);
    }

    #[test]
    fn delete_modify_short_circuits_to_unresolved() {
        // branch modifies f.txt; main deletes it → delete/modify (non-content).
        let temp = init(&[("f.txt", "B\n", "modify")]);
        let repo = temp.path();
        std::fs::remove_file(repo.join("f.txt")).unwrap();
        git(repo, &["commit", "-am", "main deletes f.txt"]);

        let outcome = resolve_conflicts(repo, "demo", None).unwrap();
        assert!(outcome.candidate_commit.is_none());
        assert_eq!(outcome.unresolved, vec!["f.txt".to_string()]);
        assert!(outcome.resolved.is_empty());
    }

    #[test]
    fn driver_rung_resolves_via_configured_stub() {
        let temp = init(&[("f.txt", "B\n", "r1")]);
        let repo = temp.path();
        set(repo, "f.txt", "C\n");
        git(repo, &["commit", "-am", "main to C"]);

        // A stub driver: <base> <ours> <theirs> <output> <ext> → write output.
        let stub = repo.join("stub-driver.sh");
        std::fs::write(&stub, "#!/bin/sh\nprintf 'DRIVER\\n' > \"$4\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        git(
            repo,
            &["config", "tugdash.mergedriver", &stub.to_string_lossy()],
        );

        let outcome = resolve_conflicts(repo, "demo", None).unwrap();
        let candidate = outcome
            .candidate_commit
            .expect("driver produced a candidate");
        assert_eq!(outcome.resolved.len(), 1);
        assert_eq!(outcome.resolved[0].resolved_by, ResolvedBy::Driver);
        let show = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["show", &format!("{candidate}:f.txt")])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "DRIVER\n");
    }

    #[test]
    fn ai_rung_resolves_and_validates_marker_free() {
        let temp = init(&[("f.txt", "B\n", "r1")]);
        let repo = temp.path();
        set(repo, "f.txt", "C\n");
        git(repo, &["commit", "-am", "main to C"]);

        struct FakeAi;
        impl FileMerger for FakeAi {
            fn merge(&self, _req: &FileMergeRequest) -> Option<Vec<u8>> {
                Some(b"AI-MERGED\n".to_vec())
            }
        }
        let outcome = resolve_conflicts(repo, "demo", Some(&FakeAi)).unwrap();
        assert_eq!(outcome.resolved.len(), 1);
        assert_eq!(outcome.resolved[0].resolved_by, ResolvedBy::Ai);
        assert!(outcome.candidate_commit.is_some());

        // A marker-bearing AI reply is rejected → unresolved. A fresh repo, so
        // the good run above (which taught rerere) can't replay here.
        let temp2 = init(&[("f.txt", "B\n", "r1")]);
        let repo2 = temp2.path();
        set(repo2, "f.txt", "C\n");
        git(repo2, &["commit", "-am", "main to C"]);
        struct BadAi;
        impl FileMerger for BadAi {
            fn merge(&self, _req: &FileMergeRequest) -> Option<Vec<u8>> {
                Some(b"<<<<<<< ours\nB\n=======\nC\n>>>>>>> theirs\n".to_vec())
            }
        }
        let bad = resolve_conflicts(repo2, "demo", Some(&BadAi)).unwrap();
        assert!(bad.candidate_commit.is_none());
        assert_eq!(bad.unresolved, vec!["f.txt".to_string()]);
    }

    #[test]
    fn rerere_replays_a_recorded_resolution() {
        let temp = init(&[("f.txt", "B\n", "r1")]);
        let repo = temp.path();
        ensure_rerere_config(repo);
        set(repo, "f.txt", "C\n");
        git(repo, &["commit", "-am", "main to C"]);
        let main_c = String::from_utf8(
            Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        // Record: a real merge conflicts, we resolve to R and commit → rerere
        // learns the preimage→resolution. Then reset main back to C.
        let _ = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["merge", "--no-edit", "tugdash/demo"])
            .status();
        set(repo, "f.txt", "R\n");
        git(repo, &["add", "f.txt"]);
        git(repo, &["commit", "--no-edit", "-m", "resolve"]);
        git(repo, &["reset", "--hard", &main_c]);

        let outcome = resolve_conflicts(repo, "demo", None).unwrap();
        assert_eq!(outcome.resolved.len(), 1, "rerere resolved f.txt");
        assert_eq!(outcome.resolved[0].resolved_by, ResolvedBy::Rerere);
        let candidate = outcome.candidate_commit.expect("rerere candidate");
        let show = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["show", &format!("{candidate}:f.txt")])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "R\n");
    }
}
