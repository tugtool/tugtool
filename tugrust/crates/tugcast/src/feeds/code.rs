//! Code feed module
//!
//! Handles code messages between tugcast and tugcode via JSON-lines IPC.

use tugcast_core::protocol::{FeedId, Frame};

/// Code broadcast channel capacity
/// (smaller than terminal's 4096; code JSON messages are larger but less frequent)
pub const CODE_BROADCAST_CAPACITY: usize = 1024;

/// Create a code output frame from JSON-lines data
#[allow(dead_code)]
pub fn code_output_frame(json_line: &[u8]) -> Frame {
    Frame::new(FeedId::CODE_OUTPUT, json_line.to_vec())
}

/// Extract JSON string from a CodeInput frame payload
pub fn parse_code_input(frame: &Frame) -> Option<String> {
    if frame.feed_id != FeedId::CODE_INPUT {
        return None;
    }
    String::from_utf8(frame.payload.clone()).ok()
}

/// Splice `"tug_session_id":"<id>"` as the first field of a stream-json line.
///
/// Locates the first `{` byte (skipping any leading ASCII whitespace — `\t`,
/// `\n`, `\r`, space) and splices the field immediately after it. If no `{` is
/// found at all, returns the original bytes unchanged and logs a
/// `tracing::warn!`. If the byte after `{` is `}` (empty object), writes
/// `{"tug_session_id":"<id>"}` with no trailing comma; otherwise inserts
/// `"tug_session_id":"<id>",` directly after the brace.
///
/// Scanning for the first `{` — rather than stamping at a hardcoded byte
/// offset — guards against a Claude Code stream-json update that prepends
/// whitespace or a BOM silently disabling session stamping.
pub fn splice_tug_session_id(line: &[u8], tug_session_id: &str) -> Vec<u8> {
    let Some(brace_idx) = line.iter().position(|b| *b == b'{') else {
        tracing::warn!(
            line_len = line.len(),
            "splice_tug_session_id: no '{{' found in line, passing through unchanged"
        );
        return line.to_vec();
    };

    let after_brace = brace_idx + 1;
    let is_empty_object = line.get(after_brace) == Some(&b'}');

    let field = if is_empty_object {
        format!("\"tug_session_id\":\"{tug_session_id}\"")
    } else {
        format!("\"tug_session_id\":\"{tug_session_id}\",")
    };

    let mut out = Vec::with_capacity(line.len() + field.len());
    out.extend_from_slice(&line[..after_brace]);
    out.extend_from_slice(field.as_bytes());
    out.extend_from_slice(&line[after_brace..]);
    out
}

/// Splice `"workspace_key":"<key>"` as the first field of a JSON line.
///
/// Semantics mirror `splice_tug_session_id` exactly: scan for the first `{`
/// byte (skipping leading ASCII whitespace), splice immediately after, handle
/// the empty-object case, and pass through unchanged with a `tracing::warn!`
/// if no `{` is found. See `splice_tug_session_id` for the rationale behind
/// the scanning approach.
pub fn splice_workspace_key(line: &[u8], workspace_key: &str) -> Vec<u8> {
    let Some(brace_idx) = line.iter().position(|b| *b == b'{') else {
        tracing::warn!(
            line_len = line.len(),
            "splice_workspace_key: no '{{' found in line, passing through unchanged"
        );
        return line.to_vec();
    };

    let after_brace = brace_idx + 1;
    let is_empty_object = line.get(after_brace) == Some(&b'}');

    let field = if is_empty_object {
        format!("\"workspace_key\":\"{workspace_key}\"")
    } else {
        format!("\"workspace_key\":\"{workspace_key}\",")
    };

    let mut out = Vec::with_capacity(line.len() + field.len());
    out.extend_from_slice(&line[..after_brace]);
    out.extend_from_slice(field.as_bytes());
    out.extend_from_slice(&line[after_brace..]);
    out
}

/// Parse the `tug_session_id` field out of a stream-json payload.
///
/// CODE_INPUT frames are user-typed (at most one per user message), so the
/// keystroke interarrival time dominates parser overhead — a full JSON parse
/// is acceptable here. CODE_OUTPUT uses a byte-window scan in
/// `session_metadata.rs` because that path runs per stream token.
pub fn parse_tug_session_id(payload: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Parse the top-level `type` discriminator out of a stream-json payload.
/// Used by the supervisor's dispatch + merger intercepts (mid-turn-replay
/// steps 4.3 / 4.4) to branch on `user_message`, `turn_complete`,
/// `turn_cancelled`, etc. without re-parsing the full envelope. Returns
/// `None` on malformed JSON or when `type` is absent / non-string.
#[allow(dead_code)]
pub fn parse_message_type(payload: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    value
        .get("type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Parse the `tug_turn_id` field out of an inbound `user_message`
/// payload. Tugcast's dispatch intercept (step 4.3) mints this UUID at
/// user-submission time and splices it onto the envelope before
/// forwarding to tugcode; tugcode reads it as `ActiveTurn.msgId`. The
/// parser returns `None` when the field is absent so older callers
/// (test fixtures, replay harnesses, pre-4.3 supervisors) keep working
/// — that's the optional-on-the-wire backward-compat contract.
#[allow(dead_code)]
pub fn parse_tug_turn_id(payload: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    value
        .get("tug_turn_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Parse the `claude_message_id` field out of an outbound
/// `turn_complete` or `turn_cancelled` payload. The merger intercept
/// (step 4.4) reads this and calls `mark_turn_complete` /
/// `mark_turn_interrupted` on the ledger so the row carries claude's
/// own message id as a back-reference into the JSONL — that's how
/// `runReplay` finds the partial assistant content for a cancelled
/// turn. Returns `None` when the field is absent (older tugcode
/// binaries, synthetic-input paths) so the merger falls back gracefully.
#[allow(dead_code)]
pub fn parse_claude_message_id(payload: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    value
        .get("claude_message_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_output_frame() {
        let json = b"{\"type\":\"assistant_text\"}";
        let frame = code_output_frame(json);
        assert_eq!(frame.feed_id, FeedId::CODE_OUTPUT);
        assert_eq!(frame.payload, json);
    }

    #[test]
    fn test_parse_code_input() {
        let frame = Frame::new(FeedId::CODE_INPUT, b"{\"type\":\"user_message\"}".to_vec());
        let result = parse_code_input(&frame);
        assert_eq!(result, Some("{\"type\":\"user_message\"}".to_string()));
    }

    #[test]
    fn test_parse_code_input_wrong_feed() {
        let frame = Frame::new(FeedId::TERMINAL_INPUT, b"test".to_vec());
        let result = parse_code_input(&frame);
        assert_eq!(result, None);
    }

    // ---- splice_tug_session_id / parse_tug_session_id ----

    #[test]
    fn test_splice_empty_input_passes_through() {
        let out = splice_tug_session_id(b"", "sess-abc");
        assert_eq!(out, b"");
    }

    #[test]
    fn test_splice_no_open_brace_passes_through() {
        let out = splice_tug_session_id(b"not json at all", "sess-abc");
        assert_eq!(out, b"not json at all");
    }

    #[test]
    fn test_splice_leading_whitespace_finds_brace() {
        // Leading whitespace must not silently disable stamping — the helper
        // must scan for the first `{` rather than rely on byte offset 1.
        let out = splice_tug_session_id(b"  {\"type\":\"user_message\"}", "sess-abc");
        assert_eq!(
            out,
            b"  {\"tug_session_id\":\"sess-abc\",\"type\":\"user_message\"}"
        );
        // Round-trip through serde_json::Value to confirm valid JSON.
        let trimmed = std::str::from_utf8(&out).unwrap().trim_start();
        let parsed: serde_json::Value = serde_json::from_str(trimmed).unwrap();
        assert_eq!(parsed["tug_session_id"], "sess-abc");
        assert_eq!(parsed["type"], "user_message");
    }

    #[test]
    fn test_splice_empty_object() {
        let out = splice_tug_session_id(b"{}", "sess-abc");
        assert_eq!(out, b"{\"tug_session_id\":\"sess-abc\"}");
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["tug_session_id"], "sess-abc");
    }

    #[test]
    fn test_splice_realistic_session_init() {
        let line = br#"{"type":"session_init","model":"claude-opus-4-6"}"#;
        let out = splice_tug_session_id(line, "sess-xyz");
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["tug_session_id"], "sess-xyz");
        assert_eq!(parsed["type"], "session_init");
        assert_eq!(parsed["model"], "claude-opus-4-6");
    }

    // ---- splice_workspace_key ----

    #[test]
    fn test_splice_workspace_key_empty_input() {
        let out = splice_workspace_key(b"", "/tmp/proj");
        assert_eq!(out, b"");
    }

    #[test]
    fn test_splice_workspace_key_no_open_brace() {
        let out = splice_workspace_key(b"not json at all", "/tmp/proj");
        assert_eq!(out, b"not json at all");
    }

    #[test]
    fn test_splice_workspace_key_leading_whitespace() {
        // Mirrors the tug_session_id leading-whitespace test: the helper must
        // scan for the first `{` rather than rely on byte offset 0.
        let out = splice_workspace_key(b"  {\"type\":\"user_message\"}", "/tmp/proj");
        assert_eq!(
            out,
            b"  {\"workspace_key\":\"/tmp/proj\",\"type\":\"user_message\"}"
        );
        let trimmed = std::str::from_utf8(&out).unwrap().trim_start();
        let parsed: serde_json::Value = serde_json::from_str(trimmed).unwrap();
        assert_eq!(parsed["workspace_key"], "/tmp/proj");
        assert_eq!(parsed["type"], "user_message");
    }

    #[test]
    fn test_splice_workspace_key_empty_object() {
        let out = splice_workspace_key(b"{}", "/tmp/proj");
        assert_eq!(out, b"{\"workspace_key\":\"/tmp/proj\"}");
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["workspace_key"], "/tmp/proj");
    }

    #[test]
    fn test_splice_workspace_key_realistic_payload() {
        // FileTreeSnapshot-shaped JSON: workspace_key must land as the first field.
        let line = br#"{"files":["a.rs","b.rs"],"truncated":false}"#;
        let out = splice_workspace_key(line, "/home/user/tugtool");
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["workspace_key"], "/home/user/tugtool");
        assert_eq!(parsed["files"][0], "a.rs");
        assert_eq!(parsed["truncated"], false);
        // Confirm workspace_key is the FIRST field by checking the raw bytes.
        assert!(out.starts_with(br#"{"workspace_key":"/home/user/tugtool","#));
    }

    #[test]
    fn test_parse_tug_session_id_present() {
        let payload = br#"{"tug_session_id":"sess-abc","type":"user_message"}"#;
        assert_eq!(parse_tug_session_id(payload), Some("sess-abc".to_string()));
    }

    #[test]
    fn test_parse_tug_session_id_absent() {
        let payload = br#"{"type":"user_message"}"#;
        assert_eq!(parse_tug_session_id(payload), None);

        // Malformed JSON also returns None without panicking.
        assert_eq!(parse_tug_session_id(b"not json"), None);
    }

    // ---- parse_message_type ----

    #[test]
    fn test_parse_message_type_extracts_type_field() {
        let payload = br#"{"tug_session_id":"sess-abc","type":"user_message","text":"hi"}"#;
        assert_eq!(
            parse_message_type(payload),
            Some("user_message".to_string())
        );

        let payload =
            br#"{"type":"turn_complete","msg_id":"m1","seq":1,"result":"","ipc_version":2}"#;
        assert_eq!(
            parse_message_type(payload),
            Some("turn_complete".to_string())
        );
    }

    #[test]
    fn test_parse_message_type_absent_or_malformed() {
        // No type field.
        assert_eq!(parse_message_type(br#"{"text":"hi"}"#), None);
        // Type is non-string.
        assert_eq!(parse_message_type(br#"{"type":42}"#), None);
        // Malformed JSON.
        assert_eq!(parse_message_type(b"not json"), None);
    }

    // ---- parse_tug_turn_id ----

    #[test]
    fn test_parse_tug_turn_id_present() {
        // Round-trip: a payload with tug_turn_id parses out the field
        // exactly as written; the rest of the envelope is preserved.
        let payload = br#"{"tug_session_id":"sess-abc","tug_turn_id":"11111111-2222-3333-4444-555555555555","type":"user_message","text":"hi","attachments":[]}"#;
        assert_eq!(
            parse_tug_turn_id(payload),
            Some("11111111-2222-3333-4444-555555555555".to_string()),
        );
        // Other fields still parse via serde_json — no field interaction.
        let value: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["type"], "user_message");
        assert_eq!(value["text"], "hi");
        assert_eq!(value["tug_session_id"], "sess-abc");
    }

    #[test]
    fn test_parse_tug_turn_id_absent_back_compat() {
        // Backward-compat: a pre-step-4.3 envelope (no tug_turn_id) must
        // parse cleanly with None. Pins the optional-field migration story.
        let payload =
            br#"{"tug_session_id":"sess-abc","type":"user_message","text":"hi","attachments":[]}"#;
        assert_eq!(parse_tug_turn_id(payload), None);
        // The wire shape itself stays valid.
        let value: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["type"], "user_message");
    }

    #[test]
    fn test_parse_tug_turn_id_non_string_or_malformed() {
        // tug_turn_id present but non-string → None (defensive).
        assert_eq!(parse_tug_turn_id(br#"{"tug_turn_id":42}"#), None);
        // Malformed JSON → None, no panic.
        assert_eq!(parse_tug_turn_id(b"not json"), None);
    }

    // ---- parse_claude_message_id ----

    #[test]
    fn test_parse_claude_message_id_present_on_turn_complete() {
        let payload = br#"{"type":"turn_complete","msg_id":"m1","seq":3,"result":"","ipc_version":2,"claude_message_id":"msg_01ABC"}"#;
        assert_eq!(
            parse_claude_message_id(payload),
            Some("msg_01ABC".to_string()),
        );
    }

    #[test]
    fn test_parse_claude_message_id_present_on_turn_cancelled() {
        let payload = br#"{"type":"turn_cancelled","msg_id":"m1","seq":4,"partial_result":"so far","ipc_version":2,"claude_message_id":"msg_01ABC"}"#;
        assert_eq!(
            parse_claude_message_id(payload),
            Some("msg_01ABC".to_string()),
        );
    }

    #[test]
    fn test_parse_claude_message_id_absent_back_compat() {
        // Backward-compat: turn_complete / turn_cancelled emitted by an
        // older tugcode (or a synthetic-input fixture) without the new
        // field parses cleanly with None.
        let complete =
            br#"{"type":"turn_complete","msg_id":"m1","seq":3,"result":"","ipc_version":2}"#;
        assert_eq!(parse_claude_message_id(complete), None);

        let cancelled = br#"{"type":"turn_cancelled","msg_id":"m1","seq":4,"partial_result":"","ipc_version":2}"#;
        assert_eq!(parse_claude_message_id(cancelled), None);
    }

    #[test]
    fn test_parse_claude_message_id_non_string_or_malformed() {
        assert_eq!(
            parse_claude_message_id(br#"{"claude_message_id":42}"#),
            None
        );
        assert_eq!(parse_claude_message_id(b"not json"), None);
    }
}
