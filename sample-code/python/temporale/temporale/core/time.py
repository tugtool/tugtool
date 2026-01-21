"""Time class representing a time of day.

This module provides the Time class for representing time-of-day values
with nanosecond precision.
"""

from __future__ import annotations

import datetime as _datetime
import re
from typing import Self

from temporale._internal.constants import (
    NANOS_PER_DAY,
    NANOS_PER_HOUR,
    NANOS_PER_MICROSECOND,
    NANOS_PER_MILLISECOND,
    NANOS_PER_MINUTE,
    NANOS_PER_SECOND,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
)
from temporale.errors import ParseError, ValidationError


class Time:
    """A time of day with nanosecond precision.

    Time represents the time portion of a day, from midnight (00:00:00)
    to just before the next midnight (23:59:59.999999999). It does not
    include any date or timezone information.

    The internal representation stores the total nanoseconds since
    midnight in a single `_nanos` slot for efficiency and precision.

    Attributes:
        hour: The hour component (0-23).
        minute: The minute component (0-59).
        second: The second component (0-59).
        millisecond: The millisecond component (0-999).
        microsecond: The microsecond component (0-999999).
        nanosecond: The nanosecond component (0-999999999).

    Examples:
        >>> t = Time(14, 30, 45)
        >>> t.hour
        14
        >>> t.minute
        30
        >>> t.second
        45

        >>> t = Time(12, 0, 0, nanosecond=123_456_789)
        >>> t.millisecond
        123
        >>> t.microsecond
        123456
        >>> t.nanosecond
        123456789
    """

    __slots__ = ("_nanos",)

    def __init__(
        self,
        hour: int = 0,
        minute: int = 0,
        second: int = 0,
        *,
        millisecond: int = 0,
        microsecond: int = 0,
        nanosecond: int = 0,
    ) -> None:
        """Create a Time from component parts.

        Args:
            hour: The hour (0-23).
            minute: The minute (0-59).
            second: The second (0-59).
            millisecond: The millisecond (0-999). Added to nanosecond.
            microsecond: The microsecond (0-999). Added to nanosecond.
            nanosecond: The nanosecond (0-999999999).

        Raises:
            ValidationError: If any component is out of range.

        Notes:
            The subsecond components (millisecond, microsecond, nanosecond)
            are additive. For example, Time(12, 0, 0, millisecond=1, microsecond=1)
            represents 12:00:00.001001.

        Examples:
            >>> Time(14, 30, 45)
            Time(14, 30, 45, nanosecond=0)

            >>> Time(12, 0, 0, nanosecond=500_000_000)
            Time(12, 0, 0, nanosecond=500000000)

            >>> Time(12, 0, 0, millisecond=500)
            Time(12, 0, 0, nanosecond=500000000)
        """
        # Validate ranges
        if not (0 <= hour <= 23):
            raise ValidationError(f"hour must be between 0 and 23, got {hour}")
        if not (0 <= minute <= 59):
            raise ValidationError(f"minute must be between 0 and 59, got {minute}")
        if not (0 <= second <= 59):
            raise ValidationError(f"second must be between 0 and 59, got {second}")
        if not (0 <= millisecond <= 999):
            raise ValidationError(
                f"millisecond must be between 0 and 999, got {millisecond}"
            )
        if not (0 <= microsecond <= 999_999):
            raise ValidationError(
                f"microsecond must be between 0 and 999999, got {microsecond}"
            )
        if not (0 <= nanosecond <= 999_999_999):
            raise ValidationError(
                f"nanosecond must be between 0 and 999999999, got {nanosecond}"
            )

        # Convert to total nanoseconds since midnight
        total_nanos = (
            hour * NANOS_PER_HOUR
            + minute * NANOS_PER_MINUTE
            + second * NANOS_PER_SECOND
            + millisecond * NANOS_PER_MILLISECOND
            + microsecond * NANOS_PER_MICROSECOND
            + nanosecond
        )

        # Validate total is within day bounds
        if total_nanos >= NANOS_PER_DAY:
            raise ValidationError(
                f"time exceeds day bounds: total nanoseconds {total_nanos} >= {NANOS_PER_DAY}"
            )

        self._nanos: int = total_nanos

    @classmethod
    def _from_nanos(cls, nanos: int) -> Time:
        """Create a Time from nanoseconds since midnight.

        This is an internal factory method that bypasses validation
        for use when the value is known to be valid.

        Args:
            nanos: Nanoseconds since midnight [0, NANOS_PER_DAY).

        Returns:
            A new Time instance.
        """
        instance = object.__new__(cls)
        instance._nanos = nanos
        return instance

    @classmethod
    def now(cls) -> Time:
        """Return the current local time.

        Returns:
            A Time representing the current local time of day.

        Examples:
            >>> t = Time.now()  # Gets current local time
            >>> 0 <= t.hour <= 23
            True
        """
        now = _datetime.datetime.now()
        return cls(
            hour=now.hour,
            minute=now.minute,
            second=now.second,
            microsecond=now.microsecond,
        )

    @classmethod
    def midnight(cls) -> Time:
        """Return a Time representing midnight (00:00:00).

        Returns:
            A Time at exactly midnight.

        Examples:
            >>> Time.midnight()
            Time(0, 0, 0, nanosecond=0)
        """
        return cls._from_nanos(0)

    @classmethod
    def noon(cls) -> Time:
        """Return a Time representing noon (12:00:00).

        Returns:
            A Time at exactly noon.

        Examples:
            >>> Time.noon()
            Time(12, 0, 0, nanosecond=0)
        """
        return cls._from_nanos(12 * NANOS_PER_HOUR)

    @classmethod
    def from_iso_format(cls, s: str) -> Time:
        """Parse a time from ISO 8601 format.

        Supports formats:
        - HH:MM:SS
        - HH:MM:SS.f (1-9 decimal places)
        - HH:MM
        - HHMMSS (compact)
        - HHMMSS.f (compact with fraction)

        Args:
            s: The ISO 8601 time string to parse.

        Returns:
            A Time parsed from the string.

        Raises:
            ParseError: If the string is not valid ISO 8601 format.
            ValidationError: If the time components are invalid.

        Examples:
            >>> Time.from_iso_format("14:30:45")
            Time(14, 30, 45, nanosecond=0)

            >>> Time.from_iso_format("14:30:45.123456789")
            Time(14, 30, 45, nanosecond=123456789)

            >>> Time.from_iso_format("14:30")
            Time(14, 30, 0, nanosecond=0)

            >>> Time.from_iso_format("143045")
            Time(14, 30, 45, nanosecond=0)
        """
        s = s.strip()
        if not s:
            raise ParseError("empty time string")

        # Try extended format first: HH:MM:SS or HH:MM:SS.f or HH:MM
        extended_pattern = re.compile(
            r"^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$"
        )
        match = extended_pattern.match(s)
        if match:
            hour_str, minute_str, second_str, frac_str = match.groups()
            hour = int(hour_str)
            minute = int(minute_str)
            second = int(second_str) if second_str else 0
            nanosecond = _parse_fractional_seconds(frac_str) if frac_str else 0
            return cls(hour=hour, minute=minute, second=second, nanosecond=nanosecond)

        # Try compact format: HHMMSS or HHMMSS.f
        compact_pattern = re.compile(r"^(\d{2})(\d{2})(\d{2})(?:\.(\d{1,9}))?$")
        match = compact_pattern.match(s)
        if match:
            hour_str, minute_str, second_str, frac_str = match.groups()
            hour = int(hour_str)
            minute = int(minute_str)
            second = int(second_str)
            nanosecond = _parse_fractional_seconds(frac_str) if frac_str else 0
            return cls(hour=hour, minute=minute, second=second, nanosecond=nanosecond)

        raise ParseError(f"invalid ISO 8601 time format: {s!r}")

    @property
    def hour(self) -> int:
        """Return the hour component (0-23).

        Returns:
            The hour of the day.
        """
        return self._nanos // NANOS_PER_HOUR

    @property
    def minute(self) -> int:
        """Return the minute component (0-59).

        Returns:
            The minute within the hour.
        """
        return (self._nanos % NANOS_PER_HOUR) // NANOS_PER_MINUTE

    @property
    def second(self) -> int:
        """Return the second component (0-59).

        Returns:
            The second within the minute.
        """
        return (self._nanos % NANOS_PER_MINUTE) // NANOS_PER_SECOND

    @property
    def millisecond(self) -> int:
        """Return the millisecond component (0-999).

        This is the milliseconds within the current second, not the
        total milliseconds since midnight.

        Returns:
            Milliseconds within the second.

        Examples:
            >>> Time(12, 30, 45, nanosecond=123_456_789).millisecond
            123
        """
        return (self._nanos % NANOS_PER_SECOND) // NANOS_PER_MILLISECOND

    @property
    def microsecond(self) -> int:
        """Return the microsecond component (0-999999).

        This is the microseconds within the current second, not the
        total microseconds since midnight.

        Returns:
            Microseconds within the second.

        Examples:
            >>> Time(12, 30, 45, nanosecond=123_456_789).microsecond
            123456
        """
        return (self._nanos % NANOS_PER_SECOND) // NANOS_PER_MICROSECOND

    @property
    def nanosecond(self) -> int:
        """Return the nanosecond component (0-999999999).

        This is the nanoseconds within the current second, not the
        total nanoseconds since midnight.

        Returns:
            Nanoseconds within the second.

        Examples:
            >>> Time(12, 30, 45, nanosecond=123_456_789).nanosecond
            123456789
        """
        return self._nanos % NANOS_PER_SECOND

    @property
    def total_nanoseconds(self) -> int:
        """Return the total nanoseconds since midnight.

        Returns:
            Nanoseconds since midnight [0, NANOS_PER_DAY).

        Examples:
            >>> Time(0, 0, 1).total_nanoseconds
            1000000000
        """
        return self._nanos

    def replace(
        self,
        hour: int | None = None,
        minute: int | None = None,
        second: int | None = None,
        *,
        millisecond: int | None = None,
        microsecond: int | None = None,
        nanosecond: int | None = None,
    ) -> Time:
        """Return a new Time with specified components replaced.

        Any component not specified retains its current value.

        Args:
            hour: New hour value (0-23).
            minute: New minute value (0-59).
            second: New second value (0-59).
            millisecond: New millisecond value (0-999). Replaces subsecond.
            microsecond: New microsecond value (0-999). Replaces subsecond.
            nanosecond: New nanosecond value (0-999999999). Replaces subsecond.

        Returns:
            A new Time with the specified components replaced.

        Raises:
            ValidationError: If any component is out of range.

        Notes:
            The subsecond parameters (millisecond, microsecond, nanosecond)
            are mutually exclusive for replacement purposes. Only specify one
            to replace the subsecond component.

        Examples:
            >>> t = Time(14, 30, 45)
            >>> t.replace(hour=10)
            Time(10, 30, 45, nanosecond=0)

            >>> t.replace(minute=0, second=0)
            Time(14, 0, 0, nanosecond=0)
        """
        new_hour = hour if hour is not None else self.hour
        new_minute = minute if minute is not None else self.minute
        new_second = second if second is not None else self.second

        # For subsecond, use specified value or current nanosecond
        if nanosecond is not None:
            new_nanosecond = nanosecond
        elif microsecond is not None:
            new_nanosecond = microsecond * NANOS_PER_MICROSECOND
        elif millisecond is not None:
            new_nanosecond = millisecond * NANOS_PER_MILLISECOND
        else:
            new_nanosecond = self.nanosecond

        return Time(
            hour=new_hour,
            minute=new_minute,
            second=new_second,
            nanosecond=new_nanosecond,
        )

    def with_nanosecond(self, nanosecond: int) -> Time:
        """Return a new Time with the nanosecond component replaced.

        This is a convenience method equivalent to replace(nanosecond=n).

        Args:
            nanosecond: New nanosecond value (0-999999999).

        Returns:
            A new Time with the nanosecond component replaced.

        Raises:
            ValidationError: If nanosecond is out of range.

        Examples:
            >>> Time(12, 30, 45).with_nanosecond(123_456_789)
            Time(12, 30, 45, nanosecond=123456789)
        """
        return self.replace(nanosecond=nanosecond)

    def with_millisecond(self, millisecond: int) -> Time:
        """Return a new Time with the millisecond component set.

        This sets the subsecond part to the specified milliseconds,
        clearing any microsecond or nanosecond precision.

        Args:
            millisecond: New millisecond value (0-999).

        Returns:
            A new Time with the subsecond set to the specified milliseconds.

        Raises:
            ValidationError: If millisecond is out of range.

        Examples:
            >>> Time(12, 30, 45).with_millisecond(500)
            Time(12, 30, 45, nanosecond=500000000)
        """
        if not (0 <= millisecond <= 999):
            raise ValidationError(
                f"millisecond must be between 0 and 999, got {millisecond}"
            )
        return self.replace(nanosecond=millisecond * NANOS_PER_MILLISECOND)

    def with_microsecond(self, microsecond: int) -> Time:
        """Return a new Time with the microsecond component set.

        This sets the subsecond part to the specified microseconds,
        clearing any nanosecond precision.

        Args:
            microsecond: New microsecond value (0-999999).

        Returns:
            A new Time with the subsecond set to the specified microseconds.

        Raises:
            ValidationError: If microsecond is out of range.

        Examples:
            >>> Time(12, 30, 45).with_microsecond(500_000)
            Time(12, 30, 45, nanosecond=500000000)
        """
        if not (0 <= microsecond <= 999_999):
            raise ValidationError(
                f"microsecond must be between 0 and 999999, got {microsecond}"
            )
        return self.replace(nanosecond=microsecond * NANOS_PER_MICROSECOND)

    def to_iso_format(self, *, precision: str = "auto") -> str:
        """Return the time as an ISO 8601 string.

        Args:
            precision: Subsecond precision to include:
                - "auto": Include subseconds only if non-zero, minimal digits
                - "seconds": No subseconds (HH:MM:SS)
                - "millis": Always 3 decimal places
                - "micros": Always 6 decimal places
                - "nanos": Always 9 decimal places

        Returns:
            ISO 8601 formatted time string.

        Examples:
            >>> Time(14, 30, 45).to_iso_format()
            '14:30:45'

            >>> Time(14, 30, 45, nanosecond=123_000_000).to_iso_format()
            '14:30:45.123'

            >>> Time(14, 30, 45, nanosecond=123_456_789).to_iso_format()
            '14:30:45.123456789'

            >>> Time(14, 30, 45).to_iso_format(precision="millis")
            '14:30:45.000'
        """
        base = f"{self.hour:02d}:{self.minute:02d}:{self.second:02d}"

        if precision == "seconds":
            return base
        elif precision == "millis":
            return f"{base}.{self.nanosecond // 1_000_000:03d}"
        elif precision == "micros":
            return f"{base}.{self.nanosecond // 1_000:06d}"
        elif precision == "nanos":
            return f"{base}.{self.nanosecond:09d}"
        else:  # auto
            if self.nanosecond == 0:
                return base
            # Find minimal representation
            frac = f"{self.nanosecond:09d}".rstrip("0")
            return f"{base}.{frac}"

    def __eq__(self, other: object) -> bool:
        """Check equality with another Time.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a Time with the same value.

        Examples:
            >>> Time(12, 0, 0) == Time(12, 0, 0)
            True
            >>> Time(12, 0, 0) == Time(12, 0, 1)
            False
        """
        if not isinstance(other, Time):
            return NotImplemented
        return self._nanos == other._nanos

    def __ne__(self, other: object) -> bool:
        """Check inequality with another Time."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __lt__(self, other: object) -> bool:
        """Check if this Time is earlier than another.

        Args:
            other: Another Time to compare with.

        Returns:
            True if this time is earlier (closer to midnight).

        Raises:
            TypeError: If other is not a Time.

        Examples:
            >>> Time(10, 0, 0) < Time(12, 0, 0)
            True
            >>> Time(12, 0, 0) < Time(10, 0, 0)
            False
        """
        if not isinstance(other, Time):
            return NotImplemented
        return self._nanos < other._nanos

    def __le__(self, other: object) -> bool:
        """Check if this Time is earlier than or equal to another."""
        if not isinstance(other, Time):
            return NotImplemented
        return self._nanos <= other._nanos

    def __gt__(self, other: object) -> bool:
        """Check if this Time is later than another."""
        if not isinstance(other, Time):
            return NotImplemented
        return self._nanos > other._nanos

    def __ge__(self, other: object) -> bool:
        """Check if this Time is later than or equal to another."""
        if not isinstance(other, Time):
            return NotImplemented
        return self._nanos >= other._nanos

    def __hash__(self) -> int:
        """Return a hash for this Time.

        Returns:
            Hash based on nanoseconds since midnight.
        """
        return hash(self._nanos)

    def __repr__(self) -> str:
        """Return a detailed string representation.

        Returns:
            String showing all component values.
        """
        return f"Time({self.hour}, {self.minute}, {self.second}, nanosecond={self.nanosecond})"

    def __str__(self) -> str:
        """Return a human-readable string representation.

        Returns:
            ISO 8601 formatted time string.
        """
        return self.to_iso_format()

    def __bool__(self) -> bool:
        """Times are always truthy.

        Returns:
            Always True (even midnight is truthy).
        """
        return True


def _parse_fractional_seconds(frac_str: str) -> int:
    """Parse fractional seconds string to nanoseconds.

    Args:
        frac_str: Fractional seconds string (1-9 digits).

    Returns:
        Nanoseconds value.

    Examples:
        >>> _parse_fractional_seconds("1")
        100000000
        >>> _parse_fractional_seconds("123")
        123000000
        >>> _parse_fractional_seconds("123456789")
        123456789
    """
    # Pad or truncate to 9 digits
    if len(frac_str) < 9:
        frac_str = frac_str.ljust(9, "0")
    else:
        frac_str = frac_str[:9]
    return int(frac_str)


__all__ = ["Time"]
