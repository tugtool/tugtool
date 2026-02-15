//! Binary WebSocket frame protocol for tugcast
//!
//! This module implements the wire protocol for tugcast WebSocket communication.
//! Each frame consists of:
//! - 1 byte: FeedId (identifies the data stream)
//! - 4 bytes: Payload length (big-endian u32)
//! - Variable: Payload data

/// Maximum payload size in bytes (1 MB)
pub const MAX_PAYLOAD_SIZE: usize = 1_048_576;

/// Size of the frame header in bytes (1 byte FeedId + 4 bytes length)
pub const HEADER_SIZE: usize = 5;

/// Feed identifiers for different data streams
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FeedId {
    /// Terminal output stream (tugcast -> tugdeck)
    TerminalOutput = 0x00,
    /// Terminal input stream (tugdeck -> tugcast)
    TerminalInput = 0x01,
    /// Terminal resize events (tugdeck -> tugcast)
    TerminalResize = 0x02,
    /// Filesystem events snapshot (tugcast -> tugdeck)
    Filesystem = 0x10,
    /// Git status snapshot (tugcast -> tugdeck)
    Git = 0x20,
    /// Heartbeat/keepalive frames (bidirectional)
    Heartbeat = 0xFF,
}

impl FeedId {
    /// Convert a byte to a FeedId variant
    ///
    /// Returns None if the byte does not correspond to a known feed ID.
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0x00 => Some(FeedId::TerminalOutput),
            0x01 => Some(FeedId::TerminalInput),
            0x02 => Some(FeedId::TerminalResize),
            0x10 => Some(FeedId::Filesystem),
            0x20 => Some(FeedId::Git),
            0xFF => Some(FeedId::Heartbeat),
            _ => None,
        }
    }

    /// Convert this FeedId to its byte representation
    pub fn as_byte(&self) -> u8 {
        *self as u8
    }
}

/// Errors that can occur during frame decoding
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    /// Not enough bytes available to decode a complete frame
    #[error("incomplete frame: need at least {needed} bytes, have {have}")]
    Incomplete { needed: usize, have: usize },

    /// The feed ID byte does not match any known feed
    #[error("invalid feed ID: 0x{0:02x}")]
    InvalidFeedId(u8),

    /// The payload size exceeds the maximum allowed
    #[error("payload too large: {size} bytes exceeds maximum {max}")]
    PayloadTooLarge { size: usize, max: usize },
}

/// A WebSocket frame containing a feed ID and payload
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// The feed this frame belongs to
    pub feed_id: FeedId,
    /// The frame payload data
    pub payload: Vec<u8>,
}

impl Frame {
    /// Create a new frame with the given feed ID and payload
    pub fn new(feed_id: FeedId, payload: Vec<u8>) -> Self {
        Frame { feed_id, payload }
    }

    /// Create a heartbeat frame (empty payload)
    pub fn heartbeat() -> Self {
        Frame {
            feed_id: FeedId::Heartbeat,
            payload: Vec::new(),
        }
    }

    /// Encode this frame into wire format bytes
    ///
    /// The wire format is:
    /// - 1 byte: feed_id
    /// - 4 bytes: payload length (big-endian u32)
    /// - N bytes: payload data
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HEADER_SIZE + self.payload.len());
        bytes.push(self.feed_id.as_byte());
        bytes.extend_from_slice(&(self.payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    /// Decode a frame from wire format bytes
    ///
    /// Returns a tuple of (Frame, bytes_consumed) on success.
    /// The bytes_consumed value indicates how many bytes from the input
    /// were used to construct the frame.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The buffer is too small to contain a complete frame header
    /// - The buffer is too small to contain the complete payload
    /// - The feed ID byte is not recognized
    /// - The payload size exceeds MAX_PAYLOAD_SIZE
    pub fn decode(bytes: &[u8]) -> Result<(Frame, usize), ProtocolError> {
        // Check if we have enough bytes for the header
        if bytes.len() < HEADER_SIZE {
            return Err(ProtocolError::Incomplete {
                needed: HEADER_SIZE,
                have: bytes.len(),
            });
        }

        // Parse feed ID
        let feed_id = FeedId::from_byte(bytes[0]).ok_or(ProtocolError::InvalidFeedId(bytes[0]))?;

        // Parse payload length (big-endian u32)
        let length = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;

        // Check if payload size is within limits
        if length > MAX_PAYLOAD_SIZE {
            return Err(ProtocolError::PayloadTooLarge {
                size: length,
                max: MAX_PAYLOAD_SIZE,
            });
        }

        // Check if we have enough bytes for the complete frame
        let total_size = HEADER_SIZE + length;
        if bytes.len() < total_size {
            return Err(ProtocolError::Incomplete {
                needed: total_size,
                have: bytes.len(),
            });
        }

        // Extract payload
        let payload = bytes[HEADER_SIZE..total_size].to_vec();

        Ok((Frame { feed_id, payload }, total_size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feedid_from_byte() {
        assert_eq!(FeedId::from_byte(0x00), Some(FeedId::TerminalOutput));
        assert_eq!(FeedId::from_byte(0x01), Some(FeedId::TerminalInput));
        assert_eq!(FeedId::from_byte(0x02), Some(FeedId::TerminalResize));
        assert_eq!(FeedId::from_byte(0x10), Some(FeedId::Filesystem));
        assert_eq!(FeedId::from_byte(0x20), Some(FeedId::Git));
        assert_eq!(FeedId::from_byte(0xFF), Some(FeedId::Heartbeat));
        assert_eq!(FeedId::from_byte(0x03), None);
        assert_eq!(FeedId::from_byte(0x30), None);
    }

    #[test]
    fn test_feedid_as_byte() {
        assert_eq!(FeedId::TerminalOutput.as_byte(), 0x00);
        assert_eq!(FeedId::TerminalInput.as_byte(), 0x01);
        assert_eq!(FeedId::TerminalResize.as_byte(), 0x02);
        assert_eq!(FeedId::Filesystem.as_byte(), 0x10);
        assert_eq!(FeedId::Git.as_byte(), 0x20);
        assert_eq!(FeedId::Heartbeat.as_byte(), 0xFF);
    }

    #[test]
    fn test_round_trip_terminal_output() {
        let original = Frame::new(FeedId::TerminalOutput, b"hello world".to_vec());
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_round_trip_terminal_input() {
        let original = Frame::new(FeedId::TerminalInput, b"test input".to_vec());
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_round_trip_terminal_resize() {
        let original = Frame::new(
            FeedId::TerminalResize,
            b"{\"cols\": 80, \"rows\": 24}".to_vec(),
        );
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_round_trip_heartbeat() {
        let original = Frame::heartbeat();
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_round_trip_filesystem() {
        let original = Frame::new(
            FeedId::Filesystem,
            b"{\"kind\":\"Created\",\"path\":\"src/main.rs\"}".to_vec(),
        );
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_round_trip_git() {
        let original = Frame::new(
            FeedId::Git,
            b"{\"branch\":\"main\",\"ahead\":0,\"behind\":0}".to_vec(),
        );
        let encoded = original.encode();
        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(bytes_consumed, encoded.len());
    }

    #[test]
    fn test_decode_empty_payload() {
        let frame = Frame::new(FeedId::TerminalOutput, vec![]);
        let encoded = frame.encode();
        let (decoded, _) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded.payload.len(), 0);
        assert_eq!(decoded.feed_id, FeedId::TerminalOutput);
    }

    #[test]
    fn test_decode_maximum_payload() {
        let payload = vec![0u8; MAX_PAYLOAD_SIZE];
        let frame = Frame::new(FeedId::TerminalOutput, payload.clone());
        let encoded = frame.encode();
        let (decoded, _) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded.payload.len(), MAX_PAYLOAD_SIZE);
        assert_eq!(decoded.payload, payload);
    }

    #[test]
    fn test_decode_invalid_feed_id() {
        let mut bytes = vec![0x03, 0, 0, 0, 5];
        bytes.extend_from_slice(b"hello");
        let result = Frame::decode(&bytes);
        assert_eq!(result, Err(ProtocolError::InvalidFeedId(0x03)));
    }

    #[test]
    fn test_decode_truncated_header() {
        let bytes = vec![0x00, 0, 0];
        let result = Frame::decode(&bytes);
        assert_eq!(
            result,
            Err(ProtocolError::Incomplete {
                needed: HEADER_SIZE,
                have: 3
            })
        );
    }

    #[test]
    fn test_decode_truncated_payload() {
        // Header says 10 bytes, but we only provide 5
        let mut bytes = vec![0x00, 0, 0, 0, 10];
        bytes.extend_from_slice(b"hello");
        let result = Frame::decode(&bytes);
        assert_eq!(
            result,
            Err(ProtocolError::Incomplete {
                needed: 15,
                have: 10
            })
        );
    }

    #[test]
    fn test_decode_oversized_payload() {
        let oversized = (MAX_PAYLOAD_SIZE + 1) as u32;
        let bytes = vec![
            0x00,
            (oversized >> 24) as u8,
            (oversized >> 16) as u8,
            (oversized >> 8) as u8,
            oversized as u8,
        ];
        let result = Frame::decode(&bytes);
        assert_eq!(
            result,
            Err(ProtocolError::PayloadTooLarge {
                size: MAX_PAYLOAD_SIZE + 1,
                max: MAX_PAYLOAD_SIZE
            })
        );
    }

    #[test]
    fn test_golden_terminal_output_hello() {
        let frame = Frame::new(FeedId::TerminalOutput, b"hello".to_vec());
        let encoded = frame.encode();
        // Expected wire format:
        // [0x00] - TerminalOutput
        // [0x00, 0x00, 0x00, 0x05] - length 5 (big-endian)
        // [0x68, 0x65, 0x6c, 0x6c, 0x6f] - "hello"
        assert_eq!(
            encoded,
            vec![0x00, 0x00, 0x00, 0x00, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]
        );
    }

    #[test]
    fn test_golden_heartbeat_empty() {
        let frame = Frame::heartbeat();
        let encoded = frame.encode();
        // Expected wire format:
        // [0xFF] - Heartbeat
        // [0x00, 0x00, 0x00, 0x00] - length 0 (big-endian)
        assert_eq!(encoded, vec![0xFF, 0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_heartbeat_convenience_constructor() {
        let frame = Frame::heartbeat();
        assert_eq!(frame.feed_id, FeedId::Heartbeat);
        assert_eq!(frame.payload.len(), 0);
    }

    #[test]
    fn test_bytes_consumed_matches_encoded_length() {
        let frame = Frame::new(FeedId::TerminalInput, b"test data".to_vec());
        let encoded = frame.encode();
        let (_, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(bytes_consumed, encoded.len());
        assert_eq!(bytes_consumed, HEADER_SIZE + 9);
    }

    #[test]
    fn test_decode_with_extra_bytes() {
        // Test that decode correctly handles a buffer with extra data after the frame
        let frame = Frame::new(FeedId::TerminalOutput, b"test".to_vec());
        let mut encoded = frame.encode();
        encoded.extend_from_slice(b"extra data");

        let (decoded, bytes_consumed) = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded.payload, b"test");
        assert_eq!(bytes_consumed, HEADER_SIZE + 4);
    }
}
