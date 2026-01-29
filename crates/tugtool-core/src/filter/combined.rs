//! Combined filter for unified file filtering.
//!
//! This module provides `CombinedFilter`, the primary entry point for file filtering
//! that unifies all filter sources: glob patterns, expression syntax, and JSON filters.
//!
//! ## Filter Combination Rules (Spec S10)
//!
//! 1. Start with language-appropriate file set
//! 2. Apply default exclusions
//! 3. Apply glob patterns (`-- <patterns...>`)
//! 4. Apply all `--filter` expressions (AND)
//! 5. Apply `--filter-json` (AND)
//! 6. Apply `--filter-file` content according to `--filter-file-format` (AND)
//!
//! All filter sources are combined with AND - a file must pass all filters to be included.

use std::fs::Metadata;
use std::path::Path;

use thiserror::Error;

use super::expr::{parse_filter_expr, ExprError, FilterExpr};
use super::glob::{FileFilterSpec, FilterError as GlobError};
use super::json::{parse_filter_json, JsonFilterError};
use super::predicate::{ContentAccess, GitState};

/// Error type for combined filter operations.
#[derive(Debug, Error)]
pub enum CombinedFilterError {
    /// Glob pattern error.
    #[error(transparent)]
    GlobError(#[from] GlobError),

    /// Expression parse error.
    #[error(transparent)]
    ExprError(#[from] ExprError),

    /// JSON filter error.
    #[error(transparent)]
    JsonError(#[from] JsonFilterError),

    /// Content predicate used without --filter-content flag.
    #[error("content predicate requires --filter-content flag")]
    ContentPredicateWithoutFlag,

    /// File metadata read error.
    #[error("failed to read file metadata: {0}")]
    MetadataReadError(String),

    /// File read error during content matching.
    #[error("failed to read file for content matching: {0}")]
    ContentReadError(String),
}

/// Size limit for binary detection (8KB as per plan spec).
const BINARY_DETECTION_BYTES: usize = 8 * 1024;

/// Read file content, returning None if the file appears to be binary.
///
/// Binary detection uses null-byte heuristic: if the first 8KB contains \x00,
/// the file is considered binary and skipped for content predicates.
fn read_text_content(path: &Path) -> Result<Option<String>, CombinedFilterError> {
    let bytes = std::fs::read(path)
        .map_err(|e| CombinedFilterError::ContentReadError(format!("{}: {}", path.display(), e)))?;

    // Check for null bytes in first 8KB (binary detection)
    let check_len = bytes.len().min(BINARY_DETECTION_BYTES);
    if bytes[..check_len].contains(&0) {
        return Ok(None); // Binary file
    }

    // Convert to string (skip non-UTF-8 content)
    match String::from_utf8(bytes) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

/// Combined filter that unifies all filter sources.
///
/// Use the builder pattern via `CombinedFilter::builder()` to construct.
#[derive(Debug)]
pub struct CombinedFilter {
    /// Glob-based filter specification (from `-- <patterns...>`).
    glob_spec: Option<FileFilterSpec>,
    /// Expression filters (from `--filter`), combined with AND.
    expressions: Vec<FilterExpr>,
    /// JSON filter (from `--filter-json`), converted to FilterExpr.
    json_filter: Option<FilterExpr>,
    /// Whether content predicates are enabled (from `--filter-content`).
    content_enabled: bool,
    /// Maximum file size for content predicates (from `--filter-content-max-bytes`).
    content_max_bytes: Option<u64>,
    /// Git state for git predicates (lazily loaded).
    git_state: Option<GitState>,
    /// Workspace root for git state loading.
    workspace_root: Option<std::path::PathBuf>,
    /// Whether git state has been loaded.
    git_state_loaded: bool,
}

/// Owned content access state for evaluation.
#[derive(Debug)]
enum ContentAccessOwned {
    Disabled,
    Unavailable,
    Available(String),
}

impl ContentAccessOwned {
    fn as_access(&self) -> ContentAccess<'_> {
        match self {
            ContentAccessOwned::Disabled => ContentAccess::Disabled,
            ContentAccessOwned::Unavailable => ContentAccess::Unavailable,
            ContentAccessOwned::Available(content) => ContentAccess::Available(content.as_str()),
        }
    }
}

impl CombinedFilter {
    /// Create a new builder for constructing a CombinedFilter.
    pub fn builder() -> CombinedFilterBuilder {
        CombinedFilterBuilder::new()
    }

    /// Check if a file matches all filter criteria.
    ///
    /// Applies filters in order per Spec S10:
    /// 1. Default exclusions (via glob_spec)
    /// 2. Glob patterns
    /// 3. Expression filters (AND'd)
    /// 4. JSON filter
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file (relative to workspace root)
    ///
    /// # Returns
    ///
    /// * `Ok(true)` - File passes all filters
    /// * `Ok(false)` - File fails at least one filter
    /// * `Err(CombinedFilterError)` - Error during evaluation
    pub fn matches(&mut self, path: &Path) -> Result<bool, CombinedFilterError> {
        let full_path = self.resolve_full_path(path);
        let metadata = if self.requires_metadata() {
            Some(std::fs::metadata(&full_path).map_err(|e| {
                CombinedFilterError::MetadataReadError(format!("{}: {}", full_path.display(), e))
            })?)
        } else {
            None
        };

        self.matches_with_metadata(path, metadata.as_ref())
    }

    /// Check if a file matches with optional metadata.
    pub fn matches_with_metadata(
        &mut self,
        path: &Path,
        metadata: Option<&Metadata>,
    ) -> Result<bool, CombinedFilterError> {
        let full_path = self.resolve_full_path(path);
        let metadata_owned = if metadata.is_none() && self.requires_metadata() {
            Some(std::fs::metadata(&full_path).map_err(|e| {
                CombinedFilterError::MetadataReadError(format!("{}: {}", full_path.display(), e))
            })?)
        } else {
            None
        };
        let metadata_ref = metadata.or(metadata_owned.as_ref());

        // 1. Check glob patterns (includes default exclusions)
        if let Some(ref glob_spec) = self.glob_spec {
            if !glob_spec.matches(path) {
                return Ok(false);
            }
        }

        // Load git state lazily if needed
        self.ensure_git_state_loaded();

        // Get content access state once if any expression needs it
        let content_access = self.get_content_access(path, &full_path, metadata_ref)?;

        // 2. Check expression filters (all must pass)
        for expr in &self.expressions {
            if expr.evaluate_with_content_access(
                path,
                metadata_ref,
                self.git_state.as_ref(),
                content_access.as_access(),
            )? != Some(true)
            {
                return Ok(false);
            }
        }

        // 3. Check JSON filter
        if let Some(ref json_filter) = self.json_filter {
            if json_filter.evaluate_with_content_access(
                path,
                metadata_ref,
                self.git_state.as_ref(),
                content_access.as_access(),
            )? != Some(true)
            {
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Returns true if any filter requires content access.
    pub fn requires_content(&self) -> bool {
        self.expressions.iter().any(|e| e.requires_content())
            || self
                .json_filter
                .as_ref()
                .is_some_and(|f| f.requires_content())
    }

    /// Returns true if any filter requires git state.
    pub fn requires_git(&self) -> bool {
        self.expressions.iter().any(|e| e.requires_git())
            || self.json_filter.as_ref().is_some_and(|f| f.requires_git())
    }

    /// Returns true if any filter requires file metadata.
    fn requires_metadata(&self) -> bool {
        self.expressions.iter().any(|e| e.requires_metadata())
            || self
                .json_filter
                .as_ref()
                .is_some_and(|f| f.requires_metadata())
            || self.content_max_bytes.is_some()
    }

    /// Load git state lazily if any expression requires it.
    fn ensure_git_state_loaded(&mut self) {
        if self.git_state_loaded {
            return;
        }
        self.git_state_loaded = true;

        if self.requires_git() {
            if let Some(ref root) = self.workspace_root {
                self.git_state = GitState::load(root);
            }
        }
    }

    /// Get file content if any filter requires it.
    fn get_content_access(
        &mut self,
        _path: &Path,
        full_path: &Path,
        metadata: Option<&Metadata>,
    ) -> Result<ContentAccessOwned, CombinedFilterError> {
        // Check if any expression or json filter requires content
        let needs_content = self.expressions.iter().any(|e| e.requires_content())
            || self
                .json_filter
                .as_ref()
                .is_some_and(|f| f.requires_content());

        if !needs_content {
            return Ok(ContentAccessOwned::Disabled);
        }

        if !self.content_enabled {
            return Err(CombinedFilterError::ContentPredicateWithoutFlag);
        }

        // Check file size limit if set
        if let Some(max_bytes) = self.content_max_bytes {
            let metadata = if let Some(m) = metadata {
                m
            } else {
                &std::fs::metadata(full_path).map_err(|e| {
                    CombinedFilterError::MetadataReadError(format!(
                        "{}: {}",
                        full_path.display(),
                        e
                    ))
                })?
            };

            if metadata.len() > max_bytes {
                // File too large - treat content predicates as unknown (no match).
                return Ok(ContentAccessOwned::Unavailable);
            }
        }

        // Read content with binary detection (null-byte heuristic in first 8KB)
        match read_text_content(full_path)? {
            Some(content) => Ok(ContentAccessOwned::Available(content)),
            None => Ok(ContentAccessOwned::Unavailable), // Binary file, skip
        }
    }

    /// Resolve the full path for content and metadata access.
    fn resolve_full_path(&self, path: &Path) -> std::path::PathBuf {
        if path.is_absolute() {
            return path.to_path_buf();
        }
        if let Some(ref root) = self.workspace_root {
            return root.join(path);
        }
        path.to_path_buf()
    }
}

/// Builder for constructing a CombinedFilter.
#[derive(Default)]
pub struct CombinedFilterBuilder {
    glob_patterns: Vec<String>,
    expressions: Vec<FilterExpr>,
    json_filter: Option<FilterExpr>,
    content_enabled: bool,
    content_max_bytes: Option<u64>,
    workspace_root: Option<std::path::PathBuf>,
}

impl CombinedFilterBuilder {
    /// Create a new builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add glob patterns (from CLI `-- <patterns...>`).
    pub fn with_glob_patterns(mut self, patterns: &[String]) -> Result<Self, CombinedFilterError> {
        self.glob_patterns.extend(patterns.iter().cloned());
        Ok(self)
    }

    /// Add an expression filter (from CLI `--filter`).
    pub fn with_expression(mut self, expr: &str) -> Result<Self, CombinedFilterError> {
        let parsed = parse_filter_expr(expr)?;
        self.expressions.push(parsed);
        Ok(self)
    }

    /// Set the JSON filter (from CLI `--filter-json`).
    pub fn with_json(mut self, json: &str) -> Result<Self, CombinedFilterError> {
        let parsed = parse_filter_json(json)?;
        self.json_filter = Some(parsed);
        Ok(self)
    }

    /// Enable or disable content predicates.
    pub fn with_content_enabled(mut self, enabled: bool) -> Self {
        self.content_enabled = enabled;
        self
    }

    /// Set maximum file size for content predicates.
    ///
    /// Files larger than this limit are skipped for content matching.
    pub fn with_content_max_bytes(mut self, max_bytes: Option<u64>) -> Self {
        self.content_max_bytes = max_bytes;
        self
    }

    /// Set the workspace root for git state loading.
    pub fn with_workspace_root(mut self, root: impl Into<std::path::PathBuf>) -> Self {
        self.workspace_root = Some(root.into());
        self
    }

    /// Build the CombinedFilter.
    ///
    /// Validates that content predicates are only used when content is enabled.
    pub fn build(self) -> Result<CombinedFilter, CombinedFilterError> {
        // Parse glob patterns
        let glob_spec = if self.glob_patterns.is_empty() {
            // No glob patterns - use default filter (all files, with default exclusions)
            Some(FileFilterSpec::default_all()?)
        } else {
            FileFilterSpec::parse(&self.glob_patterns)?
        };

        // Validate: content predicates require content_enabled
        if !self.content_enabled {
            for expr in &self.expressions {
                if expr.requires_content() {
                    return Err(CombinedFilterError::ContentPredicateWithoutFlag);
                }
            }
            if let Some(ref json) = self.json_filter {
                if json.requires_content() {
                    return Err(CombinedFilterError::ContentPredicateWithoutFlag);
                }
            }
        }

        Ok(CombinedFilter {
            glob_spec,
            expressions: self.expressions,
            json_filter: self.json_filter,
            content_enabled: self.content_enabled,
            content_max_bytes: self.content_max_bytes,
            git_state: None,
            workspace_root: self.workspace_root,
            git_state_loaded: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};

    fn create_temp_file(content: &str) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file.flush().unwrap();
        file
    }

    // =========================================================================
    // Glob-Only Tests
    // =========================================================================

    #[test]
    fn test_combined_glob_only() {
        let mut filter = CombinedFilter::builder()
            .with_glob_patterns(&["src/**/*.py".to_string()])
            .unwrap()
            .build()
            .unwrap();

        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(filter.matches(Path::new("src/lib/utils.py")).unwrap());
        assert!(!filter.matches(Path::new("tests/test_main.py")).unwrap());
    }

    // =========================================================================
    // Expression-Only Tests
    // =========================================================================

    #[test]
    fn test_combined_expr_only() {
        let mut filter = CombinedFilter::builder()
            .with_expression("ext:py")
            .unwrap()
            .build()
            .unwrap();

        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(filter.matches(Path::new("tests/test.py")).unwrap());
        assert!(!filter.matches(Path::new("src/main.rs")).unwrap());
    }

    // =========================================================================
    // JSON-Only Tests
    // =========================================================================

    #[test]
    fn test_combined_json_only() {
        let mut filter = CombinedFilter::builder()
            .with_json(r#"{"predicates":[{"key":"ext","op":"eq","value":"py"}]}"#)
            .unwrap()
            .build()
            .unwrap();

        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(!filter.matches(Path::new("src/main.rs")).unwrap());
    }

    // =========================================================================
    // Combined Tests
    // =========================================================================

    #[test]
    fn test_combined_glob_and_expr() {
        let mut filter = CombinedFilter::builder()
            .with_glob_patterns(&["src/**".to_string()])
            .unwrap()
            .with_expression("ext:py")
            .unwrap()
            .build()
            .unwrap();

        // Must match both: in src/** AND ext:py
        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(!filter.matches(Path::new("src/main.rs")).unwrap()); // wrong ext
        assert!(!filter.matches(Path::new("tests/test.py")).unwrap()); // wrong path
    }

    #[test]
    fn test_combined_all_sources_and() {
        let mut filter = CombinedFilter::builder()
            .with_glob_patterns(&["src/**".to_string()])
            .unwrap()
            .with_expression("ext:py")
            .unwrap()
            .with_json(r#"{"predicates":[{"key":"name","op":"glob","value":"main*"}]}"#)
            .unwrap()
            .build()
            .unwrap();

        // Must match all: src/**, ext:py, name:main*
        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(!filter.matches(Path::new("src/utils.py")).unwrap()); // name doesn't match
        assert!(!filter.matches(Path::new("src/main.rs")).unwrap()); // ext doesn't match
    }

    // =========================================================================
    // Content Predicate Tests
    // =========================================================================

    #[test]
    fn test_combined_content_without_flag_error() {
        let result = CombinedFilter::builder()
            .with_expression("contains:TODO")
            .unwrap()
            .build();

        match result {
            Err(CombinedFilterError::ContentPredicateWithoutFlag) => {}
            _ => panic!("expected ContentPredicateWithoutFlag, got {:?}", result),
        }
    }

    #[test]
    fn test_combined_content_with_flag_ok() {
        let file = create_temp_file("# TODO: fix this\ndef main(): pass");

        let mut filter = CombinedFilter::builder()
            .with_expression("contains:TODO")
            .unwrap()
            .with_content_enabled(true)
            .build()
            .unwrap();

        assert!(filter.matches(file.path()).unwrap());
    }

    #[test]
    fn test_combined_content_max_bytes_skips_large_file() {
        let file = create_temp_file("0123456789"); // 10 bytes

        let mut filter = CombinedFilter::builder()
            .with_expression("contains:123")
            .unwrap()
            .with_content_enabled(true)
            .with_content_max_bytes(Some(4))
            .build()
            .unwrap();

        assert!(!filter.matches(file.path()).unwrap());
    }

    #[test]
    fn test_combined_content_skips_binary_file() {
        // Create a file with null bytes (binary)
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"hello\x00world").unwrap(); // Contains null byte
        file.flush().unwrap();

        let mut filter = CombinedFilter::builder()
            .with_expression("contains:hello")
            .unwrap()
            .with_content_enabled(true)
            .build()
            .unwrap();

        // Binary file should be skipped (treated as no match)
        assert!(!filter.matches(file.path()).unwrap());
    }

    #[test]
    fn test_combined_content_matches_text_file() {
        // Create a text file without null bytes
        let file = create_temp_file("hello world");

        let mut filter = CombinedFilter::builder()
            .with_expression("contains:hello")
            .unwrap()
            .with_content_enabled(true)
            .build()
            .unwrap();

        // Text file should match
        assert!(filter.matches(file.path()).unwrap());
    }

    #[test]
    fn test_combined_size_predicate_with_workspace_root() {
        let temp = TempDir::new().unwrap();
        let src_dir = temp.path().join("src");
        std::fs::create_dir_all(&src_dir).unwrap();
        let file_path = src_dir.join("main.py");
        std::fs::write(&file_path, "hello").unwrap();

        let mut filter = CombinedFilter::builder()
            .with_expression("size>1")
            .unwrap()
            .with_workspace_root(temp.path())
            .build()
            .unwrap();

        assert!(filter.matches(Path::new("src/main.py")).unwrap());
    }

    // =========================================================================
    // Empty Filter Tests
    // =========================================================================

    #[test]
    fn test_combined_empty_is_all_files() {
        let mut filter = CombinedFilter::builder().build().unwrap();

        // Should match any file (that's not in default exclusions)
        assert!(filter.matches(Path::new("src/main.py")).unwrap());
        assert!(filter.matches(Path::new("tests/test.py")).unwrap());
        assert!(filter.matches(Path::new("lib/utils.rs")).unwrap());
    }

    // =========================================================================
    // Default Exclusions Tests
    // =========================================================================

    #[test]
    fn test_combined_default_exclusions_always_apply() {
        let mut filter = CombinedFilter::builder().build().unwrap();

        // Default exclusions should always be applied
        assert!(!filter.matches(Path::new(".git/config")).unwrap());
        assert!(!filter
            .matches(Path::new("src/__pycache__/module.pyc"))
            .unwrap());
        assert!(!filter
            .matches(Path::new("venv/lib/python3.11/site.py"))
            .unwrap());
        assert!(!filter.matches(Path::new(".venv/bin/python")).unwrap());
        assert!(!filter
            .matches(Path::new("node_modules/lodash/index.js"))
            .unwrap());
        assert!(!filter.matches(Path::new("target/debug/main")).unwrap());
    }
}
