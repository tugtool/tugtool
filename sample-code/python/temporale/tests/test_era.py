"""Tests for Era and TimeUnit enums.

These tests verify the Era and TimeUnit enum implementations,
including their values, properties, and conversion methods.
"""

from __future__ import annotations


class TestEra:
    """Tests for the Era enum."""

    def test_era_bce_value(self) -> None:
        """Era.BCE has the correct string value."""
        from temporale.units import Era

        assert Era.BCE.value == "BCE"

    def test_era_ce_value(self) -> None:
        """Era.CE has the correct string value."""
        from temporale.units import Era

        assert Era.CE.value == "CE"

    def test_era_bce_is_before_common_era(self) -> None:
        """Era.BCE.is_before_common_era returns True."""
        from temporale.units import Era

        assert Era.BCE.is_before_common_era is True

    def test_era_ce_is_not_before_common_era(self) -> None:
        """Era.CE.is_before_common_era returns False."""
        from temporale.units import Era

        assert Era.CE.is_before_common_era is False

    def test_era_values_are_unique(self) -> None:
        """Era values are distinct."""
        from temporale.units import Era

        assert Era.BCE != Era.CE

    def test_era_can_be_compared_to_string(self) -> None:
        """Era values can be compared against their string representations."""
        from temporale.units import Era

        assert Era.BCE.value == "BCE"
        assert Era.CE.value == "CE"


class TestTimeUnit:
    """Tests for the TimeUnit enum."""

    def test_timeunit_has_all_expected_values(self) -> None:
        """TimeUnit has all expected unit values."""
        from temporale.units import TimeUnit

        expected = [
            "NANOSECOND",
            "MICROSECOND",
            "MILLISECOND",
            "SECOND",
            "MINUTE",
            "HOUR",
            "DAY",
            "WEEK",
            "MONTH",
            "YEAR",
        ]
        actual = [unit.name for unit in TimeUnit]
        assert actual == expected

    def test_timeunit_nanosecond_to_seconds(self) -> None:
        """TimeUnit.NANOSECOND.to_seconds() returns 1e-9."""
        from temporale.units import TimeUnit

        assert TimeUnit.NANOSECOND.to_seconds() == 1e-9

    def test_timeunit_microsecond_to_seconds(self) -> None:
        """TimeUnit.MICROSECOND.to_seconds() returns 1e-6."""
        from temporale.units import TimeUnit

        assert TimeUnit.MICROSECOND.to_seconds() == 1e-6

    def test_timeunit_millisecond_to_seconds(self) -> None:
        """TimeUnit.MILLISECOND.to_seconds() returns 1e-3."""
        from temporale.units import TimeUnit

        assert TimeUnit.MILLISECOND.to_seconds() == 1e-3

    def test_timeunit_second_to_seconds(self) -> None:
        """TimeUnit.SECOND.to_seconds() returns 1."""
        from temporale.units import TimeUnit

        assert TimeUnit.SECOND.to_seconds() == 1

    def test_timeunit_minute_to_seconds(self) -> None:
        """TimeUnit.MINUTE.to_seconds() returns 60."""
        from temporale.units import TimeUnit

        assert TimeUnit.MINUTE.to_seconds() == 60

    def test_timeunit_hour_to_seconds(self) -> None:
        """TimeUnit.HOUR.to_seconds() returns 3600."""
        from temporale.units import TimeUnit

        assert TimeUnit.HOUR.to_seconds() == 3600

    def test_timeunit_day_to_seconds(self) -> None:
        """TimeUnit.DAY.to_seconds() returns 86400."""
        from temporale.units import TimeUnit

        assert TimeUnit.DAY.to_seconds() == 86400

    def test_timeunit_week_to_seconds(self) -> None:
        """TimeUnit.WEEK.to_seconds() returns 604800."""
        from temporale.units import TimeUnit

        assert TimeUnit.WEEK.to_seconds() == 604800

    def test_timeunit_month_to_seconds_is_none(self) -> None:
        """TimeUnit.MONTH.to_seconds() returns None (variable length)."""
        from temporale.units import TimeUnit

        assert TimeUnit.MONTH.to_seconds() is None

    def test_timeunit_year_to_seconds_is_none(self) -> None:
        """TimeUnit.YEAR.to_seconds() returns None (variable length)."""
        from temporale.units import TimeUnit

        assert TimeUnit.YEAR.to_seconds() is None

    def test_timeunit_ordering_in_enum(self) -> None:
        """TimeUnit members are ordered from smallest to largest."""
        from temporale.units import TimeUnit

        units = list(TimeUnit)
        # Verify ordering from smallest to largest unit
        assert units[0] == TimeUnit.NANOSECOND
        assert units[-1] == TimeUnit.YEAR

    def test_timeunit_values_are_strings(self) -> None:
        """All TimeUnit values are lowercase strings."""
        from temporale.units import TimeUnit

        for unit in TimeUnit:
            assert isinstance(unit.value, str)
            assert unit.value == unit.name.lower()
