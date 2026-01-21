"""Tests for Timezone class.

These tests verify the Timezone implementation, including construction,
parsing, properties, and equality/hashing.
"""

from __future__ import annotations

import pytest


class TestTimezoneUtc:
    """Tests for Timezone.utc() classmethod."""

    def test_utc_returns_timezone(self) -> None:
        """Timezone.utc() returns a Timezone instance."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert isinstance(tz, Timezone)

    def test_utc_offset_is_zero(self) -> None:
        """UTC timezone has offset of 0 seconds."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert tz.offset_seconds == 0

    def test_utc_is_utc_property(self) -> None:
        """UTC timezone has is_utc = True."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert tz.is_utc is True

    def test_utc_offset_hours(self) -> None:
        """UTC timezone has offset_hours = 0.0."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert tz.offset_hours == 0.0

    def test_utc_has_name(self) -> None:
        """UTC timezone has name 'UTC'."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert tz.name == "UTC"

    def test_utc_is_singleton(self) -> None:
        """Multiple calls to utc() return the same instance."""
        from temporale.units import Timezone

        tz1 = Timezone.utc()
        tz2 = Timezone.utc()
        assert tz1 is tz2


class TestTimezoneFromHours:
    """Tests for Timezone.from_hours() classmethod."""

    def test_from_hours_positive(self) -> None:
        """Positive hours offset works correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5)
        assert tz.offset_seconds == 5 * 3600

    def test_from_hours_negative(self) -> None:
        """Negative hours offset works correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(-5)
        assert tz.offset_seconds == -5 * 3600

    def test_from_hours_with_minutes(self) -> None:
        """Hours plus minutes offset works correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 30)
        assert tz.offset_seconds == 5 * 3600 + 30 * 60
        assert tz.offset_seconds == 19800

    def test_from_hours_negative_with_minutes(self) -> None:
        """Negative hours with minutes uses correct sign."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(-5, 30)
        assert tz.offset_seconds == -(5 * 3600 + 30 * 60)
        assert tz.offset_seconds == -19800

    def test_from_hours_zero(self) -> None:
        """Zero offset is UTC equivalent."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(0)
        assert tz.offset_seconds == 0
        assert tz.is_utc is True

    def test_from_hours_max_positive(self) -> None:
        """Maximum positive offset (+14:00) is valid."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(14)
        assert tz.offset_seconds == 14 * 3600

    def test_from_hours_max_negative(self) -> None:
        """Maximum negative offset (-14:00) is valid."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(-14)
        assert tz.offset_seconds == -14 * 3600

    def test_from_hours_invalid_minutes_negative(self) -> None:
        """Negative minutes raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="minutes must be 0-59"):
            Timezone.from_hours(5, -10)

    def test_from_hours_invalid_minutes_too_large(self) -> None:
        """Minutes > 59 raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="minutes must be 0-59"):
            Timezone.from_hours(5, 60)

    def test_from_hours_offset_hours_property(self) -> None:
        """offset_hours returns float representation."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 30)
        assert tz.offset_hours == 5.5


class TestTimezoneFromString:
    """Tests for Timezone.from_string() classmethod."""

    def test_from_string_z(self) -> None:
        """'Z' parses as UTC."""
        from temporale.units import Timezone

        tz = Timezone.from_string("Z")
        assert tz.is_utc is True

    def test_from_string_z_lowercase(self) -> None:
        """'z' (lowercase) parses as UTC."""
        from temporale.units import Timezone

        tz = Timezone.from_string("z")
        assert tz.is_utc is True

    def test_from_string_utc(self) -> None:
        """'UTC' parses as UTC."""
        from temporale.units import Timezone

        tz = Timezone.from_string("UTC")
        assert tz.is_utc is True

    def test_from_string_utc_lowercase(self) -> None:
        """'utc' (lowercase) parses as UTC."""
        from temporale.units import Timezone

        tz = Timezone.from_string("utc")
        assert tz.is_utc is True

    def test_from_string_positive_with_colon(self) -> None:
        """'+05:30' parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("+05:30")
        assert tz.offset_seconds == 19800

    def test_from_string_negative_with_colon(self) -> None:
        """'-05:30' parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("-05:30")
        assert tz.offset_seconds == -19800

    def test_from_string_positive_no_colon(self) -> None:
        """'+0530' (no colon) parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("+0530")
        assert tz.offset_seconds == 19800

    def test_from_string_negative_no_colon(self) -> None:
        """'-0530' (no colon) parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("-0530")
        assert tz.offset_seconds == -19800

    def test_from_string_hours_only(self) -> None:
        """'+05' (hours only) parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("+05")
        assert tz.offset_seconds == 5 * 3600

    def test_from_string_single_digit_hours(self) -> None:
        """'+5' (single digit) parses correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_string("+5")
        assert tz.offset_seconds == 5 * 3600

    def test_from_string_zero_offset(self) -> None:
        """'+00:00' parses as UTC equivalent."""
        from temporale.units import Timezone

        tz = Timezone.from_string("+00:00")
        assert tz.offset_seconds == 0
        assert tz.is_utc is True

    def test_from_string_with_whitespace(self) -> None:
        """Leading/trailing whitespace is trimmed."""
        from temporale.units import Timezone

        tz = Timezone.from_string("  +05:30  ")
        assert tz.offset_seconds == 19800

    def test_from_string_invalid_format(self) -> None:
        """Invalid format raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="Cannot parse timezone string"):
            Timezone.from_string("invalid")

    def test_from_string_out_of_range_hours(self) -> None:
        """Hours > 14 raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="out of range"):
            Timezone.from_string("+15:00")


class TestTimezoneEquality:
    """Tests for Timezone equality and hashing."""

    def test_equal_offsets_are_equal(self) -> None:
        """Timezones with same offset are equal."""
        from temporale.units import Timezone

        tz1 = Timezone.from_hours(5, 30)
        tz2 = Timezone.from_hours(5, 30)
        assert tz1 == tz2

    def test_different_offsets_not_equal(self) -> None:
        """Timezones with different offsets are not equal."""
        from temporale.units import Timezone

        tz1 = Timezone.from_hours(5, 30)
        tz2 = Timezone.from_hours(5, 0)
        assert tz1 != tz2

    def test_same_offset_different_names_are_equal(self) -> None:
        """Timezones with same offset but different names are equal."""
        from temporale.units import Timezone

        tz1 = Timezone(19800, name="IST")
        tz2 = Timezone(19800, name="Asia/Kolkata")
        assert tz1 == tz2

    def test_equality_with_non_timezone(self) -> None:
        """Comparison with non-Timezone returns NotImplemented/False."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert (tz == "UTC") is False
        assert (tz == 0) is False

    def test_hash_same_offset(self) -> None:
        """Same offset produces same hash."""
        from temporale.units import Timezone

        tz1 = Timezone.from_hours(5, 30)
        tz2 = Timezone.from_hours(5, 30)
        assert hash(tz1) == hash(tz2)

    def test_hash_different_offset(self) -> None:
        """Different offsets likely produce different hashes."""
        from temporale.units import Timezone

        tz1 = Timezone.from_hours(5)
        tz2 = Timezone.from_hours(-5)
        # Different offsets should (almost always) have different hashes
        assert hash(tz1) != hash(tz2)

    def test_can_use_in_set(self) -> None:
        """Timezones can be used in sets."""
        from temporale.units import Timezone

        tz1 = Timezone.from_hours(5, 30)
        tz2 = Timezone.from_hours(5, 30)  # Duplicate
        tz3 = Timezone.from_hours(-5)

        tz_set = {tz1, tz2, tz3}
        assert len(tz_set) == 2  # tz1 and tz2 are equal, so only 2 unique

    def test_can_use_as_dict_key(self) -> None:
        """Timezones can be used as dictionary keys."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 30)
        d = {tz: "India"}
        assert d[tz] == "India"


class TestTimezoneRepr:
    """Tests for Timezone string representations."""

    def test_repr_without_name(self) -> None:
        """repr shows offset_seconds without name."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 30)
        r = repr(tz)
        assert "Timezone(" in r
        assert "offset_seconds=19800" in r

    def test_repr_with_name(self) -> None:
        """repr shows both offset_seconds and name."""
        from temporale.units import Timezone

        tz = Timezone(19800, name="IST")
        r = repr(tz)
        assert "offset_seconds=19800" in r
        assert "name='IST'" in r

    def test_str_utc(self) -> None:
        """str of UTC timezone is 'UTC'."""
        from temporale.units import Timezone

        tz = Timezone.utc()
        assert str(tz) == "UTC"

    def test_str_positive_offset(self) -> None:
        """str of positive offset is '+HH:MM' format."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 30)
        assert str(tz) == "+05:30"

    def test_str_negative_offset(self) -> None:
        """str of negative offset is '-HH:MM' format."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(-5, 30)
        assert str(tz) == "-05:30"

    def test_str_whole_hours(self) -> None:
        """str of whole hour offset shows :00 for minutes."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(8)
        assert str(tz) == "+08:00"


class TestTimezoneConstruction:
    """Tests for direct Timezone construction."""

    def test_direct_construction(self) -> None:
        """Direct construction with offset_seconds works."""
        from temporale.units import Timezone

        tz = Timezone(3600)
        assert tz.offset_seconds == 3600

    def test_construction_with_name(self) -> None:
        """Construction with name stores the name."""
        from temporale.units import Timezone

        tz = Timezone(3600, name="CET")
        assert tz.name == "CET"

    def test_construction_without_name(self) -> None:
        """Construction without name has None name."""
        from temporale.units import Timezone

        tz = Timezone(3600)
        assert tz.name is None

    def test_construction_invalid_offset_type(self) -> None:
        """Non-integer offset raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="must be an integer"):
            Timezone(3600.5)  # type: ignore[arg-type]

    def test_construction_offset_too_large(self) -> None:
        """Offset > 14 hours raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="outside valid range"):
            Timezone(15 * 3600)

    def test_construction_offset_too_negative(self) -> None:
        """Offset < -14 hours raises TimezoneError."""
        from temporale.errors import TimezoneError
        from temporale.units import Timezone

        with pytest.raises(TimezoneError, match="outside valid range"):
            Timezone(-15 * 3600)


class TestTimezoneProperties:
    """Tests for Timezone property accessors."""

    def test_offset_seconds_property(self) -> None:
        """offset_seconds returns stored value."""
        from temporale.units import Timezone

        tz = Timezone(7200)
        assert tz.offset_seconds == 7200

    def test_offset_hours_fractional(self) -> None:
        """offset_hours handles fractional hours correctly."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(5, 45)
        assert tz.offset_hours == 5.75

    def test_is_utc_false_for_non_zero(self) -> None:
        """is_utc is False for non-zero offset."""
        from temporale.units import Timezone

        tz = Timezone.from_hours(1)
        assert tz.is_utc is False

    def test_name_preserved(self) -> None:
        """name property returns the name set at construction."""
        from temporale.units import Timezone

        tz = Timezone(0, name="GMT")
        assert tz.name == "GMT"
