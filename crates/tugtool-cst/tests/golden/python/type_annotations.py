# Type annotations for testing annotation collection.
from typing import List, Optional

def transform(items: List[str], count: int = 0) -> Optional[str]:
    result: str = ""
    for item in items:
        result += item
    return result if result else None
