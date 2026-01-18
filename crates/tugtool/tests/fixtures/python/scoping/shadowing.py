"""Test fixture for name shadowing scenarios."""


# Module-level name
value = 100


def outer_function():
    # Shadows module-level 'value'
    value = 200

    def inner_function():
        # Shadows outer 'value'
        value = 300
        return value

    return value + inner_function()


def no_shadow():
    # Uses module-level 'value' (no shadowing)
    return value * 2


class Container:
    # Class attribute shadows module-level
    value = 400

    def get_value(self):
        # Uses class attribute via self
        return self.value

    def get_module_value(self):
        # Explicit module reference would be needed
        # This returns class attribute due to Python rules
        return self.value


def main():
    print(f"Module value: {value}")
    print(f"outer_function: {outer_function()}")
    print(f"no_shadow: {no_shadow()}")
    print(f"Container.value: {Container.value}")
    c = Container()
    print(f"c.get_value: {c.get_value()}")


if __name__ == "__main__":
    main()
