"""Period arithmetic operations for temporal types.

This module provides functions for adding Period values to Date and DateTime,
implementing the month overflow clamping behavior specified in the plan.

Clamping behavior:
    When adding a Period results in an invalid date (e.g., Jan 31 + 1 month),
    the day is clamped to the last valid day of the target month.

Examples:
    Date(2024, 1, 31) + Period(months=1) -> Date(2024, 2, 29)  # leap year
    Date(2023, 1, 31) + Period(months=1) -> Date(2023, 2, 28)
    Date(2024, 3, 31) + Period(months=1) -> Date(2024, 4, 30)
    Date(2024, 2, 29) + Period(years=1)  -> Date(2025, 2, 28)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from temporale._internal.calendar import days_in_month

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.period import Period


def add_period_to_date(date: Date, period: Period) -> Date:
    """Add a Period to a Date, clamping day if necessary.

    This function implements the month overflow clamping behavior:
    if the resulting date would have an invalid day (e.g., Feb 31),
    the day is clamped to the last valid day of that month.

    The components are applied in order:
    1. Years
    2. Months
    3. Weeks and days (as total_days)

    Args:
        date: The date to add to.
        period: The period to add.

    Returns:
        A new Date offset by the period.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.period import Period
        >>> add_period_to_date(Date(2024, 1, 31), Period(months=1))
        Date(2024, 2, 29)

        >>> add_period_to_date(Date(2024, 2, 29), Period(years=1))
        Date(2025, 2, 28)
    """
    from temporale.core.date import Date

    # Get current components
    year = date.year
    month = date.month
    day = date.day

    # Step 1: Add years
    year += period.years

    # Step 2: Add months (with year overflow)
    total_months = year * 12 + (month - 1) + period.months
    year = total_months // 12
    month = (total_months % 12) + 1

    # Handle negative total_months properly
    if month < 1:
        month += 12
        year -= 1
    elif month > 12:
        month -= 12
        year += 1

    # Step 3: Clamp day to valid range for the new year/month
    max_day = days_in_month(year, month)
    day = min(day, max_day)

    # Create the intermediate date (after year/month adjustments)
    result = Date(year, month, day)

    # Step 4: Add weeks and days
    total_days = period.weeks * 7 + period.days
    if total_days != 0:
        result = result.add_days(total_days)

    return result


def subtract_period_from_date(date: Date, period: Period) -> Date:
    """Subtract a Period from a Date.

    This is equivalent to adding the negated period.

    Args:
        date: The date to subtract from.
        period: The period to subtract.

    Returns:
        A new Date offset by the negated period.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.period import Period
        >>> subtract_period_from_date(Date(2024, 3, 31), Period(months=1))
        Date(2024, 2, 29)
    """
    return add_period_to_date(date, -period)


def add_period_to_datetime(dt: DateTime, period: Period) -> DateTime:
    """Add a Period to a DateTime, clamping day if necessary.

    The time component is preserved; only the date is modified.

    Args:
        dt: The datetime to add to.
        period: The period to add.

    Returns:
        A new DateTime offset by the period, with time preserved.

    Examples:
        >>> from temporale.core.datetime import DateTime
        >>> from temporale.core.period import Period
        >>> add_period_to_datetime(DateTime(2024, 1, 31, 14, 30, 0), Period(months=1))
        DateTime(2024, 2, 29, 14, 30, 0, nanosecond=0)
    """
    from temporale.core.datetime import DateTime

    # Add the period to the date component
    new_date = add_period_to_date(dt.date(), period)

    # Reconstruct DateTime with same time and timezone
    return DateTime(
        new_date.year,
        new_date.month,
        new_date.day,
        dt.hour,
        dt.minute,
        dt.second,
        nanosecond=dt.nanosecond,
        timezone=dt.timezone,
    )


def subtract_period_from_datetime(dt: DateTime, period: Period) -> DateTime:
    """Subtract a Period from a DateTime.

    This is equivalent to adding the negated period.

    Args:
        dt: The datetime to subtract from.
        period: The period to subtract.

    Returns:
        A new DateTime offset by the negated period.
    """
    return add_period_to_datetime(dt, -period)


__all__ = [
    "add_period_to_date",
    "subtract_period_from_date",
    "add_period_to_datetime",
    "subtract_period_from_datetime",
]
