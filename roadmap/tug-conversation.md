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
Phase 3A: Markdown Rendering Core    — virtualization, prefix sum, two-path rendering
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
