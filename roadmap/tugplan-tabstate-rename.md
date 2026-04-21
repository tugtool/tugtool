<!-- tugplan-skeleton v2 -->

## Tabstate Rename — Tugbank Prefix and `tabId` Parameter {#tabstate-rename}

**Purpose:** Retire the `dev.tugtool.deck.tabstate/` tugbank key prefix and rename it to `dev.tugtool.deck.cardstate/`, rename the `tabId` parameter name to `cardId` throughout `settings-api.ts` and callers, and land a one-shot launch-time migration that rewrites existing `tabstate/` rows under the `cardstate/` prefix and deletes the old rows. The `tabstate/` name is a fossil from when the in-pane content identity was called a "tab" — it is now a *card* everywhere else in the code, and the persistence prefix should say so.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-21 |
| Predecessor | [tugplan-vocabulary-pane-rename.md](./tugplan-vocabulary-pane-rename.md) (complete — Deck → Pane → Card vocabulary landed) |
| Sibling | [tugplan-card-and-token-sweep.md](./tugplan-card-and-token-sweep.md) (in-source rename + token work; runs independently of this plan) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Tug app persists per-card state (scroll, selection, card-specific content like tide's session binding) in tugbank under the domain `dev.tugtool.deck.tabstate`. That domain name, and the `tabId` parameter name on the read/write functions, is the last data-layer fossil from the pre-two-table era when a "tab" was an in-pane content identity. After the two-table rename (cards + stacks/windows/panes), the content identity is a *card* — and every Tug-authored TypeScript identifier for content uses `cardId`. The tugbank domain still says `tabstate`.

The prior rename plans deliberately left this alone because it involved a data migration:

- **`tugplan-vocabulary-rename.md` (D05, 2026-04-21):** "The `{id}` is already the cardId (identity was preserved during Step 11.6.1a); only the historical prefix carries the old word. Renaming the prefix would force a data migration that buys nothing."
- **`tugplan-vocabulary-pane-rename.md` (D05):** same stance — "if / when a user-facing reason surfaces."

The user-facing reason is now surfaced: the rename plans have made every other `tab*` data-layer identifier into `card*`, and the persistence prefix is the last stranger in the room. A reader who opens `settings-api.ts` today sees `putTabState(tabId, bag)` and a URL containing `tabstate/`, while every caller uses `cardId` vocabulary. That mismatch has to go away.

The migration itself is modest: a one-shot launch-time function that reads the `tabstate` domain, writes any rows not already present in `cardstate` under the new prefix, and deletes the old rows. Because **identity is preserved** — card ids match the former tab ids — the migration is a pure key-prefix rewrite with no value transformation.

#### Strategy {#strategy}

- **Rename the domain name in one atomic commit.** `dev.tugtool.deck.tabstate` → `dev.tugtool.deck.cardstate`. The URL, the `readDomain` call, the JSDoc, the comments, the test-fixture URLs — all in one commit, paired with the migration so no window of "half-renamed" exists.
- **Rename the parameter names in the same commit.** `tabId` → `cardId` across `settings-api.ts` and every test / caller that references the parameter positionally or by name. The URL-level rename and the parameter rename are cosmetically coupled — keep them together.
- **Migration: launch-time, one-shot, idempotent.** Before `DeckManager` reads card states, run `migrateTabstateToCardstate(client)`. It reads both domains, writes any `tabstate` rows that aren't already in `cardstate`, and deletes the old rows. Idempotent: calling it on a fully-migrated tugbank is a no-op. Safe to call on every launch; the cost is a single `readDomain` pair read.
- **Tugbank client surface stays unchanged.** `TugbankClient.readDomain(name)` / `put` / `delete` APIs don't need new entry points. The migration is a client consumer, not a client feature.
- **Function rename carries the name change:** `readTabStates` → `readCardStates`, `putTabState` → `putCardState`. Paired with parameter and URL rename.
- **Test fixtures get renamed for readability** (`tab-1` → `card-1` etc.) — not required for correctness but makes the test intent clear once the vocabulary has flipped.

#### Success Criteria (Measurable) {#success-criteria}

- `rg "tabstate|tabState|TabState" tugdeck/src` returns zero matches (excluding migration code's reference to the old domain name, which is explicitly documented as "legacy").
- `rg "\btabId\b" tugdeck/src` returns zero matches.
- `rg "readTabStates|putTabState" tugdeck/src` returns zero matches.
- `rg "dev\\.tugtool\\.deck\\.tabstate" tugdeck/src` returns matches only in the migration function (explicitly, with a comment flagging it as legacy).
- A running app with pre-migration `tabstate/` rows, when launched at head, migrates them on first read: the `cardstate/` domain ends with all prior rows and the `tabstate/` domain is empty.
- A running app launched against a fresh tugbank (no pre-migration rows) works correctly with `cardstate/` only.
- Every step commit: `bun x tsc --noEmit` clean, `bun test` green.
- Manual: launch app with pre-existing `tabstate/` rows, verify per-card state survives (tide session binding, scroll position, prompt history — whatever currently persists).

#### Scope {#scope}

1. Add `migrateTabstateToCardstate(client)` function + unit tests.
2. Wire the migration into app startup (main.tsx), before `readCardStates`.
3. Rename `putTabState` → `putCardState` (parameter `tabId` → `cardId`, URL domain from `.tabstate` → `.cardstate`).
4. Rename `readTabStates` → `readCardStates` (parameter `tabIds` → `cardIds`, `readDomain("…tabstate")` → `readDomain("…cardstate")`).
5. Update every caller of the two functions.
6. Rename JSDoc / comments across `layout-tree.ts`, `deck-manager.ts`, `serialization.ts`, `main.tsx` that describe the tugbank prefix.
7. Rename test-fixture ids from `tab-*` to `card-*` and URL assertions from `.tabstate/` to `.cardstate/` (except in the migration test, which deliberately uses the old prefix to exercise the migration).
8. Integration checkpoint + manual verification with live tugbank data.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Data-model identifiers:** `CardState`, `CardStateBag`, `CardHost`, etc. — all frozen.
- **Card vocabulary inside the codebase:** covered by the sibling plan `tugplan-card-and-token-sweep.md`.
- **Client-side tugbank API rework:** `TugbankClient.readDomain` / `put` / `delete` stay as-is. This plan is a consumer, not an API reshaping.
- **Rust-side (tugbank server) key-layout changes:** the server stores whatever key the client PUTs. No server work required.
- **Backfill of external consumers:** no external consumer reads tugbank directly today (all goes through the client). If that changes, add a ticket separately.

#### Dependencies / Prerequisites {#dependencies}

- `tugplan-vocabulary-pane-rename.md` closed. (It is.)
- Green HEAD on main. All tests passing.
- A dev tugbank with pre-existing `tabstate/` rows available for the manual migration smoke (any dev who has opened the app in the last several months will have them).

#### Constraints {#constraints}

- The migration **must be idempotent** — re-running it on a migrated bank is a no-op.
- The migration **must not lose data** — if a `cardstate/` row exists and a `tabstate/` row with the same id also exists, the `cardstate/` row wins (it's the newer one). Document the tie-breaking rule and pin it with a test.
- `bun test` must be green at every step commit.

#### Assumptions {#assumptions}

- Card ids and former tab ids are numerically equal (preserved through all prior renames). Verified by comments in `main.tsx:125` and `serialization.ts:24`.
- `TugbankClient.readDomain(name)` returns the full object stored at that domain, or `undefined` when the domain has no rows. Confirmed by `readTabStates` source.
- No external consumer reads the `tabstate/` prefix directly. (Swift reads layout + focused-card-id, not per-card state.)

---

### Design Decisions {#design-decisions}

#### [D01] Migration is launch-time, one-shot, idempotent (DECIDED) {#d01-migration-shape}

**Decision:** Add `migrateTabstateToCardstate(client: TugbankClient)` in `settings-api.ts`. Call it from `main.tsx` during app boot, immediately before `readCardStates`. The function reads both domains; for each row present in `tabstate` but not in `cardstate`, it PUTs to `cardstate` and DELETEs from `tabstate`. Returns a summary (rows migrated, rows skipped, rows deleted) for logging.

**Rationale:**
- Keeping the migration at the client is simpler than a server-side one-shot job.
- Launch-time runs once per app open; after the first open on any given tugbank, it's a no-op. Cost is one `readDomain` pair per open.
- Idempotence is trivial to enforce: only write to `cardstate` if the key isn't already there; only delete from `tabstate` after the `cardstate` write succeeds.
- Explicit summary logging makes verification visible in the dev console.

**Implications:** The migration depends on `TugbankClient` exposing PUT and DELETE (confirmed it does). The function is sync-ish (awaits the writes and deletes) so boot blocks until migration completes — this is acceptable because the read-domain call already blocks boot and the migration payload is O(cards).

#### [D02] `cardstate` wins on tie (DECIDED) {#d02-tie-breaking}

**Decision:** If a row exists in both `cardstate/{id}` and `tabstate/{id}`, keep the `cardstate/` value and delete the `tabstate/` row.

**Rationale:**
- By construction, a row can only appear in `cardstate/` after this migration has run (or after the renamed `putCardState` has written it). Either case means `cardstate/` carries the newer value.
- Inverse rule ("`tabstate` wins") would require the app to accept stale writes, which is worse semantically.

**Implications:** Document the rule in a JSDoc comment on `migrateTabstateToCardstate`. Pin with a test case ("both domains have id X with different values; after migration, cardstate has the original cardstate value, tabstate has no row").

#### [D03] Functions rename in lockstep with the URL change (DECIDED) {#d03-function-rename}

**Decision:** `putTabState` → `putCardState`, `readTabStates` → `readCardStates`. No backwards-compat aliases — the rename is internal only, and TypeScript will catch every caller.

**Rationale:**
- The function names echo the URL path; changing one without the other is incoherent.
- No external consumer means no deprecation cycle needed.
- Aliases would have to be deleted eventually anyway — skip the intermediate step.

**Implications:** Every call site + test asserts under the new names. Comments across the tree that reference `putTabState` / `readTabStates` also update.

#### [D04] Test fixture ids rename (`tab-1` → `card-1`) (DECIDED) {#d04-test-fixture-ids}

**Decision:** Test fixture IDs in `settings-api.test.ts` and `deck-manager.test.ts` rename from `tab-*` / `tab-present` / `tab-missing` to `card-*` / `card-present` / `card-missing`. Exception: the migration test deliberately uses `tab-*`-style values when writing through the legacy prefix, to prove the migration reads them.

**Rationale:**
- Tests should read coherently under the current vocabulary. `tab-1` as a hand-picked id is noise that a future reader has to translate.
- Exception-for-migration-test preserves the migration coverage while cleaning up the rest.

**Implications:** Test body edits are mechanical. Assertions that include the full URL (`/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`) also become `.cardstate/${encodeURIComponent(cardId)}`.

---

### Risks and Mitigations {#risks}

**Risk R01: Migration loses data** {#r01-data-loss}

- **Risk:** A bug in the migration function could DELETE a `tabstate/` row without a matching `cardstate/` PUT, losing per-card state.
- **Mitigation:** Explicit ordering — PUT `cardstate/{id}` first, verify the write, then DELETE `tabstate/{id}`. Unit tests that mock `put` failure and assert the delete does NOT happen. Integration test with a real `TugbankClient` double.
- **Residual risk:** Very low.

**Risk R02: Migration re-runs after manual tugbank changes** {#r02-reentrancy}

- **Risk:** User somehow ends up with orphaned `tabstate/` rows after migration (e.g., via a future bug or manual surgery). Next launch re-runs the migration; if the code drift between launches has changed the schema, we could rewrite stale rows over fresh ones.
- **Mitigation:** The migration only PUTs to `cardstate/` when no existing `cardstate/` row is found. "cardstate wins" rule ([D02]) is load-bearing here. Pin with a test.
- **Residual risk:** Very low.

**Risk R03: `TugbankClient.readDomain` semantics change** {#r03-client-api-drift}

- **Risk:** The migration reads both `tabstate` and `cardstate` domains via the client. If `readDomain` evolves to have different semantics (e.g., throws on missing domain instead of returning `undefined`), the migration could break.
- **Mitigation:** Snapshot the client API behavior in a unit test for `migrateTabstateToCardstate` — pass a stub that returns `undefined` for missing domains and assert the function handles it cleanly.
- **Residual risk:** Low; pinned by tests.

**Risk R04: Launch boot time grows** {#r04-boot-time}

- **Risk:** Migration adds a read + write pass at every launch on every user's tugbank. For a user with many cards, this could be slow.
- **Mitigation:** (a) The typical card count is small (tens at most). (b) The migration is a no-op once `tabstate` is empty — and `tabstate` becomes empty after the first successful launch. Effectively, migration cost is "one pair of `readDomain` calls per launch, one extra no-op loop." Negligible.
- **Residual risk:** Zero. No-op fast-path is trivial: check `tabstate` domain is empty → return immediately.

---

### Execution Steps {#execution-steps}

#### Step 1: Add `migrateTabstateToCardstate` (no wiring yet) {#step-1}

**Commit:** `Add migrateTabstateToCardstate function with unit tests`

**References:** [D01] Migration shape, [D02] Tie-breaking

**Artifacts:**
- `tugdeck/src/settings-api.ts` — new function `migrateTabstateToCardstate(client: TugbankClient): Promise<MigrationSummary>`. Export the `MigrationSummary` type.
- `tugdeck/src/__tests__/settings-api.test.ts` — new describe block with unit tests.

**Function sketch:**
```ts
export interface MigrationSummary {
  migrated: number;   // rows PUT to cardstate + DELETE from tabstate
  skipped: number;    // rows already in cardstate (tabstate row also deleted)
  unchanged: number;  // rows only in cardstate (nothing to do)
}

export function migrateTabstateToCardstate(client: TugbankClient): Promise<MigrationSummary>;
```

**Tests (minimum set):**
- [x] Empty `tabstate` + empty `cardstate` → summary `{ migrated: 0, skipped: 0, unchanged: 0 }`.
- [x] Three rows in `tabstate`, none in `cardstate` → all three migrated; `tabstate` empty afterward; `cardstate` has all three values verbatim.
- [x] Two rows in both domains (same ids), cardstate has newer values → `cardstate` retained; `tabstate` rows deleted.
- [x] One row only in `cardstate` (not in `tabstate`) → unchanged; no writes, no deletes.
- [x] `put` throws on the first write → the function does NOT delete the corresponding `tabstate` row (partial-migration safety).
- [x] Idempotence: running the function twice on the same starting state is the same as running it once.

**Checkpoint:**
- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green (existing + ~6 new).

---

#### Step 2: Rename `putTabState` → `putCardState` {#step-2}

**Depends on:** #step-1

**Commit:** `Rename putTabState → putCardState (wire URL, parameter, callers)`

**References:** [D03] Function rename

**Artifacts:**
- `tugdeck/src/settings-api.ts` — function rename, parameter `tabId` → `cardId`, URL path `dev.tugtool.deck.tabstate` → `dev.tugtool.deck.cardstate`, JSDoc.
- Callers: `deck-manager.ts`.
- Tests: `settings-api.test.ts` — describe block + URL assertions + fixture ids.

**Tasks:**
- [x] Rename the function + parameter + URL in `settings-api.ts`.
- [x] Update JSDoc.
- [x] Update `deck-manager.ts` import + call site (`promises.push(putCardState(cardId, bag, options))`).
- [x] Update every test URL assertion and describe label.
- [x] Rename test fixture ids to `card-*` per [D04].

**Checkpoint:**
- [x] `bun x tsc --noEmit` clean; `bun test` green.
- [x] `rg "putTabState" tugdeck/src` returns zero matches.

---

#### Step 3: Rename `readTabStates` → `readCardStates` {#step-3}

**Depends on:** #step-2

**Commit:** `Rename readTabStates → readCardStates (domain, parameter, callers)`

**References:** [D03] Function rename

**Artifacts:**
- `tugdeck/src/settings-api.ts` — function rename, parameter `tabIds` → `cardIds`, `readDomain("dev.tugtool.deck.tabstate")` → `readDomain("dev.tugtool.deck.cardstate")`.
- Callers: `main.tsx` — import + call site, plus the enclosing `tabStates` variable renamed to `cardStates`.
- Tests: `settings-api.test.ts` — describe block + fixture ids + URL assertions.

**Tasks:**
- [x] Rename function + parameter + domain in `settings-api.ts`.
- [x] Update JSDoc.
- [x] Update `main.tsx` — `tabStates` → `cardStates`, `readTabStates` → `readCardStates`, and update the constructor argument in the `new DeckManager(...)` call (the parameter is `initialCardStates`, so the variable rename is the only change).
- [x] Update every test describe + URL + fixture.

**Checkpoint:**
- [x] `bun x tsc --noEmit` clean; `bun test` green.
- [x] `rg "readTabStates" tugdeck/src` returns zero matches.
- [x] `rg "\btabId\b|\btabIds\b|tabState\b|tabStates\b" tugdeck/src` returns zero matches.

---

#### Step 4: Wire the migration into app boot {#step-4}

**Depends on:** #step-3

**Commit:** `Call migrateTabstateToCardstate during app boot`

**References:** [D01] Migration shape

**Artifacts:**
- `tugdeck/src/main.tsx` — call `migrateTabstateToCardstate(tugbankClient)` immediately before `readCardStates(...)`. Log the summary.

**Tasks:**
- [ ] Import `migrateTabstateToCardstate`.
- [ ] Insert the call. Log the summary with a marker like `[migrate]`.
- [ ] Remove the now-stale comment at `main.tsx:125` about "tugbank's `tabstate/{id}` rows remain addressable without a data-layer migration" — that comment documented the old policy; it's been superseded.
- [ ] Update comment in `serialization.ts:24` similarly.

**Manual smoke:**
- [ ] Launch against a dev tugbank that has pre-existing `tabstate/` rows. Confirm the console shows `[migrate] migrated: N, skipped: ..., unchanged: ...` with non-zero migrated count.
- [ ] Relaunch. Console shows `[migrate] migrated: 0, skipped: 0, unchanged: N` (idempotence confirmed; N is the count that landed under `cardstate/`).
- [ ] Confirm tide-card session binding + prompt history persist across reloads after migration.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean; `bun test` green.
- [ ] Manual smoke passes.

---

#### Step 5: Comment + JSDoc cleanup {#step-5}

**Depends on:** #step-4

**Commit:** `Sweep remaining tabstate / tabId references in comments and JSDoc`

**References:** (#context)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` — comments at L32-33 ("in tugbank under `dev.tugtool.deck.tabstate/{cardId}` (durable backing store). The tugbank row prefix retains the historical `tabstate/`...") — rewrite to describe the post-migration state and reference the migration function for the history.
- `tugdeck/src/deck-manager.ts:911` — comment about the historical prefix.
- Any remaining grep hits not covered by Steps 2–4.

**Tasks:**
- [ ] Grep-walk every remaining `tabstate` / `tabState` / `TabState` reference in `tugdeck/src`. For each, decide: (a) migration code (keep, explicitly flagged), (b) JSDoc describing the old policy (rewrite to current), or (c) stale — delete.
- [ ] Update any Rust-side comment references if present (likely none).

**Checkpoint:**
- [ ] `rg "tabstate|tabState|TabState" tugdeck/src` returns matches only in `settings-api.ts` migration code and the migration test (all explicitly flagged with JSDoc as legacy).
- [ ] `bun test` green.

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**Tasks:**
- [ ] Full build matrix: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.
- [ ] Grep sweep:
  ```
  rg "\btabId\b|\btabIds\b|tabState\b|tabStates\b|putTabState|readTabStates" tugdeck/src
  ```
  Expected: zero matches.
  ```
  rg "dev\\.tugtool\\.deck\\.tabstate" tugdeck/src
  ```
  Expected: matches only in `settings-api.ts` migration code + its test, each with a comment saying "legacy prefix — read during migration only."
- [ ] Manual migration smoke:
  - Launch against tugbank with pre-existing `tabstate/` rows → migration runs once, per-card state survives.
  - Relaunch → migration is no-op.
  - Launch against fresh tugbank → no migration activity, no errors.
- [ ] Relevant tide-card smoke paths still pass (session binding persists; prompt history persists).

**Checkpoint:**
- [ ] All four build checks green.
- [ ] Grep sweep clean.
- [ ] Manual migration smoke passes on at least one dev tugbank with pre-existing rows.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugbank per-card state is stored under `dev.tugtool.deck.cardstate/{cardId}`. The function API reads `readCardStates` / `putCardState` with `cardId` parameters. A launch-time migration rewrites pre-existing `tabstate/` rows under the new prefix (idempotent, loss-free). No non-migration code references `tabstate` / `tabId` / `TabState`.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All 5 implementation steps committed; integration checkpoint (#step-6) passes.
- [ ] Grep sweep clean (migration code is the only remaining `tabstate` reference, each tagged legacy).
- [ ] Manual smoke on a real dev tugbank confirms per-card state survives migration.

**Acceptance tests:**
- [ ] 6 new unit tests for `migrateTabstateToCardstate` (empty, three-rows, tie-breaking, cardstate-only, write-failure, idempotence).
- [ ] Existing `settings-api.test.ts` coverage migrated to the new names; assertions pass.
- [ ] Existing `deck-manager.test.ts` coverage migrated.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Schedule removal of the migration function after some quiescence period (say, 90 days or two release cycles). At removal time, add a new step: delete `migrateTabstateToCardstate`, its call site, and its tests; document the removal in `tuglaws/pane-model.md` (or wherever the data-layer vocabulary settles) as "legacy migration retired 2026-MM-DD."
- [ ] Consider whether other domain names (`dev.tugtool.deck.layout`, `dev.tugtool.app.theme`) need a vocabulary review. They probably don't — `layout` and `theme` describe what they store, not a deprecated data-model concept.

---

### Open Questions {#open-questions}

*(Plan-authoring decisions resolved as [D01]–[D04]. Implementation may surface edge cases in how `TugbankClient.put` / `delete` report errors — if so, amend Step 1's tests and the migration's error handling in place.)*
