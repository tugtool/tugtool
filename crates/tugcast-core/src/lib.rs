//! tugcast-core: Shared types and traits for tugcast
//!
//! This crate provides the core protocol types, frame definitions, feed traits,
//! and data structures used by the tugcast WebSocket terminal bridge.
//!
//! ## Modules
//!
//! - [`protocol`] - Binary frame protocol and FeedId definitions
//! - [`feed`] - Feed traits for stream and snapshot feeds
//! - [`types`] - Data structures for snapshot feeds (FsEvent, GitStatus)

pub mod feed;
pub mod protocol;
pub mod types;

pub use feed::{SnapshotFeed, StreamFeed};
pub use protocol::{FeedId, Frame, HEADER_SIZE, MAX_PAYLOAD_SIZE, ProtocolError};
pub use types::{FileStatus, FsEvent, GitStatus};
