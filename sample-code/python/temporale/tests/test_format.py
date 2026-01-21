"""Tests for formatting module."""

import pytest

from temporale import Date, DateTime, Time
from temporale.format import format_iso8601, format_rfc3339, strftime
from temporale.units.timezone import Timezone


class TestFormatISO8601:
    """Tests for format_iso8601 function."""

    def test_format_date(self):
        """Format Date to ISO 8601."""
        d = Date(2024, 1, 15)
        assert format_iso8601(d) == "2024-01-15"

    def test_format_date_negative_year(self):
        """Format BCE date."""
        d = Date(-44, 3, 15)
        assert format_iso8601(d) == "-0044-03-15"

    def test_format_date_year_zero(self):
        """Format year zero (1 BCE)."""
        d = Date(0, 6, 15)
        assert format_iso8601(d) == "0000-06-15"

    def test_format_time_no_subseconds(self):
        """Format Time without subseconds."""
        t = Time(14, 30, 45)
        assert format_iso8601(t) == "14:30:45"

    def test_format_time_with_milliseconds(self):
        """Format Time with milliseconds."""
        t = Time(14, 30, 45, nanosecond=123_000_000)
        assert format_iso8601(t) == "14:30:45.123"

    def test_format_time_with_microseconds(self):
        """Format Time with microseconds."""
        t = Time(14, 30, 45, nanosecond=123_456_000)
        assert format_iso8601(t) == "14:30:45.123456"

    def test_format_time_with_nanoseconds(self):
        """Format Time with nanoseconds."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert format_iso8601(t) == "14:30:45.123456789"

    def test_format_time_precision_seconds(self):
        """Format Time with precision=seconds."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert format_iso8601(t, precision="seconds") == "14:30:45"

    def test_format_time_precision_millis(self):
        """Format Time with precision=millis."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert format_iso8601(t, precision="millis") == "14:30:45.123"

    def test_format_time_precision_micros(self):
        """Format Time with precision=micros."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        assert format_iso8601(t, precision="micros") == "14:30:45.123456"

    def test_format_time_precision_nanos(self):
        """Format Time with precision=nanos."""
        t = Time(14, 30, 45, nanosecond=123_000_000)
        assert format_iso8601(t, precision="nanos") == "14:30:45.123000000"

    def test_format_datetime_naive(self):
        """Format naive DateTime."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert format_iso8601(dt) == "2024-01-15T14:30:45"

    def test_format_datetime_utc(self):
        """Format DateTime with UTC timezone."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        assert format_iso8601(dt) == "2024-01-15T14:30:45Z"

    def test_format_datetime_positive_offset(self):
        """Format DateTime with positive offset."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        assert format_iso8601(dt) == "2024-01-15T14:30:45+05:30"

    def test_format_datetime_negative_offset(self):
        """Format DateTime with negative offset."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(-8))
        assert format_iso8601(dt) == "2024-01-15T14:30:45-08:00"

    def test_format_datetime_with_nanoseconds(self):
        """Format DateTime with nanoseconds."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789)
        assert format_iso8601(dt) == "2024-01-15T14:30:45.123456789"

    def test_format_invalid_type(self):
        """Format with invalid type raises TypeError."""
        with pytest.raises(TypeError):
            format_iso8601("not a temporal object")


class TestFormatRFC3339:
    """Tests for format_rfc3339 function."""

    def test_format_datetime_utc(self):
        """Format DateTime with UTC timezone."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        assert format_rfc3339(dt) == "2024-01-15T14:30:45Z"

    def test_format_datetime_with_offset(self):
        """Format DateTime with offset timezone."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        assert format_rfc3339(dt) == "2024-01-15T14:30:45+05:30"

    def test_format_datetime_with_subseconds(self):
        """Format DateTime with subseconds."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_000_000, timezone=Timezone.utc())
        assert format_rfc3339(dt) == "2024-01-15T14:30:45.123Z"

    def test_format_datetime_precision_nanos(self):
        """Format DateTime with full nanosecond precision."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789, timezone=Timezone.utc())
        assert format_rfc3339(dt, precision="nanos") == "2024-01-15T14:30:45.123456789Z"

    def test_format_naive_datetime_raises(self):
        """Format naive DateTime raises ValueError."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        with pytest.raises(ValueError, match="RFC 3339 requires timezone"):
            format_rfc3339(dt)

    def test_format_invalid_type_raises(self):
        """Format non-DateTime raises TypeError."""
        with pytest.raises(TypeError):
            format_rfc3339(Date(2024, 1, 15))


class TestStrftime:
    """Tests for strftime function."""

    def test_strftime_date_basic(self):
        """Format date with basic pattern."""
        d = Date(2024, 1, 15)
        assert strftime(d, "%Y-%m-%d") == "2024-01-15"

    def test_strftime_date_slash_separator(self):
        """Format date with slash separator."""
        d = Date(2024, 1, 15)
        assert strftime(d, "%Y/%m/%d") == "2024/01/15"

    def test_strftime_date_us_format(self):
        """Format date in US format."""
        d = Date(2024, 1, 15)
        assert strftime(d, "%m/%d/%Y") == "01/15/2024"

    def test_strftime_time_basic(self):
        """Format time with basic pattern."""
        t = Time(14, 30, 45)
        assert strftime(t, "%H:%M:%S") == "14:30:45"

    def test_strftime_time_with_microseconds(self):
        """Format time with microseconds."""
        t = Time(14, 30, 45, microsecond=123456)
        assert strftime(t, "%H:%M:%S.%f") == "14:30:45.123456"

    def test_strftime_datetime_basic(self):
        """Format datetime with basic pattern."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert strftime(dt, "%Y-%m-%d %H:%M:%S") == "2024-01-15 14:30:45"

    def test_strftime_datetime_custom_format(self):
        """Format datetime with custom pattern."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert strftime(dt, "%Y/%m/%d %H:%M") == "2024/01/15 14:30"

    def test_strftime_datetime_with_timezone_z(self):
        """Format datetime with timezone using %z."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        assert strftime(dt, "%Y-%m-%d %H:%M:%S%z") == "2024-01-15 14:30:45+0530"

    def test_strftime_datetime_with_timezone_Z(self):
        """Format datetime with timezone using %Z."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        assert strftime(dt, "%Y-%m-%d %H:%M:%S %Z") == "2024-01-15 14:30:45 UTC"

    def test_strftime_datetime_with_offset_Z(self):
        """Format datetime with offset timezone using %Z."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        assert strftime(dt, "%Y-%m-%d %H:%M:%S %Z") == "2024-01-15 14:30:45 +05:30"

    def test_strftime_naive_datetime_z(self):
        """Format naive datetime with %z returns empty."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert strftime(dt, "%Y-%m-%d %H:%M:%S%z") == "2024-01-15 14:30:45"

    def test_strftime_literal_percent(self):
        """Format with literal percent."""
        d = Date(2024, 1, 15)
        assert strftime(d, "100%% on %Y-%m-%d") == "100% on 2024-01-15"

    def test_strftime_negative_year(self):
        """Format BCE date with %Y."""
        d = Date(-44, 3, 15)
        assert strftime(d, "%Y-%m-%d") == "-0044-03-15"

    def test_strftime_unsupported_directive_raises(self):
        """Format with unsupported directive raises ValueError."""
        d = Date(2024, 1, 15)
        with pytest.raises(ValueError, match="unsupported strftime directive"):
            strftime(d, "%Y-%m-%d %A")  # %A is weekday name (not supported)

    def test_strftime_time_with_date_directive_raises(self):
        """Format time with date directive raises ValueError."""
        t = Time(14, 30, 45)
        with pytest.raises(ValueError, match="requires year"):
            strftime(t, "%Y-%m-%d")

    def test_strftime_date_with_time_directive_raises(self):
        """Format date with time directive raises ValueError."""
        d = Date(2024, 1, 15)
        with pytest.raises(ValueError, match="requires hour"):
            strftime(d, "%H:%M:%S")


class TestStrftimeMicroseconds:
    """Tests for microsecond handling in strftime."""

    def test_microsecond_zero(self):
        """Format time with zero microseconds."""
        t = Time(14, 30, 45)
        assert strftime(t, "%H:%M:%S.%f") == "14:30:45.000000"

    def test_microsecond_leading_zeros(self):
        """Format time with leading zeros in microseconds."""
        t = Time(14, 30, 45, microsecond=123)
        assert strftime(t, "%H:%M:%S.%f") == "14:30:45.000123"

    def test_microsecond_full(self):
        """Format time with full microseconds."""
        t = Time(14, 30, 45, microsecond=999999)
        assert strftime(t, "%H:%M:%S.%f") == "14:30:45.999999"
