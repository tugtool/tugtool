"""Score shell routing against a live Tug instance: did that line mean the shell?

Drives the real path end to end — the line goes over the control socket, the
app's own `LocalModelPrompts.classify` and its resident model answer, and
tugcast logs the verdict. What this scores is prompt and model together, not a
re-implementation of either.

    just model-classify                 # against debug-main
    just model-classify release-main

This is the one agent harness with **ground truth**, so unlike
`model-eval` it is scored as accuracy and it is a gate, not a rate. The two
error directions are not equal and are never summed into one number:

    false SHELL   a line meant for Claude RAN. Nothing un-runs it.
    false PROMPT  one keystroke to retype with `!shell`.

The exit code answers only the first. A run with no false SHELL passes even at a
mediocre false-PROMPT rate, because that is the trade the feature was designed
around (see `shell-line-classifier.ts`).

Two numbers are reported where one used to be, because they answer different
questions. The gate — and the exit code — is about what production would have
run, so the deck's own `vetoesShellVerdict` is applied to every `shell` verdict
before scoring; it is imported and run, never re-expressed here. Alongside it the
pack's *own* false SHELL count is reported unfiltered, because that is the number
that separates one pack from another once the veto has cleaned up after all of
them.

What is scored is the whole composed pipeline production runs, in order:

    grade    tuggram bands the line against the login PATH and the baked
             command catalog. A `no` is decided here and NO MODEL CALL IS MADE.
             A `maybe` sends the program's own documentation along with the
             line. `yes` and `unknown` ask the plain question, as before.
    model    the app's prompt and resident pack answer SHELL or PROMPT.
    veto     the deck's `vetoesShellVerdict` can refuse to honor a SHELL.

Read the No-band count carefully. The harness sends every case regardless of
what the deck would have asked about, and in production `isShellCandidate`
already refuses a line whose first word is not an installed program — so most
of the inference the No band appears to save here was being saved before this
feature existed. The report separates the two for exactly that reason. What the
grader genuinely adds is an unresolving segment head later in a pipeline and a
path-shaped opener that does not exist; neither fits this corpus's
one-command-per-case shape and both are verified against the live app instead.

Sending every case regardless is still deliberate — a precondition that happens
to cover for a bad verdict today is not the same as a good verdict.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ask_classify, log_path  # noqa: E402

CORPUS = Path(__file__).parent / "classify-corpus.json"
VETO_FILTER = Path(__file__).parent / "veto-filter.ts"
TUGRUST = Path(__file__).resolve().parents[2] / "tugrust"
GRADE_BIN = TUGRUST / "target" / "debug" / "grade"



def grade_map(lines: list[str]) -> dict[str, dict] | None:
    """Band every corpus line through the real grader.

    Built once and invoked as a binary. `cargo run` per line would put a
    rebuild check inside the scoring loop, and its latency would be read as the
    model's. Returns None when the build or the run fails, which is reported
    rather than silently treated as "everything is unknown".
    """
    build = subprocess.run(
        ["cargo", "build", "-p", "tuggram", "--bin", "grade"],
        cwd=TUGRUST, capture_output=True, text=True,
    )
    if build.returncode != 0:
        print(f"  grade bin failed to build: {build.stderr.strip()}", file=sys.stderr)
        return None
    proc = subprocess.run(
        [str(GRADE_BIN)], input="\n".join(lines), capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"  grade bin failed: {proc.stderr.strip()}", file=sys.stderr)
        return None
    return json.loads(proc.stdout)


def veto_map() -> dict[str, bool] | None:
    """Which corpus lines the shipping shell-shape veto refuses to execute.

    Obtained by running the deck's own `vetoesShellVerdict` through bun, not by
    re-expressing its rules here. The control socket this harness drives ends at
    the app, so the model's verdict is all it can see, and the veto that decides
    whether that verdict is honored lives one layer further out. Reaching it by
    import is the only way to score routing rather than only judgement; a Python
    copy of the rules would be a second source of truth that drifts.

    Returns None when bun cannot run it, which is reported rather than silently
    treated as "nothing is vetoed".
    """
    proc = subprocess.run(
        ["bun", str(VETO_FILTER)], capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"  veto filter failed: {proc.stderr.strip()}", file=sys.stderr)
        return None
    return json.loads(proc.stdout)


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
    cases = json.loads(CORPUS.read_text())["cases"]
    vetoes = veto_map()
    if vetoes is None:
        return 2
    grades = grade_map([c["text"] for c in cases])
    if grades is None:
        return 2
    print(f"putting {len(cases)} labeled lines to {args.instance}")


    rows = []
    for case in cases:
        grade = grades.get(case["text"], {"band": "unknown"})
        band = grade["band"]
        if band == "no":
            # The grader found something in the line that names nothing on this
            # machine. Production spends no inference here, so neither does the
            # score: the line routes to Claude and that is the whole answer.
            rows.append({
                **case, "band": band, "verdict": None, "routed": "prompt",
                "vetoed": False, "ms": 0, "asked": False,
                "ok": case["label"] == "prompt",
            })
            mark = "skip" if case["label"] == "prompt" else "MISS"
            print(f"  {mark:>6}  {'prompt':6s}    no model  {case['text']}")
            continue
        # A Maybe hands the model the program's own documentation; every other
        # band asks the plain question.
        answer = ask_classify(
            case["text"], args.instance, path, args.timeout,
            grade.get("synopsis") if band == "maybe" else None,
        )
        if answer is None:
            print(f"  {'--':>6}  NO ANSWER  {case['text']}")
            continue
        verdict, ms, read_docs = answer
        # What production would do with that verdict. The veto can only turn a
        # `shell` into a `prompt`, so `routed` and `verdict` differ in exactly
        # one direction and the pack's own judgement stays legible next to it.
        vetoed = verdict == "shell" and vetoes.get(case["text"], False)
        routed = "prompt" if vetoed else verdict
        ok = routed == case["label"]
        # A false SHELL is the only outcome that did something irreversible, so
        # it is the only one that gets a shout in the per-case line. A verdict
        # the veto caught is marked as such: the model still got it wrong, but
        # nothing ran.
        if ok:
            mark = "veto" if vetoed else "ok"
        else:
            mark = "RAN!" if routed == "shell" else "miss"
        rows.append({
            **case, "band": band, "verdict": verdict, "routed": routed,
            "vetoed": vetoed, "ms": ms, "asked": True, "read_docs": read_docs,
            "ok": ok,
        })
        print(f"  {mark:>6}  {routed:6s} {ms:5d}ms  {band:7s}  {case['text']}")

    if not rows:
        print("\nnothing scored — is the instance running with a model installed?")
        return 1

    shell = [r for r in rows if r["label"] == "shell"]
    prompt = [r for r in rows if r["label"] == "prompt"]
    # Two different questions. `false_shell` is what production would have run,
    # and it is what the exit code answers. `model_false_shell` is the pack's own
    # propensity for the irreversible error, which is what separates one pack
    # from another once the veto has cleaned up after all of them.
    false_shell = [r for r in prompt if r["routed"] == "shell"]
    model_false_shell = [r for r in prompt if r["verdict"] == "shell"]
    false_prompt = [r for r in shell if r["routed"] == "prompt"]
    vetoed = [r for r in rows if r["vetoed"]]
    asked = [r for r in rows if r["asked"]]
    latencies = sorted(r["ms"] for r in asked) or [0]

    print("\n" + "=" * 66)
    print(f"  accuracy        {sum(r['ok'] for r in rows)}/{len(rows)}")
    print(f"  shell recall    {len(shell) - len(false_prompt)}/{len(shell)}")
    print(f"  prompt recall   {len(prompt) - len(false_shell)}/{len(prompt)}")
    print(f"  median ms       {latencies[len(latencies) // 2]}")
    print(f"  model said shell, veto refused it   {len(vetoed)}")
    print(f"  pack's own false SHELL              {len(model_false_shell)}")

    # Per band: how many cases, how many correct, and what inference cost.
    print("\n  band      cases  correct  asked")
    for band in ("yes", "maybe", "no", "unknown"):
        group = [r for r in rows if r["band"] == band]
        if not group:
            continue
        print(f"  {band:9s} {len(group):5d}  {sum(r['ok'] for r in group):7d}"
              f"  {sum(r['asked'] for r in group):5d}")

    # The honest reading of the No band. A `no` whose command word IS the
    # line's first token is a line the deck's own precondition would have
    # refused before the grader ran, so its saved inference was already being
    # saved; only the rest is new.
    skipped = [r for r in rows if r["band"] == "no"]
    already = [r for r in skipped
               if grades[r["text"]].get("command") == r["text"].split()[0]]
    print(f"\n  model calls skipped                 {len(skipped)}")
    print(f"    of those, isShellCandidate would")
    print(f"    have filtered anyway                {len(already)}")
    print(f"    genuinely new to the grader         {len(skipped) - len(already)}")

    # A Maybe must have run the documentation-bearing prompt and nothing else
    # may have. If the two do not line up the band split above is measuring
    # something other than what it says.
    wrong_prompt = [r for r in rows if r["asked"] and r["read_docs"] != (r["band"] == "maybe")]
    if wrong_prompt:
        print(f"\n  {len(wrong_prompt)} line(s) ran the wrong classify prompt for their band:")
        for r in wrong_prompt:
            print(f"    {r['band']:7s} read_docs={r['read_docs']}  {r['text']}")

    # A No-band line must never have reached the model at all; if one did, the
    # skip is not actually skipping and every count above is wrong.
    leaked = [r for r in rows if r["band"] == "no" and r["asked"]]
    if leaked:
        print(f"\n  {len(leaked)} No-band line(s) reached the model anyway:")
        for r in leaked:
            print(f"    {r['text']}")

    if false_shell:
        print(f"\n  {len(false_shell)} line(s) meant for Claude were RUN:")
        for r in false_shell:
            print(f"    {r['text']}")
    if model_false_shell:
        print(
            f"\n  {len(model_false_shell)} line(s) the pack itself called shell "
            f"({len(model_false_shell) - len(false_shell)} caught by the veto):"
        )
        for r in model_false_shell:
            print(f"    {r['text']}")
    if false_prompt:
        print(f"\n  {len(false_prompt)} command(s) went to Claude (one keystroke each):")
        for r in false_prompt:
            print(f"    {r['text']}")

    if args.json:
        args.json.write_text(json.dumps(rows, indent=2))
        print(f"\nwrote {args.json}")

    return 1 if (false_shell or leaked or wrong_prompt) else 0


if __name__ == "__main__":
    sys.exit(main())
