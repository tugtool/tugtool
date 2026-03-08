//! Integration tests for the `tugbank` CLI binary.
//!
//! These tests exercise all subcommands via `assert_cmd` + `tempfile`,
//! verifying both text and JSON output, exit codes, and path resolution.

use assert_cmd::Command;
use assert_cmd::cargo_bin_cmd;
use tempfile::NamedTempFile;

/// Build a `tugbank` command configured to use the given temp database.
fn cmd(db: &NamedTempFile) -> Command {
    let mut c = cargo_bin_cmd!("tugbank");
    c.arg("--path").arg(db.path());
    c
}

// ── T06: --help exits 0 ───────────────────────────────────────────────────────

#[test]
fn t06_help_exits_0() {
    let output = cargo_bin_cmd!("tugbank").arg("--help").output().unwrap();
    assert!(output.status.success(), "--help should exit 0");
}

// ── T07: domains on empty database ───────────────────────────────────────────

#[test]
fn t07_domains_empty_text() {
    let tmp = NamedTempFile::new().unwrap();
    let output = cmd(&tmp).arg("domains").output().unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
}

#[test]
fn t07_domains_empty_json() {
    let tmp = NamedTempFile::new().unwrap();
    let output = cmd(&tmp).arg("--json").arg("domains").output().unwrap();
    assert!(output.status.success());
    let s = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["domains"], serde_json::json!([]));
}

// ── T08: keys on empty domain ─────────────────────────────────────────────────

#[test]
fn t08_keys_empty_text() {
    let tmp = NamedTempFile::new().unwrap();
    let output = cmd(&tmp).args(["keys", "com.example"]).output().unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
}

#[test]
fn t08_keys_empty_json() {
    let tmp = NamedTempFile::new().unwrap();
    let output = cmd(&tmp)
        .arg("--json")
        .args(["keys", "com.example"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let s = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["keys"], serde_json::json!([]));
}

// ── T09: generation on unwritten domain prints 0 ─────────────────────────────

#[test]
fn t09_generation_unwritten_domain() {
    let tmp = NamedTempFile::new().unwrap();
    let output = cmd(&tmp)
        .args(["generation", "com.example"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "0");
}

// ── T10: path resolution: --path > TUGBANK_PATH > default ────────────────────

#[test]
fn t10_path_flag_overrides_env() {
    let db_flag = NamedTempFile::new().unwrap();
    let db_env = NamedTempFile::new().unwrap();

    // Write a domain to db_flag only via --path.
    let status = cargo_bin_cmd!("tugbank")
        .arg("--path")
        .arg(db_flag.path())
        .args(["write", "flag-domain", "k", "v"])
        .output()
        .unwrap()
        .status;
    assert!(status.success());

    // With both --path and TUGBANK_PATH set, --path must win.
    let output = cargo_bin_cmd!("tugbank")
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
    let status = cargo_bin_cmd!("tugbank")
        .env("TUGBANK_PATH", db_env.path())
        .args(["write", "env-domain", "k", "v"])
        .output()
        .unwrap()
        .status;
    assert!(status.success());

    // Read back using TUGBANK_PATH (no --path flag).
    let output = cargo_bin_cmd!("tugbank")
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
