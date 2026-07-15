//! attribution — file-event capture from the agent-bridge relay loop.
//!
//! Every tool call a session makes flows through one supervised point:
//! tugcast's stdout relay loop in [`super::agent_bridge::relay_session_io`].
//! This module is the parsing + bookkeeping the relay's attribution
//! intercept uses to concentrate a session's file knowledge down to the
//! moment of change — a `file_events` row written when the tool call lands
//! ([P03]–[P06]).
//!
//! Two shapes are recognized on the stream:
//!
//! - **Exact** — `Write` / `Edit` / `MultiEdit` / `NotebookEdit`. The
//!   changed path comes straight from the tool input. Recorded on the
//!   successful `tool_result` (never at `tool_use` time — a denied or
//!   errored call must not pollute the record, [P04]). Because
//!   `tool_result` frames carry only the `tool_use_id` (not the tool name
//!   or input), the relay keeps a [`PendingCalls`] map populated at
//!   `tool_use` time and consumed at `tool_result` time.
//! - **Bash** — the one opaque mutator; handled by the working-tree
//!   fingerprint bracket in Step 4, not here.
//!
//! The pending map is size-capped with oldest-entry eviction and is
//! deliberately **not** cleared on `turn_complete`: a background agent's
//! child `tool_use`/`tool_result` pair can straddle a turn boundary
//! (`subagent-tail` re-emits child frames on a poll while the parent turn
//! may already be over), and clearing at the boundary would orphan
//! exactly the edits this feature exists to catch.

// The bracket registry (Step 4) is authored ahead of its relay wiring;
// suppress dead-code warnings for the not-yet-consumed surface the same
// way `session_ledger.rs` and the rest of the crate do for phased
// rollouts.
#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::SystemTime;

use serde::Deserialize;

use crate::path_resolver::CanonicalPath;
use crate::session_ledger::FileEventRow;

/// Maximum number of in-flight `tool_use` entries a relay's
/// [`PendingCalls`] map holds before the oldest is evicted. Each entry is
/// tiny (a couple of short strings); a few hundred covers any realistic
/// depth of un-resolved concurrent tool calls (a background agent fan-out
/// plus the foreground turn) with generous headroom. The cap only exists
/// so a pathological stream that emits `tool_use` frames whose
/// `tool_result` never arrives can't grow the map without bound.
pub const PENDING_CALLS_CAP: usize = 512;

/// Partial-shape view of a `tool_use` stream-json frame — only the fields
/// attribution needs. Extra fields (`msg_id`, `seq`, `ipc_version`, …) are
/// ignored, so a wire-format addition never breaks this parse. `input` is
/// kept as a raw `Value` because the path field differs by tool
/// (`file_path` vs `notebook_path`), read via [`file_path_for_tool`].
#[derive(Debug, Clone, Deserialize)]
pub struct InspectedToolUse {
    pub tool_name: String,
    pub tool_use_id: String,
    #[serde(default)]
    pub input: serde_json::Value,
    /// Set when a subagent issued the call (the parent `Agent`
    /// `tool_use.id`). Recorded on the row so the changeset composition
    /// can attribute nested calls to the owning session.
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    /// Original JSONL entry time (epoch ms). Present only on the
    /// resume/replay path — used as the row's `at` there so a backfilled
    /// event keeps its historical time. Live frames omit it.
    #[serde(default)]
    pub timestamp: Option<i64>,
}

impl InspectedToolUse {
    /// Parse a `tool_use` line. `None` on malformed JSON or a payload
    /// missing the required `tool_name` / `tool_use_id` (e.g. a different
    /// frame type that merely contains the substring the relay pre-filters
    /// on) — the caller treats `None` as "not an attributable tool_use".
    pub fn from_slice(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }
}

/// Partial-shape view of a `tool_result` stream-json frame.
#[derive(Debug, Clone, Deserialize)]
pub struct InspectedToolResult {
    pub tool_use_id: String,
    /// Denied / errored calls (permission refusal, `old_string` not found)
    /// carry `is_error: true` and must not be attributed ([P04]).
    #[serde(default)]
    pub is_error: bool,
    /// Original JSONL entry time (epoch ms); replay-only, live omits.
    #[serde(default)]
    pub timestamp: Option<i64>,
}

impl InspectedToolResult {
    /// Parse a `tool_result` line. `None` on malformed JSON or a payload
    /// missing the required `tool_use_id`.
    pub fn from_slice(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }
}

/// The `op` verb recorded for an exact-attribution tool, or `None` for any
/// tool this module does not attribute exactly (`Bash` is bracketed in
/// Step 4; everything else is ignored). `MultiEdit` is the legacy multi-
/// hunk edit tool — still handled, same verb as `Edit`.
pub fn exact_op_for_tool(tool_name: &str) -> Option<&'static str> {
    match tool_name {
        "Write" => Some("write"),
        "Edit" => Some("edit"),
        "MultiEdit" => Some("edit"),
        "NotebookEdit" => Some("notebook"),
        _ => None,
    }
}

/// The changed path an exact tool's `input` names, or `None` when the tool
/// is not exact-attributable or the expected key is absent / non-string.
/// `NotebookEdit` names its target `notebook_path`; the rest use
/// `file_path`. The path is returned as given by the tool (absolute);
/// [`PendingCall::into_row`] projects it to repo-relative in canonical space
/// at record time.
pub fn file_path_for_tool(tool_name: &str, input: &serde_json::Value) -> Option<String> {
    let key = match tool_name {
        "Write" | "Edit" | "MultiEdit" => "file_path",
        "NotebookEdit" => "notebook_path",
        _ => return None,
    };
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned())
}

/// A `tool_use` frame's attribution facts, held until its `tool_result`
/// arrives. Only exact-attributable calls with a resolvable path ever
/// become a `PendingCall`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCall {
    pub tool_name: String,
    pub file_path: String,
    pub op: &'static str,
    pub parent_tool_use_id: Option<String>,
    /// The `tool_use` frame's `timestamp` (replay path only). Used as the
    /// row's `at` on the replay path so a backfilled row keeps historical
    /// time; `None` on the live path, where frame-arrival time is used.
    pub timestamp: Option<i64>,
}

impl PendingCall {
    /// Build the [`FileEventRow`] this call resolves to on a successful
    /// `tool_result`. `origin` is `"exact"` live / `"replay"` on the
    /// replay path; `at` is the resolved event time.
    ///
    /// The tool's absolute `file_path` is projected to repo-relative in
    /// canonical space here (given the canonical `repo_root`), so both sides of
    /// the changeset join speak git's repo-relative language. When `repo_root`
    /// is `None` (non-repo project dir), the canonical absolute path is stored —
    /// there is nothing to strip against.
    pub fn into_row(
        self,
        tug_session_id: &str,
        tool_use_id: &str,
        project_dir: &CanonicalPath,
        repo_root: Option<&CanonicalPath>,
        origin: &str,
        at: i64,
    ) -> FileEventRow {
        FileEventRow {
            tug_session_id: tug_session_id.to_owned(),
            tool_use_id: tool_use_id.to_owned(),
            file_path: project_repo_relative(repo_root, &self.file_path),
            tool_name: self.tool_name,
            op: self.op.to_owned(),
            origin: origin.to_owned(),
            ambiguous: false,
            parent_tool_use_id: self.parent_tool_use_id,
            project_dir: project_dir.as_str().to_owned(),
            at,
        }
    }
}

/// Project an absolute `file_path` to its repo-relative form against the
/// canonical `repo_root`, both in canonical space. The path is canonicalized
/// through the gateway first (a firmlink/synthetic spelling of the same file
/// collapses to the repo root's space), then stripped. `None` repo_root or a
/// residual non-prefix returns the canonical absolute path — compose's bridge
/// reconciles that case.
fn project_repo_relative(repo_root: Option<&CanonicalPath>, file_path: &str) -> String {
    let canonical = CanonicalPath::from_raw(Path::new(file_path));
    match repo_root {
        Some(root) => canonical
            .as_path()
            .strip_prefix(root.as_path())
            .map(|rel| rel.to_string_lossy().into_owned())
            .unwrap_or_else(|_| canonical.as_str().to_owned()),
        None => canonical.as_str().to_owned(),
    }
}

/// Relay-local map of in-flight `tool_use` calls keyed by `tool_use_id`,
/// with oldest-entry eviction at [`PENDING_CALLS_CAP`]. Not cleared on
/// `turn_complete` (see module docs — background-agent child frames
/// straddle turn boundaries).
#[derive(Debug)]
pub struct PendingCalls {
    map: HashMap<String, PendingCall>,
    /// Insertion order of live keys, for oldest-first eviction. A `take`
    /// leaves the id here as a tombstone; eviction skips ids already gone
    /// from `map`, so the deque self-cleans as it drains.
    order: VecDeque<String>,
    cap: usize,
}

impl Default for PendingCalls {
    fn default() -> Self {
        Self::with_cap(PENDING_CALLS_CAP)
    }
}

impl PendingCalls {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_cap(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            cap: cap.max(1),
        }
    }

    /// Number of live (un-resolved) calls currently held.
    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Record a `tool_use`. A repeat of the same `tool_use_id` overwrites
    /// in place without growing the eviction order (the replay path can
    /// re-emit the same `tool_use`). Inserting past the cap evicts the
    /// oldest still-live entry.
    pub fn insert(&mut self, tool_use_id: String, call: PendingCall) {
        if self.map.insert(tool_use_id.clone(), call).is_none() {
            self.order.push_back(tool_use_id);
            while self.map.len() > self.cap {
                match self.order.pop_front() {
                    // Only a still-present key counts as an eviction; a
                    // tombstone (already taken) is discarded and the loop
                    // continues. `order` always holds every live key, so
                    // this terminates.
                    Some(oldest) => {
                        self.map.remove(&oldest);
                    }
                    None => break,
                }
            }
        }
    }

    /// Resolve and remove a call by `tool_use_id`, or `None` if it was
    /// never recorded (a non-exact tool, or already evicted / taken).
    pub fn take(&mut self, tool_use_id: &str) -> Option<PendingCall> {
        self.map.remove(tool_use_id)
    }
}

// ---------------------------------------------------------------------------
// Bash fingerprint bracketing ([P05], #bracket-algorithm)
// ---------------------------------------------------------------------------

/// A single tracked path's working-tree state at snapshot time: its
/// porcelain-v2 `XY` status (`"?"` for untracked) plus mtime. Both axes
/// matter: status catches a file entering / leaving / changing category in
/// the dirty set, and mtime catches a same-status re-write within the
/// bracket window (a file already `M` before the command, modified again
/// by it — the status alone wouldn't move).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileState {
    pub status: String,
    pub mtime: Option<SystemTime>,
}

/// One open Bash bracket: the pre-command working-tree fingerprint, held
/// from the Bash `tool_use` until its `tool_result` closes it and the delta
/// is attributed. `saw_overlap` accumulates cross-session overlap on the
/// same repo root (set whenever another session's bracket opens or is open
/// on the root during this one's life) — the delta rows are flagged
/// `ambiguous` when it is set, recorded but never guessed.
#[derive(Debug, Clone)]
pub struct OpenBracket {
    pub tug_session_id: String,
    pub tool_use_id: String,
    pub parent_tool_use_id: Option<String>,
    pub opened_at: i64,
    pub repo_root: PathBuf,
    pub pre: HashMap<PathBuf, FileState>,
    pub saw_overlap: bool,
}

impl OpenBracket {
    /// Compute the file-event rows this bracket attributes, given the
    /// post-command snapshot. Each path whose state differs between `pre`
    /// and `post` becomes one `origin='bash'` row on `project_dir` (the
    /// owning session's checkout root, so a session's Bash and exact events
    /// share a project bucket), with `ambiguous` from `saw_overlap`.
    ///
    /// `file_path` is stored repo-relative (stripped against the bracket's
    /// `repo_root`), matching the exact-tool path's capture-time projection.
    pub fn into_delta_rows(
        self,
        post: &HashMap<PathBuf, FileState>,
        project_dir: &CanonicalPath,
        at: i64,
    ) -> Vec<FileEventRow> {
        let mut paths: HashSet<&PathBuf> = HashSet::new();
        paths.extend(self.pre.keys());
        paths.extend(post.keys());

        let mut rows = Vec::new();
        for path in paths {
            let op = match classify_op(self.pre.get(path), post.get(path)) {
                Some(op) => op,
                None => continue,
            };
            // The pre/post fingerprint keys are `repo_root.join(rel)`, so the
            // strip always recovers git's repo-relative key.
            let file_path = path
                .strip_prefix(&self.repo_root)
                .map(|rel| rel.to_string_lossy().into_owned())
                .unwrap_or_else(|_| path.to_string_lossy().into_owned());
            rows.push(FileEventRow {
                tug_session_id: self.tug_session_id.clone(),
                tool_use_id: self.tool_use_id.clone(),
                file_path,
                tool_name: "Bash".to_owned(),
                op: op.to_owned(),
                origin: "bash".to_owned(),
                ambiguous: self.saw_overlap,
                parent_tool_use_id: self.parent_tool_use_id.clone(),
                project_dir: project_dir.as_str().to_owned(),
                at,
            });
        }
        rows
    }
}

/// Classify the working-tree transition of one path across the bracket
/// window, or `None` when its state is unchanged (identical status AND
/// mtime — no attribution).
fn classify_op(pre: Option<&FileState>, post: Option<&FileState>) -> Option<&'static str> {
    match (pre, post) {
        (Some(a), Some(b)) if a == b => None,
        (_, Some(b)) => Some(op_from_status(&b.status)),
        // Fell out of the dirty set (reverted / committed by the command):
        // the working state at that path changed, recorded as a modify.
        (Some(_), None) => Some("modified"),
        (None, None) => None,
    }
}

/// Map a porcelain-v2 `XY` status (or `"?"` untracked) to a file-event
/// `op`. Deletions and renames dominate a plain modify; a fresh add /
/// untracked file is a create.
fn op_from_status(status: &str) -> &'static str {
    if status == "?" || status.contains('A') {
        "created"
    } else if status.contains('D') {
        "deleted"
    } else if status.contains('R') {
        "renamed"
    } else {
        "modified"
    }
}

/// Cross-relay registry of open Bash brackets keyed by canonical repo root.
/// Owned by `AgentSupervisor` and cloned into every relay so brackets from
/// different sessions on the same checkout can see (and flag) each other's
/// overlap. Cheap to clone (an `Arc`).
#[derive(Debug, Clone, Default)]
pub struct BracketRegistry {
    inner: Arc<StdMutex<HashMap<PathBuf, Vec<OpenBracket>>>>,
}

impl BracketRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a bracket for `tool_use_id` on `repo_root`. Any other session's
    /// bracket already open on the same root cross-marks overlap in both
    /// directions (existing ↔ new), so a `close` later flags the delta
    /// ambiguous regardless of open/close ordering.
    pub fn open(
        &self,
        repo_root: PathBuf,
        tug_session_id: &str,
        tool_use_id: &str,
        parent_tool_use_id: Option<String>,
        opened_at: i64,
        pre: HashMap<PathBuf, FileState>,
    ) {
        let mut map = self.inner.lock().expect("bracket registry mutex");
        let siblings = map.entry(repo_root.clone()).or_default();
        let mut overlap = false;
        for other in siblings.iter_mut() {
            if other.tug_session_id != tug_session_id {
                other.saw_overlap = true;
                overlap = true;
            }
        }
        siblings.push(OpenBracket {
            tug_session_id: tug_session_id.to_owned(),
            tool_use_id: tool_use_id.to_owned(),
            parent_tool_use_id,
            opened_at,
            repo_root,
            pre,
            saw_overlap: overlap,
        });
    }

    /// Remove and return the bracket for `(tug_session_id, tool_use_id)`,
    /// or `None` if none is open (e.g. a replayed Bash `tool_result`, which
    /// never opened a bracket). Prunes an emptied repo-root entry.
    pub fn close_by_tool_use(
        &self,
        tug_session_id: &str,
        tool_use_id: &str,
    ) -> Option<OpenBracket> {
        let mut map = self.inner.lock().expect("bracket registry mutex");
        let mut found = None;
        let mut empty_root = None;
        for (root, brackets) in map.iter_mut() {
            if let Some(pos) = brackets
                .iter()
                .position(|b| b.tug_session_id == tug_session_id && b.tool_use_id == tool_use_id)
            {
                found = Some(brackets.remove(pos));
                if brackets.is_empty() {
                    empty_root = Some(root.clone());
                }
                break;
            }
        }
        if let Some(root) = empty_root {
            map.remove(&root);
        }
        found
    }

    /// Drop every bracket owned by `tug_session_id` — the relay-teardown
    /// sweep for brackets abandoned by a dying relay (a crash mid-Bash).
    pub fn sweep_session(&self, tug_session_id: &str) {
        let mut map = self.inner.lock().expect("bracket registry mutex");
        map.retain(|_root, brackets| {
            brackets.retain(|b| b.tug_session_id != tug_session_id);
            !brackets.is_empty()
        });
    }

    /// Count of currently-open brackets — test/diagnostic aid.
    pub fn open_count(&self) -> usize {
        self.inner
            .lock()
            .expect("bracket registry mutex")
            .values()
            .map(Vec::len)
            .sum()
    }
}

/// The canonical repo root for `dir` — the nearest ancestor (inclusive)
/// containing a `.git` entry (a directory for a normal repo, a file for a
/// worktree/submodule). `None` for a non-repo path, which never opens a
/// bracket. Mirrors the ancestor walk `feeds/git.rs::is_within_git_worktree`
/// uses, but returns the root so the snapshot and path resolution share it.
pub async fn repo_root_for(dir: &Path) -> Option<PathBuf> {
    let mut cursor = Some(dir);
    while let Some(current) = cursor {
        if tokio::fs::metadata(current.join(".git")).await.is_ok() {
            return Some(current.to_path_buf());
        }
        cursor = current.parent();
    }
    None
}

/// Snapshot the working tree at `repo_root` into a `path → FileState`
/// fingerprint (absolute paths). Runs `git status --porcelain=v2` and stats
/// each listed path for its mtime. A git failure degrades to an empty
/// snapshot (the bracket then attributes nothing, never a wrong guess).
pub async fn snapshot_worktree(repo_root: &Path) -> HashMap<PathBuf, FileState> {
    let mut map = HashMap::new();
    let Some(output) = run_git_status_porcelain(repo_root).await else {
        return map;
    };
    for (rel, status) in parse_worktree_states(&output) {
        let abs = repo_root.join(&rel);
        let mtime = tokio::fs::metadata(&abs)
            .await
            .ok()
            .and_then(|m| m.modified().ok());
        map.insert(abs, FileState { status, mtime });
    }
    map
}

/// Run `git -C <repo_root> status --porcelain=v2`, returning stdout on
/// success or `None` on any failure (non-repo, git error, spawn failure) —
/// the caller degrades to an empty snapshot.
async fn run_git_status_porcelain(repo_root: &Path) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "status",
            "--porcelain=v2",
        ])
        .output()
        .await
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        None
    }
}

/// Extract `(repo-relative path, status)` pairs from porcelain-v2 output.
/// `1 ` ordinary and `2 ` rename/copy entries yield their `XY` status
/// (rename's `X` is `R`); `? ` untracked entries yield `"?"`. Unmerged
/// (`u `) and header (`# `) lines are ignored. Mirrors the field layout
/// `feeds/git.rs::parse_porcelain_v2` reads.
pub(crate) fn parse_worktree_states(output: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("1 ") {
            // XY sub mH mI mW hH hI path
            let fields: Vec<&str> = rest.splitn(8, ' ').collect();
            if fields.len() >= 8 && !fields[0].is_empty() && !fields[7].is_empty() {
                out.push((fields[7].to_owned(), fields[0].to_owned()));
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // XY sub mH mI mW hH hI Xscore path\torig
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if fields.len() >= 9 {
                let new_path = fields[8].split('\t').next().unwrap_or(fields[8]);
                if !new_path.is_empty() {
                    out.push((new_path.to_owned(), fields[0].to_owned()));
                }
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            out.push((path.to_owned(), "?".to_owned()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_write_tool_use_and_resolves_file_path() {
        let line = br#"{"type":"tool_use","msg_id":"m1","seq":0,"tool_name":"Write","tool_use_id":"tu-1","input":{"file_path":"/proj/a.rs","content":"x"},"ipc_version":1}"#;
        let tu = InspectedToolUse::from_slice(line).expect("parse");
        assert_eq!(tu.tool_name, "Write");
        assert_eq!(tu.tool_use_id, "tu-1");
        assert_eq!(
            file_path_for_tool(&tu.tool_name, &tu.input).as_deref(),
            Some("/proj/a.rs")
        );
        assert_eq!(exact_op_for_tool(&tu.tool_name), Some("write"));
        assert_eq!(tu.parent_tool_use_id, None);
        assert_eq!(tu.timestamp, None);
    }

    #[test]
    fn notebook_edit_reads_notebook_path() {
        let input = serde_json::json!({ "notebook_path": "/proj/nb.ipynb" });
        assert_eq!(
            file_path_for_tool("NotebookEdit", &input).as_deref(),
            Some("/proj/nb.ipynb")
        );
        assert_eq!(exact_op_for_tool("NotebookEdit"), Some("notebook"));
    }

    #[test]
    fn bash_and_unknown_tools_are_not_exact() {
        assert_eq!(exact_op_for_tool("Bash"), None);
        assert_eq!(exact_op_for_tool("Read"), None);
        let input = serde_json::json!({ "command": "sed -i s/a/b/ x" });
        assert_eq!(file_path_for_tool("Bash", &input), None);
    }

    #[test]
    fn parses_subagent_tool_use_parent_id_and_replay_timestamp() {
        let line = br#"{"type":"tool_use","tool_name":"Edit","tool_use_id":"tu-child","input":{"file_path":"/proj/x.rs"},"parent_tool_use_id":"agent-1","timestamp":1700000000123}"#;
        let tu = InspectedToolUse::from_slice(line).expect("parse");
        assert_eq!(tu.parent_tool_use_id.as_deref(), Some("agent-1"));
        assert_eq!(tu.timestamp, Some(1_700_000_000_123));
    }

    #[test]
    fn tool_result_defaults_is_error_false_when_absent() {
        let line = br#"{"type":"tool_result","tool_use_id":"tu-1","output":"ok"}"#;
        let tr = InspectedToolResult::from_slice(line).expect("parse");
        assert!(!tr.is_error);
    }

    #[test]
    fn a_frame_missing_required_fields_does_not_parse_as_tool_use() {
        // A user_message that merely embeds a nested tool_use block (so the
        // relay's substring pre-filter fires) has no top-level tool_name —
        // it must not parse into an attributable InspectedToolUse.
        let line = br#"{"type":"user_message","content":[{"type":"tool_use","id":"nested"}]}"#;
        assert!(InspectedToolUse::from_slice(line).is_none());
    }

    fn call(path: &str) -> PendingCall {
        PendingCall {
            tool_name: "Write".to_owned(),
            file_path: path.to_owned(),
            op: "write",
            parent_tool_use_id: None,
            timestamp: None,
        }
    }

    #[test]
    fn pending_calls_insert_then_take_round_trips() {
        let mut p = PendingCalls::new();
        p.insert("tu-1".to_owned(), call("/a"));
        assert_eq!(p.len(), 1);
        let taken = p.take("tu-1").expect("present");
        assert_eq!(taken.file_path, "/a");
        assert_eq!(p.len(), 0);
        assert!(p.take("tu-1").is_none(), "a second take misses");
    }

    #[test]
    fn pending_calls_evicts_oldest_at_cap() {
        let mut p = PendingCalls::with_cap(2);
        p.insert("tu-1".to_owned(), call("/a"));
        p.insert("tu-2".to_owned(), call("/b"));
        p.insert("tu-3".to_owned(), call("/c")); // evicts tu-1
        assert_eq!(p.len(), 2);
        assert!(p.take("tu-1").is_none(), "oldest evicted");
        assert!(p.take("tu-2").is_some());
        assert!(p.take("tu-3").is_some());
    }

    #[test]
    fn pending_calls_reinsert_same_id_does_not_double_count_order() {
        // A re-emitted tool_use (replay) overwrites in place; the eviction
        // order must not treat it as a second live key.
        let mut p = PendingCalls::with_cap(2);
        p.insert("tu-1".to_owned(), call("/a"));
        p.insert("tu-1".to_owned(), call("/a2"));
        p.insert("tu-2".to_owned(), call("/b"));
        // tu-1 was re-inserted, not duplicated, so tu-2 fits without
        // evicting tu-1.
        assert_eq!(p.len(), 2);
        assert_eq!(p.take("tu-1").expect("still present").file_path, "/a2");
        assert!(p.take("tu-2").is_some());
    }

    #[test]
    fn into_row_carries_origin_and_at() {
        let project_dir = CanonicalPath::from_test_str("/proj");
        let row = call("/proj/a.rs").into_row(
            "tug-1",
            "tu-1",
            &project_dir,
            None,
            "replay",
            42,
        );
        assert_eq!(row.tug_session_id, "tug-1");
        assert_eq!(row.tool_use_id, "tu-1");
        // No repo root → the canonical absolute path is stored.
        assert_eq!(row.file_path, "/proj/a.rs");
        assert_eq!(row.project_dir, "/proj");
        assert_eq!(row.origin, "replay");
        assert_eq!(row.at, 42);
        assert!(!row.ambiguous);
    }

    /// An exact tool call under a canonical repo root records its file
    /// repo-relative at capture time.
    #[test]
    fn into_row_stores_repo_relative() {
        let project_dir = CanonicalPath::from_test_str("/repo");
        let repo_root = CanonicalPath::from_test_str("/repo");
        let row = call("/repo/roadmap/lens-frame.md").into_row(
            "tug-1",
            "tu-1",
            &project_dir,
            Some(&repo_root),
            "exact",
            1,
        );
        assert_eq!(row.file_path, "roadmap/lens-frame.md");
        assert_eq!(row.project_dir, "/repo");
    }

    /// A non-repo project dir has no root to strip against, so the canonical
    /// absolute path is stored — compose then treats it as unattributed
    /// against git, same as before.
    #[test]
    fn into_row_no_repo_root_keeps_absolute_canonical() {
        let project_dir = CanonicalPath::from_test_str("/nonrepo");
        let row =
            call("/nonrepo/a.rs").into_row("tug-1", "tu-1", &project_dir, None, "exact", 1);
        assert_eq!(row.file_path, "/nonrepo/a.rs");
    }

    // ---- Bash bracketing --------------------------------------------

    fn state(status: &str) -> FileState {
        FileState {
            status: status.to_owned(),
            mtime: None,
        }
    }

    #[test]
    fn op_from_status_maps_transitions() {
        assert_eq!(op_from_status("?"), "created");
        assert_eq!(op_from_status("A."), "created");
        assert_eq!(op_from_status(".M"), "modified");
        assert_eq!(op_from_status("M."), "modified");
        assert_eq!(op_from_status(".D"), "deleted");
        assert_eq!(op_from_status("R."), "renamed");
    }

    #[test]
    fn classify_op_detects_appear_disappear_and_no_change() {
        // Appeared in the dirty set.
        assert_eq!(classify_op(None, Some(&state("?"))), Some("created"));
        assert_eq!(classify_op(None, Some(&state(".M"))), Some("modified"));
        // Fell out of the dirty set (reverted / committed).
        assert_eq!(classify_op(Some(&state(".M")), None), Some("modified"));
        // Unchanged status AND mtime → no attribution.
        assert_eq!(classify_op(Some(&state(".M")), Some(&state(".M"))), None);
    }

    #[test]
    fn classify_op_same_status_different_mtime_is_a_change() {
        // A file already `M` before the command, modified again by it: the
        // status doesn't move but mtime does, so it must still attribute.
        let pre = FileState {
            status: ".M".to_owned(),
            mtime: Some(SystemTime::UNIX_EPOCH),
        };
        let post = FileState {
            status: ".M".to_owned(),
            mtime: Some(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1)),
        };
        assert_eq!(classify_op(Some(&pre), Some(&post)), Some("modified"));
    }

    #[test]
    fn into_delta_rows_covers_create_modify_delete_rename() {
        let mut pre = HashMap::new();
        pre.insert(PathBuf::from("/r/mod.rs"), state(".M")); // stays, mtime same → no row
        pre.insert(PathBuf::from("/r/gone.rs"), state(".M")); // disappears → modified
        let mut post = HashMap::new();
        post.insert(PathBuf::from("/r/mod.rs"), state(".M"));
        post.insert(PathBuf::from("/r/new.rs"), state("?")); // created
        post.insert(PathBuf::from("/r/del.rs"), state(".D")); // deleted
        post.insert(PathBuf::from("/r/ren.rs"), state("R.")); // renamed

        let bracket = OpenBracket {
            tug_session_id: "tug-1".to_owned(),
            tool_use_id: "tu-bash".to_owned(),
            parent_tool_use_id: Some("agent-1".to_owned()),
            opened_at: 10,
            repo_root: PathBuf::from("/r"),
            pre,
            saw_overlap: false,
        };
        let project_dir = CanonicalPath::from_test_str("/proj");
        let mut rows = bracket.into_delta_rows(&post, &project_dir, 99);
        rows.sort_by(|a, b| a.file_path.cmp(&b.file_path));

        // file_path is repo-relative (stripped against the bracket's repo_root).
        let by_path: HashMap<&str, &str> = rows
            .iter()
            .map(|r| (r.file_path.as_str(), r.op.as_str()))
            .collect();
        assert_eq!(by_path.get("new.rs"), Some(&"created"));
        assert_eq!(by_path.get("del.rs"), Some(&"deleted"));
        assert_eq!(by_path.get("ren.rs"), Some(&"renamed"));
        assert_eq!(by_path.get("gone.rs"), Some(&"modified"));
        assert!(!by_path.contains_key("mod.rs"), "unchanged path has no row");
        // Every row carries Bash/bash provenance, the parent id, and the
        // owning session's project_dir.
        for r in &rows {
            assert_eq!(r.tool_name, "Bash");
            assert_eq!(r.origin, "bash");
            assert_eq!(r.tug_session_id, "tug-1");
            assert_eq!(r.parent_tool_use_id.as_deref(), Some("agent-1"));
            assert_eq!(r.project_dir, "/proj");
            assert!(!r.ambiguous);
        }
    }

    #[test]
    fn into_delta_rows_flags_ambiguous_from_overlap() {
        let mut post = HashMap::new();
        post.insert(PathBuf::from("/r/a.rs"), state("?"));
        let bracket = OpenBracket {
            tug_session_id: "tug-1".to_owned(),
            tool_use_id: "tu".to_owned(),
            parent_tool_use_id: None,
            opened_at: 0,
            repo_root: PathBuf::from("/r"),
            pre: HashMap::new(),
            saw_overlap: true,
        };
        let project_dir = CanonicalPath::from_test_str("/proj");
        let rows = bracket.into_delta_rows(&post, &project_dir, 1);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].ambiguous, "overlap marks the delta ambiguous");
    }

    #[test]
    fn parse_worktree_states_reads_ordinary_rename_untracked() {
        let output = "\
# branch.oid abc
# branch.head main
1 .M N... 100644 100644 100644 aaa bbb src/mod.rs
2 R. N... 100644 100644 100644 aaa bbb R100 dst.rs\tsrc.rs
? new.txt
u UU N... 0 0 0 0 unmerged.rs
";
        let states = parse_worktree_states(output);
        let by: HashMap<&str, &str> = states
            .iter()
            .map(|(p, s)| (p.as_str(), s.as_str()))
            .collect();
        assert_eq!(by.get("src/mod.rs"), Some(&".M"));
        assert_eq!(by.get("dst.rs"), Some(&"R."), "rename reports the new path");
        assert_eq!(by.get("new.txt"), Some(&"?"));
        assert!(!by.contains_key("unmerged.rs"), "unmerged entries skipped");
    }

    #[test]
    fn bracket_registry_open_close_round_trips() {
        let reg = BracketRegistry::new();
        reg.open(
            PathBuf::from("/r"),
            "tug-1",
            "tu-1",
            None,
            0,
            HashMap::new(),
        );
        assert_eq!(reg.open_count(), 1);
        let b = reg
            .close_by_tool_use("tug-1", "tu-1")
            .expect("bracket present");
        assert_eq!(b.tool_use_id, "tu-1");
        assert!(!b.saw_overlap);
        assert_eq!(reg.open_count(), 0);
        assert!(
            reg.close_by_tool_use("tug-1", "tu-1").is_none(),
            "a second close misses"
        );
    }

    #[test]
    fn bracket_registry_cross_marks_overlap_between_sessions() {
        // Two sessions bracket the same root concurrently; both deltas must
        // come out ambiguous, regardless of which closes first.
        let reg = BracketRegistry::new();
        reg.open(
            PathBuf::from("/r"),
            "tug-A",
            "tu-A",
            None,
            0,
            HashMap::new(),
        );
        reg.open(
            PathBuf::from("/r"),
            "tug-B",
            "tu-B",
            None,
            1,
            HashMap::new(),
        );
        let a = reg.close_by_tool_use("tug-A", "tu-A").unwrap();
        let b = reg.close_by_tool_use("tug-B", "tu-B").unwrap();
        assert!(a.saw_overlap, "A overlapped B");
        assert!(b.saw_overlap, "B overlapped A");
    }

    #[test]
    fn bracket_registry_same_session_two_brackets_not_ambiguous() {
        let reg = BracketRegistry::new();
        reg.open(
            PathBuf::from("/r"),
            "tug-A",
            "tu-1",
            None,
            0,
            HashMap::new(),
        );
        reg.open(
            PathBuf::from("/r"),
            "tug-A",
            "tu-2",
            None,
            1,
            HashMap::new(),
        );
        let one = reg.close_by_tool_use("tug-A", "tu-1").unwrap();
        assert!(!one.saw_overlap, "same-owner brackets don't cross-flag");
    }

    #[test]
    fn bracket_registry_different_roots_do_not_overlap() {
        let reg = BracketRegistry::new();
        reg.open(
            PathBuf::from("/r1"),
            "tug-A",
            "tu-A",
            None,
            0,
            HashMap::new(),
        );
        reg.open(
            PathBuf::from("/r2"),
            "tug-B",
            "tu-B",
            None,
            1,
            HashMap::new(),
        );
        let a = reg.close_by_tool_use("tug-A", "tu-A").unwrap();
        assert!(!a.saw_overlap, "brackets on different roots never overlap");
    }

    #[test]
    fn bracket_registry_sweep_drops_a_sessions_brackets() {
        let reg = BracketRegistry::new();
        reg.open(
            PathBuf::from("/r"),
            "tug-A",
            "tu-A",
            None,
            0,
            HashMap::new(),
        );
        reg.open(
            PathBuf::from("/r"),
            "tug-B",
            "tu-B",
            None,
            1,
            HashMap::new(),
        );
        reg.sweep_session("tug-A");
        assert!(reg.close_by_tool_use("tug-A", "tu-A").is_none());
        assert!(
            reg.close_by_tool_use("tug-B", "tu-B").is_some(),
            "sweep leaves other sessions' brackets"
        );
    }

    // ---- real-git integration (snapshot + repo-root walk) -----------

    /// Init a git repo in a fresh tempdir with one committed file, so
    /// snapshots start from a clean working tree.
    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let run = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .args(args)
                .current_dir(root)
                .output()
                .expect("git")
                .status
                .success();
            assert!(ok, "git {args:?} failed");
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t.test"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\n").expect("write a.txt");
        run(&["add", "a.txt"]);
        run(&["commit", "-q", "-m", "init"]);
        dir
    }

    #[tokio::test]
    async fn snapshot_and_delta_over_a_real_repo() {
        let repo = init_repo();
        let root = repo.path().to_path_buf();

        // Clean tree → empty fingerprint.
        let pre = snapshot_worktree(&root).await;
        assert!(pre.is_empty(), "committed clean tree has no dirty paths");

        // A "Bash command" modifies a tracked file and creates a new one.
        std::fs::write(root.join("a.txt"), "one\ntwo\n").expect("modify a.txt");
        std::fs::write(root.join("b.txt"), "new\n").expect("create b.txt");

        let post = snapshot_worktree(&root).await;
        assert!(post.contains_key(&root.join("a.txt")));
        assert!(post.contains_key(&root.join("b.txt")));

        let bracket = OpenBracket {
            tug_session_id: "tug-1".to_owned(),
            tool_use_id: "tu-bash".to_owned(),
            parent_tool_use_id: None,
            opened_at: 0,
            repo_root: root.clone(),
            pre,
            saw_overlap: false,
        };
        let project_dir = CanonicalPath::from_test_str(root.to_str().unwrap());
        let rows = bracket.into_delta_rows(&post, &project_dir, 5);
        let by_path: HashMap<String, String> = rows
            .iter()
            .map(|r| (r.file_path.clone(), r.op.clone()))
            .collect();
        // Repo-relative paths, stripped against the bracket's repo_root.
        assert_eq!(by_path.get("a.txt"), Some(&"modified".to_owned()));
        assert_eq!(by_path.get("b.txt"), Some(&"created".to_owned()));
    }

    #[tokio::test]
    async fn repo_root_for_finds_root_and_rejects_non_repo() {
        let repo = init_repo();
        let root = repo.path();
        // From the root and from a subdir, the walk lands on the repo root.
        assert_eq!(repo_root_for(root).await.as_deref(), Some(root));
        let sub = root.join("nested/deeper");
        std::fs::create_dir_all(&sub).expect("mkdir");
        assert_eq!(repo_root_for(&sub).await.as_deref(), Some(root));

        // A tempdir with no `.git` ancestor is not a repo.
        let non_repo = tempfile::tempdir().expect("tempdir");
        assert_eq!(repo_root_for(non_repo.path()).await, None);
    }

    #[tokio::test]
    async fn snapshot_of_non_repo_is_empty() {
        // git fails outside a repo → degrade to an empty snapshot, never a
        // wrong guess.
        let non_repo = tempfile::tempdir().expect("tempdir");
        assert!(snapshot_worktree(non_repo.path()).await.is_empty());
    }

    #[tokio::test]
    async fn two_overlapping_brackets_on_one_repo_produce_ambiguous_rows() {
        // Two sessions bracket the same checkout with overlapping windows;
        // each session's own edit is attributed, but because the windows
        // overlapped, both deltas are flagged ambiguous (recorded, never
        // guessed) — the shared registry is what makes the relays see each
        // other.
        let repo = init_repo();
        let root = repo.path().to_path_buf();
        let reg = BracketRegistry::new();

        // Session A opens; then B opens (overlap) while A is still open.
        let pre_a = snapshot_worktree(&root).await;
        reg.open(root.clone(), "tug-A", "tu-A", None, 0, pre_a);
        let pre_b = snapshot_worktree(&root).await;
        reg.open(root.clone(), "tug-B", "tu-B", None, 1, pre_b);

        // Each session's command touches a different file.
        std::fs::write(root.join("from_a.txt"), "a\n").unwrap();
        std::fs::write(root.join("from_b.txt"), "b\n").unwrap();

        let project_dir = CanonicalPath::from_test_str(root.to_str().unwrap());
        let post_a = snapshot_worktree(&root).await;
        let a = reg.close_by_tool_use("tug-A", "tu-A").unwrap();
        let rows_a = a.into_delta_rows(&post_a, &project_dir, 2);

        let post_b = snapshot_worktree(&root).await;
        let b = reg.close_by_tool_use("tug-B", "tu-B").unwrap();
        let rows_b = b.into_delta_rows(&post_b, &project_dir, 3);

        assert!(!rows_a.is_empty() && !rows_b.is_empty());
        assert!(
            rows_a.iter().all(|r| r.ambiguous),
            "A's rows are ambiguous under overlap"
        );
        assert!(
            rows_b.iter().all(|r| r.ambiguous),
            "B's rows are ambiguous under overlap"
        );
    }
}
