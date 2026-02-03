import os
from sys import path


def calculate_tax(price):
    """Calculate tax for a given price."""
    return price * 0.08


def main():
    total = calculate_tax(100)
    print(total)


if __name__ == "__main__":
    main()
