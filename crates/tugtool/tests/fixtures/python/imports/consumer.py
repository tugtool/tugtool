"""Module that imports from base."""

from base import helper_function, BaseClass
from base import another_helper as add


def process(value):
    """Process a value using imported functions."""
    doubled = helper_function(value)
    summed = add(doubled, value)
    return summed


class DerivedClass(BaseClass):
    """A class derived from BaseClass."""

    def __init__(self, value, multiplier):
        super().__init__(value)
        self.multiplier = multiplier

    def compute(self):
        base_result = super().compute()
        return base_result * self.multiplier


def main():
    result = process(5)
    print(f"Process result: {result}")

    obj = DerivedClass(10, 3)
    print(f"Derived compute: {obj.compute()}")


if __name__ == "__main__":
    main()
