# Phase 4 Performance Benchmarks

**Date:** 2026-01-20
**Phase:** Phase 4 - Native CST Position/Span Infrastructure

## Summary

The Phase 4 position infrastructure replacement shows **no performance regression** for parsing, and provides significant speedups for analysis operations by eliminating redundant parses.

### Key Findings

1. **Parsing Performance**: No regression - `parse_module_with_positions()` is within 1% of `parse_module()`
2. **Analysis Performance**: ~3.8x faster for P0 collectors when using shared PositionTable
3. **Memory**: Position tracking adds minimal overhead (HashMap storage for tracked nodes only)

---

## Benchmark Results

### Parse Performance: parse_module vs parse_module_with_positions

Compares the overhead of position tracking during inflation.

| Input Size | parse_module | parse_with_positions | Difference |
|------------|--------------|---------------------|------------|
| 50 classes (~15 KB) | 4.58 ms | 4.43 ms | **-3.3%** (faster) |
| 100 classes (~30 KB) | 9.09 ms | 9.17 ms | +0.9% |
| 200 classes (~61 KB) | 20.03 ms | 19.97 ms | **-0.3%** (faster) |

**Conclusion:** No regression. The position tracking during inflation has essentially zero overhead because:
- NodeId assignment is a simple counter increment
- PositionTable insertions are amortized O(1) HashMap operations
- Token positions are already computed by the tokenizer

---

### Analysis Performance: Legacy vs Position-Aware

Compares the legacy `collect()` approach (each collector internally re-parses) vs the new `collect_with_positions()` approach (single parse, shared PositionTable).

| Input Size | legacy_collect | position_aware | Speedup |
|------------|----------------|----------------|---------|
| 50 classes | 17.73 ms | 4.63 ms | **3.83x** |
| 100 classes | 37.34 ms | 9.64 ms | **3.87x** |

**Why the speedup?** The legacy `collect(&module, source)` methods internally called `parse_module_with_positions(source)` to get accurate positions. With 3 P0 collectors (Scope, Binding, Reference), this meant:
- Legacy: 1 initial parse + 3 re-parses = 4 total parses
- New: 1 parse with positions shared across all collectors = 1 total parse

---

### Full Analysis Benchmark

End-to-end analysis using all collectors (P0 + P1 + P2):

| Input Size | Time |
|------------|------|
| 50 classes | 39.52 ms |
| 100 classes | 83.05 ms |

This includes all 9 collectors:
- **P0 (core)**: ScopeCollector, BindingCollector, ReferenceCollector
- **P1 (type info)**: ImportCollector, AnnotationCollector, TypeInferenceCollector, InheritanceCollector, MethodCallCollector
- **P2 (safety)**: DynamicPatternDetector

---

## Throughput

| Operation | Throughput |
|-----------|------------|
| parse_module (50 classes) | 3.31 MiB/s |
| parse_with_positions (50 classes) | 3.42 MiB/s |
| parse_module (100 classes) | 3.33 MiB/s |
| parse_with_positions (100 classes) | 3.31 MiB/s |
| parse_module (200 classes) | 3.04 MiB/s |
| parse_with_positions (200 classes) | 3.05 MiB/s |

---

## Methodology

- **Hardware:** Apple Silicon (as reported by criterion)
- **Tool:** criterion 0.6 with default settings
- **Samples:** 100 per benchmark
- **Warm-up:** 3 seconds

### Test Data

Generated Python code with classes, each containing:
- Class docstring
- `__init__` method with value assignment
- `process` method with arithmetic
- `transform` method with loop and list operations

---

## Checkpoint Verification

| Checkpoint | Status |
|------------|--------|
| No >10% regression in parse time | ✅ PASS (0% regression, actually slightly faster) |
| Results documented | ✅ PASS (this file) |

---

## Benchmark Code Location

`crates/tugtool-python-cst/benches/parser_bench.rs`

Run benchmarks with:
```bash
cargo bench -p tugtool-python-cst
```

Run specific benchmark groups:
```bash
cargo bench -p tugtool-python-cst -- "parse_with_positions"
cargo bench -p tugtool-python-cst -- "analysis_with_positions"
```
