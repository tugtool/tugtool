## Phase 7.1: Conversation Card Wiring {#phase-conversation-wiring}

**Purpose:** Fix the conversation pipeline so the conversation card in tugdeck actually works end-to-end: user messages reach tugtalk, assistant responses stream back, and the full-duplex conversation is functional in the browser.

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

Phase 7.0 built all the conversation frontend components (ConversationCard, tugtalk IPC process, tugcast agent bridge, message rendering, tool cards, approval prompts, question cards, streaming, IndexedDB cache) across 19 steps. The conversation card component is mounted in the deck grid, the WebSocket protocol defines feed IDs 0x40 (conversation output) and 0x41 (conversation input), and tugcast spawns the agent bridge that runs tugtalk.

However, the conversation is non-functional. Code investigation reveals the root cause: `TugConnection.send()` expects two arguments `(feedId: FeedIdValue, payload: Uint8Array)` but `ConversationCard` calls `this.connection.send(encoded)` with a single pre-encoded `ArrayBuffer` from `encodeConversationInput()`. This means user input is silently dropped -- `feedId` receives the ArrayBuffer, `payload` receives `undefined`, and the resulting frame is garbage. The conversation card renders but cannot send messages.

Additionally, tugtalk may not be available as a compiled binary, requiring the bun-run fallback path in the agent bridge, and the full pipeline (browser -> WebSocket -> tugcast -> tugtalk -> Claude -> response back) has never been verified end-to-end.

#### Strategy {#strategy}

- Start with a diagnostic step to characterize the exact failure points across the full pipeline
- Fix the critical `send()` API mismatch in `ConversationCard` so user input reaches the server
- Verify tugtalk is reachable by the agent bridge (binary or bun-run fallback)
- Run end-to-end verification of the complete conversation round-trip
- Keep changes minimal -- no refactoring of components that are functionally correct

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using tugdeck to interact with Claude through the conversation card
2. tugcode launcher users who expect the conversation card to work out of the box

#### Success Criteria (Measurable) {#success-criteria}

- User can type a message in the conversation card, press Enter, and see an assistant response rendered in the message list
- The full pipeline browser -> WebSocket -> tugcast -> tugtalk -> Claude API -> response back works without errors in the console
- `bun test` passes in `tugtalk/` with no failures
- `cargo build` succeeds for tugcast with no warnings
- `bun run build` succeeds for tugdeck with no errors

#### Scope {#scope}

1. Fix `TugConnection.send()` call-site mismatch in ConversationCard
2. Update MockConnection in all three test files to match corrected send signature
3. Verify tugtalk reachability from agent bridge
4. End-to-end conversation round-trip verification

#### Non-goals (Explicitly out of scope) {#non-goals}

- Modifying the ConversationCard rendering logic, tool cards, approval prompts, or any UI components
- Changing the tugtalk session management or SDK adapter
- Adding new features to the conversation card
- Modifying the WebSocket protocol or frame format
- CSS or layout changes to the deck grid

#### Dependencies / Prerequisites {#dependencies}

- Phase 7.0 conversation frontend components must be present in the codebase (verified: they exist)
- Bun runtime must be installed for tugtalk fallback execution
- ANTHROPIC_API_KEY must be set in the environment for end-to-end testing

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`) -- all Rust changes must compile warning-free
- TypeScript must compile with no errors via `bun run build` in tugdeck
- Changes should be minimal and targeted to avoid regressions in the existing working cards

#### Assumptions {#assumptions}

- The ConversationCard component rendering logic is correct and only the send path is broken
- The WebSocket frame encoding/decoding for 0x40/0x41 is working correctly on the server side
- The tugtalk source code is functionally complete and its tests pass
- tugcast's agent bridge module is correctly implemented and just needs tugtalk to be available
- The CSS grid layout already positions the conversation card correctly

---

### 7.1.0 Design Decisions {#design-decisions}

#### [D01] Fix send() call-sites rather than change send() signature (DECIDED) {#d01-fix-callsites}

**Decision:** Fix the six call-sites in ConversationCard that call `this.connection.send(encoded)` to instead call `this.connection.send(FeedId.CONVERSATION_INPUT, payload)` with the properly encoded payload, rather than changing `TugConnection.send()` to accept a raw ArrayBuffer.

**Rationale:**
- `TugConnection.send(feedId, payload)` is the established API used by terminal input, heartbeat, and other callers
- Changing the signature would break those callers or require an overload that obscures the protocol
- `encodeConversationInput()` in `protocol.ts` already pre-encodes the full frame, so the call-sites should use the lower-level path: `JSON.stringify` the message, `TextEncoder.encode` to get bytes, and call `send(FeedId.CONVERSATION_INPUT, payload)`

**Implications:**
- The `encodeConversationInput()` helper function in `protocol.ts` becomes unused after the fix (it pre-encodes the full frame including header, which is redundant with what `send()` does internally)
- All six send call-sites in conversation-card.ts must be updated consistently
- The terminal card can serve as the reference pattern for correct `send()` usage
- Three test files with MockConnection classes must be updated in lockstep: their `send(data: ArrayBuffer)` mock signature and `getLastMessage()`/`getAllMessages()` decoding logic must change to match the corrected two-argument `send(feedId, payload)` API (see (#mock-connection-update))

#### [D02] Verify tugtalk via bun-run fallback (DECIDED) {#d02-tugtalk-bun-fallback}

**Decision:** Verify that the bun-run fallback path in `agent_bridge.rs` correctly launches tugtalk when no compiled binary is available, rather than building and installing a tugtalk binary.

**Rationale:**
- The agent bridge already has `resolve_tugtalk_path()` with a bun-run fallback: it runs `bun run tugtalk/src/main.ts`
- Building a native tugtalk binary is a separate concern and not required for the conversation to work
- The fallback path is the expected development-time execution mode

**Implications:**
- No new build step or binary installation needed
- The `--tugtalk-path` CLI flag on tugcast is available if a custom path is needed
- Bun must be installed and on PATH

---

### 7.1.1 Specification {#specification}

#### Send API Fix {#send-api-fix}

The current code in `conversation-card.ts` does:

```typescript
const encoded = encodeConversationInput(msg);
this.connection.send(encoded); // BUG: send() expects (feedId, payload)
```

The fix changes each call-site to:

```typescript
const json = JSON.stringify(msg);
const payload = new TextEncoder().encode(json);
this.connection.send(FeedId.CONVERSATION_INPUT, payload);
```

This matches the pattern used by `TerminalCard` for terminal input, ensuring the frame is properly constructed by `TugConnection.send()` which calls `encodeFrame()` internally.

**Affected call-sites in conversation-card.ts:**
1. Permission mode change handler (line ~113)
2. `handleSend()` -- user message (line ~514)
3. `renderApprovalRequest()` -- allow decision (line ~636)
4. `renderApprovalRequest()` -- deny decision (line ~664)
5. `renderQuestion()` -- question answer (line ~699)
6. `sendInterrupt()` -- interrupt signal (line ~739)

#### MockConnection Test Update {#mock-connection-update}

Three test files contain a `MockConnection` class with `send(data: ArrayBuffer)` matching the old (broken) single-argument call pattern. After the fix, `ConversationCard` will call `send(feedId, payload)` with two arguments. The mock implementations must be updated to match the real `TugConnection.send(feedId: FeedIdValue, payload: Uint8Array)` signature.

**Affected test files:**
1. `tugdeck/src/cards/conversation-card.test.ts` -- has `MockConnection` with `send(data: ArrayBuffer)`, `getLastMessage()`, `clear()`
2. `tugdeck/src/__tests__/e2e-integration.test.ts` -- has `MockConnection` with `send(data: ArrayBuffer)`, `getLastMessage()`, `getAllMessages()`, `clear()`
3. `tugdeck/src/cards/conversation/session-integration.test.ts` -- has `MockConnection` with `send(data: ArrayBuffer)`, `getLastMessage()`, `getAllMessages()`, `clear()`

**Current mock pattern (broken after fix):**
```typescript
class MockConnection implements Partial<TugConnection> {
  sentMessages: ArrayBuffer[] = [];
  send(data: ArrayBuffer): void {
    this.sentMessages.push(data);
  }
  getLastMessage(): any {
    const buffer = this.sentMessages[this.sentMessages.length - 1];
    const HEADER_SIZE = 5;
    const payload = new Uint8Array(buffer, HEADER_SIZE); // Crashes: buffer is now a number
    return JSON.parse(new TextDecoder().decode(payload));
  }
}
```

**Updated mock pattern (matches real TugConnection.send signature):**
```typescript
class MockConnection implements Partial<TugConnection> {
  sentFrames: { feedId: number; payload: Uint8Array }[] = [];
  send(feedId: number, payload: Uint8Array): void {
    this.sentFrames.push({ feedId, payload });
  }
  getLastMessage(): any {
    if (this.sentFrames.length === 0) return null;
    const { payload } = this.sentFrames[this.sentFrames.length - 1];
    return JSON.parse(new TextDecoder().decode(payload));
  }
  getAllMessages(): any[] {
    return this.sentFrames.map(({ payload }) =>
      JSON.parse(new TextDecoder().decode(payload))
    );
  }
  clear(): void {
    this.sentFrames = [];
  }
}
```

The key changes: `sentMessages: ArrayBuffer[]` becomes `sentFrames: { feedId: number; payload: Uint8Array }[]`; `send()` captures both arguments; `getLastMessage()` and `getAllMessages()` decode directly from the payload without stripping a frame header (since `TugConnection.send()` handles framing internally). Any test assertions that reference `sentMessages` must be updated to `sentFrames`.

---

### 7.1.5 Execution Steps {#execution-steps}

#### Step 0: Diagnose the conversation pipeline {#step-0}

> **Note:** This is a diagnostic-only step with no code changes. The commit records findings. If the implementer's environment confirms the analysis, this step can be fast-tracked by recording the verification results and proceeding directly to Step 1.

**Commit:** `chore(conversation): diagnose conversation pipeline state`

**References:** [D01] Fix send() call-sites, [D02] Verify tugtalk via bun-run fallback, (#context, #send-api-fix)

**Artifacts:**
- Diagnostic findings documented in commit message (no code changes)

**Tasks:**
- [ ] Verify that `ConversationCard` is instantiated and mounted in `tugdeck/src/main.ts` (expected: yes, confirmed by codebase read)
- [ ] Verify that `deck.addCard(conversationCard, "conversation")` registers the card's feedIds with the connection (expected: yes, `addCard` calls `connection.onFrame` for each feedId)
- [ ] Confirm the `send()` API mismatch: `TugConnection.send(feedId, payload)` vs `tugdeck/src/cards/conversation-card.ts` calling `send(encoded)` with one arg
- [ ] Verify tugtalk source exists at `tugtalk/src/main.ts` and `tugtalk/node_modules` is installed
- [ ] Run `cd tugtalk && bun test` to verify tugtalk tests pass
- [ ] Run `cargo build -p tugcast` to verify tugcast compiles cleanly
- [ ] Run `cd tugdeck && bun run build` to verify tugdeck compiles cleanly

**Tests:**
- [ ] Unit test: `bun test` in `tugtalk/` passes
- [ ] Integration test: `cargo build -p tugcast` succeeds with no warnings

**Checkpoint:**
- [ ] Diagnostic findings match the analysis: send API mismatch confirmed, tugtalk source present, builds succeed
- [ ] `cd tugtalk && bun test` exits 0
- [ ] `cargo build -p tugcast` exits 0

**Rollback:**
- No code changes in this step; purely diagnostic

**Commit after all checkpoints pass.**

---

#### Step 1: Fix conversation input send path and update test mocks {#step-1}

**Depends on:** #step-0

**Commit:** `fix(tugdeck): fix ConversationCard send() call-sites and MockConnection test mocks`

**References:** [D01] Fix send() call-sites, (#send-api-fix, #mock-connection-update, #specification)

**Artifacts:**
- Modified `tugdeck/src/cards/conversation-card.ts` -- all six send call-sites corrected, `encodeConversationInput` import removed if unused
- Modified `tugdeck/src/cards/conversation-card.test.ts` -- MockConnection updated to `send(feedId, payload)` signature
- Modified `tugdeck/src/__tests__/e2e-integration.test.ts` -- MockConnection updated to `send(feedId, payload)` signature
- Modified `tugdeck/src/cards/conversation/session-integration.test.ts` -- MockConnection updated to `send(feedId, payload)` signature

**Tasks:**

*Fix conversation-card.ts send call-sites:*
- [ ] In `tugdeck/src/cards/conversation-card.ts`, replace each `this.connection.send(encoded)` call with the correct two-argument form: `this.connection.send(FeedId.CONVERSATION_INPUT, new TextEncoder().encode(JSON.stringify(msg)))`
- [ ] Update the import at the top of `tugdeck/src/cards/conversation-card.ts`: remove `encodeConversationInput` from the protocol import if it is no longer used anywhere
- [ ] Verify that `FeedId` is imported from `../protocol`
- [ ] For each of the six call-sites, ensure the message object being stringified is the correct typed object (UserMessageInput, ToolApprovalInput, QuestionAnswerInput, InterruptInput, PermissionModeInput)
- [ ] Check if `encodeConversationInput` is used anywhere else in the codebase; if not, either leave it in `tugdeck/src/protocol.ts` (it is part of the public API surface) or add a comment noting it is unused

*Update MockConnection in all three test files:*
- [ ] In `tugdeck/src/cards/conversation-card.test.ts`: update `MockConnection.send()` from `send(data: ArrayBuffer)` to `send(feedId: number, payload: Uint8Array)`; change `sentMessages: ArrayBuffer[]` to `sentFrames: { feedId: number; payload: Uint8Array }[]`; update `getLastMessage()` to decode directly from the stored payload without stripping a 5-byte header; update `clear()` to reset `sentFrames`; update any test assertions that reference `sentMessages` to use `sentFrames`
- [ ] In `tugdeck/src/__tests__/e2e-integration.test.ts`: apply the same MockConnection updates -- `send(feedId, payload)` signature, `sentFrames` storage, updated `getLastMessage()`, `getAllMessages()`, and `clear()`; update any test assertions referencing `sentMessages`
- [ ] In `tugdeck/src/cards/conversation/session-integration.test.ts`: apply the same MockConnection updates -- `send(feedId, payload)` signature, `sentFrames` storage, updated `getLastMessage()`, `getAllMessages()`, and `clear()`; update any test assertions referencing `sentMessages`

*Build and test verification:*
- [ ] Run `cd tugdeck && bun run build` to verify TypeScript compilation succeeds
- [ ] Run `cd tugdeck && bun test` to verify all three test files pass with the updated mocks

**Tests:**
- [ ] Unit test: `tugdeck/src/cards/conversation-card.test.ts` passes with updated MockConnection
- [ ] Unit test: `tugdeck/src/__tests__/e2e-integration.test.ts` passes with updated MockConnection
- [ ] Unit test: `tugdeck/src/cards/conversation/session-integration.test.ts` passes with updated MockConnection
- [ ] Integration test: `bun run build` in tugdeck succeeds with no errors

**Checkpoint:**
- [ ] All six send call-sites in `tugdeck/src/cards/conversation-card.ts` use `this.connection.send(FeedId.CONVERSATION_INPUT, payload)` pattern
- [ ] All three MockConnection classes updated to `send(feedId: number, payload: Uint8Array)` signature
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun test` exits 0 with all conversation tests passing
- [ ] No TypeScript errors in any modified file

**Rollback:**
- Revert changes to all four files: `tugdeck/src/cards/conversation-card.ts`, `tugdeck/src/cards/conversation-card.test.ts`, `tugdeck/src/__tests__/e2e-integration.test.ts`, `tugdeck/src/cards/conversation/session-integration.test.ts`

**Commit after all checkpoints pass.**

---

#### Step 2: Verify tugtalk reachability and end-to-end pipeline {#step-2}

**Depends on:** #step-1

> **Note:** This is a manual verification step with no code changes. It requires a running tugcast server, a browser, and `ANTHROPIC_API_KEY` set in the environment. If these are not available in the implementation environment, this step can be deferred and performed manually by the user. The commit records the verification outcome.

**Commit:** `chore(conversation): verify end-to-end conversation pipeline`

**References:** [D02] Verify tugtalk via bun-run fallback, (#context, #strategy)

**Artifacts:**
- Verification results documented in commit message (no code changes)

**Tasks:**
- [ ] Verify that `resolve_tugtalk_path(None, &project_dir)` returns the bun-run fallback path `<project_dir>/tugtalk/src/main.ts`
- [ ] Start tugcast manually with `cargo run -p tugcast -- --dir .` and check log output for "Spawning tugtalk" and "Protocol handshake successful"
- [ ] If tugtalk fails to spawn, check: (a) bun is on PATH, (b) `tugtalk/node_modules` exists, (c) `ANTHROPIC_API_KEY` is set
- [ ] Open the tugdeck URL in a browser, verify the conversation card is visible in the left column of the grid
- [ ] Type a test message and press Enter; verify in the browser console that no errors occur and the message is sent
- [ ] Verify that tugcast logs show the conversation input being relayed to tugtalk
- [ ] Verify that the assistant response appears in the conversation card message list

**Tests:**
- [ ] Integration test: tugcast starts and successfully spawns tugtalk (check logs for "Protocol handshake successful")
- [ ] Integration test: a user message typed in the conversation card produces an assistant response

**Checkpoint:**
- [ ] tugcast logs show "Protocol handshake successful" after startup
- [ ] A message sent from the conversation card produces a visible assistant response
- [ ] No errors in browser developer console related to conversation frames
- [ ] No errors in tugcast stderr related to tugtalk spawning or IPC

**Rollback:**
- No code changes in this step; purely verification

**Commit after all checkpoints pass.**

---

### 7.1.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** The conversation card in tugdeck functions end-to-end: users can type messages, see assistant responses, and interact through tool approvals and question answers.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All six `send()` call-sites in `tugdeck/src/cards/conversation-card.ts` use the correct `(feedId, payload)` API
- [ ] All three MockConnection classes updated to `send(feedId, payload)` signature with correct decoding
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `bun run build` in `tugdeck/` succeeds with no errors
- [ ] `bun test` in `tugdeck/` passes (all three conversation test files)
- [ ] `bun test` in `tugtalk/` passes
- [ ] A user can type a message in the conversation card and receive an assistant response in the browser

**Acceptance tests:**
- [ ] Unit test: `tugdeck/src/cards/conversation-card.test.ts` passes with updated MockConnection
- [ ] Unit test: `tugdeck/src/__tests__/e2e-integration.test.ts` passes with updated MockConnection
- [ ] Unit test: `tugdeck/src/cards/conversation/session-integration.test.ts` passes with updated MockConnection
- [ ] Unit test: `bun test` in tugtalk passes
- [ ] Integration test: end-to-end conversation round-trip verified manually (requires running tugcast, browser, and ANTHROPIC_API_KEY)
- [ ] Integration test: `cargo build -p tugcast` compiles warning-free

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Build tugtalk as a compiled native binary for faster startup
- [ ] Add automated end-to-end tests for the conversation pipeline
- [ ] Add connection status indicator to the conversation card header
- [ ] Consider adding a `sendRaw(data: ArrayBuffer)` method to TugConnection for pre-encoded frames

| Checkpoint | Verification |
|------------|--------------|
| Send API fix | All call-sites use `send(FeedId.CONVERSATION_INPUT, payload)` |
| MockConnection update | All three test files use `send(feedId, payload)` mock signature |
| TypeScript build | `bun run build` in tugdeck exits 0 |
| tugdeck tests | `bun test` in tugdeck exits 0 (all conversation tests pass) |
| Rust build | `cargo build -p tugcast` exits 0 |
| tugtalk tests | `bun test` in tugtalk exits 0 |
| End-to-end | Message sent -> response received in browser |

**Commit after all checkpoints pass.**
