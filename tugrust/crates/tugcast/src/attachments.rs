//! Attachment storage: `POST /api/attachments` and `POST /api/fs/attach`.
//!
//! Attachments are ordinary files. There is no blob table, no app-scheme
//! link, no localhost URL — a link that only Tug can resolve is a link that
//! is dead the moment the document leaves the app, and tugcast's port is
//! reallocated per launch anyway. Both routes therefore answer the same
//! question in two ways: *where do these bytes go, and what string does the
//! calling surface hold afterwards.*
//!
//! - `POST /api/attachments` — the composer's draft tier. The server picks
//!   the location: `data_dir()/draft-attachments/<uuid>.<ext>`, one directory
//!   over from the Gazette's `gazette-attachments`. The caller names only a
//!   media type; the response is the absolute path. Files here are transient
//!   by nature and are reclaimed by the startup sweep in `draft_gc`.
//! - `POST /api/fs/attach` — the document tier. The caller names the markdown
//!   document being edited and the filename it wants; the bytes land in a
//!   sibling `assets/` folder and the response carries both the absolute path
//!   and the document-relative one that goes into the markdown link.
//!
//! Both take raw file bytes as the request body rather than base64 inside
//! JSON: base64 costs 1.33× before JSON escaping, which is what forced
//! `fs_write`'s 6× body ceiling.
//!
//! The extension is never guessed. `attachment_extension` maps a media type
//! to an extension that `fs_blob::mime_for_extension` can serve back, and
//! returns `None` otherwise — storing bytes under an extension the blob route
//! refuses would produce a write-only file that consumes disk and can never
//! rehydrate.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;

use crate::fs_read::{fs_error, guard_absolute_path};

/// Max request body for either upload route. Raw bytes, so this is the
/// file size itself rather than an inflated envelope. Loopback-only keeps
/// the ceiling off the DoS surface.
pub(crate) const MAX_ATTACHMENT_BODY_BYTES: usize = 64 * 1024 * 1024;

/// The filename extension to store a media type under, or `None` when the
/// type is outside the set `fs_blob` can serve back.
///
/// This is the reverse of `fs_blob::mime_for_extension`, and the two are
/// pinned to agree by a unit test below: every extension this returns must
/// have an arm there, or the stored file would be unreadable through
/// `GET /api/fs/blob` and the attachment could never rehydrate.
///
/// Parameters are ignored — `image/png; charset=binary` is `image/png`.
pub(crate) fn attachment_extension(media_type: &str) -> Option<&'static str> {
    let base = media_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match base.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/heic" => Some("heic"),
        "image/heif" => Some("heif"),
        "image/avif" => Some("avif"),
        "image/tiff" => Some("tiff"),
        "image/bmp" => Some("bmp"),
        "image/vnd.microsoft.icon" | "image/x-icon" => Some("ico"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

/// Process-wide counter making every temp filename unique, so two concurrent
/// uploads into one directory can never share — and corrupt — a temp file.
fn next_temp_seq() -> u64 {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Write `bytes` to `target` atomically: hidden temp file in the target's
/// own directory (same filesystem), fsync, rename. A reader — including the
/// blob route serving the file back — never observes a partial attachment.
pub(crate) fn write_attachment_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent")
    })?;
    let file_name = target.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no file name")
    })?;
    let temp_path = parent.join(format!(
        ".{}.tug-tmp-{}-{}",
        file_name.to_string_lossy(),
        std::process::id(),
        next_temp_seq(),
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp_path, target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

/// The directory the composer's draft attachments rest in. Per-instance:
/// `tugbank.db` is per-instance too, so a draft and its bytes always live in
/// the same instance directory and are removed together by an instance prune.
pub(crate) fn draft_attachments_dir() -> PathBuf {
    tugcore::instance::data_dir().join("draft-attachments")
}

/// Query string for `POST /api/attachments`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentsQuery {
    media_type: String,
}

/// Store draft-tier bytes and report where they landed. Synchronous so it can
/// be unit-tested directly; the handler runs it under `spawn_blocking`.
fn store_draft_attachment(dir: &Path, media_type: &str, bytes: &[u8]) -> (StatusCode, Value) {
    let Some(ext) = attachment_extension(media_type) else {
        return fs_error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type");
    };
    if let Err(err) = std::fs::create_dir_all(dir) {
        warn!(error = %err, "attachments: draft dir unavailable");
        return fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal");
    }
    let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    if let Err(err) = write_attachment_atomic(&path, bytes) {
        warn!(error = %err, "attachments: draft write failed");
        return fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal");
    }
    (StatusCode::OK, json!({ "path": path.to_string_lossy() }))
}

/// Handle `POST /api/attachments`. Restricted to loopback.
///
/// No path is accepted from the caller, so there is nothing to guard and
/// nothing to canonicalize: the response path is built from `data_dir()` and
/// is canonical by construction.
pub(crate) async fn post_attachments(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(query): Query<AttachmentsQuery>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("post_attachments: rejected non-loopback connection from {addr}");
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "denied" })),
        )
            .into_response();
    }
    let dir = draft_attachments_dir();
    let result =
        tokio::task::spawn_blocking(move || store_draft_attachment(&dir, &query.media_type, &body))
            .await;
    match result {
        Ok((status, body)) => (status, axum::Json(body)).into_response(),
        Err(_join_err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": "internal" })),
        )
            .into_response(),
    }
}

/// Query string for `POST /api/fs/attach`: the document being edited and the
/// filename the caller wants the asset to keep.
#[derive(Debug, Deserialize)]
pub(crate) struct AttachQuery {
    doc: String,
    name: String,
}

/// Accept `name` as an asset filename, or say why not.
///
/// The name becomes a single child of the document's `assets/` directory, so
/// it must not be able to name anything else: no separators, no `..`, no
/// empty name, and no leading dot (a dotfile asset would be invisible in the
/// folder the link points at, and the temp files this module writes are
/// themselves dot-prefixed).
pub(crate) fn validate_asset_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Err("bad_name");
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("bad_name");
    }
    // A leading dot covers `.`, `..`, and dotfiles in one rule.
    if name.starts_with('.') {
        return Err("bad_name");
    }
    // Belt and braces: whatever the platform considers a separator, the name
    // has to be exactly one ordinary component.
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(part)), None) if part == name => Ok(()),
        _ => Err("bad_name"),
    }
}

/// The filename `name` should take inside `dir`, appending `-2`, `-3`, … before
/// the extension until nothing is in the way.
///
/// The original name is kept when it is free: these links are meant to be read
/// in the markdown source, so a content hash would make the document opaque.
pub(crate) fn resolve_collision_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string());
    let ext = path.extension().map(|s| s.to_string_lossy().into_owned());
    let mut n = 2u32;
    loop {
        let candidate = match &ext {
            Some(ext) => format!("{stem}-{n}.{ext}"),
            None => format!("{stem}-{n}"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Write `bytes` into `doc`'s sibling `assets/` folder. Synchronous so it can
/// be unit-tested directly; the handler runs it under `spawn_blocking`.
///
/// `doc` must already have passed `guard_absolute_path` — it arrives canonical.
fn store_doc_attachment(doc: &Path, name: &str, bytes: &[u8]) -> (StatusCode, Value) {
    if let Err(error) = validate_asset_name(name) {
        return fs_error(StatusCode::BAD_REQUEST, error);
    }
    // The document must be an existing regular file. This is what bounds the
    // directory-creation relaxation below: the route can only ever create a
    // single `assets/` child of a directory that already holds a real file,
    // never `mkdir -p` into an arbitrary nonexistent tree.
    match std::fs::metadata(doc) {
        Ok(md) if md.is_file() => {}
        Ok(_) => return fs_error(StatusCode::NOT_FOUND, "not_found"),
        Err(_) => return fs_error(StatusCode::NOT_FOUND, "not_found"),
    }
    let Some(parent) = doc.parent() else {
        return fs_error(StatusCode::BAD_REQUEST, "bad_path");
    };
    let assets = parent.join("assets");
    if let Err(err) = std::fs::create_dir_all(&assets) {
        warn!(error = %err, "attachments: assets dir unavailable");
        return fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal");
    }
    let final_name = resolve_collision_name(&assets, name);
    let path = assets.join(&final_name);
    if let Err(err) = write_attachment_atomic(&path, bytes) {
        warn!(error = %err, "attachments: asset write failed");
        return fs_error(StatusCode::INTERNAL_SERVER_ERROR, "internal");
    }
    (
        StatusCode::OK,
        json!({
            "path": path.to_string_lossy(),
            "relativePath": format!("assets/{final_name}"),
        }),
    )
}

/// Handle `POST /api/fs/attach`. Restricted to loopback.
///
/// `guard_absolute_path` is the canonicalization gateway for `doc`; every path
/// this route returns is derived from its output and is canonical in turn.
///
/// Unlike `fs_write`, this route creates a missing directory anywhere on disk.
/// That is the gesture: creating `assets/` next to the document is what a drop
/// on a Text card *means*, and confining it to the Tug-owned roots would defeat
/// the portability the sibling-folder layout exists for. The relaxation is
/// bounded by loopback-only, `guard_absolute_path`, and the existing-regular-file
/// requirement on `doc`.
pub(crate) async fn post_fs_attach(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(query): Query<AttachQuery>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("post_fs_attach: rejected non-loopback connection from {addr}");
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "denied" })),
        )
            .into_response();
    }
    let doc = match guard_absolute_path(&query.doc) {
        Ok(canonical) => canonical,
        Err((status, body)) => return (status, axum::Json(body)).into_response(),
    };
    let name = query.name;
    let result =
        tokio::task::spawn_blocking(move || store_doc_attachment(&doc, &name, &body)).await;
    match result {
        Ok((status, body)) => (status, axum::Json(body)).into_response(),
        Err(_join_err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": "internal" })),
        )
            .into_response(),
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// The invariant the whole "no `.img` fallback" position rests on: every
    /// extension we are willing to store under is one the blob route will
    /// serve back. A mapping that fails this produces write-only files.
    #[test]
    fn every_mapped_extension_is_servable() {
        for media_type in [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/heic",
            "image/heif",
            "image/avif",
            "image/tiff",
            "image/bmp",
            "image/vnd.microsoft.icon",
            "image/x-icon",
            "application/pdf",
        ] {
            let ext = attachment_extension(media_type)
                .unwrap_or_else(|| panic!("{media_type} should map to an extension"));
            assert!(
                crate::fs_blob::mime_for_extension(ext).is_some(),
                "{media_type} maps to .{ext}, which /api/fs/blob cannot serve",
            );
        }
    }

    #[test]
    fn unmapped_media_types_yield_none() {
        // SVG is the live case: the drop gate admits it, `fs_blob`
        // deliberately does not serve it, so it is declined rather than
        // stored somewhere it could never be read back from.
        assert_eq!(attachment_extension("image/svg+xml"), None);
        assert_eq!(attachment_extension("text/plain"), None);
        assert_eq!(attachment_extension("application/zip"), None);
        assert_eq!(attachment_extension(""), None);
    }

    #[test]
    fn media_type_parameters_and_case_are_ignored() {
        assert_eq!(attachment_extension("IMAGE/PNG"), Some("png"));
        assert_eq!(
            attachment_extension("image/png; charset=binary"),
            Some("png")
        );
        assert_eq!(attachment_extension("  image/jpeg  "), Some("jpg"));
    }

    #[test]
    fn atomic_write_produces_exact_bytes_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("photo.png");
        let bytes: Vec<u8> = (0u8..=255).cycle().take(5000).collect();
        write_attachment_atomic(&target, &bytes).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), bytes);
        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["photo.png".to_string()]);
    }

    #[test]
    fn draft_attachment_lands_in_the_dir_with_a_uuid_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("draft-attachments");
        let (status, body) = store_draft_attachment(&root, "image/png", b"PNGBYTES");
        assert_eq!(status, StatusCode::OK);
        let path = PathBuf::from(body["path"].as_str().unwrap());
        assert!(path.is_absolute());
        assert_eq!(path.parent().unwrap(), root);
        assert_eq!(path.extension().unwrap(), "png");
        assert!(
            uuid::Uuid::parse_str(path.file_stem().unwrap().to_str().unwrap()).is_ok(),
            "stem should be a uuid: {path:?}",
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"PNGBYTES");
    }

    #[test]
    fn draft_attachment_refuses_an_unmapped_media_type() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("draft-attachments");
        let (status, body) = store_draft_attachment(&root, "image/svg+xml", b"<svg/>");
        assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert_eq!(body["error"], "unsupported_media_type");
        // Nothing was created — not even the directory.
        assert!(!root.exists());
    }

    #[test]
    fn asset_names_that_could_escape_the_folder_are_refused() {
        assert!(validate_asset_name("photo.png").is_ok());
        assert!(validate_asset_name("my photo (2).png").is_ok());
        assert!(validate_asset_name("README").is_ok());
        assert!(validate_asset_name("").is_err());
        assert!(validate_asset_name("..").is_err());
        assert!(validate_asset_name(".hidden").is_err());
        assert!(validate_asset_name("../photo.png").is_err());
        assert!(validate_asset_name("sub/photo.png").is_err());
        assert!(validate_asset_name("sub\\photo.png").is_err());
        assert!(validate_asset_name("/etc/passwd").is_err());
    }

    #[test]
    fn collisions_suffix_before_the_extension() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(resolve_collision_name(dir.path(), "photo.png"), "photo.png");
        std::fs::write(dir.path().join("photo.png"), b"a").unwrap();
        assert_eq!(
            resolve_collision_name(dir.path(), "photo.png"),
            "photo-2.png"
        );
        std::fs::write(dir.path().join("photo-2.png"), b"a").unwrap();
        assert_eq!(
            resolve_collision_name(dir.path(), "photo.png"),
            "photo-3.png"
        );
    }

    #[test]
    fn collisions_on_an_extensionless_name_suffix_at_the_end() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("NOTES"), b"a").unwrap();
        assert_eq!(resolve_collision_name(dir.path(), "NOTES"), "NOTES-2");
    }

    #[test]
    fn collisions_keep_a_multi_dot_name_intact() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("archive.tar.gz"), b"a").unwrap();
        assert_eq!(
            resolve_collision_name(dir.path(), "archive.tar.gz"),
            "archive.tar-2.gz",
        );
    }

    #[test]
    fn doc_attachment_lands_in_a_sibling_assets_folder() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("foo.md");
        std::fs::write(&doc, b"# hi").unwrap();

        let (status, body) = store_doc_attachment(&doc, "photo.png", b"PNGBYTES");
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["relativePath"], "assets/photo.png");
        let path = PathBuf::from(body["path"].as_str().unwrap());
        assert_eq!(path, dir.path().join("assets").join("photo.png"));
        assert_eq!(std::fs::read(&path).unwrap(), b"PNGBYTES");

        // A second drop of the same name suffixes rather than clobbering.
        let (status, body) = store_doc_attachment(&doc, "photo.png", b"OTHER");
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["relativePath"], "assets/photo-2.png");
        assert_eq!(std::fs::read(&path).unwrap(), b"PNGBYTES");
    }

    #[test]
    fn doc_attachment_refuses_a_bad_name_before_creating_anything() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("foo.md");
        std::fs::write(&doc, b"# hi").unwrap();

        let (status, body) = store_doc_attachment(&doc, "../escape.png", b"x");
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "bad_name");
        assert!(!dir.path().join("assets").exists());
    }

    /// The bound on this route's directory-creation relaxation: a `doc` that
    /// is not an existing regular file is refused *before* any directory is
    /// created, so the route can never `mkdir -p` into an arbitrary tree.
    #[test]
    fn doc_attachment_refuses_a_nonexistent_or_directory_doc() {
        let dir = tempfile::tempdir().unwrap();

        let missing = dir.path().join("nowhere").join("foo.md");
        let (status, body) = store_doc_attachment(&missing, "photo.png", b"x");
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "not_found");
        assert!(!dir.path().join("nowhere").exists());

        let subdir = dir.path().join("adir");
        std::fs::create_dir(&subdir).unwrap();
        let (status, _) = store_doc_attachment(&subdir, "photo.png", b"x");
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(!dir.path().join("assets").exists());
    }
}
