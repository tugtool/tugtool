//! Code feed module
//!
//! Handles code messages between tugcast and tugtalk via JSON-lines IPC.

use tugcast_core::protocol::{FeedId, Frame};

/// Code broadcast channel capacity
/// (smaller than terminal's 4096; code JSON messages are larger but less frequent)
pub const CODE_BROADCAST_CAPACITY: usize = 1024;

/// Create a code output frame from JSON-lines data
pub fn code_output_frame(json_line: &[u8]) -> Frame {
    Frame::new(FeedId::CodeOutput, json_line.to_vec())
}

/// Extract JSON string from a CodeInput frame payload
pub fn parse_code_input(frame: &Frame) -> Option<String> {
    if frame.feed_id != FeedId::CodeInput {
        return None;
    }
    String::from_utf8(frame.payload.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_output_frame() {
        let json = b"{\"type\":\"assistant_text\"}";
        let frame = code_output_frame(json);
        assert_eq!(frame.feed_id, FeedId::CodeOutput);
        assert_eq!(frame.payload, json);
    }

    #[test]
    fn test_parse_code_input() {
        let frame = Frame::new(FeedId::CodeInput, b"{\"type\":\"user_message\"}".to_vec());
        let result = parse_code_input(&frame);
        assert_eq!(result, Some("{\"type\":\"user_message\"}".to_string()));
    }

    #[test]
    fn test_parse_code_input_wrong_feed() {
        let frame = Frame::new(FeedId::TerminalInput, b"test".to_vec());
        let result = parse_code_input(&frame);
        assert_eq!(result, None);
    }
}
