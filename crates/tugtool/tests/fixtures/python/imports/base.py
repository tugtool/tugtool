"""Base module with functions to be imported."""


def helper_function(x):
    """A helper function used by other modules."""
    return x * 2


def another_helper(x, y):
    """Another helper function."""
    return x + y


class BaseClass:
    """A base class for inheritance testing."""

    def __init__(self, value):
        self.value = value

    def compute(self):
        return helper_function(self.value)
