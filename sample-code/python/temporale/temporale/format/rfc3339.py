"""RFC 3339 formatting and parsing.

RFC 3339 is a profile of ISO 8601 that defines a strict subset for
datetime representations in internet protocols. Key differences from
general ISO 8601:

1. Date and time must be separated by 'T' (not space)
2. Timezone is required for timestamps
3. Timezone must be 'Z' or '+/-HH:MM' format
4. Fractional seconds are optional but allowed

This module provides functions for RFC 3339 compliant formatting and parsing.

Functions:
    parse_rfc3339: Parse an RFC 3339 string into a DateTime.
    format_rfc3339: Format a DateTime as an RFC 3339 string.

Examples:
    >>> from temporale import DateTime
    >>> from temporale.format import parse_rfc3339, format_rfc3339

    >>> dt = parse_rfc3339("2024-01-15T14:30:45Z")
    >>> dt.year
    2024

    >>> format_rfc3339(DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc()))
    '2024-01-15T14:30:45Z'
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from temporale.errors import ParseError

if TYPE_CHECKING:
    from temporale.core.datetime import DateTime


# RFC 3339 datetime pattern
# YYYY-MM-DDTHH:MM:SS[.fraction]Z or YYYY-MM-DDTHH:MM:SS[.fraction]+/-HH:MM
_RFC3339_PATTERN = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})"  # Date: YYYY-MM-DD
    r"[Tt]"  # T separator (case insensitive)
    r"(\d{2}):(\d{2}):(\d{2})"  # Time: HH:MM:SS
    r"(?:\.(\d{1,9}))?"  # Optional fractional seconds
    r"([Zz]|[+-]\d{2}:\d{2})$"  # Required timezone
)


def parse_rfc3339(s: str) -> "DateTime":
    """Parse an RFC 3339 datetime string.

    RFC 3339 requires a full datetime with timezone. Unlike ISO 8601,
    the 'T' separator is mandatory and timezone is required.

    Args:
        s: The RFC 3339 datetime string to parse.

    Returns:
        An aware DateTime (always has timezone).

    Raises:
        ParseError: If the string is not valid RFC 3339 format.
        ValidationError: If the datetime components are invalid.

    Examples:
        >>> parse_rfc3339("2024-01-15T14:30:45Z")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0, timezone=UTC)

        >>> parse_rfc3339("2024-01-15T14:30:45+05:30")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0, timezone=+05:30)

        >>> parse_rfc3339("2024-01-15T14:30:45.123456789Z")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123456789, timezone=UTC)

        >>> parse_rfc3339("2024-01-15 14:30:45Z")  # doctest: +IGNORE_EXCEPTION_DETAIL
        Traceback (most recent call last):
        ...
        ParseError: Invalid RFC 3339 format...
    """
    from temporale.core.datetime import DateTime
    from temporale.units.timezone import Timezone

    s = s.strip()
    if not s:
        raise ParseError("empty string")

    match = _RFC3339_PATTERN.match(s)
    if not match:
        raise ParseError(
            f"Invalid RFC 3339 format: {s!r}. "
            "Expected YYYY-MM-DDTHH:MM:SS[.fraction]Z or "
            "YYYY-MM-DDTHH:MM:SS[.fraction]+/-HH:MM"
        )

    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6))

    # Parse fractional seconds
    frac_str = match.group(7)
    if frac_str:
        # Pad to 9 digits for nanoseconds
        nanosecond = int(frac_str.ljust(9, "0")[:9])
    else:
        nanosecond = 0

    # Parse timezone
    tz_str = match.group(8)
    timezone = Timezone.from_string(tz_str)

    return DateTime(
        year,
        month,
        day,
        hour,
        minute,
        second,
        nanosecond=nanosecond,
        timezone=timezone,
    )


def format_rfc3339(
    value: "DateTime",
    *,
    precision: str = "auto",
) -> str:
    """Format a DateTime as an RFC 3339 string.

    RFC 3339 requires timezone information. If the DateTime is naive
    (no timezone), this function raises an error.

    Args:
        value: A DateTime to format. Must have timezone.
        precision: Subsecond precision:
            - "auto": Include subseconds only if non-zero, minimal digits
            - "seconds": No subseconds
            - "millis": Always 3 decimal places
            - "micros": Always 6 decimal places
            - "nanos": Always 9 decimal places

    Returns:
        RFC 3339 formatted string.

    Raises:
        ValueError: If the DateTime is naive (no timezone).
        TypeError: If value is not a DateTime.

    Examples:
        >>> from temporale import DateTime
        >>> from temporale.units.timezone import Timezone

        >>> dt = DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc())
        >>> format_rfc3339(dt)
        '2024-01-15T14:30:45Z'

        >>> dt = DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123000000, timezone=Timezone.utc())
        >>> format_rfc3339(dt, precision="millis")
        '2024-01-15T14:30:45.123Z'

        >>> dt_naive = DateTime(2024, 1, 15, 14, 30, 45)
        >>> format_rfc3339(dt_naive)  # doctest: +IGNORE_EXCEPTION_DETAIL
        Traceback (most recent call last):
        ...
        ValueError: RFC 3339 requires timezone...
    """
    from temporale.core.datetime import DateTime as DateTimeClass

    if not isinstance(value, DateTimeClass):
        raise TypeError(f"expected DateTime, got {type(value).__name__}")

    if value.timezone is None:
        raise ValueError(
            "RFC 3339 requires timezone information. "
            "Use format_iso8601 for naive datetimes or add a timezone."
        )

    # Use ISO 8601 formatter - it already produces RFC 3339 compliant output
    # for aware datetimes
    return value.to_iso_format(precision=precision)


__all__ = ["parse_rfc3339", "format_rfc3339"]
