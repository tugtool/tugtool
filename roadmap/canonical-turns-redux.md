<!-- devise-skeleton v4 -->

## Canonical Turns Redux — origin-first turns, one count engine {#canonical-turns-redux}

**Purpose:** Make a session's turn count honest, attribution-faithful, and identical at every touch point, by reworking the turn model so each turn carries an intrinsic origin (never inferred, never faked) and by making one segmentation engine the single producer of the count that both the picker and the resume authority consume.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (implemented on a `tugutil dash` worktree) |
| Last updated | 2026-06-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The original canonical-turns project (Phase 1 + 2, merged to main) aimed to make one turn count agree everywhere. It failed on real sessions: session `49e9aec6` showed **59** in the picker, **81** once opened, then **81** in the picker only after a resume reconciled the ledger. Root-cause audit (read-only) found two faults and one meta-cause:

- **Two counting models.** tugcode opens a turn from two sources — a real `type:user` submission (`handleUserEntry`) *and* a synthesized empty `add_user_message` (`content: []`) minted by `handleAssistantEntry` whenever assistant output arrives with no open turn (`--continue`, `/compact`, a skipped slash/`isMeta` user side, or a leading orphan). That synthesized opener counts as a turn and **renders as a phantom user row** (the unexplained `#u0020`). The disk scanner mirrors only the user-entry path and never models assistant-originated openers, so it cannot reproduce the count.
- **Cache below its own rule.** A faithful full application of the scanner's documented rule yields 66, but the cache held 59 — the incremental resume path drops openers a full scan would catch.
- **Meta-cause.** The "four-way equality" was proven only on a small, hand-built, privacy-sanitized golden corpus that omitted every hard real shape (assistant-originated turns, `/compact`, slash commands, leading orphans, incremental tails). The contract test stayed green while real sessions diverged, and the scanner's Rust rule was a hand-mirror of one of tugcode's two opener paths.

The deeper defect is a data-model lie: attribution is *inferred* from `messages[0].kind === "user_message"`, and the only way to mint a turn container was a user (or wake) opener — so orphan assistant content was forced into a fake user message. We will not patch this; we will redesign so the lie is unrepresentable and the count has a single producer.

#### Strategy {#strategy}

- **Origin-first, not turn-first.** A turn is a container with an *intrinsic, stated* origin. The user-message slot exists only when the user actually submitted — fabricating one becomes impossible by construction ([P01]).
- **Assistant-originated turns are first-class.** Wakes, `/compact` continuations, `--continue` leading orphans, and any orphan assistant output open an *assistant-originated* turn: no user row, no fake user message, addressed `#a{turn}` ([P02], [P03]). The existing wake path already proves this shape works end to end.
- **One engine produces the count.** A single Rust segmentation engine in tugcast parses a session into ordered, origin-tagged turns and is the sole producer of the count for *both* the picker (pre-open scan) and the resume authority. tugcode's rendering segmentation is held byte-for-byte equal to the engine by a contract over real sessions ([P05]).
- **The count never shifts.** Because the picker count and the authority count come from the same producer, a session shows the same number before and after it is opened ([P06]).
- **All containers count, honestly attributed.** "N turns" is the count of turn containers; each is `#u` (user) or `#a` (assistant); no `#x` ([P03], [P04]).
- **Verify against reality.** Drive verification from the real local session corpus, not curated fixtures; delete the sanitized golden corpus; accept local-only tests; freely alter or delete tests that no longer hold the bar ([P07]).

#### Success Criteria (Measurable) {#success-criteria}

- For every session JSONL under the active project's real corpus, the engine's turn count equals tugcode/tugdeck's rendered turn count (highest `#a`/`#u` address) — 100%, including sessions with `--continue`, `/compact`, slash commands, wakes, and leading orphans. (Contract test over the real corpus, #step-7.)
- Session `49e9aec6` shows the **same** turn number in the picker before it is opened and after it is opened and closed; that number equals the highest rendered address. (Real-app check, #step-9.)
- No turn the user did not initiate renders a user row, and tugcode emits **zero** `add_user_message` frames with empty content. (Code grep + render inspection, #step-5, #step-9.)
- The picker's turn count is produced by the engine, not a separate estimator that is later reconciled — verified by removing the seed-then-reconcile path and confirming no count mutation occurs on resume for an unchanged file. (#step-4, #step-9.)

#### Scope {#scope}

1. A single Rust turn-segmentation engine in tugcast that yields ordered, origin-tagged turns and the canonical count.
2. The disk scan / picker count sourced from the engine; cache keyed and epoch-bumped; incremental scan made correct.
3. The resume authority sourced from the engine so picker == authority (no shift).
4. tugcode opener vocabulary: an honest assistant-originated opener replaces the synthesized empty `add_user_message` (replay and live).
5. tugdeck turn model: origin-explicit `TurnEntry`; assistant-originated turns render assistant-only; `#u`/`#a` per row, no `#x`.
6. A real-session contract gating tugcode/tugdeck segmentation against the engine, plus deletion of the sanitized golden corpus.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Shell (`#s`) turns — the origin model reserves the prefix but no shell rendering ships here.
- Redesigning transcript rendering beyond turn origin and per-row addressing.
- Changing the live streaming wire beyond the opener-vocabulary change.
- Re-deciding the `#u`/`#a` marker placement (already settled: one address per attribution row, right-aligned).

#### Dependencies / Prerequisites {#dependencies}

- The merged canonical-turns Phase 1+2 work on main (the wire window metadata, the `#u`/`#a` rendering, the picker subtitle) — this plan reworks the count production beneath them.
- Read access to the real local session corpus (`~/.claude/projects/<project>/*.jsonl`) for verification.

#### Constraints {#constraints}

- Rust workspace is warnings-as-errors (`-D warnings`).
- tugcode is bun-compiled — rebuild after edits; no HMR. tugdeck is HMR-live.
- Real-app behavior verified via `just app-test` (greppable `VERDICT: PASS|FAIL`); pure logic via `bun:test` / `cargo nextest`. Banned: fake-DOM/RTL, mock-store assertion tests.
- The disk scan must stay fast on multi-hundred-MB sessions (the incremental-resume design exists for this reason and must be preserved, but made correct).

#### Assumptions {#assumptions}

- The count value for existing sessions does not need to change (all containers still count); only attribution honesty and picker correctness change. The synthesized openers that were counted (e.g. the 15 in `49e9aec6`) remain counted — now as honest `#a` turns, not phantom `#u` rows.
- A faithful Rust engine can reproduce tugcode's segmentation decisions; where it cannot, that is a bug in one of them surfaced by the contract.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Standard devise-skeleton conventions apply: explicit kebab-case anchors, `[P##]` plan-local decisions, `[Q##]` open questions, `Spec S##`, `Risk R##`, two-digit IDs, `**Depends on:**` by anchor, rich `**References:**` lines, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] How does tugcode obtain the engine's count for the wire window metadata? (OPEN) {#q01-wire-count-source}

**Question:** The client needs `totalTurns` / `firstLoadedTurnIndex` on `replay_complete` for windowing. If the Rust engine is the single count producer, tugcode (which emits the wire frame) must source the count from it rather than computing its own.

**Why it matters:** If tugcode computes its own `totalTurns` independently, we are back to two producers and the same drift risk this plan exists to kill.

**Options (if known):**
- tugcast stamps/overrides the wire `totalTurns` (and the window indices) from the engine after tugcode translates — tugcode never authors the count.
- tugcode requests the engine's segmentation (turn boundaries by byte offset) from tugcast and uses it both to slice the window and to report the count.
- tugcode computes the count and it is held equal to the engine by the #step-7 contract (weakest; two producers).

**Plan to resolve:** Spike in #step-4 — inspect where `replay_complete` window metadata is assembled (tugcode `resolveWindow`) and where tugcast reconciles it (`parse_replay_complete_total_turns`), and pick the path that leaves exactly one count producer.

**Resolution:** OPEN — resolve during #step-4; default lean is the engine-stamps-the-wire path.

#### [Q02] Counting policy and addressing for non-user turns (DECIDED) {#q02-counting-policy}

**Question:** Do wakes and continuation/orphan turns count, and how are they addressed?

**Resolution:** DECIDED (see [P03], [P04]). Yes — every turn container counts. There is **no `#x`**: wakes and continuations are the assistant speaking, rendered assistant-only and addressed `#a{turn}`. `#u` appears only for genuine user submissions.

#### [Q03] Engine cost at scan time on large/incremental files (OPEN) {#q03-engine-incremental-cost}

**Question:** The engine must run at scan time for the picker, including incremental appends to live multi-hundred-MB sessions, without the undercount that the old incremental path exhibited.

**Why it matters:** Correctness regressed precisely in the incremental path (cache 59 vs full 66). A naive "full re-segment every scan" is correct but may be too slow.

**Plan to resolve:** #step-2/#step-3 — design the engine so incremental resume carries forward *engine state* (open-turn state at the frontier), not just a count, and test the incremental append path explicitly on a real growing session.

**Resolution:** OPEN — resolve in #step-2/#step-3.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Engine (Rust) and tugcode (TS) segmentation drift | high | med | Real-corpus contract on count + per-turn origin; runtime highest-badge == engine assertion | any contract failure |
| Incremental scan undercount recurs | high | med | Carry engine state across the frontier; test real incremental appends | count != full re-scan |
| Migration of stale ledger/cache counts | med | high | Epoch bump invalidates caches; re-scan on next list | wrong count after upgrade |
| Realistic corpus is local-only (not CI-portable) | med | high | Accept local-only verification; document; keep a small portable smoke set drawn from real shapes | CI needs a gate |

**Risk R01: Two-language segmentation drift** {#r01-segmentation-drift}

- **Risk:** The engine and tugcode's rendering segmentation disagree on some real session shape not in the corpus.
- **Mitigation:** Contract over the *full* real local corpus (not a sample); a runtime invariant that the highest rendered address equals the engine count; the contract is the gate for every step that touches segmentation.
- **Residual risk:** Live-only event orderings never written to any JSONL cannot be in a file-based corpus; covered only by `just app-test` live drives.

**Risk R02: Incremental correctness** {#r02-incremental-correctness}

- **Risk:** The fast incremental scan path diverges from a full segmentation (the original Gap #2).
- **Mitigation:** The resume seed persists open-turn engine state, not just an offset+count; an explicit test appends to a real session and asserts incremental == full.
- **Residual risk:** A prefix rewrite mid-session forces a full re-parse (already handled by the tail-fingerprint check).

**Risk R03: Headline count change for some sessions** {#r03-count-change}

- **Risk:** If the engine's honest segmentation differs from tugcode's current total for some session, the displayed count changes on upgrade.
- **Mitigation:** The engine is built to reproduce tugcode's *current* total (all containers count), so values are expected to be stable; any change is a real correction surfaced by the contract, not silent.
- **Residual risk:** A genuinely mis-counted historical session will show a corrected number — acceptable and desirable.

---

### Design Decisions {#design-decisions}

#### [P01] Origin is intrinsic and unforgeable; no fabricated user messages (DECIDED) {#p01-origin-intrinsic}

**Decision:** Every turn carries an explicit origin set by its producer; a user message exists in a turn only when the user actually submitted one. The model makes "a non-user turn presented as a user action" structurally impossible.

**Rationale:**
- The original lie (`add_user_message{content:[]}`) came from inferring attribution from `messages[0].kind` and welding container-creation to a user opener.
- Honesty to user actions is a non-negotiable invariant: code-constructed entities must never masquerade as something the user did.

**Implications:**
- The synthesized empty `add_user_message` is deleted from tugcode (replay synth and the live empty-opener follow-up).
- `TurnEntry` no longer infers user-ness from `messages[0]`; origin is a first-class property of the turn produced by the wire opener.

#### [P02] A turn is an origin-explicit container; assistant-originated turns are first-class (DECIDED) {#p02-container}

**Decision:** Opening a container to hold assistant output is distinct from asserting a user action. Wakes, `/compact` continuations, `--continue` leading orphans, and orphan assistant output open an *assistant-originated* turn — no user row, no user message — exactly as a wake turn already does.

**Rationale:**
- The reducer genuinely needs a container (`pendingTurn`) for assistant content; the wake path already creates one honestly without a user message.
- Unifying all non-user openers onto one honest mechanism removes the special-case fabrication.

**Implications:**
- A single non-user opener mechanism replaces both `wake_started`'s ad-hoc handling and the synthesized user opener; the open primitive is origin-parameterized and seeds an empty message scratch for `origin: "assistant"` (Spec S02).
- `PendingTurn`/`TurnEntry` gain `origin`; the `isWake` boolean and the `messages[0]` user-ness inference are removed; `wakeTrigger` remains an optional annotation on an assistant-origin turn.
- Row layout: an assistant-originated turn is one assistant row (no user row), like a wake today.

#### [P03] Per-row addressing by speaker: `#u`, `#a`, `#s`; no `#x` (DECIDED) {#p03-addressing}

**Decision:** Each attribution row is addressed `#{speaker}{turn}`: `#u` user, `#a` assistant, `#s` shell (reserved). Wakes and continuations are the assistant speaking → `#a`. There is no "other" prefix.

**Rationale:**
- The visible content of a wake/continuation turn is assistant output; attributing it to the assistant is honest and keeps the scheme to the actual speakers.

**Implications:**
- A user turn renders `#u{turn}` (user row) + `#a{turn}` (assistant row), sharing the turn number.
- An assistant-originated turn renders only `#a{turn}`.

#### [P04] All turn containers count toward the canonical total (DECIDED) {#p04-count-all}

**Decision:** "N turns" is the count of turn containers — user-originated and assistant-originated alike — each honestly attributed.

**Rationale:**
- Each container is a real unit of conversational activity; the user chose total-activity semantics.
- Keeps the value stable vs today's tugcode total (which already counts the synthesized openers), so the change is attribution + correctness, not a renumber.

**Implications:**
- The engine counts every container; the picker headline equals the highest rendered address.

#### [P05] One segmentation engine is the single count producer (DECIDED) {#p05-one-engine}

**Decision:** A single Rust engine in tugcast segments a session into ordered, origin-tagged turns and produces the canonical count for *both* the picker scan and the resume authority. tugcode/tugdeck rendering segmentation is held equal to the engine by a contract over real sessions ([P07]).

**Rationale:**
- The divergence came from two implementations (tugcode TS authority + scanner Rust mirror) that were destined to drift.
- One producer for the *number* eliminates the class of bug; rendering equality is then a verified property, not a second source of truth.

**Implications:**
- The scanner's `user_submission_opens_turn` counting is replaced by the full engine.
- The resume reconcile reads the engine, not a tugcode-authored total (see [Q01]).

#### [P06] The picker count never shifts (DECIDED) {#p06-no-shift}

**Decision:** The picker's turn count is the engine's count — identical before and after a session is opened. There is no seed-from-estimate-then-reconcile-to-a-different-number path.

**Rationale:**
- A number that changes when you open a session is the precise symptom the user rejected.

**Implications:**
- Remove the path where a divergent scan estimate seeds the ledger and a resume later overwrites it with a different value.
- For an unchanged file, opening a session causes no count mutation.

#### [P07] Verify against the real local corpus; no sanitized fixtures (DECIDED) {#p07-real-corpus}

**Decision:** Drive verification from the real local session corpus where it sits; delete the sanitized golden corpus; permit local-only (non-checked-in) verification; freely alter or delete tests that no longer hold the bar.

**Rationale:**
- The narrow, privacy-sanitized golden corpus is exactly why the gaps survived. Correctness against real data outranks a checkable, portable fixture.

**Implications:**
- The contract (#step-7) runs over `~/.claude/projects/<project>/*.jsonl`.
- `scanner_turn_counts_match_golden_corpus` and its fixtures are removed or repurposed.
- A small portable smoke set may be kept, but only if drawn from real shapes (continue/compact/slash/wake/orphan), never invented-tidy.

---

### Specification {#specification}

**Spec S01: Turn origin model** {#s01-origin-model}

A session is an ordered list of **turns**. Each turn has:
- an `origin`: `user` | `assistant` (shell reserved, not emitted this phase);
- a `messages` sequence (the [D07] content substrate);
- a user message present **iff** `origin === user`.

A turn opens when:
- a genuine user submission arrives (`origin: user`) — excludes `isMeta`, interrupt marker, tool-result-only, `/compact` summary, slash-command scaffolding; or
- assistant content arrives with no open turn — a wake/`<task-notification>`, a `/compact` continuation, a `--continue` leading orphan, or any orphan assistant output (`origin: assistant`).

The canonical count = number of turns (all origins). The highest rendered address equals the count.

**Spec S02: Honest opener vocabulary and turn construction** {#s02-opener-vocabulary}

*Wire openers:*
- `add_user_message` is emitted **only** for a genuine user submission, and never with empty/synthetic content.
- A **neutral assistant-originated opener** (no wake baggage) opens an `origin: assistant` turn with no user message. A **wake** is this same opener carrying an optional `wakeTrigger` annotation — the wake is an *annotation on* an assistant-originated turn, not a distinct attribution path. (`wake_started` is either generalized into this opener or retained as the annotated variant.)
- The synthesized `add_user_message{content:[]}` in `handleAssistantEntry` (replay) and the live empty-opener follow-up in `session.ts` are removed.

*Reducer construction (how a no-user-content turn is built):* The reducer already builds a no-user-content turn for wakes — `handleWakeStarted` opens a `pendingTurn` and seeds the turn's message scratch **empty** (no `user_message`), whereas `handleAddUserMessage` seeds it with a `user_message`. This plan makes that primitive explicit and origin-parameterized:
- `PendingTurn` and `TurnEntry` carry a first-class `origin: "user" | "assistant"` (shell reserved). This **replaces** the `isWake: boolean` discriminator and the `messages[0]?.kind === "user_message"` inference. The boolean and the inference are removed; `wakeTrigger` survives only as an optional annotation on an `origin: "assistant"` turn.
- A single open primitive opens a turn with a given `origin` and seeds the scratch with `[userMessage]` **iff** `origin === "user"`, else `[]`. The no-user-content turn is the natural product of opening with `origin: "assistant"` — there is no `user_message` to fabricate.
- Layout / addressing reads `origin` (not `messages[0]`): `origin: "user"` → user row (`#u`) + assistant row (`#a`); `origin: "assistant"` → assistant row only (`#a`).

**Spec S03: Count production and consumption** {#s03-count-production}

- The Rust engine (`turn_engine`) is the sole count producer.
- Picker: the disk scan runs the engine; the cache stores the engine's output (count + origins + frontier state), keyed by `(file_size, file_mtime, rule_epoch)`; `rule_epoch` is bumped.
- Authority: on resume, the count for the ledger and the wire window metadata is sourced from the engine (see [Q01]); the picker and authority counts are therefore equal by construction.

#### State Zone Mapping (tugdeck) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `TurnEntry.origin` (per-turn attribution) | local-data | store/reducer → snapshot, read via `useSyncExternalStore` | [L02] |
| Has-user-row / assistant-only layout decision | structure (derived) | pure derivation from `origin` in the row layout | [L02] |
| `#u`/`#a` per-row address | appearance (derived from data) | rendered from `origin` + turn number; no React state | [L06] |
| Turn number base (`firstLoadedTurnIndex`) | local-data | existing `useSyncExternalStore` selector | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/turn_engine.rs` (or module) | The single segmentation engine: JSONL → ordered origin-tagged turns + count + frontier state |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TurnOrigin` | enum | `tugcast/src/turn_engine.rs` | `User` \| `Assistant` (`Shell` reserved) |
| `segment_turns` | fn | `tugcast/src/turn_engine.rs` | The engine; pure over a parsed JSONL stream + carry-in frontier state |
| `user_submission_opens_turn` | fn (remove/fold) | `tugcast/src/external_sessions.rs` | Replaced by the engine; the user-record-only counting is deleted |
| neutral assistant-originated opener | wire type / emit | `tugcode/src/types.ts`, `replay.ts`, `session.ts` | No wake baggage; wake = this opener + optional `wakeTrigger` annotation; delete synth `add_user_message` |
| `origin` on `PendingTurn` + `TurnEntry` | field | `tugdeck/src/lib/code-session-store/types.ts` | `"user" \| "assistant"`; first-class; replaces `isWake` boolean + `messages[0]` inference |
| `isWake` boolean | field (remove) | `tugdeck/src/lib/code-session-store/types.ts`, `reducer.ts` | Removed; `wakeTrigger` survives as an annotation on `origin: "assistant"` |
| origin-parameterized turn-open | fn | `tugdeck/src/lib/code-session-store/reducer.ts` | Seeds scratch `[userMessage]` iff `origin==="user"`, else `[]` (generalizes `handleWakeStarted`) |
| `turnHasUserMessage` inference | logic (replace) | `tugdeck/src/lib/dev-transcript-data-source.ts` | Keyed on `origin`, not `messages[0]` |
| `parse_replay_complete_total_turns` | fn (rework) | `tugcast/src/session_ledger.rs` / `feeds/agent_bridge.rs` | Count sourced from the engine, not the wire-authored total |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | Engine segmentation/origin on individual real session files | `cargo nextest`, the engine's core |
| **Contract (real corpus)** | Engine count+origins == tugcode/tugdeck rendering, over the real local corpus | The anti-drift gate ([P07]) |
| **Real-app** | Picker count == opened count (no shift); no phantom `#u` rows | `just app-test`, end-to-end |
| **Pure-logic (bun)** | Reducer origin handling, address formatting | tugdeck store/format |

#### What stays out of tests {#test-non-goals}

- Sanitized/invented golden fixtures — deleted ([P07]); they masked the gaps.
- Fake-DOM/RTL render tests and mock-store assertion tests — banned project-wide.
- CI portability of the real-corpus contract — accepted as local-only; not a coverage gap but a deliberate choice.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Spec: origin model, opener vocabulary, counting policy | pending | — |
| #step-2 | Rust turn-segmentation engine (pure, real-file unit tests) | pending | — |
| #step-3 | Picker/scan count sourced from the engine; epoch bump; incremental correctness | pending | — |
| #step-4 | Resume authority sourced from the engine; remove seed-then-reconcile shift | pending | — |
| #step-5 | tugcode: honest assistant-originated opener; delete synth `add_user_message` | pending | — |
| #step-6 | tugdeck: origin-explicit `TurnEntry`; assistant-only render; `#u`/`#a` | pending | — |
| #step-7 | Real-corpus contract: engine == rendering; delete sanitized corpus | pending | — |
| #step-8 | Real-app integration: no shift, no phantom user rows, equality on the spread | pending | — |

#### Step 1: Spec — origin model, opener vocabulary, counting policy {#step-1}

**Commit:** `spec(turns): origin-first turn model and one-engine count`

**References:** [P01] origin intrinsic, [P02] container, [P03] addressing, [P04] count-all, [P05] one engine, Spec S01, Spec S02, Spec S03, (#context, #strategy)

**Artifacts:**
- Rewrite `tuglaws/turn-metric.md` to define the origin model (S01), the honest opener vocabulary (S02), count production/consumption (S03), and the unforgeable-attribution invariant.

**Tasks:**
- [ ] Define `TurnOrigin` and the turn-open rules for both origins; state that a user message exists iff `origin === user`.
- [ ] State the single-producer rule and the picker-never-shifts invariant.
- [ ] State the addressing scheme (`#u`/`#a`/reserved `#s`, no `#x`).

**Tests:**
- [ ] None (spec doc).

**Checkpoint:**
- [ ] `tuglaws/turn-metric.md` encodes S01–S03 and is internally consistent with [P01]–[P07]; no reference to a synthesized user opener as legitimate.

---

#### Step 2: Rust turn-segmentation engine {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): origin-tagged turn segmentation engine`

**References:** [P05] one engine, [Q03] incremental cost, Spec S01, (#symbol-inventory)

**Artifacts:**
- `turn_engine.rs`: `segment_turns` producing ordered `{origin, ...}` turns + count, with a carry-in/carry-out frontier state (open-turn state) for incremental resume.

**Tasks:**
- [ ] Implement the full state machine: user openers (excluding meta/interrupt/tool-result/compact/scaffolding) AND assistant-originated openers (wake / orphan assistant with no open turn), mirroring tugcode's decisions per S01.
- [ ] Express incremental resume as carry-over of frontier open-turn state, not just an offset+count.
- [ ] Delete/retire `user_submission_opens_turn` user-record-only counting.

**Tests:**
- [ ] `cargo nextest` unit tests over **real** session files copied locally (continue/compact/slash/wake/leading-orphan), asserting per-turn origin and total.
- [ ] An incremental test: segment a prefix, append the rest, assert incremental total+origins == full re-segment.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` green; engine reproduces the opened-session count for `49e9aec6` (expected 81) from the real file.

---

#### Step 3: Picker/scan count from the engine {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugcast): picker turn count from the segmentation engine`

**References:** [P05] one engine, [P06] no shift, [Q03], Spec S03, Risk R02, (#r02-incremental-correctness)

**Artifacts:**
- The disk scan runs the engine; `external_scan_cache` stores engine output (count + frontier state); `rule_epoch` bumped so stale caches invalidate.

**Tasks:**
- [ ] Wire the scan to the engine; persist frontier state for incremental resume.
- [ ] Bump `CURRENT_RULE_EPOCH`; confirm the epoch gate invalidates old rows at both read sites.

**Tests:**
- [ ] `cargo nextest` cache tests: a stale (old-epoch) row is ignored; an incremental append updates the count correctly.

**Checkpoint:**
- [ ] `cargo nextest run` green; a fresh scan of `49e9aec6` caches **81** (not 59), validated by `(file_size, file_mtime, rule_epoch)`.

---

#### Step 4: Resume authority from the engine; kill the shift {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tugcast): resume count from the engine, one producer`

**References:** [P05] one engine, [P06] no shift, [Q01] wire count source, Spec S03, (#q01-wire-count-source)

**Artifacts:**
- The ledger/reconcile count and the wire window metadata sourced from the engine (resolve [Q01]); the seed-then-reconcile-to-a-different-value path removed.

**Tasks:**
- [ ] Resolve [Q01]: make the engine the count behind `replay_complete` window metadata (engine stamps the wire, or tugcode consumes engine segmentation).
- [ ] Remove the path where a divergent estimate seeds the ledger and resume overwrites it with a different number.

**Tests:**
- [ ] `cargo nextest` reconcile test: for an unchanged file, the post-resume ledger count equals the pre-resume scan count (no mutation).

**Checkpoint:**
- [ ] `cargo nextest run` green; opening `49e9aec6` does not change its ledger turn count (already 81 from scan).

---

#### Step 5: tugcode honest opener; delete synth `add_user_message` {#step-5}

**Depends on:** #step-1

**Commit:** `refactor(tugcode): assistant-originated opener, no fabricated user message`

**References:** [P01] origin intrinsic, [P02] container, Spec S02, (#s02-opener-vocabulary)

**Artifacts:**
- An assistant-originated opener (generalized `wake_started`) emitted for orphan assistant content; the synthesized `add_user_message{content:[]}` removed from `handleAssistantEntry` (replay) and the live empty-opener follow-up in `session.ts`.

**Tasks:**
- [ ] Replace the synth opener with the assistant-originated opener carrying `origin: assistant`.
- [ ] Ensure `add_user_message` is emitted only for genuine user submissions.
- [ ] Keep the engine ([P05]) and this emit aligned per S01 (the contract in #step-7 enforces it).

**Tests:**
- [ ] `bun test` (tugcode) replay tests over real files: orphan assistant entries open an `origin: assistant` turn; no empty `add_user_message` is emitted.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; `bun test` green; grep shows no `add_user_message` emit path with empty/synthetic content; tugcode rebuilt.

---

#### Step 6: tugdeck origin-explicit TurnEntry + rendering {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(transcript): origin-explicit turns, assistant-only orphans`

**References:** [P01] origin intrinsic, [P02] container, [P03] addressing, (#state-zone-mapping)

**Artifacts:**
- `origin` on `PendingTurn` and `TurnEntry`; one origin-parameterized turn-open that seeds the scratch with `[userMessage]` iff `origin === "user"` else `[]`; `isWake` boolean and `messages[0]` inference removed; `wakeTrigger` demoted to an optional annotation; row layout + addressing key on `origin`.

**Tasks:**
- [ ] Add `origin: "user" | "assistant"` to `PendingTurn` and `TurnEntry`; the reducer's turn-open handler sets it from the opener and seeds the scratch empty for `origin: "assistant"` (mirrors today's `handleWakeStarted` empty-scratch construction).
- [ ] Remove the `isWake` boolean discriminator and the `turnHasUserMessage`/`messages[0]` inference; keep `wakeTrigger` only as an annotation on an `origin: "assistant"` turn.
- [ ] Key row layout + `#u`/`#a` addressing on `origin`; confirm no path can render a user row for an `origin: "assistant"` turn (no `user_message` exists to render).

**Tests:**
- [ ] `bun test` reducer tests (real-frame driven): an assistant-originated opener yields a turn with `origin: assistant`, no user message, assistant-only rows.
- [ ] `bun test` address formatter unchanged (`#u`/`#a`).

**Checkpoint:**
- [ ] `bunx tsc --noEmit` clean; `bun test` green; HMR shows orphan turns as `#a`-only with no phantom `#u` row.

---

#### Step 7: Real-corpus contract; delete sanitized corpus {#step-7}

**Depends on:** #step-2, #step-5, #step-6

**Commit:** `test(turns): real-corpus contract engine == rendering`

**References:** [P05] one engine, [P07] real corpus, Risk R01, (#r01-segmentation-drift)

**Artifacts:**
- A contract that, over `~/.claude/projects/<project>/*.jsonl`, asserts the engine's count+origins equal tugcode/tugdeck's rendered segmentation; deletion of `scanner_turn_counts_match_golden_corpus` and its sanitized fixtures.

**Tasks:**
- [ ] Build the contract harness over the real local corpus (count + per-turn origin).
- [ ] Delete the sanitized golden corpus and any test it props up; keep at most a real-shape smoke subset.

**Tests:**
- [ ] The contract passes over the full real corpus (or reports the exact divergent sessions to fix).

**Checkpoint:**
- [ ] The contract is green over the real corpus; `cargo nextest` / `bun test` no longer reference the deleted sanitized fixtures.

---

#### Step 8: Real-app integration — no shift, no phantom rows {#step-8}

**Depends on:** #step-3, #step-4, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [P04] count-all, [P06] no shift, Spec S03, (#success-criteria)

**Tasks:**
- [ ] Verify on real sessions across the spread that picker count == opened count == highest rendered address.

**Tests:**
- [ ] `just app-test` aggregate: open `49e9aec6` (and a wake/`--continue`/`/compact` session); assert the picker shows the same number before and after; assert no turn renders a `#u` row without a real user submission; assert highest `#a`/`#u` == engine count.

**Checkpoint:**
- [ ] `just app-test <turns-redux-test>` ends `VERDICT: PASS`; the `49e9aec6` picker number is identical pre- and post-open.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A turn model where attribution is intrinsic and unforgeable, a single Rust engine produces the count consumed identically by the picker and the resume authority, and the picker count never shifts — verified against the real local session corpus.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] No fabricated user messages anywhere; assistant-originated turns render `#a`-only. (#step-5, #step-6)
- [ ] One engine produces the count for both picker and authority; picker count == opened count for every real session. (#step-3, #step-4, #step-8)
- [ ] Engine == rendering over the full real corpus. (#step-7)
- [ ] `49e9aec6` shows the same number before and after opening, equal to the highest rendered address. (#step-8)
- [ ] The sanitized golden corpus is gone; verification is real-data-driven. (#step-7)

**Acceptance tests:**
- [ ] `cargo nextest run` (engine + cache + reconcile) green.
- [ ] Real-corpus contract green (or a named, tracked list of corrected sessions).
- [ ] `just app-test <turns-redux-test>` → `VERDICT: PASS`.

| Checkpoint | Verification |
|------------|--------------|
| Honest attribution | grep: no empty `add_user_message`; render: no `#u` without a user submission |
| One producer, no shift | `49e9aec6` picker count identical pre/post open; no ledger mutation on unchanged file |
| Engine == rendering | real-corpus contract green |
