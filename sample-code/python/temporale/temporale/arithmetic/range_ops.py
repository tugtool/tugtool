"""Range operation helpers for Interval types.

This module provides utility functions for working with intervals:
    - merge_intervals: Merge overlapping intervals in a sequence
    - span_intervals: Get the span covering all intervals
    - find_gaps: Find gaps between intervals

These functions complement the Interval class methods with operations
that work on collections of intervals.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar, Sequence

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.interval import Interval
    from temporale.core.duration import Duration

T = TypeVar("T", "Date", "DateTime")


def merge_intervals(intervals: Sequence[Interval[T]]) -> list[Interval[T]]:
    """Merge overlapping or adjacent intervals into a minimal set.

    Takes a sequence of intervals and returns a sorted list with
    overlapping and adjacent intervals merged together.

    Empty intervals are filtered out.

    Args:
        intervals: A sequence of Intervals to merge.

    Returns:
        A sorted list of non-overlapping intervals.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.interval import Interval
        >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
        >>> i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
        >>> i3 = Interval(Date(2024, 2, 1), Date(2024, 2, 10))
        >>> merge_intervals([i1, i2, i3])
        [Interval(Date(2024, 1, 1), Date(2024, 1, 20)), Interval(Date(2024, 2, 1), Date(2024, 2, 10))]
    """
    # Filter out empty intervals and unbounded intervals
    bounded = [i for i in intervals if not i.is_empty and i.is_bounded]

    if not bounded:
        return []

    # Sort by start time
    sorted_intervals = sorted(bounded, key=lambda i: i.start)  # type: ignore[arg-type]

    result: list[Interval[T]] = []
    current = sorted_intervals[0]

    for interval in sorted_intervals[1:]:
        # Try to merge with current
        merged = current.union(interval)
        if merged is not None:
            current = merged
        else:
            # No overlap, add current and start new
            result.append(current)
            current = interval

    result.append(current)
    return result


def span_intervals(intervals: Sequence[Interval[T]]) -> Interval[T] | None:
    """Get the span covering all intervals.

    Returns a single interval that spans from the earliest start
    to the latest end of all input intervals.

    Empty and unbounded intervals are handled specially:
    - Empty intervals are ignored
    - If any interval is unbounded in a direction, the result is too

    Args:
        intervals: A sequence of Intervals.

    Returns:
        An Interval spanning all inputs, or None if all empty.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.interval import Interval
        >>> i1 = Interval(Date(2024, 1, 10), Date(2024, 1, 15))
        >>> i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 5))
        >>> i3 = Interval(Date(2024, 1, 20), Date(2024, 1, 25))
        >>> span_intervals([i1, i2, i3])
        Interval(Date(2024, 1, 1), Date(2024, 1, 25))
    """
    from temporale.core.interval import Interval

    # Filter out empty intervals
    non_empty = [i for i in intervals if not i.is_empty]

    if not non_empty:
        return None

    # Find the bounds
    min_start: T | None = None
    max_end: T | None = None
    has_unbounded_start = False
    has_unbounded_end = False

    for interval in non_empty:
        if interval.start is None:
            has_unbounded_start = True
        elif min_start is None or interval.start < min_start:
            min_start = interval.start

        if interval.end is None:
            has_unbounded_end = True
        elif max_end is None or interval.end > max_end:
            max_end = interval.end

    # Build the result
    start = None if has_unbounded_start else min_start
    end = None if has_unbounded_end else max_end

    if start is None and end is None:
        # Fully unbounded
        return Interval._create_unbounded(None, None)
    elif start is None:
        return Interval.until(end)  # type: ignore[arg-type]
    elif end is None:
        return Interval.since(start)
    else:
        return Interval(start, end)


def find_gaps(intervals: Sequence[Interval[T]]) -> list[Interval[T]]:
    """Find gaps between intervals.

    Returns a list of intervals representing the gaps between
    the input intervals. Input intervals are first merged,
    then gaps between the merged results are returned.

    Args:
        intervals: A sequence of Intervals.

    Returns:
        A list of Intervals representing the gaps.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.interval import Interval
        >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        >>> i2 = Interval(Date(2024, 1, 20), Date(2024, 1, 30))
        >>> find_gaps([i1, i2])
        [Interval(Date(2024, 1, 10), Date(2024, 1, 20))]
    """
    from temporale.core.interval import Interval

    # First merge to get canonical form
    merged = merge_intervals(intervals)

    if len(merged) < 2:
        return []

    gaps: list[Interval[T]] = []
    for i in range(len(merged) - 1):
        current = merged[i]
        next_interval = merged[i + 1]

        # Current ends at current.end, next starts at next_interval.start
        if current.end is not None and next_interval.start is not None:
            if current.end < next_interval.start:
                gaps.append(Interval(current.end, next_interval.start))

    return gaps


def total_duration(intervals: Sequence[Interval[T]]) -> Duration | None:
    """Calculate the total duration of all intervals combined.

    Merges overlapping intervals first to avoid double-counting.
    Returns None if any interval is unbounded.

    Args:
        intervals: A sequence of Intervals.

    Returns:
        Total Duration, or None if any interval is unbounded.

    Examples:
        >>> from temporale.core.date import Date
        >>> from temporale.core.interval import Interval
        >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
        >>> i2 = Interval(Date(2024, 1, 5), Date(2024, 1, 15))
        >>> total_duration([i1, i2])
        Duration(days=14, seconds=0, nanoseconds=0)
    """
    from temporale.core.duration import Duration

    merged = merge_intervals(intervals)

    if not merged:
        return Duration.zero()

    total = Duration.zero()
    for interval in merged:
        d = interval.duration()
        if d is None:
            return None  # Unbounded interval
        total = total + d

    return total


__all__ = [
    "merge_intervals",
    "span_intervals",
    "find_gaps",
    "total_duration",
]
