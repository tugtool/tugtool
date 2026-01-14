"""Test fixture for method renaming."""


class DataProcessor:
    """A class that processes data."""

    def __init__(self, data):
        self.data = data

    def process(self):
        """Process the data and return results."""
        return [x * 2 for x in self.data]

    def summarize(self):
        """Summarize the processed data."""
        processed = self.process()
        return sum(processed)


def main():
    processor = DataProcessor([1, 2, 3, 4, 5])
    result = processor.process()
    summary = processor.summarize()
    print(f"Processed: {result}, Summary: {summary}")


if __name__ == "__main__":
    main()
