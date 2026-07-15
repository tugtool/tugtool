//! The maintained-draft engine ([P21]/[P22], #draft-engine).
//!
//! One process-level task keeps every changeset entry's commit-message draft
//! current so Commit is one click. It taps a **clone of the CHANGESET_ALL
//! aggregate watch receiver** (never the bump `Notify` — that has a single
//! waiter) and, for each eligible entry, debounces a quiet period after its
//! content changes, then regenerates through the headless scribe — but only
//! when a content **fingerprint** (Spec S11) differs from the persisted
//! draft's, so an unchanged entry never spends a scribe call.
//!
//! Coalescing is by cancel-and-respawn: a fresh content change for an entry
//! aborts its pending debounce (and any in-flight generation — `kill_on_drop`
//! reaps the child) and starts over. Results persist to `changeset_drafts`
//! (Spec S09) and fire the global aggregate bump so the next frame carries the
//! draft. Live text deltas ride CONTROL frames (Spec S10, [P24]).
//!
//! The per-entry **change key** deliberately excludes draft fields: a draft
//! landing changes the snapshot frame, so keying the timer on the raw entry
//! would re-arm on every draft land and never converge.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, mpsc, watch};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use tugcast_core::types::{ChangesetEntry, WorkspacesChangesetSnapshot};
use tugcast_core::{FeedId, Frame};

use super::agent_supervisor::ScribeContext;
use super::workspace_registry::WorkspaceRegistry;
use crate::scribe;
use crate::session_ledger::{ChangesetDraftRow, SessionLedger};

/// Quiet period after an entry's last content change before regenerating.
const QUIET_PERIOD: Duration = Duration::from_secs(10);

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

/// One eligible entry pulled from a snapshot: its identity, its debounce
/// change key (draft-excluding), and its generation target.
struct PendingEntry {
    key: EntryKey,
    change_key: String,
    target: DraftTarget,
}

/// A live debounce/generation task for one entry.
struct EntryHandle {
    change_key: String,
    task: JoinHandle<()>,
}

impl Drop for EntryHandle {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// The engine's shared dependencies, cloned into each generation task.
#[derive(Clone)]
struct EngineDeps {
    control_tx: broadcast::Sender<Frame>,
    ledger: Arc<SessionLedger>,
    registry: Arc<WorkspaceRegistry>,
    scribe: ScribeContext,
    resolver: SessionResolver,
    quiet_period: Duration,
}

/// The maintained-draft engine.
pub struct DraftEngine {
    watch_rx: watch::Receiver<Frame>,
    deps: EngineDeps,
}

impl DraftEngine {
    pub fn new(
        watch_rx: watch::Receiver<Frame>,
        control_tx: broadcast::Sender<Frame>,
        ledger: Arc<SessionLedger>,
        registry: Arc<WorkspaceRegistry>,
        scribe: ScribeContext,
        resolver: SessionResolver,
    ) -> Self {
        Self {
            watch_rx,
            deps: EngineDeps {
                control_tx,
                ledger,
                registry,
                scribe,
                resolver,
                quiet_period: QUIET_PERIOD,
            },
        }
    }

    /// Run the engine until `cancel`. Each aggregate frame recomputes the set
    /// of eligible entries; entries whose change key moved (re)arm a debounce,
    /// entries that vanished are dropped (aborting their tasks).
    pub async fn run(mut self, cancel: CancellationToken) {
        let mut handles: HashMap<EntryKey, EntryHandle> = HashMap::new();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                changed = self.watch_rx.changed() => {
                    if changed.is_err() {
                        break; // sender dropped
                    }
                    let frame = self.watch_rx.borrow_and_update().clone();
                    let Ok(snapshot) =
                        serde_json::from_slice::<WorkspacesChangesetSnapshot>(&frame.payload)
                    else {
                        continue; // the initial empty frame, or a decode miss
                    };
                    self.reconcile(&mut handles, snapshot);
                }
            }
        }
    }

    fn reconcile(
        &self,
        handles: &mut HashMap<EntryKey, EntryHandle>,
        snapshot: WorkspacesChangesetSnapshot,
    ) {
        let pending = eligible_entries(snapshot);
        let present: std::collections::HashSet<EntryKey> =
            pending.iter().map(|p| p.key.clone()).collect();

        // Drop entries no longer eligible (their handle's Drop aborts).
        handles.retain(|key, _| present.contains(key));

        for entry in pending {
            if handles.get(&entry.key).map(|h| h.change_key.as_str())
                == Some(entry.change_key.as_str())
            {
                continue; // content unchanged since the last (re)arm
            }
            // Changed (or new): supersede any in-flight debounce/generation.
            handles.remove(&entry.key);
            let deps = self.deps.clone();
            let key = entry.key.clone();
            let change_key = entry.change_key.clone();
            let target = entry.target.clone();
            let task = tokio::spawn(async move {
                tokio::time::sleep(deps.quiet_period).await;
                generate_for_entry(&deps, &key, &target).await;
            });
            handles.insert(entry.key.clone(), EntryHandle { change_key, task });
        }
    }
}

/// Pull the eligible entries out of a snapshot with their change keys and
/// generation targets. Sessions/unattributed need ≥1 file; dashes need rounds
/// or worktree dirt.
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
                        change_key: head_change_key(&metas, &files),
                        target: DraftTarget::Head { files: metas },
                    });
                }
                ChangesetEntry::Dash {
                    owner_id,
                    base,
                    rounds,
                    worktree,
                    worktree_dirty,
                    files,
                    ..
                } => {
                    if rounds == 0 && !worktree_dirty {
                        continue;
                    }
                    let mut paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
                    paths.sort_unstable();
                    let change_key = format!("{rounds}|{worktree_dirty}|{}", paths.join("\n"));
                    // The dash branch ref is the owner id.
                    let branch = owner_id.clone();
                    out.push(PendingEntry {
                        key: EntryKey {
                            project_dir: project_dir.clone(),
                            owner_kind: "dash".to_string(),
                            owner_id,
                        },
                        change_key,
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
            let change_key = unattributed_change_key(&metas);
            out.push(PendingEntry {
                key: EntryKey {
                    project_dir: project_dir.clone(),
                    owner_kind: "unattributed".to_string(),
                    owner_id: String::new(),
                },
                change_key,
                target: DraftTarget::Head { files: metas },
            });
        }
    }
    out
}

fn head_change_key(metas: &[FileMeta], files: &[tugcast_core::types::ChangesetFile]) -> String {
    let mut pairs: Vec<String> = metas
        .iter()
        .map(|m| format!("{}\u{0}{}", m.path, m.git_status))
        .collect();
    pairs.sort();
    let max_touched = files.iter().map(|f| f.last_touched).max().unwrap_or(0);
    format!("{}|{max_touched}", pairs.join("\n"))
}

fn unattributed_change_key(metas: &[FileMeta]) -> String {
    let mut pairs: Vec<String> = metas
        .iter()
        .map(|m| format!("{}\u{0}{}", m.path, m.git_status))
        .collect();
    pairs.sort();
    pairs.join("\n")
}

/// Generate (or skip, per the fingerprint gate) the draft for one entry.
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

    // Fingerprint gate: an unchanged fingerprint means the persisted draft is
    // still current — no scribe call.
    if let Ok(Some(existing)) =
        deps.ledger
            .changeset_draft(&key.owner_kind, &key.owner_id, &key.project_dir)
    {
        if existing.fingerprint == fingerprint {
            return;
        }
    }

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
        .map(|events| {
            events
                .iter()
                .filter(|e| {
                    Path::new(&e.file_path)
                        .strip_prefix(&key.project_dir)
                        .ok()
                        .and_then(|p| p.to_str())
                        .map(|rel| dirty.contains(rel))
                        .unwrap_or(false)
                })
                .map(|e| e.at)
                .min()
                .unwrap_or(0)
        })
        .unwrap_or(0);

    scribe::session_prompts_since(&jsonl, since_ms, 20, 2_000)
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
                ambiguous: false,
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

    fn frame_of(snapshot: &WorkspacesChangesetSnapshot) -> Frame {
        Frame::new(FeedId::CHANGESET_ALL, serde_json::to_vec(snapshot).unwrap())
    }

    fn make_deps(
        fake: Arc<FakeScribe>,
        ledger: Arc<SessionLedger>,
    ) -> (EngineDeps, broadcast::Receiver<Frame>) {
        let (control_tx, control_rx) = broadcast::channel(64);
        let scribe = ScribeContext {
            spawner: fake,
            model: Arc::new(|| "sonnet".to_string()),
        };
        let deps = EngineDeps {
            control_tx,
            ledger,
            registry: Arc::new(WorkspaceRegistry::new_for_test()),
            scribe,
            resolver: Arc::new(|_| None),
            quiet_period: Duration::from_millis(40),
        };
        (deps, control_rx)
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

    #[tokio::test]
    async fn persists_a_draft_then_gates_on_fingerprint() {
        let (_dir, root) = init_repo();
        let project = root.to_string_lossy().to_string();
        let ledger = Arc::new(SessionLedger::open_in_memory().unwrap());
        let fake = FakeScribe::new("Change a.txt\n\n- edit the file");
        let (deps, _rx) = make_deps(fake.clone(), ledger.clone());

        let (watch_tx, watch_rx) = watch::channel(Frame::new(FeedId::CHANGESET_ALL, vec![]));
        let cancel = CancellationToken::new();
        let engine = DraftEngine { watch_rx, deps };
        let handle = tokio::spawn(engine.run(cancel.clone()));

        // A session entry with a dirty file → one generation, one persisted row.
        watch_tx
            .send(frame_of(&session_snapshot(&project, "M")))
            .unwrap();
        let row = wait_for_draft(&ledger, &project)
            .await
            .expect("draft persisted");
        assert_eq!(row.message, "Change a.txt\n\n- edit the file");
        assert_eq!(fake.calls.load(Ordering::SeqCst), 1);

        // An identical snapshot: the change key is unchanged, so no re-arm; and
        // even if it re-armed, the fingerprint matches → still one call.
        watch_tx
            .send(frame_of(&session_snapshot(&project, "M")))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(
            fake.calls.load(Ordering::SeqCst),
            1,
            "fingerprint gate holds"
        );

        cancel.cancel();
        let _ = handle.await;
    }

    #[tokio::test]
    async fn a_superseding_change_coalesces_to_one_generation() {
        let (_dir, root) = init_repo();
        let project = root.to_string_lossy().to_string();
        let ledger = Arc::new(SessionLedger::open_in_memory().unwrap());
        let fake = FakeScribe::new("msg");
        let (deps, _rx) = make_deps(fake.clone(), ledger.clone());

        let (watch_tx, watch_rx) = watch::channel(Frame::new(FeedId::CHANGESET_ALL, vec![]));
        let cancel = CancellationToken::new();
        let engine = DraftEngine { watch_rx, deps };
        let handle = tokio::spawn(engine.run(cancel.clone()));

        // Two changes within the quiet window: the first debounce is superseded
        // by the second (different change key), so only one generation runs.
        watch_tx
            .send(frame_of(&session_snapshot(&project, "M")))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;
        watch_tx
            .send(frame_of(&session_snapshot(&project, "MM")))
            .unwrap();

        let _ = wait_for_draft(&ledger, &project)
            .await
            .expect("draft persisted");
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert_eq!(fake.calls.load(Ordering::SeqCst), 1, "coalesced to one run");

        cancel.cancel();
        let _ = handle.await;
    }
}
