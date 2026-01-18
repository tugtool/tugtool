//! Python refactoring operations framework.
//!
//! Provides common types and context for Python operations.

pub mod rename;

use std::io;
use std::path::PathBuf;

use tugtool_core::session::Session;
use tugtool_core::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

use crate::files::{collect_python_files, FileError};

// Re-export common types for operations
pub use crate::verification::{VerificationMode, VerificationResult};
pub use tugtool_core::output::Location;

// ============================================================================
// Operation Context
// ============================================================================

/// Common context for Python operations.
///
/// Holds the shared configuration needed by all Python refactoring operations:
/// - Workspace root directory
/// - Python interpreter path
/// - Session directory for temporary files
///
/// # Example
///
/// ```ignore
/// // From explicit paths
/// let ctx = PythonOpContext::new("/path/to/workspace", "/usr/bin/python3", "/tmp/session");
///
/// // From a Session
/// let session = Session::open(workspace_path, SessionOptions::default())?;
/// let ctx = PythonOpContext::from_session(&session, "/usr/bin/python3");
/// ```
#[derive(Debug, Clone)]
pub struct PythonOpContext {
    /// Workspace root directory.
    pub workspace_root: PathBuf,
    /// Python interpreter path.
    pub python_path: PathBuf,
    /// Session directory.
    pub session_dir: PathBuf,
}

impl PythonOpContext {
    /// Create from explicit paths.
    pub fn new(
        workspace_root: impl Into<PathBuf>,
        python_path: impl Into<PathBuf>,
        session_dir: impl Into<PathBuf>,
    ) -> Self {
        PythonOpContext {
            workspace_root: workspace_root.into(),
            python_path: python_path.into(),
            session_dir: session_dir.into(),
        }
    }

    /// Create from a Session.
    ///
    /// Extracts workspace root and session directory from the Session,
    /// using the provided Python interpreter path.
    pub fn from_session(session: &Session, python_path: impl Into<PathBuf>) -> Self {
        PythonOpContext {
            workspace_root: session.workspace_root().to_path_buf(),
            python_path: python_path.into(),
            session_dir: session.session_dir().to_path_buf(),
        }
    }

    /// Collect Python files from the workspace.
    ///
    /// This walks the workspace directory and collects all Python files
    /// with their contents.
    ///
    /// # Returns
    ///
    /// A vector of (relative_path, content) tuples.
    pub fn collect_python_files(&self) -> Result<Vec<(String, String)>, FileError> {
        collect_python_files(&self.workspace_root)
    }

    /// Collect Python files from a WorkspaceSnapshot.
    ///
    /// This integrates with the Step 2 Workspace infrastructure, using the snapshot's
    /// file inventory instead of doing a fresh directory walk. This provides:
    /// - Consistent file selection across operations
    /// - Proper exclusion patterns from SnapshotConfig
    /// - Content caching for better performance
    ///
    /// # Example
    ///
    /// ```ignore
    /// let config = SnapshotConfig::for_language(Language::Python);
    /// let snapshot = WorkspaceSnapshot::create(workspace_path, &config)?;
    /// let files = ctx.collect_files_from_snapshot(&snapshot)?;
    /// ```
    pub fn collect_files_from_snapshot(
        &self,
        snapshot: &WorkspaceSnapshot,
    ) -> Result<Vec<(String, String)>, FileError> {
        crate::files::collect_files_from_snapshot(&self.workspace_root, snapshot)
    }

    /// Create a WorkspaceSnapshot for Python files.
    ///
    /// Convenience method that creates a snapshot configured for Python language.
    /// This uses the standard Workspace infrastructure with Python-specific settings.
    pub fn create_python_snapshot(&self) -> Result<WorkspaceSnapshot, io::Error> {
        let config = SnapshotConfig::for_language(Language::Python);
        WorkspaceSnapshot::create(&self.workspace_root, &config)
    }
}
