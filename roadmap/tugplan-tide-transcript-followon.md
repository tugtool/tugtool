<!-- tugplan-skeleton v2 -->

## Tide Transcript — Interrupt, Atoms, Prefetching, Close-out {#tide-transcript-followon}

**Purpose:** Three small follow-ons to the [Tide transcript resume work](./tugplan-tide-transcript-resume.md) that were absorbed from the parent [tugplan-tug-list-view.md](./tugplan-tug-list-view.md) roadmap during planning but didn't ship in the resume plan's recovery saga. This is the cleanup pass:

1. **Phase-aware interrupt** — split cancellation into the pre-first-delta case (CASE A — `phase === "submitting"`, the wire is silent, no `activeMsgId` exists) and the post-first-delta cases (CASE B — `phase ∈ {awaiting_first_token, streaming, tool_work, awaiting_approval}`, claude has produced content under an `activeMsgId`). CASE A returns the user's prompt text + atoms to the editor for re-edit and emits no transcript entry; CASE B keeps the existing committed-interrupted-turn path unchanged.
2. **Atom-aware user rows** — `UserRowCell` switches from a plain `<span>` body to a body that renders `userMessage.attachments` as inline atoms when present, falling back to plain text for legacy or attachment-empty turns.
3. **`TugListView` prefetching protocol** — `delegate.prefetchForIndices(indices)` / `delegate.cancelPrefetchForIndices(indices)` plus a viewport-prediction window. Delegate-only; consumers decide what to prefetch.

Concludes with a tuglaws cross-check pass and updates the parent roadmap rows to "shipped."

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | tugplan-tide-transcript-followon |
| Last updated | 2026-05-05 |
| Roadmap anchor | [tugplan-tug-list-view.md #roadmap](./tugplan-tug-list-view.md#roadmap) — atom-aware user rows + prefetching protocol were absorbed from this anchor; the sticky-seed item shipped via other means and a phase-aware interrupt step joined the plan in its place |
| Predecessors | [tugplan-tide-transcript-resume.md](./tugplan-tide-transcript-resume.md) (closed 2026-05-04 — resume from JSONL ships, mid-turn deferred to its own investigation). The work here builds on the surfaces that plan put in place: `TideTranscriptDataSource`, `UserRowCell`, `TugListView` |
| Successors | parent [tugplan-tide-card-polish.md](./tugplan-tide-card-polish.md) §step-12 (markdown styling) and §step-13 (thinking + tool surfaces); an eventual `tugplan-tug-list-view-v2-imperative-pool.md` resolves live-turn flicker via imperative DOM pooling |
| Related | [tugplan-tide-mid-turn-replay.md](./tugplan-tide-mid-turn-replay.md) — the mid-turn investigation that was extracted from the resume plan rather than completed in line; outcomes there are independent of this plan and don't gate it |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The resume work landed in [tugplan-tide-transcript-resume.md](./tugplan-tide-transcript-resume.md): JSONL replay translates per-session JSONLs into `CODE_OUTPUT` events, the reducer handles the bracket, the request_replay verb supports HMR / Reload / cold-boot recovery. Smokes A, B, C verified end-to-end.

What didn't ship in the resume plan: three small absorbed polish items the parent `tugplan-tug-list-view.md` flagged as "right away" follow-ons. They share a theme — they polish the data-source / cell-renderer / list-view surface — but they're not part of the resume gap proper. Pulling them into the resume plan made it sprawl; closing the resume plan separately and shipping these as their own focused phase keeps the work units sized for clean review.

The mid-turn case (Smoke D) is *not* in this plan. It's its own investigation in [tugplan-tide-mid-turn-replay.md](./tugplan-tide-mid-turn-replay.md) because it requires architectural changes (msg_id canonicalization, durability guarantees) that the resume plan's design space couldn't accommodate.

#### Strategy {#strategy}

- **Land each item in its own commit** — one commit per step, no bundling.
- **Reuse existing tests as much as possible** — the resume plan put down adapter, cell-renderer, and list-view test infrastructure. Each step extends one of those test files.
- **Tuglaws cross-check at every step.** Each touches a different zone (data source = structure, cell renderer = data + tokens, list-view = structure-zone primitive). Confirm zone discipline holds.
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

- An interrupt fired while `phase === "submitting"` (CASE A — no `activeMsgId`, scratch empty) restores the user's prompt text + atoms back into the editor surface, leaves the transcript untouched, and lands the snapshot at `phase: "idle"` after the wire's `turn_complete(error)` rolls in. (Verified: reducer tests for the submitting-phase interrupt path; integration assertion that the editor reflects the restored draft.)
- An interrupt fired while `phase ∈ {awaiting_first_token, streaming, tool_work, awaiting_approval}` (CASE B) preserves today's behavior — partial scratch commits as a `TurnEntry` with `result: "interrupted"`. (Verified: existing `code-session-store.interrupt.test.ts` regression coverage continues to pass; one additional case for the `awaiting_first_token` boundary.)
- The `user` cell renderer accepts `AtomSegment[]` content and renders atoms inline alongside text once `userMessage.attachments` carries the typed shape. (Verified: cell-renderer unit test against a fixture turn whose `attachments` is `AtomSegment[]`.)
- The `TugListView` prefetching protocol exposes `delegate.prefetchForIndices` and `delegate.cancelPrefetchForIndices` and dispatches them based on a viewport-prediction window; a delegate that opts in observes prefetch / cancel calls in correct order on scroll. (Verified: `TugListView` unit tests.)
- Tuglaws cross-check passes per-step.
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green at every step.

#### Scope {#scope}

1. **Phase-aware interrupt path** in `CodeSessionStore`'s reducer + `TugPromptEntry`'s submit/interrupt handler. The reducer's `handleInterrupt` branches on phase: when `state.phase === "submitting"` (CASE A — wire was silent, no `activeMsgId`, scratch empty), it captures `pendingUserMessage` into a one-shot snapshot slot for the editor to consume, marks the in-flight cycle so the eventual `turn_complete(error)` does not append a phantom transcript entry, and clears `pendingUserMessage` immediately so the in-flight pair stops rendering. CASE B (post-first-delta) is unchanged from today.
2. **Atom-aware user rows.** `UserRowCell` switches from a plain `<span>` body to a body that renders `userMessage.attachments` as inline atoms when present, falling back to plain text for legacy or attachment-empty turns.
3. **`TugListView` prefetching protocol.** `delegate.prefetchForIndices(indices)` / `delegate.cancelPrefetchForIndices(indices)` plus a viewport-prediction window. Delegate-only — `TugListView` does not assume any specific prefetch behavior; consumers decide.
4. **Tuglaws walkthrough + plan close-out**, mirroring the parent plan's pattern.

Out of scope:

- Mid-turn reload (Smoke D) — its own investigation in [tugplan-tide-mid-turn-replay.md](./tugplan-tide-mid-turn-replay.md).
- Imperative DOM cell pooling (its own plan, see [#roadmap]).
- Markdown styling pass for assistant output (parent §step-12).
- Thinking + tool surfaces inside `code` rows (parent §step-13).

---

### Phases and Steps {#phases-and-steps}

#### Phase A — Transcript surfaces (interrupt + atom rendering) {#phase-a}

#### Step 1.1: Phase-aware interrupt — restore prompt for CASE A, commit-interrupted for CASE B {#step-1-1}

**Commit:** `tide(interrupt): split CASE A (submitting) from CASE B (post-first-delta)`

**Background:** The dividing line is the first content frame from claude carrying an `msg_id` — verified by walking the wire types (`tugcode/src/types.ts` has no per-turn ack frames preceding content), the tugcode session loop (`tugcode/src/session.ts:2755`'s `handleUserMessage` writes the `user_message` to claude's stdin and waits on the active turn whose `currentMessageId` slot stays null until the first stream event), and the v2.1.105 `test-06-interrupt-mid-stream` fixture's recorded ordering (no intermediate frames between `system_metadata` and the first `assistant_text` partial). In reducer terms that's the `submitting → awaiting_first_token` transition (text/thinking partial) or the `submitting → tool_work` transition (tool_use first). Equivalently: `state.activeMsgId === null` ⇔ CASE A; `state.activeMsgId !== null` ⇔ CASE B.

CASE A — `state.phase === "submitting"`. The wire received the `user_message` frame but claude has not produced anything keyed to a `msg_id` yet. `pendingUserMessage` carries exactly what the user just sent. The user's intent ("I clicked stop because claude hadn't picked it up") wants the editor seeded with that text + atoms so they can edit and resubmit. No transcript entry should appear.

CASE B — `state.phase ∈ {awaiting_first_token, streaming, tool_work, awaiting_approval}`. `activeMsgId` is set, `scratch[activeMsgId]` may have partial text/thinking/tool-use content. The existing committed-interrupted path applies (per `code-session-store.interrupt.test.ts`); the wire's eventual `turn_complete(error)` commits a `TurnEntry` with `result: "interrupted"`. No change.

**Artifacts:**

- `tugdeck/src/lib/code-session-store/types.ts`:
  - Add a `pendingDraftRestore: { text: string; atoms: ReadonlyArray<AtomSegment> } | null` slot to the snapshot (and the underlying state). Set by the reducer when CASE A fires; cleared by the prompt entry once the editor has consumed the restore (one-shot read, dispatched back through a public `consumePendingDraftRestore()` method, mirroring how live state is mutated through reducer events rather than fields).
  - Document the `interruptOrigin: "submitting" | null` reducer-internal state field used to route the eventual `turn_complete(error)` to the right branch (suppress-transcript for CASE A, append-interrupted for CASE B).
- `tugdeck/src/lib/code-session-store/reducer.ts`:
  - `handleInterrupt` branches on `state.phase`. For `submitting`: capture `state.pendingUserMessage` into `pendingDraftRestore`, set `interruptOrigin = "submitting"`, clear `pendingUserMessage` immediately so the in-flight pair stops rendering, clear `queuedSends` (current behavior), emit the `interrupt` send-frame effect (current behavior). For all other interruptible phases: behave exactly as today (clear `pendingApproval` / `pendingQuestion`, restore `prevPhase` from `awaiting_approval`, send the interrupt frame). Continue to no-op for `idle` / `errored` / `replaying`.
  - `handleTurnComplete` for `result: "error"`: when `interruptOrigin === "submitting"`, do NOT append a `TurnEntry`; clear the origin flag, clear `pendingUserMessage` / scratch / activeMsgId / toolCallMap as the existing path does, and return to `idle`. CASE B falls through unchanged and commits the interrupted entry.
  - Add a `consume_draft_restore` reducer event that clears `pendingDraftRestore` to `null`.
- `tugdeck/src/lib/code-session-store.ts`:
  - Surface `pendingDraftRestore` on the snapshot.
  - Expose `consumePendingDraftRestore(): void` as a public method that dispatches `consume_draft_restore`.
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx`:
  - Read `snap.pendingDraftRestore` from the existing `useSyncExternalStore` snap. In a `useLayoutEffect` keyed on the slot's identity, replace the editor's doc with `restore.text` and re-emit atoms via `regenerateAtomsEffect` (the same pathway the editor uses for state preservation), then call `codeSessionStore.consumePendingDraftRestore()` so the slot clears in the next snapshot.
  - Restore happens regardless of focus state — the user just clicked the Stop button, so the editor should already be the natural focus target; if not, focus follows via the existing post-action focus restore.
- Test extensions in `tugdeck/src/lib/code-session-store/__tests__/code-session-store.interrupt.test.ts`:
  - CASE A: `send` → assert `phase === "submitting"` → `interrupt()` → snapshot has `pendingDraftRestore` set with the original text/atoms, `pendingUserMessage` cleared, `queuedSends` cleared, transcript empty, `interrupt` frame written. Then dispatch `turn_complete(result: "error")` from the wire; transcript stays empty, snapshot lands at `phase: "idle"`.
  - CASE A consumption: after the snapshot has `pendingDraftRestore` set, call `consumePendingDraftRestore()` and assert the slot clears to `null`.
  - `awaiting_first_token` boundary: drive in exactly one `assistant_text` partial → assert `phase === "awaiting_first_token"` → `interrupt()` → wire `turn_complete(error)` → transcript has one entry with `result: "interrupted"` carrying that single partial's text. (Pins the "first delta is the boundary" invariant.)

**Tasks:**

- [ ] Add `pendingDraftRestore` + `interruptOrigin` to `CodeSessionState` and surface `pendingDraftRestore` on the snapshot.
- [ ] Branch `handleInterrupt` on `state.phase === "submitting"`.
- [ ] Branch `handleTurnComplete` for `result: "error"` on `interruptOrigin === "submitting"` (suppress transcript append).
- [ ] Add `consume_draft_restore` reducer event + `consumePendingDraftRestore()` public method.
- [ ] Wire the editor restore path inside `TugPromptEntry` via `useLayoutEffect`.
- [ ] Author tests for both paths.

**Tests:**

- [ ] CASE A: `submitting` → `interrupt()` populates `pendingDraftRestore`, clears `pendingUserMessage`, suppresses the transcript entry on the wire's `turn_complete(error)`, lands snapshot at `idle`.
- [ ] CASE A queued sends: any prior queued sends are wiped (current behavior preserved — the user re-edits one prompt; queue is not restored).
- [ ] CASE A consumption: `consumePendingDraftRestore()` clears the slot to `null`.
- [ ] CASE B `awaiting_first_token` boundary: one partial in, then `interrupt()` → `turn_complete(error)` commits a `TurnEntry` with `result: "interrupted"` carrying that partial's text.
- [ ] CASE B regressions: existing mid-stream + awaiting_approval interrupt cases pass unchanged.

**Tuglaws cross-check:**

- **L02** — `pendingDraftRestore` lives on the snapshot; the prompt entry consumes it via `useSyncExternalStore`, not by ref-reading the store directly.
- **L03** — the editor restore runs in `useLayoutEffect` so the doc replacement is visible in the same paint as the snapshot transition (no flash of an empty editor).
- **L07** — the prompt entry's restore handler reads the snapshot slot at dispatch / effect time; no captured-at-mount stale closure.
- **L11** — interrupt is already a `TUG_ACTIONS.SUBMIT` action; no new actions introduced.
- **L24** — phase-branching logic stays in the reducer (data zone); the prompt entry zone only consumes the resulting snapshot slot.

**Open questions / decisions:**

- *Submitting timeout.* There is no client-side timeout on the `submitting` phase today, so a card can sit indefinitely if the wire stalls. Tabled by the user; tracked separately for a follow-on step.
- *Queued sends on CASE A.* Current `handleInterrupt` clears `queuedSends` unconditionally; this step preserves that. If a future case wants to re-enqueue them as drafts, it's a separate step.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `cargo nextest run` — green.

---

#### Step 2: Atom-aware `user` row body {#step-2}

**Depends on:** [Step 1.1](#step-1-1)

**Commit:** `tide(transcript): atom-aware user-row body`

**References:** parent plan [§step-11's D11](./tugplan-tug-list-view.md#d11-atom-aware-row)

**Artifacts:**

- `tugdeck/src/lib/code-session-store/types.ts` — narrow `userMessage.attachments` from `ReadonlyArray<unknown>` to `ReadonlyArray<AtomSegment>` once the prompt entry's atom flow reaches transcript form. (Gating note: if the prompt entry hasn't shipped that change, this step ships a `userMessage.attachments?: ReadonlyArray<AtomSegment>` opt-in instead.)
- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — `UserRowCell` renders `attachments` as inline atoms alongside `text` when present. Falls back to plain text when `attachments` is empty.
- Test extensions in `tugdeck/src/__tests__/tide-card-transcript.test.tsx` — fixture turn whose `attachments` carries one or two `AtomSegment`s; assert the rendered DOM has the atom elements inline.

**Tasks:**

- [ ] Verify whether the prompt entry's atom flow exposes `AtomSegment[]` on submission today; gate the type change accordingly.
- [ ] Update `UserRowCell` to render atoms inline.
- [ ] Add the test fixture and assertions.

**Tests:**

- [ ] Atom-bearing user message: rendered DOM contains the atom elements with their atom-specific attributes.
- [ ] Atom-empty user message (regression): renders plain text; no atom elements.

**Tuglaws cross-check:**

- **L19** (component authoring guide) — `UserRowCell`'s `data-slot` and `@tug-renders-on` annotations stay accurate when the body grows.
- **L15 / L16 / L18** — atom rendering uses element/surface tokens consistent with the parent atom-img pattern; no new tokens introduced here.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.

---

#### Phase B — TugListView prefetching {#phase-b}

#### Step 3: `TugListView` prefetching protocol {#step-3}

**Depends on:** [Step 2](#step-2)

**Commit:** `tug-list-view: delegate.prefetchForIndices + cancelPrefetchForIndices`

**References:** parent plan [#prefetch-delegate](./tugplan-tug-list-view.md#prefetch-delegate)

**Artifacts:**

- `tugdeck/src/components/tugways/tug-list-view.tsx`:
  - `TugListViewDelegate` gains optional `prefetchForIndices(indices)` and `cancelPrefetchForIndices(indices)`.
  - The list view computes a prefetch window — a small band ahead of and behind the rendered window (e.g. 5 indices on each side, configurable via a delegate option in a future step).
  - On windowing pass, the list view diffs the previous prefetch set against the new one and dispatches `prefetchForIndices(added)` / `cancelPrefetchForIndices(removed)` accordingly.
  - The list view does NOT call `cellRenderers[kind]` for prefetched-only indices — they are informational.
- `tugdeck/src/components/tugways/__tests__/tug-list-view.test.tsx` — new tests covering the prefetch dispatch.

**Tasks:**

- [ ] Compute the prefetch window in the windowing pass.
- [ ] Diff against previous and dispatch.
- [ ] Author tests.

**Tests:**

- [ ] On scroll forward: indices ahead of the rendered window enter via `prefetchForIndices`; previously-prefetched indices behind the rendered window enter via `cancelPrefetchForIndices`.
- [ ] On scroll reversal: prefetched-but-not-rendered indices flip via `cancelPrefetchForIndices`.
- [ ] No prefetch dispatch when neither method is provided on the delegate (default v1 behavior).
- [ ] Cell renderers are NOT invoked for prefetched indices.

**Tuglaws cross-check:**

- **L09 / L10 / L25** — `TugListView` stays a structure-zone primitive. Prefetch dispatch is delegate-driven; no consumer-domain knowledge leaks into the list view.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.

---

#### Phase C — Tuglaws walkthrough + close-out {#phase-c}

#### Step 4: Tuglaws walkthrough + plan close-out {#step-4}

**Depends on:** [Step 3](#step-3)

**Commit:** `tide(transcript): tuglaws walkthrough; close out follow-on plan`

**References:** [tuglaws.md](../tuglaws/tuglaws.md), [pane-model.md](../tuglaws/pane-model.md), [component-authoring.md](../tuglaws/component-authoring.md), [responder-chain.md](../tuglaws/responder-chain.md), [state-preservation.md](../tuglaws/state-preservation.md), [token-naming.md](../tuglaws/token-naming.md)

**Artifacts:**

- Per-step compliance review against each tuglaws document. Findings either land as small fixes in this commit or are explicitly logged.
- `tugplan-tug-list-view.md #roadmap` updated: `Atom-aware rendering for user rows`, `Prefetching protocol` rows flipped to "shipped — see [tugplan-tide-transcript-followon.md]". (`Stable in-flight ↔ committed id` was completed by other means and is reflected on the parent roadmap independently of this plan.)
- `tide.md §T3.4.a` (or successor anchor) updated to reflect that JSONL replay on resume + phase-aware interrupt + atom-aware user rows + prefetching are all shipped.
- Plan Metadata `Status` flips to `shipped`.

**Tasks:**

- [ ] Walk each tuglaw against this plan's diff (Steps 1.1–3).
- [ ] Update parent roadmap rows in `tugplan-tug-list-view.md`.
- [ ] Update `tide.md` reference if needed.

**Tests:**

- [ ] Full-suite green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Checkpoint:**

- [ ] All commands above exit clean.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three small transcript / list-view polish items: a phase-aware interrupt path that distinguishes CASE A (`submitting`, restore prompt to editor) from CASE B (post-first-delta, commit interrupted turn), atom-aware user rows, and the `TugListView` prefetching protocol. Plus a tuglaws walkthrough that closes out this plan and updates the parent roadmap rows.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] CASE A interrupt restores the user's prompt (text + atoms) to the editor and emits no transcript entry; CASE B continues to commit an interrupted `TurnEntry` with the partial scratch content.
- [ ] `UserRowCell` renders inline atoms when `attachments` is non-empty.
- [ ] `TugListView` dispatches `prefetchForIndices` / `cancelPrefetchForIndices` on a working window.
- [ ] Tuglaws cross-check passes per-step.
- [ ] `tugplan-tug-list-view.md #roadmap` rows for absorbed items flipped to "shipped".
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Acceptance tests:**

- [ ] Phase-aware interrupt tests (Step 1.1).
- [ ] Atom-aware user-row tests (Step 2).
- [ ] `TugListView` prefetch tests (Step 3).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Imperative DOM cell pooling** — the v2 of `TugListView` that swaps React item-keyed mount/unmount for an imperative DOM pool keyed by cell kind. Public API unchanged; lifecycle semantics shift for stateful cell renderers (per the v1 → v2 caveat in [tugplan-tug-list-view.md §[D04]](./tugplan-tug-list-view.md#d04-cell-reuse)). Promoted from `tugplan-tug-list-view.md #roadmap` to its own plan because the structural shift earns dedicated decision-making (pool sizing, eviction policy, the [D13] native-text-selection-survival side-effect win, the per-kind reuse-token contract). Plan name TBD: `tugplan-tug-list-view-v2-imperative-pool.md` is a placeholder.
- [ ] **Native-text-selection survival across scroll-out** — explicitly resolved as a side effect of the imperative-DOM-pool plan above. v1 documented limitation per [tugplan-tug-list-view.md §[D13]](./tugplan-tug-list-view.md#d13-selection-scroll-out).
- [ ] **Live-turn flicker at the awaiting-first-token transition** — the seed-rewrite remount that the (separately-shipped) sticky-seed work *cannot* eliminate (only replay-committed turns avoid the rewrite, since their msg_id is known up front). The imperative-DOM-pool plan resolves this naturally because cell DOM survives wrapper-key changes.

| Checkpoint | Verification |
|-|-|
| Tokens lint clean | `bun run audit:tokens lint` |
| Phase-aware interrupt tests | `bun test src/lib/code-session-store/__tests__/code-session-store.interrupt.test.ts` |
| List-view prefetch tests | `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` |
| Atom-aware user-row tests | `bun test src/__tests__/tide-card-transcript.test.tsx` |
| TS clean | `bun x tsc --noEmit` |
| Rust clean | `cargo nextest run` |
