def calculate(items):
    """Calculate a result from a list of items."""
    result = sum(items) + 100
    return result


def main():
    data = [1, 2, 3, 4, 5]
    value = calculate(data)
    print(value)


if __name__ == "__main__":
    main()
