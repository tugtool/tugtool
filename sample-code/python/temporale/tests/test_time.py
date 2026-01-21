"""Tests for the Time class.

This module provides comprehensive tests for the Time class including:
- Construction and validation
- Property accessors
- Subsecond precision (millisecond, microsecond, nanosecond)
- Transformations (replace, with_nanosecond)
- Comparisons and hashing
- ISO format parsing and formatting
- Boundary cases (midnight, end of day)
"""

import pytest

from temporale.core.time import Time
from temporale.errors import ParseError, ValidationError


class TestTimeConstruction:
    """Tests for Time construction."""

    def test_default_values(self) -> None:
        """Time with no args creates midnight."""
        t = Time()
        assert t.hour == 0
        assert t.minute == 0
        assert t.second == 0
        assert t.nanosecond == 0

    def test_basic_construction(self) -> None:
        """Create Time with hour, minute, second."""
        t = Time(14, 30, 45)
        assert t.hour == 14
        assert t.minute == 30
        assert t.second == 45
        assert t.nanosecond == 0

    def test_construction_with_nanosecond(self) -> None:
        """Create Time with nanosecond precision."""
        t = Time(12, 0, 0, nanosecond=123_456_789)
        assert t.hour == 12
        assert t.minute == 0
        assert t.second == 0
        assert t.nanosecond == 123_456_789

    def test_construction_with_millisecond(self) -> None:
        """Create Time with millisecond."""
        t = Time(12, 0, 0, millisecond=500)
        assert t.nanosecond == 500_000_000

    def test_construction_with_microsecond(self) -> None:
        """Create Time with microsecond."""
        t = Time(12, 0, 0, microsecond=500)
        assert t.nanosecond == 500_000

    def test_construction_additive_subseconds(self) -> None:
        """Subsecond components are additive."""
        t = Time(12, 0, 0, millisecond=1, microsecond=1, nanosecond=1)
        # 1ms = 1_000_000ns, 1us = 1_000ns, 1ns = 1ns
        expected = 1_000_000 + 1_000 + 1
        assert t.nanosecond == expected


class TestTimeValidation:
    """Tests for Time validation."""

    def test_invalid_hour_negative(self) -> None:
        """Negative hour raises ValidationError."""
        with pytest.raises(ValidationError, match="hour must be between 0 and 23"):
            Time(-1, 0, 0)

    def test_invalid_hour_too_large(self) -> None:
        """Hour > 23 raises ValidationError."""
        with pytest.raises(ValidationError, match="hour must be between 0 and 23"):
            Time(24, 0, 0)

    def test_invalid_minute_negative(self) -> None:
        """Negative minute raises ValidationError."""
        with pytest.raises(ValidationError, match="minute must be between 0 and 59"):
            Time(12, -1, 0)

    def test_invalid_minute_too_large(self) -> None:
        """Minute > 59 raises ValidationError."""
        with pytest.raises(ValidationError, match="minute must be between 0 and 59"):
            Time(12, 60, 0)

    def test_invalid_second_negative(self) -> None:
        """Negative second raises ValidationError."""
        with pytest.raises(ValidationError, match="second must be between 0 and 59"):
            Time(12, 30, -1)

    def test_invalid_second_too_large(self) -> None:
        """Second > 59 raises ValidationError."""
        with pytest.raises(ValidationError, match="second must be between 0 and 59"):
            Time(12, 30, 60)

    def test_invalid_millisecond_negative(self) -> None:
        """Negative millisecond raises ValidationError."""
        with pytest.raises(ValidationError, match="millisecond must be between 0 and 999"):
            Time(12, 0, 0, millisecond=-1)

    def test_invalid_millisecond_too_large(self) -> None:
        """Millisecond > 999 raises ValidationError."""
        with pytest.raises(ValidationError, match="millisecond must be between 0 and 999"):
            Time(12, 0, 0, millisecond=1000)

    def test_invalid_microsecond_negative(self) -> None:
        """Negative microsecond raises ValidationError."""
        with pytest.raises(ValidationError, match="microsecond must be between 0 and 999999"):
            Time(12, 0, 0, microsecond=-1)

    def test_invalid_microsecond_too_large(self) -> None:
        """Microsecond > 999999 raises ValidationError."""
        with pytest.raises(ValidationError, match="microsecond must be between 0 and 999999"):
            Time(12, 0, 0, microsecond=1_000_000)

    def test_invalid_nanosecond_negative(self) -> None:
        """Negative nanosecond raises ValidationError."""
        with pytest.raises(ValidationError, match="nanosecond must be between 0 and 999999999"):
            Time(12, 0, 0, nanosecond=-1)

    def test_invalid_nanosecond_too_large(self) -> None:
        """Nanosecond > 999999999 raises ValidationError."""
        with pytest.raises(ValidationError, match="nanosecond must be between 0 and 999999999"):
            Time(12, 0, 0, nanosecond=1_000_000_000)


class TestTimeProperties:
    """Tests for Time property accessors."""

    def test_hour_property(self) -> None:
        """Test hour property across various times."""
        assert Time(0, 0, 0).hour == 0
        assert Time(12, 0, 0).hour == 12
        assert Time(23, 0, 0).hour == 23

    def test_minute_property(self) -> None:
        """Test minute property."""
        assert Time(12, 0, 0).minute == 0
        assert Time(12, 30, 0).minute == 30
        assert Time(12, 59, 0).minute == 59

    def test_second_property(self) -> None:
        """Test second property."""
        assert Time(12, 30, 0).second == 0
        assert Time(12, 30, 45).second == 45
        assert Time(12, 30, 59).second == 59

    def test_total_nanoseconds_property(self) -> None:
        """Test total_nanoseconds calculation."""
        # Midnight
        assert Time(0, 0, 0).total_nanoseconds == 0

        # 1 second = 1e9 nanoseconds
        assert Time(0, 0, 1).total_nanoseconds == 1_000_000_000

        # 1 minute = 60 seconds = 60e9 nanoseconds
        assert Time(0, 1, 0).total_nanoseconds == 60_000_000_000

        # 1 hour = 3600 seconds = 3600e9 nanoseconds
        assert Time(1, 0, 0).total_nanoseconds == 3_600_000_000_000


class TestSubsecondPrecision:
    """Tests for subsecond precision access."""

    def test_millisecond_extraction(self) -> None:
        """Millisecond property extracts correct value."""
        # 123ms = 123_000_000ns
        t = Time(12, 30, 45, nanosecond=123_456_789)
        assert t.millisecond == 123

    def test_microsecond_extraction(self) -> None:
        """Microsecond property extracts correct value."""
        # 123456us = 123_456_000ns
        t = Time(12, 30, 45, nanosecond=123_456_789)
        assert t.microsecond == 123_456

    def test_nanosecond_extraction(self) -> None:
        """Nanosecond property returns full subsecond value."""
        t = Time(12, 30, 45, nanosecond=123_456_789)
        assert t.nanosecond == 123_456_789

    def test_subsecond_boundaries(self) -> None:
        """Test subsecond values at boundaries."""
        # Maximum nanosecond
        t = Time(23, 59, 59, nanosecond=999_999_999)
        assert t.nanosecond == 999_999_999
        assert t.microsecond == 999_999
        assert t.millisecond == 999

        # Zero subsecond
        t = Time(12, 30, 45)
        assert t.nanosecond == 0
        assert t.microsecond == 0
        assert t.millisecond == 0

    def test_millisecond_only(self) -> None:
        """Millisecond with no smaller components."""
        t = Time(12, 0, 0, nanosecond=500_000_000)  # 500ms exactly
        assert t.millisecond == 500
        assert t.microsecond == 500_000
        assert t.nanosecond == 500_000_000


class TestTimeBoundaries:
    """Tests for boundary times (midnight, end of day)."""

    def test_midnight(self) -> None:
        """Time at midnight (00:00:00)."""
        t = Time(0, 0, 0)
        assert t.hour == 0
        assert t.minute == 0
        assert t.second == 0
        assert t.total_nanoseconds == 0

    def test_midnight_factory(self) -> None:
        """Time.midnight() creates midnight."""
        t = Time.midnight()
        assert t == Time(0, 0, 0)

    def test_noon_factory(self) -> None:
        """Time.noon() creates noon."""
        t = Time.noon()
        assert t == Time(12, 0, 0)

    def test_end_of_day(self) -> None:
        """Time at end of day (23:59:59.999999999)."""
        t = Time(23, 59, 59, nanosecond=999_999_999)
        assert t.hour == 23
        assert t.minute == 59
        assert t.second == 59
        assert t.nanosecond == 999_999_999

    def test_one_nanosecond_before_midnight(self) -> None:
        """One nanosecond before midnight is valid."""
        t = Time(23, 59, 59, nanosecond=999_999_999)
        # This should be the maximum valid time
        assert t.total_nanoseconds == 86_399_999_999_999


class TestTimeNow:
    """Tests for Time.now()."""

    def test_now_returns_time(self) -> None:
        """Time.now() returns a Time instance."""
        t = Time.now()
        assert isinstance(t, Time)

    def test_now_valid_range(self) -> None:
        """Time.now() returns values in valid ranges."""
        t = Time.now()
        assert 0 <= t.hour <= 23
        assert 0 <= t.minute <= 59
        assert 0 <= t.second <= 59


class TestTimeTransformations:
    """Tests for Time transformation methods."""

    def test_replace_hour(self) -> None:
        """Replace hour only."""
        t = Time(14, 30, 45)
        t2 = t.replace(hour=10)
        assert t2 == Time(10, 30, 45)
        # Original unchanged
        assert t.hour == 14

    def test_replace_minute(self) -> None:
        """Replace minute only."""
        t = Time(14, 30, 45)
        t2 = t.replace(minute=15)
        assert t2 == Time(14, 15, 45)

    def test_replace_second(self) -> None:
        """Replace second only."""
        t = Time(14, 30, 45)
        t2 = t.replace(second=0)
        assert t2 == Time(14, 30, 0)

    def test_replace_multiple(self) -> None:
        """Replace multiple components."""
        t = Time(14, 30, 45)
        t2 = t.replace(hour=0, minute=0, second=0)
        assert t2 == Time(0, 0, 0)

    def test_replace_nanosecond(self) -> None:
        """Replace nanosecond component."""
        t = Time(14, 30, 45)
        t2 = t.replace(nanosecond=123_456_789)
        assert t2 == Time(14, 30, 45, nanosecond=123_456_789)

    def test_replace_preserves_nanosecond(self) -> None:
        """Replace preserves nanosecond when not specified."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        t2 = t.replace(hour=10)
        assert t2.nanosecond == 123_456_789

    def test_with_nanosecond(self) -> None:
        """with_nanosecond replaces nanosecond component."""
        t = Time(12, 30, 45)
        t2 = t.with_nanosecond(123_456_789)
        assert t2.nanosecond == 123_456_789
        assert t2.hour == 12
        assert t2.minute == 30
        assert t2.second == 45

    def test_with_millisecond(self) -> None:
        """with_millisecond sets subsecond to milliseconds."""
        t = Time(12, 30, 45, nanosecond=999_999_999)
        t2 = t.with_millisecond(500)
        assert t2.nanosecond == 500_000_000
        assert t2.millisecond == 500

    def test_with_microsecond(self) -> None:
        """with_microsecond sets subsecond to microseconds."""
        t = Time(12, 30, 45, nanosecond=999_999_999)
        t2 = t.with_microsecond(500_000)
        assert t2.nanosecond == 500_000_000
        assert t2.microsecond == 500_000


class TestTimeComparisons:
    """Tests for Time comparison operators."""

    def test_equality_same(self) -> None:
        """Equal times are equal."""
        t1 = Time(12, 30, 45)
        t2 = Time(12, 30, 45)
        assert t1 == t2

    def test_equality_different(self) -> None:
        """Different times are not equal."""
        t1 = Time(12, 30, 45)
        t2 = Time(12, 30, 46)
        assert t1 != t2

    def test_equality_nanosecond_difference(self) -> None:
        """Times differing by one nanosecond are not equal."""
        t1 = Time(12, 30, 45, nanosecond=0)
        t2 = Time(12, 30, 45, nanosecond=1)
        assert t1 != t2

    def test_equality_with_non_time(self) -> None:
        """Comparison with non-Time returns NotImplemented."""
        t = Time(12, 30, 45)
        assert t != "12:30:45"
        assert t != 12

    def test_less_than(self) -> None:
        """Earlier time is less than later time."""
        t1 = Time(10, 0, 0)
        t2 = Time(12, 0, 0)
        assert t1 < t2
        assert not t2 < t1

    def test_less_than_nanosecond(self) -> None:
        """Comparison works at nanosecond precision."""
        t1 = Time(12, 30, 45, nanosecond=0)
        t2 = Time(12, 30, 45, nanosecond=1)
        assert t1 < t2

    def test_less_than_or_equal(self) -> None:
        """Less than or equal comparison."""
        t1 = Time(10, 0, 0)
        t2 = Time(12, 0, 0)
        t3 = Time(10, 0, 0)
        assert t1 <= t2
        assert t1 <= t3
        assert not t2 <= t1

    def test_greater_than(self) -> None:
        """Later time is greater than earlier time."""
        t1 = Time(10, 0, 0)
        t2 = Time(12, 0, 0)
        assert t2 > t1
        assert not t1 > t2

    def test_greater_than_or_equal(self) -> None:
        """Greater than or equal comparison."""
        t1 = Time(10, 0, 0)
        t2 = Time(12, 0, 0)
        t3 = Time(10, 0, 0)
        assert t2 >= t1
        assert t1 >= t3
        assert not t1 >= t2

    def test_comparison_ordering(self) -> None:
        """Times can be sorted correctly."""
        times = [
            Time(23, 59, 59),
            Time(0, 0, 0),
            Time(12, 0, 0),
            Time(12, 0, 0, nanosecond=1),
        ]
        sorted_times = sorted(times)
        assert sorted_times[0] == Time(0, 0, 0)
        assert sorted_times[1] == Time(12, 0, 0)
        assert sorted_times[2] == Time(12, 0, 0, nanosecond=1)
        assert sorted_times[3] == Time(23, 59, 59)


class TestTimeHash:
    """Tests for Time hashing."""

    def test_hash_equal_times(self) -> None:
        """Equal times have equal hashes."""
        t1 = Time(12, 30, 45)
        t2 = Time(12, 30, 45)
        assert hash(t1) == hash(t2)

    def test_hash_in_set(self) -> None:
        """Times can be used in sets."""
        s = {Time(12, 0, 0), Time(12, 30, 0), Time(12, 0, 0)}
        assert len(s) == 2

    def test_hash_in_dict(self) -> None:
        """Times can be used as dict keys."""
        d = {Time(12, 0, 0): "noon", Time(0, 0, 0): "midnight"}
        assert d[Time(12, 0, 0)] == "noon"
        assert d[Time(0, 0, 0)] == "midnight"

    def test_hash_with_nanoseconds(self) -> None:
        """Hash considers nanoseconds."""
        t1 = Time(12, 30, 45, nanosecond=0)
        t2 = Time(12, 30, 45, nanosecond=1)
        # Different times should have different hashes (usually)
        # Note: hash collisions are possible but unlikely for adjacent values
        assert t1 != t2
        # Both should be hashable
        s = {t1, t2}
        assert len(s) == 2


class TestTimeIsoFormat:
    """Tests for ISO format parsing and formatting."""

    def test_parse_basic(self) -> None:
        """Parse basic HH:MM:SS format."""
        t = Time.from_iso_format("14:30:45")
        assert t == Time(14, 30, 45)

    def test_parse_without_seconds(self) -> None:
        """Parse HH:MM format (no seconds)."""
        t = Time.from_iso_format("14:30")
        assert t == Time(14, 30, 0)

    def test_parse_with_fractional_seconds(self) -> None:
        """Parse with fractional seconds."""
        t = Time.from_iso_format("14:30:45.123")
        assert t.hour == 14
        assert t.minute == 30
        assert t.second == 45
        assert t.millisecond == 123
        assert t.nanosecond == 123_000_000

    def test_parse_full_nanosecond_precision(self) -> None:
        """Parse with full nanosecond precision."""
        t = Time.from_iso_format("14:30:45.123456789")
        assert t.nanosecond == 123_456_789

    def test_parse_compact_format(self) -> None:
        """Parse compact HHMMSS format."""
        t = Time.from_iso_format("143045")
        assert t == Time(14, 30, 45)

    def test_parse_compact_with_fraction(self) -> None:
        """Parse compact format with fraction."""
        t = Time.from_iso_format("143045.123")
        assert t.millisecond == 123

    def test_parse_midnight(self) -> None:
        """Parse midnight."""
        t = Time.from_iso_format("00:00:00")
        assert t == Time.midnight()

    def test_parse_end_of_day(self) -> None:
        """Parse end of day."""
        t = Time.from_iso_format("23:59:59.999999999")
        assert t == Time(23, 59, 59, nanosecond=999_999_999)

    def test_parse_strips_whitespace(self) -> None:
        """Parse strips leading/trailing whitespace."""
        t = Time.from_iso_format("  14:30:45  ")
        assert t == Time(14, 30, 45)

    def test_parse_invalid_empty(self) -> None:
        """Parse empty string raises ParseError."""
        with pytest.raises(ParseError, match="empty time string"):
            Time.from_iso_format("")

    def test_parse_invalid_format(self) -> None:
        """Parse invalid format raises ParseError."""
        with pytest.raises(ParseError, match="invalid ISO 8601 time format"):
            Time.from_iso_format("14-30-45")

    def test_parse_invalid_values(self) -> None:
        """Parse with invalid values raises ValidationError."""
        with pytest.raises(ValidationError, match="hour must be between"):
            Time.from_iso_format("25:00:00")

    def test_format_basic(self) -> None:
        """Format basic time."""
        t = Time(14, 30, 45)
        assert t.to_iso_format() == "14:30:45"

    def test_format_with_nanoseconds(self) -> None:
        """Format includes nanoseconds when non-zero."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert t.to_iso_format() == "14:30:45.123456789"

    def test_format_minimal_fraction(self) -> None:
        """Format uses minimal fractional digits."""
        t = Time(14, 30, 45, nanosecond=100_000_000)
        assert t.to_iso_format() == "14:30:45.1"

    def test_format_precision_seconds(self) -> None:
        """Format with seconds precision only."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert t.to_iso_format(precision="seconds") == "14:30:45"

    def test_format_precision_millis(self) -> None:
        """Format with millisecond precision."""
        t = Time(14, 30, 45)
        assert t.to_iso_format(precision="millis") == "14:30:45.000"

    def test_format_precision_micros(self) -> None:
        """Format with microsecond precision."""
        t = Time(14, 30, 45)
        assert t.to_iso_format(precision="micros") == "14:30:45.000000"

    def test_format_precision_nanos(self) -> None:
        """Format with nanosecond precision."""
        t = Time(14, 30, 45)
        assert t.to_iso_format(precision="nanos") == "14:30:45.000000000"

    def test_format_roundtrip(self) -> None:
        """Format and parse roundtrip preserves value."""
        original = Time(14, 30, 45, nanosecond=123_456_789)
        formatted = original.to_iso_format()
        parsed = Time.from_iso_format(formatted)
        assert parsed == original


class TestTimeStringRepresentation:
    """Tests for Time string representations."""

    def test_repr(self) -> None:
        """Test __repr__."""
        t = Time(14, 30, 45)
        assert repr(t) == "Time(14, 30, 45, nanosecond=0)"

    def test_repr_with_nanosecond(self) -> None:
        """Test __repr__ with nanosecond."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert repr(t) == "Time(14, 30, 45, nanosecond=123456789)"

    def test_str(self) -> None:
        """Test __str__ returns ISO format."""
        t = Time(14, 30, 45)
        assert str(t) == "14:30:45"


class TestTimeImmutability:
    """Tests verifying Time immutability (by convention, not enforcement).

    Note: Like Python's datetime, Time uses __slots__ for memory efficiency
    but doesn't enforce immutability at the runtime level. Immutability is
    by convention - all methods return new instances instead of mutating.
    """

    def test_replace_returns_new_instance(self) -> None:
        """replace() returns a new instance."""
        t1 = Time(12, 30, 45)
        t2 = t1.replace(hour=10)
        assert t1 is not t2
        assert t1.hour == 12  # Original unchanged

    def test_with_nanosecond_returns_new_instance(self) -> None:
        """with_nanosecond() returns a new instance."""
        t1 = Time(12, 30, 45)
        t2 = t1.with_nanosecond(123_456_789)
        assert t1 is not t2
        assert t1.nanosecond == 0  # Original unchanged


class TestTimeBool:
    """Tests for Time truthiness."""

    def test_midnight_is_truthy(self) -> None:
        """Even midnight is truthy."""
        assert bool(Time.midnight())

    def test_any_time_is_truthy(self) -> None:
        """Any valid time is truthy."""
        assert bool(Time(12, 30, 45))


class TestTimeEdgeCases:
    """Tests for edge cases and special scenarios."""

    def test_single_digit_fractional_seconds(self) -> None:
        """Parse single digit fractional second."""
        t = Time.from_iso_format("12:00:00.1")
        assert t.nanosecond == 100_000_000

    def test_two_digit_fractional_seconds(self) -> None:
        """Parse two digit fractional second."""
        t = Time.from_iso_format("12:00:00.12")
        assert t.nanosecond == 120_000_000

    def test_varying_fraction_lengths(self) -> None:
        """Parse various fractional second lengths."""
        cases = [
            ("12:00:00.1", 100_000_000),
            ("12:00:00.12", 120_000_000),
            ("12:00:00.123", 123_000_000),
            ("12:00:00.1234", 123_400_000),
            ("12:00:00.12345", 123_450_000),
            ("12:00:00.123456", 123_456_000),
            ("12:00:00.1234567", 123_456_700),
            ("12:00:00.12345678", 123_456_780),
            ("12:00:00.123456789", 123_456_789),
        ]
        for time_str, expected_nanos in cases:
            t = Time.from_iso_format(time_str)
            assert t.nanosecond == expected_nanos, f"Failed for {time_str}"

    def test_leading_zeros_preserved(self) -> None:
        """Format preserves leading zeros in components."""
        t = Time(1, 2, 3)
        assert t.to_iso_format() == "01:02:03"

    def test_comparison_type_error(self) -> None:
        """Comparison with invalid type returns NotImplemented."""
        t = Time(12, 0, 0)
        result = t.__lt__("12:00:00")
        assert result is NotImplemented
