//! Session overview — a one-line answer to "what is this session working on?",
//! written by the local model and broadcast on PULSE above the live beat.
//!
//! The beat line says what just happened; the overview says what the whole
//! session is *for*. It is composed from two things the session already has:
//! the user's own prompts (read from the claude JSONL) and the shape of its
//! recent tool use. Those go to the local model as one digest, and the sentence
//! that comes back is the line.
//!
//! **One-way, like the pulse bridge.** This module taps the CODE_OUTPUT
//! broadcast and produces exactly two outputs — a PULSE frame and tracing. It
//! reads no client state and answers no requests, so nothing downstream can
//! block a session on it.
//!
//! **It costs nothing when it can't run.** No model, the tenant switched off,
//! PULSE itself switched off, an unresolvable session identity, a refusal — all
//! of them end the tick silently, and the strip renders exactly as it does
//! today.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::feeds::draft_engine::SessionResolver;
use crate::feeds::pulse::forwardable_session;
use crate::local_model::SharedLocalModelState;
use tugcast_core::{FeedId, Frame};

/// Tool-use frames since the last emit that on their own justify a new
/// overview: enough has happened that the last sentence is probably stale.
const BURST_FRAMES: u32 = 8;

/// Elapsed time that justifies a new overview on its own, given any activity
/// at all — so a slow session still gets a refreshed line.
const IDLE_PERIOD: Duration = Duration::from_secs(30);

/// Minimum spacing between two overviews for one session, whatever the burst
/// says. Inference isn't free and the line isn't worth twitching.
const EMIT_FLOOR: Duration = Duration::from_secs(15);

/// Tool-use lines carried per session. Enough to show the shape of the work,
/// bounded so the digest can't grow without limit.
const MAX_TOOL_LINES: usize = 40;

/// User prompts fed into the digest, and their total character budget.
const MAX_PROMPTS: usize = 10;
const MAX_PROMPT_CHARS: usize = 1_500;

/// Characters of a tool's target kept in its digest line.
const MAX_TARGET_CHARS: usize = 60;

/// PulseLine doctrine: one line, and it has to fit the strip.
const MAX_HEADLINE_CHARS: usize = 110;

/// First and last back-off after the model refuses or fails.
const BACKOFF_START: Duration = Duration::from_secs(60);
const BACKOFF_MAX: Duration = Duration::from_secs(600);

/// Which of the three independent conditions currently allow a tick.
///
/// Separated from the loop so the truth table is a fact about the module rather
/// than an accident of control flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Gates {
    /// The `pulse-overview` tenant switch.
    pub tenant_enabled: bool,
    /// PULSE itself. The strip hides entirely when it's off, and there is no
    /// sense spending inference on a line nobody can see.
    pub pulse_enabled: bool,
    /// Whether the model is currently in refusal back-off.
    pub backing_off: bool,
}

impl Gates {
    pub fn allow(self) -> bool {
        self.tenant_enabled && self.pulse_enabled && !self.backing_off
    }
}

/// When an overview is worth emitting. Injectable so the loop can be exercised
/// without waiting out real seconds; production always uses [`Cadence::default`].
#[derive(Clone, Copy, Debug)]
pub struct Cadence {
    pub burst_frames: u32,
    pub idle_period: Duration,
    pub floor: Duration,
}

impl Default for Cadence {
    fn default() -> Self {
        Self {
            burst_frames: BURST_FRAMES,
            idle_period: IDLE_PERIOD,
            floor: EMIT_FLOOR,
        }
    }
}

impl Cadence {
    /// Whether enough has happened, long enough ago, to be worth a new
    /// sentence.
    ///
    /// `since_last_emit` runs from the session's first frame until its first
    /// overview, so the floor applies to the opening line too.
    pub fn fires(self, new_frames: u32, since_last_emit: Duration) -> bool {
        if new_frames == 0 {
            return false;
        }
        if since_last_emit < self.floor {
            return false;
        }
        new_frames >= self.burst_frames || since_last_emit >= self.idle_period
    }
}

/// One session's rolling picture of what it is doing.
struct SessionState {
    tools: VecDeque<String>,
    new_frames: u32,
    last_emit: Instant,
    last_digest: Option<String>,
    last_headline: Option<String>,
    beat: i64,
}

impl SessionState {
    fn new(now: Instant) -> Self {
        Self {
            tools: VecDeque::new(),
            new_frames: 0,
            last_emit: now,
            last_digest: None,
            last_headline: None,
            beat: 0,
        }
    }

    fn record(&mut self, line: String) {
        if self.tools.len() == MAX_TOOL_LINES {
            self.tools.pop_front();
        }
        self.tools.push_back(line);
        self.new_frames += 1;
    }
}

/// Refusal back-off, doubling from a minute to ten.
///
/// A model that just refused (or isn't there, or timed out) will almost
/// certainly refuse the next tick too, and every session in the process shares
/// one model — so the back-off is process-wide rather than per session.
struct BackOff {
    until: Option<Instant>,
    delay: Duration,
}

impl BackOff {
    fn new() -> Self {
        Self {
            until: None,
            delay: BACKOFF_START,
        }
    }

    fn active(&self, now: Instant) -> bool {
        self.until.is_some_and(|until| now < until)
    }

    fn fail(&mut self, now: Instant) {
        self.until = Some(now + self.delay);
        self.delay = next_backoff(self.delay);
    }

    fn succeed(&mut self) {
        self.until = None;
        self.delay = BACKOFF_START;
    }
}

/// Double the back-off, capped. Separate so the ladder is testable without a
/// clock.
pub fn next_backoff(current: Duration) -> Duration {
    let doubled = current.saturating_mul(2);
    if doubled > BACKOFF_MAX {
        BACKOFF_MAX
    } else {
        doubled
    }
}

/// A `tool_use` frame reduced to one digest line: the tool's name and what it
/// acted on. The target is whichever of the well-known input fields is present
/// — a path, a command, a pattern, a URL — clipped, because the digest is about
/// shape, not detail.
pub fn tool_line(payload: &serde_json::Value) -> Option<String> {
    let name = payload.get("name").and_then(|v| v.as_str())?;
    let target = payload
        .get("input")
        .and_then(|input| {
            [
                "command",
                "file_path",
                "path",
                "notebook_path",
                "pattern",
                "url",
            ]
            .iter()
            .find_map(|field| input.get(*field).and_then(|v| v.as_str()))
        })
        .map(|target| clip(target.trim(), MAX_TARGET_CHARS))
        .unwrap_or_default();
    if target.is_empty() {
        Some(name.to_string())
    } else {
        Some(format!("{name}({target})"))
    }
}

/// Compose the digest the model summarizes: what the user asked for, and what
/// the session has been doing about it.
///
/// Returns `None` when there is nothing to describe — with neither prompts nor
/// tool use there is no session to have an opinion about.
pub fn compose_digest(prompts: &[String], tools: &[String]) -> Option<String> {
    if prompts.is_empty() && tools.is_empty() {
        return None;
    }
    let mut out = String::new();
    if !prompts.is_empty() {
        out.push_str("What the user asked for:\n");
        for prompt in prompts {
            out.push_str("- ");
            out.push_str(&clip(prompt.trim(), 240));
            out.push('\n');
        }
    }
    if !tools.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("What the session has been doing:\n");
        for tool in tools {
            out.push_str("- ");
            out.push_str(tool);
            out.push('\n');
        }
    }
    Some(out)
}

/// Clip to a character budget, on a character boundary, with an ellipsis when
/// anything was dropped.
pub fn clip(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_none() {
        head
    } else {
        format!("{head}…")
    }
}

/// The PULSE frame carrying an overview. `kind` is what tells the deck to file
/// it above the beat line instead of in the beat stream; parsers that predate
/// the field ignore it.
pub fn overview_frame(session_id: &str, headline: &str, beat: i64, at_ms: i64) -> Frame {
    let body = serde_json::json!({
        "type": "pulse",
        "kind": "overview",
        "text": headline,
        "scopes": [session_id],
        "beat": beat,
        "at": at_ms,
    });
    Frame::new(FeedId::PULSE, serde_json::to_vec(&body).unwrap_or_default())
}

/// How the emitter resolves a `tug_session_id` into the claude JSONL that holds
/// the user's prompts. Both halves live in the supervisor and the ledger, which
/// a bare task can't reach, so they are handed in at wiring time.
/// Resolves a `tug_session_id` to its project dir, when known.
pub type ProjectDirResolver = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

#[derive(Clone)]
pub struct SessionIdentity {
    pub resolver: SessionResolver,
    pub project_dir: ProjectDirResolver,
    pub claude_projects_root: PathBuf,
}

impl SessionIdentity {
    /// The session's JSONL, or `None` when either half of the identity is
    /// unresolvable — which skips the tick silently.
    pub fn jsonl_path(&self, tug_session_id: &str) -> Option<PathBuf> {
        let claude_id = (self.resolver)(tug_session_id)?;
        let project_dir = (self.project_dir)(tug_session_id)?;
        Some(
            self.claude_projects_root
                .join(crate::session_ledger::encode_claude_project_name(
                    &project_dir,
                ))
                .join(format!("{claude_id}.jsonl")),
        )
    }
}

pub struct SessionOverviewConfig {
    /// The shared CODE_OUTPUT broadcast — subscribed inside the task.
    pub code_tx: broadcast::Sender<Frame>,
    /// The PULSE broadcast to publish overviews on.
    pub pulse_tx: broadcast::Sender<Frame>,
    /// The `pulse-overview` tenant switch, read per tick so a flip is live.
    pub tenant_enabled: Arc<dyn Fn() -> bool + Send + Sync>,
    /// PULSE's own switch, same closure shape the bridge uses.
    pub pulse_enabled: Arc<dyn Fn() -> bool + Send + Sync>,
    pub local_model: SharedLocalModelState,
    pub identity: SessionIdentity,
    pub cadence: Cadence,
}

/// Run the emitter until cancelled.
pub async fn session_overview_task(config: SessionOverviewConfig, cancel: CancellationToken) {
    let mut code_rx = config.code_tx.subscribe();
    let mut sessions: HashMap<String, SessionState> = HashMap::new();
    // Sessions inside a replay bracket: their frames are history being
    // re-emitted, not live work. Maintained exactly as the pulse bridge does.
    let mut muted: HashSet<String> = HashSet::new();
    let mut backoff = BackOff::new();

    loop {
        let frame = tokio::select! {
            _ = cancel.cancelled() => {
                info!("session overview: cancelled");
                return;
            }
            recv = code_rx.recv() => match recv {
                Ok(frame) => frame,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    // The digest is about shape, not completeness — a gap in
                    // tool lines never justifies backpressuring the session.
                    warn!(skipped, "session overview: code broadcast lagged");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    info!("session overview: code broadcast closed");
                    return;
                }
            },
        };

        let Some(session_id) = forwardable_session(&frame.payload, &mut muted) else {
            continue;
        };
        let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&frame.payload) else {
            continue;
        };
        if payload.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
            continue;
        }
        let Some(line) = tool_line(&payload) else {
            continue;
        };

        let now = Instant::now();
        let state = sessions
            .entry(session_id.clone())
            .or_insert_with(|| SessionState::new(now));
        state.record(line);

        let gates = Gates {
            tenant_enabled: (config.tenant_enabled)(),
            pulse_enabled: (config.pulse_enabled)(),
            backing_off: backoff.active(now),
        };
        if !gates.allow() {
            continue;
        }
        if !config
            .cadence
            .fires(state.new_frames, now.duration_since(state.last_emit))
        {
            continue;
        }

        // From here the tick is committed: reset the counters whatever the
        // outcome, so a failing model can't make every subsequent frame retry.
        state.new_frames = 0;
        state.last_emit = now;

        let Some(jsonl) = config.identity.jsonl_path(&session_id) else {
            continue;
        };
        let prompts =
            crate::scribe::session_prompts_since(&jsonl, 0, MAX_PROMPTS, MAX_PROMPT_CHARS);
        let tools: Vec<String> = state.tools.iter().cloned().collect();
        let Some(digest) = compose_digest(&prompts, &tools) else {
            continue;
        };
        if state.last_digest.as_deref() == Some(digest.as_str()) {
            continue;
        }
        state.last_digest = Some(digest.clone());

        let Some(requester) = config.local_model.requester() else {
            backoff.fail(now);
            continue;
        };
        let headline = match requester.summarize(digest).await {
            Ok(text) => {
                backoff.succeed();
                clip(text.trim(), MAX_HEADLINE_CHARS)
            }
            Err(error) => {
                warn!(%error, session = %session_id, "session overview: summarize failed");
                backoff.fail(Instant::now());
                continue;
            }
        };
        if headline.is_empty() {
            continue;
        }

        // Re-borrow: the summarize above held an await across the map.
        let Some(state) = sessions.get_mut(&session_id) else {
            continue;
        };
        if state.last_headline.as_deref() == Some(headline.as_str()) {
            continue;
        }
        state.beat += 1;
        state.last_headline = Some(headline.clone());
        let frame = overview_frame(
            &session_id,
            &headline,
            state.beat,
            crate::session_ledger::now_millis(),
        );
        let _ = config.pulse_tx.send(frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_truth_table() {
        let gates = |tenant, pulse, backing| {
            Gates {
                tenant_enabled: tenant,
                pulse_enabled: pulse,
                backing_off: backing,
            }
            .allow()
        };
        assert!(gates(true, true, false));
        assert!(!gates(false, true, false));
        assert!(!gates(true, false, false));
        assert!(!gates(true, true, true));
        assert!(!gates(false, false, true));
    }

    #[test]
    fn cadence_needs_activity() {
        assert!(!Cadence::default().fires(0, Duration::from_secs(3600)));
    }

    #[test]
    fn cadence_holds_the_floor_even_against_a_burst() {
        let c = Cadence::default();
        assert!(!c.fires(BURST_FRAMES, EMIT_FLOOR - Duration::from_secs(1)));
        assert!(c.fires(BURST_FRAMES, EMIT_FLOOR));
    }

    #[test]
    fn cadence_fires_on_a_burst_before_the_idle_period() {
        let c = Cadence::default();
        assert!(c.fires(BURST_FRAMES, Duration::from_secs(20)));
        assert!(!c.fires(BURST_FRAMES - 1, Duration::from_secs(20)));
    }

    #[test]
    fn cadence_fires_on_elapsed_time_with_a_single_frame() {
        let c = Cadence::default();
        assert!(c.fires(1, IDLE_PERIOD));
        assert!(!c.fires(1, IDLE_PERIOD - Duration::from_secs(1)));
    }

    #[test]
    fn backoff_doubles_to_a_ten_minute_ceiling() {
        let mut delay = BACKOFF_START;
        let mut seen = vec![delay];
        for _ in 0..8 {
            delay = next_backoff(delay);
            seen.push(delay);
        }
        assert_eq!(seen[0], Duration::from_secs(60));
        assert_eq!(seen[1], Duration::from_secs(120));
        assert_eq!(seen[2], Duration::from_secs(240));
        assert_eq!(seen[3], Duration::from_secs(480));
        assert_eq!(*seen.last().unwrap(), BACKOFF_MAX);
    }

    #[test]
    fn backoff_resets_on_success() {
        let now = Instant::now();
        let mut backoff = BackOff::new();
        backoff.fail(now);
        assert!(backoff.active(now));
        assert_eq!(backoff.delay, Duration::from_secs(120));
        backoff.succeed();
        assert!(!backoff.active(now));
        assert_eq!(backoff.delay, BACKOFF_START);
    }

    #[test]
    fn tool_lines_name_what_was_acted_on() {
        let bash = serde_json::json!({
            "name": "Bash",
            "input": { "command": "cargo nextest run", "description": "run tests" },
        });
        assert_eq!(tool_line(&bash).unwrap(), "Bash(cargo nextest run)");

        let read = serde_json::json!({
            "name": "Read",
            "input": { "file_path": "/tmp/main.rs" },
        });
        assert_eq!(tool_line(&read).unwrap(), "Read(/tmp/main.rs)");
    }

    #[test]
    fn a_tool_with_no_recognizable_target_is_still_worth_a_line() {
        let value = serde_json::json!({ "name": "TodoWrite", "input": { "todos": [] } });
        assert_eq!(tool_line(&value).unwrap(), "TodoWrite");
    }

    #[test]
    fn a_long_target_is_clipped() {
        let value = serde_json::json!({
            "name": "Bash",
            "input": { "command": "x".repeat(200) },
        });
        let line = tool_line(&value).unwrap();
        assert!(line.chars().count() <= MAX_TARGET_CHARS + "Bash()…".len());
        assert!(line.ends_with("…)"));
    }

    #[test]
    fn a_payload_without_a_name_yields_nothing() {
        assert!(tool_line(&serde_json::json!({ "input": {} })).is_none());
    }

    #[test]
    fn a_digest_carries_both_halves() {
        let digest = compose_digest(
            &["make the watch loop resilient".to_string()],
            &[
                "Bash(cargo build)".to_string(),
                "Edit(watch.rs)".to_string(),
            ],
        )
        .expect("both halves present");
        assert!(digest.contains("make the watch loop resilient"));
        assert!(digest.contains("Bash(cargo build)"));
        assert!(digest.contains("Edit(watch.rs)"));
    }

    #[test]
    fn a_digest_with_only_tool_use_is_still_a_digest() {
        let digest = compose_digest(&[], &["Bash(cargo build)".to_string()]).unwrap();
        assert!(digest.contains("Bash(cargo build)"));
        assert!(!digest.contains("What the user asked for"));
    }

    #[test]
    fn nothing_to_describe_yields_no_digest() {
        assert!(compose_digest(&[], &[]).is_none());
    }

    #[test]
    fn clip_only_marks_text_it_actually_shortened() {
        assert_eq!(clip("short", 10), "short");
        assert_eq!(clip("exactly-10", 10), "exactly-10");
        assert_eq!(clip("more than ten", 10), "more than …");
    }

    #[test]
    fn clip_respects_character_boundaries() {
        // Four multi-byte characters: a naive byte slice here would panic.
        assert_eq!(clip("日本語です", 3), "日本語…");
    }

    #[test]
    fn the_accumulator_keeps_only_the_recent_tail() {
        let mut state = SessionState::new(Instant::now());
        for i in 0..(MAX_TOOL_LINES + 5) {
            state.record(format!("Bash(step {i})"));
        }
        assert_eq!(state.tools.len(), MAX_TOOL_LINES);
        assert_eq!(state.tools.front().unwrap(), "Bash(step 5)");
        assert_eq!(state.new_frames as usize, MAX_TOOL_LINES + 5);
    }

    #[test]
    fn the_frame_is_a_scoped_overview_pulse_line() {
        let frame = overview_frame("sess-1", "Wiring the watch loop.", 3, 1_700_000_000_000);
        assert_eq!(frame.feed_id, FeedId::PULSE);
        let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(body["type"], "pulse");
        assert_eq!(body["kind"], "overview");
        assert_eq!(body["text"], "Wiring the watch loop.");
        assert_eq!(body["scopes"], serde_json::json!(["sess-1"]));
        assert_eq!(body["beat"], 3);
        assert_eq!(body["at"], 1_700_000_000_000i64);
    }

    #[test]
    fn replay_bracketed_frames_are_muted_like_the_pulse_bridge() {
        let mut muted = HashSet::new();
        let tool_use = br#"{"tug_session_id":"s1","type":"tool_use","name":"Bash"}"#;
        assert_eq!(
            forwardable_session(tool_use, &mut muted),
            Some("s1".to_string())
        );
        forwardable_session(
            br#"{"tug_session_id":"s1","type":"replay_started"}"#,
            &mut muted,
        );
        assert_eq!(forwardable_session(tool_use, &mut muted), None);
        forwardable_session(
            br#"{"tug_session_id":"s1","type":"replay_complete"}"#,
            &mut muted,
        );
        assert_eq!(
            forwardable_session(tool_use, &mut muted),
            Some("s1".to_string())
        );
    }

    #[test]
    fn an_unresolvable_identity_yields_no_path() {
        let none: SessionResolver = Arc::new(|_| None);
        let identity = SessionIdentity {
            resolver: none,
            project_dir: Arc::new(|_| Some("/tmp/project".to_string())),
            claude_projects_root: PathBuf::from("/tmp/projects"),
        };
        assert!(identity.jsonl_path("s1").is_none());

        let identity = SessionIdentity {
            resolver: Arc::new(|_| Some("claude-1".to_string())),
            project_dir: Arc::new(|_| None),
            claude_projects_root: PathBuf::from("/tmp/projects"),
        };
        assert!(identity.jsonl_path("s1").is_none());
    }

    #[test]
    fn a_resolvable_identity_names_the_session_jsonl() {
        let identity = SessionIdentity {
            resolver: Arc::new(|_| Some("claude-1".to_string())),
            project_dir: Arc::new(|_| Some("/tmp/project".to_string())),
            claude_projects_root: PathBuf::from("/tmp/projects"),
        };
        let path = identity.jsonl_path("s1").unwrap();
        assert!(path.ends_with("claude-1.jsonl"));
        assert!(path.starts_with("/tmp/projects"));
    }

    // -----------------------------------------------------------------------
    // The loop, end to end
    // -----------------------------------------------------------------------

    use crate::local_model::{LocalModelRequester, LocalModelState};
    use std::io::Write;

    /// Stand up a local-model host that answers every summarize with `answer`
    /// (or refuses when it is `None`), wired through the real requester and the
    /// real reply-routing path.
    fn fake_host(
        state: &SharedLocalModelState,
        answer: Option<&'static str>,
    ) -> tokio::sync::mpsc::Receiver<()> {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(8);
        let (seen_tx, seen_rx) = tokio::sync::mpsc::channel::<()>(8);
        let requester = LocalModelRequester::new(tx);
        state.set_requester(Arc::clone(&requester));
        tokio::spawn(async move {
            while let Some(line) = rx.recv().await {
                let body: serde_json::Value = serde_json::from_str(&line).unwrap();
                let id = body["id"].as_str().unwrap().to_string();
                let reply = match answer {
                    Some(text) => crate::local_model::LocalModelReply {
                        ok: true,
                        text: Some(text.to_string()),
                        error: None,
                    },
                    None => crate::local_model::LocalModelReply {
                        ok: false,
                        text: None,
                        error: Some("guardrail refusal".to_string()),
                    },
                };
                requester.resolve(&id, reply);
                let _ = seen_tx.send(()).await;
            }
        });
        seen_rx
    }

    /// A claude JSONL holding one user prompt, at the path the identity below
    /// resolves to.
    fn seed_jsonl(root: &std::path::Path, project_dir: &str, claude_id: &str, prompt: &str) {
        let dir = root.join(crate::session_ledger::encode_claude_project_name(
            project_dir,
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut file = std::fs::File::create(dir.join(format!("{claude_id}.jsonl"))).unwrap();
        let line = serde_json::json!({
            "type": "user",
            "timestamp": "2026-07-27T00:00:00.000Z",
            "message": { "role": "user", "content": prompt },
        });
        writeln!(file, "{line}").unwrap();
    }

    fn tool_use_frame(session: &str, command: &str) -> Frame {
        let body = serde_json::json!({
            "tug_session_id": session,
            "type": "tool_use",
            "name": "Bash",
            "input": { "command": command },
        });
        Frame::new(FeedId::CODE_OUTPUT, serde_json::to_vec(&body).unwrap())
    }

    struct Harness {
        code_tx: broadcast::Sender<Frame>,
        pulse_rx: broadcast::Receiver<Frame>,
        cancel: CancellationToken,
        _tmp: PathBuf,
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            self.cancel.cancel();
            let _ = std::fs::remove_dir_all(&self._tmp);
        }
    }

    fn start(
        answer: Option<&'static str>,
        tenant_on: bool,
        pulse_on: bool,
        with_model: bool,
    ) -> Harness {
        let tmp = std::env::temp_dir().join(format!(
            "tugcast-overview-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let projects = tmp.join("projects");
        std::fs::create_dir_all(&projects).unwrap();
        seed_jsonl(
            &projects,
            "/tmp/project",
            "claude-1",
            "make the watch loop resilient",
        );

        let (code_tx, _) = broadcast::channel(64);
        let (pulse_tx, pulse_rx) = broadcast::channel(64);
        let state = LocalModelState::new(tmp.join("models"), "http://127.0.0.1:1".to_string());
        if with_model {
            fake_host(&state, answer);
        }
        let cancel = CancellationToken::new();
        let config = SessionOverviewConfig {
            code_tx: code_tx.clone(),
            pulse_tx,
            tenant_enabled: Arc::new(move || tenant_on),
            pulse_enabled: Arc::new(move || pulse_on),
            local_model: state,
            identity: SessionIdentity {
                resolver: Arc::new(|_| Some("claude-1".to_string())),
                project_dir: Arc::new(|_| Some("/tmp/project".to_string())),
                claude_projects_root: projects,
            },
            // Zero floor and a one-frame burst: the cadence itself is covered by
            // the pure tests above; this harness is about the loop.
            cadence: Cadence {
                burst_frames: 1,
                idle_period: Duration::ZERO,
                floor: Duration::ZERO,
            },
        };
        let task_cancel = cancel.clone();
        tokio::spawn(async move { session_overview_task(config, task_cancel).await });
        Harness {
            code_tx,
            pulse_rx,
            cancel,
            _tmp: tmp,
        }
    }

    /// Await one PULSE frame, or `None` if none arrives promptly.
    async fn next_overview(rx: &mut broadcast::Receiver<Frame>) -> Option<serde_json::Value> {
        match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
            Ok(Ok(frame)) => serde_json::from_slice(&frame.payload).ok(),
            _ => None,
        }
    }

    #[tokio::test]
    async fn a_tool_use_frame_becomes_an_overview_line() {
        let mut h = start(Some("Hardening the watch loop."), true, true, true);
        // The subscription is created inside the task; give it a beat to exist
        // before the first send, or the frame is broadcast into an empty room.
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();

        let body = next_overview(&mut h.pulse_rx).await.expect("an overview");
        assert_eq!(body["type"], "pulse");
        assert_eq!(body["kind"], "overview");
        assert_eq!(body["text"], "Hardening the watch loop.");
        assert_eq!(body["scopes"], serde_json::json!(["s1"]));
        assert_eq!(body["beat"], 1);
    }

    #[tokio::test]
    async fn the_tenant_switch_silences_it() {
        let mut h = start(Some("Hardening the watch loop."), false, true, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn pulse_being_off_silences_it() {
        let mut h = start(Some("Hardening the watch loop."), true, false, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn no_model_host_is_silence_not_an_error() {
        let mut h = start(None, true, true, false);
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn a_refusal_emits_nothing_and_backs_off() {
        let mut h = start(None, true, true, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
        // Back-off is now armed for a minute, so a second frame is silent too
        // rather than hammering a model that just said no.
        h.code_tx.send(tool_use_frame("s1", "cargo test")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn an_unchanged_headline_is_not_republished() {
        let mut h = start(Some("Hardening the watch loop."), true, true, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_some());
        // A different digest (new tool line) but the same sentence back from
        // the model: the strip already says it, so nothing is sent.
        h.code_tx.send(tool_use_frame("s1", "cargo test")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn replayed_frames_never_produce_an_overview() {
        let mut h = start(Some("Hardening the watch loop."), true, true, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let replay_started = serde_json::json!({
            "tug_session_id": "s1", "type": "replay_started",
        });
        h.code_tx
            .send(Frame::new(
                FeedId::CODE_OUTPUT,
                serde_json::to_vec(&replay_started).unwrap(),
            ))
            .unwrap();
        h.code_tx.send(tool_use_frame("s1", "cargo build")).unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }

    #[tokio::test]
    async fn an_unresolvable_session_skips_the_tick_silently() {
        let mut h = start(Some("Hardening the watch loop."), true, true, true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        // The identity closures answer for any id, but the JSONL only exists
        // for the seeded project — a session whose file is missing yields no
        // prompts, and with tool use present the digest still composes, so the
        // meaningful "unresolvable" case is the frame with no session id.
        let anonymous = serde_json::json!({ "type": "tool_use", "name": "Bash" });
        h.code_tx
            .send(Frame::new(
                FeedId::CODE_OUTPUT,
                serde_json::to_vec(&anonymous).unwrap(),
            ))
            .unwrap();
        assert!(next_overview(&mut h.pulse_rx).await.is_none());
    }
}
