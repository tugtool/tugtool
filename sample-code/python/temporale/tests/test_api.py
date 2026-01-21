"""Tests for Temporale public API and exports.

This module verifies:
- All expected exports are available from the top-level package
- __all__ lists match actual exports in all modules
- No private symbols are accidentally exported
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any


class TestPublicAPIExports:
    """Test that all expected exports are available from temporale."""

    def test_core_types_exported(self) -> None:
        """All core types should be importable from temporale."""
        from temporale import Date, Time, DateTime, Duration, Period, Interval

        # Verify they are classes
        assert isinstance(Date, type)
        assert isinstance(Time, type)
        assert isinstance(DateTime, type)
        assert isinstance(Duration, type)
        assert isinstance(Period, type)
        assert isinstance(Interval, type)

    def test_unit_types_exported(self) -> None:
        """All unit types should be importable from temporale."""
        from temporale import Era, TimeUnit, Timezone

        assert isinstance(Era, type)
        assert isinstance(TimeUnit, type)
        assert isinstance(Timezone, type)

    def test_exception_types_exported(self) -> None:
        """All exception types should be importable from temporale."""
        from temporale import (
            TemporaleError,
            ValidationError,
            ParseError,
            OverflowError,
            TimezoneError,
        )

        # Verify they are exception classes
        assert issubclass(TemporaleError, Exception)
        assert issubclass(ValidationError, TemporaleError)
        assert issubclass(ParseError, TemporaleError)
        assert issubclass(OverflowError, TemporaleError)
        assert issubclass(TimezoneError, TemporaleError)

    def test_format_functions_exported(self) -> None:
        """Format functions should be importable from temporale."""
        from temporale import parse_iso8601, format_iso8601

        # Verify they are callable
        assert callable(parse_iso8601)
        assert callable(format_iso8601)

    def test_infer_functions_exported(self) -> None:
        """Inference functions should be importable from temporale."""
        from temporale import parse_fuzzy, parse_relative, InferOptions, DateOrder

        # Verify functions are callable
        assert callable(parse_fuzzy)
        assert callable(parse_relative)

        # Verify types
        assert isinstance(InferOptions, type)
        assert isinstance(DateOrder, type)

    def test_version_exported(self) -> None:
        """__version__ should be importable from temporale."""
        from temporale import __version__

        assert isinstance(__version__, str)
        # Should be a valid semver-like version
        parts = __version__.split(".")
        assert len(parts) >= 2
        assert all(part.isdigit() for part in parts[:2])

    def test_all_specified_exports_available(self) -> None:
        """All exports specified in the plan should be available."""
        import temporale

        expected_exports = [
            # Core types
            "Date",
            "Time",
            "DateTime",
            "Duration",
            "Period",
            "Interval",
            # Units
            "Era",
            "TimeUnit",
            "Timezone",
            # Exceptions
            "TemporaleError",
            "ValidationError",
            "ParseError",
            "OverflowError",
            "TimezoneError",
            # Format functions
            "parse_iso8601",
            "format_iso8601",
            # Infer functions
            "parse_fuzzy",
            "parse_relative",
            "InferOptions",
            "DateOrder",
            # Constants
            "__version__",
        ]

        for name in expected_exports:
            assert hasattr(
                temporale, name
            ), f"Expected {name!r} to be exported from temporale"


class TestAllListsMatchExports:
    """Test that __all__ lists accurately reflect module contents."""

    def test_top_level_all_matches_actual(self) -> None:
        """temporale.__all__ should match actual exported symbols."""
        import temporale

        all_list = temporale.__all__

        # Every name in __all__ should be accessible
        for name in all_list:
            assert hasattr(
                temporale, name
            ), f"{name!r} is in __all__ but not accessible"

        # Verify the list contains expected items
        assert "__version__" in all_list

    def test_core_module_all_matches_actual(self) -> None:
        """temporale.core.__all__ should match actual exported symbols."""
        import temporale.core

        all_list = temporale.core.__all__

        for name in all_list:
            assert hasattr(
                temporale.core, name
            ), f"{name!r} is in core.__all__ but not accessible"

    def test_units_module_all_matches_actual(self) -> None:
        """temporale.units.__all__ should match actual exported symbols."""
        import temporale.units

        all_list = temporale.units.__all__

        for name in all_list:
            assert hasattr(
                temporale.units, name
            ), f"{name!r} is in units.__all__ but not accessible"

    def test_format_module_all_matches_actual(self) -> None:
        """temporale.format.__all__ should match actual exported symbols."""
        import temporale.format

        all_list = temporale.format.__all__

        for name in all_list:
            assert hasattr(
                temporale.format, name
            ), f"{name!r} is in format.__all__ but not accessible"

    def test_convert_module_all_matches_actual(self) -> None:
        """temporale.convert.__all__ should match actual exported symbols."""
        import temporale.convert

        all_list = temporale.convert.__all__

        for name in all_list:
            assert hasattr(
                temporale.convert, name
            ), f"{name!r} is in convert.__all__ but not accessible"

    def test_arithmetic_module_all_matches_actual(self) -> None:
        """temporale.arithmetic.__all__ should match actual exported symbols."""
        import temporale.arithmetic

        all_list = temporale.arithmetic.__all__

        for name in all_list:
            assert hasattr(
                temporale.arithmetic, name
            ), f"{name!r} is in arithmetic.__all__ but not accessible"

    def test_infer_module_all_matches_actual(self) -> None:
        """temporale.infer.__all__ should match actual exported symbols."""
        import temporale.infer

        all_list = temporale.infer.__all__

        for name in all_list:
            assert hasattr(
                temporale.infer, name
            ), f"{name!r} is in infer.__all__ but not accessible"

    def test_errors_module_all_matches_actual(self) -> None:
        """temporale.errors.__all__ should match actual exported symbols."""
        import temporale.errors

        all_list = temporale.errors.__all__

        for name in all_list:
            assert hasattr(
                temporale.errors, name
            ), f"{name!r} is in errors.__all__ but not accessible"


class TestNoPrivateSymbolsExported:
    """Test that private symbols are not accidentally exported."""

    def test_top_level_no_private_exports(self) -> None:
        """temporale.__all__ should not contain private symbols."""
        import temporale

        all_list = temporale.__all__

        for name in all_list:
            # Allow __version__ which is a standard dunder
            if name == "__version__":
                continue
            assert not name.startswith(
                "_"
            ), f"Private symbol {name!r} should not be in __all__"

    def test_internal_module_not_exported(self) -> None:
        """_internal module should not be in top-level __all__."""
        import temporale

        all_list = temporale.__all__

        assert "_internal" not in all_list
        assert "decorators" not in all_list
        assert "deprecated" not in all_list
        assert "memoize" not in all_list
        assert "validate_range" not in all_list

    def test_private_infer_modules_not_exported(self) -> None:
        """Private infer submodules should not be in infer.__all__."""
        import temporale.infer

        all_list = temporale.infer.__all__

        # These are private implementation modules
        private_modules = ["_patterns", "_formats", "_relative", "_natural"]
        for module in private_modules:
            assert module not in all_list, f"{module!r} should not be exported"


class TestImportPatterns:
    """Test various import patterns work correctly."""

    def test_star_import_works(self) -> None:
        """from temporale import * should work and export expected symbols."""
        # We can't use 'from x import *' in a function, but we can simulate it
        import temporale

        exported_names: set[str] = set(temporale.__all__)

        # Check key exports are there
        assert "Date" in exported_names
        assert "DateTime" in exported_names
        assert "Duration" in exported_names
        assert "Period" in exported_names
        assert "Interval" in exported_names

    def test_submodule_import_works(self) -> None:
        """from temporale.core import X should work."""
        from temporale.core import Date, DateTime, Duration

        assert isinstance(Date, type)
        assert isinstance(DateTime, type)
        assert isinstance(Duration, type)

    def test_deep_import_works(self) -> None:
        """from temporale.format.iso8601 import X should work."""
        from temporale.format.iso8601 import parse_iso8601, format_iso8601

        assert callable(parse_iso8601)
        assert callable(format_iso8601)

    def test_all_submodules_importable(self) -> None:
        """All public submodules should be importable."""
        submodules = [
            "temporale.core",
            "temporale.units",
            "temporale.format",
            "temporale.convert",
            "temporale.arithmetic",
            "temporale.infer",
            "temporale.errors",
        ]

        for module_name in submodules:
            module = importlib.import_module(module_name)
            assert hasattr(
                module, "__all__"
            ), f"{module_name} should define __all__"


class TestFunctionalAPI:
    """Test that the API is functionally usable."""

    def test_datetime_now_works(self) -> None:
        """DateTime.now() should work from top-level import."""
        from temporale import DateTime

        now = DateTime.now()
        assert isinstance(now, DateTime)

    def test_basic_datetime_arithmetic(self) -> None:
        """Basic datetime arithmetic should work."""
        from temporale import DateTime, Duration

        dt = DateTime(2024, 1, 15, 12, 0, 0)
        d = Duration.from_hours(1)

        result = dt + d
        assert isinstance(result, DateTime)
        assert result.hour == 13

    def test_basic_date_period_arithmetic(self) -> None:
        """Basic date + period arithmetic should work."""
        from temporale import Date, Period

        d = Date(2024, 1, 31)
        p = Period(months=1)

        result = d + p
        assert isinstance(result, Date)
        # Should clamp to Feb 29 (2024 is leap year)
        assert result.month == 2
        assert result.day == 29

    def test_parsing_works(self) -> None:
        """ISO 8601 parsing should work from top-level import."""
        from temporale import parse_iso8601

        result = parse_iso8601("2024-01-15")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_fuzzy_parsing_works(self) -> None:
        """Fuzzy parsing should work from top-level import."""
        from temporale import parse_fuzzy

        result = parse_fuzzy("Jan 15, 2024")
        assert result.value.year == 2024
        assert result.value.month == 1
        assert result.value.day == 15

    def test_exception_handling_works(self) -> None:
        """Exception handling should work with imported exceptions."""
        from temporale import Date, ValidationError

        try:
            Date(2024, 13, 1)  # Invalid month
        except ValidationError as e:
            assert "month" in str(e).lower()
        else:
            raise AssertionError("Expected ValidationError")

    def test_interval_creation_works(self) -> None:
        """Interval creation should work from top-level import."""
        from temporale import Date, Interval

        start = Date(2024, 1, 1)
        end = Date(2024, 12, 31)

        interval = Interval(start, end)
        assert interval.start == start
        assert interval.end == end


class TestSubmoduleAllConsistency:
    """Test that submodule __all__ lists are consistent with their contents."""

    def _check_module_all_consistency(self, module_path: str) -> None:
        """Check that a module's __all__ contains only valid accessible names."""
        module = importlib.import_module(module_path)

        if not hasattr(module, "__all__"):
            return  # Some modules might not define __all__

        all_list: list[str] = module.__all__

        # Every name in __all__ should be an attribute
        for name in all_list:
            assert hasattr(
                module, name
            ), f"{name!r} in {module_path}.__all__ but not accessible as attribute"

    def test_format_iso8601_all_consistent(self) -> None:
        """temporale.format.iso8601.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.format.iso8601")

    def test_format_rfc3339_all_consistent(self) -> None:
        """temporale.format.rfc3339.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.format.rfc3339")

    def test_format_strftime_all_consistent(self) -> None:
        """temporale.format.strftime.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.format.strftime")

    def test_convert_json_all_consistent(self) -> None:
        """temporale.convert.json.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.convert.json")

    def test_convert_epoch_all_consistent(self) -> None:
        """temporale.convert.epoch.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.convert.epoch")

    def test_arithmetic_ops_all_consistent(self) -> None:
        """temporale.arithmetic.ops.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.arithmetic.ops")

    def test_arithmetic_comparisons_all_consistent(self) -> None:
        """temporale.arithmetic.comparisons.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.arithmetic.comparisons")

    def test_arithmetic_period_ops_all_consistent(self) -> None:
        """temporale.arithmetic.period_ops.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.arithmetic.period_ops")

    def test_core_date_all_consistent(self) -> None:
        """temporale.core.date.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.date")

    def test_core_time_all_consistent(self) -> None:
        """temporale.core.time.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.time")

    def test_core_datetime_all_consistent(self) -> None:
        """temporale.core.datetime.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.datetime")

    def test_core_duration_all_consistent(self) -> None:
        """temporale.core.duration.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.duration")

    def test_core_period_all_consistent(self) -> None:
        """temporale.core.period.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.period")

    def test_core_interval_all_consistent(self) -> None:
        """temporale.core.interval.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.core.interval")

    def test_units_era_all_consistent(self) -> None:
        """temporale.units.era.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.units.era")

    def test_units_timeunit_all_consistent(self) -> None:
        """temporale.units.timeunit.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.units.timeunit")

    def test_units_timezone_all_consistent(self) -> None:
        """temporale.units.timezone.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.units.timezone")

    def test_errors_all_consistent(self) -> None:
        """temporale.errors.__all__ should be consistent."""
        self._check_module_all_consistency("temporale.errors")
