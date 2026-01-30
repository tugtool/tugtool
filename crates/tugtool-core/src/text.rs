//! Text position utilities for byte offset and line:column conversions.
//!
//! This module provides two families of conversion functions:
//!
//! - **Byte-based**: For working with raw byte content (`&[u8]`)
//! - **Char-based**: For working with Unicode text (`&str`)
//!
//! ## Coordinate Conventions
//!
//! - Lines and columns are **1-indexed** (matching editor conventions)
//! - Byte offsets are **0-indexed**
//! - Line/column values of 0 are treated as 1 (defensive clamping)
//!
//! ## Choosing Between Byte and Char Variants
//!
//! Use **byte-based** functions when:
//! - Working with raw file content as bytes
//! - Interfacing with patch/diff systems that use byte offsets
//! - The content is known to be ASCII or UTF-8 where byte = char for ASCII
//!
//! Use **char-based** functions when:
//! - Converting user-provided line:col coordinates (LSP, editor positions)
//! - The content may contain multi-byte UTF-8 characters
//! - Columns should count Unicode scalar values, not bytes

use crate::patch::Span;

// ============================================================================
// Position Types
// ============================================================================

/// A position in source code specified as line and column.
///
/// Both line and column are 1-indexed to match editor conventions.
/// Columns count Unicode scalar values (chars), not bytes.
///
/// # Example
///
/// ```
/// use tugtool_core::text::LineCol;
///
/// let pos = LineCol::new(10, 5);
/// assert_eq!(pos.line, 10);
/// assert_eq!(pos.col, 5);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LineCol {
    /// 1-indexed line number
    pub line: u32,
    /// 1-indexed column number (Unicode scalars, not bytes)
    pub col: u32,
}

impl LineCol {
    /// Create a new LineCol position.
    ///
    /// Values of 0 are clamped to 1 (defensive).
    pub fn new(line: u32, col: u32) -> Self {
        Self {
            line: line.max(1),
            col: col.max(1),
        }
    }
}

impl std::fmt::Display for LineCol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.line, self.col)
    }
}

/// Error when a position cannot be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PositionError {
    /// Line number exceeds file line count
    LineOutOfRange { line: u32, max_line: u32 },
    /// Column exceeds line length
    ColumnOutOfRange { line: u32, col: u32, line_len: u32 },
    /// Byte offset exceeds file length
    OffsetOutOfRange { offset: usize, file_len: usize },
}

impl std::fmt::Display for PositionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PositionError::LineOutOfRange { line, max_line } => {
                write!(f, "line {} out of range (max: {})", line, max_line)
            }
            PositionError::ColumnOutOfRange { line, col, line_len } => {
                write!(
                    f,
                    "column {} out of range on line {} (line length: {})",
                    col, line, line_len
                )
            }
            PositionError::OffsetOutOfRange { offset, file_len } => {
                write!(
                    f,
                    "byte offset {} out of range (file length: {})",
                    offset, file_len
                )
            }
        }
    }
}

impl std::error::Error for PositionError {}

/// Result type for position operations.
pub type PositionResult<T> = Result<T, PositionError>;

/// Convert line:col to byte offset with validation.
///
/// Unlike the existing `position_to_byte_offset_str`, this version:
/// 1. Returns a Result with specific error types
/// 2. Handles edge cases explicitly
///
/// # Arguments
/// * `content` - The source text
/// * `pos` - LineCol position (1-indexed)
///
/// # Returns
/// The byte offset, or an error if position is invalid.
///
/// # Example
///
/// ```
/// use tugtool_core::text::{LineCol, line_col_to_byte_offset};
///
/// let source = "hello\nworld\n";
/// assert_eq!(line_col_to_byte_offset(source, LineCol::new(1, 1)).unwrap(), 0);
/// assert_eq!(line_col_to_byte_offset(source, LineCol::new(2, 1)).unwrap(), 6);
/// ```
pub fn line_col_to_byte_offset(content: &str, pos: LineCol) -> PositionResult<usize> {
    let mut current_line = 1u32;

    for (byte_idx, ch) in content.char_indices() {
        if current_line == pos.line {
            // Found the line - now count columns (Unicode scalars)
            let line_start = byte_idx;
            let mut current_col = 1u32;

            for (col_byte_offset, col_ch) in content[line_start..].char_indices() {
                if current_col == pos.col {
                    return Ok(line_start + col_byte_offset);
                }
                if col_ch == '\n' {
                    // Column exceeds line length
                    return Err(PositionError::ColumnOutOfRange {
                        line: pos.line,
                        col: pos.col,
                        line_len: current_col - 1,
                    });
                }
                current_col += 1;
            }

            // Past end of content on this line
            if current_col == pos.col {
                return Ok(content.len());
            }
            return Err(PositionError::ColumnOutOfRange {
                line: pos.line,
                col: pos.col,
                line_len: current_col - 1,
            });
        }

        if ch == '\n' {
            current_line += 1;
        }
    }

    // Line not found - might be asking for exact end of file
    if current_line == pos.line && pos.col == 1 {
        return Ok(content.len());
    }

    Err(PositionError::LineOutOfRange {
        line: pos.line,
        max_line: current_line,
    })
}

/// Convert byte offset to line:col with validation.
///
/// # Arguments
/// * `content` - The source text
/// * `offset` - Byte offset (0-indexed)
///
/// # Returns
/// The LineCol position, or an error if offset is invalid.
///
/// # Example
///
/// ```
/// use tugtool_core::text::{LineCol, byte_offset_to_line_col};
///
/// let source = "hello\nworld\n";
/// assert_eq!(byte_offset_to_line_col(source, 0).unwrap(), LineCol::new(1, 1));
/// assert_eq!(byte_offset_to_line_col(source, 6).unwrap(), LineCol::new(2, 1));
/// ```
pub fn byte_offset_to_line_col(content: &str, offset: usize) -> PositionResult<LineCol> {
    if offset > content.len() {
        return Err(PositionError::OffsetOutOfRange {
            offset,
            file_len: content.len(),
        });
    }

    let mut line = 1u32;
    let mut col = 1u32;
    let mut current_byte = 0usize;

    for ch in content.chars() {
        if current_byte >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        current_byte += ch.len_utf8();
    }

    Ok(LineCol { line, col })
}

// ============================================================================
// Byte-based Conversions (for &[u8])
// ============================================================================

/// Convert a byte offset to 1-indexed line and column.
///
/// Columns count bytes, not characters. This is appropriate for
/// ASCII content or when interfacing with byte-offset-based systems.
///
/// # Arguments
///
/// * `content` - The file content as bytes
/// * `offset` - The byte offset (0-indexed)
///
/// # Returns
///
/// A `(line, col)` tuple where both are 1-indexed.
/// If `offset` exceeds content length, returns position at end of content.
pub fn byte_offset_to_position(content: &[u8], offset: usize) -> (u32, u32) {
    let offset = offset.min(content.len());
    let mut line = 1u32;
    let mut col = 1u32;

    for (i, &byte) in content.iter().enumerate() {
        if i >= offset {
            break;
        }
        if byte == b'\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }

    (line, col)
}

/// Convert 1-indexed line and column to byte offset.
///
/// Columns count bytes, not characters.
///
/// # Arguments
///
/// * `content` - The file content as bytes
/// * `line` - The 1-indexed line number
/// * `col` - The 1-indexed column number
///
/// # Returns
///
/// The byte offset. If the position is beyond the content,
/// returns the content length.
pub fn position_to_byte_offset(content: &[u8], line: u32, col: u32) -> usize {
    let line = line.max(1);
    let col = col.max(1);

    let mut current_line = 1u32;

    for (i, &byte) in content.iter().enumerate() {
        if current_line == line {
            // Found the line, calculate offset within it
            let offset_in_line = (col as usize).saturating_sub(1);
            let line_end = content[i..]
                .iter()
                .position(|&b| b == b'\n')
                .map(|p| i + p)
                .unwrap_or(content.len());
            let max_offset = line_end - i;
            return i + offset_in_line.min(max_offset);
        }
        if byte == b'\n' {
            current_line += 1;
        }
    }

    // Line not found - return end of content
    content.len()
}

// ============================================================================
// Char-based Conversions (for &str)
// ============================================================================

/// Convert a byte offset to 1-indexed line and column (Unicode-aware).
///
/// Columns count Unicode scalar values (chars), not bytes.
/// This is appropriate for user-facing positions.
///
/// # Arguments
///
/// * `content` - The file content as a string
/// * `offset` - The byte offset (0-indexed)
///
/// # Returns
///
/// A `(line, col)` tuple where both are 1-indexed.
pub fn byte_offset_to_position_str(content: &str, offset: usize) -> (u32, u32) {
    let target = offset;
    let mut line = 1u32;
    let mut col = 1u32;
    let mut current_offset = 0usize;

    for ch in content.chars() {
        if current_offset >= target {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        current_offset += ch.len_utf8();
    }

    (line, col)
}

/// Convert 1-indexed line and column to byte offset (Unicode-aware).
///
/// Columns count Unicode scalar values (chars), not bytes.
///
/// # Arguments
///
/// * `content` - The file content as a string
/// * `line` - The 1-indexed line number
/// * `col` - The 1-indexed column number
///
/// # Returns
///
/// The byte offset into the string.
pub fn position_to_byte_offset_str(content: &str, line: u32, col: u32) -> usize {
    let line = line.max(1);
    let col = col.max(1);

    let mut current_line = 1u32;

    for (i, ch) in content.char_indices() {
        if current_line == line {
            // Found the line, now count columns
            let mut current_col = 1u32;
            for (j, c) in content[i..].char_indices() {
                if current_col == col {
                    return i + j;
                }
                if c == '\n' {
                    break;
                }
                current_col += 1;
            }
            // Column beyond end of line - clamp to end
            let line_end = content[i..]
                .find('\n')
                .map(|p| i + p)
                .unwrap_or(content.len());
            return line_end;
        }
        if ch == '\n' {
            current_line += 1;
        }
    }

    // Line not found - return end of content
    content.len()
}

// ============================================================================
// Span Utilities
// ============================================================================

/// Get the line range spanned by a byte span.
///
/// Returns `(start_line, end_line)` both 1-indexed.
/// Useful for determining which lines a change affects.
pub fn span_to_line_range(content: &[u8], span: &Span) -> (u32, u32) {
    let (start_line, _) = byte_offset_to_position(content, span.start);
    let (end_line, _) =
        byte_offset_to_position(content, span.end.saturating_sub(1).max(span.start));
    (start_line, end_line)
}

/// Extract the text content of a span from byte content.
///
/// Returns `None` if the span extends beyond content bounds.
pub fn extract_span<'a>(content: &'a [u8], span: &Span) -> Option<&'a [u8]> {
    if span.end <= content.len() {
        Some(&content[span.start..span.end])
    } else {
        None
    }
}

/// Extract the text content of a span as a string.
///
/// Returns `None` if the span extends beyond content bounds or contains invalid UTF-8.
pub fn extract_span_str<'a>(content: &'a str, span: &Span) -> Option<&'a str> {
    content.get(span.start..span.end)
}

// ============================================================================
// Line Utilities
// ============================================================================

/// Get the byte offset of the start of a line.
///
/// Returns the offset of the first character on the given 1-indexed line.
/// Returns `None` if the line doesn't exist or has no content.
pub fn line_start_offset(content: &[u8], line: u32) -> Option<usize> {
    if line == 0 {
        return None;
    }
    if line == 1 {
        return if content.is_empty() { None } else { Some(0) };
    }

    let mut current_line = 1u32;
    for (i, &byte) in content.iter().enumerate() {
        if byte == b'\n' {
            current_line += 1;
            if current_line == line {
                // Check if there's content after this newline
                if i + 1 < content.len() {
                    return Some(i + 1);
                } else {
                    return None; // Line exists but has no content (trailing newline)
                }
            }
        }
    }
    None
}

/// Count the number of lines in the content.
pub fn line_count(content: &[u8]) -> u32 {
    let newlines = content.iter().filter(|&&b| b == b'\n').count() as u32;
    if content.is_empty() {
        0
    } else if content.last() == Some(&b'\n') {
        newlines
    } else {
        newlines + 1
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod byte_based_tests {
        use super::*;

        #[test]
        fn offset_to_position_simple() {
            let content = b"line1\nline2\nline3\n";
            assert_eq!(byte_offset_to_position(content, 0), (1, 1));
            assert_eq!(byte_offset_to_position(content, 4), (1, 5));
            assert_eq!(byte_offset_to_position(content, 5), (1, 6)); // newline char
            assert_eq!(byte_offset_to_position(content, 6), (2, 1));
            assert_eq!(byte_offset_to_position(content, 12), (3, 1));
        }

        #[test]
        fn position_to_offset_simple() {
            let content = b"line1\nline2\nline3\n";
            assert_eq!(position_to_byte_offset(content, 1, 1), 0);
            assert_eq!(position_to_byte_offset(content, 1, 5), 4);
            assert_eq!(position_to_byte_offset(content, 2, 1), 6);
            assert_eq!(position_to_byte_offset(content, 3, 1), 12);
        }

        #[test]
        fn roundtrip_byte_based() {
            let content = b"def foo():\n    pass\n";
            for offset in 0..content.len() {
                let (line, col) = byte_offset_to_position(content, offset);
                let recovered = position_to_byte_offset(content, line, col);
                assert_eq!(
                    recovered, offset,
                    "roundtrip failed for offset {}: got line={}, col={}, recovered={}",
                    offset, line, col, recovered
                );
            }
        }

        #[test]
        fn offset_beyond_content() {
            let content = b"short";
            let (line, col) = byte_offset_to_position(content, 100);
            // Should return position at end
            assert_eq!(line, 1);
            assert_eq!(col, 6); // After 's','h','o','r','t'
        }

        #[test]
        fn position_beyond_content() {
            let content = b"short";
            let offset = position_to_byte_offset(content, 100, 1);
            assert_eq!(offset, 5); // end of content
        }

        #[test]
        fn empty_content() {
            let content = b"";
            assert_eq!(byte_offset_to_position(content, 0), (1, 1));
            assert_eq!(position_to_byte_offset(content, 1, 1), 0);
        }
    }

    mod char_based_tests {
        use super::*;

        #[test]
        fn offset_to_position_str_simple() {
            let content = "def foo():\n    pass\n";
            assert_eq!(byte_offset_to_position_str(content, 0), (1, 1));
            assert_eq!(byte_offset_to_position_str(content, 4), (1, 5));
            assert_eq!(byte_offset_to_position_str(content, 11), (2, 1));
        }

        #[test]
        fn position_to_offset_str_simple() {
            let content = "def foo():\n    pass\n";
            assert_eq!(position_to_byte_offset_str(content, 1, 1), 0);
            assert_eq!(position_to_byte_offset_str(content, 1, 5), 4);
            assert_eq!(position_to_byte_offset_str(content, 2, 1), 11);
        }

        #[test]
        fn roundtrip_str_based() {
            let content = "line1\nline2\nline3\n";
            for offset in 0..content.len() {
                let (line, col) = byte_offset_to_position_str(content, offset);
                let recovered = position_to_byte_offset_str(content, line, col);
                assert_eq!(
                    recovered, offset,
                    "roundtrip failed for offset {}: got line={}, col={}, recovered={}",
                    offset, line, col, recovered
                );
            }
        }

        #[test]
        fn empty_content_str() {
            let content = "";
            assert_eq!(byte_offset_to_position_str(content, 0), (1, 1));
            assert_eq!(position_to_byte_offset_str(content, 1, 1), 0);
        }
    }

    mod span_tests {
        use super::*;

        #[test]
        fn span_to_line_range_single_line() {
            let content = b"def foo(): pass\n";
            let span = Span::new(4, 7); // "foo"
            let (start, end) = span_to_line_range(content, &span);
            assert_eq!(start, 1);
            assert_eq!(end, 1);
        }

        #[test]
        fn span_to_line_range_multi_line() {
            let content = b"line1\nline2\nline3\n";
            let span = Span::new(0, 12); // "line1\nline2"
            let (start, end) = span_to_line_range(content, &span);
            assert_eq!(start, 1);
            assert_eq!(end, 2);
        }

        #[test]
        fn extract_span_valid() {
            let content = b"hello world";
            let span = Span::new(0, 5);
            assert_eq!(extract_span(content, &span), Some(&b"hello"[..]));
        }

        #[test]
        fn extract_span_out_of_bounds() {
            let content = b"short";
            let span = Span::new(0, 100);
            assert_eq!(extract_span(content, &span), None);
        }

        #[test]
        fn extract_span_str_valid() {
            let content = "hello world";
            let span = Span::new(0, 5);
            assert_eq!(extract_span_str(content, &span), Some("hello"));
        }
    }

    mod line_utilities {
        use super::*;

        #[test]
        fn line_start() {
            let content = b"line1\nline2\nline3\n";
            assert_eq!(line_start_offset(content, 1), Some(0));
            assert_eq!(line_start_offset(content, 2), Some(6));
            assert_eq!(line_start_offset(content, 3), Some(12));
            assert_eq!(line_start_offset(content, 4), None);
            assert_eq!(line_start_offset(content, 0), None);
        }

        #[test]
        fn line_count_tests() {
            assert_eq!(line_count(b""), 0);
            assert_eq!(line_count(b"one line"), 1);
            assert_eq!(line_count(b"one line\n"), 1);
            assert_eq!(line_count(b"line1\nline2"), 2);
            assert_eq!(line_count(b"line1\nline2\n"), 2);
            assert_eq!(line_count(b"line1\nline2\nline3\n"), 3);
        }
    }

    mod edge_cases {
        use super::*;

        #[test]
        fn zero_line_col_clamped() {
            let content = b"test";
            // Line 0 and col 0 should be treated as 1
            assert_eq!(position_to_byte_offset(content, 0, 0), 0);
            assert_eq!(position_to_byte_offset(content, 0, 1), 0);
            assert_eq!(position_to_byte_offset(content, 1, 0), 0);
        }

        #[test]
        fn col_beyond_line_end() {
            let content = b"short\nline\n";
            // Asking for col 100 on line 1 should clamp to end of line
            let offset = position_to_byte_offset(content, 1, 100);
            assert_eq!(offset, 5); // position of \n
        }

        #[test]
        fn single_char_content() {
            let content = b"x";
            assert_eq!(byte_offset_to_position(content, 0), (1, 1));
            assert_eq!(position_to_byte_offset(content, 1, 1), 0);
        }
    }

    mod line_col_tests {
        use super::*;

        #[test]
        fn test_line_col_new() {
            let pos = LineCol::new(10, 5);
            assert_eq!(pos.line, 10);
            assert_eq!(pos.col, 5);
        }

        #[test]
        fn test_line_col_clamps_zero() {
            let pos = LineCol::new(0, 0);
            assert_eq!(pos.line, 1);
            assert_eq!(pos.col, 1);
        }

        #[test]
        fn test_line_col_display() {
            let pos = LineCol::new(10, 5);
            assert_eq!(format!("{}", pos), "10:5");
        }

        #[test]
        fn test_line_col_to_byte_offset_ascii() {
            let source = "hello\nworld\n";
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(1, 1)).unwrap(),
                0
            );
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(1, 6)).unwrap(),
                5
            ); // the newline
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(2, 1)).unwrap(),
                6
            );
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(2, 3)).unwrap(),
                8
            ); // 'r' in "world"
        }

        #[test]
        fn test_line_col_to_byte_offset_unicode() {
            // '你' is 3 bytes, '好' is 3 bytes
            let source = "x = '你好'\n";
            //            0123456789...
            // Char indices: x=0, ' '=1, ==2, ' '=3, '=4, 你=5..7, 好=8..10, '=11, \n=12

            // Position at start
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(1, 1)).unwrap(),
                0
            );
            // Position at '你' (col 6, counting chars)
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(1, 6)).unwrap(),
                5
            );
            // Position at '好' (col 7)
            assert_eq!(
                line_col_to_byte_offset(source, LineCol::new(1, 7)).unwrap(),
                8
            );
        }

        #[test]
        fn test_line_col_to_byte_offset_line_out_of_range() {
            let source = "hello\n";
            let result = line_col_to_byte_offset(source, LineCol::new(100, 1));
            assert!(matches!(result, Err(PositionError::LineOutOfRange { .. })));
        }

        #[test]
        fn test_line_col_to_byte_offset_col_out_of_range() {
            let source = "hello\n";
            let result = line_col_to_byte_offset(source, LineCol::new(1, 100));
            assert!(matches!(result, Err(PositionError::ColumnOutOfRange { .. })));
        }

        #[test]
        fn test_byte_offset_to_line_col_simple() {
            let source = "hello\nworld\n";
            assert_eq!(
                byte_offset_to_line_col(source, 0).unwrap(),
                LineCol::new(1, 1)
            );
            assert_eq!(
                byte_offset_to_line_col(source, 6).unwrap(),
                LineCol::new(2, 1)
            );
        }

        #[test]
        fn test_byte_offset_to_line_col_out_of_range() {
            let source = "hello";
            let result = byte_offset_to_line_col(source, 100);
            assert!(matches!(result, Err(PositionError::OffsetOutOfRange { .. })));
        }

        #[test]
        fn test_byte_offset_to_line_col_roundtrip() {
            let source = "def foo():\n    return x\n";
            for offset in 0..source.len() {
                let pos = byte_offset_to_line_col(source, offset).unwrap();
                let recovered = line_col_to_byte_offset(source, pos).unwrap();
                assert_eq!(
                    recovered, offset,
                    "roundtrip failed: offset {} -> {:?} -> {}",
                    offset, pos, recovered
                );
            }
        }

        #[test]
        fn test_byte_offset_to_line_col_roundtrip_unicode() {
            let source = "x = '你好世界'\ny = 1\n";
            for offset in 0..source.len() {
                // Only test on char boundaries
                if source.is_char_boundary(offset) {
                    let pos = byte_offset_to_line_col(source, offset).unwrap();
                    let recovered = line_col_to_byte_offset(source, pos).unwrap();
                    assert_eq!(
                        recovered, offset,
                        "roundtrip failed: offset {} -> {:?} -> {}",
                        offset, pos, recovered
                    );
                }
            }
        }
    }
}
