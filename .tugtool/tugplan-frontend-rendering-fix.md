<!-- tugplan-skeleton v2 -->

## Frontend Rendering Fix {#frontend-rendering-fix}

**Purpose:** Ship a production frontend serving architecture where tugcast serves pre-built static files directly via tower-http, eliminating the Vite/Node.js process from the production runtime while preserving Vite-based dev mode with HMR.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

After the React Foundation Cleanup (PR #67), the Tug macOS app renders cards but uses an incorrect serving architecture. Production mode currently runs `vite preview` (a Node.js process) just to serve pre-built static files. This is unnecessary overhead and the source of real bugs: stale Vite processes, port conflicts, and confusing process lifecycle. tugcast already has an HTTP server on port 55255 -- it should serve the production frontend directly.

The correct architecture keeps tugcast as the sole production server (serving HTML/CSS/JS from `tugdeck/dist/` via `tower-http::ServeDir`, plus `/auth`, `/ws`, `/api/tell`) and uses Vite only for development (HMR, live transforms on port 55155, proxying API routes to tugcast).

#### Strategy {#strategy}

- Phase 0 is the only code-change phase: add `tower-http::ServeDir` to tugcast, update Swift code to conditionally skip Vite in production, and fix the origin allowlist.
- Phases 1-4 are verification-only: confirm error visibility, dev mode HMR, mode toggling, and control actions all work under the new architecture.
- Extend existing Swift code rather than rewrite -- add a conditional branch for production mode while preserving the current dev mode path.
- Use `bun run build` (not npm) for all frontend builds. bun is the approved build tool.
- Keep the existing tugplan-frontend-serving-cleanup.md as historical context alongside this new plan.
- Address the origin allowlist regression: in production mode, `dev_port` must be `None` since no Vite process is running.

#### Success Criteria (Measurable) {#success-criteria}

- Cards render in production mode with no Vite process running (verify: `lsof -i :55155` shows nothing, grid visible in WebView)
- Cards render in dev mode with HMR working (verify: unbundled module names in console, CSS hot-reload without page refresh)
- Mode toggling works in a running app both via Settings card and `defaults write` (verify: both transitions preserve session cookie)
- All four control actions (Reload Frontend, Restart Server, Relaunch App, Reset Everything) work in both modes (8 manual tests)
- Rendering errors show a visible fallback UI via ErrorBoundary instead of a blank screen

#### Scope {#scope}

1. Add `tower-http` with `fs` feature to tugcast and configure `ServeDir` fallback in the router
2. Update `AppDelegate.swift` to load from tugcast port 55255 in production mode, only spawning Vite in dev mode
3. Update `ProcessManager.swift` to gate `spawnViteServer` on dev mode
4. Fix origin allowlist in `control.rs` to set `dev_port = None` when dev mode is disabled
5. Verify error boundaries, dev mode HMR, mode toggling, and control actions work in both modes

#### Non-goals (Explicitly out of scope) {#non-goals}

- Automated integration tests for the two serving modes (manual verification is sufficient for this phase)
- Changes to the Vite dev server configuration or proxy setup (already correct in `vite.config.ts`)
- Removing the `vite preview` command support from `ProcessManager.spawnViteServer` (dead code cleanup deferred)
- Changes to the tugrelaunch workflow or build pipeline
- Any npm-related tooling changes beyond confirming bun is used

#### Dependencies / Prerequisites {#dependencies}

- `tower-http` crate must be added to the workspace and tugcast's Cargo.toml
- `tugdeck/dist/` must exist (built via `cd tugdeck && bun run build`) before production mode will serve frontend files
- PR #67 (React Foundation Cleanup) is already merged on main

#### Constraints {#constraints}

- macOS-only: WKWebView, Swift AppDelegate, Xcode build system
- Rust edition 2024 with `-D warnings` enforced -- no new warnings allowed
- Build tool is bun, not npm. `bun run build` for frontend builds.
- Cookies are host-scoped per RFC 6265 (not port-scoped), so port changes during mode toggling do not invalidate sessions

#### Assumptions {#assumptions}

- The `tower-http` crate version compatible with `axum 0.8` is `0.6.x` (both from the tower/axum ecosystem)
- `ServeDir` with `not_found_service` pointing to `index.html` handles SPA client-side routing correctly
- The existing `vite.config.ts` proxy configuration already forwards `/auth`, `/ws`, `/api` to tugcast and needs no changes
- The ErrorBoundary and `diagnostic.js` implementations from prior work are functionally correct and only need re-verification under the new serving path

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Remove package-lock.json (DEFERRED) {#q01-remove-package-lock}

**Question:** Should `package-lock.json` be removed from `tugdeck/` since bun is the approved build tool and `bun.lock` already exists?

**Why it matters:** Having both lockfiles creates confusion about which package manager is canonical. An unauthorized npm migration occurred previously.

**Options (if known):**
- Remove `package-lock.json` now as part of this plan
- Defer to a separate cleanup task

**Plan to resolve:** Deferred -- this is cosmetic and tangential to the serving architecture fix. A dedicated cleanup commit can address it later.

**Resolution:** DEFERRED (separate cleanup task, does not affect this plan's deliverables)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| dist/ missing on first production launch | med | med | Log warning, serve 404 gracefully; tugcast still handles /auth, /ws, /api | Users report blank screen in production |
| tower-http version incompatibility with axum 0.8 | high | low | Pin tower-http 0.6.x which matches the axum 0.8 ecosystem | Cargo build fails |
| Stale Vite process from old architecture lingers | med | low | killProcessOnPort(55155) already exists in ProcessManager | Port conflict errors on launch |

**Risk R01: dist/ directory does not exist at runtime** {#r01-missing-dist}

- **Risk:** If `tugdeck/dist/` has not been built, production mode will show a blank screen for frontend routes.
- **Mitigation:**
  - tugcast checks for `dist/` existence before adding the `ServeDir` fallback
  - If missing, logs a `warn!` message and skips the fallback (API routes still work)
  - Plan step includes building dist/ before testing
- **Residual risk:** A user running from source without building dist/ will see 404s for frontend routes. This is expected behavior, not a bug.

**Risk R02: tower-http incompatibility with axum 0.8** {#r02-tower-http-compat}

- **Risk:** Wrong tower-http version could cause compilation errors or runtime incompatibilities.
- **Mitigation:**
  - Use `tower-http = "0.6"` with `features = ["fs"]`, which is the version compatible with axum 0.8 and tower 0.5
  - Verify with `cargo build` before proceeding
- **Residual risk:** None if version is pinned correctly.

---

### Design Decisions {#design-decisions}

#### [D01] Use tower-http::ServeDir for static file serving (DECIDED) {#d01-servedir-fallback}

**Decision:** Serve production frontend files from disk at runtime using `tower-http::ServeDir` as a fallback route on the axum router.

**Rationale:**
- `rust-embed` was already removed from tugcast; we need runtime file serving, not compile-time embedding
- `tower-http::ServeDir` integrates natively with axum's router as a fallback service
- Files are served from `{source_tree}/tugdeck/dist/` which allows rebuilding the frontend without recompiling tugcast

**Implications:**
- `tower-http` with `fs` feature must be added to both workspace `Cargo.toml` and tugcast's `Cargo.toml`
- The fallback must use `not_found_service(ServeFile::new(...))` to serve `index.html` for SPA client-side routing
- If `dist/` does not exist, the fallback is skipped entirely (log warning, silent 404)

#### [D02] Production mode loads from tugcast port, not Vite (DECIDED) {#d02-production-port}

**Decision:** When `devModeEnabled == false`, the WebView loads from `http://127.0.0.1:55255/auth?token=...` (tugcast). No Vite process is spawned.

**Rationale:**
- Eliminates the unnecessary Node.js/Vite process from the production runtime
- tugcast already runs an HTTP server; adding static file serving is a single fallback route
- Removes the class of bugs caused by stale Vite processes and port conflicts

**Implications:**
- `AppDelegate.swift` must branch on `devModeEnabled` in the `onReady` callback
- `ProcessManager.spawnViteServer` must only be called when dev mode is enabled
- The auth token exchange happens directly with tugcast in production (no Vite proxy in the path)

#### [D03] Dev mode continues to use Vite dev server on port 55155 (DECIDED) {#d03-dev-mode-vite}

**Decision:** When `devModeEnabled == true`, the Vite dev server runs on port 55155 with HMR, proxying `/auth`, `/ws`, `/api` to tugcast on port 55255.

**Rationale:**
- Vite provides HMR, React Refresh, and unbundled ESM serving that are essential for development
- The existing `vite.config.ts` proxy configuration already handles API route forwarding
- Dev mode behavior is unchanged from the current working implementation

**Implications:**
- No changes to `vite.config.ts` or the Vite dev server configuration
- `spawnViteServer` in dev mode uses `vite` (not `vite preview`) as it does today
- Dev port (55155) must be added to the origin allowlist only when dev mode is enabled

#### [D04] Origin allowlist sets dev_port to None in production (DECIDED) {#d04-origin-allowlist}

**Decision:** In `control.rs`, when `DevMode { enabled: false, .. }` is received, set `dev_port` to `None` instead of passing through the `vite_port` value.

**Rationale:**
- The current code (line 178 of `control.rs`) always sets `dev_port` to `vite_port` even when disabling dev mode -- this was a workaround for the old architecture where Vite served the frontend in both modes
- Under the new architecture, production mode loads from tugcast port 55255, which is always in the origin allowlist as the primary server port
- Setting `dev_port = None` in production correctly restricts WebSocket origins to just the tugcast port

**Implications:**
- Single line change in `control.rs`: `auth.lock().unwrap().set_dev_port(None)` in the `!enabled` branch
- The comment explaining "Always set vite_port" must be removed/updated since it describes the old architecture

#### [D05] Extend AppDelegate rather than rewrite (DECIDED) {#d05-extend-appdelegate}

**Decision:** Add a conditional branch in AppDelegate's `onReady` callback to handle production mode (load from tugcast port, no Vite) while keeping the existing dev mode path intact.

**Rationale:**
- The current `onReady` code is working correctly for dev mode
- Minimal change reduces risk of regressions
- The branching point is clear: `if devModeEnabled` vs `else`

**Implications:**
- Production path: extract token from auth URL, load `http://127.0.0.1:55255/auth?token=...` directly
- Dev path: existing code continues to spawn Vite and load from port 55155
- `sendDevMode` is called in both paths to update file watchers and origin allowlist

#### [D06] Build tool is bun, not npm (DECIDED) {#d06-bun-build-tool}

**Decision:** Use `bun run build` for all frontend build commands. npm was never approved and must not be used.

**Rationale:**
- bun is the established build tool for tugdeck (confirmed by `bun.lock` presence and project convention)
- An unauthorized migration to npm occurred previously and must not be perpetuated

**Implications:**
- All plan steps that build the frontend use `cd tugdeck && bun run build`
- `package-lock.json` coexists with `bun.lock` (cleanup deferred per [Q01])

---

### Specification {#specification}

#### Modes and Policies {#modes-policies}

**Table T01: Serving architecture by mode** {#t01-serving-modes}

| Aspect | Production (`devModeEnabled == false`) | Dev (`devModeEnabled == true`) |
|--------|---------------------------------------|-------------------------------|
| Frontend server | tugcast (port 55255) via ServeDir | Vite dev server (port 55155) |
| Static files | `{source_tree}/tugdeck/dist/` from disk | Vite transforms + HMR |
| API routes | tugcast directly | Vite proxy to tugcast |
| WebView URL | `http://127.0.0.1:55255/auth?token=...` | `http://127.0.0.1:55155/auth?token=...` |
| Vite process | Not running | Running (HMR, React Refresh) |
| Origin allowlist | tugcast port only (`dev_port = None`) | tugcast port + Vite port |
| Cookie scope | `127.0.0.1` (host-scoped, RFC 6265) | Same -- cookies carry across ports |

**Table T02: Control actions and expected behavior** {#t02-control-actions}

| Action | Trigger | Production Behavior | Dev Behavior |
|--------|---------|-------------------|--------------|
| Reload Frontend | Developer menu / Dock | WebView reloads from tugcast | WebView reloads from Vite |
| Restart Server | Developer menu / Dock | tugcast restarts, WebView reconnects | tugcast restarts, Vite proxy reconnects |
| Relaunch App | Developer menu | tugrelaunch rebuilds and restarts entire app | Same |
| Reset Everything | Developer menu / Dock | Clears localStorage, fresh state | Same |

#### Internal Architecture {#internal-architecture}

**Spec S01: ServeDir fallback configuration** {#s01-servedir-config}

The `build_app` function in `server.rs` must be modified to accept the source tree path and conditionally add a `ServeDir` fallback:

1. Resolve `dist_path` as `{source_tree}/tugdeck/dist/`
2. If `dist_path` exists and is a directory:
   - Create `ServeDir::new(dist_path).not_found_service(ServeFile::new(dist_path.join("index.html")))`
   - Add as `.fallback_service()` on the Router
3. If `dist_path` does not exist:
   - Log `warn!("dist directory not found at {}, static file serving disabled", dist_path.display())`
   - Do not add fallback (unmatched routes return axum's default 404)

**Spec S02: AppDelegate onReady branching** {#s02-appdelegate-onready}

The `onReady` callback in `AppDelegate.swift` must branch on `devModeEnabled`:

```
if devModeEnabled:
    // Existing path: spawn Vite, wait for ready, load from Vite port
    spawnViteServer(sourceTree: path, tugcastPort: port, vitePort: vitePort, devMode: true)
    waitForViteReady { ... loadURL("http://127.0.0.1:\(vitePort)/auth?token=\(token)") }
    sendDevMode(enabled: true, sourceTree: path, vitePort: vitePort)
else:
    // New path: load directly from tugcast, no Vite
    loadURL("http://127.0.0.1:\(port)/auth?token=\(token)")
    sendDevMode(enabled: false, sourceTree: path, vitePort: vitePort)
```

The token is extracted from the auth URL the same way in both paths.

**Spec S03: control.rs origin fix** {#s03-origin-fix}

In `ControlReader::run_recv_loop`, the `DevMode { enabled: false, .. }` branch (around line 169-179 of `control.rs`) must change from:

```rust
// Current (wrong): always sets dev_port even when disabling
auth.lock().unwrap().set_dev_port(vite_port);
```

to:

```rust
// New (correct): clear dev_port when disabling dev mode
auth.lock().unwrap().set_dev_port(None);
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tower-http` (workspace dep) | Provides `ServeDir` and `ServeFile` for static file serving from disk |

#### New files (if any) {#new-files}

No new files. All changes are modifications to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `tower-http` | dependency | `tugcode/Cargo.toml` (workspace) | Add with `features = ["fs"]` |
| `tower-http` | dependency | `tugcode/crates/tugcast/Cargo.toml` | Add `tower-http = { workspace = true }` |
| `build_app` | fn (modify) | `tugcode/crates/tugcast/src/server.rs` | Accept source tree path, add `ServeDir` fallback conditionally |
| `run_server` | fn (modify) | `tugcode/crates/tugcast/src/server.rs` | Pass source tree path through to `build_app` |
| `set_dev_port(None)` | call site (modify) | `tugcode/crates/tugcast/src/control.rs` | Change disabled branch from `set_dev_port(vite_port)` to `set_dev_port(None)` |
| `onReady` callback | closure (modify) | `tugapp/Sources/AppDelegate.swift` | Add conditional: production loads from tugcast port, dev spawns Vite |
| `bridgeSetDevMode` | fn (modify) | `tugapp/Sources/AppDelegate.swift` | Update mode toggling to use correct port per mode |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify `build_app` creates correct router with/without dist/ | ServeDir fallback logic |
| **Integration** | Verify full serving pipeline: request to tugcast returns HTML from dist/ | End-to-end production mode |
| **Manual** | Verify visual rendering, HMR, mode toggling, control actions in running app | All phases |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add tower-http dependency to tugcast {#step-1}

**Commit:** `feat(tugcast): add tower-http dependency for static file serving`

**References:** [D01] ServeDir fallback, [D06] bun build tool, (#d01-servedir-fallback, #r02-tower-http-compat)

**Artifacts:**
- Modified `tugcode/Cargo.toml` (workspace dependencies)
- Modified `tugcode/crates/tugcast/Cargo.toml` (crate dependencies)

**Tasks:**
- [ ] Add `tower-http = { version = "0.6", features = ["fs"] }` to `[workspace.dependencies]` in `tugcode/Cargo.toml`
- [ ] Add `tower-http = { workspace = true }` to `[dependencies]` in `tugcode/crates/tugcast/Cargo.toml`
- [ ] Run `cargo build` from `tugcode/` to verify the dependency resolves and compiles cleanly

**Tests:**
- [ ] `cd tugcode && cargo build` compiles cleanly (dependency resolves without version conflicts)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | tail -5` shows successful build with no warnings
- [ ] `grep tower-http tugcode/Cargo.toml` shows the workspace dependency entry
- [ ] `grep tower-http tugcode/crates/tugcast/Cargo.toml` shows the crate dependency entry

---

#### Step 2: Add ServeDir fallback to tugcast router {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): serve frontend dist/ files via ServeDir fallback`

**References:** [D01] ServeDir fallback, Spec S01, Risk R01, (#s01-servedir-config, #r01-missing-dist, #internal-architecture)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/server.rs` -- `build_app` and `run_server` updated
- Modified `tugcode/crates/tugcast/src/main.rs` -- pass `watch_dir` to `run_server`
- Modified `tugcode/crates/tugcast/src/integration_tests.rs` -- update `build_test_app` helper and all direct `build_app` call sites to pass new source tree argument

**Tasks:**
- [ ] In `server.rs`, update `build_app` signature to accept an `Option<std::path::PathBuf>` for the source tree path
- [ ] Add `use tower_http::services::{ServeDir, ServeFile};` import
- [ ] In `build_app`, after creating the base router with `/auth`, `/ws`, `/api/tell` routes, conditionally add a `ServeDir` fallback:
  - Compute `dist_path = source_tree.join("tugdeck/dist")`
  - If `dist_path.is_dir()`: add `.fallback_service(ServeDir::new(&dist_path).not_found_service(ServeFile::new(dist_path.join("index.html"))))`
  - If not: `warn!("dist directory not found at {}, static file serving disabled", dist_path.display())`
- [ ] Update `run_server` to accept and forward the source tree path
- [ ] In `main.rs`, pass `watch_dir` (the already-resolved absolute path from lines 103-108) to `run_server` as the source tree path
- [ ] In `integration_tests.rs`, update the `build_test_app` helper (line 49) to pass `None` as the source tree argument to `build_app` (tests do not serve static files)
- [ ] In `integration_tests.rs`, update all 4 direct `build_app` call sites (lines 510, 562, 615, 677) to pass `None` as the source tree argument
- [ ] Update the module-level doc comment in `server.rs` to reflect that tugcast now serves static files in production mode
- [ ] Update the doc comment on `build_app` to describe the new fallback behavior
- [ ] Run `cargo fmt --all` and `cargo build`

**Tests:**
- [ ] All existing tests in `server.rs` and `integration_tests.rs` continue to pass (the `None` source tree argument disables the fallback, preserving current test behavior)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with no failures
- [ ] `cd tugcode && cargo build` compiles cleanly with no warnings

---

#### Step 3: Fix origin allowlist in control.rs {#step-3}

**Depends on:** #step-1

**Commit:** `fix(tugcast): set dev_port to None when disabling dev mode`

**References:** [D04] Origin allowlist, Spec S03, (#s03-origin-fix, #d04-origin-allowlist)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/control.rs` -- `DevMode { enabled: false }` handler updated

**Tasks:**
- [ ] In `control.rs`, locate the `DevMode { enabled: false }` branch in `run_recv_loop` (around line 169-179)
- [ ] Change `auth.lock().unwrap().set_dev_port(vite_port);` to `auth.lock().unwrap().set_dev_port(None);`
- [ ] Remove or update the comment that says "Always set vite_port in origin allowlist" -- replace with a comment explaining that in production mode, only the tugcast port is allowed
- [ ] Run `cargo fmt --all` and `cargo build`

**Tests:**
- [ ] Existing tests in `control.rs` and `auth.rs` continue to pass
- [ ] Verify that `AuthState::check_origin` with `dev_port = None` correctly rejects origins on port 55155 (covered by existing `test_origin_check_invalid`)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with no failures
- [ ] `grep "set_dev_port(None)" tugcode/crates/tugcast/src/control.rs` shows the fix in the disabled branch

---

#### Step 4: Update Swift code for dual-mode serving {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(tugapp): load from tugcast port in production mode, skip Vite`

**References:** [D02] Production port, [D03] Dev mode Vite, [D05] Extend AppDelegate, Spec S02, Table T01, (#s02-appdelegate-onready, #t01-serving-modes, #d02-production-port, #d03-dev-mode-vite, #d05-extend-appdelegate)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift` -- `onReady` callback and `bridgeSetDevMode` updated
- Modified `tugapp/Sources/ProcessManager.swift` -- doc comments updated to reflect dev-mode-only Vite usage

**Tasks:**
- [ ] In the `onReady` callback (around line 51-80), replace the unconditional Vite spawn with a conditional:
  - If `devModeEnabled`:
    - Keep existing code: `spawnViteServer(...)`, `waitForViteReady(...)`, load from Vite port, `sendDevMode(enabled: true, ...)`
  - Else (production):
    - Extract token from auth URL: `let token = url.components(separatedBy: "token=").dropFirst().first?.components(separatedBy: "&").first ?? ""`
    - Load directly from tugcast: `self.window.loadURL("http://127.0.0.1:\(port)/auth?token=\(token)")`
    - Send dev mode state: `self.processManager.sendDevMode(enabled: false, sourceTree: path, vitePort: self.vitePort)`
- [ ] In `bridgeSetDevMode`, replace the unconditional Vite-respawn-and-load logic with a conditional matching the following pseudocode:
  ```
  if enabled:
      // Dev mode ON — spawn Vite, wait, load from Vite port
      spawnViteServer(sourceTree: path, tugcastPort: currentTugcastPort,
                      vitePort: vitePort, devMode: true)
      waitForViteReady(port: vitePort) {
          loadURL("http://127.0.0.1:\(vitePort)/")
          sendDevMode(enabled: true, sourceTree: path, vitePort: vitePort)
          completion(enabled)
      }
  else:
      // Production mode — no Vite, load directly from tugcast
      loadURL("http://127.0.0.1:\(currentTugcastPort)/")
      sendDevMode(enabled: false, sourceTree: path, vitePort: vitePort)
      completion(enabled)
  ```
  Note: the existing `killViteServer()` call at the top of `bridgeSetDevMode` stays -- it runs before the branch to clean up any existing Vite process regardless of the new mode.
- [ ] Ensure the "Source Tree Required" guard at the top of `onReady` still triggers correctly (it applies to both modes since `sendDevMode` needs the source tree)
- [ ] Update comments in `AppDelegate.swift` to reflect the dual-mode architecture
- [ ] Update the doc comment on `spawnViteServer` in `ProcessManager.swift` to clarify it is only called in dev mode under the new architecture
- [ ] Update any doc comments in `ProcessManager.swift` that reference production Vite usage (e.g., the `spawnViteServer` doc currently mentions `vite preview` for production)
- [ ] Verify that all `spawnViteServer` call sites are gated on `devModeEnabled == true`

**Tests:**
- [ ] Xcode build succeeds with no errors (Swift compilation validates the new branching logic)
- [ ] `grep -n spawnViteServer tugapp/Sources/*.swift` confirms all call sites are inside `devModeEnabled` branches

**Checkpoint:**
- [ ] The Xcode project builds cleanly (`swift build` or Xcode build from tugapp/)
- [ ] Code review: verify the `onReady` callback has distinct production and dev branches
- [ ] Code review: verify `bridgeSetDevMode` has distinct production and dev branches
- [ ] Grep for `spawnViteServer` calls -- all call sites are gated on `devModeEnabled == true`

---

#### Step 5: Build dist and test production mode {#step-5}

**Depends on:** #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] ServeDir fallback, [D02] Production port, [D06] bun build tool, (#success-criteria, #t01-serving-modes, #r01-missing-dist)


**Tasks:**
- [ ] Build the frontend: `cd tugdeck && bun run build`
- [ ] Verify dist/ was created: `ls tugdeck/dist/index.html`
- [ ] Set production mode: `defaults write dev.tugtool.app DevModeEnabled -bool false`
- [ ] Launch the app via `just app` (or the standard launch method)
- [ ] Verify: grid appears, cards render in the WebView
- [ ] Verify: WebSocket connects to tugcast on port 55255 directly (check Web Inspector network tab)
- [ ] Verify: no disconnect banner appears
- [ ] Verify: no Vite process running (`lsof -i :55155` shows nothing)
- [ ] Verify: tugcast logs show the ServeDir fallback is active (look for absence of "dist directory not found" warning)

**Tests:**
- [ ] Manual: cards render in production mode WebView
- [ ] Manual: `lsof -i :55155` returns empty (no Vite process)

**Checkpoint:**
- [ ] Cards visually render in the WebView
- [ ] `lsof -i :55155` returns empty (no Vite process)
- [ ] WebSocket connection in Web Inspector shows `ws://127.0.0.1:55255/ws`

---

#### Step 6: Verify error visibility (Phase 1) {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #context)

**Tasks:**
- [ ] With the app running in production mode, open Web Inspector
- [ ] Confirm `diagnostic.js` log messages appear in the console
- [ ] Temporarily introduce a rendering error (e.g., throw in a component) and verify the ErrorBoundary renders a visible fallback UI
- [ ] Revert the temporary error
- [ ] Verify Web Inspector shows no unexpected console errors

**Tests:**
- [ ] Manual: ErrorBoundary renders fallback UI when a component throws
- [ ] Manual: diagnostic.js console messages visible in Web Inspector

**Checkpoint:**
- [ ] ErrorBoundary fallback UI is visible when a component throws
- [ ] diagnostic.js messages appear in Web Inspector console

---

#### Step 7: Verify dev mode and HMR (Phase 2) {#step-7}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [D03] Dev mode Vite, Table T01, (#success-criteria, #t01-serving-modes, #d03-dev-mode-vite)

**Tasks:**
- [ ] Toggle dev mode ON: `defaults write dev.tugtool.app DevModeEnabled -bool true`
- [ ] Launch the app
- [ ] Verify: Vite dev server starts on port 55155 (`lsof -i :55155` shows a process)
- [ ] Verify: cards render in the WebView
- [ ] Verify: Web Inspector console shows unbundled module names (not hashed `index-*.js`)
- [ ] Edit `tugdeck/styles/tokens.css` -- change a CSS custom property value, save
- [ ] Verify: change appears live in the WebView without a full page reload (HMR working)
- [ ] Verify: no stale Vite process issues

**Tests:**
- [ ] Manual: cards render in dev mode with Vite serving
- [ ] Manual: HMR hot-reload works (CSS edit appears without page refresh)

**Checkpoint:**
- [ ] Cards render with Vite serving the frontend
- [ ] CSS hot-reload works without page refresh
- [ ] `lsof -i :55155` shows the Vite dev server process

---

#### Step 8: Verify mode toggling (Phase 3) {#step-8}

**Depends on:** #step-5, #step-7

**Commit:** `N/A (verification only)`

**References:** [D02] Production port, [D03] Dev mode Vite, [D04] Origin allowlist, Table T01, (#success-criteria, #t01-serving-modes, #constraints)

**Tasks:**
- [ ] **Production to Dev:** Start in production mode. Verify cards render. Open Settings card and toggle dev mode ON (or use `defaults write dev.tugtool.app DevModeEnabled -bool true` as fallback). Verify: Vite starts on 55155, WebView reloads from Vite port, cards render, HMR works.
- [ ] **Session survives P->D:** Verify no re-auth is needed after the port change (cookie is host-scoped per RFC 6265).
- [ ] **Dev to Production:** Toggle dev mode OFF. Verify: Vite is killed, WebView reloads from tugcast port (55255), cards render, no Vite process.
- [ ] **Session survives D->P:** Verify no re-auth is needed after the port change.

**Tests:**
- [ ] Manual: Production-to-Dev transition renders cards and enables HMR
- [ ] Manual: Dev-to-Production transition renders cards with no Vite process
- [ ] Manual: session cookie persists across both transitions

**Checkpoint:**
- [ ] Both transitions (P->D and D->P) complete without errors
- [ ] Cards render correctly after each transition
- [ ] Session cookie persists across port changes (no re-auth dialog)

---

#### Step 9: Verify control actions in both modes (Phase 4) {#step-9}

**Depends on:** #step-8

**Commit:** `N/A (verification only)`

**References:** Table T02, (#success-criteria, #t02-control-actions)

**Tasks:**
- [ ] **Production mode -- Reload Frontend:** Trigger reload, verify page reloads from tugcast
- [ ] **Production mode -- Restart Server:** Trigger restart, verify tugcast restarts and frontend reconnects
- [ ] **Production mode -- Relaunch App:** Trigger relaunch, verify tugrelaunch rebuilds and restarts app
- [ ] **Production mode -- Reset Everything:** Trigger reset, verify localStorage cleared and fresh state
- [ ] **Dev mode -- Reload Frontend:** Trigger reload, verify page reloads from Vite
- [ ] **Dev mode -- Restart Server:** Trigger restart, verify tugcast restarts and Vite proxy reconnects
- [ ] **Dev mode -- Relaunch App:** Trigger relaunch, verify tugrelaunch rebuilds and restarts app
- [ ] **Dev mode -- Reset Everything:** Trigger reset, verify localStorage cleared and fresh state

**Tests:**
- [ ] Manual: all 4 control actions work in production mode
- [ ] Manual: all 4 control actions work in dev mode

**Checkpoint:**
- [ ] All 8 control action tests pass (4 actions x 2 modes)
- [ ] No orphaned processes after any control action

---

#### Step 10: Final Integration Checkpoint {#step-10}

**Depends on:** #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] ServeDir fallback, [D02] Production port, [D03] Dev mode Vite, [D04] Origin allowlist, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria from the Phase Overview are met
- [ ] Verify no regressions: `cd tugcode && cargo nextest run` passes
- [ ] Verify no warnings: `cd tugcode && cargo build` is clean
- [ ] Review all code changes for completeness and correctness

**Tests:**
- [ ] `cd tugcode && cargo nextest run` -- all automated tests pass
- [ ] All 5 success criteria from Phase Overview confirmed manually

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass
- [ ] `cd tugcode && cargo build` -- no warnings
- [ ] All 5 success criteria confirmed

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A production frontend serving architecture where tugcast serves pre-built static files directly via tower-http::ServeDir, with Vite reserved exclusively for dev mode HMR, and seamless mode toggling between the two.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Cards render in production mode served by tugcast with no Vite process (`lsof -i :55155` empty)
- [ ] Cards render in dev mode served by Vite with HMR working (CSS hot-reload, unbundled modules)
- [ ] Mode toggling works in a running app via Settings card and `defaults write` (both directions, session preserved)
- [ ] All four control actions work in both modes (8 tests pass)
- [ ] ErrorBoundary shows visible fallback UI on rendering errors
- [ ] `cd tugcode && cargo nextest run` passes with no failures or warnings
- [ ] `cd tugcode && cargo build` compiles cleanly with no warnings

**Acceptance tests:**
- [ ] Production mode: launch with `DevModeEnabled = false`, verify cards render, verify `lsof -i :55155` returns empty
- [ ] Dev mode: launch with `DevModeEnabled = true`, verify cards render, verify HMR (edit CSS token, see live update)
- [ ] Mode toggle: start production, toggle to dev, toggle back to production -- cards render at each stage, no re-auth
- [ ] Control actions: Reload Frontend and Restart Server in both modes (4 tests minimum)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Remove `package-lock.json` from `tugdeck/` (cleanup, per [Q01])
- [ ] Remove the `vite preview` code path from `ProcessManager.spawnViteServer` (dead code under new architecture)
- [ ] Add automated integration tests for the two serving modes
- [ ] Consider removing the `preview.proxy` configuration from `vite.config.ts` (no longer used in production)

| Checkpoint | Verification |
|------------|--------------|
| tower-http builds | `cd tugcode && cargo build` succeeds |
| ServeDir serves files | Production mode renders cards from dist/ |
| Origin fix correct | Production WebSocket connects without origin rejection |
| No Vite in production | `lsof -i :55155` returns empty when `DevModeEnabled = false` |
| HMR in dev mode | CSS edit in `tokens.css` hot-reloads without page refresh |
| Mode toggling | Both P->D and D->P transitions work with session preserved |
| Control actions | All 8 tests pass (4 actions x 2 modes) |
