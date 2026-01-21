"""Relative date parsing implementation.

This module provides the parse_relative() function for parsing relative
date expressions like "yesterday", "next Monday", "3 days ago", etc.

Internal module - use parse_relative() from temporale.infer instead.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Union

from temporale.errors import ParseError
from temporale.infer._natural import (
    RelativeDirection,
    extract_time_suffix,
    parse_day_keyword,
    parse_duration_phrase,
    parse_period_keyword,
    parse_weekday_phrase,
)

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime

# Type alias for return type
RelativeResult = Union["Date", "DateTime"]


def _get_next_weekday(reference_date: "Date", target_weekday: int) -> "Date":
    """Get the next occurrence of a weekday (including today if it's that day).

    Args:
        reference_date: The reference date.
        target_weekday: Target day of week (0=Monday, 6=Sunday).

    Returns:
        The next occurrence of the target weekday.
    """
    from temporale.core.duration import Duration

    current_weekday = reference_date.day_of_week
    if target_weekday >= current_weekday:
        days_ahead = target_weekday - current_weekday
    else:
        days_ahead = 7 - current_weekday + target_weekday

    # If same day and direction is NEXT (not THIS), go to next week
    if days_ahead == 0:
        days_ahead = 7

    return reference_date + Duration(days=days_ahead)


def _get_next_weekday_strict(reference_date: "Date", target_weekday: int) -> "Date":
    """Get the next occurrence of a weekday strictly after today.

    Args:
        reference_date: The reference date.
        target_weekday: Target day of week (0=Monday, 6=Sunday).

    Returns:
        The next occurrence of the target weekday, always > reference_date.
    """
    from temporale.core.duration import Duration

    current_weekday = reference_date.day_of_week
    if target_weekday > current_weekday:
        days_ahead = target_weekday - current_weekday
    else:
        # Target is same day or earlier in week - go to next week
        days_ahead = 7 - current_weekday + target_weekday

    return reference_date + Duration(days=days_ahead)


def _get_last_weekday(reference_date: "Date", target_weekday: int) -> "Date":
    """Get the most recent past occurrence of a weekday.

    Args:
        reference_date: The reference date.
        target_weekday: Target day of week (0=Monday, 6=Sunday).

    Returns:
        The most recent past occurrence of the target weekday, always < reference_date.
    """
    from temporale.core.duration import Duration

    current_weekday = reference_date.day_of_week
    if target_weekday < current_weekday:
        days_back = current_weekday - target_weekday
    else:
        # Target is same day or later in week - go to previous week
        days_back = 7 - target_weekday + current_weekday

    return reference_date - Duration(days=days_back)


def _get_this_weekday(reference_date: "Date", target_weekday: int) -> "Date":
    """Get the occurrence of a weekday in the current week.

    Args:
        reference_date: The reference date.
        target_weekday: Target day of week (0=Monday, 6=Sunday).

    Returns:
        The target weekday in the same week as reference_date.
        Week is considered Monday-Sunday.
    """
    from temporale.core.duration import Duration

    current_weekday = reference_date.day_of_week
    days_diff = target_weekday - current_weekday

    return reference_date + Duration(days=days_diff)


def parse_relative(
    text: str,
    reference: "DateTime | None" = None,
) -> RelativeResult:
    """Parse a relative date expression.

    Examines the input string to detect relative date patterns and
    calculates the result relative to the reference point.

    Args:
        text: The relative date expression to parse.
        reference: Reference point for calculation. If None, uses DateTime.now().

    Returns:
        Date or DateTime depending on whether time was specified in the input.

    Raises:
        ParseError: If the expression cannot be parsed.

    Supported patterns:
        Day keywords:
            - "today" -> reference date
            - "yesterday" -> reference - 1 day
            - "tomorrow" -> reference + 1 day

        Weekday references:
            - "Monday" -> next Monday (including today if today is Monday)
            - "next Monday" -> next Monday strictly after today
            - "last Monday" -> most recent Monday before today
            - "this Monday" -> Monday of the current week

        Duration phrases:
            - "3 days ago" -> reference - 3 days
            - "in 2 weeks" -> reference + 2 weeks
            - "5 months ago" -> reference - 5 months
            - "in 1 year" -> reference + 1 year
            - "2 weeks from now" -> reference + 2 weeks

        Period keywords:
            - "next week" -> reference + 7 days
            - "last week" -> reference - 7 days
            - "next month" -> reference + 1 month
            - "last month" -> reference - 1 month
            - "next year" -> reference + 1 year
            - "last year" -> reference - 1 year

        With time:
            - "tomorrow at 3pm" -> tomorrow at 15:00
            - "next Monday at 9:30" -> next Monday at 09:30
            - "3 days ago at 14:00" -> 3 days ago at 14:00

    Examples:
        >>> from temporale import DateTime
        >>> ref = DateTime(2024, 1, 15, 12, 0, 0)  # Monday
        >>> parse_relative("yesterday", ref)
        Date(2024, 1, 14)

        >>> parse_relative("next Friday", ref)
        Date(2024, 1, 19)

        >>> parse_relative("3 days ago", ref)
        Date(2024, 1, 12)

        >>> parse_relative("tomorrow at 3pm", ref)
        DateTime(2024, 1, 16, 15, 0, 0)
    """
    # Import here to avoid circular imports
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.period import Period

    if reference is None:
        reference = DateTime.now()

    text = text.strip()
    if not text:
        raise ParseError("empty string")

    # Check for time suffix and extract it
    base_text, time_tuple = extract_time_suffix(text)
    has_time = time_tuple is not None

    # Get reference date for calculations
    ref_date: Date = reference.date()

    result_date: Date | None = None

    # Try day keywords first (today, yesterday, tomorrow)
    offset = parse_day_keyword(base_text)
    if offset is not None:
        if offset == 0:
            result_date = ref_date
        elif offset < 0:
            result_date = ref_date - Duration(days=abs(offset))
        else:
            result_date = ref_date + Duration(days=offset)
    else:
        # Try period keywords (next week, last month, etc.)
        period_info = parse_period_keyword(base_text)
        if period_info is not None:
            unit, amount = period_info
            if unit == "weeks":
                if amount > 0:
                    result_date = ref_date + Duration(days=7 * amount)
                else:
                    result_date = ref_date - Duration(days=7 * abs(amount))
            elif unit == "months":
                if amount > 0:
                    result_date = ref_date + Period(months=amount)
                else:
                    result_date = ref_date - Period(months=abs(amount))
            elif unit == "years":
                if amount > 0:
                    result_date = ref_date + Period(years=amount)
                else:
                    result_date = ref_date - Period(years=abs(amount))
        else:
            # Try weekday phrases (Monday, next Tuesday, last Friday)
            weekday_info = parse_weekday_phrase(base_text)
            if weekday_info is not None:
                if weekday_info.direction == RelativeDirection.NEXT:
                    result_date = _get_next_weekday_strict(
                        ref_date, weekday_info.weekday
                    )
                elif weekday_info.direction == RelativeDirection.LAST:
                    result_date = _get_last_weekday(ref_date, weekday_info.weekday)
                elif weekday_info.direction == RelativeDirection.THIS:
                    result_date = _get_this_weekday(ref_date, weekday_info.weekday)
            else:
                # Try duration phrases (3 days ago, in 2 weeks)
                duration_info = parse_duration_phrase(base_text)
                if duration_info is not None:
                    unit = duration_info.unit
                    amount = duration_info.amount

                    if unit == "days":
                        delta = Duration(days=amount)
                    elif unit == "weeks":
                        delta = Duration(days=amount * 7)
                    elif unit == "months":
                        # Use Period for months/years
                        if duration_info.is_ago:
                            result_date = ref_date - Period(months=amount)
                        else:
                            result_date = ref_date + Period(months=amount)
                        delta = None  # Already computed
                    elif unit == "years":
                        if duration_info.is_ago:
                            result_date = ref_date - Period(years=amount)
                        else:
                            result_date = ref_date + Period(years=amount)
                        delta = None  # Already computed
                    elif unit == "hours":
                        # Hours work with DateTime, not Date
                        has_time = True
                        if duration_info.is_ago:
                            ref_dt = reference - Duration.from_hours(amount)
                        else:
                            ref_dt = reference + Duration.from_hours(amount)
                        if time_tuple:
                            # Override time with specified time
                            return DateTime(
                                year=ref_dt.year,
                                month=ref_dt.month,
                                day=ref_dt.day,
                                hour=time_tuple[0],
                                minute=time_tuple[1],
                                second=time_tuple[2],
                            )
                        return ref_dt
                    elif unit == "minutes":
                        # Minutes work with DateTime, not Date
                        has_time = True
                        if duration_info.is_ago:
                            ref_dt = reference - Duration.from_minutes(amount)
                        else:
                            ref_dt = reference + Duration.from_minutes(amount)
                        if time_tuple:
                            return DateTime(
                                year=ref_dt.year,
                                month=ref_dt.month,
                                day=ref_dt.day,
                                hour=time_tuple[0],
                                minute=time_tuple[1],
                                second=time_tuple[2],
                            )
                        return ref_dt
                    else:
                        raise ParseError(f"unknown time unit: {unit}")

                    if delta is not None:
                        if duration_info.is_ago:
                            result_date = ref_date - delta
                        else:
                            result_date = ref_date + delta

    if result_date is None:
        raise ParseError(
            f"cannot parse relative date expression: {text!r}. "
            "Expected patterns like 'today', 'next Monday', '3 days ago', etc."
        )

    # Return DateTime if time was specified, otherwise Date
    if has_time and time_tuple is not None:
        return DateTime(
            year=result_date.year,
            month=result_date.month,
            day=result_date.day,
            hour=time_tuple[0],
            minute=time_tuple[1],
            second=time_tuple[2],
        )
    else:
        return result_date


__all__ = [
    "parse_relative",
]
