"""Comparison operations for temporal types.

This module provides explicit comparison functions for temporal types.
These serve as the canonical implementation with clear semantics for
edge cases like naive vs aware datetime comparisons.

Comparison Rules:
    - Date comparisons: chronological ordering
    - Time comparisons: earlier/later in day
    - DateTime comparisons:
        * Naive vs Naive: direct chronological comparison
        * Aware vs Aware: compare as UTC instants
        * Naive vs Aware: TypeError for ordering, False for equality
    - Duration comparisons: by total nanoseconds (magnitude)

Supported Operations:
    - equal: Test equality
    - not_equal: Test inequality
    - less_than: Test less-than
    - less_equal: Test less-than-or-equal
    - greater_than: Test greater-than
    - greater_equal: Test greater-than-or-equal
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Union

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

# Type alias for comparable temporal types
ComparableType = Union["Date", "Time", "DateTime", "Duration"]


def equal(left: ComparableType, right: ComparableType) -> bool:
    """Test equality between two temporal values.

    For DateTime comparisons:
    - Naive == Naive: True if same local time
    - Aware == Aware: True if same UTC instant
    - Naive == Aware: Always False (per Q07 decision)

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if values are equal.

    Raises:
        TypeError: If types are not comparable.

    Examples:
        >>> from temporale.core.date import Date
        >>> equal(Date(2024, 1, 15), Date(2024, 1, 15))
        True
        >>> equal(Date(2024, 1, 15), Date(2024, 1, 16))
        False
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

    if type(left) is not type(right):
        # Different types are never equal
        return False

    if isinstance(left, DateTime) and isinstance(right, DateTime):
        return _equal_datetimes(left, right)
    elif isinstance(left, Date) and isinstance(right, Date):
        return left._days == right._days
    elif isinstance(left, Time) and isinstance(right, Time):
        return left._nanos == right._nanos
    elif isinstance(left, Duration) and isinstance(right, Duration):
        return left.total_nanoseconds == right.total_nanoseconds
    else:
        raise TypeError(
            f"cannot compare {type(left).__name__} with {type(right).__name__}"
        )


def not_equal(left: ComparableType, right: ComparableType) -> bool:
    """Test inequality between two temporal values.

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if values are not equal.

    Examples:
        >>> from temporale.core.date import Date
        >>> not_equal(Date(2024, 1, 15), Date(2024, 1, 16))
        True
    """
    return not equal(left, right)


def less_than(left: ComparableType, right: ComparableType) -> bool:
    """Test if left is less than right.

    For DateTime comparisons:
    - Naive vs Naive: chronological comparison
    - Aware vs Aware: compare as UTC instants
    - Naive vs Aware: raises TypeError

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if left < right.

    Raises:
        TypeError: If types are not comparable or if comparing naive/aware DateTimes.

    Examples:
        >>> from temporale.core.date import Date
        >>> less_than(Date(2024, 1, 15), Date(2024, 1, 16))
        True
        >>> less_than(Date(2024, 1, 16), Date(2024, 1, 15))
        False
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

    if type(left) is not type(right):
        raise TypeError(
            f"'<' not supported between instances of {type(left).__name__!r} "
            f"and {type(right).__name__!r}"
        )

    if isinstance(left, DateTime) and isinstance(right, DateTime):
        return _less_than_datetimes(left, right)
    elif isinstance(left, Date) and isinstance(right, Date):
        return left._days < right._days
    elif isinstance(left, Time) and isinstance(right, Time):
        return left._nanos < right._nanos
    elif isinstance(left, Duration) and isinstance(right, Duration):
        return left.total_nanoseconds < right.total_nanoseconds
    else:
        raise TypeError(
            f"'<' not supported between instances of {type(left).__name__!r} "
            f"and {type(right).__name__!r}"
        )


def less_equal(left: ComparableType, right: ComparableType) -> bool:
    """Test if left is less than or equal to right.

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if left <= right.

    Raises:
        TypeError: If types are not comparable.

    Examples:
        >>> from temporale.core.date import Date
        >>> less_equal(Date(2024, 1, 15), Date(2024, 1, 15))
        True
    """
    return equal(left, right) or less_than(left, right)


def greater_than(left: ComparableType, right: ComparableType) -> bool:
    """Test if left is greater than right.

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if left > right.

    Raises:
        TypeError: If types are not comparable.

    Examples:
        >>> from temporale.core.date import Date
        >>> greater_than(Date(2024, 1, 16), Date(2024, 1, 15))
        True
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration
    from temporale.core.time import Time

    if type(left) is not type(right):
        raise TypeError(
            f"'>' not supported between instances of {type(left).__name__!r} "
            f"and {type(right).__name__!r}"
        )

    if isinstance(left, DateTime) and isinstance(right, DateTime):
        return _greater_than_datetimes(left, right)
    elif isinstance(left, Date) and isinstance(right, Date):
        return left._days > right._days
    elif isinstance(left, Time) and isinstance(right, Time):
        return left._nanos > right._nanos
    elif isinstance(left, Duration) and isinstance(right, Duration):
        return left.total_nanoseconds > right.total_nanoseconds
    else:
        raise TypeError(
            f"'>' not supported between instances of {type(left).__name__!r} "
            f"and {type(right).__name__!r}"
        )


def greater_equal(left: ComparableType, right: ComparableType) -> bool:
    """Test if left is greater than or equal to right.

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        True if left >= right.

    Raises:
        TypeError: If types are not comparable.

    Examples:
        >>> from temporale.core.date import Date
        >>> greater_equal(Date(2024, 1, 15), Date(2024, 1, 15))
        True
    """
    return equal(left, right) or greater_than(left, right)


def compare(left: ComparableType, right: ComparableType) -> int:
    """Compare two temporal values, returning -1, 0, or 1.

    This is useful for sorting and other comparison-based operations.

    Args:
        left: First temporal value.
        right: Second temporal value.

    Returns:
        -1 if left < right
        0 if left == right
        1 if left > right

    Raises:
        TypeError: If types are not comparable.

    Examples:
        >>> from temporale.core.date import Date
        >>> compare(Date(2024, 1, 15), Date(2024, 1, 16))
        -1
        >>> compare(Date(2024, 1, 15), Date(2024, 1, 15))
        0
        >>> compare(Date(2024, 1, 16), Date(2024, 1, 15))
        1
    """
    if equal(left, right):
        return 0
    elif less_than(left, right):
        return -1
    else:
        return 1


def min_value(*values: ComparableType) -> ComparableType:
    """Return the minimum of the given temporal values.

    All values must be of the same type.

    Args:
        *values: One or more temporal values of the same type.

    Returns:
        The minimum value.

    Raises:
        ValueError: If no values provided.
        TypeError: If values are of different types.

    Examples:
        >>> from temporale.core.date import Date
        >>> min_value(Date(2024, 1, 20), Date(2024, 1, 15), Date(2024, 1, 18))
        Date(2024, 1, 15)
    """
    if not values:
        raise ValueError("min_value requires at least one argument")

    result = values[0]
    for value in values[1:]:
        if less_than(value, result):
            result = value
    return result


def max_value(*values: ComparableType) -> ComparableType:
    """Return the maximum of the given temporal values.

    All values must be of the same type.

    Args:
        *values: One or more temporal values of the same type.

    Returns:
        The maximum value.

    Raises:
        ValueError: If no values provided.
        TypeError: If values are of different types.

    Examples:
        >>> from temporale.core.date import Date
        >>> max_value(Date(2024, 1, 20), Date(2024, 1, 15), Date(2024, 1, 18))
        Date(2024, 1, 20)
    """
    if not values:
        raise ValueError("max_value requires at least one argument")

    result = values[0]
    for value in values[1:]:
        if greater_than(value, result):
            result = value
    return result


def clamp(
    value: ComparableType,
    min_val: ComparableType,
    max_val: ComparableType,
) -> ComparableType:
    """Clamp a value to be within a range.

    Args:
        value: The value to clamp.
        min_val: The minimum allowed value.
        max_val: The maximum allowed value.

    Returns:
        value if min_val <= value <= max_val,
        min_val if value < min_val,
        max_val if value > max_val.

    Raises:
        TypeError: If types are not compatible.
        ValueError: If min_val > max_val.

    Examples:
        >>> from temporale.core.date import Date
        >>> low = Date(2024, 1, 10)
        >>> high = Date(2024, 1, 20)
        >>> clamp(Date(2024, 1, 15), low, high)
        Date(2024, 1, 15)
        >>> clamp(Date(2024, 1, 5), low, high)
        Date(2024, 1, 10)
        >>> clamp(Date(2024, 1, 25), low, high)
        Date(2024, 1, 20)
    """
    if greater_than(min_val, max_val):
        raise ValueError("min_val must be less than or equal to max_val")

    if less_than(value, min_val):
        return min_val
    elif greater_than(value, max_val):
        return max_val
    else:
        return value


# ---------------------------------------------------------------------------
# Internal implementation functions
# ---------------------------------------------------------------------------


def _equal_datetimes(dt1: "DateTime", dt2: "DateTime") -> bool:
    """Compare two DateTimes for equality."""
    # Naive != Aware (per Q07 decision)
    if (dt1._tz is None) != (dt2._tz is None):
        return False

    # Both naive: compare directly
    if dt1._tz is None:
        return dt1._days == dt2._days and dt1._nanos == dt2._nanos

    # Both aware: compare as UTC
    dt1_utc = dt1.to_utc()
    dt2_utc = dt2.to_utc()
    return dt1_utc._days == dt2_utc._days and dt1_utc._nanos == dt2_utc._nanos


def _less_than_datetimes(dt1: "DateTime", dt2: "DateTime") -> bool:
    """Compare two DateTimes for less-than."""
    _check_datetime_comparable(dt1, dt2)

    # Both naive: compare directly
    if dt1._tz is None:
        if dt1._days != dt2._days:
            return dt1._days < dt2._days
        return dt1._nanos < dt2._nanos

    # Both aware: compare as UTC
    dt1_utc = dt1.to_utc()
    dt2_utc = dt2.to_utc()
    if dt1_utc._days != dt2_utc._days:
        return dt1_utc._days < dt2_utc._days
    return dt1_utc._nanos < dt2_utc._nanos


def _greater_than_datetimes(dt1: "DateTime", dt2: "DateTime") -> bool:
    """Compare two DateTimes for greater-than."""
    _check_datetime_comparable(dt1, dt2)

    # Both naive: compare directly
    if dt1._tz is None:
        if dt1._days != dt2._days:
            return dt1._days > dt2._days
        return dt1._nanos > dt2._nanos

    # Both aware: compare as UTC
    dt1_utc = dt1.to_utc()
    dt2_utc = dt2.to_utc()
    if dt1_utc._days != dt2_utc._days:
        return dt1_utc._days > dt2_utc._days
    return dt1_utc._nanos > dt2_utc._nanos


def _check_datetime_comparable(dt1: "DateTime", dt2: "DateTime") -> None:
    """Check if two DateTimes can be compared for ordering.

    Raises:
        TypeError: If one is naive and the other is aware.
    """
    if (dt1._tz is None) != (dt2._tz is None):
        raise TypeError(
            "can't compare naive and aware datetimes. "
            "Both must be naive or both must be aware."
        )


__all__ = [
    "equal",
    "not_equal",
    "less_than",
    "less_equal",
    "greater_than",
    "greater_equal",
    "compare",
    "min_value",
    "max_value",
    "clamp",
]
