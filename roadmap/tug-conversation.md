# The Conversation Experience — Roadmap

*From hook capture to rendered markdown. One vertical slice, phased for incremental delivery.*

**Architecture reference:** [tug-feed.md](tug-feed.md) — event schemas, correlation strategy, feed design.

---

## Vision

Build a graphical Claude Code conversation experience: the user types a prompt, the AI responds with streamed markdown, and agent progress is visible throughout. This is the core of what makes tug different from a terminal.

The work spans the full stack — hooks capturing agent events, shell scripts correlating them, a Rust CLI for inspection, tugcast delivering events to the browser, and React components rendering the conversation. It's one body of work, phased so that each layer proves the next.

---

## What Already Exists

| Layer | Status | Notes |
|-------|--------|-------|
| **Claude Code hooks API** | Stable | 24 event types including `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`. Async hooks don't block. |
| **Tugplug hooks** | Minimal | Auto-approval and init only. No feed capture. |
| **Tugcast agent bridge** | Working | `CodeOutput` (`0x40`) and `CodeInput` (`0x41`) carry conversation events via JSON-lines over WebSocket. |
| **Tugstate** | Working | `tugcode state show --json` returns step status, artifacts, checklists. |
| **Markdown pipeline** | Archived | `marked` + `shiki` + `DOMPurify` in `src/lib/markdown.ts` and `src/_archive/`. Wrong architecture for streaming (HTML string → `dangerouslySetInnerHTML`). |
| **Syntax tokens** | Working | `tug-code.css` defines `--tug-syntax-*` and `--tugx-codeBlock-*` token families. |
| **Feed infrastructure** | Doesn't exist | No `.tugtool/feed/`, no capture scripts, no tugcast feed, no CLI. |
| **Conversation components** | Don't exist | No tug-markdown, tug-prompt-input, or tug-prompt-entry. |

---

## Phases

Each phase is scoped to be **one tugplan** — plannable and implementable with `/plan` and `/implement`. Phases have explicit inputs, outputs, and exit criteria. Later phases depend on earlier ones; earlier phases are independently valuable.

```
Phase 1: Hook Capture           — prove events fire, collect real data samples
Phase 2: Correlation            — build the semantic layer, enrich with step context
Phase 3: Conversation Transport — understand CodeOutput/CodeInput, document event shapes
Phase 4: Feed CLI               — tugcode feed tail/show/status (Rust)
Phase 5: Tugcast Integration    — feed events reach the browser
Phase 6: Core Markdown          — tug-markdown with streaming
Phase 7: Prompt Input           — tug-prompt-input with history and slash commands
Phase 8: Prompt Entry           — tug-prompt-entry composition, wired to tugcast
Phase 9: Agent-Internal Events  — fine-grained file/command events from within agents
Phase 10: Custom Block Renderers — designed against real data from phases 1-5
```

---

### Phase 1: Hook Capture {#hook-capture}

**Goal:** Add async hooks that capture agent lifecycle events and write raw JSON to `.tugtool/feed/raw-events.jsonl`. No correlation — just prove the data arrives.

**Inputs:** Working `/implement` workflow on a small plan.

**Work:**
- Create `.tugtool/feed/` directory convention in `tugcode init`
- Write `feed-capture.sh` — receives hook JSON on stdin, appends timestamped entry to `raw-events.jsonl`
- Add four async hooks to `tugplug/hooks/hooks.json`: `PreToolUse(Task)`, `PostToolUse(Task)`, `SubagentStart(tugplug:*)`, `SubagentStop(tugplug:*)`
- Run `/implement` on a small plan and manually verify with `tail -f` + `jq`

**Exit criteria:**
- All four hook types fire reliably during an `/implement` run
- `SubagentStart` and `SubagentStop` have matching `agent_id` values
- `PreToolUse(Task)` contains the orchestrator's prompt with step context embedded
- Events for parallel agents (conformance + critic in `/plan`) don't collide
- Real data samples captured for every agent type's `last_assistant_message`

**Outputs:** `raw-events.jsonl` with real hook data. Documented data samples.

---

### Phase 2: Correlation {#correlation}

**Goal:** Correlate raw events into meaningful feed events with plan-step context. Write enriched events to `.tugtool/feed/feed.jsonl`.

**Inputs:** Working Phase 1 hooks. Real data samples from Phase 1.

**Work:**
- Write correlation logic (upgrade `feed-capture.sh` or new `feed-correlate.sh`): parse `tool_input.prompt` for `step_anchor`/`plan_path`, stash in `.pending-agents.json`, associate on `SubagentStart`, enrich and emit on `SubagentStop`
- Define the feed event schema (version, timestamp, session_id, event_type, plan_path, step_anchor, agent_role, agent_id, data)
- Parse `last_assistant_message` per agent type — document actual shapes for architect, coder, reviewer, committer, auditor
- Handle concurrent agents (conformance + critic use different agent_types, so key is unambiguous)
- Optionally enrich with `tugcode state show --json` for step titles and progress counts

**Exit criteria:**
- `feed.jsonl` contains enriched events with correct `step_anchor` and `agent_role` for every agent dispatch
- Concurrent agent correlation (conformance + critic) verified with a real `/plan` run
- Agent output shapes documented for all tugplug agent types
- Correlation state (`.pending-agents.json`) recovers gracefully from lost entries

**Outputs:** `feed.jsonl` with semantic events. Agent output shape documentation.

---

### Phase 3: Conversation Transport {#conversation-transport}

**Goal:** Understand and document the existing CodeOutput/CodeInput protocol as it actually behaves in practice. This is investigation, not implementation.

**Inputs:** Working tugcast with agent bridge.

**Work:**
- Trace a full conversation turn: `user_message` → `assistant_text` (partial/complete) → `tool_use` → `tool_result` → `tool_approval_request` → `turn_complete`
- Document `assistant_text` streaming behavior: frequency of partials, full-text vs delta, `is_partial` transition, interrupt → `turn_cancelled`
- Document tool event shapes for each tool type (`tool_use.input`, `tool_result.output`)
- Identify gaps: anything missing from CodeOutput that tug-markdown needs?

**Exit criteria:**
- Complete protocol documentation with real examples
- Streaming behavior characterized (frequency, text accumulation model, edge cases)
- Gap analysis completed — known issues listed
- Confidence level established for building tug-markdown on this transport

**Outputs:** Protocol documentation. Gap analysis. Decision on whether any tugcast/tugtalk changes are needed before Phase 6.

---

### Phase 4: Feed CLI {#feed-cli}

**Goal:** Rust CLI commands for inspecting and tailing the feed, replacing ad-hoc `jq` one-liners.

**Inputs:** Working `feed.jsonl` from Phase 2.

**Work:**
- `tugcode feed tail` — live-tailing with human-readable formatting (step progress, agent activity, file counts)
- `tugcode feed show` — dump events as JSON for piping/scripting
- `tugcode feed status` — summary of current progress (steps completed/in-progress/pending, active agents)

**Exit criteria:**
- `tugcode feed tail` renders a readable live progress view during `/implement`
- `tugcode feed show --json` outputs valid JSON for each event
- `tugcode feed status` gives an accurate one-line summary

**Outputs:** Three `tugcode feed` subcommands in the tugcode binary.

---

### Phase 5: Tugcast Integration {#tugcast-integration}

**Goal:** Feed events reach tugdeck through tugcast's WebSocket infrastructure.

**Inputs:** Working `feed.jsonl` from Phase 2. Working tugcast server.

**Work:**
- Register `TugFeed = 0x50` FeedId in Rust (`tugcast-core/src/protocol.rs`) and TypeScript (`tugdeck/src/protocol.ts`)
- Implement `TugFeedFeed` as a `StreamFeed` in tugcast — tails `feed.jsonl` via `notify` file watcher, publishes frames
- Frontend subscription: `connection.onFrame(FeedId.TUG_FEED, cb)` with console logging to verify
- End-to-end test: run `/implement`, watch events arrive in browser console

**Exit criteria:**
- Feed events arrive in tugdeck within 1 second of hook firing
- Bootstrap delivers recent events to newly connected clients
- Feed survives tugcast reconnection (client catches up)

**Outputs:** Working feed pipeline: hook → shell → feed.jsonl → tugcast → WebSocket → tugdeck.

---

### Phase 6: Core Markdown {#core-markdown}

**Goal:** tug-markdown component with streaming support. The primary display surface for AI-generated content.

**Inputs:** Phase 3 documentation (CodeOutput event shapes). Existing `marked`/`shiki`/`DOMPurify` libraries.

**Work:**
- Token-level rendering pipeline: `marked.lexer()` → keyed React elements per block. Standard markdown: headings, paragraphs, bold/italic, links, lists, blockquotes, tables, HR, inline code.
- Streaming via `PropertyStore<string>` [L02] with rAF throttle. Incomplete markdown healing for unclosed delimiters.
- TugCodeBlock: extracted from archived CodeBlock. Shiki with hand-authored tug theme, copy-to-clipboard, language label, optional line numbers, collapse/expand.
- `--tugx-md-*` token aliases in CSS. `@tug-pairings` declarations per [L16, L19].
- `tug-*` custom block extension point (language prefix → React component mapping).
- Gallery card with static content, simulated streaming, and code blocks.

**Exit criteria:**
- All standard GFM markdown renders correctly (prose, code, tables, lists, blockquotes)
- Simulated streaming at 60fps with no jank for 5000+ word responses
- Code blocks syntax-highlighted with tug theme tokens
- Copy-to-clipboard works
- Extension point registered (even if no custom blocks yet)
- Gallery card demonstrates all features
- Laws compliance: [L02, L06, L10, L16, L19, L20]

**Outputs:** `tug-markdown.tsx` + `tug-markdown.css` + `tug-code-block.tsx` + `gallery-markdown.tsx`.

---

### Phase 7: Prompt Input {#prompt-input}

**Goal:** tug-prompt-input component with history and slash commands.

**Inputs:** Existing TugTextarea auto-resize mechanism.

**Work:**
- Enhanced `<textarea>` building on TugTextarea's auto-resize. 1 row default, grows to maxRows (8). Imperative DOM [L06].
- Keyboard: Enter submit, Shift+Enter newline, Cmd+Enter submit. IME-safe (`isComposing` check).
- `PromptHistoryStore`: IndexedDB per-card storage, `subscribe`/`getSnapshot` for `useSyncExternalStore` [L02]. Up/down arrow navigation, prefix search, draft preservation.
- Slash command popup: `/` trigger at start of line, filtered list via `@floating-ui/react`, keyboard navigation. Declarative command list from parent.
- `--tugx-prompt-*` token aliases. Gallery card.

**Exit criteria:**
- Enter submits, Shift+Enter newlines, up/down navigates history
- History persists across page reloads (IndexedDB)
- Prefix search works (type partial text, up arrow filters)
- Slash popup appears, filters, keyboard-navigable, selectable
- CJK input works (IME composition not interrupted)
- Gallery card demonstrates all features

**Outputs:** `tug-prompt-input.tsx` + `tug-prompt-input.css` + `prompt-history.ts` + `gallery-prompt-input.tsx`.

---

### Phase 8: Prompt Entry {#prompt-entry}

**Goal:** tug-prompt-entry composition wired to tugcast CodeOutput/CodeInput.

**Inputs:** tug-prompt-input (Phase 7). Tugcast CodeOutput/CodeInput (Phase 3 documentation).

**Work:**
- Compose tug-prompt-input + submit/stop button + utility row (attach, voice placeholders).
- Wire to CodeOutput/CodeInput: submit sends `user_message`, stop sends `interrupt`, streaming state from `assistant_text(status)`, `turn_complete`, `turn_cancelled`.
- Tool approval inline UI from `tool_approval_request`, response via `tool_approval`.
- Question inline UI from `question`, response via `question_answer`.
- Progress indicator showing agent role from tug-feed events (Phase 5).
- Gallery card.

**Exit criteria:**
- Submit sends `user_message` and clears input
- Stop sends `interrupt` during streaming
- Streaming state correctly tracks partial → complete → idle
- Tool approval and question flows work end-to-end
- Agent role indicator updates from tug-feed events
- Gallery card demonstrates all features

**Outputs:** `tug-prompt-entry.tsx` + `tug-prompt-entry.css` + `gallery-prompt-entry.tsx`.

---

### Phase 9: Agent-Internal Events {#agent-internal-events}

**Goal:** Fine-grained events from within agent execution — file modifications, bash commands, build/test results.

**Inputs:** Working Phase 2 correlation. Real `/implement` runs.

**Work:**
- Add agent-scoped `PostToolUse` hooks to coder-agent frontmatter: `Edit|Write` → `feed-file-change.sh`, `Bash` → `feed-command-result.sh`
- Capture scripts tag events with step context from `.pending-agents.json`
- New event types in `feed.jsonl`: `file_modified`, `command_ran`, `build_result`, `test_result`

**Exit criteria:**
- File modification events appear in feed with correct step context
- Bash command results captured with exit codes
- No measurable impact on agent execution speed (async hooks)
- `tugcode feed tail` shows file-level detail under active steps

**Outputs:** Agent-scoped hooks. Two new capture scripts. Richer `feed.jsonl` events.

---

### Phase 10: Custom Block Renderers {#custom-blocks}

**Goal:** Rich, interactive UI for agent output that differentiates tug from the terminal.

**Inputs:** Real data from Phases 1-5 and 9. Working tug-markdown extension point from Phase 6.

**Work:** Individual dashes per block type, designed against actual data shapes. Planned block types:

| Block Type | Renders | Data Source |
|-----------|---------|-------------|
| `tug-diff` | Side-by-side or unified diff with syntax highlighting | `tool_result` for Edit/Write tools |
| `tug-tool-result` | Collapsible tool output with icon, status, duration | `tool_use` + `tool_result` events |
| `tug-plan-step` | Step card with status badge, agent role, progress | tug-feed `step_started`/`step_completed` |
| `tug-thinking` | Collapsible reasoning/thinking block | `assistant_text` thinking blocks |
| `tug-file-change` | File path with operation badge (created/edited/deleted) | tug-feed `file_modified` events |
| `tug-build-result` | Build/test summary with pass/fail counts | tug-feed `build_result`/`test_result` |
| `tug-review-verdict` | Reviewer finding with APPROVE/REVISE badge | tug-feed `review_verdict` events |
| `tug-approval` | Tool approval request with allow/deny buttons | `tool_approval_request` events |

**Exit criteria per block type:** Renders real data correctly. Handles edge cases (empty data, long content, error states). Gallery section demonstrates the block.

**Sequencing:** Order TBD based on which blocks prove most valuable. `tug-tool-result` and `tug-diff` are likely first (highest frequency in real conversations). `tug-plan-step` and `tug-build-result` follow (tug-feed dependent).

---

## Driving Plans with `/plan` and `/implement`

Each phase above is designed to be one `/plan` → `/implement` cycle. The mapping:

| Phase | Tugplan Scope | Estimated Steps |
|-------|---------------|-----------------|
| 1. Hook Capture | Shell scripts + hooks.json + tugcode init change | 3-4 |
| 2. Correlation | Shell scripts + event schema + concurrency handling | 4-5 |
| 3. Conversation Transport | Investigation + documentation (no code) | 2-3 |
| 4. Feed CLI | Rust: `tugcode feed` subcommands | 3-4 |
| 5. Tugcast Integration | Rust + TypeScript: new FeedId + StreamFeed + frontend sub | 3-4 |
| 6. Core Markdown | React + CSS: tug-markdown + TugCodeBlock + gallery | 4-5 |
| 7. Prompt Input | React + CSS + IndexedDB: tug-prompt-input + history + slash | 4-5 |
| 8. Prompt Entry | React + CSS: composition + tugcast wiring + gallery | 3-4 |
| 9. Agent-Internal Events | Shell scripts + agent frontmatter hooks | 2-3 |
| 10. Custom Block Renderers | React: individual block types (multiple plans likely) | 2-3 per block |

**Phase 3 is an exception** — it's investigation/documentation, not implementation. It could be a `/dash` rather than a full `/plan` + `/implement` cycle, or done interactively.

**Phases 1-2** should probably be planned together as one tugplan since they're tightly coupled (the capture informs the correlation), but implemented sequentially within that plan.

**Phase 10** will likely be multiple small tugplans — one per block type or one covering 2-3 related blocks.

**The roadmap is the sequencing guide.** Each phase's "Inputs" section tells you what must be done first. Each phase's "Exit criteria" tell you when to move on. If a phase exposes problems that invalidate later phases, we stop, update this roadmap, and re-plan.

---

## Deferred

- **tug-rich-text** — Monaco editor wrapper. Moved to a future group. Not needed for the conversation experience.
- **tug-search-bar** — TugInput + TugButton composition. Moved to a future group.
- **Tiptap migration** for tug-prompt-input (Phase 2: @-mentions, ghost text, inline chips). Future work.
- **Mermaid diagrams, KaTeX math** — tug-markdown extensions. Add when needed via the extension point.

---

## Risks

1. **`PreToolUse(Task)` prompt parsing is fragile.** The orchestrator's prompt is natural language with embedded JSON. Mitigation: structured JSON payloads with well-known keys. Discovered in Phase 1, addressed in Phase 2.

2. **Agent-scoped hooks may not resolve project-root paths correctly in worktrees.** `$CLAUDE_PROJECT_DIR` may point to the worktree. Verify in Phase 9.

3. **Feed file contention with parallel agents.** Mitigation: JSONL with atomic `O_APPEND` writes.

4. **Shell script overhead on high-frequency hooks.** ~50ms per invocation. Monitor in Phase 9; consider Rust CLI fallback if needed.

5. **`last_assistant_message` may not be reliably structured.** Phase 1 discovers actual shapes; Phase 2 adapts.

6. **CodeOutput event shapes may differ from documentation.** Phase 3 exists specifically to discover this.

---

## Resolved Questions

1. **Shiki theme** — Hand-authored theme file referencing `--tug-syntax-*` CSS custom properties.
2. **History scope** — Per-card via `historyKey`. No global cross-card history for now.
3. **Slash command extensibility** — Declarative list from parent. No registration system.
4. **Streaming vs static** — One streaming code path. Static completes immediately without throttle.
5. **Custom block renderers** — Extension point built early (Phase 6), individual block designs deferred until real data flows (Phase 10).
