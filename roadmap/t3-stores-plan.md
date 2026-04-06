# T3.3 Plan: Stores — SessionMetadataStore + PromptHistoryStore

*Data sources that feed tug-prompt-input's completions and history. Bridges the gap between the raw Claude Code protocol and the UI-centric provider interfaces established in T3.2.*

---

## Context

T3.2 established three provider interfaces on tug-prompt-input:

1. **`CompletionProvider`** — `(query: string) => CompletionItem[]`, keyed by trigger character in `completionProviders: Record<string, CompletionProvider>`. Currently mocked with hardcoded file lists and command names.

2. **`HistoryProvider`** — `back(current) / forward()` returning `TugTextEditingState | null`. Currently mocked with a `GalleryHistoryProvider` class that tracks session submissions.

3. **`onRouteChange`** — `(route: string | null) => void` callback. Currently wired to a gallery card display label.

T3.3 replaces the mocks with real data. T3.4 (tug-prompt-entry) will be the consumer that wires stores to providers.

---

## Data Flow

```
Claude Code ──(stdout)──> tugcode ──(IPC)──> tugcast ──(WebSocket)──> FeedStore
                                                                          │
                                              SessionMetadataStore <──────┘
                                                     │
                                                     ├── slash commands → CompletionProvider for "/"
                                                     ├── model, session_id → UI display
                                                     └── tools list → (future: tool completion)

User submissions ──> PromptHistoryStore ──> HistoryProvider for Cmd+Up/Down
                          │
                          └── IndexedDB persistence (survives reload/quit)
```

---

## Store 1: SessionMetadataStore

### What it captures

The `system_metadata` event arrives on CODE_OUTPUT at session start. It contains (from `tugcode/src/types.ts`):

```typescript
interface SystemMetadata {
  type: "system_metadata";
  session_id: string;
  cwd: string;
  model: string;
  permissionMode: string;
  slash_commands: unknown[];
  skills: unknown[];
  plugins: unknown[];
  agents: unknown[];
  mcp_servers: unknown[];
  version: string;
  // ...
}
```

### What we extract

For T3.3, we need:

| Field | Purpose | Consumer |
|-------|---------|----------|
| `slash_commands` | Command completion for `/` trigger | `CompletionProvider` |
| `skills` | Merged with slash_commands for `/` completion | `CompletionProvider` |
| `session_id` | Session identity | tug-prompt-entry (future) |
| `model` | Display in prompt entry chrome | tug-prompt-entry (future) |
| `permissionMode` | Display/behavior | tug-prompt-entry (future) |
| `cwd` | Working directory for file path resolution | File completion (future) |

### API design

```typescript
class SessionMetadataStore {
  // L02-compliant subscription
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionMetadataSnapshot;

  // Derived data for direct consumer use
  getCommandCompletionProvider(): CompletionProvider;
}

interface SessionMetadataSnapshot {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  cwd: string | null;
  slashCommands: SlashCommandInfo[];
  skills: SkillInfo[];
}

interface SlashCommandInfo {
  name: string;
  description?: string;
}

interface SkillInfo {
  name: string;
  description?: string;
}
```

**Key design choice:** `getCommandCompletionProvider()` returns a function that closes over the store's current data. It matches the `CompletionProvider` type signature `(query: string) => CompletionItem[]`. This is the bridge between the store (L02 data) and the engine (L06 DOM-driven UI). The provider does NOT use `useSyncExternalStore` — it reads the store's current data synchronously when called. The engine calls it on each keystroke; the store's data updates when a new session_metadata arrives.

### Construction and lifecycle

```typescript
const metadataStore = new SessionMetadataStore(feedStore, FeedId.CODE_OUTPUT);
```

- Takes a `FeedStore` and the feed ID to listen on
- Subscribes to feed updates, filters for `type === "system_metadata"` events
- Parses slash commands and skills into typed arrays
- Notifies subscribers when metadata changes

The store is created once per connection (at the DeckManager level or similar) and passed down. Individual cards/components don't create their own.

**Slash command completion is a closed set.** The system never allows freeform `/foo` — it always completes to a known command. The completion provider filters the known set by query; if nothing matches exactly, it shows the closest matches (same fuzzy-include pattern as file completion). Strict types with `name` (required) and `description` (optional). Parse defensively at the store boundary — skip entries without a `name` string.

---

## Store 2: PromptHistoryStore

### Tiered history model

History has three access tiers. Storage supports all three from day one; T3.3 implements navigation only.

| Tier | Scope | Access | When |
|------|-------|--------|------|
| **Navigate** | Current session | Cmd+Up/Down | T3.3 (now) |
| **Search** | Per-project (`cwd`) | Search UI | T3.4+ (future) |
| **Search** | Global (all projects) | Search UI | Later |

### What it stores

Every prompt submission, tagged with enough metadata to query at any scope:

```typescript
interface HistoryEntry {
  id: string;              // UUID — unique across all history
  sessionId: string;       // from SessionMetadataStore — groups entries per session
  projectPath: string;     // cwd from session metadata — groups per project
  route: string;           // ">", "$", ":", "/"
  text: string;            // prompt text with TUG_ATOM_CHAR for atoms
  atoms: SerializedAtom[]; // atom data for restoration
  timestamp: number;       // ms since epoch
}

interface SerializedAtom {
  position: number;
  type: string;
  label: string;
  value: string;
}
```

**History entries include atoms.** Atoms are "promises" — the atom records what the user attached, not whether the target still exists. Resolution (does this file exist? is this command valid?) happens at submit time, not at storage or restore time. History restores exactly what was typed.

### Navigation scope: current session

Cmd+Up/Down walks entries from the current session only. "What did I just type?" — not the full project history.

The `HistoryProvider` returned by `createProvider()` filters to entries matching the current `sessionId`. This gives focused, predictable navigation without scrolling through weeks of history.

### API design

```typescript
class PromptHistoryStore {
  // L02-compliant subscription
  subscribe(listener: () => void): () => void;
  getSnapshot(): PromptHistorySnapshot;

  // Push a new entry after submission
  push(entry: HistoryEntry): void;

  // Create a HistoryProvider for Cmd+Up/Down navigation.
  // Scoped to the given sessionId — only that session's entries are navigable.
  createProvider(sessionId: string): HistoryProvider;

  // Future: search API for project and global tiers
  // search(query: string, scope: { projectPath?: string }): HistoryEntry[];
}

interface PromptHistorySnapshot {
  /** Total entry count across all sessions. */
  totalEntries: number;
  /** Entry count for the current session (if any provider is active). */
  sessionEntries: number;
}
```

**Key design choices:**

- `push(entry)` takes a fully-tagged `HistoryEntry`. The caller (tug-prompt-entry) provides `sessionId`, `projectPath`, and `route` from SessionMetadataStore and the current route state.
- `createProvider(sessionId)` returns a `HistoryProvider` scoped to that session. Same `back(current) / forward()` interface the engine expects. Manages its own cursor and draft (same pattern as the gallery mock `GalleryHistoryProvider`).
- `subscribe`/`getSnapshot` are L02-compliant. The snapshot is lightweight metadata (counts), not the full entry array.

### Persistence: tugbank

History must survive reload, app quit, and `just app` restarts (L23). Tugbank is the existing persistence layer — SQLite-backed, REST API, used by everything else.

**Storage key:** `dev.tugtool.prompt.history/{sessionId}`
**Value:** JSON array of that session's `HistoryEntry` objects.

One key per session. Navigation reads exactly one key (fast). Future project search lists all keys under `dev.tugtool.prompt.history/` and filters by `projectPath`.

```
PUT /api/defaults/dev.tugtool.prompt.history/session-abc123
Body: { "kind": "json", "value": [{ "id": "...", "sessionId": "...", ... }, ...] }
```

**Write path:** `push()` writes to both the in-memory array and tugbank (fire-and-forget async PUT, same pattern as `putTabState`).

**Read path:** On first `createProvider()` for a session, fetch from tugbank into memory. Subsequent reads are from memory. Tugbank is the durable store, memory is the fast cache.

**Capacity:** Cap at ~200 entries per session. Real-world sessions have 5-50 submissions; 200 provides generous headroom. Cross-session cleanup (removing sessions older than N days) is future work.

**PromptHistoryStore is L02-compliant.** Laws are laws, not suggestions. `subscribe` + `getSnapshot` are implemented even though the primary consumer (HistoryProvider) is imperative. The overhead is trivial (a Set + version counter), and when a React-rendered history browser arrives, the compliance is already there.

---

## Bridge Layer: Store → Provider

The gap between stores and the engine's provider interfaces is thin but important:

### Completion bridge

```typescript
// In tug-prompt-entry (T3.4), the wiring looks like:
const commandProvider = metadataStore.getCommandCompletionProvider();
const fileProvider = /* future: from project file index */;

<TugPromptInput
  completionProviders={{
    "/": commandProvider,
    "@": fileProvider,
  }}
/>
```

The store produces a `CompletionProvider` function that the engine can call directly. No adapter needed — the types align.

### History bridge

```typescript
// In tug-prompt-entry (T3.4):
const sessionId = metadataStore.getSnapshot().sessionId;
const historyProvider = historyStore.createProvider(sessionId);

<TugPromptInput
  historyProvider={historyProvider}
/>

// On submit:
historyStore.push({
  id: crypto.randomUUID(),
  sessionId,
  projectPath: metadataStore.getSnapshot().cwd ?? "",
  route: currentRoute,
  text,
  atoms,
  timestamp: Date.now(),
});
```

The store produces a `HistoryProvider` scoped to the current session. The prompt entry creates it once when the session starts (from SessionMetadataStore). Cmd+Up/Down walks that session's submissions only.

---

## Implementation Steps

### Step 1: SessionMetadataStore

1. **Types** — `SessionMetadataSnapshot`, `SlashCommandInfo`, `SkillInfo` in a new `tugdeck/src/lib/session-metadata-store.ts`
2. **Store class** — subscribes to FeedStore, parses `system_metadata`, notifies listeners
3. **Command completion provider** — `getCommandCompletionProvider()` returns a function that filters slash commands + skills by query
4. **Tests** — unit tests with mock FeedStore data
5. **Gallery integration** — wire the store (with mock data) into the prompt input gallery card, replacing the hardcoded `TYPEAHEAD_COMMANDS`

### Step 2: PromptHistoryStore

1. **Types** — `HistoryEntry`, `SerializedAtom`, `PromptHistorySnapshot` in a new `tugdeck/src/lib/prompt-history-store.ts`
2. **In-memory store** — push, createProvider(sessionId), L02 subscribe/getSnapshot
3. **Tugbank backing** — one key per sessionId, async fetch on first access, fire-and-forget PUT writes, capacity cap
4. **Tests** — unit tests for push/navigate (mock tugbank via fetch stub)
5. **Gallery integration** — wire into gallery card with a mock sessionId, replacing `GalleryHistoryProvider`

### Step 3: File completion provider (stub)

The `@` trigger's real data comes from a project file index — that's future work (not in T3.3). But we should establish the pattern:

1. **Create `tugdeck/src/lib/file-completion-provider.ts`** with a stub that returns hardcoded files (same as current gallery mock)
2. **Define the interface** that the real provider will implement when the project file index exists
3. This keeps the gallery card clean — it imports providers, doesn't define them inline

---

## Laws Compliance

| Law | How |
|-----|-----|
| L02 | Both stores: `subscribe` + `getSnapshot` for `useSyncExternalStore` |
| L06 | Completion/history providers drive direct DOM updates via the engine — no React re-renders |
| L07 | Providers are stable refs — created once per scope, not recreated on every render |
| L22 | SessionMetadataStore observed by engine callbacks, not round-tripped through React |
| L23 | PromptHistoryStore persists to tugbank — survives reload, quit |

---

## Exit Criteria

- SessionMetadataStore parses `system_metadata` from a FeedStore (tested with mock data)
- `getCommandCompletionProvider()` returns a working CompletionProvider
- PromptHistoryStore push/navigate works with session-scoped in-memory data
- Tugbank persistence: session entries survive page reload
- Entry schema includes sessionId, projectPath, route — ready for future search tiers
- Both stores have unit tests
- Gallery card uses real store instances (with mock feed data) instead of inline mocks
- Existing tug-prompt-input features unaffected

---

## Decisions (resolved)

1. **Slash command shape** — strict types (`{ name, description? }`), parsed defensively. Completion is a closed set — always completes to known commands.
2. **History includes atoms** — yes. Atoms are promises; resolution is at submit time. Full state stored (minus selection).
3. **PromptHistoryStore L02** — yes. Laws are laws. Both stores implement `subscribe`/`getSnapshot`.
4. **History tiers** — navigation is session-scoped (Cmd+Up/Down walks current session only). Storage schema includes sessionId + projectPath + route to support future per-project and global search. Search UI is T3.4+.
5. **Persistence** — tugbank, not IndexedDB. One key per sessionId. Consistent with all other persistence in the system.
