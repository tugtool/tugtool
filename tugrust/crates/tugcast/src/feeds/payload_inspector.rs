//! payload_inspector — single-pass partial-shape parser for stream-json
//! payloads on the CODE_INPUT and CODE_OUTPUT feeds.
//!
//! The supervisor's dispatcher (`dispatch_one`) reads `text` and
//! `attachments` off every inbound `user_message` to seed the
//! submission journal row, and the merger (`apply_outbound_turn_intercept`)
//! reads only `msg_type` to decide whether a frame is a
//! `turn_complete` / `turn_cancelled` that should pop the journal's
//! oldest pending row. One `serde_json::from_slice` reads everything
//! both sites need.
//!
//! All fields are optional. A payload with no `type` (malformed,
//! truncated, or just a different shape than we expected) yields a
//! struct whose `msg_type` is `None`; the dispatcher treats that as
//! "pass through unchanged" and the merger treats it as "no-op".

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

    /// `text` field on inbound `user_message`. The dispatcher persists
    /// this on the journal row.
    #[serde(default)]
    pub text: Option<String>,

    /// `attachments` array on inbound `user_message`. The dispatcher
    /// persists these onto the journal row as a JSON BLOB. Stored as
    /// `Vec<serde_json::Value>` so the inspector doesn't need to know
    /// the inner attachment shape.
    #[serde(default)]
    pub attachments: Option<Vec<serde_json::Value>>,
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
    fn inspects_user_message_with_text_and_attachments() {
        let payload = br#"{
            "tug_session_id": "sess-abc",
            "type": "user_message",
            "text": "hello",
            "attachments": [{"path": "/tmp/foo.txt"}]
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("user_message"));
        assert_eq!(i.text.as_deref(), Some("hello"));
        assert_eq!(i.attachments.as_deref().map(|a| a.len()), Some(1));
    }

    #[test]
    fn inspects_turn_complete_msg_type_only() {
        // The merger only branches on `msg_type` post-Step-5.3; the
        // outbound payload's other fields are unread.
        let payload = br#"{
            "type": "turn_complete",
            "msg_id": "msg_01ABC",
            "seq": 3,
            "result": "",
            "ipc_version": 2
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("turn_complete"));
        // Inbound-only fields stay None on outbound payloads.
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
    }

    #[test]
    fn inspects_turn_cancelled_msg_type_only() {
        let payload = br#"{
            "type": "turn_cancelled",
            "msg_id": "msg_01XYZ",
            "seq": 4,
            "partial_result": "so far the assistant said...",
            "ipc_version": 2
        }"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("turn_cancelled"));
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
    }

    // ── unknown-type pass-through ────────────────────────────────────────────

    #[test]
    fn inspects_unknown_type_fields_are_none() {
        let payload = br#"{"type":"tool_approval","request_id":"r","decision":"allow"}"#;
        let i = InspectedPayload::from_slice(payload).expect("parses");
        assert_eq!(i.msg_type(), Some("tool_approval"));
        // None of the user_message fields apply.
        assert_eq!(i.text, None);
        assert_eq!(i.attachments, None);
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
