//! The on-demand draft engine (#draft-engine).
//!
//! A changeset entry's commit-message draft is generated on an explicit
//! request: [`spawn_on_demand_draft`] resolves the request against the latest
//! CHANGESET_ALL aggregate snapshot, derives the entry's generation target via
//! [`eligible_entries`], and — when a matching entry exists — spawns a detached
//! task that regenerates through the headless scribe. It regenerates
//! unconditionally: an explicit request always spends a scribe call (the
//! content **fingerprint**, Spec S11, is still computed and persisted, but no
//! longer gates generation).
//!
//! Results persist to `changeset_drafts` (Spec S09) and fire the global
//! aggregate bump so the next frame carries the draft. Live text deltas ride
//! CONTROL frames (Spec S10, [P24]). Generation runs on a detached task so the
//! caller — the router's per-client socket loop — never parks awaiting it.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, mpsc};
use tracing::warn;

use tugcast_core::types::{ChangesetEntry, WorkspacesChangesetSnapshot};
use tugcast_core::{FeedId, Frame};

use super::agent_supervisor::ScribeContext;
use super::workspace_registry::WorkspaceRegistry;
use crate::scribe;
use crate::session_ledger::{ChangesetDraftRow, SessionLedger};

/// Resolves a `tug_session_id` to its `claude_session_id` (for the session
/// JSONL path) — backed by the supervisor's in-memory ledger entries.
pub type SessionResolver = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Identity of a changeset entry across recomputes.
#[derive(Clone, PartialEq, Eq, Hash)]
struct EntryKey {
    project_dir: String,
    owner_kind: String,
    owner_id: String,
}

/// A file in a head-flavor entry, carrying everything the fingerprint and the
/// prompt need.
#[derive(Clone)]
struct FileMeta {
    path: String,
    git_status: String,
    op: String,
    origin: String,
}

/// What to generate for one eligible entry.
#[derive(Clone)]
enum DraftTarget {
    /// A session or unattributed entry — `git diff HEAD` scoped to its files.
    Head { files: Vec<FileMeta> },
    /// A dash entry — the range (rounds + worktree dirt) and its metadata.
    Dash {
        base: String,
        branch: String,
        worktree: String,
    },
}

/// One eligible entry pulled from a snapshot: its identity and its generation
/// target.
struct PendingEntry {
    key: EntryKey,
    target: DraftTarget,
}

/// The engine's shared dependencies, moved into the generation task.
#[derive(Clone)]
struct EngineDeps {
    control_tx: broadcast::Sender<Frame>,
    ledger: Arc<SessionLedger>,
    registry: Arc<WorkspaceRegistry>,
    scribe: ScribeContext,
    resolver: SessionResolver,
}

/// Resolve a draft request against the latest aggregate snapshot and, if an
/// eligible entry matches, spawn its generation on a detached task
/// (regenerating unconditionally — no fingerprint gate). Returns IMMEDIATELY:
/// `true` when a generation was spawned, `false` when no eligible entry matched
/// (nothing to draft). Does NOT await the scribe run — the caller is the
/// router's per-client socket loop, which must not park (R02, [P03]).
#[allow(clippy::too_many_arguments)]
pub fn spawn_on_demand_draft(
    control_tx: broadcast::Sender<Frame>,
    ledger: Arc<SessionLedger>,
    registry: Arc<WorkspaceRegistry>,
    scribe: ScribeContext,
    resolver: SessionResolver,
    snapshot: WorkspacesChangesetSnapshot,
    project_dir: &str,
    owner_kind: &str,
    owner_id: &str,
) -> bool {
    let deps = EngineDeps {
        control_tx,
        ledger,
        registry,
        scribe,
        resolver,
    };
    let Some(entry) = eligible_entries(snapshot).into_iter().find(|p| {
        p.key.project_dir == project_dir
            && p.key.owner_kind == owner_kind
            && p.key.owner_id == owner_id
    }) else {
        return false;
    };
    let key = entry.key;
    let target = entry.target;
    tokio::spawn(async move {
        generate_for_entry(&deps, &key, &target).await;
    });
    true
}

/// Pull the eligible entries out of a snapshot with their generation targets.
/// Sessions/unattributed need ≥1 file; dashes need rounds or worktree dirt.
fn eligible_entries(snapshot: WorkspacesChangesetSnapshot) -> Vec<PendingEntry> {
    let mut out = Vec::new();
    for project in snapshot.projects {
        let project_dir = project.project_dir.clone();
        if project.no_repo {
            continue;
        }
        for entry in project.snapshot.changesets {
            match entry {
                ChangesetEntry::Session {
                    owner_id, files, ..
                } => {
                    if files.is_empty() {
                        continue;
                    }
                    let metas: Vec<FileMeta> = files
                        .iter()
                        .map(|f| FileMeta {
                            path: f.path.clone(),
                            git_status: f.git_status.clone(),
                            op: f.op.clone(),
                            origin: f.origin.clone(),
                        })
                        .collect();
                    out.push(PendingEntry {
                        key: EntryKey {
                            project_dir: project_dir.clone(),
                            owner_kind: "session".to_string(),
                            owner_id,
                        },
                        target: DraftTarget::Head { files: metas },
                    });
                }
                ChangesetEntry::Dash {
                    owner_id,
                    base,
                    rounds,
                    worktree,
                    worktree_dirty,
                    ..
                } => {
                    if rounds == 0 && !worktree_dirty {
                        continue;
                    }
                    // The dash branch ref is the owner id.
                    let branch = owner_id.clone();
                    out.push(PendingEntry {
                        key: EntryKey {
                            project_dir: project_dir.clone(),
                            owner_kind: "dash".to_string(),
                            owner_id,
                        },
                        target: DraftTarget::Dash {
                            base,
                            branch,
                            worktree,
                        },
                    });
                }
            }
        }
        if !project.snapshot.unattributed.is_empty() {
            let metas: Vec<FileMeta> = project
                .snapshot
                .unattributed
                .iter()
                .map(|f| FileMeta {
                    path: f.path.clone(),
                    git_status: f.git_status.clone(),
                    op: String::new(),
                    origin: String::new(),
                })
                .collect();
            out.push(PendingEntry {
                key: EntryKey {
                    project_dir: project_dir.clone(),
                    owner_kind: "unattributed".to_string(),
                    owner_id: String::new(),
                },
                target: DraftTarget::Head { files: metas },
            });
        }
    }
    out
}

/// Generate the draft for one entry (regenerating unconditionally, [P02]).
async fn generate_for_entry(deps: &EngineDeps, key: &EntryKey, target: &DraftTarget) {
    let repo_dir = PathBuf::from(&key.project_dir);
    let style_rules = scribe::commit_style_rules();
    let git_subjects = git_log_subjects(&repo_dir, 10).await;

    let (fingerprint, prompt) = match target {
        DraftTarget::Head { files } => {
            gather_head(deps, key, &repo_dir, files, &style_rules, &git_subjects).await
        }
        DraftTarget::Dash {
            base,
            branch,
            worktree,
        } => {
            gather_dash(
                &repo_dir,
                base,
                branch,
                worktree,
                &style_rules,
                &git_subjects,
            )
            .await
        }
    };

    send_state(deps, key, "drafting", None);

    // Forward accumulated text deltas over CONTROL while the scribe runs.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let delta_deps = deps.clone();
    let delta_key = key.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            send_delta(&delta_deps, &delta_key, &text);
        }
    });

    let model = (deps.scribe.model)();
    let result = scribe::summarize_with(&deps.scribe.spawner, model, prompt, Some(tx)).await;
    forwarder.abort();

    match result {
        Ok(message) => {
            let row = ChangesetDraftRow {
                owner_kind: key.owner_kind.clone(),
                owner_id: key.owner_id.clone(),
                project_dir: key.project_dir.clone(),
                fingerprint,
                message,
                updated_at: now_millis(),
            };
            if let Err(err) = deps.ledger.upsert_changeset_draft(&row) {
                warn!(error = %err, "draft-engine: persist failed");
                send_state(deps, key, "error", Some("failed to persist draft"));
                return;
            }
            send_state(deps, key, "ready", None);
            // Fire the global aggregate bump so the next frame carries the draft.
            deps.registry.changeset_all_bump().notify_one();
        }
        Err(detail) => {
            warn!(detail = %detail, owner = %key.owner_id, "draft-engine: scribe failed");
            send_state(deps, key, "error", Some(&detail));
        }
    }
}

/// Gather the fingerprint + prompt for a head-flavor (session/unattributed)
/// entry.
async fn gather_head(
    deps: &EngineDeps,
    key: &EntryKey,
    repo_dir: &Path,
    files: &[FileMeta],
    style_rules: &str,
    git_subjects: &[String],
) -> (String, String) {
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    let diff = crate::feeds::git::fetch_git_diff(repo_dir, &paths)
        .await
        .unwrap_or_default();

    // Untracked files carry no HEAD-side diff, so their content changes are
    // invisible to `git diff HEAD` — fold in (path, size, mtime) instead.
    let mut untracked: Vec<(String, u64, i64)> = Vec::new();
    for file in files {
        if file.git_status.starts_with("??") {
            if let Ok(meta) = std::fs::metadata(repo_dir.join(&file.path)) {
                let size = meta.len();
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                untracked.push((file.path.clone(), size, mtime));
            }
        }
    }
    let status_pairs: Vec<(String, String)> = files
        .iter()
        .map(|f| (f.path.clone(), f.git_status.clone()))
        .collect();
    let fingerprint = scribe::fingerprint_head_entry(&status_pairs, &diff, &untracked);

    let file_provenance: Vec<(String, String, String)> = files
        .iter()
        .map(|f| (f.path.clone(), f.op.clone(), f.origin.clone()))
        .collect();

    let prompt = if key.owner_kind == "session" {
        let user_prompts = session_user_prompts(deps, key, files).await;
        scribe::compose_draft_prompt_session(
            style_rules,
            &file_provenance,
            &user_prompts,
            git_subjects,
            &diff,
        )
    } else {
        scribe::compose_draft_prompt_unattributed(
            style_rules,
            &file_provenance,
            git_subjects,
            &diff,
        )
    };
    (fingerprint, prompt)
}

/// The owning session's user prompts since the changeset began, read from its
/// claude JSONL. Empty when the claude id / file can't be resolved (the prompt
/// then degrades to diff + conventions).
async fn session_user_prompts(
    deps: &EngineDeps,
    key: &EntryKey,
    files: &[FileMeta],
) -> Vec<String> {
    let Some(claude_id) = (deps.resolver)(&key.owner_id) else {
        return Vec::new();
    };
    let jsonl = deps
        .ledger
        .claude_projects_root()
        .join(crate::session_ledger::encode_claude_project_name(
            &key.project_dir,
        ))
        .join(format!("{claude_id}.jsonl"));

    // "Since the changeset began" = the earliest file-event time across the
    // entry's currently-dirty paths.
    let dirty: std::collections::HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let since_ms = deps
        .ledger
        .file_events_for_session(&key.owner_id)
        .map(|events| earliest_dirty_touch(&events, &dirty))
        .unwrap_or(0);

    scribe::session_prompts_since(&jsonl, since_ms, 20, 2_000)
}

/// The earliest touch time across the entry's dirty paths, or 0 when none
/// match. `file_events.file_path` is repo-relative at capture (canonical-path
/// identity, c6d7b806), matching the dirty set's repo-relative `path` directly
/// — no prefix strip ([P09]).
fn earliest_dirty_touch(
    events: &[crate::session_ledger::FileEventRow],
    dirty: &std::collections::HashSet<&str>,
) -> i64 {
    events
        .iter()
        .filter(|e| dirty.contains(e.file_path.as_str()))
        .map(|e| e.at)
        .min()
        .unwrap_or(0)
}

/// Gather the fingerprint + prompt for a dash entry ([P23]).
async fn gather_dash(
    repo_dir: &Path,
    base: &str,
    branch: &str,
    worktree: &str,
    style_rules: &str,
    git_subjects: &[String],
) -> (String, String) {
    let head_sha = git_output(repo_dir, &["rev-parse", branch])
        .await
        .unwrap_or_default();
    let worktree_abs = repo_dir.join(worktree);
    let worktree_status = if worktree_abs.is_dir() {
        git_output(&worktree_abs, &["status", "--porcelain"])
            .await
            .unwrap_or_default()
    } else {
        String::new()
    };
    let fingerprint = scribe::fingerprint_dash_entry(&head_sha, &worktree_status);

    let diff = crate::feeds::git::fetch_dash_diff(repo_dir, worktree, base, branch)
        .await
        .unwrap_or_default();
    let git_log = git_output(
        repo_dir,
        &["log", "--format=%s%n%b", &format!("{base}..{branch}")],
    )
    .await
    .unwrap_or_default();
    let dash_name = branch.strip_prefix("tugdash/").unwrap_or(branch);
    let dash_log_lines = read_dash_log(repo_dir, dash_name);

    let prompt = scribe::compose_draft_prompt_dash(
        style_rules,
        &git_log,
        &dash_log_lines,
        git_subjects,
        &diff,
    );
    (fingerprint, prompt)
}

/// The last `n` commit subjects in `repo_dir` (voice for the draft).
async fn git_log_subjects(repo_dir: &Path, n: usize) -> Vec<String> {
    git_output(repo_dir, &["log", &format!("-n{n}"), "--format=%s"])
        .await
        .map(|out| out.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

/// Read the dash's per-round instruction lines from the well-known
/// project-state-dir `dash-log.md` ([P23]), filtered to `dash_name`. The line
/// format is `<iso8601>  <dash>  <marker>  <note>`; we keep `<note>`.
fn read_dash_log(repo_dir: &Path, dash_name: &str) -> Vec<String> {
    let path = tugutil_core::paths::project_state_dir(repo_dir).join("dash-log.md");
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for line in content.lines() {
        let mut fields = line.splitn(4, "  ");
        let _iso = fields.next();
        let dash = fields.next();
        let _marker = fields.next();
        let note = fields.next();
        if dash == Some(dash_name) {
            if let Some(note) = note {
                let note = note.trim();
                if !note.is_empty() {
                    lines.push(note.to_string());
                }
            }
        }
    }
    lines
}

/// Run a git command at `dir`, returning trimmed stdout on success.
async fn git_output(dir: &Path, args: &[&str]) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .await
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn send_state(deps: &EngineDeps, key: &EntryKey, state: &str, detail: Option<&str>) {
    let mut body = serde_json::json!({
        "action": "changeset_draft_state",
        "project_dir": key.project_dir,
        "owner_kind": key.owner_kind,
        "owner_id": key.owner_id,
        "state": state,
    });
    if let Some(detail) = detail {
        body["detail"] = serde_json::Value::String(detail.to_string());
    }
    let _ = deps.control_tx.send(Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("changeset_draft_state serializes"),
    ));
}

fn send_delta(deps: &EngineDeps, key: &EntryKey, text: &str) {
    let body = serde_json::json!({
        "action": "changeset_draft_delta",
        "project_dir": key.project_dir,
        "owner_kind": key.owner_kind,
        "owner_id": key.owner_id,
        "text": text,
    });
    let _ = deps.control_tx.send(Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("changeset_draft_delta serializes"),
    ));
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use crate::session_ledger::FileEventRow;

    use tugcast_core::types::{
        ChangesetEntry, ChangesetFile, ChangesetSnapshot, ProjectChangeset,
        WorkspacesChangesetSnapshot,
    };

    use crate::scribe::{ScribeDeltas, ScribeSpawner};

    /// A fake scribe: counts calls, streams two deltas, returns a scripted
    /// message.
    struct FakeScribe {
        message: String,
        calls: AtomicUsize,
        prompts: StdMutex<Vec<String>>,
    }
    impl FakeScribe {
        fn new(message: &str) -> Arc<Self> {
            Arc::new(Self {
                message: message.to_string(),
                calls: AtomicUsize::new(0),
                prompts: StdMutex::new(Vec::new()),
            })
        }
    }
    impl ScribeSpawner for FakeScribe {
        fn run(
            &self,
            _model: String,
            prompt: String,
            deltas: ScribeDeltas,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.prompts.lock().unwrap().push(prompt);
            if let Some(tx) = &deltas {
                let _ = tx.send("partial".to_string());
                let _ = tx.send(self.message.clone());
            }
            let message = self.message.clone();
            Box::pin(async move { Ok(message) })
        }
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git runs");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// A repo with one committed file and one tracked modification.
    fn init_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-q", "-b", "main"]);
        git(&root, &["config", "user.email", "t@t"]);
        git(&root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "base\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "base"]);
        std::fs::write(root.join("a.txt"), "changed\n").unwrap();
        (dir, root)
    }

    fn session_snapshot(project_dir: &str, status: &str) -> WorkspacesChangesetSnapshot {
        let entry = ChangesetEntry::Session {
            owner_id: "s1".to_string(),
            display_name: "s1".to_string(),
            live: true,
            files: vec![ChangesetFile {
                path: "a.txt".to_string(),
                git_status: status.to_string(),
                op: "edit".to_string(),
                origin: "exact".to_string(),
                shared: false,
                last_touched: 1,
            }],
            draft: None,
        };
        WorkspacesChangesetSnapshot {
            projects: vec![ProjectChangeset {
                project_dir: project_dir.to_string(),
                display_name: "proj".to_string(),
                no_repo: false,
                snapshot: ChangesetSnapshot {
                    workspace_key: "ws".to_string(),
                    branch: "main".to_string(),
                    ahead: 0,
                    behind: 0,
                    head_sha: String::new(),
                    head_message: String::new(),
                    changesets: vec![entry],
                    unattributed: vec![],
                },
                unattributed_draft: None,
            }],
        }
    }

    fn fileless_session_snapshot(project_dir: &str) -> WorkspacesChangesetSnapshot {
        let entry = ChangesetEntry::Session {
            owner_id: "s1".to_string(),
            display_name: "s1".to_string(),
            live: true,
            files: vec![],
            draft: None,
        };
        WorkspacesChangesetSnapshot {
            projects: vec![ProjectChangeset {
                project_dir: project_dir.to_string(),
                display_name: "proj".to_string(),
                no_repo: false,
                snapshot: ChangesetSnapshot {
                    workspace_key: "ws".to_string(),
                    branch: "main".to_string(),
                    ahead: 0,
                    behind: 0,
                    head_sha: String::new(),
                    head_message: String::new(),
                    changesets: vec![entry],
                    unattributed: vec![],
                },
                unattributed_draft: None,
            }],
        }
    }

    fn file_event(path: &str, at: i64) -> FileEventRow {
        FileEventRow {
            tug_session_id: "s1".to_string(),
            tool_use_id: "t".to_string(),
            file_path: path.to_string(),
            tool_name: "Edit".to_string(),
            op: "edit".to_string(),
            origin: "exact".to_string(),
            ambiguous: false,
            parent_tool_use_id: None,
            project_dir: "/proj".to_string(),
            at,
        }
    }

    fn scribe_ctx(fake: Arc<FakeScribe>) -> ScribeContext {
        ScribeContext {
            spawner: fake,
            model: Arc::new(|| "sonnet".to_string()),
        }
    }

    /// Issue an on-demand draft request for a `session` entry, returning the
    /// synchronous matched/no-match bool. Generation (if any) runs on a
    /// detached task.
    fn request(
        fake: Arc<FakeScribe>,
        ledger: Arc<SessionLedger>,
        snapshot: WorkspacesChangesetSnapshot,
        owner_id: &str,
        project: &str,
    ) -> bool {
        let (control_tx, _rx) = broadcast::channel(64);
        spawn_on_demand_draft(
            control_tx,
            ledger,
            Arc::new(WorkspaceRegistry::new_for_test()),
            scribe_ctx(fake),
            Arc::new(|_| None),
            snapshot,
            project,
            "session",
            owner_id,
        )
    }

    async fn wait_for_draft(ledger: &SessionLedger, project: &str) -> Option<ChangesetDraftRow> {
        for _ in 0..50 {
            if let Ok(Some(row)) = ledger.changeset_draft("session", "s1", project) {
                return Some(row);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        None
    }

    async fn wait_for_calls(fake: &FakeScribe, n: usize) {
        for _ in 0..50 {
            if fake.calls.load(Ordering::SeqCst) >= n {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("scribe calls did not reach {n}");
    }

    #[tokio::test]
    async fn on_demand_regenerates_ignoring_fingerprint() {
        let (_dir, root) = init_repo();
        let project = root.to_string_lossy().to_string();
        let ledger = Arc::new(SessionLedger::open_in_memory().unwrap());
        let fake = FakeScribe::new("Change a.txt\n\n- edit the file");
        let snap = session_snapshot(&project, "M");

        // First request generates and persists a row (storing its fingerprint).
        assert!(request(
            fake.clone(),
            ledger.clone(),
            snap.clone(),
            "s1",
            &project
        ));
        let row = wait_for_draft(&ledger, &project)
            .await
            .expect("draft persisted");
        assert_eq!(row.message, "Change a.txt\n\n- edit the file");
        wait_for_calls(&fake, 1).await;

        // The repo is unchanged, so a second request computes the SAME
        // fingerprint. The old gate would skip; on-demand regenerates.
        assert!(request(fake.clone(), ledger.clone(), snap, "s1", &project));
        wait_for_calls(&fake, 2).await;
        assert_eq!(
            fake.calls.load(Ordering::SeqCst),
            2,
            "regenerates despite a matching fingerprint"
        );
        assert!(
            ledger
                .changeset_draft("session", "s1", &project)
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn on_demand_no_entry_returns_false() {
        let (_dir, root) = init_repo();
        let project = root.to_string_lossy().to_string();
        let ledger = Arc::new(SessionLedger::open_in_memory().unwrap());
        let fake = FakeScribe::new("msg");

        // A fileless session is not eligible → no match, synchronous `false`.
        let matched = request(
            fake.clone(),
            ledger.clone(),
            fileless_session_snapshot(&project),
            "s1",
            &project,
        );
        assert!(!matched, "no eligible entry");
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(fake.calls.load(Ordering::SeqCst), 0, "no scribe call");
        assert!(
            ledger
                .changeset_draft("session", "s1", &project)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn session_prompts_since_uses_repo_relative_paths() {
        let dirty: std::collections::HashSet<&str> = ["a.txt", "sub/b.txt"].into_iter().collect();
        let events = vec![
            file_event("a.txt", 500),
            file_event("sub/b.txt", 200),
            // An unrelated (earlier) path must not lower the floor.
            file_event("unrelated.txt", 10),
        ];
        // The min touch across the dirty repo-relative paths — never 0, as the
        // broken absolute-prefix strip produced.
        assert_eq!(earliest_dirty_touch(&events, &dirty), 200);
    }
}
