//! Conversation feed module
//!
//! Handles conversation messages between tugcast and tugtalk via JSON-lines IPC.

use tugcast_core::protocol::{FeedId, Frame};

/// Conversation broadcast channel capacity
/// (smaller than terminal's 4096; conversation JSON messages are larger but less frequent)
pub const CONVERSATION_BROADCAST_CAPACITY: usize = 1024;

/// Create a conversation output frame from JSON-lines data
pub fn conversation_output_frame(json_line: &[u8]) -> Frame {
    Frame::new(FeedId::ConversationOutput, json_line.to_vec())
}

/// Extract JSON string from a ConversationInput frame payload
pub fn parse_conversation_input(frame: &Frame) -> Option<String> {
    if frame.feed_id != FeedId::ConversationInput {
        return None;
    }
    String::from_utf8(frame.payload.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conversation_output_frame() {
        let json = b"{\"type\":\"assistant_text\"}";
        let frame = conversation_output_frame(json);
        assert_eq!(frame.feed_id, FeedId::ConversationOutput);
        assert_eq!(frame.payload, json);
    }

    #[test]
    fn test_parse_conversation_input() {
        let frame = Frame::new(
            FeedId::ConversationInput,
            b"{\"type\":\"user_message\"}".to_vec(),
        );
        let result = parse_conversation_input(&frame);
        assert_eq!(result, Some("{\"type\":\"user_message\"}".to_string()));
    }

    #[test]
    fn test_parse_conversation_input_wrong_feed() {
        let frame = Frame::new(FeedId::TerminalInput, b"test".to_vec());
        let result = parse_conversation_input(&frame);
        assert_eq!(result, None);
    }
}
