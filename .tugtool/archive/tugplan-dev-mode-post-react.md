<!-- tugplan-skeleton v2 -->

## Fix Dev Mode After React Migration {#dev-mode-post-react}

**Purpose:** Restore working hot-reload in dev mode by replacing stale bun build commands with `vite build --watch` in both the Mac app (ProcessManager.swift) and CLI (tugtool main.rs) paths, updating Justfile recipes, and fixing the Developer card's stale-clearing behavior.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-02-27 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The React + shadcn/ui migration (PR #60) changed tugdeck's build model. All CSS is now imported via JavaScript in `main.tsx` and processed by Vite (Tailwind, bundling, content-hashing). Source CSS changes no longer appear in `dist/` without a Vite rebuild. The two parent-process code paths that previously spawned build watchers -- ProcessManager.swift (Mac app) and tugtool main.rs (CLI) -- still use stale bun-based commands that produce broken output or start the wrong server.

Two preliminary fixes are already applied: the CSS color fix in `cards-chrome.css` and the revert of the failed vite-spawn attempt in `tugcast/dev.rs` and `vite.config.ts`. This plan addresses the remaining work: replacing the stale build commands, updating the Justfile, and fixing the Developer card's optimistic stale-clearing.

#### Strategy {#strategy}

- Replace the stale bun commands in ProcessManager.swift with `vite build --watch` using the project-local Vite binary, managed as a child process alongside tugcast.
- Replace `spawn_bun_dev()` in tugtool main.rs with two functions: `ensure_dist_populated()` (one-shot build, called before dev mode activation) and `spawn_vite_watch()` (watcher only). Rename all related variables.
- Verify Justfile `dev` and `dev-watch` recipes already match the desired state (no Vite watcher; tugtool handles it internally). The `dev-watch` recipe continues to spawn cargo-watch as a sibling.
- Fix the Developer card to clear stale state via pending-flag confirmation pattern rather than optimistically on button click. Update tests to match.
- Preserve the three-watcher architecture in tugcast unchanged. Tugcast watches for results; the parent process owns build watchers.
- Sequence work by priority: high-priority ProcessManager and tugtool changes first, then Justfile, then the low-priority Developer card fix.

#### Success Criteria (Measurable) {#success-criteria}

- `just app` launches Tug.app, and editing a CSS file in `tugdeck/styles/` triggers a visible hot-reload within 3 seconds (verify: edit `tokens.css`, observe browser reload with new styles).
- `just dev` launches tugtool, and editing a TSX file in `tugdeck/src/` produces a `restart_available` notification in the Developer card (verify: edit a card component, observe stale indicator).
- No references to `bun build`, `bun run dev`, or `bunProcess` remain in ProcessManager.swift or tugtool main.rs (verify: grep for `bun` in both files returns zero matches).
- The Developer card does not clear stale state until a confirmation event arrives (verify: click Restart, observe card stays stale until the restarted tugcast sends `reloaded`).

#### Scope {#scope}

1. ProcessManager.swift: replace bun build --watch with vite build --watch, rename bunProcess to viteProcess throughout.
2. tugtool main.rs: replace spawn_bun_dev() with ensure_dist_populated() + spawn_vite_watch(), rename bun_child to vite_child, reorder supervisor_loop to build dist/ before dev mode activation. Verify Justfile dev/dev-watch recipes need no changes (they already match the desired state per [D04]).
3. developer-card.tsx and developer-card.test.tsx: change stale-clearing to use pending-flag confirmation pattern, update and add tests to match.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Modifying tugcast's three-watcher architecture or dev.rs.
- Modifying vite.config.ts or the Vite build output structure.
- Adding Vite HMR (hot module replacement) via the Vite dev server. Dev mode uses `vite build --watch`, not the Vite dev server.
- Changing the production (embedded) serving path.
- Touching cards-chrome.css or the already-applied CSS fix.

#### Dependencies / Prerequisites {#dependencies}

- PR #60 (React + shadcn/ui migration) must be merged.
- The CSS fix in cards-chrome.css and the dev.rs/vite.config.ts revert are already applied.
- The Vite binary exists at `tugdeck/node_modules/.bin/vite` (confirmed).

#### Constraints {#constraints}

- ProcessManager.swift spawns the Vite watcher after the tugcast process is launched (inside `startProcess()`). The emptyOutDir race is mitigated by the fact that dist/ already contains identical content from the prior `bun run build` step, so Vite's initial rebuild overwrites with the same output.
- Warnings are errors in the Rust codebase (`-D warnings` in `.cargo/config.toml`); all Rust changes must compile warning-free.
- Crash recovery for the Vite process: log a warning on unexpected exit, do NOT auto-restart.
- The Vite binary at `tugdeck/node_modules/.bin/vite` is a node script (shebang `#!/usr/bin/env node`), so `node` must be available in PATH. In practice, bun provides a node-compatible runtime and is already on the shell PATH.

#### Assumptions {#assumptions}

- The Vite binary path `tugdeck/node_modules/.bin/vite` is stable and will not move.
- `vite build --watch` uses Rollup's watch mode, which does NOT empty dist/ on incremental rebuilds (only on initial build).
- The existing tugcast styles watcher will detect Vite's incremental rebuilds in dist/ and trigger `reload_frontend` without modification.
- dist/index.html remains a reliable code-change sentinel because Vite rewrites it with content-hashed filenames on every build.
- The `node_modules` directory is already populated by `bun install` before dev mode activates in both the Mac app path (`just app` runs `bun run build` first) and the CLI path (developer has previously run `bun install` or `bun run build` at least once).
- For the CLI path (`just dev`), dist/ may not exist on a fresh checkout. The `ensure_dist_populated()` call (per [D06]) handles this by running a one-shot `vite build` before `send_dev_mode`, ensuring dist/ exists when tugcast's `load_dev_state()` runs.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All anchors follow the conventions in the skeleton. Decisions use the d-prefixed anchor format. Steps use the step-N anchor format. All anchors are kebab-case.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Vite watcher crashes silently | med | low | Log warning, serve from last-built dist/ | Users report hot-reload stopped working |
| emptyOutDir race on initial Vite build | high | low | dist/ pre-populated by prior build step; Vite overwrites with identical content | 404 on index.html during dev mode startup |

**Risk R01: Vite watcher crash leaves dev mode partially broken** {#r01-vite-crash}

- **Risk:** If the Vite watcher exits unexpectedly, source changes stop producing dist/ updates. Tugcast continues serving the last-built content, but hot-reload is silently dead.
- **Mitigation:** Log a warning on Vite process exit in both ProcessManager and tugtool. The developer sees the warning in the console and can manually restart.
- **Residual risk:** Without auto-restart, the developer must notice the log warning and take action. This is acceptable because Vite crashes are rare in practice.

**Risk R02: emptyOutDir race on Vite watcher startup** {#r02-emptyoutdir-race}

- **Risk:** When `vite build --watch` starts, the initial build empties dist/ before repopulating it. If tugcast is serving during this window, it may 404 on index.html.
- **Mitigation:** ProcessManager spawns the Vite watcher after the tugcast process is launched (inside `startProcess()`), not after the ready message. The real mitigation is that dist/ is already pre-populated with identical content from the prior build step (`bun run build` in the `just app` path, or the `ensure_dist_populated()` one-shot build in tugtool for the CLI path). Vite's initial rebuild overwrites dist/ with the same output, and the styles watcher triggers a harmless reload.
- **Residual risk:** A brief window (< 500ms) where dist/ is being rewritten. The content is identical, so any reload is a no-op.

---

### Design Decisions {#design-decisions}

#### [D01] Parent process owns the Vite watcher (DECIDED) {#d01-parent-owns-vite}

**Decision:** The Vite build watcher is spawned and managed by the parent process (ProcessManager for Mac app, tugtool for CLI), not by tugcast.

**Rationale:**
- Tugcast's principle is "watch for results, don't run builds." The failed vite-spawn attempt in dev.rs proved that spawning build processes from tugcast introduces lifecycle complexity and race conditions.
- The parent process already manages tugcast's lifecycle and is the natural owner of sibling build processes.

**Implications:**
- ProcessManager.swift must manage the Vite process lifecycle (start, stop, crash recovery).
- tugtool main.rs must manage the Vite child process across tugcast restarts.
- The Justfile must NOT also spawn a Vite watcher (no double-spawning).

#### [D02] Use project-local Vite binary (DECIDED) {#d02-vite-binary-path}

**Decision:** Spawn Vite using the project-local binary at `{source_tree}/tugdeck/node_modules/.bin/vite` with arguments `["build", "--watch"]` and working directory `{source_tree}/tugdeck/`.

**Rationale:**
- Uses the exact Vite version pinned in the project's package.json, avoiding version mismatches.
- Does not depend on global bun/npm/npx installation or `bun run` argument forwarding.
- The binary is confirmed to exist after `bun install` / `bun run build`.

**Implications:**
- Both ProcessManager and tugtool must construct the full path to the Vite binary rather than relying on PATH lookup.
- If `node_modules` is missing, the Vite binary won't exist. The existing `bun run build` step in `just app` and the build prerequisite in `just dev` ensure node_modules is populated.
- The Vite binary is a node script (`#!/usr/bin/env node` shebang). This creates an implicit dependency on `node` being available in PATH. In practice, bun provides a node-compatible runtime that satisfies this requirement, and bun is already required for the build toolchain.

#### [D03] Rename bun references to vite throughout (DECIDED) {#d03-rename-bun-to-vite}

**Decision:** Rename all bun-related identifiers to reflect the switch to Vite: `bunProcess` to `viteProcess` in ProcessManager.swift, `spawn_bun_dev` to `spawn_vite_watch` and `bun_child` to `vite_child` in tugtool main.rs.

**Rationale:**
- Code should reflect what it does. The bun bundler is no longer used for the build watcher.
- Consistent naming prevents confusion about which tool is actually being spawned.

**Implications:**
- All references to the old names must be updated in a single step to avoid partial renames.

#### [D04] Justfile does not spawn Vite watcher (DECIDED) {#d04-justfile-no-vite}

**Decision:** The Justfile `dev` and `dev-watch` recipes do NOT spawn a Vite watcher. Tugtool spawns it internally via `spawn_vite_watch()`. The Justfile `dev-watch` recipe continues to spawn cargo-watch as a sibling (since cargo-watch is NOT handled by tugtool internally).

**Rationale:**
- One spawn in the proper place, no duplication. The user was clear: tugtool handles Vite internally for the CLI path, ProcessManager handles it for the Mac app path.
- cargo-watch remains in the Justfile because tugtool does not manage Rust compilation.

**Implications:**
- `just dev` becomes a simple `build` + `tugcode/target/debug/tugtool` invocation.
- `just dev-watch` spawns cargo-watch as a background sibling and then runs tugtool.

#### [D05] Developer card clears stale state on confirmation event (DECIDED) {#d05-stale-clear-on-confirm}

**Decision:** The Developer card does NOT clear `isStale`, `staleCount`, `lastCleanTs`, or `firstDirtySinceTs` when the user clicks Restart or Relaunch. Instead, it sets a pending flag (`restartPending` or `relaunchPending`) and clears stale state when any `dev_notification` arrives from the restarted/relaunched tugcast instance, confirming the new instance is running.

**Rationale:**
- Optimistic clearing reports "clean" even if the restart/relaunch fails, which is misleading.
- Waiting for confirmation ensures the card accurately reflects reality: stale until the new instance is actually running.
- Using a pending flag (rather than unconditionally clearing on `reloaded`) prevents unrelated events (e.g., a CSS hot-reload `reloaded` event) from incorrectly clearing codeRow stale state.
- Clearing on ANY `dev_notification` (not just `reloaded`) handles backend-only restarts where no dist/ changes occur and therefore no `reloaded` fires from the styles watcher. The first notification of any type from the new tugcast instance is sufficient proof it is running.

**Implications:**
- `handleRestart` sets `restartPending = true` and dispatches the control frame; it does not modify row state.
- `handleRelaunch` sets `relaunchPending = true` and dispatches the control frame; it does not modify row state.
- The `handleDevNotification` handler checks the pending flags: if `restartPending` is true when any notification arrives, it clears codeRow stale state, resets the flag, and then processes the notification normally. Same for `relaunchPending` and appRow.
- The pending flags are React refs (not state) since their changes should not trigger re-renders.

#### [D06] Split one-shot build from watcher to fix ordering (DECIDED) {#d06-oneshot-build}

**Decision:** Split the Vite lifecycle in tugtool into two separate functions: `ensure_dist_populated()` runs a blocking one-shot `vite build` to guarantee dist/ exists, and `spawn_vite_watch()` spawns only the `vite build --watch` watcher. `ensure_dist_populated()` is called BEFORE `send_dev_mode` on first spawn. `spawn_vite_watch()` remains in the existing first_spawn location after dev mode is enabled.

**Rationale:**
- Tugcast's `load_dev_state()` requires `tugdeck/dist/index.html` to exist; it returns an error if the file is missing. Dev mode fails to enable without it.
- In the supervisor loop, `send_dev_mode` (lines 394-416) runs BEFORE the first_spawn block (lines 418-436) where the watcher is spawned. If the one-shot build were inside `spawn_vite_watch()`, it would run too late -- dist/ would still be missing when `load_dev_state()` executes.
- The `just app` path already populates dist/ via `bun run build` before launching the app. The `just dev` path only runs `cargo build` and does NOT run `bun run build`, so dist/ may be missing on a fresh checkout or after `rm -rf dist`.
- Splitting into two functions is the minimal change: the one-shot build runs at the right point in the lifecycle without restructuring the supervisor loop.

**Implications:**
- New function `ensure_dist_populated(source_tree: &Path) -> Result<(), String>`: checks for the Vite binary, runs `vite build` (no `--watch`), waits for exit. Called in the supervisor loop before `send_dev_mode`, gated on `first_spawn && source_tree.is_some()`.
- Renamed function `spawn_vite_watch(source_tree: &Path) -> Result<Child, String>`: checks for the Vite binary, spawns `vite build --watch`, returns the child process. Called in the existing first_spawn location.
- The one-shot build adds a few seconds of startup latency on the `just dev` path. This is acceptable because it only runs once per tugtool launch and is comparable to `cargo build` time.
- If dist/ already exists (common case), the one-shot build overwrites with identical content, which is a harmless no-op.

---

### Specification {#specification}

#### Vite Watcher Process Lifecycle {#vite-lifecycle}

**Spec S01: Vite watcher process management** {#s01-vite-process-mgmt}

| Aspect | ProcessManager.swift (Mac app) | tugtool main.rs (CLI) |
|--------|-------------------------------|----------------------|
| Binary path | `{sourceTree}/tugdeck/node_modules/.bin/vite` | `{source_tree}/tugdeck/node_modules/.bin/vite` |
| Arguments (watcher) | `["build", "--watch"]` | `["build", "--watch"]` |
| Working directory | `{sourceTree}/tugdeck/` | `{source_tree}/tugdeck/` |
| Pre-step | None (dist/ populated by `bun run build` in `just app`) | `ensure_dist_populated()`: one-shot `vite build` (blocking), called BEFORE `send_dev_mode` on first spawn |
| Start condition | Dev mode enabled AND tugcast process launched | First spawn AND source_tree is Some |
| Stop condition | Dev mode deactivates OR app quits | SIGINT/SIGTERM OR tugcast exits with DoNotRestart |
| Crash behavior | Log warning, do not auto-restart | Log warning, do not auto-restart |
| Persists across tugcast restarts | Yes (duplication guard) | Yes (persists across supervisor loop iterations) |
| Runtime dependency | `node` in PATH (Vite binary has `#!/usr/bin/env node` shebang; bun satisfies this) | Same |

**Spec S02: ProcessManager.swift rename inventory** {#s02-pm-renames}

| Old name | New name | Occurrences |
|----------|----------|-------------|
| `bunProcess` (property declaration) | `viteProcess` | 1 (line 14) |
| `bunProcess` (references) | `viteProcess` | 6 (lines 186, 191, 243, 247, 375, 398) |
| `bunPath` (local var) | removed (use inline Vite binary path) | 1 (line 377) |
| `bunProc` (local var) | `viteProc` | 5 (lines 378-380, 388-389, 392, 397-399) |
| `bunSourceTree` (local var) | `viteSourceTree` | 1 (line 373) |
| `bunEnv` (local var) | `viteEnv` | 2 (lines 384-386) |
| `"bun build --watch"` (NSLog messages) | `"vite build --watch"` | 4 (lines 376, 393, 399, 401) |
| `"terminating bun process"` (NSLog) | `"terminating vite process"` | 1 (line 187) |
| `"bun not found on PATH"` (NSLog) | `"vite binary not found"` | 1 (line 404) |
| `"bun build --watch"` (code comments) | `"vite build --watch"` | 3 (lines 185, 358, 372) |
| `"find tools like tmux and bun"` (doc comment) | `"find tools like tmux"` | 1 (line 36) |
| `"find tmux, bun, etc."` (code comment) | `"find tmux, etc."` | 1 (line 345) |
| `"for bun build --watch"` (code comment) | `"for vite build --watch"` | 1 (line 358) |
| `"Start bun build --watch"` (code comment) | `"Start vite build --watch"` | 1 (line 372) |
| `"Handle bun exit"` (code comment) | `"Handle vite exit"` | 1 (line 391) |
| `"Bun duplication guard"` (code comment) | `"Vite duplication guard"` | 1 (line 374) |

**Spec S03: tugtool main.rs rename and restructure inventory** {#s03-tugtool-renames}

| Old name | New name | Location |
|----------|----------|----------|
| `spawn_bun_dev()` | Split into `ensure_dist_populated()` + `spawn_vite_watch()` | Function definition (line ~88) |
| `bun_child` | `vite_child` | `supervisor_loop` parameter + all references in main() |
| `check_command_available("bun")` | Check for Vite binary file existence | Inside both new functions |
| `Command::new("bun")` | `Command::new(vite_binary_path)` | Inside both new functions |
| `"bun"` in log/error messages | `"vite"` | All log/warn/error strings |
| N/A (new) | `ensure_dist_populated()` call site | Before `send_dev_mode`, gated on `first_spawn && source_tree.is_some()` |

#### Developer Card State Machine Change {#dev-card-state-change}

**Spec S04: Developer card stale-clearing behavior** {#s04-stale-clearing}

| Event | Old behavior | New behavior |
|-------|-------------|-------------|
| Click Restart button | Clear codeRow: isStale=false, staleCount=0, lastCleanTs=Date.now(), firstDirtySinceTs=null | Set `restartPending` flag to true. Send control frame `"restart"`. Do NOT modify codeRow state. |
| Click Relaunch button | Clear appRow: isStale=false, staleCount=0, lastCleanTs=Date.now(), firstDirtySinceTs=null | Set `relaunchPending` flag to true. Send control frame `"relaunch"`. Do NOT modify appRow state. |
| Receive `reloaded` notification | Update stylesRow.lastCleanTs, flash "Reloaded" | Same as before. PLUS: if `restartPending` is true, clear codeRow stale state and reset the flag. If `relaunchPending` is true, clear appRow stale state and reset the flag. The `reloaded` event fires after the styles watcher initializes on the new tugcast instance, confirming the restart/relaunch succeeded. |
| Receive any `dev_notification` while pending | N/A | If `restartPending` or `relaunchPending` is true and any dev_notification arrives (reloaded, restart_available, or relaunch_available), clear the corresponding row stale state and reset the flag. Any notification from the new instance proves it is running. |
| Receive `restart_available` after restart | Set codeRow stale (normal notification flow) | If `restartPending` is true: clear codeRow stale state first (confirming restart completed), reset the flag, then apply the new notification normally. If not pending: set codeRow stale as before. |

Note: The pending flags ensure stale state is only cleared after a restart/relaunch was actually requested. Without a pending flag, a random `reloaded` event (e.g., from a CSS hot-reload) would incorrectly clear codeRow stale state. The flags tie the clearing to the specific restart/relaunch action.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Replace bun with Vite in ProcessManager.swift {#step-1}

**Commit:** `fix(tugapp): replace bun build --watch with vite build --watch in ProcessManager`

**References:** [D01] Parent process owns Vite watcher, [D02] Use project-local Vite binary, [D03] Rename bun to vite, Spec S01, Spec S02, Risk R01, Risk R02, (#vite-lifecycle, #d01-parent-owns-vite, #d02-vite-binary-path, #s01-vite-process-mgmt, #s02-pm-renames)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`

**Tasks:**
- [ ] Rename the `bunProcess` property to `viteProcess` (line 14: `private var bunProcess: Process?` becomes `private var viteProcess: Process?`).
- [ ] In `handleControlMessage` `"relaunch"` case (lines 186-191): rename `bunProcess` references to `viteProcess`, update log message from "bun process" to "vite process".
- [ ] In `stop()` method (lines 242-247): rename `bunProcess` references to `viteProcess`.
- [ ] In `startProcess()` method (lines 372-406): replace the entire bun build block with Vite watcher logic:
  - Construct the Vite binary path: `let viteBinaryPath = (viteSourceTree as NSString).appendingPathComponent("tugdeck/node_modules/.bin/vite")`
  - Verify the Vite binary exists with `FileManager.default.isExecutableFile(atPath:)`
  - Create a `Process` with `executableURL` set to the Vite binary path
  - Set arguments to `["build", "--watch"]`
  - Set `currentDirectoryURL` to `{sourceTree}/tugdeck/`
  - Pass the shell PATH environment
  - Set `terminationHandler` to log a warning (no auto-restart per Risk R01)
  - Replace duplication guard to check `viteProcess?.isRunning`
- [ ] Update all log messages from "bun" to "vite" in the modified sections.

**Tests:**
- [ ] Build the Xcode project successfully (`xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`).
- [ ] Verify no references to `bunProcess`, `bun build`, `bun run`, `bunPath`, `bunProc`, `bunEnv`, `bunSourceTree`, or `bun not found` remain in ProcessManager.swift (grep the file).

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds.
- [ ] `grep -ci 'bunProcess\|bunProc\|bunPath\|bunEnv\|bunSourceTree\|bun build\|bun run\|bun not found\|bun process\|bun exit' tugapp/Sources/ProcessManager.swift` returns 0.

---

#### Step 2: Replace spawn_bun_dev with spawn_vite_watch in tugtool main.rs {#step-2}

**Depends on:** #step-1

**Commit:** `fix(tugtool): replace spawn_bun_dev with spawn_vite_watch using project-local Vite binary`

**References:** [D01] Parent process owns Vite watcher, [D02] Use project-local Vite binary, [D03] Rename bun to vite, [D04] Justfile does not spawn Vite watcher, [D06] One-shot build before watcher, Spec S01, Spec S03, (#vite-lifecycle, #d02-vite-binary-path, #s03-tugtool-renames, #d04-justfile-no-vite, #d06-oneshot-build)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`

**Tasks:**
- [ ] Replace `spawn_bun_dev` (function at line ~88) with two new functions per [D06]:
  - `ensure_dist_populated(source_tree: &Path) -> Result<(), String>`: Resolve the Vite binary at `source_tree.join("tugdeck/node_modules/.bin/vite")`. If the binary does not exist, return `Err`. Run a blocking one-shot `vite build` (no `--watch`) using `Command::new(vite_binary_path).arg("build").current_dir(tugdeck_dir).status().await`. If exit status is non-zero, return `Err`. Return `Ok(())` on success. This populates dist/ so `load_dev_state()` succeeds.
  - `spawn_vite_watch(source_tree: &Path) -> Result<Child, String>`: Resolve the same Vite binary path. Spawn `vite build --watch` using `Command::new(vite_binary_path).args(["build", "--watch"]).current_dir(tugdeck_dir).spawn()`. Return the child process handle.
- [ ] Remove the `check_command_available` function (line ~78) if it is no longer used elsewhere. If removing it triggers a dead-code warning, it must be removed (warnings are errors).
- [ ] Remove the `node_modules` / `bun install` fallback logic (lines 101-115) since the Vite binary existence check replaces it.
- [ ] Rename `bun_child` to `vite_child` in `supervisor_loop` parameter (line ~341), the `main()` function (line ~627), and all references throughout the supervisor loop.
- [ ] Update the `supervisor_loop` doc comment (line ~337) to reference `vite_child` instead of `bun_child`.
- [ ] Update all log/info/warn messages from "bun" to "vite" (e.g., "bun dev started" -> "vite build --watch started", "could not start bun dev" -> "could not start vite build --watch").
- [ ] **Critical ordering fix:** In the supervisor loop, add an `ensure_dist_populated()` call BEFORE the `send_dev_mode` block (lines 394-416). Gate it on `first_spawn && source_tree.is_some()`. Insert it after the `backoff_secs = 0` line (line 389) and before the dev mode activation block. This ensures dist/ exists before tugcast's `load_dev_state()` runs. On failure, log a warning and continue (dev mode will fail gracefully). Example insertion point:
  ```
  // After backoff reset (line 389), before send_dev_mode (line 394):
  if first_spawn {
      if let Some(ref st) = source_tree {
          if let Err(e) = ensure_dist_populated(st).await {
              warn!("could not populate dist/: {}", e);
          }
      }
  }
  ```
- [ ] In the first_spawn block (lines 422-434): change `spawn_bun_dev(st).await` to `spawn_vite_watch(st).await` (watcher only, no one-shot build). Update the success/error log messages.
- [ ] In the SIGINT/SIGTERM handlers (lines 517-534): change `bun` references to `vite_child`.
- [ ] In the DoNotRestart branch (lines 569-576): change `bun` reference to `vite_child`.

**Tests:**
- [ ] `cd tugcode && cargo build -p tugtool` compiles with zero warnings.
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes all existing tests.
- [ ] Verify no references to `bun_child`, `spawn_bun_dev`, or `bun run dev` remain in main.rs (grep the file).

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` succeeds with no warnings.
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes.
- [ ] `grep -c 'bun_child\|spawn_bun_dev\|bun run dev' tugcode/crates/tugtool/src/main.rs` returns 0.
- [ ] Verify Justfile `dev` and `dev-watch` recipes do not spawn a Vite watcher: the `dev` recipe runs `build` then `tugcode/target/debug/tugtool` with no Vite references; `dev-watch` spawns cargo-watch as a sibling and runs tugtool with no Vite references. (Current Justfile already matches this desired state per [D04]; no Justfile changes needed.)

---

#### Step 3: Fix Developer card stale-clearing behavior {#step-3}

**Depends on:** #step-1

**Commit:** `fix(tugdeck): clear Developer card stale state on confirmation event, not on button click`

**References:** [D05] Developer card clears stale state on confirmation event, Spec S04, (#d05-stale-clear-on-confirm, #s04-stale-clearing, #dev-card-state-change)

**Artifacts:**
- Modified `tugdeck/src/components/cards/developer-card.tsx`
- Modified `tugdeck/src/components/cards/developer-card.test.tsx`

**Tasks:**
- [ ] Add two `useRef<boolean>` refs to the component: `restartPendingRef` (initial false) and `relaunchPendingRef` (initial false). These are refs (not state) because their changes should not trigger re-renders.
- [ ] In `handleRestart` (lines 365-375): remove the `setCodeRow` call that clears isStale/staleCount/lastCleanTs/firstDirtySinceTs. Remove the `dispatchBadge(0)` call. Add `restartPendingRef.current = true` before the control frame dispatch. Keep `connection?.sendControlFrame("restart")`.
- [ ] In `handleRelaunch` (lines 377-387): remove the `setAppRow` call that clears isStale/staleCount/lastCleanTs/firstDirtySinceTs. Remove the `dispatchBadge(0)` call. Add `relaunchPendingRef.current = true` before the control frame dispatch. Keep `connection?.sendControlFrame("relaunch")`.
- [ ] In the `handleDevNotification` function (lines 275-319), at the top of the handler (before the type switch): check `restartPendingRef.current`. If true, clear codeRow stale state (`setCodeRow(prev => ({ ...prev, isStale: false, staleCount: 0, firstDirtySinceTs: null, lastCleanTs: timestamp ?? Date.now() }))`) and set `restartPendingRef.current = false`. Similarly check `relaunchPendingRef.current` and clear appRow if true.
- [ ] Update the `handleRestart` and `handleRelaunch` `useCallback` dependency arrays to remove `dispatchBadge` if it is no longer used in those callbacks.
- [ ] Update test: "clicking Restart calls sendControlFrame and hides button" (line 351). The Restart button will NO LONGER disappear after click because isStale is not cleared. Change the assertion: after clicking Restart, the button should still be visible. Add a follow-up: dispatch a `reloaded` notification, then verify the button disappears (codeRow stale cleared by pending-flag logic).
- [ ] Update test: "dispatches td-dev-badge with 0 when Restart is clicked" (line 430). The badge will NOT go to 0 on click because `dispatchBadge(0)` is removed. Change this test: after clicking Restart, badge should still show the stale count (5). Add a follow-up: dispatch a `reloaded` notification, then verify badge dispatches 0 (codeRow clears via pending flag, useEffect dispatches updated badge).
- [ ] Add new test: "codeRow clears stale state when dev_notification arrives after Restart click". Dispatch `restart_available` to make codeRow stale, click Restart (button stays), dispatch `reloaded` notification, verify codeRow shows "Clean" and button is gone.
- [ ] Add new test: "codeRow shows new stale count after restart_available arrives with restartPending set". Dispatch `restart_available(count=1)` to make codeRow stale, click Restart (sets pending flag), dispatch `restart_available(count=2)` (from new tugcast instance). React 18 batches the pending-flag clear and the new stale set into a single render. Verify final state: codeRow shows staleCount=2, isStale=true (the pending flag resolved and the new notification was applied in one render pass).

**Tests:**
- [ ] `cd tugdeck && bun test` passes (all existing tests updated, new tests added).
- [ ] Manual verification: in a running dev session, click Restart and confirm the card stays stale until the restarted tugcast sends a notification.

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes.
- [ ] In developer-card.tsx, `handleRestart` sets `restartPendingRef.current = true` and calls `connection?.sendControlFrame("restart")` (no setCodeRow, no dispatchBadge).
- [ ] In developer-card.tsx, `handleRelaunch` sets `relaunchPendingRef.current = true` and calls `connection?.sendControlFrame("relaunch")` (no setAppRow, no dispatchBadge).
- [ ] In developer-card.tsx, `handleDevNotification` checks pending refs and clears stale state when any notification arrives after a restart/relaunch request.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Dev mode hot-reload works end-to-end in both the `just app` (Mac app) and `just dev` (CLI) paths after the React migration, with the Vite build watcher managed by the parent process and the Developer card accurately reflecting stale state.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `just app` hot-reload works: edit `tugdeck/styles/tokens.css`, observe browser reload with new styles within 3 seconds.
- [ ] `just dev` hot-reload works: edit `tugdeck/src/components/cards/about-card.tsx`, observe `restart_available` notification in Developer card.
- [ ] No references to `bunProcess`, `bun build`, `spawn_bun_dev`, or `bun_child` in ProcessManager.swift or tugtool main.rs.
- [ ] Developer card stale state clears only on confirmation, not on button click.
- [ ] `cd tugcode && cargo nextest run` passes all tests.
- [ ] `cd tugdeck && bun test` passes all tests.
- [ ] Xcode project builds successfully.

**Acceptance tests:**
- [ ] Hot-reload CSS change via `just app` path (edit tokens.css, observe reload).
- [ ] Hot-reload TSX change via `just dev` path (edit card component, observe restart_available).
- [ ] Restart button: stale indicator persists until reloaded event arrives.
- [ ] Vite watcher crash: log warning visible in console, no auto-restart.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add Vite HMR support via the Vite dev server for instant CSS updates without full page reload.
- [ ] Add a Vite watcher status indicator to the Developer card (running/stopped).
- [ ] Consider auto-restart of the Vite watcher with backoff on crash.

| Checkpoint | Verification |
|------------|--------------|
| ProcessManager uses Vite | `grep -c 'viteProcess' tugapp/Sources/ProcessManager.swift` returns > 0 |
| tugtool uses Vite | `grep -c 'spawn_vite_watch' tugcode/crates/tugtool/src/main.rs` returns > 0 |
| No bun references in process managers | `grep -c 'bunProcess\|bun_child\|spawn_bun_dev' tugapp/Sources/ProcessManager.swift tugcode/crates/tugtool/src/main.rs` returns 0 |
| All Rust tests pass | `cd tugcode && cargo nextest run` exits 0 |
| All TS tests pass | `cd tugdeck && bun test` exits 0 |
| Xcode builds | `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` exits 0 |
