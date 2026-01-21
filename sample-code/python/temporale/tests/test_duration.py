"""Tests for Duration class.

These tests verify the Duration implementation, including construction,
normalization, arithmetic, and comparison operations.
"""

from __future__ import annotations

import pytest


class TestDurationConstruction:
    """Tests for Duration construction."""

    def test_default_construction_is_zero(self) -> None:
        """Default Duration() creates a zero duration."""
        from temporale.core import Duration

        d = Duration()
        assert d.days == 0
        assert d.seconds == 0
        assert d.nanoseconds == 0

    def test_construction_with_days(self) -> None:
        """Duration with days only."""
        from temporale.core import Duration

        d = Duration(days=5)
        assert d.days == 5
        assert d.seconds == 0
        assert d.nanoseconds == 0

    def test_construction_with_seconds(self) -> None:
        """Duration with seconds only."""
        from temporale.core import Duration

        d = Duration(seconds=3600)
        assert d.days == 0
        assert d.seconds == 3600
        assert d.nanoseconds == 0

    def test_construction_with_milliseconds(self) -> None:
        """Duration with milliseconds."""
        from temporale.core import Duration

        d = Duration(milliseconds=1500)
        assert d.days == 0
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000

    def test_construction_with_microseconds(self) -> None:
        """Duration with microseconds."""
        from temporale.core import Duration

        d = Duration(microseconds=1_500_000)
        assert d.days == 0
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000

    def test_construction_with_nanoseconds(self) -> None:
        """Duration with nanoseconds."""
        from temporale.core import Duration

        d = Duration(nanoseconds=1_500_000_000)
        assert d.days == 0
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000

    def test_construction_with_all_components(self) -> None:
        """Duration with all component types."""
        from temporale.core import Duration

        d = Duration(
            days=1,
            seconds=1,
            milliseconds=1,
            microseconds=1,
            nanoseconds=1,
        )
        assert d.days == 1
        # 1 second + 1ms + 1us + 1ns = 1.001001001 seconds
        assert d.seconds == 1
        assert d.nanoseconds == 1_001_001

    def test_construction_negative_days(self) -> None:
        """Duration with negative days."""
        from temporale.core import Duration

        d = Duration(days=-5)
        assert d.days == -5
        assert d.seconds == 0
        assert d.nanoseconds == 0
        assert d.is_negative is True


class TestDurationNormalization:
    """Tests for Duration normalization."""

    def test_seconds_overflow_to_days(self) -> None:
        """Seconds exceeding a day normalize to days."""
        from temporale.core import Duration

        d = Duration(seconds=90000)  # 1 day + 3600 seconds
        assert d.days == 1
        assert d.seconds == 3600
        assert d.nanoseconds == 0

    def test_nanoseconds_overflow_to_seconds(self) -> None:
        """Nanoseconds exceeding a second normalize to seconds."""
        from temporale.core import Duration

        d = Duration(nanoseconds=2_500_000_000)  # 2.5 seconds
        assert d.days == 0
        assert d.seconds == 2
        assert d.nanoseconds == 500_000_000

    def test_negative_seconds_normalize(self) -> None:
        """Negative seconds normalize with borrowing."""
        from temporale.core import Duration

        d = Duration(seconds=-30)
        assert d.is_negative is True
        # -30 seconds = -1 day + (86400 - 30) seconds
        assert d.days == -1
        assert d.seconds == 86370
        assert d.nanoseconds == 0

    def test_negative_nanoseconds_normalize(self) -> None:
        """Negative nanoseconds normalize with borrowing."""
        from temporale.core import Duration

        d = Duration(nanoseconds=-500)
        assert d.is_negative is True
        # -500 ns = -1 day + (86400 seconds - 1) + (1e9 - 500) ns
        assert d.days == -1
        assert d.seconds == 86399
        assert d.nanoseconds == 999_999_500

    def test_mixed_positive_negative_normalize(self) -> None:
        """Mixed positive and negative values normalize correctly."""
        from temporale.core import Duration

        # 1 day - 12 hours = 12 hours
        d = Duration(days=1, seconds=-12 * 3600)
        assert d.days == 0
        assert d.seconds == 43200
        assert d.nanoseconds == 0

    def test_negative_day_positive_seconds(self) -> None:
        """Negative day with positive seconds."""
        from temporale.core import Duration

        d = Duration(days=-1, seconds=43200)  # -1 day + 12 hours = -12 hours
        assert d.days == -1
        assert d.seconds == 43200
        assert d.nanoseconds == 0
        assert d.is_negative is True

    def test_exact_negative_days(self) -> None:
        """Exactly negative days have zero seconds and nanos."""
        from temporale.core import Duration

        d = Duration(days=-3)
        assert d.days == -3
        assert d.seconds == 0
        assert d.nanoseconds == 0


class TestDurationFactoryMethods:
    """Tests for Duration factory methods."""

    def test_zero(self) -> None:
        """Duration.zero() creates zero duration."""
        from temporale.core import Duration

        d = Duration.zero()
        assert d.is_zero is True
        assert d.days == 0
        assert d.seconds == 0
        assert d.nanoseconds == 0

    def test_from_days(self) -> None:
        """Duration.from_days() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_days(7)
        assert d.days == 7
        assert d.seconds == 0

    def test_from_days_negative(self) -> None:
        """Duration.from_days() with negative value."""
        from temporale.core import Duration

        d = Duration.from_days(-3)
        assert d.days == -3
        assert d.is_negative is True

    def test_from_hours(self) -> None:
        """Duration.from_hours() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_hours(25)
        assert d.days == 1
        assert d.seconds == 3600

    def test_from_hours_negative(self) -> None:
        """Duration.from_hours() with negative value."""
        from temporale.core import Duration

        d = Duration.from_hours(-2)
        assert d.is_negative is True
        assert d.days == -1
        assert d.seconds == 79200  # 86400 - 7200

    def test_from_minutes(self) -> None:
        """Duration.from_minutes() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_minutes(90)
        assert d.days == 0
        assert d.seconds == 5400

    def test_from_seconds(self) -> None:
        """Duration.from_seconds() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_seconds(3661)
        assert d.days == 0
        assert d.seconds == 3661

    def test_from_milliseconds(self) -> None:
        """Duration.from_milliseconds() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_milliseconds(1500)
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000

    def test_from_microseconds(self) -> None:
        """Duration.from_microseconds() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_microseconds(1_500_000)
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000

    def test_from_nanoseconds(self) -> None:
        """Duration.from_nanoseconds() creates correct duration."""
        from temporale.core import Duration

        d = Duration.from_nanoseconds(1_500_000_000)
        assert d.seconds == 1
        assert d.nanoseconds == 500_000_000


class TestDurationProperties:
    """Tests for Duration property accessors."""

    def test_days_property(self) -> None:
        """days property returns correct value."""
        from temporale.core import Duration

        d = Duration(days=5, seconds=3600)
        assert d.days == 5

    def test_seconds_property(self) -> None:
        """seconds property returns value in range [0, 86400)."""
        from temporale.core import Duration

        d = Duration(seconds=90000)  # Overflows to next day
        assert d.seconds == 3600  # 90000 - 86400

    def test_nanoseconds_property(self) -> None:
        """nanoseconds property returns value in range [0, 1e9)."""
        from temporale.core import Duration

        d = Duration(nanoseconds=2_500_000_000)
        assert d.nanoseconds == 500_000_000

    def test_total_seconds_positive(self) -> None:
        """total_seconds for positive duration."""
        from temporale.core import Duration

        d = Duration(days=1, seconds=3600)
        assert d.total_seconds == 90000.0

    def test_total_seconds_with_nanos(self) -> None:
        """total_seconds includes nanosecond fraction."""
        from temporale.core import Duration

        d = Duration(seconds=1, nanoseconds=500_000_000)
        assert d.total_seconds == 1.5

    def test_total_seconds_negative(self) -> None:
        """total_seconds for negative duration."""
        from temporale.core import Duration

        d = Duration(days=-1)
        assert d.total_seconds == -86400.0

    def test_total_nanoseconds_positive(self) -> None:
        """total_nanoseconds for positive duration."""
        from temporale.core import Duration

        d = Duration(seconds=1, nanoseconds=500)
        assert d.total_nanoseconds == 1_000_000_500

    def test_total_nanoseconds_negative(self) -> None:
        """total_nanoseconds for negative duration."""
        from temporale.core import Duration

        d = Duration(seconds=-30)
        assert d.total_nanoseconds == -30_000_000_000

    def test_is_negative_true(self) -> None:
        """is_negative returns True for negative durations."""
        from temporale.core import Duration

        d = Duration(days=-1)
        assert d.is_negative is True

    def test_is_negative_false(self) -> None:
        """is_negative returns False for positive durations."""
        from temporale.core import Duration

        d = Duration(days=1)
        assert d.is_negative is False

    def test_is_negative_zero(self) -> None:
        """is_negative returns False for zero duration."""
        from temporale.core import Duration

        d = Duration.zero()
        assert d.is_negative is False

    def test_is_zero_true(self) -> None:
        """is_zero returns True for zero duration."""
        from temporale.core import Duration

        d = Duration.zero()
        assert d.is_zero is True

    def test_is_zero_false(self) -> None:
        """is_zero returns False for non-zero duration."""
        from temporale.core import Duration

        d = Duration(nanoseconds=1)
        assert d.is_zero is False


class TestDurationArithmetic:
    """Tests for Duration arithmetic operations."""

    def test_add_durations(self) -> None:
        """Adding two durations."""
        from temporale.core import Duration

        d1 = Duration(seconds=30)
        d2 = Duration(seconds=45)
        result = d1 + d2
        assert result.seconds == 75

    def test_add_with_overflow(self) -> None:
        """Adding durations that overflow to days."""
        from temporale.core import Duration

        d1 = Duration(seconds=80000)
        d2 = Duration(seconds=10000)
        result = d1 + d2
        assert result.days == 1
        assert result.seconds == 3600

    def test_add_negative_durations(self) -> None:
        """Adding negative durations."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=-30)
        result = d1 + d2
        assert result.seconds == 30

    def test_subtract_durations(self) -> None:
        """Subtracting durations."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=30)
        result = d1 - d2
        assert result.seconds == 30

    def test_subtract_larger_duration(self) -> None:
        """Subtracting a larger duration produces negative result."""
        from temporale.core import Duration

        d1 = Duration(seconds=30)
        d2 = Duration(seconds=60)
        result = d1 - d2
        assert result.is_negative is True
        assert result.total_seconds == -30.0

    def test_multiply_by_positive(self) -> None:
        """Multiplying by positive integer."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = d * 3
        assert result.seconds == 90

    def test_multiply_by_negative(self) -> None:
        """Multiplying by negative integer."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = d * -2
        assert result.is_negative is True
        assert result.total_seconds == -60.0

    def test_multiply_by_zero(self) -> None:
        """Multiplying by zero produces zero duration."""
        from temporale.core import Duration

        d = Duration(days=5)
        result = d * 0
        assert result.is_zero is True

    def test_rmul(self) -> None:
        """Scalar * Duration works."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = 3 * d
        assert result.seconds == 90

    def test_truediv(self) -> None:
        """True division of duration."""
        from temporale.core import Duration

        d = Duration(seconds=90)
        result = d / 3
        assert result.seconds == 30

    def test_truediv_with_remainder(self) -> None:
        """True division with fractional result."""
        from temporale.core import Duration

        d = Duration(seconds=100)
        result = d / 3
        # 100 seconds / 3 = 33.333... seconds
        assert result.seconds == 33
        assert result.nanoseconds == 333_333_333

    def test_truediv_by_zero(self) -> None:
        """Division by zero raises ZeroDivisionError."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        with pytest.raises(ZeroDivisionError):
            _ = d / 0

    def test_floordiv(self) -> None:
        """Floor division of duration."""
        from temporale.core import Duration

        d = Duration(seconds=100)
        result = d // 3
        assert result.seconds == 33
        assert result.nanoseconds == 333_333_333

    def test_floordiv_by_zero(self) -> None:
        """Floor division by zero raises ZeroDivisionError."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        with pytest.raises(ZeroDivisionError):
            _ = d // 0

    def test_negation(self) -> None:
        """Negating a duration."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = -d
        assert result.is_negative is True
        assert result.total_seconds == -30.0

    def test_negation_of_negative(self) -> None:
        """Negating a negative duration produces positive."""
        from temporale.core import Duration

        d = Duration(seconds=-30)
        result = -d
        assert result.is_negative is False
        assert result.total_seconds == 30.0

    def test_abs_positive(self) -> None:
        """abs() of positive duration returns same value."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = abs(d)
        assert result.seconds == 30

    def test_abs_negative(self) -> None:
        """abs() of negative duration returns positive."""
        from temporale.core import Duration

        d = Duration(days=-1)
        result = abs(d)
        assert result.days == 1
        assert result.is_negative is False

    def test_abs_zero(self) -> None:
        """abs() of zero duration is zero."""
        from temporale.core import Duration

        d = Duration.zero()
        result = abs(d)
        assert result.is_zero is True

    def test_pos(self) -> None:
        """Unary + returns copy."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        result = +d
        assert result.seconds == 30
        assert result is not d

    def test_radd_with_zero(self) -> None:
        """sum() works with Duration (0 + Duration)."""
        from temporale.core import Duration

        durations = [Duration(seconds=10), Duration(seconds=20), Duration(seconds=30)]
        result = sum(durations, Duration.zero())
        assert result.seconds == 60


class TestDurationComparison:
    """Tests for Duration comparison operations."""

    def test_equal_durations(self) -> None:
        """Equal durations compare as equal."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=60)
        assert d1 == d2

    def test_equal_different_construction(self) -> None:
        """Durations equal when total time is same."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration.from_minutes(1)
        assert d1 == d2

    def test_not_equal(self) -> None:
        """Different durations are not equal."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=61)
        assert d1 != d2

    def test_less_than(self) -> None:
        """Shorter duration is less than longer."""
        from temporale.core import Duration

        d1 = Duration(seconds=30)
        d2 = Duration(seconds=60)
        assert d1 < d2
        assert not (d2 < d1)

    def test_less_than_or_equal(self) -> None:
        """Less than or equal comparison."""
        from temporale.core import Duration

        d1 = Duration(seconds=30)
        d2 = Duration(seconds=60)
        d3 = Duration(seconds=30)
        assert d1 <= d2
        assert d1 <= d3

    def test_greater_than(self) -> None:
        """Longer duration is greater than shorter."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=30)
        assert d1 > d2
        assert not (d2 > d1)

    def test_greater_than_or_equal(self) -> None:
        """Greater than or equal comparison."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=30)
        d3 = Duration(seconds=60)
        assert d1 >= d2
        assert d1 >= d3

    def test_negative_comparison(self) -> None:
        """Negative durations compare correctly."""
        from temporale.core import Duration

        d1 = Duration(days=-2)
        d2 = Duration(days=-1)
        assert d1 < d2  # -2 days is less than -1 day

    def test_comparison_with_non_duration(self) -> None:
        """Comparison with non-Duration returns NotImplemented."""
        from temporale.core import Duration

        d = Duration(seconds=30)
        assert (d == 30) is False
        assert (d == "30 seconds") is False


class TestDurationHash:
    """Tests for Duration hashing."""

    def test_equal_durations_same_hash(self) -> None:
        """Equal durations have the same hash."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=60)
        assert hash(d1) == hash(d2)

    def test_can_use_in_set(self) -> None:
        """Durations can be used in sets."""
        from temporale.core import Duration

        d1 = Duration(seconds=60)
        d2 = Duration(seconds=60)  # Duplicate
        d3 = Duration(seconds=30)

        s = {d1, d2, d3}
        assert len(s) == 2

    def test_can_use_as_dict_key(self) -> None:
        """Durations can be used as dictionary keys."""
        from temporale.core import Duration

        d = Duration(seconds=60)
        data = {d: "one minute"}
        assert data[d] == "one minute"


class TestDurationStringRepresentation:
    """Tests for Duration string representations."""

    def test_repr(self) -> None:
        """repr shows all components."""
        from temporale.core import Duration

        d = Duration(days=1, seconds=3600, nanoseconds=500)
        r = repr(d)
        assert "Duration(" in r
        assert "days=1" in r
        assert "seconds=3600" in r
        assert "nanoseconds=500" in r

    def test_str_zero(self) -> None:
        """str of zero duration."""
        from temporale.core import Duration

        d = Duration.zero()
        assert str(d) == "0:00:00"

    def test_str_seconds_only(self) -> None:
        """str with seconds only."""
        from temporale.core import Duration

        d = Duration(seconds=3661)  # 1:01:01
        assert str(d) == "1:01:01"

    def test_str_with_days(self) -> None:
        """str with days."""
        from temporale.core import Duration

        d = Duration(days=2, seconds=3600)
        assert "2 days" in str(d)

    def test_str_single_day(self) -> None:
        """str with single day."""
        from temporale.core import Duration

        d = Duration(days=1, seconds=3600)
        assert "1 day" in str(d)

    def test_str_negative_day(self) -> None:
        """str with negative day."""
        from temporale.core import Duration

        d = Duration(days=-1, seconds=43200)
        assert "-1 day" in str(d)

    def test_str_with_nanoseconds(self) -> None:
        """str includes nanosecond fraction."""
        from temporale.core import Duration

        d = Duration(seconds=1, nanoseconds=500_000_000)
        s = str(d)
        assert ".5" in s


class TestDurationBool:
    """Tests for Duration boolean conversion."""

    def test_bool_zero_is_false(self) -> None:
        """Zero duration is falsy."""
        from temporale.core import Duration

        d = Duration.zero()
        assert bool(d) is False

    def test_bool_nonzero_is_true(self) -> None:
        """Non-zero duration is truthy."""
        from temporale.core import Duration

        d = Duration(nanoseconds=1)
        assert bool(d) is True

    def test_bool_negative_is_true(self) -> None:
        """Negative duration is truthy."""
        from temporale.core import Duration

        d = Duration(days=-1)
        assert bool(d) is True


class TestDurationNegativeCases:
    """Additional tests for negative duration handling."""

    def test_negative_duration_normalization_example_1(self) -> None:
        """Test case from spec: Duration(seconds=90000) -> (1, 3600, 0)."""
        from temporale.core import Duration

        d = Duration(seconds=90000)
        assert d.days == 1
        assert d.seconds == 3600
        assert d.nanoseconds == 0

    def test_negative_duration_normalization_example_2(self) -> None:
        """Test case: Duration(days=-1) + Duration(hours=12) = -12 hours."""
        from temporale.core import Duration

        # -1 day + 12 hours = -12 hours
        d = Duration(days=-1, seconds=43200)
        assert d.is_negative is True
        assert d.days == -1
        assert d.seconds == 43200
        # Total should be -12 hours = -43200 seconds
        assert d.total_seconds == -43200.0

    def test_negative_duration_normalization_example_3(self) -> None:
        """Test case from spec: Duration(nanoseconds=-500) -> (-1, 86399, 999999500)."""
        from temporale.core import Duration

        d = Duration(nanoseconds=-500)
        assert d.days == -1
        assert d.seconds == 86399
        assert d.nanoseconds == 999_999_500

    def test_negative_duration_subtraction(self) -> None:
        """Test case: Duration(days=1) - Duration(hours=36) = -12 hours."""
        from temporale.core import Duration

        d1 = Duration(days=1)  # 24 hours
        d2 = Duration.from_hours(36)  # 36 hours
        result = d1 - d2  # -12 hours
        assert result.is_negative is True
        assert result.total_seconds == -43200.0
