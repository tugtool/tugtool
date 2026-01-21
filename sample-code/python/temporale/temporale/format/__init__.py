"""Temporal formatting and parsing.

This module provides functions for converting temporal objects to and from
string representations:
    - ISO 8601 formatting and parsing
    - RFC 3339 formatting and parsing
    - strftime-style formatting

Functions:
    parse_iso8601: Parse ISO 8601 date/time/datetime string.
    format_iso8601: Format temporal object as ISO 8601 string.
    parse_rfc3339: Parse RFC 3339 datetime string.
    format_rfc3339: Format DateTime as RFC 3339 string.
    strftime: Format temporal object using strftime pattern.
    strptime: Parse string using strftime pattern.

Examples:
    >>> from temporale import DateTime
    >>> from temporale.format import parse_iso8601, format_iso8601

    >>> dt = parse_iso8601("2024-01-15T14:30:45Z")
    >>> dt.year
    2024

    >>> format_iso8601(DateTime(2024, 1, 15, 14, 30, 45))
    '2024-01-15T14:30:45'
"""

from __future__ import annotations

from temporale.format.iso8601 import format_iso8601, parse_iso8601
from temporale.format.rfc3339 import format_rfc3339, parse_rfc3339
from temporale.format.strftime import strftime, strptime

__all__: list[str] = [
    # ISO 8601
    "parse_iso8601",
    "format_iso8601",
    # RFC 3339
    "parse_rfc3339",
    "format_rfc3339",
    # strftime
    "strftime",
    "strptime",
]
