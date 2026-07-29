"""Score one headline against the register the PULSE strip is written in.

The rubric is mechanical on purpose. There is no ground truth for "what is this
session working on" — two correct headlines can share no words — so nothing here
scores whether a headline is *right*. It scores whether it is a headline at all,
which is the part that kept going wrong.

Every check traces to a rule of newspaper headline register:

  verb_first    A headline needs a verb; a noun phrase without one is a *label*,
                which is the failure this whole rubric exists to catch. Sessions
                have no subject to name (the session is the implied subject), so
                the verb leads, in the plain command form.
  within_budget Six words. Compression is the register's defining constraint.
  no_article    "a", "an", "the" are dropped.
  no_and        "and" gives way to a comma, or the second half is cut.
  sentence_case Only the first word and proper names are capitalized.

`verbs.txt` is a closed list, so a headline opening with a word not on it scores
as a miss and gets read by a human — a model inventing a plausible verb should
cost a look, not pass silently. Add genuinely good verbs to the list; that is
the intended way for it to grow.
"""

import re
from pathlib import Path

VERBS = {
    word.lower()
    for line in (Path(__file__).parent / "verbs.txt").read_text().splitlines()
    if not line.lstrip().startswith("#")
    for word in line.split()
}

ARTICLE = re.compile(r"\b(the|a|an)\b", re.I)
AND = re.compile(r"\band\b", re.I)
MAX_WORDS = 6

# A capitalized word mid-headline is only a violation if it is ordinary prose.
# Identifiers and proper names legitimately keep their capitals, so anything
# that looks like one is exempt: an interior capital (`TugSetup`), all caps
# (`README`), or a dotted path (`session_overview.rs`).
IDENTIFIER = re.compile(r"[a-z][A-Z]|\.")
PROPER = {
    "Lens", "Tug", "Rust", "Swift", "Claude", "Sparkle", "Bonsai", "MLX",
    "Maxwell", "Maxwell's", "Makefile", "README", "PATH", "CPU", "Xcode",
    # This project's own surfaces, which a headline about it names constantly.
    "Tugdeck", "Tugcast", "Tugcode", "Tugbank", "Tugways", "Tugutil",
    "TugSetup", "Session", "Snippets", "Changeset", "DMG", "WAL", "JSONL",
}


def score(headline: str) -> dict:
    words = headline.split()
    if not words:
        return {
            "headline": headline, "words": 0, "verb_first": False,
            "within_budget": True, "no_article": True, "no_and": True,
            "sentence_case": True, "passes": False,
        }

    first = re.sub(r"[^A-Za-z-]", "", words[0]).lower()

    def is_proper(word: str) -> bool:
        core = word.strip(",.;:!?")
        return core in PROPER or core.isupper() or bool(IDENTIFIER.search(core))

    stray_capitals = [w for w in words[1:] if w[:1].isupper() and not is_proper(w)]

    result = {
        "headline": headline,
        "words": len(words),
        "verb_first": first in VERBS,
        "within_budget": len(words) <= MAX_WORDS,
        "no_article": not ARTICLE.search(headline),
        "no_and": not AND.search(headline),
        "sentence_case": not stray_capitals,
    }
    result["passes"] = all(
        result[k] for k in
        ("verb_first", "within_budget", "no_article", "no_and", "sentence_case")
    )
    return result


CHECKS = ("verb_first", "within_budget", "no_article", "no_and", "sentence_case")


def flags(result: dict) -> str:
    """A five-slot summary, one letter per failed check."""
    return "".join(
        "." if result[k] else letter
        for k, letter in zip(CHECKS, "VBA&C")
    )
