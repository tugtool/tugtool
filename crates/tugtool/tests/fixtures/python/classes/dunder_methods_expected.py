"""Test fixture for dunder methods and regular methods."""


class Vector:
    """A 2D vector class with dunder methods."""

    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"Vector({self.x}, {self.y})"

    def __repr__(self):
        return f"Vector(x={self.x}, y={self.y})"

    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)

    def __eq__(self, other):
        return self.x == other.x and self.y == other.y

    def length(self):
        """Calculate the magnitude of the vector."""
        return (self.x ** 2 + self.y ** 2) ** 0.5

    def normalize(self):
        """Return a normalized version of this vector."""
        mag = self.length()
        if mag == 0:
            return Vector(0, 0)
        return Vector(self.x / mag, self.y / mag)

    def dot(self, other):
        """Calculate dot product with another vector."""
        return self.x * other.x + self.y * other.y


def compute_vectors():
    """Compute with vectors."""
    v1 = Vector(3, 4)
    v2 = Vector(1, 2)

    print(f"v1: {v1}")
    print(f"v1 magnitude: {v1.length()}")
    print(f"v1 normalized: {v1.normalize()}")
    print(f"v1 + v2: {v1 + v2}")
    print(f"v1 dot v2: {v1.dot(v2)}")


if __name__ == "__main__":
    compute_vectors()
