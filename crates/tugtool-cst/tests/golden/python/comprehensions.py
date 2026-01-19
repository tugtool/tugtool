# Comprehensions for testing comprehension scopes.
squares = [x * x for x in range(10)]
evens = {x for x in range(10) if x % 2 == 0}
pairs = {x: x * 2 for x in range(5)}
gen = (x + 1 for x in range(3))
