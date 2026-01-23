# Star import scenario: pkg/base.py
# This module defines the functions that will be exported via star import

def process_data(data):
    """Process the input data."""
    return [x * 2 for x in data]

def validate_data(data):
    """Validate the input data."""
    return isinstance(data, list) and len(data) > 0
