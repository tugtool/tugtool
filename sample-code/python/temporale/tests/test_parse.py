"""Tests for parsing module."""

import pytest

from temporale import Date, DateTime, Time
from temporale.errors import ParseError
from temporale.format import format_rfc3339, parse_iso8601, parse_rfc3339, strptime
from temporale.units.timezone import Timezone


class TestParseISO8601Date:
    """Tests for parsing ISO 8601 date strings."""

    def test_parse_date_basic(self):
        """Parse basic date."""
        result = parse_iso8601("2024-01-15")
        assert isinstance(result, Date)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_date_negative_year(self):
        """Parse BCE date."""
        result = parse_iso8601("-0044-03-15")
        assert isinstance(result, Date)
        assert result.year == -44
        assert result.month == 3
        assert result.day == 15

    def test_parse_date_year_zero(self):
        """Parse year zero."""
        result = parse_iso8601("0000-06-15")
        assert isinstance(result, Date)
        assert result.year == 0
        assert result.month == 6
        assert result.day == 15

    def test_parse_date_first_day(self):
        """Parse first day of year."""
        result = parse_iso8601("2024-01-01")
        assert result == Date(2024, 1, 1)

    def test_parse_date_last_day(self):
        """Parse last day of year."""
        result = parse_iso8601("2024-12-31")
        assert result == Date(2024, 12, 31)


class TestParseISO8601Time:
    """Tests for parsing ISO 8601 time strings."""

    def test_parse_time_basic(self):
        """Parse basic time."""
        result = parse_iso8601("14:30:45")
        assert isinstance(result, Time)
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45

    def test_parse_time_midnight(self):
        """Parse midnight."""
        result = parse_iso8601("00:00:00")
        assert result.hour == 0
        assert result.minute == 0
        assert result.second == 0

    def test_parse_time_end_of_day(self):
        """Parse end of day."""
        result = parse_iso8601("23:59:59")
        assert result.hour == 23
        assert result.minute == 59
        assert result.second == 59

    def test_parse_time_with_milliseconds(self):
        """Parse time with milliseconds."""
        result = parse_iso8601("14:30:45.123")
        assert result.nanosecond == 123_000_000

    def test_parse_time_with_microseconds(self):
        """Parse time with microseconds."""
        result = parse_iso8601("14:30:45.123456")
        assert result.nanosecond == 123_456_000

    def test_parse_time_with_nanoseconds(self):
        """Parse time with nanoseconds."""
        result = parse_iso8601("14:30:45.123456789")
        assert result.nanosecond == 123_456_789

    def test_parse_time_without_seconds(self):
        """Parse time without seconds."""
        result = parse_iso8601("14:30")
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 0

    def test_parse_time_compact_format(self):
        """Parse compact time format."""
        result = parse_iso8601("143045")
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45


class TestParseISO8601DateTime:
    """Tests for parsing ISO 8601 datetime strings."""

    def test_parse_datetime_basic(self):
        """Parse basic datetime."""
        result = parse_iso8601("2024-01-15T14:30:45")
        assert isinstance(result, DateTime)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45
        assert result.timezone is None

    def test_parse_datetime_with_z(self):
        """Parse datetime with Z timezone."""
        result = parse_iso8601("2024-01-15T14:30:45Z")
        assert result.timezone is not None
        assert result.timezone.is_utc

    def test_parse_datetime_with_positive_offset(self):
        """Parse datetime with positive offset."""
        result = parse_iso8601("2024-01-15T14:30:45+05:30")
        assert result.timezone is not None
        assert result.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_parse_datetime_with_negative_offset(self):
        """Parse datetime with negative offset."""
        result = parse_iso8601("2024-01-15T14:30:45-08:00")
        assert result.timezone is not None
        assert result.timezone.offset_seconds == -8 * 3600

    def test_parse_datetime_with_subseconds(self):
        """Parse datetime with subseconds."""
        result = parse_iso8601("2024-01-15T14:30:45.123456789Z")
        assert result.nanosecond == 123_456_789
        assert result.timezone.is_utc

    def test_parse_datetime_with_space_separator(self):
        """Parse datetime with space separator."""
        result = parse_iso8601("2024-01-15 14:30:45")
        assert result.year == 2024
        assert result.hour == 14

    def test_parse_datetime_lowercase_t(self):
        """Parse datetime with lowercase t separator."""
        result = parse_iso8601("2024-01-15t14:30:45")
        assert result.year == 2024
        assert result.hour == 14

    def test_parse_datetime_lowercase_z(self):
        """Parse datetime with lowercase z timezone."""
        result = parse_iso8601("2024-01-15T14:30:45z")
        assert result.timezone.is_utc

    def test_parse_datetime_date_only(self):
        """Parse date-only as datetime at midnight."""
        result = parse_iso8601("2024-01-15")
        # parse_iso8601 returns Date for date-only strings
        assert isinstance(result, Date)


class TestParseISO8601Errors:
    """Tests for parse_iso8601 error handling."""

    def test_parse_empty_string(self):
        """Parse empty string raises ParseError."""
        with pytest.raises(ParseError):
            parse_iso8601("")

    def test_parse_invalid_date(self):
        """Parse invalid date raises error."""
        with pytest.raises((ParseError, Exception)):
            parse_iso8601("2024-13-01")  # Invalid month

    def test_parse_invalid_format(self):
        """Parse unrecognized format raises ParseError."""
        with pytest.raises(ParseError):
            parse_iso8601("not-a-date")


class TestParseRFC3339:
    """Tests for parse_rfc3339 function."""

    def test_parse_datetime_utc(self):
        """Parse datetime with UTC timezone."""
        result = parse_rfc3339("2024-01-15T14:30:45Z")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45
        assert result.timezone.is_utc

    def test_parse_datetime_with_offset(self):
        """Parse datetime with offset timezone."""
        result = parse_rfc3339("2024-01-15T14:30:45+05:30")
        assert result.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_parse_datetime_with_negative_offset(self):
        """Parse datetime with negative offset."""
        result = parse_rfc3339("2024-01-15T14:30:45-08:00")
        assert result.timezone.offset_seconds == -8 * 3600

    def test_parse_datetime_with_subseconds(self):
        """Parse datetime with fractional seconds."""
        result = parse_rfc3339("2024-01-15T14:30:45.123456789Z")
        assert result.nanosecond == 123_456_789

    def test_parse_datetime_one_digit_fraction(self):
        """Parse datetime with 1-digit fraction."""
        result = parse_rfc3339("2024-01-15T14:30:45.1Z")
        assert result.nanosecond == 100_000_000

    def test_parse_datetime_three_digit_fraction(self):
        """Parse datetime with 3-digit fraction."""
        result = parse_rfc3339("2024-01-15T14:30:45.123Z")
        assert result.nanosecond == 123_000_000

    def test_parse_lowercase_t(self):
        """Parse with lowercase t separator."""
        result = parse_rfc3339("2024-01-15t14:30:45Z")
        assert result.year == 2024

    def test_parse_without_timezone_raises(self):
        """Parse without timezone raises ParseError."""
        with pytest.raises(ParseError, match="RFC 3339"):
            parse_rfc3339("2024-01-15T14:30:45")

    def test_parse_with_space_separator_raises(self):
        """Parse with space separator raises ParseError."""
        with pytest.raises(ParseError, match="RFC 3339"):
            parse_rfc3339("2024-01-15 14:30:45Z")

    def test_parse_empty_string_raises(self):
        """Parse empty string raises ParseError."""
        with pytest.raises(ParseError):
            parse_rfc3339("")


class TestStrptime:
    """Tests for strptime function."""

    def test_strptime_basic_datetime(self):
        """Parse basic datetime."""
        result = strptime("2024-01-15 14:30:45", "%Y-%m-%d %H:%M:%S")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45

    def test_strptime_date_only(self):
        """Parse date only (time defaults to midnight)."""
        result = strptime("2024-01-15", "%Y-%m-%d")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 0
        assert result.minute == 0
        assert result.second == 0

    def test_strptime_us_format(self):
        """Parse US date format."""
        result = strptime("01/15/2024", "%m/%d/%Y")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_strptime_with_microseconds(self):
        """Parse with microseconds."""
        result = strptime("2024-01-15 14:30:45.123456", "%Y-%m-%d %H:%M:%S.%f")
        assert result.microsecond == 123456

    def test_strptime_with_timezone_z(self):
        """Parse with %z timezone."""
        result = strptime("2024-01-15 14:30:45+0530", "%Y-%m-%d %H:%M:%S%z")
        assert result.timezone is not None
        assert result.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_strptime_with_timezone_Z(self):
        """Parse with %Z timezone."""
        result = strptime("2024-01-15 14:30:45 UTC", "%Y-%m-%d %H:%M:%S %Z")
        assert result.timezone is not None
        assert result.timezone.is_utc

    def test_strptime_custom_separator(self):
        """Parse with custom separator."""
        result = strptime("2024/01/15-14:30", "%Y/%m/%d-%H:%M")
        assert result.year == 2024
        assert result.hour == 14
        assert result.minute == 30

    def test_strptime_negative_year(self):
        """Parse BCE date."""
        result = strptime("-0044-03-15 12:00:00", "%Y-%m-%d %H:%M:%S")
        assert result.year == -44
        assert result.month == 3
        assert result.day == 15

    def test_strptime_missing_date_raises(self):
        """Parse without date components raises ParseError."""
        with pytest.raises(ParseError, match="requires year, month, and day"):
            strptime("14:30:45", "%H:%M:%S")

    def test_strptime_no_match_raises(self):
        """Parse non-matching string raises ParseError."""
        with pytest.raises(ParseError, match="does not match format"):
            strptime("not a datetime", "%Y-%m-%d")

    def test_strptime_unsupported_directive_raises(self):
        """Parse with unsupported directive raises ValueError."""
        with pytest.raises(ValueError, match="unsupported strptime directive"):
            strptime("Monday", "%A")


class TestRoundtrip:
    """Tests for format/parse roundtrip guarantee."""

    def test_date_roundtrip(self):
        """Date roundtrip through ISO 8601."""
        d = Date(2024, 1, 15)
        parsed = parse_iso8601(d.to_iso_format())
        assert parsed == d

    def test_date_bce_roundtrip(self):
        """BCE date roundtrip."""
        d = Date(-44, 3, 15)
        parsed = parse_iso8601(d.to_iso_format())
        assert parsed == d

    def test_time_roundtrip(self):
        """Time roundtrip through ISO 8601."""
        t = Time(14, 30, 45)
        parsed = parse_iso8601(t.to_iso_format())
        assert parsed == t

    def test_time_with_nanos_roundtrip(self):
        """Time with nanoseconds roundtrip."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        parsed = parse_iso8601(t.to_iso_format())
        assert parsed == t

    def test_datetime_naive_roundtrip(self):
        """Naive datetime roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        parsed = parse_iso8601(dt.to_iso_format())
        assert parsed == dt

    def test_datetime_utc_roundtrip(self):
        """UTC datetime roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        parsed = parse_iso8601(dt.to_iso_format())
        assert parsed == dt

    def test_datetime_offset_roundtrip(self):
        """Datetime with offset roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        parsed = parse_iso8601(dt.to_iso_format())
        assert parsed == dt

    def test_datetime_with_nanos_roundtrip(self):
        """Datetime with nanoseconds roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789, timezone=Timezone.utc())
        parsed = parse_iso8601(dt.to_iso_format())
        assert parsed == dt

    def test_rfc3339_roundtrip(self):
        """RFC 3339 datetime roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_000_000, timezone=Timezone.utc())
        parsed = parse_rfc3339(format_rfc3339(dt))
        assert parsed == dt

    def test_strptime_strftime_roundtrip(self):
        """strptime/strftime roundtrip."""
        from temporale.format import strftime

        dt = DateTime(2024, 1, 15, 14, 30, 45, microsecond=123456)
        fmt = "%Y-%m-%d %H:%M:%S.%f"
        formatted = strftime(dt, fmt)
        parsed = strptime(formatted, fmt)
        # Note: strptime returns DateTime, original had no timezone
        assert parsed.year == dt.year
        assert parsed.month == dt.month
        assert parsed.day == dt.day
        assert parsed.hour == dt.hour
        assert parsed.minute == dt.minute
        assert parsed.second == dt.second
        assert parsed.microsecond == dt.microsecond
