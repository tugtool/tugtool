## Phase 2.0: Complete TugTalk Protocol Implementation for Web Frontend {#phase-tugtalk-protocol}

**Purpose:** Implement comprehensive support for all 23 sections of the empirically-documented Claude CLI stream-json protocol so that TugTalk can serve as a full-featured bridge between a web frontend and Claude Code.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The TugTalk session layer was built against guessed protocol assumptions that turned out to be wrong in multiple dimensions. An exhaustive empirical investigation documented in `roadmap/tugtalk-protocol.txt` (1455 lines, 23 sections) now provides the definitive protocol reference, backed by actual CLI output from claude v2.1.38 and reverse-engineering of the Agent SDK v0.2.44 source. The existing plan had 4 steps and 6 decisions, several of which are factually incorrect: D01 mandated the `-p` flag (the SDK does NOT use it), D05 said the type is `control` (it is `control_request` and `control_response`), and D02 omitted required `session_id` and `parent_tool_use_id` fields from user messages.

Beyond fixing these errors, the protocol reference reveals extensive capabilities needed for a world-class web frontend: permission prompts via the `--permission-prompt-tool stdio` control protocol, AskUserQuestion flows, structured tool results with diff data, extended thinking, subagent event routing, task/todo system, MCP tool integration, context compaction, session forking, slash command handling, cost tracking, and multiple custom UI components that have no CLI equivalent.

#### Strategy {#strategy}

- Fix foundational protocol issues first: remove `-p` flag, correct stdin/stdout message formats, implement two-tier event routing (unblocks everything else)
- Implement the full control protocol: `control_request` and `control_response` for permissions, questions, interrupts, model/mode changes (unblocks interactive web UI)
- Expand the type system to cover all protocol message types discovered in the 23 sections
- Add structured tool result handling for rich web UI rendering (diffs, file viewers, terminal output)
- Scaffold web frontend components for capabilities that require custom UI: settings panel, help panel, task list, diff viewer, cost display, context gauge
- Group changes into substeps by functional area within larger steps to keep commits focused
- Direct CLI spawning is the permanent architecture (explicitly re-decided)

#### Stakeholders / Primary Customers {#stakeholders}

1. TugTalk web UI end users who interact with Claude through the browser
2. Tugtool developers building and maintaining the TugTalk conversation engine
3. Future plugin/integration authors who rely on TugTalk as a protocol bridge

#### Success Criteria (Measurable) {#success-criteria}

- `buildClaudeArgs()` omits `-p` and includes `--permission-prompt-tool stdio` (unit test)
- Stdin user messages include `session_id: ""` and `parent_tool_use_id: null` per protocol reference section 2a (unit test)
- All 8 stdout message types are routed correctly: `system`, `assistant`, `user`, `result`, `stream_event`, `control_request`, `control_response`, `keep_alive` (unit test per type)
- Control protocol handles permission prompts with `allow`/`deny` responses matching the Zod schema (unit test)
- AskUserQuestion flow renders questions and returns answers via `updatedInput` (unit test)
- Graceful interrupt uses `control_request` with `subtype: "interrupt"` instead of SIGINT (unit test)
- Structured tool results (Edit `structuredPatch`, Write `type`/`content`) are parsed and forwarded (unit test)
- Extended thinking content blocks (`thinking_delta`) are forwarded to IPC (unit test)
- Subagent events are tagged with `parent_tool_use_id` (unit test)
- Session forking via `--fork-session` is supported (unit test for `buildClaudeArgs`)
- All tests pass: `bun test tugtalk/src/__tests__/session.test.ts` exits 0
- TypeScript compiles: `bun build tugtalk/src/session.ts --no-bundle` exits 0
- Coverage means: working implementation for in-scope features; typed interfaces + documented behavior for out-of-scope features (MCP auth, hooks, UI rendering)

#### Scope {#scope}

1. Fix `buildClaudeArgs()`: remove `-p`, add `--permission-prompt-tool stdio`, support `--fork-session` and `--continue`
2. Fix stdin message format: `session_id: ""`, `parent_tool_use_id: null`, content as array of blocks
3. Implement two-tier event routing for all 8 stdout message types
4. Implement full control protocol: `control_request` inbound routing, `control_response` outbound formatting
5. Implement permission prompt flow: tool permissions and AskUserQuestion
6. Replace SIGINT interrupt with `control_request` graceful interrupt
7. Add structured tool result parsing (Edit/Write diff data, Bash output)
8. Add extended thinking support (thinking content blocks and streaming)
9. Add subagent event routing via `parent_tool_use_id`
10. Expand IPC types for all new outbound message categories
11. Add session management: forking, continue, slash command passthrough
12. Scaffold web frontend component types: settings, help, task list, diff viewer, cost, context gauge, MCP status
13. Rewrite all session tests from scratch against the correct protocol

#### Non-goals (Explicitly out of scope) {#non-goals}

Items listed here are explicitly out of scope for working implementation, but are covered via typed interfaces and documented behavior per [Exit Criteria](#exit-criteria).

- Switching to the Agent SDK (direct CLI spawning is the permanent architecture per re-decision)
- Actual web frontend rendering (HTML/CSS/React components) -- this plan scaffolds the TypeScript types and bridge logic only
- Integration tests that spawn a real `claude` process
- MCP server management (authentication, OAuth flows) -- we route MCP events but do not implement MCP configuration
- Hook implementation -- hooks are transparent middleware; we handle their effects on the protocol

#### Dependencies / Prerequisites {#dependencies}

- Protocol reference: `roadmap/tugtalk-protocol.txt` (complete, 1455 lines, 23 sections)
- Existing codebase: `tugtalk/src/session.ts`, `tugtalk/src/types.ts`, `tugtalk/src/ipc.ts`, `tugtalk/src/permissions.ts`, `tugtalk/src/main.ts`
- Claude CLI v2.1.38+ installed and available on PATH (for manual verification only)
- Bun runtime

#### Constraints {#constraints}

- Files in `tugtalk/src/` may be modified or created (lifted from previous 2-file constraint)
- Must preserve the existing IPC message types that the frontend depends on: `assistant_text`, `tool_use`, `tool_result`, `turn_complete`, `turn_cancelled`, `error`, `session_init`
- Must preserve the `SessionManager` public method interface (may be additively extended)
- Bun runtime compatibility required
- All changes must compile with `bun build` and pass `bun test`

#### Assumptions {#assumptions}

- The `-p` flag is NOT required per protocol reference section 1 -- the SDK omits it, and `--input-format stream-json` implies non-interactive mode
- Stdin accepts `user` and `control_request`/`control_response` message types per protocol reference sections 2a-2f
- Stdout emits 8 top-level message types per protocol reference section 3: `system`, `assistant`, `user`, `result`, `stream_event`, `control_request`, `control_response`, `keep_alive` (plus `control_cancel_request`)
- The `control_response` for permissions must match the Zod PermissionResult schema: `behavior: "allow"` requires `updatedInput`, `behavior: "deny"` requires `message`
- `system` init is emitted at the start of EVERY turn, not just the first
- Result cost/usage values are CUMULATIVE across the entire session, not per-turn
- Session-scoped permissions are NOT restored on resume -- users must re-approve per [PN-18](#pn-session-permissions-resume)
- Hooks are transparent middleware; tool results may arrive without preceding control_request prompts when hooks auto-resolve permissions (per [PN-21](#pn-hook-resilience))

---

### 2.0.0 Design Decisions {#design-decisions}

#### [D01] Remove -p flag from buildClaudeArgs (DECIDED) {#d01-no-p-flag}

**Decision:** Remove the `-p` / `--print` flag from `buildClaudeArgs()`. The SDK does NOT use it, and `--input-format stream-json` implies non-interactive mode.

**Rationale:**
- Protocol reference section 1: "The -p / --print flag is NOT required despite --help saying otherwise. The SDK omits it."
- Empirically verified: the presence of `--input-format stream-json` implies non-interactive mode; the process stays alive reading NDJSON from stdin
- The Agent SDK spawns: `claude --output-format stream-json --input-format stream-json --verbose` (no `-p`)

**Implications:**
- `buildClaudeArgs()` must NOT include `-p` in any configuration
- Previous D01 from the old plan was factually wrong and is superseded

#### [D02] Correct stdin user message to include session_id and parent_tool_use_id (DECIDED) {#d02-stdin-user-format}

**Decision:** Change the stdin user message format to include `session_id: ""` (empty string) and `parent_tool_use_id: null`, with `content` as an array of content blocks per protocol reference section 2a.

**Rationale:**
- Protocol reference section 2a shows the complete format: `{type: "user", session_id: "", message: {role: "user", content: [{type: "text", text: "..."}]}, parent_tool_use_id: null}`
- `session_id` is always empty string (not the actual session ID)
- `content` as a plain string is also accepted but the array form supports images and mixed content blocks per section 8
- `parent_tool_use_id: null` for top-level messages

**Implications:**
- `handleUserMessage()` must construct the full envelope with all required fields
- Content must be an array of content blocks to support future image/file attachments
- The old format `{type: "user_message", text: "..."}` is completely wrong

#### [D03] Two-tier event routing for 8 stdout message types (DECIDED) {#d03-event-routing}

**Decision:** Route all 8 top-level stdout message types in a primary event router before delegating `stream_event` inner payloads to `mapStreamEvent()`. The 8 types are: `system`, `assistant`, `user`, `result`, `stream_event`, `control_request`, `control_response`, `keep_alive` (plus `control_cancel_request`).

**Rationale:**
- Protocol reference section 3 documents 8 distinct top-level types, not 5 as previously assumed
- `control_request` and `control_response` are critical for permission prompts and graceful interrupts
- `keep_alive` must be silently consumed
- `control_cancel_request` cancels pending permission dialogs
- Only `stream_event` delegates to `mapStreamEvent()` with the unwrapped `.event` payload

**Implications:**
- New `routeTopLevelEvent()` function handles all 8+ types
- `mapStreamEvent()` only receives unwrapped `stream_event.event` payloads
- `control_request` messages trigger permission/question IPC flows
- Session ID capture moves to the top-level router (from `system` init)

#### [D04] Session ID from system/init emitted every turn (DECIDED) {#d04-session-id-capture}

**Decision:** Capture `session_id` from `{type: "system", subtype: "init"}` messages. This message is emitted at the start of EVERY turn, not just the first.

**Rationale:**
- Protocol reference section 3a: "Emitted at the START OF EVERY TURN, not just the first"
- The system init also carries `tools`, `model`, `permissionMode`, `slash_commands`, `plugins`, `agents`, `skills`, `claude_code_version` -- all valuable for the web UI
- `session_id` is consistent across turns in the same session
- Also emitted with `subtype: "compact_boundary"` after context compaction

**Implications:**
- Every system init should update the cached session metadata (model, tools, permissions, etc.)
- Session ID is persisted on first capture, verified on subsequent turns
- The compact_boundary subtype should trigger a UI compaction marker

#### [D05] Control protocol uses control_request and control_response types (DECIDED) {#d05-control-protocol}

**Decision:** Implement the control protocol using `control_request` (outbound to CLI stdin) and `control_response` (outbound to CLI stdin) types, NOT a generic `control` type. Inbound `control_request` messages from CLI stdout trigger permission/question flows.

**Rationale:**
- Protocol reference sections 2b-2f: stdin messages use `type: "control_request"` (with `request_id` and `request.subtype`) and `type: "control_response"` (with `response.subtype`)
- Previous D05 said `type: "control"` which is factually wrong
- The Zod schema for permission responses requires `behavior: "allow"` with `updatedInput` or `behavior: "deny"` with `message` -- `{decision: "allow"}` does NOT work

**Implications:**
- `sendControlRequest()` for interrupt, set_permission_mode, set_model, stop_task
- `sendControlResponse()` for answering permission prompts and AskUserQuestion
- Both require `request_id` for request/response correlation
- `handleToolApproval()` and `handleQuestionAnswer()` must format control_response messages

#### [D06] Permission prompts via --permission-prompt-tool stdio (DECIDED) {#d06-permission-prompts}

**Decision:** Add `--permission-prompt-tool stdio` to the spawn flags so the CLI routes all permission decisions through the stdin/stdout control protocol instead of the terminal UI.

**Rationale:**
- Protocol reference section 5: "--permission-prompt-tool stdio" enables the full permission flow
- Without this flag, permission prompts go to the terminal UI which is invisible in stream-json mode
- The flag enables: tool permission requests (section 5a), AskUserQuestion (section 5b), and `permission_suggestions` for one-click permission rules
- The web frontend needs `control_request` messages to render permission dialogs

**Implications:**
- `buildClaudeArgs()` must include `--permission-prompt-tool`, `stdio`
- The event router must handle inbound `control_request` from stdout and forward to IPC
- Permission responses must match the Zod PermissionResult schema exactly

#### [D07] Graceful interrupt via control_request, not SIGINT (DECIDED) {#d07-graceful-interrupt}

**Decision:** Replace SIGINT-based interruption with `control_request` `{subtype: "interrupt"}` sent via stdin. SIGINT kills the process with no result event. Control request enables graceful interruption with a proper result event.

**Rationale:**
- Protocol reference section 10a: "SIGINT kills the process immediately. No result event is emitted."
- Protocol reference section 2b: control_request interrupt sends on stdin, CLI acknowledges, injects "[Request interrupted by user]", emits a proper `result` event with `subtype: "error_during_execution"`
- Protocol reference section 10b: "Web frontend MUST handle Escape key... NEVER send SIGINT"

**Implications:**
- `handleInterrupt()` rewired to send `control_request` stdin message instead of `process.kill("SIGINT")`
- Process cleanup (tab close) uses SIGTERM with timeout, then SIGKILL as last resort
- The turn loop receives a proper `result` event after interrupt, no special EOF handling needed

#### [D08] Expand IPC types for protocol completeness (DECIDED) {#d08-expand-ipc-types}

**Decision:** Add new outbound IPC message types to cover protocol features beyond basic text/tool/result: `control_request_forward` (permission prompts from CLI), `system_init` (session metadata), `thinking_text` (extended thinking), `cost_update` (turn cost data), `tool_use_structured` (rich tool results with diff data).

**Rationale:**
- The web frontend needs typed IPC messages for: permission dialogs (section 5), session metadata (section 3a), thinking blocks (section 14), cost tracking (section 12), structured diffs (section 9)
- Keeping these as distinct typed messages enables the frontend to render specialized UI components
- The existing IPC types (`assistant_text`, `tool_use`, `tool_result`, etc.) remain unchanged

**Implications:**
- New types added to `types.ts` OutboundMessage union
- New IPC message types are additive -- no breaking changes to existing frontend consumers
- Each new type corresponds to a specific protocol section

#### [D09] Direct CLI spawning is the permanent architecture (DECIDED) {#d09-direct-cli}

**Decision:** Direct CLI spawning via `Bun.spawn()` is the permanent architecture. The Agent SDK is not used.

**Rationale:**
- The protocol reference documents everything needed for a complete web frontend through the CLI
- Direct spawning gives full control over process lifecycle, stdin/stdout, and signals
- The Agent SDK wraps the same CLI underneath and adds abstraction overhead
- User explicitly confirmed: "Direct CLI spawning is the permanent architecture (explicitly re-decided)"

**Implications:**
- No SDK dependency
- All protocol handling is in TugTalk TypeScript code
- Process management (spawn, stdin write, stdout read, signals) remains in `session.ts`

#### [D10] Support session forking and continuation (DECIDED) {#d10-session-forking}

**Decision:** Support `--continue`, `--fork-session`, and `--session-id` spawn flags for advanced session management per protocol reference section 7.

**Rationale:**
- Protocol reference section 7c: `--continue` picks up the most recent session
- Protocol reference section 7d: `--fork-session` creates a new session ID while preserving conversation history (branching)
- These enable "Fork" and "Continue" buttons in the web UI

**Implications:**
- `ClaudeSpawnConfig` extended with optional `continue`, `forkSession`, `sessionIdOverride` fields
- `buildClaudeArgs()` conditionally includes these flags
- The system init after fork has a new `session_id` which must be persisted
- `buildClaudeArgs()` must validate flag combinations: at most one of `sessionId` (-> `--resume`), `continue` (-> `--continue`), or `sessionIdOverride` (-> `--session-id`) may be set. `forkSession` (-> `--fork-session`) requires either `sessionId` or `continue`. Invalid combinations throw at build time, not at CLI runtime.

#### [D11] Structured tool result forwarding for rich UI (DECIDED) {#d11-structured-tool-results}

**Decision:** Parse and forward `tool_use_result` structured data from the outer `user` message envelope for Edit and Write tool results, including `structuredPatch`, `originalFile`, and `filePath`.

**Rationale:**
- Protocol reference sections 9b-9c: Edit and Write tool results carry structured data on the outer message envelope
- `structuredPatch` provides unified diff hunks for rendering visual diffs
- `originalFile` provides pre-edit content for side-by-side diff views
- The web frontend needs this structured data for diff viewer rendering

**Implications:**
- Tool result parsing extracts `tool_use_result` from `user` messages
- New IPC message type carries structured diff data alongside the plain text result
- The frontend diff viewer component consumes this structured data

#### [D12] Extended thinking forwarded as thinking_text IPC (DECIDED) {#d12-extended-thinking}

**Decision:** Forward extended thinking content blocks as a new `thinking_text` IPC message type, both streaming (`thinking_delta`) and complete (from `assistant` message content blocks).

**Rationale:**
- Protocol reference section 14: thinking blocks appear as `content_block_start` with `type: "thinking"` and `content_block_delta` with `delta.type: "thinking_delta"`
- Thinking blocks appear BEFORE text response blocks
- The web frontend should show thinking in a collapsible section with real-time streaming

**Implications:**
- `mapStreamEvent()` handles `thinking_delta` in addition to `text_delta`
- `routeTopLevelEvent()` extracts thinking blocks from `assistant` message content
- New `thinking_text` IPC message type added to OutboundMessage

#### [D13] Subagent events tagged with parent_tool_use_id (DECIDED) {#d13-subagent-events}

**Decision:** Preserve `parent_tool_use_id` from all protocol messages and forward it in IPC messages so the web frontend can group subagent events under their parent task.

**Rationale:**
- Protocol reference section 15: when Claude uses the Task tool, subagent events have `parent_tool_use_id` linking back to the spawning tool_use
- Multiple subagents can run concurrently with different parent IDs
- The web frontend needs this to render nested/indented subagent activity

**Implications:**
- All IPC message types that can come from subagents gain an optional `parent_tool_use_id` field
- The event router preserves `parent_tool_use_id` from the top-level message
- No special handling needed -- just field preservation

#### [D14] Rewrite all tests from scratch (DECIDED) {#d14-rewrite-tests}

**Decision:** Delete all existing session tests and rewrite them from scratch against the correct protocol format. No test migration or adaptation.

**Rationale:**
- Every existing test validates the wrong protocol format
- The scope has expanded from 2 files to potentially all files in `tugtalk/src/`
- New protocol features (control protocol, structured results, thinking, subagents) need comprehensive test coverage
- A clean rewrite ensures every assertion matches the empirically-documented protocol

**Implications:**
- All existing `session.test.ts` tests deleted
- New tests organized by protocol section / functional area
- Mock infrastructure rebuilt to emit protocol-compliant events

#### [D15] IPC protocol version field (DECIDED) {#d15-ipc-version}

**Decision:** Add an `ipc_version: 2` field to all outbound IPC messages. The current implicit version is 1. Version 2 signals that the frontend must handle `ControlRequestForward` messages to avoid permission hangs.

**Rationale:**
- R01 identifies that old frontends will hang indefinitely if they don't handle `ControlRequestForward`
- A version field is trivial to add (one field on the base outbound message type)
- The frontend can check the version and show "update required" if it doesn't recognize the version
- No full handshake needed -- just a version tag on every outbound message

**Implications:**
- All outbound IPC messages gain `ipc_version?: number` field (optional in Steps 2.1-3 to avoid breaking existing `writeLine` calls in `main.ts` and `session.ts`; made required in Step 4 when those files are updated)
- Set to `2` for this phase (implicit version 1 was the pre-protocol-rewrite era)
- Frontend compatibility check: if `ipc_version > supported`, show upgrade notice

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| IPC contract breakage | high | med | Preserve all existing IPC types; new types are additive only | Frontend reports unrecognized messages |
| ToolApproval semantic change | med | high | Add fields as optional; existing allow/deny callers still work | handleToolApproval callers pass wrong shape |
| Test gap during Steps 1-4 | med | med | Replace tests in Step 0; add incrementally in Steps 1-4; compilation checkpoints; full `bun test` in Step 5 | Build breaks without test feedback |
| PermissionMode type drift | med | med | Explicit task to sync both type definitions in Step 0 | TypeScript compile error on mode mismatch |

**Risk R01: IPC Contract Compatibility** {#r01-ipc-contract}

- **Risk:** The tugcast<->tugtalk IPC contract depends on specific message shapes. Rewriting `handleToolApproval()` to send `control_response` to the CLI changes the semantic behavior -- it previously resolved a pending JS promise, now it also writes to the CLI's stdin. If the frontend sends a `tool_approval` before a `control_request` has been received from the CLI, the control_response will have no matching request_id and may cause a CLI error.
- **Mitigation:**
  - Keep the pending-request map pattern: only allow `handleToolApproval()` to send a `control_response` if there is a matching pending control_request stored by request_id
  - If no pending control_request exists for the given request_id, log a warning and do not write to stdin
  - All existing outbound IPC message types (`assistant_text`, `tool_use`, `tool_result`, `turn_complete`, `turn_cancelled`, `error`, `session_init`) are preserved unchanged
  - New outbound types are additive -- frontends that do not recognize them can safely ignore them
- **Residual risk:** Mitigated by [D15](#d15-ipc-version): all outbound messages carry `ipc_version: 2`. Frontends that only support version 1 can detect the version mismatch and show an upgrade notice rather than silently hanging on missing `ControlRequestForward` messages.

**Risk R02: Test Gap During Implementation** {#r02-test-gap}

- **Risk:** Steps 1-4 make sweeping changes to session.ts, types.ts, and permissions.ts. The existing tests validate the wrong protocol and would fail immediately. Without test coverage, regressions during Steps 1-4 may go undetected.
- **Mitigation:**
  - Step 0 replaces the existing session.test.ts content with new Step 0 tests (buildClaudeArgs + stdin format)
  - Steps 1-4 add tests incrementally for their respective changes
  - Each step has a compilation checkpoint (`bun build --no-bundle`) to catch type errors
  - Step 5 consolidates all tests, fills gaps, and runs `bun test` as the full-suite checkpoint
  - The implementation agent should run `bun build` after every file change, not just at step boundaries
- **Residual risk:** Some tests written in Steps 1-4 may not pass until symbols they depend on are defined in later steps. This is mitigated by the compilation-only checkpoints; `bun test` is deferred to Step 5.

---

### Deep Dives {#deep-dives}

#### Turn Lifecycle Sequences {#turn-lifecycle}

Per protocol reference section 4, the three fundamental turn sequences that the event loop must handle:

**Simple text response (with streaming):**
```
system(init) -> stream_event(message_start) -> stream_event(block_start/text) ->
stream_event(delta/text) x N -> assistant(complete text) -> stream_event(block_stop) ->
stream_event(message_delta) -> stream_event(message_stop) -> result
```

**Tool use (with streaming):**
```
system(init) -> [text streaming] -> assistant(text block) ->
stream_event(block_start/tool_use) -> stream_event(delta/json) x N ->
assistant(tool_use block) -> stream_event(block_stop) ->
user(tool_result) -> [may loop for more tools] -> result
```

**Permission prompt flow (with --permission-prompt-tool stdio):**
```
system(init) -> [streaming] -> assistant(tool_use) ->
control_request(can_use_tool) -> [wait for control_response] ->
user(tool_result) -> ... -> result
```

Key observation: the `assistant` message for each content block is emitted BEFORE the `content_block_stop` stream_event. This means `assistant` serves as the "here's the complete block" signal.

#### Control Protocol Message Catalog {#control-catalog}

**Spec S01: Stdin Control Messages** {#s01-stdin-control}

| Subtype | Direction | Purpose | Fields |
|---------|-----------|---------|--------|
| `interrupt` | stdin `control_request` | Graceful turn cancellation | `request_id`, `request.subtype` |
| `set_permission_mode` | stdin `control_request` | Change permission mode | `request_id`, `request.subtype`, `request.mode` |
| `set_model` | stdin `control_request` | Change model | `request_id`, `request.subtype`, `request.model` |
| `stop_task` | stdin `control_request` | Stop subagent | `request_id`, `request.subtype`, `request.task_id` |
| `success` (allow) | stdin `control_response` | Allow tool use | `response.subtype`, `response.request_id`, `response.response.behavior` (value: `"allow"`, NOT `"decision"`; see [PN-1](#pn-behavior-field)), `response.response.updatedInput` |
| `success` (deny) | stdin `control_response` | Deny tool use | `response.subtype`, `response.request_id`, `response.response.behavior` (value: `"deny"`; see [PN-1](#pn-behavior-field)), `response.response.message` |

**Spec S02: Stdout Control Messages** {#s02-stdout-control}

| Type | Subtype | Purpose | Key Fields |
|------|---------|---------|------------|
| `control_request` | `can_use_tool` | Permission prompt | `request_id`, `request.tool_name`, `request.input`, `request.decision_reason`, `request.permission_suggestions` |
| `control_response` | `success` | Ack of stdin control_request | `response.request_id` |
| `control_cancel_request` | -- | Cancel pending permission | `request_id` |

#### Structured Tool Results Reference {#structured-tool-results-ref}

**Table T01: Tool Result Structured Data** {#t01-tool-results}

| Tool | `tool_use_result` Fields | UI Rendering |
|------|--------------------------|-------------|
| Edit | `filePath`, `oldString`, `newString`, `originalFile`, `structuredPatch[]`, `userModified`, `replaceAll` | Unified diff viewer with hunks |
| Write (new) | `type: "create"`, `filePath`, `content`, `structuredPatch: []`, `originalFile: null` | Full content with syntax highlighting |
| Write (overwrite) | `type: "overwrite"`, `filePath`, `content`, `originalFile`, `structuredPatch[]` | Diff viewer |
| Bash | plain string (same as content) | Terminal-style output |
| Read | file content (cat -n format) | File viewer with syntax highlighting |
| Glob/Grep | matching file paths or content | File list or search results |

**Table T02: structuredPatch Hunk Format** {#t02-patch-format}

| Field | Type | Description |
|-------|------|-------------|
| `oldStart` | number | Start line in original file |
| `oldLines` | number | Number of lines in original |
| `newStart` | number | Start line in modified file |
| `newLines` | number | Number of lines in modified |
| `lines` | string[] | Prefixed lines: `" "` context, `"-"` removed, `"+"` added |

#### Web Frontend Component Catalog {#web-component-catalog}

**Table T03: Custom Web UI Components** {#t03-web-components}

| Component | Replaces | Data Source | Protocol Section |
|-----------|----------|-------------|-----------------|
| Settings panel | /config (TUI-only) | `system.init` + `control_request` set_model/set_permission_mode | sections 2c, 2d, 19a |
| Help panel | /help (TUI-only) | `system.init.tools`, `.slash_commands`, `.skills`, `.agents`, `.plugins` | section 19b |
| Keybindings panel | /keybindings-help | Custom definitions | section 19c |
| Context gauge | /context (enhanced) | `/context` output + `result.usage` + `result.modelUsage` | sections 12, 19d |
| Cost display | /cost (enhanced) | `result.total_cost_usd`, `result.modelUsage` | sections 12, 19e |
| Diff viewer | N/A | `tool_use_result.structuredPatch` | sections 9b, 9c, 19f |
| Task list panel | N/A | TaskCreate/Update/List/Get tool_use events | section 20 |
| MCP server status | N/A | `system.init.mcp_servers` | section 21 |
| Permission dialog | N/A | `control_request` (can_use_tool) | section 5a |
| Question form | N/A | `control_request` (AskUserQuestion) | section 5b |
| Slash command autocomplete | N/A | `system.init.slash_commands` | section 6 |
| Session management | N/A | session_id + --resume/--continue/--fork-session | section 7 |

---

### Protocol Implementation Notes {#protocol-notes}

Exact formats, gotchas, and edge cases extracted from the protocol reference that must be respected during implementation. Implementers: scan this section before coding any step.

#### PN-1: Permission response field is `behavior`, NOT `decision` {#pn-behavior-field}

The Zod PermissionResult schema uses `behavior: "allow"` / `behavior: "deny"`. Sending `{decision: "allow"}` will **fail Zod validation** and silently break the permission flow. (Protocol ref section 2f, line 143)

```jsonc
// CORRECT
{"behavior": "allow", "updatedInput": { ... }}
{"behavior": "deny", "message": "User denied this action"}

// WRONG — will fail Zod validation
{"decision": "allow"}
```

#### PN-2: API errors still have result subtype "success" {#pn-api-error-subtype}

API errors (e.g., "API Error: 400 {...}") are returned as assistant text content. The `result` message still has `subtype: "success"`. Code that only checks `result.subtype` will miss API errors. (Protocol ref section 11a)

#### PN-3: Tool errors have BOTH `is_error: true` AND `<tool_use_error>` tags {#pn-tool-error-dual}

When a tool fails, the tool_result block has `is_error: true` AND the content string is wrapped in `<tool_use_error>...</tool_use_error>` tags. Both conditions are present simultaneously. (Protocol ref section 11b)

```jsonc
{
  "type": "tool_result",
  "tool_use_id": "toolu_xxx",
  "content": "<tool_use_error>File does not exist.</tool_use_error>",
  "is_error": true   // BOTH are present
}
```

#### PN-4: `tool_use_result` is on the OUTER message, NOT inside `tool_result` {#pn-tool-use-result-location}

The structured `tool_use_result` field is on the outer `user` message object, NOT inside the `tool_result` content block. The content block has only `tool_use_id`, `content` (string), and `is_error`. (Protocol ref section 9, lines 568-572)

```jsonc
// OUTER user message — this is where tool_use_result lives
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "success text", "is_error": false}
    ]
  },
  "tool_use_result": { "filePath": "...", "structuredPatch": [...] }  // HERE, not inside content
}
```

#### PN-5: multiSelect answers use comma-separated labels {#pn-multiselect-format}

For AskUserQuestion with `multiSelect: true`, the answer value is a comma-separated string of selected labels: `"Red,Blue"` (no spaces). (Protocol ref section 5b, line 429)

#### PN-6: Missing result subtypes beyond success/error {#pn-result-subtypes}

Complete list of result subtypes (protocol ref section 3d, lines 272-276):

| Subtype | Meaning |
|---------|---------|
| `success` | Normal completion |
| `error_during_execution` | Runtime error or interrupt |
| `error_max_turns` | Hit `--max-turns` limit |
| `error_max_budget_usd` | Hit `--max-budget-usd` limit |
| `error_max_structured_output_retries` | Schema validation failed too many times |

#### PN-7: Permission suggestions are a discriminated union {#pn-permission-suggestions}

`permission_suggestions` in control_request has three types with different fields (protocol ref section 5a, lines 373-377):

| `type` | Extra Fields |
|--------|-------------|
| `addDirectories` | `directories: string[]` |
| `addRules` | `rules: Array<{toolName: string, ruleContent: string}>` |
| `setMode` | `mode: "acceptEdits" \| "bypassPermissions"` |

All three also carry `destination: "session" | "projectSettings" | "userSettings"`.

#### PN-8: `parent_tool_use_id` appears on ALL 5 message types {#pn-parent-tool-use-id-scope}

`parent_tool_use_id` is present on `system`, `assistant`, `user`, `result`, AND `stream_event` messages from subagent contexts. Not just assistant messages. (Protocol ref section 15, line 939)

#### PN-9: System init carries `cwd` field {#pn-system-init-cwd}

The system init message includes `cwd: "/working/dir"` — the working directory of the Claude process. (Protocol ref section 3a, line 169)

#### PN-10: `modelUsage` keys are full model IDs {#pn-model-usage-keys}

`modelUsage` keys are full model version strings like `"claude-sonnet-4-5-20250929"`, NOT short aliases like `"sonnet"`. (Protocol ref section 12)

#### PN-11: `modelUsage` includes `contextWindow` and `maxOutputTokens` {#pn-model-usage-extra-fields}

Each entry in `modelUsage` includes `contextWindow` (number) and `maxOutputTokens` (number) alongside token counts and cost. (Protocol ref section 12, lines 789-790)

```jsonc
{
  "claude-sonnet-4-5-20250929": {
    "inputTokens": 100, "outputTokens": 50,
    "cacheReadInputTokens": 15000, "cacheCreationInputTokens": 400,
    "costUSD": 0.042,
    "contextWindow": 200000,   // <-- often missed
    "maxOutputTokens": 64000   // <-- often missed
  }
}
```

#### PN-12: Image media types and size limit {#pn-image-limits}

Supported: exactly `image/png`, `image/jpeg`, `image/gif`, `image/webp`. Max size ~5MB per Anthropic API limits. (Protocol ref section 8b, line 552-553)

#### PN-13: Exact tag names for local command output {#pn-local-command-tags}

Slash command output uses these exact XML-like tag names (protocol ref sections 6, 13c):

- Success: `<local-command-stdout>...</local-command-stdout>`
- Error: `<local-command-stderr>...</local-command-stderr>`

#### PN-14: Permission mode semantics {#pn-permission-mode-semantics}

| Mode | Behavior |
|------|----------|
| `dontAsk` | Auto-**deny** permission prompts, BUT tools on the `allowedTools` list still work |
| `delegate` | Team management tools only (Task, TodoRead, TodoWrite), no direct implementation tools |

(Protocol ref section 19a, lines 1134-1136)

#### PN-15: MCP tool naming uses double underscore separator {#pn-mcp-naming}

MCP tools follow pattern `mcp__<server>__<tool>` — that is double underscore `__` on both sides of the server name. (Protocol ref section 21b)

Examples: `mcp__github__search_repositories`, `mcp__memory__create_entities`

#### PN-16: `content_block_start` carries tool name for tool_use blocks {#pn-block-start-tool-name}

When `event.content_block.type === "tool_use"`, the `content_block_start` event also carries `event.content_block.name` (e.g., `"Read"`, `"Bash"`). Use this to show the tool name in the UI before streaming begins. (Protocol ref section 3e, line 292)

#### PN-17: Slash commands sent as regular user messages {#pn-slash-commands-as-messages}

Slash commands like `/cost` or `/compact` are sent as ordinary user messages on stdin. Example:

```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"/cost"}]},"parent_tool_use_id":null}
```

The CLI handles dispatch internally. Output returns as a `user` message with `isReplay: true` and content wrapped in `<local-command-stdout>` or `<local-command-stderr>` tags.

#### PN-18: Session-scoped permissions NOT restored on resume {#pn-session-permissions-resume}

When resuming a session with `--resume`, session-scoped permissions are NOT restored. Users must re-approve tools. (Protocol ref section 7b, line 472)

#### PN-19: `duration_api_ms` is a separate field from `duration_ms` {#pn-duration-fields}

The result message carries both `duration_ms` (total wall-clock time) and `duration_api_ms` (time spent in API calls only). Both should be captured. (Protocol ref section 3d, lines 264-265)

#### PN-20: `--replay-user-messages` flag required for slash command detection {#pn-replay-flag-required}

Without `--replay-user-messages` in spawn args, user messages with `isReplay: true` are never emitted. This means slash command output (`<local-command-stdout>`) will never be seen. Step 2.3 depends on this flag. (Protocol ref section 1, line 36)

#### PN-21: Hook-induced missing control prompts {#pn-hook-resilience}

Hooks (section 22) can auto-resolve permission prompts before they reach the control protocol. When this happens, the web frontend sees `tool_result` messages without ever receiving a `control_request` for that tool. This is normal -- NOT an error. The event loop must:

- Process `tool_result` messages regardless of whether a `control_request` was seen for that tool
- Not assume every `tool_use` will be followed by a `control_request` before the `tool_result`
- Handle result messages arriving "early" (Stop hooks can prevent Claude from stopping, causing unexpected continuations)

No dedicated tests required -- this is a defensive coding constraint, not a feature.

---

### 2.0.1 Specification {#specification}

#### 2.0.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs (from web frontend via IPC stdin):**
- `user_message`: text + optional attachments (images as base64 content blocks)
- `tool_approval`: allow/deny for pending permission prompt
- `question_answer`: answers for AskUserQuestion prompt
- `interrupt`: graceful turn cancellation
- `permission_mode`: change permission mode
- `model_change`: change model (new)
- `session_command`: fork, continue, new session (new)

**Outputs (to web frontend via IPC stdout):**
- Existing: `session_init`, `assistant_text`, `tool_use`, `tool_result`, `turn_complete`, `turn_cancelled`, `error`
- New: `system_metadata` (session init metadata), `control_request_forward` (permission/question prompts), `thinking_text` (extended thinking), `cost_update` (per-turn cost), `tool_use_structured` (rich tool results), `compact_boundary` (context compaction marker)

**Key invariants:**
- Every turn begins with a `system` init message and ends with a `result` message
- `session_id` is consistent across turns; captured from `system` init
- Cost/usage values in `result` are CUMULATIVE across the session
- `control_request` from stdout MUST receive a `control_response` on stdin

#### 2.0.1.2 Terminology {#terminology}

- **Turn**: One user message followed by Claude's complete response (may include multiple tool uses)
- **Content block**: A single item in the `message.content` array: `text`, `tool_use`, `thinking`, `tool_result`, `image`
- **Stream event**: A wrapper `{type: "stream_event", event: {...}}` around raw Anthropic API streaming events
- **Control request**: A `{type: "control_request", request_id: "...", request: {...}}` message for permission prompts, question prompts, or CLI-to-frontend requests
- **Control response**: A `{type: "control_response", response: {...}}` message answering a control request
- **Structured patch**: Array of unified-diff hunks from Edit/Write tool results
- **Subagent**: A Claude instance spawned via the Task tool, with events tagged by `parent_tool_use_id`

#### 2.0.1.3 Supported Features {#supported-features}

- **Supported:**
  - All 8 stdout message types (system, assistant, user, result, stream_event, control_request, control_response, keep_alive) plus control_cancel_request
  - Full permission prompt flow (tool permissions + AskUserQuestion)
  - Graceful interrupt via control_request
  - Extended thinking streaming and complete blocks
  - Structured tool results (Edit structuredPatch, Write type/content)
  - Subagent event tagging via parent_tool_use_id
  - Session management (new, resume, continue, fork)
  - Slash command passthrough (sent as regular user messages per [PN-17](#pn-slash-commands-as-messages), e.g., `/cost` sent as `{type:"user",session_id:"",message:{role:"user",content:[{type:"text",text:"/cost"}]},parent_tool_use_id:null}`)
  - Image/file content blocks in user messages
  - Context compaction markers
  - Cost/usage tracking (cumulative with per-turn delta)
  - Model and permission mode changes via control_request
  - MCP tool event routing
  - Task/Todo tool event routing

- **Explicitly not supported (this phase):**
  - MCP server OAuth/authentication management
  - Hook configuration or event interception
  - Actual HTML/CSS web UI rendering

---

### 2.0.2 Symbol Inventory {#symbol-inventory}

#### 2.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugtalk/src/control.ts` | Control protocol message types and helpers (sendControlRequest, sendControlResponse) |
| `tugtalk/src/protocol-types.ts` | Full protocol message type definitions matching all 23 sections |
| `tugtalk/src/web-components.ts` | Web frontend component type scaffolding (settings, help, diff, task, cost) |
| `tugtalk/src/__tests__/control.test.ts` | Tests for control protocol |

#### 2.0.2.2 Symbols to modify {#symbols-modify}

| Symbol | Kind | Location | Change |
|--------|------|----------|--------|
| `buildClaudeArgs()` | fn | `session.ts` | Remove `-p`, add `--permission-prompt-tool stdio`, add `--replay-user-messages` per [PN-20](#pn-replay-flag-required), support fork/continue |
| `ClaudeSpawnConfig` | interface | `session.ts` | Add `continue?`, `forkSession?`, `sessionIdOverride?`, `permissionPromptTool?` |
| `handleUserMessage()` | method | `session.ts` | Fix stdin format, add two-tier routing, handle control_request, structured results |
| `mapStreamEvent()` | fn | `session.ts` | Remove session_id capture, add thinking support, receive unwrapped events only |
| `EventMappingResult` | interface | `session.ts` | Remove `sessionId`, add `thinkingText` |
| `handleInterrupt()` | method | `session.ts` | Replace SIGINT with control_request interrupt via stdin |
| `handleToolApproval()` | method | `session.ts` | Send control_response to claude stdin |
| `handleQuestionAnswer()` | method | `session.ts` | Send control_response with answers in updatedInput |
| `PermissionMode` | type | `permissions.ts` | Add `dontAsk` and `delegate` modes |
| `PermissionModeMessage` | interface | `types.ts` | Sync `.mode` inline union with `PermissionMode`: add `dontAsk`, `delegate` |
| `ToolApproval` | interface | `types.ts` | Add optional `updatedInput?: Record<string, unknown>` and `message?: string` for control_response formatting |
| `OutboundMessage` | type | `types.ts` | Add new IPC message types; add `ipc_version: number` to base type per [D15](#d15-ipc-version) |
| `InboundMessage` | type | `types.ts` | Add model_change, session_command types |
| `isInboundMessage()` | fn | `types.ts` | Add `model_change` and `session_command` to accepted types |

#### 2.0.2.3 Symbols to add {#symbols-add}

| Symbol | Kind | Location | Purpose |
|--------|------|----------|---------|
| `routeTopLevelEvent()` | fn | `session.ts` | Top-level event dispatcher for all 8+ stdout types |
| `TopLevelRoutingResult` | interface | `session.ts` | Return type: messages, gotResult, sessionId, streamEvent, controlRequest |
| `sendControlRequest()` | fn | `control.ts` | Write control_request to claude stdin (interrupt, set_model, etc.) |
| `sendControlResponse()` | fn | `control.ts` | Write control_response to claude stdin (permission allow/deny, question answers) |
| `formatPermissionAllow()` | fn | `control.ts` | Format allow response with updatedInput per Zod schema |
| `formatPermissionDeny()` | fn | `control.ts` | Format deny response with message per Zod schema |
| `formatQuestionAnswer()` | fn | `control.ts` | Format AskUserQuestion answer with answers map in updatedInput; multiSelect uses comma-separated labels per [PN-5](#pn-multiselect-format) |
| `ControlRequest` | interface | `protocol-types.ts` | Stdin control_request type |
| `ControlResponse` | interface | `protocol-types.ts` | Stdin control_response type |
| `SystemInitMessage` | interface | `protocol-types.ts` | Full system init with tools, model, **cwd** per [PN-9](#pn-system-init-cwd), etc. |
| `ResultMessage` | interface | `protocol-types.ts` | Full result with cost, usage, modelUsage (**contextWindow**, **maxOutputTokens** per [PN-11](#pn-model-usage-extra-fields)), **duration_api_ms** per [PN-19](#pn-duration-fields) |
| `PermissionRequest` | interface | `protocol-types.ts` | control_request for can_use_tool |
| `AskUserQuestionRequest` | interface | `protocol-types.ts` | control_request for AskUserQuestion |
| `PermissionSuggestion` | interface | `protocol-types.ts` | Discriminated union: `addDirectories` (directories[]), `addRules` (rules[{toolName,ruleContent}]), `setMode` (mode) per [PN-7](#pn-permission-suggestions) |
| `StructuredPatchHunk` | interface | `protocol-types.ts` | Unified diff hunk from structuredPatch |
| `EditToolResult` | interface | `protocol-types.ts` | Structured Edit tool_use_result |
| `WriteToolResult` | interface | `protocol-types.ts` | Structured Write tool_use_result |
| `ThinkingText` | interface | `types.ts` | New IPC message type for thinking blocks |
| `ControlRequestForward` | interface | `types.ts` | New IPC message forwarding control_request to frontend |
| `SystemMetadata` | interface | `types.ts` | New IPC message with session metadata (tools, model, **cwd** per [PN-9](#pn-system-init-cwd), etc.) |
| `CostUpdate` | interface | `types.ts` | New IPC message with turn cost data (**duration_api_ms** per [PN-19](#pn-duration-fields), **contextWindow**/**maxOutputTokens** per [PN-11](#pn-model-usage-extra-fields)) |
| `ToolUseStructured` | interface | `types.ts` | New IPC message with structured tool result data |
| `CompactBoundary` | interface | `types.ts` | New IPC message for context compaction marker |
| `SessionState` | interface | `web-components.ts` | Web frontend state types |
| `SettingsPanel` | interface | `web-components.ts` | Settings panel data types |
| `HelpPanel` | interface | `web-components.ts` | Help panel data types |
| `DiffViewer` | interface | `web-components.ts` | Diff viewer data types |
| `TaskListPanel` | interface | `web-components.ts` | Task list data types |
| `CostDisplay` | interface | `web-components.ts` | Cost display data types |
| `ContextGauge` | interface | `web-components.ts` | Context gauge data types |
| `ModelChange` | interface | `types.ts` | New inbound IPC message for model changes |
| `SessionCommand` | interface | `types.ts` | New inbound IPC message for session fork/continue/new |
| `isModelChange()` | fn | `types.ts` | Type guard for ModelChange |
| `isSessionCommand()` | fn | `types.ts` | Type guard for SessionCommand |

---

### 2.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test exported functions in isolation | `buildClaudeArgs`, `mapStreamEvent`, `routeTopLevelEvent`, control helpers |
| **Integration** | Test `handleUserMessage` loop with mock subprocess | Full round-trip with protocol-compliant mock events |
| **Behavioral** | Test SessionManager methods without spawning claude | `handleToolApproval`, `handleQuestionAnswer`, `handleInterrupt` |
| **Protocol conformance** | Verify messages match protocol reference exactly | Stdin format, stdout parsing, control protocol Zod schema |

All tests rewritten from scratch. Mock infrastructure rebuilt to emit events matching the protocol reference.

---

### 2.0.4 Execution Steps {#execution-steps}

> **Test strategy:** Each step lists tests in its Tests section. Steps 0-4 write tests incrementally into `session.test.ts` (and other test files as specified). Step 0 replaces the existing (wrong-protocol) tests with new Step 0 tests; Steps 1-4 add tests for their respective changes. Each step's checkpoint includes compilation only (`bun build --no-bundle`), not `bun test`, because tests may reference symbols not yet implemented. Step 5 consolidates all tests, fills gaps, and runs `bun test` as its checkpoint. See [R02](#r02-test-gap) for rationale.

#### Step 0: Fix CLI spawn arguments and stdin message format {#step-0}

**Commit:** `fix(tugtalk): correct CLI spawn args and stdin message format per protocol reference`

**References:** [D01] Remove -p flag, [D02] Correct stdin user format, [D06] Permission prompts via stdio, [D10] Session forking, Spec S01, (#d01-no-p-flag, #d02-stdin-user-format, #d06-permission-prompts, #d10-session-forking, #s01-stdin-control)

**Artifacts:**
- Modified `tugtalk/src/session.ts`: `buildClaudeArgs()` (add `--permission-prompt-tool stdio`, conditional fork/continue/session-id flags, verify existing flags) and `handleUserMessage()` stdin write
- Modified `tugtalk/src/permissions.ts`: add `dontAsk` and `delegate` modes
- Modified `tugtalk/src/types.ts`: sync `PermissionModeMessage.mode` union with new permission modes
- Replaced `tugtalk/src/__tests__/session.test.ts` content with Step 0 tests (buildClaudeArgs + stdin format); remaining tests added incrementally in Steps 1-4 and consolidated in Step 5

**Tasks:**
- [ ] In `buildClaudeArgs()`, verify `-p` is NOT in the args array (already removed in prior work; must not be reintroduced per protocol reference section 1)
- [ ] In `buildClaudeArgs()`, ADD `--permission-prompt-tool`, `stdio` to args (enables control protocol per section 5)
- [ ] In `buildClaudeArgs()`, verify `--replay-user-messages` is present in args (already added in prior work; required for slash command output detection per [PN-20](#pn-replay-flag-required) and section 1 line 36; Step 2.3 depends on `isReplay: true` messages)
- [ ] Extend `ClaudeSpawnConfig` with optional fields: `continue?: boolean`, `forkSession?: boolean`, `sessionIdOverride?: string`
- [ ] In `buildClaudeArgs()`, add `--continue` when `config.continue` is true
- [ ] In `buildClaudeArgs()`, add `--fork-session` when `config.forkSession` is true
- [ ] In `buildClaudeArgs()`, add `--session-id`, `config.sessionIdOverride` when set
- [ ] In `buildClaudeArgs()`, validate session flag combinations: throw if more than one of `sessionId`, `continue`, `sessionIdOverride` is set; throw if `forkSession` is true but neither `sessionId` nor `continue` is set. Per [D10](#d10-session-forking) implications -- invalid combinations must fail at build time, not at CLI runtime
- [ ] In `handleUserMessage()`, change the stdin JSON from `{type: "user_message", text: msg.text}` to `{type: "user", session_id: "", message: {role: "user", content: [{type: "text", text: msg.text}]}, parent_tool_use_id: null}`
- [ ] In `permissions.ts`, add `"dontAsk"` and `"delegate"` to the `PermissionMode` type
- [ ] In `types.ts`, update `PermissionModeMessage.mode` inline union to add `"dontAsk"` and `"delegate"` (this is a SEPARATE type definition from `PermissionMode` in `permissions.ts` -- both must be updated in sync). Current definition at types.ts line 47: `mode: "default" | "acceptEdits" | "bypassPermissions" | "plan"` must become `mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "delegate"`
- [ ] Replace all existing test content in `tugtalk/src/__tests__/session.test.ts` with new tests for Step 0 changes (buildClaudeArgs args verification and stdin message format). The existing tests validate the wrong protocol and must be replaced, not preserved. The new tests are listed in the Tests section below

**Tests:**
- [ ] Unit test: `buildClaudeArgs` with default config does NOT include `-p`
- [ ] Unit test: `buildClaudeArgs` includes `--permission-prompt-tool`, `stdio`
- [ ] Unit test: `buildClaudeArgs` includes `--replay-user-messages`
- [ ] Unit test: `buildClaudeArgs` with `sessionId: "abc"` includes `--resume "abc"`
- [ ] Unit test: `buildClaudeArgs` with `continue: true` includes `--continue`
- [ ] Unit test: `buildClaudeArgs` with `forkSession: true` includes `--fork-session`
- [ ] Unit test: `buildClaudeArgs` throws if both `sessionId` and `continue` are set
- [ ] Unit test: `buildClaudeArgs` throws if `forkSession` is true without `sessionId` or `continue`
- [ ] Unit test: stdin write produces correct `{type: "user", session_id: "", ...}` envelope (via mock stdin spy)

**Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Revert targeted changes in `buildClaudeArgs()`, `handleUserMessage()`, and `permissions.ts`

**Commit after all checkpoints pass.**

---

#### Step 1: Implement two-tier event routing {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugtalk): add two-tier event routing for all stdout message types`

**References:** [D03] Two-tier event routing, [D04] Session ID from system init, [D12] Extended thinking, [D13] Subagent events, (#d03-event-routing, #d04-session-id-capture, #d12-extended-thinking, #d13-subagent-events, #turn-lifecycle)

**Artifacts:**
- Modified `tugtalk/src/session.ts`: new `routeTopLevelEvent()`, refactored event loop, updated `mapStreamEvent()`

**Tasks:**
- [ ] Create `TopLevelRoutingResult` interface: `messages: OutboundMessage[]`, `gotResult: boolean`, `sessionId?: string`, `streamEvent?: Record<string, unknown>`, `controlRequest?: Record<string, unknown>`, `parentToolUseId?: string`
- [ ] Create `routeTopLevelEvent()` that switches on `event.type`:
  - `"system"`: if `subtype === "init"`, capture `session_id` and store raw metadata fields (tools, model, permissionMode, slash_commands, plugins, agents, skills, claude_code_version) on the routing result for later IPC emission in Step 3; if `subtype === "compact_boundary"`, emit compact boundary marker
  - `"assistant"`: extract content blocks -- text blocks to `assistant_text` (complete), tool_use blocks to `tool_use`, thinking blocks to `thinking_text`; preserve `parent_tool_use_id`
  - `"user"`: emit `tool_result` IPC for each `tool_result` block in `message.content` (basic routing only -- structured result extraction via `tool_use_result`, slash command output parsing via `isReplay`/`<local-command-stdout>`, and `<tool_use_error>` tag handling are deferred to Step 2.3; note: tool results may arrive without a preceding control_request due to hooks per [PN-21](#pn-hook-resilience) -- process regardless)
  - `"result"`: set `gotResult: true`; extract and store cost/usage data (total_cost_usd, duration_ms, duration_api_ms per [PN-19](#pn-duration-fields), usage, modelUsage, permission_denials) on the routing result; emit `turn_complete` with subtype; handle `error_max_budget_usd` and `error_max_structured_output_retries` subtypes per [PN-6](#pn-result-subtypes); note: API errors still have subtype `"success"` per [PN-2](#pn-api-error-subtype) -- check assistant text content for "API Error:" prefix. IPC emission of `CostUpdate` deferred to Step 3 after types are defined in Step 2.1
  - `"stream_event"`: return unwrapped `event.event` as `streamEvent` for delegation to `mapStreamEvent()`
  - `"control_request"`: return as `controlRequest` for handling in the event loop
  - `"control_response"`: resolve pending control request by `request_id`
  - `"keep_alive"`: ignore
  - `"control_cancel_request"`: cancel pending permission dialog
  - default: log unhandled type
- [ ] Refactor `handleUserMessage()` event loop: call `routeTopLevelEvent()` first; if returns `streamEvent`, delegate to `mapStreamEvent()`; if returns `controlRequest`, handle permission/question flow
- [ ] Remove `sessionId` field from `EventMappingResult` interface
- [ ] Remove session_id capture from `mapStreamEvent()`
- [ ] In `mapStreamEvent()`, add `thinking_delta` handling: accumulate thinking text, emit `thinking_text` IPC
- [ ] In `mapStreamEvent()`, for `content_block_start` with `type: "tool_use"`, extract `event.content_block.name` (the tool name, e.g. `"Read"`) and emit it in the IPC message so the UI can show the tool name before streaming begins per [PN-16](#pn-block-start-tool-name)
- [ ] Remove top-level `assistant` and `result` handling from `mapStreamEvent()` (now handled by router)
- [ ] Preserve `parent_tool_use_id` from ALL 5 top-level message types (`system`, `assistant`, `user`, `result`, `stream_event`) per [PN-8](#pn-parent-tool-use-id-scope) and pass through to IPC messages

**Tests:**
- [ ] Unit test: `routeTopLevelEvent` with system/init captures `session_id` and metadata
- [ ] Unit test: `routeTopLevelEvent` with system/compact_boundary emits marker
- [ ] Unit test: `routeTopLevelEvent` with assistant text content emits complete `assistant_text`
- [ ] Unit test: `routeTopLevelEvent` with assistant tool_use blocks emits `tool_use`
- [ ] Unit test: `routeTopLevelEvent` with assistant thinking blocks emits `thinking_text`
- [ ] Unit test: `routeTopLevelEvent` with result/success emits `turn_complete` (cost_update emission tested in Step 3)
- [ ] Unit test: `routeTopLevelEvent` with result/error_during_execution emits error turn_complete
- [ ] Unit test: `routeTopLevelEvent` with result/error_max_turns emits correct subtype
- [ ] Unit test: `routeTopLevelEvent` with result/error_max_budget_usd emits correct subtype
- [ ] Unit test: `routeTopLevelEvent` with result/error_max_structured_output_retries emits correct subtype
- [ ] Unit test: `routeTopLevelEvent` with result/success but assistant text "API Error: 400..." detects API error per [PN-2](#pn-api-error-subtype)
- [ ] Unit test: `routeTopLevelEvent` with stream_event returns unwrapped inner event
- [ ] Unit test: `routeTopLevelEvent` with user/tool_result emits `tool_result` per block (basic routing; structured/slash deferred to Step 2.3)
- [ ] Unit test: `routeTopLevelEvent` with control_request returns it for handling
- [ ] Unit test: `routeTopLevelEvent` with keep_alive produces nothing
- [ ] Unit test: `routeTopLevelEvent` preserves parent_tool_use_id from all 5 message types (system, assistant, user, result, stream_event) per [PN-8](#pn-parent-tool-use-id-scope)
- [ ] Unit test: `mapStreamEvent` with content_block_start/tool_use extracts tool name per [PN-16](#pn-block-start-tool-name)
- [ ] Unit test: `mapStreamEvent` with thinking_delta emits `thinking_text`
- [ ] Unit test: `mapStreamEvent` with content_block_delta/text_delta still works correctly
- [ ] Unit test: `mapStreamEvent` no longer has `sessionId` in result

**Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Revert session.ts changes for routeTopLevelEvent, event loop refactor, mapStreamEvent updates

**Commit after all checkpoints pass.**

---

#### Step 2: Implement control protocol and permission flow {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugtalk): implement control protocol and permission flow`

**References:** [D05] Control protocol types, [D06] Permission prompts, [D07] Graceful interrupt, [D09] Direct CLI spawning, [D11] Structured tool results, Spec S01, Spec S02, (#d05-control-protocol, #d06-permission-prompts, #d07-graceful-interrupt, #d09-direct-cli, #d11-structured-tool-results, #control-catalog, #structured-tool-results-ref)

**Tasks:**
- [ ] Implement substeps 2.1, 2.2, and 2.3 in sequence

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

> This step is large. Broken into substeps by functional area.

##### Step 2.1: Control protocol types and helpers {#step-2-1}

**Commit:** `feat(tugtalk): add control protocol types and send/receive helpers`

**References:** [D05] Control protocol types, [D06] Permission prompts, [D15] IPC protocol version, Spec S01, Spec S02, (#d05-control-protocol, #d06-permission-prompts, #d15-ipc-version, #s01-stdin-control, #s02-stdout-control, #control-catalog)

**Artifacts:**
- New `tugtalk/src/control.ts`
- New `tugtalk/src/protocol-types.ts`
- Modified `tugtalk/src/types.ts`: new IPC message types

**Tasks:**
- [ ] Create `protocol-types.ts` with interfaces for all protocol messages:
  - `SystemInitMessage`: full section 3a fields (session_id, **cwd** per [PN-9](#pn-system-init-cwd), tools, model, permissionMode, slash_commands, skills, agents, plugins, mcp_servers, claude_code_version, output_style, fast_mode_state, apiKeySource)
  - `ResultMessage`: section 3d fields (subtype including `error_max_budget_usd` and `error_max_structured_output_retries` per [PN-6](#pn-result-subtypes), session_id, is_error, result, total_cost_usd, num_turns, **duration_ms**, **duration_api_ms** per [PN-19](#pn-duration-fields), usage, modelUsage with per-model `contextWindow` and `maxOutputTokens` per [PN-11](#pn-model-usage-extra-fields), permission_denials)
  - `ControlRequest`: section 5a fields (request_id, request.subtype, request.tool_name, request.input, request.tool_use_id, request.decision_reason, request.blocked_path, request.permission_suggestions)
  - `PermissionSuggestion`: section 5a, **discriminated union** per [PN-7](#pn-permission-suggestions): `{type: "addDirectories", directories: string[], destination}` | `{type: "addRules", rules: Array<{toolName: string, ruleContent: string}>, destination}` | `{type: "setMode", mode: "acceptEdits" | "bypassPermissions", destination}`
  - `AskUserQuestionInput`: section 5b (questions array with question, header, multiSelect, options)
  - `StructuredPatchHunk`: section 9b (oldStart, oldLines, newStart, newLines, lines)
  - `EditToolResult`: section 9b (filePath, oldString, newString, originalFile, structuredPatch, userModified, replaceAll)
  - `WriteToolResult`: section 9c (type: create|overwrite, filePath, content, structuredPatch, originalFile)
- [ ] Create `control.ts` with send/receive helpers:
  - `sendControlRequest(stdin, requestId, request)`: serialize and write control_request to stdin
  - `sendControlResponse(stdin, response)`: serialize and write control_response to stdin
  - `formatPermissionAllow(requestId, updatedInput)`: format allow response matching Zod schema (behavior: "allow", updatedInput required)
  - `formatPermissionDeny(requestId, message)`: format deny response matching Zod schema (behavior: "deny", message required)
  - `formatQuestionAnswer(requestId, originalInput, answers)`: format AskUserQuestion response with answers map injected into updatedInput; for `multiSelect: true` questions, answer value must be comma-separated labels with no spaces (e.g., `"Red,Blue"`) per [PN-5](#pn-multiselect-format)
  - `generateRequestId()`: generate unique request_id for outbound control_requests
- [ ] In `types.ts`, add new outbound IPC message types:
  - `ControlRequestForward`: forward control_request to frontend (request_id, tool_name, input, decision_reason, permission_suggestions, is_question)
  - `ThinkingText`: thinking block (msg_id, seq, text, is_partial, status)
  - `SystemMetadata`: session metadata (session_id, **cwd** per [PN-9](#pn-system-init-cwd), tools, model, permissionMode, slash_commands, plugins, agents, skills, version)
  - `CostUpdate`: turn cost data (total_cost_usd, num_turns, duration_ms, **duration_api_ms** per [PN-19](#pn-duration-fields), usage, modelUsage with **contextWindow** and **maxOutputTokens** per [PN-11](#pn-model-usage-extra-fields))
  - `CompactBoundary`: context compaction marker
  - `ToolUseStructured`: structured tool result with diff data (tool_use_id, tool_name, structured_result)
- [ ] Add `ipc_version?: number` field (optional) to the base outbound message type. Set to `2` on all NEW outbound types created in this step. Existing `writeLine` calls in `main.ts` and `session.ts` are not yet updated — the field is optional to avoid compile breaks. Made required in Step 4 per [D15](#d15-ipc-version)
- [ ] Add all new types to the `OutboundMessage` union

**Tests:**
- [ ] Unit test: `formatPermissionAllow` produces correct Zod-schema-compliant JSON
- [ ] Unit test: `formatPermissionDeny` produces correct Zod-schema-compliant JSON
- [ ] Unit test: `formatQuestionAnswer` injects answers map into updatedInput alongside original questions
- [ ] Unit test: `formatQuestionAnswer` with multiSelect answer uses comma-separated labels `"Red,Blue"` per [PN-5](#pn-multiselect-format)
- [ ] Unit test: `sendControlRequest` serializes with request_id and request.subtype
- [ ] Unit test: `sendControlResponse` serializes with response.subtype and response.request_id
- [ ] Unit test: `generateRequestId` produces unique IDs

**Checkpoint:**
- [ ] `bun build tugtalk/src/control.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/protocol-types.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/types.ts --no-bundle` compiles without errors

**Rollback:**
- Delete new files, revert types.ts changes

**Commit after all checkpoints pass.**

---

##### Step 2.2: Wire control protocol into event loop {#step-2-2}

**Depends on:** #step-2-1

**Commit:** `feat(tugtalk): wire control protocol into session event loop`

**References:** [D05] Control protocol types, [D07] Graceful interrupt, (#d05-control-protocol, #d07-graceful-interrupt, #control-catalog)

**Artifacts:**
- Modified `tugtalk/src/session.ts`: event loop handles control_request, handleInterrupt uses control_request, handleToolApproval/handleQuestionAnswer send control_response
- Modified `tugtalk/src/types.ts`: update `ToolApproval` interface with fields needed for control_response formatting; update `isToolApproval` type guard

**Tasks:**
- [ ] In `types.ts`, update `ToolApproval` interface (currently has only `request_id` and `decision: "allow" | "deny"`) to add fields required for formatting control_response messages:
  - Add `updatedInput?: Record<string, unknown>` (required when decision is "allow" -- carries the original tool input, possibly modified by user)
  - Add `message?: string` (required when decision is "deny" -- the denial reason message)
  - These fields map directly to the Zod PermissionResult schema: `behavior: "allow"` requires `updatedInput`, `behavior: "deny"` requires `message`
- [ ] Update `isToolApproval` type guard if needed (the `type: "tool_approval"` check remains sufficient since the new fields are optional)
- [ ] In the event loop, when `routeTopLevelEvent()` returns a `controlRequest`:
  - If `request.subtype === "can_use_tool"` and `request.tool_name === "AskUserQuestion"`: emit `ControlRequestForward` IPC with `is_question: true`, store pending question with `request_id`
  - If `request.subtype === "can_use_tool"` (other tools): emit `ControlRequestForward` IPC with `is_question: false`, store pending approval with `request_id`
  - Store the raw control_request for response correlation
- [ ] Rewrite `handleToolApproval()`: look up pending control_request by request_id, format and send `control_response` to claude stdin using `sendControlResponse()` + `formatPermissionAllow()`/`formatPermissionDeny()`
- [ ] Rewrite `handleQuestionAnswer()`: look up pending control_request by request_id, format and send `control_response` with `formatQuestionAnswer()` (answers map in updatedInput)
- [ ] Rewrite `handleInterrupt()`: instead of `process.kill("SIGINT")`, call `sendControlRequest(stdin, generateRequestId(), {subtype: "interrupt"})` and track the pending response
- [ ] Handle `control_cancel_request` from stdout: cancel pending permission dialog by request_id, emit IPC message to frontend
- [ ] Handle `control_response` from stdout: resolve pending outbound control_request (for interrupt, set_model, etc.)
- [ ] Add `handleModelChange()` method: send `control_request` with `{subtype: "set_model", model: "..."}` to stdin
- [ ] Update `handlePermissionMode()`: optionally send `control_request` with `{subtype: "set_permission_mode", mode: "..."}` to stdin in addition to updating local state

**Tests:**
- [ ] Unit test: control_request with can_use_tool emits ControlRequestForward IPC
- [ ] Unit test: control_request with AskUserQuestion emits ControlRequestForward with is_question: true
- [ ] Unit test: handleToolApproval("allow") sends correct control_response to stdin
- [ ] Unit test: handleToolApproval("deny") sends correct control_response to stdin
- [ ] Unit test: handleQuestionAnswer sends control_response with answers in updatedInput
- [ ] Unit test: handleInterrupt sends control_request with subtype "interrupt" to stdin (NOT SIGINT)
- [ ] Unit test: control_cancel_request cancels pending permission
- [ ] Unit test: handleModelChange sends control_request with subtype "set_model"

**Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Revert session.ts control protocol wiring

**Commit after all checkpoints pass.**

---

##### Step 2.3: Structured tool results and user message parsing {#step-2-3}

**Depends on:** #step-2-2

**Commit:** `feat(tugtalk): add structured tool result parsing and user message routing`

**References:** [D11] Structured tool results, Table T01, Table T02, (#d11-structured-tool-results, #t01-tool-results, #t02-patch-format, #structured-tool-results-ref)

**Artifacts:**
- Modified `tugtalk/src/session.ts`: user message routing with structured result extraction

**Tasks:**
- [ ] In `routeTopLevelEvent()` for `type: "user"` messages:
  - Parse `message.content` array for `tool_result` blocks
  - For each `tool_result`, emit `tool_result` IPC with `tool_use_id`, `output` (content), `is_error`; note: tool errors have BOTH `is_error: true` AND content wrapped in `<tool_use_error>...</tool_use_error>` tags simultaneously per [PN-3](#pn-tool-error-dual) -- strip the tags for display but preserve `is_error` flag
  - Check outer message for `tool_use_result` field (on the **outer** user message object, NOT inside `tool_result` content block per [PN-4](#pn-tool-use-result-location)); if present, emit `ToolUseStructured` IPC with the structured data (structuredPatch, originalFile, filePath, etc.)
- [ ] Handle slash command output: if `isReplay: true` and content is a string containing `<local-command-stdout>` (exact tag name per [PN-13](#pn-local-command-tags)), extract the content between tags and emit as `assistant_text` with a `source: "slash_command"` indicator. Requires `--replay-user-messages` flag per [PN-20](#pn-replay-flag-required)
- [ ] Handle slash command errors: if content contains `<local-command-stderr>` (exact tag name per [PN-13](#pn-local-command-tags)), extract and emit as error
- [ ] Handle replayed user messages: if `isReplay: true` with regular text content, log and skip (no IPC emission)

**Tests:**
- [ ] Unit test: user message with tool_result blocks emits tool_result IPC per block
- [ ] Unit test: user message with tool_result where `is_error: true` and content wrapped in `<tool_use_error>` tags -- both conditions detected per [PN-3](#pn-tool-error-dual)
- [ ] Unit test: user message with tool_use_result on OUTER message (not inside content block) per [PN-4](#pn-tool-use-result-location)
- [ ] Unit test: user message with tool_use_result (Edit) emits ToolUseStructured with structuredPatch
- [ ] Unit test: user message with tool_use_result (Write/create) emits ToolUseStructured with type: "create"
- [ ] Unit test: user message with isReplay + local-command-stdout extracts output
- [ ] Unit test: user message with isReplay + local-command-stderr extracts error
- [ ] Unit test: user message with isReplay + regular text is skipped (no IPC)

**Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Revert user message routing changes

**Commit after all checkpoints pass.**

---

##### Substeps 2.1-2.3 Summary {#step-2-summary}

After completing Steps 2.1-2.3, you will have:
- Full control protocol type definitions and send/receive helpers
- Permission prompt flow wired end-to-end (CLI control_request -> IPC -> frontend -> IPC -> control_response -> CLI)
- AskUserQuestion flow with answers map
- Graceful interrupt via control_request (no more SIGINT)
- Structured tool result parsing for Edit/Write diffs
- Slash command output extraction
- Model/permission mode runtime changes via control_request

**Final Step 2 Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle && bun build tugtalk/src/control.ts --no-bundle && bun build tugtalk/src/protocol-types.ts --no-bundle` all compile

---

#### Step 3: Scaffold web frontend component types {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugtalk): scaffold web frontend component types for protocol coverage`

**References:** [D08] Expand IPC types, [D10] Session forking, [D12] Extended thinking, Table T03, (#d08-expand-ipc-types, #d10-session-forking, #web-component-catalog, #t03-web-components)

**Artifacts:**
- New `tugtalk/src/web-components.ts`
- Modified `tugtalk/src/session.ts`: system_metadata emission, cost_update emission

**Tasks:**
- [ ] Create `web-components.ts` with typed interfaces for each custom web UI component:
  - `SessionState`: sessionId, cumulativeCost, pendingControlRequests, activeContentBlocks, toolUseMap, toolUseResultMap, taskList, mcpServers, currentModel, permissionMode (per protocol reference section 18 state tracking)
  - `SettingsPanelData`: model (current + available), permissionMode (current + available modes), fastModeState, outputStyle (per section 19a)
  - `HelpPanelData`: tools, slashCommands, skills, agents, plugins, version (per section 19b)
  - `KeybindingsConfig`: array of {key, action, context} (per section 19c)
  - `ContextGaugeData`: model, usedTokens, totalTokens, percentage, categories (per section 19d)
  - `CostDisplayData`: totalCostUsd, perTurnDelta, durationMs, modelUsage breakdown (per section 19e)
  - `DiffViewerData`: filePath, structuredPatch, originalFile, newFile, editType (per section 19f)
  - `TaskItem`: id, subject, description, activeForm, status, owner, blockedBy (per section 20)
  - `TaskListData`: tasks array, activeTaskId (per section 20)
  - `McpServerStatus`: name, status, tools (per section 21)
  - `PermissionDialogData`: requestId, toolName, input, decisionReason, blockedPath, permissionSuggestions (per section 5a)
  - `QuestionFormData`: requestId, questions with header, options, multiSelect (per section 5b)
  - `SlashCommandEntry`: name, category (local|agent|skill), description (per section 13)
  - `SessionManagementData`: sessions array, currentSessionId, supportsFork, supportsContinue (per section 7)
- [ ] In `routeTopLevelEvent()`, emit `SystemMetadata` IPC from system/init with all section 3a fields
- [ ] In `routeTopLevelEvent()`, emit `CostUpdate` IPC from result with section 12 fields
- [ ] In `routeTopLevelEvent()`, emit `CompactBoundary` IPC from system/compact_boundary

**Tests:**
- [ ] Unit test: system/init produces SystemMetadata IPC with tools, model, permissionMode, slash_commands, cwd
- [ ] Unit test: result/success produces CostUpdate IPC with total_cost_usd, modelUsage, duration_api_ms (moved from Step 1 -- types defined in Step 2.1)
- [ ] Unit test: system/compact_boundary produces CompactBoundary IPC
- [ ] Type compilation test: all web-components.ts interfaces compile successfully

**Checkpoint:**
- [ ] `bun build tugtalk/src/web-components.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Delete web-components.ts, revert session.ts metadata emission changes

**Commit after all checkpoints pass.**

---

#### Step 4: Image attachments, content block support, session management {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugtalk): add image attachments, multi-block content, and session management`

**References:** [D02] Stdin user format, [D10] Session forking, (#d02-stdin-user-format, #d10-session-forking, #inputs-outputs, #terminology)

**Artifacts:**
- Modified `tugtalk/src/session.ts`: image content blocks in stdin, session management methods
- Modified `tugtalk/src/types.ts`: attachment handling for base64 images
- Modified `tugtalk/src/main.ts`: new IPC message routing for model_change, session commands

**Tasks:**
- [ ] In `handleUserMessage()`, convert `msg.attachments` to content blocks: text attachments become `{type: "text", text: content}`, image attachments become `{type: "image", source: {type: "base64", media_type: attachment.media_type, data: attachment.content}}`; validate `media_type` is one of exactly `image/png`, `image/jpeg`, `image/gif`, `image/webp` per [PN-12](#pn-image-limits); reject images larger than ~5MB
- [ ] Support multiple content blocks in a single user message (text + images mixed per section 8c)
- [ ] Add `handleSessionFork()` method: kill current process, respawn with `--continue --fork-session`, capture new session_id from system init
- [ ] Add `handleSessionContinue()` method: kill current process, respawn with `--continue`
- [ ] Add `handleNewSession()` method: kill current process, respawn without `--resume`
- [ ] In `types.ts`, add new inbound IPC message interfaces: `ModelChange` (`type: "model_change"`, `model: string`), `SessionCommand` (`type: "session_command"`, `command: "fork" | "continue" | "new"`)
- [ ] In `types.ts`, add these new types to the `InboundMessage` union
- [ ] In `types.ts`, update `isInboundMessage()` type guard to accept the new inbound message types (`typed.type === "model_change" || typed.type === "session_command"`). Without this update, new message types will be rejected by `validateMessage()` in `ipc.ts` before they reach `main.ts` routing
- [ ] In `types.ts`, add type guards: `isModelChange()`, `isSessionCommand()`
- [ ] In `main.ts`, import new type guards and add routing for new inbound message types: `model_change` -> `handleModelChange()`, session commands -> session management methods
- [ ] In `types.ts`, change `ipc_version` from optional to required on the base outbound message type (`ipc_version: number`). Update ALL existing `writeLine` calls in `main.ts` (ProtocolAck, SessionInit, ErrorEvent) and `session.ts` (SessionInit, error messages) to include `ipc_version: 2` per [D15](#d15-ipc-version)
- [ ] Add graceful process shutdown: close stdin (EOF) to end session, wait for final result, then terminate

**Tests:**
- [ ] Unit test: user message with text attachment produces text content block
- [ ] Unit test: user message with image attachment produces image content block with base64 source
- [ ] Unit test: user message with unsupported media type (e.g., `image/bmp`) is rejected per [PN-12](#pn-image-limits)
- [ ] Unit test: user message with image exceeding ~5MB is rejected per [PN-12](#pn-image-limits)
- [ ] Unit test: user message with mixed text + images produces correct content array
- [ ] Unit test: handleSessionFork respawns with --continue --fork-session flags
- [ ] Unit test: stdin close (EOF) triggers graceful shutdown

**Checkpoint:**
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/main.ts --no-bundle` compiles without errors

**Rollback:**
- Revert attachment handling, session management methods, main.ts routing

**Commit after all checkpoints pass.**

---

#### Step 5: Rewrite all session tests {#step-5}

**Depends on:** #step-4

**Commit:** `test(tugtalk): rewrite all session tests against empirical protocol reference`

**References:** [D14] Rewrite tests, [D01] No -p flag, [D02] Stdin user format, [D03] Event routing, [D04] Session ID, [D05] Control protocol, [D06] Permission prompts, [D07] Graceful interrupt, [D08] IPC types, [D11] Structured results, [D12] Thinking, [D13] Subagents, Table T01, Table T02, Table T03, Spec S01, Spec S02, (#test-plan-concepts, #turn-lifecycle, #control-catalog, #structured-tool-results-ref, #web-component-catalog)

**Artifacts:**
- Rewritten `tugtalk/src/__tests__/session.test.ts`
- New `tugtalk/src/__tests__/control.test.ts`
- Updated `tugtalk/src/__tests__/types.test.ts`: tests for new IPC types, updated type guards, new inbound message types
- Updated `tugtalk/src/__tests__/permissions.test.ts`: tests for new `dontAsk` and `delegate` modes
- Updated `tugtalk/src/__tests__/main.test.ts`: tests for new inbound message routing (model_change, session_command)
- Updated `tugtalk/src/__tests__/ipc.test.ts`: tests for new message type validation in `isInboundMessage()`

**Tasks:**
- [ ] Consolidate `session.test.ts`: verify all tests written in Steps 0-4 are present, fill any gaps, and ensure the full test suite passes
- [ ] Rebuild mock subprocess infrastructure to emit protocol-compliant events:
  - System init: `{type: "system", subtype: "init", session_id: "...", tools: [...], model: "...", ...}`
  - Stream events: `{type: "stream_event", session_id: "...", parent_tool_use_id: null, event: {type: "content_block_delta", delta: {type: "text_delta", text: "..."}}}`
  - Complete assistant: `{type: "assistant", session_id: "...", parent_tool_use_id: null, message: {model: "...", id: "msg_xxx", role: "assistant", content: [...], stop_reason: null, usage: {...}}}`
  - Result: `{type: "result", subtype: "success", session_id: "...", is_error: false, result: "", total_cost_usd: 0.042, num_turns: 1, duration_ms: 5000, usage: {...}, modelUsage: {...}, permission_denials: []}`
  - Control request: `{type: "control_request", request_id: "...", request: {subtype: "can_use_tool", tool_name: "...", input: {...}, tool_use_id: "..."}}`
  - User with tool_result: `{type: "user", session_id: "...", message: {role: "user", content: [{type: "tool_result", tool_use_id: "...", content: "...", is_error: false}]}}`
- [ ] Write `buildClaudeArgs` test group:
  - Default config: does NOT include `-p`
  - Default config: includes `--permission-prompt-tool`, `stdio`
  - All required flags: `--output-format stream-json`, `--input-format stream-json`, `--verbose`, `--include-partial-messages`, `--replay-user-messages` (per [PN-20](#pn-replay-flag-required))
  - Session resume: includes `--resume <id>`
  - Session continue: includes `--continue`
  - Session fork: includes `--fork-session`
  - Invalid combo: throws if both `sessionId` and `continue` are set
  - Invalid combo: throws if `forkSession` without `sessionId` or `continue`
  - Config values: `--plugin-dir`, `--model`, `--permission-mode` match config
- [ ] Write `routeTopLevelEvent` test group:
  - system/init: captures session_id, returns metadata
  - system/compact_boundary: emits CompactBoundary
  - assistant with text: emits complete assistant_text
  - assistant with tool_use: emits tool_use
  - assistant with thinking: emits thinking_text
  - assistant with mixed content (text + tool_use + thinking): emits all types
  - result/success: emits turn_complete + cost_update
  - result/error_during_execution: emits error turn_complete
  - result/error_max_turns: emits correct subtype
  - result/error_max_budget_usd: emits correct subtype per [PN-6](#pn-result-subtypes)
  - result/error_max_structured_output_retries: emits correct subtype per [PN-6](#pn-result-subtypes)
  - result with permission_denials: included in output
  - stream_event: returns unwrapped inner event
  - user with tool_result: emits tool_result per block
  - user with tool_use_result (Edit structuredPatch): emits ToolUseStructured
  - user with isReplay + local-command-stdout: extracts output
  - user with isReplay + local-command-stderr: extracts error
  - control_request with can_use_tool: returns for handling
  - control_request with AskUserQuestion: returns with is_question flag
  - keep_alive: produces nothing
  - control_cancel_request: cancels pending
  - subagent event with parent_tool_use_id: preserved from all 5 message types per [PN-8](#pn-parent-tool-use-id-scope)
- [ ] Write `mapStreamEvent` test group (unwrapped stream_event.event):
  - content_block_delta with text_delta: partial assistant_text
  - content_block_delta with thinking_delta: thinking_text
  - content_block_delta with input_json_delta: accumulates tool JSON
  - content_block_start/stop: no IPC (internal)
  - message_start/delta/stop: no IPC (internal)
  - No sessionId in result
- [ ] Write control protocol test group (in control.test.ts):
  - formatPermissionAllow: correct Zod-compliant JSON with updatedInput
  - formatPermissionDeny: correct Zod-compliant JSON with message
  - formatQuestionAnswer: answers map in updatedInput alongside original questions; multiSelect answers comma-separated per [PN-5](#pn-multiselect-format)
  - sendControlRequest: correct serialization with request_id
  - sendControlResponse: correct serialization
  - generateRequestId: unique IDs
- [ ] Write `SessionManager` behavioral test group:
  - Constructor does not throw
  - Session ID file persistence round-trip
  - handleToolApproval sends control_response to stdin (allow)
  - handleToolApproval sends control_response to stdin (deny)
  - handleQuestionAnswer sends control_response with answers
  - handleInterrupt sends control_request interrupt to stdin (NOT SIGINT)
  - handleModelChange sends control_request set_model to stdin
  - handlePermissionMode updates local state and sends control_request
- [ ] Write `handleUserMessage` integration test group (mock subprocess):
  - Full round-trip: system init -> stream deltas -> assistant complete -> result
  - Session ID captured from system init
  - Control_request triggers ControlRequestForward IPC
  - Graceful interrupt via control_request produces turn_complete with error_during_execution
  - Stdin receives correct `{type: "user", session_id: "", message: {...}, parent_tool_use_id: null}` format
  - Image attachment produces image content block in stdin
  - Subagent events with parent_tool_use_id are forwarded with tag
  - Slash command output extracted from replayed user messages
- [ ] Update `types.test.ts`:
  - New outbound IPC message type validation (ThinkingText, ControlRequestForward, SystemMetadata, CostUpdate, ToolUseStructured, CompactBoundary)
  - All outbound IPC messages include `ipc_version: 2` field per [D15](#d15-ipc-version)
  - Updated `PermissionModeMessage.mode` accepts `dontAsk` and `delegate`
  - Updated `ToolApproval` with `updatedInput` and `message` optional fields
  - New `ModelChange` and `SessionCommand` inbound types
  - Updated `isInboundMessage()` accepts new inbound types
  - New type guards: `isModelChange()`, `isSessionCommand()`
- [ ] Update `permissions.test.ts`:
  - `PermissionManager` accepts and returns `dontAsk` and `delegate` modes
- [ ] Update `main.test.ts`:
  - New inbound message routing: `model_change` dispatches to `handleModelChange()`
  - New inbound message routing: `session_command` dispatches to session management methods
- [ ] Update `ipc.test.ts`:
  - `validateMessage()` accepts new inbound message types (`model_change`, `session_command`)
  - `validateMessage()` rejects unknown types (regression)

**Tests:**
- [ ] All new tests pass: `bun test tugtalk/src/__tests__/session.test.ts`
- [ ] All control tests pass: `bun test tugtalk/src/__tests__/control.test.ts`
- [ ] All updated tests pass: `bun test tugtalk/src/__tests__/types.test.ts`
- [ ] All updated tests pass: `bun test tugtalk/src/__tests__/permissions.test.ts`
- [ ] All updated tests pass: `bun test tugtalk/src/__tests__/main.test.ts`
- [ ] All updated tests pass: `bun test tugtalk/src/__tests__/ipc.test.ts`

**Checkpoint:**
- [ ] `bun test` exits 0 (all test files across the entire tugtalk test suite)
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors

**Rollback:**
- Restore previous test files from git history

**Commit after all checkpoints pass.**

---

#### Step 6: Final audit and protocol conformance verification {#step-6}

**Depends on:** #step-5

**Commit:** `chore(tugtalk): audit protocol conformance against all 23 sections`

**References:** [D01]-[D15], Spec S01, Spec S02, Table T01, Table T02, Table T03, (#specification, #turn-lifecycle, #control-catalog, #structured-tool-results-ref, #web-component-catalog, #d15-ipc-version)

**Artifacts:**
- Any fixups discovered during audit across all modified files

**Tasks:**
- [ ] Verify section 1 compliance: spawn args match protocol reference (no -p, correct flags). Check: `buildClaudeArgs` output does not contain `-p`; contains `--permission-prompt-tool`, `stdio`, `--replay-user-messages`, `--include-partial-messages`, `--verbose`
- [ ] Verify section 2a compliance: stdin user message has session_id:"", parent_tool_use_id:null, content as array. Check: `handleUserMessage` stdin write contains `session_id: ""` and `parent_tool_use_id: null`
- [ ] Verify sections 2b-2f compliance: all control_request/control_response subtypes implemented. Check: `formatPermissionAllow` uses `behavior: "allow"` not `decision: "allow"` per [PN-1](#pn-behavior-field); `formatPermissionDeny` uses `behavior: "deny"` with `message` field
- [ ] Verify section 3 compliance: all 8+ stdout types routed
- [ ] Verify section 4 compliance: turn lifecycle sequences handled (text, tool use, permission)
- [ ] Verify section 5 compliance: permission flow end-to-end with Zod-compliant responses. Check: `PermissionSuggestion` type is a discriminated union with `addDirectories`/`addRules`/`setMode` per [PN-7](#pn-permission-suggestions)
- [ ] Verify section 6 compliance: slash commands sent as user messages, output parsed from local-command-stdout
- [ ] Verify section 7 compliance: session management (new, resume, continue, fork)
- [ ] Verify section 8 compliance: image/file content blocks in user messages
- [ ] Verify section 9 compliance: structured tool results parsed (Edit/Write). Check: `tool_use_result` is read from the OUTER user message object, not inside `tool_result` content block per [PN-4](#pn-tool-use-result-location)
- [ ] Verify section 10 compliance: graceful interrupt (no SIGINT), Escape key semantics documented. Check: `handleInterrupt` sends `control_request` with `{subtype: "interrupt"}` to stdin, does NOT call `process.kill("SIGINT")`
- [ ] Verify section 11 compliance: error handling for API errors, tool errors, limits. Check: API error detection handles `result.subtype === "success"` with error text per [PN-2](#pn-api-error-subtype); tool errors check both `is_error` and `<tool_use_error>` tags per [PN-3](#pn-tool-error-dual)
- [ ] Verify section 12 compliance: cost/usage tracking (cumulative, per-turn delta). Check: `ResultMessage` includes `duration_api_ms` per [PN-19](#pn-duration-fields); `modelUsage` entries include `contextWindow` and `maxOutputTokens` per [PN-11](#pn-model-usage-extra-fields)
- [ ] Verify section 13 compliance: slash command catalog coverage
- [ ] Verify section 14 compliance: extended thinking forwarded
- [ ] Verify section 15 compliance: subagent parent_tool_use_id preserved. Check: `parent_tool_use_id` is extracted from all 5 message types (`system`, `assistant`, `user`, `result`, `stream_event`) per [PN-8](#pn-parent-tool-use-id-scope)
- [ ] Verify section 16 compliance: multiple parallel tool_use blocks handled
- [ ] Verify section 17 compliance: context compaction marker emitted
- [ ] Verify sections 18-22 compliance: web frontend types scaffolded for all components
- [ ] Verify section 23 compliance: audit checklist items have coverage
- [ ] Fix any conformance gaps discovered during audit

**Tests:**
- [ ] All existing tests still pass after fixups
- [ ] Protocol conformance spot-checks pass

**Checkpoint:**
- [ ] `bun test` exits 0 (all test files)
- [ ] `bun build tugtalk/src/session.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/control.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/protocol-types.ts --no-bundle` compiles without errors
- [ ] `bun build tugtalk/src/web-components.ts --no-bundle` compiles without errors

**Rollback:**
- Revert any audit fixups individually

**Commit after all checkpoints pass.**

---

### 2.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A TugTalk protocol bridge with routing, parsing, and typed coverage for all 23 sections of the empirically-documented protocol reference. For protocol features within scope (sections 1-17), this means working implementation. For features explicitly out of scope (MCP auth section 21d, hook internals section 22, UI rendering), this means typed interfaces and documented behavior. Together these enable a web frontend to be built on top of this bridge layer.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `buildClaudeArgs()` omits `-p` and includes `--permission-prompt-tool stdio` (verified by test)
- [ ] Stdin user messages include `session_id: ""`, `parent_tool_use_id: null`, content as array (verified by test)
- [ ] All 8+ stdout message types routed correctly (verified by per-type tests)
- [ ] Control protocol handles permission prompts with Zod-schema-compliant responses (verified by test)
- [ ] AskUserQuestion flow renders questions and returns answers via updatedInput (verified by test)
- [ ] Graceful interrupt uses control_request, not SIGINT (verified by test)
- [ ] Structured Edit/Write tool results parsed and forwarded (verified by test)
- [ ] Extended thinking content blocks forwarded (verified by test)
- [ ] Subagent events tagged with parent_tool_use_id (verified by test)
- [ ] Session management supports new, resume, continue, fork (verified by test)
- [ ] Web frontend component types scaffolded for all custom UI components (verified by compilation)
- [ ] All 23 protocol reference sections have implementation OR typed scaffolding coverage (verified by audit per scope boundaries in [Non-goals](#non-goals))
- [ ] `bun test` exits 0
- [ ] All TypeScript files compile without errors

**Acceptance tests:**
- [ ] Unit tests for all exported functions pass
- [ ] Integration test with mock subprocess round-trip passes
- [ ] Control protocol tests pass
- [ ] No TypeScript compilation errors across all files

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Foundation** {#m01-foundation}
- [ ] CLI spawn args corrected (no -p, +permission-prompt-tool stdio)
- [ ] Stdin format corrected (session_id, parent_tool_use_id, content array)

**Milestone M02: Event Routing** {#m02-event-routing}
- [ ] All 8+ stdout types routed by routeTopLevelEvent()
- [ ] mapStreamEvent() receives only unwrapped stream_event.event payloads
- [ ] Session ID captured from system/init every turn

**Milestone M03: Control Protocol** {#m03-control-protocol}
- [ ] Permission flow end-to-end (control_request -> IPC -> frontend -> IPC -> control_response)
- [ ] AskUserQuestion flow with answers map
- [ ] Graceful interrupt via control_request

**Milestone M04: Rich Protocol Features** {#m04-rich-features}
- [ ] Structured Edit/Write tool results forwarded
- [ ] Extended thinking forwarded
- [ ] Subagent events tagged
- [ ] Image attachments supported
- [ ] Session management (fork, continue)

**Milestone M05: Web Frontend Scaffolding** {#m05-web-scaffolding}
- [ ] All custom web UI component types defined
- [ ] System metadata, cost updates, compact boundaries emitted as IPC

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Actual HTML/CSS/React web frontend implementation using the scaffolded types
- [ ] MCP server OAuth/authentication management
- [ ] Hook-aware protocol handling (detecting auto-resolved permissions)
- [ ] End-to-end test with real claude CLI process
- [ ] NotebookEdit tool specialized rendering
- [ ] @file reference autocomplete from filesystem
- [ ] MCP resource (@server:protocol://path) autocomplete
- [ ] Session listing/browsing UI with historical sessions

| Checkpoint | Verification |
|------------|--------------|
| All tests pass | `bun test` exits 0 |
| TypeScript compiles | All `bun build` commands exit 0 |
| Protocol conformance | Audit against all 23 sections passes |

**Commit after all checkpoints pass.**
