// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Round-trip tests for the tugtool-python-cst parser.
//!
//! These tests verify that `parse(code).codegen() == code` for all valid Python.
//! This is a fundamental invariant for refactoring operations.
//!
//! # Test Organization
//!
//! - Fixture-based tests: One test per fixture file in `tests/fixtures/`
//! - Inline tests: Individual test cases for specific Python constructs
//!
//! # Adding New Tests
//!
//! To add a new fixture-based test, create a `.py` file in `tests/fixtures/`
//! and add a corresponding `roundtrip_fixture_<name>` test function.

use difference::assert_diff;
use itertools::Itertools;
use tugtool_python_cst::{parse_module, prettify_error, Codegen};
use std::path::PathBuf;

/// Helper to visualize whitespace differences in test output
fn visualize(s: &str) -> String {
    s.replace(' ', "▩").lines().join("↩\n")
}

/// Helper to perform round-trip test on source code
fn assert_roundtrip(input: &str, label: &str) {
    // Handle UTF-8 BOM if present
    let input = if let Some(stripped) = input.strip_prefix('\u{feff}') {
        stripped
    } else {
        input
    };

    let module = match parse_module(input, None) {
        Ok(m) => m,
        Err(e) => panic!("{}", prettify_error(e, label)),
    };

    let mut state = Default::default();
    module.codegen(&mut state);
    let generated = state.to_string();

    if generated != input {
        let got = visualize(&generated);
        let expected = visualize(input);
        assert_diff!(expected.as_ref(), got.as_ref(), "", 0);
    }
}

/// Helper to load and test a fixture file
fn assert_roundtrip_fixture(fixture_name: &str) {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("fixtures");
    path.push(fixture_name);

    let contents = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", fixture_name, e));

    assert_roundtrip(&contents, fixture_name);
}

// =============================================================================
// Fixture-based round-trip tests
// =============================================================================
//
// Each test loads a fixture file from tests/fixtures/ and verifies round-trip.

#[test]
fn roundtrip_fixture_big_binary_operator() {
    assert_roundtrip_fixture("big_binary_operator.py");
}

#[test]
fn roundtrip_fixture_class_craziness() {
    assert_roundtrip_fixture("class_craziness.py");
}

#[test]
fn roundtrip_fixture_comments() {
    assert_roundtrip_fixture("comments.py");
}

#[test]
fn roundtrip_fixture_comparisons() {
    assert_roundtrip_fixture("comparisons.py");
}

#[test]
fn roundtrip_fixture_dangling_indent() {
    assert_roundtrip_fixture("dangling_indent.py");
}

#[test]
fn roundtrip_fixture_decorated_function_without_body() {
    assert_roundtrip_fixture("decorated_function_without_body.py");
}

#[test]
fn roundtrip_fixture_dysfunctional_del() {
    assert_roundtrip_fixture("dysfunctional_del.py");
}

#[test]
fn roundtrip_fixture_expr() {
    assert_roundtrip_fixture("expr.py");
}

#[test]
fn roundtrip_fixture_expr_statement() {
    assert_roundtrip_fixture("expr_statement.py");
}

#[test]
fn roundtrip_fixture_fun_with_func_defs() {
    assert_roundtrip_fixture("fun_with_func_defs.py");
}

#[test]
fn roundtrip_fixture_global_nonlocal() {
    assert_roundtrip_fixture("global_nonlocal.py");
}

#[test]
fn roundtrip_fixture_import() {
    assert_roundtrip_fixture("import.py");
}

#[test]
fn roundtrip_fixture_indents_but_no_eol_before_eof() {
    assert_roundtrip_fixture("indents_but_no_eol_before_eof.py");
}

#[test]
fn roundtrip_fixture_just_a_comment_without_nl() {
    assert_roundtrip_fixture("just_a_comment_without_nl.py");
}

#[test]
fn roundtrip_fixture_malicious_match() {
    assert_roundtrip_fixture("malicious_match.py");
}

#[test]
fn roundtrip_fixture_mixed_newlines() {
    assert_roundtrip_fixture("mixed_newlines.py");
}

#[test]
fn roundtrip_fixture_pep646() {
    assert_roundtrip_fixture("pep646.py");
}

#[test]
fn roundtrip_fixture_raise() {
    assert_roundtrip_fixture("raise.py");
}

#[test]
fn roundtrip_fixture_smol_statements() {
    assert_roundtrip_fixture("smol_statements.py");
}

#[test]
fn roundtrip_fixture_spacious_spaces() {
    assert_roundtrip_fixture("spacious_spaces.py");
}

#[test]
fn roundtrip_fixture_starry_tries() {
    assert_roundtrip_fixture("starry_tries.py");
}

#[test]
fn roundtrip_fixture_suicidal_slices() {
    assert_roundtrip_fixture("suicidal_slices.py");
}

#[test]
fn roundtrip_fixture_super_strings() {
    assert_roundtrip_fixture("super_strings.py");
}

#[test]
fn roundtrip_fixture_terrible_tries() {
    assert_roundtrip_fixture("terrible_tries.py");
}

#[test]
fn roundtrip_fixture_trailing_comment_without_nl() {
    assert_roundtrip_fixture("trailing_comment_without_nl.py");
}

#[test]
fn roundtrip_fixture_trailing_whitespace() {
    assert_roundtrip_fixture("trailing_whitespace.py");
}

#[test]
fn roundtrip_fixture_tuple_shenanigans() {
    assert_roundtrip_fixture("tuple_shenanigans.py");
}

#[test]
fn roundtrip_fixture_type_parameters() {
    assert_roundtrip_fixture("type_parameters.py");
}

#[test]
fn roundtrip_fixture_vast_emptiness() {
    assert_roundtrip_fixture("vast_emptiness.py");
}

#[test]
fn roundtrip_fixture_with_wickedness() {
    assert_roundtrip_fixture("with_wickedness.py");
}

#[test]
fn roundtrip_fixture_wonky_walrus() {
    assert_roundtrip_fixture("wonky_walrus.py");
}

// =============================================================================
// Inline round-trip tests for specific constructs
// =============================================================================
//
// These tests verify specific Python constructs directly without fixture files.

// --- Simple functions, classes, methods ---

#[test]
fn roundtrip_simple_function() {
    assert_roundtrip(
        r#"def greet(name):
    return "Hello, " + name
"#,
        "simple_function",
    );
}

#[test]
fn roundtrip_function_with_defaults() {
    assert_roundtrip(
        r#"def greet(name="World", greeting="Hello"):
    return f"{greeting}, {name}!"
"#,
        "function_with_defaults",
    );
}

#[test]
fn roundtrip_simple_class() {
    assert_roundtrip(
        r#"class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
"#,
        "simple_class",
    );
}

#[test]
fn roundtrip_class_with_inheritance() {
    assert_roundtrip(
        r#"class Animal:
    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "Woof!"
"#,
        "class_with_inheritance",
    );
}

#[test]
fn roundtrip_class_method_staticmethod() {
    assert_roundtrip(
        r#"class Counter:
    count = 0

    @classmethod
    def increment(cls):
        cls.count += 1

    @staticmethod
    def reset():
        Counter.count = 0
"#,
        "class_method_staticmethod",
    );
}

// --- Complex expressions ---

#[test]
fn roundtrip_list_comprehension() {
    assert_roundtrip(
        r#"squares = [x ** 2 for x in range(10)]
"#,
        "list_comprehension",
    );
}

#[test]
fn roundtrip_nested_comprehension() {
    assert_roundtrip(
        r#"matrix = [[i * j for j in range(5)] for i in range(5)]
"#,
        "nested_comprehension",
    );
}

#[test]
fn roundtrip_dict_comprehension() {
    assert_roundtrip(
        r#"squares = {x: x ** 2 for x in range(10)}
"#,
        "dict_comprehension",
    );
}

#[test]
fn roundtrip_set_comprehension() {
    assert_roundtrip(
        r#"unique = {x % 5 for x in range(20)}
"#,
        "set_comprehension",
    );
}

#[test]
fn roundtrip_generator_expression() {
    assert_roundtrip(
        r#"gen = (x ** 2 for x in range(10))
"#,
        "generator_expression",
    );
}

#[test]
fn roundtrip_comprehension_with_filter() {
    assert_roundtrip(
        r#"evens = [x for x in range(20) if x % 2 == 0]
"#,
        "comprehension_with_filter",
    );
}

#[test]
fn roundtrip_fstring_basic() {
    assert_roundtrip(
        r#"name = "World"
message = f"Hello, {name}!"
"#,
        "fstring_basic",
    );
}

#[test]
fn roundtrip_fstring_expressions() {
    assert_roundtrip(
        r#"value = 42
result = f"The answer is {value * 2} or {value + 1}"
"#,
        "fstring_expressions",
    );
}

// --- Statement types ---

#[test]
fn roundtrip_if_elif_else() {
    assert_roundtrip(
        r#"if x > 0:
    print("positive")
elif x < 0:
    print("negative")
else:
    print("zero")
"#,
        "if_elif_else",
    );
}

#[test]
fn roundtrip_for_loop() {
    assert_roundtrip(
        r#"for i in range(10):
    print(i)
"#,
        "for_loop",
    );
}

#[test]
fn roundtrip_while_loop() {
    assert_roundtrip(
        r#"while condition:
    do_something()
"#,
        "while_loop",
    );
}

#[test]
fn roundtrip_try_except_finally() {
    assert_roundtrip(
        r#"try:
    risky_operation()
except ValueError as e:
    handle_error(e)
finally:
    cleanup()
"#,
        "try_except_finally",
    );
}

#[test]
fn roundtrip_with_statement() {
    assert_roundtrip(
        r#"with open("file.txt") as f:
    content = f.read()
"#,
        "with_statement",
    );
}

#[test]
fn roundtrip_match_statement() {
    assert_roundtrip(
        r#"match command:
    case "quit":
        sys.exit()
    case "help":
        show_help()
    case _:
        print("Unknown command")
"#,
        "match_statement",
    );
}

// --- Decorators and annotations ---

#[test]
fn roundtrip_decorated_function() {
    assert_roundtrip(
        r#"@decorator
def function():
    pass
"#,
        "decorated_function",
    );
}

#[test]
fn roundtrip_multiple_decorators() {
    assert_roundtrip(
        r#"@decorator1
@decorator2(arg)
@decorator3(key="value")
def function():
    pass
"#,
        "multiple_decorators",
    );
}

#[test]
fn roundtrip_type_annotations() {
    assert_roundtrip(
        r#"def process(items: list[str], count: int = 10) -> dict[str, int]:
    result: dict[str, int] = {}
    return result
"#,
        "type_annotations",
    );
}

#[test]
fn roundtrip_annotated_class() {
    assert_roundtrip(
        r#"class DataClass:
    name: str
    value: int
    items: list[str] = []
"#,
        "annotated_class",
    );
}

// --- Async constructs ---

#[test]
fn roundtrip_async_function() {
    assert_roundtrip(
        r#"async def fetch_data(url: str) -> bytes:
    return await client.get(url)
"#,
        "async_function",
    );
}

#[test]
fn roundtrip_async_with() {
    assert_roundtrip(
        r#"async def read_file():
    async with aiofiles.open("file.txt") as f:
        content = await f.read()
"#,
        "async_with",
    );
}

#[test]
fn roundtrip_async_for() {
    assert_roundtrip(
        r#"async def process_items():
    async for item in async_iterator():
        await process(item)
"#,
        "async_for",
    );
}

#[test]
fn roundtrip_async_comprehension() {
    assert_roundtrip(
        r#"async def gather_results():
    results = [item async for item in async_iterator()]
"#,
        "async_comprehension",
    );
}

// --- Edge cases and special syntax ---

#[test]
fn roundtrip_walrus_operator() {
    assert_roundtrip(
        r#"if (n := len(data)) > 10:
    print(f"Got {n} items")
"#,
        "walrus_operator",
    );
}

#[test]
fn roundtrip_starred_expressions() {
    assert_roundtrip(
        r#"first, *rest = items
a, *middle, z = values
"#,
        "starred_expressions",
    );
}

#[test]
fn roundtrip_lambda() {
    assert_roundtrip(
        r#"double = lambda x: x * 2
process = lambda a, b, c=0: a + b + c
"#,
        "lambda",
    );
}

#[test]
fn roundtrip_positional_only_params() {
    assert_roundtrip(
        r#"def func(x, y, /, z):
    return x + y + z
"#,
        "positional_only_params",
    );
}

#[test]
fn roundtrip_keyword_only_params() {
    assert_roundtrip(
        r#"def func(x, *, y, z):
    return x + y + z
"#,
        "keyword_only_params",
    );
}

#[test]
fn roundtrip_unicode_identifiers() {
    assert_roundtrip(
        r#"变量 = 42
def 函数(参数):
    return 参数 * 2
"#,
        "unicode_identifiers",
    );
}

#[test]
fn roundtrip_empty_module() {
    assert_roundtrip("", "empty_module");
}

#[test]
fn roundtrip_module_docstring() {
    assert_roundtrip(
        r#""""Module docstring.

This module does important things.
"""

import sys
"#,
        "module_docstring",
    );
}
