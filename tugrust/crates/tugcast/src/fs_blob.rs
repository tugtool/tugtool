//! HTTP handlers for `GET /api/fs/blob` and `GET /api/fs/bytes` — raw byte
//! serving.
//!
//! Where `fs_read` returns a file's text inside a JSON envelope, these routes
//! stream the bytes themselves. The body is a stream over the open file, so
//! memory is constant regardless of file size and there is no size cap.
//!
//! The two differ in exactly one thing — how the response is typed — and that
//! difference is what each is for:
//!
//! - **`blob`** types from the extension table, because a viewer card points an
//!   `<img>` or `<embed>` straight at it. A type outside the table is refused
//!   rather than guessed at.
//! - **`bytes`** types everything as an opaque download. A caller reading an
//!   attachment to copy it into a document's `assets/` is not rendering
//!   anything, so the extension table is pure obstruction there — and it was:
//!   a `.txt` attachment could be written but never read back, which made
//!   copying one between documents silently do nothing. Serving every type is
//!   safe *because* nothing renders it: `application/octet-stream`, `nosniff`,
//!   and `Content-Disposition: attachment`.
//!
//! The response contract:
//!
//! - Loopback-only, path validated by `fs_read`'s shared guards (absolute or
//!   `~`-anchored, no `..`, secret-filter denial).
//! - `blob`'s `Content-Type` comes from an extension table, never from
//!   sniffing; an extension outside it is refused with `415`. That refusal is
//!   deliberately distinct from the `404` a missing file gets — a caller asking
//!   whether an attachment is still on disk has to be able to tell them apart.
//!   (`bytes` answers that question for every type, and is the better route to
//!   ask it on.)
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
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    ETAG, IF_NONE_MATCH, RANGE,
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

/// How a served file is typed on the way out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Typing {
    /// From the extension table, refusing anything outside it. This is what a
    /// viewer card's `<img>` / `<embed>` needs: a real media type, and a hard
    /// no for a type we would otherwise be guessing at.
    ByExtension,
    /// Opaquely — `application/octet-stream`, `nosniff`, and a download
    /// disposition — which is safe for **every** type precisely because the
    /// browser will never render it inline. A caller reading bytes to copy a
    /// file somewhere is not rendering anything, so the extension table has no
    /// business in its way.
    Opaque,
}

/// Serve `canonical` per the module contract. Split from the handler so the
/// response can be exercised directly in tests without a running server.
pub(crate) async fn serve_blob(canonical: &Path, headers: &HeaderMap) -> Response {
    serve_file(canonical, headers, Typing::ByExtension).await
}

/// Serve `canonical`'s bytes opaquely, whatever its type. See {@link Typing}.
pub(crate) async fn serve_bytes(canonical: &Path, headers: &HeaderMap) -> Response {
    serve_file(canonical, headers, Typing::Opaque).await
}

async fn serve_file(canonical: &Path, headers: &HeaderMap, typing: Typing) -> Response {
    // Existence is answered BEFORE servability, so the two refusals are
    // distinguishable. They used to share a 404, which made "this file is not
    // there" and "this file is there and I do not serve its type" the same
    // answer — and a caller asking a `HEAD` whether an attachment still exists
    // marked every `.txt` and `.zip` in a document as missing.
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

    let mime = match typing {
        Typing::Opaque => "application/octet-stream",
        Typing::ByExtension => {
            let Some(mime) = canonical
                .extension()
                .and_then(|ext| ext.to_str())
                .and_then(mime_for_extension)
            else {
                return error_response(fs_error(
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "unsupported_type",
                ));
            };
            mime
        }
    };

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

    let mut builder = Response::builder()
        .header(CONTENT_TYPE, mime)
        .header(ETAG, &etag)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "no-cache")
        .header("x-content-type-options", "nosniff");
    if typing == Typing::Opaque {
        // Belt to `nosniff`'s braces. These bytes are read by `fetch` into a
        // Blob and never pointed at by a `src`, but a URL is a URL — and this
        // route serves types (`.html`, `.svg`) that a navigation would happily
        // execute at the deck's own origin. A download disposition is what
        // makes serving *every* type the safe thing rather than the risky one.
        builder = builder.header(CONTENT_DISPOSITION, "attachment");
    }

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

/// Handle `GET /api/fs/bytes?path=<abs>`. Restricted to loopback.
///
/// The same guards and the same streaming as the blob route, with no extension
/// table: a caller reading an attachment's bytes to copy it somewhere needs
/// every type, and the download disposition is what makes that safe.
pub(crate) async fn get_fs_bytes(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<BlobQuery>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("get_fs_bytes: rejected non-loopback connection from {addr}");
        return error_response(fs_error(StatusCode::FORBIDDEN, "denied"));
    }
    let canonical = match guard_absolute_path(&query.path) {
        Ok(canonical) => canonical,
        Err(err) => return error_response(err),
    };
    serve_bytes(&canonical, &headers).await
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
            assert_eq!(
                parse_range(spec, 1000),
                RangeRequest::Unsatisfiable,
                "{spec}"
            );
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
    async fn an_unservable_type_is_refused_but_not_reported_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, b"text").unwrap();

        // 415, not 404: the file is right there. A caller asking `HEAD` whether
        // an attachment still exists reads a 404 as "gone and the link is
        // broken", which every non-image attachment in a document would be.
        let response = serve_blob(&path, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);

        // And a file of that same unservable type that is genuinely absent
        // still answers 404 — the whole point of separating the two.
        let response = serve_blob(&dir.path().join("gone.txt"), &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// Every type the blob route refuses, and a few it never heard of. An
    /// attachment can be any file at all, so "no file type left behind" is the
    /// contract — not a longer table.
    #[tokio::test]
    async fn the_bytes_route_serves_every_type() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "notes.txt",
            "archive.zip",
            "deck.key",
            "sheet.xlsx",
            "drawing.svg",
            "page.html",
            "raw.nef",
            "script.sh",
            "README",
            ".env.example",
            "photo.png",
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, b"bytes for everyone").unwrap();

            let response = serve_bytes(&path, &HeaderMap::new()).await;
            assert_eq!(response.status(), StatusCode::OK, "serving {name}");
            let headers = response.headers().clone();
            assert_eq!(
                headers.get(CONTENT_TYPE).unwrap(),
                "application/octet-stream",
                "typing {name}",
            );
            // The two headers that make serving an arbitrary type safe: it is
            // never sniffed into something renderable, and a navigation to the
            // URL downloads rather than executes at the deck's own origin.
            assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
            assert_eq!(headers.get(CONTENT_DISPOSITION).unwrap(), "attachment");
            assert_eq!(body_bytes(response).await, b"bytes for everyone");
        }
    }

    #[tokio::test]
    async fn the_bytes_route_reports_absence_and_non_files() {
        let dir = tempfile::tempdir().unwrap();

        // The existence question every asset projection asks, and it has to be
        // answerable for a type the blob route would have refused outright.
        let response = serve_bytes(&dir.path().join("gone.txt"), &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let subdir = dir.path().join("folder.txt");
        std::fs::create_dir(&subdir).unwrap();
        let response = serve_bytes(&subdir, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn the_bytes_route_keeps_the_blob_route_s_streaming_contract() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.zip");
        std::fs::write(&path, b"0123456789").unwrap();

        let response = serve_bytes(&path, &headers_with(RANGE, "bytes=2-5")).await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes 2-5/10"
        );
        assert_eq!(body_bytes(response).await, b"2345");

        let etag = serve_bytes(&path, &HeaderMap::new())
            .await
            .headers()
            .get(ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let response = serve_bytes(&path, &headers_with(IF_NONE_MATCH, &etag)).await;
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
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
        for denied in [
            "/project/.env",
            "/home/user/.ssh/id_rsa.png",
            "/tmp/server.pem",
        ] {
            let err = guard_absolute_path(denied).unwrap_err();
            assert_eq!(err.0, StatusCode::FORBIDDEN, "expected denial for {denied}");
        }
    }
}
