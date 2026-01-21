"""Duration class representing a span of time.

This module provides the Duration class for representing time spans
with nanosecond precision.
"""

from __future__ import annotations

from temporale._internal.constants import (
    NANOS_PER_SECOND,
    NANOS_PER_MILLISECOND,
    NANOS_PER_MICROSECOND,
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
)


class Duration:
    """A span of time with nanosecond precision.

    Duration represents a length of time, which can be positive, negative,
    or zero. It stores time as a combination of days, seconds within the day,
    and nanoseconds within the second.

    The internal representation is normalized such that:
    - `_seconds` is always in the range [0, 86400)
    - `_nanos` is always in the range [0, 1_000_000_000)
    - `_days` can be negative to represent negative durations

    Attributes:
        days: The days component (can be negative).
        seconds: The seconds component within the current day [0, 86400).
        nanoseconds: The nanoseconds component within the current second [0, 1e9).

    Examples:
        >>> d = Duration(days=1, seconds=3600)
        >>> d.days
        1
        >>> d.seconds
        3600

        >>> d = Duration.from_hours(25)
        >>> d.days
        1
        >>> d.seconds
        3600

        >>> d1 = Duration(seconds=30)
        >>> d2 = Duration(seconds=45)
        >>> (d1 + d2).seconds
        75
    """

    __slots__ = ("_days", "_seconds", "_nanos")

    def __init__(
        self,
        days: int = 0,
        seconds: int = 0,
        milliseconds: int = 0,
        microseconds: int = 0,
        nanoseconds: int = 0,
    ) -> None:
        """Create a Duration from component parts.

        All parameters can be positive, negative, or zero. The resulting
        duration is normalized to canonical form.

        Args:
            days: Number of days.
            seconds: Number of seconds.
            milliseconds: Number of milliseconds.
            microseconds: Number of microseconds.
            nanoseconds: Number of nanoseconds.

        Examples:
            >>> Duration(days=1)
            Duration(days=1, seconds=0, nanoseconds=0)

            >>> Duration(seconds=90000)  # 1 day + 3600 seconds
            Duration(days=1, seconds=3600, nanoseconds=0)

            >>> Duration(milliseconds=1500)  # 1.5 seconds
            Duration(days=0, seconds=1, nanoseconds=500000000)
        """
        # Convert all to base units and accumulate
        total_nanos = nanoseconds
        total_nanos += microseconds * NANOS_PER_MICROSECOND
        total_nanos += milliseconds * NANOS_PER_MILLISECOND
        total_nanos += seconds * NANOS_PER_SECOND

        # Store raw values then normalize
        self._days = days
        self._seconds = 0
        self._nanos = total_nanos
        self._normalize()

    def _normalize(self) -> None:
        """Normalize the duration to canonical form.

        After normalization:
        - 0 <= _seconds < 86400
        - 0 <= _nanos < 1_000_000_000
        - _days holds the sign for negative durations
        """
        # First, convert everything to total nanoseconds to handle all cases uniformly
        total_nanos = (
            self._days * SECONDS_PER_DAY * NANOS_PER_SECOND
            + self._seconds * NANOS_PER_SECOND
            + self._nanos
        )

        if total_nanos >= 0:
            # Positive or zero duration
            nanos_per_day = SECONDS_PER_DAY * NANOS_PER_SECOND
            self._days = total_nanos // nanos_per_day
            remainder = total_nanos % nanos_per_day
            self._seconds = remainder // NANOS_PER_SECOND
            self._nanos = remainder % NANOS_PER_SECOND
        else:
            # Negative duration: use borrowing to keep _seconds and _nanos positive
            total_nanos = -total_nanos
            nanos_per_day = SECONDS_PER_DAY * NANOS_PER_SECOND

            # Calculate how many full days in the absolute value
            full_days = total_nanos // nanos_per_day
            remainder = total_nanos % nanos_per_day

            if remainder == 0:
                # Exact number of negative days
                self._days = -full_days
                self._seconds = 0
                self._nanos = 0
            else:
                # Need to borrow: -1 day and (1 day - remainder) for the positive part
                self._days = -(full_days + 1)
                positive_nanos = nanos_per_day - remainder
                self._seconds = positive_nanos // NANOS_PER_SECOND
                self._nanos = positive_nanos % NANOS_PER_SECOND

    @classmethod
    def zero(cls) -> Duration:
        """Create a zero-length duration.

        Returns:
            A Duration with all components set to zero.

        Examples:
            >>> Duration.zero()
            Duration(days=0, seconds=0, nanoseconds=0)
        """
        return cls()

    @classmethod
    def from_days(cls, days: int) -> Duration:
        """Create a Duration from a number of days.

        Args:
            days: Number of days (can be negative).

        Returns:
            A Duration representing the specified number of days.

        Examples:
            >>> Duration.from_days(7)
            Duration(days=7, seconds=0, nanoseconds=0)
        """
        return cls(days=days)

    @classmethod
    def from_hours(cls, hours: int) -> Duration:
        """Create a Duration from a number of hours.

        Args:
            hours: Number of hours (can be negative).

        Returns:
            A Duration representing the specified number of hours.

        Examples:
            >>> Duration.from_hours(25)
            Duration(days=1, seconds=3600, nanoseconds=0)
        """
        return cls(seconds=hours * SECONDS_PER_HOUR)

    @classmethod
    def from_minutes(cls, minutes: int) -> Duration:
        """Create a Duration from a number of minutes.

        Args:
            minutes: Number of minutes (can be negative).

        Returns:
            A Duration representing the specified number of minutes.

        Examples:
            >>> Duration.from_minutes(90)
            Duration(days=0, seconds=5400, nanoseconds=0)
        """
        return cls(seconds=minutes * SECONDS_PER_MINUTE)

    @classmethod
    def from_seconds(cls, seconds: int) -> Duration:
        """Create a Duration from a number of seconds.

        Args:
            seconds: Number of seconds (can be negative).

        Returns:
            A Duration representing the specified number of seconds.

        Examples:
            >>> Duration.from_seconds(3661)
            Duration(days=0, seconds=3661, nanoseconds=0)
        """
        return cls(seconds=seconds)

    @classmethod
    def from_milliseconds(cls, milliseconds: int) -> Duration:
        """Create a Duration from a number of milliseconds.

        Args:
            milliseconds: Number of milliseconds (can be negative).

        Returns:
            A Duration representing the specified number of milliseconds.

        Examples:
            >>> Duration.from_milliseconds(1500)
            Duration(days=0, seconds=1, nanoseconds=500000000)
        """
        return cls(milliseconds=milliseconds)

    @classmethod
    def from_microseconds(cls, microseconds: int) -> Duration:
        """Create a Duration from a number of microseconds.

        Args:
            microseconds: Number of microseconds (can be negative).

        Returns:
            A Duration representing the specified number of microseconds.

        Examples:
            >>> Duration.from_microseconds(1500000)
            Duration(days=0, seconds=1, nanoseconds=500000000)
        """
        return cls(microseconds=microseconds)

    @classmethod
    def from_nanoseconds(cls, nanoseconds: int) -> Duration:
        """Create a Duration from a number of nanoseconds.

        Args:
            nanoseconds: Number of nanoseconds (can be negative).

        Returns:
            A Duration representing the specified number of nanoseconds.

        Examples:
            >>> Duration.from_nanoseconds(1_500_000_000)
            Duration(days=0, seconds=1, nanoseconds=500000000)
        """
        return cls(nanoseconds=nanoseconds)

    @property
    def days(self) -> int:
        """Return the days component.

        This is the whole days portion of the duration. For negative
        durations, this value is negative.

        Returns:
            Number of days (can be negative).
        """
        return self._days

    @property
    def seconds(self) -> int:
        """Return the seconds component within the current day.

        This is always in the range [0, 86400), even for negative durations.

        Returns:
            Seconds within the day [0, 86400).
        """
        return self._seconds

    @property
    def nanoseconds(self) -> int:
        """Return the nanoseconds component within the current second.

        This is always in the range [0, 1_000_000_000), even for negative
        durations.

        Returns:
            Nanoseconds within the second [0, 1e9).
        """
        return self._nanos

    @property
    def total_seconds(self) -> float:
        """Return the total duration as seconds (approximate).

        Note: This conversion may lose precision for very large or very
        precise durations due to floating-point representation limits.
        For exact calculations, use total_nanoseconds().

        Returns:
            Total duration in seconds as a float.

        Examples:
            >>> Duration(days=1, seconds=3600).total_seconds
            90000.0
        """
        return (
            self._days * SECONDS_PER_DAY
            + self._seconds
            + self._nanos / NANOS_PER_SECOND
        )

    @property
    def total_nanoseconds(self) -> int:
        """Return the total duration in nanoseconds (exact).

        Returns:
            Total duration in nanoseconds as an integer.

        Examples:
            >>> Duration(seconds=1, nanoseconds=500).total_nanoseconds
            1000000500
        """
        return (
            self._days * SECONDS_PER_DAY * NANOS_PER_SECOND
            + self._seconds * NANOS_PER_SECOND
            + self._nanos
        )

    @property
    def is_negative(self) -> bool:
        """Return True if this is a negative duration.

        A duration is negative if its total time span is less than zero.

        Returns:
            True if the duration is negative, False otherwise.

        Examples:
            >>> Duration(days=-1).is_negative
            True
            >>> Duration(days=1).is_negative
            False
            >>> Duration.zero().is_negative
            False
        """
        return self.total_nanoseconds < 0

    @property
    def is_zero(self) -> bool:
        """Return True if this is a zero-length duration.

        Returns:
            True if all components are zero.

        Examples:
            >>> Duration.zero().is_zero
            True
            >>> Duration(nanoseconds=1).is_zero
            False
        """
        return self._days == 0 and self._seconds == 0 and self._nanos == 0

    def __add__(self, other: object) -> Duration:
        """Add two durations.

        Args:
            other: Another Duration to add.

        Returns:
            A new Duration representing the sum.

        Raises:
            TypeError: If other is not a Duration.

        Examples:
            >>> Duration(seconds=30) + Duration(seconds=45)
            Duration(days=0, seconds=75, nanoseconds=0)
        """
        if not isinstance(other, Duration):
            return NotImplemented
        return Duration(
            days=self._days + other._days,
            seconds=self._seconds + other._seconds,
            nanoseconds=self._nanos + other._nanos,
        )

    def __radd__(self, other: object) -> Duration:
        """Support sum() by handling 0 + Duration."""
        if other == 0:
            return self
        return NotImplemented

    def __sub__(self, other: object) -> Duration:
        """Subtract one duration from another.

        Args:
            other: Another Duration to subtract.

        Returns:
            A new Duration representing the difference.

        Raises:
            TypeError: If other is not a Duration.

        Examples:
            >>> Duration(seconds=60) - Duration(seconds=30)
            Duration(days=0, seconds=30, nanoseconds=0)
        """
        if not isinstance(other, Duration):
            return NotImplemented
        return Duration(
            days=self._days - other._days,
            seconds=self._seconds - other._seconds,
            nanoseconds=self._nanos - other._nanos,
        )

    def __mul__(self, other: object) -> Duration:
        """Multiply a duration by a scalar.

        Args:
            other: An integer multiplier.

        Returns:
            A new Duration scaled by the multiplier.

        Raises:
            TypeError: If other is not an integer.

        Examples:
            >>> Duration(seconds=30) * 3
            Duration(days=0, seconds=90, nanoseconds=0)
        """
        if not isinstance(other, int):
            return NotImplemented
        total_nanos = self.total_nanoseconds * other
        return Duration(nanoseconds=total_nanos)

    def __rmul__(self, other: object) -> Duration:
        """Support scalar * Duration."""
        return self.__mul__(other)

    def __truediv__(self, other: object) -> Duration:
        """Divide a duration by a scalar (true division).

        This performs floating-point division and may lose precision.
        For integer division, use // operator.

        Args:
            other: An integer or float divisor.

        Returns:
            A new Duration representing the quotient.

        Raises:
            TypeError: If other is not a number.
            ZeroDivisionError: If other is zero.

        Examples:
            >>> Duration(seconds=90) / 3
            Duration(days=0, seconds=30, nanoseconds=0)
        """
        if not isinstance(other, (int, float)):
            return NotImplemented
        if other == 0:
            raise ZeroDivisionError("division by zero")
        total_nanos = int(self.total_nanoseconds / other)
        return Duration(nanoseconds=total_nanos)

    def __floordiv__(self, other: object) -> Duration:
        """Divide a duration by a scalar (floor division).

        Args:
            other: An integer divisor.

        Returns:
            A new Duration representing the floor quotient.

        Raises:
            TypeError: If other is not an integer.
            ZeroDivisionError: If other is zero.

        Examples:
            >>> Duration(seconds=100) // 3
            Duration(days=0, seconds=33, nanoseconds=333333333)
        """
        if not isinstance(other, int):
            return NotImplemented
        if other == 0:
            raise ZeroDivisionError("integer division or modulo by zero")
        total_nanos = self.total_nanoseconds // other
        return Duration(nanoseconds=total_nanos)

    def __neg__(self) -> Duration:
        """Return the negation of this duration.

        Returns:
            A new Duration with opposite sign.

        Examples:
            >>> -Duration(seconds=30)
            Duration(days=-1, seconds=86370, nanoseconds=0)
        """
        return Duration(nanoseconds=-self.total_nanoseconds)

    def __pos__(self) -> Duration:
        """Return a copy of this duration (unary +).

        Returns:
            A new Duration with the same value.
        """
        return Duration(
            days=self._days,
            seconds=self._seconds,
            nanoseconds=self._nanos,
        )

    def __abs__(self) -> Duration:
        """Return the absolute value of this duration.

        Returns:
            A new Duration with the same magnitude but positive.

        Examples:
            >>> abs(Duration(days=-1))
            Duration(days=1, seconds=0, nanoseconds=0)
        """
        if self.is_negative:
            return -self
        return +self

    def __eq__(self, other: object) -> bool:
        """Check equality with another duration.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a Duration with the same value.

        Examples:
            >>> Duration(seconds=60) == Duration(minutes=1)
            True
        """
        if not isinstance(other, Duration):
            return NotImplemented
        return self.total_nanoseconds == other.total_nanoseconds

    def __ne__(self, other: object) -> bool:
        """Check inequality with another duration."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __lt__(self, other: object) -> bool:
        """Check if this duration is less than another.

        Args:
            other: Another Duration to compare with.

        Returns:
            True if this duration is shorter than other.

        Raises:
            TypeError: If other is not a Duration.

        Examples:
            >>> Duration(seconds=30) < Duration(seconds=60)
            True
        """
        if not isinstance(other, Duration):
            return NotImplemented
        return self.total_nanoseconds < other.total_nanoseconds

    def __le__(self, other: object) -> bool:
        """Check if this duration is less than or equal to another."""
        if not isinstance(other, Duration):
            return NotImplemented
        return self.total_nanoseconds <= other.total_nanoseconds

    def __gt__(self, other: object) -> bool:
        """Check if this duration is greater than another."""
        if not isinstance(other, Duration):
            return NotImplemented
        return self.total_nanoseconds > other.total_nanoseconds

    def __ge__(self, other: object) -> bool:
        """Check if this duration is greater than or equal to another."""
        if not isinstance(other, Duration):
            return NotImplemented
        return self.total_nanoseconds >= other.total_nanoseconds

    def __hash__(self) -> int:
        """Return a hash for this duration.

        Returns:
            Hash based on total nanoseconds.
        """
        return hash(self.total_nanoseconds)

    def __repr__(self) -> str:
        """Return a detailed string representation.

        Returns:
            String showing all component values.
        """
        return f"Duration(days={self._days}, seconds={self._seconds}, nanoseconds={self._nanos})"

    def __str__(self) -> str:
        """Return a human-readable string representation.

        Returns:
            String like "1 day, 2:30:45" or "-1 day, 23:59:59".
        """
        if self.is_zero:
            return "0:00:00"

        hours = self._seconds // SECONDS_PER_HOUR
        minutes = (self._seconds % SECONDS_PER_HOUR) // SECONDS_PER_MINUTE
        secs = self._seconds % SECONDS_PER_MINUTE

        time_str = f"{hours}:{minutes:02d}:{secs:02d}"
        if self._nanos > 0:
            # Show nanoseconds as decimal fraction
            time_str += f".{self._nanos:09d}".rstrip("0")

        if self._days == 0:
            return time_str
        elif self._days == 1:
            return f"1 day, {time_str}"
        elif self._days == -1:
            return f"-1 day, {time_str}"
        else:
            return f"{self._days} days, {time_str}"

    def __bool__(self) -> bool:
        """Return True if this is a non-zero duration."""
        return not self.is_zero


__all__ = ["Duration"]
