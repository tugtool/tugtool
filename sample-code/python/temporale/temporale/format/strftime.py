"""strftime-style formatting and parsing.

This module provides strftime-style formatting for temporal objects.
It supports a minimal subset of format directives that covers common
use cases while avoiding locale-dependent behavior.

Supported Directives:
    %Y - 4-digit year (e.g., 2024)
    %m - 2-digit month (01-12)
    %d - 2-digit day (01-31)
    %H - 2-digit hour, 24-hour (00-23)
    %M - 2-digit minute (00-59)
    %S - 2-digit second (00-59)
    %f - Microseconds (000000-999999)
    %z - UTC offset (+0000, -0530)
    %Z - Timezone name (UTC, +05:30)
    %% - Literal %

Not Supported (locale-dependent):
    %a, %A - Weekday names
    %b, %B - Month names
    %c, %x, %X - Locale-specific formats
    %j - Day of year
    %U, %W - Week numbers

Functions:
    strftime: Format a temporal object using strftime-style format string.
    strptime: Parse a string using strftime-style format string.

Examples:
    >>> from temporale import DateTime
    >>> from temporale.format import strftime, strptime

    >>> dt = DateTime(2024, 1, 15, 14, 30, 45)
    >>> strftime(dt, "%Y-%m-%d %H:%M:%S")
    '2024-01-15 14:30:45'

    >>> strptime("2024-01-15 14:30:45", "%Y-%m-%d %H:%M:%S")
    DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Union

from temporale.errors import ParseError

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

# Type alias for temporal objects
TemporalType = Union["Date", "Time", "DateTime"]


# Mapping of format directives to their patterns for parsing
_PARSE_PATTERNS: dict[str, str] = {
    "%Y": r"(?P<year>[+-]?\d{4,})",  # 4-digit year (can be negative/extended)
    "%m": r"(?P<month>\d{2})",  # 2-digit month
    "%d": r"(?P<day>\d{2})",  # 2-digit day
    "%H": r"(?P<hour>\d{2})",  # 2-digit hour
    "%M": r"(?P<minute>\d{2})",  # 2-digit minute
    "%S": r"(?P<second>\d{2})",  # 2-digit second
    "%f": r"(?P<microsecond>\d{6})",  # 6-digit microsecond
    "%z": r"(?P<tz_offset>[+-]\d{4})",  # UTC offset
    "%Z": r"(?P<tz_name>[A-Za-z]+|[+-]\d{2}:\d{2})",  # Timezone name
    "%%": r"%",  # Literal %
}


def strftime(value: TemporalType, fmt: str) -> str:
    """Format a temporal object using strftime-style format string.

    Args:
        value: A Date, Time, or DateTime to format.
        fmt: Format string with %-directives.

    Returns:
        Formatted string.

    Raises:
        ValueError: If format contains unsupported directives.
        TypeError: If value is not a valid temporal type.

    Supported Directives:
        %Y - 4-digit year (e.g., 2024)
        %m - 2-digit month (01-12)
        %d - 2-digit day (01-31)
        %H - 2-digit hour, 24-hour (00-23)
        %M - 2-digit minute (00-59)
        %S - 2-digit second (00-59)
        %f - Microseconds (000000-999999)
        %z - UTC offset (+0000, -0530)
        %Z - Timezone name (UTC, +05:30)
        %% - Literal %

    Examples:
        >>> from temporale import Date, Time, DateTime

        >>> strftime(Date(2024, 1, 15), "%Y-%m-%d")
        '2024-01-15'

        >>> strftime(Time(14, 30, 45), "%H:%M:%S")
        '14:30:45'

        >>> strftime(DateTime(2024, 1, 15, 14, 30, 45), "%Y/%m/%d %H:%M")
        '2024/01/15 14:30'

        >>> strftime(Time(14, 30, 45, microsecond=123456), "%H:%M:%S.%f")
        '14:30:45.123456'
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

    result = []
    i = 0
    while i < len(fmt):
        if fmt[i] == "%" and i + 1 < len(fmt):
            directive = fmt[i : i + 2]
            replacement = _format_directive(value, directive)
            result.append(replacement)
            i += 2
        else:
            result.append(fmt[i])
            i += 1

    return "".join(result)


def _format_directive(value: TemporalType, directive: str) -> str:
    """Format a single directive.

    Args:
        value: The temporal object.
        directive: The format directive (e.g., "%Y").

    Returns:
        Formatted string for this directive.

    Raises:
        ValueError: If directive is unsupported or incompatible with value type.
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time

    if directive == "%%":
        return "%"

    # Get components based on value type
    year = getattr(value, "year", None)
    month = getattr(value, "month", None)
    day = getattr(value, "day", None)
    hour = getattr(value, "hour", None)
    minute = getattr(value, "minute", None)
    second = getattr(value, "second", None)
    microsecond = getattr(value, "microsecond", None)
    timezone = getattr(value, "timezone", None)

    if directive == "%Y":
        if year is None:
            raise ValueError(f"format directive %Y requires year, but {type(value).__name__} has no year")
        if year >= 0:
            return f"{year:04d}"
        else:
            return f"{year:05d}"  # Include minus sign

    elif directive == "%m":
        if month is None:
            raise ValueError(f"format directive %m requires month, but {type(value).__name__} has no month")
        return f"{month:02d}"

    elif directive == "%d":
        if day is None:
            raise ValueError(f"format directive %d requires day, but {type(value).__name__} has no day")
        return f"{day:02d}"

    elif directive == "%H":
        if hour is None:
            raise ValueError(f"format directive %H requires hour, but {type(value).__name__} has no hour")
        return f"{hour:02d}"

    elif directive == "%M":
        if minute is None:
            raise ValueError(f"format directive %M requires minute, but {type(value).__name__} has no minute")
        return f"{minute:02d}"

    elif directive == "%S":
        if second is None:
            raise ValueError(f"format directive %S requires second, but {type(value).__name__} has no second")
        return f"{second:02d}"

    elif directive == "%f":
        if microsecond is None:
            raise ValueError(f"format directive %f requires microsecond, but {type(value).__name__} has no microsecond")
        return f"{microsecond:06d}"

    elif directive == "%z":
        if timezone is None:
            return ""  # Python strftime returns empty string for naive datetimes
        offset = timezone.offset_seconds
        sign = "+" if offset >= 0 else "-"
        offset = abs(offset)
        hours = offset // 3600
        minutes = (offset % 3600) // 60
        return f"{sign}{hours:02d}{minutes:02d}"

    elif directive == "%Z":
        if timezone is None:
            return ""  # Python strftime returns empty string for naive datetimes
        if timezone.is_utc:
            return "UTC"
        # Return formatted offset
        offset = timezone.offset_seconds
        sign = "+" if offset >= 0 else "-"
        offset = abs(offset)
        hours = offset // 3600
        minutes = (offset % 3600) // 60
        return f"{sign}{hours:02d}:{minutes:02d}"

    else:
        raise ValueError(
            f"unsupported strftime directive: {directive}. "
            f"Supported: %Y, %m, %d, %H, %M, %S, %f, %z, %Z, %%"
        )


def strptime(s: str, fmt: str) -> "DateTime":
    """Parse a string using strftime-style format string.

    Args:
        s: The string to parse.
        fmt: Format string with %-directives.

    Returns:
        A DateTime parsed from the string.

    Raises:
        ParseError: If the string doesn't match the format.
        ValueError: If format contains unsupported directives.

    Notes:
        Missing time components default to 0.
        Missing date components cause an error.

    Examples:
        >>> strptime("2024-01-15 14:30:45", "%Y-%m-%d %H:%M:%S")
        DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)

        >>> strptime("2024-01-15", "%Y-%m-%d")
        DateTime(2024, 1, 15, 0, 0, 0, nanosecond=0)

        >>> strptime("14:30:45", "%H:%M:%S")  # doctest: +IGNORE_EXCEPTION_DETAIL
        Traceback (most recent call last):
        ...
        ParseError: strptime requires year, month, and day...
    """
    from temporale.core.datetime import DateTime
    from temporale.units.timezone import Timezone

    # Build regex pattern from format string
    pattern = _format_to_regex(fmt)

    match = re.match(pattern, s)
    if not match:
        raise ParseError(f"string {s!r} does not match format {fmt!r}")

    groups = match.groupdict()

    # Extract components
    year = int(groups.get("year")) if groups.get("year") else None
    month = int(groups.get("month")) if groups.get("month") else None
    day = int(groups.get("day")) if groups.get("day") else None
    hour = int(groups.get("hour", 0) or 0)
    minute = int(groups.get("minute", 0) or 0)
    second = int(groups.get("second", 0) or 0)
    microsecond = int(groups.get("microsecond", 0) or 0)

    # Handle timezone
    timezone = None
    if groups.get("tz_offset"):
        tz_str = groups["tz_offset"]
        # Convert +HHMM to +HH:MM for Timezone.from_string
        sign = tz_str[0]
        hours = tz_str[1:3]
        minutes = tz_str[3:5]
        timezone = Timezone.from_string(f"{sign}{hours}:{minutes}")
    elif groups.get("tz_name"):
        tz_name = groups["tz_name"]
        if tz_name.upper() == "UTC":
            timezone = Timezone.utc()
        else:
            timezone = Timezone.from_string(tz_name)

    # Validate required date components
    if year is None or month is None or day is None:
        raise ParseError(
            "strptime requires year, month, and day components. "
            f"Got: year={year}, month={month}, day={day}"
        )

    return DateTime(
        year,
        month,
        day,
        hour,
        minute,
        second,
        microsecond=microsecond,
        timezone=timezone,
    )


def _format_to_regex(fmt: str) -> str:
    """Convert a strftime format string to a regex pattern.

    Args:
        fmt: Format string with %-directives.

    Returns:
        Regex pattern for matching the format.

    Raises:
        ValueError: If format contains unsupported directives.
    """
    result = []
    i = 0
    while i < len(fmt):
        if fmt[i] == "%" and i + 1 < len(fmt):
            directive = fmt[i : i + 2]
            if directive in _PARSE_PATTERNS:
                result.append(_PARSE_PATTERNS[directive])
            else:
                raise ValueError(
                    f"unsupported strptime directive: {directive}. "
                    f"Supported: %Y, %m, %d, %H, %M, %S, %f, %z, %Z, %%"
                )
            i += 2
        else:
            # Escape regex special characters
            result.append(re.escape(fmt[i]))
            i += 1

    return "^" + "".join(result) + "$"


__all__ = ["strftime", "strptime"]
