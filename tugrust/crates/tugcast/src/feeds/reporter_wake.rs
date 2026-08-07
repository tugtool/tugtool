//! reporter_wake — the Reporter's decision core, with no IO in it.
//!
//! Rust decides *when* to wake the Reporter; the model decides *whether and
//! what* to post. This module is the whole of the first half plus the parsing
//! of the second, and it is deliberately pure: buffers, wake reasons, the
//! composition of a wake's input, and the strict read of the envelope that
//! comes back. The live bridge owns the tokio wiring and nothing else.
//!
//! ## Why purity is the point here
//!
//! The offline replay harness and the live bridge must run **the same**
//! segmentation and composition, or the cadence tuned against real transcripts
//! is not the cadence that ships. Keeping this module free of channels, clocks,
//! and sockets is what lets both drive it — and it makes "an idle session never
//! wakes" and "a malformed envelope posts nothing" testable without standing
//! anything up.
//!
//! Time enters as a parameter. Nothing here reads a clock.

// The composition and validation surface is authored ahead of the bridge and
// the replay harness that call it; suppress dead-code for the phased rollout,
// as `session_ledger.rs` and `path_resolver.rs` do.
#![allow(dead_code)]

use std::collections::HashSet;

use serde::Deserialize;
use tugcast_core::{GazetteRef, GazetteRefKind};

use super::gazette_agent::{BUFFER_MAX_BYTES, DEFAULT_BUFFER_MAX_FRAMES};
use super::payload_inspector::InspectedPayload;

// MARK: - The tap

/// Frame types that reach the Reporter's buffer.
///
/// Starts from the Pulse allowlist — the narratable subset of tugcode's
/// outbound vocabulary — because the two subsystems want the same evidence:
/// what the assistant said, what tools it ran and what came back, and how each
/// turn ended. `replay_started` / `replay_complete` are consumed as mute
/// brackets and never forwarded, so a reconnect flood cannot re-narrate
/// history.
///
/// The Reporter additionally keeps `turn_complete` for its usage numbers,
/// which is what a token-threshold wake reads and what lets a post say what a
/// stretch of work cost.
pub const REPORTER_FORWARD_ALLOWLIST: &[&str] = &[
    "tool_use",
    "tool_result",
    "tool_input_progress",
    "assistant_text",
    "turn_complete",
    "turn_cancelled",
    "task_started",
    "task_updated",
    "task_progress",
    "api_retry",
    "error",
    "wake_started",
    "model_refusal_fallback",
    "output_truncated",
    "compact_boundary",
];

/// Classify one CODE_OUTPUT frame for the tap.
///
/// Returns the spliced session id when the frame belongs in that session's
/// buffer. The mute set is maintained as brackets pass **even while the
/// Gazette is disabled**, because mute state tracks the wire rather than the
/// toggle — a session that entered replay while the channel was off must not
/// have the tail of that replay narrated when it comes back on.
///
/// Mirrors `feeds::pulse::forwardable_session`; the two taps are independent
/// by construction, and neither can see the other's output.
pub fn forwardable_session(payload: &[u8], muted: &mut HashSet<String>) -> Option<String> {
    let inspected = InspectedPayload::from_slice(payload)?;
    let msg_type = inspected.msg_type.as_deref()?;
    let session = inspected.tug_session_id.clone();
    match msg_type {
        "replay_started" => {
            if let Some(session) = session {
                muted.insert(session);
            }
            None
        }
        "replay_complete" => {
            if let Some(session) = session {
                muted.remove(&session);
            }
            None
        }
        t if REPORTER_FORWARD_ALLOWLIST.contains(&t) => {
            let session = session?;
            if muted.contains(&session) {
                None
            } else {
                Some(session)
            }
        }
        _ => None,
    }
}

/// Whether a tapped frame is the session doing work, as opposed to the wire
/// closing a turn.
///
/// A turn-end wake fires only when the turn actually held work: a `/model`
/// slash command is a user message and a `turn_complete` and nothing else, and
/// waking a model to be told that a setting changed spends a call to learn
/// there is nothing to say. A user prompt does not count either — it arrives on
/// the submission feed and never reaches this predicate, which is why "the user
/// asked something and nothing happened yet" is not post-worthy.
///
/// Shared rather than written twice: both the live bridge and the replay
/// harness gate their turn-end wake on this, so the wake count the harness
/// reports is the wake count the bridge would fire. Two copies of this rule is
/// exactly the drift [R01] exists to prevent — and did drift, until a live log
/// showing one wake was read beside a replay claiming three.
pub fn counts_as_assistant_activity(msg_type: &str) -> bool {
    !matches!(msg_type, "turn_complete" | "turn_cancelled")
}

// MARK: - Wake reasons

/// Why the Reporter is being asked now.
///
/// The reason rides the job input because the model uses it well — a
/// session-end wake produces a wrap-up, a turn-end wake produces "here is what
/// that turn did", and a sitrep wake produces either progress or silence. It
/// is a fact about the moment, not a hint about the answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeReason {
    /// A turn finished. Functions as a flush and as the "ready for you to look
    /// in" signal; real turns routinely outrun the sitrep timer, so this is
    /// not the primary cadence.
    TurnEnd,
    /// Enough continuous activity has accumulated since this session's last
    /// post. The dominant wake in practice.
    SitrepTimer,
    /// The session ended.
    SessionEnd,
    /// Cumulative token usage since the last post crossed the threshold.
    TokenThreshold,
}

impl WakeReason {
    /// The wire spelling, which is also what the job input carries and what a
    /// post records in `wake_reason`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TurnEnd => "turn-end",
            Self::SitrepTimer => "sitrep-timer",
            Self::SessionEnd => "session-end",
            Self::TokenThreshold => "token-threshold",
        }
    }
}

// MARK: - The buffer

/// What the buffer prints in place of frames it dropped.
///
/// Explicit rather than silent: a model shown a truncated window with no
/// marker would describe the window as if it were the whole stretch.
pub const ELISION_MARKER: &str = "[earlier frames elided]";

/// One session's frames since its last wake.
///
/// Bounded in both frames and bytes, dropping oldest-first, because a wake's
/// input has to fit in one turn and a long-running session can produce far
/// more than that. The caps are what make the elision marker necessary.
#[derive(Debug)]
pub struct FrameBuffer {
    frames: Vec<String>,
    bytes: usize,
    max_frames: usize,
    max_bytes: usize,
    /// True once anything has been dropped, so the composed input says so.
    elided: bool,
}

impl Default for FrameBuffer {
    fn default() -> Self {
        Self::new(DEFAULT_BUFFER_MAX_FRAMES, BUFFER_MAX_BYTES)
    }
}

impl FrameBuffer {
    pub fn new(max_frames: usize, max_bytes: usize) -> Self {
        Self {
            frames: Vec::new(),
            bytes: 0,
            max_frames: max_frames.max(1),
            max_bytes: max_bytes.max(1),
            elided: false,
        }
    }

    /// Append one frame's payload verbatim.
    ///
    /// Verbatim is load-bearing: refs are validated against this text, so a
    /// path or sha that gets reshaped on the way in can never be linked on the
    /// way out.
    pub fn push(&mut self, payload: &str) {
        self.bytes += payload.len();
        self.frames.push(payload.to_string());
        self.trim();
    }

    fn trim(&mut self) {
        while self.frames.len() > self.max_frames
            || (self.bytes > self.max_bytes && self.frames.len() > 1)
        {
            let dropped = self.frames.remove(0);
            self.bytes -= dropped.len();
            self.elided = true;
        }
    }

    /// True when nothing has arrived since the last wake.
    ///
    /// This is the whole of "an idle session never wakes": silence is not
    /// news, so a sitrep timer that fires over an empty buffer produces no
    /// wake at all rather than a wake the model then declines.
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn byte_len(&self) -> usize {
        self.bytes
    }

    pub fn was_elided(&self) -> bool {
        self.elided
    }

    /// The buffered frames as one block, newest last, with the elision marker
    /// on top when anything was dropped. This exact text is what refs are
    /// validated against.
    pub fn rendered(&self) -> String {
        let mut out = String::new();
        if self.elided {
            out.push_str(ELISION_MARKER);
            out.push('\n');
        }
        for frame in &self.frames {
            out.push_str(frame);
            out.push('\n');
        }
        out
    }

    /// Hand back the contents and reset, which is what a wake does before it
    /// runs the job off-thread.
    pub fn take(&mut self) -> FrameBuffer {
        let taken = FrameBuffer {
            frames: std::mem::take(&mut self.frames),
            bytes: self.bytes,
            max_frames: self.max_frames,
            max_bytes: self.max_bytes,
            elided: self.elided,
        };
        self.bytes = 0;
        self.elided = false;
        taken
    }

    /// Put a taken buffer's frames back at the front, for a wake whose job
    /// failed.
    ///
    /// An editorial "no post" and an infrastructure failure are different
    /// events: the first means the model read the work and judged it not worth
    /// telling, the second means nobody read it at all. Dropping the window on
    /// a failure would silently lose a stretch of real work, so it goes back —
    /// bounded by the same caps, so a persistently failing pool degrades to
    /// narrating only the most recent window instead of growing without limit.
    pub fn restore_front(&mut self, mut earlier: FrameBuffer) {
        if earlier.frames.is_empty() {
            return;
        }
        self.elided |= earlier.elided;
        earlier.frames.append(&mut self.frames);
        self.frames = earlier.frames;
        self.bytes = self.frames.iter().map(String::len).sum();
        self.trim();
    }
}

// MARK: - Composing a wake

/// One prior post, as the wake input renders it.
pub struct PriorPost {
    pub at_ms: i64,
    pub body: String,
}

/// Build the self-contained turn for one wake.
///
/// Every wake is independent: the reason, the session, the frames, and the
/// Reporter's own last few posts about this session all ride the message, so
/// any turn can be a worker's first. The prior posts are the entire dedup
/// mechanism — nothing compares text, the model simply sees what it already
/// said and declines to repeat itself.
pub fn compose_reporter_input(
    reason: WakeReason,
    session_id: &str,
    buffer: &FrameBuffer,
    prior_posts: &[PriorPost],
) -> String {
    let mut out = String::new();
    out.push_str("WAKE REASON: ");
    out.push_str(reason.as_str());
    out.push_str("\nSESSION: ");
    out.push_str(session_id);
    out.push_str("\n\n");

    out.push_str("YOUR RECENT POSTS ABOUT THIS SESSION:\n");
    if prior_posts.is_empty() {
        out.push_str("(none — this session has not been posted about yet)\n");
    } else {
        for post in prior_posts {
            out.push_str("- [");
            out.push_str(&post.at_ms.to_string());
            out.push_str("] ");
            out.push_str(&post.body);
            out.push('\n');
        }
    }

    out.push_str("\nSESSION ACTIVITY SINCE THEN:\n");
    out.push_str(&buffer.rendered());
    out
}

// MARK: - The envelope

/// What `reporter-post` answers with.
///
/// `deny_unknown_fields` throughout: the contract is narrow on purpose, and a
/// model that invented a field has drifted from it in a way worth noticing at
/// the parse rather than absorbing.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReporterEnvelope {
    /// `None` is a real answer — the model read the work and judged it not
    /// worth telling.
    pub post: Option<ReporterPost>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReporterPost {
    pub body: String,
    #[serde(default)]
    pub refs: Vec<GazetteRef>,
}

/// Read the envelope, or decide to post nothing.
///
/// A missing field, an unknown ref kind, malformed JSON, or no envelope at all
/// yields `None`, meaning no post. Silence is always the safe failure mode, and
/// a repaired or partially-salvaged post is worse than none: it would put words
/// in the channel that no one wrote on purpose.
///
/// **The envelope does not have to be the entire answer.** The instructions ask
/// for bare JSON, and the offline replay showed the model prefacing it with a
/// sentence of its own about four times in ten anyway — discarding those threw
/// away complete, well-formed envelopes at a rate that swamped every real
/// editorial silence and made the channel look far quieter than the model
/// intended. So the outermost `{…}` span is located and parsed, which is
/// finding the envelope rather than repairing one: what gets parsed is still
/// the model's own JSON, still whole, still strict about its fields. A preamble
/// is a wrapper; a broken envelope is a broken envelope, and that still yields
/// silence.
///
/// **One level of double-wrapping is unwrapped, for the same reason.** The model
/// sometimes answers `{"post": {"post": {…}}}` — the example in the
/// instructions shows a `post` key holding an object, and it occasionally
/// supplies both. The offline sweep produced it once in fifteen wakes, and what
/// was thrown away each time was a complete, well-formed post: body, refs, and
/// all. Peeling one layer is finding the envelope, not repairing it; nothing is
/// invented, no field is filled in, and the payload is still parsed strictly.
/// Exactly one layer, deliberately — an unbounded unwrap would start guessing
/// at structure rather than recognizing a known slip.
///
/// **The answer may hold more than one candidate, and the last one wins.** A
/// model that notices its own malformed envelope writes a corrected one after
/// it — verbatim, from a real run: a double-wrapped object, then "Let me fix
/// that JSON:", then the right envelope. Taking the outermost `{…}` span spans
/// both objects *and* the prose between them, which parses as nothing and threw
/// away an answer the model had already corrected. So every balanced top-level
/// object is a candidate and they are tried newest-first: a correction
/// supersedes what it corrects, and picking the last is reading the model's
/// final answer rather than reassembling one.
pub fn parse_envelope(raw: &str) -> Option<ReporterEnvelope> {
    // Newest-first: the model's last word on the matter is its answer.
    for span in json_object_spans(raw.trim()).into_iter().rev() {
        if let Some(envelope) = parse_one_envelope(span) {
            return Some(envelope);
        }
    }
    None
}

/// Parse one candidate span, tolerating a single `{"post": <envelope>}` wrap.
fn parse_one_envelope(span: &str) -> Option<ReporterEnvelope> {
    if let Ok(envelope) = serde_json::from_str::<ReporterEnvelope>(span) {
        return Some(envelope);
    }
    let value: serde_json::Value = serde_json::from_str(span).ok()?;
    let inner = value.as_object()?.get("post")?;
    if !inner.as_object()?.contains_key("post") {
        return None;
    }
    serde_json::from_value::<ReporterEnvelope>(inner.clone()).ok()
}

/// Every balanced top-level `{…}` in `text`, in the order they appear.
///
/// Braces inside string literals do not count, which is what keeps a post whose
/// body quotes JSON — or a Windows path ending in a backslash — from splitting
/// its own envelope in half.
/// The Operator reads its own envelopes with the same scanner: the models are
/// the same models, and they preface, double-wrap, and self-correct the same
/// ways whichever job they are answering.
pub(crate) fn json_object_spans(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => {
                if depth == 0 {
                    start = i;
                }
                depth += 1;
            }
            b'}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    spans.push(&text[start..=i]);
                }
            }
            _ => {}
        }
    }
    spans
}

/// Outcome of checking a post's refs against what the model was actually shown.
pub struct ValidatedRefs {
    pub kept: Vec<GazetteRef>,
    /// Dropped targets, for the log — a rising drop rate means the wording is
    /// drifting or the buffer is too small, and both are worth seeing.
    pub dropped: Vec<GazetteRef>,
}

/// Keep only the refs whose targets appear verbatim in the buffered context.
///
/// A ref exists to be clicked. A path or sha the model reconstructed, shortened,
/// or invented points nowhere, and a chip that goes nowhere is worse than an
/// absent one — so it is dropped and the body stands on its own.
///
/// `Session` refs are exempt: the bridge stamps the session id itself from the
/// wake, so it is ground truth rather than something the model recalled, and it
/// legitimately may not appear in any frame's text.
pub fn validate_refs(refs: Vec<GazetteRef>, buffered_context: &str) -> ValidatedRefs {
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for r in refs {
        let ok = matches!(r.kind, GazetteRefKind::Session)
            || (!r.target.is_empty() && buffered_context.contains(&r.target));
        if ok {
            kept.push(r);
        } else {
            dropped.push(r);
        }
    }
    ValidatedRefs { kept, dropped }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(session: &str, msg_type: &str, extra: &str) -> String {
        format!(r#"{{"tug_session_id":"{session}","type":"{msg_type}"{extra}}}"#)
    }

    // MARK: - The tap

    #[test]
    fn the_tap_forwards_only_allowlisted_spliced_frames() {
        let mut muted = HashSet::new();
        assert_eq!(
            forwardable_session(
                br#"{"tug_session_id":"s1","type":"tool_use","tool_name":"Bash"}"#,
                &mut muted,
            ),
            Some("s1".to_string()),
        );
        // Usage frames are kept: a threshold wake reads them, and a post that
        // can say what a stretch cost needs them.
        assert_eq!(
            forwardable_session(
                br#"{"tug_session_id":"s1","type":"turn_complete","usage":{"input_tokens":10}}"#,
                &mut muted,
            ),
            Some("s1".to_string()),
        );
        // Not narratable.
        assert_eq!(
            forwardable_session(
                br#"{"tug_session_id":"s1","type":"system_metadata"}"#,
                &mut muted,
            ),
            None,
        );
        // Unspliced (defensive — relay lines always carry the id).
        assert_eq!(
            forwardable_session(br#"{"type":"tool_use"}"#, &mut muted),
            None
        );
        // Malformed input never panics.
        assert_eq!(forwardable_session(b"not json at all", &mut muted), None);
    }

    /// A reconnect replays a session's whole history onto the wire. None of it
    /// is news, and narrating it would post a week of work as if it had just
    /// happened.
    #[test]
    fn replay_brackets_mute_one_session_without_blocking_others() {
        let mut muted = HashSet::new();
        assert_eq!(
            forwardable_session(frame("s1", "replay_started", "").as_bytes(), &mut muted),
            None,
            "the bracket itself is consumed, never forwarded",
        );
        assert!(muted.contains("s1"));
        assert_eq!(
            forwardable_session(frame("s1", "tool_result", "").as_bytes(), &mut muted),
            None,
            "replayed history is not narrated",
        );
        assert_eq!(
            forwardable_session(frame("s2", "tool_result", "").as_bytes(), &mut muted),
            Some("s2".to_string()),
            "a concurrent live session is unaffected",
        );
        assert_eq!(
            forwardable_session(frame("s1", "replay_complete", "").as_bytes(), &mut muted),
            None,
        );
        assert!(muted.is_empty());
        assert_eq!(
            forwardable_session(frame("s1", "tool_result", "").as_bytes(), &mut muted),
            Some("s1".to_string()),
            "live again once the bracket closes",
        );
    }

    // MARK: - The buffer

    /// Silence is not news. An idle session produces an empty buffer, and an
    /// empty buffer is what the bridge checks before arming or firing a sitrep.
    #[test]
    fn an_idle_session_leaves_an_empty_buffer() {
        let buffer = FrameBuffer::default();
        assert!(buffer.is_empty());
        assert!(!buffer.was_elided());
        assert_eq!(buffer.rendered(), "");
    }

    #[test]
    fn the_buffer_drops_oldest_past_its_frame_cap_and_says_so() {
        let mut buffer = FrameBuffer::new(3, 1_000_000);
        for i in 1..=5 {
            buffer.push(&format!("frame {i}"));
        }
        assert_eq!(buffer.len(), 3);
        let rendered = buffer.rendered();
        assert!(rendered.starts_with(ELISION_MARKER));
        assert!(!rendered.contains("frame 1"));
        assert!(rendered.contains("frame 5"));
    }

    #[test]
    fn the_buffer_drops_oldest_past_its_byte_cap() {
        let mut buffer = FrameBuffer::new(1_000, 20);
        buffer.push("aaaaaaaaaa");
        buffer.push("bbbbbbbbbb");
        buffer.push("cccccccccc");
        assert!(buffer.byte_len() <= 20);
        assert!(buffer.was_elided());
        assert_eq!(buffer.len(), 2);
        assert!(!buffer.rendered().contains("aaaaaaaaaa"), "oldest dropped");
        assert!(buffer.rendered().contains("cccccccccc"), "newest kept");

        // A single frame larger than the whole cap is kept rather than
        // dropped: an empty window would tell the model nothing at all.
        let mut fat = FrameBuffer::new(1_000, 4);
        fat.push("a frame far larger than the byte cap");
        assert_eq!(fat.len(), 1);
    }

    #[test]
    fn taking_the_buffer_empties_it_and_hands_over_the_contents() {
        let mut buffer = FrameBuffer::default();
        buffer.push("one");
        buffer.push("two");
        let taken = buffer.take();
        assert!(buffer.is_empty());
        assert_eq!(taken.len(), 2);
        assert!(taken.rendered().contains("two"));
    }

    /// A failed job must not silently cost a window of real work.
    #[test]
    fn a_restored_window_precedes_what_arrived_while_the_job_ran() {
        let mut buffer = FrameBuffer::default();
        buffer.push("older one");
        buffer.push("older two");
        let in_flight = buffer.take();

        buffer.push("arrived during the job");
        buffer.restore_front(in_flight);

        let rendered = buffer.rendered();
        let older = rendered.find("older one").expect("restored");
        let newer = rendered.find("arrived during the job").expect("kept");
        assert!(older < newer, "chronology survives the restore");
        assert_eq!(buffer.len(), 3);
    }

    #[test]
    fn a_restore_still_honors_the_caps() {
        let mut buffer = FrameBuffer::new(2, 1_000_000);
        buffer.push("a");
        buffer.push("b");
        let in_flight = buffer.take();
        buffer.push("c");
        buffer.push("d");
        buffer.restore_front(in_flight);
        assert_eq!(buffer.len(), 2, "a failing pool cannot grow the buffer");
        assert!(buffer.rendered().contains('d'));
    }

    // MARK: - Composition

    #[test]
    fn a_wake_input_carries_its_reason_session_and_prior_posts() {
        let mut buffer = FrameBuffer::default();
        buffer.push(r#"{"type":"assistant_text","text":"wiring the bridge"}"#);
        let priors = vec![PriorPost {
            at_ms: 1_700_000_000_000,
            body: "Started on the bridge".to_string(),
        }];
        let input = compose_reporter_input(WakeReason::SitrepTimer, "s1", &buffer, &priors);

        assert!(input.contains("WAKE REASON: sitrep-timer"));
        assert!(input.contains("SESSION: s1"));
        assert!(
            input.contains("Started on the bridge"),
            "dedup needs the priors"
        );
        assert!(input.contains("wiring the bridge"));
    }

    /// A first post for a session must say so rather than showing an empty
    /// heading, which reads as "you said nothing" instead of "there is no
    /// history here".
    #[test]
    fn a_first_wake_says_there_are_no_prior_posts() {
        let mut buffer = FrameBuffer::default();
        buffer.push("something happened");
        let input = compose_reporter_input(WakeReason::TurnEnd, "s1", &buffer, &[]);
        assert!(input.contains("(none"));
    }

    #[test]
    fn every_wake_reason_has_a_stable_wire_spelling() {
        assert_eq!(WakeReason::TurnEnd.as_str(), "turn-end");
        assert_eq!(WakeReason::SitrepTimer.as_str(), "sitrep-timer");
        assert_eq!(WakeReason::SessionEnd.as_str(), "session-end");
        assert_eq!(WakeReason::TokenThreshold.as_str(), "token-threshold");
    }

    // MARK: - The envelope

    #[test]
    fn an_explicit_null_post_is_a_real_answer() {
        let parsed = parse_envelope(r#"{"post": null}"#).expect("parses");
        assert!(parsed.post.is_none());
        // Whitespace around the JSON is normal model output.
        assert!(parse_envelope("  {\"post\": null}\n").is_some());
    }

    #[test]
    fn a_post_parses_with_its_refs() {
        let parsed = parse_envelope(
            r#"{"post": {"body": "Landed it", "refs": [{"kind": "commit", "target": "abc1234"}]}}"#,
        )
        .expect("parses");
        let post = parsed.post.expect("a post");
        assert_eq!(post.body, "Landed it");
        assert_eq!(post.refs.len(), 1);
        assert_eq!(post.refs[0].kind, GazetteRefKind::Commit);

        // refs may be omitted entirely.
        let bare = parse_envelope(r#"{"post": {"body": "Just prose"}}"#).expect("parses");
        assert!(bare.post.expect("a post").refs.is_empty());
    }

    /// Every malformed shape posts nothing. Silence is the safe failure mode;
    /// a salvaged half-post would put words in the channel nobody wrote.
    #[test]
    fn every_malformed_envelope_posts_nothing() {
        for raw in [
            "I think the session is going well.",
            r#"{"post": {"body": "no closing brace""#,
            r#"{"post": {}}"#,                               // body is required
            r#"{"post": {"body": "x", "urgency": "high"}}"#, // unknown field
            r#"{"posts": null}"#,                            // wrong key
            r#"{"post": {"body": "x", "refs": [{"kind": "wiki", "target": "y"}]}}"#, // unknown kind
            "",
        ] {
            assert!(
                parse_envelope(raw).is_none(),
                "should have posted nothing: {raw:?}",
            );
        }
    }

    /// The wrapping a model actually puts around its answer does not cost the
    /// post. Every shape here was observed in the offline replay, where a run
    /// reported 22 of 52 wakes as unparseable and every one of them held a
    /// complete envelope behind a sentence of preamble.
    #[test]
    fn an_envelope_wrapped_in_prose_or_a_fence_still_posts() {
        for raw in [
            "```json\n{\"post\": null}\n```",
            "Worth flagging, so:\n\n{\"post\": {\"body\": \"Vendored the light faces.\"}}",
            "{\"post\": {\"body\": \"x\"}}\n\nThat's the update.",
        ] {
            assert!(
                parse_envelope(raw).is_some(),
                "a wrapper is not a broken envelope: {raw:?}",
            );
        }
    }

    /// A post wrapped in a second `post` key is still that post. Observed once
    /// in fifteen wakes on a real session; the body and both refs were intact
    /// inside, and the whole thing was being discarded.
    #[test]
    fn a_double_wrapped_post_is_still_the_models_own_post() {
        let raw = r#"{"post": {"post": {"body": "Committed the fix.",
            "refs": [{"kind": "commit", "target": "e6a7de7b5"}]}}}"#;
        let post = parse_envelope(raw)
            .expect("one layer of double-wrapping is a known slip, not a broken envelope")
            .post
            .expect("the post survives the unwrap");
        assert_eq!(post.body, "Committed the fix.");
        assert_eq!(post.refs.len(), 1, "refs ride through the unwrap");

        // Strictness is not relaxed by the unwrap: the inner envelope is parsed
        // by the same rules, so a bad post nested twice is still no post.
        assert!(
            parse_envelope(r#"{"post": {"post": {"urgency": "high"}}}"#).is_none(),
            "the unwrap finds an envelope; it does not repair one",
        );
        // And unwrapping stops at one layer rather than hunting for structure.
        assert!(
            parse_envelope(r#"{"post": {"post": {"post": {"body": "x"}}}}"#).is_none(),
            "exactly one layer, deliberately",
        );
    }

    /// A model that catches its own bad envelope and rewrites it is answered
    /// by the rewrite. Verbatim from a real run — the double-wrap, the
    /// admission, then the correct envelope. Reading the outermost `{…}` span
    /// swallowed all three and posted nothing.
    #[test]
    fn a_self_corrected_envelope_is_read_as_corrected() {
        let raw = concat!(
            r#"{"post": {"post": {"body": "wrapped twice", "refs": []}}}"#,
            "\n\nLet me fix that JSON:\n\n",
            r#"{"post": {"body": "the corrected post", "refs": []}}"#,
        );
        let post = parse_envelope(raw)
            .expect("a correction is an answer, not a broken envelope")
            .post
            .expect("the corrected post survives");
        assert_eq!(
            post.body, "the corrected post",
            "the later envelope supersedes the one it corrects",
        );
    }

    /// A body that quotes JSON must not split its own envelope: the scanner
    /// counts braces, so it has to know when it is inside a string.
    #[test]
    fn braces_inside_a_body_do_not_end_the_envelope() {
        let raw = r#"{"post": {"body": "the model answered {\"post\": null} and stopped"}}"#;
        let post = parse_envelope(raw)
            .expect("a quoted brace is text, not structure")
            .post
            .expect("the post survives");
        assert!(post.body.contains(r#"{"post": null}"#));
    }

    // MARK: - Ref validation

    #[test]
    fn refs_the_model_was_never_shown_are_dropped() {
        let context = r#"{"type":"tool_use","command":"git show 4fe4d3fcd"}
{"type":"tool_result","output":"tugdeck/styles/themes/brio.css | 3 +-"}"#;
        let result = validate_refs(
            vec![
                GazetteRef {
                    kind: GazetteRefKind::Commit,
                    target: "4fe4d3fcd".to_string(),
                },
                GazetteRef {
                    kind: GazetteRefKind::File,
                    target: "tugdeck/styles/themes/brio.css".to_string(),
                },
                // Plausible, never shown — exactly the shape that would make a
                // dead chip.
                GazetteRef {
                    kind: GazetteRefKind::File,
                    target: "tugdeck/styles/themes/nocturne.css".to_string(),
                },
                // A shortened sha cannot be matched, so it cannot be linked.
                GazetteRef {
                    kind: GazetteRefKind::Commit,
                    target: "4fe4d3fcdaaaa".to_string(),
                },
            ],
            context,
        );
        assert_eq!(result.kept.len(), 2);
        assert_eq!(result.dropped.len(), 2);
        assert!(result.kept.iter().all(|r| context.contains(&r.target)));
    }

    /// The bridge stamps the session itself, so that ref is ground truth and
    /// need not appear in any frame's text.
    #[test]
    fn session_refs_are_exempt_from_the_verbatim_check() {
        let result = validate_refs(
            vec![GazetteRef {
                kind: GazetteRefKind::Session,
                target: "a-session-id-in-no-frame".to_string(),
            }],
            "frames that never name the session",
        );
        assert_eq!(result.kept.len(), 1);
        assert!(result.dropped.is_empty());
    }

    #[test]
    fn an_empty_target_is_dropped() {
        let result = validate_refs(
            vec![GazetteRef {
                kind: GazetteRefKind::File,
                target: String::new(),
            }],
            "anything",
        );
        assert!(result.kept.is_empty());
    }

    /// The end-to-end shape the bridge runs: parse what the model said, then
    /// keep only what it can prove.
    #[test]
    fn parse_then_validate_is_the_whole_post_path() {
        let mut buffer = FrameBuffer::default();
        buffer.push(r#"{"type":"tool_result","output":"HEAD is now 9a9051001"}"#);
        let raw = r#"{"post": {"body": "A commit landed.", "refs": [
            {"kind": "commit", "target": "9a9051001"},
            {"kind": "commit", "target": "deadbeef"}
        ]}}"#;
        let envelope = parse_envelope(raw).expect("parses");
        let post = envelope.post.expect("a post");
        let validated = validate_refs(post.refs, &buffer.rendered());
        assert_eq!(validated.kept.len(), 1);
        assert_eq!(validated.kept[0].target, "9a9051001");
        assert_eq!(validated.dropped.len(), 1);
    }
}
