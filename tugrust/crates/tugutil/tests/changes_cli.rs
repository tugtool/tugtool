//! Integration tests for the `tug` CLI, driving the built binary against a
//! real temp git repo and a seeded two-file ledger (`sessions.db` +
//! `changes.db`).
//!
//! Both ledgers are pointed at seeded temp files via explicit env overrides —
//! `TUG_SESSIONS_DB` for the per-instance `sessions.db` and `TUG_CHANGES_DB`
//! for the machine-global `changes.db`. This keeps the suite fully isolated
//! from the developer's real ledger and platform-independent: `dirs::data_dir()`
//! resolves differently on Linux (`XDG_DATA_HOME`) than macOS, so seeding via
//! `HOME` alone would not survive CI (ubuntu).

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

/// A temp dir seeded with the two-file ledger the binary reads: the
/// per-instance `sessions.db` (the `sessions` table) and the machine-global
/// `changes.db` (the `file_events` table, [D112]). Seeds `session` ("work",
/// with a `feature.rs` created event) and an empty `empty` session row. The
/// returned dir is handed to [`tug`], which points `TUG_SESSIONS_DB` and
/// `TUG_CHANGES_DB` at the two files.
fn seed_ledger(repo_root: &Path) -> tempfile::TempDir {
    let db_dir = tempfile::tempdir().unwrap();
    let sessions = Connection::open(db_dir.path().join("sessions.db")).unwrap();
    sessions
        .execute_batch("CREATE TABLE sessions (session_id TEXT PRIMARY KEY);")
        .unwrap();
    sessions
        .execute(
            "INSERT INTO sessions (session_id) VALUES ('work'), ('empty')",
            [],
        )
        .unwrap();
    let changes = Connection::open(db_dir.path().join("changes.db")).unwrap();
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
    db_dir
}

/// A `tug` command with both ledgers pointed at the seeded `db_dir` via the
/// `TUG_SESSIONS_DB` / `TUG_CHANGES_DB` overrides, and no instance id.
fn tug(db_dir: &Path) -> Command {
    let mut cmd = Command::cargo_bin("tugutil").unwrap();
    cmd.env_remove("TUG_INSTANCE_ID");
    cmd.env_remove("TUG_SESSION_ID");
    cmd.env("TUG_SESSIONS_DB", db_dir.join("sessions.db"));
    cmd.env("TUG_CHANGES_DB", db_dir.join("changes.db"));
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
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
fn preflight_plain_is_directly_readable_no_reshaping_needed() {
    // The default (non-JSON) read-out must carry everything a commit agent
    // needs — header, per-file op·origin, buckets — so nothing has to be piped
    // through jq/python/grep.
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
    cmd.args(["preflight", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    assert!(stdout.contains("branch main"), "header line: {stdout}");
    assert!(
        stdout.contains("session work"),
        "names the session: {stdout}"
    );
    assert!(
        stdout.contains("attributed (1):"),
        "labeled bucket: {stdout}"
    );
    // The attributed file carries its op·origin inline (created·exact here).
    assert!(
        stdout.contains("created·exact") && stdout.contains("feature.rs"),
        "per-file op·origin present: {stdout}"
    );
    assert!(
        stdout.contains("recent commits:"),
        "history section: {stdout}"
    );
}

#[test]
fn a_bash_bracket_row_hints_but_never_auto_commits() {
    // Correlation never decides, not even for self: a file this session's own
    // Bash bracket saw change (which could equally be the user's hand-save
    // during the command) surfaces as `unattributed` with a named hint, the
    // default commit refuses (exit 3), and inclusion is the explicit
    // `--include-unattributed` election.
    let (_repo, root) = init_repo();
    std::fs::write(root.join("swept.rs"), "swept\n").unwrap();
    let ledger = seed_ledger(&root);
    let changes = Connection::open(ledger.path().join("changes.db")).unwrap();
    changes
        .execute(
            "INSERT INTO file_events
                (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
             VALUES ('work', 'tu-b', ?1, 'Bash', 'modified', 'bash', 0, ?2, 2)",
            rusqlite::params![
                root.join("swept.rs").to_string_lossy().to_string(),
                root.to_string_lossy().to_string()
            ],
        )
        .unwrap();

    let mut cmd = tug(ledger.path());
    cmd.args(["preflight", "--session", "work"]);
    cmd.args(project_arg(&root));
    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    assert!(stdout.contains("attributed (1):"), "{stdout}");
    assert!(stdout.contains("unattributed (1):"), "{stdout}");
    assert!(
        stdout.contains("swept.rs  likely this session's (bash bracket)"),
        "the hint names the bracket: {stdout}"
    );

    let mut refuse = tug(ledger.path());
    refuse.args(["commit", "--message", "m", "--session", "work"]);
    refuse.args(project_arg(&root));
    let (code, _, stderr) = run(refuse);
    assert_eq!(code, 3, "a hinted file still refuses by default: {stderr}");
    assert!(stderr.contains("swept.rs"), "{stderr}");

    let mut include = tug(ledger.path());
    include.args([
        "commit",
        "--message",
        "take both",
        "--include-unattributed",
        "--session",
        "work",
    ]);
    include.args(project_arg(&root));
    let (code, stdout, stderr) = run(include);
    assert_eq!(code, 0, "explicit election commits: {stderr}");
    assert!(stdout.contains("committed"), "{stdout}");
    assert!(
        status_porcelain(&root).is_empty(),
        "tree clean after commit"
    );
}

#[test]
fn preflight_json_matches_s02_shape() {
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
    cmd.args(["preflight", "--json", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["command"], "preflight");
    let data = &v["data"];
    assert_eq!(data["session"], "work");
    assert_eq!(data["branch"], "main");
    assert!(data["repo_root"].is_string());
    assert!(!data["head"].as_str().unwrap().is_empty());
    let files = data["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    // Preflight always carries a diff — a created file gets a real add-diff.
    let diff = files[0]["diff"].as_str().unwrap();
    assert!(diff.contains("feature.rs"), "add-diff present: {diff}");
    let commits = data["recent_commits"].as_array().unwrap();
    assert_eq!(commits[0]["subject"], "init");
}

#[test]
fn commit_json_stages_the_session_file_and_matches_numstat() {
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger(&root);
    // Modify a tracked file so the working-tree diff is non-empty.
    std::fs::write(root.join("base.rs"), "base\nmore\n").unwrap();
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger(&root);

    // Unknown session → exit 2.
    let mut cmd = tug(ledger.path());
    cmd.args(["changes", "--session", "ghost"]);
    cmd.args(project_arg(&root));
    let (code, _, stderr) = run(cmd);
    assert_eq!(code, 2, "unknown session exits 2");
    assert!(stderr.contains("unknown"), "stderr: {stderr}");

    // Known-but-empty session → exit 0, no files listed.
    let mut cmd = tug(ledger.path());
    cmd.args(["changes", "--session", "empty"]);
    cmd.args(project_arg(&root));
    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0, "valid empty session exits 0");
    assert!(stdout.trim().is_empty(), "no paths for an empty session");
}

#[test]
fn no_session_id_exits_two() {
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
    cmd.args(["changes"]);
    cmd.args(project_arg(&root));
    let (code, _, stderr) = run(cmd);
    assert_eq!(code, 2, "no session id exits 2");
    assert!(stderr.contains("no session id"), "stderr: {stderr}");
}

// --- Bucket surfacing + commit disposition (Steps 3–5) --------------------

/// A temp ledger dir seeding a `file_events` row per `(session, repo_relative_path)`
/// (all `project_dir = repo_root`, `created`), registering each distinct session
/// plus an empty `empty` session — the multi-session fixture the bucket tests
/// need (the same path under two sessions makes it `shared` for both).
/// `file_path` is stored repo-relative, the capture-time form the per-path
/// contention query joins on.
fn seed_ledger_events(repo_root: &Path, events: &[(&str, &str)]) -> tempfile::TempDir {
    let db_dir = tempfile::tempdir().unwrap();
    let sessions = Connection::open(db_dir.path().join("sessions.db")).unwrap();
    sessions
        .execute_batch("CREATE TABLE sessions (session_id TEXT PRIMARY KEY);")
        .unwrap();
    sessions
        .execute("INSERT INTO sessions (session_id) VALUES ('empty')", [])
        .unwrap();
    let changes = Connection::open(db_dir.path().join("changes.db")).unwrap();
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
    db_dir
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
fn preflight_surfaces_an_unattributed_file_with_a_diff() {
    let (_repo, root) = init_repo();
    std::fs::write(root.join("orphan.rs"), "orphan\n").unwrap();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
    cmd.args(["preflight", "--json", "--session", "work"]);
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
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
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
    let ledger = seed_ledger_events(
        &root,
        &[
            ("work", "feature.rs"),
            ("work", "both.rs"),
            ("other", "both.rs"),
        ],
    );

    // Default base excludes the shared file: without --all/--tree, a commit
    // that leaves the orphan behind commits feature.rs only.
    let mut cmd = tug(ledger.path());
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
    let mut cmd = tug(ledger.path());
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

#[test]
fn preflight_hidden_context_alias_still_resolves() {
    // Shipped Tug.app bundles carry skill text that says `tugutil context`;
    // the alias holds for one release ([P16]).
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let mut cmd = tug(ledger.path());
    cmd.args(["context", "--json", "--session", "work"]);
    cmd.args(project_arg(&root));

    let (code, stdout, _) = run(cmd);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    // The alias resolves to the renamed verb — envelope speaks `preflight`.
    assert_eq!(v["command"], "preflight");
}

#[test]
fn draft_set_show_round_trip_with_selection() {
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);

    let mut set = tug(ledger.path());
    set.args([
        "draft",
        "set",
        "--owner",
        "session:work",
        "--message",
        "Land the feature\n\n- add feature.rs",
        "--include",
        "notes/scratch.md",
        "--exclude",
        "shared.rs",
    ]);
    set.args(project_arg(&root));
    let (code, _, err) = run(set);
    assert_eq!(code, 0, "stderr: {err}");

    let mut show = tug(ledger.path());
    show.args(["draft", "show", "--json", "--owner", "session:work"]);
    show.args(project_arg(&root));
    let (code, stdout, _) = run(show);
    assert_eq!(code, 0);
    let v = parse(&stdout);
    assert_eq!(v["command"], "draft show");
    let data = &v["data"];
    assert!(
        data["message"].as_str().unwrap().starts_with("Land the feature"),
        "{data}"
    );
    // A CLI-authored draft is an authored draft — always edited.
    assert_eq!(data["edited"], true);
    assert_eq!(data["selection"]["include"][0], "notes/scratch.md");
    assert_eq!(data["selection"]["exclude"][0], "shared.rs");

    // Plain show prints the message directly (no glue needed).
    let mut plain = tug(ledger.path());
    plain.args(["draft", "show", "--owner", "session:work"]);
    plain.args(project_arg(&root));
    let (code, stdout, _) = run(plain);
    assert_eq!(code, 0);
    assert!(stdout.contains("Land the feature"), "{stdout}");
    assert!(stdout.contains("include: notes/scratch.md"), "{stdout}");

    // Clear deletes; a second show errors.
    let mut clear = tug(ledger.path());
    clear.args(["draft", "clear", "--owner", "session:work"]);
    clear.args(project_arg(&root));
    let (code, _, _) = run(clear);
    assert_eq!(code, 0);
    let mut gone = tug(ledger.path());
    gone.args(["draft", "show", "--owner", "session:work"]);
    gone.args(project_arg(&root));
    let (code, _, stderr) = run(gone);
    assert_eq!(code, 1);
    assert!(stderr.contains("no draft on file"), "{stderr}");
}

#[cfg(unix)]
#[test]
fn draft_set_canonicalizes_a_symlinked_project_spelling() {
    // Spec S05: writers store `project_dir` canonical. A draft written under
    // a symlink spelling of the checkout must land under the canonical
    // spelling — and read back through either spelling.
    let (_repo, root) = init_repo();
    let ledger = seed_ledger(&root);
    let link_dir = tempfile::tempdir().unwrap();
    let link = link_dir.path().join("linked-repo");
    std::os::unix::fs::symlink(&root, &link).unwrap();

    let mut set = tug(ledger.path());
    set.args([
        "draft",
        "set",
        "--owner",
        "dash:snippets",
        "--message",
        "Join the snippets work",
        "--project",
    ]);
    set.arg(&link);
    let (code, _, err) = run(set);
    assert_eq!(code, 0, "stderr: {err}");

    // The stored spelling is canonical.
    let changes = Connection::open(ledger.path().join("changes.db")).unwrap();
    let stored: String = changes
        .query_row(
            "SELECT project_dir FROM changeset_drafts WHERE owner_kind = 'dash'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, root.to_string_lossy());

    // The dash owner normalizes to the branch-ref id.
    let owner_id: String = changes
        .query_row(
            "SELECT owner_id FROM changeset_drafts WHERE owner_kind = 'dash'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owner_id, "tugdash/snippets");

    // Show through the raw symlink spelling still finds it.
    let mut show = tug(ledger.path());
    show.args(["draft", "show", "--owner", "dash:snippets", "--project"]);
    show.arg(&link);
    let (code, stdout, _) = run(show);
    assert_eq!(code, 0);
    assert!(stdout.contains("Join the snippets work"), "{stdout}");
}
