## Local Model Trust — Grounded Headlines, Safe Routing, One Pack {#local-model-trust}

**Purpose:** Make the on-device model trustworthy for the two jobs it does — writing the PULSE session headline and deciding whether an unprefixed composer line means the shell — by grounding every headline in the digest it claims to describe, making a wrong SHELL verdict structurally hard to reach, and settling on a single model pack chosen by a declared-in-advance bake-off.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-30 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

A measurement pass on 2026-07-29 over 1123 real headlines from `release-main` found that the headline half of this feature is not summarizing — it is copying strings. 85% of headlines opened with `Fix`. 13% lifted a string out of the summarize prompt's own example block, including the label that block holds up as the failure to avoid. 8% opened with a literal tool name (`Edit`, `Bash`, `Write`, `Read`), which means the intent line restated the activity line. 9% carried a path or filename, which is what produced the mid-token truncation seen on the strip (`Write jul29-p…`): `trim_to_word_budget` cannot fire on a path because a path is one whitespace word, so `clip` cuts at `MAX_HEADLINE_CHARS` mid-token. The five register checks in `tests/model-eval/score.py` pass nearly all of these, because they score **form** and every one of these failures is well-formed. The harness cannot see the defect; that is not a bug in the harness, it is the boundary the harness has always declared (see its "What it cannot tell you" section).

Shell routing failed separately and worse. Two real lines meant for Claude were **executed**: `count the number of lines of code with tokei`, and a 134-character request to write a task list for a C calculator project. Both are irreversible by construction — the auto-routed row offers "send to Claude instead", but nothing un-runs a command. Two defects combine to produce this: `LocalModelService.verdict(from:labels:)` scans the label list in order with `String.contains`, and the deck calls it with `["shell", "prompt"]`, so **any** answer mentioning both words resolves to `shell` — the executing verdict — which is backwards from the error budget the feature is designed around. And nothing anywhere checks that a line the model called `shell` is actually shell-*shaped*.

Underneath both problems sits a model question that has been left open too long. The catalog currently offers `ternary-bonsai-8b-2bit` and holds `qwen3-4b-instruct-2507-4bit` in reserve, and a third pack, `lfm25-1-2b-instruct-4bit`, was surveyed, downloaded, and confirmed to load on 2026-07-29. Exactly one pack may ship: two multi-gigabyte downloads is not a configuration this app will ask a user to accept. The bake-off that picks the winner has never been run against a prompt that wasn't leaking answers, so every number recorded before now is suspect.

#### Strategy {#strategy}

- **Fix the irreversible thing first.** The verdict parse and the shell-shape veto are pure logic, need no inference, and remove the only failure mode in this feature that cannot be undone. They land before anything model-dependent.
- **Score truth in Rust, not in the register harness.** `model-eval` scores form because there is no ground truth for "what is this session working on". But there *is* ground truth for "is this headline derived from the digest it was given" — that is a checkable relation between two strings, and it belongs beside the normalizer in `session_overview.rs`.
- **Let the decontamination pay off twice.** With every prompt example now disjoint from every corpus digest, a lifted example is *by definition* ungrounded. The grounding rule subsumes lift detection, so the Rust gate never needs a copy of the Swift example list — and so cannot drift from it ([P05]).
- **Run each half of the bake-off only when its pipeline is final.** Scoring three packs against a prompt about to be rewritten spends inference on a baseline that will not survive ([P02]).
- **Declare the ruling criteria before seeing the numbers.** Otherwise the winner is whichever pack the last run happened to flatter (Table T02).
- **Every step names which harness moves and in which direction.** `just model-eval`, `just model-classify`, `just model-stats`. A step that moves none of them is either infrastructure or it is unfalsifiable.

#### Success Criteria (Measurable) {#success-criteria}

- `just model-classify` reports **zero false SHELL** for the shipping pack, with shell recall no worse than the pre-change baseline for that pack (`qwen` 30/35, `bonsai` 32/35). Verified: the harness exits 0, and its "line(s) meant for Claude were RUN" section is absent.
- Both real 2026-07-29 false-SHELL lines are present in `tests/model-eval/classify-corpus.json` and route to `prompt`. Verified: their per-case marks read `ok`.
- No headline reaches the PULSE strip whose content words are absent from its digest, that restates a single activity line, or that carries a path. Verified: Rust unit tests over `tests/model-eval/corpus` plus the real defective answers recorded in List L01, run by `cargo nextest run -p tugcast session_overview`.
- `just model-stats` reports a **grounding refusal rate** and a **re-ask rescue rate** as first-class numbers. Verified: `python3 tests/model-eval/analyze.py --self-test` passes with the new log line in its fixture set.
- `just model-eval` reports **`copied examples 0/13`** for the shipping pack. Verified: the harness's copied-examples line and its named list.
- The catalog offers exactly one pack. Verified: `catalog_is_internally_consistent` passes, and `CATALOG.iter().filter(|e| e.offered).count() == 1`.
- The headline change rate reported by `just model-stats` does not fall below its pre-change value for a comparable session count — the gate must not buy truth by going silent (Risk R02).

#### Scope {#scope}

1. `LocalModelService.verdict(from:labels:)` — exact-token label matching, replacing the ordered `contains` scan.
2. A PROMPT-only shell-shape veto in `tugdeck/src/lib/shell-line-classifier.ts`, applied at the single routing decision point in `tug-prompt-entry.tsx`.
3. A grounding gate beside `headline_register_report` in `tugrust/crates/tugcast/src/feeds/session_overview.rs`, with a one-shot corrective re-ask.
4. A rewrite of `LocalModelPrompts.summarize` in `tugapp/Sources/LocalModelService.swift` to paired input/output examples.
5. A three-pack bake-off across `just model-classify` and `just model-eval`, and the catalog change that follows from it.
6. New reporting in `tests/model-eval/analyze.py` for refusal and re-ask rates.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Constrained decoding / grammar-constrained output.** It would make the classify parse unfalsifiable-by-construction rather than fixed, and MLX Swift's support is not established at the current pin. Revisit if the veto proves insufficient.
- **Changing `compose_digest`'s wording or section structure.** It was rebalanced in the pulse rearchitecture and any change forces a corpus regeneration; the failures in this plan are not digest-composition failures.
- **Changing `clip`, `MAX_HEADLINE_CHARS`, or `trim_to_word_budget`.** The mid-path truncation is a *symptom* of an ungrounded headline, and the gate removes its cause. Nothing about the truncation code is wrong.
- **A new UI surface for headline staleness.** Considered and declined for this phase (see [P04]); a refusal holds the previous headline silently.
- **Adding MLXVLM or bumping the mlx-swift-examples pin** to reach architectures the current pin lacks. See [#rejected-candidates].
- **Re-scoring the catalog's historical `notes` figures.** Those numbers refer to prompt wordings four rewrites old and are not being refreshed; [P08] states what the freeze rule now means instead.

#### Dependencies / Prerequisites {#dependencies}

- A running instance with a pack installed. `just app-debug` builds, signs, and launches `debug-main`; `tugutil host instance list` reports its port (55302 at time of writing, but read it rather than assuming).
- All three packs installed. `ternary-bonsai-8b-2bit`, `qwen3-4b-instruct-2507-4bit`, and `lfm25-1-2b-instruct-4bit` were present under `~/Library/Application Support/Tug/models/` as of 2026-07-29; confirm with `tugutil host tell local_model_inventory` or by reading each directory's `tug-manifest.json`.
- The frozen digest corpus, `tests/model-eval/corpus/*.digest.txt` (13 entries), pinned by `corpus_digests_are_what_compose_digest_produces`.
- `tests/model-eval/classify-corpus.json` (71 labeled cases: 35 `shell`, 36 `prompt`).

#### Constraints {#constraints}

- **Warnings are errors.** `-D warnings` via `tugrust/.cargo/config.toml`; `cargo build` and `cargo nextest run` both fail on any warning.
- **There is no Swift test target.** `tugapp/` has no `Tests` directory and the Xcode project defines no test target, so Swift-side logic cannot carry a unit test. This directly constrains Step 1's checkpoint (Risk R04).
- **Banned test styles.** No fake-DOM/RTL (`happy-dom`, `jsdom` render, `@testing-library/react`), no mock-store assertion tests. Real-app behavior goes in `tests/app-test/` via the `just` recipes; everything else is pure-logic `bun:test` or `cargo nextest`.
- **App-test selection is derived, not swept.** `just app-test-changed`; every new test needs a `@covers` line. Do not run the full corpus.
- **The register harness cannot see the gate.** `tests/model-eval/harness.py` reads the requester's log line (`local model summarize answered raw=… headline=…`, emitted in `local_model.rs`), which fires *before* `session_overview.rs` decides anything. The gate is therefore invisible to `just model-eval` by construction — see [#harness-reach] for what verifies it instead.
- **The Swift instruction text cannot be varied per request.** `LocalModelPrompts.summarize` is a compile-time constant and the only per-request input is the digest, which is what forces the re-ask to work by appending to the digest ([P04]).
- **No plan-step numbers in durable artifacts.** Not in code, comments, docstrings, test names, or commit messages.

#### Assumptions {#assumptions}

- A headline that is genuinely about the session shares at least half its content words with the digest it was given, allowing for the leading verb (which a digest of tool lines will rarely contain). [Q02] tests this against the corpus before the threshold is fixed.
- Small quantized models form first-word priors from unpaired examples, which is the mechanism behind both the 85% `Fix` monoculture and the 13% lift rate. This is the same reasoning that already produced `classify`'s paired-example block, and that block does not exhibit either pathology.
- The two real false-SHELL lines are representative of the class rather than isolated flukes; `bonsai` reproduces both deterministically and `qwen` reproduces one.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the devise-skeleton conventions: explicit `{#anchor}` on every heading cited later, `[P##]` for plan-local decisions, `[Q##]` for open questions, `S##` specs, `T##` tables, `L##` lists, `R##` risks, `**Depends on:**` lines carrying `#step-N` anchors, and `**References:**` lines citing labels and anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does pairing the summarize examples with inputs actually reduce lifting, or only change which strings get lifted? (OPEN) {#q01-pairing-effect}

**Question:** `classify`'s paired-example block does not produce lifting; `summarize`'s unpaired block does. Is pairing the cause of that difference, or is it confounded by the two tasks' different output spaces (one closed label vs open prose)?

**Why it matters:** If pairing does not help, the prompt rewrite is churn, and the grounding gate is carrying the entire fix alone. That is survivable — the gate is the backstop either way ([P03]) — but it changes whether the rewrite is worth keeping.

**Options (if known):**
- Pairing reduces lifting materially: keep the rewrite, and the gate refuses less often.
- Pairing changes the lifted strings but not the rate: keep the rewrite only if the `Fix` monoculture improves, and lean entirely on the gate.
- Pairing makes register worse (a 1.2B pack may hold form better from bare exemplars): revert to unpaired and rely on the gate.

**Plan to resolve:** Step 6 measures `copied examples N/13` for all three packs against both the old and new prompt wording. `run.py` already reports this line, so the comparison is a direct read.

**Resolution:** OPEN — resolved by #step-6.

#### [Q02] What grounding threshold refuses the real defects without refusing good headlines? (OPEN) {#q02-grounding-threshold}

**Question:** Spec S01 requires "at least half the headline's content words appear in the digest". Is one-half right? A good headline may legitimately use a synonym the digest never spells (`Salvage corrupted changes ledger` against a digest that says *recover*).

**Why it matters:** Too strict and the gate refuses good headlines, the strip goes stale, and the liveliness the pulse depends on is lost (Risk R02). Too loose and lifted examples survive.

**Options (if known):**
- Require ≥50% of non-verb content words grounded.
- Require ≥1 grounded content word (very loose; catches only pure hallucination).
- Require all-but-one grounded (very strict).

**Plan to resolve:** Spike in-thread during #step-4. The inputs already exist: the 13 frozen digests, the headlines each pack produced against them (recorded by `run.py --json`), and the real defective answers in List L01. Sweep the threshold over that set and pick the value that rejects every entry in L01 while accepting every headline a human reads as correct. Record the chosen value and the sweep in the step's commit.

**Resolution:** OPEN — resolved by #step-4.

#### [Q03] Can a 1.2B pack hold six-word register under a paired-example prompt? (OPEN) {#q03-lfm-capacity}

**Question:** `lfm25-1-2b-instruct-4bit` is a third the parameters of the incumbent. Its two smoke answers were in register (`Wire local_model test run`, 4 words, verb-first), but two answers is not a measurement, and a paired-example prompt is longer and more structured than the current one.

**Why it matters:** It is the ruling criterion most likely to separate the packs, and it is the pack whose 0.66 GB download would otherwise win on size outright.

**Plan to resolve:** #step-6 scores all 13 digests. Watch normalizer rescue count specifically — a pack that passes the rubric only after `headline_register_report` rewrites it is drifting, and the rescue count sees that where the pass rate does not.

**Resolution:** OPEN — resolved by #step-6.

#### [Q04] Should a retired-but-installed pack keep answering? (DECIDED) {#q04-retired-pack-behavior}

**Question:** When the catalog demotes a pack to `offered: false`, a user who already installed it keeps a pack that is downloadable, selectable, and `auto`-eligible. Is that the desired behavior?

**Resolution:** DECIDED — yes, unchanged. The `CatalogEntry` docstring already states the intent ("a non-offered entry is otherwise fully supported… it simply is not part of the first-run choice"), `resolveRoute` honors an explicit pick literally, and `local-model-store.ts` already wires a `local_model_delete` control frame so the bytes are reclaimable from the existing UI. No new affordance is needed; #step-7 only verifies that `auto` resolves to the new winner for a user holding both, which follows from `catalog_rank` ordering.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| R01 Prompt tuned to the losing pack | med | med | Score the rewrite on all three packs in the same step that rules ([P02]) | A pack wins classify but loses register |
| R02 Gate refuses too often; strip goes stale | high | med | One corrective re-ask ([P04]); refusal + rescue rates reported by `model-stats`; headline change rate is an exit criterion | Refusal rate above ~20% of ticks |
| R03 Veto collapses shell recall | med | low | Veto is PROMPT-only and gated on `model-classify` shell recall not regressing | Shell recall drops below baseline |
| R04 Swift parse fix has no unit test | med | high | Falsify through the real path (`just model-classify`) plus a crafted probe; see [#harness-reach] | Any future Swift-side logic of comparable consequence |
| R05 LFM2.5 quirks under an 8-token classify budget | med | med | `just model-classify` is run against it in #step-3 before anything is tuned to it | `outcome=refused` rate materially above the other packs |

**Risk R01: The prompt gets tuned to a pack that does not ship** {#r01-prompt-tuned-to-loser}

- **Risk:** The paired-example rewrite is iterated against whichever pack is convenient, then a different pack wins the bake-off and inherits a prompt shaped for someone else.
- **Mitigation:**
  - #step-6 scores the new prompt on all three packs and rules in the same step, so no pack has a tuning head start.
  - The rewrite's acceptance criteria are pack-independent (paired structure, corpus disjointness, verb variety), not "scores well on X".
- **Residual risk:** The author's intuition about what wording works is inevitably formed on whichever pack they iterate against. The gate limits the damage: a prompt that serves the winner poorly shows up as a high refusal rate, not as a wrong headline on the strip.

**Risk R02: Truth is bought with silence** {#r02-gate-goes-quiet}

- **Risk:** The gate refuses so often that the strip stops moving, trading a visible wrongness for an invisible staleness. Liveliness is a stated requirement of the pulse, not a nice-to-have.
- **Mitigation:**
  - One corrective re-ask per tick, naming the specific failure ([P04]) — a bad answer told what was wrong is usually recoverable.
  - The refusal rate and the re-ask rescue rate are both reported by `just model-stats`, so the trade is measured rather than assumed.
  - The headline change rate — already the standing "is the headline still tracking the work" number — is an exit criterion, so a gate that buys truth with silence fails the phase.
- **Residual risk:** A session whose digest reliably provokes refusals sits on a stale headline. This is the accepted trade: a stale headline was true when it was written, and a wrong one never was.

**Risk R04: The Swift parse fix cannot be unit-tested** {#r04-no-swift-tests}

- **Risk:** `tugapp/` has no test target, so the single most consequential logic change in this plan — the one that stops prose from executing — lands with no test pinning it.
- **Mitigation:**
  - `just model-classify` exercises the real parse over 71 labeled lines through the live app, and is a one-sided gate.
  - The crafted probe in #step-1 puts a line to the model whose answer historically contains both label words, and the log's `verdict=` field records what the parse made of it.
  - The `outcome(of:)` classification already distinguishes `refused` from `error`, so ambiguity is observable in `model-stats` rather than silent.
- **Residual risk:** A future edit to `verdict(from:labels:)` can regress it with nothing failing until someone runs a harness that spends inference. Standing up a Swift test target is a worthwhile follow-on (see [#roadmap]).

---

### Design Decisions {#design-decisions}

#### [P01] One pack ships, and the ruling criteria are fixed before the numbers are seen (DECIDED) {#p01-one-pack}

**Decision:** Exactly one catalog entry is `offered` at phase end. The winner is chosen against the priority order in Table T02, which is fixed by this document before any bake-off runs.

**Rationale:**
- Two multi-gigabyte downloads is not a configuration this app asks a user to accept.
- Criteria declared after the fact select whichever pack the last run flattered. Declaring them first makes the bake-off a measurement rather than a rationalization.

**Implications:**
- `catalog_is_internally_consistent` already asserts exactly one `recommended` entry and that a recommended entry is `offered`; #step-7 adds an assertion that exactly one entry is `offered`.
- The losing packs stay in `CATALOG` as `offered: false`, which keeps them downloadable and selectable for future bake-offs at zero user-facing cost ([Q04]).

#### [P02] Model-independent fixes land first; the bake-off runs in two halves, each after its own pipeline is final (DECIDED) {#p02-sequencing}

**Decision:** The verdict parse and shell-shape veto land first, then the classify half of the bake-off. Then the grounding gate and the prompt rewrite, then the register half of the bake-off, which is where the ruling happens.

**Rationale:**
- A classify baseline taken before the parse fix measures a pipeline being deleted: the same model output resolves differently afterwards.
- A register baseline taken before the prompt rewrite measures wording being replaced.
- Splitting the bake-off is strictly better than one monolithic run: each half executes when the pipeline it scores is final, and neither half is spent twice.
- The irreversible defect (prose executing) is fixed first on principle, independent of any measurement.

**Implications:**
- The ruling cannot happen until both halves are in hand, so #step-6 carries the decision and #step-3 only collects.
- The pre-existing two-pack numbers become the "before" record and are not re-taken.

#### [P03] The grounding gate lives in Rust beside the normalizer, and refuses rather than rewrites (DECIDED) {#p03-gate-in-rust}

**Decision:** A pure function in `session_overview.rs`, adjacent to `headline_register_report`, decides whether a candidate headline is grounded in the digest it was given. A refused headline is not emitted; the previous headline stands. The gate never edits a headline's content.

**Rationale:**
- Rust is the only place that holds both strings — the digest that was sent and the headline that came back. The Swift service sees the digest but has no memory of prior headlines; the deck sees neither.
- Rewriting would be paraphrase, which is a second model with none of the first one's context. The normalizer's docstring already establishes this boundary ("Mechanical only… never rewrites content") and the gate honors it.
- Refusal is the only action that cannot itself be wrong. A gate that edits can introduce a new falsehood; a gate that declines cannot.

**Implications:**
- The gate is invisible to `just model-eval` (see [#harness-reach]); its verification is Rust unit tests plus `model-stats` telemetry.
- `apply_emit_outcome`'s existing empty-headline and unchanged-headline early returns are the natural precedent — a refusal is a third reason not to emit.

#### [P04] A refusal re-asks once with the failure named, then holds (DECIDED) {#p04-reask-once}

**Decision:** On refusal, the emitter immediately re-asks the model once, appending a corrective line to the **digest** that names the rejected headline and the specific rule it broke. If the second answer also fails the gate, the previous headline stands until the next tick.

**Rationale:**
- Liveliness is a stated requirement of the pulse. A gate with no recovery path trades a visible wrongness for an invisible staleness (Risk R02).
- A small model told precisely what was wrong with its answer usually produces a better one; a blind retry at temperature 0 would produce the identical answer and is worthless.
- One extra inference on a failing tick is affordable — refusals are the minority case, and the summarize path is already off the user's critical path (unlike classify).

**Implications:**
- The correction rides on the digest because `LocalModelPrompts.summarize` is a compile-time Swift constant and the digest is the only per-request input. This forces bookkeeping care: the re-ask sends `digest + correction` but `EmitOutcome.seen_digest` must record the **original** digest, or `last_digest` dedup breaks and the next tick re-summarizes identical evidence.
- Two log lines per refused tick, distinguishable so `analyze.py` can compute a rescue rate: a refusal line and a re-ask outcome.
- Temperature is 0, so the correction text is the only thing that can change the answer. If re-asks are never rescued in practice, [P04] should be revisited in favor of the cheaper hold-only behavior.

#### [P05] The Rust gate holds no copy of the Swift example list (DECIDED) {#p05-no-example-copy}

**Decision:** The gate detects a lifted prompt example through the grounding rule alone. It does not carry a list of the examples.

**Rationale:**
- Every example in `LocalModelPrompts.summarize` is now disjoint from every corpus digest — that was the fourth-pass decontamination, and `run.py`'s `contamination()` check refuses to score a pair that violates it.
- Disjointness means a lifted example's content words are, by definition, absent from the digest. The grounding rule already rejects it.
- A duplicated example list in Rust would be a second source of truth that goes stale silently the first time someone edits the Swift string — which is precisely the failure mode the corpus freeze test exists to prevent elsewhere.

**Implications:**
- The decontamination is now load-bearing for the gate, not merely for the harness. The `run.py` contamination check becomes a de facto invariant of the gate's correctness, and the summarize docstring's closing instruction ("an example drawn from the corpus is an answer key, not a demonstration") should say so.

#### [P06] The verdict parse matches an exact token; ambiguity stays a refusal, not a synthesized PROMPT (DECIDED) {#p06-exact-token-parse}

**Decision:** `verdict(from:labels:)` tokenizes the model's output and matches a label only against the **first** label-like token, case-insensitively and punctuation-stripped. An output naming two labels, or none, returns `nil` — unchanged from today.

**Rationale:**
- The bug is specifically the ordered `contains` scan against `["shell", "prompt"]`: an output like `PROMPT (not SHELL)` resolves to `shell` today. Fixing the scan is the whole fix.
- Returning `nil` on ambiguity is already safe and already *better instrumented* than synthesizing `prompt` would be. The existing degraded path is: `nil` → `.failure("classification did not name a label")` → the bridge's `requestClassify` returns `null` → `tug-prompt-entry.tsx` routes to Claude because only an explicit `shell` verdict routes. Identical user-visible outcome, but `outcome(of:)` logs it as `refused`, which `model-stats` can count. Synthesizing `prompt` would log `ok` and erase the signal that the prompt is misbehaving.
- Keeping the failure visible matters more here than tidiness, because there is no Swift test to catch a regression (Risk R04).

**Implications:**
- No change to the deck, the bridge, or the degradation contract — the module docstring in `shell-line-classifier.ts` already promises that every degraded path resolves to Claude, and this preserves it exactly.
- `refused` becomes a number worth watching per pack in #step-3.

#### [P07] The shell-shape veto is PROMPT-only, and that is what distinguishes it from the rules that were removed (DECIDED) {#p07-prompt-only-veto}

**Decision:** A pure predicate in `shell-line-classifier.ts` may veto a `shell` verdict, turning it into a route to Claude. It can never produce a `shell` verdict, and it is never consulted on a `prompt` verdict.

**Rationale:**
- The module docstring records that an earlier revision's stopword list, ambiguous-opener list, and token-count rule were deliberately **removed**. Read carefully, the stated reason is that they *pre-empted the model on lines it should have seen* — "the classifier decided `which bun` and `open .` by itself and delegated only the leftovers." Those rules decided **toward shell**, and in doing so they took the irreversible decision away from the model without adding any safety.
- A PROMPT-only veto is the opposite instrument. It cannot pre-empt the model toward shell because it has no power to route to shell. It can only decline to execute, which is the direction the docstring's own asymmetry argument says doubt must resolve: "every degraded path here resolves to Claude… The shell is reached only by an explicit `shell` verdict." The veto adds one more degraded path to that list; it does not create a new way in.
- The distinction is therefore not a loophole in the old decision but an application of the reasoning behind it.

**Implications:**
- The veto's own docstring must make this argument in the module's terms, so the next reader does not mistake it for the return of the deleted rules.
- Applied at the routing decision point in `tug-prompt-entry.tsx`, where `verdict === "shell"` gates `routeToShell()`. It must also be applied before a `shell` verdict enters `ShellVerdictCache`, or a vetoed verdict would be cached and consulted again.
- Pure and DOM-free, so it is a plain `bun:test` file alongside `shell-line-classifier.test.ts`.

#### [P08] The prompt freeze rule protects bake-off comparability, not historical scores (DECIDED) {#p08-freeze-rule-restated}

**Decision:** `LocalModelPrompts`' freeze rule stands, restated: the wording must be identical across every pack in a single bake-off, and editing it is a deliberate act that invalidates the current bake-off and requires re-running it. It no longer claims to protect the scores recorded in `CatalogEntry.notes`, which refer to wordings four rewrites old.

**Rationale:**
- The docstring already concedes the recorded scores are stale and explains why they are not being refreshed. Leaving the freeze rule phrased as though it protects them makes the whole docstring read as bookkeeping nobody maintains.
- The property actually worth protecting is that a three-way comparison is a comparison — same wording, same corpus, same normalizer.

**Implications:**
- The docstring's fifth paragraph is rewritten in #step-5 to say this plainly.
- A future pack added to the catalog is scored on the then-current wording, and the bake-off is re-run rather than its old numbers being compared across wordings.

---

### Deep Dives {#deep-dives}

#### The three packs, and what the registry already ruled out {#rejected-candidates}

**Table T01: The packs on the table** {#t01-packs}

| id | on disk | `model_type` | notes |
|---|---|---|---|
| `ternary-bonsai-8b-2bit` | 2.31 GB | — | Current `recommended: true`. 2-bit ternary. Being retired unless it wins. |
| `qwen3-4b-instruct-2507-4bit` | 2.28 GB | `qwen3` | Current front-runner, `offered: false`. ctx 262144. |
| `lfm25-1-2b-instruct-4bit` | 0.66 GB | `lfm2` | Liquid on-device line, added 2026-07-29 as `offered: false`. ctx 128000. Non-thinking (a separate `Thinking` sibling carries CoT). Smoke answers: 408 ms cold, 268 ms warm, in register. |

The **architecture registry is the first filter on any candidate**, and it is cheap. `LocalModelBackend` imports MLXLLM and resolves a pack through mlx-swift-examples' `LLMModelFactory`, so a pack whose `config.json` `model_type` is unregistered fails the load outright rather than degrading. At the current pin (mlx-swift-examples 2.29.1, mlx-swift 0.29.1) the registry holds: `acereason`, `baichuan_m1`, `bailing_moe`, `bitnet`, `cohere`, `deepseek_v3`, `ernie4_5`, `exaone4`, `falcon_h1`, `gemma`, `gemma2`, `gemma3`, `gemma3_text`, `gemma3n`, `glm4`, `gpt_oss`, `granite`, `granitemoehybrid`, `internlm2`, `lfm2`, `lfm2_moe`, `llama`, `mimo`, `mistral`, `nanochat`, `olmo2`, `olmoe`, `openelm`, `phi`, `phi3`, `phimoe`, `qwen2`, `qwen3`, `qwen3_moe`, `smollm3`, `starcoder2`. This check is now recorded in the `CATALOG` docstring, because skipping it cost a wasted 2.78 GB download.

Three candidates were surveyed and rejected. Do not reopen them without new information:

- **`Qwen3.5-4B`** (Mar 2026, 3.06 GB): thinks by default, and no Instruct/non-thinking variant was released for the 3.5 line — it is an open community request, not an available artifact. With `summarizeMaxTokens = 24` and `classifyMaxTokens = 8`, a pack that emits `<think>` spends its entire budget before saying a word.
- **`gemma-4-E2B-it-qat-4bit`** (Jun 2026): the strongest small pack available and Apache-2.0, but the E-series stores full parameters on disk regardless of "effective" count — 4.36 GB, roughly 1.9× the budget — and `gemma4` is not in the registry either.
- **`Ministral-3-3B-Instruct-2512-4bit`** (Dec 2025, 2.78 GB): the best fit on paper — Mistral's edge line, vendor-documented for text classification and short content generation, non-thinking by construction, 256k ctx. But it is `mistral3` (`Mistral3ForConditionalGeneration`, with a Pixtral vision tower), which appears nowhere in mlx-swift-examples at any version, MLXVLM included. It cannot be loaded without implementing the architecture. Its download was deleted; re-acquiring it is cheap if a future pin adds `mistral3`.

**Table T02: Ruling criteria, in priority order, fixed before the bake-off** {#t02-ruling-criteria}

| Priority | Criterion | Why it ranks here |
|---|---|---|
| 1 | False SHELL count (`just model-classify`) | The only irreversible error in the feature. A pack that executes prose is disqualified regardless of anything else. |
| 2 | Grounding refusal rate + copied-example count (`just model-eval`, `model-stats`) | Measures whether the pack is summarizing or copying. A pack the gate must constantly refuse is not doing the job even if the strip stays honest. |
| 3 | Normalizer rescue count (`just model-eval`) | Register drift the pass rate hides. A pack passing the rubric only after `headline_register_report` rewrites it is drifting. |
| 4 | Download size | A real user-facing cost, already objected to once. A 0.66 GB pack that ties on 1–3 wins. |
| 5 | Median latency, both tasks | Matters, but classify already has a 2000 ms deck deadline all three packs clear comfortably. |
| 6 | Raw register pass rate (`all rules N/13`) | Ranks last deliberately: it is the number that reported 13/13 over a leaking prompt. It is a sanity floor, not a discriminator. |

#### The four failure signatures, with the real answers that produced them {#failure-signatures}

**List L01: Real defective headlines, and which gate rule catches each** {#l01-defects}

These are actual answers observed in production or in the eval harness. Each must be rejected by the gate, and each becomes a Rust unit-test case in #step-4.

1. `Bash make` — against `parts-list-tail`, whose *right now* section opens `- Bash(make)`. Caught by the **tool-name opener** rule (first word is a tool name present in the digest) and independently by **activity restatement** (every content word comes from one activity line). Also fails `verb_first` in `score.py`, but nothing enforced that at runtime.
2. `Write jul29-p…` — the mid-token truncation seen on the strip. Caught by the **path-bearing** rule: the headline's second token came from inside a digest tool target, and `clip` cut it mid-token because a path is one whitespace word and `trim_to_word_budget` cannot fire on it. Fixing the cause removes the symptom; `clip` needs no change.
3. `Fix cursor loss after descend` — returned by `qwen` against `tools-without-prompts`, deterministically, twice. It is example #4 from the decontaminated prompt, verbatim. Caught by **grounding**: the examples are disjoint from every digest ([P05]), so its content words are absent.
4. `Wire schema migration backfill` — returned by `lfm25` on a live tick. It is the positive rewrite inside the prompt's *negative-example* paragraph. Caught by **grounding**, same mechanism.
5. `Fix lagging editor input`, `Fix sed command lagging`, `Fix typing lag in command-line calculator` — the cluster from session `lag/2a4460f9`. Caught by **grounding** where the content words are absent from the digest, and the third also fails `no_article`.

The distribution behind these: 85% `Fix` openers, 13% prompt-example lifts, 8% tool-name openers, 9% path-bearing, out of 1123 headlines. Note that all three packs exhibit lifting — this is not a `bonsai` artifact, which is why [P03] and not a model swap is the fix.

#### Bake-off Results {#bakeoff-results}

Filled in by #step-3 (classify half) and #step-6 (register half). Both halves must be complete before the ruling, per [P02]. `lfm25` has no prior baseline, so its first numbers *are* its baseline.

**Table T03: Classify half — filled by #step-3** {#t03-classify-results}

| pack | accuracy | false SHELL | false PROMPT | shell recall | prompt recall | `refused` | median ms |
|---|---|---|---|---|---|---|---|
| `ternary-bonsai-8b-2bit` | | | | | | | |
| `qwen3-4b-instruct-2507-4bit` | | | | | | | |
| `lfm25-1-2b-instruct-4bit` | | | | | | | |

Pre-change reference, taken against the old parse and no veto, on the decontaminated prompt: `bonsai` 66/71 with 2 false SHELL, 3 false PROMPT, 32/35 shell recall, 623 ms; `qwen` 65/71 with 1 false SHELL, 5 false PROMPT, 30/35 shell recall, 416 ms.

**Table T04: Register half — filled by #step-6** {#t04-register-results}

| pack | `all rules` | rescues | `copied examples` (new prompt) | `copied examples` (old prompt) | mean words | median ms |
|---|---|---|---|---|---|---|
| `ternary-bonsai-8b-2bit` | | | | | | |
| `qwen3-4b-instruct-2507-4bit` | | | | | | |
| `lfm25-1-2b-instruct-4bit` | | | | | | |

Pre-change reference, on the decontaminated prompt with unpaired examples: `bonsai` 12/13 with 5 rescues, mean 5.4 words, 1034 ms, and one outright tool-line copy (`parts-list-tail` → `Bash make`); `qwen` 12/13 with 0 rescues, mean 4.5 words, 620 ms, and 1/13 copied examples.

**The ruling** — written by #step-6, walking Table T02 in order and naming where the packs separated.

---

#### What can and cannot verify the gate {#harness-reach}

There are two summarize log lines, from two different files, and they see different things:

- `local model summarize answered raw=… headline=… normalized=… trimmed=… clipped=…` — emitted in `tugcast/src/local_model.rs`, at the requester. This is what `tests/model-eval/harness.py` scrapes, and therefore what `just model-eval` scores.
- `session overview: summarized raw=… headline=… normalized=… trimmed=… clipped=…` — emitted in `session_overview.rs`, inside the emit path, plus `session overview: emitted` when a frame actually goes out.

The grounding gate lives in the second path only. **`just model-eval` cannot see it**, and a Python reimplementation of the gate inside `run.py` would be a second source of truth that drifts — the same failure that once left the eval corpus scoring bytes the shipping code no longer produced (the README records this). So the gate's verification is split deliberately:

- **Correctness** is Rust unit tests over `tests/model-eval/corpus` — the *same 13 digests* `run.py` uses — plus every entry in List L01. Run by `cargo nextest run -p tugcast session_overview`.
- **Live behavior** is `just model-stats`, which gains a refusal rate and a re-ask rescue rate from the new log lines. `analyze.py --self-test` pins the parser against captured real lines of every shape, so a format drift shows as a zero rather than as silence.
- **The model's own copying** remains `just model-eval`'s `copied examples N/13` line, which is upstream of the gate and is exactly the signal that tells you whether the gate is being asked to work hard.

The same asymmetry applies to the Swift parse fix: with no Swift test target, `just model-classify` through the live app is the falsification instrument (Risk R04).

---

### Specification {#specification}

**Spec S01: The grounding gate** {#s01-grounding-gate}

A pure function in `session_overview.rs`:

```rust
pub enum GroundingVerdict {
    Grounded,
    Ungrounded { rule: &'static str, detail: String },
}

pub fn ground_headline(headline: &str, digest: &str) -> GroundingVerdict
```

It is called on `headline_register_report(&text).text` — after the normalizer, so the gate judges the string the strip would actually wear. It rejects on the first rule that fires, in this order:

1. **Empty** — an empty headline after register. (Already handled by `apply_emit_outcome`; folded in here so one function owns the emit/no-emit question.)
2. **Tool-name opener** — the headline's first word, lowercased, equals the tool name of any activity line in the digest. Activity lines are `Name(target)` or bare `Name` (see `tool_line`), so the tool-name set is derived from the digest itself rather than from a hardcoded list, which means a new Claude tool needs no change here.
3. **Path-bearing** — any headline token contains `/`, or contains the `…` marker that `clip` writes. A bare filename (`session_overview.rs`) is *allowed*: `score.py`'s rubric explicitly exempts identifiers and dotted paths as proper names, and the gate must not contradict the rubric. What is rejected is a path fragment and a clipped token.
4. **Activity restatement** — the headline's content-word set, minus its first word, is a subset of the content words of any single activity line. This is the intent/activity collapse: the headline is repeating what the digest already says the session is doing, instead of naming what it is for.
5. **Ungrounded** — fewer than the [Q02] threshold of the headline's content words (excluding the first word, which is the verb, and excluding a small stopword set) appear anywhere in the digest.

Word comparison uses the same normalization `run.py` settled on, ported to Rust: lowercase, split on hyphen/slash/underscore as well as whitespace, trim surrounding punctuation, and a crude suffix stem (`ing`, `ed`, `es`, `s`, then a trailing `e`) so `restart` matches `restarts` and `resumed`. That normalization exists because the first version of the contamination check compared surface forms and missed two of six known leaks; the same trap applies here.

The first word is exempt from grounding because it is the verb, and a digest of tool lines rarely contains one — `Salvage` will not appear in a digest about a corrupted ledger. This exemption is what makes the threshold in [Q02] a question about the *remaining* words.

**Spec S02: The verdict parse** {#s02-verdict-parse}

```swift
static func verdict(from output: String, labels: [String]) -> String?
```

Tokenize `output` on whitespace and punctuation. Lowercase each token. Walk the tokens in order and collect those that match a label. Return the single match if there is exactly one distinct label matched; return `nil` otherwise — both for "no label named" and for "two labels named". No change to the signature, the call site, or the `nil` contract ([P06]).

The pathology being removed: today `for label in labels where upper.contains(label.uppercased())` walks the *labels* in the caller's order, not the output's, so with `labels = ["shell", "prompt"]` an output of `PROMPT, definitely not SHELL` returns `shell`.

**Spec S03: The shell-shape veto** {#s03-shell-veto}

```typescript
export function vetoesShellVerdict(text: string): boolean
```

Pure, no store reads, no side effects. Returns `true` when a `shell` verdict for `text` must not be honored. Signals, any of which vetoes:

- **Sentence punctuation** outside quotes: a `?`, or a `.` followed by whitespace and a lowercase letter, or a `,` separating two multi-word clauses.
- **Bare English function words** outside quotes and outside a flag value: an article (`the`, `a`, `an`), a subject/object pronoun (`it`, `me`, `this`, `that`, `them`, `you`), or a preposition in prose position (`for`, `about`, `into`, `with` when not preceded by a flag). These are the same signals the classify prompt already tells the model to read as PROMPT, which is why applying them as a veto is consistent with the prompt rather than in tension with it.
- **Prose length**: more tokens than a command plausibly has *and* at least one function word. Length alone must not veto — `rg -n --hidden --glob '!target' TODO src tests` is long and is a command.

Quoting matters: `git commit -m "fix the thing for me"` is a command whose message is prose, and must not be vetoed. The veto therefore strips single- and double-quoted spans before looking for function words.

The veto is applied in `tug-prompt-entry.tsx` at the two places a `shell` verdict is consumed: at the routing decision, and before a `shell` verdict enters `ShellVerdictCache` — a cached vetoed verdict would otherwise be honored on a later submit of the same text.

**Spec S04: The bake-off protocol** {#s04-bakeoff-protocol}

For each pack, in a fixed order, on `debug-main`:

1. `PUT {"kind":"string","value":"<pack-id>"}` to `http://127.0.0.1:<port>/api/defaults/dev.tugtool.local-model/model`. Read `<port>` from `tugutil host instance list`; do not assume it.
2. Send one `summarize` tell to load the weights: `tugutil host tell local_model_summarize --instance debug-main -p "prompt=…"`. **This step is mandatory**, because `classify` deliberately fast-fails `not_resident` against a cold pack — `perform(_:)` returns `.failure("local model not resident")` and starts a background load rather than blocking. A `classify` run against a cold pack scores nothing.
3. `just model-classify debug-main` and `just model-eval debug-main`, each with a `--timeout` generous enough for the first call of the run (45–60 s has been sufficient; the default is 30 s).
4. Record: false SHELL, false PROMPT, shell recall, prompt recall, `refused` count, `copied examples`, normalizer rescue count, `all rules`, mean words, median ms for both tasks.

Two harness gotchas, both previously hit: the tugcast log file is named for the **UTC day**, so a run spanning midnight UTC writes into a new file (`harness.py` picks the newest by mtime, which handles it, but a manual `grep` will not); and a cold load of a multi-gigabyte pack can exceed the default timeout on its own.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/__tests__/shell-verdict-veto.test.ts` | `bun:test` cases for `vetoesShellVerdict` — the two real false-SHELL lines, quoted-prose commands that must survive, long-but-real commands. |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `GroundingVerdict` | enum | `tugrust/crates/tugcast/src/feeds/session_overview.rs` | `Grounded` \| `Ungrounded { rule, detail }`; `rule` is a static string so it can go straight into a log field. |
| `ground_headline` | fn | same | Spec S01. Pure; takes headline and digest. |
| `content_words` | fn | same | Rust port of `run.py`'s `words()` + `stem()` normalization. Private. |
| `digest_tool_names` | fn | same | The tool-name set derived from a digest's activity lines, for Spec S01 rule 2. Private. |
| `GROUNDING_CORRECTION` | const | same | The corrective sentence appended to the digest on a re-ask ([P04]). |
| `emit_one` (existing) | fn | same | Gains the gate call, the one-shot re-ask, and the original-digest bookkeeping. |
| `EmitOutcome` (existing) | struct | same | Gains fields recording refusal rule and whether a re-ask rescued the tick. |
| `verdict(from:labels:)` | static fn | `tugapp/Sources/LocalModelService.swift` | Spec S02. Signature and `nil` contract unchanged. |
| `LocalModelPrompts.summarize` | static let | same | Paired-example rewrite; docstring freeze paragraph restated per [P08]. |
| `vetoesShellVerdict` | fn | `tugdeck/src/lib/shell-line-classifier.ts` | Spec S03. Pure export. |
| `CATALOG` entries | const | `tugrust/crates/tugcast/src/local_model.rs` | `recommended`/`offered`/order set by the ruling. |
| `catalog_is_internally_consistent` | test | same | Gains an assertion that exactly one entry is `offered`. |
| refusal/re-ask parsing | fns | `tests/model-eval/analyze.py` | Refusal rate and re-ask rescue rate; covered by `--self-test`. |

---

### Documentation Plan {#documentation-plan}

- [ ] `tests/model-eval/README.md` — a subsection under "What it cannot tell you" recording that the grounding gate is *not* in this harness's reach and naming what verifies it instead ([#harness-reach]).
- [ ] `tugrust/crates/tugcast/src/feeds/session_overview.rs` — module/function docs for the gate stating the rules and why refusal beats rewriting; no invented rationale, no plan-step numbers.
- [ ] `tugdeck/src/lib/shell-line-classifier.ts` — the veto's docstring must make [P07]'s argument in that module's own terms, so it is not mistaken for the return of the deleted stopword rules.
- [ ] `tugapp/Sources/LocalModelService.swift` — the freeze paragraph restated per [P08].
- [ ] `tugrust/crates/tugcast/src/local_model.rs` — `CATALOG` docstring updated with the ruling's outcome; the architecture-registry note is already there.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | `ground_headline` against the 13 frozen digests and every List L01 defect | The gate's correctness — it is unreachable from the register harness |
| **Unit (bun:test)** | `vetoesShellVerdict` over real command and prose lines | The veto; pure and DOM-free |
| **Contract (Rust)** | `catalog_is_internally_consistent`, `corpus_digests_are_what_compose_digest_produces` | Catalog invariants and corpus freshness |
| **Live harness** | `just model-classify` (gate, one-sided), `just model-eval` (rate), `just model-liveness` (smoke) | Anything that depends on a model's actual output |
| **Batch telemetry** | `just model-stats` | Refusal rate, re-ask rescue rate, headline change rate over real usage |
| **App-test** | `at0280-local-model-absent`, `at0282-pulse-two-level` | Only if the no-model degradation contract or the strip's two-level render changes |

#### What stays out of tests {#test-non-goals}

- **Swift-side logic** — there is no Swift test target in `tugapp/`. Falsified through the real path instead (Risk R04). Standing one up is a follow-on, not this phase.
- **A Python reimplementation of the gate in `run.py`** — a second source of truth that drifts; see [#harness-reach].
- **Mock-store assertion tests for the veto's call site** — banned in this codebase and unnecessary; the veto is a pure function and `tsc --noEmit` already catches interface drift at the call site.
- **New app-tests for the gate** — the refusal path needs a live model and a specific digest, which the transient app-test workspace cannot reliably produce. Covered at the Rust layer and observed in `model-stats`.
- **Latency assertions** — timing is reported by `model-stats` against thresholds, never asserted in a test.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Exact-token verdict parse | pending | — |
| #step-2 | PROMPT-only shell-shape veto | pending | — |
| #step-3 | Routing bake-off — collect classify numbers for three packs | pending | — |
| #step-4 | Grounding gate in Rust | pending | — |
| #step-5 | Paired-example summarize prompt | pending | — |
| #step-6 | Register bake-off and the ruling | pending | — |
| #step-7 | Catalog: promote the winner, retire the rest | pending | — |
| #step-8 | Integration checkpoint — live app, real session | pending | — |

---

#### Step 1: Exact-token verdict parse {#step-1}

**Commit:** `local-model(routing): match a verdict on an exact token, not a substring scan`

**References:** [P06] Exact-token parse, Spec S02, Risk R04, (#context, #harness-reach)

**Artifacts:**
- `LocalModelService.verdict(from:labels:)` rewritten per Spec S02.
- A docstring recording what the parse rejects and why ambiguity stays `nil`.

**Tasks:**
- [ ] Replace the ordered `contains` scan with tokenize-lowercase-match-exactly. Collect all distinct labels named; return the match only when exactly one label was named.
- [ ] Keep the `nil` return for both "no label" and "two labels". Do not synthesize `prompt` — the existing degraded path already lands on Claude and logs `refused`, which is the signal worth keeping ([P06]).
- [ ] Update the function docstring to state the contract; do not narrate the old bug's history.
- [ ] Confirm no other caller exists: `verdict(from:` appears only at its definition and in `perform(_:)`'s `.classify` arm.

**Tests:**
- [ ] None possible in Swift — no test target (see Risk R04). The falsification is the checkpoint below.

**Checkpoint:**
- [ ] `just app-debug` builds, signs, and launches with zero warnings.
- [ ] `just model-classify debug-main` runs green (exit 0, no "were RUN" section) against the currently-selected pack, at no worse accuracy than its recorded baseline.
- [ ] A crafted probe: `tugutil host tell local_model_classify --instance debug-main -p "text=<line>"` for at least three lines from `classify-corpus.json` known to be near the boundary; the log's `verdict=` field must agree with the label in every case, and any ambiguity must appear as `outcome=refused` rather than as a `shell`.

---

#### Step 2: PROMPT-only shell-shape veto {#step-2}

**Depends on:** #step-1

**Commit:** `local-model(routing): veto a shell verdict on a prose-shaped line`

**References:** [P07] PROMPT-only veto, Spec S03, Risk R03, (#context)

**Artifacts:**
- `vetoesShellVerdict` exported from `tugdeck/src/lib/shell-line-classifier.ts`.
- `tugdeck/src/lib/__tests__/shell-verdict-veto.test.ts`.
- The veto applied at both consumption points in `tug-prompt-entry.tsx`.

**Tasks:**
- [ ] Implement `vetoesShellVerdict` per Spec S03: strip quoted spans first, then test sentence punctuation, bare function words in prose position, and prose length gated on a function word being present.
- [ ] Write the docstring so it makes [P07]'s argument in the module's own terms — that the deleted stopword rules decided *toward shell* and pre-empted the model, and that a veto which can only decline to execute is the opposite instrument and follows the same asymmetry the module already documents.
- [ ] Apply the veto where `verdict === "shell"` gates `routeToShell()`, and before a `shell` verdict is written into `ShellVerdictCache`, so a vetoed verdict cannot be honored from cache on a later submit.
- [ ] Fix any pre-existing lint or type findings in the files touched.

**Tests:**
- [ ] `bun:test`: both real 2026-07-29 false-SHELL lines veto — `count the number of lines of code with tokei`, and the 134-character task-list request.
- [ ] `bun:test`: quoted prose survives — `git commit -m "fix the thing for me"`, `rg "the quick brown fox" src`.
- [ ] `bun:test`: long real commands survive — `rg -n --hidden --glob '!target' TODO src tests`, `FOO=1 make test ARGS="--nocapture"`.
- [ ] `bun:test`: every `shell`-labeled case in `classify-corpus.json` survives the veto. Read the corpus in the test so it cannot drift from the harness.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean.
- [ ] `bun test tugdeck/src/lib/__tests__/shell-verdict-veto.test.ts tugdeck/src/lib/__tests__/shell-line-classifier.test.ts` green.
- [ ] `bunx vite build` succeeds — the debug app loads the production bundle, so an import that works under dev esbuild can still hang the app at the splash screen.
- [ ] `just app-test-changed` — the selection will include `at0216-shell-exchange` and `at0280-local-model-absent`, both of which declare `@covers` on `shell-line-classifier`.

---

#### Step 3: Routing bake-off — collect classify numbers for three packs {#step-3}

**Depends on:** #step-2

**Commit:** `local-model(eval): record the three-pack routing bake-off`

**References:** [P01] One pack, [P02] Sequencing, Spec S04, Table T01, Table T02, Risk R05, (#rejected-candidates)

**Artifacts:**
- Table T03 filled in, in this plan document (#bakeoff-results) — classify half only.
- `--json` result files retained under `tests/model-eval/` only if they are small; otherwise the table is the record.

**Tasks:**
- [ ] For each of the three packs in Table T01, run the Spec S04 protocol's classify half. Do not skip the warming `summarize` tell — a cold `classify` scores nothing.
- [ ] Record false SHELL, false PROMPT, shell recall, prompt recall, `refused` count, and median ms per pack.
- [ ] Do **not** rule yet. The ruling needs both halves and happens in #step-6 ([P02]).
- [ ] Note explicitly in the results whether the veto or the parse fix was what removed each previously-observed false SHELL — if the parse fix alone removed them, the veto's value is prospective and that should be said plainly rather than implied.

**Tests:**
- [ ] No new tests; this step runs existing harnesses.

**Checkpoint:**
- [ ] `just model-classify debug-main` exits 0 for all three packs — zero false SHELL each. A pack that cannot reach zero here is disqualified under Table T02 priority 1, and that disqualification is recorded.
- [ ] Shell recall for each pack is no lower than its pre-change baseline (`qwen` 30/35, `bonsai` 32/35; `lfm25` has no baseline, so its first number *is* the baseline).
- [ ] The results table is in the plan document with all three packs' rows filled.

---

#### Step 4: Grounding gate in Rust {#step-4}

**Depends on:** #step-3

**Commit:** `session-overview(pulse): refuse a headline the digest does not support`

**References:** [P03] Gate in Rust, [P04] Re-ask once, [P05] No example copy, [Q02] Grounding threshold, Spec S01, List L01, Risk R02, (#harness-reach, #failure-signatures)

**Artifacts:**
- `GroundingVerdict`, `ground_headline`, `content_words`, `digest_tool_names`, `GROUNDING_CORRECTION` in `session_overview.rs`.
- The gate wired into `emit_one` with a one-shot corrective re-ask.
- `EmitOutcome` carrying the refusal rule and the rescue flag.
- Two new log lines.

**Tasks:**
- [ ] Resolve [Q02] first, as a spike: sweep the threshold over the 13 frozen digests, the per-pack headlines from `run.py --json`, and every List L01 defect. Pick the value that rejects all of L01 while accepting every headline a human reads as correct. Record the sweep and the chosen value in the commit body.
- [ ] Implement `content_words` as a Rust port of `run.py`'s `words()`/`stem()` — hyphen/slash/underscore split, punctuation trim, crude suffix stem. Surface-form comparison is not sufficient; that mistake already cost two missed leaks in the contamination check.
- [ ] Implement `ground_headline` per Spec S01, rejecting on the first rule that fires, in the specified order.
- [ ] Wire it into `emit_one` after `headline_register_report`. On `Ungrounded`, log a refusal line carrying the rule and the rejected text, then re-ask once with `GROUNDING_CORRECTION` appended to the digest, naming the rejected headline and the rule.
- [ ] **Bookkeeping:** set `EmitOutcome.seen_digest` to the **original** digest, not the corrected one, or `last_digest` dedup breaks and the next tick re-summarizes identical evidence.
- [ ] If the second answer also refuses, emit nothing — the previous headline stands. Fold `apply_emit_outcome`'s existing empty-headline check into the gate so one function owns the emit/no-emit question.
- [ ] Do not add a Rust copy of the Swift example list ([P05]).
- [ ] Add refusal-rate and re-ask-rescue-rate reporting to `tests/model-eval/analyze.py`, and add the new log lines to its `--self-test` fixtures.

**Tests:**
- [ ] Rust unit: every entry in List L01 is refused, each by its expected rule.
- [ ] Rust unit: for each of the 13 frozen digests, at least one hand-written correct headline is accepted. This is the false-positive guard and it is the test that keeps Risk R02 honest.
- [ ] Rust unit: a bare filename headline (`Trace session_overview.rs regression`) is accepted while a path-bearing one (`Write /tmp/calc/calc.c`) and a clipped one (`Write jul29-p…`) are refused — the gate must not contradict `score.py`'s identifier exemption.
- [ ] Rust unit: `seen_digest` records the original digest across a re-ask.
- [ ] Rust unit: a second refusal emits no frame and leaves `last_headline` untouched.
- [ ] `python3 tests/model-eval/analyze.py --self-test` covers the new lines.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast session_overview` green, zero warnings.
- [ ] `cd tugrust && cargo nextest run` fully green.
- [ ] `python3 tests/model-eval/analyze.py --self-test` passes.
- [ ] `just app-debug`, then leave a real session running and confirm from `just model-stats debug-main` that a refusal rate is reported and is below ~20% of ticks. Above that, stop and revisit [Q02] rather than proceeding.

---

#### Step 5: Paired-example summarize prompt {#step-5}

**Depends on:** #step-4

**Commit:** `local-model(pulse): pair the summarize examples with the digests they answer`

**References:** [P08] Freeze rule restated, [P05] No example copy, [Q01] Pairing effect, List L01, (#context, #failure-signatures)

**Artifacts:**
- `LocalModelPrompts.summarize` rewritten with paired input/output examples.
- The docstring's freeze paragraph restated per [P08].

**Tasks:**
- [ ] Rewrite the example block as input/output pairs, following `LocalModelPrompts.classify`'s shape — that block teaches by pairing and exhibits neither the monoculture nor the lifting.
- [ ] Give each example a miniature digest as its input, using the real section headings (`What the user asked for:` / `What the session has been doing:` / `What it is doing right now:`) and the real `Name(target)` activity-line form, so the model sees the shape it will actually be given.
- [ ] Vary the opening verbs deliberately to attack the 85% `Fix` monoculture. Every verb used must be on `tests/model-eval/verbs.txt`, or added to it with justification — the file is a closed list and a headline opening off-list scores a miss on purpose.
- [ ] Keep every example subject disjoint from all 13 digests in `tests/model-eval/corpus`. `run.py` exits 2 and names the offending pair if this is violated, so run it as a preflight before spending inference.
- [ ] Include a paired example that demonstrates *not* headlining the activity line — an input whose *right now* section is a tool line, with an output that names the purpose rather than the tool. This is the pathology the gate catches; the prompt should try to prevent it.
- [ ] Restate the docstring's freeze paragraph per [P08]: the freeze protects comparability within one bake-off, and no longer claims to protect the `CatalogEntry.notes` scores, which are four wordings stale.
- [ ] Do not touch `classify`, `generate`, or any of the token budgets.

**Tests:**
- [ ] No unit tests possible (no Swift test target). The register bake-off in #step-6 is the measurement.

**Checkpoint:**
- [ ] `just app-debug` builds and launches with zero warnings.
- [ ] `python3 tests/model-eval/run.py debug-main` does **not** exit 2 — the new examples are disjoint from the corpus.
- [ ] `just model-liveness debug-main` passes: one digest comes back, non-empty, inside the summarize ceiling.

---

#### Step 6: Register bake-off and the ruling {#step-6}

**Depends on:** #step-5

**Commit:** `local-model(eval): rule the three-pack bake-off and record the numbers`

**References:** [P01] One pack, [P02] Sequencing, [Q01] Pairing effect, [Q03] LFM capacity, Spec S04, Table T02, Risk R01, (#bakeoff-results)

**Artifacts:**
- Table T04 filled in (#bakeoff-results), completing the register half for all three packs.
- A written ruling naming the winner and citing Table T02 priority by priority.
- [Q01] and [Q03] marked resolved with their evidence.

**Tasks:**
- [ ] Run the Spec S04 protocol's register half for all three packs against the new prompt. Record `all rules`, normalizer rescue count, `copied examples`, mean words, median ms.
- [ ] For [Q01], also record `copied examples` per pack against the *previous* prompt wording, so the pairing effect is a comparison rather than an assertion. The old wording is recoverable from git.
- [ ] Rule, walking Table T02 in order and stating where the packs separated. If the ruling contradicts the earlier two-pack read, say so plainly rather than reconciling.
- [ ] Resolve [Q01] and [Q03] in this document with their numbers.
- [ ] If the winner has vendor-recommended sampling parameters differing from what `LocalModelJob` sends (temperature 0 today), fold that change in here and re-run its two harnesses — do not leave it implicit.

**Tests:**
- [ ] No new tests; existing harnesses.

**Checkpoint:**
- [ ] `just model-eval debug-main` run for all three packs, with `copied examples 0/13` for the winner. A non-zero count for the winner means the prompt rewrite did not do its job and the gate is carrying the whole load — record that and proceed, since the gate makes it safe, but say it explicitly.
- [ ] `just model-classify debug-main` re-run for the winner after any sampling-parameter change, still exit 0.
- [ ] The ruling is written into this document with the winner named and Table T02 walked in order.

---

#### Step 7: Catalog — promote the winner, retire the rest {#step-7}

**Depends on:** #step-6

**Commit:** `local-model(catalog): offer one pack for both on-device jobs`

**References:** [P01] One pack, [Q04] Retired-pack behavior, Table T01, (#rejected-candidates)

**Artifacts:**
- `CATALOG` in `local_model.rs` with the winner `recommended: true, offered: true`, the others `offered: false`.
- `catalog_rank` order reflecting the ruling.
- An extended `catalog_is_internally_consistent`.
- `notes` strings that describe the pack rather than quoting stale scores.

**Tasks:**
- [ ] Reorder `CATALOG` so the winner is index 0 — `catalog_rank` is position, and `auto` resolves by it, so ordering is the mechanism by which a user on `auto` moves to the winner.
- [ ] Set `recommended`/`offered` so exactly one entry is each.
- [ ] Extend `catalog_is_internally_consistent` with an assertion that exactly one entry is `offered`, alongside the existing exactly-one-`recommended` assertion.
- [ ] Rewrite each `notes` string to describe what the pack is, not what it once scored. The docstring already concedes the historical figures are stale; leaving them in `notes` propagates them.
- [ ] Verify [Q04]'s conclusion by inspection rather than assumption: a user holding a now-retired pack on an explicit selection keeps it (`resolveRoute` honors an explicit pick literally, and returns "no local model" rather than substituting if it is gone); a user on `auto` moves to the winner if installed. The existing `local_model_delete` control frame is the reclamation path and needs no new UI.
- [ ] Confirm nothing keys off a pack id as a string literal anywhere outside `CATALOG` and the eval corpus.

**Tests:**
- [ ] Rust: `catalog_is_internally_consistent` with the new `offered` assertion.
- [ ] Rust: `file_url_pins_the_revision` still passes — it indexes `CATALOG` by id, not position, so reordering is safe, but confirm rather than assume.
- [ ] `bun test tugdeck/src/lib/__tests__/local-model-store.test.ts` — the store's action set includes `local_model_delete`, and the picker must render the new ordering.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` fully green, zero warnings.
- [ ] `tugutil host tell local_model_inventory --instance debug-main` reports exactly one offered pack, with the winner first.
- [ ] With the tugbank selection cleared to `auto`, a fresh `summarize` tell resolves to the winner — read `model=` from the app's own request log line.

---

#### Step 8: Integration checkpoint — live app, real session {#step-8}

**Depends on:** #step-1, #step-2, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [P03] Gate in Rust, [P04] Re-ask once, [P06] Exact-token parse, [P07] PROMPT-only veto, Risk R02, (#success-criteria, #harness-reach)

**Tasks:**
- [ ] Run a real working session against `debug-main` long enough to produce a dozen headline ticks, and read every headline on the strip against what the session was actually doing. This is the check no harness performs and the one the user's original complaint came from.
- [ ] Type both real false-SHELL lines into the composer and confirm each routes to Claude.
- [ ] Type several genuine commands (`git status`, `make test`, `rg TODO src`, `head Justfile`) and confirm each still routes to the shell — the veto must not have collapsed the feature it protects.
- [ ] Read `just model-stats debug-main` and confirm the refusal rate, the re-ask rescue rate, and the headline change rate are all reported and within the bounds in [#success-criteria].

**Tests:**
- [ ] `just app-test-changed` for the full accumulated diff of the phase.
- [ ] If the advisory prints CORE TIER ADVISED, run `just app-test` (the ~20-file core tier) and move on. Do not run the full corpus.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` green; `bun test` green; `bunx tsc --noEmit` clean; `bunx vite build` succeeds.
- [ ] `just model-classify debug-main` exit 0; `just model-eval debug-main` shows `copied examples 0/13`; `just model-liveness debug-main` passes.
- [ ] No headline observed during the live session misdescribes the work. A single misdescription is a phase failure, not a rounding error — that is what "trustworthy" means here.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** One on-device pack serving both PULSE headlines and shell routing, where a headline the digest does not support never reaches the strip and a prose line the model calls `shell` cannot execute.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `just model-classify` exits 0 for the shipping pack with zero false SHELL and shell recall no worse than baseline.
- [ ] Both real 2026-07-29 false-SHELL lines route to Claude, verified live in the app and in the corpus.
- [ ] `ground_headline` refuses every defect in List L01 and accepts a correct headline for all 13 frozen digests (`cargo nextest run -p tugcast session_overview`).
- [ ] `just model-eval` reports `copied examples 0/13` for the shipping pack.
- [ ] `just model-stats` reports a grounding refusal rate and a re-ask rescue rate; refusal rate below ~20% of ticks and headline change rate not below its pre-change value.
- [ ] Exactly one `CATALOG` entry is `offered`, asserted by `catalog_is_internally_consistent`.
- [ ] Zero warnings across `cargo nextest run`, `bunx tsc --noEmit`, and `bunx vite build`.
- [ ] A live session's headlines read correctly to a human (#step-8).

**Acceptance tests:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `bun test` (full pure-logic suite)
- [ ] `just app-test-changed`
- [ ] `just model-classify debug-main`, `just model-eval debug-main`, `just model-liveness debug-main`, `just model-stats debug-main`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **A Swift test target for `tugapp/`.** Risk R04 is structural: the logic that decides whether a command executes has no unit test because there is nowhere to put one.
- [ ] **Constrained decoding for classify**, if the veto proves insufficient — it would make a malformed verdict impossible rather than caught.
- [ ] **Re-evaluate `mistral3` and `gemma4`** when the mlx-swift-examples pin next moves; both families were ruled out on the registry alone, not on quality.
- [ ] **Retire `ternary-bonsai-8b-2bit` from `CATALOG` entirely** once no installed base holds it, rather than leaving it as a permanent `offered: false` entry.
- [ ] **Reconsider [P04]** if the re-ask rescue rate proves near zero — the cheaper hold-only behavior would then be strictly better.

| Checkpoint | Verification |
|------------|--------------|
| Prose can no longer execute | `just model-classify` exit 0; both real false-SHELL lines typed live route to Claude |
| Commands still execute | `git status`, `make test`, `rg TODO src`, `head Justfile` all route to the shell live; shell recall at or above baseline |
| Headlines are grounded | `cargo nextest run -p tugcast session_overview`; `copied examples 0/13`; live read in #step-8 |
| Truth was not bought with silence | `just model-stats`: refusal rate under ~20%, headline change rate not regressed |
| One pack ships | `catalog_is_internally_consistent`; `local_model_inventory` shows one offered entry |
