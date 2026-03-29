# Group D: Rich Content & Compositions — Proposal

*Markdown rendering, code editing, prompt input, and their compositions.*

---

## The MVP Use Case

The primary v0 use case is a **graphical/card-based frontend onto Claude Code**. The prompt-input sends prompts to Claude Code; the markdown renderer displays streamed responses.

Tugcast already has the transport infrastructure for this. Two existing feed IDs handle the agent conversation:

- **`CodeOutput` (`0x40`)** — tugtalk → tugdeck. JSON-lines stream of agent events: `assistant_text` (with `is_partial` and streaming `status`), `tool_use`, `tool_result`, `tool_approval_request`, `question`, `turn_complete`, `turn_cancelled`, `error`. This is the primary data source for tug-markdown during streaming.
- **`CodeInput` (`0x41`)** — tugdeck → tugtalk. JSON-lines commands: `user_message`, `tool_approval`, `question_answer`, `interrupt`, `permission_mode`. This is where tug-prompt-input sends its prompts.

The agent bridge (`tugcast/src/feeds/agent_bridge.rs`) manages the tugtalk subprocess lifecycle, IPC via stdin/stdout JSON-lines, protocol handshake, and crash recovery. The WebSocket framing (`[1-byte FeedId][4-byte length][payload]`) multiplexes these alongside terminal, git, filesystem, and stats feeds over a single connection.

The tug-feed system (see [tug-feed.md](tug-feed.md)) adds a semantic layer on top — structured progress events from agent execution, correlated with plan steps and workflow phases, arriving through hooks that capture `SubagentStart`, `SubagentStop`, `PreToolUse`, and `PostToolUse` lifecycle events.

This means:
- **tug-markdown** renders `assistant_text` events from `CodeOutput` frames, handling `is_partial`/`status` fields for incremental streaming
- **tug-prompt-input** sends `user_message` commands via `CodeInput` frames and invokes slash commands (both Claude Code built-ins and tugplug skills)
- **tug-prompt-entry** composes these with submit/stop chrome. Streaming state is driven by `assistant_text(status: "partial")` → streaming, `turn_complete` → idle. The stop button sends an `interrupt` command.
- The conversation card orchestrates both, with tug-feed events driving progress UI (agent role, step, phase) alongside the markdown stream

---

## The Text Component Family

Tugdeck has six text components, forming a spectrum from pure display to rich authoring:

| Component | Exists | Role | Surface |
|-----------|--------|------|---------|
| **tug-label** | ✅ | Display-only text | Radix `<label>`, line clamp |
| **tug-input** | ✅ | Single-line entry | Native `<input>` |
| **tug-textarea** | ✅ | Multi-line entry | Native `<textarea>`, auto-resize |
| **tug-markdown** | New | Rendered markdown/MDX display | `marked` + `shiki` + custom renderer |
| **tug-rich-text** | New | Code/text editing | Monaco editor |
| **tug-prompt-input** | New | AI prompt authoring | Enhanced `<textarea>` → Tiptap |

What's shared:
- **Token aliases** — every component gets `--tugx-<name>-*` tokens [L10]
- **Size variants** — `sm | md | lg` where relevant
- **ForwardRef** — imperative handles for every component [L19]
- **Disabled cascade** — all respect `useTugBoxDisabled()` from tug-box

What's different:
- **Display vs input** — tug-label and tug-markdown are read-only; the others accept user input
- **Content complexity** — tug-label renders plain text; tug-markdown renders structured documents with code blocks, tables, math, diagrams
- **Edit complexity** — tug-input is trivial; tug-prompt-input has history, completions, and expansions; tug-rich-text is a full code editor
- **Streaming** — tug-markdown must handle incremental LLM token streams [L02]; others don't

---

## Existing Infrastructure

We're not starting from zero. The codebase already has:

1. **`marked` (v15, MIT)** — GFM markdown parser, already in `package.json` and configured in `src/lib/markdown.ts` with `gfm: true, breaks: true`.
2. **`shiki` (v3, MIT)** — TextMate-grammar syntax highlighter with singleton highlighter in `src/_archive/cards/conversation/code-block-utils.ts`. 17 languages preloaded, lazy-load for others. Theme: `github-dark`.
3. **`DOMPurify` (MIT)** — HTML sanitization with strict ALLOWED_TAGS/FORBID_TAGS config in `src/lib/markdown.ts`.
4. **`MessageRenderer`** — archived React component that calls `renderMarkdown()` then `enhanceCodeBlocks()` post-render. Uses `dangerouslySetInnerHTML`.
5. **`CodeBlock`** — archived React component with copy-to-clipboard and Shiki highlighting.
6. **Tugcast agent bridge** — `CodeOutput` (`0x40`) and `CodeInput` (`0x41`) FeedIds already handle bidirectional agent communication. The agent bridge spawns tugtalk, relays JSON-lines over stdin/stdout, and handles crash recovery (3 crashes in 60s budget). Protocol handshake (`protocol_init` → `protocol_ack`) ensures version compatibility. `TugConnection.onFrame()` for subscription on the frontend.
7. **Syntax token CSS** — `tug-code.css` defines `--tug-syntax-*` and `--tugx-codeBlock-*` tokens for keyword, string, number, function, type, variable, comment, operator, punctuation colors plus code block surface/header tokens.

This pipeline works but has specific problems that tug-markdown needs to solve:
- **Re-parses entire content on every render** — O(n) per token during streaming
- **Post-render enhancement** — code blocks are parsed as HTML then enhanced via DOM mutation (not React)
- **No incremental diffing** — every token arrival re-renders the entire message
- **Hardcoded theme** — `github-dark` only, not token-driven
- **Archived, not tugways** — lives in `_archive/`, uses old component patterns, not law-compliant

---

## Component 1: tug-markdown

### What It Does

The primary display surface for all AI-generated content. Renders markdown from LLM streams, agent output, plan documents, and tool results into styled, interactive HTML.

### Architecture

Three-layer rendering pipeline:

```
Layer 1: Parse         marked (GFM) → AST tokens
Layer 2: Transform     remark/rehype-compatible transforms on token stream
Layer 3: Render        Custom React renderer → DOM
```

**Key architectural decision: Token-level rendering, not HTML string rendering.**

The current `MessageRenderer` does: markdown string → HTML string → `dangerouslySetInnerHTML` → post-render DOM mutation for code blocks. This is the wrong architecture for streaming. Every token re-renders everything.

tug-markdown will do: markdown string → token array → React elements → virtual DOM diff → minimal DOM patches. This lets React's reconciler handle incremental updates naturally.

**Implementation plan:**

1. **`marked.lexer()`** — produces a token array (headings, paragraphs, code blocks, lists, etc.) without converting to HTML. This is the key insight: `marked` can produce tokens without producing HTML.

2. **Custom React renderer** — walks the token array and produces React elements. Each block-level token (paragraph, heading, code fence, list, blockquote, table) becomes a keyed React element. React's reconciler diffs old vs new token arrays and only updates changed elements.

3. **Streaming buffer** — incoming LLM tokens accumulate in a `PropertyStore<string>` (external state [L02]). A throttled subscriber (50ms / `requestAnimationFrame`) re-lexes the accumulated text and updates the React tree. Only the last block (the one being actively appended) changes between renders — all previous blocks are stable and skip reconciliation.

4. **Code block integration** — when the renderer encounters a `code` token, it renders a `TugCodeBlock` React component (extracted from the archived `CodeBlock` with tugways compliance). Shiki highlighting is async but managed inside the component — no post-render DOM mutation.

5. **Sanitization** — DOMPurify remains for any raw HTML blocks in the markdown. But since we render tokens → React elements (not HTML strings), most content never touches `innerHTML`. Only explicit HTML blocks in the markdown go through DOMPurify.

### Streaming Strategy

The critical performance requirement. Streaming is the key use case — we must be great at it. One streaming code path handles both live LLM output and static content (static content simply completes immediately without throttling).

LLM responses can be thousands of tokens arriving over 30+ seconds. The renderer must be smooth at 60fps throughout.

```
Tugcast WebSocket frame (CodeOutput feed, FeedId 0x40)
  → TugConnection.onFrame(FeedId.CODE_OUTPUT, cb)
  → Parse JSON-lines: { type: "assistant_text", text, is_partial, status }
  → Accumulate text into PropertyStore<string> [L02]
  → useSyncExternalStore triggers render (throttled to rAF)
  → marked.lexer(accumulated) produces token[]
  → React reconciles: only last block changed
  → DOM patch: append text / update last paragraph

  On { type: "turn_complete" }:
  → Final render with complete text
  → Streaming cursor removed
```

**Throttling:** The PropertyStore subscription fires synchronously on every token. We throttle the React update to at most once per animation frame. This batches 5-15 tokens per render at typical LLM speeds.

**Incomplete markdown handling:** During streaming, the text is often syntactically incomplete (unclosed `**`, partial code fence, half a table row). `marked.lexer()` handles most of these gracefully — a partial code fence becomes a `code` token with `incomplete: true`. For the few cases where it doesn't, we apply a "healing" pass before lexing: detect unclosed delimiters and temporarily close them for parsing purposes only.

### Token-Driven Theming

tug-markdown defines `--tugx-md-*` token aliases:

```css
/* Typography */
--tugx-md-body-fg: var(--tug7-element-field-text-normal-default-rest);
--tugx-md-heading-fg: var(--tug7-element-field-text-normal-default-rest);
--tugx-md-link-fg: var(--tug7-element-global-text-accent-default-rest);
--tugx-md-code-inline-bg: var(--tug7-surface-field-secondary-normal-screen-rest);
--tugx-md-code-inline-fg: var(--tug7-element-field-text-normal-default-rest);

/* Code blocks */
--tugx-md-codeblock-bg: var(--tug7-surface-field-secondary-normal-screen-rest);
--tugx-md-codeblock-header-bg: var(--tug7-surface-field-tertiary-normal-screen-rest);
--tugx-md-codeblock-border: var(--tug7-element-field-border-normal-muted-rest);

/* Blockquotes, tables, horizontal rules */
--tugx-md-blockquote-border: var(--tug7-element-field-border-normal-muted-rest);
--tugx-md-blockquote-fg: var(--tug7-element-field-text-normal-muted-rest);
--tugx-md-table-border: var(--tug7-element-field-border-normal-muted-rest);
--tugx-md-hr-color: var(--tug7-element-field-border-normal-muted-rest);
```

### Code Blocks — TugCodeBlock

Extracted from the archived `CodeBlock` component, made tugways-compliant:

- **Language label** in header bar
- **Copy-to-clipboard** button with transient check animation
- **Shiki highlighting** with hand-authored theme file referencing `--tug-syntax-*` CSS custom properties (from existing `tug-code.css` tokens: keyword, string, number, function, type, variable, comment, operator, punctuation)
- **Line numbers** (optional)
- **Word wrap toggle** (optional)
- **Lazy language loading** — only load grammars on demand (17 preloaded per existing config: typescript, javascript, python, rust, shellscript, json, css, html, markdown, go, java, c, cpp, sql, yaml, toml, dockerfile)
- **Collapse/expand** for long blocks (configurable line threshold)

### MDX+ Extensions

Beyond standard markdown, tug-markdown supports custom block types for AI/agent output. These are parsed as fenced code blocks with special language identifiers, then rendered as custom React components:

```markdown
​```tug-diff
- old line
+ new line
​```

​```tug-plan-step
Phase 2, Step 3: Add retry logic
Status: complete
​```

​```tug-tool-result
Tool: read_file
Path: src/main.rs
Exit: 0
​```
```

These are **not** MDX (no JSX in the markdown). They're fenced code blocks with custom renderers — purely a rendering concern, not a parsing concern. `marked.lexer()` already produces them as `code` tokens with `lang: "tug-diff"` etc. The renderer maps `tug-*` language prefixes to custom React components.

This is safer than MDX (no arbitrary JSX execution from LLM output) and simpler (no MDX compilation step).

### What We're NOT Doing

- **Full MDX runtime** — too heavy for streaming, security risk with LLM content. Custom block types via fenced code blocks give us 90% of the benefit without the cost.
- **Mermaid diagrams** — 500KB+ bundle. Defer to a future extension if needed. Can be added as a custom code block renderer later.
- **KaTeX/math** — add as an extension when needed. ~120KB bundle; don't load until first math block encountered.
- **Sandboxed code execution** — artifact/preview territory. Out of scope for the markdown renderer; belongs in a separate tug-sandbox component if needed.

---

## Component 2: tug-rich-text

### What It Does

Monaco editor wrapped as a tugways component. For editing code, configuration files, plan documents, and any content that benefits from syntax highlighting, intellisense, and multi-cursor support.

### Architecture

Monaco is ~5MB of JavaScript. It's a serious dependency. But for an AI coding IDE, it's the right tool — it provides VS Code's exact editing experience.

**Key decisions:**

1. **Lazy-load only** — Monaco is never in the initial bundle. It loads on first render of a `tug-rich-text` instance via dynamic `import()`. A TugProgress spinner shows during loading — no FOUC.

2. **Web Worker** — Monaco's language services run in a Web Worker. Vite's `?worker` imports handle this.

3. **Token-driven theming** — Hand-authored theme file referencing `--tugx-*` CSS custom properties (same approach as TugCodeBlock's Shiki theme). Read computed styles on mount and when theme changes (brio ↔ harmony), update the Monaco theme.

4. **Controlled component** — `value` / `onValueChange` props. The editor's internal model is synchronized via Monaco's `onDidChangeModelContent`.

5. **Read-only mode** — for displaying code that shouldn't be edited (diff views, tool output).

### Props

```typescript
interface TugRichTextProps {
  /** Editor content */
  value?: string;
  /** Default content for uncontrolled usage */
  defaultValue?: string;
  /** Content change callback */
  onValueChange?: (value: string) => void;
  /** Language for syntax highlighting */
  language?: string;
  /** Visual size variant */
  size?: "sm" | "md" | "lg";
  /** Read-only mode */
  readOnly?: boolean;
  /** Show line numbers */
  lineNumbers?: boolean;
  /** Show minimap */
  minimap?: boolean;
  /** Word wrap mode */
  wordWrap?: "off" | "on" | "wordWrapColumn" | "bounded";
  /** Height behavior: fixed px, "auto" (fit content), or "fill" (flex parent) */
  height?: number | "auto" | "fill";
  /** Maximum height in px when height="auto" */
  maxHeight?: number;
}
```

### What We're NOT Doing

- **Diff editor** — Monaco has a built-in diff editor. Defer to a future `tug-diff-view` component.
- **Extension loading** — Monaco extensions are complex. Start with built-in languages only.
- **Collaborative editing** — OT/CRDT is out of scope.

---

## Component 3: tug-prompt-input

### What It Does

The primary input surface for composing prompts to AI agents. This is one of the two most important components in tugdeck (paired with tug-markdown on the output side). It must feel as natural as a terminal, as polished as an IDE, and as responsive as a chat app.

### The Claude Code Frontend Context

The v0 use case is a graphical wrapper around Claude Code. This shapes the prompt input directly:

**Slash commands come from two sources:**
1. **Claude Code built-ins:** `/help`, `/clear`, `/compact`, `/cost`, `/model`, `/status`, `/fast`, `/config`, `/doctor`, `/permissions`, `/review`, `/vim`
2. **Tugplug skills:** `/plan`, `/implement`, `/merge`, `/dash`, `/commit`

The parent component (conversation card) provides these as a declarative list. tug-prompt-input doesn't know where they come from.

**Prompt submission** sends a `{ type: "user_message", text }` JSON-line via the `CodeInput` (`0x41`) feed. The response stream arrives as `assistant_text` events on the `CodeOutput` (`0x40`) feed, feeding tug-markdown. Stop sends an `{ type: "interrupt" }` command through the same `CodeInput` feed.

### Architecture — Phased

**Phase 1: Enhanced Textarea.** Build on TugTextarea's auto-resize. Add history, slash commands, keyboard handling. This gives us a working prompt input immediately with minimal new dependencies.

**Phase 2: Tiptap Migration.** When we need inline mention chips, ghost text completions, and rich formatting, migrate the input surface from `<textarea>` to Tiptap (ProseMirror-based, MIT, ~50KB). Tiptap gives us:
- `@tiptap/extension-mention` for `@file` and `@agent` chips
- `@tiptap/extension-placeholder` for placeholder text
- Inline decorations for ghost text
- Custom nodes for embedded file previews

The phased approach means we ship something useful immediately (Phase 1 is likely sufficient for the first several months of use) while having a clear upgrade path when richer input features are needed.

### Phase 1 Feature Set

#### History Navigation

Terminal-model history, the most natural UX for power users:

- **Up arrow** (cursor at line 0 or input empty) — navigate to previous prompt
- **Down arrow** — navigate to next prompt / return to current draft
- **Prefix search** — type partial text, then up arrow searches history entries starting with that prefix
- **Current draft preservation** — navigating away saves the in-progress text; navigating back restores it

Storage: **IndexedDB** via a thin `PromptHistory` store class. Per-card history (each card/conversation has its own history). The store is external state accessed via `useSyncExternalStore` [L02].

```typescript
interface PromptHistoryStore {
  /** Add a submitted prompt to history */
  push(text: string): void;
  /** Navigate backward (older). Returns entry or null if at end. */
  back(prefix?: string): string | null;
  /** Navigate forward (newer). Returns entry or null if at draft. */
  forward(): string | null;
  /** Reset navigation position (e.g., after submit) */
  resetCursor(): void;
  /** Subscribe for useSyncExternalStore */
  subscribe(cb: () => void): () => void;
  getSnapshot(): PromptHistorySnapshot;
}
```

#### Slash Commands

Trigger: `/` at the start of input or after a newline.

A filtered popup list appears below the input. Keyboard navigation (up/down/enter/escape). The list is provided via props — tug-prompt-input doesn't know what commands exist; the parent provides them declaratively:

```typescript
interface SlashCommand {
  name: string;         // "/commit"
  description: string;  // "Commit staged changes"
  icon?: string;        // Lucide icon name (PascalCase)
}

interface TugPromptInputProps {
  // ...
  slashCommands?: SlashCommand[];
  onSlashCommand?: (command: string) => void;
}
```

**Initial slash command set** (provided by the conversation card):

Claude Code exposes 60+ built-in slash commands. We surface a curated subset — the commands most useful in a graphical IDE context — plus all tugplug skills. The full Claude Code command list remains available by typing `/` and scrolling, but the curated set gets priority positioning.

**Tugplug skills (always first):**

| Command | Description |
|---------|-------------|
| `/plan` | Create an implementation plan |
| `/implement` | Execute a plan's steps |
| `/merge` | Merge implementation branch |
| `/dash` | Quick task without plan ceremony |
| `/commit` | Git commit |

**Claude Code essentials (curated subset):**

| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation |
| `/compact` | Compact context |
| `/cost` | Show token/cost usage |
| `/model` | Switch model |
| `/status` | Show status |
| `/fast` | Toggle fast mode |
| `/help` | Show help |
| `/resume` | Resume previous session |
| `/diff` | Show current changes |
| `/review` | Code review |
| `/memory` | Show memory files |
| `/doctor` | Diagnostic checks |

The popup itself uses `@floating-ui/react` (MIT, already a Radix transitive dep) for positioning. Minimal custom UI — this is an internal popup, not a reusable component.

#### Keyboard Handling

| Key | Condition | Action |
|-----|-----------|--------|
| Enter | Default | Submit |
| Shift+Enter | Always | Insert newline |
| Cmd+Enter | Always | Submit (alternative) |
| Up | Cursor at line 0 or empty | History back |
| Down | In history mode | History forward |
| Escape | Popup open | Close popup |
| Escape | Input focused, no popup | Blur input |
| Tab | Popup open | Accept highlighted item |
| / | Start of line | Open slash command popup |

**IME safety:** Check `e.nativeEvent.isComposing` before handling Enter to avoid submitting during CJK composition.

#### Multi-line Expansion

Builds directly on TugTextarea's `autoResize` mechanism:
- Starts at 1 row (single-line appearance)
- Grows as user types or pastes multi-line content
- Caps at `maxRows` (default: 8) with scroll
- Height changes are instant (imperative DOM, not animated) per [L06]

#### Submit Behavior

- Submit callback: `onSubmit?: (text: string) => void`
- Submit clears the input and pushes to history
- While streaming: submit button becomes a stop button
- Stop callback: `onStop?: () => void`

### Phase 2 Feature Set (Future)

These require Tiptap and are **not part of the Group D build**:

- **@-mentions** — `@file.ts`, `@agent-name` with chip rendering
- **Ghost text** — translucent completion preview after cursor
- **Drag-and-drop** — files and images into the input
- **Rich paste** — image paste renders thumbnail chip
- **Token counter** — subtle character/token count display

### Props (Phase 1)

```typescript
interface TugPromptInputProps {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Placeholder text */
  placeholder?: string;
  /** Maximum visible rows before scroll */
  maxRows?: number;
  /** Submit callback */
  onSubmit?: (text: string) => void;
  /** Stop callback (cancel in-flight request) */
  onStop?: () => void;
  /** Whether a response is currently streaming */
  isStreaming?: boolean;
  /** Slash command definitions */
  slashCommands?: SlashCommand[];
  /** Slash command selected callback */
  onSlashCommand?: (command: string) => void;
  /** History context key (for per-card history isolation) */
  historyKey?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
}
```

---

## Component 4: tug-prompt-entry

### What It Does

The complete prompt composition surface. Composes tug-prompt-input with chrome: submit/stop button, utility buttons (attach file, voice input, etc.), and a progress/streaming indicator.

This is a **composition**, not a primitive. It arranges existing components and adds the submit/utility row.

### Layout

```
┌─────────────────────────────────────────────────┐
│ [prompt input area, auto-expanding]             │
│                                                 │
├─────────────────────────────────────────────────┤
│ [attach] [voice]           [token count] [send] │
└─────────────────────────────────────────────────┘
```

During streaming, the send button becomes a stop button (filled → danger tone). An optional TugProgress spinner shows in the utility row.

### Integration with Tugcast

The prompt entry connects to the conversation lifecycle through the existing CodeOutput/CodeInput feed pair:

- **Submit** → send `{ type: "user_message", text: "..." }` via `CodeInput` (`0x41`) frame
- **Stop** → send `{ type: "interrupt" }` via `CodeInput` frame
- **Streaming state** → driven by `CodeOutput` events: `assistant_text(status: "partial")` → streaming, `turn_complete` → idle, `turn_cancelled` → idle
- **Tool approval** → `tool_approval_request` events trigger an inline approval UI; user response sent as `{ type: "tool_approval", request_id, decision: "allow"|"deny" }`
- **Questions** → `question` events trigger an inline question UI; user response sent as `{ type: "question_answer", request_id, answers: {...} }`
- **Progress indicator** → can show agent role from tug-feed events ("architect thinking...", "coder implementing...", "reviewer checking...")

### Props

```typescript
interface TugPromptEntryProps {
  /** All TugPromptInput props passed through */
  // ...prompt input props...
  /** Show attach button */
  showAttach?: boolean;
  onAttach?: () => void;
  /** Show voice button */
  showVoice?: boolean;
  onVoice?: () => void;
  /** Show token/character count */
  showCounter?: boolean;
  /** Maximum token count (for display only) */
  maxTokens?: number;
}
```

### What We're NOT Doing

- **Inline previews** of attached files — Phase 2 concern
- **Model selector** — belongs in card chrome, not prompt entry
- **Conversation threading** — handled at the card level, not the input level

---

## Component 5: tug-search-bar

### What It Does

Simple composition: TugInput + TugPushButton. Search field with icon, clear button, and search/filter action.

### Assessment

This is low-complexity and low-priority compared to the other Group D components. It's a straightforward composition that could be built in a single dash. No new dependencies, no architectural decisions. Defer it to the end of Group D or skip if time is tight.

---

## Dependency Inventory

| Package | License | Size (gzip) | Status | Used By |
|---------|---------|-------------|--------|---------|
| `marked` | MIT | ~12KB | Already installed | tug-markdown |
| `shiki` | MIT | ~2MB w/ grammars | Already installed | tug-markdown (code blocks) |
| `dompurify` | MIT + Apache-2 | ~8KB | Already installed | tug-markdown (HTML sanitization) |
| `monaco-editor` | MIT | ~5MB | **New** | tug-rich-text |
| `@floating-ui/react` | MIT | ~12KB | Already transitive dep (Radix) | tug-prompt-input (slash popup) |

No new dependencies for tug-markdown (everything is already installed). Monaco is the only net-new package, and it's lazy-loaded so it doesn't impact initial bundle size.

---

## Build Order

Components ordered by dependency and user impact:

### Dash 1: tug-markdown — Core Renderer

Build the token-level rendering pipeline with `marked.lexer()` → React elements. Standard markdown: headings, paragraphs, bold/italic, links, lists, blockquotes, tables, horizontal rules, inline code. Streaming from day one — the single code path handles both static and live content (static content completes immediately without throttle).

Token aliases in CSS. Gallery card with representative markdown content.

### Dash 2: tug-markdown — Code Blocks (TugCodeBlock)

Extract and modernize the archived CodeBlock component. Shiki integration with hand-authored theme file referencing `--tug-syntax-*` CSS custom properties. Copy button, language label, line numbers. Register as the renderer for `code` tokens.

### Dash 3: tug-markdown — Streaming Polish

Gallery section showing simulated streaming (timed token injection). Incomplete markdown healing for edge cases. Streaming cursor indicator. Performance profiling and throttle tuning.

### Dash 4: tug-markdown — MDX+ Extensions

Custom block renderers for `tug-diff`, `tug-plan-step`, `tug-tool-result`, etc. Gallery sections demoing each extension.

### Dash 5: tug-prompt-input — Core

Enhanced textarea with auto-resize (from TugTextarea), submit/cancel keyboard handling, `onSubmit` callback. IME-safe Enter handling. Gallery card.

### Dash 6: tug-prompt-input — History

PromptHistory IndexedDB store. Up/down arrow navigation. Prefix search. Draft preservation. Per-card isolation via `historyKey`. Gallery section showing history navigation.

### Dash 7: tug-prompt-input — Slash Commands

Slash command popup with filtering, keyboard navigation. `@floating-ui/react` positioning. Initial command set (tugplug skills + Claude Code built-ins). Gallery section with sample commands.

### Dash 8: tug-prompt-entry

Compose tug-prompt-input + submit button + stop button + utility row. Streaming state integration driven by tug-feed events. Agent role indicator. Gallery card.

### Dash 9: tug-rich-text

Monaco editor wrapper. Lazy loading with TugProgress spinner. Hand-authored theme file with CSS custom property references. Controlled/uncontrolled. Read-only mode. Gallery card.

### Dash 10: tug-search-bar

TugInput + TugPushButton composition. Gallery card. Quick build.

---

## Resolved Questions

1. **Shiki theme generation** — Hand-authored theme file referencing `--tug-syntax-*` CSS custom properties from existing `tug-code.css`. Simpler, no runtime generation, manual sync is acceptable since syntax colors change rarely.

2. **Monaco lazy-load UX** — TugProgress spinner during load. No FOUC.

3. **History persistence scope** — Per-card history via `historyKey` prop. No global cross-card history for now.

4. **Slash command extensibility** — Purely declarative. Parent provides the list. No registration system.

5. **Streaming vs static code paths** — One streaming code path. Static content completes immediately without throttle. Streaming is the key use case and must be great.
