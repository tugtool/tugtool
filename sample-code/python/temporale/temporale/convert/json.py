"""JSON serialization and deserialization for temporal objects.

This module provides functions for converting temporal objects to and from
JSON-serializable dictionaries.

Functions:
    to_json: Convert a temporal object to a JSON-serializable dict.
    from_json: Create a temporal object from a JSON dict.

The JSON format uses ISO 8601 strings with type tags for polymorphic
deserialization:

    {"_type": "DateTime", "value": "2024-01-15T14:30:00.123456789Z"}
    {"_type": "Date", "value": "2024-01-15"}
    {"_type": "Time", "value": "14:30:00.123456789"}
    {"_type": "Duration", "value": "P1DT2H30M", "total_nanos": 95400000000000}

Examples:
    >>> from temporale import DateTime, Date
    >>> from temporale.convert import to_json, from_json

    >>> dt = DateTime(2024, 1, 15, 14, 30, 45)
    >>> data = to_json(dt)
    >>> data['_type']
    'DateTime'

    >>> restored = from_json(data)
    >>> restored == dt
    True
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Union, overload

from temporale.errors import ParseError

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

# Type alias for temporal objects
TemporalType = Union["Date", "Time", "DateTime", "Duration"]


def to_json(value: TemporalType) -> dict[str, Any]:
    """Convert a temporal object to a JSON-serializable dictionary.

    The returned dictionary includes a `_type` field for polymorphic
    deserialization and a `value` field containing the ISO 8601 representation.

    Args:
        value: A Date, Time, DateTime, or Duration to convert.

    Returns:
        A JSON-serializable dictionary with type information.

    Raises:
        TypeError: If value is not a supported temporal type.

    Examples:
        >>> from temporale import DateTime, Date, Time
        >>> from temporale.core.duration import Duration
        >>> from temporale.units.timezone import Timezone

        >>> to_json(Date(2024, 1, 15))
        {'_type': 'Date', 'value': '2024-01-15'}

        >>> to_json(Time(14, 30, 45))
        {'_type': 'Time', 'value': '14:30:45'}

        >>> to_json(DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc()))
        {'_type': 'DateTime', 'value': '2024-01-15T14:30:45Z'}

        >>> d = to_json(Duration(days=1, seconds=9000))
        >>> d['_type']
        'Duration'
        >>> 'total_nanos' in d
        True
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

    if isinstance(value, DateTime):
        return {
            "_type": "DateTime",
            "value": value.to_iso_format(),
        }
    elif isinstance(value, Date):
        return {
            "_type": "Date",
            "value": value.to_iso_format(),
        }
    elif isinstance(value, Time):
        return {
            "_type": "Time",
            "value": value.to_iso_format(),
        }
    elif isinstance(value, Duration):
        return {
            "_type": "Duration",
            "value": _duration_to_iso8601(value),
            "total_nanos": value.total_nanoseconds,
        }
    else:
        raise TypeError(
            f"expected Date, Time, DateTime, or Duration, got {type(value).__name__}"
        )


def from_json(data: dict[str, Any]) -> TemporalType:
    """Create a temporal object from a JSON dictionary.

    The dictionary must include a `_type` field specifying the type to create.

    Args:
        data: A dictionary with `_type` and `value` fields.

    Returns:
        A Date, Time, DateTime, or Duration based on the `_type` field.

    Raises:
        ParseError: If the data is missing required fields or has invalid format.
        TypeError: If `_type` is not a recognized temporal type.

    Examples:
        >>> from temporale.convert import from_json

        >>> from_json({'_type': 'Date', 'value': '2024-01-15'})
        Date(2024, 1, 15)

        >>> from_json({'_type': 'Time', 'value': '14:30:45'})
        Time(14, 30, 45, nanosecond=0)

        >>> dt = from_json({'_type': 'DateTime', 'value': '2024-01-15T14:30:45Z'})
        >>> dt.year
        2024
        >>> dt.timezone.is_utc
        True
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

    if not isinstance(data, dict):
        raise ParseError(f"expected dict, got {type(data).__name__}")

    type_name = data.get("_type")
    if not type_name:
        raise ParseError("missing '_type' field in JSON data")

    if type_name == "DateTime":
        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' field for DateTime")
        return DateTime.from_iso_format(value)

    elif type_name == "Date":
        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' field for Date")
        return Date.from_iso_format(value)

    elif type_name == "Time":
        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' field for Time")
        return Time.from_iso_format(value)

    elif type_name == "Duration":
        # Prefer total_nanos for exact precision
        total_nanos = data.get("total_nanos")
        if total_nanos is not None:
            return Duration(nanoseconds=total_nanos)
        # Fall back to parsing ISO 8601 period
        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' or 'total_nanos' field for Duration")
        return _duration_from_iso8601(value)

    else:
        raise TypeError(f"unknown temporal type: {type_name!r}")


def _duration_to_iso8601(duration: "Duration") -> str:
    """Convert a Duration to ISO 8601 period format.

    The format is PnDTnHnMnS where:
    - P is the period designator
    - nD is number of days
    - T is the time designator
    - nH is number of hours
    - nM is number of minutes
    - nS is number of seconds (with decimal fraction)

    Args:
        duration: The Duration to format.

    Returns:
        ISO 8601 period string.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> _duration_to_iso8601(Duration(days=1, seconds=9000))
        'P1DT2H30M'
        >>> _duration_to_iso8601(Duration(seconds=90, nanoseconds=500000000))
        'PT1M30.5S'
    """
    # Import to access constants
    from temporale._internal.constants import (
        SECONDS_PER_HOUR,
        SECONDS_PER_MINUTE,
    )

    # Handle negative durations
    is_negative = duration.is_negative
    if is_negative:
        duration = abs(duration)

    days = duration.days
    seconds = duration.seconds
    nanos = duration.nanoseconds

    # Convert seconds to hours, minutes, remaining seconds
    hours = seconds // SECONDS_PER_HOUR
    remaining = seconds % SECONDS_PER_HOUR
    minutes = remaining // SECONDS_PER_MINUTE
    secs = remaining % SECONDS_PER_MINUTE

    parts = ["-" if is_negative else "", "P"]

    if days:
        parts.append(f"{days}D")

    # Add time part if there's any time component
    if hours or minutes or secs or nanos:
        parts.append("T")
        if hours:
            parts.append(f"{hours}H")
        if minutes:
            parts.append(f"{minutes}M")
        if secs or nanos:
            if nanos:
                # Format with fractional seconds
                frac = f"{nanos:09d}".rstrip("0")
                parts.append(f"{secs}.{frac}S")
            else:
                parts.append(f"{secs}S")

    result = "".join(parts)

    # Handle edge case of zero duration
    if result in ("P", "-P"):
        return "PT0S"

    return result


def _duration_from_iso8601(value: str) -> "Duration":
    """Parse an ISO 8601 period string to Duration.

    Args:
        value: ISO 8601 period string (e.g., "P1DT2H30M").

    Returns:
        A Duration representing the period.

    Raises:
        ParseError: If the string is not valid ISO 8601 period format.
    """
    import re

    from temporale.core.duration import Duration
    from temporale._internal.constants import (
        SECONDS_PER_HOUR,
        SECONDS_PER_MINUTE,
    )

    # Check for negative duration
    is_negative = value.startswith("-")
    if is_negative:
        value = value[1:]

    if not value.startswith("P"):
        raise ParseError(f"ISO 8601 period must start with 'P': {value!r}")

    value = value[1:]  # Remove 'P'

    days = 0
    seconds = 0
    nanos = 0

    # Split into date and time parts
    if "T" in value:
        date_part, time_part = value.split("T", 1)
    else:
        date_part = value
        time_part = ""

    # Parse date part
    if date_part:
        # Match days
        day_match = re.search(r"(\d+)D", date_part)
        if day_match:
            days = int(day_match.group(1))

    # Parse time part
    if time_part:
        # Match hours
        hour_match = re.search(r"(\d+)H", time_part)
        if hour_match:
            seconds += int(hour_match.group(1)) * SECONDS_PER_HOUR

        # Match minutes
        min_match = re.search(r"(\d+)M", time_part)
        if min_match:
            seconds += int(min_match.group(1)) * SECONDS_PER_MINUTE

        # Match seconds (with optional decimal)
        sec_match = re.search(r"(\d+(?:\.\d+)?)S", time_part)
        if sec_match:
            sec_str = sec_match.group(1)
            if "." in sec_str:
                whole, frac = sec_str.split(".")
                seconds += int(whole)
                # Convert fraction to nanoseconds
                frac = frac.ljust(9, "0")[:9]
                nanos = int(frac)
            else:
                seconds += int(sec_str)

    result = Duration(days=days, seconds=seconds, nanoseconds=nanos)

    if is_negative:
        result = -result

    return result


__all__ = ["to_json", "from_json"]
