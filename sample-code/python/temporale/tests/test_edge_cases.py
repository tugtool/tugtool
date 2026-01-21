"""Edge case tests for Temporale library.

This module tests boundary conditions, error handling, and edge cases
across the library. It exercises the custom decorators and exception
hierarchy per [D05] Decorators and [D06] Exceptions.
"""

from __future__ import annotations

import warnings

import pytest

from temporale import (
    Date,
    DateTime,
    Duration,
    Interval,
    Period,
    Time,
    Timezone,
)
from temporale.errors import (
    ParseError,
    TemporaleError,
    TimezoneError,
    ValidationError,
)
from temporale._internal.constants import MAX_YEAR, MIN_YEAR
from temporale._internal.decorators import deprecated, memoize
from temporale._internal.validation import (
    validate_day,
    validate_month,
    validate_range,
    validate_year,
)


# ============================================================================
# Test @deprecated Decorator
# ============================================================================


class TestDeprecatedDecorator:
    """Tests for the @deprecated parameterized decorator."""

    def test_deprecated_emits_warning(self) -> None:
        """Test that @deprecated emits a DeprecationWarning."""

        @deprecated("Use new_function() instead")
        def old_function() -> str:
            return "old"

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = old_function()

            assert result == "old"
            assert len(w) == 1
            assert issubclass(w[0].category, DeprecationWarning)
            assert "old_function is deprecated" in str(w[0].message)
            assert "Use new_function() instead" in str(w[0].message)

    def test_deprecated_preserves_function_name(self) -> None:
        """Test that @deprecated preserves the function name."""

        @deprecated("Legacy function")
        def my_function() -> None:
            pass

        assert my_function.__name__ == "my_function"

    def test_deprecated_preserves_docstring(self) -> None:
        """Test that @deprecated preserves the docstring."""

        @deprecated("Old API")
        def documented_function() -> None:
            """This is the docstring."""
            pass

        assert documented_function.__doc__ == "This is the docstring."

    def test_deprecated_with_arguments(self) -> None:
        """Test that @deprecated works with functions that have arguments."""

        @deprecated("Use add_numbers() instead")
        def old_add(a: int, b: int) -> int:
            return a + b

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = old_add(3, 4)

            assert result == 7
            assert len(w) == 1

    def test_deprecated_with_kwargs(self) -> None:
        """Test that @deprecated works with keyword arguments."""

        @deprecated("Prefer new_greet()")
        def old_greet(name: str, greeting: str = "Hello") -> str:
            return f"{greeting}, {name}!"

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = old_greet("World", greeting="Hi")

            assert result == "Hi, World!"
            assert len(w) == 1

    def test_deprecated_marker_attributes(self) -> None:
        """Test that @deprecated adds marker attributes for introspection."""

        @deprecated("Test message")
        def marked_function() -> None:
            pass

        assert hasattr(marked_function, "_deprecated")
        assert marked_function._deprecated is True
        assert hasattr(marked_function, "_deprecation_message")
        assert marked_function._deprecation_message == "Test message"


# ============================================================================
# Test @memoize Decorator
# ============================================================================


class TestMemoizeDecorator:
    """Tests for the @memoize decorator."""

    def test_memoize_caches_results(self) -> None:
        """Test that @memoize caches function results."""
        call_count = 0

        @memoize
        def expensive_function(n: int) -> int:
            nonlocal call_count
            call_count += 1
            return n * 2

        # First call should compute
        assert expensive_function(5) == 10
        assert call_count == 1

        # Second call should use cache
        assert expensive_function(5) == 10
        assert call_count == 1

        # Different argument should compute
        assert expensive_function(10) == 20
        assert call_count == 2

    def test_memoize_with_multiple_arguments(self) -> None:
        """Test that @memoize works with multiple arguments."""
        call_count = 0

        @memoize
        def add(a: int, b: int) -> int:
            nonlocal call_count
            call_count += 1
            return a + b

        assert add(1, 2) == 3
        assert call_count == 1

        assert add(1, 2) == 3
        assert call_count == 1

        assert add(2, 1) == 3  # Different argument order
        assert call_count == 2

    def test_memoize_exposes_cache(self) -> None:
        """Test that @memoize exposes the cache for introspection."""

        @memoize
        def square(n: int) -> int:
            return n * n

        square(3)
        square(4)

        assert hasattr(square, "_cache")
        assert len(square._cache) == 2

    def test_memoize_can_clear_cache(self) -> None:
        """Test that @memoize exposes a clear_cache method."""
        call_count = 0

        @memoize
        def function(n: int) -> int:
            nonlocal call_count
            call_count += 1
            return n

        function(1)
        assert call_count == 1

        function(1)
        assert call_count == 1  # Cached

        function._clear_cache()  # Clear the cache

    def test_memoize_clear_cache_works(self) -> None:
        """Test clearing the memoization cache."""
        call_count = 0

        @memoize
        def func(n: int) -> int:
            nonlocal call_count
            call_count += 1
            return n

        func(1)
        assert call_count == 1
        func(1)
        assert call_count == 1

        func._clear_cache()
        func(1)
        assert call_count == 2  # Recomputed after cache clear


# ============================================================================
# Test @validate_range Decorator
# ============================================================================


class TestValidateRangeDecorator:
    """Tests for the @validate_range parameterized decorator."""

    def test_validate_range_accepts_valid_values(self) -> None:
        """Test that @validate_range accepts values within range."""

        @validate_range(month=(1, 12), day=(1, 31))
        def create_date(year: int, month: int, day: int) -> str:
            return f"{year}-{month:02d}-{day:02d}"

        result = create_date(2024, 6, 15)
        assert result == "2024-06-15"

    def test_validate_range_rejects_low_values(self) -> None:
        """Test that @validate_range rejects values below minimum."""

        @validate_range(month=(1, 12))
        def create_date(year: int, month: int) -> str:
            return f"{year}-{month:02d}"

        with pytest.raises(ValidationError) as exc_info:
            create_date(2024, 0)

        assert "month must be between 1 and 12" in str(exc_info.value)
        assert "got 0" in str(exc_info.value)

    def test_validate_range_rejects_high_values(self) -> None:
        """Test that @validate_range rejects values above maximum."""

        @validate_range(hour=(0, 23))
        def create_time(hour: int) -> str:
            return f"{hour:02d}:00"

        with pytest.raises(ValidationError) as exc_info:
            create_time(24)

        assert "hour must be between 0 and 23" in str(exc_info.value)
        assert "got 24" in str(exc_info.value)

    def test_validate_range_with_kwargs(self) -> None:
        """Test that @validate_range works with keyword arguments."""

        @validate_range(value=(0, 100))
        def process(value: int = 50) -> int:
            return value * 2

        assert process(value=50) == 100

        with pytest.raises(ValidationError):
            process(value=101)

    def test_validate_range_boundary_values(self) -> None:
        """Test that boundary values are accepted (inclusive range)."""

        @validate_range(n=(1, 10))
        def in_range(n: int) -> int:
            return n

        # Boundaries should be valid
        assert in_range(1) == 1
        assert in_range(10) == 10

        # Just outside should fail
        with pytest.raises(ValidationError):
            in_range(0)
        with pytest.raises(ValidationError):
            in_range(11)


# ============================================================================
# Test Year Boundaries (Year 1 and Year 9999)
# ============================================================================


class TestYearBoundaries:
    """Tests for year boundary conditions."""

    def test_min_year_date(self) -> None:
        """Test creating a date at the minimum supported year."""
        d = Date(MIN_YEAR, 1, 1)
        assert d.year == MIN_YEAR
        assert d.month == 1
        assert d.day == 1

    def test_max_year_date(self) -> None:
        """Test creating a date at the maximum supported year."""
        d = Date(MAX_YEAR, 12, 31)
        assert d.year == MAX_YEAR
        assert d.month == 12
        assert d.day == 31

    def test_year_1_date(self) -> None:
        """Test creating a date in year 1 CE."""
        d = Date(1, 1, 1)
        assert d.year == 1
        assert d.month == 1
        assert d.day == 1

    def test_year_9999_date(self) -> None:
        """Test creating a date in year 9999."""
        d = Date(9999, 12, 31)
        assert d.year == 9999
        assert d.month == 12
        assert d.day == 31

    def test_year_0_date(self) -> None:
        """Test creating a date in year 0 (1 BCE in astronomical notation)."""
        d = Date(0, 6, 15)
        assert d.year == 0
        assert d.month == 6
        assert d.day == 15

    def test_negative_year_date(self) -> None:
        """Test creating a date with a negative year (BCE)."""
        d = Date(-100, 3, 15)
        assert d.year == -100
        assert d.month == 3
        assert d.day == 15

    def test_year_beyond_max_raises(self) -> None:
        """Test that years beyond MAX_YEAR raise ValidationError."""
        with pytest.raises(ValidationError):
            Date(MAX_YEAR + 1, 1, 1)

    def test_year_below_min_raises(self) -> None:
        """Test that years below MIN_YEAR raise ValidationError."""
        with pytest.raises(ValidationError):
            Date(MIN_YEAR - 1, 1, 1)

    def test_validate_year_function(self) -> None:
        """Test the validate_year utility function."""
        # Valid years should not raise
        validate_year(1)
        validate_year(9999)
        validate_year(0)
        validate_year(-9999)

        # Invalid years should raise
        with pytest.raises(ValidationError):
            validate_year(10000)
        with pytest.raises(ValidationError):
            validate_year(-10000)


# ============================================================================
# Test Month Transition Edge Cases
# ============================================================================


class TestMonthTransitions:
    """Tests for month transition edge cases."""

    def test_january_to_february(self) -> None:
        """Test adding days across January to February transition."""
        d = Date(2024, 1, 31)
        result = d + Duration(days=1)
        assert result == Date(2024, 2, 1)

    def test_february_to_march_leap_year(self) -> None:
        """Test adding days across Feb to March in a leap year."""
        d = Date(2024, 2, 29)  # 2024 is a leap year
        result = d + Duration(days=1)
        assert result == Date(2024, 3, 1)

    def test_february_to_march_non_leap_year(self) -> None:
        """Test adding days across Feb to March in a non-leap year."""
        d = Date(2023, 2, 28)  # 2023 is not a leap year
        result = d + Duration(days=1)
        assert result == Date(2023, 3, 1)

    def test_december_to_january(self) -> None:
        """Test adding days across December to January (year transition)."""
        d = Date(2023, 12, 31)
        result = d + Duration(days=1)
        assert result == Date(2024, 1, 1)

    def test_march_to_february_backward(self) -> None:
        """Test subtracting days from March to February."""
        d = Date(2024, 3, 1)
        result = d - Duration(days=1)
        assert result == Date(2024, 2, 29)  # Leap year

    def test_month_end_dates(self) -> None:
        """Test the last day of each month."""
        # Non-leap year
        assert Date(2023, 1, 31).day == 31
        assert Date(2023, 2, 28).day == 28
        assert Date(2023, 3, 31).day == 31
        assert Date(2023, 4, 30).day == 30
        assert Date(2023, 5, 31).day == 31
        assert Date(2023, 6, 30).day == 30
        assert Date(2023, 7, 31).day == 31
        assert Date(2023, 8, 31).day == 31
        assert Date(2023, 9, 30).day == 30
        assert Date(2023, 10, 31).day == 31
        assert Date(2023, 11, 30).day == 30
        assert Date(2023, 12, 31).day == 31

    def test_invalid_day_for_month(self) -> None:
        """Test that invalid day-of-month raises ValidationError."""
        with pytest.raises(ValidationError):
            Date(2023, 2, 29)  # Not a leap year

        with pytest.raises(ValidationError):
            Date(2023, 4, 31)  # April has 30 days

        with pytest.raises(ValidationError):
            Date(2023, 6, 31)  # June has 30 days

    def test_add_one_month_end_of_month(self) -> None:
        """Test adding one month from end of month (clamping behavior)."""
        # Jan 31 + 1 month should clamp to Feb 28/29
        d = Date(2023, 1, 31)
        result = d + Period(months=1)
        assert result == Date(2023, 2, 28)  # Clamped to last day of Feb

        # In a leap year
        d_leap = Date(2024, 1, 31)
        result_leap = d_leap + Period(months=1)
        assert result_leap == Date(2024, 2, 29)

    def test_subtract_one_month_end_of_month(self) -> None:
        """Test subtracting one month from end of month."""
        # March 31 - 1 month should clamp to Feb 28/29
        d = Date(2023, 3, 31)
        result = d - Period(months=1)
        assert result == Date(2023, 2, 28)


# ============================================================================
# Test Leap Year Edge Cases
# ============================================================================


class TestLeapYearEdgeCases:
    """Tests for leap year boundary conditions."""

    def test_feb_29_leap_year(self) -> None:
        """Test February 29 is valid in a leap year."""
        d = Date(2024, 2, 29)
        assert d.day == 29
        assert d.is_leap_year

    def test_feb_29_non_leap_year_raises(self) -> None:
        """Test February 29 raises in a non-leap year."""
        with pytest.raises(ValidationError):
            Date(2023, 2, 29)

    def test_century_not_leap_year(self) -> None:
        """Test that century years not divisible by 400 are not leap years."""
        # 1900 is not a leap year (divisible by 100 but not 400)
        d = Date(1900, 1, 1)
        assert not d.is_leap_year

        with pytest.raises(ValidationError):
            Date(1900, 2, 29)

    def test_quad_century_is_leap_year(self) -> None:
        """Test that years divisible by 400 are leap years."""
        # 2000 is a leap year (divisible by 400)
        d = Date(2000, 2, 29)
        assert d.day == 29
        assert d.is_leap_year

    def test_leap_year_day_count(self) -> None:
        """Test that leap years have 366 days."""
        start = Date(2024, 1, 1)
        end = Date(2024, 12, 31)
        duration = end - start
        assert duration.days == 365  # 365 days between (not including start)

    def test_year_0_is_leap_year(self) -> None:
        """Test that year 0 (1 BCE) is a leap year."""
        d = Date(0, 2, 29)
        assert d.day == 29
        assert d.is_leap_year


# ============================================================================
# Test Time Boundary Conditions
# ============================================================================


class TestTimeBoundaries:
    """Tests for time boundary conditions."""

    def test_midnight(self) -> None:
        """Test midnight (00:00:00)."""
        t = Time(0, 0, 0)
        assert t.hour == 0
        assert t.minute == 0
        assert t.second == 0

    def test_end_of_day(self) -> None:
        """Test 23:59:59.999999999."""
        t = Time(23, 59, 59, nanosecond=999_999_999)
        assert t.hour == 23
        assert t.minute == 59
        assert t.second == 59
        assert t.nanosecond == 999_999_999

    def test_invalid_hour_24(self) -> None:
        """Test that hour 24 is invalid."""
        with pytest.raises(ValidationError):
            Time(24, 0, 0)

    def test_invalid_minute_60(self) -> None:
        """Test that minute 60 is invalid."""
        with pytest.raises(ValidationError):
            Time(0, 60, 0)

    def test_invalid_second_60(self) -> None:
        """Test that second 60 is invalid (no leap second support)."""
        with pytest.raises(ValidationError):
            Time(0, 0, 60)

    def test_nanosecond_boundaries(self) -> None:
        """Test nanosecond boundary values."""
        # Maximum valid nanosecond
        t = Time(0, 0, 0, nanosecond=999_999_999)
        assert t.nanosecond == 999_999_999

        # Invalid: too many nanoseconds
        with pytest.raises(ValidationError):
            Time(0, 0, 0, nanosecond=1_000_000_000)


# ============================================================================
# Test Leap Second Non-Support
# ============================================================================


class TestLeapSecondHandling:
    """Tests documenting that leap seconds are not supported.

    Per [Q05] in the plan, Temporale explicitly ignores leap seconds.
    This test documents that behavior.
    """

    def test_second_60_rejected(self) -> None:
        """Test that second=60 (leap second) is rejected."""
        with pytest.raises(ValidationError):
            Time(23, 59, 60)

    def test_leap_second_datetime_rejected(self) -> None:
        """Test that DateTime with second=60 is rejected."""
        with pytest.raises(ValidationError):
            DateTime(2016, 12, 31, 23, 59, 60)

    def test_duration_ignores_leap_seconds(self) -> None:
        """Test that duration calculations don't account for leap seconds."""
        # A day is always exactly 86400 seconds in Temporale
        d = Duration(days=1)
        assert d.total_seconds == 86400.0  # total_seconds is a property


# ============================================================================
# Test Timezone Edge Cases
# ============================================================================


class TestTimezoneEdgeCases:
    """Tests for timezone edge cases."""

    def test_max_positive_offset(self) -> None:
        """Test maximum positive UTC offset (+14:00)."""
        tz = Timezone.from_hours(14)
        assert tz.offset_hours == 14.0

    def test_max_negative_offset(self) -> None:
        """Test maximum negative UTC offset (-12:00)."""
        tz = Timezone.from_hours(-12)
        assert tz.offset_hours == -12.0

    def test_fractional_hour_offset(self) -> None:
        """Test fractional hour offsets (e.g., India +5:30)."""
        tz = Timezone.from_hours(5, 30)
        assert tz.offset_hours == 5.5

    def test_utc_timezone(self) -> None:
        """Test UTC timezone properties."""
        utc = Timezone.utc()
        assert utc.is_utc
        assert utc.offset_seconds == 0

    def test_invalid_offset_raises(self) -> None:
        """Test that invalid offsets raise TimezoneError."""
        with pytest.raises(TimezoneError):
            Timezone.from_hours(25)  # Beyond +24

        with pytest.raises(TimezoneError):
            Timezone.from_hours(-25)  # Beyond -24


# ============================================================================
# Test Exception Hierarchy
# ============================================================================


class TestExceptionHierarchy:
    """Tests for the exception class hierarchy per [D06]."""

    def test_all_exceptions_inherit_from_temporale_error(self) -> None:
        """Test that all custom exceptions inherit from TemporaleError."""
        assert issubclass(ValidationError, TemporaleError)
        assert issubclass(ParseError, TemporaleError)
        # OverflowError is imported but shadows builtin, check it exists
        from temporale.errors import OverflowError as TOverflowError

        assert issubclass(TOverflowError, TemporaleError)
        assert issubclass(TimezoneError, TemporaleError)

    def test_temporale_error_inherits_from_exception(self) -> None:
        """Test that TemporaleError inherits from Exception."""
        assert issubclass(TemporaleError, Exception)

    def test_validation_error_is_catchable(self) -> None:
        """Test that ValidationError can be caught as TemporaleError."""
        with pytest.raises(TemporaleError):
            raise ValidationError("test")

    def test_parse_error_is_catchable(self) -> None:
        """Test that ParseError can be caught as TemporaleError."""
        with pytest.raises(TemporaleError):
            raise ParseError("test")


# ============================================================================
# Test Interval Edge Cases
# ============================================================================


class TestIntervalEdgeCases:
    """Tests for Interval edge cases."""

    def test_zero_duration_interval_raises(self) -> None:
        """Test that an interval with zero duration (start == end) raises ValueError.

        Per the Interval implementation, start must be strictly less than end.
        """
        d = Date(2024, 1, 15)
        with pytest.raises(ValueError) as exc_info:
            Interval(d, d)
        assert "end must be greater than start" in str(exc_info.value)

    def test_single_day_interval(self) -> None:
        """Test an interval spanning exactly one day."""
        start = Date(2024, 1, 15)
        end = Date(2024, 1, 16)
        interval = Interval(start, end)
        assert interval.duration() == Duration(days=1)

    def test_year_spanning_interval(self) -> None:
        """Test an interval spanning multiple years."""
        start = Date(2020, 1, 1)
        end = Date(2024, 1, 1)
        interval = Interval(start, end)
        # 4 years including one extra leap day (2020, 2024 not counted since end is exclusive)
        # 2020: leap year (366 days)
        # 2021: 365 days
        # 2022: 365 days
        # 2023: 365 days
        # Total: 366 + 365 + 365 + 365 = 1461 days
        assert interval.duration() == Duration(days=1461)


# ============================================================================
# Test Duration Edge Cases
# ============================================================================


class TestDurationEdgeCases:
    """Tests for Duration edge cases."""

    def test_zero_duration(self) -> None:
        """Test zero duration."""
        d = Duration.zero()
        assert d.days == 0
        assert d.seconds == 0
        assert d.nanoseconds == 0
        assert d.total_seconds == 0.0  # total_seconds is a property

    def test_negative_duration(self) -> None:
        """Test negative duration."""
        d = Duration(days=-1)
        assert d.is_negative

    def test_large_duration(self) -> None:
        """Test a large duration (many days)."""
        d = Duration(days=10000)
        assert d.days == 10000

    def test_nanosecond_precision_preserved(self) -> None:
        """Test that nanosecond precision is preserved."""
        d = Duration(nanoseconds=123456789)
        assert d.nanoseconds == 123456789

    def test_duration_normalization(self) -> None:
        """Test that duration components are normalized."""
        # 90000 seconds = 1 day + 3600 seconds
        d = Duration(seconds=90000)
        assert d.days == 1
        assert d.seconds == 3600


# ============================================================================
# Test Period Edge Cases
# ============================================================================


class TestPeriodEdgeCases:
    """Tests for Period edge cases."""

    def test_zero_period(self) -> None:
        """Test zero period."""
        p = Period()
        assert p.years == 0
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 0

    def test_month_normalization_is_manual(self) -> None:
        """Test that months > 12 are NOT auto-normalized; use normalized() method."""
        # Values are stored as-is
        p = Period(months=25)
        assert p.years == 0
        assert p.months == 25

        # normalized() provides the canonical form
        normalized = p.normalized()
        assert normalized.years == 2
        assert normalized.months == 1

    def test_negative_period(self) -> None:
        """Test negative period values are stored as-is (no auto-normalization)."""
        p = Period(months=-1)
        # Values stored directly without normalization
        assert p.years == 0
        assert p.months == -1
        assert p.total_months == -1

    def test_add_period_feb_29_to_non_leap_year(self) -> None:
        """Test adding a year from Feb 29 to a non-leap year."""
        d = Date(2024, 2, 29)  # Leap year
        result = d + Period(years=1)
        # Should clamp to Feb 28 in 2025
        assert result == Date(2025, 2, 28)


# ============================================================================
# Test Validation Functions
# ============================================================================


class TestValidationFunctions:
    """Tests for validation utility functions."""

    def test_validate_month_valid(self) -> None:
        """Test validate_month accepts valid months."""
        for month in range(1, 13):
            validate_month(month)  # Should not raise

    def test_validate_month_invalid(self) -> None:
        """Test validate_month rejects invalid months."""
        with pytest.raises(ValidationError):
            validate_month(0)
        with pytest.raises(ValidationError):
            validate_month(13)

    def test_validate_day_valid(self) -> None:
        """Test validate_day accepts valid days."""
        validate_day(2024, 1, 31)
        validate_day(2024, 2, 29)  # Leap year
        validate_day(2023, 2, 28)  # Non-leap year

    def test_validate_day_invalid(self) -> None:
        """Test validate_day rejects invalid days."""
        with pytest.raises(ValidationError):
            validate_day(2024, 1, 32)
        with pytest.raises(ValidationError):
            validate_day(2023, 2, 29)  # Not a leap year
        with pytest.raises(ValidationError):
            validate_day(2024, 4, 31)  # April has 30 days
