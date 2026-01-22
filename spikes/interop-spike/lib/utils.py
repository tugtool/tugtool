# Utility functions


def process_data(data: list) -> list:
    """Process the input data and return transformed results."""
    result = []
    for item in data:
        if isinstance(item, dict):
            result.append({k: v * 2 for k, v in item.items()})
        elif isinstance(item, (int, float)):
            result.append(item * 2)
        else:
            result.append(item)
    return result


def validate_input(data: list) -> bool:
    """Validate that input is a non-empty list."""
    return isinstance(data, list) and len(data) > 0
