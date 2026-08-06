"""Score the SharedAgent's session headlines against a live Tug instance.

Drives the real thing end to end: the frozen digest goes over the control
socket to the running app, the app's own `LocalModelPrompts.summarize` and its
resident model answer, and tugcast normalizes the answer through
`headline_register` before logging it. What this scores is therefore the string
the PULSE strip would actually wear — prompt, model, and normalizer together —
not a re-implementation of any of them.

    just model-eval                 # against debug-main
    just model-eval release-main
    python3 run.py <instance> --retrospective

`--retrospective` drives the idle collapse's lane instead: the `.done.txt`
fixtures over the `summarize_done` task, scored against the past forms. The two
lanes are the same measurement of two different registers, so they share every
line of this file except which fixtures they read and which tense they expect.

Needs a running instance with the `pulse-overview`
tenant left on. Every headline is reported whether or not it passes; the summary
is a rate, not a gate, because a headline can satisfy every mechanical rule and
still describe the session badly. Read the lines.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ask, log_path  # noqa: E402
from score import CHECKS, flags, score  # noqa: E402

CORPUS = Path(__file__).parent / "corpus"
PROMPTS = Path(__file__).parents[2] / "tugapp/Sources/LocalModelService.swift"

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
    """The text's comparable words, dotted tokens contributing their parts too.

    `nocturne.css` yields `nocturne`, `css`, and itself, matching
    `content_words` in `session_overview.rs`: a digest writes filenames and a
    56-character headline has room to name one, so a check that only saw the
    dotted whole would call an example decontaminated because it wrote
    `nocturne` where the digest wrote `nocturne.css`.
    """
    out = set()
    for raw in text.translate(SPLIT).split():
        bare = raw.strip(TRIM).lower()
        out.add(stem(bare))
        if "." in bare:
            out.update(stem(part) for part in bare.split("."))
    return out - {""}


def _swift_literals(suffix: str) -> list[str]:
    """Every `static let <name>… = \"\"\"` multi-line literal whose name ends in
    `suffix`, case-insensitively on the first letter after it.

    Matched by suffix rather than by exact name so a per-pack profile's
    `lfmSummarize` is swept alongside the default's `summarize`: a profile's
    examples are answer keys in exactly the same way, and one that no check
    reads is one that can leak.

    Read out of the Swift source rather than duplicated here — a copy would be
    the thing that goes stale while reporting all is well, which is the failure
    this whole guard exists to catch. The cost is that a rename silently returns
    nothing, so callers must treat an empty result as a failure, never as a
    clean bill.
    """
    if not PROMPTS.exists():
        return []
    text = PROMPTS.read_text()
    out = []
    for m in re.finditer(r'static let (\w+) = """', text):
        name = m.group(1)
        if not name.lower().endswith(suffix.lower()):
            continue
        body = text[text.index("\n", m.start()) + 1:]
        out.append(body[: body.index('"""')])
    return out


def summarize_prompt() -> str:
    """The default profile's `summarize` text, for the drift report."""
    bodies = _swift_literals("summarize")
    return bodies[0] if bodies else ""


def headline_prompts() -> list[str]:
    """Every prompt that shows headline examples, across every profile: the
    live-intent `summarize` lane and the idle collapse's retrospective one."""
    return _swift_literals("summarize") + _swift_literals("summarizeRetrospective")


def example_lines() -> list[str]:
    """The bare headline examples in that prompt — the line after each
    `HEADLINE:` marker.

    Anchored on the marker rather than on the shape of the line, because the
    prompt's paired format puts one there and nothing else does. The version
    before this recognized an example by being 2-6 words long and opening on a
    known verb, which was the old six-word headline budget in disguise: at 56
    characters an example can run eight or nine words, and every one of those
    would have vanished from `lifted` and from `contamination` — the two checks
    this function feeds — while both kept reporting all clear.

    Widening the length bound was not the fix. That bound was doing a second
    job: keeping the instruction prose out, and some of that prose is itself
    short and verb-initial (`Not "Fixing", not "Building" — Fix, Build.`). The
    marker is exact where any length heuristic is a guess, and it needs no verb
    list at all, which is what lets the past-tense retrospective examples be
    read by the same code.
    """
    out = []
    for source in headline_prompts():
        lines = source.splitlines()
        for i, line in enumerate(lines[:-1]):
            if line.strip() == "HEADLINE:":
                example = lines[i + 1].strip()
                if example:
                    out.append(example)
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
    # Deduped on the pair: the same corpus entry has both a live digest and a
    # retrospective one, and reporting one leak twice reads as two leaks.
    hits: list[tuple[str, str]] = []
    examples = example_lines()
    for digest in digests:
        have = words(digest.read_text())
        name = digest.name.removesuffix(".digest.txt").removesuffix(".done.txt")
        for example in examples:
            subject = words(example) - words(example.split()[0])
            if subject and subject <= have and (example, name) not in hits:
                hits.append((example, name))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("instance", nargs="?", default="debug-main")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--json", type=Path, help="write the full result set here")
    ap.add_argument(
        "--retrospective",
        action="store_true",
        help="drive the idle collapse's past-tense lane over the .done.txt fixtures",
    )
    args = ap.parse_args()

    path = log_path(args.instance)
    if path is None:
        print(f"no tugcast log for instance {args.instance!r}", file=sys.stderr)
        return 2
    suffix = ".done.txt" if args.retrospective else ".digest.txt"
    digests = sorted(CORPUS.glob(f"*{suffix}"))
    if not digests:
        print("no corpus; run `cargo nextest run corpus_digests` first", file=sys.stderr)
        return 2

    # An extraction that finds nothing looks exactly like a clean bill, so the
    # guard checks itself first. A Swift rename is the way this goes silent.
    if not example_lines():
        print(
            "no prompt examples extracted from LocalModelService.swift — the\n"
            "`static let summarize` / `summarizeRetrospective` literals moved or\n"
            "the paired HEADLINE: format changed. The contamination guard is\n"
            "blind until this is fixed; it is not reporting that all is well.",
            file=sys.stderr,
        )
        return 2

    # Both lanes' fixtures: an example that is an answer key for a retrospective
    # digest is as much a leak as one for a live digest.
    leaks = contamination(digests + sorted(CORPUS.glob("*.done.txt")))
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
        name = digest_file.name.removesuffix(suffix)
        answer = ask(
            digest_file.read_text(), args.instance, path, args.timeout,
            retrospective=args.retrospective,
        )
        if answer is None:
            print(f"{name:24s} -- NO ANSWER")
            continue
        raw, headline, ms = answer
        row = score(headline, retrospective=args.retrospective)
        row["name"], row["raw"], row["ms"] = name, raw, ms
        # Which lane produced this row. The offline gate reads these captures
        # back and has to ground a retrospective in `Retrospective` mode against
        # the `.done.txt` fixture — scoring it as an intent would refuse every
        # past-tense opener that spells a tool name and report it as a finding.
        row["retrospective"] = args.retrospective
        row["lifted"] = lifted(headline)
        rows.append(row)
        latencies.append(ms)
        drift = "  (raw: %s)" % raw if raw != headline else ""
        copied = "  <- COPIED FROM THE PROMPT" if row["lifted"] else ""
        print(f'{name:24s} {row["chars"]:2d}c [{flags(row)}] {headline}{drift}{copied}')

    if not rows:
        print("\nnothing scored — is the instance running with a model installed?")
        return 1

    n = len(rows)
    print("\n" + "=" * 66)
    for check in CHECKS:
        passed = sum(r[check] for r in rows)
        print(f"  {check:16s} {passed:2d}/{n}")
    print(f'  {"all rules":16s} {sum(r["passes"] for r in rows):2d}/{n}')
    print(f'  {"mean chars":16s} {sum(r["chars"] for r in rows) / n:.1f}')
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
