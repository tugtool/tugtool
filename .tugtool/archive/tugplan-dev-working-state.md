## Developer Card Working State {#dev-working-state}

**Purpose:** Add a "working state" dimension to the Developer card that shows whether source files have changed from the committed version, by subscribing to the existing `FeedId.GIT` feed and categorizing file paths into the Styles, Code, and App rows.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-working-state |
| Last updated | 2026-02-26 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Developer card currently tracks one dimension per row: whether the running version is current (runtime state, driven by `dev_notification` actions). It shows "Clean" when the build is current and "N changes -- restart/relaunch" when files have changed since the last build. What it does not show is whether source files differ from the committed version -- the "am I looking at committed code or work-in-progress?" question.

The infrastructure to answer this question already exists. The Git card subscribes to `FeedId.GIT` (0x20) and receives `GitStatus` payloads containing staged and unstaged file lists with full paths. The Developer card can subscribe to the same feed and categorize those file paths into its three rows (Styles, Code, App) to derive a per-row "edited file count." This is purely TypeScript frontend work -- no backend changes are needed.

#### Strategy {#strategy}

- Add `FeedId.GIT` to the Developer card's `feedIds` array so the deck-manager fan-out delivers git status frames to it.
- Implement `onFrame()` to parse the `GitStatus` JSON payload and categorize file paths into Styles, Code, and App buckets using hardcoded glob-like pattern matching.
- Count only staged and unstaged (tracked) files; ignore untracked files entirely.
- Introduce per-row `workingState` that tracks the edited file count from the latest git status frame.
- Merge runtime state (from `update()` / `dev_notification`) with working state (from `onFrame()` / git status) to produce the composite display: stale dominates edited, edited dominates clean.
- Use `var(--td-info)` (existing cyan-blue token) for the "Edited" dot color, keeping `var(--td-success)` for clean and `var(--td-warning)` for stale.
- After a "Reloaded" flash on the Styles row, return to the working state (Edited if files are still edited, Clean otherwise), not unconditionally to Clean.
- Write comprehensive tests following the existing `bun:test` + `happy-dom` pattern in `developer-card.test.ts`.

#### Success Criteria (Measurable) {#success-criteria}

- Developer card's `feedIds` array includes `FeedId.GIT` (verified by test assertion on `card.feedIds`).
- When a `GitStatus` frame arrives with files matching Styles patterns, the Styles row shows "Edited (N files)" with a blue (`var(--td-info)`) dot (verified by unit test).
- When a `GitStatus` frame arrives with files matching Code patterns, the Code row shows "Edited (N files)" with a blue dot -- unless the row is in stale state, in which case stale display is preserved (verified by unit test).
- When a `GitStatus` frame arrives with zero matching files for a row, that row shows "Clean" with a green dot (verified by unit test).
- File categorization correctly maps `tugdeck/**/*.css` and `tugdeck/**/*.html` to Styles, `tugdeck/src/**/*.ts`, `tugdeck/src/**/*.tsx`, `tugcode/**/*.rs`, and `tugcode/**/Cargo.toml` to Code, and `tugapp/Sources/**/*.swift` to App (verified by dedicated categorization unit tests).
- After a Styles "Reloaded" flash, the row returns to "Edited (N files)" if git status shows edited style files, not unconditionally to "Clean" (verified by test).
- All existing developer-card tests continue to pass (no regressions).
- `cd tugdeck && bun test` passes (full TypeScript test suite).

#### Scope {#scope}

1. Add `FeedId.GIT` subscription to `DeveloperCard.feedIds`.
2. Implement `onFrame()` handler to parse `GitStatus` JSON and categorize files into rows.
3. Add file-path categorization logic with hardcoded patterns matching the design document.
4. Add per-row working state tracking (`editedCount` per row).
5. Implement state merging logic: stale dominates edited, edited dominates clean.
6. Update row rendering to show "Edited (N files)" label with blue dot.
7. Fix "Reloaded" flash to return to working state instead of unconditional clean.
8. Write new tests for git status integration, file categorization, and state merging.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Showing individual file names in the Developer card (the Git card handles that).
- Changing the git polling interval or mechanism.
- Adding git-awareness to the Rust file watchers.
- Tracking the staged vs. unstaged distinction in the Developer card (both count as "edited").
- Showing "edited" state for files outside the three watched categories.
- Any backend (Rust) changes.

#### Dependencies / Prerequisites {#dependencies}

- The `FeedId.GIT` feed is operational and delivers `GitStatus` JSON payloads (already implemented in `tugcast/src/feeds/git.rs`).
- The deck-manager fan-out system registers cards by their `feedIds` array and delivers frames accordingly (already implemented in `deck-manager.ts`).
- The `dev_notification` system is functional and delivers runtime state via `update()` (already implemented, with improvements from the `dev-notification-improvements` plan).

#### Constraints {#constraints}

- Purely TypeScript changes in `tugdeck/src/cards/developer-card.ts` and `tugdeck/src/cards/developer-card.test.ts`.
- Dot color uses inline `style.backgroundColor` (matching the existing pattern in the Developer card), not CSS class switching.
- The blue dot color must use `var(--td-info)` which maps to `#4bbde8` (retro light) / `#42b8e6` (retro dark) / `#35bcff` (base dark).
- Tests use `bun:test` and `happy-dom` matching the existing test infrastructure.

#### Assumptions {#assumptions}

- The `GitStatus` JSON format parsed by git-card.ts (`{ branch, ahead, behind, staged, unstaged, untracked, head_sha, head_message }`) is stable and will not change during this work.
- `FeedId.GIT` frames arrive every ~2 seconds (the git feed polling interval), which is fast enough for a status indicator.
- The deck-manager replays the last frame for each subscribed feed on card mount, so the Developer card will receive the current git status immediately upon opening.
- File path patterns in `GitStatus` are relative to the repository root (e.g., `tugdeck/styles/tokens.css`, not absolute paths).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| GitStatus JSON format changes | med | low | Reuse the same `GitStatus` interface from git-card.ts or define a shared type | Git feed protocol change |
| Pattern matching too slow for large file lists | low | low | Patterns are simple prefix + suffix checks; git status rarely exceeds hundreds of files | Performance complaints |

**Risk R01: GitStatus interface drift** {#r01-gitstatus-drift}

- **Risk:** The `GitStatus` interface used in `git-card.ts` is defined locally rather than shared. If the backend format changes, both cards must be updated independently.
- **Mitigation:** Define the `GitStatus` and `FileStatus` interfaces in a shared location or duplicate with a comment linking to the git-card definition. The format is stable (matches `git status --porcelain=v2` parsing in Rust).
- **Residual risk:** A backend change could still break both cards, but this is inherent to the JSON protocol and unrelated to this feature.

---

### Design Decisions {#design-decisions}

#### [D01] Subscribe to FeedId.GIT via feedIds array (DECIDED) {#d01-subscribe-git-feed}

**Decision:** The Developer card adds `FeedId.GIT` (0x20) to its `feedIds` array, allowing the deck-manager fan-out to deliver git status frames via `onFrame()`.

**Rationale:**
- The deck-manager already handles multi-card fan-out per feed ID. Any card that declares a feed ID in its `feedIds` array receives frames for that feed.
- This requires no backend changes -- the `GitFeed` already broadcasts to all subscribers.
- On mount, the deck-manager replays the last frame, so the card gets current git status immediately.

**Implications:**
- The Developer card's `onFrame()` method changes from a no-op to an active handler.
- The `feedIds` array changes from `[]` to `[FeedId.GIT]`.
- Existing tests that assert `card.feedIds` is empty must be updated.

#### [D02] Hardcoded file path patterns for row categorization (DECIDED) {#d02-hardcoded-patterns}

**Decision:** File paths from `GitStatus` are categorized into Styles, Code, and App rows using hardcoded prefix and suffix checks in TypeScript, as specified in the design document.

**Rationale:**
- The patterns are stable (they mirror the project's directory structure).
- Keeping patterns client-side avoids any backend protocol changes.
- The patterns are simple enough that full glob matching is unnecessary -- prefix + extension checks suffice.

**Implications:**
- If the project's directory structure changes, the patterns must be updated manually in the Developer card.
- The categorization function is pure (input: file path string, output: row category or null) and easily unit-testable.

#### [D03] Count only staged and unstaged tracked files (DECIDED) {#d03-tracked-files-only}

**Decision:** Only `staged` and `unstaged` arrays from `GitStatus` contribute to edited file counts. The `untracked` array is ignored entirely.

**Rationale:**
- The user explicitly confirmed: "only staged and unstaged (tracked) files count; untracked files are ignored."
- Untracked files (new files not yet added to git) are a separate concern and would inflate the count with files that may be build artifacts or temporary files.

**Implications:**
- The `onFrame()` handler iterates `status.staged` and `status.unstaged` but skips `status.untracked`.

#### [D04] Stale dominates edited in merged display (DECIDED) {#d04-stale-dominates}

**Decision:** When merging runtime state and working state, the stale state (from `dev_notification`) always takes precedence over the edited state (from git status). The display shows the stale label with the amber dot, not the edited label.

**Rationale:**
- Stale state requires developer action (restart/relaunch). Edited state is informational only.
- Showing "Edited" while the build is stale would be confusing -- the developer needs to restart first.
- After restart/relaunch, the working state re-asserts if files are still edited.

**Implications:**
- The render logic checks runtime state first: if stale, show stale. If current, check working state.
- The "Reloaded" flash on the Styles row must return to the working state (edited or clean), not unconditionally to clean.

#### [D05] Blue dot uses var(--td-info) token (DECIDED) {#d05-blue-dot-token}

**Decision:** The "Edited" state dot uses `var(--td-info)` as its `backgroundColor`, the existing cyan-blue design token.

**Rationale:**
- The user specified `--td-info` (existing cyan-blue token, #35bcff / #4bbde8 across themes).
- Blue is intentionally calm -- it says "you have uncommitted work" without implying urgency.
- Using an existing token ensures consistency across all themes without adding new CSS variables.

**Implications:**
- The dot color is set via inline `style.backgroundColor = "var(--td-info)"`, matching the existing pattern for green (`--td-success`) and amber (`--td-warning`).

#### [D06] Reloaded flash returns to working state (DECIDED) {#d06-flash-returns-working}

**Decision:** After the 2-second "Reloaded" flash on the Styles row, the display returns to the current working state (Edited if git shows changed style files, Clean otherwise), not unconditionally to Clean.

**Rationale:**
- The user confirmed: "Return to Edited -- the working state re-asserts after the flash."
- If style files are edited (differ from committed), showing "Clean" after a reload is misleading -- the files are still uncommitted.

**Implications:**
- The `reloadedTimer` callback must check the current `workingState.editedCount` for Styles and render accordingly.
- The `cleanLabel()` helper is used only when `editedCount === 0`; otherwise `editedLabel()` is used.

#### [D08] Flash guard prevents onFrame from overwriting Reloaded text (DECIDED) {#d08-flash-guard}

**Decision:** A `stylesFlashing` boolean field guards the Styles row during the 2-second "Reloaded" flash. When `stylesFlashing` is true, `renderRow("styles")` returns immediately without updating the row. The flag is set to true when the flash starts and cleared in the timer callback before calling `renderRow("styles")`.

**Rationale:**
- Git status frames arrive every ~2 seconds -- approximately the same cadence as the flash duration. Without a guard, `onFrame()` would call `renderRow("styles")` during the flash and overwrite "Reloaded" with "Edited (N files)" or "Clean", making the flash frequently invisible.
- The flash is a deliberate visual acknowledgment that a hot reload occurred. It should be visible for its full duration.
- A simple boolean guard is the minimal, low-cost solution.

**Implications:**
- `renderRow("styles")` has an early return when `stylesFlashing` is true.
- The timer callback clears `stylesFlashing` before calling `renderRow("styles")`, so the post-flash display reflects the latest working state.
- `destroy()` must clear `stylesFlashing` and the `reloadedTimer`.

#### [D07] Duplicate GitStatus interface in developer-card (DECIDED) {#d07-duplicate-interface}

**Decision:** The `GitStatus` and `FileStatus` interfaces are duplicated in `developer-card.ts` rather than extracted to a shared module.

**Rationale:**
- The git-card already defines these interfaces locally. Extracting to a shared module is a refactoring step that is out of scope for this feature.
- A comment in both files can cross-reference the other to aid future maintainers.
- The interfaces are small (2 types, ~10 fields total) and stable.

**Implications:**
- Both `git-card.ts` and `developer-card.ts` have their own `GitStatus`/`FileStatus` type definitions.
- A future refactor could extract these to a shared types module.

---

### Deep Dives (Optional) {#deep-dives}

#### State Merging Logic {#state-merging}

The Developer card maintains two independent state sources per row:

**Table T01: Per-row state sources** {#t01-state-sources}

| Source | Updated by | Data |
|--------|-----------|------|
| Runtime state | `update()` (from `dev_notification` actions) | `status: "clean" \| "stale"`, `count`, `timestamp` |
| Working state | `onFrame()` (from `FeedId.GIT` frames) | `editedCount: number` |

**Table T02: Merged display logic** {#t02-merged-display}

| Runtime | Working | Display label | Dot color | Restart/Relaunch button |
|---------|---------|---------------|-----------|------------------------|
| Clean | Committed (0 files) | `cleanLabel(lastCleanTs)` e.g. "Clean -- 9:42 AM" | `var(--td-success)` (green) | Hidden |
| Clean | Edited (N > 0) | `editedLabel(editedCount, lastCleanTs)` e.g. "Edited (3 files) -- 9:42 AM" | `var(--td-info)` (blue) | Hidden |
| Stale | Committed (0 files) | `dirtyLabel(staleCount, firstDirtySinceTs)` e.g. "2 changes -- since 9:38 AM" | `var(--td-warning)` (amber) | Shown |
| Stale | Edited (N > 0) | `dirtyLabel(staleCount, firstDirtySinceTs)` e.g. "2 changes -- since 9:38 AM" | `var(--td-warning)` (amber) | Shown |

For the Styles row, there is no stale state (hot reload keeps it current). The row is either "Clean" or "Edited (N files)". The Styles row has no Restart/Relaunch button.

The `renderRow(row)` method applies this priority, reading from existing fields on the card instance:

```
if row is "styles" and stylesFlashing:
    return early (do not update -- flash is in progress, per [D08])

if row is "code" or "app" and isStale[row]:
    dot = var(--td-warning)
    label = dirtyLabel(staleCount[row], firstDirtySinceTs[row])
    actionButton = shown
else if editedCount[row] > 0:
    dot = var(--td-info)
    label = editedLabel(editedCount[row], lastCleanTs[row])
    actionButton = hidden
else:
    dot = var(--td-success)
    label = cleanLabel(lastCleanTs[row])
    actionButton = hidden
```

The stale branch uses the existing `staleCount` and `firstDirtySinceTs` fields that `update()` already captures from the `dev_notification` payload (count, timestamp). These fields must still be set by `update()` before calling `renderRow()`.

Both `onFrame()` and `update()` trigger a re-render of the affected row(s) via `renderRow()`. Since git status polls every ~2 seconds, the "Edited" state appears within 2 seconds of a file save.

#### File Path Categorization {#file-categorization}

**Table T03: File path categorization patterns** {#t03-categorization-patterns}

| Row | Pattern | Implementation |
|-----|---------|---------------|
| Styles | `tugdeck/**/*.css` | `path.startsWith("tugdeck/") && path.endsWith(".css")` |
| Styles | `tugdeck/**/*.html` | `path.startsWith("tugdeck/") && path.endsWith(".html")` |
| Code | `tugdeck/src/**/*.ts` | `path.startsWith("tugdeck/src/") && path.endsWith(".ts")` |
| Code | `tugdeck/src/**/*.tsx` | `path.startsWith("tugdeck/src/") && path.endsWith(".tsx")` |
| Code | `tugcode/**/*.rs` | `path.startsWith("tugcode/") && path.endsWith(".rs")` |
| Code | `tugcode/**/Cargo.toml` | `path.startsWith("tugcode/") && path.endsWith("Cargo.toml")` |
| App | `tugapp/Sources/**/*.swift` | `path.startsWith("tugapp/Sources/") && path.endsWith(".swift")` |

Files not matching any pattern are ignored -- the Git card already shows everything.

A file can match only one row. The patterns are evaluated in order; the first match wins. In practice there is no overlap between the patterns.

The categorization function is an **exported standalone function** (not a class method) so it can be directly imported and unit-tested without needing to instantiate `DeveloperCard`:

```typescript
export type RowCategory = "styles" | "code" | "app";
export function categorizeFile(path: string): RowCategory | null;
```

---

### Specification {#specification}

#### GitStatus Interface {#gitstatus-interface}

**Spec S01: GitStatus payload structure** {#s01-gitstatus-payload}

The `GitStatus` JSON payload received via `FeedId.GIT` frames has this structure (matching the existing definition in `git-card.ts`):

```typescript
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  head_sha: string;
  head_message: string;
}

interface FileStatus {
  path: string;
  status: string;
}
```

Per [D03], only `staged` and `unstaged` arrays are used. The `untracked` array is ignored.

#### Working State Per Row {#working-state-spec}

**Spec S02: Per-row working state** {#s02-working-state}

Each row maintains a `workingState` object:

```typescript
interface RowWorkingState {
  editedCount: number;  // count of tracked files matching this row's patterns
}
```

The `editedCount` is recomputed on every `onFrame()` call by iterating all `staged` and `unstaged` files and categorizing them. A file that appears in both `staged` and `unstaged` (e.g., partially staged) is counted once per appearance -- since both represent a diff from HEAD, both are meaningful. However, if the same path appears in both arrays, it should be deduplicated to avoid double-counting. The simplest approach: collect all paths into a `Set<string>` before categorizing.

#### Row Display Labels {#row-display-labels}

**Spec S03: Edited row label format** {#s03-edited-label}

| Row | Edited label | Example |
|-----|-------------|---------|
| Styles | `Edited (N files)` | `Edited (3 files)` |
| Code | `Edited (N files)` | `Edited (1 file)` |
| App | `Edited (N files)` | `Edited (2 files)` |

Rules:
- Use "file" (singular) when N = 1, "files" (plural) when N > 1.
- The edited label optionally includes a timestamp suffix showing when the row was last clean: "Edited (3 files) -- 9:42 AM". The timestamp comes from `lastCleanTs` (the same field used by `cleanLabel()`), representing when the row last transitioned to clean state (via restart/relaunch click or reloaded notification). If `lastCleanTs` is null (card just mounted, no clean transition has occurred yet), the label is plain "Edited (3 files)" with no timestamp.
- The `editedLabel(count, ts)` method signature: `count` is the edited file count from working state, `ts` is the `lastCleanTs` value for that row (nullable). This differs from `dirtyLabel(count, sinceTs)` which shows "since" time for stale state.
- When the row transitions from stale back to current (after restart/relaunch), if files are still edited, show the edited state immediately. The `lastCleanTs` is set by the restart/relaunch click, so the edited label will show the restart/relaunch time.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes modify existing files.

#### Symbols to add / modify {#symbols}

**Table T04: Symbol inventory** {#t04-symbol-inventory}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `GitStatus` | interface | `developer-card.ts` | Duplicated from git-card.ts per [D07] |
| `FileStatus` | interface | `developer-card.ts` | Duplicated from git-card.ts per [D07] |
| `RowCategory` | exported type alias | `developer-card.ts` | `"styles" \| "code" \| "app"` |
| `categorizeFile` | exported function | `developer-card.ts` | Maps file path to row category or null; standalone for testability |
| `stylesFlashing` | private field | `developer-card.ts` | `boolean`, true during the 2-second Reloaded flash per [D08] |
| `stylesEditedCount` | private field | `developer-card.ts` | `number`, current edited file count for Styles row |
| `codeEditedCount` | private field | `developer-card.ts` | `number`, current edited file count for Code row |
| `appEditedCount` | private field | `developer-card.ts` | `number`, current edited file count for App row |
| `codeIsStale` | private field | `developer-card.ts` | `boolean`, true when Code row is in stale state |
| `codeStaleCount` | private field | `developer-card.ts` | `number`, file change count from last `restart_available` notification |
| `appIsStale` | private field | `developer-card.ts` | `boolean`, true when App row is in stale state |
| `appStaleCount` | private field | `developer-card.ts` | `number`, file change count from last `relaunch_available` notification |
| `editedLabel` | private method | `developer-card.ts` | Formats "Edited (N files)" or "Edited (N file)" |
| `renderRow` | private method | `developer-card.ts` | Renders a single row based on merged state |
| `onFrame` | method (modified) | `developer-card.ts` | Changed from no-op to active git status handler |
| `feedIds` | field (modified) | `developer-card.ts` | Changed from `[]` to `[FeedId.GIT]` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test file categorization logic in isolation | Pattern matching, edge cases, unknown file types |
| **Unit** | Test state merging logic | Stale + edited combinations, clean transitions |
| **Integration** | Test onFrame handler end-to-end | Full GitStatus payload parsing, row rendering updates |
| **Drift Prevention** | Existing developer-card tests | Ensure no regressions in dev_notification handling |

---

### Execution Steps {#execution-steps}

#### Step 1: Add GitStatus types and file categorization logic {#step-1}

**Commit:** `feat(tugdeck): add GitStatus types and file categorization to developer-card`

**References:** [D02] Hardcoded file path patterns, [D03] Tracked files only, [D07] Duplicate GitStatus interface, Spec S01, Table T03, (#file-categorization, #gitstatus-interface)

**Artifacts:**
- Modified `tugdeck/src/cards/developer-card.ts` -- add `GitStatus`/`FileStatus` interfaces, `RowCategory` type, `categorizeFile()` method
- Modified `tugdeck/src/cards/developer-card.test.ts` -- add categorization unit tests

**Tasks:**
- [ ] Add `GitStatus` and `FileStatus` interfaces to `developer-card.ts` (duplicated from `git-card.ts` with cross-reference comment)
- [ ] Add `export type RowCategory = "styles" | "code" | "app"` type alias
- [ ] Add `export function categorizeFile(path: string): RowCategory | null` as a standalone exported function (not a class method) implementing Table T03 patterns. This allows tests to import and call it directly without instantiating `DeveloperCard`.
- [ ] Add unit tests that import `categorizeFile` directly and test: CSS file -> styles, HTML file -> styles, TS file -> code, TSX file -> code, RS file -> code, Cargo.toml -> code, Swift file -> app, unmatched file -> null
- [ ] Add edge case tests: file in `tugdeck/` root (not `tugdeck/src/`) with `.ts` extension -> null (not code), file in `tugapp/` but not `tugapp/Sources/` -> null

**Tests:**
- [ ] Categorization tests pass for all patterns in Table T03
- [ ] Edge case tests verify exclusions
- [ ] Existing developer-card tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/cards/developer-card.test.ts` passes

---

#### Step 2: Add working state tracking and onFrame handler {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add git status working state tracking to developer-card`

**References:** [D01] Subscribe to FeedId.GIT, [D03] Tracked files only, Spec S01, Spec S02, Table T01, (#state-merging, #gitstatus-interface, #working-state-spec)

**Artifacts:**
- Modified `tugdeck/src/cards/developer-card.ts` -- add `FeedId.GIT` to `feedIds`, add per-row edited counts, implement `onFrame()` handler
- Modified `tugdeck/src/cards/developer-card.test.ts` -- add onFrame tests, update feedIds assertion

**Tasks:**
- [ ] Add `import { FeedId } from "../protocol"` (or add `FeedId` to existing import)
- [ ] Change `feedIds` from `[]` to `[FeedId.GIT]`
- [ ] Add private fields: `stylesEditedCount = 0`, `codeEditedCount = 0`, `appEditedCount = 0`
- [ ] Implement `onFrame(feedId, payload)`: add guard clause to return early if `feedId !== FeedId.GIT` or if `payload.length === 0`; wrap `JSON.parse` in a try/catch that logs an error and returns on failure (matching the existing pattern in `git-card.ts`); parse `GitStatus` JSON from payload, collect paths from `staged` and `unstaged` into a `Set<string>` for deduplication, categorize each path via `categorizeFile()`, count per row, store in edited count fields
- [ ] After counting, trigger re-render of each row (call `renderRow()` or update inline)
- [ ] Null/reset edited counts in `destroy()`
- [ ] Update existing test that asserts `card.feedIds` is `[]` to assert `[FeedId.GIT]`
- [ ] Add test: onFrame with GitStatus containing CSS files updates Styles edited count and row display
- [ ] Add test: onFrame with GitStatus containing RS files updates Code edited count
- [ ] Add test: onFrame with empty staged/unstaged shows clean state
- [ ] Add test: onFrame deduplicates paths appearing in both staged and unstaged
- [ ] Add test: onFrame ignores untracked files

**Tests:**
- [ ] onFrame tests pass for various GitStatus payloads
- [ ] feedIds assertion updated
- [ ] Existing developer-card tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/cards/developer-card.test.ts` passes

---

#### Step 3: Implement state merging and row rendering {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): merge runtime and working state in developer-card row display`

**References:** [D04] Stale dominates edited, [D05] Blue dot uses var(--td-info), [D06] Reloaded flash returns to working state, [D08] Flash guard, Spec S03, Table T02, (#state-merging, #row-display-labels)

**Artifacts:**
- Modified `tugdeck/src/cards/developer-card.ts` -- add `codeIsStale`/`appIsStale` tracking, add `editedLabel()` helper, add `renderRow()` method, update `update()` and `onFrame()` to call unified render, update "Reloaded" timer to return to working state
- Modified `tugdeck/src/cards/developer-card.test.ts` -- add state merging tests

**Tasks:**
- [ ] Add private fields: `stylesFlashing = false`, `codeIsStale = false`, `codeStaleCount = 0`, `appIsStale = false`, `appStaleCount = 0`
- [ ] Add private method `editedLabel(count: number, ts: number | null): string` returning `Edited (N file[s])` with optional timestamp (see Spec S03 for format details)
- [ ] Add private method `renderRow(row: "styles" | "code" | "app")` that applies Table T02 merged display logic. First: if `row === "styles"` and `stylesFlashing` is true, return early without updating (per [D08] flash guard). Then: check stale first (for Code/App), then check editedCount, then show clean. In the stale branch, use `dirtyLabel(staleCount, firstDirtySinceTs)` for the label and show the Restart/Relaunch button. In the edited and clean branches, hide the button.
- [ ] Update `update()` for `restart_available`: capture `count`, `timestamp`, and `firstDirtySinceTs` from the payload (preserving existing timestamp logic), set `codeIsStale = true` and `codeStaleCount = count`, then call `renderRow("code")`
- [ ] Update `update()` for `relaunch_available`: capture `count`, `timestamp`, and `firstDirtySinceTs` from the payload (preserving existing timestamp logic), set `appIsStale = true` and `appStaleCount = count`, then call `renderRow("app")`
- [ ] Update `handleRestart()`: set `codeIsStale = false`, `codeStaleCount = 0`, set `codeLastCleanTs = Date.now()`, clear `codeFirstDirtySinceTs = null`, then call `renderRow("code")`
- [ ] Update `handleRelaunch()`: set `appIsStale = false`, `appStaleCount = 0`, set `appLastCleanTs = Date.now()`, clear `appFirstDirtySinceTs = null`, then call `renderRow("app")`
- [ ] Update `update()` for `reloaded`: set `this.stylesFlashing = true` and set `this.stylesLastCleanTs = timestamp` if timestamp is defined (capture before the timer fires). Set the status text to "Reloaded". In the 2-second flash timer callback, set `this.stylesFlashing = false` then call `renderRow("styles")`. This preserves the existing timestamp capture, protects the flash from onFrame overwrites per [D08], and switches the post-flash display to working state.
- [ ] Update `onFrame()` to call `renderRow()` for each row after updating edited counts
- [ ] In `renderRow()`: set dot color to `var(--td-info)` for edited state, `var(--td-warning)` for stale, `var(--td-success)` for clean
- [ ] Reset `stylesFlashing`, `codeIsStale`, `codeStaleCount`, `appIsStale`, and `appStaleCount` in `destroy()`
- [ ] Add test: Code row in stale state, then onFrame with edited Code files -- row still shows stale (amber dot)
- [ ] Add test: Code row in stale state, restart click, onFrame still shows edited files -- row shows edited (blue dot)
- [ ] Add test: Styles row during "Reloaded" flash, onFrame arrives with edited CSS files -- row still shows "Reloaded" (flash guard prevents overwrite per [D08])
- [ ] Add test: Styles row after "Reloaded" flash completes (2s timer fires) with edited style files -- returns to "Edited (N files)" not "Clean"
- [ ] Add test: Styles row after "Reloaded" flash completes with zero edited style files -- returns to "Clean"
- [ ] Add test: onFrame with zero files for a row that was previously edited returns to clean display
- [ ] Add test: edited label shows "Edited (1 file)" for singular, "Edited (3 files)" for plural

**Tests:**
- [ ] All state merging tests pass
- [ ] Reloaded flash behavior verified
- [ ] Existing tests updated and passing

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/cards/developer-card.test.ts` passes
- [ ] `cd tugdeck && bun test` passes (full TypeScript test suite)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A Developer card that shows per-row working state (Clean/Edited/Stale) by subscribing to the existing `FeedId.GIT` feed, categorizing file paths by pattern, and merging runtime and working state into a unified row display with color-coded dot indicators.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Developer card subscribes to `FeedId.GIT` (verified by `card.feedIds` including `0x20`)
- [ ] `onFrame()` parses `GitStatus` JSON and categorizes files into Styles/Code/App rows
- [ ] Only staged and unstaged (tracked) files are counted; untracked files are ignored
- [ ] Clean rows show green dot (`var(--td-success)`), edited rows show blue dot (`var(--td-info)`), stale rows show amber dot (`var(--td-warning)`)
- [ ] Stale state dominates edited state in merged display
- [ ] "Reloaded" flash returns to working state (edited or clean) not unconditionally clean
- [ ] `cd tugdeck && bun test` passes (all TypeScript tests)

**Acceptance tests:**
- [ ] Mount Developer card, send GitStatus frame with 3 CSS files in unstaged -- Styles row shows "Edited (3 files)" with blue dot
- [ ] Send GitStatus frame with 2 RS files and 1 TS file -- Code row shows "Edited (3 files)" with blue dot
- [ ] Trigger `restart_available` notification while Code row shows edited -- Code row switches to stale display (amber dot)
- [ ] Click Restart while files are still edited -- Code row returns to "Edited (N files)" with blue dot
- [ ] Trigger `reloaded` notification while Styles has edited files -- flash "Reloaded" then return to "Edited (N files)"
- [ ] Send GitStatus frame with zero matching files -- all rows show "Clean" with green dots

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Extract `GitStatus`/`FileStatus` interfaces to a shared types module used by both git-card and developer-card
- [ ] Add hover tooltip showing the list of edited files per row
- [ ] Make file categorization patterns configurable rather than hardcoded
- [ ] Consider showing "Edited" count in the dock badge when the Developer card is closed
- [ ] Refactor per-row state fields into a `RowState` interface/object (e.g., `{ editedCount, isStale, staleCount, lastCleanTs, firstDirtySinceTs }`) to reduce the growing number of flat fields on the card class

| Checkpoint | Verification |
|------------|--------------|
| FeedId subscription | `card.feedIds` includes `FeedId.GIT` |
| File categorization | Unit tests for all Table T03 patterns pass |
| Working state tracking | onFrame updates per-row edited counts correctly |
| State merging | Stale dominates edited in all test scenarios |
| Reloaded flash behavior | Returns to working state after flash |
| Full test suite | `cd tugdeck && bun test` passes |
