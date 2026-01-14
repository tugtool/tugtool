"""Test fixture for inheritance and method renaming in class hierarchies."""


class BaseHandler:
    """Base handler class."""

    def handle(self, request):
        """Handle a request."""
        return self.handle_request(request)

    def handle_request(self, request):
        """Process the request - to be overridden."""
        return {"status": "base", "request": request}


class JsonHandler(BaseHandler):
    """Handler for JSON requests."""

    def handle_request(self, request):
        """Process JSON request."""
        import json
        return {"status": "json", "data": json.dumps(request)}


class XmlHandler(BaseHandler):
    """Handler for XML requests."""

    def handle_request(self, request):
        """Process XML request."""
        return {"status": "xml", "data": f"<request>{request}</request>"}


def dispatch(handler: BaseHandler, request):
    """Dispatch a request to a handler."""
    return handler.handle_request(request)


def main():
    handlers = [BaseHandler(), JsonHandler(), XmlHandler()]
    for handler in handlers:
        result = handler.handle_request({"key": "value"})
        print(result)


if __name__ == "__main__":
    main()
