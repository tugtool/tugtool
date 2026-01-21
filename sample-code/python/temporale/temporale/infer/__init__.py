"""Flexible date/time format inference.

This module provides intelligent parsing of date/time strings by
automatically detecting the format and extracting components.

Public API:
    parse_fuzzy: Parse a date/time string with automatic format detection.
    ParseResult: Result of fuzzy parsing with confidence score.
    InferOptions: Configuration for parsing ambiguous formats.
    DateOrder: Enum for date component ordering (YMD, MDY, DMY).

The inference system handles:
    - ISO 8601 formats (unambiguous, highest confidence)
    - Slash/dash/dot separated dates (configurable order)
    - Named month formats ("Jan 15, 2024", "15 January 2024")
    - Time formats (24-hour, 12-hour with AM/PM)
    - Combined datetime formats

Examples:
    >>> from temporale.infer import parse_fuzzy
    >>> result = parse_fuzzy("Jan 15, 2024")
    >>> result.value
    Date(2024, 1, 15)
    >>> result.confidence
    0.95

    >>> from temporale.infer import parse_fuzzy, InferOptions, DateOrder
    >>> opts = InferOptions(date_order=DateOrder.MDY)
    >>> result = parse_fuzzy("01/15/2024", opts)
    >>> result.value
    Date(2024, 1, 15)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Union

from temporale.errors import ParseError
from temporale.infer._formats import FormatKind
from temporale.infer._patterns import detect_format

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time


class DateOrder(Enum):
    """Order of date components in ambiguous formats.

    Used to resolve formats like "01/02/2024" which could be
    January 2nd (MDY) or February 1st (DMY).

    Values:
        YMD: Year-Month-Day (ISO-like, unambiguous)
        MDY: Month-Day-Year (US convention)
        DMY: Day-Month-Year (European convention)
    """

    YMD = "YMD"
    MDY = "MDY"
    DMY = "DMY"


@dataclass(frozen=True)
class InferOptions:
    """Configuration for flexible date/time parsing.

    Attributes:
        date_order: Order for ambiguous date formats.
        prefer_future: If True, 2-digit years prefer future (00-99 -> 2000-2099).
        default_century: Base century for 2-digit years (e.g., 2000).

    Examples:
        >>> opts = InferOptions(date_order=DateOrder.DMY)
        >>> # Now "01/02/2024" is interpreted as February 1, 2024

        >>> opts = InferOptions(default_century=1900)
        >>> # Now "01/15/24" is interpreted as January 15, 1924
    """

    date_order: DateOrder = DateOrder.YMD
    prefer_future: bool = False
    default_century: int = 2000


# Type alias for temporal objects
TemporalType = Union["Date", "Time", "DateTime"]


@dataclass(frozen=True)
class ParseResult:
    """Result of fuzzy parsing with confidence score.

    Attributes:
        value: The parsed Date, Time, or DateTime object.
        format_detected: Name of the format pattern that matched.
        confidence: Confidence score from 0.0 to 1.0.
            - 1.0: Unambiguous format (ISO 8601)
            - 0.95: High confidence (named month, clear structure)
            - 0.8-0.9: Ambiguous format with configured interpretation
            - Lower: Reduced by invalid-looking values

    Examples:
        >>> result = parse_fuzzy("2024-01-15")
        >>> result.format_detected
        'iso_date'
        >>> result.confidence
        1.0
    """

    value: TemporalType
    format_detected: str
    confidence: float


def parse_fuzzy(
    text: str,
    options: InferOptions | None = None,
) -> ParseResult:
    """Parse a date/time string with automatic format detection.

    Examines the input string to detect its format, then parses it
    into the appropriate temporal object (Date, Time, or DateTime).

    Args:
        text: The string to parse.
        options: Configuration for handling ambiguous formats.
            If None, uses default options (YMD order).

    Returns:
        ParseResult containing the parsed value, detected format name,
        and a confidence score.

    Raises:
        ParseError: If no format matches the input.
        ValidationError: If parsed values are invalid (e.g., month 13).

    Supported formats:
        Dates:
            - "2024-01-15" (ISO 8601)
            - "01/15/2024" (slash, order from options)
            - "15/01/2024" (slash, order from options)
            - "2024/01/15" (slash, YMD)
            - "01-15-2024" (dash, MDY)
            - "15.01.2024" (dot, DMY)
            - "Jan 15, 2024" (named month)
            - "15 Jan 2024" (named month)
            - "January 15, 2024" (full month name)

        Times:
            - "14:30" (short time)
            - "14:30:45" (ISO time)
            - "14:30:45.123" (with subseconds)
            - "2:30 PM" (12-hour)
            - "2:30:45 PM" (12-hour with seconds)

        DateTimes:
            - "2024-01-15T14:30:00" (ISO)
            - "2024-01-15 14:30:00" (space separator)
            - "Jan 15, 2024 2:30 PM" (named month with time)

    Examples:
        >>> # Unambiguous ISO format
        >>> result = parse_fuzzy("2024-01-15")
        >>> result.value.year, result.value.month, result.value.day
        (2024, 1, 15)

        >>> # Named month format
        >>> result = parse_fuzzy("Jan 15, 2024")
        >>> result.value.day
        15

        >>> # Ambiguous format with explicit order
        >>> from temporale.infer import InferOptions, DateOrder
        >>> opts = InferOptions(date_order=DateOrder.DMY)
        >>> result = parse_fuzzy("01/02/2024", opts)
        >>> result.value.day  # Interpreted as day=1, month=2
        1
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.time import Time
    from temporale.units.timezone import Timezone

    if options is None:
        options = InferOptions()

    text = text.strip()
    if not text:
        raise ParseError("empty string")

    # Detect matching formats
    matches = detect_format(text, options.date_order.value)

    if not matches:
        raise ParseError(
            f"cannot determine format for: {text!r}. "
            "Expected date, time, or datetime in a recognized format."
        )

    # Use the highest confidence match
    best_match = matches[0]
    components = best_match.components

    # Build the appropriate object
    kind = best_match.template.kind

    if kind == FormatKind.TIME:
        value: TemporalType = Time(
            hour=components["hour"],  # type: ignore[arg-type]
            minute=components["minute"],  # type: ignore[arg-type]
            second=components.get("second", 0),  # type: ignore[arg-type]
            nanosecond=components.get("nanosecond", 0),  # type: ignore[arg-type]
        )
    elif kind == FormatKind.DATE:
        year = components["year"]
        # Handle 2-digit years
        if year is not None and 0 <= year <= 99:  # type: ignore[operator]
            if options.prefer_future:
                # Simple heuristic: years 00-29 -> 2000-2029, 30-99 -> 1930-1999
                if year <= 29:  # type: ignore[operator]
                    year = 2000 + year  # type: ignore[operator]
                else:
                    year = 1900 + year  # type: ignore[operator]
            else:
                year = options.default_century + year  # type: ignore[operator]
        value = Date(
            year=year,  # type: ignore[arg-type]
            month=components["month"],  # type: ignore[arg-type]
            day=components["day"],  # type: ignore[arg-type]
        )
    elif kind == FormatKind.DATETIME:
        year = components["year"]
        # Handle 2-digit years
        if year is not None and 0 <= year <= 99:  # type: ignore[operator]
            if options.prefer_future:
                if year <= 29:  # type: ignore[operator]
                    year = 2000 + year  # type: ignore[operator]
                else:
                    year = 1900 + year  # type: ignore[operator]
            else:
                year = options.default_century + year  # type: ignore[operator]

        # Handle timezone
        tz = None
        tz_string = components.get("tz_string")
        if tz_string:
            if tz_string in ("Z", "z"):
                tz = Timezone.utc()
            else:
                tz = Timezone.from_string(tz_string)  # type: ignore[arg-type]

        value = DateTime(
            year=year,  # type: ignore[arg-type]
            month=components["month"],  # type: ignore[arg-type]
            day=components["day"],  # type: ignore[arg-type]
            hour=components.get("hour", 0),  # type: ignore[arg-type]
            minute=components.get("minute", 0),  # type: ignore[arg-type]
            second=components.get("second", 0),  # type: ignore[arg-type]
            nanosecond=components.get("nanosecond", 0),  # type: ignore[arg-type]
            timezone=tz,
        )
    else:
        raise ParseError(f"unknown format kind: {kind}")

    return ParseResult(
        value=value,
        format_detected=best_match.template.name,
        confidence=best_match.confidence,
    )


__all__ = [
    "DateOrder",
    "InferOptions",
    "ParseResult",
    "parse_fuzzy",
]
