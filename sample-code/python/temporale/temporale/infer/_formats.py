"""Known format templates and matchers for date/time inference.

This module provides format templates that define how to parse and validate
various date/time string formats. Each template specifies:
- A regex pattern for matching
- Component extraction groups
- A confidence score for the match

Internal module - use parse_fuzzy() from temporale.infer instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Callable, Pattern

if TYPE_CHECKING:
    pass


class FormatKind(Enum):
    """Classification of format type."""

    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"


@dataclass(frozen=True)
class FormatTemplate:
    """A format template for matching date/time strings.

    Attributes:
        name: Human-readable name for the format.
        kind: Whether this is a date, time, or datetime format.
        pattern: Compiled regex pattern for matching.
        confidence: Base confidence score (0.0 to 1.0).
        extractor: Function to extract components from a regex match.
    """

    name: str
    kind: FormatKind
    pattern: Pattern[str]
    confidence: float
    extractor: Callable[[re.Match[str]], dict[str, int | str | None]]


# Month name mappings
MONTH_NAMES = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _month_to_int(month_str: str) -> int | None:
    """Convert month name to integer (1-12)."""
    return MONTH_NAMES.get(month_str.lower())


# ISO 8601 Date: YYYY-MM-DD
_ISO_DATE_PATTERN = re.compile(
    r"^(-?\d{4})-(\d{2})-(\d{2})$",
    re.ASCII,
)


def _extract_iso_date(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract components from ISO date match."""
    return {
        "year": int(match.group(1)),
        "month": int(match.group(2)),
        "day": int(match.group(3)),
    }


# ISO 8601 Time: HH:MM:SS or HH:MM:SS.fff...
_ISO_TIME_PATTERN = re.compile(
    r"^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$",
    re.ASCII,
)


def _extract_iso_time(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract components from ISO time match."""
    frac = match.group(4)
    nanosecond = 0
    if frac:
        # Pad to 9 digits and convert
        nanosecond = int(frac.ljust(9, "0")[:9])

    return {
        "hour": int(match.group(1)),
        "minute": int(match.group(2)),
        "second": int(match.group(3)),
        "nanosecond": nanosecond,
    }


# Short time: HH:MM
_SHORT_TIME_PATTERN = re.compile(
    r"^(\d{1,2}):(\d{2})$",
    re.ASCII,
)


def _extract_short_time(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract components from short time match."""
    return {
        "hour": int(match.group(1)),
        "minute": int(match.group(2)),
        "second": 0,
        "nanosecond": 0,
    }


# 12-hour time with AM/PM: H:MM AM, HH:MM:SS PM, etc.
_TIME_AMPM_PATTERN = re.compile(
    r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$",
    re.ASCII,
)


def _extract_time_ampm(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract components from 12-hour time match."""
    hour = int(match.group(1))
    minute = int(match.group(2))
    second = int(match.group(3)) if match.group(3) else 0
    ampm = match.group(4).upper()

    # Convert to 24-hour
    if ampm == "AM":
        if hour == 12:
            hour = 0
    else:  # PM
        if hour != 12:
            hour += 12

    return {
        "hour": hour,
        "minute": minute,
        "second": second,
        "nanosecond": 0,
    }


# Slash-separated date: MM/DD/YYYY or DD/MM/YYYY or YYYY/MM/DD
# The interpretation depends on date_order configuration
_SLASH_DATE_PATTERN = re.compile(
    r"^(\d{1,4})/(\d{1,2})/(\d{1,4})$",
    re.ASCII,
)


def _extract_slash_date_ymd(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from slash date assuming YMD order."""
    g1, g2, g3 = match.group(1), match.group(2), match.group(3)

    # If first group is 4 digits, it's the year
    if len(g1) == 4:
        return {"year": int(g1), "month": int(g2), "day": int(g3)}
    # If last group is 4 digits, need to check order
    elif len(g3) == 4:
        # YMD can't have year last, so this is MDY or DMY
        # Default to MDY for YMD config (unusual case)
        return {"year": int(g3), "month": int(g1), "day": int(g2)}
    else:
        # All short, assume 2-digit year at end, YMD
        return {"year": 2000 + int(g3), "month": int(g1), "day": int(g2)}


def _extract_slash_date_mdy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from slash date assuming MDY order."""
    g1, g2, g3 = match.group(1), match.group(2), match.group(3)

    if len(g3) == 4:
        return {"year": int(g3), "month": int(g1), "day": int(g2)}
    elif len(g1) == 4:
        # YMD format even though expecting MDY
        return {"year": int(g1), "month": int(g2), "day": int(g3)}
    else:
        # 2-digit year
        return {"year": 2000 + int(g3), "month": int(g1), "day": int(g2)}


def _extract_slash_date_dmy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from slash date assuming DMY order."""
    g1, g2, g3 = match.group(1), match.group(2), match.group(3)

    if len(g3) == 4:
        return {"year": int(g3), "month": int(g2), "day": int(g1)}
    elif len(g1) == 4:
        # YMD format even though expecting DMY
        return {"year": int(g1), "month": int(g2), "day": int(g3)}
    else:
        # 2-digit year
        return {"year": 2000 + int(g3), "month": int(g2), "day": int(g1)}


# Dash-separated date: MM-DD-YYYY or DD-MM-YYYY
# (YYYY-MM-DD is handled by ISO pattern)
_DASH_DATE_PATTERN = re.compile(
    r"^(\d{1,2})-(\d{1,2})-(\d{4})$",
    re.ASCII,
)


def _extract_dash_date_mdy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from dash date assuming MDY order."""
    return {
        "year": int(match.group(3)),
        "month": int(match.group(1)),
        "day": int(match.group(2)),
    }


def _extract_dash_date_dmy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from dash date assuming DMY order."""
    return {
        "year": int(match.group(3)),
        "month": int(match.group(2)),
        "day": int(match.group(1)),
    }


# Dot-separated date: DD.MM.YYYY (European style)
_DOT_DATE_PATTERN = re.compile(
    r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$",
    re.ASCII,
)


def _extract_dot_date(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from dot date (assumes DMY order)."""
    return {
        "year": int(match.group(3)),
        "month": int(match.group(2)),
        "day": int(match.group(1)),
    }


# Named month: Jan 15, 2024 or January 15, 2024
_NAMED_MONTH_MDY_PATTERN = re.compile(
    r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,|,?\s)\s*(\d{4})$",
    re.ASCII,
)


def _extract_named_month_mdy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from named month format (Month Day, Year)."""
    month = _month_to_int(match.group(1))
    return {
        "year": int(match.group(3)),
        "month": month,
        "day": int(match.group(2)),
    }


# Named month: 15 Jan 2024 or 15 January 2024
_NAMED_MONTH_DMY_PATTERN = re.compile(
    r"^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$",
    re.ASCII,
)


def _extract_named_month_dmy(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from named month format (Day Month Year)."""
    month = _month_to_int(match.group(2))
    return {
        "year": int(match.group(3)),
        "month": month,
        "day": int(match.group(1)),
    }


# ISO DateTime: YYYY-MM-DDTHH:MM:SS with optional timezone
_ISO_DATETIME_PATTERN = re.compile(
    r"^(-?\d{4})-(\d{2})-(\d{2})[Tt\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:?\d{2})?$",
    re.ASCII,
)


def _extract_iso_datetime(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract components from ISO datetime match."""
    frac = match.group(7)
    nanosecond = 0
    if frac:
        nanosecond = int(frac.ljust(9, "0")[:9])

    return {
        "year": int(match.group(1)),
        "month": int(match.group(2)),
        "day": int(match.group(3)),
        "hour": int(match.group(4)),
        "minute": int(match.group(5)),
        "second": int(match.group(6)),
        "nanosecond": nanosecond,
        "tz_string": match.group(8),
    }


# Named month datetime: Jan 15, 2024 2:30 PM
_NAMED_DATETIME_PATTERN = re.compile(
    r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,|,?\s)\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$",
    re.ASCII,
)


def _extract_named_datetime(match: re.Match[str]) -> dict[str, int | str | None]:
    """Extract from named month datetime format."""
    month = _month_to_int(match.group(1))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6)) if match.group(6) else 0
    ampm = match.group(7)

    if ampm:
        ampm = ampm.upper()
        if ampm == "AM":
            if hour == 12:
                hour = 0
        else:  # PM
            if hour != 12:
                hour += 12

    return {
        "year": int(match.group(3)),
        "month": month,
        "day": int(match.group(2)),
        "hour": hour,
        "minute": minute,
        "second": second,
        "nanosecond": 0,
    }


# Templates list - ordered by specificity (most specific first)
DATE_TEMPLATES = [
    FormatTemplate(
        name="iso_date",
        kind=FormatKind.DATE,
        pattern=_ISO_DATE_PATTERN,
        confidence=1.0,
        extractor=_extract_iso_date,
    ),
    FormatTemplate(
        name="named_month_mdy",
        kind=FormatKind.DATE,
        pattern=_NAMED_MONTH_MDY_PATTERN,
        confidence=0.95,
        extractor=_extract_named_month_mdy,
    ),
    FormatTemplate(
        name="named_month_dmy",
        kind=FormatKind.DATE,
        pattern=_NAMED_MONTH_DMY_PATTERN,
        confidence=0.95,
        extractor=_extract_named_month_dmy,
    ),
    FormatTemplate(
        name="dot_date",
        kind=FormatKind.DATE,
        pattern=_DOT_DATE_PATTERN,
        confidence=0.9,
        extractor=_extract_dot_date,
    ),
]

TIME_TEMPLATES = [
    FormatTemplate(
        name="iso_time",
        kind=FormatKind.TIME,
        pattern=_ISO_TIME_PATTERN,
        confidence=1.0,
        extractor=_extract_iso_time,
    ),
    FormatTemplate(
        name="time_ampm",
        kind=FormatKind.TIME,
        pattern=_TIME_AMPM_PATTERN,
        confidence=0.95,
        extractor=_extract_time_ampm,
    ),
    FormatTemplate(
        name="short_time",
        kind=FormatKind.TIME,
        pattern=_SHORT_TIME_PATTERN,
        confidence=0.85,
        extractor=_extract_short_time,
    ),
]

DATETIME_TEMPLATES = [
    FormatTemplate(
        name="iso_datetime",
        kind=FormatKind.DATETIME,
        pattern=_ISO_DATETIME_PATTERN,
        confidence=1.0,
        extractor=_extract_iso_datetime,
    ),
    FormatTemplate(
        name="named_datetime",
        kind=FormatKind.DATETIME,
        pattern=_NAMED_DATETIME_PATTERN,
        confidence=0.95,
        extractor=_extract_named_datetime,
    ),
]

# Ambiguous templates that need date_order configuration
AMBIGUOUS_DATE_TEMPLATES = {
    "slash": FormatTemplate(
        name="slash_date",
        kind=FormatKind.DATE,
        pattern=_SLASH_DATE_PATTERN,
        confidence=0.8,
        extractor=_extract_slash_date_ymd,  # Default, will be swapped
    ),
    "dash": FormatTemplate(
        name="dash_date",
        kind=FormatKind.DATE,
        pattern=_DASH_DATE_PATTERN,
        confidence=0.8,
        extractor=_extract_dash_date_mdy,  # Default, will be swapped
    ),
}


def get_slash_date_extractor(
    date_order: str,
) -> Callable[[re.Match[str]], dict[str, int | str | None]]:
    """Get the appropriate extractor for slash dates based on date order."""
    if date_order == "YMD":
        return _extract_slash_date_ymd
    elif date_order == "MDY":
        return _extract_slash_date_mdy
    elif date_order == "DMY":
        return _extract_slash_date_dmy
    else:
        return _extract_slash_date_ymd


def get_dash_date_extractor(
    date_order: str,
) -> Callable[[re.Match[str]], dict[str, int | str | None]]:
    """Get the appropriate extractor for dash dates based on date order."""
    if date_order == "DMY":
        return _extract_dash_date_dmy
    else:
        return _extract_dash_date_mdy


__all__ = [
    "FormatKind",
    "FormatTemplate",
    "DATE_TEMPLATES",
    "TIME_TEMPLATES",
    "DATETIME_TEMPLATES",
    "AMBIGUOUS_DATE_TEMPLATES",
    "MONTH_NAMES",
    "get_slash_date_extractor",
    "get_dash_date_extractor",
]
