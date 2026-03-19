## Dev Notification Improvements {#dev-notification-improvements}

**Purpose:** Fix a critical notification routing bug, add timestamps to the dev notification protocol, rename opaque category numbers to human-readable names, and improve Developer card row labels with timestamped clean/dirty states.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-notification-improvements |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-26 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev-mode notification system (implemented per the `dev-mode-notifications` plan) has a critical routing bug that prevents the Developer card from receiving notifications when it is open. In `action-dispatch.ts`, the code accesses `cardState.tabItems` but the `CardState` interface (defined in `layout-tree.ts`) only has a `tabs` field. The property access silently returns `undefined`, the loop never executes, and the Developer card's `update()` method is never called. The same incorrect property name appears in four mock `CardState` objects in `action-dispatch.test.ts`.

Beyond the routing bug, the dev notification system has three quality-of-life shortcomings: opaque "Category 1/2/3" naming in `dev.rs` comments, no timestamp information on notification payloads, and no temporal context in Developer card row labels. These gaps make it harder for developers to reason about when changes were detected and whether notifications are stale.

#### Strategy {#strategy}

- Fix the routing bug first since it blocks all card-open notification delivery and is a one-line fix in two places.
- Fix test mocks in the same step as the routing bug since they share the same root cause.
- Add timestamps to the Rust notification protocol before working on the TypeScript display layer, establishing the data contract first.
- Rename "Category 1/2/3" comments to human-readable names (styles/code/app) as an isolated comments-only step with no runtime impact.
- Implement timestamped row labels in the Developer card last, consuming the new protocol timestamp field.
- Update existing tests at each step to match the new behavior, keeping the test suite green throughout.

#### Success Criteria (Measurable) {#success-criteria}

- The `action-dispatch.ts` routing code uses `cardState.tabs` (matching the `CardState` interface), verified by grep showing zero occurrences of `tabItems` in `action-dispatch.ts` and its test file.
- All `action-dispatch.test.ts` mock `CardState` objects use `tabs` instead of `tabItems`, verified by test suite passing.
- Every `dev_notification` JSON payload includes a `timestamp` field (integer, millis since epoch), verified by unit test on `send_dev_notification`.
- The `reloaded` payload in `send_dev_notification` uses `serde_json::json!` instead of a raw byte literal, verified by code inspection.
- Zero occurrences of "Category 1", "Category 2", or "Category 3" in `dev.rs` comments, verified by grep.
- Developer card rows display timestamps in clean state (`Clean -- 9:42 AM` format) and dirty state (`2 changes -- since 9:38 AM` format), verified by developer-card tests.
- Restart/Relaunch button clicks reset the "since" timestamp to null so the next dirty event starts a fresh clock, verified by developer-card tests.
- All existing tests pass after each step (`cargo nextest run` for Rust, `bun test` for TypeScript).

#### Scope {#scope}

1. Fix `cardState.tabItems` to `cardState.tabs` in `action-dispatch.ts` (two occurrences) and `action-dispatch.test.ts` (four mock objects).
2. Add `timestamp` field (millis since epoch) to all `dev_notification` payloads in `send_dev_notification` in `dev.rs`; convert the `reloaded` payload from a raw byte literal to `serde_json::json!`.
3. Replace all "Category 1/2/3" references in `dev.rs` comments with "styles/code/app".
4. Update `DeveloperCard` in `developer-card.ts` to store timestamps and display them in clean/dirty row labels; update `developer-card.test.ts` to match.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Watching source files directly (the build-output-watching design is intentional).
- Changing the notification protocol structure beyond adding the `timestamp` field.
- Restructuring the watcher architecture or adding new watcher categories.
- Adding notification persistence or history beyond the current in-memory state.

#### Dependencies / Prerequisites {#dependencies}

- The existing dev-mode notification system is implemented and functional (routing bug notwithstanding).
- `serde_json` is already a dependency of the `tugcast` crate (used for `restart_available`/`relaunch_available` payloads).
- `std::time::SystemTime` and `UNIX_EPOCH` are available in the Rust standard library.

#### Constraints {#constraints}

- The `tugcode` project enforces `-D warnings` via `.cargo/config.toml` -- all Rust changes must compile warning-free.
- TypeScript tests use `bun:test` and `happy-dom` for DOM testing.
- Time formatting in the Developer card must use `toLocaleTimeString()` with hour/minute options (no seconds) for locale-appropriate `9:42 AM` style output.

#### Assumptions {#assumptions}

- The `dev.rs` comment renaming (scope item 3) is a comments-only change with no impact on runtime behavior or tests.
- The timestamp field will use `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64` for millisecond precision matching JavaScript's `Date.now()`.
- Existing tests that assert on plain `"Clean"` status text will need updating to match the new timestamped format or check state separately from timestamp.
- The Developer card receives timestamps from the backend; it does not generate its own timestamps for notification events.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Test assertions on "Clean" break | med | high | Update all assertions in developer-card.test.ts step-by-step | Test failures after timestamp changes |
| Locale-dependent time formatting in tests | med | med | Use regex matchers or mock Date.prototype.toLocaleTimeString in tests | Test failures in CI with different locale |

**Risk R01: Locale-dependent time formatting** {#r01-locale-time-format}

- **Risk:** `toLocaleTimeString()` output varies by locale and environment, making exact string matching in tests fragile.
- **Mitigation:** In tests, either mock `toLocaleTimeString` to return a deterministic value, or use regex matchers that accept any time format (e.g., `/Clean -- \d{1,2}:\d{2}\s?(AM|PM)?/`). The production code uses the real locale formatter for user-appropriate display.
- **Residual risk:** If a CI environment has no locale data, `toLocaleTimeString` may produce unexpected output. This is mitigable by setting `LANG` in CI.

---

### Design Decisions {#design-decisions}

#### [D01] Fix routing bug and test mocks together (DECIDED) {#d01-fix-routing-and-mocks}

**Decision:** Fix `cardState.tabItems` to `cardState.tabs` in both `action-dispatch.ts` and `action-dispatch.test.ts` in the same step.

**Rationale:**
- The test mocks mirror the production code's incorrect property name; fixing one without the other leaves tests broken or falsely passing.
- The user explicitly chose "fix both together" when asked.

**Implications:**
- A single commit covers both files.
- After this fix, the existing action-dispatch tests will exercise the real routing path for the first time.

#### [D02] Use serde_json::json! for all notification payloads (DECIDED) {#d02-serde-json-all-payloads}

**Decision:** Convert the `reloaded` payload in `send_dev_notification` from a raw byte literal (`br#"..."#.to_vec()`) to `serde_json::json!`, matching the existing pattern used by `restart_available` and `relaunch_available`.

**Rationale:**
- A raw byte literal cannot cleanly include a dynamic `timestamp` field.
- Using `serde_json::json!` for all three payload types makes the code consistent and maintainable.
- `serde_json` is already a dependency of the crate.

**Implications:**
- The `reloaded` branch in `send_dev_notification` changes from `br#"..."#.to_vec()` to `serde_json::to_vec(&json!({...})).unwrap_or_default()`.
- All three payload types now include `"timestamp"` in the JSON.

#### [D03] Timestamp is millis since Unix epoch (DECIDED) {#d03-timestamp-millis}

**Decision:** The `timestamp` field in `dev_notification` payloads is an integer representing milliseconds since Unix epoch, matching JavaScript's `Date.now()` convention.

**Rationale:**
- Millisecond precision is sufficient for display purposes (formatted to minute granularity).
- Using the same epoch and unit as JavaScript avoids conversion logic on the frontend.
- `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64` is idiomatic Rust.

**Implications:**
- The TypeScript side can pass the value directly to `new Date(timestamp)`.
- The `as u64` cast is safe because `as_millis()` returns `u128` but milliseconds since epoch fit comfortably in `u64` for the foreseeable future.

#### [D04] Developer card stores per-row timestamps (DECIDED) {#d04-per-row-timestamps}

**Decision:** The `DeveloperCard` maintains two timestamp fields per row: `lastCleanTimestamp` (from the most recent `reloaded`/clean-state notification) and `firstDirtySinceTimestamp` (from the first dirty notification after the last clean state).

**Rationale:**
- Clean state displays "Clean -- 9:42 AM" using the timestamp of the last notification that returned the row to clean.
- Dirty state displays "2 changes -- since 9:38 AM" using the timestamp of the first dirty notification after the last clean.
- Two timestamps per row capture the full temporal context without complex state machines.

**Implications:**
- The `update()` method must track whether each row transitioned from clean to dirty (to capture "since" time) or was already dirty (to preserve the existing "since" time).
- Restart/Relaunch button clicks reset `firstDirtySinceTimestamp` to null so the next dirty event starts a fresh "since" clock.
- The Styles row's `lastCleanTimestamp` is set from the `reloaded` notification's timestamp.

#### [D05] Rename Category 1/2/3 to styles/code/app in comments only (DECIDED) {#d05-rename-categories}

**Decision:** Replace all "Category 1", "Category 2", "Category 3" references in `dev.rs` comments, doc strings, and log strings with "styles", "code", "app" respectively.

**Rationale:**
- The category numbers carry no meaning; the code already uses descriptive function names (`dev_file_watcher`, `dev_compiled_watcher`, `dev_app_watcher`).
- "styles/code/app" match the Developer card's row labels and are self-explanatory.

**Implications:**
- Primarily a comments change; one `warn!` log string at line ~797 also contains "Category 3" and must be updated.
- Future developers reading `dev.rs` will see names that match the UI.

#### [D06] Mock toLocaleTimeString in tests (DECIDED) {#d06-mock-time-format}

**Decision:** In `developer-card.test.ts`, mock `Date.prototype.toLocaleTimeString` to return a deterministic string (e.g., `"9:42 AM"`) so tests are not locale-dependent.

**Rationale:**
- Production code uses the real `toLocaleTimeString` with `{ hour: "numeric", minute: "2-digit" }` options for locale-appropriate display.
- Tests need deterministic output to assert exact strings.
- Mocking the formatter is simpler and more reliable than regex matching across all test assertions.

**Implications:**
- Tests must save and restore the original `toLocaleTimeString` in `beforeEach`/`afterEach`.
- The mock should accept the same options signature to avoid masking bugs.

---

### Specification {#specification}

#### Notification Protocol {#notification-protocol}

**Spec S01: dev_notification payload format** {#s01-notification-payload}

All `dev_notification` payloads include a `timestamp` field. The three notification types are:

| Type | Fields | Example |
|------|--------|---------|
| `reloaded` | `action`, `type`, `timestamp` | `{"action":"dev_notification","type":"reloaded","timestamp":1740000000000}` |
| `restart_available` | `action`, `type`, `changes`, `count`, `timestamp` | `{"action":"dev_notification","type":"restart_available","changes":["frontend"],"count":1,"timestamp":1740000000000}` |
| `relaunch_available` | `action`, `type`, `changes`, `count`, `timestamp` | `{"action":"dev_notification","type":"relaunch_available","changes":["app"],"count":1,"timestamp":1740000000000}` |

The `timestamp` value is milliseconds since Unix epoch (`u64` in Rust, `number` in TypeScript).

#### Developer Card Display States {#display-states}

**Spec S02: Row label format** {#s02-row-label-format}

Each Developer card row displays status text according to its state:

| Row | State | Display format | Example |
|-----|-------|---------------|---------|
| Styles | Clean (initial) | `Clean` | `Clean` |
| Styles | Clean (after reload) | `Clean -- {time}` | `Clean -- 9:42 AM` |
| Styles | Flash | `Reloaded` | `Reloaded` |
| Code | Clean (initial) | `Clean` | `Clean` |
| Code | Clean (after restart) | `Clean -- {time}` | `Clean -- 9:42 AM` |
| Code | Dirty | `{N} change(s) -- since {time}` | `2 changes -- since 9:38 AM` |
| App | Clean (initial) | `Clean` | `Clean` |
| App | Clean (after relaunch) | `Clean -- {time}` | `Clean -- 9:42 AM` |
| App | Dirty | `{N} change(s) -- since {time}` | `1 change -- since 9:40 AM` |

Rules:
- `{time}` is formatted via `new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`.
- Initial mount shows plain `Clean` (no timestamp yet, since no notification has been received).
- The "since" timestamp is captured from the first dirty notification after the last clean state.
- Restart/Relaunch clicks reset the row to `Clean` (no timestamp) and clear `firstDirtySinceTimestamp` to null.
- The Styles row "Clean" timestamp comes from the `reloaded` notification's timestamp (set after the 2-second flash).

#### Timestamp State Machine {#timestamp-state-machine}

**Spec S03: Per-row timestamp tracking** {#s03-timestamp-tracking}

Each row tracks two nullable timestamps:

| Field | Set when | Cleared when |
|-------|----------|--------------|
| `lastCleanTimestamp` | `reloaded` notification (Styles), Restart click (Code), Relaunch click (App) | Never cleared (overwritten by next clean event) |
| `firstDirtySinceTimestamp` | First `restart_available`/`relaunch_available` after clean state | Restart click (Code), Relaunch click (App) |

State transitions:
1. **Mount**: Both timestamps null. Display: `Clean`.
2. **First dirty notification**: Set `firstDirtySinceTimestamp` from payload `timestamp`. Display: `1 change -- since {time}`.
3. **Subsequent dirty notifications**: Keep existing `firstDirtySinceTimestamp`. Update count. Display: `N changes -- since {time}`.
4. **Restart/Relaunch click**: Clear `firstDirtySinceTimestamp` to null. Set `lastCleanTimestamp` to `Date.now()`. Display: `Clean -- {time}`.
5. **Reloaded notification (Styles only)**: After 2-second flash, set `lastCleanTimestamp` from payload `timestamp`. Display: `Clean -- {time}`.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes modify existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `timestamp` | local variable | `tugcode/crates/tugcast/src/dev.rs` (in `send_dev_notification`) | `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64` |
| `stylesLastCleanTs` | private field | `tugdeck/src/cards/developer-card.ts` | `number \| null`, timestamp of last reloaded notification |
| `codeLastCleanTs` | private field | `tugdeck/src/cards/developer-card.ts` | `number \| null`, timestamp of last restart clean |
| `codeFirstDirtySinceTs` | private field | `tugdeck/src/cards/developer-card.ts` | `number \| null`, timestamp of first dirty since last clean |
| `appLastCleanTs` | private field | `tugdeck/src/cards/developer-card.ts` | `number \| null`, timestamp of last relaunch clean |
| `appFirstDirtySinceTs` | private field | `tugdeck/src/cards/developer-card.ts` | `number \| null`, timestamp of first dirty since last clean |
| `formatTime` | private method | `tugdeck/src/cards/developer-card.ts` | Formats a timestamp to locale time string |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions/methods in isolation | Routing fix verification, timestamp formatting, state transitions |
| **Integration** | Test components working together | Action dispatch routing to Developer card, end-to-end notification flow |
| **Drift Prevention** | Detect unintended behavior changes | Existing action-dispatch tests, existing developer-card tests |

---

### Execution Steps {#execution-steps}

#### Step 1: Fix notification routing bug and test mocks {#step-1}

**Commit:** `fix(tugdeck): use cardState.tabs instead of cardState.tabItems in action-dispatch`

**References:** [D01] Fix routing bug and test mocks together, Spec S01, (#context, #notification-protocol)

**Artifacts:**
- Modified `tugdeck/src/action-dispatch.ts` -- fix two occurrences of `cardState.tabItems` to `cardState.tabs`
- Modified `tugdeck/src/__tests__/action-dispatch.test.ts` -- fix four mock `CardState` objects to use `tabs` instead of `tabItems`

**Tasks:**
- [ ] In `action-dispatch.ts`, change `cardState.tabItems` to `cardState.tabs` at line ~192 (dev_notification handler)
- [ ] In `action-dispatch.ts`, change `cardState.tabItems` to `cardState.tabs` at line ~227 (dev_build_progress handler)
- [ ] In `action-dispatch.test.ts`, change all four mock `CardState` objects from `tabItems:` to `tabs:` (lines ~160, ~226, ~265, ~305)

**Tests:**
- [ ] Existing action-dispatch tests pass with the property name fix
- [ ] Verify by grep that zero occurrences of `tabItems` remain in `action-dispatch.ts` and `action-dispatch.test.ts`

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/action-dispatch.test.ts` passes
- [ ] `grep -c tabItems tugdeck/src/action-dispatch.ts` returns 0
- [ ] `grep -c tabItems tugdeck/src/__tests__/action-dispatch.test.ts` returns 0

---

#### Step 2: Rename Category 1/2/3 to styles/code/app in dev.rs comments {#step-2}

**Depends on:** #step-1

**Commit:** `docs(tugcast): rename Category 1/2/3 to styles/code/app in dev.rs comments`

**References:** [D05] Rename categories, (#context, #strategy)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- all "Category 1/2/3" comment references replaced with "styles/code/app"

**Tasks:**
- [ ] Replace "Category 1" references in comments with "styles" (CSS/HTML live reload context)
- [ ] Replace "Category 2" references in comments with "code" (compiled frontend + backend context)
- [ ] Replace "Category 3" references in comments with "app" (Mac app Swift sources context)
- [ ] Update the `DevChangeTracker` doc comment to use styles/code/app naming
- [ ] Update `clear_restart` doc comment to reference styles/code instead of Category 1+2
- [ ] Update the `warn!` log string at line ~797 from "skipping Category 3 watcher" to "skipping app watcher" (this is a runtime log string, not just a comment)

**Tests:**
- [ ] Verify by grep that zero occurrences of "Category 1", "Category 2", or "Category 3" remain in `dev.rs` (covers both comments and log strings)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `grep -c "Category [123]" tugcode/crates/tugcast/src/dev.rs` returns 0

---

#### Step 3: Add timestamp to dev_notification protocol {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugcast): add timestamp field to dev_notification payloads`

**References:** [D02] Use serde_json for all payloads, [D03] Timestamp is millis since epoch, Spec S01, (#notification-protocol)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- `send_dev_notification` function updated

**Tasks:**
- [ ] Add `use std::time::{SystemTime, UNIX_EPOCH};` import (if not already present in scope)
- [ ] In `send_dev_notification`, compute `timestamp` as `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64`
- [ ] Convert the `reloaded` branch from `br#"..."#.to_vec()` to `serde_json::json!` with `action`, `type`, and `timestamp` fields
- [ ] Add `"timestamp": timestamp` to the existing `serde_json::json!` block for `restart_available`/`relaunch_available` payloads
- [ ] Verify the timestamp variable is computed once before the `if`/`else` branches so all payload types use the same pattern
- [ ] Update `test_send_dev_notification_reloaded` to assert `json.get("timestamp").is_some()` and that the value is a positive `u64`
- [ ] Update `test_send_dev_notification_restart_available` to assert `json.get("timestamp").is_some()` and that the value is a positive `u64`
- [ ] Update `test_send_dev_notification_relaunch_available` to assert `json.get("timestamp").is_some()` and that the value is a positive `u64`

**Tests:**
- [ ] `cargo nextest run` passes for tugcast crate with updated assertions
- [ ] All three `test_send_dev_notification_*` tests explicitly verify the `timestamp` field is present and is a positive integer

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

---

#### Step 4: Implement timestamped row labels in Developer card {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): add timestamp tracking and display to Developer card`

**References:** [D04] Per-row timestamps, [D06] Mock toLocaleTimeString in tests, Spec S02, Spec S03, (#display-states, #timestamp-state-machine, #symbols)

> This step is large, so it is split into substeps. See Steps 4.1 and 4.2 for individual commits, tasks, tests, and checkpoints.

**Tasks:**
- [ ] Complete Step 4.1 (timestamp state tracking)
- [ ] Complete Step 4.2 (timestamp display and test updates)

**Tests:**
- [ ] All developer-card tests pass with timestamped output
- [ ] All action-dispatch tests remain passing

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (full TypeScript test suite)

##### Step 4.1: Add timestamp state tracking to DeveloperCard {#step-4-1}

**Commit:** `feat(tugdeck): add timestamp state tracking to DeveloperCard`

**References:** [D04] Per-row timestamps, Spec S02, Spec S03, (#display-states, #timestamp-state-machine, #symbols)

**Artifacts:**
- Modified `tugdeck/src/cards/developer-card.ts` -- new private fields and `formatTime` helper

**Tasks:**
- [ ] Add private fields: `stylesLastCleanTs: number | null = null`, `codeLastCleanTs: number | null = null`, `codeFirstDirtySinceTs: number | null = null`, `appLastCleanTs: number | null = null`, `appFirstDirtySinceTs: number | null = null`
- [ ] Add private method `formatTime(ts: number): string` that returns `new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`
- [ ] Add private method `cleanLabel(ts: number | null): string` that returns `ts ? "Clean -- " + this.formatTime(ts) : "Clean"`
- [ ] Add private method `dirtyLabel(count: number, sinceTs: number | null): string` that returns `(count === 1 ? "1 change" : "${count} changes") + (sinceTs ? " -- since " + this.formatTime(sinceTs) : "")`
- [ ] Null all new timestamp fields in `destroy()`

**Tests:**
- [ ] Existing developer-card tests still pass (no behavior change yet)

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/cards/developer-card.test.ts` passes

---

##### Step 4.2: Update update() to use timestamps in row labels {#step-4-2}

**Depends on:** #step-4-1

**Commit:** `feat(tugdeck): display timestamps in Developer card row labels`

**References:** [D04] Per-row timestamps, [D06] Mock toLocaleTimeString in tests, Spec S02, Spec S03, (#display-states, #timestamp-state-machine)

**Artifacts:**
- Modified `tugdeck/src/cards/developer-card.ts` -- `update()`, `handleRestart()`, `handleRelaunch()` updated to use timestamp labels
- Modified `tugdeck/src/cards/developer-card.test.ts` -- tests updated for timestamped output

**Tasks:**
- [ ] In `update()` for `reloaded` type: extract `payload.timestamp as number | undefined`; store in `stylesLastCleanTs` when timer fires (after 2-second flash); use `cleanLabel(this.stylesLastCleanTs)` for the post-flash text
- [ ] In `update()` for `restart_available` type: extract timestamp; if `codeFirstDirtySinceTs` is null, set it from payload timestamp; use `dirtyLabel(count, this.codeFirstDirtySinceTs)` for status text
- [ ] In `update()` for `relaunch_available` type: extract timestamp; if `appFirstDirtySinceTs` is null, set it from payload timestamp; use `dirtyLabel(count, this.appFirstDirtySinceTs)` for status text
- [ ] In `handleRestart()`: set `codeLastCleanTs = Date.now()`; clear `codeFirstDirtySinceTs = null`; use `cleanLabel(this.codeLastCleanTs)` for status text
- [ ] In `handleRelaunch()`: set `appLastCleanTs = Date.now()`; clear `appFirstDirtySinceTs = null`; use `cleanLabel(this.appLastCleanTs)` for status text
- [ ] In `developer-card.test.ts`: add `beforeEach` that mocks `Date.prototype.toLocaleTimeString` to return `"9:42 AM"` and `afterEach` that restores original
- [ ] Update test assertions: initial mount still expects `"Clean"`; after reloaded+timer expects `"Clean -- 9:42 AM"`; dirty state expects `"N change(s) -- since 9:42 AM"`; after restart/relaunch expects `"Clean -- 9:42 AM"`
- [ ] Add test: second dirty notification preserves original "since" timestamp (does not overwrite `firstDirtySinceTs`)
- [ ] Add test: restart click resets `firstDirtySinceTs`, next dirty notification starts fresh "since" clock

**Tests:**
- [ ] All existing developer-card tests updated and passing
- [ ] New timestamp-specific tests passing
- [ ] Action-dispatch tests still passing

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/cards/developer-card.test.ts` passes
- [ ] `cd tugdeck && bun test src/__tests__/action-dispatch.test.ts` passes
- [ ] `cd tugdeck && bun test` passes (full test suite)

---

#### Step 4 Summary {#step-4-summary}

**Depends on:** #step-4-2

**References:** [D04] Per-row timestamps, Spec S02, Spec S03, (#display-states, #timestamp-state-machine)

**Commit:** `chore(tugdeck): verify Step 4 aggregate checkpoint`

After completing Steps 4.1--4.2, you will have:
- Per-row timestamp state tracking in `DeveloperCard` (five nullable timestamp fields)
- Helper methods for formatting time and composing clean/dirty labels
- Updated `update()` method that stores timestamps from notification payloads and displays them in row labels
- Updated `handleRestart()`/`handleRelaunch()` that reset "since" timestamps on clean transition
- Comprehensive tests with deterministic time formatting via mocked `toLocaleTimeString`

**Tasks:**
- [ ] Verify all substep checkpoints passed

**Tests:**
- [ ] Full TypeScript test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (all TypeScript tests)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully functional dev notification system with correct routing, timestamped protocol payloads, human-readable category names, and informative Developer card row labels showing temporal context.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cardState.tabs` used everywhere in `action-dispatch.ts` (zero occurrences of `tabItems`)
- [ ] All `action-dispatch.test.ts` mocks use `tabs` field
- [ ] All `dev_notification` payloads include `timestamp` field
- [ ] `reloaded` payload uses `serde_json::json!` (no raw byte literal)
- [ ] Zero occurrences of "Category 1/2/3" in `dev.rs`
- [ ] Developer card rows show timestamped labels per Spec S02
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `cd tugdeck && bun test` passes (all TypeScript tests)

**Acceptance tests:**
- [ ] Open Developer card, trigger a `reloaded` notification, verify "Reloaded" flash then "Clean -- {time}" label
- [ ] Trigger `restart_available` notification, verify "1 change -- since {time}" label with Restart button visible
- [ ] Click Restart, verify row returns to "Clean -- {time}" with fresh timestamp
- [ ] Trigger second dirty notification after restart, verify "since" time is the new notification's time (not the old one)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add "Watching build outputs" tooltip or subtitle to Code/App rows for clarity
- [ ] Consider notification staleness detection (highlight if no notification received in N minutes)
- [ ] Persist notification timestamps across card close/reopen

| Checkpoint | Verification |
|------------|--------------|
| Routing fix | `grep -c tabItems tugdeck/src/action-dispatch.ts` returns 0 |
| Category rename | `grep -c "Category [123]" tugcode/crates/tugcast/src/dev.rs` returns 0 |
| Timestamp protocol | `cargo build` succeeds; JSON payloads include `timestamp` |
| Timestamped labels | `bun test src/cards/developer-card.test.ts` passes |
| Full suite | `cargo nextest run` and `bun test` both pass |
