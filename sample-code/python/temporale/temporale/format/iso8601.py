"""ISO 8601 formatting and parsing.

This module provides functions for converting temporal objects to and from
ISO 8601 string representations.

Functions:
    parse_iso8601: Parse an ISO 8601 string into a temporal object.
    format_iso8601: Format a temporal object as an ISO 8601 string.

The ISO 8601 standard defines date and time representations. This module
supports the most common formats:

Dates:
    - YYYY-MM-DD (extended format)
    - -YYYY-MM-DD (negative years for BCE)

Times:
    - HH:MM:SS
    - HH:MM:SS.f (fractional seconds, 1-9 digits)
    - HH:MM

DateTimes:
    - YYYY-MM-DDTHH:MM:SS
    - YYYY-MM-DDTHH:MM:SS.f
    - YYYY-MM-DDTHH:MM:SSZ
    - YYYY-MM-DDTHH:MM:SS+HH:MM
    - YYYY-MM-DDTHH:MM:SS-HH:MM

Examples:
    >>> from temporale import DateTime, Date, Time
    >>> from temporale.format import parse_iso8601, format_iso8601

    >>> dt = parse_iso8601("2024-01-15T14:30:45Z")
    >>> dt.year
    2024

    >>> format_iso8601(DateTime(2024, 1, 15, 14, 30, 45))
    '2024-01-15T14:30:45'
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Union, overload

from temporale.errors import ParseError

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

# Type alias for temporal objects
TemporalType = Union["Date", "Time", "DateTime"]


def parse_iso8601(s: str) -> TemporalType:
    """Parse an ISO 8601 string into a temporal object.

    Automatically detects whether the string represents a date, time,
    or datetime based on its format.

    Args:
        s: The ISO 8601 string to parse.

    Returns:
        A Date, Time, or DateTime object depending on the input format.

    Raises:
        ParseError: If the string is not valid ISO 8601 format.
        ValidationError: If the parsed components are invalid.

    Detection rules:
        - Contains 'T' or space separator -> DateTime
        - Contains ':' but no '-' -> Time
        - Contains '-' -> Date or DateTime
        - Compact format HHMMSS -> Time

    Examples:
        >>> parse_iso8601("2024-01-15")
        Date(2024, 1, 15)

        >>> parse_iso8601("14:30:45")
        Time(14, 30, 45, nanosecond=0)

        >>> parse_iso8601("2024-01-15T14:30:45")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)

        >>> parse_iso8601("2024-01-15T14:30:45Z")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0, timezone=UTC)
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

    s = s.strip()
    if not s:
        raise ParseError("empty string")

    # Check for datetime separators
    has_date_sep = "-" in s
    has_time_sep = ":" in s
    has_t_sep = "T" in s or "t" in s
    has_space_sep = " " in s and len(s) > 10

    # DateTime: has T separator or space in the middle
    if has_t_sep or has_space_sep:
        # Normalize lowercase 't' to uppercase 'T' for DateTime.from_iso_format
        s_normalized = s.replace("t", "T")
        return DateTime.from_iso_format(s_normalized)

    # Time-only: has colons but no date dashes (or is compact time format)
    # Check for compact time format: HHMMSS or HHMM
    if has_time_sep and not has_date_sep:
        return Time.from_iso_format(s)

    # Check for compact time format: 6 digits possibly with fraction
    if (
        len(s) >= 6
        and s[:6].isdigit()
        and (len(s) == 6 or s[6] == ".")
        and not has_date_sep
    ):
        return Time.from_iso_format(s)

    # Date-only: has dashes but no time component
    if has_date_sep:
        # Could still be datetime if there's timezone but no T
        # Check for timezone suffix without T (not standard but might appear)
        if has_time_sep:
            # Has both - and : but no T, treat as datetime with space
            return DateTime.from_iso_format(s)
        return Date.from_iso_format(s)

    raise ParseError(
        f"cannot determine ISO 8601 format for: {s!r}. "
        "Expected date (YYYY-MM-DD), time (HH:MM:SS), or datetime (YYYY-MM-DDTHH:MM:SS)"
    )


@overload
def format_iso8601(
    value: "Date",
    *,
    precision: str = "auto",
) -> str: ...


@overload
def format_iso8601(
    value: "Time",
    *,
    precision: str = "auto",
) -> str: ...


@overload
def format_iso8601(
    value: "DateTime",
    *,
    precision: str = "auto",
) -> str: ...


def format_iso8601(
    value: TemporalType,
    *,
    precision: str = "auto",
) -> str:
    """Format a temporal object as an ISO 8601 string.

    Args:
        value: A Date, Time, or DateTime to format.
        precision: Subsecond precision (for Time and DateTime):
            - "auto": Include subseconds only if non-zero, minimal digits
            - "seconds": No subseconds (HH:MM:SS)
            - "millis": Always 3 decimal places
            - "micros": Always 6 decimal places
            - "nanos": Always 9 decimal places

    Returns:
        ISO 8601 formatted string.

    Examples:
        >>> from temporale import Date, Time, DateTime
        >>> format_iso8601(Date(2024, 1, 15))
        '2024-01-15'

        >>> format_iso8601(Time(14, 30, 45))
        '14:30:45'

        >>> format_iso8601(DateTime(2024, 1, 15, 14, 30, 45))
        '2024-01-15T14:30:45'

        >>> format_iso8601(Time(14, 30, 45, nanosecond=123000000), precision="nanos")
        '14:30:45.123000000'
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

    if isinstance(value, DateTime):
        return value.to_iso_format(precision=precision)
    elif isinstance(value, Date):
        return value.to_iso_format()
    elif isinstance(value, Time):
        return value.to_iso_format(precision=precision)
    else:
        raise TypeError(
            f"expected Date, Time, or DateTime, got {type(value).__name__}"
        )


__all__ = ["parse_iso8601", "format_iso8601"]
