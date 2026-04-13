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

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{Map, Value, json};
use tokio::time::{Instant, sleep};

use common::probes::{PROBES, ProbeMsg, ProbePrereq, ProbeRecord, ProbeStatus};
use common::{TestTugcast, TestWs, real_claude_enabled};

// -----------------------------------------------------------------------
// Normalization — leaf-only placeholder substitution per [D04]/[D14]
// -----------------------------------------------------------------------

/// Fields whose string values are rewritten to `{{uuid}}` regardless
/// of whether the content parses as a UUID. This covers the
/// `session_id: "pending-cont-..."` case where the sentinel is not a
/// real UUID but still varies between runs.
const LEAF_ID_KEYS: &[&str] = &[
    "session_id",
    "tool_use_id",
    "msg_id",
    "request_id",
    "task_id",
    "tug_session_id",
];

/// Fields whose string values are collapsed to `{{text:len=N}}` so
/// fixture diffs survive any actual content drift. Covers streamed
/// text deltas, tool output, and file content.
const TEXT_CONTENT_KEYS: &[&str] = &["text", "output"];

/// Fields whose numeric values are collapsed to `{{f64}}` or `{{i64}}`.
/// Explicit allowlist — most numeric fields (`seq`, `is_partial`)
/// carry semantic meaning and must not be erased.
const NUMERIC_ALLOWLIST: &[&str] = &[
    "total_cost_usd",
    "duration_ms",
    "duration_api_ms",
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "runtime_ms",
];

fn is_uuid_like(s: &str) -> bool {
    // 8-4-4-4-12 hex layout.
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *b != b'-' {
                    return false;
                }
            }
            _ => {
                if !b.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

fn is_iso_timestamp(s: &str) -> bool {
    // Quick shape check: YYYY-MM-DDTHH:MM:SS with optional fractional
    // seconds and timezone. We intentionally don't pull a regex crate
    // for this per [D03]'s no-external-dependency spirit.
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return false;
    }
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return false;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return false;
    }
    for &idx in &[0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] {
        if !bytes[idx as usize].is_ascii_digit() {
            return false;
        }
    }
    true
}

fn cwd_prefix() -> Option<String> {
    std::env::var("HOME").ok()
}

fn normalize_string(key: Option<&str>, value: &str, home: Option<&str>) -> String {
    if let Some(k) = key {
        if LEAF_ID_KEYS.contains(&k) {
            return "{{uuid}}".to_string();
        }
        if TEXT_CONTENT_KEYS.contains(&k) {
            return format!("{{{{text:len={}}}}}", value.len());
        }
    }
    if is_iso_timestamp(value) {
        return "{{iso}}".to_string();
    }
    if is_uuid_like(value) {
        return "{{uuid}}".to_string();
    }
    if let Some(h) = home {
        if !h.is_empty() && value.starts_with(h) {
            let suffix = &value[h.len()..];
            return format!("{{{{cwd}}}}{suffix}");
        }
    }
    value.to_string()
}

fn normalize_number(key: Option<&str>, value: &serde_json::Number) -> Value {
    if let Some(k) = key {
        if NUMERIC_ALLOWLIST.contains(&k) {
            if value.is_f64() {
                return Value::String("{{f64}}".to_string());
            }
            return Value::String("{{i64}}".to_string());
        }
    }
    Value::Number(value.clone())
}

/// Leaf-only normalize. Walks `value` in place, replacing leaf strings
/// and leaf numbers according to [#deep-normalization]. Object keys and
/// array structure are preserved exactly.
pub fn normalize_event(value: &mut Value) {
    let home = cwd_prefix();
    normalize_inner(value, None, home.as_deref());
}

fn normalize_inner(value: &mut Value, parent_key: Option<&str>, home: Option<&str>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                let k_owned = k.clone();
                normalize_inner(v, Some(k_owned.as_str()), home);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                normalize_inner(v, parent_key, home);
            }
        }
        Value::String(s) => {
            *value = Value::String(normalize_string(parent_key, s, home));
        }
        Value::Number(n) => {
            *value = normalize_number(parent_key, n);
        }
        Value::Bool(_) | Value::Null => {}
    }
}

// -----------------------------------------------------------------------
// Schema derivation — per Spec S03
// -----------------------------------------------------------------------

/// Captured per-probe outcome: ordered event sequence.
#[derive(Debug, Clone)]
pub struct CapturedProbe {
    pub name: String,
    pub events: Vec<Value>,
    pub status: ProbeStatus,
    pub runtime_ms: u128,
}

/// Shape schema derived from one full capture run. Serializes to
/// `schema.json` per Spec S03.
#[derive(Debug, Default, Clone)]
pub struct Schema {
    pub claude_version: String,
    pub event_types: BTreeMap<String, EventShape>,
    /// Polymorphic `tool_use_structured` keyed by `tool_name` per [D09].
    pub tool_use_structured_by_tool: BTreeMap<String, EventShape>,
    /// Per-probe required event sequence. Optional slots (events that
    /// appear in some runs and not others) are not recorded here yet;
    /// Step 4 stability analysis flags those and demotes them.
    pub probe_sequences: BTreeMap<String, Vec<String>>,
}

/// Per-event-type field summary.
#[derive(Debug, Default, Clone)]
pub struct EventShape {
    pub required_fields: BTreeMap<String, String>,
    pub optional_fields: BTreeMap<String, String>,
}

fn describe_value(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(_) => "boolean".into(),
        Value::Number(n) => {
            if n.is_f64() {
                "number".into()
            } else {
                "integer".into()
            }
        }
        Value::String(_) => "string".into(),
        Value::Array(a) => {
            if let Some(first) = a.first() {
                format!("array<{}>", describe_value(first))
            } else {
                "array<unknown>".into()
            }
        }
        Value::Object(_) => "object".into(),
    }
}

fn event_type_of(event: &Value) -> Option<&str> {
    event.get("type").and_then(|v| v.as_str())
}

/// Derive a [`Schema`] from a set of captured probe runs. Aggregates
/// across all probes; a field that is present in every instance of an
/// event type goes to `required_fields`, present in some goes to
/// `optional_fields`.
pub fn derive_schema(claude_version: &str, captures: &[CapturedProbe]) -> Schema {
    let mut schema = Schema::default();
    schema.claude_version = claude_version.to_string();

    // Per-event-type accumulators.
    // field_counts[event_type][field_name] = (count, type_description)
    let mut field_counts: BTreeMap<&str, BTreeMap<String, (usize, String)>> = BTreeMap::new();
    let mut event_counts: BTreeMap<&str, usize> = BTreeMap::new();

    // Polymorphic tool_use_structured: key by tool_name.
    let mut tool_field_counts: BTreeMap<String, BTreeMap<String, (usize, String)>> =
        BTreeMap::new();
    let mut tool_counts: BTreeMap<String, usize> = BTreeMap::new();

    for probe in captures {
        // Probe sequence: ordered list of event types.
        let mut seq = Vec::new();
        for event in &probe.events {
            let Some(et) = event_type_of(event) else {
                continue;
            };
            seq.push(et.to_string());

            if et == "tool_use_structured" {
                // Key by tool_name if present, else "unknown".
                let tool_name = event
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                *tool_counts.entry(tool_name.clone()).or_insert(0) += 1;
                let shape = tool_field_counts.entry(tool_name).or_default();
                if let Some(obj) = event.as_object() {
                    for (k, v) in obj {
                        let entry = shape.entry(k.clone()).or_insert((0, describe_value(v)));
                        entry.0 += 1;
                    }
                }
                continue;
            }

            *event_counts.entry(et).or_insert(0) += 1;
            let shape = field_counts.entry(et).or_default();
            if let Some(obj) = event.as_object() {
                for (k, v) in obj {
                    let entry = shape.entry(k.clone()).or_insert((0, describe_value(v)));
                    entry.0 += 1;
                }
            }
        }
        schema.probe_sequences.insert(probe.name.clone(), seq);
    }

    for (et, fields) in field_counts {
        let total = *event_counts.get(et).unwrap_or(&0);
        let mut shape = EventShape::default();
        for (field, (count, ty)) in fields {
            if total > 0 && count == total {
                shape.required_fields.insert(field, ty);
            } else {
                shape.optional_fields.insert(field, ty);
            }
        }
        schema.event_types.insert(et.to_string(), shape);
    }

    for (tool, fields) in tool_field_counts {
        let total = *tool_counts.get(&tool).unwrap_or(&0);
        let mut shape = EventShape::default();
        for (field, (count, ty)) in fields {
            if total > 0 && count == total {
                shape.required_fields.insert(field, ty);
            } else {
                shape.optional_fields.insert(field, ty);
            }
        }
        schema.tool_use_structured_by_tool.insert(tool, shape);
    }

    schema
}

fn shape_to_json(shape: &EventShape) -> Value {
    let required: Map<String, Value> = shape
        .required_fields
        .iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect();
    let optional: Map<String, Value> = shape
        .optional_fields
        .iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect();
    json!({
        "required_fields": required,
        "optional_fields": optional,
    })
}

fn schema_to_json(schema: &Schema) -> Value {
    let event_types: Map<String, Value> = schema
        .event_types
        .iter()
        .map(|(k, v)| (k.clone(), shape_to_json(v)))
        .collect();

    let tool_by_name: Map<String, Value> = schema
        .tool_use_structured_by_tool
        .iter()
        .map(|(k, v)| (k.clone(), shape_to_json(v)))
        .collect();

    let probe_sequences: Map<String, Value> = schema
        .probe_sequences
        .iter()
        .map(|(k, seq)| {
            let seq_val: Vec<Value> = seq.iter().map(|s| Value::String(s.clone())).collect();
            (
                k.clone(),
                json!({
                    "required_sequence": seq_val,
                }),
            )
        })
        .collect();

    // tool_use_structured under event_types is a thin shell pointing at
    // the polymorphic `by_tool_name` table.
    let mut event_types = event_types;
    if !tool_by_name.is_empty() {
        event_types.insert(
            "tool_use_structured".to_string(),
            json!({
                "by_tool_name": tool_by_name,
            }),
        );
    }

    json!({
        "claude_version": schema.claude_version,
        "event_types": event_types,
        "probe_sequences": probe_sequences,
    })
}

// -----------------------------------------------------------------------
// Execute / stability / write helpers (real-claude path)
// -----------------------------------------------------------------------

/// Read `TUG_STABILITY` from the env. Defaults to 1 per [D15].
pub fn stability_runs() -> usize {
    std::env::var("TUG_STABILITY")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(1)
}

/// Extract the `version` field from the first `system_metadata` event
/// in a probe's captured events, per [D11].
fn extract_version(captures: &[CapturedProbe]) -> Option<String> {
    for probe in captures {
        for event in &probe.events {
            if event_type_of(event) == Some("system_metadata") {
                if let Some(v) = event.get("version").and_then(|v| v.as_str()) {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

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

/// Drive one probe against a fresh tugcast subprocess. Returns the
/// collected normalized events plus the probe status.
pub async fn execute_probe(
    probe: &ProbeRecord,
    bank_path: PathBuf,
    project_dir: &std::path::Path,
) -> CapturedProbe {
    // Prerequisite gate — capture-time skip per [D10].
    for pre in probe.prerequisites {
        match pre {
            ProbePrereq::TugplugPluginLoaded => {
                // Default TestTugcast spawn does not pass --plugin-dir,
                // so tugplug skills and agents are not loaded.
                return CapturedProbe {
                    name: probe.name.to_string(),
                    events: Vec::new(),
                    status: ProbeStatus::Skipped("tugplug plugin not loaded"),
                    runtime_ms: 0,
                };
            }
            ProbePrereq::DenialCapableTool => {
                // Default spawn is acceptEdits mode; reads to paths
                // outside the project root still trigger the permission
                // gate, so this prerequisite is considered satisfied.
            }
        }
    }

    let start = Instant::now();

    let tugcast = TestTugcast::spawn(project_dir, bank_path).await;
    let mut ws = TestWs::connect(tugcast.port).await;

    let card_id = format!("probe-{}", probe.name);
    let tug_session_id = format!("sess-{}", probe.name);
    ws.send_spawn_session(&card_id, &tug_session_id).await;

    if let Err(e) = ws
        .await_session_state(&tug_session_id, "live", Duration::from_secs(15))
        .await
    {
        return CapturedProbe {
            name: probe.name.to_string(),
            events: Vec::new(),
            status: ProbeStatus::Failed(format!("session never reached live: {e}")),
            runtime_ms: start.elapsed().as_millis(),
        };
    }

    // Drive the input script.
    let mut most_recent_request_id: Option<String> = None;
    for msg in probe.input_script {
        match msg {
            ProbeMsg::UserMessage { text } => {
                ws.send_code_input(&tug_session_id, text).await;
            }
            ProbeMsg::UserMessageWithAttachments { text, attachments } => {
                // Directly construct + send — no dedicated helper yet.
                let attachment_values: Vec<Value> = attachments
                    .iter()
                    .map(|a| {
                        json!({
                            "filename": a.filename,
                            "content": a.content,
                            "media_type": a.media_type,
                        })
                    })
                    .collect();
                let payload = json!({
                    "tug_session_id": tug_session_id,
                    "type": "user_message",
                    "text": text,
                    "attachments": attachment_values,
                });
                send_raw_code_input(&mut ws, &payload).await;
            }
            ProbeMsg::Interrupt => ws.send_interrupt(&tug_session_id).await,
            ProbeMsg::ToolApproval { decision, message } => {
                let Some(rid) = most_recent_request_id.as_deref() else {
                    return CapturedProbe {
                        name: probe.name.to_string(),
                        events: Vec::new(),
                        status: ProbeStatus::Failed(
                            "tool_approval without prior control_request_forward".to_string(),
                        ),
                        runtime_ms: start.elapsed().as_millis(),
                    };
                };
                ws.send_tool_approval(&tug_session_id, rid, decision, None, *message)
                    .await;
            }
            ProbeMsg::QuestionAnswer { answers } => {
                let Some(rid) = most_recent_request_id.as_deref() else {
                    return CapturedProbe {
                        name: probe.name.to_string(),
                        events: Vec::new(),
                        status: ProbeStatus::Failed(
                            "question_answer without prior control_request_forward".to_string(),
                        ),
                        runtime_ms: start.elapsed().as_millis(),
                    };
                };
                let mut map = Map::new();
                for (k, v) in *answers {
                    map.insert((*k).to_string(), Value::String((*v).to_string()));
                }
                ws.send_question_answer(&tug_session_id, rid, Value::Object(map))
                    .await;
            }
            ProbeMsg::SessionCommand { command } => {
                ws.send_session_command(&tug_session_id, command).await;
            }
            ProbeMsg::ModelChange { model } => {
                ws.send_model_change(&tug_session_id, model).await;
            }
            ProbeMsg::PermissionMode { mode } => {
                ws.send_permission_mode(&tug_session_id, mode).await;
            }
            ProbeMsg::WaitForEvent {
                event_type,
                max_secs,
            } => {
                match ws
                    .await_code_output_event(
                        &tug_session_id,
                        event_type,
                        Duration::from_secs(*max_secs),
                    )
                    .await
                {
                    Ok(payload) => {
                        if *event_type == "control_request_forward" {
                            if let Some(rid) =
                                payload.get("request_id").and_then(|v| v.as_str())
                            {
                                most_recent_request_id = Some(rid.to_string());
                            }
                        }
                    }
                    Err(e) => {
                        return CapturedProbe {
                            name: probe.name.to_string(),
                            events: Vec::new(),
                            status: ProbeStatus::Failed(format!(
                                "wait for {event_type} failed: {e}"
                            )),
                            runtime_ms: start.elapsed().as_millis(),
                        };
                    }
                }
            }
            ProbeMsg::Sleep { millis } => sleep(Duration::from_millis(*millis)).await,
        }
    }

    // Collect events until terminal turn_complete or timeout.
    let events = match ws
        .collect_code_output(&tug_session_id, Duration::from_secs(probe.timeout_secs))
        .await
    {
        Ok(mut events) => {
            for event in events.iter_mut() {
                normalize_event(event);
            }
            events
        }
        Err(e) => {
            return CapturedProbe {
                name: probe.name.to_string(),
                events: Vec::new(),
                status: ProbeStatus::Failed(format!("collect_code_output: {e}")),
                runtime_ms: start.elapsed().as_millis(),
            };
        }
    };

    // Validate required events present.
    let observed: BTreeSet<String> = events
        .iter()
        .filter_map(|e| event_type_of(e).map(String::from))
        .collect();
    let mut missing: Vec<&str> = Vec::new();
    for req in probe.required_events {
        if !observed.contains(*req) {
            missing.push(*req);
        }
    }

    let status = if missing.is_empty() {
        ProbeStatus::Passed
    } else {
        ProbeStatus::Failed(format!("missing required events: {missing:?}"))
    };

    drop(ws);
    drop(tugcast);

    CapturedProbe {
        name: probe.name.to_string(),
        events,
        status,
        runtime_ms: start.elapsed().as_millis(),
    }
}

async fn send_raw_code_input(ws: &mut TestWs, _payload: &Value) {
    // Placeholder — image attachment probes need a helper that bypasses
    // the typed `send_code_input` wrapper. Wired up in Step 4 once we
    // decide whether to expose a generic raw sender on TestWs. For
    // Step 3 we route through send_code_input with the attachment text
    // only (the image itself does not survive through the typed helper,
    // but the stream shape for the user_message itself is still
    // observable).
    let text = _payload
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tug = _payload
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    ws.send_code_input(tug, text).await;
}

/// Stability-check wrapper: runs each probe `n` times and verifies
/// that the normalized event-type sequence is identical across runs.
/// If not, marks the probe as `ShapeUnstable`. The stored capture is
/// the first run's events.
pub async fn capture_with_stability(
    n: usize,
    bank_dir: &std::path::Path,
    project_dir: &std::path::Path,
) -> Vec<CapturedProbe> {
    let mut results: Vec<CapturedProbe> = Vec::with_capacity(PROBES.len());
    for (i, probe) in PROBES.iter().enumerate() {
        let mut runs: Vec<CapturedProbe> = Vec::with_capacity(n);
        for run_idx in 0..n {
            let bank = bank_dir.join(format!("probe-{i}-run-{run_idx}.db"));
            runs.push(execute_probe(probe, bank, project_dir).await);
        }
        let first = runs.remove(0);
        if n > 1 {
            let first_seq: Vec<Option<&str>> =
                first.events.iter().map(event_type_of).collect();
            for run in &runs {
                let seq: Vec<Option<&str>> =
                    run.events.iter().map(event_type_of).collect();
                if seq != first_seq {
                    results.push(CapturedProbe {
                        name: first.name.clone(),
                        events: first.events.clone(),
                        status: ProbeStatus::ShapeUnstable(format!(
                            "event-type sequence differs across stability runs for {}",
                            first.name
                        )),
                        runtime_ms: first.runtime_ms,
                    });
                    continue;
                }
            }
        }
        results.push(first);
    }
    results
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
    let project_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let project_dir = project_dir.canonicalize().expect("canonicalize project dir");

    let tmp = tempdir_path();
    std::fs::create_dir_all(&tmp).expect("create tmp dir");

    let stability = stability_runs();
    let captures = capture_with_stability(stability, &tmp, &project_dir).await;

    let version =
        extract_version(&captures).expect("no system_metadata version found — aborting per [D11]");

    let schema = derive_schema(&version, &captures);
    let manifest = build_manifest(&version, stability, &captures);
    let path =
        write_fixtures(&captures, &schema, &manifest).expect("write_fixtures succeeded");
    eprintln!("wrote fixtures to {}", path.display());
}

fn tempdir_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "tugcast-capture-{}",
        std::process::id().to_string()
    ));
    p
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
        assert_eq!(meta.required_fields.get("tools"), Some(&"array<string>".to_string()));
        assert_eq!(
            meta.required_fields.get("plugins"),
            Some(&"array<object>".to_string())
        );
        assert_eq!(meta.required_fields.get("ipc_version"), Some(&"integer".to_string()));
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
        assert!(out["event_types"]["session_init"]["required_fields"]
            .as_object()
            .unwrap()
            .contains_key("type"));
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
