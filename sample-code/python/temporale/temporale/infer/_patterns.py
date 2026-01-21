"""Format pattern detection for date/time inference.

This module provides the core pattern detection logic that examines
input strings and identifies which format templates match.

Internal module - use parse_fuzzy() from temporale.infer instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from temporale.infer._formats import (
    AMBIGUOUS_DATE_TEMPLATES,
    DATE_TEMPLATES,
    DATETIME_TEMPLATES,
    TIME_TEMPLATES,
    FormatKind,
    FormatTemplate,
    get_dash_date_extractor,
    get_slash_date_extractor,
)

if TYPE_CHECKING:
    import re


@dataclass
class PatternMatch:
    """Result of a pattern match attempt.

    Attributes:
        template: The format template that matched.
        match: The regex match object.
        components: Extracted date/time components.
        confidence: Confidence score adjusted for match quality.
    """

    template: FormatTemplate
    match: re.Match[str]
    components: dict[str, int | str | None]
    confidence: float


def detect_format(text: str, date_order: str = "YMD") -> list[PatternMatch]:
    """Detect all matching format patterns for the given text.

    Attempts to match the input against all known format templates
    and returns a list of successful matches sorted by confidence.

    Args:
        text: The string to analyze.
        date_order: Order for ambiguous dates ("YMD", "MDY", or "DMY").

    Returns:
        List of PatternMatch objects, sorted by confidence (highest first).
    """
    text = text.strip()
    if not text:
        return []

    matches: list[PatternMatch] = []

    # Try datetime templates first (most specific)
    for template in DATETIME_TEMPLATES:
        match = template.pattern.match(text)
        if match:
            try:
                components = template.extractor(match)
                # Validate month name was resolved
                if components.get("month") is None:
                    continue
                confidence = _adjust_confidence(template, components)
                matches.append(
                    PatternMatch(
                        template=template,
                        match=match,
                        components=components,
                        confidence=confidence,
                    )
                )
            except (ValueError, TypeError):
                continue

    # Try date templates
    for template in DATE_TEMPLATES:
        match = template.pattern.match(text)
        if match:
            try:
                components = template.extractor(match)
                # Validate month name was resolved
                if components.get("month") is None:
                    continue
                confidence = _adjust_confidence(template, components)
                matches.append(
                    PatternMatch(
                        template=template,
                        match=match,
                        components=components,
                        confidence=confidence,
                    )
                )
            except (ValueError, TypeError):
                continue

    # Try ambiguous date templates with configured date order
    slash_template = AMBIGUOUS_DATE_TEMPLATES["slash"]
    slash_match = slash_template.pattern.match(text)
    if slash_match:
        try:
            extractor = get_slash_date_extractor(date_order)
            components = extractor(slash_match)
            # Boost confidence if format is unambiguous (has 4-digit year at start)
            confidence = slash_template.confidence
            g1 = slash_match.group(1)
            if len(g1) == 4:
                confidence = 0.95  # Clearly YMD
            matches.append(
                PatternMatch(
                    template=slash_template,
                    match=slash_match,
                    components=components,
                    confidence=confidence,
                )
            )
        except (ValueError, TypeError):
            pass

    dash_template = AMBIGUOUS_DATE_TEMPLATES["dash"]
    dash_match = dash_template.pattern.match(text)
    if dash_match:
        try:
            extractor = get_dash_date_extractor(date_order)
            components = extractor(dash_match)
            matches.append(
                PatternMatch(
                    template=dash_template,
                    match=dash_match,
                    components=components,
                    confidence=dash_template.confidence,
                )
            )
        except (ValueError, TypeError):
            pass

    # Try time templates
    for template in TIME_TEMPLATES:
        match = template.pattern.match(text)
        if match:
            try:
                components = template.extractor(match)
                confidence = _adjust_confidence(template, components)
                matches.append(
                    PatternMatch(
                        template=template,
                        match=match,
                        components=components,
                        confidence=confidence,
                    )
                )
            except (ValueError, TypeError):
                continue

    # Sort by confidence (highest first)
    matches.sort(key=lambda m: m.confidence, reverse=True)

    return matches


def _adjust_confidence(
    template: FormatTemplate,
    components: dict[str, int | str | None],
) -> float:
    """Adjust confidence based on extracted component validity.

    Reduces confidence for:
    - Invalid month values
    - Invalid day values
    - Invalid hour values
    - 2-digit years
    """
    confidence = template.confidence

    # Check date components
    month = components.get("month")
    if month is not None:
        if not (1 <= month <= 12):  # type: ignore[operator]
            confidence *= 0.5

    day = components.get("day")
    if day is not None:
        if not (1 <= day <= 31):  # type: ignore[operator]
            confidence *= 0.5

    # Check time components
    hour = components.get("hour")
    if hour is not None:
        if not (0 <= hour <= 23):  # type: ignore[operator]
            confidence *= 0.5

    minute = components.get("minute")
    if minute is not None:
        if not (0 <= minute <= 59):  # type: ignore[operator]
            confidence *= 0.5

    second = components.get("second")
    if second is not None:
        if not (0 <= second <= 59):  # type: ignore[operator]
            confidence *= 0.5

    # Lower confidence for 2-digit years
    year = components.get("year")
    if year is not None and 0 <= year <= 99:  # type: ignore[operator]
        confidence *= 0.9

    return confidence


def classify_input(text: str) -> FormatKind | None:
    """Quickly classify input as date, time, or datetime.

    This is a heuristic classification that doesn't fully parse
    the input, just determines its likely type.

    Args:
        text: The string to classify.

    Returns:
        FormatKind.DATE, FormatKind.TIME, FormatKind.DATETIME, or None.
    """
    text = text.strip()
    if not text:
        return None

    has_date_dash = "-" in text and text.count("-") >= 2
    has_date_slash = "/" in text
    has_date_dot = "." in text and not text.replace(".", "").isdigit()
    has_colon = ":" in text
    has_alpha = any(c.isalpha() for c in text)
    has_t_or_space = "T" in text or "t" in text or (" " in text and has_colon)

    # DateTime: has both date and time indicators
    if has_t_or_space:
        return FormatKind.DATETIME

    # Check for named month datetime (e.g., "Jan 15, 2024 2:30 PM")
    if has_alpha and has_colon:
        return FormatKind.DATETIME

    # Time only: has colon but no date separators
    if has_colon and not (has_date_dash or has_date_slash or has_alpha):
        return FormatKind.TIME

    # Date: has date separators or named month
    if has_date_dash or has_date_slash or has_date_dot or has_alpha:
        return FormatKind.DATE

    return None


__all__ = [
    "PatternMatch",
    "detect_format",
    "classify_input",
]
