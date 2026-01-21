"""Temporale: A Python datetime library for testing refactoring tools.

Temporale provides datetime handling with nanosecond precision, designed
as a comprehensive test bed for tugtool's Python refactoring capabilities.

Core Types:
    Date: Calendar date (year, month, day)
    Time: Time of day (hour, minute, second, nanosecond)
    DateTime: Combined date and time with optional timezone
    Duration: Time span with nanosecond precision
    Period: Calendar-based duration (years, months, weeks, days)
    Interval: Time span between two points [start, end)

Units:
    Era: BCE/CE era designation
    TimeUnit: Standard time units (YEAR, MONTH, DAY, etc.)
    Timezone: UTC offset-based timezone

Format Functions:
    parse_iso8601: Parse ISO 8601 date/time/datetime string
    format_iso8601: Format temporal object as ISO 8601 string

Exceptions:
    TemporaleError: Base exception
    ValidationError: Invalid input values
    ParseError: Failed to parse string
    OverflowError: Arithmetic overflow
    TimezoneError: Invalid timezone

Example:
    >>> from temporale import DateTime, Duration, Period
    >>> now = DateTime.now()
    >>> future = now + Duration.from_hours(1)
    >>> next_month = now + Period(months=1)
"""

from __future__ import annotations

__version__ = "0.1.0"

# Core types
from temporale.core.date import Date
from temporale.core.datetime import DateTime
from temporale.core.duration import Duration
from temporale.core.interval import Interval
from temporale.core.period import Period
from temporale.core.time import Time

# Units
from temporale.units.era import Era
from temporale.units.timezone import Timezone
from temporale.units.timeunit import TimeUnit

# Exceptions
from temporale.errors import (
    OverflowError,
    ParseError,
    TemporaleError,
    TimezoneError,
    ValidationError,
)

# Format functions
from temporale.format import format_iso8601, parse_iso8601

__all__: list[str] = [
    "__version__",
    # Core types
    "Date",
    "DateTime",
    "Duration",
    "Interval",
    "Period",
    "Time",
    # Units
    "Era",
    "Timezone",
    "TimeUnit",
    # Exceptions
    "TemporaleError",
    "ValidationError",
    "ParseError",
    "OverflowError",
    "TimezoneError",
    # Format functions
    "parse_iso8601",
    "format_iso8601",
]
