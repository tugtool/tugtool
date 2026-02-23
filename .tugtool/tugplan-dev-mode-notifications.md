## Phase 7.0: Dev Mode Notifications {#phase-dev-notifications}

**Purpose:** Replace the auto-restart file watcher mechanism with a notification-driven developer card that tracks file changes across three categories (styles, compiled code, app code) and lets the developer decide when to restart, relaunch, or reset -- eliminating jarring mid-interaction restarts and cascading restart failures.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-mode-notifications |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current dev mode file watcher in `tugcast/src/dev.rs` auto-restarts the process when the tugcast binary changes (exit code 44), and auto-reloads the frontend when `dist/app.js` changes. This causes problems: restarts happen mid-interaction, dropping WebSocket connections and resetting terminal state. Cascading restarts (binary change triggers shutdown triggers re-spawn triggers dev_mode triggers watchers) are fragile. There is no way for the developer to defer a restart until they finish what they are doing.

The fix: keep instant automatic reload for CSS and non-compiled markup (Category 1 -- it works, it is safe, it is fast). For compiled frontend and backend changes (Category 2) and Mac app source changes (Category 3), track changes with file watchers but only notify the developer via a new Developer card, letting them decide when to apply the change. This gives the developer agency over when disruption happens.

#### Strategy {#strategy}

- Remove the auto-restart mechanism (`spawn_binary_watcher`, exit code 44, `binary_updated` handling) first to simplify the codebase before adding new behavior
- Split the file watcher into three categories with distinct behaviors: reload (automatic), restart-available (notification), relaunch-available (notification)
- Add a `DevChangeTracker` struct to accumulate dirty flags and change counts between user-triggered operations
- Build a new Developer card in tugdeck that displays change state and provides Restart/Relaunch/Reset buttons
- Wire frontend operation buttons back through the Control feed to trigger exit codes (42, 45, 43)
- Build `tugrelaunch` as a separate binary crate that handles the full build-replace-relaunch cycle for Mac app code
- Use a single watcher for Category 2 (compiled frontend + backend) as the user confirmed

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using `just dev` or `just dev-watch` (CLI path)
2. Developers using the Mac app with dev mode enabled (app path)

#### Success Criteria (Measurable) {#success-criteria}

- CSS changes still reload automatically within 200ms (verify with manual test: edit tokens.css, observe browser reload)
- Compiled code changes (dist/app.js, tugcast binary) do NOT trigger automatic restart -- only a notification appears in the Developer card (verify: `cargo build -p tugcast`, confirm no restart, confirm card shows "1 change")
- App source changes (tugapp/Sources/*.swift) appear in the Developer card as relaunch-available (verify: touch a .swift file, confirm card shows change count)
- Clicking Restart in the Developer card causes tugcast to restart and pick up new binaries (verify: build new tugcast, click Restart, confirm new code is running)
- Clicking Relaunch in the Developer card triggers tugrelaunch, which builds everything, replaces the app, and relaunches (verify: modify app source, click Relaunch, confirm new app launches)
- All existing tests pass: `just test` succeeds with no regressions

#### Scope {#scope}

1. Remove `spawn_binary_watcher()` and exit code 44 / `binary_updated` handling from tugcast, tugtool, and ProcessManager
2. Add `DevChangeTracker` and categorized notification-only watchers in tugcast dev.rs
3. Add `dev_notification` Control frame action for change notifications
4. Build Developer card in tugdeck with indicator rows and operation buttons
5. Wire restart/relaunch/reset actions from frontend through Control feed to tugcast exit codes
6. Add Category 3 watcher for `tugapp/Sources/**/*.swift`
7. Build `tugrelaunch` binary crate for Mac app relaunch cycle
8. Update ProcessManager.swift to handle `relaunch` shutdown reason
9. Update Justfile to build and copy `tugrelaunch`

#### Non-goals (Explicitly out of scope) {#non-goals}

- HMR (Hot Module Replacement) -- all reloads remain full page reloads via `location.reload()`
- Automatic restart/relaunch -- the entire point is to make these user-triggered
- Build integration in tugcast -- tugcast does not run `cargo build`, `bun build`, or `xcodebuild`; it only watches for results or spawns `tugrelaunch`
- Cross-platform relaunch -- Mac-only for the relaunch path; the restart path works anywhere
- Code signing -- Tug.app is unsigned during development

#### Dependencies / Prerequisites {#dependencies}

- Existing dev mode infrastructure (control socket, `SharedDevState`, `dev_mode` protocol) is complete and working
- The `notify` crate is already a workspace dependency
- Exit codes 42 (restart) and 43 (reset) already work end-to-end

#### Constraints {#constraints}

- macOS-only for Category 3 watcher and tugrelaunch (xcodebuild, kqueue, app bundles)
- Warnings are errors (`-D warnings` in cargo config) -- all new Rust code must be warning-free
- Frontend uses bun for builds and tests -- no npm/webpack
- ProcessManager.swift uses Foundation and spawns processes via `Process` -- no SwiftUI or Combine

#### Assumptions {#assumptions}

- `DevChangeTracker` will have per-category dirty flags (`frontend_dirty`, `backend_dirty`, `app_dirty`), a single combined `code_count` for Category 2, and a separate `app_count` for Category 3
- The `dev_notification` frame will be sent over the Control feed (`FeedId::Control`)
- The Developer card will be closable and collapsible like other cards
- The notification-only watchers will reuse the existing `notify` crate infrastructure with modified handlers
- Exit codes: 42 for restart, 43 for reset, 45 for relaunch (44 removed)
- The `tugrelaunch` binary will be built as part of the workspace and copied into the app bundle during `just app`
- Category 1 (styles) watcher requires one change: remove `.js` from `has_reload_extension()` so `dist/app.js` changes are NOT treated as Category 1 reloads but instead as Category 2 notifications. After this change, Category 1 matches `.html`, `.css` only. A `dev_notification` send is also added.
- The progress socket path will follow the pattern `/tmp/tugrelaunch-{pid}.sock` where pid is tugcast's PID
- A single watcher monitors both `dist/app.js` and the tugcast binary for Category 2
- Change counts are a single total across all Category 2 subcategories (e.g., "3 changes" not "2 frontend, 1 backend")
- tugcast spawns tugrelaunch asynchronously, relays progress, then shuts down when tugrelaunch signals quit

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] bun build --watch management strategy (RESOLVED) {#q01-bun-watch-management}

**Question:** Should `bun build --watch` be managed by tugtool/ProcessManager as a subprocess (current approach), or should its lifecycle be restructured? Both tugtool and ProcessManager currently spawn bun as a long-lived child process that persists across tugcast restarts.

**Why it matters:** If bun-watch is unreliable as a subprocess, compiled frontend changes may not appear, making the Category 2 watcher useless. If it is restructured mid-plan, multiple steps would need rework.

**Options (if known):**
- Keep current approach: tugtool spawns `bun build --watch` on first run, ProcessManager spawns it on app start. Both persist across tugcast restarts. This is proven to work.
- Move bun management into tugcast itself, so it restarts with tugcast. Simpler lifecycle but couples bun to tugcast.
- Leave it entirely external (developer runs bun separately). Simplest but worst DX.

**Plan to resolve:** Investigate during Step 0 (spike). Test reliability of current approach under restart cycles. Recommend in Step 0 checkpoint.

**Resolution:** RESOLVED — Keep current approach. tugtool (CLI path) and ProcessManager (app path) manage bun build --watch as a long-lived subprocess that persists across tugcast restarts. This approach is proven reliable and works correctly with the Category 2 compiled code watcher (dev_compiled_watcher). No restructuring needed.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| FSEvents misses Category 2 changes on macOS | high | low | Use mtime polling fallback for binary watcher (proven in current code) | If notify events are dropped in testing |
| tugrelaunch builds fail partway, leaving partial state | med | med | tugrelaunch writes no files until all builds succeed; on failure, old app stays running | If copy phase is reached despite build failure |
| kqueue EVFILT_PROC not available on all macOS versions | low | low | Fallback to polling with 100ms interval | If kqueue returns ENOTSUP |

**Risk R01: Watcher race on rapid file changes** {#r01-watcher-race}

- **Risk:** Rapid successive file changes (e.g., cargo build writing multiple files) could produce a storm of notifications
- **Mitigation:** Reuse the existing quiet-period debounce pattern from `dev_file_watcher` (100ms silence window); extend to Category 2 and 3 watchers
- **Residual risk:** A very slow build (e.g., xcodebuild writing files over 30+ seconds) might trigger multiple notifications, but since they are display-only (no action taken), this is harmless

**Risk R02: Progress socket connection failure** {#r02-progress-socket}

- **Risk:** tugcast fails to connect to tugrelaunch progress socket, leaving the Developer card without build progress
- **Mitigation:** tugrelaunch works independently of whether anyone is listening; progress socket is nice-to-have. Developer card shows "Building..." without detailed stage info if connection fails.
- **Residual risk:** Developer sees less detailed build progress but the build still completes correctly

---

### 7.0.0 Design Decisions {#design-decisions}

#### [D01] Remove auto-restart entirely, replace with notification-only watchers (DECIDED) {#d01-notification-only}

**Decision:** The binary mtime watcher (`spawn_binary_watcher`) and exit code 44 (`binary_updated`) are removed. All compiled-code watchers become notification-only: they set dirty flags and send `dev_notification` frames but never trigger shutdown or reload.

**Rationale:**
- Auto-restart is the root cause of jarring mid-interaction disruptions
- Cascading restart chains (binary change -> shutdown -> re-spawn -> dev_mode -> watchers) are fragile and hard to debug
- Notification-only watchers are strictly simpler: fewer code paths, fewer failure modes

**Implications:**
- `spawn_binary_watcher()` function is deleted from `dev.rs`
- `_binary_watcher` field removed from `DevRuntime`
- Exit code 44 mapping removed from `main.rs`
- `binary_updated` handling removed from `tugtool/src/main.rs` and `ProcessManager.swift`
- `copyBinaryFromSourceTree()` in ProcessManager stays but is **moved** from the `binary_updated` handler to the `restart` handler. This is an intentional behavior change: currently only the `binary_updated` case calls `copyBinaryFromSourceTree()`; after this change, every user-triggered restart (exit code 42) copies the binary from the source tree into the app bundle before respawning. This is required because the auto-copy mechanism (exit code 44) is being removed, and the user-triggered restart must now handle binary copying.

#### [D02] Three watcher categories with distinct behaviors (DECIDED) {#d02-watcher-categories}

**Decision:** File watchers are organized into three categories: Category 1 (styles -- automatic reload), Category 2 (compiled frontend + backend -- notification only), Category 3 (app source -- notification only). Each category has a distinct response to file changes.

**Rationale:**
- Style changes are safe to reload automatically (no compilation, no process restart)
- Compiled code changes require a process restart -- this must be user-triggered
- App source changes require a full build-replace-relaunch cycle -- even more disruptive, must be user-triggered

**Implications:**
- The existing `dev_file_watcher` continues to handle Category 1 (sends `reload_frontend` as today, plus a `dev_notification`), but the `has_reload_extension()` filter MUST be changed: remove `.js` so that `dist/app.js` changes are NOT treated as Category 1 reloads. After the change, `has_reload_extension()` matches `.html` and `.css` only. Without this fix, `dist/app.js` changes would trigger automatic reload via Category 1 AND notification via Category 2, defeating the notification-only design for compiled code.
- A single new watcher handles Category 2 (watches `dist/app.js` and tugcast binary path)
- A new watcher handles Category 3 (watches `tugapp/Sources/**/*.swift`)
- Category 2 uses a single total change count across frontend and backend

#### [D03] DevChangeTracker struct for state accumulation (DECIDED) {#d03-change-tracker}

**Decision:** A new `DevChangeTracker` struct in `dev.rs` holds per-category dirty flags and a single combined change count for Category 2. Internally, `mark_frontend()` and `mark_backend()` each increment a shared `code_count: u32` counter (not separate per-subcategory counters). A separate `app_count: u32` tracks Category 3. The `changes` array in the notification payload records which subcategories are dirty (e.g., `["frontend", "backend"]`), while `count` is the single total for display (e.g., "3 changes"). Flags accumulate between user-triggered operations and clear on restart (Categories 1-2) or relaunch (all categories).

**Rationale:**
- The developer needs to see how many changes have accumulated since the last restart/relaunch
- Separate dirty flags per category allow the Developer card to show which rows need attention
- A single combined count for Category 2 (not "2 frontend, 1 backend") keeps the UI simple as the user requested
- The `changes` array still tracks which subcategories are dirty so the card can show "frontend, backend" text if desired

**Implications:**
- `DevChangeTracker` is `Arc<Mutex<...>>` shared between watcher tasks and the notification sender
- Fields: `frontend_dirty: bool`, `backend_dirty: bool`, `app_dirty: bool`, `code_count: u32`, `app_count: u32`
- `mark_frontend()` sets `frontend_dirty = true` and increments `code_count`
- `mark_backend()` sets `backend_dirty = true` and increments `code_count`
- `snapshot()` returns dirty flags, `code_count`, `app_count`, and a `changes` vec built from the dirty flags
- On restart (exit code 42), frontend and backend dirty flags and `code_count` clear
- On relaunch, all flags and counts clear (fresh process)
- The tracker is part of `DevRuntime` and dropped on `disable_dev_mode`

#### [D04] dev_notification Control frame action (DECIDED) {#d04-notification-protocol}

**Decision:** A new `dev_notification` action is sent over the Control feed (`FeedId::Control`) to communicate change state to the frontend. Three types: `reloaded` (Category 1), `restart_available` (Category 2), `relaunch_available` (Category 3). The `changes` array accumulates between operations.

**Rationale:**
- Reuses the existing Control frame infrastructure -- no new feed IDs needed
- The frontend already parses Control frames via `action-dispatch.ts`
- Separating notification types lets the Developer card update specific rows

**Implications:**
- Notification JSON: `{"action": "dev_notification", "type": "reloaded"|"restart_available"|"relaunch_available", "changes": [...], "count": N}`
- Category 1 notifications include `type: "reloaded"` with no changes array (it is always "Clean" after reload)
- Note: tugrelaunch build progress uses a SEPARATE action `dev_build_progress` (see [D11] and Spec S05), NOT `dev_notification`
- **Important routing constraint:** `FeedId.CONTROL` is NOT in `DeckManager`'s `OUTPUT_FEED_IDS` array, so `DeckManager` does NOT register a `connection.onFrame` callback for it, and cards declaring `feedIds: [FeedId.CONTROL]` will never have their `onFrame()` called by the fan-out system. Control frames are exclusively handled by `action-dispatch.ts` via its own `connection.onFrame(FeedId.CONTROL, ...)` callback. Therefore, the Developer card must receive `dev_notification` data through a registered action handler in `action-dispatch.ts`, NOT through card fan-out. See [D09] for the routing design.

#### [D05] Exit code 45 for relaunch (DECIDED) {#d05-exit-code-relaunch}

**Decision:** Exit code 45 maps to shutdown reason `relaunch`. This is used when the user triggers a relaunch from the Developer card. Exit code 44 (previously `binary_updated`) is removed.

**Rationale:**
- Exit codes 42 (restart) and 43 (reset) already exist and work
- Adding 45 for relaunch follows the same pattern
- Removing 44 eliminates the auto-restart mechanism cleanly

**Implications:**
- `actions.rs` does NOT gain a `relaunch` arm -- the relaunch action is handled exclusively in `control.rs` per [D10]
- `main.rs` shutdown message maps 45 to `"relaunch"` reason
- ProcessManager.swift handles `"relaunch"` shutdown reason (does NOT restart; tugrelaunch handles it)
- tugtool supervisor treats `"relaunch"` as do-not-restart (relaunch is Mac-app-only)

#### [D06] tugrelaunch as a separate workspace binary (DECIDED) {#d06-tugrelaunch-binary}

**Decision:** `tugrelaunch` is a new Rust binary crate in `tugcode/crates/tugrelaunch/`. It orchestrates the build-replace-relaunch cycle for Mac app development. It runs independently of tugcast and communicates progress via a Unix domain socket.

**Rationale:**
- A process cannot replace its own binary and relaunch itself -- something must outlive the app
- This is the standard macOS pattern (Sparkle uses `Autoupdate`, Squirrel.Mac uses `ShipIt`)
- Building as a workspace crate keeps it in the same build system with shared dependencies

**Implications:**
- New crate at `tugcode/crates/tugrelaunch/` with `Cargo.toml` and `src/main.rs`
- Added to workspace members in root `tugcode/Cargo.toml`
- Built by `just build` and copied into app bundle by `just app`
- Depends on `serde_json` for progress protocol, `libc` for kqueue/process management
- CLI: `tugrelaunch --source-tree <path> --app-bundle <path> --progress-socket <path>`

#### [D07] Developer card implements TugCard with TugConnection constructor (DECIDED) {#d07-developer-card}

**Decision:** A new `developer-card.ts` in `tugdeck/src/cards/` implements the `TugCard` interface. It accepts `TugConnection` as a constructor parameter (following the `SettingsCard` pattern) to send control frames back to tugcast. It declares `feedIds: []` (empty) because `FeedId.CONTROL` is not in `DeckManager`'s `OUTPUT_FEED_IDS` and would silently receive nothing via fan-out. Instead, the card exposes an `update(payload)` method that is called by a registered `dev_notification` action handler in `action-dispatch.ts` (see [D09]).

**Rationale:**
- Follows the established card pattern for cards needing connection access (`SettingsCard` takes `TugConnection` in its constructor, `ConversationCard` and `TerminalCard` do the same)
- `FeedId.CONTROL` is excluded from `OUTPUT_FEED_IDS` in `deck-manager.ts` (lines 37-46), so `DeckManager` never registers a `connection.onFrame` callback for it -- declaring it in `feedIds` would be silently broken
- The card sends operations via `controlFrame()` from `protocol.ts` and `connection.send()`
- Receiving data via an action handler registered in `action-dispatch.ts` follows the existing Control frame architecture

**Implications:**
- Constructor: `new DeveloperCard(connection: TugConnection)`
- `feedIds` is `[]` (empty array) -- the card does NOT receive data through DeckManager fan-out
- The card exposes `update(payload: Record<string, unknown>): void` for the action handler to call
- Card is registered as `"developer"` in `main.ts` with import and factory: `deck.registerCardFactory("developer", () => new DeveloperCard(connection))`
- `"developer"` entry added to `titleForComponent` map in `deck-manager.ts`
- A Developer icon button is added to the dock rail in `dock.ts` (see [D12]) so the card can be opened from the dock and can display a badge
- Card is closable and collapsible (standard card behavior)
- When running in CLI mode (no WebKit bridge), the App row and Relaunch button are hidden
- The Styles row briefly shows "Reloaded" on CSS reload, then returns to "Clean" after ~2 seconds

#### [D09] Route dev_notification through action-dispatch.ts to Developer card (DECIDED) {#d09-notification-routing}

**Decision:** Register a `dev_notification` action handler in `action-dispatch.ts` that routes the parsed payload to the Developer card's `update()` method. This bridges the gap between Control frame dispatch (which uses `action-dispatch.ts`) and the card instance (which lives in `DeckManager`). The handler is registered during `initActionDispatch()` and holds a reference to the `DeckManager` to find the active Developer card instance.

**Rationale:**
- `action-dispatch.ts` already owns the `connection.onFrame(FeedId.CONTROL, ...)` callback -- all Control frame actions must be registered there or they produce `console.warn("unknown action")` spam
- `DeckManager` does not fan out Control frames to cards (CONTROL is not in `OUTPUT_FEED_IDS`)
- The action handler pattern is consistent with existing handlers (`show-card`, `reload_frontend`, `reset`, `set-dev-mode`)

**Implications:**
- In `initActionDispatch()`, register: `registerAction("dev_notification", (payload) => { ... })`
- The handler finds the active `DeveloperCard` via `DeckManager` (e.g., by looking up cards by component ID) and calls `card.update(payload)`
- If no Developer card is open, the handler sets a dock badge on the Developer dock button (per D12) so the user knows changes are pending
- This eliminates the `console.warn("unknown action: dev_notification")` that would otherwise spam on every file change
- `DeckManager` needs a method to expose the active card instance by component ID (or the handler captures a reference at registration time)

#### [D10] Relaunch orchestration lives in control.rs, not actions.rs (DECIDED) {#d10-relaunch-orchestration}

**Decision:** The relaunch orchestration (spawning tugrelaunch, connecting to its progress socket, relaying progress, sending exit code 45) is implemented in `control.rs` as part of a new `ControlMessage::Relaunch` variant, NOT in `dispatch_action()` in `actions.rs`.

**Rationale:**
- `dispatch_action()` in `actions.rs` has a limited API: `(action, raw_payload, shutdown_tx, client_action_tx)`. It does NOT have access to `shared_dev_state` or `source_tree`.
- Relaunch orchestration requires `source_tree` (to pass as `--source-tree` to tugrelaunch) which is stored in `shared_dev_state`, accessible only in `control.rs`'s `run_recv_loop`.
- The `relaunch` action from the frontend is a Control frame, parsed in `control.rs`. The `Tell` handler currently delegates to `dispatch_action`, but for `relaunch` the Tell handler can intercept it before delegation -- or a new `ControlMessage` variant can handle it directly.
- `control.rs` already has access to `shutdown_tx`, `client_action_tx`, `shared_dev_state`, and `response_tx` -- all needed for relaunch.

**Implications:**
- The `relaunch` action from the frontend arrives as a `Tell { action: "relaunch", ... }` Control frame
- In `run_recv_loop`, the `Tell` handler checks for `action == "relaunch"` BEFORE delegating to `dispatch_action()`. When matched, it runs the relaunch orchestration inline (or calls a helper function) using the locally available `shared_dev_state` to get `source_tree`
- `dispatch_action()` in `actions.rs` does NOT gain a `relaunch` arm -- it never sees the relaunch action
- The relaunch action is exclusively a Mac-app-only operation triggered from the Developer card via the Control feed. It always arrives via the control socket (parsed in `control.rs`), never via HTTP tell or other ingress paths. There is no need for a fallback in `actions.rs`.

#### [D11] Separate dev_build_progress action for tugrelaunch progress (DECIDED) {#d11-build-progress-action}

**Decision:** Tugrelaunch build progress is relayed to the frontend using a separate `dev_build_progress` action, NOT reusing the `dev_notification` action. The two actions have different shapes: `dev_notification` carries change tracking state (type, changes array, count), while `dev_build_progress` carries build stage info (stage, status, error).

**Rationale:**
- `dev_notification` and tugrelaunch progress have fundamentally different payloads -- mixing them in one action type leads to awkward conditionals and optional fields
- The Developer card needs to display build progress differently from change notifications (progress bar vs. change count)
- Separate actions make action-dispatch routing cleaner -- each handler does one thing

**Implications:**
- New action: `{"action": "dev_build_progress", "stage": "cargo"|"bun"|"xcode"|"relaunch", "status": "building"|"done"|"failed"|"quitting", "error": "..."}`
- `dev_build_progress` handler registered in `action-dispatch.ts` alongside `dev_notification`
- The Developer card's `update()` method handles both action types, distinguishing by a `action` field or by having two separate entry points (`updateNotification()`, `updateBuildProgress()`)
- `control.rs` relaunch orchestration sends `dev_build_progress` frames (not `dev_notification`) when relaying tugrelaunch socket messages
- See Spec S05 for the frame format

#### [D12] Developer dock button with badge indicator for dirty state (DECIDED) {#d12-dock-badge}

**Decision:** A Developer button is added to the dock (the 48px vertical rail in `dock.ts`), alongside the existing code, terminal, git, files, and stats buttons. When the Developer card has dirty state (any category shows pending changes) but the card is closed, a small badge indicator appears on the Developer dock button. This ensures the developer is aware of pending changes even when the card is not visible.

**Rationale:**
- The dock currently has no Developer button -- without one, there is no way to open the Developer card from the dock, and no place to show a badge
- If the Developer card is closed and notifications arrive, the developer has no visual indication that changes are waiting
- A dock badge follows the pattern used by macOS app dock badges and browser tab notifications
- The badge clears when the card is reopened or when the developer triggers the relevant operation

**Implications:**
- In `dock.ts`: add a new icon button for "developer" using a lucide icon (e.g., `Wrench` or `Code2`), placed after the existing `stats` button and before the spacer. Uses the same `addIconButton()` pattern as the other dock buttons.
- `Dock` or `DeckManager` exposes a `setBadge(componentId: string, count: number)` method (or similar) to show/clear the badge on a dock button
- The `dev_notification` action handler in `action-dispatch.ts` checks whether the Developer card is currently open. If NOT open AND the notification carries dirty state (type `restart_available` or `relaunch_available`), it calls `setBadge("developer", count)` to show a badge on the dock button
- When the Developer card is opened (mounted), it clears its own badge
- When a restart/relaunch clears the dirty state, the badge clears
- The badge is a small count overlay on the dock button (CSS absolute-positioned element)

#### [D13] Tug.app PID acquisition via getppid() (DECIDED) {#d13-pid-acquisition}

**Decision:** tugcast obtains the Tug.app PID via `std::os::unix::process::parent_id()` (Rust's safe wrapper for `getppid()`). This PID is passed to tugrelaunch as the `--pid` argument.

**Rationale:**
- ProcessManager.swift spawns tugcast directly via `Process()` -- tugcast's parent IS the Tug.app process. This is a stable, guaranteed relationship that holds as long as the process hierarchy is direct (which it is by design).
- `getppid()` is a single syscall, zero IPC, zero coordination. No protocol changes needed.
- The `--pid` CLI flag on tugrelaunch serves as an explicit parameter regardless of how the PID was obtained, making the interface clean and testable.
- Relaunch is Mac-app-only. In the CLI path (tugtool), relaunch does not apply, so the getppid() value is irrelevant there.

**Implications:**
- In `control.rs` relaunch orchestration: call `std::os::unix::process::parent_id()` to get the Tug.app PID at spawn time
- Pass as `--pid <pid>` to tugrelaunch
- No IPC protocol changes needed -- no handshake PID, no dev_mode_result PID field
- tugrelaunch validates the `--pid` is a running process before proceeding (error if PID does not exist)

#### [D08] Async tugrelaunch spawn with progress relay (DECIDED) {#d08-async-relaunch}

**Decision:** When the user clicks Relaunch, tugcast spawns `tugrelaunch` as a child process asynchronously, connects to its progress socket, relays progress to the Developer card via `dev_build_progress` frames (see [D11]), and then shuts down with exit code 45 when tugrelaunch signals the quit phase.

**Rationale:**
- Async spawn allows tugcast to relay progress to the frontend while tugrelaunch builds
- The user sees build stages (cargo, bun, xcode) in the Developer card
- On build failure, tugrelaunch exits and the old app stays running -- no disruption

**Implications:**
- tugcast spawns tugrelaunch before sending exit code 45
- tugcast reads progress from the UDS and forwards as `dev_build_progress` frames (see [D11] and Spec S05) with build stage info
- On build failure, tugcast stays running and the Developer card shows the error
- On build success, tugrelaunch sends a "quitting" message; tugcast sends exit code 45 to shut down
- tugrelaunch then waits for the old app to exit, copies binaries, and relaunches

---

### 7.0.1 Specification {#specification}

#### 7.0.1.1 Watcher Categories {#watcher-categories}

**Table T01: Watcher Category Definitions** {#t01-watcher-categories}

| Category | Label | Watches | On Change | Extensions/Paths |
|----------|-------|---------|-----------|------------------|
| 1 | Styles | assets.toml files and dirs entries | `reload_frontend` + `dev_notification` type `reloaded` | `.css`, `.html` (NOT `.js` -- see D02) |
| 2 | Code | `tugdeck/dist/app.js`, `tugcode/target/debug/tugcast` | Set dirty flag, `dev_notification` type `restart_available` | Exact paths only |
| 3 | App | `tugapp/Sources/**/*.swift` | Set dirty flag, `dev_notification` type `relaunch_available` | `.swift` |

#### 7.0.1.2 Notification Protocol {#notification-protocol}

**Spec S01: dev_notification Frame Format** {#s01-notification-format}

```json
{"action": "dev_notification", "type": "reloaded"}
{"action": "dev_notification", "type": "restart_available", "changes": ["frontend", "backend"], "count": 3}
{"action": "dev_notification", "type": "relaunch_available", "changes": ["app"], "count": 1}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | Always `"dev_notification"` |
| `type` | string | yes | One of: `"reloaded"`, `"restart_available"`, `"relaunch_available"` |
| `changes` | string[] | no | Which subcategories changed. Present for `restart_available` and `relaunch_available`. Values: `"frontend"`, `"backend"`, `"app"` |
| `count` | number | no | Total accumulated change count since last operation. Present for `restart_available` and `relaunch_available`. |

#### 7.0.1.3 Operation Triggers {#operation-triggers}

**Spec S02: Frontend-to-Backend Operation Actions** {#s02-operation-actions}

| Action | Control Frame | Exit Code | Shutdown Reason | Effect |
|--------|--------------|-----------|-----------------|--------|
| Restart | `{"action": "restart"}` | 42 | `restart` | Supervisor restarts tugcast; picks up new binaries |
| Relaunch | `{"action": "relaunch"}` | 45 | `relaunch` | tugcast spawns tugrelaunch, relays progress, then exits |
| Reset | `{"action": "reset"}` | 43 | `reset` | Frontend clears localStorage; tugcast clears state and exits |

#### 7.0.1.4 Exit Code Map {#exit-code-map}

**Table T02: Exit Code Mapping** {#t02-exit-codes}

| Code | Reason | Supervisor Action (tugtool) | Supervisor Action (ProcessManager) |
|------|--------|----------------------------|-----------------------------------|
| 0 | normal | do not restart | do not restart |
| 42 | restart | restart immediately | copy binary from source tree, restart |
| 43 | reset | restart immediately | restart immediately |
| 45 | relaunch | do not restart (Mac-app-only) | do not restart (tugrelaunch handles) |

Note: exit code 44 (`binary_updated`) is removed.

#### 7.0.1.5 Build Progress Protocol {#build-progress-protocol}

**Spec S05: dev_build_progress Frame Format** {#s05-build-progress-format}

```json
{"action": "dev_build_progress", "stage": "cargo", "status": "building"}
{"action": "dev_build_progress", "stage": "bun", "status": "done"}
{"action": "dev_build_progress", "stage": "xcode", "status": "failed", "error": "compilation error..."}
{"action": "dev_build_progress", "stage": "relaunch", "status": "quitting"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | Always `"dev_build_progress"` |
| `stage` | string | yes | Build stage: `"cargo"`, `"bun"`, `"xcode"`, `"relaunch"` |
| `status` | string | yes | `"building"`, `"done"`, `"failed"`, `"quitting"` |
| `error` | string | no | Error message, present only when `status` is `"failed"` |

This is a direct relay of the tugrelaunch progress protocol (Spec S04) wrapped in a Control frame action. The `stage` and `status` fields match Spec S04 exactly; `action` is added for routing through `action-dispatch.ts`.

#### 7.0.1.6 tugrelaunch CLI Interface {#tugrelaunch-cli}


**Spec S03: tugrelaunch Command Line** {#s03-tugrelaunch-cli}

```
tugrelaunch \
  --source-tree /path/to/tugtool \
  --app-bundle /path/to/Tug.app \
  --progress-socket /tmp/tugrelaunch-{pid}.sock \
  --pid 12345
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--source-tree` | yes | Path to the tugtool source tree root |
| `--app-bundle` | yes | Path to the Tug.app bundle |
| `--progress-socket` | yes | Path for the UDS progress listener |
| `--pid` | yes | PID of the Tug.app process to SIGTERM during the SIGNAL phase. Populated by tugcast via `std::os::unix::process::parent_id()` (getppid). ProcessManager.swift spawns tugcast directly, so tugcast's parent PID is always the Tug.app process. See [D13]. |

#### 7.0.1.7 tugrelaunch Progress Protocol {#tugrelaunch-progress}

**Spec S04: tugrelaunch Progress Messages** {#s04-progress-protocol}

Newline-delimited JSON over Unix domain socket:

```json
{"stage": "cargo", "status": "building"}
{"stage": "cargo", "status": "done"}
{"stage": "bun", "status": "building"}
{"stage": "bun", "status": "done"}
{"stage": "xcode", "status": "building"}
{"stage": "xcode", "status": "done"}
{"stage": "relaunch", "status": "quitting"}
{"stage": "cargo", "status": "failed", "error": "compilation error..."}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stage` | string | yes | Build stage: `"cargo"`, `"bun"`, `"xcode"`, `"relaunch"` |
| `status` | string | yes | `"building"`, `"done"`, `"failed"`, `"quitting"` |
| `error` | string | no | Error message, present only when `status` is `"failed"` |

#### 7.0.1.8 tugrelaunch Lifecycle Phases {#tugrelaunch-lifecycle}

**List L01: tugrelaunch Phases** {#l01-tugrelaunch-phases}

1. **BUILD** -- Run `cargo build -p tugcast -p tugtool -p tugcode`, then `bun run build` in tugdeck/, then `xcodebuild`. Old app stays running. Progress relayed via socket.
2. **SIGNAL** -- Send SIGTERM to the Tug.app process identified by `--pid`.
3. **WAIT** -- Use kqueue `EVFILT_PROC`/`NOTE_EXIT` to wait for the `--pid` process to exit. Timeout: 10 seconds, then SIGKILL.
4. **COPY** -- Copy new binaries into `Tug.app/Contents/MacOS/` using `rename()` for atomic replacement.
5. **RELAUNCH** -- Run `open -a /path/to/Tug.app`. Write status file to `/tmp/tugrelaunch-status.json`. Exit with code 0.

On failure at any build stage: write error to progress socket, exit with non-zero code, old app stays running.

---

### 7.0.2 Symbol Inventory {#symbol-inventory}

#### 7.0.2.1 New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugcode/crates/tugrelaunch` | Mac app build-replace-relaunch helper binary |

#### 7.0.2.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugrelaunch/Cargo.toml` | Crate manifest for tugrelaunch |
| `tugcode/crates/tugrelaunch/src/main.rs` | tugrelaunch entry point and lifecycle |
| `tugdeck/src/cards/developer-card.ts` | Developer notification card |
| `tugdeck/src/cards/developer-card.test.ts` | Tests for Developer card |

#### 7.0.2.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DevChangeTracker` | struct | `tugcast/src/dev.rs` | Holds per-category dirty flags, `code_count` (combined Cat 2), `app_count` (Cat 3) |
| `DevChangeTracker::mark_frontend` | fn | `tugcast/src/dev.rs` | Set `frontend_dirty`, increment `code_count` |
| `DevChangeTracker::mark_backend` | fn | `tugcast/src/dev.rs` | Set `backend_dirty`, increment `code_count` (same counter as frontend) |
| `DevChangeTracker::mark_app` | fn | `tugcast/src/dev.rs` | Set `app_dirty`, increment `app_count` |
| `DevChangeTracker::snapshot` | fn | `tugcast/src/dev.rs` | Return dirty flags, counts, and `changes` vec for notification payload |
| `dev_compiled_watcher` | fn | `tugcast/src/dev.rs` | Category 2 watcher for dist/app.js and tugcast binary |
| `dev_app_watcher` | fn | `tugcast/src/dev.rs` | Category 3 watcher for tugapp/Sources/*.swift |
| `send_dev_notification` | fn | `tugcast/src/dev.rs` | Build and send dev_notification Control frame |
| `DeveloperCard` | class | `tugdeck/src/cards/developer-card.ts` | TugCard with TugConnection constructor, `feedIds: []`, `update()` method |
| `DeveloperCard::update` | method | `tugdeck/src/cards/developer-card.ts` | Called by action-dispatch handler, updates row states from notification payload |
| `dev_notification` handler | fn | `tugdeck/src/action-dispatch.ts` | Routes dev_notification actions to DeveloperCard.update(), sets dock badge when card closed |
| `dev_build_progress` handler | fn | `tugdeck/src/action-dispatch.ts` | Routes tugrelaunch build progress to DeveloperCard.updateBuildProgress() |
| `DeveloperCard::updateBuildProgress` | method | `tugdeck/src/cards/developer-card.ts` | Called by dev_build_progress handler, displays build stage/status/error |
| `Dock.setBadge` | method | `tugdeck/src/dock.ts` | Show/clear badge overlay on a dock button by component ID |
| `has_reload_extension` | fn (MODIFY) | `tugcast/src/dev.rs` | Remove `.js` from extension check -- match `.html` and `.css` only |
| `spawn_binary_watcher` | fn (REMOVE) | `tugcast/src/dev.rs` | Deleted -- replaced by `dev_compiled_watcher` |
| `_binary_watcher` | field (REMOVE) | `tugcast/src/dev.rs` | Deleted from `DevRuntime` |

---

### 7.0.3 Documentation Plan {#documentation-plan}

- [ ] Update roadmap/dev-mode-notifications.md with implementation status
- [ ] Add inline doc comments on all new public symbols
- [ ] Update CLAUDE.md if new commands or workflows are added

---

### 7.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test DevChangeTracker state transitions, notification serialization, tugrelaunch progress parsing | Core logic in dev.rs, developer-card.ts |
| **Integration** | Test watcher -> notification -> card update flow end-to-end | Watcher categories, action dispatch |
| **Golden / Contract** | Verify dev_notification JSON format, tugrelaunch progress format | Protocol stability |

---

### 7.0.5 Execution Steps {#execution-steps}

#### Step 0: Remove auto-restart mechanism {#step-0}

**Commit:** `refactor(dev): remove auto-restart binary watcher and exit code 44`

**References:** [D01] Remove auto-restart entirely, Table T02, (#context, #strategy, #d01-notification-only)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- `spawn_binary_watcher()` deleted, `_binary_watcher` field removed from `DevRuntime`
- Modified `tugcode/crates/tugcast/src/main.rs` -- exit code 44 mapping removed
- Modified `tugcode/crates/tugtool/src/main.rs` -- `binary_updated` match arm removed (restart/reset still trigger restart)
- Modified `tugapp/Sources/ProcessManager.swift` -- `binary_updated` case removed; `restart` case now calls `copyBinaryFromSourceTree()` before restarting

**Tasks:**
- [ ] Delete `spawn_binary_watcher()` function from `dev.rs`
- [ ] Remove `_binary_watcher: Option<tokio::task::JoinHandle<()>>` from `DevRuntime`
- [ ] Remove `Some(binary_watcher)` assignment in `enable_dev_mode` and the `binary_path`/`spawn_binary_watcher` call
- [ ] Remove the `.abort()` call on `_binary_watcher` in `disable_dev_mode`
- [ ] Remove `44 => "binary_updated"` from the exit code match in `main.rs`
- [ ] In `tugtool/src/main.rs`, remove `"binary_updated"` from the `"restart" | "reset" | "binary_updated"` match arm (keep `"restart" | "reset"`)
- [ ] In `ProcessManager.swift`, remove the `case "binary_updated"` block. **Intentional behavior change:** add `copyBinaryFromSourceTree()` call to the `case "restart", "reset"` block. Currently only the `binary_updated` case calls this method; moving it to `restart` ensures that when the user explicitly clicks Restart in the Developer card, ProcessManager copies the already-built binary from the source tree into the app bundle before respawning. This is new behavior for the `restart` case (previously, restart did not copy) and is required because the auto-copy-on-binary-change mechanism (exit code 44) is being removed.
- [ ] Delete the binary watcher test functions (`test_binary_watcher_detects_mtime_change`, `test_binary_watcher_stabilization`, `test_binary_watcher_no_change`, `test_binary_watcher_missing_then_appears`)
- [ ] Investigate bun build --watch management per [Q01] and document recommendation

**Tests:**
- [ ] Unit test: `enable_dev_mode` returns `DevRuntime` without binary watcher field
- [ ] Integration test: existing `test_enable_dev_mode_valid` still passes
- [ ] Integration test: existing `test_disable_dev_mode_clears_state` still passes

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast -p tugtool` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] `cd tugdeck && bun test` passes
- [ ] Manual: `just dev`, modify tugcast binary, confirm NO automatic restart occurs

**Rollback:** Revert commit; `spawn_binary_watcher` and exit code 44 are restored.

**Commit after all checkpoints pass.**

---

#### Step 1: Add DevChangeTracker and notification infrastructure {#step-1}

**Depends on:** #step-0

**Commit:** `feat(dev): add DevChangeTracker and dev_notification sending`

**References:** [D03] DevChangeTracker struct, [D04] dev_notification Control frame action, Spec S01, Table T01, (#d03-change-tracker, #d04-notification-protocol, #notification-protocol)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- new `DevChangeTracker` struct, `send_dev_notification` function
- `DevChangeTracker` added to `DevRuntime` for RAII lifecycle

**Tasks:**
- [ ] Define `DevChangeTracker` struct with fields: `frontend_dirty: bool`, `backend_dirty: bool`, `app_dirty: bool`, `code_count: u32` (single combined counter for Category 2, incremented by both `mark_frontend` and `mark_backend`), `app_count: u32` (Category 3 counter)
- [ ] Implement `DevChangeTracker::new()`, `mark_frontend()` (sets `frontend_dirty`, increments `code_count`), `mark_backend()` (sets `backend_dirty`, increments `code_count`), `mark_app()` (sets `app_dirty`, increments `app_count`), `snapshot()` (returns dirty flags, counts, and a `changes` vec built from dirty flags), `clear_restart()` (clears frontend+backend dirty and `code_count`), `clear_all()`
- [ ] Wrap as `Arc<std::sync::Mutex<DevChangeTracker>>` for shared access between watcher tasks
- [ ] Implement `send_dev_notification()` that takes tracker snapshot, builds JSON per Spec S01, sends as `Frame::new(FeedId::Control, payload)` via `broadcast::Sender<Frame>`
- [ ] Add `DevChangeTracker` field to `DevRuntime` (or pass through `enable_dev_mode` return)
- [ ] Add the tracker to the Category 1 watcher: after sending `reload_frontend`, also call `send_dev_notification` with type `"reloaded"`

**Tests:**
- [ ] Unit test: `DevChangeTracker::new()` starts clean (all dirty flags false, all counts zero)
- [ ] Unit test: `mark_frontend()` sets `frontend_dirty` and increments `code_count`
- [ ] Unit test: `mark_backend()` sets `backend_dirty` and increments `code_count` (same counter as frontend)
- [ ] Unit test: two `mark_frontend()` + one `mark_backend()` yields `code_count == 3` (combined total)
- [ ] Unit test: `mark_app()` sets `app_dirty` and increments `app_count`
- [ ] Unit test: `clear_restart()` clears frontend+backend dirty and `code_count` but preserves `app_dirty` and `app_count`
- [ ] Unit test: `clear_all()` clears everything
- [ ] Unit test: `snapshot()` returns correct dirty flags, counts, and `changes` vec (e.g., `["frontend", "backend"]` when both dirty)
- [ ] Unit test: `send_dev_notification` produces correct JSON for each type (count reflects combined total)

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes
- [ ] Manual: `just dev`, edit a CSS file, confirm `reload_frontend` still works AND a `dev_notification` type `reloaded` appears in browser console

**Rollback:** Revert commit; `DevChangeTracker` and notification functions are removed.

**Commit after all checkpoints pass.**

---

#### Step 2: Add Category 2 and 3 watchers {#step-2}

**Depends on:** #step-1

**Commit:** `feat(dev): add notification-only watchers for compiled code and app sources`

**References:** [D02] Three watcher categories, [D03] DevChangeTracker, [D04] dev_notification, Table T01, Risk R01, (#d02-watcher-categories, #t01-watcher-categories, #r01-watcher-race)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- new `dev_compiled_watcher()` and `dev_app_watcher()` functions
- Modified `enable_dev_mode()` -- spawns Category 2 and 3 watchers alongside existing Category 1

**Tasks:**
- [ ] **Fix Category 1 extension filter:** In `dev.rs`, modify `has_reload_extension()` to remove `.js` from the match. Current code (line 469): `ext == "html" || ext == "css" || ext == "js"`. Change to: `ext == "html" || ext == "css"`. This is critical: without this change, `dist/app.js` changes would trigger automatic reload via Category 1 AND notification via Category 2, defeating the notification-only design for compiled code.
- [ ] Implement `dev_compiled_watcher()`: uses **mtime polling** (NOT notify events) with a 2-second poll interval to watch `dist/app.js` and the tugcast binary path. Polling is required because these are single files whose exact paths are known, and notify/FSEvents can miss single-file changes in some scenarios. Design details:
  - Poll both paths every 2 seconds, comparing `metadata().modified()` against last-seen mtime
  - **Handle missing-at-start:** If a watched file does not exist when the watcher starts (e.g., `dist/app.js` before first `bun build`), record `None` as the initial mtime and skip until the file appears. When it appears, treat that as a change.
  - **Stabilization delay:** After detecting an mtime change, wait 500ms and re-check mtime. If mtime changed again during the wait, restart the 500ms timer. This prevents firing mid-write (e.g., cargo still writing the binary). Only send notification after mtime stabilizes.
  - On stable change, call `tracker.mark_frontend()` or `tracker.mark_backend()` based on which path changed, then call `send_dev_notification` with type `restart_available`
- [ ] Implement `dev_app_watcher()`: uses `notify` with `RecursiveMode::Recursive` on `tugapp/Sources/`. On `.swift` file change, calls `tracker.mark_app()` and `send_dev_notification` with type `relaunch_available`. Uses same quiet-period debounce pattern as Category 1 (100ms silence window). (Note: Category 3 uses notify events, not polling, because it watches a directory tree of many files -- different from Category 2's single-file polling.)
- [ ] Update `enable_dev_mode()` to create and start all three watcher categories
- [ ] Update `DevRuntime` to hold handles for Category 2 and 3 watchers (for cleanup on `disable_dev_mode`)
- [ ] Update `disable_dev_mode()` to clean up all watcher handles

**Tests:**
- [ ] Unit test: `has_reload_extension` returns false for `.js` files (confirms fix)
- [ ] Unit test: `has_reload_extension` returns true for `.css` and `.html` files
- [ ] Unit test: `dev_compiled_watcher` detects mtime change and sends notification after stabilization
- [ ] Unit test: `dev_compiled_watcher` handles missing file at start (no panic, no notification until file appears)
- [ ] Unit test: `dev_compiled_watcher` stabilization -- rapid mtime changes delay notification until 500ms of stability
- [ ] Unit test: `dev_app_watcher` detects `.swift` file change and sends notification
- [ ] Integration test: `enable_dev_mode` creates all three watcher categories
- [ ] Integration test: `disable_dev_mode` cleans up all watchers

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes
- [ ] Manual: `just dev`, edit a `.css` file, confirm automatic reload still works (Category 1)
- [ ] Manual: touch `tugdeck/dist/app.js`, confirm `dev_notification` type `restart_available` appears in browser console (NO automatic page reload -- confirms `.js` removed from Category 1)
- [ ] Manual: touch `tugapp/Sources/SomeFile.swift`, confirm `dev_notification` type `relaunch_available` appears

**Rollback:** Revert commit; Category 2 and 3 watchers are removed.

**Commit after all checkpoints pass.**

---

#### Step 3: Build Developer card and wire notification routing {#step-3}

**Depends on:** #step-2

**Commit:** `feat(deck): add Developer card with action-dispatch notification routing`

**References:** [D07] Developer card with TugConnection constructor, [D09] Route dev_notification through action-dispatch, [D04] dev_notification, [D11] Separate dev_build_progress action, [D12] Dock badge indicator, Spec S01, Spec S05, (#d07-developer-card, #d09-notification-routing, #d04-notification-protocol, #d11-build-progress-action, #d12-dock-badge, #notification-protocol, #s01-notification-format, #s05-build-progress-format)

**Artifacts:**
- New `tugdeck/src/cards/developer-card.ts` -- DeveloperCard class
- New `tugdeck/src/cards/developer-card.test.ts` -- tests
- Modified `tugdeck/src/main.ts` -- import DeveloperCard, register card factory
- Modified `tugdeck/src/deck-manager.ts` -- add `"developer"` to `titleForComponent` map
- Modified `tugdeck/src/dock.ts` -- add Developer icon button to dock (before spacer), add `setBadge()` method for badge support
- Modified `tugdeck/src/action-dispatch.ts` -- register `dev_notification` and `dev_build_progress` action handlers, dock badge logic

**Tasks:**
- [ ] Create `DeveloperCard` class implementing `TugCard` interface
- [ ] Constructor accepts `TugConnection` parameter (following `SettingsCard` pattern at `settings-card.ts` line 27): `constructor(connection: TugConnection)` -- store as `private connection: TugConnection`
- [ ] Set `feedIds` to `[]` (empty array) -- **NOT** `[FeedId.CONTROL]`. `FeedId.CONTROL` is excluded from `DeckManager`'s `OUTPUT_FEED_IDS` array (deck-manager.ts lines 37-46), so `DeckManager` never registers a `connection.onFrame` callback for it. Declaring CONTROL in feedIds would silently receive nothing. The card receives data via action-dispatch routing instead.
- [ ] Set `meta` with title "Developer", icon "Code", closable true
- [ ] Implement `mount()`: create three indicator rows (Styles, Code, App) with dot indicators, labels, status text, and action buttons
- [ ] Implement `update(payload: Record<string, unknown>): void` -- the public method called by the `dev_notification` action handler in action-dispatch.ts. Parses the payload type and updates row states:
  - For `type: "reloaded"`: flash "Reloaded" on Styles row, return to "Clean" after 2 seconds
  - For `type: "restart_available"`: update Code row with change count from `payload.count`, show Restart button
  - For `type: "relaunch_available"`: update App row with change count from `payload.count`, show Relaunch button
- [ ] Implement `onFrame()` as a no-op (card does not receive frames via DeckManager fan-out)
- [ ] Implement Restart button click: call `this.connection.sendControlFrame("restart")` to send restart request via WebSocket. Note: `sendControlFrame(action, params?)` on `TugConnection` (connection.ts line 255) internally calls `controlFrame()` from `protocol.ts` and sends via `send(feedId, payload)` -- do NOT call `this.connection.send(controlFrame(...))` directly as `send()` takes `(feedId, payload)`, not a Frame object.
- [ ] Implement Relaunch button click: call `this.connection.sendControlFrame("relaunch")` via WebSocket
- [ ] Implement Reset button click: call `localStorage.clear()`, then `this.connection.sendControlFrame("reset")` via WebSocket
- [ ] Implement `onResize()` and `destroy()` for cleanup
- [ ] When WebKit bridge is not available (CLI mode), hide the App row and Relaunch button
- [ ] In `tugdeck/src/main.ts`: add `import { DeveloperCard } from "./cards/developer-card"` alongside existing card imports. Register factory: `deck.registerCardFactory("developer", () => new DeveloperCard(connection))` -- note `connection` is passed to constructor, same pattern as SettingsCard on line 45.
- [ ] In `tugdeck/src/deck-manager.ts`: add `developer: "Developer"` entry to the `titles` record in `titleForComponent()` (line 66-74)
- [ ] In `tugdeck/src/dock.ts`: add a Developer icon button to the dock. Import a lucide icon (e.g., `Wrench` or `Code2`) and call `this.addIconButton(Wrench, "developer")` after the existing `stats` button (line 43) and before the spacer (line 46). This gives the Developer card a permanent dock presence so it can be opened by clicking and can display a badge.
- [ ] In `tugdeck/src/dock.ts`: add a `setBadge(componentId: string, count: number)` method to the `Dock` class. When `count > 0`, render a small badge overlay on the dock button for the given component. When `count === 0`, remove the badge. The badge is a CSS absolute-positioned element (e.g., a small circle with the count number).
- [ ] In `tugdeck/src/action-dispatch.ts`: register a `dev_notification` handler in `initActionDispatch()`. The handler finds the active DeveloperCard instance via `deckManager.findPanelByComponent("developer")` + card registry lookup, and calls `card.update(payload)`. If no Developer card is open AND the notification carries dirty state (type `restart_available` or `relaunch_available`), set a dock badge on the Developer card's dock icon via `deckManager.setBadge("developer", count)` (see [D12]). This prevents the `console.warn("unknown action: dev_notification")` that `dispatchAction()` would otherwise log on every file change.
- [ ] In `tugdeck/src/action-dispatch.ts`: register a `dev_build_progress` handler in `initActionDispatch()`. The handler routes build progress payloads (stage, status, error) to the Developer card's `updateBuildProgress(payload)` method. If no Developer card is open, the handler is a no-op.
- [ ] Implement dock badge support: wire the `dev_notification` action handler to call `dock.setBadge("developer", count)` when the Developer card is closed but dirty notifications arrive. Clear the badge (`dock.setBadge("developer", 0)`) when the card is opened (mounted) or when the user triggers restart/relaunch/reset.
- [ ] In the Developer card `mount()` method: clear any existing dock badge for "developer" on mount
- [ ] Style the card using design tokens (green/yellow dots, compact layout)

**Tests:**
- [ ] Unit test: DeveloperCard constructor accepts TugConnection, mounts without error
- [ ] Unit test: `update()` with `dev_notification` type `reloaded` updates Styles row
- [ ] Unit test: `update()` with `restart_available` and count shows change count and Restart button
- [ ] Unit test: `update()` with `relaunch_available` and count shows change count and Relaunch button
- [ ] Unit test: Restart button click calls `connection.sendControlFrame("restart")`
- [ ] Unit test: destroy() cleans up DOM elements and timers
- [ ] Unit test: `dev_notification` action handler in action-dispatch does not produce console.warn
- [ ] Unit test: `dev_notification` action handler sets dock badge when Developer card is closed and notification is dirty
- [ ] Unit test: `dev_notification` action handler is no-op for `reloaded` type when no Developer card is open (no badge for clean state)
- [ ] Unit test: `dev_build_progress` action handler routes build progress to Developer card
- [ ] Unit test: `dev_build_progress` action handler is no-op when no Developer card is open
- [ ] Unit test: dock badge is cleared when Developer card is mounted
- [ ] Unit test: Dock renders Developer icon button alongside existing buttons
- [ ] Unit test: Dock.setBadge shows/clears badge overlay on the developer button

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `cd tugdeck && bun test` passes
- [ ] Manual: `just dev`, open Developer card via show-card action, see three rows showing "Clean"
- [ ] Manual: touch a CSS file, see Styles row flash "Reloaded" (routed through action-dispatch, not fan-out)
- [ ] Manual: touch `tugdeck/dist/app.js`, see Code row show "1 change" with Restart button
- [ ] Manual: confirm Developer button appears in dock rail between Stats and the spacer
- [ ] Manual: close Developer card, touch dist/app.js, confirm badge appears on Developer dock button
- [ ] Manual: click Developer dock button, confirm card opens and badge clears
- [ ] Manual: open browser console, confirm no "unknown action: dev_notification" warnings

**Rollback:** Revert commit; delete developer-card.ts, remove factory registration, remove action handler.

**Commit after all checkpoints pass.**

---

#### Step 4: Wire operation triggers end-to-end {#step-4}

**Depends on:** #step-3

**Commit:** `feat(actions): wire restart/reset operations and add exit code 45 mapping for relaunch`

**References:** [D05] Exit code 45 for relaunch, [D10] Relaunch orchestration in control.rs, Spec S02, Table T02, (#d05-exit-code-relaunch, #d10-relaunch-orchestration, #s02-operation-actions, #t02-exit-codes, #operation-triggers)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/main.rs` -- add `45 => "relaunch"` to shutdown reason mapping
- Modified `tugapp/Sources/ProcessManager.swift` -- add `"relaunch"` shutdown reason handling
- Verify `tugdeck/src/action-dispatch.ts` -- `dev_notification` handler was registered in Step 3; verify it routes correctly to Developer card

**Tasks:**
- [ ] In `main.rs`, add `45 => "relaunch"` to the shutdown reason match
- [ ] In `ProcessManager.swift`, add `case "relaunch"` to the shutdown handler: set `restartDecision = .doNotRestart` (tugrelaunch handles the cycle)
- [ ] In `tugtool/src/main.rs`, ensure `"relaunch"` shutdown reason maps to `DoNotRestart` (it will fall into the default arm, which already does this -- verify)
- [ ] Do NOT add a `"relaunch"` arm to `dispatch_action` in `actions.rs`. The relaunch action is handled exclusively in `control.rs` (see [D10]) where `shared_dev_state` is available. The action is Mac-app-only and always arrives via the control socket, never via HTTP tell.
- [ ] Verify that `restart` action still works end-to-end: Developer card -> Control frame -> actions.rs -> exit code 42 -> supervisor restart
- [ ] Verify that `reset` action still works end-to-end: localStorage.clear() -> Control frame -> actions.rs -> exit code 43 -> supervisor restart

**Tests:**
- [ ] Unit test: exit code 45 maps to shutdown reason `"relaunch"`
- [ ] Integration test: existing restart test still passes
- [ ] Integration test: existing reset test still passes

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast -p tugtool` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] Manual: `just dev`, click Restart in Developer card, confirm tugcast restarts and reconnects
- [ ] Manual: click Reset, confirm localStorage cleared and tugcast restarts

**Rollback:** Revert commit; remove exit code 45 mapping.

**Commit after all checkpoints pass.**

---

#### Step 5: Build tugrelaunch crate {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugrelaunch): build-replace-relaunch helper binary`

**References:** [D06] tugrelaunch as separate workspace binary, Spec S03, Spec S04, List L01, (#d06-tugrelaunch-binary, #tugrelaunch-lifecycle, #tugrelaunch-cli)

> This step is large and split into substeps.

**Tasks:**
- [ ] Complete substeps 5.1 through 5.3

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugrelaunch` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugrelaunch` passes

##### Step 5.1: Scaffold tugrelaunch crate with CLI and progress socket {#step-5-1}

**Commit:** `feat(tugrelaunch): scaffold crate with CLI parsing and progress socket`

**References:** [D06] tugrelaunch as separate workspace binary, Spec S03, Spec S04, (#d06-tugrelaunch-binary, #s03-tugrelaunch-cli, #s04-progress-protocol, #tugrelaunch-cli, #tugrelaunch-progress)

**Artifacts:**
- New `tugcode/crates/tugrelaunch/Cargo.toml`
- New `tugcode/crates/tugrelaunch/src/main.rs`
- Modified `tugcode/Cargo.toml` -- add tugrelaunch to workspace members

**Tasks:**
- [ ] Create `tugcode/crates/tugrelaunch/Cargo.toml` with dependencies: `clap`, `serde_json`, `libc`, `tokio`
- [ ] Create `tugcode/crates/tugrelaunch/src/main.rs` with clap CLI parsing for `--source-tree`, `--app-bundle`, `--progress-socket`, `--pid` (per Spec S03)
- [ ] Implement UDS listener at `--progress-socket` path for progress communication
- [ ] Implement progress message sending (newline-delimited JSON per Spec S04)
- [ ] Add tugrelaunch to workspace members in root `Cargo.toml`
- [ ] Verify `cargo build -p tugrelaunch` succeeds

**Tests:**
- [ ] Unit test: CLI parsing accepts required arguments
- [ ] Unit test: progress message serialization matches Spec S04 format

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugrelaunch` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugrelaunch` passes

**Rollback:** Delete crate directory, remove from workspace members.

**Commit after all checkpoints pass.**

---

##### Step 5.2: Implement build orchestration in tugrelaunch {#step-5-2}

**Depends on:** #step-5-1

**Commit:** `feat(tugrelaunch): implement build orchestration (cargo, bun, xcode)`

**References:** [D06] tugrelaunch as separate workspace binary, List L01, Spec S04, (#l01-tugrelaunch-phases, #s04-progress-protocol, #tugrelaunch-lifecycle)

**Artifacts:**
- Modified `tugcode/crates/tugrelaunch/src/main.rs` -- build phase implementation

**Tasks:**
- [ ] Implement Phase 1 (BUILD): run `cargo build -p tugcast -p tugtool -p tugcode` as subprocess, capture exit code, send progress
- [ ] Implement bun build step: run `bun run build` in `tugdeck/` directory
- [ ] Implement xcodebuild step: run `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`
- [ ] On any build failure: send error progress message, exit with non-zero code
- [ ] Send stage-specific progress messages for each build step

**Tests:**
- [ ] Integration test: build phase exits with error when given invalid source tree
- [ ] Unit test: progress messages sent in correct order

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugrelaunch` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugrelaunch` passes
- [ ] Manual: run `tugrelaunch --source-tree $(pwd) --app-bundle /tmp/test.app --progress-socket /tmp/test.sock --pid $$` and verify build stages execute (may fail at xcode if no Xcode project, but cargo and bun should work)

**Rollback:** Revert commit; build orchestration removed.

**Commit after all checkpoints pass.**

---

##### Step 5.3: Implement signal, wait, copy, and relaunch phases {#step-5-3}

**Depends on:** #step-5-2

**Commit:** `feat(tugrelaunch): implement signal, wait, copy, and relaunch phases`

**References:** [D06] tugrelaunch as separate workspace binary, List L01, (#l01-tugrelaunch-phases, #tugrelaunch-lifecycle)

**Artifacts:**
- Modified `tugcode/crates/tugrelaunch/src/main.rs` -- Phases 2-5

**Tasks:**
- [ ] Implement Phase 2 (SIGNAL): send SIGTERM to the `--pid` process via `libc::kill(pid, libc::SIGTERM)`
- [ ] Implement Phase 3 (WAIT): use kqueue `EVFILT_PROC`/`NOTE_EXIT` to wait for `--pid` to exit. 10-second timeout, then SIGKILL via `libc::kill(pid, libc::SIGKILL)`.
- [ ] Implement Phase 4 (COPY): copy built binaries from `target/debug/` and xcodebuild output into `Tug.app/Contents/MacOS/`. Use `rename()` for atomic replacement where possible.
- [ ] Implement Phase 5 (RELAUNCH): run `open -a /path/to/Tug.app`. Write status file to `/tmp/tugrelaunch-status.json`. Exit 0.
- [ ] Send progress messages for each phase transition

**Tests:**
- [ ] Unit test: SIGTERM sending works (mock process)
- [ ] Unit test: kqueue wait with timeout works
- [ ] Unit test: binary copy to target directory works
- [ ] Unit test: status file is written correctly

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugrelaunch` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugrelaunch` passes

**Rollback:** Revert commit; phases 2-5 removed.

**Commit after all checkpoints pass.**

---

##### Tugrelaunch Crate Summary

After completing Steps 5.1-5.3, you will have:
- A fully functional `tugrelaunch` binary that can build all project components, signal the old app, wait for exit, copy binaries, and relaunch
- Progress communication via Unix domain socket
- Proper error handling at each phase with no-harm-done failure semantics

**Final Step 5 Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugrelaunch` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugrelaunch` passes

---

#### Step 6: Wire tugrelaunch into relaunch flow and update Justfile {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `feat(dev): wire tugrelaunch into relaunch action flow, update Justfile`

**References:** [D08] Async tugrelaunch spawn, [D10] Relaunch orchestration in control.rs, [D11] Separate dev_build_progress action, [D13] PID acquisition via getppid, [D05] Exit code 45, [D06] tugrelaunch binary, Spec S03, Spec S04, Spec S05, Risk R02, (#d08-async-relaunch, #d10-relaunch-orchestration, #d11-build-progress-action, #d13-pid-acquisition, #r02-progress-socket, #s03-tugrelaunch-cli, #s04-progress-protocol, #s05-build-progress-format)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/control.rs` -- relaunch orchestration in `run_recv_loop` Tell handler (intercepts `action == "relaunch"` before delegating to `dispatch_action`)
- Modified `Justfile` -- `build` recipe builds tugrelaunch, `app` recipe copies it into app bundle
- Modified `tugapp/Sources/ProcessManager.swift` -- `relaunch` case prepares for app exit

**Tasks:**
- [ ] In `control.rs` `run_recv_loop`, inside the `ControlMessage::Tell` handler: add a check for `action == "relaunch"` BEFORE the existing `dispatch_action()` delegation. When matched, run the relaunch orchestration using locally available `shared_dev_state` to get `source_tree`:
  1. Read `source_tree` from `shared_dev_state` (it is available in `run_recv_loop`'s scope). If dev mode is not enabled or source_tree is missing, log an error and ignore the relaunch request (relaunch is only meaningful in dev mode with a known source tree)
  2. Determine `--app-bundle` path (from environment or well-known location)
  3. Determine `--pid` for the Tug.app process via `std::os::unix::process::parent_id()` (see [D13]). This is tugcast's parent PID, which is always the Tug.app process because ProcessManager.swift spawns tugcast directly via `Process()`
  4. Build progress socket path: `/tmp/tugrelaunch-{pid}.sock` where pid is tugcast's own PID
  5. Spawn `tugrelaunch --source-tree <path> --app-bundle <path> --progress-socket <path> --pid <tug_app_pid>` as child process
  6. Connect to progress socket
  7. Read progress messages and forward as `dev_build_progress` Control frames (per Spec S05, [D11]) via `client_action_tx`
  8. On build failure: log error, do NOT send exit code (old app stays running). Send a final `dev_build_progress` frame with the error for the Developer card to display.
  9. On "quitting" message: send exit code 45 via `shutdown_tx`
- [ ] Update `Justfile` `build` recipe: add `-p tugrelaunch` to cargo build command
- [ ] Update `Justfile` `app` recipe: add `cp tugcode/target/debug/tugrelaunch "$MACOS_DIR/"`
- [ ] In `ProcessManager.swift`, update `"relaunch"` case (from Step 4) to save any necessary state before app exit

**Tests:**
- [ ] Unit test: relaunch orchestration in control.rs spawns process with correct arguments (including `--pid`)
- [ ] Unit test: relaunch orchestration reads `source_tree` from `shared_dev_state`
- [ ] Unit test: progress relay forwards messages as `dev_build_progress` frames (not `dev_notification`)
- [ ] Unit test: relaunch orchestration logs error and ignores request when dev mode is not enabled
- [ ] Integration test: `just build` builds tugrelaunch without error

**Checkpoint:**
- [ ] `just build` succeeds (includes tugrelaunch)
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] Manual: `just app`, open Developer card, touch a .swift file, click Relaunch, observe build progress in card (dev_build_progress frames), confirm app relaunches with new code

**Rollback:** Revert commit; remove tugrelaunch from Justfile, remove relaunch orchestration from control.rs.

**Commit after all checkpoints pass.**

---

#### Step 7: End-to-end validation and polish {#step-7}

**Depends on:** #step-6

**Commit:** `test(dev): end-to-end validation of dev mode notification flow`

**References:** [D01] through [D13], all Specs and Tables, (#success-criteria, #scope)

**Artifacts:**
- Any final bug fixes or adjustments discovered during validation
- Updated test coverage for edge cases

**Tasks:**
- [ ] Run the full test suite: `just ci` (lint + test-rust + test-ts)
- [ ] Manual test: CSS hot reload flow (edit CSS -> automatic reload -> Styles row flashes "Reloaded")
- [ ] Manual test: Compiled code notification flow (cargo build -> Code row shows changes -> click Restart -> process restarts)
- [ ] Manual test: App source notification flow (edit .swift -> App row shows changes -> click Relaunch -> build and relaunch)
- [ ] Manual test: Reset flow (click Reset -> localStorage cleared, process restarts clean)
- [ ] Manual test: CLI mode (just dev) -- verify App row and Relaunch are hidden
- [ ] Manual test: Mac app mode -- verify all three rows visible and functional
- [ ] Fix any issues discovered during validation
- [ ] Verify [Q01] resolution is documented

**Tests:**
- [ ] All existing tests pass (`just test`)
- [ ] No new warnings in build (`just lint`)

**Checkpoint:**
- [ ] `just ci` passes
- [ ] All success criteria from (#success-criteria) verified
- [ ] No regressions in existing dev mode functionality

**Rollback:** Revert commit; fix issues and re-validate.

**Commit after all checkpoints pass.**

---

### 7.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A notification-driven developer mode that tracks file changes across three categories, notifies the developer via a Developer card, and lets them trigger restart, relaunch, or reset on demand -- replacing the brittle auto-restart mechanism.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `spawn_binary_watcher` and exit code 44 are fully removed from the codebase (grep confirms zero occurrences)
- [ ] CSS hot reload works automatically as before (no regression)
- [ ] Compiled code changes produce notification in Developer card, NOT automatic restart
- [ ] App source changes produce notification in Developer card
- [ ] Restart button in Developer card restarts tugcast and picks up new binaries
- [ ] Relaunch button triggers tugrelaunch, builds everything, and relaunches the app
- [ ] Reset button clears state and restarts
- [ ] `just ci` passes (lint + all tests)
- [ ] `just app` includes tugrelaunch in the app bundle

**Acceptance tests:**
- [ ] Unit tests for DevChangeTracker state transitions
- [ ] Unit tests for dev_notification JSON serialization
- [ ] Unit tests for DeveloperCard mount/update/destroy
- [ ] Integration test for control.rs relaunch orchestration with exit code 45
- [ ] Full regression: `just test` (Rust + TypeScript)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add keyboard shortcut to toggle Developer card (e.g., Cmd+Shift+D)
- [ ] Add Developer menu item in Mac app to show/hide Developer card
- [ ] Investigate HMR for CSS (inject without full page reload)
- [ ] Add build error details display in Developer card (show cargo/bun/xcode error output)
- [ ] Persist Developer card visibility preference across restarts

| Checkpoint | Verification |
|------------|--------------|
| Auto-restart removed | `grep -r "binary_updated\|exit.*44\|spawn_binary_watcher" tugcode/ tugapp/` returns no matches |
| Notification flow works | Manual: touch dist/app.js, see notification in Developer card |
| Restart flow works | Manual: click Restart, confirm process restarts |
| Relaunch flow works | Manual: click Relaunch, confirm build and app relaunch |
| All tests pass | `just ci` exits 0 |

**Commit after all checkpoints pass.**
