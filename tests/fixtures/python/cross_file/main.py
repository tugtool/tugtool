"""Main module that uses utility functions."""

from utils import calculate_sum, calculate_average, format_result


def process_data(data):
    """Process data and print statistics."""
    total = calculate_sum(data)
    avg = calculate_average(data)

    print(f"Total: {format_result(total)}")
    print(f"Average: {format_result(avg)}")

    return total, avg


def main():
    numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    process_data(numbers)


if __name__ == "__main__":
    main()
