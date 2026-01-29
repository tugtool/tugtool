//! Filter predicate types and evaluation.
//!
//! This module provides the primitive predicate types for file filtering. Predicates
//! test individual properties of files (path, extension, size, git state, content).
//!
//! ## Predicate Keys
//!
//! - `path` - Path glob matching
//! - `name` - Basename glob matching
//! - `ext` - File extension equality
//! - `lang` - Language tag matching
//! - `kind` - File or directory
//! - `size` - File size comparisons
//! - `mtime` - File modified time comparisons
//! - `contains` - Content substring (requires `--filter-content`)
//! - `regex` - Content regex (requires `--filter-content`)
//! - `git_status` - Git status (modified, untracked, etc.)
//! - `git_tracked` - Whether file is tracked by git
//! - `git_ignored` - Whether file is ignored by git
//! - `git_stage` - Staging state (staged, unstaged)

use std::collections::HashMap;
use std::fs::Metadata;
use std::path::Path;
use std::process::Command;

use globset::Glob;
use thiserror::Error;

/// Error type for predicate operations.
#[derive(Debug, Error)]
pub enum PredicateError {
    /// Content predicate used without --filter-content flag.
    #[error("content predicate '{predicate}' requires --filter-content flag")]
    ContentPredicateWithoutFlag { predicate: String },

    /// Invalid glob pattern in predicate.
    #[error("invalid glob pattern '{pattern}': {message}")]
    InvalidPattern { pattern: String, message: String },

    /// Invalid size value.
    #[error("invalid size value '{value}': {message}")]
    InvalidSize { value: String, message: String },

    /// Invalid predicate value.
    #[error("invalid value '{value}' for predicate '{key}': {message}")]
    InvalidValue {
        key: String,
        value: String,
        message: String,
    },
}

/// Predicate key identifying what property to test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PredicateKey {
    /// Path glob matching (relative to workspace root).
    Path,
    /// Basename glob matching.
    Name,
    /// File extension (without leading dot).
    Ext,
    /// Language tag (e.g., "python", "rust").
    Lang,
    /// File kind: "file" or "dir".
    Kind,
    /// File size in bytes.
    Size,
    /// Content substring search (requires --filter-content).
    Contains,
    /// Content regex search (requires --filter-content).
    Regex,
    /// Modified time comparison (requires metadata).
    Mtime,
    /// Git status (modified, untracked, added, deleted, renamed, conflicted).
    GitStatus,
    /// Whether file is tracked by git.
    GitTracked,
    /// Whether file is ignored by git.
    GitIgnored,
    /// Git staging state (staged, unstaged).
    GitStage,
}

impl PredicateKey {
    /// Parse a predicate key from a string.
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "path" => Some(PredicateKey::Path),
            "name" => Some(PredicateKey::Name),
            "ext" => Some(PredicateKey::Ext),
            "lang" => Some(PredicateKey::Lang),
            "kind" => Some(PredicateKey::Kind),
            "size" => Some(PredicateKey::Size),
            "contains" => Some(PredicateKey::Contains),
            "regex" => Some(PredicateKey::Regex),
            "mtime" => Some(PredicateKey::Mtime),
            "git_status" => Some(PredicateKey::GitStatus),
            "git_tracked" => Some(PredicateKey::GitTracked),
            "git_ignored" => Some(PredicateKey::GitIgnored),
            "git_stage" => Some(PredicateKey::GitStage),
            _ => None,
        }
    }

    /// Returns true if this predicate requires file content access.
    pub fn requires_content(&self) -> bool {
        matches!(self, PredicateKey::Contains | PredicateKey::Regex)
    }

    /// Returns true if this predicate requires git state.
    pub fn requires_git(&self) -> bool {
        matches!(
            self,
            PredicateKey::GitStatus
                | PredicateKey::GitTracked
                | PredicateKey::GitIgnored
                | PredicateKey::GitStage
        )
    }

    /// Returns true if this predicate requires file metadata.
    pub fn requires_metadata(&self) -> bool {
        matches!(
            self,
            PredicateKey::Kind | PredicateKey::Size | PredicateKey::Mtime
        )
    }
}

/// Predicate comparison operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredicateOp {
    /// Glob pattern match (`:` operator).
    Glob,
    /// Equality (`=` operator).
    Eq,
    /// Inequality (`!=` operator).
    Neq,
    /// Greater than (`>` operator).
    Gt,
    /// Greater than or equal (`>=` operator).
    Gte,
    /// Less than (`<` operator).
    Lt,
    /// Less than or equal (`<=` operator).
    Lte,
    /// Regex match (`~` operator).
    Match,
}

impl PredicateOp {
    /// Parse an operator from a string.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            ":" => Some(PredicateOp::Glob),
            "=" => Some(PredicateOp::Eq),
            "!=" => Some(PredicateOp::Neq),
            ">" => Some(PredicateOp::Gt),
            ">=" => Some(PredicateOp::Gte),
            "<" => Some(PredicateOp::Lt),
            "<=" => Some(PredicateOp::Lte),
            "~" => Some(PredicateOp::Match),
            _ => None,
        }
    }
}

/// A single filter predicate with key, operator, and value.
#[derive(Debug, Clone)]
pub struct FilterPredicate {
    /// The property to test.
    pub key: PredicateKey,
    /// The comparison operator.
    pub op: PredicateOp,
    /// The value to compare against.
    pub value: String,
}

/// Content availability for predicate evaluation.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ContentAccess<'a> {
    /// Content access is disabled (no --filter-content flag).
    Disabled,
    /// Content is unavailable (e.g., exceeds max bytes).
    Unavailable,
    /// Content is available.
    Available(&'a str),
}

impl FilterPredicate {
    /// Create a new predicate.
    pub fn new(key: PredicateKey, op: PredicateOp, value: impl Into<String>) -> Self {
        Self {
            key,
            op,
            value: value.into(),
        }
    }

    /// Returns true if this predicate requires file content access.
    pub fn requires_content(&self) -> bool {
        self.key.requires_content()
    }

    /// Returns true if this predicate requires git state.
    pub fn requires_git(&self) -> bool {
        self.key.requires_git()
    }

    /// Returns true if this predicate requires file metadata.
    pub fn requires_metadata(&self) -> bool {
        self.key.requires_metadata()
    }

    /// Evaluate this predicate with explicit content access semantics.
    ///
    /// Returns `Ok(None)` when content is unavailable and the predicate requires content.
    pub(crate) fn evaluate_with_content_access(
        &self,
        path: &Path,
        metadata: Option<&Metadata>,
        git_state: Option<&GitState>,
        content: ContentAccess<'_>,
    ) -> Result<Option<bool>, PredicateError> {
        match self.key {
            PredicateKey::Contains => match content {
                ContentAccess::Available(value) => self.evaluate_contains(Some(value)).map(Some),
                ContentAccess::Unavailable => Ok(None),
                ContentAccess::Disabled => Err(PredicateError::ContentPredicateWithoutFlag {
                    predicate: "contains".to_string(),
                }),
            },
            PredicateKey::Regex => match content {
                ContentAccess::Available(value) => self.evaluate_regex(Some(value)).map(Some),
                ContentAccess::Unavailable => Ok(None),
                ContentAccess::Disabled => Err(PredicateError::ContentPredicateWithoutFlag {
                    predicate: "regex".to_string(),
                }),
            },
            _ => self.evaluate(path, metadata, git_state, None).map(Some),
        }
    }

    /// Evaluate this predicate against a file.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file (relative to workspace root)
    /// * `metadata` - Optional file metadata for size checks
    /// * `git_state` - Optional git state for git predicates
    /// * `content` - Optional file content for content predicates
    ///
    /// # Returns
    ///
    /// * `Ok(true)` - The predicate matches
    /// * `Ok(false)` - The predicate does not match
    /// * `Err(PredicateError)` - Evaluation error
    pub fn evaluate(
        &self,
        path: &Path,
        metadata: Option<&Metadata>,
        git_state: Option<&GitState>,
        content: Option<&str>,
    ) -> Result<bool, PredicateError> {
        match self.key {
            PredicateKey::Path => self.evaluate_path_glob(path),
            PredicateKey::Name => self.evaluate_name_glob(path),
            PredicateKey::Ext => self.evaluate_ext(path),
            PredicateKey::Lang => self.evaluate_lang(path),
            PredicateKey::Kind => self.evaluate_kind(path, metadata),
            PredicateKey::Size => self.evaluate_size(metadata),
            PredicateKey::Contains => self.evaluate_contains(content),
            PredicateKey::Regex => self.evaluate_regex(content),
            PredicateKey::Mtime => self.evaluate_mtime(metadata),
            PredicateKey::GitStatus => self.evaluate_git_status(path, git_state),
            PredicateKey::GitTracked => self.evaluate_git_tracked(path, git_state),
            PredicateKey::GitIgnored => self.evaluate_git_ignored(path, git_state),
            PredicateKey::GitStage => self.evaluate_git_stage(path, git_state),
        }
    }

    fn evaluate_path_glob(&self, path: &Path) -> Result<bool, PredicateError> {
        let glob = Glob::new(&self.value).map_err(|e| PredicateError::InvalidPattern {
            pattern: self.value.clone(),
            message: e.to_string(),
        })?;
        let matcher = glob.compile_matcher();
        let matches = matcher.is_match(path);
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_name_glob(&self, path: &Path) -> Result<bool, PredicateError> {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();

        let glob = Glob::new(&self.value).map_err(|e| PredicateError::InvalidPattern {
            pattern: self.value.clone(),
            message: e.to_string(),
        })?;
        let matcher = glob.compile_matcher();
        let matches = matcher.is_match(name);
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_ext(&self, path: &Path) -> Result<bool, PredicateError> {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let expected = self.value.trim_start_matches('.');
        Ok(apply_op_str(self.op, ext, expected))
    }

    fn evaluate_lang(&self, path: &Path) -> Result<bool, PredicateError> {
        // Map extensions to language tags
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = match ext {
            "py" | "pyi" => "python",
            "rs" => "rust",
            "js" | "mjs" | "cjs" => "javascript",
            "ts" | "mts" | "cts" => "typescript",
            "go" => "go",
            "java" => "java",
            "c" | "h" => "c",
            "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "cpp",
            "rb" => "ruby",
            _ => "",
        };
        Ok(apply_op_str(self.op, lang, &self.value.to_lowercase()))
    }

    fn evaluate_kind(
        &self,
        _path: &Path,
        metadata: Option<&Metadata>,
    ) -> Result<bool, PredicateError> {
        let is_dir = metadata.is_some_and(|m| m.is_dir());
        let expected_dir = self.value.to_lowercase() == "dir";
        let matches = is_dir == expected_dir;
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_size(&self, metadata: Option<&Metadata>) -> Result<bool, PredicateError> {
        let size = metadata.map(|m| m.len()).unwrap_or(0);
        let target = parse_size(&self.value)?;
        Ok(apply_op_numeric(self.op, size, target))
    }

    fn evaluate_mtime(&self, metadata: Option<&Metadata>) -> Result<bool, PredicateError> {
        let metadata = match metadata {
            Some(m) => m,
            None => return Ok(false),
        };

        let modified = metadata
            .modified()
            .map_err(|e| PredicateError::InvalidValue {
                key: "mtime".to_string(),
                value: self.value.clone(),
                message: e.to_string(),
            })?;

        let modified_dt: chrono::DateTime<chrono::Utc> = modified.into();
        let actual = modified_dt.timestamp_millis();
        let expected = parse_mtime_value(&self.value)?;

        Ok(apply_op_numeric_i64(self.op, actual, expected))
    }

    fn evaluate_contains(&self, content: Option<&str>) -> Result<bool, PredicateError> {
        let content = content.ok_or_else(|| PredicateError::ContentPredicateWithoutFlag {
            predicate: "contains".to_string(),
        })?;
        let matches = content.contains(&self.value);
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_regex(&self, content: Option<&str>) -> Result<bool, PredicateError> {
        let content = content.ok_or_else(|| PredicateError::ContentPredicateWithoutFlag {
            predicate: "regex".to_string(),
        })?;
        let re = regex::Regex::new(&self.value).map_err(|e| PredicateError::InvalidPattern {
            pattern: self.value.clone(),
            message: e.to_string(),
        })?;
        let matches = re.is_match(content);
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_git_status(
        &self,
        path: &Path,
        git_state: Option<&GitState>,
    ) -> Result<bool, PredicateError> {
        // "any" always returns true
        if self.value.to_lowercase() == "any" {
            return Ok(true);
        }

        let git_state = match git_state {
            Some(s) => s,
            None => return Ok(false), // No git repo, predicate fails
        };

        let path_str = path.to_string_lossy();
        let status = git_state.status.get(path_str.as_ref());

        let matches = match self.value.to_lowercase().as_str() {
            "modified" => status.is_some_and(|s| s.index == 'M' || s.worktree == 'M'),
            "added" => status.is_some_and(|s| s.index == 'A'),
            "deleted" => status.is_some_and(|s| s.index == 'D' || s.worktree == 'D'),
            "renamed" => status.is_some_and(|s| s.index == 'R'),
            "untracked" => status.is_some_and(|s| s.index == '?' && s.worktree == '?'),
            "conflicted" => status.is_some_and(|s| s.index == 'U' || s.worktree == 'U'),
            _ => false,
        };

        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_git_tracked(
        &self,
        path: &Path,
        git_state: Option<&GitState>,
    ) -> Result<bool, PredicateError> {
        // "any" always returns true
        if self.value.to_lowercase() == "any" {
            return Ok(true);
        }

        let git_state = match git_state {
            Some(s) => s,
            None => return Ok(false), // No git repo, predicate fails
        };

        let path_str = path.to_string_lossy();
        let status = git_state.status.get(path_str.as_ref());

        // A file is tracked if it's not untracked (not `??`)
        // Files not in status output are tracked (clean files)
        let is_tracked = match status {
            Some(s) => !(s.index == '?' && s.worktree == '?'),
            None => git_state.tracked_files.contains(path_str.as_ref()),
        };

        let expected = self.value.to_lowercase() == "true";
        let matches = is_tracked == expected;
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_git_ignored(
        &self,
        path: &Path,
        git_state: Option<&GitState>,
    ) -> Result<bool, PredicateError> {
        // "any" always returns true
        if self.value.to_lowercase() == "any" {
            return Ok(true);
        }

        let git_state = match git_state {
            Some(s) => s,
            None => return Ok(false), // No git repo, predicate fails
        };

        let path_str = path.to_string_lossy();
        let is_ignored = git_state.ignored_files.contains(path_str.as_ref());

        let expected = self.value.to_lowercase() == "true";
        let matches = is_ignored == expected;
        Ok(apply_op_bool(self.op, matches))
    }

    fn evaluate_git_stage(
        &self,
        path: &Path,
        git_state: Option<&GitState>,
    ) -> Result<bool, PredicateError> {
        // "any" always returns true
        if self.value.to_lowercase() == "any" {
            return Ok(true);
        }

        let git_state = match git_state {
            Some(s) => s,
            None => return Ok(false), // No git repo, predicate fails
        };

        let path_str = path.to_string_lossy();
        let status = git_state.status.get(path_str.as_ref());

        let matches = match self.value.to_lowercase().as_str() {
            "staged" => status.is_some_and(|s| s.index != ' ' && s.index != '?'),
            "unstaged" => status.is_some_and(|s| s.worktree != ' ' && s.worktree != '?'),
            _ => false,
        };

        Ok(apply_op_bool(self.op, matches))
    }
}

/// Apply operator to boolean match result.
fn apply_op_bool(op: PredicateOp, matches: bool) -> bool {
    match op {
        PredicateOp::Glob | PredicateOp::Eq | PredicateOp::Match => matches,
        PredicateOp::Neq => !matches,
        // For boolean predicates, comparison operators treat true as 1, false as 0
        PredicateOp::Gt => matches, // true > false
        PredicateOp::Gte => matches,
        PredicateOp::Lt => !matches,
        PredicateOp::Lte => !matches,
    }
}

/// Apply operator to string comparison.
fn apply_op_str(op: PredicateOp, actual: &str, expected: &str) -> bool {
    match op {
        PredicateOp::Glob | PredicateOp::Eq | PredicateOp::Match => {
            actual.eq_ignore_ascii_case(expected)
        }
        PredicateOp::Neq => !actual.eq_ignore_ascii_case(expected),
        PredicateOp::Gt => actual > expected,
        PredicateOp::Gte => actual >= expected,
        PredicateOp::Lt => actual < expected,
        PredicateOp::Lte => actual <= expected,
    }
}

/// Apply operator to numeric comparison.
fn apply_op_numeric(op: PredicateOp, actual: u64, expected: u64) -> bool {
    match op {
        PredicateOp::Glob | PredicateOp::Eq | PredicateOp::Match => actual == expected,
        PredicateOp::Neq => actual != expected,
        PredicateOp::Gt => actual > expected,
        PredicateOp::Gte => actual >= expected,
        PredicateOp::Lt => actual < expected,
        PredicateOp::Lte => actual <= expected,
    }
}

fn apply_op_numeric_i64(op: PredicateOp, actual: i64, expected: i64) -> bool {
    match op {
        PredicateOp::Glob | PredicateOp::Eq | PredicateOp::Match => actual == expected,
        PredicateOp::Neq => actual != expected,
        PredicateOp::Gt => actual > expected,
        PredicateOp::Gte => actual >= expected,
        PredicateOp::Lt => actual < expected,
        PredicateOp::Lte => actual <= expected,
    }
}

/// Parse a size value with optional suffix (k/K, m/M, g/G).
///
/// Examples:
/// - "1024" -> 1024
/// - "10k" -> 10240
/// - "5M" -> 5242880
/// - "1g" -> 1073741824
pub fn parse_size(value: &str) -> Result<u64, PredicateError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(PredicateError::InvalidSize {
            value: value.to_string(),
            message: "empty size value".to_string(),
        });
    }

    let (num_str, multiplier) = if let Some(num) = value.strip_suffix(['k', 'K']) {
        (num, 1024u64)
    } else if let Some(num) = value.strip_suffix(['m', 'M']) {
        (num, 1024 * 1024)
    } else if let Some(num) = value.strip_suffix(['g', 'G']) {
        (num, 1024 * 1024 * 1024)
    } else {
        (value, 1u64)
    };

    let num: u64 = num_str.parse().map_err(|_| PredicateError::InvalidSize {
        value: value.to_string(),
        message: format!("cannot parse '{}' as number", num_str),
    })?;

    Ok(num * multiplier)
}

/// Parse a modified time value (RFC3339 or YYYY-MM-DD) to milliseconds since epoch.
fn parse_mtime_value(value: &str) -> Result<i64, PredicateError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(PredicateError::InvalidValue {
            key: "mtime".to_string(),
            value: value.to_string(),
            message: "empty mtime value".to_string(),
        });
    }

    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Ok(dt.timestamp_millis());
    }

    if let Ok(date_time) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S") {
        let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(date_time, chrono::Utc);
        return Ok(dt.timestamp_millis());
    }

    if let Ok(date) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let date_time = date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| PredicateError::InvalidValue {
                key: "mtime".to_string(),
                value: value.to_string(),
                message: "invalid date value".to_string(),
            })?;
        let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(date_time, chrono::Utc);
        return Ok(dt.timestamp_millis());
    }

    Err(PredicateError::InvalidValue {
        key: "mtime".to_string(),
        value: value.to_string(),
        message: "expected RFC3339 or YYYY-MM-DD".to_string(),
    })
}

/// Git file status from porcelain output.
#[derive(Debug, Clone)]
pub struct GitFileStatus {
    /// Index (staging area) status character.
    pub index: char,
    /// Worktree status character.
    pub worktree: char,
}

/// Git state for a workspace, parsed from `git status --porcelain=v1 -z`.
#[derive(Debug, Clone)]
pub struct GitState {
    /// File status by path.
    pub status: HashMap<String, GitFileStatus>,
    /// Set of tracked files (from git ls-files).
    pub tracked_files: std::collections::HashSet<String>,
    /// Set of ignored files (from git check-ignore).
    pub ignored_files: std::collections::HashSet<String>,
}

impl GitState {
    /// Load git state for a workspace.
    ///
    /// Returns `None` if no `.git` directory is found or git commands fail.
    pub fn load(workspace: &Path) -> Option<Self> {
        // Check if .git directory exists
        if !workspace.join(".git").exists() {
            return None;
        }

        let mut state = GitState {
            status: HashMap::new(),
            tracked_files: std::collections::HashSet::new(),
            ignored_files: std::collections::HashSet::new(),
        };

        // Get status from `git status --porcelain=v1 -z`
        if let Ok(output) = Command::new("git")
            .args(["status", "--porcelain=v1", "-z"])
            .current_dir(workspace)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                state.parse_status_output(&stdout);
            }
        }

        // Get tracked files from `git ls-files -z`
        if let Ok(output) = Command::new("git")
            .args(["ls-files", "-z"])
            .current_dir(workspace)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for file in stdout.split('\0') {
                    if !file.is_empty() {
                        state.tracked_files.insert(file.to_string());
                    }
                }
            }
        }

        // Get ignored files from `git status --porcelain=v1 -z --ignored`
        if let Ok(output) = Command::new("git")
            .args(["status", "--porcelain=v1", "-z", "--ignored"])
            .current_dir(workspace)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for entry in stdout.split('\0') {
                    if let Some(path) = entry.strip_prefix("!! ") {
                        state.ignored_files.insert(path.to_string());
                    }
                }
            }
        }

        Some(state)
    }

    /// Parse `git status --porcelain=v1 -z` output.
    fn parse_status_output(&mut self, output: &str) {
        for entry in output.split('\0') {
            if entry.len() < 4 {
                continue;
            }

            let chars: Vec<char> = entry.chars().collect();
            let index = chars[0];
            let worktree = chars[1];
            // chars[2] is space
            let path = &entry[3..];

            // Handle renamed files (format: "R  old -> new")
            let path = if index == 'R' || worktree == 'R' {
                if let Some(arrow_pos) = path.find(" -> ") {
                    &path[arrow_pos + 4..]
                } else {
                    path
                }
            } else {
                path
            };

            if !path.is_empty() {
                self.status
                    .insert(path.to_string(), GitFileStatus { index, worktree });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    // =========================================================================
    // Path Glob Tests
    // =========================================================================

    #[test]
    fn test_predicate_path_glob_match() {
        let pred = FilterPredicate::new(PredicateKey::Path, PredicateOp::Glob, "src/**/*.py");
        assert!(pred
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap());
        assert!(pred
            .evaluate(Path::new("src/lib/utils.py"), None, None, None)
            .unwrap());
    }

    #[test]
    fn test_predicate_path_glob_no_match() {
        let pred = FilterPredicate::new(PredicateKey::Path, PredicateOp::Glob, "src/**/*.py");
        assert!(!pred
            .evaluate(Path::new("tests/test_main.py"), None, None, None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("src/main.rs"), None, None, None)
            .unwrap());
    }

    // =========================================================================
    // Name Glob Tests
    // =========================================================================

    #[test]
    fn test_predicate_name_glob() {
        let pred = FilterPredicate::new(PredicateKey::Name, PredicateOp::Glob, "*_test.py");
        assert!(pred
            .evaluate(Path::new("src/foo_test.py"), None, None, None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("src/test_foo.py"), None, None, None)
            .unwrap());
    }

    // =========================================================================
    // Extension Tests
    // =========================================================================

    #[test]
    fn test_predicate_ext_eq() {
        let pred = FilterPredicate::new(PredicateKey::Ext, PredicateOp::Eq, "py");
        assert!(pred
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("src/main.rs"), None, None, None)
            .unwrap());
    }

    #[test]
    fn test_predicate_ext_neq() {
        let pred = FilterPredicate::new(PredicateKey::Ext, PredicateOp::Neq, "py");
        assert!(!pred
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap());
        assert!(pred
            .evaluate(Path::new("src/main.rs"), None, None, None)
            .unwrap());
    }

    // =========================================================================
    // Size Tests
    // =========================================================================

    #[test]
    fn test_predicate_size_gt() {
        // Create a mock metadata-like test using a real file
        let pred = FilterPredicate::new(PredicateKey::Size, PredicateOp::Gt, "100");
        // Without metadata, size is 0
        assert!(!pred
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap());
    }

    #[test]
    fn test_predicate_size_lte() {
        let pred = FilterPredicate::new(PredicateKey::Size, PredicateOp::Lte, "1000");
        // Without metadata, size is 0, which is <= 1000
        assert!(pred
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap());
    }

    #[test]
    fn test_predicate_size_suffixes_k_m_g() {
        assert_eq!(parse_size("10").unwrap(), 10);
        assert_eq!(parse_size("10k").unwrap(), 10 * 1024);
        assert_eq!(parse_size("10K").unwrap(), 10 * 1024);
        assert_eq!(parse_size("5m").unwrap(), 5 * 1024 * 1024);
        assert_eq!(parse_size("5M").unwrap(), 5 * 1024 * 1024);
        assert_eq!(parse_size("2g").unwrap(), 2 * 1024 * 1024 * 1024);
        assert_eq!(parse_size("2G").unwrap(), 2 * 1024 * 1024 * 1024);
    }

    // =========================================================================
    // Modified Time Tests
    // =========================================================================

    #[test]
    fn test_predicate_mtime_comparisons() {
        let file = NamedTempFile::new().unwrap();
        let metadata = file.as_file().metadata().unwrap();

        let pred_gt = FilterPredicate::new(PredicateKey::Mtime, PredicateOp::Gt, "1970-01-01");
        assert!(pred_gt
            .evaluate(file.path(), Some(&metadata), None, None)
            .unwrap());

        let pred_lt = FilterPredicate::new(PredicateKey::Mtime, PredicateOp::Lt, "2999-01-01");
        assert!(pred_lt
            .evaluate(file.path(), Some(&metadata), None, None)
            .unwrap());
    }

    // =========================================================================
    // Content Predicate Tests
    // =========================================================================

    #[test]
    fn test_predicate_requires_content_contains() {
        let pred = FilterPredicate::new(PredicateKey::Contains, PredicateOp::Glob, "TODO");
        assert!(pred.requires_content());
    }

    #[test]
    fn test_predicate_requires_content_regex() {
        let pred = FilterPredicate::new(PredicateKey::Regex, PredicateOp::Match, "TODO.*");
        assert!(pred.requires_content());
    }

    #[test]
    fn test_predicate_requires_content_path_false() {
        let pred = FilterPredicate::new(PredicateKey::Path, PredicateOp::Glob, "src/**");
        assert!(!pred.requires_content());
    }

    // =========================================================================
    // Git Predicate Tests
    // =========================================================================

    fn make_test_git_state() -> GitState {
        let mut state = GitState {
            status: HashMap::new(),
            tracked_files: std::collections::HashSet::new(),
            ignored_files: std::collections::HashSet::new(),
        };

        // Add some test status entries
        state.status.insert(
            "modified.py".to_string(),
            GitFileStatus {
                index: ' ',
                worktree: 'M',
            },
        );
        state.status.insert(
            "staged.py".to_string(),
            GitFileStatus {
                index: 'M',
                worktree: ' ',
            },
        );
        state.status.insert(
            "untracked.py".to_string(),
            GitFileStatus {
                index: '?',
                worktree: '?',
            },
        );

        // Add tracked files
        state.tracked_files.insert("tracked.py".to_string());
        state.tracked_files.insert("modified.py".to_string());
        state.tracked_files.insert("staged.py".to_string());

        // Add ignored files
        state.ignored_files.insert("ignored.py".to_string());

        state
    }

    #[test]
    fn test_predicate_git_tracked_true() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitTracked, PredicateOp::Eq, "true");
        assert!(pred
            .evaluate(Path::new("tracked.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_tracked_false() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitTracked, PredicateOp::Eq, "false");
        assert!(pred
            .evaluate(Path::new("untracked.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_status_modified() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitStatus, PredicateOp::Eq, "modified");
        assert!(pred
            .evaluate(Path::new("modified.py"), None, Some(&git_state), None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("tracked.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_status_untracked() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitStatus, PredicateOp::Eq, "untracked");
        assert!(pred
            .evaluate(Path::new("untracked.py"), None, Some(&git_state), None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("tracked.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_stage_staged() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitStage, PredicateOp::Eq, "staged");
        assert!(pred
            .evaluate(Path::new("staged.py"), None, Some(&git_state), None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("modified.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_ignored() {
        let git_state = make_test_git_state();
        let pred = FilterPredicate::new(PredicateKey::GitIgnored, PredicateOp::Eq, "true");
        assert!(pred
            .evaluate(Path::new("ignored.py"), None, Some(&git_state), None)
            .unwrap());
        assert!(!pred
            .evaluate(Path::new("tracked.py"), None, Some(&git_state), None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_no_repo_returns_false() {
        let pred = FilterPredicate::new(PredicateKey::GitTracked, PredicateOp::Eq, "true");
        // No git state means no git repo
        assert!(!pred
            .evaluate(Path::new("file.py"), None, None, None)
            .unwrap());
    }

    #[test]
    fn test_predicate_git_any_always_true() {
        // Without git state
        let pred = FilterPredicate::new(PredicateKey::GitTracked, PredicateOp::Eq, "any");
        assert!(pred
            .evaluate(Path::new("file.py"), None, None, None)
            .unwrap());

        // With git state
        let git_state = make_test_git_state();
        assert!(pred
            .evaluate(Path::new("file.py"), None, Some(&git_state), None)
            .unwrap());
    }
}
