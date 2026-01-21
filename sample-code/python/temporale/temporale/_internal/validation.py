"""Validation utilities for Temporale.

This module provides validation decorators and utilities for
ensuring temporal values are within valid ranges.

This module is not part of the public API.
"""

from __future__ import annotations

import functools
from typing import Callable, TypeVar, ParamSpec

from temporale._internal.constants import MIN_YEAR, MAX_YEAR
from temporale.errors import ValidationError

P = ParamSpec("P")
T = TypeVar("T")


def validate_range(
    **limits: tuple[int, int],
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """Decorator to validate that parameters are within specified ranges.

    This decorator validates named parameters against specified (min, max)
    ranges, raising ValidationError if any value is out of range.

    Args:
        **limits: Mapping of parameter names to (min, max) tuples.
                  Both min and max are inclusive.

    Returns:
        A decorator function.

    Examples:
        >>> @validate_range(month=(1, 12), day=(1, 31))
        ... def create_date(year: int, month: int, day: int) -> None:
        ...     pass

        >>> create_date(2024, 13, 1)  # Raises ValidationError
        Traceback (most recent call last):
        ...
        ValidationError: month must be between 1 and 12, got 13
    """

    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            # Get the function's parameter names
            import inspect

            sig = inspect.signature(func)
            param_names = list(sig.parameters.keys())

            # Build a dict of all argument values
            all_args = {}
            for i, arg in enumerate(args):
                if i < len(param_names):
                    all_args[param_names[i]] = arg
            all_args.update(kwargs)

            # Validate each specified limit
            for param_name, (min_val, max_val) in limits.items():
                if param_name in all_args:
                    value = all_args[param_name]
                    if value is not None and (value < min_val or value > max_val):
                        raise ValidationError(
                            f"{param_name} must be between {min_val} and {max_val}, "
                            f"got {value}"
                        )

            return func(*args, **kwargs)

        return wrapper

    return decorator


def validate_year(year: int) -> None:
    """Validate that a year is within the supported range.

    Args:
        year: The year to validate.

    Raises:
        ValidationError: If year is outside MIN_YEAR to MAX_YEAR.
    """
    if year < MIN_YEAR or year > MAX_YEAR:
        raise ValidationError(
            f"year must be between {MIN_YEAR} and {MAX_YEAR}, got {year}"
        )


def validate_month(month: int) -> None:
    """Validate that a month is within 1-12.

    Args:
        month: The month to validate.

    Raises:
        ValidationError: If month is outside 1-12.
    """
    if month < 1 or month > 12:
        raise ValidationError(f"month must be between 1 and 12, got {month}")


def validate_day(year: int, month: int, day: int) -> None:
    """Validate that a day is valid for the given year and month.

    Args:
        year: The year.
        month: The month (1-12).
        day: The day to validate.

    Raises:
        ValidationError: If day is invalid for the month.
    """
    from temporale._internal.calendar import days_in_month

    max_day = days_in_month(year, month)
    if day < 1 or day > max_day:
        raise ValidationError(
            f"day must be between 1 and {max_day} for {year}-{month:02d}, got {day}"
        )


__all__ = [
    "validate_range",
    "validate_year",
    "validate_month",
    "validate_day",
]
