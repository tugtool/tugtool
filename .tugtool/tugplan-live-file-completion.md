<!-- tugplan-skeleton v2 -->

## Live File Completion Provider {#live-file-completion}

**Purpose:** Replace the hardcoded `TYPEAHEAD_FILES` stub with live project files from a shared FileWatcher service in tugcast, delivered via a new FILETREE snapshot feed (0x11) and consumed by FileTreeStore in tugdeck.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

T3.2 established the `CompletionProvider` interface on tug-prompt-input, and T3.3 Step 3 created `file-completion-provider.ts` with a `createFileCompletionProvider(files)` factory that accepts any `string[]`. The `@` trigger currently uses a hardcoded `TYPEAHEAD_FILES` array in the gallery card. The missing piece is a live data source — a service that walks the project tree, keeps the file list current as files are created/removed/renamed, and delivers the list to tugdeck over WebSocket.

We own the file index ourselves rather than depending on Claude Code. Claude Code's file context is optimized for AI model needs, not human completion UX — its list may exclude files, change shape between versions, or lag behind actual filesystem state. We already have the building blocks: `cwd` from `system_metadata` gives the project root, the `notify` crate watches for changes, and the `ignore` crate handles `.gitignore`. We just need a service that walks the tree once and keeps the list current.

#### Strategy {#strategy}

- Extract the `notify` watcher and `.gitignore` handling from `filesystem.rs` into a shared **FileWatcher** service that both FILESYSTEM and FILETREE feeds consume.
- Replace `tokio::sync::watch` (single-value, latest-wins) with `tokio::sync::broadcast` for fan-out to multiple consumers with guaranteed delivery.
- Add a new FILETREE snapshot feed (0x11) that maintains a `BTreeSet<String>` of relative file paths and emits complete-list snapshots.
- Add FileTreeStore in tugdeck — L02-compliant, exposes `getFileCompletionProvider()`.
- Wire the gallery card's `@` trigger to live project files when a connection is available.
- Keep FILESYSTEM wire format and behavior unchanged — the refactor is invisible to existing consumers.

#### Success Criteria (Measurable) {#success-criteria}

- FileWatcher walks the project tree and broadcasts `Vec<FsEvent>` batches to all subscribers (`cd tugrust && cargo nextest run` passes with FileWatcher unit tests)
- FILESYSTEM feed produces identical wire format after refactoring to consume FileWatcher broadcast (existing integration test passes unchanged)
- FILETREE feed (0x11) sends a complete file list snapshot on connect and updates on file creates/removes/renames (`cargo nextest run` passes with FILETREE tests)
- FileTreeStore in tugdeck parses FILETREE snapshots and exposes `getFileCompletionProvider()` (`cd tugdeck && bun test` passes)
- Gallery card `@` trigger shows live project files when connected, falls back to hardcoded list when offline

#### Scope {#scope}

1. FileWatcher shared service: single `notify` watcher with `WalkBuilder`-grade nested `.gitignore`, broadcast to multiple consumers
2. FILESYSTEM feed refactored to consume FileWatcher broadcast (wire format unchanged)
3. FILETREE feed (0x11): `SnapshotFeed` that sends complete file list snapshots
4. `FileTreeSnapshot` type in tugcast-core
5. `FeedId::FILETREE = 0x11` in both Rust and TypeScript protocol files
6. FileTreeStore in tugdeck (L02-compliant)
7. Gallery card integration: live `@` provider when connected, fallback when offline

#### Non-goals (Explicitly out of scope) {#non-goals}

- Fuzzy or path-segment-aware completion matching algorithm (follow-on work once data pipeline is operational)
- Delta encoding for snapshot payloads (measure first, optimize later)
- UI hint for truncated file lists (future enhancement)
- tug-prompt-entry integration (T3.4 scope)

#### Dependencies / Prerequisites {#dependencies}

- `ignore` crate already in tugcast's `Cargo.toml` — `WalkBuilder` is available
- `tokio::sync::broadcast` already used throughout tugcast — no new workspace dependency
- `notify` crate already in tugcast's `Cargo.toml`
- `createFileCompletionProvider(files)` factory already exists in `file-completion-provider.ts`
- `FeedStore` class and `getConnection()` already exist in tugdeck

#### Constraints {#constraints}

- One `notify` watcher per directory tree — no duplicated kernel events
- 50,000 file cap for safety in monorepos
- Warnings are errors in the Rust workspace (`-D warnings`)
- All stores must be L02-compliant (`subscribe`/`getSnapshot` for `useSyncExternalStore`)
- Providers must be L07 stable refs — return a stable closure that reads current state on each call (same pattern as `getCommandCompletionProvider()`)

#### Assumptions {#assumptions}

- FileWatcher will be a plain struct (not implementing `SnapshotFeed` or `StreamFeed`) — it is a shared service, not a feed itself
- FileTreeFeed implements `SnapshotFeed` (`run` takes `watch::Sender<Frame>`) — consistent with all other snapshot feeds
- `FeedId::FILETREE = 0x11` fits in the 0x10 snapshot feed range alongside `FILESYSTEM = 0x10`
- `FileTreeSnapshot` type goes in `tugcast-core/src/types.rs` alongside `FsEvent`, `GitStatus`, etc.
- The gallery card's module-level `FileTreeStore` instance follows the same never-disposed pattern as `_metadataStore` and `_historyStore`
- The 50,000 file cap and truncated flag are implemented in `FileWatcher::walk()`, not in `FileTreeFeed`
- When FileWatcher sees a `.gitignore` change, it rebuilds the matcher before filtering subsequent events in the same batch; the `.gitignore` change event itself is still broadcast
- FileWatcher owns all conversion — broadcasts `Vec<FsEvent>`, `FilesystemFeed` only serializes to wire format
- FILETREE is added to the existing FeedStore's `feedIds` array in `buildGalleryStores()` and passed to FileTreeStore; FILETREE comes from tugcast directly (not tugcode), available whenever there is a connection

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Broadcast lag in monorepos | med | low | 256-slot buffer, 100ms debounce, `Lagged` error triggers re-walk | If `Lagged` errors appear in production logs |
| Walk performance on large trees | low | low | `WalkBuilder` walks 100k files in ~50ms on SSD; 50k cap limits snapshot size | If initial snapshot takes >500ms |
| FILESYSTEM regression | high | low | Existing integration test runs unchanged; wire format is preserved | If any FILESYSTEM consumer breaks |

**Risk R01: Broadcast channel Lagged error** {#r01-broadcast-lagged}

- **Risk:** If a consumer falls behind by 256 batches (unlikely at 100ms debounce = 25+ seconds of sustained activity without processing), it receives a `Lagged` error.
- **Mitigation:** FILETREE feed can re-walk the directory to recover full state. FILESYSTEM feed can log and continue (it already uses latest-wins semantics).
- **Residual risk:** A brief gap in FILESYSTEM events during recovery. Acceptable because FILESYSTEM events are informational, not transactional.

---

### Design Decisions {#design-decisions}

#### [D01] Shared FileWatcher, not duplicate watchers (DECIDED) {#d01-shared-filewatcher}

**Decision:** Extract the `notify` watcher and `.gitignore` handling from `filesystem.rs` into a shared `FileWatcher` service. Both FILESYSTEM and FILETREE feeds receive a `broadcast::Sender` clone and call `subscribe()` inside `run()` to obtain a fresh `Receiver`.

**Rationale:**
- `notify` uses kernel-level facilities (FSEvents on macOS, inotify on Linux). One watcher per directory tree is the right number. Two watchers on the same tree would receive duplicate kernel events and double the syscall overhead.
- Centralizes `.gitignore` handling — both feeds get `WalkBuilder`-grade nested gitignore support.

**Implications:**
- FileWatcher is a plain struct, not a feed. It owns the `notify::RecommendedWatcher` and the gitignore matcher.
- FileWatcher owns all event conversion: it receives raw `notify::Event` values, converts them to `Vec<FsEvent>`, and broadcasts the result. `FilesystemFeed` only serializes to wire format.
- `FilesystemFeed` no longer owns the watcher or gitignore logic — its constructor changes to accept a `broadcast::Sender<Vec<FsEvent>>` and calls `sender.subscribe()` inside `run()` to obtain a fresh `Receiver`.

#### [D02] Broadcast channel, not watch (DECIDED) {#d02-broadcast-channel}

**Decision:** Use `tokio::sync::broadcast` to fan out `Vec<FsEvent>` batches from FileWatcher to all subscribers.

**Rationale:**
- `watch` is single-value (latest-wins) — fine for a single consumer, but drops intermediate values when multiple consumers read at different rates.
- `broadcast` guarantees every receiver sees every message (up to buffer capacity). Both FILESYSTEM and FILETREE see every event batch.

**Implications:**
- Buffer capacity of 256 slots. Each slot holds one debounced batch.
- Consumers must handle `RecvError::Lagged` — re-walk to recover.

#### [D03] Separate FILETREE feed (0x11), not extension of FILESYSTEM (DECIDED) {#d03-separate-filetree}

**Decision:** FILETREE (0x11) is a separate `SnapshotFeed`, not an extension of FILESYSTEM (0x10).

**Rationale:**
- FILESYSTEM emits change events (`Created`/`Modified`/`Removed`). FILETREE emits complete file list snapshots. Different semantics, different consumers.
- `SnapshotFeed` delivers the latest value on connect — new clients get the full file list immediately.

**Implications:**
- New `FeedId::FILETREE = 0x11` in both Rust and TypeScript protocol files.
- FILETREE has its own `watch::Sender<Frame>` and registration in `main.rs`.

#### [D04] SnapshotFeed for FILETREE (DECIDED) {#d04-snapshot-feed}

**Decision:** `FileTreeFeed` implements the `SnapshotFeed` trait. New clients receive the full file list immediately on connect.

**Rationale:**
- Completion UX requires the file list to be available instantly — the user should not have to wait for filesystem activity before `@` works.
- `SnapshotFeed` is the established pattern for this (GitFeed, stats feeds all use it).

**Implications:**
- `FileTreeFeed::run()` calls `self.event_tx.subscribe()` to get a `Receiver`, sends the initial snapshot from `FileWatcher::walk()` immediately, then loops on `rx.recv()` for updates.

#### [D05] Paths are relative to root (DECIDED) {#d05-relative-paths}

**Decision:** The `files` array in `FileTreeSnapshot` contains paths relative to the project root. The `root` field provides the absolute path for resolution when needed.

**Rationale:**
- Shorter, cleaner for display in completion items.
- Consistent with FILESYSTEM events which already use relative paths.

**Implications:**
- `FileWatcher::walk()` strips the watch directory prefix from all paths.
- The `root` field in the snapshot is the same as tugcast's `--dir`.

#### [D06] FileWatcher owns gitignore rebuild on change (DECIDED) {#d06-gitignore-rebuild}

**Decision:** When FileWatcher sees a `.gitignore` Created or Modified event, it rebuilds its gitignore matcher by re-reading all `.gitignore` files via `WalkBuilder` before filtering subsequent events in the same batch. The `.gitignore` change event itself is still broadcast.

**Rationale:**
- Ensures newly added or updated ignore rules take effect immediately.
- Rebuild is cheap (reading a few small text files) and `.gitignore` changes are infrequent.

**Implications:**
- FileWatcher must detect `.gitignore` events early in batch processing and rebuild before filtering.

#### [D07] Stable closure provider, same pattern as getCommandCompletionProvider (DECIDED) {#d07-provider-caching}

**Decision:** `getFileCompletionProvider()` returns a single stable closure that reads the current `this._snapshot.files` on every invocation (same pattern as `SessionMetadataStore.getCommandCompletionProvider()`). Internally the store caches the last `files` reference and the derived `CompletionItem[]` array so that `createFileCompletionProvider()` is only called when `snapshot.files` changes by reference. The outer function reference itself never changes.

**Rationale:**
- Consistent with `getCommandCompletionProvider()` — the function reference is stable, but data is always fresh because the closure reads `this._snapshot` at call time.
- Module-level assignment (`const provider = store.getFileCompletionProvider()`) works correctly: the assigned reference is stable and always delegates to current state.
- Internal caching of the derived `CompletionItem[]` avoids unnecessary `createFileCompletionProvider()` rebuilds while keeping the outer reference stable.

**Implications:**
- `getFileCompletionProvider()` is called once; the returned closure is used for the lifetime of the store.
- The closure internally checks if `this._snapshot.files` reference has changed since the last call and rebuilds the cached `CompletionItem[]` only when it has.
- No `_cachedProvider` replacement — the provider function is created once in the constructor or on first call and never replaced.

#### [D08] FILETREE added to existing FeedStore in gallery (DECIDED) {#d08-gallery-feedstore}

**Decision:** Add `FeedId.FILETREE` to the existing FeedStore's `feedIds` array in `buildGalleryStores()`. FILETREE comes from tugcast directly (not tugcode), available whenever there is a connection — existing `getConnection()` guard works.

**Rationale:**
- Reuses the existing FeedStore/connection pattern established by SessionMetadataStore.
- No new connection or subscription infrastructure needed.

**Implications:**
- `buildGalleryStores()` returns a `fileTreeStore` alongside `metadataStore` and `historyStore`.
- `FileTreeStore` constructor takes the FeedStore and subscribes to `FeedId.FILETREE`.

---

### Specification {#specification}

#### Payload Format {#payload-format}

**Spec S01: FILETREE snapshot payload** {#s01-filetree-payload}

```json
{
  "files": ["Cargo.toml", "src/lib.rs", "src/main.rs"],
  "root": "/Users/ken/project",
  "truncated": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `files` | `string[]` | Flat array of relative paths (relative to `root`), files only (no directories), sorted lexicographically |
| `root` | `string` | Absolute path to the project root (same as tugcast's `--dir`) |
| `truncated` | `bool` | `true` if file count exceeded the 50,000 cap and the list was clipped |

#### Internal Architecture {#internal-architecture}

**Spec S02: FileWatcher service** {#s02-filewatcher}

```
notify watcher ──> FileWatcher (shared service)
                       │
                       ├── walk(): initial directory walk via ignore::WalkBuilder
                       │           returns BTreeSet<String> of relative file paths
                       │           respects nested .gitignore, skips .git/, cap 50k
                       │
                       ├── run(): starts notify watcher, debounces (100ms),
                       │          converts to Vec<FsEvent>, filters via gitignore,
                       │          broadcasts batches to all subscribers
                       │
                       └── broadcast::Sender<Vec<FsEvent>> (fan-out to feeds)
                               │
                               ├── FilesystemFeed: serializes batches to wire format
                               │
                               └── FileTreeFeed: applies Created/Removed/Renamed
                                                 to BTreeSet, emits snapshots
```

**Spec S03: FileTreeFeed event processing** {#s03-filetree-processing}

| FsEvent kind | FileTreeFeed action |
|-------------|---------------------|
| `Created` | Insert path into BTreeSet |
| `Removed` | Remove path from BTreeSet |
| `Renamed` | Remove `from`, insert `to` |
| `Modified` | **Ignored** — file saves do not change the file list |

After applying changes from a batch, if the BTreeSet actually changed, serialize and send an updated snapshot. Debounce: 200ms window after receiving events before sending snapshot (batches rapid sequences like `git checkout`).

#### Public API Surface {#public-api}

**Spec S04: FileTreeStore TypeScript API** {#s04-filetree-store-api}

```typescript
class FileTreeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileTreeSnapshot;
  getFileCompletionProvider(): CompletionProvider;
  dispose(): void;
}

interface FileTreeSnapshot {
  files: string[];
  root: string;
  truncated: boolean;
}
```

- L02-compliant: `subscribe`/`getSnapshot` for `useSyncExternalStore`
- `getFileCompletionProvider()`: returns a single stable closure (same pattern as `SessionMetadataStore.getCommandCompletionProvider()`). The closure reads `this._snapshot.files` on every call; internally caches the derived `CompletionItem[]` and rebuilds only when the `files` reference changes ([D07]). Called once; the returned function reference never changes.
- `dispose()`: unsubscribes from FeedStore

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/feeds/file_watcher.rs` | Shared FileWatcher service: owns notify watcher, gitignore, walk, broadcast |
| `tugrust/crates/tugcast/src/feeds/filetree.rs` | FileTreeFeed: SnapshotFeed that maintains BTreeSet and emits file list snapshots |
| `tugdeck/src/lib/filetree-store.ts` | FileTreeStore: L02-compliant store consuming FILETREE feed |
| `tugdeck/src/__tests__/filetree-store.test.ts` | Unit tests for FileTreeStore |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FileWatcher` | struct | `tugrust/crates/tugcast/src/feeds/file_watcher.rs` | Owns `notify::RecommendedWatcher`, gitignore matcher, `broadcast::Sender<Vec<FsEvent>>` |
| `FileWatcher::new()` | fn | same | Constructor: takes `watch_dir: PathBuf` |
| `FileWatcher::walk()` | fn | same | Initial walk via `WalkBuilder`, returns `BTreeSet<String>`, 50k cap |
| `FileWatcher::run()` | fn | same | Starts watcher, debounces, converts, filters, broadcasts. Takes `broadcast::Sender<Vec<FsEvent>>`, `CancellationToken` |
| `FileTreeFeed` | struct | `tugrust/crates/tugcast/src/feeds/filetree.rs` | Implements `SnapshotFeed` |
| `FileTreeFeed::new()` | fn | same | Takes `watch_dir: PathBuf`, initial `BTreeSet<String>`, `broadcast::Sender<Vec<FsEvent>>` |
| `FileTreeSnapshot` | struct | `tugrust/crates/tugcast-core/src/types.rs` | `files: Vec<String>`, `root: String`, `truncated: bool` |
| `FeedId::FILETREE` | const | `tugrust/crates/tugcast-core/src/protocol.rs` | `Self(0x11)` |
| `FILETREE` | const | `tugdeck/src/protocol.ts` | `0x11` in FeedId object |
| `FileTreeStore` | class | `tugdeck/src/lib/filetree-store.ts` | L02-compliant store |
| `FileTreeSnapshot` | interface | same | `{ files: string[], root: string, truncated: boolean }` |
| `FilesystemFeed::new()` | fn (modified) | `tugrust/crates/tugcast/src/feeds/filesystem.rs` | Constructor changes to accept `broadcast::Sender<Vec<FsEvent>>` (subscribes inside `run()`) |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test FileWatcher walk/filter, FileTreeFeed BTreeSet updates, FileTreeStore snapshot parsing | Core logic, edge cases |
| **Integration** | Test FILESYSTEM wire format unchanged after refactor, FILETREE end-to-end with temp directory | End-to-end data flow |

---

### Execution Steps {#execution-steps}

#### Step 1: Add FeedId::FILETREE and FileTreeSnapshot type {#step-1}

**Commit:** `feat(tugcast-core): add FeedId::FILETREE (0x11) and FileTreeSnapshot type`

**References:** [D03] Separate FILETREE feed, [D05] Relative paths, Spec S01, (#payload-format, #symbols)

**Artifacts:**
- `FeedId::FILETREE = Self(0x11)` in `tugrust/crates/tugcast-core/src/protocol.rs`
- `FileTreeSnapshot` struct in `tugrust/crates/tugcast-core/src/types.rs`
- `FILETREE: 0x11` in `tugdeck/src/protocol.ts`
- `name()` match arm for FILETREE in protocol.rs `FeedId::name()`

**Tasks:**
- [ ] Add `pub const FILETREE: Self = Self(0x11)` to `FeedId` in `protocol.rs`, in the snapshot feeds section after FILESYSTEM
- [ ] Add match arm `Self::FILETREE => Some("FileTree")` to `FeedId::name()`
- [ ] Add `FileTreeSnapshot` struct to `tugcast-core/src/types.rs` with `#[derive(Debug, Clone, Serialize, Deserialize)]` and fields: `files: Vec<String>`, `root: String`, `truncated: bool`
- [ ] Add `FILETREE: 0x11` to the FeedId object in `tugdeck/src/protocol.ts`, in the snapshot feeds section after FILESYSTEM
- [ ] Add assertion `assert_eq!(FeedId::FILETREE.as_byte(), 0x11)` to the existing `test_known_feedid_byte_values` test in `protocol.rs`

**Tests:**
- [ ] Existing `test_known_feedid_byte_values` test extended with FILETREE assertion

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast-core`

---

#### Step 2: Extract FileWatcher shared service {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugcast): extract FileWatcher shared service from filesystem.rs`

**References:** [D01] Shared FileWatcher, [D02] Broadcast channel, [D06] Gitignore rebuild, Spec S02, (#internal-architecture, #symbols)

**Artifacts:**
- New file `tugrust/crates/tugcast/src/feeds/file_watcher.rs`
- `pub mod file_watcher` added to `tugrust/crates/tugcast/src/feeds/mod.rs`

**Tasks:**
- [ ] Create `tugrust/crates/tugcast/src/feeds/file_watcher.rs` with `FileWatcher` struct
- [ ] Move `convert_event()`, `deduplicate_batch()`, `build_gitignore()`, `is_ignored()`, `is_fsevent_ignored()`, `DEBOUNCE_MILLIS`, `POLL_MILLIS` from `filesystem.rs` into `file_watcher.rs` (make public as needed for FileWatcher and tests)
- [ ] Implement `FileWatcher::new(watch_dir: PathBuf)` — stores watch_dir
- [ ] Implement `FileWatcher::walk(&self) -> (BTreeSet<String>, bool)` — uses `ignore::WalkBuilder` for nested `.gitignore` support, returns sorted set of relative file paths (files only, skips `.git/`), second return value is `truncated` (true if count exceeded 50,000 cap)
- [ ] Implement `FileWatcher::run(self, tx: broadcast::Sender<Vec<FsEvent>>, cancel: CancellationToken)` — creates `notify::RecommendedWatcher`, debounces events (100ms), converts via `convert_event()`, filters via gitignore, detects `.gitignore` changes and rebuilds matcher, broadcasts `Vec<FsEvent>` batches
- [ ] Add `pub mod file_watcher` to `feeds/mod.rs`
- [ ] Add unit tests in `#[cfg(test)]` module: `walk()` with temp directory containing files and `.gitignore`, verify correct filtering and relative paths; `walk()` respects nested `.gitignore` overrides; `convert_event()` tests (moved from filesystem.rs); `deduplicate_batch()` tests (moved from filesystem.rs)

**Tests:**
- [ ] `walk()` returns correct relative paths, respects nested `.gitignore`, enforces 50k cap
- [ ] `convert_event()` and `deduplicate_batch()` unit tests (moved from filesystem.rs)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast`

---

#### Step 3: Refactor FilesystemFeed to consume FileWatcher broadcast {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugcast): FilesystemFeed consumes FileWatcher broadcast`

**References:** [D01] Shared FileWatcher, [D02] Broadcast channel, (#internal-architecture, #symbols)

**Artifacts:**
- Modified `tugrust/crates/tugcast/src/feeds/filesystem.rs` — constructor takes `broadcast::Sender<Vec<FsEvent>>`, `run()` calls `sender.subscribe()` then receives batches and serializes to wire format

**Tasks:**
- [ ] Change `FilesystemFeed::new()` to accept `watch_dir: PathBuf` and `event_tx: broadcast::Sender<Vec<FsEvent>>`
- [ ] Rewrite `FilesystemFeed::run()`: call `self.event_tx.subscribe()` to get a `Receiver`, then loop on `rx.recv()`, serialize each `Vec<FsEvent>` batch to JSON, send as `Frame::new(FeedId::FILESYSTEM, json)` via the `watch::Sender<Frame>`. Handle `RecvError::Lagged` by logging a warning and continuing.
- [ ] Remove `convert_event`, `deduplicate_batch`, `build_gitignore`, `is_ignored`, `is_fsevent_ignored`, `DEBOUNCE_MILLIS`, `POLL_MILLIS` from `filesystem.rs` (now in `file_watcher.rs`)
- [ ] Remove `notify`, `ignore`, `std::sync::mpsc` imports that are no longer needed in `filesystem.rs`
- [ ] Update unit tests: remove tests for functions that moved to `file_watcher.rs`; keep the `test_feed_id_and_name` test; update the integration test to use FileWatcher + broadcast channel

**Tests:**
- [ ] Updated integration test: FilesystemFeed produces correct wire format when consuming FileWatcher broadcast

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast` — existing FILESYSTEM integration test must still pass

---

#### Step 4: Implement FileTreeFeed {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tugcast): add FileTreeFeed (FILETREE 0x11) snapshot feed`

**References:** [D03] Separate FILETREE feed, [D04] SnapshotFeed, [D05] Relative paths, Spec S01, Spec S03, (#internal-architecture, #symbols, #payload-format)

**Artifacts:**
- New file `tugrust/crates/tugcast/src/feeds/filetree.rs`
- `pub mod filetree` added to `feeds/mod.rs`

**Tasks:**
- [ ] Create `tugrust/crates/tugcast/src/feeds/filetree.rs` with `FileTreeFeed` struct
- [ ] `FileTreeFeed` fields: `watch_dir: PathBuf`, `initial_files: BTreeSet<String>`, `truncated: bool`, `event_tx: broadcast::Sender<Vec<FsEvent>>`
- [ ] Implement `FileTreeFeed::new(watch_dir, initial_files, truncated, event_tx: broadcast::Sender<Vec<FsEvent>>)` constructor
- [ ] Implement `SnapshotFeed` for `FileTreeFeed`:
  - `feed_id()` returns `FeedId::FILETREE`
  - `name()` returns `"filetree"`
  - `run()`: call `self.event_tx.subscribe()` to get a fresh `Receiver`. Send initial snapshot immediately from `initial_files`, then loop on `rx.recv()`. For each batch: apply Created (insert), Removed (remove), Renamed (remove from, insert to) to the BTreeSet. Ignore Modified events. After applying, if set changed, debounce 200ms, then serialize `FileTreeSnapshot` and send via `watch::Sender<Frame>`. Handle `RecvError::Lagged` by logging and continuing (set is still accurate from the initial walk + all non-lagged events).
- [ ] Add `pub mod filetree` to `feeds/mod.rs`
- [ ] Add unit tests in `#[cfg(test)]` module: BTreeSet update logic (insert/remove/rename), Modified events skipped, snapshot serialization matches Spec S01 format

**Tests:**
- [ ] BTreeSet correctly updated by Created/Removed/Renamed events, Modified ignored
- [ ] Snapshot serialization matches Spec S01 JSON format

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast`

---

#### Step 5: Wire FileWatcher and FileTreeFeed into tugcast main {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(tugcast): wire FileWatcher, FileTreeFeed into main startup`

**References:** [D01] Shared FileWatcher, [D02] Broadcast channel, [D03] Separate FILETREE feed, (#internal-architecture)

**Artifacts:**
- Modified `tugrust/crates/tugcast/src/main.rs` — FileWatcher creation, broadcast channel, feed wiring

**Tasks:**
- [ ] In `main.rs`: create `FileWatcher::new(watch_dir.clone())`
- [ ] Call `file_watcher.walk()` to get initial `(BTreeSet<String>, truncated)` for FILETREE
- [ ] Create `broadcast::channel::<Vec<FsEvent>>(256)` for FileWatcher fan-out
- [ ] Create `FilesystemFeed::new(watch_dir.clone(), broadcast_tx.clone())` — pass a `broadcast::Sender` clone (feed subscribes inside `run()`)
- [ ] Create `FileTreeFeed::new(watch_dir.clone(), initial_files, truncated, broadcast_tx.clone())` — pass a `broadcast::Sender` clone (feed subscribes inside `run()`)
- [ ] Create `watch::channel` for FILETREE snapshot: `let (ft_watch_tx, ft_watch_rx) = watch::channel(Frame::new(FeedId::FILETREE, vec![]))`
- [ ] Add `ft_watch_rx` to `snapshot_watches` vec
- [ ] Spawn `file_watcher.run(broadcast_tx, cancel.clone())` as a background task
- [ ] Spawn `filetree_feed.run(ft_watch_tx, cancel.clone())` as a background task
- [ ] Update `FilesystemFeed` spawning to use the new constructor (pass broadcast receiver instead of creating watcher internally)
- [ ] Add necessary imports: `use crate::feeds::file_watcher::FileWatcher` and `use crate::feeds::filetree::FileTreeFeed`

**Tests:**
- [ ] N/A — wiring step verified by build and existing test suite

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run`

---

#### Step 6: Rust Integration Checkpoint {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Shared FileWatcher, [D03] Separate FILETREE feed, (#success-criteria)

**Tasks:**
- [ ] Verify FileWatcher + FILESYSTEM refactor does not break existing wire format (existing integration test passes)
- [ ] Verify FileTreeFeed sends initial snapshot on startup
- [ ] Verify all Rust tests pass with no warnings

**Tests:**
- [ ] N/A — verification-only step

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build 2>&1 | grep -c warning` returns 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run`

---

#### Step 7: Implement FileTreeStore in tugdeck {#step-7}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add FileTreeStore consuming FILETREE feed`

**References:** [D07] Provider ref caching, [D08] Gallery FeedStore, Spec S04, (#public-api, #symbols)

**Artifacts:**
- New file `tugdeck/src/lib/filetree-store.ts`
- New file `tugdeck/src/__tests__/filetree-store.test.ts`

**Tasks:**
- [ ] Create `tugdeck/src/lib/filetree-store.ts` with `FileTreeStore` class
- [ ] Implement L02-compliant `subscribe(listener)` / `getSnapshot()` returning `FileTreeSnapshot`
- [ ] Constructor takes `FeedStore` and `FeedIdValue`, subscribes to the feed for FILETREE payloads, parses JSON into `FileTreeSnapshot`
- [ ] Implement `getFileCompletionProvider()`: returns a single stable closure (created once, never replaced). The closure reads `this._snapshot.files` on each call, checks if the `files` reference changed since last invocation, and if so rebuilds the cached `CompletionItem[]` via `createFileCompletionProvider()`. Same pattern as `SessionMetadataStore.getCommandCompletionProvider()`. ([D07])
- [ ] Implement `dispose()` to unsubscribe from FeedStore
- [ ] Default snapshot: `{ files: [], root: "", truncated: false }`
- [ ] Create `tugdeck/src/__tests__/filetree-store.test.ts`:
  - Mock FeedStore that delivers a FILETREE JSON payload — verify `getSnapshot()` returns parsed files
  - `getFileCompletionProvider()` returns a stable closure; calling it returns items matching substring query
  - After snapshot update, same provider closure returns updated results (reads fresh data)
  - Provider function reference is identical across multiple `getFileCompletionProvider()` calls
  - Empty and truncated snapshots handled gracefully

**Tests:**
- [ ] FileTreeStore parses FILETREE payload, returns filtered completion items via stable closure provider

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 8: Wire FileTreeStore into gallery card {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): gallery card @-trigger uses live FileTreeStore`

**References:** [D08] Gallery FeedStore, (#success-criteria, #symbols)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-prompt-input.tsx`

**Tasks:**
- [ ] In `buildGalleryStores()`: when connection is available, add `FeedId.FILETREE` to the FeedStore's `feedIds` array (alongside `FeedId.CODE_OUTPUT`). Create `FileTreeStore` from the FeedStore. Return it in the result object.
- [ ] When connection is not available: return `fileTreeStore: null` in the result object.
- [ ] At module level: destructure `fileTreeStore: _fileTreeStore` from `buildGalleryStores()`
- [ ] Replace `const galleryFileCompletionProvider = createFileCompletionProvider(TYPEAHEAD_FILES)` with: if `_fileTreeStore` is not null, use `_fileTreeStore.getFileCompletionProvider()` (returns a stable closure that always reads current data — safe to assign at module level per [D07]); otherwise fall back to `createFileCompletionProvider(TYPEAHEAD_FILES)`
- [ ] Add imports for `FileTreeStore` and `FeedId` (FeedId already imported)
- [ ] `TYPEAHEAD_FILES` constant remains as fallback data — do not remove it

**Tests:**
- [ ] N/A — gallery wiring verified by existing test suite and checkpoint

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 9: End-to-End Integration Checkpoint {#step-9}

**Depends on:** #step-6, #step-8

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify full Rust build and test suite passes
- [ ] Verify full tugdeck test suite passes
- [ ] Verify FILESYSTEM wire format unchanged (grep for existing FILESYSTEM frame assertions in tests)
- [ ] Verify FILETREE feed ID 0x11 is registered in both Rust and TypeScript protocol files

**Tests:**
- [ ] N/A — verification-only step

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `grep -r 'FILETREE' /Users/kocienda/Mounts/u/src/tugtool/tugrust/crates/tugcast-core/src/protocol.rs /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/protocol.ts` — both files contain FILETREE

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Live file completion for the `@` trigger — tugcast indexes project files via a shared FileWatcher service, broadcasts the file list as FILETREE (0x11) snapshots, and tugdeck's FileTreeStore delivers them to the existing `createFileCompletionProvider()` factory.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] FileWatcher shared service: single `notify` watcher with `WalkBuilder`-grade nested gitignore, broadcast to multiple consumers (`cargo nextest run` passes)
- [ ] FILESYSTEM feed refactored to consume FileWatcher broadcast (wire format unchanged, existing consumers unaffected)
- [ ] FILETREE feed (0x11): sends complete file list snapshot on connect and on file creates/removes/renames
- [ ] FileTreeStore in tugdeck: L02-compliant, exposes `getFileCompletionProvider()` as stable closure (L07, same pattern as `getCommandCompletionProvider()`)
- [ ] Gallery card `@` trigger shows live project files when connected
- [ ] `cd tugrust && cargo nextest run` passes
- [ ] `cd tugdeck && bun test` passes

**Acceptance tests:**
- [ ] FileWatcher `walk()` returns correct relative paths respecting nested `.gitignore` (Rust unit test)
- [ ] FileTreeFeed applies Created/Removed/Renamed, ignores Modified (Rust unit test)
- [ ] FileTreeStore parses FILETREE snapshot and returns filtered completion items (TypeScript unit test)
- [ ] FILESYSTEM integration test passes unchanged after refactor (Rust integration test)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Fuzzy or path-segment-aware completion matching algorithm
- [ ] Delta encoding for large file list snapshots
- [ ] UI hint when `truncated: true`
- [ ] tug-prompt-entry integration (T3.4)
- [ ] Lagged recovery: re-walk on `RecvError::Lagged` in FileTreeFeed
