# Group D: Rich Content & Compositions — Proposal

*Markdown rendering, code editing, prompt input, and their compositions.*

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

The critical performance requirement. LLM responses can be thousands of tokens arriving over 30+ seconds. The renderer must be smooth at 60fps throughout.

```
WebSocket frame
  → TugConnection dispatches to feed callback
  → PropertyStore<string>.set(accumulated) [L02]
  → useSyncExternalStore triggers render
  → marked.lexer(accumulated) produces token[]
  → React reconciles: only last block changed
  → DOM patch: append text / update last paragraph
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

Shiki themes will be generated from these tokens rather than using a hardcoded `github-dark`. This means code highlighting automatically follows the active tug theme (brio/harmony).

### Code Blocks — TugCodeBlock

Extracted from the archived `CodeBlock` component, made tugways-compliant:

- **Language label** in header bar
- **Copy-to-clipboard** button with transient check animation
- **Shiki highlighting** with tug-theme-derived VS Code theme
- **Line numbers** (optional)
- **Word wrap toggle** (optional)
- **Lazy language loading** — only load grammars on demand
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

1. **Lazy-load only** — Monaco is never in the initial bundle. It loads on first render of a `tug-rich-text` instance via dynamic `import()`. A skeleton placeholder shows during loading.

2. **Web Worker** — Monaco's language services run in a Web Worker. Vite's `?worker` imports handle this.

3. **Token-driven theming** — Define a custom Monaco theme from `--tugx-*` tokens at runtime. Read computed styles, generate the Monaco theme object, apply it. Theme changes (brio ↔ harmony) trigger theme regeneration.

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

Storage: **IndexedDB** via a thin `PromptHistory` store class. Per-context history (each card/conversation has its own history). Unlimited entries (IndexedDB has no practical size limit). The store is external state accessed via `useSyncExternalStore` [L02].

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

A filtered popup list appears below the input. Keyboard navigation (up/down/enter/escape). The list is provided via props — tug-prompt-input doesn't know what commands exist; the parent component provides them:

```typescript
interface SlashCommand {
  name: string;         // "/commit"
  description: string;  // "Commit staged changes"
  icon?: string;        // Lucide icon name
}

interface TugPromptInputProps {
  // ...
  slashCommands?: SlashCommand[];
  onSlashCommand?: (command: string) => void;
}
```

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

Build the token-level rendering pipeline with `marked.lexer()` → React elements. Standard markdown: headings, paragraphs, bold/italic, links, lists, blockquotes, tables, horizontal rules, inline code. No streaming yet — static rendering first.

Token aliases in CSS. Gallery card with representative markdown content.

### Dash 2: tug-markdown — Code Blocks (TugCodeBlock)

Extract and modernize the archived CodeBlock component. Shiki integration with tug-token-derived themes. Copy button, language label, line numbers. Register as the renderer for `code` tokens.

### Dash 3: tug-markdown — Streaming

PropertyStore-backed content source [L02]. Throttled re-rendering. Incomplete markdown healing. Gallery section showing simulated streaming.

### Dash 4: tug-markdown — MDX+ Extensions

Custom block renderers for `tug-diff`, `tug-plan-step`, `tug-tool-result`, etc. Gallery sections demoing each extension.

### Dash 5: tug-prompt-input — Core

Enhanced textarea with auto-resize (from TugTextarea), submit/cancel keyboard handling, `onSubmit` callback. Gallery card.

### Dash 6: tug-prompt-input — History

PromptHistory IndexedDB store. Up/down arrow navigation. Prefix search. Draft preservation. Gallery section showing history navigation.

### Dash 7: tug-prompt-input — Slash Commands

Slash command popup with filtering, keyboard navigation. `@floating-ui/react` positioning. Gallery section with sample commands.

### Dash 8: tug-prompt-entry

Compose tug-prompt-input + submit button + stop button + utility row. Streaming state integration. Gallery card.

### Dash 9: tug-rich-text

Monaco editor wrapper. Lazy loading, token-driven theme, controlled/uncontrolled, read-only mode. Gallery card.

### Dash 10: tug-search-bar

TugInput + TugPushButton composition. Gallery card. Quick build.

---

## Open Questions

1. **Shiki theme generation** — Should we generate a full VS Code theme JSON from tug tokens at runtime, or maintain a hand-authored theme file that references CSS custom properties? The former is dynamic but complex; the latter is simpler but requires manual sync.

2. **Monaco lazy-load UX** — Monaco takes 1-3 seconds to load on first render. Should the skeleton placeholder show a shimmer (like TugSkeleton), a spinner (TugProgress), or the raw text content without highlighting?

3. **History persistence scope** — Per-card history makes sense conceptually, but should there also be a global "recent prompts" list that spans cards? Power users might want to reuse a prompt they sent in a different conversation.

4. **Slash command extensibility** — Should slash commands be purely declarative (parent provides the list) or should there be a registration system (like the responder chain) where any component can contribute commands?

5. **tug-markdown in non-streaming contexts** — Some uses (plan documents, tool descriptions) are static, not streamed. Should these bypass the streaming pipeline entirely, or does the same code path handle both? (Leaning: same code path, just without the throttle — simpler to maintain one path.)
