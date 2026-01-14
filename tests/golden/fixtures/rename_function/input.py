def process_data(items):
    """Process a list of items and return results."""
    results = []
    for item in items:
        results.append(item * 2)
    return results


def main():
    data = [1, 2, 3, 4, 5]
    output = process_data(data)
    print(output)


if __name__ == "__main__":
    main()
