//! General utilities for tug.
//!
//! Provides shared utility functions used across multiple modules.

use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Generate a unique u64 for snapshot/undo tokens.
///
/// Uses a combination of:
/// - Current timestamp (nanoseconds)
/// - Process ID
/// - Thread ID (hashed)
/// - Atomic counter (to avoid collisions within same nanosecond)
///
/// The result is hashed with SHA-256 to produce a well-distributed value.
pub fn rand_u64() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;

    let pid = std::process::id();
    let thread_id = format!("{:?}", std::thread::current().id());
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);

    // Combine all entropy sources
    let mut hasher = Sha256::new();
    hasher.update(timestamp.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hasher.update(thread_id.as_bytes());
    hasher.update(counter.to_le_bytes());

    let hash = hasher.finalize();
    // Take first 8 bytes of hash as u64
    u64::from_le_bytes(hash[..8].try_into().expect("hash is 32 bytes"))
}

/// Generate a formatted snapshot ID.
///
/// Returns a string like `snap_0123456789abcdef`.
pub fn generate_snapshot_id() -> String {
    format!("snap_{:016x}", rand_u64())
}

/// Generate a formatted undo token.
///
/// Returns a string like `undo_0123456789abcdef`.
pub fn generate_undo_token() -> String {
    format!("undo_{:016x}", rand_u64())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn rand_u64_produces_different_values() {
        let mut values = HashSet::new();
        for _ in 0..1000 {
            let v = rand_u64();
            assert!(values.insert(v), "Duplicate value produced: {}", v);
        }
    }

    #[test]
    fn generate_snapshot_id_format() {
        let id = generate_snapshot_id();
        assert!(id.starts_with("snap_"), "Should start with snap_: {}", id);
        assert_eq!(id.len(), 21, "Should be 21 chars: {}", id); // "snap_" + 16 hex
    }

    #[test]
    fn generate_undo_token_format() {
        let token = generate_undo_token();
        assert!(token.starts_with("undo_"), "Should start with undo_: {}", token);
        assert_eq!(token.len(), 21, "Should be 21 chars: {}", token); // "undo_" + 16 hex
    }

    #[test]
    fn generated_ids_are_unique() {
        let mut snapshot_ids = HashSet::new();
        let mut undo_tokens = HashSet::new();

        for _ in 0..100 {
            let snap = generate_snapshot_id();
            let undo = generate_undo_token();
            assert!(snapshot_ids.insert(snap.clone()), "Duplicate snapshot ID");
            assert!(undo_tokens.insert(undo.clone()), "Duplicate undo token");
        }
    }
}
