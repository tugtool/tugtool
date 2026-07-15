//! Data types for filesystem and git feeds
//!
//! This module provides the core data structures for snapshot feeds,
//! serialized as JSON payloads in WebSocket frames.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Filesystem event types
///
/// Represents changes detected by the filesystem watcher.
/// Serialized with serde's `tag` attribute to produce tagged JSON
/// format: `{"kind": "Created", "path": "..."}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum FsEvent {
    /// File or directory was created
    Created {
        /// Relative path from the watched directory
        path: String,
    },
    /// File or directory was modified
    Modified {
        /// Relative path from the watched directory
        path: String,
    },
    /// File or directory was removed
    Removed {
        /// Relative path from the watched directory
        path: String,
    },
    /// File or directory was renamed
    Renamed {
        /// Original path before rename
        from: String,
        /// New path after rename
        to: String,
    },
}

/// Git repository status snapshot
///
/// Represents the current state of a git repository, including branch info,
/// tracking status, and working tree changes. Serialized as JSON with
/// snake_case field names to match git porcelain output conventions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitStatus {
    /// Current branch name, or "(detached)" if HEAD is detached
    pub branch: String,
    /// Number of commits ahead of upstream
    pub ahead: u32,
    /// Number of commits behind upstream
    pub behind: u32,
    /// Files staged for commit
    pub staged: Vec<FileStatus>,
    /// Files with unstaged changes
    pub unstaged: Vec<FileStatus>,
    /// Untracked files
    pub untracked: Vec<String>,
    /// SHA of HEAD commit
    pub head_sha: String,
    /// Subject line of HEAD commit
    pub head_message: String,
}

/// File status entry for git staging area
///
/// Represents a single file's status in the git working tree or index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileStatus {
    /// Relative path from repository root
    pub path: String,
    /// Git status code (M=modified, A=added, D=deleted, R=renamed, etc.)
    pub status: String,
}

/// How a file changed, relative to `HEAD`, in a `git diff` payload.
///
/// Serialized lowercase (`"added"`, `"modified"`, `"deleted"`, `"renamed"`)
/// so the tugdeck `/diff` accordion can label each file's trigger directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffFileStatus {
    /// New file (`new file mode` in the diff header).
    Added,
    /// Content (or mode) changed in place.
    Modified,
    /// File removed (`deleted file mode`).
    Deleted,
    /// Tracked-path rename (`rename from` / `rename to`), possibly with edits.
    Renamed,
}

/// One changed file within a `git diff HEAD` payload.
///
/// `unified` is that file's complete unified-diff chunk, verbatim from git
/// (the `diff --git` / `index` preamble through the last hunk line). The
/// tugdeck client feeds it straight to `DiffBlock` as `{source:"unified"}` —
/// the parser skips every line before the first `@@`, so the preamble is
/// harmless and the chunk stays the faithful single-file diff.
///
/// `added` / `removed` count the `+` / `-` body lines (not the `+++` / `---`
/// headers); for a binary file both are `0` and `binary` is `true`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitDiffFile {
    /// Path relative to the repo root (the rename *destination* when renamed).
    pub path: String,
    /// Original path for a rename; `None` otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// How the file changed.
    pub status: GitDiffFileStatus,
    /// Count of added (`+`) body lines.
    pub added: u32,
    /// Count of removed (`-`) body lines.
    pub removed: u32,
    /// True when git reported a binary file (no textual hunks).
    pub binary: bool,
    /// The file's complete unified-diff chunk, verbatim from git.
    pub unified: String,
}

/// A single-shot `git diff HEAD` payload, delivered on the GIT_DIFF feed
/// (0x21) in response to a GIT_DIFF_QUERY (0x22).
///
/// `request_id` echoes the query's correlation id and `workspace_key`
/// identifies the project dir the diff was computed in (the dir behind the
/// Z4B GIT-status chip), so the client can match the response to the card
/// that asked. `base` is the ref the working tree was compared against
/// (`"HEAD"`). The `total_*` / `file_count` summary mirrors Claude Code's
/// "N files changed +X −Y" header and equals the sum across `files`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitDiffSnapshot {
    /// Correlation id echoed from the request.
    pub request_id: String,
    /// Canonical key of the workspace the diff was computed in.
    pub workspace_key: String,
    /// The ref the working tree was diffed against (currently `"HEAD"`).
    pub base: String,
    /// True when the project dir is **not** inside a git working tree — so the
    /// client can say "not a git repository" rather than misreport a clean
    /// tree. `files` is empty in that case.
    #[serde(default)]
    pub no_repo: bool,
    /// Number of changed files (`files.len()`).
    pub file_count: u32,
    /// Total added lines across all files.
    pub total_added: u32,
    /// Total removed lines across all files.
    pub total_removed: u32,
    /// One entry per changed file, in git's output order.
    pub files: Vec<GitDiffFile>,
}

/// A single commit in a [`GitLogSnapshot`]. The wire carries structured fields
/// so the client can format them and later hang per-commit affordances off the
/// full `sha` without a wire change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitLogCommit {
    /// Full 40-char commit hash. Clients shorten for display.
    pub sha: String,
    /// The commit subject line (`%s`).
    pub subject: String,
    /// Author name (`%an`).
    pub author: String,
    /// Author date, `--date=short` (`YYYY-MM-DD`).
    pub date: String,
}

/// A HEAD-moved signal, broadcast on the GIT_HEAD feed (0x27) whenever a
/// workspace's HEAD changes (a commit, checkout, reset, merge, rebase — from
/// any source, detected by watching the git dir). It carries no log payload:
/// a git-log consumer scoped to `workspace_key` re-requests the log on receipt.
/// `head` is the new HEAD sha (or `""` for an unborn/`no_repo` state) so a
/// consumer can dedup redundant signals.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitHeadSignal {
    /// Canonical key of the workspace whose HEAD moved.
    pub workspace_key: String,
    /// The new HEAD sha, or `""` when unborn / not a repo.
    pub head: String,
}

/// A single-shot recent-commits payload, delivered on the GIT_LOG feed (0x25)
/// in response to a GIT_LOG_QUERY (0x26).
///
/// `request_id` echoes the query's correlation id and `workspace_key`
/// identifies the project dir the log was read in, so the client can match the
/// broadcast response to the request that asked. `branch` is the current
/// branch (`git branch --show-current`), `"(detached)"` when detached, and
/// `""` when `no_repo`. `commits` is most-recent-first, capped at the request's
/// `limit`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitLogSnapshot {
    /// Correlation id echoed from the request.
    pub request_id: String,
    /// Canonical key of the workspace the log was read in.
    pub workspace_key: String,
    /// Current branch (`git branch --show-current`), `"(detached)"` when
    /// detached, `""` when `no_repo`.
    pub branch: String,
    /// True when the project dir is **not** inside a git working tree — so the
    /// client can say "not a git repository". `commits` is empty in that case.
    #[serde(default)]
    pub no_repo: bool,
    /// Most-recent-first commits, at most the request's `limit`.
    pub commits: Vec<GitLogCommit>,
}

/// One file inside a changeset entry on the CHANGESET feed (0x23).
///
/// `git_status` is the porcelain-v2 XY pair for working-tree files, or the
/// name-status letter for a dash's `base..branch` files. `op` / `origin`
/// carry the attribution provenance recorded in `file_events`; `ambiguous`
/// marks files whose Bash bracket overlapped another session's, and `shared`
/// marks files owned by more than one changeset — both are excluded from the
/// card's default commit selection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangesetFile {
    /// Path relative to the repository root.
    pub path: String,
    /// Porcelain-v2 XY status (working tree) or name-status letter (dash).
    pub git_status: String,
    /// Attribution operation: write | edit | notebook | created | modified |
    /// deleted | renamed.
    pub op: String,
    /// Attribution origin: exact | bash | replay | dash.
    pub origin: String,
    /// True when a concurrent session's Bash bracket overlapped this file.
    pub ambiguous: bool,
    /// True when more than one changeset owns this file.
    pub shared: bool,
    /// Epoch milliseconds of the most recent attribution event for this file.
    pub last_touched: i64,
}

/// A file the attribution engine has no owner for (hand edits, detached
/// background writes). Rendered in the card's unattributed section.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnattributedFile {
    /// Path relative to the repository root.
    pub path: String,
    /// Porcelain-v2 XY status pair.
    pub git_status: String,
}

/// The maintained commit-message draft for a changeset entry (Spec S10), the
/// artifact the draft engine keeps current so Commit is one click. Rides the
/// aggregate snapshot when present; absent while an entry has no draft yet.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangesetDraft {
    /// Hash of the entry's scoped content the draft was generated for
    /// (Spec S11) — lets the client tell a fresh draft from a stale one.
    pub fingerprint: String,
    /// The maintained commit message (subject + terse bullets); its body
    /// doubles as the summary.
    pub message: String,
    /// Epoch milliseconds of the last regeneration.
    pub updated_at: i64,
}

/// One owner's slice of the workspace's dirty state on the CHANGESET feed.
///
/// Internally tagged on `kind` (`"session"` | `"dash"`) so the client can
/// discriminate without a separate field check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChangesetEntry {
    /// Files attributed to one Claude session's `file_events` rows.
    Session {
        /// The tug session id that owns these files.
        owner_id: String,
        /// Session display name (`name` when user-set, else the id hash).
        display_name: String,
        /// True when the session has a live relay right now.
        live: bool,
        /// The session's attributed dirty files.
        files: Vec<ChangesetFile>,
        /// The maintained commit-message draft, when one exists (Spec S10).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        draft: Option<ChangesetDraft>,
    },
    /// A dash worktree branch (`refs/heads/tugdash/…`) and its accumulated
    /// `base..branch` changes.
    Dash {
        /// The dash branch ref name (e.g. `tugdash/fix-join`).
        owner_id: String,
        /// The dash's short name (branch name without the `tugdash/` prefix).
        display_name: String,
        /// The base branch the dash was created from.
        base: String,
        /// Number of commits on the dash branch past its base.
        rounds: u32,
        /// Worktree path relative to the repository root.
        worktree: String,
        /// True when the dash worktree has uncommitted changes.
        worktree_dirty: bool,
        /// `base..branch` name-status files.
        files: Vec<ChangesetFile>,
        /// The maintained draft — the dash's eventual squash/join message
        /// ([P23], Spec S10) — when one exists.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        draft: Option<ChangesetDraft>,
    },
}

/// The workspace-scoped changeset snapshot, delivered on the CHANGESET feed
/// (0x23).
///
/// Embeds the branch / ahead-behind / HEAD header (the retired git card's
/// data) plus every owner's attributed files and the unattributed remainder.
/// Composition rules live with the feed; this is the wire contract, mirrored
/// in `tugdeck/src/lib/changeset-types.ts` and guarded by the shared golden
/// fixture `tugdeck/src/__tests__/fixtures/changeset-snapshot.golden.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangesetSnapshot {
    /// Canonical key of the workspace the snapshot was computed in.
    /// Serialized like every other snapshot feed's spliced key.
    #[serde(default)]
    pub workspace_key: String,
    /// Current branch name, or "(detached)" if HEAD is detached.
    pub branch: String,
    /// Number of commits ahead of upstream.
    pub ahead: u32,
    /// Number of commits behind upstream.
    pub behind: u32,
    /// SHA of HEAD commit.
    pub head_sha: String,
    /// Subject line of HEAD commit.
    pub head_message: String,
    /// One entry per owner (session or dash) with attributed files.
    pub changesets: Vec<ChangesetEntry>,
    /// Dirty files no owner claims.
    pub unattributed: Vec<UnattributedFile>,
}

/// One project's slice of the account-global aggregate changeset snapshot.
///
/// Carries the project's identity (`project_dir` — the absolute checkout root,
/// also the client's clickable-link base — plus `display_name` and
/// `workspace_key`) and, flattened alongside, the per-project
/// [`ChangesetSnapshot`] payload. When `no_repo` is true the project dir is not
/// inside a git working tree: the flattened snapshot fields are empty/zero and
/// the card renders an "Initialize git" affordance instead of changeset rows.
///
/// The flatten keeps the wire shape flat (Spec S06) — `workspace_key` comes
/// from the embedded snapshot, so it is not repeated here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectChangeset {
    /// Absolute checkout root; also the base for the card's clickable links.
    pub project_dir: String,
    /// Basename of `project_dir`, shown as the section title.
    pub display_name: String,
    /// True when `project_dir` is not inside a git working tree.
    pub no_repo: bool,
    /// The per-project changeset payload (branch header + changesets +
    /// unattributed), flattened so the wire shape stays flat. Empty/zero
    /// when `no_repo` is true.
    #[serde(flatten)]
    pub snapshot: ChangesetSnapshot,
    /// The maintained draft for this project's unattributed bucket (Spec
    /// S10), when one exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unattributed_draft: Option<ChangesetDraft>,
}

/// The account-global aggregate changeset snapshot, delivered process-level on
/// the CHANGESET_ALL feed (0x24) — one frame carrying every open project.
///
/// Composed by the aggregate feed over the current `WorkspaceRegistry` entries
/// (one per open dev card, plus the bootstrap project); mirrored in
/// `tugdeck/src/lib/changeset-types.ts` and guarded by the shared golden
/// fixture `tugdeck/src/__tests__/fixtures/workspaces-changeset-snapshot.golden.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspacesChangesetSnapshot {
    /// One entry per open project, in registry-enumeration order.
    pub projects: Vec<ProjectChangeset>,
}

/// A single-shot subscription-usage payload, delivered on the USAGE feed
/// (0x90) in response to a USAGE_QUERY (0x91).
///
/// Carries the verbatim text `claude -p "/usage"` prints — the same panel the
/// terminal shows (limit gauges, reset times, and the "what's contributing"
/// breakdown). The deck parses `text` into its graphical shape. `request_id`
/// echoes the query's correlation id; `ok` is false (with `error` set) when the
/// `claude` invocation failed or the user is logged out.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageSnapshot {
    /// Correlation id echoed from the request.
    pub request_id: String,
    /// True when `claude -p "/usage"` exited successfully.
    pub ok: bool,
    /// Verbatim stdout of `claude -p "/usage"` (may be empty on failure).
    pub text: String,
    /// Human-readable failure reason when `ok` is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A single scored result from fuzzy file matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredResult {
    /// Relative path for indexed queries; absolute path for off-board queries [D10].
    pub path: String,
    /// Fuzzy match score (higher = better). 0 for off-board results.
    pub score: i32,
    /// Byte-offset ranges `[start, end)` of matched characters for highlighting.
    /// Empty for off-board results.
    pub matches: Vec<(usize, usize)>,
    /// True when the entry is a directory. Directory paths also carry a
    /// trailing `/`, but this flag is the contract — clients must not
    /// parse the path shape.
    #[serde(default)]
    pub is_dir: bool,
}

/// File tree query response.
///
/// Delivered by the FILETREE feed (0x11) in response to a FILETREE_QUERY (0x12).
/// Contains the top-N scored results for the query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeSnapshot {
    /// Echo of the query that produced these results (for staleness detection).
    pub query: String,
    /// Top-N results sorted by descending score.
    pub results: Vec<ScoredResult>,
    /// True if the file index exceeded the 50,000 cap.
    pub truncated: bool,
}

/// Aggregate stats snapshot combining all collector outputs
///
/// Each collector produces a JSON value that is stored in the collectors map
/// under the collector's name. The timestamp indicates when this snapshot
/// was assembled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatSnapshot {
    /// Map of collector name to collector output (heterogeneous JSON values)
    pub collectors: HashMap<String, serde_json::Value>,
    /// ISO 8601 timestamp of snapshot assembly
    pub timestamp: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fsevent_created_json() {
        let event = FsEvent::Created {
            path: "src/main.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"kind":"Created","path":"src/main.rs"}"#);
    }

    #[test]
    fn test_fsevent_modified_json() {
        let event = FsEvent::Modified {
            path: "src/lib.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"kind":"Modified","path":"src/lib.rs"}"#);
    }

    #[test]
    fn test_fsevent_removed_json() {
        let event = FsEvent::Removed {
            path: "old_file.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"kind":"Removed","path":"old_file.rs"}"#);
    }

    #[test]
    fn test_fsevent_renamed_json() {
        let event = FsEvent::Renamed {
            from: "old.rs".to_string(),
            to: "new.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""kind":"Renamed""#));
        assert!(json.contains(r#""from":"old.rs""#));
        assert!(json.contains(r#""to":"new.rs""#));
    }

    #[test]
    fn test_fsevent_round_trip() {
        let events = vec![
            FsEvent::Created {
                path: "test.rs".to_string(),
            },
            FsEvent::Modified {
                path: "src/main.rs".to_string(),
            },
            FsEvent::Removed {
                path: "old.rs".to_string(),
            },
            FsEvent::Renamed {
                from: "a.rs".to_string(),
                to: "b.rs".to_string(),
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).unwrap();
            let decoded: FsEvent = serde_json::from_str(&json).unwrap();
            let json2 = serde_json::to_string(&decoded).unwrap();
            assert_eq!(json, json2);
        }
    }

    #[test]
    fn test_git_diff_file_status_lowercase() {
        assert_eq!(
            serde_json::to_string(&GitDiffFileStatus::Added).unwrap(),
            r#""added""#
        );
        assert_eq!(
            serde_json::to_string(&GitDiffFileStatus::Modified).unwrap(),
            r#""modified""#
        );
        assert_eq!(
            serde_json::to_string(&GitDiffFileStatus::Deleted).unwrap(),
            r#""deleted""#
        );
        assert_eq!(
            serde_json::to_string(&GitDiffFileStatus::Renamed).unwrap(),
            r#""renamed""#
        );
    }

    #[test]
    fn test_git_diff_file_omits_old_path_when_absent() {
        let file = GitDiffFile {
            path: "src/main.rs".to_string(),
            old_path: None,
            status: GitDiffFileStatus::Modified,
            added: 3,
            removed: 1,
            binary: false,
            unified: "@@ -1 +1,3 @@\n a\n+b\n+c\n".to_string(),
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(
            !json.contains("old_path"),
            "absent old_path must be omitted"
        );
        let decoded: GitDiffFile = serde_json::from_str(&json).unwrap();
        assert_eq!(file, decoded);
    }

    #[test]
    fn test_git_diff_snapshot_round_trip() {
        let snapshot = GitDiffSnapshot {
            request_id: "req-1".to_string(),
            workspace_key: "/work/repo".to_string(),
            base: "HEAD".to_string(),
            no_repo: false,
            file_count: 2,
            total_added: 12,
            total_removed: 3,
            files: vec![
                GitDiffFile {
                    path: "renamed.rs".to_string(),
                    old_path: Some("old.rs".to_string()),
                    status: GitDiffFileStatus::Renamed,
                    added: 2,
                    removed: 1,
                    binary: false,
                    unified: "diff --git a/old.rs b/renamed.rs\n".to_string(),
                },
                GitDiffFile {
                    path: "img.png".to_string(),
                    old_path: None,
                    status: GitDiffFileStatus::Modified,
                    added: 0,
                    removed: 0,
                    binary: true,
                    unified: "Binary files a/img.png and b/img.png differ\n".to_string(),
                },
            ],
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: GitDiffSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
    }

    #[test]
    fn test_git_log_snapshot_round_trip() {
        let snapshot = GitLogSnapshot {
            request_id: "gl-1".to_string(),
            workspace_key: "/work/repo".to_string(),
            branch: "main".to_string(),
            no_repo: false,
            commits: vec![
                GitLogCommit {
                    sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
                    subject: "add feature".to_string(),
                    author: "Ada Lovelace".to_string(),
                    date: "2026-07-15".to_string(),
                },
                GitLogCommit {
                    sha: "89abcdef0123456789abcdef0123456789abcdef".to_string(),
                    subject: "initial".to_string(),
                    author: "Grace Hopper".to_string(),
                    date: "2026-07-14".to_string(),
                },
            ],
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: GitLogSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
    }

    #[test]
    fn test_git_head_signal_round_trip() {
        let sig = GitHeadSignal {
            workspace_key: "/work/repo".to_string(),
            head: "0123456789abcdef0123456789abcdef01234567".to_string(),
        };
        let json = serde_json::to_string(&sig).unwrap();
        let decoded: GitHeadSignal = serde_json::from_str(&json).unwrap();
        assert_eq!(sig, decoded);
    }

    #[test]
    fn test_git_log_snapshot_no_repo_defaults() {
        // A payload with no `no_repo` field decodes to `false`.
        let json = r#"{"request_id":"gl-2","workspace_key":"ws","branch":"","commits":[]}"#;
        let decoded: GitLogSnapshot = serde_json::from_str(json).unwrap();
        assert!(!decoded.no_repo);
        assert!(decoded.commits.is_empty());
    }

    #[test]
    fn test_git_status_json_round_trip() {
        let status = GitStatus {
            branch: "main".to_string(),
            ahead: 2,
            behind: 1,
            staged: vec![
                FileStatus {
                    path: "src/main.rs".to_string(),
                    status: "M".to_string(),
                },
                FileStatus {
                    path: "src/lib.rs".to_string(),
                    status: "A".to_string(),
                },
            ],
            unstaged: vec![FileStatus {
                path: "README.md".to_string(),
                status: "M".to_string(),
            }],
            untracked: vec!["temp.txt".to_string()],
            head_sha: "abc123".to_string(),
            head_message: "Initial commit".to_string(),
        };

        let json = serde_json::to_string(&status).unwrap();
        let decoded: GitStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, decoded);
    }

    #[test]
    fn test_git_status_partial_eq_equal() {
        let status1 = GitStatus {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "abc".to_string(),
            head_message: "test".to_string(),
        };

        let status2 = GitStatus {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "abc".to_string(),
            head_message: "test".to_string(),
        };

        assert_eq!(status1, status2);
    }

    #[test]
    fn test_git_status_partial_eq_different() {
        let status1 = GitStatus {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "abc".to_string(),
            head_message: "test".to_string(),
        };

        let status2 = GitStatus {
            branch: "develop".to_string(),
            ahead: 1,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "def".to_string(),
            head_message: "different".to_string(),
        };

        assert_ne!(status1, status2);
    }

    #[test]
    fn test_file_status_json_round_trip() {
        let file_status = FileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
        };

        let json = serde_json::to_string(&file_status).unwrap();
        let decoded: FileStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(file_status, decoded);
    }

    #[test]
    fn test_golden_fsevent_created() {
        let event = FsEvent::Created {
            path: "src/main.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"kind":"Created","path":"src/main.rs"}"#);
    }

    #[test]
    fn test_golden_fsevent_renamed() {
        let event = FsEvent::Renamed {
            from: "old.rs".to_string(),
            to: "new.rs".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"kind":"Renamed","from":"old.rs","to":"new.rs"}"#);
    }

    #[test]
    fn test_stat_snapshot_json_round_trip() {
        let mut collectors = HashMap::new();
        collectors.insert(
            "process_info".to_string(),
            serde_json::json!({"pid": 12345, "cpu_percent": 12.5}),
        );
        collectors.insert(
            "token_usage".to_string(),
            serde_json::json!({"total_tokens": 23000}),
        );

        let snapshot = StatSnapshot {
            collectors,
            timestamp: "2026-02-15T10:30:05Z".to_string(),
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: StatSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
    }

    #[test]
    fn test_stat_snapshot_empty_collectors() {
        let snapshot = StatSnapshot {
            collectors: HashMap::new(),
            timestamp: "2026-02-15T10:30:05Z".to_string(),
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: StatSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
        assert_eq!(decoded.collectors.len(), 0);
    }

    /// The shared wire-contract fixture, also validated by the tugdeck bun
    /// test suite — drift on either side of the mirror fails one of the two.
    const CHANGESET_GOLDEN: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tugdeck/src/__tests__/fixtures/changeset-snapshot.golden.json"
    ));

    #[test]
    fn test_changeset_snapshot_golden_fixture() {
        let snapshot: ChangesetSnapshot = serde_json::from_str(CHANGESET_GOLDEN).unwrap();
        assert_eq!(snapshot.branch, "main");
        assert_eq!(snapshot.ahead, 2);
        assert_eq!(snapshot.changesets.len(), 2);
        assert_eq!(snapshot.unattributed.len(), 1);

        match &snapshot.changesets[0] {
            ChangesetEntry::Session {
                owner_id,
                live,
                files,
                ..
            } => {
                assert!(owner_id.starts_with("sess-"));
                assert!(live);
                assert_eq!(files.len(), 2);
                assert!(files[1].ambiguous);
                assert!(files[1].shared);
            }
            other => panic!("expected session entry, got {other:?}"),
        }
        match &snapshot.changesets[1] {
            ChangesetEntry::Dash {
                owner_id,
                base,
                rounds,
                worktree_dirty,
                files,
                ..
            } => {
                assert_eq!(owner_id, "tugdash/fix-join");
                assert_eq!(base, "main");
                assert_eq!(*rounds, 3);
                assert!(!worktree_dirty);
                assert_eq!(files.len(), 1);
            }
            other => panic!("expected dash entry, got {other:?}"),
        }
    }

    #[test]
    fn test_changeset_snapshot_round_trip() {
        let snapshot: ChangesetSnapshot = serde_json::from_str(CHANGESET_GOLDEN).unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: ChangesetSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
    }

    #[test]
    fn test_changeset_entry_kind_tags() {
        let session = ChangesetEntry::Session {
            owner_id: "sess-1".to_string(),
            display_name: "s".to_string(),
            live: false,
            files: vec![],
            draft: None,
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains(r#""kind":"session""#));
        // An absent draft is skipped on the wire.
        assert!(!json.contains("draft"));

        let dash = ChangesetEntry::Dash {
            owner_id: "tugdash/x".to_string(),
            display_name: "x".to_string(),
            base: "main".to_string(),
            rounds: 0,
            worktree: ".tug/worktrees/tugdash__x".to_string(),
            worktree_dirty: true,
            files: vec![],
            draft: Some(ChangesetDraft {
                fingerprint: "fp".to_string(),
                message: "Do the thing".to_string(),
                updated_at: 5,
            }),
        };
        let json = serde_json::to_string(&dash).unwrap();
        assert!(json.contains(r#""kind":"dash""#));
        // A present draft rides the wire.
        assert!(json.contains(r#""message":"Do the thing""#));
    }

    #[test]
    fn test_changeset_snapshot_workspace_key_defaults_empty() {
        let json = r#"{"branch":"main","ahead":0,"behind":0,"head_sha":"","head_message":"","changesets":[],"unattributed":[]}"#;
        let snapshot: ChangesetSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(snapshot.workspace_key, "");
    }

    /// The shared aggregate wire-contract fixture, also validated by the
    /// tugdeck bun suite — drift on either side of the mirror fails one.
    const WORKSPACES_CHANGESET_GOLDEN: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tugdeck/src/__tests__/fixtures/workspaces-changeset-snapshot.golden.json"
    ));

    #[test]
    fn test_workspaces_changeset_snapshot_golden_fixture() {
        let snapshot: WorkspacesChangesetSnapshot =
            serde_json::from_str(WORKSPACES_CHANGESET_GOLDEN).unwrap();
        assert_eq!(snapshot.projects.len(), 2);

        let repo = &snapshot.projects[0];
        assert_eq!(repo.display_name, "tugtool");
        assert!(!repo.no_repo);
        // Flattened snapshot fields decode onto the embedded ChangesetSnapshot.
        assert_eq!(repo.snapshot.branch, "main");
        assert_eq!(repo.snapshot.workspace_key, "a1b2c3d4e5f60718");
        assert_eq!(repo.snapshot.changesets.len(), 2);
        assert_eq!(repo.snapshot.unattributed.len(), 1);

        let non_repo = &snapshot.projects[1];
        assert_eq!(non_repo.display_name, "scratchpad");
        assert!(non_repo.no_repo);
        assert_eq!(non_repo.snapshot.branch, "");
        assert!(non_repo.snapshot.changesets.is_empty());
        assert!(non_repo.snapshot.unattributed.is_empty());
    }

    #[test]
    fn test_workspaces_changeset_snapshot_round_trip() {
        let snapshot: WorkspacesChangesetSnapshot =
            serde_json::from_str(WORKSPACES_CHANGESET_GOLDEN).unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();
        let decoded: WorkspacesChangesetSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, decoded);
    }

    #[test]
    fn test_project_changeset_flattens_snapshot_fields() {
        // The flatten keeps the wire shape flat: project identity and the
        // snapshot header sit at the same object level, workspace_key not
        // duplicated.
        let project = ProjectChangeset {
            project_dir: "/tmp/proj".to_string(),
            display_name: "proj".to_string(),
            no_repo: false,
            snapshot: ChangesetSnapshot {
                workspace_key: "deadbeef".to_string(),
                branch: "main".to_string(),
                ahead: 0,
                behind: 0,
                head_sha: "abc".to_string(),
                head_message: "msg".to_string(),
                changesets: vec![],
                unattributed: vec![],
            },
            unattributed_draft: None,
        };
        let json = serde_json::to_string(&project).unwrap();
        assert!(json.contains(r#""project_dir":"/tmp/proj""#));
        assert!(json.contains(r#""workspace_key":"deadbeef""#));
        assert!(json.contains(r#""branch":"main""#));
        // Exactly one workspace_key in the flattened output.
        assert_eq!(json.matches("workspace_key").count(), 1);
    }
}
