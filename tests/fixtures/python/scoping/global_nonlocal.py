"""Test fixture for global and nonlocal declarations."""


# Module-level counter
counter = 0


def increment_global():
    """Modify module-level counter using global."""
    global counter
    counter += 1
    return counter


def make_counter():
    """Create a closure with nonlocal state."""
    count = 0

    def increment():
        nonlocal count
        count += 1
        return count

    def get_count():
        # Read-only access (no nonlocal needed for reading)
        return count

    return increment, get_count


def nested_nonlocal():
    """Test nested nonlocal declarations."""
    outer_value = 10

    def middle():
        nonlocal outer_value
        outer_value += 5

        def inner():
            nonlocal outer_value
            outer_value += 1
            return outer_value

        inner()
        return outer_value

    return middle()


def main():
    global counter

    print(f"Initial counter: {counter}")
    increment_global()
    increment_global()
    print(f"After increments: {counter}")

    inc, get = make_counter()
    print(f"Closure count: {inc()}, {inc()}, {get()}")

    print(f"Nested nonlocal: {nested_nonlocal()}")


if __name__ == "__main__":
    main()
