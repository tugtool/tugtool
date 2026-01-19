// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! RenameTransformer for applying batch rename operations to Python source code.
//!
//! This module provides a [`RenameTransformer`] that applies rename operations at
//! specified byte spans, producing transformed source code while preserving formatting.
//!
//! # How it Works
//!
//! The RenameTransformer takes a list of [`RenameRequest`] items, each specifying:
//! - A byte span (`start`, `end`) in the source text
//! - The new name to substitute
//!
//! Renames are applied from end to start to preserve span validity as text lengths change.
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_cst::visitor::{RenameTransformer, RenameRequest};
//! use tugtool_cst::nodes::Span;
//!
//! let source = "def foo():\n    return foo";
//! let requests = vec![
//!     RenameRequest::new(Span::new(4, 7), "bar"),  // "foo" at def foo()
//!     RenameRequest::new(Span::new(22, 25), "bar"), // "foo" in return foo
//! ];
//!
//! let transformer = RenameTransformer::new(source, requests);
//! let result = transformer.apply()?;
//! assert_eq!(result, "def bar():\n    return bar");
//! ```

use crate::nodes::Span;

/// A request to rename a span of text.
///
/// Each request specifies a byte span and the new name to substitute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameRequest {
    /// The byte span to replace (start inclusive, end exclusive).
    pub span: Span,
    /// The new name to substitute.
    pub new_name: String,
}

impl RenameRequest {
    /// Create a new rename request.
    pub fn new(span: Span, new_name: impl Into<String>) -> Self {
        Self {
            span,
            new_name: new_name.into(),
        }
    }

    /// Create a new rename request from byte offsets.
    pub fn from_offsets(start: u64, end: u64, new_name: impl Into<String>) -> Self {
        Self {
            span: Span::new(start, end),
            new_name: new_name.into(),
        }
    }
}

/// Error type for rename operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenameError {
    /// A span extends beyond the source text length.
    SpanOutOfBounds {
        span: Span,
        source_len: u64,
    },
    /// Two spans overlap, which is not allowed.
    OverlappingSpans {
        span1: Span,
        span2: Span,
    },
    /// Empty request list (nothing to rename).
    EmptyRequests,
}

impl std::fmt::Display for RenameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenameError::SpanOutOfBounds { span, source_len } => {
                write!(
                    f,
                    "span ({}, {}) is out of bounds for source of length {}",
                    span.start, span.end, source_len
                )
            }
            RenameError::OverlappingSpans { span1, span2 } => {
                write!(
                    f,
                    "overlapping spans: ({}, {}) and ({}, {})",
                    span1.start, span1.end, span2.start, span2.end
                )
            }
            RenameError::EmptyRequests => {
                write!(f, "no rename requests provided")
            }
        }
    }
}

impl std::error::Error for RenameError {}

/// Result type for rename operations.
pub type RenameResult<T> = Result<T, RenameError>;

/// A transformer that applies batch rename operations to source text.
///
/// RenameTransformer takes a source string and a list of rename requests,
/// then applies all renames in a single pass (from end to start to preserve
/// span validity).
///
/// # Example
///
/// ```ignore
/// let transformer = RenameTransformer::new(source, requests);
/// let new_source = transformer.apply()?;
/// ```
pub struct RenameTransformer<'src> {
    /// The original source text.
    source: &'src str,
    /// The rename requests to apply.
    requests: Vec<RenameRequest>,
}

impl<'src> RenameTransformer<'src> {
    /// Create a new RenameTransformer.
    ///
    /// # Arguments
    ///
    /// * `source` - The original source text (UTF-8)
    /// * `requests` - The rename requests to apply
    pub fn new(source: &'src str, requests: Vec<RenameRequest>) -> Self {
        Self { source, requests }
    }

    /// Apply all rename operations and return the transformed source.
    ///
    /// Renames are applied from end to start to preserve span validity.
    /// Overlapping spans will return an error.
    ///
    /// # Errors
    ///
    /// Returns `RenameError::SpanOutOfBounds` if any span extends beyond the source.
    /// Returns `RenameError::OverlappingSpans` if any two spans overlap.
    /// Returns `RenameError::EmptyRequests` if the request list is empty.
    pub fn apply(mut self) -> RenameResult<String> {
        if self.requests.is_empty() {
            return Err(RenameError::EmptyRequests);
        }

        let source_len = self.source.len() as u64;

        // Validate all spans are within bounds
        for request in &self.requests {
            if request.span.end > source_len {
                return Err(RenameError::SpanOutOfBounds {
                    span: request.span,
                    source_len,
                });
            }
        }

        // Sort requests by span start in REVERSE order (end to start)
        // This preserves span validity as we apply edits
        self.requests
            .sort_by(|a, b| b.span.start.cmp(&a.span.start));

        // Check for overlapping spans after sorting
        for i in 1..self.requests.len() {
            let prev = &self.requests[i - 1];
            let curr = &self.requests[i];

            // After reverse sort, prev.start >= curr.start
            // Overlap occurs if curr.end > prev.start
            if curr.span.end > prev.span.start {
                return Err(RenameError::OverlappingSpans {
                    span1: curr.span,
                    span2: prev.span,
                });
            }
        }

        // Apply renames in reverse order (from end to start)
        let mut result = self.source.to_string();
        for request in &self.requests {
            let start = request.span.start as usize;
            let end = request.span.end as usize;

            // Replace the span with the new name
            result = format!(
                "{}{}{}",
                &result[..start],
                &request.new_name,
                &result[end..]
            );
        }

        Ok(result)
    }

    /// Apply renames without validation (for internal use or when caller has pre-validated).
    ///
    /// This skips bounds checking and overlap detection for performance.
    /// Use with caution - invalid spans may cause panics.
    pub fn apply_unchecked(mut self) -> String {
        if self.requests.is_empty() {
            return self.source.to_string();
        }

        // Sort requests by span start in REVERSE order
        self.requests
            .sort_by(|a, b| b.span.start.cmp(&a.span.start));

        // Apply renames
        let mut result = self.source.to_string();
        for request in &self.requests {
            let start = request.span.start as usize;
            let end = request.span.end as usize;

            result = format!(
                "{}{}{}",
                &result[..start],
                &request.new_name,
                &result[end..]
            );
        }

        result
    }
}

/// Check if two spans overlap.
///
/// Two spans overlap if they share any byte positions.
/// Adjacent spans (one ends where the other begins) do NOT overlap.
pub fn spans_overlap(a: &Span, b: &Span) -> bool {
    // Spans overlap if they share any byte positions
    // [a.start, a.end) and [b.start, b.end) overlap iff:
    // a.start < b.end AND b.start < a.end
    a.start < b.end && b.start < a.end
}

/// Sort rename requests by span start position.
///
/// Returns a new sorted vector (ascending order by start position).
pub fn sort_requests_by_start(mut requests: Vec<RenameRequest>) -> Vec<RenameRequest> {
    requests.sort_by(|a, b| a.span.start.cmp(&b.span.start));
    requests
}

/// Sort rename requests by span start position in reverse order.
///
/// Returns a new sorted vector (descending order by start position).
/// This is the order needed for applying renames without invalidating spans.
pub fn sort_requests_by_start_reverse(mut requests: Vec<RenameRequest>) -> Vec<RenameRequest> {
    requests.sort_by(|a, b| b.span.start.cmp(&a.span.start));
    requests
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rename_request_new() {
        let request = RenameRequest::new(Span::new(0, 5), "hello");
        assert_eq!(request.span.start, 0);
        assert_eq!(request.span.end, 5);
        assert_eq!(request.new_name, "hello");
    }

    #[test]
    fn test_rename_request_from_offsets() {
        let request = RenameRequest::from_offsets(10, 20, "world");
        assert_eq!(request.span.start, 10);
        assert_eq!(request.span.end, 20);
        assert_eq!(request.new_name, "world");
    }

    #[test]
    fn test_single_rename() {
        let source = "def foo():\n    pass";
        let requests = vec![RenameRequest::from_offsets(4, 7, "bar")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def bar():\n    pass");
    }

    #[test]
    fn test_multiple_renames_same_name() {
        let source = "def foo():\n    return foo";
        let requests = vec![
            RenameRequest::from_offsets(4, 7, "bar"),   // first foo
            RenameRequest::from_offsets(22, 25, "bar"), // second foo
        ];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def bar():\n    return bar");
    }

    #[test]
    fn test_renames_applied_end_to_start() {
        // Verify that renames work correctly when the new name has different length
        let source = "x = foo; y = foo";
        let requests = vec![
            RenameRequest::from_offsets(4, 7, "longer_name"),  // first foo
            RenameRequest::from_offsets(13, 16, "longer_name"), // second foo
        ];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "x = longer_name; y = longer_name");
    }

    #[test]
    fn test_rename_shorter_name() {
        let source = "def very_long_name():\n    pass";
        let requests = vec![RenameRequest::from_offsets(4, 18, "x")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def x():\n    pass");
    }

    #[test]
    fn test_span_out_of_bounds() {
        let source = "short";
        let requests = vec![RenameRequest::from_offsets(0, 100, "x")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply();

        assert!(matches!(result, Err(RenameError::SpanOutOfBounds { .. })));
    }

    #[test]
    fn test_overlapping_spans() {
        let source = "hello world";
        let requests = vec![
            RenameRequest::from_offsets(0, 7, "hi"),   // "hello w"
            RenameRequest::from_offsets(5, 11, "there"), // " world"
        ];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply();

        assert!(matches!(result, Err(RenameError::OverlappingSpans { .. })));
    }

    #[test]
    fn test_adjacent_spans_not_overlapping() {
        let source = "hello world";
        let requests = vec![
            RenameRequest::from_offsets(0, 5, "hi"),      // "hello"
            RenameRequest::from_offsets(5, 11, " there"), // " world"
        ];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "hi there");
    }

    #[test]
    fn test_empty_requests() {
        let source = "hello";
        let requests = vec![];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply();

        assert!(matches!(result, Err(RenameError::EmptyRequests)));
    }

    #[test]
    fn test_apply_unchecked_empty() {
        let source = "hello";
        let requests = vec![];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply_unchecked();

        assert_eq!(result, "hello");
    }

    #[test]
    fn test_utf8_characters() {
        // Test with UTF-8 characters to ensure byte offsets work correctly
        let source = "def héllo():\n    pass";
        // "héllo" starts at byte 4, 'é' is 2 bytes (UTF-8)
        // So "héllo" is bytes 4-10 (h=4, é=5-6, l=7, l=8, o=9, end=10)
        let requests = vec![RenameRequest::from_offsets(4, 10, "world")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def world():\n    pass");
    }

    #[test]
    fn test_utf8_chinese() {
        // Test with Chinese characters
        let source = "def 函数():\n    pass";
        // "函数" is 6 bytes total (3 bytes each)
        // Starts at byte 4
        let start = 4;
        let end = start + "函数".len();
        let requests = vec![RenameRequest::from_offsets(start as u64, end as u64, "func")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def func():\n    pass");
    }

    #[test]
    fn test_utf8_emoji() {
        // Test with emoji
        let source = "name = '🎉'";
        // Replace the emoji (4 bytes)
        let emoji_start = source.find('🎉').unwrap();
        let emoji_end = emoji_start + '🎉'.len_utf8();
        let requests = vec![RenameRequest::from_offsets(
            emoji_start as u64,
            emoji_end as u64,
            "party",
        )];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "name = 'party'");
    }

    #[test]
    fn test_spans_overlap() {
        // Non-overlapping
        assert!(!spans_overlap(&Span::new(0, 5), &Span::new(5, 10)));
        assert!(!spans_overlap(&Span::new(5, 10), &Span::new(0, 5)));

        // Overlapping
        assert!(spans_overlap(&Span::new(0, 6), &Span::new(5, 10)));
        assert!(spans_overlap(&Span::new(5, 10), &Span::new(0, 6)));

        // One contains the other
        assert!(spans_overlap(&Span::new(0, 10), &Span::new(2, 8)));
        assert!(spans_overlap(&Span::new(2, 8), &Span::new(0, 10)));

        // Same span
        assert!(spans_overlap(&Span::new(5, 10), &Span::new(5, 10)));

        // Zero-length spans
        assert!(!spans_overlap(&Span::new(5, 5), &Span::new(5, 5)));
    }

    #[test]
    fn test_sort_requests_by_start() {
        let requests = vec![
            RenameRequest::from_offsets(20, 25, "c"),
            RenameRequest::from_offsets(0, 5, "a"),
            RenameRequest::from_offsets(10, 15, "b"),
        ];

        let sorted = sort_requests_by_start(requests);

        assert_eq!(sorted[0].span.start, 0);
        assert_eq!(sorted[1].span.start, 10);
        assert_eq!(sorted[2].span.start, 20);
    }

    #[test]
    fn test_sort_requests_by_start_reverse() {
        let requests = vec![
            RenameRequest::from_offsets(0, 5, "a"),
            RenameRequest::from_offsets(20, 25, "c"),
            RenameRequest::from_offsets(10, 15, "b"),
        ];

        let sorted = sort_requests_by_start_reverse(requests);

        assert_eq!(sorted[0].span.start, 20);
        assert_eq!(sorted[1].span.start, 10);
        assert_eq!(sorted[2].span.start, 0);
    }

    #[test]
    fn test_preserve_whitespace_and_formatting() {
        // Ensure we preserve exact whitespace around renames
        let source = "def   foo   ():\n    \tpass";
        let requests = vec![RenameRequest::from_offsets(6, 9, "bar")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "def   bar   ():\n    \tpass");
    }

    #[test]
    fn test_multiple_renames_different_lengths() {
        // Test multiple renames with varying new name lengths
        let source = "a = 1\nbb = 2\nccc = 3";
        let requests = vec![
            RenameRequest::from_offsets(0, 1, "xxxx"),   // a -> xxxx
            RenameRequest::from_offsets(6, 8, "y"),      // bb -> y
            RenameRequest::from_offsets(13, 16, "zzzz"), // ccc -> zzzz
        ];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "xxxx = 1\ny = 2\nzzzz = 3");
    }

    #[test]
    fn test_rename_at_start_of_source() {
        let source = "foo = 1";
        let requests = vec![RenameRequest::from_offsets(0, 3, "bar")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "bar = 1");
    }

    #[test]
    fn test_rename_at_end_of_source() {
        let source = "x = foo";
        let requests = vec![RenameRequest::from_offsets(4, 7, "bar")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "x = bar");
    }

    #[test]
    fn test_rename_entire_source() {
        let source = "foo";
        let requests = vec![RenameRequest::from_offsets(0, 3, "bar")];

        let transformer = RenameTransformer::new(source, requests);
        let result = transformer.apply().unwrap();

        assert_eq!(result, "bar");
    }

    #[test]
    fn test_error_display() {
        let err = RenameError::SpanOutOfBounds {
            span: Span::new(0, 100),
            source_len: 50,
        };
        assert!(err.to_string().contains("out of bounds"));

        let err = RenameError::OverlappingSpans {
            span1: Span::new(0, 10),
            span2: Span::new(5, 15),
        };
        assert!(err.to_string().contains("overlapping"));

        let err = RenameError::EmptyRequests;
        assert!(err.to_string().contains("no rename requests"));
    }
}
