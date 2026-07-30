"""Score shell routing against a live Tug instance: did that line mean the shell?

Drives the real path end to end — the line goes over the control socket, the
app's own `LocalModelPrompts.classify` and its resident model answer, and
tugcast logs the verdict. What this scores is prompt and model together, not a
re-implementation of either.

    just model-classify                 # against debug-main
    just model-classify release-main

This is the one local-model harness with **ground truth**, so unlike
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

Note what this still does NOT measure: the deck refuses to ask about a line whose
first word is not an installed program, so in production some of the prose here
never reaches the model at all. Sending every case regardless is deliberate — a
precondition that happens to cover for a bad verdict today is not the same as a
good verdict.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ask_classify, installed_packs, log_path  # noqa: E402

CORPUS = Path(__file__).parent / "classify-corpus.json"
VETO_FILTER = Path(__file__).parent / "veto-filter.ts"


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
    print(f"putting {len(cases)} labeled lines to {args.instance}")
    print(f"packs installed: {', '.join(installed_packs()) or 'none'}\n")

    rows = []
    for case in cases:
        answer = ask_classify(case["text"], args.instance, path, args.timeout)
        if answer is None:
            print(f"  {'--':>6}  NO ANSWER  {case['text']}")
            continue
        verdict, ms = answer
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
            **case, "verdict": verdict, "routed": routed,
            "vetoed": vetoed, "ms": ms, "ok": ok,
        })
        print(f"  {mark:>6}  {routed:6s} {ms:5d}ms  {case['text']}")

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
    latencies = sorted(r["ms"] for r in rows)

    print("\n" + "=" * 66)
    print(f"  accuracy        {sum(r['ok'] for r in rows)}/{len(rows)}")
    print(f"  shell recall    {len(shell) - len(false_prompt)}/{len(shell)}")
    print(f"  prompt recall   {len(prompt) - len(false_shell)}/{len(prompt)}")
    print(f"  median ms       {latencies[len(latencies) // 2]}")
    print(f"  model said shell, veto refused it   {len(vetoed)}")
    print(f"  pack's own false SHELL              {len(model_false_shell)}")

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

    return 1 if false_shell else 0


if __name__ == "__main__":
    sys.exit(main())
