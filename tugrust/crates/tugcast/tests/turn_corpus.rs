//! Golden turn-count corpus — manifest guard.
//!
//! The corpus under `tests/fixtures/turns/` is real session JSONL (copied /
//! redacted from `~/.claude/projects`) with hand-verified expected turn
//! counts per `tuglaws/turn-metric.md` (Spec S01). The scanner contract test
//! (the `external_sessions` unit tests) and the tugcode segmenter contract
//! test assert against the same numbers recorded in `manifest.json`.
//!
//! This test is the cheap guard the rest of the chain leans on: it proves the
//! corpus is present, every fixture is well-formed JSONL, every fixture the
//! manifest names exists on disk (and vice versa), and every fixture carries a
//! recorded expectation. A silently-empty or drifted corpus would otherwise
//! let the contract tests pass vacuously.
//!
//! Run: `cargo nextest run -p tugcast --test turn_corpus`

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/turns")
}

fn load_manifest() -> serde_json::Value {
    let path = fixtures_dir().join("manifest.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("corpus manifest unreadable at {}: {e}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("corpus manifest is not valid JSON: {e}"))
}

/// Every fixture the manifest names exists, is non-empty, parses as JSONL line
/// by line, and carries a non-negative `expected_turns`.
#[test]
fn corpus_manifest_is_complete_and_well_formed() {
    let manifest = load_manifest();
    let fixtures = manifest["fixtures"]
        .as_array()
        .expect("manifest.fixtures must be an array");

    assert!(
        fixtures.len() >= 6,
        "expected at least the six seeded fixtures, found {}",
        fixtures.len()
    );

    let mut named: BTreeSet<String> = BTreeSet::new();
    for fx in fixtures {
        let file = fx["file"]
            .as_str()
            .expect("each fixture needs a string `file`");
        named.insert(file.to_string());

        // A recorded expectation must exist and be a sane count.
        let expected = fx["expected_turns"]
            .as_u64()
            .unwrap_or_else(|| panic!("{file}: `expected_turns` must be a non-negative integer"));
        assert!(
            expected <= 10_000,
            "{file}: expected_turns {expected} is implausibly large — likely a typo"
        );

        let path = fixtures_dir().join(file);
        let body = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("fixture {file} unreadable: {e}"));
        assert!(!body.trim().is_empty(), "fixture {file} is empty");

        // The decoupled-gate invariant ([P09]): a session with on-disk
        // content (every corpus fixture is non-empty, so `file_size > 0`)
        // always opens with at least one genuine turn. The picker's
        // resume/new gate leans on `turn_count >= 1 ⇐ file_size > 0`, so a
        // content fixture that expected 0 turns would violate it.
        assert!(
            expected >= 1,
            "{file}: file_size > 0 but expected_turns is 0 — violates the \
             `turn_count >= 1 ⇐ file_size > 0` invariant the gates rely on"
        );

        // Every non-blank line must be a standalone JSON object (real Claude
        // Code JSONL shape), so the contract tests can translate it.
        for (i, line) in body.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|e| {
                panic!("fixture {file} line {} is not valid JSON: {e}", i + 1)
            });
        }
    }

    // No orphan fixture files: every *.jsonl on disk is accounted for in the
    // manifest, so a fixture can never be added without an expectation.
    let mut on_disk: BTreeSet<String> = BTreeSet::new();
    for entry in fs::read_dir(fixtures_dir()).expect("fixtures dir must exist") {
        let entry = entry.expect("readable dir entry");
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".jsonl") {
            on_disk.insert(name);
        }
    }
    assert_eq!(
        named, on_disk,
        "manifest fixtures and on-disk *.jsonl files must match exactly \
         (manifest-only: {:?}, disk-only: {:?})",
        named.difference(&on_disk).collect::<Vec<_>>(),
        on_disk.difference(&named).collect::<Vec<_>>(),
    );
}
