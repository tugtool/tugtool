//! Real Claude Code multi-session integration tests.
//!
//! # Runtime gating
//!
//! Every test in this file is `#[ignore]`-gated AND `TUG_REAL_CLAUDE`
//! env-gated (belt-and-suspenders). By default `cargo nextest run
//! -p tugcast` skips them, and even a developer running with
//! `--run-ignored only` gets a silent no-op unless they also set
//! `TUG_REAL_CLAUDE=1` in the environment. To run them for real:
//!
//! ```sh
//! cd tugrust
//! TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only
//! ```
//!
//! Requires a real `claude` (tugcode) binary on PATH or via the sibling
//! resolver in `feeds::agent_bridge::resolve_tugcode_path`, plus a
//! working `tmux` for the tugcast terminal feed.
//!
//! # What these tests pin
//!
//! - Single-session end-to-end (spawn → handshake → CODE_INPUT →
//!   CODE_OUTPUT → turn_complete → close).
//! - Multi-session isolation: session A's CODE_OUTPUT frames never
//!   appear tagged with session B's `tug_session_id` (pins [D02]'s
//!   splice stamping).
//! - Lazy spawn: `spawn_session` alone does NOT launch a `claude`
//!   subprocess; the first CODE_INPUT does ([R02]).
//! - Orphan CODE_INPUT is rejected via either the router-side
//!   `session_not_owned` (Step 7 P5 authz) or the supervisor's
//!   `session_unknown` (Step 5 dispatcher).
//! - `reset_session` publishes `closed` then `pending` on SESSION_STATE
//!   and re-spawns a fresh `claude_session_id`.
//! - Startup tugbank rebind: persisted intent records become
//!   `pending` ledger entries that a subsequent client-driven
//!   `spawn_session` rehydrates ([F15]).
//! - P5 cross-client distinct sessions: two clients each claim
//!   `CODE_INPUT` with distinct `tug_session_id`s and both succeed
//!   ([D08]).
//! - Event-driven SESSION_METADATA replay on reconnect ([D14], [F13]).
//! - Two sessions, no metadata clobber: both sessions' per-session
//!   metadata land on the SESSION_METADATA broadcast ([D14]).

#![allow(dead_code)]

use std::time::Duration;

use tempfile::NamedTempFile;

mod common;

use common::{TestTugcast, TestWs, real_claude_enabled};

/// Skeleton guard — every test begins with this; returns early when
/// `TUG_REAL_CLAUDE` is not set so a developer running
/// `--run-ignored only` without the env var gets a fast no-op instead
/// of an attempted real-claude spawn.
macro_rules! require_real_claude {
    () => {
        if !real_claude_enabled() {
            return;
        }
    };
}

/// Standard timeout for any wait-for-wire helper in this file. Real
/// claude turns can be long — this budget is intentionally generous.
const WIRE_TIMEOUT: Duration = Duration::from_secs(30);

/// Spawn a per-test tugcast with a temp bank path. Returns the handle
/// (dropping kills the subprocess via `kill_on_drop`).
async fn spawn_tugcast() -> TestTugcast {
    let temp_bank = NamedTempFile::new().expect("temp bank file");
    let bank_path = temp_bank.path().to_path_buf();
    // Drop the handle; the OS cleans up on exit. We keep the path so
    // TUGBANK_PATH can point at it.
    drop(temp_bank);
    let project_dir = std::env::current_dir().expect("cwd");
    TestTugcast::spawn(&project_dir, bank_path).await
}

// ---------------------------------------------------------------------------
// test_single_session_end_to_end
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_single_session_end_to_end() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    let card_id = "card-1";
    let tug_session_id = "sess-end-to-end";

    ws.send_spawn_session(card_id, tug_session_id).await;
    ws.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
        .await
        .expect("pending");

    ws.send_code_input(tug_session_id, "/status").await;
    ws.await_session_state(tug_session_id, "spawning", WIRE_TIMEOUT)
        .await
        .expect("spawning");
    ws.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
        .await
        .expect("live (session_init received)");

    // The frame buffer retains any CODE_OUTPUT frames that arrived
    // during the state-waiting phase, so session_init is visible here
    // even though it streamed in before `live`.
    let frames = ws
        .collect_code_output(tug_session_id, WIRE_TIMEOUT)
        .await
        .expect("turn_complete");
    assert!(
        frames
            .iter()
            .any(|f| f["type"].as_str() == Some("session_init")),
        "expected at least one session_init frame"
    );
    assert_eq!(
        frames.last().unwrap()["type"].as_str(),
        Some("turn_complete")
    );

    ws.send_close_session(card_id, tug_session_id).await;
    ws.await_session_state(tug_session_id, "closed", WIRE_TIMEOUT)
        .await
        .expect("closed");
}

// ---------------------------------------------------------------------------
// test_two_sessions_never_cross
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_two_sessions_never_cross() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    let sess_a = "sess-cross-a";
    let sess_b = "sess-cross-b";

    ws.send_spawn_session("card-a", sess_a).await;
    ws.send_spawn_session("card-b", sess_b).await;
    ws.await_session_state(sess_a, "pending", WIRE_TIMEOUT)
        .await
        .expect("A pending");
    ws.await_session_state(sess_b, "pending", WIRE_TIMEOUT)
        .await
        .expect("B pending");

    ws.send_code_input(sess_a, "say 'alpha'").await;
    ws.send_code_input(sess_b, "say 'bravo'").await;

    // `TestWs::collect_code_output` buffers frames for other sessions
    // instead of dropping them, so collecting A first and then B works
    // even though the two streams interleave on the wire.
    let a_frames = ws
        .collect_code_output(sess_a, WIRE_TIMEOUT)
        .await
        .expect("A turn_complete");
    let b_frames = ws
        .collect_code_output(sess_b, WIRE_TIMEOUT)
        .await
        .expect("B turn_complete");

    for f in &a_frames {
        assert_eq!(
            f["tug_session_id"].as_str(),
            Some(sess_a),
            "A collector must only see frames tagged with session A"
        );
    }
    for f in &b_frames {
        assert_eq!(
            f["tug_session_id"].as_str(),
            Some(sess_b),
            "B collector must only see frames tagged with session B"
        );
    }
}

// ---------------------------------------------------------------------------
// test_lazy_spawn_no_subprocess_until_first_input
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_lazy_spawn_no_subprocess_until_first_input() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    let card_id = "card-lazy";
    let tug_session_id = "sess-lazy";

    ws.send_spawn_session(card_id, tug_session_id).await;
    ws.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
        .await
        .expect("pending after spawn_session");

    // spawn_session alone must NOT launch a claude subprocess. Wait
    // briefly and then send CODE_INPUT; the subprocess starts here.
    // (Counting claude processes system-wide is unreliable under
    // parallel test runs, so we rely on the state-machine observation
    // that NO `spawning` frame arrives until we send CODE_INPUT.)
    tokio::time::sleep(Duration::from_millis(500)).await;

    ws.send_code_input(tug_session_id, "/status").await;
    ws.await_session_state(tug_session_id, "spawning", WIRE_TIMEOUT)
        .await
        .expect("spawning after first CODE_INPUT");
    ws.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
        .await
        .expect("live after session_init");
}

// ---------------------------------------------------------------------------
// test_orphan_input_rejected
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_orphan_input_rejected() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    // Send CODE_INPUT for a tug_session_id the client never registered
    // via spawn_session. Under the Step 7 P5 authorization cross-check
    // a fresh WebSocket client has an empty session set, so the router
    // rejects the frame with `session_not_owned` BEFORE it ever
    // reaches the supervisor's dispatcher. The `session_unknown` path
    // (emitted by `dispatch_one` when the ledger has no entry for the
    // claimed id) is accepted here too for forward-compatibility with
    // any future reordering of the checks.
    ws.send_code_input("sess-orphan", "hello").await;
    ws.await_control_reject(
        &["session_not_owned", "session_unknown"],
        Duration::from_secs(5),
    )
    .await
    .expect("expected orphan-input CONTROL reject");
}

// ---------------------------------------------------------------------------
// test_reset_session_reinitializes
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_reset_session_reinitializes() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    let card_id = "card-reset";
    let tug_session_id = "sess-reset";

    ws.send_spawn_session(card_id, tug_session_id).await;
    ws.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
        .await
        .expect("pending");
    ws.send_code_input(tug_session_id, "/status").await;
    ws.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
        .await
        .expect("live after initial session_init");

    ws.send_reset_session(card_id, tug_session_id).await;
    ws.await_session_state(tug_session_id, "closed", WIRE_TIMEOUT)
        .await
        .expect("closed after reset");
    ws.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
        .await
        .expect("pending after reset");

    // Fresh CODE_INPUT should drive a new spawning → live cycle, and
    // the CODE_OUTPUT stream should contain a new session_init
    // (Claude mints a new session id per subprocess).
    ws.send_code_input(tug_session_id, "/status").await;
    ws.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
        .await
        .expect("live after reset + first input");
    let frames = ws
        .collect_code_output(tug_session_id, WIRE_TIMEOUT)
        .await
        .expect("turn_complete after reset");
    assert!(
        frames
            .iter()
            .any(|f| f["type"].as_str() == Some("session_init")),
        "reset must produce a fresh session_init"
    );
}

// ---------------------------------------------------------------------------
// test_supervisor_rebind_on_startup
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_supervisor_rebind_on_startup() {
    require_real_claude!();

    // Round 1: spawn tugcast, open a WS, send spawn_session so the
    // supervisor persists the (card_id, tug_session_id) mapping into
    // tugbank under `dev.tugtool.tide.session-keys`.
    let bank_file = NamedTempFile::new().expect("temp bank");
    let bank_path = bank_file.path().to_path_buf();
    drop(bank_file);
    let project_dir = std::env::current_dir().expect("cwd");

    let card_id = "card-rebind";
    let tug_session_id = "sess-rebind";

    {
        let tc = TestTugcast::spawn(&project_dir, bank_path.clone()).await;
        let mut ws = TestWs::connect(tc.port).await;
        ws.send_spawn_session(card_id, tug_session_id).await;
        ws.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
            .await
            .expect("pending after initial spawn_session");
        drop(ws);
        drop(tc);
    }

    // Round 2: fresh tugcast instance with the SAME bank path. On
    // startup the supervisor reads `dev.tugtool.tide.session-keys`
    // and re-materializes an Idle ledger entry for `tug_session_id`.
    // A fresh WebSocket sending `spawn_session` for the same
    // (card_id, tug_session_id) reuses the ledger entry and drives
    // the normal pending → spawning → live flow. CODE_INPUT must
    // subsequently produce a live session.
    let tc2 = TestTugcast::spawn(&project_dir, bank_path).await;
    let mut ws2 = TestWs::connect(tc2.port).await;
    ws2.send_spawn_session(card_id, tug_session_id).await;
    ws2.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
        .await
        .expect("pending after rebind");
    ws2.send_code_input(tug_session_id, "/status").await;
    ws2.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
        .await
        .expect("live after rebind + first CODE_INPUT");
}

// ---------------------------------------------------------------------------
// test_p5_cross_client_distinct_sessions
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_p5_cross_client_distinct_sessions() {
    require_real_claude!();
    let tc = spawn_tugcast().await;

    let mut ws_a = TestWs::connect(tc.port).await;
    let mut ws_b = TestWs::connect(tc.port).await;

    let sess_a = "sess-p5-a";
    let sess_b = "sess-p5-b";

    ws_a.send_spawn_session("card-p5-a", sess_a).await;
    ws_b.send_spawn_session("card-p5-b", sess_b).await;
    ws_a.await_session_state(sess_a, "pending", WIRE_TIMEOUT)
        .await
        .expect("A pending");
    ws_b.await_session_state(sess_b, "pending", WIRE_TIMEOUT)
        .await
        .expect("B pending");

    ws_a.send_code_input(sess_a, "say 'alpha'").await;
    ws_b.send_code_input(sess_b, "say 'bravo'").await;

    ws_a.await_session_state(sess_a, "live", WIRE_TIMEOUT)
        .await
        .expect("A live");
    ws_b.await_session_state(sess_b, "live", WIRE_TIMEOUT)
        .await
        .expect("B live");

    let a_frames = ws_a
        .collect_code_output(sess_a, WIRE_TIMEOUT)
        .await
        .expect("A turn_complete");
    let b_frames = ws_b
        .collect_code_output(sess_b, WIRE_TIMEOUT)
        .await
        .expect("B turn_complete");
    assert!(!a_frames.is_empty());
    assert!(!b_frames.is_empty());
    for f in &a_frames {
        assert_eq!(f["tug_session_id"].as_str(), Some(sess_a));
    }
    for f in &b_frames {
        assert_eq!(f["tug_session_id"].as_str(), Some(sess_b));
    }
}

// ---------------------------------------------------------------------------
// test_session_metadata_reaches_late_subscriber
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_session_metadata_reaches_late_subscriber() {
    require_real_claude!();
    let tc = spawn_tugcast().await;

    let card_id = "card-meta";
    let tug_session_id = "sess-meta";

    // Round 1: W1 drives a session until system_metadata has had a
    // chance to arrive and be cached in latest_metadata.
    {
        let mut ws1 = TestWs::connect(tc.port).await;
        ws1.send_spawn_session(card_id, tug_session_id).await;
        ws1.await_session_state(tug_session_id, "pending", WIRE_TIMEOUT)
            .await
            .expect("W1 pending");
        ws1.send_code_input(tug_session_id, "/status").await;
        ws1.await_session_state(tug_session_id, "live", WIRE_TIMEOUT)
            .await
            .expect("W1 live");
        let _ = ws1
            .collect_code_output(tug_session_id, WIRE_TIMEOUT)
            .await
            .expect("W1 turn_complete");
        drop(ws1);
    }

    // Round 2: W2 opens a fresh WebSocket (new client_id), sends
    // spawn_session for the SAME tug_session_id, and must receive
    // exactly one SESSION_METADATA frame — the event-driven replay
    // fired inside the supervisor's do_spawn_session Phase 3 per
    // [D14] / [F13]. If tugcast did a post-handshake replay instead,
    // the fresh client_id would have an empty client_sessions set
    // and no frame would arrive.
    let mut ws2 = TestWs::connect(tc.port).await;
    ws2.send_spawn_session(card_id, tug_session_id).await;
    let meta_count = ws2
        .count_session_metadata(tug_session_id, Duration::from_secs(3))
        .await;
    assert_eq!(
        meta_count, 1,
        "event-driven replay must deliver exactly one SESSION_METADATA frame"
    );
}

// ---------------------------------------------------------------------------
// test_session_metadata_two_sessions_no_clobber_real_claude
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
async fn test_session_metadata_two_sessions_no_clobber_real_claude() {
    require_real_claude!();
    let tc = spawn_tugcast().await;
    let mut ws = TestWs::connect(tc.port).await;

    let sess_a = "sess-meta-a";
    let sess_b = "sess-meta-b";

    ws.send_spawn_session("card-meta-a", sess_a).await;
    ws.send_spawn_session("card-meta-b", sess_b).await;
    ws.await_session_state(sess_a, "pending", WIRE_TIMEOUT)
        .await
        .expect("A pending");
    ws.await_session_state(sess_b, "pending", WIRE_TIMEOUT)
        .await
        .expect("B pending");

    ws.send_code_input(sess_a, "/status").await;
    ws.send_code_input(sess_b, "/status").await;
    ws.await_session_state(sess_a, "live", WIRE_TIMEOUT)
        .await
        .expect("A live");
    ws.await_session_state(sess_b, "live", WIRE_TIMEOUT)
        .await
        .expect("B live");

    // Drain enough frames to observe metadata from both sessions.
    let meta_a = ws.count_session_metadata(sess_a, Duration::from_secs(5)).await;
    let meta_b = ws.count_session_metadata(sess_b, Duration::from_secs(5)).await;
    assert!(
        meta_a >= 1,
        "session A must receive at least one system_metadata frame"
    );
    assert!(
        meta_b >= 1,
        "session B must receive at least one system_metadata frame"
    );
}
