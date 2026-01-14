"""Test fixture for decorated functions and classes.

Decorators should be handled correctly during rename:
- Decorator function names can be renamed
- Decorated function names can be renamed
- Both decorator and decorated should track references correctly
"""

from functools import wraps


def log_calls(func):
    """Decorator that logs function calls."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__}")
        result = func(*args, **kwargs)
        print(f"Finished {func.__name__}")
        return result
    return wrapper


def validate_args(func):
    """Decorator that validates function arguments."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        for arg in args:
            if arg is None:
                raise ValueError("None argument not allowed")
        return func(*args, **kwargs)
    return wrapper


@log_calls
def process_item(item):
    """Process a single item."""
    return item * 2


@log_calls
@validate_args
def process_batch(items):
    """Process a batch of items."""
    return [process_item(item) for item in items]


@log_calls
class DataProcessor:
    """A decorated class for processing data."""

    def __init__(self, name):
        self.name = name

    @log_calls
    def process(self, data):
        """Process data with logging."""
        return [x * 2 for x in data]


def main():
    # Call decorated functions
    result = process_item(5)
    print(f"Single item: {result}")

    batch_result = process_batch([1, 2, 3])
    print(f"Batch: {batch_result}")

    # Use decorated class
    processor = DataProcessor("main")
    data = processor.process([4, 5, 6])
    print(f"Processor output: {data}")


if __name__ == "__main__":
    main()
