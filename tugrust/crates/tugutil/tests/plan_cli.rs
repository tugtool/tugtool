//! `tugutil plan lint` and `tugutil plan review-request`.
//!
//! Lint's three outcomes are distinct on purpose: a warnings-only run is still
//! a usable plan (exit 0, `status: "ok"`), an error diagnostic gates (exit 1,
//! `status: "error"`), and a document that is not a plan at all is neither
//! clean nor dirty (exit 2).
//!
//! `review-request` has two: it reaches a running instance, or it fails with a
//! remedy the skill can act on. The second is not an edge case — a project
//! without a running Tug is where the gesture has to degrade to the old
//! two-step rather than silently skip the review.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc;

use assert_cmd::cargo::CommandCargoExt;

/// A plan carrying every required section and one clean step.
const CONFORMING: &str = r#"## A Conforming Plan {#conforming-plan}

### Plan Metadata {#plan-metadata}

| Field | Value |
|---|---|
| Owner | Someone |

### Review Record {#review-record}

**Round 1 — 2026-08-13, opus.** Lint: 0 errors.

### Phase Overview {#phase-overview}

Some context.

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | The only step | pending | — |

#### Step 1: The only step {#step-1}

**Commit:** `thing(scope): do it`

**References:** [P01] the decision, (#phase-overview)

**Tasks:**
- [ ] Do the thing.

**Tests:**
- [ ] Unit: the thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** the thing.
"#;

fn lint(path: &Path, json: bool) -> (i32, String) {
    let mut cmd = Command::cargo_bin("tugutil").unwrap();
    if json {
        cmd.arg("--json");
    }
    let out = cmd.args(["plan", "lint"]).arg(path).output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
    )
}

fn write(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    path
}

#[test]
fn a_conforming_plan_exits_zero() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), "plan.md", CONFORMING);
    let (code, stdout) = lint(&path, false);
    assert_eq!(code, 0, "{stdout}");
    assert!(stdout.contains("0 errors"), "{stdout}");
}

#[test]
fn a_warnings_only_plan_still_exits_zero() {
    let dir = tempfile::tempdir().unwrap();
    // Dropping the Review Record leaves a PL023 warning and nothing else.
    let body = CONFORMING.replace(
        "### Review Record {#review-record}\n\n**Round 1 — 2026-08-13, opus.** Lint: 0 errors.\n\n",
        "",
    );
    let path = write(dir.path(), "plan.md", &body);
    let (code, stdout) = lint(&path, false);
    assert_eq!(code, 0, "{stdout}");
    assert!(stdout.contains("PL023"), "{stdout}");
    assert!(stdout.contains("0 errors, 1 warning"), "{stdout}");
}

#[test]
fn a_seeded_error_exits_one_and_names_the_code() {
    let dir = tempfile::tempdir().unwrap();
    let body = CONFORMING.replace("**Commit:** `thing(scope): do it`\n\n", "");
    let path = write(dir.path(), "plan.md", &body);
    let (code, stdout) = lint(&path, false);
    assert_eq!(code, 1, "{stdout}");
    assert!(stdout.contains("PL008"), "{stdout}");
    assert!(stdout.contains("error"), "{stdout}");
}

#[test]
fn a_brief_exits_two() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(
        dir.path(),
        "brief.md",
        "## How we got here\n\nSome prose.\n\n## What is open\n\nMore prose.\n",
    );
    let mut cmd = Command::cargo_bin("tugutil").unwrap();
    let out = cmd.args(["plan", "lint"]).arg(&path).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("not a plan document"), "{stderr}");
}

#[test]
fn a_missing_file_exits_two() {
    let dir = tempfile::tempdir().unwrap();
    let (code, _) = lint(&dir.path().join("nope.md"), false);
    assert_eq!(code, 2);
}

#[test]
fn json_carries_the_envelope_and_the_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    let body = CONFORMING.replace(
        "### Review Record {#review-record}\n\n**Round 1 — 2026-08-13, opus.** Lint: 0 errors.\n\n",
        "",
    );
    let path = write(dir.path(), "plan.md", &body);
    let (code, stdout) = lint(&path, true);
    assert_eq!(code, 0, "{stdout}");
    let value: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(value["schema_version"], "1");
    assert_eq!(value["command"], "plan lint");
    assert_eq!(value["status"], "ok");
    assert_eq!(value["data"]["errors"], 0);
    assert_eq!(value["data"]["warnings"], 1);
    let issues = value["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0]["code"], "PL023");
    assert_eq!(issues[0]["severity"], "warning");
}

/// A one-shot stand-in for a running tugcast: accepts POSTs, hands each JSON
/// body back over a channel, and answers `{"status":"ok"}`.
fn fake_tugcast() -> (u16, mpsc::Receiver<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if let Some(value) = line
                    .to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .and_then(|v| v.trim().parse::<usize>().ok())
                {
                    length = value;
                }
                if line == "\r\n" || line == "\n" {
                    break;
                }
            }
            let mut body = vec![0u8; length];
            let _ = reader.read_exact(&mut body);
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&body) {
                let _ = tx.send(value);
            }
            let payload = br#"{"status":"ok"}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            let _ = stream.write_all(payload);
            let _ = stream.flush();
        }
    });
    (port, rx)
}

#[test]
fn review_request_sends_the_session_and_an_absolute_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), "plan.md", CONFORMING);
    let (port, rx) = fake_tugcast();

    let out = Command::cargo_bin("tugutil")
        .unwrap()
        .env("TUG_SESSION_ID", "sess-42")
        .current_dir(dir.path())
        .args([
            "plan",
            "review-request",
            "--plan",
            "plan.md",
            "--port",
            &port.to_string(),
        ])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let body = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the CLI posted a body");
    assert_eq!(body["tug_session_id"], "sess-42");
    // Relative on the command line, absolute on the wire — the card does not
    // share the cwd the skill ran in.
    let sent = body["plan_path"].as_str().unwrap();
    assert!(Path::new(sent).is_absolute(), "{sent}");
    assert!(sent.ends_with("plan.md"), "{sent}");
    assert_eq!(
        std::fs::canonicalize(sent).unwrap(),
        std::fs::canonicalize(&path).unwrap()
    );
}

#[test]
fn review_request_with_no_reachable_instance_names_the_manual_command() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(dir.path(), "plan.md", CONFORMING);
    // An empty registry under the child's $TMPDIR: discovery finds nothing.
    std::fs::write(
        dir.path().join("tug-instances.json"),
        br#"{"version":1,"instances":[]}"#,
    )
    .unwrap();

    let out = Command::cargo_bin("tugutil")
        .unwrap()
        .env_remove("TUG_INSTANCE")
        .env("TUG_SESSION_ID", "sess-42")
        .env("TMPDIR", dir.path())
        .env("TUG_DATA_DIR", dir.path().join("state"))
        .current_dir(dir.path())
        .args(["plan", "review-request", "--plan"])
        .arg(&path)
        .output()
        .unwrap();
    assert_ne!(out.status.code(), Some(0));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("/tugplug:review-plan"),
        "the remedy has to name the command the user can run by hand: {stderr}"
    );
}

#[test]
fn review_request_refuses_a_plan_that_is_not_there() {
    let dir = tempfile::tempdir().unwrap();
    let out = Command::cargo_bin("tugutil")
        .unwrap()
        .env("TUG_SESSION_ID", "sess-42")
        .args(["plan", "review-request", "--plan"])
        .arg(dir.path().join("nope.md"))
        .output()
        .unwrap();
    assert_ne!(out.status.code(), Some(0));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("no plan at"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn json_reports_error_status_when_a_run_carries_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let body = CONFORMING.replace("**Checkpoint:**\n- [ ] `cargo nextest run`\n", "");
    let path = write(dir.path(), "plan.md", &body);
    let (code, stdout) = lint(&path, true);
    assert_eq!(code, 1, "{stdout}");
    let value: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(value["status"], "error");
    let issues = value["issues"].as_array().unwrap();
    let pl012 = issues
        .iter()
        .find(|i| i["code"] == "PL012")
        .unwrap_or_else(|| panic!("expected PL012 in {issues:#?}"));
    assert_eq!(pl012["severity"], "error");
    assert_eq!(pl012["anchor"], "#step-1");
    assert!(pl012["line"].is_number(), "{pl012}");
}
