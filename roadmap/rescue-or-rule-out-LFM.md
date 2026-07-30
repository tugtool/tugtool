# Local model: rescue-or-rule LFM2.5

## Where things are

Work lives on the **`model-trust` dash**, not main:
- worktree: `/Users/kocienda/Mounts/u/src/tugtool/.tug/worktrees/model-trust`
- branch: `tugdash/model-trust`, 8 commits ahead of main, tree clean
- plan: `roadmap/local-model-trust.md` (steps 1–7 `done`, step 8 `partial`)
- commit with `tugutil dash commit model-trust --message "…" --json <<'EOF' {…} EOF`
- **never commit to main** — landing is the user's `/join model-trust`

Debug instance: `debug-tugdash-model-trust` (port was 55330 — read it from
`tugutil host instance list`, don't assume). Build/relaunch with `just app-debug`
from the worktree.

## What already landed (don't redo)

- **Exact-token verdict parse** in `LocalModelService.verdict(from:labels:)`.
- **`vetoesShellVerdict`** in `tugdeck/src/lib/shell-line-classifier.ts` — PROMPT-only
  veto, applied at the single point before `routeToShell()`.
- **`ground_headline`** in `tugrust/crates/tugcast/src/feeds/session_overview.rs` —
  refuses a headline the digest doesn't support (empty / tool-name opener /
  path-bearing / activity restatement / ungrounded below 2/3 of subject words),
  with a one-shot re-ask gated on `EmitJob.may_reask`.
- **Paired-example `LocalModelPrompts.summarize`** (6 digest→headline pairs).
- **Catalog**: qwen3-4b is `recommended: true, offered: true` at index 0; bonsai and
  lfm25 demoted. `reconcile_catalog_ranks` in `main.rs` re-ranks installed packs at
  launch (gated on `TUG_INSTANCE_ID`).
- **Harnesses**: `classify.py` applies the real veto via `tests/model-eval/veto-filter.ts`
  (bun) and reports *both* post-veto and the pack's own false SHELL. `analyze.py`
  reports grounding refusal rate by rule and re-ask rescue rate.
- App-tests no longer load model weights (`resolveRoute` returns nil under
  `TUGAPP_APP_TEST=1`), and the 20-file selection budget is now **hard** — the
  `--allow-large` override was deleted. Do not route around it by naming files.

## Measured baseline (fixed — do not re-run qwen or bonsai)

| pack | own false SHELL | rescues | gate refused | all rules | summarize ms | size |
|---|---|---|---|---|---|---|
| qwen3-4b-instruct-4bit **(shipping)** | 1/36 | 0 | 2/13 | 9/13 | 1245 | 2.28 GB |
| ternary-bonsai-8b-2bit | 2/36 | 3 | 2/13 | 11/13 | 1647 | 2.31 GB |
| lfm25-1.2b-instruct-**4bit** | **17/36** | 1 | 5/13 | 3/13 | 422 | 0.66 GB |

LFM2.5 on the **old, shorter** unpaired prompt: `all rules 10/13`, gate refused
**13/13**. Pairing bought it truth and cost it form — that inversion is the whole
reason for this experiment.

## The task

**Do nothing further with qwen or bonsai.** They are the fixed bar.

### Experiment A + B — run together as one

**A. Higher-precision quant of the same model.** We only ever tested 4-bit, which
damages a 1.2B model far more than an 8B.
- `mlx-community/LFM2.5-1.2B-Instruct-8bit` — 1.25 GB, `model_type: lfm2`
- (optional) `mlx-community/LFM2.5-1.2B-Instruct-6bit` — 0.96 GB

**B. A prompt written for a small model.** Both existing prompts were tuned against
8B/4B packs. Try a short `summarize` — 2–3 pairs, fewer rules — and a shorter
`classify`. Measure LFM2.5-to-LFM2.5 across prompt variants.

Score each variant on **both** harnesses and on the gate.

### Experiment C — unconditionally, as a quality check

`mlx-community/LFM2.5-8B-A1B-MLX-4bit` — 4.78 GB, `model_type: lfm2_moe`
(**is** in the mlx-swift-examples registry). MoE: 8B total, ~1B active per token —
LFM2.5-class latency with far more capacity. Run it even if A+B already succeed.

## Ruling criteria — fixed in advance, do not renegotiate after seeing numbers

Table T02 priority order, from the plan:
1. **The pack's own false SHELL count** (`just model-classify`, the unfiltered column).
   The only irreversible error. qwen's bar is **1**.
2. **Grounding refusal rate + copied examples.** qwen's bar is **2/13**.
3. **Normalizer rescue count.** qwen's bar is **0**.
4. **Download size.** A smaller pack that ties on 1–3 wins.
5. **Median latency**, both tasks.
6. **Raw register pass rate** — ranks last deliberately; it's the number that
   reported 13/13 over a prompt that was leaking answers.

## Mechanics you'll need

**Adding a catalog entry** (`tugrust/crates/tugcast/src/local_model.rs`): new entries
must be `recommended: false, offered: false` — `catalog_is_internally_consistent`
asserts exactly one of each, that `CATALOG[0].recommended`, that file bytes sum to
`total_bytes`, `hf_revision.len() == 40`, and every `sha256.len() == 64`.

**Installing a pack:** stage bytes into `.staging/<id>/<name>.part` under the models
root, then `tugutil host tell local_model_download` resumes onto them, verifies every
digest and writes `tug-manifest.json` — no re-download.

**Selecting a pack:** `PUT {"kind":"string","value":"<pack-id>"}` to
`http://127.0.0.1:<port>/api/defaults/dev.tugtool.local-model/model`.

**Always warm before scoring.** `classify` deliberately fast-fails `not_resident`
against a cold pack, so send a `local_model_summarize` tell first and wait for
`task=summarize …model=<id>` in the instance's `Logs/tugapp.log.*`.

**Harnesses** (pass the instance id, not `debug-main`):
```
python3 tests/model-eval/classify.py  <instance> --timeout 60 --json /tmp/classify-<pack>.json
python3 tests/model-eval/run.py       <instance> --timeout 90 --json /tmp/register-<pack>.json
python3 tests/model-eval/liveness.py  <instance>
python3 tests/model-eval/analyze.py   <instance>
```

**The gate's refusal rate over real answers** — reads `/tmp/register-*.json`, no-op
without them:
```
cd tugrust && cargo nextest run -p tugcast the_refusal_rate --nocapture
```

## Constraints

- **Warnings are errors** (`-D warnings`). `cd tugrust && cargo nextest run` must stay green.
- `run.py` **exits 2** if any prompt example's subject appears in a corpus digest —
  run it as a preflight before spending inference.
- Opening verbs in examples must be on `tests/model-eval/verbs.txt` (a closed list).
- `LocalModelJob` carries only `instructions / input / maxTokens / temperature`.
  There is no repetition-penalty knob; adding one is a real change to the MLX sampler
  path. LiquidAI publishes no recommended sampling params, so temperature 0 is not
  contradicted by the vendor.
- `classifyMaxTokens = 8`, `summarizeMaxTokens = 24` — any pack that emits `<think>`
  spends its whole budget before answering.
- App-tests: 20-file budget is hard, no override. Prefer not to run them at all here.

## The design question this experiment will force

`LocalModelPrompts` is a **single compile-time constant**, and [P08] freezes the
wording so every pack in one bake-off is compared on identical text. If LFM2.5 only
wins with a prompt written for it, then shipping it means **per-pack prompts** — an
architecture the plan never contemplated and the freeze rule currently forbids.
Surface that decision explicitly rather than quietly editing the shared string.

## Still owed from step 8 (not part of this experiment)

The core tier showed 6 failures while the app-test bundle was loading 8.6 GB of
weights per launch. That load is now gated off but the tier has **not** been re-run,
so those failures are unexplained rather than fixed. Also owed: the live headline
read, and the two `model-stats` rate readings with 2+ sessions live.
