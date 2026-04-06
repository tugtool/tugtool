<!-- tugplan-skeleton v2 -->

## Live File Completion Provider {#live-file-completion}

**Purpose:** Replace the hardcoded `TYPEAHEAD_FILES` stub with live, fuzzy-scored file completion powered by tugcast. The client sends a query string; tugcast scores it against a live file index using a two-layer fuzzy matcher (character-level DP + path-aware structural scoring) and returns the top-N results. No bulk file list is ever sent to the browser.

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

T3.2 established the `CompletionProvider` interface on tug-prompt-input, and T3.3 Step 3 created `file-completion-provider.ts` with a `createFileCompletionProvider(files)` factory that accepts any `string[]`. The `@` trigger currently uses a hardcoded `TYPEAHEAD_FILES` array in the gallery card. The missing piece is a live data source with intelligent matching — a service that walks the project tree, keeps the file list current, scores queries with fuzzy matching, and returns ranked results to tugdeck.

We own the file index and scoring ourselves rather than depending on Claude Code. Claude Code's file context is optimized for AI model needs, not human completion UX — its list may exclude files, change shape between versions, or lag behind actual filesystem state. Scoring happens server-side in tugcast (Rust) because: (1) the file index already lives there, (2) no need to ship 50k paths to the browser, and (3) Rust's performance handles the DP-based fuzzy scoring within interactive budget. The query/response model means the browser sends a query string and receives only the top-N scored results.

#### Strategy {#strategy}

- **[DONE]** Extract the `notify` watcher and `.gitignore` handling from `filesystem.rs` into a shared **FileWatcher** service that both FILESYSTEM and FILETREE feeds consume.
- **[DONE]** Replace `tokio::sync::watch` (single-value, latest-wins) with `tokio::sync::broadcast` for fan-out to multiple consumers with guaranteed delivery.
- **[DONE]** Keep FILESYSTEM wire format and behavior unchanged — the refactor is invisible to existing consumers.
- Implement a two-layer fuzzy scorer in Rust: character-level DP matcher + path-aware structural wrapper that prioritizes basename matches.
- Add a **query/response FILETREE feed**: client sends query on `FILETREE_QUERY` (0x12), `FileTreeFeed` scores against its `BTreeSet<String>`, responds on `FILETREE` (0x11) with top-N scored results. No bulk file list sent to the browser.
- Add FileTreeStore in tugdeck — L02-compliant, sends queries via `FILETREE_QUERY`, receives scored results on `FILETREE`.
- Wire the gallery card's `@` trigger to live scored results. Remove `TYPEAHEAD_FILES` stub entirely — tugcast is always running when cards are visible.
- L22-compliant notification path: FileTreeStore → text engine → typeahead menu. The `CompletionProvider` carries a `subscribe` method so the text engine can observe the store directly and re-fire `onTypeaheadChange` when scored results arrive, without round-tripping through React.

#### Success Criteria (Measurable) {#success-criteria}

- **[DONE]** FileWatcher walks the project tree and broadcasts `Vec<FsEvent>` batches to all subscribers (`cd tugrust && cargo nextest run` passes with FileWatcher unit tests)
- **[DONE]** FILESYSTEM feed produces identical wire format after refactoring to consume FileWatcher broadcast (existing integration test passes unchanged)
- Fuzzy scorer scores `sms` against `session-metadata-store.ts` with word-boundary bonuses, `model` against `model.ts` with basename preference over `src/models/config.ts` (`cargo nextest run` passes with scorer unit tests)
- FILETREE query/response: client sends query on 0x12, receives top-N scored results on 0x11 (`cargo nextest run` passes with FILETREE tests)
- FileTreeStore in tugdeck sends queries and exposes `getFileCompletionProvider()` (`cd tugdeck && bun test` passes)
- Gallery card `@` trigger shows live fuzzy-scored project files with match highlighting in the typeahead menu

#### Scope {#scope}

1. **[DONE]** FileWatcher shared service: single `notify` watcher with `WalkBuilder`-grade nested `.gitignore`, broadcast to multiple consumers
2. **[DONE]** FILESYSTEM feed refactored to consume FileWatcher broadcast (wire format unchanged)
3. **[DONE]** `FeedId::FILETREE = 0x11` and `FileTreeSnapshot` type in tugcast-core; `FILETREE: 0x11` in tugdeck protocol
4. Two-layer fuzzy scorer in Rust: character-level DP + path-aware structural wrapper (basename preference)
5. `FeedId::FILETREE_QUERY = 0x12` — client-to-server query channel (input sink pattern)
6. FILETREE feed: maintains `BTreeSet<String>`, receives queries via mpsc, scores and responds with top-N results
7. FileTreeStore in tugdeck (query sender + result receiver, L22-compliant observer for async results)
8. Subscribable `CompletionProvider`: carries `subscribe` method so text engine observes store directly [L22]
9. Match highlighting in typeahead menu using scored result match ranges
10. Gallery card integration: replace `TYPEAHEAD_FILES` stub with live FileTreeStore provider

#### Non-goals (Explicitly out of scope) {#non-goals}

- Frecency / recency weighting (requires usage tracking infrastructure)
- Multi-term queries (space-separated, e.g., `"comp button"` — not needed for trigger-based `@` completion)
- UI hint for truncated file lists (future enhancement)
- tug-prompt-entry integration (T3.4 scope)

#### Dependencies / Prerequisites {#dependencies}

- `ignore` crate already in tugcast's `Cargo.toml` — `WalkBuilder` is available
- `tokio::sync::broadcast` already used throughout tugcast — no new workspace dependency
- `notify` crate already in tugcast's `Cargo.toml`
- `CompletionProvider` type and `CompletionItem` interface already exist in `tug-text-engine.ts` (will be extended with `subscribe` and `matches`)
- `FeedStore` class and `getConnection()` already exist in tugdeck

#### Constraints {#constraints}

- One `notify` watcher per directory tree — no duplicated kernel events
- 50,000 file cap for safety in monorepos
- Warnings are errors in the Rust workspace (`-D warnings`)
- Stores expose `subscribe`/`getSnapshot` (L02) for any React consumers. But the typeahead menu is DOM-based — per L22, the text engine observes the store directly and updates DOM in the callback, never round-tripping through React's render cycle.
- Providers must be L07 stable refs — return a stable closure that reads current state on each call (same pattern as `getCommandCompletionProvider()`)

#### Assumptions {#assumptions}

- FileWatcher will be a plain struct (not implementing `SnapshotFeed` or `StreamFeed`) — it is a shared service, not a feed itself
- FileTreeFeed does NOT implement `SnapshotFeed` — it is a custom async task with both query input (mpsc) and event input (broadcast), which the `SnapshotFeed` trait cannot express. It owns a `watch::Sender<Frame>` for responses but is spawned directly, not through the feed registry.
- `FeedId::FILETREE = 0x11` sits in the 0x10 range alongside `FILESYSTEM = 0x10`; `FeedId::FILETREE_QUERY = 0x12` is the client-to-server query channel
- `FileTreeSnapshot` type goes in `tugcast-core/src/types.rs` alongside `FsEvent`, `GitStatus`, etc.
- The gallery card's module-level `FileTreeStore` instance follows the same never-disposed pattern as `_metadataStore` and `_historyStore`
- The 50,000 file cap and truncated flag are implemented in `FileWatcher::walk()`, not in `FileTreeFeed`
- When FileWatcher sees a `.gitignore` change, it rebuilds the matcher before filtering subsequent events in the same batch; the `.gitignore` change event itself is still broadcast
- FileWatcher owns all conversion — broadcasts `Vec<FsEvent>`, `FilesystemFeed` only serializes to wire format
- FILETREE and FILETREE_QUERY are added to the existing FeedStore's `feedIds` array in `buildGalleryStores()`; tugcast is always running when cards are visible — no offline fallback needed

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

**Decision:** FILETREE (0x11) is a separate feed from FILESYSTEM (0x10). FILETREE_QUERY (0x12) is the client-to-server query channel.

**Rationale:**
- FILESYSTEM emits change events (`Created`/`Modified`/`Removed`). FILETREE returns scored completion results in response to queries. Different semantics, different consumers.

**Implications:**
- `FeedId::FILETREE = 0x11` (server → client, scored results) in both Rust and TypeScript.
- `FeedId::FILETREE_QUERY = 0x12` (client → server, query string) in both Rust and TypeScript.
- FILETREE uses a `watch::channel` for responses (latest-wins, new clients get last result); FILETREE_QUERY uses the input sink pattern (mpsc channel) for queries. FileTreeFeed is a custom async task, not a `SnapshotFeed` implementor.

#### [D04] Query/response, not bulk snapshot (DECIDED) {#d04-query-response}

**Decision:** FileTreeFeed holds the `BTreeSet<String>` server-side and scores queries in Rust. The client sends a query string on `FILETREE_QUERY` (0x12); the server scores against the file index and responds on `FILETREE` (0x11) with the top-N scored results. No bulk file list is ever sent to the browser.

**Rationale:**
- Avoids sending up to 50,000 file paths over the WebSocket connection.
- Scoring in Rust is fast — a cheap pre-filter (subsequence check, O(n)) eliminates >99% of candidates, then DP scoring runs only on survivors. Total query time: ~5-10ms on 50k files.
- The file index already lives in tugcast — keeping it there is the natural architecture.
- The `watch::channel` means the latest result is always available, and latest-wins semantics are correct (only the most recent query's results matter).

**Implications:**
- FileTreeFeed is a custom async task (not a `SnapshotFeed` implementor — the trait can't express the dual-input nature of query + file events). It owns a `watch::Sender<Frame>` for responses.
- FileTreeFeed also receives an `mpsc::Receiver<String>` for query input.
- The router registers `FILETREE_QUERY` as an input sink, dispatching to `mpsc::Sender<String>`.
- Initial response on connect is an empty result set (no query has been sent yet).
- The fuzzy scorer lives in a Rust module, not TypeScript.

#### [D04a] Two-layer fuzzy scoring in Rust (DECIDED) {#d04a-fuzzy-scoring}

**Decision:** Implement a single fuzzy scoring algorithm with two layers: (1) a character-level DP scorer and (2) a path-aware structural wrapper. Based on research into VS Code, fzf, Sublime Text, and CodeMirror 6.

**Rationale:**
- Every best-in-class tool (VS Code, fzf, Sublime) uses a single scorer — quality comes from the scoring function's design, not from ensemble/voting approaches.
- VS Code and Sublime both separate character scoring from path structure scoring. This is the key insight: basename matches must always outrank directory-only matches.
- fzf's scoring constants (boundary +8, consecutive +8, gap -3/-1) are well-proven defaults.

**Implications:**
- New module `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs` with ~250 lines of Rust.
- `contains_chars(query, candidate) -> bool` — O(n) subsequence check. Returns true only if all query characters appear in order in the candidate (case-insensitive). This is the pre-filter gate — eliminates >99% of candidates before any DP work.
- `fuzzy_score(query, candidate) -> Option<ScoredMatch>` — character-level DP. Only called on candidates that pass `contains_chars`.
- `score_file_path(query, path) -> Option<ScoredMatch>` — scores basename first with tier bonus, falls back to full path only when query contains `/` or basename doesn't match. Uses `contains_chars` internally as pre-filter.
- Scoring constants are tunable but ship with fzf-inspired defaults.
- Performance budget: pre-filter is ~4ms on 50k files (50k × 80-char scan). DP scoring on ~100-500 survivors is ~1-4ms. Total: well under 10ms per query.

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

#### [D07] Subscribable CompletionProvider with L22 observer path (DECIDED) {#d07-provider-observer}

**Decision:** `getFileCompletionProvider()` returns a single stable closure with an attached `subscribe` method. The `CompletionProvider` type is extended to optionally carry `subscribe`:

```typescript
export type CompletionProvider = ((query: string) => CompletionItem[]) & {
  subscribe?: (listener: () => void) => () => void;
};
```

When the text engine activates a typeahead and detects `provider.subscribe`, it subscribes. When the listener fires (scored results arrived), the text engine re-calls `provider(query)` with the current query and re-fires `onTypeaheadChange` to update the menu DOM. When the typeahead deactivates, it unsubscribes.

**Rationale:**
- The typeahead menu is DOM-based, not React state. Per **L22**, external state that drives direct DOM updates must be observed directly — never round-tripped through React's render cycle. The text engine subscribes to the store's observer and updates the menu DOM in the callback. No `useSyncExternalStore`, no React re-render.
- The `CompletionProvider` type is synchronous: `(query: string) => CompletionItem[]`. It cannot await a response. The provider sends the query and returns current results. When scored results arrive (typically 2-5ms over local WebSocket), the store notifies via `subscribe`, the text engine re-reads, and the menu updates.
- Synchronous providers (like command completion) simply don't have a `subscribe` property — backward compatible, no changes needed.
- Module-level assignment still works: the function reference is stable, always delegates to current state.

**Implications:**
- The text engine gains a `refreshTypeahead()` method that re-calls `this._typeahead.provider(this._typeahead.query)` and re-fires `onTypeaheadChange`.
- `detectTypeaheadTrigger()` checks for `provider.subscribe` and subscribes if present, storing the unsubscribe function.
- `deactivateTypeahead()` calls the stored unsubscribe function.
- The notification path is: FileTreeStore snapshot updates → `subscribe` listener fires → `refreshTypeahead()` → `onTypeaheadChange` → menu DOM updates. No React involvement.
- First call with a new query may return stale results; the subscribe callback delivers correct results within a few ms. In practice the latency is imperceptible.

#### [D08] FILETREE added to existing FeedStore in gallery (DECIDED) {#d08-gallery-feedstore}

**Decision:** Add `FeedId.FILETREE` and `FeedId.FILETREE_QUERY` to the existing FeedStore's `feedIds` array in `buildGalleryStores()`. Tugcast is always running when cards are visible — no fallback needed.

**Rationale:**
- Reuses the existing FeedStore/connection pattern established by SessionMetadataStore.
- No new connection or subscription infrastructure needed.
- No offline fallback: if tugcast isn't running, cards aren't visible, so the `@` trigger never fires.

**Implications:**
- `buildGalleryStores()` returns a `fileTreeStore` alongside `metadataStore` and `historyStore`.
- `FileTreeStore` constructor takes the FeedStore and subscribes to `FeedId.FILETREE` for responses. Query dispatch uses `FeedId.FILETREE_QUERY`.
- The `TYPEAHEAD_FILES` stub and `createFileCompletionProvider` factory are removed — they were development scaffolding.

---

### Specification {#specification}

#### Payload Format {#payload-format}

**Spec S01a: FILETREE_QUERY payload (client → server)** {#s01a-filetree-query}

```json
{
  "query": "sms"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `query` | `string` | The user's current input after the `@` trigger. Empty string returns an alphabetical listing of the root project directory (files with no `/` in their relative path), top-N. |

**Spec S01b: FILETREE response payload (server → client)** {#s01b-filetree-response}

```json
{
  "query": "sms",
  "results": [
    { "path": "src/lib/session-metadata-store.ts", "score": 72, "matches": [[0,1],[8,9],[17,18]] },
    { "path": "src/lib/shell-metadata-store.ts", "score": 48, "matches": [[0,1],[6,7],[15,16]] }
  ],
  "truncated": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `query` | `string` | Echo of the query that produced these results (for staleness detection) |
| `results` | `ScoredResult[]` | Top-N results sorted by descending score |
| `results[].path` | `string` | Relative path (relative to project root) |
| `results[].score` | `number` | Fuzzy match score (higher = better) |
| `results[].matches` | `[number, number][]` | Character ranges in `path` that matched (for highlighting) |
| `truncated` | `bool` | `true` if the file index exceeded the 50,000 cap |

#### Internal Architecture {#internal-architecture}

**Spec S02: FileWatcher service (IMPLEMENTED)** {#s02-filewatcher}

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
                                                 to BTreeSet, scores queries
```

**Spec S03: FileTreeFeed architecture** {#s03-filetree-architecture}

```
                        ┌─────────────────────────────────┐
                        │         FileTreeFeed             │
                        │                                  │
  FileWatcher ─────────►│  BTreeSet<String> (file index)   │
  (broadcast rx)        │         ▲                        │
                        │         │ Created/Removed/Renamed│
                        │                                  │
  Client ──────────────►│  mpsc::Receiver<String> (query)  │
  (FILETREE_QUERY 0x12) │         │                        │
                        │         ▼                        │
                        │  fuzzy_scorer::score_file_path() │
                        │         │                        │
                        │         ▼                        │
                        │  watch::Sender<Frame> (response) │──► Client
                        │  (FILETREE 0x11)                 │    (scored results)
                        └─────────────────────────────────┘
```

| Input | Source | Action |
|-------|--------|--------|
| `FsEvent::Created` | FileWatcher broadcast | Insert path into BTreeSet |
| `FsEvent::Removed` | FileWatcher broadcast | Remove path from BTreeSet |
| `FsEvent::Renamed` | FileWatcher broadcast | Remove `from`, insert `to` |
| `FsEvent::Modified` | FileWatcher broadcast | **Ignored** — file saves don't change the file list |
| Query string | mpsc from FILETREE_QUERY | Pre-filter via `contains_chars()`, score survivors via `score_file_path()`, send top-8 results on FILETREE |
| Empty query string | mpsc from FILETREE_QUERY | Return root-level files (no `/` in path), alphabetical, top 8 |

FileTreeFeed is a **custom async task** (not a `SnapshotFeed` implementor — the `SnapshotFeed` trait's `run()` signature only accepts a `watch::Sender` and `CancellationToken`, which cannot express the dual-input nature of query + file events). Its `run()` loop uses `tokio::select!` to handle both FileWatcher events and query input concurrently.

#### Public API Surface {#public-api}

**Spec S04: FileTreeStore TypeScript API** {#s04-filetree-store-api}

```typescript
class FileTreeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileTreeResultSnapshot;
  getFileCompletionProvider(): CompletionProvider;
  sendQuery(query: string): void;
  dispose(): void;
}

interface ScoredResult {
  path: string;
  score: number;
  matches: [number, number][];
}

interface FileTreeResultSnapshot {
  query: string;
  results: ScoredResult[];
  truncated: boolean;
}
```

- `subscribe`/`getSnapshot`: standard store interface. Used by the text engine's subscribe path [L22], not by React's render cycle. The typeahead menu is DOM-based — the text engine observes the store directly and updates the menu DOM in the callback.
- `sendQuery(query)`: sends query string to tugcast via `FILETREE_QUERY` frame
- `getFileCompletionProvider()`: returns a single stable closure with attached `subscribe` method ([D07]). When called with a query, sends the query via `sendQuery()` and returns current `this._snapshot.results` mapped to `CompletionItem[]` (including `matches` field for highlighting). The `subscribe` property delegates to `this.subscribe()` so the text engine can observe result changes.
- `dispose()`: unsubscribes from FeedStore

**Spec S05: CompletionProvider type extension** {#s05-completion-provider}

```typescript
export type CompletionProvider = ((query: string) => CompletionItem[]) & {
  subscribe?: (listener: () => void) => () => void;
};
```

Synchronous providers (command completion) omit `subscribe`. Async providers (file completion) include it. The text engine checks for `subscribe` at typeahead activation and observes if present.

**Spec S06: CompletionItem with match ranges** {#s06-completion-item}

```typescript
export interface CompletionItem {
  label: string;
  atom: AtomSegment;
  matches?: [number, number][];
}
```

The `matches` field carries character ranges for highlighting. When present, the typeahead menu renders matched characters with a distinct style (e.g., `<mark>` or a CSS class). When absent (command completion), the label renders as plain text.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/feeds/file_watcher.rs` | **[DONE]** Shared FileWatcher service: owns notify watcher, gitignore, walk, broadcast |
| `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs` | Two-layer fuzzy scoring: character-level DP + path-aware structural wrapper |
| `tugrust/crates/tugcast/src/feeds/filetree.rs` | FileTreeFeed: custom async task, maintains BTreeSet, receives queries, responds with scored results |
| `tugdeck/src/lib/filetree-store.ts` | FileTreeStore: sends queries, receives scored results, subscribable for L22 observer path |
| `tugdeck/src/__tests__/filetree-store.test.ts` | Unit tests for FileTreeStore |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FileWatcher` | struct | `tugrust/crates/tugcast/src/feeds/file_watcher.rs` | **[DONE]** Owns `notify::RecommendedWatcher`, gitignore matcher, `broadcast::Sender<Vec<FsEvent>>` |
| `FileWatcher::new()` | fn | same | **[DONE]** Constructor: takes `watch_dir: PathBuf` |
| `FileWatcher::walk()` | fn | same | **[DONE]** Initial walk via `WalkBuilder`, returns `BTreeSet<String>`, 50k cap |
| `FileWatcher::run()` | fn | same | **[DONE]** Starts watcher, debounces, converts, filters, broadcasts |
| `contains_chars()` | fn | `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs` | O(n) subsequence pre-filter: returns true if all query chars appear in order |
| `fuzzy_score()` | fn | same | Character-level DP scorer: `(query, candidate) -> Option<ScoredMatch>` — only called on candidates passing `contains_chars` |
| `score_file_path()` | fn | same | Path-aware wrapper: basename-first with tier bonus, full-path fallback |
| `ScoredMatch` | struct | same | `{ score: i32, matches: Vec<(usize, usize)> }` |
| `FileTreeFeed` | struct | `tugrust/crates/tugcast/src/feeds/filetree.rs` | Custom async task (not `SnapshotFeed`), receives queries via mpsc |
| `FileTreeFeed::new()` | fn | same | Takes `watch_dir`, initial `BTreeSet<String>`, `broadcast::Sender`, `mpsc::Receiver<String>` |
| `FileTreeSnapshot` | struct | `tugrust/crates/tugcast-core/src/types.rs` | **[DONE]** Response payload type (will need field updates for scored results) |
| `FeedId::FILETREE` | const | `tugrust/crates/tugcast-core/src/protocol.rs` | **[DONE]** `Self(0x11)` |
| `FeedId::FILETREE_QUERY` | const | same | `Self(0x12)` — client-to-server query channel |
| `FILETREE` | const | `tugdeck/src/protocol.ts` | **[DONE]** `0x11` in FeedId object |
| `FILETREE_QUERY` | const | same | `0x12` in FeedId object |
| `FileTreeStore` | class | `tugdeck/src/lib/filetree-store.ts` | Sends queries, receives scored results, subscribable for L22 observer |
| `FileTreeResultSnapshot` | interface | same | `{ query: string, results: ScoredResult[], truncated: boolean }` |
| `CompletionProvider` | type (modified) | `tugdeck/src/lib/tug-text-engine.ts` | Extended with optional `subscribe` method for async providers [D07] |
| `CompletionItem` | interface (modified) | same | Extended with optional `matches: [number, number][]` for highlighting [S06] |
| `refreshTypeahead()` | method | same | Re-calls provider with current query, re-fires `onTypeaheadChange` |
| `FilesystemFeed::new()` | fn (modified) | `tugrust/crates/tugcast/src/feeds/filesystem.rs` | **[DONE]** Constructor accepts `broadcast::Sender<Vec<FsEvent>>` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test fuzzy scorer (character DP, path-aware wrapper, scoring constants), FileTreeFeed BTreeSet updates + query handling, FileTreeStore snapshot parsing | Core logic, edge cases |
| **Integration** | Test FILESYSTEM wire format unchanged after refactor, FILETREE query/response end-to-end | End-to-end data flow |

---

### Execution Steps {#execution-steps}

#### Step 1: Add FeedId::FILETREE and FileTreeSnapshot type (DONE) {#step-1}

**Status:** Merged to main (`b4a27a1d`)

---

#### Step 2: Extract FileWatcher shared service (DONE) {#step-2}

**Status:** Merged to main (`5cc47575`)

---

#### Step 3: Refactor FilesystemFeed to consume FileWatcher broadcast (DONE) {#step-3}

**Status:** Merged to main (`b5249fc7`)

---

#### Step 4: Implement fuzzy scorer {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugcast): add two-layer fuzzy scorer for file path matching`

**References:** [D04a] Two-layer fuzzy scoring, (#symbols)

**Artifacts:**
- New file `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs`
- `pub mod fuzzy_scorer` added to `feeds/mod.rs`

**Tasks:**
- [ ] Create `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs`
- [ ] Implement `ScoredMatch` struct: `{ score: i32, matches: Vec<(usize, usize)> }` — score + highlight ranges
- [ ] Implement `contains_chars(query: &str, candidate: &str) -> bool` — O(n) subsequence pre-filter:
  - Walk candidate left to right, advancing query pointer on each case-insensitive character match
  - Return `true` only if all query characters were found in order
  - This eliminates >99% of candidates before any DP work. Cost: ~4ms on 50k files.
- [ ] Implement `fuzzy_score(query: &str, candidate: &str) -> Option<ScoredMatch>` — character-level DP scorer:
  - **Caller must pre-filter via `contains_chars` first** — this function assumes the candidate is a plausible match
  - Build `query.len() × candidate.len()` DP table
  - Scoring constants: base match +16, consecutive +8, word boundary +8 (after `-`, `_`, `.`, `/`, space), camelCase transition +7, first character +8, exact case +1, gap first −3, gap extension −1
  - Case-insensitive matching (compare lowercased), case-exact bonus when original cases match
  - Backtrack from bottom-right to recover match positions as `(start, end)` ranges
  - Return `None` if not all query characters can be placed (shouldn't happen after pre-filter, but defensive)
- [ ] Implement `score_file_path(query: &str, path: &str) -> Option<ScoredMatch>` — path-aware structural wrapper:
  - If query contains `/`: pre-filter + score the full path via `fuzzy_score(query, path)`
  - Otherwise: pre-filter + score basename first via `fuzzy_score(query, basename)`. If match, add `BASENAME_TIER_BONUS` (131072, i.e., `1 << 17`) and adjust match positions to be relative to the full path.
  - If basename doesn't match: pre-filter + fall back to `fuzzy_score(query, path)` with no tier bonus.
  - Tiebreaking: shorter path wins (subtract `path.len()` from score)
- [ ] Add `pub mod fuzzy_scorer` to `feeds/mod.rs`
- [ ] Add comprehensive unit tests:
  - Exact prefix scores highest: `"model"` vs `"model.ts"`
  - Word boundary initials: `"sms"` matches `"session-metadata-store.ts"` with high score
  - CamelCase: `"btn"` matches `"ButtonGroup.tsx"`
  - Basename preference: `"model"` scores `"model.ts"` higher than `"src/models/config.ts"`
  - Full path when query has `/`: `"src/comp"` matches `"src/components/Button.tsx"`
  - Non-match returns `None`: `"xyz"` vs `"model.ts"`
  - Match positions are correct for highlighting
  - Case-insensitive matching with case-exact bonus
  - Pre-filter: `contains_chars("sms", "session-metadata-store.ts")` returns true
  - Pre-filter: `contains_chars("xyz", "model.ts")` returns false
  - Pre-filter: `contains_chars("sm", "ms")` returns false (order matters)

**Tests:**
- [ ] Fuzzy scorer unit tests cover all scoring factors and path-awareness

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast`

---

#### Step 5: Add FeedId::FILETREE_QUERY and update FileTreeSnapshot type {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugcast-core): add FeedId::FILETREE_QUERY (0x12) and update response types`

**References:** [D03] Separate FILETREE feed, [D04] Query/response, Spec S01a, Spec S01b, (#payload-format, #symbols)

**Artifacts:**
- Modified `tugrust/crates/tugcast-core/src/protocol.rs` — add FILETREE_QUERY
- Modified `tugrust/crates/tugcast-core/src/types.rs` — update FileTreeSnapshot to response format
- Modified `tugdeck/src/protocol.ts` — add FILETREE_QUERY

**Tasks:**
- [ ] Add `pub const FILETREE_QUERY: Self = Self(0x12)` to `FeedId` in `protocol.rs`
- [ ] Add match arm `Self::FILETREE_QUERY => Some("FileTreeQuery")` to `FeedId::name()`
- [ ] **Clean break**: Replace `FileTreeSnapshot` in `types.rs` entirely. The Step 1 version (`files: Vec<String>`, `root: String`, `truncated: bool`) has no consumers — replace with Spec S01b response format: `query: String`, `results: Vec<ScoredResult>`, `truncated: bool`. Add `ScoredResult` struct: `path: String`, `score: i32`, `matches: Vec<(usize, usize)>`
- [ ] Add `FILETREE_QUERY: 0x12` to the FeedId object in `tugdeck/src/protocol.ts`
- [ ] Add assertion for FILETREE_QUERY in existing protocol test

**Tests:**
- [ ] Protocol test extended with FILETREE_QUERY assertion

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast-core`

---

#### Step 6: Implement FileTreeFeed with query/response {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `feat(tugcast): add FileTreeFeed with query/response scoring`

**References:** [D03] Separate FILETREE feed, [D04] Query/response, [D04a] Fuzzy scoring, Spec S03, (#internal-architecture, #symbols)

**Artifacts:**
- New file `tugrust/crates/tugcast/src/feeds/filetree.rs`
- `pub mod filetree` added to `feeds/mod.rs`

**Tasks:**
- [ ] Create `tugrust/crates/tugcast/src/feeds/filetree.rs` with `FileTreeFeed` struct
- [ ] `FileTreeFeed` fields: `watch_dir: PathBuf`, `initial_files: BTreeSet<String>`, `truncated: bool`, `event_tx: broadcast::Sender<Vec<FsEvent>>`, `query_rx: mpsc::Receiver<String>`
- [ ] Implement `FileTreeFeed::new(watch_dir, initial_files, truncated, event_tx, query_rx)` constructor
- [ ] Implement `FileTreeFeed::run(self, watch_tx: watch::Sender<Frame>, cancel: CancellationToken)` — **custom async task, does NOT implement `SnapshotFeed`** (the trait can't express dual-input):
  - Call `self.event_tx.subscribe()` for FileWatcher events
  - Use `tokio::select!` to handle:
    1. **FileWatcher events** (`rx.recv()`): apply Created/Removed/Renamed to BTreeSet, ignore Modified. Handle `RecvError::Lagged` by logging.
    2. **Query input** (`query_rx.recv()`): if query is empty, return root-level files (paths with no `/`), sorted alphabetically, top 8. Otherwise, pre-filter all paths via `contains_chars()`, score survivors via `score_file_path()`, sort by descending score, take top 8. Serialize as `FileTreeSnapshot` response (Spec S01b), send via `watch_tx`.
    3. **Cancellation** (`cancel.cancelled()`): break the loop.
  - Send empty initial response on startup (no query yet).
- [ ] Add `pub mod filetree` to `feeds/mod.rs`
- [ ] Add unit tests: BTreeSet update logic (insert/remove/rename), query scoring returns top-N results sorted by score, empty query returns top files alphabetically, response format matches Spec S01b

**Tests:**
- [ ] BTreeSet correctly updated by Created/Removed/Renamed events, Modified ignored
- [ ] Query scoring pre-filters then scores, returns correctly ranked results with match positions
- [ ] Empty query returns root-level files only (no `/` in path), alphabetical, top 8

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run -p tugcast`

---

#### Step 7: Wire FileWatcher, FileTreeFeed, and FILETREE_QUERY into tugcast main {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugcast): wire FileWatcher, FileTreeFeed, and FILETREE_QUERY into main startup`

**References:** [D01] Shared FileWatcher, [D02] Broadcast channel, [D03] Separate FILETREE feed, [D04] Query/response, (#internal-architecture)

**Artifacts:**
- Modified `tugrust/crates/tugcast/src/main.rs` — FileWatcher creation, broadcast channel, feed wiring, input sink registration
- Modified `tugrust/crates/tugcast/src/router.rs` — FILETREE_QUERY input sink dispatch

**Tasks:**
- [ ] In `main.rs`: create `FileWatcher::new(watch_dir.clone())`
- [ ] Call `file_watcher.walk()` to get initial `(BTreeSet<String>, truncated)` for FILETREE
- [ ] Create `broadcast::channel::<Vec<FsEvent>>(256)` for FileWatcher fan-out
- [ ] Create `mpsc::channel::<String>(16)` for FILETREE_QUERY input
- [ ] Create `FilesystemFeed::new(watch_dir.clone(), broadcast_tx.clone())`
- [ ] Create `FileTreeFeed::new(watch_dir.clone(), initial_files, truncated, broadcast_tx.clone(), query_rx)`
- [ ] Create `watch::channel` for FILETREE response: `let (ft_watch_tx, ft_watch_rx) = watch::channel(Frame::new(FeedId::FILETREE, vec![]))` — initial frame is empty (no query yet)
- [ ] Add `ft_watch_rx` to `snapshot_watches` vec (so the router subscribes clients to response updates)
- [ ] Register `FILETREE_QUERY` as an input sink in the router, dispatching frames to `query_tx` (parse payload as JSON, extract `query` string, send to mpsc)
- [ ] Spawn `file_watcher.run(broadcast_tx, cancel.clone())` as a background task
- [ ] Spawn `filetree_feed.run(ft_watch_tx, cancel.clone())` as a background task — FileTreeFeed is a custom async task, not spawned through the feed registry

**Tests:**
- [ ] N/A — wiring step verified by build and existing test suite

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run`

---

#### Step 8: Implement FileTreeStore and extend CompletionProvider type {#step-8}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): add FileTreeStore with subscribable CompletionProvider [L22]`

**References:** [D07] Subscribable provider, [D08] Gallery FeedStore, Spec S04, Spec S05, Spec S06, (#public-api, #symbols)

**Artifacts:**
- New file `tugdeck/src/lib/filetree-store.ts`
- New file `tugdeck/src/__tests__/filetree-store.test.ts`
- Modified `tugdeck/src/lib/tug-text-engine.ts` — extend `CompletionProvider` type, add `CompletionItem.matches`, add `refreshTypeahead()`

**Tasks:**
- [ ] In `tug-text-engine.ts`: extend `CompletionProvider` type to support optional `subscribe`:
  ```typescript
  export type CompletionProvider = ((query: string) => CompletionItem[]) & {
    subscribe?: (listener: () => void) => () => void;
  };
  ```
- [ ] In `tug-text-engine.ts`: add `matches?: [number, number][]` to `CompletionItem` interface
- [ ] In `tug-text-engine.ts`: add `refreshTypeahead()` method — if typeahead is active, re-call `this._typeahead.provider(this._typeahead.query)`, update `this._typeahead.filtered`, clamp `selectedIndex`, fire `onTypeaheadChange`
- [ ] In `tug-text-engine.ts`: in `detectTypeaheadTrigger()`, after setting `this._typeahead.provider`, check for `provider.subscribe`. If present, subscribe and store the unsubscribe function in `this._typeahead.unsubscribe`. The listener calls `this.refreshTypeahead()`.
- [ ] In `tug-text-engine.ts`: add `unsubscribe: (() => void) | null` to `_typeahead` state. In typeahead deactivation, call `this._typeahead.unsubscribe?.()` and null it out.
- [ ] Create `tugdeck/src/lib/filetree-store.ts` with `FileTreeStore` class
- [ ] Implement `subscribe(listener)` / `getSnapshot()` returning `FileTreeResultSnapshot`
- [ ] Constructor takes `FeedStore`, subscribes to `FeedId.FILETREE` for response payloads, parses JSON into `FileTreeResultSnapshot`
- [ ] Implement `sendQuery(query: string)`: builds `{ query }` JSON payload, sends as `Frame` on `FeedId.FILETREE_QUERY` via the FeedStore's connection
- [ ] Implement `getFileCompletionProvider()`: returns a single stable closure with attached `subscribe` method ([D07]). The closure calls `sendQuery(query)` and returns current `this._snapshot.results` mapped to `CompletionItem[]` (including `matches` field). The `subscribe` property delegates to `this.subscribe()`.
- [ ] Implement `dispose()` to unsubscribe from FeedStore
- [ ] Default snapshot: `{ query: "", results: [], truncated: false }`
- [ ] Create `tugdeck/src/__tests__/filetree-store.test.ts`:
  - Mock FeedStore that delivers a FILETREE response JSON payload — verify `getSnapshot()` returns parsed results
  - `getFileCompletionProvider()` returns a stable closure with `subscribe` method
  - After snapshot update, `subscribe` listener fires; re-calling provider returns updated results
  - Provider function reference is identical across multiple `getFileCompletionProvider()` calls
  - `sendQuery()` sends correctly formatted FILETREE_QUERY frame
  - `CompletionItem` results include `matches` field from scored results

**Tests:**
- [ ] FileTreeStore parses FILETREE response, returns scored completion items with match ranges via subscribable provider

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 9: Wire FileTreeStore into gallery card and render match highlights {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): gallery card @-trigger uses live FileTreeStore with match highlighting`

**References:** [D07] Subscribable provider, [D08] Gallery FeedStore, Spec S06, (#success-criteria, #symbols)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-prompt-input.tsx`
- Modified typeahead menu rendering in `tugdeck/src/components/tugways/tug-prompt-input.tsx` (match highlight rendering)
- Removed `tugdeck/src/lib/file-completion-provider.ts` (no longer needed)

**Tasks:**
- [ ] In `buildGalleryStores()`: add `FeedId.FILETREE` and `FeedId.FILETREE_QUERY` to the FeedStore's `feedIds` array. Create `FileTreeStore` from the FeedStore. Return it in the result object. No null check, no fallback — tugcast is always running when cards are visible.
- [ ] At module level: destructure `fileTreeStore: _fileTreeStore` from `buildGalleryStores()`
- [ ] Replace `const galleryFileCompletionProvider = createFileCompletionProvider(TYPEAHEAD_FILES)` with `const galleryFileCompletionProvider = _fileTreeStore.getFileCompletionProvider()`
- [ ] **Remove** the `TYPEAHEAD_FILES` constant entirely — it was development scaffolding
- [ ] **Remove** `file-completion-provider.ts` — `createFileCompletionProvider` is no longer used
- [ ] Update typeahead menu rendering in `tug-prompt-input.tsx` to use `CompletionItem.matches` when present:
  - When rendering a completion item label, check for `item.matches`
  - If present, split the label into segments: unmatched characters render normally, matched character ranges render with a highlight CSS class (e.g., `tug-typeahead-match`)
  - If absent (command completion), render label as plain text — backward compatible
- [ ] Add CSS for `.tug-typeahead-match`: `font-weight: 600` or similar emphasis (theme-token-driven per L15 if interactive, otherwise static styling per L15)

**Tests:**
- [ ] N/A — gallery wiring and rendering verified by existing test suite and visual checkpoint

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 10: End-to-End Integration Checkpoint {#step-10}

**Depends on:** #step-7, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify full Rust build and test suite passes
- [ ] Verify full tugdeck test suite passes
- [ ] Verify FILESYSTEM wire format unchanged
- [ ] Verify FILETREE (0x11) and FILETREE_QUERY (0x12) registered in both Rust and TypeScript protocol files

**Tests:**
- [ ] N/A — verification-only step

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugrust && cargo nextest run`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `grep -r 'FILETREE' /Users/kocienda/Mounts/u/src/tugtool/tugrust/crates/tugcast-core/src/protocol.rs /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/protocol.ts` — both files contain FILETREE and FILETREE_QUERY

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Live fuzzy-scored file completion for the `@` trigger — tugcast indexes project files via a shared FileWatcher service, scores queries with a two-layer fuzzy matcher in Rust, and returns top-N scored results to tugdeck via a query/response channel.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] FileWatcher shared service: single `notify` watcher with `WalkBuilder`-grade nested gitignore, broadcast to multiple consumers (`cargo nextest run` passes)
- [x] FILESYSTEM feed refactored to consume FileWatcher broadcast (wire format unchanged, existing consumers unaffected)
- [ ] Fuzzy scorer: character-level DP + path-aware structural wrapper scores correctly (basename preference, word-boundary bonuses, camelCase)
- [ ] FILETREE query/response: client sends query on 0x12, receives top-N scored results on 0x11
- [ ] FileTreeStore in tugdeck: sends queries, exposes subscribable `getFileCompletionProvider()` [L22, D07]
- [ ] Gallery card `@` trigger shows live fuzzy-scored project files with match highlighting
- [ ] `cd tugrust && cargo nextest run` passes
- [ ] `cd tugdeck && bun test` passes

**Acceptance tests:**
- [x] FileWatcher `walk()` returns correct relative paths respecting nested `.gitignore` (Rust unit test)
- [ ] Fuzzy scorer: `"sms"` matches `"session-metadata-store.ts"`, `"model"` prefers basename match over directory match (Rust unit test)
- [ ] FileTreeFeed applies Created/Removed/Renamed, ignores Modified, responds to queries with scored results (Rust unit test)
- [ ] FileTreeStore parses FILETREE response and returns scored completion items (TypeScript unit test)
- [x] FILESYSTEM integration test passes unchanged after refactor (Rust integration test)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Frecency / recency weighting for completion ranking
- [ ] UI hint when `truncated: true`
- [ ] tug-prompt-entry integration (T3.4)
- [ ] Lagged recovery: re-walk on `RecvError::Lagged` in FileTreeFeed
- [ ] Multi-term queries (space-separated) for Quick Open-style picker
