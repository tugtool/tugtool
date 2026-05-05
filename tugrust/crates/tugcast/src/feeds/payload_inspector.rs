//! payload_inspector — single-pass partial-shape parser for stream-json
//! payloads on the CODE_INPUT and CODE_OUTPUT feeds.
//!
//! The supervisor's dispatch + merger intercepts (mid-turn-replay
//! steps 4.3 / 4.4) need to look at several top-level fields of every
//! frame's JSON payload to decide whether to mint a `tug_turn_id`,
//! mark a row complete, etc. The naive approach — call
//! `parse_*_field` four times — pays the JSON deserialize cost four
//! times per frame. This module exposes a single
//! [`InspectedPayload`] struct whose fields cover everything the
//! intercepts read; one `serde_json::from_slice` reads them all.
//!
//! All fields are optional. A payload with no `type` (malformed,
//! truncated, or just a different shape than we expected) yields a
//! struct whose `msg_type` is `None`; the dispatcher treats that as
//! "pass through unchanged" and the merger treats it as "skip the
//! ledger update". Optional everywhere is the wire-shape
//! backward-compatibility contract — older tugcode binaries omit the
//! new fields, and synthetic-input tests build minimal envelopes.

// The inspector surface is authored ahead of the supervisor wiring
// that consumes it; suppress dead-code warnings for the public API
// until the dispatch + merger intercepts land. Same pattern
// `session_ledger.rs` and the rest of the crate use for phased rollouts.
#![allow(dead_code)]

use serde::Deserialize;

/// Partial-shape view into a CODE_INPUT or CODE_OUTPUT frame's JSON
/// payload. Fields are populated only if the payload carries them; a
/// missing or non-string value yields `None`. Constructed via
/// [`InspectedPayload::from_slice`]; the deserializer ignores any
/// other top-level fields the payload may carry, so adding a new
/// field to the wire format never breaks this struct's parse.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct InspectedPayload {
    /// Top-level `type` discriminator (e.g. `"user_message"`,
    /// `"turn_complete"`, `"turn_cancelled"`). `None` on a payload
    /// missing the field or a non-string value.
    #[serde(rename = "type", default)]
    pub msg_type: Option<String>,

    /// Tugcode's per-turn message id stamped on assistant outputs
    /// (`turn_complete.msg_id`, `turn_cancelled.msg_id`,
    /// `assistant_text.msg_id`). On the inbound side, tugcast mints
    /// `tug_turn_id` and the dispatcher splices it into the envelope;
    /// tugcode then echoes that same id back as `msg_id` on outbound
    /// assistant frames.
    #[serde(default)]
    pub msg_id: Option<String>,

    /// Tugcast-minted UUIDv4 stamped onto inbound `user_message`
    /// envelopes. Read by tugcode in step 4.5 as
    /// `ActiveTurn.msgId`. The merger (4.4) does not read this — it
    /// reads `msg_id` instead.
    #[serde(default)]
    pub tug_turn_id: Option<String>,

    /// Claude's own message id (the `id` field on the assistant
    /// `message` block in the JSONL). Tugcode populates this on
    /// `turn_complete` / `turn_cancelled` so the merger (4.4) can
    /// record it on the ledger row as a back-reference into claude's
    /// JSONL.
    #[serde(default)]
    pub claude_message_id: Option<String>,

    /// `text` field on inbound `user_message`. The dispatcher (4.3)
    /// persists this onto the pending turns row.
    #[serde(default)]
    pub text: Option<String>,

    /// `attachments` array on inbound `user_message`. The dispatcher
    /// persists these onto the pending turns row as a JSON BLOB.
    /// Stored as `Vec<serde_json::Value>` so the inspector doesn't
    /// need to know the inner attachment shape.
    #[serde(default)]
    pub attachments: Option<Vec<serde_json::Value>>,

    /// `partial_result` on `turn_cancelled`. The merger (4.4)
    /// persists this onto the ledger row's `partial_text` so
    /// `runReplay` can surface the partial assistant content on the
    /// next reload.
    #[serde(default)]
    pub partial_result: Option<String>,
}

impl InspectedPayload {
    /// Parse `payload` into an [`InspectedPayload`]. Returns `None`
    /// for malformed JSON; the supervisor treats that as "pass
    /// through unchanged" so a corrupted byte stream doesn't
    /// short-circuit the dispatch routing logic.
    pub fn from_slice(payload: &[u8]) -> Option<Self> {
        serde_json::from_slice(payload).ok()
    }

    /// Convenience: borrow the type discriminator as a `&str` so
    /// callers can pattern-match without a clone.
    pub fn msg_type(&self) -> Option<&str> {
        self.msg_type.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── round-trip across the three intercept-relevant message types ─────────

    #[test]
    fn inspects_user_message_with_all_fields() {
        let payload = br#"{
            "tug_session_id": "sess-abc",
            "type": "user_message",
            "text": "hello",
            "attachments": [{"path": "/tmp/foo.txt"}],
            "tug_turn_id": "11111111-2222-3333-4444-555555555555"
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("user_message"));
        assert_eq!(i.text.as_deref(), Some("hello"));
        assert_eq!(
            i.tug_turn_id.as_deref(),
            Some("11111111-2222-3333-4444-555555555555"),
        );
        assert_eq!(i.attachments.as_deref().map(|a| a.len()), Some(1));
        // Outbound-only fields stay None on inbound payloads.
        assert_eq!(i.msg_id, None);
        assert_eq!(i.claude_message_id, None);
        assert_eq!(i.partial_result, None);
    }

    #[test]
    fn inspects_turn_complete_with_claude_message_id() {
        let payload = br#"{
            "type": "turn_complete",
            "msg_id": "tug-abc",
            "seq": 3,
            "result": "",
            "ipc_version": 2,
            "claude_message_id": "msg_01ABC"
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("turn_complete"));
        assert_eq!(i.msg_id.as_deref(), Some("tug-abc"));
        assert_eq!(i.claude_message_id.as_deref(), Some("msg_01ABC"));
        // Inbound-only fields stay None on outbound payloads.
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
        assert_eq!(i.partial_result, None);
    }

    #[test]
    fn inspects_turn_cancelled_with_partial_result() {
        let payload = br#"{
            "type": "turn_cancelled",
            "msg_id": "tug-xyz",
            "seq": 4,
            "partial_result": "so far the assistant said...",
            "ipc_version": 2,
            "claude_message_id": "msg_01XYZ"
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("turn_cancelled"));
        assert_eq!(i.msg_id.as_deref(), Some("tug-xyz"));
        assert_eq!(
            i.partial_result.as_deref(),
            Some("so far the assistant said..."),
        );
        assert_eq!(i.claude_message_id.as_deref(), Some("msg_01XYZ"));
    }

    // ── backward-compat: optional fields default to None ─────────────────────

    #[test]
    fn back_compat_user_message_without_tug_turn_id() {
        // Pre-step-4.3 tugdeck → tugcast envelope: no tug_turn_id yet.
        let payload =
            br#"{"tug_session_id":"s","type":"user_message","text":"hi","attachments":[]}"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("user_message"));
        assert_eq!(i.text.as_deref(), Some("hi"));
        assert_eq!(i.tug_turn_id, None);
        assert_eq!(i.attachments.as_deref().map(<[_]>::len), Some(0));
    }

    #[test]
    fn back_compat_turn_complete_without_claude_message_id() {
        let payload =
            br#"{"type":"turn_complete","msg_id":"m","seq":1,"result":"","ipc_version":2}"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("turn_complete"));
        assert_eq!(i.msg_id.as_deref(), Some("m"));
        assert_eq!(i.claude_message_id, None);
    }

    // ── unknown-type pass-through ────────────────────────────────────────────

    #[test]
    fn inspects_unknown_type_fields_are_none() {
        let payload = br#"{"type":"tool_approval","request_id":"r","decision":"allow"}"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("tool_approval"));
        // None of the user_message / turn_complete fields apply.
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
        assert_eq!(i.tug_turn_id, None);
        assert_eq!(i.msg_id, None);
        assert_eq!(i.claude_message_id, None);
    }

    #[test]
    fn inspects_extra_unknown_fields_are_ignored() {
        // A future wire-shape addition (e.g. a new top-level field
        // tugcast doesn't yet know about) must not break the parse.
        let payload =
            br#"{"type":"user_message","text":"hi","attachments":[],"future_field":{"nested":42}}"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("user_message"));
        assert_eq!(i.text.as_deref(), Some("hi"));
    }

    // ── error paths return None, never panic ─────────────────────────────────

    #[test]
    fn malformed_json_returns_none() {
        assert_eq!(InspectedPayload::from_slice(b"not json"), None);
        assert_eq!(InspectedPayload::from_slice(b"{not even close"), None);
        assert_eq!(InspectedPayload::from_slice(b""), None);
    }

    #[test]
    fn non_string_type_field_yields_none_msg_type() {
        // serde rejects a non-string for `Option<String>`, so the
        // overall parse fails. The dispatcher treats `None` as
        // "pass through unchanged", which is what we want here.
        assert_eq!(InspectedPayload::from_slice(br#"{"type":42}"#), None);
    }

    #[test]
    fn payload_with_only_type_parses_with_other_fields_none() {
        let i = InspectedPayload::from_slice(br#"{"type":"user_message"}"#).expect("parses");
        assert_eq!(i.msg_type(), Some("user_message"));
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
        assert_eq!(i.tug_turn_id, None);
    }

    // ── attachments shape is preserved as raw Value ─────────────────────────

    #[test]
    fn attachments_preserve_inner_shape_as_value() {
        let payload = br#"{
            "type": "user_message",
            "text": "with files",
            "attachments": [
                {"filename": "a.txt", "content": "hello", "media_type": "text/plain"},
                {"filename": "b.png", "content": "<base64>", "media_type": "image/png"}
            ]
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        let atts = i.attachments.expect("attachments present");
        assert_eq!(atts.len(), 2);
        assert_eq!(atts[0]["filename"], "a.txt");
        assert_eq!(atts[1]["media_type"], "image/png");
    }
}
