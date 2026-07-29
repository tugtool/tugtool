"""What accumulated logs say about the local model: how fast, how often it fails.

Reads every `tugapp.log.*` and `tugcast.log.*` in one instance's `Logs/`
directory and reports the questions nobody can answer by reading a log
directly — per-task outcome counts, duration percentiles, how often the register
normalizer had to step in, and how often the headline actually changed.

    just model-stats
    just model-stats release-main
    python3 tests/model-eval/analyze.py debug-main --since 2026-07-01

There are no counters in the running system and no rollup lines. Per-request
lines accumulate, and this reads them whenever there is enough to read — which
is what makes the aggregation rewritable without redeploying anything.

Two perspectives are reported separately because neither can see the other's
fact. The service-side line (`tugapp`) knows what inference cost; the
caller-side line (`tugcast`) knows whether the caller gave up. A slow success
and a timeout look identical from the service's side.

    python3 tests/model-eval/analyze.py --self-test
"""

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ANSI, INSTANCES  # noqa: E402

# Both files use tuglog's default `fmt::layer()` shape, which is the whole point
# of the app writing its own file in that format rather than to Console:
#
#   <ISO8601-UTC>  <LEVEL> <target>: <message> <field>=<value> …
LINE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}T\S+?Z)\s+(?P<level>\w+)\s+(?P<target>[\w:]+): (?P<rest>.*)$"
)

# Values are space-free for every field this reads. Older lines quote their
# string values (tracing's debug formatting, before the caller-side line moved
# to display formatting), so the quotes come off here and accumulated logs
# spanning that change still parse.
FIELD = re.compile(r'(\w+)=("[^"]*"|\S+)')

# Kept in step with `Table T01` in the plan and the constants it names:
# `CLASSIFY_SLOW`/`CLASSIFY_TIMEOUT`/`SUMMARIZE_SLOW`/`SUMMARIZE_TIMEOUT` in
# `tugrust/crates/tugcast/src/local_model.rs`. All provisional — moving them
# from this report's own output is the reason it exists.
BOUNDS = {
    "classify": (1_000, 2_000),
    "summarize": (3_000, 6_000),
}

# The deck's own give-up, from `LOCAL_MODEL_TIMEOUT_MS` in
# `tugdeck/src/lib/local-model-bridge.ts`. A bridge classify that ran longer was
# answered too late to be used, and the deck does not log that itself.
BRIDGE_DEADLINE_MS = 2_000


def parse(line: str) -> tuple[str, str, dict[str, str]] | None:
    """One log line as (target, message-with-fields, fields), or None."""
    m = LINE.match(ANSI.sub("", line).rstrip())
    if not m:
        return None
    rest = m.group("rest")
    fields = {k: v.strip('"') for k, v in FIELD.findall(rest)}
    fields["_ts"] = m.group("ts")
    return m.group("target"), rest, fields


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(int(len(ordered) * fraction), len(ordered) - 1)]


def read(logs: Path, since: str | None) -> tuple[list[tuple[str, str, dict]], dict[str, int]]:
    """Every parsed line from both log families, and a per-file parsed count.

    The counts are reported so a format drift shows up as a zero rather than as
    silence — one regex reads both files, and a mismatch would otherwise drop
    half the data quietly.
    """
    parsed, counts = [], {}
    for path in sorted(logs.glob("tugapp.log.*")) + sorted(logs.glob("tugcast.log.*")):
        n = 0
        for line in path.read_text(errors="ignore").splitlines():
            got = parse(line)
            if got is None:
                continue
            if since and got[2]["_ts"][:10] < since:
                continue
            parsed.append(got)
            n += 1
        counts[path.name] = n
    return parsed, counts


def report_turnaround(title: str, rows: list[dict]) -> None:
    print(f"\n{title}")
    if not rows:
        print("  (none)")
        return
    by_task = defaultdict(list)
    for row in rows:
        by_task[row.get("task", "?")].append(row)
    for task in sorted(by_task):
        entries = by_task[task]
        times = [int(e["elapsed_ms"]) for e in entries if e.get("elapsed_ms", "").isdigit()]
        outcomes = Counter(e.get("outcome", "?") for e in entries)
        slow_at, ceiling = BOUNDS.get(task, (None, None))
        print(f"  {task}  attempts={len(entries)}")
        print("    outcomes: " + ", ".join(f"{k}={v}" for k, v in sorted(outcomes.items())))
        if times:
            print(
                f"    elapsed_ms: p50={percentile(times, 0.5)}"
                f" p90={percentile(times, 0.9)} max={max(times)}"
            )
        if slow_at is not None:
            over_slow = sum(1 for t in times if t > slow_at)
            over_ceiling = sum(1 for t in times if t > ceiling)
            print(
                f"    over slow ({slow_at}ms): {over_slow}"
                f"   over ceiling ({ceiling}ms): {over_ceiling}"
            )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("instance", nargs="?", default="debug-main")
    ap.add_argument("--since", metavar="YYYY-MM-DD", help="ignore lines before this UTC date")
    ap.add_argument("--self-test", action="store_true", help="check the parser and exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    logs = INSTANCES / args.instance / "Logs"
    if not logs.is_dir():
        print(f"no Logs directory for instance {args.instance!r} at {logs}", file=sys.stderr)
        return 2

    parsed, counts = read(logs, args.since)

    print(f"instance: {args.instance}")
    if args.since:
        print(f"since:    {args.since}")
    print("\nparsed lines per file")
    for name, n in counts.items():
        print(f"  {name:28s} {n}")

    service = [f for t, _, f in parsed if t == "tugapp::local_model"]
    caller = [f for t, _, f in parsed if t == "tugcast::local_model" and "outcome" in f]

    report_turnaround("service side (what inference cost)", service)
    report_turnaround("caller side (what the caller waited for)", caller)

    # A bridge classify that overran the deck's deadline was answered too late
    # to be used. Only the service-side line sees this traffic at all.
    late = [
        f for f in service
        if f.get("task") == "classify"
        and f.get("transport") == "bridge"
        and f.get("elapsed_ms", "").isdigit()
        and int(f["elapsed_ms"]) > BRIDGE_DEADLINE_MS
    ]
    bridge_classifies = [
        f for f in service if f.get("task") == "classify" and f.get("transport") == "bridge"
    ]
    print(f"\nbridge classify answered past the deck's {BRIDGE_DEADLINE_MS}ms give-up")
    print(f"  {len(late)} of {len(bridge_classifies)}")

    # The normalizer's work rate: how often the register had to be imposed
    # rather than written. A trim means the model wrote a parts list; a clip
    # means it wrote prose.
    normalized = [f for _, rest, f in parsed if "normalized" in f and "summar" in rest]
    print("\nnormalizer work rate over summarize answers")
    if not normalized:
        print("  (no answers carrying the report fields yet)")
    else:
        n = len(normalized)
        for flag in ("normalized", "trimmed", "clipped"):
            hits = sum(1 for f in normalized if f.get(flag) == "true")
            print(f"  {flag:11s} {hits}/{n}  ({100 * hits / n:.0f}%)")

    # The standing read on whether the headline is still tracking the work: a
    # summarize whose answer repeated the last one is discarded before it is
    # emitted, so a low ratio means the headline has gone constant again. It was
    # 16/47 when the headline was frozen by its own prompt.
    summarized = sum(1 for _, rest, _ in parsed if "session overview: summarized" in rest)
    emitted = sum(1 for _, rest, _ in parsed if "session overview: emitted" in rest)
    print("\nheadline change rate (emitted / summarized)")
    if summarized:
        print(f"  {emitted}/{summarized}  ({100 * emitted / summarized:.0f}%)"
              f"   — 16/47 (34%) is the frozen-headline baseline")
    else:
        print("  (no overviews in this window)")

    return 0


# Captured from real files, one of each shape the report depends on — including
# a line with `slow=true` present and one with it absent, and the older
# quoted-value form the caller side used before it moved to display formatting.
SAMPLES = [
    ("2026-07-29T02:55:53.336913Z  INFO tugapp::local_model: local model request "
     "task=classify transport=socket outcome=ok elapsed_ms=2291 input_chars=2 "
     "output_chars=5 model=ternary-bonsai-8b-2bit slow=true",
     "tugapp::local_model",
     {"task": "classify", "transport": "socket", "outcome": "ok",
      "elapsed_ms": "2291", "slow": "true", "model": "ternary-bonsai-8b-2bit"}),
    ("2026-07-29T02:54:53.713325Z  INFO tugapp::local_model: local model request "
     "task=prewarm transport=local outcome=ok elapsed_ms=1728 input_chars=0 "
     "output_chars=0 model=ternary-bonsai-8b-2bit",
     "tugapp::local_model",
     {"task": "prewarm", "transport": "local", "outcome": "ok", "elapsed_ms": "1728"}),
    ("2026-07-29T03:01:20.433928Z  INFO tugcast::local_model: local model call "
     "task=classify outcome=ok elapsed_ms=547",
     "tugcast::local_model",
     {"task": "classify", "outcome": "ok", "elapsed_ms": "547"}),
    ("2026-07-29T03:00:35.441476Z  INFO tugcast::local_model: local model call "
     'task="classify" outcome="ok" elapsed_ms=1003 slow=true',
     "tugcast::local_model",
     {"task": "classify", "outcome": "ok", "elapsed_ms": "1003", "slow": "true"}),
    ("2026-07-29T03:05:47.853487Z  INFO tugcast::local_model: local model summarize "
     "answered raw=Fix just app-debug stalls at splash screen headline=Fix just "
     "app-debug stalls at splash normalized=true trimmed=true clipped=false",
     "tugcast::local_model",
     {"normalized": "true", "trimmed": "true", "clipped": "false"}),
    ("2026-07-29T03:08:08.468238Z  INFO tugcast::feeds::session_overview: session "
     "overview: summarized session=4eb21996-9a77-4528-a854-53081ec7bc66 "
     "elapsed_ms=1461 raw=Fix command-line calculator with Makefile and README "
     "headline=Fix command-line calculator",
     "tugcast::feeds::session_overview",
     {"session": "4eb21996-9a77-4528-a854-53081ec7bc66", "elapsed_ms": "1461"}),
    ("2026-07-29T03:08:08.468251Z  INFO tugcast::feeds::session_overview: session "
     "overview: emitted session=4eb21996-9a77-4528-a854-53081ec7bc66 beat=51 receivers=1",
     "tugcast::feeds::session_overview",
     {"beat": "51", "receivers": "1"}),
]


def self_test() -> int:
    failures = 0
    for line, want_target, want_fields in SAMPLES:
        got = parse(line)
        if got is None:
            print(f"FAIL: did not parse: {line[:70]}…")
            failures += 1
            continue
        target, _, fields = got
        if target != want_target:
            print(f"FAIL: target {target!r} != {want_target!r}")
            failures += 1
        for key, want in want_fields.items():
            if fields.get(key) != want:
                print(f"FAIL: {key}={fields.get(key)!r} != {want!r} in {line[:60]}…")
                failures += 1

    # A line that is not one of ours must not parse as one of ours.
    assert parse("this is not a log line") is None

    print(f"{len(SAMPLES)} sample lines, {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
