# Reexport chain scenario: pkg/internal.py
# Re-exports from core module (an intermediate re-export)
from .core import process_data

__all__ = ['transform_data']
