#!/usr/bin/env python3
"""Main entry point for the data processing application."""

from lib import process_data
from lib.processor import DataProcessor


def main():
    # Sample data to process
    sample_data = [1, 2, 3, {"a": 10, "b": 20}, 4.5]

    # Method 1: Direct function call
    print("Direct call:")
    result1 = process_data(sample_data)
    print(f"  Input:  {sample_data}")
    print(f"  Output: {result1}")

    # Method 2: Using the processor class
    print("\nUsing DataProcessor:")
    processor = DataProcessor(sample_data)
    result2 = processor.run()
    print(f"  Input:  {sample_data}")
    print(f"  Output: {result2}")


if __name__ == "__main__":
    main()
