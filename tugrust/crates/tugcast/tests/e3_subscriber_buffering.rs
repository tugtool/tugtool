//! Investigation: tugcast subscriber buffering on disconnect/reconnect.
//!
//! Question: when a WebSocket client disconnects from tugcast and a
//! new client reconnects, what events does the new client see?
//! Specifically: are events emitted by tugcast during the disconnect
//! window (a) delivered to the reconnected client, (b) dropped, or
//! (c) replayed on demand?
//!
//! Methodology: tugcast wires CODE_OUTPUT to a `tokio::sync::broadcast`
//! channel with capacity `CODE_BROADCAST_CAPACITY` (1024) and a
//! `LagPolicy::Replay(code_replay)` lag handler backed by a 1000-frame
//! shared `ReplayBuffer`. Each WebSocket client subscribes via
//! `tx.subscribe()` and reads from the resulting `broadcast::Receiver`.
//!
//! The question is answered by direct experiment: push frames into a
//! broadcast channel, drop a receiver, push more frames, create a fresh
//! receiver, observe what arrives. tokio's broadcast channel docs say
//! "A broadcasting channel always sends new values to subscribers
//! active when the value was sent" — this experiment makes that
//! concrete and lets us reason about tugcast's specific behavior with
//! the LagPolicy::Replay path included.
//!
//! Run: `cargo nextest run -p tugcast --test e3_subscriber_buffering`
//!
//! Output: a printed report (via `println!` so `cargo nextest`'s
//! `--success-output immediate` shows it) that documents the observed
//! behavior. The test passes if the experiment runs cleanly; the
//! verdict is captured in the printed output and folded into the
//! plan's "Verdict" section.

use std::time::Duration;
use tokio::sync::broadcast;

#[derive(Clone, Debug, PartialEq)]
struct Frame(u32);

const CAPACITY: usize = 1024; // mirrors CODE_BROADCAST_CAPACITY in feeds/code.rs

#[tokio::test(flavor = "current_thread")]
async fn e3_fresh_subscriber_sees_only_post_subscribe_frames() {
    println!();
    println!("--- E3.1: fresh subscriber semantics ---");

    let (tx, _) = broadcast::channel::<Frame>(CAPACITY);

    // Pre-subscribe: send frames before any subscriber exists.
    for n in 1..=5 {
        let _ = tx.send(Frame(n));
    }

    // First subscriber connects. They should see only NEW frames
    // sent after this point — nothing from the pre-subscribe window.
    let mut sub1 = tx.subscribe();

    // Send more frames.
    for n in 6..=10 {
        let _ = tx.send(Frame(n));
    }

    // Drain sub1.
    let mut sub1_seen = Vec::new();
    while let Ok(f) = tokio::time::timeout(Duration::from_millis(20), sub1.recv()).await {
        match f {
            Ok(frame) => sub1_seen.push(frame),
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(_)) => {}
        }
    }

    println!(
        "sub1 saw {} frames: {:?}",
        sub1_seen.len(),
        sub1_seen.iter().map(|f| f.0).collect::<Vec<_>>()
    );

    // Verdict: a fresh subscriber sees ONLY frames sent after they
    // subscribed. Frames 1-5 (sent before subscribe) are NOT
    // delivered. Frames 6-10 are.
    assert_eq!(
        sub1_seen,
        (6..=10).map(Frame).collect::<Vec<_>>(),
        "Fresh subscriber should see only post-subscribe frames",
    );
    println!(
        "VERDICT: fresh subscribers see only post-subscribe frames; pre-subscribe frames are dropped from their perspective."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn e3_disconnect_then_reconnect_loses_disconnect_window_frames() {
    println!();
    println!("--- E3.2: disconnect/reconnect window ---");

    let (tx, _) = broadcast::channel::<Frame>(CAPACITY);

    // Card v1 connects.
    let mut sub_v1 = tx.subscribe();

    // Some frames flow.
    for n in 1..=3 {
        let _ = tx.send(Frame(n));
    }

    // Drain v1.
    let mut v1_seen = Vec::new();
    while let Ok(f) = tokio::time::timeout(Duration::from_millis(20), sub_v1.recv()).await {
        match f {
            Ok(frame) => v1_seen.push(frame),
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(_)) => {}
        }
    }
    assert_eq!(v1_seen, (1..=3).map(Frame).collect::<Vec<_>>());
    println!("v1 received frames 1..=3 OK");

    // Card v1 disconnects (drop the receiver).
    drop(sub_v1);

    // During the disconnect window, more frames flow. There's no
    // active subscriber on this channel right now.
    for n in 4..=8 {
        let _ = tx.send(Frame(n));
    }
    println!("emitted frames 4..=8 during the disconnect window");

    // Card v2 reconnects (fresh subscribe).
    let mut sub_v2 = tx.subscribe();

    // More frames flow after reconnect.
    for n in 9..=11 {
        let _ = tx.send(Frame(n));
    }

    // Drain v2.
    let mut v2_seen = Vec::new();
    while let Ok(f) = tokio::time::timeout(Duration::from_millis(20), sub_v2.recv()).await {
        match f {
            Ok(frame) => v2_seen.push(frame),
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(_)) => {}
        }
    }
    println!(
        "v2 saw {} frames: {:?}",
        v2_seen.len(),
        v2_seen.iter().map(|f| f.0).collect::<Vec<_>>()
    );

    // Verdict: v2 saw frames 9-11 (post-subscribe) but NOT frames 4-8
    // (emitted during the disconnect window). The disconnect-window
    // frames were dropped from v2's perspective.
    assert_eq!(
        v2_seen,
        (9..=11).map(Frame).collect::<Vec<_>>(),
        "v2 should see only frames sent after its subscribe",
    );
    let lost = (4..=8).collect::<Vec<u32>>();
    println!(
        "VERDICT: disconnect-window frames {:?} are dropped at the broadcast layer; the reconnected subscriber sees only post-subscribe frames.",
        lost
    );
    println!(
        "Implication for mid-turn reload: any CODE_OUTPUT events emitted by tugcode while the WebSocket was between card v1 and card v2 are NOT delivered to card v2 by the broadcast channel alone. Recovery must come from elsewhere — i.e., the request_replay verb + JSONL replay."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn e3_lag_recovery_is_for_existing_subscribers_only() {
    println!();
    println!("--- E3.3: lag recovery is for existing subscribers ---");

    // The router's LagPolicy::Replay path runs only when an EXISTING
    // subscriber lags (their channel buffer overflows because they
    // were too slow to drain). It does NOT run on a fresh connect.
    // This test demonstrates the difference.

    let (tx, _) = broadcast::channel::<Frame>(8); // small for demo

    // Subscriber connects but doesn't drain.
    let mut slow_sub = tx.subscribe();

    // Push more frames than capacity. Existing subscriber lags.
    for n in 1..=20 {
        let _ = tx.send(Frame(n));
    }

    // Slow subscriber's first recv() returns Lagged with a count of
    // how many were missed.
    let first = tokio::time::timeout(Duration::from_millis(50), slow_sub.recv())
        .await
        .expect("recv didn't time out")
        .unwrap_err();
    match first {
        broadcast::error::RecvError::Lagged(count) => {
            println!(
                "Existing slow subscriber observed Lagged({}) — channel evicted {} frames",
                count, count
            );
            println!(
                "VERDICT: tokio's broadcast surfaces Lagged on the receiver. The router's `LagPolicy::Replay` handler reacts to this signal by replaying from the shared ReplayBuffer to the LAGGED EXISTING subscriber. A fresh subscriber after disconnect-then-reconnect does NOT receive Lagged — they just don't see the gap frames."
            );
        }
        broadcast::error::RecvError::Closed => panic!("unexpected Closed"),
    }
}
