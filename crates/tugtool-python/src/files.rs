//! Python file collection utilities.
//!
//! Provides workspace file discovery for Python refactoring operations.

use std::fs;
use std::io;
use std::path::Path;
use thiserror::Error;
use walkdir::WalkDir;

use tugtool_core::filter::FileFilterSpec;
use tugtool_core::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

// ============================================================================
// Error Types
// ============================================================================

/// Error type for file operations.
#[derive(Debug, Error)]
pub enum FileError {
    /// File not found.
    #[error("file not found: {path}")]
    NotFound { path: String },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
}

/// Result type for file operations.
pub type FileResult<T> = Result<T, FileError>;

// ============================================================================
// File Collection
// ============================================================================

/// Collect Python files by walking a directory.
///
/// Respects standard exclusion patterns: .git, __pycache__, venv, etc.
/// Returns a vector of (relative_path, content) tuples.
///
/// # Example
///
/// ```ignore
/// let files = collect_python_files(workspace_root)?;
/// for (path, content) in files {
///     println!("Found: {} ({} bytes)", path, content.len());
/// }
/// ```
pub fn collect_python_files(workspace_root: &Path) -> FileResult<Vec<(String, String)>> {
    collect_python_files_excluding(workspace_root, &[])
}

/// Collect Python files with optional filter specification.
///
/// This is the primary entry point for refactoring operations that support
/// gitignore-style file filtering via the CLI's `-- <patterns>` syntax.
///
/// # Arguments
///
/// * `workspace_root` - The workspace root directory
/// * `filter` - Optional filter specification. When `None`, all Python files are collected.
///
/// # Filter Behavior
///
/// When a filter is provided:
/// - If the filter has inclusion patterns, only files matching those patterns are included
/// - If the filter has exclusion patterns, matching files are excluded
/// - Default exclusions (`.git`, `__pycache__`, `venv`, etc.) always apply
///
/// When no filter is provided:
/// - All Python files are collected (respecting default exclusions)
///
/// # Example
///
/// ```ignore
/// use tugtool_core::filter::FileFilterSpec;
///
/// // No filter - all Python files
/// let files = collect_python_files_filtered(workspace_root, None)?;
///
/// // With filter - only src/**/*.py, excluding tests
/// let filter = FileFilterSpec::parse(&[
///     "src/**/*.py".to_string(),
///     "!tests/**".to_string(),
/// ])?;
/// let files = collect_python_files_filtered(workspace_root, filter.as_ref())?;
/// ```
pub fn collect_python_files_filtered(
    workspace_root: &Path,
    filter: Option<&FileFilterSpec>,
) -> FileResult<Vec<(String, String)>> {
    let mut files = Vec::new();
    let default_spec = if filter.is_none() {
        Some(FileFilterSpec::default_all().map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidInput, format!("filter error: {}", e))
        })?)
    } else {
        None
    };

    for entry in WalkDir::new(workspace_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Get relative path first - we only want to filter on workspace-relative paths,
        // not the full system path (which may include temp directory names like .tmpXXX)
        let rel_path = match path.strip_prefix(workspace_root) {
            Ok(p) => p,
            Err(_) => continue, // Skip files outside workspace root
        };

        // Only consider Python files
        if path.extension().is_none_or(|ext| ext != "py") {
            continue;
        }

        // Apply filter if provided
        if let Some(spec) = filter {
            // FileFilterSpec.matches() handles default exclusions internally
            if !spec.matches(rel_path) {
                continue;
            }
        } else if let Some(spec) = &default_spec {
            // No user filter - apply default exclusions only
            if !spec.matches(rel_path) {
                continue;
            }
        }

        let rel_path_str = rel_path.to_string_lossy().to_string();
        let content = fs::read_to_string(path)?;
        files.push((rel_path_str, content));
    }

    // Sort files by path for deterministic ID assignment (Contract C8).
    files.sort_by(|(path_a, _), (path_b, _)| path_a.cmp(path_b));

    Ok(files)
}

/// Collect Python files, excluding paths matching any exclusion pattern.
///
/// This is the primary entry point for refactoring operations that need to exclude
/// test files from the refactoring scope.
///
/// # Exclusion Pattern Syntax
///
/// - `"tests/"` - Exclude any path containing a `tests` directory component
/// - `"test_*.py"` - Exclude files matching glob pattern (supports `*` wildcard)
/// - `"conftest.py"` - Exclude exact filename match in any directory
///
/// # Example
///
/// ```ignore
/// // Exclude test files from refactoring
/// let files = collect_python_files_excluding(
///     workspace_root,
///     &["tests/", "test_*.py", "conftest.py"],
/// )?;
/// ```
pub fn collect_python_files_excluding(
    workspace_root: &Path,
    exclude_patterns: &[&str],
) -> FileResult<Vec<(String, String)>> {
    let mut files = Vec::new();

    for entry in WalkDir::new(workspace_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Get relative path first - we only want to filter on workspace-relative paths,
        // not the full system path (which may include temp directory names like .tmpXXX)
        let rel_path = match path.strip_prefix(workspace_root) {
            Ok(p) => p,
            Err(_) => continue, // Skip files outside workspace root
        };

        // Skip hidden directories and common exclusions (check relative path only)
        if rel_path
            .components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
        {
            continue;
        }
        if rel_path.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            name == "__pycache__" || name == "node_modules" || name == "venv" || name == "target"
        }) {
            continue;
        }

        if path.extension().is_some_and(|ext| ext == "py") {
            let rel_path_str = rel_path.to_string_lossy().to_string();

            // Check against exclusion patterns
            if matches_any_exclusion_pattern(&rel_path_str, exclude_patterns) {
                continue;
            }

            let content = fs::read_to_string(path)?;
            files.push((rel_path_str, content));
        }
    }

    // Sort files by path for deterministic ID assignment (Contract C8).
    // This ensures consistent FileId/SymbolId assignment regardless of filesystem order.
    // Note: analyze_files() also sorts as the hard guarantee, but we sort here for
    // defense-in-depth and to provide predictable iteration order to callers.
    files.sort_by(|(path_a, _), (path_b, _)| path_a.cmp(path_b));

    Ok(files)
}

/// Check if a path matches any of the exclusion patterns.
///
/// Pattern types:
/// - Directory patterns (end with `/`): Match if any path component equals the dir name
/// - Glob patterns (contain `*`): Match filename against simple glob
/// - Exact patterns: Match if filename equals the pattern
fn matches_any_exclusion_pattern(path: &str, patterns: &[&str]) -> bool {
    let path_obj = Path::new(path);
    let filename = path_obj
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    for pattern in patterns {
        if pattern.ends_with('/') {
            // Directory pattern: check if any component matches
            let dir_name = pattern.trim_end_matches('/');
            if path_obj.components().any(|c| {
                c.as_os_str()
                    .to_str()
                    .map(|s| s == dir_name)
                    .unwrap_or(false)
            }) {
                return true;
            }
        } else if pattern.contains('*') {
            // Glob pattern: simple wildcard matching on filename
            if matches_simple_glob(&filename, pattern) {
                return true;
            }
        } else {
            // Exact filename match
            if filename == *pattern {
                return true;
            }
        }
    }

    false
}

/// Simple glob matching supporting `*` as wildcard.
///
/// Only supports patterns with a single `*` for simplicity.
/// Examples: `test_*.py`, `*_test.py`
fn matches_simple_glob(text: &str, pattern: &str) -> bool {
    if let Some(star_pos) = pattern.find('*') {
        let prefix = &pattern[..star_pos];
        let suffix = &pattern[star_pos + 1..];

        // Text must start with prefix and end with suffix
        // and be long enough to contain both
        if text.len() >= prefix.len() + suffix.len()
            && text.starts_with(prefix)
            && text.ends_with(suffix)
        {
            return true;
        }
        false
    } else {
        // No wildcard - exact match
        text == pattern
    }
}

/// Collect Python files from a WorkspaceSnapshot.
///
/// Uses the snapshot's file inventory for consistent file selection.
/// This provides:
/// - Consistent file selection across operations
/// - Proper exclusion patterns from SnapshotConfig
/// - Content caching for better performance
///
/// # Example
///
/// ```ignore
/// let config = SnapshotConfig::for_language(Language::Python);
/// let snapshot = WorkspaceSnapshot::create(workspace_path, &config)?;
/// let files = collect_files_from_snapshot(workspace_root, &snapshot)?;
/// ```
pub fn collect_files_from_snapshot(
    _workspace_root: &Path,
    snapshot: &WorkspaceSnapshot,
) -> FileResult<Vec<(String, String)>> {
    let mut files = Vec::new();

    for file_info in snapshot.files() {
        // Only include Python files
        if file_info.language != Language::Python {
            continue;
        }

        // Get content from snapshot (uses caching)
        let file_id = snapshot
            .file_id(&file_info.path)
            .ok_or_else(|| FileError::NotFound {
                path: file_info.path.clone(),
            })?;

        let content_bytes = snapshot.get_content(file_id).map_err(FileError::Io)?;
        let content = String::from_utf8_lossy(&content_bytes).to_string();

        files.push((file_info.path.clone(), content));
    }

    // Sort files by path for deterministic ID assignment (Contract C8).
    // See collect_python_files() for rationale.
    files.sort_by(|(path_a, _), (path_b, _)| path_a.cmp(path_b));

    Ok(files)
}

/// Create a WorkspaceSnapshot configured for Python.
///
/// Convenience function that creates a snapshot with Python-specific settings.
pub fn create_python_snapshot(workspace_root: &Path) -> FileResult<WorkspaceSnapshot> {
    let config = SnapshotConfig::for_language(Language::Python);
    WorkspaceSnapshot::create(workspace_root, &config).map_err(FileError::Io)
}

/// Read a file from the workspace.
///
/// # Arguments
///
/// * `workspace_root` - The workspace root directory
/// * `relative_path` - Path relative to workspace root
pub fn read_file(workspace_root: &Path, relative_path: &str) -> FileResult<String> {
    let full_path = workspace_root.join(relative_path);
    fs::read_to_string(&full_path).map_err(FileError::Io)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create Python files
        let src_dir = dir.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();

        File::create(src_dir.join("main.py"))
            .unwrap()
            .write_all(b"def main():\n    pass\n")
            .unwrap();

        File::create(src_dir.join("utils.py"))
            .unwrap()
            .write_all(b"def helper():\n    return 42\n")
            .unwrap();

        // Create __pycache__ (should be excluded)
        let cache_dir = dir.path().join("__pycache__");
        fs::create_dir_all(&cache_dir).unwrap();
        File::create(cache_dir.join("main.cpython-311.pyc"))
            .unwrap()
            .write_all(b"compiled")
            .unwrap();

        // Create .hidden directory (should be excluded)
        let hidden_dir = dir.path().join(".hidden");
        fs::create_dir_all(&hidden_dir).unwrap();
        File::create(hidden_dir.join("secret.py"))
            .unwrap()
            .write_all(b"# hidden")
            .unwrap();

        dir
    }

    #[test]
    fn collect_finds_python_files() {
        let workspace = create_test_workspace();
        let files = collect_python_files(workspace.path()).unwrap();

        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));
    }

    #[test]
    fn collect_excludes_pycache() {
        let workspace = create_test_workspace();
        let files = collect_python_files(workspace.path()).unwrap();

        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(!paths.iter().any(|p| p.contains("__pycache__")));
    }

    #[test]
    fn collect_excludes_hidden_dirs() {
        let workspace = create_test_workspace();
        let files = collect_python_files(workspace.path()).unwrap();

        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
        assert!(!paths.iter().any(|p| p.contains(".hidden")));
    }

    #[test]
    fn read_file_success() {
        let workspace = create_test_workspace();
        let content = read_file(workspace.path(), "src/main.py").unwrap();
        assert!(content.contains("def main()"));
    }

    #[test]
    fn read_file_not_found() {
        let workspace = create_test_workspace();
        let result = read_file(workspace.path(), "nonexistent.py");
        assert!(result.is_err());
    }

    #[test]
    fn collect_returns_files_in_sorted_order() {
        // Contract C8: Files must be returned in sorted path order
        // for deterministic ID assignment.
        let dir = TempDir::new().unwrap();

        // Create files with names that would NOT be in sorted order
        // if returned in filesystem (creation) order
        File::create(dir.path().join("z_last.py"))
            .unwrap()
            .write_all(b"# z")
            .unwrap();
        File::create(dir.path().join("a_first.py"))
            .unwrap()
            .write_all(b"# a")
            .unwrap();
        File::create(dir.path().join("m_middle.py"))
            .unwrap()
            .write_all(b"# m")
            .unwrap();

        let files = collect_python_files(dir.path()).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Files should be in sorted alphabetical order
        assert_eq!(paths, vec!["a_first.py", "m_middle.py", "z_last.py"]);
    }

    #[test]
    fn collect_sorts_nested_paths_correctly() {
        // Verify sorting works correctly for nested directory structures
        let dir = TempDir::new().unwrap();

        // Create directories in non-alphabetical order
        fs::create_dir_all(dir.path().join("pkg_b")).unwrap();
        fs::create_dir_all(dir.path().join("pkg_a")).unwrap();
        fs::create_dir_all(dir.path().join("pkg_a/sub")).unwrap();

        File::create(dir.path().join("pkg_b/mod.py"))
            .unwrap()
            .write_all(b"# b")
            .unwrap();
        File::create(dir.path().join("pkg_a/mod.py"))
            .unwrap()
            .write_all(b"# a")
            .unwrap();
        File::create(dir.path().join("pkg_a/sub/deep.py"))
            .unwrap()
            .write_all(b"# deep")
            .unwrap();
        File::create(dir.path().join("root.py"))
            .unwrap()
            .write_all(b"# root")
            .unwrap();

        let files = collect_python_files(dir.path()).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should be sorted lexicographically:
        // pkg_a/mod.py < pkg_a/sub/deep.py < pkg_b/mod.py < root.py
        assert_eq!(
            paths,
            vec![
                "pkg_a/mod.py",
                "pkg_a/sub/deep.py",
                "pkg_b/mod.py",
                "root.py"
            ]
        );
    }

    // ========================================================================
    // Exclusion Pattern Tests
    // ========================================================================

    fn create_test_workspace_with_tests() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create library source files
        let src_dir = dir.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();
        File::create(src_dir.join("main.py"))
            .unwrap()
            .write_all(b"def main(): pass\n")
            .unwrap();
        File::create(src_dir.join("utils.py"))
            .unwrap()
            .write_all(b"def helper(): return 42\n")
            .unwrap();

        // Create test directory with test files
        let tests_dir = dir.path().join("tests");
        fs::create_dir_all(&tests_dir).unwrap();
        File::create(tests_dir.join("test_main.py"))
            .unwrap()
            .write_all(b"def test_main(): pass\n")
            .unwrap();
        File::create(tests_dir.join("test_utils.py"))
            .unwrap()
            .write_all(b"def test_helper(): pass\n")
            .unwrap();
        File::create(tests_dir.join("conftest.py"))
            .unwrap()
            .write_all(b"# pytest fixtures\n")
            .unwrap();

        // Create test file at root level (test_*.py pattern)
        File::create(dir.path().join("test_integration.py"))
            .unwrap()
            .write_all(b"def test_integration(): pass\n")
            .unwrap();

        dir
    }

    #[test]
    fn collect_excluding_tests_directory() {
        let workspace = create_test_workspace_with_tests();

        // Exclude the tests/ directory
        let files = collect_python_files_excluding(workspace.path(), &["tests/"]).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should include library files and root-level test file
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));
        assert!(paths.contains(&"test_integration.py"));

        // Should NOT include files in tests/ directory
        assert!(!paths.iter().any(|p| p.starts_with("tests/")));
    }

    #[test]
    fn collect_excluding_test_prefix_pattern() {
        let workspace = create_test_workspace_with_tests();

        // Exclude files matching test_*.py
        let files = collect_python_files_excluding(workspace.path(), &["test_*.py"]).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should include library files and conftest.py
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));
        assert!(paths.contains(&"tests/conftest.py"));

        // Should NOT include test_*.py files anywhere
        assert!(!paths.iter().any(|p| {
            Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().starts_with("test_"))
                .unwrap_or(false)
        }));
    }

    #[test]
    fn collect_excluding_exact_filename() {
        let workspace = create_test_workspace_with_tests();

        // Exclude conftest.py exactly
        let files = collect_python_files_excluding(workspace.path(), &["conftest.py"]).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should include all other files
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"tests/test_main.py"));

        // Should NOT include conftest.py
        assert!(!paths.iter().any(|p| p.ends_with("conftest.py")));
    }

    #[test]
    fn collect_excluding_multiple_patterns() {
        let workspace = create_test_workspace_with_tests();

        // Exclude tests directory AND test_*.py pattern AND conftest.py
        let files = collect_python_files_excluding(
            workspace.path(),
            &["tests/", "test_*.py", "conftest.py"],
        )
        .unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should only include library source files
        assert_eq!(paths, vec!["src/main.py", "src/utils.py"]);
    }

    #[test]
    fn collect_excluding_empty_patterns_same_as_collect() {
        let workspace = create_test_workspace_with_tests();

        let all_files = collect_python_files(workspace.path()).unwrap();
        let files_with_empty_exclusions =
            collect_python_files_excluding(workspace.path(), &[]).unwrap();

        // Should return identical results
        assert_eq!(all_files, files_with_empty_exclusions);
    }

    #[test]
    fn matches_simple_glob_prefix() {
        assert!(matches_simple_glob("test_foo.py", "test_*.py"));
        assert!(matches_simple_glob("test_.py", "test_*.py"));
        assert!(matches_simple_glob("test_very_long_name.py", "test_*.py"));
        assert!(!matches_simple_glob("mytest_foo.py", "test_*.py"));
        assert!(!matches_simple_glob("test_foo.txt", "test_*.py"));
    }

    #[test]
    fn matches_simple_glob_suffix() {
        assert!(matches_simple_glob("foo_test.py", "*_test.py"));
        assert!(matches_simple_glob("bar_test.py", "*_test.py"));
        assert!(!matches_simple_glob("foo_test.txt", "*_test.py"));
        assert!(!matches_simple_glob("testfoo.py", "*_test.py"));
    }

    #[test]
    fn matches_simple_glob_middle() {
        assert!(matches_simple_glob("foo_bar_baz.py", "foo_*_baz.py"));
        assert!(matches_simple_glob("foo__baz.py", "foo_*_baz.py"));
        assert!(!matches_simple_glob("foo_bar.py", "foo_*_baz.py"));
    }

    // ========================================================================
    // FileFilterSpec Integration Tests (collect_python_files_filtered)
    // ========================================================================

    #[test]
    fn collect_filtered_no_filter_returns_all() {
        let workspace = create_test_workspace_with_tests();

        // No filter = all Python files (same as collect_python_files)
        let filtered = collect_python_files_filtered(workspace.path(), None).unwrap();
        let all = collect_python_files(workspace.path()).unwrap();

        assert_eq!(filtered, all);
    }

    #[test]
    fn collect_filtered_with_inclusion_restricts_scope() {
        let workspace = create_test_workspace_with_tests();

        // Only include src/**/*.py
        let filter = FileFilterSpec::parse(&["src/**/*.py".to_string()])
            .unwrap()
            .unwrap();
        let files = collect_python_files_filtered(workspace.path(), Some(&filter)).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should only include files in src/
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));

        // Should NOT include tests/ or root files
        assert!(!paths.iter().any(|p| p.starts_with("tests/")));
        assert!(!paths.contains(&"test_integration.py"));
    }

    #[test]
    fn collect_filtered_with_exclusion_only() {
        let workspace = create_test_workspace_with_tests();

        // Exclude tests directory
        let filter = FileFilterSpec::parse(&["!tests/**".to_string()])
            .unwrap()
            .unwrap();
        let files = collect_python_files_filtered(workspace.path(), Some(&filter)).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should include src and root files
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));
        assert!(paths.contains(&"test_integration.py"));

        // Should NOT include tests/
        assert!(!paths.iter().any(|p| p.starts_with("tests/")));
    }

    #[test]
    fn collect_filtered_with_combined_patterns() {
        let workspace = create_test_workspace_with_tests();

        // Include src/**/*.py but exclude test_*.py
        let filter =
            FileFilterSpec::parse(&["src/**/*.py".to_string(), "!**/test_*.py".to_string()])
                .unwrap()
                .unwrap();
        let files = collect_python_files_filtered(workspace.path(), Some(&filter)).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should include src/ non-test files
        assert!(paths.contains(&"src/main.py"));
        assert!(paths.contains(&"src/utils.py"));

        // Should not include any test_*.py files
        assert!(!paths.iter().any(|p| {
            Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().starts_with("test_"))
                .unwrap_or(false)
        }));
    }

    #[test]
    fn collect_filtered_respects_default_exclusions() {
        let dir = TempDir::new().unwrap();

        // Create files in normally-excluded directories
        fs::create_dir_all(dir.path().join("__pycache__")).unwrap();
        fs::create_dir_all(dir.path().join("venv/lib")).unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();

        File::create(dir.path().join("__pycache__/module.py"))
            .unwrap()
            .write_all(b"# cached")
            .unwrap();
        File::create(dir.path().join("venv/lib/site.py"))
            .unwrap()
            .write_all(b"# venv")
            .unwrap();
        File::create(dir.path().join("src/main.py"))
            .unwrap()
            .write_all(b"# source")
            .unwrap();

        // With a filter that would match everything
        let filter = FileFilterSpec::parse(&["**/*.py".to_string()])
            .unwrap()
            .unwrap();
        let files = collect_python_files_filtered(dir.path(), Some(&filter)).unwrap();
        let paths: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

        // Should only include src/main.py (default exclusions filter out pycache and venv)
        assert_eq!(paths, vec!["src/main.py"]);
    }
}
