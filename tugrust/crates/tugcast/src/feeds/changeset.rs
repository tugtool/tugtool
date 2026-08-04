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
    ChangesetDraft, ChangesetEntry, ChangesetFile, ChangesetSnapshot, OrphanedFile,
    UnattributedFile,
};

use super::attribution::{parse_worktree_states, repo_root_for};
use super::git::{fetch_git_status, fetch_head_message, parse_porcelain_v2};
use super::workspace_registry::WorkspaceRegistry;
use crate::path_resolver::{CanonicalPath, same_file};
use crate::session_ledger::{
    FileEventKey, FileEventRewrite, ProjectFileEvent, SessionLedger, SessionRow, SessionState,
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

/// Whether a porcelain-v2 XY status is a structural op — a delete, rename, or
/// new-untracked file. These are the ops the sole-holder bracket promotion
/// claims: you don't hand-save a deletion, so a lone bracket sweep over one is
/// the session's own shell work. A plain content modify (`.M`/`M.`) is not
/// structural — that's the ambiguous case attribution stays conservative on.
fn status_is_structural(status: &str) -> bool {
    status == "??" || status.chars().any(|c| matches!(c, 'A' | 'D' | 'R'))
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
    // Loop-invariant across every row this compose resolves, and resolving it
    // takes the resolver's global memo lock — so it is resolved once, here.
    let canonical_root = CanonicalPath::from_raw(&repo_root);
    let status_output = fetch_git_status(&repo_root).await?;

    let header = parse_porcelain_v2(&status_output);
    let head_message = fetch_head_message(&repo_root).await;
    // One `rev-parse` replaces up to one `git log` per dirty path on every
    // recompute — see `live_cut_cache`.
    let head_oid = git_stdout(&repo_root, &["rev-parse", "HEAD"])
        .await
        .map(|out| out.trim().to_owned())
        .filter(|oid| !oid.is_empty());

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
    // oldest-first, so the latest event for a path wins op/origin (same rule
    // as `tugutil changes`). Events whose file is no longer dirty
    // (committed / reverted) drop out, and so do **spent** events — rows at
    // or before the last commit that touched their path (the row-liveness
    // rule, [D112]): a commit spends the rows it absorbs, so a fossil row
    // can never re-claim a file someone re-dirties later.
    // The `file_events` bucket key is canonical (the relay writes it through the
    // gateway), so query the canonical spelling of `project_dir`. Legacy rows
    // written before canonicalization carry the raw spelling; union them in
    // (when it differs) so pre-upgrade attribution still scopes in until the
    // backfill converts them.
    // A read error must never masquerade as "no events" — that renders as
    // "no session claims these" while the truth is "the ledger is
    // damaged". Note the error (latches the degraded tripwire on
    // corruption) and log it at warn.
    let read_events = |ledger: &crate::session_ledger::SessionLedger, project: &str| {
        ledger.file_events_for_project(project).unwrap_or_else(|err| {
            crate::ledger_integrity::health::note_error("changes", &err);
            tracing::warn!(project, error = %err, "file_events read failed; claims unavailable this cycle");
            Vec::new()
        })
    };
    let mut events = match ledger {
        Some(ledger) => {
            let raw = project_dir.to_string_lossy();
            let canonical = CanonicalPath::from_raw(project_dir);
            let mut events = read_events(ledger, canonical.as_str());
            if canonical.as_str() != raw {
                events.extend(read_events(ledger, &raw));
            }
            events
        }
        None => Vec::new(),
    };

    // Opportunistic lazy sweep of this project's absolute rows, once per project
    // per process: those that resolve into the repo are collapsed to canonical
    // project_dir + repo-relative file_path; those that resolve outside it are
    // deleted. An out-of-repo row can never match the fold below (which is keyed
    // on git's repo-relative dirty paths), so it is not a row this project has
    // any use for — it only costs a full resolution attempt every recompute.
    // Correctness never depends on the rewrite half — the bridge already
    // reconciles legacy rows at read time. The sweep runs only for open projects
    // (never a boot walk), preserving the no-TCC-prompt-on-boot property.
    if let Some(ledger) = ledger {
        let canonical = CanonicalPath::from_raw(project_dir);
        let swept = backfill_marker()
            .lock()
            .expect("backfill marker mutex")
            .contains(canonical.as_str());
        if !swept {
            let mut rewrites: Vec<FileEventRewrite> = Vec::new();
            let mut purges: Vec<FileEventKey> = Vec::new();
            for pfe in &events {
                if !pfe.event.file_path.starts_with('/') {
                    continue;
                }
                let rel = repo_relative(&canonical_root, &repo_root, &pfe.event.file_path);
                // Still absolute means both of `repo_relative`'s tests came back
                // negative: the canonicalized path is not under the canonical
                // root by prefix, AND no ancestor of it is the same live
                // directory as the root. A path that merely fails to
                // canonicalize (an in-repo file already deleted from disk) still
                // strips, so "unresolvable" is never read as "outside".
                if rel.starts_with('/') {
                    purges.push(FileEventKey {
                        tug_session_id: pfe.event.tug_session_id.clone(),
                        tool_use_id: pfe.event.tool_use_id.clone(),
                        file_path: pfe.event.file_path.clone(),
                    });
                } else {
                    rewrites.push(FileEventRewrite {
                        tug_session_id: pfe.event.tug_session_id.clone(),
                        tool_use_id: pfe.event.tool_use_id.clone(),
                        old_file_path: pfe.event.file_path.clone(),
                        new_file_path: rel,
                    });
                }
            }
            // Mark the project swept only once the writes land: a forwarded
            // write held for retry must not cost this process its one attempt.
            let mut settled = true;
            if !rewrites.is_empty() {
                settled &= ledger
                    .backfill_file_events_repo_relative(canonical.as_str(), &rewrites)
                    .is_ok();
            }
            if !purges.is_empty() {
                match ledger.purge_file_events_out_of_repo(canonical.as_str(), &purges) {
                    Ok(deleted) => tracing::debug!(
                        project = canonical.as_str(),
                        deleted,
                        "purged file_events rows naming files outside the repo"
                    ),
                    Err(err) => {
                        tracing::warn!(project = canonical.as_str(), error = %err, "out-of-repo purge failed; retrying next compose");
                        settled = false;
                    }
                }
                // Purged rows are gone from the ledger; drop them from this
                // compose too, so they don't cost one last resolution each.
                let dropped: HashSet<(&str, &str, &str)> = purges
                    .iter()
                    .map(|k| {
                        (
                            k.tug_session_id.as_str(),
                            k.tool_use_id.as_str(),
                            k.file_path.as_str(),
                        )
                    })
                    .collect();
                events.retain(|pfe| {
                    !dropped.contains(&(
                        pfe.event.tug_session_id.as_str(),
                        pfe.event.tool_use_id.as_str(),
                        pfe.event.file_path.as_str(),
                    ))
                });
            }
            if settled {
                backfill_marker()
                    .lock()
                    .expect("backfill marker mutex")
                    .insert(canonical.as_str().to_owned());
            }
        }
    }
    let mut owners: BTreeMap<String, OwnerAgg> = BTreeMap::new();
    // Per-path liveness cut, computed once per dirty path with events.
    let mut live_cuts: HashMap<String, i64> = HashMap::new();
    // Per repo-relative path, the owners with a live **proof** row
    // (`exact`/`replay` — the tool input named the file), the genuine authors
    // ([D112]). A `bash`/`turn` row is a whole-tree-delta *claim*
    // (contaminated by concurrent saves, build churn, and the user's own
    // hand-saves), so it never makes a session an owner.
    let mut proof_owners: HashMap<String, HashSet<String>> = HashMap::new();
    for pfe in &events {
        let rel = repo_relative(&canonical_root, &repo_root, &pfe.event.file_path);
        let Some(git_status) = dirty.get(&rel) else {
            continue;
        };
        let min_live = match live_cuts.get(&rel) {
            Some(cut) => *cut,
            None => {
                let cut =
                    cached_min_live_at_ms(&canonical_root, &repo_root, &rel, head_oid.as_deref())
                        .await;
                live_cuts.insert(rel.clone(), cut);
                cut
            }
        };
        if pfe.event.at < min_live {
            continue;
        }
        if super::attribution::origin_is_proof(&pfe.event.origin) {
            proof_owners
                .entry(rel.clone())
                .or_default()
                .insert(pfe.event.tug_session_id.clone());
        }
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
                shared: false,
                last_touched: pfe.event.at,
            });
        // Provenance display follows proof rows: a later bracket sweep never
        // overwrites the op/origin a proof row established.
        if super::attribution::origin_is_proof(&pfe.event.origin)
            || !super::attribution::origin_is_proof(&file.origin)
        {
            file.op = pfe.event.op.clone();
            file.origin = pfe.event.origin.clone();
        }
        file.last_touched = file.last_touched.max(pfe.event.at);
    }

    // Resolve ownership per path with **proof** rows the leading evidence
    // ([D112]) — correlation never decides on its own, with one promotion:
    //
    // - Some session proof-owns the path → strip it from every owner that
    //   only bracket-grabbed it (their contamination); mark `shared` iff more
    //   than one session proof-owns it (genuine same-file contention).
    // - No proof owner, one bracket holder, structural op → promote it. A
    //   delete / rename / new-untracked file is the session's own shell work
    //   (`git rm`, `mv`, a heredoc `>`), never an incidental editor hand-save
    //   caught in the window — you don't hand-save a deletion. The sole
    //   holder claims it.
    // - No proof owner, otherwise → strip the path from every bracket holder:
    //   the same delta that sweeps up another session's save sweeps up the
    //   user's own hand-save during the command, and the user's editor has no
    //   session to claim it back. A plain content modify is exactly that
    //   ambiguous case; the path falls to `unattributed` below.
    let all_paths: HashSet<String> = owners
        .values()
        .flat_map(|agg| agg.files.keys().cloned())
        .collect();
    // Bracket hints ([P13]): the correlation-only holders stripped below are
    // recorded per path instead of dropped silently — they surface on the
    // unattributed rows as `hinted_by` provenance (a hint for the
    // disposition decision, never an attribution).
    let mut bracket_hints: HashMap<String, Vec<String>> = HashMap::new();
    for path in &all_paths {
        let proof_ids = proof_owners.get(path);
        let holders: Vec<String> = owners
            .iter()
            .filter(|(_, agg)| agg.files.contains_key(path))
            .map(|(id, _)| id.clone())
            .collect();
        // Sole-holder structural promotion: keep the file on its one bracket
        // holder rather than stripping it to unattributed.
        let promoted_holder: Option<&String> = (proof_ids.is_none()
            && holders.len() == 1
            && owners
                .get(&holders[0])
                .and_then(|agg| agg.files.get(path))
                .is_some_and(|f| status_is_structural(&f.git_status)))
        .then(|| &holders[0]);
        for id in &holders {
            if promoted_holder == Some(id) {
                continue;
            }
            if !proof_ids.is_some_and(|ids| ids.contains(id)) {
                if let Some(agg) = owners.get_mut(id) {
                    if agg.files.remove(path).is_some() {
                        bracket_hints
                            .entry(path.clone())
                            .or_default()
                            .push(id.clone());
                    }
                }
            }
        }
        if let Some(proof_ids) = proof_ids {
            if proof_ids.len() > 1 {
                for id in proof_ids {
                    if let Some(file) = owners.get_mut(id).and_then(|agg| agg.files.get_mut(path)) {
                        file.shared = true;
                    }
                }
            }
        }
    }
    // Orphan lift ([D120]): a file owned only by non-live ("dead") sessions is
    // invisible — a closed session keeps its proof rows, but no live card
    // surfaces another session's entry. Lift such files into the `orphaned`
    // bucket so a live session can reclaim them. A file any live session
    // proof-owns stays in that live entry (it is not orphaned), so a file
    // qualifies only when EVERY owner holding it is dead.
    let live_paths: HashSet<String> = owners
        .values()
        .filter(|agg| agg.live)
        .flat_map(|agg| agg.files.keys().cloned())
        .collect();
    // Keyed by path so two dead co-owners of one file yield a single orphan
    // (the most-recently-touched owner wins the provenance).
    let mut orphaned_by_path: BTreeMap<String, OrphanedFile> = BTreeMap::new();
    for (owner_id, agg) in owners.iter_mut() {
        if agg.live {
            continue;
        }
        let orphan_paths: Vec<String> = agg
            .files
            .keys()
            .filter(|path| !live_paths.contains(*path))
            .cloned()
            .collect();
        for path in orphan_paths {
            let Some(file) = agg.files.remove(&path) else {
                continue;
            };
            let candidate = OrphanedFile {
                path: file.path,
                git_status: file.git_status,
                op: file.op,
                origin: file.origin,
                prior_owner_name: agg.display_name.clone(),
                prior_owner_id: owner_id.clone(),
                last_touched: file.last_touched,
            };
            orphaned_by_path
                .entry(path)
                .and_modify(|existing| {
                    if candidate.last_touched > existing.last_touched {
                        *existing = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
    }
    let orphaned: Vec<OrphanedFile> = orphaned_by_path.into_values().collect();

    // An owner left with no files (its only claims were stripped bracket
    // grabs, or all its files were lifted to `orphaned`) drops out here;
    // fileless live sessions are re-injected by `apply_session_rows`, so the
    // card still lists every open session.
    owners.retain(|_, agg| !agg.files.is_empty());

    // Orphaned paths are owned (by a dead session), just lifted out of their
    // owner's entry above — so they must NOT also fall into `unattributed`.
    let orphaned_paths: HashSet<&str> = orphaned.iter().map(|f| f.path.as_str()).collect();

    // Unattributed: dirty files no owner claims (and not an orphan), each
    // carrying the bracket holders that saw it change ([P13]).
    let unattributed: Vec<UnattributedFile> = dirty
        .iter()
        .filter(|(path, _)| {
            !owners.values().any(|agg| agg.files.contains_key(*path))
                && !orphaned_paths.contains(path.as_str())
        })
        .map(|(path, git_status)| {
            let mut hinted_by = bracket_hints.get(path).cloned().unwrap_or_default();
            hinted_by.sort();
            hinted_by.dedup();
            UnattributedFile {
                path: path.clone(),
                git_status: git_status.clone(),
                hinted_by,
            }
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
        // Spec S05 spelling contract: writers store `project_dir` canonical;
        // query the canonical spelling and union the raw one when it differs
        // (the same legacy-tolerant pattern as the file_events read above),
        // so a draft written under either spelling still attaches.
        let drafts = {
            let raw = project_dir.to_string_lossy();
            let canonical = CanonicalPath::from_raw(project_dir);
            let mut drafts = ledger
                .changeset_drafts_for_project(canonical.as_str())
                .unwrap_or_default();
            if canonical.as_str() != raw {
                drafts.extend(
                    ledger
                        .changeset_drafts_for_project(&raw)
                        .unwrap_or_default(),
                );
            }
            drafts
        };
        // First writer wins in the map, so a canonical-spelling row
        // shadows any raw-spelling duplicate on the same owner key.
        let mut by_owner: HashMap<(&str, &str), &crate::session_ledger::ChangesetDraftRow> =
            HashMap::new();
        for d in &drafts {
            by_owner
                .entry((d.owner_kind.as_str(), d.owner_id.as_str()))
                .or_insert(d);
        }
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

    Some(ChangesetSnapshot {
        workspace_key: String::new(),
        branch: header.branch,
        ahead: header.ahead,
        behind: header.behind,
        head_sha: header.head_sha,
        head_message,
        changesets,
        unattributed,
        orphaned,
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
        edited: row.edited,
        // The selection projects opaquely — every key the client wrote comes
        // back, including ones no Rust type names. A selection that fails to
        // parse (hand-mangled row) reads as no overrides rather than
        // poisoning the snapshot.
        selection: row
            .selection
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
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
///
/// The canonical root is passed in rather than derived: it is the same for
/// every row of a compose, and resolving it takes a global memo lock.
fn repo_relative(canonical_root: &CanonicalPath, repo_root: &Path, file_path: &str) -> String {
    // New capture-time rows are already repo-relative.
    if !file_path.starts_with('/') {
        return file_path.to_owned();
    }

    // Legacy absolute row: canonicalize both sides, then strip. The firmlink
    // split (repo_root and file_path spelled differently) collapses here.
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

/// Liveness cuts that survive between composes, keyed `(canonical_root, rel)`
/// → `(head_oid, cut_ms)`. The cut is derived from the last commit that touched
/// the path, so it can only change when a commit lands — which moves HEAD.
/// Holding the oid alongside the value makes that the invalidation: any commit,
/// merge, or reset mismatches and re-derives. Between commits an editing
/// session recomputes far more often than it commits, and every one of those
/// recomputes was re-running `git log` per dirty path.
///
/// Growth is one entry per path *ever* dirtied in this process's lifetime —
/// bounded in practice by the repo's file count.
type LiveCutCache = Mutex<HashMap<(String, String), (String, i64)>>;

fn live_cut_cache() -> &'static LiveCutCache {
    static CACHE: OnceLock<LiveCutCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The liveness cut for `rel`, through [`live_cut_cache`] when `head_oid` is
/// known. `None` (an unborn or unreadable HEAD) bypasses the cache entirely —
/// never wrong, just uncached.
async fn cached_min_live_at_ms(
    canonical_root: &CanonicalPath,
    repo_root: &Path,
    rel: &str,
    head_oid: Option<&str>,
) -> i64 {
    let Some(head_oid) = head_oid else {
        return min_live_at_ms(repo_root, rel).await;
    };
    let key = (canonical_root.as_str().to_owned(), rel.to_owned());
    if let Some((oid, cut)) = live_cut_cache().lock().expect("live cut cache").get(&key)
        && oid == head_oid
    {
        return *cut;
    }
    let cut = min_live_at_ms(repo_root, rel).await;
    live_cut_cache()
        .lock()
        .expect("live cut cache")
        .insert(key, (head_oid.to_owned(), cut));
    cut
}

/// The row-liveness cut for `rel` (epoch ms): a ledger row is live iff
/// `at >= min_live_at_ms`. Derived from the last commit that touched the path
/// (`git log -1 --format=%ct -- <rel>`), the whole commit second treated as
/// spent so ties break toward spent (the file degrades to unattributed —
/// visible, never falsely claimed). A path with no commit history (a
/// new/untracked file) returns 0: nothing was ever absorbed, every row is
/// live. Mirrors tugchanges-core's rule of the same name ([D112]).
async fn min_live_at_ms(repo_root: &Path, rel: &str) -> i64 {
    match git_stdout(repo_root, &["log", "-1", "--format=%ct", "--", rel]).await {
        Some(out) => match out.trim().parse::<i64>() {
            Ok(commit_secs) => (commit_secs + 1) * 1000,
            Err(_) => 0,
        },
        None => 0,
    }
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

        // Round subjects, newest first — what the release discard
        // preflight lists ([P14]). Empty when the dash has no rounds.
        let round_subjects = if rounds > 0 {
            git_stdout(
                repo_root,
                &["log", "--format=%s", &format!("{base}..{branch}")],
            )
            .await
            .map(|out| {
                out.lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
        } else {
            Vec::new()
        };

        entries.push(ChangesetEntry::Dash {
            owner_id: branch.to_owned(),
            display_name: name.to_owned(),
            base,
            rounds,
            worktree: worktree_rel,
            worktree_dirty,
            files,
            round_subjects,
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
            shared: false,
            last_touched: 0,
        });
    }
    files
}

/// Commit exactly `files` (repo-relative) in `repo_dir` with `message`
/// ([P15]), routed through `tugchanges_core::commit` ([P06]).
///
/// The staging-by-construction contract is unchanged — `tugchanges_core::commit`
/// with an explicit `--paths` set runs `git add -- <files…>` then
/// `git commit -m <message> -- <files…>`, committing **only** those paths and
/// refusing an empty list / blank message with the same error strings. The
/// sync library is driven off the async feed via `spawn_blocking`, the same
/// pattern tugcast uses for `tugdash-core` ([P02]).
///
/// Returns the structured [`tugchanges_core::CommitReceipt`]; the card path takes
/// `.sha` and the raw `.numstat` for the wire frame it already scrapes ([Q01]).
pub(crate) async fn run_changeset_commit(
    repo_dir: &Path,
    files: &[String],
    message: &str,
    hunks: Option<std::collections::BTreeMap<String, Vec<String>>>,
) -> Result<tugchanges_core::CommitReceipt, String> {
    let project = repo_dir.to_path_buf();
    let files = files.to_vec();
    let message = message.to_string();
    tokio::task::spawn_blocking(move || {
        // Explicit `--paths` bypasses bucketing, so this can never hit the
        // [P03] refusal; map any `CommitError` back to the card's `String` error.
        tugchanges_core::commit(tugchanges_core::CommitOptions {
            session: None,
            project: Some(project),
            message,
            paths: Some(files),
            hunks,
            ..Default::default()
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("commit task panicked: {e}"))?
}

/// The standard post-commit summary (Spec S02), formatted server-side so the
/// live ink row and the row restored from the shell ledger are byte-identical.
///
/// ```text
/// committed <sha[0..10]> · <N> file(s) · +<added> −<removed>
/// files: [{"path":"…","status":"modified","added":16,"removed":1}, …]
/// <full message>
/// ```
///
/// Line 0 is the fixed machine header; line 1 is a `files:` line carrying the
/// committed files' per-file stats as compact JSON (the receipt's expandable
/// freeze-dried file list); the whole commit message follows verbatim, so the
/// receipt can show up to three of its lines. `<N>` / `added` / `removed` are
/// derived from the same file set (a binary file's absent count is 0).
pub(crate) fn format_commit_summary(
    sha: &str,
    message: &str,
    files: &[tugchanges_core::FileStat],
) -> String {
    let short = &sha[..sha.len().min(10)];
    let message = message.trim();
    let count = files.len();
    let added: u64 = files.iter().map(|f| f.added.unwrap_or(0) as u64).sum();
    let removed: u64 = files.iter().map(|f| f.deleted.unwrap_or(0) as u64).sum();
    // A local Serialize struct fixes the key order (declaration order) so the
    // durable string is stable and readable; `serde_json::json!` would sort the
    // keys alphabetically.
    #[derive(serde::Serialize)]
    struct ReceiptFile<'a> {
        path: &'a str,
        status: &'a str,
        added: u32,
        removed: u32,
    }
    let entries: Vec<ReceiptFile> = files
        .iter()
        .map(|f| ReceiptFile {
            path: &f.path,
            status: &f.status,
            added: f.added.unwrap_or(0),
            removed: f.deleted.unwrap_or(0),
        })
        .collect();
    let files_json = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string());
    format!(
        "committed {short} · {count} file(s) · +{added} −{removed}\nfiles: {files_json}\n{message}"
    )
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
    async fn compose_partitions_owned_shared_and_unattributed() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("owned.txt"), "x").unwrap();
        std::fs::write(root.join("both.txt"), "x").unwrap();
        std::fs::write(root.join("hand-edit.txt"), "x").unwrap();
        // tainted.txt is tracked and then content-modified: a plain modify is
        // the ambiguous op the sole-holder promotion must NOT claim (the same
        // delta could be the user's hand-save of a tracked file). Structural
        // ops are covered by `compose_promotes_sole_holder_structural_op`.
        std::fs::write(root.join("tainted.txt"), "base\n").unwrap();
        git(&root, &["add", "tainted.txt"]);
        git(&root, &["commit", "-q", "--amend", "--no-edit"]);
        std::fs::write(root.join("tainted.txt"), "modified\n").unwrap();

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
        // A bracket-only claim (also poisoned with the legacy ambiguous=1
        // column, which is ignored outright): correlation never decides, so
        // the file falls to `unattributed` — never auto-claimed by the
        // bracket's own session.
        let mut tainted = event("sess-alpha", "tu-4", &root.join("tainted.txt"), &root);
        tainted.origin = "bash".to_owned();
        tainted.ambiguous = true;
        // tainted.txt is tracked, so its event must post-date the base commit
        // to stay live (the row-liveness cut is the last commit time).
        tainted.at = 9_000_000_000_000;
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
        assert_eq!(
            paths,
            ["both.txt", "owned.txt"],
            "a bracket-only claim never attributes — tainted.txt is not alpha's"
        );
        assert!(files[0].shared, "both.txt has two owners");
        assert!(!files[1].shared);
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
        assert_eq!(unattributed, ["hand-edit.txt", "tainted.txt"]);

        // Bracket hints ([P13]): the stripped correlation-only holder is
        // recorded as `hinted_by` on the bracket-swept path; a plain hand
        // edit no bracket saw carries none.
        let hand_edit = &snapshot.unattributed[0];
        assert!(
            hand_edit.hinted_by.is_empty(),
            "no bracket saw hand-edit.txt"
        );
        let tainted = &snapshot.unattributed[1];
        assert_eq!(
            tainted.hinted_by,
            vec!["sess-alpha".to_string()],
            "the bracket holder surfaces as a hint, never an attribution"
        );
    }

    #[tokio::test]
    async fn compose_lifts_dead_only_owned_files_into_orphaned() {
        // A file proof-owned solely by a closed session is an orphan ([D120]):
        // the closed session keeps its rows, but no live card surfaces another
        // session's entry, so it must lift into the `orphaned` bucket. A file a
        // live session co-owns is NOT orphaned — it stays in the live entry.
        let (_dir, root) = init_repo();
        std::fs::write(root.join("orphan.txt"), "x").unwrap();
        std::fs::write(root.join("shared.txt"), "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        for s in ["sess-dead", "sess-live"] {
            ledger
                .record_spawn(s, "ws", &root.to_string_lossy(), "card", 0, None)
                .unwrap();
        }
        ledger.rename("sess-dead", Some("ghost work")).unwrap();
        // sess-dead proof-owns both files; sess-live proof-owns only shared.txt.
        ledger
            .record_file_event(&event("sess-dead", "tu-1", &root.join("orphan.txt"), &root))
            .unwrap();
        ledger
            .record_file_event(&event("sess-dead", "tu-2", &root.join("shared.txt"), &root))
            .unwrap();
        ledger
            .record_file_event(&event("sess-live", "tu-3", &root.join("shared.txt"), &root))
            .unwrap();
        // Close sess-dead → non-live. sess-live stays live.
        ledger.mark_closed("sess-dead").unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");

        // orphan.txt lifts out (dead's only exclusive file); shared.txt stays
        // owned (a live session holds it), so it is NOT orphaned.
        let orphaned: Vec<&str> = snapshot.orphaned.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(orphaned, ["orphan.txt"], "dead-only file is an orphan");
        assert_eq!(snapshot.orphaned[0].prior_owner_id, "sess-dead");
        assert_eq!(snapshot.orphaned[0].prior_owner_name, "ghost work");
        assert_eq!(snapshot.orphaned[0].origin, "exact");

        // sess-dead has no surviving entry (its only exclusive file was lifted;
        // shared.txt stays but under the live owner too — dead keeps its shared
        // copy). The live session keeps shared.txt.
        let live_entry = snapshot.changesets.iter().find_map(|e| match e {
            ChangesetEntry::Session {
                owner_id, files, ..
            } if owner_id == "sess-live" => Some(files),
            _ => None,
        });
        let live_files: Vec<&str> = live_entry
            .expect("live session entry")
            .iter()
            .map(|f| f.path.as_str())
            .collect();
        assert!(live_files.contains(&"shared.txt"));
        // orphan.txt is not in the unattributed bucket — it is owned, just dead.
        assert!(
            !snapshot.unattributed.iter().any(|f| f.path == "orphan.txt"),
            "an orphan is owned (by a dead session), never unattributed"
        );
    }

    #[tokio::test]
    async fn compose_promotes_sole_holder_structural_op() {
        // The screenshot case: the session's shell deleted a tracked file
        // (`git rm` / `rm`), so only a bracket saw it — no Edit/Write proof
        // row. A delete has no editor hand-save story, so a sole bracket
        // holder claims it. A structural op with two bracket holders stays
        // ambiguous.
        let (_dir, root) = init_repo();
        // committed.txt exists in base; delete it → worktree delete (`.D`).
        std::fs::remove_file(root.join("committed.txt")).unwrap();
        // contested.txt: a new untracked file two sessions' brackets both saw
        // — the sole-holder guard keeps it unattributed.
        std::fs::write(root.join("contested.txt"), "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        for s in ["sess-alpha", "sess-beta"] {
            ledger
                .record_spawn(s, "ws", &root.to_string_lossy(), "card", 0, None)
                .unwrap();
        }
        ledger.rename("sess-alpha", Some("alpha work")).unwrap();

        let mut del = event("sess-alpha", "tu-del", &root.join("committed.txt"), &root);
        del.origin = "bash".to_owned();
        del.op = "deleted".to_owned();
        // committed.txt is tracked; its event must post-date the base commit
        // to stay live (the row-liveness cut is the last commit time).
        del.at = 9_000_000_000_000;
        ledger.record_file_event(&del).unwrap();
        for (s, tu) in [("sess-alpha", "tu-c1"), ("sess-beta", "tu-c2")] {
            let mut grab = event(s, tu, &root.join("contested.txt"), &root);
            grab.origin = "bash".to_owned();
            ledger.record_file_event(&grab).unwrap();
        }

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");

        // committed.txt is claimed by its sole bracket holder.
        let alpha = snapshot
            .changesets
            .iter()
            .find_map(|e| match e {
                ChangesetEntry::Session {
                    owner_id, files, ..
                } if owner_id == "sess-alpha" => Some(files),
                _ => None,
            })
            .expect("sess-alpha entry");
        let alpha_paths: Vec<&str> = alpha.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            alpha_paths,
            ["committed.txt"],
            "a sole-holder delete is promoted to attribution"
        );
        assert!(alpha[0].git_status.contains('D'));

        // contested.txt has two bracket holders — still ambiguous.
        let unattributed: Vec<&str> = snapshot
            .unattributed
            .iter()
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(
            unattributed,
            ["contested.txt"],
            "a structural op with two holders stays unattributed"
        );
    }

    #[tokio::test]
    async fn compose_bracket_grab_does_not_steal_or_share_an_exact_owners_file() {
        // The pinned regression (meek-sheep), in the card's compose: sess-a
        // exact-edited a.txt; sess-b's Bash/turn bracket swept it up (a
        // contaminated whole-tree delta). The file must appear under sess-a
        // alone, NOT shared, and must not appear under sess-b at all.
        let (_dir, root) = init_repo();
        std::fs::write(root.join("a.txt"), "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        for s in ["sess-a", "sess-b"] {
            ledger
                .record_spawn(s, "ws", &root.to_string_lossy(), "card", 0, None)
                .unwrap();
        }
        // sess-a: the real exact edit. sess-b: a bracket grab of the same file.
        ledger
            .record_file_event(&event("sess-a", "tu-a", &root.join("a.txt"), &root))
            .unwrap();
        let mut grab = event("sess-b", "tu-b", &root.join("a.txt"), &root);
        grab.origin = "bash".to_owned();
        ledger.record_file_event(&grab).unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        let sessions: Vec<(&str, Vec<&str>, bool)> = snapshot
            .changesets
            .iter()
            .filter_map(|e| match e {
                ChangesetEntry::Session {
                    owner_id, files, ..
                } => Some((
                    owner_id.as_str(),
                    files.iter().map(|f| f.path.as_str()).collect(),
                    files.iter().any(|f| f.shared),
                )),
                _ => None,
            })
            .collect();
        // Exactly one session owns a.txt — sess-a — and it is not shared.
        let a = sessions
            .iter()
            .find(|(id, _, _)| *id == "sess-a")
            .expect("sess-a present");
        assert_eq!(a.1, ["a.txt"]);
        assert!(
            !a.2,
            "sess-a's file is not shared by a foreign bracket grab"
        );
        assert!(
            !sessions
                .iter()
                .any(|(id, files, _)| *id == "sess-b" && !files.is_empty()),
            "sess-b's bracket grab does not claim a.txt: {sessions:?}"
        );
        assert!(
            snapshot.unattributed.is_empty(),
            "a.txt is owned, not unattributed: {:?}",
            snapshot.unattributed
        );
    }

    #[tokio::test]
    async fn compose_spent_rows_never_reclaim_a_redirtied_file() {
        // Row liveness ([D112]): a session's row for committed.txt predates the
        // repo's commit (at = 1, epoch ~0), the commit absorbed that work, and
        // now someone re-dirties the file. The fossil row must not resurrect a
        // session entry — the file surfaces as unattributed, visible.
        let (_dir, root) = init_repo();
        std::fs::write(root.join("committed.txt"), "re-dirtied\n").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &root.to_string_lossy(), "card-1", 0, None)
            .unwrap();
        let mut ev = event("sess", "tu-1", &root.join("committed.txt"), &root);
        ev.at = 1;
        ledger.record_file_event(&ev).unwrap();

        let snapshot = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        assert!(
            snapshot
                .changesets
                .iter()
                .all(|e| !matches!(e, ChangesetEntry::Session { files, .. } if !files.is_empty())),
            "no session entry claims the re-dirtied file"
        );
        let unattributed: Vec<&str> = snapshot
            .unattributed
            .iter()
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(unattributed, ["committed.txt"]);
    }

    /// The liveness cut survives between composes keyed by HEAD, so a commit
    /// landing between them must re-derive it: the row that was live before
    /// the commit is spent after it, and the file falls to unattributed. A
    /// cache that outlived the commit would keep claiming the file.
    #[tokio::test]
    async fn a_commit_between_composes_invalidates_the_cached_liveness_cut() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("committed.txt"), "edited\n").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &root.to_string_lossy(), "card-1", 0, None)
            .unwrap();
        let mut ev = event("sess", "tu-1", &root.join("committed.txt"), &root);
        // Past the fixture commit's cut, which rounds up to the next second.
        ev.at = crate::session_ledger::now_millis() + 2_000;
        ledger.record_file_event(&ev).unwrap();

        let owned = |snapshot: &ChangesetSnapshot| {
            snapshot
                .changesets
                .iter()
                .any(|e| matches!(e, ChangesetEntry::Session { files, .. } if !files.is_empty()))
        };

        let first = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        assert!(owned(&first), "the row postdates the fixture's commit");

        // The commit absorbs that work; re-dirtying the file must not let the
        // now-fossil row reclaim it. The cut rounds up to the next whole
        // second, so the commit has to land past the row's stamp.
        tokio::time::sleep(std::time::Duration::from_millis(2_100)).await;
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "absorb the edit"]);
        std::fs::write(root.join("committed.txt"), "re-dirtied\n").unwrap();

        let second = compose_snapshot(&root, Some(&ledger)).await.expect("repo");
        assert!(!owned(&second), "the commit spent the row");
        assert_eq!(
            second
                .unattributed
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            ["committed.txt"]
        );
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
                    round_subjects: Vec::new(),
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
            orphaned: Vec::new(),
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

        let receipt = run_changeset_commit(&repo, &["a.txt".to_string()], "commit a", None)
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
        let receipt = run_changeset_commit(&repo, &["fresh.txt".to_string()], "add fresh", None)
            .await
            .expect("untracked selection commits");
        assert!(receipt.numstat.contains("fresh.txt"));
    }

    #[tokio::test]
    async fn run_changeset_commit_lands_a_session_trailer() {
        let (_temp, repo) = init_repo();
        std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
        // The deck path enriches the message with a Tug-Session trailer before
        // committing (do_changeset_commit → append_trailers). Mirror that here.
        let message =
            tugchanges_core::append_trailers("commit a", &[("Tug-Session", "web (sess-1)")]);
        run_changeset_commit(&repo, &["a.txt".to_string()], &message, None)
            .await
            .expect("commit succeeds");
        let trailer = git_stdout(
            &repo,
            &[
                "log",
                "-1",
                "--format=%(trailers:key=Tug-Session,valueonly)",
            ],
        )
        .await
        .expect("git log reads the trailer");
        assert_eq!(trailer.trim(), "web (sess-1)");
        // A second append over the already-trailered message is a no-op.
        assert_eq!(
            tugchanges_core::append_trailers(&message, &[("Tug-Session", "web (sess-1)")]),
            message
        );
    }

    #[tokio::test]
    async fn run_changeset_commit_refuses_empty_list_and_blank_message() {
        let (_temp, repo) = init_repo();
        assert!(run_changeset_commit(&repo, &[], "msg", None).await.is_err());
        std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
        assert!(
            run_changeset_commit(&repo, &["a.txt".to_string()], "   ", None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn run_changeset_commit_forwards_a_hunk_election() {
        let (_temp, repo) = init_repo();
        let original: String = (1..=60).map(|n| format!("line{n}\n")).collect();
        std::fs::write(repo.join("f.txt"), &original).unwrap();
        git(&repo, &["add", "f.txt"]);
        git(&repo, &["commit", "-q", "-m", "seed"]);
        let edited = original
            .replace("line2\n", "line2\nINSERTED-A\n")
            .replace("line30\n", "CHANGED-B\n");
        std::fs::write(repo.join("f.txt"), &edited).unwrap();

        let diff = git_stdout(
            &repo,
            &["diff", "--no-color", "--no-ext-diff", "--", "f.txt"],
        )
        .await
        .expect("diff");
        let ids: Vec<String> = tugchanges_core::parse_hunks(&diff)
            .into_iter()
            .map(|h| h.id)
            .collect();
        assert_eq!(ids.len(), 2, "diff was: {diff}");

        let mut election = std::collections::BTreeMap::new();
        election.insert("f.txt".to_string(), vec![ids[1].clone()]);
        run_changeset_commit(
            &repo,
            &["f.txt".to_string()],
            "land the second hunk",
            Some(election),
        )
        .await
        .expect("partial commit succeeds");

        let shown = git_stdout(&repo, &["show", "--no-color", "HEAD"])
            .await
            .expect("show");
        assert!(shown.contains("+CHANGED-B"), "commit was: {shown}");
        assert!(!shown.contains("INSERTED-A"), "commit was: {shown}");
    }

    #[tokio::test]
    async fn run_changeset_commit_error_carries_git_stderr() {
        let (_temp, repo) = init_repo();
        let err = run_changeset_commit(&repo, &["no-such-file.txt".to_string()], "msg", None)
            .await
            .expect_err("missing pathspec fails");
        assert!(
            err.contains("no-such-file.txt"),
            "stderr detail names the bad path: {err}"
        );
    }

    fn file_stat(
        path: &str,
        status: &str,
        added: Option<u32>,
        deleted: Option<u32>,
    ) -> tugchanges_core::FileStat {
        tugchanges_core::FileStat {
            path: path.to_string(),
            status: status.to_string(),
            added,
            deleted,
        }
    }

    #[test]
    fn format_commit_summary_single_file() {
        let s = format_commit_summary(
            "0123456789abcdef",
            "Fix the thing",
            &[file_stat("src/a.rs", "modified", Some(3), Some(1))],
        );
        assert_eq!(
            s,
            "committed 0123456789 · 1 file(s) · +3 −1\n\
             files: [{\"path\":\"src/a.rs\",\"status\":\"modified\",\"added\":3,\"removed\":1}]\n\
             Fix the thing"
        );
    }

    #[test]
    fn format_commit_summary_keeps_the_full_multi_line_message() {
        let s = format_commit_summary(
            "abcdef0123456789",
            "Subject line\n\nA longer body paragraph.",
            &[
                file_stat("src/a.rs", "modified", Some(10), Some(2)),
                file_stat("src/b.rs", "created", Some(4), Some(0)),
            ],
        );
        assert_eq!(
            s,
            "committed abcdef0123 · 2 file(s) · +14 −2\n\
             files: [{\"path\":\"src/a.rs\",\"status\":\"modified\",\"added\":10,\"removed\":2},\
             {\"path\":\"src/b.rs\",\"status\":\"created\",\"added\":4,\"removed\":0}]\n\
             Subject line\n\nA longer body paragraph."
        );
    }

    #[test]
    fn format_commit_summary_counts_binary_absent_columns_as_zero() {
        // A binary file reports no ± counts (`None`); it counts toward the file
        // total but adds 0 to the ± sums and serializes as 0.
        let s = format_commit_summary(
            "ffffffffffffffff",
            "Add an image",
            &[
                file_stat("assets/logo.png", "created", None, None),
                file_stat("src/a.rs", "modified", Some(5), Some(3)),
            ],
        );
        assert_eq!(
            s,
            "committed ffffffffff · 2 file(s) · +5 −3\n\
             files: [{\"path\":\"assets/logo.png\",\"status\":\"created\",\"added\":0,\"removed\":0},\
             {\"path\":\"src/a.rs\",\"status\":\"modified\",\"added\":5,\"removed\":3}]\n\
             Add an image"
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
        // New capture-time form: repo-relative file_path, op deleted. The
        // deletion postdates the repo's init commit, so the row is live.
        let mut ev = event("sess", "tu-1", Path::new("committed.txt"), pd.as_path());
        ev.op = "deleted".to_owned();
        ev.at = crate::session_ledger::now_millis() + 2_000;
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
        let any = Path::new("/any/repo");
        assert_eq!(
            repo_relative(&CanonicalPath::from_raw(any), any, "roadmap/x.md"),
            "roadmap/x.md"
        );

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.txt"), "x").unwrap();
        assert_eq!(
            repo_relative(
                &CanonicalPath::from_raw(&root),
                &root,
                root.join("a.txt").to_str().unwrap()
            ),
            "a.txt"
        );

        let link_home = tempfile::tempdir().unwrap();
        let link = link_home.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert_eq!(
            repo_relative(
                &CanonicalPath::from_raw(&link),
                &link,
                root.join("a.txt").to_str().unwrap()
            ),
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

    /// A first compose deletes the rows naming files outside the repo and
    /// converts the ones naming files inside it, leaving `file_events` holding
    /// only paths a changeset can show.
    #[cfg(unix)]
    #[tokio::test]
    async fn sweep_purges_out_of_repo_rows_and_keeps_in_repo_ones() {
        let (_dir, root) = init_repo();
        std::fs::write(root.join("a.txt"), "x").unwrap();
        let away = tempfile::tempdir().unwrap();
        let away_file = away.path().canonicalize().unwrap().join("note.md");
        std::fs::write(&away_file, "x").unwrap();

        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &root.to_string_lossy(), "card", 0, None)
            .unwrap();
        ledger
            .record_file_event(&event("sess", "tu-1", &root.join("a.txt"), &root))
            .unwrap();
        ledger
            .record_file_event(&event("sess", "tu-2", &away_file, &root))
            .unwrap();

        compose_snapshot(&root, Some(&ledger)).await.expect("repo");

        let rows = ledger.file_events_for_session("sess").unwrap();
        assert_eq!(rows.len(), 1, "the out-of-repo row is gone: {rows:?}");
        assert_eq!(rows[0].file_path, "a.txt");
    }

    /// An in-repo file already deleted from disk cannot canonicalize, but it is
    /// still in the repo — the sweep must rewrite it, never purge it.
    /// "Unresolvable" is not "outside".
    #[cfg(unix)]
    #[tokio::test]
    async fn sweep_keeps_a_row_for_a_deleted_in_repo_file() {
        let (_dir, root) = init_repo();
        let gone = root.join("src/gone.txt");
        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn("sess", "ws", &root.to_string_lossy(), "card", 0, None)
            .unwrap();
        ledger
            .record_file_event(&event("sess", "tu-1", &gone, &root))
            .unwrap();

        compose_snapshot(&root, Some(&ledger)).await.expect("repo");

        let rows = ledger.file_events_for_session("sess").unwrap();
        assert_eq!(rows.len(), 1, "the row survives: {rows:?}");
        assert_eq!(rows[0].file_path, "src/gone.txt", "rewritten, not purged");
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

    fn draft_row(selection: Option<&str>) -> crate::session_ledger::ChangesetDraftRow {
        crate::session_ledger::ChangesetDraftRow {
            owner_kind: "session".to_string(),
            owner_id: "sess-1".to_string(),
            project_dir: "/tmp/p".to_string(),
            fingerprint: "fp".to_string(),
            message: "Do the thing".to_string(),
            updated_at: 7,
            edited: false,
            selection: selection.map(str::to_string),
        }
    }

    /// The outbound projection is opaque: whatever the client stored in the
    /// selection column reaches it again unchanged. Narrowing this to a
    /// struct is how the hunk elections were dropped between the ledger and
    /// the deck — serde discards the fields the struct does not name.
    #[test]
    fn draft_projection_preserves_unnamed_selection_keys() {
        let stored = r#"{"include":["a.rs"],"exclude":[],"hunks":{"f.txt":["abc123","def456"]}}"#;
        let draft = draft_from_row(&draft_row(Some(stored)));
        let selection = draft.selection.expect("selection projects");

        assert_eq!(selection["include"], serde_json::json!(["a.rs"]));
        assert_eq!(
            selection["hunks"],
            serde_json::json!({"f.txt": ["abc123", "def456"]}),
            "a key no Rust type names must survive the projection"
        );
    }

    /// A hand-mangled selection reads as no overrides rather than poisoning
    /// the snapshot.
    #[test]
    fn draft_projection_drops_a_malformed_selection() {
        assert!(
            draft_from_row(&draft_row(Some("{not json")))
                .selection
                .is_none()
        );
        assert!(draft_from_row(&draft_row(None)).selection.is_none());
    }
}

/// The M02A checklist, walked against the real machinery rather than by hand.
///
/// Every step here runs the product path: a real git repo, a real
/// `SessionLedger` holding a live session and a proof row, the real
/// [`compose_snapshot`], the real draft round trip through the ledger, and the
/// real landing engine. What it does **not** drive is the rendering — the
/// checkbox, the badge text, and the disabled control are React, and are
/// covered by the `reconcileHunkElection` unit table and by at0333.
///
/// The point of walking it here is that every M02A defect lived on this side
/// of the boundary: the projection that dropped the election, the two diff
/// spellings that could disagree about an id, the landing that had to refuse
/// drift. A checklist item a machine can hold is not a hand-verification item.
#[cfg(test)]
mod m02a_verification {
    use super::*;
    use crate::session_ledger::{ChangesetDraftRow, FileEventRow};
    use std::path::Path;

    const SESSION: &str = "hv-session";
    const FILE: &str = "wide.txt";

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// 120 committed lines, then edits at 20 and 90 — far enough apart that
    /// git emits two hunks rather than merging them.
    fn dirty_two_hunks(root: &Path) {
        let dirty: String = (1..=120)
            .map(|n| match n {
                20 | 90 => format!("line {n} CHANGED\n"),
                _ => format!("line {n}\n"),
            })
            .collect();
        std::fs::write(root.join(FILE), dirty).unwrap();
    }

    fn seed_repo() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-q", "-b", "main"]);
        git(&root, &["config", "user.email", "t@t.test"]);
        git(&root, &["config", "user.name", "t"]);
        let base: String = (1..=120).map(|n| format!("line {n}\n")).collect();
        std::fs::write(root.join(FILE), base).unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-q", "-m", "init"]);
        dirty_two_hunks(&root);
        (dir, root)
    }

    /// A live session that proof-owns the dirty file — the shape a real
    /// session-entry row is composed from.
    fn seed_ledger(root: &Path) -> SessionLedger {
        let ledger = SessionLedger::open_in_memory().unwrap();
        ledger
            .record_spawn(SESSION, "ws", &root.to_string_lossy(), "card-1", 0, None)
            .unwrap();
        ledger
            .record_file_event(&FileEventRow {
                tug_session_id: SESSION.to_owned(),
                tool_use_id: "tu-1".to_owned(),
                file_path: root.join(FILE).to_string_lossy().into_owned(),
                tool_name: "Edit".to_owned(),
                op: "write".to_owned(),
                origin: "exact".to_owned(),
                ambiguous: false,
                parent_tool_use_id: None,
                project_dir: root.to_string_lossy().into_owned(),
                // Past the row-liveness cut (the file's last commit).
                at: 9_000_000_000_000,
            })
            .unwrap();
        ledger
    }

    /// The hunk ids the deck's checkboxes are keyed by — read the way the deck
    /// reads them, off the wire.
    async fn wire_hunk_ids(root: &Path) -> Vec<String> {
        let diff = super::super::git::fetch_git_diff_with_untracked(root, &[])
            .await
            .expect("wire diff");
        super::super::git::parse_git_diff(&diff)
            .into_iter()
            .find(|f| f.path == FILE)
            .expect("the dirty file is on the wire")
            .hunks
    }

    fn write_election(ledger: &SessionLedger, root: &Path, ids: &[&str]) {
        let selection = serde_json::json!({
            "include": [],
            "exclude": [],
            "hunks": { FILE: ids },
        });
        ledger
            .upsert_changeset_draft(&ChangesetDraftRow {
                owner_kind: "session".to_owned(),
                owner_id: SESSION.to_owned(),
                project_dir: root.to_string_lossy().into_owned(),
                fingerprint: "fp".to_owned(),
                message: "Land part of the file".to_owned(),
                updated_at: 1,
                edited: false,
                selection: Some(selection.to_string()),
            })
            .unwrap();
    }

    /// The composed session entry for our seeded session.
    async fn session_entry(root: &Path, ledger: &SessionLedger) -> ChangesetEntry {
        compose_snapshot(root, Some(ledger))
            .await
            .expect("repo composes")
            .changesets
            .into_iter()
            .find(|e| matches!(e, ChangesetEntry::Session { owner_id, .. } if owner_id == SESSION))
            .expect("the live session owns a dirty file, so it has an entry")
    }

    fn head_patch(root: &Path) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["show", "--no-color", "HEAD"])
            .output()
            .expect("git show");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// **HV1 + HV2** — the election settles, survives the round trip through
    /// the ledger, and the row can count it.
    ///
    /// This is the F1 defect's exact path. Before the projection was made
    /// opaque, the `hunks` key was written to the ledger and then dropped by
    /// the typed struct on the way back out, so the checkbox snapped back and
    /// the badge never appeared. `elected`/`total` here are the two numbers
    /// the `N of M hunks` badge renders.
    #[tokio::test]
    async fn hv1_hv2_the_election_settles_and_the_row_can_count_it() {
        let (_dir, root) = seed_repo();
        let ledger = seed_ledger(&root);
        let ids = wire_hunk_ids(&root).await;
        assert_eq!(ids.len(), 2, "two well-separated edits, two hunks");

        write_election(&ledger, &root, &[&ids[0]]);

        let ChangesetEntry::Session { files, draft, .. } = session_entry(&root, &ledger).await
        else {
            panic!("session entry");
        };
        assert!(
            files.iter().any(|f| f.path == FILE),
            "the session owns the dirty file"
        );

        let selection = draft
            .expect("an entry with files carries its draft")
            .selection
            .expect("the draft carries the selection");
        assert_eq!(
            selection["hunks"][FILE],
            serde_json::json!([ids[0]]),
            "the election survives the projection — the F1 defect verbatim"
        );

        // What the badge renders: elected ∩ current = 1, total = 2.
        let elected = selection["hunks"][FILE]
            .as_array()
            .unwrap()
            .iter()
            .filter(|id| ids.iter().any(|cur| cur == id.as_str().unwrap()))
            .count();
        assert_eq!((elected, ids.len()), (1, 2), "the row reads `1 of 2 hunks`");
    }

    /// **HV4 + HV6** — a partial landing takes only the elected hunk and
    /// leaves the rest dirty; an unelected file still lands whole.
    #[tokio::test]
    async fn hv4_hv6_partial_lands_alone_and_whole_file_still_lands_whole() {
        let (_dir, root) = seed_repo();
        let _ledger = seed_ledger(&root);
        let ids = wire_hunk_ids(&root).await;

        // HV4: land the first hunk only.
        let mut hunks = std::collections::BTreeMap::new();
        hunks.insert(FILE.to_string(), vec![ids[0].clone()]);
        tugchanges_core::commit(tugchanges_core::CommitOptions {
            project: Some(root.clone()),
            message: "land the first hunk".to_string(),
            paths: Some(vec![FILE.to_string()]),
            hunks: Some(hunks),
            ..Default::default()
        })
        .expect("the partial landing succeeds");

        let shown = head_patch(&root);
        assert!(
            shown.contains("line 20 CHANGED"),
            "the elected hunk landed: {shown}"
        );
        assert!(
            !shown.contains("line 90 CHANGED"),
            "the unelected hunk did NOT land: {shown}"
        );
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["status", "--porcelain"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&status.stdout).contains(FILE),
            "the remainder is still dirty"
        );

        // HV6: no election now — the remainder lands whole.
        tugchanges_core::commit(tugchanges_core::CommitOptions {
            project: Some(root.clone()),
            message: "land the rest".to_string(),
            paths: Some(vec![FILE.to_string()]),
            ..Default::default()
        })
        .expect("the whole-file landing succeeds");
        assert!(
            head_patch(&root).contains("line 90 CHANGED"),
            "the remainder landed whole"
        );
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["status", "--porcelain"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&status.stdout).trim().is_empty(),
            "the tree is clean"
        );
    }

    /// **HV5 + HV8** — an election whose content has moved is refused by name,
    /// and the refusal stages nothing.
    ///
    /// HV8's display half (the row reading `stale election` rather than a
    /// silent whole-file landing) is the `reconcileHunkElection` table's job;
    /// what matters here is that the condition it warns about is real — the
    /// landing genuinely refuses rather than quietly taking the whole file.
    #[tokio::test]
    async fn hv5_hv8_drift_refuses_by_name_and_stages_nothing() {
        let (_dir, root) = seed_repo();
        let _ledger = seed_ledger(&root);
        let ids = wire_hunk_ids(&root).await;

        // Elect the first hunk, then edit that hunk's own content out from
        // under the election.
        let drifted: String = (1..=120)
            .map(|n| match n {
                20 => "line 20 CHANGED AGAIN\n".to_string(),
                90 => "line 90 CHANGED\n".to_string(),
                _ => format!("line {n}\n"),
            })
            .collect();
        std::fs::write(root.join(FILE), drifted).unwrap();

        let mut hunks = std::collections::BTreeMap::new();
        hunks.insert(FILE.to_string(), vec![ids[0].clone()]);
        let err = tugchanges_core::commit(tugchanges_core::CommitOptions {
            project: Some(root.clone()),
            message: "land a hunk that moved".to_string(),
            paths: Some(vec![FILE.to_string()]),
            hunks: Some(hunks),
            ..Default::default()
        })
        .expect_err("the elected hunk is no longer in the file");

        match &err {
            tugchanges_core::CommitError::HunkDrift { path, ids: named } => {
                assert_eq!(path, FILE, "the refusal names the path");
                assert_eq!(named, &vec![ids[0].clone()], "and the drifted id");
            }
            other => panic!("expected a typed drift refusal, got {other:?}"),
        }
        assert!(
            err.to_string().starts_with("hunk drift:"),
            "the refusal reads as drift: {err}"
        );

        let staged = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["diff", "--cached", "--name-only"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&staged.stdout).trim().is_empty(),
            "a refused landing leaves nothing staged"
        );
    }

    /// **HV3's premise** — an election that selects nothing is refused, which
    /// is what makes the disabled last checkbox correct rather than arbitrary.
    ///
    /// The control refuses to let the user uncheck the sole remaining hunk.
    /// That guard is only honest if the state it prevents is genuinely
    /// unreachable-by-design, so this pins the engine end of it: a file in the
    /// landing set with an empty election is an error, not a whole-file
    /// disposition.
    #[tokio::test]
    async fn hv3_an_election_that_selects_nothing_is_refused() {
        let (_dir, root) = seed_repo();
        let mut hunks = std::collections::BTreeMap::new();
        hunks.insert(FILE.to_string(), Vec::new());

        let err = tugchanges_core::commit(tugchanges_core::CommitOptions {
            project: Some(root.clone()),
            message: "land nothing".to_string(),
            paths: Some(vec![FILE.to_string()]),
            hunks: Some(hunks),
            ..Default::default()
        })
        .expect_err("an empty election is not a disposition");
        assert!(
            err.to_string().contains("selects no hunks"),
            "the refusal says why: {err}"
        );
    }

    /// **HV7's mechanism** — the id a collapsed band is keyed by survives a
    /// hunk appearing above it.
    ///
    /// at0333 drives the DOM half on a real row (the band stays folded and the
    /// diff body is the same node). This pins the half that makes that
    /// meaningful: the id is content-derived, so inserting a hunk above does
    /// not move it — if ids shifted with position, surviving the mount would
    /// still land the fold on the wrong band.
    #[tokio::test]
    async fn hv7_a_hunk_appearing_above_does_not_move_the_ids_below_it() {
        let (_dir, root) = seed_repo();
        let before = wire_hunk_ids(&root).await;
        assert_eq!(before.len(), 2);

        // A third edit between the two, far enough from both to be its own
        // hunk — the "a hunk appears above the collapsed one" transition.
        let three: String = (1..=120)
            .map(|n| match n {
                20 | 55 | 90 => format!("line {n} CHANGED\n"),
                _ => format!("line {n}\n"),
            })
            .collect();
        std::fs::write(root.join(FILE), three).unwrap();

        let after = wire_hunk_ids(&root).await;
        assert_eq!(after.len(), 3, "the new edit is its own hunk");
        assert_eq!(
            (after[0].clone(), after[2].clone()),
            (before[0].clone(), before[1].clone()),
            "the original hunks keep their ids — the `@@` header is not hashed, \
             so a hunk appearing between them cannot move either one"
        );
    }
}
