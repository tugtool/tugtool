"""Temporale exception hierarchy.

All Temporale-specific exceptions inherit from TemporaleError.
"""

from __future__ import annotations


class TemporaleError(Exception):
    """Base exception for all Temporale errors."""

    pass


class ValidationError(TemporaleError):
    """Invalid input values.

    Raised when a temporal value is out of range or invalid.

    Examples:
        - Month value outside 1-12
        - Day value outside valid range for month
        - Hour value outside 0-23
    """

    pass


class ParseError(TemporaleError):
    """Failed to parse string representation.

    Raised when a string cannot be parsed as a temporal value.

    Examples:
        - Invalid ISO 8601 format
        - Malformed date string
        - Missing required components
    """

    pass


class OverflowError(TemporaleError):
    """Arithmetic operation exceeded representable range.

    Raised when a temporal calculation produces a result that
    cannot be represented.

    Examples:
        - Adding a duration that exceeds year 9999
        - Subtracting a duration that goes before year -9999
    """

    pass


class TimezoneError(TemporaleError):
    """Invalid or unknown timezone.

    Raised when a timezone specification is invalid.

    Examples:
        - Invalid UTC offset format
        - Offset outside valid range (-24h to +24h)
    """

    pass


__all__ = [
    "TemporaleError",
    "ValidationError",
    "ParseError",
    "OverflowError",
    "TimezoneError",
]
