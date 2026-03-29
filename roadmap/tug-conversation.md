# The Conversation Experience — Roadmap

*Plumb the pipe first. See what comes out. Then build the UI.*

**Architecture reference:** [tug-feed.md](tug-feed.md) — event schemas, correlation strategy, feed design.

---

## Vision

Build a graphical Claude Code conversation experience: the user types a prompt, the AI responds with streamed markdown, and agent progress is visible throughout.

The transport already exists — tugcast's agent bridge spawns tugtalk, relays JSON-lines over WebSocket via `CodeOutput` (`0x40`) and `CodeInput` (`0x41`). But we've never sent "are you there?" through this pipe and watched what comes back. Before building any UI, we need to prove the transport works, understand its behavior, and harden it.

---

## What Already Exists

| Layer | Status | Key Question |
|-------|--------|-------------|
| **Tugcast agent bridge** | Code exists | Does it actually work end-to-end? Can we send a message and get a streamed response? |
| **CodeOutput (`0x40`)** | Defined | What do `assistant_text` events actually look like? Full text or delta? How frequent? |
| **CodeInput (`0x41`)** | Defined | Does sending `{ type: "user_message", text: "/plan ..." }` invoke the skill? |
| **`question` events** | Defined | When `AskUserQuestion` fires, what arrives on CodeOutput? How do we answer? |
| **`tool_approval_request`** | Defined | Same — what's the round-trip look like in practice? |
| **`interrupt`** | Defined | Does sending interrupt reliably stop streaming? |
| **Markdown pipeline** | Archived | `marked` + `shiki` + `DOMPurify` exist. Wrong architecture for streaming, but the libraries are there. |
| **Syntax tokens** | Working | `tug-code.css` defines `--tug-syntax-*` and `--tugx-codeBlock-*` tokens. |
| **Feed infrastructure** | Doesn't exist | Hooks, correlation, CLI — all unbuilt. Comes after the basic conversation works. |
| **Conversation components** | Don't exist | tug-markdown, tug-prompt-input, tug-prompt-entry — all unbuilt. |

---

## Phases

The work falls into three tiers: **prove the pipe**, **build the UI**, **add the feed layer**. Each phase is scoped to be one `/plan` → `/implement` cycle (or `/dash` for investigation phases).

```
─── TIER 1: PROVE THE PIPE ───────────────────────────────────
Phase 1: Transport Exploration    — send messages, observe responses, document everything
Phase 2: Transport Hardening      — fix gaps, handle edge cases, make it solid

─── TIER 2: BUILD THE UI ─────────────────────────────────────
Phase 3: Core Markdown            — tug-markdown with streaming
Phase 4: Prompt Input             — tug-prompt-input with history and slash commands
Phase 5: Prompt Entry             — tug-prompt-entry, wired end-to-end

─── TIER 3: ADD THE FEED LAYER ───────────────────────────────
Phase 6: Hook Capture             — agent lifecycle events to feed.jsonl
Phase 7: Feed Correlation         — semantic enrichment with step context
Phase 8: Feed CLI + Tugcast       — tugcode feed commands, events reach browser
Phase 9: Agent-Internal Events    — file/command detail from within agents
Phase 10: Custom Block Renderers  — rich UI for agent output
```

---

### Phase 1: Transport Exploration {#transport-exploration}

**Goal:** Send messages through the tugcast pipe and see what comes back. Document every event type, every field, every edge case. This is investigation, not implementation.

**Approach:** Interactive — `/dash` or hands-on session. We're instrumenting, observing, and documenting.

**Questions to answer:**

**Basic round-trip:**
- Send `{ type: "user_message", text: "Say hello." }` via CodeInput. What events appear on CodeOutput?
- What does `assistant_text` look like? Is `text` the full accumulated response or a delta since last event? What are the `is_partial`, `status`, `seq`, `rev`, `msg_id` fields in practice?
- How often do partial events arrive? Every token? Every few tokens? Batched?
- What does `turn_complete` contain?

**Slash commands:**
- Send `{ type: "user_message", text: "/status" }`. Does Claude Code interpret it as a slash command?
- Send `{ type: "user_message", text: "/plan build a login page" }`. Does the `/plan` skill activate? Do `SubagentStart` events appear on CodeOutput, or only through hooks?
- Is there any difference between how a regular message and a slash command are sent?

**AskUserQuestion flow:**
- Trigger a workflow that uses `AskUserQuestion` (e.g., `/plan` on an ambiguous idea).
- What event appears on CodeOutput? Presumably `question` with `request_id` and `questions[]`.
- What's the exact shape of `questions[]`? How do `options`, `multiSelect`, and `header` fields appear?
- Send `{ type: "question_answer", request_id: "...", answers: {...} }` back. Does the workflow continue?

**Tool approval flow:**
- Trigger a tool call that needs approval.
- What does `tool_approval_request` look like on CodeOutput?
- Send `{ type: "tool_approval", request_id: "...", decision: "allow" }`. Does the tool execute?
- Send `decision: "deny"`. Does the agent handle rejection gracefully?

**Streaming edge cases:**
- Send a prompt that produces a very long response (thousands of words). Does streaming stay smooth? Any backpressure?
- Send `{ type: "interrupt" }` mid-stream. What events follow? `turn_cancelled`? Does it have `partial_result`?
- What happens if we send a new `user_message` before `turn_complete`?
- What happens on tugtalk crash? Does the agent bridge restart? What events does the client see?

**Tool events:**
- When Claude Code uses Read, Edit, Bash, etc. — do `tool_use` and `tool_result` events appear on CodeOutput?
- What's in `tool_use.input` and `tool_result.output` for each tool type? (These shapes inform custom block renderers later.)

**Session lifecycle:**
- Does `session_init` fire on first connect? What's in it?
- Does `project_info` arrive? What's in it?
- What does the protocol handshake (`protocol_init` → `protocol_ack`) look like from the client's perspective?

**Status: IN PROGRESS.** 28 tests completed (see [transport-exploration.md](transport-exploration.md)). Core protocol well-understood. Six areas of further exploration identified:

1. **Slash command / skill invocation** — the biggest gap. ALL slash commands (built-in and plugin) are consumed client-side with no stream-json output. Neither short names (`/dash`) nor fully-qualified names (`/tugplug:dash`) work.
2. **Plugin system** — tugtool plugin is loaded but its skills and agents are invisible in `system_metadata`. Need enumeration and invocation paths.
3. **Hooks visibility** — hooks run silently. No events indicate hook decisions, injected context, timing, or errors.
4. **Tugcast WebSocket layer** — all testing has been direct-to-tugtalk. Need auth bypass to test the actual production WebSocket path.
5. **Session management** — session picker, concurrent sessions, session-scoped permission behavior.
6. **Advanced patterns** — background tasks, MCP servers, elicitation events.

**Exit criteria:**
- All questions above answered with real examples ✅ (for core protocol)
- Event protocol documented with actual JSON samples ✅ (12 outbound, 9 inbound)
- Known gaps and problems listed ✅ (12 Phase 2 work items + 6 exploration areas)
- Clear picture of what tugcast/tugtalk changes are needed ✅ (Phase 2 scope defined)
- Further exploration areas listed and scoped ⬜ (in progress)

**Outputs:** [transport-exploration.md](transport-exploration.md) — protocol documentation, event catalogs, terminal-only features checklist, Phase 2 work items, exploration areas.

---

### Phase 2: Transport Hardening {#transport-hardening}

**Goal:** Fix the gaps and problems discovered in Phase 1. Make the CodeOutput/CodeInput transport reliable and complete enough to build UI on.

**Inputs:** Phase 1 documentation and gap list.

**Work:** Known items from Phase 1 exploration (see [transport-exploration.md](transport-exploration.md) for full details):

1. **Process lifecycle management.** Tugtalk processes outlive tugcast — 137 zombies observed after ~2 weeks. Tugcast must SIGTERM children on shutdown and/or use process groups. Card close must kill the associated tugtalk.
2. **Session command readiness.** After `session_command: "new"`, `session_init` fires with `session_id: "pending"` before the new process is usable. The UI needs a clear "ready" signal (non-pending session_id) before sending messages.
3. **API retry handling.** `system` events with `subtype: "api_retry"` carry attempt count, delay, error type. The UI needs a retry indicator.
4. **Compaction UI.** `compact_boundary` events should show compaction status. Indicate when context is being compacted.
5. **Permission mode switcher.** The UI needs a mode selector sending `permission_mode` messages. Cycle: default → acceptEdits → plan → auto.
6. **Session-scoped permissions reset on resume.** Previously approved tools prompt again after session resume. The UI must handle re-approval.
7. **Slash command UI for interactive commands.** `/model`, `/status`, `/cost` produce no text in stream-json mode. The UI must build its own pickers/displays and send `model_change`, `permission_mode`, `session_command` directly.
8. **`control_request_forward` is the unified gate event.** Both permissions (`is_question: false` → `tool_approval`) and AskUserQuestion (`is_question: true` → `question_answer`) come through this one event type. The UI dispatches on `is_question`.

Additional items discovered in later Phase 1 tests:

9. **`api_retry` events are silently dropped by tugtalk.** Confirmed by code inspection: `routeTopLevelEvent` only forwards `system` subtypes `"init"` and `"compact_boundary"`. All others (including `api_retry`) are lost. Fix: add forwarding. Also audit for other dropped subtypes.
10. **`--no-auth` CLI flag for tugcast.** Required to test full WebSocket path during development. Currently auth requires a single-use token exchange that the app consumes on launch.
11. **Slash command invocation mechanism.** ALL slash commands are consumed by Claude Code's harness before the model sees them. For simple commands (`/cost`), a `result` event contains formatted output, but only as `<local-command-stdout>` on session replay — not on first execution. For orchestrator skills (`/dash`, `/plan`), zero events appear. Neither short names (`/dash`) nor fully-qualified names (`/tugplug:dash`) work. The `Skill` tool rejects orchestrator skills as "not prompt-based." This is the single biggest transport gap — the graphical UI cannot invoke the most important tugplug commands. Needs design work in Phase 2 to determine the right invocation mechanism (new inbound message type, tugtalk interception, or separate process).
12. **`@` file reference is terminal-only.** The `@` character in `user_message` text is literal — no file injection. The UI must implement its own `@` completion with file content injection (either into message text or as attachments).

See [transport-exploration.md](transport-exploration.md) for complete findings including the terminal-only features checklist (~30 items the graphical UI must implement).

**Note:** Phase 2 is larger than initially expected. The slash command invocation gap alone is a significant design and implementation effort. Phase 2 may need to be split into sub-phases or prioritized — some items (process lifecycle, `api_retry` forwarding, `--no-auth`) are quick fixes, while others (slash command mechanism, plugin enumeration, hooks visibility) are design work that may require changes to how tugtalk interfaces with Claude Code.

**Exit criteria:**
- All Phase 1 gap items resolved or explicitly deferred with rationale
- Basic round-trip (send message → receive streamed response) works reliably
- Slash commands invoke skills correctly through the transport
- AskUserQuestion round-trip works (via `control_request_forward`)
- Tool approval round-trip works (via `control_request_forward`)
- Interrupt reliably stops streaming
- End-to-end tugcast WebSocket path verified
- Transport is solid enough to build UI on with confidence

**Outputs:** Hardened tugcast/tugtalk. Updated protocol documentation. Resolved exploration areas.

---

### Phase 3: Core Markdown {#core-markdown}

**Goal:** tug-markdown component with streaming support. The primary display surface for AI-generated content.

**Inputs:** Phase 2 (solid transport). Actual `assistant_text` event shapes from Phase 1 documentation.

**Work:**
- Token-level rendering pipeline: `marked.lexer()` → keyed React elements per block. Standard markdown: headings, paragraphs, bold/italic, links, lists, blockquotes, tables, HR, inline code.
- Streaming via `PropertyStore<string>` [L02] with rAF throttle. Incomplete markdown healing for unclosed delimiters. Streaming cursor.
- TugCodeBlock: extracted from archived CodeBlock. Shiki with hand-authored tug theme (`--tug-syntax-*` CSS custom properties), copy-to-clipboard, language label, optional line numbers, collapse/expand.
- `--tugx-md-*` token aliases in CSS. `@tug-pairings` declarations per [L16, L19].
- `tug-*` custom block extension point (language prefix → React component mapping) — registered but no custom blocks yet.
- Gallery card with static content, simulated streaming, and code blocks.

**Exit criteria:**
- All standard GFM markdown renders correctly
- Simulated streaming at 60fps with no jank for 5000+ word responses
- Code blocks syntax-highlighted with tug theme tokens, copy-to-clipboard works
- Extension point registered
- Gallery card demonstrates all features
- Laws compliance: [L02, L06, L10, L16, L19, L20]

**Outputs:** `tug-markdown.tsx` + `tug-markdown.css` + `tug-code-block.tsx` + `gallery-markdown.tsx`.

---

### Phase 4: Prompt Input {#prompt-input}

**Goal:** tug-prompt-input component with history and slash commands.

**Inputs:** Existing TugTextarea auto-resize mechanism.

**Work:**
- Enhanced `<textarea>` building on TugTextarea's auto-resize. 1 row default, grows to maxRows (8). Imperative DOM [L06].
- Keyboard: Enter submit, Shift+Enter newline, Cmd+Enter submit. IME-safe (`isComposing` check).
- `PromptHistoryStore`: IndexedDB per-card storage, `subscribe`/`getSnapshot` for `useSyncExternalStore` [L02]. Up/down arrow navigation, prefix search, draft preservation.
- Slash command popup: `/` trigger at start of line, filtered list via `@floating-ui/react`, keyboard navigation. Declarative command list from parent.
- Slash command set: tugplug skills (`/plan`, `/implement`, `/merge`, `/dash`, `/commit`) + Claude Code essentials (`/clear`, `/compact`, `/cost`, `/model`, `/status`, `/fast`, `/help`, `/resume`, `/diff`, `/review`, `/memory`, `/doctor`). Full 60+ list available by scrolling.
- `--tugx-prompt-*` token aliases. Gallery card.

**Exit criteria:**
- Enter submits, Shift+Enter newlines, up/down navigates history
- History persists across page reloads (IndexedDB)
- Prefix search, slash popup filtering and keyboard navigation all work
- CJK input works (IME composition not interrupted)
- Gallery card demonstrates all features

**Outputs:** `tug-prompt-input.tsx` + `tug-prompt-input.css` + `prompt-history.ts` + `gallery-prompt-input.tsx`.

---

### Phase 5: Prompt Entry {#prompt-entry}

**Goal:** tug-prompt-entry composition wired end-to-end through tugcast. The first time a user types a prompt in tugdeck and gets a rendered response back.

**Inputs:** tug-markdown (Phase 3), tug-prompt-input (Phase 4), hardened transport (Phase 2).

**Work:**
- Compose tug-prompt-input + submit/stop button + utility row.
- Wire to CodeOutput/CodeInput: submit sends `user_message`, stop sends `interrupt`.
- Streaming state from `assistant_text(status)` → `turn_complete` / `turn_cancelled`.
- Tool approval inline UI from `tool_approval_request` → `tool_approval` response.
- Question inline UI from `question` → `question_answer` response.
- Gallery card + live integration test.

**Exit criteria:**
- Type a prompt, get a streamed markdown response — the full round-trip works
- Slash commands invoke skills correctly
- Tool approval and question flows work end-to-end
- Interrupt stops streaming
- Gallery card demonstrates all features

**Outputs:** `tug-prompt-entry.tsx` + `tug-prompt-entry.css` + `gallery-prompt-entry.tsx`.

---

### Phase 6: Hook Capture {#hook-capture}

**Goal:** Add async hooks that capture agent lifecycle events and write raw JSON to `.tugtool/feed/raw-events.jsonl`.

**Inputs:** Working conversation experience (Phases 1-5). Working `/plan` and `/implement` workflows.

**Work:**
- `tugcode init` change: create `.tugtool/feed/` directory.
- `feed-capture.sh`: receives hook JSON on stdin, appends to `raw-events.jsonl`. Resolves project root via `git rev-parse --show-toplevel`.
- Four async hooks in `hooks.json`: `PreToolUse(Task)`, `PostToolUse(Task)`, `SubagentStart(tugplug:*)`, `SubagentStop(tugplug:*)`.

**Exit criteria:**
- All four hook types fire reliably during `/plan` and `/implement`
- `SubagentStart`/`SubagentStop` have matching `agent_id` values
- Async hooks add no observable delay

**Outputs:** `raw-events.jsonl` with real hook data.

---

### Phase 7: Feed Correlation {#feed-correlation}

**Goal:** Correlate raw events into meaningful feed events with plan-step context.

**Inputs:** Phase 6 raw events. Real data samples.

**Work:**
- Correlation logic: parse orchestrator prompts for `step_anchor`/`plan_path`, stash pending agents, enrich on `SubagentStop`.
- Feed event schema in `.tugtool/feed/feed.jsonl`.
- Parse `last_assistant_message` per agent type. Document actual shapes.
- Handle concurrent agents. Optionally enrich with `tugcode state show --json`.

**Exit criteria:**
- `feed.jsonl` has correct `step_anchor` and `agent_role` for every agent dispatch
- Concurrent correlation verified

**Outputs:** `feed.jsonl` with semantic events. Agent output shape documentation.

---

### Phase 8: Feed CLI + Tugcast {#feed-cli-tugcast}

**Goal:** Feed inspection tools and browser delivery.

**Inputs:** Phase 7 feed.jsonl.

**Work:**
- `tugcode feed tail/show/status` Rust CLI commands.
- Register `TugFeed = 0x50` FeedId in Rust and TypeScript.
- `TugFeedFeed` StreamFeed in tugcast — tails `feed.jsonl`, publishes frames.
- Frontend subscription: `connection.onFrame(FeedId.TUG_FEED, cb)`.

**Exit criteria:**
- `tugcode feed tail` renders live progress during `/implement`
- Feed events arrive in tugdeck within 1 second of hook firing
- Feed survives reconnection

**Outputs:** CLI commands. Working feed pipeline through to browser.

---

### Phase 9: Agent-Internal Events {#agent-internal-events}

**Goal:** Fine-grained events from within agent execution.

**Inputs:** Phase 7 correlation. Real `/implement` runs.

**Work:**
- Agent-scoped `PostToolUse` hooks on coder-agent for `Edit|Write` and `Bash`.
- `feed-file-change.sh` and `feed-command-result.sh` capture scripts.
- New event types: `file_modified`, `command_ran`, `build_result`, `test_result`.

**Exit criteria:**
- File/command events in feed with correct step context
- No impact on agent speed

**Outputs:** Agent-scoped hooks. Richer feed events.

---

### Phase 10: Custom Block Renderers {#custom-blocks}

**Goal:** Rich UI for agent output that differentiates tug from the terminal.

**Inputs:** Real data from all previous phases. tug-markdown extension point from Phase 3.

**Work:** Individual dashes per block type:

| Block Type | Renders | Data Source |
|-----------|---------|-------------|
| `tug-diff` | Diff with syntax highlighting | `tool_result` for Edit/Write |
| `tug-tool-result` | Collapsible tool output | `tool_use` + `tool_result` |
| `tug-plan-step` | Step card with status/progress | tug-feed events |
| `tug-thinking` | Collapsible reasoning block | `assistant_text` thinking blocks |
| `tug-file-change` | File path with operation badge | tug-feed `file_modified` |
| `tug-build-result` | Build/test summary | tug-feed `build_result`/`test_result` |
| `tug-review-verdict` | APPROVE/REVISE badge | tug-feed `review_verdict` |
| `tug-approval` | Allow/deny buttons | `tool_approval_request` |

**Sequencing:** Order TBD. `tug-tool-result` and `tug-diff` likely first.

---

## Driving Plans with `/plan` and `/implement`

| Phase | Approach | Estimated Steps |
|-------|----------|-----------------|
| 1. Transport Exploration | `/dash` (investigation) | — |
| 2. Transport Hardening | `/plan` + `/implement` (scope TBD from Phase 1) | 3-5 |
| 3. Core Markdown | `/plan` + `/implement` | 4-5 |
| 4. Prompt Input | `/plan` + `/implement` | 4-5 |
| 5. Prompt Entry | `/plan` + `/implement` | 3-4 |
| 6. Hook Capture | `/plan` + `/implement` | 3-4 |
| 7. Feed Correlation | `/plan` + `/implement` | 4-5 |
| 8. Feed CLI + Tugcast | `/plan` + `/implement` | 4-5 |
| 9. Agent-Internal Events | `/plan` + `/implement` | 2-3 |
| 10. Custom Block Renderers | Multiple small `/plan` cycles | 2-3 per block |

**Phase 1 is exploration** — `/dash` or interactive, not a formal plan. Its output defines Phase 2's scope.

**Phase 2 scope is unknown until Phase 1 completes.** It could be small (everything works, minor fixes) or large (protocol gaps, tugtalk changes needed). The roadmap adapts.

---

## Deferred

- **tug-rich-text** — Monaco editor wrapper. Future group.
- **tug-search-bar** — TugInput + TugButton. Future group.
- **Tiptap migration** for tug-prompt-input (@-mentions, ghost text). Future.
- **Mermaid, KaTeX** — tug-markdown extensions via the extension point. When needed.

---

## Risks

1. **Transport may not work as documented.** Phase 1 exists to discover this early. If CodeOutput/CodeInput has fundamental problems, we find out before building any UI.

2. **Slash commands may not route through `user_message`.** Tugtalk may need explicit skill invocation support, not just text passthrough. Phase 1 will reveal this.

3. **`AskUserQuestion` may not have a CodeOutput representation.** If the `question` event doesn't exist or is incomplete, the conversational UI for skills like `/plan` won't work without tugcast/tugtalk changes.

4. **Streaming text model unknown.** Full-text vs delta has major implications for tug-markdown's architecture. Phase 1 answers this before Phase 3 commits to a design.

5. **Feed hook parsing fragility.** Orchestrator prompts are natural language with embedded JSON. Mitigated by well-known keys.

6. **Shell script overhead on high-frequency hooks.** ~50ms per invocation. Monitor in Phase 9.

---

## Resolved Questions

1. **Shiki theme** — Hand-authored theme file referencing `--tug-syntax-*` CSS custom properties.
2. **History scope** — Per-card via `historyKey`. No global cross-card history for now.
3. **Slash command extensibility** — Declarative list from parent. No registration system.
4. **Streaming vs static** — One streaming code path. Static completes without throttle.
5. **Custom block renderers** — Extension point built in Phase 3, individual blocks designed in Phase 10 against real data.
6. **tug-rich-text / tug-search-bar** — Deferred from Group D.
