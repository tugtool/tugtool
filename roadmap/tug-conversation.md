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
Phase 3A.1: TugWorkerService         — general-purpose worker infrastructure for tugdeck
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

### Phase 3A.1: TugWorkerService {#tug-worker-service}

**Status:** Not started.

**Goal:** Build a general-purpose worker infrastructure for tugdeck that any feature can use to move heavy computation off the main thread. The markdown pipeline is the first consumer, but Shiki syntax highlighting (Phase 3B), feed correlation (Phases 8-12), and other CPU-intensive operations will also use this service. Build it once, build it right.

**Inputs:** Phase 3A experience (what goes wrong without workers). Library research (below).

#### Library research findings

Surveyed the landscape of MIT-compatible worker libraries for browser use:

| Library | License | Stars | Bundle | Pool | Cancel | Priority | Maintained |
|---------|---------|-------|--------|------|--------|----------|------------|
| **Comlink** | Apache-2.0 | 12.6K | 1.1kB | No | No | No | Stable/low activity |
| **workerpool** | Apache-2.0 | 2.3K | 9kB | Yes | Yes | No | Active |
| **threads.js** | MIT | 3.5K | 3kB | Yes | Partial | No | Semi-maintained |
| **poolifier-web-worker** | MIT | 62 | Small | Yes | ? | Yes | Active |
| **greenlet** | MIT | 4.7K | 1kB | No | No | No | Unmaintained |

**Comlink** (Google Chrome Labs) is the best RPC ergonomics — it uses ES6 Proxy to make workers feel like local async objects. But it has no pool management, no cancellation (open issues #372, #428), and pending promises leak if the worker is terminated. It's a great idea executed 80% of the way.

**workerpool** has the most real-world usage (13.3M weekly npm downloads) with proper cancellation and timeout support. But it's Apache-2.0, and its browser worker setup requires careful configuration.

**poolifier-web-worker** is the only MIT-licensed option with priority queuing and task stealing. But it has 62 GitHub stars — low adoption means low battle-testing.

**Recommendation: Build our own, informed by the MIT-licensed libraries.** The tugdeck codebase already has strong TypeScript patterns for services (DeckManager, ResponderChain, PropertyStore). A custom `TugWorkerService` that owns lifecycle, dispatch, cancellation, and priority fits naturally into these patterns. The total implementation is ~300-500 lines — less than adopting and wrapping an external library. Zero new dependencies.

#### Patterns adopted from MIT-licensed libraries [L21]

Source study of three MIT-licensed libraries yielded specific patterns worth adopting. Copyright notices are preserved in `THIRD_PARTY_NOTICES.md` at the repo root per [L21]. Source files that implement these patterns must include a comment referencing the relevant notice entry.

**From threads.js** (Copyright (c) 2019 Andy Wermke, MIT):
- **Thenable task handle with cancellation.** `QueuedTask` is both `await`-able (has `.then()`) and controllable (has `.cancel()`). Adopted for our `TaskHandle` return type.
- **Discriminated union pool events.** Events use a `type` field enum for exhaustive TypeScript narrowing. Adopted for our message protocol (W18).
- **Init handshake with timeout.** Workers send an `init` message after loading; main thread waits with configurable timeout. Prevents silent worker initialization failures. Adopted for worker spawn.

**From poolifier-web-worker** (Copyright (c) 2023-2024 Jerome Benoit, MIT):
- **Priority queue with aging.** `effectivePriority = priority - elapsedTime * agingFactor` prevents starvation of low-priority tasks. Adopted for W14.
- **Least-used worker selection.** Pick the worker with fewest executing + queued tasks. Better than round-robin for heterogeneous workloads. Adopted for dispatcher.
- **Promise-response-map RPC with AbortSignal.** Each task gets a UUID; `Map<id, {resolve, reject, abortSignal}>` resolves on worker response. Adopted as the core dispatch mechanism.
- **Back-pressure signaling.** Queue depth per worker emits events when thresholds are crossed, enabling upstream flow control. Adopted as a future extension point.

**From greenlet** (Copyright (c) Jason Miller, MIT):
- **Minimal promise-per-call RPC.** Counter-based task IDs with `{resolve, reject}` stashed in a Map. The simplest correct RPC pattern — greenlet does it in 5 lines. Adopted as the foundation for the promise-response-map.
- **Automatic transferable detection.** Filter message args for `ArrayBuffer`, `MessagePort`, `ImageBitmap` and pass as the transferables list. Adopted to avoid requiring explicit `Transfer()` wrappers.

**Pitfalls identified and avoided:**
- threads.js `delay(0)` timing hack for subscription setup — resolve promises directly from message handlers instead.
- poolifier's 2,500-line abstract pool with deep inheritance and `new Function()` task injection — keep ours flat and ~300 lines.
- greenlet's missing cleanup (workers live forever, Blob URLs never revoked) — our idle timeout and `terminate()` prevent this.
- greenlet's lossy error serialization (`'' + er`) — serialize `{ message, stack, name }` to preserve diagnostics.
- threads.js Observable dependency for simple event dispatch — use plain promises + callbacks.

#### Architecture patterns from production apps

**Google Sheets** runs its entire calculation engine in a Web Worker. Main thread handles only rendering and user interaction. Clean separation: UI thread renders, worker thread computes.

**Monaco/VS Code** uses one dedicated worker per language service (TypeScript, JSON, CSS, HTML). Workers maintain mirror models synced from the main thread. Communication is request-response via `postMessage`. Fallback to main thread if workers are unavailable.

**Common pattern:** `navigator.hardwareConcurrency` is read to inform capacity, but most apps use a small fixed number of workers (1-4), not a pool sized to core count. The practical cap is `Math.min(hardwareConcurrency - 1, 4)` to avoid over-allocation.

**`postMessage` performance:** Structured clone costs <1ms for payloads under 100KB. For 1MB payloads, ~35ms. For large ArrayBuffers, Transferable objects reduce this to <1ms (zero-copy). For our use case (token arrays + HTML strings typically 10-100KB), structured clone is fine.

#### Design: TugWorkerService

```
┌──────────────────────────────────────────────────────────┐
│  TugWorkerService (main thread singleton)                │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Task Queue   │  │ Worker Pool  │  │ Task Registry  │  │
│  │ (priority)   │  │ (1..N)       │  │ (type→handler) │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                │                   │           │
│         ▼                ▼                   ▼           │
│  ┌──────────────────────────────────────────────────┐    │
│  │                  Dispatcher                      │    │
│  │  • Dequeues highest-priority task                │    │
│  │  • Finds idle worker (or queues)                 │    │
│  │  • Sends typed message via postMessage           │    │
│  │  • Tracks in-flight tasks for cancellation       │    │
│  │  • Resolves/rejects caller's Promise on response │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                           │
            postMessage / onmessage
                           │
┌──────────────────────────┴───────────────────────────────┐
│  TugWorker (worker thread, one per pool slot)            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Task Handler Registry (same types as main)      │    │
│  │                                                  │    │
│  │  'markdown:lex'   → lexHandler(payload)          │    │
│  │  'markdown:parse'  → parseHandler(payload)       │    │
│  │  'shiki:highlight' → highlightHandler(payload)   │    │
│  │  ... extensible ...                              │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Receives: { taskId, type, payload, priority }           │
│  Returns:  { taskId, result } or { taskId, error }       │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**

**W13: Task handler registry, not per-feature workers.**
Instead of one worker for markdown, another for Shiki, another for feeds, all task handlers register with the same worker pool. A worker can execute any registered task type. This maximizes worker utilization — a worker idle after finishing a markdown lex can immediately pick up a Shiki highlight task. New features add a handler file, not a new worker.

**W14: Priority queue with three levels.**
Tasks have priority: `high` (visible viewport blocks — user is waiting), `normal` (overscan/prefetch), `low` (background work). The dispatcher always dequeues the highest-priority task first. When the user scrolls, pending `normal` tasks for the old viewport can be cancelled and replaced with `high` tasks for the new viewport. This is how Monaco avoids wasting cycles on invisible content.

**W15: Cancellation via task ID.**
Every task gets a unique ID. The caller receives a handle with `{ promise, cancel() }`. Calling `cancel()` removes the task from the queue if it hasn't started, or sends a cancellation signal to the worker if it's in-flight. Workers check for cancellation between processing steps (e.g., between parsing individual blocks in a batch). This is the workerpool pattern without the workerpool dependency.

**W16: Pool size from `navigator.hardwareConcurrency`.**
Default pool size: `Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 4))`. This reserves the main thread, caps at 4 workers to avoid over-allocation, and handles missing values. The pool grows lazily — workers are spawned on first task, not at service creation. Workers are terminated after an idle timeout (30 seconds) to free resources.

**W17: Graceful degradation.**
If `Worker` constructor throws (CSP restrictions, old browser, or test environment), the service falls back to running task handlers synchronously on the main thread. The API is identical — callers don't know or care whether work ran in a worker or on the main thread. This is critical for `bun test` where web workers aren't available.

**W18: Typed message protocol.**
The wire protocol between main thread and worker is a discriminated union of typed messages. No `any`, no string-based dispatch. Task handler authors define their input/output types; the service enforces them. This catches errors at compile time, not runtime.

#### API sketch

```typescript
// --- Registration (at app startup or lazy) ---
import { workerService } from '@/lib/tug-worker-service';
import type { MarkdownLexTask, MarkdownParseTask } from '@/workers/markdown-tasks';

// Register task types (tells the service which handler module to load in workers)
workerService.register('markdown:lex', () => import('@/workers/markdown-tasks'));
workerService.register('markdown:parse', () => import('@/workers/markdown-tasks'));
workerService.register('shiki:highlight', () => import('@/workers/shiki-tasks'));

// --- Usage (from any component or hook) ---
const handle = workerService.submit<MarkdownLexTask>({
  type: 'markdown:lex',
  payload: { text: contentString },
  priority: 'high',
});

// Await result
const { tokens, heights } = await handle.promise;

// Or cancel if user scrolled away
handle.cancel();

// --- In the worker (markdown-tasks.ts) ---
export function handleTask(task: MarkdownLexTask | MarkdownParseTask) {
  switch (task.type) {
    case 'markdown:lex':
      return lexMarkdown(task.payload);
    case 'markdown:parse':
      return parseMarkdown(task.payload);
  }
}
```

#### Work

**Step 1: Core service (`tugdeck/src/lib/tug-worker-service.ts`).**
The `TugWorkerService` class: task queue (priority-sorted), worker pool (lazy spawn, idle timeout), dispatcher loop, cancellation tracking. Exported as a module-level singleton. ~200 lines.

**Step 2: Worker entry point (`tugdeck/src/workers/tug-worker.ts`).**
The worker-side runtime: receives messages, looks up handler by task type, executes, posts result. Handles cancellation checks. Dynamically imports handler modules on first use. ~100 lines.

**Step 3: Type definitions (`tugdeck/src/lib/tug-worker-types.ts`).**
Shared types for the message protocol: `TaskRequest`, `TaskResponse`, `TaskHandle`, `TaskPriority`, `TaskHandlerModule`. Used by both main thread and worker thread. ~50 lines.

**Step 4: Graceful degradation path.**
When `Worker` construction fails, the service creates a `MainThreadExecutor` that imports handler modules directly and runs them synchronously (or via `queueMicrotask` for async feel). Same `TaskHandle` API. ~50 lines.

**Step 5: Tests (`tugdeck/src/__tests__/tug-worker-service.test.ts`).**
Test the service in Bun's test environment (which uses the degradation path). Verify: task submission and resolution, priority ordering, cancellation of queued tasks, cancellation of in-flight tasks, idle worker cleanup, graceful degradation. ~150 lines.

**Step 6: Verify Vite worker bundling.**
Confirm that `bun run build` emits a separate worker chunk. Confirm the worker loads and runs in the browser. No special Vite config should be needed — Vite 7.3.1 handles `new Worker(new URL(...))` natively.

#### Checkpoints

- `bun test src/__tests__/tug-worker-service.test.ts` — all tests pass (degradation mode in Bun).
- `bunx tsc --noEmit` — no new type errors.
- `bun run build` — build succeeds, worker chunk emitted in `dist/`.
- Manual verification: open browser devtools → Sources → confirm worker script loaded.

#### Exit criteria

- `workerService.submit()` dispatches to a real web worker in the browser.
- `workerService.submit()` falls back to main-thread execution in tests and restricted environments.
- Priority ordering verified: `high` tasks execute before `normal` before `low`.
- Cancellation works for both queued and in-flight tasks.
- Workers are spawned lazily and terminated after 30s idle.
- Pool size adapts to `navigator.hardwareConcurrency`.
- Adding a new task type requires only a handler file + one `register()` call.
- Zero external dependencies.

#### Risks

- R06: **Vite requires static string literals in `new Worker(new URL(...))`** (confirmed). The URL path must be a literal string — no variables, no template literals, no computed paths. Vite performs static analysis at build time; if it can't see the literal, it silently skips bundling and the worker fails at runtime. **Mitigation confirmed:** `new Worker(new URL('./workers/tug-worker.ts', import.meta.url), { type: 'module' })` is the exact documented pattern. Vite handles `.ts` files natively via esbuild. The worker's static imports (e.g., `import { marked } from 'marked'`) are automatically bundled into the worker chunk. The build emits a separate `worker-[hash].js` file. **Risk: LOW.**
- R07: **Dynamic `import()` inside workers is broken with Vite's default `worker.format: 'iife'`** (confirmed via Vite issues #18585, #5402). The build fails because IIFE does not support code splitting. Setting `worker.format: 'es'` enables dynamic imports but has its own historical bugs (#3311, #6706). **Mitigation: use static imports only.** All task handlers import their dependencies statically. The worker entry point uses a static switch/registry — `switch (task.type) { case 'markdown:lex': ... }` with eagerly imported handler modules. Handler modules are small; bundling them all into the worker is acceptable. This avoids the entire dynamic import risk category. **Risk: ELIMINATED** (by design choice).
- R08: **Bun's test runner DOES have a native `Worker` global** (confirmed). Bun supports real Web Workers in all contexts including `bun test` — it spawns actual threads. However, this means tests using real Workers have file-path dependencies, real async behavior, and timing sensitivity. Neither happy-dom nor jsdom provide Worker stubs. **Revised mitigation:** Two-tier test strategy. (1) Unit tests mock the worker boundary — `TugWorkerService` accepts an injected worker factory; tests provide a synchronous mock executor that runs task handlers directly. This tests the service logic (queue, priority, cancellation) without real threads. (2) Integration tests (separate test file, tagged `@integration`) use real Bun Workers to verify the actual worker entry point loads and processes tasks end-to-end. The graceful degradation path (W17) is tested by the unit tests inherently, since the mock executor IS the degradation executor. **Risk: LOW** (real Worker support in Bun is a positive surprise).

---

### Phase 3A.2: Worker-Based Markdown Pipeline {#worker-markdown-pipeline}

**Status:** Not started.

**Goal:** Move all heavy markdown computation off the main thread. The Phase 3A implementation put lexing, parsing, and sanitization on the main thread, then compounded the problem by pre-rendering all ~5,000 blocks via `scheduleIdleBatch`. The result: ~15 seconds of main-thread blocking for a 1MB document. This phase fixes the architecture.

**Inputs:** Phase 3A code (BlockHeightIndex, RenderedBlockWindow, TugMarkdownView). Phase 3A.1 TugWorkerService. Monaco editor architecture study (below).

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

**W07: Use TugWorkerService, not a dedicated worker.**
Phase 3A.1's TugWorkerService provides the worker pool, priority queue, and cancellation. Markdown tasks register as `markdown:lex` and `markdown:parse` task types. The service handles pool sizing via `navigator.hardwareConcurrency` (W16), priority dispatch (W14), and cancellation (W15). No markdown-specific worker management code needed.

**W08: Viewport-priority parsing.**
The worker receives a `visibleRange` hint with each request. It parses blocks in this order: (1) blocks in the visible range, (2) blocks in the overscan range, (3) stop. It does NOT parse the entire document. When the user scrolls, a new `visibleRange` is sent, and the worker re-prioritizes. Blocks outside the viewport are parsed on-demand when they enter the overscan zone.

**W09: HTML cache, not pre-rendering.**
Parsed HTML strings are cached in a `Map<number, string>` on the main thread. When a block enters the viewport, the main thread checks the cache first. Cache hit → sanitize and render immediately. Cache miss → request from worker, show a placeholder div at estimated height. The placeholder is replaced when the worker responds. This eliminates `scheduleIdleBatch` entirely.

**W10: DOMPurify only at render time.**
DOMPurify requires the DOM and cannot run in a worker. Instead of sanitizing all blocks eagerly, sanitize only when a block enters the viewport and is about to be written to the DOM. This bounds sanitization cost to ~60-100 blocks at any time (viewport + overscan), regardless of document size.

**W11: Streaming path uses same worker.**
Streaming deltas are sent to the worker for incremental tail-lexing (same as Phase 3A's approach, but off-thread). The worker returns only the changed/new tokens and their HTML. The main thread applies the diff to the visible window. Off-screen streaming blocks are not parsed until scrolled to.

**W12: Graceful degradation.**
If the worker fails to initialize (e.g., CSP restrictions, old browser), fall back to main-thread lexing + parsing with the viewport-only discipline (D08). The fallback is still faster than Phase 3A because it never pre-renders all blocks.

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
- Main thread never blocks for more than 16ms (one frame) during any rendering operation.
- Worker processes visible blocks first; off-screen blocks are never pre-parsed.
- 1MB document: viewport visible in <200ms, full scroll range navigable immediately.
- 10MB document: viewport visible in <200ms, scroll to any position in <16ms.
- Streaming: 60fps, zero jank for 5000+ words of live deltas.
- Graceful degradation: works (slower) without worker.

#### Risks

- R03: `postMessage` serialization cost for Token objects. Marked Token objects contain nested properties (e.g., `tokens` array on paragraphs for inline markup). Structured clone handles this but may add 1-5ms per message for large token lists. Mitigation: transfer only what's needed — for the `parse` response, send `{ index: number, html: string }[]` (flat array of strings), not full Token objects.
- R04: Placeholder-to-real swap may cause layout shift if estimated height differs significantly from actual. Mitigation: the existing ResizeObserver measurement + prefix sum recomputation handles this — it's the same mechanism that already corrects estimated heights.
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
