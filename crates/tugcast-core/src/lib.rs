//! tugcast-core: Shared types and traits for tugcast
//!
//! This crate provides the core protocol types, frame definitions, and feed traits
//! used by the tugcast WebSocket terminal bridge.

pub mod protocol;
pub mod feed;

pub use protocol::{FeedId, Frame, ProtocolError, HEADER_SIZE, MAX_PAYLOAD_SIZE};
pub use feed::{StreamFeed, SnapshotFeed};
