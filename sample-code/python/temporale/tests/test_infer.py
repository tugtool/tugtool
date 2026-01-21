"""Tests for flexible format inference module.

Tests the parse_fuzzy function and related types for detecting
and parsing various date/time formats.
"""

from __future__ import annotations

import pytest

from temporale import Date, DateTime, Time
from temporale.errors import ParseError
from temporale.infer import DateOrder, InferOptions, ParseResult, parse_fuzzy


class TestParseResultType:
    """Tests for ParseResult dataclass."""

    def test_parse_result_is_frozen(self) -> None:
        """ParseResult should be immutable."""
        result = parse_fuzzy("2024-01-15")
        with pytest.raises(AttributeError):
            result.confidence = 0.5  # type: ignore[misc]

    def test_parse_result_has_required_fields(self) -> None:
        """ParseResult should have value, format_detected, confidence."""
        result = parse_fuzzy("2024-01-15")
        assert hasattr(result, "value")
        assert hasattr(result, "format_detected")
        assert hasattr(result, "confidence")


class TestInferOptions:
    """Tests for InferOptions configuration."""

    def test_default_options(self) -> None:
        """Default InferOptions should use YMD order."""
        opts = InferOptions()
        assert opts.date_order == DateOrder.YMD
        assert opts.prefer_future is False
        assert opts.default_century == 2000

    def test_custom_date_order(self) -> None:
        """InferOptions should accept custom date order."""
        opts = InferOptions(date_order=DateOrder.DMY)
        assert opts.date_order == DateOrder.DMY

    def test_custom_century(self) -> None:
        """InferOptions should accept custom default century."""
        opts = InferOptions(default_century=1900)
        assert opts.default_century == 1900


class TestDateOrderEnum:
    """Tests for DateOrder enum."""

    def test_ymd_value(self) -> None:
        """DateOrder.YMD should have value 'YMD'."""
        assert DateOrder.YMD.value == "YMD"

    def test_mdy_value(self) -> None:
        """DateOrder.MDY should have value 'MDY'."""
        assert DateOrder.MDY.value == "MDY"

    def test_dmy_value(self) -> None:
        """DateOrder.DMY should have value 'DMY'."""
        assert DateOrder.DMY.value == "DMY"


class TestISODateParsing:
    """Tests for ISO 8601 date format parsing."""

    def test_iso_date_basic(self) -> None:
        """Should parse basic ISO date YYYY-MM-DD."""
        result = parse_fuzzy("2024-01-15")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)
        assert result.format_detected == "iso_date"
        assert result.confidence == 1.0

    def test_iso_date_negative_year(self) -> None:
        """Should parse ISO date with negative year (BCE)."""
        result = parse_fuzzy("-0044-03-15")
        assert isinstance(result.value, Date)
        assert result.value.year == -44
        assert result.value.month == 3
        assert result.value.day == 15

    def test_iso_date_leap_year(self) -> None:
        """Should parse Feb 29 in leap year."""
        result = parse_fuzzy("2024-02-29")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 2, 29)

    def test_iso_date_end_of_year(self) -> None:
        """Should parse December 31."""
        result = parse_fuzzy("2024-12-31")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 12, 31)


class TestSlashSeparatedDates:
    """Tests for slash-separated date parsing with different orders."""

    def test_slash_ymd_with_4digit_year_first(self) -> None:
        """Slash date with 4-digit year first should be YMD."""
        result = parse_fuzzy("2024/01/15")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)
        assert result.confidence >= 0.9  # High confidence for unambiguous

    def test_slash_mdy_order(self) -> None:
        """Slash date with MDY order option."""
        opts = InferOptions(date_order=DateOrder.MDY)
        result = parse_fuzzy("01/15/2024", opts)
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_slash_dmy_order(self) -> None:
        """Slash date with DMY order option."""
        opts = InferOptions(date_order=DateOrder.DMY)
        result = parse_fuzzy("15/01/2024", opts)
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_slash_ambiguous_with_mdy(self) -> None:
        """Ambiguous slash date with MDY order."""
        opts = InferOptions(date_order=DateOrder.MDY)
        result = parse_fuzzy("01/02/2024", opts)
        assert isinstance(result.value, Date)
        # MDY: month=1, day=2
        assert result.value.month == 1
        assert result.value.day == 2

    def test_slash_ambiguous_with_dmy(self) -> None:
        """Ambiguous slash date with DMY order."""
        opts = InferOptions(date_order=DateOrder.DMY)
        result = parse_fuzzy("01/02/2024", opts)
        assert isinstance(result.value, Date)
        # DMY: day=1, month=2
        assert result.value.day == 1
        assert result.value.month == 2


class TestDashSeparatedDates:
    """Tests for non-ISO dash-separated dates (MM-DD-YYYY)."""

    def test_dash_mdy_format(self) -> None:
        """Dash date MM-DD-YYYY with default MDY."""
        result = parse_fuzzy("01-15-2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_dash_dmy_order(self) -> None:
        """Dash date DD-MM-YYYY with DMY order."""
        opts = InferOptions(date_order=DateOrder.DMY)
        result = parse_fuzzy("15-01-2024", opts)
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)


class TestDotSeparatedDates:
    """Tests for dot-separated dates (DD.MM.YYYY European style)."""

    def test_dot_date_european(self) -> None:
        """Dot date assumes European DMY order."""
        result = parse_fuzzy("15.01.2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_dot_date_month_boundary(self) -> None:
        """Dot date at month boundary."""
        result = parse_fuzzy("31.12.2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 12, 31)


class TestNamedMonthParsing:
    """Tests for named month format parsing."""

    def test_named_month_mdy_short(self) -> None:
        """Jan 15, 2024 format."""
        result = parse_fuzzy("Jan 15, 2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)
        assert result.format_detected == "named_month_mdy"
        assert result.confidence >= 0.9

    def test_named_month_mdy_full(self) -> None:
        """January 15, 2024 format."""
        result = parse_fuzzy("January 15, 2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_named_month_dmy_short(self) -> None:
        """15 Jan 2024 format."""
        result = parse_fuzzy("15 Jan 2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)
        assert result.format_detected == "named_month_dmy"

    def test_named_month_dmy_full(self) -> None:
        """15 January 2024 format."""
        result = parse_fuzzy("15 January 2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)

    def test_named_month_all_months(self) -> None:
        """Test parsing all month names."""
        months = [
            ("Jan", 1),
            ("Feb", 2),
            ("Mar", 3),
            ("Apr", 4),
            ("May", 5),
            ("Jun", 6),
            ("Jul", 7),
            ("Aug", 8),
            ("Sep", 9),
            ("Oct", 10),
            ("Nov", 11),
            ("Dec", 12),
        ]
        for name, expected_month in months:
            result = parse_fuzzy(f"{name} 15, 2024")
            assert result.value.month == expected_month, f"Failed for {name}"

    def test_named_month_case_insensitive(self) -> None:
        """Month names should be case insensitive."""
        for name in ["jan", "JAN", "Jan", "JANUARY", "january"]:
            result = parse_fuzzy(f"{name} 15, 2024")
            assert result.value.month == 1

    def test_named_month_with_period(self) -> None:
        """Jan. 15, 2024 format with period after month."""
        result = parse_fuzzy("Jan. 15, 2024")
        assert isinstance(result.value, Date)
        assert result.value == Date(2024, 1, 15)


class TestTimeParsing:
    """Tests for time-only format parsing."""

    def test_iso_time_basic(self) -> None:
        """Should parse ISO time HH:MM:SS."""
        result = parse_fuzzy("14:30:45")
        assert isinstance(result.value, Time)
        assert result.value == Time(14, 30, 45)
        assert result.format_detected == "iso_time"
        assert result.confidence == 1.0

    def test_iso_time_with_subseconds(self) -> None:
        """Should parse ISO time with fractional seconds."""
        result = parse_fuzzy("14:30:45.123")
        assert isinstance(result.value, Time)
        assert result.value.hour == 14
        assert result.value.minute == 30
        assert result.value.second == 45
        assert result.value.nanosecond == 123000000

    def test_iso_time_with_nanos(self) -> None:
        """Should parse ISO time with nanoseconds."""
        result = parse_fuzzy("14:30:45.123456789")
        assert isinstance(result.value, Time)
        assert result.value.nanosecond == 123456789

    def test_short_time(self) -> None:
        """Should parse short time HH:MM."""
        result = parse_fuzzy("14:30")
        assert isinstance(result.value, Time)
        assert result.value == Time(14, 30, 0)
        assert result.format_detected == "short_time"

    def test_time_ampm_pm(self) -> None:
        """Should parse 12-hour time with PM."""
        result = parse_fuzzy("2:30 PM")
        assert isinstance(result.value, Time)
        assert result.value.hour == 14
        assert result.value.minute == 30

    def test_time_ampm_am(self) -> None:
        """Should parse 12-hour time with AM."""
        result = parse_fuzzy("2:30 AM")
        assert isinstance(result.value, Time)
        assert result.value.hour == 2
        assert result.value.minute == 30

    def test_time_ampm_noon(self) -> None:
        """12:00 PM should be noon (12:00)."""
        result = parse_fuzzy("12:00 PM")
        assert isinstance(result.value, Time)
        assert result.value.hour == 12

    def test_time_ampm_midnight(self) -> None:
        """12:00 AM should be midnight (00:00)."""
        result = parse_fuzzy("12:00 AM")
        assert isinstance(result.value, Time)
        assert result.value.hour == 0

    def test_time_ampm_with_seconds(self) -> None:
        """Should parse 12-hour time with seconds."""
        result = parse_fuzzy("2:30:45 PM")
        assert isinstance(result.value, Time)
        assert result.value.hour == 14
        assert result.value.minute == 30
        assert result.value.second == 45

    def test_time_ampm_lowercase(self) -> None:
        """Should accept lowercase am/pm."""
        result = parse_fuzzy("2:30 pm")
        assert isinstance(result.value, Time)
        assert result.value.hour == 14


class TestDateTimeParsing:
    """Tests for combined datetime format parsing."""

    def test_iso_datetime_basic(self) -> None:
        """Should parse ISO datetime YYYY-MM-DDTHH:MM:SS."""
        result = parse_fuzzy("2024-01-15T14:30:45")
        assert isinstance(result.value, DateTime)
        assert result.value.year == 2024
        assert result.value.month == 1
        assert result.value.day == 15
        assert result.value.hour == 14
        assert result.value.minute == 30
        assert result.value.second == 45
        assert result.format_detected == "iso_datetime"

    def test_iso_datetime_with_subseconds(self) -> None:
        """Should parse ISO datetime with fractional seconds."""
        result = parse_fuzzy("2024-01-15T14:30:45.123456")
        assert isinstance(result.value, DateTime)
        assert result.value.nanosecond == 123456000

    def test_iso_datetime_with_z(self) -> None:
        """Should parse ISO datetime with Z timezone."""
        result = parse_fuzzy("2024-01-15T14:30:45Z")
        assert isinstance(result.value, DateTime)
        assert result.value.timezone is not None
        assert result.value.timezone.is_utc

    def test_iso_datetime_with_offset(self) -> None:
        """Should parse ISO datetime with timezone offset."""
        result = parse_fuzzy("2024-01-15T14:30:45+05:30")
        assert isinstance(result.value, DateTime)
        assert result.value.timezone is not None
        assert result.value.timezone.offset_seconds == 5 * 3600 + 30 * 60

    def test_iso_datetime_with_negative_offset(self) -> None:
        """Should parse ISO datetime with negative offset."""
        result = parse_fuzzy("2024-01-15T14:30:45-08:00")
        assert isinstance(result.value, DateTime)
        assert result.value.timezone is not None
        assert result.value.timezone.offset_seconds == -8 * 3600

    def test_iso_datetime_space_separator(self) -> None:
        """Should parse datetime with space separator."""
        result = parse_fuzzy("2024-01-15 14:30:45")
        assert isinstance(result.value, DateTime)
        assert result.value.year == 2024
        assert result.value.hour == 14

    def test_named_datetime_with_ampm(self) -> None:
        """Should parse named month datetime with AM/PM."""
        result = parse_fuzzy("Jan 15, 2024 2:30 PM")
        assert isinstance(result.value, DateTime)
        assert result.value.year == 2024
        assert result.value.month == 1
        assert result.value.day == 15
        assert result.value.hour == 14
        assert result.value.minute == 30


class TestConfidenceScores:
    """Tests for confidence score behavior."""

    def test_iso_format_highest_confidence(self) -> None:
        """ISO format should have confidence 1.0."""
        result = parse_fuzzy("2024-01-15")
        assert result.confidence == 1.0

    def test_named_month_high_confidence(self) -> None:
        """Named month format should have high confidence."""
        result = parse_fuzzy("Jan 15, 2024")
        assert result.confidence >= 0.9

    def test_ambiguous_format_lower_confidence(self) -> None:
        """Ambiguous slash format should have lower confidence."""
        result = parse_fuzzy("01/15/2024")
        assert result.confidence < 1.0
        assert result.confidence >= 0.7


class TestErrorHandling:
    """Tests for error handling."""

    def test_empty_string_raises_error(self) -> None:
        """Empty string should raise ParseError."""
        with pytest.raises(ParseError, match="empty string"):
            parse_fuzzy("")

    def test_whitespace_only_raises_error(self) -> None:
        """Whitespace-only string should raise ParseError."""
        with pytest.raises(ParseError, match="empty string"):
            parse_fuzzy("   ")

    def test_invalid_format_raises_error(self) -> None:
        """Unrecognized format should raise ParseError."""
        with pytest.raises(ParseError, match="cannot determine format"):
            parse_fuzzy("not-a-date")

    def test_garbage_input_raises_error(self) -> None:
        """Random garbage should raise ParseError."""
        with pytest.raises(ParseError):
            parse_fuzzy("xyzzy12345")


class TestEdgeCases:
    """Tests for edge cases and special inputs."""

    def test_leading_whitespace(self) -> None:
        """Should handle leading whitespace."""
        result = parse_fuzzy("  2024-01-15")
        assert result.value == Date(2024, 1, 15)

    def test_trailing_whitespace(self) -> None:
        """Should handle trailing whitespace."""
        result = parse_fuzzy("2024-01-15  ")
        assert result.value == Date(2024, 1, 15)

    def test_single_digit_month_and_day(self) -> None:
        """Should handle single digit month and day in slash format."""
        opts = InferOptions(date_order=DateOrder.MDY)
        result = parse_fuzzy("1/5/2024", opts)
        assert result.value == Date(2024, 1, 5)

    def test_lowercase_t_separator(self) -> None:
        """Should accept lowercase 't' as datetime separator."""
        result = parse_fuzzy("2024-01-15t14:30:45")
        assert isinstance(result.value, DateTime)
        assert result.value.hour == 14

    def test_zero_padded_time(self) -> None:
        """Should parse zero-padded time components."""
        result = parse_fuzzy("01:05:09")
        assert isinstance(result.value, Time)
        assert result.value.hour == 1
        assert result.value.minute == 5
        assert result.value.second == 9
