<!-- tugplan-skeleton v2 -->

## T3.3: Stores — SessionMetadataStore + PromptHistoryStore {#t3-stores}

**Purpose:** Build the data-source layer that feeds tug-prompt-input's completions and history navigation, replacing inline mocks with live store-backed providers wired through the existing engine interfaces.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

T3.2 established three provider interfaces on tug-prompt-input: `CompletionProvider` for trigger-based completions, `HistoryProvider` for Cmd+Up/Down navigation, and `onRouteChange` for prefix routing. All three are currently backed by hardcoded mock data in the gallery card. T3.3 replaces those mocks with real data stores that parse the Claude Code protocol's `system_metadata` event and persist prompt history through tugbank.

The stores are plain TypeScript classes (not React components), placed in `tugdeck/src/lib/` alongside `feed-store.ts` and `tugbank-client.ts`. They produce provider objects that plug directly into tug-prompt-input's existing interfaces — no adapter layer required.

#### Strategy {#strategy}

- Build SessionMetadataStore first — it has no persistence and exercises the FeedStore subscription pattern.
- Build PromptHistoryStore second — it depends on understanding the SessionMetadataStore snapshot shape (for sessionId) and adds tugbank persistence.
- Add an HTTP GET helper to settings-api.ts for reading prompt history from tugbank.
- Create a standalone file completion provider stub for the `@` trigger, extracting the hardcoded file list from the gallery card into its own module.
- Integrate all stores into the gallery card using `connection-singleton`, with mock fallback data when no live connection is available.
- Keep stores self-contained within the gallery card for T3.3; DeckManager integration is T3.4 work.

#### Success Criteria (Measurable) {#success-criteria}

- SessionMetadataStore parses a `system_metadata` payload from FeedStore and exposes a working `CompletionProvider` via `getCommandCompletionProvider()` (verified by unit test with mock FeedStore data).
- PromptHistoryStore `push()` and `createProvider()` produce correct Cmd+Up/Down navigation for session-scoped entries (verified by unit test).
- Tugbank persistence: `putPromptHistory()` writes and `getPromptHistory()` reads entries for a session (verified by unit test with mock fetch).
- Gallery card uses real store instances instead of inline mocks (verified by visual confirmation in gallery).
- File completion provider stub exists as a standalone module returning hardcoded files (verified by import and type-check).

#### Scope {#scope}

1. `SessionMetadataStore` class with L02-compliant subscribe/getSnapshot and `getCommandCompletionProvider()`.
2. `PromptHistoryStore` class with L02-compliant subscribe/getSnapshot, `push()`, `createProvider()`, and tugbank persistence.
3. HTTP GET helper `getPromptHistory()` in settings-api.ts.
4. HTTP PUT helper `putPromptHistory()` in settings-api.ts.
5. File completion provider stub module for `@` trigger.
6. Gallery card integration replacing inline mocks with store-backed providers.
7. Unit tests for both stores and the new settings-api helpers.

#### Non-goals (Explicitly out of scope) {#non-goals}

- DeckManager-level store construction or lifecycle management (T3.4).
- Cross-session or per-project history search UI (T3.4+).
- Real project file index for `@` completion (future work).
- Tool completion or MCP server completion from system_metadata (future work).
- History entry cleanup/expiration across sessions.

#### Dependencies / Prerequisites {#dependencies}

- FeedStore (exists in `tugdeck/src/lib/feed-store.ts`) — subscription source for SessionMetadataStore.
- TugPromptInput engine interfaces: `CompletionProvider`, `HistoryProvider`, `CompletionItem`, `TugTextEditingState` (exist in `tugdeck/src/lib/tug-text-engine.ts`).
- `connection-singleton.ts` (exists) — for gallery card store construction.
- Tugbank HTTP API at `/api/defaults/` (exists) — for prompt history persistence.
- `settings-api.ts` (exists) — pattern for read/write helpers.

#### Constraints {#constraints}

- L02: Both stores must implement `subscribe` + `getSnapshot` for `useSyncExternalStore` compatibility.
- L06: Completion and history providers drive direct DOM updates via the engine, not React re-renders.
- L07: Providers are stable refs created once per scope.
- L22: SessionMetadataStore observed by engine callbacks, not round-tripped through React.
- L23: PromptHistoryStore must persist to tugbank — data survives reload and quit.
- Tests use `bun:test` with fetch stubs, consistent with the `settings-api.test.ts` pattern.

#### Assumptions {#assumptions}

- FeedStore emits the latest decoded payload per feed ID in a `Map<number, unknown>`. SessionMetadataStore detects `system_metadata` by comparing the last-seen payload reference — store the last reference; on each callback, re-check and update only when the reference changes and `type === "system_metadata"`.
- The `slash_commands` and `skills` arrays from `system_metadata` are merged into a single flat list for the `/` CompletionProvider. Skills are not given a separate trigger.
- `SlashCommandEntry` in tugcode includes a `category` field (`local | agent | skill`). This is preserved in `SlashCommandInfo` even though the T3.3 completion UI does not use it yet — the data is available when completion display gains grouping.
- PromptHistoryStore capacity cap of ~200 entries per session, enforced in `push()` by slicing the oldest entries.
- The file completion stub keeps the same shape as the existing `galleryFileCompletionProvider` — hardcoded list, same `CompletionItem` format.
- Gallery card constructs stores self-contained with `connection-singleton` and seeds mock fallback data when no live connection is available. Cleanup in T3.4.
- Tugcast serves GET on `/api/defaults/` endpoints (to be verified during implementation).

---

### Design Decisions {#design-decisions}

#### [D01] SessionMetadataStore subscribes to FeedStore via reference comparison (DECIDED) {#d01-feed-detect}

**Decision:** SessionMetadataStore stores the last-seen `system_metadata` payload reference. On each FeedStore `subscribe` callback, it re-reads the Map for `CODE_OUTPUT`, compares the object reference, and updates only when the reference has changed and `type === "system_metadata"`.

**Rationale:**
- FeedStore replaces the entire Map on each frame, so reference comparison is reliable.
- Avoids deep-equality checks on potentially large payloads.
- Consistent with how other FeedStore consumers detect changes.

**Implications:**
- SessionMetadataStore constructor takes a `FeedStore` and the feed ID constant.
- The store subscribes to FeedStore and filters within its own callback.

#### [D02] Slash commands and skills merged into one CompletionProvider (DECIDED) {#d02-merged-completions}

**Decision:** The `/` trigger's `CompletionProvider` returns items from both `slash_commands` and `skills` arrays, merged into a single flat list. Skills are not given a separate trigger character.

**Rationale:**
- From the user's perspective, both are invoked with `/`. Separating them adds complexity without user benefit.
- The `category` field on each item preserves the distinction for future grouping in completion display.

**Implications:**
- `SlashCommandInfo` includes a `category: "local" | "agent" | "skill"` field even though T3.3 does not render it.
- `getCommandCompletionProvider()` filters across the merged list.

#### [D03] PromptHistoryStore uses tugbank with one key per session (DECIDED) {#d03-history-persistence}

**Decision:** History entries are persisted to tugbank under `dev.tugtool.prompt.history/{sessionId}`, one key per session. Value is a JSON array of `HistoryEntry` objects.

**Rationale:**
- Tugbank is the existing persistence layer used by all other durable state (layout, tab state, theme).
- One key per session makes navigation reads fast (fetch exactly one key).
- Future cross-session search can enumerate keys under the domain prefix.

**Implications:**
- New `putPromptHistory()` and `getPromptHistory()` helpers in settings-api.ts.
- `push()` writes to both in-memory array and tugbank (fire-and-forget async PUT).
- `createProvider()` fetches from tugbank on first access for a session, then reads from memory.

#### [D04] History navigation is session-scoped (DECIDED) {#d04-session-scoped-nav}

**Decision:** Cmd+Up/Down walks entries from the current session only. The `HistoryProvider` returned by `createProvider(sessionId)` filters to that session's entries.

**Rationale:**
- "What did I just type?" is the primary use case for keyboard navigation.
- Cross-session search is a different interaction model requiring a search UI (T3.4+).

**Implications:**
- `createProvider()` takes a `sessionId` parameter.
- The provider maintains its own cursor and draft state, same pattern as `GalleryHistoryProvider`.

#### [D05] Gallery card uses connection-singleton for self-contained store construction (DECIDED) {#d05-gallery-self-contained}

**Decision:** The gallery card creates stores inside itself using `getConnection()` from `connection-singleton`. It seeds mock fallback data when no live connection is available. No DeckManager changes are needed for T3.3.

**Rationale:**
- Gallery card is a testing surface. Self-contained construction avoids coupling to DeckManager lifecycle.
- Mock fallback ensures the gallery card works during development without a live tugcast connection.

**Implications:**
- Gallery card imports `getConnection` and `FeedStore`.
- Conditional logic: if connection is null, create stores with mock/seeded data.
- Store lifecycle management moves to DeckManager in T3.4.

#### [D06] HistoryEntry includes atoms for full state restoration (DECIDED) {#d06-history-atoms}

**Decision:** `HistoryEntry` stores the text (with `TUG_ATOM_CHAR` placeholders) and serialized atom data — the parts of `TugTextEditingState` needed to reconstruct the prompt, minus selection state. History restores exactly what was typed.

**Rationale:**
- Atoms are "promises" — they record what the user attached, not whether the target still exists.
- Resolution happens at submit time, not at storage or restore time.
- Users expect Cmd+Up to restore exactly what they typed, including file references.

**Implications:**
- `HistoryEntry` has `text`, `atoms` (as `SerializedAtom[]`), plus metadata fields (`sessionId`, `projectPath`, `route`, `timestamp`).
- `SerializedAtom` captures position, type, label, and value.

#### [D07] Capacity cap of 200 entries per session (DECIDED) {#d07-capacity-cap}

**Decision:** `push()` enforces a cap of ~200 entries per session by slicing the oldest entries when the limit is exceeded.

**Rationale:**
- Real-world sessions have 5-50 submissions; 200 provides generous headroom.
- Prevents unbounded memory and storage growth.
- Cross-session cleanup (removing old sessions) is future work.

**Implications:**
- After each `push()`, if length > 200, slice to keep the most recent 200.
- The cap applies both in-memory and to the tugbank write payload.

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: SessionMetadataStore API** {#s01-session-metadata-api}

```typescript
class SessionMetadataStore {
  constructor(feedStore: FeedStore, feedId: FeedIdValue);
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionMetadataSnapshot;
  getCommandCompletionProvider(): CompletionProvider;
  dispose(): void;
}

interface SessionMetadataSnapshot {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  cwd: string | null;
  slashCommands: SlashCommandInfo[];
}

interface SlashCommandInfo {
  name: string;
  description?: string;
  category: "local" | "agent" | "skill";
}
```

**Spec S02: PromptHistoryStore API** {#s02-history-store-api}

```typescript
class PromptHistoryStore {
  constructor();
  subscribe(listener: () => void): () => void;
  getSnapshot(): PromptHistorySnapshot;
  push(entry: HistoryEntry): void;
  createProvider(sessionId: string): HistoryProvider;
  loadSession(sessionId: string): Promise<void>;
}

interface PromptHistorySnapshot {
  totalEntries: number;
  sessionEntries: number;
}

interface HistoryEntry {
  id: string;
  sessionId: string;
  projectPath: string;
  route: string;
  text: string;
  atoms: SerializedAtom[];
  timestamp: number;
}

// Note: SerializedAtom captures the subset of atom fields needed for persistence.
// If tug-text-engine exports a compatible atom element type in the future,
// consider aliasing it here instead of duplicating.
interface SerializedAtom {
  position: number;
  type: string;
  label: string;
  value: string;
}
```

**Spec S03: Settings API helpers** {#s03-settings-api}

```typescript
// Write prompt history for a session (fire-and-forget)
function putPromptHistory(sessionId: string, entries: HistoryEntry[]): void;

// Read prompt history for a session
function getPromptHistory(sessionId: string): Promise<HistoryEntry[]>;
```

Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
- PUT body: `{ kind: "json", value: [...entries] }`
- GET response: `{ kind: "json", value: [...entries] }` or 404 (returns empty array).

**Spec S04: File completion provider stub** {#s04-file-completion-stub}

```typescript
// Hardcoded file list, same CompletionItem format as engine expects
function createFileCompletionProvider(files: string[]): CompletionProvider;
```

Takes a list of file paths, returns a `CompletionProvider` that filters by query substring match. Extracted from `galleryFileCompletionProvider` in the gallery card.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/session-metadata-store.ts` | SessionMetadataStore class and related types |
| `tugdeck/src/lib/prompt-history-store.ts` | PromptHistoryStore class and related types |
| `tugdeck/src/lib/file-completion-provider.ts` | File completion provider stub for `@` trigger |
| `tugdeck/src/__tests__/session-metadata-store.test.ts` | Unit tests for SessionMetadataStore |
| `tugdeck/src/__tests__/prompt-history-store.test.ts` | Unit tests for PromptHistoryStore |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SessionMetadataStore` | class | `session-metadata-store.ts` | L02-compliant store subscribing to FeedStore |
| `SessionMetadataSnapshot` | interface | `session-metadata-store.ts` | Snapshot type for getSnapshot() |
| `SlashCommandInfo` | interface | `session-metadata-store.ts` | Typed slash command entry with category |
| `PromptHistoryStore` | class | `prompt-history-store.ts` | L02-compliant store with tugbank persistence |
| `PromptHistorySnapshot` | interface | `prompt-history-store.ts` | Lightweight metadata snapshot |
| `HistoryEntry` | interface | `prompt-history-store.ts` | Full prompt entry with atoms and metadata |
| `SerializedAtom` | interface | `prompt-history-store.ts` | Atom data for history restoration |
| `createFileCompletionProvider` | function | `file-completion-provider.ts` | Factory for `@` trigger CompletionProvider |
| `putPromptHistory` | function | `settings-api.ts` | PUT helper for prompt history persistence |
| `getPromptHistory` | function | `settings-api.ts` | GET helper for prompt history reads |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test store subscribe/getSnapshot, completion filtering, history navigation | Core store logic, edge cases |
| **Unit** | Test settings-api PUT/GET helpers with fetch stubs | HTTP contract verification |
| **Integration** | Gallery card renders with store-backed providers | Visual confirmation in gallery |

---

### Execution Steps {#execution-steps}

#### Step 1: SessionMetadataStore {#step-1}

**Commit:** `feat: add SessionMetadataStore with FeedStore subscription`

**References:** [D01] FeedStore reference comparison, [D02] Merged completions, Spec S01, (#inputs-outputs, #constraints, #assumptions)

**Artifacts:**
- `tugdeck/src/lib/session-metadata-store.ts` — store class, snapshot type, SlashCommandInfo type
- `tugdeck/src/__tests__/session-metadata-store.test.ts` — unit tests

**Tasks:**
- [ ] Create `session-metadata-store.ts` with `SessionMetadataStore` class.
- [ ] Implement constructor taking `FeedStore` and `feedId`. Subscribe to FeedStore. On each callback, read the Map for the given feedId, compare to last-seen reference, and if changed and `type === "system_metadata"`, parse and update snapshot.
- [ ] Define `SessionMetadataSnapshot` interface with `sessionId`, `model`, `permissionMode`, `cwd`, `slashCommands` (typed `SlashCommandInfo[]`).
- [ ] Define `SlashCommandInfo` with `name`, `description?`, `category: "local" | "agent" | "skill"`. Parse defensively — skip entries without a `name` string. Default `category` to `"local"` when absent or not a valid string.
- [ ] Parse `skills` array into the same `SlashCommandInfo` format with `category: "skill"`. Merge with `slash_commands` into a single `slashCommands` array on the snapshot.
- [ ] Implement `getCommandCompletionProvider()` returning a `CompletionProvider` function that closes over the store. On each call, reads current `slashCommands`, filters by case-insensitive substring match, returns `CompletionItem[]` with `label` = command name and `atom` of type `"command"`.
- [ ] Implement L02-compliant `subscribe`/`getSnapshot` with listener Set and version counter.
- [ ] Implement `dispose()` to unsubscribe from FeedStore.

**Tests:**
- [ ] Store starts with null snapshot fields and empty slashCommands array.
- [ ] Subscribing to a FeedStore that emits a system_metadata payload updates the snapshot correctly.
- [ ] `getCommandCompletionProvider()` filters commands by substring query.
- [ ] Entries without a `name` string are skipped during parse.
- [ ] Subscribers are notified on metadata change; not notified on duplicate reference.

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`
- [ ] `cd tugdeck && bun test src/__tests__/session-metadata-store.test.ts`

---

#### Step 2: Settings API helpers for prompt history {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add putPromptHistory and getPromptHistory to settings-api`

**References:** [D03] Tugbank persistence, Spec S03, (#inputs-outputs, #dependencies)

**Artifacts:**
- `tugdeck/src/lib/prompt-history-store.ts` — `HistoryEntry` and `SerializedAtom` type definitions only (class added in Step 3)
- `tugdeck/src/settings-api.ts` — new `putPromptHistory()` and `getPromptHistory()` functions
- `tugdeck/src/__tests__/settings-api.test.ts` — new test cases for the helpers

**Tasks:**
- [ ] Create `prompt-history-store.ts` with only the `HistoryEntry` and `SerializedAtom` type definitions (Spec S02). The store class itself is added in Step 3. This ensures settings-api.ts can import the types without a circular dependency.
- [ ] Add `putPromptHistory(sessionId: string, entries: HistoryEntry[]): void` — fire-and-forget PUT to `/api/defaults/dev.tugtool.prompt.history/{sessionId}` with `{ kind: "json", value: entries }`. Same pattern as `putTabState` but without await. Import `HistoryEntry` type from `prompt-history-store.ts`.
- [ ] Add `getPromptHistory(sessionId: string): Promise<HistoryEntry[]>` — GET from `/api/defaults/dev.tugtool.prompt.history/{sessionId}`. Parse response as tagged value. Return the `value` array, or empty array on 404 or parse error.

**Tests:**
- [ ] `putPromptHistory` sends PUT to correct URL with json-tagged body (fetch stub).
- [ ] `getPromptHistory` returns parsed entries array on 200 response (fetch stub).
- [ ] `getPromptHistory` returns empty array on 404 response (fetch stub).

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`
- [ ] `cd tugdeck && bun test src/__tests__/settings-api.test.ts`

---

#### Step 3: PromptHistoryStore {#step-3}

**Depends on:** #step-2

**Commit:** `feat: add PromptHistoryStore with session-scoped navigation and tugbank persistence`

**References:** [D03] Tugbank persistence, [D04] Session-scoped navigation, [D06] History atoms, [D07] Capacity cap, Spec S02, (#inputs-outputs, #constraints)

**Artifacts:**
- `tugdeck/src/lib/prompt-history-store.ts` — add store class and provider factory (types already present from Step 2)
- `tugdeck/src/__tests__/prompt-history-store.test.ts` — unit tests

**Tasks:**
- [ ] Add `PromptHistoryStore` class to the existing `prompt-history-store.ts` (types were defined in Step 2).
- [ ] Implement `push(entry)`: append to in-memory array keyed by `entry.sessionId`. Enforce 200-entry cap by slicing oldest. Fire-and-forget `putPromptHistory(sessionId, entries)` to persist.
- [ ] Implement `loadSession(sessionId)`: call `getPromptHistory(sessionId)` to fetch from tugbank into in-memory cache. No-op if already loaded.
- [ ] Implement `createProvider(sessionId)`: returns a `HistoryProvider` scoped to that session. The provider has `back(current)` / `forward()` matching the engine interface. Manages its own cursor and draft state (same pattern as `GalleryHistoryProvider`). Kicks off `loadSession` if not already loaded — since `loadSession` is async and `createProvider` is synchronous, the provider returns `null` from `back()` until loading completes (matches the existing null-return contract of `HistoryProvider`). Once loaded, subsequent `back()` calls return real entries.
- [ ] Implement L02-compliant `subscribe`/`getSnapshot`. Snapshot exposes `totalEntries` and `sessionEntries` (count for most recently active session).
- [ ] Define `PromptHistorySnapshot` interface per Spec S02.

**Tests:**
- [ ] `push()` adds entry and notifies subscribers.
- [ ] `push()` enforces 200-entry cap (push 201 entries, verify oldest is dropped).
- [ ] `createProvider()` returns a HistoryProvider that navigates session entries correctly (back returns last entry, forward returns to draft).
- [ ] `createProvider()` does not return entries from other sessions.
- [ ] `push()` calls `putPromptHistory` with correct sessionId and entries (mock fetch).

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`
- [ ] `cd tugdeck && bun test src/__tests__/prompt-history-store.test.ts`

---

#### Step 4: File completion provider stub {#step-4}

**Depends on:** #step-1

**Commit:** `feat: add file completion provider stub for @ trigger`

**References:** Spec S04, [D02] Merged completions, (#non-goals, #assumptions)

**Artifacts:**
- `tugdeck/src/lib/file-completion-provider.ts` — `createFileCompletionProvider()` factory function

**Tasks:**
- [ ] Create `file-completion-provider.ts` exporting `createFileCompletionProvider(files: string[]): CompletionProvider`.
- [ ] The returned provider filters files by case-insensitive substring match on the query, returns up to 8 results as `CompletionItem[]` with `atom.type = "file"`.
- [ ] Extract the logic from `galleryFileCompletionProvider` in the gallery card — same filtering behavior, same `CompletionItem` format.

**Tests:**
- [ ] Type-check confirms `createFileCompletionProvider` returns a valid `CompletionProvider` (covered by tsc checkpoint).

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`

---

#### Step 5: Gallery card integration {#step-5}

**Depends on:** #step-1, #step-3, #step-4

**Commit:** `feat: wire store-backed providers into gallery prompt input card`

**References:** [D05] Gallery self-contained, Spec S01, Spec S02, Spec S04, (#strategy, #success-criteria)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-prompt-input.tsx` — updated to use store-backed providers

**Tasks:**
- [ ] Import `getConnection` from `connection-singleton`, `FeedStore` from `feed-store`, `SessionMetadataStore` from `session-metadata-store`, `PromptHistoryStore` from `prompt-history-store`, `createFileCompletionProvider` from `file-completion-provider`.
- [ ] At module level or in a `useRef`-based initialization block: if `getConnection()` returns a connection, create a `FeedStore` and `SessionMetadataStore`. Otherwise, create a SessionMetadataStore-like mock that returns hardcoded commands (seed with `TYPEAHEAD_COMMANDS` data).
- [ ] Create a `PromptHistoryStore` instance (works without connection — in-memory only when tugbank is unavailable).
- [ ] Replace `galleryCommandCompletionProvider` with `metadataStore.getCommandCompletionProvider()` (or the mock equivalent).
- [ ] Replace `galleryFileCompletionProvider` with `createFileCompletionProvider(TYPEAHEAD_FILES)`.
- [ ] Replace `GalleryHistoryProvider` with `historyStore.createProvider(mockSessionId)` where `mockSessionId` is a fixed string for gallery use.
- [ ] Remove the now-unused inline mock functions and `GalleryHistoryProvider` class.
- [ ] Ensure the gallery card still compiles and the prompt input works visually in the gallery.

**Tests:**
- [ ] Visual verification: gallery card renders with store-backed providers, `/` completion shows commands, `@` completion shows files, Cmd+Up/Down history navigation works.

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`
- [ ] Visual verification: gallery card renders, `/` completion works, `@` completion works, Cmd+Up/Down history navigation works.

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] FeedStore reference comparison, [D03] Tugbank persistence, [D04] Session-scoped navigation, [D05] Gallery self-contained, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all store files exist and export correct symbols.
- [ ] Verify gallery card imports from store modules, not inline mocks.
- [ ] Verify all unit tests pass.
- [ ] Verify no TypeScript errors across the entire tugdeck project.

**Tests:**
- [ ] All unit test suites pass: `cd tugdeck && bun test` (aggregate of Steps 1-3 test suites).

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit`
- [ ] `cd tugdeck && bun test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Two L02-compliant stores (SessionMetadataStore, PromptHistoryStore) that produce provider objects for tug-prompt-input's completion and history interfaces, with tugbank persistence for history and a file completion stub for the `@` trigger.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] SessionMetadataStore parses `system_metadata` from FeedStore (unit test passes with mock data).
- [ ] `getCommandCompletionProvider()` returns a working `CompletionProvider` that filters slash commands and skills.
- [ ] PromptHistoryStore push/navigate works with session-scoped in-memory data (unit test passes).
- [ ] Tugbank persistence: `putPromptHistory` and `getPromptHistory` handle read/write correctly (unit test passes).
- [ ] Entry schema includes `sessionId`, `projectPath`, `route` — ready for future search tiers.
- [ ] Gallery card uses real store instances (with mock feed data when offline) instead of inline mocks.
- [ ] File completion provider stub exists as standalone module.
- [ ] `cd tugdeck && bun run tsc --noEmit` passes.
- [ ] `cd tugdeck && bun test` passes.

**Acceptance tests:**
- [ ] SessionMetadataStore unit tests (subscription, parsing, completion filtering).
- [ ] PromptHistoryStore unit tests (push, navigate, capacity cap, tugbank write).
- [ ] Settings API unit tests (putPromptHistory, getPromptHistory).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] T3.4: Move store construction to DeckManager level with proper lifecycle.
- [ ] T3.4+: Per-project and global history search UI.
- [ ] Real project file index for `@` completion provider.
- [ ] Tool completion from system_metadata tools array.
- [ ] Cross-session history cleanup (remove sessions older than N days).
- [ ] Completion display grouping by category.

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `cd tugdeck && bun run tsc --noEmit` |
| All unit tests pass | `cd tugdeck && bun test` |
| Gallery card visual | Prompt input works with store-backed providers |
