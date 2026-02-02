//! Test utilities for Python analysis and lookup testing.
//!
//! Provides helpers for validating Location specifications and debugging
//! symbol lookup failures.

use tugtool_core::output::Location;
use tugtool_core::text::position_to_byte_offset_str;

/// Validates that a Location points to the expected character in source.
///
/// This helper catches location specification errors at test time before they
/// propagate through the lookup pipeline. When a location is incorrect, the
/// panic message shows exactly what character is at that position.
///
/// # Arguments
///
/// * `source` - The source code string
/// * `loc` - The Location to validate (uses line and col, 1-indexed)
/// * `expected` - The character that should be at that location
///
/// # Panics
///
/// Panics with a helpful message if the character at the location doesn't match:
/// - Shows the actual character found
/// - Shows the byte offset computed
/// - Shows surrounding context
///
/// # Example
///
/// ```ignore
/// let source = "def foo(): pass";
/// let loc = Location::new("test.py", 1, 5);  // 'f' in 'foo'
/// assert_location_char(source, &loc, 'f');   // passes
///
/// let bad_loc = Location::new("test.py", 1, 4);  // ' ' (space)
/// assert_location_char(source, &bad_loc, 'f');   // panics with helpful message
/// ```
pub fn assert_location_char(source: &str, loc: &Location, expected: char) {
    let byte_offset = position_to_byte_offset_str(source, loc.line, loc.col);

    // Get character at offset
    let actual = source[byte_offset..].chars().next();

    if actual != Some(expected) {
        // Build context around the offset for debugging
        let context_start = byte_offset.saturating_sub(10);
        let context_end = (byte_offset + 20).min(source.len());
        let context = &source[context_start..context_end];
        let marker_pos = byte_offset - context_start;

        // Build marker line (spaces followed by ^)
        let marker: String = std::iter::repeat(' ')
            .take(marker_pos)
            .chain(std::iter::once('^'))
            .collect();

        panic!(
            "\nLocation ({}:{}) points to {:?} (byte {}), expected {:?}\n\
             Context:\n  {}\n  {}\n",
            loc.line, loc.col, actual, byte_offset, expected, context, marker
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assert_location_char_success() {
        let source = "def foo(): pass";
        //           123456789...
        // 'd' is at col 1, 'e' at col 2, 'f' at col 3, ' ' at col 4, 'f' at col 5

        let loc = Location::new("test.py", 1, 1);
        assert_location_char(source, &loc, 'd');

        let loc = Location::new("test.py", 1, 5);
        assert_location_char(source, &loc, 'f'); // 'f' in 'foo'

        let loc = Location::new("test.py", 1, 4);
        assert_location_char(source, &loc, ' '); // space before 'foo'
    }

    #[test]
    #[should_panic(expected = "points to")]
    fn test_assert_location_char_failure() {
        let source = "def foo(): pass";
        let loc = Location::new("test.py", 1, 5); // points to 'f'
        assert_location_char(source, &loc, 'x'); // expect 'x' but it's 'f'
    }

    #[test]
    fn test_assert_location_char_multiline() {
        let source = "def compute(x):\n    return x * 2\n\nresults = [y for x in range(10) if (y := compute(x)) > 5]";
        // Line 4: "results = [y for x in range(10) if (y := compute(x)) > 5]"
        //          123456789012345678901234567890123456789
        //                   1         2         3

        // Column 37 should be 'y' in the walrus operator
        let loc = Location::new("test.py", 4, 37);
        assert_location_char(source, &loc, 'y');

        // Column 36 is '('
        let loc = Location::new("test.py", 4, 36);
        assert_location_char(source, &loc, '(');
    }
}
