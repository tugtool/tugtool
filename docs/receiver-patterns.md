# Receiver Pattern Analysis

This document analyzes receiver patterns found in the Temporale fixture to inform the Phase 11C receiver resolution implementation.

## Summary

| Pattern Type | Count | Example |
|--------------|-------|---------|
| Simple method call (`obj.method()`) | 1,252 | `self.to_iso_format()` |
| Simple attribute access (`self.attr`) | 421 | `self._tz` |
| 2-segment method call (`obj.attr.method()`) | 37 | `TimeUnit.HOUR.to_seconds()` |
| 2-segment attribute (`self.attr.prop`) | 4 | `self._tz.offset_seconds` |
| 3-segment attribute (`a.b.c.d`) | 19 | `result.value.timezone.offset_seconds` |
| 4+ segment patterns | 0 | - |
| Call receivers (`func().method()`) | 5 | `lower().strip()` |
| Constructor receivers (`Class().method()`) | 0 | - |
| Chained calls (`a().b().c()`) | 0 | - |

## Key Findings

### 1. Simple Patterns Dominate (96%)

The vast majority of receiver patterns are simple 1-segment patterns:
- **1,252** occurrences of `obj.method()` (simple method calls)
- **421** occurrences of `self.attr` (simple attribute access)

This confirms that simple receiver resolution covers the common case.

### 2. Dotted Receivers Are Rare but Present

Only **37** occurrences of `obj.attr.method()` patterns exist (2.8% of method calls):

Top patterns:
- `TimeUnit.HOUR.to_seconds()` - Enum member method calls (21 occurrences)
- `template.pattern.match()` - Object attribute method calls (5 occurrences)
- `_datetime.datetime.now()` - Module attribute constructors (2 occurrences)

### 3. self.attr.something is Very Rare

Only **4** occurrences of `self.attr.prop` patterns:
- `self._tz.offset_seconds` (3 occurrences)
- `self._tz.is_utc` (1 occurrence)

These are all accessing properties of the `_tz: Timezone` attribute on `DateTime`.

### 4. No Deep Chains in Production Code

- **0** patterns with 4+ segments
- **0** constructor receiver patterns (`Class().method()`)
- **0** chained call patterns (`a().b().c()`)

This validates the `MAX_RESOLUTION_DEPTH = 4` decision - real code rarely needs deeper chains.

### 5. 3-Segment Patterns are Module __all__ References

The 19 3-segment patterns are almost entirely `module.submodule.__all__` references used in `__init__.py` for re-exporting public APIs, not runtime attribute chains.

## Detailed Pattern Examples

### Pattern: self.attr.property (4 occurrences)

```python
# temporale/core/datetime.py:610
offset_diff = timezone.offset_seconds - self._tz.offset_seconds

# temporale/core/datetime.py:664
return day_seconds + time_seconds - self._tz.offset_seconds

# temporale/core/datetime.py:856
if self._tz.is_utc:

# temporale/core/datetime.py:989
if self._tz.offset_seconds != other._tz.offset_seconds:
```

**Analysis:** These patterns access properties (`offset_seconds`, `is_utc`) on `self._tz` which is typed as `Timezone | None`. Resolution requires:
1. Knowing `self` is `DateTime`
2. Looking up `_tz` attribute type → `Timezone | None`
3. Knowing `offset_seconds`/`is_utc` are properties of `Timezone`

### Pattern: enum.member.method() (21 occurrences)

```python
# temporale/tests/test_era.py
assert TimeUnit.HOUR.to_seconds() == 3600
assert TimeUnit.NANOSECOND.to_seconds() == 1e-9
```

**Analysis:** Enum member access followed by method call. Resolution requires:
1. Knowing `TimeUnit` is an Enum class
2. Knowing `HOUR` is a member of that enum
3. Knowing enum members have the `to_seconds()` method

### Pattern: var.attr.method() (5 occurrences)

```python
# temporale/infer/_patterns.py:67
match = template.pattern.match(text)
```

**Analysis:** Variable attribute method call. Resolution requires:
1. Knowing `template` has type (inferred from loop variable)
2. Looking up `pattern` attribute type → `re.Pattern`
3. Knowing `match` is a method of `re.Pattern`

## Recommendations

### 1. Prioritize self.attr Patterns

The `self.attr.prop` patterns (4 occurrences) are the primary target for Phase 11C. These:
- Are in production code (not tests)
- Require attribute type tracking
- Are resolvable with the planned infrastructure

### 2. Enum Patterns Need Special Handling

Enum member method calls (`TimeUnit.HOUR.to_seconds()`) would require:
- Enum class detection
- Enum member type inference
- This is out of scope for Phase 11C (listed in non-goals)

### 3. Depth Limit of 4 is Sufficient

With **0** patterns exceeding 3 segments in real code, `MAX_RESOLUTION_DEPTH = 4` provides adequate headroom while preventing pathological cases.

### 4. Constructor Chains Not Needed Yet

No `ClassName().method()` patterns were found. The constructor resolution feature (D01) is still valuable for correctness but not urgent for Temporale.

## Files Analyzed

- **54** Python files in Temporale fixture
- **19,564** total lines of code
- **34** source files in `temporale/`
- **19** test files in `tests/`

## Date

Audit performed: 2026-01-26

## Phase Reference

This audit supports Phase 11C: Enhanced Type Inference and Scope Tracking, Step 0.
