//! HTTP handlers for `POST /api/workspace/acquire` and
//! `POST /api/workspace/release` — browse holds on a directory's feed bundle.
//!
//! Open Quickly searches a directory through the FILETREE feed, which routes
//! by `FileTreeQuery.root` to a registered `WorkspaceEntry`. When a session
//! card is frontmost that entry already exists, created by the session spawn.
//! With no bound card — an empty deck, or the in-bar directory switcher
//! pointed at a recent project — nothing has registered the directory, so the
//! frontend asks for one here.
//!
//! These are **browse** holds ([`WorkspaceRegistry::acquire_for_browse`]): the
//! entry indexes and watches the directory like any other, but stays out of
//! the open-project set the changeset aggregate enumerates. Searching a folder
//! must not make it show up in the Changes card.
//!
//! Both endpoints are loopback-gated, and both reach the registry through the
//! `AgentSupervisor` on the router state — the same `State<FeedRouter>` →
//! `router.supervisor` path `/api/changesets` takes, including its 503 when no
//! supervisor is wired.

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;

use crate::feeds::workspace_registry::{WorkspaceError, WorkspaceKey};
use crate::fs_read::guard_absolute_path;
use crate::router::FeedRouter;

/// Request body for `POST /api/workspace/acquire`.
#[derive(Debug, Deserialize)]
pub(crate) struct AcquireRequest {
    path: String,
}

/// Request body for `POST /api/workspace/release`.
#[derive(Debug, Deserialize)]
pub(crate) struct ReleaseRequest {
    workspace_key: String,
}

/// The shared loopback + supervisor-presence preflight. `Ok` carries the
/// supervisor; `Err` is the response to return as-is, boxed because an
/// `axum::Response` is far larger than the reference in the `Ok` arm and every
/// caller pays for the widest variant.
fn guard(
    addr: SocketAddr,
    router: &FeedRouter,
) -> Result<&crate::feeds::agent_supervisor::AgentSupervisor, Box<Response>> {
    if !addr.ip().is_loopback() {
        return Err(Box::new(
            (
                StatusCode::FORBIDDEN,
                axum::Json(json!({ "status": "error", "message": "forbidden" })),
            )
                .into_response(),
        ));
    }
    match router.supervisor.as_ref() {
        Some(sup) => Ok(sup),
        None => Err(Box::new(
            (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(json!({ "status": "error", "message": "no supervisor" })),
            )
                .into_response(),
        )),
    }
}

/// Handle `POST /api/workspace/acquire`. Restricted to loopback.
pub(crate) async fn post_workspace_acquire(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    axum::Json(request): axum::Json<AcquireRequest>,
) -> Response {
    let sup = match guard(addr, &router) {
        Ok(sup) => sup,
        Err(response) => return *response,
    };
    // Same path guard as the /api/fs handlers: relative, ..-traversing, and
    // secret-denylisted paths never reach the registry.
    let resolved: PathBuf = match guard_absolute_path(&request.path) {
        Ok(path) => path,
        Err((status, body)) => return (status, axum::Json(body)).into_response(),
    };

    match sup
        .registry
        .acquire_for_browse(&resolved, sup.cancel.clone())
    {
        Ok(entry) => (
            StatusCode::OK,
            axum::Json(json!({
                "status": "ok",
                "workspace_key": entry.workspace_key.as_ref(),
                "project_dir": entry.project_dir.to_string_lossy(),
            })),
        )
            .into_response(),
        Err(WorkspaceError::InvalidProjectDir { reason, .. }) => (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({ "status": "error", "reason": reason })),
        )
            .into_response(),
        Err(WorkspaceError::UnknownKey(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "status": "error", "reason": "internal" })),
        )
            .into_response(),
    }
}

/// Handle `POST /api/workspace/release`. Restricted to loopback.
///
/// An unknown key answers 200 with a note rather than a 4xx: a double-release
/// is a frontend bookkeeping slip, and a client that retries on error would
/// spin on it forever.
pub(crate) async fn post_workspace_release(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    axum::Json(request): axum::Json<ReleaseRequest>,
) -> Response {
    let sup = match guard(addr, &router) {
        Ok(sup) => sup,
        Err(response) => return *response,
    };
    let key = WorkspaceKey::from_canonical(&request.workspace_key);
    match sup.registry.release(&key) {
        Ok(()) => (StatusCode::OK, axum::Json(json!({ "status": "ok" }))).into_response(),
        Err(_) => (
            StatusCode::OK,
            axum::Json(json!({ "status": "ok", "note": "unknown" })),
        )
            .into_response(),
    }
}
