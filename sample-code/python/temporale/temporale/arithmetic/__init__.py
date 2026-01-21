"""Temporal arithmetic operations.

This module provides functions for temporal arithmetic:
    - Addition and subtraction of durations
    - Comparison operations
    - Type-safe arithmetic between temporal types
    - Period arithmetic (calendar-based durations)

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

Period Operations (from temporale.arithmetic.period_ops):
    - add_period_to_date: Add a Period to a Date with clamping
    - subtract_period_from_date: Subtract a Period from a Date
    - add_period_to_datetime: Add a Period to a DateTime
    - subtract_period_from_datetime: Subtract a Period from a DateTime
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
from temporale.arithmetic.period_ops import (
    add_period_to_date,
    subtract_period_from_date,
    add_period_to_datetime,
    subtract_period_from_datetime,
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
    # Period operations
    "add_period_to_date",
    "subtract_period_from_date",
    "add_period_to_datetime",
    "subtract_period_from_datetime",
]
