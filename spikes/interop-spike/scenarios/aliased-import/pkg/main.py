# Aliased import scenario: pkg/main.py
# This module imports process_data with an alias

from .utils import process_data as proc

def run():
    data = [1, 2, 3]
    # Use the alias - should still be renamed if the original is renamed
    result = proc(data)
    print(f"Processed: {result}")
    return result
