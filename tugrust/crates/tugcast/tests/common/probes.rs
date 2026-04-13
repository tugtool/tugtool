//! Shared probe table for the golden stream-json catalog.
//!
//! See `roadmap/tugplan-golden-stream-json-catalog.md` §[#deep-probe-table]
//! for the structure and §[#ground-truth-policy] for the REQUIRED vs
//! OPTIONAL classification policy.
//!
//! **Classification is tentative.** The `required_events` and
//! `optional_events` arrays seed from the prose in
//! `roadmap/transport-exploration.md` (captured against `claude 2.1.87`).
//! Step 4 of the tugplan reconciles each probe against a live
//! `claude 2.1.104` capture — prose-derived events that `2.1.104` does
//! not emit get removed; `2.1.104` events the prose omits get added.
//! Do not treat anything in this file as the ground truth on its own.
//!
//! The capture binary in `tests/capture_stream_json_catalog.rs` iterates
//! `PROBES`, runs each one against a fresh `TestTugcast`, normalizes the
//! resulting event stream, and writes it to
//! `tests/fixtures/stream-json-catalog/v<version>/<probe.name>.jsonl`.
//! The drift test in `tests/stream_json_catalog_drift.rs` replays the
//! same probe table against live claude and shape-diffs the stream
//! against the committed golden.

#![allow(dead_code)]

/// A single probe in the catalog. Probes are static for per-probe
/// isolation under [D01] — running probe N with state from probe N-1
/// would contaminate the stream shape and defeat the golden catalog's
/// purpose.
#[derive(Debug)]
pub struct ProbeRecord {
    /// Filesystem-safe identifier, e.g. `"test-05-tool-use-read"`.
    /// Used as both the fixture filename stem and the manifest entry key.
    pub name: &'static str,
    /// Ordered sequence of inbound messages the capture binary sends
    /// to drive this probe. Each element maps 1:1 to a `TestWs::send_*`
    /// helper.
    pub input_script: &'static [ProbeMsg],
    /// Event types the probe is expected to emit in the CODE_OUTPUT
    /// feed. A missing required event causes the drift test to fail.
    /// Tentative — reclassified during Step 4.
    pub required_events: &'static [&'static str],
    /// Event types that sometimes appear and sometimes don't across
    /// stability runs. Tentative — reclassified during Step 4.
    pub optional_events: &'static [&'static str],
    /// Runtime prerequisites that must be satisfied before the probe
    /// is meaningful. If any prerequisite is not met, the probe is
    /// marked `Skipped` in the manifest with an explicit reason rather
    /// than running and producing misleading fixtures.
    pub prerequisites: &'static [ProbePrereq],
    /// Per-probe hard timeout. Defaults to 30 s for simple turns,
    /// 60 s for longer streaming, 90 s for subagent / `/tugplug:plan`
    /// multi-agent flows.
    pub timeout_secs: u64,
    /// If `Some`, the probe is unconditionally skipped at capture
    /// time with this reason. Used for probes blocked on a known
    /// upstream bug that has a `tide.md §T0.5` follow-up pointer —
    /// the reason string should name the specific follow-up so the
    /// manifest.json tells a future reader where to look.
    ///
    /// `None` means run the probe normally.
    pub skip_reason: Option<&'static str>,
}

/// One inbound message the capture binary sends to drive a probe.
/// Each variant corresponds to a `TestWs::send_*` helper added in
/// tugplan Step 2.
#[derive(Debug)]
pub enum ProbeMsg {
    /// Plain `user_message` with text and no attachments.
    UserMessage { text: &'static str },
    /// `user_message` with one or more attachments.
    UserMessageWithAttachments {
        text: &'static str,
        attachments: &'static [Attachment],
    },
    /// `interrupt` — stop the current turn.
    Interrupt,
    /// `tool_approval` — answer a `control_request_forward` permission
    /// gate. `request_id` is captured at runtime from the in-flight
    /// `control_request_forward` event, so the capture binary looks up
    /// the `request_id` rather than using a static value. `decision` is
    /// `"allow"` or `"deny"`.
    ToolApproval {
        decision: &'static str,
        message: Option<&'static str>,
    },
    /// `question_answer` — answer a `control_request_forward` with
    /// `is_question: true`. Like `ToolApproval`, `request_id` is
    /// captured at runtime. `answers` is a slice of `(key, value)`
    /// tuples; the capture binary converts it to a JSON object.
    QuestionAnswer {
        answers: &'static [(&'static str, &'static str)],
    },
    /// `session_command` — `"new"`, `"continue"`, or `"fork"`.
    SessionCommand { command: &'static str },
    /// `model_change` — switch models without restarting the session.
    ModelChange { model: &'static str },
    /// `permission_mode` — `"default"`, `"acceptEdits"`, `"plan"`, etc.
    PermissionMode { mode: &'static str },
    /// Wait for a specific event type before sending the next message.
    /// Used by probes that need to see a `control_request_forward`
    /// before responding with a `tool_approval`/`question_answer`, or
    /// by interrupt probes that want to wait for streaming to begin
    /// before firing.
    WaitForEvent {
        event_type: &'static str,
        max_secs: u64,
    },
    /// Sleep for a fixed duration. Used by interrupt probes to wait a
    /// short time after driving a long prompt so streaming has started
    /// before the interrupt fires.
    Sleep { millis: u64 },
}

/// Inline attachment for `UserMessageWithAttachments` probes.
#[derive(Debug)]
pub struct Attachment {
    pub filename: &'static str,
    /// Base64-encoded content.
    pub content: &'static str,
    pub media_type: &'static str,
}

/// Runtime prerequisite for a probe. The capture binary checks each
/// prerequisite before running the probe; if any fails the probe is
/// skipped with an explicit reason rather than run-and-fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbePrereq {
    /// The tugplug plugin must be loaded in the tugcode subprocess.
    /// Used by probes 25, 26, 28, 34, 35 which enumerate or invoke
    /// tugplug skills/agents. When tugcast does not pass
    /// `--plugin-dir tugplug/` to tugcode, these probes are skipped.
    TugplugPluginLoaded,
    /// The probe requires a tool call that can be denied at the
    /// permission gate. Used by probe 11 (deny round-trip). Assumed
    /// available in the default `acceptEdits` mode for filesystem
    /// reads outside the project root.
    DenialCapableTool,
}

/// Outcome of running a single probe.
#[derive(Debug, Clone)]
pub enum ProbeStatus {
    /// All required events observed, stability runs agreed on the
    /// shape, fixture written.
    Passed,
    /// One or more prerequisites not met at runtime. Carries the
    /// reason (e.g., `"tugplug plugin not loaded"`).
    Skipped(&'static str),
    /// Probe executed but a required event was missing, or the
    /// transport emitted an unexpected error event. Carries a
    /// human-readable diagnostic.
    Failed(String),
    /// Stability runs disagreed on the event shape across runs.
    /// Carries a diagnostic pointing at the flapping event type.
    ShapeUnstable(String),
}

// -----------------------------------------------------------------------
// Probe table — 35 entries
// -----------------------------------------------------------------------

/// The full probe table. Order matches `roadmap/transport-exploration.md`
/// Tests 1-35.
///
/// **Tentative classification.** Step 4 reconciles this against live
/// `claude 2.1.104`. Until then, do not treat `required_events` as
/// ground truth — the capture binary collects whatever claude actually
/// emits and the Step 4 review is what decides which events are
/// required vs optional.
pub static PROBES: &[ProbeRecord] = &[
    // --- Test 1: Basic round-trip ---
    ProbeRecord {
        name: "test-01-basic-round-trip",
        input_script: &[ProbeMsg::UserMessage {
            text: "Say hello in exactly 5 words.",
        }],
        required_events: &[
            "session_init",
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 2: Longer response / streaming behavior ---
    ProbeRecord {
        name: "test-02-longer-response-streaming",
        input_script: &[ProbeMsg::UserMessage {
            text: "Write a short paragraph (about 100 words) explaining why the sky is blue.",
        }],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 3: Slash command /cost ---
    ProbeRecord {
        name: "test-03-slash-cost",
        input_script: &[ProbeMsg::UserMessage { text: "/cost" }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 4: Slash command /status ---
    ProbeRecord {
        name: "test-04-slash-status",
        input_script: &[ProbeMsg::UserMessage { text: "/status" }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 5: Tool use (Read file) ---
    ProbeRecord {
        name: "test-05-tool-use-read",
        input_script: &[ProbeMsg::UserMessage {
            text: "Read the first 3 lines of CLAUDE.md and tell me what they say.",
        }],
        required_events: &[
            "system_metadata",
            "tool_use",
            "tool_result",
            "tool_use_structured",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 6: Interrupt mid-stream ---
    ProbeRecord {
        name: "test-06-interrupt-mid-stream",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Write a 500-word essay about the history of the printing press.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "assistant_text",
                max_secs: 15,
            },
            ProbeMsg::Sleep { millis: 500 },
            ProbeMsg::Interrupt,
        ],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 7: Multiple tool calls in one turn ---
    ProbeRecord {
        name: "test-07-multiple-tool-calls",
        input_script: &[ProbeMsg::UserMessage {
            text: "Read the first line of CLAUDE.md and the first line of tugrust/Cargo.toml. Tell me both.",
        }],
        required_events: &[
            "system_metadata",
            "tool_use",
            "tool_result",
            "tool_use_structured",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 8: Tool error (nonexistent file) ---
    // NOTE: The canary found that `control_request_forward` is in
    // practice only emitted when the WaitForEvent path peeks rather
    // than consumes the frame. It's required — the capture binary's
    // Step 4 canary proved that when `peek_code_output_event` is used
    // instead of `await_code_output_event`, the forward makes it
    // into the fixture. Kept required here.
    ProbeRecord {
        name: "test-08-tool-error-nonexistent",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Read the file /nonexistent/path/that/does/not/exist.txt",
            },
            ProbeMsg::WaitForEvent {
                event_type: "control_request_forward",
                max_secs: 20,
            },
            ProbeMsg::ToolApproval {
                decision: "deny",
                message: Some("Denied by capture probe"),
            },
        ],
        required_events: &[
            "system_metadata",
            "tool_use",
            "control_request_forward",
            "tool_result",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["tool_use_structured", "thinking_text"],
        prerequisites: &[ProbePrereq::DenialCapableTool],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 9: Bash tool (auto-approved) ---
    ProbeRecord {
        name: "test-09-bash-auto-approved",
        input_script: &[ProbeMsg::UserMessage {
            text: "Run this bash command: echo 'hello from bash'",
        }],
        required_events: &[
            "system_metadata",
            "tool_use",
            "tool_result",
            "tool_use_structured",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 10: Long streaming (300 words) ---
    // Blocked on tide.md §T0.5 P19 — every probe whose collect phase
    // runs longer than ~45 s hits `Connection reset without closing
    // handshake`, regardless of the probe's own timeout. The canary
    // confirmed test-10/13/17/20/25/35 all fail at ~45 000 ms. Likely
    // a tugcast-side idle/activity ceiling; the investigation is
    // out of Layer A scope.
    ProbeRecord {
        name: "test-10-long-streaming-300-words",
        input_script: &[ProbeMsg::UserMessage {
            text: "Write exactly 300 words about the history of the internet. Count carefully.",
        }],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 90,
        skip_reason: Some(
            "blocked on tide.md §T0.5 P19 — 45s WebSocket reset on long-running probes",
        ),
    },
    // --- Test 11: Permission approval round-trip (deny) ---
    ProbeRecord {
        name: "test-11-permission-deny-roundtrip",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Read the file /nonexistent/file.txt",
            },
            ProbeMsg::WaitForEvent {
                event_type: "control_request_forward",
                max_secs: 20,
            },
            ProbeMsg::ToolApproval {
                decision: "deny",
                message: Some("Denied by probe script"),
            },
        ],
        required_events: &[
            "system_metadata",
            "tool_use",
            "control_request_forward",
            "tool_result",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["tool_use_structured", "thinking_text"],
        prerequisites: &[ProbePrereq::DenialCapableTool],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 12: /compact and /model ---
    ProbeRecord {
        name: "test-12-slash-compact-model",
        input_script: &[
            ProbeMsg::UserMessage { text: "/compact" },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 30,
            },
            ProbeMsg::UserMessage { text: "/model" },
        ],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 13: session_command new ---
    // Blocked on tide.md §T0.5 P16 (session_command routing bug).
    // The Step 4 canary confirmed test-13/17/20 all hit the same
    // 45s connection reset as test-10/25/35 — sibling symptom of
    // P19. Skipped until the supervisor is fixed.
    ProbeRecord {
        name: "test-13-session-command-new",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Say 'first session'.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 15,
            },
            ProbeMsg::SessionCommand { command: "new" },
        ],
        required_events: &["session_init"],
        optional_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
            "error",
        ],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: Some("blocked on tide.md §T0.5 P16 — session_command routing bug"),
    },
    // --- Test 14: Message during active turn ---
    ProbeRecord {
        name: "test-14-message-during-turn",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Write 200 words about the ocean.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "assistant_text",
                max_secs: 15,
            },
            ProbeMsg::Sleep { millis: 500 },
            ProbeMsg::UserMessage {
                text: "Stop. Just say 'INTERRUPTED'.",
            },
        ],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 90,
        skip_reason: None,
    },
    // --- Test 15: /btw side question ---
    ProbeRecord {
        name: "test-15-slash-btw",
        input_script: &[ProbeMsg::UserMessage {
            text: "/btw What is 2+2?",
        }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 16: model_change round-trip ---
    ProbeRecord {
        name: "test-16-model-change-roundtrip",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "What Anthropic model are you? Answer in one short sentence.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 20,
            },
            ProbeMsg::ModelChange {
                model: "claude-sonnet-4-6",
            },
            ProbeMsg::UserMessage {
                text: "What Anthropic model are you now? Answer in one short sentence.",
            },
        ],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 90,
        skip_reason: None,
    },
    // --- Test 17: session_command continue ---
    // Blocked on tide.md §T0.5 P16 — multi-session router hangs on
    // continue's post-command probe turn. Canary also confirms
    // the 45s reset (P19 sibling). Skipped.
    ProbeRecord {
        name: "test-17-session-command-continue",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Remember the marker PROBE_MARKER_17.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 15,
            },
            ProbeMsg::SessionCommand {
                command: "continue",
            },
            ProbeMsg::UserMessage {
                text: "What was the marker?",
            },
        ],
        required_events: &["session_init", "assistant_text", "turn_complete"],
        optional_events: &["system_metadata", "cost_update", "thinking_text"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: Some("blocked on tide.md §T0.5 P16 — session_command routing bug"),
    },
    // --- Test 18: Message during turn (detailed variant of 14) ---
    // Test 14 and Test 18 probe the same behavior in transport-exploration.md;
    // we keep them as separate fixtures so a future prose revision can
    // split them without disturbing the catalog index.
    ProbeRecord {
        name: "test-18-message-during-turn-detailed",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Count from one to ten slowly, one number per line.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "assistant_text",
                max_secs: 15,
            },
            ProbeMsg::Sleep { millis: 300 },
            ProbeMsg::UserMessage {
                text: "Actually, say 'DONE' instead.",
            },
        ],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 90,
        skip_reason: None,
    },
    // --- Test 19: /compact (rich cost_update) ---
    ProbeRecord {
        name: "test-19-slash-compact",
        input_script: &[
            ProbeMsg::UserMessage { text: "Say 'one'." },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 20,
            },
            ProbeMsg::UserMessage { text: "/compact" },
        ],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text", "thinking_text", "compact_boundary"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 20: session_command fork ---
    // Blocked on tide.md §T0.5 P16 — same supervisor-routing class
    // as tests 13/17. Canary confirms 45s connection reset.
    ProbeRecord {
        name: "test-20-session-command-fork",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "Say 'pre-fork'.",
            },
            ProbeMsg::WaitForEvent {
                event_type: "turn_complete",
                max_secs: 15,
            },
            ProbeMsg::SessionCommand { command: "fork" },
        ],
        required_events: &["session_init"],
        optional_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
            "error",
        ],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: Some("blocked on tide.md §T0.5 P16 — session_command routing bug"),
    },
    // --- Test 21: Glob tool (auto-approved) ---
    ProbeRecord {
        name: "test-21-glob-tool",
        input_script: &[ProbeMsg::UserMessage {
            text: "Use the Glob tool to find all .md files in the roadmap/ directory.",
        }],
        required_events: &[
            "system_metadata",
            "tool_use",
            "tool_result",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["tool_use_structured", "thinking_text"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 22: Subagent spawn (Agent tool) ---
    ProbeRecord {
        name: "test-22-subagent-spawn",
        input_script: &[ProbeMsg::UserMessage {
            text: "Use an Explore agent to find where the string 'FeedId::CODE_INPUT' appears in the tugrust workspace. Report just the file paths.",
        }],
        required_events: &[
            "system_metadata",
            "tool_use",
            "tool_result",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["tool_use_structured", "thinking_text"],
        prerequisites: &[],
        timeout_secs: 120,
        skip_reason: None,
    },
    // --- Test 23: Image attachment ---
    // 1x1 transparent PNG, base64-encoded. Pure static data.
    ProbeRecord {
        name: "test-23-image-attachment",
        input_script: &[ProbeMsg::UserMessageWithAttachments {
            text: "I'm attaching a tiny image. What can you see? One short sentence.",
            attachments: &[Attachment {
                filename: "test-pixel.png",
                // 1x1 transparent PNG.
                content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
                media_type: "image/png",
            }],
        }],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 24: @ file references ---
    ProbeRecord {
        name: "test-24-at-file-references",
        input_script: &[ProbeMsg::UserMessage {
            text: "What's in @CLAUDE.md? Answer in one short sentence.",
        }],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text", "tool_use", "tool_result", "tool_use_structured"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 25: Tugplug skill invocation (/plan) ---
    // Blocked on tide.md §T0.5 P19 — canary confirmed 45s reset
    // during the long-running orchestrator flow. (Plugin IS loaded
    // at capture time since project_dir is the tugtool repo root.)
    ProbeRecord {
        name: "test-25-tugplug-plan-invocation",
        input_script: &[ProbeMsg::UserMessage {
            text: "/tugplug:plan Add a --no-auth flag to tugcast for development testing",
        }],
        required_events: &["system_metadata", "turn_complete"],
        optional_events: &[
            "assistant_text",
            "tool_use",
            "tool_result",
            "cost_update",
            "thinking_text",
        ],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 120,
        skip_reason: Some(
            "blocked on tide.md §T0.5 P19 — 45s WebSocket reset on long-running probes",
        ),
    },
    // --- Test 26: /dash and /tugplug:dash ---
    ProbeRecord {
        name: "test-26-slash-dash",
        input_script: &[ProbeMsg::UserMessage {
            text: "/tugplug:dash status",
        }],
        required_events: &["system_metadata", "turn_complete"],
        optional_events: &[
            "assistant_text",
            "tool_use",
            "tool_result",
            "cost_update",
            "thinking_text",
        ],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 60,
        skip_reason: None,
    },
    // --- Test 27: @ file references (24a/24b variant) ---
    ProbeRecord {
        name: "test-27-at-file-references-variant",
        input_script: &[ProbeMsg::UserMessage {
            text: "What's in @tugrust/Cargo.toml? Answer in one short sentence.",
        }],
        required_events: &[
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text", "tool_use", "tool_result", "tool_use_structured"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 28: system_metadata deep dive (plugin skill visibility) ---
    // The capture binary records the first `system_metadata` event of
    // any probe as the source-of-truth dump. This probe is a dedicated
    // hello-world whose only purpose is to harvest `system_metadata`
    // fields for the schema.
    ProbeRecord {
        name: "test-28-system-metadata-deep-dive",
        input_script: &[ProbeMsg::UserMessage { text: "Say 'ok'." }],
        required_events: &[
            "session_init",
            "system_metadata",
            "assistant_text",
            "cost_update",
            "turn_complete",
        ],
        optional_events: &["thinking_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 29: /tugplug:ping with correct --plugin-dir ---
    ProbeRecord {
        name: "test-29-tugplug-ping",
        input_script: &[ProbeMsg::UserMessage {
            text: "/tugplug:ping",
        }],
        required_events: &["system_metadata", "turn_complete"],
        optional_events: &["assistant_text", "cost_update", "thinking_text"],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 30: /tugplug:dash status (full orchestrator run) ---
    ProbeRecord {
        name: "test-30-tugplug-dash-status",
        input_script: &[ProbeMsg::UserMessage {
            text: "/tugplug:dash status",
        }],
        required_events: &["system_metadata", "turn_complete"],
        optional_events: &[
            "assistant_text",
            "tool_use",
            "tool_result",
            "tool_use_structured",
            "cost_update",
            "thinking_text",
        ],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 90,
        skip_reason: None,
    },
    // --- Test 31: /cost classification ---
    ProbeRecord {
        name: "test-31-slash-cost-classification",
        input_script: &[ProbeMsg::UserMessage { text: "/cost" }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 32: /compact classification ---
    ProbeRecord {
        name: "test-32-slash-compact-classification",
        input_script: &[ProbeMsg::UserMessage { text: "/compact" }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 45,
        skip_reason: None,
    },
    // --- Test 33: /model classification ---
    ProbeRecord {
        name: "test-33-slash-model-classification",
        input_script: &[ProbeMsg::UserMessage { text: "/model" }],
        required_events: &["system_metadata", "cost_update", "turn_complete"],
        optional_events: &["assistant_text"],
        prerequisites: &[],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 34: Plugin agent enumeration ---
    // Requires tugplug plugin loaded to show the 12 tugplug agents in
    // `system_metadata.agents`. Default spawn has only 5 built-in
    // agents.
    ProbeRecord {
        name: "test-34-plugin-agent-enumeration",
        input_script: &[ProbeMsg::UserMessage { text: "Say 'ok'." }],
        required_events: &[
            "session_init",
            "system_metadata",
            "assistant_text",
            "turn_complete",
        ],
        optional_events: &["cost_update", "thinking_text"],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 30,
        skip_reason: None,
    },
    // --- Test 35: Live /tugplug:plan with AskUserQuestion flow ---
    ProbeRecord {
        name: "test-35-askuserquestion-flow",
        input_script: &[
            ProbeMsg::UserMessage {
                text: "/tugplug:plan Add a --no-auth flag to tugcast for development testing",
            },
            ProbeMsg::WaitForEvent {
                event_type: "control_request_forward",
                max_secs: 90,
            },
            ProbeMsg::QuestionAnswer {
                answers: &[("q1", "first option")],
            },
        ],
        required_events: &[
            "system_metadata",
            "tool_use",
            "control_request_forward",
            "turn_complete",
        ],
        optional_events: &[
            "assistant_text",
            "tool_result",
            "tool_use_structured",
            "cost_update",
            "thinking_text",
        ],
        prerequisites: &[ProbePrereq::TugplugPluginLoaded],
        timeout_secs: 180,
        skip_reason: Some(
            "blocked on tide.md §T0.5 P19 — 45s WebSocket reset on long-running probes; \
             AskUserQuestion flow never delivers control_request_forward",
        ),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_table_has_35_entries() {
        assert_eq!(PROBES.len(), 35, "probe table must contain all 35 probes");
    }

    #[test]
    fn probe_names_are_unique() {
        let mut names: Vec<&str> = PROBES.iter().map(|p| p.name).collect();
        names.sort();
        let original_len = names.len();
        names.dedup();
        assert_eq!(
            names.len(),
            original_len,
            "probe names must be unique — duplicates break fixture filenames"
        );
    }

    #[test]
    fn probe_names_are_filesystem_safe() {
        for probe in PROBES {
            for ch in probe.name.chars() {
                assert!(
                    ch.is_ascii_alphanumeric() || ch == '-' || ch == '_',
                    "probe name {:?} contains non-filesystem-safe character {:?}",
                    probe.name,
                    ch
                );
            }
        }
    }

    #[test]
    fn every_probe_has_an_input_script() {
        for probe in PROBES {
            assert!(
                !probe.input_script.is_empty(),
                "probe {:?} has an empty input_script",
                probe.name
            );
        }
    }

    #[test]
    fn every_probe_has_at_least_one_required_event() {
        for probe in PROBES {
            assert!(
                !probe.required_events.is_empty(),
                "probe {:?} has no required_events — at minimum the probe \
                 should expect session_init or turn_complete",
                probe.name
            );
        }
    }

    #[test]
    fn timeouts_are_sensible() {
        for probe in PROBES {
            assert!(
                probe.timeout_secs >= 10,
                "probe {:?} timeout {} s is too short",
                probe.name,
                probe.timeout_secs
            );
            assert!(
                probe.timeout_secs <= 300,
                "probe {:?} timeout {} s is too long — real-claude cap is 5 min",
                probe.name,
                probe.timeout_secs
            );
        }
    }
}
