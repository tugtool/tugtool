"""Temporal conversion utilities.

This module provides functions for converting temporal objects to and from
other representations:
    - JSON serialization and deserialization
    - Unix epoch conversions (seconds, milliseconds, nanoseconds)

Examples:
    >>> from temporale import DateTime
    >>> from temporale.convert import to_json, from_json

    >>> dt = DateTime(2024, 1, 15, 14, 30, 45)
    >>> data = to_json(dt)
    >>> restored = from_json(data)
    >>> restored == dt
    True

    >>> from temporale.convert import to_unix_seconds, from_unix_seconds
    >>> ts = to_unix_seconds(dt)
    >>> dt2 = from_unix_seconds(ts)
"""

from __future__ import annotations

from temporale.convert.json import from_json, to_json
from temporale.convert.epoch import (
    from_unix_millis,
    from_unix_nanos,
    from_unix_seconds,
    to_unix_millis,
    to_unix_nanos,
    to_unix_seconds,
)

__all__ = [
    # JSON
    "to_json",
    "from_json",
    # Epoch
    "to_unix_seconds",
    "from_unix_seconds",
    "to_unix_millis",
    "from_unix_millis",
    "to_unix_nanos",
    "from_unix_nanos",
]
