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

Note what this does NOT measure: the deck refuses to ask about a line whose
first word is not an installed program, so in production some of the prose here
never reaches the model at all. Sending every case regardless is deliberate —
this scores the model's judgement, and a precondition that happens to cover for
a bad verdict today is not the same as a good verdict.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from harness import ask_classify, installed_packs, log_path  # noqa: E402

CORPUS = Path(__file__).parent / "classify-corpus.json"


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
    print(f"putting {len(cases)} labeled lines to {args.instance}")
    print(f"packs installed: {', '.join(installed_packs()) or 'none'}\n")

    rows = []
    for case in cases:
        answer = ask_classify(case["text"], args.instance, path, args.timeout)
        if answer is None:
            print(f"  {'--':>6}  NO ANSWER  {case['text']}")
            continue
        verdict, ms = answer
        ok = verdict == case["label"]
        # A false SHELL is the only outcome that did something irreversible, so
        # it is the only one that gets a shout in the per-case line.
        mark = "ok" if ok else ("RAN!" if verdict == "shell" else "miss")
        rows.append({**case, "verdict": verdict, "ms": ms, "ok": ok})
        print(f"  {mark:>6}  {verdict:6s} {ms:5d}ms  {case['text']}")

    if not rows:
        print("\nnothing scored — is the instance running with a model installed?")
        return 1

    shell = [r for r in rows if r["label"] == "shell"]
    prompt = [r for r in rows if r["label"] == "prompt"]
    false_shell = [r for r in prompt if r["verdict"] == "shell"]
    false_prompt = [r for r in shell if r["verdict"] == "prompt"]
    latencies = sorted(r["ms"] for r in rows)

    print("\n" + "=" * 66)
    print(f"  accuracy        {sum(r['ok'] for r in rows)}/{len(rows)}")
    print(f"  shell recall    {len(shell) - len(false_prompt)}/{len(shell)}")
    print(f"  prompt recall   {len(prompt) - len(false_shell)}/{len(prompt)}")
    print(f"  median ms       {latencies[len(latencies) // 2]}")

    if false_shell:
        print(f"\n  {len(false_shell)} line(s) meant for Claude were RUN:")
        for r in false_shell:
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
