"""Internal constants for Temporale.

These constants define the limits and magic numbers used throughout
the library. This module is not part of the public API.
"""

from __future__ import annotations

# Time unit conversions
NANOS_PER_MICROSECOND: int = 1_000
NANOS_PER_MILLISECOND: int = 1_000_000
NANOS_PER_SECOND: int = 1_000_000_000
NANOS_PER_MINUTE: int = 60 * NANOS_PER_SECOND
NANOS_PER_HOUR: int = 60 * NANOS_PER_MINUTE
NANOS_PER_DAY: int = 24 * NANOS_PER_HOUR  # 86_400_000_000_000

SECONDS_PER_MINUTE: int = 60
SECONDS_PER_HOUR: int = 60 * SECONDS_PER_MINUTE
SECONDS_PER_DAY: int = 24 * SECONDS_PER_HOUR  # 86_400

# Year limits (practical limits for the library)
MIN_YEAR: int = -9999
MAX_YEAR: int = 9999

# Days in each month (non-leap year)
DAYS_IN_MONTH: tuple[int, ...] = (
    0,   # Placeholder for 1-indexed access
    31,  # January
    28,  # February (non-leap)
    31,  # March
    30,  # April
    31,  # May
    30,  # June
    31,  # July
    31,  # August
    30,  # September
    31,  # October
    30,  # November
    31,  # December
)

# MJD (Modified Julian Day) reference points
# MJD 0 = 1858-11-17 00:00 UTC
MJD_UNIX_EPOCH: int = 40587  # 1970-01-01 00:00 UTC

# Timezone offset limits (in seconds)
MAX_UTC_OFFSET_SECONDS: int = 24 * SECONDS_PER_HOUR  # +/- 24 hours


__all__ = [
    "NANOS_PER_MICROSECOND",
    "NANOS_PER_MILLISECOND",
    "NANOS_PER_SECOND",
    "NANOS_PER_MINUTE",
    "NANOS_PER_HOUR",
    "NANOS_PER_DAY",
    "SECONDS_PER_MINUTE",
    "SECONDS_PER_HOUR",
    "SECONDS_PER_DAY",
    "MIN_YEAR",
    "MAX_YEAR",
    "DAYS_IN_MONTH",
    "MJD_UNIX_EPOCH",
    "MAX_UTC_OFFSET_SECONDS",
]
