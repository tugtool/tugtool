"""TimeUnit enumeration for standard time units.

This module provides the TimeUnit enum representing various
time measurement units from nanoseconds to years.
"""

from __future__ import annotations

from enum import Enum


class TimeUnit(Enum):
    """Standard time units for temporal operations.

    TimeUnit provides a hierarchy of time measurement units,
    from nanoseconds up to years. Each unit knows its approximate
    conversion to seconds (where applicable).

    Note:
        YEAR and MONTH do not have fixed second equivalents due to
        variable lengths (leap years, different month lengths).
        The to_seconds() method returns None for these units.

    Examples:
        >>> TimeUnit.HOUR.to_seconds()
        3600

        >>> TimeUnit.NANOSECOND.to_seconds()
        1e-09

        >>> TimeUnit.MONTH.to_seconds() is None
        True
    """

    NANOSECOND = "nanosecond"
    MICROSECOND = "microsecond"
    MILLISECOND = "millisecond"
    SECOND = "second"
    MINUTE = "minute"
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"

    def to_seconds(self) -> float | None:
        """Convert one unit of this TimeUnit to seconds.

        Returns:
            The number of seconds in one unit, or None for variable-length
            units (MONTH and YEAR).

        Examples:
            >>> TimeUnit.MINUTE.to_seconds()
            60

            >>> TimeUnit.DAY.to_seconds()
            86400
        """
        conversions: dict[TimeUnit, float | None] = {
            TimeUnit.NANOSECOND: 1e-9,
            TimeUnit.MICROSECOND: 1e-6,
            TimeUnit.MILLISECOND: 1e-3,
            TimeUnit.SECOND: 1,
            TimeUnit.MINUTE: 60,
            TimeUnit.HOUR: 3600,
            TimeUnit.DAY: 86400,
            TimeUnit.WEEK: 604800,
            TimeUnit.MONTH: None,  # Variable length
            TimeUnit.YEAR: None,  # Variable length (leap years)
        }
        return conversions[self]


__all__ = ["TimeUnit"]
