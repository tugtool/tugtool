# Method calls for testing method call collection.
class Calculator:
    def add(self, a, b):
        return a + b

    def compute(self, x):
        result = self.add(x, x)
        return result.real
