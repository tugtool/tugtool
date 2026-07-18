//! Snippets document model + HTTP handlers for `/api/snippets`.
//!
//! Backs the machine-global `snippets.json` (resolved by
//! [`tugcore::instance::snippets_path`]) with a small versioned-JSON model,
//! validation, atomic (temp-file + rename) writes, and a SHA-256 content hash
//! the frontend uses for echo suppression. `GET`/`PUT /api/snippets` are the
//! only writers; the SNIPPETS feed (`feeds/snippets.rs`) reads and pushes.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Extension;
use axum::body::Bytes;
use axum::extract::ConnectInfo;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::warn;

/// The only document version this build reads and writes.
pub const SNIPPETS_VERSION: u32 = 1;

/// Whole-document size cap at the `PUT` boundary. Snippets are a personal
/// phrasebook (kilobytes); anything approaching this is misuse. The frame the
/// feed publishes embeds the whole document, so an oversized file is exactly
/// the kind of write to reject at the boundary.
pub const MAX_SNIPPETS_DOC_BYTES: usize = 1024 * 1024;

// ── Document model (Spec S01) ──────────────────────────────────────────────

/// One reusable snippet: an opaque, client-generated `id` (stable across edits,
/// unique within the document) and its `text`. There is no title — a row's
/// handle is the *incipit*, the opening line of `text`, derived in the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    #[serde(default)]
    pub text: String,
}

/// The whole snippets document. Array position is display order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnippetsDoc {
    pub version: u32,
    pub snippets: Vec<Snippet>,
}

impl SnippetsDoc {
    /// The empty document served when `snippets.json` is missing.
    pub fn empty() -> Self {
        Self {
            version: SNIPPETS_VERSION,
            snippets: Vec::new(),
        }
    }
}

/// Validate a document against Spec S01 (write path). Rejects a version this
/// build does not write, empty ids, and duplicate ids.
pub fn validate(doc: &SnippetsDoc) -> Result<(), String> {
    if doc.version != SNIPPETS_VERSION {
        return Err(format!(
            "unsupported version {}, expected {SNIPPETS_VERSION}",
            doc.version
        ));
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for snippet in &doc.snippets {
        if snippet.id.is_empty() {
            return Err("snippet id must be non-empty".to_owned());
        }
        if !seen.insert(snippet.id.as_str()) {
            return Err(format!("duplicate snippet id: {}", snippet.id));
        }
    }
    Ok(())
}

// ── Serialization + hashing ────────────────────────────────────────────────

/// The canonical on-disk byte form: pretty JSON + trailing newline, so the
/// file stays hand-editable and diff-able. The content hash is taken over
/// exactly these bytes, so a `PUT`'s returned hash matches the feed frame's.
pub fn serialize_doc(doc: &SnippetsDoc) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(doc).expect("SnippetsDoc always serializes");
    bytes.push(b'\n');
    bytes
}

/// Lowercase hex of the SHA-256 of `bytes`.
pub fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

// ── File IO ────────────────────────────────────────────────────────────────

/// Outcome of reading `snippets.json`. `hash` is `None` only when the file
/// existed but could not be read as a valid document (`error` then carries the
/// reason). A missing file reads as the empty document with no error.
#[derive(Debug, Clone)]
pub struct ReadOutcome {
    pub doc: SnippetsDoc,
    pub hash: Option<String>,
    pub error: Option<String>,
}

/// Read and parse `snippets.json`.
///
/// - missing file → empty document, hash of the canonical empty form, no error
/// - valid file → parsed document, hash of the file bytes, no error
/// - unknown-version / parse error / unreadable → empty document, no hash, and
///   an `error` message (the caller refuses to clobber such a file)
pub fn read_snippets(path: &Path) -> ReadOutcome {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<SnippetsDoc>(&bytes) {
            Ok(doc) if doc.version == SNIPPETS_VERSION => ReadOutcome {
                doc,
                hash: Some(hash_bytes(&bytes)),
                error: None,
            },
            Ok(doc) => ReadOutcome {
                error: Some(format!(
                    "snippets.json version {} is newer than this build supports ({SNIPPETS_VERSION}); leaving it untouched",
                    doc.version
                )),
                doc: SnippetsDoc::empty(),
                hash: None,
            },
            Err(e) => ReadOutcome {
                doc: SnippetsDoc::empty(),
                hash: None,
                error: Some(format!("snippets.json is not valid JSON: {e}")),
            },
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let doc = SnippetsDoc::empty();
            let hash = hash_bytes(&serialize_doc(&doc));
            ReadOutcome {
                doc,
                hash: Some(hash),
                error: None,
            }
        }
        Err(e) => ReadOutcome {
            doc: SnippetsDoc::empty(),
            hash: None,
            error: Some(format!("could not read snippets.json: {e}")),
        },
    }
}

/// Atomically write `doc` to `path` (temp file in the same directory, then
/// `rename`) so concurrent readers never see a torn file. Returns the content
/// hash of the bytes written.
pub fn write_snippets_atomic(path: &Path, doc: &SnippetsDoc) -> std::io::Result<String> {
    use std::io::Write as _;

    let bytes = serialize_doc(doc);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)?;

    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    tmp.persist(path).map_err(|e| e.error)?;

    Ok(hash_bytes(&bytes))
}

// ── HTTP state + handlers (Spec S02) ───────────────────────────────────────

/// Shared state for the snippets HTTP handlers: the resolved file path plus a
/// [`tokio::sync::Notify`] the `PUT` handler pulses so the SNIPPETS feed rebuilds
/// immediately (rather than waiting on the filesystem-watcher debounce).
pub(crate) struct SnippetsState {
    pub(crate) path: PathBuf,
    pub(crate) rebuild: Arc<tokio::sync::Notify>,
}

impl SnippetsState {
    pub(crate) fn new(path: PathBuf, rebuild: Arc<tokio::sync::Notify>) -> Arc<Self> {
        Arc::new(Self { path, rebuild })
    }
}

/// Request body for `PUT /api/snippets`.
#[derive(Debug, Deserialize)]
struct PutSnippetsBody {
    doc: SnippetsDoc,
}

/// Return a 403 for non-loopback connections; `None` when the caller may
/// proceed. Mirrors the guard in `defaults.rs`.
fn check_loopback(handler: &str, addr: SocketAddr) -> Option<Response> {
    if addr.ip().is_loopback() {
        return None;
    }
    warn!("{handler}: rejected non-loopback connection from {addr}");
    Some(
        (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response(),
    )
}

/// Handle `GET /api/snippets`. Always 200 (even for a corrupt file, which
/// returns the empty document with a populated `error`, matching the feed
/// frame shape).
pub(crate) async fn get_snippets(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(state): Extension<Arc<SnippetsState>>,
) -> Response {
    if let Some(resp) = check_loopback("get_snippets", addr) {
        return resp;
    }

    let path = state.path.clone();
    match tokio::task::spawn_blocking(move || read_snippets(&path)).await {
        Ok(outcome) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({
                "doc": outcome.doc,
                "hash": outcome.hash,
                "error": outcome.error,
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"status": "error", "message": "internal error"})),
        )
            .into_response(),
    }
}

/// Handle `PUT /api/snippets`. Validates (S01 + size cap), refuses to clobber
/// an unreadable on-disk file (409), and atomically writes on success.
pub(crate) async fn put_snippets(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(state): Extension<Arc<SnippetsState>>,
    body: Bytes,
) -> Response {
    if let Some(resp) = check_loopback("put_snippets", addr) {
        return resp;
    }

    if body.len() > MAX_SNIPPETS_DOC_BYTES {
        warn!(
            bytes = body.len(),
            limit = MAX_SNIPPETS_DOC_BYTES,
            "put_snippets: rejecting oversized document"
        );
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            axum::Json(serde_json::json!({
                "status": "error",
                "message": format!(
                    "snippets document too large: {} bytes exceeds the {} byte limit",
                    body.len(),
                    MAX_SNIPPETS_DOC_BYTES
                ),
            })),
        )
            .into_response();
    }

    let parsed: PutSnippetsBody = match serde_json::from_slice(&body) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(
                    serde_json::json!({"status": "error", "message": format!("invalid JSON: {e}")}),
                ),
            )
                .into_response();
        }
    };

    if let Err(detail) = validate(&parsed.doc) {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"status": "error", "message": detail})),
        )
            .into_response();
    }

    let path = state.path.clone();
    let result = tokio::task::spawn_blocking(move || {
        // Refuse to overwrite a file we could not read (corrupt or a newer
        // version): `error.is_some()` only happens when the file existed.
        let existing = read_snippets(&path);
        if let Some(reason) = existing.error {
            return Err(PutError::Clobber(reason));
        }
        write_snippets_atomic(&path, &parsed.doc).map_err(|e| PutError::Io(e.to_string()))
    })
    .await;

    match result {
        Ok(Ok(hash)) => {
            // Force an immediate feed rebuild so the writer's own frontend sees
            // the change without waiting on the filesystem-watcher debounce.
            state.rebuild.notify_one();
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({"hash": hash})),
            )
                .into_response()
        }
        Ok(Err(PutError::Clobber(reason))) => (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({"status": "error", "message": reason})),
        )
            .into_response(),
        Ok(Err(PutError::Io(reason))) => {
            warn!(error = %reason, "put_snippets: write failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"status": "error", "message": "internal error"})),
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"status": "error", "message": "internal error"})),
        )
            .into_response(),
    }
}

/// Internal failure reasons for the `PUT` write path.
enum PutError {
    /// The on-disk file exists but is unreadable/corrupt — refuse to clobber.
    Clobber(String),
    /// The atomic write itself failed.
    Io(String),
}

// ── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn doc_with(ids: &[&str]) -> SnippetsDoc {
        SnippetsDoc {
            version: SNIPPETS_VERSION,
            snippets: ids
                .iter()
                .map(|id| Snippet {
                    id: (*id).to_owned(),
                    text: format!("body of {id}"),
                })
                .collect(),
        }
    }

    #[test]
    fn validate_accepts_unique_ids() {
        assert!(validate(&doc_with(&["sn_a", "sn_b"])).is_ok());
        assert!(validate(&SnippetsDoc::empty()).is_ok());
    }

    #[test]
    fn validate_rejects_duplicate_ids() {
        let err = validate(&doc_with(&["sn_a", "sn_a"])).unwrap_err();
        assert!(err.contains("duplicate"), "got: {err}");
    }

    #[test]
    fn validate_rejects_empty_id() {
        let err = validate(&doc_with(&[""])).unwrap_err();
        assert!(err.contains("non-empty"), "got: {err}");
    }

    #[test]
    fn validate_rejects_wrong_version() {
        let doc = SnippetsDoc {
            version: 2,
            snippets: Vec::new(),
        };
        assert!(validate(&doc).is_err());
    }

    #[test]
    fn missing_file_reads_as_empty_with_hash() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        let outcome = read_snippets(&path);
        assert_eq!(outcome.doc, SnippetsDoc::empty());
        assert!(outcome.error.is_none());
        assert!(outcome.hash.is_some());
    }

    #[test]
    fn atomic_write_round_trips_and_hash_is_stable() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        let doc = doc_with(&["sn_a", "sn_b"]);

        let write_hash = write_snippets_atomic(&path, &doc).unwrap();
        let outcome = read_snippets(&path);
        assert_eq!(outcome.doc, doc);
        assert_eq!(outcome.error, None);
        // The read hash equals the write hash — the echo-suppression contract.
        assert_eq!(outcome.hash.as_deref(), Some(write_hash.as_str()));
    }

    #[test]
    fn corrupt_file_surfaces_error_and_no_hash() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        std::fs::write(&path, b"{ this is not json").unwrap();
        let outcome = read_snippets(&path);
        assert!(outcome.error.is_some());
        assert!(outcome.hash.is_none());
        assert_eq!(outcome.doc, SnippetsDoc::empty());
    }

    #[test]
    fn newer_version_file_is_read_only() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("snippets.json");
        std::fs::write(&path, br#"{"version":99,"snippets":[]}"#).unwrap();
        let outcome = read_snippets(&path);
        assert!(outcome.error.is_some());
        assert!(outcome.hash.is_none());
    }
}
