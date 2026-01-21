## Phase 5: Temporale Sample Code Library {#phase-5}

**Purpose:** Create a comprehensive Python datetime library called "Temporale" to serve as a realistic, feature-rich test bed for tugtool's Python refactoring capabilities.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-21 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugtool's Python refactoring capabilities need a realistic, non-trivial codebase to exercise. The existing test fixtures in `crates/tugtool/tests/fixtures/python/` are minimal by design - they test specific scenarios but don't represent the complexity of real-world Python projects. A purpose-built sample library will:

1. Provide a controlled environment with known complexity characteristics
2. Exercise all major Python language constructs that refactoring tools must handle
3. Create reproducible test scenarios for regression testing
4. Serve as documentation of supported refactoring patterns

A datetime library is ideal because:
- It naturally requires multiple interconnected classes (Date, Time, DateTime, Duration)
- It demands precision and correctness (good test coverage is inherent)
- It involves multiple Python constructs: properties, class methods, static methods, operators, decorators
- Real-world datetime libraries (Arrow, Pendulum, dateutil) are popular refactoring targets

#### Strategy {#strategy}

1. **Design for refactoring complexity** - Include sufficient cross-module dependencies, class hierarchies, and Python constructs to exercise tugtool comprehensively
2. **Prioritize purity** - Pure Python only, no C extensions, for full CST analyzability
3. **Use modern Python idioms** - Type annotations, dataclasses where appropriate, `__slots__` for memory efficiency
4. **Build incrementally** - Each phase adds testable functionality
5. **Include comprehensive tests** - pytest test suite serves dual purpose: validates library and provides refactoring targets
6. **Document extensively** - Docstrings and comments become refactoring targets themselves

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool developers - need diverse refactoring scenarios
2. AI agent developers - need realistic codebase for integration testing
3. Documentation writers - need concrete examples of supported patterns

#### Success Criteria (Measurable) {#success-criteria}

- Library parses without errors using `tugtool-python-cst` (100% parse success)
- All class/function/variable symbols discoverable via `analyze_files()` (verification via test)
- At least 100 distinct symbols across all modules
- At least 50 cross-module references
- At least 10 distinct refactoring scenarios documented and tested
- Library passes its own pytest suite before and after any refactoring

#### Scope {#scope}

1. Core temporal types: Date, Time, DateTime, Duration
2. Supporting types: Era, Timezone, TimeUnit enums
3. Formatting and parsing subsystem
4. JSON serialization/deserialization
5. Arithmetic operations (Duration + DateTime, etc.)
6. pytest test suite
7. Integration with tugtool test infrastructure

#### Non-goals (Explicitly out of scope) {#non-goals}

- Production-ready datetime library (we optimize for refactoring complexity, not performance)
- Compatibility with pytz, dateutil, or other libraries
- IANA timezone database (use simplified UTC offset model)
- Localization/internationalization
- Calendar systems other than Gregorian (proleptic Gregorian used for BCE dates)

#### Dependencies / Prerequisites {#dependencies}

- Python 3.10+ (for modern type annotation syntax)
- pytest for testing
- tugtool-python native CST parser must handle all constructs used

#### Constraints {#constraints}

- Pure Python only (no Cython, no C extensions)
- No external runtime dependencies (stdlib only for core library)
- pytest only for test dependencies
- Must be parseable by Python 3.10, 3.11, 3.12

#### Assumptions {#assumptions}

- tugtool-python-cst correctly handles all Python 3.10+ syntax
- pytest is available in the development environment
- Sample code does not need to be published to PyPI

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Python Version Support Range (DECIDED) {#q01-python-versions}

**Question:** Which Python versions should Temporale support for testing?

**Why it matters:** Syntax features differ between versions; we need to ensure CST parser handles all variants.

**Decision:** Support Python 3.10, 3.11, and 3.12.

**Rationale:**
- Python 3.10 introduced `match` statements and union type hints (`X | Y`)
- Python 3.11 is the current stable release used widely
- Python 3.12 introduced more advanced type annotation features
- Python 3.9 and earlier lack modern type hint syntax we want to exercise

**Resolution:** DECIDED - Target Python 3.10+ with testing on 3.10, 3.11, 3.12.

---

#### [Q03] Era Naming Convention (DECIDED) {#q03-era-naming}

**Question:** Should Era use BCE/CE or BC/AD naming, or both?

**Decision:** Use only `Era.BCE` and `Era.CE`. No aliases for BC/AD.

**Rationale:**
- Simpler API with one naming convention
- BCE/CE is the modern scholarly convention
- Reduces symbol count without losing functionality

**Resolution:** DECIDED - BCE/CE only, no BC/AD aliases.

---

#### [Q04] Timezone Model (DECIDED) {#q04-timezone-model}

**Question:** Should Temporale support named timezones (IANA database) or just UTC offsets?

**Decision:** Use simplified UTC offset model only. No IANA timezone database.

**Rationale:**
- Sufficient for test bed purposes
- Avoids external dependencies
- Keeps implementation focused on refactoring scenarios

**Resolution:** DECIDED - UTC offset model only.

---

#### [Q05] Leap Second Handling (DECIDED) {#q05-leap-seconds}

**Question:** Should Temporale handle leap seconds?

**Decision:** Ignore leap seconds entirely.

**Rationale:**
- Most datetime libraries ignore leap seconds
- Simplifies implementation
- Not relevant for refactoring test bed purposes

**Resolution:** DECIDED - Ignore leap seconds.

---

#### [Q06] Year Zero Existence (DECIDED) {#q06-year-zero}

**Question:** Should year 0 exist internally and in formatted strings?

**Why it matters:** Historical BCE/CE convention has no year 0 (1 BCE → 1 CE), but astronomical year numbering includes year 0. This affects internal math and string formatting.

**Decision:** Year 0 exists (astronomical convention).

**Rationale:**
- Simpler arithmetic: internal year = astronomical year directly
- ISO 8601 extended format uses astronomical year numbering
- Proleptic Gregorian calendar with year 0 is well-defined
- Year 0 = 1 BCE in historical terms

**Implications:**
- `Date(year=0, month=1, day=1)` is valid (equivalent to 1 BCE Jan 1)
- Formatting: year 0 formats as `0000-01-01`
- Negative years: year -1 = 2 BCE, year -44 = 45 BCE
- `Era.BCE` applies to year ≤ 0, `Era.CE` to year ≥ 1

**Resolution:** DECIDED - Year 0 exists, astronomical year numbering.

---

#### [Q07] Naive vs Aware DateTime Comparison (DECIDED) {#q07-naive-aware}

**Question:** How should naive (no timezone) and aware (has timezone) DateTimes interact in comparisons?

**Decision:** Match Python stdlib behavior:
- Raise `TypeError` for ordering comparisons between naive and aware DateTimes (`<`, `<=`, `>`, `>=`)
- Return `False` for equality between naive and aware DateTimes (`==`)

**Rationale:**
- Matches Python stdlib `datetime` behavior
- Prevents subtle bugs from implicit assumptions
- Forces explicit conversion when mixing naive/aware

**Implications:**
- `naive_dt == aware_dt` returns `False`
- `naive_dt < aware_dt` raises `TypeError`
- Two naive DateTimes can be compared (local time comparison)
- Two aware DateTimes can be compared (converted to same tz internally)

**Resolution:** DECIDED - stdlib semantics for naive/aware comparisons.

---

#### [Q08] Duration + Date Semantics (DECIDED) {#q08-duration-date}

**Question:** Should adding a Duration with sub-day parts to a Date be allowed?

**Decision:** Raise ValueError if Duration has non-zero sub-day parts.

**Rationale:**
- Clean semantics: Date represents a calendar day, not a moment
- Prevents confusion about what happens to hours/minutes/seconds
- Forces explicit use of DateTime for time-aware operations

**Implications:**
- `Date(2024, 1, 15) + Duration(days=1)` → `Date(2024, 1, 16)` ✓
- `Date(2024, 1, 15) + Duration(days=1, hours=12)` → `ValueError` ✗
- Use `DateTime.combine(date, Time.midnight()) + duration` for time-aware ops

**Resolution:** DECIDED - Error on sub-day Duration + Date.

---

#### [Q09] JSON Encoding Style (DECIDED) {#q09-json-style}

**Question:** Should JSON output be human-readable ISO strings or structured fields?

**Decision:** Use ISO string format with type tag.

**Schema:**
```json
{"_type": "DateTime", "value": "2024-01-15T14:30:00.123456789Z"}
{"_type": "Date", "value": "2024-01-15"}
{"_type": "Time", "value": "14:30:00.123456789"}
{"_type": "Duration", "value": "P1DT2H30M", "total_nanos": 95400000000000}
```

**Rationale:**
- Human-readable and debuggable
- ISO 8601 strings are widely understood
- `_type` field enables polymorphic deserialization
- Duration includes both ISO 8601 period and exact nanos for precision

**Resolution:** DECIDED - ISO strings with type tags.

---

#### [Q10] strftime/strptime Scope (DECIDED) {#q10-strftime-scope}

**Question:** Which subset of strftime format directives should we support?

**Decision:** Minimal subset covering common use cases.

**Supported directives:**
| Directive | Meaning | Example |
|-----------|---------|---------|
| `%Y` | 4-digit year | `2024` |
| `%m` | 2-digit month | `01`-`12` |
| `%d` | 2-digit day | `01`-`31` |
| `%H` | 2-digit hour (24h) | `00`-`23` |
| `%M` | 2-digit minute | `00`-`59` |
| `%S` | 2-digit second | `00`-`59` |
| `%f` | Microseconds | `000000`-`999999` |
| `%z` | UTC offset | `+0000`, `-0530` |
| `%Z` | Timezone name | `UTC`, `+05:30` |
| `%%` | Literal `%` | `%` |

**Not supported:** `%a %A %b %B` (locale-dependent), `%j %U %W` (week/day-of-year), `%c %x %X` (locale formats).

**Rationale:**
- Covers 95% of real-world formatting needs
- Avoids locale dependency rabbit hole
- Sufficient for refactoring test coverage

**Resolution:** DECIDED - Minimal strftime subset, no locale directives.

---

#### [Q11] astimezone Behavior (DECIDED) {#q11-astimezone}

**Question:** When converting DateTime to a different timezone, should it preserve the instant or wall-clock time?

**Decision:** Preserve the instant (standard behavior).

**Rationale:**
- `dt.astimezone(tz)` represents the same moment in time, different representation
- `dt.astimezone(utc).astimezone(original_tz) == dt` (roundtrip)
- Matches Python stdlib and nearly all datetime libraries

**Implications:**
- Hour/minute may change when converting
- `dt.astimezone(Timezone.utc()).to_unix_seconds() == dt.to_unix_seconds()`

**Resolution:** DECIDED - astimezone preserves instant.

---

#### [Q12] Unix Epoch for Seconds API (DECIDED) {#q12-unix-epoch}

**Question:** What epoch should `to_unix_seconds()` / `from_unix_seconds()` use?

**Decision:** Standard Unix epoch (1970-01-01 00:00:00 UTC).

**API:**
```python
def to_unix_seconds(self) -> int: ...      # Seconds since 1970-01-01
def to_unix_nanos(self) -> int: ...        # Nanoseconds since 1970-01-01
def from_unix_seconds(cls, ts: int) -> DateTime: ...
def from_unix_nanos(cls, ts: int) -> DateTime: ...
```

**Rationale:**
- Most interoperable with external systems
- Internal MJD representation is an implementation detail
- No need for separate MJD API (can compute from Unix if needed)

**Resolution:** DECIDED - Unix epoch for seconds API.

---

#### [Q02] Epoch Choice for Internal Representation (DECIDED) {#q02-epoch-choice}

**Question:** What epoch should Temporale use for its internal timestamp representation?

**Why it matters:** The epoch determines the representable date range and affects arithmetic precision.

**Options considered:**

| Epoch | Description | Pros | Cons |
|-------|-------------|------|------|
| Unix (1970-01-01) | Standard in most systems | Familiar, widely used | Limited BCE support, negative timestamps awkward |
| J2000 (2000-01-01 12:00 TT) | Astronomical standard | Natural for space/astronomy | Unusual for typical apps |
| Proleptic Gregorian 0001-01-01 | Start of CE | No negative dates for CE | Limited BCE support |
| **Julian Day 0 (-4713-11-24)** | Astronomical standard | Full historical range, no negative JD | Large numbers, unfamiliar |

**Decision:** Use **Modified Julian Day (MJD)** as internal representation.

**Rationale:**
- MJD = JD - 2400000.5 (starts at 1858-11-17 00:00 UTC)
- Smaller numbers than JD while preserving astronomical compatibility
- Well-defined for all historical and future dates
- Fractional days naturally encode time-of-day
- For BCE dates: extend proleptic Gregorian calendar backward with negative MJD values
- Alternative view: Store as (days_since_epoch: i64, nanoseconds_in_day: u64) for maximum precision

**Internal representation:**
```python
# Primary storage: integer days + nanoseconds for sub-day precision
_days: int         # MJD day number (can be negative for ancient dates)
_nanos: int        # Nanoseconds since midnight [0, 86_400_000_000_000)
```

**Precision guarantees:**
- Seconds: 64-bit equivalent (i64 covers +/- 292 billion years)
- Sub-seconds: 32-bit nanoseconds (u32 max = 4.29 billion > 1 billion nanos/sec)
- Effective precision: nanosecond over the full representable range

**Resolution:** DECIDED - Use MJD with (i64 days, u64 nanos) internal storage.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Library too complex | High | Low | Incremental phases, each testable | Any phase takes > 3 days |
| CST parser gaps | High | Medium | Test incrementally, file issues | Parse failures on legal Python |
| Pytest integration | Medium | Low | Use standard pytest patterns | Test discovery fails |

**Risk R01: CST Parser Edge Cases** {#r01-cst-edge-cases}

- **Risk:** tugtool-python-cst may not handle all Python constructs used in Temporale
- **Mitigation:** Test each module immediately after creation with `analyze_files()`; use only constructs known to be supported
- **Residual risk:** Novel combinations of constructs may expose parser limitations

---

### 5.0.0 Design Decisions {#design-decisions}

#### [D01] Module Structure: Flat vs Deep Hierarchy (DECIDED) {#d01-module-structure}

**Decision:** Use a moderately nested structure with clear separation of concerns.

**Rationale:**
- Flat structures don't exercise cross-module import patterns
- Overly deep structures are artificial and hard to navigate
- Moderate nesting mirrors real libraries (e.g., `temporale.core.date`, `temporale.format.iso8601`)

**Structure:**
```
temporale/
    __init__.py           # Public API exports
    core/
        __init__.py       # Core type exports
        date.py           # Date class
        time.py           # Time class
        datetime.py       # DateTime class
        duration.py       # Duration class
        instant.py        # Instant (absolute moment in time)
    units/
        __init__.py       # Unit exports
        era.py            # Era enum (BCE/CE)
        timeunit.py       # TimeUnit enum
        timezone.py       # Timezone class
    format/
        __init__.py       # Formatter exports
        iso8601.py        # ISO 8601 formatting/parsing
        rfc3339.py        # RFC 3339 (subset of ISO 8601)
        strftime.py       # strftime-style formatting
    convert/
        __init__.py       # Conversion exports
        json.py           # JSON serialization
        epoch.py          # Epoch conversions (Unix, Windows, etc.)
    arithmetic/
        __init__.py       # Arithmetic exports
        ops.py            # Addition, subtraction operations
        comparisons.py    # Comparison operations
    _internal/
        __init__.py       # Internal utilities (underscore = private)
        validation.py     # Input validation
        constants.py      # Magic numbers, limits
```

**Implications:**
- Creates 15+ Python files
- Multiple `__init__.py` files for export testing
- Relative and absolute imports both used
- Private module convention (`_internal`) for testing privacy handling

---

#### [D02] Class Design: Immutability (DECIDED) {#d02-immutability}

**Decision:** All temporal types are immutable (like Python's `datetime.datetime`).

**Rationale:**
- Immutability is idiomatic for value types
- Prevents accidental mutation bugs
- Matches user expectations from stdlib datetime
- Methods return new instances; no in-place modification

**Implications:**
- Use `@property` for all attribute access (refactoring target)
- Constructor validation is critical
- `__slots__` for memory efficiency
- No setter methods

---

#### [D03] Type Annotations: Full Coverage (DECIDED) {#d03-type-annotations}

**Decision:** Use comprehensive type annotations throughout.

**Rationale:**
- Type annotations are common refactoring targets (renaming types)
- Exercises tugtool's handling of annotation expressions
- Enables future static analysis features
- Documents API contracts

**Style:**
```python
from __future__ import annotations
from typing import TYPE_CHECKING, Self, overload

if TYPE_CHECKING:
    from temporale.core.duration import Duration

class DateTime:
    def add(self, duration: Duration) -> Self: ...
```

**Implications:**
- Forward references via `from __future__ import annotations`
- `TYPE_CHECKING` blocks for circular import avoidance
- Generic types where appropriate (`list[Date]`, not `List[Date]`)

---

#### [D04] Operator Overloading: Comprehensive (DECIDED) {#d04-operators}

**Decision:** Implement rich operator overloading for arithmetic types.

**Rationale:**
- Exercises dunder method handling (which existing fixtures partially cover)
- Natural API: `datetime + duration` instead of `datetime.add(duration)`
- Tests reference tracking through operator methods

**Operators to implement:**

| Type | Operators |
|------|-----------|
| DateTime | `+` (Duration), `-` (Duration or DateTime), `==`, `<`, `<=`, `>`, `>=`, `hash` |
| Duration | `+`, `-`, `*` (scalar), `/` (scalar), `//`, `%`, `-` (unary), `abs`, `==`, `<` |
| Date | `+` (Duration), `-` (Duration or Date), `==`, `<` |
| Time | `==`, `<`, `>`, `<=`, `>=`, `hash` |

---

#### [D05] Decorator Usage: Varied Patterns (DECIDED) {#d05-decorators}

**Decision:** Use multiple decorator patterns to exercise decorator handling.

**Rationale:**
- Decorators are important refactoring targets (existing fixture covers basic case)
- Real libraries use decorators extensively
- Tests stacked decorators, parameterized decorators, class decorators

**Patterns to include:**
```python
# Simple decorator
@property
def year(self) -> int: ...

# Stacked decorators
@classmethod
@cache
def now(cls) -> DateTime: ...

# Parameterized decorator
@validate_range(min_year=1, max_year=9999)
def __init__(self, year: int, month: int, day: int): ...

# Custom decorator (in _internal)
@deprecated("Use DateTime.now() instead")
def current_time() -> DateTime: ...

# Class decorator
@dataclass(frozen=True, slots=True)
class TimeUnit:
    name: str
    seconds: int
```

---

#### [D06] Error Handling: Custom Exception Hierarchy (DECIDED) {#d06-exceptions}

**Decision:** Define a custom exception hierarchy for domain-specific errors.

**Rationale:**
- Exception classes are refactoring targets
- Exercises inheritance patterns
- Common pattern in real libraries

**Hierarchy:**
```python
class TemporaleError(Exception):
    """Base exception for all Temporale errors."""
    pass

class ValidationError(TemporaleError):
    """Invalid input values."""
    pass

class ParseError(TemporaleError):
    """Failed to parse string representation."""
    pass

class OverflowError(TemporaleError):
    """Arithmetic operation exceeded representable range."""
    pass

class TimezoneError(TemporaleError):
    """Invalid or unknown timezone."""
    pass
```

---

#### [D07] Subsecond Precision Convenience Methods (DECIDED) {#d07-subseconds}

**Decision:** Provide explicit methods for milliseconds, microseconds, and nanoseconds.

**Rationale:**
- Users commonly work in these units
- Creates more symbols to refactor
- Tests method name patterns

**API:**
```python
class DateTime:
    @property
    def nanosecond(self) -> int:
        """Nanoseconds component [0, 999_999_999]."""

    @property
    def microsecond(self) -> int:
        """Microseconds component [0, 999_999]."""

    @property
    def millisecond(self) -> int:
        """Milliseconds component [0, 999]."""

    def with_nanosecond(self, nanosecond: int) -> DateTime:
        """Return new DateTime with nanosecond replaced."""

    @classmethod
    def from_unix_millis(cls, millis: int) -> DateTime:
        """Create from Unix milliseconds timestamp."""

    def to_unix_nanos(self) -> int:
        """Return Unix nanoseconds timestamp."""
```

---

### 5.0.1 Refactoring Test Bed Analysis {#refactoring-test-bed}

This section analyzes what makes Temporale valuable as a refactoring test bed and catalogs the specific patterns it exercises.

#### Python Constructs Coverage {#constructs-coverage}

**Table T01: Python Constructs in Temporale** {#t01-constructs}

| Construct | Example Location | Refactoring Scenarios |
|-----------|------------------|----------------------|
| Class definition | `core/date.py::Date` | Rename class, extract base class |
| Method definition | `Date.replace()` | Rename method across hierarchy |
| Property | `Date.year` | Rename property, convert to method |
| Class method | `DateTime.now()` | Rename, change to static |
| Static method | `Duration.zero()` | Rename, change to classmethod |
| Dunder method | `Date.__add__()` | Rename base, affect override |
| Nested class | `DateTime.Builder` | Rename inner class |
| Simple decorator | `@property` | (built-in, not renamed) |
| Custom decorator | `@validate_range` | Rename decorator function |
| Stacked decorators | `@classmethod @cache` | Order preservation |
| Parameterized decorator | `@deprecated("msg")` | Rename decorator factory |
| Enum | `Era.BCE, Era.CE` | Rename enum, rename member |
| Exception class | `ValidationError` | Rename across raise/except |
| Type alias | `Timestamp = int` | Rename alias affects usages |
| Forward reference | `"Duration"` | String reference handling |
| Generic type | `list[Date]` | Subscript expression handling |
| Union type | `Date | None` | Binary operator in annotation |
| Literal type | `Literal["BCE", "CE"]` | String literal in annotation |
| Import | `from .date import Date` | Rename affects import |
| Import alias | `import temporale as tp` | Alias handling |
| Comprehension | `[d.year for d in dates]` | Attribute reference in comprehension |
| Lambda | `key=lambda d: d.year` | Attribute reference in lambda |
| f-string | `f"Date: {self.year}"` | Attribute reference in f-string |

#### Cross-Module Reference Patterns {#cross-module-patterns}

**Table T02: Cross-Module Reference Scenarios** {#t02-cross-module}

| Pattern | Example | Files Involved |
|---------|---------|---------------|
| Type import | `from temporale.core.duration import Duration` | datetime.py imports duration.py |
| Inheritance import | `from .instant import Instant` | datetime.py extends Instant |
| Factory import | `from temporale.format.iso8601 import parse` | datetime.py uses parser |
| Constant import | `from temporale._internal.constants import MAX_YEAR` | date.py uses constants |
| Exception import | `from temporale.errors import ValidationError` | All modules raise errors |
| Circular dependency | DateTime ⟷ Duration | Resolved via TYPE_CHECKING |

#### Specific Refactoring Scenarios {#refactoring-scenarios}

**List L01: Documented Refactoring Test Cases** {#l01-refactoring-tests}

1. **Rename top-level function**: `temporale.format.iso8601.parse` -> `parse_iso8601`
   - Updates: definition, imports, calls across modules
   - Files: iso8601.py, datetime.py, date.py, time.py

2. **Rename class**: `Date` -> `CalendarDate`
   - Updates: class def, constructors, type hints, isinstance checks, docstrings (warning only)
   - Files: date.py, datetime.py, tests/

3. **Rename method in class hierarchy**: `BaseInstant.to_unix()` -> `to_epoch_seconds()`
   - Updates: base class, all subclasses (DateTime, Date), all call sites
   - Files: instant.py, datetime.py, date.py, tests/

4. **Rename property**: `DateTime.year` -> `DateTime.calendar_year`
   - Updates: property definition, all attribute accesses
   - Files: datetime.py, format/, tests/

5. **Rename enum member**: `Era.BCE` -> `Era.BEFORE_COMMON_ERA`
   - Updates: definition, all usages, comparisons
   - Files: era.py, date.py, format/

6. **Rename custom decorator**: `@validate_range` -> `@check_bounds`
   - Updates: decorator definition, all usages
   - Files: _internal/validation.py, date.py, time.py, datetime.py

7. **Rename exception class**: `ValidationError` -> `InvalidInputError`
   - Updates: class def, raise statements, except clauses, docstrings (warning)
   - Files: errors.py, all core modules

8. **Rename module-level variable**: `DEFAULT_TIMEZONE` -> `SYSTEM_TIMEZONE`
   - Updates: definition, imports, usages
   - Files: timezone.py, datetime.py

9. **Rename private method**: `DateTime._validate_components()` -> `DateTime._check_values()`
   - Updates: method def, internal calls
   - Files: datetime.py only (no external refs expected)

10. **Rename test function**: `test_date_addition` -> `test_add_duration_to_date`
    - Updates: function def
    - Files: tests/test_date.py

---

### 5.0.2 Epoch and Precision Specification {#epoch-spec}

#### Internal Timestamp Representation {#timestamp-repr}

**Spec S01: Timestamp Storage Format** {#s01-timestamp}

```python
class DateTime:
    __slots__ = ('_days', '_nanos', '_tz')

    _days: int    # Modified Julian Day number (can be negative)
    _nanos: int   # Nanoseconds since midnight [0, 86_400_000_000_000)
    _tz: Timezone | None  # Timezone (None = naive)
```

**Invariants:**
- `0 <= _nanos < 86_400_000_000_000` (nanoseconds per day)
- `_days` has no bounds (Python int is arbitrary precision)
- For practical purposes: `-3_652_059 <= _days <= 3_652_424` (years 1-9999 CE)

#### Epoch Reference Points {#epoch-references}

**Table T03: Epoch Conversions** {#t03-epochs}

| Epoch | Definition | MJD Value |
|-------|------------|-----------|
| MJD Zero | 1858-11-17 00:00 UTC | 0 |
| Unix Epoch | 1970-01-01 00:00 UTC | 40587 |
| J2000 | 2000-01-01 12:00 TT | 51545.5 |
| Windows NT Epoch | 1601-01-01 00:00 UTC | -94187 |
| Gregorian Reform | 1582-10-15 | -100840 |

#### Precision Guarantees {#precision-guarantees}

**Spec S02: Precision Requirements** {#s02-precision}

| Component | Precision | Storage | Range |
|-----------|-----------|---------|-------|
| Year | 1 year | int (via MJD) | Unlimited (practical: -9999 to 9999) |
| Month | 1 month | Computed from MJD | 1-12 |
| Day | 1 day | int (_days) | 1-31 (month-dependent) |
| Hour | 1 hour | Computed from _nanos | 0-23 |
| Minute | 1 minute | Computed from _nanos | 0-59 |
| Second | 1 second | Computed from _nanos | 0-59 |
| Millisecond | 1 ms | Computed from _nanos | 0-999 |
| Microsecond | 1 us | Computed from _nanos | 0-999999 |
| Nanosecond | 1 ns | int (_nanos % 10^9) | 0-999999999 |

#### String Roundtripping {#string-roundtrip}

**Spec S03: Format Roundtrip Guarantee** {#s03-roundtrip}

For any valid `DateTime` object `dt`:
```python
assert DateTime.parse(dt.format()) == dt  # ISO 8601 roundtrip
assert DateTime.from_json(dt.to_json()) == dt  # JSON roundtrip
```

Supported formats:
- ISO 8601: `2024-01-15T14:30:00.123456789Z`
- ISO 8601 Date only: `2024-01-15`
- ISO 8601 Time only: `14:30:00.123456789`
- RFC 3339: Same as ISO 8601 with `T` separator required
- Unix timestamp: `1705329000.123456789`

---

### 5.0.3 Module Specification {#module-spec}

#### Core Module: `temporale.core` {#module-core}

**Table T04: Core Module Symbols** {#t04-core-symbols}

| Symbol | Kind | Description |
|--------|------|-------------|
| `Date` | class | Calendar date (year, month, day) |
| `Time` | class | Time of day (hour, minute, second, nanosecond) |
| `DateTime` | class | Combined date and time with optional timezone |
| `Duration` | class | Time span (days, seconds, nanoseconds) |
| `Instant` | class | Absolute moment in time (base class) |

##### `Date` Class API {#date-api}

```python
class Date:
    """A calendar date in the proleptic Gregorian calendar."""

    __slots__ = ('_days',)

    # Construction
    def __init__(self, year: int, month: int, day: int) -> None: ...
    @classmethod
    def today(cls) -> Date: ...
    @classmethod
    def from_ordinal(cls, ordinal: int) -> Date: ...
    @classmethod
    def from_iso_format(cls, s: str) -> Date: ...

    # Properties
    @property
    def year(self) -> int: ...
    @property
    def month(self) -> int: ...
    @property
    def day(self) -> int: ...
    @property
    def day_of_week(self) -> int: ...  # Monday=0
    @property
    def day_of_year(self) -> int: ...
    @property
    def era(self) -> Era: ...
    @property
    def is_leap_year(self) -> bool: ...

    # Transformation
    def replace(self, year: int | None = None, month: int | None = None,
                day: int | None = None) -> Date: ...
    def add_days(self, days: int) -> Date: ...
    def add_months(self, months: int) -> Date: ...
    def add_years(self, years: int) -> Date: ...

    # Conversion
    def to_ordinal(self) -> int: ...
    def to_iso_format(self) -> str: ...
    def to_json(self) -> dict: ...

    # Operators
    def __add__(self, other: Duration) -> Date: ...
    def __sub__(self, other: Duration | Date) -> Date | Duration: ...
    def __eq__(self, other: object) -> bool: ...
    def __lt__(self, other: Date) -> bool: ...
    def __le__(self, other: Date) -> bool: ...
    def __gt__(self, other: Date) -> bool: ...
    def __ge__(self, other: Date) -> bool: ...
    def __hash__(self) -> int: ...
```

##### `Duration` Class API {#duration-api}

```python
class Duration:
    """A span of time with nanosecond precision."""

    __slots__ = ('_days', '_seconds', '_nanos')

    # Construction
    def __init__(self, days: int = 0, seconds: int = 0,
                 milliseconds: int = 0, microseconds: int = 0,
                 nanoseconds: int = 0) -> None: ...
    @classmethod
    def zero(cls) -> Duration: ...
    @classmethod
    def from_days(cls, days: int) -> Duration: ...
    @classmethod
    def from_hours(cls, hours: int) -> Duration: ...
    @classmethod
    def from_minutes(cls, minutes: int) -> Duration: ...
    @classmethod
    def from_seconds(cls, seconds: int) -> Duration: ...

    # Properties
    @property
    def days(self) -> int: ...
    @property
    def seconds(self) -> int: ...  # seconds part [0, 86400)
    @property
    def total_seconds(self) -> float: ...
    @property
    def nanoseconds(self) -> int: ...
    @property
    def is_negative(self) -> bool: ...

    # Operators
    def __add__(self, other: Duration) -> Duration: ...
    def __sub__(self, other: Duration) -> Duration: ...
    def __mul__(self, other: int) -> Duration: ...
    def __truediv__(self, other: int) -> Duration: ...
    def __floordiv__(self, other: int) -> Duration: ...
    def __neg__(self) -> Duration: ...
    def __abs__(self) -> Duration: ...
```

##### Duration Normalization Rules {#duration-normalization}

**Spec S07: Duration Canonical Form** {#s07-duration-canonical}

Duration uses a normalized representation where `_seconds` and `_nanos` are always non-negative, borrowing from `_days` as needed for negative totals.

**Invariants (always true after construction/operation):**
- `0 <= _seconds < 86400` (seconds per day)
- `0 <= _nanos < 1_000_000_000` (nanos per second)
- Canonical form keeps `_seconds` and `_nanos` non-negative, using `_days` to represent negative totals via borrowing
- A "zero" duration has `_days == 0`, `_seconds == 0`, `_nanos == 0`

**Normalization algorithm:**
```python
def _normalize(self) -> None:
    # Carry nanos to seconds
    extra_secs, self._nanos = divmod(self._nanos, 1_000_000_000)
    self._seconds += extra_secs

    # Carry seconds to days
    extra_days, self._seconds = divmod(self._seconds, 86400)
    self._days += extra_days

    # Handle negative totals: borrow from days to keep _seconds/_nanos positive
    if self._seconds < 0 or self._nanos < 0:
        # Convert everything to total nanos, then redistribute
        total_nanos = (self._days * 86400 * 1_000_000_000
                      + self._seconds * 1_000_000_000
                      + self._nanos)
        if total_nanos < 0:
            # Negative duration: days negative, seconds/nanos positive
            total_nanos = -total_nanos
            self._days = -(total_nanos // (86400 * 1_000_000_000))
            remainder = total_nanos % (86400 * 1_000_000_000)
            self._seconds = remainder // 1_000_000_000
            self._nanos = remainder % 1_000_000_000
            if self._seconds > 0 or self._nanos > 0:
                self._days -= 1  # Borrow one more day
                self._seconds = 86400 - self._seconds - (1 if self._nanos > 0 else 0)
                self._nanos = (1_000_000_000 - self._nanos) % 1_000_000_000
        else:
            self._days = total_nanos // (86400 * 1_000_000_000)
            remainder = total_nanos % (86400 * 1_000_000_000)
            self._seconds = remainder // 1_000_000_000
            self._nanos = remainder % 1_000_000_000
```

**Examples:**
| Input | Normalized `(_days, _seconds, _nanos)` |
|-------|----------------------------------------|
| `Duration(seconds=90000)` | `(1, 3600, 0)` |
| `Duration(days=-1, hours=12)` | `(-1, 43200, 0)` |
| `Duration(nanoseconds=-500)` | `(-1, 86399, 999999500)` |
| `Duration(days=1) - Duration(hours=36)` | `(-1, 43200, 0)` |

**`total_seconds` precision note:**
`total_seconds() -> float` is approximate due to float precision limits. For exact calculations, use `total_nanos() -> int` or work with component accessors.

---

#### Units Module: `temporale.units` {#module-units}

**Table T05: Units Module Symbols** {#t05-units-symbols}

| Symbol | Kind | Description |
|--------|------|-------------|
| `Era` | enum | BCE/CE era designation |
| `TimeUnit` | enum | Standard time units (YEAR, MONTH, DAY, etc.) |
| `Timezone` | class | Timezone representation (UTC offset model) |

##### `Era` Enum {#era-enum}

```python
from enum import Enum

class Era(Enum):
    """Historical era designation."""

    BCE = "BCE"  # Before Common Era
    CE = "CE"    # Common Era

    @property
    def is_before_common_era(self) -> bool:
        """Return True if this is BCE."""
        return self == Era.BCE
```

##### `Timezone` Class {#timezone-class}

```python
class Timezone:
    """A timezone represented as a UTC offset."""

    __slots__ = ('_offset_seconds', '_name')

    # Construction
    def __init__(self, offset_seconds: int, name: str | None = None) -> None: ...

    @classmethod
    def utc(cls) -> Timezone: ...

    @classmethod
    def from_hours(cls, hours: int, minutes: int = 0) -> Timezone: ...

    @classmethod
    def from_string(cls, s: str) -> Timezone: ...  # "+05:30", "Z", "UTC"

    # Properties
    @property
    def offset_seconds(self) -> int: ...
    @property
    def offset_hours(self) -> float: ...
    @property
    def name(self) -> str | None: ...
    @property
    def is_utc(self) -> bool: ...
```

#### Format Module: `temporale.format` {#module-format}

**Table T06: Format Module Symbols** {#t06-format-symbols}

| Symbol | Kind | Description |
|--------|------|-------------|
| `parse_iso8601` | function | Parse ISO 8601 datetime string |
| `format_iso8601` | function | Format datetime to ISO 8601 |
| `parse_rfc3339` | function | Parse RFC 3339 datetime string |
| `format_rfc3339` | function | Format datetime to RFC 3339 |
| `strftime` | function | Format using strftime pattern |
| `strptime` | function | Parse using strftime pattern |

#### Convert Module: `temporale.convert` {#module-convert}

**Table T07: Convert Module Symbols** {#t07-convert-symbols}

| Symbol | Kind | Description |
|--------|------|-------------|
| `to_json` | function | Convert temporal object to JSON-serializable dict |
| `from_json` | function | Create temporal object from JSON dict |
| `to_unix_seconds` | function | Convert to Unix timestamp (seconds) |
| `from_unix_seconds` | function | Create from Unix timestamp |
| `to_unix_millis` | function | Convert to Unix milliseconds |
| `from_unix_millis` | function | Create from Unix milliseconds |

#### Internal Module: `temporale._internal` {#module-internal}

**Table T08: Internal Module Symbols** {#t08-internal-symbols}

| Symbol | Kind | Description |
|--------|------|-------------|
| `validate_range` | decorator | Validate numeric ranges |
| `deprecated` | decorator | Mark function as deprecated |
| `DAYS_IN_MONTH` | constant | Days per month lookup |
| `MAX_YEAR` | constant | Maximum supported year |
| `MIN_YEAR` | constant | Minimum supported year |
| `NANOS_PER_SECOND` | constant | 1_000_000_000 |
| `NANOS_PER_DAY` | constant | 86_400_000_000_000 |

---

### 5.0.4 Test Infrastructure {#test-infrastructure}

#### Running Python Tests in Tugtool Environment {#running-python-tests}

**Spec S04: Python Test Execution** {#s04-test-execution}

---

**⚠️⚠️⚠️ CRITICAL WARNING: READ THIS BEFORE RUNNING ANY PYTHON TESTS ⚠️⚠️⚠️**

**THE ONE AND ONLY CORRECT WAY TO RUN PYTHON TESTS:**

```bash
# Absolute path (always works):
/Users/kocienda/Mounts/u/src/tugtool/.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/ -v

# Or from workspace root:
.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/ -v
```

**ABSOLUTELY FORBIDDEN - NEVER DO THESE:**
- ❌ `uv run python -m pytest ...` - AUTO-CREATES UNWANTED VENVS, BREAKS EVERYTHING
- ❌ `python -m pytest ...` - WRONG PYTHON, MISSING DEPENDENCIES
- ❌ `pytest ...` - MAY USE SYSTEM PYTEST WITHOUT TEMPORALE
- ❌ Looking in `sample-code/python/temporale/.tug-test-venv/` - WRONG LOCATION

**THE VENV IS AT THE WORKSPACE ROOT:** `/Users/kocienda/Mounts/u/src/tugtool/.tug-test-venv/`

---

Temporale tests are run via pytest. Two testing approaches:

**Approach 1: Standalone pytest (library validation)**

**CANONICAL COMMAND (from workspace root):**
```bash
.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/ -v
```

**IMPORTANT: ONE venv, at workspace root.**
- All Python testing uses `.tug-test-venv/` at the tugtool workspace root
- NO per-project venvs in sample-code directories
- NEVER use `uv run pytest` inside sample-code projects (it auto-creates venvs)
- The venv is created automatically by Rust test infrastructure or manually via:
  ```bash
  uv venv --python 3.11 .tug-test-venv
  uv pip install --python .tug-test-venv/bin/python pytest
  uv pip install --python .tug-test-venv/bin/python -e sample-code/python/temporale/
  ```

**Approach 2: Tugtool integration tests (refactoring validation)**

Create a Rust integration test that:
1. Copies Temporale to a temp directory
2. Analyzes with `analyze_files()`
3. Performs a refactoring operation
4. Runs pytest on the refactored code
5. Verifies pytest still passes

```rust
// crates/tugtool/tests/temporale_refactor.rs

#[test]
fn test_rename_date_class() {
    let workspace = TempWorkspace::copy_from("sample-code/python/temporale");

    // Analyze
    let files = workspace.python_files();
    let mut store = FactsStore::new();
    let bundle = analyze_files(&files, &mut store).unwrap();

    // Find Date symbol
    let date_symbol = store.symbols().find(|s| s.name == "Date").unwrap();

    // Rename Date -> CalendarDate
    let edits = rename_symbol(&store, date_symbol.symbol_id, "CalendarDate").unwrap();

    // Apply edits
    workspace.apply_edits(&edits);

    // Run pytest to verify code still works
    let result = workspace.run_command("python", &["-m", "pytest", "tests/", "-v"]);
    assert!(result.success(), "pytest should pass after rename");
}
```

#### Test Directory Structure {#test-structure}

**Clarification:** Tests live at project root level, as a sibling to the `temporale` package, NOT inside the package.

```
sample-code/python/temporale/    # Project root (this is the directory name)
    pyproject.toml               # Project config with pytest settings
    temporale/                   # The package (importable as `import temporale`)
        __init__.py
        core/
        units/
        format/
        convert/
        arithmetic/
        _internal/
        errors.py
    tests/                       # Tests directory (sibling to package)
        __init__.py
        conftest.py              # pytest fixtures
        test_date.py             # Date class tests
        test_time.py             # Time class tests
        test_datetime.py         # DateTime class tests
        test_duration.py         # Duration class tests
        test_timezone.py         # Timezone tests
        test_era.py              # Era enum tests
        test_format.py           # Formatting tests
        test_parse.py            # Parsing tests
        test_arithmetic.py       # Arithmetic operation tests
        test_json.py             # JSON roundtrip tests
        test_edge_cases.py       # Edge cases, boundary conditions
```

**Run tests from workspace root:**
```bash
.tug-test-venv/bin/python -m pytest sample-code/python/temporale/tests/ -v
```

#### pytest Configuration {#pytest-config}

**File: `sample-code/python/temporale/pyproject.toml`**
```toml
[project]
name = "temporale"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
addopts = "-v --tb=short"
```

---

### 5.0.5 Python Environment for Test and CI {#python-environment}

#### Local Development {#local-dev}

**Requirement:** Python 3.10+ must be available on the development machine.

**Verification:**
```bash
python3 --version  # Should report 3.10.x, 3.11.x, or 3.12.x
```

**Setup (if needed):**
- macOS: `brew install python@3.12`
- Linux: Use system package manager or pyenv
- All platforms: [python.org](https://www.python.org/downloads/)

#### Rust Integration Test Approach {#rust-integration-approach}

**Spec S05: Python Binary Discovery** {#s05-python-discovery}

Rust integration tests that need to run Python (pytest) will:

1. **Use `std::process::Command`** to invoke Python directly
2. **Discover Python via `TUG_PYTHON` or PATH** - prefer `TUG_PYTHON`, otherwise expect `python3` to be available
3. **Skip gracefully** if Python is not found (for CI environments that don't have Python)

**Implementation pattern:**
```rust
// crates/tugtool/tests/support/python.rs

// Prefer `TUG_PYTHON` when set; otherwise try python3/python from PATH.
// Skip the test if pytest isn't available.
let python = skip_if_no_pytest!();

let result = support::python::run_pytest(&python, dir, &["tests/", "-v"]);
assert!(result.success, "pytest should pass: {}", result.stderr);
```

**Test pattern with skip:**
```rust
#[test]
fn test_rename_preserves_functionality() {
    let python = skip_if_no_pytest!();

    // ... apply refactor into `dir` ...

    let result = support::python::run_pytest(&python, dir, &["tests/", "-v"]);
    assert!(result.success, "pytest should pass: {}", result.stderr);
}
```

#### CI Configuration {#ci-configuration}

**Spec S06: GitHub Actions Python Setup** {#s06-ci-python}

Add Python to the CI matrix for integration tests that require it.

**File: `.github/workflows/ci.yml` (additions)**
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install pytest
        run: pip install pytest

      - name: Set up Rust
        uses: dtolnay/rust-action@stable

      - name: Run tests
        run: cargo nextest run --workspace
```

**Alternative: Separate job for Python-dependent tests**
```yaml
jobs:
  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-action@stable
      - run: cargo nextest run --workspace --exclude-filter 'temporale'

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install pytest
      - uses: dtolnay/rust-action@stable
      - run: cargo nextest run --workspace --filter 'temporale'
```

#### Python Version Matrix (Optional Enhancement) {#python-matrix}

For thorough testing across Python versions:

```yaml
jobs:
  python-compat:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.10', '3.11', '3.12']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pip install pytest
      - run: |
          cd sample-code/python/temporale
          python -m pytest tests/ -v
```

#### Summary: Python in Tugtool Testing {#python-summary}

| Context | Python Requirement | How to Handle |
|---------|-------------------|---------------|
| Local development | Required for Temporale tests | Developer installs Python 3.10+ |
| Rust unit tests | Not required | Tests skip if Python unavailable |
| Rust integration tests | Required for pytest verification | CI installs Python via setup-python |
| Standalone Temporale | Required | `python3 -m pytest tests/` |

**Key principle:** Rust tests that don't need Python should work without it. Only integration tests that verify "refactoring preserves functionality" (by running pytest) require Python.

---

### 5.0.6 Documentation Plan {#documentation-plan}

- [ ] Module-level docstrings in all `__init__.py` files
- [ ] Class docstrings following Google style
- [ ] Method docstrings for all public methods
- [ ] Type annotations for all public symbols
- [ ] Example usage in class docstrings
- [ ] README.md with installation and basic usage (minimal)

---

### 5.0.7 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | Location |
|----------|---------|----------|
| Unit | Test individual methods in isolation | `tests/test_*.py` |
| Property-based | Test invariants over random inputs | Future enhancement |
| Roundtrip | Test serialization/deserialization | `tests/test_json.py`, `tests/test_format.py` |
| Refactoring | Test code still works after refactor | `crates/tugtool/tests/temporale_refactor.rs` |

#### Key Test Scenarios {#test-scenarios}

**Table T09: Essential Test Cases** {#t09-test-cases}

| Test | Description | Why Important |
|------|-------------|---------------|
| Date construction | Valid and invalid dates | Basic correctness |
| Leap year handling | Feb 29 in leap/non-leap years | Edge case |
| BCE dates | Dates before year 1 | Epoch edge case |
| Nanosecond precision | Sub-microsecond operations | Precision guarantee |
| Timezone conversion | UTC to offset and back | Core functionality |
| ISO 8601 roundtrip | Parse(format(dt)) == dt | String representation |
| JSON roundtrip | from_json(to_json(dt)) == dt | Serialization |
| Duration arithmetic | Add, subtract durations | Operator correctness |
| DateTime + Duration | Date arithmetic | Cross-type operations |
| Comparison operators | < > <= >= == != | Ordering |
| Boundary dates | Year 1, Year 9999, Month transitions | Limits |

---

### 5.0.8 Execution Steps {#execution-steps}

#### Step 1: Python Environment Prerequisites {#step-1}

**Purpose:** Replace fragile PATH-based Python discovery with `uv`-managed project-local virtual environment for reliable pytest execution in both local development and CI.

**Commit:** `feat(tests): use uv for Python test environment management`

---

##### Why This Approach {#step-1-rationale}

The previous approach (checking PATH for `python3`/`python` and validating version 3.10+) is fragile on macOS with Homebrew because:

1. Multiple Python versions may be installed
2. PATH order is unpredictable
3. System Python may not have pytest installed
4. Developers must manually manage Python environments

**Solution:** Use `uv` (Astral's fast Python package manager) to manage a project-local virtual environment at `.tug-test-venv/`.

##### Design Decisions {#step-1-decisions}

**[SD01] Use `uv` for Python Environment Management**

- `uv` is extremely fast (10-100x faster than pip)
- Single binary, easy to install
- Handles Python version management transparently
- Widely adopted in the Rust/Python ecosystem
- Astral provides first-class GitHub Actions support (`astral-sh/setup-uv`)

**[SD02] Project-Local Virtual Environment**

Store the test venv at `.tug-test-venv/` in the project root:
- Isolated from system Python
- Gitignored, so each developer has their own
- Reproducible across machines
- Clear separation from any user venvs (`.venv/` is already gitignored for user use)

**[SD03] Pinned Python 3.11**

Pin to Python 3.11 explicitly rather than "3.10+":
- Python 3.11 is stable and widely available
- Matches CI's current setup
- Avoids version drift between local and CI
- 3.11 has good performance improvements over 3.10

**[SD04] Fallback Chain for Python Discovery**

1. `TUG_PYTHON` environment variable (if set and valid with pytest)
2. Existing venv at `.tug-test-venv/` (if valid)
3. Create venv with `uv` (if `uv` available)
4. Skip with helpful error message

**[SD05] CI Uses `astral-sh/setup-uv`**

Replace `actions/setup-python@v5` with `astral-sh/setup-uv@v5` in CI:
- Single action handles both uv installation and Python management
- Faster CI runs
- Consistent with local development workflow

---

##### Artifacts {#step-1-artifacts}

| File | Action |
|------|--------|
| `.gitignore` | Add `.tug-test-venv/` |
| `crates/tugtool/tests/support/mod.rs` | No change needed |
| `crates/tugtool/tests/support/python.rs` | Complete rewrite |
| `crates/tugtool/tests/python_env_test.rs` | Update for new API |
| `.github/workflows/ci.yml` | Use `astral-sh/setup-uv@v5` |

---

##### Tasks {#step-1-tasks}

**Task 1: Update `.gitignore`**

Add `.tug-test-venv/` to gitignore:

```diff
 # Python
 __pycache__/
 *.py[cod]
 *$py.class
 *.so
 .Python
 *.egg-info/
 .eggs/
 dist/
 build/
 *.whl
 .venv/
+.tug-test-venv/
```

**Task 2: Rewrite `crates/tugtool/tests/support/python.rs`**

```rust
//! Python execution helpers for integration tests.
//!
//! Provides utilities to:
//! - Find or create a Python 3.11 virtual environment
//! - Check if pytest is available
//! - Run pytest on a directory and capture results
//!
//! **Environment discovery order:**
//! 1. `TUG_PYTHON` environment variable (if set and valid)
//! 2. Existing venv at `.tug-test-venv/` (if valid with pytest)
//! 3. Create venv with `uv` (if `uv` is available)
//! 4. Return None with helpful error message

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Cached Python environment path.
/// This is computed once per test run and reused.
static PYTHON_ENV: OnceLock<Option<PythonEnv>> = OnceLock::new();

/// A validated Python environment with pytest available.
#[derive(Debug, Clone)]
pub struct PythonEnv {
    /// Path to the Python executable
    pub python_path: PathBuf,
    /// Path to the venv directory (None if using TUG_PYTHON directly)
    pub venv_path: Option<PathBuf>,
}

impl PythonEnv {
    /// Get the Python command as a string for Command::new()
    pub fn python_cmd(&self) -> &Path {
        &self.python_path
    }
}

/// Result of a pytest execution.
#[derive(Debug)]
pub struct PytestResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Get the workspace root (where Cargo.toml lives).
fn workspace_root() -> Option<PathBuf> {
    // Start from CARGO_MANIFEST_DIR if available, otherwise current dir
    let start = env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_default());

    // Walk up to find workspace root (has Cargo.toml with [workspace])
    let mut current = start.as_path();
    loop {
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            // Check if this is the workspace root
            if let Ok(contents) = std::fs::read_to_string(&cargo_toml) {
                if contents.contains("[workspace]") {
                    return Some(current.to_path_buf());
                }
            }
        }
        current = current.parent()?;
    }
}

/// Path to the project-local test venv.
fn test_venv_path() -> Option<PathBuf> {
    workspace_root().map(|root| root.join(".tug-test-venv"))
}

/// Get the Python executable path within a venv.
fn venv_python(venv_path: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_path.join("Scripts").join("python.exe")
    } else {
        venv_path.join("bin").join("python")
    }
}

/// Check if a Python executable is valid (exists and is Python 3.10+).
fn is_valid_python(python_path: &Path) -> bool {
    if !python_path.exists() {
        return false;
    }

    Command::new(python_path)
        .args(["--version"])
        .output()
        .map(|output| {
            if !output.status.success() {
                return false;
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = if stdout.starts_with("Python") {
                stdout
            } else {
                stderr
            };

            // Parse "Python 3.X.Y" - we need X >= 10
            version
                .strip_prefix("Python 3.")
                .and_then(|rest| rest.split('.').next())
                .and_then(|minor_str| minor_str.parse::<u32>().ok())
                .map(|minor| minor >= 10)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Check if pytest is available via the given Python executable.
fn has_pytest(python_path: &Path) -> bool {
    Command::new(python_path)
        .args(["-m", "pytest", "--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if uv is available in PATH.
fn has_uv() -> bool {
    Command::new("uv")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Create a venv using uv and install pytest.
fn create_venv_with_uv(venv_path: &Path) -> Result<(), String> {
    eprintln!(
        "Creating test venv at {} with uv...",
        venv_path.display()
    );

    // Create venv with Python 3.11
    let status = Command::new("uv")
        .args(["venv", "--python", "3.11"])
        .arg(venv_path)
        .status()
        .map_err(|e| format!("Failed to run uv venv: {}", e))?;

    if !status.success() {
        return Err("uv venv failed".to_string());
    }

    // Install pytest into the venv
    let status = Command::new("uv")
        .args(["pip", "install", "--python"])
        .arg(venv_python(venv_path))
        .arg("pytest")
        .status()
        .map_err(|e| format!("Failed to run uv pip install: {}", e))?;

    if !status.success() {
        return Err("uv pip install pytest failed".to_string());
    }

    eprintln!("Test venv created successfully.");
    Ok(())
}

/// Find or create a Python environment suitable for running pytest.
///
/// This function is memoized - it only runs once per process.
fn find_or_create_python_env() -> Option<PythonEnv> {
    // 1. Check TUG_PYTHON environment variable
    if let Ok(tug_python) = env::var("TUG_PYTHON") {
        let python_path = PathBuf::from(&tug_python);
        if is_valid_python(&python_path) && has_pytest(&python_path) {
            return Some(PythonEnv {
                python_path,
                venv_path: None,
            });
        } else if is_valid_python(&python_path) {
            eprintln!(
                "WARNING: TUG_PYTHON={} is valid Python but pytest is not installed",
                tug_python
            );
        } else {
            eprintln!(
                "WARNING: TUG_PYTHON={} is not a valid Python 3.10+ executable",
                tug_python
            );
        }
    }

    // 2. Check existing .tug-test-venv
    if let Some(venv_path) = test_venv_path() {
        let python_path = venv_python(&venv_path);
        if is_valid_python(&python_path) && has_pytest(&python_path) {
            return Some(PythonEnv {
                python_path,
                venv_path: Some(venv_path),
            });
        }
    }

    // 3. Try to create venv with uv
    if has_uv() {
        if let Some(venv_path) = test_venv_path() {
            // Remove corrupted venv if it exists but is invalid
            if venv_path.exists() {
                eprintln!(
                    "Existing venv at {} is invalid, recreating...",
                    venv_path.display()
                );
                let _ = std::fs::remove_dir_all(&venv_path);
            }

            if create_venv_with_uv(&venv_path).is_ok() {
                let python_path = venv_python(&venv_path);
                if is_valid_python(&python_path) && has_pytest(&python_path) {
                    return Some(PythonEnv {
                        python_path,
                        venv_path: Some(venv_path),
                    });
                }
            }
        }
    }

    // 4. No Python available
    eprintln!(
        "\n\
        ============================================================\n\
        Python test environment not available.\n\
        \n\
        To set up the test environment, either:\n\
        \n\
        1. Install uv and let tests auto-create the venv:\n\
           curl -LsSf https://astral.sh/uv/install.sh | sh\n\
        \n\
        2. Or set TUG_PYTHON to a Python 3.10+ with pytest:\n\
           export TUG_PYTHON=/path/to/python3\n\
           pip install pytest\n\
        ============================================================\n"
    );
    None
}

/// Get the Python environment, creating it if necessary.
///
/// This function caches its result - the environment is only discovered/created
/// once per process, then reused for all tests.
pub fn get_python_env() -> Option<&'static PythonEnv> {
    PYTHON_ENV
        .get_or_init(find_or_create_python_env)
        .as_ref()
}

/// Check if pytest is ready to run.
///
/// Returns the Python environment if available, None otherwise.
pub fn pytest_ready() -> Option<&'static PythonEnv> {
    get_python_env()
}

/// Legacy compatibility: find_python returns the Python command as a String.
pub fn find_python() -> Option<String> {
    get_python_env().map(|env| env.python_path.to_string_lossy().to_string())
}

/// Legacy compatibility: check if pytest is available for a given Python command.
pub fn pytest_available(python_cmd: &str) -> bool {
    has_pytest(Path::new(python_cmd))
}

/// Run pytest on the specified directory.
///
/// # Arguments
/// - `python_env`: The Python environment to use
/// - `dir`: The directory containing tests
/// - `extra_args`: Additional arguments to pass to pytest
///
/// # Returns
/// `PytestResult` with success status and captured output.
pub fn run_pytest(python_env: &PythonEnv, dir: &Path, extra_args: &[&str]) -> PytestResult {
    run_pytest_with_cmd(python_env.python_cmd(), dir, extra_args)
}

/// Run pytest using a Python command path.
///
/// This is the legacy API that accepts a string path.
pub fn run_pytest_with_cmd(python_cmd: &Path, dir: &Path, extra_args: &[&str]) -> PytestResult {
    let mut cmd = Command::new(python_cmd);
    cmd.current_dir(dir);
    cmd.args(["-m", "pytest"]);
    cmd.args(extra_args);

    match cmd.output() {
        Ok(output) => PytestResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
        },
        Err(e) => PytestResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to execute pytest: {}", e),
            exit_code: None,
        },
    }
}

/// Macro to skip a test if pytest is not available.
///
/// Usage:
/// ```ignore
/// #[test]
/// fn test_requires_pytest() {
///     let python_env = skip_if_no_pytest!();
///     // ... rest of test using `python_env`
/// }
/// ```
#[macro_export]
macro_rules! skip_if_no_pytest {
    () => {
        match $crate::support::python::pytest_ready() {
            Some(env) => env,
            None => {
                eprintln!(
                    "SKIPPED: pytest not available (run with uv or set TUG_PYTHON)"
                );
                return;
            }
        }
    };
}
```

**Task 3: Update `crates/tugtool/tests/python_env_test.rs`**

```rust
//! Smoke test for Python test infrastructure.
//!
//! This test verifies that the Python + pytest setup works.
//! It should pass in CI and on any dev machine with Python 3.10+ and pytest.

mod support;

#[test]
fn pytest_available_in_ci() {
    // In CI, pytest MUST be available (we install it via uv in ci.yml)
    // Locally, this test will skip gracefully if pytest is missing
    if std::env::var("CI").is_ok() {
        let python_env = support::python::pytest_ready()
            .expect("Python test environment must be available in CI");
        eprintln!(
            "CI Python environment: {}",
            python_env.python_path.display()
        );
    } else {
        // Local: just report status
        match support::python::pytest_ready() {
            Some(env) => {
                eprintln!("Python test env ready: {}", env.python_path.display());
                if let Some(venv) = &env.venv_path {
                    eprintln!("  venv: {}", venv.display());
                }
            }
            None => eprintln!("SKIPPED: pytest not available locally (install uv to auto-create)"),
        }
    }
}

#[test]
fn can_run_pytest_on_simple_test() {
    let python_env = skip_if_no_pytest!();

    // Create a minimal test in a temp directory
    let temp = tempfile::TempDir::new().unwrap();
    let test_file = temp.path().join("test_smoke.py");
    std::fs::write(&test_file, "def test_passes(): assert True\n").unwrap();

    let result = support::python::run_pytest(python_env, temp.path(), &["-v"]);

    assert!(
        result.success,
        "pytest should pass on trivial test: {}",
        result.stderr
    );
    assert!(
        result.stdout.contains("1 passed"),
        "Should report 1 passed test"
    );
}

#[test]
fn venv_is_reused_across_tests() {
    // This test verifies that get_python_env() returns the same cached result
    let env1 = support::python::get_python_env();
    let env2 = support::python::get_python_env();

    // Both should be the same (either both Some with same path, or both None)
    match (env1, env2) {
        (Some(e1), Some(e2)) => {
            assert_eq!(
                e1.python_path, e2.python_path,
                "Python env should be cached and reused"
            );
        }
        (None, None) => {
            // Both None is fine - just means pytest isn't available
        }
        _ => panic!("get_python_env() returned inconsistent results"),
    }
}
```

**Task 4: Update `.github/workflows/ci.yml`**

Replace the entire CI workflow with uv-based configuration:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always

jobs:
  test:
    name: Test (${{ matrix.os }}, ${{ matrix.rust }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
        rust: [stable, beta]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@master
        with:
          toolchain: ${{ matrix.rust }}
          components: rustfmt, clippy

      - uses: Swatinem/rust-cache@v2

      # Use uv for Python environment management
      - uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      # Create test venv with Python 3.11 and pytest
      - name: Create test venv
        run: |
          uv venv --python 3.11 .tug-test-venv
          uv pip install --python .tug-test-venv/bin/python pytest

      # Set TUG_PYTHON to the venv's Python
      - name: Set TUG_PYTHON
        run: echo "TUG_PYTHON=$PWD/.tug-test-venv/bin/python" >> $GITHUB_ENV
        shell: bash

      - name: Format check
        run: cargo fmt --all --check

      - name: Clippy
        run: cargo clippy --workspace --features full -- -D warnings

      - name: Install nextest
        uses: taiki-e/install-action@nextest

      - name: Build
        run: cargo build --workspace --features full

      - name: Test
        run: cargo nextest run --workspace --features full

  python:
    name: Python Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Create test venv
        run: |
          uv venv --python 3.11 .tug-test-venv
          uv pip install --python .tug-test-venv/bin/python pytest

      - name: Check Python fixtures
        run: .tug-test-venv/bin/python -m compileall -q crates/tugtool/tests/fixtures/python/
```

---

##### Edge Cases Handled {#step-1-edge-cases}

| Scenario | Behavior |
|----------|----------|
| Developer doesn't have `uv` installed | Skip with helpful installation instructions |
| `TUG_PYTHON` set but invalid | Warning printed, fallback to venv discovery |
| `TUG_PYTHON` set but no pytest | Warning printed, fallback to venv discovery |
| Venv exists but corrupted | Delete and recreate |
| Multiple test processes in parallel | Thread-safe via `OnceLock`, venv reused |
| Windows | Path handling ready (not in CI matrix yet) |

---

##### Verification Commands {#step-1-verification}

**Prerequisites (local):**

```bash
# 1. Install uv if not present
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Verify uv is installed
uv --version
# Expected: uv 0.x.x or later
```

**After implementation:**

```bash
# 1. Verify .gitignore updated
grep -q ".tug-test-venv/" .gitignore && echo "OK: .gitignore updated"

# 2. Build tests
cargo build -p tugtool --tests
# Expected: Compiling tugtool v0.x.x ...

# 3. Run Python environment test
cargo nextest run -p tugtool pytest_available_in_ci
# Expected: PASSED (or shows venv being created)

# 4. Run pytest smoke test
cargo nextest run -p tugtool can_run_pytest_on_simple_test
# Expected: PASSED

# 5. Verify venv was created
ls -la .tug-test-venv/bin/python
# Expected: file exists

# 6. Verify pytest is installed in venv
.tug-test-venv/bin/python -m pytest --version
# Expected: pytest X.Y.Z

# 7. Run all Python-related tests
cargo nextest run -p tugtool python
# Expected: All tests pass

# 8. Full CI check
just ci
# Expected: All checks pass
```

---

##### Tests {#step-1-tests}

- [ ] `cargo build -p tugtool --tests` compiles without errors
- [ ] `cargo nextest run -p tugtool pytest_available_in_ci` passes (in CI)
- [ ] `cargo nextest run -p tugtool can_run_pytest` passes (when uv available)
- [ ] `cargo nextest run -p tugtool venv_is_reused` passes
- [ ] Tests skip gracefully with message when uv is unavailable

##### Checkpoint {#step-1-checkpoint}

- [ ] CI workflow runs with `astral-sh/setup-uv@v5` and all tests pass
- [ ] Local `uv --version` returns a version
- [ ] Local `cargo nextest run -p tugtool python_env` runs (creates venv or uses existing)
- [ ] `.tug-test-venv/` is created and functional

##### Rollback {#step-1-rollback}

```bash
# Revert file changes
git checkout HEAD -- \
    .gitignore \
    .github/workflows/ci.yml \
    crates/tugtool/tests/support/python.rs \
    crates/tugtool/tests/python_env_test.rs

# Clean up any created venv
rm -rf .tug-test-venv

# Verify build still works
cargo build -p tugtool --tests
cargo nextest run -p tugtool pytest
```

**Commit after all checkpoints pass.**

---

#### Step 2: Create Directory Structure and Package Scaffolding {#step-2}

**Commit:** `feat(sample-code): scaffold temporale package structure`

**References:** [D01] Module structure, Table T04-T08, (#module-spec)

**Artifacts:**
- `sample-code/python/temporale/` directory tree
- All `__init__.py` files with docstrings
- `pyproject.toml` with project metadata
- Empty placeholder modules

**Tasks:**
- [x] Create directory structure per [D01]
- [x] Create all `__init__.py` files with module docstrings
- [x] Create `pyproject.toml` with pytest configuration
- [x] Create `temporale/errors.py` with exception hierarchy per [D06]
- [x] Create `temporale/_internal/constants.py` with constants per Table T08

**Tests:**
- [x] Unit test: Import `temporale` succeeds
- [x] Unit test: All submodules importable

**Checkpoint:**
- [x] `python -c "import temporale"` succeeds
- [x] `python -c "from temporale._internal.constants import NANOS_PER_SECOND"` succeeds

**Rollback:** `rm -rf sample-code/python/temporale`

**Commit after all checkpoints pass.**

---

#### Step 3: Implement Era and TimeUnit Enums {#step-3}

**Commit:** `feat(temporale): add Era and TimeUnit enums`

**References:** [D04] Operators, Table T05, (#module-units)

**Artifacts:**
- `temporale/units/era.py` with Era enum
- `temporale/units/timeunit.py` with TimeUnit enum
- `tests/test_era.py` with enum tests

**Tasks:**
- [x] Implement `Era` enum with BCE/CE values and `is_before_common_era` property
- [x] Implement `TimeUnit` enum with YEAR, MONTH, WEEK, DAY, HOUR, MINUTE, SECOND, MILLISECOND, MICROSECOND, NANOSECOND
- [x] Add `to_seconds()` method to TimeUnit for unit conversion
- [x] Export from `temporale/units/__init__.py`

**Tests:**
- [x] Unit test: Era.BCE and Era.CE values
- [x] Unit test: Era.is_before_common_era property
- [x] Unit test: TimeUnit values and ordering
- [x] Unit test: TimeUnit.to_seconds() conversion

**Checkpoint:**
- [x] `python -m pytest tests/test_era.py -v` passes

**Rollback:** Remove era.py, timeunit.py, revert __init__.py changes

**Commit after all checkpoints pass.**

---

#### Step 4: Implement Timezone Class {#step-4}

**Commit:** `feat(temporale): add Timezone class with UTC offset model`

**References:** [D02] Immutability, Table T05, (#timezone-class)

**Artifacts:**
- `temporale/units/timezone.py` with Timezone class
- `tests/test_timezone.py` with timezone tests

**Tasks:**
- [x] Implement Timezone class with `__slots__`
- [x] Add `utc()` classmethod for UTC singleton pattern
- [x] Add `from_hours()` classmethod for common construction
- [x] Add `from_string()` parser for "+05:30", "Z", "UTC" formats
- [x] Implement `__eq__`, `__hash__`, `__repr__`
- [x] Export from `temporale/units/__init__.py`

**Tests:**
- [x] Unit test: Timezone.utc() properties
- [x] Unit test: from_hours positive and negative offsets
- [x] Unit test: from_string parsing various formats
- [x] Unit test: Equality and hashing

**Checkpoint:**
- [x] `python -m pytest tests/test_timezone.py -v` passes
- [x] `analyze_files()` on timezone.py finds Timezone class and methods

**Rollback:** Remove timezone.py and test file

**Commit after all checkpoints pass.**

---

#### Step 5: Implement Duration Class {#step-5}

**Commit:** `feat(temporale): add Duration class with nanosecond precision`

**References:** [D02] Immutability, [D04] Operators, [D07] Subseconds, (#duration-api)

**Artifacts:**
- `temporale/core/duration.py` with Duration class
- `tests/test_duration.py` with duration tests

**Tasks:**
- [x] Implement Duration with `_days`, `_seconds`, `_nanos` slots
- [x] Add normalization logic to ensure consistent representation
- [x] Implement all factory methods: `zero()`, `from_days()`, `from_hours()`, etc.
- [x] Implement properties: `days`, `seconds`, `total_seconds`, `nanoseconds`
- [x] Implement arithmetic operators: `+`, `-`, `*`, `/`, `//`, unary `-`, `abs`
- [x] Implement comparison operators: `<`, `<=`, `>`, `>=`, `==`, `!=`
- [x] Export from `temporale/core/__init__.py`

**Tests:**
- [x] Unit test: Duration construction with various units
- [x] Unit test: Normalization (e.g., 90 seconds -> 1 minute 30 seconds)
- [x] Unit test: Arithmetic operations
- [x] Unit test: Comparison operations
- [x] Unit test: Negative durations

**Checkpoint:**
- [x] `python -m pytest tests/test_duration.py -v` passes
- [x] `analyze_files()` on duration.py finds Duration and all operators

**Rollback:** Remove duration.py and test file

**Commit after all checkpoints pass.**

---

#### Step 6: Implement Date Class {#step-6}

**Commit:** `feat(temporale): add Date class with calendar operations`

**References:** [D02] Immutability, [D03] Type annotations, (#date-api), Spec S01

**Artifacts:**
- `temporale/core/date.py` with Date class
- `temporale/_internal/validation.py` with validation decorators
- `tests/test_date.py` with date tests

**Tasks:**
- [x] Implement Date with `_days` slot (MJD)
- [x] Add MJD conversion utilities in `_internal/`
- [x] Implement construction: `__init__`, `today()`, `from_ordinal()`, `from_iso_format()`
- [x] Implement properties: `year`, `month`, `day`, `day_of_week`, `day_of_year`, `era`, `is_leap_year`
- [x] Implement transformations: `replace()`, `add_days()`, `add_months()`, `add_years()`
- [x] Implement operators: `+` (Duration), `-` (Duration or Date), comparisons, hash
- [x] Implement `@validate_range` decorator for construction validation

**Tests:**
- [x] Unit test: Date construction and validation
- [x] Unit test: Property accessors
- [x] Unit test: Leap year detection
- [x] Unit test: BCE dates (negative years)
- [x] Unit test: Arithmetic with Duration
- [x] Unit test: Date subtraction yields Duration
- [x] Unit test: Comparison and ordering

**Checkpoint:**
- [x] `python -m pytest tests/test_date.py -v` passes
- [x] BCE date: `Date(-44, 3, 15)` (Ides of March, 44 BCE) works correctly

**Rollback:** Remove date.py, validation.py, and test file

**Commit after all checkpoints pass.**

---

#### Step 7: Implement Time Class {#step-7}

**Commit:** `feat(temporale): add Time class with nanosecond precision`

**References:** [D02] Immutability, [D07] Subseconds, (#module-core)

**Artifacts:**
- `temporale/core/time.py` with Time class
- `tests/test_time.py` with time tests

**Tasks:**
- [x] Implement Time with `_nanos` slot (nanoseconds since midnight)
- [x] Implement construction: `__init__`, `now()`, `from_iso_format()`
- [x] Implement properties: `hour`, `minute`, `second`, `millisecond`, `microsecond`, `nanosecond`
- [x] Implement transformations: `replace()`, `with_nanosecond()`
- [x] Implement operators: comparisons, hash

**Tests:**
- [x] Unit test: Time construction and validation
- [x] Unit test: Subsecond precision access
- [x] Unit test: Midnight and end-of-day boundaries
- [x] Unit test: ISO format parsing

**Checkpoint:**
- [x] `python -m pytest tests/test_time.py -v` passes

**Rollback:** Remove time.py and test file

**Commit after all checkpoints pass.**

---

#### Step 8: Implement DateTime Class {#step-8}

**Commit:** `feat(temporale): add DateTime class combining Date and Time`

**References:** [D02], [D03], [D04], [D07], Spec S01-S03, (#module-core)

**Artifacts:**
- `temporale/core/datetime.py` with DateTime class
- `temporale/core/instant.py` with Instant base class (optional)
- `tests/test_datetime.py` with datetime tests

**Tasks:**
- [x] Implement DateTime with `_days`, `_nanos`, `_tz` slots
- [x] Implement construction: `__init__`, `now()`, `utc_now()`, `from_timestamp()`, `from_iso_format()`
- [x] Delegate to Date and Time for component access
- [x] Implement timezone handling: `astimezone()`, `to_utc()`, `replace_timezone()`
- [x] Implement arithmetic: `+` (Duration), `-` (Duration or DateTime)
- [x] Handle TYPE_CHECKING import for Duration to avoid circular import

**Tests:**
- [x] Unit test: DateTime construction
- [x] Unit test: Component access (year, month, day, hour, minute, second, nanosecond)
- [x] Unit test: Timezone conversion
- [x] Unit test: Arithmetic with Duration
- [x] Unit test: DateTime subtraction yields Duration

**Checkpoint:**
- [x] `python -m pytest tests/test_datetime.py -v` passes
- [x] Circular import avoided: `from temporale import DateTime, Duration` works

**Rollback:** Remove datetime.py, instant.py, and test file

**Commit after all checkpoints pass.**

---

#### Step 9: Implement Formatting Module {#step-9}

**Commit:** `feat(temporale): add ISO 8601 and RFC 3339 formatting`

**References:** Spec S03, Table T06, (#module-format)

**Artifacts:**
- `temporale/format/iso8601.py` with ISO 8601 parser/formatter
- `temporale/format/rfc3339.py` with RFC 3339 support
- `temporale/format/strftime.py` with strftime-style formatting
- `tests/test_format.py` with format tests
- `tests/test_parse.py` with parse tests

**Tasks:**
- [x] Implement `parse_iso8601()` for date, time, and datetime strings
- [x] Implement `format_iso8601()` with configurable precision
- [x] Implement RFC 3339 as strict subset of ISO 8601
- [x] Implement `strftime()` with common format codes
- [x] Integrate with DateTime/Date/Time `.format()` and `.parse()` methods

**Tests:**
- [x] Unit test: ISO 8601 date parsing
- [x] Unit test: ISO 8601 time parsing with subseconds
- [x] Unit test: ISO 8601 datetime with timezone
- [x] Unit test: Roundtrip guarantee (parse(format(x)) == x)
- [x] Unit test: strftime patterns

**Checkpoint:**
- [x] `python -m pytest tests/test_format.py tests/test_parse.py -v` passes

**Rollback:** Remove format module files and test files

**Commit after all checkpoints pass.**

---

#### Step 10: Implement JSON Serialization {#step-10}

**Commit:** `feat(temporale): add JSON serialization support`

**References:** Spec S03, Table T07, (#module-convert)

**Artifacts:**
- `temporale/convert/json.py` with JSON conversion functions
- `temporale/convert/epoch.py` with epoch conversion utilities
- `tests/test_json.py` with JSON roundtrip tests

**Tasks:**
- [x] Implement `to_json()` returning dict with `_type`, `value`, and component fields
- [x] Implement `from_json()` reconstructing objects from dicts
- [x] Add epoch conversions: Unix seconds, Unix millis, Unix nanos
- [x] Integrate with core classes via methods

**JSON Format:**
```json
{
    "_type": "DateTime",
    "iso": "2024-01-15T14:30:00.123456789Z",
    "unix_seconds": 1705329000.123456789,
    "timezone": "Z"
}
```

**Tests:**
- [x] Unit test: DateTime to JSON and back
- [x] Unit test: Date to JSON and back
- [x] Unit test: Duration to JSON and back
- [x] Unit test: Epoch conversions

**Checkpoint:**
- [x] `python -m pytest tests/test_json.py -v` passes

**Rollback:** Remove json.py, epoch.py, and test file

**Commit after all checkpoints pass.**

---

#### Step 11: Implement Arithmetic Module {#step-11}

**Commit:** `feat(temporale): add arithmetic operations module`

**References:** [D04] Operators, (#module-core)

**Artifacts:**
- `temporale/arithmetic/ops.py` with explicit arithmetic functions
- `temporale/arithmetic/comparisons.py` with comparison helpers
- `tests/test_arithmetic.py` with comprehensive arithmetic tests

**Tasks:**
- [ ] Implement standalone functions: `add()`, `subtract()`, `multiply()`, `divide()`
- [ ] Handle type combinations: DateTime+Duration, Date+Duration, Duration+Duration
- [ ] Implement comparison helpers for mixed-type comparisons
- [ ] Ensure operators delegate to these functions (DRY)

**Tests:**
- [ ] Unit test: All arithmetic operation combinations
- [ ] Unit test: Edge cases (zero duration, negative duration, overflow)
- [ ] Unit test: Mixed type operations

**Checkpoint:**
- [ ] `python -m pytest tests/test_arithmetic.py -v` passes

**Rollback:** Remove arithmetic module files

**Commit after all checkpoints pass.**

---

#### Step 12: Add Custom Decorators and Edge Cases {#step-12}

**Commit:** `feat(temporale): add decorators and edge case handling`

**References:** [D05] Decorators, [D06] Exceptions, Table T01, (#constructs-coverage)

**Artifacts:**
- `temporale/_internal/decorators.py` with custom decorators
- `tests/test_edge_cases.py` with edge case tests

**Tasks:**
- [ ] Implement `@deprecated(message)` parameterized decorator
- [ ] Implement `@validate_range(min, max)` parameterized decorator
- [ ] Add edge case tests for boundary conditions
- [ ] Add tests for error conditions and exceptions

**Decorator implementation:**
```python
def deprecated(message: str):
    """Mark a function as deprecated with a warning message."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            import warnings
            warnings.warn(f"{func.__name__} is deprecated: {message}",
                         DeprecationWarning, stacklevel=2)
            return func(*args, **kwargs)
        return wrapper
    return decorator
```

**Tests:**
- [ ] Unit test: @deprecated emits warning
- [ ] Unit test: @validate_range raises ValidationError
- [ ] Unit test: Year 1 and Year 9999 boundaries
- [ ] Unit test: Month transition edge cases
- [ ] Unit test: Leap second handling (or explicit non-support)

**Checkpoint:**
- [ ] `python -m pytest tests/test_edge_cases.py -v` passes
- [ ] Full test suite: `python -m pytest tests/ -v` passes

**Rollback:** Remove decorators.py and edge case tests

**Commit after all checkpoints pass.**

---

#### Step 13: Public API and Exports {#step-13}

**Commit:** `feat(temporale): finalize public API exports`

**References:** [D01] Module structure, (#module-spec)

**Artifacts:**
- Updated `temporale/__init__.py` with all public exports
- `tests/test_api.py` verifying public API

**Tasks:**
- [ ] Export all public classes from top-level `temporale` package
- [ ] Define `__all__` in all modules
- [ ] Verify import patterns work as expected
- [ ] Add module-level `__version__`

**Public API:**
```python
from temporale import (
    # Core types
    Date, Time, DateTime, Duration,
    # Units
    Era, TimeUnit, Timezone,
    # Exceptions
    TemporaleError, ValidationError, ParseError, OverflowError, TimezoneError,
    # Format functions
    parse_iso8601, format_iso8601,
    # Constants
    __version__,
)
```

**Tests:**
- [ ] Unit test: All expected exports available
- [ ] Unit test: `__all__` lists match actual exports
- [ ] Unit test: No private symbols accidentally exported

**Checkpoint:**
- [ ] `python -c "from temporale import *; print(DateTime.now())"` works

**Rollback:** Revert __init__.py changes

**Commit after all checkpoints pass.**

---

#### Step 14: Tugtool Integration Verification {#step-14}

**Commit:** `test(tugtool): verify temporale analysis and refactoring`

**References:** List L01, Spec S04, (#refactoring-scenarios)

**Artifacts:**
- `crates/tugtool/tests/temporale_integration.rs` with integration tests

**Tasks:**
- [ ] Write Rust test that analyzes all Temporale files
- [ ] Verify symbol count meets success criteria (>100 symbols)
- [ ] Verify cross-module reference count (>50 references)
- [ ] Test at least 3 refactoring scenarios from List L01
- [ ] Verify pytest passes after each refactoring

**Tests:**
- [ ] Integration test: analyze_files() succeeds on all Temporale files
- [ ] Integration test: Rename Date -> CalendarDate, pytest passes
- [ ] Integration test: Rename process_request -> handle_request, pytest passes
- [ ] Integration test: Rename ValidationError -> InvalidInputError, pytest passes

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool temporale` passes
- [ ] All documented refactoring scenarios produce expected results

**Rollback:** Remove integration test file

**Commit after all checkpoints pass.**

---

#### Step 14 Summary {#step-14-summary}

After completing Steps 1-14, you will have:
- A complete Temporale datetime library with 15+ Python modules
- 100+ symbols across the codebase
- 50+ cross-module references
- Comprehensive pytest test suite
- Rust integration tests verifying tugtool analysis
- Documented refactoring scenarios with verification

**Final Phase 5 Checkpoint:**
- [ ] `python -m pytest sample-code/python/temporale/tests/ -v` all tests pass
- [ ] `cargo nextest run -p tugtool temporale` all integration tests pass
- [ ] Symbol count verification: >100 distinct symbols
- [ ] Reference count verification: >50 cross-module references

---

### 5.0.9 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete, well-tested Python datetime library (Temporale) serving as a comprehensive test bed for tugtool's Python refactoring capabilities.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All Python files parse successfully with tugtool-python-cst
- [ ] `analyze_files()` discovers all symbols and references
- [ ] pytest test suite passes (>90% coverage of public API)
- [ ] At least 10 refactoring scenarios documented and tested
- [ ] Integration tests verify refactoring preserves functionality

**Acceptance tests:**
- [ ] Integration test: Full analysis of Temporale completes without errors
- [ ] Integration test: Rename operations produce valid Python
- [ ] Integration test: Refactored code passes pytest

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Core Types Complete** {#m01-core-types}
- [ ] Date, Time, DateTime, Duration all implemented
- [ ] Basic pytest tests pass

**Milestone M02: Full Library Complete** {#m02-full-library}
- [ ] All modules implemented
- [ ] All pytest tests pass
- [ ] Public API finalized

**Milestone M03: Integration Verified** {#m03-integration}
- [ ] Rust integration tests pass
- [ ] Refactoring scenarios verified

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Infer module that adds heuristics to parsing to make it easier to work with Temporale objects in "the real world"
- [ ] IANA timezone database support for Timnezones
- [ ] Temporal arithmetic extensions (periods, intervals)
- [ ] Calendar system support (Julian, Islamic, OS/Gregorian calendar switch, etc.)
- [ ] Leap second support
- [ ] Property-based testing with Hypothesis
- [ ] Additional refactoring scenarios


| Checkpoint | Verification |
|------------|--------------|
| Library parses | `analyze_files()` returns Ok on all files |
| Tests pass | `python -m pytest tests/ -v` exits 0 |
| Integration works | `cargo nextest run temporale` exits 0 |

**Commit after all checkpoints pass.**

---

### Implementation Log {#implementation-log}

<!-- Record implementation progress here -->

| Date | Step | Status | Notes |
|------|------|--------|-------|
| | | | |
