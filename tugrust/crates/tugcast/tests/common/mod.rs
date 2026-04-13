//! Common test helpers for the tugcast multi-session integration tests.
//!
//! # Runtime shape
//!
//! These helpers spawn `tugcast` as a subprocess via
//! `env!("CARGO_BIN_EXE_tugcast")`. Integration tests live in
//! `tugrust/crates/tugcast/tests/*.rs`, outside the crate's library
//! scope, so they cannot import tugcast internals directly — the
//! binary-as-subprocess pattern is the canonical Cargo approach for
//! end-to-end coverage of a bin-only crate.
//!
//! # Env gating
//!
//! The tests that consume these helpers are all gated on
//! `TUG_REAL_CLAUDE=1` via both `#[ignore]` on the test function AND an
//! early-return check on the env var at the top of each test body
//! (belt-and-suspenders). A real `claude` (tugcode) binary must be
//! available at runtime — the helpers themselves compile
//! unconditionally so `cargo build --tests -p tugcast` passes clean in
//! every environment.
//!
//! # Isolation
//!
//! Each invocation of [`TestTugcast::spawn`] binds an ephemeral TCP
//! port (so parallel test runs cannot collide), uses a per-test tugbank
//! path (so persisted session keys cannot leak between tests), and
//! creates a per-test tmux session name derived from the port.
//! `TUGBANK_PATH` is set on the spawned subprocess so the downstream
//! tugcode singleton points at the same per-test file.
//!
//! # Frame-preserving WebSocket wrapper
//!
//! [`TestWs`] wraps a client [`WsStream`] with an internal `Vec` of
//! decoded frames. Every helper (`await_session_state`,
//! `collect_code_output`, ...) scans the buffer first and only pulls
//! new frames from the socket when the buffer cannot satisfy the
//! request. Matching frames are removed from the buffer as they are
//! consumed; non-matching frames stay put. This preserves the
//! invariant that "a drain helper never drops frames you care about",
//! which is what two-session tests rely on — without it, a collector
//! looking for session A's frames would eat session B's frames as
//! collateral damage and leave B's later `collect_code_output` call
//! with nothing to see.

#![allow(dead_code)]

use std::net::TcpListener as StdTcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tugcast_core::{FeedId, Frame};

/// Alias for the fully-typed client-side WebSocket stream.
pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Returns `true` if `TUG_REAL_CLAUDE` is set to a truthy value. Tests
/// gate every real-claude scenario on this so `cargo nextest run` in
/// the default suite never tries to spawn a real Claude Code subprocess.
pub fn real_claude_enabled() -> bool {
    match std::env::var("TUG_REAL_CLAUDE") {
        Ok(v) => v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes"),
        Err(_) => false,
    }
}

/// Reserve an ephemeral TCP port by binding-then-releasing. The port
/// may be reclaimed by another process in between, but for integration
/// tests on a mostly-idle loopback this is good enough and simpler than
/// plumbing a pre-bound listener into tugcast.
fn ephemeral_port() -> u16 {
    let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

/// A running tugcast subprocess for integration tests. Dropping the
/// handle kills the child (`kill_on_drop(true)`).
pub struct TestTugcast {
    pub child: Child,
    pub port: u16,
    pub bank_path: PathBuf,
}

impl TestTugcast {
    /// Spawn tugcast as a subprocess bound to an ephemeral port.
    ///
    /// `--no-auth` disables the session cookie + origin check so the
    /// test WebSocket client can upgrade without minting a token.
    /// `--bank-path` + `TUGBANK_PATH` are per-test so parallel runs
    /// cannot collide on `~/.tugbank.db`. The tmux session name is
    /// derived from the port so each test owns a distinct session.
    pub async fn spawn(project_dir: &Path, bank_path: PathBuf) -> Self {
        let port = ephemeral_port();
        let bin = env!("CARGO_BIN_EXE_tugcast");
        // `TUGBANK_PATH` is set explicitly so the spawned tugcast AND
        // the downstream tugcode subprocess both point at the per-test
        // bank file. Without the env var tugcode's tugbank singleton
        // defaults to `~/.tugbank.db` and reads the developer's real
        // persisted `(dev.tugtool.app, session-id)` — which makes
        // tugcode boot with `--resume <stale-uuid>`, which claude
        // rejects, which causes every live-session test to hang.
        let child = Command::new(bin)
            .arg("--port")
            .arg(port.to_string())
            .arg("--dir")
            .arg(project_dir)
            .arg("--no-auth")
            .arg("--session")
            .arg(format!("tug-test-{port}"))
            .arg("--bank-path")
            .arg(&bank_path)
            .env("TUGBANK_PATH", &bank_path)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("failed to spawn tugcast");
        wait_for_port(port, Duration::from_secs(5)).await;
        Self {
            child,
            port,
            bank_path,
        }
    }
}

async fn wait_for_port(port: u16, timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if TcpStream::connect(format!("127.0.0.1:{port}")).await.is_ok() {
            return;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("tugcast did not bind port {port} within {timeout:?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

// ---------------------------------------------------------------------------
// TestWs — frame-preserving client-side WebSocket wrapper
// ---------------------------------------------------------------------------

/// A decoded WebSocket frame held in [`TestWs`]'s buffer.
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    pub feed_id: FeedId,
    pub payload: serde_json::Value,
}

/// Client-side WebSocket wrapper with a frame-preserving buffer.
///
/// See the module JSDoc-equivalent comment at the top of this file for
/// the rationale.
pub struct TestWs {
    inner: WsStream,
    buffer: Vec<DecodedFrame>,
}

impl TestWs {
    /// Open a WebSocket client to `127.0.0.1:port/ws` and perform the
    /// v1 protocol handshake.
    pub async fn connect(port: u16) -> Self {
        let url = format!("ws://127.0.0.1:{port}/ws");
        let (mut ws, _) = connect_async(url).await.expect("ws connect");
        let hello = r#"{"protocol":"tugcast","version":1}"#;
        ws.send(Message::Text(hello.into()))
            .await
            .expect("send protocol hello");
        Self {
            inner: ws,
            buffer: Vec::new(),
        }
    }

    /// Pull frames from the socket into the buffer until either the
    /// given `predicate` matches an entry in the buffer OR the deadline
    /// expires. Returns the index of the matched buffer entry (the
    /// caller decides whether to remove it).
    async fn pump_until<F>(&mut self, deadline: Instant, mut predicate: F) -> Result<usize, String>
    where
        F: FnMut(&DecodedFrame) -> bool,
    {
        // Fast path: already buffered.
        if let Some((i, _)) = self.buffer.iter().enumerate().find(|(_, f)| predicate(f)) {
            return Ok(i);
        }
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("pump_until: timed out".into());
            }
            match tokio::time::timeout(remaining, self.inner.next()).await {
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    let Ok((frame, _)) = Frame::decode(&bytes) else {
                        continue;
                    };
                    let payload = match serde_json::from_slice::<serde_json::Value>(&frame.payload)
                    {
                        Ok(v) => v,
                        Err(_) => serde_json::Value::Null,
                    };
                    let decoded = DecodedFrame {
                        feed_id: frame.feed_id,
                        payload,
                    };
                    let matched = predicate(&decoded);
                    self.buffer.push(decoded);
                    if matched {
                        return Ok(self.buffer.len() - 1);
                    }
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => return Err(format!("pump_until: ws recv error: {e}")),
                Ok(None) => return Err("pump_until: ws closed".into()),
                Err(_) => return Err("pump_until: timed out".into()),
            }
        }
    }

    /// Send a CONTROL frame carrying `{ action, card_id, tug_session_id }`.
    async fn send_control_action(
        &mut self,
        action: &str,
        card_id: &str,
        tug_session_id: &str,
    ) {
        let payload = serde_json::json!({
            "action": action,
            "card_id": card_id,
            "tug_session_id": tug_session_id,
        });
        let bytes = serde_json::to_vec(&payload).expect("control json");
        let frame = Frame::new(FeedId::CONTROL, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send control frame");
    }

    pub async fn send_spawn_session(&mut self, card_id: &str, tug_session_id: &str) {
        self.send_control_action("spawn_session", card_id, tug_session_id).await;
    }

    pub async fn send_close_session(&mut self, card_id: &str, tug_session_id: &str) {
        self.send_control_action("close_session", card_id, tug_session_id).await;
    }

    pub async fn send_reset_session(&mut self, card_id: &str, tug_session_id: &str) {
        self.send_control_action("reset_session", card_id, tug_session_id).await;
    }

    /// Send a CODE_INPUT frame shaped per tugcode's `UserMessage` type.
    /// `tug_session_id` rides along as an extra field — tugcode ignores
    /// it, tugcast's router parses it via `parse_tug_session_id` to
    /// route to the right per-session worker.
    pub async fn send_code_input(&mut self, tug_session_id: &str, prompt: &str) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "user_message",
            "text": prompt,
            "attachments": [],
        });
        let bytes = serde_json::to_vec(&payload).expect("code_input json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send code_input frame");
    }

    // -----------------------------------------------------------------
    // Control-flow CODE_INPUT helpers (tugplan Step 2)
    //
    // Each helper serializes a typed tugcode inbound message into a
    // CODE_INPUT frame. The router's `CODE_INPUT` path is opaque
    // pass-through — see [Q01] resolution in
    // `roadmap/tugplan-golden-stream-json-catalog.md` — so tugcast
    // never inspects the payload beyond the `tug_session_id` field.
    // Tugcode is the authority on message validation.
    // -----------------------------------------------------------------

    /// Send an `interrupt` control message to stop the current turn.
    /// Per transport-exploration.md Test 6, interrupt produces
    /// `turn_complete` with `result: "error"` (not a separate
    /// `turn_cancelled` event).
    pub async fn send_interrupt(&mut self, tug_session_id: &str) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "interrupt",
        });
        let bytes = serde_json::to_vec(&payload).expect("interrupt json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send interrupt frame");
    }

    /// Answer a `control_request_forward` carrying a permission
    /// prompt. Shape per transport-exploration.md Test 11.
    /// `updated_input` and `message` are optional and omitted when
    /// `None`.
    pub async fn send_tool_approval(
        &mut self,
        tug_session_id: &str,
        request_id: &str,
        decision: &str,
        updated_input: Option<serde_json::Value>,
        message: Option<&str>,
    ) {
        let mut payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "tool_approval",
            "request_id": request_id,
            "decision": decision,
        });
        let obj = payload
            .as_object_mut()
            .expect("tool_approval payload is object");
        if let Some(input) = updated_input {
            obj.insert("updatedInput".to_string(), input);
        }
        if let Some(msg) = message {
            obj.insert(
                "message".to_string(),
                serde_json::Value::String(msg.to_string()),
            );
        }
        let bytes = serde_json::to_vec(&payload).expect("tool_approval json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send tool_approval frame");
    }

    /// Answer a `control_request_forward` carrying an
    /// `AskUserQuestion` prompt. Shape per the "Inbound Message Types"
    /// table in transport-exploration.md.
    pub async fn send_question_answer(
        &mut self,
        tug_session_id: &str,
        request_id: &str,
        answers: serde_json::Value,
    ) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "question_answer",
            "request_id": request_id,
            "answers": answers,
        });
        let bytes = serde_json::to_vec(&payload).expect("question_answer json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send question_answer frame");
    }

    /// Send a `session_command` message (`"new"` | `"continue"` |
    /// `"fork"`). Per transport-exploration.md Tests 13, 17, 20, `new`
    /// and `fork` kill and respawn the underlying claude subprocess
    /// (readiness gap); `continue` is in-place with context preserved.
    pub async fn send_session_command(&mut self, tug_session_id: &str, command: &str) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "session_command",
            "command": command,
        });
        let bytes = serde_json::to_vec(&payload).expect("session_command json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send session_command frame");
    }

    /// Send a `model_change` message. Per transport-exploration.md
    /// Test 16, this produces a synthetic `assistant_text` confirming
    /// the change and updates `system_metadata.model` on the next
    /// turn.
    pub async fn send_model_change(&mut self, tug_session_id: &str, model: &str) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "model_change",
            "model": model,
        });
        let bytes = serde_json::to_vec(&payload).expect("model_change json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send model_change frame");
    }

    /// Send a `permission_mode` message. Per the "Inbound Message
    /// Types" catalog in transport-exploration.md, mode ∈
    /// {`"default"`, `"acceptEdits"`, `"bypassPermissions"`, ...}.
    pub async fn send_permission_mode(&mut self, tug_session_id: &str, mode: &str) {
        let payload = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "permission_mode",
            "mode": mode,
        });
        let bytes = serde_json::to_vec(&payload).expect("permission_mode json");
        let frame = Frame::new(FeedId::CODE_INPUT, bytes);
        self.inner
            .send(Message::Binary(frame.encode().into()))
            .await
            .expect("send permission_mode frame");
    }

    /// Wait for a `SESSION_STATE` frame whose payload announces
    /// `target_state` for `tug_session_id`. Consumes the matching frame
    /// from the buffer on success.
    pub async fn await_session_state(
        &mut self,
        tug_session_id: &str,
        target_state: &str,
        timeout: Duration,
    ) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let idx = self
            .pump_until(deadline, |f| {
                f.feed_id == FeedId::SESSION_STATE
                    && f.payload["tug_session_id"] == tug_session_id
                    && f.payload["state"] == target_state
            })
            .await?;
        self.buffer.remove(idx);
        Ok(())
    }

    /// Wait for the first `CODE_OUTPUT` event for `tug_session_id`
    /// whose `type` field matches `event_type`. Returns the matching
    /// frame's payload and removes it from the buffer. Non-matching
    /// frames stay buffered for later collectors.
    ///
    /// Useful when a test needs to inspect a mid-stream event (e.g.,
    /// `control_request_forward` to extract a `request_id`, or
    /// `session_init` to capture the underlying `session_id`) without
    /// waiting for the terminal `turn_complete`.
    pub async fn await_code_output_event(
        &mut self,
        tug_session_id: &str,
        event_type: &str,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        let deadline = Instant::now() + timeout;
        let idx = self
            .pump_until(deadline, |f| {
                f.feed_id == FeedId::CODE_OUTPUT
                    && f.payload["tug_session_id"] == tug_session_id
                    && f.payload["type"] == event_type
            })
            .await?;
        let frame = self.buffer.remove(idx);
        Ok(frame.payload)
    }

    /// Collect `CODE_OUTPUT` payloads for `tug_session_id` from the
    /// buffer (pulling more from the socket as needed) until one with
    /// `type == "turn_complete"` is consumed. Non-matching frames (for
    /// other sessions or other feed ids) remain in the buffer for
    /// future helpers to consume.
    pub async fn collect_code_output(
        &mut self,
        tug_session_id: &str,
        timeout: Duration,
    ) -> Result<Vec<serde_json::Value>, String> {
        let deadline = Instant::now() + timeout;
        let mut out = Vec::new();
        loop {
            let idx_opt = self.buffer.iter().position(|f| {
                f.feed_id == FeedId::CODE_OUTPUT && f.payload["tug_session_id"] == tug_session_id
            });
            if let Some(i) = idx_opt {
                let f = self.buffer.remove(i);
                let is_terminator = f.payload["type"].as_str() == Some("turn_complete");
                out.push(f.payload);
                if is_terminator {
                    return Ok(out);
                }
                continue;
            }
            // Buffer exhausted for this session — pull one more frame
            // into the buffer via pump_until with a never-matching
            // predicate (we only use pump_until's side effect of
            // growing the buffer by exactly one frame).
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("collect_code_output: timed out".into());
            }
            match tokio::time::timeout(remaining, self.inner.next()).await {
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    let Ok((frame, _)) = Frame::decode(&bytes) else {
                        continue;
                    };
                    let payload =
                        serde_json::from_slice::<serde_json::Value>(&frame.payload)
                            .unwrap_or(serde_json::Value::Null);
                    self.buffer.push(DecodedFrame {
                        feed_id: frame.feed_id,
                        payload,
                    });
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => {
                    return Err(format!("collect_code_output: ws recv error: {e}"));
                }
                Ok(None) => return Err("collect_code_output: ws closed".into()),
                Err(_) => return Err("collect_code_output: timed out".into()),
            }
        }
    }

    /// Wait for any frame whose payload `detail` field matches one of
    /// the `accepted` strings. Used by the orphan-input rejection test
    /// to assert that the router emits either `session_not_owned` (P5
    /// authz) or `session_unknown` (dispatcher fallback). Consumes the
    /// matching frame from the buffer.
    pub async fn await_control_reject(
        &mut self,
        accepted: &[&str],
        timeout: Duration,
    ) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let idx = self
            .pump_until(deadline, |f| {
                let detail = f.payload["detail"].as_str().unwrap_or("");
                accepted.iter().any(|a| *a == detail)
            })
            .await?;
        self.buffer.remove(idx);
        Ok(())
    }

    /// Count `SESSION_METADATA` frames currently in the buffer (or
    /// buffered over a short polling window) whose `tug_session_id`
    /// matches `target`. Used by replay tests to assert "exactly one
    /// metadata frame was replayed" semantics.
    pub async fn count_session_metadata(
        &mut self,
        target: &str,
        timeout: Duration,
    ) -> usize {
        let deadline = Instant::now() + timeout;
        // Drain as many frames as possible within the timeout window.
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, self.inner.next()).await {
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    let Ok((frame, _)) = Frame::decode(&bytes) else {
                        continue;
                    };
                    let payload =
                        serde_json::from_slice::<serde_json::Value>(&frame.payload)
                            .unwrap_or(serde_json::Value::Null);
                    self.buffer.push(DecodedFrame {
                        feed_id: frame.feed_id,
                        payload,
                    });
                }
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(_))) | Ok(None) => break,
                Err(_) => break,
            }
        }
        self.buffer
            .iter()
            .filter(|f| {
                f.feed_id == FeedId::SESSION_METADATA
                    && f.payload["tug_session_id"] == target
            })
            .count()
    }
}
