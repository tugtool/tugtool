"""Test fixture for class attribute renaming."""


class Configuration:
    """Configuration class with class and instance attributes."""

    # Class attribute
    default_timeout = 30

    def __init__(self, name):
        self.name = name
        self.timeout = Configuration.default_timeout

    def get_timeout(self):
        """Get the current timeout value."""
        return self.timeout

    def reset_timeout(self):
        """Reset timeout to default."""
        self.timeout = Configuration.default_timeout

    @classmethod
    def set_default_timeout(cls, value):
        """Set the default timeout for all instances."""
        cls.default_timeout = value


def configure_system():
    """Configure the system with custom timeout."""
    # Access class attribute
    print(f"Default timeout: {Configuration.default_timeout}")

    # Create instance
    config = Configuration("main")
    print(f"Instance timeout: {config.timeout}")

    # Modify class attribute
    Configuration.default_timeout = 60
    Configuration.set_default_timeout(90)


if __name__ == "__main__":
    configure_system()
