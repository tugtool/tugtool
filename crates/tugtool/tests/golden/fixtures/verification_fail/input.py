# A Python file that will cause verification failure after rename.
# The function name is used in a string that we can't statically detect.

def original_name():
    """Function to rename."""
    return 42


# This eval uses the function name as a string - won't be renamed
# and will cause runtime issues (not syntax errors though)
result = original_name()
