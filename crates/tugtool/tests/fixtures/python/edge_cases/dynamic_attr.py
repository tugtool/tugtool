"""Test fixture for dynamic attribute access patterns.

This file contains getattr/setattr patterns that should produce
warnings during rename operations.
"""


class DynamicHandler:
    """Handler with dynamic attribute access."""

    def __init__(self):
        self.process = lambda x: x * 2
        self.transform = lambda x: x + 1

    def __getattr__(self, name):
        """Dynamic attribute getter."""
        return getattr(self._fallback, name, None)

    def __setattr__(self, name, value):
        """Dynamic attribute setter."""
        if name.startswith("_"):
            object.__setattr__(self, name, value)
        else:
            setattr(self._storage, name, value)


def call_method_dynamically(obj, method_name):
    """Call a method on an object by name."""
    method = getattr(obj, method_name)
    return method()


def set_attribute_dynamically(obj, attr_name, value):
    """Set an attribute on an object by name."""
    setattr(obj, attr_name, value)


def access_via_globals():
    """Access a name via globals()."""
    return globals()["DynamicHandler"]


def access_via_locals():
    """Access a name via locals()."""
    process = lambda x: x
    return locals()["process"]


def execute_dynamic_code():
    """Execute dynamic code."""
    code = "result = process(42)"
    exec(code)
    return eval("result")


def main():
    handler = DynamicHandler()

    # Dynamic method access - should warn
    result = getattr(handler, "process")(5)
    print(f"Dynamic call result: {result}")

    # Dynamic attribute set - should warn
    setattr(handler, "custom_attr", "value")


if __name__ == "__main__":
    main()
