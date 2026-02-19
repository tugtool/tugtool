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

    // Create dummy conversation channels for testing
    let (conversation_tx, _) = broadcast::channel(1024);
    let (conversation_input_tx, _) = tokio::sync::mpsc::channel(256);

    let feed_router = FeedRouter::new(
        terminal_tx,
        input_tx,
        conversation_tx,
        conversation_input_tx,
        "test-dummy".to_string(),
        auth.clone(),
        vec![], // No snapshot feeds for auth/WebSocket tests
    );

    let app = build_app(feed_router, None, None);
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

/// Test that stats feeds deliver frames with correct feed IDs and valid JSON payloads
#[tokio::test]
async fn test_stats_feed_delivery() {
    use tugcast_core::{FeedId, Frame};

    // Create watch channels with pre-loaded stats data matching Spec S02 schemas
    let process_info_json = serde_json::json!({
        "name": "process_info",
        "pid": 12345,
        "cpu_percent": 2.5,
        "memory_mb": 45.3,
        "uptime_secs": 120
    });
    let process_info_payload = serde_json::to_vec(&process_info_json).unwrap();

    let token_usage_json = serde_json::json!({
        "name": "token_usage",
        "input_tokens": 1000,
        "output_tokens": 500,
        "total_tokens": 1500,
        "context_window_percent": 12.5
    });
    let token_usage_payload = serde_json::to_vec(&token_usage_json).unwrap();

    let build_status_json = serde_json::json!({
        "name": "build_status",
        "last_build_time": "2026-02-15T12:34:56Z",
        "target_modified_secs_ago": 30,
        "status": "idle"
    });
    let build_status_payload = serde_json::to_vec(&build_status_json).unwrap();

    let stats_agg_json = serde_json::json!({
        "process_info": process_info_json,
        "token_usage": token_usage_json,
        "build_status": build_status_json
    });
    let stats_agg_payload = serde_json::to_vec(&stats_agg_json).unwrap();

    // Create watch channels
    let (_stats_agg_tx, stats_agg_rx) =
        tokio::sync::watch::channel(Frame::new(FeedId::Stats, stats_agg_payload.clone()));
    let (_stats_proc_tx, stats_proc_rx) = tokio::sync::watch::channel(Frame::new(
        FeedId::StatsProcessInfo,
        process_info_payload.clone(),
    ));
    let (_stats_token_tx, stats_token_rx) = tokio::sync::watch::channel(Frame::new(
        FeedId::StatsTokenUsage,
        token_usage_payload.clone(),
    ));
    let (_stats_build_tx, stats_build_rx) = tokio::sync::watch::channel(Frame::new(
        FeedId::StatsBuildStatus,
        build_status_payload.clone(),
    ));

    // Verify that watch receivers provide immediate access to initial values
    let agg_frame = stats_agg_rx.borrow().clone();
    assert_eq!(agg_frame.feed_id, FeedId::Stats);
    assert_eq!(agg_frame.payload, stats_agg_payload);

    let proc_frame = stats_proc_rx.borrow().clone();
    assert_eq!(proc_frame.feed_id, FeedId::StatsProcessInfo);
    assert_eq!(proc_frame.payload, process_info_payload);

    let token_frame = stats_token_rx.borrow().clone();
    assert_eq!(token_frame.feed_id, FeedId::StatsTokenUsage);
    assert_eq!(token_frame.payload, token_usage_payload);

    let build_frame = stats_build_rx.borrow().clone();
    assert_eq!(build_frame.feed_id, FeedId::StatsBuildStatus);
    assert_eq!(build_frame.payload, build_status_payload);

    // Verify JSON payloads parse correctly
    let parsed_agg: serde_json::Value = serde_json::from_slice(&agg_frame.payload).unwrap();
    assert_eq!(parsed_agg["process_info"]["name"], "process_info");
    assert_eq!(parsed_agg["process_info"]["pid"], 12345);
    assert_eq!(parsed_agg["token_usage"]["total_tokens"], 1500);
    assert_eq!(parsed_agg["build_status"]["status"], "idle");

    let parsed_proc: serde_json::Value = serde_json::from_slice(&proc_frame.payload).unwrap();
    assert_eq!(parsed_proc["name"], "process_info");
    assert_eq!(parsed_proc["cpu_percent"], 2.5);

    let parsed_token: serde_json::Value = serde_json::from_slice(&token_frame.payload).unwrap();
    assert_eq!(parsed_token["name"], "token_usage");
    assert_eq!(parsed_token["context_window_percent"], 12.5);

    let parsed_build: serde_json::Value = serde_json::from_slice(&build_frame.payload).unwrap();
    assert_eq!(parsed_build["name"], "build_status");
    assert!(parsed_build["status"] == "idle" || parsed_build["status"] == "building");
}

/// Test that reconnection delivers fresh snapshots
#[tokio::test]
async fn test_reconnection_snapshot_delivery() {
    use tugcast_core::{FeedId, Frame};

    // Create watch channel with initial snapshot
    let initial_payload = b"initial snapshot";
    let initial_frame = Frame::new(FeedId::Filesystem, initial_payload.to_vec());
    let (_tx, rx) = tokio::sync::watch::channel(initial_frame.clone());

    // First client connects (simulated by cloning receiver)
    let rx_client1 = rx.clone();
    let frame1 = rx_client1.borrow().clone();
    assert_eq!(frame1.feed_id, FeedId::Filesystem);
    assert_eq!(frame1.payload, initial_payload);

    // Client 1 disconnects (drop receiver - no-op in this test)
    drop(rx_client1);

    // Second client connects (simulates reconnection)
    let rx_client2 = rx.clone();
    let frame2 = rx_client2.borrow().clone();

    // Verify client 2 receives the same snapshot immediately
    assert_eq!(frame2.feed_id, FeedId::Filesystem);
    assert_eq!(frame2.payload, initial_payload);
}

#[tokio::test]
async fn test_build_app_production_mode() {
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
async fn test_build_app_dev_mode() {
    use std::fs;
    use tempfile::TempDir;

    // Create a temp directory with an index.html file
    let temp_dir = TempDir::new().unwrap();
    let index_path = temp_dir.path().join("index.html");
    fs::write(&index_path, "<html><body>Dev Mode</body></html>").unwrap();

    // Build app with dev path
    let auth = auth::new_shared_auth_state(7890);
    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (input_tx, _) = tokio::sync::mpsc::channel(256);
    let (conversation_tx, _) = broadcast::channel(1024);
    let (conversation_input_tx, _) = tokio::sync::mpsc::channel(256);

    let feed_router = FeedRouter::new(
        terminal_tx,
        input_tx,
        conversation_tx,
        conversation_input_tx,
        "test-dummy".to_string(),
        auth,
        vec![],
    );

    // Create broadcast channel for reload
    let (reload_tx, _) = broadcast::channel::<()>(16);

    let app = build_app(feed_router, Some(temp_dir.path().to_path_buf()), Some(reload_tx));

    // Make request to /
    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify content is from disk
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(content_type.contains("text/html"));

    // Read body
    use http_body_util::BodyExt;
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body.contains("Dev Mode"));
    // Verify reload script was injected
    assert!(body.contains(r#"<script src="/dev/reload.js"></script>"#));
}

#[tokio::test]
async fn test_dev_reload_sse_endpoint() {
    use std::fs;
    use tempfile::TempDir;

    // Create a temp directory with an index.html file
    let temp_dir = TempDir::new().unwrap();
    let index_path = temp_dir.path().join("index.html");
    fs::write(&index_path, "<html><body>Test</body></html>").unwrap();

    // Build app with dev path and reload broadcast
    let auth = auth::new_shared_auth_state(7890);
    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (input_tx, _) = tokio::sync::mpsc::channel(256);
    let (conversation_tx, _) = broadcast::channel(1024);
    let (conversation_input_tx, _) = tokio::sync::mpsc::channel(256);

    let feed_router = FeedRouter::new(
        terminal_tx,
        input_tx,
        conversation_tx,
        conversation_input_tx,
        "test-dummy".to_string(),
        auth,
        vec![],
    );

    let (reload_tx, _) = broadcast::channel::<()>(16);
    let app = build_app(feed_router, Some(temp_dir.path().to_path_buf()), Some(reload_tx));

    // Make request to /dev/reload
    let response = app
        .oneshot(Request::builder().uri("/dev/reload").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify SSE content type
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(content_type.contains("text/event-stream"));
}
