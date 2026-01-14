"""Test fixture for inheritance and method renaming in class hierarchies."""


class BaseHandler:
    """Base handler class."""

    def handle(self, request):
        """Handle a request."""
        return self.process_request(request)

    def process_request(self, request):
        """Process the request - to be overridden."""
        return {"status": "base", "request": request}


class JsonHandler(BaseHandler):
    """Handler for JSON requests."""

    def process_request(self, request):
        """Process JSON request."""
        import json
        return {"status": "json", "data": json.dumps(request)}


class XmlHandler(BaseHandler):
    """Handler for XML requests."""

    def process_request(self, request):
        """Process XML request."""
        return {"status": "xml", "data": f"<request>{request}</request>"}


def dispatch(handler: BaseHandler, request):
    """Dispatch a request to a handler."""
    return handler.process_request(request)


def main():
    handlers = [BaseHandler(), JsonHandler(), XmlHandler()]
    for handler in handlers:
        result = handler.process_request({"key": "value"})
        print(result)


if __name__ == "__main__":
    main()
