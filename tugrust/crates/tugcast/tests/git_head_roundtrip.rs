//! Live proof of the event-driven GIT_HEAD signal path.
//!
//! Spins up a real `tugcast` on a temp repo (its `--source-tree` bootstrap
//! workspace), makes an **external** commit in that repo, and asserts a
//! `GIT_HEAD` (0x27) frame arrives over the WebSocket carrying the workspace
//! key and the new HEAD sha — exercising the full path (FSEvents git watch →
//! HEAD-sha change → broadcast → wire) with no polling and no client action.
//!
//! Needs only `git` + the harness's `tmux`; no `claude`, so it runs in the
//! default suite.
//!
//! Run: `cargo nextest run -p tugcast --test git_head_roundtrip`

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use tempfile::{NamedTempFile, TempDir};

mod common;
use common::{TestTugcast, TestWs};

const WIRE_TIMEOUT: Duration = Duration::from_secs(10);
const SIGNAL_TIMEOUT: Duration = Duration::from_secs(20);

fn git(repo: &Path, args: &[&str]) {
    let mut full = vec!["-C", repo.to_str().unwrap()];
    full.extend_from_slice(args);
    let out = Command::new("git").args(&full).output().expect("run git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let mut full = vec!["-C", repo.to_str().unwrap()];
    full.extend_from_slice(args);
    let out = Command::new("git").args(&full).output().expect("run git");
    assert!(out.status.success(), "git {args:?} failed");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn make_repo() -> TempDir {
    let temp = TempDir::new().expect("repo tempdir");
    let repo = temp.path();
    git(repo, &["init", "-b", "main"]);
    git(repo, &["config", "user.name", "test"]);
    git(repo, &["config", "user.email", "test@test.com"]);
    std::fs::write(repo.join("first.txt"), "x\n").unwrap();
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-m", "first"]);
    temp
}

#[tokio::test]
async fn external_commit_broadcasts_git_head_signal() {
    let repo = make_repo();
    let temp_bank = NamedTempFile::new().expect("temp bank file");
    let bank_path = temp_bank.path().to_path_buf();
    drop(temp_bank);
    let tc = TestTugcast::spawn(repo.path(), bank_path).await;
    let mut ws = TestWs::connect(tc.port).await;

    // Learn the bootstrap workspace_key (and let the watch arm).
    ws.send_git_log_query(None, "gh-warm", Some(1)).await;
    let resp = ws
        .await_git_log("gh-warm", WIRE_TIMEOUT)
        .await
        .expect("git_log response");
    let ws_key = resp["workspace_key"].as_str().unwrap().to_string();
    assert!(!ws_key.is_empty());

    // An external commit — nothing on the client asked for this.
    std::fs::write(repo.path().join("second.txt"), "y\n").unwrap();
    git(repo.path(), &["add", "-A"]);
    git(repo.path(), &["commit", "-m", "external commit"]);
    let new_head = git_stdout(repo.path(), &["rev-parse", "HEAD"]);

    // The FSEvents git watch detects the HEAD move and broadcasts GIT_HEAD.
    let signal = ws
        .await_git_head(&ws_key, SIGNAL_TIMEOUT)
        .await
        .expect("GIT_HEAD signal within timeout");
    assert_eq!(signal["workspace_key"], ws_key);
    assert_eq!(signal["head"], new_head, "signal carries the new HEAD sha");
}
