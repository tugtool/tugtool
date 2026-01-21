// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Performance benchmarks for tugtool-python-cst parser and visitors.
//!
//! Run with:
//! ```bash
//! cargo bench -p tugtool-python-cst
//! ```
//!
//! # Benchmark Categories
//!
//! 1. **Parsing**: Measure parse_module performance on various file sizes
//! 2. **Analysis**: Measure full analysis (all collectors) performance
//! 3. **Rename**: Measure rename transformer performance
//!
//! # Performance Target
//!
//! The native CST implementation achieves 18-19x faster analysis than the original
//! Python-based implementation for typical workloads.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::hint::black_box;
use std::fs;
use std::path::PathBuf;
use tugtool_python_cst::{
    parse_module, parse_module_with_positions, AnnotationCollector, BindingCollector, Codegen,
    CodegenState, DynamicPatternDetector, ImportCollector, InheritanceCollector,
    MethodCallCollector, ReferenceCollector, RenameRequest, RenameTransformer, ScopeCollector,
    TypeInferenceCollector,
};

// =============================================================================
// Test Data Generation
// =============================================================================

/// Generate a simple Python function with increasing complexity.
fn generate_simple_code(num_funcs: usize) -> String {
    let mut code = String::new();
    for i in 0..num_funcs {
        code.push_str(&format!(
            r#"def func_{i}(arg1, arg2, arg3=None):
    """Docstring for func_{i}."""
    result = arg1 + arg2
    if arg3:
        result *= arg3
    return result

"#
        ));
    }
    code
}

/// Generate Python code with classes and methods.
fn generate_class_code(num_classes: usize) -> String {
    let mut code = String::new();
    for i in 0..num_classes {
        code.push_str(&format!(
            r#"class MyClass{i}:
    """Class {i} docstring."""

    def __init__(self, value):
        self.value = value

    def process(self, data):
        return self.value + data

    def transform(self, items):
        result = []
        for item in items:
            result.append(self.process(item))
        return result

"#
        ));
    }
    code
}

/// Generate Python code with comprehensions.
fn generate_comprehension_code(num_comps: usize) -> String {
    let mut code = String::new();
    for i in 0..num_comps {
        code.push_str(&format!(
            r#"list_{i} = [x * 2 for x in range({i} + 10) if x % 2 == 0]
dict_{i} = {{k: v for k, v in enumerate(list_{i})}}
set_{i} = {{x ** 2 for x in list_{i}}}
gen_{i} = (x + 1 for x in list_{i} if x > 5)

"#
        ));
    }
    code
}

/// Load a fixture file for benchmarking.
fn load_fixture(name: &str) -> String {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("fixtures");
    path.push(name);

    fs::read_to_string(&path).unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", name, e))
}

// =============================================================================
// Parsing Benchmarks
// =============================================================================

fn bench_parse_simple(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_simple");

    for size in [10, 50, 100, 200].iter() {
        let code = generate_simple_code(*size);
        let bytes = code.len();

        group.throughput(Throughput::Bytes(bytes as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_funcs", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let _ = black_box(parse_module(code, None).unwrap());
                });
            },
        );
    }

    group.finish();
}

fn bench_parse_classes(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_classes");

    for size in [10, 50, 100].iter() {
        let code = generate_class_code(*size);
        let bytes = code.len();

        group.throughput(Throughput::Bytes(bytes as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let _ = black_box(parse_module(code, None).unwrap());
                });
            },
        );
    }

    group.finish();
}

fn bench_parse_comprehensions(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_comprehensions");

    for size in [10, 50, 100].iter() {
        let code = generate_comprehension_code(*size);
        let bytes = code.len();

        group.throughput(Throughput::Bytes(bytes as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_comps", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let _ = black_box(parse_module(code, None).unwrap());
                });
            },
        );
    }

    group.finish();
}

fn bench_parse_fixtures(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_fixtures");

    // Benchmark on real fixture files
    let fixtures = [
        ("expr.py", load_fixture("expr.py")),
        ("fun_with_func_defs.py", load_fixture("fun_with_func_defs.py")),
        ("class_craziness.py", load_fixture("class_craziness.py")),
    ];

    for (name, code) in fixtures.iter() {
        let bytes = code.len();
        group.throughput(Throughput::Bytes(bytes as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), code, |b, code| {
            b.iter(|| {
                let _ = black_box(parse_module(code, None).unwrap());
            });
        });
    }

    group.finish();
}

/// Benchmark parse_module vs parse_module_with_positions to measure position tracking overhead.
fn bench_parse_with_positions(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_with_positions");

    for size in [50, 100, 200].iter() {
        let code = generate_class_code(*size);
        let bytes = code.len();

        group.throughput(Throughput::Bytes(bytes as u64));

        // Benchmark parse_module (without position tracking)
        group.bench_with_input(
            BenchmarkId::new("parse_module", format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let _ = black_box(parse_module(code, None).unwrap());
                });
            },
        );

        // Benchmark parse_module_with_positions (with position tracking)
        group.bench_with_input(
            BenchmarkId::new("parse_with_positions", format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let _ = black_box(parse_module_with_positions(code, None).unwrap());
                });
            },
        );
    }

    group.finish();
}

// =============================================================================
// Analysis Benchmarks
// =============================================================================

fn bench_scope_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("scope_analysis");

    for size in [50, 100, 200].iter() {
        let code = generate_class_code(*size);

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    let _ = black_box(ScopeCollector::collect(&module, code));
                });
            },
        );
    }

    group.finish();
}

fn bench_binding_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("binding_analysis");

    for size in [50, 100, 200].iter() {
        let code = generate_class_code(*size);

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    let _ = black_box(BindingCollector::collect(&module, code));
                });
            },
        );
    }

    group.finish();
}

fn bench_reference_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("reference_analysis");

    for size in [50, 100, 200].iter() {
        let code = generate_class_code(*size);

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    let _ = black_box(ReferenceCollector::collect(&module, code));
                });
            },
        );
    }

    group.finish();
}

fn bench_full_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("full_analysis");

    for size in [50, 100].iter() {
        let code = generate_class_code(*size);

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    // Run all P0 collectors
                    let _ = black_box(ScopeCollector::collect(&module, code));
                    let _ = black_box(BindingCollector::collect(&module, code));
                    let _ = black_box(ReferenceCollector::collect(&module, code));
                    // Run all P1 collectors
                    let _ = black_box(ImportCollector::collect(&module, code));
                    let _ = black_box(AnnotationCollector::collect(&module, code));
                    let _ = black_box(TypeInferenceCollector::collect(&module, code));
                    let _ = black_box(InheritanceCollector::collect(&module, code));
                    let _ = black_box(MethodCallCollector::collect(&module, code));
                    // Run P2 collector
                    let _ = black_box(DynamicPatternDetector::collect(&module, code));
                });
            },
        );
    }

    group.finish();
}

/// Benchmark analysis using position-aware parsing vs legacy collect() methods.
/// This compares the new approach (single parse + position table) vs old approach
/// (parse_module + each collector's internal re-parse for positions).
fn bench_analysis_with_positions(c: &mut Criterion) {
    let mut group = c.benchmark_group("analysis_with_positions");

    for size in [50, 100].iter() {
        let code = generate_class_code(*size);

        // Benchmark the legacy approach: parse_module + collect() methods
        // Note: The collect() methods internally call parse_module_with_positions
        // for each collector that needs positions, resulting in multiple parses.
        group.bench_with_input(
            BenchmarkId::new("legacy_collect", format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    // P0 collectors (each internally parses with positions)
                    let _ = black_box(ScopeCollector::collect(&module, code));
                    let _ = black_box(BindingCollector::collect(&module, code));
                    let _ = black_box(ReferenceCollector::collect(&module, code));
                });
            },
        );

        // Benchmark the new approach: single parse_module_with_positions + collect_with_positions
        // This parses once and shares the PositionTable across all collectors.
        group.bench_with_input(
            BenchmarkId::new("position_aware", format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let parsed = parse_module_with_positions(code, None).unwrap();
                    // P0 collectors using shared PositionTable
                    let _ = black_box(ScopeCollector::collect_with_positions(
                        &parsed.module,
                        &parsed.positions,
                        code,
                    ));
                    let _ = black_box(BindingCollector::collect_with_positions(
                        &parsed.module,
                        &parsed.positions,
                    ));
                    let _ = black_box(ReferenceCollector::collect_with_positions(
                        &parsed.module,
                        &parsed.positions,
                    ));
                });
            },
        );
    }

    group.finish();
}

// =============================================================================
// Rename Benchmarks
// =============================================================================

fn bench_rename_single(c: &mut Criterion) {
    let mut group = c.benchmark_group("rename_single");

    // Code with a function to rename
    let code = r#"def process(data):
    result = data * 2
    return result

def main():
    x = process(42)
    y = process(100)
    z = process(x + y)
    return z
"#;

    group.bench_function("single_rename", |b| {
        b.iter(|| {
            let request = RenameRequest::from_offsets(4, 11, "transform"); // "process"
            let transformer = RenameTransformer::new(code, vec![request]);
            let result = transformer.apply();
            let _ = black_box(result);
        });
    });

    group.finish();
}

fn bench_rename_batch(c: &mut Criterion) {
    let mut group = c.benchmark_group("rename_batch");

    // Code with multiple functions to rename
    let code = generate_simple_code(20);
    let module = parse_module(&code, None).unwrap();
    let bindings = BindingCollector::collect(&module, &code);

    // Collect all function definition spans
    let requests: Vec<_> = bindings
        .iter()
        .filter(|b| b.kind.as_str() == "function")
        .filter_map(|b| {
            b.span.map(|sp| RenameRequest::from_offsets(sp.start, sp.end, format!("renamed_{}", b.name)))
        })
        .collect();

    let num_renames = requests.len();

    group.bench_function(format!("{}_renames", num_renames), |b| {
        b.iter(|| {
            let transformer = RenameTransformer::new(&code, requests.clone());
            let result = transformer.apply();
            let _ = black_box(result);
        });
    });

    group.finish();
}

// =============================================================================
// Codegen Benchmarks
// =============================================================================

fn bench_codegen(c: &mut Criterion) {
    let mut group = c.benchmark_group("codegen");

    for size in [50, 100, 200].iter() {
        let code = generate_class_code(*size);
        let module = parse_module(&code, None).unwrap();

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &module,
            |b, module| {
                b.iter(|| {
                    let mut state = CodegenState::default();
                    module.codegen(&mut state);
                    let _ = black_box(state.to_string());
                });
            },
        );
    }

    group.finish();
}

// =============================================================================
// Round-trip Benchmarks
// =============================================================================

fn bench_roundtrip(c: &mut Criterion) {
    let mut group = c.benchmark_group("roundtrip");

    for size in [50, 100].iter() {
        let code = generate_class_code(*size);
        let bytes = code.len();

        group.throughput(Throughput::Bytes(bytes as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{}_classes", size)),
            &code,
            |b, code| {
                b.iter(|| {
                    let module = parse_module(code, None).unwrap();
                    let mut state = CodegenState::default();
                    module.codegen(&mut state);
                    let _ = black_box(state.to_string());
                });
            },
        );
    }

    group.finish();
}

// =============================================================================
// Benchmark Groups
// =============================================================================

criterion_group!(
    parsing,
    bench_parse_simple,
    bench_parse_classes,
    bench_parse_comprehensions,
    bench_parse_fixtures,
    bench_parse_with_positions,
);

criterion_group!(
    analysis,
    bench_scope_analysis,
    bench_binding_analysis,
    bench_reference_analysis,
    bench_full_analysis,
    bench_analysis_with_positions,
);

criterion_group!(rename, bench_rename_single, bench_rename_batch,);

criterion_group!(codegen, bench_codegen, bench_roundtrip,);

criterion_main!(parsing, analysis, rename, codegen);
