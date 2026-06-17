<!-- devise-skeleton v4 -->

## Z2 Metadata Persistence — JSONL-Authoritative Cost & Model {#z2-metadata}

**Purpose:** Make the dev card's Z2 status-bar readouts (TOKENS, CONTEXT, MODEL) survive a session restore and an HMR re-replay by reconstructing per-turn token cost and the model **from the JSONL itself** during replay, rather than depending on a fragile sqlite side-table that can be — and routinely is — empty.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

After a session is restored (or after any HMR, which re-replays the JSONL to rebuild the transcript), the Z2 status bar shows **TOKENS 0**, **CONTEXT 0 / 200.0K**, and **MODEL ?** even though the transcript itself reconstructs correctly. Investigation against the live `sessions.db` and the session JSONL established the root cause:

- The **authoritative per-turn token usage and model name are already in the JSONL** — every assistant entry carries `message.usage` (`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`) and `message.model`.
- tugcode's replay translator (`translateJsonlSession`) **drops all of it** — it emits transcript content but no cost, and synthesizes the model from the *first* assistant entry's `message.model`, which is frequently the literal `"<synthetic>"` (→ unknown model → MODEL "?" → CONTEXT max defaults to 200K).
- Cost reconstruction instead relies entirely on a **side-table** (`turn_telemetry`) that tugcast inlines onto replayed `turn_complete` events, matched by `msg_id`, keyed by `claude_session_id`. That table is populated only on the *live* `turn_complete` path, is silently skipped when the claude session id isn't resolved at record time, and — for the very session in the bug report (`efa741e2`, 25 turns) — has **zero rows**. None of its assistant `msg_id`s appear anywhere in the table.

The data we need is sitting in the file we already replay; we just don't read it. This plan makes the JSONL the authoritative source for cost and model, and demotes the side-table to the one thing the JSONL genuinely *cannot* provide: the multi-clock wall/active/ttft timing.

#### Strategy {#strategy}

- **Read the cost we already have.** Extract each turn's `message.usage` in tugcode's replay translator and carry it on the replayed `turn_complete.telemetry.cost` — the field the reducer already consumes via `mergeTurnTelemetry`. No reducer change needed for cost.
- **Restore the model deterministically.** Make the model synth skip `"<synthetic>"` (and other non-real placeholders) and pick the first *real* `message.model`, so MODEL and the CONTEXT denominator resolve.
- **Demote the side-table to timing-only.** tugcast overlays *only* the wall/active/ttft fields from `turn_telemetry` onto tugcode's telemetry; cost is never overwritten, so the JSONL stays authoritative even when a row exists.
- **Sequence so each step is independently valuable** and verifiable — the cost fix lands and is checkpointable before the tugcast cleanup.
- **No new client state.** The plan repopulates existing snapshot fields (`transcript[].cost`, `sessionInitTokens`, `SessionMetadataStore.model`) through the existing replay event; the work is in tugcode + tugcast.

#### Success Criteria (Measurable) {#success-criteria}

- Restoring `efa741e2` (or any session whose `turn_telemetry` rows are absent) shows a non-zero **CONTEXT used** equal to the last turn's `turnWindowTokens(usage)` from the JSONL, and non-zero **TOKENS** for the latest committed turn. (Verify: restore in the app; compare CONTEXT-used to `input+output+cache_creation+cache_read` of the last assistant entry in the JSONL.)
- After restore, **MODEL** shows the real model (e.g. `Opus 4.8 · 1M`) and **CONTEXT max** resolves to that model's window (1.00M for opus-4-8), not the 200K unknown-model default. (Verify: restore; read the MODEL chip + CONTEXT denominator.)
- An **HMR** during a live session leaves TOKENS/CONTEXT/MODEL unchanged (no zeroing). (Verify: live session, edit a tugdeck file to trigger HMR, observe Z2 holds.)
- `bun test` (tugcode replay), `cargo nextest run -p tugcast`, and `bun test` + `tsc` (tugdeck) all pass; the rebuilt `tugcode` binary emits `turn_complete.telemetry.cost` on a fixture with `message.usage`. (Verify: the step checkpoints.)

#### Scope {#scope}

1. tugcode replay: type `message.usage` on `JsonlEntry`; a pure `usage → TurnCost` helper; emit `telemetry.cost` (+ `sessionInitTokens`) on replayed `turn_complete`.
2. tugcode replay: model synth skips `"<synthetic>"` / non-real models and picks the first real `message.model`.
3. tugcast: `inject_replay_telemetry` overlays *only* the timing fields onto tugcode's telemetry; never overwrites cost.
4. End-to-end verification on a real restored session + the existing test suites.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **EFFORT chip / reasoning-effort restore.** Effort is a tug/CC *setting*, not in the JSONL; it needs the `session_metadata` durable path, a separate mechanism. Tracked as a follow-on (#roadmap), not fixed here.
- **Per-turn TIME popover restore (wall/active/ttft).** These remain best-effort from `turn_telemetry`; we are not reconstructing timing from the JSONL (it isn't there).
- **Reworking the `record_turn_telemetry` silent-skip reliability.** We make cost independent of it; hardening the recorder is a follow-on (#roadmap).
- **Migrating or dropping the `turn_telemetry` cost columns.** They stay written (vestigial for replay); no schema migration.
- **Dollar-cost (`totalCostUsd`) reconstruction.** The JSONL carries no per-message dollar cost; replayed turns report `totalCostUsd: 0`. Cost-in-dollars is not a Z2 readout.

#### Dependencies / Prerequisites {#dependencies}

- tugcode is a bun-compiled binary (`tugrust/target/debug/tugcode`); changes require a rebuild before they take effect at runtime (see `#build-commands`).
- The reducer already applies `event.telemetry` on replay via `mergeTurnTelemetry` (`inline ?? derived`) and reads `event.telemetry.sessionInitTokens` (#reducer-already-applies). No reducer change is required for cost.

#### Constraints {#constraints}

- Rust workspace enforces `-D warnings` (warnings are errors); tugcast must build clean.
- Live `turn_complete` frames (claude stream-json passthrough) must remain telemetry-free — the cost-emit is **replay-path only** (`translateJsonlSession`), so the live derivation (`cost_update`) is untouched.
- `mergeTurnTelemetry` is all-or-nothing (`inline ?? derived`): the wire must deliver **one complete telemetry object** per replayed `turn_complete`. tugcast must overlay onto tugcode's object, not emit a competing one.

#### Assumptions {#assumptions}

- The terminal assistant entry of a turn (the one whose `stop_reason` closes the cycle) carries the turn's resident-context `usage` — the same last-iteration usage the live `cost_update` froze. (Confirmed against `efa741e2.jsonl`.)
- Interrupted / orphan-synthesized turns may carry partial or no `usage`; those replay with zero cost (acceptable — see #r01-interrupted-zero-cost).
- The JSONL `model` for a normal turn resolves through `resolveModelContextMax` / `model-label` to the right window; the `[1m]` opus variant nuance is handled there or surfaced by #q03-model-variant.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit and kebab-case; plan-local decisions use `[P01]`; steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] How to derive `sessionInitTokens` from the JSONL (OPEN) {#q01-session-init-tokens}

**Question:** `deriveContextWindows(usages, sessionInit)` uses `sessionInit` only as the baseline `prevWindow` for **turn 1's** `perTurn` delta (`perTurn(1) = window(1) − sessionInit`). The live path captures `sessionInitTokens` from the first `streaming_usage`; the JSONL has no equivalent standalone value. What do we set on replay?

**Why it matters:** Only turn-1's TOKENS delta depends on it. **CONTEXT used = `window(latest)` is absolute** and needs no `sessionInit`; TOKENS for turns ≥2 are deltas between adjacent JSONL usages and need no `sessionInit`. So a wrong/zero value only mis-states the *first* turn's TOKENS by a bounded amount.

**Options (if known):**
- `sessionInit = 0` → `perTurn(1) = window(1)` (turn 1 reads as its full resident context; simplest).
- Derive from the first turn's input baseline (`input_tokens + cache_read + cache_creation` of the first assistant entry) → `perTurn(1) ≈ output_tokens` (closer to the live "new tokens this turn" reading).

**Plan to resolve:** Spike in #step-2 against `efa741e2.jsonl`: compute both and compare turn-1 TOKENS to what the live session showed; pick the closer. Default to the input-baseline derivation if ambiguous.

**Resolution:** OPEN — resolved in #step-2; defaults to input-baseline derivation, calibrated against a real session.

#### [Q02] Keep recording cost into `turn_telemetry` (OPEN) {#q02-vestigial-cost-columns}

**Question:** Once cost is JSONL-authoritative and tugcast no longer reads the table's cost columns on replay, should the live `record_turn_telemetry` keep writing them?

**Why it matters:** Dropping them needs a schema migration (the table self-rebuilds on drift, but it's churn); keeping them is a few vestigial columns.

**Options:** Keep writing (no migration, columns ignored on replay) / stop writing + migrate.

**Plan to resolve:** Decide in #step-4. Default: **keep writing** — zero migration, and the live cost is still a cheap cross-check.

**Resolution:** OPEN — default keep; revisit only if the columns cause confusion.

#### [Q03] Model-variant context-max (`[1m]` opus) on replay (OPEN) {#q03-model-variant}

**Question:** The live model is `claude-opus-4-8[1m]` (1M window); the JSONL `message.model` is `claude-opus-4-8` (no `[1m]`). Does `resolveModelContextMax("claude-opus-4-8")` resolve to 1M, or does the variant suffix matter?

**Why it matters:** If the bare name maps to a smaller window, CONTEXT max would be wrong after restore even with the model name fixed.

**Plan to resolve:** Spike in #step-3 — read `model-context-max.ts` overrides; if the bare name under-resolves, decide whether the synth should preserve a `[1m]` hint from the JSONL (the JSONL may carry the `[1m]` elsewhere) or whether the override map should cover the bare name.

**Resolution:** OPEN — resolved in #step-3.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Interrupted/orphan turns replay zero cost | low | med | Acceptable; last good turn dominates CONTEXT | Users report a wrong CONTEXT after an interrupted tail |
| tugcast overlay merges wrong / clobbers cost | med | low | Overlay only the named timing keys; Rust tests pin "cost survives" | Timing or cost regresses on a row-present replay |
| `sessionInitTokens` miscalibration | low | med | Only turn-1 TOKENS affected; calibrate in #step-2 | Turn-1 TOKENS visibly off |

**Risk R01: Interrupted/orphan turns replay with zero cost** {#r01-interrupted-zero-cost}

- **Risk:** A turn whose terminal entry lacks `usage` (interrupt before response, orphan synthesis) contributes zero to the window walk.
- **Mitigation:** `window(N)` carries forward `prevWindow` when a turn's raw window is 0 (`deriveContextWindows`), so a zero-usage turn doesn't *drop* CONTEXT — it just adds no delta. The latest *real* turn still sets CONTEXT-used.
- **Residual risk:** A session whose *last* committed turn was interrupted shows that turn's TOKENS as 0; CONTEXT-used reflects the prior real turn.

**Risk R02: tugcast overlay clobbers the JSONL cost** {#r02-overlay-clobbers-cost}

- **Risk:** The overlay regresses in either direction — a careless re-insert overwrites tugcode's cost, OR a botched merge fails to actually write the timing (the change converts TIME-restore from a full-overwrite to an overlay, so a row-present session could silently lose its per-turn TIME).
- **Mitigation:** Overlay writes only the explicit timing keys (`wallClockMs`, `awaitingApprovalMs`, `transportDowntimeMs`, `activeMs`, `ttftMs`, `ttftcMs`, `reconnectCount`, `maxStreamGapMs`); never `cost` / `sessionInitTokens`. Rust tests assert BOTH directions: cost byte-unchanged AND each timing key equals the row (#step-4).
- **Residual risk:** None beyond test coverage.

---

### Design Decisions {#design-decisions}

#### [P01] The JSONL is the authoritative source for per-turn cost and model (DECIDED) {#p01-jsonl-authoritative}

**Decision:** Per-turn token cost and the model name are reconstructed from the replayed JSONL itself; the `turn_telemetry` side-table is authoritative only for the multi-clock timing the JSONL lacks.

**Rationale:**
- The cost + model are *in the file we already replay*; depending on a side-table is a fragile second source of truth that is empty for `efa741e2` and silently skips on a binding race.
- Self-contained reconstruction works identically on cold restore and HMR re-replay, with no `claude_session_id` / `msg_id` matching dependency.

**Implications:**
- tugcode gains a JSONL-usage → cost path; the side-table's cost columns become non-authoritative (kept, ignored on replay — #q02-vestigial-cost-columns).
- No `claude_session_id` is required for cost/model on restore.

#### [P02] tugcode emits per-turn cost on `turn_complete.telemetry.cost` (DECIDED) {#p02-tugcode-emits-cost}

**Decision:** On the replayed terminal `turn_complete`, tugcode attaches `telemetry: { cost, sessionInitTokens, <timing fields = 0> }`, with `cost` mapped from the closing assistant entry's `message.usage`.

**Rationale:**
- The reducer already applies `event.telemetry` via `mergeTurnTelemetry(inline ?? derived)` and reads `event.telemetry.sessionInitTokens` (#reducer-already-applies) — so the existing wire field carries it with no reducer change.
- The closing assistant entry (terminal `stop_reason`) is already the point where `turn_complete{result:"success"}` is built and has the `usage` in scope (#emit-point).

**Implications:**
- `JsonlEntry.message` must type `usage`; tugcode builds a partial `TurnTelemetry` (cost present, timing zero).
- Live `turn_complete` stays telemetry-free (replay-only emit).

#### [P03] tugcast overlays only timing; never overwrites cost (DECIDED) {#p03-tugcast-overlays-timing}

**Decision:** `inject_replay_telemetry` overlays only the wall/active/ttft timing keys from a matched `turn_telemetry` row onto the telemetry object tugcode already attached; it leaves `cost` and `sessionInitTokens` untouched, and leaves the line unchanged when no row matches.

**Rationale:**
- `mergeTurnTelemetry` is all-or-nothing, so the wire must deliver one complete object; the overlay augments tugcode's object rather than competing with it.
- Keeps the JSONL cost authoritative even when a (possibly stale) side-table row exists (#r02-overlay-clobbers-cost).

**Implications:**
- tugcast's inline becomes a field-level overlay keyed on the line already carrying `telemetry`.

#### [P04] The model synth skips non-real model strings (DECIDED) {#p04-model-synth-skips-synthetic}

**Decision:** The replay's `system_metadata` synth picks the first assistant entry whose `message.model` is a *real* model name — skipping `"<synthetic>"` and any other placeholder — instead of the first non-empty one.

**Rationale:**
- The JSONL interleaves `"<synthetic>"` opener entries; emitting that as the model yields MODEL "?" and a 200K context default.

**Implications:**
- A small predicate (`isRealModelName`) gates the synth; behavior unchanged when the first model is already real.

---

### Deep Dives (Optional) {#deep-dives}

#### End-to-end cost flow, before and after {#cost-flow}

**Before (broken):**

```
JSONL (has message.usage) ──replay──▶ tugcode turn_complete (NO cost)
                                          │
                              tugcast inject_replay_telemetry
                                  (msg_id → turn_telemetry row)
                                          │  row MISSING for efa741e2
                                          ▼
                              turn_complete passes through, NO telemetry
                                          ▼
                          reducer: derived telemetry = zeros → TurnEntry.cost = 0
                                          ▼
                              TOKENS 0 · CONTEXT 0 · (model "?" → max 200K)
```

**After (this plan):**

```
JSONL (message.usage) ──replay──▶ tugcode turn_complete { telemetry.cost = usage }   [P02]
                                          │
                              tugcast inject_replay_telemetry
                                  overlays ONLY wall/active/ttft from row (if any)     [P03]
                                  cost untouched
                                          ▼
                          reducer: mergeTurnTelemetry(inline) → TurnEntry.cost = JSONL usage
                                          ▼
              CONTEXT used = turnWindowTokens(last usage) · TOKENS = perTurn delta
              model from real message.model  →  MODEL + CONTEXT max correct           [P04]
```

#### The emit point in tugcode {#emit-point}

The terminal `turn_complete{result:"success"}` is built in `translateJsonlEntry` at the `TERMINAL_STOP_REASONS` branch, where the closing assistant `entry` (and thus `entry.message.usage`) is in scope — that is the turn's last-iteration resident-context usage we want. The interrupted/orphan `turn_complete{result:"interrupted"}` is built in `emitOrphanIfOpen`, whose `closingEntry` argument is the **next opener entry** (callers pass the arriving entry that closes the prior open turn), NOT the open turn's own content — so it cannot supply the open turn's usage. Orphan/interrupted turns therefore replay at `ZERO_TURN_COST` (#r01-interrupted-zero-cost); a later refinement could track the open turn's last-seen `usage` in `TranslateContext`.

#### The reducer already applies replay telemetry {#reducer-already-applies}

`handleTurnComplete` passes `event.telemetry` to `mergeTurnTelemetry(inline, derived)` (`inline ?? derived`) and sets `TurnEntry.cost = telemetry.cost`; it restores `sessionInitTokens` from `event.telemetry?.sessionInitTokens` on the resume path. No reducer change is needed for cost — only the upstream producers change.

#### Why CONTEXT doesn't need `sessionInitTokens` {#context-absolute}

`deriveContextWindows` sets `window(N) = turnWindowTokens(usage_N)` (absolute resident context after the turn) and `perTurn(N) = window(N) − window(N−1)`. The CONTEXT cell reads `window(latest)` — absolute — so it is correct from the JSONL usage alone. `sessionInit` only seeds `perTurn(1)` (#q01-session-init-tokens).

---

### Specification {#specification}

**Spec S01: JSONL `usage` → `TurnCost` mapping** {#s01-usage-to-cost}

Given an assistant entry's `message.usage`:

| TurnCost field | Source |
|---|---|
| `inputTokens` | `usage.input_tokens` (default 0) |
| `outputTokens` | `usage.output_tokens` (default 0) |
| `cacheCreationInputTokens` | `usage.cache_creation_input_tokens` (default 0) |
| `cacheReadInputTokens` | `usage.cache_read_input_tokens` (default 0) |
| `totalCostUsd` | `0` (JSONL carries no per-message dollar cost — #non-goals) |

Non-numeric / missing fields default to 0. A turn whose closing entry has no `usage` yields `ZERO_TURN_COST`.

**Spec S02: Replayed `turn_complete.telemetry` shape** {#s02-replay-telemetry}

On a replayed terminal `turn_complete`, tugcode attaches:

```
telemetry = {
  cost: <Spec S01>,
  sessionInitTokens: <Q01 derivation, or null>,
  wallClockMs: 0, awaitingApprovalMs: 0, transportDowntimeMs: 0,
  activeMs: 0, ttftMs: null, ttftcMs: null,
  reconnectCount: 0, maxStreamGapMs: 0,
  turnEndReason: <"complete" | "interrupted">,
}
```

tugcast (#p03-tugcast-overlays-timing) may overlay `wallClockMs … maxStreamGapMs` from a matched row; it must not touch `cost` / `sessionInitTokens`.

**Field constraints:**
- `sessionInitTokens` must be the SAME session-baseline on every turn (or non-null only on turn 1). The reducer keeps the first non-null (`state.sessionInitTokens ?? event.telemetry?.sessionInitTokens`), so a per-turn-varying value is ignored after turn 1 and must not be emitted.
- `turnEndReason` is **load-bearing**, not decorative: `mergeTurnTelemetry` adopts the inline block wholesale, and the reducer recovers the committed `TurnEntry.turnEndReason` from it on replay. tugcode must set it (`"complete"` for a clean terminal `stop_reason`, `"interrupted"` for an orphan) — otherwise restored turns lose their end-state classification.

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

> This plan adds **no new client state.** It repopulates existing snapshot fields through the existing replay event. Listed for completeness; mechanisms are already in place.

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `TurnEntry.cost` (per-turn) | local-data | reducer commit from `event.telemetry.cost`; store + `useSyncExternalStore` | [L02] |
| `sessionInitTokens` (snapshot) | local-data | reducer restore from `event.telemetry.sessionInitTokens` | [L02] |
| `SessionMetadataStore.model` | local-data | replay-synth `system_metadata` → metadata store; `useSyncExternalStore` | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `JsonlEntry.message.usage` | type field | `tugcode/src/replay.ts` | add `usage?: { input_tokens?, output_tokens?, cache_creation_input_tokens?, cache_read_input_tokens? }` |
| `extractTurnCostFromUsage` | fn | `tugcode/src/replay.ts` | pure `usage → TurnCost` per Spec S01; exported for tests |
| `buildReplayTurnTelemetry` | fn | `tugcode/src/replay.ts` | cost + sessionInitTokens + zero timing → `TurnTelemetry` (Spec S02) |
| success `turn_complete` build | edit | `tugcode/src/replay.ts` (#emit-point) | attach `telemetry` from the closing entry's usage |
| `emitOrphanIfOpen` `turn_complete` | edit | `tugcode/src/replay.ts` (#emit-point) | attach `ZERO_TURN_COST` telemetry (its `closingEntry` is the next opener, not the open turn's content — Risk R01) |
| `sessionCreatedAtMs`-style first-usage capture | edit | `tugcode/src/replay.ts` | capture turn-1 baseline for `sessionInitTokens` (#q01-session-init-tokens) |
| `isRealModelName` | fn | `tugcode/src/replay.ts` | predicate skipping `"<synthetic>"` / placeholders |
| model-synth guard | edit | `tugcode/src/replay.ts` | gate the `emittedSystemMetadata` synth on `isRealModelName` ([P04]) |
| `inject_replay_telemetry` | edit | `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` | overlay timing-only onto existing `telemetry`; never overwrite cost ([P03]) |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | `extractTurnCostFromUsage`, `isRealModelName`, the overlay merge | core logic, edge cases |
| **Integration** | replay a fixture JSONL → assert `turn_complete.telemetry.cost`; reducer applies it | end-to-end on the wire shape |
| **Drift Prevention** | Rust test "cost survives a row-present overlay" | guards [P03] |

#### What stays out of tests {#test-non-goals}

- No app-render / fake-DOM tests — verification of the live readouts is a real-app `/verify` (banned-pattern avoidance per project conventions).
- No mock-store assertion tests for the reducer — exercise the real reducer via the wire-frame channel (matching the existing `replay-window-metadata.test.ts` style).

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. tugcode is a compiled binary — rebuild it where a step says so (#build-commands).

#### Build & test commands {#build-commands}

- tugcode tests: `cd tugcode && bun test src/__tests__/replay.test.ts`
- tugcode rebuild: `bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode`
- tugcast tests: `cd tugrust && cargo nextest run -p tugcast`
- tugdeck: `cd tugdeck && bun run tsc --noEmit && bun test`

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | tugcode: type JSONL usage + pure cost helper | pending | — |
| #step-2 | tugcode: emit cost + sessionInitTokens on replay turn_complete | pending | — |
| #step-3 | tugcode: model synth skips non-real models | pending | — |
| #step-4 | tugcast: overlay timing-only, never overwrite cost | pending | — |
| #step-5 | tugdeck: reducer applies replayed cost (regression test) | pending | — |
| #step-6 | Integration checkpoint: real-session restore + HMR | pending | — |

#### Step 1: tugcode — type JSONL `usage` + pure cost helper {#step-1}

**Commit:** `tugcode: extract per-turn cost from JSONL usage`

**References:** [P01] JSONL authoritative, [P02] tugcode emits cost, Spec S01, (#s01-usage-to-cost, #context)

**Artifacts:**
- `JsonlEntry.message.usage` typed in `tugcode/src/replay.ts`.
- `extractTurnCostFromUsage(usage): TurnCost` (pure, exported).

**Tasks:**
- [ ] Add `usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }` to `JsonlEntry.message`.
- [ ] Implement `extractTurnCostFromUsage` per Spec S01 (numeric coercion, defaults to 0, `totalCostUsd: 0`).

**Tests:**
- [ ] Unit: full usage → all four token fields mapped; missing/non-numeric → 0; `totalCostUsd === 0`.

**Checkpoint:**
- [ ] `cd tugcode && bun test src/__tests__/replay.test.ts`
- [ ] `cd tugcode && bunx tsc --noEmit`

---

#### Step 2: tugcode — emit cost + `sessionInitTokens` on replayed `turn_complete` {#step-2}

**Depends on:** #step-1

**Commit:** `tugcode: carry per-turn cost on replayed turn_complete`

**References:** [P02] tugcode emits cost, [Q01] sessionInitTokens, Spec S02, Risk R01, (#emit-point, #context-absolute, #reducer-already-applies)

**Artifacts:**
- `buildReplayTurnTelemetry(cost, sessionInitTokens, turnEndReason): TurnTelemetry` (zero timing).
- Terminal-success and interrupted/orphan `turn_complete` carry `telemetry`.
- Turn-1 baseline capture for `sessionInitTokens` (resolves [Q01]).

> **Note:** this step alone fixes the user-visible bug. tugcast's current
> `inject_replay_telemetry` passes a `turn_complete` line through unchanged on a
> row-miss, so tugcode's JSONL `telemetry.cost` survives for the (common) no-row case.
> #step-4 is the architectural cleanup that keeps the JSONL cost authoritative even when
> a row *exists*.

**Tasks:**
- [ ] Build `telemetry` (Spec S02) at the success `turn_complete` from the closing `entry.message.usage`.
- [ ] In `emitOrphanIfOpen` (interrupted / EOF synthesis), emit `ZERO_TURN_COST` — its `closingEntry` is the *next* opener entry (callers pass the arriving entry), NOT the interrupted turn's own content, so it cannot supply the open turn's usage (Risk R01). An optional later refinement tracks the open turn's last-seen `usage` in `TranslateContext` (like `openTurnMsgId`); not v1.
- [ ] Capture the first turn's usage once to derive `sessionInitTokens` ([Q01]); spike `0` vs input-baseline against `efa741e2.jsonl`, pick the closer, document the choice inline. Emit the SAME value on every turn's telemetry (or non-null only on turn 1) — the reducer keeps the first non-null (Spec S02).
- [ ] Rebuild the tugcode binary (#build-commands).

**Tests:**
- [ ] Integration: a fixture JSONL with `message.usage` → the terminal `turn_complete` carries `telemetry.cost` equal to Spec S01 mapping.
- [ ] An interrupted/orphan turn (no terminal `stop_reason`) → `telemetry.cost` is `ZERO_TURN_COST` (never the next entry's usage).
- [ ] `sessionInitTokens` present and identical across turns per the chosen derivation.

**Checkpoint:**
- [ ] `cd tugcode && bun test src/__tests__/replay.test.ts`
- [ ] `bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode` succeeds.
- [ ] Restoring a row-less session (e.g. `efa741e2`) now shows non-zero CONTEXT-used + TOKENS **before** #step-4 lands (tugcast passes the line through on a row-miss).

---

#### Step 3: tugcode — model synth skips non-real models {#step-3}

**Depends on:** #step-2

**Commit:** `tugcode: synth model from first real message.model`

**References:** [P04] synth skips synthetic, [Q03] model variant, (#context)

**Artifacts:**
- `isRealModelName(model): boolean` (rejects `"<synthetic>"` / empty / placeholders).
- The `system_metadata` synth gated on `isRealModelName`.

**Tasks:**
- [ ] Implement `isRealModelName`; gate the `emittedSystemMetadata` synth to the first assistant entry passing it.
- [ ] Spike [Q03]: confirm `resolveModelContextMax(<bare JSONL model>)` resolves to the right window; if not, decide the synth-hint vs override-map fix and note it.
- [ ] Rebuild the tugcode binary.

**Tests:**
- [ ] Unit: `isRealModelName("<synthetic>") === false`, real names `=== true`.
- [ ] Integration: a JSONL whose first assistant entry is `"<synthetic>"` and a later one is real → synth emits the real model.

**Checkpoint:**
- [ ] `cd tugcode && bun test src/__tests__/replay.test.ts`
- [ ] `bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode` succeeds.

---

#### Step 4: tugcast — overlay timing-only, never overwrite cost {#step-4}

**Depends on:** #step-2

**Commit:** `tugcast: overlay replay timing without clobbering JSONL cost`

**References:** [P03] tugcast overlays timing, [Q02] vestigial cost columns, Risk R02, (#cost-flow)

**Artifacts:**
- `inject_replay_telemetry` overlays only the timing keys onto the line's existing `telemetry`.

**Tasks:**
- [ ] Rewrite `inject_replay_telemetry`: parse the line; if a matched row exists, overlay only `wallClockMs … maxStreamGapMs` onto the existing `telemetry` object (creating it if absent); never write `cost` / `sessionInitTokens`.
- [ ] Resolve [Q02] inline (default: keep recording cost columns; ignored on replay).

**Tests:**
- [ ] Rust: row-present + line already carries `telemetry.cost` → the cost is byte-for-byte unchanged (Risk R02) AND each timing key (`wallClockMs … maxStreamGapMs`) equals the row's value (the add-direction — guards against a TIME-popover regression for row-present sessions).
- [ ] Rust: no row → line unchanged (tugcode cost survives).
- [ ] Rust: row-present + line has no `telemetry` (legacy) → timing attached, no cost invented.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 5: tugdeck — reducer applies replayed cost (regression test) {#step-5}

**Depends on:** #step-2

**Commit:** `transcript: pin replayed turn cost lands on TurnEntry`

**References:** [P02] tugcode emits cost, (#reducer-already-applies, #state-zone-mapping)

**Artifacts:**
- A reducer test (wire-frame channel, `replay-window-metadata.test.ts` style) asserting a replayed `turn_complete` carrying `telemetry.cost` commits onto `TurnEntry.cost`, and `sessionInitTokens` restores.

**Tasks:**
- [ ] Confirm no reducer change is required (it already applies `event.telemetry`); if a gap surfaces, fix it minimally.
- [ ] Add the regression test driving the real store via decoded frames.

**Tests:**
- [ ] Replay `turn_complete{telemetry:{cost,...}}` → `getSnapshot().transcript[last].cost` equals the cost; `sessionInitTokens` set.
- [ ] CONTEXT-used derivation (`deriveContextWindows`) over the replayed costs is non-zero.

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit && bun test`

---

#### Step 6: Integration checkpoint — real-session restore + HMR {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [P01] JSONL authoritative, [P04] model synth, (#success-criteria)

**Tasks:**
- [ ] Restore `efa741e2` (zero `turn_telemetry` rows) in the running app; confirm TOKENS, CONTEXT-used, MODEL, and CONTEXT-max are populated and match the JSONL's last-turn usage + model.
- [ ] Trigger an HMR during a live session; confirm Z2 holds (no zeroing).

**Tests:**
- [ ] Full suites green: `cd tugcode && bun test`; `cd tugrust && cargo nextest run -p tugcast`; `cd tugdeck && bun run tsc --noEmit && bun test`.

**Checkpoint:**
- [ ] Restore screenshot shows non-zero TOKENS/CONTEXT and the real MODEL + CONTEXT max.
- [ ] HMR leaves Z2 unchanged.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Z2 TOKENS / CONTEXT / MODEL reconstruct correctly from the JSONL on every restore and HMR re-replay, independent of the `turn_telemetry` side-table.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Restoring a session with no `turn_telemetry` rows yields non-zero TOKENS + CONTEXT-used and the correct MODEL + CONTEXT-max (#success-criteria).
- [ ] HMR during a live session does not zero Z2 (#success-criteria).
- [ ] All three suites pass; tugcode binary rebuilt and emitting `telemetry.cost` (#build-commands).

**Acceptance tests:**
- [ ] tugcode replay: terminal `turn_complete` carries Spec S01 cost.
- [ ] tugcast: cost survives a row-present overlay (Risk R02).
- [ ] tugdeck: replayed cost commits onto `TurnEntry.cost` (#step-5).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **EFFORT / session-setting restore** — effort isn't in the JSONL; durable `session_metadata` path + restore inline.
- [ ] **Per-turn TIME (wall/active/ttft) robustness** — still best-effort from `turn_telemetry`; consider a durable timing source.
- [ ] **`record_turn_telemetry` reliability** — eliminate the silent `no_claude_session_id` skip; add observability so a missing-row regression isn't silent.
- [ ] **Keying reconciliation** — `turn_telemetry` (claude id) vs `session_metadata` / `context_breakdown` keying; one consistent scheme.

| Checkpoint | Verification |
|------------|--------------|
| Cost from JSONL | tugcode replay test asserts `turn_complete.telemetry.cost` |
| Model from JSONL | synth emits real model on a `"<synthetic>"`-leading fixture |
| Cost authoritative | tugcast test: cost survives row-present overlay |
| End-to-end | `efa741e2` restore shows populated Z2; HMR holds |
