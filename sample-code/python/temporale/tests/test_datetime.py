"""Tests for the DateTime class."""

from __future__ import annotations

import pytest

from temporale.core.date import Date
from temporale.core.datetime import DateTime
from temporale.core.duration import Duration
from temporale.core.time import Time
from temporale.errors import ParseError, TimezoneError, ValidationError
from temporale.units.era import Era
from temporale.units.timezone import Timezone


class TestDateTimeConstruction:
    """Test DateTime construction."""

    def test_basic_construction(self) -> None:
        """Test basic datetime construction with all components."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 14
        assert dt.minute == 30
        assert dt.second == 45
        assert dt.nanosecond == 0
        assert dt.timezone is None

    def test_construction_with_defaults(self) -> None:
        """Test construction with default time values."""
        dt = DateTime(2024, 1, 15)
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 0
        assert dt.minute == 0
        assert dt.second == 0

    def test_construction_with_nanoseconds(self) -> None:
        """Test construction with nanosecond precision."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, nanosecond=123_456_789)
        assert dt.nanosecond == 123_456_789
        assert dt.microsecond == 123456
        assert dt.millisecond == 123

    def test_construction_with_milliseconds(self) -> None:
        """Test construction with milliseconds."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, millisecond=500)
        assert dt.millisecond == 500
        assert dt.nanosecond == 500_000_000

    def test_construction_with_microseconds(self) -> None:
        """Test construction with microseconds."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, microsecond=500_000)
        assert dt.microsecond == 500_000
        assert dt.nanosecond == 500_000_000

    def test_construction_with_timezone(self) -> None:
        """Test construction with timezone."""
        tz = Timezone.utc()
        dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz)
        assert dt.timezone == tz
        assert dt.is_aware
        assert not dt.is_naive

    def test_construction_naive(self) -> None:
        """Test naive datetime has no timezone."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        assert dt.timezone is None
        assert dt.is_naive
        assert not dt.is_aware


class TestDateTimeValidation:
    """Test DateTime validation."""

    def test_invalid_year(self) -> None:
        """Test invalid year raises ValidationError."""
        with pytest.raises(ValidationError, match="year"):
            DateTime(100_000, 1, 1)

    def test_invalid_month(self) -> None:
        """Test invalid month raises ValidationError."""
        with pytest.raises(ValidationError, match="month"):
            DateTime(2024, 13, 1)

    def test_invalid_day(self) -> None:
        """Test invalid day raises ValidationError."""
        with pytest.raises(ValidationError, match="day"):
            DateTime(2024, 2, 30)

    def test_invalid_hour(self) -> None:
        """Test invalid hour raises ValidationError."""
        with pytest.raises(ValidationError, match="hour"):
            DateTime(2024, 1, 1, 24, 0, 0)

    def test_invalid_minute(self) -> None:
        """Test invalid minute raises ValidationError."""
        with pytest.raises(ValidationError, match="minute"):
            DateTime(2024, 1, 1, 12, 60, 0)

    def test_invalid_second(self) -> None:
        """Test invalid second raises ValidationError."""
        with pytest.raises(ValidationError, match="second"):
            DateTime(2024, 1, 1, 12, 30, 60)

    def test_invalid_nanosecond(self) -> None:
        """Test invalid nanosecond raises ValidationError."""
        with pytest.raises(ValidationError, match="nanosecond"):
            DateTime(2024, 1, 1, 12, 0, 0, nanosecond=1_000_000_000)


class TestDateTimeNow:
    """Test DateTime.now() and DateTime.utc_now()."""

    def test_now_returns_datetime(self) -> None:
        """Test now() returns a DateTime."""
        dt = DateTime.now()
        assert isinstance(dt, DateTime)

    def test_now_is_naive(self) -> None:
        """Test now() returns naive datetime."""
        dt = DateTime.now()
        assert dt.is_naive

    def test_now_reasonable_year(self) -> None:
        """Test now() returns a reasonable year."""
        dt = DateTime.now()
        assert dt.year >= 2024

    def test_utc_now_returns_datetime(self) -> None:
        """Test utc_now() returns a DateTime."""
        dt = DateTime.utc_now()
        assert isinstance(dt, DateTime)

    def test_utc_now_is_aware(self) -> None:
        """Test utc_now() returns aware datetime in UTC."""
        dt = DateTime.utc_now()
        assert dt.is_aware
        assert dt.timezone is not None
        assert dt.timezone.is_utc


class TestDateTimeFromTimestamp:
    """Test DateTime.from_timestamp() and related methods."""

    def test_from_timestamp_zero(self) -> None:
        """Test Unix epoch timestamp."""
        dt = DateTime.from_timestamp(0, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1
        assert dt.hour == 0
        assert dt.minute == 0
        assert dt.second == 0

    def test_from_timestamp_positive(self) -> None:
        """Test positive timestamp."""
        # 2024-01-15 12:30:00 UTC
        dt = DateTime.from_timestamp(1705321800, timezone=Timezone.utc())
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 12  # 12:30 UTC for timestamp 1705321800
        assert dt.minute == 30
        assert dt.second == 0

    def test_from_timestamp_float(self) -> None:
        """Test timestamp with fractional seconds."""
        dt = DateTime.from_timestamp(0.5, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1
        assert dt.second == 0
        assert dt.millisecond == 500

    def test_from_timestamp_negative(self) -> None:
        """Test negative timestamp (before Unix epoch)."""
        dt = DateTime.from_timestamp(-86400, timezone=Timezone.utc())  # 1 day before
        assert dt.year == 1969
        assert dt.month == 12
        assert dt.day == 31

    def test_from_unix_seconds(self) -> None:
        """Test from_unix_seconds."""
        dt = DateTime.from_unix_seconds(0, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1

    def test_from_unix_millis(self) -> None:
        """Test from_unix_millis."""
        dt = DateTime.from_unix_millis(500, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1
        assert dt.millisecond == 500

    def test_from_unix_nanos(self) -> None:
        """Test from_unix_nanos."""
        dt = DateTime.from_unix_nanos(123_456_789, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1
        assert dt.nanosecond == 123_456_789


class TestDateTimeFromIsoFormat:
    """Test DateTime.from_iso_format()."""

    def test_parse_basic_datetime(self) -> None:
        """Test parsing basic datetime."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45")
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 14
        assert dt.minute == 30
        assert dt.second == 45
        assert dt.is_naive

    def test_parse_datetime_with_z(self) -> None:
        """Test parsing datetime with Z suffix."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45Z")
        assert dt.is_aware
        assert dt.timezone is not None
        assert dt.timezone.is_utc

    def test_parse_datetime_with_offset(self) -> None:
        """Test parsing datetime with timezone offset."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45+05:30")
        assert dt.is_aware
        assert dt.timezone is not None
        assert dt.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_parse_datetime_with_negative_offset(self) -> None:
        """Test parsing datetime with negative timezone offset."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45-05:00")
        assert dt.timezone is not None
        assert dt.timezone.offset_seconds == -5 * 3600

    def test_parse_datetime_with_nanoseconds(self) -> None:
        """Test parsing datetime with nanoseconds."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45.123456789")
        assert dt.nanosecond == 123_456_789

    def test_parse_datetime_with_milliseconds(self) -> None:
        """Test parsing datetime with milliseconds."""
        dt = DateTime.from_iso_format("2024-01-15T14:30:45.123")
        assert dt.millisecond == 123
        assert dt.nanosecond == 123_000_000

    def test_parse_date_only(self) -> None:
        """Test parsing date-only string."""
        dt = DateTime.from_iso_format("2024-01-15")
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 0
        assert dt.minute == 0
        assert dt.second == 0

    def test_parse_with_space_separator(self) -> None:
        """Test parsing datetime with space separator."""
        dt = DateTime.from_iso_format("2024-01-15 14:30:45")
        assert dt.year == 2024
        assert dt.hour == 14

    def test_parse_empty_string_raises(self) -> None:
        """Test parsing empty string raises ParseError."""
        with pytest.raises(ParseError):
            DateTime.from_iso_format("")

    def test_parse_invalid_format_raises(self) -> None:
        """Test parsing invalid format raises ParseError."""
        with pytest.raises(ParseError):
            DateTime.from_iso_format("not-a-date")


class TestDateTimeCombine:
    """Test DateTime.combine()."""

    def test_combine_date_and_time(self) -> None:
        """Test combining Date and Time."""
        d = Date(2024, 1, 15)
        t = Time(14, 30, 45)
        dt = DateTime.combine(d, t)
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 14
        assert dt.minute == 30
        assert dt.second == 45

    def test_combine_with_timezone(self) -> None:
        """Test combining with timezone."""
        d = Date(2024, 1, 15)
        t = Time(14, 30, 45)
        tz = Timezone.utc()
        dt = DateTime.combine(d, t, timezone=tz)
        assert dt.is_aware
        assert dt.timezone == tz


class TestDateTimeProperties:
    """Test DateTime properties."""

    def test_date_method(self) -> None:
        """Test date() returns correct Date."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        d = dt.date()
        assert isinstance(d, Date)
        assert d.year == 2024
        assert d.month == 1
        assert d.day == 15

    def test_time_method(self) -> None:
        """Test time() returns correct Time."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123)
        t = dt.time()
        assert isinstance(t, Time)
        assert t.hour == 14
        assert t.minute == 30
        assert t.second == 45
        assert t.nanosecond == 123

    def test_era_ce(self) -> None:
        """Test era property for CE dates."""
        dt = DateTime(2024, 1, 1)
        assert dt.era == Era.CE

    def test_era_bce(self) -> None:
        """Test era property for BCE dates."""
        dt = DateTime(-44, 3, 15)
        assert dt.era == Era.BCE

    def test_era_year_zero(self) -> None:
        """Test era property for year 0."""
        dt = DateTime(0, 1, 1)
        assert dt.era == Era.BCE


class TestDateTimeTimezoneHandling:
    """Test DateTime timezone operations."""

    def test_replace_timezone(self) -> None:
        """Test replace_timezone() adds timezone without conversion."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        dt_aware = dt.replace_timezone(Timezone.utc())
        assert dt_aware.is_aware
        assert dt_aware.hour == 12  # Same local time

    def test_replace_timezone_removes(self) -> None:
        """Test replace_timezone(None) removes timezone."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        dt_naive = dt.replace_timezone(None)
        assert dt_naive.is_naive

    def test_astimezone_utc_to_offset(self) -> None:
        """Test astimezone() converts UTC to offset timezone."""
        dt_utc = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        tz_530 = Timezone.from_hours(5, 30)
        dt_local = dt_utc.astimezone(tz_530)
        assert dt_local.hour == 17
        assert dt_local.minute == 30
        assert dt_local.day == 15

    def test_astimezone_offset_to_utc(self) -> None:
        """Test astimezone() converts offset timezone to UTC."""
        tz_530 = Timezone.from_hours(5, 30)
        dt_local = DateTime(2024, 1, 15, 17, 30, 0, timezone=tz_530)
        dt_utc = dt_local.astimezone(Timezone.utc())
        assert dt_utc.hour == 12
        assert dt_utc.minute == 0

    def test_astimezone_naive_raises(self) -> None:
        """Test astimezone() on naive datetime raises TimezoneError."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        with pytest.raises(TimezoneError):
            dt.astimezone(Timezone.utc())

    def test_to_utc(self) -> None:
        """Test to_utc() convenience method."""
        tz_minus5 = Timezone.from_hours(-5)
        dt_local = DateTime(2024, 1, 15, 7, 0, 0, timezone=tz_minus5)
        dt_utc = dt_local.to_utc()
        assert dt_utc.hour == 12
        assert dt_utc.timezone is not None
        assert dt_utc.timezone.is_utc

    def test_astimezone_day_rollover_forward(self) -> None:
        """Test astimezone() when conversion crosses day boundary forward."""
        dt_utc = DateTime(2024, 1, 15, 23, 0, 0, timezone=Timezone.utc())
        tz_plus5 = Timezone.from_hours(5)
        dt_local = dt_utc.astimezone(tz_plus5)
        assert dt_local.day == 16
        assert dt_local.hour == 4

    def test_astimezone_day_rollover_backward(self) -> None:
        """Test astimezone() when conversion crosses day boundary backward."""
        dt_utc = DateTime(2024, 1, 15, 2, 0, 0, timezone=Timezone.utc())
        tz_minus5 = Timezone.from_hours(-5)
        dt_local = dt_utc.astimezone(tz_minus5)
        assert dt_local.day == 14
        assert dt_local.hour == 21


class TestDateTimeUnixTimestamps:
    """Test Unix timestamp conversions."""

    def test_to_unix_seconds_utc(self) -> None:
        """Test to_unix_seconds() for UTC datetime."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, timezone=Timezone.utc())
        assert dt.to_unix_seconds() == 0

    def test_to_unix_seconds_offset(self) -> None:
        """Test to_unix_seconds() for datetime with offset."""
        tz_plus5 = Timezone.from_hours(5)
        dt = DateTime(1970, 1, 1, 5, 0, 0, timezone=tz_plus5)
        # 5:00 AM UTC+5 = 0:00 UTC
        assert dt.to_unix_seconds() == 0

    def test_to_unix_seconds_naive(self) -> None:
        """Test to_unix_seconds() for naive datetime."""
        dt = DateTime(1970, 1, 1, 0, 0, 0)
        # Naive assumes local=UTC
        assert dt.to_unix_seconds() == 0

    def test_to_unix_millis(self) -> None:
        """Test to_unix_millis()."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, millisecond=500, timezone=Timezone.utc())
        assert dt.to_unix_millis() == 500

    def test_to_unix_nanos(self) -> None:
        """Test to_unix_nanos()."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, nanosecond=123, timezone=Timezone.utc())
        assert dt.to_unix_nanos() == 123

    def test_unix_roundtrip(self) -> None:
        """Test roundtrip through Unix seconds."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        ts = dt.to_unix_seconds()
        dt2 = DateTime.from_unix_seconds(ts, timezone=Timezone.utc())
        assert dt2.year == dt.year
        assert dt2.month == dt.month
        assert dt2.day == dt.day
        assert dt2.hour == dt.hour
        assert dt2.minute == dt.minute
        assert dt2.second == dt.second


class TestDateTimeReplace:
    """Test DateTime.replace()."""

    def test_replace_year(self) -> None:
        """Test replace year."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = dt.replace(year=2025)
        assert dt2.year == 2025
        assert dt2.month == 1
        assert dt2.day == 15

    def test_replace_time_components(self) -> None:
        """Test replace time components."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = dt.replace(hour=10, minute=0, second=0)
        assert dt2.hour == 10
        assert dt2.minute == 0
        assert dt2.second == 0

    def test_replace_timezone(self) -> None:
        """Test replace timezone via replace()."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = dt.replace(timezone=Timezone.utc())
        assert dt2.is_aware

    def test_replace_preserves_unspecified(self) -> None:
        """Test replace preserves unspecified components."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123)
        dt2 = dt.replace(year=2025)
        assert dt2.nanosecond == 123
        assert dt2.hour == 14


class TestDateTimeIsoFormat:
    """Test DateTime ISO format output."""

    def test_to_iso_format_basic(self) -> None:
        """Test basic ISO format."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert dt.to_iso_format() == "2024-01-15T14:30:45"

    def test_to_iso_format_utc(self) -> None:
        """Test ISO format with UTC."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        assert dt.to_iso_format() == "2024-01-15T14:30:45Z"

    def test_to_iso_format_offset(self) -> None:
        """Test ISO format with offset."""
        tz = Timezone.from_hours(5, 30)
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=tz)
        assert dt.to_iso_format() == "2024-01-15T14:30:45+05:30"

    def test_to_iso_format_negative_offset(self) -> None:
        """Test ISO format with negative offset."""
        tz = Timezone.from_hours(-5)
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=tz)
        assert dt.to_iso_format() == "2024-01-15T14:30:45-05:00"

    def test_to_iso_format_nanoseconds(self) -> None:
        """Test ISO format with nanoseconds."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789)
        assert dt.to_iso_format() == "2024-01-15T14:30:45.123456789"

    def test_to_iso_format_precision_millis(self) -> None:
        """Test ISO format with millis precision."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert dt.to_iso_format(precision="millis") == "2024-01-15T14:30:45.000"

    def test_to_iso_format_precision_nanos(self) -> None:
        """Test ISO format with nanos precision."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123)
        assert dt.to_iso_format(precision="nanos") == "2024-01-15T14:30:45.000000123"

    def test_iso_roundtrip(self) -> None:
        """Test ISO format roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789, timezone=Timezone.utc())
        s = dt.to_iso_format()
        dt2 = DateTime.from_iso_format(s)
        assert dt2 == dt


class TestDateTimeArithmetic:
    """Test DateTime arithmetic operations."""

    def test_add_duration_hours(self) -> None:
        """Test adding hours duration."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        result = dt + Duration.from_hours(2)
        assert result.hour == 14
        assert result.day == 15

    def test_add_duration_days(self) -> None:
        """Test adding days duration."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        result = dt + Duration.from_days(10)
        assert result.day == 25
        assert result.hour == 12

    def test_add_duration_nanoseconds(self) -> None:
        """Test adding nanoseconds duration."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        result = dt + Duration.from_nanoseconds(500)
        assert result.nanosecond == 500

    def test_add_duration_day_rollover(self) -> None:
        """Test adding duration causing day rollover."""
        dt = DateTime(2024, 1, 15, 23, 0, 0)
        result = dt + Duration.from_hours(3)
        assert result.day == 16
        assert result.hour == 2

    def test_add_duration_preserves_timezone(self) -> None:
        """Test that adding duration preserves timezone."""
        dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        result = dt + Duration.from_hours(2)
        assert result.is_aware
        assert result.timezone == Timezone.utc()

    def test_subtract_duration(self) -> None:
        """Test subtracting duration."""
        dt = DateTime(2024, 1, 15, 14, 0, 0)
        result = dt - Duration.from_hours(2)
        assert result.hour == 12

    def test_subtract_datetime_same_tz(self) -> None:
        """Test subtracting datetime returns duration."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0, timezone=Timezone.utc())
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        diff = dt1 - dt2
        assert isinstance(diff, Duration)
        assert diff.total_seconds == 7200.0

    def test_subtract_datetime_naive(self) -> None:
        """Test subtracting naive datetimes."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        diff = dt1 - dt2
        assert diff.total_seconds == 7200.0

    def test_subtract_datetime_mixed_raises(self) -> None:
        """Test subtracting naive and aware raises error."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0, timezone=Timezone.utc())
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        with pytest.raises(TimezoneError):
            _ = dt1 - dt2

    def test_subtract_datetime_different_tz(self) -> None:
        """Test subtracting datetimes in different timezones."""
        tz_utc = Timezone.utc()
        tz_plus5 = Timezone.from_hours(5)
        # Both represent same instant
        dt1 = DateTime(2024, 1, 15, 17, 0, 0, timezone=tz_plus5)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz_utc)
        diff = dt1 - dt2
        assert diff.total_seconds == 0.0

    def test_add_negative_duration(self) -> None:
        """Test adding negative duration."""
        dt = DateTime(2024, 1, 15, 14, 0, 0)
        result = dt + Duration.from_hours(-2)
        assert result.hour == 12

    def test_add_invalid_type(self) -> None:
        """Test adding invalid type returns NotImplemented."""
        dt = DateTime(2024, 1, 15, 12, 0, 0)
        result = dt.__add__(42)
        assert result is NotImplemented


class TestDateTimeComparison:
    """Test DateTime comparison operations."""

    def test_equality_same(self) -> None:
        """Test equality of same datetime."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 45)
        assert dt1 == dt2

    def test_equality_different(self) -> None:
        """Test inequality of different datetime."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 46)
        assert dt1 != dt2

    def test_equality_naive_vs_aware(self) -> None:
        """Test naive != aware (per Q07 decision)."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        assert dt1 != dt2

    def test_equality_different_tz_same_instant(self) -> None:
        """Test equality for same instant in different timezones."""
        tz_utc = Timezone.utc()
        tz_plus5 = Timezone.from_hours(5)
        dt1 = DateTime(2024, 1, 15, 17, 0, 0, timezone=tz_plus5)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz_utc)
        assert dt1 == dt2

    def test_less_than_naive(self) -> None:
        """Test less than comparison for naive datetimes."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = DateTime(2024, 1, 15, 14, 0, 0)
        assert dt1 < dt2

    def test_less_than_aware(self) -> None:
        """Test less than comparison for aware datetimes."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        dt2 = DateTime(2024, 1, 15, 14, 0, 0, timezone=Timezone.utc())
        assert dt1 < dt2

    def test_less_than_mixed_raises(self) -> None:
        """Test comparing naive and aware raises TypeError."""
        dt1 = DateTime(2024, 1, 15, 12, 0, 0)
        dt2 = DateTime(2024, 1, 15, 14, 0, 0, timezone=Timezone.utc())
        with pytest.raises(TypeError):
            _ = dt1 < dt2

    def test_less_than_equal(self) -> None:
        """Test less than or equal."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0)
        dt2 = DateTime(2024, 1, 15, 14, 0, 0)
        assert dt1 <= dt2

    def test_greater_than(self) -> None:
        """Test greater than."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0)
        assert dt1 > dt2

    def test_greater_than_equal(self) -> None:
        """Test greater than or equal."""
        dt1 = DateTime(2024, 1, 15, 14, 0, 0)
        dt2 = DateTime(2024, 1, 15, 14, 0, 0)
        assert dt1 >= dt2


class TestDateTimeHash:
    """Test DateTime hashing."""

    def test_hash_same_naive(self) -> None:
        """Test same naive datetime has same hash."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 45)
        assert hash(dt1) == hash(dt2)

    def test_hash_different(self) -> None:
        """Test different datetime has different hash."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 46)
        assert hash(dt1) != hash(dt2)

    def test_hash_same_instant_different_tz(self) -> None:
        """Test same instant in different timezone has same hash."""
        tz_utc = Timezone.utc()
        tz_plus5 = Timezone.from_hours(5)
        dt1 = DateTime(2024, 1, 15, 17, 0, 0, timezone=tz_plus5)
        dt2 = DateTime(2024, 1, 15, 12, 0, 0, timezone=tz_utc)
        assert hash(dt1) == hash(dt2)

    def test_usable_in_set(self) -> None:
        """Test datetime can be used in set."""
        dt1 = DateTime(2024, 1, 15, 14, 30, 45)
        dt2 = DateTime(2024, 1, 15, 14, 30, 45)
        s = {dt1, dt2}
        assert len(s) == 1

    def test_usable_as_dict_key(self) -> None:
        """Test datetime can be used as dict key."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        d = {dt: "value"}
        assert d[dt] == "value"


class TestDateTimeStr:
    """Test DateTime string representations."""

    def test_repr_naive(self) -> None:
        """Test repr for naive datetime."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        r = repr(dt)
        assert "DateTime(2024, 1, 15, 14, 30, 45" in r
        assert "timezone" not in r

    def test_repr_aware(self) -> None:
        """Test repr for aware datetime."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        r = repr(dt)
        assert "DateTime(2024, 1, 15, 14, 30, 45" in r
        assert "timezone=" in r

    def test_str_is_iso(self) -> None:
        """Test str returns ISO format."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        assert str(dt) == "2024-01-15T14:30:45"


class TestDateTimeBool:
    """Test DateTime boolean behavior."""

    def test_always_truthy(self) -> None:
        """Test datetime is always truthy."""
        dt = DateTime(2024, 1, 15)
        assert bool(dt) is True

    def test_midnight_truthy(self) -> None:
        """Test midnight datetime is truthy."""
        dt = DateTime(2024, 1, 1, 0, 0, 0)
        assert bool(dt) is True


class TestDateTimeBCE:
    """Test DateTime with BCE dates."""

    def test_bce_construction(self) -> None:
        """Test BCE datetime construction."""
        dt = DateTime(-44, 3, 15, 12, 0, 0)
        assert dt.year == -44
        assert dt.era == Era.BCE

    def test_bce_iso_format(self) -> None:
        """Test BCE datetime ISO format."""
        dt = DateTime(-44, 3, 15, 12, 0, 0)
        s = dt.to_iso_format()
        assert s.startswith("-0044")

    def test_bce_parsing(self) -> None:
        """Test parsing BCE datetime."""
        dt = DateTime.from_iso_format("-0044-03-15T12:00:00")
        assert dt.year == -44
        assert dt.month == 3
        assert dt.day == 15


class TestDateTimeCircularImport:
    """Test that circular import is handled correctly."""

    def test_import_datetime_then_duration(self) -> None:
        """Test importing DateTime then Duration works."""
        from temporale import DateTime, Duration

        dt = DateTime(2024, 1, 15, 12, 0, 0)
        d = Duration.from_hours(2)
        result = dt + d
        assert result.hour == 14

    def test_import_from_temporale(self) -> None:
        """Test importing both from top-level package."""
        from temporale.core.datetime import DateTime
        from temporale.core.duration import Duration

        dt = DateTime(2024, 1, 15, 12, 0, 0)
        d = Duration(days=1)
        result = dt + d
        assert result.day == 16
