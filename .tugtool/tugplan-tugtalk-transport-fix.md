## Phase 7.0: Fix tugtalk ProcessTransport Crash {#phase-tugtalk-transport-fix}

**Purpose:** Eliminate the ProcessTransport crash in tugtalk caused by environment variable wipeout in the SDK adapter, a race condition in initialization, and an outdated SDK version -- restoring functional conversation sessions.

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

The tugtalk conversation engine crashes immediately when attempting to create an SDK session. The root cause is in `tugtalk/src/sdk-adapter.ts`: when `options.cwd` is set, the adapter passes `env: { PWD: options.cwd }` to the SDK. The SDK's internal session constructor spreads `Q.env ?? process.env` -- since `Q.env` is truthy (a single-key object), it replaces the entire child process environment with just `{ PWD, CLAUDE_CODE_ENTRYPOINT }`. The child CLI process dies immediately because PATH, HOME, ANTHROPIC_API_KEY, and all other environment variables are absent. The exit handler sets `ProcessTransport.ready=false`, and when `streamInput` tries to write the first user message, it throws "ProcessTransport is not ready for writing".

A secondary issue compounds the problem: `main.ts` fires `sessionManager.initialize()` without awaiting it, so user messages from the IPC loop can arrive before the session is ready. Additionally, the SDK version (0.2.42) and model ID (`claude-opus-4-20250514`) are outdated.

#### Strategy {#strategy}

- Fix the critical environment variable wipeout first -- this is the root cause of the crash
- Block the IPC message loop on initialization to eliminate the race condition
- Upgrade the SDK version from 0.2.42 to 0.2.44
- Update the model ID to the current `claude-opus-4-6`
- Add stderr callback for SDK debugging visibility
- Add regression tests to prevent the env wipeout from recurring

#### Stakeholders {#stakeholders}

1. Tugtool users who rely on tugtalk conversation sessions via tugdeck
2. Developers maintaining the tugtalk conversation engine

#### Success Criteria (Measurable) {#success-criteria}

- `bun test` in `tugtalk/` passes with zero failures (verification: run `cd tugtalk && bun test`)
- SDK adapter passes `process.env` merged with `PWD` override when `cwd` is set (verification: unit test asserting env object contains PATH, HOME, etc.)
- The IPC loop does not process user messages until `initialize()` has resolved (verification: unit test or code inspection confirming `await` before loop)
- `package.json` references SDK version 0.2.44 (verification: `jq .dependencies tugtalk/package.json`)
- Model ID is updated to `claude-opus-4-6` (verification: grep session.ts for model string)

#### Scope {#scope}

1. Fix environment variable merging in `sdk-adapter.ts` for both `createSession` and `resumeSession`
2. Await `initialize()` in `main.ts` before entering the IPC message loop
3. Upgrade `@anthropic-ai/claude-agent-sdk` from 0.2.42 to 0.2.44 in `package.json`
4. Update model ID from `claude-opus-4-20250514` to `claude-opus-4-6` in `session.ts`
5. Add stderr callback option to the SDK adapter for debugging visibility
6. Add regression tests for env merging behavior

#### Non-goals (Explicitly out of scope) {#non-goals}

- Refactoring the overall tugtalk architecture or IPC protocol
- Adding new features to the conversation engine
- Changing the permission model or tool approval flow
- Modifying the tugdeck frontend

#### Dependencies / Prerequisites {#dependencies}

- PR #25 (conversation wiring fix) has been merged
- `@anthropic-ai/claude-agent-sdk` 0.2.44 must be available on npm

#### Constraints {#constraints}

- All changes must be backward-compatible with the existing IPC protocol
- No breaking changes to AdapterSession or AdapterSessionOptions interfaces (additive only)
- Bun runtime compatibility must be maintained

#### Assumptions {#assumptions}

- The env merging fix is the critical path: `env: options.cwd ? { ...process.env, PWD: options.cwd } : undefined`
- The SDK version upgrade (0.2.42 to 0.2.44) is low-risk with no breaking API changes
- Model ID `claude-opus-4-6` is the current correct identifier
- No breaking changes to the existing tugtalk IPC protocol are needed
- Test coverage should be added for the env merging to prevent regression

---

### 7.0.0 Design Decisions {#design-decisions}

#### [D01] Merge process.env with PWD override (DECIDED) {#d01-env-merge}

**Decision:** When `options.cwd` is set, pass `{ ...process.env, PWD: options.cwd }` instead of `{ PWD: options.cwd }` to the SDK session constructor.

**Rationale:**
- The SDK spreads `Q.env ?? process.env` internally -- if `Q.env` is truthy, `process.env` is never used
- A single-key env object wipes PATH, HOME, ANTHROPIC_API_KEY, and all other variables the child process needs
- Spreading `process.env` first and then overriding `PWD` preserves the full environment while correctly setting the working directory

**Implications:**
- Both `createSession` and `resumeSession` in `sdk-adapter.ts` must be updated identically
- The child process will inherit all parent environment variables, which is the expected behavior

#### [D02] Await initialize before IPC loop (DECIDED) {#d02-await-init}

**Decision:** Restructure `main.ts` so that `initialize()` is awaited before the IPC message loop begins processing user messages, rather than using fire-and-forget with `.catch()`.

**Rationale:**
- The fire-and-forget pattern allows user messages to arrive before the session is ready
- The `sessionManager` null check in `handleUserMessage` is insufficient because the manager exists but the session inside it may not be initialized yet
- Awaiting ensures deterministic ordering: protocol_ack, session_init, then user messages

**Implications:**
- The `protocol_init` handler must await `initialize()` inline, then continue the loop
- Error handling for initialization failure must still emit an error message and exit

#### [D03] Upgrade SDK to 0.2.44 (DECIDED) {#d03-sdk-upgrade}

**Decision:** Upgrade `@anthropic-ai/claude-agent-sdk` from 0.2.42 to 0.2.44 in `tugtalk/package.json`.

**Rationale:**
- Newer SDK may contain fixes relevant to session stability
- Staying current reduces drift and risk of hitting known-fixed bugs

**Implications:**
- Must run `bun install` after updating `package.json`
- Must verify all existing tests pass with the new version

#### [D04] Update model ID to claude-opus-4-6 (DECIDED) {#d04-model-id}

**Decision:** Replace the model identifier `claude-opus-4-20250514` with `claude-opus-4-6` in `session.ts`.

**Rationale:**
- The dated model ID (`claude-opus-4-20250514`) may be outdated or deprecated
- `claude-opus-4-6` is the current model identifier

**Implications:**
- Both `createSession` and `resumeSession` calls in `session.ts` reference the model string and both must be updated
- The model string also appears in `sdk-adapter.test.ts` and must be updated there

#### [D05] Add stderr callback for SDK debugging (DECIDED) {#d05-stderr-callback}

**Decision:** Add an optional `onStderr` callback to `AdapterSessionOptions` and wire it through to the SDK session options for debugging visibility.

**Rationale:**
- When the child process fails, stderr output is currently invisible
- A callback allows tugtalk to log SDK child process stderr to its own stderr stream
- This aids future debugging without requiring code changes

**Implications:**
- `AdapterSessionOptions` interface gains an optional `onStderr` field
- Both `createSession` and `resumeSession` pass it through to the SDK
- `session.ts` provides a callback that logs to console.error

---

### 7.0.5 Execution Steps {#execution-steps}

#### Step 0: Fix environment variable merging in sdk-adapter.ts {#step-0}

**Commit:** `fix(tugtalk): merge process.env with PWD override in SDK adapter`

**References:** [D01] Merge process.env with PWD override, (#context, #strategy)

**Artifacts:**
- Modified `tugtalk/src/sdk-adapter.ts` -- env merging in `createSession` and `resumeSession`
- Modified `tugtalk/src/__tests__/sdk-adapter.test.ts` -- regression test for env merging

**Tasks:**
- [ ] In `sdk-adapter.ts` line 42, change `env: options.cwd ? { PWD: options.cwd } : undefined` to `env: options.cwd ? { ...process.env, PWD: options.cwd } : undefined` in `createSession`
- [ ] In `sdk-adapter.ts` line 75, apply the identical fix in `resumeSession`
- [ ] Update the comment at the top of `sdk-adapter.ts` to reference the new SDK version (0.2.44)
- [ ] Add a unit test that constructs the adapter with `cwd` set and verifies the resulting env object contains `PATH`, `HOME`, and `PWD`

**Tests:**
- [ ] Unit test: `sdk-adapter.test.ts` -- "env merging includes process.env when cwd is set"
- [ ] Unit test: `sdk-adapter.test.ts` -- "env is undefined when cwd is not set"

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugtalk && bun test src/__tests__/sdk-adapter.test.ts`

**Rollback:**
- Revert the two env lines in `sdk-adapter.ts` back to `{ PWD: options.cwd }`

**Commit after all checkpoints pass.**

---

#### Step 1: Await initialize in main.ts {#step-1}

**Depends on:** #step-0

**Commit:** `fix(tugtalk): await initialize() before entering IPC message loop`

**References:** [D02] Await initialize before IPC loop, (#context, #strategy)

**Artifacts:**
- Modified `tugtalk/src/main.ts` -- replace fire-and-forget `initialize().catch()` with `await initialize()`

**Tasks:**
- [ ] Replace the fire-and-forget block (lines 70-78) with `await sessionManager.initialize()` wrapped in try/catch
- [ ] In the catch block, emit the same error message and `process.exit(1)` as the current `.catch()` handler
- [ ] Verify that `protocol_ack` is still sent before `initialize()` is awaited (the current ordering sends `protocol_ack` at line 63, then starts init at line 70 -- this ordering must be preserved)

**Tests:**
- [ ] Integration test: `main.test.ts` -- existing protocol handshake test still passes (protocol_ack arrives before session_init)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugtalk && bun test src/__tests__/main.test.ts`

**Rollback:**
- Revert `main.ts` to the fire-and-forget pattern

**Commit after all checkpoints pass.**

---

#### Step 2: Upgrade SDK and update model ID {#step-2}

**Depends on:** #step-1

**Commit:** `chore(tugtalk): upgrade SDK to 0.2.44 and update model ID`

**References:** [D03] Upgrade SDK to 0.2.44, [D04] Update model ID to claude-opus-4-6, (#dependencies)

**Artifacts:**
- Modified `tugtalk/package.json` -- SDK version bump
- Modified `tugtalk/bun.lockb` -- lockfile update
- Modified `tugtalk/src/session.ts` -- model ID update
- Modified `tugtalk/src/__tests__/sdk-adapter.test.ts` -- model ID update in test

**Tasks:**
- [ ] In `tugtalk/package.json`, change `"@anthropic-ai/claude-agent-sdk": "0.2.42"` to `"0.2.44"`
- [ ] Run `cd tugtalk && bun install` to update the lockfile
- [ ] In `tugtalk/src/session.ts`, replace both occurrences of `"claude-opus-4-20250514"` with `"claude-opus-4-6"` (lines 57 and 69)
- [ ] In `tugtalk/src/__tests__/sdk-adapter.test.ts`, update the model string in the `createSession` test (line 25) if it references the old model ID
- [ ] Update the SDK version comment at the top of `sdk-adapter.ts` to `0.2.44`

**Tests:**
- [ ] Unit test: all existing tests pass with the new SDK version
- [ ] Unit test: `session.test.ts` suite passes

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugtalk && bun test`
- [ ] `jq '.dependencies["@anthropic-ai/claude-agent-sdk"]' tugtalk/package.json` outputs `"0.2.44"`

**Rollback:**
- Revert `package.json` to 0.2.42 and run `bun install`
- Revert model ID changes in `session.ts` and test files

**Commit after all checkpoints pass.**

---

#### Step 3: Add stderr callback for SDK debugging {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugtalk): add stderr callback to SDK adapter for debugging visibility`

**References:** [D05] Add stderr callback for SDK debugging, (#strategy)

**Artifacts:**
- Modified `tugtalk/src/sdk-adapter.ts` -- `onStderr` option in `AdapterSessionOptions` and wired through to SDK
- Modified `tugtalk/src/session.ts` -- provide `onStderr` callback that logs to console.error

**Tasks:**
- [ ] Add `onStderr?: (data: string) => void` to the `AdapterSessionOptions` interface in `sdk-adapter.ts`
- [ ] In `createSession`, if `options.onStderr` is provided, pass it as `onStderr` in the SDK options object
- [ ] In `resumeSession`, do the same
- [ ] In `session.ts`, add `onStderr: (data: string) => console.error("[sdk stderr]", data)` to both `createSession` and `resumeSession` option objects

**Tests:**
- [ ] Unit test: `sdk-adapter.test.ts` -- verify `onStderr` callback is passed through (mock test)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugtalk && bun test`

**Rollback:**
- Remove `onStderr` from interfaces and call sites

**Commit after all checkpoints pass.**

---

### 7.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A working tugtalk conversation engine that correctly creates SDK sessions with a full environment, blocks IPC messages until initialization completes, uses SDK 0.2.44 with the current model ID, and provides stderr debugging visibility.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugtalk && bun test` passes with zero failures
- [ ] `sdk-adapter.ts` passes `{ ...process.env, PWD: options.cwd }` in both `createSession` and `resumeSession`
- [ ] `main.ts` awaits `initialize()` before processing IPC messages
- [ ] `package.json` references `@anthropic-ai/claude-agent-sdk` version `0.2.44`
- [ ] `session.ts` uses model ID `claude-opus-4-6`
- [ ] Manual smoke test: start tugtalk via tugdeck, send a message, receive a response without crash

**Acceptance tests:**
- [ ] Unit test: env merging regression test passes
- [ ] Integration test: protocol handshake test passes
- [ ] Unit test: full test suite passes (`bun test`)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add integration test that verifies full round-trip message flow (requires API key)
- [ ] Investigate session resume reliability and add retry logic
- [ ] Add connection health monitoring and automatic reconnection

| Checkpoint | Verification |
|------------|--------------|
| All tests pass | `cd tugtalk && bun test` |
| Env merging correct | Unit test + code inspection |
| Init race eliminated | Code inspection of `main.ts` await pattern |
| SDK version current | `jq .dependencies tugtalk/package.json` |
| Model ID current | `grep claude-opus tugtalk/src/session.ts` |

**Commit after all checkpoints pass.**
