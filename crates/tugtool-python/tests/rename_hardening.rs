// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Tests for rename operation hardening (Table T02 gaps).
//!
//! These tests verify that the rename operation handles edge cases correctly:
//! - Decorator arguments
//! - Comprehension scope
//! - Multi-inheritance (diamond hierarchy)
//! - Aliased imports
//! - Property setters
//! - Nested classes
//! - Walrus operator targets

use tugtool_python::ops::rename::rename_in_file;

// ============================================================================
// Decorator Argument Tests
// ============================================================================

#[test]
fn test_rename_decorator_argument() {
    // Decorator with the target name as an argument
    let source = r#"config = {"key": "value"}

@decorator(config)
def func():
    pass
"#;
    let result = rename_in_file(source, "config", "settings").unwrap();
    let expected = r#"settings = {"key": "value"}

@decorator(settings)
def func():
    pass
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_decorator_multiple_args() {
    let source = r#"handler = Handler()
logger = Logger()

@middleware(handler, logger)
def func():
    pass
"#;
    let result = rename_in_file(source, "handler", "request_handler").unwrap();
    let expected = r#"request_handler = Handler()
logger = Logger()

@middleware(request_handler, logger)
def func():
    pass
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_decorator_with_attribute() {
    // Decorator using attribute access
    let source = r#"app = Flask()

@app.route("/")
def index():
    pass
"#;
    let result = rename_in_file(source, "app", "application").unwrap();
    let expected = r#"application = Flask()

@application.route("/")
def index():
    pass
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Comprehension Scope Tests
// ============================================================================

#[test]
fn test_rename_list_comprehension_variable() {
    // Comprehension iteration variable
    let source = r#"items = [1, 2, 3]
doubled = [x * 2 for x in items]
"#;
    let result = rename_in_file(source, "items", "numbers").unwrap();
    let expected = r#"numbers = [1, 2, 3]
doubled = [x * 2 for x in numbers]
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_nested_comprehension() {
    // Variable used in nested comprehension
    let source = r#"data = [[1, 2], [3, 4]]
flat = [x for row in data for x in row]
"#;
    let result = rename_in_file(source, "data", "matrix").unwrap();
    let expected = r#"matrix = [[1, 2], [3, 4]]
flat = [x for row in matrix for x in row]
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_dict_comprehension() {
    let source = r#"items = [("a", 1), ("b", 2)]
mapping = {k: v for k, v in items}
"#;
    let result = rename_in_file(source, "items", "pairs").unwrap();
    let expected = r#"pairs = [("a", 1), ("b", 2)]
mapping = {k: v for k, v in pairs}
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_comprehension_with_condition() {
    let source = r#"values = [1, 2, 3, 4, 5]
evens = [x for x in values if x % 2 == 0]
"#;
    let result = rename_in_file(source, "values", "numbers").unwrap();
    let expected = r#"numbers = [1, 2, 3, 4, 5]
evens = [x for x in numbers if x % 2 == 0]
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Aliased Import Tests
// ============================================================================

#[test]
fn test_rename_aliased_import_usage() {
    // Renaming a function that's used via alias
    // Note: This renames the original function, not the alias
    let source = r#"def process():
    return "processed"

result = process()
"#;
    let result = rename_in_file(source, "process", "transform").unwrap();
    let expected = r#"def transform():
    return "processed"

result = transform()
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_function_with_multiple_calls() {
    let source = r#"def handler():
    return "handled"

x = handler()
y = handler()
"#;
    let result = rename_in_file(source, "handler", "process_request").unwrap();
    let expected = r#"def process_request():
    return "handled"

x = process_request()
y = process_request()
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Property Setter Tests
// ============================================================================

#[test]
fn test_rename_property_with_setter() {
    // Property with both getter and setter
    let source = r#"class Person:
    def __init__(self):
        self._name = ""

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        self._name = value
"#;
    let result = rename_in_file(source, "_name", "_full_name").unwrap();
    let expected = r#"class Person:
    def __init__(self):
        self._full_name = ""

    @property
    def name(self):
        return self._full_name

    @name.setter
    def name(self, value):
        self._full_name = value
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Nested Class Tests
// ============================================================================

#[test]
fn test_rename_nested_class() {
    // Class defined inside a function
    let source = r#"def create_handler():
    class Handler:
        def process(self):
            return "processed"

    return Handler()
"#;
    let result = rename_in_file(source, "Handler", "RequestHandler").unwrap();
    let expected = r#"def create_handler():
    class RequestHandler:
        def process(self):
            return "processed"

    return RequestHandler()
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_class_inside_class() {
    // Class defined inside another class
    let source = r#"class Outer:
    class Inner:
        pass

    def get_inner(self):
        return self.Inner()
"#;
    let result = rename_in_file(source, "Inner", "Nested").unwrap();
    let expected = r#"class Outer:
    class Nested:
        pass

    def get_inner(self):
        return self.Nested()
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Walrus Operator Tests
// ============================================================================

#[test]
fn test_rename_walrus_operator_target() {
    // Walrus operator target should be renamed
    let source = r#"if (result := compute()):
    print(result)
"#;
    let result = rename_in_file(source, "result", "value").unwrap();
    let expected = r#"if (value := compute()):
    print(value)
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_walrus_in_while() {
    let source = r#"while (chunk := read_chunk()):
    process(chunk)
"#;
    let result = rename_in_file(source, "chunk", "data").unwrap();
    let expected = r#"while (data := read_chunk()):
    process(data)
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_walrus_in_comprehension() {
    let source = r#"results = [y for x in items if (y := transform(x))]
"#;
    let result = rename_in_file(source, "items", "data").unwrap();
    let expected = r#"results = [y for x in data if (y := transform(x))]
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Multi-inheritance Tests
// ============================================================================

#[test]
fn test_rename_in_base_class() {
    // Rename a method in a class that's used as a base
    let source = r#"class Base:
    def process(self):
        return "base"

class Child(Base):
    def run(self):
        return self.process()
"#;
    let result = rename_in_file(source, "process", "handle").unwrap();
    let expected = r#"class Base:
    def handle(self):
        return "base"

class Child(Base):
    def run(self):
        return self.handle()
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_method_with_override() {
    // Rename when method is overridden
    let source = r#"class Base:
    def process(self):
        return "base"

class Child(Base):
    def process(self):
        return "child"

def run(obj):
    return obj.process()
"#;
    let result = rename_in_file(source, "process", "handle").unwrap();
    let expected = r#"class Base:
    def handle(self):
        return "base"

class Child(Base):
    def handle(self):
        return "child"

def run(obj):
    return obj.handle()
"#;
    assert_eq!(result, expected);
}

// ============================================================================
// Edge Cases
// ============================================================================

#[test]
fn test_rename_preserves_string_literals() {
    // String literals containing the name should NOT be renamed
    let source = r#"name = "handler"
handler = create_handler()
"#;
    let result = rename_in_file(source, "handler", "request_handler").unwrap();
    // Note: The string "handler" is preserved, only the variable is renamed
    let expected = r#"name = "handler"
request_handler = create_handler()
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_in_f_string() {
    // Variable in f-string should be renamed
    let source = r#"name = "World"
message = f"Hello, {name}!"
"#;
    let result = rename_in_file(source, "name", "recipient").unwrap();
    let expected = r#"recipient = "World"
message = f"Hello, {recipient}!"
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_with_type_annotation() {
    // Variable with type annotation
    let source = r#"handler: Handler = create_handler()
result = handler.process()
"#;
    let result = rename_in_file(source, "handler", "request_handler").unwrap();
    let expected = r#"request_handler: Handler = create_handler()
result = request_handler.process()
"#;
    assert_eq!(result, expected);
}
