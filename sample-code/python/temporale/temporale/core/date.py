"""Date class representing a calendar date.

This module provides the Date class for representing calendar dates
in the proleptic Gregorian calendar with full support for BCE dates.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, overload

from temporale._internal.calendar import (
    is_leap_year,
    days_in_month,
    days_in_year,
    ymd_to_mjd,
    mjd_to_ymd,
    ymd_to_ordinal,
    ordinal_to_ymd,
    mjd_to_day_of_week,
    _days_before_month,
)
from temporale._internal.validation import (
    validate_year,
    validate_month,
    validate_day,
)
from temporale.errors import ValidationError, ParseError
from temporale.units.era import Era

if TYPE_CHECKING:
    from temporale.core.duration import Duration


class Date:
    """A calendar date in the proleptic Gregorian calendar.

    Date represents a specific calendar day with year, month, and day
    components. It uses the proleptic Gregorian calendar, which means
    the Gregorian calendar rules are extended to dates before its
    actual adoption in 1582.

    The Date class supports both CE (Common Era) and BCE (Before Common
    Era) dates using astronomical year numbering, where year 0 exists
    and equals 1 BCE.

    Internal representation uses Modified Julian Day (MJD) for efficient
    date arithmetic.

    Attributes:
        year: The year (can be negative for BCE dates).
        month: The month (1-12).
        day: The day of the month (1-31).

    Examples:
        >>> d = Date(2024, 1, 15)
        >>> d.year
        2024
        >>> d.month
        1
        >>> d.day
        15

        >>> d = Date(-44, 3, 15)  # Ides of March, 44 BCE
        >>> d.era
        <Era.BCE: 'BCE'>

        >>> Date(2024, 2, 29)  # Valid leap year date
        Date(2024, 2, 29)
    """

    __slots__ = ("_days",)

    def __init__(self, year: int, month: int, day: int) -> None:
        """Create a Date from year, month, and day.

        Args:
            year: The year (can be 0 or negative for BCE dates).
                  Year 0 = 1 BCE in astronomical year numbering.
            month: The month (1-12).
            day: The day of the month.

        Raises:
            ValidationError: If any component is out of range.

        Examples:
            >>> Date(2024, 1, 15)
            Date(2024, 1, 15)

            >>> Date(2024, 2, 30)  # Invalid: February doesn't have 30 days
            Traceback (most recent call last):
            ...
            ValidationError: day must be between 1 and 29 for 2024-02, got 30
        """
        validate_year(year)
        validate_month(month)
        validate_day(year, month, day)

        self._days = ymd_to_mjd(year, month, day)

    @classmethod
    def today(cls) -> Date:
        """Return today's date in the local timezone.

        Returns:
            A Date representing the current day.

        Examples:
            >>> d = Date.today()  # Returns current date
            >>> d.year >= 2024
            True
        """
        import datetime

        now = datetime.date.today()
        return cls(now.year, now.month, now.day)

    @classmethod
    def from_ordinal(cls, ordinal: int) -> Date:
        """Create a Date from an ordinal day number.

        The ordinal is the number of days since year 1, where
        ordinal 1 = 0001-01-01 (January 1, year 1).

        Args:
            ordinal: The ordinal day number.

        Returns:
            The corresponding Date.

        Raises:
            ValidationError: If the resulting date is out of range.

        Examples:
            >>> Date.from_ordinal(1)  # 0001-01-01
            Date(1, 1, 1)

            >>> Date.from_ordinal(738886)  # 2024-01-15
            Date(2024, 1, 15)
        """
        year, month, day = ordinal_to_ymd(ordinal)
        return cls(year, month, day)

    @classmethod
    def from_iso_format(cls, s: str) -> Date:
        """Parse a date from ISO 8601 format (YYYY-MM-DD).

        Supports both positive and negative years for BCE dates.
        The format must be exactly YYYY-MM-DD with hyphens as
        separators.

        Args:
            s: The ISO 8601 date string.

        Returns:
            The parsed Date.

        Raises:
            ParseError: If the string is not valid ISO 8601 format.
            ValidationError: If the date components are invalid.

        Examples:
            >>> Date.from_iso_format("2024-01-15")
            Date(2024, 1, 15)

            >>> Date.from_iso_format("-0044-03-15")  # 44 BCE
            Date(-44, 3, 15)

            >>> Date.from_iso_format("2024-13-01")  # Invalid month
            Traceback (most recent call last):
            ...
            ValidationError: month must be between 1 and 12, got 13
        """
        # Match patterns: YYYY-MM-DD or -YYYY-MM-DD
        # Extended years: +YYYYYY-MM-DD or -YYYYYY-MM-DD
        pattern = r"^([+-]?\d{4,})-(\d{2})-(\d{2})$"
        match = re.match(pattern, s)
        if not match:
            raise ParseError(
                f"Invalid ISO 8601 date format: {s!r}. "
                "Expected YYYY-MM-DD or -YYYY-MM-DD"
            )

        year = int(match.group(1))
        month = int(match.group(2))
        day = int(match.group(3))

        return cls(year, month, day)

    @property
    def year(self) -> int:
        """Return the year component.

        Returns:
            The year (can be negative for BCE dates).
        """
        year, _, _ = mjd_to_ymd(self._days)
        return year

    @property
    def month(self) -> int:
        """Return the month component.

        Returns:
            The month (1-12).
        """
        _, month, _ = mjd_to_ymd(self._days)
        return month

    @property
    def day(self) -> int:
        """Return the day component.

        Returns:
            The day of the month (1-31).
        """
        _, _, day = mjd_to_ymd(self._days)
        return day

    @property
    def day_of_week(self) -> int:
        """Return the day of the week.

        Returns Monday as 0 through Sunday as 6, matching Python's
        datetime.weekday() convention.

        Returns:
            Day of week (0=Monday, 6=Sunday).

        Examples:
            >>> Date(2024, 1, 15).day_of_week  # Monday
            0
            >>> Date(2024, 1, 21).day_of_week  # Sunday
            6
        """
        return mjd_to_day_of_week(self._days)

    @property
    def day_of_year(self) -> int:
        """Return the day of the year.

        Returns:
            Day of year (1-366).

        Examples:
            >>> Date(2024, 1, 1).day_of_year
            1
            >>> Date(2024, 12, 31).day_of_year  # Leap year
            366
            >>> Date(2023, 12, 31).day_of_year  # Non-leap year
            365
        """
        year, month, day = mjd_to_ymd(self._days)
        return _days_before_month(year, month) + day

    @property
    def era(self) -> Era:
        """Return the era (BCE or CE) for this date.

        Year 0 and negative years are BCE; positive years are CE.

        Returns:
            Era.BCE or Era.CE.

        Examples:
            >>> Date(2024, 1, 15).era
            <Era.CE: 'CE'>
            >>> Date(-44, 3, 15).era
            <Era.BCE: 'BCE'>
            >>> Date(0, 1, 1).era  # Year 0 = 1 BCE
            <Era.BCE: 'BCE'>
        """
        return Era.BCE if self.year <= 0 else Era.CE

    @property
    def is_leap_year(self) -> bool:
        """Return True if this date is in a leap year.

        Returns:
            True if the year is a leap year.

        Examples:
            >>> Date(2024, 1, 1).is_leap_year
            True
            >>> Date(2023, 1, 1).is_leap_year
            False
            >>> Date(1900, 1, 1).is_leap_year  # Divisible by 100 but not 400
            False
            >>> Date(2000, 1, 1).is_leap_year  # Divisible by 400
            True
        """
        return is_leap_year(self.year)

    def replace(
        self,
        year: int | None = None,
        month: int | None = None,
        day: int | None = None,
    ) -> Date:
        """Return a new Date with specified components replaced.

        Any unspecified components retain their current values.

        Args:
            year: New year (or None to keep current).
            month: New month (or None to keep current).
            day: New day (or None to keep current).

        Returns:
            A new Date with the specified replacements.

        Raises:
            ValidationError: If the resulting date is invalid.

        Examples:
            >>> d = Date(2024, 1, 15)
            >>> d.replace(month=6)
            Date(2024, 6, 15)

            >>> d.replace(year=2023, month=2, day=28)
            Date(2023, 2, 28)
        """
        y, m, d = mjd_to_ymd(self._days)
        new_year = year if year is not None else y
        new_month = month if month is not None else m
        new_day = day if day is not None else d
        return Date(new_year, new_month, new_day)

    def add_days(self, days: int) -> Date:
        """Return a new Date offset by the given number of days.

        Args:
            days: Number of days to add (can be negative).

        Returns:
            A new Date offset by the specified days.

        Raises:
            ValidationError: If the result is out of range.

        Examples:
            >>> Date(2024, 1, 15).add_days(10)
            Date(2024, 1, 25)

            >>> Date(2024, 1, 15).add_days(-20)
            Date(2023, 12, 26)
        """
        new_mjd = self._days + days
        year, month, day = mjd_to_ymd(new_mjd)
        return Date(year, month, day)

    def add_months(self, months: int) -> Date:
        """Return a new Date offset by the given number of months.

        If the resulting day is invalid for the new month, it is
        clamped to the last valid day of that month.

        Args:
            months: Number of months to add (can be negative).

        Returns:
            A new Date offset by the specified months.

        Raises:
            ValidationError: If the result is out of range.

        Examples:
            >>> Date(2024, 1, 15).add_months(2)
            Date(2024, 3, 15)

            >>> Date(2024, 1, 31).add_months(1)  # Clamps to Feb 29
            Date(2024, 2, 29)

            >>> Date(2023, 1, 31).add_months(1)  # Clamps to Feb 28
            Date(2023, 2, 28)
        """
        year, month, day = mjd_to_ymd(self._days)

        # Calculate new year and month
        total_months = year * 12 + (month - 1) + months
        new_year = total_months // 12
        new_month = (total_months % 12) + 1

        # Handle negative total_months
        if new_month < 1:
            new_month += 12
            new_year -= 1

        # Clamp day to valid range for new month
        max_day = days_in_month(new_year, new_month)
        new_day = min(day, max_day)

        return Date(new_year, new_month, new_day)

    def add_years(self, years: int) -> Date:
        """Return a new Date offset by the given number of years.

        If the resulting date is invalid (Feb 29 in a non-leap year),
        it is clamped to Feb 28.

        Args:
            years: Number of years to add (can be negative).

        Returns:
            A new Date offset by the specified years.

        Raises:
            ValidationError: If the result is out of range.

        Examples:
            >>> Date(2024, 1, 15).add_years(1)
            Date(2025, 1, 15)

            >>> Date(2024, 2, 29).add_years(1)  # 2025 is not a leap year
            Date(2025, 2, 28)
        """
        year, month, day = mjd_to_ymd(self._days)
        new_year = year + years

        # Clamp day if needed (Feb 29 -> Feb 28 for non-leap years)
        max_day = days_in_month(new_year, month)
        new_day = min(day, max_day)

        return Date(new_year, month, new_day)

    def to_ordinal(self) -> int:
        """Return the ordinal day number for this date.

        The ordinal is the number of days since year 1, where
        ordinal 1 = 0001-01-01.

        Returns:
            The ordinal day number.

        Examples:
            >>> Date(1, 1, 1).to_ordinal()
            1
            >>> Date(2024, 1, 15).to_ordinal()
            738886
        """
        year, month, day = mjd_to_ymd(self._days)
        return ymd_to_ordinal(year, month, day)

    def to_iso_format(self) -> str:
        """Return the date as an ISO 8601 string (YYYY-MM-DD).

        For BCE dates (year <= 0), returns -YYYY-MM-DD format.

        Returns:
            ISO 8601 formatted date string.

        Examples:
            >>> Date(2024, 1, 15).to_iso_format()
            '2024-01-15'

            >>> Date(-44, 3, 15).to_iso_format()
            '-0044-03-15'
        """
        year, month, day = mjd_to_ymd(self._days)
        if year >= 0:
            return f"{year:04d}-{month:02d}-{day:02d}"
        else:
            # Negative year with leading minus
            return f"{year:05d}-{month:02d}-{day:02d}"

    def to_json(self) -> dict:
        """Return the date as a JSON-serializable dictionary.

        The format uses ISO 8601 string with type tag for polymorphic
        deserialization.

        Returns:
            Dictionary with _type and value keys.

        Examples:
            >>> Date(2024, 1, 15).to_json()
            {'_type': 'Date', 'value': '2024-01-15'}
        """
        return {"_type": "Date", "value": self.to_iso_format()}

    @classmethod
    def from_json(cls, data: dict) -> Date:
        """Create a Date from a JSON dictionary.

        Args:
            data: Dictionary with _type and value keys.

        Returns:
            A Date parsed from the dictionary.

        Raises:
            ParseError: If the data is invalid.

        Examples:
            >>> Date.from_json({'_type': 'Date', 'value': '2024-01-15'})
            Date(2024, 1, 15)
        """
        from temporale.errors import ParseError

        if not isinstance(data, dict):
            raise ParseError(f"expected dict, got {type(data).__name__}")

        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' field for Date")

        return cls.from_iso_format(value)

    @overload
    def __add__(self, other: Duration) -> Date: ...

    @overload
    def __add__(self, other: object) -> Date: ...

    def __add__(self, other: object) -> Date:
        """Add a Duration to this date.

        Args:
            other: A Duration to add.

        Returns:
            A new Date offset by the Duration.

        Raises:
            TypeError: If other is not a Duration.

        Examples:
            >>> from temporale.core.duration import Duration
            >>> Date(2024, 1, 15) + Duration(days=10)
            Date(2024, 1, 25)
        """
        # Import here to avoid circular imports
        from temporale.core.duration import Duration

        if not isinstance(other, Duration):
            return NotImplemented  # type: ignore[return-value]

        # Add whole days from the duration
        days_to_add = other.days
        # If duration has fractional day, add another day if >= 12 hours
        # For Date, we only care about whole days
        return self.add_days(days_to_add)

    @overload
    def __sub__(self, other: Duration) -> Date: ...

    @overload
    def __sub__(self, other: Date) -> Duration: ...

    @overload
    def __sub__(self, other: object) -> Date | Duration: ...

    def __sub__(self, other: object) -> Date | Duration:
        """Subtract a Duration or Date from this date.

        When subtracting a Duration, returns a new Date.
        When subtracting a Date, returns a Duration.

        Args:
            other: A Duration or Date to subtract.

        Returns:
            A new Date (if subtracting Duration) or Duration (if subtracting Date).

        Raises:
            TypeError: If other is not a Duration or Date.

        Examples:
            >>> from temporale.core.duration import Duration
            >>> Date(2024, 1, 25) - Duration(days=10)
            Date(2024, 1, 15)

            >>> Date(2024, 1, 25) - Date(2024, 1, 15)
            Duration(days=10, seconds=0, nanoseconds=0)
        """
        from temporale.core.duration import Duration

        if isinstance(other, Duration):
            return self.add_days(-other.days)
        elif isinstance(other, Date):
            # Return the difference as a Duration
            day_diff = self._days - other._days
            return Duration(days=day_diff)
        return NotImplemented  # type: ignore[return-value]

    def __eq__(self, other: object) -> bool:
        """Check equality with another date.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a Date with the same value.

        Examples:
            >>> Date(2024, 1, 15) == Date(2024, 1, 15)
            True
            >>> Date(2024, 1, 15) == Date(2024, 1, 16)
            False
        """
        if not isinstance(other, Date):
            return NotImplemented
        return self._days == other._days

    def __ne__(self, other: object) -> bool:
        """Check inequality with another date."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __lt__(self, other: object) -> bool:
        """Check if this date is earlier than another.

        Args:
            other: Another Date to compare with.

        Returns:
            True if this date is earlier.

        Examples:
            >>> Date(2024, 1, 15) < Date(2024, 1, 16)
            True
        """
        if not isinstance(other, Date):
            return NotImplemented
        return self._days < other._days

    def __le__(self, other: object) -> bool:
        """Check if this date is earlier than or equal to another."""
        if not isinstance(other, Date):
            return NotImplemented
        return self._days <= other._days

    def __gt__(self, other: object) -> bool:
        """Check if this date is later than another."""
        if not isinstance(other, Date):
            return NotImplemented
        return self._days > other._days

    def __ge__(self, other: object) -> bool:
        """Check if this date is later than or equal to another."""
        if not isinstance(other, Date):
            return NotImplemented
        return self._days >= other._days

    def __hash__(self) -> int:
        """Return a hash for this date.

        Returns:
            Hash based on MJD value.
        """
        return hash(self._days)

    def __repr__(self) -> str:
        """Return a detailed string representation.

        Returns:
            String like 'Date(2024, 1, 15)'.
        """
        year, month, day = mjd_to_ymd(self._days)
        return f"Date({year}, {month}, {day})"

    def __str__(self) -> str:
        """Return the ISO 8601 representation.

        Returns:
            ISO 8601 formatted date string.
        """
        return self.to_iso_format()

    def __bool__(self) -> bool:
        """Dates are always truthy."""
        return True


__all__ = ["Date"]
