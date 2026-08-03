//! `tugutil file` — git-aware file lifecycle verbs that testify to what they did.
//!
//! A shell command with a glob or a variable operand is unreadable, so the
//! attribution relay can only correlate it: the file lands in `unattributed`
//! with a hint. These verbs close that gap from the other side. They perform
//! the expansion themselves and print a receipt naming exactly which files were
//! removed, renamed, or created — testimony from a tool we own, which the relay
//! turns into proof-class rows.
//!
//! The receipt names **files, never directories**: the read side's universe is
//! per-file, so a directory op could never join. A recursive operation
//! enumerates what it will touch before acting.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tugchanges_core::shell_ops::{ParseOutcome, Suggestion, parse_shell_ops};

use crate::changes::AppError;
use crate::cli::FileCommands;

/// The stdout marker the relay scans every successful Bash result for.
const RECEIPT_PREFIX: &str = "TUG-FILE-RECEIPT: ";

#[derive(Debug, Clone, Serialize)]
struct ReceiptOp {
    op: &'static str,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
struct Receipt {
    ops: Vec<ReceiptOp>,
}

impl Receipt {
    fn deleted(&mut self, path: &Path) {
        self.ops.push(ReceiptOp {
            op: "deleted",
            path: path.to_string_lossy().into_owned(),
            orig_path: None,
        });
    }

    fn renamed(&mut self, from: &Path, to: &Path) {
        self.ops.push(ReceiptOp {
            op: "renamed",
            path: to.to_string_lossy().into_owned(),
            orig_path: Some(from.to_string_lossy().into_owned()),
        });
    }

    fn modified(&mut self, path: &Path) {
        self.ops.push(ReceiptOp {
            op: "modified",
            path: path.to_string_lossy().into_owned(),
            orig_path: None,
        });
    }

    fn created(&mut self, path: &Path) {
        self.ops.push(ReceiptOp {
            op: "created",
            path: path.to_string_lossy().into_owned(),
            orig_path: None,
        });
    }

    /// Emit the receipt — one line, always, even when the run failed partway:
    /// the ops it names did happen, and the relay reads receipts only from
    /// successful results anyway.
    fn emit(&self) {
        if self.ops.is_empty() {
            return;
        }
        let json = serde_json::to_string(self).unwrap_or_else(|_| "{\"ops\":[]}".to_string());
        println!("{RECEIPT_PREFIX}{json}");
    }
}

pub fn run_file(command: FileCommands) -> Result<(), AppError> {
    match command {
        FileCommands::Rm { paths } => run_rm(&paths),
        FileCommands::Mv { src, dst } => run_mv(&src, &dst),
        FileCommands::Cp { src, dst } => run_cp(&src, &dst),
        FileCommands::Edit {
            patch,
            path,
            replace,
            with,
            count,
            regex,
        } => run_edit(patch, path, replace, with, count, regex),
        FileCommands::Probe {
            patch,
            paths,
            command,
        } => super::file_probe::run_probe(patch, &paths, &command),
        FileCommands::Gate { command, base_dir } => run_gate(&command, base_dir),
    }
}

// ---------------------------------------------------------------------------
// rm
// ---------------------------------------------------------------------------

fn run_rm(patterns: &[String]) -> Result<(), AppError> {
    let mut receipt = Receipt::default();
    let mut failure: Option<String> = None;

    for target in expand(patterns) {
        // Enumerate before acting: once the directory is gone there is nothing
        // left to name.
        let files = files_under(&target);
        let tracked = git_tracks(&target);
        let mut ok = true;

        if tracked && git(&["rm", "-q", "-f", "-r", "--"], &[&target]).is_err() {
            ok = false;
        }
        if ok && target.exists() {
            let removed = if target.is_dir() {
                std::fs::remove_dir_all(&target)
            } else {
                std::fs::remove_file(&target)
            };
            if let Err(err) = removed {
                failure.get_or_insert(format!("{}: {err}", target.display()));
                ok = false;
            }
        }
        if ok {
            for file in files {
                receipt.deleted(&file);
            }
        }
    }

    receipt.emit();
    match failure {
        Some(msg) => Err(AppError::Exit1(msg)),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// mv
// ---------------------------------------------------------------------------

fn run_mv(src: &str, dst: &str) -> Result<(), AppError> {
    let src = absolute(Path::new(src));
    let dst = destination(&src, Path::new(dst));
    if !src.exists() {
        return Err(AppError::Exit1(format!("{}: no such file", src.display())));
    }

    // Pair every contained file's old and new spelling before the move erases
    // the mapping.
    let pairs: Vec<(PathBuf, PathBuf)> = files_under(&src)
        .into_iter()
        .map(|file| {
            let landed = match file.strip_prefix(&src) {
                Ok(rel) if !rel.as_os_str().is_empty() => dst.join(rel),
                _ => dst.clone(),
            };
            (file, landed)
        })
        .collect();

    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Exit1(format!("{}: {e}", parent.display())))?;
    }

    if git_tracks(&src) {
        git(&["mv", "--"], &[&src, &dst])?;
    } else {
        std::fs::rename(&src, &dst)
            .map_err(|e| AppError::Exit1(format!("{} -> {}: {e}", src.display(), dst.display())))?;
    }

    let mut receipt = Receipt::default();
    for (from, to) in pairs {
        receipt.renamed(&from, &to);
    }
    receipt.emit();
    Ok(())
}

// ---------------------------------------------------------------------------
// cp
// ---------------------------------------------------------------------------

fn run_cp(src: &str, dst: &str) -> Result<(), AppError> {
    let src = absolute(Path::new(src));
    let dst = destination(&src, Path::new(dst));
    if !src.exists() {
        return Err(AppError::Exit1(format!("{}: no such file", src.display())));
    }

    let mut receipt = Receipt::default();
    if src.is_dir() {
        for file in files_under(&src) {
            let rel = file.strip_prefix(&src).unwrap_or(Path::new(""));
            let landed = dst.join(rel);
            if let Some(parent) = landed.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Exit1(format!("{}: {e}", parent.display())))?;
            }
            std::fs::copy(&file, &landed)
                .map_err(|e| AppError::Exit1(format!("{}: {e}", file.display())))?;
            receipt.created(&landed);
        }
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Exit1(format!("{}: {e}", parent.display())))?;
        }
        std::fs::copy(&src, &dst)
            .map_err(|e| AppError::Exit1(format!("{}: {e}", src.display())))?;
        receipt.created(&dst);
    }
    receipt.emit();
    Ok(())
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

/// Substitution and patch application that testify to what they changed.
///
/// This is the attributable form of the `perl -i`/`python3` heredoc edits the
/// grammar cannot read: the verb performs the edit itself and prints a receipt
/// naming every file whose bytes actually moved, which the relay turns into
/// proof-class rows.
fn run_edit(
    patch: Option<String>,
    path: Option<String>,
    replace: Option<String>,
    with: Option<String>,
    count: Option<usize>,
    regex: bool,
) -> Result<(), AppError> {
    match (patch, path) {
        (Some(source), _) => edit_by_patch(&source),
        (None, Some(path)) => {
            // clap's `requires_all` guarantees both are present here.
            let (replace, with) = (replace.unwrap_or_default(), with.unwrap_or_default());
            edit_by_substitution(&path, &replace, &with, count, regex)
        }
        (None, None) => Err(AppError::Exit1(
            "nothing to do — pass --patch, or --path with --replace and --with".to_string(),
        )),
    }
}

fn edit_by_patch(source: &str) -> Result<(), AppError> {
    use super::file_probe::{git_apply, patch_targets, read_patch};

    let text = read_patch(source)?;
    let targets = patch_targets(&text);
    if targets.is_empty() {
        return Err(AppError::Exit1(
            "the patch names no files".to_string(),
        ));
    }

    // Remember each target's bytes so the receipt can name only the files that
    // actually moved — a patch may name a file and leave it identical.
    let before: Vec<Option<Vec<u8>>> = targets.iter().map(|p| std::fs::read(p).ok()).collect();

    // Validate first: a patch that will not apply must change nothing and
    // testify to nothing.
    git_apply(&text, true)?;
    git_apply(&text, false)?;

    let mut receipt = Receipt::default();
    for (target, was) in targets.iter().zip(before) {
        let now = std::fs::read(target).ok();
        if now == was {
            continue;
        }
        match (was, &now) {
            (None, Some(_)) => receipt.created(target),
            (Some(_), None) => receipt.deleted(target),
            _ => receipt.modified(target),
        }
    }
    receipt.emit();
    Ok(())
}

fn edit_by_substitution(
    path: &str,
    replace: &str,
    with: &str,
    count: Option<usize>,
    regex: bool,
) -> Result<(), AppError> {
    let target = absolute(Path::new(path));
    let original = std::fs::read_to_string(&target)
        .map_err(|e| AppError::Exit1(format!("{}: {e}", target.display())))?;

    // `--count 0` is refused rather than interpreted. `str::replacen(…, 0)`
    // replaces nothing and `Regex::replacen(…, 0)` replaces *everything*, so
    // honouring it would make the same flag mean opposite things in the two
    // modes — and the regex reading is a silent maximal edit from a flag the
    // caller wrote to mean "at most".
    if count == Some(0) {
        return Err(AppError::Exit1(
            "--count 0 would replace nothing; omit --count to replace every occurrence".to_string(),
        ));
    }
    let limit = count.unwrap_or(usize::MAX);
    let updated = if regex {
        let pattern = regex::Regex::new(replace)
            .map_err(|e| AppError::Exit1(format!("--replace is not a valid regex: {e}")))?;
        if !pattern.is_match(&original) {
            return Err(no_match(&target, replace));
        }
        pattern.replacen(&original, limit, with).into_owned()
    } else {
        if !original.contains(replace) {
            return Err(no_match(&target, replace));
        }
        original.replacen(replace, with, limit)
    };

    // A substitution that matched but changed nothing (replacing text with
    // itself) is still a no-op, and a receipt for it would be a lie.
    if updated == original {
        return Err(AppError::Exit1(format!(
            "{}: the replacement is identical to what it replaced",
            target.display()
        )));
    }

    std::fs::write(&target, updated)
        .map_err(|e| AppError::Exit1(format!("{}: {e}", target.display())))?;

    let mut receipt = Receipt::default();
    receipt.modified(&target);
    receipt.emit();
    Ok(())
}

/// Silence about a substitution that matched nothing is how a stale edit hides,
/// so it is an error rather than a quiet success.
fn no_match(target: &Path, replace: &str) -> AppError {
    AppError::Exit1(format!(
        "no match for `{replace}` in {} — nothing was changed",
        target.display()
    ))
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct GateDecision {
    decision: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// Where a refusal points. The grammar decides which verb covers what it could
/// not read; this only spells it out, so a denied `perl -i` is never steered at
/// `rm|mv|cp`.
fn steering(suggest: Suggestion) -> &'static str {
    match suggest {
        Suggestion::Lifecycle => {
            "Use `tugutil file rm|mv|cp` instead — it expands the operands itself and reports \
             exactly which files it touched, so the change stays attributed."
        }
        Suggestion::Edit => {
            "Use `tugutil file edit` instead — it performs the edit itself and reports exactly \
             which files changed, so the change stays attributed. For a patch-run-revert cycle, \
             `tugutil file probe` does the whole thing and records nothing."
        }
    }
}

/// The PreToolUse hook's decision, computed by the same grammar the relay uses
/// so the two cannot fork. Deny is reserved for the case where correlation
/// would otherwise be the ceiling: an rm/mv-class command whose operands the
/// grammar cannot read. Always exits 0 — the decision is the JSON, and a
/// crashed gate must fail open.
fn run_gate(command: &str, base_dir: Option<PathBuf>) -> Result<(), AppError> {
    let base = base_dir.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let decision = match parse_shell_ops(command, &base) {
        ParseOutcome::Unparseable { reason, suggest } => GateDecision {
            decision: "deny",
            reason: Some(format!("{reason}. {}", steering(suggest))),
        },
        ParseOutcome::Ops(_) | ParseOutcome::NoFileOps => GateDecision {
            decision: "allow",
            reason: None,
        },
    };
    println!(
        "{}",
        serde_json::to_string(&decision).unwrap_or_else(|_| "{\"decision\":\"allow\"}".to_string())
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Expand each argument: a glob against the filesystem, or a literal path.
/// Unmatched globs and literals alike come through unchanged — the caller's
/// removal reports the real error.
fn expand(patterns: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for pattern in patterns {
        let absolute_pattern = absolute(Path::new(pattern));
        let matched = glob::glob(&absolute_pattern.to_string_lossy())
            .ok()
            .map(|paths| paths.filter_map(Result::ok).collect::<Vec<_>>())
            .unwrap_or_default();
        if matched.is_empty() {
            out.push(absolute_pattern);
        } else {
            out.extend(matched);
        }
    }
    out
}

/// Every regular file at or beneath `path` — the receipt's unit. A file yields
/// itself; a directory yields its contents; a path that does not exist yields
/// nothing.
fn files_under(path: &Path) -> Vec<PathBuf> {
    if path.is_file() || path.is_symlink() {
        return vec![path.to_path_buf()];
    }
    if !path.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            // A repo's own `.git` is plumbing, not content.
            if child.file_name().is_some_and(|n| n == ".git") {
                continue;
            }
            if child.is_dir() && !child.is_symlink() {
                stack.push(child);
            } else {
                out.push(child);
            }
        }
    }
    out.sort();
    out
}

/// Where `src` actually lands: a destination that already names a directory
/// receives the source under its own name, as the shell verbs do.
fn destination(src: &Path, dst: &Path) -> PathBuf {
    let dst = absolute(dst);
    match (dst.is_dir(), src.file_name()) {
        (true, Some(name)) => dst.join(name),
        _ => dst,
    }
}

pub(super) fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    normalize(&cwd.join(path))
}

pub(super) fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Whether git tracks `path` (or anything beneath it) — the test that decides
/// between `git rm`/`git mv` and a plain filesystem operation, so the index
/// never disagrees with the disk.
fn git_tracks(path: &Path) -> bool {
    let Some(dir) = git_dir_for(path) else {
        return false;
    };
    std::process::Command::new("git")
        .arg("-C")
        .arg(&dir)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(path)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn git_dir_for(path: &Path) -> Option<PathBuf> {
    let start = if path.is_dir() {
        Some(path)
    } else {
        path.parent()
    }?;
    start.exists().then(|| start.to_path_buf())
}

fn git(args: &[&str], paths: &[&Path]) -> Result<(), AppError> {
    let Some(dir) = paths.first().and_then(|p| git_dir_for(p)) else {
        return Err(AppError::Exit1("no directory to run git in".to_string()));
    };
    let mut command = std::process::Command::new("git");
    command.arg("-C").arg(&dir);
    command.args(args);
    for path in paths {
        command.arg(path);
    }
    let output = command
        .output()
        .map_err(|e| AppError::Exit1(format!("git: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Exit1(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@t.test"],
            vec!["config", "user.name", "t"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .args(&args)
                    .current_dir(root)
                    .output()
                    .expect("git")
                    .status
                    .success()
            );
        }
        dir
    }

    fn commit_all(root: &Path) {
        for args in [vec!["add", "-A"], vec!["commit", "-q", "-m", "seed"]] {
            assert!(
                std::process::Command::new("git")
                    .args(&args)
                    .current_dir(root)
                    .output()
                    .expect("git")
                    .status
                    .success()
            );
        }
    }

    fn tracked(root: &Path, rel: &str) -> bool {
        git_tracks(&root.join(rel))
    }

    #[test]
    fn rm_removes_a_tracked_file_through_git() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        commit_all(root);

        run_rm(&[root.join("a.txt").to_string_lossy().into_owned()]).unwrap();
        assert!(!root.join("a.txt").exists());
        assert!(!tracked(root, "a.txt"), "the index reflects the removal");
    }

    #[test]
    fn rm_removes_an_untracked_file_too() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("scratch.txt"), "x\n").unwrap();

        run_rm(&[root.join("scratch.txt").to_string_lossy().into_owned()]).unwrap();
        assert!(!root.join("scratch.txt").exists());
    }

    #[test]
    fn rm_of_a_directory_names_every_file_and_no_directory() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::create_dir_all(root.join("out/nested")).unwrap();
        std::fs::write(root.join("out/one.txt"), "1\n").unwrap();
        std::fs::write(root.join("out/two.txt"), "2\n").unwrap();
        std::fs::write(root.join("out/nested/three.txt"), "3\n").unwrap();

        let target = root.join("out");
        let files = files_under(&target);
        assert_eq!(files.len(), 3, "enumeration is per file: {files:?}");
        assert!(files.iter().all(|f| f.is_file()));

        run_rm(&[target.to_string_lossy().into_owned()]).unwrap();
        assert!(!target.exists());
    }

    #[test]
    fn rm_expands_a_glob_itself() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("apptest-1.log"), "1\n").unwrap();
        std::fs::write(root.join("apptest-2.log"), "2\n").unwrap();
        std::fs::write(root.join("keep.log"), "keep\n").unwrap();

        let pattern = root.join("apptest-*").to_string_lossy().into_owned();
        let expanded = expand(std::slice::from_ref(&pattern));
        assert_eq!(expanded.len(), 2, "the verb resolves what the shell would");

        run_rm(&[pattern]).unwrap();
        assert!(!root.join("apptest-1.log").exists());
        assert!(!root.join("apptest-2.log").exists());
        assert!(root.join("keep.log").exists(), "an unmatched file survives");
    }

    #[test]
    fn mv_moves_a_tracked_file_through_git_and_preserves_content() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("old.txt"), "body\n").unwrap();
        commit_all(root);

        run_mv(
            &root.join("old.txt").to_string_lossy(),
            &root.join("new.txt").to_string_lossy(),
        )
        .unwrap();
        assert!(!root.join("old.txt").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("new.txt")).unwrap(),
            "body\n"
        );
        assert!(tracked(root, "new.txt"), "the index followed the move");
    }

    #[test]
    fn mv_of_a_directory_pairs_every_contained_file() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::create_dir_all(root.join("src/inner")).unwrap();
        std::fs::write(root.join("src/a.rs"), "a\n").unwrap();
        std::fs::write(root.join("src/inner/b.rs"), "b\n").unwrap();

        let src = root.join("src");
        let dst = root.join("lib");
        let pairs: Vec<(PathBuf, PathBuf)> = files_under(&src)
            .into_iter()
            .map(|file| {
                let rel = file.strip_prefix(&src).unwrap().to_path_buf();
                (file, dst.join(rel))
            })
            .collect();
        assert_eq!(pairs.len(), 2);

        run_mv(&src.to_string_lossy(), &dst.to_string_lossy()).unwrap();
        for (from, to) in pairs {
            assert!(!from.exists());
            assert!(to.exists(), "{} landed", to.display());
        }
    }

    #[test]
    fn mv_into_an_existing_directory_keeps_the_file_name() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        std::fs::create_dir(root.join("dest")).unwrap();

        run_mv(
            &root.join("a.txt").to_string_lossy(),
            &root.join("dest").to_string_lossy(),
        )
        .unwrap();
        assert!(root.join("dest/a.txt").exists());
    }

    #[test]
    fn cp_copies_a_file_and_a_tree() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        run_cp(
            &root.join("a.txt").to_string_lossy(),
            &root.join("b.txt").to_string_lossy(),
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(root.join("b.txt")).unwrap(), "a\n");

        std::fs::create_dir_all(root.join("tree/inner")).unwrap();
        std::fs::write(root.join("tree/inner/c.txt"), "c\n").unwrap();
        run_cp(
            &root.join("tree").to_string_lossy(),
            &root.join("copy").to_string_lossy(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("copy/inner/c.txt")).unwrap(),
            "c\n"
        );
    }

    #[test]
    fn the_receipt_names_files_only_and_pairs_renames() {
        let mut receipt = Receipt::default();
        receipt.deleted(Path::new("/abs/a.ts"));
        receipt.renamed(Path::new("/abs/old.ts"), Path::new("/abs/new.ts"));
        receipt.created(Path::new("/abs/copy.ts"));
        let json = serde_json::to_string(&receipt).unwrap();
        assert_eq!(
            json,
            r#"{"ops":[{"op":"deleted","path":"/abs/a.ts"},{"op":"renamed","path":"/abs/new.ts","orig_path":"/abs/old.ts"},{"op":"created","path":"/abs/copy.ts"}]}"#
        );
    }

    #[test]
    fn the_gate_denies_only_what_the_grammar_cannot_read() {
        let base = PathBuf::from("/repo");
        let decide = |command: &str| match parse_shell_ops(command, &base) {
            ParseOutcome::Unparseable { .. } => "deny",
            _ => "allow",
        };
        assert_eq!(decide("rm -rf apptest-*"), "deny");
        assert_eq!(decide("rm \"$WT/x\""), "deny");
        assert_eq!(decide("rm a.ts"), "allow");
        assert_eq!(decide("cargo build"), "allow");
        assert_eq!(decide("tugutil file rm 'apptest-*'"), "allow");

        // In-place editors: readable operands pass, unreadable ones do not.
        assert_eq!(decide("perl -i -pe 's/a/b/' src/x.ts"), "allow");
        assert_eq!(decide("perl -i -pe 's/a/b/' src/*.ts"), "deny");
        assert_eq!(decide("sed -i '' 's/a/b/' src/*.ts"), "deny");
        // A python heredoc is never denied — it cannot be judged without
        // parsing Python, and two thirds of them are read-only analysis.
        assert_eq!(
            decide("python3 - <<'PY'\nopen('x','w').write('y')\nPY"),
            "allow"
        );
    }

    #[test]
    fn a_refusal_steers_at_the_verb_that_covers_it() {
        let base = PathBuf::from("/repo");
        let reason = |command: &str| match parse_shell_ops(command, &base) {
            ParseOutcome::Unparseable { suggest, .. } => steering(suggest).to_string(),
            other => panic!("expected a refusal for `{command}`, got {other:?}"),
        };

        // An unreadable edit points at `edit`, NOT at the lifecycle verbs — the
        // whole reason the suggestion rides on the refusal.
        let edit = reason("perl -i -pe 's/a/b/' src/*.ts");
        assert!(edit.contains("tugutil file edit"), "{edit}");
        assert!(edit.contains("tugutil file probe"), "{edit}");
        assert!(!edit.contains("rm|mv|cp"), "{edit}");

        // …and an unreadable lifecycle op still points where it always did.
        let lifecycle = reason("rm -rf apptest-*");
        assert!(lifecycle.contains("tugutil file rm|mv|cp"), "{lifecycle}");
        assert!(!lifecycle.contains("tugutil file edit"), "{lifecycle}");
    }
}
