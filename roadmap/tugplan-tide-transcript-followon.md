<!-- tugplan-skeleton v2 -->

## Tide Transcript — Adapter Polish, Prefetching, Close-out {#tide-transcript-followon}

**Purpose:** Three small follow-ons to the [Tide transcript resume work](./tugplan-tide-transcript-resume.md) that were absorbed from the parent [tugplan-tug-list-view.md](./tugplan-tug-list-view.md) roadmap during planning but didn't ship in the resume plan's recovery saga. This is the cleanup pass:

1. **Stable in-flight ↔ committed id** — the `TideTranscriptDataSource` mints a `Symbol`-backed seed for in-flight rows so they don't remount when their `msg_id` lands. Replay-committed turns bypass the seed entirely (their `msg_id` is known on commit). Per [D07] of the resume plan.
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
| Last updated | 2026-05-04 |
| Roadmap anchor | [tugplan-tug-list-view.md #roadmap](./tugplan-tug-list-view.md#roadmap) — this plan executes the three small polish items the resume plan absorbed but did not ship |
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

- **Land each item in its own commit** — three steps, three commits. No bundling.
- **Reuse existing tests as much as possible** — the resume plan put down adapter, cell-renderer, and list-view test infrastructure. Each step extends one of those test files.
- **Tuglaws cross-check at every step.** Each touches a different zone (data source = structure, cell renderer = data + tokens, list-view = structure-zone primitive). Confirm zone discipline holds.
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

- The replay-committed `code` row's React key transitions exactly **zero** times across the row's lifetime — the JSONL-derived `msg_id` is the row's id from frame zero ([D07] of the resume plan). (Verified: adapter test asserts id stability for replay turns.)
- Live-turn flicker is unchanged from the resume plan's v1 — the seed transition for live in-flight turns continues to remount once at first delta and is documented as a follow-on resolved by imperative DOM pooling.
- The `user` cell renderer accepts `AtomSegment[]` content and renders atoms inline alongside text once `userMessage.attachments` carries the typed shape. (Verified: cell-renderer unit test against a fixture turn whose `attachments` is `AtomSegment[]`.)
- The `TugListView` prefetching protocol exposes `delegate.prefetchForIndices` and `delegate.cancelPrefetchForIndices` and dispatches them based on a viewport-prediction window; a delegate that opts in observes prefetch / cancel calls in correct order on scroll. (Verified: `TugListView` unit tests.)
- Tuglaws cross-check passes per-step.
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green at every step.

#### Scope {#scope}

1. **Sticky id for replay-committed turns** in `TideTranscriptDataSource` per [D07] of the resume plan. The replay-committed turn's `msg_id` is the row's id from frame zero — no seed transition. Live-turn flicker is unchanged.
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

#### Phase A — Adapter polish {#phase-a}

#### Step 1: Stable in-flight ↔ committed id (sticky seed for replay) {#step-1}

**Commit:** `tide(transcript): sticky seed for in-flight ↔ committed id`

**References:** [D07] sticky-seed (in [tugplan-tide-transcript-resume.md](./tugplan-tide-transcript-resume.md#d07-sticky-seed))

**Artifacts:**

- `tugdeck/src/lib/tide-transcript-data-source.ts`:
  - The data source mints a `Symbol`-backed seed (or a string nonce) at the moment `inflightUserMessage` first appears on a snapshot.
  - `idForIndex(index)` for in-flight indices reads the seed and returns `${seed}-{user|code}` until `activeMsgId` is set.
  - For replay-committed turns, the msg_id is known up front, so the sticky seed never enters the picture.
- Test extensions in `tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts`:
  - For a replay-committed turn, the id at the row's index equals `${msgId}-{user|code}` directly (no seed transition).
  - For a live in-flight turn, the seed transitions at the first delta as before — this step does NOT change live-turn behavior; live-turn flicker remains a follow-on resolved by the imperative-DOM-pool plan.

**Tasks:**

- [ ] Implement the seed minting at first-appearance of `inflightUserMessage`.
- [ ] Ensure replay-committed turns bypass the seed (their msg_id is known on commit).
- [ ] Update tests to assert the new behavior.

**Tests:**

- [ ] Replay-only commit: id is `${msgId}-...` at first read; never transitions.
- [ ] Live submit (regression): seed transitions exactly once at first delta (unchanged from v1).

**Tuglaws cross-check:**

- **L24** — `TideTranscriptDataSource` is a structure-zone module. The seed lives in the data source's local state, derived from snapshot reads via `useSyncExternalStore` upstream. No new render path, no effect timer.
- **L02** — unchanged. The data source reads from `CodeSessionStore`'s snapshot; its consumers subscribe via `useSyncExternalStore`.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `cargo nextest run` — green.

---

#### Step 2: Atom-aware `user` row body {#step-2}

**Depends on:** [Step 1](#step-1)

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
- `tugplan-tug-list-view.md #roadmap` updated: `Stable in-flight ↔ committed id`, `Atom-aware rendering for user rows`, `Prefetching protocol` rows flipped to "shipped — see [tugplan-tide-transcript-followon.md]".
- `tide.md §T3.4.a` (or successor anchor) updated to reflect that JSONL replay on resume + adapter polish + prefetching are all shipped.
- Plan Metadata `Status` flips to `shipped`.

**Tasks:**

- [ ] Walk each tuglaw against this plan's diff (Steps 1–3).
- [ ] Update parent roadmap rows in `tugplan-tug-list-view.md`.
- [ ] Update `tide.md` reference if needed.

**Tests:**

- [ ] Full-suite green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Checkpoint:**

- [ ] All commands above exit clean.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three small adapter / list-view polish items absorbed from the parent plan: replay-correct in-flight ↔ committed id, atom-aware user rows, and the `TugListView` prefetching protocol. Plus a tuglaws walkthrough that closes out this plan and updates the parent roadmap rows.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Sticky id eliminates the seed-transition remount for replay-committed turns; live-turn flicker documented as a follow-on resolved by imperative DOM pooling.
- [ ] `UserRowCell` renders inline atoms when `attachments` is non-empty.
- [ ] `TugListView` dispatches `prefetchForIndices` / `cancelPrefetchForIndices` on a working window.
- [ ] Tuglaws cross-check passes per-step.
- [ ] `tugplan-tug-list-view.md #roadmap` rows for absorbed items flipped to "shipped".
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Acceptance tests:**

- [ ] Adapter sticky-id tests (Step 1).
- [ ] Atom-aware user-row tests (Step 2).
- [ ] `TugListView` prefetch tests (Step 3).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Imperative DOM cell pooling** — the v2 of `TugListView` that swaps React item-keyed mount/unmount for an imperative DOM pool keyed by cell kind. Public API unchanged; lifecycle semantics shift for stateful cell renderers (per the v1 → v2 caveat in [tugplan-tug-list-view.md §[D04]](./tugplan-tug-list-view.md#d04-cell-reuse)). Promoted from `tugplan-tug-list-view.md #roadmap` to its own plan because the structural shift earns dedicated decision-making (pool sizing, eviction policy, the [D13] native-text-selection-survival side-effect win, the per-kind reuse-token contract). Plan name TBD: `tugplan-tug-list-view-v2-imperative-pool.md` is a placeholder.
- [ ] **Native-text-selection survival across scroll-out** — explicitly resolved as a side effect of the imperative-DOM-pool plan above. v1 documented limitation per [tugplan-tug-list-view.md §[D13]](./tugplan-tug-list-view.md#d13-selection-scroll-out).
- [ ] **Live-turn flicker at the awaiting-first-token transition** — the seed-rewrite remount that this plan's Step 1 *cannot* eliminate (only replay-committed turns avoid the rewrite, since their msg_id is known up front). The imperative-DOM-pool plan resolves this naturally because cell DOM survives wrapper-key changes.

| Checkpoint | Verification |
|-|-|
| Tokens lint clean | `bun run audit:tokens lint` |
| Adapter sticky-id tests | `bun test src/lib/__tests__/tide-transcript-data-source.test.ts` |
| List-view prefetch tests | `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` |
| Atom-aware user-row tests | `bun test src/__tests__/tide-card-transcript.test.tsx` |
| TS clean | `bun x tsc --noEmit` |
| Rust clean | `cargo nextest run` |
