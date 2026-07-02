//! SessionScopedFeed — the reusable per-session feed producer.
//!
//! tugcast multiplexes per-session feeds over single FeedIds: every frame
//! carries its `tug_session_id` **inside the JSON payload** (spliced as the
//! first object field), broadcast to every client, and filtered back to the
//! right card by the deck-side session predicate ([D11];
//! `subscribeSessionFeed` in `tugdeck/src/lib/session-feed.ts` is the
//! consumer half). Before this type existed, each per-session feed
//! reinvented that discipline by hand around a raw `broadcast::Sender`.
//!
//! `SessionScopedFeed` is the publishing surface that owns it once: the
//! feed id, the lag policy, the broadcast channel, and splice-on-emit. It
//! is a cheap-to-clone handle — producers (the supervisor, the merger, a
//! sampler task) hold clones and publish; `FeedRouter::register_session_feed`
//! wires the same channel into client delivery.

use tokio::sync::broadcast;
use tugcast_core::{FeedId, Frame, LagPolicy};

use super::code::splice_tug_session_id;

/// A session-scoped stream feed: one FeedId multiplexing many sessions,
/// every payload tagged with its `tug_session_id`.
#[derive(Clone)]
pub struct SessionScopedFeed {
    feed_id: FeedId,
    lag_policy: LagPolicy,
    tx: broadcast::Sender<Frame>,
}

impl SessionScopedFeed {
    /// Create the feed and its broadcast channel.
    pub fn new(feed_id: FeedId, capacity: usize, lag_policy: LagPolicy) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self {
            feed_id,
            lag_policy,
            tx,
        }
    }

    /// Wrap an existing broadcast channel (tests that hold the far
    /// receiver; staged conversions where the channel outlives the handle).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_sender(
        feed_id: FeedId,
        tx: broadcast::Sender<Frame>,
        lag_policy: LagPolicy,
    ) -> Self {
        Self {
            feed_id,
            lag_policy,
            tx,
        }
    }

    pub fn feed_id(&self) -> FeedId {
        self.feed_id
    }

    pub fn lag_policy(&self) -> LagPolicy {
        self.lag_policy.clone()
    }

    /// The raw sender, for fan-in producers that build frames themselves
    /// (e.g. the supervisor's merger task).
    pub fn sender(&self) -> broadcast::Sender<Frame> {
        self.tx.clone()
    }

    /// Subscribe a receiver (taps and tests).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn subscribe(&self) -> broadcast::Receiver<Frame> {
        self.tx.subscribe()
    }

    /// Publish a JSON-object payload for a session: `tug_session_id` is
    /// spliced as the first field, the frame is tagged with this feed's id,
    /// and broadcast. Send errors (no receivers) are ignored, matching
    /// broadcast-feed convention. Authored ahead of its first production
    /// producer (the ACTIVITY feed publishes through this).
    #[allow(dead_code)]
    pub fn publish(&self, tug_session_id: &str, payload: &[u8]) {
        let spliced = splice_tug_session_id(payload, tug_session_id);
        self.publish_tagged(Frame::new(self.feed_id, spliced));
    }

    /// Publish a frame whose payload already carries its `tug_session_id`
    /// (a builder that serializes the id as a field, or an upstream splice).
    /// The frame must be tagged with this feed's id.
    ///
    /// When this feed's lag policy is `Replay`, every published frame is
    /// also pushed into the replay buffer — publishing through the handle
    /// is what keeps lag recovery truthful. (Before the handle existed the
    /// CODE_OUTPUT buffer had no producer at all: `LagPolicy::Replay`
    /// replayed an empty buffer on every lag.)
    pub fn publish_tagged(&self, frame: Frame) {
        debug_assert_eq!(frame.feed_id, self.feed_id);
        if let LagPolicy::Replay(buffer) = &self.lag_policy {
            buffer.push(frame.clone());
        }
        let _ = self.tx.send(frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload_json(frame: &Frame) -> serde_json::Value {
        serde_json::from_slice(&frame.payload).unwrap()
    }

    /// Spec S03: producers for sessions A and B on one feed; each
    /// subscriber-side predicate (the deck filter this producer pairs
    /// with) sees only its own session's frames, and every frame carries
    /// its session id as the first payload field.
    #[tokio::test]
    async fn publishes_session_tagged_frames_for_distinct_sessions() {
        let feed = SessionScopedFeed::new(FeedId::SESSION_STATE, 8, LagPolicy::Warn);
        let mut rx = feed.subscribe();

        feed.publish("session-a", br#"{"state":"live"}"#);
        feed.publish("session-b", br#"{"state":"closed"}"#);

        let first = rx.recv().await.unwrap();
        assert_eq!(first.feed_id, FeedId::SESSION_STATE);
        assert!(
            first
                .payload
                .starts_with(br#"{"tug_session_id":"session-a","#),
            "session id must be the first payload field"
        );
        assert_eq!(payload_json(&first)["state"], "live");

        let second = rx.recv().await.unwrap();
        assert_eq!(payload_json(&second)["tug_session_id"], "session-b");

        // The consumer-side routing: filter by tug_session_id.
        let for_a = [&first, &second]
            .iter()
            .filter(|f| payload_json(f)["tug_session_id"] == "session-a")
            .count();
        assert_eq!(for_a, 1);
    }

    #[tokio::test]
    async fn publish_tagged_forwards_prebuilt_frames() {
        let feed = SessionScopedFeed::new(FeedId::SESSION_STATE, 8, LagPolicy::Warn);
        let mut rx = feed.subscribe();
        let frame = Frame::new(
            FeedId::SESSION_STATE,
            br#"{"tug_session_id":"s1","state":"pending"}"#.to_vec(),
        );
        feed.publish_tagged(frame.clone());
        let got = rx.recv().await.unwrap();
        assert_eq!(got.payload, frame.payload);
    }

    #[tokio::test]
    async fn replay_policy_buffers_published_frames() {
        use tugcast_core::ReplayBuffer;
        let buffer = ReplayBuffer::new(4);
        let feed =
            SessionScopedFeed::new(FeedId::CODE_OUTPUT, 8, LagPolicy::Replay(buffer.clone()));
        let _rx = feed.subscribe();

        feed.publish("s1", br#"{"type":"assistant_text"}"#);
        feed.publish_tagged(Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"s2","type":"tool_use"}"#.to_vec(),
        ));

        // Lag recovery replays exactly what was published, in order —
        // the buffer the router snapshots is the same Arc-backed store.
        let snapshot = buffer.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(payload_json(&snapshot[0])["tug_session_id"], "s1");
        assert_eq!(payload_json(&snapshot[1])["tug_session_id"], "s2");
    }

    #[test]
    fn from_sender_preserves_channel_identity() {
        let (tx, mut rx) = broadcast::channel(4);
        let feed = SessionScopedFeed::from_sender(FeedId::SESSION_STATE, tx, LagPolicy::Warn);
        feed.publish("s1", b"{}");
        let frame = rx.try_recv().unwrap();
        assert_eq!(
            payload_json(&frame)["tug_session_id"],
            "s1",
            "frames published through the handle arrive on the wrapped channel"
        );
    }
}
