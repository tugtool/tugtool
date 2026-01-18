"""Test fixture for symbol names in comments.

Comments containing the symbol name should NOT be renamed.
Only actual code references should be renamed.
"""


# The validate_input function checks if input is valid
# See also: validate_input in the utils module
def check_input(data):
    """Validate input data.

    This function (validate_input) performs the following checks:
    - Type checking
    - Range validation
    - Format verification

    Note: validate_input should be called before any processing.
    """
    if data is None:
        return False
    if not isinstance(data, (list, dict, str)):
        return False
    return True


def process_data(data):
    """Process data after validation.

    Args:
        data: The data to process

    Note:
        Always call validate_input before process_data.
        The validate_input function ensures data is safe to process.
    """
    # First, validate_input is called to check the data
    if not check_input(data):  # validate_input returns bool
        raise ValueError("Invalid data")

    # validate_input passed, now process
    return {"processed": True, "data": data}


def main():
    # Test validate_input with various inputs
    # validate_input should return True for valid data
    test_data = [1, 2, 3]

    # Call validate_input to check
    if check_input(test_data):
        result = process_data(test_data)
        print(result)


if __name__ == "__main__":
    main()
