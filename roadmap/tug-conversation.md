# The Conversation Experience — Roadmap

*Plumb the pipe first. See what comes out. Then build the UI.*

**Exploration journal:** [transport-exploration.md](transport-exploration.md) — 33 tests, protocol documentation, event catalogs.
**Architecture reference:** [tug-feed.md](tug-feed.md) — event schemas, correlation strategy, feed design.

---

## Vision

Build a graphical Claude Code conversation experience: the user types a prompt, the AI responds with streamed markdown, and agent progress is visible throughout.

---

## Action Items — Consolidated

Everything discovered in Phase 1 exploration, organized for action. This is the authoritative todo list.

### Transport Fixes (Phase 2)

| # | Item | Scope | Effort |
|---|------|-------|--------|
| T1 | **Fix `--plugin-dir`** in tugtalk to point to `tugplug/` not project root. Tugplug skills invisible without this. | tugtalk `getTugtoolRoot()` | Tiny |
| T2 | **Fix synthetic `assistant` text forwarding.** Tugtalk drops text from `model: "<synthetic>"` messages. Built-in skills like `/cost`, `/compact` produce text this way. Detect synthetic and emit as `assistant_text`. | tugtalk `routeTopLevelEvent` | Small |
| T3 | **Forward `api_retry` events.** Tugtalk drops `system` events with `subtype: "api_retry"`. Add forwarding. Audit for other dropped subtypes. | tugtalk `routeTopLevelEvent` | Small |
| T4 | **Process lifecycle management.** Tugtalk processes outlive tugcast — 137 zombies after 2 weeks. Use process groups or SIGTERM on shutdown. Card close must kill associated tugtalk. | tugcast process spawn | Medium |
| T5 | **Session command readiness.** `session_command: "new"` and `"fork"` have a gap: `session_init` fires with pending ID before new process is ready. Need clear readiness signal. | tugtalk session handling | Medium |
| T6 | **`--no-auth` flag for tugcast.** Skip session cookie + origin validation for dev/testing. Required to test the full WebSocket path. | tugcast `auth.rs` | Small |
| T7 | **Compile tugtalk to standalone binary.** `bun build --compile` produces a native executable — no Bun runtime dependency in production. Update justfile `app` recipe to build and copy. Agent bridge already prefers sibling binary. | tugtalk build, justfile | Small |
| T8 | **Fix `session_init` race condition.** `session_init` is broadcast (fire-and-forget) via `code_tx` only. Clients connecting after tugtalk startup never see it. Put `session_init` on a watch channel so it's delivered as a snapshot on connect, like `project_info`. | tugcast `agent_bridge.rs` | Small |
| T9 | **Fix double delivery of snapshot feeds.** Router borrows watch receivers for initial snapshot send, then clones them for ongoing watch tasks. Cloned receivers haven't "seen" the current value, so `changed()` fires immediately and re-sends. Fix: use `borrow_and_update()` and take ownership instead of borrow-then-clone. | tugcast `router.rs` | Small |
| T10 | **Encapsulate agent bridge watch channels.** Adding a new snapshot type (e.g. T8) requires touching 5 places across `main.rs` and `agent_bridge.rs`. Bridge should own its watch channels internally and return receivers via `AgentBridgeHandles`. Adding a new snapshot becomes a one-file change. | tugcast `agent_bridge.rs`, `main.rs` | Small |
| T11 | **Move `.tugtool/.session` to tugbank.** Tugtalk persists the current Claude Code session ID to `.tugtool/.session` inside the project directory, which dirties the working tree. Write session ID to tugbank instead. | tugtalk session persistence, tugbank | Small |

### UI Must Build (Phases 3-5 and beyond)

| # | Item | What | Priority |
|---|------|------|----------|
| U1 | **Text accumulation** | `assistant_text` partials are deltas. UI must buffer and accumulate. Final `complete` event has full text for verification. | Critical |
| U2 | **Permission dialog** | `control_request_forward` (`is_question: false`): tool name, input, reason. Allow/deny buttons. Permission suggestions for "always allow." Respond with `tool_approval`. | Critical |
| U3 | **AskUserQuestion dialog** | `control_request_forward` (`is_question: true`): questions with options, single/multi-select. Respond with `question_answer`. | Critical |
| U4 | **Interrupt button** | Send `{ type: "interrupt" }`. Turn ends with `turn_complete(result: "error")`. | Critical |
| U5 | **Streaming indicator** | Show during `assistant_text` partials. Remove on `turn_complete`. | High |
| U6 | **Thinking/reasoning display** | `thinking_text` events arrive before response. Collapsible block. | High |
| U7 | **Tool use display** | `tool_use` → `tool_result` → `tool_use_structured`. Show tool name, input, output, duration. | High |
| U8 | **Subagent activity** | `tool_use: Agent` brackets subagent lifetime. Nested tool calls visible. Show agent type, progress. | High |
| U9 | **Model switcher** | Send `model_change`. Synthetic `assistant_text` confirms. `system_metadata` updates. | High |
| U10 | **Permission mode switcher** | Send `permission_mode`. Cycle: default → acceptEdits → plan → auto. | High |
| U11 | **Cost/token display** | `cost_update` has `total_cost_usd`, `num_turns`, `duration_ms`, `usage` (input/output/cache tokens). | High |
| U12 | **Slash command popup** | Merge `system_metadata.slash_commands` + `system_metadata.skills`. Tugplug skills use `tugplug:` prefix. `/plan` is a name collision — use `tugplug:plan`. | High |
| U13 | **`@` file completion** | Terminal-only. UI must detect `@` in prompt, show file picker, inject file content into message or as attachment. | High |
| U14 | **Session new/fork handling** | Detect pending `session_init` IDs (`"pending"`, `"pending-fork"`). Wait for real ID. `"pending-cont..."` is safe immediately. | Medium |
| U15 | **Image attachments** | Base64 in `user_message.attachments`. Drag-drop/paste → encode → attach. Types: png, jpeg, gif, webp. Max ~5MB. | Medium |
| U16 | **API retry indicator** | `api_retry` events (after T3 fix): attempt count, delay, error type. | Medium |
| U17 | **Compaction indicator** | `compact_boundary` events. Show when context is being compacted. | Medium |
| U18 | **Session-scoped permission reset** | After resume, previously approved tools prompt again. Handle re-approval. | Medium |
| U19 | **Message queueing during turn** | Sending `user_message` mid-stream does NOT interrupt — it queues. UI should disable send (or show queue indicator) during streaming. Use `interrupt` to cancel. | High |
| U20 | **Plan mode choices** | `EnterPlanMode` tool produces approve/reject/keep-planning options. UI must present these when plan mode is active. | Medium |
| U21 | **Stop background task** | Send `{ type: "stop_task", task_id }`. UI needs a button/mechanism to stop running background tasks. | Medium |
| U22 | **Context window budget** | ~20% of context window used at startup (system prompt, memory, CLAUDE.md, etc.) before any user interaction. Token counter (U11) should account for this. | Low |
| U23 | **Task progress events** | `system:task_started`, `system:task_progress`, `system:task_completed` events provide agent lifecycle data (task_id, description, token usage). Use for progress indicators alongside U8. | High |

### Terminal-Only Commands (UI must reimplement)

These built-in commands have no stream-json equivalent — they return "Unknown skill." The UI must build its own versions.

| # | Command | What UI Needs | Priority |
|---|---------|--------------|----------|
| C1 | `/status` | Model, session, context usage from `system_metadata` + `cost_update.usage` | High |
| C2 | `/model` | Model picker → `model_change` message | High |
| C3 | `/permissions` | Mode display + switcher → `permission_mode` message | High |
| C4 | `/clear` | Clear conversation → `session_command: "new"` | High |
| C5 | `/resume` | Session picker (list, preview, rename, filter). Data from filesystem. | High |
| C6 | `/diff` | Run git diff via tool or Bash, render result | Medium |
| C7 | `/export` | Serialize conversation from accumulated events | Medium |
| C8 | `/copy` | Copy last response from accumulated `assistant_text` | Medium |
| C9 | `/btw` | Side question overlay — separate API call, no history impact | Medium |
| C10 | `/compact` | IS a skill (works), but UI should show compaction indicator | Medium |
| C11 | `/rename` | Text input → update session metadata | Low |
| C12 | `/branch`, `/rewind` | Session fork → `session_command: "fork"` | Low |
| C13 | `/vim` | Keybinding mode toggle for prompt input | Low |
| C14 | `/color`, `/theme` | Theme picker | Low |
| C15 | `/help` | Help display | Low |

### Further Exploration (open questions, not blocking)

| # | Area | Status | Notes |
|---|------|--------|-------|
| E1 | Slash command invocation | **Resolved** | Two small tugtalk fixes (T1, T2). |
| E2 | Plugin system | **Resolved** | All 12 tugplug agents + 4 skills visible with correct `--plugin-dir`. Plugin name `tugplug`. Hot-reload, session name untested but non-blocking. |
| E3 | Hooks visibility | Open | Hooks run silently. No events for hook decisions, context injection, timing. |
| E4 | Tugcast WebSocket layer | **Resolved** | Full path verified in Phase 2b. Wire protocol documented. Four issues found (T8-T11). |
| E5 | Session management | Partially tested | New, continue, fork tested. Picker data, concurrent sessions open. |
| E6 | Advanced patterns | Open | Background tasks, MCP, elicitation untested. |

---

## Phases

The work falls into three tiers: **prove the pipe**, **build the UI**, **add the feed layer**. Each phase is scoped to be one `/plan` → `/implement` cycle (or `/dash` for investigation/verification phases).

```
─── TIER 1: PROVE THE PIPE ───────────────────────────────────
Phase 1: Transport Exploration      — DONE (35 tests)
Phase 2: Transport Hardening        — DONE (T1-T7)
Phase 2b: WebSocket Verification    — DONE (probe written, 4 issues found)
Phase 2c: WebSocket Fixes           — DONE (T8-T11)

─── TIER 2: BUILD THE UI ─────────────────────────────────────
Phase 3A: Markdown Rendering Core    — virtualization, prefix sum, two-path rendering — DONE
Phase 3A.1: TugWorkerPool             — typed worker pool for parallel computation across cores
Phase 3A.2: Worker Markdown Pipeline — move parsing off main thread, viewport-only rendering
Phase 3B: Markdown Content Types     — code blocks, thinking, tool use, streaming (U1, U5, U6, U7)
Phase 4: Prompt Input               — input layer (U12, U13, U19)
Phase 5: Conversation Wiring        — core conversation loop (U2, U3, U4, U8, U14, U23)
Phase 6: Chrome & Status            — switchers, indicators, cost (U9-U11, U16, U17, U20-U22)
                                      + terminal commands: C1, C2, C3, C10
Phase 7: Session & Commands         — remaining terminal commands (C4-C9, C11-C15)
                                      + image attachments (U15), permission reset (U18), session picker (E5)

─── TIER 3: ADD THE FEED LAYER ───────────────────────────────
Phase 8: Hook Capture               — agent lifecycle events to feed.jsonl
Phase 9: Feed Correlation           — semantic enrichment with step context
Phase 10: Feed CLI + Tugcast        — tugcode feed commands, events reach browser
Phase 11: Agent-Internal Events     — file/command detail from within agents
Phase 12: Custom Block Renderers    — rich UI for agent output
```

**Item coverage:** Every U1-U23 and C1-C15 item is assigned to a phase. E3 (hooks visibility) and E6 (background tasks, MCP) remain deferred — non-blocking for UI work.

---

### Phase 1: Transport Exploration {#transport-exploration}

**Status: DONE.** 35 tests. See [transport-exploration.md](transport-exploration.md) for full journal.

**Key discoveries:**
- `assistant_text` partials are **deltas**, not accumulated. Final `complete` has full text.
- `thinking_text` is a separate event type arriving before response.
- ALL slash commands go through `user_message` — skills produce full event streams, terminal-only commands return "Unknown skill."
- `control_request_forward` is the unified gate for permissions AND `AskUserQuestion` (dispatch on `is_question`). **Verified live** with `/tugplug:plan` triggering clarifier agent questions.
- Interrupt produces `turn_complete(result: "error")`, not `turn_cancelled`.
- Subagent tool calls are fully visible in the stream (nested under `tool_use: Agent`).
- **`system:task_started/progress/completed`** events provide agent lifecycle tracking with task_id, description, and token usage — ideal for progress indicators.
- `system_metadata` sent every turn contains model, tools, slash commands, skills, plugins, agents, permission mode — the source for all UI chrome. With correct `--plugin-dir`: all 12 tugplug agents + 4 skills visible.
- `--plugin-dir` must point to `tugplug/` for skills/agents to be visible (was the root cause of the slash command mystery).
- Tugtalk drops `api_retry` events and synthetic `assistant` text — needs fixes (T2, T3).
- 137 orphaned tugtalk processes after 2 weeks — process lifecycle needs fixing (T4).

---

### Phase 2: Transport Hardening {#transport-hardening}

**Status: DONE.** All seven items committed.

**Commits:**
1. `ec7fad06` T1 — fix `--plugin-dir` to point to `tugplug/`
2. `923a655c` T2 — forward synthetic assistant text
3. `f3ac0249` T3 — forward `api_retry` events
4. `ac3cdf54` T6 — `--no-auth` flag, port defaults to tugbank
5. `67c22ad1` T4 — process lifecycle (process groups, parent-death watchdog, kill_on_drop)
6. `314a13cc` T5 — session command readiness signaling
7. `70e8733e` T7 — compile tugtalk to standalone binary

**Exit criteria met:**
- All tugplug skills visible in `system_metadata.skills` and invocable via `user_message`
- Built-in skill commands (`/cost`, `/compact`) produce text output through tugtalk
- `api_retry` events forwarded
- No orphaned tugtalk processes after app quit
- `--no-auth` flag available for WebSocket testing
- Session new/fork/continue all signal readiness correctly
- Tugtalk compiles to standalone binary — no Bun runtime dependency in production

---

### Phase 2b: WebSocket Verification {#websocket-verification}

**Status: DONE.** Probe written (`tugtalk/probe-websocket.ts`), full findings in [ws-verification.md](ws-verification.md).

**Key findings:**
- Wire protocol confirmed: binary frames `[1-byte FeedId][4-byte BE u32 length][payload]`
- Full round-trip works: WebSocket connect → `protocol_init` → `user_message` → streamed `assistant_text` → `turn_complete(result=success)`
- Reconnection works: fresh snapshot feeds delivered immediately
- All snapshot feeds (filesystem, git, stats, project_info) arrive on connect

**Issues discovered (T8-T11):**
- T8: `session_init` race — broadcast before client subscribes, missed on every fresh launch
- T9: Double delivery — snapshot feeds sent twice on connect due to watch receiver clone bug
- T10: Five touchpoints to add a watch channel — agent bridge should encapsulate its own channels
- T11: `.tugtool/.session` written to repo tree, dirties working tree

---

### Phase 2c: WebSocket Fixes {#websocket-fixes}

**Goal:** Fix T8-T11. Clean up the issues found in Phase 2b before building UI.

**Inputs:** Phase 2b findings.

**Work:** Items T8-T11 from the action items table. Prioritized:
1. T8 (session_init watch channel) — directly blocks UI session handling
2. T9 (double delivery) — code smell in router, fix while touching snapshot code
3. T10 (encapsulate bridge channels) — clean up the pattern T8 introduced
4. T11 (session file location) — stop dirtying the repo tree

**Exit criteria:**
- `session_init` delivered as snapshot on connect (no race)
- No double delivery of snapshot feeds
- Adding a new agent bridge snapshot type is a one-file change
- No tugtalk-written files inside the repo tree

**Outputs:** Verified WebSocket path. Confidence to build UI.

---

### Phase 3A: Markdown Rendering Core {#markdown-rendering-core}

**Goal:** Build the virtualized markdown rendering engine that handles multi-MB content. This is the foundation everything else renders through.

**Inputs:** Verified transport (Phases 2, 2b). `assistant_text` delta model from Phase 1.

**Key constraint:** Claude Code sessions routinely reach multi-MB sizes (observed: 110MB, 20MB, 3.4MB in real usage). Rendering the full conversation into the DOM is not viable. The component must virtualize, informed by how Monaco editor achieves instant rendering of arbitrarily large files.

#### Monaco-informed architecture

Monaco's rendering performance comes from three core ideas that transfer directly to our markdown use case:

**1. PrefixSumComputer — the single most important data structure.**

Monaco stores per-line heights in a `Uint32Array` with a lazily-computed prefix sum. `getIndexOf(scrollTop)` finds the first visible line via binary search in O(log n). The scrollbar is accurate for million-line files without rendering them. Our equivalent:

- `BlockHeightIndex`: a `Float64Array` of per-block heights (estimated before render, measured after).
- Lazy prefix sum with a validity watermark — recompute only from the point of change.
- `getBlockAtOffset(scrollTop)` → binary search → first visible block. O(log n).
- `getTotalHeight()` → sum of all block heights. Drives the scrollbar/scroll container sizing.
- Estimated heights: paragraph = line count × line height; heading = known per level; code = line count × code line height + header; hr = fixed. Refined to measured heights once a block enters the viewport and renders.

**2. Viewport-only DOM — sliding window of rendered blocks.**

Monaco's `RenderedLinesCollection` maintains a contiguous array of DOM nodes mapped to document line numbers. Only lines in/near the viewport exist in the DOM. Our equivalent:

- `RenderedBlockWindow`: tracks which blocks currently have DOM nodes (startIndex, endIndex).
- On scroll: compute new visible range from `BlockHeightIndex`, diff against current window, add entering blocks, remove exiting blocks.
- Overscan: render 1-2 screens above/below the viewport for smooth scrolling.
- Unchanged blocks in the viewport: reposition only (translate Y), don't rebuild.
- Each block has a dirty flag (Monaco's `_isMaybeInvalid`). Skip DOM update if content unchanged.
- A spacer element above and below the rendered window, sized from the prefix sum, creates the correct scroll height.

**3. Two rendering paths — static and streaming.**

*Static path* — Full content already available (resumed sessions, history, completed messages).
- `marked.lexer()` once → block list. Estimate heights. Populate `BlockHeightIndex`.
- Render only the viewport window. Measure rendered blocks, update heights.
- For very large content (>1MB): lex in chunks via `requestIdleCallback` to avoid blocking. Show a progress indicator or render from the tail (most recent content first).

*Streaming path* — Deltas arriving live from `assistant_text` events.
- Accumulate deltas into a buffer (U1). `PropertyStore<string>` [L02], rAF throttle.
- Incremental lexing: only re-lex from the last stable block boundary. Previous blocks are frozen.
- New blocks append to the block list and `BlockHeightIndex`. Viewport auto-scrolls to tail.
- On `turn_complete`, finalize: full lex of the last block for verification, freeze all blocks.

*Transition:* Prior messages load via static path. Active response uses streaming path. Both coexist in a single scroll container backed by one `BlockHeightIndex`.

**Work:**
- `BlockHeightIndex`: `Float64Array` prefix sum with lazy recomputation, binary search for offset→block mapping.
- `RenderedBlockWindow`: sliding window of DOM nodes, overscan, dirty tracking.
- `marked.lexer()` → keyed block list. Block types: paragraph, heading, code, blockquote, list, table, hr, html.
- Scroll container: spacer elements sized from prefix sum, scroll event → viewport recalc.
- Static path: bulk lex, chunked for large content.
- Streaming path: delta accumulation, incremental tail lexing, auto-scroll.
- Height estimation heuristics per block type. Measure-and-refine cycle.
- Integration with `PropertyStore` [L02] for streaming state.

**Exit criteria:**
- DOM node count stays bounded regardless of content size — verified with 10MB+ test content.
- Static: 1MB renders in <200ms (viewport visible). 10MB renders in <1s (viewport visible, background lex continues). Scrollbar accurate within 5% before full measurement.
- Streaming: 60fps, no jank for 5000+ words of live deltas.
- Scroll through 10MB content at 60fps — no dropped frames.
- `BlockHeightIndex.getBlockAtOffset()` completes in <1ms for 100K blocks.
- Laws compliance: [L02, L06].

**Demo:** Load a 5MB recorded conversation, scroll through it smoothly. Then feed live deltas at the tail and watch it stream while scrolling remains responsive.

---

### Phase 3A.1: TugWorkerPool {#tug-worker-pool}

**Status:** Not started.

**Goal:** Build a typed worker pool that spreads computation across multiple cores. The point is parallelism, throughput, and *never blocking the UI thread with compute-intensive work*. When there are 5,000 markdown blocks to parse, split them across N workers and get the answer N times faster. Dev machines have 8-16+ cores sitting idle; this infrastructure lights them up.

**Inputs:** Phase 3A experience (what goes wrong without workers). Library research and risk validation (below).

**Non-goal:** This is not a job scheduler, not a generic service bus, not a task registry. It's a pool of identical workers that you throw work at in parallel.

**Hard constraint:** The main thread is sacred. No compute-intensive work — lexing, parsing, height estimation, syntax highlighting — may run on the main thread. The main thread handles DOM reads/writes, scroll events, and React rendering. Everything else goes to workers. This is not aspirational; it is a rule. Violating it produces the same 15-second freeze we're fixing.

#### Library research findings

Surveyed MIT-compatible worker libraries for browser use:

| Library | License | Stars | Bundle | Pool | Cancel | Priority | Maintained |
|---------|---------|-------|--------|------|--------|----------|------------|
| **Comlink** | Apache-2.0 | 12.6K | 1.1kB | No | No | No | Stable/low activity |
| **workerpool** | Apache-2.0 | 2.3K | 9kB | Yes | Yes | No | Active |
| **threads.js** | MIT | 3.5K | 3kB | Yes | Partial | No | Semi-maintained |
| **poolifier-web-worker** | MIT | 62 | Small | Yes | ? | Yes | Active |
| **greenlet** | MIT | 4.7K | 1kB | No | No | No | Unmaintained |

**Recommendation: Build our own, informed by the MIT-licensed libraries.** ~200 lines. Zero dependencies. Fits existing tugdeck patterns (DeckManager, ResponderChain, PropertyStore).

#### Patterns adopted from MIT-licensed libraries [L21]

Copyright notices preserved in `THIRD_PARTY_NOTICES.md` per [L21]. Source files must reference the relevant notice entry.

**From threads.js** (Copyright (c) 2019 Andy Wermke, MIT):
- **Thenable task handle with cancellation.** Return object is both `await`-able and has `.cancel()`.
- **Discriminated union message protocol.** `type` field enum for TypeScript narrowing.
- **Init handshake with timeout.** Workers send `init` on load; pool waits with configurable timeout.

**From poolifier-web-worker** (Copyright (c) 2023-2024 Jerome Benoit, MIT):
- **Least-busy worker selection.** Pick the worker with fewest in-flight tasks.
- **Promise-response-map RPC.** `Map<taskId, {resolve, reject}>` resolved on worker response.

**From greenlet** (Copyright (c) Jason Miller, MIT):
- **Counter-based task IDs with stashed resolve/reject.** Simplest correct RPC in ~5 lines.
- **Automatic transferable detection.** Filter for `ArrayBuffer`/`MessagePort`/`ImageBitmap`.

**Pitfalls avoided:** threads.js `delay(0)` timing hack, poolifier's 2,500-line abstract pool with `new Function()` injection, greenlet's missing cleanup and lossy error serialization.

#### Design: TugWorkerPool\<TReq, TRes\>

Each consumer creates its own pool of N identical workers. No shared pool, no cross-type dispatch. Markdown gets a pool. Shiki gets a pool (later). They don't interfere because they have different initialization needs (Shiki workers carry a persistent highlighter instance; markdown workers are stateless).

```
   TugMarkdownView                          Shiki (Phase 3B)
        │                                        │
        ▼                                        ▼
 TugWorkerPool<ParseReq, ParseRes>    TugWorkerPool<HighlightReq, HighlightRes>
   ┌─────┬─────┬─────┐                  ┌─────┬─────┐
   │ W1  │ W2  │ W3  │ W4               │ W1  │ W2  │
   │.....│.....│.....│......             │.....│.....│
   │ md  │ md  │ md  │ md               │shiki│shiki│
   └─────┴─────┴─────┘                  └─────┴─────┘
        ▲                                     ▲
     N = hardwareConcurrency-based         N = separate
```

**The pool is generic over request/response types.** The caller decides what goes in and what comes out. The pool handles:

1. **Spawning N workers** from a single worker script URL.
2. **Dispatching tasks** to the least-busy worker (fewest in-flight tasks).
3. **Promise-response-map RPC** — each `submit()` returns `{ promise, cancel() }`.
4. **Cancellation** — removes queued tasks or signals in-flight workers.
5. **Typed messages** — discriminated union protocol, no `any`.
6. **Lazy spawn + idle timeout** — workers created on first task, terminated after 30s idle.
7. **Graceful degradation** — if `Worker` constructor fails, run handler inline on main thread.

**What the pool does NOT handle:** Priority queuing, task registries, back-pressure signaling, worker selection strategies beyond least-busy. The caller controls what to submit and when — if the viewport scrolls, the component cancels stale tasks and submits new ones. Priority is the caller's concern.

#### Key design decisions

**W13: Per-consumer pools, not a shared service.**
Each feature creates its own `TugWorkerPool` pointing at its own worker file. This avoids the cross-type dispatch problem (Shiki needs persistent state in the worker; markdown is stateless) and keeps the pool implementation simple. If two features compete for cores, the OS scheduler handles it — that's what it's for.

**W14: Pool size from `navigator.hardwareConcurrency`.**
Default: `Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 2, 12))`. On a 16-core machine: 12 workers. Reserves 2 cores (main thread + OS/browser overhead), caps at 12 to stay reasonable. Target audience runs beefy dev machines with 32-128GB+ RAM — each worker context is ~5-10MB, so even 12 workers is <120MB. Configurable per pool — markdown might want the full 12, a lightweight task might want 4. Lazy spawn: workers created on first task, not at pool creation.

**W15: Cancellation via task ID.**
Every `submit()` returns a handle. `handle.cancel()` either removes from the queue (if pending) or posts a cancellation message to the worker (if in-flight). Workers should check a cancellation flag between processing steps (e.g., between parsing blocks in a batch).

**W16: Graceful degradation.**
If `Worker` construction fails, the pool creates an inline executor that runs the handler function directly on the main thread via `queueMicrotask`. Same `TaskHandle` API. Callers don't know the difference. Essential for test environments and CSP-restricted contexts.

**W17: Typed message protocol.**
Wire protocol: `{ taskId: number, type: 'task', payload: TReq }` → `{ taskId: number, type: 'result', payload: TRes }` | `{ taskId: number, type: 'error', error: { message, stack, name } }`. Plus `{ type: 'init' }` handshake and `{ type: 'cancel', taskId }` signal. Discriminated union, no `any`.

#### API

```typescript
// --- Pool creation (in a component, hook, or module) ---
const mdPool = new TugWorkerPool<MarkdownParseReq, MarkdownParseRes>(
  new URL('./workers/markdown-worker.ts', import.meta.url),
  { poolSize: 4 }  // optional, defaults to hardwareConcurrency-based
);

// --- Submit work ---
const handle = mdPool.submit({ blockIndex: 42, tokenRaw: '## Hello' });
const result = await handle.promise;  // { index: 42, html: '<h2>Hello</h2>' }

// --- Cancel (e.g., user scrolled away) ---
handle.cancel();

// --- Submit a batch in parallel ---
const handles = blocks.map(b => mdPool.submit(b));
const results = await Promise.all(handles.map(h => h.promise));

// --- Cleanup ---
mdPool.terminate();  // kills all workers

// --- In the worker file (markdown-worker.ts) ---
import { marked } from 'marked';

self.onmessage = (e: MessageEvent) => {
  const { taskId, type, payload } = e.data;
  if (type === 'cancel') { /* set flag */ return; }
  if (type === 'task') {
    try {
      const html = marked.parser([rebuildToken(payload)]);
      self.postMessage({ taskId, type: 'result', payload: { index: payload.blockIndex, html } });
    } catch (err) {
      self.postMessage({ taskId, type: 'error', error: serializeError(err) });
    }
  }
};
self.postMessage({ type: 'init' });
```

The worker file is plain — it owns its imports, its state, its `onmessage` handler. The pool doesn't dictate what happens inside the worker. It just manages the fleet and the RPC plumbing.

#### Work

**Step 1: Types (`tugdeck/src/lib/tug-worker-pool.ts`, top section).**
`TaskHandle<T>`, `WorkerMessage<TReq, TRes>` discriminated union, `TugWorkerPoolOptions`. ~40 lines.

**Step 2: Pool implementation (`tugdeck/src/lib/tug-worker-pool.ts`, main class).**
`TugWorkerPool<TReq, TRes>`: constructor takes worker URL + options. Manages `WorkerSlot[]` (worker instance + in-flight count + pending queue). `submit()` picks least-busy slot, posts message, returns handle. `onmessage` resolves/rejects from response map. Lazy spawn on first submit. Idle timeout per worker. `terminate()` kills all. ~150 lines.

**Step 3: Graceful degradation (`tugdeck/src/lib/tug-worker-pool.ts`, fallback path).**
If `new Worker()` throws, create `InlineSlot` that runs a user-provided handler function via `queueMicrotask`. Constructor accepts optional `fallbackHandler: (req: TReq) => TRes | Promise<TRes>`. ~30 lines.

**Step 4: Tests (`tugdeck/src/__tests__/tug-worker-pool.test.ts`).**
Test via degradation path (fallback handler). Verify: submit resolves, cancellation of queued tasks, least-busy dispatch (submit N+1 tasks to pool of N, verify distribution), error propagation (handler throws → promise rejects with structured error), terminate cleans up. ~120 lines.

**Step 5: Integration test with real worker.**
`tugdeck/src/__tests__/tug-worker-pool.integration.test.ts` — create a trivial `echo-worker.ts` that posts back what it receives. Verify real `Worker` spawn in Bun, round-trip message passing, pool of 2 workers handles concurrent tasks. ~50 lines.

**Step 6: Vite build verification.**
`bun run build` emits worker chunk. Manual browser test: pool spawns real workers, devtools shows threads.

#### Checkpoints

- `bun test src/__tests__/tug-worker-pool.test.ts` — all tests pass.
- `bun test src/__tests__/tug-worker-pool.integration.test.ts` — real worker round-trip passes.
- `bunx tsc --noEmit` — no new type errors.
- `bun run build` — build succeeds, worker chunk emitted.

#### Exit criteria

- `new TugWorkerPool(url).submit(req)` dispatches to a real web worker and resolves with the response.
- Pool spreads tasks across N workers (verified: N tasks submitted simultaneously → N workers each get one).
- Cancellation works for queued and in-flight tasks.
- Graceful degradation: fallback handler runs inline when `Worker` constructor fails.
- Idle workers are terminated after timeout. New tasks respawn them.
- `terminate()` kills all workers and rejects all pending promises.
- ~200 lines total. Zero dependencies.

#### Risks (grounded)

- R06: **Vite requires static string literals in `new Worker(new URL(...))`** (confirmed). Must be a literal — no variables, no template literals. Vite handles `.ts` natively. Static imports inside the worker are auto-bundled into the worker chunk. **Risk: LOW.** Each consumer writes the literal `new URL('./workers/foo-worker.ts', import.meta.url)` directly.
- R07: **Dynamic `import()` inside workers is broken with Vite's default IIFE format** (confirmed, Vite issues #18585, #5402). **Mitigation: not our problem.** Worker files use static imports only. Each worker file imports its own dependencies at the top level. The pool doesn't dictate worker internals. **Risk: ELIMINATED.**
- R08: **Bun test runner has native `Worker` global** (confirmed). Real threads spawn in `bun test`. **Mitigation:** Unit tests use the fallback handler (no real threads). Integration tests use real Workers with a trivial echo worker to verify the spawn/message/terminate lifecycle. **Risk: LOW.**

---

### Phase 3A.2: Worker-Based Markdown Pipeline {#worker-markdown-pipeline}

**Status:** Not started.

**Goal:** Move all heavy markdown computation off the main thread. The Phase 3A implementation put lexing, parsing, and sanitization on the main thread, then compounded the problem by pre-rendering all ~5,000 blocks via `scheduleIdleBatch`. The result: ~15 seconds of main-thread blocking for a 1MB document. This phase fixes the architecture.

**Content model:** This is a *viewer*, not an editor. The component supports exactly two operations: (1) loading a potentially large initial markdown document, and (2) appending new content to the end of it (streaming). There is no editing, no insertion at arbitrary positions, no deletion, no cursor. This constraint simplifies the entire architecture — the block list is append-only during streaming, the prefix sum never needs mid-array insertion, the HTML cache is never invalidated by user edits, and the scroll position only auto-advances (tail-follow) or stays put (user-controlled). Do not design for general-purpose editing.

**Inputs:** Phase 3A code (BlockHeightIndex, RenderedBlockWindow, TugMarkdownView). Phase 3A.1 TugWorkerPool. Monaco editor architecture study (below).

#### What went wrong in Phase 3A

The Phase 3A roadmap section correctly identified Monaco's prefix sum and sliding window patterns, but missed Monaco's most important architectural principle: **never compute what isn't visible.** Three specific failures:

1. **`scheduleIdleBatch` pre-renders ALL blocks into the DOM.** After the initial viewport render (~60 blocks), idle callbacks iterate through all remaining ~4,940 blocks, calling `marked.parser()` + `DOMPurify.sanitize()` for each. At ~2ms per block, that's ~13 seconds of main-thread work — even though the user may never scroll to most of those blocks. This defeats the entire purpose of the sliding window.

2. **All parsing runs synchronously on the main thread.** `marked.lexer()` (fast, ~5ms for 1MB) and `marked.parser([token])` + `DOMPurify.sanitize()` (slow, ~2ms per block) all run on the UI thread. When the user scrolls to unrendered blocks, `addBlockNode()` calls `renderToken()` synchronously, causing visible jank.

3. **The streaming path calls `renderToken()` for reconciliation even on off-screen blocks** (line 539), wasting cycles comparing HTML for blocks that have no DOM nodes.

#### Monaco architecture study — what we should have learned

Monaco's rendering performance comes from principles the Phase 3A implementation adopted only partially:

**Principle 1: Viewport-only computation (adopted partially).**
Monaco does NOT tokenize the entire file on load. It tokenizes only the visible lines, then progressively tokenizes the rest in the background. Phase 3A adopted the sliding window for DOM nodes but then undermined it by pre-rendering all blocks anyway.

**Principle 2: Worker threads for heavy computation (not adopted).**
Monaco runs language services (type checking, validation, formatting) in dedicated web workers. The main thread handles only rendering and user interaction. Phase 3A runs everything — lexing, parsing, sanitization — on the main thread.

**Principle 3: Incremental updates with state propagation (adopted partially).**
Monaco retokenizes only the modified line and checks whether the end state changed. If not, subsequent lines are untouched. Phase 3A's streaming path does incremental tail re-lexing, which is good, but still calls `renderToken()` on every reconciled block regardless of visibility.

**Principle 4: Binary-encoded tokens for transfer efficiency (not adopted).**
Monaco encodes tokens as `Uint32Array` (32 bits per token field) for efficient memory and fast transfer between threads. Phase 3A uses full JavaScript Token objects, which are expensive to clone across worker boundaries via `postMessage`. For our use case, we don't need binary encoding — but we do need to be thoughtful about what crosses the worker boundary.

**What Monaco does NOT do (important negative findings):**
- Does not use `SharedArrayBuffer` for token transfer — just `postMessage`.
- Does not scale worker count by `navigator.hardwareConcurrency` — uses one worker per language service.
- Does not pre-tokenize large files — viewport-first, always.
- Falls back gracefully to main thread if workers are unavailable.

#### Architecture: the worker-based markdown pipeline

The new architecture has three layers:

```
┌─────────────────────────────────────────────────────────┐
│  WORKER THREAD (MarkdownWorker)                         │
│                                                         │
│  Receives: raw markdown text + visible range hint       │
│  Produces: Token[], estimated heights, parsed HTML[]    │
│                                                         │
│  1. marked.lexer(text) → Token[]                        │
│  2. estimateBlockHeight(token) for each token           │
│  3. marked.parser([token]) for each token → HTML[]      │
│     (priority: visible range first, then outward)       │
│  4. postMessage({ tokens, heights, htmlByIndex })       │
│                                                         │
│  For streaming: incremental tail-lex, same priority     │
└──────────────────────┬──────────────────────────────────┘
                       │ postMessage (structured clone)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  MAIN THREAD (TugMarkdownView)                          │
│                                                         │
│  Receives: tokens, heights, pre-parsed HTML strings     │
│                                                         │
│  1. Populate BlockHeightIndex from heights              │
│  2. On scroll: RenderedBlockWindow.update(scrollTop)    │
│  3. For entering blocks:                                │
│     a. If htmlByIndex has the HTML → sanitize + render  │
│     b. If not yet parsed → request from worker (async)  │
│        meanwhile show placeholder / estimated-height    │
│  4. DOMPurify.sanitize(html) — ONLY for visible blocks  │
│  5. DOM write: element.innerHTML = sanitizedHtml        │
│                                                         │
│  DOMPurify stays on main thread (requires DOM).         │
│  Sanitization cost is bounded: only visible blocks,     │
│  never more than ~60-100 at a time.                     │
└─────────────────────────────────────────────────────────┘
```

**Key design decisions:**

**W07: Use TugWorkerPool for parallel parsing.**
Phase 3A.1's `TugWorkerPool<TReq, TRes>` provides a fleet of identical workers for parallel computation. TugMarkdownView creates a pool of N markdown workers (N from `navigator.hardwareConcurrency`). When blocks need parsing, batches are spread across all workers simultaneously — 5,000 blocks across 4 workers completes in ~1/4 the time of a single worker. The pool handles RPC, cancellation (W15), and graceful degradation (W16). The worker file owns its imports (`marked`) and its `onmessage` handler — the pool doesn't dictate worker internals.

**W08: Viewport-priority parsing with deep overscan.**
The worker pool receives a `visibleRange` hint with each request. It parses blocks in this order: (1) blocks in the visible range, (2) blocks in the overscan range, (3) stop. It does NOT parse the entire document. When the user scrolls, stale requests are cancelled and new ones submitted for the new viewport.

Getting overscan right is critical to the illusion that everything is always rendered. The overscan must be deep enough that a fast scrollbar yank — grabbing the scrollbar thumb and dragging it aggressively — never reveals unrendered blocks. The scrollbar cannot hitch, judder, or show placeholders during aggressive scrolling. This means:
- Overscan of 3-5 screens above and below the viewport (tunable, not hardcoded).
- The HTML cache (W09) retains parsed blocks even after they leave the overscan zone, so scrolling back doesn't re-parse.
- When the scroll position jumps (scrollbar drag, keyboard Page Down), the pool immediately submits the new visible+overscan range as a parallel batch across all workers. With 4 workers and ~120 overscan blocks, each worker handles ~30 blocks — completing in the time it takes to parse 30 blocks sequentially (~60ms), well under the next frame.
- If a block enters the viewport before its HTML arrives from the worker, a placeholder at estimated height is shown and swapped on arrival. But the overscan depth should make this a rare edge case, not the normal path.

**W09: HTML cache, not pre-rendering.**
Parsed HTML strings are cached in a `Map<number, string>` on the main thread. When a block enters the viewport, the main thread checks the cache first. Cache hit → sanitize and render immediately. Cache miss → request from worker, show a placeholder div at estimated height. The placeholder is replaced when the worker responds. This eliminates `scheduleIdleBatch` entirely.

**W10: DOMPurify only at render time.**
DOMPurify requires the DOM and cannot run in a worker. Instead of sanitizing all blocks eagerly, sanitize only when a block enters the viewport and is about to be written to the DOM. This bounds sanitization cost to ~60-100 blocks at any time (viewport + overscan), regardless of document size.

**W11: Streaming path uses same worker.**
Streaming deltas are sent to the worker for incremental tail-lexing (same as Phase 3A's approach, but off-thread). The worker returns only the changed/new tokens and their HTML. The main thread applies the diff to the visible window. Off-screen streaming blocks are not parsed until scrolled to.

**W12: Graceful degradation.**
If the worker fails to initialize (e.g., CSP restrictions, old browser), fall back to main-thread lexing + parsing with the viewport-only discipline (W08). The fallback is still faster than Phase 3A because it never pre-renders all blocks.

**W18: Height estimation as pluggable infrastructure.**
The Phase 3A `estimateBlockHeight()` function uses naive line-counting heuristics (paragraph = `ceil(text.length / 80) * LINE_HEIGHT`). This is inadequate for two reasons: (1) real content has variable-width fonts, padding, margins, and nested structures that make character-counting unreliable, and (2) MDX and React elements embedded in the document flow will have heights that cannot be estimated from text alone.

The height estimation system must be designed as pluggable infrastructure, not a hardcoded switch/case:
- **`HeightEstimator` interface** with a `estimate(token: Token): number` method. BlockHeightIndex accepts an estimator at construction.
- **Default text estimator** uses the current heuristic (line counting + constants) as a baseline. Good enough for plain markdown.
- **Measured-height feedback loop** already exists (ResizeObserver → `setHeight()`). The estimator's job is to get *close enough* that the placeholder-to-measured swap doesn't cause visible layout shift. Within 20% is the target.
- **Type-specific estimators** can be registered for block types that need special logic: code blocks (account for line numbers, header chrome, syntax highlighting padding), embedded React components (use a registered default height or query a component registry for preferred size), tables (estimate from row/column count + cell padding).
- **Learning estimator (future)** — after measuring N blocks of a given type, use the median measured height as the estimate for subsequent blocks of the same type. This converges quickly and adapts to theme changes, font size preferences, and container width.

This is forward-looking infrastructure. Phase 3A.2 implements the interface + default estimator + measured-height feedback. Phase 3B adds the code block estimator. MDX/React element estimators come when those content types arrive.

#### Work

**Step 1: Rip out `scheduleIdleBatch` and fix viewport-only rendering.**
Before adding workers, fix the immediate performance disaster. Remove `scheduleIdleBatch`, `RENDER_BATCH_SIZE`, and the idle callback plumbing. Ensure `addBlockNode()` is called ONLY by `applyWindowUpdate()` (entering blocks) — never in a pre-render loop. Add an HTML cache (`Map<number, string>`) so blocks exiting and re-entering the window don't re-parse. This alone should reduce the 1MB render from ~15s to ~200ms.

**Step 2: Create the markdown task handler.**
New file: `tugdeck/src/workers/markdown-tasks.ts`. This is a task handler registered with TugWorkerService (Phase 3A.1). It handles task types:
- `markdown:lex` — runs `marked.lexer()`, returns tokens + estimated heights.
- `markdown:parse` — runs `marked.parser([token])` for each token in a range, returns `{ index, html }[]`.
- `markdown:parse-incremental` — streaming tail-lex + parse.

TugWorkerService handles lifecycle, cancellation, and priority dispatch. The task handler is pure computation with no framework dependencies.

**Step 3: Wire TugMarkdownView to the worker.**
Replace synchronous `marked.lexer()` and `renderToken()` calls with async worker requests. The static path becomes: (1) send `lex` to worker, (2) on response, populate BlockHeightIndex + render visible window from returned HTML, (3) on scroll, send `parse` for newly visible blocks. The streaming path sends `parse-incremental` on each delta.

**Step 4: Add placeholder blocks for async rendering.**
When a block enters the viewport but its HTML isn't cached yet (cache miss, worker still processing), render a placeholder `<div>` at the estimated height. When the worker responds, replace the placeholder with the real content. Use a CSS transition (opacity fade) so the swap isn't jarring.

**Step 5: Verify performance and stress test.**
Update the gallery card to show worker status (idle/busy, cache hit rate, parse queue depth). Verify: 1MB renders in <50ms (viewport visible), 10MB in <100ms, scroll to any position completes in <16ms (one frame), streaming at 60fps with zero main-thread jank.

#### Checkpoints

- `bun test` — all existing BlockHeightIndex + RenderedBlockWindow tests still pass.
- `bunx tsc --noEmit` — no new type errors (pre-existing errors in unrelated files are acceptable).
- `bun run build` — build succeeds, worker chunk emitted.
- Gallery card: 1MB static content appears in <200ms. DOM node count stays <500. Scrolling is jank-free.
- Gallery card: 10MB stress test — viewport appears in <200ms, scroll is smooth.
- Gallery card: streaming mode — 60fps, no dropped frames during 5000+ word stream.
- `performance.now()` measurement in gallery diagnostic: `renderToken()` never called outside viewport+overscan range.

#### Exit criteria

- Zero synchronous `marked.parser()` or `DOMPurify.sanitize()` calls for off-screen blocks.
- Zero compute-intensive work on the main thread. Lexing, parsing, and height estimation run in workers only.
- Main thread never blocks for more than 16ms (one frame) during any rendering operation.
- Worker pool processes visible+overscan blocks first; blocks beyond overscan are never pre-parsed.
- 1MB document: viewport visible in <200ms, full scroll range navigable immediately.
- 10MB document: viewport visible in <200ms, scroll to any position in <16ms.
- **Scrollbar yank test:** grab the scrollbar thumb and drag it from top to bottom of a 10MB document in under 1 second. Zero judder, zero placeholder flashes, zero dropped frames. The overscan depth and parallel worker throughput must make this seamless.
- Streaming: 60fps, zero jank for 5000+ words of live deltas.
- `HeightEstimator` interface implemented. Default text estimator produces heights within 20% of measured for standard markdown blocks. BlockHeightIndex accepts a pluggable estimator.
- Graceful degradation: works (slower) without worker.

#### Risks

- R03: `postMessage` serialization cost for Token objects. Marked Token objects contain nested properties (e.g., `tokens` array on paragraphs for inline markup). Structured clone handles this but may add 1-5ms per message for large token lists. Mitigation: transfer only what's needed — for the `parse` response, send `{ index: number, html: string }[]` (flat array of strings), not full Token objects.
- R04: Placeholder-to-real swap may cause layout shift if estimated height differs significantly from actual. Mitigation: the existing ResizeObserver measurement + prefix sum recomputation handles this — it's the same mechanism that already corrects estimated heights. The pluggable HeightEstimator (W18) allows type-specific estimation that gets closer to measured heights, reducing visible shifts. The learning estimator (future) will converge on accurate heights after measuring a few blocks of each type. For MDX/React elements, a component registry can provide preferred heights before first render.
- R05: Worker initialization time (~10-50ms for module loading). Mitigation: initialize worker eagerly on first TugMarkdownView mount, not on first content load. Worker stays alive for the component's lifetime.

---

### Phase 3B: Markdown Content Types {#markdown-content-types}

**Goal:** Rich rendering for all markdown content types, built on the Phase 3A virtualization engine. Addresses U1, U5, U6, U7.

**Inputs:** Phase 3A rendering core (BlockHeightIndex, RenderedBlockWindow, two-path rendering).

**Work:**
- GFM markdown: paragraphs, headings, emphasis, links, images, lists, tables, blockquotes, horizontal rules. All standard `marked.lexer()` token types rendered as React elements.
- TugCodeBlock: Shiki with tug theme, copy-to-clipboard, language label, line numbers, collapse/expand. **Lazy highlighting**: only highlight code blocks when they enter the viewport. Off-screen blocks queued via `requestIdleCallback`. Stale highlights discarded via version IDs (Monaco pattern).
- Streaming cursor (U5): visible during `assistant_text` partials. Positioned at end of last block. Removed on `turn_complete`.
- Thinking block rendering (U6): `thinking_text` events → collapsible block. Shows "Thinking..." during streaming, full text when complete.
- Tool use display (U7): `tool_use` → `tool_result` → `tool_use_structured`. Show tool name, input, output, duration. Collapsible.
- `--tugx-md-*` token aliases. `@tug-pairings` per [L16, L19].
- `tug-*` custom block extension point (for future Phase 12 custom renderers).
- Gallery card.

**Exit criteria:**
- All standard GFM markdown renders correctly (test against CommonMark spec examples).
- Code blocks: Shiki highlighting works for top-20 languages. Lazy — only visible blocks highlighted. Copy-to-clipboard works.
- Thinking blocks render and collapse correctly.
- Tool use blocks show name, input/output, duration.
- Streaming cursor visible during partials, gone on complete.
- Laws compliance: [L02, L06, L10, L16, L19, L20].

**Demo:** Full conversation rendering: thinking → streamed response with code blocks → tool use → follow-up. All content types visible and interactive.

---

### Phase 4: Prompt Input {#prompt-input}

**Goal:** tug-prompt-input with history, slash commands, and message queueing. Addresses U12, U13, U19.

**Inputs:** TugTextarea auto-resize. `system_metadata` slash command data.

**Work:**
- Enhanced `<textarea>`, 1 row default, grows to maxRows (8). [L06].
- Keyboard: Enter submit, Shift+Enter newline, Cmd+Enter submit. IME-safe.
- `PromptHistoryStore`: IndexedDB, per-card, `useSyncExternalStore` [L02].
- Slash command popup (U12): merge `system_metadata.slash_commands` + `.skills`, `@floating-ui/react`.
- `@` file completion (U13): detect `@`, file picker, inject content.
- Message queueing during turn (U19): disable send during streaming, show queue indicator. Use `interrupt` to cancel.
- Gallery card.

**Exit criteria:**
- Submit, history navigation, prefix search, slash popup, `@` completion all work
- CJK input works
- Send disabled / queue indicator shown during active turn

**Demo:** Working prompt with slash popup, history, and queueing behavior.

---

### Phase 5: Conversation Wiring {#conversation-wiring}

**Goal:** Wire the core conversation loop end-to-end. Addresses U2, U3, U4, U8, U14, U23.

**Inputs:** tug-markdown (Phases 3A+3B), tug-prompt-input (Phase 4), hardened transport (Phase 2).

**Work:**
- Compose prompt input + submit/stop button.
- Wire to CodeOutput/CodeInput: submit sends `user_message`, stop sends `interrupt` (U4).
- Permission dialog (U2): `control_request_forward` with `is_question: false`. Allow/deny buttons. Permission suggestions.
- AskUserQuestion dialog (U3): `control_request_forward` with `is_question: true`. Single/multi-select options.
- Subagent activity display (U8): `tool_use: Agent` brackets subagent lifetime. Nested tool calls visible.
- Session handling (U14): detect pending session IDs (`"pending"`, `"pending-fork"`), wait for real ID.
- Task progress display (U23): `system:task_started/progress/completed` events for agent lifecycle indicators.
- Gallery card + live integration test.

**Exit criteria:**
- Full round-trip: type prompt → streamed markdown response
- Permission and question dialogs work
- Interrupt stops streaming
- Subagent activity visible
- Session new/fork handled cleanly

**Demo:** Real conversation with Claude through the UI.

---

### Phase 6: Chrome & Status {#chrome-and-status}

**Goal:** Status indicators, switchers, and cost display. Addresses U9, U10, U11, U16, U17, U20, U21, U22, C1, C2, C3, C10.

**Inputs:** Working conversation (Phase 5). `system_metadata` and `cost_update` events.

**Work:**
- Model switcher (U9): send `model_change`, synthetic `assistant_text` confirms, `system_metadata` updates.
- Permission mode switcher (U10): send `permission_mode`, cycle default → acceptEdits → plan → auto.
- Cost/token display (U11): `cost_update` with `total_cost_usd`, `num_turns`, `duration_ms`, `usage`.
- API retry indicator (U16): `api_retry` events — attempt count, delay, error type.
- Compaction indicator (U17): `compact_boundary` events — show when context is being compacted.
- Plan mode choices (U20): `EnterPlanMode` approve/reject/keep-planning options.
- Stop background task (U21): send `{ type: "stop_task", task_id }` button.
- Context window budget (U22): account for ~20% startup overhead in token counter.
- `/status` (C1): model, session, context usage from `system_metadata` + `cost_update.usage`.
- `/model` (C2): model picker → `model_change` message.
- `/permissions` (C3): mode display + switcher → `permission_mode` message.
- `/compact` (C10): invoke skill, show compaction indicator.

**Exit criteria:**
- Model and permission mode switch correctly, UI reflects changes
- Cost display updates each turn
- Retry and compaction indicators visible when events arrive
- /status, /model, /permissions, /compact all functional

**Demo:** Full conversation chrome — switch models, see cost, trigger compaction.

---

### Phase 7: Session & Commands {#session-and-commands}

**Goal:** Terminal command reimplementations, session management, and remaining features. Addresses C4-C9, C11-C15, U15, U18, E5.

**Inputs:** Full conversation UI (Phases 3-6).

**Work:**
- `/clear` (C4): clear conversation → `session_command: "new"`.
- `/resume` (C5): session picker — list, preview, rename, filter. Data from filesystem (E5 exploration).
- `/diff` (C6): run git diff, render result.
- `/export` (C7): serialize conversation from accumulated events.
- `/copy` (C8): copy last response from accumulated `assistant_text`.
- `/btw` (C9): side question overlay — separate API call, no history impact.
- `/rename` (C11): text input → update session metadata.
- `/branch`, `/rewind` (C12): session fork → `session_command: "fork"`.
- `/vim` (C13): keybinding mode toggle.
- `/color`, `/theme` (C14): theme picker.
- `/help` (C15): help display.
- Image attachments (U15): base64 in `user_message.attachments`. Drag-drop/paste → encode → attach.
- Session-scoped permission reset (U18): handle re-approval after resume.

**Exit criteria:**
- All terminal commands have UI equivalents
- Session picker works (list, resume, rename)
- Image attachments work via drag-drop/paste
- Permissions re-prompt correctly after session resume

**Demo:** Full session lifecycle — new, resume, fork, rename. All commands accessible.

---

### Phases 8-12: Feed Layer {#feed-layer}

| Phase | Goal | Scope |
|-------|------|-------|
| 8. Hook Capture | Agent lifecycle → `raw-events.jsonl` | Shell scripts + hooks.json |
| 9. Feed Correlation | Semantic enrichment → `feed.jsonl` | Correlation logic |
| 10. Feed CLI + Tugcast | `tugcode feed` + browser delivery | Rust CLI + tugcast feed |
| 11. Agent-Internal Events | File/command detail | Agent frontmatter hooks |
| 12. Custom Block Renderers | Rich agent output UI | React components |

---

## Deferred

- **tug-rich-text** — Monaco editor wrapper. Future.
- **tug-search-bar** — TugInput + TugButton. Future.
- **Tiptap migration** for tug-prompt-input (@-mentions, ghost text). Future.
- **Mermaid, KaTeX** — tug-markdown extensions via the extension point. When needed.
- **E3 (hooks visibility)** — Hooks run silently. No events for hook decisions, context injection, timing. Non-blocking for UI.
- **E6 (advanced patterns)** — Background tasks, MCP, elicitation untested. Non-blocking for UI.

---

## Risks

1. **Feed hook parsing fragility.** Orchestrator prompts are natural language with embedded JSON.
2. **Shell script overhead on high-frequency hooks.** ~50ms per invocation. Monitor in Phase 11.
3. **Hooks visibility gap (E3).** Hooks run silently — UI blind to hook decisions. May need tugtalk changes. Deferred.
4. ~~**WebSocket unknowns.**~~ Resolved in Phase 2b. Wire protocol documented, four issues found (T8-T11), fixes tracked in Phase 2c.

---

## Resolved Questions

1. **Shiki theme** — Hand-authored file referencing `--tug-syntax-*` CSS custom properties.
2. **History scope** — Per-card via `historyKey`. No global cross-card history for now.
3. **Slash command extensibility** — Declarative list from `system_metadata`. No registration system.
4. **Streaming text model** — Deltas on partials, full text on complete. UI accumulates.
5. **Slash command invocation** — Works via `user_message`. Fixed with T1 (`--plugin-dir`) + T2 (synthetic text).
6. **Custom block renderers** — Extension point in Phase 3, individual blocks in Phase 12.
7. **tug-rich-text / tug-search-bar** — Deferred.
8. **Process lifecycle** — Solved with process groups, parent-death watchdog, kill_on_drop (T4).
9. **Production Bun dependency** — Eliminated. Tugtalk compiles to standalone binary (T7).
10. **Auth bypass for testing** — `--no-auth` flag bypasses WS session/origin checks, auth URL still generated normally (T6).
