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

// ── T11: write then read roundtrip for each value type ───────────────────────

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

#[test]
fn t11_roundtrip_bool() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "bool", "true"])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write bool should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "true");
}

#[test]
fn t11_roundtrip_int() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "int", "42"])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write int should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "42");
}

#[test]
fn t11_roundtrip_float() {
    let tmp = NamedTempFile::new().unwrap();
    // Use 1.5 — exact in f64 and not a recognised mathematical constant.
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "float", "1.5"])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write float should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    let got: f64 = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .expect("output should be a float");
    assert!(
        (got - 1.5_f64).abs() < 1e-9,
        "float roundtrip mismatch: {got}"
    );
}

#[test]
fn t11_roundtrip_json() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "json", r#"{"a":1}"#])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write json should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    let got: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&out.stdout).trim()).expect("valid JSON");
    assert_eq!(got, serde_json::json!({"a": 1}));
}

#[test]
fn t11_roundtrip_bytes() {
    let tmp = NamedTempFile::new().unwrap();
    // base64 of [0x01, 0x02, 0x03]
    let b64 = "AQID";
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "bytes", b64])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write bytes should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), b64);
}

#[test]
fn t11_roundtrip_null() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "null"])
        .output()
        .unwrap()
        .status
        .success()
        .then_some(())
        .expect("write null should succeed");
    let out = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "null");
}

// ── T12: write --bytes-file stores file contents correctly ───────────────────

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

// ── T13: read --json produces valid JSON envelope with type field ─────────────

#[test]
fn t13_read_json_envelope_has_type_field() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k", "--type", "int", "99"])
        .output()
        .unwrap();
    let out = cmd(&tmp)
        .arg("--json")
        .args(["read", "d", "k"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["value"], serde_json::json!(99));
    assert_eq!(v["data"]["type"], "int");
}

// ── T14: read <domain> <key> on nonexistent key exits with code 2 ─────────────

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

// ── T15: read <domain> lists all key-value pairs ──────────────────────────────

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

#[test]
fn t15_read_domain_lists_all_pairs_json() {
    let tmp = NamedTempFile::new().unwrap();
    cmd(&tmp)
        .args(["write", "d", "k1", "hello"])
        .output()
        .unwrap();
    cmd(&tmp)
        .args(["write", "d", "k2", "--type", "bool", "false"])
        .output()
        .unwrap();
    let out = cmd(&tmp)
        .arg("--json")
        .args(["read", "d"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["k1"]["value"], "hello");
    assert_eq!(v["data"]["k1"]["type"], "string");
    assert_eq!(v["data"]["k2"]["value"], false);
    assert_eq!(v["data"]["k2"]["type"], "bool");
}

// ── T16: write --type bool invalid exits with code 4 ─────────────────────────

#[test]
fn t16_write_invalid_bool_exits_4() {
    let tmp = NamedTempFile::new().unwrap();
    let out = cmd(&tmp)
        .args(["write", "d", "k", "--type", "bool", "notabool"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(4),
        "expected exit code 4 for invalid bool value"
    );
}

// ── T17: write --type foobar value exits with code 2 (clap rejects it) ────────

#[test]
fn t17_write_unknown_type_exits_2() {
    let tmp = NamedTempFile::new().unwrap();
    let out = cmd(&tmp)
        .args(["write", "d", "k", "--type", "foobar", "v"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "expected exit code 2 for unknown --type (clap rejects before main)"
    );
}

// ── T18: delete <domain> <key> on existing key exits 0 ───────────────────────

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

// ── T19: delete <domain> <key> on nonexistent key exits 2 ────────────────────

#[test]
fn t19_delete_missing_key_exits_2() {
    let tmp = NamedTempFile::new().unwrap();
    let out = cmd(&tmp).args(["delete", "d", "nokey"]).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "delete on nonexistent key should exit 2"
    );
}

// ── T20: delete <domain> removes entire domain and exits 0 ───────────────────

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

// ── T21: delete <domain> on nonexistent domain exits 2 ───────────────────────

#[test]
fn t21_delete_nonexistent_domain_exits_2() {
    let tmp = NamedTempFile::new().unwrap();
    let out = cmd(&tmp)
        .args(["delete", "no.such.domain"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(2),
        "delete on nonexistent domain should exit 2"
    );
}

// ── T22: write --generation with correct generation writes successfully ───────

#[test]
fn t22_cas_write_correct_generation_exits_0() {
    let tmp = NamedTempFile::new().unwrap();
    // Fresh domain: generation is 0.
    let out = cmd(&tmp)
        .args(["write", "d", "k", "--generation", "0", "hello"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "write --generation with gen=0 should succeed"
    );

    // Verify value was written.
    let read = cmd(&tmp).args(["read", "d", "k"]).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&read.stdout).trim(), "hello");
}

// ── T23: write --generation with stale generation exits 3 (conflict) ─────────

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

// ── T24: write --generation --json conflict output includes current generation ─

#[test]
fn t24_cas_write_json_conflict_includes_generation() {
    let tmp = NamedTempFile::new().unwrap();
    // Write once so generation becomes 1.
    cmd(&tmp).args(["write", "d", "k", "v"]).output().unwrap();

    // write --generation with wrong generation, requesting JSON output.
    let out = cmd(&tmp)
        .arg("--json")
        .args(["write", "d", "k", "--generation", "0", "new"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    assert_eq!(v["ok"], false);
    // The error message must mention the current generation (1).
    let err_msg = v["error"].as_str().expect("error field should be a string");
    assert!(
        err_msg.contains('1'),
        "conflict error should mention current generation 1; got: {err_msg}"
    );
}

// ── T25: end-to-end workflow ──────────────────────────────────────────────────

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

// ── T26: TUGBANK_PATH env var overrides default path ──────────────────────────
// (Also tested in t10_env_overrides_default; this test names it as T26.)

#[test]
fn t26_tugbank_path_env_overrides_default() {
    let db = NamedTempFile::new().unwrap();
    let status = cargo_bin_cmd!("tugbank")
        .env("TUGBANK_PATH", db.path())
        .args(["write", "t26.domain", "key", "value"])
        .output()
        .unwrap()
        .status;
    assert!(status.success(), "write via TUGBANK_PATH should succeed");

    let out = cargo_bin_cmd!("tugbank")
        .env("TUGBANK_PATH", db.path())
        .arg("--json")
        .arg("domains")
        .output()
        .unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(
        domains.iter().any(|d| d.as_str() == Some("t26.domain")),
        "expected t26.domain in domains: {domains:?}"
    );
}

// ── T27: --path flag overrides TUGBANK_PATH env var ───────────────────────────
// (Also tested in t10_path_flag_overrides_env; this test names it as T27.)

#[test]
fn t27_path_flag_overrides_tugbank_path_env() {
    let db_flag = NamedTempFile::new().unwrap();
    let db_env = NamedTempFile::new().unwrap();

    // Write to db_flag via --path.
    cargo_bin_cmd!("tugbank")
        .arg("--path")
        .arg(db_flag.path())
        .args(["write", "t27.domain", "key", "value"])
        .output()
        .unwrap();

    // Queries with both --path and TUGBANK_PATH: --path must win.
    let out = cargo_bin_cmd!("tugbank")
        .arg("--path")
        .arg(db_flag.path())
        .env("TUGBANK_PATH", db_env.path())
        .arg("--json")
        .arg("domains")
        .output()
        .unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).expect("valid JSON");
    let domains = v["data"]["domains"].as_array().unwrap();
    assert!(
        domains.iter().any(|d| d.as_str() == Some("t27.domain")),
        "--path should point at db_flag which has t27.domain: {domains:?}"
    );

    // Confirm db_env does NOT have the domain (proves --path won over env).
    let out_env = cargo_bin_cmd!("tugbank")
        .arg("--path")
        .arg(db_env.path())
        .arg("--json")
        .arg("domains")
        .output()
        .unwrap();
    assert!(out_env.status.success());
    let s_env = String::from_utf8_lossy(&out_env.stdout);
    let v_env: serde_json::Value = serde_json::from_str(s_env.trim()).expect("valid JSON");
    let domains_env = v_env["data"]["domains"].as_array().unwrap();
    assert!(
        !domains_env.iter().any(|d| d.as_str() == Some("t27.domain")),
        "db_env should not have t27.domain: {domains_env:?}"
    );
}
