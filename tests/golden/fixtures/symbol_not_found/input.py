# A Python file with no symbol at the target location.
# Used to test symbol_not_found error.

def helper():
    """A helper function far from line 999."""
    return 42


result = helper()
