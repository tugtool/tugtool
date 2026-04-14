//! Shared catalog capture machinery: normalization, schema derivation,
//! and per-probe execution. Used by both the Step 3/4 capture binary
//! (`tests/capture_stream_json_catalog.rs`) and the Step 6 drift test
//! (`tests/stream_json_catalog_drift.rs`).
//!
//! Originally lived in the capture binary; extracted into `common/` so
//! the drift test can call `execute_probe` and `derive_schema` without
//! duplicating ~500 lines. Each integration test file compiles to its
//! own crate so "just import from the other test file" is not an
//! option — the `mod common;` pattern is the canonical share
//! mechanism.
//!
//! See `roadmap/tugplan-golden-stream-json-catalog.md` for the full
//! scope. This file is the source of truth for all normalization and
//! schema semantics that the drift test needs to match bit-for-bit.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{Map, Value, json};
use tokio::time::{Instant, sleep};

use crate::common::probes::{ProbeMsg, ProbePrereq, ProbeRecord, ProbeStatus};
use crate::common::{TestTugcast, TestWs};

// -----------------------------------------------------------------------
// Subscription-auth scrub list + pre-flight refusal
// -----------------------------------------------------------------------

/// Environment variables that override claude CLI's subscription auth
/// resolution. If any of these is set in the parent environment, claude
/// authenticates against per-token API billing instead of the
/// developer's `~/.claude.json` subscription login. The capture binary
/// and the drift regression test both `env_remove` these from the
/// spawned tugcast subprocess, and both pre-flight-refuse to run if any
/// of them is set in the test-invoker's shell (so the developer sees a
/// loud failure up front rather than discovering an `apiKeySource`
/// contamination in a committed fixture later).
///
/// - `ANTHROPIC_API_KEY` — the classic API key, per-token billing.
/// - `ANTHROPIC_AUTH_TOKEN` — alternate API auth header some Anthropic
///   SDKs and wrappers use; also per-token.
/// - `CLAUDE_CODE_OAUTH_TOKEN` — long-lived token from `claude
///   setup-token`. Subscription-tied, so technically safe in isolation,
///   but we scrub it defensively to keep all subscription auth flowing
///   through `~/.claude.json` / the macOS Keychain instead of a shell
///   variable whose provenance the test can't easily audit.
pub const AUTH_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];

/// Pre-flight refusal: panic with a loud, specific message if any of
/// [`AUTH_ENV_VARS`] is set in the current environment. Called at the
/// top of every real-claude test body so the developer sees the
/// problem before we spawn a subprocess chain that would silently fall
/// through to per-token billing.
///
/// The spawn-site `env_remove` calls also defend against leakage (belt
/// and suspenders), but failing loudly up front lets the developer
/// `unset` the variable and retry rather than discovering the leak by
/// reading an `apiKeySource` field in committed output later.
pub fn refuse_if_auth_env_set() {
    for var in AUTH_ENV_VARS {
        if std::env::var_os(var).is_some() {
            panic!(
                "{var} is set in the environment. This test spawns real \
                 claude and this variable would cause claude to authenticate \
                 via per-token API billing instead of your Max/Pro \
                 subscription at ~/.claude.json. Run `unset {var}` in this \
                 shell and re-run.\n\
                 \n\
                 (Spawn sites also scrub this variable defensively, so this \
                 refusal is a warning — not a hard dependency — but we prefer \
                 to fail loudly rather than silently change auth mode.)"
            );
        }
    }
}

/// Fixture root: `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`.
/// Both the capture binary (as the writer of `v<version>/`) and the drift
/// regression test (as the reader of `v<version>/schema.json`) resolve
/// fixtures through this function. Centralized so a future restructure
/// (e.g., moving fixtures up or down in the tree) touches exactly one
/// line.
pub fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("stream-json-catalog")
}

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

pub fn describe_value(value: &Value) -> String {
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

pub fn event_type_of(event: &Value) -> Option<&str> {
    event.get("type").and_then(|v| v.as_str())
}

/// Derive a [`Schema`] from a set of captured probe runs. Aggregates
/// across all probes; a field that is present in every instance of an
/// event type goes to `required_fields`, present in some goes to
/// `optional_fields`.
pub fn derive_schema(claude_version: &str, captures: &[CapturedProbe]) -> Schema {
    let mut schema = Schema {
        claude_version: claude_version.to_string(),
        ..Default::default()
    };

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

pub fn shape_to_json(shape: &EventShape) -> Value {
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

pub fn schema_to_json(schema: &Schema) -> Value {
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
// Execute / stability helpers (real-claude path)
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
pub fn extract_version(captures: &[CapturedProbe]) -> Option<String> {
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

/// Drive one probe against a fresh tugcast subprocess. Returns the
/// collected normalized events plus the probe status.
pub async fn execute_probe(
    probe: &ProbeRecord,
    bank_path: PathBuf,
    project_dir: &std::path::Path,
) -> CapturedProbe {
    // Known-bug skip gate — probes with a `skip_reason` pointer at
    // a tide.md §T0.5 follow-up bypass execution entirely. This is
    // how blocked-on-upstream-bug probes stay in the fixture catalog
    // (with an explicit `skipped` status + reason in manifest.json)
    // without corrupting the baseline with half-captured events.
    if let Some(reason) = probe.skip_reason {
        return CapturedProbe {
            name: probe.name.to_string(),
            events: Vec::new(),
            status: ProbeStatus::Skipped(reason),
            runtime_ms: 0,
        };
    }

    // Prerequisite gate — capture-time skip per [D10].
    for pre in probe.prerequisites {
        match pre {
            ProbePrereq::TugplugPluginLoaded => {
                // tugcode derives `--plugin-dir` from `<project_dir>/tugplug/`.
                // The prerequisite is met iff that directory actually
                // exists — which is true when `project_dir` is the
                // tugtool repo root (the capture binary case) and false
                // when it's a crate-level cwd (the multi_session_real_claude
                // case). Checking on disk keeps the probe table
                // environment-agnostic.
                if !project_dir.join("tugplug").is_dir() {
                    return CapturedProbe {
                        name: probe.name.to_string(),
                        events: Vec::new(),
                        status: ProbeStatus::Skipped("tugplug plugin not loaded"),
                        runtime_ms: 0,
                    };
                }
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

    // Wait for the pending confirmation only. The router's state
    // machine is Pending → Spawning → Live, and the transition out of
    // Pending requires the first UserMessage to arrive — waiting for
    // `live` here would deadlock forever since we haven't sent anything
    // yet. The input_script below sends the first message which drives
    // the spawn, and `collect_code_output` at the end naturally waits
    // for the real events to arrive.
    if let Err(e) = ws
        .await_session_state(&tug_session_id, "pending", Duration::from_secs(10))
        .await
    {
        return CapturedProbe {
            name: probe.name.to_string(),
            events: Vec::new(),
            status: ProbeStatus::Failed(format!("session never reached pending: {e}")),
            runtime_ms: start.elapsed().as_millis(),
        };
    }

    // Drive the input script.
    //
    // `request_id_by_tool_use_id` is the correlation store for the
    // permission / AskUserQuestion flow: every `control_request_forward`
    // we observe during `WaitForEvent` carries its own `request_id`
    // and — when the forward is gating a tool call — a `tool_use_id`
    // pointing back at the preceding `tool_use` event. Stashing both
    // lets a future probe answer a specific forward by tool_use_id
    // rather than "whichever was most recent".
    //
    // `most_recent_request_id` is the fallback used by the current
    // `ToolApproval` / `QuestionAnswer` variants, which don't yet
    // specify which forward to answer. When a probe eventually needs
    // targeted correlation, the variant can grow a `target_tool_use_id`
    // field and `execute_probe` will look it up in the map.
    let mut request_id_by_tool_use_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut most_recent_request_id: Option<String> = None;
    for msg in probe.input_script {
        match msg {
            ProbeMsg::UserMessage { text } => {
                ws.send_code_input(&tug_session_id, text).await;
            }
            ProbeMsg::UserMessageWithAttachments { text, attachments } => {
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
                ws.send_user_message_with_attachments(&tug_session_id, text, attachment_values)
                    .await;
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
                // Non-consuming peek: the waited-for event is part
                // of the fixture shape the collect pass records. An
                // `await_code_output_event` here would remove the
                // frame from the buffer, and `collect_code_output`
                // would never emit it — the captured JSONL would be
                // missing an event claude actually sent.
                match ws
                    .peek_code_output_event(
                        &tug_session_id,
                        event_type,
                        Duration::from_secs(*max_secs),
                    )
                    .await
                {
                    Ok(payload) => {
                        if *event_type == "control_request_forward" {
                            if let Some(rid) = payload.get("request_id").and_then(|v| v.as_str()) {
                                most_recent_request_id = Some(rid.to_string());
                                if let Some(tuid) =
                                    payload.get("tool_use_id").and_then(|v| v.as_str())
                                {
                                    request_id_by_tool_use_id
                                        .insert(tuid.to_string(), rid.to_string());
                                }
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

/// Canonicalize an event list for shape-stability comparison:
/// collapse consecutive duplicates.
///
/// Claude's streaming protocol emits a **variable** number of
/// `assistant_text` and `thinking_text` partials per turn — count
/// depends on token batching, network flushing, and LLM-side chunk
/// boundaries, all of which are non-deterministic run-to-run. The
/// *shape* of the event sequence is defined by the ordering of
/// distinct event types, not the count. Two runs where one emits 8
/// `assistant_text` partials and the other 10 are the same shape.
///
/// Collapsing consecutive duplicates preserves genuine ordering
/// drift (`[a, b, c]` vs `[a, x, b, c]` still compares unequal)
/// while erasing the benign count variance. `[a, a, a]` collapses
/// to `[a]`; `[a, b, a]` stays as `[a, b, a]`.
pub fn canonical_sequence(events: &[Value]) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for event in events {
        if let Some(et) = event_type_of(event) {
            if out.last().copied() != Some(et) {
                out.push(et);
            }
        }
    }
    out
}

/// Canonicalize an already-derived type sequence. Collapses consecutive
/// duplicates, same semantics as [`canonical_sequence`] but operating on
/// the string sequence stored in `Schema::probe_sequences`.
pub fn canonical_type_sequence(types: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in types {
        if out.last().map(String::as_str) != Some(t.as_str()) {
            out.push(t.clone());
        }
    }
    out
}

/// Compare the first stability run against the rest. Returns a
/// diagnostic string if any subsequent run's **canonical** event-type
/// sequence (see [`canonical_sequence`]) differs from the first,
/// otherwise `None`.
///
/// Extracted as a pure helper so the shape-comparison logic is
/// unit-testable without driving real claude.
pub fn stability_outcome(first: &CapturedProbe, rest: &[CapturedProbe]) -> Option<String> {
    if rest.is_empty() {
        return None;
    }
    let first_seq = canonical_sequence(&first.events);
    for (idx, run) in rest.iter().enumerate() {
        let seq = canonical_sequence(&run.events);
        if seq != first_seq {
            return Some(format!(
                "canonical event-type sequence differs at stability run {}/{} for {}: \
                 first={:?}, run={:?}",
                idx + 2,
                rest.len() + 1,
                first.name,
                first_seq,
                seq,
            ));
        }
    }
    None
}

/// Stability-check wrapper: runs each probe `n` times and verifies
/// that the normalized event-type sequence is identical across runs.
/// If [`stability_outcome`] reports divergence, the probe's status is
/// replaced with [`ProbeStatus::ShapeUnstable`] carrying the diagnostic
/// and the first run's events remain as the stored capture. Otherwise
/// the first run is pushed unchanged.
pub async fn capture_with_stability(
    n: usize,
    bank_dir: &std::path::Path,
    project_dir: &std::path::Path,
) -> Vec<CapturedProbe> {
    use crate::common::probes::PROBES;

    let mut results: Vec<CapturedProbe> = Vec::with_capacity(PROBES.len());
    for (i, probe) in PROBES.iter().enumerate() {
        let mut runs: Vec<CapturedProbe> = Vec::with_capacity(n);
        for run_idx in 0..n {
            let bank = bank_dir.join(format!("probe-{i}-run-{run_idx}.db"));
            runs.push(execute_probe(probe, bank, project_dir).await);
        }
        let first = runs.remove(0);
        let capture = match stability_outcome(&first, &runs) {
            Some(diagnostic) => CapturedProbe {
                name: first.name.clone(),
                events: first.events,
                status: ProbeStatus::ShapeUnstable(diagnostic),
                runtime_ms: first.runtime_ms,
            },
            None => first,
        };
        results.push(capture);
    }
    results
}
