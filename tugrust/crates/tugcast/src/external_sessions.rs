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
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
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

/// Bytes of resumable-prefix tail covered by the fingerprint. Claude
/// session JSONLs are append-only in steady state; a rewind/compaction
/// rewrite that somehow preserves the final `TAIL_FINGERPRINT_BYTES`
/// at the recorded offset while changing earlier bytes would go
/// undetected — accepted: such a rewrite also restarts the file from
/// scratch in practice, changing the tail wholesale.
const TAIL_FINGERPRINT_BYTES: usize = 256;

/// FNV-1a 64 — the prefix fingerprint. Stored bit-cast to `i64` in the
/// scan cache.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Slide `bytes` into the fingerprint window, keeping only the last
/// `TAIL_FINGERPRINT_BYTES`.
fn push_tail(window: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.len() >= TAIL_FINGERPRINT_BYTES {
        window.clear();
        window.extend_from_slice(&bytes[bytes.len() - TAIL_FINGERPRINT_BYTES..]);
        return;
    }
    let overflow = (window.len() + bytes.len()).saturating_sub(TAIL_FINGERPRINT_BYTES);
    if overflow > 0 {
        window.drain(..overflow);
    }
    window.extend_from_slice(bytes);
}

/// The accumulator state a resumed parse starts from — the cached
/// tallies for the complete lines in `[0, offset)`, plus the
/// fingerprint that proves the prefix is unchanged.
#[derive(Debug, Clone)]
pub struct ResumeSeed {
    pub offset: i64,
    pub tail_hash: i64,
    pub cwd_checked: bool,
    pub created_at_found: bool,
    pub turn_count: i64,
    pub last_user_prompt: Option<String>,
    pub name: Option<String>,
    pub created_at: i64,
}

/// Build a resume seed from a non-excluded cache row. `None` when the
/// row carries no resumable frontier (`parse_offset == 0` — pre-
/// migration rows, or excluded entries).
pub fn resume_seed_from_cache(row: &ScanCacheRow) -> Option<ResumeSeed> {
    if row.excluded || row.parse_offset <= 0 {
        return None;
    }
    Some(ResumeSeed {
        offset: row.parse_offset,
        tail_hash: row.tail_hash,
        cwd_checked: row.cwd_checked,
        created_at_found: row.created_at_found,
        turn_count: row.turn_count,
        last_user_prompt: row.last_user_prompt.clone(),
        name: row.name.clone(),
        created_at: row.created_at,
    })
}

/// The parse frontier recorded alongside a scan result, for the next
/// incremental resume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeMark {
    pub parse_offset: i64,
    pub tail_hash: i64,
    pub cwd_checked: bool,
    pub created_at_found: bool,
}

/// A parsed session: the picker-facing meta plus the resume frontier.
#[derive(Debug, Clone)]
pub struct ParsedSession {
    pub meta: ExternalSessionMeta,
    pub resume: ResumeMark,
    /// Whether this parse actually resumed from a verified frontier
    /// (vs streaming from byte 0). Drives the scan's `resumed` counter.
    pub resumed: bool,
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

/// True when array content carries an `image` block. The interrupt-marker
/// sentinel never has one; a real submission with the marker text plus an
/// image is therefore not a marker (mirrors the `!hasImage` guard in
/// tugcode's `handleUserEntry`).
fn content_has_image(content: &serde_json::Value) -> bool {
    matches!(content, serde_json::Value::Array(blocks)
        if blocks.iter().any(|b| b
            .as_object()
            .and_then(|o| o.get("type"))
            .and_then(|t| t.as_str())
            == Some("image")))
}

/// Slash-command scaffolding prefixes Claude Code wraps a slash invocation
/// in when it persists the interaction as `user` JSONL. Mirror of tugcode's
/// `COMMAND_SCAFFOLDING_PREFIXES`.
const COMMAND_SCAFFOLDING_PREFIXES: [&str; 5] = [
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-stdout>",
    "<local-command-caveat>",
];

/// Mirror of tugcode's `isNonSubmissionUserString`: bare-string `user`
/// content that is NOT a genuine submission — a `/compact` summary
/// continuation, slash-command scaffolding, or a `<task-notification>` wake
/// envelope. (The wake envelope is non-submission here, but is counted
/// separately as a wake opener by the scan loop.)
fn is_non_submission_user_string(is_compact_summary: bool, text: &str) -> bool {
    if is_compact_summary {
        return true;
    }
    let trimmed = text.trim_start();
    if COMMAND_SCAFFOLDING_PREFIXES
        .iter()
        .any(|p| trimmed.starts_with(p))
    {
        return true;
    }
    is_task_notification_wake(text)
}

/// Mirror of tugcode's `extractTaskNotificationWake` recognizer: a
/// `<task-notification>` envelope, anchored at the start after optional
/// leading whitespace. A wake opener counts as a turn.
fn is_task_notification_wake(text: &str) -> bool {
    text.trim_start().starts_with("<task-notification>")
}

/// The SDK's interrupt-marker text prefix. Mirror of tugcode's
/// `INTERRUPT_MARKER_PREFIX`.
const INTERRUPT_MARKER_PREFIX: &str = "[Request interrupted by user";

/// Mirror of tugcode's `isInterruptMarkerEntry`: the SDK's
/// `[Request interrupted by user…]` sentinel, which tugcode drops (it opens
/// no turn). Both signals must agree — the text pattern AND an absent
/// `permissionMode` field — and the entry must carry no image, so a user who
/// literally types the marker text (their submission carries
/// `permissionMode`) still counts.
fn is_interrupt_marker(text: &str, has_image: bool, has_permission_mode: bool) -> bool {
    if has_image || has_permission_mode {
        return false;
    }
    if !text.starts_with(INTERRUPT_MARKER_PREFIX) || !text.ends_with(']') {
        return false;
    }
    if text != "[Request interrupted by user]" {
        // Suffix form: a space-led suffix between the prefix and the closing
        // `]` (distinguishes the marker from `[Request interrupted by userX]`).
        let after = &text[INTERRUPT_MARKER_PREFIX.len()..text.len() - 1];
        if !after.starts_with(' ') || after.chars().count() <= 1 {
            return false;
        }
    }
    true
}

/// Decide whether a parsed `type:"user"` record opens a turn under S01
/// (`tuglaws/turn-metric.md`). Shared by the live scan loop and the corpus
/// contract test so the two can never drift. Returns `(counts, is_wake)`:
/// `counts` is whether it opens a turn; `is_wake` distinguishes a wake
/// opener (a turn, but not a user prompt) from a genuine submission.
///
/// Mirrors tugcode's `handleUserEntry`: `isMeta` records and interrupt
/// markers never count; a bare string additionally must clear the
/// non-submission gate (compact / scaffolding); array content with a
/// non-`tool_result` block is always a genuine submission; wake envelopes
/// count.
fn user_submission_opens_turn(
    is_meta: bool,
    is_compact_summary: bool,
    has_permission_mode: bool,
    content: &serde_json::Value,
) -> (bool, bool) {
    if is_meta || !is_user_submission_content(content) {
        return (false, false);
    }
    let is_string = matches!(content, serde_json::Value::String(_));
    let text = submission_text(content);
    let is_wake = is_string && is_task_notification_wake(&text);
    if is_interrupt_marker(&text, content_has_image(content), has_permission_mode) {
        return (false, false);
    }
    let counts =
        is_wake || !is_string || !is_non_submission_user_string(is_compact_summary, &text);
    (counts, is_wake)
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

/// The fields the scanner reads from each JSONL record. Everything else
/// in the line (the often multi-MB assistant `content`, `toolUseResult`,
/// usage blocks, …) is skipped without allocation: unknown keys go to
/// serde's `IgnoredAny`, and `message` is captured as an **unparsed**
/// slice ([`RawValue`]) — only the rare `type: "user"` lines pay to parse
/// it into a tree. The scalar fields are `Option<String>` (so a missing
/// or `null` value is `None`, never a parse error). This typed extraction
/// replaces a full `serde_json::Value` DOM build per line — the dominant
/// cost of a cold scan over a multi-GB project dir.
#[derive(Deserialize)]
struct ScanRecord<'a> {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "aiTitle", default)]
    ai_title: Option<String>,
    /// `/compact` continuation flag. Honoured only for bare-string content
    /// (mirrors tugcode's `handleUserEntry`), where it marks the injected
    /// "This session is being continued…" summary as non-submission.
    #[serde(rename = "isCompactSummary", default)]
    is_compact_summary: Option<bool>,
    /// SDK bookkeeping flag (image hints, skill-body loaders, `/loop`
    /// imports). tugcode skips `isMeta` records outright — they never open
    /// a turn regardless of content shape.
    #[serde(rename = "isMeta", default)]
    is_meta: Option<bool>,
    /// Present on every real user submission (the input layer stamps it),
    /// absent on the SDK's auto-injected interrupt marker. Captured unparsed
    /// purely to test *presence* — the structural half of the interrupt
    /// disambiguator (mirrors `isInterruptMarkerEntry`).
    #[serde(rename = "permissionMode", default, borrow)]
    permission_mode: Option<&'a serde_json::value::RawValue>,
    /// Unparsed — only `type: "user"` lines parse this to read `content`.
    #[serde(default, borrow)]
    message: Option<&'a serde_json::value::RawValue>,
}

/// Verify a resume seed against the file: read the fingerprint window
/// ending at `seed.offset` and compare. On a match the file is left
/// positioned at the offset and the window is returned (it primes the
/// rolling fingerprint); on a mismatch the prefix was rewritten and the
/// caller falls back to a full parse.
fn try_resume(
    file: &mut fs::File,
    seed: &ResumeSeed,
    file_size: i64,
) -> std::io::Result<Option<Vec<u8>>> {
    if seed.offset <= 0 || seed.offset > file_size {
        return Ok(None);
    }
    let k = (seed.offset as usize).min(TAIL_FINGERPRINT_BYTES);
    file.seek(SeekFrom::Start(seed.offset as u64 - k as u64))?;
    let mut window = vec![0u8; k];
    file.read_exact(&mut window)?;
    if fnv1a64(&window) as i64 != seed.tail_hash {
        return Ok(None);
    }
    Ok(Some(window))
}

/// Stream one candidate JSONL and extract its metadata.
///
/// `Ok(None)` means the file was deliberately excluded (cwd mismatch,
/// sessionId mismatch); `Err` means it could not be read at all.
/// Malformed lines are skipped silently, matching the permissiveness of
/// tugcode's translator.
///
/// With a verified `resume` seed the stream starts at the cached parse
/// frontier instead of byte 0 — the dominant repeat cost of the scan is
/// a live multi-hundred-MB session re-streaming in full on every
/// append, and this drops it to just the appended tail. Only complete
/// (newline-terminated) lines advance the frontier; an unterminated
/// final line is a write in progress and is left for the next scan.
fn parse_session_file(
    path: &Path,
    project_dir: &str,
    expected_stem: &str,
    file_size: i64,
    file_mtime: i64,
    resume: Option<&ResumeSeed>,
) -> std::io::Result<Option<ParsedSession>> {
    let mut file = fs::File::open(path)?;

    let mut turn_count: i64 = 0;
    let mut last_prompt: Option<String> = None;
    let mut name: Option<String> = None;
    let mut created_at: Option<i64> = None;
    let mut cwd_checked = false;
    let mut consumed: u64 = 0;
    let mut window: Vec<u8> = Vec::with_capacity(TAIL_FINGERPRINT_BYTES);
    let mut resumed = false;

    if let Some(seed) = resume {
        if let Some(verified_window) = try_resume(&mut file, seed, file_size)? {
            turn_count = seed.turn_count;
            last_prompt = seed.last_user_prompt.clone();
            name = seed.name.clone();
            created_at = seed.created_at_found.then_some(seed.created_at);
            cwd_checked = seed.cwd_checked;
            consumed = seed.offset as u64;
            window = verified_window;
            resumed = true;
        } else {
            file.seek(SeekFrom::Start(0))?;
        }
    }

    let mut reader = BufReader::new(file);
    let mut line = String::new();
    // Cleared when the final line arrives unterminated (a write in
    // progress, or a fixture without a trailing newline): the line still
    // counts toward THIS scan's meta, but the frontier can't include it
    // — a resume would re-read it and double-count — so the result is
    // recorded as non-resumable and the next change re-streams in full.
    let mut resumable = true;

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let terminated = line.ends_with('\n');
        if terminated {
            consumed += line.len() as u64;
            push_tail(&mut window, line.as_bytes());
        } else {
            resumable = false;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if terminated {
                continue;
            }
            break;
        }
        // Typed extraction: scans the line structurally but builds no tree
        // for the bulk fields. A non-object or malformed line fails here
        // and is skipped — same tolerance as the prior `Value` path.
        let Ok(rec) = serde_json::from_str::<ScanRecord>(trimmed) else {
            if terminated {
                continue;
            }
            break;
        };

        if let Some(sid) = rec.session_id.as_deref() {
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
            if let Some(cwd) = rec.cwd.as_deref() {
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
            if let Some(ts) = rec.timestamp.as_deref() {
                created_at = parse_timestamp_millis(ts);
            }
        }

        match rec.kind.as_deref() {
            Some("user") => {
                // Only here do we parse the (small) user `message` into a
                // tree to inspect its `content`.
                let content = rec
                    .message
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.get()).ok())
                    .and_then(|msg| msg.get("content").cloned());
                if let Some(content) = content {
                    let (counts, is_wake) = user_submission_opens_turn(
                        rec.is_meta == Some(true),
                        rec.is_compact_summary == Some(true),
                        rec.permission_mode.is_some(),
                        &content,
                    );
                    if counts {
                        turn_count += 1;
                        // `last_user_prompt` tracks the last genuine prompt —
                        // a wake envelope is a turn but not a prompt.
                        if !is_wake {
                            let text = submission_text(&content);
                            if !text.is_empty() {
                                last_prompt = Some(truncate_prompt(&text));
                            }
                        }
                    }
                }
            }
            Some("ai-title") => {
                if let Some(title) = rec.ai_title.as_deref() {
                    if !title.is_empty() {
                        name = Some(title.to_owned());
                    }
                }
            }
            _ => {}
        }
        if !terminated {
            break;
        }
    }

    let resume = if resumable && consumed > 0 {
        ResumeMark {
            parse_offset: consumed as i64,
            tail_hash: fnv1a64(&window) as i64,
            cwd_checked,
            created_at_found: created_at.is_some(),
        }
    } else {
        ResumeMark {
            parse_offset: 0,
            tail_hash: 0,
            cwd_checked,
            created_at_found: created_at.is_some(),
        }
    };
    Ok(Some(ParsedSession {
        meta: ExternalSessionMeta {
            session_id: expected_stem.to_owned(),
            turn_count,
            last_user_prompt: last_prompt,
            name,
            created_at: created_at.unwrap_or(file_mtime),
            last_used_at: file_mtime,
            file_size,
            file_mtime,
        },
        resume,
        resumed,
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
        .filter_map(|c| parse_candidate(&c, &canonical, None).map(|p| p.meta))
        .collect()
}

/// Parse one already-stat'ed candidate, optionally resuming from a
/// cached frontier. Exposed for the cached scan path on
/// `SessionLedger`.
pub fn parse_candidate(
    candidate: &SessionFileCandidate,
    project_dir: &str,
    resume: Option<&ResumeSeed>,
) -> Option<ParsedSession> {
    parse_session_file(
        &candidate.path,
        project_dir,
        &candidate.session_id,
        candidate.file_size,
        candidate.file_mtime,
        resume,
    )
    .ok()
    .flatten()
}

/// Outcome of a cached scan: the metas, plus counters that make cache
/// behavior assertable (a warm scan of an unchanged directory reports
/// `parsed == 0`; an append-only growth reports `resumed > 0`).
#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub metas: Vec<ExternalSessionMeta>,
    /// Candidate files streamed this scan (cache misses).
    pub parsed: usize,
    /// Of `parsed`, how many resumed from a cached frontier instead of
    /// re-streaming from byte 0.
    pub resumed: usize,
    /// Candidate files served from the cache.
    pub cache_hits: usize,
    /// The canonical project dir the scan resolved (via the
    /// [`claude_project_dir`] chokepoint). Consumers synthesizing rows
    /// or deriving JSONL paths must use this, never the raw input.
    pub canonical_project_dir: String,
}

fn cache_row_from_parsed(parsed: &ParsedSession, project_dir: &str) -> ScanCacheRow {
    let meta = &parsed.meta;
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
        parse_offset: parsed.resume.parse_offset,
        tail_hash: parsed.resume.tail_hash,
        cwd_checked: parsed.resume.cwd_checked,
        created_at_found: parsed.resume.created_at_found,
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
/// Parse a batch of cache-miss candidates across all available cores via
/// rayon's work-stealing pool, returning results index-aligned with
/// `misses` (`None` = deliberately excluded or unreadable). Work-stealing
/// (rather than fixed chunks) keeps every core busy despite wildly uneven
/// per-file sizes — a cold scan's JSONLs range from a few KB to tens of MB,
/// so a straggler chunk would otherwise dominate wall-clock. `par_iter`
/// preserves input order in the collected `Vec`.
fn parse_candidates_parallel(
    misses: &[(&SessionFileCandidate, Option<ResumeSeed>)],
    project_dir: &str,
    progress: &(impl Fn(usize, usize) + Sync),
) -> Vec<Option<ParsedSession>> {
    let total = misses.len();
    let done = std::sync::atomic::AtomicUsize::new(0);
    misses
        .par_iter()
        .map(|(c, seed)| {
            let parsed = parse_candidate(c, project_dir, seed.as_ref());
            let d = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            progress(d, total);
            parsed
        })
        .collect()
}

pub fn scan_external_sessions_cached(ledger: &SessionLedger, project_dir: &str) -> ScanOutcome {
    scan_external_sessions_cached_with_progress(ledger, project_dir, |_, _| {})
}

/// Cache-backed scan with a parse-progress callback: invoked with
/// `(0, total)` once the cache-miss set is known, then `(done, total)`
/// after each miss finishes streaming (from rayon worker threads — the
/// callback must be cheap and `Sync`). Not called at all when the scan
/// is a pure cache hit, so a warm picker open emits no progress noise.
pub fn scan_external_sessions_cached_with_progress(
    ledger: &SessionLedger,
    project_dir: &str,
    progress: impl Fn(usize, usize) + Sync,
) -> ScanOutcome {
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
    // Pass 1 (sequential, fast): stat-validate each candidate against the
    // sqlite cache. Cache hits resolve here; misses are collected for the
    // parallel parse below — carrying a resume seed when the file only
    // GREW past a recorded frontier (the append-only steady state), so
    // pass 2 streams just the tail. Cache I/O stays single-threaded — the
    // ledger owns one connection behind a mutex.
    let mut seen_ids: Vec<String> = Vec::with_capacity(candidates.len());
    let mut misses: Vec<(&SessionFileCandidate, Option<ResumeSeed>)> = Vec::new();
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
            let seed = (candidate.file_size > row.file_size)
                .then(|| resume_seed_from_cache(&row))
                .flatten();
            misses.push((candidate, seed));
            continue;
        }
        misses.push((candidate, None));
    }
    outcome.parsed = misses.len();

    // Pass 2 (parallel): stream + parse the cache misses across all cores.
    // Parsing is pure (no ledger access) and embarrassingly parallel — one
    // multi-GB cold scan is dominated by per-line JSON work, not disk, so
    // fanning out across cores is the dominant speedup. Results stay
    // index-aligned with `misses` for the write-back below.
    if !misses.is_empty() {
        progress(0, misses.len());
    }
    let parsed = parse_candidates_parallel(&misses, project_dir, &progress);

    // Pass 3 (sequential): write parse results back to the cache and
    // collect surfaced rows. Exclusions are cached too (with `excluded:
    // true`) so a cwd/sessionId-mismatch file isn't re-streamed every scan;
    // the (size, mtime) key still invalidates if the file changes.
    for ((candidate, _seed), parsed_opt) in misses.iter().zip(parsed) {
        match parsed_opt {
            Some(parsed) => {
                if parsed.resumed {
                    outcome.resumed += 1;
                }
                let row = cache_row_from_parsed(&parsed, project_dir);
                if let Err(err) = ledger.upsert_scan_cache(&row) {
                    tracing::warn!(error = %err, "external scan: cache write failed");
                }
                outcome.metas.push(parsed.meta);
            }
            None => {
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
                    parse_offset: 0,
                    tail_hash: 0,
                    cwd_checked: false,
                    created_at_found: false,
                };
                if let Err(err) = ledger.upsert_scan_cache(&row) {
                    tracing::warn!(error = %err, "external scan: cache write failed");
                }
            }
        }
    }
    match ledger.prune_scan_cache_except(project_dir, &seen_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::debug!(
                pruned,
                project_dir,
                "external scan: pruned stale cache rows"
            );
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

    /// Corpus contract ([P03], Spec S01, Risk R01): the scanner's turn-count
    /// decision matches the hand-verified expected count in the golden
    /// manifest for every real-session fixture. Drives the same
    /// `user_submission_opens_turn` the live scan loop uses, so the disk
    /// scanner can never drift from the canonical rule (isMeta / compact /
    /// scaffolding / interrupt-marker excluded; genuine submissions + wakes
    /// counted).
    #[test]
    fn scanner_turn_counts_match_golden_corpus() {
        let dir =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/turns");
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        for fx in manifest["fixtures"].as_array().unwrap() {
            let file = fx["file"].as_str().unwrap();
            let expected = fx["expected_turns"].as_u64().unwrap() as i64;
            let body = fs::read_to_string(dir.join(file)).unwrap();
            let mut count: i64 = 0;
            for line in body.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(rec) = serde_json::from_str::<ScanRecord>(line) else {
                    continue;
                };
                if rec.kind.as_deref() != Some("user") {
                    continue;
                }
                let content = rec
                    .message
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.get()).ok())
                    .and_then(|msg| msg.get("content").cloned());
                if let Some(content) = content {
                    let (counts, _) = user_submission_opens_turn(
                        rec.is_meta == Some(true),
                        rec.is_compact_summary == Some(true),
                        rec.permission_mode.is_some(),
                        &content,
                    );
                    if counts {
                        count += 1;
                    }
                }
            }
            assert_eq!(
                count, expected,
                "scanner turn count for {file}: got {count}, expected {expected} (manifest)"
            );
        }
    }

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
        seed(
            root.path(),
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl(SESSION_A, PROJECT),
        );
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
        fs::write(
            dir.join("UPPERCASE-2222-3333-4444-555555555555.jsonl"),
            "{}",
        )
        .unwrap();
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
        SessionLedger::open_with_claude_root(root.join("sessions.db"), root.join("projects"))
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
        seed(
            &projects,
            PROJECT,
            SESSION_A,
            &tui_shaped_jsonl(SESSION_A, PROJECT),
        );
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
        assert_eq!(
            rescan.metas[0].last_user_prompt.as_deref(),
            Some("third prompt")
        );

        // Delete the file: candidate gone, cache row pruned.
        fs::remove_file(&path).unwrap();
        let empty = scan_external_sessions_cached(&ledger, PROJECT);
        assert!(empty.metas.is_empty());
        assert!(ledger.get_scan_cache(SESSION_A).unwrap().is_none());
    }

    /// Terminated-lines fixture (every record ends in `\n`) so the
    /// scan records a resumable frontier.
    fn terminated_jsonl(session_id: &str, cwd: &str, prompts: &[&str]) -> String {
        let mut out =
            format!("{{\"type\":\"mode\",\"mode\":\"normal\",\"sessionId\":\"{session_id}\"}}\n");
        for p in prompts {
            out.push_str(&format!(
                "{{\"type\":\"user\",\"sessionId\":\"{session_id}\",\"cwd\":\"{cwd}\",\"timestamp\":\"2026-06-01T10:00:00.000Z\",\"message\":{{\"role\":\"user\",\"content\":\"{p}\"}}}}\n"
            ));
        }
        out
    }

    /// Set a file's mtime far enough from the previous write that the
    /// `(size, mtime)` validity key always misses — appends within the
    /// same filesystem-timestamp granule would otherwise read as
    /// "unchanged".
    fn bump_mtime(path: &Path, unix_secs: i64) {
        let t =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(unix_secs as u64);
        let f = fs::File::options().append(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    #[test]
    fn grown_file_resumes_from_cached_frontier() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        let projects = root.path().join("projects");
        seed(
            &projects,
            PROJECT,
            SESSION_A,
            &terminated_jsonl(SESSION_A, PROJECT, &["first", "second"]),
        );
        let path = projects
            .join(encode_claude_project_name(PROJECT))
            .join(format!("{SESSION_A}.jsonl"));
        bump_mtime(&path, 1_000_000);

        let cold = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(cold.parsed, 1);
        assert_eq!(cold.resumed, 0);
        assert_eq!(cold.metas[0].turn_count, 2);
        let cached = ledger.get_scan_cache(SESSION_A).unwrap().unwrap();
        assert!(cached.parse_offset > 0, "frontier recorded: {cached:?}");

        // Append a turn (append-only growth) → the rescan resumes.
        let mut content = fs::read_to_string(&path).unwrap();
        content.push_str(&format!(
            "{{\"type\":\"user\",\"sessionId\":\"{SESSION_A}\",\"message\":{{\"role\":\"user\",\"content\":\"third\"}}}}\n"
        ));
        fs::write(&path, content).unwrap();
        bump_mtime(&path, 2_000_000);

        let warm = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(warm.parsed, 1);
        assert_eq!(warm.resumed, 1, "tail-only parse: {warm:?}");
        assert_eq!(warm.metas[0].turn_count, 3);
        assert_eq!(warm.metas[0].last_user_prompt.as_deref(), Some("third"));
        // The frontier advanced; a further unchanged scan is a pure hit.
        let again = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(again.parsed, 0);
        assert_eq!(again.cache_hits, 1);
        assert_eq!(again.metas[0].turn_count, 3);
    }

    #[test]
    fn rewritten_prefix_falls_back_to_full_parse() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        let projects = root.path().join("projects");
        seed(
            &projects,
            PROJECT,
            SESSION_A,
            &terminated_jsonl(SESSION_A, PROJECT, &["first", "second"]),
        );
        let path = projects
            .join(encode_claude_project_name(PROJECT))
            .join(format!("{SESSION_A}.jsonl"));
        bump_mtime(&path, 1_000_000);
        scan_external_sessions_cached(&ledger, PROJECT);

        // Rewrite history (a rewind/compaction): the file GROWS but the
        // bytes at the old frontier change — the fingerprint must catch
        // it and the parse must restart from byte 0, not double-count.
        fs::write(
            &path,
            terminated_jsonl(SESSION_A, PROJECT, &["rewritten", "history", "entirely"]),
        )
        .unwrap();
        bump_mtime(&path, 2_000_000);

        let rescan = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(rescan.parsed, 1);
        assert_eq!(rescan.resumed, 0, "fingerprint mismatch: {rescan:?}");
        assert_eq!(rescan.metas[0].turn_count, 3);
        assert_eq!(
            rescan.metas[0].last_user_prompt.as_deref(),
            Some("entirely")
        );
    }

    #[test]
    fn shrunken_file_falls_back_to_full_parse() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        let projects = root.path().join("projects");
        seed(
            &projects,
            PROJECT,
            SESSION_A,
            &terminated_jsonl(SESSION_A, PROJECT, &["first", "second", "third"]),
        );
        let path = projects
            .join(encode_claude_project_name(PROJECT))
            .join(format!("{SESSION_A}.jsonl"));
        bump_mtime(&path, 1_000_000);
        scan_external_sessions_cached(&ledger, PROJECT);

        fs::write(&path, terminated_jsonl(SESSION_A, PROJECT, &["only"])).unwrap();
        bump_mtime(&path, 2_000_000);
        let rescan = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(rescan.parsed, 1);
        assert_eq!(rescan.resumed, 0);
        assert_eq!(rescan.metas[0].turn_count, 1);
        assert_eq!(rescan.metas[0].last_user_prompt.as_deref(), Some("only"));
    }

    #[test]
    fn unterminated_tail_line_is_counted_but_not_resumable() {
        let root = tempfile::tempdir().unwrap();
        let ledger = ledger_with_root(root.path());
        let projects = root.path().join("projects");
        // Mid-write capture: the final line has no trailing newline.
        let mut content = terminated_jsonl(SESSION_A, PROJECT, &["first"]);
        content.push_str(&format!(
            "{{\"type\":\"user\",\"sessionId\":\"{SESSION_A}\",\"message\":{{\"role\":\"user\",\"content\":\"partial\"}}}}"
        ));
        seed(&projects, PROJECT, SESSION_A, &content);
        let path = projects
            .join(encode_claude_project_name(PROJECT))
            .join(format!("{SESSION_A}.jsonl"));
        bump_mtime(&path, 1_000_000);

        let cold = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(
            cold.metas[0].turn_count, 2,
            "the in-flight line still counts toward this scan"
        );
        let cached = ledger.get_scan_cache(SESSION_A).unwrap().unwrap();
        assert_eq!(
            cached.parse_offset, 0,
            "no frontier past an unterminated line — a resume would double-count"
        );

        // The writer finishes the line; the rescan is full (seedless)
        // and correct.
        let mut content = fs::read_to_string(&path).unwrap();
        content.push('\n');
        fs::write(&path, content).unwrap();
        bump_mtime(&path, 2_000_000);
        let warm = scan_external_sessions_cached(&ledger, PROJECT);
        assert_eq!(warm.parsed, 1);
        assert_eq!(warm.resumed, 0);
        assert_eq!(warm.metas[0].turn_count, 2);
        let cached = ledger.get_scan_cache(SESSION_A).unwrap().unwrap();
        assert!(cached.parse_offset > 0, "frontier recorded once terminated");
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
