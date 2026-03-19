<!-- tugplan-skeleton v2 -->

## Tugways Phase 5e4: Tugbank Settings Migration {#phase-5e4-tugbank-migration}

**Purpose:** Migrate deck settings persistence from the legacy flat-file backend (`deck-settings.json` via `/api/settings`) to tugbank, using the `/api/defaults/` HTTP endpoints that Phase 5e3 wired into tugcast, and update the frontend to read/write through the new domain-aware API.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5e4-tugbank-migration |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Deck settings (card layout and theme) are currently persisted to `.tugtool/deck-settings.json` via `GET/POST /api/settings` in tugcast. This flat-file approach was the simplest initial implementation, but Phases 5e1-5e3 have introduced tugbank -- a typed key-value store backed by SQLite with domain-scoped persistence and a full HTTP API. All the infrastructure for domain-aware persistence is live and working. The last step is to move the actual settings data into tugbank and update the frontend accordingly.

This migration is also a prerequisite for Phase 5f (Inactive State Preservation), which needs the `dev.tugtool.deck.state` and `dev.tugtool.deck.tabstate` domains. Establishing the domain separation pattern now clears the path for per-tab state bags.

#### Strategy {#strategy}

- Add a one-time migration function in tugcast that reads the legacy flat file, writes its contents into the appropriate tugbank domains, and deletes the flat file.
- Run migration synchronously at tugcast startup (before the server accepts connections) to avoid races between migration and the first frontend fetch.
- Use file-existence as the migration guard: only migrate when the flat file exists; once deleted it never runs again.
- Rewrite `settings-api.ts` to use `/api/defaults/:domain/:key` endpoints with the tagged-value wire format, preserving the debounced save pattern in DeckManager.
- Remove the legacy `/api/settings` route, the `settings.rs` module, and all associated integration tests -- no other callers remain after the frontend is updated.
- Keep the frontend changes minimal: `settings-api.ts`, `main.tsx`, `deck-manager.ts`, and `theme-provider.tsx` are the only frontend files that change.

#### Success Criteria (Measurable) {#success-criteria}

- Layout persists across tugcast restarts via `GET /api/defaults/dev.tugtool.deck.layout/layout` returning the stored JSON (verify with `curl`)
- Theme persists across restarts via `GET /api/defaults/dev.tugtool.app/theme` returning the stored string (verify with `curl`)
- The flat file `.tugtool/deck-settings.json` is deleted after successful migration and never recreated
- `GET /api/settings` and `POST /api/settings` return 404 (routes removed)
- `cargo nextest run` passes with zero warnings
- `bun run check` passes with zero TypeScript errors in tugdeck

#### Scope {#scope}

1. One-time migration logic in tugcast: read flat file, write to tugbank domains, delete flat file
2. Rewrite `settings-api.ts` to use `/api/defaults/` endpoints with tagged-value wire format
3. Update `main.tsx` startup to fetch layout and theme from separate domain endpoints
4. Remove `/api/settings` route, `settings.rs` module, and `SettingsState` struct
5. Remove or rewrite integration tests for the old settings endpoint
6. Add integration tests for the migration path and the new frontend-facing flow

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding new domains beyond `dev.tugtool.deck.layout` and `dev.tugtool.app` (Phase 5f will add `deck.state` and `deck.tabstate`)
- Changing the DeckManager save/load architecture (debounced save pattern stays as-is)
- Adding UI for migration status or progress
- Supporting rollback to the flat-file backend

#### Dependencies / Prerequisites {#dependencies}

- Phase 5e1 (tugbank-core): `DefaultsStore`, `Value::Json`, `Value::String` -- COMPLETE
- Phase 5e2 (tugbank CLI): tugbank binary for manual inspection -- COMPLETE
- Phase 5e3 (tugbank bridge): `/api/defaults/` HTTP handlers in tugcast -- COMPLETE

#### Constraints {#constraints}

- Migration must run before the HTTP server starts accepting connections (no race condition between migration and first frontend fetch)
- Warnings are errors (`-D warnings` in `.cargo/config.toml`)
- Never call `root.render()` after initial mount (Rules of Tugways [D40])
- No `npm` -- use `bun` for all JavaScript/TypeScript operations

#### Assumptions {#assumptions}

- The flat file, when present, contains valid JSON matching the `DeckSettings` schema (`{ "layout": ..., "theme": ... }`)
- The tugbank database at `bank_path` is already initialized by Phase 5e3's `DefaultsStore::open()` call in `build_app`
- Layout is stored as `Value::Json` tagged value and theme is stored as `Value::String` tagged value
- The debounced save pattern in DeckManager (`postSettings` called on layout change) will be preserved; only the URL and serialization format change

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and labeled artifacts. See the skeleton for the full conventions.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Migration runs on corrupt flat file | med | low | Log warning, write nothing to tugbank, delete flat file to prevent retry on every startup | User reports blank layout after upgrade |
| Frontend fetches before migration completes | high | low | Migration runs synchronously before server bind | Blank layout on first load after upgrade |
| Tugbank database locked during migration write | med | low | Migration is the only writer at startup; no contention possible | Timeout errors in migration logs |

**Risk R01: Corrupt flat file during migration** {#r01-corrupt-flat-file}

- **Risk:** A malformed `deck-settings.json` causes migration to produce no tugbank data, resulting in a blank layout on next startup.
- **Mitigation:** Parse with `serde_json::from_str`. On parse failure, log `warn!` with the file path and error detail so the user can investigate. Write nothing to tugbank (the data is unrecoverable). Delete the flat file unconditionally to prevent the warning from repeating on every startup.
- **Residual risk:** A corrupt file means the user's layout is already lost; migration cannot recover data that was never valid JSON. The user gets the default layout.

---

### Design Decisions {#design-decisions}

#### [D01] File-existence migration guard (DECIDED) {#d01-file-existence-guard}

**Decision:** Migration runs only when `.tugtool/deck-settings.json` exists. After successful migration, the flat file is deleted. Absence of the file means migration has already completed (or was never needed).

**Rationale:**
- Simplest possible guard: no version table, no flag file, no database metadata
- Idempotent: if the file is gone, migration is a no-op
- Matches user answer: "only migrate when the flat file exists; once deleted it never runs again"

**Implications:**
- If a user manually recreates the flat file, migration will re-run (acceptable edge case)
- The migration function deletes the flat file unconditionally after processing -- even on parse failure -- to prevent the migration from re-running and logging warnings on every startup

#### [D02] Domain and key naming (DECIDED) {#d02-domain-key-naming}

**Decision:** Layout is stored at key `layout` in domain `dev.tugtool.deck.layout`. Theme is stored at key `theme` in domain `dev.tugtool.app`.

**Rationale:**
- Matches the user's explicit answer for key and domain names
- `dev.tugtool.deck.layout` scopes layout data to the deck subsystem
- `dev.tugtool.app` scopes theme to the app level (theme affects the entire app, not just the deck)
- Aligns with domain separation established in the Phase 5e4 roadmap description

**Implications:**
- Frontend must use two separate API calls (one per domain) for the initial settings fetch, replacing the single `/api/settings` call
- Phase 5f will add `dev.tugtool.deck.state` and `dev.tugtool.deck.tabstate` domains following this pattern

#### [D03] Remove legacy endpoint entirely (DECIDED) {#d03-remove-legacy-endpoint}

**Decision:** The `GET/POST /api/settings` endpoint is removed entirely -- no compatibility shim.

**Rationale:**
- User confirmed: "Remove entirely -- no other callers after settings-api.ts is updated"
- The only caller is `settings-api.ts`, which is updated in the same phase
- A shim would add maintenance burden for no benefit

**Implications:**
- `settings.rs` module is deleted
- `SettingsState` struct is deleted
- All `/api/settings` integration tests are deleted
- `build_app` no longer creates `SettingsState` or registers the `/api/settings` route

#### [D04] Tagged-value wire format for layout and theme (DECIDED) {#d04-tagged-value-format}

**Decision:** The frontend uses the tagged-value wire format (`{"kind":"json","value":...}` for layout, `{"kind":"string","value":"..."}` for theme) when reading from and writing to the `/api/defaults/` endpoints.

**Rationale:**
- The `/api/defaults/` endpoints already use this format (Phase 5e3)
- Layout is a complex JSON object, so `Value::Json` is the natural fit
- Theme is a simple string name, so `Value::String` is the natural fit
- No need to invent a new serialization; reuse what exists

**Implications:**
- `fetchSettingsWithRetry` is replaced by two domain-specific fetch functions that unwrap tagged values
- `postSettings` is replaced by two domain-specific PUT functions that wrap values in tagged format

#### [D05] Migration runs synchronously at startup (DECIDED) {#d05-synchronous-migration}

**Decision:** The migration function runs synchronously (blocking) during tugcast startup, after the tugbank database is opened but before the HTTP server begins accepting connections.

**Rationale:**
- Eliminates any race between migration writes and frontend reads
- Migration touches at most two keys in two domains -- sub-millisecond operation
- Matches clarifier assumption about synchronous startup migration

**Implications:**
- Migration logic is called in `main.rs` between `DefaultsStore::open()` and `run_server()`
- The `DefaultsStore` must be opened before migration (currently happens inside `build_app`; needs to be lifted out)

#### [D06] saveLayout writes only layout, not theme (DECIDED) {#d06-layout-only-save}

**Decision:** `DeckManager.saveLayout()` calls only `putLayout()`. It no longer saves theme. Theme is saved exclusively by `theme-provider.tsx` when the user changes it.

**Rationale:**
- Theme changes only via `theme-provider.tsx` (user action or `set-theme` control frame), which already calls `postSettings({ theme })` independently
- The old `saveLayout()` saved both layout and theme as a belt-and-suspenders measure, but with separate tugbank domains each value has exactly one write path
- Eliminates redundant PUT on every card move/resize/add/remove, reducing HTTP traffic

**Implications:**
- `DeckManager.saveLayout()` no longer calls `readCurrentThemeFromDOM()` or any theme-save function
- `readCurrentThemeFromDOM()` can be removed from `DeckManager` (dead code after this change)
- `deck-manager.ts` only needs to import `putLayout`, not `putTheme`

---

### Specification {#specification}

#### Migration Logic {#migration-logic}

**Spec S01: Migration function signature and behavior** {#s01-migration-fn}

```rust
/// Migrate legacy deck-settings.json to tugbank domains.
///
/// Reads the flat file at `{source_tree}/.tugtool/deck-settings.json`.
/// If the file exists:
///   1. Parse as `serde_json::Value` and extract `layout`/`theme` fields
///   2. If parsing succeeds and `layout` is present, write `Value::Json(v)`
///      to domain `dev.tugtool.deck.layout`, key `layout`
///   3. If parsing succeeds and `theme` is present, write `Value::String(s)`
///      to domain `dev.tugtool.app`, key `theme`
///   4. If parsing fails completely (not valid JSON), log `warn!` and
///      write nothing to tugbank -- the data is unrecoverable
///   5. Delete the flat file unconditionally (even on parse failure, to
///      prevent the migration from re-running and logging on every startup)
///   6. Log migration result at info level
///
/// If the file does not exist, this function is a no-op.
pub(crate) fn migrate_settings_to_tugbank(
    source_tree: &Path,
    store: &DefaultsStore,
) -> Result<(), Box<dyn std::error::Error>>
```

#### Frontend API Surface {#frontend-api}

**Spec S02: Replacement functions in settings-api.ts** {#s02-frontend-api}

| Old function | New function | Endpoint | Wire format |
|-------------|-------------|----------|-------------|
| `fetchSettingsWithRetry("/api/settings")` | `fetchLayoutWithRetry()` | `GET /api/defaults/dev.tugtool.deck.layout/layout` | Response: `{"kind":"json","value":{...}}` or 404 |
| `fetchSettingsWithRetry("/api/settings")` | `fetchThemeWithRetry()` | `GET /api/defaults/dev.tugtool.app/theme` | Response: `{"kind":"string","value":"brio"}` or 404 |
| `postSettings({ layout })` | `putLayout(layout)` | `PUT /api/defaults/dev.tugtool.deck.layout/layout` | Body: `{"kind":"json","value":{...}}` |
| `postSettings({ theme })` | `putTheme(theme)` | `PUT /api/defaults/dev.tugtool.app/theme` | Body: `{"kind":"string","value":"brio"}` |

**Table T01: Tagged value format for settings** {#t01-tagged-format}

| Setting | Domain | Key | Kind | Example wire value |
|---------|--------|-----|------|--------------------|
| Layout | `dev.tugtool.deck.layout` | `layout` | `json` | `{"kind":"json","value":{"version":5,"cards":[...]}}` |
| Theme | `dev.tugtool.app` | `theme` | `string` | `{"kind":"string","value":"bluenote"}` |

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy**: No backward compatibility. The flat-file backend is removed in this phase.
- **Migration plan**:
  - What changes: Settings storage moves from `.tugtool/deck-settings.json` to `~/.tugbank.db` (SQLite)
  - Who is impacted: All existing tugdeck users with saved layouts/themes
  - How to migrate: Automatic on first startup after upgrade. The migration reads the flat file, writes to tugbank, and deletes the flat file.
  - How to detect breakage: If layout is blank after upgrade, check `tugbank read dev.tugtool.deck.layout layout` via CLI
- **Rollout plan**: Ship in a single release. No feature gate needed -- migration is automatic and one-way.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugcast/src/migration.rs` | One-time flat-file-to-tugbank migration logic |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `migrate_settings_to_tugbank` | fn | `tugcast/src/migration.rs` | Reads flat file, writes to tugbank, deletes flat file |
| `mod migration` | module | `tugcast/src/main.rs` | Module declaration for migration.rs |
| `fetchLayoutWithRetry` | fn | `tugdeck/src/settings-api.ts` | Fetch layout from `/api/defaults/dev.tugtool.deck.layout/layout` |
| `fetchThemeWithRetry` | fn | `tugdeck/src/settings-api.ts` | Fetch theme from `/api/defaults/dev.tugtool.app/theme` |
| `putLayout` | fn | `tugdeck/src/settings-api.ts` | PUT layout to tugbank via tagged-value format |
| `putTheme` | fn | `tugdeck/src/settings-api.ts` | PUT theme to tugbank via tagged-value format |
| `readCurrentThemeFromDOM` | fn (remove) | `tugdeck/src/deck-manager.ts` | Dead code after [D06]; theme saved only by theme-provider.tsx |

#### Files to delete {#files-to-delete}

| File | Reason |
|------|--------|
| `tugcode/crates/tugcast/src/settings.rs` | Legacy flat-file settings module replaced by tugbank |

---

### Documentation Plan {#documentation-plan}

- [ ] Update any developer docs referencing `/api/settings` to point to `/api/defaults/`
- [ ] Add migration note to changelog for the release containing this phase

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test migration function in isolation with temp dirs | Migration logic, edge cases (missing file, corrupt file, partial data) |
| **Integration** | Test end-to-end flow: migration runs, frontend fetches from tugbank | Verify settings survive a restart cycle |
| **Regression** | Verify old `/api/settings` route is gone | 404 response for removed endpoints |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add migration module to tugcast {#step-1}

**Commit:** `feat(tugcast): add settings-to-tugbank migration module`

**References:** [D01] File-existence migration guard, [D02] Domain and key naming, [D05] Synchronous migration, Spec S01, Table T01, Risk R01, (#migration-logic, #context)

**Artifacts:**
- `tugcode/crates/tugcast/src/migration.rs` -- new module with `migrate_settings_to_tugbank` function
- `tugcode/crates/tugcast/src/main.rs` -- `mod migration;` declaration

**Tasks:**
- [ ] Create `migration.rs` with `migrate_settings_to_tugbank(source_tree: &Path, store: &DefaultsStore) -> Result<(), Box<dyn std::error::Error>>`
- [ ] Read `{source_tree}/.tugtool/deck-settings.json` using `std::fs::read_to_string` (synchronous I/O is acceptable for this sub-millisecond file read; migration runs before the server accepts connections)
- [ ] Parse as `serde_json::Value`, extract `layout` and `theme` fields
- [ ] Write `layout` as `Value::Json(v)` to domain `dev.tugtool.deck.layout`, key `layout` using `store.domain(...).set(...)`
- [ ] Write `theme` as `Value::String(s)` to domain `dev.tugtool.app`, key `theme`
- [ ] Delete the flat file with `std::fs::remove_file` unconditionally after processing (even on parse failure) to prevent the migration from re-running on every startup
- [ ] Log at `info!` level: "migrated deck settings to tugbank" on success, or "no legacy settings file found, skipping migration" when file is absent
- [ ] Handle parse errors gracefully: on complete parse failure, log `warn!` with file path and error, write nothing to tugbank, but still delete the file. On partial parse (valid JSON but missing fields), write whatever fields are present
- [ ] Add `mod migration;` to `main.rs`

**Tests:**
- [ ] T01: Migration with both layout and theme writes both keys and deletes flat file
- [ ] T02: Migration with layout only writes layout key, no theme key
- [ ] T03: Migration with theme only writes theme key, no layout key
- [ ] T04: Migration with missing flat file is a no-op (returns Ok, no writes)
- [ ] T05: Migration with corrupt/unparseable flat file logs warning, writes nothing to tugbank, and still deletes the flat file
- [ ] T06: Migration with empty JSON `{}` is a no-op (no keys written, file still deleted)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --filter-expr 'test(migrate)'`
- [ ] `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning` returns 0

---

#### Step 2: Wire migration into tugcast startup {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): run settings migration at startup before server bind`

**References:** [D05] Synchronous migration, [D01] File-existence migration guard, (#strategy, #dependencies)

**Artifacts:**
- `tugcode/crates/tugcast/src/main.rs` -- call `migrate_settings_to_tugbank` after bank path resolution, before `run_server`
- `tugcode/crates/tugcast/src/server.rs` -- lift `DefaultsStore::open()` out of `build_app` so the store can be shared between migration and the server

**Tasks:**
- [ ] In `main.rs`, after `bank_path` resolution (around line 45) and after `watch_dir` resolution, call `DefaultsStore::open(&path)` to open the store. On success, wrap in `Some(Arc::new(store))`. On failure, log `warn!` and set store to `None` -- this preserves the existing graceful degradation pattern from `build_app`
- [ ] When store is `Some`, call `migration::migrate_settings_to_tugbank(&watch_dir, &store)`. Skip migration when store is `None`. Insert this call after `DefaultsStore::open()` but before the TCP listener bind (around line 248)
- [ ] Log any migration error at `warn!` level but do not abort startup (migration failure is non-fatal)
- [ ] Modify `build_app` signature to accept `Option<Arc<DefaultsStore>>` instead of `Option<PathBuf>` for `bank_path`, since the store is now opened externally
- [ ] Replace the `if let Some(path) = bank_path { match DefaultsStore::open(...) { ... } }` block (lines 166-188 in `server.rs`) with a simpler `if let Some(store) = bank_store { ... }` that directly registers the defaults routes and applies `.layer(Extension(store))`. Remove the `warn!` for open failure from `build_app` since that error handling now occurs in `main.rs`
- [ ] Update `run_server` signature accordingly
- [ ] Update `build_settings_test_app` in integration tests to match new signatures

**Tests:**
- [ ] T07: Existing integration tests still pass (build_app signature change is backward-compatible in tests)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast`
- [ ] `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning` returns 0

---

#### Step 3: Rewrite settings-api.ts for tugbank endpoints {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): rewrite settings-api.ts to use /api/defaults/ endpoints`

**References:** [D02] Domain and key naming, [D04] Tagged-value wire format, Spec S02, Table T01, (#frontend-api, #strategy)

**Artifacts:**
- `tugdeck/src/settings-api.ts` -- complete rewrite with new functions

**Tasks:**
- [ ] Remove `ServerSettings` interface and old `fetchSettingsWithRetry`/`postSettings` functions
- [ ] Add `fetchLayoutWithRetry()`: GET `/api/defaults/dev.tugtool.deck.layout/layout`, unwrap `{"kind":"json","value":...}` to return `object | null`, return `null` on 404
- [ ] Add `fetchThemeWithRetry()`: GET `/api/defaults/dev.tugtool.app/theme`, unwrap `{"kind":"string","value":"..."}` to return `string | null`, return `null` on 404
- [ ] Both fetch functions use the same exponential backoff retry pattern (retry on network error or 5xx, but treat 404 as "no data" not an error)
- [ ] Add `putLayout(layout: object)`: PUT to `/api/defaults/dev.tugtool.deck.layout/layout` with body `{"kind":"json","value":...}`
- [ ] Add `putTheme(theme: string)`: PUT to `/api/defaults/dev.tugtool.app/theme` with body `{"kind":"string","value":"..."}`
- [ ] Both PUT functions are fire-and-forget with `.catch()` error logging (same pattern as old `postSettings`)
- [ ] Keep the `sleep` helper function

**Tests:**
- [ ] T08: TypeScript compiles cleanly (`bun run check` in tugdeck)

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` (zero TypeScript errors)

---

#### Step 4: Update main.tsx and DeckManager to use new API {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): wire main.tsx and DeckManager to tugbank settings API`

**References:** [D02] Domain and key naming, [D04] Tagged-value wire format, [D06] saveLayout writes only layout, Spec S02, (#frontend-api, #context)

**Artifacts:**
- `tugdeck/src/main.tsx` -- update startup to call `fetchLayoutWithRetry()` and `fetchThemeWithRetry()` separately
- `tugdeck/src/deck-manager.ts` -- update `saveLayout()` to call only `putLayout()`; remove theme saving and `readCurrentThemeFromDOM()`
- `tugdeck/src/contexts/theme-provider.tsx` -- update `setTheme` callback to call `putTheme()` instead of `postSettings({ theme })`

**Tasks:**
- [ ] In `main.tsx`, replace `fetchSettingsWithRetry("/api/settings")` with two parallel calls: `Promise.all([fetchLayoutWithRetry(), fetchThemeWithRetry()])`
- [ ] Update the destructured result to extract layout and theme from the parallel fetch results
- [ ] In `deck-manager.ts`, update `import { postSettings }` to `import { putLayout }`
- [ ] In `saveLayout()`, replace `postSettings({ layout: serialized, theme: this.readCurrentThemeFromDOM() })` with `putLayout(serialized)` (layout only per [D06])
- [ ] Remove `readCurrentThemeFromDOM()` method from DeckManager (dead code after this change)
- [ ] In `theme-provider.tsx`, update `import { postSettings } from "../settings-api"` to `import { putTheme } from "../settings-api"`
- [ ] In `theme-provider.tsx`, replace `postSettings({ theme: newTheme })` with `putTheme(newTheme)`
- [ ] Verify no other files import from `settings-api.ts` (callers are `main.tsx`, `deck-manager.ts`, and `theme-provider.tsx`)

**Tests:**
- [ ] T09: TypeScript compiles cleanly after wiring changes
- [ ] T10: Manual smoke test: load tugdeck, verify layout loads, change theme, reload, verify theme persists

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` (zero TypeScript errors)

---

#### Step 5: Remove legacy /api/settings endpoint and settings.rs {#step-5}

**Depends on:** #step-2, #step-4

**Commit:** `refactor(tugcast): remove legacy /api/settings endpoint and settings module`

**References:** [D03] Remove legacy endpoint entirely, (#scope, #strategy)

**Artifacts:**
- `tugcode/crates/tugcast/src/settings.rs` -- DELETE entire file
- `tugcode/crates/tugcast/src/server.rs` -- remove `/api/settings` route, remove `SettingsState` import and instantiation
- `tugcode/crates/tugcast/src/main.rs` -- remove `mod settings;` declaration
- `tugcode/crates/tugcast/src/integration_tests.rs` -- remove all `test_settings_*` tests and `build_settings_test_app` helper

**Tasks:**
- [ ] Delete `tugcode/crates/tugcast/src/settings.rs`
- [ ] In `server.rs`: remove `use crate::settings::SettingsState;` import
- [ ] In `server.rs` `build_app`: remove `settings_path` derivation, `SettingsState` creation, `Arc::new(SettingsState {...})`, the `.route("/api/settings", ...)` call, and the `.layer(Extension(settings_state))` call
- [ ] In `main.rs`: remove `mod settings;`
- [ ] In `integration_tests.rs`: remove `build_settings_test_app` function and all `test_settings_*` test functions
- [ ] Note: deleting `settings.rs` also removes its internal `#[cfg(test)] mod tests` block (round-trip tests, load/save tests)
- [ ] Fix any resulting unused-import warnings (remember: warnings are errors)

**Tests:**
- [ ] T11: Verify `/api/settings` GET returns 404 (route no longer registered)
- [ ] T12: All remaining integration tests pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast`
- [ ] `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning` returns 0

---

#### Step 6: Add integration tests for migration and new flow {#step-6}

**Depends on:** #step-5

**Commit:** `test(tugcast): add integration tests for tugbank migration and defaults-based settings`

**References:** [D01] File-existence migration guard, [D02] Domain and key naming, Spec S01, Spec S02, Table T01, (#success-criteria, #test-categories)

**Artifacts:**
- `tugcode/crates/tugcast/src/integration_tests.rs` -- new integration tests

**Tasks:**
- [ ] Add `test_migration_writes_layout_and_theme_to_tugbank`: create a flat file with layout and theme, call migration, verify both keys are present via `/api/defaults/` GET endpoints
- [ ] Add `test_migration_deletes_flat_file`: verify the flat file is gone after migration
- [ ] Add `test_migration_noop_when_no_flat_file`: verify migration is a no-op when no flat file exists, and defaults endpoints return 404 for both keys
- [ ] Add `test_defaults_layout_put_then_get`: PUT a layout JSON, GET it back, verify round-trip
- [ ] Add `test_defaults_theme_put_then_get`: PUT a theme string, GET it back, verify round-trip
- [ ] Update `build_settings_test_app` (or create a new `build_defaults_test_app`) to work with the new `build_app` signature that accepts `Option<Arc<DefaultsStore>>`

**Tests:**
- [ ] T13-T17: All five new integration tests pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast`
- [ ] `cd tugcode && cargo build -p tugcast 2>&1 | grep -c warning` returns 0

---

#### Step 7: Final Integration Checkpoint {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] File-existence migration guard, [D02] Domain and key naming, [D03] Remove legacy endpoint entirely, [D04] Tagged-value wire format, [D05] Synchronous migration, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all Rust tests pass with zero warnings
- [ ] Verify all TypeScript checks pass
- [ ] Verify the flat file is not recreated after a full startup cycle
- [ ] Verify layout and theme survive a tugcast restart via `curl` to the defaults endpoints
- [ ] Verify `/api/settings` returns 404

**Tests:**
- [ ] T18: Full test suite passes (`cargo nextest run` -- all packages, zero failures)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run`
- [ ] `cd tugcode && cargo fmt --all --check`
- [ ] `cd tugdeck && bun run check`
- [ ] `curl -s http://localhost:55255/api/settings` returns 404
- [ ] `curl -s http://localhost:55255/api/defaults/dev.tugtool.deck.layout/layout` returns tagged JSON with layout
- [ ] `curl -s http://localhost:55255/api/defaults/dev.tugtool.app/theme` returns tagged string with theme name

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All deck settings persistence flows through tugbank via `/api/defaults/` endpoints. The legacy flat-file backend and `/api/settings` endpoint are removed. Domain separation (`dev.tugtool.deck.layout`, `dev.tugtool.app`) is established for Phase 5f and beyond.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Layout loads from tugbank on startup (verify: `curl` GET returns layout JSON)
- [ ] Theme persists across reload (verify: change theme, restart tugcast, verify theme via `curl`)
- [ ] Flat file deleted after migration (verify: `ls .tugtool/deck-settings.json` returns "No such file")
- [ ] Legacy endpoint removed (verify: `curl /api/settings` returns 404)
- [ ] `cargo nextest run` passes (zero failures, zero warnings)
- [ ] `bun run check` passes in tugdeck (zero TypeScript errors)

**Acceptance tests:**
- [ ] T01-T06: Migration unit tests (Step 1)
- [ ] T07: Existing tests still pass after signature refactor (Step 2)
- [ ] T08-T10: TypeScript compilation and frontend wiring (Steps 3-4)
- [ ] T11-T12: Legacy endpoint removal verification (Step 5)
- [ ] T13-T17: New integration tests for migration and defaults flow (Step 6)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5f: Add `dev.tugtool.deck.state` and `dev.tugtool.deck.tabstate` domains for inactive state preservation
- [ ] Add tugbank CLI convenience commands for inspecting deck settings
- [ ] Consider batch read endpoint for fetching multiple keys in one round-trip (optimization)

| Checkpoint | Verification |
|------------|--------------|
| Migration writes correct data | `cargo nextest run -p tugcast --filter-expr 'test(migrate)'` |
| Legacy endpoint removed | `curl -s http://localhost:55255/api/settings` returns 404 |
| Frontend compiles | `cd tugdeck && bun run check` |
| Full test suite | `cd tugcode && cargo nextest run` |
