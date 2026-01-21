"""Tests for the Date class."""

from __future__ import annotations

import pytest

from temporale.core.date import Date
from temporale.core.duration import Duration
from temporale.units.era import Era
from temporale.errors import ValidationError, ParseError


class TestDateConstruction:
    """Tests for Date construction and validation."""

    def test_basic_construction(self) -> None:
        """Test basic date construction."""
        d = Date(2024, 1, 15)
        assert d.year == 2024
        assert d.month == 1
        assert d.day == 15

    def test_construction_first_day_of_year(self) -> None:
        """Test construction of January 1."""
        d = Date(2024, 1, 1)
        assert d.year == 2024
        assert d.month == 1
        assert d.day == 1

    def test_construction_last_day_of_year(self) -> None:
        """Test construction of December 31."""
        d = Date(2024, 12, 31)
        assert d.year == 2024
        assert d.month == 12
        assert d.day == 31

    def test_construction_leap_year_february(self) -> None:
        """Test construction of Feb 29 in leap year."""
        d = Date(2024, 2, 29)
        assert d.year == 2024
        assert d.month == 2
        assert d.day == 29

    def test_construction_non_leap_year_february(self) -> None:
        """Test construction of Feb 28 in non-leap year."""
        d = Date(2023, 2, 28)
        assert d.year == 2023
        assert d.month == 2
        assert d.day == 28

    def test_construction_invalid_month_zero(self) -> None:
        """Test that month 0 raises ValidationError."""
        with pytest.raises(ValidationError, match="month must be between 1 and 12"):
            Date(2024, 0, 1)

    def test_construction_invalid_month_13(self) -> None:
        """Test that month 13 raises ValidationError."""
        with pytest.raises(ValidationError, match="month must be between 1 and 12"):
            Date(2024, 13, 1)

    def test_construction_invalid_day_zero(self) -> None:
        """Test that day 0 raises ValidationError."""
        with pytest.raises(ValidationError, match="day must be between 1 and"):
            Date(2024, 1, 0)

    def test_construction_invalid_day_32(self) -> None:
        """Test that day 32 in January raises ValidationError."""
        with pytest.raises(ValidationError, match="day must be between 1 and 31"):
            Date(2024, 1, 32)

    def test_construction_invalid_feb_30_leap_year(self) -> None:
        """Test that Feb 30 raises ValidationError even in leap year."""
        with pytest.raises(ValidationError, match="day must be between 1 and 29"):
            Date(2024, 2, 30)

    def test_construction_invalid_feb_29_non_leap(self) -> None:
        """Test that Feb 29 raises ValidationError in non-leap year."""
        with pytest.raises(ValidationError, match="day must be between 1 and 28"):
            Date(2023, 2, 29)

    def test_construction_year_limits(self) -> None:
        """Test construction at year limits."""
        # Valid limits
        d_min = Date(-9999, 1, 1)
        assert d_min.year == -9999

        d_max = Date(9999, 12, 31)
        assert d_max.year == 9999

    def test_construction_year_out_of_range(self) -> None:
        """Test that years outside range raise ValidationError."""
        with pytest.raises(ValidationError, match="year must be between"):
            Date(-10000, 1, 1)

        with pytest.raises(ValidationError, match="year must be between"):
            Date(10000, 1, 1)


class TestDateToday:
    """Tests for Date.today() factory method."""

    def test_today_returns_date(self) -> None:
        """Test that today() returns a Date instance."""
        d = Date.today()
        assert isinstance(d, Date)

    def test_today_year_reasonable(self) -> None:
        """Test that today's year is reasonable."""
        d = Date.today()
        assert d.year >= 2024  # Should be at least 2024
        assert d.year <= 9999

    def test_today_month_valid(self) -> None:
        """Test that today's month is valid."""
        d = Date.today()
        assert 1 <= d.month <= 12

    def test_today_day_valid(self) -> None:
        """Test that today's day is valid."""
        d = Date.today()
        assert 1 <= d.day <= 31


class TestDateFromOrdinal:
    """Tests for Date.from_ordinal() factory method."""

    def test_ordinal_1(self) -> None:
        """Test ordinal 1 = 0001-01-01."""
        d = Date.from_ordinal(1)
        assert d.year == 1
        assert d.month == 1
        assert d.day == 1

    def test_ordinal_365(self) -> None:
        """Test ordinal 365 = 0001-12-31."""
        d = Date.from_ordinal(365)
        assert d.year == 1
        assert d.month == 12
        assert d.day == 31

    def test_ordinal_366(self) -> None:
        """Test ordinal 366 = 0002-01-01."""
        d = Date.from_ordinal(366)
        assert d.year == 2
        assert d.month == 1
        assert d.day == 1

    def test_ordinal_roundtrip(self) -> None:
        """Test that to_ordinal and from_ordinal are inverses."""
        for year, month, day in [
            (2024, 1, 15),
            (2000, 2, 29),
            (1, 1, 1),
            (9999, 12, 31),
        ]:
            d = Date(year, month, day)
            ordinal = d.to_ordinal()
            d2 = Date.from_ordinal(ordinal)
            assert d2.year == year
            assert d2.month == month
            assert d2.day == day


class TestDateFromIsoFormat:
    """Tests for Date.from_iso_format() factory method."""

    def test_parse_standard_date(self) -> None:
        """Test parsing a standard date."""
        d = Date.from_iso_format("2024-01-15")
        assert d.year == 2024
        assert d.month == 1
        assert d.day == 15

    def test_parse_year_with_leading_zeros(self) -> None:
        """Test parsing a date with leading zeros in year."""
        d = Date.from_iso_format("0001-01-01")
        assert d.year == 1
        assert d.month == 1
        assert d.day == 1

    def test_parse_negative_year(self) -> None:
        """Test parsing a BCE date."""
        d = Date.from_iso_format("-0044-03-15")
        assert d.year == -44
        assert d.month == 3
        assert d.day == 15

    def test_parse_year_zero(self) -> None:
        """Test parsing year 0 (1 BCE)."""
        d = Date.from_iso_format("0000-06-15")
        assert d.year == 0
        assert d.month == 6
        assert d.day == 15

    def test_parse_invalid_format(self) -> None:
        """Test that invalid format raises ParseError."""
        with pytest.raises(ParseError, match="Invalid ISO 8601 date format"):
            Date.from_iso_format("2024/01/15")

    def test_parse_invalid_month(self) -> None:
        """Test that invalid month raises ValidationError."""
        with pytest.raises(ValidationError, match="month must be between"):
            Date.from_iso_format("2024-13-01")

    def test_parse_invalid_day(self) -> None:
        """Test that invalid day raises ValidationError."""
        with pytest.raises(ValidationError, match="day must be between"):
            Date.from_iso_format("2024-01-32")

    def test_to_iso_format_roundtrip(self) -> None:
        """Test that to_iso_format and from_iso_format are inverses."""
        for date_str in ["2024-01-15", "0001-01-01", "-0044-03-15", "0000-06-15"]:
            d = Date.from_iso_format(date_str)
            assert d.to_iso_format() == date_str


class TestDateProperties:
    """Tests for Date property accessors."""

    def test_year_property(self) -> None:
        """Test year property."""
        assert Date(2024, 6, 15).year == 2024
        assert Date(-44, 3, 15).year == -44
        assert Date(0, 1, 1).year == 0

    def test_month_property(self) -> None:
        """Test month property."""
        assert Date(2024, 1, 15).month == 1
        assert Date(2024, 12, 31).month == 12

    def test_day_property(self) -> None:
        """Test day property."""
        assert Date(2024, 1, 1).day == 1
        assert Date(2024, 1, 31).day == 31

    def test_day_of_week_monday(self) -> None:
        """Test day_of_week for a Monday."""
        # 2024-01-15 is a Monday
        d = Date(2024, 1, 15)
        assert d.day_of_week == 0

    def test_day_of_week_sunday(self) -> None:
        """Test day_of_week for a Sunday."""
        # 2024-01-21 is a Sunday
        d = Date(2024, 1, 21)
        assert d.day_of_week == 6

    def test_day_of_week_range(self) -> None:
        """Test that day_of_week cycles through 0-6."""
        d = Date(2024, 1, 15)  # Monday
        for expected in range(7):
            assert d.day_of_week == expected
            d = d.add_days(1)

    def test_day_of_year_january(self) -> None:
        """Test day_of_year for January dates."""
        assert Date(2024, 1, 1).day_of_year == 1
        assert Date(2024, 1, 31).day_of_year == 31

    def test_day_of_year_december(self) -> None:
        """Test day_of_year for December 31."""
        assert Date(2024, 12, 31).day_of_year == 366  # Leap year
        assert Date(2023, 12, 31).day_of_year == 365  # Non-leap year

    def test_day_of_year_february(self) -> None:
        """Test day_of_year around February."""
        assert Date(2024, 2, 1).day_of_year == 32
        assert Date(2024, 2, 29).day_of_year == 60  # Leap year
        assert Date(2024, 3, 1).day_of_year == 61

    def test_era_ce(self) -> None:
        """Test era property for CE dates."""
        assert Date(2024, 1, 1).era == Era.CE
        assert Date(1, 1, 1).era == Era.CE

    def test_era_bce(self) -> None:
        """Test era property for BCE dates."""
        assert Date(-44, 3, 15).era == Era.BCE
        assert Date(-1, 1, 1).era == Era.BCE
        assert Date(0, 1, 1).era == Era.BCE  # Year 0 is 1 BCE


class TestDateLeapYear:
    """Tests for leap year detection."""

    def test_is_leap_year_divisible_by_4(self) -> None:
        """Test leap years divisible by 4 but not 100."""
        assert Date(2024, 1, 1).is_leap_year is True
        assert Date(2020, 1, 1).is_leap_year is True
        assert Date(2016, 1, 1).is_leap_year is True

    def test_is_leap_year_not_divisible_by_4(self) -> None:
        """Test non-leap years not divisible by 4."""
        assert Date(2023, 1, 1).is_leap_year is False
        assert Date(2021, 1, 1).is_leap_year is False
        assert Date(2019, 1, 1).is_leap_year is False

    def test_is_leap_year_divisible_by_100_not_400(self) -> None:
        """Test years divisible by 100 but not 400 are not leap years."""
        assert Date(1900, 1, 1).is_leap_year is False
        assert Date(1800, 1, 1).is_leap_year is False
        assert Date(2100, 1, 1).is_leap_year is False

    def test_is_leap_year_divisible_by_400(self) -> None:
        """Test years divisible by 400 are leap years."""
        assert Date(2000, 1, 1).is_leap_year is True
        assert Date(1600, 1, 1).is_leap_year is True
        assert Date(2400, 1, 1).is_leap_year is True

    def test_is_leap_year_negative(self) -> None:
        """Test leap year calculation for BCE dates."""
        # -4 is a leap year (5 BCE)
        assert Date(-4, 1, 1).is_leap_year is True
        # -3 is not a leap year
        assert Date(-3, 1, 1).is_leap_year is False
        # Year 0 (1 BCE) is a leap year (divisible by 4)
        assert Date(0, 1, 1).is_leap_year is True


class TestDateBCE:
    """Tests for BCE (Before Common Era) dates."""

    def test_ides_of_march_44_bce(self) -> None:
        """Test the Ides of March, 44 BCE (assassination of Julius Caesar)."""
        d = Date(-44, 3, 15)
        assert d.year == -44
        assert d.month == 3
        assert d.day == 15
        assert d.era == Era.BCE

    def test_year_zero(self) -> None:
        """Test year 0 (1 BCE in astronomical year numbering)."""
        d = Date(0, 6, 15)
        assert d.year == 0
        assert d.era == Era.BCE

    def test_bce_to_ce_transition(self) -> None:
        """Test dates around the BCE/CE transition."""
        d_bce = Date(0, 12, 31)  # Last day of 1 BCE
        d_ce = Date(1, 1, 1)  # First day of 1 CE

        assert d_bce.era == Era.BCE
        assert d_ce.era == Era.CE

        # Difference should be 1 day
        diff = d_ce - d_bce
        assert diff.days == 1

    def test_bce_arithmetic(self) -> None:
        """Test date arithmetic with BCE dates."""
        d = Date(-44, 3, 15)

        # Add days
        d2 = d.add_days(30)
        assert d2.year == -44
        assert d2.month == 4
        assert d2.day == 14

        # Subtract days
        d3 = d.add_days(-30)
        assert d3.year == -44
        assert d3.month == 2
        assert d3.day == 14

    def test_bce_iso_format(self) -> None:
        """Test ISO format output for BCE dates."""
        d = Date(-44, 3, 15)
        assert d.to_iso_format() == "-0044-03-15"

        d2 = Date(-1, 1, 1)
        assert d2.to_iso_format() == "-0001-01-01"

    def test_bce_comparison(self) -> None:
        """Test comparison of BCE dates."""
        d1 = Date(-44, 3, 15)  # 44 BCE
        d2 = Date(-100, 7, 12)  # 100 BCE (earlier)
        d3 = Date(1, 1, 1)  # 1 CE (later)

        assert d2 < d1 < d3
        assert d3 > d1 > d2


class TestDateTransformations:
    """Tests for Date transformation methods."""

    def test_replace_year(self) -> None:
        """Test replacing year component."""
        d = Date(2024, 6, 15)
        d2 = d.replace(year=2025)
        assert d2.year == 2025
        assert d2.month == 6
        assert d2.day == 15

    def test_replace_month(self) -> None:
        """Test replacing month component."""
        d = Date(2024, 6, 15)
        d2 = d.replace(month=12)
        assert d2.year == 2024
        assert d2.month == 12
        assert d2.day == 15

    def test_replace_day(self) -> None:
        """Test replacing day component."""
        d = Date(2024, 6, 15)
        d2 = d.replace(day=1)
        assert d2.year == 2024
        assert d2.month == 6
        assert d2.day == 1

    def test_replace_multiple(self) -> None:
        """Test replacing multiple components."""
        d = Date(2024, 6, 15)
        d2 = d.replace(year=2023, month=2, day=28)
        assert d2.year == 2023
        assert d2.month == 2
        assert d2.day == 28

    def test_replace_invalid_raises(self) -> None:
        """Test that replace with invalid values raises ValidationError."""
        d = Date(2024, 1, 31)
        with pytest.raises(ValidationError):
            d.replace(month=2)  # Feb 31 is invalid

    def test_add_days_positive(self) -> None:
        """Test adding positive days."""
        d = Date(2024, 1, 15)
        d2 = d.add_days(10)
        assert d2.year == 2024
        assert d2.month == 1
        assert d2.day == 25

    def test_add_days_negative(self) -> None:
        """Test adding negative days (subtracting)."""
        d = Date(2024, 1, 15)
        d2 = d.add_days(-20)
        assert d2.year == 2023
        assert d2.month == 12
        assert d2.day == 26

    def test_add_days_month_boundary(self) -> None:
        """Test adding days across month boundary."""
        d = Date(2024, 1, 31)
        d2 = d.add_days(1)
        assert d2.year == 2024
        assert d2.month == 2
        assert d2.day == 1

    def test_add_days_year_boundary(self) -> None:
        """Test adding days across year boundary."""
        d = Date(2024, 12, 31)
        d2 = d.add_days(1)
        assert d2.year == 2025
        assert d2.month == 1
        assert d2.day == 1

    def test_add_months_positive(self) -> None:
        """Test adding positive months."""
        d = Date(2024, 1, 15)
        d2 = d.add_months(2)
        assert d2.year == 2024
        assert d2.month == 3
        assert d2.day == 15

    def test_add_months_negative(self) -> None:
        """Test adding negative months (subtracting)."""
        d = Date(2024, 3, 15)
        d2 = d.add_months(-2)
        assert d2.year == 2024
        assert d2.month == 1
        assert d2.day == 15

    def test_add_months_year_boundary(self) -> None:
        """Test adding months across year boundary."""
        d = Date(2024, 11, 15)
        d2 = d.add_months(3)
        assert d2.year == 2025
        assert d2.month == 2
        assert d2.day == 15

    def test_add_months_day_clamping(self) -> None:
        """Test that day is clamped when resulting month has fewer days."""
        d = Date(2024, 1, 31)
        d2 = d.add_months(1)  # Feb 2024 has 29 days
        assert d2.year == 2024
        assert d2.month == 2
        assert d2.day == 29  # Clamped from 31

        d3 = Date(2023, 1, 31)
        d4 = d3.add_months(1)  # Feb 2023 has 28 days
        assert d4.day == 28  # Clamped from 31

    def test_add_years_positive(self) -> None:
        """Test adding positive years."""
        d = Date(2024, 6, 15)
        d2 = d.add_years(1)
        assert d2.year == 2025
        assert d2.month == 6
        assert d2.day == 15

    def test_add_years_negative(self) -> None:
        """Test adding negative years (subtracting)."""
        d = Date(2024, 6, 15)
        d2 = d.add_years(-10)
        assert d2.year == 2014
        assert d2.month == 6
        assert d2.day == 15

    def test_add_years_leap_day_clamping(self) -> None:
        """Test that Feb 29 is clamped to Feb 28 when moving to non-leap year."""
        d = Date(2024, 2, 29)  # Leap year
        d2 = d.add_years(1)  # 2025 is not a leap year
        assert d2.year == 2025
        assert d2.month == 2
        assert d2.day == 28


class TestDateDurationArithmetic:
    """Tests for arithmetic between Date and Duration."""

    def test_add_duration_days(self) -> None:
        """Test adding a Duration to a Date."""
        d = Date(2024, 1, 15)
        dur = Duration(days=10)
        result = d + dur
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 25

    def test_add_duration_negative_days(self) -> None:
        """Test adding a negative Duration."""
        d = Date(2024, 1, 25)
        dur = Duration(days=-10)
        result = d + dur
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_subtract_duration(self) -> None:
        """Test subtracting a Duration from a Date."""
        d = Date(2024, 1, 25)
        dur = Duration(days=10)
        result = d - dur
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_add_duration_fractional_ignored(self) -> None:
        """Test that fractional day in Duration is ignored for Date arithmetic."""
        d = Date(2024, 1, 15)
        dur = Duration(days=1, seconds=43200)  # 1.5 days
        result = d + dur
        # Only whole days are added
        assert result.day == 16


class TestDateSubtraction:
    """Tests for Date subtraction yielding Duration."""

    def test_subtract_dates_same_month(self) -> None:
        """Test subtracting dates in the same month."""
        d1 = Date(2024, 1, 25)
        d2 = Date(2024, 1, 15)
        diff = d1 - d2
        assert isinstance(diff, Duration)
        assert diff.days == 10

    def test_subtract_dates_different_months(self) -> None:
        """Test subtracting dates in different months."""
        d1 = Date(2024, 3, 1)
        d2 = Date(2024, 2, 1)
        diff = d1 - d2
        assert diff.days == 29  # 2024 is a leap year

    def test_subtract_dates_negative_result(self) -> None:
        """Test subtracting later date from earlier date."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 25)
        diff = d1 - d2
        assert diff.days == -10

    def test_subtract_dates_same_date(self) -> None:
        """Test subtracting same date yields zero Duration."""
        d = Date(2024, 1, 15)
        diff = d - d
        assert diff.days == 0
        assert diff.is_zero

    def test_subtract_dates_across_years(self) -> None:
        """Test subtracting dates across year boundary."""
        d1 = Date(2025, 1, 1)
        d2 = Date(2024, 1, 1)
        diff = d1 - d2
        assert diff.days == 366  # 2024 is a leap year


class TestDateComparison:
    """Tests for Date comparison and ordering."""

    def test_equal_same_date(self) -> None:
        """Test equality of same date."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 15)
        assert d1 == d2

    def test_not_equal_different_date(self) -> None:
        """Test inequality of different dates."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 16)
        assert d1 != d2

    def test_less_than(self) -> None:
        """Test less than comparison."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 16)
        assert d1 < d2
        assert not d2 < d1

    def test_less_than_or_equal(self) -> None:
        """Test less than or equal comparison."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 15)
        d3 = Date(2024, 1, 16)
        assert d1 <= d2
        assert d1 <= d3
        assert not d3 <= d1

    def test_greater_than(self) -> None:
        """Test greater than comparison."""
        d1 = Date(2024, 1, 16)
        d2 = Date(2024, 1, 15)
        assert d1 > d2
        assert not d2 > d1

    def test_greater_than_or_equal(self) -> None:
        """Test greater than or equal comparison."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 15)
        d3 = Date(2024, 1, 14)
        assert d1 >= d2
        assert d1 >= d3
        assert not d3 >= d1

    def test_comparison_different_years(self) -> None:
        """Test comparison across years."""
        d1 = Date(2024, 12, 31)
        d2 = Date(2025, 1, 1)
        assert d1 < d2

    def test_sorting(self) -> None:
        """Test that dates can be sorted."""
        dates = [
            Date(2024, 6, 15),
            Date(2023, 1, 1),
            Date(2024, 1, 1),
            Date(2025, 12, 31),
        ]
        sorted_dates = sorted(dates)
        assert sorted_dates[0] == Date(2023, 1, 1)
        assert sorted_dates[-1] == Date(2025, 12, 31)


class TestDateHash:
    """Tests for Date hashing."""

    def test_hash_equal_dates(self) -> None:
        """Test that equal dates have equal hashes."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 15)
        assert hash(d1) == hash(d2)

    def test_hash_different_dates(self) -> None:
        """Test that different dates likely have different hashes."""
        d1 = Date(2024, 1, 15)
        d2 = Date(2024, 1, 16)
        # Note: hash collision is possible but unlikely
        assert hash(d1) != hash(d2)

    def test_hash_usable_in_set(self) -> None:
        """Test that dates can be used in sets."""
        s = {Date(2024, 1, 15), Date(2024, 1, 15), Date(2024, 1, 16)}
        assert len(s) == 2

    def test_hash_usable_as_dict_key(self) -> None:
        """Test that dates can be used as dict keys."""
        d = {Date(2024, 1, 15): "mid-month"}
        assert d[Date(2024, 1, 15)] == "mid-month"


class TestDateStringRepresentation:
    """Tests for Date string representations."""

    def test_repr(self) -> None:
        """Test repr output."""
        d = Date(2024, 1, 15)
        assert repr(d) == "Date(2024, 1, 15)"

    def test_repr_bce(self) -> None:
        """Test repr for BCE dates."""
        d = Date(-44, 3, 15)
        assert repr(d) == "Date(-44, 3, 15)"

    def test_str(self) -> None:
        """Test str output (ISO format)."""
        d = Date(2024, 1, 15)
        assert str(d) == "2024-01-15"

    def test_str_bce(self) -> None:
        """Test str for BCE dates."""
        d = Date(-44, 3, 15)
        assert str(d) == "-0044-03-15"


class TestDateBoolean:
    """Tests for Date boolean behavior."""

    def test_bool_always_true(self) -> None:
        """Test that dates are always truthy."""
        assert bool(Date(2024, 1, 15)) is True
        assert bool(Date(0, 1, 1)) is True


class TestDateConversion:
    """Tests for Date conversion methods."""

    def test_to_ordinal(self) -> None:
        """Test to_ordinal method."""
        assert Date(1, 1, 1).to_ordinal() == 1
        assert Date(1, 1, 2).to_ordinal() == 2
        assert Date(1, 12, 31).to_ordinal() == 365

    def test_to_iso_format(self) -> None:
        """Test to_iso_format method."""
        assert Date(2024, 1, 15).to_iso_format() == "2024-01-15"
        assert Date(2024, 12, 1).to_iso_format() == "2024-12-01"

    def test_to_json(self) -> None:
        """Test to_json method."""
        d = Date(2024, 1, 15)
        j = d.to_json()
        assert j == {"_type": "Date", "value": "2024-01-15"}

    def test_to_json_bce(self) -> None:
        """Test to_json for BCE dates."""
        d = Date(-44, 3, 15)
        j = d.to_json()
        assert j == {"_type": "Date", "value": "-0044-03-15"}


class TestDateImmutability:
    """Tests for Date immutability."""

    def test_operations_return_new_instance(self) -> None:
        """Test that transformation methods return new instances."""
        d = Date(2024, 1, 15)
        d2 = d.add_days(1)
        assert d is not d2
        assert d.day == 15  # Original unchanged
        assert d2.day == 16

    def test_replace_returns_new_instance(self) -> None:
        """Test that replace returns a new instance."""
        d = Date(2024, 1, 15)
        d2 = d.replace(day=20)
        assert d is not d2
        assert d.day == 15
        assert d2.day == 20
