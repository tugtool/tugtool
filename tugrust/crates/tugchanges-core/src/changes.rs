//! The `changes` operation — "which files did this session change?"
//!
//! Reads the session's `file_events` attribution rows from the read-only ledger
//! ([`crate::ledger`]), joins them against the current `git status` so
//! committed/reverted files drop out, dedups per repo-relative path (latest
//! live event wins op/origin), and — with `--diff` — attaches each file's
//! unified diff. Ported from `tugutil/src/commands/changes.rs`.
//!
//! **Invariant ([P01]): a dirty file is never invisible.** `git status
//! --untracked-files=all` is the universe of the shared resolution
//! ([`resolve_changes`]); the ledger *annotates* that universe, it does not
//! *filter* it. Every dirty path is classified into one of three buckets —
//! `attributed` (this session's live rows), `foreign` (only other sessions'
//! live rows), or `unattributed` (no live rows anywhere) — so a capture gap can
//! narrow *attribution* but can never drop a file from `context`. The
//! `changes()` op itself keeps its legacy event-scoped wire contract (only
//! `files`); the buckets surface through `context` ([Q01]).
//!
//! Two per-file rules govern classification:
//!
//! - **Row liveness.** A ledger row is live only while it postdates the last
//!   commit that touched its path ([`min_live_at_ms`]) — a commit *spends* the
//!   rows it absorbs, so a spent row neither attributes nor contends when the
//!   file goes dirty again later. Ties break toward spent, degrading to
//!   `unattributed` — visible, never falsely claimed.
//! - **Contention is per-file, computed here at read time.** An attributed
//!   path that other sessions also hold live rows for is `shared` (with the
//!   claimant list); capture never records a cross-session judgment, and
//!   wall-clock overlap between sessions is never evidence.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::git::{self, repo_root_for};
use crate::ledger;

/// Options for [`changes`]. `session` defaults from `$TUG_SESSION_ID`; `project`
/// defaults to cwd; `all` keeps committed/reverted files; `diff` attaches each
/// file's unified diff.
#[derive(Debug, Clone, Default)]
pub struct ChangesOptions {
    pub session: Option<String>,
    pub project: Option<PathBuf>,
    pub all: bool,
    pub diff: bool,
}

/// One changed file (Spec S01). `git_status` is the two-char porcelain-v1 code
/// (`" M"`, `"M "`, `"??"`, …), empty for an `--all` row no longer dirty.
/// `shared` marks per-file contention — other sessions also hold live rows for
/// the path — with `sessions` naming the claimants. `diff` is present only
/// when requested.
#[derive(Debug, Clone, Serialize)]
pub struct Change {
    pub path: String,
    pub op: String,
    pub origin: String,
    pub shared: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<String>,
    pub git_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
}

/// A dirty file with live claims only from *other* sessions (Spec S01). It is
/// never this session's to commit by default; `sessions` lists the claiming
/// `tug_session_id`s so the agent can see whose work it is. `diff` is present
/// only when requested (`context` always requests it).
#[derive(Debug, Clone, Serialize)]
pub struct ForeignChange {
    pub path: String,
    pub git_status: String,
    pub sessions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
}

/// The `changes` result (Spec S01 payload). `known` is the
/// unknown-session-with-no-events signal for the CLI's exit-code mapping — it is
/// not serialized (not part of the wire contract).
#[derive(Debug, Clone, Serialize)]
pub struct ChangesReport {
    pub session: String,
    pub project: String,
    pub files: Vec<Change>,
    #[serde(skip)]
    pub known: bool,
}

/// The exit-code-bearing outcome of a `changes`/`context` call. The three
/// `Exit2` variants are the ledger's "can't resolve the session" cases the CLI
/// maps to `ExitCode::from(2)`; `Other` is a real error mapped to exit 1 ([F5]).
/// A stringly `Err` would collapse the 0/2 distinction the original `changes` query drew.
#[derive(Debug, Clone)]
pub enum ChangesError {
    /// No session id (neither `--session` nor `$TUG_SESSION_ID`) — exit 2.
    NoSessionId,
    /// No changes ledger on disk — the session can't be known — exit 2.
    NoLedger { session: String },
    /// The session id is unknown to the ledger (no `sessions` row, no events) — exit 2.
    UnknownSession { session: String },
    /// A real error (git/sqlite/io) — exit 1.
    Other(String),
}

impl ChangesError {
    /// Whether this outcome maps to `ExitCode::from(2)` (a ledger-resolution
    /// case) rather than exit 1 (a real error).
    pub fn is_exit_two(&self) -> bool {
        !matches!(self, ChangesError::Other(_))
    }
}

impl fmt::Display for ChangesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChangesError::NoSessionId => write!(
                f,
                "no session id — run inside a Session-card session (which sets \
                 $TUG_SESSION_ID) or pass --session <id>"
            ),
            ChangesError::NoLedger { session } => {
                write!(f, "session '{session}' unknown (no session ledger found)")
            }
            ChangesError::UnknownSession { session } => {
                write!(f, "session '{session}' unknown to the ledger")
            }
            ChangesError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<String> for ChangesError {
    fn from(msg: String) -> Self {
        ChangesError::Other(msg)
    }
}

/// The shared resolution both `changes` and `context`/`commit` build on: the
/// resolved session, repo root, and the three dirty-file buckets ([P02]) plus
/// whether the session is known. `files` is the `attributed` bucket (this
/// session's rows); `unattributed` and `foreign` complete the working-tree
/// universe so nothing dirty is invisible ([P01]).
pub(crate) struct ResolvedChanges {
    pub session: String,
    pub repo_root: PathBuf,
    pub files: Vec<Change>,
    pub unattributed: Vec<Change>,
    pub foreign: Vec<ForeignChange>,
    pub known: bool,
}

/// The classified working tree ([P02]): every dirty path lands in exactly one
/// bucket. `attributed` is this session's rows (today's `Change` shape),
/// `unattributed` has no rows anywhere, `foreign` is claimed only by other
/// sessions on the same repo.
pub(crate) struct Buckets {
    pub attributed: Vec<Change>,
    pub unattributed: Vec<Change>,
    pub foreign: Vec<ForeignChange>,
}

/// Resolve the session, open the ledger, and compute the changed-file set —
/// the core `changes` pipeline, shared by `context` and `commit`. `diff`
/// attaches per-file unified diffs. Returns the exit-2 outcomes as typed
/// [`ChangesError`] variants.
pub(crate) fn resolve_changes(opts: &ChangesOptions) -> Result<ResolvedChanges, ChangesError> {
    let session = opts
        .session
        .clone()
        .or_else(|| std::env::var("TUG_SESSION_ID").ok())
        .filter(|s| !s.is_empty())
        .ok_or(ChangesError::NoSessionId)?;

    let project_dir = match &opts.project {
        Some(p) => p.clone(),
        None => std::env::current_dir()
            .map_err(|e| ChangesError::Other(format!("cannot resolve cwd: {e}")))?,
    };
    let repo_root = repo_root_for(&project_dir);

    // The machine-global changes ledger ([D112]) holds every instance's
    // `file_events`; the per-instance `sessions.db` contributes only the
    // "known session" test. A session recorded by another instance is known
    // through its rows alone.
    let changes_db = ledger::resolve_changes_db_path();
    if !changes_db.exists() {
        return Err(ChangesError::NoLedger { session });
    }
    let conn = ledger::open_readonly(&changes_db)?;
    let sessions_known = ledger::resolve_sessions_db_path()
        .filter(|p| p.exists())
        .and_then(|p| ledger::open_readonly(&p).ok())
        .map(|c| ledger::session_exists(&c, &session).unwrap_or(false))
        .unwrap_or(false);
    let known = sessions_known || ledger::session_has_events(&conn, &session)?;

    let Buckets {
        mut attributed,
        mut unattributed,
        mut foreign,
    } = compute_changes(&conn, &repo_root, &session, opts.all)?;

    // Exit-2 session resolution is unchanged and fires before the buckets are
    // trusted: an unknown id (no rows anywhere, no `sessions` row) is a
    // resolution error regardless of a dirty tree. A *known* session with no
    // attributed files but a dirty tree is not an error — it yields empty
    // `files` + populated `unattributed` ([P01]).
    if attributed.is_empty() && !known {
        return Err(ChangesError::UnknownSession { session });
    }

    if opts.diff {
        for change in &mut attributed {
            change.diff = Some(file_diff(&repo_root, &change.path, &change.git_status));
        }
        for change in &mut unattributed {
            change.diff = Some(file_diff(&repo_root, &change.path, &change.git_status));
        }
        for change in &mut foreign {
            change.diff = Some(file_diff(&repo_root, &change.path, &change.git_status));
        }
    }

    Ok(ResolvedChanges {
        session,
        repo_root,
        files: attributed,
        unattributed,
        foreign,
        known,
    })
}

/// Run the `changes` operation (Spec S01).
pub fn changes(opts: ChangesOptions) -> Result<ChangesReport, ChangesError> {
    let resolved = resolve_changes(&opts)?;
    Ok(ChangesReport {
        session: resolved.session,
        project: resolved.repo_root.to_string_lossy().into_owned(),
        files: resolved.files,
        known: resolved.known,
    })
}

/// Invert the join ([P01]): `git status` is the universe, the ledger annotates
/// it. Classify **every dirty path** into one of three buckets ([P02]) over
/// **live** rows (the row-liveness rule, [`min_live_at_ms`]), with **proof
/// rows** (`exact`/`replay` — the tool input named the file) the only evidence
/// that decides ownership, for any session including this one ([D112]):
///
/// - This session has a live proof row → `attributed`; `shared` iff another
///   session also has a live proof row (genuine same-file contention).
/// - No self proof row, but another session has a live proof row → the file
///   is that session's; `foreign`. This session's `bash`/`turn` rows are
///   ignored — a whole-tree fingerprint delta is contaminated by concurrent
///   saves and build churn, so it never overrides a real owner.
/// - No proof owner anywhere → `unattributed`, always. A live self
///   `bash`/`turn` row does NOT auto-attribute: the same delta that sweeps up
///   another session's save also sweeps up the **user's own hand-save** made
///   while the command ran, and the user's editor has no session to claim it
///   back. The bracket row instead becomes a *hint* on the unattributed entry
///   (its `op`/`origin` carry through, e.g. `modified`/`bash`) — "likely this
///   session's" — and inclusion stays an explicit disposition
///   (`--include-unattributed`/`--paths`), exactly like every other
///   unattributed file.
///
/// `all` additionally keeps this session's committed/reverted files (an event
/// row but no longer dirty) in `attributed` — a history view, so liveness does
/// not apply there.
fn compute_changes(
    conn: &Connection,
    repo_root: &Path,
    session: &str,
    all: bool,
) -> Result<Buckets, String> {
    let events = ledger::query_events(conn, session)?;
    let status_map = git::parse_status_porcelain_v2(&status_output(repo_root)).v1_status_map();

    // This session's events grouped per repo-relative path, oldest-first.
    let mut events_by_path: HashMap<String, Vec<ledger::EventRow>> = HashMap::new();
    for ev in events {
        let rel = repo_relative(repo_root, &ev.file_path);
        events_by_path.entry(rel).or_default().push(ev);
    }

    // Walk the working-tree universe in a deterministic order.
    let mut dirty_paths: Vec<String> = status_map.keys().cloned().collect();
    dirty_paths.sort();

    let mut attributed: Vec<Change> = Vec::new();
    let mut unattributed: Vec<Change> = Vec::new();
    let mut foreign: Vec<ForeignChange> = Vec::new();

    for path in &dirty_paths {
        let git_status = status_map.get(path).cloned().unwrap_or_default();
        let self_events = events_by_path.remove(path).unwrap_or_default();

        // Cheap SQL probe first; the liveness cut (one `git log` per path)
        // runs only when some row actually claims the path.
        let has_any_claim =
            !self_events.is_empty() || !ledger::sessions_for_path(conn, path, session)?.is_empty();
        if !has_any_claim {
            unattributed.push(unattributed_change(path, git_status));
            continue;
        }

        let min_live = min_live_at_ms(repo_root, path);
        let live_self: Vec<&ledger::EventRow> =
            self_events.iter().filter(|ev| ev.at >= min_live).collect();
        let latest_self_proof = live_self
            .iter()
            .rfind(|ev| ledger::origin_is_proof(&ev.origin));
        let foreign_proof =
            ledger::foreign_proof_sessions_for_path(conn, path, session, repo_root, min_live)?;

        if let Some(latest) = latest_self_proof {
            // This session provably edited the file. Contention requires
            // another session's *proof* row — bracket rows never mark shared.
            attributed.push(Change {
                path: path.clone(),
                op: latest.op.clone(),
                origin: latest.origin.clone(),
                shared: !foreign_proof.is_empty(),
                sessions: foreign_proof,
                git_status,
                diff: None,
            });
        } else if !foreign_proof.is_empty() {
            // Another session proof-owns the file; this session at most
            // bracket-grabbed it (contamination). It is theirs — foreign.
            foreign.push(ForeignChange {
                path: path.clone(),
                git_status,
                sessions: foreign_proof,
                diff: None,
            });
        } else if let Some(latest) = live_self.last() {
            // Only this session's bracket row claims the path. Correlation
            // never decides — not even for self: the same whole-tree delta
            // that sweeps up other sessions' saves sweeps up the user's own
            // hand-save during the command, and the user's editor has no
            // session to claim it back. The row survives as a hint on the
            // unattributed entry (op/origin carried through), and inclusion
            // stays an explicit disposition.
            unattributed.push(Change {
                path: path.clone(),
                op: latest.op.clone(),
                origin: latest.origin.clone(),
                shared: false,
                sessions: Vec::new(),
                git_status,
                diff: None,
            });
        } else {
            // No live claim of any kind (or only other sessions' bracket
            // contamination) — unattributed: visible, never falsely claimed.
            unattributed.push(unattributed_change(path, git_status));
        }
    }

    // `--all`: also keep this session's no-longer-dirty files (committed or
    // reverted since the event) — they weren't in the status universe above.
    if all {
        let mut leftover: Vec<Change> = events_by_path
            .into_iter()
            .map(|(path, evs)| {
                let latest = evs.last().expect("grouped paths hold at least one event");
                Change {
                    path,
                    op: latest.op.clone(),
                    origin: latest.origin.clone(),
                    shared: false,
                    sessions: Vec::new(),
                    git_status: String::new(),
                    diff: None,
                }
            })
            .collect();
        leftover.sort_by(|a, b| a.path.cmp(&b.path));
        attributed.extend(leftover);
    }

    attributed.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Buckets {
        attributed,
        unattributed,
        foreign,
    })
}

/// The sentinel `Change` for a dirty path no live row claims.
fn unattributed_change(path: &str, git_status: String) -> Change {
    Change {
        path: path.to_owned(),
        op: "unknown".to_string(),
        origin: "none".to_string(),
        shared: false,
        sessions: Vec::new(),
        git_status,
        diff: None,
    }
}

/// The row-liveness cut for `path` (epoch ms): a row is live iff
/// `row.at >= min_live_at_ms`. Derived from the last commit that touched the
/// path (`git log -1 --format=%ct -- <path>`), with the whole commit second
/// treated as spent so ties break toward spent (degrading to `unattributed` —
/// visible, never falsely claimed). A path with no commit history (a
/// new/untracked file) returns 0: nothing was ever absorbed, every row is
/// live.
fn min_live_at_ms(repo_root: &Path, path: &str) -> i64 {
    let out =
        git::git_stdout(repo_root, &["log", "-1", "--format=%ct", "--", path]).unwrap_or_default();
    match out.trim().parse::<i64>() {
        Ok(commit_secs) => (commit_secs + 1) * 1000,
        Err(_) => 0,
    }
}

/// Run `git status --porcelain=v2 --untracked-files=all` at `repo_root`,
/// returning empty on any failure (non-repo, git error). `--untracked-files=all`
/// expands a fully-untracked directory into its individual files ([P06]/G5) so a
/// new file inside one joins as itself, never collapsing to a `? dir/` line the
/// ledger can't match.
fn status_output(repo_root: &Path) -> String {
    git::git_stdout(
        repo_root,
        &["status", "--porcelain=v2", "--untracked-files=all"],
    )
    .unwrap_or_default()
}

/// The per-file unified diff for a `--diff`/`context` change (any bucket).
/// Tracked files use `git diff -- <path>` (working tree); an **untracked** file
/// (`git_status == "??"`, where `git diff` is silent) gets a synthesized
/// add-diff via `git diff --no-index -- /dev/null <path>` (which exits 1 with
/// output when the files differ — the normal case — so its output is used
/// regardless of exit).
fn file_diff(repo_root: &Path, path: &str, git_status: &str) -> String {
    if git_status == "??" {
        match git::git_output(
            repo_root,
            &["diff", "--no-color", "--no-index", "--", "/dev/null", path],
        ) {
            Ok(out) => String::from_utf8_lossy(&out.stdout).into_owned(),
            Err(_) => String::new(),
        }
    } else {
        git::git_stdout(repo_root, &["diff", "--no-color", "--", path]).unwrap_or_default()
    }
}

/// Project an absolute event `file_path` to a repo-relative string. Falls back
/// to the raw path when it doesn't live under `repo_root` (a same-repo session
/// won't hit this; never panics). Already-relative paths pass through.
fn repo_relative(repo_root: &Path, file_path: &str) -> String {
    if !file_path.starts_with('/') {
        return file_path.to_string();
    }
    let p = Path::new(file_path);
    match p.strip_prefix(repo_root) {
        Ok(rel) => rel.to_string_lossy().into_owned(),
        Err(_) => file_path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A git repo with one committed (clean) file and, for each name in
    /// `untracked`, an untracked (dirty) file.
    fn init_repo(untracked: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let git = |args: &[&str]| {
            assert!(
                std::process::Command::new("git")
                    .args(args)
                    .current_dir(root)
                    .output()
                    .expect("git")
                    .status
                    .success(),
                "git {args:?}"
            );
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t.test"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(root.join("clean.rs"), "clean\n").unwrap();
        git(&["add", "clean.rs"]);
        git(&["commit", "-q", "-m", "init"]);
        for name in untracked {
            std::fs::write(root.join(name), "dirty\n").unwrap();
        }
        dir
    }

    /// A sessions.db seeded with one session row plus events
    /// `(file_path, op, origin, ambiguous, at)`.
    fn seed_db(session: &str, events: &[(String, &str, &str, bool, i64)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (session_id TEXT PRIMARY KEY);
             CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        conn.execute("INSERT INTO sessions (session_id) VALUES (?1)", [session])
            .unwrap();
        for (i, (path, op, origin, amb, at)) in events.iter().enumerate() {
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', ?4, ?5, ?6, '/p', ?7)",
                rusqlite::params![session, format!("tu-{i}"), path, op, origin, i64::from(*amb), at],
            )
            .unwrap();
        }
        dir
    }

    #[test]
    fn changeset_joins_git_status_and_drops_committed_files() {
        let repo = init_repo(&["dirty.rs"]);
        let root = repo.path();
        let events = vec![
            (
                root.join("dirty.rs").to_string_lossy().into_owned(),
                "write",
                "exact",
                false,
                2,
            ),
            (
                root.join("clean.rs").to_string_lossy().into_owned(),
                "edit",
                "exact",
                false,
                1,
            ),
        ];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();

        let buckets = compute_changes(&conn, root, "s1", false).unwrap();
        let files = buckets.attributed;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "dirty.rs");
        assert_eq!(files[0].op, "write");
        assert_eq!(files[0].git_status, "??");

        let all_files = compute_changes(&conn, root, "s1", true).unwrap().attributed;
        let paths: Vec<&str> = all_files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["clean.rs", "dirty.rs"]);
        let clean = all_files.iter().find(|f| f.path == "clean.rs").unwrap();
        assert_eq!(clean.git_status, "");
    }

    #[test]
    fn diff_on_untracked_file_yields_nonempty_add_diff() {
        let repo = init_repo(&["fresh.rs"]);
        let root = repo.path();
        let events = vec![(
            root.join("fresh.rs").to_string_lossy().into_owned(),
            "created",
            "exact",
            false,
            1,
        )];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();
        let files = compute_changes(&conn, root, "s1", false)
            .unwrap()
            .attributed;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].git_status, "??");

        // The add-diff must be non-empty even though `git diff` alone is silent
        // for a new file (the F2 gap).
        let diff = file_diff(root, &files[0].path, &files[0].git_status);
        assert!(diff.contains("fresh.rs"), "add-diff names the file: {diff}");
        assert!(
            diff.contains("+dirty"),
            "add-diff carries the new content: {diff}"
        );
    }

    /// Current epoch ms — a realistic `at` for a live row (a tracked file's
    /// liveness cut sits at its last commit, made moments ago in these tests).
    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }

    #[test]
    fn diff_on_tracked_modified_file_is_nonempty() {
        let repo = init_repo(&[]);
        let root = repo.path();
        std::fs::write(root.join("clean.rs"), "clean\nmore\n").unwrap();
        // The edit postdates the init commit → the row is live.
        let events = vec![(
            root.join("clean.rs").to_string_lossy().into_owned(),
            "edit",
            "exact",
            false,
            now_ms() + 2_000,
        )];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();
        let files = compute_changes(&conn, root, "s1", false)
            .unwrap()
            .attributed;
        assert_eq!(files.len(), 1);
        let diff = file_diff(root, &files[0].path, &files[0].git_status);
        assert!(
            diff.contains("+more"),
            "tracked diff carries the edit: {diff}"
        );
    }

    #[test]
    fn spent_rows_never_reclaim_a_redirtied_file() {
        // The row-liveness rule: a session edited `clean.rs` long ago (row at
        // epoch ~0), the file was committed since (init_repo's commit), and now
        // someone re-dirties it. The fossil row must neither attribute nor
        // contend — the file degrades to `unattributed`, visible.
        let repo = init_repo(&[]);
        let root = repo.path();
        std::fs::write(root.join("clean.rs"), "clean\nlater\n").unwrap();
        let events = vec![(
            root.join("clean.rs").to_string_lossy().into_owned(),
            "edit",
            "exact",
            false,
            1,
        )];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();
        let buckets = compute_changes(&conn, root, "s1", false).unwrap();
        assert!(
            buckets.attributed.is_empty(),
            "the spent row does not attribute"
        );
        assert!(buckets.foreign.is_empty());
        assert_eq!(buckets.unattributed.len(), 1);
        assert_eq!(buckets.unattributed[0].path, "clean.rs");
    }

    #[test]
    fn unknown_session_is_unknown_valid_empty_is_known() {
        // The "known" test now lives in `resolve_changes` over the two ledger
        // helpers: a `sessions` row (this instance) or any `file_events` row
        // (any instance, via the shared changes ledger) makes a session known.
        let repo = init_repo(&[]);
        let db = seed_db("s1", &[("x.rs".to_owned(), "write", "exact", false, 1)]);
        let db_path = db.path().join("sessions.db");
        let conn = ledger::open_readonly(&db_path).unwrap();

        assert!(!ledger::session_exists(&conn, "ghost").unwrap());
        assert!(!ledger::session_has_events(&conn, "ghost").unwrap());
        let ghost = compute_changes(&conn, repo.path(), "ghost", false).unwrap();
        assert!(ghost.attributed.is_empty());

        // Valid session: known via its `sessions` row AND via its rows.
        assert!(ledger::session_exists(&conn, "s1").unwrap());
        assert!(ledger::session_has_events(&conn, "s1").unwrap());
    }

    /// Contract test (R04): a hand-built `sessions.db` with today's schema
    /// yields the expected changed files — guards the raw-SQL coupling. The
    /// legacy `ambiguous` column (poisoned to 1 on one row) is ignored
    /// outright: it never surfaces, never excludes, never marks anything.
    #[test]
    fn schema_coupling_contract_ignores_legacy_ambiguous_column() {
        let repo = init_repo(&["a.rs", "amb.rs"]);
        let root = repo.path();
        let events = vec![
            (
                root.join("a.rs").to_string_lossy().into_owned(),
                "write",
                "exact",
                false,
                1,
            ),
            (
                root.join("amb.rs").to_string_lossy().into_owned(),
                "modified",
                "bash",
                true,
                2,
            ),
        ];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();
        let buckets = compute_changes(&conn, root, "s1", false).unwrap();
        assert_eq!(buckets.attributed.len(), 1);
        assert_eq!(buckets.attributed[0].path, "a.rs");
        let hinted = buckets
            .unattributed
            .iter()
            .find(|f| f.path == "amb.rs")
            .unwrap();
        assert_eq!(hinted.origin, "bash", "the bracket hint carries through");
        assert!(
            !hinted.shared && hinted.sessions.is_empty(),
            "a poisoned legacy ambiguous=1 row has no effect on classification"
        );
    }

    #[test]
    fn attributed_provenance_comes_from_the_latest_proof_row() {
        // A path with both a proof row and a later bracket row attributes with
        // the PROOF row's op/origin — a correlation row never overwrites the
        // provenance the read-out shows.
        let repo = init_repo(&["a.rs"]);
        let root = repo.path();
        let p = root.join("a.rs").to_string_lossy().into_owned();
        let events = vec![
            (p.clone(), "write", "exact", false, 1),
            (p.clone(), "modified", "bash", true, 2),
        ];
        let db = seed_db("s1", &events);
        let conn = ledger::open_readonly(&db.path().join("sessions.db")).unwrap();
        let files = compute_changes(&conn, root, "s1", false)
            .unwrap()
            .attributed;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].op, "write");
        assert_eq!(files[0].origin, "exact");
        assert!(!files[0].shared, "a lone session's file is never shared");
    }

    /// Seed a db from `(tug_session_id, repo_relative_path, project_dir)` rows,
    /// registering a `sessions` row for each distinct session — the multi-session
    /// fixture the bucket tests need (the single-session `seed_db` hardcodes an
    /// off-repo `project_dir`, so it can't stand in for a foreign claimant).
    fn seed_sessions(rows: &[(&str, &str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (session_id TEXT PRIMARY KEY);
             CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        let mut seen: Vec<String> = Vec::new();
        for (i, (session, file_path, project_dir)) in rows.iter().enumerate() {
            if !seen.iter().any(|s| s == session) {
                conn.execute("INSERT INTO sessions (session_id) VALUES (?1)", [session])
                    .unwrap();
                seen.push(session.to_string());
            }
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', 'edit', 'exact', 0, ?4, ?5)",
                rusqlite::params![session, format!("tu-{i}"), file_path, project_dir, i as i64],
            )
            .unwrap();
        }
        dir
    }

    /// Like [`seed_sessions`] but with an explicit `origin` per row — the
    /// fixture the exact-vs-bracket authorship tests need.
    fn seed_sessions_origin(rows: &[(&str, &str, &str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (session_id TEXT PRIMARY KEY);
             CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        let mut seen: Vec<String> = Vec::new();
        for (i, (session, file_path, origin, project_dir)) in rows.iter().enumerate() {
            if !seen.iter().any(|s| s == session) {
                conn.execute("INSERT INTO sessions (session_id) VALUES (?1)", [session])
                    .unwrap();
                seen.push(session.to_string());
            }
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', 'edit', ?4, 0, ?5, ?6)",
                rusqlite::params![session, format!("tu-{i}"), file_path, origin, project_dir, i as i64],
            )
            .unwrap();
        }
        dir
    }

    fn open(db: &tempfile::TempDir) -> Connection {
        ledger::open_readonly(&db.path().join("sessions.db")).unwrap()
    }

    #[test]
    fn dirty_file_with_no_rows_is_unattributed() {
        let repo = init_repo(&["orphan.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        // `mine` exists but only touched a non-dirty file, so it has no claim on
        // the dirty `orphan.rs`.
        let db = seed_sessions(&[("mine", "clean.rs", &rootstr)]);
        let buckets = compute_changes(&open(&db), root, "mine", false).unwrap();

        assert!(buckets.attributed.is_empty());
        assert!(buckets.foreign.is_empty());
        assert_eq!(buckets.unattributed.len(), 1);
        let u = &buckets.unattributed[0];
        assert_eq!(u.path, "orphan.rs");
        assert_eq!(u.op, "unknown");
        assert_eq!(u.origin, "none");
        assert_eq!(u.git_status, "??");
    }

    #[test]
    fn file_claimed_only_by_another_session_is_foreign() {
        let repo = init_repo(&["shared.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions(&[
            ("mine", "clean.rs", &rootstr),
            ("theirs", "shared.rs", &rootstr),
        ]);
        let buckets = compute_changes(&open(&db), root, "mine", false).unwrap();

        assert!(buckets.attributed.is_empty());
        assert!(buckets.unattributed.is_empty());
        assert_eq!(buckets.foreign.len(), 1);
        let f = &buckets.foreign[0];
        assert_eq!(f.path, "shared.rs");
        assert_eq!(f.sessions, vec!["theirs".to_string()]);
        assert_eq!(f.git_status, "??");
    }

    #[test]
    fn file_touched_by_both_sessions_is_attributed_and_shared() {
        let repo = init_repo(&["shared.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions(&[
            ("mine", "shared.rs", &rootstr),
            ("theirs", "shared.rs", &rootstr),
        ]);
        let buckets = compute_changes(&open(&db), root, "mine", false).unwrap();

        assert_eq!(buckets.attributed.len(), 1);
        let mine = &buckets.attributed[0];
        assert_eq!(mine.path, "shared.rs");
        assert!(mine.shared, "a live foreign claim marks the file shared");
        assert_eq!(mine.sessions, vec!["theirs".to_string()]);
        assert!(buckets.foreign.is_empty());
        assert!(buckets.unattributed.is_empty());
    }

    #[test]
    fn a_bracket_grab_by_another_session_never_marks_my_file_shared() {
        // The pinned regression (meek-sheep): I exact-edited `mine.rs`. Another
        // session's `cargo test` / `git status` bracket swept it up (a whole-
        // tree delta contaminated by my concurrent save) — a `bash` row. That
        // bracket row must NOT make my file `shared`: only an exact row is
        // authorship.
        let repo = init_repo(&["mine.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions_origin(&[
            ("me", "mine.rs", "exact", &rootstr),
            ("bracketer", "mine.rs", "bash", &rootstr),
        ]);
        let buckets = compute_changes(&open(&db), root, "me", false).unwrap();

        assert_eq!(buckets.attributed.len(), 1);
        let mine = &buckets.attributed[0];
        assert_eq!(mine.path, "mine.rs");
        assert!(
            !mine.shared && mine.sessions.is_empty(),
            "a foreign bracket grab is not contention: {mine:?}"
        );
        assert!(buckets.foreign.is_empty());
    }

    #[test]
    fn a_file_i_only_bracket_grabbed_is_foreign_to_its_exact_owner() {
        // The symmetric case: `theirs.rs` is another session's exact work; my
        // Bash command's bracket grabbed it (I never opened it). It is theirs —
        // foreign to me — and my contaminated bracket row is ignored.
        let repo = init_repo(&["theirs.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions_origin(&[
            ("owner", "theirs.rs", "exact", &rootstr),
            ("me", "theirs.rs", "turn", &rootstr),
        ]);
        let buckets = compute_changes(&open(&db), root, "me", false).unwrap();

        assert!(
            buckets.attributed.is_empty(),
            "my bracket grab does not attribute another's file: {:?}",
            buckets.attributed
        );
        assert_eq!(buckets.foreign.len(), 1);
        assert_eq!(buckets.foreign[0].path, "theirs.rs");
        assert_eq!(buckets.foreign[0].sessions, vec!["owner".to_string()]);
    }

    #[test]
    fn a_hand_save_during_my_bash_bracket_is_never_auto_attributed() {
        // The pinned regression for the un-modeled actor: the USER saves a
        // file in their editor while this session's `cargo build` bracket is
        // open. The bracket sweeps it up — a self `bash` row — but the user's
        // editor has no session to claim it back, so correlation must never
        // decide, not even for self. The file surfaces as `unattributed` with
        // the bracket's op/origin as a hint; inclusion is an explicit
        // disposition. (A genuine sed/perl/git-mv edit lands here too — same
        // hint, same one-flag election.)
        let repo = init_repo(&["sed.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions_origin(&[("me", "sed.rs", "bash", &rootstr)]);
        let buckets = compute_changes(&open(&db), root, "me", false).unwrap();

        assert!(
            buckets.attributed.is_empty(),
            "a bracket-only self claim never auto-attributes: {:?}",
            buckets.attributed
        );
        assert!(buckets.foreign.is_empty());
        assert_eq!(buckets.unattributed.len(), 1);
        let hinted = &buckets.unattributed[0];
        assert_eq!(hinted.path, "sed.rs");
        assert_eq!(hinted.origin, "bash", "the hint names the bracket origin");
    }

    #[test]
    fn a_replay_row_attributes_like_an_exact_row() {
        // Replay is exact-tool backfill — proof, not correlation. A session
        // resumed from JSONL keeps ownership of its files.
        let repo = init_repo(&["resumed.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions_origin(&[("me", "resumed.rs", "replay", &rootstr)]);
        let buckets = compute_changes(&open(&db), root, "me", false).unwrap();

        assert_eq!(buckets.attributed.len(), 1);
        assert_eq!(buckets.attributed[0].path, "resumed.rs");
        assert_eq!(buckets.attributed[0].origin, "replay");
    }

    #[test]
    fn a_file_only_others_bracket_grabbed_degrades_to_unattributed() {
        // Only another session's bracket row touches the path (no exact owner
        // anywhere, and I have no row) — unreliable, so it degrades to
        // unattributed: visible, never falsely foreign.
        let repo = init_repo(&["churn.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions_origin(&[
            ("me", "unrelated.rs", "exact", &rootstr),
            ("bracketer", "churn.rs", "bash", &rootstr),
        ]);
        let buckets = compute_changes(&open(&db), root, "me", false).unwrap();

        assert!(buckets.foreign.is_empty(), "bracket-only is never foreign");
        assert_eq!(buckets.unattributed.len(), 1);
        assert_eq!(buckets.unattributed[0].path, "churn.rs");
    }

    #[test]
    fn file_in_untracked_directory_joins_as_itself_not_the_dir() {
        let repo = init_repo(&[]);
        let root = repo.path();
        std::fs::create_dir(root.join("newdir")).unwrap();
        std::fs::write(root.join("newdir/inner.rs"), "dirty\n").unwrap();
        let rootstr = root.to_string_lossy().into_owned();

        // Event row present → attributed, keyed by the FILE (proves -uall/G5:
        // plain porcelain would collapse to `newdir/` and the row would match
        // nothing).
        let db = seed_sessions(&[("mine", "newdir/inner.rs", &rootstr)]);
        let attributed = compute_changes(&open(&db), root, "mine", false)
            .unwrap()
            .attributed;
        assert_eq!(attributed.len(), 1);
        assert_eq!(attributed[0].path, "newdir/inner.rs");
        assert_eq!(attributed[0].git_status, "??");

        // No row → unattributed listing the file path, never `newdir/`.
        let db2 = seed_sessions(&[("mine", "clean.rs", &rootstr)]);
        let unattributed = compute_changes(&open(&db2), root, "mine", false)
            .unwrap()
            .unattributed;
        let paths: Vec<&str> = unattributed.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, vec!["newdir/inner.rs"]);
        assert!(!paths.iter().any(|p| p.ends_with('/')));
    }

    #[test]
    fn diff_attaches_to_an_unattributed_untracked_file() {
        let repo = init_repo(&["orphan.rs"]);
        let root = repo.path();
        let rootstr = root.to_string_lossy().into_owned();
        let db = seed_sessions(&[("mine", "clean.rs", &rootstr)]);
        let buckets = compute_changes(&open(&db), root, "mine", false).unwrap();
        assert_eq!(buckets.unattributed.len(), 1);
        let u = &buckets.unattributed[0];
        let diff = file_diff(root, &u.path, &u.git_status);
        assert!(
            diff.contains("orphan.rs"),
            "add-diff names the file: {diff}"
        );
        assert!(
            diff.contains("+dirty"),
            "add-diff carries the content: {diff}"
        );
    }
}
