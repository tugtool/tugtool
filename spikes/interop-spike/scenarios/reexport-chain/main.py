#!/usr/bin/env python3
"""Reexport chain scenario test runner."""

# This imports process_data which goes through:
# pkg -> pkg.internal -> pkg.core
from pkg import process_data

def main():
    data = [1, 2, 3, 4, 5]
    result = process_data(data)
    print(f"Result: {result}")

if __name__ == "__main__":
    main()
