"""Period class representing calendar-based durations.

This module provides the Period class for representing calendar durations
that vary by context (months, years) as opposed to exact time spans (Duration).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.duration import Duration


class Period:
    """A calendar-based duration with year, month, week, and day components.

    Unlike Duration (which is exact nanoseconds), Period represents calendar
    concepts like "1 month" that vary by context. Adding 1 month to Jan 31
    yields Feb 28/29, not exactly 30 or 31 days.

    The components are stored as-is without normalization. For example,
    Period(months=14) remains 14 months rather than being converted to
    1 year and 2 months. Use normalize() if you want normalized form.

    Attributes:
        years: Number of years (can be negative).
        months: Number of months (can be negative).
        weeks: Number of weeks (can be negative).
        days: Number of days (can be negative).

    Examples:
        >>> p = Period(years=1, months=2)
        >>> p.years
        1
        >>> p.months
        2

        >>> p = Period.of_months(14)
        >>> p.total_months
        14

        >>> from temporale.core.date import Date
        >>> Date(2024, 1, 31) + Period(months=1)  # Clamps to Feb 29
        Date(2024, 2, 29)
    """

    __slots__ = ("_years", "_months", "_weeks", "_days")

    def __init__(
        self,
        years: int = 0,
        months: int = 0,
        weeks: int = 0,
        days: int = 0,
    ) -> None:
        """Create a Period from component parts.

        All parameters can be positive, negative, or zero.

        Args:
            years: Number of years.
            months: Number of months.
            weeks: Number of weeks.
            days: Number of days.

        Examples:
            >>> Period(years=1, months=6)
            Period(years=1, months=6, weeks=0, days=0)

            >>> Period(months=-3)  # 3 months ago
            Period(years=0, months=-3, weeks=0, days=0)
        """
        self._years = years
        self._months = months
        self._weeks = weeks
        self._days = days

    @classmethod
    def of_years(cls, years: int) -> Period:
        """Create a Period of a given number of years.

        Args:
            years: Number of years (can be negative).

        Returns:
            A Period representing the specified years.

        Examples:
            >>> Period.of_years(2)
            Period(years=2, months=0, weeks=0, days=0)
        """
        return cls(years=years)

    @classmethod
    def of_months(cls, months: int) -> Period:
        """Create a Period of a given number of months.

        Args:
            months: Number of months (can be negative).

        Returns:
            A Period representing the specified months.

        Examples:
            >>> Period.of_months(6)
            Period(years=0, months=6, weeks=0, days=0)
        """
        return cls(months=months)

    @classmethod
    def of_weeks(cls, weeks: int) -> Period:
        """Create a Period of a given number of weeks.

        Args:
            weeks: Number of weeks (can be negative).

        Returns:
            A Period representing the specified weeks.

        Examples:
            >>> Period.of_weeks(2)
            Period(years=0, months=0, weeks=2, days=0)
        """
        return cls(weeks=weeks)

    @classmethod
    def of_days(cls, days: int) -> Period:
        """Create a Period of a given number of days.

        Args:
            days: Number of days (can be negative).

        Returns:
            A Period representing the specified days.

        Examples:
            >>> Period.of_days(10)
            Period(years=0, months=0, weeks=0, days=10)
        """
        return cls(days=days)

    @classmethod
    def zero(cls) -> Period:
        """Create a zero-length period.

        Returns:
            A Period with all components set to zero.

        Examples:
            >>> Period.zero()
            Period(years=0, months=0, weeks=0, days=0)
        """
        return cls()

    @property
    def years(self) -> int:
        """Return the years component.

        Returns:
            Number of years (can be negative).
        """
        return self._years

    @property
    def months(self) -> int:
        """Return the months component.

        Returns:
            Number of months (can be negative).
        """
        return self._months

    @property
    def weeks(self) -> int:
        """Return the weeks component.

        Returns:
            Number of weeks (can be negative).
        """
        return self._weeks

    @property
    def days(self) -> int:
        """Return the days component.

        Returns:
            Number of days (can be negative).
        """
        return self._days

    @property
    def total_months(self) -> int:
        """Return the total months (years * 12 + months).

        Note: weeks and days are not included in this calculation.

        Returns:
            Total months from years and months components.

        Examples:
            >>> Period(years=1, months=2).total_months
            14
            >>> Period(years=-1, months=3).total_months
            -9
        """
        return self._years * 12 + self._months

    @property
    def total_days(self) -> int:
        """Return the total days (weeks * 7 + days).

        Note: years and months are not included since they vary by context.

        Returns:
            Total days from weeks and days components.

        Examples:
            >>> Period(weeks=2, days=3).total_days
            17
        """
        return self._weeks * 7 + self._days

    @property
    def is_zero(self) -> bool:
        """Return True if this is a zero-length period.

        Returns:
            True if all components are zero.

        Examples:
            >>> Period.zero().is_zero
            True
            >>> Period(days=1).is_zero
            False
        """
        return (
            self._years == 0
            and self._months == 0
            and self._weeks == 0
            and self._days == 0
        )

    def normalized(self) -> Period:
        """Return a normalized Period with months < 12 and days < 7.

        Normalizes:
        - Months to years + remaining months
        - Days to weeks + remaining days

        The signs are preserved within each category:
        - Years and months have consistent sign
        - Weeks and days have consistent sign

        Returns:
            A new Period with normalized components.

        Examples:
            >>> Period(months=14).normalized()
            Period(years=1, months=2, weeks=0, days=0)

            >>> Period(days=10).normalized()
            Period(years=0, months=0, weeks=1, days=3)
        """
        # Normalize months to years
        total_months = self._years * 12 + self._months
        years, months = divmod(total_months, 12)

        # Normalize days to weeks
        total_days = self._weeks * 7 + self._days
        weeks, days = divmod(total_days, 7)

        return Period(years=years, months=months, weeks=weeks, days=days)

    def to_duration(self, reference: Date) -> Duration:
        """Convert this Period to an exact Duration using a reference date.

        Since months and years have variable lengths, a reference date is
        needed to compute the exact duration. The duration is calculated
        as the difference between `reference + self` and `reference`.

        Args:
            reference: The reference date for calculating exact days.

        Returns:
            A Duration representing the exact time span.

        Examples:
            >>> from temporale.core.date import Date
            >>> Period(months=1).to_duration(Date(2024, 1, 15))  # February
            Duration(days=29, seconds=0, nanoseconds=0)

            >>> Period(months=1).to_duration(Date(2024, 3, 15))  # April
            Duration(days=30, seconds=0, nanoseconds=0)
        """
        from temporale.core.duration import Duration
        from temporale.arithmetic.period_ops import add_period_to_date

        # Calculate the target date
        target = add_period_to_date(reference, self)

        # Return the difference as a Duration
        return target - reference

    def __add__(self, other: object) -> Period:
        """Add two Periods together.

        Args:
            other: Another Period to add.

        Returns:
            A new Period with summed components.

        Raises:
            TypeError: If other is not a Period.

        Examples:
            >>> Period(years=1, months=3) + Period(months=6)
            Period(years=1, months=9, weeks=0, days=0)
        """
        if not isinstance(other, Period):
            return NotImplemented
        return Period(
            years=self._years + other._years,
            months=self._months + other._months,
            weeks=self._weeks + other._weeks,
            days=self._days + other._days,
        )

    def __radd__(self, other: object) -> Period:
        """Support sum() by handling 0 + Period."""
        if other == 0:
            return self
        return NotImplemented

    def __sub__(self, other: object) -> Period:
        """Subtract one Period from another.

        Args:
            other: Another Period to subtract.

        Returns:
            A new Period with subtracted components.

        Raises:
            TypeError: If other is not a Period.

        Examples:
            >>> Period(years=2) - Period(months=6)
            Period(years=2, months=-6, weeks=0, days=0)
        """
        if not isinstance(other, Period):
            return NotImplemented
        return Period(
            years=self._years - other._years,
            months=self._months - other._months,
            weeks=self._weeks - other._weeks,
            days=self._days - other._days,
        )

    def __neg__(self) -> Period:
        """Return the negation of this period.

        Returns:
            A new Period with all components negated.

        Examples:
            >>> -Period(years=1, months=2)
            Period(years=-1, months=-2, weeks=0, days=0)
        """
        return Period(
            years=-self._years,
            months=-self._months,
            weeks=-self._weeks,
            days=-self._days,
        )

    def __pos__(self) -> Period:
        """Return a copy of this period (unary +).

        Returns:
            A new Period with the same values.
        """
        return Period(
            years=self._years,
            months=self._months,
            weeks=self._weeks,
            days=self._days,
        )

    def __mul__(self, other: object) -> Period:
        """Multiply a period by a scalar.

        Args:
            other: An integer multiplier.

        Returns:
            A new Period scaled by the multiplier.

        Raises:
            TypeError: If other is not an integer.

        Examples:
            >>> Period(months=3) * 2
            Period(years=0, months=6, weeks=0, days=0)
        """
        if not isinstance(other, int):
            return NotImplemented
        return Period(
            years=self._years * other,
            months=self._months * other,
            weeks=self._weeks * other,
            days=self._days * other,
        )

    def __rmul__(self, other: object) -> Period:
        """Support scalar * Period."""
        return self.__mul__(other)

    def __eq__(self, other: object) -> bool:
        """Check equality with another period.

        Two periods are equal if all their components are equal.
        Note: Period(months=12) != Period(years=1) because components
        are compared directly. Use normalized() for semantic comparison.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a Period with the same components.

        Examples:
            >>> Period(months=12) == Period(months=12)
            True
            >>> Period(months=12) == Period(years=1)
            False
        """
        if not isinstance(other, Period):
            return NotImplemented
        return (
            self._years == other._years
            and self._months == other._months
            and self._weeks == other._weeks
            and self._days == other._days
        )

    def __ne__(self, other: object) -> bool:
        """Check inequality with another period."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __hash__(self) -> int:
        """Return a hash for this period.

        Returns:
            Hash based on all components.
        """
        return hash((self._years, self._months, self._weeks, self._days))

    def __repr__(self) -> str:
        """Return a detailed string representation.

        Returns:
            String showing all component values.
        """
        return (
            f"Period(years={self._years}, months={self._months}, "
            f"weeks={self._weeks}, days={self._days})"
        )

    def __str__(self) -> str:
        """Return a human-readable string representation.

        Returns:
            String like "1 year, 2 months" or "P1Y2M" in ISO 8601 format.
        """
        if self.is_zero:
            return "P0D"

        parts = []

        # Date part (years, months, days including weeks)
        if self._years != 0:
            parts.append(f"{self._years}Y")
        if self._months != 0:
            parts.append(f"{self._months}M")

        total_days = self._weeks * 7 + self._days
        if total_days != 0:
            parts.append(f"{total_days}D")

        if not parts:
            return "P0D"

        return "P" + "".join(parts)

    def __bool__(self) -> bool:
        """Return True if this is a non-zero period."""
        return not self.is_zero


__all__ = ["Period"]
