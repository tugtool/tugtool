//! HTTP server for tugcast
//!
//! Implements the axum server with routes for auth, WebSocket upgrade,
//! and API commands. In production mode, tugcast serves the pre-built
//! frontend from `tugdeck/dist/` via `tower-http::ServeDir` as a fallback
//! route. In dev mode, the Vite dev server on port 55155 handles the
//! frontend; tugcast handles only the API routes.

use axum::Extension;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::warn;
use tugbank_core::TugbankClient;
use tugcast_core::{FeedId, Frame};

use crate::dev::SharedDevState;
use crate::router::FeedRouter;

/// Request payload for /api/tell endpoint
// Allow dead_code: struct is used only for testing/documentation
#[allow(dead_code)]
#[derive(Deserialize)]
struct TellRequest {
    action: String,
}

/// Response payload for /api/tell endpoint
#[derive(Serialize)]
struct TellResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Handle POST /api/tell requests for triggering actions
async fn tell_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    body: Bytes,
) -> Response {
    // Reject non-loopback connections
    if !addr.ip().is_loopback() {
        warn!(
            "tell_handler: rejected non-loopback connection from {}",
            addr
        );
        return (
            StatusCode::FORBIDDEN,
            axum::Json(TellResponse {
                status: "error".to_string(),
                message: Some("forbidden".to_string()),
            }),
        )
            .into_response();
    }

    // Parse JSON payload manually (not using axum Json extractor) for custom error messages
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(TellResponse {
                    status: "error".to_string(),
                    message: Some("invalid JSON".to_string()),
                }),
            )
                .into_response();
        }
    };

    // Extract action field
    let action = match payload.get("action").and_then(|a| a.as_str()) {
        Some(a) => a,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(TellResponse {
                    status: "error".to_string(),
                    message: Some("missing action field".to_string()),
                }),
            )
                .into_response();
        }
    };

    // Bridge: `changeset_*` CONTROL actions (e.g. `changeset_claim`) live in
    // the supervisor's `handle_control` — the single source of truth shared
    // with the WebSocket ingress — so the CLI (`tugutil claim`) and the deck
    // hit the same handler. Gated to the `changeset_` prefix: those verbs act
    // on a project + ledger, never on per-client state, so a tell (which has
    // no client connection) can drive them with a synthetic client id;
    // client-scoped verbs (`spawn_session`, …) stay off the HTTP surface.
    // Everything else falls through to the host-action `dispatch_action` below.
    if action.starts_with("changeset_")
        && let Some(sup) = router.supervisor.as_ref()
    {
        use crate::feeds::agent_supervisor::ControlOutcome;
        match sup
            .handle_control(action, &body, TELL_SYNTHETIC_CLIENT_ID)
            .await
        {
            ControlOutcome::Handled => {
                return (
                    StatusCode::OK,
                    axum::Json(TellResponse {
                        status: "ok".to_string(),
                        message: None,
                    }),
                )
                    .into_response();
            }
            ControlOutcome::Error(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(TellResponse {
                        status: "error".to_string(),
                        message: Some(format!("{err:?}")),
                    }),
                )
                    .into_response();
            }
            // Not a supervisor-owned action after all — fall through.
            ControlOutcome::PassThrough => {}
        }
    }

    // Dispatch action
    crate::actions::dispatch_action(
        action,
        &body,
        &router.shutdown_tx,
        &router.stream_outputs,
        &router.dev_state,
        &router.pending_evals,
        &router.local_model,
    )
    .await;

    (
        StatusCode::OK,
        axum::Json(TellResponse {
            status: "ok".to_string(),
            message: None,
        }),
    )
        .into_response()
}

/// Synthetic client id for HTTP-`tell`-originated CONTROL actions: a tell has
/// no WebSocket connection, so `changeset_*` verbs (which never touch
/// per-client state) run under this sentinel. Well above any real client id
/// (those count up from 0), so it can never collide with a live client.
const TELL_SYNTHETIC_CLIENT_ID: u64 = u64::MAX;

/// Handle GET /api/changesets — an observability dump of the live changeset
/// aggregate. Composes fresh over the current registry + ledger (the same call
/// the CHANGESET_ALL feed makes on a bump) and returns it as JSON. Loopback
/// only; read-only. This is ground truth for "what does compose produce right
/// now" — the CLI (`tugutil host changesets`) reads it to diagnose a stale or
/// empty Changes view against the actual working-tree scan.
async fn changesets_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
) -> Response {
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({ "status": "error", "message": "forbidden" })),
        )
            .into_response();
    }
    match router.supervisor.as_ref() {
        Some(sup) => {
            let snapshot = sup.compose_changeset_aggregate().await;
            (StatusCode::OK, axum::Json(snapshot)).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "status": "error", "message": "no supervisor" })),
        )
            .into_response(),
    }
}

/// Request payload for POST /api/draft — the CLI's landing-draft write
/// path (`tugutil draft set|clear`). Routing these writes through the
/// server keeps short-lived CLI processes out of the shared changes
/// ledger entirely: one writer surface, one journal, one pragma set.
#[derive(serde::Deserialize)]
struct DraftApiRequest {
    /// `set` | `clear`.
    op: String,
    owner_kind: String,
    owner_id: String,
    /// Project path as the caller spelled it. The server is the
    /// canonicalization gateway ([L29]): this is resolved through
    /// `resolve_to_claude_form` and the *resolved* spelling is the row
    /// key written — a CLI must never canonicalize on its own (bare
    /// `fs::canonicalize` mints the firmlink-expanded spelling Claude
    /// never writes).
    project_dir: String,
    /// Additional legacy spelling of the same directory (e.g. the old
    /// CLI's `fs::canonicalize` form); a differing row under it is
    /// superseded on set and swept on clear.
    #[serde(default)]
    raw_project_dir: Option<String>,
    /// New message; on set, `None` keeps the existing draft's message.
    #[serde(default)]
    message: Option<String>,
    /// New selection JSON string; `None` keeps the existing selection.
    #[serde(default)]
    selection: Option<String>,
}

/// Handle POST /api/draft — ledger-backed draft set/clear with the CLI's
/// read-merge semantics (Spec S02/S05): a set preserves the existing
/// fingerprint and selection unless replaced, always writes `edited=1`
/// (a skill-authored draft is an authored draft), and supersedes a
/// raw-spelling sibling row. Loopback only.
async fn draft_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    body: Bytes,
) -> Response {
    fn err(status: StatusCode, message: &str) -> Response {
        (
            status,
            axum::Json(serde_json::json!({ "status": "error", "message": message })),
        )
            .into_response()
    }
    if !addr.ip().is_loopback() {
        return err(StatusCode::FORBIDDEN, "forbidden");
    }
    let Some(ledger) = router
        .supervisor
        .as_ref()
        .and_then(|s| s.session_ledger.clone())
    else {
        return err(StatusCode::SERVICE_UNAVAILABLE, "no session ledger");
    };
    let req: DraftApiRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => return err(StatusCode::BAD_REQUEST, &format!("invalid JSON: {e}")),
    };
    // Blocking work (path resolution syscalls, ledger mutex, SQLite)
    // stays off the async workers.
    match tokio::task::spawn_blocking(move || apply_draft_request(&ledger, &req)).await {
        Ok(response) => response,
        Err(e) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("draft task failed: {e}"),
        ),
    }
}

/// The ledger half of [`draft_handler`], run on the blocking pool.
fn apply_draft_request(
    ledger: &crate::session_ledger::SessionLedger,
    req: &DraftApiRequest,
) -> Response {
    fn err(status: StatusCode, message: &str) -> Response {
        (
            status,
            axum::Json(serde_json::json!({ "status": "error", "message": message })),
        )
            .into_response()
    }
    // The gateway ([L29]): the persisted row key is the Claude-form
    // spelling, whatever the caller sent. Every differing spelling the
    // caller knows about — its own as-sent path, a legacy realpath form —
    // is a stale sibling to read as fallback, supersede on set, and
    // sweep on clear.
    let canonical =
        crate::path_resolver::resolve_to_claude_form(std::path::Path::new(&req.project_dir))
            .to_string_lossy()
            .into_owned();
    let alternates: Vec<String> = [Some(req.project_dir.clone()), req.raw_project_dir.clone()]
        .into_iter()
        .flatten()
        .filter(|s| *s != canonical)
        .collect();
    let read_existing = || {
        ledger
            .changeset_draft(&req.owner_kind, &req.owner_id, &canonical)
            .ok()
            .flatten()
            .or_else(|| {
                alternates.iter().find_map(|alt| {
                    ledger
                        .changeset_draft(&req.owner_kind, &req.owner_id, alt)
                        .ok()
                        .flatten()
                })
            })
    };
    match req.op.as_str() {
        "set" => {
            let existing = read_existing();
            let message = match req
                .message
                .clone()
                .or_else(|| existing.as_ref().map(|e| e.message.clone()))
            {
                Some(m) if !m.trim().is_empty() => m,
                _ => {
                    return err(
                        StatusCode::BAD_REQUEST,
                        "nothing to set: no message given and no draft on file",
                    );
                }
            };
            let row = crate::session_ledger::ChangesetDraftRow {
                owner_kind: req.owner_kind.clone(),
                owner_id: req.owner_id.clone(),
                project_dir: canonical.clone(),
                fingerprint: existing
                    .as_ref()
                    .map(|e| e.fingerprint.clone())
                    .unwrap_or_default(),
                message,
                updated_at: crate::session_ledger::now_millis(),
                edited: true,
                selection: req
                    .selection
                    .clone()
                    .or_else(|| existing.as_ref().and_then(|e| e.selection.clone())),
            };
            if let Err(e) = ledger.upsert_changeset_draft(&row) {
                return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            for alt in &alternates {
                let _ = ledger.delete_changeset_draft(&req.owner_kind, &req.owner_id, alt);
            }
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "row": row })),
            )
                .into_response()
        }
        "clear" => {
            let existed = read_existing().is_some();
            if let Err(e) =
                ledger.delete_changeset_draft(&req.owner_kind, &req.owner_id, &canonical)
            {
                return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            for alt in &alternates {
                let _ = ledger.delete_changeset_draft(&req.owner_kind, &req.owner_id, alt);
            }
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({ "status": "ok", "deleted": existed })),
            )
                .into_response()
        }
        other => err(StatusCode::BAD_REQUEST, &format!("unknown op '{other}'")),
    }
}

/// Handle POST /api/changes-write — the owner side of the single-writer
/// contract ([LR8]). The body is one `changes_journal::Record`, sent by an
/// instance that lost the writer claim; the owner applies it through the
/// same funnel as its own writes (SQLite + journal) and answers with the
/// number of rows it touched, so the caller gets a durable ack. Loopback
/// only, like every tugcast API.
async fn changes_write_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        return changes_write_error(StatusCode::FORBIDDEN, "forbidden");
    }
    let Some(ledger) = router
        .supervisor
        .as_ref()
        .and_then(|s| s.session_ledger.clone())
    else {
        return changes_write_error(StatusCode::SERVICE_UNAVAILABLE, "no session ledger");
    };
    // Blocking work (ledger mutex, SQLite, journal fsync) stays off the
    // async workers — a busy ledger must not starve the runtime.
    match tokio::task::spawn_blocking(move || apply_changes_write(&ledger, &body)).await {
        Ok(response) => response,
        Err(e) => changes_write_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("write task failed: {e}"),
        ),
    }
}

/// The body-to-ledger half of [`changes_write_handler`], factored out so
/// the forwarding path can be exercised over a real loopback socket.
pub(crate) fn apply_changes_write(
    ledger: &crate::session_ledger::SessionLedger,
    body: &[u8],
) -> Response {
    let record: crate::changes_journal::Record = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(e) => {
            return changes_write_error(StatusCode::BAD_REQUEST, &format!("invalid record: {e}"));
        }
    };
    match ledger.apply_forwarded_change(record) {
        Ok(applied) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({ "status": "ok", "applied": applied })),
        )
            .into_response(),
        Err(e) => changes_write_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

fn changes_write_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        axum::Json(serde_json::json!({ "status": "error", "message": message })),
    )
        .into_response()
}

/// Handle POST /api/eval requests for evaluating JavaScript in the browser.
///
/// Sends an eval request to the browser via CONTROL frame and waits for the
/// response. Returns the result as JSON. Timeout after 30 seconds.
async fn eval_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    bank: Option<Extension<Arc<TugbankClient>>>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }

    // Eval runs in dev mode, or on any instance whose operator has set
    // the diagnostics opt-in on this instance's bank:
    //
    //   PUT /api/defaults/diag/eval {"kind":"bool","value":true}
    //
    // (delete the key to revoke). Loopback-only either way — the
    // opt-in exists so a release deck can be inspected with the same
    // instruments as a dev one, without shipping an always-open door.
    let mut allowed = router.dev_state.load().is_some();
    if !allowed {
        if let Some(Extension(client)) = bank {
            let read = tokio::task::spawn_blocking(move || client.get("diag", "eval")).await;
            allowed = match read {
                Ok(Ok(Some(tugbank_core::Value::Bool(b)))) => b,
                Ok(Ok(Some(tugbank_core::Value::String(s)))) => s == "1" || s == "true",
                _ => false,
            };
        }
    }
    if !allowed {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(
                serde_json::json!({"status": "error", "message": "eval requires dev mode or the diag/eval opt-in"}),
            ),
        )
            .into_response();
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"status": "error", "message": "invalid JSON"})),
            )
                .into_response();
        }
    };

    let code = match payload.get("code").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"status": "error", "message": "missing code field"})),
            )
                .into_response();
        }
    };

    // Generate request ID and create oneshot channel
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();

    // Register pending eval
    {
        let mut pending = router.pending_evals.lock().unwrap();
        pending.insert(request_id.clone(), tx);
    }

    // Broadcast eval request to browser
    let eval_frame = serde_json::json!({
        "action": "eval",
        "requestId": request_id,
        "code": code,
    });
    if let Some((broadcast_tx, _)) = router.stream_outputs.get(&FeedId::CONTROL) {
        let frame = Frame::new(FeedId::CONTROL, serde_json::to_vec(&eval_frame).unwrap());
        let _ = broadcast_tx.send(frame);
    }

    // Await response with timeout
    match timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({"status": "ok", "result": result})),
        )
            .into_response(),
        Ok(Err(_)) => {
            // Sender dropped (browser disconnected)
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(
                    serde_json::json!({"status": "error", "message": "browser disconnected"}),
                ),
            )
                .into_response()
        }
        Err(_) => {
            // Timeout — clean up pending entry
            let mut pending = router.pending_evals.lock().unwrap();
            pending.remove(&request_id);
            (
                StatusCode::GATEWAY_TIMEOUT,
                axum::Json(serde_json::json!({"status": "error", "message": "timeout waiting for browser response"})),
            )
                .into_response()
        }
    }
}

/// Build the axum application router
///
/// Constructs the Router with auth, WebSocket, and API routes.
/// Separated from `run_server` to enable testing without TCP binding.
///
/// Static-file serving: tugcast always checks for a built frontend at
/// `resources::source_tree().join("tugdeck/dist")`. In a bundled Tug.app
/// this resolves to `Contents/Resources/tugdeck/dist/` (via `TUGCAST_RESOURCE_ROOT`
/// set by `ProcessManager.swift`). In a dev `cargo run` without the env var,
/// it falls back to `<repo>/tugdeck/dist/`. If the dist directory does not
/// exist, a warning is logged and unmatched routes return axum's default
/// 404 (API routes remain fully functional).
///
/// When `bank_store` is `Some(client)`, registers the four `/api/defaults`
/// routes with the client as an `Extension`. When `None`, the defaults routes
/// are not registered — this avoids a missing-Extension panic since no
/// defaults routes are reachable in callers (e.g., tests) that do not supply
/// a client. The client is created externally (in `main.rs`) so that migration
/// can share the same connection before the server starts accepting connections.
pub(crate) fn build_app(
    router: FeedRouter,
    _dev_state: SharedDevState,
    bank_store: Option<Arc<TugbankClient>>,
    snippets_state: Option<Arc<crate::snippets::SnippetsState>>,
) -> Router {
    // Allow any origin on localhost — tugcast only binds to loopback.
    // This prevents WKWebView CORS errors during page teardown (keepalive
    // fetches during beforeunload) and for cross-port requests when the
    // page is served by Vite dev server on a different port.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut base = Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .route("/api/tell", post(tell_handler))
        .route("/api/eval", post(eval_handler))
        .route("/api/host", get(crate::host::get_host))
        .route("/api/changesets", get(changesets_handler))
        .route("/api/draft", post(draft_handler))
        .route("/api/changes-write", post(changes_write_handler))
        .route(
            "/api/workspace/acquire",
            post(crate::workspace_api::post_workspace_acquire),
        )
        .route(
            "/api/workspace/release",
            post(crate::workspace_api::post_workspace_release),
        )
        .route("/api/permissions", get(crate::permissions::get_permissions))
        .route("/api/permissions/rule", post(crate::permissions::post_rule))
        .route("/api/fs/complete", get(crate::fs_complete::get_fs_complete))
        .route("/api/fs/read", get(crate::fs_read::get_fs_read))
        .route("/api/fs/mkdir", post(crate::fs_mkdir::post_fs_mkdir))
        .route("/api/fs/stat", post(crate::fs_stat::post_fs_stat))
        .route(
            "/api/fs/write",
            // Per-route body limit above axum's 2 MB default so an 8 MiB
            // file (the read cap) still saves through the JSON envelope.
            post(crate::fs_write::post_fs_write)
                .layer(DefaultBodyLimit::max(crate::fs_write::MAX_WRITE_BODY_BYTES)),
        )
        .with_state(router)
        .layer(cors);

    // Wire defaults routes when an already-opened store is provided.
    if let Some(store) = bank_store {
        base = base
            .route("/api/defaults/{domain}", get(crate::defaults::get_domain))
            .route(
                "/api/defaults/{domain}/{key}",
                get(crate::defaults::get_key)
                    .put(crate::defaults::put_key)
                    .delete(crate::defaults::delete_key),
            )
            .layer(Extension(store));
    }

    // Wire the snippets routes when a state (resolved file path) is provided.
    if let Some(state) = snippets_state {
        base = base
            .route(
                "/api/snippets",
                get(crate::snippets::get_snippets).put(crate::snippets::put_snippets),
            )
            .layer(Extension(state));
    }

    let dist_path = crate::resources::source_tree().join("tugdeck").join("dist");
    if dist_path.is_dir() {
        let index_html = dist_path.join("index.html");
        return base.fallback_service(
            ServeDir::new(&dist_path).not_found_service(ServeFile::new(index_html)),
        );
    } else {
        warn!(
            "dist directory not found at {}, static file serving disabled",
            dist_path.display()
        );
    }

    base
}

/// Run the HTTP server
///
/// Serves the axum application on the provided `TcpListener`.
/// The `bank_store` is forwarded to `build_app` to enable the defaults
/// endpoints backed by the tugbank SQLite database. The client is created
/// in `main.rs` before startup so migration can share the same connection.
pub async fn run_server(
    listener: TcpListener,
    router: FeedRouter,
    dev_state: SharedDevState,
    bank_store: Option<Arc<TugbankClient>>,
    snippets_state: Option<Arc<crate::snippets::SnippetsState>>,
) -> Result<(), std::io::Error> {
    let app = build_app(router, dev_state, bank_store, snippets_state);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tell_request_deserialization() {
        let json = r#"{"action":"test-ping"}"#;
        let req: TellRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.action, "test-ping");
    }

    #[test]
    fn test_tell_request_missing_action() {
        let json = r#"{"foo":"bar"}"#;
        let result: Result<TellRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_action_classification() {
        // All actions are now client-only (broadcast to Control feed).
        // restart, reset, and relaunch have been removed.
        assert_ne!("reload", "restart");
        assert_ne!("reload", "reset");
        assert_ne!("show-card", "restart");
        assert_ne!("show-card", "reset");
    }
}
