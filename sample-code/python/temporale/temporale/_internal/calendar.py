"""Calendar utilities for Temporale.

This module provides internal functions for calendar calculations,
including MJD (Modified Julian Day) conversions and leap year logic.

MJD 0 = 1858-11-17 00:00 UTC (November 17, 1858)

This module is not part of the public API.
"""

from __future__ import annotations

from temporale._internal.constants import DAYS_IN_MONTH, MIN_YEAR, MAX_YEAR


def is_leap_year(year: int) -> bool:
    """Check if a year is a leap year in the proleptic Gregorian calendar.

    A year is a leap year if:
    - Divisible by 4, AND
    - NOT divisible by 100, unless also divisible by 400

    Args:
        year: The year to check (can be negative for BCE).

    Returns:
        True if the year is a leap year.

    Examples:
        >>> is_leap_year(2000)  # Divisible by 400
        True
        >>> is_leap_year(1900)  # Divisible by 100 but not 400
        False
        >>> is_leap_year(2024)  # Divisible by 4 but not 100
        True
        >>> is_leap_year(2023)  # Not divisible by 4
        False
    """
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year: int, month: int) -> int:
    """Return the number of days in a given month.

    Args:
        year: The year (needed for February in leap years).
        month: The month (1-12).

    Returns:
        Number of days in the month.

    Raises:
        ValueError: If month is not in 1-12.
    """
    if month < 1 or month > 12:
        raise ValueError(f"month must be 1-12, got {month}")

    if month == 2 and is_leap_year(year):
        return 29
    return DAYS_IN_MONTH[month]


def days_in_year(year: int) -> int:
    """Return the number of days in a year.

    Args:
        year: The year to check.

    Returns:
        366 for leap years, 365 otherwise.
    """
    return 366 if is_leap_year(year) else 365


# Days before each month (cumulative), for non-leap years
# Index 0 is unused, months are 1-indexed
_DAYS_BEFORE_MONTH = (0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)


def _days_before_month(year: int, month: int) -> int:
    """Return the number of days in the year before the first of the month.

    Args:
        year: The year (for leap year calculation).
        month: The month (1-12).

    Returns:
        Number of days before the month in that year.
    """
    result = _DAYS_BEFORE_MONTH[month]
    if month > 2 and is_leap_year(year):
        result += 1
    return result


def ymd_to_ordinal(year: int, month: int, day: int) -> int:
    """Convert year, month, day to ordinal (days since year 1).

    The ordinal for 0001-01-01 is 1.
    The ordinal for 0000-12-31 (last day of year 0 / 1 BCE) is 0.

    Args:
        year: The year (astronomical, can be 0 or negative).
        month: The month (1-12).
        day: The day (1-31).

    Returns:
        The ordinal day number.
    """
    # Days before this year, relative to year 1
    # For year 1: y - 1 = 0, so days_before = 0
    # For year 2: y - 1 = 1, so days_before = 365
    # For year 0: y - 1 = -1, so we need special handling
    y = year - 1

    # Number of days in complete years before year `year`
    # This formula works for both positive and negative years
    # Python's // always floors toward negative infinity, which is what we need
    days_before_year = (
        y * 365 + y // 4 - y // 100 + y // 400
    )

    return days_before_year + _days_before_month(year, month) + day


def ordinal_to_ymd(ordinal: int) -> tuple[int, int, int]:
    """Convert ordinal (days since year 1) to year, month, day.

    Args:
        ordinal: The ordinal day number (ordinal 1 = 0001-01-01).

    Returns:
        Tuple of (year, month, day).
    """
    # Handle the special cases for ordinals <= 0 (BCE dates)
    if ordinal <= 0:
        # Work backwards from year 0
        # ordinal 0 = 0000-12-31
        # ordinal -365 = 0000-01-01 (since year 0 is a leap year with 366 days)
        # Actually: ordinal -365 would be... let me recalculate
        # year 0 ordinal range: from (-365) to 0 if leap, or (-364) to 0
        # Year 0 is a leap year (divisible by 400 equivalent for 0)
        # So year 0 has 366 days: ordinals from -365 to 0

        # Count backwards: subtract days from each year until we find our year
        year = 0
        remaining = 1 - ordinal  # days before ordinal 1, i.e., days "before" year 1

        while remaining > 0:
            year_days = days_in_year(year)
            if remaining <= year_days:
                # This ordinal is in year `year`
                doy = year_days - remaining + 1  # 1-indexed day of year
                month, day = _doy_to_md(year, doy)
                return (year, month, day)
            remaining -= year_days
            year -= 1

        # Shouldn't reach here
        raise ValueError(f"Invalid ordinal: {ordinal}")

    # For positive ordinals, use the standard algorithm
    # Based on Python's datetime module algorithm

    # n is 0-indexed (n=0 means ordinal=1)
    n = ordinal - 1

    # 400-year cycles: each has 146097 days
    n400, n = divmod(n, 146097)

    # 100-year cycles within the 400: each has 36524 days (except last which has 36525)
    n100, n = divmod(n, 36524)

    # 4-year cycles within the 100: each has 1461 days
    n4, n = divmod(n, 1461)

    # Years within the 4-year cycle: each has 365 days (except leap year)
    n1, n = divmod(n, 365)

    # Calculate the year
    year = n400 * 400 + n100 * 100 + n4 * 4 + n1 + 1

    # Handle the boundary case at the end of a cycle
    if n1 == 4 or (n100 == 4 and n4 == 0 and n1 == 0):
        # December 31 of the previous leap year
        return (year - 1, 12, 31)

    # n is now the 0-indexed day of year
    doy = n + 1  # Convert to 1-indexed
    month, day = _doy_to_md(year, doy)
    return (year, month, day)


def _doy_to_md(year: int, doy: int) -> tuple[int, int]:
    """Convert day-of-year to month and day.

    Args:
        year: The year (for leap year calculation).
        doy: Day of year (1-366).

    Returns:
        Tuple of (month, day).
    """
    for month in range(1, 13):
        dim = days_in_month(year, month)
        if doy <= dim:
            return (month, doy)
        doy -= dim

    # Should never reach here for valid doy
    raise ValueError(f"Invalid day of year: {doy} for year {year}")


# MJD conversion
# MJD 0 = November 17, 1858
# First compute the ordinal for 1858-11-17
_MJD_EPOCH_ORDINAL = ymd_to_ordinal(1858, 11, 17)


def ymd_to_mjd(year: int, month: int, day: int) -> int:
    """Convert year, month, day to Modified Julian Day number.

    Args:
        year: The year (astronomical, can be 0 or negative).
        month: The month (1-12).
        day: The day (1-31).

    Returns:
        The MJD number.
    """
    ordinal = ymd_to_ordinal(year, month, day)
    return ordinal - _MJD_EPOCH_ORDINAL


def mjd_to_ymd(mjd: int) -> tuple[int, int, int]:
    """Convert Modified Julian Day number to year, month, day.

    Args:
        mjd: The MJD number.

    Returns:
        Tuple of (year, month, day).
    """
    ordinal = mjd + _MJD_EPOCH_ORDINAL
    return ordinal_to_ymd(ordinal)


def mjd_to_day_of_week(mjd: int) -> int:
    """Convert MJD to day of week (Monday=0, Sunday=6).

    Args:
        mjd: The MJD number.

    Returns:
        Day of week (0=Monday, 6=Sunday).
    """
    # MJD 0 (1858-11-17) was a Wednesday (day 2 in Monday=0 system)
    # So (mjd + 2) % 7 gives the correct day of week
    return (mjd + 2) % 7


def validate_date(year: int, month: int, day: int) -> None:
    """Validate that year, month, day form a valid date.

    Args:
        year: The year to validate.
        month: The month to validate.
        day: The day to validate.

    Raises:
        ValueError: If the date is invalid.
    """
    if year < MIN_YEAR or year > MAX_YEAR:
        raise ValueError(f"year must be between {MIN_YEAR} and {MAX_YEAR}, got {year}")
    if month < 1 or month > 12:
        raise ValueError(f"month must be 1-12, got {month}")

    max_day = days_in_month(year, month)
    if day < 1 or day > max_day:
        raise ValueError(
            f"day must be 1-{max_day} for {year}-{month:02d}, got {day}"
        )


__all__ = [
    "is_leap_year",
    "days_in_month",
    "days_in_year",
    "ymd_to_ordinal",
    "ordinal_to_ymd",
    "ymd_to_mjd",
    "mjd_to_ymd",
    "mjd_to_day_of_week",
    "validate_date",
]
