# Dynamic patterns for testing dynamic pattern detection.
def unsafe_code():
    x = getattr(obj, name)
    setattr(obj, name, value)
    delattr(obj, name)
    code = "x = 1"
    eval(code)
    exec(code)
    vars()
    locals()
    globals()

class Magic:
    def __getattr__(self, name):
        return None
