//! External-session scanner — JSONL metadata extraction for sessions
//! that have no `SessionLedger` row (typically sessions created by the
//! Claude Code terminal app).
//!
//! The picker's `list_sessions` response is a union of ledger rows and
//! the on-disk reality under `~/.claude/projects/<encoded-dir>/`. This
//! module supplies the on-disk half: for each candidate `*.jsonl` it
//! extracts the metadata the picker renders (turn count, last user
//! prompt, auto-title, timestamps) in a single streaming pass — no
//! full-file buffering, so multi-hundred-MB transcripts stream in
//! bounded memory.
//!
//! Exclusion rules guard against two hazards of the lossy `/`→`-`
//! directory encoding and the shared-directory layout:
//!
//! - A record-level `cwd` that differs from the queried `project_dir`
//!   means the file belongs to a *different* project whose absolute
//!   path encodes to the same directory name; the file is skipped.
//! - A record-level `sessionId` that differs from the filename stem
//!   means the file is not a plain session transcript; skipped.
//!
//! The user-submission test mirrors tugcode's `isUserSubmissionContent`
//! (`tugcode/src/session.ts`): string `message.content`, or an array
//! carrying at least one non-`tool_result` block. Keep the two in sync.

#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::session_ledger::{
    ScanCacheRow, SessionLedger, USER_PROMPT_MAX_CHARS, claude_project_dir,
};

/// Metadata extracted from one external session JSONL — the picker-
/// facing subset, plus the `(file_size, file_mtime)` validity pair the
/// scan cache keys on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalSessionMeta {
    pub session_id: String,
    pub turn_count: i64,
    pub last_user_prompt: Option<String>,
    /// Auto-title from the last `ai-title` record (`aiTitle` field),
    /// when the transcript carries one.
    pub name: Option<String>,
    pub created_at: i64,
    pub last_used_at: i64,
    pub file_size: i64,
    pub file_mtime: i64,
}

/// Why a candidate file was excluded from the scan. Surfaced only via
/// tracing; the wire never carries exclusions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Exclusion {
    CwdMismatch,
    SessionIdMismatch,
    Unreadable,
}

/// True when `stem` looks like a claude session UUID
/// (8-4-4-4-12 lowercase hex). Anything else under the project dir is
/// not a session transcript.
fn is_uuid_stem(stem: &str) -> bool {
    let bytes = stem.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *b != b'-' {
                    return false;
                }
            }
            _ => {
                if !b.is_ascii_hexdigit() || b.is_ascii_uppercase() {
                    return false;
                }
            }
        }
    }
    true
}

/// Mirror of tugcode's `isUserSubmissionContent`: a genuine user
/// submission is string content, or an array with at least one block
/// whose `type` is not `tool_result`.
fn is_user_submission_content(content: &serde_json::Value) -> bool {
    match content {
        serde_json::Value::String(_) => true,
        serde_json::Value::Array(blocks) => blocks.iter().any(|block| {
            block
                .as_object()
                .map(|o| o.get("type").and_then(|t| t.as_str()) != Some("tool_result"))
                .unwrap_or(false)
        }),
        _ => false,
    }
}

/// Extract the submission's display text: string content verbatim, or
/// the concatenated `text` fields of array content.
fn submission_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| {
                let o = block.as_object()?;
                if o.get("type").and_then(|t| t.as_str()) == Some("text") {
                    o.get("text").and_then(|t| t.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Char-boundary-safe truncation to `USER_PROMPT_MAX_CHARS`.
fn truncate_prompt(text: &str) -> String {
    text.chars().take(USER_PROMPT_MAX_CHARS).collect()
}

/// Parse an ISO-8601 record timestamp to unix millis.
fn parse_timestamp_millis(raw: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Stream one candidate JSONL and extract its metadata.
///
/// `Ok(None)` means the file was deliberately excluded (cwd mismatch,
/// sessionId mismatch); `Err` means it could not be read at all.
/// Malformed lines are skipped silently, matching the permissiveness of
/// tugcode's translator.
fn parse_session_file(
    path: &Path,
    project_dir: &str,
    expected_stem: &str,
    file_size: i64,
    file_mtime: i64,
) -> std::io::Result<Option<ExternalSessionMeta>> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();

    let mut turn_count: i64 = 0;
    let mut last_prompt: Option<String> = None;
    let mut name: Option<String> = None;
    let mut created_at: Option<i64> = None;
    let mut cwd_checked = false;

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let Some(obj) = value.as_object() else {
            continue;
        };

        if let Some(sid) = obj.get("sessionId").and_then(|v| v.as_str()) {
            if sid != expected_stem {
                tracing::debug!(
                    path = %path.display(),
                    record_session_id = sid,
                    "external scan: sessionId/filename mismatch, excluded",
                );
                return Ok(None);
            }
        }
        if !cwd_checked {
            if let Some(cwd) = obj.get("cwd").and_then(|v| v.as_str()) {
                cwd_checked = true;
                if cwd != project_dir {
                    tracing::debug!(
                        path = %path.display(),
                        record_cwd = cwd,
                        "external scan: cwd mismatch (encoding collision), excluded",
                    );
                    return Ok(None);
                }
            }
        }
        if created_at.is_none() {
            if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_str()) {
                created_at = parse_timestamp_millis(ts);
            }
        }

        match obj.get("type").and_then(|v| v.as_str()) {
            Some("user") => {
                let content = obj.get("message").and_then(|m| m.get("content"));
                if let Some(content) = content {
                    if is_user_submission_content(content) {
                        turn_count += 1;
                        let text = submission_text(content);
                        if !text.is_empty() {
                            last_prompt = Some(truncate_prompt(&text));
                        }
                    }
                }
            }
            Some("ai-title") => {
                if let Some(title) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                    if !title.is_empty() {
                        name = Some(title.to_owned());
                    }
                }
            }
            _ => {}
        }
    }

    Ok(Some(ExternalSessionMeta {
        session_id: expected_stem.to_owned(),
        turn_count,
        last_user_prompt: last_prompt,
        name,
        created_at: created_at.unwrap_or(file_mtime),
        last_used_at: file_mtime,
        file_size,
        file_mtime,
    }))
}

/// `(size, mtime-millis)` of a file, for cache-validity checks and the
/// meta fields. `None` when the file vanished between listing and stat.
pub fn stat_size_mtime(path: &Path) -> Option<(i64, i64)> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some((size, mtime))
}

/// One candidate session file: stem + path + stat pair. The cached
/// scan path stats candidates first and only parses on cache miss.
#[derive(Debug, Clone)]
pub struct SessionFileCandidate {
    pub session_id: String,
    pub path: std::path::PathBuf,
    pub file_size: i64,
    pub file_mtime: i64,
}

/// Enumerate candidate session JSONLs for `project_dir` under
/// `claude_projects_root`: regular `*.jsonl` files whose stem is a
/// session UUID. Subdirectories (`.tug-trash`, `<id>/subagents/`),
/// dotfiles, and non-UUID names are skipped. Missing project dir →
/// empty vec.
///
/// `project_dir` may be any alias of the project (user-typed, possibly
/// through symlinks); resolution to claude's directory goes through the
/// [`claude_project_dir`] chokepoint. Returns the canonical project-dir
/// string alongside the candidates — record `cwd` comparisons must use
/// it, never the raw input.
pub fn list_session_file_candidates(
    claude_projects_root: &Path,
    project_dir: &str,
) -> (Vec<SessionFileCandidate>, String) {
    let (dir, canonical) = claude_project_dir(claude_projects_root, project_dir);
    let entries = match fs::read_dir(&dir) {
        Ok(it) => it,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (Vec::new(), canonical);
        }
        Err(err) => {
            tracing::warn!(
                error = %err,
                dir = %dir.display(),
                "external scan: read_dir failed",
            );
            return (Vec::new(), canonical);
        }
    };
    let mut candidates = Vec::new();
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let path = entry.path();
        let is_file = entry.file_type().map(|ft| ft.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_uuid_stem(stem) {
            continue;
        }
        let Some((file_size, file_mtime)) = stat_size_mtime(&path) else {
            continue;
        };
        candidates.push(SessionFileCandidate {
            session_id: stem.to_owned(),
            path,
            file_size,
            file_mtime,
        });
    }
    (candidates, canonical)
}

/// Uncached scan: enumerate candidates and parse every one. The
/// supervisor uses the cached variant on `SessionLedger`; this entry
/// point exists for tests and for callers without a ledger handle.
pub fn scan_external_sessions(
    claude_projects_root: &Path,
    project_dir: &str,
) -> Vec<ExternalSessionMeta> {
    let (candidates, canonical) = list_session_file_candidates(claude_projects_root, project_dir);
    candidates
        .into_iter()
        .filter_map(|c| {
            parse_session_file(&c.path, &canonical, &c.session_id, c.file_size, c.file_mtime)
                .ok()
                .flatten()
        })
        .collect()
}

/// Parse one already-stat'ed candidate. Exposed for the cached scan
/// path on `SessionLedger`.
pub fn parse_candidate(
    candidate: &SessionFileCandidate,
    project_dir: &str,
) -> Option<ExternalSessionMeta> {
    parse_session_file(
        &candidate.path,
        project_dir,
        &candidate.session_id,
        candidate.file_size,
        candidate.file_mtime,
    )
    .ok()
    .flatten()
}

/// Outcome of a cached scan: the metas, plus counters that make cache
/// behavior assertable (a warm scan of an unchanged directory reports
/// `parsed == 0`).
#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub metas: Vec<ExternalSessionMeta>,
    /// Candidate files streamed this scan (cache misses).
    pub parsed: usize,
    /// Candidate files served from the cache.
    pub cache_hits: usize,
    /// The canonical project dir the scan resolved (via the
    /// [`claude_project_dir`] chokepoint). Consumers synthesizing rows
    /// or deriving JSONL paths must use this, never the raw input.
    pub canonical_project_dir: String,
}

fn cache_row_from_meta(meta: &ExternalSessionMeta, project_dir: &str) -> ScanCacheRow {
    ScanCacheRow {
        session_id: meta.session_id.clone(),
        project_dir: project_dir.to_owned(),
        file_size: meta.file_size,
        file_mtime: meta.file_mtime,
        excluded: false,
        turn_count: meta.turn_count,
        last_user_prompt: meta.last_user_prompt.clone(),
        name: meta.name.clone(),
        created_at: meta.created_at,
        last_used_at: meta.last_used_at,
    }
}

fn meta_from_cache_row(row: ScanCacheRow) -> ExternalSessionMeta {
    ExternalSessionMeta {
        session_id: row.session_id,
        turn_count: row.turn_count,
        last_user_prompt: row.last_user_prompt,
        name: row.name,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        file_size: row.file_size,
        file_mtime: row.file_mtime,
    }
}

/// Cache-backed scan: stat every candidate, serve unchanged files from
/// the ledger's `external_scan_cache`, stream only the misses, and
/// prune cache rows whose backing file is gone. Cache I/O failures are
/// logged and degrade to an uncached parse — the scan itself never
/// fails.
pub fn scan_external_sessions_cached(ledger: &SessionLedger, project_dir: &str) -> ScanOutcome {
    let (candidates, canonical) =
        list_session_file_candidates(ledger.claude_projects_root(), project_dir);
    // Everything below operates on the canonical form — the cache keys,
    // the cwd comparisons, and the prune scope all agree regardless of
    // which alias the caller typed.
    let project_dir = canonical.as_str();
    let mut outcome = ScanOutcome {
        canonical_project_dir: canonical.clone(),
        ..ScanOutcome::default()
    };
    let mut seen_ids: Vec<String> = Vec::with_capacity(candidates.len());
    for candidate in &candidates {
        seen_ids.push(candidate.session_id.clone());
        let cached = ledger
            .get_scan_cache(&candidate.session_id)
            .unwrap_or_else(|err| {
                tracing::warn!(error = %err, "external scan: cache read failed");
                None
            });
        if let Some(row) = cached {
            if row.file_size == candidate.file_size && row.file_mtime == candidate.file_mtime {
                outcome.cache_hits += 1;
                if !row.excluded {
                    outcome.metas.push(meta_from_cache_row(row));
                }
                continue;
            }
        }
        outcome.parsed += 1;
        match parse_candidate(candidate, project_dir) {
            Some(meta) => {
                let row = cache_row_from_meta(&meta, project_dir);
                if let Err(err) = ledger.upsert_scan_cache(&row) {
                    tracing::warn!(error = %err, "external scan: cache write failed");
                }
                outcome.metas.push(meta);
            }
            None => {
                // Deliberate exclusion (cwd / sessionId mismatch) or an
                // unreadable file. Remember exclusions so the file isn't
                // re-streamed every scan; the (size, mtime) pair still
                // invalidates if the file changes.
                let row = ScanCacheRow {
                    session_id: candidate.session_id.clone(),
                    project_dir: project_dir.to_owned(),
                    file_size: candidate.file_size,
                    file_mtime: candidate.file_mtime,
                    excluded: true,
                    turn_count: 0,
                    last_user_prompt: None,
                    name: None,
                    created_at: 0,
                    last_used_at: 0,
                };
                if let Err(err) = ledger.upsert_scan_cache(&row) {
                    tracing::warn!(error = %err, "external scan: cache write failed");
                }
            }
        }
    }
    match ledger.prune_scan_cache_except(project_dir, &seen_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::debug!(pruned, project_dir, "external scan: pruned stale cache rows");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(error = %err, "external scan: cache prune failed");
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    // Tests seed fixtures under already-canonical paths, so the raw
    // encoder is the right tool here (production code routes through
    // the `claude_project_dir` chokepoint instead).
    use crate::session_ledger::encode_claude_project_name;

    const SESSION_A: &str = "11111111-2222-3333-4444-555555555555";
    const PROJECT: &str = "/tmp/scan-test-project";

    /// Build a TUI-shaped transcript: bookkeeping records around two
    /// user submissions (one string-content, one array-content), a
    /// tool_result echo that must NOT count, and an ai-title.
    fn tui_shaped_jsonl(session_id: &str, cwd: &str) -> String {
        [
            format!(r#"{{"type":"mode","mode":"normal","sessionId":"{session_id}"}}"#),
            format!(r#"{{"type":"permission-mode","permissionMode":"default","sessionId":"{session_id}"}}"#),
            r#"{"type":"file-history-snapshot","messageId":"m1","snapshot":{}}"#.to_owned(),
            format!(
                r#"{{"type":"user","sessionId":"{session_id}","cwd":"{cwd}","timestamp":"2026-06-01T10:00:00.000Z","message":{{"role":"user","content":"first prompt"}}}}"#
            ),
            format!(
                r#"{{"type":"assistant","sessionId":"{session_id}","timestamp":"2026-06-01T10:00:05.000Z","message":{{"role":"assistant","content":[{{"type":"text","text":"hi"}}]}}}}"#
            ),
            format!(
                r#"{{"type":"user","sessionId":"{session_id}","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"t1","content":"ok"}}]}}}}"#
            ),
            format!(r#"{{"type":"ai-title","aiTitle":"Scan fixture session","sessionId":"{session_id}"}}"#),
            format!(
                r#"{{"type":"user","sessionId":"{session_id}","message":{{"role":"user","content":[{{"type":"text","text":"second "}},{{"type":"text","text":"prompt"}}]}}}}"#
            ),
        ]
        .join("\n")
    }

    fn seed(root: &Path, project_dir: &str, session_id: &str, content: &str) {
        let dir = root.join(encode_claude_project_name(project_dir));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{session_id}.jsonl")), content).unwrap();
    }

    #[test]
    fn extracts_turn_count_prompt_and_title() {
        let root = tempfile::tempdir().unwrap();
        seed(root.path(), PROJECT, SESSION_A, &tui_shaped_jsonl(SESSION_A, PROJECT));
        let metas = scan_external_sessions(root.path(), PROJECT);
        assert_eq!(metas.len(), 1);
        let m = &metas[0];
        assert_eq!(m.session_id, SESSION_A);
        assert_eq!(m.turn_count, 2, "tool_result echo must not count");
        assert_eq!(m.last_user_prompt.as_deref(), Some("second prompt"));
        assert_eq!(m.name.as_deref(), Some("Scan fixture session"));
        assert_eq!(m.created_at, 1780308000000, "first record timestamp");
        assert!(m.last_used_at > 0);
    }

    #[test]
    fn empty_session_yields_zero_turns() {
        let root = tempfile::tempdir().unwrap();
        let content = format!(r#"{{"type":"mode","mode":"normal","sessionId":"{SESSION_A}"}}"#);
        seed(root.path(), PROJECT, SESSION_A, &content);
        let metas = scan_external_sessions(root.path(), PROJECT);
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].turn_count, 0);
        assert_eq!(metas[0].last_user_prompt, None);
        // No timestamp-bearing record: created_at falls back to mtime.
        assert_eq!(metas[0].created_at, metas[0].last_used_at);
    }

    #[test]
    fn cwd_mismatch_is_excluded() {
        let root = tempfile::tempdir().unwrap();
        seed(
            root.path(),
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl(SESSION_A, "/tmp/other-project"),
        );
        assert!(scan_external_sessions(root.path(), PROJECT).is_empty());
    }

    #[test]
    fn session_id_mismatch_is_excluded() {
        let root = tempfile::tempdir().unwrap();
        seed(
            root.path(),
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl("99999999-8888-7777-6666-555555555555", PROJECT),
        );
        assert!(scan_external_sessions(root.path(), PROJECT).is_empty());
    }

    #[test]
    fn non_session_files_and_dirs_are_skipped() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(encode_claude_project_name(PROJECT));
        fs::create_dir_all(dir.join(".tug-trash/123")).unwrap();
        fs::create_dir_all(dir.join(format!("{SESSION_A}/subagents"))).unwrap();
        fs::write(dir.join(".DS_Store"), "x").unwrap();
        fs::write(dir.join("notes.jsonl"), "{}").unwrap();
        fs::write(dir.join("UPPERCASE-2222-3333-4444-555555555555.jsonl"), "{}").unwrap();
        assert!(scan_external_sessions(root.path(), PROJECT).is_empty());
    }

    #[test]
    fn missing_project_dir_yields_empty() {
        let root = tempfile::tempdir().unwrap();
        assert!(scan_external_sessions(root.path(), "/never/created").is_empty());
    }

    #[test]
    fn prompt_truncates_at_cap_on_char_boundary() {
        let root = tempfile::tempdir().unwrap();
        let long = "é".repeat(USER_PROMPT_MAX_CHARS + 50);
        let content = format!(
            r#"{{"type":"user","sessionId":"{SESSION_A}","cwd":"{PROJECT}","message":{{"role":"user","content":"{long}"}}}}"#
        );
        seed(root.path(), PROJECT, SESSION_A, &content);
        let metas = scan_external_sessions(root.path(), PROJECT);
        let prompt = metas[0].last_user_prompt.as_ref().unwrap();
        assert_eq!(prompt.chars().count(), USER_PROMPT_MAX_CHARS);
    }

    fn ledger_with_root(root: &Path) -> SessionLedger {
        SessionLedger::open_with_claude_root(
            root.join("sessions.db"),
            root.join("projects"),
        )
        .unwrap()
    }

    #[test]
    fn warm_scan_of_unchanged_dir_parses_nothing() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        seed(
            &root.path().join("projects"),
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl(SESSION_A, PROJECT),
        );
        let cold = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(cold.parsed, 1);
        assert_eq!(cold.cache_hits, 0);
        assert_eq!(cold.metas.len(), 1);

        let warm = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(warm.parsed, 0, "unchanged file must be served from cache");
        assert_eq!(warm.cache_hits, 1);
        assert_eq!(warm.metas, cold.metas);
    }

    #[test]
    fn changed_file_reparses_and_deleted_file_prunes() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        let projects = root.path().join("projects");
        seed(&projects, PROJECT, SESSION_A, &tui_shaped_jsonl(SESSION_A, PROJECT));
        scan_external_sessions_cached(&ledger, PROJECT);

        // Append a third submission: size changes → re-parse.
        let path = projects
            .join(encode_claude_project_name(PROJECT))
            .join(format!("{SESSION_A}.jsonl"));
        let mut content = fs::read_to_string(&path).unwrap();
        content.push_str(&format!(
            "\n{{\"type\":\"user\",\"sessionId\":\"{SESSION_A}\",\"message\":{{\"role\":\"user\",\"content\":\"third prompt\"}}}}"
        ));
        fs::write(&path, content).unwrap();
        let rescan = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(rescan.parsed, 1);
        assert_eq!(rescan.metas[0].turn_count, 3);
        assert_eq!(rescan.metas[0].last_user_prompt.as_deref(), Some("third prompt"));

        // Delete the file: candidate gone, cache row pruned.
        fs::remove_file(&path).unwrap();
        let empty = scan_external_sessions_cached(&ledger, PROJECT);
        assert!(empty.metas.is_empty());
        assert!(ledger.get_scan_cache(SESSION_A).unwrap().is_none());
    }

    #[test]
    fn excluded_file_is_cached_and_not_restreamed() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        seed(
            &root.path().join("projects"),
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl(SESSION_A, "/tmp/other-project"),
        );
        let cold = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(cold.parsed, 1);
        assert!(cold.metas.is_empty());
        let warm = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(warm.parsed, 0, "exclusion must be remembered");
        assert_eq!(warm.cache_hits, 1);
        assert!(warm.metas.is_empty());
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let root = tempfile::tempdir().unwrap();
        let content = format!(
            "not json\n{{\"type\":\"user\",\"sessionId\":\"{SESSION_A}\",\"cwd\":\"{PROJECT}\",\"message\":{{\"role\":\"user\",\"content\":\"ok\"}}}}\n[1,2,3]"
        );
        seed(root.path(), PROJECT, SESSION_A, &content);
        let metas = scan_external_sessions(root.path(), PROJECT);
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].turn_count, 1);
    }
}
