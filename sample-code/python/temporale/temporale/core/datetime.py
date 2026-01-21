"""DateTime class combining date and time with optional timezone.

This module provides the DateTime class for representing instants in time
with nanosecond precision and optional timezone information.
"""

from __future__ import annotations

import datetime as _datetime
import re
from typing import TYPE_CHECKING, overload

from temporale._internal.calendar import (
    mjd_to_ymd,
    ymd_to_mjd,
)
from temporale._internal.constants import (
    MJD_UNIX_EPOCH,
    NANOS_PER_DAY,
    NANOS_PER_HOUR,
    NANOS_PER_MICROSECOND,
    NANOS_PER_MILLISECOND,
    NANOS_PER_MINUTE,
    NANOS_PER_SECOND,
    SECONDS_PER_DAY,
)
from temporale.errors import ParseError, TimezoneError, ValidationError
from temporale.units.era import Era
from temporale.units.timezone import Timezone

if TYPE_CHECKING:
    from temporale.core.duration import Duration

from temporale.core.date import Date
from temporale.core.time import Time


class DateTime:
    """A combined date and time with optional timezone.

    DateTime represents a specific instant in time, combining a calendar date
    with a time of day and an optional timezone. It provides nanosecond
    precision and supports both naive (no timezone) and aware (has timezone)
    instances.

    The internal representation uses Modified Julian Day (MJD) for the date
    component and nanoseconds since midnight for the time component, allowing
    for efficient arithmetic operations.

    Attributes:
        year: The year component (can be negative for BCE).
        month: The month component (1-12).
        day: The day component (1-31).
        hour: The hour component (0-23).
        minute: The minute component (0-59).
        second: The second component (0-59).
        nanosecond: The nanosecond component (0-999999999).
        timezone: The timezone (None if naive).

    Examples:
        >>> dt = DateTime(2024, 1, 15, 14, 30, 45)
        >>> dt.year
        2024
        >>> dt.hour
        14

        >>> dt = DateTime.now()  # Current local time (naive)
        >>> dt = DateTime.utc_now()  # Current UTC time (aware)

        >>> dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
        >>> dt.timezone.is_utc
        True
    """

    __slots__ = ("_days", "_nanos", "_tz")

    def __init__(
        self,
        year: int,
        month: int,
        day: int,
        hour: int = 0,
        minute: int = 0,
        second: int = 0,
        *,
        millisecond: int = 0,
        microsecond: int = 0,
        nanosecond: int = 0,
        timezone: Timezone | None = None,
    ) -> None:
        """Create a DateTime from component parts.

        Args:
            year: The year (can be 0 or negative for BCE dates).
            month: The month (1-12).
            day: The day of the month.
            hour: The hour (0-23).
            minute: The minute (0-59).
            second: The second (0-59).
            millisecond: The millisecond (0-999). Added to nanosecond.
            microsecond: The microsecond (0-999999). Added to nanosecond.
            nanosecond: The nanosecond (0-999999999).
            timezone: Optional timezone (None for naive datetime).

        Raises:
            ValidationError: If any component is out of range.

        Examples:
            >>> DateTime(2024, 1, 15, 14, 30, 45)
            DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)

            >>> DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
            DateTime(2024, 1, 15, 12, 0, 0, nanosecond=0, timezone=UTC)
        """
        # Validate date components by creating a Date (reuse validation)
        date = Date(year, month, day)

        # Validate time components by creating a Time (reuse validation)
        time = Time(
            hour,
            minute,
            second,
            millisecond=millisecond,
            microsecond=microsecond,
            nanosecond=nanosecond,
        )

        # Store internal state
        self._days: int = date._days
        self._nanos: int = time._nanos
        self._tz: Timezone | None = timezone

    @classmethod
    def _from_internal(
        cls,
        days: int,
        nanos: int,
        tz: Timezone | None,
    ) -> DateTime:
        """Create a DateTime from internal MJD + nanos representation.

        This is an internal factory method that bypasses validation.

        Args:
            days: Modified Julian Day number.
            nanos: Nanoseconds since midnight.
            tz: Optional timezone.

        Returns:
            A new DateTime instance.
        """
        instance = object.__new__(cls)
        instance._days = days
        instance._nanos = nanos
        instance._tz = tz
        return instance

    @classmethod
    def now(cls) -> DateTime:
        """Return the current local datetime (naive).

        Returns:
            A naive DateTime representing the current local time.

        Examples:
            >>> dt = DateTime.now()
            >>> dt.timezone is None
            True
        """
        now = _datetime.datetime.now()
        return cls(
            year=now.year,
            month=now.month,
            day=now.day,
            hour=now.hour,
            minute=now.minute,
            second=now.second,
            microsecond=now.microsecond,
        )

    @classmethod
    def utc_now(cls) -> DateTime:
        """Return the current UTC datetime (aware).

        Returns:
            An aware DateTime representing the current UTC time.

        Examples:
            >>> dt = DateTime.utc_now()
            >>> dt.timezone.is_utc
            True
        """
        now = _datetime.datetime.utcnow()
        return cls(
            year=now.year,
            month=now.month,
            day=now.day,
            hour=now.hour,
            minute=now.minute,
            second=now.second,
            microsecond=now.microsecond,
            timezone=Timezone.utc(),
        )

    @classmethod
    def from_timestamp(
        cls,
        timestamp: int | float,
        *,
        timezone: Timezone | None = None,
    ) -> DateTime:
        """Create a DateTime from a Unix timestamp.

        Args:
            timestamp: Unix timestamp (seconds since 1970-01-01 00:00:00 UTC).
            timezone: Optional timezone for the result. If None, returns naive datetime.

        Returns:
            A DateTime representing the given timestamp.

        Examples:
            >>> DateTime.from_timestamp(0, timezone=Timezone.utc())
            DateTime(1970, 1, 1, 0, 0, 0, nanosecond=0, timezone=UTC)

            >>> DateTime.from_timestamp(1705329000)  # 2024-01-15 12:30:00 UTC
            DateTime(2024, 1, 15, 12, 30, 0, nanosecond=0)
        """
        # Handle float timestamps with fractional seconds
        if isinstance(timestamp, float):
            seconds = int(timestamp)
            nanos = int((timestamp - seconds) * NANOS_PER_SECOND)
            if nanos < 0:
                seconds -= 1
                nanos += NANOS_PER_SECOND
        else:
            seconds = timestamp
            nanos = 0

        # Convert to MJD days + nanoseconds
        # Unix epoch = MJD 40587
        total_days, remaining_secs = divmod(seconds, SECONDS_PER_DAY)
        days = MJD_UNIX_EPOCH + total_days
        time_nanos = remaining_secs * NANOS_PER_SECOND + nanos

        # Handle negative timestamps properly
        if time_nanos < 0:
            days -= 1
            time_nanos += NANOS_PER_DAY
        elif time_nanos >= NANOS_PER_DAY:
            days += 1
            time_nanos -= NANOS_PER_DAY

        return cls._from_internal(days, time_nanos, timezone)

    @classmethod
    def from_unix_seconds(cls, seconds: int, *, timezone: Timezone | None = None) -> DateTime:
        """Create a DateTime from Unix seconds.

        Args:
            seconds: Unix timestamp in seconds.
            timezone: Optional timezone for the result.

        Returns:
            A DateTime representing the given timestamp.
        """
        return cls.from_timestamp(seconds, timezone=timezone)

    @classmethod
    def from_unix_millis(cls, millis: int, *, timezone: Timezone | None = None) -> DateTime:
        """Create a DateTime from Unix milliseconds.

        Args:
            millis: Unix timestamp in milliseconds.
            timezone: Optional timezone for the result.

        Returns:
            A DateTime representing the given timestamp.
        """
        seconds, ms = divmod(millis, 1000)
        days, remaining_secs = divmod(seconds, SECONDS_PER_DAY)
        days += MJD_UNIX_EPOCH
        time_nanos = remaining_secs * NANOS_PER_SECOND + ms * NANOS_PER_MILLISECOND

        if time_nanos < 0:
            days -= 1
            time_nanos += NANOS_PER_DAY

        return cls._from_internal(days, time_nanos, timezone)

    @classmethod
    def from_unix_nanos(cls, nanos: int, *, timezone: Timezone | None = None) -> DateTime:
        """Create a DateTime from Unix nanoseconds.

        Args:
            nanos: Unix timestamp in nanoseconds.
            timezone: Optional timezone for the result.

        Returns:
            A DateTime representing the given timestamp.
        """
        nanos_per_day = SECONDS_PER_DAY * NANOS_PER_SECOND
        days, time_nanos = divmod(nanos, nanos_per_day)
        days += MJD_UNIX_EPOCH

        if time_nanos < 0:
            days -= 1
            time_nanos += nanos_per_day

        return cls._from_internal(days, time_nanos, timezone)

    @classmethod
    def from_iso_format(cls, s: str) -> DateTime:
        """Parse a datetime from ISO 8601 format.

        Supports formats:
        - YYYY-MM-DDTHH:MM:SS
        - YYYY-MM-DDTHH:MM:SS.f (1-9 decimal places)
        - YYYY-MM-DDTHH:MM:SSZ
        - YYYY-MM-DDTHH:MM:SS+HH:MM
        - YYYY-MM-DD (date only, time defaults to midnight)

        Args:
            s: The ISO 8601 datetime string to parse.

        Returns:
            A DateTime parsed from the string.

        Raises:
            ParseError: If the string is not valid ISO 8601 format.
            ValidationError: If the datetime components are invalid.

        Examples:
            >>> DateTime.from_iso_format("2024-01-15T14:30:45")
            DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)

            >>> DateTime.from_iso_format("2024-01-15T14:30:45.123456789Z")
            DateTime(2024, 1, 15, 14, 30, 45, nanosecond=123456789, timezone=UTC)

            >>> DateTime.from_iso_format("2024-01-15")
            DateTime(2024, 1, 15, 0, 0, 0, nanosecond=0)
        """
        s = s.strip()
        if not s:
            raise ParseError("empty datetime string")

        # Try to split date and time parts
        # Accept both 'T' and ' ' as separators
        if "T" in s:
            date_str, rest = s.split("T", 1)
        elif " " in s and len(s) > 10:
            date_str, rest = s.split(" ", 1)
        else:
            # Date only format
            date = Date.from_iso_format(s)
            return cls(date.year, date.month, date.day)

        # Parse date part
        date = Date.from_iso_format(date_str)

        # Parse time and optional timezone
        timezone = None
        time_str = rest

        # Check for timezone suffix
        tz_match = re.search(r"([Zz]|[+-]\d{2}(?::?\d{2})?)$", rest)
        if tz_match:
            tz_str = tz_match.group(1)
            time_str = rest[: tz_match.start()]
            timezone = Timezone.from_string(tz_str)

        # Parse time part
        time = Time.from_iso_format(time_str)

        return cls(
            date.year,
            date.month,
            date.day,
            time.hour,
            time.minute,
            time.second,
            nanosecond=time.nanosecond,
            timezone=timezone,
        )

    @classmethod
    def combine(cls, date: Date, time: Time, *, timezone: Timezone | None = None) -> DateTime:
        """Create a DateTime from a Date and Time.

        Args:
            date: The date component.
            time: The time component.
            timezone: Optional timezone.

        Returns:
            A new DateTime combining the given date and time.

        Examples:
            >>> d = Date(2024, 1, 15)
            >>> t = Time(14, 30, 45)
            >>> DateTime.combine(d, t)
            DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)
        """
        return cls._from_internal(date._days, time._nanos, timezone)

    # Properties - date components (delegated to Date)

    @property
    def year(self) -> int:
        """Return the year component.

        Returns:
            The year (can be negative for BCE dates).
        """
        year, _, _ = mjd_to_ymd(self._days)
        return year

    @property
    def month(self) -> int:
        """Return the month component.

        Returns:
            The month (1-12).
        """
        _, month, _ = mjd_to_ymd(self._days)
        return month

    @property
    def day(self) -> int:
        """Return the day component.

        Returns:
            The day of the month (1-31).
        """
        _, _, day = mjd_to_ymd(self._days)
        return day

    @property
    def era(self) -> Era:
        """Return the era (BCE or CE) for this datetime.

        Returns:
            Era.BCE or Era.CE.
        """
        return Era.BCE if self.year <= 0 else Era.CE

    # Properties - time components (delegated to Time)

    @property
    def hour(self) -> int:
        """Return the hour component.

        Returns:
            The hour (0-23).
        """
        return self._nanos // NANOS_PER_HOUR

    @property
    def minute(self) -> int:
        """Return the minute component.

        Returns:
            The minute (0-59).
        """
        return (self._nanos % NANOS_PER_HOUR) // NANOS_PER_MINUTE

    @property
    def second(self) -> int:
        """Return the second component.

        Returns:
            The second (0-59).
        """
        return (self._nanos % NANOS_PER_MINUTE) // NANOS_PER_SECOND

    @property
    def millisecond(self) -> int:
        """Return the millisecond component.

        Returns:
            Milliseconds within the second (0-999).
        """
        return (self._nanos % NANOS_PER_SECOND) // NANOS_PER_MILLISECOND

    @property
    def microsecond(self) -> int:
        """Return the microsecond component.

        Returns:
            Microseconds within the second (0-999999).
        """
        return (self._nanos % NANOS_PER_SECOND) // NANOS_PER_MICROSECOND

    @property
    def nanosecond(self) -> int:
        """Return the nanosecond component.

        Returns:
            Nanoseconds within the second (0-999999999).
        """
        return self._nanos % NANOS_PER_SECOND

    # Timezone property

    @property
    def timezone(self) -> Timezone | None:
        """Return the timezone, or None if naive.

        Returns:
            The timezone or None.
        """
        return self._tz

    @property
    def is_naive(self) -> bool:
        """Return True if this datetime has no timezone.

        Returns:
            True if naive, False if aware.
        """
        return self._tz is None

    @property
    def is_aware(self) -> bool:
        """Return True if this datetime has a timezone.

        Returns:
            True if aware, False if naive.
        """
        return self._tz is not None

    # Extract Date and Time

    def date(self) -> Date:
        """Return the date component as a Date object.

        Returns:
            A Date representing the date portion.

        Examples:
            >>> DateTime(2024, 1, 15, 14, 30, 45).date()
            Date(2024, 1, 15)
        """
        year, month, day = mjd_to_ymd(self._days)
        return Date(year, month, day)

    def time(self) -> Time:
        """Return the time component as a Time object.

        Returns:
            A Time representing the time portion.

        Examples:
            >>> DateTime(2024, 1, 15, 14, 30, 45).time()
            Time(14, 30, 45, nanosecond=0)
        """
        return Time._from_nanos(self._nanos)

    # Timezone handling

    def replace_timezone(self, timezone: Timezone | None) -> DateTime:
        """Return a new DateTime with a different timezone.

        This replaces the timezone without converting the time.
        The local time components remain the same.

        Args:
            timezone: The new timezone (or None for naive).

        Returns:
            A new DateTime with the specified timezone.

        Examples:
            >>> dt = DateTime(2024, 1, 15, 12, 0, 0)
            >>> dt.replace_timezone(Timezone.utc())
            DateTime(2024, 1, 15, 12, 0, 0, nanosecond=0, timezone=UTC)
        """
        return DateTime._from_internal(self._days, self._nanos, timezone)

    def astimezone(self, timezone: Timezone) -> DateTime:
        """Convert this datetime to a different timezone.

        This preserves the instant in time (same point on the timeline),
        but changes the local time representation.

        Args:
            timezone: The target timezone.

        Returns:
            A new DateTime representing the same instant in the target timezone.

        Raises:
            TimezoneError: If this datetime is naive.

        Examples:
            >>> dt = DateTime(2024, 1, 15, 12, 0, 0, timezone=Timezone.utc())
            >>> dt_local = dt.astimezone(Timezone.from_hours(5, 30))
            >>> dt_local.hour
            17
            >>> dt_local.minute
            30
        """
        if self._tz is None:
            raise TimezoneError(
                "Cannot convert naive datetime to timezone. "
                "Use replace_timezone() to add a timezone first."
            )

        # Calculate the offset difference
        offset_diff = timezone.offset_seconds - self._tz.offset_seconds

        # Convert to new timezone by adding the offset difference
        new_nanos = self._nanos + offset_diff * NANOS_PER_SECOND
        new_days = self._days

        # Handle day overflow/underflow
        while new_nanos >= NANOS_PER_DAY:
            new_nanos -= NANOS_PER_DAY
            new_days += 1
        while new_nanos < 0:
            new_nanos += NANOS_PER_DAY
            new_days -= 1

        return DateTime._from_internal(new_days, new_nanos, timezone)

    def to_utc(self) -> DateTime:
        """Convert this datetime to UTC.

        Returns:
            A new DateTime in UTC timezone.

        Raises:
            TimezoneError: If this datetime is naive.

        Examples:
            >>> dt = DateTime(2024, 1, 15, 17, 30, 0, timezone=Timezone.from_hours(5, 30))
            >>> dt.to_utc().hour
            12
        """
        return self.astimezone(Timezone.utc())

    # Unix timestamp conversions

    def to_unix_seconds(self) -> int:
        """Return the Unix timestamp in seconds.

        For aware datetimes, this returns the UTC timestamp.
        For naive datetimes, this assumes local time equals UTC.

        Returns:
            Unix timestamp in seconds.
        """
        # Calculate days since Unix epoch
        days_since_unix = self._days - MJD_UNIX_EPOCH

        # Get the timestamp for start of this day
        day_seconds = days_since_unix * SECONDS_PER_DAY

        # Add time component
        time_seconds = self._nanos // NANOS_PER_SECOND

        # For aware datetime, adjust for timezone
        if self._tz is not None:
            return day_seconds + time_seconds - self._tz.offset_seconds
        return day_seconds + time_seconds

    def to_unix_millis(self) -> int:
        """Return the Unix timestamp in milliseconds.

        Returns:
            Unix timestamp in milliseconds.
        """
        base_seconds = self.to_unix_seconds()
        ms = self.nanosecond // NANOS_PER_MILLISECOND
        return base_seconds * 1000 + ms

    def to_unix_nanos(self) -> int:
        """Return the Unix timestamp in nanoseconds.

        Returns:
            Unix timestamp in nanoseconds.
        """
        base_seconds = self.to_unix_seconds()
        return base_seconds * NANOS_PER_SECOND + self.nanosecond

    # Replacement

    def replace(
        self,
        year: int | None = None,
        month: int | None = None,
        day: int | None = None,
        hour: int | None = None,
        minute: int | None = None,
        second: int | None = None,
        *,
        millisecond: int | None = None,
        microsecond: int | None = None,
        nanosecond: int | None = None,
        timezone: Timezone | None | object = ...,
    ) -> DateTime:
        """Return a new DateTime with specified components replaced.

        Any component not specified retains its current value.
        Use timezone=None to make naive, or pass a Timezone to set one.
        Omit timezone to keep the current timezone.

        Args:
            year: New year value.
            month: New month value.
            day: New day value.
            hour: New hour value.
            minute: New minute value.
            second: New second value.
            millisecond: New millisecond value.
            microsecond: New microsecond value.
            nanosecond: New nanosecond value.
            timezone: New timezone (omit to keep current).

        Returns:
            A new DateTime with the specified components replaced.

        Examples:
            >>> dt = DateTime(2024, 1, 15, 14, 30, 45)
            >>> dt.replace(hour=10)
            DateTime(2024, 1, 15, 10, 30, 45, nanosecond=0)
        """
        new_year = year if year is not None else self.year
        new_month = month if month is not None else self.month
        new_day = day if day is not None else self.day
        new_hour = hour if hour is not None else self.hour
        new_minute = minute if minute is not None else self.minute
        new_second = second if second is not None else self.second

        # Handle subsecond replacement
        if nanosecond is not None:
            new_nanosecond = nanosecond
        elif microsecond is not None:
            new_nanosecond = microsecond * NANOS_PER_MICROSECOND
        elif millisecond is not None:
            new_nanosecond = millisecond * NANOS_PER_MILLISECOND
        else:
            new_nanosecond = self.nanosecond

        # Handle timezone
        if timezone is ...:
            new_tz = self._tz
        else:
            new_tz = timezone  # type: ignore

        return DateTime(
            new_year,
            new_month,
            new_day,
            new_hour,
            new_minute,
            new_second,
            nanosecond=new_nanosecond,
            timezone=new_tz,
        )

    # ISO format

    def to_json(self) -> dict:
        """Return the datetime as a JSON-serializable dictionary.

        The format uses ISO 8601 string with type tag for polymorphic
        deserialization.

        Returns:
            Dictionary with _type and value keys.

        Examples:
            >>> DateTime(2024, 1, 15, 14, 30, 45).to_json()
            {'_type': 'DateTime', 'value': '2024-01-15T14:30:45'}
        """
        return {"_type": "DateTime", "value": self.to_iso_format()}

    @classmethod
    def from_json(cls, data: dict) -> "DateTime":
        """Create a DateTime from a JSON dictionary.

        Args:
            data: Dictionary with _type and value keys.

        Returns:
            A DateTime parsed from the dictionary.

        Raises:
            ParseError: If the data is invalid.

        Examples:
            >>> DateTime.from_json({'_type': 'DateTime', 'value': '2024-01-15T14:30:45'})
            DateTime(2024, 1, 15, 14, 30, 45, nanosecond=0)
        """
        from temporale.errors import ParseError

        if not isinstance(data, dict):
            raise ParseError(f"expected dict, got {type(data).__name__}")

        value = data.get("value")
        if not value:
            raise ParseError("missing 'value' field for DateTime")

        return cls.from_iso_format(value)

    def to_iso_format(self, *, precision: str = "auto") -> str:
        """Return the datetime as an ISO 8601 string.

        Args:
            precision: Subsecond precision to include:
                - "auto": Include subseconds only if non-zero
                - "seconds": No subseconds
                - "millis": Always 3 decimal places
                - "micros": Always 6 decimal places
                - "nanos": Always 9 decimal places

        Returns:
            ISO 8601 formatted datetime string.

        Examples:
            >>> DateTime(2024, 1, 15, 14, 30, 45).to_iso_format()
            '2024-01-15T14:30:45'

            >>> DateTime(2024, 1, 15, 14, 30, 45, timezone=Timezone.utc()).to_iso_format()
            '2024-01-15T14:30:45Z'
        """
        # Date part
        year, month, day = mjd_to_ymd(self._days)
        if year >= 0:
            date_str = f"{year:04d}-{month:02d}-{day:02d}"
        else:
            date_str = f"{year:05d}-{month:02d}-{day:02d}"

        # Time part
        time_str = f"{self.hour:02d}:{self.minute:02d}:{self.second:02d}"

        # Subseconds
        if precision == "seconds":
            pass
        elif precision == "millis":
            time_str += f".{self.nanosecond // 1_000_000:03d}"
        elif precision == "micros":
            time_str += f".{self.nanosecond // 1_000:06d}"
        elif precision == "nanos":
            time_str += f".{self.nanosecond:09d}"
        else:  # auto
            if self.nanosecond != 0:
                frac = f"{self.nanosecond:09d}".rstrip("0")
                time_str += f".{frac}"

        result = f"{date_str}T{time_str}"

        # Timezone
        if self._tz is not None:
            if self._tz.is_utc:
                result += "Z"
            else:
                result += str(self._tz)

        return result

    # Arithmetic operators

    @overload
    def __add__(self, other: Duration) -> DateTime: ...

    @overload
    def __add__(self, other: object) -> DateTime: ...

    def __add__(self, other: object) -> DateTime:
        """Add a Duration to this datetime.

        Args:
            other: A Duration to add.

        Returns:
            A new DateTime offset by the Duration.

        Raises:
            TypeError: If other is not a Duration.

        Examples:
            >>> from temporale.core.duration import Duration
            >>> dt = DateTime(2024, 1, 15, 12, 0, 0)
            >>> dt + Duration(days=1, hours=2)
            DateTime(2024, 1, 16, 14, 0, 0, nanosecond=0)
        """
        from temporale.core.duration import Duration

        if not isinstance(other, Duration):
            return NotImplemented

        # Add total nanoseconds from duration
        total_nanos = other.total_nanoseconds
        new_nanos = self._nanos + (total_nanos % NANOS_PER_DAY)
        new_days = self._days + (total_nanos // NANOS_PER_DAY)

        # Handle day overflow/underflow
        while new_nanos >= NANOS_PER_DAY:
            new_nanos -= NANOS_PER_DAY
            new_days += 1
        while new_nanos < 0:
            new_nanos += NANOS_PER_DAY
            new_days -= 1

        return DateTime._from_internal(new_days, new_nanos, self._tz)

    @overload
    def __sub__(self, other: Duration) -> DateTime: ...

    @overload
    def __sub__(self, other: DateTime) -> Duration: ...

    @overload
    def __sub__(self, other: object) -> DateTime | Duration: ...

    def __sub__(self, other: object) -> DateTime | Duration:
        """Subtract a Duration or DateTime from this datetime.

        When subtracting a Duration, returns a new DateTime.
        When subtracting a DateTime, returns a Duration.

        Args:
            other: A Duration or DateTime to subtract.

        Returns:
            A new DateTime (if subtracting Duration) or Duration (if subtracting DateTime).

        Raises:
            TypeError: If other is not a Duration or DateTime.
            TimezoneError: If comparing naive and aware datetimes.

        Examples:
            >>> from temporale.core.duration import Duration
            >>> dt = DateTime(2024, 1, 15, 14, 0, 0)
            >>> dt - Duration(hours=2)
            DateTime(2024, 1, 15, 12, 0, 0, nanosecond=0)

            >>> dt1 = DateTime(2024, 1, 15, 14, 0, 0)
            >>> dt2 = DateTime(2024, 1, 15, 12, 0, 0)
            >>> (dt1 - dt2).total_seconds
            7200.0
        """
        from temporale.core.duration import Duration

        if isinstance(other, Duration):
            return self + (-other)
        elif isinstance(other, DateTime):
            # Check for naive/aware mismatch
            if (self._tz is None) != (other._tz is None):
                raise TimezoneError(
                    "Cannot subtract naive and aware datetimes. "
                    "Both must be naive or both must be aware."
                )

            # If both are aware, convert to same timezone for comparison
            if self._tz is not None and other._tz is not None:
                # Convert other to same timezone as self
                if self._tz.offset_seconds != other._tz.offset_seconds:
                    other = other.astimezone(self._tz)

            # Calculate difference in nanoseconds
            days_diff = self._days - other._days
            nanos_diff = self._nanos - other._nanos

            total_nanos = days_diff * NANOS_PER_DAY + nanos_diff
            return Duration(nanoseconds=total_nanos)

        return NotImplemented

    # Comparison operators

    def __eq__(self, other: object) -> bool:
        """Check equality with another datetime.

        Two datetimes are equal if they represent the same instant.
        A naive datetime is never equal to an aware datetime.

        Args:
            other: Object to compare with.

        Returns:
            True if other is a DateTime with the same value.
        """
        if not isinstance(other, DateTime):
            return NotImplemented

        # Naive != Aware (per Q07 decision)
        if (self._tz is None) != (other._tz is None):
            return False

        # Both naive: compare directly
        if self._tz is None:
            return self._days == other._days and self._nanos == other._nanos

        # Both aware: compare as UTC
        self_utc = self.to_utc()
        other_utc = other.to_utc()
        return self_utc._days == other_utc._days and self_utc._nanos == other_utc._nanos

    def __ne__(self, other: object) -> bool:
        """Check inequality with another datetime."""
        result = self.__eq__(other)
        if result is NotImplemented:
            return NotImplemented
        return not result

    def __lt__(self, other: object) -> bool:
        """Check if this datetime is earlier than another.

        Raises:
            TypeError: If comparing naive and aware datetimes.
        """
        if not isinstance(other, DateTime):
            return NotImplemented

        self._check_comparable(other)

        # Both naive: compare directly
        if self._tz is None:
            if self._days != other._days:
                return self._days < other._days
            return self._nanos < other._nanos

        # Both aware: compare as UTC
        self_utc = self.to_utc()
        other_utc = other.to_utc()
        if self_utc._days != other_utc._days:
            return self_utc._days < other_utc._days
        return self_utc._nanos < other_utc._nanos

    def __le__(self, other: object) -> bool:
        """Check if this datetime is earlier than or equal to another."""
        if not isinstance(other, DateTime):
            return NotImplemented
        return self == other or self < other

    def __gt__(self, other: object) -> bool:
        """Check if this datetime is later than another."""
        if not isinstance(other, DateTime):
            return NotImplemented
        self._check_comparable(other)
        return not (self <= other)

    def __ge__(self, other: object) -> bool:
        """Check if this datetime is later than or equal to another."""
        if not isinstance(other, DateTime):
            return NotImplemented
        return self == other or self > other

    def _check_comparable(self, other: DateTime) -> None:
        """Check if two datetimes can be compared.

        Raises:
            TypeError: If one is naive and the other is aware.
        """
        if (self._tz is None) != (other._tz is None):
            raise TypeError(
                "can't compare naive and aware datetimes. "
                "Both must be naive or both must be aware."
            )

    def __hash__(self) -> int:
        """Return a hash for this datetime.

        Returns:
            Hash based on days, nanos, and timezone offset.
        """
        if self._tz is None:
            return hash((self._days, self._nanos, None))
        # For aware datetimes, hash based on UTC representation
        utc = self.to_utc()
        return hash((utc._days, utc._nanos, 0))

    def __repr__(self) -> str:
        """Return a detailed string representation."""
        year, month, day = mjd_to_ymd(self._days)
        tz_part = ""
        if self._tz is not None:
            tz_part = f", timezone={self._tz}"
        return (
            f"DateTime({year}, {month}, {day}, {self.hour}, {self.minute}, "
            f"{self.second}, nanosecond={self.nanosecond}{tz_part})"
        )

    def __str__(self) -> str:
        """Return the ISO 8601 representation."""
        return self.to_iso_format()

    def __bool__(self) -> bool:
        """DateTimes are always truthy."""
        return True


__all__ = ["DateTime"]
