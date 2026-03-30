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
| E4 | Tugcast WebSocket layer | Blocked on T6 | Need `--no-auth` to test full production path. |
| E5 | Session management | Partially tested | New, continue, fork tested. Picker data, concurrent sessions open. |
| E6 | Advanced patterns | Open | Background tasks, MCP, elicitation untested. |

---

## Phases

The work falls into three tiers: **prove the pipe**, **build the UI**, **add the feed layer**. Each phase is scoped to be one `/plan` → `/implement` cycle (or `/dash` for investigation phases).

```
─── TIER 1: PROVE THE PIPE ───────────────────────────────────
Phase 1: Transport Exploration    — DONE (33 tests, journal at transport-exploration.md)
Phase 2: Transport Hardening      — T1-T6 fixes

─── TIER 2: BUILD THE UI ─────────────────────────────────────
Phase 3: Core Markdown            — tug-markdown with streaming (U1, U5, U6, U7)
Phase 4: Prompt Input             — tug-prompt-input with history and slash commands (U12, U13)
Phase 5: Prompt Entry             — tug-prompt-entry, wired end-to-end (U2-U4, U8-U11, U14-U15, U19-U22)

─── TIER 3: ADD THE FEED LAYER ───────────────────────────────
Phase 6: Hook Capture             — agent lifecycle events to feed.jsonl
Phase 7: Feed Correlation         — semantic enrichment with step context
Phase 8: Feed CLI + Tugcast       — tugcode feed commands, events reach browser
Phase 9: Agent-Internal Events    — file/command detail from within agents
Phase 10: Custom Block Renderers  — rich UI for agent output
```

---

### Phase 1: Transport Exploration {#transport-exploration}

**Status: COMPLETE.** 35 tests. See [transport-exploration.md](transport-exploration.md) for full journal.

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

**Goal:** Fix T1-T6. Make the transport reliable enough to build UI on.

**Inputs:** Phase 1 findings.

**Work:** Items T1-T6 from the action items table above. Prioritized:
1. T1 (fix `--plugin-dir`) — tiny, unblocks all skill invocation
2. T2 (synthetic text forwarding) — small, unblocks built-in skill output
3. T3 (`api_retry` forwarding) — small, enables retry indicators
4. T6 (`--no-auth`) — small, unblocks WebSocket testing
5. T4 (process lifecycle) — medium, prevents zombie accumulation
6. T5 (session readiness) — medium, enables clean session management

**Exit criteria:**
- All tugplug skills visible in `system_metadata.skills` and invocable via `user_message`
- Built-in skill commands (`/cost`, `/compact`) produce text output through tugtalk
- `api_retry` events forwarded
- No orphaned tugtalk processes after app quit
- End-to-end tugcast WebSocket path verified (via `--no-auth`)

**Outputs:** Hardened tugcast/tugtalk.

---

### Phase 3: Core Markdown {#core-markdown}

**Goal:** tug-markdown component with streaming support. Addresses U1, U5, U6, U7.

**Inputs:** Phase 2 (solid transport). `assistant_text` delta model from Phase 1.

**Work:**
- Token-level rendering: `marked.lexer()` → keyed React elements per block.
- Streaming via `PropertyStore<string>` [L02] with rAF throttle. Accumulate deltas (U1). Streaming cursor (U5).
- Thinking block rendering (U6): collapsible `thinking_text` events.
- Tool use display (U7): `tool_use` → `tool_result` → `tool_use_structured`.
- TugCodeBlock: Shiki with tug theme, copy-to-clipboard, language label, line numbers, collapse/expand.
- `--tugx-md-*` token aliases. `@tug-pairings` per [L16, L19].
- `tug-*` custom block extension point.
- Gallery card.

**Exit criteria:**
- All standard GFM markdown renders correctly
- Simulated streaming at 60fps, no jank for 5000+ words
- Code blocks highlighted, copy works
- Laws compliance: [L02, L06, L10, L16, L19, L20]

---

### Phase 4: Prompt Input {#prompt-input}

**Goal:** tug-prompt-input with history and slash commands. Addresses U12, U13.

**Inputs:** TugTextarea auto-resize. `system_metadata` slash command data.

**Work:**
- Enhanced `<textarea>`, 1 row default, grows to maxRows (8). [L06].
- Keyboard: Enter submit, Shift+Enter newline, Cmd+Enter submit. IME-safe.
- `PromptHistoryStore`: IndexedDB, per-card, `useSyncExternalStore` [L02].
- Slash command popup (U12): merge `system_metadata.slash_commands` + `.skills`, `@floating-ui/react`.
- `@` file completion (U13): detect `@`, file picker, inject content.
- Gallery card.

**Exit criteria:**
- Submit, history navigation, prefix search, slash popup, `@` completion all work
- CJK input works

---

### Phase 5: Prompt Entry {#prompt-entry}

**Goal:** tug-prompt-entry wired end-to-end. Addresses U2, U3, U4, U8, U9, U10, U11, U14, U15.

**Inputs:** tug-markdown (Phase 3), tug-prompt-input (Phase 4), hardened transport (Phase 2).

**Work:**
- Compose prompt input + submit/stop button + utility row.
- Wire to CodeOutput/CodeInput: submit sends `user_message`, stop sends `interrupt` (U4).
- Permission dialog (U2): `control_request_forward` with `is_question: false`.
- AskUserQuestion dialog (U3): `control_request_forward` with `is_question: true`.
- Subagent activity display (U8).
- Model switcher (U9), permission mode switcher (U10), cost display (U11).
- Session handling (U14), image attachments (U15).
- Gallery card + live integration test.

**Exit criteria:**
- Full round-trip: type prompt → streamed markdown response
- Slash commands invoke skills
- Permission and question dialogs work
- Interrupt stops streaming

---

### Phases 6-10: Feed Layer

See earlier sections of this document for full details. Summary:

| Phase | Goal | Scope |
|-------|------|-------|
| 6. Hook Capture | Agent lifecycle → `raw-events.jsonl` | Shell scripts + hooks.json |
| 7. Feed Correlation | Semantic enrichment → `feed.jsonl` | Correlation logic |
| 8. Feed CLI + Tugcast | `tugcode feed` + browser delivery | Rust CLI + tugcast feed |
| 9. Agent-Internal Events | File/command detail | Agent frontmatter hooks |
| 10. Custom Block Renderers | Rich agent output UI | React components |

---

## Driving Plans with `/plan` and `/implement`

| Phase | Approach | Estimated Steps |
|-------|----------|-----------------|
| 1 | ~~`/dash` (investigation)~~ DONE | — |
| 2 | `/plan` + `/implement` | 3-4 |
| 3 | `/plan` + `/implement` | 4-5 |
| 4 | `/plan` + `/implement` | 4-5 |
| 5 | `/plan` + `/implement` | 3-4 |
| 6-10 | `/plan` + `/implement` each | 2-5 each |

---

## Deferred

- **tug-rich-text** — Monaco editor wrapper. Future group.
- **tug-search-bar** — TugInput + TugButton. Future group.
- **Tiptap migration** for tug-prompt-input (@-mentions, ghost text). Future.
- **Mermaid, KaTeX** — tug-markdown extensions via the extension point. When needed.

---

## Risks

1. **Feed hook parsing fragility.** Orchestrator prompts are natural language with embedded JSON.
2. **Shell script overhead on high-frequency hooks.** ~50ms per invocation. Monitor in Phase 9.
3. **Hooks visibility gap (E3).** Hooks run silently — UI blind to hook decisions. May need tugtalk changes.
4. **Tugcast WebSocket unknowns (E4).** Binary framing, reconnection, bootstrap for conversations untested until T6.

---

## Resolved Questions

1. **Shiki theme** — Hand-authored file referencing `--tug-syntax-*` CSS custom properties.
2. **History scope** — Per-card via `historyKey`. No global cross-card history for now.
3. **Slash command extensibility** — Declarative list from `system_metadata`. No registration system.
4. **Streaming text model** — Deltas on partials, full text on complete. UI accumulates.
5. **Slash command invocation** — Works via `user_message`. Fix `--plugin-dir` (T1) + synthetic text (T2).
6. **Custom block renderers** — Extension point in Phase 3, individual blocks in Phase 10.
7. **tug-rich-text / tug-search-bar** — Deferred from Group D.
