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
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from score import CHECKS, flags, score  # noqa: E402

CORPUS = Path(__file__).parent / "corpus"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
# tugcast logs the normalized headline beside the raw answer; the two differing
# means the normalizer is covering for a prompt that has drifted.
ANSWER = re.compile(r'raw=(?P<raw>.*?) headline=(?P<headline>.*?)\s*$')


def log_path(instance: str) -> Path | None:
    """The instance's newest tugcast log.

    Picked by mtime rather than by today's date: tugcast names the file for the
    UTC day, so an evening run west of Greenwich computes yesterday's name and
    reads a log nothing is being written to.
    """
    logs = Path.home() / "Library/Application Support/Tug/instances" / instance / "Logs"
    candidates = sorted(logs.glob("tugcast.log.*"), key=lambda p: p.stat().st_mtime)
    return candidates[-1] if candidates else None


def answers(path: Path) -> list[tuple[str, str]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(errors="ignore").splitlines():
        line = ANSI.sub("", line)
        if "local model summarize answered" not in line:
            continue
        m = ANSWER.search(line)
        if m:
            out.append((m.group("raw").strip(), m.group("headline").strip()))
    return out


def ask(digest: str, instance: str, path: Path, timeout: float) -> tuple[str, str, int] | None:
    before = len(answers(path))
    started = time.monotonic()
    proc = subprocess.run(
        ["tugutil", "host", "tell", "local_model_summarize",
         "--instance", instance, "-p", f"prompt={digest}"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"  tell failed: {proc.stderr.strip() or proc.stdout.strip()}", file=sys.stderr)
        return None
    while time.monotonic() - started < timeout:
        time.sleep(0.2)
        got = answers(path)
        if len(got) > before:
            raw, headline = got[-1]
            return raw, headline, round((time.monotonic() - started) * 1000)
    return None


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
        rows.append(row)
        latencies.append(ms)
        drift = "  (raw: %s)" % raw if raw != headline else ""
        print(f'{name:24s} {row["words"]:2d}w [{flags(row)}] {headline}{drift}')

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
