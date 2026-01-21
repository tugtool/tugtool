# Phase 5 Extensions: Advanced Features for Temporale

**Purpose:** Plan five major extensions to the Temporale library, analyzing scope, dependencies, design considerations, and implementation approach for each feature.

**Document Status:** Planning draft for review
**Last Updated:** 2026-01-21
**Prerequisites:** Steps 1-11 of Phase 5 complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Feature Analysis](#feature-analysis)
   - [Feature A: Infer Module](#feature-a-infer-module)
   - [Feature B: IANA Timezone Database](#feature-b-iana-timezone-database)
   - [Feature C: Periods and Intervals](#feature-c-periods-and-intervals)
   - [Feature D: Calendar Systems](#feature-d-calendar-systems)
   - [Feature E: Leap Second Support](#feature-e-leap-second-support)
3. [Recommended Implementation Order](#recommended-implementation-order)
4. [Clarifying Questions](#clarifying-questions)
5. [Detailed Step Specifications](#detailed-step-specifications)

---

## Executive Summary {#executive-summary}

This document analyzes five proposed extensions to the Temporale datetime library:

| Feature | Complexity | Effort | Reversibility Risk | Dependency on Others |
|---------|------------|--------|-------------------|---------------------|
| A. Infer Module | Medium | Medium | Low | Benefits from B |
| B. IANA Timezones | High | Large | Medium | Independent |
| C. Periods & Intervals | Medium | Medium | Low | Independent |
| D. Calendar Systems | Very High | Very Large | High | Needs careful isolation |
| E. Leap Seconds | High | Medium | Medium | Needs coordination with B |

**Recommended order:** C, B, A, E, D

**Key concern:** Features B, D, and E reverse earlier design decisions (Q04, Q05, non-goals). This requires careful consideration of backward compatibility and whether the original decisions should be fully reversed or made optional.

---

## Feature Analysis {#feature-analysis}

### Feature A: Infer Module {#feature-a-infer-module}

#### Overview

Add heuristics to parsing to make it easier to work with Temporale objects in "the real world":
- Flexible date/time parsing from ambiguous formats
- Locale-aware parsing hints
- Natural language date parsing (e.g., "next Tuesday", "3 days ago")

#### Scope Assessment

**Core capabilities:**
1. **Format inference** - Detect whether "01/02/2024" is MM/DD/YYYY or DD/MM/YYYY
2. **Fuzzy parsing** - Handle variations like "Jan 15, 2024", "15-Jan-2024", "2024.01.15"
3. **Relative dates** - Parse "yesterday", "next Monday", "in 3 weeks"
4. **Date math expressions** - Parse "today + 3 days", "last Friday"

**Out of scope for initial implementation:**
- Full natural language processing ("the first Tuesday of next month")
- Timezone name inference from abbreviations (conflicts with Feature B)
- Locale-specific month/day names (beyond basic English)

#### Dependencies

- **Optional dependency on Feature B:** Timezone inference would be more useful with IANA support (e.g., "3pm EST")
- **Internal dependency:** Requires solid Date, Time, DateTime, Duration foundations (complete)

#### Key Design Decisions Needed

**[IA01] Ambiguity Resolution Strategy**
- Question: How to handle ambiguous formats like "01/02/2024"?
- Options:
  1. Require explicit locale hint
  2. Use system locale as default
  3. Prefer ISO-like interpretation (YYYY-MM-DD family)
  4. Return multiple candidates with confidence scores
- Recommendation: Option 3 with option 1 as override. Provide `InferOptions(date_order="DMY"|"MDY"|"YMD")`.

**[IA02] Relative Date Reference Point**
- Question: What is "today" when parsing "yesterday"?
- Options:
  1. Always use system local date/time
  2. Accept reference DateTime parameter
  3. Use UTC
- Recommendation: Option 2 with Option 1 as default. `parse_relative(text, reference=DateTime.now())`.

**[IA03] Natural Language Scope**
- Question: How sophisticated should NL parsing be?
- Recommendation: Start minimal - only handle explicit patterns ("yesterday", "tomorrow", "next/last WEEKDAY", "N days/weeks/months ago/from now"). Avoid dependency on NLP libraries.

#### Module Structure

```
temporale/
    infer/
        __init__.py         # Public API: parse_fuzzy(), parse_relative()
        _patterns.py        # Regex patterns for format detection
        _formats.py         # Known format templates and matchers
        _relative.py        # Relative date parsing
        _natural.py         # Natural language keywords
```

#### Relative Effort: **Medium**

- 3-5 new Python files
- ~50-80 new symbols
- Regex-heavy implementation
- Extensive test coverage needed for format variations

#### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Ambiguity leads to wrong interpretation | High | Medium | Strong documentation, explicit confidence API |
| Scope creep into full NLP | Medium | Medium | Strict feature gates, defer complex NL |
| Locale handling complexity | Medium | High | Start with English only, design for extension |

---

### Feature B: IANA Timezone Database {#feature-b-iana-timezone-database}

#### Overview

Support named timezones (America/New_York, Europe/London, etc.) with:
- DST transition handling
- Historical timezone data
- Timezone database updates

**This reverses decision Q04:** "Use simplified UTC offset model only."

#### Scope Assessment

**Core capabilities:**
1. **Named timezone support** - `Timezone.from_name("America/New_York")`
2. **DST-aware conversion** - Correct offset for any point in time
3. **Ambiguous/invalid time handling** - Wall clock times that don't exist (spring forward) or occur twice (fall back)
4. **Database loading** - Read tzdata files or embedded database

**Architectural options:**
1. **Embedded database** - Ship compiled tzdata in Python package
2. **System tzdata** - Use OS timezone files (/usr/share/zoneinfo)
3. **External package** - Depend on `tzdata` PyPI package
4. **Optional dependency** - Make IANA support an optional feature

#### Impact Analysis: Reversing Q04

**What changes:**
- `Timezone` class needs to store either offset or zone name
- `DateTime` timezone conversions become time-dependent (not just offset math)
- Historical dates may have different offsets than current

**Backward compatibility:**
- Existing UTC offset-based code continues to work
- `Timezone.from_hours()` and `Timezone.from_string()` remain valid
- New: `Timezone.from_name()` for IANA zones

**Recommendation:** Make IANA support an **optional enhancement** rather than a replacement. The UTC offset model remains the default; IANA zones are additive.

#### Key Design Decisions Needed

**[IB01] Database Source**
- Question: Where does timezone data come from?
- Options:
  1. Embedded in package (large, but zero dependencies)
  2. System tzdata (platform-dependent)
  3. `tzdata` PyPI package (extra dependency)
  4. Hybrid: try system, fallback to embedded
- Recommendation: Option 4 or pure Python embedded subset. For test bed purposes, embedding a subset is acceptable.

**[IB02] Ambiguous Time Handling**
- Question: What happens when converting to a time that occurs twice (DST fallback)?
- Options:
  1. Always pick first occurrence
  2. Always pick second occurrence
  3. Raise AmbiguousTimeError
  4. Return both with disambiguation parameter
- Recommendation: Option 3 by default, with `fold` parameter (like Python 3.6+) for explicit disambiguation.

**[IB03] Nonexistent Time Handling**
- Question: What happens when creating a time that doesn't exist (DST spring forward)?
- Options:
  1. Raise NonExistentTimeError
  2. Silently adjust forward
  3. Silently adjust backward
  4. Allow creation, but flag as invalid
- Recommendation: Option 1 by default, with `normalize=True` option to auto-adjust.

**[IB04] API Surface**
- Question: How do users interact with IANA zones?
- Recommendation:
  ```python
  # Construction
  tz = Timezone.from_name("America/New_York")

  # Query
  tz.name  # "America/New_York"
  tz.is_fixed_offset  # False
  tz.utc_offset_at(datetime)  # Returns offset for specific instant

  # On DateTime
  dt = DateTime(2024, 6, 15, 12, 0, 0, timezone=tz)
  dt.timezone.utc_offset_at(dt)  # Returns summer offset
  ```

#### Module Structure

```
temporale/
    tz/
        __init__.py         # Public API: load_timezone(), get_timezone()
        _database.py        # Timezone database loading
        _zone.py            # IANATimezone class
        _transitions.py     # DST transition handling
        _embedded/          # Embedded tzdata (if used)
            zones.json      # Compiled zone data
```

Or extend existing:
```
temporale/
    units/
        timezone.py         # Extended with IANA support (subclass or strategy)
        _iana.py            # IANA-specific implementation
        _tzdata/            # Embedded data
```

#### Relative Effort: **Large**

- 4-6 new Python files
- ~80-120 new symbols
- Complex DST transition logic
- Extensive testing needed for edge cases
- Decision on data source impacts size significantly

#### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Database size bloats package | Medium | Medium | Embed subset, lazy loading |
| DST edge cases cause bugs | High | High | Comprehensive test suite with historical data |
| Platform-specific behavior | Medium | Medium | Abstract data source, test on multiple OS |
| Maintenance burden (tzdata updates) | Medium | High | Document update process, consider external dep |

---

### Feature C: Periods and Intervals {#feature-c-periods-and-intervals}

#### Overview

Extend temporal arithmetic with:
- **Period** type - Calendar-based durations ("1 month", "2 years") that vary by context
- **Interval** type - Represents a span between two points in time
- **Range operations** - overlaps, contains, gap, union

#### Scope Assessment

**Core capabilities:**

1. **Period type:**
   - Represents calendar units: years, months, weeks, days
   - Context-dependent: "1 month" from Jan 15 = Feb 15, from Jan 31 = Feb 28/29
   - Can be combined with Duration for mixed periods

2. **Interval type:**
   - Bounded span: `Interval(start, end)`
   - Half-open by default: `[start, end)`
   - Unbounded variants: `Interval.since(start)`, `Interval.until(end)`

3. **Range operations:**
   - `interval.contains(datetime)`
   - `interval.contains(other_interval)`
   - `interval.overlaps(other_interval)`
   - `interval.gap(other_interval)` - returns Duration or Interval between
   - `interval.union(other_interval)` - merge overlapping intervals
   - `interval.intersection(other_interval)`

**Distinction from Duration:**
- `Duration` = exact nanoseconds (absolute time span)
- `Period` = calendar units (relative, context-dependent)

Example:
```python
# Duration: exactly 30 days
dur = Duration(days=30)

# Period: one calendar month (28-31 days depending on context)
period = Period(months=1)

date = Date(2024, 1, 31)
date + dur        # 2024-03-01 (exactly 30 days)
date + period     # 2024-02-29 (one month, clamped to valid day)
```

#### Key Design Decisions Needed

**[IC01] Period Overflow Strategy**
- Question: What happens when adding 1 month to Jan 31?
- Options:
  1. Clamp to last valid day: Jan 31 + 1 month = Feb 29 (leap) or Feb 28
  2. Overflow to next month: Jan 31 + 1 month = Mar 2 or Mar 3
  3. Raise error
  4. Configurable behavior
- Recommendation: Option 1 (clamp) as default, matches most libraries.

**[IC02] Interval Boundary Semantics**
- Question: Are intervals open, closed, or half-open?
- Options:
  1. Always half-open `[start, end)`
  2. Always closed `[start, end]`
  3. Configurable per boundary
- Recommendation: Option 1 (half-open) as default - most common and composable.

**[IC03] Period + Duration Mixing**
- Question: Can Period contain both calendar and absolute components?
- Options:
  1. Keep Period pure (calendar only), combine via tuple
  2. Allow mixed: `Period(months=1, hours=12)`
  3. Separate Period and Duration, use operation like `date + period + duration`
- Recommendation: Option 3 - keep types pure, compose via operations.

**[IC04] Interval Type Variants**
- Question: Should there be separate types for Date intervals vs DateTime intervals?
- Options:
  1. Generic `Interval[T]` with type parameter
  2. Separate `DateRange`, `DateTimeRange` classes
  3. Single `Interval` that accepts both
- Recommendation: Option 3 for simplicity, with validation.

#### Module Structure

```
temporale/
    core/
        period.py           # Period class
        interval.py         # Interval class
    arithmetic/
        period_ops.py       # Period arithmetic
        range_ops.py        # Interval operations (overlaps, gap, union)
```

Or new top-level:
```
temporale/
    ranges/
        __init__.py         # Public API
        period.py           # Period class
        interval.py         # Interval class
        operations.py       # Range algebra
```

#### Relative Effort: **Medium**

- 3-4 new Python files
- ~50-70 new symbols
- Moderate complexity in Period arithmetic (month boundary handling)
- Good test coverage needed for edge cases

#### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Month arithmetic edge cases | Medium | High | Explicit overflow strategy, comprehensive tests |
| Confusion with Duration | Medium | Medium | Clear documentation, distinct names |
| Interval algebra complexity | Low | Medium | Start with basic operations |

---

### Feature D: Calendar Systems {#feature-d-calendar-systems}

#### Overview

Support calendar systems beyond Gregorian:
- Julian calendar
- Islamic (Hijri) calendar
- Gregorian/Julian historical switch handling
- Possibly: Hebrew, Chinese, Buddhist calendars

**This reverses a stated non-goal:** "Calendar systems other than Gregorian (proleptic Gregorian used for BCE dates)"

#### Scope Assessment

**This is the most complex proposed feature.** Calendar systems involve:
- Different month lengths and names
- Different year numbering (Hijri years, regnal years)
- Different leap year rules
- Different epoch points
- Some are lunar-based (Islamic) with observation-dependent calculations

**Recommended phased approach:**
1. **Phase D1:** Julian calendar only (simplest, historical relevance)
2. **Phase D2:** Gregorian/Julian switch dates (for historical accuracy)
3. **Phase D3:** Islamic calendar (well-defined lunar calendar)
4. **Phase D4:** Other calendars (if needed)

#### Impact Analysis: Reversing Non-Goal

**What changes:**
- `Date` needs to be either calendar-agnostic or specific
- Display formats depend on calendar
- Month/day validation depends on calendar

**Architectural options:**
1. **Calendar parameter on Date** - `Date(year, month, day, calendar=JulianCalendar())`
2. **Separate date types** - `JulianDate`, `HijriDate`, convertible to `Date`
3. **Hybrid** - `Date` is always Gregorian internally, calendar is display/conversion layer

Recommendation: **Option 3** - Keep `Date` as proleptic Gregorian internally (MJD-based), add calendar classes for conversion and display:
```python
# Internal storage always Gregorian/MJD
date = Date(2024, 1, 15)

# Convert to other calendar for display
julian = JulianCalendar()
julian_ymd = julian.from_date(date)  # Returns (year, month, day) in Julian

# Create from other calendar
date = Date.from_calendar(julian, year=7532, month=1, day=2)
```

#### Key Design Decisions Needed

**[ID01] Internal Representation**
- Question: Should alternative calendars be first-class Date variants or conversion layers?
- Recommendation: Conversion layers. `Date` always stores MJD (proleptic Gregorian), calendars provide conversion.

**[ID02] Gregorian/Julian Switch Date**
- Question: When did the switch happen?
- Reality: Different countries switched at different times (1582-1923)
- Options:
  1. Ignore - use proleptic Gregorian everywhere
  2. Global switch date parameter
  3. Locale-based switch dates
- Recommendation: Option 2 for simplicity, with common presets.

**[ID03] Calendar API Surface**
- Recommendation:
  ```python
  class Calendar(Protocol):
      def to_ymd(self, date: Date) -> tuple[int, int, int]: ...
      def from_ymd(self, year: int, month: int, day: int) -> Date: ...
      def month_name(self, month: int) -> str: ...
      def is_leap_year(self, year: int) -> bool: ...

  julian = JulianCalendar()
  hijri = HijriCalendar()
  ```

#### Module Structure

```
temporale/
    calendars/
        __init__.py         # Calendar protocol, factory
        _base.py            # Base calendar class/protocol
        gregorian.py        # Explicit Gregorian implementation
        julian.py           # Julian calendar
        hijri.py            # Islamic calendar
        _conversion.py      # MJD conversion utilities
```

#### Relative Effort: **Very Large**

- 4-8 new Python files (per calendar)
- ~100-200 new symbols
- Complex astronomical calculations for some calendars
- Extensive research needed for correctness
- Each calendar is essentially a sub-project

#### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Incorrect calendar math | High | High | Reference authoritative sources, compare with known libraries |
| Scope explosion | High | High | Strict phasing, start with Julian only |
| Lunar calendar complexity | High | Medium | Defer Islamic/Hebrew calendars |
| User confusion | Medium | Medium | Clear documentation about internal representation |

---

### Feature E: Leap Second Support {#feature-e-leap-second-support}

#### Overview

Support leap seconds with:
- TAI vs UTC distinction
- Leap second table
- Handling of 23:59:60

**This reverses decision Q05:** "Ignore leap seconds entirely."

#### Scope Assessment

**Core capabilities:**
1. **Second value 60** - Allow `Time(23, 59, 60)` for leap seconds
2. **TAI timescale** - Support International Atomic Time
3. **TAI/UTC conversion** - Account for leap second table
4. **Leap second table** - Historical and (possibly) future leap seconds

**Reality check:**
- Leap seconds are announced ~6 months in advance
- There have been 27 leap seconds since 1972
- The IERS has paused leap second additions (2024 decision)
- Most applications ignore leap seconds successfully

**Architectural options:**
1. **Full TAI support** - Separate TAI and UTC timescales
2. **UTC with leap seconds** - Allow second=60, correct Unix timestamp conversion
3. **Smeared leap seconds** - Spread leap second over longer period (like Google/Amazon)
4. **Simple acknowledgment** - Allow second=60 in construction/parsing, treat as 59 internally

Recommendation: **Option 2** for correctness, with **Option 4** as minimum viable.

#### Impact Analysis: Reversing Q05

**What changes:**
- `Time` validation must allow second=60
- `DateTime` must handle 23:59:60
- Unix timestamp conversion needs leap second table
- ISO 8601 parsing/formatting must handle :60

**Backward compatibility:**
- Existing code continues to work (leap seconds remain rare)
- New: second=60 becomes valid

#### Key Design Decisions Needed

**[IE01] Leap Second Representation**
- Question: How is a leap second stored internally?
- Options:
  1. Allow `_nanos` to exceed normal day length
  2. Flag on DateTime indicating leap second
  3. Separate LeapSecondDateTime type
- Recommendation: Option 1 or 2 - extend existing types minimally.

**[IE02] Leap Second Table Source**
- Question: Where does the table come from?
- Options:
  1. Embedded in package (static, needs updates)
  2. Fetched from IERS (requires network)
  3. Configurable (user provides table)
- Recommendation: Option 1 with update mechanism documented.

**[IE03] Timescale Enum**
- Question: Should different timescales be explicit?
- Recommendation: Yes - `Timescale.UTC`, `Timescale.TAI`, stored on DateTime.
  ```python
  dt_utc = DateTime(..., timescale=Timescale.UTC)
  dt_tai = dt_utc.to_tai()
  ```

**[IE04] Interaction with IANA Timezones (Feature B)**
- Leap seconds only affect UTC/TAI. Local times derived from UTC inherit them.
- If Feature B is implemented, timezone conversions must account for leap seconds.

#### Module Structure

```
temporale/
    timescale/
        __init__.py         # Timescale enum, conversion functions
        _leapseconds.py     # Leap second table
        _tai.py             # TAI conversion logic
```

Or extend existing:
```
temporale/
    _internal/
        leapseconds.py      # Leap second table and utilities
    units/
        timescale.py        # Timescale enum
```

#### Relative Effort: **Medium**

- 2-4 new Python files
- ~30-50 new symbols
- Moderate complexity in conversion logic
- Table maintenance is ongoing concern

#### Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Incorrect leap second table | High | Low | Use IERS authoritative data |
| Table becomes stale | Medium | Medium | Document update process |
| Interaction bugs with timezones | Medium | Medium | Careful testing, sequential implementation |
| Breaking existing code | Low | Low | Leap seconds are rare |

---

## Recommended Implementation Order {#recommended-implementation-order}

### Rationale

1. **Feature C (Periods & Intervals)** - FIRST
   - Independent of other features
   - Lower risk (doesn't reverse decisions)
   - Adds significant value for refactoring test bed
   - Medium effort with good payoff

2. **Feature B (IANA Timezones)** - SECOND
   - Foundation for improved Feature A
   - Required for production-quality datetime library
   - High effort but well-understood problem
   - Enables Feature E to be properly integrated

3. **Feature A (Infer Module)** - THIRD
   - Benefits from Feature B being complete
   - Practical utility for "real world" usage
   - Medium effort
   - Can be implemented incrementally

4. **Feature E (Leap Seconds)** - FOURTH
   - Benefits from Feature B being complete
   - Lower priority (most apps don't need it)
   - Can be scoped minimally
   - Medium effort

5. **Feature D (Calendar Systems)** - LAST (or separate phase)
   - Highest complexity and risk
   - Most likely to introduce bugs
   - Least needed for refactoring test bed purposes
   - Consider as Phase 6 instead

### Proposed Step Numbers

Insert these after current Step 11, renumbering existing Step 12+ as needed:

| New Step | Feature | Description |
|----------|---------|-------------|
| 12 | C | Period type implementation |
| 13 | C | Interval type and range operations |
| 14 | B | IANA Timezone database integration |
| 15 | B | DST transition handling |
| 16 | A | Flexible format inference |
| 17 | A | Relative and natural date parsing |
| 18 | E | Leap second support |
| 19-22 | D | Calendar systems (Julian first) |

Current Steps 12-14 become Steps 23-25.

---

## Clarifying Questions {#clarifying-questions}

Before proceeding with implementation, the following decisions need input:

### Priority Questions

1. **Feature D Inclusion:** Should calendar systems remain out of scope (per original non-goals), or is this reversal intentional? If included, which calendars are actually needed?

2. **Feature B Scope:** Is the goal production-quality IANA support, or "good enough for testing"? This affects database choice and edge case handling.

3. **Dependency Policy:** Should new features (B, E) be truly optional (feature flags), or can they be always-on additions?

4. **Backward Compatibility:** When reversing Q04/Q05, should existing behavior be preserved exactly, or is some semantic change acceptable?

### Implementation Questions

5. **Testing Strategy:** Should new features have their own test files, or integrate into existing test structure?

6. **External Dependencies:** Are external packages (e.g., `tzdata`) acceptable, or must everything be pure Python/embedded?

7. **Feature A Locale Handling:** Is English-only acceptable for initial implementation, or is i18n required from the start?

8. **Documentation:** Should each feature include README/docstring updates, or defer documentation to Phase end?

---

## Detailed Step Specifications {#detailed-step-specifications}

The following sections provide implementation-ready step specifications in the style of existing phase-5.md steps.

---

### Step 12: Implement Period Type {#step-12-new}

**Commit:** `feat(temporale): add Period class for calendar-based durations`

**References:** [IC01], [IC03], Feature C Analysis

**Purpose:** Add a Period type representing calendar-based durations (months, years) that vary by context, distinct from the exact-nanosecond Duration type.

**Artifacts:**
- `temporale/core/period.py` - Period class implementation
- `temporale/arithmetic/period_ops.py` - Period arithmetic helpers
- `tests/test_period.py` - Period tests

**Tasks:**
- [ ] Create `Period` class with `years`, `months`, `weeks`, `days` components
- [ ] Implement `Period.__add__` and `Period.__sub__` for Period+Period
- [ ] Implement `Date.__add__(Period)` and `DateTime.__add__(Period)` with month overflow clamping
- [ ] Add factory methods: `Period.of_months()`, `Period.of_years()`, etc.
- [ ] Implement `Period.to_duration(reference_date)` for approximate conversion
- [ ] Export from `temporale/core/__init__.py` and `temporale/__init__.py`

**Period class specification:**
```python
class Period:
    """A calendar-based duration with year, month, week, and day components.

    Unlike Duration (which is exact nanoseconds), Period represents calendar
    concepts like "1 month" that vary by context. Adding 1 month to Jan 31
    yields Feb 28/29, not exactly 30 or 31 days.

    Attributes:
        years: Number of years (can be negative).
        months: Number of months (can be negative).
        weeks: Number of weeks (can be negative).
        days: Number of days (can be negative).
    """

    __slots__ = ("_years", "_months", "_weeks", "_days")

    def __init__(
        self,
        years: int = 0,
        months: int = 0,
        weeks: int = 0,
        days: int = 0,
    ) -> None: ...

    @classmethod
    def of_years(cls, years: int) -> Period: ...

    @classmethod
    def of_months(cls, months: int) -> Period: ...

    @classmethod
    def of_weeks(cls, weeks: int) -> Period: ...

    @classmethod
    def of_days(cls, days: int) -> Period: ...

    @property
    def years(self) -> int: ...

    @property
    def months(self) -> int: ...

    @property
    def weeks(self) -> int: ...

    @property
    def days(self) -> int: ...

    @property
    def total_months(self) -> int:
        """Total months (years*12 + months)."""
        ...

    def to_duration(self, reference: Date) -> Duration:
        """Convert to exact Duration using reference date for month lengths."""
        ...

    def __add__(self, other: Period) -> Period: ...
    def __sub__(self, other: Period) -> Period: ...
    def __neg__(self) -> Period: ...
    def __mul__(self, scalar: int) -> Period: ...
    def __eq__(self, other: object) -> bool: ...
    def __hash__(self) -> int: ...
    def __repr__(self) -> str: ...
    def __str__(self) -> str: ...
```

**Month overflow clamping specification:**
```python
# Adding months clamps to valid day-of-month
Date(2024, 1, 31) + Period(months=1)  # -> Date(2024, 2, 29) (leap year)
Date(2023, 1, 31) + Period(months=1)  # -> Date(2023, 2, 28)
Date(2024, 3, 31) + Period(months=1)  # -> Date(2024, 4, 30)

# Year addition is similar
Date(2024, 2, 29) + Period(years=1)   # -> Date(2025, 2, 28)
```

**Tests:**
- [ ] Unit test: Period construction and property access
- [ ] Unit test: Period arithmetic (add, subtract, multiply, negate)
- [ ] Unit test: Date + Period with month overflow (Jan 31 + 1 month)
- [ ] Unit test: Date + Period for leap year edge cases
- [ ] Unit test: DateTime + Period preserves time component
- [ ] Unit test: Period.to_duration() with various reference dates
- [ ] Unit test: Period comparison and hashing

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_period.py -v` passes
- [ ] `Date(2024, 1, 31) + Period(months=1) == Date(2024, 2, 29)` works

**Rollback:** Remove period.py, period_ops.py, and test_period.py

**Commit after all checkpoints pass.**

---

### Step 13: Implement Interval Type and Range Operations {#step-13-new}

**Commit:** `feat(temporale): add Interval class with range operations`

**References:** [IC02], [IC04], Feature C Analysis

**Purpose:** Add an Interval type representing a span between two temporal points, with operations for testing containment, overlap, and combining intervals.

**Artifacts:**
- `temporale/core/interval.py` - Interval class implementation
- `temporale/arithmetic/range_ops.py` - Range operation helpers
- `tests/test_interval.py` - Interval tests

**Tasks:**
- [ ] Create `Interval` class with `start`, `end`, and bound type
- [ ] Implement half-open interval semantics `[start, end)` by default
- [ ] Add factory methods for unbounded intervals
- [ ] Implement containment: `contains(point)`, `contains(interval)`
- [ ] Implement overlap: `overlaps(interval)`
- [ ] Implement gap: `gap(interval)` returns Duration or None
- [ ] Implement union: `union(interval)` for overlapping intervals
- [ ] Implement intersection: `intersection(interval)`
- [ ] Export from `temporale/core/__init__.py` and `temporale/__init__.py`

**Interval class specification:**
```python
from typing import TypeVar, Generic, overload

T = TypeVar("T", Date, DateTime)

class Interval(Generic[T]):
    """A time span between two points, half-open [start, end) by default.

    Intervals can represent:
    - Bounded: Interval(start, end)
    - Open start: Interval.until(end)
    - Open end: Interval.since(start)
    - Empty: Interval.empty()

    Attributes:
        start: Start of interval (inclusive), or None if unbounded.
        end: End of interval (exclusive), or None if unbounded.
    """

    __slots__ = ("_start", "_end")

    def __init__(self, start: T, end: T) -> None:
        """Create a bounded interval [start, end).

        Raises:
            ValueError: If end <= start.
        """
        ...

    @classmethod
    def since(cls, start: T) -> Interval[T]:
        """Create interval [start, infinity)."""
        ...

    @classmethod
    def until(cls, end: T) -> Interval[T]:
        """Create interval (-infinity, end)."""
        ...

    @classmethod
    def empty(cls) -> Interval:
        """Create an empty interval."""
        ...

    @property
    def start(self) -> T | None: ...

    @property
    def end(self) -> T | None: ...

    @property
    def is_bounded(self) -> bool: ...

    @property
    def is_empty(self) -> bool: ...

    def duration(self) -> Duration | None:
        """Return the duration of a bounded interval, or None."""
        ...

    @overload
    def contains(self, point: T) -> bool: ...
    @overload
    def contains(self, interval: Interval[T]) -> bool: ...
    def contains(self, other): ...

    def overlaps(self, other: Interval[T]) -> bool:
        """Return True if intervals share any time."""
        ...

    def gap(self, other: Interval[T]) -> Duration | None:
        """Return duration between non-overlapping intervals, or None if overlapping."""
        ...

    def union(self, other: Interval[T]) -> Interval[T] | None:
        """Return union of overlapping intervals, or None if disjoint."""
        ...

    def intersection(self, other: Interval[T]) -> Interval[T] | None:
        """Return intersection of intervals, or None if no overlap."""
        ...

    def __eq__(self, other: object) -> bool: ...
    def __hash__(self) -> int: ...
    def __repr__(self) -> str: ...
    def __str__(self) -> str: ...
```

**Tests:**
- [ ] Unit test: Interval construction and validation
- [ ] Unit test: Bounded interval contains point
- [ ] Unit test: Bounded interval contains sub-interval
- [ ] Unit test: Unbounded intervals (since, until)
- [ ] Unit test: Overlapping intervals
- [ ] Unit test: Non-overlapping intervals with gap
- [ ] Unit test: Union of overlapping intervals
- [ ] Unit test: Intersection of overlapping intervals
- [ ] Unit test: Empty interval handling
- [ ] Unit test: Interval with Date vs DateTime

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_interval.py -v` passes
- [ ] Interval overlap detection works correctly

**Rollback:** Remove interval.py, range_ops.py, and test_interval.py

**Commit after all checkpoints pass.**

---

### Step 14: IANA Timezone Database Integration {#step-14-new}

**Commit:** `feat(temporale): add IANA timezone support`

**References:** [IB01], [IB04], Feature B Analysis

**Purpose:** Add support for named IANA timezones (America/New_York, Europe/London) while maintaining backward compatibility with UTC offset model.

**Artifacts:**
- `temporale/tz/__init__.py` - Public API
- `temporale/tz/_zone.py` - IANATimezone class
- `temporale/tz/_database.py` - Timezone database loading
- `temporale/tz/_embedded/zones.json` - Embedded timezone data (subset)
- `tests/test_iana_timezone.py` - IANA timezone tests

**Tasks:**
- [ ] Create `IANATimezone` class as subclass/variant of Timezone
- [ ] Implement `Timezone.from_name(name)` factory method
- [ ] Create embedded timezone data for common zones (50+ zones)
- [ ] Implement `utc_offset_at(datetime)` for time-dependent offsets
- [ ] Update DateTime to handle IANATimezone in conversions
- [ ] Maintain backward compatibility with existing Timezone API

**IANATimezone specification:**
```python
class IANATimezone(Timezone):
    """A timezone with IANA database name and DST transitions.

    Unlike fixed-offset Timezone, IANATimezone's UTC offset varies by time
    due to daylight saving time transitions.
    """

    __slots__ = ("_name", "_transitions")

    @classmethod
    def from_name(cls, name: str) -> IANATimezone:
        """Load timezone by IANA name.

        Args:
            name: IANA timezone name (e.g., "America/New_York").

        Raises:
            TimezoneError: If timezone name is not found.
        """
        ...

    @property
    def name(self) -> str:
        """Return the IANA timezone name."""
        ...

    @property
    def is_fixed_offset(self) -> bool:
        """Return False - IANA timezones have variable offsets."""
        return False

    def utc_offset_at(self, dt: DateTime) -> int:
        """Return UTC offset in seconds at the given instant."""
        ...

    def dst_offset_at(self, dt: DateTime) -> int:
        """Return DST offset in seconds (0 if standard time)."""
        ...

    def is_dst_at(self, dt: DateTime) -> bool:
        """Return True if DST is in effect at the given instant."""
        ...
```

**Embedded data format (zones.json):**
```json
{
  "version": "2024a",
  "zones": {
    "America/New_York": {
      "transitions": [
        {"utc": 1710054000, "offset": -18000, "dst": false, "abbr": "EST"},
        {"utc": 1710140400, "offset": -14400, "dst": true, "abbr": "EDT"}
      ],
      "current_offset": -18000,
      "current_dst_offset": 3600
    }
  }
}
```

**Tests:**
- [ ] Unit test: Load timezone by name
- [ ] Unit test: Get offset at specific time (winter vs summer)
- [ ] Unit test: Unknown timezone raises TimezoneError
- [ ] Unit test: DateTime with IANA timezone
- [ ] Unit test: Convert between IANA timezones
- [ ] Unit test: Backward compatibility with fixed-offset Timezone

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_iana_timezone.py -v` passes
- [ ] `Timezone.from_name("America/New_York")` loads successfully
- [ ] Existing Timezone tests still pass

**Rollback:** Remove tz/ module and test file

**Commit after all checkpoints pass.**

---

### Step 15: DST Transition Handling {#step-15-new}

**Commit:** `feat(temporale): add DST transition handling for IANA timezones`

**References:** [IB02], [IB03], Feature B Analysis

**Purpose:** Handle the edge cases when converting to/from IANA timezones during DST transitions - ambiguous times (fall back) and nonexistent times (spring forward).

**Artifacts:**
- `temporale/tz/_transitions.py` - DST transition logic
- `temporale/errors.py` - Add AmbiguousTimeError, NonExistentTimeError
- Update `temporale/tz/_zone.py` - Add fold parameter support
- `tests/test_dst_transitions.py` - DST edge case tests

**Tasks:**
- [ ] Add `AmbiguousTimeError` and `NonExistentTimeError` exceptions
- [ ] Implement `fold` parameter for ambiguous time disambiguation (Python 3.6+ compatible)
- [ ] Add `normalize` parameter for nonexistent time handling
- [ ] Update DateTime construction to validate against transitions
- [ ] Implement `DateTime.is_ambiguous()` and `DateTime.is_nonexistent()` methods

**Exception hierarchy:**
```python
class AmbiguousTimeError(TimezoneError):
    """Raised when a local time is ambiguous due to DST fall-back.

    During fall-back, the same local time occurs twice. Use the `fold`
    parameter to disambiguate: fold=0 for first occurrence, fold=1 for second.
    """
    pass

class NonExistentTimeError(TimezoneError):
    """Raised when a local time does not exist due to DST spring-forward.

    During spring-forward, local times in the gap do not exist.
    Use `normalize=True` to automatically adjust to valid time.
    """
    pass
```

**Fold parameter usage:**
```python
# Fall-back: 1:30 AM occurs twice
tz = Timezone.from_name("America/New_York")

# First occurrence (before fall-back)
dt1 = DateTime(2024, 11, 3, 1, 30, 0, timezone=tz, fold=0)
dt1.utc_offset  # -14400 (EDT)

# Second occurrence (after fall-back)
dt2 = DateTime(2024, 11, 3, 1, 30, 0, timezone=tz, fold=1)
dt2.utc_offset  # -18000 (EST)

# Default (fold=None) raises AmbiguousTimeError
DateTime(2024, 11, 3, 1, 30, 0, timezone=tz)  # Raises AmbiguousTimeError
```

**Nonexistent time handling:**
```python
# Spring-forward: 2:30 AM does not exist (clocks jump from 2:00 to 3:00)
tz = Timezone.from_name("America/New_York")

# Default behavior: raise error
DateTime(2024, 3, 10, 2, 30, 0, timezone=tz)  # Raises NonExistentTimeError

# With normalize: adjust to valid time
DateTime(2024, 3, 10, 2, 30, 0, timezone=tz, normalize=True)
# -> DateTime(2024, 3, 10, 3, 30, 0, timezone=tz)  # Adjusted forward
```

**Tests:**
- [ ] Unit test: Ambiguous time raises AmbiguousTimeError
- [ ] Unit test: Ambiguous time with fold=0 selects first occurrence
- [ ] Unit test: Ambiguous time with fold=1 selects second occurrence
- [ ] Unit test: Nonexistent time raises NonExistentTimeError
- [ ] Unit test: Nonexistent time with normalize=True adjusts forward
- [ ] Unit test: is_ambiguous() detection
- [ ] Unit test: is_nonexistent() detection
- [ ] Unit test: Various US timezone transitions
- [ ] Unit test: Various EU timezone transitions

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_dst_transitions.py -v` passes
- [ ] Ambiguous and nonexistent time handling matches specification

**Rollback:** Remove _transitions.py, revert errors.py, remove test file

**Commit after all checkpoints pass.**

---

### Step 16: Flexible Format Inference {#step-16-new}

**Commit:** `feat(temporale): add flexible date format inference`

**References:** [IA01], Feature A Analysis

**Purpose:** Add a module that can parse dates from ambiguous real-world formats by detecting the format pattern and applying appropriate parsing.

**Artifacts:**
- `temporale/infer/__init__.py` - Public API
- `temporale/infer/_patterns.py` - Format pattern detection
- `temporale/infer/_formats.py` - Known format templates
- `tests/test_infer.py` - Format inference tests

**Tasks:**
- [ ] Create `InferOptions` class for configuration (date_order, etc.)
- [ ] Implement format pattern detection for common formats
- [ ] Create `parse_fuzzy(text, options)` function
- [ ] Support configurable date order (MDY, DMY, YMD)
- [ ] Handle common separators (/, -, ., space)
- [ ] Return parsed value with confidence indicator

**InferOptions specification:**
```python
class DateOrder(Enum):
    """Order of date components in ambiguous formats."""
    YMD = "YMD"  # Year-Month-Day (ISO-like)
    MDY = "MDY"  # Month-Day-Year (US convention)
    DMY = "DMY"  # Day-Month-Year (European convention)

class InferOptions:
    """Configuration for flexible parsing."""

    def __init__(
        self,
        date_order: DateOrder = DateOrder.YMD,
        prefer_future: bool = False,  # For 2-digit years
        default_century: int = 2000,  # For 2-digit years
    ) -> None: ...
```

**parse_fuzzy specification:**
```python
class ParseResult:
    """Result of fuzzy parsing with confidence."""
    value: Date | Time | DateTime
    format_detected: str
    confidence: float  # 0.0 to 1.0

def parse_fuzzy(
    text: str,
    options: InferOptions | None = None,
) -> ParseResult:
    """Parse a date/time string with format inference.

    Supported formats:
    - ISO 8601: "2024-01-15", "2024-01-15T14:30:00"
    - Slash separated: "01/15/2024", "15/01/2024" (depends on date_order)
    - Dot separated: "15.01.2024"
    - Named month: "Jan 15, 2024", "15 Jan 2024", "January 15, 2024"
    - Time only: "14:30", "2:30 PM", "14:30:45"

    Args:
        text: String to parse.
        options: Configuration options.

    Returns:
        ParseResult with parsed value and confidence.

    Raises:
        ParseError: If no format matches.
    """
    ...
```

**Supported formats (initial):**
```python
# Date formats
"2024-01-15"      # ISO
"01/15/2024"      # MDY slash
"15/01/2024"      # DMY slash
"2024/01/15"      # YMD slash
"01-15-2024"      # MDY dash
"15.01.2024"      # DMY dot
"Jan 15, 2024"    # Named month
"15 Jan 2024"     # Named month
"January 15, 2024"  # Full month name

# DateTime formats
"2024-01-15 14:30:00"
"Jan 15, 2024 2:30 PM"

# Time formats
"14:30"
"14:30:45"
"2:30 PM"
"2:30:45 PM"
```

**Tests:**
- [ ] Unit test: ISO format parsing
- [ ] Unit test: Slash-separated with MDY order
- [ ] Unit test: Slash-separated with DMY order
- [ ] Unit test: Named month parsing
- [ ] Unit test: Time-only parsing
- [ ] Unit test: Combined datetime parsing
- [ ] Unit test: Ambiguous date with explicit order
- [ ] Unit test: Confidence scores vary by format clarity

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_infer.py -v` passes
- [ ] `parse_fuzzy("Jan 15, 2024")` correctly parses

**Rollback:** Remove infer/ module and test file

**Commit after all checkpoints pass.**

---

### Step 17: Relative and Natural Date Parsing {#step-17-new}

**Commit:** `feat(temporale): add relative and natural date parsing`

**References:** [IA02], [IA03], Feature A Analysis

**Purpose:** Extend the infer module to handle relative dates ("yesterday", "next Monday") and simple date math expressions.

**Artifacts:**
- `temporale/infer/_relative.py` - Relative date parsing
- `temporale/infer/_natural.py` - Natural language patterns
- Update `temporale/infer/__init__.py` - Export new functions
- `tests/test_relative_parsing.py` - Relative date tests

**Tasks:**
- [ ] Implement `parse_relative(text, reference)` function
- [ ] Support keywords: yesterday, today, tomorrow
- [ ] Support weekday references: next/last Monday-Sunday
- [ ] Support duration phrases: "3 days ago", "in 2 weeks"
- [ ] Support month phrases: "next month", "last month"
- [ ] Handle combination: "next Monday at 3pm"

**parse_relative specification:**
```python
def parse_relative(
    text: str,
    reference: DateTime | None = None,
) -> Date | DateTime:
    """Parse a relative date expression.

    If no reference is provided, uses DateTime.now().

    Supported patterns:
    - "today", "yesterday", "tomorrow"
    - "next Monday", "last Friday" (any weekday)
    - "3 days ago", "in 2 weeks", "5 months ago"
    - "next week", "last month", "next year"
    - "Monday" (next occurrence by default)
    - "Monday at 3pm" (with time)

    Args:
        text: Relative date expression.
        reference: Reference point for calculation (default: now).

    Returns:
        Date or DateTime depending on whether time was specified.

    Raises:
        ParseError: If expression cannot be parsed.
    """
    ...
```

**Keyword definitions:**
```python
# Day keywords (relative to reference)
"today"     -> reference.date()
"yesterday" -> reference.date() - Duration(days=1)
"tomorrow"  -> reference.date() + Duration(days=1)

# Weekday keywords (next occurrence)
"Monday"    -> next Monday >= today
"next Monday" -> next Monday > today
"last Monday" -> most recent Monday < today
"this Monday" -> Monday of current week

# Duration phrases
"3 days ago"      -> reference - Duration(days=3)
"in 2 weeks"      -> reference + Duration(days=14)
"5 months ago"    -> reference - Period(months=5)
"in 1 year"       -> reference + Period(years=1)

# Period keywords
"next week"  -> reference + Duration(days=7)
"last month" -> reference - Period(months=1)
"next year"  -> reference + Period(years=1)
```

**Tests:**
- [ ] Unit test: today/yesterday/tomorrow keywords
- [ ] Unit test: Weekday references (next Monday, last Friday)
- [ ] Unit test: Duration phrases (N days/weeks ago/from now)
- [ ] Unit test: Period phrases (N months/years ago/from now)
- [ ] Unit test: Custom reference datetime
- [ ] Unit test: Combination with time ("tomorrow at 3pm")
- [ ] Unit test: Edge cases (next Monday on a Monday)

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_relative_parsing.py -v` passes
- [ ] `parse_relative("3 days ago")` returns correct date

**Rollback:** Remove _relative.py, _natural.py, revert __init__.py, remove test file

**Commit after all checkpoints pass.**

---

### Step 18: Leap Second Support {#step-18-new}

**Commit:** `feat(temporale): add leap second support`

**References:** [IE01], [IE02], [IE03], Feature E Analysis

**Purpose:** Add support for leap seconds, including allowing second=60 in time construction and proper TAI/UTC conversion.

**Artifacts:**
- `temporale/units/timescale.py` - Timescale enum
- `temporale/_internal/leapseconds.py` - Leap second table
- Update `temporale/core/time.py` - Allow second=60
- Update `temporale/core/datetime.py` - Handle leap seconds
- `tests/test_leapseconds.py` - Leap second tests

**Tasks:**
- [ ] Create `Timescale` enum (UTC, TAI)
- [ ] Create embedded leap second table (1972-present)
- [ ] Update Time validation to allow second=60 at valid times
- [ ] Update DateTime to handle 23:59:60 properly
- [ ] Implement TAI/UTC conversion functions
- [ ] Update Unix timestamp conversion to account for leap seconds (optional)

**Timescale enum:**
```python
from enum import Enum

class Timescale(Enum):
    """Time measurement scale."""

    UTC = "UTC"  # Coordinated Universal Time (with leap seconds)
    TAI = "TAI"  # International Atomic Time (no leap seconds)
    # Future: GPS, TT (Terrestrial Time)
```

**Leap second handling:**
```python
# Valid leap second (23:59:60 on Dec 31, 2016)
t = Time(23, 59, 60)  # Now valid
dt = DateTime(2016, 12, 31, 23, 59, 60, timezone=Timezone.utc())

# Invalid leap second (23:59:60 on a day without leap second)
# Option A: Allow anyway (permissive)
# Option B: Raise ValidationError (strict)
# Recommendation: Option A (permissive) - let users construct, document caveat

# TAI conversion
dt_utc = DateTime(2017, 1, 1, 0, 0, 0, timezone=Timezone.utc())
dt_tai = dt_utc.to_timescale(Timescale.TAI)
# dt_tai is 37 seconds ahead (27 leap seconds + 10 second TAI-UTC offset)
```

**Leap second table format:**
```python
# List of (UTC timestamp, cumulative leap seconds) tuples
# UTC timestamp is the instant AFTER the leap second
LEAP_SECONDS = [
    # 1972: First 10 leap seconds established
    (63072000, 10),    # 1972-01-01
    (78796800, 11),    # 1972-07-01
    (94694400, 12),    # 1973-01-01
    # ... continued through 2016 (last leap second)
    (1483228800, 37),  # 2017-01-01 (after 2016 leap second)
]
```

**Tests:**
- [ ] Unit test: Time(23, 59, 60) construction succeeds
- [ ] Unit test: DateTime with leap second
- [ ] Unit test: Leap second in ISO format parsing/formatting
- [ ] Unit test: TAI/UTC conversion
- [ ] Unit test: Unix timestamp with leap seconds
- [ ] Unit test: Leap second table lookup

**Checkpoint:**
- [ ] `.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/test_leapseconds.py -v` passes
- [ ] `Time(23, 59, 60)` constructs without error
- [ ] Existing Time tests still pass

**Rollback:** Remove timescale.py, leapseconds.py, revert time.py/datetime.py, remove test file

**Commit after all checkpoints pass.**

---

## Summary and Next Steps

This planning document covers five major extensions to Temporale:

1. **Period & Intervals (Steps 12-13)** - Ready for implementation
2. **IANA Timezones (Steps 14-15)** - Ready for implementation
3. **Infer Module (Steps 16-17)** - Ready for implementation
4. **Leap Seconds (Step 18)** - Ready for implementation
5. **Calendar Systems (not detailed)** - Recommended for separate phase

**Before implementing, resolve the clarifying questions in Section 4.**

After implementing these features, proceed with the original Steps 12-14 (now renumbered to 19-21):
- Step 19: Custom Decorators and Edge Cases
- Step 20: Public API and Exports
- Step 21: Tugtool Integration Verification

---

**End of Planning Document**
