"""Internal utilities for Temporale.

This module contains private implementation details:
    - Validation decorators
    - Constants and magic numbers
    - Helper functions
    - Custom decorators (@deprecated, @memoize)

Note: This module is not part of the public API.
"""

from __future__ import annotations

from temporale._internal.decorators import deprecated, memoize
from temporale._internal.validation import (
    validate_day,
    validate_month,
    validate_range,
    validate_year,
)

__all__: list[str] = [
    "deprecated",
    "memoize",
    "validate_day",
    "validate_month",
    "validate_range",
    "validate_year",
]
