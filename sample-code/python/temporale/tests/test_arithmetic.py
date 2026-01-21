"""Tests for the temporale.arithmetic module.

This test module verifies:
    - All arithmetic operation combinations (add, subtract, multiply, divide)
    - Edge cases (zero duration, negative duration, overflow handling)
    - Mixed type operations
    - Comparison helpers
"""

from __future__ import annotations

import pytest

from temporale.core.date import Date
from temporale.core.datetime import DateTime
from temporale.core.duration import Duration
from temporale.core.time import Time
from temporale.units.timezone import Timezone
from temporale.arithmetic import (
    add,
    subtract,
    multiply,
    divide,
    floor_divide,
    negate,
    absolute,
    equal,
    not_equal,
    less_than,
    less_equal,
    greater_than,
    greater_equal,
    compare,
    min_value,
    max_value,
    clamp,
)
from temporale.errors import TimezoneError


# =============================================================================
# Addition Tests
# =============================================================================


class TestAdd:
    """Tests for the add() function."""

    def test_add_duration_to_date(self) -> None:
        """Test adding Duration to Date."""
        date = Date(2024, 1, 15)
        duration = Duration(days=10)
        result = add(date, duration)

        assert isinstance(result, Date)
        assert result == Date(2024, 1, 25)

    def test_add_duration_to_date_month_boundary(self) -> None:
        """Test adding Duration to Date across month boundary."""
        date = Date(2024, 1, 25)
        duration = Duration(days=10)
        result = add(date, duration)

        assert result == Date(2024, 2, 4)

    def test_add_duration_to_date_year_boundary(self) -> None:
        """Test adding Duration to Date across year boundary."""
        date = Date(2023, 12, 25)
        duration = Duration(days=10)
        result = add(date, duration)

        assert result == Date(2024, 1, 4)

    def test_add_duration_to_datetime(self) -> None:
        """Test adding Duration to DateTime."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        duration = Duration(days=1, seconds=3600)  # 1 day, 1 hour
        result = add(dt, duration)

        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 16, 13, 0, 0)

    def test_add_duration_to_datetime_with_nanoseconds(self) -> None:
        """Test adding Duration with nanoseconds to DateTime."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, nanosecond=500_000_000)
        duration = Duration(nanoseconds=600_000_000)  # 0.6 seconds
        result = add(dt, duration)

        # 0.5s + 0.6s = 1.1s -> 1s + 100_000_000ns
        assert result.second == 1
        assert result.nanosecond == 100_000_000

    def test_add_duration_to_datetime_preserves_timezone(self) -> None:
        """Test that adding Duration preserves timezone."""
        tz = Timezone.from_hours(5, 30)
        dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz)
        duration = Duration.from_hours(2)  # 2 hours
        result = add(dt, duration)

        assert result.timezone == tz
        assert result.hour == 14

    def test_add_durations(self) -> None:
        """Test adding two Durations."""
        d1 = Duration(days=1, seconds=3600)
        d2 = Duration(days=2, seconds=7200)
        result = add(d1, d2)

        assert isinstance(result, Duration)
        assert result.days == 3
        assert result.seconds == 10800  # 3 hours

    def test_add_negative_duration(self) -> None:
        """Test adding negative Duration (equivalent to subtraction)."""
        date = Date(2024, 1, 25)
        duration = Duration(days=-10)
        result = add(date, duration)

        assert result == Date(2024, 1, 15)

    def test_add_zero_duration(self) -> None:
        """Test adding zero Duration."""
        date = Date(2024, 1, 15)
        duration = Duration.zero()
        result = add(date, duration)

        assert result == date

    def test_add_type_error_wrong_right_type(self) -> None:
        """Test that add raises TypeError for non-Duration right operand."""
        date = Date(2024, 1, 15)

        with pytest.raises(TypeError):
            add(date, "not a duration")  # type: ignore

    def test_add_type_error_wrong_left_type(self) -> None:
        """Test that add raises TypeError for invalid left operand."""
        duration = Duration(days=1)

        with pytest.raises(TypeError):
            add("not a temporal", duration)  # type: ignore


# =============================================================================
# Subtraction Tests
# =============================================================================


class TestSubtract:
    """Tests for the subtract() function."""

    def test_subtract_duration_from_date(self) -> None:
        """Test subtracting Duration from Date."""
        date = Date(2024, 1, 25)
        duration = Duration(days=10)
        result = subtract(date, duration)

        assert isinstance(result, Date)
        assert result == Date(2024, 1, 15)

    def test_subtract_dates(self) -> None:
        """Test subtracting two Dates to get Duration."""
        d1 = Date(2024, 1, 25)
        d2 = Date(2024, 1, 15)
        result = subtract(d1, d2)

        assert isinstance(result, Duration)
        assert result.days == 10
        assert result.seconds == 0
        assert result.nanoseconds == 0

    def test_subtract_dates_negative_result(self) -> None:
        """Test subtracting dates with earlier date first."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 25)
        result = subtract(d1, d2)

        assert result.is_negative
        assert result.days == -10

    def test_subtract_duration_from_datetime(self) -> None:
        """Test subtracting Duration from DateTime."""
        dt = DateTime(2024, 1, 15, 14, 0, 0)
        duration = Duration.from_hours(2)
        result = subtract(dt, duration)

        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 12, 0, 0)

    def test_subtract_datetimes_naive(self) -> None:
        """Test subtracting two naive DateTimes."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        result = subtract(dt1, dt2)

        assert isinstance(result, Duration)
        assert result.total_seconds == 7200  # 2 hours

    def test_subtract_datetimes_aware(self) -> None:
        """Test subtracting two aware DateTimes."""
        tz1 = Timezone.utc()
        tz2 = Timezone.from_hours(5, 30)
        dt1 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz1)
        dt2 = DateTime(2024, 1, 15, 17, 30, 0, timezone=tz2)  # Same instant
        result = subtract(dt1, dt2)

        # Should be zero or near-zero since same instant
        assert result.total_nanoseconds == 0

    def test_subtract_datetimes_naive_aware_raises(self) -> None:
        """Test that subtracting naive and aware DateTimes raises error."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)  # naive
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())  # aware

        with pytest.raises(TimezoneError):
            subtract(dt1, dt2)

    def test_subtract_durations(self) -> None:
        """Test subtracting two Durations."""
        d1 = Duration(days=3, seconds=7200)
        d2 = Duration(days=1, seconds=3600)
        result = subtract(d1, d2)

        assert isinstance(result, Duration)
        assert result.days == 2
        assert result.seconds == 3600

    def test_subtract_type_error(self) -> None:
        """Test that subtract raises TypeError for incompatible types."""
        date = Date(2024, 1, 15)
        time = Time(12, 0, 0)

        with pytest.raises(TypeError):
            subtract(date, time)  # type: ignore


# =============================================================================
# Multiplication Tests
# =============================================================================


class TestMultiply:
    """Tests for the multiply() function."""

    def test_multiply_duration_by_positive_int(self) -> None:
        """Test multiplying Duration by positive integer."""
        duration = Duration(seconds=30)
        result = multiply(duration, 3)

        assert result.seconds == 90

    def test_multiply_duration_by_negative_int(self) -> None:
        """Test multiplying Duration by negative integer."""
        duration = Duration(days=1)
        result = multiply(duration, -2)

        assert result.is_negative
        assert result.days == -2

    def test_multiply_duration_by_zero(self) -> None:
        """Test multiplying Duration by zero."""
        duration = Duration(days=10)
        result = multiply(duration, 0)

        assert result.is_zero

    def test_multiply_negative_duration(self) -> None:
        """Test multiplying negative Duration."""
        duration = Duration(days=-1)
        result = multiply(duration, 2)

        assert result.days == -2

    def test_multiply_type_error_non_duration(self) -> None:
        """Test that multiply raises TypeError for non-Duration."""
        with pytest.raises(TypeError):
            multiply("not a duration", 2)  # type: ignore

    def test_multiply_type_error_non_int(self) -> None:
        """Test that multiply raises TypeError for non-int scalar."""
        duration = Duration(seconds=30)

        with pytest.raises(TypeError):
            multiply(duration, 2.5)  # type: ignore


# =============================================================================
# Division Tests
# =============================================================================


class TestDivide:
    """Tests for the divide() function."""

    def test_divide_duration_by_int(self) -> None:
        """Test dividing Duration by integer."""
        duration = Duration(seconds=90)
        result = divide(duration, 3)

        assert result.seconds == 30

    def test_divide_duration_by_float(self) -> None:
        """Test dividing Duration by float."""
        duration = Duration(seconds=100)
        result = divide(duration, 2.5)

        assert result.seconds == 40

    def test_divide_by_zero_raises(self) -> None:
        """Test that dividing by zero raises ZeroDivisionError."""
        duration = Duration(seconds=100)

        with pytest.raises(ZeroDivisionError):
            divide(duration, 0)

    def test_divide_type_error(self) -> None:
        """Test that divide raises TypeError for invalid types."""
        duration = Duration(seconds=100)

        with pytest.raises(TypeError):
            divide(duration, "not a number")  # type: ignore


class TestFloorDivide:
    """Tests for the floor_divide() function."""

    def test_floor_divide_even(self) -> None:
        """Test floor division with even division."""
        duration = Duration(seconds=90)
        result = floor_divide(duration, 3)

        assert result.seconds == 30

    def test_floor_divide_uneven(self) -> None:
        """Test floor division with remainder."""
        duration = Duration(seconds=100)
        result = floor_divide(duration, 3)

        # 100 seconds = 100_000_000_000 nanoseconds
        # 100_000_000_000 // 3 = 33_333_333_333 nanoseconds
        # = 33 seconds + 333_333_333 nanoseconds
        assert result.seconds == 33
        assert result.nanoseconds == 333_333_333

    def test_floor_divide_by_zero_raises(self) -> None:
        """Test that floor dividing by zero raises ZeroDivisionError."""
        duration = Duration(seconds=100)

        with pytest.raises(ZeroDivisionError):
            floor_divide(duration, 0)

    def test_floor_divide_type_error_non_int(self) -> None:
        """Test that floor_divide raises TypeError for non-int divisor."""
        duration = Duration(seconds=100)

        with pytest.raises(TypeError):
            floor_divide(duration, 2.5)  # type: ignore


# =============================================================================
# Negation and Absolute Value Tests
# =============================================================================


class TestNegate:
    """Tests for the negate() function."""

    def test_negate_positive_duration(self) -> None:
        """Test negating a positive duration."""
        duration = Duration(seconds=30)
        result = negate(duration)

        assert result.is_negative
        assert abs(result.total_nanoseconds) == duration.total_nanoseconds

    def test_negate_negative_duration(self) -> None:
        """Test negating a negative duration."""
        duration = Duration(days=-1)
        result = negate(duration)

        assert not result.is_negative
        assert result.days == 1

    def test_negate_zero_duration(self) -> None:
        """Test negating zero duration."""
        duration = Duration.zero()
        result = negate(duration)

        assert result.is_zero

    def test_negate_type_error(self) -> None:
        """Test that negate raises TypeError for non-Duration."""
        with pytest.raises(TypeError):
            negate("not a duration")  # type: ignore


class TestAbsolute:
    """Tests for the absolute() function."""

    def test_absolute_positive_duration(self) -> None:
        """Test absolute value of positive duration."""
        duration = Duration(seconds=30)
        result = absolute(duration)

        assert result == duration

    def test_absolute_negative_duration(self) -> None:
        """Test absolute value of negative duration."""
        duration = Duration(days=-1)
        result = absolute(duration)

        assert not result.is_negative
        assert result.days == 1

    def test_absolute_zero_duration(self) -> None:
        """Test absolute value of zero duration."""
        duration = Duration.zero()
        result = absolute(duration)

        assert result.is_zero

    def test_absolute_type_error(self) -> None:
        """Test that absolute raises TypeError for non-Duration."""
        with pytest.raises(TypeError):
            absolute("not a duration")  # type: ignore


# =============================================================================
# Comparison Tests
# =============================================================================


class TestEqual:
    """Tests for the equal() function."""

    def test_equal_dates(self) -> None:
        """Test equality of Dates."""
        assert equal(Date(2024, 1, 15), Date(2024, 1, 15))
        assert not equal(Date(2024, 1, 15), Date(2024, 1, 16))

    def test_equal_times(self) -> None:
        """Test equality of Times."""
        assert equal(Time(12, 0, 0), Time(12, 0, 0))
        assert not equal(Time(12, 0, 0), Time(12, 0, 1))

    def test_equal_datetimes_naive(self) -> None:
        """Test equality of naive DateTimes."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        assert equal(dt1, dt2)

    def test_equal_datetimes_aware(self) -> None:
        """Test equality of aware DateTimes."""
        tz = Timezone.utc()
        dt1 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz)
        assert equal(dt1, dt2)

    def test_equal_datetimes_naive_aware(self) -> None:
        """Test that naive and aware DateTimes are not equal."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        assert not equal(dt1, dt2)

    def test_equal_durations(self) -> None:
        """Test equality of Durations."""
        d1 = Duration(seconds=60)
        d2 = Duration(seconds=60)
        d3 = Duration(seconds=61)
        assert equal(d1, d2)
        assert not equal(d1, d3)

    def test_equal_different_types(self) -> None:
        """Test that different types are never equal."""
        assert not equal(Date(2024, 1, 15), Time(12, 0, 0))  # type: ignore


class TestNotEqual:
    """Tests for the not_equal() function."""

    def test_not_equal_basic(self) -> None:
        """Test basic inequality."""
        assert not_equal(Date(2024, 1, 15), Date(2024, 1, 16))
        assert not not_equal(Date(2024, 1, 15), Date(2024, 1, 15))


class TestLessThan:
    """Tests for the less_than() function."""

    def test_less_than_dates(self) -> None:
        """Test less-than for Dates."""
        assert less_than(Date(2024, 1, 15), Date(2024, 1, 16))
        assert not less_than(Date(2024, 1, 16), Date(2024, 1, 15))
        assert not less_than(Date(2024, 1, 15), Date(2024, 1, 15))

    def test_less_than_times(self) -> None:
        """Test less-than for Times."""
        assert less_than(Time(10, 0, 0), Time(12, 0, 0))
        assert not less_than(Time(12, 0, 0), Time(10, 0, 0))

    def test_less_than_datetimes_naive(self) -> None:
        """Test less-than for naive DateTimes."""
        dt1 = DateTime(2024, 1, 15, 10, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        assert less_than(dt1, dt2)

    def test_less_than_datetimes_aware(self) -> None:
        """Test less-than for aware DateTimes."""
        tz = Timezone.utc()
        dt1 = DateTime(2024, 1, 15, 10, 0, 0, timezone=tz)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz)
        assert less_than(dt1, dt2)

    def test_less_than_datetimes_naive_aware_raises(self) -> None:
        """Test that comparing naive and aware DateTimes raises TypeError."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())

        with pytest.raises(TypeError):
            less_than(dt1, dt2)

    def test_less_than_durations(self) -> None:
        """Test less-than for Durations."""
        assert less_than(Duration(seconds=30), Duration(seconds=60))
        assert not less_than(Duration(seconds=60), Duration(seconds=30))

    def test_less_than_different_types_raises(self) -> None:
        """Test that comparing different types raises TypeError."""
        with pytest.raises(TypeError):
            less_than(Date(2024, 1, 15), Time(12, 0, 0))  # type: ignore


class TestLessEqual:
    """Tests for the less_equal() function."""

    def test_less_equal_less(self) -> None:
        """Test less-equal when less."""
        assert less_equal(Date(2024, 1, 15), Date(2024, 1, 16))

    def test_less_equal_equal(self) -> None:
        """Test less-equal when equal."""
        assert less_equal(Date(2024, 1, 15), Date(2024, 1, 15))

    def test_less_equal_greater(self) -> None:
        """Test less-equal when greater."""
        assert not less_equal(Date(2024, 1, 16), Date(2024, 1, 15))


class TestGreaterThan:
    """Tests for the greater_than() function."""

    def test_greater_than_dates(self) -> None:
        """Test greater-than for Dates."""
        assert greater_than(Date(2024, 1, 16), Date(2024, 1, 15))
        assert not greater_than(Date(2024, 1, 15), Date(2024, 1, 16))

    def test_greater_than_durations(self) -> None:
        """Test greater-than for Durations."""
        assert greater_than(Duration(seconds=60), Duration(seconds=30))


class TestGreaterEqual:
    """Tests for the greater_equal() function."""

    def test_greater_equal_greater(self) -> None:
        """Test greater-equal when greater."""
        assert greater_equal(Date(2024, 1, 16), Date(2024, 1, 15))

    def test_greater_equal_equal(self) -> None:
        """Test greater-equal when equal."""
        assert greater_equal(Date(2024, 1, 15), Date(2024, 1, 15))

    def test_greater_equal_less(self) -> None:
        """Test greater-equal when less."""
        assert not greater_equal(Date(2024, 1, 15), Date(2024, 1, 16))


class TestCompare:
    """Tests for the compare() function."""

    def test_compare_less(self) -> None:
        """Test compare returns -1 when less."""
        assert compare(Date(2024, 1, 15), Date(2024, 1, 16)) == -1

    def test_compare_equal(self) -> None:
        """Test compare returns 0 when equal."""
        assert compare(Date(2024, 1, 15), Date(2024, 1, 15)) == 0

    def test_compare_greater(self) -> None:
        """Test compare returns 1 when greater."""
        assert compare(Date(2024, 1, 16), Date(2024, 1, 15)) == 1


class TestMinMaxValue:
    """Tests for min_value() and max_value() functions."""

    def test_min_value_dates(self) -> None:
        """Test min_value for Dates."""
        dates = [Date(2024, 1, 20), Date(2024, 1, 15), Date(2024, 1, 18)]
        result = min_value(*dates)
        assert result == Date(2024, 1, 15)

    def test_max_value_dates(self) -> None:
        """Test max_value for Dates."""
        dates = [Date(2024, 1, 20), Date(2024, 1, 15), Date(2024, 1, 18)]
        result = max_value(*dates)
        assert result == Date(2024, 1, 20)

    def test_min_value_single(self) -> None:
        """Test min_value with single value."""
        result = min_value(Date(2024, 1, 15))
        assert result == Date(2024, 1, 15)

    def test_max_value_single(self) -> None:
        """Test max_value with single value."""
        result = max_value(Date(2024, 1, 15))
        assert result == Date(2024, 1, 15)

    def test_min_value_empty_raises(self) -> None:
        """Test min_value with no arguments raises ValueError."""
        with pytest.raises(ValueError):
            min_value()

    def test_max_value_empty_raises(self) -> None:
        """Test max_value with no arguments raises ValueError."""
        with pytest.raises(ValueError):
            max_value()

    def test_min_value_durations(self) -> None:
        """Test min_value for Durations."""
        durations = [Duration(seconds=60), Duration(seconds=30), Duration(seconds=45)]
        result = min_value(*durations)
        assert result == Duration(seconds=30)

    def test_max_value_durations(self) -> None:
        """Test max_value for Durations."""
        durations = [Duration(seconds=60), Duration(seconds=30), Duration(seconds=45)]
        result = max_value(*durations)
        assert result == Duration(seconds=60)


class TestClamp:
    """Tests for the clamp() function."""

    def test_clamp_within_range(self) -> None:
        """Test clamp when value is within range."""
        low = Date(2024, 1, 10)
        high = Date(2024, 1, 20)
        value = Date(2024, 1, 15)
        result = clamp(value, low, high)
        assert result == value

    def test_clamp_below_range(self) -> None:
        """Test clamp when value is below range."""
        low = Date(2024, 1, 10)
        high = Date(2024, 1, 20)
        value = Date(2024, 1, 5)
        result = clamp(value, low, high)
        assert result == low

    def test_clamp_above_range(self) -> None:
        """Test clamp when value is above range."""
        low = Date(2024, 1, 10)
        high = Date(2024, 1, 20)
        value = Date(2024, 1, 25)
        result = clamp(value, low, high)
        assert result == high

    def test_clamp_at_boundaries(self) -> None:
        """Test clamp when value is at boundaries."""
        low = Date(2024, 1, 10)
        high = Date(2024, 1, 20)

        assert clamp(low, low, high) == low
        assert clamp(high, low, high) == high

    def test_clamp_invalid_range_raises(self) -> None:
        """Test clamp raises ValueError when min > max."""
        low = Date(2024, 1, 20)
        high = Date(2024, 1, 10)
        value = Date(2024, 1, 15)

        with pytest.raises(ValueError):
            clamp(value, low, high)

    def test_clamp_durations(self) -> None:
        """Test clamp for Durations."""
        low = Duration(seconds=10)
        high = Duration(seconds=60)
        value = Duration(seconds=30)
        result = clamp(value, low, high)
        assert result == value


# =============================================================================
# Edge Cases and Integration Tests
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases in arithmetic operations."""

    def test_add_very_large_duration(self) -> None:
        """Test adding very large duration."""
        date = Date(2024, 1, 15)
        duration = Duration(days=365 * 100)  # 100 years
        result = add(date, duration)

        # Should be approximately 2124
        assert result.year > 2100

    def test_subtract_to_bce(self) -> None:
        """Test subtraction resulting in BCE date."""
        date = Date(100, 1, 1)
        duration = Duration(days=365 * 150)  # ~150 years
        result = subtract(date, duration)

        assert result.year < 0  # BCE

    def test_duration_precision_preservation(self) -> None:
        """Test that nanosecond precision is preserved."""
        d1 = Duration(nanoseconds=1)
        d2 = Duration(nanoseconds=1)
        result = add(d1, d2)

        assert result.nanoseconds == 2

    def test_datetime_nanosecond_overflow(self) -> None:
        """Test DateTime arithmetic with nanosecond overflow."""
        dt = DateTime(2024, 1, 15, 23, 59, 59, nanosecond=999_999_999)
        duration = Duration(nanoseconds=1)
        result = add(dt, duration)

        # Should roll over to next day
        assert result.day == 16
        assert result.hour == 0
        assert result.minute == 0
        assert result.second == 0
        assert result.nanosecond == 0

    def test_negative_duration_arithmetic(self) -> None:
        """Test arithmetic with negative durations."""
        duration = Duration(days=-1, seconds=-3600)  # -1 day, -1 hour
        result = multiply(duration, 2)

        # Should be -2 days, -2 hours
        assert result.is_negative

    def test_compare_same_instant_different_timezones(self) -> None:
        """Test comparing same instant in different timezones."""
        tz1 = Timezone.utc()
        tz2 = Timezone.from_hours(5, 30)

        # 12:00 UTC == 17:30 +05:30
        dt1 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz1)
        dt2 = DateTime(2024, 1, 15, 17, 30, 0, timezone=tz2)

        assert equal(dt1, dt2)
        assert not less_than(dt1, dt2)
        assert not greater_than(dt1, dt2)


class TestIntegrationWithOperators:
    """Test that functional API produces same results as operators."""

    def test_add_matches_operator(self) -> None:
        """Test add() produces same result as + operator."""
        date = Date(2024, 1, 15)
        duration = Duration(days=10)

        func_result = add(date, duration)
        op_result = date + duration

        assert func_result == op_result

    def test_subtract_matches_operator(self) -> None:
        """Test subtract() produces same result as - operator."""
        d1 = Date(2024, 1, 25)
        d2 = Date(2024, 1, 15)

        func_result = subtract(d1, d2)
        op_result = d1 - d2

        assert func_result == op_result

    def test_multiply_matches_operator(self) -> None:
        """Test multiply() produces same result as * operator."""
        duration = Duration(seconds=30)

        func_result = multiply(duration, 3)
        op_result = duration * 3

        assert func_result == op_result

    def test_divide_matches_operator(self) -> None:
        """Test divide() produces same result as / operator."""
        duration = Duration(seconds=90)

        func_result = divide(duration, 3)
        op_result = duration / 3

        assert func_result == op_result

    def test_negate_matches_operator(self) -> None:
        """Test negate() produces same result as unary - operator."""
        duration = Duration(seconds=30)

        func_result = negate(duration)
        op_result = -duration

        assert func_result == op_result

    def test_absolute_matches_builtin(self) -> None:
        """Test absolute() produces same result as abs() builtin."""
        duration = Duration(days=-1)

        func_result = absolute(duration)
        builtin_result = abs(duration)

        assert func_result == builtin_result
