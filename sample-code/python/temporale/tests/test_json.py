"""Tests for JSON serialization and deserialization."""

import json

import pytest

from temporale import Date, DateTime, Time
from temporale.convert import (
    from_json,
    from_unix_millis,
    from_unix_nanos,
    from_unix_seconds,
    to_json,
    to_unix_millis,
    to_unix_nanos,
    to_unix_seconds,
)
from temporale.core.duration import Duration
from temporale.errors import ParseError
from temporale.units.timezone import Timezone


class TestDateTimeToJson:
    """Tests for DateTime.to_json() and to_json(DateTime)."""

    def test_datetime_naive_to_json(self):
        """Naive datetime to JSON."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        result = dt.to_json()
        assert result["_type"] == "DateTime"
        assert result["value"] == "2024-01-15T14:30:45"

    def test_datetime_utc_to_json(self):
        """UTC datetime to JSON."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        result = dt.to_json()
        assert result["_type"] == "DateTime"
        assert result["value"] == "2024-01-15T14:30:45Z"

    def test_datetime_with_offset_to_json(self):
        """Datetime with offset to JSON."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(5, 30))
        result = dt.to_json()
        assert result["_type"] == "DateTime"
        assert result["value"] == "2024-01-15T14:30:45+05:30"

    def test_datetime_with_nanoseconds_to_json(self):
        """Datetime with nanoseconds to JSON."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789)
        result = dt.to_json()
        assert result["_type"] == "DateTime"
        assert result["value"] == "2024-01-15T14:30:45.123456789"

    def test_datetime_to_json_function(self):
        """Test to_json() function with DateTime."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        result = to_json(dt)
        assert result["_type"] == "DateTime"
        assert result["value"] == "2024-01-15T14:30:45"

    def test_datetime_json_is_serializable(self):
        """Result should be JSON-serializable."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        result = dt.to_json()
        json_str = json.dumps(result)
        assert '"_type": "DateTime"' in json_str


class TestDateTimeFromJson:
    """Tests for DateTime.from_json() and from_json() with DateTime."""

    def test_datetime_naive_from_json(self):
        """Parse naive datetime from JSON."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45"}
        result = DateTime.from_json(data)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45
        assert result.timezone is None

    def test_datetime_utc_from_json(self):
        """Parse UTC datetime from JSON."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45Z"}
        result = DateTime.from_json(data)
        assert result.timezone.is_utc

    def test_datetime_with_offset_from_json(self):
        """Parse datetime with offset from JSON."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45+05:30"}
        result = DateTime.from_json(data)
        assert result.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_datetime_with_nanoseconds_from_json(self):
        """Parse datetime with nanoseconds from JSON."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45.123456789"}
        result = DateTime.from_json(data)
        assert result.nanosecond == 123_456_789

    def test_datetime_from_json_function(self):
        """Test from_json() function with DateTime."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45"}
        result = from_json(data)
        assert isinstance(result, DateTime)
        assert result.year == 2024

    def test_datetime_from_json_missing_value(self):
        """Missing value field raises ParseError."""
        data = {"_type": "DateTime"}
        with pytest.raises(ParseError, match="missing 'value'"):
            DateTime.from_json(data)


class TestDateTimeJsonRoundtrip:
    """Tests for DateTime JSON roundtrip."""

    def test_naive_roundtrip(self):
        """Naive datetime roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        data = dt.to_json()
        restored = DateTime.from_json(data)
        assert restored == dt

    def test_utc_roundtrip(self):
        """UTC datetime roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        data = dt.to_json()
        restored = DateTime.from_json(data)
        assert restored == dt

    def test_offset_roundtrip(self):
        """Datetime with offset roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.from_hours(-8))
        data = dt.to_json()
        restored = DateTime.from_json(data)
        assert restored == dt

    def test_nanoseconds_roundtrip(self):
        """Datetime with nanoseconds roundtrip."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123_456_789, timezone=Timezone.utc())
        data = dt.to_json()
        restored = DateTime.from_json(data)
        assert restored == dt

    def test_via_json_dumps_loads(self):
        """Roundtrip via actual JSON serialization."""
        dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        json_str = json.dumps(dt.to_json())
        data = json.loads(json_str)
        restored = DateTime.from_json(data)
        assert restored == dt


class TestDateToJson:
    """Tests for Date JSON serialization."""

    def test_date_to_json(self):
        """Date to JSON."""
        d = Date(2024, 1, 15)
        result = d.to_json()
        assert result["_type"] == "Date"
        assert result["value"] == "2024-01-15"

    def test_date_bce_to_json(self):
        """BCE date to JSON."""
        d = Date(-44, 3, 15)
        result = d.to_json()
        assert result["_type"] == "Date"
        assert result["value"] == "-0044-03-15"

    def test_date_to_json_function(self):
        """Test to_json() function with Date."""
        d = Date(2024, 1, 15)
        result = to_json(d)
        assert result["_type"] == "Date"


class TestDateFromJson:
    """Tests for Date JSON deserialization."""

    def test_date_from_json(self):
        """Parse date from JSON."""
        data = {"_type": "Date", "value": "2024-01-15"}
        result = Date.from_json(data)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_date_bce_from_json(self):
        """Parse BCE date from JSON."""
        data = {"_type": "Date", "value": "-0044-03-15"}
        result = Date.from_json(data)
        assert result.year == -44

    def test_date_from_json_function(self):
        """Test from_json() function with Date."""
        data = {"_type": "Date", "value": "2024-01-15"}
        result = from_json(data)
        assert isinstance(result, Date)


class TestDateJsonRoundtrip:
    """Tests for Date JSON roundtrip."""

    def test_date_roundtrip(self):
        """Date roundtrip."""
        d = Date(2024, 1, 15)
        data = d.to_json()
        restored = Date.from_json(data)
        assert restored == d

    def test_date_bce_roundtrip(self):
        """BCE date roundtrip."""
        d = Date(-44, 3, 15)
        data = d.to_json()
        restored = Date.from_json(data)
        assert restored == d

    def test_date_via_json_dumps_loads(self):
        """Roundtrip via actual JSON serialization."""
        d = Date(2024, 1, 15)
        json_str = json.dumps(d.to_json())
        data = json.loads(json_str)
        restored = Date.from_json(data)
        assert restored == d


class TestTimeToJson:
    """Tests for Time JSON serialization."""

    def test_time_to_json(self):
        """Time to JSON."""
        t = Time(14, 30, 45)
        result = t.to_json()
        assert result["_type"] == "Time"
        assert result["value"] == "14:30:45"

    def test_time_with_nanoseconds_to_json(self):
        """Time with nanoseconds to JSON."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        result = t.to_json()
        assert result["_type"] == "Time"
        assert result["value"] == "14:30:45.123456789"

    def test_time_to_json_function(self):
        """Test to_json() function with Time."""
        t = Time(14, 30, 45)
        result = to_json(t)
        assert result["_type"] == "Time"


class TestTimeFromJson:
    """Tests for Time JSON deserialization."""

    def test_time_from_json(self):
        """Parse time from JSON."""
        data = {"_type": "Time", "value": "14:30:45"}
        result = Time.from_json(data)
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45

    def test_time_with_nanoseconds_from_json(self):
        """Parse time with nanoseconds from JSON."""
        data = {"_type": "Time", "value": "14:30:45.123456789"}
        result = Time.from_json(data)
        assert result.nanosecond == 123_456_789

    def test_time_from_json_function(self):
        """Test from_json() function with Time."""
        data = {"_type": "Time", "value": "14:30:45"}
        result = from_json(data)
        assert isinstance(result, Time)


class TestTimeJsonRoundtrip:
    """Tests for Time JSON roundtrip."""

    def test_time_roundtrip(self):
        """Time roundtrip."""
        t = Time(14, 30, 45)
        data = t.to_json()
        restored = Time.from_json(data)
        assert restored == t

    def test_time_nanoseconds_roundtrip(self):
        """Time with nanoseconds roundtrip."""
        t = Time(14, 30, 45, nanosecond=123_456_789)
        data = t.to_json()
        restored = Time.from_json(data)
        assert restored == t


class TestDurationToJson:
    """Tests for Duration JSON serialization."""

    def test_duration_days_to_json(self):
        """Duration with days to JSON."""
        d = Duration(days=1)
        result = d.to_json()
        assert result["_type"] == "Duration"
        assert result["value"] == "P1D"
        assert result["total_nanos"] == 86400 * 10**9

    def test_duration_time_to_json(self):
        """Duration with time components to JSON."""
        d = Duration(days=1, seconds=9000)  # 2h 30m
        result = d.to_json()
        assert result["_type"] == "Duration"
        assert result["value"] == "P1DT2H30M"

    def test_duration_seconds_to_json(self):
        """Duration with seconds to JSON."""
        d = Duration(seconds=90, nanoseconds=500_000_000)
        result = d.to_json()
        assert result["_type"] == "Duration"
        assert result["value"] == "PT1M30.5S"

    def test_duration_zero_to_json(self):
        """Zero duration to JSON."""
        d = Duration.zero()
        result = d.to_json()
        assert result["_type"] == "Duration"
        assert result["value"] == "PT0S"
        assert result["total_nanos"] == 0

    def test_duration_negative_to_json(self):
        """Negative duration to JSON."""
        d = Duration(days=-1)
        result = d.to_json()
        assert result["_type"] == "Duration"
        assert result["value"].startswith("-")
        assert result["total_nanos"] == -86400 * 10**9

    def test_duration_to_json_function(self):
        """Test to_json() function with Duration."""
        d = Duration(days=1)
        result = to_json(d)
        assert result["_type"] == "Duration"


class TestDurationFromJson:
    """Tests for Duration JSON deserialization."""

    def test_duration_from_json_via_total_nanos(self):
        """Parse duration using total_nanos (preferred)."""
        data = {"_type": "Duration", "value": "P1D", "total_nanos": 86400 * 10**9}
        result = Duration.from_json(data)
        assert result.days == 1
        assert result.seconds == 0
        assert result.nanoseconds == 0

    def test_duration_from_json_via_value(self):
        """Parse duration using value (fallback)."""
        data = {"_type": "Duration", "value": "P1DT2H30M"}
        result = Duration.from_json(data)
        assert result.days == 1
        assert result.seconds == 9000  # 2h 30m

    def test_duration_with_seconds_from_json(self):
        """Parse duration with seconds from JSON."""
        data = {"_type": "Duration", "value": "PT1M30.5S"}
        result = Duration.from_json(data)
        assert result.seconds == 90
        assert result.nanoseconds == 500_000_000

    def test_duration_from_json_function(self):
        """Test from_json() function with Duration."""
        data = {"_type": "Duration", "value": "P1D", "total_nanos": 86400 * 10**9}
        result = from_json(data)
        assert isinstance(result, Duration)


class TestDurationJsonRoundtrip:
    """Tests for Duration JSON roundtrip."""

    def test_duration_days_roundtrip(self):
        """Duration with days roundtrip."""
        d = Duration(days=5)
        data = d.to_json()
        restored = Duration.from_json(data)
        assert restored == d

    def test_duration_time_roundtrip(self):
        """Duration with time components roundtrip."""
        d = Duration(days=1, seconds=9000)
        data = d.to_json()
        restored = Duration.from_json(data)
        assert restored == d

    def test_duration_nanoseconds_roundtrip(self):
        """Duration with nanoseconds roundtrip."""
        d = Duration(nanoseconds=123_456_789)
        data = d.to_json()
        restored = Duration.from_json(data)
        assert restored == d

    def test_duration_negative_roundtrip(self):
        """Negative duration roundtrip."""
        d = Duration(days=-1, seconds=3600)
        data = d.to_json()
        restored = Duration.from_json(data)
        assert restored == d


class TestFromJsonErrors:
    """Tests for from_json error handling."""

    def test_from_json_not_dict(self):
        """from_json with non-dict raises ParseError."""
        with pytest.raises(ParseError, match="expected dict"):
            from_json("not a dict")

    def test_from_json_missing_type(self):
        """Missing _type field raises ParseError."""
        with pytest.raises(ParseError, match="missing '_type'"):
            from_json({"value": "2024-01-15"})

    def test_from_json_unknown_type(self):
        """Unknown _type raises TypeError."""
        with pytest.raises(TypeError, match="unknown temporal type"):
            from_json({"_type": "UnknownType", "value": "foo"})


class TestEpochConversions:
    """Tests for epoch conversion functions."""

    def test_to_unix_seconds_utc(self):
        """DateTime at Unix epoch to seconds."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, timezone=Timezone.utc())
        assert to_unix_seconds(dt) == 0

    def test_to_unix_seconds_later(self):
        """Later datetime to Unix seconds."""
        dt = DateTime(2024, 1, 15, 12, 30, 0, timezone=Timezone.utc())
        result = to_unix_seconds(dt)
        # 2024-01-15 12:30:00 UTC
        assert result > 0

    def test_from_unix_seconds_epoch(self):
        """Create DateTime from Unix epoch."""
        dt = from_unix_seconds(0, timezone=Timezone.utc())
        assert dt.year == 1970
        assert dt.month == 1
        assert dt.day == 1
        assert dt.hour == 0
        assert dt.timezone.is_utc

    def test_unix_seconds_roundtrip(self):
        """Unix seconds roundtrip."""
        dt = DateTime(2024, 1, 15, 12, 30, 0, timezone=Timezone.utc())
        ts = to_unix_seconds(dt)
        restored = from_unix_seconds(ts, timezone=Timezone.utc())
        # Roundtrip loses subsecond precision
        assert restored.year == dt.year
        assert restored.hour == dt.hour

    def test_to_unix_millis(self):
        """DateTime to Unix milliseconds."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, nanosecond=500_000_000, timezone=Timezone.utc())
        assert to_unix_millis(dt) == 500

    def test_from_unix_millis(self):
        """Create DateTime from Unix milliseconds."""
        dt = from_unix_millis(500, timezone=Timezone.utc())
        assert dt.millisecond == 500

    def test_unix_millis_roundtrip(self):
        """Unix milliseconds roundtrip."""
        dt = DateTime(2024, 1, 15, 12, 30, 0, nanosecond=123_000_000, timezone=Timezone.utc())
        ts = to_unix_millis(dt)
        restored = from_unix_millis(ts, timezone=Timezone.utc())
        # Roundtrip preserves milliseconds but loses sub-millisecond precision
        assert restored.millisecond == dt.millisecond

    def test_to_unix_nanos(self):
        """DateTime to Unix nanoseconds."""
        dt = DateTime(1970, 1, 1, 0, 0, 0, nanosecond=123, timezone=Timezone.utc())
        assert to_unix_nanos(dt) == 123

    def test_from_unix_nanos(self):
        """Create DateTime from Unix nanoseconds."""
        dt = from_unix_nanos(123_456_789, timezone=Timezone.utc())
        assert dt.nanosecond == 123_456_789

    def test_unix_nanos_roundtrip(self):
        """Unix nanoseconds roundtrip."""
        dt = DateTime(2024, 1, 15, 12, 30, 0, nanosecond=123_456_789, timezone=Timezone.utc())
        ts = to_unix_nanos(dt)
        restored = from_unix_nanos(ts, timezone=Timezone.utc())
        assert restored.nanosecond == dt.nanosecond


class TestToJsonTypeError:
    """Test to_json() type errors."""

    def test_to_json_wrong_type(self):
        """to_json with wrong type raises TypeError."""
        with pytest.raises(TypeError, match="expected Date, Time, DateTime, or Duration"):
            to_json("not a temporal object")

    def test_to_json_none(self):
        """to_json with None raises TypeError."""
        with pytest.raises(TypeError, match="expected Date, Time, DateTime, or Duration"):
            to_json(None)


class TestPolymorphicDeserialization:
    """Tests for polymorphic deserialization via from_json."""

    def test_deserialize_datetime(self):
        """from_json correctly identifies DateTime."""
        data = {"_type": "DateTime", "value": "2024-01-15T14:30:45"}
        result = from_json(data)
        assert isinstance(result, DateTime)

    def test_deserialize_date(self):
        """from_json correctly identifies Date."""
        data = {"_type": "Date", "value": "2024-01-15"}
        result = from_json(data)
        assert isinstance(result, Date)

    def test_deserialize_time(self):
        """from_json correctly identifies Time."""
        data = {"_type": "Time", "value": "14:30:45"}
        result = from_json(data)
        assert isinstance(result, Time)

    def test_deserialize_duration(self):
        """from_json correctly identifies Duration."""
        data = {"_type": "Duration", "value": "P1D", "total_nanos": 86400 * 10**9}
        result = from_json(data)
        assert isinstance(result, Duration)
