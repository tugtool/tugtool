"""Temporal arithmetic operations.

This module provides functions for temporal arithmetic:
    - Addition and subtraction of durations
    - Comparison operations
    - Type-safe arithmetic between temporal types

The functions in this module serve as the canonical implementations
for temporal arithmetic. They provide explicit function-based APIs
that complement the operator-based APIs on the core classes.

Arithmetic Operations (from temporale.arithmetic.ops):
    - add: Add a Duration to a temporal type
    - subtract: Subtract durations or compute differences
    - multiply: Scale durations by integer scalars
    - divide: Divide durations by numeric scalars
    - floor_divide: Integer division for durations
    - negate: Return the negation of a duration
    - absolute: Return the absolute value of a duration

Comparison Operations (from temporale.arithmetic.comparisons):
    - equal, not_equal: Test equality/inequality
    - less_than, less_equal: Test ordering
    - greater_than, greater_equal: Test ordering
    - compare: Return -1, 0, or 1 for comparison
    - min_value, max_value: Find extremes
    - clamp: Constrain value to range
"""

from __future__ import annotations

from temporale.arithmetic.ops import (
    add,
    subtract,
    multiply,
    divide,
    floor_divide,
    negate,
    absolute,
)
from temporale.arithmetic.comparisons import (
    equal,
    not_equal,
    less_than,
    less_equal,
    greater_than,
    greater_equal,
    compare,
    min_value,
    max_value,
    clamp,
)

__all__ = [
    # Arithmetic operations
    "add",
    "subtract",
    "multiply",
    "divide",
    "floor_divide",
    "negate",
    "absolute",
    # Comparison operations
    "equal",
    "not_equal",
    "less_than",
    "less_equal",
    "greater_than",
    "greater_equal",
    "compare",
    "min_value",
    "max_value",
    "clamp",
]
