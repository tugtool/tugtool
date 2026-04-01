<!-- tugplan-skeleton v2 -->

## Markdown Scroll Fixes: Two-Phase Scroll Update {#markdown-scroll-fixes}

**Purpose:** Eliminate streaming follow-bottom jank ("womp womp") and DOM nuke on non-tail region edits by adopting synchronous measurement, `Number.MAX_SAFE_INTEGER` scroll slamming, and generalizing `incrementalTailUpdate` to all regions.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

TugMarkdownView's streaming follow-bottom path suffers from a two-phase scroll update: content arrives and `scrollTop` is set from estimated heights, then ResizeObserver fires one or more frames later with real measurements, causing a visible bounce. Additionally, non-tail region edits fall back to `lexParseAndRender` which nukes the entire DOM, destroying scroll position and follow-bottom state.

The roadmap document (`roadmap/markdown-scroll-fixes.md`) identifies three sub-problems under Problem 2. This plan implements all three in the order: 2b (slam scrollTop), 2c (synchronous measurement + pinToBottom), 2a (lift D03 restriction to generalize incrementalTailUpdate).

#### Strategy {#strategy}

- **2b first:** Replace `scrollHeight - clientHeight` computations with `Number.MAX_SAFE_INTEGER` in `SmartScroll.scrollToBottom()`. Smallest change, immediate improvement.
- **2c second:** Add `SmartScroll.pinToBottom()` (idle-phase scroll slam), synchronous `offsetHeight` measurement in `incrementalTailUpdate`, and ResizeObserver safety net. This eliminates the estimate-then-correct cycle for streaming.
- **2a last:** Remove the `!isLast` gate in `doSetRegion`, add `BlockHeightIndex.shiftFrom()`, and inline all index shift operations in `incrementalTailUpdate`. This eliminates `lexParseAndRender` for all non-cold-start paths.
- **CSS containment:** Add `contain: content` to `.tugx-md-block` to limit reflow scope during forced layout.
- **Preserve existing architecture:** SmartScroll state machine [D93] unchanged. RAF scroll coalescing [L05] unchanged. All mutations are direct DOM writes [L06].

#### Success Criteria (Measurable) {#success-criteria}

- Zero visible scroll bounce during streaming follow-bottom (manual test: stream 10KB content, observe no "womp womp" at bottom)
- Non-tail region edit preserves scroll position within 1px (test: scroll to mid-document, update a middle region, verify scrollTop unchanged)
- `lexParseAndRender` called only on cold start (`wasEmpty`) and `removeRegion` — grep confirms no other call sites
- All existing tests pass: `bun test` in tugdeck

#### Scope {#scope}

1. `SmartScroll.scrollToBottom()` uses `Number.MAX_SAFE_INTEGER` internally
2. New `SmartScroll.pinToBottom()` method — idle-phase scroll slam
3. Synchronous `offsetHeight` measurement in `incrementalTailUpdate` for new tail blocks
4. ResizeObserver callback slams `scrollTop` when `isFollowingBottom`
5. `doSetRegion` calls `pinToBottom()` instead of `scrollToBottom()` when following bottom
6. `BlockHeightIndex.shiftFrom(startIndex, delta)` for in-place height array shift
7. `incrementalTailUpdate` generalized to handle non-tail regions (inline index shift for htmlCache, blockNodes, regionBlockRanges, data-block-index attributes)
8. Remove `!isLast` gate in `doSetRegion`
9. Content shrink: scroll to nearest surviving block above old position
10. `contain: content` CSS on `.tugx-md-block`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing `removeRegion` — it keeps calling `lexParseAndRender` unchanged
- Modifying `lexParseAndRender` internals (cold-start path stays estimate-then-ResizeObserver)
- Adding new SmartScroll phases or flags
- Changing RAF scroll coalescing behavior
- Problem 1 (O(n^2) full rescan) — already implemented and merged

#### Dependencies / Prerequisites {#dependencies}

- Problem 1 is complete (incrementalTailUpdate, regionBlockRanges, fence propagation all implemented)
- SmartScroll six-phase state machine [D93] is stable
- BlockHeightIndex, RenderedBlockWindow, RegionMap all implemented and tested

#### Constraints {#constraints}

- Must comply with Laws of Tug: L03, L05, L06, L07, L22, L23, D93
- All DOM mutations are direct writes, no React state involvement
- `pinToBottom()` must work within the existing state machine — no new phases, no flags
- Synchronous `offsetHeight` measurement applies to `incrementalTailUpdate` only, not cold-start

#### Assumptions {#assumptions}

- Streaming chunks add 1-3 blocks at a time (forced layout on new tail blocks is cheap)
- `contain: content` on `.tugx-md-block` limits reflow scope to the new block subtree
- Browsers clamp `scrollTop` to `scrollHeight - clientHeight` when set to `Number.MAX_SAFE_INTEGER`
- The fence propagation logic (D02) already handles re-lexing subsequent regions when fences are unbalanced

---

### Design Decisions {#design-decisions}

#### [D01] Both scrollToBottom and pinToBottom use MAX_SAFE_INTEGER (DECIDED) {#d01-max-safe-integer}

**Decision:** `scrollToBottom()` and `pinToBottom()` both set `scrollTop = Number.MAX_SAFE_INTEGER`. `scrollToBottom()` keeps its programmatic phase transition; `pinToBottom()` stays in idle phase.

**Rationale:**
- Browsers clamp `scrollTop` to the actual maximum. No estimation, no stale `scrollHeight`, no race.
- Consistent pattern for all "go to bottom" operations.

**Implications:**
- `scrollToBottom()` internal implementation changes but its public contract (programmatic scroll to bottom) is unchanged
- `pinToBottom()` is a new public method with different phase semantics

#### [D02] shiftFrom handles only BlockHeightIndex (DECIDED) {#d02-shift-scope}

**Decision:** `BlockHeightIndex.shiftFrom(startIndex, delta)` shifts only the height array using `Float64Array.copyWithin` and invalidates the prefix sum from the shift point. All other shift operations (htmlCache keys, blockNodes keys, regionBlockRanges start values, data-block-index DOM attributes) are inline in `incrementalTailUpdate`.

**Rationale:**
- One call site for the shift logic (incrementalTailUpdate). No abstraction for one-time operations.
- BlockHeightIndex has typed-array internals that benefit from `copyWithin`; the other data structures are Maps with simple key remapping.

**Implications:**
- `BlockHeightIndex` gains one new method
- `incrementalTailUpdate` grows with inline shift logic for Maps and DOM attributes

#### [D03] Synchronous measurement in incrementalTailUpdate only (DECIDED) {#d03-sync-measurement}

**Decision:** Synchronous `offsetHeight` reads on new block nodes happen only in `incrementalTailUpdate`. Cold-start `lexParseAndRender` keeps the estimate-then-ResizeObserver pattern.

**Rationale:**
- Cold start renders potentially hundreds of blocks; forced layout on all of them would be expensive
- `incrementalTailUpdate` adds 1-3 blocks at a time — forced layout is cheap and eliminates the bounce

**Implications:**
- ResizeObserver remains the primary measurement path for cold start
- ResizeObserver becomes a safety net for the incremental path

#### [D04] pinToBottom works within the state machine (DECIDED) {#d04-pin-to-bottom}

**Decision:** `pinToBottom()` sets `scrollTop = Number.MAX_SAFE_INTEGER` without calling `_enterProgrammatic()`. The scroll event arrives in idle phase. The existing `idle` case in `_handleScroll` handles it (re-engagement check only, no RAF deferral beyond the existing onScroll callback).

**Rationale:**
- Content growth is not a programmatic scroll. It is a side effect of content arriving.
- Overlapping programmatic scroll sequences during rapid streaming are wrong. Staying in idle avoids them.
- The idle case in `_handleScroll` already handles scroll events correctly — checks re-engagement and does nothing else.

**Implications:**
- `doSetRegion` calls `pinToBottom()` instead of `scrollToBottom()` when `isFollowingBottom` is true
- No new phases, no flags, no timing hacks — works within [D93]

#### [D05] Content shrink scrolls to nearest surviving block above (DECIDED) {#d05-content-shrink}

**Decision:** When a non-tail region edit removes blocks and the user's viewport was positioned over blocks that no longer exist, scroll to the nearest surviving block above the old position (not clamp to 0, not clamp to new bottom).

**Rationale:**
- Preserves the user's place as closely as possible per L23
- Clamping to 0 or bottom would lose the user's context

**Implications:**
- After the splice in `incrementalTailUpdate`, check if `scrollTop` exceeds the new total height minus `clientHeight` and find the nearest block offset

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Forced layout performance on large blocks | med | low | `contain: content` limits reflow; only 1-3 new blocks measured | Profiling shows >5ms forced layout |
| `contain: content` breaks existing block rendering | med | low | Visual regression test after adding CSS | Any layout/overflow issues in blocks |
| Index shift bugs in htmlCache/blockNodes remapping | high | med | Targeted tests for P!=Q in non-tail regions | Stale DOM or wrong content after mid-document edit |

**Risk R01: Forced layout cost** {#r01-forced-layout}

- **Risk:** Synchronous `offsetHeight` reads trigger reflow that could be expensive for complex blocks (large tables, code blocks with syntax highlighting).
- **Mitigation:** `contain: content` CSS on `.tugx-md-block` isolates reflow to the measured subtree. Streaming chunks add 1-3 blocks at a time. Profiling gate: if measurement exceeds 5ms, investigate.
- **Residual risk:** Extremely large single blocks (>100KB code block) could still cause visible pause.

---

### Specification {#specification}

#### SmartScroll API Changes {#smartscroll-api}

**New method: `pinToBottom()`**

```typescript
/** Slam scrollTop to bottom without entering programmatic phase.
 *  Used for content growth while following bottom. Stays in idle. */
pinToBottom(): void {
  if (this._disposed) return;
  this._container.scrollTop = Number.MAX_SAFE_INTEGER;
}
```

**Modified method: `scrollToBottom()`**

```typescript
scrollToBottom(animated = false): void {
  if (this._disposed) return;
  this._setFollowingBottom(true);
  this.scrollTo({ top: Number.MAX_SAFE_INTEGER, animated });
}
```

The `scrollTo` method already handles programmatic phase entry. Setting `top: Number.MAX_SAFE_INTEGER` replaces the `scrollHeight - clientHeight` computation.

#### BlockHeightIndex API Changes {#blockheightindex-api}

**New method: `shiftFrom(startIndex, delta)`**

```typescript
/** Shift all heights from startIndex forward by delta positions.
 *  Positive delta = insert gap (shift right). Negative delta = remove (shift left).
 *  Uses Float64Array.copyWithin for efficiency. Invalidates prefix sum from startIndex. */
shiftFrom(startIndex: number, delta: number): void
```

Behavior:
- When `delta > 0`: shift heights at `[startIndex, count)` right by `delta` positions. The gap at `[startIndex, startIndex+delta)` is left uninitialized (caller must set them). `_count` increases by `delta`.
- When `delta < 0`: shift heights at `[startIndex, count)` left by `|delta|` positions, overwriting `[startIndex+delta, startIndex)`. `_count` decreases by `|delta|`.
- Invalidates prefix sum from `min(startIndex, startIndex+delta)`.
- Grows capacity if needed (delta > 0 and count + delta > capacity).

#### incrementalTailUpdate Changes {#incremental-update-changes}

When `P != Q` for a non-tail region at block index `S`:

1. **Height array:** Call `engine.heightIndex.shiftFrom(S + P, Q - P)` to shift subsequent heights.
2. **htmlCache:** Iterate entries with key >= `S + P`. Re-insert with key + `(Q - P)`. Delete old keys.
3. **blockNodes:** Iterate entries with key >= `S + P`. Re-insert with key + `(Q - P)`. Update `el.dataset.blockIndex = String(newKey)`. Delete old keys.
4. **regionBlockRanges:** For all regions after the current one, add `(Q - P)` to their `start` value.
5. **blockStarts/blockEnds:** Already handled by `Array.prototype.splice()`.

**Synchronous measurement (tail-append path):**

After adding new block nodes to DOM via `addBlockNode`, before setting `scrollTop`:

```
for each new block index i:
  const el = engine.blockNodes.get(i)
  if (el) engine.heightIndex.setHeight(i, el.offsetHeight)  // forced layout
recompute spacers with real heights
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none) | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `pinToBottom()` | method | `tugdeck/src/lib/smart-scroll.ts` | New public method. Sets `scrollTop = MAX_SAFE_INTEGER`, stays in idle phase |
| `scrollToBottom()` | method | `tugdeck/src/lib/smart-scroll.ts` | Modified: uses `MAX_SAFE_INTEGER` instead of `scrollHeight - clientHeight` |
| `shiftFrom(startIndex, delta)` | method | `tugdeck/src/lib/block-height-index.ts` | New public method. `Float64Array.copyWithin` + prefix sum invalidation |
| `incrementalTailUpdate()` | function | `tugdeck/src/components/tugways/tug-markdown-view.tsx` | Modified: synchronous measurement, inline index shift for non-tail regions |
| `doSetRegion()` | function | `tugdeck/src/components/tugways/tug-markdown-view.tsx` | Modified: removes `!isLast` gate, calls `pinToBottom()` instead of `scrollToBottom()` |
| ResizeObserver callback | closure | `tugdeck/src/components/tugways/tug-markdown-view.tsx` | Modified: slams `scrollTop = MAX_SAFE_INTEGER` when `isFollowingBottom` |
| `.tugx-md-block` | CSS rule | `tugdeck/src/components/tugways/tug-markdown-view.css` | Modified: adds `contain: content` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `shiftFrom` edge cases on BlockHeightIndex | New method with typed-array internals |
| **Unit** | Test `pinToBottom` does not change phase | New method with specific phase semantics |
| **Integration** | Test non-tail region edit preserves subsequent blocks | End-to-end index shift correctness |

---

### Execution Steps {#execution-steps}

#### Step 1: Slam scrollTop with MAX_SAFE_INTEGER (Sub-problem 2b) {#step-1}

**Commit:** `fix(smart-scroll): use Number.MAX_SAFE_INTEGER in scrollToBottom`

**References:** [D01] Both scrollToBottom and pinToBottom use MAX_SAFE_INTEGER, (#smartscroll-api, #context)

**Artifacts:**
- Modified `tugdeck/src/lib/smart-scroll.ts`

**Tasks:**
- [ ] In `scrollToBottom()`, replace `const target = this._container.scrollHeight - this._container.clientHeight; this.scrollTo({ top: target, animated });` with `this.scrollTo({ top: Number.MAX_SAFE_INTEGER, animated });`
- [ ] Search the codebase for any other `scrollHeight - clientHeight` patterns used to compute "scroll to bottom" and replace with `Number.MAX_SAFE_INTEGER` if found
- [ ] In `smart-scroll.test.ts`, update the `makeContainer` helper's `scrollTop` setter to clamp values to `Math.min(v, scrollHeight - clientHeight)`, mimicking browser behavior. The setter line `(el as unknown as Record<string, number>)._scrollTop = v;` becomes `(el as unknown as Record<string, number>)._scrollTop = Math.min(v, raw._scrollHeight - raw._clientHeight);` (using the `raw` reference already in scope). This ensures `scrollToBottom` with `MAX_SAFE_INTEGER` produces the expected clamped value.
- [ ] Update the test "scrollToBottom writes scrollTop to scrollHeight - clientHeight" assertion: it should still expect `200` (500 - 300) because the mock now clamps, matching browser behavior

**Tests:**
- [ ] Existing `smart-scroll.test.ts` tests pass after mock container scrollTop clamping fix (scrollToBottom produces clamped value matching browser behavior)

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/smart-scroll.test.ts` passes
- [ ] `grep -rn 'scrollHeight.*clientHeight' tugdeck/src/` returns no scroll-to-bottom computation sites (only read-only checks like `isAtBottom` remain)

---

#### Step 2: Add pinToBottom method (Sub-problem 2c, part 1) {#step-2}

**Depends on:** #step-1

**Commit:** `feat(smart-scroll): add pinToBottom for idle-phase content growth scroll`

**References:** [D01] Both scrollToBottom and pinToBottom use MAX_SAFE_INTEGER, [D04] pinToBottom works within the state machine, (#smartscroll-api, #strategy)

**Artifacts:**
- Modified `tugdeck/src/lib/smart-scroll.ts`
- Modified `tugdeck/src/__tests__/smart-scroll.test.ts`

**Tasks:**
- [ ] Add `pinToBottom()` public method to `SmartScroll`: sets `this._container.scrollTop = Number.MAX_SAFE_INTEGER` without calling `_enterProgrammatic()`. Guard with `if (this._disposed) return;`
- [ ] Add test: calling `pinToBottom()` when phase is `idle` leaves phase as `idle`
- [ ] Add test: `pinToBottom()` sets `scrollTop` to the container's maximum scrollable distance

**Tests:**
- [ ] `pinToBottom()` when idle leaves phase as idle
- [ ] `pinToBottom()` sets scrollTop to max scrollable distance

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/smart-scroll.test.ts` passes

---

#### Step 3: Synchronous measurement and pinToBottom wiring (Sub-problem 2c, part 2) {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tug-markdown-view): synchronous block measurement and pinToBottom wiring`

**References:** [D03] Synchronous measurement in incrementalTailUpdate only, [D04] pinToBottom works within the state machine, (#incremental-update-changes, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`
- Modified `tugdeck/src/components/tugways/tug-markdown-view.css`

**Tasks:**
- [ ] In `incrementalTailUpdate`, after the "Append new blocks" section adds nodes via `addBlockNode`, add synchronous measurement loop: for each newly-appended block index (from `S + P` to `S + Q - 1`), read `el.offsetHeight` from `engine.blockNodes.get(globalIdx)` and call `engine.heightIndex.setHeight(globalIdx, realHeight)`. This replaces the estimate with the real height before spacers are computed.
- [ ] In `doSetRegion`, replace `smartScrollRef.current.scrollToBottom()` with `smartScrollRef.current.pinToBottom()` when `isFollowingBottom` is true
- [ ] In the ResizeObserver callback (block measurement observer), after `applySpacers`, add: if `smartScrollRef.current?.isFollowingBottom && scrollContainerRef.current`, set `scrollContainerRef.current.scrollTop = Number.MAX_SAFE_INTEGER`
- [ ] In `tug-markdown-view.css`, add `contain: content;` to the `.tugx-md-block` rule

**Tests:**
- [ ] Existing `do-set-region-wiring.test.ts` and `incremental-tail-update.test.ts` pass (wiring changes verified by existing coverage)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (all existing tests)
- [ ] `grep -n 'contain: content' tugdeck/src/components/tugways/tug-markdown-view.css` shows the new CSS property

---

#### Step 4: Sub-problem 2c Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Both scrollToBottom and pinToBottom use MAX_SAFE_INTEGER, [D03] Synchronous measurement in incrementalTailUpdate only, [D04] pinToBottom works within the state machine, (#success-criteria)

**Tasks:**
- [ ] Verify `scrollToBottom()` uses `MAX_SAFE_INTEGER` internally
- [ ] Verify `pinToBottom()` exists and stays in idle phase
- [ ] Verify `doSetRegion` calls `pinToBottom()` not `scrollToBottom()` when following bottom
- [ ] Verify ResizeObserver slams `scrollTop` when `isFollowingBottom`
- [ ] Verify `.tugx-md-block` has `contain: content`

**Tests:**
- [ ] All existing tests pass as aggregate verification

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `grep -n 'pinToBottom' tugdeck/src/components/tugways/tug-markdown-view.tsx` shows wiring
- [ ] `grep -n 'MAX_SAFE_INTEGER' tugdeck/src/lib/smart-scroll.ts` shows usage in both methods

---

#### Step 5: Add shiftFrom to BlockHeightIndex (Sub-problem 2a, part 1) {#step-5}

**Depends on:** #step-4

**Commit:** `feat(block-height-index): add shiftFrom for in-place height array shift`

**References:** [D02] shiftFrom handles only BlockHeightIndex, (#blockheightindex-api, #strategy)

**Artifacts:**
- Modified `tugdeck/src/lib/block-height-index.ts`
- Modified `tugdeck/src/__tests__/block-height-index.test.ts`

**Tasks:**
- [ ] Add `shiftFrom(startIndex: number, delta: number): void` to `BlockHeightIndex`. Implementation: if `delta > 0`, grow if needed, use `this._heights.copyWithin(startIndex + delta, startIndex, this._count)`, increment `_count` by `delta`. If `delta < 0`, use `copyWithin(startIndex + delta, startIndex, this._count)`, decrement `_count` by `|delta|`. In both cases, invalidate the prefix sum by setting the watermark to `Math.min(startIndex, startIndex + delta)` — do not shift `_prefixSum`, only invalidate it.
- [ ] Add tests: shift right by 2 from middle — verify heights before shift point unchanged, heights after shift point moved, count increased
- [ ] Add tests: shift left by 1 from middle — verify heights compacted, count decreased
- [ ] Add test: shift that requires capacity growth

**Tests:**
- [ ] shiftFrom right by 2 — heights before shift point unchanged, heights after moved, count increased
- [ ] shiftFrom left by 1 — heights compacted, count decreased
- [ ] shiftFrom with capacity growth

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/block-height-index.test.ts` passes

---

#### Step 6: Generalize incrementalTailUpdate to any region (Sub-problem 2a, part 2) {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tug-markdown-view): generalize incrementalTailUpdate to non-tail regions`

**References:** [D02] shiftFrom handles only BlockHeightIndex, [D05] Content shrink scrolls to nearest surviving block above, (#incremental-update-changes, #scope)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`

**Tasks:**
- [ ] In `incrementalTailUpdate`, restructure the `P != Q` branches for non-tail regions. The existing tail-only code uses `heightIndex.truncate` (Q<P) and `heightIndex.appendBlock` (Q>P) which assume tail position. Replace these with `shiftFrom` when the region is not the last region:
  - **Content shrink (Q < P, non-tail):** (1) First, remove excess DOM nodes and `htmlCache` entries for block indices `[S+Q, S+P)`. (2) Then call `engine.heightIndex.shiftFrom(S + P, Q - P)` (negative delta) to compact the height array. (3) Then remap surviving `htmlCache` keys >= `S + P`: collect entries, delete old keys, re-insert with key + `(Q - P)`. (4) Remap surviving `blockNodes` keys >= `S + P`: collect entries, delete old keys, re-insert with key + `(Q - P)`, update `el.dataset.blockIndex = String(newKey)`. (5) Update `regionBlockRanges` for all subsequent regions: add `(Q - P)` to their `start` value. Ordering is critical: remove excess entries first, then shift, then remap surviving keys.
  - **Content growth (Q > P, non-tail):** (1) Call `engine.heightIndex.shiftFrom(S + P, Q - P)` (positive delta) to open a gap. (2) Remap `htmlCache` keys >= `S + P`: collect entries, delete old keys, re-insert with key + `(Q - P)`. (3) Remap `blockNodes` keys >= `S + P`: collect entries, delete old keys, re-insert with key + `(Q - P)`, update `el.dataset.blockIndex = String(newKey)`. (4) Update `regionBlockRanges` for all subsequent regions: add `(Q - P)` to their `start` value. (5) New block indices in the gap `[S+P, S+P + (Q-P))` are populated by the normal changed-block rendering that follows.
  - **Tail regions (Q != P, isLast):** Keep existing `truncate`/`appendBlock` logic unchanged — no remapping needed for tail.
- [ ] Update `engine.blockCount` to account for the delta: `engine.blockCount += (Q - P)` instead of `engine.blockCount = S + Q`
- [ ] In `doSetRegion`, remove the `!isLast` condition so non-tail region edits also go through `incrementalTailUpdate` instead of `lexParseAndRender`. The condition becomes: `if (wasEmpty) { lexParseAndRender(...) } else { incrementalTailUpdate(...) }`
- [ ] Add content shrink scroll recovery: after the splice, if `scrollContainerRef.current` exists and `scrollTop > totalHeight - clientHeight`, find the block whose offset is closest to but not exceeding the old `scrollTop` via `engine.heightIndex.getBlockAtOffset(oldScrollTop)` and set `scrollTop` to that block's offset via `engine.heightIndex.getBlockOffset(blockIndex)`. Note: in the degenerate case where all blocks above the old position were removed, `getBlockAtOffset` naturally returns block 0, which is acceptable.

**Tests:**
- [ ] Existing `incremental-tail-update.test.ts`, `fence-propagation.test.ts`, `do-set-region-wiring.test.ts` pass (verifies no regressions in incremental path)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (all existing tests including incremental-tail-update, fence-propagation, do-set-region-wiring)
- [ ] `grep -n 'lexParseAndRender' tugdeck/src/components/tugways/tug-markdown-view.tsx` shows only cold-start (`wasEmpty`) and `removeRegion` call sites

---

#### Step 7: Sub-problem 2a Integration Checkpoint {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D02] shiftFrom handles only BlockHeightIndex, [D05] Content shrink scrolls to nearest surviving block above, (#success-criteria)

**Tasks:**
- [ ] Verify `lexParseAndRender` is called only from cold start and `removeRegion`
- [ ] Verify non-tail region edits go through `incrementalTailUpdate`
- [ ] Verify `shiftFrom` is called in `incrementalTailUpdate` when `P != Q` for non-tail regions
- [ ] Verify content shrink adjusts scroll position to nearest surviving block above

**Tests:**
- [ ] All tests pass as aggregate verification of 2a integration

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `grep -c 'lexParseAndRender' tugdeck/src/components/tugways/tug-markdown-view.tsx` shows exactly 2 call sites (cold start + removeRegion)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Streaming follow-bottom is jank-free via synchronous measurement + `pinToBottom()`, and non-tail region edits preserve scroll position via generalized `incrementalTailUpdate` with inline index shifting.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `scrollToBottom()` and `pinToBottom()` both use `Number.MAX_SAFE_INTEGER` (`grep` verification)
- [ ] `doSetRegion` calls `pinToBottom()` when following bottom, not `scrollToBottom()`
- [ ] `lexParseAndRender` called only from cold start and `removeRegion` (2 call sites)
- [ ] `BlockHeightIndex.shiftFrom()` exists with unit tests
- [ ] `contain: content` present on `.tugx-md-block`
- [ ] All existing tests pass: `cd tugdeck && bun test`

**Acceptance tests:**
- [ ] `bun test src/__tests__/smart-scroll.test.ts` — pinToBottom stays in idle phase
- [ ] `bun test src/__tests__/block-height-index.test.ts` — shiftFrom shift/compact correctness
- [ ] `bun test` — all existing tests pass (no regressions)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Performance profiling of forced layout cost with `contain: content` under load
- [ ] Consider synchronous measurement for cold-start path if block count is small
- [ ] Investigate `content-visibility: auto` as further optimization for off-screen blocks

| Checkpoint | Verification |
|------------|--------------|
| 2b complete | `grep 'MAX_SAFE_INTEGER' tugdeck/src/lib/smart-scroll.ts` shows usage |
| 2c complete | `grep 'pinToBottom' tugdeck/src/components/tugways/tug-markdown-view.tsx` shows wiring |
| 2a complete | `grep -c 'lexParseAndRender' tugdeck/src/components/tugways/tug-markdown-view.tsx` = 2 |
| All tests pass | `cd tugdeck && bun test` exits 0 |
