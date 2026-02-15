//! tugcast-core: Shared types and traits for tugcast
//!
//! This crate provides the core protocol types, frame definitions, and feed traits
//! used by the tugcast WebSocket terminal bridge.

pub mod feed;
pub mod protocol;
pub mod types;

pub use feed::{SnapshotFeed, StreamFeed};
pub use protocol::{FeedId, Frame, HEADER_SIZE, MAX_PAYLOAD_SIZE, ProtocolError};
pub use types::{FileStatus, FsEvent, GitStatus};
