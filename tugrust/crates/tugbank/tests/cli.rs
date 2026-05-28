//! Integration tests for the `tugbank` CLI binary.
//!
//! These tests exercise all subcommands via `assert_cmd` + `tempfile`,
//! verifying both text and JSON output, exit codes, and path resolution.

use assert_cmd::Command;
use tempfile::NamedTempFile;

/// Build a `tugbank` command configured to use the given temp database.
fn cmd(db: &NamedTempFile) -> Command {
    let mut c = Command::cargo_bin("tugbank").expect("tugbank binary not found");
    c.arg("--path").arg(db.path());
    c
}

// ── path resolution: --path > TUGBANK_PATH > legacy ────────────

#[test]
fn t10_path_flag_overrides_env() {
    let db_flag = NamedTempFile::new().unwrap();
    let db_env = NamedTempFile::new().unwrap();

    // Write a domain to db_flag only via --path.
    let status = Command::cargo_bin("tugbank")
        .unwrap()
        .arg("--path")
        .arg(db_flag.path())
        .args(["write", "flag-domain", "k", "v"])
        .output()
        .unwrap()
        .status;
    assert!(status.success());

    // With both --path and TUGBANK_PATH set, --path must win.
    let output = Command::cargo_bin("tugbank")
        .unwrap()
        .arg("--path")
        .arg(db_flag.path())
        .env("TUGBANK_PATH", db_env.path())
        .arg("--json")
        .arg("domains")
        .output()
        .unwrap();
    assert!(output.status.success());
    let s = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(
        domains.iter().any(|d| d.as_str() == Some("flag-domain")),
        "expected flag-domain via --path; got: {domains:?}"
    );
}

#[test]
fn t10_env_overrides_default() {
    let db_env = NamedTempFile::new().unwrap();

    // Write to db_env via TUGBANK_PATH.
    let status = Command::cargo_bin("tugbank")
        .unwrap()
        .env("TUGBANK_PATH", db_env.path())
        .args(["write", "env-domain", "k", "v"])
        .output()
        .unwrap()
        .status;
    assert!(status.success());

    // Read back using TUGBANK_PATH (no --path flag).
    let output = Command::cargo_bin("tugbank")
        .unwrap()
        .env("TUGBANK_PATH", db_env.path())
        .arg("--json")
        .arg("domains")
        .output()
        .unwrap();
    assert!(output.status.success());
    let s = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(
        domains.iter().any(|d| d.as_str() == Some("env-domain")),
        "expected env-domain via TUGBANK_PATH; got: {domains:?}"
    );
}

// ── value round-trip (representative type) ─────────────────────

#[test]
fn t11_roundtrip_string() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "hello world"])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hello world");
}

// ── --type bytes --bytes-file ──────────────────────────────────

#[test]
fn t12_write_bytes_file() {
    use std::io::Write as _;
    let tmp_db = NamedTempFile::new().unwrap();
    let mut tmp_file = NamedTempFile::new().unwrap();
    let file_contents = b"\x00\x01\x02hello\xFF";
    tmp_file.write_all(file_contents).unwrap();

    cmd(&tmp_db)
        .args(["write", "d", "k", "--type", "bytes", "--bytes-file"])
        .arg(tmp_file.path())
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write --bytes-file should succeed");

    let out = cmd(&tmp_db).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    // Output should be base64 of the file contents.
    use base64::Engine as _;
    let expected_b64 = base64::engine::general_purpose::STANDARD.encode(file_contents);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout).trim(),
        expected_b64,
        "bytes-file roundtrip mismatch"
    );
}

// ── exit codes / missing-key behavior ──────────────────────────

#[test]
fn t14_read_missing_key_exits_2() {
    let tmp = NamedTempFile::new().unwrap();
    let out = cmd(&tmp).args(["read", "d", "missing"]).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "expected exit code 2 for missing key"
    );
}

// ── read domain (lists all pairs) ──────────────────────────────

#[test]
fn t15_read_domain_lists_all_pairs_text() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "alpha", "aaa"])
        .output()
        .unwrap();
    cmd(&tmp)
        .args(["write", "d", "beta", "--type", "int", "7"])
        .output()
        .unwrap();
    let out = cmd(&tmp).args(["read", "d"]).output().unwrap();
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    // BTreeMap order: alpha < beta
    let lines: Vec<&str> = text.trim().split('\n').collect();
    assert_eq!(lines.len(), 2, "expected 2 lines, got: {text:?}");
    assert!(
        lines[0].starts_with("alpha\tstring\t"),
        "first line: {}",
        lines[0]
    );
    assert!(
        lines[1].starts_with("beta\tint\t"),
        "second line: {}",
        lines[1]
    );
}

// ── delete key ─────────────────────────────────────────────────

#[test]
fn t18_delete_key_exists_exits_0() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp).args(["write", "d", "k", "v"]).output().unwrap();
    let out = cmd(&tmp).args(["delete", "d", "k"]).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "delete on existing key should exit 0"
    );
    // Verify key is gone.
    let read = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert_eq!(
        read.status.code(),
        Some(2),
        "key should be gone after delete"
    );
}

// ── delete entire domain ───────────────────────────────────────

#[test]
fn t20_delete_domain_removes_all_exits_0() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp).args(["write", "d", "k1", "v1"]).output().unwrap();
    cmd(&tmp).args(["write", "d", "k2", "v2"]).output().unwrap();

    // Delete the entire domain (no key argument).
    let out = cmd(&tmp).args(["delete", "d"]).output().unwrap();
    assert_eq!(out.status.code(), Some(0), "delete domain should exit 0");

    // Domain should no longer appear in list.
    let dom_out = cmd(&tmp).arg("--json").arg("domains").output().unwrap();
    let s = String::from_utf8_lossy(&dom_out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(
        !domains.iter().any(|d| d.as_str() == Some("d")),
        "deleted domain should not appear in domains list: {domains:?}"
    );
}

// ── CAS (compare-and-swap) ─────────────────────────────────────

#[test]
fn t23_cas_write_stale_generation_exits_3() {
    let tmp = NamedTempFile::new().unwrap();
    // Write once so generation becomes 1.
    cmd(&tmp)
        .args(["write", "d", "k", "first"])
        .output()
        .unwrap();

    // Attempt write --generation with stale gen=0 (current is 1).
    let out = cmd(&tmp)
        .args(["write", "d", "k", "--generation", "0", "second"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(3),
        "write --generation with stale generation should exit 3"
    );

    // Original value must be unchanged.
    let read = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&read.stdout).trim(), "first");
}

// ── end-to-end ─────────────────────────────────────────────────

#[test]
fn t25_end_to_end_workflow() {
    let tmp = NamedTempFile::new().unwrap();

    // 1. Write several values across two domains.
    cmd(&tmp)
        .args(["write", "app.prefs", "theme", "dark"])
        .output()
        .unwrap();
    cmd(&tmp)
        .args(["write", "app.prefs", "font-size", "--type", "int", "14"])
        .output()
        .unwrap();
    cmd(&tmp)
        .args(["write", "app.state", "last-open", "file.txt"])
        .output()
        .unwrap();

    // 2. Verify domains.
    let dom_out = cmd(&tmp).arg("--json").arg("domains").output().unwrap();
    assert!(dom_out.status.success());
    let s = String::from_utf8_lossy(&dom_out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).unwrap();
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(domains.iter().any(|d| d.as_str() == Some("app.prefs")));
    assert!(domains.iter().any(|d| d.as_str() == Some("app.state")));

    // 3. Read values back.
    let theme = cmd(&tmp)
        .args(["read", "app.prefs", "theme"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&theme.stdout).trim(), "dark");

    let font = cmd(&tmp)
        .args(["read", "app.prefs", "font-size"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&font.stdout).trim(), "14");

    // 4. Delete one key.
    let del = cmd(&tmp)
        .args(["delete", "app.prefs", "font-size"])
        .output()
        .unwrap();
    assert!(del.status.success());

    // Verify deleted key is gone.
    let gone = cmd(&tmp)
        .args(["read", "app.prefs", "font-size"])
        .output()
        .unwrap();
    assert_eq!(gone.status.code(), Some(2));

    // 5. Delete entire app.state domain.
    let del_dom = cmd(&tmp).args(["delete", "app.state"]).output().unwrap();
    assert!(del_dom.status.success());

    // Verify app.state no longer listed.
    let dom_out2 = cmd(&tmp).arg("--json").arg("domains").output().unwrap();
    let s2 = String::from_utf8_lossy(&dom_out2.stdout);
    let v2: serde_json::Value = serde_json::from_str(s2.trim()).unwrap();
    let domains2 = v2["data"]["domains"].as_array().unwrap();
    assert!(
        !domains2.iter().any(|d| d.as_str() == Some("app.state")),
        "app.state should be gone after delete: {domains2:?}"
    );

    // app.prefs should still exist (only font-size was deleted, theme remains).
    assert!(
        domains2.iter().any(|d| d.as_str() == Some("app.prefs")),
        "app.prefs should still exist: {domains2:?}"
    );
}
