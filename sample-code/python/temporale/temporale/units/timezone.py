"""Timezone representation using UTC offset model.

This module provides the Timezone class for representing timezones
as fixed UTC offsets, without IANA timezone database support.
"""

from __future__ import annotations

import re
from typing import ClassVar

from temporale.errors import TimezoneError


class Timezone:
    """A timezone represented as a UTC offset.

    Timezone uses a simplified UTC offset model rather than IANA timezone
    names. This is sufficient for most use cases and avoids external
    dependencies.

    The offset is stored in seconds from UTC, with positive values being
    east of UTC (ahead in time) and negative values being west of UTC
    (behind in time).

    Attributes:
        offset_seconds: The UTC offset in seconds.
        name: Optional human-readable name for the timezone.

    Examples:
        >>> tz = Timezone.utc()
        >>> tz.is_utc
        True

        >>> tz = Timezone.from_hours(5, 30)
        >>> tz.offset_hours
        5.5

        >>> tz = Timezone.from_string("+05:30")
        >>> tz.offset_seconds
        19800
    """

    __slots__ = ("_offset_seconds", "_name")

    # UTC singleton instance (lazily initialized)
    _utc_instance: ClassVar[Timezone | None] = None

    # Maximum offset is +/- 14 hours (some timezones like Pacific/Kiritimati are UTC+14)
    _MAX_OFFSET_SECONDS: ClassVar[int] = 14 * 60 * 60  # 50400 seconds

    def __init__(self, offset_seconds: int, name: str | None = None) -> None:
        """Create a Timezone with the specified UTC offset.

        Args:
            offset_seconds: UTC offset in seconds. Positive values are
                east of UTC, negative values are west.
            name: Optional name for the timezone (e.g., "EST", "UTC+5").

        Raises:
            TimezoneError: If offset_seconds is outside valid range.
        """
        if not isinstance(offset_seconds, int):
            raise TimezoneError(
                f"offset_seconds must be an integer, got {type(offset_seconds).__name__}"
            )

        if abs(offset_seconds) > self._MAX_OFFSET_SECONDS:
            raise TimezoneError(
                f"offset_seconds {offset_seconds} is outside valid range "
                f"[-{self._MAX_OFFSET_SECONDS}, {self._MAX_OFFSET_SECONDS}]"
            )

        self._offset_seconds: int = offset_seconds
        self._name: str | None = name

    @classmethod
    def utc(cls) -> Timezone:
        """Return the UTC timezone.

        This method returns a singleton instance for UTC (offset 0).
        All calls return the same instance.

        Returns:
            The UTC timezone instance.

        Examples:
            >>> tz = Timezone.utc()
            >>> tz.is_utc
            True
            >>> tz.offset_seconds
            0
        """
        if cls._utc_instance is None:
            cls._utc_instance = cls(0, "UTC")
        return cls._utc_instance

    @classmethod
    def from_hours(cls, hours: int, minutes: int = 0) -> Timezone:
        """Create a Timezone from hours and minutes offset.

        Args:
            hours: Hour component of offset (-14 to +14). Sign determines
                direction (positive = east of UTC).
            minutes: Minute component of offset (0 to 59). Must be non-negative;
                the sign is determined by the hours parameter.

        Returns:
            A new Timezone instance.

        Raises:
            TimezoneError: If hours or minutes are out of valid range.

        Examples:
            >>> tz = Timezone.from_hours(5, 30)  # UTC+5:30
            >>> tz.offset_seconds
            19800

            >>> tz = Timezone.from_hours(-5)  # UTC-5
            >>> tz.offset_seconds
            -18000
        """
        if not isinstance(hours, int):
            raise TimezoneError(
                f"hours must be an integer, got {type(hours).__name__}"
            )
        if not isinstance(minutes, int):
            raise TimezoneError(
                f"minutes must be an integer, got {type(minutes).__name__}"
            )

        if minutes < 0 or minutes > 59:
            raise TimezoneError(f"minutes must be 0-59, got {minutes}")

        # Calculate total seconds - minutes take the sign from hours
        if hours >= 0:
            offset_seconds = hours * 3600 + minutes * 60
        else:
            offset_seconds = hours * 3600 - minutes * 60

        return cls(offset_seconds)

    @classmethod
    def from_string(cls, s: str) -> Timezone:
        """Parse a timezone string into a Timezone instance.

        Supported formats:
            - "Z" or "z": UTC
            - "UTC": UTC
            - "+HH:MM" or "-HH:MM": Hours and minutes with colon
            - "+HHMM" or "-HHMM": Hours and minutes without colon
            - "+HH" or "-HH": Hours only

        Args:
            s: String representation of timezone.

        Returns:
            A new Timezone instance.

        Raises:
            TimezoneError: If the string cannot be parsed.

        Examples:
            >>> Timezone.from_string("Z").is_utc
            True

            >>> Timezone.from_string("+05:30").offset_seconds
            19800

            >>> Timezone.from_string("-0500").offset_seconds
            -18000
        """
        if not isinstance(s, str):
            raise TimezoneError(f"Expected string, got {type(s).__name__}")

        s = s.strip()

        # Handle UTC variants
        if s.upper() in ("Z", "UTC"):
            return cls.utc()

        # Pattern for +HH:MM, -HH:MM, +HHMM, -HHMM, +HH, -HH
        match = re.match(r"^([+-])(\d{1,2})(?::?(\d{2}))?$", s)
        if not match:
            raise TimezoneError(f"Cannot parse timezone string: {s!r}")

        sign_str, hours_str, minutes_str = match.groups()

        sign = 1 if sign_str == "+" else -1
        hours = int(hours_str)
        minutes = int(minutes_str) if minutes_str else 0

        if hours > 14 or (hours == 14 and minutes > 0):
            raise TimezoneError(f"Offset hours out of range: {s!r}")

        if minutes > 59:
            raise TimezoneError(f"Offset minutes out of range: {s!r}")

        offset_seconds = sign * (hours * 3600 + minutes * 60)
        return cls(offset_seconds)

    @property
    def offset_seconds(self) -> int:
        """Return the UTC offset in seconds.

        Returns:
            Offset from UTC in seconds. Positive values are east of UTC.
        """
        return self._offset_seconds

    @property
    def offset_hours(self) -> float:
        """Return the UTC offset in hours (as a float).

        Returns:
            Offset from UTC in hours. For example, UTC+5:30 returns 5.5.
        """
        return self._offset_seconds / 3600

    @property
    def name(self) -> str | None:
        """Return the timezone name, if set.

        Returns:
            The name provided at construction, or None if not set.
        """
        return self._name

    @property
    def is_utc(self) -> bool:
        """Return True if this timezone represents UTC.

        Returns:
            True if offset is zero, False otherwise.
        """
        return self._offset_seconds == 0

    def __eq__(self, other: object) -> bool:
        """Check equality based on offset_seconds.

        Two timezones are equal if they have the same offset, regardless
        of their names.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a Timezone with the same offset.
        """
        if not isinstance(other, Timezone):
            return NotImplemented
        return self._offset_seconds == other._offset_seconds

    def __hash__(self) -> int:
        """Return hash based on offset_seconds.

        Returns:
            Hash value based on the offset.
        """
        return hash(self._offset_seconds)

    def __repr__(self) -> str:
        """Return a string representation for debugging.

        Returns:
            String showing the class and offset.
        """
        if self._name:
            return f"Timezone(offset_seconds={self._offset_seconds}, name={self._name!r})"
        return f"Timezone(offset_seconds={self._offset_seconds})"

    def __str__(self) -> str:
        """Return a human-readable string representation.

        Returns:
            String like "UTC", "+05:30", or "-05:00".
        """
        if self._offset_seconds == 0:
            return self._name if self._name else "UTC"

        total_minutes = abs(self._offset_seconds) // 60
        hours = total_minutes // 60
        minutes = total_minutes % 60
        sign = "+" if self._offset_seconds >= 0 else "-"

        return f"{sign}{hours:02d}:{minutes:02d}"


__all__ = ["Timezone"]
