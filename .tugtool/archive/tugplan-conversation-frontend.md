## Phase 7.0: Conversation Frontend {#phase-conversation-frontend}

**Purpose:** Deliver a full multi-turn conversational interface to Claude in tugdeck, powered by the Claude Agent SDK V2 via a new tugtalk process, with rich rendering of messages, tool use, code blocks, streaming, session persistence, and crash recovery.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 1-6 established the tugdeck dashboard with terminal, filesystem, git, and stats cards, a design token system with Lucide icons, and a single-command launcher (tugcode). The interaction model is still fundamentally observational: users watch Claude Code's TUI output through a web-rendered xterm.js window. There is no way to interact with Claude through a structured conversational UI, drop files into the conversation, or see Claude's responses as rich formatted content rather than ANSI escape sequences.

Phase 7 delivers the centerpiece capability: a conversation card in tugdeck that provides multi-turn interaction with Claude via the Claude Agent SDK V2. A new Bun/TypeScript process (tugtalk) manages the agent session and communicates with tugcast over JSON-lines IPC. The conversation card renders messages with Markdown formatting, syntax-highlighted code blocks, collapsible tool use cards, approval prompts, clarifying questions, file/image attachments, and streaming state indicators.

#### Strategy {#strategy}

- Build tugtalk (the conversation engine) first as a standalone Bun process with SDK adapter isolation, then wire it into tugcast via IPC
- Add conversation feed IDs (0x40 output, 0x41 input) to the existing binary WebSocket protocol before building the card
- Build the conversation card incrementally: shell first, then Markdown, code blocks, tool cards, approvals, questions, interrupts, attachments
- Implement session persistence (IndexedDB cache + reconciliation) and crash recovery after the rendering pipeline is proven
- Use the existing CSS Grid layout from Phases 1-5 (Phase 8 panel system is deferred)
- Pin the Agent SDK to a specific version and isolate all SDK calls behind an adapter layer to absorb API instability
- Split complex steps (tool use cards, session management) into substeps for clearer commit boundaries

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using tugdeck as their primary Claude interaction surface
2. Teams that want structured, auditable Claude conversations with tool visibility

#### Success Criteria (Measurable) {#success-criteria}

- First message to first response token < 2 seconds after session established (measured with `performance.now()` over 20 runs, report p50/p95)
- Cached conversation render on page load (IndexedDB to DOM) < 200ms (measured with `performance.now()`)
- Streaming text render at 60fps with no dropped frames (measured with Chrome DevTools Performance panel, worst-case frame time < 16.67ms over 10-second capture)
- 0 reconciliation mismatches per 100 reconnect cycles (automated disconnect/reconnect harness)
- Crash-free session rate > 99% over 100 sustained 1-hour test sessions
- All markdown rendering produces zero XSS vectors (DOMPurify allowlist permits only safe Markdown-generated tags; `script`, `iframe`, event handlers, and `javascript:` URLs are stripped; verified by injection test suite)

#### Scope {#scope}

1. tugtalk process: Bun/TypeScript, Agent SDK V2 session management, JSON-lines IPC
2. IPC bridge in tugcast: spawn tugtalk, relay messages, crash detection and restart
3. Conversation feed IDs (0x40 output, 0x41 input) with message identity model
4. Conversation card: message list, user bubbles, Markdown rendering, code blocks with syntax highlighting
5. Tool use cards, tool approval prompts, clarifying question cards
6. Interrupt/cancel (Ctrl-C, stop button) with per-tool cancellation contracts
7. File drop, clipboard paste, and attachment handling
8. Streaming state: cursor indicator, stop button, activity border
9. IndexedDB conversation cache with reconciliation algorithm
10. Session scoping by project directory, crash recovery with restart budget
11. Default layout preset with conversation card primary
12. Permission model (default, acceptEdits, bypassPermissions, plan) with dynamic switching

#### Non-goals (Explicitly out of scope) {#non-goals}

- Phase 8 panel system (dockable/floating cards, tab groups) -- deferred
- Multi-user or multi-session support within a single tugdeck instance
- Custom tool definitions beyond the SDK built-in set
- Accessibility pass (keyboard-only docking, screen-reader labels, contrast checks)
- Voice input or non-text interaction modalities
- Conversation export or sharing features

#### Dependencies / Prerequisites {#dependencies}

- Phase 6 (tugcode Launcher, commit b2a2f74) complete -- provides parent process architecture
- Phase 5 (Design Tokens, Icons & Terminal Polish, commit 6594359) complete -- provides token system and Lucide icons
- Phase 4 (Bun Pivot, commit b98163a) complete -- provides Bun build toolchain
- Phases 1-3 stable -- tmux session infrastructure and WebSocket multiplexing
- `@anthropic-ai/claude-agent-sdk` available via npm/bun registry

#### Constraints {#constraints}

- Agent SDK V2 is unstable preview; all SDK calls must go through an adapter layer
- Pin SDK to a specific version; do not auto-update
- All conversation card rendering must use semantic tokens from Phase 5 exclusively -- no new hardcoded colors
- IndexedDB for conversation cache (native browser API, no external wrapper)
- JSON-lines over stdin/stdout for IPC (no additional protocol dependencies)
- CSP meta tag must be present in tugdeck's HTML for defense-in-depth
- Session scoping is per-project-directory via `.tugtool/.session`, not global

#### Assumptions {#assumptions}

- The `@anthropic-ai/claude-agent-sdk` package will be available via npm/bun registry when tugtalk is scaffolded
- The design document at `roadmap/component-roadmap-2.md` section 7 is the authoritative specification. **If this tugplan and the roadmap diverge, this tugplan is authoritative** -- it incorporates user answers and critic feedback that postdate the roadmap
- The IndexedDB cache implementation will use browser native API -- no external IndexedDB wrapper
- Session scoping by project directory means `.tugtool/.session` is per-directory, not global
- The default permission mode will be `acceptEdits` per section 7.8 of the design document
- Permission mode changes are purely local to tugtalk's `canUseTool` callback and do not require SDK session-level changes
- Phase 8 (Panel System) is explicitly deferred -- Phase 7 will use the existing CSS Grid layout

---

### Risks and Mitigations {#risks}

**Risk R01: Agent SDK V2 instability** {#r01-sdk-instability}

- **Risk:** The Agent SDK V2 API surface may change before stabilization, breaking tugtalk
- **Mitigation:** Pin to a specific SDK version in `package.json`. Wrap all SDK calls behind an adapter layer (`sdk-adapter.ts`) that isolates the rest of tugtalk from API changes. Monitor SDK changelog.
- **Residual risk:** A major breaking change may require rewriting the adapter layer, but the rest of tugtalk and the IPC protocol remain stable

**Risk R02: XSS via model/tool output** {#r02-xss-model-output}

- **Risk:** Claude's responses or tool results could contain malicious HTML that executes in the browser
- **Mitigation:** DOMPurify configured with an explicit allowlist of safe Markdown-generated tags (`h1`-`h6`, `p`, `strong`, `em`, `a`, `code`, `pre`, `ul`, `ol`, `li`, `blockquote`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `br`, `hr`, `img`, `del`, `sup`, `sub`) and safe attributes (`href`, `src`, `alt`, `title`, `class`, `id`). All dangerous elements (`script`, `iframe`, `object`, `embed`, `form`, `style`, `link`, `meta`, `base`, `svg`, `math`) and all event handler attributes (`on*`) are stripped. CSP meta tag blocks script execution as defense-in-depth. marked does not sanitize and is not relied upon for safety.
- **Residual risk:** The allowlist is minimal and well-audited. Residual risk is limited to non-HTML attack vectors (e.g., crafted `href` values in `<a>` tags); `javascript:` URLs are explicitly stripped by DOMPurify's default behavior for `href` attributes.

**Risk R03: Conversation state consistency** {#r03-state-consistency}

- **Risk:** Message ordering, deduplication, or partial updates could cause the conversation to render incorrectly
- **Mitigation:** Message identity model with `msg_id` + `seq` numbers. Gap-free ordering guarantee with 5-second buffering timeout. Reconciliation algorithm on reconnect. Deduplication via `(msg_id, seq)` set.
- **Residual risk:** Extremely rare edge case where both watch and broadcast channels fail simultaneously could cause a brief inconsistency until the next reconnect

**Risk R04: tugtalk crash mid-turn** {#r04-crash-mid-turn}

- **Risk:** tugtalk crashes while Claude is responding or executing tools, losing the in-flight turn
- **Mitigation:** Auto-restart with 1s delay, session resume via session ID in `.tugtool/.session`, IndexedDB cache preserves history. Crash budget (3 in 60s) prevents loops. No turn replay.
- **Residual risk:** The in-flight turn at crash time is lost. Partially-executed tool side effects (e.g., half-written files) require manual inspection.

**Risk R05: IPC malformed JSON** {#r05-ipc-malformed-json}

- **Risk:** Malformed JSON or protocol version mismatches in the stdin/stdout IPC between tugcast and tugtalk
- **Mitigation:** Validate every JSON line on both sides. Include protocol version in the initial handshake. Log and discard malformed lines with error events rather than crashing.
- **Residual risk:** A sustained stream of malformed JSON would fill logs but not crash either process

---

### 7.0.0 Design Decisions {#design-decisions}

#### [D01] Agent SDK V2 with adapter layer isolation (DECIDED) {#d01-sdk-adapter}

**Decision:** Use `@anthropic-ai/claude-agent-sdk` V2 for multi-turn conversation, pinned to a specific version, with all SDK API calls isolated behind an adapter module (`sdk-adapter.ts`).

**Rationale:**
- The SDK provides built-in tools, streaming, session persistence, and tool approval callbacks -- no need to reimplement
- V2 is unstable preview; the adapter layer absorbs API changes without rippling through the IPC protocol or conversation card
- Pinning the version prevents unexpected breakage from auto-updates

**Implications:**
- tugtalk's `main.ts` imports only from `sdk-adapter.ts`, never from the SDK directly
- SDK upgrades are contained to a single file (adapter + type mappings)
- If V2 introduces session-level permission semantics, the adapter can create new sessions on mode switch without changing the IPC contract
- **Package name fallback:** The canonical package name is `@anthropic-ai/claude-agent-sdk`. If the package is not published under this name at implementation time, check for `@anthropic-ai/sdk` (the existing SDK) and wrap its conversation API, or check the Anthropic npm org for an alternative package name. The adapter layer ensures this is a Step 0 concern only.

#### [D02] JSON-lines IPC over stdin/stdout (DECIDED) {#d02-jsonlines-ipc}

**Decision:** tugtalk communicates with tugcast via JSON-lines over stdin (tugcast to tugtalk) and stdout (tugtalk to tugcast). Each line is a complete JSON object with a `type` field discriminator.

**Rationale:**
- stdin/stdout is the simplest IPC mechanism for parent-child processes
- JSON-lines is human-readable, debuggable, and trivially parseable
- No additional dependencies (no gRPC, no WebSocket between backend processes)

**Implications:**
- tugtalk must not write anything to stdout except valid JSON lines (logging goes to stderr)
- Protocol version included in initial handshake message for forward compatibility
- Malformed JSON lines are logged and discarded, not fatal

#### [D03] Conversation feed IDs 0x40 and 0x41 (DECIDED) {#d03-feed-ids}

**Decision:** Add two new feed IDs to the binary WebSocket protocol: `0x40` (conversation output, tugcast to tugdeck) and `0x41` (conversation input, tugdeck to tugcast). The conversation output feed uses both watch (snapshot on reconnect) and broadcast (real-time streaming) channel types.

**Rationale:**
- Fits the existing feed architecture (terminal 0x00-0x02, filesystem 0x10, git 0x20, stats 0x30-0x33)
- Dual channel type (watch + broadcast) provides both instant reconnect state and real-time streaming
- Separate input feed (0x41) allows mpsc message routing from tugdeck to tugcast

**Implications:**
- `crates/tugcast-core/src/protocol.rs`: add `ConversationOutput = 0x40` and `ConversationInput = 0x41` variants to the Rust `FeedId` enum, update `from_byte()` match arms and `as_byte()`, update existing tests (`test_feedid_from_byte`, `test_feedid_as_byte`), add round-trip tests for the new variants. This is the P0 prerequisite -- without it, `Frame::decode()` returns `Err(ProtocolError::InvalidFeedId(0x40))` for every conversation frame.
- `tugdeck/src/protocol.ts`: add matching entries to the TypeScript `FeedId` const object
- `crates/tugcast/src/router.rs`: add new `FeedRouter` fields for conversation broadcast sender (`broadcast::Sender<Frame>`), conversation input mpsc sender (`mpsc::Sender<Frame>`), and agent bridge handle (`JoinHandle<()>`); extend `handle_client` select loop with a second broadcast receiver for conversation output and a second input route for `FeedId::ConversationInput`
- The watch channel must maintain the full conversation state for reconnecting clients

#### [D04] Message identity model with seq/rev (DECIDED) {#d04-message-identity}

**Decision:** Every conversation message has a `msg_id` (UUID v4), `seq` (monotonically increasing integer, gap-free per session), `rev` (revision counter for partial updates), and `status` (partial/complete/cancelled). Messages are rendered in `seq` order with deduplication via `(msg_id, seq)`.

**Rationale:**
- Gap-free `seq` numbers enable strict ordering even when messages arrive out of order
- `rev` enables streaming updates without creating new messages
- Deduplication prevents double-rendering on reconnect when watch and broadcast overlap
- 5-second buffering timeout prevents indefinite render stalls if a message is lost

**Implications:**
- tugtalk assigns `msg_id` and `seq` when creating messages
- tugdeck maintains a set of seen `(msg_id, seq)` pairs for deduplication
- tugdeck buffers out-of-order messages by `seq` with a 5-second timeout before requesting full resync

#### [D05] DOMPurify with safe Markdown allowlist (DECIDED) {#d05-dompurify-sanitizer}

**Decision:** All Markdown-rendered HTML from model/tool output is sanitized through DOMPurify configured with an explicit allowlist of safe Markdown-generated tags. marked is used only for Markdown-to-HTML conversion, not for sanitization. CSP meta tag provides defense-in-depth.

**DOMPurify configuration:**

```typescript
DOMPurify.sanitize(html, {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'sup', 'sub',
    'a', 'code', 'pre',
    'ul', 'ol', 'li',
    'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base', 'svg', 'math'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
});
```

**Rationale:**
- The allowlist contains only tags that `marked` generates from standard Markdown/GFM syntax -- nothing executable
- `FORBID_TAGS` explicitly blocks dangerous elements even if DOMPurify's defaults change
- `FORBID_ATTR` explicitly blocks event handlers; DOMPurify also strips `javascript:` URLs from `href`/`src` by default
- marked does not sanitize HTML by default -- relying on it for safety would be a vulnerability
- CSP blocks script execution even if DOMPurify is somehow bypassed

**Implications:**
- The CSP meta tag `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:;` must be in `index.html`
- The allowlist is exhaustive and frozen -- adding new tags requires a security review
- Markdown-rendered content uses `.conversation-prose` CSS class for styling, not HTML attributes
- Raw HTML in model output that is not in the allowlist (e.g., `<div>`, `<span>`) is stripped to its text content

#### [D06] Shiki for syntax highlighting with 17 initial languages (DECIDED) {#d06-shiki-highlighting}

**Decision:** Use Shiki for code block syntax highlighting, initialized with 17 languages (TypeScript, JavaScript, Python, Rust, Shell/Bash, JSON, CSS, HTML, Markdown, Go, Java, C, C++, SQL, YAML, TOML, Dockerfile). Unlisted languages attempt lazy load; if unavailable, fall back to plain monospace.

**Rationale:**
- Shiki uses VS Code TextMate grammars -- exact same highlighting as the editor
- Custom theme via CSS custom properties maps cleanly to the Phase 5 token system
- 17 languages cover the vast majority of coding conversations
- Lazy load prevents large initial bundle while supporting long-tail languages

**Implications:**
- Syntax tokens (`--syntax-keyword`, `--syntax-string`, etc.) are CSS custom properties in the token system
- Initial Shiki bundle includes 17 grammars; additional grammars loaded on demand
- Failed lazy loads fall back silently to plain monospace -- no error banners for unsupported languages
- **Bundle size:** Shiki adds ~1.5-2MB gzipped (WASM + 17 grammars). Acceptable for locally-served tugdeck. Shiki uses WASM-based oniguruma; Bun build must handle WASM loading (use `shiki/bundle/web` pre-bundled entry if `--splitting` does not work).

#### [D07] IndexedDB for conversation cache (DECIDED) {#d07-indexeddb-cache}

**Decision:** tugdeck caches conversation history in IndexedDB (native browser API, no external wrapper). Each message is keyed by `msg_id` with its `seq` number. The cache is scoped per project directory via a hashed database name (`tugdeck-<project-hash>`).

**Rationale:**
- Conversations with code blocks, tool results, and images can easily exceed localStorage's ~5MB limit
- Native IndexedDB API is sufficient; no wrapper library needed
- Per-project scoping prevents cross-project data bleed
- Provides instant rendering on page load before WebSocket connects

**Implications:**
- Writes are debounced at 1 second
- Reconciliation algorithm merges cached and live state on session resume
- "Clear history" action in conversation card menu deletes the project's IndexedDB database
- No automatic expiration -- user controls retention explicitly

#### [D08] Dynamic permission switching without session restart (DECIDED) {#d08-dynamic-permissions}

**Decision:** Permission modes (default, acceptEdits, bypassPermissions, plan) are switched dynamically in tugtalk's `canUseTool` callback without creating a new Agent SDK session. The default mode is `acceptEdits`.

**Rationale:**
- The `canUseTool` callback lives in tugtalk, not in the SDK session
- Switching modes mid-conversation preserves full context without re-establishing the session
- `acceptEdits` matches Claude Code's typical interactive mode

**Implications:**
- Permission mode is a runtime setting sent via IPC (0x41 input feed), not part of session scope
- If the SDK V2 introduces session-level permission semantics, the adapter layer can create a new session on switch
- Verification step after session management confirms dynamic switching works correctly

#### [D09] Crash recovery with restart budget (DECIDED) {#d09-crash-recovery}

**Decision:** When tugtalk crashes, tugcast auto-restarts it after a 1-second delay. tugtalk attempts session resume via the session ID in `.tugtool/.session`. If tugtalk crashes 3 times within 60 seconds, tugcast stops restarting and sends a fatal error event. In-flight turns are lost (no replay).

**Rationale:**
- Auto-restart provides seamless recovery for transient crashes
- Session resume preserves conversation context across restarts
- Crash budget prevents infinite restart loops
- Turn replay is too complex and risky (side effects from partially-executed tools)

**Implications:**
- tugcast must track crash timestamps and count for budget enforcement
- tugdeck must mark stale tool approval prompts and running tool cards after a crash
- The error banner "Conversation engine failed repeatedly. Please restart tugcode." is the terminal failure state

#### [D10] Existing CSS Grid layout for Phase 7 (DECIDED) {#d10-css-grid-layout}

**Decision:** Phase 7 uses the existing CSS Grid layout from Phases 1-5. The conversation card is added as a new card in the grid. The Phase 8 panel system (dockable/floating cards) is deferred.

**Rationale:**
- Core conversation value should ship before heavy UI infrastructure investment
- The existing grid layout is functional and stable
- The Phase 8 panel system can retroactively improve the layout after conversation is proven

**Implications:**
- **CardSlot type extension:** The `CardSlot` type in `tugdeck/src/deck.ts` is currently a closed string union `'terminal' | 'git' | 'files' | 'stats'`. It must be extended to `'conversation' | 'terminal' | 'git' | 'files' | 'stats'`. The `DeckManager` constructor hardcodes exactly 4 slot elements; it must create a 5th slot for conversation.
- **CSS Grid restructuring:** The current grid is 2-column (`gridTemplateColumns` with `colSplit` percentage) with 3 rows in the right column. The new layout has conversation on the left (2/3 width) and a right column with terminal/git/files/stats (1/3 width, 4 rows). The `rowSplits` array must expand from 2 elements (3 row boundaries) to 3 elements (4 row boundaries), defaulting to `[0.25, 0.5, 0.75]`. A 3rd row drag handle must be added. `createDragHandles()`, `setupRowDrag()`, `positionHandles()`, and `updateGridTracks()` all must handle the additional row.
- **LAYOUT_VERSION bump:** The `LayoutState` interface must be updated to include the conversation card position and must expect `rowSplits` as a length-3 array. `LAYOUT_VERSION` bumps from 1 to 2. The `loadLayout()` v1-to-v2 migration must: (a) insert conversation card at default position, (b) convert 2-element `rowSplits` (for 3 cards: git/files/stats) to 3-element `rowSplits` (for 4 cards: terminal/git/files/stats) by prepending a `0.25` boundary and scaling the existing values into the remaining 75%. `loadLayout()` validation must check `rowSplits.length === 3`.
- Layout persistence uses the existing localStorage mechanism

#### [D11] IPC protocol versioning and error handling (DECIDED) {#d11-ipc-protocol-versioning}

**Decision:** The IPC protocol includes a version field in the initial handshake (`{"type": "protocol_init", "version": 1}`). Malformed JSON lines are logged and discarded. Protocol version mismatches between tugcast and tugtalk cause a fatal error with a clear message.

**Rationale:**
- Protocol versioning enables forward compatibility as the IPC protocol evolves
- Graceful handling of malformed JSON prevents cascading crashes
- Version mismatch detection prevents silent data corruption

**Implications:**
- Both tugcast and tugtalk validate protocol version on startup
- A version mismatch produces an error event on the conversation feed
- Logging includes the raw malformed line for debugging

---

### 7.0.1 IPC Protocol Specification {#ipc-protocol}

**Spec S01: Inbound Messages (tugcast to tugtalk stdin)** {#s01-inbound-messages}

| Type | Fields | Description |
|------|--------|-------------|
| `protocol_init` | `version: number` | Initial handshake, sent once on spawn |
| `user_message` | `text: string, attachments: Attachment[]` | User sends a message |
| `tool_approval` | `request_id: string, decision: "allow" \| "deny"` | User responds to tool approval |
| `question_answer` | `request_id: string, answers: Record<string, string>` | User answers clarifying question |
| `interrupt` | (none) | User interrupts current turn |
| `permission_mode` | `mode: "default" \| "acceptEdits" \| "bypassPermissions" \| "plan"` | Change permission mode |

**Spec S02: Outbound Messages (tugtalk stdout to tugcast)** {#s02-outbound-messages}

| Type | Fields | Description |
|------|--------|-------------|
| `protocol_ack` | `version: number, session_id: string` | Handshake response |
| `session_init` | `session_id: string` | Session created or resumed |
| `assistant_text` | `msg_id: string, seq: number, rev: number, text: string, is_partial: boolean, status: string` | Assistant text block |
| `tool_use` | `msg_id: string, seq: number, tool_name: string, tool_use_id: string, input: object` | Claude calls a tool |
| `tool_result` | `tool_use_id: string, output: string, is_error: boolean` | Tool execution result |
| `tool_approval_request` | `request_id: string, tool_name: string, input: object` | Needs user permission |
| `question` | `request_id: string, questions: Question[]` | Clarifying question |
| `turn_complete` | `msg_id: string, seq: number, result: string` | Turn finished |
| `turn_cancelled` | `msg_id: string, seq: number, partial_result: string` | Turn interrupted |
| `error` | `message: string, recoverable: boolean` | Error event |

**Spec S03: Attachment Format** {#s03-attachment-format}

```json
{
  "filename": "string",
  "content": "string (text or base64)",
  "media_type": "string (MIME type)"
}
```

**Spec S04: Message Identity Model** {#s04-message-identity}

| Field | Type | Description |
|-------|------|-------------|
| `msg_id` | string (UUID v4) | Unique message identifier, assigned by tugtalk |
| `seq` | integer | Monotonically increasing per session, starts at 0, gap-free, stable across partials |
| `rev` | integer | Revision counter within a message, starts at 0, increments on each partial update |
| `blocks` | array | Ordered content blocks, each with `block_index` (0-based within message) |
| `status` | enum | `partial` (streaming), `complete` (final), `cancelled` (interrupted) |

---

### 7.0.2 Conversation Card Rendering Specification {#card-rendering}

**Spec S05: User Message Styling** {#s05-user-message}

- Right-aligned bubble
- Background: `var(--primary)`, text: `var(--primary-foreground)`
- Border-radius: `var(--radius-lg)`, padding: 12px 16px
- Max width: 80% of conversation area
- Attachment chips below bubble as pills with `Paperclip` icon

**Spec S06: Assistant Message Styling** {#s06-assistant-message}

- Left-aligned, full width (no bubble)
- Background: `var(--background)`, text: `var(--foreground)`
- Content is a sequence of blocks: text, tool use, tool result, images
- Interrupted messages: `opacity: 0.5`, `Octagon` icon + "Interrupted" label

**Spec S07: Code Block Styling** {#s07-code-block}

- Container: `var(--muted)` background, `1px solid var(--border)`, `var(--radius)` corners
- Header: language label left in `var(--muted-foreground)`, copy button right with `Copy` icon
- Code: `Menlo, Monaco, Courier New, monospace`, 13px, `var(--foreground)`
- Copy: `Copy` icon transitions to `Check` icon for 2s, color `var(--muted-foreground)` to `var(--success)`
- Horizontal scroll on overflow, max height 400px with vertical scroll, sticky header
- Syntax highlighting via Shiki with CSS custom property theme (`--syntax-keyword`, `--syntax-string`, etc.)

**Spec S08: Tool Use Card Styling** {#s08-tool-use-card}

- Container: `var(--muted)` background, `1px solid var(--border)`, `var(--radius)` corners
- Header: Lucide icon per tool type + tool name + truncated input summary + status + chevron
- Status: `Loader` spinning (running), `Check` green (success), `X` red (failure), `Octagon` yellow (interrupted)
- Input section: monospace, `var(--muted-foreground)`, key-value pairs
- Result section: monospace with 10-line truncation + "show all" link
- Collapsed by default, entire card clickable to toggle

**Spec S09: Tool Approval Prompt Styling** {#s09-tool-approval}

- Container: `2px solid var(--warning)` border (attention-drawing)
- Command preview: monospace, `var(--foreground)` on `var(--muted)`
- Allow button: `var(--success)` background, `var(--success-foreground)` text
- Deny button: `var(--destructive)` background, `var(--destructive-foreground)` text
- Input area disabled with "Waiting for tool approval..." while pending

**Spec S10: Clarifying Question Card Styling** {#s10-clarifying-question}

- Container: `var(--card)` background, `1px solid var(--accent)` border
- Question text: `var(--foreground)`, 14px, semi-bold
- Option labels: `var(--foreground)` 14px, descriptions: `var(--muted-foreground)` 13px
- Radio/checkbox: `var(--accent)` selected, `var(--border)` unselected
- Submit button: `var(--primary)` background, `var(--primary-foreground)` text
- After submission: static, selected answer highlighted in `var(--accent)`

**Table T01: Tool Icon Mapping** {#t01-tool-icons}

| Tool | Lucide Icon |
|------|------------|
| Read | `FileText` |
| Edit | `Pencil` |
| Write | `FilePlus2` |
| Bash | `Terminal` |
| Glob | `FolderSearch` |
| Grep | `Search` |
| Generic/Unknown | `Wrench` |

**Table T02: Cancellation Contract Per Tool** {#t02-cancellation-contract}

| Tool | Cancellation Behavior |
|------|----------------------|
| Read, Glob, Grep | Effectively instant, no side effects |
| Edit, Write | Best-effort; file may be partially written |
| Bash | SIGTERM to child process, SIGKILL after 3s, partial stdout captured |
| WebFetch, WebSearch | HTTP request aborted, no side effects |

---

### 7.0.3 Symbol Inventory {#symbol-inventory}

#### 7.0.3.1 New directories {#new-directories}

| Directory | Purpose |
|-----------|---------|
| `tugtalk/` | Bun/TypeScript project for conversation engine |
| `tugtalk/src/` | Source code for tugtalk |

#### 7.0.3.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugtalk/package.json` | Package manifest with SDK dependency |
| `tugtalk/tsconfig.json` | TypeScript configuration |
| `tugtalk/src/main.ts` | Entry point: IPC loop, session lifecycle |
| `tugtalk/src/sdk-adapter.ts` | Adapter layer isolating SDK V2 API calls |
| `tugtalk/src/ipc.ts` | JSON-lines protocol handler (parse, validate, emit) |
| `tugtalk/src/types.ts` | Shared type definitions for IPC messages |
| `tugtalk/src/session.ts` | Session management (create, resume, persist ID) |
| `tugtalk/src/permissions.ts` | Permission mode logic and `canUseTool` callback |
| `crates/tugcast/src/feeds/conversation.rs` | Conversation feed implementation (0x40/0x41) |
| `crates/tugcast/src/feeds/agent_bridge.rs` | IPC bridge: spawn tugtalk, relay messages, crash restart |
| `tugdeck/src/cards/conversation-card.ts` | Conversation card: message list, input area, rendering |
| `tugdeck/src/cards/conversation/message-renderer.ts` | Markdown + DOMPurify rendering pipeline |
| `tugdeck/src/cards/conversation/code-block.ts` | Shiki-powered code block with copy button |
| `tugdeck/src/cards/conversation/tool-card.ts` | Collapsible tool use card component |
| `tugdeck/src/cards/conversation/approval-prompt.ts` | Tool approval prompt (Allow/Deny buttons) |
| `tugdeck/src/cards/conversation/question-card.ts` | Clarifying question card (radio/checkbox/submit) |
| `tugdeck/src/cards/conversation/attachment-handler.ts` | File drop, clipboard paste, attachment chips |
| `tugdeck/src/cards/conversation/streaming-state.ts` | Cursor indicator, activity border, stop button |
| `tugdeck/src/cards/conversation/session-cache.ts` | IndexedDB cache, reconciliation algorithm |
| `tugdeck/src/cards/conversation/types.ts` | TypeScript types for conversation messages |

#### 7.0.3.3 Modified files {#modified-files}

| File | Change |
|------|--------|
| `crates/tugcast-core/src/protocol.rs` | Add `ConversationOutput = 0x40` and `ConversationInput = 0x41` to `FeedId` enum, update `from_byte()`, update existing tests |
| `tugdeck/src/protocol.ts` | Add `CONVERSATION_OUTPUT: 0x40` and `CONVERSATION_INPUT: 0x41` to FeedId |
| `tugdeck/src/connection.ts` | Route conversation feed frames to conversation card |
| `tugdeck/src/deck.ts` | Add `'conversation'` to `CardSlot` type, create 5th slot element, restructure CSS Grid to conversation-primary layout, bump `LAYOUT_VERSION` to 2, update `loadLayout()` for v1 migration |
| `tugdeck/src/main.ts` | Initialize conversation card in startup sequence |
| `tugdeck/package.json` | Add `marked`, `dompurify`, `shiki` dependencies |
| `tugdeck/index.html` | Add CSP meta tag |
| `crates/tugcast/src/feeds/mod.rs` | Add `conversation` and `agent_bridge` modules |
| `crates/tugcast/src/router.rs` | Add conversation broadcast sender, conversation input mpsc sender, and agent bridge handle to `FeedRouter`; extend `handle_client` select loop for conversation feeds |
| `crates/tugcast/src/main.rs` | Create conversation channels, pass to `FeedRouter`, spawn agent bridge |
| `crates/tugcast/src/cli.rs` | Add `--tugtalk-path` optional CLI arg for tugtalk binary path |

---

### 7.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions in isolation | IPC parsing, message identity, sanitization, reconciliation |
| **Integration** | Test components working together | tugtalk-to-tugcast IPC round-trip, conversation card rendering pipeline |
| **Golden / Contract** | Compare output against known-good snapshots | Markdown rendering output, code block HTML, tool card HTML |
| **Drift Prevention** | Detect unintended behavior changes | DOMPurify sanitization of known attack vectors, message ordering guarantees |

---

### 7.0.5 Execution Steps {#execution-steps}

#### Step 0: Scaffold tugtalk with SDK adapter layer {#step-0}

**Commit:** `feat(tugtalk): scaffold Bun project with Agent SDK adapter layer`

**References:** [D01] Agent SDK V2 with adapter layer isolation, [D02] JSON-lines IPC over stdin/stdout, Risk R01, (#ipc-protocol, #strategy, #context, #new-files, #new-directories)

**Artifacts:**
- `tugtalk/package.json` with pinned `@anthropic-ai/claude-agent-sdk` version
- `tugtalk/tsconfig.json` with strict TypeScript configuration
- `tugtalk/src/main.ts` with minimal IPC loop (read stdin, write stdout)
- `tugtalk/src/sdk-adapter.ts` with typed adapter interface wrapping SDK calls
- `tugtalk/src/ipc.ts` with JSON-lines parser/emitter
- `tugtalk/src/types.ts` with shared IPC message type definitions

**Tasks:**
- [ ] Create `tugtalk/` directory with `package.json` specifying pinned SDK version (`@anthropic-ai/claude-agent-sdk` at a specific semver). If the package is not available under that name, check `@anthropic-ai/sdk` or the Anthropic npm org for an alternative; document the actual package name used in the adapter module.
- [ ] Run `bun install` to generate `bun.lockb`
- [ ] Create `tsconfig.json` with strict mode, ES2022 target, module NodeNext
- [ ] Implement `types.ts` with TypeScript discriminated unions for all inbound/outbound message types per Spec S01 and S02
- [ ] Implement `ipc.ts` with `readLine()` (stdin JSON-lines reader), `writeLine()` (stdout JSON-lines writer), and `validateMessage()` (type validation)
- [ ] Implement `sdk-adapter.ts` with typed interface: `createSession()`, `resumeSession()`, `sendMessage()`, `streamResponse()`, `cancelTurn()`, `setPermissionMode()`
- [ ] Implement `main.ts` with IPC loop: read stdin, dispatch by message type, write responses to stdout. Accept `--dir <path>` CLI argument for project directory (used for session scoping in Step 14.1). Parse with `Bun.argv` or a minimal arg parser.
- [ ] Add protocol version handshake: tugtalk sends `protocol_ack` with version 1 on startup
- [ ] Ensure all tugtalk stdout is valid JSON-lines (console.log/warn/error redirected to stderr)

**Tests:**
- [ ] Unit test: `ipc.ts` correctly parses valid JSON lines
- [ ] Unit test: `ipc.ts` rejects malformed JSON with error (not crash)
- [ ] Unit test: `types.ts` type guards correctly discriminate message types
- [ ] Unit test: `sdk-adapter.ts` adapter interface matches expected SDK surface
- [ ] Unit test: Protocol version handshake emits correct `protocol_ack`

**Checkpoint:**
- [ ] `bun install` succeeds in `tugtalk/`
- [ ] `bun run tugtalk/src/main.ts` starts and responds to a `protocol_init` message on stdin with `protocol_ack` on stdout
- [ ] `bun test` passes all unit tests

**Rollback:**
- Delete `tugtalk/` directory

**Commit after all checkpoints pass.**

---

#### Step 1: Implement tugtalk session management {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugtalk): implement session create, resume, send, and stream`

**References:** [D01] Agent SDK V2 with adapter layer isolation, [D08] Dynamic permission switching, Spec S01, Spec S02, Spec S04, (#ipc-protocol, #s04-message-identity, #assumptions)

**Artifacts:**
- `tugtalk/src/session.ts` with session lifecycle management
- `tugtalk/src/permissions.ts` with `canUseTool` callback and mode switching
- Updated `tugtalk/src/main.ts` wired to session and permission modules

**Tasks:**
- [ ] Implement `session.ts`: `createSession()` creates new SDK session, `resumeSession(id)` resumes existing, `persistSessionId(id)` writes to `.tugtool/.session`
- [ ] Implement `permissions.ts`: `canUseTool` callback that checks current permission mode, `setPermissionMode()` for dynamic switching
- [ ] Wire `main.ts` IPC loop to session lifecycle: `user_message` -> `session.send()` -> stream response -> emit `assistant_text`, `tool_use`, `tool_result`, `turn_complete`
- [ ] Implement message identity: assign `msg_id` (UUID v4) and `seq` (monotonically increasing) to each outbound message
- [ ] Implement streaming: emit `assistant_text` with `is_partial: true` during streaming, `is_partial: false` on completion
- [ ] Handle `interrupt` message: cancel current SDK turn, emit `turn_cancelled`
- [ ] Handle `tool_approval` and `question_answer` messages: forward to SDK callbacks
- [ ] Handle `permission_mode` message: call `setPermissionMode()` on permissions module
- [ ] On SDK `canUseTool` callback: emit `tool_approval_request`, wait for `tool_approval` response
- [ ] On SDK `AskUserQuestion` tool: emit `question`, wait for `question_answer` response
- [ ] Read session ID from `.tugtool/.session` on startup; attempt resume, fall back to new session

**Tests:**
- [ ] Unit test: `session.ts` creates session and assigns sequential `seq` numbers
- [ ] Unit test: `session.ts` persists and reads session ID from `.tugtool/.session`
- [ ] Unit test: `permissions.ts` correctly maps permission modes to tool approval decisions
- [ ] Unit test: `permissions.ts` dynamically switches mode without restart
- [ ] Integration test: Full IPC round-trip with mock SDK: send `user_message`, receive `assistant_text` + `turn_complete`

**Checkpoint:**
- [ ] `bun test` passes all unit and integration tests
- [ ] Manual test: pipe a `user_message` to tugtalk stdin, observe structured response on stdout with correct `msg_id`, `seq`, `status` fields

**Rollback:**
- Revert changes to `main.ts`, delete `session.ts` and `permissions.ts`

**Commit after all checkpoints pass.**

---

#### Step 2: Implement IPC bridge in tugcast {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): IPC bridge to spawn tugtalk and relay conversation messages`

**References:** [D02] JSON-lines IPC, [D03] Conversation feed IDs, [D09] Crash recovery, [D11] IPC protocol versioning, Risk R04, Risk R05, (#ipc-protocol, #s01-inbound-messages, #s02-outbound-messages, #modified-files)

**Artifacts:**
- Updated `crates/tugcast-core/src/protocol.rs` -- add `ConversationOutput = 0x40` and `ConversationInput = 0x41` to `FeedId` enum
- `crates/tugcast/src/feeds/agent_bridge.rs` -- spawn tugtalk, relay JSON-lines, handle crashes
- `crates/tugcast/src/feeds/conversation.rs` -- conversation feed (0x40/0x41) with watch+broadcast channels
- Updated `crates/tugcast/src/feeds/mod.rs` with new modules
- Updated `crates/tugcast/src/router.rs` with new `FeedRouter` fields and extended select loop
- Updated `crates/tugcast/src/main.rs` to create conversation channels and start agent bridge
- Updated `crates/tugcast/src/cli.rs` with `--tugtalk-path` CLI arg

**Tasks:**
- [ ] **tugcast-core protocol update (P0 prerequisite):** Add `ConversationOutput = 0x40` and `ConversationInput = 0x41` variants to the `FeedId` enum in `crates/tugcast-core/src/protocol.rs`. Update `from_byte()` to include `0x40 => Some(FeedId::ConversationOutput)` and `0x41 => Some(FeedId::ConversationInput)`. The `as_byte()` method works via `*self as u8` so needs no change. Update `test_feedid_from_byte` to assert the new variants. Update `test_feedid_as_byte` to assert `ConversationOutput.as_byte() == 0x40` and `ConversationInput.as_byte() == 0x41`. Add `test_round_trip_conversation_output` and `test_round_trip_conversation_input` round-trip tests.
- [ ] **FeedRouter extension:** Add three new fields to `FeedRouter` in `router.rs`: `conversation_tx: broadcast::Sender<Frame>` (conversation output broadcast), `conversation_input_tx: mpsc::Sender<Frame>` (conversation input from tugdeck), and `agent_bridge_handle: Option<tokio::task::JoinHandle<()>>`. Update `FeedRouter::new()` to accept these. Extend the `handle_client` select loop with: (a) a second `broadcast_rx` subscription for `conversation_tx` that sends conversation output frames to the WebSocket client, (b) a match arm in the client-message handler for `FeedId::ConversationInput` that forwards to `conversation_input_tx`.
- [ ] **tugtalk path resolution:** Implement `resolve_tugtalk_path()` in `agent_bridge.rs` mirroring tugcode's `resolve_tugcast_path()` pattern: look for `tugtalk` binary next to the current executable first (`std::env::current_exe().parent().join("tugtalk")`), then fall back to checking PATH, then fall back to `bun run tugtalk/src/main.ts` relative to the project directory. Add `--tugtalk-path` optional CLI arg to `tugcast` (in `cli.rs`) that overrides auto-detection.
- [ ] **CLI arg propagation:** tugcode passes `--dir` to tugcast. tugcast passes the resolved `--dir` to tugtalk as a CLI argument so tugtalk knows the project directory for session scoping. The chain is: `tugcode --dir /path` -> `tugcast --dir /path` -> `tugtalk --dir /path`.
- [ ] Implement `agent_bridge.rs`: spawn tugtalk as child process with stdin/stdout piped, stderr inherited
- [ ] Implement stdin relay: read from conversation input mpsc channel, write JSON-lines to tugtalk stdin
- [ ] Implement stdout relay: read JSON-lines from tugtalk stdout, parse, validate, forward to conversation broadcast channel and watch channel
- [ ] Add protocol version handshake: send `protocol_init` with version 1 to tugtalk on spawn, validate `protocol_ack` response
- [ ] Add malformed JSON handling: log and discard lines that fail JSON parse, emit error event on conversation feed
- [ ] Add protocol version mismatch handling: emit fatal error event if versions differ
- [ ] Implement crash detection: monitor tugtalk child process exit, record crash timestamps
- [ ] Implement crash restart: auto-restart tugtalk after 1-second delay
- [ ] Implement crash budget: track 3 crashes within 60 seconds, stop restarting and emit fatal error
- [ ] Implement SIGTERM propagation: when tugcast receives SIGTERM, forward to tugtalk child process
- [ ] Implement `conversation.rs`: conversation feed with watch channel (full state) and broadcast channel (real-time)
- [ ] Register conversation feed in `router.rs` and start agent bridge in `main.rs`

**Tests:**
- [ ] Unit test: `FeedId::from_byte(0x40)` returns `Some(ConversationOutput)`, `from_byte(0x41)` returns `Some(ConversationInput)`
- [ ] Unit test: round-trip encode/decode for `ConversationOutput` and `ConversationInput` frames
- [ ] Unit test: `agent_bridge.rs` correctly spawns child process and relays stdin/stdout
- [ ] Unit test: crash budget logic correctly counts crashes within 60-second window
- [ ] Unit test: malformed JSON is logged and discarded without crashing
- [ ] Unit test: protocol version mismatch produces fatal error event
- [ ] Unit test: `resolve_tugtalk_path()` returns sibling path when binary exists, falls back otherwise
- [ ] Integration test: full message round-trip from WebSocket client through tugcast to tugtalk and back
- [ ] Integration test: tugtalk crash triggers restart after 1-second delay

**Checkpoint:**
- [ ] `cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast-core` passes all tests (including new FeedId variants)
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` passes all tests
- [ ] Manual test: start tugcast, connect WebSocket, send conversation input frame (0x41), receive conversation output frame (0x40) with valid response

**Rollback:**
- Revert changes to `tugcast-core/src/protocol.rs`, `mod.rs`, `router.rs`, `main.rs`, `cli.rs`; delete `agent_bridge.rs` and `conversation.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Add conversation feed IDs and message identity to protocol {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add conversation feed IDs (0x40, 0x41) and message identity types`

**References:** [D03] Conversation feed IDs, [D04] Message identity model, Spec S04, (#ipc-protocol, #s04-message-identity, #modified-files)

**Artifacts:**
- Updated `tugdeck/src/protocol.ts` with `CONVERSATION_OUTPUT: 0x40` and `CONVERSATION_INPUT: 0x41`
- New `tugdeck/src/cards/conversation/types.ts` with TypeScript types for all message kinds
- Updated `tugdeck/src/connection.ts` to route conversation frames

**Tasks:**
- [ ] Add `CONVERSATION_OUTPUT: 0x40` and `CONVERSATION_INPUT: 0x41` to `FeedId` in `protocol.ts`
- [ ] Create `tugdeck/src/cards/conversation/types.ts` with TypeScript interfaces for all inbound message types (matching Spec S02)
- [ ] Add message identity types: `ConversationMessage` with `msg_id`, `seq`, `rev`, `blocks`, `status`
- [ ] Add helper: `encodeConversationInput(msg)` that creates a frame with feed ID 0x41
- [ ] Update `connection.ts` to recognize feed ID 0x40 and dispatch to a conversation message handler
- [ ] Implement message ordering buffer: hold out-of-order messages by `seq`, emit in order, 5-second timeout triggers resync
- [ ] Implement deduplication: maintain `Set<string>` of seen `(msg_id, seq)` pairs, drop duplicates

**Tests:**
- [ ] Unit test: `encodeConversationInput` produces correct binary frame
- [ ] Unit test: message ordering buffer correctly reorders out-of-sequence messages
- [ ] Unit test: ordering buffer triggers resync after 5-second gap timeout
- [ ] Unit test: deduplication drops messages with already-seen `(msg_id, seq)` pairs
- [ ] Unit test: partial updates with same `msg_id` but higher `rev` replace rendered content

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts --outfile=dist/app.js` succeeds
- [ ] All unit tests pass
- [ ] Manual test: start tugcast+tugtalk, load tugdeck in browser, verify WebSocket connection shows conversation feed frames in DevTools Network tab

**Rollback:**
- Revert `protocol.ts` and `connection.ts` changes; delete `tugdeck/src/cards/conversation/types.ts`

**Commit after all checkpoints pass.**

---

#### Step 4: Conversation card shell (message list, input area, user bubbles) {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): conversation card shell with message list, input area, and user bubbles`

**References:** [D10] Existing CSS Grid layout, Spec S05, Spec S06, Table T01, (#card-rendering, #s05-user-message, #s06-assistant-message, #modified-files, #new-files)

**Artifacts:**
- `tugdeck/src/cards/conversation-card.ts` -- main conversation card component
- `tugdeck/src/cards/conversation/types.ts` (updated with render types)
- Updated `tugdeck/src/deck.ts` with conversation card creation and grid layout adjustment
- Updated `tugdeck/src/main.ts` with conversation card initialization

**Tasks:**
- [ ] **CardSlot type extension:** Add `'conversation'` to the `CardSlot` union type in `deck.ts`: `type CardSlot = 'conversation' | 'terminal' | 'git' | 'files' | 'stats'`
- [ ] **5th slot element:** Update `DeckManager` constructor to create a conversation slot element alongside the existing 4 slots. The conversation slot goes first in the grid.
- [ ] **CSS Grid restructuring:** Change from 2-column layout (terminal left, 3 cards right) to conversation-primary layout: conversation card takes left 2/3, terminal/git/files/stats in right 1/3 column with 4 rows. Update `gridTemplateColumns` and `gridTemplateRows` accordingly. Update `updateGridTracks()` and `positionHandles()` for the new grid structure. **rowSplits expansion:** The existing `rowSplits` array has 2 elements (defining boundaries for 3 rows: git/files/stats). With 4 cards in the right column (terminal/git/files/stats), `rowSplits` must expand to 3 elements (defining boundaries for 4 rows). The default splits become `[0.25, 0.5, 0.75]` (equal quarters). **3rd drag handle:** `createDragHandles()` currently creates 2 row drag handles. Add a 3rd row drag handle between the 3rd and 4th cards. Update `setupRowDrag()` to handle index 2. Update `positionHandles()` to position the 3rd handle.
- [ ] **LAYOUT_VERSION bump:** Bump `LAYOUT_VERSION` from 1 to 2. Update `LayoutState` interface: add conversation card position/collapsed state, change `rowSplits` type expectation from length-2 to length-3 array. Update `loadLayout()` for v1-to-v2 migration: (a) insert conversation card at default position, (b) convert v1 `rowSplits` (2 elements for git/files/stats) to v2 `rowSplits` (3 elements for terminal/git/files/stats) by prepending `0.25` and scaling existing values into the remaining 75%. Update `loadLayout()` validation: check `rowSplits.length === 3` instead of `=== 2`.
- [ ] Implement `conversation-card.ts` extending the existing card pattern: card header with "Conversation" title, scrollable message list, input area. The `ConversationCard` class must accept a `DeckManager` reference (via the same `setDeckManager()` pattern used by `TerminalCard`) for resize coordination and to check `isDragging` state before performing layout-sensitive operations.
- [ ] Implement message list container: `overflow-y: auto`, auto-scroll to bottom on new messages
- [ ] Implement user message rendering: right-aligned bubble with `var(--primary)` background, `var(--primary-foreground)` text, `var(--radius-lg)` corners, 12px/16px padding, max 80% width
- [ ] Implement assistant message rendering (text only for now): left-aligned, full width, `var(--foreground)` text on `var(--background)`
- [ ] Implement input area: multi-line `<textarea>` with auto-expanding height, placeholder "Type a message..."
- [ ] Implement send button: `ArrowUp` Lucide icon, sends `user_message` via conversation input feed (0x41)
- [ ] Implement Enter-to-send (Shift+Enter for newline)
- [ ] Update `main.ts` to initialize conversation card in startup sequence
- [ ] Wire conversation output feed (0x40) to message list rendering

**Tests:**
- [ ] Unit test: input area correctly sends `user_message` frame on Enter
- [ ] Unit test: Shift+Enter inserts newline without sending
- [ ] Unit test: user messages render with correct CSS classes and alignment
- [ ] Unit test: auto-scroll activates on new message arrival
- [ ] Unit test: `CardSlot` type includes `'conversation'`
- [ ] Unit test: default `rowSplits` has 3 elements for 4 right-column rows
- [ ] Unit test: v1 layout migration produces valid v2 layout with conversation card and 3-element rowSplits
- [ ] Unit test: `ConversationCard` accepts `DeckManager` reference via `setDeckManager()`

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] `cargo build -p tugcast` succeeds (embeds updated tugdeck)
- [ ] Manual test: load tugdeck, type a message, see user bubble appear; receive assistant response and see it rendered as plain text
- [ ] Manual test: verify conversation card renders at left 2/3 width, terminal/git/files/stats in right 1/3 with 4 equal rows
- [ ] Manual test: verify all 3 row drag handles in right column are functional (drag between terminal/git, git/files, files/stats)
- [ ] Manual test: collapse conversation card to 28px header, expand back
- [ ] Manual test: clear localStorage, reload -- default layout appears correctly with conversation primary

**Rollback:**
- Revert `deck.ts` and `main.ts` changes; delete `conversation-card.ts`

**Commit after all checkpoints pass.**

---

#### Step 5: Markdown rendering with DOMPurify and security hardening {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): markdown rendering with marked, DOMPurify sanitization, and CSP`

**References:** [D05] DOMPurify with safe Markdown allowlist, Risk R02, Spec S06, (#card-rendering, #s06-assistant-message, #constraints)

**Artifacts:**
- `tugdeck/src/cards/conversation/message-renderer.ts` -- Markdown rendering pipeline
- Updated `tugdeck/package.json` with `marked` and `dompurify` dependencies
- Updated `tugdeck/index.html` with CSP meta tag
- CSS: `.conversation-prose` styles scoped to conversation card

**Tasks:**
- [ ] Add `marked` and `dompurify` to `tugdeck/package.json`, run `bun install`
- [ ] Implement `message-renderer.ts`: `renderMarkdown(text: string): string` pipeline: marked -> DOMPurify -> `.conversation-prose` wrapper
- [ ] Configure marked with `{gfm: true, breaks: true}` (GitHub-Flavored Markdown + soft line breaks)
- [ ] Configure DOMPurify with exact allowlist config per [D05]: `ALLOWED_TAGS` = `['h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','sup','sub','a','code','pre','ul','ol','li','blockquote','table','thead','tbody','tr','th','td','img']`, `ALLOWED_ATTR` = `['href','src','alt','title','class','id']`, `FORBID_TAGS` = `['script','iframe','object','embed','form','style','link','meta','base','svg','math']`, `FORBID_ATTR` = `['onerror','onload','onclick','onmouseover','onfocus','onblur']`
- [ ] Add CSP meta tag to `tugdeck/index.html`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:;">`
- [ ] Implement `.conversation-prose` CSS styles per section 7.4 of design doc: font-family, font-size 14px, line-height 1.6, heading styles, paragraph margins, strong/em/a/ul/ol/li/code styles
- [ ] Wire `message-renderer.ts` into assistant message rendering in `conversation-card.ts`
- [ ] Handle inline `<code>` separately from fenced code blocks (inline gets `var(--muted)` background, fenced blocks handled in Step 6)

**Tests:**
- [ ] Unit test: basic Markdown renders correctly -- `# Heading` produces `<h1>`, `**bold**` produces `<strong>`, `*italic*` produces `<em>`, lists produce `<ul>/<li>`, `[link](url)` produces `<a href="url">`
- [ ] Unit test: DOMPurify strips `<script>` tags completely (tag and content removed)
- [ ] Unit test: DOMPurify strips `<img onerror=...>` -- the `onerror` attribute is removed, `<img>` tag is preserved if `src` is safe
- [ ] Unit test: DOMPurify strips `javascript:` URLs from `<a href="javascript:...">` (href removed or tag stripped)
- [ ] Unit test: DOMPurify strips inline event handlers (`onclick`, `onload`, etc.) from any tag
- [ ] Unit test: DOMPurify strips `<iframe>`, `<object>`, `<embed>`, `<form>`, `<style>`, `<svg>`, `<math>` tags completely
- [ ] Unit test: DOMPurify preserves allowed tags (`<h1>`, `<p>`, `<strong>`, `<em>`, `<a>`, `<code>`, `<pre>`, `<ul>`, `<ol>`, `<li>`, `<blockquote>`, `<table>`, `<img>`)
- [ ] Unit test: DOMPurify strips non-allowlisted tags (`<div>`, `<span>`, `<section>`) to their text content
- [ ] Golden test: known Markdown input produces expected sanitized HTML output with correct tags preserved

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] All sanitization tests pass
- [ ] Manual test: send a message that triggers a Claude response with Markdown formatting, verify headings, bold, code, lists render correctly
- [ ] Manual test: verify CSP meta tag is present in served HTML (DevTools Elements tab)

**Rollback:**
- Revert `index.html`, `package.json`, delete `message-renderer.ts`

**Commit after all checkpoints pass.**

---

#### Step 6: Code blocks with Shiki syntax highlighting {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): syntax-highlighted code blocks with Shiki and copy button`

**References:** [D06] Shiki for syntax highlighting, Spec S07, (#card-rendering, #s07-code-block)

**Artifacts:**
- `tugdeck/src/cards/conversation/code-block.ts` -- code block rendering with Shiki
- Updated `tugdeck/package.json` with `shiki` dependency
- CSS: syntax token custom properties (`--syntax-keyword`, etc.) and code block container styles

**Tasks:**
- [ ] Add `shiki` to `tugdeck/package.json`, run `bun install`. **Bundle size note:** Shiki uses a WASM-based architecture (`oniguruma` WASM for TextMate grammar parsing). The core WASM binary is ~800KB gzipped. With 17 languages, the total Shiki contribution is approximately 1.5-2MB gzipped. This is acceptable because tugdeck is served locally (not over the internet) and loaded once per session. **Bun build compatibility:** Shiki's browser bundle uses dynamic `import()` for language grammars and loads WASM via `fetch()`. Bun's bundler handles dynamic imports via code splitting (`--splitting` flag). If Bun's bundler cannot resolve Shiki's WASM loader, use Shiki's pre-bundled browser entry (`shiki/bundle/web`) which inlines the WASM. Verify during implementation that `bun build --splitting` produces a working bundle with Shiki; if not, fall back to the pre-bundled entry or configure `--external` for the WASM files and serve them as static assets.
- [ ] Implement `code-block.ts`: async `renderCodeBlock(code: string, language: string): Promise<HTMLElement>`
- [ ] Initialize Shiki with 17 languages: TypeScript, JavaScript, Python, Rust, Shell/Bash, JSON, CSS, HTML, Markdown, Go, Java, C, C++, SQL, YAML, TOML, Dockerfile
- [ ] Create custom Shiki theme using CSS custom properties: `--syntax-keyword` (palette-blue-2), `--syntax-string` (palette-orange), `--syntax-number` (palette-green), `--syntax-function` (palette-yellow), `--syntax-type` (palette-green), `--syntax-variable` (palette-blue-3), `--syntax-comment` (palette-gray-5), `--syntax-operator` (foreground), `--syntax-punctuation` (foreground), `--syntax-constant` (palette-blue-3), `--syntax-decorator` (palette-purple), `--syntax-tag` (palette-blue-2), `--syntax-attribute` (palette-blue-3)
- [ ] Implement language header bar: language label left-aligned, copy button right-aligned
- [ ] Implement copy button: `Copy` icon, on click copies code to clipboard, transitions to `Check` icon for 2 seconds with `var(--success)` color
- [ ] Implement lazy language loading: for unlisted languages, attempt `highlighter.loadLanguage()`, fall back to plain monospace
- [ ] Implement code block container styles: `var(--muted)` background, `1px solid var(--border)`, `var(--radius)`, horizontal scroll, 400px max height with vertical scroll, sticky header
- [ ] Wire code block renderer into `message-renderer.ts`: intercept fenced code blocks from marked output and replace with Shiki-rendered HTML

**Tests:**
- [ ] Unit test: code block renders TypeScript with correct syntax token classes
- [ ] Unit test: copy button copies code text to clipboard (mock clipboard API)
- [ ] Unit test: unknown language falls back to plain monospace without error
- [ ] Unit test: code block container has correct max-height and scroll behavior
- [ ] Golden test: known Python snippet produces expected highlighted HTML

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] `cargo build -p tugcast` succeeds
- [ ] All tests pass
- [ ] Manual test: send a message that triggers Claude to respond with a code block, verify syntax highlighting matches VS Code Dark theme colors

**Rollback:**
- Revert `package.json`, delete `code-block.ts`, revert `message-renderer.ts` code block interception

**Commit after all checkpoints pass.**

---

#### Step 7: Tool use cards {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): tool use cards with status, icons, input/result sections`

**References:** [D03] Conversation feed IDs, Spec S08, Table T01, (#card-rendering, #s08-tool-use-card, #t01-tool-icons)

> Tool use cards are the most complex rendering component. Split into substeps for clearer commit boundaries.

**Tasks:**
- [ ] Complete substep 7.1 (tool card container and header)
- [ ] Complete substep 7.2 (tool card input and result sections)

**Tests:**
- [ ] All substep tests pass (see Steps 7.1 and 7.2)

**Checkpoint:**
- [ ] `bun build` succeeds after all substeps complete

##### Step 7.1: Tool card container and header {#step-7-1}

**Commit:** `feat(tugdeck): tool use card container with icon, status, and collapse toggle`

**References:** [D03] Conversation feed IDs, Spec S08, Table T01, (#card-rendering, #s08-tool-use-card, #t01-tool-icons)

**Artifacts:**
- `tugdeck/src/cards/conversation/tool-card.ts` -- tool use card component (container + header)

**Tasks:**
- [ ] Implement `tool-card.ts`: `ToolCard` class that creates a collapsible card with header row
- [ ] Implement header: Lucide icon per tool type (from Table T01), tool name in `var(--card-foreground)`, truncated input summary, status indicator, expand/collapse chevron
- [ ] Implement status indicator: `Loader` spinning in `var(--accent)` while running, `Check` in `var(--success)` on success, `X` in `var(--destructive)` on failure, `Octagon` in `var(--warning)` if interrupted
- [ ] Implement collapse/expand: default collapsed, entire card clickable to toggle, `ChevronRight` (collapsed) / `ChevronDown` (expanded)
- [ ] Wire `tool_use` message from conversation feed to create a new ToolCard in the message flow
- [ ] Wire `tool_result` message to update the corresponding ToolCard status and populate result content

**Tests:**
- [ ] Unit test: correct Lucide icon selected for each tool type (Read, Edit, Write, Bash, Glob, Grep, unknown)
- [ ] Unit test: status transitions correctly (running -> success, running -> failure, running -> interrupted)
- [ ] Unit test: collapse/expand toggles visibility of content section

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: trigger tool use in conversation, see tool card appear with correct icon and status

**Rollback:**
- Delete `tool-card.ts`, revert conversation card wiring

**Commit after all checkpoints pass.**

---

##### Step 7.2: Tool card input and result sections {#step-7-2}

**Depends on:** #step-7-1

**Commit:** `feat(tugdeck): tool card input/result display with truncation and syntax highlighting`

**References:** Spec S08, Spec S07, (#s08-tool-use-card, #s07-code-block)

**Artifacts:**
- Updated `tugdeck/src/cards/conversation/tool-card.ts` with input and result sections

**Tasks:**
- [ ] Implement input section: monospace font, `var(--muted-foreground)`, render tool input as key-value pairs
- [ ] Implement result section: monospace font with truncation at 10 lines + "show all" link
- [ ] For Read results: syntax-highlight if filename has a known extension (reuse Shiki from Step 6)
- [ ] For Bash results: render as terminal output (monospace, `var(--foreground)` on `var(--background)`)
- [ ] For error results: render with `var(--destructive)` color
- [ ] Implement "show all" link: on click, expand to show full result (remove truncation)

**Tests:**
- [ ] Unit test: input section renders key-value pairs correctly
- [ ] Unit test: result truncation shows first 10 lines with "show all" link
- [ ] Unit test: "show all" expands to full content
- [ ] Unit test: Read result with `.ts` extension is syntax-highlighted
- [ ] Unit test: error result renders in destructive color

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: trigger a Read tool use, expand the card, see syntax-highlighted file content; trigger Bash, see terminal-styled output

**Rollback:**
- Revert tool-card.ts to Step 7.1 state

**Commit after all checkpoints pass.**

---

#### Step 7 Summary {#step-7-summary}

**Depends on:** #step-7-2

**Commit:** `test(tugdeck): verify tool use card integration`

**References:** Spec S08, Table T01, (#s08-tool-use-card, #t01-tool-icons)

After completing Steps 7.1-7.2, the conversation card can render tool use interactions with:
- Correct Lucide icons per tool type
- Status indicators (running, success, failure, interrupted)
- Collapsible cards with input/result sections
- Syntax-highlighted Read results and terminal-styled Bash results
- Truncation with "show all" expansion

**Tasks:**
- [ ] Verify all tool card functionality works together

**Tests:**
- [ ] Integration test: multiple tool uses in a single conversation render correctly

**Checkpoint:**
- [ ] `bun build && cargo build -p tugcast` succeeds
- [ ] All tool card tests pass
- [ ] Manual test: complete conversation with multiple tool uses renders correctly

**Rollback:**
- No rollback needed (verification only)

---

#### Step 8: Tool approval prompts {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): tool approval prompts with Allow/Deny buttons and input blocking`

**References:** [D08] Dynamic permission switching, Spec S09, Table T02, (#card-rendering, #s09-tool-approval, #t02-cancellation-contract)

**Artifacts:**
- `tugdeck/src/cards/conversation/approval-prompt.ts` -- tool approval prompt component

**Tasks:**
- [ ] Implement `approval-prompt.ts`: renders when a `tool_approval_request` message arrives
- [ ] Render tool name with Lucide icon, command/input preview in monospace on `var(--muted)` background
- [ ] Render Allow button: `var(--success)` background, `var(--success-foreground)` text
- [ ] Render Deny button: `var(--destructive)` background, `var(--destructive-foreground)` text
- [ ] Container styling: `2px solid var(--warning)` border for attention
- [ ] On Allow click: send `tool_approval` message with `decision: "allow"` via 0x41, transition to normal tool card
- [ ] On Deny click: send `tool_approval` message with `decision: "deny"`, show `X` icon, result "Denied by user"
- [ ] While awaiting approval: disable input area with placeholder "Waiting for tool approval..."
- [ ] Re-enable input area after approval decision is sent

**Tests:**
- [ ] Unit test: approval prompt renders with correct tool icon and input preview
- [ ] Unit test: Allow click sends correct IPC message and transitions to tool card
- [ ] Unit test: Deny click sends correct IPC message and shows denied state
- [ ] Unit test: input area is disabled while approval is pending

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: trigger a tool that requires approval (e.g., Bash in default mode), see prompt, click Allow, see tool execute

**Rollback:**
- Delete `approval-prompt.ts`, revert conversation card wiring

**Commit after all checkpoints pass.**

---

#### Step 9: Clarifying question cards {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): clarifying question cards with radio/checkbox selection and submit`

**References:** Spec S10, (#card-rendering, #s10-clarifying-question, #s01-inbound-messages)

**Artifacts:**
- `tugdeck/src/cards/conversation/question-card.ts` -- clarifying question card component

**Tasks:**
- [ ] Implement `question-card.ts`: renders when a `question` message arrives
- [ ] Render question text in `var(--foreground)`, 14px, semi-bold
- [ ] Render options as radio buttons (single select) or checkboxes (multi-select based on `multiSelect` field)
- [ ] Each option: label in `var(--foreground)` 14px, description in `var(--muted-foreground)` 13px
- [ ] Radio/checkbox styling: `var(--accent)` when selected, `var(--border)` when unselected
- [ ] Render "Other" text input: `var(--muted)` background, `1px solid var(--input)` border
- [ ] Render Submit button: `var(--primary)` background, `var(--primary-foreground)` text
- [ ] On Submit: send `question_answer` message via 0x41 with selected answers
- [ ] After submission: card becomes static (non-interactive), selected answer highlighted in `var(--accent)`
- [ ] While awaiting answer: disable main input area
- [ ] Container: `var(--card)` background, `1px solid var(--accent)` border

**Tests:**
- [ ] Unit test: question card renders options with correct labels and descriptions
- [ ] Unit test: radio button allows only single selection
- [ ] Unit test: checkbox allows multiple selection
- [ ] Unit test: Submit sends correct `question_answer` IPC message
- [ ] Unit test: after submission, card is non-interactive with highlighted answer

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: trigger a clarifying question from Claude, select an option, submit, see answer sent and card become static

**Rollback:**
- Delete `question-card.ts`, revert conversation card wiring

**Commit after all checkpoints pass.**

---

#### Step 10: Implement interrupt (Ctrl-C / stop button) {#step-10}

**Depends on:** #step-9

**Commit:** `feat(tugdeck): interrupt support with Ctrl-C, stop button, and per-tool cancellation`

**References:** [D04] Message identity model, Table T02, (#t02-cancellation-contract, #card-rendering)

**Artifacts:**
- Updated `tugdeck/src/cards/conversation-card.ts` with interrupt handling
- Updated `tugdeck/src/cards/conversation/tool-card.ts` with cancelled state

**Tasks:**
- [ ] Add keyboard listener for Ctrl-C and Escape while a turn is active: send `interrupt` message via 0x41
- [ ] Replace send button (`ArrowUp`) with stop button (`Square` icon) during active turn
- [ ] Stop button click sends `interrupt` message via 0x41
- [ ] On `turn_cancelled` response: mark the assistant message with `status: "cancelled"`, render with `opacity: 0.5` and `Octagon` + "Interrupted" label
- [ ] If a tool card was in "running" state at interrupt time: transition to "interrupted" state (`Octagon` icon in `var(--warning)`)
- [ ] Preserve partial content that was rendered before the interrupt
- [ ] Re-enable input area after interrupt so user can immediately send a new message

**Tests:**
- [ ] Unit test: Ctrl-C sends interrupt message when turn is active
- [ ] Unit test: Ctrl-C is ignored when no turn is active
- [ ] Unit test: stop button appears during active turn, send button appears otherwise
- [ ] Unit test: interrupted message renders with cancelled styling
- [ ] Unit test: running tool card transitions to interrupted state on cancel
- [ ] Unit test: input area re-enables after interrupt

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: start a conversation turn, press Ctrl-C (or click stop), see partial response with interrupted indicator, verify can send new message immediately

**Rollback:**
- Revert changes to `conversation-card.ts` and `tool-card.ts`

**Commit after all checkpoints pass.**

---

#### Step 11: File drop, clipboard paste, and attachment handling {#step-11}

**Depends on:** #step-10

**Commit:** `feat(tugdeck): file drop, clipboard paste, and attachment handling for conversation`

**References:** Spec S03, Spec S05, (#card-rendering, #s03-attachment-format, #s05-user-message)

**Artifacts:**
- `tugdeck/src/cards/conversation/attachment-handler.ts` -- file processing and attachment UI

**Tasks:**
- [ ] Implement `attachment-handler.ts`: manages pending attachments for the next message
- [ ] Implement drag-and-drop zone: dropping files anywhere on the conversation card adds them to pending attachments
- [ ] Visual feedback on drag-over: card border changes to `2px dashed var(--accent)`
- [ ] Implement clipboard paste: pasting an image attaches it as base64-encoded image
- [ ] Implement file attachment button (`Paperclip` icon) in input area: opens file picker
- [ ] File processing: images (png, jpg, gif, webp) -> base64 with image MIME type; text files -> text content with filename; binary files -> reject with error message
- [ ] Render attachment chips below input area: pill-shaped with filename + `Paperclip` icon + `X` remove button
- [ ] On send: include pending attachments in `user_message` as `attachments` array per Spec S03
- [ ] Clear pending attachments after send
- [ ] Render attachment chips on user message bubbles (read-only, showing what was attached)

**Tests:**
- [ ] Unit test: image file is converted to base64 with correct media_type
- [ ] Unit test: text file is read as text content with filename metadata
- [ ] Unit test: binary file is rejected with error
- [ ] Unit test: attachment chips render and can be removed before send
- [ ] Unit test: attachments are included in the sent `user_message`

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: drag an image file onto conversation card, see chip appear, send message, verify attachment is included in IPC message

**Rollback:**
- Delete `attachment-handler.ts`, revert conversation card input area changes

**Commit after all checkpoints pass.**

---

#### Step 12: Streaming state indicators {#step-12}

**Depends on:** #step-11

**Commit:** `feat(tugdeck): streaming state with cursor indicator, activity border, and stop button`

**References:** [D04] Message identity model, Spec S06, (#card-rendering, #s06-assistant-message)

**Artifacts:**
- `tugdeck/src/cards/conversation/streaming-state.ts` -- streaming visual state management

**Tasks:**
- [ ] Implement `streaming-state.ts`: manages visual indicators during active streaming
- [ ] Implement blinking cursor: thin `var(--accent)` bar at the end of streaming text, CSS animation `blink 1s step-end infinite`
- [ ] Implement activity border: subtle animated gradient `var(--accent)` to transparent pulsing on the assistant message container during streaming
- [ ] Token-by-token text rendering: append text as `assistant_text` partials arrive (each partial contains full accumulated text, replace existing content)
- [ ] Show stop button during streaming, hide when `turn_complete` or `turn_cancelled` arrives
- [ ] Remove cursor and activity border when streaming completes
- [ ] Tool use cards appear immediately in "running" state when `tool_use` message arrives during streaming

**Tests:**
- [ ] Unit test: cursor element appears during streaming and disappears on completion
- [ ] Unit test: activity border activates during streaming
- [ ] Unit test: partial text updates replace content correctly (not append)
- [ ] Unit test: stop button visible during streaming, send button visible after completion

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: send a message, observe token-by-token streaming with cursor, activity border, and stop button; see all indicators disappear when response completes

**Rollback:**
- Delete `streaming-state.ts`, revert conversation card streaming wiring

**Commit after all checkpoints pass.**

---

#### Step 13: IndexedDB conversation cache {#step-13}

**Depends on:** #step-12

**Commit:** `feat(tugdeck): IndexedDB conversation cache with instant render and reconciliation`

**References:** [D07] IndexedDB for conversation cache, [D04] Message identity model, Spec S04, (#assumptions, #s04-message-identity)

**Artifacts:**
- `tugdeck/src/cards/conversation/session-cache.ts` -- IndexedDB read/write and reconciliation

**Tasks:**
- [ ] Implement `session-cache.ts`: `SessionCache` class wrapping native IndexedDB API
- [ ] Database naming: `tugdeck-<project-hash>` where project hash is derived from the project directory path (passed from tugcast via initial WebSocket handshake or query parameter)
- [ ] Object store: `messages` keyed by `msg_id`, with `seq` index for ordered iteration
- [ ] Implement `writeMessages(messages)`: debounced 1-second write of current message list
- [ ] Implement `readMessages()`: read all messages ordered by `seq` for instant rendering on page load
- [ ] Implement `reconcile(authoritative, cached)`: walk both lists in `seq` order:
  - Same `msg_id` and content: keep existing DOM node
  - Same `msg_id`, different content: update in place
  - New `msg_id` not in cache: insert at correct position
  - Cached `msg_id` not in authoritative: remove
- [ ] After reconciliation: write authoritative state to IndexedDB
- [ ] Wire into conversation card: on page load, read cache and render immediately; on watch channel delivery, run reconciliation
- [ ] Implement "Clear history" action: delete the project's IndexedDB database

**Tests:**
- [ ] Unit test: messages are written to IndexedDB and readable in `seq` order
- [ ] Unit test: reconciliation keeps matching DOM nodes unchanged
- [ ] Unit test: reconciliation updates changed messages in place
- [ ] Unit test: reconciliation inserts new messages at correct position
- [ ] Unit test: reconciliation removes messages not in authoritative list
- [ ] Unit test: "Clear history" deletes the database
- [ ] Integration test: simulate page reload with cached data, verify instant render before WebSocket connects

**Checkpoint:**
- [ ] `bun build` succeeds
- [ ] All tests pass
- [ ] Manual test: have a conversation, refresh the page, see cached messages render instantly, then verify reconciliation produces no visible change when live state arrives

**Rollback:**
- Delete `session-cache.ts`, revert conversation card cache wiring

**Commit after all checkpoints pass.**

---

#### Step 14: Session scoping and crash recovery {#step-14}

**Depends on:** #step-13

**Commit:** `feat: session scoping, crash recovery, and permission switching verification`

**References:** [D07] IndexedDB for conversation cache, [D08] Dynamic permission switching, [D09] Crash recovery, Risk R04, (#assumptions, #constraints, #d08-dynamic-permissions, #r04-crash-mid-turn)

> Session scoping and crash recovery involve distinct concerns. Split into substeps.

**Tasks:**
- [ ] Complete substep 14.1 (session scoping by project directory)
- [ ] Complete substep 14.2 (crash recovery with restart and stale UI cleanup)
- [ ] Complete substep 14.3 (dynamic permission switching verification)

**Tests:**
- [ ] All substep tests pass (see Steps 14.1, 14.2, and 14.3)

**Checkpoint:**
- [ ] `bun build && cargo build -p tugcast` succeeds after all substeps complete

##### Step 14.1: Session scoping by project directory {#step-14-1}

**Commit:** `feat(tugtalk): session scoping by project directory with .tugtool/.session`

**References:** [D07] IndexedDB for conversation cache, [D08] Dynamic permission switching, (#assumptions, #constraints)

**Artifacts:**
- Updated `tugtalk/src/session.ts` with project-directory-scoped session persistence
- Updated `tugdeck/src/cards/conversation/session-cache.ts` with project-hash database naming

**Tasks:**
- [ ] Update `session.ts`: persist session ID to `.tugtool/.session` (relative to project directory from `--dir` arg)
- [ ] On startup: read session ID from `.tugtool/.session`, attempt `resumeSession()`, fall back to new session
- [ ] Pass project directory path from tugcode -> tugcast -> tugtalk via CLI args
- [ ] Ensure IndexedDB database name uses hash of project directory path: `tugdeck-<hash>`
- [ ] Pass project directory hash from tugcast to tugdeck via query parameter or initial WebSocket message
- [ ] Verify: running tugcode in `/project-a` and `/project-b` produces independent sessions and caches

**Tests:**
- [ ] Unit test: session ID is read from and written to `.tugtool/.session`
- [ ] Unit test: different project directories produce different session IDs
- [ ] Unit test: IndexedDB databases are isolated by project hash
- [ ] Integration test: simulate two project directories, verify no cross-contamination

**Checkpoint:**
- [ ] `bun test` and `bun build` succeed
- [ ] All tests pass
- [ ] Manual test: start tugcode in two different directories, verify separate sessions

**Rollback:**
- Revert `session.ts` and `session-cache.ts` changes

**Commit after all checkpoints pass.**

---

##### Step 14.2: Crash recovery with restart and stale UI cleanup {#step-14-2}

**Depends on:** #step-14-1

**Commit:** `feat: crash recovery with auto-restart, session resume, and stale UI cleanup`

**References:** [D09] Crash recovery, Risk R04, (#r04-crash-mid-turn)

**Artifacts:**
- Updated `crates/tugcast/src/feeds/agent_bridge.rs` with crash restart and budget enforcement (from Step 2, now fully wired)
- Updated `tugdeck/src/cards/conversation-card.ts` with error banner and stale UI handling
- Updated `tugdeck/src/cards/conversation/tool-card.ts` with stale overlay
- Updated `tugdeck/src/cards/conversation/approval-prompt.ts` with stale overlay

**Tasks:**
- [ ] Implement error banner in conversation card: inline `AlertTriangle` icon + error message in `var(--destructive)` background
- [ ] On `error` event with `recoverable: true`: show banner "Conversation engine crashed. Reconnecting..."
- [ ] On successful resume: show subtle note "Session reconnected." below the error banner
- [ ] On failed resume: show divider "Previous session ended. New session started." Cached history stays visible above
- [ ] On `error` event with `recoverable: false`: show banner "Conversation engine failed repeatedly. Please restart tugcode."
- [ ] Stale UI cleanup: after crash, find all pending tool approval prompts and running tool cards
- [ ] Add visual overlay to stale cards: `AlertTriangle` icon + "Session restarted -- this request is no longer active" in `var(--muted-foreground)`
- [ ] Disable action buttons (Allow/Deny, Submit) on stale cards
- [ ] Verify crash budget: 3 crashes in 60 seconds triggers fatal error

**Tests:**
- [ ] Unit test: error banner renders with correct icon and message
- [ ] Unit test: recoverable error shows reconnecting message, then reconnected note on resume
- [ ] Unit test: non-recoverable error shows fatal message
- [ ] Unit test: stale overlay appears on pending approval prompts after crash
- [ ] Unit test: stale overlay disables Allow/Deny buttons
- [ ] Integration test: simulate tugtalk crash (agent_bridge detects exit), verify restart after 1s, session resume, stale UI cleanup

**Checkpoint:**
- [ ] `bun build` and `cargo build -p tugcast` succeed
- [ ] All tests pass
- [ ] Manual test: kill tugtalk process, observe error banner, wait for reconnect, verify stale UI elements are marked

**Rollback:**
- Revert crash recovery changes in agent_bridge, conversation-card, tool-card, approval-prompt

**Commit after all checkpoints pass.**

---

##### Step 14.3: Dynamic permission switching verification {#step-14-3}

**Depends on:** #step-14-2

**Commit:** `test: verify dynamic permission mode switching works end-to-end`

**References:** [D08] Dynamic permission switching, (#d08-dynamic-permissions)

**Artifacts:**
- Updated `tugdeck/src/cards/conversation-card.ts` with permission mode selector in card header
- Integration tests for permission switching

**Tasks:**
- [ ] Add permission mode selector to conversation card header (dropdown or button group): default, acceptEdits, bypassPermissions, plan
- [ ] On mode change: send `permission_mode` message via 0x41
- [ ] Verify: switching from `default` to `acceptEdits` causes Read/Edit/Write tools to auto-approve on next tool call
- [ ] Verify: switching to `bypassPermissions` causes all tools to auto-approve
- [ ] Verify: switching modes does not create a new session (same `session_id` before and after)
- [ ] Verify: full conversation context is preserved after mode switch

**Tests:**
- [ ] Integration test: start in `default` mode, switch to `acceptEdits`, trigger Read tool, verify auto-approved
- [ ] Integration test: switch to `bypassPermissions`, trigger Bash tool, verify auto-approved
- [ ] Integration test: switch back to `default`, trigger Bash tool, verify approval prompt appears
- [ ] Integration test: verify `session_id` is unchanged across all mode switches

**Checkpoint:**
- [ ] All integration tests pass
- [ ] `bun build` succeeds
- [ ] Manual test: switch permission modes mid-conversation, verify tool approval behavior changes correctly without session restart

**Rollback:**
- Remove permission mode selector from conversation card header

**Commit after all checkpoints pass.**

---

#### Step 14 Summary {#step-14-summary}

**Depends on:** #step-14-3

**Commit:** `test: verify session scoping, crash recovery, and permission switching integration`

**References:** [D07] IndexedDB for conversation cache, [D08] Dynamic permission switching, [D09] Crash recovery, (#d07-indexeddb-cache, #d08-dynamic-permissions, #d09-crash-recovery)

After completing Steps 14.1-14.3, the conversation system has:
- Per-project session scoping with `.tugtool/.session` and project-hashed IndexedDB
- Crash recovery with auto-restart, session resume, crash budget, and stale UI cleanup
- Dynamic permission mode switching verified end-to-end

**Tasks:**
- [ ] Verify all session management features work together

**Tests:**
- [ ] Integration test: session scoping + crash recovery + permission switching in sequence

**Checkpoint:**
- [ ] `bun build && cargo build -p tugcast` succeeds
- [ ] All session, crash recovery, and permission tests pass
- [ ] Manual test: complete end-to-end scenario with session resume, crash recovery, and permission switching

**Rollback:**
- No rollback needed (verification only)

---

#### Step 15: Default layout preset {#step-15}

**Depends on:** #step-14

**Commit:** `fix(tugdeck): layout polish and auto-focus for conversation card`

**References:** [D10] Existing CSS Grid layout, (#phase-overview, #strategy)

**Artifacts:**
- Updated `tugdeck/src/cards/conversation-card.ts` with auto-focus on page load
- Any layout CSS adjustments discovered during full-stack integration

**Tasks:**
- [ ] Ensure conversation card auto-focuses its input area on page load (textarea receives focus after WebSocket connects and card is mounted)
- [ ] Ensure terminal card remains visible (not collapsed) in the default right column
- [ ] Full-stack layout verification: start tugcode, open browser, verify all 5 cards render at correct proportions with all features from Steps 0-14 active
- [ ] Verify `LAYOUT_VERSION` 2 save/load round-trip preserves conversation card position across page reloads
- [ ] Verify `loadLayout()` edge cases: missing conversation slot in a manually-edited v2 layout (add at default), extra unknown slots (ignore gracefully)
- [ ] Fix any layout or resize issues discovered during full-stack testing (these are bugs in Step 4's implementation surfaced by integration)

**Tests:**
- [ ] Unit test: conversation card input area receives focus on mount
- [ ] Integration test: full-stack layout with all cards renders without errors

**Checkpoint:**
- [ ] `bun build && cargo build -p tugcast` succeeds
- [ ] All tests pass
- [ ] Manual test: `tugcode` launches, browser opens, conversation card is focused and ready for input, layout matches spec

**Rollback:**
- Revert auto-focus and polish changes

**Commit after all checkpoints pass.**

---

#### Step 16: End-to-end integration and acceptance {#step-16}

**Depends on:** #step-15

**Commit:** `test: end-to-end integration and acceptance tests for conversation frontend`

**References:** [D01] Agent SDK V2 with adapter layer, [D02] JSON-lines IPC, [D03] Conversation feed IDs, [D04] Message identity model, [D05] DOMPurify sanitizer, [D06] Shiki highlighting, [D07] IndexedDB cache, [D08] Dynamic permissions, [D09] Crash recovery, [D10] CSS Grid layout, [D11] IPC protocol versioning, Spec S01-S10, Table T01-T02, Risk R01-R05, (#success-criteria, #exit-criteria)

**Artifacts:**
- Integration test suite covering full conversation lifecycle
- Performance measurement scripts

**Tasks:**
- [ ] End-to-end test: user sends message -> Claude responds with text + tool use + code block -> tool completes -> turn finishes
- [ ] End-to-end test: file attachment via drag-and-drop and clipboard paste
- [ ] End-to-end test: tool approval flow (prompt appears, Allow/Deny, result rendered)
- [ ] End-to-end test: clarifying question flow (question appears, selection, submission, answer sent)
- [ ] End-to-end test: interrupt mid-turn (Ctrl-C and stop button)
- [ ] End-to-end test: page refresh with IndexedDB cache rendering + reconciliation
- [ ] End-to-end test: tugtalk crash recovery (crash, banner, restart, resume, stale UI cleanup)
- [ ] End-to-end test: permission mode switching mid-conversation
- [ ] Performance test: first message to first response token < 2 seconds
- [ ] Performance test: cached conversation render < 200ms
- [ ] Performance test: streaming text at 60fps (no dropped frames)
- [ ] Security test: XSS injection attempts in Markdown (script tags, event handlers, javascript: URLs)
- [ ] Verify all semantic tokens from Phase 5 used correctly (no hardcoded hex colors in new code)
- [ ] Verify all Lucide icons render correctly at various card sizes
- [ ] Verify IPC protocol version handshake succeeds on startup

**Tests:**
- [ ] Integration test: full conversation lifecycle (send, receive, tool use, code block, turn complete)
- [ ] Integration test: reconnect after disconnect produces consistent state
- [ ] Integration test: 100 disconnect/reconnect cycles with 0 reconciliation mismatches
- [ ] Golden test: known conversation produces expected DOM structure
- [ ] Drift prevention test: DOMPurify configuration hasn't changed (assert ALLOWED_TAGS matches the frozen allowlist from D05, FORBID_TAGS includes script/iframe/object/embed/form)

**Checkpoint:**
- [ ] `bun build && cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run` passes all Rust tests
- [ ] `bun test` passes all TypeScript tests
- [ ] All end-to-end tests pass
- [ ] All performance targets met
- [ ] All security tests pass
- [ ] Manual smoke test: complete a multi-turn conversation with tool use, code blocks, file attachments, interrupt, and permission switching

**Rollback:**
- No rollback needed (test-only step)

**Commit after all checkpoints pass.**

---

### 7.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully functional multi-turn conversational interface to Claude in tugdeck, with rich message rendering, tool visibility, session persistence, crash recovery, and security hardening.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] User can type a message in tugdeck and receive a structured Claude response with Markdown formatting and syntax-highlighted code blocks
- [ ] Tool use is visible as collapsible cards with status indicators, Lucide icons, and input/result details
- [ ] Tool approval prompts appear when required by the permission mode, with Allow/Deny buttons
- [ ] Clarifying questions render as interactive cards with radio/checkbox options
- [ ] Interrupt (Ctrl-C or stop button) cancels the current turn and preserves partial content
- [ ] Files and images can be attached via drag-and-drop, clipboard paste, or file picker
- [ ] Page refresh renders cached conversation instantly from IndexedDB before WebSocket connects
- [ ] tugtalk crash triggers auto-restart with session resume; stale UI elements are marked
- [ ] Sessions are scoped by project directory; different directories have independent sessions
- [ ] Permission modes can be switched mid-conversation without session restart
- [ ] No XSS vectors in rendered content (DOMPurify allowlist permits only safe Markdown tags, strips dangerous elements and event handlers, CSP blocks scripts)
- [ ] All rendering uses semantic tokens from Phase 5 (zero hardcoded hex colors in new code)
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run` passes all tests
- [ ] `bun test` passes all tests

**Acceptance tests:**
- [ ] Integration test: full conversation lifecycle with text, tools, code blocks, and attachments
- [ ] Integration test: 100 reconnect cycles with 0 reconciliation mismatches
- [ ] Drift prevention test: DOMPurify ALLOWED_TAGS matches the frozen allowlist from D05, CSP meta tag is present
- [ ] Golden test: known conversation input produces expected DOM output

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Conversation round-trip** {#m01-conversation-roundtrip}
- [ ] User can send a message and receive a text response from Claude (Steps 0-4)

**Milestone M02: Rich rendering** {#m02-rich-rendering}
- [ ] Markdown, code blocks, and tool cards all render correctly (Steps 5-7)

**Milestone M03: Interactive elements** {#m03-interactive-elements}
- [ ] Approvals, questions, interrupts, and attachments work (Steps 8-12)

**Milestone M04: Persistence and resilience** {#m04-persistence-resilience}
- [ ] IndexedDB cache, session scoping, and crash recovery are functional (Steps 13-14)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 8: Panel System (dockable/floating cards, tab groups, tug menu)
- [ ] Accessibility pass: keyboard navigation, screen-reader labels, contrast checks
- [ ] Conversation export and sharing
- [ ] Multi-session management within tugdeck
- [ ] Custom tool definitions beyond SDK built-ins
- [ ] Image generation and rendering in conversation
- [ ] Voice input integration

| Checkpoint | Verification |
|------------|--------------|
| Conversation round-trip | Send message, receive response, verify in browser |
| Rich rendering | Markdown, code blocks, tool cards render per spec |
| Interactive elements | Approvals, questions, interrupts, attachments functional |
| Persistence | Page refresh shows cached conversation, reconciliation works |
| Security | XSS injection tests pass, CSP and DOMPurify verified |
| Performance | First token < 2s, cache render < 200ms, streaming 60fps |

**Commit after all checkpoints pass.**
