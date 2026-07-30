"""Score the local model's session headlines against a live Tug instance.

Drives the real thing end to end: the frozen digest goes over the control
socket to the running app, the app's own `LocalModelPrompts.summarize` and its
resident model answer, and tugcast normalizes the answer through
`headline_register` before logging it. What this scores is therefore the string
the PULSE strip would actually wear — prompt, model, and normalizer together —
not a re-implementation of any of them.

    just model-eval                 # against debug-main
    just model-eval release-main

Needs a running instance with a local model installed and the `pulse-overview`
tenant left on. Every headline is reported whether or not it passes; the summary
is a rate, not a gate, because a headline can satisfy every mechanical rule and
still describe the session badly. Read the lines.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ask, log_path  # noqa: E402
from score import CHECKS, flags, score  # noqa: E402

CORPUS = Path(__file__).parent / "corpus"
PROMPTS = Path(__file__).parents[2] / "tugapp/Sources/LocalModelService.swift"
VERBS = Path(__file__).parent / "verbs.txt"

# Punctuation to ignore when matching an example's words against a digest, so
# `tug-pulse.css` and `tug-pulse.css)` are the same word. Hyphens and slashes
# SPLIT rather than being trimmed: an example reading `command-line calculator`
# has to match a digest asking for a `command line calculator`, and the first
# version of this check missed exactly that pair.
TRIM = ".,:;!?\"'`()[]<>"
SPLIT = str.maketrans("-/_", "   ")


def stem(word: str) -> str:
    """A crude stem, enough that `restart` matches `restarts` and `resumed`.

    Deliberately blunt. A false match here costs one reworded example; a missed
    one costs a corpus that scores copying, which is the whole point. The first
    version compared surface forms and let `Fix download resume restart` through
    against a digest reading `the download restarts from zero when resumed`.
    """
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    return word.rstrip("e")


def words(text: str) -> set[str]:
    raw = text.translate(SPLIT).split()
    return {stem(w.strip(TRIM).lower()) for w in raw} - {""}


def summarize_prompt() -> str:
    """The shipping `summarize` instruction text, read out of the Swift source.

    Read rather than duplicated: a copy here would be the thing that goes stale
    while reporting that all is well, which is the failure this whole guard
    exists to catch.
    """
    if not PROMPTS.exists():
        return ""
    text = PROMPTS.read_text()
    start = text.find('static let summarize = """')
    if start < 0:
        return ""
    body = text[text.index("\n", start) + 1:]
    return body[: body.index('"""')]


def example_lines() -> list[str]:
    """The bare headline examples in that prompt.

    Recognized by shape rather than by position: a short line, no terminal
    punctuation, no line-continuation backslash, opening on a word from
    `verbs.txt`. That is the shape of an example and of nothing else in the
    block, so adding a rule or reordering the examples does not break this.
    """
    verbs = words(VERBS.read_text())
    out = []
    for line in summarize_prompt().splitlines():
        line = line.strip()
        if not line or line.endswith("\\") or line[-1] in ".:\"":
            continue
        parts = line.split()
        if 2 <= len(parts) <= 6 and parts[0].lower() in verbs:
            out.append(line)
    return out


def lifted(headline: str) -> str | None:
    """The prompt example this headline copied, if it copied one.

    Only meaningful because the examples are disjoint from the corpus (see
    `contamination`): with an answer key in the instructions a match would be
    indistinguishable from a correct answer, and with the key gone a match can
    only be a lift. That is the whole payoff of decontamination — the leak that
    was visible in production as `Fix download resume restart` against sessions
    about anything else becomes a thing this harness can name.

    Matched on the word set rather than the exact string, so a copy that drops a
    preposition or reorders is still caught.
    """
    have = words(headline)
    for example in example_lines():
        if have == words(example):
            return example
    return None


def contamination(digests: list[Path]) -> list[tuple[str, str]]:
    """Examples whose subject is a corpus digest — i.e. answer keys.

    An example is contaminated when every word of it except its opening verb
    appears somewhere in one digest. That digest's expected answer is then
    sitting in the instructions, and a model can score it by copying rather
    than by reading, which is how this harness once reported 13/13 over a
    prompt that was leaking into production. Scoring a contaminated corpus is
    worse than not scoring, so `run.py` refuses rather than warns.
    """
    hits = []
    for digest in digests:
        have = words(digest.read_text())
        for example in example_lines():
            subject = words(example) - words(example.split()[0])
            if subject and subject <= have:
                hits.append((example, digest.name.removesuffix(".digest.txt")))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("instance", nargs="?", default="debug-main")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--json", type=Path, help="write the full result set here")
    args = ap.parse_args()

    path = log_path(args.instance)
    if path is None:
        print(f"no tugcast log for instance {args.instance!r}", file=sys.stderr)
        return 2
    digests = sorted(CORPUS.glob("*.digest.txt"))
    if not digests:
        print("no corpus; run `cargo nextest run corpus_digests` first", file=sys.stderr)
        return 2

    leaks = contamination(digests)
    if leaks:
        print("CONTAMINATED — these prompt examples are answer keys:", file=sys.stderr)
        for example, name in leaks:
            print(f"  {example!r} is {name}'s subject", file=sys.stderr)
        print(
            "\nRewrite the example in LocalModelPrompts.summarize onto work no\n"
            "digest describes. A score over this pair measures copying.",
            file=sys.stderr,
        )
        return 2

    rows, latencies = [], []
    for digest_file in digests:
        name = digest_file.name.removesuffix(".digest.txt")
        answer = ask(digest_file.read_text(), args.instance, path, args.timeout)
        if answer is None:
            print(f"{name:24s} -- NO ANSWER")
            continue
        raw, headline, ms = answer
        row = score(headline)
        row["name"], row["raw"], row["ms"] = name, raw, ms
        row["lifted"] = lifted(headline)
        rows.append(row)
        latencies.append(ms)
        drift = "  (raw: %s)" % raw if raw != headline else ""
        copied = "  <- COPIED FROM THE PROMPT" if row["lifted"] else ""
        print(f'{name:24s} {row["words"]:2d}w [{flags(row)}] {headline}{drift}{copied}')

    if not rows:
        print("\nnothing scored — is the instance running with a model installed?")
        return 1

    n = len(rows)
    print("\n" + "=" * 66)
    for check in CHECKS:
        passed = sum(r[check] for r in rows)
        print(f"  {check:16s} {passed:2d}/{n}")
    print(f'  {"all rules":16s} {sum(r["passes"] for r in rows):2d}/{n}')
    print(f'  {"mean words":16s} {sum(r["words"] for r in rows) / n:.1f}')
    latencies.sort()
    print(f'  {"median ms":16s} {latencies[n // 2]}')
    copies = [r for r in rows if r["lifted"]]
    print(f'  {"copied examples":16s} {len(copies):2d}/{n}')
    if copies:
        print(f"\n  {len(copies)} headline(s) were copied out of the prompt's example")
        print("  block, not written from the digest — the examples are disjoint")
        print("  from the corpus, so a match here cannot be a correct answer:")
        for r in copies:
            print(f'    {r["name"]}: {r["headline"]!r}')

    drifted = [r for r in rows if r["raw"] != r["headline"]]
    if drifted:
        print(f'\n  {len(drifted)} headline(s) needed the normalizer — the prompt is')
        print("  drifting from the register it asks for:")
        for r in drifted:
            print(f'    {r["name"]}: {r["raw"]!r} -> {r["headline"]!r}')

    if args.json:
        args.json.write_text(json.dumps(rows, indent=1))
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
