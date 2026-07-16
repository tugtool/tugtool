//! Integration tests for the `tug` CLI, driving the built binary against a
//! real temp git repo and a seeded `sessions.db`.
//!
//! The library resolves `sessions.db` via `tugcore::instance::sessions_db_path`,
//! which (without `TUG_INSTANCE_ID`) falls back to
//! `$HOME/Library/Application Support/Tug/sessions.db`. Each test overrides
//! `HOME` on the child process to point that lookup at a seeded db, so the
//! tests are fully isolated from the developer's real ledger.

use std::path::{Path, PathBuf};
use std::process::Command;

use assert_cmd::cargo::CommandCargoExt;
use rusqlite::Connection;

/// Run a git command in `dir`, asserting success.
fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A temp git repo with one committed file and an untracked `feature.rs`. The
/// returned root is canonicalized (macOS tempdirs live under a `/private/var`
/// symlink, and `git rev-parse --show-toplevel` reports the canonical form), so
/// the seeded absolute event paths strip against the same root the binary
/// resolves.
fn init_repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    git(&root, &["config", "user.email", "t@t.test"]);
    git(&root, &["config", "user.name", "t"]);
    std::fs::write(root.join("base.rs"), "base\n").unwrap();
    git(&root, &["add", "base.rs"]);
    git(&root, &["commit", "-q", "-m", "init"]);
    std::fs::write(root.join("feature.rs"), "one\ntwo\n").unwrap();
    (dir, root)
}

/// A temp `$HOME` whose `Library/Application Support/Tug/sessions.db` is seeded
/// with `session` ("work", with a `feature.rs` created event) and an empty
/// `empty` session row.
fn seed_home(repo_root: &Path) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let db_dir = home.path().join("Library/Application Support/Tug");
    std::fs::create_dir_all(&db_dir).unwrap();
    let conn = Connection::open(db_dir.join("sessions.db")).unwrap();
    conn.execute_batch(
        "CREATE TABLE sessions (session_id TEXT PRIMARY KEY);
         CREATE TABLE file_events (
            tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
            tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
            parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
    )
    .unwrap();
    conn.execute("INSERT INTO sessions (session_id) VALUES ('work'), ('empty')", [])
        .unwrap();
    conn.execute(
        "INSERT INTO file_events
            (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
         VALUES ('work', 'tu-1', ?1, 'Write', 'created', 'exact', 0, ?2, 1)",
        rusqlite::params![
            repo_root.join("feature.rs").to_string_lossy().to_string(),
            repo_root.to_string_lossy().to_string()
        ],
    )
    .unwrap();
    home
}

/// A `tug` command with `HOME` pointed at `home` and no instance id.
fn tug(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("tugutil").unwrap();
    cmd.env("HOME", home);
    cmd.env_remove("TUG_INSTANCE_ID");
    cmd.env_remove("TUG_SESSION_ID");
    cmd
}

/// Run to completion and return `(exit_code, stdout, stderr)`.
fn run(mut cmd: Command) -> (i32, String, String) {
    let out = cmd.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn parse(stdout: &str) -> serde_json::Value {
    serde_json::from_str(stdout).expect("valid JSON envelope")
}

fn project_arg(repo: &Path) -> Vec<String> {
    vec!["--project".to_string(), repo.to_string_lossy().into_owned()]
}

#[test]
fn changes_json_emits_envelope_with_the_changed_file() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["changes", "--json", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["schema_version"], "1");
    assert_eq!(v["command"], "mark changes");
    assert_eq!(v["status"], "ok");
    let files = v["data"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "feature.rs");
    assert_eq!(files[0]["git_status"], "??");
}

#[test]
fn context_json_matches_s02_shape() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["context", "--json", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["command"], "mark context");
    let data = &v["data"];
    assert_eq!(data["session"], "work");
    assert_eq!(data["branch"], "main");
    assert!(data["repo_root"].is_string());
    assert!(!data["head"].as_str().unwrap().is_empty());
    let files = data["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    // Context always carries a diff — a created file gets a real add-diff.
    let diff = files[0]["diff"].as_str().unwrap();
    assert!(diff.contains("feature.rs"), "add-diff present: {diff}");
    let commits = data["recent_commits"].as_array().unwrap();
    assert_eq!(commits[0]["subject"], "init");
}

#[test]
fn commit_json_stages_the_session_file_and_matches_numstat() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["commit", "--json", "--session", "work", "--message", "add feature"]);
    cmd.args(project_arg(&root));

    let (code, stdout, stderr) = run(cmd);
    assert_eq!(code, 0, "stderr: {stderr}");
    let v = parse(&stdout);
    assert_eq!(v["command"], "mark commit");
    let data = &v["data"];
    assert_eq!(data["branch"], "main");
    assert_eq!(data["message"], "add feature");
    let files = data["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "feature.rs");
    assert_eq!(files[0]["status"], "created");
    assert_eq!(files[0]["added"], 2);
    assert_eq!(data["aggregate"]["files_changed"], 1);
    assert_eq!(data["aggregate"]["insertions"], 2);

    // The commit really landed: feature.rs is now committed (clean tree).
    let status = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["status", "--porcelain"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&status.stdout).trim().is_empty());
}

#[test]
fn log_json_emits_envelope() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.current_dir(&root);
    cmd.args(["log", "--json", "--limit", "5"]);

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["command"], "mark log");
    let commits = v["data"]["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0]["subject"], "init");
}

#[test]
fn diff_json_emits_envelope() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    // Modify a tracked file so the working-tree diff is non-empty.
    std::fs::write(root.join("base.rs"), "base\nmore\n").unwrap();
    let mut cmd = tug(home.path());
    cmd.args(["diff", "--json"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["command"], "mark diff");
    let files = v["data"]["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "base.rs"));
}

#[test]
fn unknown_session_exits_two_valid_empty_exits_zero() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);

    // Unknown session → exit 2.
    let mut cmd = tug(home.path());
    cmd.args(["changes", "--session", "ghost"]);
    cmd.args(project_arg(&root));
    let (code, _, stderr) = run(cmd);
    assert_eq!(code, 2, "unknown session exits 2");
    assert!(stderr.contains("unknown"), "stderr: {stderr}");

    // Known-but-empty session → exit 0, no files listed.
    let mut cmd = tug(home.path());
    cmd.args(["changes", "--session", "empty"]);
    cmd.args(project_arg(&root));
    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0, "valid empty session exits 0");
    assert!(stdout.trim().is_empty(), "no paths for an empty session");
}

#[test]
fn no_session_id_exits_two() {
    let (_repo, root) = init_repo();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["changes"]);
    cmd.args(project_arg(&root));
    let (code, _, stderr) = run(cmd);
    assert_eq!(code, 2, "no session id exits 2");
    assert!(stderr.contains("no session id"), "stderr: {stderr}");
}
