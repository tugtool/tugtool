# Star import scenario: pkg/consumer.py
# This module uses star import to get all symbols

from .base import *

def run():
    data = [1, 2, 3]
    if validate_data(data):
        result = process_data(data)
        print(f"Processed: {result}")
        return result
    return None
