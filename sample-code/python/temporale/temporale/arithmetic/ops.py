"""Standalone arithmetic operations for temporal types.

This module provides explicit functions for temporal arithmetic that serve
as the canonical implementation. The dunder methods on temporal classes
delegate to these functions to ensure DRY (Don't Repeat Yourself) compliance.

Supported operations:
    - add: Add durations to temporal types
    - subtract: Subtract durations or compute differences
    - multiply: Scale durations by scalars
    - divide: Divide durations by scalars

Type Combinations:
    - DateTime + Duration -> DateTime
    - DateTime - Duration -> DateTime
    - DateTime - DateTime -> Duration
    - Date + Duration -> Date
    - Date - Duration -> Date
    - Date - Date -> Duration
    - Duration + Duration -> Duration
    - Duration - Duration -> Duration
    - Duration * int -> Duration
    - Duration / (int|float) -> Duration
    - Duration // int -> Duration
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Union, overload

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration

# Type alias for temporal types that can participate in arithmetic
TemporalType = Union["Date", "DateTime", "Duration"]
AddableType = Union["Date", "DateTime"]


@overload
def add(left: "DateTime", right: "Duration") -> "DateTime": ...


@overload
def add(left: "Date", right: "Duration") -> "Date": ...


@overload
def add(left: "Duration", right: "Duration") -> "Duration": ...


def add(
    left: Union["DateTime", "Date", "Duration"],
    right: "Duration",
) -> Union["DateTime", "Date", "Duration"]:
    """Add a Duration to a temporal type.

    This is the canonical implementation of addition for temporal types.
    Class operators delegate to this function.

    Args:
        left: A DateTime, Date, or Duration.
        right: A Duration to add.

    Returns:
        A new temporal object of the same type as left, offset by right.

    Raises:
        TypeError: If the types are incompatible for addition.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.duration import Duration
        >>> add(Date(2024, 1, 15), Duration(days=10))
        Date(2024, 1, 25)

        >>> add(Duration(seconds=30), Duration(seconds=45))
        Duration(days=0, seconds=75, nanoseconds=0)
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration

    if not isinstance(right, Duration):
        raise TypeError(
            f"can only add Duration to temporal types, not {type(right).__name__}"
        )

    if isinstance(left, DateTime):
        return _add_duration_to_datetime(left, right)
    elif isinstance(left, Date):
        return _add_duration_to_date(left, right)
    elif isinstance(left, Duration):
        return _add_durations(left, right)
    else:
        raise TypeError(
            f"unsupported operand type(s) for +: {type(left).__name__!r} and 'Duration'"
        )


@overload
def subtract(left: "DateTime", right: "Duration") -> "DateTime": ...


@overload
def subtract(left: "DateTime", right: "DateTime") -> "Duration": ...


@overload
def subtract(left: "Date", right: "Duration") -> "Date": ...


@overload
def subtract(left: "Date", right: "Date") -> "Duration": ...


@overload
def subtract(left: "Duration", right: "Duration") -> "Duration": ...


def subtract(
    left: Union["DateTime", "Date", "Duration"],
    right: Union["DateTime", "Date", "Duration"],
) -> Union["DateTime", "Date", "Duration"]:
    """Subtract a Duration or same temporal type from a temporal value.

    When subtracting a Duration from DateTime/Date, returns the same type.
    When subtracting two DateTimes or two Dates, returns a Duration.

    Args:
        left: A DateTime, Date, or Duration.
        right: A Duration or same type as left.

    Returns:
        If right is Duration: same type as left, offset backward.
        If right is same type as left: Duration representing the difference.

    Raises:
        TypeError: If the types are incompatible for subtraction.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.duration import Duration
        >>> subtract(Date(2024, 1, 25), Duration(days=10))
        Date(2024, 1, 15)

        >>> subtract(Date(2024, 1, 25), Date(2024, 1, 15))
        Duration(days=10, seconds=0, nanoseconds=0)
    """
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration

    if isinstance(left, DateTime):
        if isinstance(right, Duration):
            return _subtract_duration_from_datetime(left, right)
        elif isinstance(right, DateTime):
            return _subtract_datetimes(left, right)
        else:
            raise TypeError(
                f"unsupported operand type(s) for -: 'DateTime' and {type(right).__name__!r}"
            )
    elif isinstance(left, Date):
        if isinstance(right, Duration):
            return _subtract_duration_from_date(left, right)
        elif isinstance(right, Date):
            return _subtract_dates(left, right)
        else:
            raise TypeError(
                f"unsupported operand type(s) for -: 'Date' and {type(right).__name__!r}"
            )
    elif isinstance(left, Duration):
        if isinstance(right, Duration):
            return _subtract_durations(left, right)
        else:
            raise TypeError(
                f"unsupported operand type(s) for -: 'Duration' and {type(right).__name__!r}"
            )
    else:
        raise TypeError(
            f"unsupported operand type(s) for -: {type(left).__name__!r} and {type(right).__name__!r}"
        )


def multiply(duration: "Duration", scalar: int) -> "Duration":
    """Multiply a Duration by an integer scalar.

    Args:
        duration: The Duration to scale.
        scalar: The integer multiplier.

    Returns:
        A new Duration scaled by the multiplier.

    Raises:
        TypeError: If duration is not a Duration or scalar is not an int.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> multiply(Duration(seconds=30), 3)
        Duration(days=0, seconds=90, nanoseconds=0)

        >>> multiply(Duration(days=1), -2)
        Duration(days=-2, seconds=0, nanoseconds=0)
    """
    from temporale.core.duration import Duration

    if not isinstance(duration, Duration):
        raise TypeError(
            f"can only multiply Duration by scalar, not {type(duration).__name__}"
        )
    if not isinstance(scalar, int):
        raise TypeError(
            f"can only multiply Duration by int, not {type(scalar).__name__}"
        )

    total_nanos = duration.total_nanoseconds * scalar
    return Duration(nanoseconds=total_nanos)


@overload
def divide(duration: "Duration", divisor: int) -> "Duration": ...


@overload
def divide(duration: "Duration", divisor: float) -> "Duration": ...


def divide(duration: "Duration", divisor: Union[int, float]) -> "Duration":
    """Divide a Duration by a scalar (true division).

    Args:
        duration: The Duration to divide.
        divisor: The divisor (int or float).

    Returns:
        A new Duration representing the quotient.

    Raises:
        TypeError: If duration is not a Duration or divisor is not numeric.
        ZeroDivisionError: If divisor is zero.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> divide(Duration(seconds=90), 3)
        Duration(days=0, seconds=30, nanoseconds=0)
    """
    from temporale.core.duration import Duration

    if not isinstance(duration, Duration):
        raise TypeError(
            f"can only divide Duration by scalar, not {type(duration).__name__}"
        )
    if not isinstance(divisor, (int, float)):
        raise TypeError(
            f"can only divide Duration by number, not {type(divisor).__name__}"
        )
    if divisor == 0:
        raise ZeroDivisionError("division by zero")

    total_nanos = int(duration.total_nanoseconds / divisor)
    return Duration(nanoseconds=total_nanos)


def floor_divide(duration: "Duration", divisor: int) -> "Duration":
    """Divide a Duration by an integer using floor division.

    Args:
        duration: The Duration to divide.
        divisor: The integer divisor.

    Returns:
        A new Duration representing the floor quotient.

    Raises:
        TypeError: If duration is not a Duration or divisor is not an int.
        ZeroDivisionError: If divisor is zero.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> floor_divide(Duration(seconds=100), 3)
        Duration(days=0, seconds=33, nanoseconds=333333333)
    """
    from temporale.core.duration import Duration

    if not isinstance(duration, Duration):
        raise TypeError(
            f"can only floor divide Duration by int, not {type(duration).__name__}"
        )
    if not isinstance(divisor, int):
        raise TypeError(
            f"can only floor divide Duration by int, not {type(divisor).__name__}"
        )
    if divisor == 0:
        raise ZeroDivisionError("integer division or modulo by zero")

    total_nanos = duration.total_nanoseconds // divisor
    return Duration(nanoseconds=total_nanos)


def negate(duration: "Duration") -> "Duration":
    """Return the negation of a Duration.

    Args:
        duration: The Duration to negate.

    Returns:
        A new Duration with opposite sign.

    Raises:
        TypeError: If duration is not a Duration.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> negate(Duration(seconds=30))
        Duration(days=-1, seconds=86370, nanoseconds=0)
    """
    from temporale.core.duration import Duration

    if not isinstance(duration, Duration):
        raise TypeError(f"can only negate Duration, not {type(duration).__name__}")

    return Duration(nanoseconds=-duration.total_nanoseconds)


def absolute(duration: "Duration") -> "Duration":
    """Return the absolute value of a Duration.

    Args:
        duration: The Duration.

    Returns:
        A new Duration with the same magnitude but positive.

    Raises:
        TypeError: If duration is not a Duration.

    Examples:
        >>> from temporale.core.duration import Duration
        >>> absolute(Duration(days=-1))
        Duration(days=1, seconds=0, nanoseconds=0)
    """
    from temporale.core.duration import Duration

    if not isinstance(duration, Duration):
        raise TypeError(
            f"can only take absolute value of Duration, not {type(duration).__name__}"
        )

    if duration.is_negative:
        return negate(duration)
    return Duration(
        days=duration.days,
        seconds=duration.seconds,
        nanoseconds=duration.nanoseconds,
    )


# ---------------------------------------------------------------------------
# Internal implementation functions
# ---------------------------------------------------------------------------


def _add_duration_to_datetime(dt: "DateTime", duration: "Duration") -> "DateTime":
    """Add Duration to DateTime, returning new DateTime."""
    from temporale.core.datetime import DateTime
    from temporale._internal.constants import NANOS_PER_DAY

    total_nanos = duration.total_nanoseconds
    new_nanos = dt._nanos + (total_nanos % NANOS_PER_DAY)
    new_days = dt._days + (total_nanos // NANOS_PER_DAY)

    # Handle day overflow/underflow
    while new_nanos >= NANOS_PER_DAY:
        new_nanos -= NANOS_PER_DAY
        new_days += 1
    while new_nanos < 0:
        new_nanos += NANOS_PER_DAY
        new_days -= 1

    return DateTime._from_internal(new_days, new_nanos, dt._tz)


def _add_duration_to_date(date: "Date", duration: "Duration") -> "Date":
    """Add Duration to Date, returning new Date (whole days only)."""
    return date.add_days(duration.days)


def _add_durations(d1: "Duration", d2: "Duration") -> "Duration":
    """Add two Durations."""
    from temporale.core.duration import Duration

    return Duration(
        days=d1._days + d2._days,
        seconds=d1._seconds + d2._seconds,
        nanoseconds=d1._nanos + d2._nanos,
    )


def _subtract_duration_from_datetime(dt: "DateTime", duration: "Duration") -> "DateTime":
    """Subtract Duration from DateTime."""
    return _add_duration_to_datetime(dt, negate(duration))


def _subtract_duration_from_date(date: "Date", duration: "Duration") -> "Date":
    """Subtract Duration from Date."""
    return date.add_days(-duration.days)


def _subtract_dates(d1: "Date", d2: "Date") -> "Duration":
    """Subtract two Dates to get Duration."""
    from temporale.core.duration import Duration

    day_diff = d1._days - d2._days
    return Duration(days=day_diff)


def _subtract_datetimes(dt1: "DateTime", dt2: "DateTime") -> "Duration":
    """Subtract two DateTimes to get Duration."""
    from temporale.core.duration import Duration
    from temporale.errors import TimezoneError
    from temporale._internal.constants import NANOS_PER_DAY

    # Check for naive/aware mismatch
    if (dt1._tz is None) != (dt2._tz is None):
        raise TimezoneError(
            "Cannot subtract naive and aware datetimes. "
            "Both must be naive or both must be aware."
        )

    # If both are aware, convert to same timezone for comparison
    if dt1._tz is not None and dt2._tz is not None:
        if dt1._tz.offset_seconds != dt2._tz.offset_seconds:
            dt2 = dt2.astimezone(dt1._tz)

    # Calculate difference in nanoseconds
    days_diff = dt1._days - dt2._days
    nanos_diff = dt1._nanos - dt2._nanos

    total_nanos = days_diff * NANOS_PER_DAY + nanos_diff
    return Duration(nanoseconds=total_nanos)


def _subtract_durations(d1: "Duration", d2: "Duration") -> "Duration":
    """Subtract two Durations."""
    from temporale.core.duration import Duration

    return Duration(
        days=d1._days - d2._days,
        seconds=d1._seconds - d2._seconds,
        nanoseconds=d1._nanos - d2._nanos,
    )


__all__ = [
    "add",
    "subtract",
    "multiply",
    "divide",
    "floor_divide",
    "negate",
    "absolute",
]
