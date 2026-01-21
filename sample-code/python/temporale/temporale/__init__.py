"""Temporale: A Python datetime library for testing refactoring tools.

Temporale provides datetime handling with nanosecond precision, designed
as a comprehensive test bed for tugtool's Python refactoring capabilities.

Core Types:
    Date: Calendar date (year, month, day)
    Time: Time of day (hour, minute, second, nanosecond)
    DateTime: Combined date and time with optional timezone
    Duration: Time span with nanosecond precision

Units:
    Era: BCE/CE era designation
    TimeUnit: Standard time units (YEAR, MONTH, DAY, etc.)
    Timezone: UTC offset-based timezone

Exceptions:
    TemporaleError: Base exception
    ValidationError: Invalid input values
    ParseError: Failed to parse string
    OverflowError: Arithmetic overflow
    TimezoneError: Invalid timezone

Example:
    >>> from temporale import DateTime, Duration
    >>> now = DateTime.now()
    >>> future = now + Duration.from_hours(1)
"""

from __future__ import annotations

__version__ = "0.1.0"

# Public API exports will be added as classes are implemented
__all__: list[str] = [
    "__version__",
]
