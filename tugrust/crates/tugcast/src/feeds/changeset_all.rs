//! Aggregate changeset feed — the account-global view of every open
//! project's dirty state (CHANGESET_ALL, 0x24).
//!
//! One process-level feed (delivered like USAGE/PULSE, registered once in
//! `main.rs`, fanned out to every deck), replacing the per-workspace
//! `ChangesetFeed`. On each recompute it enumerates the current
//! `WorkspaceRegistry` entries (the open dev cards + bootstrap) and composes
//! one [`ProjectChangeset`] per project: a git working tree goes through the
//! shared [`compose_snapshot`] building block; a non-repo dir yields a
//! `no_repo: true` element the card renders with an "Initialize git"
//! affordance. The result is one [`WorkspacesChangesetSnapshot`] frame.
//!
//! Recompute triggers: a process-global `Notify` ("global bump") that the
//! attribution intercept fires (via `ChangesetBumper`) after each file-event
//! write, and that `WorkspaceRegistry::get_or_create`/`release` fire when a
//! project's first/last dev card opens/closes — plus a poll fallback that
//! catches hand edits. Emission is diff-suppressed.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Notify;
use tokio::sync::watch;
use tokio::time;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info};

use tugcast_core::types::{ChangesetSnapshot, ProjectChangeset, WorkspacesChangesetSnapshot};
use tugcast_core::{FeedId, Frame, SnapshotFeed};

use super::changeset::compose_snapshot;
use super::git::is_within_git_worktree;
use super::workspace_registry::WorkspaceRegistry;
use crate::session_ledger::SessionLedger;

/// Poll fallback interval — catches hand edits the bump channel can't see.
const POLL_INTERVAL_SECS: u64 = 2;

/// The account-global CHANGESET_ALL feed.
pub struct ChangesetAllFeed {
    /// The set of open projects to enumerate each recompute.
    registry: Arc<WorkspaceRegistry>,
    /// Shared ledger for the per-project `file_events` / owner joins.
    /// `None` in harnesses without a ledger — every dirty file then lands
    /// unattributed.
    ledger: Option<Arc<SessionLedger>>,
    /// Process-global recompute signal — shared with `ChangesetBumper` and
    /// the registry's open/close hooks. Permit semantics: bursts coalesce.
    bump: Arc<Notify>,
    poll_interval: Duration,
}

impl ChangesetAllFeed {
    pub fn new(
        registry: Arc<WorkspaceRegistry>,
        ledger: Option<Arc<SessionLedger>>,
        bump: Arc<Notify>,
    ) -> Self {
        Self {
            registry,
            ledger,
            bump,
            poll_interval: Duration::from_secs(POLL_INTERVAL_SECS),
        }
    }

    /// Test hook: stretch the poll so a recompute inside the test window can
    /// only have come from the bump channel.
    #[cfg(test)]
    pub fn with_poll_interval(mut self, poll_interval: Duration) -> Self {
        self.poll_interval = poll_interval;
        self
    }
}

#[async_trait]
impl SnapshotFeed for ChangesetAllFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::CHANGESET_ALL
    }

    fn name(&self) -> &str {
        "changeset_all"
    }

    async fn run(self: Box<Self>, tx: watch::Sender<Frame>, cancel: CancellationToken) {
        info!("aggregate changeset feed started");

        let mut interval = time::interval(self.poll_interval);
        let mut previous: Option<WorkspacesChangesetSnapshot> = None;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    info!("aggregate changeset feed shutting down");
                    break;
                }
                _ = interval.tick() => {}
                _ = self.bump.notified() => {}
            }

            let snapshot = compose_aggregate(&self.registry, self.ledger.as_deref()).await;

            if previous.as_ref() != Some(&snapshot) {
                let json = serde_json::to_vec(&snapshot).unwrap_or_default();
                let _ = tx.send(Frame::new(FeedId::CHANGESET_ALL, json));
                debug!(
                    projects = snapshot.projects.len(),
                    "aggregate changeset snapshot updated"
                );
                previous = Some(snapshot);
            }
        }
    }
}

/// Compose one aggregate snapshot over the registry's current entries.
///
/// Projects are emitted in the registry's enumeration order (sorted by
/// `project_dir`, so diff-suppression is stable). Each project is gated by
/// the subprocess-free [`is_within_git_worktree`] before any `git` runs: a
/// non-repo dir becomes a `no_repo: true` element; a repo dir goes through
/// [`compose_snapshot`]. A repo dir whose `git status` fails transiently
/// (compose returns `None` despite being within a worktree) degrades to an
/// empty repo element rather than flipping to `no_repo` — it self-heals on
/// the next recompute, and the card never offers "Initialize git" for a real
/// repository.
pub(crate) async fn compose_aggregate(
    registry: &WorkspaceRegistry,
    ledger: Option<&SessionLedger>,
) -> WorkspacesChangesetSnapshot {
    let open = registry.project_dirs();
    let mut projects = Vec::with_capacity(open.len());

    for (project_dir, workspace_key) in open {
        let display_name = project_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| project_dir.to_string_lossy().into_owned());
        let dir_str = project_dir.to_string_lossy().into_owned();

        if is_within_git_worktree(&project_dir).await {
            match compose_snapshot(&project_dir, ledger).await {
                Some(mut snapshot) => {
                    snapshot.workspace_key = workspace_key;
                    projects.push(ProjectChangeset {
                        project_dir: dir_str,
                        display_name,
                        no_repo: false,
                        snapshot,
                    });
                }
                None => {
                    // Within a worktree but `git status` failed this cycle —
                    // keep the project as a repo, empty until it recovers.
                    projects.push(ProjectChangeset {
                        project_dir: dir_str,
                        display_name,
                        no_repo: false,
                        snapshot: empty_snapshot(workspace_key),
                    });
                }
            }
        } else {
            projects.push(ProjectChangeset {
                project_dir: dir_str,
                display_name,
                no_repo: true,
                snapshot: empty_snapshot(workspace_key),
            });
        }
    }

    WorkspacesChangesetSnapshot { projects }
}

/// The empty per-project payload for a non-repo (or transiently-degraded)
/// project — no branch header, no changesets, nothing unattributed.
fn empty_snapshot(workspace_key: String) -> ChangesetSnapshot {
    ChangesetSnapshot {
        workspace_key,
        branch: String::new(),
        ahead: 0,
        behind: 0,
        head_sha: String::new(),
        head_message: String::new(),
        changesets: Vec::new(),
        unattributed: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_ledger::FileEventRow;
    use std::path::Path;
    use tugcast_core::spawn_snapshot_feed;

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("committed.txt"), "base\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "base commit"]);
    }

    fn event(session: &str, tool_use: &str, path: &Path, project: &Path) -> FileEventRow {
        FileEventRow {
            tug_session_id: session.to_owned(),
            tool_use_id: tool_use.to_owned(),
            file_path: path.to_string_lossy().into_owned(),
            tool_name: "Write".to_owned(),
            op: "write".to_owned(),
            origin: "exact".to_owned(),
            ambiguous: false,
            parent_tool_use_id: None,
            project_dir: project.to_string_lossy().into_owned(),
            at: 1_700_000_000_000,
        }
    }

    /// The aggregate composes one repo project (with attributed dirt) and one
    /// non-repo project into a single frame, and a global bump recomputes
    /// long before the poll fires.
    #[tokio::test]
    async fn aggregate_composes_repo_and_non_repo_and_bumps() {
        // Two open projects: a git repo and a bare directory.
        let repo_dir = tempfile::tempdir().unwrap();
        let repo = repo_dir.path().canonicalize().unwrap();
        init_repo(&repo);

        let plain_dir = tempfile::tempdir().unwrap();
        let plain = plain_dir.path().canonicalize().unwrap();

        let cancel = CancellationToken::new();
        let registry = Arc::new(WorkspaceRegistry::new_for_test());
        let _repo_entry = registry.get_or_create(&repo, cancel.clone()).unwrap();
        let _plain_entry = registry.get_or_create(&plain, cancel.clone()).unwrap();

        let ledger = Arc::new(SessionLedger::open_in_memory().unwrap());
        ledger
            .record_spawn("sess-a", "ws", &repo.to_string_lossy(), "card-1", 0)
            .unwrap();

        let bump = Arc::new(Notify::new());
        // Poll stretched to 60s: any emission after the first tick must come
        // from the bump.
        let feed = ChangesetAllFeed::new(
            Arc::clone(&registry),
            Some(Arc::clone(&ledger)),
            Arc::clone(&bump),
        )
        .with_poll_interval(Duration::from_secs(60));

        let (tx, mut rx) = watch::channel(Frame::new(FeedId::CHANGESET_ALL, vec![]));
        let feed_cancel = CancellationToken::new();
        let task = spawn_snapshot_feed(Box::new(feed), tx, feed_cancel.clone());

        // First emission: the immediate initial tick. Both projects present;
        // repo clean, plain flagged no_repo.
        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("initial snapshot within timeout")
            .expect("sender alive");
        let initial: WorkspacesChangesetSnapshot =
            serde_json::from_slice(&rx.borrow_and_update().payload).unwrap();
        assert_eq!(initial.projects.len(), 2);
        let repo_proj = initial
            .projects
            .iter()
            .find(|p| p.project_dir == repo.to_string_lossy())
            .expect("repo project present");
        assert!(!repo_proj.no_repo);
        assert_eq!(repo_proj.snapshot.branch, "main");
        assert!(repo_proj.snapshot.changesets.is_empty());
        let plain_proj = initial
            .projects
            .iter()
            .find(|p| p.project_dir == plain.to_string_lossy())
            .expect("plain project present");
        assert!(plain_proj.no_repo);
        assert_eq!(plain_proj.snapshot.branch, "");

        // A new attributed file in the repo + a global bump → recompute long
        // before the 60s poll.
        std::fs::write(repo.join("bumped.txt"), "x").unwrap();
        ledger
            .record_file_event(&event("sess-a", "tu-1", &repo.join("bumped.txt"), &repo))
            .unwrap();
        bump.notify_one();

        tokio::time::timeout(Duration::from_secs(5), rx.changed())
            .await
            .expect("bumped snapshot within timeout")
            .expect("sender alive");
        let bumped: WorkspacesChangesetSnapshot =
            serde_json::from_slice(&rx.borrow_and_update().payload).unwrap();
        let repo_proj = bumped
            .projects
            .iter()
            .find(|p| p.project_dir == repo.to_string_lossy())
            .expect("repo project present");
        assert_eq!(repo_proj.snapshot.changesets.len(), 1);

        feed_cancel.cancel();
        let _ = task.await;
        cancel.cancel();
        drop(_repo_entry);
        drop(_plain_entry);
    }
}
