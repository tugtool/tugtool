class DataProcessor:
    """A simple data processing class."""

    def __init__(self, name):
        self.name = name
        self.items = []

    def add_item(self, item):
        self.items.append(item)

    def process(self):
        return [x * 2 for x in self.items]


def main():
    processor = DataProcessor("test")
    processor.add_item(1)
    processor.add_item(2)
    processor.add_item(3)
    result = processor.process()
    print(f"{processor.name}: {result}")


if __name__ == "__main__":
    main()
