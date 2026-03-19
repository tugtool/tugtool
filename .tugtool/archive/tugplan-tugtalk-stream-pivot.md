## Phase 8.0: Pivot tugtalk from Agent SDK to Direct CLI Spawning with stream-json {#phase-tugtalk-stream-pivot}

**Purpose:** Replace tugtalk's dependency on `@anthropic-ai/claude-agent-sdk` with direct spawning of the `claude` CLI binary using `--output-format stream-json --input-format stream-json`, restoring all interactive CLI features (slash commands, plugins, config, permissions) while preserving the existing JSON-lines IPC protocol between tugcast and tugtalk.

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

Tugtalk is the conversation engine IPC process (TypeScript/Bun) that bridges tugcast (Rust backend) with Claude. Currently it uses `@anthropic-ai/claude-agent-sdk` which spawns claude as a child process internally, but strips away all interactive CLI features -- slash commands, plugins, config, permissions. The SDK wraps the CLI in a way that makes it an opaque, feature-limited abstraction. The SDK's unstable V2 API has also proven fragile, causing environment variable wipeout crashes and providing no path to stability.

The pivot means tugtalk will spawn the `claude` CLI binary directly using flags like `--output-format stream-json --input-format stream-json --include-partial-messages --replay-user-messages --plugin-dir <tugtool-root> --model claude-opus-4-6 -p`. This gives structured JSON events over stdin/stdout with EVERY CLI feature intact. The existing JSON-lines IPC protocol between tugcast (`agent_bridge.rs`) and tugtalk (`main.ts`) is preserved unchanged -- tugcast still spawns tugtalk the same way, only tugtalk's internal mechanism for talking to Claude changes.

#### Strategy {#strategy}

- Delete the SDK adapter, its tests, and the SDK dependency in one atomic step alongside the session.ts rewrite -- no intermediate broken state
- Rewrite `session.ts` to spawn `claude` as a child process via `Bun.spawn`, piping stdin/stdout with stream-json format
- Map stream-json output events to existing IPC outbound message types so tugcast and tugdeck continue working without changes
- Handle CLI permission prompts from stream-json events by relaying them through the existing IPC protocol to tugcast/tugdeck for user approval
- Use `--session-id` / `--resume` / `--continue` flags for session persistence instead of SDK session management
- Preserve the `getTugtoolRoot()` logic for `--plugin-dir` resolution
- Remove `@anthropic-ai/claude-agent-sdk` from `package.json` dependencies -- zero SDK footprint
- Delete the obsolete `tugplan-tugtalk-transport-fix.md` plan that this work supersedes

#### Stakeholders / Primary Customers {#stakeholders}

1. tugcast (Rust backend) -- consumes tugtalk's JSON-lines IPC output
2. tugdeck (web frontend) -- renders conversation events relayed from tugcast
3. Users -- gain access to full Claude CLI features (slash commands, plugins, interactive permissions)

#### Success Criteria (Measurable) {#success-criteria}

- `bun build --compile tugtalk/src/main.ts` succeeds with zero SDK references (`grep -r "claude-agent-sdk" tugtalk/src/` returns empty)
- `cargo build` succeeds (build.rs tugtalk compilation still works)
- Sending a `protocol_init` followed by a `user_message` through the IPC protocol produces `assistant_text` and `turn_complete` events
- Permission prompts from the CLI are surfaced as `tool_approval_request` IPC events and resolved via `tool_approval` responses
- Session resume works: persisted session ID allows continuing a conversation across tugtalk restarts
- All existing tests pass; new tests cover the claude process spawning and event mapping

#### Scope {#scope}

1. Rewrite `session.ts` to spawn claude CLI directly with stream-json flags
2. Map stream-json output events to existing IPC outbound types
3. Handle CLI permission prompts via IPC relay
4. Implement session persistence using `--resume` / `--session-id` CLI flags
5. Remove SDK adapter, its tests, and SDK dependency from `package.json`
6. Update existing tests to work with the new architecture
7. Delete `tugplan-tugtalk-transport-fix.md`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the tugcast-to-tugtalk IPC protocol (stays as-is)
- Changing the tugdeck frontend event handling
- Adding new IPC message types beyond what the current protocol defines
- Changing `build.rs` beyond what is needed for SDK removal (the bun build --compile step stays)
- Changing `ipc.ts` or `main.ts` beyond minimal adjustments for the new session interface

#### Dependencies / Prerequisites {#dependencies}

- `claude` CLI binary available on PATH (existing requirement; `session.ts` already checks via `Bun.which('claude')`)
- Claude CLI supports `--output-format stream-json --input-format stream-json` flags
- Bun runtime with `Bun.spawn` subprocess API

#### Constraints {#constraints}

- stdout is reserved for JSON-lines IPC to tugcast; all debug/log output goes to stderr
- The compiled tugtalk binary (`bun build --compile`) must work identically to development mode (`bun run`)
- Warnings are errors: `cargo build` with `-D warnings` must pass after changes
- After SDK removal, `package.json` has an empty `dependencies` object; `bun install` still succeeds (creates minimal `node_modules` with `.cache` only) and `build.rs` `bun install` guard (`if !node_modules.exists()`) may trigger on every build -- this is acceptable since it is a near-instant no-op

#### Assumptions {#assumptions}

- The claude CLI `--output-format stream-json` produces JSON events on stdout with types including `assistant`, `content_block_delta`, `content_block_start`, `content_block_stop`, `message_start`, `message_delta`, `message_stop`, `result`, and system/error events
- The `--input-format stream-json` accepts JSON messages on stdin for multi-turn conversation
- The `--resume` flag with a session ID resumes an existing conversation
- The `--permission-mode` flag accepts the same values as the SDK: `default`, `acceptEdits`, `bypassPermissions`, `plan`
- `Bun.spawn` provides access to child process stdin/stdout as streams compatible with async iteration
- The `getTugtoolRoot()` logic in session.ts for resolving the `--plugin-dir` path remains valid after the pivot

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| stream-json permission prompt format unknown | med | med | Research spike in Step 1; fall back to `--permission-mode bypassPermissions` | Format not discoverable from `claude --help` or docs |
| Interrupt mechanism differs from expected | low | med | Test SIGINT behavior empirically in Step 1 | claude process does not respond to SIGINT |

**Risk R01: stream-json permission input format undocumented** {#r01-permission-format}

- **Risk:** The stream-json input format for responding to permission prompts from the claude CLI is not publicly documented. Without knowing the exact JSON shape to pipe back via stdin, permission relay cannot be fully implemented.
- **Mitigation:**
  - Step 1 includes an explicit research spike: run `claude --help`, inspect stream-json output during a permission prompt, and reverse-engineer the expected input format
  - If the format cannot be determined, fall back to `--permission-mode bypassPermissions` (auto-approve all) or `--permission-mode acceptEdits` (auto-approve safe tools) and defer interactive permission relay to a follow-on
  - Document discovered format in Table T02 during implementation
- **Residual risk:** Permission relay may ship as partial (mode-based only, no interactive prompts) if the input format proves undiscoverable

**Risk R02: Interrupt and turn_cancelled emission** {#r02-interrupt-mechanism}

- **Risk:** The current interrupt mechanism uses `AbortController` to cancel SDK streaming. With direct process spawning, interrupt must use OS signals (SIGINT) or stdin closure, and the turn_cancelled IPC event must still be emitted correctly.
- **Mitigation:**
  - `handleInterrupt()` will send SIGINT to the child process (`proc.kill("SIGINT")`) and set an `interrupted` flag
  - The stdout event loop detects either: (a) the stream ending without a `result` event while `interrupted` is true, or (b) a specific error/cancellation event from the CLI
  - In either case, emit `turn_cancelled` IPC event with the partial result accumulated so far
  - If SIGINT does not work (process ignores it), fall back to `proc.kill()` (SIGTERM)
- **Residual risk:** Partial result text may be incomplete if the process is killed mid-stream

---

### 8.0.0 Design Decisions {#design-decisions}

#### [D01] Spawn claude CLI directly via Bun.spawn (DECIDED) {#d01-direct-cli-spawn}

**Decision:** Tugtalk spawns the `claude` CLI binary as a child process using `Bun.spawn()` with `--output-format stream-json --input-format stream-json` flags, replacing the SDK's internal process management.

**Rationale:**
- The SDK is an opaque wrapper around the CLI that strips interactive features
- Direct spawning gives access to all CLI flags: `--plugin-dir`, `--permission-mode`, `--model`, `--resume`, etc.
- stream-json provides structured JSON events that map cleanly to the existing IPC protocol
- Eliminates the unstable V2 API dependency and its failure modes (environment wipeout, lazy session IDs)

**Implications:**
- `session.ts` becomes responsible for child process lifecycle (spawn, pipe, kill)
- Event mapping logic must handle the stream-json event format instead of SDK event types
- Error handling must account for process crashes, not just SDK exceptions

#### [D02] Long-lived process per conversation (DECIDED) {#d02-long-lived-process}

**Decision:** Spawn one `claude` process per conversation. The process stays alive between messages, receiving new user input via `--input-format stream-json` on stdin.

**Rationale:**
- Preserves conversation context without re-sending history
- Matches the existing SessionManager lifecycle (one session per tugtalk instance)
- The `--input-format stream-json` flag enables piping multiple messages to a running process

**Implications:**
- The claude process must be properly cleaned up on tugtalk shutdown
- Interrupt handling must send appropriate signals to the child process
- Process health monitoring becomes important (detect crashes, handle restarts)

#### [D03] Relay CLI permission prompts through IPC (DECIDED) {#d03-relay-permissions}

**Decision:** Intercept permission prompt events from the claude CLI's stream-json output and relay them to tugcast/tugdeck via `tool_approval_request` IPC events. Wait for `tool_approval` IPC responses and pipe the decision back to the claude process via stdin.

**Rationale:**
- The CLI handles permissions natively with `--permission-mode` but can also emit prompts for user approval
- Relaying through the existing IPC protocol keeps tugcast/tugdeck unchanged
- Avoids reimplementing permission logic that the CLI already handles

**Implications:**
- Must identify the stream-json event type for permission prompts and map it correctly (see Risk R01 #r01-permission-format)
- Permission responses must be formatted as stream-json input messages to the claude process
- The `PermissionManager` class can be simplified since the CLI handles mode-based auto-approval
- If the permission input format cannot be determined, fall back to mode-based approval only (`--permission-mode acceptEdits` or `bypassPermissions`)

#### [D04] Full SDK removal (DECIDED) {#d04-full-sdk-removal}

**Decision:** Remove `@anthropic-ai/claude-agent-sdk` from `package.json`, delete `sdk-adapter.ts` and `sdk-adapter.test.ts`. Zero SDK footprint.

**Rationale:**
- Clean break eliminates dead code and confusion about which path is active
- Reduces compiled binary size by removing unused dependency
- The SDK provided no value that direct CLI spawning does not

**Implications:**
- `package.json` dependencies section becomes empty (or contains only non-SDK deps)
- `build.rs` bun install guard (`if !node_modules.exists()`) may trigger on every build since empty deps produce minimal `node_modules`; this is a near-instant no-op
- All imports of `sdk-adapter.ts` must be removed from `session.ts`

#### [D05] Session persistence via CLI flags (DECIDED) {#d05-session-persistence}

**Decision:** Use the claude CLI's `--resume` and `--session-id` flags for session persistence, replacing the SDK's `createSession`/`resumeSession` API.

**Rationale:**
- The CLI natively supports session resume, eliminating custom session management code
- Session IDs are available immediately from the CLI (no lazy population like the SDK)
- The existing `.tugtool/.session` file persistence mechanism remains valid for storing the session ID

**Implications:**
- First launch: spawn with `-p` flag (prompt mode, no resume)
- Subsequent launches: spawn with `--resume --session-id <id>` to continue the conversation
- Session ID must be captured from the CLI's initial output events

#### [D06] Delete obsolete transport fix plan (DECIDED) {#d06-delete-transport-fix}

**Decision:** Delete `.tugtool/tugplan-tugtalk-transport-fix.md` as this plan fully supersedes it.

**Rationale:**
- The transport fix plan addressed SDK-specific bugs (environment wipeout, race conditions)
- Removing the SDK entirely makes those fixes moot
- Keeping the old plan creates confusion about which work is active

**Implications:**
- Step 0 includes deletion of the old plan file

#### [D07] Simplify PermissionManager (DECIDED) {#d07-simplify-permissions}

**Decision:** Simplify the `PermissionManager` class by removing the `createCanUseToolCallback` method and its associated types (`CanUseToolCallback`, `PermissionResult`) which were SDK-specific. Retain `getMode()`/`setMode()` for passing `--permission-mode` to the CLI, and use simple IPC relay for individual permission prompts.

**Rationale:**
- The SDK's `canUseTool` callback pattern does not exist in direct CLI spawning
- The CLI handles permission mode natively via its `--permission-mode` flag
- Individual tool approval prompts from the CLI are intercepted from stream-json events and relayed via IPC

**Implications:**
- `permissions.ts` becomes simpler: just mode state management
- `session.ts` handles permission prompt events directly in its event loop
- The `tool_approval_request` / `tool_approval` IPC types remain unchanged

#### [D08] Atomic SDK removal and session rewrite (DECIDED) {#d08-atomic-step}

**Decision:** Combine SDK deletion (adapter, tests, dependency) and session.ts rewrite into a single atomic step that produces a compilable commit. Do not create an intermediate state where the SDK is removed but session.ts still references SDK types.

**Rationale:**
- Removing SDK imports while keeping method bodies that call `this.adapter.createSession()`, `this.adapter.resumeSession()`, `this.session.send()`, `this.session.stream()`, and `this.createCanUseToolCallback()` produces TypeScript errors
- `main.test.ts` spawns the actual `main.ts` process and triggers `sessionManager.initialize()`, which calls SDK adapter methods -- it would break in an intermediate state
- A single atomic step avoids any commit that fails to type-check or pass tests

**Implications:**
- Step 0 is a larger step but every intermediate file state must be compilable
- The implementer must delete SDK files, rewrite session.ts, simplify permissions.ts, and rewrite session.test.ts all within one step

#### [D09] Interrupt via SIGINT with interrupted flag (DECIDED) {#d09-interrupt-mechanism}

**Decision:** Replace the `AbortController`-based interrupt mechanism with SIGINT delivery to the claude child process, plus an `interrupted` boolean flag on SessionManager. When the stdout event loop ends (stream closes) while `interrupted` is true and no `result` event was received, emit `turn_cancelled` with accumulated partial text.

**Rationale:**
- `AbortController` was specific to the SDK's async iterator cancellation pattern
- SIGINT is the standard mechanism for interrupting a CLI process gracefully
- Tracking the `interrupted` flag allows distinguishing user-initiated interrupt from unexpected process exit (crash)

**Implications:**
- `handleInterrupt()` calls `this.claudeProcess.kill("SIGINT")` and sets `this.interrupted = true`
- The stdout event loop checks `this.interrupted` when the stream ends without a `result` event
- If `interrupted` is true: emit `turn_cancelled` IPC event
- If `interrupted` is false: emit `error` IPC event (unexpected crash)
- Falls back to SIGTERM if SIGINT is ineffective

---

### Deep Dives {#deep-dives}

#### stream-json Event Format Mapping {#stream-json-mapping}

The claude CLI with `--output-format stream-json` emits one JSON object per line on stdout. Each event has a `type` field. The key event types and their mapping to tugtalk's IPC outbound types:

**Table T01: stream-json to IPC Event Mapping** {#t01-event-mapping}

| stream-json `type` | IPC Outbound Type | Mapping Notes |
|---------------------|-------------------|---------------|
| `assistant` | `assistant_text` | Contains `message.content[]` with text blocks; emit as `is_partial: false` |
| `content_block_delta` | `assistant_text` | Delta with `delta.text`; emit as `is_partial: true, status: "partial"` |
| `content_block_start` | (internal tracking) | Signals start of a new content block; track block type |
| `content_block_stop` | (internal tracking) | Signals end of a content block |
| `message_start` | (internal tracking) | Begin of a new assistant message; capture message ID |
| `message_delta` | (internal tracking) | Message-level metadata (e.g., stop_reason) |
| `message_stop` | (internal tracking) | End of assistant message |
| `result` | `turn_complete` | Map `subtype: "success"` to `result: "success"` |
| `tool_use` | `tool_use` | Extract `name`, `id`, `input` from the event |
| `tool_result` | `tool_result` | Extract `tool_use_id`, `content`, `is_error` |

**Table T02: IPC Inbound to stream-json Input Mapping** {#t02-input-mapping}

| IPC Inbound Type | stream-json stdin format | Status | Notes |
|------------------|--------------------------|--------|-------|
| `user_message` | `{"type":"user_message","text":"..."}` | Assumed | Pipe directly; verify format in research spike |
| `tool_approval` | Unknown -- requires research spike | Unknown | See Risk R01 (#r01-permission-format); format must be discovered by inspecting CLI behavior |
| `interrupt` | SIGINT to child process | Decided | See [D09] (#d09-interrupt-mechanism); not a stdin message |

#### Claude Process Lifecycle {#claude-process-lifecycle}

**Spec S01: Claude Process Spawn Arguments** {#s01-spawn-args}

```
claude \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --replay-user-messages \
  --plugin-dir <tugtool-root> \
  --model claude-opus-4-6 \
  --permission-mode <mode> \
  -p
```

For session resume:
```
claude \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --replay-user-messages \
  --plugin-dir <tugtool-root> \
  --model claude-opus-4-6 \
  --permission-mode <mode> \
  --resume \
  --session-id <id>
```

The process is spawned with:
- `stdin: "pipe"` -- for sending user messages and approval responses
- `stdout: "pipe"` -- for reading stream-json events
- `stderr: "inherit"` -- for debug output (goes to tugtalk's stderr, then to tugcast)

#### Interrupt and Cancellation Flow {#interrupt-flow}

When `handleInterrupt()` is called:

1. Set `this.interrupted = true`
2. Call `this.claudeProcess.kill("SIGINT")` to signal the claude child process
3. The claude process may emit partial events before exiting, or emit a specific cancellation/error event
4. The stdout event loop continues reading until the stream closes
5. When the stream closes:
   - If `this.interrupted` is true and no `result` event was received: emit `turn_cancelled` IPC event with accumulated partial text
   - If `this.interrupted` is false: this is an unexpected crash; emit `error` IPC event with `recoverable: true`
6. Reset `this.interrupted = false` for the next turn

If SIGINT does not cause the process to stop within a reasonable time, escalate to `proc.kill()` (SIGTERM).

#### Files Affected {#files-affected}

**Table T03: File Changes Summary** {#t03-file-changes}

| File | Action | Description |
|------|--------|-------------|
| `tugtalk/src/session.ts` | **Rewrite** | Replace SDK adapter with direct `Bun.spawn` of claude CLI |
| `tugtalk/src/permissions.ts` | **Simplify** | Remove `createCanUseToolCallback` and associated types, keep mode state |
| `tugtalk/src/types.ts` | **Minor update** | No structural changes; types already match IPC protocol |
| `tugtalk/src/main.ts` | **Minor update** | Simplify initialization if needed |
| `tugtalk/src/ipc.ts` | **No change** | JSON-lines protocol layer stays as-is |
| `tugtalk/src/sdk-adapter.ts` | **Delete** | SDK adapter removed |
| `tugtalk/src/__tests__/sdk-adapter.test.ts` | **Delete** | SDK adapter tests removed |
| `tugtalk/src/__tests__/session.test.ts` | **Rewrite** | Tests for new direct-spawn session |
| `tugtalk/src/__tests__/permissions.test.ts` | **Update** | Reflect simplified PermissionManager |
| `tugtalk/package.json` | **Update** | Remove `@anthropic-ai/claude-agent-sdk` dependency |
| `tugtalk/bun.lock` | **Update** | Regenerated by `bun install` after dependency removal |
| `.tugtool/tugplan-tugtalk-transport-fix.md` | **Delete** | Obsolete plan superseded by this work |

---

### 8.0.5 Execution Steps {#execution-steps}

#### Step 0: Atomic SDK Removal, Session Rewrite, and Permission Simplification {#step-0}

**Commit:** `feat(tugtalk): replace claude-agent-sdk with direct CLI spawning via stream-json`

**References:** [D01] Direct CLI spawn, [D02] Long-lived process, [D03] Relay permissions, [D04] Full SDK removal, [D05] Session persistence, [D06] Delete transport fix plan, [D07] Simplify PermissionManager, [D08] Atomic step, [D09] Interrupt mechanism, Spec S01 (#s01-spawn-args), Table T01 (#t01-event-mapping), Table T02 (#t02-input-mapping), Table T03 (#t03-file-changes), Risk R01 (#r01-permission-format), Risk R02 (#r02-interrupt-mechanism), (#claude-process-lifecycle, #stream-json-mapping, #interrupt-flow, #files-affected)

**Artifacts:**
- Deleted `tugtalk/src/sdk-adapter.ts`
- Deleted `tugtalk/src/__tests__/sdk-adapter.test.ts`
- Deleted `.tugtool/tugplan-tugtalk-transport-fix.md`
- Rewritten `tugtalk/src/session.ts` with `Bun.spawn` based claude process management
- Simplified `tugtalk/src/permissions.ts` (removed `createCanUseToolCallback`, `CanUseToolCallback`, `PermissionResult`)
- Updated `tugtalk/package.json` (removed `@anthropic-ai/claude-agent-sdk` dependency, empty `dependencies`)
- Updated `tugtalk/bun.lock` (regenerated)
- Rewritten `tugtalk/src/__tests__/session.test.ts` for new architecture
- Updated `tugtalk/src/__tests__/permissions.test.ts` for simplified PermissionManager

**Tasks:**
- [ ] **Research spike:** Run `claude --help` and `claude -p --output-format stream-json --input-format stream-json` with a test prompt to discover the exact stream-json event shapes, especially for permission prompts. Document findings. If permission input format is undiscoverable, note this and use `--permission-mode acceptEdits` as fallback per Risk R01
- [ ] Delete `tugtalk/src/sdk-adapter.ts`
- [ ] Delete `tugtalk/src/__tests__/sdk-adapter.test.ts`
- [ ] Delete `.tugtool/tugplan-tugtalk-transport-fix.md`
- [ ] Remove `"@anthropic-ai/claude-agent-sdk": "0.2.44"` from `tugtalk/package.json` dependencies (leave `dependencies` as empty object `{}`)
- [ ] Remove `tugtalk/node_modules` and run `bun install` to regenerate clean `bun.lock` and minimal `node_modules`
- [ ] Rewrite `tugtalk/src/session.ts`:
  - Remove all SDK adapter imports (`createSDKAdapter`, `AdapterSession`)
  - Remove `private adapter = createSDKAdapter()` field
  - Remove `private session: AdapterSession | null = null` field
  - Add `private claudeProcess: Subprocess | null = null` field (Bun's subprocess type)
  - Add `private interrupted: boolean = false` flag for interrupt tracking
  - Implement `spawnClaude()` private method: builds argument array per Spec S01, calls `Bun.spawn` with `stdin: "pipe"`, `stdout: "pipe"`, `stderr: "inherit"`
  - Rewrite `initialize()`: check for existing session ID via `readSessionId()`, call `spawnClaude()` with or without `--resume --session-id`, start stdout reading loop, capture session ID from initial events, emit `session_init` IPC event
  - Rewrite `handleUserMessage()`: format user message as stream-json input JSON, write to `this.claudeProcess.stdin` as a JSON line, read stdout events and map to IPC outbound types per Table T01
  - Rewrite `handleInterrupt()`: set `this.interrupted = true`, call `this.claudeProcess.kill("SIGINT")` per [D09]; emit `turn_cancelled` when stream ends with interrupted flag set
  - Remove `createCanUseToolCallback()` method entirely
  - Add permission prompt event handling in stdout event loop: detect permission/tool-approval events in stream-json, emit `tool_approval_request` via IPC, wait for response, pipe back to claude stdin (format per research spike, or skip if format unknown)
  - Preserve `getTugtoolRoot()` for `--plugin-dir` resolution
  - Preserve `persistSessionId()` and `readSessionId()` for session file management
  - Preserve `pendingApprovals` and `pendingQuestions` maps for IPC relay
  - Add process exit handler: detect claude process exit, check `interrupted` flag, emit `turn_cancelled` (interrupted) or `error` (unexpected crash) accordingly
- [ ] Simplify `tugtalk/src/permissions.ts`:
  - Remove `createCanUseToolCallback()` method
  - Remove `CanUseToolCallback` type alias
  - Remove `PermissionResult` interface
  - Keep `PermissionMode` type, `setMode()`, `getMode()` (used to pass `--permission-mode` to CLI)
- [ ] Rewrite `tugtalk/src/__tests__/session.test.ts`:
  - Remove all SDK-related test setup and mocking
  - Test SessionManager constructor does not throw
  - Test `handleInterrupt` when no active process does not throw
  - Test `handleToolApproval` resolves pending promise
  - Test `handleQuestionAnswer` resolves pending promise
  - Test permission mode handling
- [ ] Update `tugtalk/src/__tests__/permissions.test.ts`:
  - Remove tests for `createCanUseToolCallback`
  - Keep tests for `getMode()` / `setMode()` / default mode

**Tests:**
- [ ] Unit: `bun install` succeeds with no SDK dependency
- [ ] Unit: `grep -r "claude-agent-sdk" tugtalk/src/` returns empty
- [ ] Unit: `grep -r "createSDKAdapter\|AdapterSession\|unstable_v2" tugtalk/src/` returns empty
- [ ] Unit: `SessionManager` constructor does not throw
- [ ] Unit: `handleInterrupt` when no active process does not throw
- [ ] Unit: `handleToolApproval` resolves pending promise
- [ ] Unit: `handleQuestionAnswer` resolves pending promise
- [ ] Unit: `PermissionManager.getMode()` returns `"acceptEdits"` by default
- [ ] Unit: `PermissionManager.setMode("plan")` changes the mode
- [ ] Unit: `permissions.ts` contains no reference to `canUseTool` or `CanUseToolCallback`

**Checkpoint:**
- [ ] `bun install` in `tugtalk/` succeeds
- [ ] `bun build tugtalk/src/main.ts` succeeds (type-checks and bundles without errors)
- [ ] `bun test` in `tugtalk/` passes all tests (zero failures)
- [ ] `grep -r "claude-agent-sdk" tugtalk/src/` returns no matches
- [ ] `grep -r "sdk-adapter" tugtalk/src/` returns no matches
- [ ] `.tugtool/tugplan-tugtalk-transport-fix.md` does not exist

**Rollback:**
- `git checkout -- tugtalk/ .tugtool/tugplan-tugtalk-transport-fix.md`

**Commit after all checkpoints pass.**

---

#### Step 1: Comprehensive Test Suite and CLI Argument Verification {#step-1}

**Depends on:** #step-0

**Commit:** `test(tugtalk): add comprehensive tests for direct CLI spawning and event mapping`

**References:** [D01] Direct CLI spawn, [D02] Long-lived process, [D05] Session persistence, [D09] Interrupt mechanism, Spec S01 (#s01-spawn-args), Table T01 (#t01-event-mapping), Table T03 (#t03-file-changes), (#stream-json-mapping, #interrupt-flow)

**Artifacts:**
- Extended `tugtalk/src/__tests__/session.test.ts` with CLI argument and event mapping tests
- Updated `tugtalk/src/__tests__/main.test.ts` if needed for new architecture
- All tests passing

**Tasks:**
- [ ] Add test: verify `spawnClaude()` constructs correct CLI arguments for new session (includes `--output-format stream-json`, `--input-format stream-json`, `--include-partial-messages`, `--replay-user-messages`, `--plugin-dir`, `--model`, `--permission-mode`, `-p`)
- [ ] Add test: verify `spawnClaude()` constructs correct CLI arguments for resumed session (includes `--resume --session-id <id>` instead of `-p`)
- [ ] Add test: verify `--plugin-dir` is set to `getTugtoolRoot()` output
- [ ] Add test: verify `--permission-mode` matches PermissionManager state
- [ ] Add test: stream-json `content_block_delta` event with `delta.text` maps to `assistant_text` IPC message with `is_partial: true`
- [ ] Add test: stream-json `assistant` event maps to `assistant_text` IPC message with `is_partial: false`
- [ ] Add test: stream-json `result` event maps to `turn_complete` IPC message
- [ ] Add test: stream-json `tool_use` event maps to `tool_use` IPC message
- [ ] Add test: interrupt with `interrupted=true` and no `result` event produces `turn_cancelled` IPC message
- [ ] Add test: unexpected process exit with `interrupted=false` produces `error` IPC message
- [ ] Verify `main.test.ts` works with the new architecture (protocol handshake test may need adjustment if `initialize()` now spawns claude -- mock `Bun.which` or `Bun.spawn` as needed)
- [ ] Verify `ipc.test.ts` still passes (JSON-lines protocol unchanged)
- [ ] Verify `types.test.ts` still passes (type definitions unchanged)

**Tests:**
- [ ] Unit: CLI argument construction for new session (all expected flags present)
- [ ] Unit: CLI argument construction for resumed session (`--resume --session-id` present, `-p` absent)
- [ ] Unit: stream-json `content_block_delta` maps to `assistant_text` with `is_partial: true`
- [ ] Unit: stream-json `assistant` maps to `assistant_text` with `is_partial: false`
- [ ] Unit: stream-json `result` maps to `turn_complete`
- [ ] Unit: stream-json `tool_use` maps to `tool_use`
- [ ] Unit: interrupt produces `turn_cancelled`
- [ ] Unit: unexpected exit produces `error`
- [ ] Integration: full IPC round-trip with mocked claude process

**Checkpoint:**
- [ ] `bun test` passes all tests (zero failures)
- [ ] `bun build --compile tugtalk/src/main.ts --outfile /tmp/tugtalk-test` succeeds
- [ ] `cargo build` succeeds (build.rs tugtalk compilation works)

**Rollback:**
- Revert test files

**Commit after all checkpoints pass.**

---

#### Step 2: Final Verification and Cleanup {#step-2}

**Depends on:** #step-1

**Commit:** `chore(tugtalk): final cleanup and verification of stream-json pivot`

**References:** [D04] Full SDK removal, [D06] Delete transport fix plan, Table T03 (#t03-file-changes), (#files-affected)

**Artifacts:**
- Clean codebase with zero SDK references in source files
- Verified end-to-end build pipeline

**Tasks:**
- [ ] Run `grep -r "claude-agent-sdk" tugtalk/` to confirm zero SDK references in tugtalk source and config (note: references in `.tugtool/` plan files and other documentation are expected and acceptable)
- [ ] Run `grep -r "sdk-adapter" tugtalk/` to confirm zero references to deleted adapter
- [ ] Run `grep -r "createSDKAdapter\|AdapterSession\|unstable_v2" tugtalk/` to confirm no leftover SDK types
- [ ] Verify `cargo build` succeeds (full pipeline including tugtalk compilation via build.rs)
- [ ] Verify `cargo nextest run` passes all Rust tests
- [ ] Verify `bun test` passes all TypeScript tests
- [ ] Clean up any TODO/FIXME comments added during the pivot
- [ ] Verify `.tugtool/tugplan-tugtalk-transport-fix.md` does not exist

**Tests:**
- [ ] Integration: `cargo build` succeeds end-to-end
- [ ] Integration: `bun test` in `tugtalk/` passes all tests

**Checkpoint:**
- [ ] `cargo build` succeeds
- [ ] `cargo nextest run` passes
- [ ] `bun test` in `tugtalk/` passes
- [ ] `grep -r "claude-agent-sdk" tugtalk/src/` returns empty
- [ ] `grep -r "sdk-adapter" tugtalk/src/` returns empty
- [ ] `ls .tugtool/tugplan-tugtalk-transport-fix.md` returns "No such file"

**Rollback:**
- Full revert of all commits in this plan

**Commit after all checkpoints pass.**

---

### 8.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugtalk conversation engine spawns the claude CLI directly with stream-json format, with zero SDK dependency, full CLI feature access, and unchanged tugcast/tugdeck integration.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `@anthropic-ai/claude-agent-sdk` does not appear in tugtalk source files (`grep -r "claude-agent-sdk" tugtalk/src/` returns empty)
- [ ] `tugtalk/src/sdk-adapter.ts` does not exist
- [ ] `tugtalk/package.json` has no SDK dependency
- [ ] `session.ts` spawns claude CLI with `--output-format stream-json --input-format stream-json` flags
- [ ] stream-json events are mapped to IPC outbound types (assistant_text, tool_use, tool_result, turn_complete)
- [ ] Permission mode is passed via `--permission-mode` CLI flag; interactive permission relay implemented if format discoverable, deferred otherwise (per Risk R01)
- [ ] Session persistence works via `--resume --session-id` CLI flags
- [ ] Interrupts produce `turn_cancelled` IPC events (per [D09])
- [ ] `cargo build` succeeds
- [ ] `bun test` passes all tests
- [ ] `.tugtool/tugplan-tugtalk-transport-fix.md` has been deleted

**Acceptance tests:**
- [ ] Integration test: mocked claude process receives correct CLI arguments
- [ ] Integration test: stream-json events produce correct IPC outbound messages
- [ ] Integration test: interrupt produces `turn_cancelled` IPC event
- [ ] Integration test: full build pipeline (`cargo build`) completes successfully

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Investigate and map all stream-json event types comprehensively (some event types may only be discovered through real usage)
- [ ] Add reconnection logic if claude process crashes mid-conversation
- [ ] Explore `--continue` flag for auto-continuing without user prompts
- [ ] Add support for attachments in `user_message` via stream-json input format
- [ ] Implement interactive permission relay if deferred due to unknown input format (Risk R01 follow-up)
- [ ] Optimize `build.rs` bun install guard for empty-dependency case (skip install when `package.json` has no dependencies)

| Checkpoint | Verification |
|------------|--------------|
| SDK fully removed from source | `grep -r "claude-agent-sdk" tugtalk/src/ \| wc -l` returns 0 |
| Build pipeline works | `cargo build` exits 0 |
| Tests pass | `bun test` in `tugtalk/` exits 0 |
| Old plan deleted | `test ! -f .tugtool/tugplan-tugtalk-transport-fix.md` |

**Commit after all checkpoints pass.**
