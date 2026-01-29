//! Content-aware file matching for filter predicates.
//!
//! This module provides content-based filtering capabilities, allowing filters
//! to match files based on their textual content using substring or regex patterns.
//!
//! ## Usage
//!
//! Content filtering requires explicit opt-in via the `--filter-content` flag
//! as specified in [D10]. This is because content matching requires reading
//! file contents, which can be expensive for large codebases.
//!
//! ```
//! use tugtool_core::filter::ContentMatcher;
//! use std::path::Path;
//!
//! let mut matcher = ContentMatcher::new();
//!
//! // Check if file contains a substring
//! // let matches = matcher.matches_contains(Path::new("src/main.py"), "TODO")?;
//!
//! // Check if file matches a regex pattern
//! // let matches = matcher.matches_regex(Path::new("src/main.py"), r"@deprecated\b")?;
//! ```

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use thiserror::Error;

/// Error type for content matching operations.
#[derive(Debug, Error)]
pub enum ContentError {
    /// Failed to read file content.
    #[error("failed to read file '{path}': {message}")]
    ContentReadError { path: PathBuf, message: String },

    /// Invalid regex pattern.
    #[error("invalid regex pattern '{pattern}': {message}")]
    InvalidRegex { pattern: String, message: String },
}

/// Content matcher with lazy file reading and caching.
///
/// Files are only read when needed and cached for subsequent queries.
/// This avoids re-reading the same file multiple times when evaluating
/// multiple content predicates against the same file.
#[derive(Debug, Default)]
pub struct ContentMatcher {
    /// Cache of file contents, keyed by path.
    cache: HashMap<PathBuf, String>,
    /// Cache of compiled regex patterns.
    regex_cache: HashMap<String, Regex>,
    /// Tracks read count for testing purposes.
    #[cfg(test)]
    read_count: std::cell::Cell<usize>,
}

impl ContentMatcher {
    /// Create a new content matcher.
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            regex_cache: HashMap::new(),
            #[cfg(test)]
            read_count: std::cell::Cell::new(0),
        }
    }

    /// Check if file content contains the given substring.
    ///
    /// Uses short-circuit evaluation: returns true as soon as the first match
    /// is found without reading/scanning the entire file if possible.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file to check
    /// * `substring` - The substring to search for
    ///
    /// # Returns
    ///
    /// * `Ok(true)` - The file contains the substring
    /// * `Ok(false)` - The file does not contain the substring
    /// * `Err(ContentError)` - Failed to read the file
    pub fn matches_contains(&mut self, path: &Path, substring: &str) -> Result<bool, ContentError> {
        let content = self.get_content(path)?;
        Ok(content.contains(substring))
    }

    /// Check if file content matches the given regex pattern.
    ///
    /// The regex is compiled once and cached for subsequent queries with
    /// the same pattern.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file to check
    /// * `pattern` - The regex pattern to match
    ///
    /// # Returns
    ///
    /// * `Ok(true)` - The file content matches the pattern
    /// * `Ok(false)` - The file content does not match the pattern
    /// * `Err(ContentError)` - Failed to read the file or invalid regex
    pub fn matches_regex(&mut self, path: &Path, pattern: &str) -> Result<bool, ContentError> {
        // Ensure content is loaded first
        self.ensure_content_cached(path)?;

        // Ensure regex is compiled
        self.ensure_regex_cached(pattern)?;

        // Now we can safely access both caches immutably
        let content = self.cache.get(&path.to_path_buf()).unwrap();
        let regex = self.regex_cache.get(pattern).unwrap();
        Ok(regex.is_match(content))
    }

    /// Ensure file content is cached, loading from disk if needed.
    fn ensure_content_cached(&mut self, path: &Path) -> Result<(), ContentError> {
        use std::collections::hash_map::Entry;

        let canonical = path.to_path_buf();

        if let Entry::Vacant(e) = self.cache.entry(canonical) {
            #[cfg(test)]
            {
                self.read_count.set(self.read_count.get() + 1);
            }

            let content = fs::read_to_string(path).map_err(|err| ContentError::ContentReadError {
                path: path.to_path_buf(),
                message: err.to_string(),
            })?;

            e.insert(content);
        }

        Ok(())
    }

    /// Get file content, reading from cache or loading from disk.
    fn get_content(&mut self, path: &Path) -> Result<&str, ContentError> {
        self.ensure_content_cached(path)?;
        Ok(self.cache.get(&path.to_path_buf()).unwrap())
    }

    /// Ensure regex is compiled and cached.
    fn ensure_regex_cached(&mut self, pattern: &str) -> Result<(), ContentError> {
        if !self.regex_cache.contains_key(pattern) {
            let regex = Regex::new(pattern).map_err(|e| ContentError::InvalidRegex {
                pattern: pattern.to_string(),
                message: e.to_string(),
            })?;
            self.regex_cache.insert(pattern.to_string(), regex);
        }
        Ok(())
    }

    /// Get the number of file reads performed (for testing).
    #[cfg(test)]
    pub fn read_count(&self) -> usize {
        self.read_count.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn create_temp_file(content: &str) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file.flush().unwrap();
        file
    }

    // =========================================================================
    // Contains Tests
    // =========================================================================

    #[test]
    fn test_content_contains_match() {
        let file = create_temp_file("Hello, world! TODO: fix this");
        let mut matcher = ContentMatcher::new();

        assert!(matcher
            .matches_contains(file.path(), "TODO")
            .unwrap());
    }

    #[test]
    fn test_content_contains_no_match() {
        let file = create_temp_file("Hello, world! All good here.");
        let mut matcher = ContentMatcher::new();

        assert!(!matcher
            .matches_contains(file.path(), "TODO")
            .unwrap());
    }

    #[test]
    fn test_content_contains_multiline() {
        let content = r#"
def main():
    # First line
    print("hello")
    # TODO: Add more functionality
    pass
"#;
        let file = create_temp_file(content);
        let mut matcher = ContentMatcher::new();

        assert!(matcher
            .matches_contains(file.path(), "TODO:")
            .unwrap());
        assert!(matcher
            .matches_contains(file.path(), "def main()")
            .unwrap());
        assert!(!matcher
            .matches_contains(file.path(), "FIXME")
            .unwrap());
    }

    // =========================================================================
    // Regex Tests
    // =========================================================================

    #[test]
    fn test_content_regex_match() {
        let file = create_temp_file("@deprecated function foo()");
        let mut matcher = ContentMatcher::new();

        assert!(matcher
            .matches_regex(file.path(), r"@deprecated\b")
            .unwrap());
    }

    #[test]
    fn test_content_regex_no_match() {
        let file = create_temp_file("function foo() { return 42; }");
        let mut matcher = ContentMatcher::new();

        assert!(!matcher
            .matches_regex(file.path(), r"@deprecated\b")
            .unwrap());
    }

    #[test]
    fn test_content_regex_multiline() {
        let content = r#"
class Handler:
    @deprecated
    def old_method(self):
        pass

    def new_method(self):
        pass
"#;
        let file = create_temp_file(content);
        let mut matcher = ContentMatcher::new();

        // Match @deprecated
        assert!(matcher
            .matches_regex(file.path(), r"@deprecated")
            .unwrap());

        // Match method definition pattern
        assert!(matcher
            .matches_regex(file.path(), r"def \w+\(self\)")
            .unwrap());

        // No match for async methods
        assert!(!matcher
            .matches_regex(file.path(), r"async def")
            .unwrap());
    }

    #[test]
    fn test_content_regex_invalid_pattern_error() {
        let file = create_temp_file("some content");
        let mut matcher = ContentMatcher::new();

        let result = matcher.matches_regex(file.path(), r"[invalid");
        match result {
            Err(ContentError::InvalidRegex { pattern, message }) => {
                assert_eq!(pattern, "[invalid");
                assert!(!message.is_empty());
            }
            _ => panic!("expected InvalidRegex error, got {:?}", result),
        }
    }

    // =========================================================================
    // Error Tests
    // =========================================================================

    #[test]
    fn test_content_file_not_found_error() {
        let mut matcher = ContentMatcher::new();
        let result = matcher.matches_contains(Path::new("/nonexistent/path/file.txt"), "test");

        match result {
            Err(ContentError::ContentReadError { path, message }) => {
                assert_eq!(path, PathBuf::from("/nonexistent/path/file.txt"));
                assert!(!message.is_empty());
            }
            _ => panic!("expected ContentReadError, got {:?}", result),
        }
    }

    // =========================================================================
    // Caching Tests
    // =========================================================================

    #[test]
    fn test_content_caching_reads_once() {
        let file = create_temp_file("Hello, world! TODO: fix this");
        let mut matcher = ContentMatcher::new();

        // First read
        assert!(matcher
            .matches_contains(file.path(), "TODO")
            .unwrap());
        assert_eq!(matcher.read_count(), 1);

        // Second query - should use cache
        assert!(matcher
            .matches_contains(file.path(), "world")
            .unwrap());
        assert_eq!(matcher.read_count(), 1); // Still 1, used cache

        // Third query with regex - should use cache
        assert!(matcher
            .matches_regex(file.path(), r"TODO")
            .unwrap());
        assert_eq!(matcher.read_count(), 1); // Still 1, used cache
    }
}
