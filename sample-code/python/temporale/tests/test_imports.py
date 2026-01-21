"""Tests for Temporale package imports.

These tests verify that the package structure is correct and all
modules are importable.
"""

from __future__ import annotations


def test_import_temporale() -> None:
    """Import temporale package succeeds."""
    import temporale

    assert hasattr(temporale, "__version__")
    assert temporale.__version__ == "0.1.0"


def test_import_core_module() -> None:
    """Import temporale.core submodule succeeds."""
    from temporale import core

    assert hasattr(core, "__all__")


def test_import_units_module() -> None:
    """Import temporale.units submodule succeeds."""
    from temporale import units

    assert hasattr(units, "__all__")


def test_import_format_module() -> None:
    """Import temporale.format submodule succeeds."""
    from temporale import format  # noqa: A004

    assert hasattr(format, "__all__")


def test_import_convert_module() -> None:
    """Import temporale.convert submodule succeeds."""
    from temporale import convert

    assert hasattr(convert, "__all__")


def test_import_arithmetic_module() -> None:
    """Import temporale.arithmetic submodule succeeds."""
    from temporale import arithmetic

    assert hasattr(arithmetic, "__all__")


def test_import_internal_module() -> None:
    """Import temporale._internal submodule succeeds."""
    from temporale import _internal

    assert hasattr(_internal, "__all__")


def test_import_errors() -> None:
    """Import temporale.errors succeeds with all exception classes."""
    from temporale.errors import (
        OverflowError,
        ParseError,
        TemporaleError,
        TimezoneError,
        ValidationError,
    )

    # Verify inheritance hierarchy
    assert issubclass(ValidationError, TemporaleError)
    assert issubclass(ParseError, TemporaleError)
    assert issubclass(OverflowError, TemporaleError)
    assert issubclass(TimezoneError, TemporaleError)
    assert issubclass(TemporaleError, Exception)


def test_import_constants() -> None:
    """Import temporale._internal.constants succeeds."""
    from temporale._internal.constants import (
        DAYS_IN_MONTH,
        MAX_YEAR,
        MIN_YEAR,
        NANOS_PER_DAY,
        NANOS_PER_SECOND,
    )

    assert NANOS_PER_SECOND == 1_000_000_000
    assert NANOS_PER_DAY == 86_400_000_000_000
    assert MIN_YEAR == -9999
    assert MAX_YEAR == 9999
    assert len(DAYS_IN_MONTH) == 13  # 0-indexed placeholder + 12 months
