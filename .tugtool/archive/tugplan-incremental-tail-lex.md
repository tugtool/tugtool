<!-- tugplan-skeleton v2 -->

## Incremental Tail Lexing for TugMarkdownView {#incremental-tail-lex}

**Purpose:** Eliminate the O(n²) full-rescan pathology during streaming by scoping re-lex to the tail region only, making streaming chunk processing O(1) amortized.

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

Every streaming chunk triggers `doSetRegion('stream', accumulatedText)` which calls `incrementalUpdate()`. Despite the name, `incrementalUpdate` re-lexes the entire document on every call via `lex_blocks(text)`, builds a full byte-to-char map, and diffs all blocks. With N chunks and ~200 chars per chunk, total work is O(N²). At 1MB of accumulated text (~5000 chunks), each chunk re-lexes the full megabyte. The gallery card's lex timing climbs steadily during a stream.

The fix: on the streaming tail-append path, lex only the tail region's text instead of the entire document. Region boundaries (`\n\n` separators inserted by RegionMap) are natural parse boundaries that prevent block structures from spanning across regions (except for unclosed fenced code blocks, which are handled by lazy forward propagation).

#### Strategy {#strategy}

- Modify only the streaming tail-append path (`incrementalUpdate` called when the updated key is the last region). All other paths (first region, middle-region edits, `removeRegion`, `clear`) continue using `lexParseAndRender` as today.
- Track per-region block ranges in engine state so the tail region's block span is known without scanning.
- On tail append: extract the tail region's text from RegionMap, lex only that slice via WASM `lex_blocks` (prepending `\n\n` for block boundary context), translate byte offsets to document-global char offsets using `buildByteToCharMap` on the region slice.
- Splice new/changed tail blocks into the engine's block arrays, height index, and HTML cache. No suffix renumbering is needed because the tail region is always last.
- Lazy fence propagation: if the tail region's block structure changes in a way that implies an unbalanced fence, re-lex the next region too. Stop when blocks are unchanged.
- For any P != Q middle-region edit, fall back to full `lexParseAndRender`. This is not a regression — it matches current behavior.

#### Success Criteria (Measurable) {#success-criteria}

- Streaming lex time per chunk is constant regardless of total document size: lex time for a 1MB document with a new 200-char chunk must be under 2ms (versus ~29ms today for full rescan). Verified via `onTiming` callback.
- Total streaming throughput for 5000 chunks producing 1MB is under 5 seconds wall-clock lex time (versus ~70 seconds today). Verified via cumulative `onTiming` measurements.
- No regression in non-streaming paths: `lexParseAndRender` behavior is unchanged. Verified by existing visual tests and manual gallery card inspection.
- All existing tests and build checks continue to pass.

#### Scope {#scope}

1. Add `regionBlockRanges` map to `MarkdownEngineState` to track per-region block index ranges.
2. Implement region-scoped incremental update function that lexes only the tail region's text.
3. Translate WASM byte offsets to document-global char offsets using `buildByteToCharMap` on the region slice plus the region's char start.
4. Splice new/changed tail blocks into engine arrays (blockStarts, blockEnds, heightIndex, htmlCache).
5. Implement lazy fence propagation for unbalanced fence edge case.
6. Update `lexParseAndRender` to rebuild `regionBlockRanges` on full rebuild.
7. Update `onTiming` to report region-slice lex time for the incremental path.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Middle-region incremental updates (P != Q splice, cache remapping, `shiftFrom()`). These stay as full rebuilds.
- WASM changes to `lex_blocks` or `parse_to_html`. The WASM API is unchanged.
- Problem 2 from the roadmap (scroll jank / synchronous measurement). That is a separate plan.
- Cached fence state per region boundary. Lazy propagation is sufficient.
- Intra-region backward boundary scanning. Re-lexing the entire tail region is fast enough since regions are typically small.

#### Dependencies / Prerequisites {#dependencies}

- WASM `lex_blocks` function correctly handles region-sized text slices (confirmed: it accepts any string).
- `RegionMap.regionRange(key)` returns char offsets for extracting region text from the full document.
- `RegionMap.getRegionText(key)` returns the region's own text for lexing.
- `BlockHeightIndex.appendBlock()`, `setHeight()`, and a new `truncate()` method are sufficient for incremental updates.

#### Constraints {#constraints}

- No new external dependencies. All changes are internal to `tug-markdown-view.tsx`.
- Must maintain Laws of Tug compliance: [L06] DOM-only appearance changes, [L07] ref-based state access, [L22] direct store observer pattern.
- `buildByteToCharMap` is called once per `setRegion` call on the region slice only — acceptable overhead for the streaming path.

#### Assumptions {#assumptions}

- The streaming `'stream'` key is always the last region, so the tail-append fast path is the dominant case.
- The `wasEmpty` first-region path continues to call `lexParseAndRender` (full rebuild); the incremental path only activates after the first region is established.
- The existing `doSetRegion` `isLast` check remains the gate for choosing between `lexParseAndRender` and the new incremental region-scoped path.
- WASM `lex_blocks` returns byte offsets relative to the input slice, not absolute document offsets.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Fence propagation misses an edge case | med | low | Lazy propagation re-lexes forward until blocks stabilize; worst case falls back to full rebuild behavior | User reports garbled rendering after typing a code fence mid-stream |
| Byte offset translation error for multi-byte UTF-8 | high | low | Single `TextEncoder.encode` call computes exact byte offset; covered by test with emoji/CJK content | Block boundaries appear wrong for non-ASCII content |
| `regionBlockRanges` falls out of sync with actual blocks | high | low | Full rebuild via `lexParseAndRender` always resets `regionBlockRanges`; any corruption triggers full rebuild on next middle-region edit | Crash or wrong block content during streaming |

**Risk R01: Fence propagation edge case** {#r01-fence-propagation}

- **Risk:** An unbalanced code fence in the tail region could cause blocks in the next region to be misclassified (e.g., paragraph text rendered as code).
- **Mitigation:** After re-lexing the tail region, compare the new block structure to the old. If block count or types changed, re-lex the next region and compare again. If no next region exists (tail is last), no propagation needed. If the structure stabilizes, stop. If it does not, fall back to `lexParseAndRender`.
- **Residual risk:** The fence propagation loop could in theory re-lex all subsequent regions in a pathological document with many unbalanced fences. This is no worse than today's full-rebuild behavior.

**Risk R02: Byte offset translation error** {#r02-byte-offset-error}

- **Risk:** Incorrect byte-to-char translation could cause block text slicing to produce wrong content, leading to garbled rendered output.
- **Mitigation:** The translation uses `buildByteToCharMap(regionText)` to map region-local byte offsets to region-local char offsets, then adds `regionCharStart` for global char offsets. This is the same mapping mechanism used in the full-rebuild path. A test with multi-byte content (emoji, CJK) will verify correctness.
- **Residual risk:** None expected — `buildByteToCharMap` is a well-tested existing function.

---

### Design Decisions {#design-decisions}

#### [D01] Compute byte offsets on-the-fly per setRegion call (DECIDED) {#d01-byte-offsets-on-fly}

**Decision:** Compute document-global char offsets on-the-fly using `buildByteToCharMap(regionText)` plus the region's char start from `RegionMap.regionRange(key).start`. No new cached state in RegionMap or engine state for byte offsets.

**Rationale:**
- One `buildByteToCharMap` call per `setRegion` on the region slice is negligible compared to WASM lex time.
- Avoids adding byte-offset tracking to RegionMap, keeping the data model simple.
- The region's char start is already available via `RegionMap.regionRange(key).start`.

**Implications:**
- `buildByteToCharMap` is called on the region slice only (not the full document) for the incremental path.
- The global byte offset is added to WASM-returned block byte offsets before byte-to-char translation.
- Region-scoped lex produces identical block structure to full-document lex for the same region because RegionMap inserts `\n\n` separators between regions, guaranteeing that every region starts at a clean block boundary. To preserve this context when lexing in isolation, prepend `\n\n` to the region text before calling `lex_blocks`, then subtract 2 from all returned byte offsets. This adds only 2 bytes of overhead and ensures edge cases like indented code blocks at region start are handled correctly.

#### [D02] Lazy fence propagation instead of explicit fence counting (DECIDED) {#d02-lazy-fence-propagation}

**Decision:** After re-lexing a region, if the block structure (count and types) changed from last time, re-lex the next region too. If that region's blocks are unchanged, stop. No explicit fence counting or per-region fence balance tracking.

**Rationale:**
- Simpler implementation: no fence-counting state to maintain or invalidate.
- Correct: a fence imbalance necessarily changes the block structure of subsequent regions. Detecting "block structure changed" is a sufficient proxy for "fence balance changed."
- The rare case (unbalanced fence in a middle region) does not need to be fast.

**Implications:**
- No `regionFenceBalance` map in engine state (simpler than the roadmap's original proposal).
- The propagation loop is bounded by the number of regions and terminates when blocks stabilize.
- Worst case (all regions affected) is equivalent to a full rebuild — no regression.

#### [D03] Full rebuild for non-tail region edits (DECIDED) {#d03-full-rebuild-non-tail}

**Decision:** For any `P != Q` middle-region edit, fall back to `lexParseAndRender` (full rebuild). No `shiftFrom()`, no cache remapping, no block index splicing for middle-region edits.

**Rationale:**
- This is not a regression — it matches current behavior exactly.
- The only path that gets the incremental optimization is the streaming tail-append path.
- Implementing middle-region incremental updates (suffix renumbering, cache key remapping) adds significant complexity for a path that is rarely exercised during streaming.

**Implications:**
- `doSetRegion` continues to call `lexParseAndRender` when `!isLast` or `wasEmpty`.
- The `regionBlockRanges` map is rebuilt from scratch on every full rebuild.

#### [D04] Track per-region block ranges in engine state (DECIDED) {#d04-region-block-ranges}

**Decision:** Add `regionBlockRanges: Map<string, { start: number; count: number }>` to `MarkdownEngineState`. This maps each region key to the block index range it produced.

**Rationale:**
- The incremental path needs to know which blocks belong to the tail region so it can splice only those blocks.
- A simple map lookup is O(1) versus scanning all blocks to find the region boundary.
- The map is rebuilt on full rebuild and updated incrementally on tail append.

**Implications:**
- `lexParseAndRender` must populate `regionBlockRanges` after lexing.
- The incremental path updates the tail region's entry after splicing.
- `doClear` must clear the map.

---

### Specification {#specification}

#### Engine State Changes {#engine-state-changes}

**Table T01: New fields in MarkdownEngineState** {#t01-engine-state-fields}

| Field | Type | Description |
|-------|------|-------------|
| `regionBlockRanges` | `Map<string, { start: number; count: number }>` | Maps region key to the block index range it produced. `start` is the first block index, `count` is the number of blocks. |

#### Incremental Tail Update Algorithm {#incremental-tail-algorithm}

**Spec S01: incrementalTailUpdate procedure** {#s01-incremental-tail-update}

Given: engine state `E`, region key `K` (known to be the last region), full document text `fullText`.

1. Look up `E.regionBlockRanges.get(K)` to find `{ start: S, count: P }` — the old block range for this region.
2. Get the region's text: `regionText = E.regionMap.getRegionText(K)`.
3. Get the region's char range: `{ start: regionCharStart } = E.regionMap.regionRange(K)`.
4. Lex only the region text (prepend `\n\n` for context): `packed = lex_blocks('\n\n' + regionText)`. Decode to `newRegionBlocks`, subtracting 2 from each byte offset.
5. Build byte-to-char map for the region slice: `byteToChar = buildByteToCharMap(regionText)`.
6. Compute document-global char offsets for each new block: `charStart = regionCharStart + byteToChar[block.byteStart]`, `charEnd = regionCharStart + byteToChar[block.byteEnd]`.
7. Let `Q = newRegionBlocks.length`.
8. **Update changed existing blocks** (indices `S` to `S + min(P, Q) - 1`): compare char offsets. If changed, re-parse to HTML, update htmlCache, update heightIndex, update DOM node if present.
9. **Handle block count decrease** (`Q < P`): remove blocks `S + Q` to `S + P - 1` from blockNodes, htmlCache. Use `blockStarts.splice(S + Q, P - Q)` and `blockEnds.splice(S + Q, P - Q)` to remove the excess entries. Call `engine.heightIndex.truncate(S + Q)` to reduce the height index count (this is a new method — see Step 2 tasks).
10. **Append new blocks** (`Q > P`): for indices `S + P` to `S + Q - 1`, append to heightIndex, parse to HTML, store in htmlCache. Use `blockStarts.splice(S + P, 0, ...newStarts)` and `blockEnds.splice(S + P, 0, ...newEnds)` to insert new entries.
11. Update `E.blockCount = S + Q`.
12. Update `E.regionBlockRanges.set(K, { start: S, count: Q })`.
13. **Lazy fence check:** Compare old block structure (count and type sequence) with new. If different and there is a next region, re-lex the next region similarly. If its blocks are unchanged, stop. (In practice, for the streaming tail region which is always last, there is no next region — this check is a no-op.)
14. Report timing via `onTiming` with the region-slice lex time.
15. Rebuild visible window from current scroll position.

#### Byte Offset Translation {#byte-offset-translation}

**Spec S02: On-the-fly byte offset computation** {#s02-byte-offset-translation}

The WASM `lex_blocks(regionText)` returns byte offsets relative to the start of `regionText`. To translate to document-global char offsets:

1. `regionCharStart = E.regionMap.regionRange(K).start` — char offset of the region in the full document.
2. `byteToChar = buildByteToCharMap(regionText)` — maps byte offset within the region slice to char offset within the region slice.
3. For each block: `globalCharStart = regionCharStart + byteToChar[block.byteStart]`, `globalCharEnd = regionCharStart + byteToChar[block.byteEnd]`.

Note: no global byte offset computation is needed. The byte-to-char map on the region slice plus the region's char start is sufficient for translating WASM byte offsets to document-global char offsets.

#### Full Rebuild Integration {#full-rebuild-integration}

**Spec S03: lexParseAndRender changes** {#s03-full-rebuild-changes}

After the existing lex-parse-render cycle, `lexParseAndRender` must populate `regionBlockRanges` by walking the region map's keys and assigning block ranges. This requires mapping each block's char offset to a region via `RegionMap.regionKeyAtOffset()`.

Algorithm:
1. After lexing, iterate blocks in order.
2. For each block, determine which region it belongs to using `regionMap.regionKeyAtOffset(blockStarts[i])`.
3. Build the `regionBlockRanges` map: for each region key, record the first block index and count.
4. Store in `engine.regionBlockRanges`.

---

### Execution Steps {#execution-steps}

#### Step 1: Add regionBlockRanges to engine state and populate on full rebuild {#step-1}

**Commit:** `feat(tugdeck): add regionBlockRanges to MarkdownEngineState`

**References:** [D04] Track per-region block ranges, Table T01, Spec S03, (#engine-state-changes, #full-rebuild-integration)

**Artifacts:**
- Modified `tug-markdown-view.tsx`: new `regionBlockRanges` field in `MarkdownEngineState` interface, initialization in `getEngine()`, population in `lexParseAndRender()`, clearing in `doClear()`.

**Tasks:**
- [ ] Add `regionBlockRanges: Map<string, { start: number; count: number }>` to the `MarkdownEngineState` interface.
- [ ] Initialize `regionBlockRanges` as `new Map()` in `getEngine()`.
- [ ] In `lexParseAndRender`, after the lex-parse cycle, populate `regionBlockRanges` by iterating blocks and mapping each to its region via `regionMap.regionKeyAtOffset(blockStarts[i])`.
- [ ] In `doClear`, add `engine.regionBlockRanges.clear()`.
- [ ] In `lexParseAndRender`, add `engine.regionBlockRanges.clear()` at the start of the reset section (alongside the existing `htmlCache.clear()`, `blockStarts = []`, etc.).

**Tests:**
- [ ] Verify `regionBlockRanges` is populated after `lexParseAndRender` by inspecting engine state: region keys match expected entries with correct start/count values.

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes with no errors.
- [ ] Manual test: open gallery card, stream content, verify rendering is unchanged (full rebuild path still works).

---

#### Step 2: Implement incrementalTailUpdate function {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): implement region-scoped incremental tail lex`

**References:** [D01] Byte offsets on-the-fly, [D02] Lazy fence propagation, [D04] Region block ranges, Spec S01, Spec S02, (#incremental-tail-algorithm, #byte-offset-translation)

**Artifacts:**
- Modified `tug-markdown-view.tsx`: new `incrementalTailUpdate` function replacing the current `incrementalUpdate` for the tail-append path.

**Tasks:**
- [ ] Add a `truncate(newCount: number)` method to `BlockHeightIndex` in `block-height-index.ts`. The method sets `this._count = newCount` and invalidates the prefix sum from `newCount` onward via `this._invalidate(newCount)`. Throws `RangeError` if `newCount < 0` or `newCount > this._count`.
- [ ] Create `incrementalTailUpdate(engine: MarkdownEngineState, key: string, fullText: string)` function that implements Spec S01.
- [ ] Extract the tail region's text via `engine.regionMap.getRegionText(key)`.
- [ ] Get the region's char start via `engine.regionMap.regionRange(key)!.start`.
- [ ] Lex only the region text with context: `lex_blocks('\n\n' + regionText)`, decode blocks (subtracting 2 from each byte offset), build `buildByteToCharMap(regionText)`.
- [ ] Translate WASM byte offsets to document-global char offsets by adding `regionCharStart` to the region-local char offsets from `byteToChar`.
- [ ] Look up `engine.regionBlockRanges.get(key)` to find `{ start: S, count: P }`.
- [ ] Update changed existing blocks (compare char offsets, re-parse to HTML, update cache and height index, update DOM nodes).
- [ ] Handle block count decrease (`Q < P`): remove excess blocks from DOM, htmlCache. Use `blockStarts.splice(S + Q, P - Q)` and `blockEnds.splice(S + Q, P - Q)` to remove excess entries. Call `engine.heightIndex.truncate(S + Q)` to reduce the height index count.
- [ ] Append new blocks (`Q > P`): use `blockStarts.splice(S + P, 0, ...newStarts)` and `blockEnds.splice(S + P, 0, ...newEnds)` to insert new entries. Append to heightIndex via `appendBlock()`, parse to HTML, populate htmlCache.
- [ ] Update `engine.blockCount`, and `engine.regionBlockRanges` for the tail region.
- [ ] Report timing via `onTimingRef.current` with region-slice lex time.
- [ ] Rebuild visible window via `engine.blockWindow.update()` and `applyWindowUpdate()`.

**Tests:**
- [ ] Verify `BlockHeightIndex.truncate()` correctly reduces count and invalidates prefix sum: append 10 blocks, truncate to 5, verify `count` is 5 and `totalHeight()` reflects only the first 5 blocks.
- [ ] Verify `incrementalTailUpdate` produces correct block offsets for content with multi-byte UTF-8 characters (emoji, CJK).

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes with no errors.

---

#### Step 3: Wire incrementalTailUpdate into doSetRegion {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): wire incremental tail lex into streaming path`

**References:** [D03] Full rebuild for non-tail, Spec S01, (#assumptions, #strategy)

**Artifacts:**
- Modified `tug-markdown-view.tsx`: `doSetRegion` calls `incrementalTailUpdate` instead of `incrementalUpdate` for the `isLast` path. Old `incrementalUpdate` function is removed.

**Tasks:**
- [ ] In `doSetRegion`, replace the `incrementalUpdate(engine, fullText)` call in the `isLast` branch with `incrementalTailUpdate(engine, key, fullText)`.
- [ ] Handle the edge case where `regionBlockRanges` does not yet have an entry for the key (first update to this region after a full rebuild that somehow missed it): fall back to `lexParseAndRender`.
- [ ] Remove the old `incrementalUpdate` function (it is fully replaced by `incrementalTailUpdate`).
- [ ] Verify that `wasEmpty` and `!isLast` branches still call `lexParseAndRender` unchanged.

**Tests:**
- [ ] Verify that the `isLast` branch in `doSetRegion` calls `incrementalTailUpdate` (not `lexParseAndRender`) by confirming constant lex time as document grows.

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes with no errors.
- [ ] Manual test: open gallery card, stream a long document (>100 chunks). Verify that rendering is correct and lex time per chunk (from onTiming) stays constant as document grows.
- [ ] Manual test: stream content with a fenced code block that spans multiple chunks. Verify code block renders correctly.
- [ ] Manual test: use imperative `setRegion` to update a middle region. Verify full rebuild occurs and content is correct.

---

#### Step 4: Implement lazy fence propagation {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add lazy fence propagation for unbalanced code fences`

**References:** [D02] Lazy fence propagation, Risk R01, (#incremental-tail-algorithm)

**Artifacts:**
- Modified `tug-markdown-view.tsx`: fence propagation logic in `incrementalTailUpdate`.

**Tasks:**
- [ ] After re-lexing the tail region in `incrementalTailUpdate`, compare the new block structure (count and type sequence) with the old cached structure.
- [ ] Store the previous block types for the region as part of the comparison (derive from the blocks that were in `S..S+P-1` before the update — can compare against cached htmlCache keys or store type info in regionBlockRanges).
- [ ] If block structure changed and there is a next region in `engine.regionMap.keys`, re-lex that next region using the same region-scoped approach.
- [ ] If the next region's blocks are unchanged after re-lex, stop propagation.
- [ ] If the next region's blocks also changed, continue propagation to the following region.
- [ ] If propagation reaches the end of regions or all regions are re-lexed, stop.
- [ ] Note: for the streaming path where the tail region is always last, there is no next region — this code path is a no-op in the common case. This is forward-looking defensive code that ensures correctness if `incrementalTailUpdate` is ever called for a non-last region. It cannot be exercised via the described manual tests in this plan.

**Tests:**
- [ ] Verify fence propagation logic compiles and does not regress the streaming path (covered by Step 3 manual tests and type checking).

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes with no errors.
- [ ] Manual test: stream content that opens a code fence without closing it, then close it in a subsequent chunk. Verify that blocks after the fence closure render correctly.

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Byte offsets on-the-fly, [D02] Lazy fence propagation, [D03] Full rebuild for non-tail, [D04] Region block ranges, (#success-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-4 are complete and work together end-to-end.
- [ ] Verify streaming tail-append path uses `incrementalTailUpdate` and reports constant lex time.
- [ ] Verify middle-region edits still use `lexParseAndRender` full rebuild.
- [ ] Verify `regionBlockRanges` is correctly maintained across both paths.

**Tests:**
- [ ] End-to-end: stream 5000 chunks producing ~1MB, verify final lex time per chunk is under 2ms via onTiming callback.

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes with no errors.
- [ ] Manual test: stream a 1MB document. Confirm lex time per chunk (onTiming) stays under 2ms throughout.
- [ ] Manual test: stream content with emoji and CJK characters. Verify block boundaries are correct (byte offset translation works).
- [ ] Manual test: interleave imperative `setRegion` calls with streaming. Verify no corruption.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The streaming tail-append path in TugMarkdownView performs O(1) amortized work per chunk by lexing only the tail region instead of the entire document.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd tugdeck && bun run check` passes with no errors.
- [ ] Streaming lex time per chunk is constant regardless of document size (verified via onTiming: under 2ms at 1MB).
- [ ] Non-streaming paths (first region, middle-region edit, removeRegion, clear) behave identically to before.
- [ ] Multi-byte UTF-8 content (emoji, CJK) renders correctly in streamed documents.
- [ ] Fenced code blocks that span multiple streaming chunks render correctly.

**Acceptance tests:**
- [ ] Stream 5000 chunks producing ~1MB. Verify final lex time per chunk is under 2ms via onTiming callback.
- [ ] Stream content containing `` ```python\nprint("hello")\n``` `` split across chunks. Verify code block renders correctly.
- [ ] Stream content with emoji (e.g., U+1F600) at block boundaries. Verify no garbled output.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Problem 2: Synchronous measure-before-paint for scroll jank elimination (separate plan).
- [ ] Middle-region incremental updates with suffix renumbering (if profiling shows full rebuild is a bottleneck for non-streaming use cases).
- [ ] Cached fence state per region boundary for faster propagation in pathological documents.

| Checkpoint | Verification |
|------------|--------------|
| Type check | `cd tugdeck && bun run check` passes |
| Constant lex time | onTiming callback reports <2ms per chunk at 1MB document size |
| Correct rendering | Manual gallery card inspection with varied content |
