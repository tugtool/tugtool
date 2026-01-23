#!/usr/bin/env python3
"""Aliased import scenario test runner."""

from pkg.utils import process_data as transformer
from pkg.main import run

def main():
    # Direct use with alias
    data = [1, 2, 3, 4, 5]
    result = transformer(data)
    print(f"Direct (aliased): {result}")

    # Via main module
    main_result = run()
    print(f"Via main: {main_result}")

if __name__ == "__main__":
    main()
