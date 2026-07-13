//! Changeset composition — the workspace-scoped, owner-grouped view of a
//! checkout's dirty state.
//!
//! `compose_snapshot` is the pure building block: each call joins `git
//! status` against the attribution ledger (`file_events` grouped by owning
//! session), derives dash entries from `refs/heads/tugdash/`, and partitions
//! dirty files into owned / shared / unattributed buckets. The account-global
//! `ChangesetAllFeed` (`feeds::changeset_all`) calls it once per open project
//! and delivers the aggregate; `ChangesetBumper` pings that feed's global
//! recompute signal after each file-event write.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

use tugcast_core::types::{ChangesetEntry, ChangesetFile, ChangesetSnapshot, UnattributedFile};

use super::attribution::{parse_worktree_states, repo_root_for};
use super::git::{fetch_git_status, fetch_head_message, parse_porcelain_v2};
use super::workspace_registry::WorkspaceRegistry;
use crate::session_ledger::{ProjectFileEvent, SessionLedger};

/// Fires the account-global changeset recompute after a file-event write.
///
/// Held by the relay loop (one per session); `bump` pings the process-global
/// `ChangesetAllFeed` recompute signal via the registry. Cheap to clone. A
/// disconnected bumper (test harnesses without a registry) makes every `bump`
/// a no-op.
#[derive(Clone, Default)]
pub struct ChangesetBumper {
    registry: Option<Arc<WorkspaceRegistry>>,
}

impl ChangesetBumper {
    pub fn new(registry: Arc<WorkspaceRegistry>) -> Self {
        Self {
            registry: Some(registry),
        }
    }

    /// A bumper with no registry — every `bump` is a no-op. Test
    /// harnesses drive relays without a workspace registry.
    #[cfg(test)]
    pub fn disconnected() -> Self {
        Self::default()
    }

    /// Ping the account-global `ChangesetAllFeed` after a write in
    /// `project_dir`. The aggregate spans every open project, so any
    /// registered write triggers one recompute; `project_dir` no longer
    /// scopes the bump (the per-workspace feed was retired). Notifications
    /// coalesce (a permit, not a queue), so bursts cost one recompute.
    pub fn bump(&self, _project_dir: &Path) {
        if let Some(registry) = &self.registry {
            registry.changeset_all_bump().notify_one();
        }
    }
}

/// Per-owner aggregation while folding event rows into the snapshot.
struct OwnerAgg {
    display_name: String,
    live: bool,
    /// repo-relative path → file row; `BTreeMap` for deterministic output
    /// order (diff-suppression compares whole snapshots).
    files: BTreeMap<String, ChangesetFile>,
}

/// Compose one `ChangesetSnapshot` for the checkout containing
/// `project_dir` (`workspace_key` left empty for the caller to fill).
/// `None` when the dir is not inside a git working tree or `git status`
/// fails — the feed skips the cycle, like GitFeed.
pub(crate) async fn compose_snapshot(
    project_dir: &Path,
    ledger: Option<&SessionLedger>,
) -> Option<ChangesetSnapshot> {
    let repo_root = repo_root_for(project_dir).await?;
    let status_output = fetch_git_status(&repo_root).await?;

    let header = parse_porcelain_v2(&status_output);
    let head_message = fetch_head_message(&repo_root).await;

    // Dirty working-tree files: repo-relative path → porcelain-v2 XY
    // status ("??" for untracked, matching the familiar v1 rendering).
    let dirty: BTreeMap<String, String> = parse_worktree_states(&status_output)
        .into_iter()
        .map(|(path, status)| {
            let status = if status == "?" {
                "??".to_owned()
            } else {
                status
            };
            (path, status)
        })
        .collect();

    // Fold attribution events into per-owner buckets. Events are
    // oldest-first, so the latest event for a path wins op/origin while
    // ambiguity ORs across all of them (same rule as `tugutil changes`).
    // Events whose file is no longer dirty (committed / reverted) drop out.
    let events = match ledger {
        Some(ledger) => ledger
            .file_events_for_project(&project_dir.to_string_lossy())
            .unwrap_or_default(),
        None => Vec::new(),
    };
    let mut owners: BTreeMap<String, OwnerAgg> = BTreeMap::new();
    for pfe in &events {
        let rel = repo_relative(&repo_root, &pfe.event.file_path);
        let Some(git_status) = dirty.get(&rel) else {
            continue;
        };
        let owner = owners
            .entry(pfe.event.tug_session_id.clone())
            .or_insert_with(|| OwnerAgg {
                display_name: session_display_name(pfe),
                live: pfe.owner_live,
                files: BTreeMap::new(),
            });
        let file = owner
            .files
            .entry(rel.clone())
            .or_insert_with(|| ChangesetFile {
                path: rel.clone(),
                git_status: git_status.clone(),
                op: pfe.event.op.clone(),
                origin: pfe.event.origin.clone(),
                ambiguous: false,
                shared: false,
                last_touched: pfe.event.at,
            });
        file.op = pfe.event.op.clone();
        file.origin = pfe.event.origin.clone();
        file.ambiguous |= pfe.event.ambiguous;
        file.last_touched = file.last_touched.max(pfe.event.at);
    }

    // Multi-owner rule: a path in more than one owner's bucket is marked
    // shared everywhere it appears.
    let mut owner_counts: HashMap<&str, usize> = HashMap::new();
    for agg in owners.values() {
        for path in agg.files.keys() {
            *owner_counts.entry(path.as_str()).or_default() += 1;
        }
    }
    let shared_paths: Vec<String> = owner_counts
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(p, _)| (*p).to_owned())
        .collect();
    for agg in owners.values_mut() {
        for path in &shared_paths {
            if let Some(file) = agg.files.get_mut(path) {
                file.shared = true;
            }
        }
    }

    // Unattributed: dirty files no owner claims.
    let unattributed: Vec<UnattributedFile> = dirty
        .iter()
        .filter(|(path, _)| !owners.values().any(|agg| agg.files.contains_key(*path)))
        .map(|(path, git_status)| UnattributedFile {
            path: path.clone(),
            git_status: git_status.clone(),
        })
        .collect();

    let mut changesets: Vec<ChangesetEntry> = owners
        .into_iter()
        .map(|(owner_id, agg)| ChangesetEntry::Session {
            owner_id,
            display_name: agg.display_name,
            live: agg.live,
            files: agg.files.into_values().collect(),
        })
        .collect();
    changesets.extend(dash_entries(&repo_root).await);

    Some(ChangesetSnapshot {
        workspace_key: String::new(),
        branch: header.branch,
        ahead: header.ahead,
        behind: header.behind,
        head_sha: header.head_sha,
        head_message,
        changesets,
        unattributed,
    })
}

/// Owner display name: the session's `name` when the user set it, else the
/// first 8 chars of the session id (the Z4B chip's fallback rendering).
fn session_display_name(pfe: &ProjectFileEvent) -> String {
    if pfe.owner_name_user_set {
        if let Some(name) = &pfe.owner_name {
            if !name.is_empty() {
                return name.clone();
            }
        }
    }
    let id = &pfe.event.tug_session_id;
    id.chars().take(8).collect()
}

fn repo_relative(repo_root: &Path, file_path: &str) -> String {
    match Path::new(file_path).strip_prefix(repo_root) {
        Ok(rel) => rel.to_string_lossy().into_owned(),
        Err(_) => file_path.to_owned(),
    }
}

/// Derive one dash entry per `refs/heads/tugdash/` branch, the same way
/// `tugutil dash list` does (branch config `tugbase`, `rev-list --count`
/// rounds, worktree dirt) plus the `base...branch` name-status file list.
/// Duplicated from the tugutil CLI until the dash core extracts into a
/// shared crate.
async fn dash_entries(repo_root: &Path) -> Vec<ChangesetEntry> {
    let Some(branches) = git_stdout(
        repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/tugdash/",
        ],
    )
    .await
    else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for branch in branches.lines().filter(|l| !l.trim().is_empty()) {
        let name = branch.trim_start_matches("tugdash/");
        let base = git_stdout(
            repo_root,
            &["config", "--get", &format!("branch.{branch}.tugbase")],
        )
        .await
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "main".to_owned());

        let rounds = git_stdout(
            repo_root,
            &["rev-list", "--count", &format!("{base}..{branch}")],
        )
        .await
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

        // Worktree home convention: `.tugtree/tugdash__<sanitized-name>`
        // (same sanitizer as the CLI: path separators → `__`, `:`/space →
        // `_`, everything else non-alphanumeric dropped).
        let sanitized: String = name
            .replace(['/', '\\'], "__")
            .replace([':', ' '], "_")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let worktree_rel = format!(".tugtree/tugdash__{sanitized}");
        let worktree_abs = repo_root.join(&worktree_rel);
        let worktree_dirty = if worktree_abs.exists() {
            git_stdout(&worktree_abs, &["status", "--porcelain"])
                .await
                .map(|s| !s.is_empty())
                .unwrap_or(false)
        } else {
            false
        };

        let files = git_stdout(
            repo_root,
            &["diff", "--name-status", &format!("{base}...{branch}")],
        )
        .await
        .map(|out| parse_name_status(&out))
        .unwrap_or_default();

        entries.push(ChangesetEntry::Dash {
            owner_id: branch.to_owned(),
            display_name: name.to_owned(),
            base,
            rounds,
            worktree: worktree_rel,
            worktree_dirty,
            files,
        });
    }
    entries
}

/// Parse `git diff --name-status` output into dash file rows. Rename lines
/// (`R<score>\told\tnew`) report the destination path.
fn parse_name_status(output: &str) -> Vec<ChangesetFile> {
    let mut files = Vec::new();
    for line in output.lines() {
        let mut fields = line.split('\t');
        let Some(status) = fields.next() else {
            continue;
        };
        let Some(letter) = status.chars().next() else {
            continue;
        };
        let path = if letter == 'R' || letter == 'C' {
            fields.nth(1)
        } else {
            fields.next()
        };
        let Some(path) = path else { continue };
        let op = match letter {
            'A' => "created",
            'D' => "deleted",
            'R' => "renamed",
            _ => "modified",
        };
        files.push(ChangesetFile {
            path: path.to_owned(),
            git_status: letter.to_string(),
            op: op.to_owned(),
            origin: "dash".to_owned(),
            ambiguous: false,
            shared: false,
            last_touched: 0,
        });
    }
    files
}

/// Run a git command at `dir`, returning trimmed stdout on success, `None`
/// on any failure.
async fn git_stdout(dir: &Path, args: &[&str]) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_ledger::FileEventRow;
    use std::path::PathBuf;

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

    /// A real repo with one commit; canonicalized so event project_dir
    /// strings match what `repo_root_for` resolves.
    fn init_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");
        git(&root, &["init", "-q", "-b", "main"]);
        git(&root, &["config", "user.email", "t@t"]);
        git(&root, &["config", "user.name", "t"]);
        std::fs::write(root.join("committed.txt"), "base\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "base commit"]);
        (dir, root)
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

    #[tokio::test]
    async fn compose_partitions_owned_shared_ambiguous_and_unattributed() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("owned.txt"), "x").unwrap();
        std::fs::write(root.join("both.txt"), "x").unwrap();
        std::fs::write(root.join("tainted.txt"), "x").unwrap();
        std::fs::write(root.join("hand-edit.txt"), "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess-alpha", "ws", &root.to_string_lossy(), "card-1", 0)
            .unwrap();
        ledger.rename("sess-alpha", Some("alpha work")).unwrap();

        ledger
            .record_file_event(&event("sess-alpha", "tu-1", &root.join("owned.txt"), &root))
            .unwrap();
        ledger
            .record_file_event(&event("sess-alpha", "tu-2", &root.join("both.txt"), &root))
            .unwrap();
        ledger
            .record_file_event(&event("sess-beta", "tu-3", &root.join("both.txt"), &root))
            .unwrap();
        let mut tainted = event("sess-alpha", "tu-4", &root.join("tainted.txt"), &root);
        tainted.origin = "bash".to_owned();
        tainted.ambiguous = true;
        ledger.record_file_event(&tainted).unwrap();
        // An event whose file was since committed/reverted must drop out.
        ledger
            .record_file_event(&event(
                "sess-alpha",
                "tu-5",
                &root.join("committed.txt"),
                &root,
            ))
            .unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");

        assert_eq!(snapshot.branch, "main");
        assert_eq!(snapshot.head_message, "base commit");
        assert_eq!(snapshot.changesets.len(), 2);

        let ChangesetEntry::Session {
            owner_id,
            display_name,
            live,
            files,
        } = &snapshot.changesets[0]
        else {
            panic!("expected session entry");
        };
        assert_eq!(owner_id, "sess-alpha");
        assert_eq!(display_name, "alpha work");
        assert!(live);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["both.txt", "owned.txt", "tainted.txt"]);
        assert!(files[0].shared, "both.txt has two owners");
        assert!(!files[1].shared);
        assert!(files[2].ambiguous, "bash overlap taints tainted.txt");
        assert_eq!(files[2].origin, "bash");
        assert_eq!(files[0].git_status, "??");

        let ChangesetEntry::Session {
            owner_id,
            display_name,
            live,
            files,
        } = &snapshot.changesets[1]
        else {
            panic!("expected session entry");
        };
        assert_eq!(owner_id, "sess-beta");
        // No sessions row for sess-beta: display falls back to the id
        // prefix and the entry reads not-live.
        assert_eq!(display_name, "sess-bet");
        assert!(!live);
        assert!(files[0].shared);

        let unattributed: Vec<&str> = snapshot
            .unattributed
            .iter()
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(unattributed, ["hand-edit.txt"]);
    }

    #[tokio::test]
    async fn compose_derives_dash_entries_from_tugdash_refs() {
        let (_dir, root) = init_repo();
        git(&root, &["branch", "tugdash/demo"]);
        git(&root, &["config", "branch.tugdash/demo.tugbase", "main"]);
        git(&root, &["switch", "-q", "tugdash/demo"]);
        std::fs::write(root.join("dash-work.txt"), "round\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "dash round"]);
        git(&root, &["switch", "-q", "main"]);

        let snapshot = compose_snapshot(&root, None).await.expect("repo");
        assert_eq!(snapshot.changesets.len(), 1);
        let ChangesetEntry::Dash {
            owner_id,
            display_name,
            base,
            rounds,
            worktree,
            worktree_dirty,
            files,
        } = &snapshot.changesets[0]
        else {
            panic!("expected dash entry");
        };
        assert_eq!(owner_id, "tugdash/demo");
        assert_eq!(display_name, "demo");
        assert_eq!(base, "main");
        assert_eq!(*rounds, 1);
        assert_eq!(worktree, ".tugtree/tugdash__demo");
        assert!(!worktree_dirty);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "dash-work.txt");
        assert_eq!(files[0].git_status, "A");
        assert_eq!(files[0].op, "created");
        assert_eq!(files[0].origin, "dash");
    }

    #[tokio::test]
    async fn compose_skips_non_repo_dirs() {
        let dir = tempfile::tempdir().unwrap();
        // Guard against the tempdir living under a real repo.
        if repo_root_for(dir.path()).await.is_none() {
            assert!(compose_snapshot(dir.path(), None).await.is_none());
        }
    }


    #[test]
    fn parse_name_status_maps_letters_and_renames() {
        let out = "A\tadded.txt\nM\tchanged.txt\nD\tgone.txt\nR100\told.txt\tnew.txt";
        let files = parse_name_status(out);
        let got: Vec<(&str, &str, &str)> = files
            .iter()
            .map(|f| (f.path.as_str(), f.git_status.as_str(), f.op.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                ("added.txt", "A", "created"),
                ("changed.txt", "M", "modified"),
                ("gone.txt", "D", "deleted"),
                ("new.txt", "R", "renamed"),
            ]
        );
    }
}
