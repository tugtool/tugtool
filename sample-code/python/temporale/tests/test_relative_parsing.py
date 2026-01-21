"""Tests for relative and natural date parsing.

Tests the parse_relative() function that handles expressions like
"yesterday", "next Monday", "3 days ago", etc.
"""

from __future__ import annotations

import pytest

from temporale import Date, DateTime, ParseError
from temporale.infer import parse_relative


# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def monday_ref() -> DateTime:
    """Reference DateTime that is a Monday (2024-01-15)."""
    return DateTime(2024, 1, 15, 12, 0, 0)  # Monday


@pytest.fixture
def friday_ref() -> DateTime:
    """Reference DateTime that is a Friday (2024-01-19)."""
    return DateTime(2024, 1, 19, 12, 0, 0)  # Friday


@pytest.fixture
def saturday_ref() -> DateTime:
    """Reference DateTime that is a Saturday (2024-01-20)."""
    return DateTime(2024, 1, 20, 12, 0, 0)  # Saturday


# -----------------------------------------------------------------------------
# Day Keywords: today, yesterday, tomorrow
# -----------------------------------------------------------------------------


class TestDayKeywords:
    """Test day keyword parsing (today, yesterday, tomorrow)."""

    def test_today(self, monday_ref: DateTime) -> None:
        """Test 'today' returns the reference date."""
        result = parse_relative("today", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 15)

    def test_today_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test 'TODAY' and 'Today' work."""
        assert parse_relative("TODAY", monday_ref) == Date(2024, 1, 15)
        assert parse_relative("Today", monday_ref) == Date(2024, 1, 15)

    def test_yesterday(self, monday_ref: DateTime) -> None:
        """Test 'yesterday' returns one day before reference."""
        result = parse_relative("yesterday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 14)

    def test_yesterday_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test 'YESTERDAY' and 'Yesterday' work."""
        assert parse_relative("YESTERDAY", monday_ref) == Date(2024, 1, 14)
        assert parse_relative("Yesterday", monday_ref) == Date(2024, 1, 14)

    def test_tomorrow(self, monday_ref: DateTime) -> None:
        """Test 'tomorrow' returns one day after reference."""
        result = parse_relative("tomorrow", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 16)

    def test_tomorrow_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test 'TOMORROW' and 'Tomorrow' work."""
        assert parse_relative("TOMORROW", monday_ref) == Date(2024, 1, 16)
        assert parse_relative("Tomorrow", monday_ref) == Date(2024, 1, 16)

    def test_today_with_whitespace(self, monday_ref: DateTime) -> None:
        """Test keywords with leading/trailing whitespace."""
        assert parse_relative("  today  ", monday_ref) == Date(2024, 1, 15)
        assert parse_relative("\tyesterday\n", monday_ref) == Date(2024, 1, 14)


# -----------------------------------------------------------------------------
# Weekday References
# -----------------------------------------------------------------------------


class TestWeekdayReferences:
    """Test weekday reference parsing (Monday, next Tuesday, last Friday)."""

    def test_next_monday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'next Monday' from a Monday goes to the following Monday."""
        result = parse_relative("next Monday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 22)  # Following Monday

    def test_next_friday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'next Friday' from Monday goes to the coming Friday."""
        result = parse_relative("next Friday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 19)  # Same week Friday

    def test_last_friday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'last Friday' from Monday goes to the previous Friday."""
        result = parse_relative("last Friday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 12)  # Previous Friday

    def test_last_monday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'last Monday' from Monday goes to the previous Monday."""
        result = parse_relative("last Monday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 8)  # Previous Monday

    def test_this_monday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'this Monday' from Monday returns the same day."""
        result = parse_relative("this Monday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 15)  # Same day

    def test_this_friday_from_monday(self, monday_ref: DateTime) -> None:
        """Test 'this Friday' from Monday returns Friday of same week."""
        result = parse_relative("this Friday", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 19)  # Friday of same week

    def test_this_sunday_from_friday(self, friday_ref: DateTime) -> None:
        """Test 'this Sunday' from Friday returns Sunday of same week."""
        result = parse_relative("this Sunday", friday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 21)  # Sunday of same week

    def test_this_monday_from_friday(self, friday_ref: DateTime) -> None:
        """Test 'this Monday' from Friday returns Monday of same week (in past)."""
        result = parse_relative("this Monday", friday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 15)  # Monday of same week

    def test_next_saturday_from_saturday(self, saturday_ref: DateTime) -> None:
        """Test 'next Saturday' from Saturday goes to following Saturday."""
        result = parse_relative("next Saturday", saturday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 27)  # Next Saturday

    def test_last_saturday_from_saturday(self, saturday_ref: DateTime) -> None:
        """Test 'last Saturday' from Saturday goes to previous Saturday."""
        result = parse_relative("last Saturday", saturday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 13)  # Previous Saturday

    def test_weekday_abbreviations(self, monday_ref: DateTime) -> None:
        """Test weekday abbreviations work correctly."""
        assert parse_relative("next Mon", monday_ref) == Date(2024, 1, 22)
        assert parse_relative("next Tue", monday_ref) == Date(2024, 1, 16)
        assert parse_relative("next Wed", monday_ref) == Date(2024, 1, 17)
        assert parse_relative("next Thu", monday_ref) == Date(2024, 1, 18)
        assert parse_relative("next Fri", monday_ref) == Date(2024, 1, 19)
        assert parse_relative("next Sat", monday_ref) == Date(2024, 1, 20)
        assert parse_relative("next Sun", monday_ref) == Date(2024, 1, 21)

    def test_weekday_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test weekday names are case-insensitive."""
        assert parse_relative("NEXT FRIDAY", monday_ref) == Date(2024, 1, 19)
        assert parse_relative("Next Friday", monday_ref) == Date(2024, 1, 19)
        assert parse_relative("next friday", monday_ref) == Date(2024, 1, 19)


# -----------------------------------------------------------------------------
# Duration Phrases
# -----------------------------------------------------------------------------


class TestDurationPhrases:
    """Test duration phrase parsing (N days/weeks ago, in N days/weeks)."""

    def test_days_ago(self, monday_ref: DateTime) -> None:
        """Test 'N days ago' returns correct date."""
        result = parse_relative("3 days ago", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 12)

    def test_one_day_ago(self, monday_ref: DateTime) -> None:
        """Test '1 day ago' returns yesterday."""
        result = parse_relative("1 day ago", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 14)

    def test_weeks_ago(self, monday_ref: DateTime) -> None:
        """Test 'N weeks ago' returns correct date."""
        result = parse_relative("2 weeks ago", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 1)

    def test_in_days(self, monday_ref: DateTime) -> None:
        """Test 'in N days' returns correct future date."""
        result = parse_relative("in 5 days", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 20)

    def test_in_weeks(self, monday_ref: DateTime) -> None:
        """Test 'in N weeks' returns correct future date."""
        result = parse_relative("in 2 weeks", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 29)

    def test_days_from_now(self, monday_ref: DateTime) -> None:
        """Test 'N days from now' returns correct future date."""
        result = parse_relative("3 days from now", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 18)

    def test_weeks_from_now(self, monday_ref: DateTime) -> None:
        """Test 'N weeks from now' returns correct future date."""
        result = parse_relative("1 week from now", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 22)

    def test_months_ago(self, monday_ref: DateTime) -> None:
        """Test 'N months ago' returns correct date."""
        result = parse_relative("2 months ago", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2023, 11, 15)

    def test_in_months(self, monday_ref: DateTime) -> None:
        """Test 'in N months' returns correct future date."""
        result = parse_relative("in 3 months", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 4, 15)

    def test_years_ago(self, monday_ref: DateTime) -> None:
        """Test 'N years ago' returns correct date."""
        result = parse_relative("5 years ago", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2019, 1, 15)

    def test_in_years(self, monday_ref: DateTime) -> None:
        """Test 'in N years' returns correct future date."""
        result = parse_relative("in 1 year", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2025, 1, 15)

    def test_duration_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test duration phrases are case-insensitive."""
        assert parse_relative("3 DAYS AGO", monday_ref) == Date(2024, 1, 12)
        assert parse_relative("IN 5 Days", monday_ref) == Date(2024, 1, 20)

    def test_hours_ago(self, monday_ref: DateTime) -> None:
        """Test 'N hours ago' returns DateTime."""
        result = parse_relative("3 hours ago", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 9, 0, 0)

    def test_in_hours(self, monday_ref: DateTime) -> None:
        """Test 'in N hours' returns DateTime."""
        result = parse_relative("in 2 hours", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 14, 0, 0)

    def test_minutes_ago(self, monday_ref: DateTime) -> None:
        """Test 'N minutes ago' returns DateTime."""
        result = parse_relative("30 minutes ago", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 11, 30, 0)


# -----------------------------------------------------------------------------
# Period Keywords
# -----------------------------------------------------------------------------


class TestPeriodKeywords:
    """Test period keyword parsing (next week, last month, etc.)."""

    def test_next_week(self, monday_ref: DateTime) -> None:
        """Test 'next week' returns 7 days in future."""
        result = parse_relative("next week", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 22)

    def test_last_week(self, monday_ref: DateTime) -> None:
        """Test 'last week' returns 7 days in past."""
        result = parse_relative("last week", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 1, 8)

    def test_next_month(self, monday_ref: DateTime) -> None:
        """Test 'next month' adds one month."""
        result = parse_relative("next month", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2024, 2, 15)

    def test_last_month(self, monday_ref: DateTime) -> None:
        """Test 'last month' subtracts one month."""
        result = parse_relative("last month", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2023, 12, 15)

    def test_next_year(self, monday_ref: DateTime) -> None:
        """Test 'next year' adds one year."""
        result = parse_relative("next year", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2025, 1, 15)

    def test_last_year(self, monday_ref: DateTime) -> None:
        """Test 'last year' subtracts one year."""
        result = parse_relative("last year", monday_ref)
        assert isinstance(result, Date)
        assert result == Date(2023, 1, 15)

    def test_period_case_insensitive(self, monday_ref: DateTime) -> None:
        """Test period keywords are case-insensitive."""
        assert parse_relative("NEXT MONTH", monday_ref) == Date(2024, 2, 15)
        assert parse_relative("Last Year", monday_ref) == Date(2023, 1, 15)


# -----------------------------------------------------------------------------
# Custom Reference DateTime
# -----------------------------------------------------------------------------


class TestCustomReference:
    """Test that custom reference DateTime works correctly."""

    def test_custom_reference_today(self) -> None:
        """Test 'today' with custom reference returns that date."""
        ref = DateTime(2023, 6, 15, 10, 30, 0)
        result = parse_relative("today", ref)
        assert result == Date(2023, 6, 15)

    def test_custom_reference_yesterday(self) -> None:
        """Test 'yesterday' with custom reference."""
        ref = DateTime(2023, 6, 15, 10, 30, 0)
        result = parse_relative("yesterday", ref)
        assert result == Date(2023, 6, 14)

    def test_custom_reference_weekday(self) -> None:
        """Test weekday reference with custom reference date."""
        # June 15, 2023 is a Thursday
        ref = DateTime(2023, 6, 15, 10, 30, 0)
        result = parse_relative("next Monday", ref)
        # Next Monday is June 19, 2023
        assert result == Date(2023, 6, 19)

    def test_custom_reference_duration(self) -> None:
        """Test duration phrase with custom reference."""
        ref = DateTime(2023, 6, 15, 10, 30, 0)
        result = parse_relative("3 days ago", ref)
        assert result == Date(2023, 6, 12)


# -----------------------------------------------------------------------------
# Combination with Time
# -----------------------------------------------------------------------------


class TestCombinationWithTime:
    """Test relative expressions combined with time."""

    def test_tomorrow_at_3pm(self, monday_ref: DateTime) -> None:
        """Test 'tomorrow at 3pm' returns DateTime."""
        result = parse_relative("tomorrow at 3pm", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 16, 15, 0, 0)

    def test_today_at_9am(self, monday_ref: DateTime) -> None:
        """Test 'today at 9am' returns DateTime."""
        result = parse_relative("today at 9am", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 9, 0, 0)

    def test_yesterday_at_midnight(self, monday_ref: DateTime) -> None:
        """Test 'yesterday at 12am' returns DateTime at midnight."""
        result = parse_relative("yesterday at 12am", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 14, 0, 0, 0)

    def test_yesterday_at_noon(self, monday_ref: DateTime) -> None:
        """Test 'yesterday at 12pm' returns DateTime at noon."""
        result = parse_relative("yesterday at 12pm", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 14, 12, 0, 0)

    def test_next_monday_at_930(self, monday_ref: DateTime) -> None:
        """Test 'next Monday at 9:30' returns DateTime."""
        result = parse_relative("next Monday at 9:30", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 22, 9, 30, 0)

    def test_3_days_ago_at_2pm(self, monday_ref: DateTime) -> None:
        """Test '3 days ago at 2pm' returns DateTime."""
        result = parse_relative("3 days ago at 2pm", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 12, 14, 0, 0)

    def test_in_2_weeks_at_10_30_am(self, monday_ref: DateTime) -> None:
        """Test 'in 2 weeks at 10:30 AM' returns DateTime."""
        result = parse_relative("in 2 weeks at 10:30 AM", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 29, 10, 30, 0)

    def test_next_friday_at_5_30_pm(self, monday_ref: DateTime) -> None:
        """Test 'next Friday at 5:30 PM' returns DateTime."""
        result = parse_relative("next Friday at 5:30 PM", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 19, 17, 30, 0)

    def test_time_with_24_hour_format(self, monday_ref: DateTime) -> None:
        """Test time in 24-hour format."""
        result = parse_relative("tomorrow at 14:30", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 16, 14, 30, 0)

    def test_time_with_seconds(self, monday_ref: DateTime) -> None:
        """Test time with seconds specified."""
        result = parse_relative("today at 10:30:45", monday_ref)
        assert isinstance(result, DateTime)
        assert result == DateTime(2024, 1, 15, 10, 30, 45)


# -----------------------------------------------------------------------------
# Edge Cases
# -----------------------------------------------------------------------------


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_next_weekday_on_that_weekday(self, monday_ref: DateTime) -> None:
        """Test 'next Monday' on a Monday skips to next week."""
        # monday_ref is Monday Jan 15, 2024
        result = parse_relative("next Monday", monday_ref)
        assert result == Date(2024, 1, 22)  # Next Monday, not same day

    def test_last_weekday_on_that_weekday(self, monday_ref: DateTime) -> None:
        """Test 'last Monday' on a Monday goes to previous week."""
        result = parse_relative("last Monday", monday_ref)
        assert result == Date(2024, 1, 8)  # Previous Monday

    def test_this_weekday_on_that_weekday(self, monday_ref: DateTime) -> None:
        """Test 'this Monday' on a Monday returns same day."""
        result = parse_relative("this Monday", monday_ref)
        assert result == Date(2024, 1, 15)  # Same day

    def test_month_boundary_next_month(self) -> None:
        """Test 'next month' from end of month handles clamping."""
        ref = DateTime(2024, 1, 31, 12, 0, 0)
        result = parse_relative("next month", ref)
        # Jan 31 + 1 month -> Feb 29 (2024 is leap year)
        assert result == Date(2024, 2, 29)

    def test_month_boundary_last_month(self) -> None:
        """Test 'last month' from end of month handles clamping."""
        ref = DateTime(2024, 3, 31, 12, 0, 0)
        result = parse_relative("last month", ref)
        # Mar 31 - 1 month -> Feb 29 (2024 is leap year)
        assert result == Date(2024, 2, 29)

    def test_year_boundary_yesterday(self) -> None:
        """Test 'yesterday' on Jan 1 goes to previous year."""
        ref = DateTime(2024, 1, 1, 12, 0, 0)
        result = parse_relative("yesterday", ref)
        assert result == Date(2023, 12, 31)

    def test_year_boundary_tomorrow(self) -> None:
        """Test 'tomorrow' on Dec 31 goes to next year."""
        ref = DateTime(2023, 12, 31, 12, 0, 0)
        result = parse_relative("tomorrow", ref)
        assert result == Date(2024, 1, 1)

    def test_leap_year_feb_29(self) -> None:
        """Test 'next year' from Feb 29 handles clamping."""
        ref = DateTime(2024, 2, 29, 12, 0, 0)
        result = parse_relative("next year", ref)
        # Feb 29, 2024 + 1 year -> Feb 28, 2025 (non-leap year)
        assert result == Date(2025, 2, 28)


# -----------------------------------------------------------------------------
# Error Handling
# -----------------------------------------------------------------------------


class TestErrorHandling:
    """Test error handling for invalid input."""

    def test_empty_string(self, monday_ref: DateTime) -> None:
        """Test empty string raises ParseError."""
        with pytest.raises(ParseError, match="empty string"):
            parse_relative("", monday_ref)

    def test_whitespace_only(self, monday_ref: DateTime) -> None:
        """Test whitespace-only string raises ParseError."""
        with pytest.raises(ParseError, match="empty string"):
            parse_relative("   ", monday_ref)

    def test_invalid_expression(self, monday_ref: DateTime) -> None:
        """Test invalid expression raises ParseError."""
        with pytest.raises(ParseError, match="cannot parse"):
            parse_relative("foobar", monday_ref)

    def test_invalid_weekday(self, monday_ref: DateTime) -> None:
        """Test invalid weekday name raises ParseError."""
        with pytest.raises(ParseError, match="cannot parse"):
            parse_relative("next Funday", monday_ref)

    def test_invalid_duration_unit(self, monday_ref: DateTime) -> None:
        """Test invalid duration unit raises ParseError."""
        with pytest.raises(ParseError, match="cannot parse"):
            parse_relative("3 fortnights ago", monday_ref)


# -----------------------------------------------------------------------------
# Default Reference (uses DateTime.now())
# -----------------------------------------------------------------------------


class TestDefaultReference:
    """Test behavior when no reference is provided (uses DateTime.now())."""

    def test_today_without_reference(self) -> None:
        """Test 'today' without reference uses current date."""
        result = parse_relative("today")
        assert isinstance(result, Date)
        # Just verify it returns a Date, don't check exact value
        # since it depends on when the test runs

    def test_tomorrow_without_reference(self) -> None:
        """Test 'tomorrow' without reference works."""
        result = parse_relative("tomorrow")
        assert isinstance(result, Date)

    def test_3_days_ago_without_reference(self) -> None:
        """Test '3 days ago' without reference works."""
        result = parse_relative("3 days ago")
        assert isinstance(result, Date)
