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
pub use types::{FileStatus, FsEvent, GitStatus, StatSnapshot};

/// Default port for the Vite dev server.
///
/// This is the single source of truth for the Vite dev server port in Rust code.
/// Both `tugcast` and `tugtool` crates reference this constant. The actual port
/// is communicated at runtime via the `vite_port` field of the `DevMode` control
/// message; this constant serves as the fallback when that field is absent.
pub const DEFAULT_VITE_DEV_PORT: u16 = 5173;
