//! DEFAULTS feed for tugcast.
//!
//! Pushes a single aggregated DEFAULTS frame — containing all domain snapshots
//! in one JSON object — to all WebSocket clients via a `watch::Sender<Frame>`.
//!
//! # Frame format
//!
//! Each DEFAULTS frame payload is a JSON object:
//! ```json
//! {
//!   "domains": {
//!     "dev.tugtool.deck.layout": {
//!       "generation": 42,
//!       "entries": {
//!         "layout": {"kind": "json", "value": {...}}
//!       }
//!     }
//!   }
//! }
//! ```
//!
//! The frame contains *all* domains on every send (not just changed ones),
//! because `watch::Sender` holds exactly one value and a partial update would
//! overwrite the prior complete state.
//!
//! # Design
//!
//! - [`defaults_feed`] accepts `Arc<TugbankClient>` and returns a
//!   `watch::Receiver<Frame>` that callers push into `snapshot_watches`.
//! - An `on_domain_changed` callback rebuilds the full aggregated frame on any
//!   domain change and sends it via `watch::Sender::send()`.
//! - The `CallbackHandle` is held in a spawned task that lives as long as the
//!   sender (i.e. until the receiver is dropped from `snapshot_watches`).

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::{Map, Value as JsonValue, json};
use tokio::sync::watch;
use tracing::{debug, warn};
use tugbank_core::TugbankClient;
use tugcast_core::{FeedId, Frame};

use crate::defaults::value_to_tagged;

// ── Payload builder ───────────────────────────────────────────────────────────

/// Build an aggregated DEFAULTS frame from the current state of `client`.
///
/// Returns a serialised JSON payload `{"domains":{...}}` containing all
/// domains. On error (e.g. a domain fails to load), the domain is omitted and
/// a warning is logged.
fn build_defaults_frame(client: &TugbankClient) -> Frame {
    let domains_map = build_domains_json(client);
    let payload = json!({"domains": domains_map});
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    Frame::new(FeedId::DEFAULTS, bytes)
}

/// Serialise all domains into a `serde_json::Map` suitable for the frame payload.
fn build_domains_json(client: &TugbankClient) -> Map<String, JsonValue> {
    let mut domains_map = Map::new();

    let domain_names = match client.list_domains() {
        Ok(names) => names,
        Err(e) => {
            warn!(error = %e, "defaults_feed: failed to list domains");
            return domains_map;
        }
    };

    for domain_name in &domain_names {
        let snapshot: BTreeMap<String, tugbank_core::Value> = match client.read_domain(domain_name)
        {
            Ok(snap) => snap,
            Err(e) => {
                warn!(domain = %domain_name, error = %e, "defaults_feed: failed to read domain");
                continue;
            }
        };

        // Get generation from the store.
        let generation: u64 = client
            .store()
            .domain(domain_name)
            .and_then(|h| h.generation())
            .unwrap_or(0);

        let mut entries = Map::new();
        for (key, value) in &snapshot {
            let tagged = value_to_tagged(value);
            if let Ok(v) = serde_json::to_value(&tagged) {
                entries.insert(key.clone(), v);
            }
        }

        let domain_obj = json!({
            "generation": generation,
            "entries": entries,
        });
        domains_map.insert(domain_name.clone(), domain_obj);
    }

    domains_map
}

// ── defaults_feed ─────────────────────────────────────────────────────────────

/// Start the DEFAULTS feed.
///
/// Builds and sends an initial aggregated DEFAULTS frame, registers a
/// domain-changed callback that rebuilds and sends the full frame on every
/// change, and returns a `watch::Receiver<Frame>` for wiring into
/// `snapshot_watches`.
///
/// The returned receiver (and by extension the `watch::Sender` inside) lives
/// until all receivers are dropped. The `CallbackHandle` is kept alive inside
/// a spawned task that holds a clone of the sender, so the callback fires as
/// long as the feed is alive.
pub fn defaults_feed(client: Arc<TugbankClient>) -> watch::Receiver<Frame> {
    // Build the initial frame before registering the callback so the
    // first value is always a complete snapshot.
    let initial_frame = build_defaults_frame(&client);
    let (tx, rx) = watch::channel(initial_frame);
    debug!("defaults_feed: initial frame sent");

    // Spawn a task that holds both the sender and the callback handle.
    // The callback captures a clone of the sender and a clone of the client Arc.
    // When the task exits, both the handle (unregistering the callback) and the
    // sender clone are dropped.
    let task_tx = tx.clone();
    tokio::spawn(async move {
        // Clones for the callback closure (which must be 'static + Send).
        let cb_client = Arc::clone(&client);
        let cb_tx = task_tx.clone();

        // Register the change callback. The handle keeps the callback alive.
        let _handle = client.on_domain_changed(move |domain, _snapshot| {
            debug!(domain = %domain, "defaults_feed: domain changed, rebuilding frame");
            let frame = build_defaults_frame(&cb_client);
            if cb_tx.send(frame).is_err() {
                // All receivers dropped — feed is no longer consumed.
                debug!("defaults_feed: all receivers dropped, callback is stale");
            }
        });

        // Keep the task alive until the watch channel is fully closed.
        task_tx.closed().await;
        debug!("defaults_feed: channel closed, task exiting");
    });

    rx
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tugbank_core::{TugbankClient, Value};

    /// test_defaults_feed_aggregates_all_domains:
    ///
    /// Create a TugbankClient with two domains, call defaults_feed, verify the
    /// initial watch::Receiver value contains both domains in a single frame.
    #[tokio::test]
    async fn test_defaults_feed_aggregates_all_domains() {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");

        // Write two domains.
        client
            .set("domain.alpha", "key1", Value::String("hello".into()))
            .expect("set alpha");
        client
            .set("domain.beta", "key2", Value::I64(42))
            .expect("set beta");

        let client_arc = Arc::new(client);
        let rx = defaults_feed(Arc::clone(&client_arc));

        // The initial frame should contain both domains.
        let frame = rx.borrow().clone();
        assert_eq!(frame.feed_id, FeedId::DEFAULTS);
        assert!(!frame.payload.is_empty(), "payload should not be empty");

        let parsed: serde_json::Value = serde_json::from_slice(&frame.payload).expect("valid JSON");
        let domains = parsed
            .get("domains")
            .expect("domains key")
            .as_object()
            .expect("domains is object");

        assert!(domains.contains_key("domain.alpha"), "missing domain.alpha");
        assert!(domains.contains_key("domain.beta"), "missing domain.beta");

        // Verify domain.alpha has the expected entry.
        let alpha = &domains["domain.alpha"];
        let alpha_entries = alpha.get("entries").expect("entries").as_object().unwrap();
        assert!(alpha_entries.contains_key("key1"), "missing key1 in alpha");

        // Verify domain.beta has the expected entry.
        let beta = &domains["domain.beta"];
        let beta_entries = beta.get("entries").expect("entries").as_object().unwrap();
        assert!(beta_entries.contains_key("key2"), "missing key2 in beta");
    }
}
