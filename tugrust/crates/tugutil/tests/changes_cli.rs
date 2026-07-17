//! Integration tests for the `tug` CLI, driving the built binary against a
//! real temp git repo and a seeded two-file ledger (`sessions.db` +
//! `changes.db`).
//!
//! The library resolves the per-instance `sessions.db` via
//! `tugcore::instance::sessions_db_path` (without `TUG_INSTANCE_ID` it falls
//! back to `$HOME/Library/Application Support/Tug/sessions.db`) and the
//! machine-global `changes.db` via `tugcore::instance::changes_db_path`.
//! Each test overrides `HOME` on the child process (and scrubs the
//! `TUG_CHANGES_DB` override) so both lookups land on seeded files, fully
//! isolated from the developer's real ledger.

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

/// A temp `$HOME` seeded with the two-file ledger the binary reads: the
/// per-instance `sessions.db` (the `sessions` table) and the machine-global
/// `changes.db` (the `file_events` table, [D112]) — both under
/// `Library/Application Support/Tug/`. Seeds `session` ("work", with a
/// `feature.rs` created event) and an empty `empty` session row.
fn seed_home(repo_root: &Path) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let db_dir = home.path().join("Library/Application Support/Tug");
    std::fs::create_dir_all(&db_dir).unwrap();
    let sessions = Connection::open(db_dir.join("sessions.db")).unwrap();
    sessions
        .execute_batch("CREATE TABLE sessions (session_id TEXT PRIMARY KEY);")
        .unwrap();
    sessions
        .execute(
            "INSERT INTO sessions (session_id) VALUES ('work'), ('empty')",
            [],
        )
        .unwrap();
    let changes = Connection::open(db_dir.join("changes.db")).unwrap();
    changes
        .execute_batch(
            "CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
    changes
        .execute(
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
    cmd.env_remove("TUG_CHANGES_DB");
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
    assert_eq!(v["command"], "changes");
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
    assert_eq!(v["command"], "context");
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
    cmd.args([
        "commit",
        "--json",
        "--session",
        "work",
        "--message",
        "add feature",
    ]);
    cmd.args(project_arg(&root));

    let (code, stdout, stderr) = run(cmd);
    assert_eq!(code, 0, "stderr: {stderr}");
    let v = parse(&stdout);
    assert_eq!(v["command"], "commit");
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
    assert_eq!(v["command"], "log");
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
    assert_eq!(v["command"], "diff");
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

// --- Bucket surfacing + commit disposition (Steps 3–5) --------------------

/// A temp `$HOME` seeding a `file_events` row per `(session, repo_relative_path)`
/// (all `project_dir = repo_root`, `created`), registering each distinct session
/// plus an empty `empty` session — the multi-session fixture the bucket tests
/// need (the same path under two sessions makes it `shared` for both).
/// `file_path` is stored repo-relative, the capture-time form the per-path
/// contention query joins on.
fn seed_home_events(repo_root: &Path, events: &[(&str, &str)]) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let db_dir = home.path().join("Library/Application Support/Tug");
    std::fs::create_dir_all(&db_dir).unwrap();
    let sessions = Connection::open(db_dir.join("sessions.db")).unwrap();
    sessions
        .execute_batch("CREATE TABLE sessions (session_id TEXT PRIMARY KEY);")
        .unwrap();
    sessions
        .execute("INSERT INTO sessions (session_id) VALUES ('empty')", [])
        .unwrap();
    let changes = Connection::open(db_dir.join("changes.db")).unwrap();
    changes
        .execute_batch(
            "CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
    for (i, (session, path)) in events.iter().enumerate() {
        sessions
            .execute(
                "INSERT OR IGNORE INTO sessions (session_id) VALUES (?1)",
                [session],
            )
            .unwrap();
        changes
            .execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', 'created', 'exact', 0, ?4, ?5)",
                rusqlite::params![
                    session,
                    format!("tu-{i}"),
                    path,
                    repo_root.to_string_lossy().to_string(),
                    i as i64
                ],
            )
            .unwrap();
    }
    home
}

/// `git status --porcelain` output at `root`.
fn status_porcelain(root: &Path) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn context_surfaces_an_unattributed_file_with_a_diff() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["context", "--json", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    // feature.rs is this session's (attributed); orphan.rs has no rows.
    let files = v["data"]["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["path"] == "feature.rs"));
    let un = v["data"]["unattributed"].as_array().unwrap();
    assert_eq!(un.len(), 1);
    assert_eq!(un[0]["path"], "orphan.rs");
    assert_eq!(un[0]["op"], "unknown");
    assert_eq!(un[0]["origin"], "none");
    assert!(
        un[0]["diff"].as_str().unwrap().contains("orphan.rs"),
        "unattributed carries a diff"
    );
}

#[test]
fn default_commit_refuses_unattributed_with_exit_three() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args(["commit", "--session", "work", "--message", "m"]);
    cmd.args(project_arg(&root));

    let (code, _out, err) = run(cmd);
    assert_eq!(code, 3, "refusal is exit 3; stderr: {err}");
    assert!(err.contains("orphan.rs"), "names the file: {err}");
    assert!(
        err.contains("--include-unattributed") && err.contains("--tree"),
        "names the disposition flags: {err}"
    );
    // Nothing committed: both files still dirty, HEAD still at init.
    let status = status_porcelain(&root);
    assert!(
        status.contains("orphan.rs") && status.contains("feature.rs"),
        "tree still dirty: {status}"
    );
}

#[test]
fn include_unattributed_commits_the_orphan_file() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args([
        "commit",
        "--json",
        "--session",
        "work",
        "--message",
        "m",
        "--include-unattributed",
    ]);
    cmd.args(project_arg(&root));

    let (code, out, err) = run(cmd);
    assert_eq!(code, 0, "stderr: {err}");
    let v = parse(&out);
    let paths: Vec<&str> = v["data"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(
        paths.contains(&"feature.rs") && paths.contains(&"orphan.rs"),
        "committed both: {paths:?}"
    );
}

#[test]
fn leave_unattributed_proceeds_and_records_left_behind() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    let home = seed_home(&root);
    let mut cmd = tug(home.path());
    cmd.args([
        "commit",
        "--json",
        "--session",
        "work",
        "--message",
        "m",
        "--leave-unattributed",
    ]);
    cmd.args(project_arg(&root));

    let (code, out, err) = run(cmd);
    assert_eq!(code, 0, "stderr: {err}");
    let v = parse(&out);
    // Committed feature.rs only.
    let files = v["data"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "feature.rs");
    // The held-back orphan is named in left_behind.
    let lb: Vec<&str> = v["data"]["left_behind"]["unattributed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert_eq!(lb, vec!["orphan.rs"]);
}

#[test]
fn tree_commits_attributed_unattributed_and_shared() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("both.rs"), "both\n").unwrap();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    // work claims feature.rs alone and both.rs jointly with `other` (so both.rs
    // is shared for work); orphan.rs has no rows.
    let home = seed_home_events(
        &root,
        &[
            ("work", "feature.rs"),
            ("work", "both.rs"),
            ("other", "both.rs"),
        ],
    );

    // Default base excludes the shared file: without --all/--tree, a commit
    // that leaves the orphan behind commits feature.rs only.
    let mut cmd = tug(home.path());
    cmd.args([
        "commit",
        "--json",
        "--session",
        "work",
        "--message",
        "m1",
        "--leave-unattributed",
    ]);
    cmd.args(project_arg(&root));
    let (code, out, err) = run(cmd);
    assert_eq!(code, 0, "stderr: {err}");
    let v = parse(&out);
    let files = v["data"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1, "shared file excluded from the default base");
    assert_eq!(files[0]["path"], "feature.rs");
    let lb_shared: Vec<&str> = v["data"]["left_behind"]["shared"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert_eq!(
        lb_shared,
        vec!["both.rs"],
        "the receipt names the held-back shared file"
    );

    // --tree then sweeps everything but foreign: shared + unattributed included.
    let mut cmd = tug(home.path());
    cmd.args([
        "commit",
        "--json",
        "--session",
        "work",
        "--message",
        "m2",
        "--tree",
    ]);
    cmd.args(project_arg(&root));
    let (code, out, err) = run(cmd);
    assert_eq!(code, 0, "stderr: {err}");
    let v = parse(&out);
    let paths: Vec<&str> = v["data"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(
        paths.contains(&"both.rs"),
        "shared included by --tree: {paths:?}"
    );
    assert!(
        paths.contains(&"orphan.rs"),
        "unattributed included by --tree: {paths:?}"
    );
    // Whole tree committed → clean.
    assert!(
        status_porcelain(&root).trim().is_empty(),
        "tree clean after --tree commit"
    );
}
