# Walrus Operator Pipeline Analysis Report

**Date**: 2026-02-02
**Author**: Code Architect Agent
**Purpose**: Inform Step 1.1.2 planning for infrastructure improvements

## Executive Summary

The failing `test_rename_walrus_in_comprehension` integration test was caused by an **off-by-one column number** (36 vs 37), not an infrastructure bug. However, the debugging process revealed that the pipeline lacks observability, making it unnecessarily difficult to diagnose lookup failures.

The walrus operator handling in the pipeline is correct at every stage. The test now passes.

## Root Cause

### Test Code
```python
def compute(x):
    return x * 2

results = [y for x in range(10) if (y := compute(x)) > 5]
```

### Column Mapping (1-indexed)
| Column | Character |
|--------|-----------|
| 35     | ` ` (space before paren) |
| 36     | `(` (opening paren) |
| **37** | **`y`** (walrus target) |
| 38     | ` ` (space) |

The test specified column 36, but the walrus target `y` is at column **37**.

## Pipeline Verification

All stages work correctly:

### 1. BindingCollector (`tugtool-python-cst/src/visitor/binding.rs`)
- **Lines 467-473**: `visit_named_expr` handles walrus operators
- **Lines 297-326**: Uses `enclosing_scope_path` per PEP 572
- **Result**: Binding with `scope_path: ["<module>"]`, `span: [70, 71)`

### 2. CST Bridge (`tugtool-python/src/cst_bridge.rs`)
- **Lines 214-225**: Converts CstBindingInfo to BindingInfo
- **Result**: Span preserved correctly

### 3. Analyzer (`tugtool-python/src/analyzer.rs`)
- **Lines 2498-2549**: `collect_symbols` creates LocalSymbol
- **Lines 2570-2598**: `find_scope_for_path_indexed` resolves scope
- **Result**: Symbol with `scope_id: 0` (module), `span: [70, 71)`

### 4. Lookup (`tugtool-python/src/lookup.rs`)
- **Lines 86-87**: Converts Location(4, 36) to byte offset 69
- **Lines 91-94**: Span containment check: `70 <= 69 < 71` = FALSE
- **Result**: SymbolNotFound (correct, because 69 is wrong byte)

## Why Debugging Was Difficult

The transcript shows extensive speculation about:
- Whether BindingCollector spans were correct
- Whether scope names matched (`<listcomp>` conventions)
- Whether the CST bridge lost information
- Whether `find_scope_for_path_indexed` resolved correctly

None of these were the issue. The problem was simply that the test specified the wrong column, but the error message `SymbolNotFound { file: "test.py", line: 4, col: 36 }` gives no hint about what's actually at that location.

## Infrastructure Gaps

### Gap 1: No Location Validation Utility
Tests specify `Location::new("file.py", line, col)` with no verification that the column actually points to the expected character.

### Gap 2: Opaque SymbolNotFound Errors
The error says "symbol not found at location" but doesn't explain:
- What byte offset that location maps to
- What character is at that byte offset
- What symbols exist nearby (within N bytes)
- What span the closest symbol has

### Gap 3: No Debug Trace Mode
There's no way to trace a lookup through the pipeline to see:
- What bindings were collected
- What symbols were created
- What the span containment check evaluated to

### Gap 4: No Golden/Snapshot Testing for Spans
When binding spans change, tests break silently. There's no easy way to see "what did this binding's span used to be vs now."

## Recommendations for Step 1.1.2

### Priority 1: Location Validation Helper (Low effort, high value)

Add a test utility that validates a Location against source:

```rust
/// Validates that a Location points to the expected character.
/// Panics with helpful message if it doesn't.
fn assert_location_char(source: &str, loc: &Location, expected: char) {
    let offset = position_to_byte_offset_str(source, loc.line, loc.col);
    let actual = source.as_bytes().get(offset).map(|&b| b as char);
    assert_eq!(
        actual, Some(expected),
        "Location ({}:{}) points to {:?} (byte {}), expected {:?}",
        loc.line, loc.col, actual, offset, expected
    );
}

// Usage in test:
assert_location_char(code, &location, 'y'); // Fails immediately with clear message
```

### Priority 2: Verbose SymbolNotFound Errors (Medium effort, high value)

Enhance lookup errors to include diagnostic information:

```rust
// Instead of just SymbolNotFound, include:
SymbolNotFound {
    file: String,
    line: u32,
    col: u32,
    byte_offset: usize,        // Computed byte offset
    char_at_offset: char,      // What's actually there
    nearest_symbol: Option<(String, Span)>, // Closest symbol by span
}
```

### Priority 3: Lookup Debug Trace (Medium effort, medium value)

Add an optional trace mode to the lookup pipeline:

```rust
// In tests, optionally enable tracing:
let result = find_symbol_at_location_with_trace(
    analyzer, file, location
);
// Returns: Ok(symbol) or Err(LookupError) with trace:
// - Bindings collected: [...]
// - Symbols created: [...]
// - Span containment checks: [...]
```

### Priority 4: Span Snapshot Tests (Low effort, ongoing value)

For critical binding types, add snapshot tests that capture span information:

```rust
#[test]
fn snapshot_walrus_binding_spans() {
    let bindings = collect_bindings(WALRUS_CODE);
    insta::assert_yaml_snapshot!(bindings);
}
```

## Conclusion

No changes to the core walrus operator handling are needed. The implementation is correct.

However, the debugging experience exposed gaps in observability. Step 1.1.2 should focus on improving diagnostic tooling, not fixing non-existent bugs in the binding/lookup pipeline.

## Files Examined

| File | Key Lines |
|------|-----------|
| `tugtool-python-cst/src/visitor/binding.rs` | 297-326, 467-473 |
| `tugtool-python/src/cst_bridge.rs` | 214-225 |
| `tugtool-python/src/analyzer.rs` | 2498-2598 |
| `tugtool-python/src/lookup.rs` | 63-134 |
| `tugtool-python/tests/rename_hardening.rs` | 790-819 |
