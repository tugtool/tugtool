//! Unified diff generation utilities.
//!
//! Provides functions to generate standard unified diff format from edit information.

use std::collections::HashMap;

use crate::patch::OutputEdit;

/// Generate a unified diff from edit information.
///
/// Groups edits by file and produces standard unified diff format.
/// Each edit is shown as a single-line change at its location.
pub fn generate_unified_diff(edits: &[OutputEdit]) -> String {
    // Group edits by file
    let mut by_file: HashMap<&str, Vec<&OutputEdit>> = HashMap::new();
    for edit in edits {
        by_file.entry(&edit.file).or_default().push(edit);
    }

    let mut diff = String::new();
    for (file, file_edits) in by_file {
        diff.push_str(&format!("--- a/{}\n", file));
        diff.push_str(&format!("+++ b/{}\n", file));

        for edit in file_edits {
            diff.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                edit.line, 1, edit.line, 1
            ));
            diff.push_str(&format!("-{}\n", edit.old_text));
            diff.push_str(&format!("+{}\n", edit.new_text));
        }
    }

    diff
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::Span;

    #[test]
    fn generate_diff_single_file_single_edit() {
        let edits = vec![OutputEdit {
            file: "test.py".to_string(),
            span: Span::new(4, 7),
            old_text: "foo".to_string(),
            new_text: "bar".to_string(),
            line: 1,
            col: 5,
        }];

        let diff = generate_unified_diff(&edits);

        assert!(diff.contains("--- a/test.py"));
        assert!(diff.contains("+++ b/test.py"));
        assert!(diff.contains("-foo"));
        assert!(diff.contains("+bar"));
    }

    #[test]
    fn generate_diff_multiple_edits_same_file() {
        let edits = vec![
            OutputEdit {
                file: "test.py".to_string(),
                span: Span::new(4, 7),
                old_text: "foo".to_string(),
                new_text: "bar".to_string(),
                line: 1,
                col: 5,
            },
            OutputEdit {
                file: "test.py".to_string(),
                span: Span::new(20, 23),
                old_text: "foo".to_string(),
                new_text: "bar".to_string(),
                line: 3,
                col: 5,
            },
        ];

        let diff = generate_unified_diff(&edits);

        // Should have one file header
        assert_eq!(diff.matches("--- a/test.py").count(), 1);
        // Should have two hunks (each @@ line contains @@ twice, so 4 total)
        // Count the opening @@ pattern instead
        assert_eq!(diff.matches("@@ -").count(), 2);
    }

    #[test]
    fn generate_diff_multiple_files() {
        let edits = vec![
            OutputEdit {
                file: "a.py".to_string(),
                span: Span::new(0, 3),
                old_text: "aaa".to_string(),
                new_text: "bbb".to_string(),
                line: 1,
                col: 1,
            },
            OutputEdit {
                file: "b.py".to_string(),
                span: Span::new(0, 3),
                old_text: "xxx".to_string(),
                new_text: "yyy".to_string(),
                line: 1,
                col: 1,
            },
        ];

        let diff = generate_unified_diff(&edits);

        assert!(diff.contains("--- a/a.py"));
        assert!(diff.contains("--- a/b.py"));
        assert!(diff.contains("-aaa"));
        assert!(diff.contains("+bbb"));
        assert!(diff.contains("-xxx"));
        assert!(diff.contains("+yyy"));
    }

    #[test]
    fn generate_diff_empty_edits() {
        let edits: Vec<OutputEdit> = vec![];
        let diff = generate_unified_diff(&edits);
        assert!(diff.is_empty());
    }
}
