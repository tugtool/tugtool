"""Era enumeration for BCE/CE designation.

This module provides the Era enum for distinguishing between
Before Common Era (BCE) and Common Era (CE) dates.
"""

from __future__ import annotations

from enum import Enum


class Era(Enum):
    """Historical era designation.

    The Era enum represents whether a date is in the Common Era (CE)
    or Before Common Era (BCE). Year 0 exists (astronomical convention)
    and is considered BCE.

    Examples:
        >>> era = Era.CE
        >>> era.is_before_common_era
        False

        >>> era = Era.BCE
        >>> era.is_before_common_era
        True
    """

    BCE = "BCE"  # Before Common Era
    CE = "CE"  # Common Era

    @property
    def is_before_common_era(self) -> bool:
        """Return True if this era is Before Common Era.

        Returns:
            True if this is Era.BCE, False if Era.CE.
        """
        return self == Era.BCE


__all__ = ["Era"]
