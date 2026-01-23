#!/usr/bin/env python3
"""Star import scenario test runner."""

from pkg import process_data, validate_data
from pkg.consumer import run

def main():
    # Direct use of imported symbols
    data = [1, 2, 3, 4, 5]
    if validate_data(data):
        result = process_data(data)
        print(f"Direct: {result}")

    # Via consumer module
    consumer_result = run()
    print(f"Consumer: {consumer_result}")

if __name__ == "__main__":
    main()
