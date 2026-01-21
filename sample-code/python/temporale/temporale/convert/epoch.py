"""Epoch conversion utilities for temporal objects.

This module provides functions for converting between temporal objects and
various epoch-based timestamps (Unix seconds, milliseconds, nanoseconds).

Functions:
    to_unix_seconds: Convert DateTime to Unix timestamp in seconds.
    from_unix_seconds: Create DateTime from Unix seconds.
    to_unix_millis: Convert DateTime to Unix timestamp in milliseconds.
    from_unix_millis: Create DateTime from Unix milliseconds.
    to_unix_nanos: Convert DateTime to Unix timestamp in nanoseconds.
    from_unix_nanos: Create DateTime from Unix nanoseconds.

The Unix epoch is 1970-01-01 00:00:00 UTC (MJD 40587).

Examples:
    >>> from temporale import DateTime
    >>> from temporale.convert import to_unix_seconds, from_unix_seconds

    >>> dt = DateTime(1970, 1, 1, 0, 0, 0, timezone=Timezone.utc())
    >>> to_unix_seconds(dt)
    0

    >>> from_unix_seconds(0).year
    1970
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from temporale.core.datetime import DateTime
    from temporale.units.timezone import Timezone


def to_unix_seconds(dt: "DateTime") -> int:
    """Convert a DateTime to Unix timestamp in seconds.

    For aware datetimes, this returns the UTC timestamp.
    For naive datetimes, this assumes local time equals UTC.

    Args:
        dt: The DateTime to convert.

    Returns:
        Unix timestamp in seconds since 1970-01-01 00:00:00 UTC.

    Examples:
        >>> from temporale import DateTime
        >>> from temporale.units.timezone import Timezone

        >>> dt = DateTime(1970, 1, 1, 0, 0, 0, timezone=Timezone.utc())
        >>> to_unix_seconds(dt)
        0

        >>> dt = DateTime(2024, 1, 15, 12, 30, 0, timezone=Timezone.utc())
        >>> to_unix_seconds(dt)
        1705322200
    """
    return dt.to_unix_seconds()


def from_unix_seconds(
    seconds: int,
    *,
    timezone: "Timezone | None" = None,
) -> "DateTime":
    """Create a DateTime from Unix seconds.

    Args:
        seconds: Unix timestamp in seconds since 1970-01-01 00:00:00 UTC.
        timezone: Optional timezone for the result. If None, returns naive datetime.

    Returns:
        A DateTime representing the given timestamp.

    Examples:
        >>> from temporale.units.timezone import Timezone

        >>> dt = from_unix_seconds(0, timezone=Timezone.utc())
        >>> dt.year, dt.month, dt.day
        (1970, 1, 1)

        >>> dt = from_unix_seconds(1705322200, timezone=Timezone.utc())
        >>> dt.year
        2024
    """
    from temporale.core.datetime import DateTime

    return DateTime.from_unix_seconds(seconds, timezone=timezone)


def to_unix_millis(dt: "DateTime") -> int:
    """Convert a DateTime to Unix timestamp in milliseconds.

    For aware datetimes, this returns the UTC timestamp.
    For naive datetimes, this assumes local time equals UTC.

    Args:
        dt: The DateTime to convert.

    Returns:
        Unix timestamp in milliseconds since 1970-01-01 00:00:00 UTC.

    Examples:
        >>> from temporale import DateTime
        >>> from temporale.units.timezone import Timezone

        >>> dt = DateTime(1970, 1, 1, 0, 0, 0, nanosecond=500_000_000, timezone=Timezone.utc())
        >>> to_unix_millis(dt)
        500
    """
    return dt.to_unix_millis()


def from_unix_millis(
    millis: int,
    *,
    timezone: "Timezone | None" = None,
) -> "DateTime":
    """Create a DateTime from Unix milliseconds.

    Args:
        millis: Unix timestamp in milliseconds since 1970-01-01 00:00:00 UTC.
        timezone: Optional timezone for the result. If None, returns naive datetime.

    Returns:
        A DateTime representing the given timestamp.

    Examples:
        >>> from temporale.units.timezone import Timezone

        >>> dt = from_unix_millis(500, timezone=Timezone.utc())
        >>> dt.millisecond
        500

        >>> dt = from_unix_millis(1705322200123, timezone=Timezone.utc())
        >>> dt.year
        2024
        >>> dt.millisecond
        123
    """
    from temporale.core.datetime import DateTime

    return DateTime.from_unix_millis(millis, timezone=timezone)


def to_unix_nanos(dt: "DateTime") -> int:
    """Convert a DateTime to Unix timestamp in nanoseconds.

    For aware datetimes, this returns the UTC timestamp.
    For naive datetimes, this assumes local time equals UTC.

    Args:
        dt: The DateTime to convert.

    Returns:
        Unix timestamp in nanoseconds since 1970-01-01 00:00:00 UTC.

    Examples:
        >>> from temporale import DateTime
        >>> from temporale.units.timezone import Timezone

        >>> dt = DateTime(1970, 1, 1, 0, 0, 0, nanosecond=123, timezone=Timezone.utc())
        >>> to_unix_nanos(dt)
        123
    """
    return dt.to_unix_nanos()


def from_unix_nanos(
    nanos: int,
    *,
    timezone: "Timezone | None" = None,
) -> "DateTime":
    """Create a DateTime from Unix nanoseconds.

    Args:
        nanos: Unix timestamp in nanoseconds since 1970-01-01 00:00:00 UTC.
        timezone: Optional timezone for the result. If None, returns naive datetime.

    Returns:
        A DateTime representing the given timestamp.

    Examples:
        >>> from temporale.units.timezone import Timezone

        >>> dt = from_unix_nanos(123_456_789, timezone=Timezone.utc())
        >>> dt.nanosecond
        123456789

        >>> dt = from_unix_nanos(1705322200123456789, timezone=Timezone.utc())
        >>> dt.year
        2024
        >>> dt.nanosecond
        123456789
    """
    from temporale.core.datetime import DateTime

    return DateTime.from_unix_nanos(nanos, timezone=timezone)


__all__ = [
    "to_unix_seconds",
    "from_unix_seconds",
    "to_unix_millis",
    "from_unix_millis",
    "to_unix_nanos",
    "from_unix_nanos",
]
