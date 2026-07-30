/**
 * Apply the shipping shell-shape veto to the routing corpus and report, per
 * line, whether a `shell` verdict for it would be honored.
 *
 * `classify.py` drives the app's control socket, so the model's verdict is all
 * it can see — the veto lives in the deck and never appears on that path. This
 * script is how the harness reaches it: the real `vetoesShellVerdict` is
 * imported and run, never re-expressed in Python, because a second copy of the
 * rules is the thing that would go stale while reporting that all is well.
 *
 *   bun tests/model-eval/veto-filter.ts
 *
 * Writes `{"<text>": true|false}` to stdout, true meaning vetoed.
 */

import { vetoesShellVerdict } from "../../tugdeck/src/lib/shell-line-classifier";

const corpus = new URL("./classify-corpus.json", import.meta.url);
const parsed = (await Bun.file(corpus).json()) as {
  cases: { text: string; label: string }[];
};

const out: Record<string, boolean> = {};
for (const c of parsed.cases) out[c.text] = vetoesShellVerdict(c.text);

process.stdout.write(JSON.stringify(out));
