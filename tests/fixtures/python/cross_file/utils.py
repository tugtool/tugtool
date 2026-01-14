"""Utility functions for cross-file rename testing."""


def calculate_sum(numbers):
    """Calculate the sum of a list of numbers."""
    return sum(numbers)


def calculate_average(numbers):
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0
    return calculate_sum(numbers) / len(numbers)


def format_result(value, precision=2):
    """Format a numeric result with given precision."""
    return f"{value:.{precision}f}"
