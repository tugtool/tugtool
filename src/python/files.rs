//! Python file collection utilities.
//!
//! Provides workspace file discovery for Python refactoring operations.

use std::fs;
use std::io;
use std::path::Path;
use thiserror::Error;
use walkdir::WalkDir;

use crate::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

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
            name == "__pycache__"
                || name == "node_modules"
                || name == "venv"
                || name == "target"
        }) {
            continue;
        }

        if path.extension().map_or(false, |ext| ext == "py") {
            let rel_path_str = rel_path.to_string_lossy().to_string();
            let content = fs::read_to_string(path)?;
            files.push((rel_path_str, content));
        }
    }

    Ok(files)
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
}
