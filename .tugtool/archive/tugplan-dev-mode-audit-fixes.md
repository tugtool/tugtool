<!-- tugplan-skeleton v2 -->

## Dev Mode Audit Fixes {#dev-mode-audit-fixes}

**Purpose:** Address the three issues identified in the dev mode strategy audit: rename Styles/Code to Frontend/Backend with correct file categorization, investigate and fix FOUC/HMR flash in WKWebView, and add a Rust source watcher so the Restart button appears immediately when `.rs` files change.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-mode-audit-fixes |
| Last updated | 2026-02-27 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev mode strategy audit (`roadmap/dev-mode-strategy-audit.md`) evaluated the developer mode system after the React + Vite migration (PRs #60-#62) and found three issues. First, the "Styles" row label and `categorizeFile()` function are outdated -- Vite HMR now hot-reloads JS/TS too, not just CSS, so tugdeck TS/TSX files should map to "frontend" instead of "code". Second, the app flashes terribly during HMR updates and on initial startup due to FOUC in WKWebView. Third, the Restart button never appears for Rust source changes because the compiled watcher polls the binary (not source files) -- a Rust source watcher analogous to the Swift app watcher is needed.

Additionally, the audit identified 7 completed or superseded roadmap documents that should be archived, and the main architecture document (`roadmap/dev-mode-notifications.md`) needs updating to reflect the post-React reality.

#### Strategy {#strategy}

- Start with the rename (Styles->Frontend, Code->Backend) since it is the simplest, most self-contained change and establishes the correct terminology for subsequent steps.
- Add the Rust source watcher next, since it is a clear design (analogous to the existing Swift app watcher) and fixes a broken user flow.
- Investigate the HMR/startup flash problem third, adding diagnostic logging before implementing a fix, since the root cause needs confirmation in WKWebView.
- Add logging/verification to the existing binary watcher notification chain to confirm end-to-end delivery works.
- Archive obsolete roadmap documents and update the architecture doc last, as documentation does not block code changes.
- Each step produces a single commit with clear checkpoint criteria.

#### Success Criteria (Measurable) {#success-criteria}

- `categorizeFile("tugdeck/src/main.ts")` returns `"frontend"` and `categorizeFile("tugcode/src/main.rs")` returns `"backend"` (verified by updated tests)
- Developer card displays "Frontend" and "Backend" row labels (verified by test assertions on rendered text)
- Editing a `.rs` file under `tugcode/crates/` causes a `restart_available` notification within 200ms (100ms debounce + buffer), verified by Rust integration test
- HMR flash is either eliminated or reduced to imperceptible levels (verified by manual testing in WKWebView with before/after observation)
- All 7 archived roadmap files are moved to `roadmap/archive/` (verified by `ls roadmap/archive/ | wc -l` returning 7)
- All existing tests pass after each step (`cargo nextest run` and `bun test`)

#### Scope {#scope}

1. Rename "Styles" to "Frontend" and "Code" to "Backend" in developer-card.tsx, including `categorizeFile()` return types, all internal state variable names, and test expectations
2. Add a Rust source watcher (`dev_rust_source_watcher`) in `dev.rs` using notify-event pattern with 100ms quiet-period debounce, watching `tugcode/crates/**/*.rs` and `Cargo.toml` files
3. Investigate and fix FOUC/HMR flash in WKWebView (startup flash and CSS HMR flash)
4. Add logging and verification to the existing binary watcher notification chain
5. Archive 7 completed/superseded roadmap documents to `roadmap/archive/`
6. Update `roadmap/dev-mode-notifications.md` to reflect Frontend/Backend naming and Rust source watcher

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changes to the Vite HMR bridge itself (the `vite:afterUpdate` listener and `td-hmr-update` event indirection stay as-is)
- Adding a `tugrelaunch` helper binary (that is a separate future effort)
- Changing the compiled binary watcher polling mechanism (it stays as a secondary trigger)
- Full HMR state preservation (all reloads remain full page reloads for compiled code)
- Cross-platform considerations (Mac-only for WKWebView flash fix)

#### Dependencies / Prerequisites {#dependencies}

- The React + Vite migration (PRs #60-#62) must be complete (it is)
- The dev-mode-notifications system must be operational (it is, per the audit)
- The `notify` crate is already a dependency of tugcast (used by `dev_app_watcher`)

#### Constraints {#constraints}

- Warnings are errors in the Rust build (`-D warnings` via `.cargo/config.toml`)
- The WKWebView flash fix must work on macOS 13.3+ (minimum supported version for `isInspectable`)
- The Rust source watcher must use `resolve_symlinks()` for path normalization (same as app watcher), not `canonicalize()`, to avoid macOS firmlink issues with FSEvents

#### Assumptions {#assumptions}

- The internal state variable names in `developer-card.tsx` (`stylesRow`, `stylesFlashing`, `stylesFlashText`) and the `categorizeFile()` return type will change from `"styles"`/`"code"` to `"frontend"`/`"backend"` -- test files will need corresponding updates
- The new Rust source watcher will watch `tugcode/crates/**/*.rs` (and Cargo.toml files) using the same `resolve_symlinks()` path normalization already used by the app watcher
- The `roadmap/archive/` directory does not yet exist and will need to be created
- The `dev-mode-notifications.md` architecture doc update is in scope as a documentation step but does not block the code changes
- No changes are needed to the Vite HMR bridge in `developer-card.tsx`
- The "Reloaded" flash behavior already covers TS/TSX HMR updates because `vite:afterUpdate` fires for all HMR-handled file types (CSS, JS, TS, TSX), not just CSS -- no additional work needed to extend the flash to frontend TS/TSX changes

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Optimal flash fix strategy for WKWebView (OPEN) {#q01-flash-fix-strategy}

**Question:** Which combination of techniques best eliminates the flash/flicker in WKWebView -- overlay div, opacity transition, opaque background, inlined critical CSS, or hiding the web view until first paint?

**Why it matters:** The wrong approach could introduce new visual artifacts (e.g., a visible overlay transition) or performance regressions. WKWebView's rendering pipeline differs from Chrome DevTools, so fixes that work in the browser may not work in the app.

**Options (if known):**
- Add a transition-suppressing overlay div during HMR updates
- Set `WKWebView.isOpaque = false` with matching `window.backgroundColor` to eliminate white flash
- Inline critical CSS in `index.html` `<style>` block so styles are available before React mounts
- Hide WKWebView until `didFinishNavigation` fires, then reveal with animation
- Combination of the above

**Plan to resolve:** Step 3 will add diagnostic logging to confirm the root cause, then implement the best fix based on observed behavior.

**Resolution:** OPEN -- will be resolved during Step 3 investigation

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Flash fix does not fully eliminate flicker | med | med | Investigate-first approach with logging; multiple fix strategies available | If first fix attempt leaves visible flash |
| Rust source watcher generates excessive events during large refactors | low | low | 100ms quiet-period debounce (same pattern as app watcher) | If users report notification spam |
| Rename breaks untested code paths | low | low | Comprehensive test updates in same commit; `bun test` and `cargo nextest run` at each checkpoint | If CI fails |

**Risk R01: WKWebView flash fix may require multiple iterations** {#r01-flash-fix-iterations}

- **Risk:** The flash/flicker in WKWebView may have multiple root causes (startup FOUC + HMR CSS removal + full-module reload), and a single fix may not address all of them.
- **Mitigation:** Step 3 uses an investigate-first approach with diagnostic logging. Multiple fix strategies are documented in the audit. The step is structured as substeps (investigate, then fix) so progress is incremental.
- **Residual risk:** Some flash may be inherent to WKWebView's rendering pipeline and not fully eliminable.

**Risk R02: Rust source watcher path resolution on macOS** {#r02-rust-watcher-path}

- **Risk:** FSEvents on macOS requires specific path formats. If `resolve_symlinks()` does not produce the right path for the `tugcode/crates/` directory (e.g., through symlinks or firmlinks), the watcher may silently fail to deliver events.
- **Mitigation:** Use the exact same `resolve_symlinks()` function that already works for the app watcher. Add an integration test that creates a temp directory, writes a `.rs` file, and verifies the notification arrives.
- **Residual risk:** Edge cases with unusual symlink configurations remain possible but are unlikely in practice.

---

### Design Decisions {#design-decisions}

#### [D01] Rename categories to Frontend/Backend (DECIDED) {#d01-rename-frontend-backend}

**Decision:** Rename the "Styles" category to "Frontend" and the "Code" category to "Backend" throughout the developer card and its tests.

**Rationale:**
- Vite HMR now hot-reloads JS/TS files too, not just CSS -- the "Styles" label is misleading
- TS/TSX files from tugdeck should be categorized as "frontend" (hot-reloadable) rather than "code" (requires restart)
- "Backend" clearly conveys that this row covers Rust changes that require a restart

**Implications:**
- `categorizeFile()` return type changes from `"styles" | "code" | "app" | null` to `"frontend" | "backend" | "app" | null`
- All state variables (`stylesRow` -> `frontendRow`, `codeRow` -> `backendRow`, etc.) must be renamed
- The `stylesFlashing`/`stylesFlashText` state becomes `frontendFlashing`/`frontendFlashText`
- Test expectations must be updated to match new labels and return values
- The UI label strings change from "Styles"/"Code" to "Frontend"/"Backend"

#### [D02] Notify-event Rust source watcher with 100ms debounce (DECIDED) {#d02-rust-source-watcher}

**Decision:** Add a Rust source watcher using the `notify` crate's event-driven pattern (same as the existing Swift app watcher), with a 100ms quiet-period debounce, watching `tugcode/crates/**/*.rs` and `**/Cargo.toml`.

**Rationale:**
- The existing binary mtime poller only detects changes after `cargo build` completes -- the user gets no UI feedback when they edit a `.rs` file
- The Swift app watcher already demonstrates the correct pattern: notify events with quiet-period debounce
- 100ms debounce matches the app watcher and is fast enough to feel instant while coalescing rapid saves

**Implications:**
- A new `dev_rust_source_watcher()` function in `dev.rs` follows the same structure as `dev_app_watcher()`
- The `DevRuntime` struct gains a `_rust_source_watcher: RecommendedWatcher` field
- The watcher sends `restart_available` notifications (same type as the binary watcher), so the Backend row shows the Restart button
- The `DevChangeTracker` needs no changes -- `mark_backend()` is already the correct method for this
- A `has_rust_extension()` helper function (analogous to `has_swift_extension()`) filters notify events

#### [D03] Investigate-first approach for flash fix (DECIDED) {#d03-investigate-first-flash}

**Decision:** Add diagnostic logging to confirm the flash root cause before implementing a fix. Do not commit to a specific fix strategy until the investigation substep is complete.

**Rationale:**
- The audit identifies three possible root causes (startup FOUC, CSS HMR removal, full-module reload) but the relative contribution of each is unknown
- WKWebView's rendering pipeline differs from Chrome -- assumptions about the cause may be wrong
- An investigation step is cheap and prevents wasted effort on the wrong fix

**Implications:**
- Step 3 is split into substeps: 3.1 (investigate with logging) and 3.2 (implement fix)
- The fix strategy chosen in 3.2 depends on findings from 3.1
- [Q01] will be resolved based on investigation results

#### [D04] Binary watcher chain logging (DECIDED) {#d04-binary-watcher-logging}

**Decision:** Add tracing-level logging to the existing binary watcher notification chain (binary mtime change -> `DevChangeTracker` -> `send_dev_notification` -> Control frame -> WebSocket -> `td-dev-notification` CustomEvent -> DeveloperCard) to verify end-to-end delivery.

**Rationale:**
- The audit notes the binary watcher fires but the Restart button never appears -- the chain may have a delivery bug
- Adding logging to each link confirms whether the notification is lost, delayed, or malformed
- This logging also benefits the new Rust source watcher since it shares the same notification path

**Implications:**
- Add `tracing::debug!` calls at each stage of the notification pipeline in `dev.rs`
- Add `console.log` calls in the developer card's `td-dev-notification` handler (guarded by dev mode check)
- Logging can be left in place at `debug`/`trace` level for future diagnostics

#### [D05] Archive to roadmap/archive/ subdirectory (DECIDED) {#d05-archive-method}

**Decision:** Move the 7 completed/superseded roadmap documents to a new `roadmap/archive/` subdirectory.

**Rationale:**
- Keeps the main `roadmap/` directory focused on active documents
- Preserves git history (move, not delete)
- Clear organizational signal about document status

**Implications:**
- Create `roadmap/archive/` directory
- Move 7 files: `full-hot-reload.md`, `dev-mode-source-direct-serving.md`, `dev-app-mode-roadmap.md`, `runtime-dev-mode.md`, `dev-mode-port-hardening.md`, `dev-notification-improvements.md`, `external-commands-and-dev-mode-redesign.md`

---

### Specification {#specification}

#### categorizeFile() Updated Mapping {#categorize-file-mapping}

**Spec S01: categorizeFile() return values** {#s01-categorize-file}

| File path pattern | Current return | New return |
|---|---|---|
| `tugdeck/**/*.css` | `"styles"` | `"frontend"` |
| `tugdeck/**/*.html` | `"styles"` | `"frontend"` |
| `tugdeck/**/*.ts` | `"code"` | `"frontend"` |
| `tugdeck/**/*.tsx` | `"code"` | `"frontend"` |
| `tugcode/**/*.rs` | `"code"` | `"backend"` |
| `tugcode/**/Cargo.toml` | `"code"` | `"backend"` |
| `tugapp/**/*.swift` | `"app"` | `"app"` (unchanged) |
| Everything else | `null` | `null` (unchanged) |

The function signature changes from:
```typescript
export function categorizeFile(path: string): "styles" | "code" | "app" | null
```
to:
```typescript
export function categorizeFile(path: string): "frontend" | "backend" | "app" | null
```

#### Developer Card State Variable Rename {#state-variable-rename}

**Spec S02: State variable mapping** {#s02-state-variables}

| Current name | New name |
|---|---|
| `stylesRow` / `setStylesRow` | `frontendRow` / `setFrontendRow` |
| `codeRow` / `setCodeRow` | `backendRow` / `setBackendRow` |
| `stylesFlashing` / `setStylesFlashing` | `frontendFlashing` / `setFrontendFlashing` |
| `stylesFlashText` / `setStylesFlashText` | `frontendFlashText` / `setFrontendFlashText` |
| `stylesDisplay` | `frontendDisplay` |
| `codeDisplay` | `backendDisplay` |
| `stylesCount` | `frontendCount` |
| `codeCount` | `backendCount` |

UI labels:
| Current label | New label |
|---|---|
| "Styles" | "Frontend" |
| "Code" | "Backend" |

#### Rust Source Watcher Specification {#rust-source-watcher-spec}

**Spec S03: dev_rust_source_watcher() function** {#s03-rust-source-watcher}

```rust
pub(crate) fn dev_rust_source_watcher(
    rust_sources_dir: PathBuf,
    tracker: SharedChangeTracker,
    client_action_tx: broadcast::Sender<Frame>,
) -> Result<RecommendedWatcher, String>
```

- **Watch directory:** `{source_tree}/tugcode/crates/` (resolved via `resolve_symlinks()`)
- **Recursive mode:** `RecursiveMode::Recursive`
- **File filter:** Events containing paths with `.rs` extension or paths ending in `Cargo.toml`
- **Debounce:** 100ms quiet-period (same pattern as `dev_app_watcher`)
- **On change:** calls `tracker.lock().unwrap().mark_backend()` then `send_dev_notification("restart_available", ...)`
- **Logging:** `info!("dev: watching rust sources {}", rust_sources_dir.display())` on start; `info!("dev: sent dev_notification type=restart_available (rust source)")` on notification

**Spec S04: has_rust_extension() helper** {#s04-has-rust-extension}

```rust
fn has_rust_extension(event: &notify::Event) -> bool
```

Returns `true` if any path in the event has a `.rs` extension or the filename is `Cargo.toml`.

#### Roadmap Files to Archive {#archive-file-list}

**List L01: Files to move to roadmap/archive/** {#l01-archive-files}

1. `roadmap/full-hot-reload.md` -- superseded by `dev-mode-notifications.md`
2. `roadmap/dev-mode-source-direct-serving.md` -- superseded by React/Vite migration
3. `roadmap/dev-app-mode-roadmap.md` -- superseded (distribution plan can be extracted later)
4. `roadmap/runtime-dev-mode.md` -- fully implemented
5. `roadmap/dev-mode-port-hardening.md` -- fully implemented (PR #63)
6. `roadmap/dev-notification-improvements.md` -- fully implemented
7. `roadmap/external-commands-and-dev-mode-redesign.md` -- fully implemented

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `roadmap/archive/` (directory) | Archive for completed/superseded roadmap documents |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `categorizeFile()` | fn (modify) | `tugdeck/src/components/cards/developer-card.tsx` | Return type changes to `"frontend" \| "backend" \| "app" \| null`; tugdeck TS/TSX maps to `"frontend"` |
| `has_rust_extension()` | fn (add) | `tugcode/crates/tugcast/src/dev.rs` | Analogous to `has_swift_extension()` |
| `dev_rust_source_watcher()` | fn (add) | `tugcode/crates/tugcast/src/dev.rs` | Notify-event watcher for `tugcode/crates/**/*.rs` |
| `DevRuntime._rust_source_watcher` | field (add) | `tugcode/crates/tugcast/src/dev.rs` | Holds the `RecommendedWatcher` for Rust sources |
| `frontendRow` / `backendRow` | state (modify) | `tugdeck/src/components/cards/developer-card.tsx` | Renamed from `stylesRow` / `codeRow` |
| `frontendFlashing` / `frontendFlashText` | state (modify) | `tugdeck/src/components/cards/developer-card.tsx` | Renamed from `stylesFlashing` / `stylesFlashText` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `categorizeFile()` mapping, `has_rust_extension()` filtering, `DevChangeTracker` methods | Core logic, edge cases |
| **Integration** | Test Rust source watcher end-to-end (write file -> receive notification), developer card rendering with new labels | Component interactions |
| **Manual** | Verify WKWebView flash fix by visual observation in the Mac app | Flash/flicker is a visual phenomenon not capturable in automated tests |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename Styles to Frontend and Code to Backend {#step-1}

**Commit:** `refactor: rename Styles/Code to Frontend/Backend in developer card`

**References:** [D01] Rename categories to Frontend/Backend, Spec S01, Spec S02, (#categorize-file-mapping, #state-variable-rename)

**Artifacts:**
- Modified `tugdeck/src/components/cards/developer-card.tsx` -- updated `categorizeFile()`, state variables, UI labels
- Modified `tugdeck/src/components/cards/developer-card.test.tsx` -- updated expectations

**Tasks:**
- [ ] In `developer-card.tsx`, change `categorizeFile()` return type from `"styles" | "code" | "app" | null` to `"frontend" | "backend" | "app" | null`
- [ ] In `categorizeFile()`, change the tugdeck CSS/HTML return from `"styles"` to `"frontend"`
- [ ] In `categorizeFile()`, change the tugdeck TS/TSX return from `"code"` to `"frontend"` (these are now hot-reloadable via Vite HMR)
- [ ] In `categorizeFile()`, change the tugcode RS/Cargo.toml return from `"code"` to `"backend"`
- [ ] Rename state: `stylesRow`->`frontendRow`, `codeRow`->`backendRow`, `stylesFlashing`->`frontendFlashing`, `stylesFlashText`->`frontendFlashText`
- [ ] Rename computed: `stylesDisplay`->`frontendDisplay`, `codeDisplay`->`backendDisplay`, `stylesCount`->`frontendCount`, `codeCount`->`backendCount`
- [ ] In the git feed parsing `useEffect`, update the string literal comparisons: `cat === "styles"` to `cat === "frontend"` and `cat === "code"` to `cat === "backend"` (lines where `stylesCount`/`codeCount` are incremented)
- [ ] Change UI label strings: "Styles" -> "Frontend", "Code" -> "Backend"
- [ ] Update the `getRowDisplay()` function's `isStyles` parameter to `isFrontend`
- [ ] Update the file header comment to reflect "Frontend (CSS/HTML/JS/TS/TSX in tugdeck/)" and "Backend (RS/Cargo.toml in tugcode/)"
- [ ] In `developer-card.test.tsx`, update `categorizeFile` test expectations: `"styles"` -> `"frontend"`, `"code"` -> `"backend"`
- [ ] In test descriptions, update "classifies tugdeck CSS as styles" -> "classifies tugdeck CSS as frontend", etc.
- [ ] Update rendering tests: `expect(text).toContain("Styles")` -> `expect(text).toContain("Frontend")`, `expect(text).toContain("Code")` -> `expect(text).toContain("Backend")`
- [ ] Restructure the "shows Edited status for Code row with correct count" test for the Backend row: change test data from `tugdeck/src/main.ts` + `tugdeck/src/app.tsx` (which now categorize as `"frontend"`) to `tugcode/crates/tugcast/src/main.rs` + `tugcode/crates/tugcast/src/lib.rs`, and assert against `.dev-status` index `[1]` (Backend row). Add a separate test for the Frontend row that uses tugdeck TS/TSX paths and asserts against `.dev-status` index `[0]`
- [ ] Update remaining git feed parsing test descriptions and assertions referencing "styles" or "Code"
- [ ] Verify the `td-dev-notification` handler still correctly handles `restart_available` mapping to `backendRow` (was `codeRow`)

**Tests:**
- [ ] `categorizeFile("tugdeck/styles/main.css")` returns `"frontend"`
- [ ] `categorizeFile("tugdeck/src/main.ts")` returns `"frontend"` (was `"code"`)
- [ ] `categorizeFile("tugdeck/src/app.tsx")` returns `"frontend"` (was `"code"`)
- [ ] `categorizeFile("tugcode/src/main.rs")` returns `"backend"`
- [ ] `categorizeFile("tugcode/Cargo.toml")` returns `"backend"`
- [ ] Git feed test: tugdeck TS/TSX files show as Edited on the Frontend row (index `[0]`)
- [ ] Git feed test: tugcode `.rs` files show as Edited on the Backend row (index `[1]`)
- [ ] Developer card renders "Frontend" and "Backend" labels
- [ ] Restart button still appears when `restart_available` notification fires
- [ ] Reloaded flash still works on the Frontend row after `td-hmr-update`

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all developer card tests pass with updated expectations
- [ ] Manual verification: dev mode shows "Frontend" and "Backend" labels in the developer card

---

#### Step 2: Add Rust source watcher {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add Rust source watcher for immediate restart notification on .rs changes`

**References:** [D02] Notify-event Rust source watcher, Spec S03, Spec S04, (#rust-source-watcher-spec, #d02-rust-source-watcher)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- new `has_rust_extension()`, `dev_rust_source_watcher()`, updated `DevRuntime`, updated `enable_dev_mode()` and `disable_dev_mode()`

**Tasks:**
- [ ] Add `has_rust_extension(event: &notify::Event) -> bool` function that returns true if any path has `.rs` extension or filename `Cargo.toml`
- [ ] Add `dev_rust_source_watcher()` function following the same structure as `dev_app_watcher()`: create `notify::recommended_watcher`, watch `rust_sources_dir` recursively, spawn quiet-period debounce task with 100ms timeout
- [ ] In the debounce task: Phase 1 waits for a Rust file event (via `has_rust_extension`), Phase 2 consumes events until quiet, Phase 3 calls `tracker.lock().unwrap().mark_backend()` and `send_dev_notification("restart_available", ...)`
- [ ] Add `_rust_source_watcher: RecommendedWatcher` field to `DevRuntime` struct
- [ ] In `enable_dev_mode()`, clone `client_action_tx` before passing to `dev_app_watcher()` so it can also be passed to `dev_rust_source_watcher()` (currently `client_action_tx` is moved into `dev_app_watcher` as the last usage)
- [ ] In `enable_dev_mode()`, compute `rust_sources_dir = source_tree.join("tugcode/crates")`, call `dev_rust_source_watcher()` with the cloned sender, store result in `DevRuntime`
- [ ] Verify `disable_dev_mode()` drops the `DevRuntime` which drops the `RecommendedWatcher` (RAII cleanup, same as app watcher)
- [ ] Add unit test for `has_rust_extension()` with `.rs`, `Cargo.toml`, and non-matching paths
- [ ] Add integration test: create temp dir with `crates/` subdirectory, start watcher, write a `.rs` file, verify `restart_available` notification arrives within timeout

**Tests:**
- [ ] `has_rust_extension()` returns true for `test.rs` path
- [ ] `has_rust_extension()` returns true for `Cargo.toml` path
- [ ] `has_rust_extension()` returns false for `test.swift` path
- [ ] `has_rust_extension()` returns false for `test.ts` path
- [ ] Integration test: writing a `.rs` file produces a `restart_available` notification via broadcast channel

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass including new watcher tests
- [ ] `cd tugcode && cargo fmt --all` -- formatting is clean
- [ ] Manual verification: edit a `.rs` file under `tugcode/crates/`, see Restart button appear in developer card

---

#### Step 3: Investigate and fix WKWebView flash {#step-3}

**Depends on:** #step-1

**Commit:** `fix: investigate and fix WKWebView flash during HMR and startup`

> This is an organizational wrapper. The actual commits are produced by substeps 3.1 and 3.2.

**References:** [D03] Investigate-first flash fix, [Q01] Flash fix strategy, Risk R01, (#q01-flash-fix-strategy, #r01-flash-fix-iterations)

**Tasks:**
- [ ] Investigate the root cause of WKWebView flash (see substeps 3.1-3.2 for detailed tasks)

**Tests:**
- [ ] All developer card tests pass after flash fix

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] Manual verification: flash is eliminated or barely perceptible in WKWebView

> This step is split into substeps because the fix depends on investigation findings.

##### Step 3.1: Add diagnostic logging for flash investigation {#step-3-1}

**Commit:** `chore: add diagnostic logging for WKWebView flash investigation`

**References:** [D03] Investigate-first flash fix, [Q01] Flash fix strategy, Risk R01, (#q01-flash-fix-strategy, #r01-flash-fix-iterations)

**Artifacts:**
- Modified `tugdeck/src/components/cards/developer-card.tsx` -- console.log in HMR handler
- Modified `tugdeck/src/main.tsx` -- early timing log
- Modified `tugapp/Sources/MainWindow.swift` -- navigation timing logs

**Tasks:**
- [ ] In `developer-card.tsx`, add `console.log("[dev-flash] td-hmr-update received", Date.now())` in the `onHmrUpdate` handler
- [ ] In `developer-card.tsx`, add `console.log("[dev-flash] vite:afterUpdate received", Date.now())` in the `onViteAfterUpdate` handler
- [ ] At the top of `main.tsx` (before any imports or after the CSS imports), add `console.log("[dev-flash] main.tsx module executed", Date.now())` -- note: an inline `<script>` in `index.html` would be blocked by the CSP (`script-src 'self' 'wasm-unsafe-eval'` does not include `'unsafe-inline'`)
- [ ] In `MainWindow.swift`, add `NSLog("MainWindow: didFinish navigation at %@", Date())` in the `didFinish` delegate method
- [ ] In `MainWindow.swift`, add `NSLog("MainWindow: loadURL called with %@", urlString)` at the start of `loadURL()`
- [ ] Run the app in dev mode, trigger an HMR update (edit a CSS file), and observe console output to confirm timing of flash relative to events

**Checkpoint:**
- [ ] Console logs appear in expected order when triggering HMR
- [ ] Root cause of flash is identified (startup FOUC vs. HMR CSS removal vs. full-module reload)

---

##### Step 3.2: Implement flash fix {#step-3-2}

**Depends on:** #step-3-1

**Commit:** `fix: reduce WKWebView flash during HMR and startup`

**References:** [D03] Investigate-first flash fix, [Q01] Flash fix strategy, Risk R01, (#q01-flash-fix-strategy, #r01-flash-fix-iterations)

**Artifacts:**
- Modified files depend on investigation findings; likely candidates:
  - `tugapp/Sources/MainWindow.swift` -- WKWebView configuration changes (background color, opacity, hide-until-ready)
  - `tugdeck/index.html` -- inlined critical CSS or background color on body
  - `tugdeck/src/components/cards/developer-card.tsx` -- HMR overlay or debounce

**Tasks:**
- [ ] Based on Step 3.1 findings, implement the flash fix (strategy to be determined by investigation)
- [ ] For startup flash: set `window.backgroundColor` on the WKWebView's enclosing NSWindow to match the app's dark background color, and/or set `WKWebView.isOpaque = false`
- [ ] For startup flash: consider hiding WKWebView until `didFinishNavigation` fires, then revealing it
- [ ] For HMR flash: if caused by CSS removal during HMR update, consider adding a dark background color directly in `index.html` `<body>` style attribute so the page never shows white
- [ ] For HMR flash: if caused by full-module reload, consider adding a brief opacity transition overlay
- [ ] Remove or reduce diagnostic logging from Step 3.1 to `debug` level
- [ ] Test in WKWebView (Mac app) to verify flash is eliminated or reduced to imperceptible

**Tests:**
- [ ] Manual test: launch app in dev mode, verify no white flash on startup
- [ ] Manual test: edit a CSS file, verify no visible flash during HMR update
- [ ] Manual test: edit a TS file, verify no visible flash during HMR update
- [ ] Existing automated tests still pass (no regressions from CSS/style changes)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] Manual verification: flash is eliminated or barely perceptible in WKWebView

---

#### Step 3 Summary {#step-3-summary}

**Depends on:** #step-3-1

**Commit:** `fix: investigate and fix WKWebView flash during HMR and startup`

> This is an organizational summary. The actual commits are produced by substeps 3.1 and 3.2.

**References:** [D03] Investigate-first flash fix, [Q01] Flash fix strategy, Risk R01, (#q01-flash-fix-strategy, #r01-flash-fix-iterations)

**Tasks:**
- [ ] Verify all Step 3 substep checkpoints have been met

After completing Steps 3.1-3.2, you will have:
- Diagnostic logging confirming the flash root cause
- A fix implemented for startup FOUC and HMR flash in WKWebView
- [Q01] resolved with the chosen fix strategy

**Tests:**
- [ ] `cd tugdeck && bun test` -- all developer card tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] Manual before/after comparison confirms flash reduction

---

#### Step 4: Add binary watcher chain logging and verification {#step-4}

**Depends on:** #step-2

**Commit:** `chore: add logging to binary watcher notification chain for end-to-end verification`

**References:** [D04] Binary watcher chain logging, (#d04-binary-watcher-logging)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs` -- debug-level tracing in notification pipeline

**Tasks:**
- [ ] In `dev_compiled_watcher()`, add `tracing::debug!` after mtime change detection: `"dev: compiled watcher mtime changed for {}"` with path
- [ ] In `send_dev_notification()`, add `tracing::debug!` logging the notification type, count, and timestamp before sending
- [ ] In `send_dev_notification()`, add `tracing::debug!` logging whether the broadcast send succeeded or had no receivers
- [ ] Verify the binary watcher -> notification -> WebSocket -> frontend chain works end-to-end by running `cargo build` while dev mode is active and checking that the Backend row shows the Restart button
- [ ] If the chain is broken, diagnose and fix the specific link (this is a secondary benefit of Step 2's Rust source watcher -- it provides an alternative trigger)

**Tests:**
- [ ] Existing `test_compiled_watcher_detects_mtime_change` still passes
- [ ] Existing `test_send_dev_notification_restart_available` still passes

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass
- [ ] `cd tugcode && cargo fmt --all` -- formatting is clean
- [ ] Manual verification: run `cargo build` in dev mode, see debug logs in tugcast output, see Restart button appear

---

#### Step 5: Archive roadmap documents and update architecture doc {#step-5}

**Depends on:** #step-1, #step-2

**Commit:** `docs: archive 7 completed roadmap docs, update dev-mode-notifications.md`

**References:** [D05] Archive to roadmap/archive/, List L01, (#archive-file-list, #d05-archive-method)

**Artifacts:**
- New directory `roadmap/archive/`
- 7 files moved from `roadmap/` to `roadmap/archive/`
- Modified `roadmap/dev-mode-notifications.md` -- updated naming and watcher references

**Tasks:**
- [ ] Create `roadmap/archive/` directory
- [ ] Move the 7 files listed in List L01 to `roadmap/archive/`
- [ ] In `roadmap/dev-mode-notifications.md`, update the Category 1/2/3 diagram: rename "Style Resources" to "Frontend Resources", rename "Compiled Frontend + Backend" to "Backend (Compiled + Source)"
- [ ] In `roadmap/dev-mode-notifications.md`, update the card design mockup: "Styles" -> "Frontend", "Code" -> "Backend"
- [ ] In `roadmap/dev-mode-notifications.md`, add a note in the Category 2 section about the Rust source watcher (analogous to the app watcher, watches `tugcode/crates/**/*.rs`)
- [ ] In `roadmap/dev-mode-notifications.md`, replace references to `bun build --watch` with Vite dev server where appropriate
- [ ] In `roadmap/dev-mode-notifications.md`, mark the "What to Remove" section items that are already removed (e.g., `spawn_binary_watcher`, exit code 44) as "DONE"

**Tests:**
- [ ] `ls roadmap/archive/ | wc -l` returns 7
- [ ] The 7 archived files no longer exist in `roadmap/` (only in `roadmap/archive/`)
- [ ] `roadmap/dev-mode-notifications.md` contains "Frontend" where it previously said "Styles" in the card mockup

**Checkpoint:**
- [ ] `ls roadmap/archive/` shows all 7 expected files
- [ ] `roadmap/dev-mode-notifications.md` uses updated terminology

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully updated dev mode system with correct Frontend/Backend naming, a Rust source watcher for immediate restart notifications, reduced WKWebView flash, verified binary watcher chain, and archived obsolete roadmap documents.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Developer card displays "Frontend" and "Backend" labels (manual inspection)
- [ ] `categorizeFile()` correctly maps tugdeck TS/TSX to `"frontend"` (automated test)
- [ ] Editing a `.rs` file causes the Restart button to appear (manual test)
- [ ] WKWebView flash is eliminated or barely perceptible (manual test)
- [ ] Binary watcher notification chain has debug logging (code inspection)
- [ ] 7 roadmap files archived to `roadmap/archive/` (ls verification)
- [ ] `roadmap/dev-mode-notifications.md` uses updated terminology (grep verification)
- [ ] `cd tugcode && cargo nextest run` passes with zero failures
- [ ] `cd tugdeck && bun test` passes with zero failures

**Acceptance tests:**
- [ ] `bun test` in tugdeck passes -- all developer card tests use "frontend"/"backend" terminology
- [ ] `cargo nextest run` in tugcode passes -- Rust source watcher integration test confirms notification delivery
- [ ] Manual: dev mode shows Frontend/Backend labels, Restart button appears on `.rs` edit, no WKWebView flash

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Build the `tugrelaunch` helper binary for full app relaunch workflow
- [ ] Add HMR state preservation (partial module replacement instead of full page reload)
- [ ] Consolidate `dev-mode-post-react.md` outstanding items
- [ ] Extract distribution plan from archived `dev-app-mode-roadmap.md` into a new focused document

| Checkpoint | Verification |
|------------|--------------|
| Frontend/Backend rename complete | `bun test` passes, UI shows new labels |
| Rust source watcher operational | `cargo nextest run` passes, manual `.rs` edit triggers Restart button |
| Flash fix implemented | Manual WKWebView testing shows no visible flash |
| Binary watcher chain verified | Debug logs confirm end-to-end notification delivery |
| Roadmap documents archived | `ls roadmap/archive/` shows 7 files |
