<!-- tugplan-skeleton v2 -->

## Worker-Based Markdown Pipeline {#worker-markdown-pipeline}

**Purpose:** Move all heavy markdown computation (lexing, parsing, height estimation) off the main thread into a TugWorkerPool-based pipeline, eliminating the ~15-second main-thread block for 1MB documents and achieving <200ms viewport-visible time with jank-free scrolling for documents up to 10MB.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | worker-markdown-pipeline |
| Last updated | 2026-03-30 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Phase 3A implementation of TugMarkdownView correctly adopted Monaco's prefix-sum and sliding-window patterns but missed Monaco's most important architectural principle: never compute what is not visible. Three specific failures compound into ~15 seconds of main-thread blocking for a 1MB document: `scheduleIdleBatch` pre-renders all ~5,000 blocks into the DOM, all parsing runs synchronously on the main thread, and the streaming path calls `renderToken()` for off-screen blocks during reconciliation.

Phase 3A.1 delivered `TugWorkerPool<TReq, TRes>` (`tugdeck/src/lib/tug-worker-pool.ts`), a typed worker pool with least-busy dispatch, cancellation, and graceful degradation. This phase uses that pool to implement a two-phase lex/parse pipeline (Model C from the roadmap) that moves all expensive computation to worker threads while the main thread handles only rendering and user interaction.

#### Strategy {#strategy}

- Fix the immediate performance disaster first: remove `scheduleIdleBatch` and add an HTML cache before touching the worker pipeline.
- Extract height estimation into a shared pure module importable by both workers and the main thread.
- Create a single markdown worker file that handles lex, parse, and stream message types via a discriminated union.
- Wire the static rendering path to the two-phase pipeline: Phase 1 lex returns offsets (not raw strings), Phase 2 parse submits batches only for visible+overscan blocks.
- Wire the streaming path to batched 100ms coalescing, replacing per-delta synchronous re-lex.
- Add placeholder blocks for cache misses and RAF-coalesced scroll handling.
- Harden TugWorkerPool with fixes deferred from Phase 3A.1 review.

#### Success Criteria (Measurable) {#success-criteria}

- 1MB document: viewport visible in <200ms, full scroll range navigable immediately (`performance.now()` measurement in gallery card)
- 10MB document: viewport visible in <200ms, scrollbar yank test (top to bottom in <1s) with zero judder (`performance.now()` + Chrome DevTools Performance tab)
- Streaming: 60fps, zero dropped frames during 5000+ word stream (Chrome DevTools Performance tab)
- Zero long tasks (>50ms) on main thread during any rendering operation (Chrome DevTools Performance tab)
- DOM node count stays <500 at all times (gallery diagnostic overlay)
- Zero synchronous `marked.parser()` calls on the main thread (code audit: grep for `marked.parser` in non-worker files)
- `HeightEstimator` interface implemented with default text estimator producing heights within 20% of measured for standard markdown blocks

#### Scope {#scope}

1. Remove `scheduleIdleBatch` and all idle callback pre-rendering plumbing
2. Add HTML cache (`Map<number, string>`) to engine state
3. Extract `HeightEstimator` interface and `DefaultTextEstimator` into shared module
4. Create `markdown-worker.ts` with lex/parse/stream message handlers
5. Rewrite static rendering path to use two-phase worker pipeline
6. Rewrite streaming path to use 100ms-coalesced worker batches
7. Add RAF-coalesced scroll handler with cancel/resubmit for stale parse requests
8. Add placeholder blocks for async cache-miss rendering
9. Add `onDiagnostics` callback prop for metrics exposure
10. Harden TugWorkerPool (transferable detection, respawn strategy, multi-slot dispatch test, init timeout test)
11. Update gallery card diagnostics

#### Non-goals (Explicitly out of scope) {#non-goals}

- Binary-encoded token transfer (Monaco uses `Uint32Array` — unnecessary for our message sizes)
- `SharedArrayBuffer` for cross-thread state
- Learning estimator that converges based on measured heights (future phase)
- Code block syntax highlighting (Phase 3B)
- MDX/React element height estimation (future phase)
- General-purpose editing support (this is a viewer, not an editor)

#### Dependencies / Prerequisites {#dependencies}

- `TugWorkerPool<TReq, TRes>` implemented in `tugdeck/src/lib/tug-worker-pool.ts` (Phase 3A.1 — complete)
- `BlockHeightIndex` in `tugdeck/src/lib/block-height-index.ts` (Phase 3A — complete)
- `RenderedBlockWindow` in `tugdeck/src/lib/rendered-block-window.ts` (Phase 3A — complete)
- `marked` library available for import in worker context
- Vite worker build support via `new URL(..., import.meta.url)` pattern

#### Constraints {#constraints}

- Worker files are separate Vite entry points; the `@/` path alias may not resolve in worker builds — use relative imports from worker files
- DOMPurify requires the DOM and cannot run in a worker; sanitization must happen on the main thread at render time only
- Content model is append-only (viewer, not editor): no insertion at arbitrary positions, no deletion, no cursor
- Laws compliance: [L02] external state via `useSyncExternalStore`, [L05] RAF only for scroll writes, [L06] appearance via CSS/DOM not React state

#### Assumptions {#assumptions}

- Vite worker build works with `new URL('../workers/markdown-worker.ts', import.meta.url)` using relative imports inside the worker file. If the build fails, the worker file path or alias configuration will need adjustment.
- The HTML cache stores unsanitized HTML from the worker. `DOMPurify.sanitize()` runs at the moment `addBlockNode()` writes innerHTML to the DOM, consistent with W10.
- The stream coalescing interval is implemented with `setInterval` at 100ms, stored as a handle in `MarkdownEngineState`, started on first streaming update, and cleared on `isStreaming` transition to false or unmount.
- Overscan multiplier (3-5 screens) is a named constant in TugMarkdownView, not passed as a prop.
- The finalization pass on `isStreaming` transition to false submits a lex task (not a parse task) to verify block count and update heights/offsets, then submits parse tasks for the visible+overscan range only.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Optimal overscan depth (OPEN) {#q01-overscan-depth}

**Question:** What is the right overscan multiplier for the scrollbar yank test on 10MB documents?

**Why it matters:** Too shallow and placeholders flash during aggressive scrolling. Too deep and we submit unnecessary parse work, wasting worker time.

**Options (if known):**
- 3 screens (conservative — may show placeholders on fast scroll)
- 5 screens (aggressive — more upfront work but smoother experience)

**Plan to resolve:** Implement with a named constant starting at 4 screens. Tune based on gallery card scrollbar yank test with 10MB content. Adjust if placeholders are visible during aggressive scrolling.

**Resolution:** OPEN — will be resolved during Step 8 performance verification.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Phase 1 lex response too large | med | low | Return only heights[] + offsets[] (~80KB), not raw strings | Structured clone >10ms for Phase 1 response |
| Placeholder-to-real swap layout shift | med | med | ResizeObserver + prefix sum recompute, HeightEstimator within 20% | Visible layout shift during normal scrolling |
| Worker pool init time delays first render | low | low | Create pool at mount, not first content load; Phase 1 triggers lazy spawn | First render >200ms due to worker init |
| Vite worker build path resolution | high | low | Use relative imports, verify with `bun run build` | Worker chunk not emitted or runtime import error |

**Risk R01: Placeholder flash during scrollbar yank** {#r01-placeholder-flash}

- **Risk:** If overscan is too shallow or workers too slow, placeholders become visible during aggressive scrollbar dragging on large documents.
- **Mitigation:** Deep overscan (4-5 screens), parallel batches across all workers (~12 workers × ~10 blocks = ~120 blocks in ~20ms), HTML cache retains all parsed blocks permanently.
- **Residual risk:** On very slow machines with few cores, worker throughput may not keep up with extremely fast scrolling. Overscan depth may need per-device tuning in the future.

**Risk R02: Stream coalescing interval too aggressive** {#r02-stream-coalescing}

- **Risk:** 100ms coalescing may feel laggy for short, fast responses. Too short and worker traffic spikes.
- **Mitigation:** 100ms bounds to ~10 requests/second regardless of delta rate. For short responses (<100ms total), the finalization pass delivers final content immediately.
- **Residual risk:** Perceptible 100ms lag on very fast, short responses. Acceptable for Phase 3A.2; can be tuned later.

---

### Design Decisions {#design-decisions}

#### [D01] Two-phase lex/parse pipeline via TugWorkerPool (DECIDED) {#d01-two-phase-pipeline}

**Decision:** Use Model C architecture: Phase 1 sends full text to one worker for `marked.lexer()`, returning lightweight metadata (block count, heights, offsets). Phase 2 submits batches of block indices to the worker pool for `marked.parser()`, only for visible+overscan blocks.

**Rationale:**
- Phase 1 is one message, completes in ~5-10ms, gives the main thread everything needed for scrollbar and visible range computation
- Phase 1 response is ~80KB (number arrays), not ~1MB+ of re-serialized text
- Phase 2 uses full pool parallelism where it matters: expensive `marked.parser()` calls
- Single worker file handles all three message types via discriminated union switch

**Implications:**
- Pool uses `MdWorkerReq` / `MdWorkerRes` discriminated union types through one pool instance
- Main thread stores original content string and slices raws using offsets from Phase 1
- Parse workers re-lex from raw strings (W19) — 5x cheaper than cloning Token objects

#### [D02] Viewport-priority parsing with scroll coalescing (DECIDED) {#d02-viewport-priority}

**Decision:** Worker pool receives parse requests only for blocks in visible+overscan range. Scroll handler uses RAF coalescing: updates `pendingScrollTop`, RAF callback computes new range, diffs against last range, cancels stale requests, submits new batch.

**Rationale:**
- Rapid scrollbar dragging generates many scroll events per frame, but only ONE worker batch per frame
- Pool never receives stale requests because each frame cancels the previous batch
- Large jumps (scrollbar yank) submit the entire new range as parallel batches across all workers

**Implications:**
- `addBlockNode()` may encounter cache misses during fast scrolling — placeholder blocks needed
- In-flight parse task handles must be tracked for cancellation on range change
- Overscan of 4 screens (tunable named constant) above and below viewport

#### [D03] HTML cache replaces pre-rendering (DECIDED) {#d03-html-cache}

**Decision:** Parsed HTML strings are cached in `Map<number, string>` on the main thread. Cache is populated by worker responses and never evicted (content is append-only). This eliminates `scheduleIdleBatch` entirely.

**Rationale:**
- Cache hit path: sanitize + render immediately (synchronous, fast, ~0.5ms)
- Cache miss path: submit to worker pool, show placeholder
- Content model is append-only — cache never needs invalidation by user edits

**Implications:**
- Cache stores unsanitized HTML; DOMPurify runs only at render time (W10)
- Memory grows with document size but is bounded by document content (no duplicates)
- `removeBlockNode()` does NOT evict cache entries — scrolling back never re-parses

#### [D04] DOMPurify at render time only (DECIDED) {#d04-dompurify-render-time}

**Decision:** DOMPurify.sanitize() is called only when a block enters the viewport and is about to be written to the DOM via `addBlockNode()`. Workers return unsanitized HTML.

**Rationale:**
- DOMPurify requires the DOM and cannot run in a worker
- Cost bounded to visible blocks only (never more than ~60-100 at a time)
- Each sanitization call is ~0.5ms — well within frame budget for visible block count

**Implications:**
- HTML cache stores unsanitized HTML
- `addBlockNode()` must sanitize before setting innerHTML
- No sanitization work for off-screen blocks

#### [D05] Streaming coalescing at 100ms via setInterval (DECIDED) {#d05-stream-coalescing}

**Decision:** Streaming deltas are coalesced with a `setInterval` at 100ms. A `streamingDirty` flag is set on each store update; the interval callback checks the flag, reads accumulated text, and submits one `stream` task to a single worker.

**Rationale:**
- Deltas arrive at ~25/second; coalescing bounds worker traffic to ~10 requests/second
- Single worker for streaming (tail-lex is sequential by nature)
- 100ms latency is imperceptible for streaming text display

**Implications:**
- `setInterval` handle stored in engine state, started on first streaming update, cleared on `isStreaming` → false or unmount
- Finalization pass on `isStreaming` → false submits a lex task for verification, then parse tasks for visible+overscan range
- Viewport hint included in stream request so worker parses only visible+overscan blocks and returns metadata-only for the rest

#### [D06] Pluggable HeightEstimator interface (DECIDED) {#d06-height-estimator}

**Decision:** Extract height estimation into a `HeightEstimator` interface with an `estimate(tokenType: string, raw: string, meta?: HeightEstimatorMeta): number` method. The optional `meta` parameter carries structured token metadata (heading depth, list item count, table row count) that the worker extracts during lexing. Implement `DefaultTextEstimator` using the existing heuristics. Module is pure (no DOM) — importable by both worker and main thread.

**Rationale:**
- Height estimation must be shared between worker (Phase 1 lex) and main thread (BlockHeightIndex)
- Pluggable interface enables type-specific estimators for code blocks, tables, React components in future phases
- Default estimator is the existing heuristic — baseline that gets within 20% of measured

**Implications:**
- New file: `tugdeck/src/lib/markdown-height-estimator.ts`
- Constants re-exported from both `block-height-index.ts` and `markdown-height-estimator.ts` during transition
- `BlockHeightIndex` imports from the new module
- Worker imports from the new module via relative path

#### [D07] Graceful degradation to main-thread inline execution (DECIDED) {#d07-graceful-degradation}

**Decision:** If worker construction fails, the pool's `fallbackHandler` runs lex/parse/stream inline on the main thread via `queueMicrotask`. The viewport-only discipline (D02) still applies.

**Rationale:**
- TugWorkerPool already supports fallback mode via the `fallbackHandler` option
- Viewport-only discipline means fallback never pre-renders all blocks
- Performance is worse than worker path but far better than Phase 3A

**Implications:**
- Must provide a `fallbackHandler` when constructing the pool
- Fallback handler implements the same lex/parse/stream switch as the worker
- No additional graceful degradation code needed beyond pool configuration

#### [D08] Parse workers re-lex from raw strings (DECIDED) {#d08-relex-from-raw}

**Decision:** Phase 2 parse batches send `{ index, raw }` — the block's raw markdown text. The parse worker calls `marked.parser(marked.lexer(raw))` to reconstruct the token and produce HTML. Token objects never cross the worker boundary.

**Rationale:**
- Structured-cloning a full Token object costs ~0.5ms per token via `postMessage`
- Re-lexing a single block's raw text (~100-500 bytes) costs ~0.1ms — 5x cheaper
- Phase 1 returns only `heights[]` and `offsets[]` (flat number arrays)

**Implications:**
- Main thread slices raw strings from original content using offsets from Phase 1
- Each Phase 2 worker independently reconstructs tokens from raw strings
- No shared state or coordination between workers

#### [D09] Diagnostics via onDiagnostics callback prop (DECIDED) {#d09-diagnostics-callback}

**Decision:** Add an `onDiagnostics` callback prop to TugMarkdownView that fires with a metrics object on each parse response.

**Rationale:**
- Gallery card diagnostics need pool size, in-flight tasks, cache size, cache hit rate
- Callback prop keeps diagnostics opt-in and avoids polluting the component API
- Metrics object is a plain object — no external state dependency

**Implications:**
- New prop: `onDiagnostics?: (metrics: MarkdownDiagnostics) => void`
- Metrics include: `poolSize`, `inFlightTasks`, `cacheSize`, `cacheHitRate`, `blockCount`
- Fires on each parse response completion, not on every frame

---

### Specification {#specification}

#### Worker Message Protocol {#worker-message-protocol}

**Spec S01: MdWorkerReq discriminated union** {#s01-md-worker-req}

```typescript
type MdWorkerReq =
  | { type: 'lex'; text: string }
  | { type: 'parse'; batch: { index: number; raw: string }[] }
  | { type: 'stream'; tailText: string; relexFromOffset: number;
      viewportHint?: { startIndex: number; endIndex: number } };
```

**Spec S02: MdWorkerRes discriminated union** {#s02-md-worker-res}

```typescript
type MdWorkerRes =
  | { type: 'lex'; blockCount: number; heights: number[]; offsets: number[] }
  | { type: 'parse'; results: { index: number; html: string }[] }
  | { type: 'stream'; newHeights: number[]; newOffsets: number[];
      parsedBlocks: { index: number; html: string }[];
      metadataOnly: { index: number; height: number }[] };
```

The `offsets` array contains **cumulative end offsets**: `offsets[i]` is the character position where block `i` ends. To extract block `i`'s raw text: `contentText.slice(offsets[i-1] ?? 0, offsets[i])`. This matches the existing offset convention in `tug-markdown-view.tsx`.

The `stream` response includes `metadataOnly` for blocks outside the viewport hint: these receive height estimates but are not parsed. The caller updates BlockHeightIndex from `metadataOnly` entries without populating the HTML cache.

**Spec S03: MarkdownDiagnostics** {#s03-diagnostics}

```typescript
interface MarkdownDiagnostics {
  poolSize: number;
  inFlightTasks: number;
  cacheSize: number;
  cacheHitRate: number;  // hits / (hits + misses) since last content load
  blockCount: number;
}
```

#### HeightEstimator Interface {#height-estimator-interface}

**Spec S04: HeightEstimator** {#s04-height-estimator}

```typescript
interface HeightEstimatorMeta {
  depth?: number;       // heading level (1-6)
  itemCount?: number;   // list item count
  rowCount?: number;    // table row count (excluding header)
}

interface HeightEstimator {
  estimate(tokenType: string, raw: string, meta?: HeightEstimatorMeta): number;
}
```

Pure function, no DOM dependency. Works in both main thread and worker. The `DefaultTextEstimator` implements this using the existing heuristics from `estimateBlockHeight()` in `tug-markdown-view.tsx`. The worker extracts structured metadata (`depth`, `itemCount`, `rowCount`) from Token objects during lexing and passes it via the `meta` parameter. The `raw` string is used for character-counting heuristics (paragraph line estimation, code line counting). When `meta` is omitted, the estimator falls back to raw-string-only heuristics (slightly less accurate for headings, lists, and tables).

#### Updated MarkdownEngineState {#engine-state}

**Spec S05: MarkdownEngineState changes** {#s05-engine-state}

New fields added to the mutable engine state ref:

```typescript
interface MarkdownEngineState {
  // ... existing fields (tokens removed — replaced by offsets from worker) ...
  /** Source text byte offsets per block, from Phase 1 lex response. */
  blockOffsets: number[];
  /** The original content string (main thread slices raws using offsets). */
  contentText: string;
  /** HTML cache: block index → unsanitized HTML string. */
  htmlCache: Map<number, string>;
  /** Cache hit/miss counters for diagnostics. */
  cacheHits: number;
  cacheMisses: number;
  /** In-flight parse task handles for cancellation on range change. */
  inFlightParses: TaskHandle<MdWorkerRes>[];
  /** Streaming coalescing state. */
  streamingDirty: boolean;
  streamingInterval: ReturnType<typeof setInterval> | null;
  /** Pending scroll top for RAF coalescing. */
  pendingScrollTop: number | null;
  /** RAF handle for scroll coalescing. */
  scrollRafHandle: number | null;
  /** The TugWorkerPool instance. */
  pool: TugWorkerPool<MdWorkerReq, MdWorkerRes> | null;
}
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/markdown-height-estimator.ts` | HeightEstimator interface + DefaultTextEstimator + height constants |
| `tugdeck/src/workers/markdown-worker.ts` | Web worker: lex/parse/stream message handler |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `HeightEstimator` | interface | `markdown-height-estimator.ts` | `estimate(tokenType, raw, meta?): number` |
| `HeightEstimatorMeta` | interface | `markdown-height-estimator.ts` | Optional structured metadata: `depth`, `itemCount`, `rowCount` |
| `DefaultTextEstimator` | class | `markdown-height-estimator.ts` | Existing heuristics from `estimateBlockHeight()` |
| `MdWorkerReq` | type | `tug-markdown-view.tsx` | Discriminated union for worker requests |
| `MdWorkerRes` | type | `tug-markdown-view.tsx` | Discriminated union for worker responses |
| `MarkdownDiagnostics` | interface | `tug-markdown-view.tsx` | Metrics object for `onDiagnostics` callback |
| `onDiagnostics` | prop | `TugMarkdownViewProps` | Optional callback fired on parse response |
| `htmlCache` | field | `MarkdownEngineState` | `Map<number, string>` for unsanitized HTML |
| `inFlightParses` | field | `MarkdownEngineState` | `TaskHandle[]` for cancellation |
| `streamingDirty` | field | `MarkdownEngineState` | Coalescing flag for streaming path |
| `streamingInterval` | field | `MarkdownEngineState` | `setInterval` handle for 100ms coalescing |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | HeightEstimator interface contract, DefaultTextEstimator accuracy | Shared module logic |
| **Integration** | Worker message round-trip (lex → parse → cache), streaming coalescing | Worker pipeline end-to-end |
| **TugWorkerPool hardening** | Multi-slot dispatch, init timeout, transferable detection | Pool behavior under real load |
| **Performance** | Gallery card timing, Chrome DevTools profiling | Exit criteria verification |

---

### Execution Steps {#execution-steps}

#### Step 1: Remove scheduleIdleBatch and add HTML cache {#step-1}

**Commit:** `refactor(tugdeck): remove scheduleIdleBatch, add HTML cache to TugMarkdownView`

**References:** [D03] HTML cache replaces pre-rendering, (#context, #strategy, #engine-state)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: removed `scheduleIdleBatch`, `RENDER_BATCH_SIZE`, `CHUNKED_CONTENT_THRESHOLD`, idle callback plumbing; added `htmlCache: Map<number, string>` to engine state

**Tasks:**
- [ ] Remove `CHUNKED_CONTENT_THRESHOLD` and `RENDER_BATCH_SIZE` constants
- [ ] Remove `scheduleIdleBatch()` function entirely
- [ ] Remove all `requestIdleCallback` / `cancelIdleCallback` usage from the static rendering path
- [ ] Remove `idleHandle` and `renderedCount` from `MarkdownEngineState`
- [ ] Add `htmlCache: Map<number, string>` to `MarkdownEngineState`
- [ ] Add `cacheHits: number` and `cacheMisses: number` counters to engine state
- [ ] Modify `addBlockNode()` to check `htmlCache` before calling `renderToken()`: cache hit → set innerHTML directly from cached HTML (already sanitized, no re-sanitization needed), cache miss → call `renderToken()` (which returns sanitized HTML) and store the result in cache. Note: in this transitional step, the cache stores **sanitized** HTML because `renderToken()` produces sanitized output. Step 4 changes the cache to store **unsanitized** HTML (from workers) with sanitization at render time per [D04].
- [ ] Modify `removeBlockNode()` to NOT evict cache entries (cache lives forever per content model)
- [ ] Populate `htmlCache` during static rendering: after `renderToken()`, store the sanitized HTML in cache (transitional — Step 4 changes to unsanitized)
- [ ] Verify `addBlockNode()` is called ONLY by `applyWindowUpdate()` (entering blocks) — never in a pre-render loop

**Tests:**
- [ ] Existing BlockHeightIndex + RenderedBlockWindow tests pass unchanged (regression)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun test` — all existing BlockHeightIndex + RenderedBlockWindow tests pass
- [ ] `bun run build` — build succeeds

---

#### Step 2: Extract shared height estimation module {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): extract HeightEstimator interface and DefaultTextEstimator`

**References:** [D06] Pluggable HeightEstimator interface, Spec S04, (#height-estimator-interface, #new-files)

**Artifacts:**
- New file: `tugdeck/src/lib/markdown-height-estimator.ts`
- Modified `tugdeck/src/lib/block-height-index.ts`: re-exports constants from new module
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: imports from new module

**Tasks:**
- [ ] Create `tugdeck/src/lib/markdown-height-estimator.ts` with:
  - `HeightEstimatorMeta` interface: `{ depth?: number; itemCount?: number; rowCount?: number }`
  - `HeightEstimator` interface: `estimate(tokenType: string, raw: string, meta?: HeightEstimatorMeta): number`
  - `DefaultTextEstimator` class implementing the existing heuristics from `estimateBlockHeight()` in `tug-markdown-view.tsx`. Uses `meta.depth` for heading level, `meta.itemCount` for list height, `meta.rowCount` for table height. Falls back to raw-string parsing when meta fields are absent (paragraph line counting via `raw.length / 80`, code line counting via `raw.match(/\n/g)`).
  - Export height constants: `LINE_HEIGHT`, `CODE_LINE_HEIGHT`, `CODE_HEADER_HEIGHT`, `HEADING_HEIGHTS`, `HR_HEIGHT`
- [ ] Update `block-height-index.ts` to re-export constants from `markdown-height-estimator.ts` (backward compatibility during transition)
- [ ] Update `tug-markdown-view.tsx` to import `DefaultTextEstimator` from the new module and replace inline `estimateBlockHeight()` with `estimator.estimate(token.type, token.raw, { depth: token.depth, itemCount: token.items?.length, rowCount: token.rows?.length })`
- [ ] Verify module is pure: no DOM imports, no React imports — must be importable by a web worker

**Tests:**
- [ ] Unit test: `DefaultTextEstimator.estimate('paragraph', text)` returns reasonable height for various text lengths
- [ ] Unit test: `DefaultTextEstimator.estimate('code', codeText)` accounts for line count and header height
- [ ] Unit test: `DefaultTextEstimator.estimate('heading', text, { depth: N })` returns correct height per heading level for `h1`-`h6`; also verify fallback when `meta` is omitted

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun test` — new estimator tests pass, all existing tests pass
- [ ] `bun run build` — build succeeds

---

#### Step 3: Create the markdown worker file {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add markdown-worker.ts with lex/parse/stream handlers`

**References:** [D01] Two-phase pipeline, [D08] Re-lex from raw strings, Spec S01, Spec S02, (#worker-message-protocol, #new-files)

**Artifacts:**
- New file: `tugdeck/src/workers/markdown-worker.ts`
- New directory: `tugdeck/src/workers/`

**Tasks:**
- [ ] Create `tugdeck/src/workers/` directory
- [ ] Create `tugdeck/src/workers/markdown-worker.ts` with:
  - Static imports: `import { marked } from 'marked'` and `import { DefaultTextEstimator } from '../lib/markdown-height-estimator'` (relative path, not `@/`)
  - `self.onmessage` handler that unwraps the `MainToWorkerMessage<MdWorkerReq>` envelope from TugWorkerPool. The pool sends `{ taskId, type: 'task', payload: <MdWorkerReq> }` and the worker MUST echo `taskId` in every response. Pattern:
    ```typescript
    self.onmessage = (e: MessageEvent) => {
      const { taskId, type, payload } = e.data;
      if (type === 'cancel') return; // ignore cancel — batches are fast (~20ms)
      // type === 'task': switch on payload.type
      switch (payload.type) {
        case 'lex': { /* ... */ self.postMessage({ taskId, type: 'result', payload: result }); break; }
        case 'parse': { /* ... */ self.postMessage({ taskId, type: 'result', payload: result }); break; }
        case 'stream': { /* ... */ self.postMessage({ taskId, type: 'result', payload: result }); break; }
      }
    };
    ```
  - `lex` handler: receive `payload: { type: 'lex', text }`, run `marked.lexer(text)`, filter space tokens, extract metadata from each Token (`depth` for headings, `items.length` for lists, `rows.length` for tables), estimate heights via `DefaultTextEstimator` passing `(token.type, token.raw, meta)`, compute cumulative end offsets. Respond with `{ taskId, type: 'result', payload: { type: 'lex', blockCount, heights[], offsets[] } }`. Do NOT return raw strings.
  - `parse` handler: receive `payload: { type: 'parse', batch: { index, raw }[] }`, run `marked.parser(marked.lexer(raw))` for each entry (W19 re-lex from raw). Respond with `{ taskId, type: 'result', payload: { type: 'parse', results: { index, html }[] } }`.
  - `stream` handler: receive `payload: { type: 'stream', tailText, relexFromOffset, viewportHint? }`, run incremental tail-lex, estimate heights for new/changed blocks, parse blocks within viewport hint range, return metadata-only for blocks outside range. Respond with `{ taskId, type: 'result', payload: { type: 'stream', newHeights[], newOffsets[], parsedBlocks[], metadataOnly[] } }`.
  - Cancel handling: worker ignores `cancel` messages — parse batches are ~20ms, mid-batch cancellation saves negligible work. The pool handles rejection on the main thread side.
  - Send `{ type: 'init' }` on load (after imports resolve)
- [ ] Use `import { serializeError } from '../lib/tug-worker-pool'` for error handling in the worker's catch blocks
- [ ] Verify worker uses only relative imports (no `@/` alias)

**Tests:**
- [ ] Build verification confirms worker chunk emitted (no dedicated test — worker round-trip tested in Step 9)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun run build` — build succeeds, markdown worker chunk emitted (verify in build output)

---

#### Step 4: Wire TugMarkdownView to the two-phase pipeline (static path) {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): wire static rendering to two-phase worker pipeline`

**References:** [D01] Two-phase pipeline, [D02] Viewport-priority parsing, [D03] HTML cache, [D04] DOMPurify render time, [D07] Graceful degradation, Spec S01, Spec S02, Spec S05, (#engine-state, #worker-message-protocol)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: new static rendering path using pool

**Tasks:**
- [ ] Define `MdWorkerReq` and `MdWorkerRes` discriminated union types in `tug-markdown-view.tsx` (or a shared types file)
- [ ] Create the pool at component mount via `useLayoutEffect`: `new TugWorkerPool<MdWorkerReq, MdWorkerRes>(new URL('../workers/markdown-worker.ts', import.meta.url), { fallbackHandler })`. Store in engine state. On unmount cleanup: cancel all `inFlightParses` handles, clear `streamingInterval` if set, cancel `scrollRafHandle` via `cancelAnimationFrame` if set, then call `pool.terminate()`.
- [ ] Implement `fallbackHandler` that runs lex/parse/stream inline on the main thread (same switch logic as worker) for graceful degradation [D07]
- [ ] Replace the synchronous static rendering `useEffect`:
  - On `content` prop change: submit `{ type: 'lex', text: content }` to pool
  - On lex response: populate `BlockHeightIndex` from `heights[]`, store `offsets[]` in engine state, store `content` as `contentText` for later slicing
  - Compute visible+overscan range from scroll position
  - Slice raws from `contentText` using offsets for uncached blocks in range
  - Split uncached blocks into N batches, submit N `{ type: 'parse', batch }` tasks
  - On parse responses: populate HTML cache, sanitize + render visible blocks via `addBlockNode()`
- [ ] Replace scroll handler with RAF-coalesced version:
  - Scroll event sets `pendingScrollTop` and requests RAF via `requestAnimationFrame`
  - RAF callback: compute new visible+overscan range, diff against last range, cancel in-flight parse handles for blocks no longer in range, submit new parse batch for uncached blocks, render entering blocks from cache
- [ ] Track in-flight parse handles in `inFlightParses` array for cancellation
- [ ] Remove synchronous `marked.lexer()` call from static path (all lexing now in worker)
- [ ] Remove `tokens` array from engine state (no longer needed — workers handle tokens internally)

**Tests:**
- [ ] Manual gallery card verification: static content renders via worker pipeline (console.log in worker confirms lex/parse round-trip)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun run build` — build succeeds
- [ ] Gallery card: static content renders via worker pipeline (verify with `console.log` in worker)

---

#### Step 5: Wire the streaming path to batched worker model {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): wire streaming path to 100ms-coalesced worker pipeline`

**References:** [D05] Streaming coalescing, [D01] Two-phase pipeline, Spec S01, Spec S02, Spec S05, (#engine-state)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: new streaming path

**Tasks:**
- [ ] Add `streamingDirty` flag and `streamingInterval` handle to engine state
- [ ] On `useSyncExternalStore` update (streaming text change): set `streamingDirty = true`
- [ ] Start `setInterval` at 100ms on first streaming update. Interval callback:
  - If not dirty, return early
  - Read accumulated text from store, compute tail diff (relex offset = last stable block boundary)
  - Submit `{ type: 'stream', tailText, relexFromOffset, viewportHint }` to one worker
  - Include viewport hint (visible+overscan range) so worker parses only blocks in that range and returns metadata-only for the rest
  - Clear `streamingDirty` flag
- [ ] On stream response: append new heights to `BlockHeightIndex`, extend offsets array, update HTML cache for parsed blocks, update heights for metadata-only blocks, re-render if affected blocks are visible, auto-scroll via RAF [L05]
- [ ] On `isStreaming` → false (finalization):
  - Clear the streaming interval
  - Submit final `{ type: 'lex', text: fullAccumulatedText }` for verification
  - On lex response: reconcile block count and heights with engine state
  - Submit parse tasks for visible+overscan range (uncached blocks only)
  - Refresh visible block DOM nodes
- [ ] Remove synchronous streaming `useEffect` that calls `marked.lexer()` on main thread

**Tests:**
- [ ] Manual gallery card verification: streaming content renders via worker pipeline with coalesced updates

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun run build` — build succeeds
- [ ] Gallery card: streaming content renders via worker pipeline

---

#### Step 6: Add placeholder blocks for async rendering {#step-6}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): add placeholder blocks for async cache-miss rendering`

**References:** [D02] Viewport-priority parsing, [D03] HTML cache, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: placeholder block logic
- Modified `tugdeck/src/components/tugways/tug-markdown-view.css`: placeholder styling

**Tasks:**
- [ ] Modify `addBlockNode()` to handle cache miss: when `htmlCache` does not contain the block index, create a `<div class="tugx-md-block tugx-md-placeholder">` at estimated height (from `BlockHeightIndex.getHeight(index)`)
- [ ] Store a reference to placeholder nodes (e.g., in a `Set<number>` of placeholder block indices)
- [ ] When a parse response populates the HTML cache, check if placeholder is still in the DOM (block still in viewport). If so: sanitize the HTML, replace placeholder innerHTML, remove `tugx-md-placeholder` class. No CSS transition.
- [ ] Add minimal placeholder CSS: `.tugx-md-placeholder { background: var(--tugx-md-placeholder-bg, transparent); }` — invisible by default, can be styled for debugging
- [ ] Ensure ResizeObserver is attached to placeholder nodes so measured heights update the prefix sum

**Tests:**
- [ ] Manual gallery card verification: placeholder blocks appear at estimated height during fast scroll, replaced by real content when parse completes

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun run build` — build succeeds

---

#### Step 7: Add onDiagnostics callback and update gallery card {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `feat(tugdeck): add onDiagnostics callback and gallery card diagnostics`

**References:** [D09] Diagnostics via onDiagnostics callback, Spec S03, (#symbols)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-markdown-view.tsx`: new `onDiagnostics` prop
- Modified `tugdeck/src/components/tugways/cards/gallery-markdown-view.tsx`: updated diagnostics overlay

**Tasks:**
- [ ] Add `onDiagnostics?: (metrics: MarkdownDiagnostics) => void` to `TugMarkdownViewProps`
- [ ] Define `MarkdownDiagnostics` interface per Spec S03
- [ ] Fire `onDiagnostics` on each parse response completion with current metrics: pool size (from pool config), in-flight task count (from `inFlightParses.length`), cache size (`htmlCache.size`), cache hit rate (`cacheHits / (cacheHits + cacheMisses)`), block count (`heightIndex.count`)
- [ ] Update gallery card diagnostic overlay to display: worker pool size, in-flight parse tasks, HTML cache size, cache hit rate

**Tests:**
- [ ] Manual gallery card verification: diagnostics overlay shows pool size, in-flight tasks, cache size, and cache hit rate updating in real time

**Checkpoint:**
- [ ] `bunx tsc --noEmit` — no new type errors
- [ ] `bun run build` — build succeeds
- [ ] Gallery card: diagnostics visible and updating during scroll and streaming

---

#### Step 8: TugWorkerPool hardening {#step-8}

**Depends on:** #step-4

**Commit:** `fix(tugdeck): harden TugWorkerPool — transferable detection, respawn, dispatch test, init timeout test`

**References:** [D01] Two-phase pipeline, (#risks, #assumptions)

**Artifacts:**
- Modified `tugdeck/src/lib/tug-worker-pool.ts`: conditional transferable detection, per-slot lazy respawn
- New/modified test files for TugWorkerPool

**Tasks:**
- [ ] **Transferable detection:** Profile `collectTransferables` under real markdown payloads (strings, not ArrayBuffers). If measurable cost (>0.1ms per call), short-circuit for primitive/string payloads: check if `payload` is a string or number before walking the object tree. If not measurable, document the finding and leave as-is.
- [ ] **Respawn strategy:** When all workers idle-terminate and `_spawned` resets, the next `submit()` re-creates all N workers at once. Evaluate under real scroll-burst patterns. If startup latency spikes are measurable (>50ms), implement per-slot lazy respawn: on `submit()` after idle termination, spawn only one worker immediately and spawn additional workers as inFlight grows. If not measurable, document the finding.
- [ ] **Multi-slot dispatch test:** Add a test with real workers (not fallback mode) that submits tasks with varying durations and verifies distribution across slots. Submit N slow tasks + 1 fast task, confirm the fast task completes before the slow ones (i.e., it was dispatched to a different slot).
- [ ] **Init timeout test:** Add a test with a delayed-init worker (worker that waits before sending `{ type: 'init' }`) to verify the timeout → ready → flush-queue path works. Confirm tasks submitted before init are flushed and complete after the timeout fires.

**Tests:**
- [ ] Multi-slot dispatch test: N slow tasks + 1 fast task, fast task completes first (proves least-busy dispatch)
- [ ] Init timeout test: delayed-init worker, tasks submitted before init are flushed after timeout

**Checkpoint:**
- [ ] `bun test` — new TugWorkerPool hardening tests pass
- [ ] `bunx tsc --noEmit` — no new type errors

---

#### Step 9: Integration Checkpoint {#step-9}

**Depends on:** #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [D01] Two-phase pipeline, [D02] Viewport-priority parsing, [D03] HTML cache, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-8 are complete and work together end-to-end
- [ ] Verify zero synchronous `marked.parser()` calls on the main thread (grep for `marked.parser` in non-worker files — should only appear in fallback handler)
- [ ] Verify DOMPurify.sanitize() is only called in `addBlockNode()` (not in worker or cache population)

**Tests:**
- [ ] All unit tests pass (`bun test`), confirming no regressions across Steps 1-8
- [ ] Gallery card end-to-end: 1MB static renders, streaming renders, diagnostics update

**Checkpoint:**
- [ ] `bun test` — all tests pass
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `bun run build` — build succeeds, markdown worker chunk emitted
- [ ] Gallery card: 1MB static content visible in <200ms, DOM nodes <500
- [ ] Gallery card: streaming 5000+ words at 60fps, zero dropped frames
- [ ] Gallery card: diagnostics show cache hit rate, in-flight tasks, pool size

---

#### Step 10: Performance verification and stress test {#step-10}

**Depends on:** #step-9

**Commit:** `test(tugdeck): verify worker markdown pipeline performance targets`

**References:** [D01] Two-phase pipeline, [D02] Viewport-priority parsing, [Q01] Overscan depth, (#success-criteria, #exit-criteria)

**Artifacts:**
- Performance test results documented in commit message
- Overscan constant tuned based on scrollbar yank test results

**Tasks:**
- [ ] Static 1MB test: measure viewport-visible time with `performance.now()`. Target: <200ms. Verify DOM node count <500 via gallery diagnostic.
- [ ] Static 10MB test: measure viewport-visible time. Target: <200ms. Run scrollbar yank test: drag thumb from top to bottom in <1s. Verify zero judder, zero placeholder flashes, zero dropped frames.
- [ ] Streaming test: run 5000+ word stream. Verify 60fps via Chrome DevTools Performance tab. Verify zero dropped frames. Verify auto-scroll smooth.
- [ ] Profile with Chrome DevTools Performance tab: verify zero long tasks (>50ms) on main thread. Verify all `marked.parser()` calls in worker threads.
- [ ] Tune overscan constant based on scrollbar yank results. If placeholders visible, increase from 4 to 5 screens. If performance degrades from overwork, decrease.
- [ ] Verify graceful degradation: disable workers (pass `poolSize: 0` with fallback handler), confirm static and streaming paths still work (slower but functional).

**Tests:**
- [ ] Performance targets verified via gallery card `performance.now()` measurements and Chrome DevTools
- [ ] Graceful degradation verified: static + streaming functional without workers

**Checkpoint:**
- [ ] 1MB: viewport <200ms, DOM <500, scroll jank-free
- [ ] 10MB: viewport <200ms, scrollbar yank clean
- [ ] Streaming: 60fps, zero jank for 5000+ words
- [ ] Chrome DevTools: zero long tasks >50ms on main thread
- [ ] Graceful degradation: functional without workers

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugMarkdownView renders multi-MB markdown content via a worker-based pipeline with <200ms viewport-visible time, jank-free scrolling, and 60fps streaming — eliminating all main-thread markdown computation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero synchronous `marked.parser()` or `DOMPurify.sanitize()` calls for off-screen blocks (code audit)
- [ ] Zero compute-intensive work on main thread when workers are available — lexing, parsing, height estimation run in workers only (Chrome DevTools). Fallback mode ([D07]) runs inline but preserves viewport-only discipline.
- [ ] Main thread never blocks for more than 16ms during any rendering operation (Chrome DevTools)
- [ ] Worker pool processes visible+overscan blocks first; blocks beyond overscan are never pre-parsed (code audit + diagnostic)
- [ ] 1MB document: viewport visible in <200ms, full scroll range navigable immediately (gallery card)
- [ ] 10MB document: viewport visible in <200ms, scroll to any position in <16ms (gallery card)
- [ ] Scrollbar yank test: drag thumb top to bottom of 10MB doc in <1s, zero judder (gallery card)
- [ ] Streaming: 60fps, zero jank for 5000+ words of live deltas (gallery card)
- [ ] `HeightEstimator` interface implemented, default estimator within 20% of measured (unit test)
- [ ] Graceful degradation: works (slower) without workers (manual test with `poolSize: 0`)
- [ ] `bun test` passes, `bunx tsc --noEmit` clean, `bun run build` succeeds

**Acceptance tests:**
- [ ] Gallery card 1MB static: viewport <200ms, DOM <500, jank-free scroll
- [ ] Gallery card 10MB scrollbar yank: zero judder, zero placeholder flash
- [ ] Gallery card streaming 5000+ words: 60fps, zero dropped frames
- [ ] TugWorkerPool hardening: multi-slot dispatch test, init timeout test pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Learning estimator that converges based on measured heights (improves estimate accuracy over time)
- [ ] Code block syntax highlighting via Shiki in workers (Phase 3B)
- [ ] MDX/React element height estimation via component registry
- [ ] Per-device overscan tuning based on `navigator.hardwareConcurrency`
- [ ] Binary-encoded token transfer if message overhead becomes measurable
