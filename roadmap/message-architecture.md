## Message-Centric Transcript Architecture {#message-architecture}

**Purpose:** Replace the Dev card's turn-paired row model with a flat, message-derived row stream so a user message can stand alone in the transcript — unlocking mid-turn message *steering* (queued messages claude picks up while working, like the Claude Code TUI) and leaving the door open for future non-assistant message kinds (e.g. shell interactions) to interleave.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Today a user message typed while a turn is streaming is held client-side in `queuedSends` and only forwarded to the backend at `turn_complete(success)` (the legacy `D-T3-07` behavior, documented in `roadmap/archive/tide.md` and encoded in the reducer's `handleSend` / `handleTurnComplete` comments). The backend is already capable of steering — `tugcode` writes user messages to claude's stdin immediately (`handleUserMessage`) and spawns claude with `--input-format stream-json --include-partial-messages`, so claude *can* merge a mid-turn message into the running turn at an agent-loop boundary. The only thing suppressing steering is the tugdeck reducer refusing to emit the frame until the turn ends.

The deeper blocker is the **rendering model**, not the queue. `dev-transcript-data-source.ts` projects at most two rows per turn — one user row + one assistant row — gated on `TurnEntry.origin`. A user message that claude *merges* mid-turn (a second `user_message` appearing partway through a turn's `messages`) has nowhere to render. So before steering can ship, the transcript must become a flat message-row stream where a user message is a first-class row independent of any assistant response. That refactor is also the architecture we want regardless: the data layer is *already* a flat `messages: ReadonlyArray<Message>` list (paired `userMessage`/`assistant` fields were retired); only the row-projection layer still assumes pairs.

**A critical unknown gates the steering half.** How tugdeck *optimistically places* a steered message in the right turn before authoritative JSONL truth arrives depends on what claude emits on the live wire when it merges vs buffers — and tugcode's own code says claude gives **no merge/buffer signal** (`session.ts` `pendingTurnInputs` doc: "claude emits no signal for it"; `types.ts` live-path doc: the steady-state live path emits no `add_user_message`, only `prompt_anchor`). The *buffer* case is well-understood (claude runs the message as a follow-on turn with its own `result`); the *merge* case may be invisible live. So this plan **spikes the wire first** (Step 1) and selects the reconciliation design from pre-specified branches, defaulting to a robust best-effort design that does not depend on a merge signal existing. The rendering refactor (Steps 2–4) does not depend on the spike and can land independently.

#### Strategy {#strategy}

- **Spike the wire behavior first (Step 1).** Capture a merge and a buffer case from the real backend; determine whether a merged mid-turn message produces any live, placeable wire event (and its timing vs `result`). This selects the steering reconciliation branch (`#steering-reconciliation-branches`) *before* any steering code is written.
- **Refactor the row projection (Steps 2–4), behavior-preserving.** Rows derive from each turn's `messages` (walk + group) instead of the 2-row/origin template; `messageKey` addressing with derived `#uN`/`#aN` labels; multi-user-per-turn rendering. Independent of the spike — ships on its own value.
- **Wire steering on top (Steps 5–6), using the spike-selected design.** Forwarding mechanics (bytes-only forward after a cancel window, existence-guarded flush, `cancel_timer` on every clear path) are branch-independent (`[P06]`); reconciliation (`[P07]`) is whichever branch the spike chose, defaulting to best-effort-ghost + JSONL-authoritative placement.
- **Leave `/rewind` anchored on turn openers** — merged mid-turn messages render but are not independently rewind-targetable in v1, keeping the rewind picker and the "first prompt_anchor wins" reducer invariant untouched.
- **Sequence so each step has a falsifiable checkpoint**, with the steering UX layered only after both the spike and the rendering substrate are in place.

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable. Avoid "works well".

- The Step 1 spike produces a captured fixture (under `stream-json-catalog/`) showing the live wire for a merged and a buffered mid-turn message, and `[P07]` records the selected branch with its rationale. (`#step-1`, `[Q01]`)
- A message submitted while `phase` is streaming/tool_work is forwarded to the backend within `QUEUE_STEER_WINDOW_MS` (not held to `turn_complete`), verifiable by a reducer/effect test asserting a `send-frame` (via `schedule_timer` → fire → `send-frame`) is emitted before any `turn_complete` event. (`#s02-steer-lifecycle`)
- A forwarded message is never sent twice across **all** races — timer-vs-collapse, within-window completion, and interrupt: no test scenario produces two `send-frame` effects for one `turnKey`. (`[P06]`, `Risk R03`)
- No phantom turn is ever minted for a merged message: under the default branch no forwarded entry is optimistically minted at the collapse; under the optimistic branch a merge is absorbed before the collapse. Either way, no transcript row hangs forever in `submitting`. (`[P07]`, `Risk R04`)
- A turn whose `messages` contains a `user_message` at a non-head index renders as `user, assistant, user, assistant` rows in arrival order, each user row keyed by its own `messageKey`, with the per-turn badge on the bracket's last assistant row. (`Spec S01`, `[P04]`)
- All existing `dev-transcript-data-source`, `code-session-store` queue, and `reducer.rewind` tests pass unchanged after the rendering refactor. (`#step-2`, `[P05]`)
- `/rewind` still anchors correctly on turn openers; a merged turn's second user message renders but is correctly absent from the rewind picker. (`[P05]`)
- `cargo`/`bun` builds stay warning-clean and the Dev card app-test for mid-turn steering passes (`just app-test`). (`#exit-criteria`)

#### Scope {#scope}

1. Wire-behavior spike: capture merge/buffer live frames; select the reconciliation branch; finalize `[P07]`.
2. Row-projection refactor in `dev-transcript-data-source.ts` (layout, addressing, `rowAt`/`kindForIndex`/`idForIndex`).
3. `messageKey`-based addressing + derived `#uN`/`#aN` labels; per-turn-telemetry anchoring for multi-assistant-row turns.
4. Multi-user-per-turn rendering, with the absorbed-message keying invariant and per-turn-token badge placement.
5. Steering wire: `forwarded` bit, `QUEUE_STEER_WINDOW_MS` timer, existence-guarded flush, `cancel_timer` on every clear path, `×` disable-after-flush.
6. Echo reconciliation per the spike-selected branch.
7. Revise the `D-T3-07` behavior note and the reducer/data-source docstrings.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Shell interactions in the transcript. The model is designed to *admit* new `Message.kind`s additively, but no shell kind, renderer, or backend is built here.
- Moving the `/rewind` anchor onto individual messages / making merged mid-turn messages rewind-targetable. Rewind anchors on turn openers in v1 (`[P05]`); per-message rewind is a follow-on.
- Restructuring the "thinking" indicator into standalone phase chrome. The assistant row already renders `assistant_thinking` inline; `[P07]` (no phantom turn) is the only optimistic-turn change this plan makes.
- Changing the backend (`tugcode`/`tugcast`) steering mechanics. The backend already forwards mid-turn; only the tugdeck client and the wire signals it *reads* are in scope. (If the spike shows a merge is truly unobservable live and we *want* it observable, that backend change is a separate plan.)
- Tuning the cancel window beyond shipping a single named constant (`[Q03]`).

#### Dependencies / Prerequisites {#dependencies}

- Existing effect system supports `schedule_timer` / `cancel_timer` (`effects.ts`) and the store-wrapper `TimerSource`.
- `tugcode`'s mid-turn merge/buffer behavior is observable on the wire (`tugcode/.../probe-tool-overlap.ts`, the `stream-json-catalog` fixtures) — the Step 1 spike's substrate.
- Every Message already carries a stable `messageKey` (`MessageBase`).

#### Constraints {#constraints}

- tugdeck laws: external state via `useSyncExternalStore` only (`[L02]`); appearance via CSS/DOM not React state (`[L06]`); mount identity stable across in-flight→committed (`[L26]`) and scroll/content preserved (`[L23]`). The row refactor must not regress the no-remount-at-`turn_complete` guarantee.
- The reducer stays **pure**: all wall-clock/timer behavior lives in the store wrapper via effects; the cancel window is a `schedule_timer` effect, never `Date.now()` inside the reducer.
- Builds enforce `-D warnings`; tugdeck HMR is live (no manual builds); app-tests via `just app-test` (default run does **not** spawn real claude — real-claude steering is the on-demand path).

#### Assumptions {#assumptions}

- The **buffer** path is live-observable: claude runs a buffered mid-turn message as a follow-on turn with its own `result`, and tugcode opens an `ActiveTurn` for it (`session.ts` `pendingTurnInputs` doc). The steering design relies on this; the spike confirms the exact wire shape.
- A turn bracket (one claude `result`) may legitimately contain ≥1 `user_message` after merge; cost/timing/telemetry aggregate over the bracket unchanged.
- The recency relationship ("assistant responds to the most recent user message") is presentational only; `/rewind` uses the turn-opener `promptUuid`, never recency or a merged message.
- Whether a **merge** is live-observable is **NOT assumed** — it is the open question the Step 1 spike resolves (`[Q01]`). The default reconciliation branch (`[P07]`) is correct even if it is not.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` headings and rich `References:` lines. Plan-local decisions are `[P01]…`; global decisions cited by `[D##]`. Step dependencies cite `#step-N` anchors. No line numbers in references.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Live wire behavior for a merged mid-turn message (OPEN → resolved in Step 1) {#q01-merge-wire}

**Question:** When claude *merges* a forwarded mid-turn message into the running turn, does it emit **any live wire event** tugdeck can place the message by — and if so, what is the correlation key (a mid-turn `prompt_anchor`? a user-content event?) and does it arrive **before** that turn's `result`? Separately, confirm the *buffer* opener's exact live shape.

**Why it matters:** This selects the entire reconciliation design (`#steering-reconciliation-branches`). tugcode's code says claude emits no merge/buffer discriminant signal and the live path emits no `add_user_message`, so a merge may be invisible live — in which case any "optimistically mint at collapse" scheme would manufacture a phantom turn for every merge.

**Options (branches):** see `#steering-reconciliation-branches` — (A) optimistic absorption if a placeable pre-`result` merge signal exists; (B) best-effort-ghost + JSONL-authoritative placement (the default, correct with no merge signal); (C) partial.

**Plan to resolve:** Step 1 — run `probe-tool-overlap.ts` / inspect `stream-json-catalog`, capture a merge and a buffer case, record the frames and ordering. Pick the branch; finalize `[P07]`, `Spec S02`'s reconciliation half, and Step 6's tests against the captured shapes.

**Resolution:** OPEN — resolved in `#step-1`.

#### [Q02] Reconciliation fallback for the residual cases (OPEN → resolved in Step 1) {#q02-reconcile-fallback}

**Question:** Whatever branch Step 1 picks, what clears a forwarded ghost that never resolves on the live wire (an echoless merge under branch B, or a late merge echo under branch A)?

**Why it matters:** A stranded ghost or a hung phantom is a visibly wrong transcript until reload.

**Options:** authoritative reconciliation at the next turn boundary against committed data; Developer▸Reload re-resume from JSONL (`project_hmr_vs_reload`) as the always-correct backstop; under branch A, a late-echo collapse of the just-minted phantom.

**Plan to resolve:** Decide in Step 1 alongside the branch choice; implement in Step 6.

**Resolution:** OPEN — resolved in `#step-1`.

#### [Q03] Cancel-window duration (DECIDED) {#q03-window-duration}

**Question:** What is `QUEUE_STEER_WINDOW_MS`?

**Resolution:** DECIDED — `2000` ms initial; a single tunable named constant; revisit after dogfooding (`[P06]`).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Addressing churn breaks app-tests / keyboard nav | med | med | Behavior-preserving Step 2; keep `#uN`/`#aN` labels; only `dev-card-telemetry-popovers.tsx` + the data-source test consume the row-index helpers | Any addressing test red |
| Scroll/mount regression (L26/L23) | high | med | Preserve per-Message `messageKey` keys; unit-test id stability across in-flight→committed | Scroll-jump observed in app-test |
| Steer-timer fires for an already-resolved entry → spurious/double send | high | med | Existence-guarded flush + `cancel_timer` on cancel/interrupt/collapse | Any test shows >1 `send-frame` per `turnKey` |
| Merge is invisible live → phantom/orphan if we mint optimistically | high | med→? | Spike-first (Step 1) selects the branch; default branch B mints no forwarded entry optimistically; JSONL-authoritative backstop | Spike shows merge unobservable AND we still want live placement |

**Risk R01: Addressing churn** {#r01-addressing-churn}

- **Risk:** Re-basing addresses on `messageKey` and allowing >2 rows/turn breaks `userRowIndexForTurn`/`assistantRowIndexForTurn` callers, the `#t…m…`/`#u`/`#a` address, keyboard nav, and app-tests.
- **Mitigation:** Step 2 keeps output byte-identical for single-user turns; the only consumers of the row-index helpers are `dev-card-telemetry-popovers.tsx` and `dev-transcript-data-source.test.ts` (verified), migrated together with tests; derived labels preserve legibility.
- **Residual risk:** App-tests that hardcode flat row indices may need re-pinning.

**Risk R02: Mount/scroll stability** {#r02-mount-stability}

- **Risk:** Multiplying rows per turn could reintroduce the `turn_complete` scroll-jump if React keys change.
- **Mitigation:** Keys remain `${turnKey}-…` seeded plus per-Message `messageKey`; `[L26]`/`[L23]` invariants asserted in the data-source unit tests.
- **Residual risk:** New row kinds in future must follow the same keying discipline.

**Risk R03: Spurious / double send from a stale steer timer** {#r03-double-send}

- **Risk:** A `schedule_timer`-fired flush emits a `send-frame` for an entry that has already left `queuedSends` (or already forwarded) — three races: timer-vs-collapse, within-window completion, interrupt.
- **Mitigation:** `flush_queued_send` is **existence-guarded** (emit only if the entry is still present and not `forwarded`); the collapse never re-sends a `forwarded` entry; `cancel_timer` on `cancel_queued_send`, both interrupt sites, and the collapse. The existence-guard alone closes all three races.
- **Residual risk:** None for send-duplication once the guard gates the flush.

**Risk R04: Merge invisible on the live wire** {#r04-merge-invisible} 

- **Risk:** If a merged mid-turn message produces no placeable live event, any scheme that optimistically mints a forwarded entry at the collapse manufactures a phantom turn for every merge (hangs in `submitting` until a watchdog), and live placement of a merged message into its turn is impossible until JSONL truth arrives.
- **Mitigation:** Step 1 spikes this before any steering code. The **default** reconciliation branch B (`[P07]`) mints **no** forwarded entry optimistically — a steered message renders as a persistent "sent" ghost and is placed authoritatively by the next turn boundary / a Developer▸Reload re-resume from JSONL (`project_hmr_vs_reload`). The optimistic branch A is adopted **only** if the spike confirms a usable signal.
- **Residual risk:** Under branch B, a merged message is not optimistically interleaved into its turn live (it shows as a foot ghost until the next authoritative reconciliation). Acceptable v1; an enhancement if the spike unlocks branch A.

---

### Design Decisions {#design-decisions}

#### [P01] Rows derive from the message stream, not a turn template (DECIDED) {#p01-message-derived-rows}

**Decision:** The row projection walks each turn's `messages` and emits one row per logical group — every `user_message` opens a `user` row; each maximal run of non-user Messages forms one `assistant` row — instead of the fixed "≤1 user + ≤1 assistant, gated on `origin`" template.

**Rationale:**
- The data layer is already a flat `messages` list; only the projection assumed pairs (`dev-transcript-data-source.ts`, `[D07]`).
- A merged mid-turn user message must render as its own row between assistant content — impossible under the 2-row cap.
- Generalizes to future kinds without another reckoning (`[P04]`).

**Implications:**
- `buildRowLayout`, `locateCommittedRow`, `userRowIndexForTurn`, `assistantRowIndexForTurn`, `idForIndex`, `kindForIndex`, `rowAt` all switch from per-turn arithmetic to a per-Message walk.
- `RowLayout` records per-row → (turnIndex, message-group) mapping, not just `turnHasUserPerTurn`.

#### [P02] The turn survives as a metadata bracket only (DECIDED) {#p02-turn-as-metadata}

**Decision:** `TurnEntry` / the `result` bracket remains the unit for cost, timing, telemetry, and rewind *grouping*, but no longer gates how many rows render.

**Rationale:**
- The wire's `result` is a real boundary where usage/cost/`ttftMs` aggregate — we keep it.
- Rendering and bracketing are orthogonal; conflating them is what blocks steering.

**Implications:**
- A bracket may contain >1 `user_message` (merge). Per-turn token/cost stays per-bracket; `deriveContextWindows` is unaffected.
- `origin` stays as the bracket's *opener* attribution but is no longer the row-count authority.
- Per-turn telemetry (the `perTurnTokens` badge + popover) is a *bracket* quantity, so with multiple assistant rows it anchors to the **bracket's last assistant row** (`[P04]`, Step 3).

#### [P03] Recency-implied response; no stored user↔assistant binding (DECIDED) {#p03-recency-binding}

**Decision:** "This assistant block answers that user message" is derived by adjacency, not stored.

**Rationale:** Matches the desired UX (a queued message lands as a standalone user message) and claude's flat JSONL; dissolves merge-vs-buffer at the *render* layer (both are just rows in arrival order).

**Implications:** Recency is presentational only. Anything load-bearing (rewind) uses the explicit turn-opener `promptUuid` (`[P05]`), never position.

#### [P04] `messageKey` is the row address; `#uN`/`#aN` are derived labels; the row layer is kind-open; absorbed messages keep their key (DECIDED) {#p04-addressing}

**Decision:** Row identity/addressing keys on the Message's stable `messageKey`; labels (`#u1`, `#a1`, `#u2`, future `#sN`) are per-kind ordinals in stream order. The row layer discriminates on `Message.kind` and never hardcodes a closed `user|assistant` set. A merged message **retains its original `messageKey`** when placed into a host turn — never re-derived under the host `turnKey`. Per-turn telemetry anchors to the bracket's last assistant row (`[P02]`).

**Rationale:**
- `messageKey` already exists and is stable across streaming (`MessageBase`); positional numbers are fragile under append.
- Keeps `#u`/`#a` legibility while making new kinds additive (a renderer case, not a refactor).
- `userMessageKey(turnKey)` = `${turnKey}-user` and `[D07]`'s "one `user_message` per turn at most" assume single-user turns. A merged message carries its own queue-time `turnKey`, so its key is distinct — **only if placement preserves it**. Re-deriving under the host `turnKey` collides with the host opener's key.

**Implications:**
- Addressing consumers migrate from `#u`/`#a`-per-turn helpers to a `messageKey`-based scheme.
- A `switch (message.kind)` (exhaustive-but-extensible) replaces the boolean `isAssistantRow`.
- The `[D07]` "one per turn at most" note on `MessageBase` is revised; `idForIndex` uses the message's own `messageKey` for any user row beyond the head.
- `dev-card-telemetry-popovers.tsx` anchors per-turn telemetry to the bracket's last assistant row.

#### [P05] `/rewind` anchors on turn openers; merged messages are not rewind-targetable in v1 (DECIDED) {#p05-rewind-on-openers}

**Decision:** The `/rewind` anchor (`promptUuid`) stays on `TurnEntry`, captured from the **first** `prompt_anchor` of the turn (the opener), as today. A merged mid-turn user message renders as a row but is not an independent rewind target in v1.

**Rationale:**
- The reducer already latches the first `prompt_anchor` per turn and ignores the rest (pinned by `reducer.rewind.test.ts` "first wins"); for a merged turn this keeps the turn opener's uuid — the correct rewind target.
- `truncateAtAnchor` and the rewind picker (`rewind-turn-source.ts`, `rewind-sheet.tsx`) are turn-based; a message-based picker is marginal value.
- Rewinding *into* a mid-turn merge point is semantically murky.

**Implications:**
- No change to `promptUuid` storage, `prompt_anchor` handling, `truncateAtAnchor`, or the rewind picker — `reducer.rewind.test.ts` stays green.
- A merged turn's second user message is correctly absent from the picker.
- Per-message rewind is a documented follow-on (`#roadmap`).

#### [P06] Steering forward mechanics: bytes-only forward after a cancel window; existence-guarded flush; cancel timers on every clear path (DECIDED, branch-independent) {#p06-steer-window}

**Decision:** A mid-turn submit stays a cancelable queued send (`forwarded: false`) for `QUEUE_STEER_WINDOW_MS` (= 2000 ms), then a `schedule_timer`-fired `flush_queued_send` event emits its `send-frame` (bytes to claude) and sets `forwarded: true` — **without minting a local turn**. The flush is **existence-guarded** (emit only if the entry is still present and not `forwarded`). `cancel_timer{"steer:<turnKey>"}` is emitted on `cancel_queued_send`, both interrupt sites, and the collapse. `×` cancels the timer if pending and is disabled once `forwarded`. These mechanics are identical across reconciliation branches.

**Rationale:**
- Preserves the un-send affordance for a brief window while enabling true mid-turn steering.
- Reuses the existing timer-effect machinery; reducer stays pure.
- The existence-guard closes all of `Risk R03`'s races.

**Implications:**
- `QueuedSend` (public) **and** the internal queue-entry shape gain `forwarded: boolean` (the ghost cell reads it to disable `×`; the flip produces a fresh entry reference so the `sameTranscriptRowData` memo re-renders).
- New `flush_queued_send` event added to the `CodeSessionEvent` union + `reduce()` switch; fired by the timer's `fire` field.
- Multiple concurrent queued sends each schedule an independent `steer:<turnKey>` timer; the collapse cancels only the head entry's.

#### [P07] Reconciliation design is spike-selected; default is best-effort-ghost + JSONL-authoritative placement (DECIDED) {#p07-reconciliation}

**Decision:** How a forwarded message is placed into a turn is chosen by the Step 1 spike from the branches in `#steering-reconciliation-branches`. The **default and fallback is branch B**: a forwarded entry is **never optimistically minted into a turn at the collapse**; it renders as a persistent "sent" ghost row and is placed authoritatively when the wire reveals its turn — a *buffered* message by its follow-on turn opening (live-observable), a *merged* message by the next turn-boundary reconciliation against committed data or a Developer▸Reload re-resume from JSONL. Branch A (live optimistic absorption: merge folded into the active turn before its `result`, buffer minted at the collapse) is adopted **only** if the spike confirms a placeable pre-`result` merge signal.

**Rationale:**
- tugdeck has one `activeTurn` slot; optimistically minting for a *merge* (which produces no follow-on `result`) would hang forever — and tugcode says claude gives no merge signal, so this is likely, not edge.
- Branch B never manufactures a phantom and is correct regardless of the merge wire shape; it is the safe floor. Branch A is a strictly-better UX upgrade *iff* the wire supports it.
- The buffer path is live-observable either way, so a steered-then-buffered message always gets a real user-origin turn (minted from its follow-on opening, keying the ghost's `UserMessage`, preserving its `messageKey`).

**Implications:**
- `Spec S02`'s reconciliation half and Step 6's tests are finalized after Step 1 against the captured wire shapes.
- Branch B's buffer minting is **live wire-driven user-origin turn creation** (new: today live turns open client-side / `add_user_message` is replay-only) — it forks the existing opener path (`handleAddUserMessage`/`handleAssistantOpener`) to mint from a matching forwarded ghost rather than open an empty turn.
- `[Q02]` defines what clears an unresolved ghost (next-boundary reconciliation / reload backstop).

#### [P08] Revise the legacy `D-T3-07` queue-until-complete behavior (DECIDED) {#p08-revise-dt307}

**Decision:** `D-T3-07` ("mid-stream submit queues, flushes only on idle/`turn_complete`") is superseded by `[P06]`/`[P07]`: queue-for-window-then-steer.

**Rationale:** `D-T3-07` predates steering support and lives only in archived plans + reducer comments, not the live global decisions.

**Implications:** Update the reducer `handleSend`/`handleTurnComplete` docstrings and the `dev-transcript-data-source` module doc; a one-line pointer in `tuglaws/design-decisions.md` may be added if the team wants it durable.

---

### Deep Dives (Optional) {#deep-dives}

#### Steering reconciliation branches {#steering-reconciliation-branches}

The Step 1 spike answers one question — *is a merged mid-turn message placeable on the live wire?* — and that picks the branch. Forwarding mechanics (`[P06]`) are identical in all three.

**Branch A — Optimistic absorption** (adopt iff a placeable pre-`result` merge signal exists):
- Merge: the signal arrives before the turn's `result`; reconciliation removes the forwarded entry and appends its `UserMessage` into the **live** turn (keeping its `messageKey`), forking the opener handler to append-not-open.
- Buffer: the entry is still present at `turn_complete` (it wasn't merged); the collapse mints its user row **without re-sending**.
- Discriminant: "still present at collapse ⇒ buffered." Sound *only* because a merge is removed pre-collapse.
- Residual: a late merge signal (after the collapse minted) → `[Q02]` late-echo collapse.

**Branch B — Best-effort ghost + JSONL-authoritative** (DEFAULT; correct with no merge signal):
- Forward leaves a persistent "sent" ghost row; nothing is optimistically minted at the collapse.
- Buffer: detected by its **follow-on turn opening** on the live wire (after the prior `result`) — known-observable; tugdeck mints a user-origin turn from the matching ghost and clears it.
- Merge: not observed live; the ghost persists until the next turn-boundary reconciliation against committed data, or a Developer▸Reload re-resume from JSONL re-places it inside its turn. No phantom, ever.
- Residual: a merged message shows as a foot ghost rather than interleaved-in-turn until the next authoritative reconciliation (`Risk R04`).

**Branch C — Partial** (e.g. a signal exists but after `result`, or only sometimes): pick the closest of A/B per the spike and document the deviation. Most likely collapses to B.

Selection is recorded in `[P07]` and `Spec S02` at the end of Step 1.

---

### Specification {#specification}

#### Spec S01: Message-derived row projection {#s01-row-projection}

Given a turn with `messages = [m0, m1, …]`:

- Emit a `user` row at each `mi` where `mi.kind === "user_message"`.
- Emit one `assistant` row per maximal contiguous run of non-`user_message` Messages (rendered inline as today).
- A wake/continuation/orphan turn (`origin === "assistant"`) yields a single leading `assistant` row, exactly as today.
- Row order is strictly `messages` arrival order.
- Each `user` row's key is the Message's own `messageKey` (`${turnKey}-user` for the opener; the placed message's original key for a merged/buffered-from-ghost row — `[P04]`).
- The per-turn-token badge / telemetry popover renders only on the bracket's **last** assistant row.
- For today's data (one head `user_message`, then assistant content), this yields the identical `[user, assistant]` pair — Step 2 is behavior-preserving.

`RowLayout` records, per flat row index, the owning turn index and message-group (start index + kind), replacing `turnHasUserPerTurn` + `isAssistantRow`.

#### Spec S02: Steering lifecycle {#s02-steer-lifecycle}

**Forward mechanics (branch-independent, `[P06]`):**

1. **queued** — `phase !== idle` at submit. Entry added with `forwarded: false` (ghost row, `×` enabled). `schedule_timer{name:"steer:<turnKey>", ms:QUEUE_STEER_WINDOW_MS, fire:flush_queued_send(turnKey)}`.
2. **canceled** — `×` before the timer fires: `cancel_queued_send` removes the entry, `cancel_timer`, restores draft. No frame.
3. **forwarded** — timer fires: if the entry is still present and not `forwarded`, emit `send-frame` and set `forwarded: true` (**no mint**; ghost stays, `×` disabled). Else guarded no-op.
4. **fresh collapse** — `turn_complete(success)` with a **non-`forwarded`** head entry: mint **and** send (today's behavior); `cancel_timer`; single-tick (final phase `submitting`, no transient `idle`).
5. **interrupted** — `interrupt()` clears `queuedSends`, `cancel_timer` for every outstanding steer timer.

**Reconciliation (branch-selected in Step 1 — default branch B):**

6. **buffer placement** — when a follow-on turn opens on the live wire and a `forwarded` ghost matches, mint a user-origin turn from the ghost's `UserMessage` (keeping its `messageKey`) and clear the ghost.
7. **merge placement** — (branch B) not live; the ghost persists until next-boundary reconciliation / reload places the message inside its turn. (branch A, if selected) the pre-`result` merge signal appends the message into the live turn and clears the ghost before the collapse; a still-present `forwarded` entry at collapse is then minted without re-sending.

Invariant (all branches): at most one `send-frame` per `turnKey` — sent at **forward** XOR at the **fresh collapse**; a `forwarded` entry is never re-sent.

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `queuedSends[].forwarded` | structure (local-data) | store reducer state + `useSyncExternalStore` | `[L02]` |
| steer timers (`steer:<turnKey>`) | structure (side-effect) | `schedule_timer`/`cancel_timer` effects in the store wrapper (wall-clock outside the pure reducer) | `[L02]` |
| Row layout (message-derived) | structure (derived) | pure `buildRowLayout` memoized per snapshot identity | `[L02]` |
| `×` enabled/disabled (forwarded) | appearance | derived from snapshot in the cell; disabled via CSS/DOM | `[L06]`, `[L02]` |
| Provisional/ghost row presentation | appearance | CSS class on the ghost cell | `[L06]` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| Unit | `buildRowLayout`/`rowAt`/addressing over synthetic snapshots; reducer transitions | Row projection, steering state machine, dedupe |
| Integration (app-test) | Drive the real Dev card: type mid-turn, observe steer | End-to-end forwarding + scroll stability |
| Drift Prevention | Existing data-source/queue/rewind tests stay green after Step 2 | Behavior-preservation gate |

#### What stays out of tests {#test-non-goals}

- No jsdom render-tree assertions or mock-store tests — banned (`feedback_real_not_fake`); steering is proven by reducer/effect unit tests over the real reducer + a real app-test.
- No test of claude's internal merge-vs-buffer choice. Reconciliation is proven by injecting the **real captured wire shapes** (from the Step 1 fixture) into the real reducer — not by mocking or by guessing frame shapes before the spike.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Per CLAUDE.md git policy, this plan's steps commit on the `tugutil dash` worktree via `tugutil dash commit` when run under `/tugplug:implement`; `main` is only updated by the user via `tugutil dash join`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Wire-behavior spike: select reconciliation branch | pending | — |
| #step-2 | Behavior-preserving message-derived row projection | pending | — |
| #step-3 | Re-base addressing on `messageKey` + derived labels | pending | — |
| #step-4 | Render multiple user rows per turn (merge-visible) | pending | — |
| #step-5 | Steering forward wire: `forwarded` bit + cancel-window timer | pending | — |
| #step-6 | Reconciliation per the selected branch | pending | — |
| #step-7 | Integration checkpoint + docstring/D-T3-07 revision | pending | — |

#### Step 1: Wire-behavior spike — select the reconciliation branch {#step-1}

<!-- Root step: no dependencies. Read-only investigation + plan finalization. -->

**Commit:** `docs(roadmap): record steering wire-behavior spike + select reconciliation branch`

**References:** [Q01] merge wire, [Q02] fallback, [P07] reconciliation, Risk R04, (#steering-reconciliation-branches, #q01-merge-wire)

**Artifacts:**
- A captured fixture under `stream-json-catalog/` showing the live wire for (a) a merged and (b) a buffered mid-turn message.
- `[P07]`, `Spec S02`'s reconciliation half, and `[Q02]` finalized to the selected branch in this plan.

**Tasks:**
- [ ] Run `tugcode/.../probe-tool-overlap.ts` (and/or capture a real mid-turn submit) to observe merge and buffer cases; save the frames.
- [ ] Determine: does a merge emit any placeable live event? Its correlation key? Before or after `result`? Confirm the buffer follow-on opener's live shape.
- [ ] Choose branch A / B / C; update `[P07]`, `Spec S02`, `[Q02]` with the decision and rationale.

**Tests:**
- [ ] N/A (investigation) — the captured fixture is the artifact Step 6's reducer tests replay.

**Checkpoint:**
- [ ] The fixture exists and the plan records the selected branch with the wire evidence backing it.

#### Step 2: Behavior-preserving message-derived row projection {#step-2}

**Commit:** `refactor(tugdeck): derive transcript rows from message stream`

**References:** [P01] message-derived rows, [P02] turn-as-metadata, [P04] addressing/keying, Spec S01, [D07], [L26], [L23], (#s01-row-projection, #r02-mount-stability)

**Artifacts:**
- `dev-transcript-data-source.ts`: `RowLayout` reshaped to a per-row → (turnIndex, group) map; the layout/addressing/`rowAt` family rewritten as a per-Message walk.

**Tasks:**
- [ ] Replace `turnHasUserPerTurn`/`isAssistantRow` with a message-group walk per Spec S01.
- [ ] Preserve `${turnKey}-user`/`${turnKey}-assistant` keys for single-user turns; key additional user rows by the Message's own `messageKey`.
- [ ] Keep the unified `"assistant"` cell kind and the no-remount invariant.

**Tests:**
- [ ] New unit: layout over a synthetic merged turn (`[user, assistant, user, assistant]`) yields 4 rows in order, each user row keyed by its own `messageKey`.
- [ ] Existing `dev-transcript-data-source` tests pass unchanged (drift gate).

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/__tests__/dev-transcript-data-source.test.ts`
- [ ] `cd tugdeck && bun test src/lib/code-session-store`

#### Step 3: Re-base addressing on `messageKey` + derived labels {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): address transcript rows by messageKey with derived #uN/#aN labels`

**References:** [P04] addressing, [P02] per-turn-telemetry anchoring, Risk R01, (#p04-addressing, #r01-addressing-churn)

**Artifacts:**
- `messageKey`-based addressing; per-kind ordinal label derivation.
- Updated consumers: `dev-card-telemetry-popovers.tsx` and `dev-transcript-data-source.test.ts` (the only callers of the row-index helpers).

**Tasks:**
- [ ] Introduce a kind-open label/address helper; remove the closed `user|assistant` boolean assumption.
- [ ] Migrate the telemetry popover's row-index usage; anchor per-turn telemetry to the bracket's **last** assistant row.

**Tests:**
- [ ] Unit: labels give `#u1,#a1,#u2,#a2` for a merged turn; `#a1` only for a wake.
- [ ] Unit: per-turn telemetry anchors to the last assistant row of a merged turn.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx tsc --noEmit`

#### Step 4: Render multiple user rows per turn (merge-visible) {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): render mid-turn user messages as standalone rows`

**References:** [P01] message-derived rows, [P03] recency binding, [P04] keying + telemetry placement, Spec S01, (#s01-row-projection)

**Artifacts:**
- `dev-card-transcript.tsx` rendering for >1 user row per turn; assistant runs split around mid-turn user rows; per-turn badge only on the bracket's last assistant row.

**Tasks:**
- [ ] Render a `user` cell for any `user_message` Message (head or mid-list).
- [ ] Split assistant runs before/after a mid-list user message into separate assistant rows.
- [ ] Render the `perTurnTokens` badge only on the bracket's last assistant row.

**Tests:**
- [ ] Unit/app-test: a synthetic merged turn shows `user, assistant, user, assistant` with correct labels, stable keys, and a single per-turn badge.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `just app-test` (merged turn renders without scroll jump — Risk R02)

#### Step 5: Steering forward wire — `forwarded` bit + existence-guarded cancel-window timer {#step-5}

**Depends on:** #step-1, #step-4

**Commit:** `feat(tugdeck): steer queued messages mid-turn after a cancel window`

**References:** [P06] forward mechanics, [P08] revise D-T3-07, Spec S02 (forward mechanics), Risk R03, (#s02-steer-lifecycle, #r03-double-send, #q03-window-duration)

**Artifacts:**
- `QUEUE_STEER_WINDOW_MS = 2000` constant; `forwarded: boolean` on the public + internal queue shapes.
- `handleSend` mid-turn branch emits `schedule_timer`; new `flush_queued_send` event (union + `reduce()` switch) emits an existence-guarded `send-frame`, sets `forwarded`, **no mint**.
- `cancel_timer` on `cancel_queued_send`, both interrupt sites, and the collapse; collapse still mints+sends only **non-`forwarded`** head entries; `×` disabled once forwarded.

**Tasks:**
- [ ] Add the constant, state field (both shapes), event + union/switch wiring, timer scheduling, existence-guard.
- [ ] Emit `cancel_timer` on cancel, both interrupt sites, and the collapse.
- [ ] Disable `×` for forwarded entries (CSS/DOM, `[L06]`).

**Tests:**
- [ ] Reducer: mid-turn submit → timer → `send-frame` before `turn_complete`; no mint at forward.
- [ ] Reducer: exactly one `send-frame` per `turnKey` across each Risk R03 race (timer-vs-collapse; within-window completion → fresh entry mints+sends + timer cancelled; interrupt → cleared + cancelled; stale fires are guarded no-ops).
- [ ] Reducer: multiple concurrent queued sends → independent timers; collapse cancels only the head's.
- [ ] Reducer: `×` before timer → `cancel_timer` + no frame; after forward → disabled/no-op.
- [ ] Reducer: fresh-entry collapse keeps final phase `submitting` (no transient `idle`).

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/code-session-store`
- [ ] `cd tugdeck && bunx tsc --noEmit`

#### Step 6: Reconciliation per the selected branch {#step-6}

**Depends on:** #step-1, #step-5

**Commit:** `feat(tugdeck): place steered messages via the selected reconciliation branch`

**References:** [P07] reconciliation, [P04] keying, [Q01] resolved, [Q02] fallback, Spec S02 (reconciliation), Risk R04, (#steering-reconciliation-branches)

**Artifacts:**
- Branch-B (default) buffer placement: fork the opener handler (`handleAddUserMessage`/`handleAssistantOpener`) to mint a user-origin turn from a matching forwarded ghost, preserving its `messageKey`; thread the ghost's bytes-store text/atoms.
- Merge placement + `[Q02]` backstop per the selected branch (branch B: next-boundary / reload reconciliation; branch A: pre-`result` absorb + late-echo collapse).

**Tasks:**
- [ ] Implement the branch chosen in Step 1, against the captured fixture shapes.
- [ ] Implement the `[Q02]` backstop for unresolved ghosts.

**Tests:**
- [ ] Reducer: replay the Step 1 **buffer** fixture → forwarded ghost becomes a user-origin turn (its `messageKey` preserved), no duplicate, no second `send-frame`.
- [ ] Reducer: replay the Step 1 **merge** fixture → placement per the selected branch (branch B: ghost persists then reconciles at boundary; branch A: absorbed pre-`result`); no phantom hang.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/code-session-store`
- [ ] `just app-test` (real-claude on-demand path: a mid-turn message forwards and is placed)

#### Step 7: Integration checkpoint + docstring/D-T3-07 revision {#step-7}

**Depends on:** #step-4, #step-5, #step-6

**Commit:** `docs(tugdeck): revise D-T3-07 queue behavior for mid-turn steering`

**References:** [P08] revise D-T3-07, [P01]–[P07], (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Update `handleSend`/`handleTurnComplete` and `dev-transcript-data-source` module docstrings (steer-window, message-derived rows, the selected reconciliation branch); revise the `[D07]` "one user_message per turn" note on `MessageBase`.
- [ ] Add the `D-T3-07` supersession note (+ optional pointer in `tuglaws/design-decisions.md`).
- [ ] Verify all success criteria.

**Tests:**
- [ ] Full `cd tugdeck && bun test` green.
- [ ] `just app-test` end-to-end steering passes.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test`
- [ ] `just app-test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A flat, message-derived transcript model in which a user message is a first-class standalone row, with mid-turn message steering whose reconciliation design is chosen from real captured wire behavior — defaulting to a robust best-effort placement that never manufactures a phantom turn.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Step 1 fixture captured and `[P07]` records the selected branch. (`#step-1`)
- [ ] Mid-turn submit forwards within `QUEUE_STEER_WINDOW_MS` and is picked up by claude (on-demand app-test). (`#s02-steer-lifecycle`)
- [ ] No double/spurious send across all three Risk R03 races; exactly one `send-frame` per `turnKey`. (`Risk R03`)
- [ ] No phantom turn for a merged message; no row hangs in `submitting`. (`[P07]`, `Risk R04`)
- [ ] Merged mid-turn user message renders as its own row in arrival order, keyed by its own `messageKey`, badge on the bracket's last assistant row. (`Spec S01`, `[P04]`)
- [ ] `/rewind` anchors on turn openers; `reducer.rewind.test.ts` green; merged messages absent from the picker. (`[P05]`)
- [ ] No scroll-jump/remount regression at `turn_complete`. (`[L26]`, `[L23]`, `Risk R02`)
- [ ] `bun test`, `bunx tsc --noEmit`, and `just app-test` all green; builds warning-clean.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] If the spike chose branch B: a backend change to make merges live-observable, unlocking branch-A optimistic interleaving (separate plan).
- [ ] Per-message `/rewind` (anchor on each user Message; message-based picker) — the deferred half of `[P05]`.
- [ ] Shell interactions as a new `Message.kind` interleaved in the same stream (the flexibility this architecture unlocks).
- [ ] "Thinking" as standalone phase chrome.
- [ ] Tune `QUEUE_STEER_WINDOW_MS` after dogfooding (`[Q03]`).

| Checkpoint | Verification |
|------------|--------------|
| Wire behavior known | Step 1 fixture + recorded branch |
| Behavior-preserving refactor | Step 2 existing tests green |
| Rendering correctness | Step 4 merged-turn render test |
| Steering correctness | Step 5/6 reducer tests (replaying the fixture) + app-test |
| Rewind integrity | `reducer.rewind.test.ts` unchanged/green |
