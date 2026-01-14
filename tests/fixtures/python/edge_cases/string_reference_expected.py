"""Test fixture for symbol names in string literals.

String literals containing the symbol name should NOT be renamed.
Only actual code references should be renamed.
"""


def compute_sum(items):
    """Calculate the total of all items."""
    return sum(items)


# String literals containing the function name - should NOT be renamed
HELP_TEXT = """
Usage: program [options]

Functions:
  calculate_total - Calculate the total of all items

Example:
  result = calculate_total([1, 2, 3])
"""

ERROR_MESSAGES = {
    "invalid_input": "Error in calculate_total: invalid input type",
    "empty_list": "calculate_total received an empty list",
}


def log_function_call(func_name: str, args):
    """Log a function call."""
    if func_name == "calculate_total":
        print(f"Calling calculate_total with {args}")


def get_function_by_name(name: str):
    """Get a function by its name string."""
    functions = {
        "calculate_total": compute_sum,
    }
    return functions.get(name)


def main():
    # Actual function call - should be renamed
    result = compute_sum([1, 2, 3, 4, 5])
    print(f"Total: {result}")

    # String reference - should NOT be renamed
    print(f"Function name: calculate_total")
    log_function_call("calculate_total", [1, 2, 3])


if __name__ == "__main__":
    main()
