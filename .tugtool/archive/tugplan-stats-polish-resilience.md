## Phase 3.0: Stats, Polish, Resilience {#phase-stats-polish-resilience}

**Purpose:** Transform tugcast and tugdeck into a production-quality tool with extensible stats collection, reconnection handling, card collapse/expand, WebGL terminal rendering, CLI polish, and user-facing error handling.

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

Phase 1 (Terminal Bridge, committed as b49b338) proved the end-to-end architecture. Phase 2 (Multi-Card Deck, committed as 675f6a7) added filesystem and git feeds, a CSS Grid layout with four card slots, and drag-handle resize. The stats card remains a "Coming soon" stub. tugdeck has no reconnection handling -- if the WebSocket drops, the user sees nothing until a manual refresh. There is no card collapse/expand, no layout persistence, and the terminal card uses the default canvas renderer. The CLI lacks polish (no custom `--help` template, no `--version` flag), and errors are logged via `tracing` but not surfaced cleanly to the user.

Phase 3 completes tugcast and tugdeck as a production-quality tool by shipping six capabilities: (1) a stats tugfeed framework with pluggable collectors, each running as a separate SnapshotFeed for maximum flexibility; (2) a stats tugcard with sparklines; (3) reconnection handling with a non-modal banner and exponential backoff; (4) card collapse/expand with layout persistence; (5) WebGL progressive enhancement for the terminal card; (6) CLI polish and user-facing error handling. The authoritative design reference is `roadmap/component-roadmap.md`, sections 5.5, 5.6, 5.7, 7.2, 7.4, 7.7, 9.2, 9.3, 10, 11, and 12.

#### Strategy {#strategy}

- Build backend first: stats framework and collectors in tugcast-core and tugcast, with new FeedId variants for each stat collector (0x30, 0x31, 0x32)
- Each StatCollector is a separate SnapshotFeed with its own FeedId, watch channel, and independent timer -- this keeps collectors isolated, testable, and easy to add or remove without protocol changes
- Extend the frontend in layers: stats card with sparklines first, then reconnection, then collapse/expand with layout persistence, then WebGL
- CLI polish and error handling are done as a final step since they touch many files but are low-risk
- Each step produces a compilable, testable increment that can be validated independently
- Frontend reconnection is implemented in connection.ts with exponential backoff, decoupled from the stats and layout work

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code users who want operational visibility (stats, resilient connection, polished UX)
2. Tugtool developers who need a stable foundation for future extensions (new stat collectors, custom cards)

#### Success Criteria (Measurable) {#success-criteria}

- Stats card renders current values from at least three built-in collectors (process info, token usage, build status)
- Sparklines render correctly for numeric stat values with at least 20 historical data points retained client-side
- Reconnection: after WebSocket drop, tugdeck shows "Disconnected" banner within 1 second and auto-retries with exponential backoff (2s, 4s, 8s, max 30s)
- After reconnect, terminal state is restored via capture-pane within 500ms and stats/git/fs snapshots arrive immediately
- Collapsed cards show header-only with expand button and still occupy their grid cell
- Layout state (column/row splits, collapsed cards) survives browser refresh via localStorage
- WebGL renderer activates silently when available; canvas fallback works when WebGL is unavailable
- `tugcast --help` prints formatted usage with description; `tugcast --version` prints version
- Error messages for CLI errors, WebSocket close, and feed failures are clean single-line messages (no stack traces, no raw tracing output)
- `cargo build --workspace` and `cargo nextest run` pass with zero warnings
- `cargo clippy --workspace -- -D warnings` passes

#### Scope {#scope}

1. `tugcast-core`: StatCollector trait, StatSnapshot type, new FeedId variants (Stats=0x30, StatsProcessInfo=0x31, StatsTokenUsage=0x32, StatsBuildStatus=0x33)
2. `tugcast`: Stats feed module with pluggable collector architecture; built-in collectors for process info, Claude Code token usage, build status
3. `tugcast`: Feed router extended to register stats watch channels alongside existing snapshot feeds
4. `tugdeck`: Stats card rewritten from stub to real implementation with sparklines (HTML5 Canvas 2D)
5. `tugdeck`: Reconnection handling in connection.ts with "Disconnected" banner and exponential backoff
6. `tugdeck`: Card collapse/expand in deck.ts with header-only collapsed view
7. `tugdeck`: Layout persistence in localStorage (column/row splits, collapsed state)
8. `tugdeck`: WebGL progressive enhancement for terminal card via `@xterm/addon-webgl`
9. `tugcast`: CLI polish -- custom `--help` template, `--version` flag, clean error messages
10. User-facing error handling: CLI argument errors, WebSocket close reasons, feed startup failures

#### Non-goals (Explicitly out of scope) {#non-goals}

- Observe-only mode for tugdeck -- future
- Adaptive git polling acceleration (500ms on FS events) -- future
- Tree view in files card (on-demand via control feed) -- future
- Multiple tmux pane support -- future
- Windows platform support -- not planned
- Custom/user-defined stat collectors loaded at runtime -- future (the trait is extensible but registration is compile-time only in Phase 3)
- Server-side reconnection state persistence (reconnect relies on tmux capture-pane and watch channel semantics, no server-side session store)
- Authentication refresh on reconnect (existing cookie session is reused)

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 (Terminal Bridge) committed as b49b338
- Phase 2 (Multi-Card Deck) committed as 675f6a7
- `sysinfo` crate for cross-platform process info collection
- `@xterm/addon-webgl` npm package for WebGL terminal rendering
- Existing Phase 1+2 infrastructure: tugcast-core (protocol, feed traits, types), tugcast (server, auth, terminal/filesystem/git feeds, router), tugdeck (connection, protocol, deck, all cards)

#### Constraints {#constraints}

- macOS and Linux only (no Windows) per AD-6
- Binds exclusively to 127.0.0.1 per section 8.1
- Warnings are errors (`-D warnings` via `.cargo/config.toml`)
- No cross-dependency between tugcast and tugtool crates per AD-5
- Token usage collector is best-effort (fragile regex on tmux status line; may break on upstream Claude Code UI changes)
- Stats FeedId range 0x30-0x3F is reserved for stats collectors; each collector gets a unique FeedId

#### Assumptions {#assumptions}

- Each StatCollector runs as a separate SnapshotFeed with its own FeedId and watch channel, enabling independent collection intervals and isolated failure domains
- The `sysinfo` crate provides cross-platform access to process CPU and memory usage on macOS and Linux
- Claude Code token usage can be extracted from tmux pane output via regex pattern matching on the status line (fragile, best-effort)
- Build status is derived from `target/` directory modification times, detected via filesystem feed events or a simple stat() poll
- `@xterm/addon-webgl` 0.19.x is compatible with `@xterm/xterm` 6.x already in use
- Layout persistence uses `JSON.stringify` of grid state stored in localStorage under the key `tugdeck-layout`
- Reconnection reuses the existing session cookie (cookie TTL default 24 hours exceeds typical session length)
- The feed router already supports a `Vec<watch::Receiver<Frame>>` for snapshot feeds; adding stats collectors means appending more watch receivers to this vector
- The existing FeedId test `assert_eq!(FeedId::from_byte(0x30), None)` must be updated since 0x30 will now be a valid FeedId

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token usage regex breaks on Claude Code UI update | low | high | Collector logs warning and returns null; stats card shows "N/A" | If Claude Code changes status line format |
| `sysinfo` crate pulls in heavy dependencies | low | low | Feature-gate to minimal process info only | If compile time increases >30s |
| WebGL addon fails on headless/CI environments | low | medium | Silent fallback to canvas; no error surfaced to user | If WebGL tests fail in CI |
| Reconnection loop causes server resource exhaustion | medium | low | Max backoff 30s, exponential curve, single retry at a time | If server logs show excessive reconnection attempts |

**Risk R01: Token Usage Collector Fragility** {#r01-token-usage-fragility}

- **Risk:** The Claude Code token usage collector parses tmux pane output via regex. Upstream Claude Code UI changes can break the regex without warning.
- **Mitigation:** The collector returns `serde_json::Value::Null` on parse failure. The stats card renders "N/A" for null values. The collector logs a warning (not an error) on first parse failure per session.
- **Residual risk:** The collector may silently produce no data for extended periods if the regex is broken.

**Risk R02: WebGL Compatibility** {#r02-webgl-compat}

- **Risk:** `@xterm/addon-webgl` may fail to initialize in environments without GPU support (headless browsers, remote desktops, some Linux configurations).
- **Mitigation:** Progressive enhancement: try `webglAddon.open(terminal)`, catch the exception, fall back to default canvas renderer. No error message shown to user.
- **Residual risk:** Performance difference between WebGL and canvas may be noticeable on large terminal output.

---

### 3.0.0 Design Decisions {#design-decisions}

#### [D01] Each StatCollector is a separate SnapshotFeed with its own FeedId (DECIDED) {#d01-stat-collector-per-feed}

**Decision:** Each stat collector (process info, token usage, build status) runs as an independent SnapshotFeed implementation with its own FeedId (0x31, 0x32, 0x33) and watch channel. A combined stats summary feed (0x30) aggregates all collector outputs for backward compatibility.

**Rationale:**
- Per user answer: "Each StatCollector is a separate SnapshotFeed (0x30, 0x31, 0x32...) for prototyping flexibility and future expansion"
- Separate feeds allow independent collection intervals (process info every 5s, token usage on-change, build status on FS event)
- Isolated failure domains: one collector crashing does not affect others
- Future collectors can be added by registering a new FeedId without modifying existing code

**Implications:**
- FeedId enum gains four new variants: Stats (0x30), StatsProcessInfo (0x31), StatsTokenUsage (0x32), StatsBuildStatus (0x33)
- The feed router receives additional watch channels for each stats collector
- The stats card subscribes to all stats FeedIds (0x30-0x33) and renders each collector's data in a sub-card
- The 0x30 feed carries a JSON map aggregating all collectors, useful for summary display

#### [D02] StatCollector trait with serde_json::Value return type (DECIDED) {#d02-stat-collector-trait}

**Decision:** The `StatCollector` trait returns `serde_json::Value` for maximum flexibility. Each collector defines its own JSON schema.

**Rationale:**
- Per clarifier assumption: `StatCollector` trait returns `serde_json::Value` for maximum flexibility
- Different collectors produce fundamentally different data shapes (CPU percentage, token count, build pass/fail)
- Using `serde_json::Value` avoids a rigid type hierarchy that would need modification for each new collector

**Implications:**
- The stats card must handle heterogeneous JSON values
- Each collector documents its JSON schema in code comments
- The trait includes `name()`, `collect()`, and `interval()` methods per roadmap section 5.5

#### [D03] Sparklines rendered with HTML5 Canvas 2D (DECIDED) {#d03-sparklines-canvas}

**Decision:** Sparklines in the stats card are rendered using the HTML5 Canvas 2D API directly. No charting library.

**Rationale:**
- Per clarifier assumption: sparklines use Canvas 2D, not a charting library
- Sparklines are simple line charts: a single polyline over a fixed-width canvas
- Adding a charting library (Chart.js, d3-sparkline) would be disproportionate to the rendering needs
- Canvas 2D is universally available in all target browsers

**Implications:**
- Stats card maintains a ring buffer of historical values per collector (configurable, default 60 data points)
- Canvas element is sized to the sub-card dimensions
- Sparkline rendering is a simple loop: clear canvas, draw polyline from ring buffer

#### [D04] Reconnection with non-modal banner and exponential backoff (DECIDED) {#d04-reconnect-banner}

**Decision:** On WebSocket disconnection, tugdeck shows a non-modal "Disconnected" banner at the top of the viewport. The user can still see cached card data. Auto-retry uses exponential backoff: 2s, 4s, 8s, 16s, max 30s.

**Rationale:**
- Per user answer: "Non-modal banner at top of viewport, user can still see cached data"
- Per clarifier assumption: exponential backoff (2s, 4s, 8s, max 30s)
- Per roadmap section 9.3: tugdeck shows "Disconnected" banner and attempts reconnection
- Non-modal preserves context: the user can still read the last terminal state, git status, etc.

**Implications:**
- `connection.ts` gains reconnection logic with state machine: CONNECTED -> DISCONNECTED -> RECONNECTING -> CONNECTED
- A `div.disconnect-banner` element is inserted at the top of the viewport when disconnected
- On successful reconnect, the banner is removed and the terminal enters BOOTSTRAP for capture-pane resync
- Snapshot feeds (git, fs, stats) deliver latest state immediately via watch channel semantics

#### [D05] Card collapse shows header-only, still occupies grid cell (DECIDED) {#d05-card-collapse}

**Decision:** Collapsed cards display only their header bar with an expand button. The collapsed card still occupies its CSS Grid cell. Collapse state is persisted in localStorage.

**Rationale:**
- Per user answer: "Header-only -- collapsed card shows just header bar with expand button, still in grid"
- Keeping the grid cell avoids layout reflow that would disrupt the terminal card sizing
- Persisting collapse state prevents user frustration on refresh

**Implications:**
- TugCard interface gains optional `collapse()` and `expand()` methods (or the deck manager controls visibility)
- Collapsed cards have a fixed height (header bar height, approximately 32px) instead of flexible grid sizing
- The expand button is part of the card header
- localStorage stores an array of collapsed card slot names

#### [D06] WebGL as progressive enhancement (DECIDED) {#d06-webgl-progressive}

**Decision:** The terminal card loads `@xterm/addon-webgl` and attempts to activate it. If WebGL initialization fails, the card falls back to the default canvas renderer silently.

**Rationale:**
- Per user answer: "Progressive enhancement -- try WebGL, fall back to canvas silently on failure"
- Per roadmap section 7.4: `@xterm/addon-webgl` for GPU-accelerated rendering (falls back to canvas)
- WebGL provides significantly better rendering performance for large terminal output

**Implications:**
- `@xterm/addon-webgl` added to tugdeck package.json
- terminal-card.ts imports the addon and wraps `addon.open(terminal)` in a try/catch
- No user-visible error or warning on WebGL failure
- build.rs esbuild bundle includes the WebGL addon code

#### [D07] CLI polish with clap built-in help and version (DECIDED) {#d07-cli-polish}

**Decision:** Use clap's built-in `--help` and `--version` flags with custom about text and version string derived from Cargo.toml. Error messages are formatted as clean single-line messages.

**Rationale:**
- Per clarifier assumption: CLI uses clap's built-in --help and --version with custom templates
- Per roadmap section 12 Phase 3 scope: CLI polish (--help, --version, clean error messages)
- clap already provides these; the work is adding custom about text and version metadata

**Implications:**
- `Cli` struct in cli.rs gets `#[command(version)]` attribute
- Custom about/long_about text describes tugcast's purpose
- main.rs wraps startup errors in user-friendly messages (no tracing output for user-facing errors)

#### [D08] User-facing error handling for CLI, WebSocket, and feeds (DECIDED) {#d08-user-facing-errors}

**Decision:** User-facing error handling covers three surfaces: CLI argument errors (clap handles), WebSocket close events (tugdeck displays reason), and feed startup failures (tugcast prints clean message and exits). Internal errors continue to use tracing.

**Rationale:**
- Per user answer: "User-facing only -- CLI, WebSocket close, feed failures -- clean messages for the operator"
- Operators should not see Rust backtraces or raw tracing output
- Different error surfaces require different handling strategies

**Implications:**
- CLI errors: clap formats these automatically with usage hints
- WebSocket close: connection.ts reads the close code/reason and displays in the disconnect banner
- Feed failures: main.rs catches feed initialization errors and prints `tugcast: error: <message>` to stderr before exiting
- tracing continues for debug-level diagnostics (controlled via RUST_LOG)

#### [D09] Stats FeedId allocation (DECIDED) {#d09-stats-feedid-allocation}

**Decision:** Stats feeds use FeedId range 0x30-0x3F. The aggregate stats feed is 0x30. Individual collectors get sequential IDs: ProcessInfo=0x31, TokenUsage=0x32, BuildStatus=0x33.

**Rationale:**
- The roadmap allocates 0x30 for stats
- A range allows up to 16 stats collectors without protocol changes
- The aggregate feed (0x30) provides a combined view for simple consumers

**Implications:**
- FeedId enum gains: Stats=0x30, StatsProcessInfo=0x31, StatsTokenUsage=0x32, StatsBuildStatus=0x33
- protocol.ts gains matching constants
- The existing test `assert_eq!(FeedId::from_byte(0x30), None)` in protocol.rs must be updated

---

### 3.0.1 Stats Feed Specification {#stats-feed-spec}

**Spec S01: StatCollector Trait** {#s01-stat-collector-trait}

```rust
/// A pluggable stats collector that produces periodic snapshots.
///
/// Each collector runs on its own timer and produces a JSON value
/// representing its current measurement.
pub trait StatCollector: Send + Sync {
    /// Unique name for this collector (e.g., "process_info")
    fn name(&self) -> &str;

    /// The FeedId for this collector's individual feed
    fn feed_id(&self) -> FeedId;

    /// Collect current stats, returning a JSON value.
    /// Returns Value::Null on collection failure.
    fn collect(&self) -> serde_json::Value;

    /// Collection interval
    fn interval(&self) -> Duration;
}
```

**Spec S02: Built-in Collector JSON Schemas** {#s02-collector-schemas}

ProcessInfo collector (FeedId 0x31, interval 5s):
```json
{
  "name": "process_info",
  "pid": 12345,
  "cpu_percent": 12.5,
  "memory_mb": 256.3,
  "uptime_secs": 3600
}
```

TokenUsage collector (FeedId 0x32, interval 10s):
```json
{
  "name": "token_usage",
  "input_tokens": 15000,
  "output_tokens": 8000,
  "total_tokens": 23000,
  "context_window_percent": 45.2
}
```
Returns `null` on parse failure.

BuildStatus collector (FeedId 0x33, interval 10s):
```json
{
  "name": "build_status",
  "last_build_time": "2026-02-15T10:30:00Z",
  "target_modified_secs_ago": 45,
  "status": "idle"
}
```
Status values: `"building"` (target/ modified in last 10s), `"idle"` (otherwise).

**Spec S03: Aggregate Stats Feed (0x30)** {#s03-aggregate-stats}

```json
{
  "collectors": {
    "process_info": { ... },
    "token_usage": { ... },
    "build_status": { ... }
  },
  "timestamp": "2026-02-15T10:30:05Z"
}
```

The aggregate feed updates whenever any individual collector updates. It is a convenience feed for consumers that want all stats in one frame.

---

### 3.0.2 Reconnection Specification {#reconnection-spec}

**Spec S04: Reconnection State Machine** {#s04-reconnect-state-machine}

```
   WebSocket open
        |
        v
  +-----------+
  | CONNECTED | <------- reconnect succeeds
  +-----------+          |
        |                |
  WebSocket close/error  |
        |                |
        v                |
  +--------------+       |
  | DISCONNECTED |       |
  | show banner  |       |
  +--------------+       |
        |                |
  start retry timer      |
        |                |
        v                |
  +---------------+      |
  | RECONNECTING  |------+
  | attempt conn  |
  +---------------+
        |
  connection fails
        |
        v
  back to DISCONNECTED
  (increase backoff)
```

Backoff sequence: 2s, 4s, 8s, 16s, 30s (capped). Reset to 2s on successful reconnect.

**Spec S05: Disconnect Banner** {#s05-disconnect-banner}

- Position: fixed at top of viewport, full width, z-index above all cards
- Content: "Disconnected -- reconnecting in Ns..." (countdown updates each second)
- Style: semi-transparent dark background with white text
- Behavior: does NOT block interaction with cached card content below
- Removed immediately on successful reconnect

---

### 3.0.3 Card Collapse Specification {#card-collapse-spec}

**Spec S06: Collapse/Expand Behavior** {#s06-collapse-expand}

- Each card header gains a collapse/expand toggle button (chevron icon or +/- text)
- Collapsed state: card content is hidden (`display: none`); only the header bar is visible
- The grid cell remains; the row height shrinks to the header height (~32px)
- Expand restores the card content and the grid row reverts to its previous fraction
- Terminal card cannot be collapsed (it is the primary content)
- Collapse/expand is animated with a CSS transition on `max-height` or `grid-template-rows`

**Spec S07: Layout Persistence** {#s07-layout-persistence}

Stored in localStorage under key `tugdeck-layout`:

```json
{
  "version": 1,
  "colSplit": 0.667,
  "rowSplits": [0.333, 0.667],
  "collapsed": ["stats"]
}
```

- On load: read from localStorage, validate version, apply. On invalid or missing, use defaults.
- On change (drag, collapse/expand): debounce 500ms, then write to localStorage.
- The `version` field allows future migration of the schema.

---

### 3.0.4 Symbol Inventory {#symbol-inventory}

#### 3.0.4.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugcast/src/feeds/stats.rs` | Stats feed module: StatCollector runner, aggregate feed |
| `crates/tugcast/src/feeds/stats/mod.rs` | Stats feed module root (if using subdirectory for collectors) |
| `crates/tugcast/src/feeds/stats/process_info.rs` | ProcessInfo collector using sysinfo crate |
| `crates/tugcast/src/feeds/stats/token_usage.rs` | TokenUsage collector parsing tmux pane output |
| `crates/tugcast/src/feeds/stats/build_status.rs` | BuildStatus collector watching target/ directory |

#### 3.0.4.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugcast-core/src/protocol.rs` | Add Stats, StatsProcessInfo, StatsTokenUsage, StatsBuildStatus FeedId variants; update from_byte() |
| `crates/tugcast-core/src/types.rs` | Add StatSnapshot type |
| `crates/tugcast-core/src/lib.rs` | Re-export new types |
| `crates/tugcast-core/Cargo.toml` | No changes expected (serde_json already present) |
| `crates/tugcast/Cargo.toml` | Add sysinfo workspace dependency |
| `crates/tugcast/src/feeds/mod.rs` | Add `pub mod stats` |
| `crates/tugcast/src/main.rs` | Create and register stats feeds; improved error handling |
| `crates/tugcast/src/cli.rs` | Add `#[command(version)]`, custom about text |
| `crates/tugcast/src/router.rs` | No structural changes (additional watch receivers passed at construction) |
| `tugdeck/package.json` | Add `@xterm/addon-webgl` dependency |
| `tugdeck/src/protocol.ts` | Add STATS, STATS_PROCESS_INFO, STATS_TOKEN_USAGE, STATS_BUILD_STATUS constants |
| `tugdeck/src/connection.ts` | Add reconnection state machine, disconnect banner, exponential backoff |
| `tugdeck/src/deck.ts` | Add collapse/expand logic, layout persistence in localStorage |
| `tugdeck/src/cards/stats-card.ts` | Complete rewrite: sub-cards per collector, sparklines via Canvas 2D |
| `tugdeck/src/cards/terminal-card.ts` | Add WebGL addon with progressive fallback |
| `tugdeck/src/cards/card.ts` | Add optional collapse/expand support to TugCard interface |
| `tugdeck/styles/deck.css` | Add disconnect banner styles, collapse transition styles |
| `tugdeck/styles/cards.css` | Add stats sub-card and sparkline canvas styles |
| `tugdeck/index.html` | Add disconnect banner element |
| `Cargo.toml` (workspace) | Add `sysinfo` to workspace dependencies |

#### 3.0.4.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FeedId::Stats` | enum variant | `tugcast-core/src/protocol.rs` | = 0x30 (aggregate) |
| `FeedId::StatsProcessInfo` | enum variant | `tugcast-core/src/protocol.rs` | = 0x31 |
| `FeedId::StatsTokenUsage` | enum variant | `tugcast-core/src/protocol.rs` | = 0x32 |
| `FeedId::StatsBuildStatus` | enum variant | `tugcast-core/src/protocol.rs` | = 0x33 |
| `StatCollector` | trait | `tugcast/src/feeds/stats/mod.rs` | name(), feed_id(), collect(), interval() |
| `ProcessInfoCollector` | struct | `tugcast/src/feeds/stats/process_info.rs` | Implements StatCollector; uses sysinfo |
| `TokenUsageCollector` | struct | `tugcast/src/feeds/stats/token_usage.rs` | Implements StatCollector; parses tmux output |
| `BuildStatusCollector` | struct | `tugcast/src/feeds/stats/build_status.rs` | Implements StatCollector; watches target/ |
| `StatsRunner` | struct | `tugcast/src/feeds/stats/mod.rs` | Manages collector lifecycle, produces aggregate feed |
| `STATS` | const | `tugdeck/src/protocol.ts` | = 0x30 |
| `STATS_PROCESS_INFO` | const | `tugdeck/src/protocol.ts` | = 0x31 |
| `STATS_TOKEN_USAGE` | const | `tugdeck/src/protocol.ts` | = 0x32 |
| `STATS_BUILD_STATUS` | const | `tugdeck/src/protocol.ts` | = 0x33 |
| `StatsCard` | class (rewritten) | `tugdeck/src/cards/stats-card.ts` | Sub-cards, sparklines, Canvas 2D |
| `Sparkline` | class | `tugdeck/src/cards/stats-card.ts` | Canvas 2D sparkline renderer |
| `ConnectionState` | enum-like | `tugdeck/src/connection.ts` | CONNECTED, DISCONNECTED, RECONNECTING |
| `DeckManager.collapseCard` | method | `tugdeck/src/deck.ts` | Collapse a card to header-only |
| `DeckManager.expandCard` | method | `tugdeck/src/deck.ts` | Expand a collapsed card |
| `DeckManager.saveLayout` | method | `tugdeck/src/deck.ts` | Persist layout to localStorage |
| `DeckManager.loadLayout` | method | `tugdeck/src/deck.ts` | Restore layout from localStorage |

---

### 3.0.5 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test StatCollector implementations, FeedId extensions, sparkline math, layout serialization, backoff calculation | Core logic, edge cases |
| **Integration** | Test stats feed with real collectors, reconnection round-trip, end-to-end stats delivery | End-to-end paths |
| **Golden / Contract** | Verify JSON payload format for stat collector outputs | Protocol compliance |

#### Test Dependencies {#test-dependencies}

- Stats collector tests may use mocked system info (process info collector)
- Token usage tests use test fixture strings mimicking tmux status line output
- Build status tests use tempdir with a mock `target/` directory
- Reconnection tests require the tokio test runtime for WebSocket lifecycle simulation

---

### 3.0.6 Execution Steps {#execution-steps}

#### Step 0: Extend tugcast-core with stats FeedId variants and types {#step-0}

**Commit:** `feat(tugcast-core): add Stats FeedId variants and StatCollector-related types`

**References:** [D01] StatCollector per-feed, [D02] StatCollector trait, [D09] Stats FeedId allocation, Spec S01, Spec S02, (#stats-feed-spec, #symbols)

**Artifacts:**
- `crates/tugcast-core/src/protocol.rs` -- FeedId gains Stats (0x30), StatsProcessInfo (0x31), StatsTokenUsage (0x32), StatsBuildStatus (0x33)
- `crates/tugcast-core/src/types.rs` -- StatSnapshot type for aggregate stats
- `crates/tugcast-core/src/lib.rs` -- updated re-exports
- `tugdeck/src/protocol.ts` -- add STATS, STATS_PROCESS_INFO, STATS_TOKEN_USAGE, STATS_BUILD_STATUS constants

**Tasks:**
- [ ] Add `Stats = 0x30`, `StatsProcessInfo = 0x31`, `StatsTokenUsage = 0x32`, `StatsBuildStatus = 0x33` variants to FeedId enum
- [ ] Update `FeedId::from_byte()` to handle 0x30, 0x31, 0x32, 0x33
- [ ] Update existing test `test_feedid_from_byte` that asserts `FeedId::from_byte(0x30)` returns None -- it should now return `Some(Stats)`
- [ ] Add `StatSnapshot` struct to types.rs: `{ collectors: HashMap<String, serde_json::Value>, timestamp: String }`
- [ ] Re-export `StatSnapshot` from lib.rs
- [ ] Add `STATS: 0x30`, `STATS_PROCESS_INFO: 0x31`, `STATS_TOKEN_USAGE: 0x32`, `STATS_BUILD_STATUS: 0x33` to FeedId constants in protocol.ts
- [ ] Update `FeedIdValue` type in protocol.ts to include new constants

**Tests:**
- [ ] Unit test: FeedId round-trip for all four new stats variants
- [ ] Unit test: StatSnapshot serialization to JSON and deserialization back
- [ ] Unit test: existing protocol tests pass with updated assertions
- [ ] Golden test: verify exact wire bytes for Stats feed frame

**Checkpoint:**
- [ ] `cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast-core` -- all tests pass
- [ ] `cargo build --workspace` succeeds (existing tugcast code compiles with extended FeedId)
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds

**Rollback:**
- Revert commit, restore original FeedId enum and protocol.ts

**Commit after all checkpoints pass.**

---

#### Step 1: Implement stats feed framework and collectors {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugcast): implement stats feed framework with process info, token usage, and build status collectors`

**References:** [D01] StatCollector per-feed, [D02] StatCollector trait, Spec S01, Spec S02, Spec S03, Risk R01, (#stats-feed-spec, #symbols, #new-files)

**Artifacts:**
- `crates/tugcast/src/feeds/stats/mod.rs` -- StatCollector trait, StatsRunner, aggregate feed logic
- `crates/tugcast/src/feeds/stats/process_info.rs` -- ProcessInfoCollector
- `crates/tugcast/src/feeds/stats/token_usage.rs` -- TokenUsageCollector
- `crates/tugcast/src/feeds/stats/build_status.rs` -- BuildStatusCollector
- `crates/tugcast/src/feeds/mod.rs` -- add `pub mod stats`
- `crates/tugcast/Cargo.toml` -- add `sysinfo` dependency
- `Cargo.toml` (workspace) -- add `sysinfo` to workspace dependencies

**Tasks:**
- [ ] Add `sysinfo` to workspace dependencies in root Cargo.toml; add `sysinfo = { workspace = true }` to tugcast Cargo.toml
- [ ] Create `crates/tugcast/src/feeds/stats/mod.rs` with:
  - `StatCollector` trait: `name() -> &str`, `feed_id() -> FeedId`, `collect() -> serde_json::Value`, `interval() -> Duration`
  - `StatsRunner` struct: holds a `Vec<Box<dyn StatCollector>>`, manages per-collector tokio tasks, produces aggregate feed on 0x30
  - `run_collector()` function: spawns a task per collector that calls `collect()` on its interval, sends result on the collector's individual watch channel, and notifies the aggregate feed
- [ ] Create `process_info.rs`: `ProcessInfoCollector` using `sysinfo::System` to report PID, CPU%, memory MB, uptime. Collection interval: 5 seconds. Returns JSON per Spec S02.
- [ ] Create `token_usage.rs`: `TokenUsageCollector` that runs `tmux capture-pane -t <session> -p` and applies regex to extract token counts from Claude Code status line. Collection interval: 10 seconds. Returns `Value::Null` on parse failure per Risk R01. Logs warning on first failure.
- [ ] Create `build_status.rs`: `BuildStatusCollector` that stat()'s `target/` directory to check last modification time. Collection interval: 10 seconds. Returns "building" if modified within 10 seconds, "idle" otherwise.
- [ ] Add `pub mod stats` to `crates/tugcast/src/feeds/mod.rs`
- [ ] Each collector implements SnapshotFeed via a wrapper that calls `collect()` on the configured interval

**Tests:**
- [ ] Unit test: ProcessInfoCollector.collect() returns valid JSON with pid, cpu_percent, memory_mb fields
- [ ] Unit test: TokenUsageCollector.collect() returns Null when given an unparseable string
- [ ] Unit test: TokenUsageCollector.collect() returns valid JSON when given a fixture string matching Claude Code format
- [ ] Unit test: BuildStatusCollector returns "idle" when target/ does not exist
- [ ] Unit test: BuildStatusCollector returns "building" when target/ was recently modified (use tempdir)
- [ ] Integration test: StatsRunner starts all collectors and produces aggregate frame on 0x30 watch channel
- [ ] Golden test: verify JSON output format for each collector matches Spec S02

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all stats feed tests pass
- [ ] `cargo build --workspace` succeeds with no warnings

**Rollback:**
- Revert commit, remove stats/ directory, restore original feeds/mod.rs and Cargo.toml files

**Commit after all checkpoints pass.**

---

#### Step 2: Wire stats feeds into main.rs and feed router {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): register stats collector feeds in main.rs and feed router`

**References:** [D01] StatCollector per-feed, [D09] Stats FeedId allocation, Spec S03, (#stats-feed-spec, #strategy)

**Artifacts:**
- `crates/tugcast/src/main.rs` -- create stats collectors, watch channels, register with router
- Integration test updates in `crates/tugcast/src/integration_tests.rs`

**Tasks:**
- [ ] In main.rs, create watch channels for each stats collector: `watch::channel(Frame::new(FeedId::StatsProcessInfo, vec![]))`, etc., plus one for the aggregate stats feed (0x30)
- [ ] Instantiate `ProcessInfoCollector`, `TokenUsageCollector`, `BuildStatusCollector`
- [ ] Create `StatsRunner` with all collectors, pass individual watch senders
- [ ] Start StatsRunner in a background tokio task with the aggregate watch sender and cancellation token
- [ ] Append all stats watch receivers (aggregate + individual) to the `snapshot_watches` vector passed to `FeedRouter::new()`
- [ ] Update `build_test_app()` in `integration_tests.rs` to pass empty watch channels for the new stats feeds (maintaining test compatibility)

**Tests:**
- [ ] Integration test: boot server, connect WebSocket, verify stats frames arrive on feed IDs 0x30, 0x31, 0x32, 0x33
- [ ] Integration test: verify aggregate stats feed (0x30) contains data from all collectors
- [ ] Unit test: existing integration tests still pass with updated FeedRouter signature

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all tests pass
- [ ] `cargo build --workspace` succeeds with no warnings

**Rollback:**
- Revert commit, restore original main.rs and integration_tests.rs

**Commit after all checkpoints pass.**

---

#### Step 3: Rewrite stats card with sparklines {#step-3}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): rewrite stats card with sub-cards per collector and sparklines`

**References:** [D01] StatCollector per-feed, [D03] Sparklines canvas, Spec S02, Spec S03, (#stats-feed-spec, #symbols)

**Artifacts:**
- `tugdeck/src/cards/stats-card.ts` -- complete rewrite: sub-cards per collector, sparkline rendering
- `tugdeck/styles/cards.css` -- stats sub-card and sparkline styles

**Tasks:**
- [ ] Implement `Sparkline` class in stats-card.ts:
  - Constructor takes a canvas element and ring buffer size (default 60)
  - `push(value: number)`: add value to ring buffer, trigger redraw
  - `draw()`: clear canvas, draw polyline from ring buffer values scaled to canvas dimensions
  - Line color: configurable per collector (e.g., green for CPU, blue for tokens)
- [ ] Rewrite `StatsCard` class:
  - `feedIds`: `[FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS]`
  - `mount()`: create container with header ("Stats") and three sub-card containers (one per collector)
  - Each sub-card has: collector name label, current value display, sparkline canvas
  - `onFrame()`: parse JSON payload, update the appropriate sub-card based on feedId:
    - 0x31 (process_info): show CPU% and memory MB, push CPU% to sparkline
    - 0x32 (token_usage): show total tokens and context window %, push total tokens to sparkline; show "N/A" for null
    - 0x33 (build_status): show status badge ("idle"/"building"), push 1/0 to sparkline
    - 0x30 (aggregate): can be used for initial render or ignored if individual feeds are active
  - `onResize()`: resize sparkline canvases
  - `destroy()`: clean up canvases and DOM elements
- [ ] Add CSS styles in cards.css:
  - `.stats-card .stat-sub-card`: flexbox layout with name, value, and sparkline canvas
  - `.stats-card .sparkline-canvas`: fixed height (40px), full width of sub-card
  - `.stats-card .stat-value`: monospace font, right-aligned
  - `.stats-card .stat-na`: dimmed text for "N/A" values

**Tests:**
- [ ] Unit test: Sparkline ring buffer correctly wraps at capacity
- [ ] Unit test: TypeScript compilation succeeds with no errors

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck)

**Rollback:**
- Revert commit, restore stub stats-card.ts

**Commit after all checkpoints pass.**

---

#### Step 4: Implement reconnection handling {#step-4}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): implement reconnection with disconnect banner and exponential backoff`

**References:** [D04] Reconnect banner, [D08] User-facing errors, Spec S04, Spec S05, (#reconnection-spec, #strategy)

**Artifacts:**
- `tugdeck/src/connection.ts` -- reconnection state machine, disconnect banner, exponential backoff
- `tugdeck/styles/deck.css` -- disconnect banner styles
- `tugdeck/index.html` -- add disconnect banner element

**Tasks:**
- [ ] Add `ConnectionState` enum-like constants to connection.ts: `CONNECTED`, `DISCONNECTED`, `RECONNECTING`
- [ ] Add reconnection state tracking to `TugConnection`:
  - `private state: ConnectionState`
  - `private retryDelay: number` (starts at 2000ms)
  - `private retryTimer: number | null`
  - `private maxRetryDelay: number = 30000`
  - `private countdownTimer: number | null` (for banner countdown display)
- [ ] Modify `onclose` handler: transition to DISCONNECTED, show banner, start retry timer
- [ ] Modify `onerror` handler: transition to DISCONNECTED if not already
- [ ] Implement `reconnect()` method: transition to RECONNECTING, attempt new WebSocket connection
  - On success: transition to CONNECTED, reset retryDelay to 2000, hide banner, re-register all frame callbacks
  - On failure: transition to DISCONNECTED, double retryDelay (capped at maxRetryDelay), show banner with updated countdown
- [ ] Implement `showDisconnectBanner(delaySec: number)`: insert/update a fixed-position banner element at top of viewport with "Disconnected -- reconnecting in Ns..." text; countdown updates every second
- [ ] Implement `hideDisconnectBanner()`: remove the banner element
- [ ] On successful reconnect, emit a `reconnected` event so the deck can re-request current state
- [ ] Read WebSocket close code and reason; display in banner if available (e.g., "Disconnected (server shutdown)")
- [ ] Add CSS in deck.css:
  - `.disconnect-banner`: position fixed, top 0, left 0, right 0, z-index 9999, background rgba(0,0,0,0.85), color white, padding 8px 16px, font-size 14px, text-align center
- [ ] Add `<div id="disconnect-banner" class="disconnect-banner" style="display:none"></div>` to index.html before deck container

**Tests:**
- [ ] Unit test: exponential backoff calculation (2s, 4s, 8s, 16s, 30s cap)
- [ ] Unit test: backoff resets to 2s on successful reconnect
- [ ] Unit test: TypeScript compilation succeeds

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck)

**Rollback:**
- Revert commit, restore original connection.ts, deck.css, index.html

**Commit after all checkpoints pass.**

---

#### Step 5: Implement card collapse/expand and layout persistence {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): implement card collapse/expand and localStorage layout persistence`

**References:** [D05] Card collapse, Spec S06, Spec S07, (#card-collapse-spec, #symbols)

**Artifacts:**
- `tugdeck/src/deck.ts` -- collapse/expand methods, layout save/load
- `tugdeck/src/cards/card.ts` -- optional collapsible property on TugCard interface
- `tugdeck/styles/deck.css` -- collapse transition styles, collapse button styles
- `tugdeck/styles/cards.css` -- collapsed card header styling

**Tasks:**
- [ ] Add optional `collapsible` readonly property to TugCard interface (default true; terminal card sets false)
- [ ] Update `DeckManager` with collapse/expand logic:
  - `collapseCard(slot: CardSlot)`: set card content to `display: none`, set grid row to fixed height (~32px), add `.collapsed` class to slot element
  - `expandCard(slot: CardSlot)`: restore card content display, restore grid row to previous fraction, remove `.collapsed` class
  - Add collapse button to each collapsible card header (chevron or +/- text)
  - Wire click handler on collapse button to toggle state
- [ ] Implement layout persistence:
  - `saveLayout()`: serialize `{ version: 1, colSplit, rowSplits, collapsed: string[] }` to localStorage under key `tugdeck-layout`
  - `loadLayout()`: read from localStorage, validate version field, apply colSplit/rowSplits/collapsed if valid
  - Call `loadLayout()` in DeckManager constructor after creating grid
  - Call `saveLayout()` on drag end and on collapse/expand, debounced 500ms
- [ ] Prevent terminal card from collapsing (check `collapsible` property)
- [ ] Add CSS:
  - `.card-slot.collapsed .card-content`: display none
  - `.card-slot.collapsed`: max-height 32px, overflow hidden
  - `.card-header .collapse-btn`: float right, cursor pointer, background transparent
  - Transition: `grid-template-rows 200ms ease` for smooth collapse animation

**Tests:**
- [ ] Unit test: layout serialization/deserialization round-trip
- [ ] Unit test: loadLayout handles missing localStorage key gracefully (returns defaults)
- [ ] Unit test: loadLayout handles invalid JSON gracefully (returns defaults)
- [ ] Unit test: TypeScript compilation succeeds

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck)

**Rollback:**
- Revert commit, restore original deck.ts, card.ts, deck.css, cards.css

**Commit after all checkpoints pass.**

---

#### Step 6: Add WebGL progressive enhancement for terminal card {#step-6}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add WebGL progressive enhancement for terminal card`

**References:** [D06] WebGL progressive, Risk R02, (#symbols, #modified-files)

**Artifacts:**
- `tugdeck/package.json` -- add `@xterm/addon-webgl` dependency
- `tugdeck/src/cards/terminal-card.ts` -- import and activate WebGL addon with fallback

**Tasks:**
- [ ] Add `@xterm/addon-webgl` to tugdeck/package.json dependencies (version compatible with @xterm/xterm 6.x)
- [ ] Run `npm install` in tugdeck/ to update node_modules and package-lock.json
- [ ] In terminal-card.ts, import `WebglAddon` from `@xterm/addon-webgl`
- [ ] After `terminal.open(container)` and FitAddon activation, attempt WebGL:
  ```typescript
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      console.log("tugdeck: WebGL context lost, falling back to canvas");
    });
    terminal.loadAddon(webglAddon);
    console.log("tugdeck: WebGL renderer activated");
  } catch {
    console.log("tugdeck: WebGL not available, using canvas renderer");
  }
  ```
- [ ] No user-visible error or warning on WebGL failure
- [ ] Verify esbuild bundles the WebGL addon correctly (it includes a WASM or shader component)

**Tests:**
- [ ] Unit test: TypeScript compilation succeeds with WebGL addon import
- [ ] Manual test: open tugdeck in browser, check console for "WebGL renderer activated" message

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck with WebGL addon)

**Rollback:**
- Revert commit, restore original terminal-card.ts and package.json

**Commit after all checkpoints pass.**

---

#### Step 7: CLI polish and user-facing error handling {#step-7}

**Depends on:** #step-2

**Commit:** `feat(tugcast): polish CLI with --version, custom help, and clean error messages`

**References:** [D07] CLI polish, [D08] User-facing errors, (#design-decisions, #constraints)

**Artifacts:**
- `crates/tugcast/src/cli.rs` -- add `#[command(version)]`, custom about text
- `crates/tugcast/src/main.rs` -- wrap startup errors in user-friendly messages

**Tasks:**
- [ ] Add `#[command(version)]` attribute to the `Cli` struct to enable `tugcast --version`
- [ ] Update `#[command(about = "...")]` with concise description: "Attach to a tmux session and serve a live dashboard over WebSocket"
- [ ] Add `#[command(long_about = "...")]` with multi-line description explaining tugcast's purpose and basic usage
- [ ] In main.rs, wrap all startup error paths to print clean messages:
  - tmux version check failure: `tugcast: error: tmux not found or version too old (requires 3.x+)`
  - tmux session creation failure: `tugcast: error: failed to create tmux session '<name>': <reason>`
  - Server bind failure: `tugcast: error: failed to bind to 127.0.0.1:<port>: <reason>`
  - Feed startup failure: `tugcast: error: <feed name> feed failed to start: <reason>`
- [ ] Ensure errors are printed to stderr via `eprintln!()`, not via tracing macros
- [ ] Keep tracing output for debug/info level diagnostics (controlled via RUST_LOG)
- [ ] Verify `tugcast --help` prints formatted usage with all flags and descriptions
- [ ] Verify `tugcast --version` prints `tugcast <version from Cargo.toml>`

**Tests:**
- [ ] Unit test: `tugcast --version` produces output containing the version string
- [ ] Unit test: `tugcast --help` produces output containing "--session" and "--port"
- [ ] Unit test: existing CLI parsing tests still pass

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all CLI tests pass
- [ ] `cargo run -p tugcast -- --help` prints formatted usage
- [ ] `cargo run -p tugcast -- --version` prints version

**Rollback:**
- Revert commit, restore original cli.rs and main.rs

**Commit after all checkpoints pass.**

---

#### Step 8: End-to-end integration and acceptance {#step-8}

**Depends on:** #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `feat(tugcast): phase 3 end-to-end integration tests and acceptance verification`

**References:** [D01] StatCollector per-feed, [D04] Reconnect banner, [D05] Card collapse, [D06] WebGL progressive, [D07] CLI polish, [D08] User-facing errors, (#success-criteria, #scope)

**Artifacts:**
- Integration tests in `crates/tugcast/tests/` or `crates/tugcast/src/integration_tests.rs`
- Updated documentation comments on all new public types and functions

**Tasks:**
- [ ] Implement stats delivery test: boot tugcast, connect WebSocket, verify frames arrive on feed IDs 0x30, 0x31, 0x32, 0x33 with valid JSON payloads
- [ ] Implement stats JSON format test: verify each collector output matches its documented schema (Spec S02)
- [ ] Implement reconnection integration test: connect, force-close WebSocket, verify reconnection succeeds and terminal snapshot is re-delivered
- [ ] Implement heartbeat + reconnect test: verify that a reconnected client receives fresh snapshots from all snapshot feeds
- [ ] Implement CLI version test: run `tugcast --version`, verify output contains version string
- [ ] Implement CLI help test: run `tugcast --help`, verify output contains all flag descriptions
- [ ] Verify all success criteria:
  - Stats card renders values from three collectors
  - Sparklines render with historical data points
  - Reconnection with banner and exponential backoff
  - Terminal state restored via capture-pane within 500ms after reconnect
  - Collapsed cards show header-only
  - Layout persistence in localStorage
  - WebGL activates silently (manual browser test)
  - `tugcast --help` and `tugcast --version` work
  - Error messages are clean single-line format
- [ ] Add documentation comments to all new public types and functions
- [ ] Run `cargo clippy --workspace -- -D warnings` and fix any issues

**Tests:**
- [ ] Integration test: stats feed delivery (all four feed IDs)
- [ ] Integration test: stats JSON schema validation
- [ ] Integration test: reconnection with snapshot re-delivery
- [ ] Integration test: CLI version and help output
- [ ] Integration test: existing Phase 1 and Phase 2 tests still pass

**Checkpoint:**
- [ ] `cargo build --workspace` succeeds with no warnings
- [ ] `cargo nextest run` -- all tests pass (workspace-wide)
- [ ] `cargo clippy --workspace -- -D warnings` passes
- [ ] Manual test: launch `cargo run -p tugcast -- --dir .`, open auth URL, see stats card with live values
- [ ] Manual test: kill tugcast, verify "Disconnected" banner appears, restart tugcast, verify auto-reconnect
- [ ] Manual test: collapse/expand git and files cards, refresh browser, verify layout is restored
- [ ] Manual test: check browser console for "WebGL renderer activated" message
- [ ] Manual test: `tugcast --help` prints clean formatted usage
- [ ] Manual test: `tugcast --version` prints version string

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 3.0.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A production-quality tugcast+tugdeck system with extensible stats collection (three built-in collectors with sparklines), WebSocket reconnection handling (non-modal banner, exponential backoff), card collapse/expand with layout persistence, WebGL terminal rendering (progressive enhancement), polished CLI, and clean user-facing error messages.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Stats card displays live data from process info, token usage, and build status collectors
- [ ] Sparklines render historical data for numeric stat values
- [ ] "Disconnected" banner appears within 1 second of WebSocket drop
- [ ] Auto-reconnect succeeds with exponential backoff (2s, 4s, 8s, 16s, 30s cap)
- [ ] Terminal state is restored via capture-pane within 500ms of reconnect
- [ ] Cards can be collapsed to header-only and expanded back
- [ ] Layout state (splits, collapsed cards) persists across browser refresh
- [ ] WebGL renderer activates silently when available; canvas fallback works otherwise
- [ ] `tugcast --help` prints formatted usage; `tugcast --version` prints version
- [ ] Error messages for CLI, WebSocket, and feed failures are clean single-line messages
- [ ] `cargo clippy --workspace -- -D warnings` passes with zero warnings
- [ ] All unit and integration tests pass

**Acceptance tests:**
- [ ] Integration test: stats frames (0x30-0x33) deliver valid JSON payloads
- [ ] Integration test: reconnection restores terminal and snapshot state
- [ ] Integration test: CLI version and help output
- [ ] Integration test: existing Phase 1 and Phase 2 tests unaffected

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Observe-only mode for tugdeck (read-only terminal view)
- [ ] Adaptive git polling (500ms acceleration on FS events)
- [ ] Tree view in files card (on-demand via control feed)
- [ ] Multiple tmux pane support (multiple terminal tugfeeds)
- [ ] Custom/user-defined stat collectors loadable at runtime
- [ ] Authentication refresh on reconnect (for sessions exceeding cookie TTL)

| Checkpoint | Verification |
|------------|--------------|
| Crates compile | `cargo build --workspace` with no warnings |
| All tests pass | `cargo nextest run` |
| Clippy clean | `cargo clippy --workspace -- -D warnings` |
| Manual smoke test | Launch tugcast, open browser, verify stats, reconnect, collapse, WebGL, CLI |

**Commit after all checkpoints pass.**
