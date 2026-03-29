# Group D: The Conversation Experience

*tug-markdown, tug-prompt-input, tug-prompt-entry — the core of tug's AI interaction.*

**Prerequisite:** [tug-feed-roadmap.md](tug-feed-roadmap.md) — data flow must be proven before UI is built.

---

## Scope

Group D builds the conversation experience: the user types a prompt, the AI responds with streamed markdown, agent progress is visible throughout. Three components:

| Component | Role |
|-----------|------|
| **tug-markdown** | Renders streamed LLM responses as styled, interactive content |
| **tug-prompt-input** | Prompt authoring with history, slash commands, keyboard handling |
| **tug-prompt-entry** | Composition: prompt input + submit/stop chrome + streaming indicators |

**Deferred from Group D:**
- **tug-rich-text** (Monaco editor) — moved to a future group. Not needed for the conversation experience.
- **tug-search-bar** (TugInput + TugButton) — moved to a future group. Trivial composition, no urgency.
- **MDX+ custom block renderers** (tug-diff, tug-plan-step, tug-tool-result) — design spec deferred until tug-feed data flow is proven. The renderer extension point will exist from Dash 1, but the specific block designs need real feed data to inform them. See "Custom Block Renderers" section below.

---

## The MVP Use Case

The primary v0 use case is a **graphical/card-based frontend onto Claude Code**. The prompt-input sends prompts to Claude Code; the markdown renderer displays streamed responses.

Tugcast already has the transport infrastructure for this. Two existing feed IDs handle the agent conversation:

- **`CodeOutput` (`0x40`)** — tugtalk → tugdeck. JSON-lines stream of agent events: `assistant_text` (with `is_partial` and streaming `status`), `tool_use`, `tool_result`, `tool_approval_request`, `question`, `turn_complete`, `turn_cancelled`, `error`.
- **`CodeInput` (`0x41`)** — tugdeck → tugtalk. JSON-lines commands: `user_message`, `tool_approval`, `question_answer`, `interrupt`, `permission_mode`.

The agent bridge (`tugcast/src/feeds/agent_bridge.rs`) manages the tugtalk subprocess lifecycle, IPC via stdin/stdout JSON-lines, protocol handshake, and crash recovery. The WebSocket framing (`[1-byte FeedId][4-byte length][payload]`) multiplexes these alongside terminal, git, filesystem, and stats feeds over a single connection.

The tug-feed system (see [tug-feed.md](tug-feed.md) and [tug-feed-roadmap.md](tug-feed-roadmap.md)) adds a semantic layer on top — structured progress events from agent execution, correlated with plan steps and workflow phases.

This means:
- **tug-markdown** renders `assistant_text` events from `CodeOutput` frames, handling `is_partial`/`status` fields for incremental streaming
- **tug-prompt-input** sends `user_message` commands via `CodeInput` frames and invokes slash commands (both Claude Code built-ins and tugplug skills)
- **tug-prompt-entry** composes these with submit/stop chrome. Streaming state is driven by `assistant_text(status: "partial")` → streaming, `turn_complete` → idle. The stop button sends an `interrupt` command.
- The conversation card orchestrates both, with tug-feed events driving progress UI (agent role, step, phase) alongside the markdown stream

---

## Existing Infrastructure

1. **`marked` (v15, MIT)** — GFM markdown parser, configured in `src/lib/markdown.ts`.
2. **`shiki` (v3, MIT)** — TextMate-grammar syntax highlighter, singleton in `src/_archive/cards/conversation/code-block-utils.ts`. 17 languages preloaded.
3. **`DOMPurify` (MIT)** — HTML sanitization with strict config in `src/lib/markdown.ts`.
4. **`MessageRenderer`** — archived React component. Uses `dangerouslySetInnerHTML`. Wrong architecture for streaming.
5. **`CodeBlock`** — archived React component with copy-to-clipboard and Shiki highlighting.
6. **Tugcast agent bridge** — `CodeOutput` (`0x40`) and `CodeInput` (`0x41`) FeedIds handle bidirectional agent communication.
7. **Syntax token CSS** — `tug-code.css` defines `--tug-syntax-*` and `--tugx-codeBlock-*` tokens.

---

## Component 1: tug-markdown

### Architecture

**Token-level rendering, not HTML string rendering.**

```
Layer 1: Parse         marked.lexer() → token array
Layer 2: Render        Custom React renderer → keyed elements per block
Layer 3: Stream        PropertyStore<string> [L02] → throttled re-lex → reconcile
```

`marked.lexer()` produces tokens without HTML. Each block-level token becomes a keyed React element. React's reconciler diffs old vs new — only the last block changes during streaming.

### Streaming Strategy

One code path for both streaming and static content.

```
CodeOutput frame (FeedId 0x40)
  → Parse JSON: { type: "assistant_text", text, is_partial, status }
  → Accumulate into PropertyStore<string> [L02]
  → useSyncExternalStore (throttled to rAF)
  → marked.lexer(accumulated) → token[]
  → React reconciles: only last block changed

On { type: "turn_complete" }:
  → Final render, streaming cursor removed
```

**Incomplete markdown healing:** Detect unclosed delimiters during streaming and temporarily close them for parsing.

### Token-Driven Theming

`--tugx-md-*` aliases for typography, code blocks, blockquotes, tables, horizontal rules. Shiki uses a hand-authored theme file referencing `--tug-syntax-*` CSS custom properties.

### Code Blocks — TugCodeBlock

Extracted from archived `CodeBlock`. Language label, copy-to-clipboard, Shiki highlighting with tug theme, optional line numbers, lazy language loading, collapse/expand for long blocks.

### Custom Block Renderers — Extension Point

The renderer maps `tug-*` language prefixes on fenced code blocks to custom React components. This extension point exists from Dash 1, but the specific block type designs are deferred until tug-feed data flow is proven. See "Custom Block Renderers" section below.

---

## Component 2: tug-prompt-input

### Architecture

Phase 1: Enhanced `<textarea>` building on TugTextarea's auto-resize.
Phase 2 (future): Tiptap migration for @-mentions, ghost text, inline chips.

### Features (Phase 1)

- **History navigation** — up/down arrows, prefix search, draft preservation, IndexedDB per-card storage via `PromptHistoryStore` [L02]
- **Slash commands** — `/` trigger, filtered popup via `@floating-ui/react`, declarative command list from parent
- **Keyboard** — Enter submit, Shift+Enter newline, Cmd+Enter submit, IME-safe
- **Multi-line expansion** — 1 row default, auto-grow to maxRows (8), imperative DOM [L06]
- **Submit** — `onSubmit` clears input and pushes to history; `onStop` sends interrupt

### Slash Command Set

**Tugplug skills:** `/plan`, `/implement`, `/merge`, `/dash`, `/commit`

**Claude Code essentials:** `/clear`, `/compact`, `/cost`, `/model`, `/status`, `/fast`, `/help`, `/resume`, `/diff`, `/review`, `/memory`, `/doctor`

Full 60+ Claude Code command list available by scrolling; curated set gets priority.

---

## Component 3: tug-prompt-entry

Composition: tug-prompt-input + submit/stop button + utility row.

**Tugcast integration:**
- Submit → `{ type: "user_message" }` via CodeInput
- Stop → `{ type: "interrupt" }` via CodeInput
- Streaming state → `assistant_text(status)` from CodeOutput
- Tool approval → inline UI from `tool_approval_request`
- Questions → inline UI from `question`
- Progress → agent role from tug-feed events

---

## Custom Block Renderers

This is where tug differentiates from the terminal. Each custom block type transforms raw agent output into rich, interactive UI. The designs below are **preliminary** — they need real tug-feed data flowing through the system to finalize. The tug-feed roadmap is the prerequisite.

### Planned Block Types

| Block Type | Renders | Data Source |
|-----------|---------|-------------|
| `tug-diff` | Side-by-side or unified diff with syntax highlighting | `tool_result` for Edit/Write tools |
| `tug-tool-result` | Collapsible tool output with icon, status, duration | `tool_use` + `tool_result` events |
| `tug-plan-step` | Step card with status badge, agent role, progress | tug-feed `step_started`/`step_completed` events |
| `tug-thinking` | Collapsible reasoning/thinking block | `assistant_text` thinking blocks |
| `tug-file-change` | File path with operation badge (created/edited/deleted) | tug-feed `file_modified` events |
| `tug-build-result` | Build/test summary with pass/fail counts | tug-feed `build_result`/`test_result` events |
| `tug-review-verdict` | Reviewer finding with APPROVE/REVISE badge | tug-feed `review_verdict` events |
| `tug-approval` | Tool approval request with allow/deny buttons | `tool_approval_request` events |

Each block type will get its own design pass during implementation. The extension point (fenced code block with `tug-*` language → custom React component) is simple and stable — the complexity is in the individual block designs, which depend on the actual data shapes from tug-feed and CodeOutput events.

---

## Dependency Inventory

| Package | License | Size (gzip) | Status | Used By |
|---------|---------|-------------|--------|---------|
| `marked` | MIT | ~12KB | Already installed | tug-markdown |
| `shiki` | MIT | ~2MB w/ grammars | Already installed | tug-markdown (code blocks) |
| `dompurify` | MIT + Apache-2 | ~8KB | Already installed | tug-markdown (HTML sanitization) |
| `@floating-ui/react` | MIT | ~12KB | Already transitive dep (Radix) | tug-prompt-input (slash popup) |

No new dependencies. Everything is already installed or transitively available.

---

## Build Order

**Prerequisite: Complete [tug-feed-roadmap.md](tug-feed-roadmap.md) phases 1-2 first.** The feed work proves the data flow and gives us real event shapes to design against.

### Dash 1: tug-markdown — Core Renderer + Streaming

Token-level rendering pipeline: `marked.lexer()` → keyed React elements. All standard markdown (headings, paragraphs, bold/italic, links, lists, blockquotes, tables, HR, inline code). Streaming via PropertyStore [L02] with rAF throttle. Incomplete markdown healing.

Token aliases in CSS. Gallery card with static content and simulated streaming.

The `tug-*` custom block extension point is registered here (maps language prefix to component), but individual block renderers come later.

### Dash 2: tug-markdown — Code Blocks (TugCodeBlock)

Extract and modernize the archived CodeBlock. Shiki with hand-authored tug theme. Copy button, language label, line numbers. Register as renderer for `code` tokens.

### Dash 3: tug-prompt-input — Core + History

Enhanced textarea with auto-resize, submit/cancel keyboard handling, IME safety. PromptHistory IndexedDB store with up/down navigation, prefix search, draft preservation. Gallery card.

Combining core and history into one dash — they're tightly coupled (submit pushes to history, arrow keys navigate it).

### Dash 4: tug-prompt-input — Slash Commands

Slash command popup with filtering, keyboard navigation, `@floating-ui/react` positioning. Gallery section with tugplug + Claude Code command set.

### Dash 5: tug-prompt-entry

Compose tug-prompt-input + submit/stop button + utility row. Wire to CodeOutput/CodeInput feed events. Streaming state, tool approval, question handling. Gallery card.

### Dash 6+: Custom Block Renderers

Individual dashes per block type, designed against real tug-feed data. Order TBD based on which block types prove most valuable during feed integration.

---

## Resolved Questions

1. **Shiki theme** — Hand-authored theme file referencing `--tug-syntax-*` CSS custom properties.
2. **History scope** — Per-card via `historyKey`. No global cross-card history for now.
3. **Slash command extensibility** — Declarative list from parent. No registration system.
4. **Streaming vs static** — One streaming code path. Static completes immediately without throttle.
5. **tug-rich-text / tug-search-bar** — Deferred from Group D. Not needed for conversation experience.
6. **Custom block renderers** — Extension point built early, but individual block designs deferred until tug-feed data flow is proven.
