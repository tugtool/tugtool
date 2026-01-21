"""Pytest configuration and fixtures for Temporale tests."""

from __future__ import annotations

import sys
from pathlib import Path

# Add the parent directory to sys.path so temporale can be imported
# without needing to install the package
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))
