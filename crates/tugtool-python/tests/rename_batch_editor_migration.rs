// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Migration validation tests for BatchSpanEditor rename implementation.
//!
//! These tests verify that the new `apply_batch_edits` implementation produces
//! identical results to the legacy `rewrite_batch` implementation.

use tugtool_core::patch::Span;
use tugtool_python::cst_bridge::{apply_batch_edits, rewrite_batch, rewrites_to_edit_primitives};
use tugtool_python_cst::visitor::EditPrimitive;

// ============================================================================
// Unit Tests: BatchSpanEditor Basic Operations
// ============================================================================

#[test]
fn test_batch_editor_single_rename() {
    let source = "def foo():\n    pass";
    let edits = vec![EditPrimitive::Replace {
        span: Span::new(4, 7),
        new_text: "bar".to_string(),
    }];

    let result = apply_batch_edits(source, edits).expect("apply should succeed");
    assert_eq!(result, "def bar():\n    pass");
}

#[test]
fn test_batch_editor_multiple_renames() {
    let source = "def foo():\n    return foo";
    let edits = vec![
        EditPrimitive::Replace {
            span: Span::new(4, 7),
            new_text: "bar".to_string(),
        },
        EditPrimitive::Replace {
            span: Span::new(22, 25),
            new_text: "bar".to_string(),
        },
    ];

    let result = apply_batch_edits(source, edits).expect("apply should succeed");
    assert_eq!(result, "def bar():\n    return bar");
}

#[test]
fn test_batch_editor_preserves_formatting() {
    let source = "def   foo   ():\n    # Comment\n    return foo\n";
    let edits = vec![
        EditPrimitive::Replace {
            span: Span::new(6, 9), // "foo" with extra spaces around
            new_text: "bar".to_string(),
        },
        EditPrimitive::Replace {
            span: Span::new(41, 44), // "foo" in return
            new_text: "bar".to_string(),
        },
    ];

    let result = apply_batch_edits(source, edits).expect("apply should succeed");
    assert!(result.contains("# Comment"), "comment should be preserved");
    assert!(
        result.contains("def   bar   ()"),
        "spacing should be preserved"
    );
    assert!(result.contains("return bar"), "return should be renamed");
}

#[test]
fn test_batch_editor_unicode_spans() {
    // Test with UTF-8 characters - byte offsets must be correct
    let source = "def héllo():\n    pass";
    // "héllo" starts at byte 4, 'é' is 2 bytes
    // So "héllo" is bytes 4-10 (h=4, é=5-6, l=7, l=8, o=9, end=10)
    let edits = vec![EditPrimitive::Replace {
        span: Span::new(4, 10),
        new_text: "world".to_string(),
    }];

    let result = apply_batch_edits(source, edits).expect("apply should succeed");
    assert_eq!(result, "def world():\n    pass");
}

#[test]
fn test_batch_editor_empty_edits() {
    let source = "def foo(): pass";
    let edits: Vec<EditPrimitive> = vec![];

    let result = apply_batch_edits(source, edits).expect("empty edits should succeed");
    assert_eq!(result, source, "empty edits should return unchanged source");
}

// ============================================================================
// Integration Tests: Migration Comparison (Legacy vs New)
// ============================================================================

#[test]
fn test_rename_migration_simple() {
    // Compare legacy rewrite_batch with new apply_batch_edits
    let source = "def foo():\n    return foo";
    let rewrites = vec![
        (Span::new(4, 7), "bar".to_string()),
        (Span::new(22, 25), "bar".to_string()),
    ];

    let legacy_result = rewrite_batch(source, &rewrites).expect("legacy should succeed");
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits).expect("new should succeed");

    assert_eq!(
        legacy_result, new_result,
        "legacy and new implementations should produce identical output"
    );
}

#[test]
fn test_rename_migration_multifile_simulation() {
    // Simulate multi-file rename by running on multiple source strings
    // Use simple sources where we can easily calculate byte offsets

    // file_a.py: "def foo():\n    foo()"
    //             ^   ^          ^
    //             0   4          15
    let source_a = "def foo():\n    foo()";
    let edits_a = vec![
        (Span::new(4, 7), "bar".to_string()),   // "foo" in def
        (Span::new(15, 18), "bar".to_string()), // "foo" in call
    ];

    let legacy_a = rewrite_batch(source_a, &edits_a).expect("legacy should succeed");
    let new_a = apply_batch_edits(source_a, rewrites_to_edit_primitives(&edits_a))
        .expect("new should succeed");
    assert_eq!(legacy_a, new_a, "file_a should match");
    assert_eq!(new_a, "def bar():\n    bar()");

    // file_b.py: "x = foo"
    //             ^   ^
    //             0   4
    let source_b = "x = foo";
    let edits_b = vec![(Span::new(4, 7), "bar".to_string())];

    let legacy_b = rewrite_batch(source_b, &edits_b).expect("legacy should succeed");
    let new_b = apply_batch_edits(source_b, rewrites_to_edit_primitives(&edits_b))
        .expect("new should succeed");
    assert_eq!(legacy_b, new_b, "file_b should match");
    assert_eq!(new_b, "x = bar");

    // file_c.py: "foo + foo"
    //             ^     ^
    //             0     6
    let source_c = "foo + foo";
    let edits_c = vec![
        (Span::new(0, 3), "bar".to_string()),
        (Span::new(6, 9), "bar".to_string()),
    ];

    let legacy_c = rewrite_batch(source_c, &edits_c).expect("legacy should succeed");
    let new_c = apply_batch_edits(source_c, rewrites_to_edit_primitives(&edits_c))
        .expect("new should succeed");
    assert_eq!(legacy_c, new_c, "file_c should match");
    assert_eq!(new_c, "bar + bar");
}

#[test]
fn test_rename_migration_complex() {
    // Complex case with many renames - use a simpler source with verified offsets
    // Byte positions:
    // "class Foo:\n    x = Foo()\n    y = Foo"
    //  0     6  9 10   15  19  22 23   28  32
    let source = "class Foo:\n    x = Foo()\n    y = Foo";

    // Verify byte positions before defining edits
    assert_eq!(&source[6..9], "Foo"); // class Foo
    assert_eq!(&source[19..22], "Foo"); // x = Foo()
    assert_eq!(&source[33..36], "Foo"); // y = Foo

    let rewrites = vec![
        (Span::new(6, 9), "Bar".to_string()),   // class Foo
        (Span::new(19, 22), "Bar".to_string()), // x = Foo()
        (Span::new(33, 36), "Bar".to_string()), // y = Foo
    ];

    let legacy_result = rewrite_batch(source, &rewrites).expect("legacy should succeed");
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits).expect("new should succeed");

    assert_eq!(
        legacy_result, new_result,
        "legacy and new implementations should produce identical output for complex case"
    );

    assert_eq!(new_result, "class Bar:\n    x = Bar()\n    y = Bar");
}

#[test]
fn test_rename_migration_adjacent_spans() {
    // Test adjacent spans (one ends where another begins)
    let source = "foobar";
    let rewrites = vec![
        (Span::new(0, 3), "FOO".to_string()),
        (Span::new(3, 6), "BAR".to_string()),
    ];

    let legacy_result = rewrite_batch(source, &rewrites).expect("legacy should succeed");
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits).expect("new should succeed");

    assert_eq!(
        legacy_result, new_result,
        "adjacent spans should work identically"
    );
    assert_eq!(new_result, "FOOBAR");
}

#[test]
fn test_rename_migration_varying_lengths() {
    // Test renames that change text length significantly
    let source = "x = 1\ny = x";
    let rewrites = vec![
        (Span::new(0, 1), "very_long_variable_name".to_string()),
        (Span::new(10, 11), "very_long_variable_name".to_string()),
    ];

    let legacy_result = rewrite_batch(source, &rewrites).expect("legacy should succeed");
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits).expect("new should succeed");

    assert_eq!(
        legacy_result, new_result,
        "varying lengths should work identically"
    );
    assert_eq!(
        new_result,
        "very_long_variable_name = 1\ny = very_long_variable_name"
    );
}

// ============================================================================
// Error Case Comparison
// ============================================================================

#[test]
fn test_migration_out_of_bounds_error() {
    let source = "short";
    let rewrites = vec![(Span::new(0, 100), "x".to_string())];

    let legacy_result = rewrite_batch(source, &rewrites);
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits);

    // Both should fail
    assert!(legacy_result.is_err(), "legacy should fail");
    assert!(new_result.is_err(), "new should fail");
}

#[test]
fn test_migration_overlapping_spans_error() {
    let source = "hello world";
    let rewrites = vec![
        (Span::new(0, 7), "hi".to_string()),     // "hello w"
        (Span::new(5, 11), "there".to_string()), // " world" - overlaps!
    ];

    let legacy_result = rewrite_batch(source, &rewrites);
    let edits = rewrites_to_edit_primitives(&rewrites);
    let new_result = apply_batch_edits(source, edits);

    // Both should fail due to overlapping spans
    assert!(legacy_result.is_err(), "legacy should fail for overlaps");
    assert!(new_result.is_err(), "new should fail for overlaps");
}
