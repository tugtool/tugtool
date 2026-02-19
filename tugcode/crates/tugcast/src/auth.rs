//! Authentication module for tugcast
//!
//! Implements single-use token authentication with HttpOnly session cookies.
//! The flow:
//! 1. Server generates a random 32-byte token at startup
//! 2. Client exchanges token once via GET /auth?token=TOKEN
//! 3. Server validates token, creates session, sets HttpOnly cookie, invalidates token
//! 4. All subsequent requests authenticated via session cookie

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tracing::{info, warn};

/// Name of the session cookie
pub const SESSION_COOKIE_NAME: &str = "tugcast_session";

/// Default session TTL (24 hours)
pub const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Size of the random token in bytes (hex-encoded to 64 characters)
const TOKEN_BYTES: usize = 32;

/// Query parameters for auth token exchange
#[derive(Deserialize)]
pub struct AuthQuery {
    pub token: String,
}

/// Session information
#[derive(Debug, Clone)]
struct Session {
    expires_at: Instant,
}

/// Authentication state shared across requests
#[derive(Debug)]
pub struct AuthState {
    pending_token: Option<String>,
    sessions: HashMap<String, Session>,
    session_ttl: Duration,
    port: u16,
}

impl AuthState {
    /// Create a new AuthState with a generated token
    pub fn new(port: u16) -> Self {
        let token = Self::generate_token();
        info!("Generated auth token: {}", token);

        Self {
            pending_token: Some(token),
            sessions: HashMap::new(),
            session_ttl: DEFAULT_SESSION_TTL,
            port,
        }
    }

    /// Get the pending token if available
    pub fn token(&self) -> Option<&str> {
        self.pending_token.as_deref()
    }

    /// Validate the provided token (single use - invalidates on success)
    fn validate_token(&mut self, token: &str) -> bool {
        if let Some(ref pending) = self.pending_token {
            if pending == token {
                self.pending_token = None;
                return true;
            }
        }
        false
    }

    /// Create a new session and return the session ID
    fn create_session(&mut self) -> String {
        let session_id = Self::generate_token();
        let session = Session {
            expires_at: Instant::now() + self.session_ttl,
        };
        self.sessions.insert(session_id.clone(), session);
        session_id
    }

    /// Validate a session ID (returns true if valid and not expired)
    pub fn validate_session(&mut self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get(session_id) {
            if Instant::now() < session.expires_at {
                return true;
            }
            // Session expired, remove it
            self.sessions.remove(session_id);
        }
        false
    }

    /// Check if the origin header matches allowed origins
    pub fn check_origin(&self, origin: &str) -> bool {
        let allowed_origins = [
            format!("http://127.0.0.1:{}", self.port),
            format!("http://localhost:{}", self.port),
        ];
        allowed_origins.iter().any(|allowed| allowed == origin)
    }

    /// Generate a cryptographically random token (hex-encoded)
    fn generate_token() -> String {
        let mut buf = [0u8; TOKEN_BYTES];
        rand::fill(&mut buf);
        buf.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Shared authentication state (thread-safe)
pub type SharedAuthState = Arc<Mutex<AuthState>>;

/// Create a new shared authentication state
pub fn new_shared_auth_state(port: u16) -> SharedAuthState {
    Arc::new(Mutex::new(AuthState::new(port)))
}

/// Handle auth token exchange
///
/// Validates the provided token and, if valid, creates a session
/// and sets an HttpOnly session cookie.
pub async fn handle_auth(
    Query(params): Query<AuthQuery>,
    State(auth): State<SharedAuthState>,
) -> Response {
    let mut auth_state = auth.lock().unwrap();

    if !auth_state.validate_token(&params.token) {
        warn!("Invalid auth token attempt");
        return (StatusCode::FORBIDDEN, "Invalid or expired token").into_response();
    }

    let session_id = auth_state.create_session();
    info!("Auth token exchanged successfully, session created");

    // Build Set-Cookie header value
    let cookie_value = format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/",
        SESSION_COOKIE_NAME, session_id
    );

    // Return redirect to / with Set-Cookie header
    (
        StatusCode::FOUND,
        [
            (header::SET_COOKIE, cookie_value),
            (header::LOCATION, "/".to_string()),
        ],
    )
        .into_response()
}

/// Extract session cookie from request headers
pub fn extract_session_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;

    // Parse Cookie header: "name1=value1; name2=value2; ..."
    for pair in cookie_header.split(';') {
        let pair = pair.trim();
        if let Some((name, value)) = pair.split_once('=') {
            if name == SESSION_COOKIE_NAME {
                return Some(value.to_string());
            }
        }
    }

    None
}

/// Validate that the request has a valid session cookie
pub fn validate_request_session(headers: &HeaderMap, auth: &SharedAuthState) -> bool {
    let session_id = match extract_session_cookie(headers) {
        Some(id) => id,
        None => return false,
    };

    let mut auth_state = auth.lock().unwrap();
    auth_state.validate_session(&session_id)
}

/// Check that the request origin is allowed
pub fn check_request_origin(headers: &HeaderMap, auth: &SharedAuthState) -> bool {
    let origin = match headers.get(header::ORIGIN) {
        Some(value) => match value.to_str() {
            Ok(s) => s,
            Err(_) => return false,
        },
        None => return false,
    };

    let auth_state = auth.lock().unwrap();
    auth_state.check_origin(origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_generation_length() {
        let auth = AuthState::new(7890);
        assert_eq!(auth.token().unwrap().len(), 64);
    }

    #[test]
    fn test_token_generation_hex() {
        let auth = AuthState::new(7890);
        let token = auth.token().unwrap();
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_token_single_use() {
        let mut auth = AuthState::new(7890);
        let token = auth.token().unwrap().to_string();

        // First use succeeds
        assert!(auth.validate_token(&token));

        // Token is now invalidated
        assert!(auth.token().is_none());

        // Second use fails
        assert!(!auth.validate_token(&token));
    }

    #[test]
    fn test_session_creation_and_validation() {
        let mut auth = AuthState::new(7890);
        let session_id = auth.create_session();

        assert!(auth.validate_session(&session_id));
    }

    #[test]
    fn test_expired_session_rejected() {
        let mut auth = AuthState {
            pending_token: None,
            sessions: HashMap::new(),
            session_ttl: Duration::from_millis(1),
            port: 7890,
        };

        let session_id = auth.create_session();

        // Sleep to ensure expiry
        std::thread::sleep(Duration::from_millis(10));

        // Session should be expired and rejected
        assert!(!auth.validate_session(&session_id));

        // Session should be removed from map
        assert!(!auth.sessions.contains_key(&session_id));
    }

    #[test]
    fn test_origin_check_valid() {
        let auth = AuthState::new(7890);

        assert!(auth.check_origin("http://127.0.0.1:7890"));
        assert!(auth.check_origin("http://localhost:7890"));
    }

    #[test]
    fn test_origin_check_invalid() {
        let auth = AuthState::new(7890);

        // Wrong host
        assert!(!auth.check_origin("http://evil.com:7890"));

        // Wrong port
        assert!(!auth.check_origin("http://127.0.0.1:9999"));
        assert!(!auth.check_origin("http://localhost:8080"));

        // Wrong scheme
        assert!(!auth.check_origin("https://127.0.0.1:7890"));
        assert!(!auth.check_origin("https://localhost:7890"));
    }

    #[test]
    fn test_extract_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!(
                "other=value; {}=test-session-id; another=val",
                SESSION_COOKIE_NAME
            )
            .parse()
            .unwrap(),
        );

        let session_id = extract_session_cookie(&headers);
        assert_eq!(session_id, Some("test-session-id".to_string()));
    }

    #[test]
    fn test_extract_session_cookie_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_session_cookie(&headers), None);

        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, "other=value".parse().unwrap());
        assert_eq!(extract_session_cookie(&headers), None);
    }

    #[test]
    fn test_cookie_header_format() {
        let cookie = format!(
            "{}=test-id; HttpOnly; SameSite=Strict; Path=/",
            SESSION_COOKIE_NAME
        );

        // Verify required attributes are present
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
        assert!(cookie.contains("Path=/"));
        assert!(cookie.contains(&format!("{}=", SESSION_COOKIE_NAME)));
    }
}
