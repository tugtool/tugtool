//! HTTP handler for `GET /api/fs/blob` — raw byte serving for viewer cards.
//!
//! Where `fs_read` returns a file's text inside a JSON envelope, this route
//! streams the bytes themselves so a viewer card can point an `<img>` or
//! `<embed>` straight at a URL. The body is a stream over the open file, so
//! memory is constant regardless of file size and there is no size cap.
//!
//! The response contract:
//!
//! - Loopback-only, path validated by `fs_read`'s shared guards (absolute or
//!   `~`-anchored, no `..`, secret-filter denial).
//! - `Content-Type` comes from an extension table, never from sniffing; an
//!   extension outside the table is refused rather than served as
//!   `application/octet-stream`.
//! - `ETag` is `"<mtime_ms>-<size>"`; a matching `If-None-Match` gets a bare
//!   `304`, so a remounted card revalidates instead of re-pulling megabytes.
//! - A single-range `Range: bytes=` request gets `206` with `Content-Range`;
//!   an unsatisfiable or malformed one gets `416`. Multi-range requests are
//!   answered with the full `200` body.
//!
//! Errors carry the shared `{ "error": … }` JSON body for tooling, but the
//! status code is the contract — an `<img>` never reads the body.

use std::io::SeekFrom;
use std::net::SocketAddr;
use std::path::Path;

use axum::body::Body;
use axum::extract::{ConnectInfo, Query};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
    RANGE,
};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tracing::warn;

use crate::fs_read::{fs_error, guard_absolute_path, mtime_ms};

/// Query string for `GET /api/fs/blob`: the absolute path to serve.
#[derive(Debug, Deserialize)]
pub(crate) struct BlobQuery {
    path: String,
}

/// The `Content-Type` for a file extension, or `None` when the extension is
/// outside the viewable set. Matching is case-insensitive.
pub(crate) fn mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" | "jfif" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "avif" => Some("image/avif"),
        "tiff" | "tif" => Some("image/tiff"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/vnd.microsoft.icon"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

/// What a `Range` header asks for, resolved against the file's total size.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RangeRequest {
    /// Serve the whole file: no range header, an unsupported range unit, or
    /// a multi-range request.
    Full,
    /// Serve `start..=end` (inclusive, already clamped to the file).
    Partial { start: u64, end: u64 },
    /// The range cannot be satisfied, or the header is malformed.
    Unsatisfiable,
}

/// Resolve a `Range` header value against a file of `total` bytes.
pub(crate) fn parse_range(header: &str, total: u64) -> RangeRequest {
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        // An unrecognized range unit is ignored, per RFC 9110.
        return RangeRequest::Full;
    };
    if spec.contains(',') {
        return RangeRequest::Full;
    }
    let spec = spec.trim();
    let Some((raw_start, raw_end)) = spec.split_once('-') else {
        return RangeRequest::Unsatisfiable;
    };
    let (raw_start, raw_end) = (raw_start.trim(), raw_end.trim());

    // `bytes=-N`: the final N bytes.
    if raw_start.is_empty() {
        let Ok(suffix) = raw_end.parse::<u64>() else {
            return RangeRequest::Unsatisfiable;
        };
        if suffix == 0 || total == 0 {
            return RangeRequest::Unsatisfiable;
        }
        let start = total.saturating_sub(suffix);
        return RangeRequest::Partial {
            start,
            end: total - 1,
        };
    }

    let Ok(start) = raw_start.parse::<u64>() else {
        return RangeRequest::Unsatisfiable;
    };
    if total == 0 || start >= total {
        return RangeRequest::Unsatisfiable;
    }
    let end = if raw_end.is_empty() {
        total - 1
    } else {
        let Ok(end) = raw_end.parse::<u64>() else {
            return RangeRequest::Unsatisfiable;
        };
        if end < start {
            return RangeRequest::Unsatisfiable;
        }
        end.min(total - 1)
    };
    RangeRequest::Partial { start, end }
}

/// True when an `If-None-Match` header value matches `etag`. Handles the
/// `*` wildcard, comma-separated lists, and the weak-validator prefix.
fn if_none_match_hits(header: &str, etag: &str) -> bool {
    header.split(',').any(|candidate| {
        let candidate = candidate.trim();
        candidate == "*" || candidate.trim_start_matches("W/") == etag
    })
}

/// Turn an error pair into the JSON response the fs endpoints share.
fn error_response((status, body): (StatusCode, Value)) -> Response {
    (status, axum::Json(body)).into_response()
}

/// Serve `canonical` per the module contract. Split from the handler so the
/// response can be exercised directly in tests without a running server.
pub(crate) async fn serve_blob(canonical: &Path, headers: &HeaderMap) -> Response {
    let Some(mime) = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(mime_for_extension)
    else {
        return error_response(fs_error(StatusCode::NOT_FOUND, "unsupported_type"));
    };

    let metadata = match tokio::fs::metadata(canonical).await {
        Ok(md) => md,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return error_response(fs_error(StatusCode::NOT_FOUND, "not_found"));
        }
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return error_response(fs_error(StatusCode::FORBIDDEN, "denied"));
        }
        Err(_) => return error_response(fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal")),
    };
    if !metadata.is_file() {
        return error_response(fs_error(StatusCode::BAD_REQUEST, "bad_path"));
    }

    let total = metadata.len();
    let etag = format!("\"{}-{}\"", mtime_ms(&metadata), total);

    let revalidated = headers
        .get(IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|inm| if_none_match_hits(inm, &etag));
    if revalidated {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(ETAG, &etag)
            .header(CACHE_CONTROL, "no-cache")
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    let range = match headers.get(RANGE).and_then(|v| v.to_str().ok()) {
        Some(raw) => parse_range(raw, total),
        None => RangeRequest::Full,
    };
    if range == RangeRequest::Unsatisfiable {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(CONTENT_RANGE, format!("bytes */{total}"))
            .header(ACCEPT_RANGES, "bytes")
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    let mut file = match tokio::fs::File::open(canonical).await {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return error_response(fs_error(StatusCode::NOT_FOUND, "not_found"));
        }
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return error_response(fs_error(StatusCode::FORBIDDEN, "denied"));
        }
        Err(_) => return error_response(fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal")),
    };

    let builder = Response::builder()
        .header(CONTENT_TYPE, mime)
        .header(ETAG, &etag)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "no-cache")
        .header("x-content-type-options", "nosniff");

    let built = match range {
        RangeRequest::Partial { start, end } => {
            if file.seek(SeekFrom::Start(start)).await.is_err() {
                return error_response(fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal"));
            }
            let len = end - start + 1;
            let stream = ReaderStream::new(file.take(len));
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(CONTENT_LENGTH, len)
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .body(Body::from_stream(stream))
        }
        _ => builder
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, total)
            .body(Body::from_stream(ReaderStream::new(file))),
    };
    built.unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Handle `GET /api/fs/blob?path=<abs>`. Restricted to loopback.
pub(crate) async fn get_fs_blob(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<BlobQuery>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("get_fs_blob: rejected non-loopback connection from {addr}");
        return error_response(fs_error(StatusCode::FORBIDDEN, "denied"));
    }
    let canonical = match guard_absolute_path(&query.path) {
        Ok(canonical) => canonical,
        Err(err) => return error_response(err),
    };
    serve_blob(&canonical, &headers).await
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    /// Every extension the frontend classifier routes to a viewer card.
    /// Kept in lockstep with `tugdeck/src/lib/file-kinds.ts` — a type added
    /// on one side and missed on the other is the drift this pins.
    const VIEWABLE_EXTENSIONS: &[(&str, &str)] = &[
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("jfif", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
        ("heic", "image/heic"),
        ("heif", "image/heif"),
        ("avif", "image/avif"),
        ("tiff", "image/tiff"),
        ("tif", "image/tiff"),
        ("bmp", "image/bmp"),
        ("ico", "image/vnd.microsoft.icon"),
        ("pdf", "application/pdf"),
    ];

    fn headers_with(name: axum::http::HeaderName, value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(name, HeaderValue::from_str(value).unwrap());
        headers
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    #[test]
    fn mime_table_covers_exactly_the_viewable_extensions() {
        for (ext, mime) in VIEWABLE_EXTENSIONS {
            assert_eq!(mime_for_extension(ext), Some(*mime), "extension {ext}");
            assert_eq!(
                mime_for_extension(&ext.to_uppercase()),
                Some(*mime),
                "uppercase {ext}"
            );
        }
        for ext in ["svg", "txt", "rs", "nef", "psd", "mp4", ""] {
            assert_eq!(mime_for_extension(ext), None, "extension {ext}");
        }
    }

    #[test]
    fn range_forms_resolve_against_total() {
        assert_eq!(
            parse_range("bytes=0-99", 1000),
            RangeRequest::Partial { start: 0, end: 99 }
        );
        // An open-ended range runs to the last byte.
        assert_eq!(
            parse_range("bytes=500-", 1000),
            RangeRequest::Partial {
                start: 500,
                end: 999
            }
        );
        // A suffix range counts back from the end.
        assert_eq!(
            parse_range("bytes=-100", 1000),
            RangeRequest::Partial {
                start: 900,
                end: 999
            }
        );
        // A suffix longer than the file clamps to the whole file.
        assert_eq!(
            parse_range("bytes=-5000", 1000),
            RangeRequest::Partial { start: 0, end: 999 }
        );
        // An end past the last byte clamps.
        assert_eq!(
            parse_range("bytes=900-5000", 1000),
            RangeRequest::Partial {
                start: 900,
                end: 999
            }
        );
    }

    #[test]
    fn multi_range_and_foreign_units_serve_the_whole_file() {
        assert_eq!(parse_range("bytes=0-9,20-29", 1000), RangeRequest::Full);
        assert_eq!(parse_range("items=0-9", 1000), RangeRequest::Full);
    }

    #[test]
    fn malformed_and_out_of_bounds_ranges_are_unsatisfiable() {
        for spec in [
            "bytes=1000-1099", // start at/past EOF
            "bytes=abc",
            "bytes=abc-def",
            "bytes=50-10", // end before start
            "bytes=-0",
        ] {
            assert_eq!(parse_range(spec, 1000), RangeRequest::Unsatisfiable, "{spec}");
        }
        assert_eq!(parse_range("bytes=0-0", 0), RangeRequest::Unsatisfiable);
    }

    #[tokio::test]
    async fn full_read_carries_type_length_and_etag() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pixel.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nfake").unwrap();

        let response = serve_blob(&path, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(response.headers()[CONTENT_LENGTH], "12");
        assert_eq!(response.headers()[ACCEPT_RANGES], "bytes");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        let etag = response.headers()[ETAG].to_str().unwrap().to_string();
        assert!(etag.ends_with("-12\""), "etag carries size: {etag}");
        assert_eq!(body_bytes(response).await, b"\x89PNG\r\n\x1a\nfake");
    }

    #[tokio::test]
    async fn file_larger_than_the_read_cap_streams_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.tiff");
        let size = crate::fs_read::MAX_READ_BYTES + 4096;
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(size).unwrap();
        drop(file);

        let response = serve_blob(&path, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_LENGTH], size.to_string());
        assert_eq!(body_bytes(response).await.len() as u64, size);
    }

    #[tokio::test]
    async fn range_request_returns_the_requested_slice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bytes.gif");
        let content: Vec<u8> = (0..=255u8).collect();
        std::fs::write(&path, &content).unwrap();

        let response = serve_blob(&path, &headers_with(RANGE, "bytes=10-19")).await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 10-19/256");
        assert_eq!(response.headers()[CONTENT_LENGTH], "10");
        assert_eq!(body_bytes(response).await, content[10..=19]);
    }

    #[tokio::test]
    async fn unsatisfiable_range_reports_the_total() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("small.bmp");
        std::fs::write(&path, b"0123456789").unwrap();

        let response = serve_blob(&path, &headers_with(RANGE, "bytes=100-200")).await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes */10");
    }

    #[tokio::test]
    async fn matching_if_none_match_is_not_modified() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cached.jpeg");
        std::fs::write(&path, b"jpegbytes").unwrap();

        let first = serve_blob(&path, &HeaderMap::new()).await;
        let etag = first.headers()[ETAG].to_str().unwrap().to_string();

        let response = serve_blob(&path, &headers_with(IF_NONE_MATCH, &etag)).await;
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert!(body_bytes(response).await.is_empty());

        // A stale validator gets the bytes.
        let response = serve_blob(&path, &headers_with(IF_NONE_MATCH, "\"0-0\"")).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn unknown_extension_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, b"text").unwrap();

        let response = serve_blob(&path, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn missing_file_and_directory_are_distinguished() {
        let dir = tempfile::tempdir().unwrap();
        let response = serve_blob(&dir.path().join("absent.png"), &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let subdir = dir.path().join("pictures.png");
        std::fs::create_dir(&subdir).unwrap();
        let response = serve_blob(&subdir, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn secret_paths_are_denied_by_the_shared_guard() {
        for denied in ["/project/.env", "/home/user/.ssh/id_rsa.png", "/tmp/server.pem"] {
            let err = guard_absolute_path(denied).unwrap_err();
            assert_eq!(err.0, StatusCode::FORBIDDEN, "expected denial for {denied}");
        }
    }
}
