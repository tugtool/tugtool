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

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use tugcast_core::types::{
    ChangesetDraft, ChangesetEntry, ChangesetFile, ChangesetSnapshot, UnattributedFile,
};

use super::attribution::{parse_worktree_states, repo_root_for};
use super::git::{fetch_git_status, fetch_head_message, parse_porcelain_v2};
use super::workspace_registry::WorkspaceRegistry;
use crate::path_resolver::{CanonicalPath, same_file};
use crate::session_ledger::{
    FileEventRewrite, ProjectFileEvent, SessionLedger, SessionRow, SessionState,
};

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
    // The `file_events` bucket key is canonical (the relay writes it through the
    // gateway), so query the canonical spelling of `project_dir`. Legacy rows
    // written before canonicalization carry the raw spelling; union them in
    // (when it differs) so pre-upgrade attribution still scopes in until the
    // backfill converts them.
    let events = match ledger {
        Some(ledger) => {
            let raw = project_dir.to_string_lossy();
            let canonical = CanonicalPath::from_raw(project_dir);
            let mut events = ledger
                .file_events_for_project(canonical.as_str())
                .unwrap_or_default();
            if canonical.as_str() != raw {
                events.extend(ledger.file_events_for_project(&raw).unwrap_or_default());
            }
            events
        }
        None => Vec::new(),
    };

    // Opportunistic lazy backfill: collapse this project's legacy absolute rows
    // to canonical project_dir + repo-relative file_path, once per project per
    // process. Correctness never depends on it — the bridge already reconciles
    // legacy rows at read time (`events` above was read pre-backfill and this
    // snapshot is composed from it); the backfill just makes later reads direct.
    // It runs only for open projects (never a boot walk), preserving the
    // no-TCC-prompt-on-boot property.
    if let Some(ledger) = ledger {
        let canonical = CanonicalPath::from_raw(project_dir);
        let fresh = backfill_marker()
            .lock()
            .expect("backfill marker mutex")
            .insert(canonical.as_str().to_owned());
        if fresh {
            let rewrites: Vec<FileEventRewrite> = events
                .iter()
                .filter(|pfe| pfe.event.file_path.starts_with('/'))
                .filter_map(|pfe| {
                    let rel = repo_relative(&repo_root, &pfe.event.file_path);
                    (rel != pfe.event.file_path).then(|| FileEventRewrite {
                        tug_session_id: pfe.event.tug_session_id.clone(),
                        tool_use_id: pfe.event.tool_use_id.clone(),
                        old_file_path: pfe.event.file_path.clone(),
                        new_file_path: rel,
                    })
                })
                .collect();
            if !rewrites.is_empty() {
                let _ = ledger.backfill_file_events_repo_relative(canonical.as_str(), &rewrites);
            }
        }
    }
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
            draft: None,
        })
        .collect();
    changesets.extend(dash_entries(&repo_root).await);

    // Attach maintained drafts (Spec S10) to eligible entries: a session
    // entry with files, a dash with rounds or worktree dirt. The engine only
    // persists drafts for eligible entries, but gating here keeps a stale
    // draft off an entry that has since gone clean.
    if let Some(ledger) = ledger {
        if let Ok(drafts) = ledger.changeset_drafts_for_project(&project_dir.to_string_lossy()) {
            let by_owner: HashMap<(&str, &str), &crate::session_ledger::ChangesetDraftRow> = drafts
                .iter()
                .map(|d| ((d.owner_kind.as_str(), d.owner_id.as_str()), d))
                .collect();
            for entry in &mut changesets {
                match entry {
                    ChangesetEntry::Session {
                        owner_id,
                        files,
                        draft,
                        ..
                    } if !files.is_empty() => {
                        *draft = by_owner
                            .get(&("session", owner_id.as_str()))
                            .map(|row| draft_from_row(row));
                    }
                    ChangesetEntry::Dash {
                        owner_id,
                        rounds,
                        worktree_dirty,
                        draft,
                        ..
                    } if *rounds > 0 || *worktree_dirty => {
                        *draft = by_owner
                            .get(&("dash", owner_id.as_str()))
                            .map(|row| draft_from_row(row));
                    }
                    _ => {}
                }
            }
        }
    }

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

/// Join a workspace's ledger session rows into a composed snapshot.
///
/// Two effects, both keyed by `session_id`:
///
/// - every **live** session gains an entry — fileless when it owns no dirty
///   files — so the card can list every open session, clean or not;
/// - every session entry with a matching ledger row takes its
///   `display_name` from [`session_row_title`] (the chooser's rule: name →
///   prompt snippet → id prefix) and its `live` flag from the row's state.
///
/// Entries re-sort to (sessions by id, dashes by ref) so injection order
/// never perturbs diff-suppression.
pub(crate) fn apply_session_rows(snapshot: &mut ChangesetSnapshot, rows: &[SessionRow]) {
    let by_id: HashMap<&str, &SessionRow> = rows
        .iter()
        .map(|row| (row.session_id.as_str(), row))
        .collect();

    let mut present: HashSet<String> = HashSet::new();
    for entry in &mut snapshot.changesets {
        if let ChangesetEntry::Session {
            owner_id,
            display_name,
            live,
            ..
        } = entry
        {
            present.insert(owner_id.clone());
            if let Some(row) = by_id.get(owner_id.as_str()) {
                *display_name = session_row_title(row);
                *live = row.state == SessionState::Live;
            }
        }
    }

    for row in rows {
        if row.state != SessionState::Live || present.contains(&row.session_id) {
            continue;
        }
        snapshot.changesets.push(ChangesetEntry::Session {
            owner_id: row.session_id.clone(),
            display_name: session_row_title(row),
            live: true,
            files: Vec::new(),
            draft: None,
        });
    }

    snapshot
        .changesets
        .sort_by(|a, b| entry_sort_key(a).cmp(&entry_sort_key(b)));
}

/// Deterministic entry order: sessions (by id) before dashes (by ref).
fn entry_sort_key(entry: &ChangesetEntry) -> (u8, &str) {
    match entry {
        ChangesetEntry::Session { owner_id, .. } => (0, owner_id.as_str()),
        ChangesetEntry::Dash { owner_id, .. } => (1, owner_id.as_str()),
    }
}

/// Session row title, the session chooser's rule: the session's name (a
/// `/rename` or auto `aiTitle`) when set, else a one-line snippet of the
/// last user prompt, else the first 8 chars of the session id.
fn session_row_title(row: &SessionRow) -> String {
    if let Some(name) = &row.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_owned();
        }
    }
    if let Some(prompt) = &row.last_user_prompt {
        let snippet = snippet_for_display(prompt, 64);
        if !snippet.is_empty() {
            return snippet;
        }
    }
    row.session_id.chars().take(8).collect()
}

/// Collapse whitespace runs to single spaces and truncate to `max` chars
/// with an ellipsis — mirrors the picker's `truncateForDisplay`.
fn snippet_for_display(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = flat.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
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

/// Project a persisted draft row onto its wire shape (Spec S10).
pub(crate) fn draft_from_row(row: &crate::session_ledger::ChangesetDraftRow) -> ChangesetDraft {
    ChangesetDraft {
        fingerprint: row.fingerprint.clone(),
        message: row.message.clone(),
        updated_at: row.updated_at,
    }
}

/// Canonical project dirs whose legacy `file_events` rows have already been
/// backfilled this process — the once-per-project guard for the opportunistic
/// lazy backfill in [`compose_snapshot`].
fn backfill_marker() -> &'static Mutex<HashSet<String>> {
    static MARKER: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    MARKER.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Project a recorded `file_path` to the repo-relative key `git status`
/// speaks, reconciling every storage form ([#l01-bridge-cases]):
///
/// - **Already relative** (new capture-time rows) — returned unchanged.
/// - **Absolute** (legacy rows) — both `repo_root` and `file_path` are routed
///   through the canonical gateway and stripped, so a firmlink/synthetic
///   spelling of the repo root collapses to the file's space before the strip.
/// - **Residual mismatch** — walk `file_path`'s ancestors for one that is the
///   same live directory as `repo_root` (`same_file`) and strip that; failing
///   all of it, return the input (falls to unattributed, never a wrong match).
fn repo_relative(repo_root: &Path, file_path: &str) -> String {
    // New capture-time rows are already repo-relative.
    if !file_path.starts_with('/') {
        return file_path.to_owned();
    }

    // Legacy absolute row: canonicalize both sides, then strip. The firmlink
    // split (repo_root and file_path spelled differently) collapses here.
    let canonical_root = CanonicalPath::from_raw(repo_root);
    let canonical_file = CanonicalPath::from_raw(Path::new(file_path));
    if let Ok(rel) = canonical_file
        .as_path()
        .strip_prefix(canonical_root.as_path())
    {
        return rel.to_string_lossy().into_owned();
    }

    // Residual mismatch: find the ancestor of `file_path` that is the same live
    // directory as `repo_root` by `(dev, ino)`, then strip lexically.
    let file = Path::new(file_path);
    for ancestor in file.ancestors() {
        if same_file(ancestor, repo_root) {
            if let Ok(rel) = file.strip_prefix(ancestor) {
                return rel.to_string_lossy().into_owned();
            }
        }
    }
    file_path.to_owned()
}

/// Derive one dash entry per `refs/heads/tugdash/` branch, the same way
/// `tugutil dash list` does (branch config `tugbase`, `rev-list --count`
/// rounds, worktree dirt) plus the `base...branch` name-status file list.
/// Duplicated from the tug CLI until the dash core extracts into a
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

        // Worktree home convention (same sanitizer as the CLI: path
        // separators → `__`, `:`/space → `_`, everything else non-alphanumeric
        // dropped): the current `.tug/worktrees/<sanitized>` home, falling back
        // to the legacy `.tugtree/tugdash__<sanitized>` path when a dash hasn't
        // migrated yet — mirrors tugdash-core's `worktree_path` resolution.
        let sanitized: String = name
            .replace(['/', '\\'], "__")
            .replace([':', ' '], "_")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let new_rel = format!(".tug/worktrees/{sanitized}");
        let legacy_rel = format!(".tugtree/tugdash__{sanitized}");
        let (worktree_rel, worktree_abs) = {
            let new_abs = repo_root.join(&new_rel);
            if new_abs.exists() {
                (new_rel, new_abs)
            } else {
                let legacy_abs = repo_root.join(&legacy_rel);
                if legacy_abs.exists() {
                    (legacy_rel, legacy_abs)
                } else {
                    (new_rel, new_abs)
                }
            }
        };
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
            draft: None,
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

/// Commit exactly `files` (repo-relative) in `repo_dir` with `message`
/// ([P15]), routed through `tugmark_core::commit` ([P06]).
///
/// The staging-by-construction contract is unchanged — `tugmark_core::commit`
/// with an explicit `--paths` set runs `git add -- <files…>` then
/// `git commit -m <message> -- <files…>`, committing **only** those paths and
/// refusing an empty list / blank message with the same error strings. The
/// sync library is driven off the async feed via `spawn_blocking`, the same
/// pattern tugcast uses for `tugdash-core` ([P02]).
///
/// Returns the structured [`tugmark_core::CommitReceipt`]; the card path takes
/// `.sha` and the raw `.numstat` for the wire frame it already scrapes ([Q01]).
pub(crate) async fn run_changeset_commit(
    repo_dir: &Path,
    files: &[String],
    message: &str,
) -> Result<tugmark_core::CommitReceipt, String> {
    let project = repo_dir.to_path_buf();
    let files = files.to_vec();
    let message = message.to_string();
    tokio::task::spawn_blocking(move || {
        tugmark_core::commit(tugmark_core::CommitOptions {
            session: None,
            project: Some(project),
            message,
            paths: Some(files),
            all: false,
        })
    })
    .await
    .map_err(|e| format!("commit task panicked: {e}"))?
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
            .record_spawn(
                "sess-alpha",
                "ws",
                &root.to_string_lossy(),
                "card-1",
                0,
                None,
            )
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
            ..
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
            ..
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
            ..
        } = &snapshot.changesets[0]
        else {
            panic!("expected dash entry");
        };
        assert_eq!(owner_id, "tugdash/demo");
        assert_eq!(display_name, "demo");
        assert_eq!(base, "main");
        assert_eq!(*rounds, 1);
        assert_eq!(worktree, ".tug/worktrees/demo");
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

    fn session_row(
        id: &str,
        name: Option<&str>,
        prompt: Option<&str>,
        state: SessionState,
    ) -> SessionRow {
        SessionRow {
            session_id: id.to_owned(),
            workspace_key: "ws".to_owned(),
            project_dir: "/proj".to_owned(),
            created_at: 0,
            last_used_at: 0,
            turn_count: 0,
            last_user_prompt: prompt.map(str::to_owned),
            state,
            card_id: Some("card-1".to_owned()),
            name: name.map(str::to_owned),
            name_user_set: false,
            tag: None,
        }
    }

    #[test]
    fn apply_session_rows_injects_fileless_live_sessions_and_retitles() {
        let mut snapshot = ChangesetSnapshot {
            workspace_key: "ws".to_owned(),
            branch: "main".to_owned(),
            ahead: 0,
            behind: 0,
            head_sha: String::new(),
            head_message: String::new(),
            changesets: vec![
                ChangesetEntry::Dash {
                    owner_id: "tugdash/demo".to_owned(),
                    display_name: "demo".to_owned(),
                    base: "main".to_owned(),
                    rounds: 1,
                    worktree: ".tug/worktrees/demo".to_owned(),
                    worktree_dirty: false,
                    files: Vec::new(),
                    draft: None,
                },
                ChangesetEntry::Session {
                    owner_id: "sess-writer".to_owned(),
                    display_name: "sess-wri".to_owned(),
                    live: false,
                    files: Vec::new(),
                    draft: None,
                },
            ],
            unattributed: Vec::new(),
        };

        let long_prompt = "word ".repeat(20); // 100 chars flat → truncates
        let rows = vec![
            session_row(
                "sess-writer",
                None,
                Some("fix   the\nparser bug"),
                SessionState::Live,
            ),
            session_row("sess-clean", Some("polish pass"), None, SessionState::Live),
            session_row("sess-long", None, Some(&long_prompt), SessionState::Live),
            session_row("sess-closed", None, None, SessionState::Closed),
        ];
        apply_session_rows(&mut snapshot, &rows);

        // Live rows all have entries (fileless when injected); the closed row
        // without files does not. Sessions sort by id ahead of the dash.
        let owners: Vec<&str> = snapshot
            .changesets
            .iter()
            .map(|e| match e {
                ChangesetEntry::Session { owner_id, .. } => owner_id.as_str(),
                ChangesetEntry::Dash { owner_id, .. } => owner_id.as_str(),
            })
            .collect();
        assert_eq!(
            owners,
            ["sess-clean", "sess-long", "sess-writer", "tugdash/demo"]
        );

        let ChangesetEntry::Session {
            display_name,
            live,
            files,
            ..
        } = &snapshot.changesets[0]
        else {
            panic!("expected session entry");
        };
        assert_eq!(display_name, "polish pass");
        assert!(live);
        assert!(files.is_empty());

        let ChangesetEntry::Session { display_name, .. } = &snapshot.changesets[1] else {
            panic!("expected session entry");
        };
        assert_eq!(display_name.chars().count(), 65, "64 chars + ellipsis");
        assert!(display_name.ends_with('…'));

        let ChangesetEntry::Session {
            display_name, live, ..
        } = &snapshot.changesets[2]
        else {
            panic!("expected session entry");
        };
        assert_eq!(display_name, "fix the parser bug");
        assert!(*live, "row state overrides the event-derived flag");
    }

    #[tokio::test]
    async fn run_changeset_commit_commits_exactly_the_listed_files() {
        let (_temp, repo) = init_repo();
        // Three dirty paths — one listed, one pre-staged into the index,
        // one untracked. The commit must take only the listed file and
        // leave everything else exactly as it was.
        std::fs::write(repo.join("a.txt"), "changed-a\n").unwrap();
        std::fs::write(repo.join("b.txt"), "b\n").unwrap();
        git(&repo, &["add", "b.txt"]);
        std::fs::write(repo.join("c.txt"), "c\n").unwrap();

        let receipt = run_changeset_commit(&repo, &["a.txt".to_string()], "commit a")
            .await
            .expect("commit succeeds");

        assert_eq!(receipt.sha.len(), 40, "full HEAD sha");
        let receipt_paths: Vec<&str> = receipt
            .numstat
            .lines()
            .filter_map(|l| l.split('\t').nth(2))
            .collect();
        assert_eq!(
            receipt_paths,
            ["a.txt"],
            "numstat lists only the listed file"
        );

        // b.txt stays staged-but-uncommitted; c.txt stays untracked.
        let status = git_stdout(&repo, &["status", "--porcelain"])
            .await
            .expect("status");
        assert!(
            status.contains("A  b.txt"),
            "pre-staged file untouched: {status}"
        );
        assert!(
            status.contains("?? c.txt"),
            "untracked file untouched: {status}"
        );
    }

    #[tokio::test]
    async fn run_changeset_commit_stages_untracked_selections() {
        let (_temp, repo) = init_repo();
        std::fs::write(repo.join("fresh.txt"), "fresh\n").unwrap();
        let receipt = run_changeset_commit(&repo, &["fresh.txt".to_string()], "add fresh")
            .await
            .expect("untracked selection commits");
        assert!(receipt.numstat.contains("fresh.txt"));
    }

    #[tokio::test]
    async fn run_changeset_commit_refuses_empty_list_and_blank_message() {
        let (_temp, repo) = init_repo();
        assert!(run_changeset_commit(&repo, &[], "msg").await.is_err());
        std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
        assert!(
            run_changeset_commit(&repo, &["a.txt".to_string()], "   ")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn run_changeset_commit_error_carries_git_stderr() {
        let (_temp, repo) = init_repo();
        let err = run_changeset_commit(&repo, &["no-such-file.txt".to_string()], "msg")
            .await
            .expect_err("missing pathspec fails");
        assert!(
            err.contains("no-such-file.txt"),
            "stderr detail names the bad path: {err}"
        );
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

    /// Two sessions open one project via two different spellings (real path and
    /// a symlink to it). The relay canonicalizes `project_dir` at write, so both
    /// land in one canonical `file_events` bucket and compose attributes both —
    /// closing the multi-spelling dedup gap.
    #[cfg(unix)]
    #[tokio::test]
    async fn two_spellings_one_project_attribute_to_one_bucket() {
        let (_dir, root) = init_repo();
        let link_home = tempfile::tempdir().unwrap();
        let link = link_home.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();

        std::fs::write(root.join("a.txt"), "x").unwrap();
        std::fs::write(root.join("b.txt"), "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess-a", "ws", &root.to_string_lossy(), "card-1", 0, None)
            .unwrap();
        ledger
            .record_spawn("sess-b", "ws", &link.to_string_lossy(), "card-2", 0, None)
            .unwrap();

        // Each session's write canonicalizes its own spelling; both resolve to
        // the same canonical bucket.
        let pd_a = CanonicalPath::from_raw(&root);
        let pd_b = CanonicalPath::from_raw(&link);
        assert_eq!(
            pd_a.as_str(),
            pd_b.as_str(),
            "both spellings canonicalize alike"
        );
        ledger
            .record_file_event(&event(
                "sess-a",
                "tu-1",
                &root.join("a.txt"),
                pd_a.as_path(),
            ))
            .unwrap();
        ledger
            .record_file_event(&event(
                "sess-b",
                "tu-2",
                &root.join("b.txt"),
                pd_b.as_path(),
            ))
            .unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        let owners: Vec<&str> = snapshot
            .changesets
            .iter()
            .filter_map(|e| match e {
                ChangesetEntry::Session { owner_id, .. } => Some(owner_id.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            owners.contains(&"sess-a"),
            "session A attributed: {owners:?}"
        );
        assert!(
            owners.contains(&"sess-b"),
            "session B (other spelling) attributed: {owners:?}"
        );
        assert!(
            snapshot.unattributed.is_empty(),
            "no file falls to unattributed: {:?}",
            snapshot.unattributed
        );
    }

    /// `sessions.project_dir` stays the raw typed path so the picker's
    /// `list_for_project_dir` (raw-path lookup) keeps working — only
    /// `file_events.project_dir` is canonicalized ([P05]).
    #[cfg(unix)]
    #[tokio::test]
    async fn sessions_project_dir_stays_raw() {
        let (_dir, root) = init_repo();
        let link_home = tempfile::tempdir().unwrap();
        let link = link_home.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        let raw = link.to_string_lossy().to_string();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess-a", "ws", &raw, "card-1", 0, None)
            .unwrap();

        let rows = ledger.list_for_project_dir(&raw).unwrap();
        assert_eq!(
            rows.len(),
            1,
            "picker finds the session by its raw typed path"
        );
        assert_eq!(
            rows[0].project_dir, raw,
            "sessions.project_dir stays the raw spelling"
        );
    }

    /// The `ee31685b` shape: a legacy absolute `file_path` under one spelling of
    /// a directory, `project_dir` under another (a symlink standing in for the
    /// `/u` firmlink). The reconciler bridge collapses both to the same
    /// repo-relative key, so the file is attributed — not Unattributed.
    #[cfg(unix)]
    #[tokio::test]
    async fn firmlink_split_row_is_attributed() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("lens-frame.md"), "edit").unwrap();
        let link_home = tempfile::tempdir().unwrap();
        let link = link_home.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &link.to_string_lossy(), "card-1", 0, None)
            .unwrap();
        // Legacy row: absolute file_path under the real path, project_dir the
        // symlink spelling — the two disagree, exactly the live bug.
        ledger
            .record_file_event(&event("sess", "tu-1", &root.join("lens-frame.md"), &link))
            .unwrap();

        // Compose against the symlink spelling (repo_root_for returns it verbatim).
        let snapshot = compose_snapshot(&link, Some(&ledger)).await.expect("repo");
        let owners: Vec<&str> = snapshot
            .changesets
            .iter()
            .filter_map(|e| match e {
                ChangesetEntry::Session {
                    owner_id, files, ..
                } if !files.is_empty() => Some(owner_id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(
            owners,
            ["sess"],
            "the split row is attributed to its session"
        );
        assert!(
            snapshot.unattributed.is_empty(),
            "nothing falls to unattributed: {:?}",
            snapshot.unattributed
        );
    }

    /// A deleted file has no inode, but both sides speak git's repo-relative
    /// language, so a new capture-time (repo-relative) row reconciles against
    /// git's `D` entry.
    #[cfg(unix)]
    #[tokio::test]
    async fn deleted_file_reconciles_repo_relative() {
        let (_dir, root) = init_repo();
        std::fs::remove_file(root.join("committed.txt")).unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        let pd = CanonicalPath::from_raw(&root);
        ledger
            .record_spawn("sess", "ws", pd.as_str(), "card-1", 0, None)
            .unwrap();
        // New capture-time form: repo-relative file_path, op deleted.
        let mut ev = event("sess", "tu-1", Path::new("committed.txt"), pd.as_path());
        ev.op = "deleted".to_owned();
        ledger.record_file_event(&ev).unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        let owned: Vec<&str> = snapshot
            .changesets
            .iter()
            .flat_map(|e| match e {
                ChangesetEntry::Session { files, .. } => {
                    files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>()
                }
                _ => Vec::new(),
            })
            .collect();
        assert_eq!(
            owned,
            ["committed.txt"],
            "the deleted file reconciles via its repo-relative key"
        );
        assert!(snapshot.unattributed.is_empty());
    }

    /// Unit coverage of the bridge decision table: relative passes through,
    /// absolute strips, and a firmlink-split (repo_root via a symlink) collapses
    /// through the gateway before the strip.
    #[cfg(unix)]
    #[test]
    fn bridge_passes_through_relative_and_strips_absolute() {
        assert_eq!(
            repo_relative(Path::new("/any/repo"), "roadmap/x.md"),
            "roadmap/x.md"
        );

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.txt"), "x").unwrap();
        assert_eq!(
            repo_relative(&root, root.join("a.txt").to_str().unwrap()),
            "a.txt"
        );

        let link_home = tempfile::tempdir().unwrap();
        let link = link_home.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert_eq!(
            repo_relative(&link, root.join("a.txt").to_str().unwrap()),
            "a.txt",
            "firmlink-split repo_root collapses through the gateway"
        );
    }

    /// A first compose converts a project's legacy absolute rows to canonical
    /// project_dir + repo-relative file_path; a second compose (marker set)
    /// does no further writes.
    #[cfg(unix)]
    #[tokio::test]
    async fn backfill_converts_absolute_rows_only_once() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("a.txt"), "x").unwrap();
        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &root.to_string_lossy(), "card", 0, None)
            .unwrap();
        // Legacy-shaped row: absolute file_path.
        ledger
            .record_file_event(&event("sess", "tu-1", &root.join("a.txt"), &root))
            .unwrap();

        compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        let rows = ledger.file_events_for_session("sess").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_path, "a.txt", "row converted to repo-relative");
        let canonical = CanonicalPath::from_raw(&root);
        assert_eq!(
            rows[0].project_dir,
            canonical.as_str(),
            "row project_dir canonicalized"
        );

        let before = ledger.file_events_for_session("sess").unwrap();
        compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        let after = ledger.file_events_for_session("sess").unwrap();
        assert_eq!(before, after, "second compose does no extra writes");
    }

    /// The backfill runs only for the project compose actually touches; a
    /// project never composed keeps its legacy rows (proving no boot walk).
    #[cfg(unix)]
    #[tokio::test]
    async fn backfill_never_touches_unopened_projects() {
        let (_dir_x, root_x) = init_repo();
        let (_dir_y, root_y) = init_repo();
        std::fs::write(root_y.join("y.txt"), "y").unwrap();
        let ledger = SessionLedger::open_in_memory().unwrap();
        // X has a legacy absolute row but is never composed.
        ledger
            .record_spawn("sess-x", "ws", &root_x.to_string_lossy(), "card-x", 0, None)
            .unwrap();
        ledger
            .record_file_event(&event("sess-x", "tu-x", &root_x.join("x.txt"), &root_x))
            .unwrap();
        let x_before = ledger.file_events_for_session("sess-x").unwrap();

        // Compose only Y.
        compose_snapshot(&root_y, Some(&ledger))
            .await
            .expect("repo");

        let x_after = ledger.file_events_for_session("sess-x").unwrap();
        assert_eq!(x_before, x_after, "unopened project X's rows are untouched");
        assert!(
            x_after[0].file_path.starts_with('/'),
            "X's row stays absolute — no boot walk"
        );
    }
}
