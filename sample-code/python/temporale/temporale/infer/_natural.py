"""Natural language keywords and patterns for relative date parsing.

This module provides keyword mappings and regex patterns for parsing
natural language date expressions like "yesterday", "next Monday",
"3 days ago", etc.

Internal module - use parse_relative() from temporale.infer instead.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import NamedTuple


class RelativeDirection(Enum):
    """Direction for relative date calculations."""

    NEXT = "next"
    LAST = "last"
    THIS = "this"


# Day keywords that resolve to specific offsets from reference
DAY_KEYWORDS: dict[str, int] = {
    "today": 0,
    "yesterday": -1,
    "tomorrow": 1,
}

# Weekday names to day-of-week number (Monday=0, Sunday=6)
WEEKDAY_NAMES: dict[str, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
    # Abbreviations
    "mon": 0,
    "tue": 1,
    "tues": 1,
    "wed": 2,
    "weds": 2,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}

# Time unit names for duration parsing
TIME_UNITS: dict[str, str] = {
    "day": "days",
    "days": "days",
    "week": "weeks",
    "weeks": "weeks",
    "month": "months",
    "months": "months",
    "year": "years",
    "years": "years",
    # Less common but supported
    "hour": "hours",
    "hours": "hours",
    "minute": "minutes",
    "minutes": "minutes",
}

# Period keywords (relative to reference)
PERIOD_KEYWORDS: dict[str, tuple[str, int]] = {
    "next week": ("weeks", 1),
    "last week": ("weeks", -1),
    "next month": ("months", 1),
    "last month": ("months", -1),
    "next year": ("years", 1),
    "last year": ("years", -1),
}


class DurationPhrase(NamedTuple):
    """Parsed duration phrase components."""

    amount: int
    unit: str
    is_ago: bool  # True for "ago", False for "in X" or "from now"


class WeekdayPhrase(NamedTuple):
    """Parsed weekday phrase components."""

    weekday: int  # 0=Monday, 6=Sunday
    direction: RelativeDirection


# Regex patterns for relative date expressions

# Match "N days/weeks/months/years ago"
DURATION_AGO_PATTERN = re.compile(
    r"^(\d+)\s+(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)\s+ago$",
    re.IGNORECASE,
)

# Match "in N days/weeks/months/years" or "N days/weeks/months/years from now"
DURATION_FUTURE_PATTERN = re.compile(
    r"^(?:in\s+)?(\d+)\s+(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)(?:\s+from\s+now)?$",
    re.IGNORECASE,
)

# Match weekday with optional direction: "Monday", "next Monday", "last Friday"
WEEKDAY_PATTERN = re.compile(
    r"^(next|last|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)$",
    re.IGNORECASE,
)

# Match time suffix: "at 3pm", "at 15:30", "at 3:30 PM"
TIME_SUFFIX_PATTERN = re.compile(
    r"\s+at\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([AaPp][Mm])?$",
    re.IGNORECASE,
)


def parse_day_keyword(text: str) -> int | None:
    """Parse a day keyword and return the offset from today.

    Args:
        text: Text to parse (e.g., "today", "yesterday", "tomorrow").

    Returns:
        Day offset from reference (0 for today, -1 for yesterday, etc.),
        or None if not a recognized keyword.
    """
    return DAY_KEYWORDS.get(text.lower().strip())


def parse_weekday_phrase(text: str) -> WeekdayPhrase | None:
    """Parse a weekday phrase.

    Args:
        text: Text to parse (e.g., "Monday", "next Tuesday", "last Friday").

    Returns:
        WeekdayPhrase with weekday number and direction, or None if not matched.
    """
    match = WEEKDAY_PATTERN.match(text.strip())
    if not match:
        return None

    direction_str = match.group(1)
    weekday_str = match.group(2).lower()

    weekday = WEEKDAY_NAMES.get(weekday_str)
    if weekday is None:
        return None

    if direction_str:
        direction = RelativeDirection(direction_str.lower())
    else:
        # No direction specified - default to NEXT (next occurrence)
        direction = RelativeDirection.NEXT

    return WeekdayPhrase(weekday=weekday, direction=direction)


def parse_duration_phrase(text: str) -> DurationPhrase | None:
    """Parse a duration phrase.

    Args:
        text: Text to parse (e.g., "3 days ago", "in 2 weeks", "5 months from now").

    Returns:
        DurationPhrase with amount, unit, and direction, or None if not matched.
    """
    text = text.strip()

    # Try "N unit ago" pattern
    match = DURATION_AGO_PATTERN.match(text)
    if match:
        amount = int(match.group(1))
        unit = TIME_UNITS.get(match.group(2).lower(), match.group(2).lower())
        return DurationPhrase(amount=amount, unit=unit, is_ago=True)

    # Try "in N unit" or "N unit from now" pattern
    match = DURATION_FUTURE_PATTERN.match(text)
    if match:
        amount = int(match.group(1))
        unit = TIME_UNITS.get(match.group(2).lower(), match.group(2).lower())
        return DurationPhrase(amount=amount, unit=unit, is_ago=False)

    return None


def parse_period_keyword(text: str) -> tuple[str, int] | None:
    """Parse a period keyword.

    Args:
        text: Text to parse (e.g., "next week", "last month", "next year").

    Returns:
        Tuple of (unit, offset) like ("months", 1) for "next month",
        or None if not a recognized keyword.
    """
    return PERIOD_KEYWORDS.get(text.lower().strip())


def extract_time_suffix(text: str) -> tuple[str, tuple[int, int, int] | None]:
    """Extract time suffix from text.

    Args:
        text: Text that may end with a time (e.g., "tomorrow at 3pm").

    Returns:
        Tuple of (text_without_time, time_tuple_or_none).
        time_tuple is (hour, minute, second) in 24-hour format, or None.
    """
    match = TIME_SUFFIX_PATTERN.search(text)
    if not match:
        return (text, None)

    # Remove the time suffix from text
    base_text = text[: match.start()].strip()

    hour = int(match.group(1))
    minute = int(match.group(2)) if match.group(2) else 0
    second = int(match.group(3)) if match.group(3) else 0
    ampm = match.group(4)

    # Convert to 24-hour format if AM/PM specified
    if ampm:
        ampm = ampm.upper()
        if ampm == "AM":
            if hour == 12:
                hour = 0
        else:  # PM
            if hour != 12:
                hour += 12

    return (base_text, (hour, minute, second))


__all__ = [
    "RelativeDirection",
    "DAY_KEYWORDS",
    "WEEKDAY_NAMES",
    "TIME_UNITS",
    "PERIOD_KEYWORDS",
    "DurationPhrase",
    "WeekdayPhrase",
    "parse_day_keyword",
    "parse_weekday_phrase",
    "parse_duration_phrase",
    "parse_period_keyword",
    "extract_time_suffix",
]
