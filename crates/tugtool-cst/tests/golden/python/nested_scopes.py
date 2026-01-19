# Nested scopes for testing scope hierarchy.
def outer(x):
    y = x + 1

    def inner(z):
        return y + z

    return inner(x)
