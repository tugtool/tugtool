# Multi-level relative import scenario: pkg/sub/consumer.py
# Uses .. to import from parent package

from ..utils import process_data

def run():
    data = [1, 2, 3]
    result = process_data(data)
    print(f"Processed: {result}")
    return result
