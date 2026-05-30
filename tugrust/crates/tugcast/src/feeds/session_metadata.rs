//! Session metadata detection helper.
//!
//! Historically this module latched `system_metadata` frames from the shared
//! CODE_OUTPUT broadcast onto a single `watch::channel<Frame>` owned by the
//! router. Under the multi-session router, latching a single slot would
//! clobber concurrent per-session metadata updates — see [D14]. The supervisor now owns the
//! detection inline in its merger task and stores the frame on
//! `LedgerEntry::latest_metadata` (per-session) AND publishes it on a
//! dedicated SESSION_METADATA broadcast sender.
//!
//! All that remains of this module is the byte-level needle-scan helper:
//! scanning the payload for `"type":"system_metadata"` is significantly
//! cheaper than a full JSON parse on every CODE_OUTPUT frame, and the
//! merger is called per-token so the hot-path micro-optimization still
//! matters.

/// Needle bytes for identifying `system_metadata` events without a full
/// JSON parse.
const SYSTEM_METADATA_NEEDLE: &[u8] = b"\"type\":\"system_metadata\"";

/// Check if a payload contains a `system_metadata` event by scanning for
/// the type field. Avoids a full JSON parse on every CODE_OUTPUT frame.
pub fn is_system_metadata(payload: &[u8]) -> bool {
    payload
        .windows(SYSTEM_METADATA_NEEDLE.len())
        .any(|w| w == SYSTEM_METADATA_NEEDLE)
}

/// Needle bytes for identifying `session_capabilities` events — the
/// turn-free `initialize`-handshake capabilities tugcode emits once per
/// spawn (model list, command catalog, …).
const SESSION_CAPABILITIES_NEEDLE: &[u8] = b"\"type\":\"session_capabilities\"";

/// Check if a payload is a `session_capabilities` event. Like
/// `system_metadata`, these are routed onto the low-churn
/// SESSION_METADATA feed (the FeedStore keeps only the latest payload
/// per feed, so a CODE_OUTPUT consumer would lose it amid transcript
/// frames). The client store discriminates the two by their `type`.
pub fn is_session_capabilities(payload: &[u8]) -> bool {
    payload
        .windows(SESSION_CAPABILITIES_NEEDLE.len())
        .any(|w| w == SESSION_CAPABILITIES_NEEDLE)
}

/// Needle bytes for identifying `rate_limit_event` frames — the
/// per-turn subscription-quota broadcast tugcode forwards from claude
/// 2.1.x (status / resetsAt / overage).
const RATE_LIMIT_EVENT_NEEDLE: &[u8] = b"\"type\":\"rate_limit_event\"";

/// Check if a payload is a `rate_limit_event` frame. Routed onto the
/// SESSION_METADATA feed for the same reason as `system_metadata` and
/// `session_capabilities`: the per-turn quota broadcast carries the
/// chrome state the Z4B rate-limit chip reads, and the FeedStore keeps
/// only the latest payload per feed, so leaving it on the high-churn
/// CODE_OUTPUT stream would clobber it amid transcript frames before
/// the metadata store could observe it. The client store discriminates
/// all three by their `type`.
pub fn is_rate_limit_event(payload: &[u8]) -> bool {
    payload
        .windows(RATE_LIMIT_EVENT_NEEDLE.len())
        .any(|w| w == RATE_LIMIT_EVENT_NEEDLE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_system_metadata() {
        let payload =
            br#"{"type":"system_metadata","session_id":"abc","cwd":"/tmp","slash_commands":[]}"#;
        assert!(is_system_metadata(payload));
    }

    #[test]
    fn rejects_non_metadata() {
        let payload = br#"{"type":"assistant","content":"hello"}"#;
        assert!(!is_system_metadata(payload));
    }

    #[test]
    fn rejects_empty() {
        assert!(!is_system_metadata(b""));
    }

    #[test]
    fn rejects_other_type() {
        let payload = br#"{"type":"system","subtype":"init"}"#;
        assert!(!is_system_metadata(payload));
    }

    #[test]
    fn detects_session_capabilities() {
        let payload = br#"{"type":"session_capabilities","models":[],"commands":[]}"#;
        assert!(is_session_capabilities(payload));
        assert!(!is_system_metadata(payload));
    }

    #[test]
    fn rejects_capabilities_for_non_capabilities() {
        let payload = br#"{"type":"system_metadata","model":"x"}"#;
        assert!(!is_session_capabilities(payload));
    }

    #[test]
    fn detects_rate_limit_event() {
        let payload = br#"{"type":"rate_limit_event","rate_limit_info":{"status":"warning","resetsAt":1234567890}}"#;
        assert!(is_rate_limit_event(payload));
        assert!(!is_system_metadata(payload));
        assert!(!is_session_capabilities(payload));
    }

    #[test]
    fn rejects_rate_limit_for_non_rate_limit() {
        let payload = br#"{"type":"system_metadata","model":"x"}"#;
        assert!(!is_rate_limit_event(payload));
    }
}
