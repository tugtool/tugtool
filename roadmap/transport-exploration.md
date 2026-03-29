# Transport Exploration — Phase 1 Findings

*Live document. Updated as we probe the tugcast/tugtalk transport.*

**Date:** 2026-03-29
**Method:** Direct tugtalk probing via `tugtalk/probe.ts` — bypasses tugcast, connects to tugtalk's stdin/stdout JSON-lines protocol. 33 tests completed.

---

**Action items live in [tug-conversation.md](tug-conversation.md)** — items T1-T6 (transport fixes), U1-U18 (UI work), C1-C15 (terminal-only commands), E1-E6 (exploration areas). This document is the exploration journal.

---

## Setup

Tugtalk spawns Claude Code as a subprocess with `--output-format stream-json --input-format stream-json --verbose --permission-prompt-tool stdio --include-partial-messages --replay-user-messages`. Communication is JSON-lines over stdin (inbound) and stdout (outbound). Stderr carries tugtalk's own logs.

---

## Test 1: Basic Round-Trip

**Sent:** `{ type: "user_message", text: "Say hello in exactly 5 words." }`

**Event sequence:**
1. `protocol_ack` — `{ version: 1, session_id: "pending", ipc_version: 2 }`
2. `session_init` — `{ session_id: "05086f97-..." }`
3. `system_metadata` — rich object (see below)
4. `assistant_text` — partial, 5 chars: `"Hello"`
5. `assistant_text` — partial, 20 chars: `"Hello there, how are you?"`
6. `cost_update` — `$0.0642`, 1 turn
7. `assistant_text` — complete, 25 chars (full text)
8. `turn_complete` — `{ msg_id, seq: 2, result: "success" }`

**Findings:**
- Round-trip works. Send `user_message`, get streamed `assistant_text` events back.
- Short response produced only 2 partials. Batching is coarse for small outputs.

---

## Test 2: Longer Response (Streaming Behavior)

**Sent:** `{ type: "user_message", text: "Write a short paragraph (about 100 words) explaining why the sky is blue." }`

**Event sequence:**
1. `system_metadata`
2. `thinking_text` — partial, delta: `"The user is asking me to write a short paragraph explaining why the sky is blue. This is a general knowledge question, not related to the"`
3. `thinking_text` — partial, delta: `" codebase."`
4. `assistant_text` — partial (6 chunks, ~100-140 chars each)
5. `cost_update` — `$0.0263`
6. `assistant_text` — complete, 634 chars (full text)
7. `turn_complete`

**Findings:**

### Streaming text model: DELTAS for partials, FULL TEXT for complete

- **Partial events:** `text` field contains a **delta** (new chunk only), not accumulated text. Lengths: 134, 102, 144, 116, 120, 18 — these are chunk sizes, not growing totals.
- **Complete event:** `text` field contains the **full accumulated text** (634 chars).
- **Implication for tug-markdown:** Must accumulate deltas in a buffer during streaming. Can verify/replace with the full text from the complete event.

### `thinking_text` is a separate event type

- Arrives before `assistant_text` when extended thinking is active.
- Same delta model as `assistant_text` partials.
- Same `msg_id` as the subsequent `assistant_text` events.
- Fields: `type`, `msg_id`, `seq`, `text` (delta), `is_partial`, `status`.
- This is the data source for a `tug-thinking` collapsible block.

### Streaming frequency

- 6 partial events for ~634 chars ≈ one partial per ~100 chars.
- At typical LLM output speeds (~50 tokens/sec), this means roughly 1-2 events per second.
- Comfortable for rAF-throttled rendering — no need for aggressive batching.

### Event ordering

`system_metadata` → `thinking_text` (partials) → `assistant_text` (partials) → `cost_update` → `assistant_text` (complete) → `turn_complete`

---

## Test 3: Slash Command — `/cost`

**Sent:** `{ type: "user_message", text: "/cost" }`

**Event sequence:**
1. `system_metadata`
2. `cost_update` — `$0.0000`, 15 turns
3. `turn_complete`

**Findings:**
- Slash commands work — `/cost` is interpreted as a command, not sent to Claude.
- **No `assistant_text` at all.** The formatted cost table shown in the terminal is not exposed as text in stream-json mode.
- The structured data (`cost_update`) is available, but the UI must render its own display.

---

## Test 4: Slash Command — `/status`

**Sent:** `{ type: "user_message", text: "/status" }`

**Event sequence:**
1. `system_metadata`
2. `cost_update` — `$0.0000`, 16 turns
3. `turn_complete`

**Findings:**
- Same pattern as `/cost` — no text output, only structured events.
- Status information (model, session, context) is already in `system_metadata` sent on every turn.
- **Slash commands that produce terminal-rendered UI produce no text events in stream-json mode.** The graphical UI must render its own status/cost displays from structured data.

---

## Test 5: Tool Use (Read File)

**Sent:** `{ type: "user_message", text: "Read the first 3 lines of CLAUDE.md and tell me what they say." }`

**Event sequence:**
1. `system_metadata`
2. `tool_use` — partial: `{ tool_name: "Read", tool_use_id: "toolu_01Lva...", input: {} }`
3. `tool_use` — complete: `{ ..., input: { file_path: "/Users/.../CLAUDE.md", limit: 3 } }`
4. `tool_result` — `{ tool_use_id: "toolu_01Lva...", output: "1\t# Claude Code Guidelines...", is_error: false }`
5. `tool_use_structured` — `{ tool_use_id: "toolu_01Lva...", structured_result: { type: "text", file: { filePath, content, numLines, startLine, totalLines } } }`
6. `assistant_text` — partials (3 chunks)
7. `cost_update` — `$0.0519`
8. `assistant_text` — complete
9. `turn_complete`

**Findings:**

### `tool_use` streams incrementally

- First event has `input: {}` (empty — tool call is being constructed).
- Second event has full `input: { file_path, limit }`.
- Same `tool_use_id` on both. UI can show "Reading..." on the first, populate details on the second.

### `tool_result` vs `tool_use_structured`

- `tool_result`: simple `output` string + `is_error` boolean. The text representation.
- `tool_use_structured`: rich typed data. For Read, includes `file` object with `filePath`, `content`, `numLines`, `startLine`, `totalLines`.
- Both share the same `tool_use_id` for correlation.
- **`tool_use_structured` is the data source for rich custom block renderers.** The structured result has typed fields the UI can render meaningfully (file viewer, diff view, etc.).

### Tool event ordering

`tool_use` (partial) → `tool_use` (complete) → `tool_result` → `tool_use_structured` → `assistant_text`

---

## Event Type Catalog (Observed So Far)

| Event | When | Key Fields | Text? |
|-------|------|-----------|-------|
| `protocol_ack` | After handshake | `version`, `session_id`, `ipc_version` | No |
| `session_init` | After claude spawns | `session_id` | No |
| `system_metadata` | Start of every turn | tools, model, slash_commands, plugins, agents, skills, mcp_servers, version, permissionMode | No |
| `thinking_text` | Before response | `msg_id`, `seq`, `text` (delta), `is_partial`, `status` | Yes (thinking) |
| `assistant_text` | During response | `msg_id`, `seq`, `text` (delta on partial, full on complete), `is_partial`, `status` | Yes (response) |
| `tool_use` | Tool invoked | `msg_id`, `seq`, `tool_name`, `tool_use_id`, `input` (streams empty→full) | No |
| `tool_result` | Tool completed | `tool_use_id`, `output` (text), `is_error` | No |
| `tool_use_structured` | Tool completed | `tool_use_id`, `tool_name`, `structured_result` (typed) | No |
| `cost_update` | Near end of turn | `total_cost_usd`, `num_turns` | No |
| `turn_complete` | End of turn | `msg_id`, `seq`, `result` | No |

---

## `system_metadata` Fields

Sent at the start of every turn. Contains everything the UI needs for chrome/status:

```json
{
  "type": "system_metadata",
  "session_id": "05086f97-...",
  "cwd": "/Users/kocienda/Mounts/u/src/tugtool",
  "tools": ["Task", "AskUserQuestion", "Bash", "Edit", "Glob", "Grep", "Read", "Write", ...],
  "model": "claude-opus-4-6",
  "permissionMode": "acceptEdits",
  "slash_commands": ["update-config", "debug", "simplify", "batch", "loop", "schedule", "claude-api", "commit", ...],
  "plugins": [{ "name": "tugtool", "path": "...", "source": "tugtool@inline" }],
  "agents": ["general-purpose", "statusline-setup", "Explore", "Plan", "claude-code-guide"],
  "skills": ["update-config", "debug", "simplify", "batch", "loop", "schedule", "claude-api", "commit"],
  "mcp_servers": [{ "name": "claude.ai Gmail", "status": "needs-auth" }, ...],
  "version": "2.1.87",
  "output_style": "default",
  "fast_mode_state": "off",
  "apiKeySource": "ANTHROPIC_API_KEY",
  "ipc_version": 2
}
```

**Note:** `slash_commands` here are Claude Code built-ins + plugin-contributed commands. Tugplug skills (`/plan`, `/implement`, `/merge`, `/dash`) are NOT in this list — they appear as entries in `skills` without the `/` prefix. The UI needs to merge both sources for the slash command popup.

---

## Process Management Issue

**Found before any messages were sent.** After ~2 weeks of use, 137 orphaned tugtalk (bun) processes were running. Tugcast exits when the app quits, but its child tugtalk processes are not killed — they become orphans and accumulate indefinitely.

**Root cause:** No process group management. Tugcast spawns tugtalk but doesn't SIGTERM children on shutdown. Card close doesn't kill the associated tugtalk.

**Added to Phase 2 (Transport Hardening) work list.**

---

## Test 6: Interrupt Mid-Stream

**Sent:** Long essay prompt, then `{ type: "interrupt" }` after 3 partial events.

**Event sequence:**
1. `thinking_text` — partial
2. `assistant_text` — 3 partials (~277 chars total)
3. **>>> `interrupt` sent**
4. `cost_update` — `$0.0000`
5. `assistant_text` — complete, 277 chars (the accumulated partial text)
6. `turn_complete` — `{ result: "error" }` ← not "cancelled"!

**Findings:**
- **Interrupt works quickly.** Generation stops after the next chunk boundary.
- **No `turn_cancelled` event.** Instead, `turn_complete` fires with `result: "error"`.
- **The final complete event still arrives.** It contains the accumulated text up to the interrupt point, with `is_partial: false, status: "complete"`. The text isn't lost.
- **Tugtalk logs:** `"Interrupting current turn via control_request interrupt"` → receives `control_response` with `subtype: "success"`.
- **Implication for UI:** Listen for `turn_complete` with `result: "error"` as the interrupt signal. Don't wait for a separate `turn_cancelled` event — it doesn't exist.

---

## Test 7: Multiple Tool Calls in One Turn

**Sent:** `"Read the first line of CLAUDE.md and the first line of package.json in tugdeck/. Tell me both."`

**Event sequence:**
1. `tool_use` — partial: Read, `input: {}`
2. `tool_use` — complete: Read, `input: { file_path: "CLAUDE.md", limit: 1 }`
3. `tool_use` — partial: Read #2, `input: {}`
4. `tool_result` — first Read result
5. `tool_use_structured` — first Read structured result
6. `tool_use` — complete: Read #2, `input: { file_path: "tugdeck/package.json", limit: 1 }`
7. `tool_result` — second Read result
8. `tool_use_structured` — second Read structured result
9. `assistant_text` — 3 partials + complete
10. `turn_complete`

**Findings:**
- **Multiple tool calls interleave.** Tool use #2's partial arrives before tool #1's result. The tools run concurrently.
- **Each tool has its own `tool_use_id`** for correlation. The UI can track them independently.
- **Tool events and results interleave.** Don't assume all `tool_use` events arrive before any `tool_result` events.

---

## Test 8: Tool Error (Nonexistent File)

**Sent:** `"Read the file /nonexistent/path/that/does/not/exist.txt"`

**Event sequence:**
1. `tool_use` — partial then complete: Read with nonexistent path
2. `control_request_forward` — **new event type!**

```json
{
  "type": "control_request_forward",
  "request_id": "05f295db-...",
  "tool_name": "Read",
  "input": { "file_path": "/nonexistent/path/that/does/not/exist.txt" },
  "decision_reason": "Path is outside allowed working directories",
  "permission_suggestions": [{
    "type": "addRules",
    "rules": [{ "toolName": "Read", "ruleContent": "//nonexistent/path/that/does/not/**" }],
    "behavior": "allow",
    "destination": "session"
  }],
  "tool_use_id": "toolu_018QZXCEb...",
  "is_question": false
}
```

**Findings:**
- **Permission denial is a `control_request_forward`, not a `tool_result` with `is_error: true`.**
- This event requires a response — the UI must either approve or deny. Without a response, the turn hangs.
- `decision_reason` explains why: "Path is outside allowed working directories".
- `permission_suggestions` offers what rules to add to allow it.
- `is_question: false` means this is a permission gate, not a clarifying question.
- **This is the tool approval flow.** The event name is `control_request_forward`, not `tool_approval_request` or `permission_request` as we assumed in the roadmap.

---

## Test 9: Bash Tool Call (Auto-Approved)

**Sent:** `"Run this bash command: echo 'hello from bash'"`

**Event sequence:**
1. `tool_use` — Bash, `input: { command: "echo 'hello from bash'", description: "..." }`
2. `tool_result` — `output: "hello from bash"`, `is_error: false`
3. `tool_use_structured` — `{ stdout: ..., stderr: ..., interrupted: ..., isImage: ..., noOutputExpected: ... }`
4. `assistant_text` + `turn_complete`

**Findings:**
- Bash auto-approved in `acceptEdits` mode — no permission prompt.
- `tool_use_structured` for Bash has rich fields: `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`.
- The `tool_result.output` is the plain text output; `tool_use_structured.structured_result` has the separated stdout/stderr.

---

## Test 10: Long Streaming (300 Words)

**Sent:** `"Write exactly 300 words about the history of the internet. Count carefully."`

**Results:** 24 partial events + 1 complete over 13.4 seconds. Total text: 2174 chars.

**Streaming frequency analysis:**

| Metric | Value |
|--------|-------|
| Partial events | 24 |
| Total time | 13.4s |
| Events/second | ~1.8 |
| Avg chunk size | ~90 chars |
| Min chunk size | 33 chars |
| Max chunk size | 125 chars |
| Total text length | 2174 chars |

**Findings:**
- **~2 events per second** during active streaming. Comfortable for UI rendering.
- **Chunk sizes vary** from 33 to 125 chars. Not fixed-size; depends on LLM token boundaries.
- **`thinking_text` arrives first** (single partial in this case), then all `assistant_text` partials, then `cost_update`, then the final complete, then `turn_complete`.
- At 2 events/sec, rAF throttling (16ms) is overkill — the events are already slower than frame rate. Simple re-render on each partial would work fine.

---

## Updated Event Type Catalog

| Event | When | Key Fields | Notes |
|-------|------|-----------|-------|
| `protocol_ack` | After handshake | `version`, `session_id`, `ipc_version` | `session_id` is `"pending"` initially |
| `session_init` | After claude spawns | `session_id` | Real session ID |
| `system_metadata` | Start of every turn | tools, model, slash_commands, plugins, agents, skills, mcp_servers, version | Slash command list source for UI |
| `thinking_text` | Before response | `msg_id`, `seq`, `text` (delta), `is_partial`, `status` | Extended thinking content |
| `assistant_text` | During response | `msg_id`, `seq`, `text` (delta on partial, full on complete), `is_partial`, `status` | Main response content |
| `tool_use` | Tool invoked | `msg_id`, `seq`, `tool_name`, `tool_use_id`, `input` | Streams: empty input → full input |
| `tool_result` | Tool completed | `tool_use_id`, `output` (text), `is_error` | Plain text result |
| `tool_use_structured` | Tool completed | `tool_use_id`, `structured_result` | Rich typed data (file, bash, etc.) |
| `control_request_forward` | Permission needed | `request_id`, `tool_name`, `input`, `decision_reason`, `permission_suggestions`, `is_question` | **Not** `tool_approval_request` |
| `cost_update` | Near end of turn | `total_cost_usd`, `num_turns` | |
| `turn_complete` | End of turn | `msg_id`, `seq`, `result` | `result` is `"success"` or `"error"` (includes interrupt) |

---

## Test 11: Permission Approval Round-Trip (Deny)

**Sent:** `"Read the file /nonexistent/file.txt"` with auto-DENY

**Event sequence:**
1. `tool_use` — Read, partial then complete
2. `control_request_forward` — `{ tool_name: "Read", decision_reason: "Path is outside allowed working directories", is_question: false }`
3. **>>> `tool_approval` sent:** `{ type: "tool_approval", request_id: "...", decision: "deny", message: "Denied by probe script" }`
4. `tool_result` — `{ is_error: true, output: "Denied by probe script" }`
5. `tool_use_structured` — `type: unknown`
6. `assistant_text` — Claude explains the file doesn't exist
7. `turn_complete` — `result: "success"`

**Findings:**
- **Permission round-trip works.** UI sends `tool_approval` (not `control_response`), tugtalk translates to `control_response` for Claude.
- **Inbound format for permissions:** `{ type: "tool_approval", request_id, decision: "allow" | "deny", updatedInput?, message? }`
- **Inbound format for questions:** `{ type: "question_answer", request_id, answers: { key: value } }`
- On deny, `tool_result` arrives with `is_error: true` and the deny message as output.
- Claude handles the denial gracefully — explains the failure to the user.

---

## Test 12: Slash Commands — `/compact`, `/model`

**`/compact`:** 6.2 seconds to compact (session had 48 turns from probing). Events: `system_metadata` → `cost_update` → `turn_complete`. No text.

**`/model`:** Instant. Same pattern — no text, no interactive picker in stream-json mode.

**Finding:** Slash commands that are interactive in the terminal (model picker, etc.) produce no interactive events in stream-json mode. The graphical UI must build its own pickers and send the corresponding inbound messages directly:
- Model change: `{ type: "model_change", model: "claude-sonnet-4-6" }`
- Permission mode: `{ type: "permission_mode", mode: "acceptEdits" }`
- Session commands: `{ type: "session_command", command: "fork" | "continue" | "new" }`

---

## `control_request_forward` — The Unified Gate Event

This is the single most important event for UI interaction beyond text streaming. It handles **both** permission requests and `AskUserQuestion` calls through one event type:

```json
{
  "type": "control_request_forward",
  "request_id": "uuid",
  "tool_name": "Read" | "Bash" | "AskUserQuestion" | ...,
  "input": { /* tool input or question definitions */ },
  "decision_reason": "string | undefined",
  "permission_suggestions": [{ "type": "addRules", "rules": [...], "behavior": "allow" }],
  "tool_use_id": "toolu_...",
  "is_question": false | true,
  "ipc_version": 2
}
```

**Dispatching logic for the UI:**

| `is_question` | `tool_name` | UI Action | Response Type |
|---------------|-------------|-----------|---------------|
| `false` | any tool | Show permission dialog (tool name, input, reason) | `tool_approval` |
| `true` | `AskUserQuestion` | Show question UI (from `input` questions) | `question_answer` |

**Permission response:** `{ type: "tool_approval", request_id, decision: "allow" | "deny", updatedInput?, message? }`

**Question response:** `{ type: "question_answer", request_id, answers: { questionKey: "answer" } }`

---

## Inbound Message Types (UI → Tugtalk)

Complete catalog of messages the UI can send:

| Type | Purpose | Key Fields |
|------|---------|-----------|
| `protocol_init` | Handshake | `version: 1` |
| `user_message` | Send prompt | `text`, `attachments[]` |
| `tool_approval` | Answer permission prompt | `request_id`, `decision`, `updatedInput?`, `message?` |
| `question_answer` | Answer AskUserQuestion | `request_id`, `answers: {}` |
| `interrupt` | Stop current turn | (no fields) |
| `permission_mode` | Change permission mode | `mode: "default" \| "acceptEdits" \| "bypassPermissions" \| ...` |
| `model_change` | Switch model | `model: "claude-opus-4-6" \| "claude-sonnet-4-6" \| ...` |
| `session_command` | Session management | `command: "fork" \| "continue" \| "new"` |
| `stop_task` | Stop a running task | `task_id` |

---

## Key Protocol Corrections (vs. Roadmap Assumptions)

1. **Permission AND question events are both `control_request_forward`.** Differentiated by `is_question` flag. The roadmap assumed separate `tool_approval_request` and `question` event types — there's one unified event.

2. **Interrupt produces `turn_complete` with `result: "error"`, not `turn_cancelled`.** There is no `turn_cancelled` event type.

3. **`assistant_text` partials are deltas, not accumulated text.** The complete event has full text. UI must accumulate.

4. **Slash commands produce no `assistant_text`.** The UI must render its own displays from structured events (`system_metadata`, `cost_update`).

5. **Tool events interleave with concurrent calls.** Don't assume sequential tool_use → tool_result ordering across different tool_use_ids.

6. **Interactive terminal features (model picker, status display) have no stream-json equivalent.** The UI must build its own UI and send `model_change`, `permission_mode`, `session_command` messages directly.

7. **`system_metadata` is the slash command source.** Contains `slash_commands[]` (Claude Code built-ins) and `skills[]` (plugin-contributed). Both should be merged for the prompt input's slash command popup.

---

## Test 13: Session Command — New Session

**Sent:** `{ type: "session_command", command: "new" }` after initial handshake, then a user message.

**Event sequence:**
1. `session_init` — original session `05086f97...`
2. **>>> `session_command: new` sent**
3. `error` — `"Claude process stream ended unexpectedly"` (recoverable: true)
4. Tugtalk respawns claude: `--permission-mode acceptEdits` (no `--resume` — fresh session)
5. `session_init` — new session, but `session_id: "pending"`
6. **>>> `user_message` sent** (too early!)
7. Timeout — new process not ready

**Findings:**
- **`session_command: "new"` kills the current claude process and spawns a new one.** The old stream ends, which produces a recoverable `error` event.
- **The new session emits `session_init` with `session_id: "pending"` before it's fully ready.** A second `session_init` with the real session ID presumably comes later, but the probe timed out before seeing it.
- **The UI must wait for `session_init` with a non-`"pending"` session_id before sending messages.** Sending too early causes the message to be lost.
- **This is a transport gap:** The readiness signal after a session command is unclear. The UI needs a definitive "new session ready" event.
- **Added to Phase 2 work list:** Session command readiness signaling.

---

## `AskUserQuestion` Flow (Documented from Code, Not Yet Tested Live)

From reading `tugtalk/src/session.ts` and `tugtalk/src/control.ts`:

When an agent calls `AskUserQuestion`, it arrives as `control_request_forward` with:
- `is_question: true`
- `tool_name: "AskUserQuestion"`
- `input` contains the question definitions (from the agent's `AskUserQuestion` tool call)

The UI responds with:
```json
{
  "type": "question_answer",
  "request_id": "the-request-id-from-control_request_forward",
  "answers": { "question_key": "selected answer" }
}
```

Tugtalk translates this into a `control_response` with `behavior: "allow"` and the answers nested in `updatedInput.answers`. This hasn't been tested end-to-end yet — it would require running a `/plan` skill that triggers the clarifier agent.

---

## Updated Event Type Catalog (Final)

### Outbound Events (Tugtalk → UI)

| Event | When | Key Fields | Response Required? |
|-------|------|-----------|-------------------|
| `protocol_ack` | After handshake | `version`, `session_id`, `ipc_version` | No |
| `session_init` | After claude spawns | `session_id` (may be `"pending"`) | No (but wait for non-pending before sending) |
| `system_metadata` | Start of every turn | tools, model, slash_commands, skills, plugins, agents, mcp_servers, version, permissionMode | No |
| `thinking_text` | Before response | `msg_id`, `seq`, `text` (delta), `is_partial`, `status` | No |
| `assistant_text` | During response | `msg_id`, `seq`, `text` (delta on partial, full on complete), `is_partial`, `status` | No |
| `tool_use` | Tool invoked | `msg_id`, `seq`, `tool_name`, `tool_use_id`, `input` | No |
| `tool_result` | Tool completed | `tool_use_id`, `output`, `is_error` | No |
| `tool_use_structured` | Tool completed | `tool_use_id`, `structured_result` (typed) | No |
| `control_request_forward` | Permission or question | `request_id`, `tool_name`, `input`, `decision_reason`, `is_question` | **YES** — `tool_approval` or `question_answer` |
| `cost_update` | Near end of turn | `total_cost_usd`, `num_turns` | No |
| `turn_complete` | End of turn | `msg_id`, `seq`, `result` (`"success"` or `"error"`) | No |
| `error` | Error occurred | `message`, `recoverable` | No |

### Inbound Messages (UI → Tugtalk)

| Type | Purpose | Key Fields |
|------|---------|-----------|
| `protocol_init` | Handshake | `version: 1` |
| `user_message` | Send prompt | `text`, `attachments: []` |
| `tool_approval` | Answer permission | `request_id`, `decision: "allow"\|"deny"`, `updatedInput?`, `message?` |
| `question_answer` | Answer question | `request_id`, `answers: { key: value }` |
| `interrupt` | Stop turn | *(empty)* |
| `permission_mode` | Change mode | `mode` |
| `model_change` | Switch model | `model` |
| `session_command` | Session mgmt | `command: "fork"\|"continue"\|"new"` |
| `stop_task` | Stop a task | `task_id` |

---

## Key Architectural Insights for UI Design

1. **The UI is a state machine driven by outbound events.** Each event transitions the UI: idle → streaming (on first `assistant_text` partial), streaming → idle (on `turn_complete`), idle → awaiting-permission (on `control_request_forward`), etc.

2. **`system_metadata` populates the chrome.** Model name, slash commands, skills, permission mode, tool list — all come from this one event. The UI should cache it and update on each turn.

3. **Tool calls are observable.** `tool_use` → `tool_result` → `tool_use_structured` gives the UI everything it needs to show what tools Claude is using, with rich structured data for custom renderers.

4. **Permission and question UIs are the same gate.** One event type (`control_request_forward`), two response types. The `is_question` flag dispatches.

5. **Text accumulation is the UI's job.** Partials are deltas. The UI accumulates them into a buffer for rendering. The final `complete` event provides the full text for verification/replacement.

6. **Slash commands are passthrough.** Send as `user_message` text starting with `/`. Claude Code handles routing. No special handling needed on the UI side.

7. **Interactive commands need custom UI.** `/model`, `/status`, `/cost` produce no text. The UI must build pickers/displays and send `model_change`, etc. directly.

---

## Findings from Claude Code Documentation Research

Comprehensive review of code.claude.com docs. Key items that affect the transport and UI:

### Stream-JSON Event Types (from docs, not yet observed in probes)

- **`stream_event`** — wraps raw Anthropic API streaming deltas. Contains `.event.delta.type == "text_delta"` with `.event.delta.text` for token-by-token text. We haven't seen this in our probes — tugtalk may be translating these into `assistant_text` events before forwarding.
- **`system` with `subtype: "api_retry"`** — emitted on retryable API errors. Fields: `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error` (type: `authentication_failed`, `billing_error`, `rate_limit`, etc.). The UI should show retry status.
- **`system` with `subtype: "compact_boundary"`** — emitted during compaction. Contains `compactMetadata: { trigger: "auto"|"manual", preTokens }`.

### Permission Modes (affects tool approval flow)

| Mode | Auto-approved | Needs prompt |
|------|--------------|-------------|
| `default` | Read only | Everything else |
| `acceptEdits` | Read + edit files | Bash, WebFetch, etc. |
| `plan` | Read only (no edits) | Everything else |
| `auto` | All + classifier checks | Classifier-blocked actions |
| `bypassPermissions` | Everything | Nothing |
| `dontAsk` | Pre-approved only | Nothing (auto-deny rest) |

**Mode cycling:** `Shift+Tab` cycles `default` → `acceptEdits` → `plan` → `auto`. The UI should support this.

### Tools Requiring Permission (must render approval UI)

Bash, Edit, Write, NotebookEdit, ExitPlanMode, Skill, WebFetch, WebSearch, PowerShell

### Tools Auto-Approved (no prompt needed)

Agent, AskUserQuestion, CronCreate/Delete/List, EnterPlanMode, EnterWorktree, ExitWorktree, Glob, Grep, Read, TaskCreate/Get/List/Update/Stop, TodoWrite, ToolSearch

### Session Resume Behavior

- Full message history restored, tool state preserved
- **Session-scoped permissions are NOT restored** — must re-approve
- Model and config from original session preserved
- `--fork-session` creates new session ID but preserves history (original unchanged)
- Multiple terminals on same session: messages interleave, each sees only its own during session

### AskUserQuestion in Non-Interactive Mode

- In `-p` (print) mode: AskUserQuestion fails by default (no user)
- Can be handled via `PreToolUse` hook matching `AskUserQuestion` — return `permissionDecision: "allow"` with `updatedInput` containing `answers`
- **Background subagents auto-fail on AskUserQuestion** — only foreground subagents pass through to user
- This confirms our code reading: `control_request_forward` with `is_question: true` is the mechanism

### Compaction Details

- Auto at ~95% capacity (configurable via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`)
- CLAUDE.md files survive (re-read from disk)
- **Skill descriptions do NOT survive compaction** — skills reload on next invocation
- Clears older tool outputs first, then summarizes conversation

### Context Window Load Order

1. System prompt (~4,200 tokens)
2. Auto memory MEMORY.md (~680 tokens)
3. Environment info (~280 tokens)
4. MCP tools deferred (~120 tokens)
5. Skill descriptions (~450 tokens) — NOT re-injected after compact
6. User CLAUDE.md files (~2,100 tokens)
7. User prompts and tool results

**~20% of window used at startup before any user interaction.** Important for token counting UI.

### Subagent Details

- Cannot spawn other subagents (no recursion)
- Background subagents get permissions pre-approved at spawn; auto-deny anything else
- Only summary text returns to parent context (not full file reads)
- Auto-compaction at ~95% capacity
- Configurable: model, tools, permissions, hooks, MCP servers, skills, memory, isolation, effort, background

### Plan Mode Workflow

Claude researches → presents plan → user chooses:
- (a) approve + auto mode
- (b) approve + acceptEdits
- (c) approve + manual review
- (d) keep planning

Each option can clear planning context. The UI should present these choices when plan mode is active.

---

## Phase 2 Work Items (Accumulated)

### Transport Fixes (tugcast/tugtalk code changes)

1. **Process lifecycle management.** Tugtalk processes outlive tugcast. 137 zombies after 2 weeks. Tugcast must SIGTERM children on shutdown and use process groups. Card close must kill associated tugtalk.
2. **Session command readiness.** After `session_command: "new"` or `"fork"`, `session_init` fires with pending ID before new process is ready. Need clear readiness signal.
3. **`api_retry` event forwarding.** Tugtalk drops these. Add forwarding in `routeTopLevelEvent`. Audit for other dropped `system` subtypes.
4. **`--no-auth` CLI flag for tugcast.** Skip session cookie and origin validation for local development/testing. Needed to test the full WebSocket path.
5. **Slash command invocation mechanism.** ALL slash commands (both built-in and plugin) are consumed by Claude Code's client-side dispatcher with no stream-json output. This affects every command — `/cost`, `/model`, `/compact`, `/dash`, `/plan`, etc. The graphical UI needs a new inbound message type (e.g., `{ type: "slash_command", command, args }`) that tugtalk routes to Claude Code's slash command handler, with output forwarded to the stream. This is the single biggest transport gap.
6. **`@` file reference handling.** Terminal injects file content client-side. Tugtalk/tugcast need either: (a) a mechanism for the UI to send file content with messages, or (b) the UI handles this entirely client-side via attachments.

### UI Requirements (graphical UI must implement)

7. **Permission mode switcher.** Mode selector sending `permission_mode` messages. Cycle: default → acceptEdits → plan → auto.
8. **Session-scoped permissions reset on resume.** Handle re-approval after session resume.
9. **All terminal-only features** listed in the "Terminal-Only Features" section above — ~30 items across display, interaction, permissions, session, streaming, and content categories.

---

## Test 14: Message During Active Turn

**Sent:** "Write 200 words about the ocean", then mid-stream: "Stop. Just say 'INTERRUPTED'."

**Event sequence:**
1. First message starts streaming (14 text events, 543 chars)
2. **>>> second `user_message` sent after partial #2**
3. First response completes normally — `turn_complete #1 (success)`
4. `system_metadata` (new turn)
5. Second response streams — `turn_complete #2 (success)`

**Findings:**
- **Sending a message mid-stream does NOT interrupt.** The current turn completes fully, then the new message is processed as the next turn.
- **Messages are queued.** Claude Code processes them in order. The second message waits for `turn_complete` on the first.
- **To actually stop a turn, use `interrupt`.** A new `user_message` is not a cancellation mechanism.
- **The second response has full context** of both the first response and the second message.

---

## Test 15: `/btw` Side Question

**Sent:** `"/btw What is 2+2?"`

**Result:** `system_metadata` → `cost_update` → `turn_complete`. Zero text events.

**Finding:** `/btw` is a terminal-only feature. The ephemeral overlay, no-history-impact behavior has no stream-json representation. Like all interactive slash commands, the graphical UI must implement its own version if desired.

---

## Test 16: `model_change` Round-Trip

**Sequence:**
1. Ask "What model are you?" (Opus) → "I'm Claude Opus 4.6, made by Anthropic."
2. Send `{ type: "model_change", model: "claude-sonnet-4-6" }`
3. Receive synthetic `assistant_text` [COMPLETE]: `"Set model to claude-sonnet-4-6"`
4. Ask "What model are you?" (Sonnet) → "I'm Claude Sonnet 4.6, made by Anthropic."
5. `system_metadata` now shows `model: "claude-sonnet-4-6"`

**Findings:**
- **Model change is immediate.** Takes effect on the very next turn.
- **Produces a synthetic `assistant_text` event** confirming the change. Not from the model — instant, not streamed.
- **`system_metadata` updates** to reflect the new model.
- **Goes through control_request mechanism** internally (tugtalk translates to `control_request` for Claude CLI).
- Model changed back to opus at end of test.

---

## Test 17: Session Resume (`session_command: "continue"`)

**Sequence:**
1. Send marker message: "Remember PROBE_MARKER_1774819234844" → "OK."
2. Send `{ type: "session_command", command: "continue" }`
3. `session_init` fires with `session_id: "pending-cont..."` (different from `"pending"` for new sessions)
4. Ask "What was the marker?" → "PROBE_MARKER_1774819234844" ← remembered!

**Findings:**
- **`continue` resumes in place.** No process kill, no `error` event. Seamless.
- **Context is fully preserved.** The marker was remembered across the continue command.
- **`session_init` with `"pending-cont..."` is safe to send to immediately** — unlike `"new"` which has a readiness gap.
- **Session command behavior differs by type:**

| Command | Process | `session_init` ID | Readiness | Context |
|---------|---------|-------------------|-----------|---------|
| `"new"` | Kill + respawn | `"pending"` → delayed real ID | **Gap — must wait** | Fresh |
| `"continue"` | In-place | `"pending-cont..."` | **Immediate** | Preserved |
| `"fork"` | Not tested | TBD | TBD | Preserved (copy) |

---

## Test 18: Message During Turn (detailed, from Test 14)

Documented above in Test 14.

---

## Test 19: `/compact` and `compact_boundary`

**Sent:** "Say 'one'" → turn_complete → "/compact"

**Result:** `/compact` behaves like other slash commands — `system_metadata` → `cost_update` → `turn_complete`. **No `compact_boundary` event observed.** Tugtalk may filter these, or they only appear in raw Claude CLI stream-json, not in tugtalk's translated output.

**Bonus finding — rich `cost_update`:** The cost event contains detailed token usage:
```json
{
  "total_cost_usd": 0.0736,
  "num_turns": 1,
  "duration_ms": 1912,
  "duration_api_ms": 1907,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 11081,
    "cache_read_input_tokens": 8491,
    "output_tokens": 5,
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
    "service_tier": "..."
  }
}
```
This is everything a token counter/cost display needs.

---

## Test 20: Session Fork

**Sent:** `{ type: "session_command", command: "fork" }`

**Result:** Same pattern as `"new"` — kills process, `error` (recoverable), respawn, `session_init` with `"pending-fork"`. Readiness gap — message sent immediately was lost.

**Updated session command table:**

| Command | Process | `session_init` ID | Readiness | Context |
|---------|---------|-------------------|-----------|---------|
| `"new"` | Kill + respawn | `"pending"` | **Gap — must wait** | Fresh |
| `"continue"` | In-place | `"pending-cont..."` | **Immediate** | Preserved |
| `"fork"` | Kill + respawn | `"pending-fork"` | **Gap — must wait** | Preserved (copy) |

**Pattern:** Commands that respawn the claude process (`new`, `fork`) have a readiness gap. `continue` is in-place and immediate. The UI must detect the pending ID prefix and wait for the real session_init before sending messages.

---

## Terminal-Only Features — Graphical UI Must Implement

These features exist in the Claude Code terminal but produce **no events in stream-json mode**. The graphical UI must build its own versions. This is a significant body of work — each item needs design and implementation.

### Display / Status (no text output from slash commands)

| Terminal Feature | Slash Command | Data Source for UI | Priority |
|-----------------|---------------|-------------------|----------|
| **Cost display** | `/cost` | `cost_update` event (rich: tokens, USD, duration) | High |
| **Status display** | `/status` | `system_metadata` (model, tools, permissions, session) | High |
| **Context usage** | `/context` | `cost_update.usage` (input/output/cache tokens) + context window math | High |
| **Model display + picker** | `/model` | `system_metadata.model` + send `model_change` | High |
| **Permission mode display + switcher** | `/permissions` | `system_metadata.permissionMode` + send `permission_mode` | High |
| **Diff view** | `/diff` | Must run git diff ourselves or request via tool | Medium |
| **Export conversation** | `/export` | Must serialize from our own conversation state | Medium |
| **Copy last response** | `/copy` | Accumulate from `assistant_text` events | Medium |

### Interactive Features (terminal UI has no stream-json equivalent)

| Terminal Feature | Slash Command | What the UI Needs | Priority |
|-----------------|---------------|-------------------|----------|
| **Session picker** | `/resume` | List sessions, preview, rename, branch filter. Data from filesystem/API. | High |
| **Side question** | `/btw` | Ephemeral overlay, no history impact. Must implement own overlay + separate API call. | Medium |
| **Plan mode chooser** | `/plan` | Present approve/reject/keep-planning options after plan generation. | Medium |
| **Compact with focus** | `/compact [focus]` | Compaction indicator + optional focus text input. | Medium |
| **Session rename** | `/rename` | Text input, update session metadata. | Low |
| **Session fork/branch** | `/branch`, `/rewind` | Fork current session, checkpoint management. Sends `session_command`. | Low |
| **Color/theme picker** | `/color`, `/theme` | Custom UI for theme selection. | Low |
| **Vim mode toggle** | `/vim` | Keybinding mode switch for prompt input. | Low |

### Permission and Approval UI

| Terminal Feature | Trigger | What the UI Needs | Priority |
|-----------------|---------|-------------------|----------|
| **Tool approval dialog** | `control_request_forward` (`is_question: false`) | Show tool name, input preview, reason. Allow/deny buttons. "Always allow" option per `permission_suggestions`. | Critical |
| **AskUserQuestion dialog** | `control_request_forward` (`is_question: true`) | Render questions with options, collect answers. Single-select and multi-select. | Critical |
| **Permission mode indicator** | `system_metadata.permissionMode` | Persistent indicator in chrome showing current mode. | High |

### Session Lifecycle UI

| Terminal Feature | Trigger | What the UI Needs | Priority |
|-----------------|---------|-------------------|----------|
| **New session** | `session_command: "new"` | Handle readiness gap (wait for non-pending `session_init`). Clear conversation. | High |
| **Resume session** | `session_command: "continue"` | Reload conversation history. Session picker. | High |
| **Fork session** | `session_command: "fork"` | Same readiness gap as new. Create branched conversation. | Medium |
| **Session name display** | `system_metadata` | Show session name in chrome. | Medium |

### Streaming and Response UI

| Terminal Feature | Trigger | What the UI Needs | Priority |
|-----------------|---------|-------------------|----------|
| **Streaming cursor/indicator** | `assistant_text` (partial) | Blinking cursor or spinner during streaming. | High |
| **Thinking/reasoning display** | `thinking_text` events | Collapsible thinking block (shows reasoning before response). | High |
| **Tool use display** | `tool_use` → `tool_result` → `tool_use_structured` | Rich tool call visualization: tool name, input, output, duration. | High |
| **Interrupt button** | Sends `interrupt` | Stop button during streaming. State: `turn_complete(result: "error")`. | High |
| **API retry indicator** | `system` (`subtype: "api_retry"`) | Show retry count, delay, error type during retries. | Medium |
| **Compaction indicator** | `compact_boundary` (if tugtalk exposes it) | Show when context is being compacted. | Medium |
| **Cost per turn** | `cost_update` | Running cost display, updated per turn. | Medium |

### Content Features

| Terminal Feature | Mechanism | What the UI Needs | Priority |
|-----------------|-----------|-------------------|----------|
| **Image support** | `user_message.attachments` with `media_type: "image/*"` | Drag-drop, paste, file picker. Base64 encoding. Preview thumbnails. | Medium |
| **File attachment** | `user_message.attachments` | Text file content as attachment. | Medium |
| **Syntax-highlighted code blocks** | `assistant_text` with markdown code fences | tug-markdown renders these via Shiki/TugCodeBlock. | High (Phase 3) |
| **Copy code block** | Click-to-copy on code blocks | Copy button per code block. | High (Phase 3) |

---

## Test Summary (20 Tests Completed)

| # | Test | Key Finding |
|---|------|-------------|
| 1 | Basic round-trip | Works. `user_message` → streamed `assistant_text` → `turn_complete`. |
| 2 | Long streaming | Deltas, ~2 events/sec, ~90 chars/chunk. |
| 3 | `/cost` | No text. Structured `cost_update` only. |
| 4 | `/status` | No text. Data in `system_metadata`. |
| 5 | Tool use (Read) | `tool_use` → `tool_result` → `tool_use_structured` with rich typed data. |
| 6 | Interrupt | `turn_complete(result: "error")`. No `turn_cancelled`. |
| 7 | Multiple tools | Interleaved, concurrent. Different `tool_use_id` per call. |
| 8 | Permission denied | `control_request_forward` with `is_question: false`. |
| 9 | Bash tool | Auto-approved in acceptEdits. Rich `tool_use_structured`. |
| 10 | Long streaming (300w) | 24 partials, 13.4s, 2174 chars. |
| 11 | Permission deny round-trip | `tool_approval(deny)` → `tool_result(is_error: true)`. Works. |
| 12 | `/compact`, `/model` | No text output. |
| 13 | Session new | Kill/respawn. Readiness gap (`"pending"` session_id). |
| 14 | Message during turn | Queued, doesn't interrupt. Processed after `turn_complete`. |
| 15 | `/btw` | No text. Terminal-only. |
| 16 | Model change | Immediate. Synthetic confirmation text. `system_metadata` updates. |
| 17 | Session continue | In-place, immediate, context preserved. |
| 18 | (see 14) | — |
| 19 | `/compact` | No `compact_boundary`. Rich `cost_update` with token details. |
| 20 | Session fork | Kill/respawn. Readiness gap (`"pending-fork"`). Like `new`. |

---

## Test 21: Glob Tool (Auto-Approved, No Rich Structured Data)

**Sent:** "Use the Glob tool to find all .md files in the roadmap/ directory."

**Result:** `tool_use: Glob` → `tool_result` (file list as text) → `tool_use_structured` with `type: "unknown"`. Standard tool flow, auto-approved, no rich structured data (unlike Read/Bash which have typed structured results).

---

## Test 22: Subagent Spawn (Agent Tool)

**Sent:** "Use an Explore agent to find where TugConnection is defined."

**Event sequence:**
1. `tool_use: Agent` — partial, then complete with `{ description, prompt, subagent_type: "Explore" }`
2. `tool_use: Grep` — subagent's first search (different `tool_use_id`)
3. `tool_result` for Grep — "No files found"
4. `tool_use: Grep` — subagent's second search
5. `tool_result` for Grep — found `connection.ts:60`
6. `tool_use: Read` — subagent reads the file
7. `tool_result` for Read — file content
8. `tool_result` for Agent — subagent's final summary
9. `tool_use_structured` for Agent
10. `assistant_text` — parent's response

**Critical findings:**

- **Subagent tool calls are fully visible.** Every Grep, Read, Write, Bash the subagent uses appears as a normal `tool_use`/`tool_result` pair in the event stream.
- **No separate `SubagentStart`/`SubagentStop` events in CodeOutput.** Those are hooks-only. The transport shows subagent activity as nested tool use under the parent Agent `tool_use_id`.
- **The Agent `tool_use.input` contains `subagent_type`** — the UI can identify which agent type is running (Explore, Plan, general-purpose, or tugplug agents).
- **The Agent `tool_result` contains the subagent's summary text** — the final answer the subagent produced.
- **Subagent tool calls interleave with the Agent lifecycle.** Between `tool_use: Agent` and its `tool_result`, all the subagent's internal tool calls appear. The UI can bracket these by tracking the Agent's `tool_use_id`.

**Implication:** The graphical UI can show real-time subagent activity (which tools it's calling, what files it's reading) without any hook-based feed infrastructure. The CodeOutput stream already exposes everything. The hooks/feed system adds *semantic* context (plan step, workflow phase) but the raw activity is visible through the transport alone.

---

## Test 23: Image Attachment

**Sent:** `user_message` with a 1x1 PNG attached:
```json
{
  "type": "user_message",
  "text": "I'm attaching a tiny image. What can you see?",
  "attachments": [{
    "filename": "test-pixel.png",
    "content": "<base64>",
    "media_type": "image/png"
  }]
}
```

**Result:** Claude sees the image and describes it: "It's a tiny solid yellow square." Thinking text shows reasoning about the image. Normal `assistant_text` streaming for the response.

**Findings:**
- **Image attachments work through the transport.** Base64-encoded image in `attachments[]` with `media_type: "image/png"`.
- **No special event types** — the image is part of the `user_message`, not a separate event. Response arrives as normal `assistant_text`.
- **Supported types** (from tugtalk code): `image/png`, `image/jpeg`, `image/gif`, `image/webp`. Max ~5MB decoded.
- **UI needs:** Drag-drop/paste → base64 encode → attach to `user_message`. Show thumbnail preview before send.

---

## Updated Test Summary (23 Tests)

| # | Test | Key Finding |
|---|------|-------------|
| 1 | Basic round-trip | Works |
| 2 | Long streaming | Deltas, ~2 events/sec |
| 3 | `/cost` | No text, structured data only |
| 4 | `/status` | No text |
| 5 | Tool use (Read) | `tool_use` → `tool_result` → `tool_use_structured` |
| 6 | Interrupt | `turn_complete(result: "error")` |
| 7 | Multiple tools | Interleaved, concurrent |
| 8 | Permission denied | `control_request_forward` |
| 9 | Bash tool | Auto-approved, rich structured result |
| 10 | Long streaming (300w) | 24 partials, 13.4s |
| 11 | Permission deny round-trip | Works |
| 12 | `/compact`, `/model` | No text output |
| 13 | Session new | Kill/respawn, readiness gap |
| 14 | Message during turn | Queued, doesn't interrupt |
| 15 | `/btw` | No text, terminal-only |
| 16 | Model change | Immediate, synthetic confirmation |
| 17 | Session continue | In-place, immediate, preserved |
| 19 | `/compact` | No `compact_boundary`, rich `cost_update` |
| 20 | Session fork | Kill/respawn, readiness gap |
| 21 | Glob tool | Auto-approved, no rich structured data |
| 22 | Subagent spawn | **All subagent tool calls visible in stream** |
| 23 | Image attachment | Works via base64 in `attachments[]` |

---

## Test 24: `@` File References

**Sent:** `"What's in @CLAUDE.md?"` and `"What's in @tugdeck/package.json?"`

**Result:** Claude answered correctly in both cases, but **no Read tool call was made**. It answered from session context (CLAUDE.md is loaded as instructions; package.json was read earlier in the session).

**Critical finding: `@` file completion is entirely a terminal-side feature.**
- In the terminal, `@` triggers a file picker; the client reads the file and injects the content into the message before sending.
- In stream-json mode via `user_message`, `@CLAUDE.md` is just literal text — no file injection occurs.
- **The graphical UI must implement its own `@` completion:** detect `@` in the prompt input, show a fuzzy file finder popup, and on selection either inject file content into the message text or add it as a text attachment.

**Added to Terminal-Only Features list.**

---

## Test 25: Tugplug Skill Invocation (`/plan`)

**Sent:** `"/plan Add a --no-auth flag to tugcast..."` as a `user_message`

**Result:** Completed instantly with zero events — same pattern as `/cost`, `/status`. The slash command was consumed by Claude Code's client-side dispatcher and produced no output in stream-json mode.

**Then sent:** `"Invoke the /plan skill to plan this idea: Add a --no-auth flag to tugcast"` (natural language, not slash)

**Result:** Claude tried to use the `Skill` tool:
```
tool_use: Skill → input: { skill: "plan", args: "..." }
tool_result: error → "Skill plan is not a prompt-based skill"
```

Claude then pivoted to `EnterPlanMode` and spawned two Explore agents that read ~10 files over 70+ seconds. All subagent tool calls visible in the stream.

**Critical findings:**

1. **Tugplug skills (`/plan`, `/implement`, `/merge`, `/dash`) cannot be invoked via `user_message`.** The `/plan` slash command is consumed client-side with no stream-json output. The `Skill` tool rejects it as "not a prompt-based skill."

2. **This is a fundamental gap for the graphical UI.** These are the most important tugplug commands and they don't work through the transport. The UI needs a different invocation mechanism — either:
   - (a) A new inbound message type (e.g., `{ type: "skill_invoke", skill: "plan", args: "..." }`) that tugtalk handles specially
   - (b) Changing tugplug skill definitions to be invocable via the Skill tool
   - (c) Having the UI spawn a separate Claude Code process for skill execution

3. **`EnterPlanMode` IS a tool that works.** It enters Claude's built-in plan mode (research → design → present plan → user approves). This is Claude Code's native planning, NOT tugplug's orchestrated planning with clarifier/author/conformance/critic agents.

4. **Long-running interactions need progress UI.** The plan exploration ran 70+ seconds with continuous tool calls. The UI must show activity during this.

**Added to Phase 2 work list: Skill invocation mechanism for graphical UI.**

---

## `api_retry` — Confirmed Gap

**Tugtalk drops `api_retry` events.** Verified by reading `session.ts` `routeTopLevelEvent`:

The `system` event handler only routes two subtypes:
- `subtype: "init"` → `session_init`
- `subtype: "compact_boundary"` → `compact_boundary`

All other `system` subtypes — including `api_retry` — fall through with no output. The UI would see nothing during rate limits or API errors.

**Impact:** During API failures, the user sees a spinner with no explanation. No retry count, no delay indicator, no error type. Bad UX.

**Fix (Phase 2):** Add `api_retry` forwarding in tugtalk's `routeTopLevelEvent`:
```typescript
} else if (subtype === "api_retry") {
  messages.push({
    type: "api_retry",
    attempt: event.attempt,
    max_retries: event.max_retries,
    retry_delay_ms: event.retry_delay_ms,
    error_status: event.error_status,
    error: event.error,
    ipc_version: 2,
  });
}
```

Also audit for other dropped `system` subtypes we might care about.

---

## Auth Bypass — What We'd Learn

Testing through tugcast WebSocket would reveal:
- **Binary framing correctness.** Does the `[FeedId][length][payload]` encoding/decoding work round-trip for conversation events?
- **Feed multiplexing.** How do conversation events interleave with terminal, git, filesystem, stats feeds?
- **Reconnection behavior.** What happens when the WebSocket drops and reconnects mid-conversation? Does bootstrap replay conversation state?
- **Bootstrap content.** What's in the initial snapshot for the CodeOutput feed? Last N events? Full history?
- **Lag detection.** If the client falls behind on CodeOutput frames, does it re-enter bootstrap state?
- **Multiple clients.** Can two browser tabs connect to the same tugcast and see the same conversation?

**Action item:** Add `--no-auth` CLI flag to tugcast. Small change: when flag is set, `validate_request_session` and `check_request_origin` return `true` unconditionally.

---

## Test 26: `/dash` and `/tugplug:dash` Skill Invocation

**Sent:** `"/dash test-probe say hello world"` as `user_message`
**Then:** `"/tugplug:dash test-probe say hello world"` (fully-qualified name)

**Result:** Both produce instant completion, zero events. The fully-qualified name doesn't help.

**Critical finding: ALL slash commands are consumed by Claude Code's client-side dispatcher, regardless of qualification.** The dispatch happens before stream-json processing. `/dash`, `/tugplug:dash`, `/cost`, `/plan` — all identical: consumed internally, no events in the stream.

In the terminal, `/dash` shows output (agent spawning, progress, results) because the terminal renders output from the same process. In stream-json mode, the slash command handler runs the skill internally, but no events flow to the stream output.

**This means slash commands are fundamentally a terminal input mechanism with no stream-json equivalent.** Stream-json is for `user_message` → Claude API → streamed response. Slash commands bypass Claude entirely and are handled by the harness.

**Implication for the graphical UI:** Cannot invoke ANY slash command (built-in or plugin) via the `user_message` transport. The UI needs a completely different invocation mechanism.

---

## Deep Dive: How Slash Command Output Actually Works in Tugtalk

**Discovered by reading `session.ts` `routeTopLevelEvent`.**

Claude Code's slash command mechanism works like this:

1. Text starting with `/` is sent to Claude's stdin as a normal `user` message.
2. Claude Code's harness intercepts it as a slash command and processes it internally — the model never sees it.
3. For simple commands (`/cost`, `/status`), Claude Code emits a `result` event containing the formatted output text.
4. **Then, on session replay**, Claude Code emits a `{ type: "user", isReplay: true, message: { content: "<local-command-stdout>...</local-command-stdout>" } }` event.
5. Tugtalk's `case "user"` handler (lines 318-347) detects `isReplay === true`, extracts `<local-command-stdout>` content, and emits it as `assistant_text`.

**This explains our Test 3 (`/cost`):** We saw `cost_update` (from the `result` event) + `turn_complete`, but no `assistant_text` with the formatted cost text. The text only appears on **replay** (session resume), not on first execution.

**Critical question for orchestrator skills (`/dash`, `/plan`):** When these run, they spawn agents, make tool calls, produce progress output. Does this output go through `<local-command-stdout>` on replay? Or does the orchestrator's output come as normal streaming events (`tool_use`, `assistant_text`, `control_request`)? If the latter, tugtalk should already be forwarding those events — but our tests showed zero events.

**Possible explanations for why orchestrator skills produce zero events:**
1. The orchestrator skill runs in a **separate execution context** whose stdout isn't connected to the stream-json pipe.
2. The skill output goes through the `<local-command-stdout>` mechanism but the tags are only emitted on replay, and we never resumed the session after running the skill.
3. The skill errored silently and produced no output.
4. There's a skill invocation pathway we haven't found.

---

## RESOLVED: Slash Command Mystery

**Root cause: `--plugin-dir` was pointing to the wrong directory.**

Tugtalk's `getTugtoolRoot()` resolves to the project root (`/u/src/tugtool`), which finds the root-level `.claude-plugin/plugin.json` (name: `tugtool`). But the tugplug skills live under `tugplug/skills/`, and the `tugplug` plugin definition is at `tugplug/.claude-plugin/plugin.json`. The root-level plugin doesn't expose the skills.

**Fix:** Point `--plugin-dir` to `tugplug/` instead of the project root.

**Test 29: `/tugplug:ping` with correct `--plugin-dir`**

With `--plugin-dir /u/src/tugtool/tugplug`:

```
system:init → skills includes: tugplug:ping, tugplug:plan, tugplug:merge, tugplug:dash, tugplug:implement
stream:text_delta → "**pong** — 2026-03-29T00:00:00Z"
USER [isReplay=true] → <command-name>/tugplug:ping</command-name>
RESULT → success
```

**All tugplug skills are visible and invocable.**

**Test 30: `/tugplug:dash status` with correct `--plugin-dir`**

Full orchestrator skill output visible:

```
THINKING → "The user is running /tugplug:dash status..."
USER [isReplay=true] → <command-name>/tugplug:dash</command-name><command-args>status</command-args>
ASSISTANT_TOOL: Bash → tugcode dash list
tool_result → JSON with dash list
TEXT → "No active dashes."
RESULT → success (44 events, 5.2s)
```

**The entire orchestrator execution is visible in the stream.** Thinking, tool calls (Bash), tool results, and the final text response — all flowing through the same event stream we've been testing.

**What this means:**
1. **Slash commands DO work through stream-json** — they produce full event streams including tool calls, streaming text, and result events.
2. **The problem was never the protocol** — it was a misconfigured `--plugin-dir` that prevented the plugin from loading.
3. **tugtalk needs a fix:** `getTugtoolRoot()` must resolve to `tugplug/` (or the root plugin must properly reference the tugplug skills). This is a one-line fix in tugtalk.
4. **The graphical UI sends `/tugplug:dash args` as a normal `user_message`** and it just works. No special invocation mechanism needed.

**Phase 2 work items:**
- **Item #5 updated:** "fix `--plugin-dir` in tugtalk to point to `tugplug/`" — one-line fix.
- **New item:** Tugtalk's `case "assistant"` handler drops text from synthetic messages (`model: "<synthetic>"`). Built-in skill commands like `/cost` and `/compact` produce their text output as an `assistant` message with `model: "<synthetic>"`, but tugtalk skips all `assistant` text assuming it was already delivered via `stream_event`. Fix: detect `model === "<synthetic>"` and emit the text as `assistant_text`.

---

## Test 31-33: Built-In Command Classification (Fresh Probe)

With the correct `--plugin-dir`, testing built-in commands directly against Claude CLI:

| Command | Raw CLI Output | Category |
|---------|---------------|----------|
| `/cost` | `assistant` text: "Total cost: $0.00..." + `result` | **Skill** (text available but tugtalk drops it) |
| `/compact` | `assistant` text: "Error: No messages to compact" + `result` | **Skill** (text available but tugtalk drops it) |
| `/status` | `result`: "Unknown skill: status" | **Terminal-only** (not a skill) |
| `/model` | `result`: "Unknown skill: model" | **Terminal-only** (not a skill) |

**Three categories of `/` commands:**

| Category | In `system_metadata.slash_commands`? | Stream-JSON? | Text? |
|----------|--------------------------------------|-------------|-------|
| **Skills** (`/cost`, `/compact`, `/commit`, `/review`, `/tugplug:dash`, etc.) | Yes | Full events | Yes (needs tugtalk fix for synthetic messages) |
| **Terminal-only** (`/status`, `/model`, `/clear`, `/vim`, `/btw`, `/resume`, etc.) | No | "Unknown skill" | No — must be reimplemented in UI |
| **Name collision** (`/plan` = built-in terminal command AND `tugplug:plan` skill) | `tugplug:plan` is in skills list | Use fully-qualified `tugplug:plan` | Yes |

**No more mystery.** The entire slash command landscape is mapped.

---

## Test 27: `@` File References (Tests 24a, 24b)

See Test 24 above. Confirmed terminal-only.

---

## Test 28: `system_metadata` Deep Dive — Plugin Skill Visibility

**Full `system_metadata` dump reveals:**

| Field | Contents | Notable |
|-------|----------|---------|
| `slash_commands` (18) | `update-config`, `debug`, `simplify`, `batch`, `loop`, `schedule`, `claude-api`, `commit`, `compact`, `context`, `cost`, `heapdump`, `init`, `pr-comments`, `release-notes`, `review`, `security-review`, `insights` | **Tugplug skills (`dash`, `plan`, `implement`, `merge`) are MISSING** |
| `skills` (8) | `update-config`, `debug`, `simplify`, `batch`, `loop`, `schedule`, `claude-api`, `commit` | Subset of `slash_commands` |
| `agents` (5) | `general-purpose`, `statusline-setup`, `Explore`, `Plan`, `claude-code-guide` | **Tugplug's 12 agents are MISSING** |
| `plugins` (1) | `{ name: "tugtool", path: "...", source: "tugtool@inline" }` | Plugin IS loaded |

**Root cause investigation:**

The `commit` skill lives in `.claude/skills/commit/SKILL.md` (project-level) — it's a **prompt-based skill** (markdown body that becomes Claude's instructions, `disable-model-invocation: true`). These appear in `system_metadata`.

The tugplug skills (`dash`, `plan`, `implement`, `merge`) live in `tugplug/skills/*/SKILL.md` — they're **orchestrator skills** (have `allowed-tools` restrictions, hooks, use `Task` tool for agent dispatch). These do NOT appear in `system_metadata`.

**This is a two-tier skill system:**

| Skill Type | Example | `allowed-tools`? | In `system_metadata`? | Invocable via Skill tool? | `/` dispatch? |
|-----------|---------|-------------------|----------------------|--------------------------|---------------|
| Prompt-based | `commit`, `review` | No | Yes | Yes | Yes (terminal) |
| Orchestrator | `dash`, `plan`, `implement` | Yes | **No** | **No** ("not a prompt-based skill") | Yes (terminal only?) |

**Critical implication:** Orchestrator skills are invisible to the stream-json protocol. They're dispatched by the terminal's `/` handler but have no programmatic invocation path. The graphical UI cannot invoke `/dash` or `/plan` through the transport.

---

## Hooks — Unexplored Dimension

Hooks fire during tool execution and can modify behavior. We haven't explored:

1. **Do hook-produced events appear in the CodeOutput stream?** When a `PreToolUse` hook modifies tool input or blocks a tool, does any event indicate this to the UI?
2. **Hook-injected context** — hooks can return `additionalContext` that's added to the conversation. Does this show up as a visible event?
3. **The `Notification` hook event** fires for `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`. Are any of these surfaced in CodeOutput?
4. **Tugplug's auto-approval hooks** — when `auto-approve-tug.sh` allows a tool, does the UI see any indication that a hook (not the user) approved it?
5. **Hook execution time** — blocking hooks can delay tool execution. Does the UI see a delay between `tool_use` and `tool_result` with no indication of why?

**This matters because:** The graphical UI might need to show hook activity (which hook ran, what it decided, how long it took). Without this, hooks are invisible to the user — tools just take longer or behave differently with no explanation.

---

## Plugin System — Open Questions

1. **How does the terminal's `/` handler know about orchestrator skills?** It must read plugin `SKILL.md` files directly, separate from what Claude Code reports in `system_metadata`.
2. **Can we enumerate all available skills (both types) programmatically?** The UI needs a complete list for the slash command popup.
3. **Is there an API to invoke an orchestrator skill?** The CLI presumably has one since the terminal can do it. Maybe a specific CLI flag or IPC mechanism.
4. **Plugin hot-reload** — if we modify a tugplug skill, does the running session pick it up? Or does it need a restart?
5. **Plugin hooks registration** — when do `hooks.json` entries take effect? At session start? Per-turn?

---

## Still To Test

- [ ] End-to-end through tugcast WebSocket (blocked: needs T6 `--no-auth`)
- [ ] `stop_task` message with a long-running background task (U21)
- [ ] Multiple concurrent background tasks (E6)
- [ ] ~~Orchestrator skill invocation~~ **RESOLVED** — fix `--plugin-dir` (T1)
- [ ] Live `AskUserQuestion` round-trip — now possible with correct `--plugin-dir`, run `/tugplug:plan` (U3)
- [ ] Hook visibility in CodeOutput (E3)
- [ ] Plugin enumeration with correct `--plugin-dir` — do tugplug agents appear in `system_metadata.agents`? (E2)
- [ ] `Notification` hook events (E3)
- [ ] Session name — does it appear in `system_metadata`? (C11)
- [ ] Plan mode events — what does `EnterPlanMode` output look like in the event stream? (U20)

## Resolved from Code Inspection (No Probe Needed)

- [x] `system` event forwarding — confirmed `api_retry` is dropped, `compact_boundary` is forwarded
- [x] `@` file reference — confirmed terminal-only, no protocol support
- [x] Plugin skill visibility — orchestrator skills are invisible to stream-json protocol
- [x] Fully-qualified skill names (`/tugplug:dash`) — same behavior, still consumed client-side

---

## Areas of Further Exploration

Organized by domain. Each area contains open questions that need investigation before the graphical UI can be fully designed.

### Area 1: Slash Command / Skill Invocation — RESOLVED

**Root cause found and fixes identified.**

- [x] **`--plugin-dir` was wrong.** Pointed to project root instead of `tugplug/`. Fixed: all tugplug skills visible and invocable. (T1)
- [x] **Slash commands DO work via `user_message`.** Skills produce full streaming events. Terminal-only commands return "Unknown skill" — they must be reimplemented as native UI controls.
- [x] **Three categories identified:** Skills (work via transport), Terminal-only (UI must reimplement), Name collisions (use fully-qualified `tugplug:` prefix).
- [x] **Synthetic `assistant` text dropped.** Built-in skill commands (`/cost`, `/compact`) produce text in `model: "<synthetic>"` messages that tugtalk skips. Fix identified. (T2)
- [x] **Complete command classification done.** See "Terminal-Only Commands" table in Action Items.

### Area 2: Plugin System

The tugtool plugin is loaded but its capabilities are partially invisible.

- [ ] **Plugin skill enumeration.** `system_metadata.slash_commands` excludes orchestrator skills. How do we get a complete list? Is there a CLI command (`claude --list-skills`)?  Can we read the plugin directory structure?
- [ ] **Plugin agent enumeration.** `system_metadata.agents` shows only 5 built-in agents, not tugplug's 12. Same question — how to enumerate all available agents?
- [ ] **Plugin hot-reload.** If we modify a tugplug skill or agent definition, does the running session pick it up? Or does it need a `/reload-plugins` command or process restart?
- [ ] **Plugin hook registration.** When do `hooks.json` entries take effect? At session start? Per-tool-call? Can hooks be added dynamically?
- [ ] **Plugin configuration.** The `plugin.toml` / `plugin.json` — what configuration affects transport behavior?

### Area 3: Hooks Visibility

Hooks run silently. The UI has no insight into hook activity.

- [ ] **Do hook decisions appear in CodeOutput?** When `auto-approve-tug.sh` allows a Bash command, does any event indicate a hook (not the user) made the decision? The `tool_result` arrives, but there's no "approved by hook" marker.
- [ ] **Hook-injected context.** Hooks can return `additionalContext` that's added to the conversation. Does this appear as any event? Or is it silently injected into Claude's context?
- [ ] **Hook timing.** Blocking hooks can delay tool execution. Between `tool_use` and `tool_result`, if a hook adds 500ms, the UI sees a gap with no explanation. Should tugtalk emit a "hook executing" event?
- [ ] **`Notification` hook events.** The hooks system fires `Notification` for `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`. Do any of these flow through to CodeOutput?
- [ ] **Hook error visibility.** If a hook fails (exit code != 0 and != 2), what does the UI see? Does the tool proceed? Is there an error event?

### Area 4: Tugcast WebSocket Layer

Everything so far is direct-to-tugtalk. The actual production path goes through tugcast.

- [ ] **Auth bypass for testing.** Add `--no-auth` flag to tugcast so we can connect via WebSocket without the single-use token dance.
- [ ] **Binary framing correctness.** Does `[FeedId][length][payload]` round-trip correctly for all conversation event types?
- [ ] **Feed multiplexing behavior.** How do CodeOutput events interleave with terminal, git, filesystem, stats feeds on the same WebSocket?
- [ ] **Bootstrap / reconnection.** When a client reconnects, what conversation state is replayed? Last N events? Full history? Nothing?
- [ ] **Lag detection.** If CodeOutput frames back up (client too slow), does the router enter BOOTSTRAP state? What does that look like for a conversation?
- [ ] **Multiple clients.** Can two browser tabs see the same conversation? What about concurrent WebSocket connections?

### Area 5: Session Management

Session lifecycle has gaps.

- [ ] **Session picker data.** How does the terminal populate the session picker (session list, names, branches, preview)? Is this data available via CLI or API?
- [ ] **Session persistence.** Tugtalk persists session ID to `.tugtool/.session`. What other session state is persisted? Can we enumerate past sessions?
- [ ] **Session-scoped permissions after resume.** Confirmed that permissions reset on resume — but what does the re-approval flow look like? Does the UI get `control_request_forward` events for previously-approved tools?
- [ ] **Concurrent sessions.** Can two tugtalk instances use different sessions simultaneously? What about the app's tugtalk vs our probe's tugtalk?

### Area 6: Advanced Interaction Patterns

- [ ] **Background tasks.** `Ctrl+B` backgrounds a task in the terminal. Is there a `user_message` or inbound message equivalent? How do background task results appear in CodeOutput?
- [ ] **`/btw` side questions.** Terminal-only ephemeral overlay. Could we implement this as a separate tugtalk session that doesn't affect the main conversation history?
- [ ] **MCP server interaction.** `mcp_servers` appear in `system_metadata`. How does MCP tool use appear in the event stream? Same as regular tool use?
- [ ] **Elicitation events.** The `Elicitation` hook event fires when MCP servers request user input. Does this surface as a `control_request_forward`?
