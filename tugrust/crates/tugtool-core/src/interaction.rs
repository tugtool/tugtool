//! Interaction adapter trait for mode-agnostic user interaction
//!
//! This module provides the `InteractionAdapter` trait that abstracts user interaction
//! patterns behind a common interface. This enables mode-specific implementations:
//!
//! - **CLI mode**: Uses terminal prompts (inquire crate) for interactive input
//! - **Claude Code mode**: Delegates to the interviewer agent using AskUserQuestion
//!
//! The trait is object-safe, allowing it to be used as `dyn InteractionAdapter`.

use std::fmt;
use thiserror::Error;

/// Error type for interaction operations
#[derive(Error, Debug)]
pub enum InteractionError {
    /// User cancelled the operation (e.g., pressed Ctrl+C or Escape)
    #[error("operation cancelled by user")]
    Cancelled,

    /// Operation timed out waiting for user input
    #[error("operation timed out after {secs} seconds")]
    Timeout { secs: u64 },

    /// Standard input is not a TTY (e.g., running in CI or piped input)
    #[error("stdin is not a TTY - interactive input unavailable")]
    NonTty,

    /// IO error during interaction
    #[error("IO error: {0}")]
    Io(String),

    /// Invalid input provided
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Other interaction error
    #[error("{0}")]
    Other(String),
}

impl InteractionError {
    /// Create a new IO error
    pub fn io(err: impl fmt::Display) -> Self {
        Self::Io(err.to_string())
    }

    /// Create a new other error
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }
}

impl From<std::io::Error> for InteractionError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

/// Result type for interaction operations
pub type InteractionResult<T> = Result<T, InteractionError>;

/// Handle for tracking progress spinners
///
/// This opaque handle is returned by `start_progress` and must be passed to
/// `end_progress` to complete the progress indication. The handle contains
/// an internal identifier used by the adapter implementation to track the
/// specific progress indicator.
#[derive(Debug, Clone)]
pub struct ProgressHandle {
    /// Internal identifier for the progress indicator
    id: u64,
    /// The message being displayed
    message: String,
}

impl ProgressHandle {
    /// Create a new progress handle
    pub fn new(id: u64, message: impl Into<String>) -> Self {
        Self {
            id,
            message: message.into(),
        }
    }

    /// Get the handle's internal ID
    pub fn id(&self) -> u64 {
        self.id
    }

    /// Get the message associated with this progress handle
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Trait for abstracting user interaction across different execution modes
///
/// Implementations of this trait provide mode-specific user interaction:
///
/// - `CliAdapter` (in tug crate): Uses inquire for terminal prompts
/// - `NonInteractiveAdapter`: Returns defaults, for CI and non-TTY environments
/// - Claude Code mode: Uses AskUserQuestion tool directly (no Rust adapter needed)
///
/// The trait is object-safe, allowing it to be used as `Box<dyn InteractionAdapter>`.
///
/// # Example
///
/// ```ignore
/// fn run_with_adapter(adapter: &dyn InteractionAdapter) -> InteractionResult<()> {
///     let name = adapter.ask_text("What is your name?", Some("World"))?;
///     adapter.print_success(&format!("Hello, {}!", name));
///     Ok(())
/// }
/// ```
pub trait InteractionAdapter: Send + Sync {
    /// Ask the user for text input
    ///
    /// # Arguments
    /// * `prompt` - The question or prompt to display
    /// * `default` - Optional default value if user provides no input
    ///
    /// # Returns
    /// The user's input as a string, or the default if provided and no input given
    ///
    /// # Errors
    /// Returns `InteractionError::Cancelled` if user cancels, `NonTty` if not interactive
    fn ask_text(&self, prompt: &str, default: Option<&str>) -> InteractionResult<String>;

    /// Ask the user to select one option from a list
    ///
    /// # Arguments
    /// * `prompt` - The question or prompt to display
    /// * `options` - The list of options to choose from
    ///
    /// # Returns
    /// The index of the selected option (0-based)
    ///
    /// # Errors
    /// Returns `InteractionError::Cancelled` if user cancels, `NonTty` if not interactive,
    /// or `InvalidInput` if options is empty
    fn ask_select(&self, prompt: &str, options: &[&str]) -> InteractionResult<usize>;

    /// Ask the user a yes/no confirmation question
    ///
    /// # Arguments
    /// * `prompt` - The question to ask
    /// * `default` - The default answer if user just presses Enter
    ///
    /// # Returns
    /// `true` for yes, `false` for no
    ///
    /// # Errors
    /// Returns `InteractionError::Cancelled` if user cancels, `NonTty` if not interactive
    fn ask_confirm(&self, prompt: &str, default: bool) -> InteractionResult<bool>;

    /// Ask the user to select multiple options from a list
    ///
    /// # Arguments
    /// * `prompt` - The question or prompt to display
    /// * `options` - The list of options to choose from
    ///
    /// # Returns
    /// A vector of indices of the selected options (0-based)
    ///
    /// # Errors
    /// Returns `InteractionError::Cancelled` if user cancels, `NonTty` if not interactive,
    /// or `InvalidInput` if options is empty
    fn ask_multi_select(&self, prompt: &str, options: &[&str]) -> InteractionResult<Vec<usize>>;

    /// Start a progress indicator (spinner)
    ///
    /// # Arguments
    /// * `message` - The message to display alongside the spinner
    ///
    /// # Returns
    /// A `ProgressHandle` that must be passed to `end_progress` to complete
    fn start_progress(&self, message: &str) -> ProgressHandle;

    /// End a progress indicator
    ///
    /// # Arguments
    /// * `handle` - The handle returned by `start_progress`
    /// * `success` - Whether the operation succeeded (affects final display)
    fn end_progress(&self, handle: ProgressHandle, success: bool);

    /// Print an informational message
    ///
    /// # Arguments
    /// * `message` - The message to display (default/white color)
    fn print_info(&self, message: &str);

    /// Print a warning message
    ///
    /// # Arguments
    /// * `message` - The warning message to display (yellow color)
    fn print_warning(&self, message: &str);

    /// Print an error message
    ///
    /// # Arguments
    /// * `message` - The error message to display (red bold color)
    fn print_error(&self, message: &str);

    /// Print a success message
    ///
    /// # Arguments
    /// * `message` - The success message to display (green color)
    fn print_success(&self, message: &str);

    /// Print a header/section title
    ///
    /// # Arguments
    /// * `message` - The header to display (bold cyan color)
    fn print_header(&self, message: &str);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A mock adapter for testing that the trait is object-safe
    struct MockAdapter {
        progress_counter: AtomicU64,
    }

    impl MockAdapter {
        fn new() -> Self {
            Self {
                progress_counter: AtomicU64::new(0),
            }
        }
    }

    impl InteractionAdapter for MockAdapter {
        fn ask_text(&self, _prompt: &str, default: Option<&str>) -> InteractionResult<String> {
            Ok(default.unwrap_or("mock").to_string())
        }

        fn ask_select(&self, _prompt: &str, options: &[&str]) -> InteractionResult<usize> {
            if options.is_empty() {
                return Err(InteractionError::InvalidInput(
                    "options cannot be empty".to_string(),
                ));
            }
            Ok(0)
        }

        fn ask_confirm(&self, _prompt: &str, default: bool) -> InteractionResult<bool> {
            Ok(default)
        }

        fn ask_multi_select(
            &self,
            _prompt: &str,
            options: &[&str],
        ) -> InteractionResult<Vec<usize>> {
            if options.is_empty() {
                return Err(InteractionError::InvalidInput(
                    "options cannot be empty".to_string(),
                ));
            }
            Ok(vec![0])
        }

        fn start_progress(&self, message: &str) -> ProgressHandle {
            let id = self.progress_counter.fetch_add(1, Ordering::SeqCst);
            ProgressHandle::new(id, message)
        }

        fn end_progress(&self, _handle: ProgressHandle, _success: bool) {
            // No-op for mock
        }

        fn print_info(&self, _message: &str) {}
        fn print_warning(&self, _message: &str) {}
        fn print_error(&self, _message: &str) {}
        fn print_success(&self, _message: &str) {}
        fn print_header(&self, _message: &str) {}
    }

    #[test]
    fn test_trait_is_object_safe() {
        // This test verifies that InteractionAdapter can be used as a trait object
        let adapter: Box<dyn InteractionAdapter> = Box::new(MockAdapter::new());

        // Use the trait object to verify it works
        let result = adapter.ask_text("test", Some("default"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "default");

        let result = adapter.ask_confirm("confirm?", true);
        assert!(result.is_ok());
        assert!(result.unwrap());

        let result = adapter.ask_select("select", &["a", "b"]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);

        let result = adapter.ask_multi_select("multi", &["a", "b"]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec![0]);

        // Test progress
        let handle = adapter.start_progress("working...");
        assert_eq!(handle.message(), "working...");
        adapter.end_progress(handle, true);

        // Test print methods (just verify they don't panic)
        adapter.print_info("info");
        adapter.print_warning("warning");
        adapter.print_error("error");
        adapter.print_success("success");
    }

    #[test]
    fn test_trait_object_reference() {
        // Verify trait can be used as &dyn InteractionAdapter
        fn use_adapter(adapter: &dyn InteractionAdapter) -> InteractionResult<String> {
            adapter.ask_text("test", None)
        }

        let adapter = MockAdapter::new();
        let result = use_adapter(&adapter);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "mock");
    }

    #[test]
    fn test_error_types_implement_std_error() {
        // Verify all error variants implement std::error::Error
        fn assert_error<E: std::error::Error>(_: &E) {}

        let cancelled = InteractionError::Cancelled;
        assert_error(&cancelled);
        assert_eq!(cancelled.to_string(), "operation cancelled by user");

        let timeout = InteractionError::Timeout { secs: 30 };
        assert_error(&timeout);
        assert!(timeout.to_string().contains("30 seconds"));

        let non_tty = InteractionError::NonTty;
        assert_error(&non_tty);
        assert!(non_tty.to_string().contains("TTY"));

        let io_err = InteractionError::Io("test io error".to_string());
        assert_error(&io_err);
        assert!(io_err.to_string().contains("test io error"));

        let invalid = InteractionError::InvalidInput("bad input".to_string());
        assert_error(&invalid);
        assert!(invalid.to_string().contains("bad input"));

        let other = InteractionError::other("custom error");
        assert_error(&other);
        assert_eq!(other.to_string(), "custom error");
    }

    #[test]
    fn test_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let interaction_err: InteractionError = io_err.into();

        match interaction_err {
            InteractionError::Io(msg) => assert!(msg.contains("file not found")),
            _ => panic!("expected Io variant"),
        }
    }

    #[test]
    fn test_progress_handle() {
        let handle = ProgressHandle::new(42, "testing progress");
        assert_eq!(handle.id(), 42);
        assert_eq!(handle.message(), "testing progress");

        // Test Clone
        let cloned = handle.clone();
        assert_eq!(cloned.id(), 42);
        assert_eq!(cloned.message(), "testing progress");
    }

    #[test]
    fn test_error_helper_methods() {
        let io_err = InteractionError::io("io problem");
        assert!(matches!(io_err, InteractionError::Io(_)));
        assert!(io_err.to_string().contains("io problem"));

        let other_err = InteractionError::other("something else");
        assert!(matches!(other_err, InteractionError::Other(_)));
        assert_eq!(other_err.to_string(), "something else");
    }

    #[test]
    fn test_empty_options_error() {
        let adapter = MockAdapter::new();

        let result = adapter.ask_select("select", &[]);
        assert!(matches!(result, Err(InteractionError::InvalidInput(_))));

        let result = adapter.ask_multi_select("multi", &[]);
        assert!(matches!(result, Err(InteractionError::InvalidInput(_))));
    }
}
