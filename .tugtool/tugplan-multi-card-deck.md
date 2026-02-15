## Phase 2.0: Multi-Card Deck {#phase-multi-card-deck}

**Purpose:** Extend tugcast and tugdeck from a single-card terminal viewer into a four-panel dashboard with filesystem events, git status, stub stats, resizable CSS Grid layout, and heartbeat mechanism.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 1 (Terminal Bridge, committed as b49b338) proved the end-to-end architecture: tugcast attaches to a tmux session via PTY, streams terminal I/O over WebSocket, and tugdeck renders it with xterm.js. The browser viewport contains a single terminal card. Phase 2 transforms this single-card viewer into a multi-feed dashboard by adding filesystem and git data sources on the backend, a CSS Grid layout with four card slots on the frontend, and custom drag-handle resize between panels. The authoritative design reference is `roadmap/component-roadmap.md`, sections 5.3, 5.4, 5.6, 5.7, 6, 7.2, 7.3, 7.5, 7.6, 8, 9, 10, and 13.

#### Strategy {#strategy}

- Extend tugcast-core first: add new FeedId variants (Filesystem=0x10, Git=0x20), FsEvent/GitStatus types in a new `types.rs`, and update the protocol module
- Implement the filesystem and git snapshot feeds in tugcast, registering them in the feed router alongside the existing terminal stream feed
- Extend the feed router to multiplex snapshot feeds (watch channels) onto the WebSocket alongside the existing broadcast channel
- Refactor tugdeck from single-card to CSS Grid multi-card layout with named grid areas (terminal, files, git, stats)
- Implement custom drag-handle resize using pointer events for precise control between adjacent cards
- Add files-card and git-card renderers that parse JSON payloads from their respective feeds
- Include a stub stats card ("Coming soon") to establish the 4-slot layout for Phase 3
- Heartbeat mechanism is already implemented in the router (Phase 1); Phase 2 adds the server-side active disconnection on 45-second timeout per user answer

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code users who want filesystem and git visibility alongside their terminal session
2. Tugtool developers building toward the full stats dashboard (Phase 3)

#### Success Criteria (Measurable) {#success-criteria}

- Filesystem events from the project directory appear in the files card within 200ms of the OS event (debounce + transmission)
- Git status snapshot refreshes every 2 seconds and reflects the current branch, staged/unstaged files
- CSS Grid layout renders four card slots with correct named areas (terminal, files, git, stats)
- Drag handles allow resizing adjacent cards; minimum card dimension is 100px
- `.gitignore` patterns are respected: no events from `target/`, `node_modules/`, etc.
- `cargo build --workspace` and `cargo nextest run` pass with zero warnings
- `cargo clippy --workspace -- -D warnings` passes

#### Scope {#scope}

1. `tugcast-core`: FsEvent enum, GitStatus struct, FileStatus struct in new `types.rs`; FeedId extended with Filesystem (0x10) and Git (0x20) variants
2. `tugcast`: Filesystem tugfeed via `notify` crate with `.gitignore` filtering; Git tugfeed via `git status --porcelain=v2 --branch`
3. `tugcast`: Feed router extended to subscribe WebSocket clients to snapshot feeds (watch channels)
4. `tugdeck`: CSS Grid layout with named grid areas, custom drag-handle resize with pointer events
5. `tugdeck`: `cards/files-card.ts` rendering filesystem events as a scrolling log
6. `tugdeck`: `cards/git-card.ts` rendering git status with branch, staged/unstaged/untracked
7. `tugdeck`: `cards/stats-card.ts` stub with "Coming soon" placeholder
8. `tugdeck`: `styles/deck.css` and `styles/cards.css` for grid layout and per-card styling
9. Server-side heartbeat active disconnection: tugcast closes WebSocket if no heartbeat received within 45 seconds

#### Non-goals (Explicitly out of scope) {#non-goals}

- Stats tugfeed collectors (process info, token usage, build status) -- Phase 3
- Reconnection UI ("Disconnected" banner, auto-retry logic in tugdeck) -- Phase 3
- Layout persistence in localStorage -- Phase 3
- WebGL renderer for terminal card -- Phase 3
- Tugcard collapse/expand -- Phase 3
- Observe-only mode -- Phase 3
- Adaptive git polling acceleration (500ms on FS events) -- Phase 3
- Tree view in files card (on-demand via control feed) -- Phase 3

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 (Terminal Bridge) completed and committed (b49b338)
- `notify` 8.2.x crate for filesystem watching
- `ignore` 0.4.x crate for `.gitignore`-aware path filtering
- `git` CLI available on the host system
- Existing Phase 1 infrastructure: tugcast-core (protocol, feed traits), tugcast (server, auth, terminal feed, router), tugdeck (connection, protocol, terminal card)

#### Constraints {#constraints}

- macOS and Linux only (no Windows) per AD-6
- Binds exclusively to 127.0.0.1 per section 8.1
- Warnings are errors (`-D warnings` via `.cargo/config.toml`)
- No cross-dependency between tugcast and tugtool crates per AD-5
- Git polling at fixed 2-second interval (no acceleration until Phase 3)
- Filesystem debouncing at 100ms window per roadmap section 5.3

#### Assumptions {#assumptions}

- The feed router from Phase 1 already supports both broadcast (StreamFeed) and watch (SnapshotFeed) channel types, so extending it for new snapshot feeds requires adding watch channel subscriptions to the per-client select loop
- tugdeck `deck.ts` will be substantially refactored from single-card to multi-card CSS Grid layout
- The `notify` crate's RecommendedWatcher auto-selects FSEvents on macOS and inotify on Linux
- Git status parsing uses `git status --porcelain=v2 --branch` as specified in roadmap section 5.4, not libgit2
- FsEvent and GitStatus types will be defined in `tugcast-core/src/types.rs` and serialized as JSON payloads
- CSS Grid layout uses named grid areas for semantic structure
- Layout persistence in localStorage is deferred to Phase 3 -- Phase 2 uses a fixed default layout
- WebSocket upgrade and auth logic from Phase 1 remain unchanged

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `notify` crate event storms on bulk git operations | medium | medium | 100ms debounce window, `.gitignore` filtering | If debouncing is insufficient |
| Git CLI polling overhead on large repos | low | low | Fixed 2s interval, diff against previous snapshot | If polling takes >500ms |
| CSS Grid resize handles complex cross-browser behavior | medium | low | Pointer events API, test on Chrome and Firefox | If resize feels laggy or inconsistent |

**Risk R01: Notify Event Storms** {#r01-notify-storms}

- **Risk:** Bulk operations like `git checkout` or `cargo build` can trigger thousands of filesystem events in rapid succession, overwhelming the tugdeck files card.
- **Mitigation:** 100ms debounce window coalesces events into batches. The `ignore` crate filters out `target/`, `node_modules/`, and other `.gitignore`-matched paths. The watch channel holds only the latest batch, so slow clients skip intermediate states.
- **Residual risk:** Extremely large repos may still produce large batches; the files card must handle gracefully (cap displayed events).

**Risk R02: Git Porcelain v2 Parsing Fragility** {#r02-git-parsing}

- **Risk:** Parsing `git status --porcelain=v2 --branch` output requires handling edge cases (detached HEAD, merge conflicts, submodules).
- **Mitigation:** Start with the common cases (branch, ahead/behind, staged/unstaged/untracked). Log but skip unparseable lines rather than failing.
- **Residual risk:** Rare git states may produce incomplete snapshots; acceptable for v1.

---

### 2.0.0 Design Decisions {#design-decisions}

#### [D01] Extend FeedId enum with Filesystem and Git variants (DECIDED) {#d01-extend-feedid}

**Decision:** Add `Filesystem = 0x10` and `Git = 0x20` to the `FeedId` enum in `tugcast-core/src/protocol.rs`. Update `from_byte()` and all match arms.

**Rationale:**
- Feed IDs 0x10 and 0x20 are reserved per roadmap section 6.2
- Adding them to the existing enum is backward-compatible since unknown IDs already return None

**Implications:**
- Protocol.ts must add matching constants: `FILESYSTEM = 0x10`, `GIT = 0x20`
- Existing frame decode tests must be updated to accept new IDs
- `FeedId::from_byte(0x10)` now returns `Some(Filesystem)` instead of `None`

#### [D02] FsEvent and GitStatus types in tugcast-core/src/types.rs (DECIDED) {#d02-shared-types}

**Decision:** Define `FsEvent`, `GitStatus`, and `FileStatus` types in a new `tugcast-core/src/types.rs` module. These are serialized as JSON payloads in snapshot feed frames.

**Rationale:**
- Types are shared between feed implementations and tests
- JSON serialization with serde makes payloads human-readable and easy to parse in TypeScript
- Separating from protocol.rs keeps the protocol module focused on wire format

**Implications:**
- `tugcast-core/src/lib.rs` gains `pub mod types` and re-exports
- Feed implementations depend on these types for serialization
- TypeScript cards parse JSON payloads using matching interfaces

#### [D03] Filesystem feed uses notify + ignore crates with manual 100ms debounce (DECIDED) {#d03-fs-feed}

**Decision:** The filesystem tugfeed uses `notify`'s `RecommendedWatcher` (FSEvents on macOS, inotify on Linux) with a manual 100ms debounce batch window. The `ignore` crate provides `.gitignore`-aware filtering. Note: `RecommendedWatcher` does not provide built-in debouncing (the `with_poll_interval` config only affects the `PollWatcher` backend), so debouncing is implemented manually using a tokio timer that batches events within a 100ms window.

**Rationale:**
- Per roadmap section 5.3: events are debounced to avoid flooding during bulk operations
- Per roadmap section 5.3: the watcher respects `.gitignore` patterns via the `ignore` crate
- Per user answer: full `.gitignore` support via `ignore` crate
- Manual debounce is necessary because `notify 8.x` removed the built-in `Debouncer` from the core crate; the `notify-debouncer-mini` crate exists but adds a dependency for simple timer logic that is trivial to implement with `tokio::time::sleep`

**Implications:**
- `notify` and `ignore` crates added to workspace dependencies and tugcast Cargo.toml
- Raw events from notify are received via an `mpsc` channel, buffered, and flushed after a 100ms quiet window
- Debounced batches are coalesced and sent on a `watch` channel
- Paths are relative to the watched directory for display in tugdeck

#### [D04] Git feed polls at fixed 2-second interval via git CLI (DECIDED) {#d04-git-feed}

**Decision:** The git tugfeed runs `git status --porcelain=v2 --branch` every 2 seconds. Adaptive acceleration (500ms on FS events) is deferred to Phase 3.

**Rationale:**
- Per roadmap section 5.4: start with git CLI for simplicity, migrate to git2 later if needed
- Per user answer: fixed 2-second interval to keep Phase 2 simple
- Porcelain v2 format provides structured output for reliable parsing

**Implications:**
- No dependency on `git2`/libgit2
- Polling runs in a tokio task with `tokio::time::interval(Duration::from_secs(2))`
- Snapshot is diffed against previous: only changes trigger a watch channel send

#### [D05] CSS Grid with named areas and custom drag-handle resize (DECIDED) {#d05-grid-layout}

**Decision:** tugdeck uses CSS Grid with named grid areas (`terminal`, `files`, `git`, `stats`). Resize between cards uses custom drag handles with pointer events, not CSS `resize` property.

**Rationale:**
- Per roadmap section 7.2: CSS Grid dashboard with four tugcards
- Per user answer: custom drag handles with pointer events for precise control
- Named grid areas provide semantic structure and simplify layout manipulation

**Implications:**
- `deck.ts` is substantially rewritten from single-card layout
- Drag handles are absolutely positioned dividers between grid cells
- `pointer-events` (pointerdown/pointermove/pointerup) track drag state
- Minimum card dimension: 100px to prevent collapse

#### [D06] Stub stats card establishes 4-slot layout (DECIDED) {#d06-stats-stub}

**Decision:** The stats card slot renders a "Coming soon" placeholder. No data feed, no feed subscription. This establishes the 4-card grid for Phase 3.

**Rationale:**
- Per user answer: include stub to establish the 4-card layout
- Stats tugfeed and collectors are Phase 3 scope

**Implications:**
- `cards/stats-card.ts` implements TugCard with empty feedIds array
- No server-side changes for the stats feed
- The grid layout has 4 named areas regardless of active feeds

#### [D07] Server-side heartbeat active disconnection at 45 seconds (DECIDED) {#d07-heartbeat-disconnect}

**Decision:** tugcast actively closes the WebSocket connection if no heartbeat is received from the client within 45 seconds. This is already implemented in the Phase 1 router's select loop.

**Rationale:**
- Per user answer: active disconnection rather than passive detection
- Per roadmap section 6.3: connection considered dead after 45-second heartbeat timeout
- Phase 1 already implements this in `router.rs` (heartbeat_interval tick + elapsed check)

**Implications:**
- No new implementation needed for the timeout mechanism itself
- Phase 2 ensures the heartbeat path works correctly with the extended select loop that now includes snapshot feeds

#### [D08] Snapshot feed integration via per-client watch receivers (DECIDED) {#d08-snapshot-integration}

**Decision:** The feed router creates a `watch::Receiver` for each snapshot feed per client. The per-client select loop monitors all watch channels alongside the broadcast channel, forwarding the latest snapshot when it changes.

**Rationale:**
- Per roadmap section 5.7: the feed router holds one `watch::Sender<Frame>` per snapshot feed
- Watch channels provide latest-value semantics: slow clients always see current state
- This matches the SnapshotFeed trait that already exists in tugcast-core

**Implications:**
- FeedRouter struct gains a `Vec<watch::Receiver<Frame>>` or a map of FeedId to watch channels
- The per-client select loop in `handle_client` adds `changed()` branches for each watch channel
- On initial connect, the latest snapshot is sent immediately (watch channels provide this)

---

### 2.0.1 WebSocket Protocol Extension {#ws-protocol-extension}

**Table T01: Phase 2 Feed IDs (additions to Phase 1)** {#t01-phase2-feed-ids}

| ID | TugFeed | Direction | Payload | Channel Type |
|----|---------|-----------|---------|-------------|
| `0x10` | Filesystem events | tugcast -> tugdeck | JSON array of FsEvent | watch (snapshot) |
| `0x20` | Git status | tugcast -> tugdeck | JSON GitStatus snapshot | watch (snapshot) |

These extend the existing Phase 1 feed IDs (0x00, 0x01, 0x02, 0xFF) already implemented in `protocol.rs` and `protocol.ts`.

---

### 2.0.2 Data Types Specification {#data-types-spec}

**Spec S01: FsEvent Type** {#s01-fs-event}

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum FsEvent {
    Created { path: String },
    Modified { path: String },
    Removed { path: String },
    Renamed { from: String, to: String },
}
```

Paths are relative to the watched directory. The `serde(tag = "kind")` attribute produces JSON like `{"kind": "Created", "path": "src/main.rs"}`.

**Spec S02: GitStatus Type** {#s02-git-status}

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<FileStatus>,
    pub unstaged: Vec<FileStatus>,
    pub untracked: Vec<String>,
    pub head_sha: String,
    pub head_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileStatus {
    pub path: String,
    pub status: String, // "M", "A", "D", "R", etc.
}
```

The `PartialEq` derive enables diff comparison between snapshots to avoid redundant WebSocket sends.

---

### 2.0.3 Grid Layout Specification {#grid-layout-spec}

**Spec S03: Default Grid Layout** {#s03-grid-layout}

```
+----------------------------------------+
|              Toolbar (future)           |
+------------------------+---------------+
|                        | Git TugCard   |
|  Terminal TugCard      +---------------+
|  (xterm.js)            | Files TugCard |
|                        +---------------+
|                        | Stats TugCard |
+------------------------+---------------+
|            Status Bar (future)          |
+----------------------------------------+
```

CSS Grid definition:
```css
.deck-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  grid-template-areas:
    "terminal git"
    "terminal files"
    "terminal stats";
  width: 100%;
  height: 100%;
}
```

Each card mounts into its named grid area. The terminal card spans all three rows. The right column holds git, files, and stats cards in equal thirds. Drag handles between the left/right columns and between right-column rows allow resizing.

---

### 2.0.4 Symbol Inventory {#symbol-inventory}

#### 2.0.4.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugcast-core/src/types.rs` | FsEvent, GitStatus, FileStatus type definitions |
| `crates/tugcast/src/feeds/filesystem.rs` | Filesystem tugfeed: notify watcher with gitignore filtering |
| `crates/tugcast/src/feeds/git.rs` | Git tugfeed: CLI status poller |
| `tugdeck/src/cards/files-card.ts` | Filesystem event log tugcard |
| `tugdeck/src/cards/git-card.ts` | Git status tugcard |
| `tugdeck/src/cards/stats-card.ts` | Stub stats tugcard (placeholder) |
| `tugdeck/styles/deck.css` | Grid layout, drag handles, toolbar/status bar placeholders |
| `tugdeck/styles/cards.css` | Per-card styling (files event list, git status badges) |

#### 2.0.4.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugcast-core/src/protocol.rs` | Add Filesystem and Git variants to FeedId enum |
| `crates/tugcast-core/src/lib.rs` | Add `pub mod types`, re-export new types |
| `crates/tugcast-core/Cargo.toml` | Add `serde_json` dependency (for JSON serialization in types) |
| `crates/tugcast/Cargo.toml` | Add `notify` and `ignore` workspace dependencies |
| `crates/tugcast/src/feeds/mod.rs` | Add `pub mod filesystem` and `pub mod git` |
| `crates/tugcast/src/router.rs` | Extend FeedRouter with snapshot feed watch channels; update handle_client select loop |
| `crates/tugcast/src/main.rs` | Create and register filesystem and git feeds; pass watch senders to router |
| `crates/tugcast/src/integration_tests.rs` | Update `build_test_app()` to match new FeedRouter::new() signature (pass empty watch receivers) |
| `tugdeck/src/protocol.ts` | Add FILESYSTEM and GIT FeedId constants |
| `tugdeck/src/deck.ts` | Rewrite from single-card to CSS Grid multi-card layout with drag handles |
| `tugdeck/src/main.ts` | Create and register files, git, and stats cards |
| `tugdeck/index.html` | Update structure for grid layout; link deck.css and cards.css |
| `Cargo.toml` (workspace) | Add `notify` and `ignore` workspace dependencies |

#### 2.0.4.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FeedId::Filesystem` | enum variant | `tugcast-core/src/protocol.rs` | = 0x10 |
| `FeedId::Git` | enum variant | `tugcast-core/src/protocol.rs` | = 0x20 |
| `FsEvent` | enum | `tugcast-core/src/types.rs` | Created, Modified, Removed, Renamed; serde tagged |
| `GitStatus` | struct | `tugcast-core/src/types.rs` | branch, ahead/behind, staged/unstaged/untracked, head |
| `FileStatus` | struct | `tugcast-core/src/types.rs` | path + status code |
| `FilesystemFeed` | struct | `tugcast/src/feeds/filesystem.rs` | Implements SnapshotFeed; notify watcher + ignore filter |
| `GitFeed` | struct | `tugcast/src/feeds/git.rs` | Implements SnapshotFeed; git CLI poller |
| `parse_porcelain_v2` | fn | `tugcast/src/feeds/git.rs` | Parse `git status --porcelain=v2 --branch` output into GitStatus |
| `FeedRouter` | struct (modified) | `tugcast/src/router.rs` | Add watch channel receivers for snapshot feeds |
| `FILESYSTEM` | const | `tugdeck/src/protocol.ts` | = 0x10 |
| `GIT` | const | `tugdeck/src/protocol.ts` | = 0x20 |
| `DeckManager` | class (rewritten) | `tugdeck/src/deck.ts` | CSS Grid layout, drag handle management, multi-card dispatch |
| `FilesCard` | class | `tugdeck/src/cards/files-card.ts` | Implements TugCard; scrolling event log |
| `GitCard` | class | `tugdeck/src/cards/git-card.ts` | Implements TugCard; git status renderer |
| `StatsCard` | class | `tugdeck/src/cards/stats-card.ts` | Implements TugCard; stub placeholder |

---

### 2.0.5 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test FsEvent/GitStatus serialization, git porcelain parsing, FeedId extension, drag handle math | Core logic, edge cases |
| **Integration** | Test filesystem watcher with tempdir, git feed with test repo, router with snapshot feeds | End-to-end paths |
| **Golden / Contract** | Verify JSON payload format for FsEvent/GitStatus matches spec | Protocol compliance |

#### Test Dependencies {#test-dependencies}

- Filesystem feed tests use `tempfile` crate for temporary directories
- Git feed tests require `git` CLI and a temporary git repository
- Router integration tests require the tokio test runtime

---

### 2.0.6 Execution Steps {#execution-steps}

#### Step 0: Extend tugcast-core with new FeedId variants and types {#step-0}

**Commit:** `feat(tugcast-core): add Filesystem/Git FeedId variants and FsEvent/GitStatus types`

**References:** [D01] Extend FeedId, [D02] Shared types, Spec S01, Spec S02, Table T01, (#data-types-spec, #ws-protocol-extension, #symbols)

**Artifacts:**
- `crates/tugcast-core/src/protocol.rs` -- FeedId gains Filesystem (0x10) and Git (0x20) variants
- `crates/tugcast-core/src/types.rs` -- FsEvent, GitStatus, FileStatus types with serde derives
- `crates/tugcast-core/src/lib.rs` -- updated exports
- `crates/tugcast-core/Cargo.toml` -- add serde_json dependency

**Tasks:**
- [ ] Add `Filesystem = 0x10` and `Git = 0x20` variants to `FeedId` enum
- [ ] Update `FeedId::from_byte()` to handle 0x10 and 0x20
- [ ] Update existing tests that assert `FeedId::from_byte(0x10)` returns None
- [ ] Create `crates/tugcast-core/src/types.rs` with `FsEvent`, `GitStatus`, `FileStatus`
- [ ] Implement `FsEvent` as serde-tagged enum per Spec S01
- [ ] Implement `GitStatus` and `FileStatus` structs with Serialize, Deserialize, PartialEq per Spec S02
- [ ] Add `pub mod types` to `lib.rs` and re-export types
- [ ] Add `serde_json` dependency to tugcast-core Cargo.toml

**Tests:**
- [ ] Unit test: FeedId round-trip for Filesystem and Git variants
- [ ] Unit test: FsEvent serialization to JSON and deserialization back
- [ ] Unit test: GitStatus serialization to JSON and deserialization back
- [ ] Unit test: GitStatus PartialEq comparison (equal and unequal cases)
- [ ] Golden test: verify exact JSON output format for FsEvent variants

**Checkpoint:**
- [ ] `cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast-core` -- all tests pass
- [ ] `cargo build --workspace` succeeds (existing tugcast code compiles with extended FeedId)

**Rollback:**
- Revert commit, remove types.rs, restore original FeedId enum

**Commit after all checkpoints pass.**

---

#### Step 1: Implement filesystem tugfeed {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugcast): implement filesystem tugfeed with notify and gitignore filtering`

**References:** [D03] FS feed, Spec S01, Risk R01, (#data-types-spec, #assumptions, #constraints)

**Artifacts:**
- `crates/tugcast/src/feeds/filesystem.rs` -- FilesystemFeed implementing SnapshotFeed
- `crates/tugcast/src/feeds/mod.rs` -- add `pub mod filesystem`
- `crates/tugcast/Cargo.toml` -- add `notify` and `ignore` dependencies
- `Cargo.toml` (workspace) -- add `notify` and `ignore` to workspace dependencies

**Tasks:**
- [ ] Add `notify = "8"` and `ignore = "0.4"` to `[workspace.dependencies]` in root Cargo.toml
- [ ] Add `notify = { workspace = true }` and `ignore = { workspace = true }` to tugcast Cargo.toml
- [ ] Create `filesystem.rs` with `FilesystemFeed` struct holding: watch directory path, gitignore builder
- [ ] Implement `.gitignore`-aware filtering using `ignore::gitignore::GitignoreBuilder` to build a matcher from the project `.gitignore` file
- [ ] Use `notify::RecommendedWatcher` with default config (FSEvents on macOS, inotify on Linux). Note: `RecommendedWatcher` does not provide built-in debouncing -- `with_poll_interval` only affects the `PollWatcher` backend. Instead, implement manual debounce logic: collect raw events into a `Vec<FsEvent>` buffer and use `tokio::time::sleep(Duration::from_millis(100))` as a batch window. After each event, reset a 100ms timer; when the timer expires with no new events, flush the batch to the watch channel.
- [ ] Convert `notify::Event` variants to `FsEvent` enum values; compute relative paths from the watched directory
- [ ] Implement SnapshotFeed trait: `feed_id()` returns `FeedId::Filesystem`, `run()` receives raw events from the notify watcher via an `mpsc` channel, applies the 100ms manual debounce batch window, serializes the coalesced batch as a JSON array, and sends on the watch channel
- [ ] Add `pub mod filesystem` to feeds/mod.rs
- [ ] Use tracing for watcher lifecycle events

**Tests:**
- [ ] Integration test: create tempdir, start filesystem feed, create/modify/remove files, verify FsEvent batch arrives on watch channel
- [ ] Unit test: gitignore filtering excludes `target/`, `node_modules/` paths
- [ ] Unit test: relative path computation from watched directory
- [ ] Unit test: FsEvent::Renamed includes both `from` and `to` fields

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all filesystem feed tests pass
- [ ] `cargo build --workspace` succeeds with no warnings

**Rollback:**
- Revert commit, remove filesystem.rs, restore original Cargo.toml files

**Commit after all checkpoints pass.**

---

#### Step 2: Implement git tugfeed {#step-2}

**Depends on:** #step-0

**Commit:** `feat(tugcast): implement git tugfeed with porcelain v2 status polling`

**References:** [D04] Git feed, Spec S02, Risk R02, (#data-types-spec, #constraints)

**Artifacts:**
- `crates/tugcast/src/feeds/git.rs` -- GitFeed implementing SnapshotFeed; `parse_porcelain_v2` function
- `crates/tugcast/src/feeds/mod.rs` -- add `pub mod git`

**Tasks:**
- [ ] Create `git.rs` with `GitFeed` struct holding: repo directory path, polling interval (2s constant)
- [ ] Implement `parse_porcelain_v2(output: &str) -> GitStatus` to parse `git status --porcelain=v2 --branch` output:
  - Parse `# branch.oid <sha>` for head_sha
  - Parse `# branch.head <name>` for branch name (handle "detached" case)
  - Parse `# branch.ab +N -M` for ahead/behind counts
  - Parse `1 <XY> ...` lines for staged (X != '.') and unstaged (Y != '.') files
  - Parse `? <path>` lines for untracked files
  - Parse `2 <XY> ... <path>\t<origpath>` for renames
- [ ] Implement the polling loop: run `git status --porcelain=v2 --branch` in the repo directory, parse output, compare with previous `GitStatus` via `PartialEq`, send on watch channel only if changed
- [ ] Implement `git log -1 --format=%s` for head_message on each poll
- [ ] Implement SnapshotFeed trait: `feed_id()` returns `FeedId::Git`, `run()` polls at 2-second interval with CancellationToken
- [ ] Add `pub mod git` to feeds/mod.rs
- [ ] Handle git command failures gracefully: log error, skip this poll cycle, retry next interval

**Tests:**
- [ ] Unit test: parse_porcelain_v2 with typical output (branch, staged, unstaged, untracked)
- [ ] Unit test: parse_porcelain_v2 with detached HEAD
- [ ] Unit test: parse_porcelain_v2 with no changes (clean repo)
- [ ] Unit test: parse_porcelain_v2 with renamed files
- [ ] Unit test: parse_porcelain_v2 with ahead/behind counts
- [ ] Integration test: create temp git repo, make changes, verify GitFeed produces correct snapshots
- [ ] Unit test: diff comparison skips send when GitStatus is unchanged

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all git feed tests pass
- [ ] `cargo build --workspace` succeeds with no warnings

**Rollback:**
- Revert commit, remove git.rs

**Commit after all checkpoints pass.**

---

#### Step 3: Extend feed router for snapshot feeds {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugcast): extend feed router to multiplex snapshot feeds on WebSocket`

**References:** [D07] Heartbeat disconnect, [D08] Snapshot integration, Table T01, (#ws-protocol-extension, #strategy)

**Artifacts:**
- `crates/tugcast/src/router.rs` -- FeedRouter extended with watch channels; handle_client updated
- `crates/tugcast/src/main.rs` -- create filesystem and git feeds, wire watch channels to router
- `crates/tugcast/src/integration_tests.rs` -- update `build_test_app()` helper for new FeedRouter::new() signature

**Tasks:**
- [ ] Add `snapshot_watches: Vec<watch::Receiver<Frame>>` field to `FeedRouter` (or accept watch receivers during construction)
- [ ] Update `FeedRouter::new()` to accept a `Vec<watch::Receiver<Frame>>` for snapshot feeds
- [ ] In `handle_client`, extend the Live-state select loop to add `changed()` branches for each watch receiver:
  - When a watch channel receives an update, encode the frame and send it on the WebSocket
  - On initial connect, send the current value of each watch channel immediately (the watch receiver's `borrow()` holds the latest value)
- [ ] Update `main.rs`:
  - Create `watch::channel(Frame)` for filesystem feed
  - Create `watch::channel(Frame)` for git feed
  - Start FilesystemFeed and GitFeed in background tasks with their respective watch senders
  - Pass watch receivers to FeedRouter
- [ ] Update `build_test_app()` in `integration_tests.rs` (line 23) to pass an empty `Vec::new()` as snapshot watches to `FeedRouter::new()`, matching the new 5-argument signature. The existing auth/WebSocket integration tests do not exercise snapshot feeds, so empty watches are correct.
- [ ] Verify heartbeat timeout logic still works correctly in the extended select loop
- [ ] Ensure the per-client state machine still handles BOOTSTRAP correctly (snapshot feeds send latest value on reconnect automatically via watch semantics)

**Tests:**
- [ ] Integration test: connect WebSocket, verify filesystem and git snapshot frames arrive
- [ ] Integration test: verify watch channel latest-value semantics (slow client gets current, not stale)
- [ ] Unit test: FeedRouter construction with snapshot watches
- [ ] Integration test: heartbeat timeout still fires correctly with snapshot feeds active
- [ ] Unit test: existing integration tests in `integration_tests.rs` still pass with updated FeedRouter signature

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all router tests pass (including new snapshot feed tests)
- [ ] `cargo build --workspace` succeeds with no warnings

**Rollback:**
- Revert commit, restore original router.rs and main.rs

**Commit after all checkpoints pass.**

---

#### Step 4: Update tugdeck protocol and add frontend card files {#step-4}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add FeedId constants and files/git/stats card implementations`

**References:** [D01] Extend FeedId, [D06] Stats stub, Spec S01, Spec S02, Table T01, (#data-types-spec, #symbols)

**Artifacts:**
- `tugdeck/src/protocol.ts` -- add FILESYSTEM and GIT FeedId constants
- `tugdeck/src/cards/files-card.ts` -- FilesCard implementing TugCard
- `tugdeck/src/cards/git-card.ts` -- GitCard implementing TugCard
- `tugdeck/src/cards/stats-card.ts` -- StatsCard implementing TugCard (stub)

**Tasks:**
- [ ] Add `FILESYSTEM: 0x10` and `GIT: 0x20` to the FeedId constants object in protocol.ts
- [ ] Update `FeedIdValue` type to include the new constants
- [ ] Implement `files-card.ts`:
  - `feedIds: [FeedId.FILESYSTEM]`
  - `mount()`: create a scrollable container with a header ("Files") and event list
  - `onFrame()`: parse JSON payload as `FsEvent[]` array, render each event with icon/color (green=Created, yellow=Modified, red=Removed, blue=Renamed), prepend to event list, cap at 100 visible entries
  - `onResize()`: no-op (CSS handles scroll)
  - `destroy()`: remove DOM elements
- [ ] Implement `git-card.ts`:
  - `feedIds: [FeedId.GIT]`
  - `mount()`: create container with header ("Git"), branch badge, ahead/behind counters, file sections
  - `onFrame()`: parse JSON payload as `GitStatus`, update branch name, ahead/behind badges, render staged (green), unstaged (yellow), untracked (grey) file lists
  - `onResize()`: no-op (CSS handles scroll)
  - `destroy()`: remove DOM elements
- [ ] Implement `stats-card.ts`:
  - `feedIds: []` (empty -- no feed subscription)
  - `mount()`: create container with header ("Stats") and centered "Coming soon" message
  - `onFrame()`: no-op
  - `onResize()`: no-op
  - `destroy()`: remove DOM elements

**Tests:**
- [ ] Unit test: TypeScript compilation succeeds with no errors
- [ ] Unit test: FeedId constants include FILESYSTEM (0x10) and GIT (0x20)

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors (after adding imports)
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck)

**Rollback:**
- Revert commit, restore original protocol.ts

**Commit after all checkpoints pass.**

---

#### Step 5: Implement CSS Grid layout and drag-handle resize {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): implement CSS Grid multi-card layout with drag-handle resize`

**References:** [D05] Grid layout, [D06] Stats stub, Spec S03, (#grid-layout-spec, #strategy)

**Artifacts:**
- `tugdeck/styles/deck.css` -- CSS Grid layout with named areas, drag handle styles
- `tugdeck/styles/cards.css` -- per-card styling for files, git, stats cards
- `tugdeck/src/deck.ts` -- rewritten DeckManager with grid layout and drag handles
- `tugdeck/index.html` -- updated DOM structure with grid container and named card slots
- `tugdeck/src/main.ts` -- updated to create all four cards and register with deck

**Tasks:**
- [ ] Create `tugdeck/styles/deck.css`:
  - `.deck-grid`: CSS Grid with `grid-template-columns: 2fr 1fr` and `grid-template-rows: 1fr 1fr 1fr`
  - Named grid areas: terminal (spans 3 rows), git, files, stats
  - `.drag-handle-col`: vertical drag handle between columns (width: 6px, cursor: col-resize)
  - `.drag-handle-row`: horizontal drag handles between right-column rows (height: 6px, cursor: row-resize)
  - Minimum card dimensions: 100px
- [ ] Create `tugdeck/styles/cards.css`:
  - `.card-header`: card title bar styling (height, background, font)
  - `.files-card .event-list`: scrollable list with monospace font
  - `.files-card .event-created`: green indicator
  - `.files-card .event-modified`: yellow indicator
  - `.files-card .event-removed`: red indicator
  - `.files-card .event-renamed`: blue indicator
  - `.git-card .branch-badge`: branch name badge
  - `.git-card .ahead-behind`: ahead/behind counters
  - `.git-card .file-section`: staged/unstaged/untracked sections
  - `.stats-card .placeholder`: centered "Coming soon" text
- [ ] Rewrite `deck.ts` DeckManager:
  - Create grid container element with `.deck-grid` class
  - Create named slot elements for each card (terminal, files, git, stats)
  - Mount cards into their respective slots
  - Create drag handle elements between columns and rows
  - Implement pointer event handlers for drag handles:
    - `pointerdown`: capture pointer, record start position and initial column/row sizes
    - `pointermove`: calculate delta, update grid-template-columns or grid-template-rows, enforce 100px minimums
    - `pointerup`: release pointer, finalize sizes
  - Dispatch frames to cards by feed ID (same as Phase 1)
  - Propagate resize events to all cards when grid changes
- [ ] Update `index.html`:
  - Replace `#terminal-container` with `#deck-container`
  - Add stylesheet links for deck.css and cards.css
  - Remove inline styles for full-viewport terminal
- [ ] Update `main.ts`:
  - Create deck with `#deck-container`
  - Create and register TerminalCard, FilesCard, GitCard, StatsCard
  - Connect and start
- [ ] Update `crates/tugcast/build.rs` to copy CSS files to the output directory using `std::fs::copy`:
  - `fs::copy("../../tugdeck/styles/deck.css", format!("{}/tugdeck/deck.css", out_dir))`
  - `fs::copy("../../tugdeck/styles/cards.css", format!("{}/tugdeck/cards.css", out_dir))`
  - Add `cargo:rerun-if-changed=../../tugdeck/styles/` so cargo re-runs the build script when CSS files change (without this, embedded assets become stale during development)

**Tests:**
- [ ] Unit test: TypeScript compilation succeeds
- [ ] Manual test: drag handles resize cards, minimum dimension enforced

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles all new assets)
- [ ] Opening tugcast in browser shows 4-card grid layout with terminal, files, git, and stats slots

**Rollback:**
- Revert commit, restore Phase 1 deck.ts, main.ts, index.html

**Commit after all checkpoints pass.**

---

#### Step 6: End-to-end integration and acceptance {#step-6}

**Depends on:** #step-3, #step-5

**Commit:** `feat(tugcast): phase 2 end-to-end integration tests and acceptance verification`

**References:** [D01] Extend FeedId, [D03] FS feed, [D04] Git feed, [D05] Grid layout, [D07] Heartbeat, [D08] Snapshot integration, (#success-criteria, #scope)

**Artifacts:**
- Integration tests in `crates/tugcast/tests/` or `crates/tugcast/src/integration_tests.rs`
- Updated documentation comments on all new public types and functions

**Tasks:**
- [ ] Implement end-to-end test: boot tugcast with test tmux session and project directory, verify terminal, filesystem, and git frames arrive over WebSocket
- [ ] Implement filesystem integration test: create files in the watched directory, verify FsEvent frames arrive with correct relative paths
- [ ] Implement git integration test: make changes in a test git repo, verify GitStatus snapshot updates within 2 seconds
- [ ] Implement gitignore filtering test: create files in `target/` and `node_modules/`, verify they are excluded
- [ ] Implement heartbeat timeout test: connect WebSocket, stop sending heartbeats, verify connection is closed after 45 seconds
- [ ] Implement snapshot-on-connect test: connect new WebSocket client, verify latest filesystem and git snapshots are sent immediately
- [ ] Verify all success criteria:
  - Filesystem events appear within 200ms of OS event (debounce + transmission)
  - Git status refreshes every 2 seconds
  - `.gitignore` patterns are respected
  - `cargo build --workspace` and `cargo nextest run` pass with zero warnings
  - `cargo clippy --workspace -- -D warnings` passes
- [ ] Add documentation comments to all new public types and functions across tugcast-core and tugcast

**Tests:**
- [ ] Integration test: full multi-feed WebSocket round-trip
- [ ] Integration test: filesystem event delivery
- [ ] Integration test: git status polling
- [ ] Integration test: gitignore filtering
- [ ] Integration test: heartbeat timeout disconnection
- [ ] Integration test: snapshot-on-connect for new clients

**Checkpoint:**
- [ ] `cargo build --workspace` succeeds with no warnings
- [ ] `cargo nextest run` -- all tests pass (workspace-wide)
- [ ] `cargo clippy --workspace -- -D warnings` passes
- [ ] Manual test: launch `cargo run -p tugcast -- --dir .`, open auth URL, see 4-card layout
- [ ] Manual test: create/modify files, see events in files card
- [ ] Manual test: make git changes (stage, commit), see updates in git card
- [ ] Manual test: drag handles resize cards, terminal remains functional
- [ ] Manual test: stats card shows "Coming soon" placeholder

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 2.0.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A multi-card tugdeck dashboard with CSS Grid layout, filesystem event log, git status panel, stub stats card, and custom drag-handle resize -- three new tugfeeds on the backend, four tugcard slots on the frontend. End-to-end proof of the multi-feed architecture.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugcast` produces a binary with multi-card tugdeck embedded
- [ ] Running `tugcast --dir /path/to/project` shows a 4-card grid layout in the browser
- [ ] Terminal card continues to work identically to Phase 1 (keystrokes, output, resize)
- [ ] Files card shows filesystem events (create, modify, remove, rename) in real-time
- [ ] Git card shows current branch, ahead/behind, staged/unstaged/untracked files
- [ ] Stats card shows "Coming soon" placeholder
- [ ] Drag handles allow resizing adjacent cards with 100px minimum enforced
- [ ] `.gitignore` patterns filter filesystem events (no `target/`, `node_modules/` events)
- [ ] Git status refreshes every 2 seconds
- [ ] WebSocket heartbeat timeout actively closes stale connections after 45 seconds
- [ ] `cargo clippy --workspace -- -D warnings` passes with zero warnings
- [ ] All unit and integration tests pass

**Acceptance tests:**
- [ ] Integration test: filesystem events arrive within 200ms
- [ ] Integration test: git status snapshot updates every 2 seconds
- [ ] Integration test: gitignore filtering excludes target/ paths
- [ ] Integration test: heartbeat timeout disconnects stale clients
- [ ] Integration test: new clients receive latest snapshots immediately

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3: Stats tugfeed (0x30) with pluggable collectors
- [ ] Phase 3: Reconnection UI ("Disconnected" banner, auto-retry)
- [ ] Phase 3: Layout persistence in localStorage
- [ ] Phase 3: WebGL renderer for terminal card
- [ ] Phase 3: Tugcard collapse/expand
- [ ] Phase 3: Adaptive git polling (500ms acceleration on FS events)
- [ ] Phase 3: Tree view in files card (on-demand via control feed)

| Checkpoint | Verification |
|------------|--------------|
| Crates compile | `cargo build --workspace` with no warnings |
| All tests pass | `cargo nextest run` |
| Clippy clean | `cargo clippy --workspace -- -D warnings` |
| Manual smoke test | Launch tugcast, open browser, see 4-card layout, verify all feeds work |

**Commit after all checkpoints pass.**
