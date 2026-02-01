// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Tests for type comment renaming in the rename operation.
//!
//! PEP 484 type comments (`# type: T`) are legacy annotations that should be
//! updated when renaming symbols.

use tugtool_python::ops::rename::{collect_rename_edits, rename_in_file};

// ============================================================================
// Type Comment Rename Tests - rename_in_file
// ============================================================================

#[test]
fn test_rename_type_comment_simple() {
    // Simple type comment
    let source = "handler = get_handler()  # type: Handler\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(result, "handler = get_handler()  # type: RequestHandler\n");
}

#[test]
fn test_rename_type_comment_generic() {
    // Generic type in comment
    let source = "handlers = []  # type: List[Handler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(result, "handlers = []  # type: List[RequestHandler]\n");
}

#[test]
fn test_rename_type_comment_multiple_occurrences() {
    // Same type appears multiple times
    let source = "mapping = {}  # type: Dict[Handler, Handler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "mapping = {}  # type: Dict[RequestHandler, RequestHandler]\n"
    );
}

#[test]
fn test_rename_type_comment_function_signature() {
    // Function signature type comment
    let source = "def process(x):  # type: (Handler) -> Handler\n    pass\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "def process(x):  # type: (RequestHandler) -> RequestHandler\n    pass\n"
    );
}

#[test]
fn test_rename_type_comment_qualified() {
    // Qualified type name
    let source = "handler = None  # type: module.Handler\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(result, "handler = None  # type: module.RequestHandler\n");
}

#[test]
fn test_rename_type_comment_with_binding() {
    // Type comment AND binding should both be renamed
    let source = "Handler = create_handler()  # type: Handler\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "RequestHandler = create_handler()  # type: RequestHandler\n"
    );
}

#[test]
fn test_rename_type_comment_preserves_other_types() {
    // Other types should not be affected
    let source = "mapping = {}  # type: Dict[str, Handler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "mapping = {}  # type: Dict[str, RequestHandler]\n"
    );
}

#[test]
fn test_rename_type_comment_ignore_unchanged() {
    // Type ignore should not be affected
    let source = "value = get_value()  # type: ignore\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(result, source);
}

#[test]
fn test_rename_type_comment_multiple_lines() {
    // Multiple type comments in different lines
    let source = r#"x = get_x()  # type: Handler
y = get_y()  # type: Handler
z = get_z()  # type: int
"#;
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    let expected = r#"x = get_x()  # type: RequestHandler
y = get_y()  # type: RequestHandler
z = get_z()  # type: int
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Type Comment Rename Tests - collect_rename_edits
// ============================================================================

#[test]
fn test_collect_rename_edits_includes_type_comments() {
    let source = "handler = get_handler()  # type: Handler\n";
    let edits = collect_rename_edits(source, "Handler", "RequestHandler").unwrap();

    // Should have exactly one edit for the type comment
    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0].old_text, "# type: Handler");
    assert_eq!(edits[0].new_text, "# type: RequestHandler");
}

#[test]
fn test_collect_rename_edits_binding_and_type_comment() {
    let source = "Handler = create()  # type: Handler\n";
    let edits = collect_rename_edits(source, "Handler", "RequestHandler").unwrap();

    // Should have two edits: one for binding, one for type comment
    assert_eq!(edits.len(), 2);

    // Edits are sorted by span.start, so binding comes first
    assert_eq!(edits[0].old_text, "Handler");
    assert_eq!(edits[0].new_text, "RequestHandler");
    assert_eq!(edits[1].old_text, "# type: Handler");
    assert_eq!(edits[1].new_text, "# type: RequestHandler");
}

// ============================================================================
// Type Comment Rename Tests - Edge Cases
// ============================================================================

#[test]
fn test_rename_type_comment_optional() {
    let source = "handler = None  # type: Optional[Handler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "handler = None  # type: Optional[RequestHandler]\n"
    );
}

#[test]
fn test_rename_type_comment_union() {
    let source = "handler = None  # type: Union[Handler, OtherHandler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "handler = None  # type: Union[RequestHandler, OtherHandler]\n"
    );
}

#[test]
fn test_rename_type_comment_callable() {
    let source = "callback = None  # type: Callable[[Handler], Handler]\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "callback = None  # type: Callable[[RequestHandler], RequestHandler]\n"
    );
}

#[test]
fn test_rename_type_comment_tuple_unpack() {
    let source = "x, y = get_pair()  # type: Handler, Handler\n";
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    assert_eq!(
        result,
        "x, y = get_pair()  # type: RequestHandler, RequestHandler\n"
    );
}
