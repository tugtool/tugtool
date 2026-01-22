# Data processor module

from .utils import process_data, validate_input


class DataProcessor:
    """A processor that transforms data using utility functions."""

    def __init__(self, data: list):
        self.data = data
        self._processed = None

    def run(self) -> list:
        """Run the processor on the stored data."""
        if not validate_input(self.data):
            raise ValueError("Invalid input data")

        # Use process_data to transform the data
        self._processed = process_data(self.data)
        return self._processed

    def get_result(self) -> list:
        """Get the processed result, running if necessary."""
        if self._processed is None:
            self.run()
        return self._processed
