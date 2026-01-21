"""Custom decorators for Temporale.

This module provides decorator utilities for the library:
    - @deprecated(message): Mark functions as deprecated with warnings
    - @memoize: Simple memoization decorator

These decorators serve as refactoring targets (see Table T01 in plan).
This module is not part of the public API.
"""

from __future__ import annotations

import functools
import warnings
from typing import Callable, TypeVar, ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


def deprecated(message: str) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """Mark a function as deprecated with a warning message.

    This is a parameterized decorator that emits a DeprecationWarning
    when the decorated function is called.

    Args:
        message: The deprecation message explaining what to use instead.

    Returns:
        A decorator function.

    Examples:
        >>> @deprecated("Use DateTime.now() instead")
        ... def current_time():
        ...     return DateTime.now()

        >>> current_time()  # Emits DeprecationWarning
    """

    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            warnings.warn(
                f"{func.__name__} is deprecated: {message}",
                DeprecationWarning,
                stacklevel=2,
            )
            return func(*args, **kwargs)

        # Mark the wrapper as deprecated for introspection
        wrapper._deprecated = True  # type: ignore[attr-defined]
        wrapper._deprecation_message = message  # type: ignore[attr-defined]
        return wrapper

    return decorator


def memoize(func: Callable[P, T]) -> Callable[P, T]:
    """Simple memoization decorator for functions with hashable arguments.

    This decorator caches the results of function calls based on the
    arguments passed. Useful for expensive computations that are
    called multiple times with the same arguments.

    Note: Arguments must be hashable. For complex caching needs,
    use functools.lru_cache instead.

    Args:
        func: The function to memoize.

    Returns:
        A memoized version of the function.

    Examples:
        >>> @memoize
        ... def expensive_calculation(n: int) -> int:
        ...     return n ** 2
    """
    cache: dict[tuple, T] = {}

    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        # Create a hashable key from args and kwargs
        key = (args, tuple(sorted(kwargs.items())))
        if key not in cache:
            cache[key] = func(*args, **kwargs)
        return cache[key]

    # Expose cache for testing/introspection
    wrapper._cache = cache  # type: ignore[attr-defined]
    wrapper._clear_cache = cache.clear  # type: ignore[attr-defined]
    return wrapper


__all__ = [
    "deprecated",
    "memoize",
]
