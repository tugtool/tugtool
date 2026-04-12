//! Code feed module
//!
//! Handles code messages between tugcast and tugcode via JSON-lines IPC.

use tugcast_core::protocol::{FeedId, Frame};

/// Code broadcast channel capacity
/// (smaller than terminal's 4096; code JSON messages are larger but less frequent)
pub const CODE_BROADCAST_CAPACITY: usize = 1024;

/// Create a code output frame from JSON-lines data
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
#[allow(dead_code)]
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

/// Parse the `tug_session_id` field out of a stream-json payload.
///
/// CODE_INPUT frames are user-typed (at most one per user message), so the
/// keystroke interarrival time dominates parser overhead — a full JSON parse
/// is acceptable here. CODE_OUTPUT uses a byte-window scan in
/// `session_metadata.rs` because that path runs per stream token.
#[allow(dead_code)]
pub fn parse_tug_session_id(payload: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(payload).ok()?;
    value
        .get("tug_session_id")
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

    #[test]
    fn test_parse_tug_session_id_present() {
        let payload = br#"{"tug_session_id":"sess-abc","type":"user_message"}"#;
        assert_eq!(
            parse_tug_session_id(payload),
            Some("sess-abc".to_string())
        );
    }

    #[test]
    fn test_parse_tug_session_id_absent() {
        let payload = br#"{"type":"user_message"}"#;
        assert_eq!(parse_tug_session_id(payload), None);

        // Malformed JSON also returns None without panicking.
        assert_eq!(parse_tug_session_id(b"not json"), None);
    }
}
