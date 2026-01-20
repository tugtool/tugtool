# Class with inheritance for testing class analysis.
class Animal:
    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "woof"

    def fetch(self, item):
        return item
