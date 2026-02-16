//! Integration tests for tugcast
//!
//! These tests verify end-to-end functionality including auth flow,
//! WebSocket communication, and terminal integration.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use tokio::sync::broadcast;
use tower::ServiceExt;

use crate::auth::{self, SESSION_COOKIE_NAME};
use crate::router::{BROADCAST_CAPACITY, FeedRouter};
use crate::server::build_app;

/// Helper to build a test app with fresh auth state
fn build_test_app(port: u16) -> (axum::Router, String) {
    let auth = auth::new_shared_auth_state(port);
    let token = auth.lock().unwrap().token().unwrap().to_string();

    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (input_tx, _) = tokio::sync::mpsc::channel(256);

    let feed_router = FeedRouter::new(
        terminal_tx,
        input_tx,
        "test-dummy".to_string(),
        auth.clone(),
        vec![], // No snapshot feeds for auth/WebSocket tests
    );

    let app = build_app(feed_router);
    (app, token)
}

#[tokio::test]
async fn test_auth_valid_token() {
    let (app, token) = build_test_app(7890);

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/auth?token={}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FOUND);

    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(set_cookie.contains(SESSION_COOKIE_NAME));
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Strict"));

    let location = response.headers().get(header::LOCATION).unwrap();
    assert_eq!(location, "/");
}

#[tokio::test]
async fn test_auth_invalid_token() {
    let (app, _token) = build_test_app(7890);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/auth?token=invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_auth_token_single_use() {
    let (app, token) = build_test_app(7890);

    // First use should succeed
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/auth?token={}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);

    // Second use should fail (token invalidated)
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/auth?token={}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_static_index() {
    let (app, _token) = build_test_app(7890);

    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(content_type.contains("text/html"));
}

#[tokio::test]
async fn test_ws_requires_session() {
    let (app, _token) = build_test_app(7890);

    // Attempt WebSocket upgrade without cookie should fail
    let response = app
        .oneshot(
            Request::builder()
                .uri("/ws")
                .header(header::UPGRADE, "websocket")
                .header(header::CONNECTION, "upgrade")
                .header(header::SEC_WEBSOCKET_VERSION, "13")
                .header(header::SEC_WEBSOCKET_KEY, "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // WebSocket upgrade without valid session should fail
    // May return 403 (Forbidden) or 426 (Upgrade Required) depending on handler execution order
    assert!(
        response.status() == StatusCode::FORBIDDEN
            || response.status() == StatusCode::UPGRADE_REQUIRED
    );
}

#[tokio::test]
#[ignore] // Requires tmux
async fn test_tmux_version_check() {
    let result = crate::feeds::terminal::check_tmux_version().await;
    match result {
        Ok(version) => {
            assert!(version.contains("tmux"));
        }
        Err(e) => {
            panic!("tmux version check failed: {}", e);
        }
    }
}

/// Test that FsEvent JSON format matches TypeScript FsEvent interface
#[test]
fn test_fsevent_json_contract() {
    use tugcast_core::types::FsEvent;

    // Created event
    let created = FsEvent::Created {
        path: "src/main.rs".to_string(),
    };
    let json = serde_json::to_string(&created).unwrap();
    assert_eq!(json, r#"{"kind":"Created","path":"src/main.rs"}"#);

    // Modified event
    let modified = FsEvent::Modified {
        path: "README.md".to_string(),
    };
    let json = serde_json::to_string(&modified).unwrap();
    assert_eq!(json, r#"{"kind":"Modified","path":"README.md"}"#);

    // Removed event
    let removed = FsEvent::Removed {
        path: "old.txt".to_string(),
    };
    let json = serde_json::to_string(&removed).unwrap();
    assert_eq!(json, r#"{"kind":"Removed","path":"old.txt"}"#);

    // Renamed event
    let renamed = FsEvent::Renamed {
        from: "old.rs".to_string(),
        to: "new.rs".to_string(),
    };
    let json = serde_json::to_string(&renamed).unwrap();
    assert_eq!(json, r#"{"kind":"Renamed","from":"old.rs","to":"new.rs"}"#);
}

/// Test that GitStatus JSON format matches TypeScript GitStatus interface
#[test]
fn test_git_status_json_contract() {
    use tugcast_core::types::{FileStatus, GitStatus};

    let status = GitStatus {
        branch: "main".to_string(),
        ahead: 2,
        behind: 1,
        staged: vec![FileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
        }],
        unstaged: vec![],
        untracked: vec!["temp.txt".to_string()],
        head_sha: "abc123".to_string(),
        head_message: "Initial commit".to_string(),
    };

    let json = serde_json::to_string(&status).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    // Verify all fields are present with correct names (snake_case)
    assert_eq!(parsed["branch"], "main");
    assert_eq!(parsed["ahead"], 2);
    assert_eq!(parsed["behind"], 1);
    assert_eq!(parsed["staged"][0]["path"], "src/main.rs");
    assert_eq!(parsed["staged"][0]["status"], "M");
    assert_eq!(parsed["untracked"][0], "temp.txt");
    assert_eq!(parsed["head_sha"], "abc123");
    assert_eq!(parsed["head_message"], "Initial commit");
}

/// Test that snapshot watch channels provide immediate access to initial value
#[tokio::test]
async fn test_snapshot_watch_initial_value() {
    use tugcast_core::{FeedId, Frame};

    // Create watch channel with pre-loaded data
    let test_payload = b"test data";
    let initial_frame = Frame::new(FeedId::Filesystem, test_payload.to_vec());
    let (tx, rx) = tokio::sync::watch::channel(initial_frame.clone());

    // Clone receiver (simulates what router does per client)
    let mut rx_clone = rx.clone();

    // Borrow initial value (simulates what handle_client does on connect)
    let frame = rx_clone.borrow().clone();
    assert_eq!(frame.feed_id, FeedId::Filesystem);
    assert_eq!(frame.payload, test_payload);

    // Send update
    let update_frame = Frame::new(FeedId::Filesystem, b"updated".to_vec());
    tx.send(update_frame.clone()).unwrap();

    // Wait for change notification
    rx_clone.changed().await.unwrap();
    let updated = rx_clone.borrow_and_update().clone();
    assert_eq!(updated.payload, b"updated");
}
