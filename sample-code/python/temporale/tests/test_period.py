"""Tests for the Period class.

This module tests the Period class representing calendar-based durations
that vary by context (months, years) as opposed to exact time spans.
"""

import pytest

from temporale import Date, DateTime, Period
from temporale.core.period import Period as PeriodDirect


# =============================================================================
# Construction Tests
# =============================================================================


class TestPeriodConstruction:
    """Tests for Period construction."""

    def test_default_construction(self):
        """Test default construction creates zero period."""
        p = Period()
        assert p.years == 0
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 0

    def test_construction_with_all_components(self):
        """Test construction with all components."""
        p = Period(years=1, months=2, weeks=3, days=4)
        assert p.years == 1
        assert p.months == 2
        assert p.weeks == 3
        assert p.days == 4

    def test_construction_with_partial_components(self):
        """Test construction with partial components."""
        p = Period(months=6)
        assert p.years == 0
        assert p.months == 6
        assert p.weeks == 0
        assert p.days == 0

    def test_construction_with_negative_values(self):
        """Test construction with negative values."""
        p = Period(years=-1, months=-2)
        assert p.years == -1
        assert p.months == -2


# =============================================================================
# Factory Method Tests
# =============================================================================


class TestPeriodFactoryMethods:
    """Tests for Period factory methods."""

    def test_of_years(self):
        """Test Period.of_years factory method."""
        p = Period.of_years(5)
        assert p.years == 5
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 0

    def test_of_months(self):
        """Test Period.of_months factory method."""
        p = Period.of_months(6)
        assert p.years == 0
        assert p.months == 6
        assert p.weeks == 0
        assert p.days == 0

    def test_of_weeks(self):
        """Test Period.of_weeks factory method."""
        p = Period.of_weeks(2)
        assert p.years == 0
        assert p.months == 0
        assert p.weeks == 2
        assert p.days == 0

    def test_of_days(self):
        """Test Period.of_days factory method."""
        p = Period.of_days(10)
        assert p.years == 0
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 10

    def test_zero(self):
        """Test Period.zero factory method."""
        p = Period.zero()
        assert p.is_zero

    def test_of_negative_values(self):
        """Test factory methods with negative values."""
        assert Period.of_years(-2).years == -2
        assert Period.of_months(-6).months == -6
        assert Period.of_weeks(-1).weeks == -1
        assert Period.of_days(-10).days == -10


# =============================================================================
# Property Tests
# =============================================================================


class TestPeriodProperties:
    """Tests for Period properties."""

    def test_total_months(self):
        """Test total_months property."""
        p = Period(years=1, months=2)
        assert p.total_months == 14  # 1*12 + 2

    def test_total_months_negative(self):
        """Test total_months with negative values."""
        p = Period(years=-1, months=3)
        assert p.total_months == -9  # -1*12 + 3

    def test_total_days(self):
        """Test total_days property."""
        p = Period(weeks=2, days=3)
        assert p.total_days == 17  # 2*7 + 3

    def test_is_zero(self):
        """Test is_zero property."""
        assert Period().is_zero
        assert Period.zero().is_zero
        assert not Period(days=1).is_zero
        assert not Period(months=1).is_zero


# =============================================================================
# Arithmetic Tests
# =============================================================================


class TestPeriodArithmetic:
    """Tests for Period arithmetic operations."""

    def test_add_periods(self):
        """Test adding two periods."""
        p1 = Period(years=1, months=3)
        p2 = Period(months=6, days=10)
        result = p1 + p2
        assert result.years == 1
        assert result.months == 9
        assert result.weeks == 0
        assert result.days == 10

    def test_subtract_periods(self):
        """Test subtracting two periods."""
        p1 = Period(years=2, months=6)
        p2 = Period(months=8)
        result = p1 - p2
        assert result.years == 2
        assert result.months == -2

    def test_negate_period(self):
        """Test negating a period."""
        p = Period(years=1, months=2, weeks=3, days=4)
        neg = -p
        assert neg.years == -1
        assert neg.months == -2
        assert neg.weeks == -3
        assert neg.days == -4

    def test_multiply_period(self):
        """Test multiplying a period by a scalar."""
        p = Period(months=3, days=10)
        result = p * 2
        assert result.months == 6
        assert result.days == 20

    def test_rmul_period(self):
        """Test reverse multiplication (scalar * period)."""
        p = Period(months=3)
        result = 3 * p
        assert result.months == 9

    def test_add_returns_not_implemented_for_wrong_type(self):
        """Test adding non-Period returns NotImplemented."""
        p = Period(months=1)
        result = p.__add__("not a period")
        assert result is NotImplemented

    def test_radd_for_sum_support(self):
        """Test that sum() works with periods."""
        periods = [Period(months=1), Period(months=2), Period(months=3)]
        result = sum(periods, Period.zero())
        assert result.months == 6


# =============================================================================
# Normalization Tests
# =============================================================================


class TestPeriodNormalization:
    """Tests for Period normalization."""

    def test_normalized_months_to_years(self):
        """Test normalizing months to years."""
        p = Period(months=14)
        norm = p.normalized()
        assert norm.years == 1
        assert norm.months == 2

    def test_normalized_days_to_weeks(self):
        """Test normalizing days to weeks."""
        p = Period(days=10)
        norm = p.normalized()
        assert norm.weeks == 1
        assert norm.days == 3

    def test_normalized_combined(self):
        """Test normalizing both months and days."""
        p = Period(months=25, days=17)
        norm = p.normalized()
        assert norm.years == 2
        assert norm.months == 1
        assert norm.weeks == 2
        assert norm.days == 3


# =============================================================================
# Equality and Hashing Tests
# =============================================================================


class TestPeriodEqualityAndHashing:
    """Tests for Period equality and hashing."""

    def test_equal_periods(self):
        """Test equality of identical periods."""
        p1 = Period(years=1, months=2)
        p2 = Period(years=1, months=2)
        assert p1 == p2

    def test_unequal_periods(self):
        """Test inequality of different periods."""
        p1 = Period(months=12)
        p2 = Period(years=1)  # Semantically same but structurally different
        assert p1 != p2

    def test_hash_equal_periods(self):
        """Test that equal periods have equal hashes."""
        p1 = Period(years=1, months=2)
        p2 = Period(years=1, months=2)
        assert hash(p1) == hash(p2)

    def test_periods_usable_in_sets(self):
        """Test that periods can be used in sets."""
        s = {Period(months=1), Period(months=2), Period(months=1)}
        assert len(s) == 2


# =============================================================================
# String Representation Tests
# =============================================================================


class TestPeriodStringRepresentation:
    """Tests for Period string representations."""

    def test_repr(self):
        """Test __repr__ method."""
        p = Period(years=1, months=2, weeks=3, days=4)
        assert repr(p) == "Period(years=1, quarters=0, months=2, weeks=3, days=4)"

    def test_str_zero(self):
        """Test __str__ for zero period."""
        p = Period.zero()
        assert str(p) == "P0D"

    def test_str_with_components(self):
        """Test __str__ with various components."""
        p = Period(years=1, months=2, days=3)
        assert str(p) == "P1Y2M3D"

    def test_str_weeks_converted_to_days(self):
        """Test that weeks are converted to days in string representation."""
        p = Period(weeks=2, days=3)
        assert str(p) == "P17D"  # 2*7 + 3 = 17


# =============================================================================
# Date + Period Tests (Month Overflow Clamping)
# =============================================================================


class TestDatePlusPeriod:
    """Tests for Date + Period with month overflow clamping."""

    def test_simple_add_months(self):
        """Test adding months to a date without overflow."""
        d = Date(2024, 1, 15)
        result = d + Period(months=1)
        assert result == Date(2024, 2, 15)

    def test_add_months_clamps_to_end_of_february_leap_year(self):
        """Test that Jan 31 + 1 month clamps to Feb 29 in a leap year."""
        d = Date(2024, 1, 31)  # 2024 is a leap year
        result = d + Period(months=1)
        assert result == Date(2024, 2, 29)

    def test_add_months_clamps_to_end_of_february_non_leap_year(self):
        """Test that Jan 31 + 1 month clamps to Feb 28 in a non-leap year."""
        d = Date(2023, 1, 31)  # 2023 is not a leap year
        result = d + Period(months=1)
        assert result == Date(2023, 2, 28)

    def test_add_months_clamps_to_end_of_april(self):
        """Test that Mar 31 + 1 month clamps to Apr 30."""
        d = Date(2024, 3, 31)
        result = d + Period(months=1)
        assert result == Date(2024, 4, 30)

    def test_add_years_clamps_leap_year_to_non_leap_year(self):
        """Test that Feb 29 + 1 year clamps to Feb 28."""
        d = Date(2024, 2, 29)
        result = d + Period(years=1)
        assert result == Date(2025, 2, 28)

    def test_add_years_leap_to_leap(self):
        """Test adding 4 years from leap year to leap year preserves Feb 29."""
        d = Date(2024, 2, 29)
        result = d + Period(years=4)
        assert result == Date(2028, 2, 29)

    def test_subtract_months_clamps(self):
        """Test that Mar 31 - 1 month clamps to Feb 29."""
        d = Date(2024, 3, 31)
        result = d - Period(months=1)
        assert result == Date(2024, 2, 29)

    def test_add_period_with_weeks_and_days(self):
        """Test adding a period with weeks and days."""
        d = Date(2024, 1, 15)
        result = d + Period(weeks=2, days=3)
        assert result == Date(2024, 2, 1)  # 15 + 14 + 3 = 32, Feb 1

    def test_add_complex_period(self):
        """Test adding a period with all components."""
        d = Date(2024, 1, 15)
        result = d + Period(years=1, months=2, weeks=1, days=3)
        # Year: 2024 -> 2025
        # Month: 1 -> 3
        # Day: 15 + 7 + 3 = 25
        assert result == Date(2025, 3, 25)

    def test_add_negative_period(self):
        """Test adding a negative period."""
        d = Date(2024, 6, 15)
        result = d + Period(months=-3)
        assert result == Date(2024, 3, 15)


# =============================================================================
# DateTime + Period Tests
# =============================================================================


class TestDateTimePlusPeriod:
    """Tests for DateTime + Period with time preservation."""

    def test_datetime_add_months_preserves_time(self):
        """Test that DateTime + Period preserves the time component."""
        dt = DateTime(2024, 1, 31, 14, 30, 45)
        result = dt + Period(months=1)
        assert result.year == 2024
        assert result.month == 2
        assert result.day == 29  # Clamped
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45

    def test_datetime_subtract_period(self):
        """Test subtracting a period from a DateTime."""
        dt = DateTime(2024, 3, 31, 10, 0, 0)
        result = dt - Period(months=1)
        assert result == DateTime(2024, 2, 29, 10, 0, 0)

    def test_datetime_add_years_preserves_nanoseconds(self):
        """Test that nanoseconds are preserved when adding years."""
        dt = DateTime(2024, 2, 29, 12, 0, 0, nanosecond=123456789)
        result = dt + Period(years=1)
        assert result.day == 28  # Clamped
        assert result.nanosecond == 123456789


# =============================================================================
# Period.to_duration Tests
# =============================================================================


class TestPeriodToDuration:
    """Tests for Period.to_duration() conversion."""

    def test_to_duration_one_month_february(self):
        """Test converting 1 month to duration using Feb 1 reference."""
        p = Period(months=1)
        d = Date(2024, 2, 1)  # February in leap year has 29 days
        duration = p.to_duration(d)
        assert duration.days == 29

    def test_to_duration_one_month_march(self):
        """Test converting 1 month to duration using Mar 1 reference."""
        p = Period(months=1)
        d = Date(2024, 3, 1)  # March has 31 days
        duration = p.to_duration(d)
        assert duration.days == 31

    def test_to_duration_one_year(self):
        """Test converting 1 year to duration."""
        p = Period(years=1)
        d = Date(2024, 1, 1)  # 2024 is a leap year, 366 days
        duration = p.to_duration(d)
        assert duration.days == 366

    def test_to_duration_one_year_non_leap(self):
        """Test converting 1 year to duration from non-leap year."""
        p = Period(years=1)
        d = Date(2023, 1, 1)  # 2023 is not a leap year, 365 days
        duration = p.to_duration(d)
        assert duration.days == 365

    def test_to_duration_weeks_only(self):
        """Test converting weeks to duration (always exact)."""
        p = Period(weeks=2)
        d = Date(2024, 1, 1)
        duration = p.to_duration(d)
        assert duration.days == 14


# =============================================================================
# Edge Cases and Corner Cases
# =============================================================================


class TestPeriodEdgeCases:
    """Tests for edge cases and corner cases."""

    def test_zero_period_does_not_change_date(self):
        """Test that adding zero period doesn't change the date."""
        d = Date(2024, 1, 15)
        result = d + Period.zero()
        assert result == d

    def test_double_clamping_scenario(self):
        """Test a scenario that might cause double clamping."""
        # Aug 31 + 6 months = Feb 28/29
        d = Date(2023, 8, 31)
        result = d + Period(months=6)
        assert result == Date(2024, 2, 29)  # 2024 is leap year

    def test_year_overflow(self):
        """Test adding months that overflow to the next year."""
        d = Date(2024, 10, 15)
        result = d + Period(months=5)
        assert result == Date(2025, 3, 15)

    def test_large_period(self):
        """Test adding a large period."""
        d = Date(2024, 1, 1)
        result = d + Period(years=100)
        assert result == Date(2124, 1, 1)

    def test_bool_non_zero_period(self):
        """Test that non-zero period is truthy."""
        assert bool(Period(days=1))
        assert bool(Period(months=1))

    def test_bool_zero_period(self):
        """Test that zero period is falsy."""
        assert not bool(Period.zero())

    def test_import_from_temporale(self):
        """Test that Period can be imported from main temporale module."""
        from temporale import Period as PeriodFromMain
        p = PeriodFromMain(months=1)
        assert p.months == 1


# =============================================================================
# Quarters Support Tests
# =============================================================================


class TestPeriodQuartersConstruction:
    """Tests for Period construction with quarters."""

    def test_construction_with_quarters(self):
        """Test construction with quarters parameter."""
        p = Period(quarters=2)
        assert p.years == 0
        assert p.quarters == 2
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 0

    def test_construction_with_all_components_including_quarters(self):
        """Test construction with all components including quarters."""
        p = Period(years=1, quarters=2, months=3, weeks=4, days=5)
        assert p.years == 1
        assert p.quarters == 2
        assert p.months == 3
        assert p.weeks == 4
        assert p.days == 5

    def test_construction_with_negative_quarters(self):
        """Test construction with negative quarters."""
        p = Period(quarters=-2)
        assert p.quarters == -2


class TestPeriodQuartersFactoryMethod:
    """Tests for Period.of_quarters factory method."""

    def test_of_quarters(self):
        """Test Period.of_quarters factory method."""
        p = Period.of_quarters(4)
        assert p.years == 0
        assert p.quarters == 4
        assert p.months == 0
        assert p.weeks == 0
        assert p.days == 0

    def test_of_quarters_negative(self):
        """Test Period.of_quarters with negative value."""
        p = Period.of_quarters(-2)
        assert p.quarters == -2

    def test_of_quarters_zero(self):
        """Test Period.of_quarters(0)."""
        p = Period.of_quarters(0)
        assert p.is_zero


class TestPeriodQuartersProperties:
    """Tests for Period quarter-related properties."""

    def test_quarters_property(self):
        """Test quarters property accessor."""
        p = Period(quarters=3)
        assert p.quarters == 3

    def test_total_quarters(self):
        """Test total_quarters property."""
        p = Period(years=1, quarters=2)
        assert p.total_quarters == 6  # 1*4 + 2

    def test_total_quarters_years_only(self):
        """Test total_quarters with only years."""
        p = Period(years=2)
        assert p.total_quarters == 8  # 2*4

    def test_total_quarters_negative(self):
        """Test total_quarters with negative values."""
        p = Period(years=-1, quarters=2)
        assert p.total_quarters == -2  # -1*4 + 2

    def test_total_months_includes_quarters(self):
        """Test total_months includes quarters (Q1 = 3 months)."""
        p = Period(years=1, quarters=1, months=2)
        assert p.total_months == 17  # 12 + 3 + 2

    def test_total_months_quarters_only(self):
        """Test total_months with only quarters."""
        p = Period(quarters=4)
        assert p.total_months == 12  # 4*3


class TestPeriodQuartersNormalization:
    """Tests for Period normalization with quarters."""

    def test_normalized_4_quarters_to_1_year(self):
        """Test normalizing 4 quarters to 1 year."""
        p = Period(quarters=4)
        norm = p.normalized()
        assert norm.years == 1
        assert norm.quarters == 0
        assert norm.months == 0

    def test_normalized_6_quarters(self):
        """Test normalizing 6 quarters."""
        p = Period(quarters=6)
        norm = p.normalized()
        assert norm.years == 1
        assert norm.quarters == 2
        assert norm.months == 0

    def test_normalized_mixed_quarters_and_months(self):
        """Test normalizing mixed quarters and months."""
        # 3 quarters = 9 months, + 4 months = 13 months = 1 year + 1 month
        p = Period(quarters=3, months=4)
        norm = p.normalized()
        assert norm.years == 1
        assert norm.quarters == 0
        assert norm.months == 1

    def test_normalized_preserves_weeks_and_days(self):
        """Test that normalization handles weeks and days independently."""
        p = Period(quarters=5, days=10)  # 15 months, 10 days
        norm = p.normalized()
        assert norm.years == 1
        assert norm.quarters == 1
        assert norm.months == 0
        assert norm.weeks == 1
        assert norm.days == 3


class TestPeriodQuartersArithmetic:
    """Tests for Period arithmetic with quarters."""

    def test_add_periods_with_quarters(self):
        """Test adding periods with quarters."""
        p1 = Period(quarters=2)
        p2 = Period(quarters=1)
        result = p1 + p2
        assert result.quarters == 3

    def test_subtract_periods_with_quarters(self):
        """Test subtracting periods with quarters."""
        p1 = Period(quarters=3)
        p2 = Period(quarters=1)
        result = p1 - p2
        assert result.quarters == 2

    def test_negate_period_with_quarters(self):
        """Test negating a period with quarters."""
        p = Period(quarters=2)
        neg = -p
        assert neg.quarters == -2

    def test_multiply_period_with_quarters(self):
        """Test multiplying a period with quarters."""
        p = Period(quarters=2)
        result = p * 3
        assert result.quarters == 6


class TestPeriodQuartersEqualityAndHashing:
    """Tests for Period equality and hashing with quarters."""

    def test_equal_periods_with_quarters(self):
        """Test equality of periods with quarters."""
        p1 = Period(quarters=2)
        p2 = Period(quarters=2)
        assert p1 == p2

    def test_unequal_quarters_vs_months(self):
        """Test that quarters and equivalent months are not equal."""
        p1 = Period(quarters=4)  # Not normalized
        p2 = Period(months=12)
        assert p1 != p2  # Structurally different

    def test_hash_periods_with_quarters(self):
        """Test hashing periods with quarters."""
        p1 = Period(quarters=2)
        p2 = Period(quarters=2)
        assert hash(p1) == hash(p2)

    def test_periods_with_quarters_in_sets(self):
        """Test periods with quarters can be used in sets."""
        s = {Period(quarters=1), Period(quarters=2), Period(quarters=1)}
        assert len(s) == 2


class TestPeriodQuartersStringRepresentation:
    """Tests for Period string representations with quarters."""

    def test_repr_with_quarters(self):
        """Test __repr__ includes quarters."""
        p = Period(years=1, quarters=2, months=3, weeks=4, days=5)
        assert repr(p) == "Period(years=1, quarters=2, months=3, weeks=4, days=5)"

    def test_str_with_quarters(self):
        """Test __str__ uses Q notation for quarters."""
        p = Period(years=1, quarters=2)
        assert str(p) == "P1Y2Q"

    def test_str_quarters_only(self):
        """Test __str__ with only quarters."""
        p = Period.of_quarters(4)
        assert str(p) == "P4Q"

    def test_str_quarters_and_months(self):
        """Test __str__ with quarters and months."""
        p = Period(quarters=3, months=1)
        assert str(p) == "P3Q1M"

    def test_str_all_components(self):
        """Test __str__ with all components."""
        p = Period(years=1, quarters=2, months=1, weeks=1, days=3)
        # weeks=1, days=3 -> 10 days
        assert str(p) == "P1Y2Q1M10D"


class TestDatePlusQuarters:
    """Tests for Date + Period with quarters."""

    def test_add_one_quarter(self):
        """Test adding 1 quarter = 3 months."""
        d = Date(2024, 1, 15)
        result = d + Period(quarters=1)
        assert result == Date(2024, 4, 15)

    def test_add_four_quarters(self):
        """Test adding 4 quarters = 1 year."""
        d = Date(2024, 1, 15)
        result = d + Period(quarters=4)
        assert result == Date(2025, 1, 15)

    def test_add_quarter_with_clamping(self):
        """Test adding a quarter that requires day clamping."""
        # Jan 31 + 1 quarter = Apr 30 (April has 30 days)
        d = Date(2024, 1, 31)
        result = d + Period(quarters=1)
        assert result == Date(2024, 4, 30)

    def test_add_quarter_leap_year_edge(self):
        """Test adding a quarter from February 29."""
        d = Date(2024, 2, 29)  # Leap year
        result = d + Period(quarters=1)
        assert result == Date(2024, 5, 29)

    def test_subtract_quarter(self):
        """Test subtracting a quarter."""
        d = Date(2024, 4, 15)
        result = d - Period(quarters=1)
        assert result == Date(2024, 1, 15)

    def test_negative_quarters(self):
        """Test adding negative quarters."""
        d = Date(2024, 7, 15)
        result = d + Period(quarters=-2)
        assert result == Date(2024, 1, 15)


class TestDateTimePlusQuarters:
    """Tests for DateTime + Period with quarters."""

    def test_datetime_add_quarter_preserves_time(self):
        """Test that DateTime + Period with quarters preserves time."""
        dt = DateTime(2024, 1, 15, 14, 30, 45)
        result = dt + Period(quarters=1)
        assert result.year == 2024
        assert result.month == 4
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 45


class TestPeriodQuartersIsZero:
    """Tests for is_zero with quarters."""

    def test_is_zero_with_only_quarters(self):
        """Test that Period with only quarters is not zero."""
        p = Period(quarters=1)
        assert not p.is_zero

    def test_is_zero_with_zero_quarters(self):
        """Test that Period with zero quarters is zero."""
        p = Period(quarters=0)
        assert p.is_zero

    def test_bool_with_quarters(self):
        """Test __bool__ with quarters."""
        assert bool(Period(quarters=1))
        assert not bool(Period(quarters=0))
