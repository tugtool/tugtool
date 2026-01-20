# Global and nonlocal declarations for testing scope modifiers.
counter = 0

def increment():
    global counter
    counter += 1

def make_counter():
    count = 0

    def inner():
        nonlocal count
        count += 1
        return count

    return inner
