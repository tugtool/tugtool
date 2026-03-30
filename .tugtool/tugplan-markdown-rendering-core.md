<!-- tugplan-skeleton v2 -->

## Phase 3A: Markdown Rendering Core {#markdown-rendering-core}

**Purpose:** Ship a virtualized markdown rendering engine for tugdeck that handles multi-MB conversation content (observed: 110MB, 20MB, 3.4MB in real Claude Code sessions) at 60fps, with both static and streaming rendering paths.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | phase-3a-markdown-rendering-core |
| Last updated | 2026-03-29 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Claude Code sessions routinely produce multi-megabyte conversation transcripts. The current `tugdeck/src/lib/markdown.ts` renders markdown via `marked.parse()` + DOMPurify into a single DOM tree with no virtualization. This approach cannot scale to the observed data sizes — rendering 10MB+ of content into the DOM causes the browser to stall or crash.

Monaco editor solves an analogous problem for source code: it renders only the visible viewport, backed by a prefix-sum data structure for instant offset-to-line mapping. Phase 3A adapts this architecture for markdown blocks, delivering the foundational rendering engine that all subsequent conversation UI phases build upon.

#### Strategy {#strategy}

- Build the `BlockHeightIndex` data structure first — it is the single most important piece and has no dependencies.
- Build `RenderedBlockWindow` (sliding window of DOM nodes) second — it consumes `BlockHeightIndex`.
- Implement the static rendering path (full content available) before the streaming path — it is simpler and exercises the full pipeline.
- Implement the streaming rendering path (live deltas) last — it builds on all prior work.
- Deliver a standalone `tug-markdown-view` component that demonstrates both paths in a gallery card. It does not replace or modify the archived ConversationCard.
- Follow Laws of Tug strictly: L02 for external state, L06 for appearance via CSS/DOM, L05 for RAF discipline, L19 for component authoring.

#### Success Criteria (Measurable) {#success-criteria}

- DOM node count stays bounded regardless of content size — verified with 10MB+ test content (count DOM children of scroll container, expect < 500 regardless of total block count)
- Static: 1MB renders viewport-visible in <200ms. 10MB viewport-visible in <1s. Scrollbar accurate within 5% before full measurement.
- Streaming: 60fps, no jank for 5000+ words of live deltas (measure via `PerformanceObserver` long task detection)
- Scroll through 10MB content at 60fps — no dropped frames (gallery card manual verification)
- `BlockHeightIndex.getBlockAtOffset()` completes in <1ms for 100K blocks (unit test with `performance.now()`)
- Laws compliance: L02, L05, L06, L19

#### Scope {#scope}

1. `BlockHeightIndex`: Float64Array prefix sum with lazy recomputation, binary search for offset-to-block mapping
2. `RenderedBlockWindow`: viewport-only DOM rendering with sliding window, overscan, dirty tracking, spacer elements
3. Static rendering path: `marked.lexer()` to block list, chunked lexing for large content via `requestIdleCallback`
4. Streaming rendering path: delta accumulation via PropertyStore [L02], incremental tail lexing, auto-scroll
5. `tug-markdown-view` component (L19 compliant) composing the data structures
6. Unit tests for pure data structures, gallery card for visual/perf verification

#### Non-goals (Explicitly out of scope) {#non-goals}

- Content-type-specific rendering (code block highlighting, thinking blocks, tool use display) — Phase 3B
- Replacing or modifying the archived ConversationCard
- Theme-aware height estimation (hardcoded constants suffice; Phase 3B refines after measurement)
- Syntax highlighting (Shiki integration is Phase 3B)
- Prompt input or conversation wiring (Phases 4, 5)

#### Dependencies / Prerequisites {#dependencies}

- `marked` package already available in tugdeck (used by existing `markdown.ts`)
- PropertyStore [L02] exists at `tugdeck/src/components/tugways/property-store.ts`
- Verified transport from Phases 2, 2b, 2c (delta model from Phase 1 exploration)

#### Constraints {#constraints}

- L02: External state enters React through `useSyncExternalStore` only — streaming text buffer uses PropertyStore
- L05: No RAF for React state commits — RAF only for scroll/frame loop
- L06: Appearance changes via CSS and DOM, never React state — spacer heights and block visibility managed via DOM, not React state
- L19: Component follows component authoring guide (docstring, props, data-slot, file pair)
- Must not break existing `markdown.ts` — the new engine is additive

#### Assumptions {#assumptions}

- `marked.lexer()` is available via the existing `marked` dependency and requires no new package installation
- Hardcoded height constants (line height, heading heights, code line height) are sufficient for Phase 3A; theme-awareness is a Phase 3B refinement
- The two-path engine coexists in a single BlockHeightIndex and RenderedBlockWindow — static blocks occupy indices 0..N-k, the active streaming block occupies the tail
- L05 is respected: RAF is used only for the scroll event / frame loop, not for triggering React state updates
- The engine delivers a standalone, demonstrable component that Phase 3B will wire into the conversation flow

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Chunked lexing threshold (DECIDED) {#q01-chunked-lexing-threshold}

**Question:** At what content size should the static path switch from synchronous `marked.lexer()` to chunked lexing via `requestIdleCallback`?

**Why it matters:** Too low a threshold adds complexity for small content; too high risks blocking the main thread.

**Options (if known):**
- 256KB: conservative, always safe
- 1MB: matches the performance target boundary

**Plan to resolve:** Use 1MB as the threshold per the roadmap specification. Profile during implementation if needed.

**Resolution:** DECIDED (see [D05])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Height estimation inaccuracy causes scrollbar jump | med | high | Measure-and-refine cycle; 5% tolerance | Scrollbar jumps exceed 5% in gallery card testing |
| `marked.lexer()` output changes between versions | high | low | Pin `marked` version; add type assertions on token shapes | `marked` dependency update |
| Streaming incremental lex produces different blocks than full lex | high | med | Finalization pass on `turn_complete` re-lexes from last stable boundary | Diff between streaming and static block lists in tests |

**Risk R01: Height estimation drift** {#r01-height-drift}

- **Risk:** Estimated block heights diverge significantly from measured heights, causing visible scrollbar jumps when blocks enter the viewport and get measured.
- **Mitigation:**
  - Conservative estimates per block type (paragraph, heading, code, hr)
  - Measure-and-refine cycle updates BlockHeightIndex as blocks render
  - Prefix sum recomputation is lazy (only from the dirty watermark forward)
- **Residual risk:** First scroll through unmeasured content will have some scrollbar adjustment. Acceptable for Phase 3A; Phase 3B can add predictive estimation.

**Risk R02: Streaming lex consistency** {#r02-streaming-lex-consistency}

- **Risk:** Incremental tail lexing during streaming produces a different block sequence than lexing the full accumulated text.
- **Mitigation:**
  - Re-lex from the *start* of the last block on each update (not the end), so boundary shifts in the last 1-2 blocks are caught immediately
  - On `turn_complete`, perform a finalization pass: re-lex the full tail region and reconcile
  - Unit tests compare streaming-path block output against static-path output for the same content
- **Residual risk:** Brief visual flicker during finalization if block boundaries shift beyond the last 1-2 blocks. Acceptable.

---

### Design Decisions {#design-decisions}

#### [D01] Float64Array prefix sum with lazy recomputation (DECIDED) {#d01-prefix-sum}

**Decision:** BlockHeightIndex stores per-block heights in a Float64Array with a lazily-computed prefix sum. A validity watermark tracks the lowest dirty index; recomputation runs only from the watermark forward.

**Rationale:**
- Float64Array gives cache-friendly contiguous memory and avoids object overhead for 100K+ blocks
- Lazy recomputation avoids O(n) work on every height update — only O(k) where k is blocks after the watermark
- Binary search on the prefix sum gives O(log n) offset-to-block mapping

**Implications:**
- Height updates must set the watermark to min(current watermark, updated index)
- `getBlockAtOffset()` and `getTotalHeight()` trigger recomputation if watermark is dirty
- Array must be growable (reallocate and copy when capacity exceeded)

#### [D02] Sliding window with overscan (DECIDED) {#d02-sliding-window}

**Decision:** RenderedBlockWindow maintains a contiguous range [startIndex, endIndex) of blocks with DOM nodes. On scroll, it computes the new visible range from BlockHeightIndex, diffs against the current window, adds entering blocks, and removes exiting blocks. Overscan of 2 screens above and below the viewport.

**Rationale:**
- Viewport-only DOM keeps node count bounded regardless of content size
- 2-screen overscan prevents flicker during fast scrolling
- Diff-based update avoids rebuilding unchanged blocks

**Implications:**
- Spacer elements above and below the window must be resized from the prefix sum on every scroll
- Blocks that remain in the window but changed content need a dirty flag to trigger DOM update
- Blocks are in normal document flow between the top and bottom spacer divs — spacers provide the scroll-height padding that makes the scrollbar accurate. No CSS `transform: translateY()` is needed for block positioning; the spacers handle the offset.

#### [D03] Lib + component split (DECIDED) {#d03-lib-component-split}

**Decision:** Pure data structures (`BlockHeightIndex`, `RenderedBlockWindow`) live in `tugdeck/src/lib/`. The React component (`tug-markdown-view.tsx/.css`) lives in `tugdeck/src/components/tugways/` and composes them.

**Rationale:**
- Data structures are framework-agnostic and independently testable
- Component follows L19 conventions (file pair, docstring, props, data-slot)
- Clean separation of concerns: data structures handle perf-critical logic, component handles DOM lifecycle

**Implications:**
- Unit tests target `lib/` files directly (no React test renderer needed)
- Component imports from `../../lib/block-height-index` etc.

#### [D04] Both full strings and raw deltas (DECIDED) {#d04-input-format}

**Decision:** The streaming path accepts full running strings as the primary API and also handles raw character deltas for future flexibility.

**Rationale:**
- Full strings match the `assistant_text` delta model from Phase 1 (deltas are string chunks, not character-level)
- Raw delta support is trivial once string accumulation exists (just append)
- Future-proofs against transport changes without API break

**Implications:**
- PropertyStore holds the accumulated text as a single string value
- On each update, the streaming path re-lexes only from the last stable block boundary
- Full string updates diff against previous length to find the new content

#### [D05] Hardcoded height constants (DECIDED) {#d05-height-constants}

**Decision:** Height estimation uses hardcoded constants per block type. A paragraph is `lineCount * LINE_HEIGHT`. A heading is a known value per level. Code blocks are `lineCount * CODE_LINE_HEIGHT + HEADER_HEIGHT`. An hr is a fixed value.

**Rationale:**
- Fastest to ship — no theme measurement needed
- Phase 3B refines heights after measurement anyway (measure-and-refine cycle)
- Constants are gathered in one file for easy tuning

**Implications:**
- Export constants from a dedicated module (e.g., `block-height-constants.ts` or top of `block-height-index.ts`)
- TODO comment for theme-awareness in Phase 3B
- Scrollbar accuracy before measurement depends on constant quality — target 5% accuracy

#### [D06] Chunked lexing via requestIdleCallback for large static content (DECIDED) {#d06-chunked-lexing}

**Decision:** For static content >1MB, lex in chunks via `requestIdleCallback` to avoid blocking the main thread. Content below the threshold is lexed synchronously.

**Rationale:**
- 1MB threshold matches the performance target boundary in the roadmap spec
- `requestIdleCallback` yields to the browser between chunks, keeping the UI responsive
- Below 1MB, synchronous lexing is fast enough (<200ms target)

**Implications:**
- The component must handle a partially-lexed state (render available blocks, show the rest as they become available)
- Chunking strategy: lex the full content synchronously (the lexer is fast — CPU cost is in DOM rendering), then yield via `requestIdleCallback` between rendering batches of already-lexed tokens. This avoids the problem of splitting raw text on double-newline boundaries, which would break fenced code blocks that contain blank lines.
- Fallback: `setTimeout(fn, 0)` for browsers without `requestIdleCallback`

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: BlockHeightIndex API** {#s01-block-height-index-api}

```typescript
class BlockHeightIndex {
  constructor(initialCapacity?: number);

  /** Add a block with an estimated height. Returns the block index. */
  appendBlock(estimatedHeight: number): number;

  /** Update the height of an existing block (e.g., after measurement). */
  setHeight(index: number, height: number): void;

  /** Get the height of a single block. */
  getHeight(index: number): number;

  /** Binary search: given a scroll offset, return the index of the first block at or past that offset. */
  getBlockAtOffset(offset: number): number;

  /** Get the Y offset of a block (sum of all heights before it). */
  getBlockOffset(index: number): number;

  /** Total height of all blocks (drives scroll container sizing). */
  getTotalHeight(): number;

  /** Number of blocks currently tracked. */
  get count(): number;

  /** Remove all blocks (reset). */
  clear(): void;
}
```

**Spec S02: RenderedBlockWindow API** {#s02-rendered-block-window-api}

```typescript
interface BlockRange {
  startIndex: number;  // inclusive
  endIndex: number;    // exclusive
}

interface WindowUpdate {
  enter: BlockRange[];   // ranges to add to DOM
  exit: BlockRange[];    // ranges to remove from DOM
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

class RenderedBlockWindow {
  constructor(heightIndex: BlockHeightIndex, viewportHeight: number, overscanScreens?: number);

  /** Given a scroll offset, compute the new window and diff against current. */
  update(scrollTop: number): WindowUpdate;

  /** Current rendered range. */
  get currentRange(): BlockRange;

  /** Mark a block as dirty (content changed, needs DOM rebuild). */
  markDirty(index: number): void;

  /** Check if a block is dirty. */
  isDirty(index: number): boolean;

  /** Clear dirty flag after DOM update. */
  clearDirty(index: number): void;

  /** Update viewport height (e.g., on resize). */
  setViewportHeight(height: number): void;
}
```

**Spec S03: TugMarkdownView props** {#s03-tug-markdown-view-props}

```typescript
export interface TugMarkdownViewProps {
  /** Full markdown content for static rendering. Mutually exclusive with streaming mode. */
  content?: string;
  /** PropertyStore path for streaming text. When set, component enters streaming mode. */
  streamingStore?: PropertyStore;
  /** PropertyStore path key for the streaming text value. Default: "text". */
  streamingPath?: string;
  /** Whether the stream is active (auto-scroll to tail). */
  isStreaming?: boolean;
  /** Callback when a block enters the viewport and is measured. */
  onBlockMeasured?: (index: number, measuredHeight: number) => void;
  /** CSS class for the scroll container. */
  className?: string;
}
```

**Spec S04: Streaming PropertyStore schema and caller usage** {#s04-streaming-store-schema}

The `streamingStore` prop expects a `PropertyStore` constructed with a schema that includes at least one `string` path for the accumulated text. The `streamingPath` prop (default `"text"`) identifies which path holds the streaming content.

**Required schema shape:**

```typescript
// Caller creates the store matching the actual PropertyStoreOptions interface:
const store = new PropertyStore({
  schema: [
    { path: "text", type: "string", label: "Streaming text" },
  ],
  initialValues: { text: "" },
});

// To drive streaming, the caller updates the store as deltas arrive:
store.set("text", accumulatedText, "transport");

// Pass to TugMarkdownView:
<TugMarkdownView
  streamingStore={store}
  streamingPath="text"      // optional, defaults to "text"
  isStreaming={true}         // enables auto-scroll to tail
/>

// On turn_complete, set isStreaming to false to trigger finalization.
```

Note: `PropertyDescriptor` requires a `label` field and has no `defaultValue` field. Initial values are provided via the separate `initialValues` record in `PropertyStoreOptions`.

The gallery card demo (Step 5) creates this store and drives it with simulated deltas at a realistic rate to exercise the full streaming path.

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| Block | A top-level markdown element as returned by `marked.lexer()`: paragraph, heading, code, blockquote, list, table, hr, html, space |
| Block height | The vertical space a block occupies in pixels — estimated before render, measured after |
| Prefix sum | Array where `prefixSum[i]` = sum of heights for blocks 0..i-1. Gives O(1) offset lookup for any block. |
| Watermark | The lowest index in BlockHeightIndex whose prefix sum is invalid and needs recomputation |
| Window | The contiguous range of blocks currently rendered into the DOM |
| Overscan | Extra blocks rendered above and below the visible viewport to prevent flicker during scrolling |
| Stable block boundary | The start offset of the last block in the source text. On new streaming content, re-lex from this offset (not the end) to handle boundary shifts. The last 1-2 blocks may be re-lexed on every update; the finalization pass on `turn_complete` provides the safety net. |

#### Internal Architecture {#internal-architecture}

**Table T01: Component architecture** {#t01-component-architecture}

| Layer | File | Responsibility |
|-------|------|---------------|
| Data: height index | `tugdeck/src/lib/block-height-index.ts` | Float64Array prefix sum, binary search, height tracking |
| Data: block window | `tugdeck/src/lib/rendered-block-window.ts` | Viewport calculation, window diff, dirty tracking |
| Component | `tugdeck/src/components/tugways/tug-markdown-view.tsx` | React lifecycle, DOM management, scroll handling, PropertyStore integration |
| Styles | `tugdeck/src/components/tugways/tug-markdown-view.css` | Scroll container, spacer, block positioning |

**List L01: Block types** {#l01-block-types}

Supported `marked.lexer()` token types mapped to blocks:
1. `paragraph` — text content
2. `heading` (levels 1-6) — section headers
3. `code` — fenced or indented code blocks (rendered as plain `<pre>` in Phase 3A; Shiki in Phase 3B)
4. `blockquote` — quoted text
5. `list` — ordered and unordered lists
6. `table` — GFM tables
7. `hr` — horizontal rules
8. `html` — raw HTML (sanitized)
9. `space` — blank lines between blocks (collapsed, zero height)

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/block-height-index.ts` | BlockHeightIndex class — Float64Array prefix sum with lazy recomputation |
| `tugdeck/src/lib/rendered-block-window.ts` | RenderedBlockWindow class — sliding window viewport management |
| `tugdeck/src/components/tugways/tug-markdown-view.tsx` | TugMarkdownView component — composes data structures into React component |
| `tugdeck/src/components/tugways/tug-markdown-view.css` | TugMarkdownView styles — scroll container, spacers, block positioning |
| `tugdeck/src/__tests__/block-height-index.test.ts` | Unit tests for BlockHeightIndex |
| `tugdeck/src/__tests__/rendered-block-window.test.ts` | Unit tests for RenderedBlockWindow |
| `tugdeck/src/components/tugways/cards/gallery-markdown-view.tsx` | Gallery card for TugMarkdownView visual/perf verification |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `BlockHeightIndex` | class | `lib/block-height-index.ts` | Core prefix sum data structure |
| `RenderedBlockWindow` | class | `lib/rendered-block-window.ts` | Viewport window manager |
| `BlockRange` | interface | `lib/rendered-block-window.ts` | Start/end index pair |
| `WindowUpdate` | interface | `lib/rendered-block-window.ts` | Diff result for DOM updates |
| `TugMarkdownView` | component | `tugways/tug-markdown-view.tsx` | React component |
| `TugMarkdownViewProps` | interface | `tugways/tug-markdown-view.tsx` | Component props |
| `LINE_HEIGHT`, `CODE_LINE_HEIGHT`, `HEADING_HEIGHTS`, `HR_HEIGHT`, `CODE_HEADER_HEIGHT` | const | `lib/block-height-index.ts` | Height estimation constants [D05] |
| `GalleryMarkdownView` | component | `tugways/cards/gallery-markdown-view.tsx` | Gallery card for visual/perf verification |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test BlockHeightIndex and RenderedBlockWindow in isolation | Core algorithms: prefix sum correctness, binary search, window diffing, dirty tracking |
| **Integration** | Gallery card manual verification | Visual/perf: scrolling, streaming, DOM node count, frame rate |

Tests focus on the two pure data structure classes. The component is verified via the gallery card and checkpoint commands (build, lint). Per the "less is more" principle, no separate component test suite — the data structures carry the correctness guarantees, and the component is a thin composition layer.

---

### Execution Steps {#execution-steps}

#### Step 1: BlockHeightIndex — prefix sum data structure {#step-1}

**Commit:** `feat(tugdeck): add BlockHeightIndex prefix sum data structure`

**References:** [D01] Float64Array prefix sum, [D05] hardcoded height constants, Spec S01, (#inputs-outputs, #terminology)

**Artifacts:**
- `tugdeck/src/lib/block-height-index.ts`
- `tugdeck/src/__tests__/block-height-index.test.ts`

**Tasks:**
- [ ] Create `block-height-index.ts` implementing the Spec S01 API
- [ ] Float64Array with configurable initial capacity (default 1024), double-on-grow strategy
- [ ] Lazy prefix sum: validity watermark, recompute only from watermark forward on access
- [ ] `getBlockAtOffset()`: binary search on prefix sum array
- [ ] `getBlockOffset()`: read directly from prefix sum array
- [ ] `getTotalHeight()`: last prefix sum entry
- [ ] `appendBlock()`: append height, invalidate watermark
- [ ] `setHeight()`: update height at index, set watermark to min(current, index)
- [ ] `clear()`: reset count and watermark
- [ ] Export height estimation constants: `LINE_HEIGHT`, `CODE_LINE_HEIGHT`, `HEADING_HEIGHTS` (array by level), `HR_HEIGHT`, `CODE_HEADER_HEIGHT`
- [ ] TODO comment on constants for Phase 3B theme-awareness

**Tests:** (import from `bun:test`, matching project convention — not vitest)
- [ ] Append blocks, verify `getTotalHeight()` equals sum of heights
- [ ] `getBlockAtOffset()` returns correct index for various scroll offsets (start, middle, end, exact boundary)
- [ ] `getBlockOffset()` returns correct Y offset for each block
- [ ] `setHeight()` correctly invalidates and recomputes prefix sum
- [ ] Binary search performance: 100K blocks, `getBlockAtOffset()` < 1ms
- [ ] Array growth: append beyond initial capacity, verify correctness after reallocation

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/block-height-index.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

---

#### Step 2: RenderedBlockWindow — sliding window viewport manager {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add RenderedBlockWindow sliding window manager`

**References:** [D02] sliding window with overscan, Spec S02, (#internal-architecture, #terminology)

**Artifacts:**
- `tugdeck/src/lib/rendered-block-window.ts`
- `tugdeck/src/__tests__/rendered-block-window.test.ts`

**Tasks:**
- [ ] Create `rendered-block-window.ts` implementing the Spec S02 API
- [ ] Constructor takes a `BlockHeightIndex` reference, viewport height, and overscan multiplier (default 2)
- [ ] `update(scrollTop)`: use `BlockHeightIndex.getBlockAtOffset()` to find visible range, extend by overscan, diff against current window, return `WindowUpdate` with enter/exit ranges and spacer heights
- [ ] `topSpacerHeight` = `BlockHeightIndex.getBlockOffset(startIndex)`, `bottomSpacerHeight` = `getTotalHeight() - getBlockOffset(endIndex)`
- [ ] Dirty flag tracking: `Set<number>` for dirty block indices
- [ ] `markDirty()`, `isDirty()`, `clearDirty()` methods
- [ ] `setViewportHeight()` for resize handling

**Tests:** (import from `bun:test`, matching project convention — not vitest)
- [ ] Initial update at scrollTop=0 returns correct range with overscan
- [ ] Scroll down: enter/exit ranges are correct (new blocks enter at bottom, old exit at top)
- [ ] Scroll up: symmetric behavior
- [ ] Large jump (scroll to middle): full window replacement
- [ ] Dirty tracking: mark, check, clear cycle
- [ ] Spacer heights match expected values from prefix sum
- [ ] Viewport resize triggers correct range recalculation

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/rendered-block-window.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

---

#### Step 3: Static rendering path — TugMarkdownView with full content {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugdeck): add TugMarkdownView component with static rendering path`

**References:** [D03] lib + component split, [D05] hardcoded height constants, [D06] chunked lexing, Spec S03, Table T01, List L01, (#internal-architecture, #non-goals, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-markdown-view.tsx`
- `tugdeck/src/components/tugways/tug-markdown-view.css`

**Tasks:**
- [ ] Create `tug-markdown-view.tsx` following L19 component authoring guide: module docstring citing L02, L05, L06, L19; exported `TugMarkdownViewProps` interface; `data-slot="markdown-view"`
- [ ] Static rendering: when `content` prop is set, call `marked.lexer(content)` to produce block list
- [ ] Estimate height for each block using constants from [D05] and `appendBlock()` to BlockHeightIndex
- [ ] For content >1MB [D06]: lex the full content synchronously (lexer is fast), then render blocks in batches via `requestIdleCallback` to avoid blocking the main thread with DOM work; render available blocks progressively as each batch completes
- [ ] Scroll container: `overflow-y: auto` div with `onScroll` handler
- [ ] On scroll: call `RenderedBlockWindow.update(scrollTop)`, apply enter/exit to DOM
- [ ] Top and bottom spacer `<div>` elements sized from `WindowUpdate.topSpacerHeight` / `bottomSpacerHeight`
- [ ] Render each visible block: `marked.parser([token])` (wrapping each token in an array, since `parser()` takes `Token[]`) to produce HTML, sanitize with DOMPurify, render via `dangerouslySetInnerHTML`
- [ ] After block renders, measure actual height via `ResizeObserver` or `getBoundingClientRect()`, call `BlockHeightIndex.setHeight()` to refine
- [ ] Block positioning via normal document flow between top and bottom spacer divs — spacers provide scroll-height padding; no `transform: translateY()` needed [D02]
- [ ] Create `tug-markdown-view.css` with scroll container styles, spacer styles
- [ ] CSS uses `--tugx-md-*` namespace for component tokens where needed

**Tests:**
- [ ] Build and type-check verify component compiles without errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 4: Streaming rendering path — live delta support {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): add streaming rendering path to TugMarkdownView`

**References:** [D04] both full strings and raw deltas, [D02] sliding window, Spec S03, Spec S04, (#assumptions, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-markdown-view.tsx` (modified)

**Tasks:**
- [ ] When `streamingStore` prop is set, subscribe via `useSyncExternalStore` [L02] to the streaming text path. Every delta triggers a React re-render (strict L02 compliance — no direct DOM updates outside React). Relies on React being fast enough given that the actual DOM diff is minimal (only tail blocks change).
- [ ] Track the byte offset in the source text where each block ends (store as a parallel array alongside the block list)
- [ ] On each text update: diff against previous length to find new content. Re-lex from the *start* of the last block (not the end), because appended content may change how the last block's boundary is parsed. Accept that the last 1-2 blocks are re-lexed on every update — this is cheap since `marked.lexer()` on a small suffix is sub-millisecond.
- [ ] Compare re-lexed blocks against existing tail blocks: update heights and dirty flags for changed blocks, append truly new blocks via `appendBlock()` to BlockHeightIndex
- [ ] Auto-scroll to tail when `isStreaming` is true: after each update, scroll container `scrollTop` = `getTotalHeight() - viewportHeight`
- [ ] Auto-scroll uses RAF for the scroll position write [L05] — only the scroll position write, not React state
- [ ] On `isStreaming` transition from true to false (turn_complete): finalization pass — re-lex from last stable boundary, reconcile block list, update heights
- [ ] Both full string updates and raw character delta appends work (raw deltas just append to the accumulated string)

**Tests:**
- [ ] Build and type-check verify streaming path compiles without errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 5: Gallery card and integration verification {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(tugdeck): add TugMarkdownView gallery card for visual/perf verification`

**References:** [D03] lib + component split, Spec S04, Risk R01, Risk R02, (#success-criteria)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-markdown-view.tsx` (new gallery card file)
- `tugdeck/src/components/tugways/cards/gallery-registrations.tsx` (modified — import, tab entry, `registerCard` call)

**Tasks:**
- [ ] Create `gallery-markdown-view.tsx` following existing gallery card pattern (e.g., `gallery-push-button.tsx`): export a `GalleryMarkdownView` component
- [ ] In `gallery-registrations.tsx`: import `GalleryMarkdownView` from `./gallery-markdown-view`
- [ ] In `gallery-registrations.tsx`: add a tab entry to `GALLERY_DEFAULT_TABS`: `{ id: "template", componentId: "gallery-markdown-view", title: "TugMarkdownView", closable: true }`
- [ ] In `gallery-registrations.tsx`: add a `registerCard()` call for `gallery-markdown-view` with `contentFactory: () => <GalleryMarkdownView />`
- [ ] Create gallery card that demonstrates TugMarkdownView in both static and streaming modes
- [ ] Static demo: load a large markdown string (1MB+), verify smooth scrolling
- [ ] Streaming demo: create a `PropertyStore` with schema `[{ path: "text", type: "string", label: "Streaming text" }]` and `initialValues: { text: "" }` per Spec S04, simulate `assistant_text` deltas by calling `store.set("text", accumulatedText, "transport")` at a realistic rate, verify auto-scroll and 60fps
- [ ] Display diagnostic overlay: DOM node count, current window range, total block count, measured vs estimated heights
- [ ] 10MB stress test content generator: repeat realistic markdown patterns (paragraphs, headings, code blocks, lists) to reach 10MB

**Tests:**
- [ ] Gallery card renders both static and streaming demos without errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`
- [ ] Gallery card renders without errors
- [ ] DOM node count in scroll container stays bounded (<500 nodes) regardless of content size (manual check via diagnostic overlay)

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] prefix sum, [D02] sliding window, [D03] lib + component split, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all unit tests pass
- [ ] Verify build succeeds with no type errors
- [ ] Verify gallery card demonstrates both static and streaming paths
- [ ] Verify DOM node count stays bounded with 10MB+ content
- [ ] Verify `getBlockAtOffset()` performance with 100K blocks

**Tests:**
- [ ] All unit tests from Steps 1-2 pass in aggregate run

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/block-height-index.test.ts src/__tests__/rendered-block-window.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A virtualized markdown rendering engine (`TugMarkdownView`) that renders multi-MB conversation content with bounded DOM nodes, smooth scrolling at 60fps, and both static and streaming rendering paths.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `BlockHeightIndex` and `RenderedBlockWindow` unit tests pass (`bun test`)
- [ ] `tug-markdown-view.tsx` builds without type errors (`bunx tsc --noEmit`)
- [ ] Gallery card loads 1MB static content in <200ms viewport-visible
- [ ] Gallery card streams 5000+ words of deltas at 60fps
- [ ] DOM node count stays bounded (<500) for 10MB+ content (gallery card diagnostic overlay)
- [ ] Laws compliance verified: L02 (PropertyStore for streaming state), L05 (RAF only for scroll), L06 (CSS transforms for positioning), L19 (component authoring guide followed)

**Acceptance tests:**
- [ ] `bun test src/__tests__/block-height-index.test.ts` — all pass
- [ ] `bun test src/__tests__/rendered-block-window.test.ts` — all pass
- [ ] `bunx tsc --noEmit` — zero errors
- [ ] `bun run build` — zero errors

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3B: Content-type-specific rendering (code blocks with Shiki, thinking blocks, tool use display)
- [ ] Theme-aware height estimation (replace hardcoded constants with CSS custom property measurement)
- [ ] Accessibility: keyboard navigation through blocks, ARIA landmarks
- [ ] Large content progress indicator during chunked lexing

| Checkpoint | Verification |
|------------|--------------|
| Data structures correct | `bun test src/__tests__/block-height-index.test.ts src/__tests__/rendered-block-window.test.ts` |
| Type safety | `bunx tsc --noEmit` |
| Build succeeds | `bun run build` |
| Visual/perf verification | Gallery card manual check |
