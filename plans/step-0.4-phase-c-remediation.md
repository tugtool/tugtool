# Step 0.4 Phase C Remediation Report

## Status: BLOCKED - Design Flaw Discovered

Phase C (Analyzer Integration) cannot be completed with the current design. A fundamental mismatch was discovered between how scopes are tracked and how they are resolved.

## What Happened

We completed Phase A and Phase B successfully:
- Phase A: Added `scope_path: Vec<String>` to `CstReferenceRecord`
- Phase B: Implemented scope tracking in `ReferenceCollector` using synthetic names (`<lambda>`, `<listcomp>`, etc.)

During Phase C implementation, we discovered that **name-based scope path lookup fails for anonymous scopes**.

## Root Cause

**The Mismatch:**

| Component | What it does | Lambda/Comprehension handling |
|-----------|--------------|-------------------------------|
| ReferenceCollector | Tracks `scope_path: Vec<String>` | Pushes `"<lambda>"`, `"<listcomp>"`, etc. |
| ScopeCollector | Creates `Scope { name: Option<String>, ... }` | Sets `name: None` |
| find_scope_for_path_indexed | Looks up `(parent_id, name)` in index | Fails: `Some("<lambda>") != None` |

**Result:** All references inside lambdas and comprehensions fall back to module scope (`ScopeId(0)`).

## Why Name-Based Lookup Cannot Work

Even if we changed ScopeCollector to use synthetic names, there's a deeper problem: **ambiguity**.

```python
def foo():
    a = lambda: x  # scope_path = [..., "<lambda>"]
    b = lambda: y  # scope_path = [..., "<lambda>"]  ← SAME PATH!
```

Multiple anonymous scopes at the same level have identical scope_paths. Name-based lookup cannot distinguish them.

## Recommended Solution: Span-Based Scope Lookup

Instead of matching by name, find the **tightest scope that contains the reference's span**.

**Why this works:**
- Spans are unique - no two scopes have the same span
- Works for any number of nested/sibling anonymous scopes
- Conceptually clean: "which scope contains this reference?"
- Scopes already have spans; references already have spans

**Implementation approach:**

```rust
struct SpanScopeIndex {
    sorted_scopes: Vec<(Span, ScopeId)>,  // Sorted by start position
}

impl SpanScopeIndex {
    fn find_containing_scope(&self, ref_span: Span) -> Option<ScopeId> {
        // Find the tightest scope that contains ref_span
        // (smallest scope where scope.start <= ref.start && ref.end <= scope.end)
    }
}
```

## What Needs to Change in Phase 13 Plan

### Phase C Must Be Redesigned

The current Phase C tasks are:
- [ ] Update `NativeReferenceInfo` to add `scope_path` field ✓ (done, but not the solution)
- [ ] Update CST → `NativeReferenceInfo` conversion to copy `scope_path` ✓ (done, but not the solution)
- [ ] Update analyzer reference loop to use `scope_path` ✗ (WRONG APPROACH)
- [ ] Replace `ScopeId(0)` with scope lookup using `find_scope_for_path_indexed()` ✗ (WRONG APPROACH)

**New Phase C tasks should be:**

1. **Create `SpanScopeIndex` structure** in `analyzer.rs`
   - Sorted array of `(Span, ScopeId)` pairs
   - Method `find_containing_scope(ref_span: Span) -> Option<ScopeId>`
   - Finds tightest (smallest) scope containing the reference span

2. **Modify reference resolution loop** in `analyze_file()`
   - Build `SpanScopeIndex` from scopes (once per file)
   - For each reference with a span, look up containing scope
   - Fall back to `ScopeId(0)` only if reference has no span

3. **Keep `scope_path` for debugging** but do NOT use it for resolution
   - The field is useful for logging/debugging
   - Remove the dependency on it for actual scope resolution

4. **Add comprehensive tests:**
   - References in lambdas resolve to lambda scope
   - References in comprehensions resolve to comprehension scope
   - Multiple sibling lambdas resolve independently
   - Nested anonymous scopes work correctly
   - Mixed named/anonymous scope chains work

### Additional Edge Cases for Tests

```python
# Multiple lambdas at same level
f1 = lambda: x
f2 = lambda: y

# Deeply nested anonymous scopes
f = lambda: [i for i in [j for j in range(10)]]

# Lambda in default argument
def foo(x=lambda: 1): pass

# Comprehension with walrus operator
[y for x in items if (y := process(x))]
```

## Files Affected

| File | Change Required |
|------|-----------------|
| `crates/tugtool-python/src/analyzer.rs` | Add `SpanScopeIndex`, modify reference resolution |
| `crates/tugtool-python/src/types.rs` | No change (scope_path already added) |
| `crates/tugtool-python/src/cst_bridge.rs` | No change (conversion already done) |

## Performance Notes

- Building index: O(S log S) where S = scope count
- Lookup: O(S) per reference (could be O(log S) with interval tree)
- For typical files (10-100 scopes, 100-1000 references), this is acceptable
- Can optimize to interval tree later if profiling shows need

## Lessons Learned

1. **Test the integration early**: We should have written integration tests during Phase A/B that actually used the scope_path for resolution.

2. **Consider anonymous scopes explicitly**: The plan mentioned lambdas/comprehensions but didn't fully address the ambiguity problem.

3. **Span-based lookup is more robust**: Name-based matching is fragile for synthetic/anonymous constructs. Span containment is a more fundamental property.

## Recommendation

The code-planner should update phase-13.md to:

1. Mark current Phase C tasks as "deprecated - wrong approach"
2. Add new Phase C tasks with span-based lookup approach
3. Update the Phase C tests to verify span-based resolution
4. Update the Phase C checkpoint criteria
5. Update the Step 0.4 Success Criteria to reflect span-based approach

The `scope_path` work in Phase A/B is not wasted - it's still useful for debugging and could potentially be used for other purposes. But it cannot be the basis for scope resolution due to the ambiguity problem.
