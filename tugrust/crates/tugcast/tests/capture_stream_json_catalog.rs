//! Capture binary for the golden stream-json catalog.
//!
//! See `roadmap/tugplan-golden-stream-json-catalog.md` Step 3 for the
//! full scope and Step 4 for the baseline capture run procedure.
//!
//! # What this binary does
//!
//! - Spawns one fresh `TestTugcast` per probe in `PROBES`
//! - Drives each probe's `input_script` through `TestWs`
//! - Collects `CODE_OUTPUT` and `SESSION_METADATA` events until a
//!   terminal event (`turn_complete` or timeout)
//! - Normalizes each event via [`normalize_event`] (leaf-only
//!   placeholder substitution per [D14])
//! - Stability-checks the normalized shape across `TUG_STABILITY=N`
//!   repeated captures
//! - Derives a per-event-type [`Schema`] and per-probe event-sequence
//!   via [`derive_schema`]
//! - Writes JSONL + `manifest.json` + `schema.json` under
//!   `tests/fixtures/stream-json-catalog/v<version>/`
//!
//! # What this binary does *not* do
//!
//! - No prose-derived assumptions surviving to fixtures (per SC10)
//! - No version fallback — if `v<version>/` doesn't exist yet, the
//!   capture writes it; if it exists, the drift test reads it and
//!   the capture refuses to overwrite unless re-run explicitly
//!
//! # How to run
//!
//! Default suite: unit tests (`normalize_event` + `derive_schema`)
//! only. The real-claude capture is `#[ignore]` + env-gated.
//!
//! ```ignore
//! # unit tests
//! cd tugrust && cargo nextest run -p tugcast
//!
//! # real capture (writes new v<version>/ dir)
//! TUG_STABILITY=3 TUG_REAL_CLAUDE=1 \
//!   cargo test --test capture_stream_json_catalog -- --ignored
//! ```

#![allow(dead_code)]

mod common;

use std::path::PathBuf;

use serde_json::{Value, json};

// Normalization, schema derivation, execute_probe, canonical_sequence,
// stability_outcome, and capture_with_stability all live in
// `common::catalog` so the Step 6 drift regression test can reuse them
// without duplicating ~500 lines of machinery. This file owns only the
// fixture-writing layer (status_tag / build_manifest / write_fixtures)
// and the `capture_all_probes` test entry point itself.
use common::catalog::{
    CapturedProbe, Schema, canonical_sequence, capture_with_stability, derive_schema,
    extract_version, normalize_event, schema_to_json, stability_outcome, stability_runs,
};
use common::probes::ProbeStatus;
use common::real_claude_enabled;

// -----------------------------------------------------------------------
// Fixture writing helpers (capture-binary only)
// -----------------------------------------------------------------------

/// Convert [`ProbeStatus`] to a lowercase status string for
/// `manifest.json`.
fn status_tag(status: &ProbeStatus) -> &'static str {
    match status {
        ProbeStatus::Passed => "passed",
        ProbeStatus::Skipped(_) => "skipped",
        ProbeStatus::Failed(_) => "failed",
        ProbeStatus::ShapeUnstable(_) => "shape_unstable",
    }
}

fn status_reason(status: &ProbeStatus) -> Option<String> {
    match status {
        ProbeStatus::Passed => None,
        ProbeStatus::Skipped(reason) => Some((*reason).to_string()),
        ProbeStatus::Failed(reason) => Some(reason.clone()),
        ProbeStatus::ShapeUnstable(reason) => Some(reason.clone()),
    }
}

/// Build `manifest.json` per Spec S02.
fn build_manifest(version: &str, stability: usize, captures: &[CapturedProbe]) -> Value {
    let probes: Vec<Value> = captures
        .iter()
        .map(|probe| {
            let mut entry = json!({
                "name": probe.name,
                "status": status_tag(&probe.status),
                "event_count": probe.events.len(),
                "runtime_ms": "{{i64}}",
            });
            if let Some(reason) = status_reason(&probe.status) {
                entry
                    .as_object_mut()
                    .unwrap()
                    .insert("skip_reason".to_string(), Value::String(reason));
            }
            entry
        })
        .collect();

    json!({
        "claude_version": version,
        "captured_at": "{{iso}}",
        "stability_runs": stability,
        "probes": probes,
    })
}

/// Fixture root: `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`.
fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("stream-json-catalog")
}

/// Write a full capture run to disk per Spec S01. Creates the
/// `v<version>/` directory, writes JSONL for each probe, plus
/// `manifest.json` and `schema.json`.
pub fn write_fixtures(
    captures: &[CapturedProbe],
    schema: &Schema,
    manifest: &Value,
) -> std::io::Result<PathBuf> {
    let dir = fixture_root().join(format!("v{}", schema.claude_version));
    std::fs::create_dir_all(&dir)?;

    for probe in captures {
        let mut jsonl = String::new();
        for event in &probe.events {
            jsonl.push_str(&serde_json::to_string(event).unwrap_or_default());
            jsonl.push('\n');
        }
        std::fs::write(dir.join(format!("{}.jsonl", probe.name)), jsonl)?;
    }

    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(manifest).unwrap(),
    )?;
    std::fs::write(
        dir.join("schema.json"),
        serde_json::to_string_pretty(&schema_to_json(schema)).unwrap(),
    )?;

    Ok(dir)
}


// -----------------------------------------------------------------------
// The one real-claude test — the entry point
// -----------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn capture_all_probes() {
    if !real_claude_enabled() {
        eprintln!("skipping capture_all_probes: TUG_REAL_CLAUDE not set");
        return;
    }
    // Hard refusal: if ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) is
    // present in the shell that invoked this test, the value would
    // normally flow through cargo → test binary → tugcast → tugcode →
    // claude and cause claude to authenticate via per-token API billing
    // instead of `~/.claude.json` (the Max/Pro subscription). The
    // spawn-site scrubs defend against this but we also refuse to run at
    // all so the developer has a chance to `unset` it rather than
    // discovering the leak by reading an `apiKeySource` field in a
    // committed fixture. Belt and suspenders.
    for var in ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] {
        if std::env::var_os(var).is_some() {
            panic!(
                "{var} is set in the environment. The capture binary spawns real \
                 claude and this variable would cause claude to authenticate via \
                 per-token API billing instead of your Max/Pro subscription at \
                 ~/.claude.json. Run `unset {var}` in this shell and re-run.\n\
                 \n\
                 (Spawn sites also scrub this variable defensively, so this \
                 refusal is a warning — not a hard dependency — but we prefer \
                 to fail loudly rather than silently change auth mode.)"
            );
        }
    }
    let project_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let project_dir = project_dir
        .canonicalize()
        .expect("canonicalize project dir");

    let tmp = tempdir_path();
    std::fs::create_dir_all(&tmp).expect("create tmp dir");
    let _tmp_guard = TmpDirGuard(tmp.clone());

    let stability = stability_runs();
    let captures = capture_with_stability(stability, &tmp, &project_dir).await;

    // Diagnostic dump — always print the per-probe status summary
    // before doing anything else. If the version-extraction panics
    // below (e.g. claude crashed and no probe produced a
    // system_metadata), this is the only window into what happened.
    eprintln!(
        "--- capture_all_probes status summary ({} probes) ---",
        captures.len()
    );
    for probe in &captures {
        let (tag, reason) = match &probe.status {
            ProbeStatus::Passed => ("PASSED", String::new()),
            ProbeStatus::Skipped(r) => ("SKIPPED", (*r).to_string()),
            ProbeStatus::Failed(r) => ("FAILED ", r.clone()),
            ProbeStatus::ShapeUnstable(r) => ("UNSTBL ", r.clone()),
        };
        eprintln!(
            "  [{tag}] {name:<48} events={count} runtime={rt}ms {reason}",
            name = probe.name,
            count = probe.events.len(),
            rt = probe.runtime_ms,
        );
    }
    eprintln!("-----------------------------------------------------");

    let version =
        extract_version(&captures).expect("no system_metadata version found — aborting per [D11]");

    let schema = derive_schema(&version, &captures);
    let manifest = build_manifest(&version, stability, &captures);
    let path = write_fixtures(&captures, &schema, &manifest).expect("write_fixtures succeeded");
    eprintln!("wrote fixtures to {}", path.display());
    // `_tmp_guard` drops here and removes the per-probe bank files.
}

/// Per-PID scratch directory for capture runs. Holds the per-probe
/// tugbank paths and is wiped by [`TmpDirGuard`] on scope exit.
fn tempdir_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("tugcast-capture-{}", std::process::id()));
    p
}

/// RAII guard that `remove_dir_all`s its path on drop. Robust to
/// panics partway through `capture_all_probes` — the tokio runtime
/// unwinds the test stack and the drop fires, cleaning up the
/// per-probe bank files and any stale tugcast subprocess working
/// state without leaving cruft under `$TMPDIR`.
struct TmpDirGuard(PathBuf);

impl Drop for TmpDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// -----------------------------------------------------------------------
// Unit tests — normalize_event + derive_schema
// -----------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- normalize_event ----

    #[test]
    fn normalize_leaf_uuid_id_key() {
        let mut v =
            json!({"type": "session_init", "session_id": "05086f97-1234-4abc-9def-abcdef012345"});
        normalize_event(&mut v);
        assert_eq!(v["session_id"], "{{uuid}}");
        assert_eq!(v["type"], "session_init");
    }

    #[test]
    fn normalize_leaf_id_key_even_for_non_uuid_content() {
        // session_id: "pending-cont-xyz" is not a UUID but still a
        // varying identifier that must be erased to stabilize the
        // fixture diff.
        let mut v = json!({"session_id": "pending-cont-xyz-123"});
        normalize_event(&mut v);
        assert_eq!(v["session_id"], "{{uuid}}");
    }

    #[test]
    fn normalize_text_content_key_collapses_to_length() {
        let mut v = json!({"type": "assistant_text", "text": "Hello there, how are you?"});
        normalize_event(&mut v);
        assert_eq!(v["text"], "{{text:len=25}}");
    }

    #[test]
    fn normalize_preserves_object_structure() {
        let mut v = json!({
            "type": "system_metadata",
            "tools": ["Read", "Write", "Bash"],
            "model": "claude-opus-4-6",
        });
        normalize_event(&mut v);
        // Structure preserved, tool list intact.
        assert_eq!(v["tools"], json!(["Read", "Write", "Bash"]));
        assert_eq!(v["model"], "claude-opus-4-6");
        assert_eq!(v["type"], "system_metadata");
    }

    #[test]
    fn normalize_preserves_array_structure() {
        let mut v = json!({
            "slash_commands": ["cost", "compact", "status"],
        });
        normalize_event(&mut v);
        assert_eq!(v["slash_commands"], json!(["cost", "compact", "status"]));
    }

    #[test]
    fn normalize_polymorphic_tool_result() {
        let mut v = json!({
            "type": "tool_result",
            "tool_use_id": "toolu_01ABCDEFGHIJKLMNOPQRSTUV",
            "output": "line 1\nline 2",
            "is_error": false,
        });
        normalize_event(&mut v);
        assert_eq!(v["tool_use_id"], "{{uuid}}");
        assert_eq!(v["output"], "{{text:len=13}}");
        assert_eq!(v["is_error"], false);
    }

    #[test]
    fn normalize_iso_timestamp_leaf() {
        let mut v = json!({"captured_at": "2026-04-13T15:00:00Z"});
        normalize_event(&mut v);
        assert_eq!(v["captured_at"], "{{iso}}");
    }

    #[test]
    fn normalize_numeric_allowlist_cost_and_duration() {
        let mut v = json!({
            "type": "cost_update",
            "total_cost_usd": 0.0642,
            "duration_ms": 1912,
            "seq": 2,
        });
        normalize_event(&mut v);
        assert_eq!(v["total_cost_usd"], "{{f64}}");
        assert_eq!(v["duration_ms"], "{{i64}}");
        // seq is NOT in the allowlist — structural meaning preserved.
        assert_eq!(v["seq"], 2);
    }

    #[test]
    fn normalize_cwd_prefix_replaces_home_path() {
        // SAFETY: this test mutates the process environment. Other
        // normalization tests don't read `$HOME` at the moment they
        // normalize strings that would collide — they use literal
        // values that don't start with the real home. The mutation is
        // bracketed so a concurrent test that reads `$HOME` would see
        // the saved-and-restored value.
        let saved = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", "/Users/kocienda") };
        let mut v = json!({"cwd": "/Users/kocienda/Mounts/u/src/tugtool"});
        normalize_event(&mut v);
        assert_eq!(v["cwd"], "{{cwd}}/Mounts/u/src/tugtool");
        match saved {
            Some(val) => unsafe { std::env::set_var("HOME", val) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }

    // ---- derive_schema ----

    fn mk_capture(name: &str, events: Vec<Value>) -> CapturedProbe {
        CapturedProbe {
            name: name.to_string(),
            events,
            status: ProbeStatus::Passed,
            runtime_ms: 0,
        }
    }

    #[test]
    fn derive_schema_basic_single_probe() {
        let captures = vec![mk_capture(
            "test-01-basic-round-trip",
            vec![
                json!({"type": "session_init", "session_id": "{{uuid}}"}),
                json!({"type": "system_metadata", "model": "claude-opus-4-6", "version": "2.1.104"}),
                json!({"type": "assistant_text", "text": "{{text:len=5}}"}),
                json!({"type": "turn_complete", "result": "success"}),
            ],
        )];
        let schema = derive_schema("2.1.104", &captures);
        assert_eq!(schema.claude_version, "2.1.104");
        assert!(schema.event_types.contains_key("session_init"));
        assert!(schema.event_types.contains_key("system_metadata"));
        assert!(schema.event_types.contains_key("assistant_text"));
        assert!(schema.event_types.contains_key("turn_complete"));
        assert_eq!(
            schema.probe_sequences.get("test-01-basic-round-trip"),
            Some(&vec![
                "session_init".to_string(),
                "system_metadata".to_string(),
                "assistant_text".to_string(),
                "turn_complete".to_string(),
            ])
        );
    }

    #[test]
    fn derive_schema_required_vs_optional_fields() {
        // Two probes both emit `system_metadata`. Probe A has
        // `permissionMode`, probe B does not. So `permissionMode`
        // lands in optional_fields, not required.
        let captures = vec![
            mk_capture(
                "probe-a",
                vec![json!({
                    "type": "system_metadata",
                    "model": "claude-opus-4-6",
                    "version": "2.1.104",
                    "permissionMode": "acceptEdits",
                })],
            ),
            mk_capture(
                "probe-b",
                vec![json!({
                    "type": "system_metadata",
                    "model": "claude-opus-4-6",
                    "version": "2.1.104",
                })],
            ),
        ];
        let schema = derive_schema("2.1.104", &captures);
        let meta = schema.event_types.get("system_metadata").unwrap();
        assert!(meta.required_fields.contains_key("model"));
        assert!(meta.required_fields.contains_key("version"));
        assert!(meta.required_fields.contains_key("type"));
        assert!(meta.optional_fields.contains_key("permissionMode"));
        assert!(!meta.required_fields.contains_key("permissionMode"));
    }

    #[test]
    fn derive_schema_polymorphic_tool_use_structured() {
        // Read-tool tool_use_structured vs Bash-tool tool_use_structured
        // have completely different structured_result shapes. [D09]
        // requires they be keyed under by_tool_name.
        let captures = vec![
            mk_capture(
                "probe-read",
                vec![json!({
                    "type": "tool_use_structured",
                    "tool_name": "Read",
                    "tool_use_id": "{{uuid}}",
                    "structured_result": { "file": { "filePath": "{{cwd}}/x", "content": "{{text:len=10}}" } },
                })],
            ),
            mk_capture(
                "probe-bash",
                vec![json!({
                    "type": "tool_use_structured",
                    "tool_name": "Bash",
                    "tool_use_id": "{{uuid}}",
                    "structured_result": { "stdout": "{{text:len=5}}", "stderr": "{{text:len=0}}" },
                })],
            ),
        ];
        let schema = derive_schema("2.1.104", &captures);
        assert!(schema.tool_use_structured_by_tool.contains_key("Read"));
        assert!(schema.tool_use_structured_by_tool.contains_key("Bash"));
        // The general event_types table should NOT have a
        // tool_use_structured entry because polymorphic dispatch
        // routes it to `by_tool_name`.
        assert!(!schema.event_types.contains_key("tool_use_structured"));
    }

    #[test]
    fn derive_schema_probe_sequences_are_ordered() {
        let captures = vec![mk_capture(
            "probe-seq",
            vec![
                json!({"type": "system_metadata"}),
                json!({"type": "thinking_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "cost_update"}),
                json!({"type": "turn_complete"}),
            ],
        )];
        let schema = derive_schema("2.1.104", &captures);
        let seq = schema.probe_sequences.get("probe-seq").unwrap();
        assert_eq!(
            seq,
            &vec![
                "system_metadata",
                "thinking_text",
                "assistant_text",
                "assistant_text",
                "cost_update",
                "turn_complete",
            ]
        );
    }

    #[test]
    fn derive_schema_type_description_for_arrays_and_objects() {
        let captures = vec![mk_capture(
            "probe-types",
            vec![json!({
                "type": "system_metadata",
                "tools": ["Read", "Write"],
                "plugins": [{"name": "tugtool"}],
                "ipc_version": 2,
            })],
        )];
        let schema = derive_schema("2.1.104", &captures);
        let meta = schema.event_types.get("system_metadata").unwrap();
        assert_eq!(
            meta.required_fields.get("tools"),
            Some(&"array<string>".to_string())
        );
        assert_eq!(
            meta.required_fields.get("plugins"),
            Some(&"array<object>".to_string())
        );
        assert_eq!(
            meta.required_fields.get("ipc_version"),
            Some(&"integer".to_string())
        );
    }

    #[test]
    fn derive_schema_extract_version_from_captures() {
        let captures = vec![
            mk_capture(
                "probe-without-metadata",
                vec![json!({"type": "session_init"})],
            ),
            mk_capture(
                "probe-with-metadata",
                vec![json!({
                    "type": "system_metadata",
                    "version": "2.1.104",
                })],
            ),
        ];
        assert_eq!(extract_version(&captures), Some("2.1.104".to_string()));
    }

    #[test]
    fn schema_to_json_shape_matches_spec_s03() {
        let captures = vec![mk_capture(
            "test-01",
            vec![
                json!({"type": "session_init", "session_id": "{{uuid}}"}),
                json!({"type": "turn_complete"}),
            ],
        )];
        let schema = derive_schema("2.1.104", &captures);
        let out = schema_to_json(&schema);
        assert_eq!(out["claude_version"], "2.1.104");
        assert!(
            out["event_types"]["session_init"]["required_fields"]
                .as_object()
                .unwrap()
                .contains_key("type")
        );
        assert!(out["probe_sequences"]["test-01"]["required_sequence"].is_array());
    }

    // ---- manifest / fixture-root smoke ----

    #[test]
    fn build_manifest_includes_all_probes_and_normalizes_timing() {
        let captures = vec![
            mk_capture("probe-1", vec![json!({"type": "session_init"})]),
            CapturedProbe {
                name: "probe-2".to_string(),
                events: vec![],
                status: ProbeStatus::Skipped("reason"),
                runtime_ms: 500,
            },
        ];
        let manifest = build_manifest("2.1.104", 3, &captures);
        assert_eq!(manifest["claude_version"], "2.1.104");
        assert_eq!(manifest["captured_at"], "{{iso}}");
        assert_eq!(manifest["stability_runs"], 3);
        let probes = manifest["probes"].as_array().unwrap();
        assert_eq!(probes.len(), 2);
        assert_eq!(probes[0]["name"], "probe-1");
        assert_eq!(probes[0]["status"], "passed");
        assert_eq!(probes[0]["runtime_ms"], "{{i64}}");
        assert_eq!(probes[1]["status"], "skipped");
        assert_eq!(probes[1]["skip_reason"], "reason");
    }

    #[test]
    fn status_tag_covers_all_variants() {
        assert_eq!(status_tag(&ProbeStatus::Passed), "passed");
        assert_eq!(status_tag(&ProbeStatus::Skipped("x")), "skipped");
        assert_eq!(status_tag(&ProbeStatus::Failed("x".into())), "failed");
        assert_eq!(
            status_tag(&ProbeStatus::ShapeUnstable("x".into())),
            "shape_unstable"
        );
    }

    // ---- stability_outcome ----

    #[test]
    fn stability_outcome_no_rest_is_stable() {
        let first = mk_capture("probe", vec![json!({"type": "turn_complete"})]);
        assert_eq!(stability_outcome(&first, &[]), None);
    }

    #[test]
    fn stability_outcome_matching_runs_are_stable() {
        let first = mk_capture(
            "probe",
            vec![
                json!({"type": "session_init"}),
                json!({"type": "turn_complete"}),
            ],
        );
        let second = mk_capture(
            "probe",
            vec![
                json!({"type": "session_init"}),
                json!({"type": "turn_complete"}),
            ],
        );
        assert_eq!(stability_outcome(&first, &[second]), None);
    }

    #[test]
    fn stability_outcome_diverging_sequence_is_flagged() {
        let first = mk_capture(
            "probe-flap",
            vec![
                json!({"type": "session_init"}),
                json!({"type": "turn_complete"}),
            ],
        );
        let second = mk_capture(
            "probe-flap",
            vec![
                json!({"type": "session_init"}),
                json!({"type": "thinking_text"}),
                json!({"type": "turn_complete"}),
            ],
        );
        let diag = stability_outcome(&first, &[second]).expect("drift should be flagged");
        assert!(diag.contains("probe-flap"));
        assert!(diag.contains("differs"));
    }

    #[test]
    fn stability_outcome_multi_run_catches_later_divergence() {
        // Three runs: first two match, third diverges. The helper
        // should still flag it rather than reporting stable because
        // the first two agreed.
        let first = mk_capture(
            "probe-multi",
            vec![json!({"type": "a"}), json!({"type": "b"})],
        );
        let second = mk_capture(
            "probe-multi",
            vec![json!({"type": "a"}), json!({"type": "b"})],
        );
        let third = mk_capture(
            "probe-multi",
            vec![json!({"type": "a"}), json!({"type": "c"})],
        );
        let diag = stability_outcome(&first, &[second, third]).expect("third run must flag drift");
        // The diagnostic's "run X/Y" should identify the divergent run.
        assert!(diag.contains("run 3/3"));
    }

    #[test]
    fn stability_outcome_collapses_streaming_partials() {
        // Claude emits a variable number of assistant_text partials
        // depending on tokenizer batching. Runs with the same shape
        // but different partial counts must NOT be flagged.
        let first = mk_capture(
            "probe-stream",
            vec![
                json!({"type": "system_metadata"}),
                json!({"type": "assistant_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "turn_complete"}),
            ],
        );
        let second = mk_capture(
            "probe-stream",
            vec![
                json!({"type": "system_metadata"}),
                json!({"type": "assistant_text"}),
                json!({"type": "assistant_text"}),
                json!({"type": "turn_complete"}),
            ],
        );
        // Both canonicalize to [system_metadata, assistant_text, turn_complete].
        assert_eq!(stability_outcome(&first, &[second]), None);
    }

    #[test]
    fn stability_outcome_flags_new_event_type_between_runs() {
        // A run where a new event type appears between previously
        // adjacent ones must still be flagged — the canonicalization
        // erases count variance, not ordering drift.
        let first = mk_capture(
            "probe-order",
            vec![
                json!({"type": "a"}),
                json!({"type": "b"}),
                json!({"type": "c"}),
            ],
        );
        let second = mk_capture(
            "probe-order",
            vec![
                json!({"type": "a"}),
                json!({"type": "x"}), // new event type between a and b
                json!({"type": "b"}),
                json!({"type": "c"}),
            ],
        );
        assert!(stability_outcome(&first, &[second]).is_some());
    }

    #[test]
    fn canonical_sequence_dedupes_adjacent_only() {
        let events = vec![
            json!({"type": "a"}),
            json!({"type": "a"}),
            json!({"type": "b"}),
            json!({"type": "a"}),
            json!({"type": "a"}),
        ];
        // [a, a, b, a, a] → [a, b, a] — non-adjacent 'a' islands are
        // preserved so we detect genuine re-entry into an event type.
        assert_eq!(canonical_sequence(&events), vec!["a", "b", "a"]);
    }

    #[test]
    fn stability_outcome_length_mismatch_is_flagged() {
        // A run with extra trailing events is also a drift signal,
        // not a prefix match.
        let first = mk_capture(
            "probe-len",
            vec![json!({"type": "a"}), json!({"type": "b"})],
        );
        let second = mk_capture(
            "probe-len",
            vec![
                json!({"type": "a"}),
                json!({"type": "b"}),
                json!({"type": "c"}),
            ],
        );
        assert!(stability_outcome(&first, &[second]).is_some());
    }

    #[test]
    fn stability_runs_reads_env_default_one() {
        // SAFETY: bracketed save/restore.
        let saved = std::env::var("TUG_STABILITY").ok();
        unsafe { std::env::remove_var("TUG_STABILITY") };
        assert_eq!(stability_runs(), 1);
        unsafe { std::env::set_var("TUG_STABILITY", "5") };
        assert_eq!(stability_runs(), 5);
        unsafe { std::env::set_var("TUG_STABILITY", "0") };
        // zero falls back to default per filter
        assert_eq!(stability_runs(), 1);
        match saved {
            Some(v) => unsafe { std::env::set_var("TUG_STABILITY", v) },
            None => unsafe { std::env::remove_var("TUG_STABILITY") },
        }
    }
}
