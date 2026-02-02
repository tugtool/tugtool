//! Snapshot tests for binding span information.
//!
//! These tests use insta to capture binding spans, detecting any regressions
//! in span calculation that could cause lookup failures.

use serde::Serialize;
use tugtool_python_cst::parse_module_with_positions;
use tugtool_python_cst::visitor::{BindingCollector, BindingInfo};

/// Serializable binding info for snapshots.
#[derive(Debug, Serialize)]
struct BindingSnapshot {
    name: String,
    kind: String,
    scope_path: Vec<String>,
    span_start: Option<usize>,
    span_end: Option<usize>,
}

impl From<&BindingInfo> for BindingSnapshot {
    fn from(b: &BindingInfo) -> Self {
        BindingSnapshot {
            name: b.name.clone(),
            kind: format!("{:?}", b.kind),
            scope_path: b.scope_path.clone(),
            span_start: b.span.map(|s| s.start),
            span_end: b.span.map(|s| s.end),
        }
    }
}

fn collect_bindings(source: &str) -> Vec<BindingSnapshot> {
    let parsed = parse_module_with_positions(source, None).expect("parse failed");
    let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);
    bindings.iter().map(BindingSnapshot::from).collect()
}

#[test]
fn binding_spans_walrus() {
    // Test walrus operator bindings in various contexts
    let source = r#"# Walrus operators
x = (y := 10)
while (line := input()):
    pass
results = [y for x in range(10) if (y := x * 2) > 5]
"#;

    let bindings = collect_bindings(source);
    insta::assert_yaml_snapshot!("binding_spans_walrus", bindings);
}

#[test]
fn binding_spans_comprehension() {
    // Test comprehension variable bindings
    let source = r#"# Comprehension bindings
squares = [x * x for x in range(10)]
pairs = [(x, y) for x in range(3) for y in range(3)]
filtered = {k: v for k, v in items.items() if v > 0}
gen = (x for x in data if x)
"#;

    let bindings = collect_bindings(source);
    insta::assert_yaml_snapshot!("binding_spans_comprehension", bindings);
}

#[test]
fn binding_spans_nested_class() {
    // Test nested class bindings
    let source = r#"# Nested classes
class Outer:
    x = 1

    class Inner:
        y = 2

        def method(self):
            return self.y

    def outer_method(self):
        return self.x
"#;

    let bindings = collect_bindings(source);
    insta::assert_yaml_snapshot!("binding_spans_nested_class", bindings);
}
