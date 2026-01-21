"""Interval class representing a time span between two points.

This module provides the Interval class for representing bounded and unbounded
time spans with half-open semantics [start, end) by default.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Generic, TypeVar, Union, overload

if TYPE_CHECKING:
    from temporale.core.date import Date
    from temporale.core.datetime import DateTime
    from temporale.core.duration import Duration

# TypeVar for the temporal point type (Date or DateTime)
T = TypeVar("T", "Date", "DateTime")


class Interval(Generic[T]):
    """A time span between two points, half-open [start, end) by default.

    Intervals can represent:
    - Bounded: Interval(start, end) - both endpoints specified
    - Open start: Interval.until(end) - no start bound
    - Open end: Interval.since(start) - no end bound
    - Empty: Interval.empty() - represents no time at all

    The interval uses half-open semantics:
    - Start is inclusive (contained in the interval)
    - End is exclusive (not contained in the interval)

    This design makes intervals composable: [a,b) + [b,c) = [a,c)
    with no gap or overlap at the boundary.

    Attributes:
        start: Start of interval (inclusive), or None if unbounded.
        end: End of interval (exclusive), or None if unbounded.

    Examples:
        >>> from temporale.core.date import Date
        >>> i = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
        >>> Date(2024, 1, 15) in i  # Uses __contains__
        True
        >>> Date(2024, 1, 31) in i  # End is exclusive
        False

        >>> i.duration()
        Duration(days=30, seconds=0, nanoseconds=0)
    """

    __slots__ = ("_start", "_end", "_is_empty")

    def __init__(self, start: T, end: T) -> None:
        """Create a bounded interval [start, end).

        Args:
            start: Start of the interval (inclusive).
            end: End of the interval (exclusive).

        Raises:
            ValueError: If end <= start.

        Examples:
            >>> from temporale.core.date import Date
            >>> Interval(Date(2024, 1, 1), Date(2024, 12, 31))
            Interval(Date(2024, 1, 1), Date(2024, 12, 31))
        """
        if end <= start:
            raise ValueError(
                f"end must be greater than start: got start={start}, end={end}"
            )
        self._start: T | None = start
        self._end: T | None = end
        self._is_empty: bool = False

    @classmethod
    def _create_unbounded(
        cls,
        start: T | None,
        end: T | None,
        is_empty: bool = False,
    ) -> Interval[T]:
        """Internal factory for creating unbounded or empty intervals.

        This bypasses the validation in __init__.
        """
        instance: Interval[T] = object.__new__(cls)
        instance._start = start
        instance._end = end
        instance._is_empty = is_empty
        return instance

    @classmethod
    def since(cls, start: T) -> Interval[T]:
        """Create an interval [start, infinity).

        This represents all time points from start onwards.

        Args:
            start: The start of the interval (inclusive).

        Returns:
            An interval with no upper bound.

        Examples:
            >>> from temporale.core.date import Date
            >>> i = Interval.since(Date(2024, 1, 1))
            >>> i.is_bounded
            False
            >>> i.start
            Date(2024, 1, 1)
            >>> i.end is None
            True
        """
        return cls._create_unbounded(start, None)

    @classmethod
    def until(cls, end: T) -> Interval[T]:
        """Create an interval (-infinity, end).

        This represents all time points before end.

        Args:
            end: The end of the interval (exclusive).

        Returns:
            An interval with no lower bound.

        Examples:
            >>> from temporale.core.date import Date
            >>> i = Interval.until(Date(2024, 12, 31))
            >>> i.is_bounded
            False
            >>> i.start is None
            True
            >>> i.end
            Date(2024, 12, 31)
        """
        return cls._create_unbounded(None, end)

    @classmethod
    def empty(cls) -> Interval:
        """Create an empty interval.

        An empty interval contains no time points.

        Returns:
            An empty interval.

        Examples:
            >>> i = Interval.empty()
            >>> i.is_empty
            True
            >>> i.is_bounded
            True
        """
        return cls._create_unbounded(None, None, is_empty=True)

    @property
    def start(self) -> T | None:
        """Return the start of the interval, or None if unbounded.

        Returns:
            The start point (inclusive), or None.
        """
        return self._start

    @property
    def end(self) -> T | None:
        """Return the end of the interval, or None if unbounded.

        Returns:
            The end point (exclusive), or None.
        """
        return self._end

    @property
    def is_bounded(self) -> bool:
        """Return True if both start and end are specified.

        An empty interval is considered bounded (just contains nothing).

        Returns:
            True if the interval has both bounds.

        Examples:
            >>> from temporale.core.date import Date
            >>> Interval(Date(2024, 1, 1), Date(2024, 1, 31)).is_bounded
            True
            >>> Interval.since(Date(2024, 1, 1)).is_bounded
            False
            >>> Interval.empty().is_bounded
            True
        """
        if self._is_empty:
            return True
        return self._start is not None and self._end is not None

    @property
    def is_empty(self) -> bool:
        """Return True if this is an empty interval.

        Returns:
            True if the interval contains no time points.

        Examples:
            >>> Interval.empty().is_empty
            True
            >>> from temporale.core.date import Date
            >>> Interval(Date(2024, 1, 1), Date(2024, 1, 2)).is_empty
            False
        """
        return self._is_empty

    def duration(self) -> Duration | None:
        """Return the duration of a bounded interval, or None.

        For Date intervals, returns a Duration in whole days.
        For DateTime intervals, returns a Duration with full precision.

        Returns:
            The Duration of the interval, or None if unbounded or empty.

        Examples:
            >>> from temporale.core.date import Date
            >>> Interval(Date(2024, 1, 1), Date(2024, 1, 31)).duration()
            Duration(days=30, seconds=0, nanoseconds=0)

            >>> Interval.since(Date(2024, 1, 1)).duration() is None
            True

            >>> Interval.empty().duration() is None
            True
        """
        if self._is_empty or self._start is None or self._end is None:
            return None

        # The subtraction operator on Date/DateTime returns a Duration
        return self._end - self._start  # type: ignore[return-value]

    @overload
    def contains(self, other: T) -> bool: ...

    @overload
    def contains(self, other: Interval[T]) -> bool: ...

    def contains(self, other: Union[T, Interval[T]]) -> bool:
        """Check if this interval contains a point or another interval.

        For a point: True if start <= point < end (respecting unbounded ends).
        For an interval: True if this fully contains the other interval.

        Args:
            other: A time point or another Interval to check.

        Returns:
            True if other is contained within this interval.

        Examples:
            >>> from temporale.core.date import Date
            >>> i = Interval(Date(2024, 1, 1), Date(2024, 1, 31))

            >>> # Point containment
            >>> i.contains(Date(2024, 1, 15))
            True
            >>> i.contains(Date(2024, 1, 31))  # End is exclusive
            False

            >>> # Interval containment
            >>> sub = Interval(Date(2024, 1, 5), Date(2024, 1, 10))
            >>> i.contains(sub)
            True
        """
        if self._is_empty:
            return False

        if isinstance(other, Interval):
            return self._contains_interval(other)
        else:
            return self._contains_point(other)

    def _contains_point(self, point: T) -> bool:
        """Check if this interval contains a single point."""
        # Empty interval contains nothing
        if self._is_empty:
            return False

        # Check lower bound (inclusive)
        if self._start is not None and point < self._start:
            return False

        # Check upper bound (exclusive)
        if self._end is not None and point >= self._end:
            return False

        return True

    def _contains_interval(self, other: Interval[T]) -> bool:
        """Check if this interval fully contains another interval."""
        # Empty interval contains nothing (not even another empty)
        if self._is_empty:
            return False

        # An empty interval is contained by any non-empty interval
        if other._is_empty:
            return True

        # Check start: our start must be <= other's start (or unbounded)
        if self._start is not None:
            if other._start is None:
                # We're bounded but they're unbounded below
                return False
            if other._start < self._start:
                return False

        # Check end: our end must be >= other's end (or unbounded)
        if self._end is not None:
            if other._end is None:
                # We're bounded but they're unbounded above
                return False
            if other._end > self._end:
                return False

        return True

    def __contains__(self, point: T) -> bool:
        """Support 'point in interval' syntax.

        Args:
            point: A time point to check.

        Returns:
            True if the point is in the interval.

        Examples:
            >>> from temporale.core.date import Date
            >>> i = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
            >>> Date(2024, 1, 15) in i
            True
        """
        return self._contains_point(point)

    def overlaps(self, other: Interval[T]) -> bool:
        """Check if this interval overlaps with another.

        Two intervals overlap if they share at least one point.
        Empty intervals don't overlap with anything.

        Args:
            other: Another Interval to check.

        Returns:
            True if the intervals share any time.

        Examples:
            >>> from temporale.core.date import Date
            >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
            >>> i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
            >>> i1.overlaps(i2)
            True

            >>> i3 = Interval(Date(2024, 1, 15), Date(2024, 1, 20))
            >>> i1.overlaps(i3)  # i1 ends exactly where i3 starts
            False
        """
        # Empty intervals don't overlap with anything
        if self._is_empty or other._is_empty:
            return False

        # Check if one starts after the other ends
        # self ends before other starts?
        if self._end is not None and other._start is not None:
            if self._end <= other._start:
                return False

        # other ends before self starts?
        if other._end is not None and self._start is not None:
            if other._end <= self._start:
                return False

        return True

    def gap(self, other: Interval[T]) -> Duration | None:
        """Return the duration between non-overlapping intervals.

        If the intervals overlap, returns None.
        If either interval is empty or unbounded in the gap direction,
        returns None.

        Args:
            other: Another Interval to measure the gap to.

        Returns:
            Duration between the intervals, or None if overlapping/unbounded.

        Examples:
            >>> from temporale.core.date import Date
            >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 10))
            >>> i2 = Interval(Date(2024, 1, 15), Date(2024, 1, 20))
            >>> i1.gap(i2)
            Duration(days=5, seconds=0, nanoseconds=0)

            >>> # Adjacent intervals have zero gap
            >>> i3 = Interval(Date(2024, 1, 10), Date(2024, 1, 15))
            >>> i1.gap(i3)
            Duration(days=0, seconds=0, nanoseconds=0)

            >>> # Overlapping intervals have no gap
            >>> i4 = Interval(Date(2024, 1, 5), Date(2024, 1, 15))
            >>> i1.gap(i4) is None
            True
        """
        # Empty intervals have no meaningful gap
        if self._is_empty or other._is_empty:
            return None

        # Check if they overlap
        if self.overlaps(other):
            return None

        # Determine which comes first
        # self ends before other starts
        if self._end is not None and other._start is not None and self._end <= other._start:
            return other._start - self._end  # type: ignore[return-value]

        # other ends before self starts
        if other._end is not None and self._start is not None and other._end <= self._start:
            return self._start - other._end  # type: ignore[return-value]

        # Unbounded cases where we can't compute gap
        return None

    def union(self, other: Interval[T]) -> Interval[T] | None:
        """Return the union of overlapping or adjacent intervals.

        If the intervals don't overlap and aren't adjacent, returns None.
        Use gap() to check if there's a gap between intervals.

        Args:
            other: Another Interval to unite with.

        Returns:
            A new Interval covering both, or None if disjoint.

        Examples:
            >>> from temporale.core.date import Date
            >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 15))
            >>> i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 20))
            >>> i1.union(i2)
            Interval(Date(2024, 1, 1), Date(2024, 1, 20))

            >>> # Adjacent intervals can be unified
            >>> i3 = Interval(Date(2024, 1, 15), Date(2024, 1, 25))
            >>> i1.union(i3)
            Interval(Date(2024, 1, 1), Date(2024, 1, 25))

            >>> # Disjoint intervals return None
            >>> i4 = Interval(Date(2024, 1, 20), Date(2024, 1, 25))
            >>> i1.union(i4) is None
            True
        """
        # Empty with non-empty returns the non-empty
        if self._is_empty:
            return other if not other._is_empty else Interval.empty()
        if other._is_empty:
            return self

        # Check for overlap or adjacency
        # They must overlap OR one ends exactly where the other starts
        if not self.overlaps(other):
            # Check for adjacency
            adjacent = False
            if self._end is not None and other._start is not None:
                if self._end == other._start:
                    adjacent = True
            if other._end is not None and self._start is not None:
                if other._end == self._start:
                    adjacent = True
            if not adjacent:
                return None

        # Compute the union bounds
        new_start: T | None
        new_end: T | None

        # Start is the minimum (or None if either is unbounded)
        if self._start is None or other._start is None:
            new_start = None
        else:
            new_start = min(self._start, other._start)

        # End is the maximum (or None if either is unbounded)
        if self._end is None or other._end is None:
            new_end = None
        else:
            new_end = max(self._end, other._end)

        # Create the result
        if new_start is None and new_end is None:
            # Both unbounded - represents all time
            return Interval._create_unbounded(None, None)
        elif new_start is None:
            return Interval.until(new_end)  # type: ignore[arg-type]
        elif new_end is None:
            return Interval.since(new_start)
        else:
            return Interval(new_start, new_end)

    def intersection(self, other: Interval[T]) -> Interval[T] | None:
        """Return the intersection of two intervals.

        If the intervals don't overlap, returns None.

        Args:
            other: Another Interval to intersect with.

        Returns:
            A new Interval covering the overlap, or None if no overlap.

        Examples:
            >>> from temporale.core.date import Date
            >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 20))
            >>> i2 = Interval(Date(2024, 1, 10), Date(2024, 1, 30))
            >>> i1.intersection(i2)
            Interval(Date(2024, 1, 10), Date(2024, 1, 20))

            >>> # Non-overlapping returns None
            >>> i3 = Interval(Date(2024, 2, 1), Date(2024, 2, 10))
            >>> i1.intersection(i3) is None
            True
        """
        # Empty intersected with anything is empty
        if self._is_empty or other._is_empty:
            return None

        # Check for overlap first
        if not self.overlaps(other):
            return None

        # Compute the intersection bounds
        new_start: T | None
        new_end: T | None

        # Start is the maximum (later start)
        if self._start is None:
            new_start = other._start
        elif other._start is None:
            new_start = self._start
        else:
            new_start = max(self._start, other._start)

        # End is the minimum (earlier end)
        if self._end is None:
            new_end = other._end
        elif other._end is None:
            new_end = self._end
        else:
            new_end = min(self._end, other._end)

        # Create the result
        if new_start is None and new_end is None:
            # Both unbounded - represents all time
            return Interval._create_unbounded(None, None)
        elif new_start is None:
            return Interval.until(new_end)  # type: ignore[arg-type]
        elif new_end is None:
            return Interval.since(new_start)
        else:
            return Interval(new_start, new_end)

    def __eq__(self, other: object) -> bool:
        """Check equality with another interval.

        Two intervals are equal if they have the same bounds and empty status.

        Args:
            other: Object to compare with.

        Returns:
            True if other is an equal Interval.

        Examples:
            >>> from temporale.core.date import Date
            >>> i1 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
            >>> i2 = Interval(Date(2024, 1, 1), Date(2024, 1, 31))
            >>> i1 == i2
            True

            >>> Interval.empty() == Interval.empty()
            True
        """
        if not isinstance(other, Interval):
            return NotImplemented

        # Check empty status first
        if self._is_empty != other._is_empty:
            return False
        if self._is_empty and other._is_empty:
            return True

        return self._start == other._start and self._end == other._end

    def __ne__(self, other: object) -> bool:
        """Check inequality with another interval."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __hash__(self) -> int:
        """Return a hash for this interval.

        Returns:
            Hash based on bounds and empty status.
        """
        if self._is_empty:
            return hash(("empty",))
        return hash((self._start, self._end))

    def __repr__(self) -> str:
        """Return a detailed string representation.

        Returns:
            String showing the interval bounds.

        Examples:
            >>> from temporale.core.date import Date
            >>> repr(Interval(Date(2024, 1, 1), Date(2024, 1, 31)))
            'Interval(Date(2024, 1, 1), Date(2024, 1, 31))'

            >>> repr(Interval.since(Date(2024, 1, 1)))
            'Interval.since(Date(2024, 1, 1))'

            >>> repr(Interval.empty())
            'Interval.empty()'
        """
        if self._is_empty:
            return "Interval.empty()"
        elif self._start is None and self._end is not None:
            return f"Interval.until({self._end!r})"
        elif self._start is not None and self._end is None:
            return f"Interval.since({self._start!r})"
        else:
            return f"Interval({self._start!r}, {self._end!r})"

    def __str__(self) -> str:
        """Return a human-readable string representation.

        Uses mathematical interval notation.

        Returns:
            String like '[2024-01-01, 2024-01-31)'.

        Examples:
            >>> from temporale.core.date import Date
            >>> str(Interval(Date(2024, 1, 1), Date(2024, 1, 31)))
            '[2024-01-01, 2024-01-31)'

            >>> str(Interval.since(Date(2024, 1, 1)))
            '[2024-01-01, ∞)'

            >>> str(Interval.until(Date(2024, 1, 1)))
            '(-∞, 2024-01-01)'

            >>> str(Interval.empty())
            '∅'
        """
        if self._is_empty:
            return "∅"
        elif self._start is None and self._end is not None:
            return f"(-∞, {self._end})"
        elif self._start is not None and self._end is None:
            return f"[{self._start}, ∞)"
        else:
            return f"[{self._start}, {self._end})"

    def __bool__(self) -> bool:
        """Return True if this interval is non-empty."""
        return not self._is_empty


__all__ = ["Interval"]
