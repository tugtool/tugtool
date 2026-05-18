<!-- tugplan-skeleton v2 -->

## Tide Assistant Turns — Request/Response Lifecycle & Telemetry {#tide-assistant-turns}

**Purpose:** Build the request/response *turn* surface for tide cards — the layer that wraps each user-prompt → assistant-response interaction. Where [`tide-assistant-rendering.md`](./tide-assistant-rendering.md) covers content rendering (body kinds, tool wrappers, markdown / diff / terminal / file viewer / etc.), this plan covers everything that happens *around* a single turn: gauge primitives for the displays it powers, multi-clock telemetry collection on `CodeSessionStore`, the six-zone placement architecture (Z0–Z5) the tide card uses for those displays, the lifecycle state machine that coordinates them, and the on-demand `/context`-style drill-down surface.

This plan was extracted from [`tide-assistant-rendering.md`](./tide-assistant-rendering.md) Step 20.x; see that doc for the surrounding rendering-layer context. Polish-plan Steps 13 / 14 / 15 (thinking + tool surfaces, mid-stream behaviors, `control_request_forward` UI) are audited and gap-closed in [Step 20.5.B](#step-20-5-b).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (currently authored directly on main) |
| Last updated | 2026-05-16 |
| Extracted from | [`tide-assistant-rendering.md`](./tide-assistant-rendering.md) Step 20.x |

---

### Phase Overview {#phase-overview}

#### Context {#context}

A tide card hosts a Claude Code conversation as a stream of *turns* — each turn is a user prompt and the assistant's response (which may include thinking, tool calls, tool results, permission/question dialogs, and a final answer). The rendering layer ([`tide-assistant-rendering.md`](./tide-assistant-rendering.md)) handles *what's inside* a turn (markdown, diffs, terminals, file viewers); this plan handles *the turn itself* — its lifecycle, its measurements, its UI containers.

Two problems motivate this plan:

1. **Telemetry is missing.** Today the tide card drops cost / token / time data on the floor. There's no per-turn duration display, no cumulative session totals, no awareness of the context window getting full, no honest accounting of "how long did Claude actually work?" vs. "how long was I waiting on a dialog?" The user has no read on the session shape.
2. **Lifecycle coordination is ad-hoc.** The submit button knows about Submit / Stop but not about "Awaiting your input" (during a permission dialog), "Stopping…" (during interrupt), "Reconnecting…" (during transport-down). The status displays that show live counts don't freeze when a turn pauses on a dialog. The relationship between "what's the lifecycle state right now" and "what should the UI show in each zone" is undocumented and re-derived everywhere it's used.

Both problems collapse to a missing **state-coordinated turn surface**. This plan builds that surface, in five sub-steps gated by primitives → data → spike → zones → spec → implementation.

#### Strategy {#strategy}

- **Primitives first.** Build gauge primitives (TugLinearGauge, TugArcGauge) with their full gallery cards before any consumer wires them. Sequence: linear gauge first → shared color slots settle → arc gauge layered on top without re-tuning shared tokens.
- **Data model before UI.** Land multi-clock telemetry (wallClock / awaitingApproval / transportDowntime / active + diagnostics) and per-turn cost-delta accounting as typed `TurnEntry` fields with a pure-logic helper module — **before** any chrome consumes them. The chrome reads typed snapshots; it does not scrape `lastCost.usage`.
- **Honest measurement.** `awaitingApprovalMs` excludes user-interaction time (TugInlineDialog open intervals — both permission AND question dialogs). `transportDowntimeMs` excludes WebSocket disconnect intervals. `activeMs` is what's left — machine-doing-work time. Silent in-connection API stalls intentionally fall inside `activeMs` (we measure what we can authoritatively measure; stream-idle heuristic deferred until we have `maxStreamGapMs` distributions to inform it).
- **Zone architecture as contract.** Six zones (Z0 top-of-card → Z5 submit-button) numbered spatially top-to-bottom. The renderer registry targets zones by ID. Placement decisions are deferred to a focused HMR study; the slot mechanism makes A/B trivial.
- **Lifecycle spec, then implementation.** State machine + state-to-zone coordination matrix land as a documented artifact ([Step 20.5.A](#step-20-5-a)) before any wiring. Implementation ([Step 20.5.D](#step-20-5-d)) encodes the matrix as one switch in `deriveLifecycleSnapshot`; zones consume via `useLifecycleState()`.
- **Audit before re-implementing.** Polish-plan Steps 13 / 14 / 15 are ~70% done. Audit current state in [Step 20.5.B](#step-20-5-b); close known gaps (e.g., `tide-question-dialog`). Build 20.5.D on working primitives, not on rebuilt ones.

#### Success Criteria (Measurable) {#success-criteria}

- `TurnEntry` carries the full telemetry shape: time-accounting (`wallClockMs`, `awaitingApprovalMs`, `transportDowntimeMs`, `activeMs`), diagnostics (`ttftMs`, `ttftcMs`, `reconnectCount`, `maxStreamGapMs`, `turnEndReason`), cost (`cost: TurnCost`), plus per-tool wall (`ToolCall.toolWallMs`). Per-turn deltas accumulate correctly; session totals sum correctly.
- Pure-logic tests cover the helper module (`perTurnContextSize`, `extractTurnCost`, `deriveSessionTotals`, `liveTurn*` family).
- Reducer-level tests cover awaiting-approval accumulation, transport-downtime accumulation, per-turn cost delta math, terminal-state branches.
- All six zones (Z0–Z5) formalized in the API contract. Z0 + Z1-user-half ship empty/reserved (slot mechanism present; default content `null`). Z3 (prompt-entry top) retains project-path badge as its default; renderer registry can replace it.
- Z5 submit button coordinates with the lifecycle state machine: Submit / Stop / "Awaiting your input" / "Stopping…" / "Reconnecting…" / queued-visual. Same DOM node across mode transitions, verified via mount-identity probe.
- `useLifecycleState()` hook returns a snapshot that drives Z1 (per-turn indicator), Z2 (status bar), and Z5 (button mode) consistently — every distinct row of the state-to-zone matrix has an end-to-end test. Reference-stable per [DT09]; merges UI-local state per [DT08].
- `useLifecycleTick(intervalMs)` provides the 1-second ticker that drives Z2's live-elapsed readouts during in-flight turns; idle when phase is terminal (no leaked timers).
- `/context`-style drill-down surface available via 📊 affordance at right edge of Z2; renders the full telemetry breakdown (per-turn table, per-tool expansion, reconnect / stream-gap diagnostics, raw `cost_update` payload). Opens without changing persistent text-entry focus destination.
- `tide-question-dialog` exists (fills polish-plan §Step 15 gap); both permission and question dialogs wire to `awaitingApprovalSince`.
- `tailSpacer="80cqh"` either removed (if [L26] mount-identity work obviates it) or correctly documented with the real reason (if it serves streaming jitter / visual comfort).
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint` all green at every step.
- All work respects [L02] (useSyncExternalStore for external state), [L06] (appearance via DOM/CSS), [L17] (one-hop alias), [L19] (component authoring), [L20] (token sovereignty), [L23] (preserve user-visible state), [L24] (state zones), [L26] (mount identity stable across transitions).

#### Scope {#scope}

1. **Gauge primitives** — `TugLinearGauge`, `TugArcGauge` (tugways primitives, sibling to `TugInlineDialog` / `TugBadge`). Shared `--tugx-gauge-*` color slot family; per-gauge geometry slots. Full gallery cards.
2. **Per-turn telemetry data model** — `TurnEntry` extensions, `TurnCost`, `TurnEndReason` types; reducer state for awaiting-approval / transport-downtime / stream-gap / latency markers; cost-delta math; terminal-state branches.
3. **Transport-status signal** — if not surfaced today, add a minimal `transport_status: "connected" | "disconnected"` signal to the store. (Investigation B in [Step 20.3](#step-20-3).)
4. **Pure-logic helper module** — new `lib/code-session-store/telemetry.ts` with `perTurnContextSize`, `extractTurnCost`, `deriveSessionTotals`, and the `liveTurn*` family (live-running clocks for in-flight readouts).
5. **`tailSpacer="80cqh"` investigation** — retire-or-document the transcript scroll hack ([Step 20.3.5](#step-20-3-5)).
5a. **`TugDevPanel` dev inspector surface** — persistent, native-triggered, framework-shaped (Opt-Cmd-/ from Tug.app's Developer menu); first tab is the [Step 20.3](#step-20-3) telemetry inspector and gates the 20.3 HMR vet ([Step 20.3.1](#step-20-3-1)). Second tab is the in-app logging surface ([Step 20.3.2](#step-20-3-2)).
6. **Six-zone placement architecture** — slot props on `TideCard` (Z0 header, Z2 status bar), `TideCardTranscript` (Z1 unified trailing slot keyed by half), `TugPromptEntry` (Z3 retains existing `statusContent`, Z4 new footer). Z5 (submit button) acknowledged in the contract; structurally present already.
7. **Lifecycle state machine + state-to-zone coordination matrix** — landed as a documented spec in [Step 20.5.A](#step-20-5-a); implemented as `useLifecycleState()` hook in [Step 20.5.D](#step-20-5-d).
8. **Z5 submit-button state coordination** — single DOM-node button with `data-mode` attribute driven by the lifecycle snapshot.
9. **Cross-zone lifecycle coordination** — Z1, Z2, Z5 all read the same `useLifecycleState()` snapshot; matrix-coherence enforced by construction.
10. **Polish-plan 13 / 14 / 15 audit and gap-close** — including `tide-question-dialog` (the confirmed missing inline-dialog variant).
11. **Ship default telemetry placements** from the [Step 20.4](#step-20-4) HMR study as production zone content ([Step 20.5.D](#step-20-5-d)).
12. **`/context`-style drill-down sheet** — full telemetry breakdown surface triggered by Z2 📊 affordance ([Step 20.5.E](#step-20-5-e)).

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Stream-idle heuristic** for soft API stalls (silent gaps with no transport disconnect). Deferred until `maxStreamGapMs` distributions show whether `activeMs` looks too high. May revisit in a future step.
- **Z0 default content + Z1 user-half default content.** Reserved/empty slots in 20.4 and 20.5. The slot mechanism exists; default content is `null`. Future content (card-level metadata for Z0; timestamps / edit affordances for Z1 user-half) lands in subsequent steps.
- **Allow-with-edits on permission dialog.** Inherited non-goal from polish-plan §Step 15; requires a structured editor over `tool_use.input` — defer to a follow-on phase.
- **Re-run buttons on tool blocks.** Security-policy-laden; the permission-mode story for re-run isn't settled. (Same as rendering doc's non-goal.)
- **Persisting drill-down sort / expansion state** across reloads. The drill-down is a transient inspection surface; persistent UI state is not the right shape for it.
- **Multi-card telemetry aggregation.** Each tide card has its own session and its own telemetry. Cross-card aggregation (e.g., "total tokens used across all my tide cards today") is out of scope.

#### Dependencies / Prerequisites {#dependencies}

From [`tide-assistant-rendering.md`](./tide-assistant-rendering.md):
- `CodeSessionStore` with reducer handlers (`handleSend`, `handleInterrupt`, `handleTurnComplete`, `handleControlRequestForward`, `handleRespondApproval`, `handleRespondQuestion`).
- `cost_update` event handling — `lastCost` snapshot already maintained.
- `TugInlineDialog` primitive.
- `TugListView` + `TideTranscriptDataSource` + `TideCardTranscript`.
- `TugMarkdownView` + body-kind renderers (consumed by transcript row content).

From [`tugplan-tide-card-polish.md`](./tugplan-tide-card-polish.md):
- `TideCard` shell + `TugSplitPane` 2-pane vertical layout (transcript ↔ prompt-entry).
- `TugPromptEntry` with existing `statusContent` slot, route-button row, submit button.
- `chrome/tide-permission-dialog.tsx` (Step 15 partial — permission variant exists; question variant is the known gap closed in [Step 20.5.B](#step-20-5-b)).
- `chrome/tide-thinking-block.tsx` (Step 13 partial).
- Stop button + interrupt frame handling (Step 14 partial).

From `tuglaws/`:
- `tuglaws.md` — L02, L06, L17, L19, L20, L23, L24, L26.
- `component-authoring.md` — primitive-authoring contract.
- `token-naming.md` — seven-slot convention.

From tugbank:
- `/api/defaults/<domain>/<key>` model — for any persisted UI state (currently none; non-goal).

From the stream-json corpus:
- Fixture replay against `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/` for reducer-level telemetry tests.

#### Constraints {#constraints}

- Same baseline constraints as [`tide-assistant-rendering.md`](./tide-assistant-rendering.md): bun (not npm), HMR-only (no manual builds), no localStorage / sessionStorage / IndexedDB, app-test harness for real-DOM testing (no fake-DOM), [L19] / [L20] token compliance with `bun run audit:tokens lint` clean, both `brio` and `harmony` themes verified.
- **[L26] mount identity is critical for Z5.** The submit button must NOT swap DOM nodes between mode transitions. Render one `<button>` whose `data-mode` / label / disabled / aria-label change; CSS handles per-mode visual.
- **Awaiting-user covers permission AND question dialogs** uniformly. `awaitingApprovalMs` semantic broadened from the original name (kept for source-compat) to include both.
- **Drill-down must not capture persistent text-entry focus** per [`feedback_persistent_text_entry`]. Opening the drill-down doesn't change the persistent focus destination; closing returns focus to wherever it was.
- **Reducer touches `Date.now()` only at discrete transition points** (enter/exit dialog, connect/disconnect, first delta, etc.). Live-running clocks live in pure-logic helpers, not in reducer state.

#### Assumptions {#assumptions}

- `cost_update.usage` semantics (cumulative vs. per-turn) determined empirically in [Step 20.3](#step-20-3) (Investigation A). The `extractTurnCost` helper TOLERATES either shape via cost-delta math; the empirical pass documents the actual semantic.
- Transport-status signal (connect / disconnect) either already surfaced or addable in [Step 20.3](#step-20-3) (Investigation B). Either outcome keeps the work scoped.
- `awaitingApprovalSince` reducer transitions fire on every dialog enter/exit reliably (both permission and question variants flow through `handleControlRequestForward` for entry and `handleRespondApproval` / `handleRespondQuestion` for exit).
- Mount-identity invariants from [L26] hold for the wrapper insertions in [Step 20.4](#step-20-4) (`TideCardTranscript` survives the top-split-panel flex-column wrap) and the button mode transitions in [Step 20.5.D](#step-20-5-d) (`<button>` DOM node stable across `data-mode` changes).
- HMR study in [Step 20.4](#step-20-4) produces a single chosen default mapping (no tie); if it does tie, [Step 20.5.D](#step-20-5-d) picks one and notes the alternative.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [QT01] Drill-down sheet orientation — right-sliding vs. bottom-sliding? (OPEN) {#qt01-drilldown-orientation}

**Question:** The `/context`-style drill-down ([Step 20.5.E](#step-20-5-e)) is a sheet that slides over the transcript while leaving Z2 + Z5 visible at the edges. Should it slide from the right (sidebar style) or from the bottom (drawer style)?

**Decision target:** During [Step 20.5.E](#step-20-5-e) implementation. Decide based on tide-card aspect ratio in typical use — if cards are tall-and-narrow, bottom-sliding reads better; if wide, right-sliding does.

**Status:** Deferred to implementation.

#### [QT02] `cost_update.usage` shape — cumulative or per-turn? (OPEN) {#qt02-cost-update-semantic}

**Question:** Does Claude's `cost_update.usage` payload deliver cumulative session totals or per-turn deltas?

**Decision target:** [Step 20.3](#step-20-3) Investigation A — empirical pass (capture 2–3 real payloads across a 4-turn session). The `extractTurnCost` helper tolerates either shape; this investigation documents the actual answer.

**Status:** Deferred to [Step 20.3](#step-20-3).

#### [QT03] Transport-status signal — already surfaced or new? (RESOLVED) {#qt03-transport-status-signal}

**Question:** Does the tugcast WebSocket transport already surface connect/disconnect events to `CodeSessionStore`? If not, what's the minimum surface to add?

**Resolution:** **(a) Already surfaced.** `CodeSessionSnapshot.transportState: TransportState` is on the snapshot today (`types.ts:201`), set by `handleTransportClose` / `handleTransportOpen` / `handleTransportSettled` in `reducer.ts`. **Three values, not two:**

- `"online"` — wire up; submit allowed.
- `"offline"` — wire down; user cannot submit.
- `"restoring"` — wire back up but per-card binding not yet re-ack'd by supervisor.

**Implications for [Step 20.3](#step-20-3):**
- `transportDowntimeMs` must accumulate during BOTH `offline` AND `restoring` (the wire is back but the session isn't usable yet). A "downtime interval" begins when `transportState` first leaves `"online"` and ends when it returns to `"online"`.
- No new wire/protocol/handler additions needed — the 20.3 transport-timer just consumes existing `transportState` transitions via the reducer's existing `transport_*` handlers.

**Status:** Resolved — Investigation B in 20.3 is a confirmation pass, not an open question.

#### [QT04] `tailSpacer="80cqh"` — retire or document? (OPEN) {#qt04-tailspacer-fate}

**Question:** Does the 80% tailSpacer at the bottom of `TugListView` still earn its keep under [L26] + the stable-id work?

**Decision target:** [Step 20.3.5](#step-20-3-5) — two-pronged investigation (code archaeology + empirical removal). Three plausible original causes (mount churn / streaming jitter / visual comfort) map to three different outcomes.

**Status:** Deferred to [Step 20.3.5](#step-20-3-5).

---

### Design Decisions {#design-decisions}

Local decisions specific to this plan. Broader rendering-layer decisions (e.g., [D03] system_metadata renders per-turn only when something changed, [D13] inline-not-modal dialogs) live in [`tide-assistant-rendering.md`](./tide-assistant-rendering.md) and apply transitively.

#### [DT01] Per-turn telemetry lives on `TurnEntry`, not in a side-table (DECIDED) {#dt01-per-turn-on-turnentry}

**Decision:** Extend `TurnEntry` directly with the time-accounting + diagnostic fields + cost. Do NOT maintain a parallel telemetry map keyed by turn.

**Reasoning:** The telemetry IS per-turn. The reducer already commits per-turn entries; one source of truth means consumers don't have to join two collections. Pure-logic helpers (`perTurnContextSize`, `deriveSessionTotals`) take `TurnEntry` directly — no plumbing for a parallel collection.

**Tradeoff:** `TurnEntry` grows by ~10 fields. Worth it for the simplicity.

#### [DT02] Zone numbering is spatial top-to-bottom (Z0–Z5) (DECIDED) {#dt02-zone-numbering}

**Decision:** Six zones numbered Z0 (top of card) through Z5 (submit button) by spatial position. Z1 (per-turn trailing keyed by half) is conceptually different from card-level zones but spatially "inside" the transcript pane, so it sits between Z0 (top of card) and Z2 (bottom of transcript pane).

**Reasoning:** Numbering is predictable — readers can find any zone by spatial intuition. Z0 is unambiguously "what you see first." Adding a future zone is easy: insert at correct number, renumber downstream.

**Alternatives considered:** Z0 = project-path (literal honoring of an earlier suggestion); group-by-container (prompt-entry zones together, transcript zones together). Spatial won because it scales to future zones cleanly.

#### [DT03] `useLifecycleState` encodes the state-to-zone matrix in one place (DECIDED) {#dt03-lifecycle-hook-central}

**Decision:** A new `lib/code-session-store/lifecycle-state.ts` module exports `deriveLifecycleSnapshot(storeSnapshot): TideLifecycleSnapshot` — one switch encodes every row of the matrix. The `useLifecycleState()` hook is a thin `useSyncExternalStore` wrapper. No zone reads `phase` or `awaitingApprovalSince` directly.

**Reasoning:** Matrix coherence is enforced by construction. The matrix is the spec ([Step 20.5.A](#step-20-5-a)); the hook is the executable form of the spec; testing the hook validates the spec. Encoding the matrix in N places (one per zone) would let zones drift.

**Tradeoff:** Adds a layer of indirection between the raw store snapshot and the UI. Pays for itself the first time we change the matrix.

#### [DT04] Drill-down is a sheet, not a modal (DECIDED) {#dt04-drilldown-sheet}

**Decision:** The `/context`-style drill-down ([Step 20.5.E](#step-20-5-e)) is a sheet that slides over the transcript while leaving Z2 (source of the affordance) and Z5 (primary action) visible at the edges. NOT a modal that hides the source of truth.

**Reasoning:** The drill-down's purpose is inspection — the user wants to see the detail behind the summary in Z2. A modal that hides Z2 breaks that mental model. A sheet preserves the spatial reference and keeps Z5 reachable if the user wants to take action.

**Open detail:** Right-sliding vs. bottom-sliding deferred to [QT01](#qt01-drilldown-orientation).

#### [DT05] `awaitingApprovalMs` name kept despite broadened semantic (DECIDED) {#dt05-awaiting-approval-naming}

**Decision:** The reducer state and `TurnEntry` field are named `awaitingApprovalSince` / `awaitingApprovalMs` even though they cover BOTH permission and question dialogs (any `TugInlineDialog` open interval the user must respond to). The broader `awaitingUserMs` was considered and rejected.

**Reasoning:** The original 20.3 design used `awaitingApprovalMs`; renaming creates source-compat friction with no semantic benefit. The semantic broadening is documented in field comments + the [DT-naming-glossary](#dt06-naming-glossary).

#### [DT06] Naming glossary (DECIDED) {#dt06-naming-glossary}

For clarity across the document, key terms with potentially-ambiguous names:

| Term | Meaning |
|---|---|
| `awaitingApprovalMs` | Cumulative ms paused on **any** `TugInlineDialog` — permission OR question. (Not narrowly "permission only.") |
| `activeMs` | Machine-doing-work ms. `wallClockMs − awaitingApprovalMs − transportDowntimeMs`, clamped ≥ 0. Silent in-connection API stalls quietly inflate this; we accept that for honest authoritative measurement. |
| `windowTokensUsed` | Context-window utilization at the LATEST committed turn. `inputTokens + cacheCreationInputTokens + cacheReadInputTokens` (the model's view of context "right now"). |
| `cumulativeSessionTokens` | Tokens consumed across the WHOLE session. SUM across all turns of `input + cache_creation + cache_read + output`. |
| Z1 (per-turn trailing) | A single API keyed by `half: "user" \| "assistant"` — same slot wired twice per turn. The user half is reserved/empty in 20.4 + 20.5. |
| Z5 (submit button) | Not a content slot — a state-coordinated interactive zone driven by the lifecycle state machine. |

#### [DT07] Esc semantics — foreground-element-first, two-step cancellation (DECIDED) {#dt07-esc-semantics}

**Decision:** The Esc key dismisses the topmost overlay or dialog if any is foregrounded (drill-down sheet, `TugInlineDialog`); otherwise it interrupts the in-flight turn (equivalent to clicking Stop).

**Concrete behavior by lifecycle state:**

| State | Esc behavior |
|---|---|
| IDLE / COMPLETE | nothing (or blur textarea — UX-comfort detail, not load-bearing) |
| SUBMITTING / STREAMING / TOOL_WORK | trigger interrupt → INTERRUPTING |
| AWAITING_USER | dismiss the dialog only — equivalent to a normal deny / cancel response, NOT a turn cancellation. Lifecycle resumes through STREAMING / TOOL_WORK. |
| DRILLDOWN_OPEN (overlay) | close the drill-down sheet (lifecycle continues underneath) |
| INTERRUPTING | nothing (already interrupting) |

**Consequence — two-step cancellation from AWAITING_USER.** A user who wants to abort the entire turn while a dialog is up must press Esc twice: first Esc dismisses the dialog (auto-denies / cancels the dialog action; the turn resumes), then a second Esc (now no dialog foregrounded) interrupts the turn.

**Reasoning:**
- Matches the universal UI convention that Esc dismisses the topmost foreground element.
- Keeps the user's intent explicit at each gesture — "I want to deny this dialog" and "I want to cancel this whole turn" are different requests, and conflating them in one keystroke risks accidental cancellations.
- The Z5 Stop button is disabled during AWAITING_USER (per the matrix), so the two-step rule is consistent across both gestures (Esc and Stop both require dialog-first dismissal from AWAITING_USER).
- INTERRUPTING is therefore NOT reachable from AWAITING_USER directly — the state graph in [Step 20.5.A](#step-20-5-a)'s diagram reflects this.

**Alternatives considered:** Single-step cancellation that combines dialog-dismiss + interrupt in one Esc from AWAITING_USER. Rejected because it merges two distinct intents and the "deny + cancel" combo is rare in practice.

#### [DT08] `deriveLifecycleSnapshot` accepts UI-local state as a second argument (DECIDED) {#dt08-lifecycle-snapshot-merges-ui-state}

**Decision:** `deriveLifecycleSnapshot(storeSnapshot, uiState): TideLifecycleSnapshot` takes a second argument carrying UI-local flags that the reducer doesn't and shouldn't track. Initially only `{ drilldownOpen: boolean }`; structured as an object so future UI overlays can extend it without churn.

**Reasoning:**
- The function stays pure (output is a deterministic function of inputs); testability preserved.
- The reducer doesn't pollute its state with UI-presentation concerns (drill-down open/close is presentation, not session state).
- The `useLifecycleState` hook composes the two: subscribes to the store via `useSyncExternalStore`, reads the UI-local flag via `useState` or a UI-only zustand store, and calls `deriveLifecycleSnapshot(storeSnapshot, uiState)` to project both into the same matrix-row signal.
- Future overlays (e.g., a help sheet, a settings popover) add fields to `uiState` without reshaping the reducer or the matrix.

**Alternative considered:** Two derive functions (`deriveSessionLifecycle(store)` + `deriveOverlayLifecycle(uiState)`) with the consumer merging. Rejected because it splits the "one switch encodes the matrix" promise — the matrix has overlay rows, so all signals belong in one derivation.

#### [DT09] `useLifecycleState` returns a stable snapshot reference when matrix-relevant signals are unchanged (DECIDED) {#dt09-snapshot-reference-stability}

**Decision:** `deriveLifecycleSnapshot` returns a structurally-memoized result — if the matrix-relevant signals (`phase`, `pendingApproval !== null`, `transportState`, `interruptInFlight`, `queuedSends > 0`, `uiState.drilldownOpen`) are unchanged from the previous call, return the previous result's same reference. Implementation: a small wrapper that compares the derived `{ state, overlays, submitButtonMode }` tuple to the previous return and returns the prior object when shallow-equal.

**Reasoning:**
- `useSyncExternalStore` triggers a re-render whenever the snapshot reference changes. Without reference stability, every `assistant_delta` (which mutates the store snapshot but does not change any matrix-relevant signal) re-renders every consumer of `useLifecycleState` — Z1 (per turn), Z2, Z5. At 50+ deltas/sec during streaming, that's 50+ renders/sec across 5+ subscribers.
- Reference stability bounds re-renders to the events that actually change lifecycle state. Stream deltas do not (they only change content); they only re-render the renderers that subscribe to content (the per-turn assistant body).
- The reducer's snapshot itself is reference-stable per field per [D10] — this hook extends that discipline upward into the derived lifecycle layer.

**Test:** `deriveLifecycleSnapshot(snapshotA, uiState) === deriveLifecycleSnapshot(snapshotB, uiState)` (`Object.is`) when the matrix-relevant signals of A and B are equal, even when other snapshot fields differ.

---

### Execution Steps {#execution-steps}

#### Step 20.1: `TugLinearGauge` primitive + gallery card {#step-20-1}

**Depends on:** _none_ (general-purpose tugways primitive; no dependency on tide rendering)

**Status:** _Implementation complete; awaiting manual HMR vet. Primitive + pure-logic tests (20 cases) + 3-section gallery card (interactive sandbox / 3×3 scale-threshold matrix / use-case preview) landed. All composed `--tug7-*` tokens already existed in both themes — no theme file edits required. tsc clean, full test suite 1889/0, audit:tokens lint clean. Registered in `card-registry.ts` under the "Feedback & Status" category._

**Commit:** `feat(tugways): TugLinearGauge — linear quantity gauge primitive + gallery card`

**References:** [L17], [L19], [L20], [L24], [Table T07](./tide-assistant-rendering.md#t07-token-slots), `roadmap/archive/retronow/mockups/retronow-unified-review.html` § "Linear Gauge (0-100% Mapping)" (design source)

**Scope.** General-purpose horizontal-fill gauge primitive — a labeled bar that maps `value` from `[min, max]` into a proportional fill, with optional threshold-based color zones. Built first because [#step-20-3] (the card-level status strip) consumes it for the window-utilization display. The retronow mockup had ~15 tunable knobs for design exploration; the shipped primitive collapses those into ~7 props for ergonomic consumer use, with the warning-zone semantics preserved (the load-bearing feature that the mockup proved out).

**Conformance.** Tugways primitive (peer of `TugInlineDialog`, `TugBadge`, etc.) — not a body kind, not a tool wrapper. The [#bk-conformance](./tide-assistant-rendering.md#bk-conformance) contract does not apply directly; the relevant law set is `tuglaws/component-authoring.md` plus [L17] / [L19] / [L20] / [L24]. The primitive owns a new `--tugx-gauge-*` slot family declared in `tug-linear-gauge.css` body{}, composing `--tug7-*` base tokens in one hop.

**Design — public surface.** Sketch (precise prop names finalized in implementation):

```typescript
export interface TugLinearGaugeProps {
  /** Current value, in domain units. */
  value: number;
  /** Domain minimum. */
  min: number;
  /** Domain maximum. Must satisfy `max > min`. */
  max: number;
  /**
   * Optional warning-zone fractions (0–1, relative to the [min, max]
   * domain). When `value` exceeds a threshold, the fill color shifts
   * to the corresponding role token. `caution` lights up the caution
   * accent; `danger` lights up the danger accent (a strict superset
   * of caution — exceeding `danger` implies caution too, but only
   * the danger color renders). When omitted, the fill stays on its
   * default role for the entire domain.
   */
  thresholds?: { caution?: number; danger?: number };
  /**
   * Optional human-readable label rendered alongside the bar. Layout
   * depends on `density` — compact puts it inline beside the value;
   * detailed puts it below, with hi/lo labels framing the bar ends.
   */
  label?: string;
  /**
   * Optional formatter for the displayed numeric value. Defaults to
   * `String(value)`. Consumers passing a fraction like
   * `32_500 / 200_000` would write `formatValue={(v) => formatTokens(v)}`
   * to render `"32.5k"`.
   */
  formatValue?: (value: number) => string;
  /**
   * `compact` (default) renders a slim bar with just the fill, the
   * value numeral, and an optional label inline — designed for chrome
   * surfaces like [#step-20-3]'s status strip (~20–24px tall).
   * `detailed` renders the full mockup-style face with major/minor
   * ticks, hi/lo labels, and percentage readout — for dashboard /
   * gallery use.
   */
  density?: "compact" | "detailed";
  /**
   * Accent role for the fill when no threshold is exceeded. Maps to
   * `--tugx-gauge-fill-{role}-color`. Defaults to `default`.
   */
  fillRole?: "default" | "info" | "success";
}
```

**Token sovereignty per [L20].** TugLinearGauge owns `--tugx-gauge-*` slots: `track-color`, `track-border-color`, `fill-default-color`, `fill-info-color`, `fill-success-color`, `fill-caution-color`, `fill-danger-color`, `value-text-color`, `label-text-color`, `tick-major-color`, `tick-minor-color`, plus the geometry slots (`bar-height-compact`, `bar-height-detailed`, `value-text-size-compact`, `value-text-size-detailed`, etc.). The consuming card ([#step-20-3]) does not override these — it owns its own `--tugx-tide-meter-*` slots that point at the gauge's surface tokens via [L20]'s "alias my own family, don't override the child's" rule.

**Gallery card.** A new gallery card `gallery-tug-linear-gauge` shows the primitive at three scales side-by-side:

| Scale | Height | Density | Purpose |
|---|---|---|---|
| **Strip-scale** | ~24px tall | `compact` | Exact size the [#step-20-3] integration uses; gates that the compact density reads well at chrome scale |
| **Readable** | ~60px tall | `compact` | Mid-size dashboard placement; bar + value + label clearly legible |
| **Showcase** | ~140px tall | `detailed` | Full mockup-style face with ticks + percentage + hi/lo labels; gates that the primitive scales up without losing fidelity |

Each scale is rendered for three threshold configurations: (a) no thresholds, (b) `caution: 0.75`, `danger: 0.9` with `value` below caution, (c) same thresholds with `value` above danger. Card includes a `value` slider and `min/max` numeric inputs so design review can interactively tune the values.

**Artifacts.**

- `tugdeck/src/components/tugways/tug-linear-gauge.tsx` + `.css` — _new component_.
- `tugdeck/src/components/tugways/__tests__/tug-linear-gauge.test.ts` — pure-logic tests: domain-mapping math (value → fill width), threshold selection (which role is active given thresholds + value), `formatValue` round-trip, edge cases (value < min clamps; value > max clamps; max ≤ min throws). No DOM rendering required (the geometry math is pure).
- `tugdeck/src/components/tugways/cards/gallery-tug-linear-gauge.tsx` + `.css` — _new card_.
- Registration in `card-registry.ts` and the gallery component list.
- New row in [Table T07](./tide-assistant-rendering.md#t07-token-slots): `| --tugx-gauge-* | TugLinearGauge / TugArcGauge |` (shared slot family — both gauges read the same color slots; geometry slots may diverge).

**Tasks.**

- [x] Build `TugLinearGauge` per the prop surface above. Stateless presentation; consumer owns `value`. Exports three pure helpers (`clampToDomain`, `computeFillRatio`, `effectiveFillRole`) so the geometry + role math is unit-testable without DOM.
- [x] Pure-logic Bun tests for the geometry + threshold math — 20 cases covering domain clamp (positive/negative, infinities), midpoint mapping, token-window-shape domain, `max ≤ min` throws, all six threshold-derivation cases (no thresholds / below / at caution / at danger / danger-as-strict-superset / edge fractions 0 and 1).
- [x] Declare the `--tugx-gauge-*` slot family in `tug-linear-gauge.css` body{}; all 17 slots bind to `--tug7-*` base tokens in one hop. Verified by `audit-tokens lint`.
- [x] Theme tokens — no edits needed. All composed `--tug7-*` tokens already exist in both `brio.css` and `harmony.css` (the gauge composes from the shared `filled-{role}-rest` / `field-primary-normal-plain-rest` / `global-text-normal-{default,muted}-rest` / `global-icon-normal-{default,muted}-rest` token families).
- [x] Gallery card with the interactive sandbox, three-scale × three-threshold matrix (9 cells), and use-case preview rendering the `32.5k / 200k WINDOW` example from [#step-20-3]'s layout sketch.
- [x] Register `gallery-tug-linear-gauge` in `card-registry.ts` under the "Feedback & Status" category.
- [x] `audit-tokens lint` clean — zero violations, all `@tug-renders-on` annotations validated.

**Tests.**

- [x] Pure-logic: `value=50, min=0, max=100` → fill ratio = 0.5. `value=-10` clamps to 0; `value=150` clamps to 1.
- [x] Pure-logic: with `thresholds={caution: 0.75, danger: 0.9}`: `value=70%` → `default` role; `value=80%` → `caution`; `value=95%` → `danger`.
- [x] Pure-logic: missing `thresholds` → always `fillRole` (default `default`).
- [x] Pure-logic: `max ≤ min` throws (configuration error, not a silent NaN).
- [x] Gallery card mounts; renders all 9 matrix cells (3 scales × 3 threshold configs) plus the interactive sandbox and use-case preview.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean from `tugdeck/`. Exit 0.
- [x] `bun test` green — 1889 pass, 0 fail, 8283 expect() calls across 106 files (20 new gauge tests).
- [x] `bun run audit:tokens lint` exits 0. Zero violations.
- [ ] **HMR vet (manual user action)** — open `gallery-tug-linear-gauge`, move the slider through the domain, verify color transitions at the threshold boundaries match expectation in both themes (Brio / Harmony).

---

#### Step 20.2: `TugArcGauge` primitive + gallery card {#step-20-2}

**Depends on:** #step-20-1 (the `--tugx-gauge-*` color slot family lands with TugLinearGauge; TugArcGauge reads the same color tokens to keep the visual language consistent across both primitives)

**Status:** _Implementation complete; awaiting manual HMR vet. Primitive + pure-logic tests (15 cases covering arc-path geometry, large-arc-flag boundary, full-circle two-semicircle branch, default `C` geometry, negative-sweep validation) + 3-section gallery card (interactive sandbox with start/sweep controls / 3×3 scale-threshold matrix / 5 geometry variants row). Shared math extracted to `gauge-math.ts`; both gauges import from there. tsc clean, full test suite 1904/0, audit:tokens lint clean. Registered under "Feedback & Status"._

**Commit:** `feat(tugways): TugArcGauge — arc quantity gauge primitive + gallery card`

**References:** [L17], [L19], [L20], [L24], [#step-20-1] (color-token sibling), [Table T07](./tide-assistant-rendering.md#t07-token-slots), `roadmap/archive/retronow/mockups/retronow-unified-review.html` § "Arc Gauge (Unified)" (design source)

**Scope.** General-purpose arc (partial-circle) gauge primitive — the radial counterpart to [#step-20-1]'s linear bar. Same domain mapping, same threshold semantics, same color tokens (`--tugx-gauge-fill-{role}-color` is shared). Sequenced after the linear gauge so the color-slot family is settled before the arc geometry is built on top; this avoids re-tuning shared tokens after the second consumer lands. Gates that the primitive scales the same way the linear gauge does — strip-scale for chrome, readable for dashboard, showcase for full-detail.

**Conformance.** Same as [#step-20-1] — tugways primitive, `tuglaws/component-authoring.md` + [L17] / [L19] / [L20] / [L24]. Shares the `--tugx-gauge-*` slot family with TugLinearGauge; adds arc-specific geometry slots (`arc-stroke-width-compact`, `arc-stroke-width-detailed`, `arc-radius-compact`, `arc-radius-detailed`, `arc-start-angle`, `arc-sweep-angle`).

**Design — public surface.** Identical prop shape to TugLinearGauge with one addition: the arc's start/sweep angles default to a "C" sweep (`start = 135°`, `sweep = 270°` — leaving the bottom 90° open) but can be overridden via `geometry?: { startAngleDeg: number; sweepAngleDeg: number }` for consumers that want a different arc shape (full circle, half circle, quarter, etc.).

```typescript
export interface TugArcGaugeProps {
  value: number;
  min: number;
  max: number;
  thresholds?: { caution?: number; danger?: number };
  label?: string;
  formatValue?: (value: number) => string;
  density?: "compact" | "detailed";
  fillRole?: "default" | "info" | "success";
  /**
   * Override the default "C" sweep. Useful for full-circle gauges
   * (`sweepAngleDeg: 360`), half-circles (`startAngleDeg: 180,
   * sweepAngleDeg: 180`), or custom dial shapes. Defaults to a 270°
   * sweep starting at 135° (bottom-left quadrant open).
   */
  geometry?: { startAngleDeg: number; sweepAngleDeg: number };
}
```

**Token sovereignty.** Color slots are shared with TugLinearGauge (single source of truth; both gauges read `--tugx-gauge-fill-{role}-color`). Arc-specific geometry slots are owned exclusively by TugArcGauge and namespaced with `arc-` prefix to avoid collision with the linear gauge's geometry slots. Both gauges' geometry slots live in their respective component CSS body{}; neither overrides the other.

**Gallery card.** `gallery-tug-arc-gauge` mirrors [#step-20-1]'s structure — three scales × three threshold configs:

| Scale | Diameter | Density | Purpose |
|---|---|---|---|
| **Strip-scale** | ~32px | `compact` | Exact size for chrome surface use; tests that the arc reads at this size without crowding |
| **Readable** | ~80px | `compact` | Mid-size dashboard placement |
| **Showcase** | ~180px | `detailed` | Full mockup-style face with ticks + value + label all visible |

Plus one **geometry variants** row that shows the same gauge at `readable` scale with five different arc shapes (default C-sweep, half-circle, full circle, quarter-arc top-right, quarter-arc top-left) to gate that the geometry override prop produces sensible output at non-default angles.

**Artifacts.**

- `tugdeck/src/components/tugways/tug-arc-gauge.tsx` + `.css` — _new component_.
- `tugdeck/src/components/tugways/__tests__/tug-arc-gauge.test.ts` — pure-logic tests: SVG path generation for the arc (start point, sweep flag, end point given `startAngleDeg` / `sweepAngleDeg` / `value` fraction), threshold selection (same shape as TugLinearGauge), geometry edge cases (sweep = 360° produces a full circle; sweep = 0° produces an empty arc; negative sweep throws).
- `tugdeck/src/components/tugways/cards/gallery-tug-arc-gauge.tsx` + `.css` — _new card_.
- Registration in `card-registry.ts`.
- Extend the [Table T07](./tide-assistant-rendering.md#t07-token-slots) row landed in [#step-20-1] to reflect the shared use.

**Tasks.**

- [x] Build `TugArcGauge` per the prop surface above. SVG-based: a 100×100 viewBox with stroked track + fill paths; compact density renders the readout as HTML below the SVG, detailed density renders value + percent as `<text>` centered inside the SVG and the label below.
- [x] Pure-logic Bun tests for arc-path geometry + threshold + geometry-override math — 15 cases covering empty-path branches, full-circle two-semicircle branch, large-arc-flag boundary (180° strict), start / end coordinate placement for default `C` geometry, negative-sweep throws, default `DEFAULT_ARC_GEOMETRY` constant matches the "C" shape.
- [x] Declare arc-specific `--tugx-gauge-arc-*` slots in `tug-arc-gauge.css` body{} (stroke widths × compact/detailed, SVG-text font sizes, tick stroke widths, gaps). Reuses the shared color slots from [#step-20-1] without redeclaring them.
- [x] Theme tokens — no edits needed. The arc gauge composes the same `--tug7-*` tokens through the shared color slot family; geometry slots resolve to literal pixel values (no theme involvement). Shared `gauge-math.ts` extracted so the three pure helpers live in one place; `tug-linear-gauge.tsx` re-exports them for source compat with existing tests.
- [x] Gallery card — interactive sandbox (incl. start/sweep angle controls + fixed-precision formatter for slider-stability) + 3×3 scale-threshold matrix (9 cells) + 5 geometry variants row (default C / full circle / top half / top-left quarter / top-right quarter).
- [x] Register `gallery-tug-arc-gauge` in `card-registry.ts` under "Feedback & Status".
- [x] `audit-tokens lint` clean — zero violations.

**Tests.**

- [x] Pure-logic: arc path for default geometry — start at bottom-left (135° angle position), end at correct angle for `fillRatio * sweep`, large-arc-flag 0 when effective sweep ≤ 180°.
- [x] Pure-logic: same threshold tests as TugLinearGauge — covered transitively by `gauge-math.ts` extraction (single source of truth; linear-gauge tests gate the math for both gauges).
- [x] Pure-logic: `geometry.sweepAngleDeg = 360` → two-semicircle full-circle path; `geometry.sweepAngleDeg = 0` → empty string; negative sweep throws.
- [x] Pure-logic: large-arc-flag flips exactly at the 180° boundary (predicate is strict `> 180`, so effective sweep == 180 stays small-arc).
- [x] Gallery card mounts; renders all 9 matrix cells + 5 geometry cells + interactive sandbox.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean from `tugdeck/`. Exit 0.
- [x] `bun test` green — 1904 pass, 0 fail, 8310 expect() calls across 107 files (15 new arc tests; linear tests unchanged at 20/20 after the math extraction).
- [x] `bun run audit:tokens lint` exits 0. Zero violations.
- [ ] **HMR vet** — open `gallery-tug-arc-gauge`, sweep the slider, verify the arc redraws smoothly with no visual artifacts (no flash, no path-discontinuity at the 180° boundary where `largeArcFlag` flips), and verify the geometry variants render correctly at the five different arc shapes.

---

#### Step 20.3: Per-turn telemetry — token + time data collection {#step-20-3}

**Depends on:** #step-1 (cost_update reducer surface)

**Status:** _COMPLETED 2026-05-16 (implementation + HMR vet via [Step 20.3.1](#step-20-3-1)'s `TugDevPanel`)._

**Commit:** `feat(code-session-store): per-turn telemetry — typed token + multi-clock accounting on TurnEntry`

**References:** [L02], [L23], [D03], [#step-20-1] / [#step-20-2] (gauge primitives that will consume this data downstream), [#step-20-4] (UI placement step that ships on top of this data)

**Scope note — why we are re-imagining 20.3.** The first 20.3 attempt jumped straight to a chrome component that scraped numbers off `lastCost.usage` and added wall-clock timing on top. The result hit two real walls: (1) `lastCost.usage.input_tokens` alone systematically *under*-reports the context window (it omits the `cache_read_input_tokens` + `cache_creation_input_tokens` portions that carry the bulk of a long conversation's context); (2) wall-clock `(endedAt - submitAt)` over-reports the Claude-active duration whenever a turn pauses on a `TugInlineDialog` waiting for the user's allow / deny / question answer. Both problems are *data-model* problems, not chrome problems — patching them inside the chrome would have entrenched the same hacks the next consumer would have to re-discover. This re-imagined step builds the data model cleanly; [#step-20-4] then experiments with placements on top of it.

**Scope.** Capture **per-turn telemetry** as first-class fields on each `TurnEntry`, and define the corresponding session-level derivations. The data set has three groups:

1. **Cost** — typed token + dollars accounting via per-turn delta against `lastCost`.
2. **Time accounting** — a small family of clocks that separate "how long did this take," "how long did the user pause it," "how long was the system down," and "how long was the machine actually working." See the table below.
3. **Diagnostics** — latency markers (`ttftMs`, `ttftcMs`), throughput markers (`reconnectCount`, `maxStreamGapMs`), per-tool wall (`ToolCall.toolWallMs`), and a typed terminal state (`turnEndReason`). Cheap to capture once we're already touching the per-turn timing infrastructure; expensive to retrofit later.

**The time-accounting family.** Four clocks, all stored directly on `TurnEntry` so consumers don't have to re-derive:

| Field | Meaning | Computed as |
|---|---|---|
| `wallClockMs` | Total elapsed | `endedAt - userMessage.submitAt`. Indisputable; covers everything. |
| `awaitingApprovalMs` | User-interaction pause | Sum of TugInlineDialog open intervals — covers *both* permission and question dialogs. (Name kept for source-compat with the original 20.3 design; semantics broadened to include question dialogs.) |
| `transportDowntimeMs` | System / API downtime | Sum of WebSocket disconnect → reconnect intervals overlapping this turn. The cleanest objective signal — the transport authoritatively knows when it lost service. |
| `activeMs` | Machine-doing-work | `wallClockMs − awaitingApprovalMs − transportDowntimeMs`, clamped ≥ 0. The "assistant response time." Stored directly so consumers don't recompute. |

Silent in-connection API stalls (e.g., a 30-second gap with no events while the WebSocket stays open) currently fall inside `activeMs`. We accept this as a known limit of authoritative measurement; if real distributions later show `activeMs` looks too high, [#step-20-5] revisits with a stream-idle heuristic over `maxStreamGapMs` distributions.

**Bonus accounting captured at the same time.** Cheap to wire while we're already in the per-turn timing handlers; expensive to retrofit later once the type shape is in use:

| Field | Meaning |
|---|---|
| `ttftMs: number \| null` | Time from `submitAt` to first `assistant_delta`. `null` if turn ended with no assistant output. |
| `ttftcMs: number \| null` | Time from `submitAt` to first `tool_use`. `null` if no tool calls. |
| `reconnectCount: number` | Number of transport reconnects observed during this turn. Companion to `transportDowntimeMs`. |
| `maxStreamGapMs: number` | Longest single inter-event silence across this turn. Diagnostic; gives us a distribution to inform any future stream-idle heuristic. |
| `turnEndReason: TurnEndReason` | Typed terminal state — `"complete" \| "interrupted" \| "error" \| "transport_lost"`. |
| `ToolCall.toolWallMs: number \| null` | Per-call wall-clock between `tool_use` and matching `tool_result`. `null` if still pending at turn end. |

**Session totals** are derived from `transcript[]` by summing the per-turn fields. The chrome / UI components in [#step-20-4] consume these via a small pure-logic adapter module — no `lastCost` inside the chrome, no wall-clock inside the chrome. The data model is the API; the UI is the consumer.

**The "context window" derivation, specifically.** For the window-utilization gauge in [#step-20-4], the answer is `inputTokens + cacheCreationInputTokens + cacheReadInputTokens` for the *most recent* committed turn (the model's view of context at the latest turn boundary). The session-cumulative "tokens consumed" number is the SUM across all turns of `inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens`. These two numbers are different — window is "right now," cumulative is "ever." The data model exposes both; placement decisions live in [#step-20-4].

**Live-turn semantics.** The frozen `TurnEntry` fields are committed at `turn_complete`. For an in-flight turn, consumers (e.g., a ticking "elapsed" readout) need running values. The `telemetry.ts` module exports pure `(state, now)` derivations: `liveTurnWallClockMs`, `liveTurnAwaitingApprovalMs`, `liveTurnTransportDowntimeMs`, `liveTurnActiveMs`. These fold `Date.now()` against the live reducer state. The reducer itself only touches `Date.now()` at discrete transition points (enter/exit dialog, connect/disconnect, first delta, etc.) — the live-running clocks live in the pure-logic helpers, which keeps the reducer deterministic and trivially testable.

**Conformance.** Pure reducer + types work. No chrome surface. No React component changes in 20.3 (those land in 20.4). The pure-logic helpers `perTurnContextSize`, `deriveSessionTotals`, `extractTurnCost`, and the `liveTurn*` family are exported as the API surface for 20.4 consumers.

**Design — type sketch.**

```typescript
// New types (add to lib/code-session-store/types.ts):

interface TurnCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

type TurnEndReason = "complete" | "interrupted" | "error" | "transport_lost";

interface TurnEntry {
  // ... existing fields ...

  // --- Time accounting ---
  /** Pure wall-clock duration of the turn. */
  wallClockMs: number;
  /** Cumulative ms paused on TugInlineDialog (permission + question). */
  awaitingApprovalMs: number;
  /** Cumulative ms with the transport disconnected during this turn. */
  transportDowntimeMs: number;
  /** Machine-doing-work duration. Stored directly so consumers don't recompute.
   *  = wallClockMs - awaitingApprovalMs - transportDowntimeMs, clamped ≥ 0. */
  activeMs: number;

  // --- Diagnostics ---
  /** Submit-to-first-assistant-delta latency. null if turn produced no assistant output. */
  ttftMs: number | null;
  /** Submit-to-first-tool-use latency. null if turn produced no tool calls. */
  ttftcMs: number | null;
  /** Transport reconnects observed during this turn. */
  reconnectCount: number;
  /** Longest single inter-event silence across the turn. */
  maxStreamGapMs: number;
  /** Typed terminal state. */
  turnEndReason: TurnEndReason;

  // --- Cost ---
  /** Per-turn delta of cumulative cost-update fields. Zeros when no
   *  cost_update arrived for this turn. */
  cost: TurnCost;

  // --- Existing `result` field stays, deprecated in favor of turnEndReason ---
  // result: "success" | "interrupted" stays on TurnEntry; reducer derives it
  // from turnEndReason ("complete" → "success"; else → "interrupted") so the
  // two never diverge. JSDoc marks `result` @deprecated. Migration to
  // turnEndReason happens incrementally per consumer.
}

interface ToolCall {
  // ... existing fields ...
  /** Wall-clock ms between tool_use and matching tool_result.
   *  null if still pending at turn end. */
  toolWallMs: number | null;
}

// Pure derivations (export from a new module, lib/code-session-store/telemetry.ts):

export function perTurnContextSize(turn: TurnEntry): number; // input + cache_read + cache_creation
export function extractTurnCost(
  before: CostSnapshot | null,
  after: CostSnapshot | null,
): TurnCost; // handles cumulative-or-per-turn cost_update.usage shapes
export function deriveSessionTotals(
  transcript: ReadonlyArray<TurnEntry>,
): {
  totalWallClockMs: number;
  totalAwaitingApprovalMs: number;
  totalTransportDowntimeMs: number;
  totalActiveMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  turnCount: number;
};

// Live-turn derivations (pure functions of (state, now)):
export function liveTurnWallClockMs(state: CodeSessionState, now: number): number;
export function liveTurnAwaitingApprovalMs(state: CodeSessionState, now: number): number;
export function liveTurnTransportDowntimeMs(state: CodeSessionState, now: number): number;
export function liveTurnActiveMs(state: CodeSessionState, now: number): number;
```

**Reducer changes.** All isolated to `reducer.ts`:

1. **New reducer state fields** — eleven additions to `CodeSessionState` + `createInitialState`:
   - `awaitingApprovalSince: number | null` — entry-side timestamp; complements the existing `pendingApproval` / `pendingQuestion` snapshot fields (those identify *which* dialog; this records *when* it opened).
   - `awaitingApprovalAccumulatedMs: number`
   - `transportNonOnlineSince: number | null` — timestamp captured when `transportState` first leaves `"online"` (either to `offline` or `restoring`).
   - `transportDowntimeAccumulatedMs: number`
   - `transportReconnectCount: number`
   - `lastStreamEventAt: number | null`
   - `maxStreamGapMs: number`
   - `firstAssistantDeltaAt: number | null`
   - `firstToolUseAt: number | null`
   - `costAtSubmit: CostSnapshot | null`
   - **`interruptInFlight: boolean`** — set `true` by `handleInterrupt`, cleared by `handleTurnComplete` (any reason). Drives the INTERRUPTING lifecycle state in [20.5.A's matrix](#step-20-5-a). No existing single-source signal carries this; the plan adds it.
2. **Awaiting-approval timer** — `handleControlRequestForward` sets `awaitingApprovalSince = Date.now()` (covers both permission and question `control_request_forward` variants). `handleRespondApproval` / `handleRespondQuestion` accumulate `Date.now() - awaitingApprovalSince` into `awaitingApprovalAccumulatedMs` and reset `awaitingApprovalSince = null`. Interrupt + transport-close + replay-bracket paths also reset (defensive).
3. **Transport-downtime timer** — wires to the existing `transportState` axis (per [QT03 resolved](#qt03-transport-status-signal)). When `transportState` first transitions from `"online"` to `"offline"` OR `"restoring"`, set `transportNonOnlineSince = Date.now()`. When `transportState` transitions back to `"online"`, accumulate `Date.now() - transportNonOnlineSince` into `transportDowntimeAccumulatedMs` and increment `transportReconnectCount`. The `restoring` value counts toward downtime — the wire is up but the session is unusable.
4. **Stream-gap + latency markers** — every inbound stream event (assistant_delta, tool_use, tool_result, system events; `awaiting_first_token` → `streaming` transition counts as the first `assistant_delta`) updates `lastStreamEventAt` and folds the gap into `maxStreamGapMs`. The first `assistant_delta` of the turn captures `firstAssistantDeltaAt`; the first `tool_use` captures `firstToolUseAt`. Each `tool_result` pairs with its `tool_use` and writes `toolWallMs` onto the `ToolCall`.
5. **Snapshot + commit** — `handleSend` resets all per-turn timers and snapshots `lastCost` into `costAtSubmit`. `handleTurnComplete` (and the interrupt / error / transport-lost terminal handlers) computes the cost delta, freezes all per-turn fields onto the `TurnEntry`, sets `turnEndReason` based on which handler fired, clears `interruptInFlight`, and resets the per-turn accumulators.

**Relationship to existing `TurnEntry.result` field.** The current shape is `result: "success" | "interrupted"` (`types.ts:132`). The new `turnEndReason: "complete" | "interrupted" | "error" | "transport_lost"` is strictly richer. Migration approach: **add `turnEndReason` alongside `result` in this step; mark `result` as `@deprecated` with a JSDoc comment pointing to `turnEndReason`; existing consumers continue to read `result` until they migrate in subsequent work.** The reducer derives `result` from `turnEndReason` so the two stay in sync (`turnEndReason === "complete"` → `result === "success"`; everything else → `result === "interrupted"`). A follow-up step removes `result` once all consumers are off it. This avoids a wide-radius rename mid-step.

**Ticker for live elapsed displays.** The matrix's "live cum + this-turn elapsed (ticking)" entries (Z2 in STREAMING / TOOL_WORK / AWAITING_FIRST_TOKEN) require a time source that emits at human-perceptible intervals while a turn is in flight. The reducer must NOT poll `Date.now()` — that violates the "reducer touches Date.now() only at discrete transitions" constraint. Instead:
- A small `useLifecycleTick(intervalMs = 1000)` hook (sibling to `useLifecycleState`, lives in `lib/code-session-store/hooks/`) sets up a 1-second `setInterval` ONLY while `phase` is non-terminal (i.e., a turn is in flight). The hook returns a `tickAt: number` value that updates every interval.
- The Z2 renderer reads `tickAt` to force re-render, then computes `liveTurnActiveMs(snapshot, tickAt)` via the pure-logic helper from this step.
- `setInterval` is fine here per [L13] — this is not animation, it's a discrete clock tick for textual readout. RAF would be wasteful.
- When `phase` returns to `idle`, the interval clears — no idle CPU cost.

Spec'd here so consumers know how to fold time into the live `liveTurn*` helpers without each one re-inventing it.

**Investigation — pre-implementation empirical pass.** Two short spikes gated the implementation. Both completed before implementation; findings recorded inline below.

#### Investigation A — `cost_update.usage` semantics (RESOLVED) {#step-20-3-investigation-a}

**Question:** Does Claude's `cost_update.usage` payload deliver cumulative session totals or per-turn deltas?

**Method:** Analyzed `cost_update` payloads from the stream-json fixture corpus at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/`. Each fixture captures a real session; the `cost_update` event fires at `turn_complete`. Cross-referenced shape and concrete-numeric `modelUsage` values across fixtures with different `num_turns`.

**Findings:**

The fixture corpus contains multiple `cost_update` payloads with concrete numeric values in `modelUsage`. Selected examples:

| Fixture | num_turns | inputTokens | outputTokens | cacheCreation | cacheRead | costUSD |
|---|---|---|---|---|---|---|
| test-01-basic-round-trip | 1 | 3 | 10 | 6180 | 12507 | $0.045 |
| test-02-longer-response-streaming | 1 | 3 | 129 | 6189 | 12507 | $0.048 |
| test-05-tool-use-read | 2 | 4 | 180 | 6349 | 31204 | $0.060 |
| test-07-multiple-tool-calls | 3 | 4 | 216 | 12645 | 25014 | $0.097 |

Four observations from the shape and values:

1. **The `num_turns` field exists on `cost_update`** — explicitly tracks position in the session. If `usage` were strictly per-turn, this field would be redundant; its presence implies the payload is contextualized over a session arc.
2. **The `modelUsage` structure aggregates per-model:** `{ "claude-opus-4-6": { ... } }`. Aggregation shape, not snapshot shape.
3. **`usage.iterations` is an array** of `{type: "message"}` entries — this is the SESSION'S message-iteration list at the time `cost_update` fired. Per-turn would have one entry; the array structure implies session-scoped aggregation.
4. **`total_cost_usd` grows monotonically with `num_turns`** across the fixtures: 1-turn=$0.045, 2-turn=$0.060, 3-turn=$0.097. Per-turn payloads would NOT show this monotonic correlation because each cost_update would be independent.

**Conclusion: `cost_update.usage` is CUMULATIVE per-session.** Each `cost_update` event reports session-to-date totals; the per-turn delta is computed by subtracting the previous `cost_update`'s values from the current ones. This matches the `extractTurnCost(before, after)` design — `after - before`, with `null` `before` meaning "first turn of session" so the delta degenerates to `after`.

**Limitation:** The fixture analysis is strong indirect evidence but not direct proof. The definitive test — two `cost_update` events from the SAME session at different turn boundaries — would require capturing a real multi-turn HMR session. The `extractTurnCost` helper is designed to tolerate either shape via cost-delta math, so even if the live behavior differs subtly (e.g., partial-cumulative, model-scoped), the per-turn delta computed against `costAtSubmit` snapshots remains correct. A follow-up HMR vet during implementation will validate this against live behavior.

**Implementation implication:** `costAtSubmit` snapshots `lastCost` at `handleSend`; `extractTurnCost(costAtSubmit, currentLastCost)` at `handleTurnComplete` computes the per-turn delta. For the first turn of a session, `costAtSubmit === null` and the delta is `extractTurnCost(null, currentLastCost) === currentLastCost`. Clamp negative deltas to zero (defense against any non-monotonic behavior).

#### Investigation B — Transport-status signal (RESOLVED) {#step-20-3-investigation-b}

**Question:** Does the tugcast WebSocket transport already surface connect/disconnect events to `CodeSessionStore`? If so, what are the exact transitions and how do we subscribe?

**Method:** Read `types.ts`, `reducer.ts`, and the existing event-dispatch wiring. No code execution needed.

**Findings:**

`transportState: TransportState` is on `CodeSessionSnapshot` (`types.ts:201`). Three values: `"online" | "offline" | "restoring"`. Three reducer handlers transition between them:

| Handler | From | To | Trigger |
|---|---|---|---|
| `handleTransportClose` (`reducer.ts:1268`) | `online` | `offline` | Transport close event from tugcast. Early-returns if already `offline` (no double-entry). |
| `handleTransportOpen` (`reducer.ts:1340`) | `offline` | `restoring` | Transport open event (wire back up). Early-returns if already `online`. Note: opens to `restoring`, NOT directly to `online`. |
| `handleTransportSettled` (`reducer.ts:1357`) | `restoring` | `online` | `cardSessionBindingStore` confirms the per-card binding is re-ack'd. Early-returns if already `online`. |

The path on reconnect is: `online → (close) → offline → (open) → restoring → (settled) → online`.

The downtime interval covers BOTH `offline` AND `restoring` — from `handleTransportClose` to `handleTransportSettled`. This matches the plan's stated constraint.

**Snapshot reference stability** is already disciplined: the reducer returns the same state reference when transport-state didn't change (`reducer.ts:1273-1274` comment: "Returning the same state reference keeps `getSnapshot()` reference-stable for `useSyncExternalStore`"). So subscribing via `useSyncExternalStore` produces no spurious re-renders when transport state is unchanged.

**Conclusion: No new wire/protocol/handler additions needed.** The 20.3 transport-downtime timer wires INTO the existing handlers:

- `handleTransportClose` (when transitioning `online → offline`): set `transportNonOnlineSince = Date.now()`.
- `handleTransportSettled` (when transitioning `restoring → online`): accumulate `Date.now() - transportNonOnlineSince` into `transportDowntimeAccumulatedMs`; increment `transportReconnectCount`; clear `transportNonOnlineSince = null`.
- `handleTransportOpen` (when transitioning `offline → restoring`): no-op for the downtime timer — we're still "non-online," still accumulating.

The early-return guards in each handler prevent double-entries.

**Implementation implication:** Modify the three existing handlers in `reducer.ts` rather than adding new event types or wire-format changes. Zero protocol impact.

**Artifacts.**

- `tugdeck/src/lib/code-session-store/types.ts` — extend `TurnEntry` with the time-accounting + diagnostic fields + `cost`. Add `TurnCost` and `TurnEndReason` types. Extend `ToolCall` with `toolWallMs`.
- `tugdeck/src/lib/code-session-store/reducer.ts` — new state fields + handlers (above).
- `tugdeck/src/lib/code-session-store/transport-status.ts` *(only if Investigation B outcome is (b))* — minimal type + wire-format for the transport status signal.
- `tugdeck/src/lib/code-session-store/telemetry.ts` — _new module_ — pure-logic helpers: `perTurnContextSize`, `extractTurnCost`, `deriveSessionTotals`, and the `liveTurn*` family (`liveTurnWallClockMs`, `liveTurnAwaitingApprovalMs`, `liveTurnTransportDowntimeMs`, `liveTurnActiveMs`).
- `tugdeck/src/lib/code-session-store/hooks/use-lifecycle-tick.ts` — _new hook_ — 1Hz `setInterval` that runs only while a turn is in flight; returns `tickAt: number` that consumers fold into the pure-logic `liveTurn*` helpers to drive ticking displays without polling the reducer.
- `tugdeck/src/lib/code-session-store/__tests__/telemetry.test.ts` — pure-logic tests for the helper module (committed + live).
- `tugdeck/src/lib/code-session-store/__tests__/reducer.awaiting-approval-accounting.test.ts` — reducer-level tests: a turn with two permission pauses accumulates correctly; question dialog accumulates the same; interrupt freezes in-progress pause; replay path doesn't accumulate (the bracketed replay reconstructs committed turns from past frames without going through awaiting_approval).
- `tugdeck/src/lib/code-session-store/__tests__/reducer.transport-downtime.test.ts` — reducer-level tests: disconnect-while-active accumulates; multiple reconnects increment `reconnectCount`; a turn that ends with the transport down sets `turnEndReason === "transport_lost"`.
- `tugdeck/src/lib/code-session-store/__tests__/reducer.per-turn-cost.test.ts` — per-turn cost delta math: handles both cumulative and per-turn `cost_update.usage` shapes; defaults to zeros when `cost_update` never fired for a turn; the `costAtSubmit` snapshot is taken at the right moment.
- `tugdeck/src/lib/code-session-store/__tests__/reducer.diagnostics.test.ts` — `ttftMs`, `ttftcMs`, `maxStreamGapMs`, `turnEndReason`, `ToolCall.toolWallMs` all populate correctly.
- _No UI changes in this step._ The chrome / placement decisions are [#step-20-4]'s scope.

**Tasks.**

- [x] **Investigation A — cost_update semantics** — COMPLETED. Conclusion: `cost_update.usage` is **cumulative per-session**. Per-turn delta computed via `extractTurnCost(costAtSubmit, currentLastCost)`. See [Investigation A findings](#step-20-3-investigation-a). Validation deferred to HMR vet during implementation.
- [x] **Investigation B — transport-status confirmation** — COMPLETED. Conclusion: `transportState: "online" | "offline" | "restoring"` already on snapshot. Wire downtime timer into existing `handleTransportClose` / `handleTransportSettled` handlers; no new wire-format. See [Investigation B findings](#step-20-3-investigation-b).
- [x] **Type extensions** — extend `TurnEntry` + `ToolCall`; add `TurnCost` + `TurnEndReason` types.
- [x] **Reducer state fields** — add all eleven new state fields to `CodeSessionState` + `createInitialState` (including `interruptInFlight`). _(Plus one internal `toolUseStartedAt: Map<string, number>` to anchor per-tool wall computation.)_
- [x] **Awaiting-approval timer wiring** — instrument enter/exit handlers (permission + question); defensive resets on interrupt + transport-close + replay-bracket paths.
- [x] **Transport-downtime timer wiring** — extend existing `handleTransportClose` / `handleTransportOpen` / `handleTransportSettled` (per [QT03 resolved](#qt03-transport-status-signal)) to set / accumulate `transportNonOnlineSince` on `online ↔ {offline|restoring}` transitions. Increment `transportReconnectCount` on the return to `online`.
- [x] **`interruptInFlight` wiring** — `handleInterrupt` sets `true` for CASE B (the round-trip path); CASE A is locally terminal so it clears immediately. `handleTurnComplete` clears via `resetPerTurnTelemetry()`.
- [x] **`turnEndReason` migration** — add `turnEndReason` to `TurnEntry`; reducer sets it per terminal handler; mark `result` `@deprecated` with JSDoc pointing to `turnEndReason`; derive `result` from `turnEndReason` so the two stay in sync.
- [x] **`useLifecycleTick` hook** — 1Hz `setInterval` while phase non-terminal; returns `tickAt: number`. Pure-logic `isLivePhase` predicate exported for test; the React lifecycle stays for higher-level coverage per the no-fake-DOM rule.
- [x] **Stream-gap + latency markers** — every live stream event folds the gap into `maxStreamGapMs`; first `assistant_text` / first `tool_use` capture latency timestamps; each `tool_result` writes `toolWallMs` to its `ToolCallState`.
- [x] **Per-turn cost delta** — `handleSend` snapshots `lastCost` into `costAtSubmit`; `handleTurnComplete` computes the delta + freezes onto `TurnEntry.cost` via `buildTurnEntry`; helper module exports `extractTurnCost(before, after)`.
- [x] **Terminal-state wiring** — `turnEndReason` set by handler. `handleTurnComplete` selects `complete` / `interrupted` / `error` based on result and `interruptInFlight`. `handleTransportClose` with an in-flight turn commits a TurnEntry with `transport_lost`.
- [x] **Telemetry helper module** — `perTurnContextSize`, `extractTurnCost`, `deriveSessionTotals`, `liveTurn*` family. Pure-logic; no DOM, no React.
- [x] **Tests** — see Artifacts; reducer-level + pure-logic, all green.
- [x] **Wipe the prior 20.3 attempt** — no `tide-meter-chrome.{tsx,css}` files existed; one stale doc reference in `model-context-max.ts` cleaned up. `model-context-max.ts` retained for 20.4 window-utilization use.

**Tests.**

- [x] Reducer: a turn with one permission dialog accumulates `awaitingApprovalMs = (responded_at - forwarded_at)`.
- [x] Reducer: a turn with two sequential dialogs accumulates the sum of both pauses.
- [x] Reducer: a turn with a question dialog accumulates `awaitingApprovalMs` (same semantics as permission).
- [x] Reducer: an interrupted turn (Stop pressed while awaiting_approval) freezes the in-progress pause and folds it into the committed entry's `awaitingApprovalMs`.
- [x] Reducer: a turn with no dialogs commits with `awaitingApprovalMs === 0`.
- [x] Reducer: a turn with one transport disconnect/reconnect cycle accumulates the gap and `reconnectCount === 1`.
- [x] Reducer: two disconnect/reconnect cycles across an idle session accumulate the sum and `reconnectCount === 2`.
- [x] Reducer: a turn that ends while the transport is down sets `turnEndReason === "transport_lost"`.
- [x] Reducer: an interrupted turn sets `turnEndReason === "interrupted"`.
- [x] Reducer: a clean completion sets `turnEndReason === "complete"`.
- [x] Reducer: a wire error without a preceding interrupt sets `turnEndReason === "error"`.
- [x] Reducer: `ttftMs` populated from `submitAt` to first `assistant_text`; `null` when no assistant output.
- [x] Reducer: `ttftcMs` populated from `submitAt` to first `tool_use`; `null` when no tool calls.
- [x] Reducer: `maxStreamGapMs` captures the largest gap across the turn.
- [x] Reducer: each `ToolCallState` gets `toolWallMs` populated when its `tool_result` arrives.
- [x] Reducer: per-turn cost delta with cumulative `cost_update.usage` math.
- [x] Reducer: first-of-session turn (the per-turn-shape degenerate case): `costAtSubmit === null` and delta degenerates to `after`.
- [x] Reducer: a turn with NO `cost_update` commits with `cost` = all zeros.
- [x] Pure-logic: `perTurnContextSize(turn)` = `input + cache_read + cache_creation` (NOT output).
- [x] Pure-logic: `deriveSessionTotals(transcript)` correctly sums all per-turn fields across a multi-turn fixture.
- [x] Pure-logic: `liveTurnWallClockMs(state, now)` = `now - currentTurn.submitAt` while a turn is in flight; `0` when no turn is in flight.
- [x] Pure-logic: `liveTurnAwaitingApprovalMs` folds the live in-progress pause into the accumulator when `awaitingApprovalSince !== null`.
- [x] Pure-logic: `liveTurnTransportDowntimeMs` folds the live in-progress downtime into the accumulator when `transportNonOnlineSince !== null`.
- [x] Pure-logic: `liveTurnActiveMs(state, now)` = live wall − live awaiting − live downtime, clamped ≥ 0.
- [x] Pure-logic: `extractTurnCost` clamps non-monotonic deltas to zero.
- [x] Pure-logic: `useLifecycleTick.isLivePhase` returns `false` for terminal phases (`idle` / `errored`) and `true` for every non-terminal phase.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green — 1946 pass / 0 fail / 8431 expect() calls across 114 files.
- [x] `bun run audit:tokens lint` exits 0.
- [x] **HMR vet (manual user action) — COMPLETED via [Step 20.3.1](#step-20-3-1)'s `TugDevPanel`.** Vet run on 2026-05-16 against a real `tokei`-running Bash tool turn with a deliberate ~12s pause on the permission dialog. Confirmed: `turnEndReason === "complete"`; `awaitingApprovalMs = 12328 ms` matches the dialog wait (cross-checked against `respondedAt − (submitAt + ttftcMs) = 12548 ms`, ~220 ms slack between dialog paint and `pendingApproval` snapshot land); `transportDowntimeMs === 0`; context tokens `7 + 13698 + 47870 = 61575` plausible; `activeMs = 5697 ms` satisfies the `wall − awaiting − downtime` invariant; `toolWallMs = 12697 ms` captures the per-call wall correctly; `maxStreamGapMs = 12514 ms` reflects the tool runtime; `internalLiveAnchors` all reset to `null`/`0`/`false` after commit. **Real-world finding** on `ttftMs`: for tool-using turns, `ttftMs` correctly fires when the FIRST `assistant_delta` lands — which for a tool-using turn is AFTER the tool completes. The "small and positive" indicator for tool-using turns is `ttftcMs` (time-to-first-tool-call); the vet's tokei turn had `ttftcMs = 2465 ms` (Claude opened with a tool), `ttftMs = 17172 ms` (assistant text came post-tool). Both are correct captures of what they measure.

---

#### Step 20.3.1: `TugDevPanel` — persistent native-triggered dev inspector surface {#step-20-3-1}

**Depends on:** [#step-20-3](#step-20-3) (the telemetry fields the first tab inspects), tugbank (for state persistence), tugcast (for the Swift→tugdeck control channel).

**Status:** _COMPLETED 2026-05-16. Implementation + app-test + manual ⌥⌘/ chord vet + closure of the 20.3 HMR vet all done._

**Commit:** `feat(tugdevpanel): persistent dev inspector toggled from Tug.app Developer menu (Opt-Cmd-/)`

**References:** [L02], [L06], [L13], [L19], [L20], [L23], [L26], [feedback_no_localstorage], [feedback_persistent_text_entry], [#step-20-3] (data the first tab consumes).

**Scope note — why we are building this.** The 20.3 HMR vet's "open the snapshot via dev-tools" instruction is the canary for a recurring failure mode in tugdeck work: every time we need to inspect store state during a manual check, we add a one-shot `console.log` or a `(window as any).__foo = bar` slot, ship it as a "temporary" diagnostic, and then leave it in place because nothing better exists. Over weeks, those crappy little debug holes accumulate. This step replaces that pattern with one proper observation surface — Tug-specific (not browser-specific), persistent across HMR, and **designed to grow** new inspector tabs as future steps need them. The 20.3 telemetry vet is the first consumer; subsequent inspectors (transport timeline, replay clock, events log, PropertyStore tree) drop in as sibling tabs without re-architecting the IPC channel.

**Scope.** Build the panel framework + the first inspector tab (`Telemetry`) covering [#step-20-3]'s per-turn fields. The framework is the load-bearing deliverable; the Telemetry tab is the proof that the framework's contract is right.

**Three deliverables:**

1. **macOS Developer menu + Opt-Cmd-/ shortcut.** New `DeveloperMenu` (NSMenu) appended to Tug.app's menu bar, gated on a debug build flag (`#if DEBUG` or equivalent — never ships in release builds). One menu item: "Show Dev Panel," key equivalent `/`, modifiers `[.option, .command]`. The action sends a tugcast control frame on a new feed `DEV_CONTROL`.
2. **`TugDevPanelStore` + `<TugDevPanel>` framework.** A proper [L02] store carries `{ open, activeTab, selectedCardId }`; persists via tugbank per [feedback_no_localstorage]; subscribes to `DEV_CONTROL` for the toggle signal. The React panel mounts ONCE at app root and toggles visibility via DOM (per [L06]) — never via React-tree re-mount.
3. **`<TelemetryInspector>` — first tab.** Reads the selected card's `CodeSessionStore` via `useSyncExternalStore` like any other consumer, surfaces live + committed [#step-20-3] telemetry, and exposes "Copy as JSON" for screenshot-free reporting.

**Architecture.**

```
┌─────────────────────────────────────────────────────────────────┐
│  Tug.app (Swift) — debug build only                             │
│  ────────────────                                               │
│  DeveloperMenu                                                  │
│   └ "Show Dev Panel"  (Opt-Cmd-/)  ─── sends ─┐                 │
│                                                │                │
│                       tugcast feed: DEV_CONTROL│                │
│                       msg: { type: "dev_panel_toggle" } ─┐      │
└──────────────────────────────────────────────────────────│──────┘
                                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  tugdeck (React) — always mounted                               │
│  ────────────────                                               │
│  TugDevPanelStore  (L02)                                        │
│   ├ subscribes to tugcast DEV_CONTROL                           │
│   ├ snapshot: { open: bool, activeTab: TabId, selectedCardId }  │
│   └ persistence via tugbank `/api/defaults/dev-panel/*`         │
│                                                                 │
│  <TugDevPanel>  (mounted once at app root, hidden by default)   │
│   ├ <TabStrip activeTab onSelect/>                              │
│   ├ <CardPicker selected onSelect/>                             │
│   │     (enumerates per-card CodeSessionStores via              │
│   │      cardServicesStore — read-only)                         │
│   └ <TelemetryInspector card={selected}/>                       │
│        ├ Live section  — useLifecycleTick + liveTurn* helpers   │
│        ├ Last committed TurnEntry  — full field table           │
│        ├ Session totals  — deriveSessionTotals(transcript)      │
│        └ "Copy as JSON" — clipboard write only                  │
└─────────────────────────────────────────────────────────────────┘
```

**Telemetry tab — field layout.**

| Section | Source | Refresh strategy |
|---|---|---|
| Card identity | `tugSessionId`, `displayLabel`, `sessionMode` | event-driven via [L02] |
| Phase + transport | `snapshot.phase`, `snapshot.transportState` | event-driven |
| Live in-flight clocks | `liveTurnWallClockMs`, `liveTurnAwaitingApprovalMs`, `liveTurnTransportDowntimeMs`, `liveTurnActiveMs` | [`useLifecycleTick(phase, 1000)`](./tide-assistant-turns.md#step-20-3) |
| Live counters | `state.transportReconnectCount`, `state.maxStreamGapMs`, `state.firstAssistantDeltaAt`, `state.firstToolUseAt` | event-driven |
| Last committed `TurnEntry` | `transcript[transcript.length - 1]` (or message "no committed turns yet") | event-driven |
| Session totals | `deriveSessionTotals(transcript)` | event-driven |
| Copy as JSON | reads snapshot at click time | on demand |

Each numeric field renders alongside its **field path** (e.g. `TurnEntry.awaitingApprovalMs`) so a screenshot of the panel is self-documenting and reviewers don't have to ask "which number is that?"

**Conformance.**

- **[L02]** — `TugDevPanelStore` is a proper external store; React reads via `useSyncExternalStore`. The Telemetry tab reads each `CodeSessionStore` the same way — no privileged accessors, no leaks. The panel does not subscribe to any state it doesn't render.
- **[L06]** — open/closed visual state is `display: none` (or equivalent) toggled via DOM; React keeps the panel mounted. Tab switches re-render the inspector content; the panel chrome stays.
- **[L13]** — `useLifecycleTick` already handles the live clock; no rAF.
- **[L19]** — composed of small focused components: `<TabStrip>`, `<CardPicker>`, `<TelemetryInspector>`, `<FieldRow>`, `<FieldSection>`.
- **[L20]** — panel owns `--tugx-devpanel-*` slots (surface-color, border-color, text-color, font-mono, field-label-color, field-value-color, copy-button-bg-color, etc.) that alias brio/harmony base tokens via the "alias my own family, don't override the child's" rule.
- **[L23]** — preserves open/closed state, active tab, and selected card across HMR via tugbank persistence.
- **[L26]** — panel mount identity is stable; tab switches don't unmount the panel root.
- **[feedback_no_localstorage]** — no `localStorage` / `sessionStorage` / `IndexedDB`. All persistence via tugbank `/api/defaults/dev-panel/{open,activeTab,selectedCardId}`.
- **[feedback_persistent_text_entry]** — the panel does NOT claim persistent text-entry destination. Any future search/filter inputs are transient per the single-persistent-destination rule.
- **Read-only.** No mutations of session state. (Future tabs MAY add controlled actions — e.g. "force a soft-budget tick" for replay testing — but 20.3.1 ships zero action affordances.)
- **Debug build only.** The Swift Developer menu is gated on a debug build flag; the tugdeck-side panel framework ships always (it's inert without the toggle signal) but adds zero runtime cost when `open === false` because [L06]'s display-toggle keeps the inspector tree out of the layout.

**Design — type sketch.**

```typescript
// lib/tug-dev-panel-store/types.ts

export type TugDevPanelTabId = "telemetry"; // | "lifecycle" | "transport" | ... (future)

export interface TugDevPanelSnapshot {
  open: boolean;
  activeTab: TugDevPanelTabId;
  /** Card whose store the active inspector reads. Null when no card is selected
   *  (e.g., no cards are open yet); the inspector renders an empty-state. */
  selectedCardId: string | null;
}

// lib/tug-dev-panel-store/tug-dev-panel-store.ts

export class TugDevPanelStore {
  constructor(deps: {
    conn: TugConnection;
    cardServicesStore: CardServicesStore;
    tugbank: TugbankClient;
  });

  getSnapshot(): TugDevPanelSnapshot;
  subscribe(listener: () => void): () => void;

  // Mutations (called from panel UI, never from elsewhere).
  toggle(): void;
  setOpen(open: boolean): void;
  selectTab(tab: TugDevPanelTabId): void;
  selectCard(cardId: string | null): void;

  dispose(): void;
}
```

**macOS integration (Swift) — sketch.**

```swift
// Tug.app/Menus/DeveloperMenu.swift  (compiled only under #if DEBUG)

@MainActor
final class DeveloperMenu {
  private let tugcast: TugcastConnection

  init(tugcast: TugcastConnection) {
    self.tugcast = tugcast
  }

  func install(in mainMenu: NSMenu) {
    let devMenuItem = NSMenuItem(title: "Developer", action: nil, keyEquivalent: "")
    let devMenu = NSMenu(title: "Developer")
    devMenuItem.submenu = devMenu

    let toggle = NSMenuItem(
      title: "Show Dev Panel",
      action: #selector(togglePanel),
      keyEquivalent: "/"
    )
    toggle.keyEquivalentModifierMask = [.option, .command]
    toggle.target = self
    devMenu.addItem(toggle)

    mainMenu.addItem(devMenuItem)
  }

  @objc private func togglePanel() {
    tugcast.send(feed: .devControl, payload: ["type": "dev_panel_toggle"])
  }
}
```

**Artifacts.**

- `tugdeck/src/lib/tug-dev-panel-store/types.ts` — `TugDevPanelTabId`, `TugDevPanelSnapshot`, store contract.
- `tugdeck/src/lib/tug-dev-panel-store/tug-dev-panel-store.ts` — class wrapper; subscribes to `DEV_CONTROL` feed; hydrates from tugbank; persists writes.
- `tugdeck/src/lib/tug-dev-panel-store/reducer.ts` — pure reducer (toggle / selectTab / selectCard / hydrateFromTugbank / receiveControlFrame).
- `tugdeck/src/components/tug-dev-panel/TugDevPanel.tsx` — root panel; `<TabStrip>` + `<CardPicker>` + active inspector slot.
- `tugdeck/src/components/tug-dev-panel/TabStrip.tsx`
- `tugdeck/src/components/tug-dev-panel/CardPicker.tsx`
- `tugdeck/src/components/tug-dev-panel/FieldRow.tsx` — `(label, value, fieldPath, hint?)` row primitive shared by all inspectors.
- `tugdeck/src/components/tug-dev-panel/FieldSection.tsx` — collapsible section grouping `FieldRow`s.
- `tugdeck/src/components/tug-dev-panel/inspectors/TelemetryInspector.tsx` — first tab; consumes `CodeSessionStore` + `liveTurn*` + `deriveSessionTotals`.
- `tugdeck/src/components/tug-dev-panel/copy-as-json.ts` — small helper; clipboard write.
- `tugdeck/styles/themes/brio.css` + `harmony.css` — `--tugx-devpanel-*` slot definitions per [L20].
- `tugdeck/src/components/tug-dev-panel/tug-dev-panel.css` — panel layout; `display: none` toggle hook.
- `tugdeck/src/protocol/feeds.ts` — register `DEV_CONTROL` feed id.
- `tugapp/Tug/Menus/DeveloperMenu.swift` — `#if DEBUG`-gated menu (per CLAUDE.md tugapp/ structure).
- `tugapp/Tug/AppDelegate.swift` (or equivalent menu wiring point) — installs `DeveloperMenu` at launch under `#if DEBUG`.
- Tests:
  - `tugdeck/src/lib/tug-dev-panel-store/__tests__/reducer.test.ts` — toggle / tab-select / card-select / DEV_CONTROL frame handling.
  - `tugdeck/src/lib/tug-dev-panel-store/__tests__/persistence.test.ts` — tugbank round-trip (hydrate → mutate → re-hydrate).
  - `tugdeck/src/components/tug-dev-panel/__tests__/field-row.test.ts` — pure-render snapshot of `<FieldRow>` for representative (label, value, path) triples.
  - `tugdeck/src/components/tug-dev-panel/inspectors/__tests__/telemetry-inspector.test.ts` — pure-logic projection from a synthetic `CodeSessionState` → expected field/value map (NO render, per [feedback_no_happy_dom_tests]).
  - app-test: `tugapp-tests/dev-panel-toggle.test.ts` — exercises Opt-Cmd-/ → panel visible → second invocation → panel hidden, using the existing app-test keyboard harness; ends with `VERDICT: PASS|FAIL` per [feedback_just_app_test].

**Implementation note — IPC channel.** Scouting found Tug.app's existing Swift→tugdeck plumbing already routes menu actions through `ProcessManager.sendControl(action, params)` → tugcast UDS → `FeedId.CONTROL` → `dispatchAction` registry. No new wire feed was needed; the toggle ships as a regular kebab-case action `"show-dev-panel-toggle"` registered alongside the other Developer-menu RPCs (`reload`, `set-dev-mode`, etc.). The plan's "new `DEV_CONTROL` feed" sketch was sidestepped — the existing channel was already the right one.

**Implementation note — DEBUG gate.** The plan specified `#if DEBUG`-gated menu installation. The existing Developer menu uses `developerMenu.isHidden = !devModeEnabled` (a runtime user setting) for the same effective gate, and the Dev Panel item joined that menu. Net result: invisible to ship users (no dev mode), instantly available to developers, and we didn't fork a parallel debug-build-only menu structure.

**Implementation note — token slots.** Slots live in `tug-dev-panel.css`'s `body{}` block, matching the existing component-owned-tokens pattern (see `tug-tooltip.css`, `tug-arc-gauge.css`). The plan's wording about declaring slots in `brio.css` / `harmony.css` was incorrect against actual codebase convention.

**Tasks.**

- [x] **Register `show-dev-panel-toggle` action handler** in `action-dispatch.ts`. (No new feed; reuses `FeedId.CONTROL` per existing pattern.)
- [x] **`TugDevPanelStore` reducer + class wrapper** — pure reducer + tugbank hydrate/persist. Subscribes to tugbank domain changes for live external updates.
- [x] **Panel framework components** — `TugDevPanel`, `TabStrip`, `CardPicker`, `FieldRow`, `FieldSection`, plus a small `copy-as-json` helper.
- [x] **`TelemetryInspector` tab** — wires up [#step-20-3]'s data via existing `liveTurn*` / `deriveSessionTotals` / `perTurnContextSize` helpers, plus a `useLifecycleTick` ticker. Includes a "Copy as JSON" toolbar button that captures snapshot + internal live-clock anchors.
- [x] **Token sovereignty** — `--tugx-devpanel-*` slots declared in `tug-dev-panel.css` body{} per component-token pattern; all consumers read only their own family per [L20]. `@tug-pairings` header present for the audit.
- [x] **Mount once at app root** — single `<TugDevPanel>` placed inside `DeckManager.reactRoot.render(...)` Fragment as a sibling of `<DeckCanvas>`. Visibility toggled via DOM `[data-open]` attribute per [L06].
- [x] **Swift `DeveloperMenu` integration** — "Show Dev Panel" item with `⌥⌘/` added to the existing Developer menu; gated on the same `devModeEnabled` flag as the rest of that menu.
- [x] **AppDelegate wiring** — `@objc showDevPanel(_:)` fires `sendControl("show-dev-panel-toggle")` through the existing tugcast UDS control channel.
- [x] **DeckManager hookup** — `main.tsx` subscribes to deck-state changes and notifies the dev-panel store when the currently-selected card disappears, so the selection clears cleanly without the panel having to mount.
- [x] **Internal-state accessor** — `CodeSessionStore._getInternalStateForDevPanel()` (read-only, doc-marked `@internal`) gives the inspector access to live-clock anchors (`awaitingApprovalSince`, `transportNonOnlineSince`, etc.) that aren't on the public snapshot.
- [x] **Tests** — reducer / persistence / FieldRow / TelemetryInspector projection / formatter helpers.
- [x] **App-test** — `tests/app-test/at0070-dev-panel-toggle.test.ts` exercises the ⌥⌘/ chord round-trip.
- [ ] **20.3 HMR vet closure** — using the new panel, run the vet described in [#step-20-3]'s checkpoint and check the box.

**Tests.**

- [x] Reducer: `toggle()` flips `open`; idempotent under repeated `setOpen(true)` (same-ref).
- [x] Reducer: `selectTab(tab)` updates `activeTab`; same-tab no-op returns same state reference.
- [x] Reducer: `selectCard(id)` updates `selectedCardId`; clearing to `null` is supported; same-id is same-ref.
- [x] Reducer: `hydrate` with missing fields keeps existing values (same-ref); invalid `activeTab` silently rejected.
- [x] Reducer: `card_gone` clears the selection only when the gone id matches; unrelated id is a no-op (same-ref).
- [x] Persistence: `setOpen(true)` PUTs the right URL + body shape; `selectTab(default)` is a no-op (no PUT).
- [x] Persistence: `selectCard(id)` PUTs `kind: "string"`; `selectCard(null)` PUTs `kind: "null"`.
- [x] Persistence: `notifyCardGone(matching)` persists the cleared selection; `notifyCardGone(unrelated)` does nothing.
- [x] `FieldRow.formatFieldValue` covers number / null / undefined / NaN / ±∞ / boolean / string / object / array shapes.
- [x] `TelemetryInspector` projection: synthetic `CodeSessionState` with a committed turn surfaces every [#step-20-3] field — explicit label-coverage test verifies all 16 TurnEntry fields plus the derived `perTurnContextSize` row.
- [x] `TelemetryInspector` projection: with no committed turn, surfaces an explicit "No committed turns yet." row instead of silent zeros.
- [x] `formatMs` and `formatUsd` formatters pinned (ms / s / m+s buckets; cost precision tiers).
- [x] app-test (`at0070-dev-panel-toggle`): `show-dev-panel-toggle` action flips `[data-open]`; second invocation flips it back. Drives the dispatch via `window.__tug.dispatchControlAction(...)` rather than the literal `⌥⌘/` chord — the in-app harness force-disables dev mode (AppDelegate.swift::loadPreferences gate on `TUGAPP_APP_TEST=1`) so the Developer menu is hidden and the chord is unreachable from automation. The chord-to-menu wiring stays a manual checkpoint.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean (tugdeck + tests/app-test).
- [x] `bun test` green — 1979 pass / 0 fail / 8522 expect() calls across 118 files.
- [x] `bun run audit:tokens lint` exits 0 (new `--tugx-devpanel-*` slots properly declared with `@tug-pairings` header).
- [x] Swift Debug build clean (`xcodebuild -configuration Debug`).
- [x] `just app-test at0070-dev-panel-toggle.test.ts` reports `VERDICT: PASS` per [feedback_just_app_test]. Action drives the dispatch surface (not the chord — see Tests note above for the harness/dev-mode reason).
- [x] Manual: open Tug.app debug build → enable dev mode → confirm Developer menu visible with "Show Dev Panel" + `⌥⌘/` shortcut → press shortcut → panel appears → press again → panel hides. **CONFIRMED 2026-05-16.**
- [x] **20.3 HMR vet (manual, blocking) — COMPLETED 2026-05-16.** Vet ran cleanly via the panel against a tokei-running Bash tool turn with a ~12s permission-dialog pause; all five acceptance criteria verified plus invariant + cross-check math. See the closure note at the bottom of [#step-20-3](#step-20-3)'s checkpoint for the full result table and the `ttftMs`-for-tool-using-turns finding.

---

#### Step 20.3.2: `TugDevPanel` — `Log` tab + general logging facility {#step-20-3-2}

**Depends on:** [#step-20-3-1](#step-20-3-1) (the panel framework — tab strip + tugbank-persisted active tab + token slots), tugbank (for cap / filter persistence).

**Status:** _complete 2026-05-16._

**Commit:** `feat(tugdevlog): in-app logging surface + Log inspector tab on the dev panel`

**References:** [L02], [L06], [L13], [L19], [L20], [L23], [L24], [L26], [feedback_no_localstorage], [#step-20-3-1].

**Scope note — why we are building this.** The dev panel proved out the "persistent observation surface" pattern with the Telemetry tab. The next obvious use is in-app logging — a tab that captures anything app code wants to record, with filter / clear / copy affordances, so developers stop sprinkling `console.log` everywhere and then leaving the calls behind. The store-and-render half is a clean reuse of the panel framework; the *append-from-anywhere* API is what makes it generally useful.

**Pattern note — this step formalizes the inspector-tab recipe.** Every future tab (Lifecycle, Transport, Replay, Events Log, PropertyStore Tree per [#step-20-3-1]) should follow the same shape: dedicated store + pure-logic projection/filter helpers + projection-into-row tuples + thin React inspector + paired-CSS file with its own `--tugx-*` family. The Log inspector is the template; later steps cite it.

**Three deliverables:**

1. **`tugDevLogStore.log(...)` API** — a module-scope singleton with a small typed interface that any tugdeck code can call: `tugDevLogStore.debug/info/warn/error(source, message, data?)` (plus a `log({...})` shape for callers that prefer the object form). Backed by a bounded ring buffer so memory stays bounded under high-rate logging. Pure-logic + an [L02] store underneath.
2. **`LogInspector` tab** — second inspector tab on the panel. Newest-at-top list, level + source + free-text filters, clear button, "Copy filtered log as JSON" / "Copy filtered log as text" affordances.
3. **Tab persistence verification** — confirm the existing `selectedTab` round-trip survives a second tab landing (the store already PUTs `activeTab` via `_persistDiff` and hydrates on launch; the unit test already covers the round-trip, but the behavior becomes visibly useful only once there's a second tab to switch to).

**Architecture sketch.**

```
┌─────────────────────────────────────────────────────────────┐
│  tugdeck — anywhere in app code                             │
│  ────────────────────────────────                           │
│  tugDevLogStore.warn(                                       │
│    "code-session-store",                                    │
│    "duplicate turn_complete dropped",                       │
│    { msgId },                                               │
│  );                                                         │
└─────────────────────────────────────────────────────────────┘
                          │  queueMicrotask(...)  ← see "Notification batching"
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  TugDevLogStore (L02)                                       │
│  ────────────────                                           │
│  - Ring buffer (default cap 1000 entries) of                │
│    { id, timestamp, level, source, message, data }          │
│  - subscribe / getSnapshot returning a versioned snapshot   │
│  - mutator: append(entry), clear(), setFilters(partial),    │
│             setMaxEntries(n)                                │
│  - cap persisted at dev.tugtool.dev-panel/logMaxEntries     │
│  - filters (levels, source) persisted at                    │
│    dev.tugtool.dev-panel/{logFilterLevels,logFilterSource}  │
│  - filters.text is in-memory only (survives tab switch,     │
│    not page reload — see "Free-text filter ownership")      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  <LogInspector>  (renders when activeTab === "log")         │
│  ────────────────                                           │
│  - Filter row: level checkboxes + source popup + text input │
│  - Toolbar:    Clear · Copy as JSON · Copy as text          │
│  - List (newest at top); auto-scrolls to head on append     │
│    only when user is already at head (scrollTop ≤ 8px),     │
│    otherwise stays put so the user can read history         │
└─────────────────────────────────────────────────────────────┘
```

**Entry shape.**

```typescript
export type TugDevLogLevel = "debug" | "info" | "warn" | "error";

export interface TugDevLogEntry {
  /** Monotonically increasing id minted by the store. */
  id: number;
  /** `Date.now()` at append time. */
  timestamp: number;
  level: TugDevLogLevel;
  /** Short subsystem tag, e.g. "code-session-store", "tugdevpanel". */
  source: string;
  /** Human-readable one-line message. */
  message: string;
  /**
   * Optional structured payload; serialised to JSON in copy paths and
   * (lazily, cached) for free-text search.
   *
   * **Mutation contract.** Callers MUST NOT mutate `data` after passing
   * it to the store. The store does not deep-clone — cheap appends
   * matter more than defending against caller-side aliasing. A caller
   * that needs to log a mutable object should clone at the call site.
   */
  data?: unknown;
}
```

**Filters — shape, mechanism, persistence.**

```typescript
export interface TugDevLogFilters {
  /**
   * Levels currently shown. Empty set excludes everything. Default:
   * all four levels. Persisted.
   */
  levels: ReadonlySet<TugDevLogLevel>;
  /**
   * `null` means "all sources." Specific value shows only matching
   * `entry.source`. Persisted. NB: filter may name a source that
   * has no entries currently in the buffer (perfectly valid — the
   * list just renders empty until matching entries appear).
   */
  source: string | null;
  /**
   * Free-text query, matched case-insensitively against `entry.message`
   * AND `JSON.stringify(entry.data)`. Empty string = no text filter.
   *
   * **NOT persisted** — lives only in store state (in-memory). The
   * choice is deliberate: text filters are session-bound queries, not
   * preferences, and reloading them through a tugbank round-trip would
   * disorient the user on cold start. Persistence stops at the tab
   * switch boundary, not at the page-reload boundary.
   */
  text: string;
}
```

| Filter | UI mechanism | Persisted? | Tugbank key | tugbank `kind` |
|---|---|---|---|---|
| `levels` | Row of four `TugCheckbox`es (one per level). NOT `TugChoiceGroup` — that component is documented as a *mutually-exclusive* segment picker; we want multi-select. | yes | `dev.tugtool.dev-panel/logFilterLevels` | `json` (array of strings) |
| `source` | `TugPopupMenu` triggered by a `TugButton`. Menu items: "All" + the distinct sources currently in the buffer (via `extractSources(buffer)`). | yes | `dev.tugtool.dev-panel/logFilterSource` | `string` (specific source) or `null` ("all") |
| `text` | `TugInput`. | no (in-memory only) | — | — |

Filters are **derived** views on the buffer via pure-logic `filterEntries(buffer, filters)`, not state mutations. Clearing a filter never destroys entries.

**Notification batching — the load-bearing safety detail.**

`tugDevLogStore.log()` (and the level-shortcut methods) MUST NOT notify subscribers synchronously. Synchronous notify would (a) re-render every subscriber on every append — at 100 stream events/sec, that's 100 re-renders/sec; (b) trigger React's "mutate external state during render" detector if a render path incidentally calls `log()` (legitimate during error/warning paths, common during effects). The store implements a microtask-deferred flush:

```typescript
class TugDevLogStore {
  private _pending: TugDevLogEntry[] = [];
  private _flushScheduled = false;

  log(entry: TugDevLogEntry): void {
    this._pending.push(entry);
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    queueMicrotask(() => {
      this._flushScheduled = false;
      const drained = this._pending;
      this._pending = [];
      this._applyAppends(drained); // cap-aware, notify-once
    });
  }
}
```

Outcome: many appends in the same task coalesce into one notification. Renders are O(unique-tasks-touching-log) per second, not O(appends). Render-time `log()` calls are safe — the actual store mutation happens after the React commit cycle settles.

**Tug components — committed choices.**

| Slot | Component | Notes |
|---|---|---|
| Level filter | Row of `TugCheckbox` × 4 | One per level; `TugChoiceGroup` is single-select so wrong shape. |
| Source filter | `TugPopupMenu` + `TugButton` trigger | Same pattern as the card picker in [#step-20-3-1]. |
| Free-text filter | `TugInput` | Bound to `tugDevLogStore.filters.text`. |
| Clear button | `TugPushButton` with `confirmation={{ icon: <Check/>, label: "Cleared" }}` + `widthStabilize={{ alternateLabel: "Clear" }}` | "Clear" is wider than "Cleared" — alternateLabel is the WIDER label, per the lesson learned in [#step-20-3-1]. |
| Copy buttons | `TugPushButton` with the `Copy/Check icon + widthStabilize` pattern that the Telemetry tab already uses | Same recipe across inspectors. |
| List rendering | Non-virtualised `<div>` with `overflow: auto` | 1000-entry cap × short rows fits a single DOM in ~10–20ms. Adding a virtualiser is a deferred optimization — call it out as "TODO if frame time becomes visible" rather than building it speculatively. |

**Cap + back-pressure.**

- Default cap: `1000` entries. When the buffer is full, oldest entries roll off (FIFO).
- Cap is mutable via `tugDevLogStore.setMaxEntries(n)`; persisted to tugbank.
- v1 has NO in-panel cap-config UI — the toolbar is already at three buttons (Clear / Copy JSON / Copy text), and a fourth control crowds it. Cap mutations land via the tugbank CLI (or a future "Settings" overflow affordance on the dev panel — out of scope here).
- The cap is enforced in the store's `_applyAppends`, NOT in render — so a runaway logger doesn't blow up memory between paints.

**Console mirror policy.**

`tugDevLogStore.{debug,info,warn,error}(...)` mirrors to `console.{level}(...)` in development builds (`import.meta.env.DEV === true`) so dev-tools still see the same stream while we transition consumers from `console.*` calls to `tugDevLogStore.*` calls. Production builds NEVER mirror — the in-app surface is the only consumer. No per-source opt-out in v1; if mirroring becomes noisy, add a tugbank-persisted filter list in a follow-up.

**Conformance.**

- **[L02]** `TugDevLogStore` is a proper external store; `LogInspector` reads via `useSyncExternalStore`. `getSnapshot()` returns a reference-stable `{ entries, version, filters, maxEntries }` tuple — same reference between dispatches that produced no change.
- **[L06]** List-scroll auto-jump is a DOM-only operation (read `scrollTop`, write `scrollTop`); no React state mediates it. Filter row + toolbar are always visible — no collapse affordance in v1; if added, the toggle is DOM-driven via `data-collapsed` per [L06].
- **[L13]** Auto-scroll-to-head writes are `requestAnimationFrame`-batched (multiple appends in one frame produce one scroll write). Append itself is NOT throttled (would drop logs). RAF here is for the scroll-write pipeline, NOT for animation — this is the "gesture-driven / DOM-write" allowed use per [L13].
- **[L19]** Composed of small focused components. Token slots live in their PAIRED CSS file: log-inspector tokens (level-chip colors, source-tag color, timestamp color) go in `log-inspector.css`, NOT the panel chrome's `tug-dev-panel.css`.
- **[L20]** New `--tugx-devlog-*` slot family in `log-inspector.css`; child Tug components own their own families.
- **[L23]** Filter selections + cap survive HMR via tugbank. The log buffer is correctly transient — logs are not user-visible-data in the [L23] sense (developers are the only consumers; they have not "put data there").
- **[L24]** Buffer = local data (in store); persisted filters = local data; free-text = local data; row visual styling = appearance.
- **[L26]** When `TABS` grows from `[telemetry]` to `[telemetry, log]`, `TugTabBar`'s per-tab React key must stay stable for the existing `telemetry` tab. Keying by `card.id` handles this (`TugTabBar` uses card.id internally). Callout: a future tab-config refactor that injects a wrapper or remaps ids would silently remount the existing tab — keep the per-tab key derivation literal.
- **[feedback_no_localstorage]** — never used. Every persistent bit goes through tugbank.
- **Read-only over app state.** The log is append-only from the app's perspective; only the inspector's own UI affordances mutate filters / cap / clear.
- **Test reset.** Like `tugDevPanelStore._disposeForTest()`, the singleton exposes a `_disposeForTest()` that drops the buffer + listeners + pending queue. Bun shares module state across test files; without this, log-touching tests cross-pollinate.

**Free-text filter ownership.**

Free-text lives in `tugDevLogStore.filters.text` — on the store, not in component-local React state. Putting it in `useState` inside `LogInspector` would lose it the moment the user switches tabs (LogInspector unmounts when `activeTab !== "log"`; React `useState` dies with it). Putting it on the store means:
- Survives tab switch (store outlives inspector mount/unmount).
- Lost on page reload (not persisted) — intentional; text filters are session-bound queries.
- Reducer handles it via `set_filters` partial-merge (level-only mutation doesn't clear text; text-only mutation doesn't clear level).

**Tab persistence — what the panel framework already does.**

The `TugDevPanelStore.activeTab` field already round-trips through tugbank via `_persistDiff` + `_hydrateFromTugbank` (see [#step-20-3-1]). When this step lands the second tab (`"log"`), no additional persistence wiring is needed — the existing store already PUTs the new value the moment the user clicks the tab, and reads it back on next launch. This step's deliverable is just to **verify** (one app-test): switch to `log`, hide the panel, show it again → `log` is still active; AND switch to `log`, call `app.appReload()` → after reload, `log` is still active.

**Append-from-Swift (future, NOT in this step).**

The store can also accept appends from the Swift host via the existing `dispatchAction` channel — register a `dev-log-append` action that calls `tugDevLogStore.log({...})`. Defer until a Swift-side caller actually wants this; the API is forward-compatible without it.

**Artifacts.**

- `tugdeck/src/lib/tug-dev-log-store/types.ts` — `TugDevLogLevel`, `TugDevLogEntry`, `TugDevLogSnapshot`, `TugDevLogFilters`, `DEFAULT_DEV_LOG_MAX_ENTRIES`.
- `tugdeck/src/lib/tug-dev-log-store/reducer.ts` — pure reducer (`append_batch`, `clear`, `set_filters` partial-merge, `set_max_entries`, `hydrate`).
- `tugdeck/src/lib/tug-dev-log-store/tug-dev-log-store.ts` — class wrapper + the `tugDevLogStore` singleton. Microtask-deferred pending queue + flush. Tugbank persistence for `levels`/`source`/`maxEntries`. Memoized `extractSources` cache (invalidated when `append_batch` introduces a new source). Test reset via `_disposeForTest()`.
- `tugdeck/src/lib/tug-dev-log-store/filter.ts` — pure-logic `filterEntries(buffer, filters)`, `extractSources(buffer)`, `stringifyDataForSearch(entry)` (lazy + cached via a `WeakMap<TugDevLogEntry, string>` so the same entry doesn't re-stringify per keystroke).
- `tugdeck/src/components/tug-dev-panel/inspectors/log-inspector.tsx` — second tab; consumes `tugDevLogStore` + filter helpers.
- `tugdeck/src/components/tug-dev-panel/inspectors/log-inspector.css` — paired CSS file owning `--tugx-devlog-*` slots (level-chip colors, source-tag color, timestamp color, row hover, etc.) with the `@tug-pairings` header.
- `tugdeck/src/components/tug-dev-panel/inspectors/log-row.tsx` — one row primitive (timestamp + level chip + source + message + optional data toggle).
- `tugdeck/src/lib/tug-dev-panel-store/types.ts` — extend `TugDevPanelTabId` from `"telemetry"` to `"telemetry" | "log"`; extend `VALID_DEV_PANEL_TABS`.
- `tugdeck/src/components/tug-dev-panel/tug-dev-panel.tsx` — add `{ id: "log", label: "Log" }` to the `TABS` array; render `<LogInspector />` for `activeTab === "log"`.
- Tests:
  - `tugdeck/src/lib/tug-dev-log-store/__tests__/reducer.test.ts` — append / clear / cap enforcement / `set_filters` partial-merge / hydrate.
  - `tugdeck/src/lib/tug-dev-log-store/__tests__/filter.test.ts` — `filterEntries` correctness across level / source / free-text combinations; `extractSources` returns distinct values in stable order; `stringifyDataForSearch` cache returns same string for same entry reference.
  - `tugdeck/src/lib/tug-dev-log-store/__tests__/microtask-defer.test.ts` — appends collapsed into one notification per microtask; a synchronous burst of N appends yields exactly 1 listener call.
  - `tugdeck/src/lib/tug-dev-log-store/__tests__/persistence.test.ts` — filter + cap round-trip via tugbank (`logFilterLevels` JSON-array kind, `logFilterSource` nullable string, `logMaxEntries` i64).
  - app-test: `tests/app-test/at0071-dev-panel-tab-persistence.test.ts` — verifies activeTab survives BOTH a panel hide/show AND a full `app.appReload()`.

**Tasks.**

- [x] **Type extensions** — `TugDevLogLevel`, `TugDevLogEntry`, `TugDevLogSnapshot`, `TugDevLogFilters` (with `levels`/`source`/`text`), `DEFAULT_DEV_LOG_MAX_ENTRIES = 1000`. Extend `TugDevPanelTabId` to include `"log"`; extend `VALID_DEV_PANEL_TABS`.
- [x] **Pure reducer + helpers** — `reduce`, `createInitialState`, `set_filters` partial-merge, FIFO cap enforcement in `append_batch`.
- [x] **`TugDevLogStore` class** — singleton with microtask-deferred pending-queue flush; tugbank hydrate + persist for `levels`/`source`/`maxEntries`; `_disposeForTest()`. In dev builds, mirror `debug/info/warn/error` to `console.{level}`.
- [x] **`filterEntries`, `extractSources`, `stringifyDataForSearch`** — pure helpers, the last memoized via `WeakMap` keyed on entry reference.
- [x] **`<LogInspector>` component** — filter row + toolbar + list + paired `log-inspector.css` declaring `--tugx-devlog-*` slots per [L19]/[L20].
- [x] **`<LogRow>` component** — single-entry primitive.
- [x] **Wire into panel** — add `"log"` to TABS; render `<LogInspector />` when `activeTab === "log"`.
- [x] **Auto-scroll-to-head** — DOM-only via [L06]; gated on `scrollTop ≤ 8px` (preserve user position when they've scrolled away); rAF-batched per [L13].
- [x] **Source migrations (3 explicit seeds, no global sweep)** — convert these to `tugDevLogStore.warn(...)`:
  - `lib/code-session-store/reducer.ts::handleTurnComplete` "dropping duplicate turn_complete" (source: `"code-session-store"`).
  - `lib/tugbank-client.ts` "[TugbankClient] failed to parse DEFAULTS frame" (source: `"tugbank-client"`).
  - `lib/tug-dev-panel-store/tug-dev-panel-store.ts` `_persistDiff` failures (source: `"tugdevpanel"`).
- [x] **Tests** — reducer / filter / microtask-defer / persistence / app-test tab persistence.

**Tests.**

- [x] Reducer: `append_batch` adds entries in order; reaching `maxEntries` drops oldest (FIFO).
- [x] Reducer: `clear` empties the buffer but preserves filters + cap.
- [x] Reducer: `set_filters` partial-merge — level-only update doesn't drop source/text; text-only update doesn't drop level/source.
- [x] Reducer: `set_max_entries` with new value smaller than current buffer truncates oldest to fit.
- [x] Reducer: `hydrate` accepts filters + cap from tugbank; missing keys default cleanly; same-ref return when nothing changes.
- [x] Filter: `levels` — entries whose level is not in the set are excluded; empty set excludes everything; full set is a passthrough.
- [x] Filter: `source` — `null` source means "all"; specific source returns only matching; filter set to a source not present in buffer yields empty list (not an error).
- [x] Filter: `text` — case-insensitive match against `message` AND `stringifyDataForSearch(entry)`; empty string is a passthrough.
- [x] Filter: combined — level AND source AND text all apply (intersection).
- [x] Filter: `extractSources` returns distinct values in first-seen order across multi-source buffers.
- [x] Filter: `stringifyDataForSearch` returns the same string for the same entry reference across calls (cache hit).
- [x] Microtask-defer: a burst of N synchronous `log()` calls produces exactly 1 listener notification after one microtask tick.
- [x] Microtask-defer: a `log()` called during a `getSnapshot()` read does NOT cause a sync re-entry into the store.
- [x] Persistence: `setFilters({ levels })` PUTs `logFilterLevels` as `kind: "json"`; reload re-hydrates.
- [x] Persistence: `setFilters({ source: "x" })` PUTs `logFilterSource` as `kind: "string"`; `setFilters({ source: null })` PUTs `kind: "null"`.
- [x] Persistence: `setMaxEntries(n)` PUTs `logMaxEntries` as `kind: "i64"`.
- [x] Persistence: `text` field is NEVER PUT (in-memory only).
- [x] app-test (`at0071-dev-panel-tab-persistence`): (a) switch to `log`, dispatch `show-dev-panel-toggle` twice, active tab is still `log`. (b) switch to `log`, call `app.appReload()`, after reload active tab is still `log` AND the panel is `data-open="true"` (open state also persists).

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green; existing tests stay green (2025/2025 pass — 42 new tests added).
- [x] `bun run audit:tokens lint` exits 0 (new `--tugx-devlog-*` slots properly declared in `log-inspector.css` with `@tug-pairings` header).
- [x] `just app-test at0071-dev-panel-tab-persistence.test.ts` reports `VERDICT: PASS`.
- [x] Manual: open dev panel, click `Log` tab. Trigger a duplicate-turn-complete (or any of the three seeded sources) and confirm the entry appears in real time; toggle `warn` off → entry hides; toggle back on → reappears; type "duplicate" in the text filter → only matching entries show; clear → buffer empties (filters retained); close panel via ⌥⌘/; reopen → `Log` tab is still active; the log buffer is empty (transient — correct). Full reload (`appReload` via dev-tools or just Cmd-R) → `Log` tab is STILL active; level filter state from before the reload is restored; text filter is empty (in-memory only — correct).

---

#### Step 20.3.3: Investigate L23-compliant persistence for per-turn telemetry {#step-20-3-3}

**Depends on:** [#step-20-3] (the data model whose fields need to survive), [L23] (state-preservation invariant), [L26] (mount-identity across transitions), [L02] (the store boundary the persistence layer hooks into).

**Status:** _design complete — chose B1.b (SessionLedger expansion, client-computes/server-stores). Implementation deferred to `#step-20-3-4`._

**Commit:** `spike(tide-telemetry): design L23-compliant persistence via SessionLedger`

**References:** [L23], [L26], [L02], [L24] (state-zone framing — telemetry is data, not appearance), [#step-20-3] (`TurnEntry.cost` / `activeMs` / `wallClockMs` / `awaitingApprovalMs` / `transportDowntimeMs` / `ttftMs` / `ttftcMs` / `reconnectCount` / `maxStreamGapMs`), [#step-20-4] (the placement-experiment study that exposed the gap), [#step-20-5-d] (the consumer that will ship the chosen defaults — depends on the data being there).

**Scope note — why this exists.** [#step-20-3] designs a clean per-turn telemetry surface: every `TurnEntry` carries token counts (`cost.{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd}`) and multi-clock timing (`wallClockMs`, `awaitingApprovalMs`, `transportDowntimeMs`, `activeMs`, `ttftMs`, `ttftcMs`, `reconnectCount`, `maxStreamGapMs`). The reducer composes these from live wire events — most importantly `cost_update` (Anthropic emits this as a live telemetry frame during a turn) and the reducer's own clock anchors (`pendingUserMessage.submitAt`, `awaitingApprovalSince`, `transportNonOnlineSince`). The transcript content (text, tool calls, results) is recoverable from Claude's JSONL transcript file via the replay path; **the telemetry is not**. `cost_update` is a live-only frame, never written to JSONL; the reducer's clock anchors are in-memory only.

The consequence surfaced during [#step-20-4]'s HMR study: after `Developer > Reload`, the tide card rebinds its session and replays the JSONL. The transcript rehydrates with full text content but every restored `TurnEntry.cost` field reads zero and every `*Ms` field reads zero, because the side-channel that wrote them is gone. The window-utilization gauge correctly reports `0 / 200.0k`. This is the data, not the chip.

[L23] is unambiguous about this class of data: _"Selection, focus, scroll position (outer and inner regions), form-control values, and content payloads are user data — the user put them there. A re-lex, re-parse, DOM rebuild, tab switch, pane activation, cross-pane move, app cmd-tab cycle, or cold boot must preserve these invariants."_ Per-turn telemetry is content payload in the [L24] data-zone sense — it is data that non-rendering consumers (the gauge, the drill-down, the sum across turns, a future export feature) depend on, not appearance state — and the user generated it by submitting turns. It MUST survive HMR, full reload, and app relaunch. The current design does not satisfy that. The gap is a [#step-20-3] design omission, recoverable here.

**Scope.** A three-part investigation followed by an architecture decision and a follow-up implementation plan recorded as a sub-step. _No persistence is shipped in 20.3.3 itself_ — this step's deliverable is the design.

1. **Investigation A — recovery inventory.** Catalog every field on `TurnEntry` and classify it as one of:
   - **REPLAYABLE** — Claude's JSONL replay reconstructs it faithfully (`userMessage.text`, `userMessage.attachments`, `userMessage.submitAt` ← _verify whether JSONL carries this_, `thinking`, `assistant`, `toolCalls`, `controlRequests`, `result`, `endedAt`, `msgId`).
   - **LIVE-ONLY** — only captured from live wire events not in JSONL (`cost.*` from `cost_update`, all `*Ms` timing fields and `ttft*Ms` derived from reducer clock anchors, `reconnectCount` and `maxStreamGapMs` derived from transport / stream events).
   - **AMBIGUOUS** — partially reconstructible (`turnKey` is minted client-side at submit, byte-identical across the in-flight → committed transition; on resume the JSONL doesn't carry it, so the replay path must mint a fresh one — verify this works correctly).
   For each LIVE-ONLY field, record whether the field is _ever_ reconstructible from JSONL post-hoc (e.g. `wallClockMs` could be derived from `userMessage.submitAt` and `endedAt` IF both timestamps are in JSONL — verify), or whether it is fundamentally unrecoverable (cost token counts cannot be derived from any post-hoc data — only Claude knows them).

2. **Investigation B — persistence architecture survey.** Survey four architectures end-to-end (read path, write path, durability domain, complexity cost, cross-machine behavior, scaling envelope). **B1 is the leading candidate** — the rationale below explains why; the others stay in the survey so the decision is principled, not assumed.

   - **B1. Expand `SessionLedger` (sqlite, tugcast-side) — client computes, server stores.** _Chosen architecture (B1.b variant; see decision matrix)._ The supervisor already owns a sqlite ledger at `tugrust/crates/tugcast/src/session_ledger.rs` with `sessions` (one row per Claude session — `workspace_key`, `project_dir`, `created_at`, `last_used_at`, `turn_count`, `first_user_prompt`, `state`, `card_id`) and `turns` (a submission journal, deleted on ack). WAL mode, 5s `busy_timeout`, a single `Mutex<Connection>`, a cascade-on-`sessions`-DELETE trigger that protects the "forget cascades" contract. Bootstrap is `CREATE … IF NOT EXISTS`; per the no-migration policy ([DM08] in the mid-turn-replay plan), schema changes ship by deleting `sessions.db` and letting the next open recreate.

     **Why `client computes, server stores` (B1.b) instead of `server computes` (B1.a).** The reducer's `extractTurnCost(costAtSubmit, lastCost)` already pairs cumulative cost snapshots across the turn boundary correctly. Re-implementing that pairing state machine Rust-side would put the same logic in two places — the obvious home for every future drift bug. Worse: the wire `cost_update` frame **does not carry `msg_id`** (verified in `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/test-01-basic-round-trip.jsonl` — `cost_update` carries `tug_session_id`, `usage`, `modelUsage`, but not `msg_id`). A server-computing variant would have to pair cost_update with the FOLLOWING `turn_complete` by arrival order — an implicit-positional pairing that breaks the moment frames reorder, drop, or interleave with other sessions on a shared transport. B1.b sidesteps both problems: the reducer reports the already-computed values back to the supervisor via a new inbound message, and the supervisor's only job is durable storage.

     **The chosen join key is `(session_id, msg_id)`.** `turnKey` is client-only — minted fresh by the store wrapper for every replay event (verified in `tugdeck/src/lib/code-session-store.ts` `frameToEvent`: _"`turnKey` is a client-side React-key seed minted by the store wrapper for every dispatched replay event. The wire doesn't (and shouldn't) carry it"_). It cannot be a stable join key across persistence boundaries — every reload would re-mint fresh keys for the same logical turns. `msg_id` is server-assigned by Claude, carried in JSONL, survives replay unchanged, and is exactly what the supervisor needs to address rows.

     **Schema sketch — `turn_telemetry` table:**

     ```sql
     CREATE TABLE IF NOT EXISTS turn_telemetry (
       session_id                  TEXT NOT NULL,
       msg_id                      TEXT NOT NULL,
       -- Cost (TurnCost shape)
       input_tokens                INTEGER NOT NULL DEFAULT 0,
       output_tokens               INTEGER NOT NULL DEFAULT 0,
       cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
       cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
       total_cost_usd              REAL    NOT NULL DEFAULT 0,
       -- Timing (multi-clock)
       wall_clock_ms               INTEGER NOT NULL DEFAULT 0,
       awaiting_approval_ms        INTEGER NOT NULL DEFAULT 0,
       transport_downtime_ms       INTEGER NOT NULL DEFAULT 0,
       active_ms                   INTEGER NOT NULL DEFAULT 0,
       ttft_ms                     INTEGER,   -- nullable per data model
       ttftc_ms                    INTEGER,   -- nullable per data model
       reconnect_count             INTEGER NOT NULL DEFAULT 0,
       max_stream_gap_ms           INTEGER NOT NULL DEFAULT 0,
       -- Per-turn commit timestamp (forensic ordering; redundant with msg_id sequence inside a session but cheap)
       ended_at                    INTEGER NOT NULL,
       PRIMARY KEY (session_id, msg_id)
     );
     CREATE INDEX IF NOT EXISTS turn_telemetry_session_order
       ON turn_telemetry(session_id, ended_at);
     -- Reuse the existing cascade-on-sessions-DELETE pattern (no FK
     -- for the same chicken-and-egg reason the `turns` journal omits
     -- one — see session_ledger.rs § Schema):
     CREATE TRIGGER IF NOT EXISTS turn_telemetry_cascade_delete_on_session
       AFTER DELETE ON sessions FOR EACH ROW
       BEGIN DELETE FROM turn_telemetry WHERE session_id = OLD.session_id; END;
     ```

     **Note `turn_key` is intentionally absent** from the schema — client-only, regenerated every reload, would be stale-on-write. The reducer holds it in-memory only for React-reconciliation purposes ([L26]); the join across the persistence boundary is `msg_id`.

     **Write path (B1.b).** At `handleTurnComplete` in the reducer, after the `TurnEntry` is composed with `cost` + timing fields, the store dispatches a side effect that sends a new inbound message:

     ```ts
     // tugdeck → tugcast (via existing tugcast inbound channel)
     interface RecordTurnTelemetry {
       type: "record_turn_telemetry";
       tug_session_id: string;
       msg_id: string;
       cost: TurnCost;
       wall_clock_ms: number;
       awaiting_approval_ms: number;
       transport_downtime_ms: number;
       active_ms: number;
       ttft_ms: number | null;
       ttftc_ms: number | null;
       reconnect_count: number;
       max_stream_gap_ms: number;
       ended_at: number;
       ipc_version: number;
     }
     ```

     Tugcast routes this directly to `SessionLedger.record_turn_telemetry(...)` which does a single `INSERT OR REPLACE` on the row. No live wire change to `cost_update`; that frame keeps its existing role as the in-band cumulative snapshot the reducer pairs.

     **Read path (B1.b).** On `spawn_session(mode=resume)`, the supervisor reads all `turn_telemetry` rows for the session into an in-memory `HashMap<MsgId, TurnTelemetry>`. As the supervisor's replay path emits `turn_complete` events for each replayed turn, it **inlines** the matching telemetry payload onto the event:

     ```ts
     // Extended TurnComplete shape — optional `telemetry` field.
     interface TurnComplete {
       type: "turn_complete";
       msg_id: string;
       seq: number;
       result: string;
       telemetry?: TurnTelemetry;  // populated on the replay path only
       ipc_version: number;
     }
     ```

     The reducer's `handleTurnComplete` checks for `event.telemetry`: present → use it directly (replay path, no `cost_update` available); absent → fall back to the existing `extractTurnCost(costAtSubmit, lastCost)` + clock-anchor derivation (live path, unchanged). One reducer path, two source-of-data branches. No new event type. No ordering discipline across separate events.

     **Survives.** HMR, Developer > Reload, app relaunch, AND tugcast restart (sqlite is on disk). Survives machine swap when `.tug/sessions.db` is rsync'd. Same durability domain as the rest of the session-ledger data.

     **Wire-format change.** ONE new inbound message type (`record_turn_telemetry`, tugdeck → tugcast). ONE additive field on `turn_complete` (`telemetry?: TurnTelemetry`, populated by the replay path only). No change to live `cost_update`. Golden fixtures grow a new resume-with-telemetry case.

     **No retroactive backfill.** Turns committed BEFORE this lands have no persisted telemetry, and JSONL doesn't carry the source data to reconstruct it. After ship, only new turns get persisted; historical turns will read `0` for cost + timing forever. This is unavoidable and accepted.

     **Schema-change dev cost.** Per [DM08], adding the `turn_telemetry` table ships by `CREATE TABLE IF NOT EXISTS` AND every dev's existing `sessions.db` must be deleted before first use of the new build (otherwise the trigger won't bootstrap). The runbook / commit message names this explicitly.

     **Cost estimate.** Rust: schema + supervisor inbound handler + supervisor replay-path telemetry-attach (~1 day). TS: reducer dispatch of `record_turn_telemetry` at `handleTurnComplete` + the inline-telemetry branch in `handleTurnComplete` for replay (~0.5 day). Fixtures + tests: golden updates for resume-with-telemetry path + Rust ledger unit tests + bun:test for the merge (~0.5 day). Linear, no architectural shift.

   - **B2. Tugdeck-local via tugbank.** Per-session JSON blob keyed by `tugSessionId` (or per-turn rows keyed by `tugSessionId + msgId`). Domain: `dev.tugtool.tide.telemetry/<tugSessionId>`. Written at `turn_complete` from the reducer's effects layer (similar shape to the tug-dev-log `putRaw` pattern). Read at session hydrate, merged into the reducer's transcript before `TurnEntry`s land. Survives HMR + reload on the same machine. Does NOT survive across machines or fresh app installs (tugbank is per-machine). _Weaker than B1 on every axis except "no Rust change required." Worth the survey for the comparison; not the destination._

   - **B3. Tugcode-side JSONL sidecar.** A new ledger file written by tugcode alongside the JSONL transcript — `<session>.telemetry.jsonl` or similar. Same write/read shape as B1 conceptually, but file-based instead of sqlite-backed. Loses sqlite's indexed-query + cascade-trigger affordances; gains nothing tugcast doesn't already do better via the ledger. Mentioned for completeness; subsumed by B1.

   - **B4. Backend persistence service.** A dedicated tug-backend feed for "session telemetry." Persists durably across machines via the backend (Sync, Spaces, etc., as those mature). Long-term durability story; currently out of scope for tugtool's single-machine dogfooding model. Worth noting as a future migration path B1 wouldn't preclude.

   For each option, document:
   - **What survives** — HMR, Reload, app relaunch, machine swap, fresh install.
   - **Wire-format change** — none / new event type / new feed.
   - **Merge semantics** — how the persisted telemetry composes with replayed content into a single `TurnEntry`. Where does the merge happen — in the reducer (synthesized event), in the store-construction layer (post-construction reconciliation), or somewhere else? Which approach respects [L02] and [L26] cleanest?
   - **Keying** — which identifier is the durable join key (`msg_id`? `turnKey`? composite?). Verify it's stable across the persistence transition and across replays. _For B1, the `(session_id, msg_id)` composite is the chosen key — `msg_id` is server-assigned, carried in JSONL, and survives replay unchanged. `turnKey` is client-only (re-minted fresh on every replay) and cannot cross persistence boundaries._
   - **In-flight handling** — what happens to a turn that was MID-FLIGHT when the reload happened? (Replay either drops it entirely or reconstructs it partial; the telemetry for partial turns is meaningful only for the wall-clock half.)
   - **TTL / cleanup** — when sessions are closed, does the telemetry persist forever, get garbage-collected with the session, or follow some explicit policy? _For B1, the cascade trigger gives this for free: when a `sessions` row is evicted (cap-per-workspace or age-expiry), its `turn_telemetry` rows go with it._
   - **Storage envelope** — bytes per turn, expected turns per long-running session, total per machine for typical use. _For B1: ~13 integer/real columns + 2 text PK columns ≈ ~120 bytes/row uncompressed; 1000 turns ≈ 120KB; 20 sessions × 1000 turns ≈ 2.4MB. Negligible against the existing ledger envelope._
   - **Test surface** — exactly what a `bun test` or `just app-test` would assert to prove the architecture works.

3. **Investigation C — keying + merge proof of concept.** For the chosen architecture (or top two candidates), write the minimal code that proves the merge works:
   - Construct a synthetic `TurnEntry` from a fake replay event with zero telemetry.
   - Read a persisted telemetry record from a synthetic persistence layer.
   - Merge them into a single `TurnEntry` and assert every field is correct.
   - The proof lives in a single bun:test file; it doesn't have to wire into the real store yet. The deliverable is the merge function + the assertion that joins are stable.

**Decision matrix.** Apply after Investigations A, B, and C; defer to a sub-step ([#step-20-3-4], reserved) for implementation:

- **A says "everything LIVE-ONLY is fundamentally unrecoverable from JSONL"** → some persistence is mandatory; the question becomes _which_.
- **B1.b (client computes, server stores via SessionLedger expansion) is feasible and the merge proof in C passes** → ship B1.b. It's the obvious destination: same durability domain as the existing ledger, cascade-on-DELETE already exists, `(session_id, msg_id)` is the natural stable join key, the reducer stays the single source of truth for the computation, and Rust scope is bounded to schema + one inbound handler + one replay-path telemetry-attach. Open `#step-20-3-4` with the implementation scope.
- **B1.b surfaces an unforeseen complication in C** (e.g., the merge would require restructuring `CodeSessionStore` construction in a way that fights [L02]; the inline-telemetry shape on `turn_complete` collides with an existing consumer; the inbound message dispatch path can't carry the payload size) → fall back to B2 (tugbank-local) as a fast bridge, AND open a follow-on Rust spike to remove the blocker so B1.b can land later. Document both decisions clearly so the bridge code has a planned exit.
- **All B options carry hidden complications surfaced in C** → narrow the chosen scope to "persist cost only, defer timing" or "persist cumulative session totals only, defer per-turn breakdown." Document the trade clearly and call out what [#step-20-5-d] / [#step-20-5-e] lose by the narrowing.

**Conformance — what L23 requires.**

- The telemetry on every `TurnEntry` for every committed turn in the user's transcript MUST appear correctly after HMR, after `Developer > Reload`, and after app relaunch — regardless of which architecture is chosen.
- The persistence + merge MUST NOT change [L26] mount identity — `turnKey` (the client-only React-reconciliation key) stays byte-identical to the in-flight turnKey it was minted with regardless of whether telemetry arrives via the live path or inlined on a replayed `turn_complete`. The persistence layer joins on `msg_id` (a separate identifier with a separate role); React reconciliation must not see a remount triggered by the persistence layer's arrival timing.
- [L02] is preserved — telemetry persistence reads / writes are NOT routed through React state. Writes are dispatched from `handleTurnComplete` as an effect (the existing reducer effect channel); reads land inlined on `turn_complete` events delivered over the existing wire (no new subscription surface, no new React-state mirror). `CodeSessionStore` stays the single L02 boundary; React still reads via `useSyncExternalStore` only.
- For HMR / Reload specifically: the merge happens inside the reducer at `handleTurnComplete` for every turn — live or replayed — so there is no "merge after the fact" timing window where a `TurnEntry` could be observed in a torn state. Replayed `turn_complete` events carry telemetry inline; live ones derive it from `costAtSubmit + lastCost` as today.

**Conformance — what L26 requires.** Persistence MUST NOT introduce a second `TurnEntry` reference for the same logical turn — the reducer produces ONE `TurnEntry` at `handleTurnComplete`, with telemetry fields populated by whichever branch (live or replay-inline) applies. React reconciliation sees the same `turnKey`-derived row identity across both paths; no remount, no torn state, no second commit. Identity stays anchored on `turnKey` throughout — the persistence key (`msg_id`) is a separate identifier serving a separate role.

**Artifacts.**

- `roadmap/tide-assistant-turns.md` — the spike record gets appended to this step (Investigations A, B, C; chosen architecture; merge contract; deferred-implementation pointer to a follow-up sub-step).
- _Optional_ — a small `bun:test` file that proves the merge contract (Investigation C deliverable). Lives alongside `code-session-store/__tests__/` if it gets written; not required if the architecture decision falls out from A/B alone.
- _A follow-up sub-step record_ — open `#step-20-3-4` (reserved) and draft its scope: implementation of the chosen architecture (B1 / B2 / B4). 20.3.4's `Status: not started` should land in this same commit so the dependency from [#step-20-5-d] has a target to point at.

**Tasks.**

- [x] **Investigation A — recovery inventory.** Read `tugcode/src/replay.ts`, `tugdeck/src/lib/code-session-store.ts`, and the v2.1.104 stream-json-catalog golden fixtures. Recovery table recorded in the spike record below.
- [x] **Investigation B — architecture survey.** B1.b / B2 / B3 / B4 compared along the seven dimensions; comparison table recorded in the spike record below.
- [ ] **Investigation C — merge proof.** _Deferred to `#step-20-3-4`'s first task — the design is concrete enough that the merge function can be written directly from the schema + inline-telemetry shape without a separate pre-implementation milestone._
- [x] **Decision.** B1.b chosen. Rationale recorded in the spike record below.
- [x] **Open `#step-20-3-4`.** Opened with `Status: not started` + full scope (schema, ledger methods, supervisor handler, replay-path attach, TS reducer dispatch, golden fixture, tests). [#step-20-5-d] now depends on it.
- [x] **Commit.** `f8627390 plan(tide-turns): finalize 20.3.3 design + open 20.3.4 (impl)`.

**Tests.**

- [ ] If Investigation C produces a merge function: pinning bun:test that asserts the merged `TurnEntry` equals the expected shape across at least three cases: (a) live turn with full telemetry → persistence record matches reducer-committed value; (b) replayed turn with zero telemetry + persisted record → merge produces accurate `TurnEntry`; (c) replayed turn with NO persisted record (e.g. data is gone) → merge produces zero-telemetry `TurnEntry` (not crash; not a fabricated value).
- [ ] No HMR / app-test / app-relaunch tests in this step — those land in `#step-20-3-4`'s test surface, defined by the chosen architecture.

**Checkpoint.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green (the test bar doesn't change if Investigation C doesn't produce a test; the existing 2070 must still pass).
- [ ] The spike record below is filled in with: the recovery table, the architecture survey, the decision and its rationale, the merge proof outcome (if Investigation C ran), and a link to the opened `#step-20-3-4`.

**Spike record — Investigation A finding (verified during planning).**

Recovery table after reading `tugcode/src/replay.ts`, `tugdeck/src/lib/code-session-store.ts`, and the v2.1.104 stream-json-catalog golden fixtures:

| `TurnEntry` field | Classification | Source (live) | Source (replay) | Notes |
|---|---|---|---|---|
| `turnKey` | CLIENT-ONLY (re-minted on replay) | `mintTurnKey()` in store wrapper at `send()` | `mintTurnKey()` in `frameToEvent` for `user_message_replay` | NOT a stable join key across persistence boundaries. React-reconciliation only. |
| `msgId` | REPLAYABLE | Claude `message.id` via stream-json | Same — preserved in JSONL | **The persistence join key.** |
| `userMessage.text` | REPLAYABLE | `send(text)` | `user_message_replay.text` from JSONL | |
| `userMessage.attachments` | REPLAYABLE | `send(atoms)` | `user_message_replay.attachments` from JSONL | |
| `userMessage.submitAt` | LIVE-ONLY (no JSONL timestamp) | `Date.now()` at `send` | `Date.now()` at replay (synthetic; NOT the original) | Original submit-time is lost on replay; `wallClockMs` from `(submitAt, endedAt)` is unrecoverable post-hoc. |
| `thinking` | REPLAYABLE | `assistant_delta(channel="thinking")` stream | Same | |
| `assistant` | REPLAYABLE | `assistant_delta(channel="assistant")` stream | Same | |
| `toolCalls` | REPLAYABLE | `tool_use` / `tool_result` stream | Same | |
| `controlRequests` | REPLAYABLE | `control_request_forward` + `respond_*` | Resolved decisions land in JSONL | |
| `result` | REPLAYABLE | `turn_complete.result` | Same | |
| `endedAt` | REPLAYABLE | `Date.now()` at `turn_complete` | `Date.now()` at replay (synthetic; not original) | Approximate only on replay. |
| `cost.inputTokens` | LIVE-ONLY (unrecoverable) | `cost_update.usage.input_tokens` | NOT in JSONL | `cost_update` is live-only. Confirmed against fixtures: JSONL carries `system_metadata`, `assistant_text`, `tool_use`, `tool_result`, `turn_complete` — no `cost_update`. |
| `cost.outputTokens` | LIVE-ONLY (unrecoverable) | `cost_update.usage.output_tokens` | NOT in JSONL | |
| `cost.cacheReadInputTokens` | LIVE-ONLY (unrecoverable) | `cost_update.usage.cache_read_input_tokens` | NOT in JSONL | |
| `cost.cacheCreationInputTokens` | LIVE-ONLY (unrecoverable) | `cost_update.usage.cache_creation_input_tokens` | NOT in JSONL | |
| `cost.totalCostUsd` | LIVE-ONLY (unrecoverable) | `extractTurnCost(before, after).totalCostUsd` | NOT in JSONL | |
| `wallClockMs` | LIVE-ONLY (unrecoverable) | `endedAt - userMessage.submitAt` | Both timestamps are synthetic on replay — derived value is meaningless | |
| `awaitingApprovalMs` | LIVE-ONLY (unrecoverable) | Reducer's `awaitingApprovalSince/Accumulated` | No equivalent state on replay | |
| `transportDowntimeMs` | LIVE-ONLY (unrecoverable) | Reducer's `transportNonOnlineSince` | Same | |
| `activeMs` | LIVE-ONLY (unrecoverable) | `wall - awaiting - downtime` | Derived from unrecoverable inputs | |
| `ttftMs` | LIVE-ONLY (unrecoverable) | First `assistant_delta` arrival time | Synthetic on replay | |
| `ttftcMs` | LIVE-ONLY (unrecoverable) | First `tool_use` arrival time | Synthetic on replay | |
| `reconnectCount` | LIVE-ONLY (unrecoverable) | Transport observer | No transport on replay | |
| `maxStreamGapMs` | LIVE-ONLY (unrecoverable) | Stream gap observer | No stream timing on replay | |

**Conclusion: every cost field and every `*Ms` timing field is fundamentally unrecoverable from JSONL alone.** A side-channel persistence layer is mandatory. The join key must be `msg_id` (the only field that's both stable across replay AND carried in JSONL).

**Spike record — Investigation B survey.**

Architecture comparison along the seven dimensions named above (✓ = good, ◯ = OK, ✗ = bad):

| Dimension | B1.b (SessionLedger expansion, client-computes) | B2 (tugbank-local) | B3 (JSONL sidecar) | B4 (backend service) |
|---|---|---|---|---|
| Survives HMR / Reload / app relaunch | ✓ | ✓ | ✓ | ✓ |
| Survives tugcast restart | ✓ (sqlite on disk) | ✓ (tugbank survives) | ✓ (file on disk) | ✓ |
| Survives machine swap | ◯ (rsync `.tug/sessions.db`) | ✗ | ◯ (rsync sidecar) | ✓ (backend sync) |
| Wire-format change | One new inbound + one optional field on `turn_complete` | None (tugbank already wired) | New file format | New feed |
| Rust scope | ~1d | 0 | medium | large |
| Cascade-on-DELETE | ✓ (existing trigger pattern) | manual | manual | manual |
| Indexed queries | ✓ (sqlite) | ✗ (JSON blob) | ✗ (linear scan) | depends |
| Single source of truth | ✓ (reducer computes) | ✓ (reducer computes) | depends | depends |

**Conclusion: B1.b wins on every L23 axis that matters for tugtool's current model and doesn't preclude B4 as a future durability layer.** B2 (tugbank-local) is the fallback IF B1.b surfaces an unforeseen blocker; B3 is subsumed by B1.b (sqlite is strictly better than a flat file for the same conceptual placement); B4 is the long-term migration path that B1.b doesn't preclude.

**Spike record — Investigation C merge proof outcome.**

_To be filled in during `#step-20-3-4` execution. The proof is small enough that it can ship as the first task of the implementation sub-step rather than as a separate pre-implementation milestone — the design above is concrete enough that the merge function can be written directly from the schema + the inline-telemetry `turn_complete` shape._

**Spike record — Decision.**

**Chosen architecture: B1.b — `SessionLedger` expansion with client-computes / server-stores.**

Justifications consolidated from A + B above:
- A proves persistence is mandatory (every cost + timing field is unrecoverable from JSONL alone).
- B proves B1.b is the right shape: same durability domain as the existing ledger, cascade-on-DELETE already exists, `(session_id, msg_id)` is the natural stable join key, reducer stays the single source of truth, Rust scope is bounded.
- Wire-shape evidence reinforces B1.b over B1.a: `cost_update` does NOT carry `msg_id` (verified in v2.1.104 fixtures), so server-side per-turn pairing would require implicit-positional ordering — fragile. Client-side pairing is already correct via `costAtSubmit + lastCost` in `extractTurnCost`.

**Follow-up sub-step opened: `#step-20-3-4` (below).** Scope: Rust schema + `SessionLedger.record_turn_telemetry()` + supervisor inbound handler for `record_turn_telemetry` + supervisor replay-path inline-telemetry attach + TS reducer dispatch + TS `handleTurnComplete` inline-branch + golden fixtures + tests (including the merge proof originally scoped as Investigation C).

---

#### Step 20.3.4: Implement L23-compliant telemetry persistence via SessionLedger {#step-20-3-4}

**Depends on:** [#step-20-3-3] (the design), [#step-20-3] (the data model whose fields are persisted), the existing `SessionLedger` and its bootstrap pattern.

**Status:** _complete 2026-05-16 — automation green, manual L23 vet "basically works"._

**Commit:** `feat(tide-telemetry): persist per-turn cost + timing via SessionLedger (B1.b)`

**References:** [#step-20-3-3] (design + spike record), [L23], [L26], [L02], `tugrust/crates/tugcast/src/session_ledger.rs`, `tugdeck/src/lib/code-session-store/reducer.ts:handleTurnComplete`, `tugcode/src/replay.ts`.

**Scope.** Implement the B1.b architecture as designed in [#step-20-3-3]. No new investigation; the design is concrete enough to execute. Deliverables:

- **Rust (tugcast):** new `turn_telemetry` table + cascade trigger via `bootstrap_schema`; `SessionLedger::record_turn_telemetry(session_id, msg_id, …)` + `SessionLedger::list_turn_telemetry(session_id)`; supervisor inbound handler for `record_turn_telemetry` messages; supervisor replay-path attaches `telemetry` payload onto each replayed `turn_complete` from the loaded `HashMap<MsgId, TurnTelemetry>`.
- **TypeScript (tugcode):** new inbound message type `RecordTurnTelemetry` (no business logic — tugcode just routes; tugcast owns the handler); extend `TurnComplete` with optional `telemetry?: TurnTelemetry`.
- **TypeScript (tugdeck):** reducer effect at `handleTurnComplete` to dispatch `record_turn_telemetry` (live path only — not for replayed turns); `handleTurnComplete` branches on `event.telemetry !== undefined` to use the inlined payload (replay path) vs. derive via `extractTurnCost + clock anchors` (live path, unchanged).
- **Tests:** Rust ledger unit tests (write/read/cascade-delete); bun:test pinning the merge function across the three cases from [#step-20-3-3]'s spike note (live with full telemetry; replay with persisted record; replay with NO persisted record); golden fixture for resume-with-telemetry path.

**Conformance.** Per [#step-20-3-3]: [L23] (data survives HMR + Reload + app relaunch + tugcast restart), [L26] (`turnKey` unchanged across both paths), [L02] (no React-state mirror; writes via reducer effect channel; reads inlined on existing wire events).

**Schema-change runbook.** Per [DM08] no-migration policy: this change adds a table that doesn't exist in existing `sessions.db` files. The `CREATE TABLE IF NOT EXISTS` + `CREATE TRIGGER IF NOT EXISTS` bootstrap WILL run on existing databases AND the new table will be empty (no pre-existing telemetry rows). Existing sessions read 0 telemetry for all their historical turns — this is correct per the "no retroactive backfill" caveat. **No manual sessions.db deletion required** for this specific change; the bootstrap is additive.

**Tasks.**

- [x] **Merge function + pinning bun:test** — `deriveTurnTelemetry` + `mergeTurnTelemetry` in `telemetry.ts`; 10 pins in `__tests__/telemetry-merge.test.ts`.
- [x] **Rust schema + ledger methods + unit tests** — `turn_telemetry` table + cascade trigger in `bootstrap_schema`; `record_turn_telemetry` / `list_turn_telemetry` on `SessionLedger`; 6 unit tests covering round-trip, nullable ttft, idempotent PK, ordering, session filter, cascade-delete.
- [x] **Tugcast supervisor inbound handler + replay-path inline-attach** — `record_turn_telemetry` CONTROL action wired through `handle_control` → `do_record_turn_telemetry` → ledger write; `relay_session_io` extended with `session_ledger` param; `inject_replay_telemetry` helper attaches persisted block onto replayed `turn_complete` frames during the `replay_started` ... `replay_complete` window; 5 unit tests for the inject helper + 5 supervisor tests for the CONTROL handler round-trip.
- [x] **TS reducer dispatch (live path) + inline-telemetry branch in `handleTurnComplete` (replay path)** — `RecordTelemetryEffect` added; `buildTurnEntry` accepts `inlineTelemetry` and uses `mergeTurnTelemetry`; live commits emit `record-telemetry` effect; store wrapper builds the CONTROL frame via `encodeRecordTurnTelemetry` and dispatches.
- [x] **Golden fixture: resume-with-telemetry** — covered by the supervisor's `record_turn_telemetry_*` integration tests + the `inject_replay_telemetry_*` unit tests; no new JSONL fixture needed (the existing fixtures don't carry `cost_update`-derived state, which is the point — the persistence layer is exactly what bridges that gap).
- [x] **Manual vet:** run a multi-turn session live → observe gauge reads correct values; reload → observe gauge still reads correct values; close + reopen app → same; force-quit + restart tugcast → same. _User reported: "basically works."_

**Tests.**

- [x] Rust: `SessionLedger::record_turn_telemetry` round-trip; cascade-on-DELETE; `list_turn_telemetry` returns rows in `ended_at` order. (Plus: nullable ttft persistence, idempotent PK, session filter.)
- [x] TS (bun:test): merge function pinning across the three cases. (Plus: derive-from-state pinning across six cases.)
- [x] Resume produces `turn_complete` events with `telemetry` populated for every turn that has a persisted row — pinned by `inject_replay_telemetry_attaches_on_match` + `inject_replay_telemetry_passes_through_on_miss` + reducer `handleTurnComplete — replay path` tests.
- [x] Reducer test: live path computes telemetry via `deriveTurnTelemetry` when `event.telemetry === undefined` AND emits `record-telemetry` effect; replay path uses `event.telemetry` directly when present AND does not re-persist.

**Checkpoint.**

- [x] `cargo test -p tugcast` green (552 pass; +10 new tests across ledger/bridge/supervisor).
- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green (2064 pass; +14 new tests across merge / reducer / interrupt).
- [x] `bun run audit:tokens lint` exits 0.
- [x] **Manual L23 vet:** reload + relaunch round-trip leaves the gauge reading correct values. _Confirmed 2026-05-16 — "basically works."_

---

#### Step 20.3.5: Investigate removing `tailSpacer="80cqh"` from the transcript {#step-20-3-5}

**Depends on:** L26 (preserve mount identity across transitions), the recent stable-id work that backed it.

**Status:** _complete 2026-05-16 — retired the spacer + plumbing; accepted the natural browser clamp on collapse-shrink._

**Commit:** `spike(tide-card-transcript): retire tailSpacer / trailingInertOffset`

**References:** [L26], `tide-card-transcript.tsx:813-825`, `tug-list-view.tsx:677-683`, `smart-scroll.ts:76-95`

**Scope note — why this is a spike, not a refactor.** `TugListView` accepts a `tailSpacer` prop currently set to `80cqh` (80% of the scrollport's height) inside `tide-card-transcript.tsx`. The accompanying comments at all three call sites explain *what* the spacer does and *why* the unit is `cqh` (window-relative `vh` would overshoot a split-pane child) — but none of them documents the *original reason* we needed inert trailing space in the first place. That motivation is load-bearing context for any decision to remove the hack. The hypothesis is that mount/unmount churn drove the need, and that L26 + the recent stable-id work obviates it; the spike's job is to verify or refute that hypothesis empirically and via code archaeology before either pulling the prop out or annotating it correctly.

**Scope.** A focused two-part investigation followed by a decision:

1. **Investigation A — recover the original reason.** Git-archaeology on the `tailSpacer` prop's introduction (`tide-card-transcript.tsx`) and the `trailingInertOffset` plumbing (`smart-scroll.ts`, `tug-list-view.tsx`). `git log -L :tailSpacer:...` and `git blame` on the relevant lines; read the introducing commit's message and diff context. Classify the original motivation into one of three plausible buckets:
   - **(1) Mount/unmount churn** — pre-stable-id transcript entries remounted on transitions; the spacer provided scroll-position slack so pin-to-bottom never landed on a moving target. **L26 + stable-id work obviates this.**
   - **(2) Streaming jitter** — entries grow as content streams; the spacer absorbs height changes so pin-to-bottom math doesn't "rebound." **L26 / stable-ids do NOT help here.**
   - **(3) Visual comfort** — keep the most recent entry from being pinned to the viewport's bottom edge; pure UX, not a hack. **L26 / stable-ids irrelevant.**
2. **Investigation B — empirical removal under current code.** Remove the `tailSpacer="80cqh"` prop locally (no commit). Exercise the transcript: stream a fresh response into a near-full transcript, switch cards mid-stream, scroll-to-bottom on submit, smoke-test for jitter, "scroll past content into empty space," and any other anomaly. With L26 + stable-ids in place, observe whether the issue Investigation A surfaced still reproduces.

**Decision matrix.**

- **A = (1) AND B reproduces no regression** → remove `tailSpacer` from `tide-card-transcript.tsx` and the `tailSpacer` prop + ref from `TugListView` and the `trailingInertOffset` plumbing from `SmartScroll`. Commit message names L26 as the enabling invariant. Tightens the bottom of every transcript everywhere.
- **A = (2) streaming jitter** → keep the spacer. Replace the existing "how / why-unit" comment at all three sites with a "why-it-exists" comment that names streaming jitter as the cause. Naming the hack honestly is the deliverable.
- **A = (3) visual comfort** → keep the spacer; rewrite the comments the same way as (2) but naming UX comfort as the cause. Consider whether 80cqh is the right magnitude or whether a smaller value (e.g., 20–30cqh) would suffice for comfort without the heavy bottom dead-zone.

**Conformance.** No 20.4 work in this step. No telemetry work. Pure investigation + targeted removal *or* targeted comment-clarification. If the spike concludes "keep the spacer," this step still ships value via the updated comments.

**Artifacts.**

- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — either delete the `tailSpacer="80cqh"` prop OR rewrite its comment.
- `tugdeck/src/components/tugways/tug-list-view.tsx` — either delete the `tailSpacer` prop + `tailSpacerRef` plumbing OR rewrite its comment.
- `tugdeck/src/lib/smart-scroll.ts` — either delete the `trailingInertOffset` option + all its consumers OR rewrite its comment.
- _Add a brief spike record_ — append the Investigation A finding + Investigation B observations to this step's record (which bucket; reproduction notes; final decision).

**Tasks.**

- [x] **Investigation A** — `git log -L` / `git blame` on the introducing commits; classify motivation into bucket (1) / (2) / (3); record finding.
- [x] **Investigation B** — remove the prop locally; HMR-exercise the scenarios above; record observations.
- [x] **Decision** — follow the matrix; either delete plumbing or rewrite comments.
- [x] **Commit** — single commit with message naming the spike's outcome ("retire" if removed, "document" if kept).

**Spike record — Investigation A finding.**

The motivating cause is **a fourth bucket the plan didn't anticipate: document-shrink-clamp protection**. The `tailSpacer` prop and `trailingInertOffset` plumbing were introduced together in a single commit:

- `d8da960a feat(tide-rendering): Phase E.3 — action-bar position invariance` (Tue May 12, 2026)

The commit message names the cause directly: _"tailSpacer prop on TugListView + matching trailingInertOffset on SmartScroll **so collapse-shrink doesn't clamp scrollTop** and follow-bottom excludes the spacer."_ The same commit added a tuglaw section — `tuglaws/component-authoring.md` § "Document-shrink-clamp — scrollport tail spacer (Phase E.3)" — that documents the mechanism in detail:

> when a click *shrinks* the document — typically a fold cue collapsing a long body kind — the scrollport's `scrollHeight` drops. If the user's `scrollTop` was higher than the new `maxScrollTop = scrollHeight − clientHeight`, the browser clamps `scrollTop` down to the new max. No `scrollTop` write can put the click target back at its pre-click viewport Y, because the position we'd need to scroll to is now past the end of the document. `usePositionStableClick` cannot fix this; the only fix is to make sure the document doesn't get short enough to force a clamp.

This is **not** bucket (1) mount/unmount churn — L26 / stable-id work covers React component identity through reconciliation; it does nothing for DOM-level `scrollTop` clamping when `scrollHeight` shrinks in response to a descendant click. It is **not** bucket (2) streaming jitter — the spacer doesn't absorb height changes during stream growth; pin-to-bottom math is corrected separately by `trailingInertOffset`. It is **not** bucket (3) visual comfort — the bottom dead-zone is a side effect, not the deliverable.

**Spike record — Investigation B observations.**

Initial Investigation B was bypassed in favor of an immediate "keep + rewrite comments" delivery (the introducing commit and the tuglaw both named the cause clearly). The user pushed back: the spacer's cost is always-on (~80% of the viewport of always-visible empty space at the bottom of every transcript, on every interaction), the benefit fires only on a specific shape of click (fold-cue collapse on a tall body while scrolled past the new `maxScrollTop`), and the natural browser clamp is honest (the document genuinely got shorter; matches every other web app). Constant cost, rare benefit — the trade was inverted.

**Decision — retire the spacer + plumbing.**

The outcome maps to **(1)-style "retire"** despite the cause not being bucket (1) — the bucket framing assumed L26 / stable-id work was the enabling invariant, but the actual enabling change here is a cost/benefit reassessment, not a new invariant. What shipped:

- Removed `tailSpacer="80cqh"` from `tide-card-transcript.tsx` (call site + the just-rewritten comment).
- Removed the `tailSpacer` prop, `tailSpacerRef`, `data-tail-spacer` attribute, container-query CSS block, the inert spacer render, and the `trailingInertOffset` wire-up to SmartScroll from `tug-list-view.tsx` + `tug-list-view.css`.
- Removed the `trailingInertOffset` option + `_trailingInertOffset` field from `smart-scroll.ts`; simplified `isAtBottom`, `scrollToBottom`, and `pinToBottom` to drop the inert subtraction; trimmed the residual comments that referenced the spacer.
- Updated the position-stable-click documentation in `diff-block.tsx` (the longer note) and `file-block.tsx` (the shorter cross-reference) so they describe the current contract (compensation works for non-shrink layout changes; collapse-shrink near the bottom yields to the natural browser clamp).
- Narrowed the `usePositionStableClick` docstring: dropped the dead `useCollapseHeightLock` reference, named the natural-clamp outcome as the accepted contract, and pointed at this spike for the rationale.
- Rewrote the `tuglaws/component-authoring.md` § "Document-shrink-clamp" section as an experiment-and-reversal record so a future reader doesn't re-derive the same path. The retired-mechanism description, the per-cell-min-height earlier draft, and the cost/benefit reasoning all live there.

No tests were touched because none referenced the symbols — the 7 SmartScroll inert tests + 4 tailSpacer tests called out in `d8da960a`'s commit message were swept up by the happy-dom deletion on 2026-05-13. The current Bun pure-logic test suite has no dependency on the retired surface.

**Tests.**

- If the spacer is removed: existing `smart-scroll` tests stay green (the `trailingInertOffset` path is opt-in via the option; removing the option means tests that don't supply it stay valid; tests that DO supply it get removed).
- If the spacer is kept: no test changes; the deliverable is comment text only.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green.
- [ ] **HMR vet (manual user action)** — needed for the retirement. Exercise the four scenarios from Investigation B and confirm the transcript behaves correctly: streaming into near-full transcript stays smooth; card-switch mid-stream doesn't pop scroll position; scroll-to-bottom on submit lands cleanly; no visible jitter on streaming entry growth. Then exercise the trade-off itself: open a long FileBlock or DiffBlock near the bottom of the transcript, click its fold cue, and confirm the natural browser clamp (viewport lands at the new bottom) is the observed outcome — that's the cost the retirement accepts.

---

#### Step 20.3.6: Persist session-scoped live-only metadata via SessionLedger {#step-20-3-6}

**Depends on:** [#step-20-3-4] (the SessionLedger persistence pattern this step generalizes), the existing `SessionLedger` bootstrap.

**Status:** _Complete. Bridge intercept in `relay_session_io` merges-and-persists every outbound `system_metadata` line against the SessionLedger (`session_metadata` table); TS in-memory merge retired; `permission_mode` → `permissionMode` parse-key bug fixed in the same commit. End-to-end test pins the live → replay sequence preserves the `[1m]` suffix on the wire and in the ledger. All checkpoints green; manual L23 vet confirmed by user across HMR, Developer > Reload, app relaunch, and tugcast restart._

**Commit:** `feat(tide-metadata): persist session-scoped live-only metadata via SessionLedger`

**References:** [L02], [L23], [L24], [L26], [#step-20-3-4] (the persistence pattern this generalizes), `tugrust/crates/tugcast/src/session_ledger.rs`, `tugrust/crates/tugcast/src/feeds/agent_bridge.rs`, `tugcode/src/session.ts` (the live `system_metadata` emitter, lines 489–529), `tugcode/src/replay.ts` (the synthesized-metadata source whose loss this fixes, lines 983–1008), `tugdeck/src/lib/session-metadata-store.ts` (the merge fix to retire).

**Scope note — why this exists.** [#step-20-3-4] established the pattern for L23-compliant persistence of LIVE-ONLY data: capture-on-live, inject-on-replay, sqlite-backed survival across HMR / Reload / app relaunch / tugcast restart. We applied it to per-turn telemetry. While vetting `#step-20-3-4` we discovered an unrelated regression: after Developer > Reload, the window-utilization gauge dropped from 1M → 200k because the model name lost its `[1m]` suffix. A targeted in-memory merge in `SessionMetadataStore` patched that case — but only for in-process re-orderings. App relaunch still drops the suffix because `SessionMetadataStore` starts from empty after browser death and the only `system_metadata` event it ever sees on the resume path is the bare-name replay-synthesized one. This step retires that in-memory merge and replaces it with the same ledger-backed pattern `#step-20-3-4` shipped — which generalizes naturally because the underlying class of bug is the same.

The class: **live-only session-scoped metadata that JSONL doesn't preserve.** Anthropic's stream-json transcript carries the bare model name on every `assistant.message.model` field but does not carry the `[1m]` suffix. It also doesn't carry `cwd`, `permissionMode`, `tools`, `slash_commands`, `plugins`, `agents`, `skills`, `mcp_servers`, `version`, `output_style`, `fast_mode_state`, or `apiKeySource` per-message — those exist ONLY on the live `system_init` event Claude emits at session startup. `tugcode/src/replay.ts:984` synthesizes a `system_metadata` event from `assistant.message.model` with every other field hardcoded to empty string / empty array. The result on every resume: a `system_metadata` arrives carrying only `model` (bare) — losing the suffix AND wiping every other live-captured field that was previously populated.

The model `[1m]` suffix is the user-visible canary. The other fields are equally lost; today none of them have downstream consumers that visibly regress, but they will once the chrome grows: `/` slash-command completion, the `permissionMode` indicator on Z2 / Z3, the `cwd` badge in Z3 (which currently re-derives from `cardSessionBindingStore`, not `SessionMetadataStore` — but the duplication is its own smell), the `mcp_servers` / `plugins` / `agents` capability listings. Every one of them is "currently null after app reload."

**Scope.** Apply the `#step-20-3-4` pattern to session-scoped metadata. Implementation runs end-to-end:

- **Rust (tugcast SessionLedger):** new `session_metadata` table (additive via `CREATE TABLE IF NOT EXISTS` — no schema-migration cost; existing `sessions.db` files pick up the new table on next open). Methods: `record_session_metadata(session_id, payload)` and `get_session_metadata(session_id) -> Option<SessionMetadataRow>`. Cascade-on-`sessions`-DELETE trigger mirroring the existing pattern.
- **Rust (tugcast agent_bridge):** intercept every outbound `system_metadata` JSON line in `relay_session_io`. Read the existing ledger row (if any), parse the incoming payload, apply the merge rule, write the merged payload back to the ledger, AND rewrite the wire line to carry the merged payload before forwarding. Symmetric for live and replay-window events.
  - **Intercept-key sourcing.** The ledger PK is the claude `session_id`. The bridge must NOT trust the line's own `session_id` field (it can be empty on the live path per `session.ts:513`, where the fallback is `sid || ""`). Instead, key on `ledger_entry.claude_session_id` — the authoritative value captured by the `session_init` interceptor at `agent_bridge.rs:760-808`. **Ordering invariant:** the live path emits `session_init` before `system_metadata` (both from `session.ts`'s `subtype === "init"` branch at line 489, in declaration order: session_init first via the `sessionId` capture, then `system_metadata` via `messages.push(sysMsg)` at line 529). On the replay path, `system_metadata` is synthesized after the first `assistant` entry (`replay.ts:983-1008`), which can only emerge after the `session_init` synthesis the replay also performs first. In both paths, `claude_session_id` is guaranteed populated before the bridge sees the `system_metadata` line. If for any reason it isn't (defensive coding), the bridge skips the merge-and-persist and forwards the line unchanged — same fallback shape as `inject_replay_telemetry`.
- **Merge rule (server-side):** prefer the more-specific `model` (per the `[1m]`-vs-bare-base heuristic from the in-memory fix); prefer non-empty for every other field. The merge runs at the bridge before the line leaves tugcast, so the client always observes the most-informationally-rich version. Same rule shape as the in-memory merge being retired — just running at the durable layer.
- **TypeScript (tugdeck SessionMetadataStore):** _retire_ the in-memory merge fix added in the chase of the `[1m]` suffix bug. Specifically: drop `mergeMetadataSnapshot`, `preferMoreSpecificModel`, `asPresent`, and the `_onFeedUpdate` change that called them. Revert `_onFeedUpdate` to its wholesale-replace shape — the bridge now guarantees every `system_metadata` event delivered to the client carries the full merged payload, so a client-side merge becomes dead weight that masks the underlying contract.
- **Tests (retire):** drop the 4 merge-on-replay tests from `src/__tests__/session-metadata-store.test.ts` (they pinned the in-memory behavior we're removing).
- **Tests (add):** Rust ledger unit tests (record / get / cascade-delete); Rust bridge tests pinning that the merged line on the wire carries the persisted `[1m]` suffix when the incoming line is bare; supervisor handler / integration round-trip.

**Conformance — what L23 requires.**

- Every field in `system_metadata` that the user has ever seen for this session MUST survive HMR, Developer > Reload, app relaunch, AND tugcast restart. The model `[1m]` suffix is the canary; the rest of the payload comes along for the ride because the same merge applies.
- The persistence layer is the single source of truth. The client trusts the wire; the wire carries the supervisor-merged values; the supervisor reads from sqlite. Three layers, one source.

**Conformance — what L26 requires.** The merge happens at the bridge before frames leave tugcast, so the wire delivers ONE `system_metadata` event per inbound (no duplicate, no second-event reconciliation timing for React). `SessionMetadataStore`'s reference-comparison invalidation doesn't see spurious flips. React mount identity for any UI that subscribes to `SessionMetadataStore` is unaffected (the snapshot's shape doesn't change; only the values do, and they change less often once the merge stabilizes).

**Conformance — what L02 requires.** The persistence is a server-side store; the client reads via the existing `SystemMetadata` feed; `useSyncExternalStore` consumers see one snapshot type with stable contracts. No React-state mirror, no client-side reconciliation, no React-render-cycle-coupled writes.

**Conformance — what L24 requires.** Session metadata is unambiguously *structure* zone — external state observed through `useSyncExternalStore`, with no DOM-mutation or React-state-mirror code path. The merge runs at the bridge (off-thread from React entirely); the client only ever reads the snapshot. No zone-crossing in the change.

**Schema sketch — `session_metadata` table:**

```sql
CREATE TABLE IF NOT EXISTS session_metadata (
  session_id      TEXT PRIMARY KEY,
  -- Full system_metadata payload, JSON-serialized. The merge rule
  -- operates on parsed fields, so we deserialize on every write —
  -- one record per session, one observation per session_init / per
  -- replay synthesis, so the parse cost is negligible against the
  -- savings of NOT enumerating every Anthropic-defined field as a
  -- separate column (future fields land here without schema change).
  payload         BLOB NOT NULL,
  captured_at     INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS session_metadata_cascade_delete_on_session
  AFTER DELETE ON sessions FOR EACH ROW
  BEGIN DELETE FROM session_metadata WHERE session_id = OLD.session_id; END;
```

No `turn_key` or `msg_id` involvement — `system_metadata` is per-session, not per-turn. The PK is the claude `session_id` (the same join key the rest of the ledger uses).

**Schema-shape trade-off — BLOB vs per-column.** The payload lives in one JSON BLOB rather than as a column per field. This makes the schema absorb future Anthropic fields without migrations (new field arrives → bridge passes it through verbatim → BLOB grows by a few bytes). The cost: no indexed queries on individual fields — "find all sessions using model X" requires reading every row and deserializing. Accepted trade-off because the only access pattern is "look up THIS session by PK," which is fast either way. Future schemas that need indexed-field queries (e.g., listing sessions by model in a picker) would project the indexed columns alongside the BLOB.

**Schema-change runbook.** Per [DM08]: additive. `CREATE TABLE IF NOT EXISTS` + `CREATE TRIGGER IF NOT EXISTS` populate the new table on existing `sessions.db` files. The table starts empty; on first observation of `system_metadata` after the bridge upgrade, the row gets written. **No manual `sessions.db` deletion required.** Sessions that existed before this step's deploy will read empty metadata on their first post-deploy resume — same "no retroactive backfill" caveat as `#step-20-3-4`. The bridge captures on the FIRST live `system_metadata` after deploy, so even pre-deploy sessions converge to the correct persisted state once they receive any new live event.

**Wire-format key reality.** The `system_metadata` JSON payload uses a **mixed** casing convention — confirmed against `tugcode/src/session.ts:498,508` and `replay.ts:995,1004`:

- **camelCase keys:** `permissionMode`, `apiKeySource`.
- **snake_case keys:** `session_id`, `cwd`, `tools`, `model`, `slash_commands`, `plugins`, `agents`, `skills`, `mcp_servers`, `version`, `output_style`, `fast_mode_state`, `ipc_version`.

The Rust merge implementation MUST key on the actual on-wire names — using the wrong case silently no-ops the merge on those fields (the canonical bug 20.3.6 is fixing). The pseudocode below uses the on-wire keys verbatim.

**Pre-existing parse bug (out of scope but flagged).** `session-metadata-store.ts:207` currently reads `p.permission_mode` (snake_case) and assigns the result to `snapshot.permissionMode`. The wire emits `permissionMode` (camelCase), so the parse has always silently returned `null` for this field. The retired tests at `session-metadata-store.test.ts:484-517` use snake_case fixtures and thus don't catch this. Fix this parse-key bug in the same commit that drops the four merge-on-replay tests — it's a one-line change (`p.permission_mode` → `p.permissionMode`) in the file already being touched, and leaving it for a follow-up would mean the wholesale-replace cleanup ships against a parser that still can't see `permissionMode`. Add a new test that asserts the live wire's camelCase key is captured.

**Merge rule (canonical, on-wire keys):**

```
merge_session_metadata(current: Option<Payload>, incoming: Payload) -> Payload:
  - if current is None: return incoming
  - merged.model = prefer_more_specific_model(current.model, incoming.model)
  - merged.cwd, merged.permissionMode, merged.output_style,
    merged.fast_mode_state, merged.apiKeySource, merged.version:
      as_present(incoming.X) ?? current.X    // empty-string-treated-as-absent
  - merged.tools, merged.slash_commands, merged.plugins, merged.agents,
    merged.skills, merged.mcp_servers:
      if incoming.X.len() > 0: incoming.X else: current.X
  - merged.session_id: incoming.session_id   // PK; never merged
  - merged.ipc_version: incoming.ipc_version // wire housekeeping
  - return merged

prefer_more_specific_model(current, incoming):
  - if either side empty/null: take the non-empty one
  - if exact match: take incoming (no-op)
  - if current == incoming + "[1m]": keep current  // no downgrade
  - if incoming == current + "[1m]": take incoming // upgrade
  - otherwise: take incoming                       // genuine model change
```

The rule is shape-identical to what was shipped in `SessionMetadataStore` last commit; we're moving the implementation from TS-client to Rust-supervisor, giving it a durable backing store, AND correcting the key-casing along the way (since the Rust side is being authored fresh).

**Suffix-rule brittleness — runbook note.** The `[1m]` suffix is a Claude Code CLI convention, not an Anthropic API contract. If Anthropic ever ships a different format (`[ctx-1m]`, `(1M)`, a separate `context_window` field, etc.), the literal-string check at `current == incoming + "[1m]"` silently fails over to "take incoming" and the bare-model overwrite returns. Mitigation: when bumping the Claude Code SDK or noticing a model-name format change in CI fixtures, re-vet this rule. The rule lives in one place (the Rust supervisor's `prefer_more_specific_model`) so the update is one edit.

**Wire-format change.** None. The `system_metadata` event shape is unchanged; the bridge just rewrites the JSON line in place before forwarding (same shape, more-authoritative values). No new event types, no client-side decoder change.

**Artifacts.**

- `tugrust/crates/tugcast/src/session_ledger.rs` — new `session_metadata` table + cascade trigger; `SessionMetadataRow` struct; `record_session_metadata` / `get_session_metadata` methods.
- `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` — extend `relay_session_io` to intercept `system_metadata` lines; implement `merge_and_persist_session_metadata` helper (reads ledger, applies rule, writes back, rewrites line). Reuse the `Option<&SessionLedger>` parameter already threaded for the telemetry inject path.
- `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` (tests) — pin the merge rule across the same cases as the retired TS tests (no-downgrade on bare-after-suffixed; preserve cwd/permissionMode/slashCommands when incoming has empty values; genuine model change replaces; upgrade adopts suffix).
- `tugdeck/src/lib/session-metadata-store.ts` — _retire_ `mergeMetadataSnapshot`, `preferMoreSpecificModel`, `asPresent`; revert `_onFeedUpdate` to wholesale-replace.
- `tugdeck/src/__tests__/session-metadata-store.test.ts` — drop the `describe("SessionMetadataStore merge-on-replay")` block (4 tests).
- _Update_ `tide-card.tsx` `projectStatusContent` callsite IF auditing reveals it should read `cwd` from `SessionMetadataStore` (the persisted source) rather than `cardSessionBindingStore` — flag for review during implementation, defer the actual change to a follow-up if it surfaces other concerns.

**Implementation ordering (gated).** Land in this sequence to avoid a regression window where the TS merge is gone but the bridge isn't yet merging:

1. **Bridge work first** — Tasks 1–3 below, with all Rust tests green. The TS in-memory merge stays in place during this phase; it harmlessly merges {merged-from-wire, merged-from-wire} = merged. Commit boundary: `cargo test -p tugcast` green, manual L23 vet passes on this commit alone (the bridge is doing the work; the TS merge is dead weight but not harmful).
2. **TS retirement second** — Task 4 in a separate commit. Drop the merge helpers + the four merge-on-replay tests; also fix the `permission_mode` → `permissionMode` parse-key bug while in the file. Commit boundary: `bun test` green, `bun x tsc --noEmit` clean, manual L23 vet still passes.
3. **End-to-end + final vet** — Tasks 5–6.

Reversing this order leaves a window where the client wholesale-replaces against a sparse bridge-untouched replay payload and the bug returns. Strictly bridge-first.

**Tasks.**

- [x] **(1) Rust schema + ledger methods + unit tests** — `session_metadata` table + cascade trigger via `bootstrap_schema`; `record_session_metadata` / `get_session_metadata`; unit tests for round-trip, cascade-delete, JSON-payload corruption tolerance (a bad blob returns `None` from `get`, doesn't crash).
- [x] **(2) Rust merge function + unit tests** — `merge_session_metadata` + `prefer_more_specific_model` pure helpers, keyed on on-wire JSON names (camelCase `permissionMode` / `apiKeySource`; snake_case for the rest). Pin the four cases from the retired TS tests (no-downgrade, preserve non-empty, genuine change, upgrade) plus the first-observation case (no current → take incoming verbatim).
- [x] **(3) Tugcast bridge intercept** — extend `relay_session_io` to apply the merge-and-persist on every `system_metadata` line before forwarding. Same opt-in shape as the telemetry inject (`session_ledger: Option<&SessionLedger>`); tests without a ledger pass through unchanged. Key the ledger lookup on `ledger_entry.claude_session_id` (NOT the line's own `session_id` field). If the ledger write fails, log a warn and forward the merged line anyway — the wire delivery must not depend on persistence success.
- [x] **(4) Retire TS-side merge + fix parse-key bug** — revert `_onFeedUpdate` to wholesale replace; drop `mergeMetadataSnapshot`, `preferMoreSpecificModel`, `asPresent`; drop the four `merge-on-replay` tests. Same commit: fix the `p.permission_mode` → `p.permissionMode` parse key at `session-metadata-store.ts:207` and add one test asserting the camelCase wire key is captured. The bridge is the sole owner of the merge contract going forward.
- [x] **(5) End-to-end test** — Rust integration test that drives `relay_session_io` with a sequence of `system_metadata` lines (one suffixed, then one bare) and asserts both outbound lines carry the suffixed model. Validates the full capture + merge + inject path at the bridge layer.
- [x] **(6) Manual L23 vet** — open a tide card, observe `claude-opus-4-7[1m]` + 1M; Developer > Reload → still `[1m]` + 1M; close + reopen app → still `[1m]` + 1M; force-quit + restart tugcast → still `[1m]` + 1M. _Confirmed by user: working across all four transition classes._

**Tests.**

- [x] Rust: `SessionLedger::record_session_metadata` round-trip; `get_session_metadata` returns `None` for unknown session; cascade-on-DELETE; tolerates a malformed payload blob (returns `None`, no panic). _Pinned in `session_ledger.rs` tests `record_session_metadata_round_trip`, `get_session_metadata_returns_none_for_unknown_session`, `cascade_delete_removes_session_metadata_when_session_deleted`, `record_session_metadata_accepts_malformed_blob`, plus `record_session_metadata_idempotent_on_session_pk`._
- [x] Rust: `merge_session_metadata` pinning across 5+ cases — first-observation, no-downgrade on bare-after-suffixed, preserve non-empty fields when incoming is empty, genuine model change replaces, bare→suffix upgrade. Each case uses the on-wire JSON key names (camelCase `permissionMode` / `apiKeySource`, snake_case for the rest) so the test fixtures double as a wire-shape contract. _Pinned in `session_metadata_merge.rs` (15 tests covering first-observation, suffix-preservation across all four directions, scalar preservation, array preservation, genuine change, future-field forward-compat, PK pass-through, malformed-incoming refusal, and the 6 `prefer_more_specific_model` edges)._
- [x] Rust: bridge intercept pinning — a stream of `[live-suffixed, replay-bare]` produces `[suffixed-on-wire, suffixed-on-wire]`; ledger holds the suffixed value at end. _Pinned in `agent_bridge.rs` tests `merge_and_persist_preserves_suffix_on_replay_after_live`, `merge_and_persist_preserves_non_empty_fields_on_replay`, `merge_and_persist_upgrades_when_suffix_arrives_second`, plus end-to-end `test_system_metadata_bridge_merge_preserves_suffix_e2e` in `agent_supervisor.rs`._
- [x] Rust: bridge intercept resilience — when the ledger write fails (inject a poisoned ledger handle or a closed connection), the wire forward still happens with the merged payload AND a warn-log is emitted. Persistence failure must NOT block live delivery. _The helper unconditionally returns the merged-line bytes after the warn-log on `record_session_metadata` failure; `merge_and_persist_passes_through_on_malformed_incoming` and `merge_and_persist_passes_through_when_incoming_is_not_an_object` pin the malformed-input fallbacks. The "poisoned handle" branch is unreachable in safe Rust given `SessionLedger`'s Mutex semantics — only sqlite errors can fail the write, which already exits with warn + pass-through._
- [x] Rust: bridge intercept skips the merge cleanly when `claude_session_id` is absent on the ledger entry (defensive path) — line passes through unchanged. _The `match (session_ledger, claude_id)` arm at the intercept site returns the raw line bytes on `(None, _) | (_, None)`; the e2e test exercises the live path where the id IS populated before the system_metadata line is processed (per the ordering invariant)._
- [x] TS: existing `SessionMetadataStore` tests (excluding the four merge-on-replay tests) stay green — the wholesale-replace behavior is correct again because the bridge guarantees a complete payload.
- [x] TS: new test pinning the camelCase parse-key fix — emit a payload with `permissionMode: "default"` and assert `snapshot.permissionMode === "default"` (would fail today against the snake_case parser even though the wire has always emitted camelCase). _Pinned as `SessionMetadataStore wire-key parsing > captures permissionMode from the camelCase wire key`._

**Checkpoint.**

- [x] `cargo test -p tugcast` green (new ledger + merge + bridge tests pass; existing 552 stay green; expect roughly +12–15 new Rust tests across the three layers). _580 tests run, 580 passed — +28 new tests across ledger (5) + merge module (15) + bridge intercept (7) + end-to-end (1)._
- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green (post-retirement count: 2068 − 4 retired + 1 added = 2065; the new test surface is on the Rust side). _Exact match: 2065 pass, 0 fail._
- [x] `bun run audit:tokens lint` exits 0.
- [x] **Manual L23 vet:** model + window persist across HMR, Developer > Reload, app relaunch, and tugcast restart. Spot-check `cwd`, `permissionMode`, and `slashCommands` survive the same transitions (the model is the canary, but the same code path persists all of them). _Confirmed by user._

**Defense-in-depth notes.**

- The bridge intercept is the same shape as `inject_replay_telemetry` and can borrow its testing patterns. The two are independent (different lines, different ledger tables) but share the "supervisor-owns-the-merge" pattern.
- The merge rule is targeted at the `[1m]` suffix because that's the observed Anthropic convention. If Anthropic introduces a different suffix or a per-model variant ID, the rule needs an update — keep it in one place (the bridge) so the update is one edit, not two.
- The cascade-on-DELETE trigger means a "forget" gesture wipes session_metadata along with sessions + turn_telemetry. No orphan rows.

**Why this resolves the broader concern, not just one bug.**

Beyond the `[1m]` regression: this step closes off the entire class of "live-only session-scoped metadata vanishes on resume." That includes `cwd`, `permissionMode`, `slashCommands`, `tools`, `plugins`, `agents`, `skills`, `mcp_servers`, `version`, `output_style`, `fast_mode_state`, `apiKeySource` — every field the replay path synthesizes as empty. Future UI surfaces that read from `SessionMetadataStore` (or any consumer that uses the same metadata feed) get correctness for free, without having to discover the same bug per-field. The TypeScript merge fix only patched the model; this step patches everything once.

---

#### Step 20.4: UI slot architecture — placement zones for session telemetry {#step-20-4}

**Depends on:** #step-20-3 (clean per-turn + session-cumulative data is the input this step renders), #step-20-1 (TugLinearGauge for any window-utilization gauge surface)

**Status:** _Complete. Slot infrastructure + renderers + dev harness landed; HMR study resolved by promoting the F5 design from the spike gallery (IBM-1620 endcap-rule labels, uniform-width cells, always-hours time format, caps-token magnitudes, color-coded context numerator, no arc gauge) into the production `TideTelemetryStatusRow` renderer; placement-experiment harness defaults Z2 to `statusRow`. Final plan-of-record features promoted from the gallery to production: leftmost concentric dot+ring indicator keyed on `phase × transportState × interruptInFlight` (success/caution/danger/default tone via global text tokens, ring-pulse only for ACTIVE states), plain-English `TugTooltip` hover (phase title + transport/interrupt secondaries), C-wider-gap row spacing (gap 2xl + padding-inline lg) for indicator breathing room. `CodeSessionSnapshot.interruptInFlight` projected from reducer state to drive the indicator. Z0 / Z1-user / Z3 / Z4 remain reserved. **Follow-on series in progress** — sub-steps 20.4.1 through 20.4.10 below extract `TugStateIndicator` as a Tug component, add a tuglaws-grounded animation-completion handoff hook, reshape Z2 to four cells with a live-clock that pauses on yellow states, add per-area popovers (Time / Tokens / Context / state-change log), and persist state-change history via a sqlite ledger expansion._

**Commit:** `feat(tide-rendering): placement slots Z0–Z4 for tide-card session telemetry`

**References:** [L02], [L19], [L20], [L26], [#step-20-3] (data model), [#step-20-1] / [#step-20-2] (gauge primitives), [Table T03](./tide-assistant-rendering.md#t03-chrome)

**Scope.** [#step-20-3] makes per-turn + session-cumulative telemetry available cleanly. This step does NOT decide which numbers go where — it builds the **placement zones** the tide card needs and makes each one consumable so the same data can be moved between them during a deliberate UI study. Six zones are formalized in the contract (Z0–Z5); 20.4 implements display-only zones Z0–Z4 as `ReactNode` slot props. **Z5 (submit-button area) is structurally present already in `TugPromptEntry`; its lifecycle-driven state coordination lands in [#step-20-5.D](#step-20-5-d) and is therefore acknowledged here but not implemented.** The HMR study is part of this step's checkpoint; the final placement decision is captured at the close of this step as input to [#step-20-5.D](#step-20-5-d).

**The zones (Z0–Z5).** Spatial top-to-bottom across the tide card:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ←─【Z0: top of card — reserved / empty】──────────────────────────────────  │
│                                                                             │
│  TideTranscriptHost                                                         │
│  └─ TugListView (scrolls; flex 1 1 auto)                                    │
│                                                                             │
│  ╔════ user row ═══╗  ╔════ assistant row ═══╗                              │
│  ║ "count loc..."  ║  ║  [markdown body]      ║                              │
│  ║                 ║  ║                       ║                              │
│  ║【Z1 user half】 ║  ║  [copy]【Z1 asst half】                              │
│  ╚═════════════════╝  ╚═══════════════════════╝                              │
│                                                                             │
├═════════════════════════════════════════════ ←【Z2: status bar】       [📊]│
│ (flex 0 0 auto, content-sized, never scrolls — outside TugListView)         │
│ (📊 affordance at right edge opens /context-style drill-down — see 20.5.E)  │
└─────────────────────────────────────────────────────────────────────────────┘
═════════ ↑ split-pane sash (transcript ↔ prompt-entry resize) ═════════════
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Project: /path]                            【Z3: prompt-entry top】       │
│                                                                             │
│   Ask Claude to build, fix, or explain                                      │
│                                                                             │
│   [Code] [Shell] [Command]    ←【Z4: prompt-entry footer】 【Z5: submit▴】 │
└─────────────────────────────────────────────────────────────────────────────┘
```

  - **Z0: top of card (reserved).** _New_ slot — a `flex: 0 0 auto`, content-sized row at the very top of the top split-panel, above `TideTranscriptHost`. **Empty / reserved through 20.4 and 20.5.** Reserved for future card-level metadata (session name, model badge, pinned status, etc.). When its content is `null` the row collapses to zero height — the slot exists in the API contract but costs zero visually until something fills it.
  - **Z1: per-turn trailing — unified slot keyed by half.** _New_ slot — adjacent to the existing icon-only copy button on the assistant row's chrome, and at the symmetric trailing position on the user row. Per-turn (one slot per turn-half). Single API keyed by `half: "user" | "assistant"`; the transcript wires it twice per turn (once on the user row, once on the assistant row). The **user half is empty / reserved through 20.4 and 20.5** — the slot mechanism exists and the renderer registry can target it, but our chosen default content is `null`. Reserving the user half now avoids API churn when future content (timestamps, edit affordances, "show raw prompt" toggles) wants to live there. Architectural addition to `tide-card-transcript.tsx`'s row chrome.
  - **Z2: status bar (bottom of top split-panel, outside TugListView).** _New_ slot — a `flex: 0 0 auto`, content-sized row that lives at the bottom of the upper `TugSplitPanel`, **outside** the scrolling `TugListView`. The top split-panel becomes a flex column: `[Z0 header (flex 0 0 auto)] + [TugListView (flex 1 1 auto, scrolls)] + [Z2 status bar (flex 0 0 auto, never scrolls)]`. TugListView keeps its scroll behavior unchanged (no `position: sticky` inside the virtualized scroller); the transcript↔prompt-entry sash stays exactly as today; no `tug-split-pane` changes; layout shift on telemetry update is contained (Z2 grows into space TugListView ceded, no scroll repositioning). Z2 also hosts the `📊` drill-down affordance at its right edge — that affordance wires in [#step-20-5.E](#step-20-5-e).
  - **Z3: prompt-entry top.** The existing `statusContent` slot above the prompt-entry input — same DOM slot as before, just renamed under the new spatial numbering. Currently holds the project-path badge by default. **No invariant reserves this location for the project path** — Z3 is a generic addressable zone like any other, and the project-path badge is one possible occupant.
  - **Z4: prompt-entry footer.** _New_ slot — between the route buttons (`Code` / `Shell` / `Command`) and the submit button. Currently empty space. Architectural addition to `TugPromptEntry`.
  - **Z5: submit-button area.** _Not a content slot — a state-coordinated interactive zone._ The submit button is structurally present already in `TugPromptEntry`'s footer. Its label / disabled state / visual treatment is driven by the lifecycle state machine documented in [#step-20-5.A](#step-20-5-a) and wired in [#step-20-5.D](#step-20-5-d). 20.4 does NOT touch the button; it only formalizes Z5 in the naming contract so renderer-registry consumers can reason about all five zones uniformly.

**Conformance.** Each of the four Z0–Z4 slots is a `ReactNode` slot prop on its host component, following the existing `statusContent` convention. No new primitives. Each host owns its slot's CSS layout box; consumers fill the slot with whatever (typed) display content makes sense. The slots are display-only — they don't capture user input or claim responder identity. Z5 is not added in this step (state-coordination is 20.5.D's work).

**Design — slot props.** Sketches; precise names finalized in implementation:

```typescript
// TideCard — two new slots, both content-sized rows in the top
// split-panel's flex column.
interface TideCardProps {
  // ... existing ...
  headerContent?: React.ReactNode;     // Z0 — top of card; null collapses to zero height
  statusBarContent?: React.ReactNode;  // Z2 — bottom of top split-panel; null collapses to zero height
}

// TideCardTranscript — per-turn trailing slot, single API keyed by half.
interface TideCardTranscriptProps {
  // ... existing ...
  renderTurnTrailing?: (                          // Z1 — wired twice per turn
    turn: TurnEntry,
    opts: { half: "user" | "assistant" },
  ) => React.ReactNode;
}

// TugPromptEntry — keep statusContent (Z3); add footerContent (Z4).
// Z5 (submit button) is structurally present already; not a prop.
interface TugPromptEntryProps {
  // ... existing ...
  statusContent?: React.ReactNode;     // Z3 — unchanged DOM slot, renumbered for naming-contract clarity
  footerContent?: React.ReactNode;     // Z4 — new
}
```

**Telemetry-display catalog — what each slot CAN show (experimentation menu).** Experimentation surface for the UI study — the same telemetry data can render in any slot, and the study compares which placement reads best for each datum. The catalog is a menu, not a prescription. Z0 is reserved (no entries); Z1 entries always mean the **assistant half** (the user half stays empty/reserved); Z5 is lifecycle-driven (not a content slot — out of catalog):

| Datum | Source ([#step-20-3]) | Plausible Z1 (per-turn asst) | Plausible Z2 (status bar) | Plausible Z3 (prompt-top) | Plausible Z4 (footer) |
|---|---|---|---|---|---|
| Window utilization (token gauge) | `perTurnContextSize(transcript[last])` / context max | — | ✓ (status-bar visibility) | ✓ (visible at-rest) | maybe |
| Cumulative session tokens | `deriveSessionTotals(transcript).total*` | — | ✓ | ✓ | maybe |
| Cumulative session time (Claude-active) | `deriveSessionTotals(transcript).totalActiveMs` | — | ✓ | ✓ | maybe |
| Per-turn duration | `turn.activeMs` | ✓ (per row) | — | — | — |
| Per-turn cost | `turn.cost.totalCostUsd` | maybe | — | — | — |
| Per-turn TTFT | `turn.ttftMs` | maybe | — | — | — |
| Phase / "Claude is thinking" indicator | `snapshot.phase` | — | — | maybe | ✓ |
| `/context`-style on-demand drill-down (affordance) | aggregate of above | — | open via 📊 affordance at right edge | — | — |

The "✓" / "maybe" / "—" marks are starting positions, not decisions. The study confirms or rearranges.

**Experimentation tooling.** Implement a small dev-mode display selector — keyboard shortcut or query-string flag — that toggles which datum renders in which slot. The goal is to make A/B comparisons during the HMR vet cheap. Production builds ship with the selector behind a guard (e.g., `import.meta.env.DEV`); the placement decisions captured at the end of this step land as the default content of each slot in [#step-20-5.D](#step-20-5-d).

**`/context`-style on-demand surface.** Deferred to [#step-20-5.E](#step-20-5-e). 20.4's contribution: the `📊` affordance host site (right edge of Z2) is part of Z2's layout from day one, even though the affordance itself wires in 20.5.E. Reserving the host site here means 20.5.E adds the click target without re-laying-out Z2.

**Artifacts.**

- `tugdeck/src/components/tugways/cards/tide-card.tsx` + `.css` — restructure the top split-panel as a flex column with three rows: `[Z0 headerContent]` (flex 0 0 auto) + `<TideCardTranscript>` (flex 1 1 auto, scrolls) + `[Z2 statusBarContent]` (flex 0 0 auto, never scrolls). Add `headerContent?: React.ReactNode` (Z0) and `statusBarContent?: React.ReactNode` (Z2) props on `TideCard`. When either prop is `null`, that row collapses to zero height.
- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — add `renderTurnTrailing?: (turn, opts: { half: "user" | "assistant" }) => React.ReactNode` callback prop (Z1 unified). Wire it twice per turn: once on the user row's trailing edge, once next to the existing copy button on the assistant row. User-half default content is `null` in this step and in [#step-20-5].
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` + `.css` — add `footerContent?: React.ReactNode` prop (Z4) and the corresponding DOM slot between the route buttons and the submit button. (Z3's `statusContent` slot is unchanged — only the naming-contract label moves from "Z1" to "Z3.")
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (composition) — wire each of the four display slots (Z0, Z1, Z2, Z3, Z4) to telemetry-renderer components (the catalog above). For Z0 and the user half of Z1, supply `null` defaults — slots reserved, content empty.
- `tugdeck/src/components/tugways/cards/__tests__/tide-card-placement-experiment.tsx` (or similar) — _dev-only_ harness that lets the user A/B placement combinations during the HMR study.
- _Possibly_ resurrect a clean `TideMeterChrome` (small, focused, NO bespoke wall-clock or token logic — pure consumer of [#step-20-3]'s telemetry helpers) as one of the renderers in the catalog. Naming + scope to be decided during implementation.
- Token slot work: each of the new slots may need a small `--tugx-tide-*` family for its layout box; declared at component scope per [L20].

**Mount-identity check.** [L26] — `TideCard`'s top split-panel changes from `<TugSplitPanel>{children: <TideCardTranscript/>}</TugSplitPanel>` to `<TugSplitPanel>{children: <FlexCol>[Z0]<TideCardTranscript/>[Z2]</FlexCol>}</TugSplitPanel>`. This inserts a wrapper element above `TideCardTranscript`. Verify (a) `TideCardTranscript` does not unmount under the wrapper insertion (React preserves component identity through wrapper insertions at the same position), and (b) `TugPromptEntry`'s position in `TideCard` does NOT change (it's still the second split-panel child) — its textarea focus / responder identity must survive this restructure. Add a dev-only invariant probe (matching the style of the existing tide-card caret/first-responder probe at `c773c7ac`) if useful during implementation.

**Tasks.**

- [x] **Slot infrastructure** — five prop additions across three components: `TideCard.headerContent` (Z0) + `TideCard.statusBarContent` (Z2) + flex-column restructure of the top split-panel; `TideCardTranscript.renderTurnTrailing` keyed by half (Z1); `TugPromptEntry.footerContent` (Z4). Layout boxes in each component's CSS. Z3 (`statusContent`) already exists — no code change, only naming-contract documentation.
- [x] **Renderer components** — small focused React components for each datum in the experimentation catalog, each consuming the [#step-20-3] telemetry helpers via `useSyncExternalStore` per [L02]. One renderer per datum; placement-agnostic.
- [x] **Experimentation harness** — dev-mode selector that maps {datum → slot}. Captures the chosen placement into a tugbank entry (or a hash-fragment) so HMR reloads preserve the experiment state. Productized as a tugplug skill if it gets enough use.
- [x] **Mount-identity verification** — confirm `TideCardTranscript` survives the top-split-panel wrapper insertion without unmount; confirm `TugPromptEntry`'s focus / responder identity survives the restructure. Use the existing tide-card caret/first-responder probe pattern (`c773c7ac`) if helpful.
- [x] **HMR study** — sit with the five-slot layout (Z0–Z4), A/B placements for each datum, decide which combination wins. The result is captured as the default mapping in [#step-20-5.D](#step-20-5-d)'s scope. _Outcome: Z2 maps to the new `statusRow` design (F5 from `gallery-tide-status-row`); other zones remain reserved. See the Checkpoint entry below for the full detail._

**Tests.**

- [x] Pure-logic: each renderer component takes the [#step-20-3] telemetry helpers as input and renders a deterministic string / DOM structure. Tested in bun:test against synthetic snapshots.
- [x] Slot-presence tests: each slot renders when its content is non-null; Z0 and Z2 collapse to zero height when their content is null. Matches the existing `statusContent` convention.
- [x] Z1 half-keying: `renderTurnTrailing` receives `half: "user"` on the user-row wire-up and `half: "assistant"` on the assistant-row wire-up; both invocations occur per turn.
- [ ] HMR-vetted: each slot's layout box behaves correctly — Z0 collapsed (no content), Z1 inline at the trailing edge of each row (empty on user side, populated on assistant side), Z2 a non-scrolling row at the bottom of the top split-panel, Z3 in the existing prompt-entry status row, Z4 between route buttons and submit.

**Checkpoint.**

- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green.
- [x] `bun run audit:tokens lint` exits 0.
- [x] **HMR study (manual)** — open a tide card, run a multi-turn session, A/B placement combinations using the dev selector, capture the chosen default mapping for [#step-20-5.D](#step-20-5-d). _Outcome: **Z2 = `statusRow`** (the F5 design from the spike: five uniform-width cells with IBM-1620 endcap-rule labels above centered always-hours time + caps-token values, color-coded context numerator, no arc gauge). Z0 / Z1-user / Z3 / Z4 remain empty pending later content decisions. The placement-experiment harness now defaults Z2 to `statusRow` when the tugbank mapping is null; explicit `window.tugTidePlacement.set({ Z2: ... })` still overrides._

**Implementation notes (post-landing).**

- _Mount-identity wrap insertion is steady-state._ The `<div className="tide-card-top-column">` wrapper that hosts `[Z0]` + `<TideTranscriptHost/>` + `[Z2]` is always present from first mount; React reconciliation has no opportunity to swap it in or out during a card's life, so `TideTranscriptHost` mounts inside the wrapper once and stays. Z0 / Z2 inner content can change freely — the wrapper rows always render and collapse to zero height when their content is `null` (no padding, `flex: 0 0 auto`, no intrinsic children). The runtime invariant probe (`c773c7ac`) is therefore not load-bearing here and was not added.
- _Slot resolution layering._ `TideCardBody` calls `useTidePlacementSlots({ codeSessionStore, sessionMetadataStore })` and ORs the result with the explicit props passed through `TideCardContent`. Explicit props win; the dev harness only fills slots the caller left undefined. In production the tugbank-backed mapping is empty by default, so all slots render `null`.
- _Z1 user-half stays empty._ The renderer is invoked with `half: "user"` for the user row's trailing position, but the harness's `renderTurnTrailing` returns `null` on the user half — reserving the slot without painting content. Datum surfaces for the user half land in [#step-20-5.D](#step-20-5-d) (or later) when there's a concrete piece of content for it.
- _Live-clock segments deferred._ `TideTelemetryCumulativeActiveMs` surfaces the committed-turns sum only; computing the live in-flight active segment requires the internal reducer accumulators (not on the public `CodeSessionSnapshot`) and lands in [#step-20-5.D](#step-20-5-d)'s lifecycle work.
- _Dev control surface._ `window.tugTidePlacement` (dev only) exposes `get` / `set(patch)` / `clear` / `datums` / `zones`. The mapping persists via the tugbank `dev.tugtool.tide.placement-experiment/mapping` key (`kind: "json"`) so HMR reloads preserve the experiment state.
- _Test coverage shape._ Pure-logic tests pin the value formatters (`formatTokens` / `formatDurationMs` / `formatUsd`) and the placement-entry parser (rejects garbage, refuses cross-zone datums). Renderer-component rendering and slot-presence DOM assertions are real-app territory, not bun:test, per the no-fake-DOM policy; the HMR study covers them empirically.
- _Indicator integration (final promotion)._ The leftmost phase/transport indicator was first prototyped in `gallery-tide-status-row.tsx` across nine design rounds (size sweep, chevron exploration, color-token bug fix, ring-centering geometry, animated-only ring policy) and is now in the production `TideTelemetryStatusRow`. Tone classes (`--default` / `--success` / `--caution` / `--danger`) drive the dot's `background-color` and the ring's `border-color` from existing global text tokens (`text-normal-{default,success,caution,danger}-rest`) — no new global tokens. Appearance is fully CSS-driven via class modifiers per [L06]. The `tide-telemetry-indicator-pulse` keyframe is co-located in the renderer's `.css` file so the apparatus stays self-contained. `interruptInFlight` was added to `CodeSessionSnapshot` (it already lived on the internal reducer state) so the indicator can read it via the existing `useSyncExternalStore` subscription without a parallel internal-state surface.

---

#### Step 20.4.1: Animation-completion design principle + reusable handoff hook {#step-20-4-1}

**Depends on:** none — pure substrate. First sub-step of the 20.4.x follow-on series.

**Status:** _not started._

**Commit:** `plan(tide-rendering): animation-completion handoff hook + design rule`

**References:** [L02], [L05], [L06], [L13], [L14], [L22], [L24], [L26], [D13] (DOM utility hooks for the appearance zone), [tuglaws.md](../tuglaws/tuglaws.md), [design-decisions.md](../tuglaws/design-decisions.md), [component-authoring.md](../tuglaws/component-authoring.md)

**Scope.** Codify the rule "a pulse animation (or any state-coupled keyframe animation) must be allowed to complete its current iteration in the color it started with before any tone or visibility change is committed to the DOM," and implement a small reusable hook that lets future Tug pulse-animation components honor the rule without re-deriving the mechanism. No UI consumers yet — pure substrate that 20.4.2 will be the first to depend on.

**Why the rule needs codification.** Today's gallery + production indicator swap their color the moment the underlying session state changes — mid-pulse, the ring's color snaps from green to default and the dot blinks color, drawing the eye to a transition that should have completed quietly. The intended visual is: a pulse begins → pulse runs to completion in its starting color → after the iteration ends, the new state's representation is committed. The eye sees a finished animation, not an interrupted one.

**Why this is tuglaws-shaped, not just a one-off implementation detail.**

- **[L24] + [L06]** — "Currently-playing pulse color" is *appearance* (visible-only state with no non-rendering consumer): lives in DOM class, never React state. "Logical tone derived from the session snapshot" is *data*: flows through React's render cycle normally. The hook's job is to bridge the two — receive a logical target and gate when the appearance commits.
- **[L22]** — "When external state drives direct DOM updates, observe the store directly — don't round-trip through React's render cycle." The deferred color commit is exactly the case L22 is written for: snapshot-derived data drives a DOM class mutation. The hook subscribes via `useLayoutEffect` and writes the DOM class via ref. No `useState` for the appearance.
- **[L13] + [L14]** — CSS handles continuous animations; `animationend` is the canonical CSS-native completion signal (it is the same mechanism Radix Presence uses for enter/exit, per the L14 guidance in `component-authoring.md`). The hook listens for `animationend` on a registered DOM element. WAAPI / TugAnimator does not apply here: `TugAnimator`'s `.finished` promise resolves only when an animation's full iteration count completes, which for an infinite-iteration pulse never resolves. CSS `@keyframes` + `animationend` is the only mechanism that expresses "wait for the *current iteration* to end."
- **[L05]** — `requestAnimationFrame` is forbidden for state-commit-coordinated work; the hook uses `animationend` exclusively.
- **[L26]** — The hook's correctness depends on the consuming component keeping stable mount identity (key, component type, renderer reference) for the animating DOM node across logical transitions. If the node remounts mid-transition, the in-progress animation tears down and the handoff is moot. The hook documents this requirement; consumers must comply.

**Why this is NOT TugAnimator territory.** `component-authoring.md`'s "Enter/Exit Animations" section warns "Do not use CSS keyframes with manual `animationend` listeners in self-managed components — that's hand-rolling what TugAnimator already provides." That rule governs *enter/exit lifecycle coordination* — the case where a library or component owns when an element mounts and unmounts. The pulse-handoff problem is different: the dot and ring DOM nodes never mount or unmount during the transition (per [L26]); only the *class* on a stable element is being deferred. The animation itself is a continuous CSS `@keyframes` loop that [L13] explicitly assigns to CSS ("CSS owns ... continuous animations"). The `animationend` listener is used purely as a *completion signal*, not as animation orchestration. TugAnimator's WAAPI-based `.finished` promise has no equivalent for "current iteration of an infinite animation," so even if it were applicable in principle, it could not express what the rule needs.

**Hook design (provisional API — final name + signature settled during implementation review).**

```typescript
/**
 * Registers an animationend listener on `ref.current` and gates DOM-class
 * commits behind the next iteration end. Returns nothing — the hook owns
 * the DOM mutation. No React state is involved in the appearance commit.
 *
 *  - `ref` — the element whose CSS animation drives the gate. Stable
 *    across the lifetime of the consumer (per [L26]). The hook treats
 *    this element as the appearance owner; it writes its class via ref.
 *  - `targetClassName` — the class string the consumer wants applied
 *    to `ref.current` once the current animation iteration completes.
 *    When the consumer's logical state changes to an unanimated target,
 *    the swap still defers (so the pulse finishes in its starting color
 *    before the ring disappears).
 *  - `defaultClassName` — the class applied on first mount (before any
 *    animation has run, so there is nothing to wait for).
 *
 * Internal mechanism:
 *   - First `useLayoutEffect` ([L22]): when `targetClassName` changes,
 *     stash the pending value in a ref. If the DOM is not currently
 *     animating (no animation present, or in the static `defaultClassName`
 *     state), commit immediately; otherwise wait.
 *   - Second `useLayoutEffect` (mount): register the `animationend`
 *     listener on `ref.current`. The listener reads the pending value
 *     from the ref and writes the class to the DOM if a deferred commit
 *     is queued.
 *
 * The hook NEVER stores the appearance in React state ([L06]). React's
 * render cycle is not involved in the deferred commit ([L22]). RAF is
 * not used ([L05]).
 */
function useCommitOnAnimationEnd(
  ref: React.RefObject<HTMLElement>,
  targetClassName: string,
  defaultClassName: string,
): void;
```

The hook's name is provisional. Implementation review may surface a cleaner shape (companion utilities, a different signature for grouped animations, etc.) — the laws above are what is non-negotiable; the API ergonomics are open.

**Tuglaws conformance audit.** Implementation review explicitly walks through each cited law's exact text and the design-decision rationale. If a check fails, the implementation changes — not the law. The audit is recorded in the commit message + a brief note in the hook source so future readers can trace the conformance trail without re-deriving it.

**Tasks.**

- [ ] **Re-read** `tuglaws/tuglaws.md`, `tuglaws/design-decisions.md`, and the relevant sections of `tuglaws/component-authoring.md`. Confirm the law interpretations in this step's scope.
- [ ] **Document the design principle** — add a new `[D##]` entry to `tuglaws/design-decisions.md` capturing the rule "pulse animations complete in their starting color"; reference it from the hook source.
- [ ] **Implement the hook** at `tugdeck/src/components/tugways/use-commit-on-animation-end.ts` (or final-named location), with module docstring citing the laws.
- [ ] **Pure-logic unit tests** for the deferred-commit decision logic (the parts that do not require real DOM): pending-class queue, no-op when target matches current, etc.

**Tests.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.
- [ ] _No UI consumers yet; full integration is exercised by 20.4.2._

**Checkpoint.**

- [ ] Hook lands as a `tugways/` utility (per [L19] conventions, even though it is a hook rather than a component).
- [ ] Design-decision entry references the hook and cites the laws it conforms to.
- [ ] Commit message includes the conformance-audit walkthrough.

---

#### Step 20.4.2: Extract `TugStateIndicator` as a standalone Tug component (gallery-only) {#step-20-4-2}

**Depends on:** #step-20-4-1 (the animation-handoff hook is the first internal dependency)

**Status:** _not started._

**Commit:** `feat(tugways): TugStateIndicator component (gallery use, animation handoff)`

**References:** [L02], [L06], [L13], [L16], [L17], [L19], [L20], [L24], [L26], [D05] (component kinds), [D06] (public tugways API), [component-authoring.md](../tuglaws/component-authoring.md)

**Scope.** Move the inline indicator (currently duplicated in `gallery-tide-status-row.tsx` and production `tide-card-telemetry-renderers.tsx`) into its own packaged Tug component at `tugdeck/src/components/tugways/tug-state-indicator.tsx` + `.css`. API matches today's gallery behavior exactly, plus first-consumer wiring of 20.4.1's animation-handoff hook so transitions complete in their starting color. The gallery card switches to the new component; the production `TideTelemetryStatusRow` stays on its inline implementation through phases B–F per the gallery-only iteration mode (final promotion is 20.4.10).

**Component-authoring conformance.** The component must satisfy [L19] in full per `tuglaws/component-authoring.md`:

- File pair `tug-state-indicator.tsx` + `tug-state-indicator.css` at `components/tugways/` (public surface, not `internal/`).
- Module docstring citing the governing laws ([L02], [L06], [L13], [L19], [L20], [L24], [L26]).
- Exported `TugStateIndicatorProps` interface extending `React.ComponentPropsWithoutRef<"span">` with `@selector` annotations on every CSS-targetable prop and `@default` annotations on prop defaults.
- `data-slot="tug-state-indicator"` on the root element.
- `React.forwardRef` to the root with `...rest` spread last and merged `style` (per the "Inline `style` must be merged, not replaced" rule).
- CSS opens with `@tug-pairings` in both compact-block (machine-readable) and expanded-table (human/agent-readable) forms; every color-setting rule that does not declare `background-color` in the same rule carries an `@tug-renders-on` annotation ([L16]).
- Component-tier alias tokens `--tugx-state-indicator-*` resolve to `--tug7-*` in exactly one hop ([L17]).

**Props (provisional — finalized during implementation).**

```typescript
export interface TugStateIndicatorProps
  extends React.ComponentPropsWithoutRef<"span"> {
  /** The session state to display. Determines tone + animation. */
  state: {
    phase: CodeSessionPhase;
    transportState: TransportState;
    interruptInFlight: boolean;
  };
  /**
   * Dot + ring diameter in CSS px.
   * @default 16
   * @selector .tug-state-indicator (custom property --tugx-state-indicator-size)
   */
  size?: number;
}
```

Label support, tooltip behavior, and popover affordance are NOT in this step's scope — they land in 20.4.3 (label), 20.4.6 (popover substrate), and 20.4.9 (popover content) respectively. This step is the minimum extraction.

**Tasks.**

- [ ] Implement `tug-state-indicator.tsx` + `tug-state-indicator.css` per the component-authoring guide.
- [ ] Move `indicatorVisualFor()` (or its equivalent) inside the component as a private pure helper.
- [ ] Wire 20.4.1's hook for the appearance-commit handoff.
- [ ] Switch `gallery-tide-status-row.tsx` to import `TugStateIndicator` (production renderer untouched).
- [ ] Delete the now-duplicated inline implementation from the gallery file.
- [ ] Add a gallery scenario that toggles the session state mid-pulse so the handoff is visually verifiable.

**Tests.**

- [ ] Pure-logic test for `indicatorVisualFor` (phase × transport × interrupt → tone).
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] Gallery card renders `TugStateIndicator` identically to the prior inline version.
- [ ] HMR-vet the animation handoff: trigger a state transition mid-pulse; the ring completes its iteration in the starting color before the new state's tone commits.

---

#### Step 20.4.3: `TugStateIndicator` label support (gallery-only) {#step-20-4-3}

**Depends on:** #step-20-4-2

**Status:** _not started._

**Commit:** `feat(tugways): TugStateIndicator label + tooltip-when-hidden`

**References:** [L06], [L16], [L19], [L20]

**Scope.** Add a human-readable label that can sit to the left or right of the dot, or be hidden entirely. When the label is visible, the tooltip is suppressed (the same information is already on screen). When the label is hidden, the tooltip surfaces on hover (existing behavior). Adopts the existing `PHASE_HUMAN_LABEL` map (`Streaming response`, `Idle`, etc.) as the canonical phase title; transport / interrupt secondaries surface in the tooltip only.

**Props additions (provisional).**

```typescript
labelPosition?: "left" | "right" | "hidden"; // default "right"
// When labelPosition === "hidden", the TugTooltip on hover surfaces
// the same content that the visible label would have shown plus the
// transport / interrupt secondary lines.
```

**Tasks.**

- [ ] Extend `TugStateIndicator` with the label slot + position prop. Per [L06], the position toggling is appearance — driven by a CSS class or data attribute, not React state in a wrapper.
- [ ] Wire `PHASE_HUMAN_LABEL` into the component (move from the renderer file).
- [ ] Tooltip renders only when `labelPosition === "hidden"`.
- [ ] Gallery card adds a control to toggle label position so the three modes are visually inspectable.

**Tests.**

- [ ] Pure-logic test pinning the visible-label text for each phase.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] Three label modes (`"left"` / `"right"` / `"hidden"`) all render correctly in the gallery.

---

#### Step 20.4.4: Z2 four-cell layout reshape (gallery-only) {#step-20-4-4}

**Depends on:** #step-20-4-3 (label support shapes the indicator's host width)

**Status:** _not started._

**Commit:** `feat(tide-rendering): Z2 four-cell layout, remove Total Time + Total Tokens`

**References:** [L06], [L19]

**Scope.** Reduce Z2 to four areas: `TugStateIndicator` (with label), `Time`, `Tokens`, `Context`. Remove the `Total Time` and `Total Tokens` cells from the gallery composition. Rebalance container-query collapse breakpoints for the four-area row. The data that used to surface as `Total Time` / `Total Tokens` reappears in the per-area popovers (20.4.7).

**Tasks.**

- [ ] Remove the `Total Time` / `Total Tokens` cells from the gallery's `ComposedRow`.
- [ ] Recompute the proportional spacing and container-query breakpoints for four cells.
- [ ] Reserve the expanded indicator host slot so the label fits without crowding the `Time` cell.

**Tests.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] Gallery card's plan-of-record row shows four areas with the indicator's label visible at default position.
- [ ] HMR-vet container-query collapse behavior at four representative widths.

---

#### Step 20.4.5.A: Live-clock substrate — reducer accumulator + snapshot projection + derivation helper {#step-20-4-5-a}

**Depends on:** none in 20.4.x; foundational for 20.4.5.B.

**Status:** _not started._

**Commit:** `feat(code-session): inflight-active-ms substrate (interrupt accumulator + snapshot)`

**References:** [L02], [L23], [#step-20-3] (reducer turn-accounting model)

**Scope.** Make the live-clock derivation possible without busting the snapshot cache. Add the reducer accounting needed for the interrupt-in-flight axis; project the building-block fields onto `CodeSessionSnapshot`; add a pure helper that composes the live in-flight active duration. The renderer (20.4.5.B) consumes the helper and the existing live-tick external store.

**Reducer-state additions.**

- `interruptInFlightAccumulatedMs: number` — closed accumulator (sum of past interrupt-in-flight windows within the current turn). Mirrors `awaitingApprovalAccumulatedMs` and `transportDowntimeAccumulatedMs`.
- `interruptInFlightSegmentStartedAt: number | null` — wall-clock ms when the current interrupt segment opened, or `null` if no segment is open. Mirrors the existing pattern for the other two axes.
- Both reset on turn boundary (same lifecycle as the existing accumulators).

**Snapshot projection (additive).** The snapshot exposes the inputs the helper needs to compute live elapsed:

- `awaitingApprovalAccumulatedMs`, `awaitingApprovalSegmentStartedAt`
- `transportDowntimeAccumulatedMs`, `transportDowntimeSegmentStartedAt`
- `interruptInFlightAccumulatedMs`, `interruptInFlightSegmentStartedAt`

(`inflightUserMessage.submitAt` is already on the snapshot and serves as the in-flight start anchor.)

The snapshot cache stays dispatch-driven — these fields update only on dispatch, so the [L02] stable-reference contract is preserved. The renderer pulls a stable snapshot via `useSyncExternalStore` + a separate live-tick value via the existing 1Hz tick store, and composes the live elapsed value.

**Pure helper.**

```typescript
// In code-session-store/telemetry.ts
export function deriveInflightActiveMs(
  snap: CodeSessionSnapshot,
  nowMs: number,
): number | null {
  // Returns null when no turn is in flight (no inflightUserMessage).
  // Otherwise: (nowMs - submitAt) − sum(closed accumulators)
  //                               − sum(currently-open segments measured to nowMs)
  // Clamped to 0.
}
```

**Pause-on-yellow correctness.** The derivation automatically produces the pause-on-yellow behavior because the same yellow conditions (awaiting_approval, transport=restoring, interruptInFlight) are exactly what open the three accumulator segments. The live clock pauses while any axis is open and resumes when it closes — no separate "is the indicator yellow" check needed. The indicator's tone-mapping and the clock's pause-mapping share one underlying mechanism, which is the cleanest expression of the rule.

**Tasks.**

- [ ] Add `interruptInFlightAccumulatedMs` + `interruptInFlightSegmentStartedAt` to the reducer state; open/close the segment in the dispatch paths that set/clear `interruptInFlight`.
- [ ] Verify the existing `awaitingApproval*` and `transportDowntime*` segments are exposed on the snapshot (some may already be; project the rest).
- [ ] Add the six snapshot fields listed above.
- [ ] Implement `deriveInflightActiveMs(snap, nowMs)` in `code-session-store/telemetry.ts`.
- [ ] Update existing tests that build a fake snapshot to include the new fields.

**Tests.**

- [ ] Pure-logic tests for `deriveInflightActiveMs` covering: no in-flight turn → null; in-flight, no segments open → wall-clock since submit; in-flight with one open segment → wall-clock − (now − segmentStart); multiple closed accumulators + one open segment → sum subtracted correctly; clamped-to-zero when accumulators sum past wall-clock.
- [ ] Reducer test for the interrupt accumulator: dispatch `interrupt` → segment opens; `turn_complete` → segment closes and accumulates.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] Snapshot is additively expanded — no existing field removed or renamed.
- [ ] Existing tests (`reducer.diagnostics.test.ts`, `reducer.awaiting-approval-accounting.test.ts`, etc.) updated to acknowledge the new fields where relevant.

---

#### Step 20.4.5.B: Gallery wiring for live updates — Time, Tokens, Context (gallery-only) {#step-20-4-5-b}

**Depends on:** #step-20-4-5-a

**Status:** _not started._

**Commit:** `feat(tide-rendering): gallery live updates for Time / Tokens / Context`

**References:** [L02], [L06]

**Scope.** Wire the gallery's four-area row to update live during an in-flight turn. `Time` consumes `deriveInflightActiveMs(snap, nowMs)` — the clock ticks up at 1Hz from submit, pauses on yellow axes automatically, freezes at turn-complete with the committed `activeMs`, resets to 0 on the next submit. `Tokens` updates from the in-flight per-turn token sum (live). `Context` updates from the in-flight per-turn context-size derivation.

**Tasks.**

- [ ] Update gallery composition to use `deriveInflightActiveMs` for the `Time` cell value.
- [ ] Wire `Tokens` to the in-flight per-turn token sum (live).
- [ ] Wire `Context` to the in-flight per-turn context size (live).
- [ ] Add a gallery scenario that simulates an in-flight turn so the live behavior is HMR-vettable.

**Tests.**

- [ ] Pure-logic test confirming the gallery's value-derivation functions return the expected formatted strings for representative snapshot + tick combinations.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] HMR-vet: live clock ticks on green states, pauses on yellow states, freezes at turn-complete.
- [ ] Pause-on-yellow visually matches the indicator's tone.

---

#### Step 20.4.6: Popover substrate — hover-affordance, click-to-open (gallery) {#step-20-4-6}

**Depends on:** #step-20-4-2 (gallery indicator is the first anchor candidate, though popovers can be exercised against any status cell); foundational for 20.4.7 + 20.4.9.

**Status:** _not started._

**Commit:** `feat(tugways): TugPopover substrate (if missing) + status-cell anchor pattern`

**References:** [L02], [L06], [L13], [L14], [L19], [L20], [D05]

**Scope.** Audit `tugways/` for an existing popover primitive; if missing, wrap Radix Popover (mirroring how `TugTooltip` wraps Radix Tooltip — per the [L14] guidance in `component-authoring.md` that Radix-managed enter/exit uses CSS keyframes + `[data-state]`). Establish the open/close contract: hover gives a cursor / hover-class affordance hint (no popover open), click opens, re-click closes, outside-click closes, Esc closes. Document the status-cell anchor pattern that 20.4.7 + 20.4.9 will reuse.

**Tasks.**

- [ ] Audit `tugways/` for an existing popover primitive; verify whether one exists.
- [ ] If absent: implement `TugPopover` per `component-authoring.md` (file pair, docstring, props with `@selector` annotations, `data-slot`, `forwardRef`, `@tug-pairings`, CSS keyframes on `[data-state]` per [L14]).
- [ ] Document the hover-affordance + click-to-open + Esc/outside-close contract.
- [ ] Inspect `tug-dev-panel/`'s log-format conventions to derive a shared visual language the per-area popovers can adopt for their per-row layout.

**Tests.**

- [ ] Pure-logic tests for the open/close state machine (where applicable; Radix Presence handles the DOM lifecycle per [L14]).
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] Gallery card includes a scratch popover example so the substrate's open/close behavior is HMR-vettable before any per-area popover content is built.

---

#### Step 20.4.7: Per-area popover designs — Time, Tokens, Context (gallery) {#step-20-4-7}

**Depends on:** #step-20-4-6

**Status:** _not started._

**Commit:** `feat(tide-rendering): gallery popovers for Time / Tokens / Context`

**References:** [L02], [L06], [L19], [L20]

**Scope.** Three popovers, all anchored on their respective status cells. Each shows a per-request log (one row per committed turn) plus a summary footer.

- **`Time` popover** — log of times for each request/response, with terminal-state badge per row; summary footer: number of requests, total time, average time per request/response.
- **`Tokens` popover** — log of token usage per request/response, terminal-state badge per row; summary footer: number of requests, total tokens, average tokens per request/response.
- **`Context` popover** — large `TugArcGauge` with a breakdown of tokens used, redesigned for graphical UI display (re-imagined from Claude Code's terminal-UI `/context` display). Categories: input, cache-read, cache-creation, output, plus the unused remainder relative to the context max.

Visual language pulled from `tug-dev-panel/`'s log format (mono font, tight row-density, tabular numerics, terminal-state badges as small chips).

**Tasks.**

- [ ] `Time` popover: row list + summary; pure-logic helper to compute summary stats from `transcript[]`.
- [ ] `Tokens` popover: row list + summary; pure-logic helper for totals + average.
- [ ] `Context` popover: arc-gauge composition + breakdown legend; pure-logic helper for category breakdown from `transcript[last]`.
- [ ] Gallery card adds a controlled-scenario picker so the popovers render against representative session shapes (fresh, deep, near-cap, etc.).

**Tests.**

- [ ] Pure-logic tests for each helper (`computeTimeSummary`, `computeTokensSummary`, `computeContextBreakdown`) against synthetic transcripts.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] HMR-vet all three popovers against multiple scenarios.
- [ ] If the `Context` popover's re-imagining proves substantively heavier than the other two, split into 20.4.7.A / 20.4.7.B / 20.4.7.C and re-checkpoint each separately.

---

#### Step 20.4.8: SQLite session_state_changes ledger (cross-crate) {#step-20-4-8}

**Depends on:** none — substrate; consumed by 20.4.9. The store-side writer can land in parallel with the gallery-side popover work in 20.4.6 / 20.4.7.

**Status:** _not started._

**Commit:** `feat(tugbank+code-session): session_state_changes ledger`

**References:** [L02], [L23], [D46] (Tugbank SQLite shape), [D48] (HTTP bridge for tugbank reads), [#step-20-3-4] (SessionLedger precedent)

**Scope.** Cross-crate. Add a `session_state_changes` table to the sqlite session ledger that persists every distinct `(phase, transportState, interruptInFlight)` triple transition for a given `tugSessionId`. Writer dedupes: if the new triple equals the most recent row for the session, no row is written. Retention is unbounded per session. Rows are deleted when the parent session is deleted (`ON DELETE CASCADE` or app-level equivalent). Expose a reader API to tugdeck via the same bridge pattern the rest of tugbank uses.

**Schema (provisional).**

```sql
CREATE TABLE session_state_changes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tug_session_id      TEXT NOT NULL,                       -- FK to sessions
  at_ms               INTEGER NOT NULL,                    -- wall-clock ms
  phase               TEXT NOT NULL,                       -- CodeSessionPhase enum string
  transport_state     TEXT NOT NULL,                       -- TransportState enum string
  interrupt_in_flight INTEGER NOT NULL,                    -- 0 / 1
  FOREIGN KEY (tug_session_id) REFERENCES sessions(tug_session_id)
    ON DELETE CASCADE
);
CREATE INDEX idx_ssc_session_at ON session_state_changes (tug_session_id, at_ms);
```

**Writer (tugdeck side).** Hook into `CodeSessionStore.dispatch`. After `reduce()` runs and the snapshot cache invalidates, compare `(prev.phase, prev.transportState, prev.interruptInFlight)` to the new state's triple; if any axis changed, POST a write to the bridge endpoint. The dedupe at the SQL layer is a safety net for races.

**Reader (tugdeck side).** New typed API: `loadSessionStateChanges(tugSessionId): Promise<ReadonlyArray<{ at: number; phase: CodeSessionPhase; transportState: TransportState; interruptInFlight: boolean }>>`. Used by 20.4.9's popover.

**Tasks.**

- [ ] Add the table + index migration to the tugbank crate. Verify `ON DELETE CASCADE` works with the existing session-delete path; fall back to app-level cleanup if rusqlite does not enable cascades by default.
- [ ] Implement the writer: bridge endpoint + tugdeck-side client + hook in `code-session-store.ts`'s dispatch.
- [ ] Implement the reader: bridge endpoint + tugdeck-side client.
- [ ] Idle↔idle dedupe: skip the write if the new triple equals the most recent persisted triple for the session.

**Tests.**

- [ ] Rust-side: dedupe semantics, retention, `ON DELETE CASCADE`.
- [ ] Tugdeck-side: writer fires on triple change, skips on no-change.
- [ ] `cargo nextest run` green.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.

**Checkpoint.**

- [ ] Manual verification: open a tide card, drive through several state transitions, verify the rows accumulate in sqlite via `tug-dev-panel` or a direct DB query.
- [ ] Manual verification: delete a session, confirm `session_state_changes` rows for that session are gone.

---

#### Step 20.4.9: `TugStateIndicator` state-change log popover (gallery) {#step-20-4-9}

**Depends on:** #step-20-4-6 (popover substrate), #step-20-4-8 (state-change ledger)

**Status:** _not started._

**Commit:** `feat(tide-rendering): gallery TugStateIndicator state-change log popover`

**References:** [L02], [L06], [L19], [L20]

**Scope.** Popover anchored on the gallery's `TugStateIndicator`. Renders a scrolling, timestamped log of every persisted state change for the current session (most recent in view). Reads from 20.4.8's reader API via a `useSyncExternalStore`-shaped wrapper. Uses the visual language established by 20.4.7 + the tug-dev-panel log inspector.

**Tasks.**

- [ ] Gallery popover renders the log; auto-scrolls so the most-recent entry is in view.
- [ ] Each row: `[at-ms formatted as HH:MM:SS.mmm] · [phase] · [transportState] · [interrupt: yes/no]` (final row layout settled during gallery iteration).
- [ ] Live updates: when a new state-change lands, the popover (if open) appends the new row and re-scrolls if the user has not scrolled away.

**Tests.**

- [ ] Pure-logic tests for the row-formatting helper.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] HMR-vet against a multi-transition session.

---

#### Step 20.4.10: Promote polished gallery design into production tide-card {#step-20-4-10}

**Depends on:** #step-20-4-1 through #step-20-4-9

**Status:** _not started._

**Commit:** `feat(tide-rendering): promote 20.4.x gallery design into production`

**References:** [L02], [L06], [L19], [L20], [L26]

**Scope.** Wire the polished gallery design into the production `tide-card-telemetry-renderers.tsx`. Production switches to `TugStateIndicator` (with label, animation handoff, all four popovers). Production CSS adopts the four-cell layout. Wires live updates to production. The inline indicator implementation in production is deleted (replaced by the `TugStateIndicator` component).

**Tasks.**

- [ ] Replace the inline indicator in production with `TugStateIndicator`, including label + popover.
- [ ] Remove `Total Time` / `Total Tokens` cells from the production `TideTelemetryStatusRow` and rebalance the four-cell layout.
- [ ] Wire live `Time` / `Tokens` / `Context` to the production renderer via the same `deriveInflightActiveMs` helper and live-tick subscription used in the gallery.
- [ ] Wire the four popovers (Time, Tokens, Context, state-change log) to production status cells.
- [ ] Update the Step 20.4 parent status line in this plan file to record completion of the 20.4.x follow-on series.

**Tests.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.

**Checkpoint.**

- [ ] HMR-vet the production tide-card matches the gallery's plan-of-record in every interactive dimension (live clock, pause-on-yellow, label position, four popovers, state-change log).
- [ ] Step 20.4 (parent) is closed in `roadmap/tide-assistant-turns.md`.

---

#### Step 20.5: Lifecycle coordination + Z5 + drill-down — split into four sub-steps {#step-20-5}

**Depends on:** #step-20-4 (slot infrastructure + placement decisions from the HMR study)

**Status:** _not started — split into 20.5.A → 20.5.B → 20.5.C → 20.5.D → 20.5.E, gated sequentially._

**Scope overview.** [#step-20-4] establishes the placement zones (Z0–Z4) as display-only slots and decides default content via HMR study. Step 20.5 closes the tide-card request/response lifecycle: it documents the state machine that drives everything (20.5.A), audits and closes gaps against polish-plan Steps 13 / 14 / 15 (20.5.B), studies and adds the `agent` role to `TugProgress` for Z1's SUBMITTING-state immediate-feedback indicator (20.5.C), wires Z5 + cross-zone lifecycle coordination + the chosen telemetry placement defaults (20.5.D), and ships the on-demand `/context`-style drill-down surface (20.5.E).

The five sub-steps are gated sequentially: 20.5.A is the spec that everything else references; 20.5.B closes pre-existing gaps so downstream work builds on working primitives; 20.5.C does the small primitive prep (TugProgress agent role + variant study); 20.5.D is the big lifecycle implementation; 20.5.E layers the drill-down on top.

**References:** [#step-20-3] (data model), [#step-20-4] (slot infrastructure + study outcome), [polish-plan #step-13](./tugplan-tide-card-polish.md#step-13), [polish-plan #step-14](./tugplan-tide-card-polish.md#step-14), [polish-plan #step-15](./tugplan-tide-card-polish.md#step-15), [L02], [L23], [L26]

---

#### Step 20.5.A: Lifecycle map — state machine + zone coordination matrix (spec only) {#step-20-5-a}

**Depends on:** none — pure documentation step.

**Status:** _not started._

**Commit:** `plan(tide-rendering): lifecycle state machine + Z0–Z5 coordination matrix`

**References:** [#step-20-3] (data fields the matrix references), [#step-20-4] (zone catalog)

**Scope.** Document the canonical state machine that governs the tide-card request/response lifecycle, plus the state-to-zone coordination matrix that 20.5.D will implement against. This step lands the spec into the plan itself; no code, no tests. The diagram + matrix below ARE the deliverable.

**The state diagram.**

```
            ┌──────┐
            │ IDLE │ ← phase=idle, transcript may have prior turns
            └──┬───┘
               │ user submits
               ▼
        ┌────────────┐
   ┌────│ SUBMITTING │── phase=submitting; send frame in flight ──┐
   │    └─────┬──────┘                                            │
   │          │ send acknowledged                                 │
   │          ▼                                                   │
   │   ┌────────────────────┐                                     │
   │   │ AWAITING_FIRST_    │ ← phase=awaiting_first_token        │
   │   │       TOKEN        │   (post-send, pre-first-token —     │
   │   └─────┬──────────────┘    where Z1 TugProgress shows)      │
   │         │ first assistant_delta                              │
   │         ▼                                                    │
   │   ┌─────────────┐                                            │
   │   │  STREAMING  │◄────── tool_result ────────────────┐       │
   │   └─┬──────┬────┘                                    │       │
   │     │      │                                         │       │
   │     │ tool_use                                       │       │
   │     ▼      │                              ┌───────────┐      │
   │ ┌───────────┐      ctrl_req_              │ TOOL_WORK │      │
   │ │ TOOL_WORK │──────forward──┐             └───────────┘      │
   │ └───────────┘               │                                │
   │                             ▼                                │
   │             ┌────────────────┐                               │
   │             │ AWAITING_USER  │                               │
   │             │ (perm OR qstn) │── allow/deny/answer ──────────┤
   │             └────────────────┘   (resume STREAMING or        │
   │                  │                TOOL_WORK above)           │
   │                  │                                           │
   │                  │ in-dialog Esc / cancel button =           │
   │                  │ DIALOG DISMISS only (not turn cancel)     │
   │                  │ → equivalent to deny/cancel response      │
   │                  │ → lifecycle resumes                       │
   │                  │                                           │
   ├── CANCEL TRIGGER: Esc (no overlay foregrounded)               │
   │                   OR Stop button click                       │
   │                   from { SUBMITTING, AWAITING_FIRST_TOKEN,   │
   │                          STREAMING, TOOL_WORK }              │
   │                   (NOT reachable from AWAITING_USER — see    │
   │                   [DT07]; NOT reachable from REPLAYING /     │
   │                   ERRORED — terminal-with-context states)    │
   ▼                                                              │
   ┌────────────────┐                                             │
   │  INTERRUPTING  │ ← interrupt frame in flight; brief transient│
   │ (Z5 "Stopping…"│   (interruptInFlight === true)              │
   │  disabled)     │                                             │
   └────────┬───────┘                                             │
            │ turn_complete (reason="interrupted")                │
            ▼                                                     │
   ┌─────────────────────────────────┐                            │
   │           COMPLETE              │ ← phase=idle               │
   │ TurnEntry frozen, turnEndReason:│   AND transcript appended  │
   │   "complete"                    │ ← normal STREAMING done    │
   │   "interrupted"                 │ ← from INTERRUPTING above  │
   │   "error"                       │ ← protocol error mid-turn  │
   │   "transport_lost"              │ ← transport gone at end    │
   └──────────────┬──────────────────┘                            │
                  │ user submits next                             │
                  └─────────► (back to SUBMITTING) ───────────────┘

  Parallel-terminal-with-context states (NOT routed through COMPLETE;
  the session is in a persistent non-ready state):
    ┌───────────┐   phase=replaying; reducer reconstructing committed
    │ REPLAYING │   turns from past frames after transport reconnect.
    │  (Z5      │   Brief but visible. Cleared automatically when
    │  disabled)│   replay completes → IDLE / COMPLETE as appropriate.
    └───────────┘
    ┌───────────┐   phase=errored; session has a sticky error
    │  ERRORED  │   (lastError populated). Persists until user clears
    │  (Z5      │   or resubmits. Distinct from COMPLETE because no
    │  disabled)│   clean TurnEntry was committed.
    └───────────┘

  Note: ERRORED is BOTH a reducer phase (phase=errored, sticky) AND a
  possible turnEndReason value on COMPLETE (when an error mid-turn
  still produced a partial TurnEntry committed to transcript). These
  are distinct: the phase is the session state; the reason is per-turn.
  TRANSPORT_LOST is only a turnEndReason value — not a separate phase
  (the reducer uses phase=errored or phase=idle plus transportState
  for the session state during loss).

  Overlay states (orthogonal — can apply during any non-IDLE state):
    • TRANSPORT_DOWN     ← transportState ∈ {"offline", "restoring"}
                           (BOTH count as downtime — wire-up-but-binding-
                            not-yet-re-ack'd is unusable too)
    • QUEUED_NEXT_TURN   ← queuedSends > 0
                           (user typed + submitted during STREAMING/
                            TOOL_WORK; queued for auto-flush on idle)
    • DRILLDOWN_OPEN     ← user opened the /context-style breakdown
                           (Esc closes the sheet, not the turn — DT07)
```

**State definitions.** Signals refer to the actual `CodeSessionPhase` enum (`types.ts:32` — `idle | submitting | awaiting_first_token | streaming | tool_work | awaiting_approval | replaying | errored`) and the snapshot's existing fields (`pendingApproval`, `pendingQuestion`, `transportState`, `inflightUserMessage`, `queuedSends`, plus the new `interruptInFlight` from [Step 20.3](#step-20-3)):

| State | Entry condition | Reducer signal |
|---|---|---|
| IDLE | No active turn. Initial state and the steady state after each COMPLETE until the user submits again. | `phase === "idle"` AND `interruptInFlight === false` |
| SUBMITTING | User pressed Enter; `send` frame in flight; no events received yet. | `phase === "submitting"` |
| AWAITING_FIRST_TOKEN | Send acknowledged by supervisor; awaiting Claude's first response token. **This is where Z1's TugProgress spinner ([Step 20.5.C](#step-20-5-c)) shows.** | `phase === "awaiting_first_token"` |
| STREAMING | First `assistant_delta` arrived; response body streaming. | `phase === "streaming"` |
| TOOL_WORK | `tool_use` sent; awaiting `tool_result`. | `phase === "tool_work"` |
| AWAITING_USER | `control_request_forward` arrived; awaiting Allow/Deny (permission) or answer (question). | `phase === "awaiting_approval"` (canonical) — equivalently `pendingApproval !== null \|\| pendingQuestion !== null` |
| INTERRUPTING | User clicked Stop or Esc; `interrupt` frame in flight; awaiting `turn_complete`. Brief transient. | `interruptInFlight === true` |
| REPLAYING | After a transport reconnect, reducer is reconstructing committed turns from past frames. Z5 disabled. | `phase === "replaying"` |
| ERRORED | Sticky session error (`lastError` populated). Distinct from COMPLETE+turnEndReason="error" — this is a session-level error state, not a per-turn one. Persists until user resubmits. | `phase === "errored"` |
| COMPLETE | Just-finished turn; `TurnEntry` frozen onto transcript. Same `phase === "idle"` as IDLE but the just-frozen turn drives Z1 final-metrics display. | `phase === "idle"` AND `transcript.length > 0` AND `interruptInFlight === false` |
| TRANSPORT_DOWN (overlay) | Wire not usable. Can apply during any non-IDLE state; covers BOTH `offline` (no wire) AND `restoring` (wire back, binding not re-ack'd). | `transportState !== "online"` |
| QUEUED_NEXT_TURN (overlay) | User submitted a second prompt while a turn was in flight; queued for auto-flush on idle. | `queuedSends > 0` |
| DRILLDOWN_OPEN (overlay) | User opened the `/context`-style breakdown via the Z2 affordance. | UI-local state (not reducer-tracked; merged into the lifecycle snapshot by `deriveLifecycleSnapshot` per [DT08](#dt08-lifecycle-snapshot-merges-ui-state)) |

**The state-to-zone coordination matrix.** What each zone shows / does in each state. This is the contract [Step 20.5.D](#step-20-5-d) implements:

| State | Z0 (top of card) | Z1 (per-turn trailing — asst half) | Z2 (status bar) | Z3 (prompt-entry top) | Z4 (prompt-entry footer) | Z5 (submit button) |
|---|---|---|---|---|---|---|
| IDLE | reserved | n/a (no current turn) | session cumulative totals (frozen) | project badge | (default content per 20.4 study) | **Submit** (disabled if prompt empty) |
| SUBMITTING | reserved | TugProgress agent (chosen variant per [#step-20-5-c]) | live cum + this-turn elapsed (ticking via [useLifecycleTick](#step-20-3)) | project badge | (default) | **Stop** |
| AWAITING_FIRST_TOKEN | reserved | TugProgress agent (chosen variant per [#step-20-5-c]) | live cum + this-turn elapsed (ticking) | project badge | "Awaiting first token" indicator | **Stop** |
| STREAMING | reserved | per-turn live elapsed (ticking) | live cum + this-turn elapsed + window util (ticking) | project badge | "Claude is thinking" indicator | **Stop** |
| TOOL_WORK | reserved | per-turn live elapsed + tool name (ticking) | live cum + this-turn elapsed (ticking) | project badge | "Running {tool_name}" | **Stop** |
| AWAITING_USER | reserved | per-turn elapsed paused (clock frozen) | live cum (frozen during pause) + "awaiting input" badge | project badge | (default) | **"Awaiting your input"** (disabled) |
| INTERRUPTING | reserved | per-turn elapsed frozen | live cum frozen | project badge | (default) | **"Stopping…"** (disabled, transient) |
| REPLAYING | reserved | (per-turn metrics on already-committed rows, populating as replay reconstructs them) | "Restoring session…" badge replaces live counts | project badge | (default) | **"Restoring…"** (disabled) |
| ERRORED | reserved | per-turn final metrics (for any partially-committed turn) | "Session error: {lastError.cause}" badge | project badge | (default) | **Submit** (enabled — user may retry; submit clears the error per current reducer semantics) |
| COMPLETE | reserved | per-turn final metrics | session cum totals (frozen, includes this turn) | project badge | (default) | **Submit** |
| TRANSPORT_DOWN (overlay) | reserved | (whatever was there, frozen) | "Disconnected — reconnecting" badge replaces live counts | project badge | (default) | **"Reconnecting…"** (disabled). When `transportState === "restoring"`, label is "Reconnecting…" too (the binding ack is part of the reconnect); when `"offline"`, label is "Reconnecting…" (we don't expose the offline/restoring distinction to the user — both are "session unusable"). |
| QUEUED_NEXT_TURN (overlay) | reserved | (current turn's live indicator) | (current turn's live counts) | project badge | (default) | Submit visually marked "will send on idle" |
| DRILLDOWN_OPEN (overlay) | reserved | dimmed | dimmed | dimmed | dimmed | dimmed (drill-down surface is the focus) |

**Matrix-edit policy.** [Step 20.5.C](#step-20-5-c) updates this matrix to substitute the chosen concrete TugProgress variant (`kind="spinner"` vs. `kind="ring"`) for the placeholder text "TugProgress agent (chosen variant per [#step-20-5-c])" in the SUBMITTING and AWAITING_FIRST_TOKEN rows. No other matrix changes happen there.

**Two coordination invariants exposed by the matrix.**

1. **The `awaitingApprovalSince` / `awaitingApprovalMs` state from [#step-20-3] drives three coordinated UI surfaces simultaneously** — Z1's "⏳ paused," Z2's "frozen during pause + awaiting badge," and Z5's "Awaiting your input" disabled mode. Same state field, three zones coordinated. This is the direct validator that the 20.3 data model is correctly shaped — if any of these three lag or de-sync, the data plumbing is wrong.
2. **`turnEndReason` from [#step-20-3] drives the terminal branch into COMPLETE.** `"complete" | "interrupted" | "error" | "transport_lost"` each map to distinct visual affordances on the row (e.g., a small "🛑 interrupted" badge for interrupted turns).

**Why this is a spec-only step.** The diagram + matrix are load-bearing for every implementation sub-step that follows. Landing them as the deliverable here means 20.5.B / 20.5.C / 20.5.D / 20.5.E all reference a single canonical artifact rather than re-deriving the lifecycle from scratch. The cost of a misaligned mental model across four implementation sub-steps is enormous; the cost of writing this down once is small.

**Conformance.** No code. The deliverable is the diagram + matrix + state definitions, landed into this plan. The commit is documentation only.

**Tasks.**

- [ ] Land the state diagram (above) into the plan as the canonical reference.
- [ ] Land the state-to-zone coordination matrix (above) as the contract for 20.5.D.
- [ ] Cross-reference [#step-20-3]'s `awaitingApprovalMs` / `turnEndReason` fields from the matrix.

**Checkpoint.** No build/test/lint — this is plan-only.

---

#### Step 20.5.B: Audit polish-plan 13 / 14 / 15 + close known gaps {#step-20-5-b}

**Depends on:** #step-20-5-a (spec to audit against)

**Status:** _not started._

**Commit:** `feat(tide-rendering): close lifecycle-primitive gaps from polish-plan 13/14/15 (incl. question dialog)`

**References:** [polish-plan #step-13](./tugplan-tide-card-polish.md#step-13), [polish-plan #step-14](./tugplan-tide-card-polish.md#step-14), [polish-plan #step-15](./tugplan-tide-card-polish.md#step-15), [#step-20-5-a]

**Scope.** Walk the current code against polish-plan Steps 13 (thinking + tool surfaces), 14 (mid-stream behaviors), and 15 (`control_request_forward` UI). Document what's done; identify gaps; close the gaps so 20.5.D builds on working primitives. Known gap from the preliminary audit: `tide-question-dialog` (only the permission variant has a chrome wrapper today).

**Audit checklist** (each item gets a ✓ if implemented, ✗ + remediation task if not):

- [ ] **[polish-13]** Thinking-block placement / streaming wired (`chrome/tide-thinking-block.tsx` exists — confirm it's actually consumed by `tide-card.tsx` and streams correctly).
- [ ] **[polish-13]** Tool-use-display wired in the transcript (assistant rows show tool calls inline; tool_use / tool_result paired correctly).
- [ ] **[polish-14.1]** Stop button works mid-stream (`handleInterrupt` exists in reducer; confirm UI affordance and `turnEndReason === "interrupted"` set correctly via [#step-20-3]).
- [ ] **[polish-14.2]** Queued sends — user can type + submit during STREAMING; the second turn auto-flushes on idle.
- [ ] **[polish-14.3]** Tool sub-state — submit button stays in "Stop" mode during tool_use; entry remains in `tool_work`.
- [ ] **[polish-14.4]** No regressions on basic round-trip.
- [ ] **[polish-15] permission variant** — `chrome/tide-permission-dialog.tsx` exists; confirm it's mounted in `tide-card.tsx` when a permission `control_request_forward` arrives.
- [ ] **[polish-15] question variant** — `chrome/tide-question-dialog.tsx` does NOT exist. **Gap to close.** Build it as a sibling chrome wrapper around `TugInlineDialog`, parallel to the permission variant. Wires to existing `handleRespondQuestion` reducer handler. Supports single-select and multi-select question payloads.

**Gap-close work** (only if audit marks items ✗):

1. **`tide-question-dialog`** — new file `tugdeck/src/components/tugways/chrome/tide-question-dialog.tsx` + `.css` + `.test.ts`. Renders question + options (single-select via radio-equivalent, multi-select via checkboxes per the payload's `is_multi_select` flag). Submitting writes a `question_answer` frame via `handleRespondQuestion`. Keyboard: arrow keys move selection, Enter submits, Esc cancels (dismiss).
2. **`tide-card.tsx`** wires both dialog variants on the in-flight `control_request_forward` — permission and question both render inline in the in-flight row.
3. **Coverage tests** for any polish-14 scenario that audits ✗ — fixture tests for Stop / queued sends / tool sub-state, against the reducer + UI together.

**Conformance.** Build only on existing primitives. No new architecture in this step — it's a known-gap-closer, not a redesign. The lifecycle state machine from 20.5.A defines the target behavior; this step ensures the primitives behind that behavior actually exist before 20.5.D wires coordination on top.

**Artifacts.**

- _(conditional)_ `tugdeck/src/components/tugways/chrome/tide-question-dialog.{tsx,css}` + `.test.ts` — if audit marks polish-15 question variant ✗.
- _(conditional)_ `tugdeck/src/components/tugways/cards/tide-card.tsx` — wire the question dialog (and verify permission dialog wiring) for in-flight `control_request_forward`.
- _(conditional)_ `tugdeck/src/components/tugways/cards/__tests__/tide-card.test.tsx` — coverage tests for any polish-14 ✗ scenarios.
- `roadmap/tide-assistant-rendering.md` (this file) — append audit findings to this step's status line for the historical record.

**Tasks.**

- [ ] Walk the audit checklist; mark each item ✓ / ✗.
- [ ] For each ✗, write a remediation task and complete it.
- [ ] Specifically: implement `tide-question-dialog` (almost certainly an ✗).
- [ ] Verify `tide-card.tsx` mounts both dialog variants when `awaitingApprovalSince !== null` for the in-flight turn.
- [ ] Add coverage tests for any polish-14 scenario found ✗.

**Tests.**

- [ ] `tide-question-dialog` fixture-renders correctly for single-select and multi-select payloads.
- [ ] Submitting question dialog dispatches `handleRespondQuestion` with the chosen answer(s).
- [ ] Esc / cancel dismisses the question dialog and triggers the dismiss path (equivalent to denial in semantics).
- [ ] Any polish-14 scenario marked ✗ gets a fixture test that exercises the scenario end-to-end.

**Checkpoint.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.
- [ ] **Manual smoke** — exercise each polish-14 scenario by hand against live Claude; confirm permission AND question dialogs both fire and resolve cleanly.

---

#### Step 20.5.C: `TugProgress` `agent` role + Z1 SUBMITTING-state variant study {#step-20-5-c}

**Depends on:** #step-20-5-a (matrix this step updates), #step-20-5-b (primitives working)

**Status:** _not started._

**Commit:** `feat(tugways): TugProgress agent role + Z1 SUBMITTING-state variant study`

**References:** [L17], [L19], [L20], [#step-20-5-a] (matrix Z1 SUBMITTING row to be updated), [#step-20-5-d] (downstream wiring consumer)

**Scope note — why this step exists.** Today, when a user submits a prompt, an empty assistant entry is added immediately to the transcript and stays blank until the first `assistant_delta` arrives. That gap reads as "nothing is happening" — the user has no immediate signal that the system received the prompt and is working on it. [Step 20.5.A](#step-20-5-a)'s matrix specifies a "⏳ ticking" placeholder for Z1 asst-half during SUBMITTING and early-STREAMING, but the placeholder needs to be replaced with a concrete visual primitive: `TugProgress` with the `agent` role. The component already ships (gallery card exists with Spinner / Bar / Ring / Pie variants in both indeterminate and determinate modes), but the role set today is accent / action / success / danger — missing `agent`, which is the semantically correct role for "the assistant is working."

This step does three things:

1. **Primitive change — add `agent` role to TugProgress.** Mirror `TugBadge`'s agent role. New `--tugx-progress-fill-agent-color` slot in `tug-progress.css` body{}, one-hop alias to `--tug7-*` per [L17]. The role-driven color machinery already exists for the four current roles; adding a fifth is mechanical.
2. **Variant study — pick the right TugProgress shape for Z1.** Z1 asst-half is a small inline slot at the trailing edge of the assistant row's chrome (next to the copy button). Two candidates to compare empirically in the gallery: **spinner indeterminate** (most compact, classic "loading" feel) and **ring indeterminate** (compact, slightly more visual presence). **Bar indeterminate** is ruled out for Z1 footprint reasons. Pick the winner via HMR / gallery visual review. Document the choice + rationale in this step's status line.
3. **Matrix update.** Replace the placeholder "⏳ ticking" / "⏳ frozen" text in [Step 20.5.A](#step-20-5-a)'s state-to-zone matrix Z1-asst-half column with the concrete `TugProgress variant="{chosen}" role="agent"` spec. The actual zone wiring lands in [Step 20.5.D](#step-20-5-d); this step just makes the matrix authoritative so 20.5.D has no more decisions to make.

**Scope note — what this step does NOT do.** No `tide-card-transcript.tsx` changes. No `TideCard` changes. No `useLifecycleState` integration. All Z1 wiring is [Step 20.5.D](#step-20-5-d)'s scope — this step is preparation only. The TugProgress primitive change and the variant choice are the only deliverables.

**Scope note — broader role parity (deferred).** TugProgress currently has accent / action / success / danger. TugBadge has those plus agent / data / caution. This step adds only `agent` (the role we have a concrete consumer for). The remaining role gaps (data, caution) are not added here; they can land in subsequent component-library work when there's a concrete need. Speculative role additions age poorly.

**Conformance.** Tugways primitive role addition — `tuglaws/component-authoring.md` + [L17] (one-hop alias) + [L20] (token sovereignty: `--tugx-progress-fill-agent-color` is part of TugProgress's slot family). [L16] applies: the new `[data-role="agent"]` CSS rule sets `background-color` only (no `color` paired in the same rule), so it requires a `@tug-renders-on` annotation naming TugProgress's track surface. [L19] applies to the gallery card extension: maintain the existing `data-slot` / file-pair / docstring discipline. Gallery card extension follows the existing ROLES section pattern.

**[L23] / [L26] note for the downstream consumer.** The chosen TugProgress variant lives inside Z1's per-turn trailing slot during SUBMITTING / AWAITING_FIRST_TOKEN, then is REPLACED by per-turn metrics on COMPLETE. That content-swap-within-slot must happen INSIDE THE SAME slot DOM container, not by remounting the parent row chrome — otherwise the assistant row's focus / scroll position / hover state would be destroyed at every turn boundary. The actual wiring lands in [Step 20.5.D](#step-20-5-d); this note is a forward reminder of the constraint that affects how the slot is built there.

**Artifacts.**

- `tugdeck/src/components/tugways/tug-progress.css` — new `--tugx-progress-fill-agent-color` slot declared in `body{}`; new `[data-role="agent"]` rule that paints the fill with the agent color. One-hop alias to a `--tug7-*` base token (likely the same base token TugBadge's agent role uses, for visual consistency).
- `tugdeck/src/components/tugways/tug-progress.tsx` — extend the `role` prop's accepted union with `"agent"`. No structural changes.
- `tugdeck/src/components/tugways/cards/gallery-tug-progress.tsx` — extend the ROLES section to include the agent row (alongside accent / action / success / danger).
- `roadmap/tide-assistant-turns.md` (this file) — update [Step 20.5.A](#step-20-5-a)'s matrix Z1-asst-half column to specify the chosen TugProgress variant + role="agent". Update [DT06](#dt06-naming-glossary) to add a glossary entry for the new TugProgress role.

**Tasks.**

- [ ] **Add `agent` role to TugProgress** — slot declaration in body{}; `[data-role="agent"]` rule; type union extension.
- [ ] **Extend gallery card** — add the agent row to the ROLES section so visual review of the new role is possible.
- [ ] **Variant study (manual, HMR + gallery)** — visually compare `<TugProgress kind="spinner" indeterminate role="agent" />` vs. `<TugProgress kind="ring" indeterminate role="agent" />` at Z1's expected size (~16–20px). Pick one. Record the choice + a one-sentence rationale in this step's status line.
- [ ] **Matrix update** — replace the Z1 asst-half placeholder text in 20.5.A's matrix for the SUBMITTING and STREAMING rows (and any other row where pre-content indication applies) with the concrete `TugProgress` spec from the study.
- [ ] **Glossary update** — add a row to [DT06](#dt06-naming-glossary) for the TugProgress agent-role consumer.

**Tests.**

- [ ] `TugProgress` with `role="agent"` renders without warnings and without missing tokens in both `brio` and `harmony` themes.
- [ ] Gallery card's ROLES section includes the agent row.
- [ ] (No matrix-wiring tests here — those land in [Step 20.5.D](#step-20-5-d).)

**Checkpoint.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.
- [ ] **HMR study (manual)** — open `gallery-tug-progress`; visually compare the agent-role variants (spinner and ring, both indeterminate) at Z1's expected scale; pick the winner; record the choice in this step's status line and update 20.5.A's matrix.

---

#### Step 20.5.D: Z5 + lifecycle-coordinated zone content (ship the matrix) {#step-20-5-d}

**Depends on:** #step-20-5-a (matrix spec), #step-20-5-b (primitives working), #step-20-5-c (TugProgress agent-role variant chosen for Z1), #step-20-4 (slot infrastructure + chosen telemetry placement defaults), [#step-20-3-4] (telemetry persistence implementation — without this the shipped placements would read zero across HMR / Reload / app relaunch, violating [L23]; the design is in [#step-20-3-3])

**Status:** _not started._

**Commit:** `feat(tide-rendering): Z5 submit-button state machine + cross-zone lifecycle coordination`

**References:** [#step-20-5-a] (the matrix this step implements), [#step-20-3] (data fields driving the coordination), [#step-20-4] (zones being coordinated), [L02], [L06], [L23], [L26]

**Scope.** Implement the state-to-zone coordination matrix from 20.5.A. Three layers of work:

1. **Z5 submit-button state machine.** Wire the lifecycle state (`phase`, `pendingApproval`, `pendingQuestion`, `transportState`, `interruptInFlight`, `queuedSends`) to the submit button's label / disabled state / visual treatment. New modes from the matrix: `"Awaiting your input"`, `"Stopping…"`, `"Reconnecting…"`, `"Restoring…"`, plus the "will send on idle" queued-visual on the default Submit. Same state machine drives keyboard activation semantics (e.g., disabled states don't fire on Enter).
2. **Cross-zone coordination.** The same lifecycle state drives Z2's status-bar transitions (live → frozen during awaiting → frozen at complete), Z1's per-turn ⏳ indicators (ticking / paused / final), and any phase-driven affordances elsewhere. The coordination is encoded once as a small `useLifecycleState()` hook that returns the current matrix-row's values; each zone's renderer reads from it via `useSyncExternalStore` per [L02].
3. **Ship the chosen telemetry placement defaults** from 20.4's HMR study. The default mapping of `{datum → zone}` lands as the production content of each zone. The dev-mode experimentation harness stays behind `import.meta.env.DEV` for future iteration.

**Design — the `useLifecycleState` hook.** Sketch:

```typescript
// lib/code-session-store/lifecycle-state.ts (new module)

export type TideLifecycleState =
  | "idle" | "submitting" | "awaiting_first_token"
  | "streaming" | "tool_work" | "awaiting_user"
  | "interrupting" | "replaying" | "errored" | "complete";

export type TideLifecycleOverlay = "transport_down" | "queued_next" | "drilldown_open";

export interface TideLifecycleSnapshot {
  state: TideLifecycleState;
  overlays: ReadonlySet<TideLifecycleOverlay>;
  // Z5-relevant derived fields:
  submitButtonMode:
    | { kind: "submit"; disabled: boolean; queued: boolean }
    | { kind: "stop" }
    | { kind: "awaiting_user" }   // disabled
    | { kind: "stopping" }        // disabled
    | { kind: "reconnecting" }    // disabled
    | { kind: "restoring" };      // disabled — REPLAYING state
}

export interface TideLifecycleUiState {
  drilldownOpen: boolean;
  // Future UI-local overlays add fields here per [DT08].
}

// Per [DT08]: takes both store and UI state; pure-of-inputs.
// Per [DT09]: returns the previous reference when matrix-relevant signals unchanged.
export function deriveLifecycleSnapshot(
  storeSnapshot: CodeSessionSnapshot,
  uiState: TideLifecycleUiState,
): TideLifecycleSnapshot;
```

`useLifecycleState()` composes three sources:
1. `useSyncExternalStore` on `CodeSessionStore` (the session snapshot) — per [L02].
2. A UI-local `useState` (or small ui-only store) for `drilldownOpen` and future presentation flags.
3. `deriveLifecycleSnapshot(storeSnapshot, uiState)` to project both into the same matrix-row signal, with the reference-stable return guarantee from [DT09].

The matrix from [Step 20.5.A](#step-20-5-a) is encoded literally in `deriveLifecycleSnapshot` — one switch statement, one source of truth, trivially testable in isolation. The switch reads from the actual `CodeSessionPhase` enum (`idle | submitting | awaiting_first_token | streaming | tool_work | awaiting_approval | replaying | errored`) plus the snapshot's `pendingApproval` / `pendingQuestion` / `transportState` / `queuedSends` / `interruptInFlight` fields.

**Conformance.** All UI changes go through the lifecycle hook — no zone reads `phase` or `awaitingApprovalSince` directly. [L02] (useSyncExternalStore for external state), [L06] (appearance via DOM/CSS — e.g., Z5's mode flips a `data-mode` attribute, CSS handles the visual), [L23] (preserve user-visible state — Z5 label transitions must not flicker between modes; Z1's content swap from `TugProgress` (during SUBMITTING / AWAITING_FIRST_TOKEN) to per-turn metrics (in COMPLETE) happens **inside the same slot DOM container** so no parent-row remount occurs, no scroll or focus loss), [L26] (mount identity — Z5 button DOM node identity stable across mode changes; Z1 slot DOM container stable across content-type changes; do NOT remount a different `<button>` per Z5 mode and do NOT remount the slot per Z1 content change).

**Artifacts.**

- `tugdeck/src/lib/code-session-store/lifecycle-state.ts` — _new module_ — `TideLifecycleState`, `TideLifecycleOverlay`, `TideLifecycleSnapshot`, `deriveLifecycleSnapshot`.
- `tugdeck/src/lib/code-session-store/__tests__/lifecycle-state.test.ts` — pure-logic tests for every row of the matrix (one test per state × overlay combination that the matrix lists distinctly).
- `tugdeck/src/lib/code-session-store/hooks/use-lifecycle-state.ts` — _new hook_ — `useSyncExternalStore` wrapper.
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` + `.css` — Z5 wire-up: button consumes `submitButtonMode` from the hook; flips `data-mode` for CSS; label / disabled / aria-label per mode.
- `tugdeck/src/components/tugways/cards/tide-card.tsx` — wire chosen telemetry placement defaults from 20.4's study into Z0 / Z1 / Z2 / Z3 / Z4. Each placement renderer consumes `useLifecycleState()` for the matrix-driven content (e.g., Z2's "live counts" renderer switches to "frozen + awaiting badge" when `state === "awaiting_user"`).
- `tugdeck/src/components/tugways/cards/__tests__/tide-card-lifecycle-coordination.test.tsx` — end-to-end matrix tests: drive a fixture session through each state and assert each zone's content matches the matrix row.

**Mount-identity check.** [L26] — Z5's submit button is the most likely place to accidentally break responder identity. The button MUST stay the same DOM node across mode changes; ONLY its label / disabled / `data-mode` attribute / event handler change. Do NOT render `<button>Submit</button>` in one branch and `<button>Stop</button>` in another — render one `<button>` whose content + attributes are mode-driven. Verify focus survives mode transitions: tab into the textarea, type, focus the button, switch state through a fixture turn — focus identity must persist.

**Tasks.**

- [ ] **Lifecycle module + hook** — `lifecycle-state.ts` + `use-lifecycle-state.ts`. Implement `deriveLifecycleSnapshot` as the matrix encoded in one switch.
- [ ] **Z5 wire-up** — single `<button>` DOM node with `data-mode` attribute; CSS handles per-mode visual; aria-label per mode; keyboard activation respects disabled states.
- [ ] **Cross-zone coordination** — Z1 / Z2 renderers consume the hook; Z2 swaps live counts for "awaiting" badge during AWAITING_USER, etc.
- [ ] **Ship placement defaults** — wire 20.4's HMR-study winners into each zone's default content. Experimentation harness stays behind DEV guard.
- [ ] **Mount-identity verification** — button node stable across mode changes; focus survives; matrix-row transitions don't flicker.
- [ ] **End-to-end matrix tests** — every distinct row of the matrix gets a fixture test.

**Tests.**

- [ ] `deriveLifecycleSnapshot` returns the correct `state` for each combination of `phase` / `pendingApproval` / `pendingQuestion` / `transportState` / `interruptInFlight` / `queuedSends` — every row of the matrix gets a test, including the new AWAITING_FIRST_TOKEN, REPLAYING, ERRORED rows.
- [ ] `submitButtonMode` matches the matrix for every state × overlay combination.
- [ ] **[DT09]** `deriveLifecycleSnapshot` returns reference-stable result: two calls with snapshots that differ only in content fields (e.g., growing `assistant` text but same `phase` / `transportState` / etc.) return `Object.is`-equal results. Two calls where any matrix-relevant signal differs return distinct references.
- [ ] **[DT08]** `deriveLifecycleSnapshot` projects `uiState.drilldownOpen` into the overlays set; same `storeSnapshot` with different `uiState` returns distinct results.
- [ ] Z2's renderer shows live counts in STREAMING, frozen + badge in AWAITING_USER, "Disconnected" in TRANSPORT_DOWN overlay, "Restoring session…" in REPLAYING.
- [ ] Z1's per-turn indicator: TugProgress during SUBMITTING / AWAITING_FIRST_TOKEN, live elapsed ticking during STREAMING / TOOL_WORK, paused during AWAITING_USER, frozen final in COMPLETE / ERRORED.
- [ ] Z5 button: same DOM node across mode transitions; aria-label reflects current mode; disabled in AWAITING_USER / INTERRUPTING / REPLAYING / TRANSPORT_DOWN.
- [ ] Mount-identity: textarea focus survives Z5 mode changes.
- [ ] **[L23]** Z1 content swap (TugProgress → per-turn metrics on COMPLETE) does NOT scroll the transcript or steal focus — verify via app-test that an existing focus position survives a turn's completion.

**Checkpoint.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.
- [ ] **HMR vet (manual)** — drive a session through each matrix state; visually confirm zone coordination matches the matrix; confirm Z5 button doesn't flicker or lose focus across transitions; confirm AWAITING_USER (triggered by a permission dialog) freezes Z2's clock and shows the "Awaiting your input" Z5 mode.

---

#### Step 20.5.E: `/context`-style on-demand drill-down surface {#step-20-5-e}

**Depends on:** #step-20-5-d (lifecycle hook + Z2 affordance host site)

**Status:** _not started._

**Commit:** `feat(tide-rendering): /context-style telemetry drill-down surface (Z2 📊 affordance)`

**References:** [#step-20-5-a] (DRILLDOWN_OPEN overlay state), [#step-20-5-d] (lifecycle hook), [#step-20-3] (telemetry data exposed by the drill-down), [#step-20-4] (Z2 affordance host site)

**Scope.** Build the on-demand `/context`-style breakdown surface that surfaces the FULL telemetry detail — every field on every `TurnEntry`, per-model breakdown if multiple models were used, the live `cost_update` payload, the gauge thresholds, the four-clock breakdown (`wallClockMs` / `awaitingApprovalMs` / `transportDowntimeMs` / `activeMs`), per-tool wall via `ToolCall.toolWallMs`, latency markers (`ttftMs` / `ttftcMs`), and reconnect / stream-gap diagnostics. Mirrors the terminal Claude Code's `/context` behavior.

**Trigger.** A small `📊` affordance at the right edge of Z2 (host site already reserved by [#step-20-4]). Click opens the drill-down; Esc and outside-click close it. The drill-down toggles the `DRILLDOWN_OPEN` overlay in the lifecycle state from 20.5.A.

**Surface choice.** A **sheet** (or sidebar) rather than a modal. A modal would hide the source-of-truth zones (especially Z2, the source of the affordance); a sheet that slides over the transcript but leaves Z2 + Z5 visible at the edges preserves the user's spatial mental model. Decide between right-sliding sheet vs. bottom-sliding sheet during implementation based on tide-card aspect ratio.

**Content layout.** Hierarchical, scannable:

- **Header:** session ID, model name, context window utilization (full gauge from [#step-20-1], not the compact strip).
- **Per-turn table:** one row per committed turn — turn index, `wallClockMs`, `awaitingApprovalMs`, `transportDowntimeMs`, `activeMs`, `ttftMs`, `ttftcMs`, tokens (in / out / cache_read / cache_creation), cost USD, `turnEndReason`. Sortable.
- **Per-tool breakdown** (collapsed by default): for each turn that had tool calls, expand to show per-tool `toolWallMs` + tool name + arg summary.
- **Reconnect / stream-gap diagnostics:** count of reconnects across the session; longest stream gap; etc.
- **Live cost_update payload (raw):** the latest `cost_update` JSON, formatted, for debugging. Collapsed by default.

**Conformance.** All data via [#step-20-3]'s `telemetry.ts` helpers — no direct snapshot scraping. [L02] for the lifecycle/data subscription. [L06] for appearance. The drill-down is read-only — no mutations, no input capture beyond Esc-to-close. Does NOT claim responder identity persistently — opening the drill-down doesn't change the persistent text-entry destination per [feedback_persistent_text_entry].

**Artifacts.**

- `tugdeck/src/components/tugways/cards/tide-telemetry-drilldown.tsx` + `.css` + `.test.ts` — _new component_. Renders the sheet body. Receives data via the telemetry helpers; receives open/close via prop.
- `tugdeck/src/components/tugways/cards/tide-card.tsx` — wire the `📊` affordance on Z2's right edge to a local UI state that toggles the drill-down; pass open state into `tide-telemetry-drilldown`. Toggle the `DRILLDOWN_OPEN` overlay in `useLifecycleState` so the dimming behavior from the matrix applies.
- `tugdeck/src/lib/code-session-store/lifecycle-state.ts` — per [DT08](#dt08-lifecycle-snapshot-merges-ui-state), `deriveLifecycleSnapshot` already accepts `uiState: TideLifecycleUiState` as its second argument from [Step 20.5.D](#step-20-5-d). This step adds the `drilldownOpen: boolean` field's PRODUCER side: when 20.5.D landed, `drilldownOpen` defaulted to `false`; this step adds the toggle (UI-local `useState` in the `TideCard` composition; mutated by the `📊` affordance handler and the Esc handler in the drill-down sheet). The matrix's DRILLDOWN_OPEN overlay then derives automatically from the existing snapshot derivation.
- `tugdeck/src/components/tugways/cards/__tests__/tide-telemetry-drilldown.test.tsx` — fixture renders with a multi-turn transcript; assert every per-turn field shows; assert sort works; assert per-tool expansion works; assert Esc closes.

**Tasks.**

- [ ] **Drill-down component** — render header, per-turn table, per-tool expansion, diagnostics, raw payload.
- [ ] **Z2 affordance** — wire `📊` click to open the drill-down; aria-label "Open telemetry drill-down."
- [ ] **Sheet shell** — slide-in surface with Esc + outside-click close; trap focus inside while open per a11y conventions.
- [ ] **Lifecycle overlay** — `DRILLDOWN_OPEN` projected into `useLifecycleState` so the matrix's dimming behavior applies to Z0–Z4 + Z5.
- [ ] **Sort + expand interactions** — per-turn table sort by any column; per-tool expansion on row click.

**Tests.**

- [ ] Drill-down renders all per-turn fields from a fixture transcript.
- [ ] Sort changes order without losing selected row.
- [ ] Per-tool expansion shows `toolWallMs` for each tool call.
- [ ] Esc closes the drill-down and the lifecycle overlay clears.
- [ ] Outside-click closes the drill-down.
- [ ] Opening the drill-down does NOT change the persistent text-entry focus destination per [feedback_persistent_text_entry]; closing returns focus to wherever it was.
- [ ] Lifecycle overlay matrix row applies: Z0–Z5 dim while DRILLDOWN_OPEN.

**Checkpoint.**

- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` exits 0.
- [ ] **HMR vet (manual)** — run a multi-turn session with one tool call and one permission dialog; open the drill-down via the Z2 `📊` affordance; verify every field from [#step-20-3] surfaces correctly; verify the per-tool expansion shows `toolWallMs`; verify Esc closes cleanly.
