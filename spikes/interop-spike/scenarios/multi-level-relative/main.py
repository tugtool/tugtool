#!/usr/bin/env python3
"""Multi-level relative import scenario test runner."""

from pkg.utils import process_data
from pkg.sub.consumer import run

def main():
    # Direct use
    data = [1, 2, 3, 4, 5]
    result = process_data(data)
    print(f"Direct: {result}")

    # Via consumer module (uses multi-level relative import)
    consumer_result = run()
    print(f"Consumer: {consumer_result}")

if __name__ == "__main__":
    main()
