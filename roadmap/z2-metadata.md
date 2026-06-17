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

**Resolution:** RESOLVED in #step-2 → **input-baseline derivation** (`input + cache_read + cache_creation` of the first assistant entry carrying `usage`, excluding `output`). Calibrated against `efa741e2.jsonl`: first usage input-baseline = 38,345 → `perTurn(1) = window(1) − sessionInit = 39,094 − 38,345 = 749 = output_tokens` (matches the live "new tokens this turn" reading); `sessionInit = 0` would instead overstate turn-1 TOKENS as the full 39,094 window. CONTEXT-used = `window(last)` = 124,506 (absolute, needs no sessionInit). Implemented as `sessionInitTokensFromUsage`.

#### [Q02] Keep recording cost into `turn_telemetry` (OPEN) {#q02-vestigial-cost-columns}

**Question:** Once cost is JSONL-authoritative and tugcast no longer reads the table's cost columns on replay, should the live `record_turn_telemetry` keep writing them?

**Why it matters:** Dropping them needs a schema migration (the table self-rebuilds on drift, but it's churn); keeping them is a few vestigial columns.

**Options:** Keep writing (no migration, columns ignored on replay) / stop writing + migrate.

**Plan to resolve:** Decide in #step-4. Default: **keep writing** — zero migration, and the live cost is still a cheap cross-check.

**Resolution:** RESOLVED in #step-4 → **keep writing** the cost columns. No schema migration; the overlay simply stops *reading* them (it overlays timing-only and never emits cost from the row). The live `record_turn_telemetry` path is untouched, so the columns remain a cheap live-side cross-check. Revisit only if they cause confusion.

#### [Q03] Model-variant context-max (`[1m]` opus) on replay (OPEN) {#q03-model-variant}

**Question:** The live model is `claude-opus-4-8[1m]` (1M window); the JSONL `message.model` is `claude-opus-4-8` (no `[1m]`). Does `resolveModelContextMax("claude-opus-4-8")` resolve to 1M, or does the variant suffix matter?

**Why it matters:** If the bare name maps to a smaller window, CONTEXT max would be wrong after restore even with the model name fixed.

**Plan to resolve:** Spike in #step-3 — read `model-context-max.ts` overrides; if the bare name under-resolves, decide whether the synth should preserve a `[1m]` hint from the JSONL (the JSONL may carry the `[1m]` elsewhere) or whether the override map should cover the bare name.

**Resolution:** RESOLVED in #step-3 → **override-map fix** (option b). Spike findings: `efa741e2.jsonl`'s `message.model` is the bare `claude-opus-4-8` (1001×) with no `[1m]` anywhere structured (the only `[1m]` occurrences are content text + one unrelated `toolUseResult` error string), so a synth-hint (option a) is impossible — the JSONL carries no variant marker. The authoritative model catalog (claude-api skill) shows Opus 4.6/4.7/4.8, Sonnet 4.6, and Fable 5 all have a **native 1M context window** (only Haiku 4.5 is 200k), so `model-context-max.ts`'s "all modern models default to 200k, `[1m]` opts into 1M" premise was stale. Registered the native-1M model ids in `MODEL_CONTEXT_MAX_OVERRIDES` so the bare names resolve to 1M; the `[1m]` short-circuit still covers live ids. This both fixes efa741e2's CONTEXT-max and prevents the same staleness bug for any restored session on those models. (Touched a tugdeck change beyond the original symbol inventory — pure-logic `lib/` module, no tuglaws surface.)

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
| `SessionMetadataStore.model` (active) | local-data | replay-synth `system_metadata` (active model, [P09]) → metadata store; `useSyncExternalStore` | [L02] |
| `SessionMetadataStore.effort` | local-data | `session_capabilities` handshake → `_capabilities.effort` (existing field; Addendum A #step-8a); in-memory `latest_capabilities` replayed on bind, blank on pure offline replay | [L02] |

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
| #step-1 | tugcode: type JSONL usage + pure cost helper | done | c94cd342 |
| #step-2 | tugcode: emit cost + sessionInitTokens on replay turn_complete | done | 73458484 |
| #step-3 | tugcode: model synth skips non-real models | done | 9522764e |
| #step-4 | tugcast: overlay timing-only, never overwrite cost | done | 8bbdffab |
| #step-5 | tugdeck: reducer applies replayed cost (regression test) | done | d0a963a5 |
| #step-6 | Integration checkpoint: real-session restore + HMR | superseded → #addendum-a (test surfaced under-scoping) | suites ✓; app-vet exposed the gaps |

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

---

# ADDENDUM A — Full-lifecycle, all-metric, multi-target audit {#addendum-a}

> **Status:** revision in progress (2026-06-17). Steps 1–5 (cost-from-JSONL) are
> **committed and correct** — they are the foundation this addendum builds on, not a
> regression. What follows widens the plan from "cost + model on restore/HMR" to
> **every Z2 metric, across every lifecycle entry point, across every build target**,
> after integration testing surfaced that the original framing was incomplete.

## A.0 What the integration test actually proved {#a0-findings}

Restoring a real session (`7aa35ce5`, the KaTeX session) in the **worktree debug
instance** showed: **CONTEXT 372.3K / 200.0K (red), MODEL ?, EFFORT –**. Forensic
investigation established:

1. **Cost reconstruction works.** The real `translateJsonlSession` emits
   `telemetry.cost` on all 106 turns; `window(latest) = 372,301` — exactly the
   372.3K the app showed. The COST half of the plan is live and correct.
2. **The CONTEXT *value* is right; the *denominator* is wrong.** 372.3K is the genuine
   resident context of the last turn (`input+output+cache_read+cache_creation`,
   `cache_read = 371,915`). It reads as over-budget only because the denominator fell
   back to 200K. (See [P07] for the headroom semantics — the value already resets at
   `/compact`; that JSONL has 14 compaction markers.)
3. **MODEL "?" → 200K is the real defect, and it has two stacked causes**, neither of
   which the original plan addressed:
   - **(dominant) Per-instance database isolation** — see [P05]. The worktree
     instance's `session_metadata` table is **empty**; the model's durable fallback is
     absent on a fresh target.
   - **(secondary) Replay-synth delivery + recorder keying** — the synth emits the
     model but it does not reliably land in `SessionMetadataStore`, and the live
     recorder that would have persisted it is silent-skip-prone — see [Q04].

### Evidence (row counts, 2026-06-17) {#a0-evidence}

Per-instance `sessions.db` under `~/Library/Application Support/Tug/instances/<id>/`:

| Instance (target) | session_metadata | turn_telemetry | Note |
|---|---|---|---|
| `debug-main` (user's normal) | **44** | **42** | KaTeX `7aa35ce5 → claude-opus-4-7` PRESENT; some rows have empty model (`8f2b15be → ""`) |
| `debug-tugdash-z2-metadata` (this worktree) | **0** | **0** | EMPTY — the MODEL "?" the user saw |
| `release-main` | 7 | 5 | — |
| top-level `Tug/sessions.db` | 0 | 0 | not the per-instance path |

The **JSONL** (`~/.claude/projects/<project>/<id>.jsonl`) is owned by Claude Code and
**shared by every instance** — it is the only Z2 source stable across targets.

## A.1 Design decisions added by this addendum {#a1-decisions}

#### [P05] Durable Z2 state is per-build-target and absent on fresh targets {#p05-per-instance-db}

**Decision (finding):** Every Tug instance/target (`main`, `debug-main`,
`debug-<worktree>`, `release-*`, `apptest-*`) resolves its own data dir via
`tugcore::instance_data_dir_for(instance_id)` → `…/instances/<id>/`, with its own
`sessions.db`. The durable Z2 side-tables — `turn_telemetry`, `session_metadata`,
`context_breakdown_latest` — live there and are **NOT shared** across targets.

**Implications:**
- A fresh worktree/debug instance starts with **empty** side-tables. Any metric that
  reads from them is blank until that instance re-accumulates them live.
- This is **why the worktree test failed where `debug-main` would not have**: the
  durable model row exists in `debug-main` but not in the worktree DB.
- Two distinct failure surfaces collapse into the same symptom (MODEL "?"): the genuine
  product bug (durable tables unreliable even in `debug-main` — empty-model rows) AND
  the test artifact (fresh target has no durable data at all).

#### [P06] The JSONL is the only target-stable source; reconstruct from it wherever possible {#p06-jsonl-target-stable}

**Decision:** Any Z2 metric whose authoritative datum is present in the session JSONL
(**per-turn cost, model name**) MUST be reconstructed from the JSONL on replay, so it is
correct on **any** target regardless of durable-table state. Durable side-tables are a
*timing-only enrichment* ([P03]), never the source of truth for JSONL-present metrics.

**Implications:**
- Cost: already done (Steps 1–2).
- **Model: must follow the same rule** — the replayed model must reach
  `SessionMetadataStore` reliably and drive `resolveModelContextMax`, with **no
  dependence on `session_metadata` being populated**. (The current gap: the synth emits
  it but it doesn't land — see #a3-model-delivery and #step-7.)
- **Precedence rule (load-bearing):** the JSONL-reconstructed/active model **wins over a
  stale or empty durable `session_metadata` row.** A durable row may only be used as a
  fallback when it carries a *real* model and the replay supplied none. This prevents the
  observed empty-model rows (#q04-empty-model-rows) from clobbering the reconstructed
  model on bind.
- Metrics NOT in the JSONL (**EFFORT**, **per-turn TIME**, **/context breakdown**)
  cannot be reconstructed and therefore need an explicit target-stable strategy — see
  [Q05].

#### [P07] CONTEXT is live headroom-used (resident context since the last compact/clear), not a cumulative total {#p07-context-headroom}

**Decision (semantics pin, per user):** The CONTEXT cell shows the **current resident
context window occupancy** = `window(latest)` = the last committed turn's
`input + output + cache_read + cache_creation`. Because the API's `cache_read`/`input`
already reflect post-compaction context, this value **naturally resets at each
`/compact` or `/clear`** — it is headroom-used, never a sum across the whole session.

**Implications:**
- The denominator (`resolveModelContextMax(model)`) is the broken half on the steady
  state, and it is downstream of MODEL. **Do not "fix" CONTEXT into a cumulative sum** —
  `window(latest)` is the right primitive.
- **BUT the carry-forward has a compaction-boundary bug (verified in real data, [S03]).**
  `deriveContextWindows` carries the *prior* window forward across a **zero-usage** turn.
  The KaTeX JSONL shows the resident window climb to ~807K/676K/628K, then a `/compact`
  drops it — and the boundary frequently lands on a **zero-usage turn** (window → 0)
  before the first real post-compact turn (~42K). During that gap, carry-forward holds
  the **stale pre-compact window** (e.g. 807K) instead of the reset value. So CONTEXT-used
  can transiently read far too high right after a compaction. This is a genuine
  correctness gap, not cosmetic — see [S03] and #step-9.

**Spec S03: CONTEXT-used must reset at a compaction boundary, not carry the stale window** {#s03-compaction-reset}
- `deriveContextWindows`'s "zero-usage turn carries `prevWindow` forward" rule is correct
  for an *interrupted/orphan* turn (no measurable iteration) but **wrong immediately after
  a `/compact` or `/clear`**, where the true resident context has dropped.
- The walk must distinguish a zero-usage turn that is a **compaction/clear boundary**
  (reset `prevWindow` toward the post-compact baseline, do not carry the pre-compact peak)
  from a plain interrupted turn (carry forward). The boundary is detectable from the
  replay (`isCompactSummary` / continue-marker entries already recognized in
  `tugcode/src/replay.ts`) and/or from a real post-compact usage that is a sharp drop.
- Verification ([#step-9]) uses a fixture `big-window turn → /compact boundary (zero-usage)
  → small-window turn` and asserts CONTEXT-used reflects the **post-compact** window
  throughout, never the stale pre-compact peak.

#### [P08] Distribution makes JSONL-reconstruction mandatory, not just convenient {#p08-distribution}

**Decision (finding):** The data dir resolves on `TUG_INSTANCE_ID` (`tugcore::data_dir`):
- **Dev** (`main`/`debug`/`<worktree>`, spawned by `just`, `TUG_INSTANCE_ID` set) →
  `…/Tug/instances/<id>/sessions.db` — isolated per target ([P05]).
- **Distributed `Tug.app`** (end user double-clicks; no `TUG_INSTANCE_ID`) → **legacy
  `~/Library/Application Support/Tug/sessions.db`** — one stable DB across launches.

So a *distributed* user does accumulate durable rows over time. **But the durable DB is
still not a reliable Z2 source**, because the sessions Tug can show are exactly the
sessions whose **JSONL exists** (`~/.claude/projects/<project>/<id>.jsonl`, owned by
Claude Code, present because Tug bridges to it). Three everyday distributed scenarios
have a JSONL but **no durable Tug row**:
- **First launch / backlog** — Claude Code sessions created before Tug was installed.
- **Cross-machine / re-install** — the JSONL syncs (or is copied) but the local
  `sessions.db` is fresh.
- **Pre-Tug or external sessions** — anything Tug never observed *live*.

**Implication:** The empty-DB case is not a dev artifact to work around — it is the
**normal distributed case** for any historical session. [P06] (reconstruct
cost+model from the JSONL) is therefore a **distribution requirement**. The dev
per-instance isolation [P05] merely surfaces it early, on every worktree. Durable
side-tables are an *optimization for sessions this install saw live*, never the source
of truth.

#### [P09] MODEL means the ACTIVE model — the latest real `message.model`, tracked through mid-session changes {#p09-active-model}

**Decision:** The Z2 MODEL chip shows the **currently active** model, which the user can
change mid-session. The model is recorded per assistant entry in the JSONL
(`message.model`), so the active model is the **last real** `message.model`, NOT the
first. The current synth ([P04]/#step-3) emits the **first** real model — correct only
when the model never changed; wrong for any session where the user switched models.

**Mechanism:** During replay, emit a `system_metadata{model}` on the first real model
**and re-emit on every subsequent model change**. `SessionMetadataStore` keeps the
latest payload per feed, so the store naturally lands on the **active** model at
end-of-replay, and per-turn model attribution stays faithful if ever surfaced. Live
mid-session changes already flow as fresh `system_metadata` from Claude Code → fan-out →
store; replay must mirror that, not freeze the opener's model.

**Implications:**
- #step-3's "first real model" synth is superseded by "track real-model changes; final =
  active." `isRealModelName` ([P04]) still gates each emission.
- Tests must cover a JSONL whose model changes mid-session (e.g. opus → sonnet) → the
  restored chip shows the **last** model, and CONTEXT-max follows it.

## A.2 Metric inventory & sync contract {#metric-inventory}

The Z2 surface and the per-turn popovers expose these metrics. For each: its
authoritative source, whether the JSONL carries it, and the mechanism that must keep it
in sync through the whole lifecycle. **"Target-stable" = correct on a fresh instance
with empty durable tables.**

**Table T02 — Z2 metric sync contract** {#t02-metric-contract}

| Metric | Authoritative source | In JSONL? | Live sync (incremental) | Replay/restore sync | Target-stable today? | Gap |
|---|---|---|---|---|---|---|
| **TOKENS** (per-turn Δ) | per-turn `usage` | ✅ | `cost_update` → reducer | `telemetry.cost` (Steps 1–2) → `perTurn` | ✅ (JSONL) | none — done |
| **CONTEXT used** | `window(latest)` of per-turn `usage` | ✅ | derived from `cost` | derived from replayed `cost` | ⚠ (JSONL) | steady-state done; **compaction-boundary carry-forward bug** ([S03], #step-9) |
| **CONTEXT max** | `resolveModelContextMax(MODEL)` | ⛔ (derived from MODEL) | follows live MODEL | follows replayed MODEL | ❌ | blocked on MODEL ([P06]) |
| **MODEL** (active) | **latest** real `message.model` ([P09]) | ✅ | live `system_metadata` (incl. mid-session change) → fan-out → `SESSION_METADATA` → store | replay synth tracks model changes; final = active; must reach store; durable fallback EMPTY on fresh target | ❌ | #a3-model-delivery, [P09], #step-7 |
| **EFFORT** | Claude Code setting | ⛔ | `session_capabilities` handshake / `--effort` → store | not in JSONL; needs durable, target-stable persist | ❌ | [Q05], #step-8 |
| **TIME** (wall/active/ttft, per turn) | reducer clocks (live) | ⛔ | `deriveTurnTelemetry` → `turn_telemetry` | overlay from `turn_telemetry` ([P03]) — EMPTY on fresh target | ❌ | [Q05] — best-effort or durable |
| **/context breakdown** (popover) | `context_breakdown_latest` | ⚠ partial (usage is; the labeled slices aren't) | live frame → table | table EMPTY on fresh target; partly reconstructable from `usage` | ❌ | [Q05] |
| **STATE / TIME(elapsed) / TASKS / JOBS** | live runtime | n/a | live | n/a (runtime, not historical) | ✅ | none |
| **MODEL `[1m]` variant suffix** (chip "· 1M") | live `system_metadata.model` | ⛔ (JSONL is bare) | live | bare name → max correct via override, but chip omits "· 1M" | ⚠ | [Q06] cosmetics |

## A.3 The five lifecycle cases {#lifecycle-cases}

Each entry point reaches the Z2 readouts differently. The plan must hold for all five.

**Table T03 — lifecycle entry points** {#t03-lifecycle}

| Case | What happens | Replay re-runs? | Durable tables consulted? | Risk |
|---|---|---|---|---|
| **C1 Incremental** (live turns) | Claude Code streams; reducer derives live | no | written (recorder) | recorder silent-skip writes empty-model rows ([Q04]) |
| **C2 HMR** (Vite hot-swap) | JS modules swap; per [project_hmr_vs_reload] data/transcript must NOT reload | **TBD — spike #step-6b** | depends on store survival | if stores re-mount and durable empty → MODEL "?" |
| **C3 Maker ▸ Reload** (hard refresh) | true re-resume from JSONL; stores re-created; cards re-bound | **yes** | on-bind `persisted_metadata_replay` (empty on fresh target) | model must come from replay, not durable |
| **C4 App relaunch** (restored cards) | app restarts; saved deck cards re-bind; each session cold-replays | **yes** | same as C3 | same as C3 |
| **C5 Picker replay** | user picks a session; card binds; cold replay | **yes** | likely none for a never-seen session | the purest "no durable data" case |

C3/C4/C5 are the **cold-replay family**: the durable tables may be empty (always so for
C5 on a new session, or any fresh target), so **MODEL/CONTEXT-max must be carried by the
replay itself** ([P06]). C2 (HMR) is the odd one — it must *preserve* the already-correct
live state without re-replaying; its correctness depends on store survival, which
**#step-6b must establish before any C2 fix is designed**.

#### Why the model doesn't land today — verified mechanism (the fault is ORDERING, not a missing replay) {#a3-model-delivery}

The on-bind metadata replay **already exists**: `do_spawn_session`
(`agent_supervisor.rs:2337`) emits, at bind, `entry.latest_metadata` if present, else
`persisted_metadata_replay_frame` (the sqlite `session_metadata` row). The replay synth
emits `system_metadata{model}` on `CODE_OUTPUT` (`agent_bridge.rs:1189`); the supervisor
fan-out (`agent_supervisor.rs:3957`) rewraps it onto `SESSION_METADATA`, stores
`latest_metadata`, and live-broadcasts via `session_metadata_tx` (`3968`). So the
machinery is all there — the bug is **sequencing**, confirmed by reading the spawn path:

1. **The bind-emit fires BEFORE the replay populates `latest_metadata`.** On a fresh /
   empty-DB cold spawn, at the `2337` bind-emit both `latest_metadata` (None — replay
   hasn't run) and the persisted row (empty) are absent → the bind-emit sends **nothing**.
   The model then arrives only via the live broadcast at `3968` *during* replay, which
   **races the card's `SESSION_METADATA` subscription** — if the card subscribes after
   the broadcast flew, it never sees it (the broadcast is not replayed on a late
   subscribe; only `latest_metadata`/persisted are, and those re-check happens only at
   the one bind-emit). **This is the dominant failure.**
2. **No durable row is written even on cold replay.** `merge_and_persist_system_metadata`
   runs only when `claude_session_id` is `Some` (captured on a live `session_init`); a
   *pure* replay (picker/offline) emits no `session_init`, so the synth's
   `system_metadata` takes the `_ =>` passthrough → no `session_metadata` row → nothing
   for a *subsequent* bind to fall back to. (A `--resume` differs: it brings a live
   `session_init` + handshake — keep the two paths distinct in tests.)
3. **A stale/empty durable row can CLOBBER the good model (#q04-empty-model-rows).**
   Where a `session_metadata` row exists but has an empty model (observed in `debug-main`,
   `8f2b15be → ""`), the bind-emit replays an **empty-model** frame, and depending on
   `merge_session_metadata` ordering it can override the JSONL-reconstructed model. The
   fix must make the reconstructed/active model **win** over a stale-or-empty durable row
   (see [P06] precedence rule).

**The #step-7 fix is therefore an ordering/precedence fix, not a new replay path:** make
the synth's active model reach the bound card's `SESSION_METADATA` feed *after*
`latest_metadata` is set (re-emit post-replay, or order the bind-emit after the replay's
first model), and ensure it takes precedence over a stale/empty durable row.

## A.4 Build-target testing strategy {#target-testing}

[P05] means **a worktree build cannot faithfully reproduce a durable-data restore** —
its DB is empty. Options to make verification trustworthy (decide in [Q07]):
- **(a) DB-independence as the acceptance bar** — require every in-scope metric to be
  correct on an EMPTY durable DB (i.e. reconstructed from JSONL, or explicitly blank for
  EFFORT/TIME pending [Q05]). This turns the isolation into a *feature*: the worktree's
  empty DB is the strictest test of [P06]. Preferred.
- **(b) Seed the worktree DB** — copy `debug-main/sessions.db` into the worktree
  instance dir before testing, so durable-path restores can be exercised. Useful for
  testing the durable path itself (EFFORT/TIME) but masks [P06] regressions.
- **(c) app-test harness** — an `tests/app-test/` case that cold-replays a fixture JSONL
  into a fresh store and asserts the Z2 snapshot (model, context-max, tokens) — runs on
  any target, no GUI, no durable seed. The real verification vehicle this plan lacked.

## A.5 New / revised open questions {#a5-open-questions}

#### [Q04] Why are some `session_metadata` rows written with an empty model? {#q04-empty-model-rows}
`debug-main` has rows like `8f2b15be → ""`. Is the live recorder keying on an unresolved
`claude_session_id`, or persisting before `system_metadata` lands, or merging a bare
payload over a good one? **Resolve via spike in #step-6a** (read
`merge_and_persist_system_metadata` + `record_session_metadata` keying); decide whether
to harden the recorder or render it moot via [P06].

> **Already promoted to a design constraint (not deferred):** regardless of *why* the
> empty rows exist, the [P06] **precedence rule** mandates that such a row must never
> clobber the reconstructed/active model on bind (#a3-model-delivery cause 3, #step-7
> part 3). The spike decides whether to *also* harden the recorder; the no-clobber
> behavior is required either way.

#### [Q05] Target-stable strategy for the non-JSONL metrics (EFFORT, per-turn TIME, /context breakdown) {#q05-non-jsonl-metrics}
These cannot be reconstructed from the JSONL. Per the user, scope is "everything," so
each needs a decision: (i) persist durably in a target-stable store and accept blank on
a brand-new target/session, (ii) reconstruct what *is* derivable (e.g. /context usage
slices from `message.usage`), (iii) for EFFORT, source from the `session_capabilities`
handshake on every live (re)connect — **with an explicit blank where no live source
exists** (pure offline replay). **Resolved per-metric in #step-8a (EFFORT), #step-8b
(TIME), #step-8c (/context breakdown).**

#### [Q06] Restore the exact `[1m]` model variant, or accept bare-name + correct max? {#q06-model-variant-cosmetics}
The JSONL model is bare (`claude-opus-4-7`); the live chip shows "· 1M" only for the
`[1m]` suffix. With the [Q03] override the **max** is already correct (1M) from the bare
name, but the chip text omits "· 1M". Options: (a) accept bare chip + correct max
(no durable dependency); (b) restore the precise variant from durable `session_metadata`
(target-unstable). Lean (a) unless the chip text is deemed load-bearing.

#### [Q07] Verification vehicle: DB-independence bar vs seeded DB vs app-test {#q07-verification}
Pick the #target-testing option(s). Recommend (a)+(c): make DB-independence the
acceptance bar and add an app-test that cold-replays a fixture into a fresh store.

## A.6 Revised execution steps {#a6-steps}

> Steps 1–5 stand. Step 6 is superseded by the staged sequence below. **No code until
> these are vetted** — this addendum is a plan revision, not an implementation.

| Step | Title | Status |
|---|---|---|
| #step-6a | Spike: durable recorder keying + empty-model rows ([Q04]) | pending |
| #step-6b | Spike: HMR store survival (C2) — does the services bag re-mount or persist? | pending |
| #step-6c | Stand up the cold-replay app-test vehicle ([Q07], #target-testing) | pending |
| #step-7 | Target-stable ACTIVE-MODEL delivery: ordering + precedence ([P06]/[P09]) | pending |
| #step-8a | EFFORT restore (handshake re-emit; explicit blank on pure offline replay) | pending |
| #step-8b | Per-turn TIME: durable-or-blank strategy | pending |
| #step-8c | /context breakdown: reconstruct usage slices + durable-or-blank | pending |
| #step-9 | CONTEXT denominator + compaction-reset verification ([P07]/[S03]) | pending |
| #step-10 | Integration matrix: all in-scope metrics × C1–C5, empty-DB + seeded | pending |

**#step-6a — Recorder/keying spike.** Read `merge_and_persist_system_metadata`,
`record_session_metadata`, and the `claude_session_id` capture; explain the empty-model
rows; decide harden-vs-moot. Output: a finding + the [Q04] resolution. No product code.

**#step-6b — HMR survival spike.** Determine whether `card-services-store` (and thus
`SessionMetadataStore` + `CodeSessionStore`) survives an HMR or re-mounts, and whether a
re-mount re-binds (triggering on-bind metadata replay). This decides whether C2 needs a
*preservation* fix (state survives HMR) or a *re-delivery* fix (re-bind replays
durable/JSONL metadata). Cross-check `tuglaws.md` [L23]/[L26] (state/mount preservation)
and `project_hmr_vs_reload`. Output: the C2 mechanism + the #step-7 design constraint.

**#step-6c — Cold-replay app-test vehicle.** Stand up the verification harness #step-7+
depend on, BEFORE they need it (resolves the ordering wrinkle that #step-7's tests
referenced a vehicle defined in #step-9). A `tests/app-test/` case (run via
`just app-test`) that cold-replays a fixture JSONL into a **fresh, empty-DB** store and
reads back the Z2 snapshot (model, context-max, context-used, tokens). Runs on any
target with no GUI and no durable seed — the strictest test of [P06] (#target-testing
option (c)). Commit: the harness + a smoke fixture (cost-only, already-correct) so the
vehicle itself is green before behavior steps land.

**#step-7 — Target-stable ACTIVE-MODEL delivery (ordering + precedence).** Per the
verified mechanism in #a3-model-delivery, this is an **ordering + precedence** fix, not a
new replay path (the on-bind `latest_metadata` replay already exists at
`agent_supervisor.rs:2337`):
1. **Active model ([P09]):** change the synth from "first real model" to "track real-model
   changes through replay; final emission = the active (last) model" (`isRealModelName`
   still gates each emission). Fixture: model-switch (opus → sonnet) → restored chip shows
   the **last** model.
2. **Ordering ([P06], #a3-model-delivery cause 1):** ensure the synth's active model
   reaches the bound card's `SESSION_METADATA` feed *after* `latest_metadata` is set —
   re-emit post-replay, or order the bind-emit after the replay's first model — so an
   empty-DB cold spawn (C3/C4/C5) is not lost to the subscription race.
3. **Precedence / no-clobber ([P06], #a3-model-delivery cause 3):** the reconstructed/
   active model must **win** over a stale-or-empty durable `session_metadata` row; a
   durable row may only fill in when it carries a *real* model the replay lacked.
4. Keep the `--resume` (live `session_init` + handshake) path distinct from the pure
   offline replay path in tests (#a3-model-delivery cause 2).

Tests: tugcast frame-routing (replay `system_metadata` → `SESSION_METADATA`, last wins;
empty/stale durable row does NOT clobber) + a pure-logic wire-frame test
(`SessionMetadataStore` ← `SESSION_METADATA` feed, last-model-wins) + the #step-6c
app-test (fresh empty-DB store, model-switch fixture → active model + CONTEXT-max
resolve).

**#step-8a — EFFORT restore.** Per [Q05]. EFFORT rides the `session_capabilities`
handshake → `SESSION_METADATA`; `latest_capabilities` is replayed on bind
(`agent_supervisor.rs:2357`) **but is in-memory only** (docstring `:264`). So EFFORT is
restorable **only when a live (re)connect re-emits the handshake** (C1, and the C3/C4
`--resume` path). On a **pure offline replay** (C5 picker of a never-live session; C4
before reconnect) there is **no EFFORT source** — it must render an explicit
blank/unknown, never a stale value, unless a durable last-known-effort persist is added
(decide here). State the availability boundary plainly; do not claim EFFORT is restored
where no source exists.

**#step-8b — Per-turn TIME (wall/active/ttft).** Not in the JSONL; only ever from the
`turn_telemetry` side-table (empty on a fresh target — [P05]). Per [Q05]: render the
TIME popover from `turn_telemetry` when present, **explicit blank/"—" when absent**
(never a fabricated value). No JSONL reconstruction is possible; document this as a known
limitation of historical replay.

**#step-8c — /context breakdown.** The `usage`-derived slices (input/output/cache) ARE
reconstructable from the JSONL per-turn `message.usage`; the labeled/reserved slices
(`autocompact_buffer`, etc.) are not. Per [Q05]: reconstruct the usage-derived portion
from the replayed cost so the popover is non-empty on a fresh target; show the
non-reconstructable slices only when `context_breakdown_latest` is present.

**#step-9 — CONTEXT denominator + compaction-reset correctness.** Assert (a) denominator
= the model's window (1M for opus/sonnet/fable) once MODEL resolves; (b) **[S03]**:
CONTEXT-used resets across a `/compact` boundary — fixture `big-window → zero-usage
compact boundary → small-window`, asserting the value reflects the **post-compact** window
throughout and never the stale pre-compact peak (this likely requires refining
`deriveContextWindows`' carry-forward to not carry across a detected compaction). Uses the
#step-6c vehicle.

**#step-10 — Full matrix.** Verify every in-scope metric across C1–C5 on a **fresh,
empty-DB target** (the worktree itself is the test bed once [P06] holds), plus a seeded-
DB pass for the durable-only metrics (EFFORT/TIME present). Asserts the availability
boundaries from #step-8a/8b (blank where no source exists) are honored, not silently
wrong.

## A.7 Answers to the two diagnostic questions {#a7-answers}

- **Session-id matchup?** A *real secondary* fault — the live recorder writes
  empty-model `session_metadata` rows for some sessions ([Q04]), a keying/timing
  fragility. Not the cause of the worktree test failure.
- **Build-system / worktree data sync?** **Yes — the dominant cause.** Per-instance DBs
  ([P05]) mean the worktree target starts with empty durable tables; the user's real
  metadata lives in `debug-main`. The fix is not to share DBs but to make the in-scope
  metrics **target-stable** ([P06]) — reconstructed from the shared JSONL where possible,
  and explicitly handled where not.
