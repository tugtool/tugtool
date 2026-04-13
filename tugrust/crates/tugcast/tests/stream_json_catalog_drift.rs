//! Drift regression test + hand-rolled shape differ for the golden
//! stream-json catalog.
//!
//! See `roadmap/tugplan-golden-stream-json-catalog.md` Step 6 for the
//! full scope and Step 4 for the baseline fixtures that this test
//! diffs against.
//!
//! # What this test does
//!
//! The `stream_json_catalog_drift_regression` test, when run against
//! real claude with `TUG_REAL_CLAUDE=1`, performs a full 35-probe
//! capture (using `common::catalog::execute_probe`), derives a live
//! schema via `derive_schema`, loads the committed golden schema at
//! `tests/fixtures/stream-json-catalog/v<version>/schema.json`, and
//! runs a hand-rolled shape differ ([D03]) against the two.
//!
//! If the differ finds any `Fail`-severity divergences, the test
//! panics with a structured bullet-list report naming the exact
//! event-type / field path / probe that drifted. `Warn`-severity
//! findings (new optional fields, new tool union arms, new probes)
//! are printed but do not fail the test — they exist to nudge the
//! maintainer to rerun the capture and commit the new baseline.
//!
//! # Why we need a differ that isn't a generic JSON diff
//!
//! Per [D03], generic JSON diffs don't know:
//! - required vs optional field semantics ([D08])
//! - polymorphic `tool_use_structured` keyed by tool_name ([D09])
//! - canonical probe event sequences that are order-sensitive but
//!   count-insensitive (streaming partial counts vary run-to-run)
//! - that a new optional field is a warn, not a fail
//!
//! So we roll our own, ~200 lines, fully unit-testable without ever
//! spawning real claude.
//!
//! # How to run the drift regression
//!
//! Default suite (differ unit tests only, no real claude):
//! ```ignore
//! cd tugrust && cargo nextest run -p tugcast
//! ```
//!
//! Real drift check against the committed v<version>/ baseline:
//! ```ignore
//! TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored
//! ```
//!
//! Per Step 6 [D13], the test fails hard if
//! `tests/fixtures/stream-json-catalog/v<version>/schema.json` does
//! not exist for the running claude version — there is no version
//! fallback. If you see "no golden schema for claude X.Y.Z", run the
//! capture binary to generate one, then review and commit.

#![allow(dead_code)]

mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use common::catalog::{
    EventShape, Schema, canonical_type_sequence, capture_with_stability, derive_schema,
    extract_version, stability_runs,
};
use common::real_claude_enabled;

// -----------------------------------------------------------------------
// Diff report types — [D03]
// -----------------------------------------------------------------------

/// Severity of a single diff finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// The golden and current schemas differ in a way that breaks the
    /// contract. Any `Fail` finding in the report fails the test.
    Fail,
    /// The current capture introduces something new that does not
    /// break the contract (e.g. a new optional field). Surfaced for
    /// the maintainer but does not fail the test.
    Warn,
}

/// Classification of how two schemas diverge at one specific location.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureKind {
    /// Event type present in golden but absent from current.
    MissingEventType { event_type: String },
    /// Event type present in current but absent from golden.
    NewEventType { event_type: String },
    /// A required field is missing from the current event shape.
    MissingRequiredField { path: Vec<String> },
    /// A field's type descriptor differs between golden and current.
    TypeMismatch {
        path: Vec<String>,
        golden: String,
        current: String,
    },
    /// A field appears in current that was not in golden.
    NewField { path: Vec<String>, ty: String },
    /// A `tool_use_structured` union arm present in golden but absent
    /// from current. [D09]
    RemovedToolUseUnion { tool_name: String },
    /// A `tool_use_structured` union arm present in current but absent
    /// from golden. [D09]
    NewToolUseUnion { tool_name: String },
    /// A probe's canonical sequence lost events (golden had them,
    /// current does not). Per [D08], removing a required slot fails.
    RemovedSequenceSlots {
        probe_name: String,
        slots: Vec<String>,
    },
    /// A probe's canonical sequence gained events (current has them,
    /// golden did not). Per [D08], adding a slot warns.
    NewSequenceSlots {
        probe_name: String,
        slots: Vec<String>,
    },
    /// A probe's canonical sequence has the same events as golden but
    /// in a different order. Reordering required slots fails.
    ReorderedSequence {
        probe_name: String,
        golden: Vec<String>,
        current: Vec<String>,
    },
    /// A probe that exists in golden is missing from current.
    MissingProbe { probe_name: String },
    /// A probe that exists in current is missing from golden.
    NewProbe { probe_name: String },
    /// Depth limit exceeded ([D12]). Not reachable by the current
    /// flat schema format but retained so future nested-shape
    /// recursion has a place to land.
    DepthLimitExceeded { path: Vec<String> },
}

/// A single finding produced by `diff_schemas`.
#[derive(Debug, Clone)]
pub struct Finding {
    pub severity: Severity,
    pub kind: FailureKind,
}

/// The full diff report: every `Fail` and `Warn` finding in the order
/// they were discovered.
#[derive(Debug, Default, Clone)]
pub struct DiffReport {
    pub findings: Vec<Finding>,
}

impl DiffReport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn fail(&mut self, kind: FailureKind) {
        self.findings.push(Finding {
            severity: Severity::Fail,
            kind,
        });
    }

    pub fn warn(&mut self, kind: FailureKind) {
        self.findings.push(Finding {
            severity: Severity::Warn,
            kind,
        });
    }

    pub fn has_failures(&self) -> bool {
        self.findings
            .iter()
            .any(|f| f.severity == Severity::Fail)
    }

    pub fn failure_count(&self) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity == Severity::Fail)
            .count()
    }

    pub fn warn_count(&self) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity == Severity::Warn)
            .count()
    }

    /// Render the report as a structured bullet list suitable for a
    /// panic message.
    pub fn format_report(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "Drift report: {} failure(s), {} warning(s)\n",
            self.failure_count(),
            self.warn_count(),
        ));
        for finding in &self.findings {
            let tag = match finding.severity {
                Severity::Fail => "FAIL",
                Severity::Warn => "WARN",
            };
            out.push_str(&format!("  {tag} {}\n", format_kind(&finding.kind)));
        }
        out
    }
}

fn format_kind(kind: &FailureKind) -> String {
    match kind {
        FailureKind::MissingEventType { event_type } => {
            format!("MissingEventType: {event_type}")
        }
        FailureKind::NewEventType { event_type } => {
            format!("NewEventType: {event_type}")
        }
        FailureKind::MissingRequiredField { path } => {
            format!("MissingRequiredField: {}", path.join("."))
        }
        FailureKind::TypeMismatch {
            path,
            golden,
            current,
        } => {
            format!(
                "TypeMismatch: {} (golden={golden}, current={current})",
                path.join("."),
            )
        }
        FailureKind::NewField { path, ty } => {
            format!("NewField: {} (ty={ty})", path.join("."))
        }
        FailureKind::RemovedToolUseUnion { tool_name } => {
            format!("RemovedToolUseUnion: {tool_name}")
        }
        FailureKind::NewToolUseUnion { tool_name } => {
            format!("NewToolUseUnion: {tool_name}")
        }
        FailureKind::RemovedSequenceSlots { probe_name, slots } => {
            format!("RemovedSequenceSlots: {probe_name} lost={slots:?}")
        }
        FailureKind::NewSequenceSlots { probe_name, slots } => {
            format!("NewSequenceSlots: {probe_name} added={slots:?}")
        }
        FailureKind::ReorderedSequence {
            probe_name,
            golden,
            current,
        } => {
            format!(
                "ReorderedSequence: {probe_name} golden={golden:?} current={current:?}"
            )
        }
        FailureKind::MissingProbe { probe_name } => {
            format!("MissingProbe: {probe_name}")
        }
        FailureKind::NewProbe { probe_name } => {
            format!("NewProbe: {probe_name}")
        }
        FailureKind::DepthLimitExceeded { path } => {
            format!("DepthLimitExceeded: {}", path.join("."))
        }
    }
}

// -----------------------------------------------------------------------
// load_schema — parse schema.json per Spec S03
// -----------------------------------------------------------------------

/// Parse a committed `schema.json` into a [`Schema`] struct. Fails
/// hard if the file does not exist (per [D13] — no version fallback)
/// or if the JSON is malformed. The return type is a plain `Result`
/// with stringified errors so the caller can `.expect(...)` with a
/// meaningful message.
pub fn load_schema(path: &Path) -> Result<Schema, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;

    let claude_version = value
        .get("claude_version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{}: missing claude_version", path.display()))?
        .to_string();

    let mut schema = Schema {
        claude_version,
        ..Default::default()
    };

    if let Some(event_types) = value.get("event_types").and_then(|v| v.as_object()) {
        for (et_name, et_value) in event_types {
            // Polymorphic tool_use_structured: route through by_tool_name
            // per [D09]. Each tool_name gets its own EventShape.
            if et_name == "tool_use_structured" {
                if let Some(by_tool) = et_value
                    .get("by_tool_name")
                    .and_then(|v| v.as_object())
                {
                    for (tool_name, shape_value) in by_tool {
                        let shape = parse_event_shape(shape_value);
                        schema
                            .tool_use_structured_by_tool
                            .insert(tool_name.clone(), shape);
                    }
                }
                continue;
            }
            let shape = parse_event_shape(et_value);
            schema.event_types.insert(et_name.clone(), shape);
        }
    }

    if let Some(probe_sequences) = value
        .get("probe_sequences")
        .and_then(|v| v.as_object())
    {
        for (probe_name, entry) in probe_sequences {
            let seq: Vec<String> = entry
                .get("required_sequence")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            schema.probe_sequences.insert(probe_name.clone(), seq);
        }
    }

    Ok(schema)
}

fn parse_event_shape(value: &Value) -> EventShape {
    let mut shape = EventShape::default();
    if let Some(req) = value.get("required_fields").and_then(|v| v.as_object()) {
        for (k, v) in req {
            shape
                .required_fields
                .insert(k.clone(), v.as_str().unwrap_or("unknown").to_string());
        }
    }
    if let Some(opt) = value.get("optional_fields").and_then(|v| v.as_object()) {
        for (k, v) in opt {
            shape
                .optional_fields
                .insert(k.clone(), v.as_str().unwrap_or("unknown").to_string());
        }
    }
    shape
}

// -----------------------------------------------------------------------
// diff_schemas — core differ per #deep-shape-differ
// -----------------------------------------------------------------------

/// Hand-rolled shape differ. Compares a golden [`Schema`] against a
/// freshly-derived current [`Schema`] and produces a [`DiffReport`]
/// covering event-type shape drift, polymorphic tool_use_structured
/// union drift, and per-probe canonical sequence drift.
pub fn diff_schemas(golden: &Schema, current: &Schema) -> DiffReport {
    let mut report = DiffReport::new();

    // Event types present in golden but absent from current → fail.
    // Event types present in both → diff their shapes.
    for (et, shape_g) in &golden.event_types {
        match current.event_types.get(et) {
            None => report.fail(FailureKind::MissingEventType {
                event_type: et.clone(),
            }),
            Some(shape_c) => {
                diff_event_shape(shape_g, shape_c, &[et.clone()], &mut report);
            }
        }
    }
    // Event types present in current but absent from golden → warn.
    for et in current.event_types.keys() {
        if !golden.event_types.contains_key(et) {
            report.warn(FailureKind::NewEventType {
                event_type: et.clone(),
            });
        }
    }

    // Polymorphic tool_use_structured [D09]. Union arm missing from
    // current is a fail; new arm in current is a warn.
    for (tool_name, shape_g) in &golden.tool_use_structured_by_tool {
        match current.tool_use_structured_by_tool.get(tool_name) {
            None => report.fail(FailureKind::RemovedToolUseUnion {
                tool_name: tool_name.clone(),
            }),
            Some(shape_c) => {
                let path = vec![
                    "tool_use_structured".to_string(),
                    format!("tool_name={tool_name}"),
                ];
                diff_event_shape(shape_g, shape_c, &path, &mut report);
            }
        }
    }
    for tool_name in current.tool_use_structured_by_tool.keys() {
        if !golden.tool_use_structured_by_tool.contains_key(tool_name) {
            report.warn(FailureKind::NewToolUseUnion {
                tool_name: tool_name.clone(),
            });
        }
    }

    // Per-probe canonical sequence comparison.
    for (probe_name, seq_g) in &golden.probe_sequences {
        match current.probe_sequences.get(probe_name) {
            None => report.fail(FailureKind::MissingProbe {
                probe_name: probe_name.clone(),
            }),
            Some(seq_c) => diff_probe_sequence(probe_name, seq_g, seq_c, &mut report),
        }
    }
    for probe_name in current.probe_sequences.keys() {
        if !golden.probe_sequences.contains_key(probe_name) {
            report.warn(FailureKind::NewProbe {
                probe_name: probe_name.clone(),
            });
        }
    }

    report
}

fn diff_event_shape(
    golden: &EventShape,
    current: &EventShape,
    path: &[String],
    report: &mut DiffReport,
) {
    // Every golden required field must exist in current with the same
    // type. Accept current-optional as satisfying golden-required with
    // a TypeMismatch fail if the types differ — this way, a required
    // field demoted to optional still has its type pinned.
    for (field, ty_g) in &golden.required_fields {
        let ty_c = current
            .required_fields
            .get(field)
            .or_else(|| current.optional_fields.get(field));
        match ty_c {
            None => {
                let mut fpath = path.to_vec();
                fpath.push(field.clone());
                report.fail(FailureKind::MissingRequiredField { path: fpath });
            }
            Some(ty_c_str) if ty_c_str != ty_g => {
                let mut fpath = path.to_vec();
                fpath.push(field.clone());
                report.fail(FailureKind::TypeMismatch {
                    path: fpath,
                    golden: ty_g.clone(),
                    current: ty_c_str.clone(),
                });
            }
            Some(_) => {}
        }
    }

    // Golden optional fields: if present in current, types must match.
    // If absent, that's fine — it was already optional.
    for (field, ty_g) in &golden.optional_fields {
        let ty_c = current
            .required_fields
            .get(field)
            .or_else(|| current.optional_fields.get(field));
        if let Some(ty_c_str) = ty_c {
            if ty_c_str != ty_g {
                let mut fpath = path.to_vec();
                fpath.push(field.clone());
                report.fail(FailureKind::TypeMismatch {
                    path: fpath,
                    golden: ty_g.clone(),
                    current: ty_c_str.clone(),
                });
            }
        }
    }

    // Fields in current that aren't in golden → warn. We iterate
    // required and optional both; either is a new field from the
    // golden's perspective.
    for (field, ty) in current
        .required_fields
        .iter()
        .chain(current.optional_fields.iter())
    {
        if !golden.required_fields.contains_key(field)
            && !golden.optional_fields.contains_key(field)
        {
            let mut fpath = path.to_vec();
            fpath.push(field.clone());
            report.warn(FailureKind::NewField {
                path: fpath,
                ty: ty.clone(),
            });
        }
    }
}

fn diff_probe_sequence(
    probe_name: &str,
    golden: &[String],
    current: &[String],
    report: &mut DiffReport,
) {
    let g_canon = canonical_type_sequence(golden);
    let c_canon = canonical_type_sequence(current);
    if g_canon == c_canon {
        return;
    }

    let g_set: BTreeSet<String> = g_canon.iter().cloned().collect();
    let c_set: BTreeSet<String> = c_canon.iter().cloned().collect();

    let removed: Vec<String> = g_set.difference(&c_set).cloned().collect();
    let added: Vec<String> = c_set.difference(&g_set).cloned().collect();

    if !removed.is_empty() {
        report.fail(FailureKind::RemovedSequenceSlots {
            probe_name: probe_name.to_string(),
            slots: removed,
        });
    }
    if !added.is_empty() {
        report.warn(FailureKind::NewSequenceSlots {
            probe_name: probe_name.to_string(),
            slots: added,
        });
    }
    // Same set of events, different canonical order → reorder fail.
    if g_set == c_set && g_canon != c_canon {
        report.fail(FailureKind::ReorderedSequence {
            probe_name: probe_name.to_string(),
            golden: g_canon,
            current: c_canon,
        });
    }
}

// -----------------------------------------------------------------------
// Fixture path resolution — [D13] no-fallback rule
// -----------------------------------------------------------------------

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("stream-json-catalog")
}

fn schema_path_for_version(version: &str) -> PathBuf {
    fixture_root()
        .join(format!("v{version}"))
        .join("schema.json")
}

// -----------------------------------------------------------------------
// The one real-claude test — drift regression entry point
// -----------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn stream_json_catalog_drift_regression() {
    if !real_claude_enabled() {
        eprintln!(
            "skipping stream_json_catalog_drift_regression: TUG_REAL_CLAUDE not set"
        );
        return;
    }

    // Hard refusal: same policy as capture_all_probes. If either auth
    // env var is set, refuse to run so the developer can `unset` and
    // retry with subscription auth. The spawn-site scrubs defend
    // silently but we prefer to fail loudly up front.
    for var in ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] {
        if std::env::var_os(var).is_some() {
            panic!(
                "{var} is set in the environment. This test spawns real \
                 claude which would use per-token API billing instead of \
                 your Max/Pro subscription. Run `unset {var}` and re-run."
            );
        }
    }

    let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let project_dir = project_dir
        .canonicalize()
        .expect("canonicalize project dir");

    let tmp = std::env::temp_dir().join(format!(
        "tugcast-drift-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&tmp).expect("create tmp dir");
    let _tmp_guard = TmpDirGuard(tmp.clone());

    // Drift test always runs with a single stability run (n=1). The
    // stability pass happens in the capture binary; the drift test's
    // job is to flag shape drift vs the committed baseline, and a
    // single run is sufficient for that (repeated runs wouldn't find
    // a divergence that the baseline already wouldn't). Honors
    // TUG_STABILITY if explicitly set, otherwise defaults to 1.
    let stability = stability_runs();
    let captures = capture_with_stability(stability, &tmp, &project_dir).await;

    let version = extract_version(&captures)
        .expect("no system_metadata version found — aborting per [D11]");

    let golden_path = schema_path_for_version(&version);
    if !golden_path.exists() {
        panic!(
            "no golden schema at {} — per [D13] there is no version \
             fallback. Run the capture binary to generate a baseline \
             for claude {version}, review the fixtures, then commit.",
            golden_path.display()
        );
    }

    let golden = load_schema(&golden_path)
        .unwrap_or_else(|e| panic!("load_schema({}): {e}", golden_path.display()));
    let current = derive_schema(&version, &captures);

    let report = diff_schemas(&golden, &current);

    // Always dump the full report, warnings included. The warnings
    // aren't a test failure but they're the signal that the golden
    // baseline is drifting toward needing a refresh.
    eprintln!("{}", report.format_report());

    if report.has_failures() {
        panic!(
            "stream-json catalog drift regression: {} fail-severity \
             finding(s) against golden schema v{version}. See stderr \
             for the full structured report.",
            report.failure_count(),
        );
    }

    eprintln!(
        "stream_json_catalog_drift_regression: clean ({} warning(s), 0 failures)",
        report.warn_count()
    );
}

/// RAII guard that `remove_dir_all`s its path on drop.
struct TmpDirGuard(PathBuf);
impl Drop for TmpDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// -----------------------------------------------------------------------
// Differ unit tests — run in default nextest, no real claude
// -----------------------------------------------------------------------

#[cfg(test)]
mod differ_tests {
    use super::*;

    // Helpers

    fn event_shape(
        required: &[(&str, &str)],
        optional: &[(&str, &str)],
    ) -> EventShape {
        let mut shape = EventShape::default();
        for (k, v) in required {
            shape
                .required_fields
                .insert(k.to_string(), v.to_string());
        }
        for (k, v) in optional {
            shape
                .optional_fields
                .insert(k.to_string(), v.to_string());
        }
        shape
    }

    fn schema_with_event(event_type: &str, shape: EventShape) -> Schema {
        let mut schema = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        schema.event_types.insert(event_type.to_string(), shape);
        schema
    }

    fn schema_with_probe_seq(probe_name: &str, seq: &[&str]) -> Schema {
        let mut schema = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        schema
            .probe_sequences
            .insert(probe_name.to_string(), seq.iter().map(|s| s.to_string()).collect());
        schema
    }

    fn assert_fail_kind(report: &DiffReport, predicate: impl Fn(&FailureKind) -> bool) {
        assert!(
            report
                .findings
                .iter()
                .any(|f| f.severity == Severity::Fail && predicate(&f.kind)),
            "expected a Fail finding matching predicate in report: {}",
            report.format_report(),
        );
    }

    fn assert_warn_kind(report: &DiffReport, predicate: impl Fn(&FailureKind) -> bool) {
        assert!(
            report
                .findings
                .iter()
                .any(|f| f.severity == Severity::Warn && predicate(&f.kind)),
            "expected a Warn finding matching predicate in report: {}",
            report.format_report(),
        );
    }

    // ---- 1. Identical shapes → empty report

    #[test]
    fn identical_schemas_produce_empty_report() {
        let shape = event_shape(&[("type", "string"), ("session_id", "string")], &[]);
        let golden = schema_with_event("session_init", shape.clone());
        let current = schema_with_event("session_init", shape);
        let report = diff_schemas(&golden, &current);
        assert_eq!(report.findings.len(), 0);
        assert!(!report.has_failures());
    }

    // ---- 2. New optional field in current → warn only

    #[test]
    fn new_optional_field_warns() {
        let golden = schema_with_event(
            "system_metadata",
            event_shape(&[("type", "string"), ("model", "string")], &[]),
        );
        let current = schema_with_event(
            "system_metadata",
            event_shape(
                &[("type", "string"), ("model", "string")],
                &[("inference_geo", "string")],
            ),
        );
        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
        assert_warn_kind(&report, |k| {
            matches!(k, FailureKind::NewField { path, .. } if path.last() == Some(&"inference_geo".to_string()))
        });
    }

    // ---- 3. Removed required field → fail

    #[test]
    fn removed_required_field_fails() {
        let golden = schema_with_event(
            "session_init",
            event_shape(
                &[
                    ("type", "string"),
                    ("session_id", "string"),
                    ("ipc_version", "integer"),
                ],
                &[],
            ),
        );
        let current = schema_with_event(
            "session_init",
            event_shape(&[("type", "string"), ("session_id", "string")], &[]),
        );
        let report = diff_schemas(&golden, &current);
        assert!(report.has_failures());
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::MissingRequiredField { path } if path.last() == Some(&"ipc_version".to_string()))
        });
    }

    // ---- 4. Type change → fail

    #[test]
    fn type_change_string_to_integer_fails() {
        let golden = schema_with_event(
            "cost_update",
            event_shape(&[("num_turns", "integer")], &[]),
        );
        let current = schema_with_event(
            "cost_update",
            event_shape(&[("num_turns", "string")], &[]),
        );
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::TypeMismatch { path, golden, current }
                if path.last() == Some(&"num_turns".to_string())
                && golden == "integer"
                && current == "string")
        });
    }

    // ---- 5. Event type missing in current → fail

    #[test]
    fn missing_event_type_in_current_fails() {
        let mut golden = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        golden
            .event_types
            .insert("assistant_text".into(), event_shape(&[("type", "string")], &[]));
        golden
            .event_types
            .insert("turn_complete".into(), event_shape(&[("type", "string")], &[]));

        let mut current = Schema {
            claude_version: "2.1.105".into(),
            ..Default::default()
        };
        current
            .event_types
            .insert("turn_complete".into(), event_shape(&[("type", "string")], &[]));

        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::MissingEventType { event_type } if event_type == "assistant_text")
        });
    }

    // ---- 6. Event type new in current → warn

    #[test]
    fn new_event_type_in_current_warns() {
        let golden = schema_with_event("session_init", event_shape(&[("type", "string")], &[]));
        let mut current = schema_with_event("session_init", event_shape(&[("type", "string")], &[]));
        current
            .event_types
            .insert("new_boundary".into(), event_shape(&[("type", "string")], &[]));

        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
        assert_warn_kind(&report, |k| {
            matches!(k, FailureKind::NewEventType { event_type } if event_type == "new_boundary")
        });
    }

    // ---- 7. Required field demoted to optional with same type → ok

    #[test]
    fn required_to_optional_same_type_is_ok() {
        // A field that was required in golden but is optional in
        // current (with the same type) is NOT a failure: it means the
        // field is still available, just not always populated.
        let golden = schema_with_event(
            "tool_result",
            event_shape(&[("parent_tool_use_id", "string")], &[]),
        );
        let current = schema_with_event(
            "tool_result",
            event_shape(&[], &[("parent_tool_use_id", "string")]),
        );
        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
    }

    // ---- 8. Required field demoted with type change → fail

    #[test]
    fn required_to_optional_type_change_fails() {
        let golden = schema_with_event(
            "tool_result",
            event_shape(&[("output", "string")], &[]),
        );
        let current = schema_with_event(
            "tool_result",
            event_shape(&[], &[("output", "integer")]),
        );
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| matches!(k, FailureKind::TypeMismatch { .. }));
    }

    // ---- 9. Polymorphic tool_use_structured: new tool_name → warn

    #[test]
    fn new_tool_use_union_arm_warns() {
        let mut golden = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        golden.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );

        let mut current = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        current.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );
        current.tool_use_structured_by_tool.insert(
            "Glob".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );

        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
        assert_warn_kind(&report, |k| {
            matches!(k, FailureKind::NewToolUseUnion { tool_name } if tool_name == "Glob")
        });
    }

    // ---- 10. Polymorphic tool_use_structured: removed tool_name → fail

    #[test]
    fn removed_tool_use_union_arm_fails() {
        let mut golden = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        golden.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );
        golden.tool_use_structured_by_tool.insert(
            "Bash".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );

        let mut current = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        current.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );

        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::RemovedToolUseUnion { tool_name } if tool_name == "Bash")
        });
    }

    // ---- 11. Tool_use_structured union arm shape diff → fail at tool_name path

    #[test]
    fn tool_use_union_arm_shape_diff_fails_at_tool_name_path() {
        let mut golden = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        golden.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(
                &[
                    ("tool_use_id", "string"),
                    ("structured_result", "object"),
                ],
                &[],
            ),
        );

        let mut current = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        // structured_result demoted to missing — shape drift
        current.tool_use_structured_by_tool.insert(
            "Read".into(),
            event_shape(&[("tool_use_id", "string")], &[]),
        );

        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::MissingRequiredField { path }
                if path.contains(&"tool_use_structured".to_string())
                && path.contains(&"structured_result".to_string()))
        });
    }

    // ---- 12. Probe sequence: added optional slot → warn

    #[test]
    fn probe_sequence_added_slot_warns() {
        // Golden sequence:  [system_metadata, assistant_text, turn_complete]
        // Current sequence: [system_metadata, thinking_text, assistant_text, turn_complete]
        // The new `thinking_text` is a warn (added slot).
        let golden = schema_with_probe_seq(
            "test-01",
            &["system_metadata", "assistant_text", "turn_complete"],
        );
        let current = schema_with_probe_seq(
            "test-01",
            &[
                "system_metadata",
                "thinking_text",
                "assistant_text",
                "turn_complete",
            ],
        );
        let report = diff_schemas(&golden, &current);
        assert_warn_kind(&report, |k| {
            matches!(k, FailureKind::NewSequenceSlots { probe_name, slots }
                if probe_name == "test-01"
                && slots.contains(&"thinking_text".to_string()))
        });
        assert!(!report.has_failures());
    }

    // ---- 13. Probe sequence: removed required slot → fail

    #[test]
    fn probe_sequence_removed_slot_fails() {
        let golden = schema_with_probe_seq(
            "test-01",
            &["system_metadata", "thinking_text", "assistant_text", "turn_complete"],
        );
        let current = schema_with_probe_seq(
            "test-01",
            &["system_metadata", "assistant_text", "turn_complete"],
        );
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::RemovedSequenceSlots { probe_name, slots }
                if probe_name == "test-01"
                && slots.contains(&"thinking_text".to_string()))
        });
    }

    // ---- 14. Probe sequence: reordered same events → fail

    #[test]
    fn probe_sequence_reordered_fails() {
        let golden = schema_with_probe_seq("test-01", &["a", "b", "c"]);
        let current = schema_with_probe_seq("test-01", &["a", "c", "b"]);
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::ReorderedSequence { probe_name, .. }
                if probe_name == "test-01")
        });
    }

    // ---- 15. Probe sequence count variance (canonical match) → ok

    #[test]
    fn probe_sequence_count_variance_is_ok() {
        // Golden has 3 assistant_text partials, current has 5.
        // Canonicalization collapses consecutive duplicates so both
        // become [system_metadata, assistant_text, turn_complete].
        let golden = schema_with_probe_seq(
            "test-02",
            &[
                "system_metadata",
                "assistant_text",
                "assistant_text",
                "assistant_text",
                "turn_complete",
            ],
        );
        let current = schema_with_probe_seq(
            "test-02",
            &[
                "system_metadata",
                "assistant_text",
                "assistant_text",
                "assistant_text",
                "assistant_text",
                "assistant_text",
                "turn_complete",
            ],
        );
        let report = diff_schemas(&golden, &current);
        assert_eq!(report.findings.len(), 0);
    }

    // ---- 16. Probe missing in current → fail

    #[test]
    fn probe_missing_in_current_fails() {
        let mut golden = schema_with_probe_seq("test-01", &["a", "b"]);
        golden
            .probe_sequences
            .insert("test-02".into(), vec!["c".into(), "d".into()]);

        let current = schema_with_probe_seq("test-01", &["a", "b"]);
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::MissingProbe { probe_name } if probe_name == "test-02")
        });
    }

    // ---- 17. New probe in current → warn

    #[test]
    fn new_probe_in_current_warns() {
        let golden = schema_with_probe_seq("test-01", &["a", "b"]);
        let mut current = schema_with_probe_seq("test-01", &["a", "b"]);
        current
            .probe_sequences
            .insert("test-new".into(), vec!["x".into(), "y".into()]);
        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
        assert_warn_kind(&report, |k| {
            matches!(k, FailureKind::NewProbe { probe_name } if probe_name == "test-new")
        });
    }

    // ---- 18. Empty golden, non-empty current: everything new → all warns

    #[test]
    fn empty_golden_non_empty_current_all_warns() {
        let golden = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        let current = schema_with_event("session_init", event_shape(&[("type", "string")], &[]));
        let report = diff_schemas(&golden, &current);
        assert!(!report.has_failures());
        assert_warn_kind(&report, |k| matches!(k, FailureKind::NewEventType { .. }));
    }

    // ---- 19. Empty current, non-empty golden: everything missing → all fails

    #[test]
    fn empty_current_non_empty_golden_all_fails() {
        let golden = schema_with_event("session_init", event_shape(&[("type", "string")], &[]));
        let current = Schema {
            claude_version: "2.1.104".into(),
            ..Default::default()
        };
        let report = diff_schemas(&golden, &current);
        assert!(report.has_failures());
        assert_fail_kind(&report, |k| {
            matches!(k, FailureKind::MissingEventType { event_type } if event_type == "session_init")
        });
    }

    // ---- 20. Format report is non-empty for non-empty findings

    #[test]
    fn format_report_renders_structured_findings() {
        let mut report = DiffReport::new();
        report.fail(FailureKind::MissingEventType {
            event_type: "foo".into(),
        });
        report.warn(FailureKind::NewField {
            path: vec!["system_metadata".into(), "new_key".into()],
            ty: "string".into(),
        });
        let rendered = report.format_report();
        assert!(rendered.contains("1 failure(s)"));
        assert!(rendered.contains("1 warning(s)"));
        assert!(rendered.contains("FAIL"));
        assert!(rendered.contains("WARN"));
        assert!(rendered.contains("foo"));
        assert!(rendered.contains("new_key"));
    }

    // ---- 21. Required + optional overlap in golden: optional field
    // present in current with matching type is ok

    #[test]
    fn optional_field_type_match_in_current_is_ok() {
        let golden = schema_with_event(
            "tool_result",
            event_shape(&[("type", "string")], &[("parent_tool_use_id", "string")]),
        );
        let current = schema_with_event(
            "tool_result",
            event_shape(&[("type", "string")], &[("parent_tool_use_id", "string")]),
        );
        let report = diff_schemas(&golden, &current);
        assert_eq!(report.findings.len(), 0);
    }

    // ---- 22. Optional field type change → fail

    #[test]
    fn optional_field_type_mismatch_fails() {
        let golden = schema_with_event(
            "tool_result",
            event_shape(&[], &[("parent_tool_use_id", "string")]),
        );
        let current = schema_with_event(
            "tool_result",
            event_shape(&[], &[("parent_tool_use_id", "integer")]),
        );
        let report = diff_schemas(&golden, &current);
        assert_fail_kind(&report, |k| matches!(k, FailureKind::TypeMismatch { .. }));
    }

    // ---- 23. load_schema round-trip

    #[test]
    fn load_schema_parses_expected_structure() {
        use serde_json::json;
        let schema_json = json!({
            "claude_version": "2.1.104",
            "event_types": {
                "session_init": {
                    "required_fields": { "type": "string", "session_id": "string" },
                    "optional_fields": {}
                },
                "tool_use_structured": {
                    "by_tool_name": {
                        "Read": {
                            "required_fields": { "tool_use_id": "string" },
                            "optional_fields": {}
                        }
                    }
                }
            },
            "probe_sequences": {
                "test-01": {
                    "required_sequence": ["session_init", "turn_complete"]
                }
            }
        });
        let tmp = std::env::temp_dir().join(format!(
            "drift-differ-test-{}.json",
            std::process::id()
        ));
        std::fs::write(&tmp, serde_json::to_string_pretty(&schema_json).unwrap())
            .expect("write tmp schema");

        let loaded = load_schema(&tmp).expect("load_schema ok");
        assert_eq!(loaded.claude_version, "2.1.104");
        assert!(loaded.event_types.contains_key("session_init"));
        assert!(
            loaded
                .tool_use_structured_by_tool
                .contains_key("Read")
        );
        assert_eq!(
            loaded.probe_sequences.get("test-01"),
            Some(&vec!["session_init".to_string(), "turn_complete".to_string()])
        );

        let _ = std::fs::remove_file(&tmp);
    }

    // ---- 24. load_schema fails hard on missing file

    #[test]
    fn load_schema_fails_on_missing_file() {
        let fake = PathBuf::from("/tmp/definitely-does-not-exist-xyz-drift.json");
        assert!(load_schema(&fake).is_err());
    }
}
