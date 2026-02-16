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
}
