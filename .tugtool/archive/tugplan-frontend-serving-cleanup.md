<!-- tugplan-skeleton v2 -->

## Frontend Serving Cleanup {#frontend-serving-cleanup}

**Purpose:** Remove static asset serving from tugcast so it is exclusively a feed broadcaster, auth handler, and API endpoint. Make Vite the single frontend server in all modes (dev and non-dev), eliminating the multi-path URL loading logic and the embedded asset pipeline.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | frontend-serving-cleanup |
| Last updated | 2026-02-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

tugcast has become a static file server. It embeds the entire tugdeck production build via `rust-embed` and serves HTML, CSS, and JavaScript through a fallback HTTP route. This is architecturally wrong -- tugcast is a feed broadcaster that serves tugfeeds via WebSocket, handles auth, and accepts API commands. It should not serve web pages.

There are currently three different paths for loading the frontend depending on mode: non-dev mode loads from tugcast's embedded assets, dev mode (success) loads from a Vite dev server, and dev mode (failure) falls back to tugcast. This complexity causes bugs like the empty-window regression after the React Foundation Cleanup merge. The fix is simple: Vite serves the frontend, always. tugcast serves feeds, always.

#### Strategy {#strategy}

- Strip tugcast's frontend build pipeline (build.rs), embedded asset serving (server.rs), and rust-embed dependency first, since these are the largest deletions and establish the new boundary.
- Add `preview.proxy` to `vite.config.ts` so `vite preview` proxies backend routes the same way `vite` dev server does.
- Unify the Swift app's URL loading to always spawn Vite and load from the Vite port -- no branching on dev/non-dev for URL construction.
- Unify tugtool's `spawn_vite_dev` into a single `spawn_vite` that runs either `vite` (dev mode) or `vite preview` (non-dev mode). tugtool always runs in dev mode since it is a developer tool.
- Implement runtime dev mode toggle in the Swift app: when `bridgeSetDevMode` is called, kill the running Vite process and respawn in the correct mode.
- Handle the "no source tree" case by showing an error window/alert instead of loading a blank page.
- Clean up the justfile to remove stale Vite kill lines while keeping the `bun run build` step as the explicit production build trigger.

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build -p tugcast` succeeds without `rust-embed` in the dependency tree (`cargo tree -p tugcast | grep rust-embed` returns empty)
- tugcast's `build.rs` contains zero references to `tugdeck`, `bun run build`, or `copy_dir_recursive`
- `server.rs` contains no `Assets` struct, no `serve_asset` function, no `content_type_for` function, and no `.fallback(serve_asset)`
- The Swift app always loads from the Vite port (port 5173) regardless of dev mode setting
- `vite preview --port 5173` with `TUGCAST_PORT=55255` proxies `/auth`, `/ws`, `/api` to tugcast
- `just app` successfully builds and launches the app with Vite serving the frontend
- All existing Rust tests pass (`cargo nextest run --workspace`)
- Toggling dev mode at runtime via the Settings card kills the old Vite process and spawns a new one in the correct mode

#### Scope {#scope}

1. Remove the tugdeck build pipeline from `tugcode/crates/tugcast/build.rs` (keep tugtalk compilation)
2. Remove `Assets`, `serve_asset`, `content_type_for`, `.fallback(serve_asset)`, and related tests from `tugcode/crates/tugcast/src/server.rs`
3. Remove `rust-embed` from `tugcode/crates/tugcast/Cargo.toml` and `tugcode/Cargo.toml`
4. Add `preview.proxy` block to `tugdeck/vite.config.ts`; change `emptyOutDir` from `false` to `true`
5. Simplify `tugapp/Sources/AppDelegate.swift`: remove dev/non-dev URL branching, `awaitingDevModeResult`, `onDevModeResult` callback; always spawn Vite and load from Vite port
6. Unify `spawnViteDevServer` into `spawnViteServer(devMode:)` in `tugapp/Sources/ProcessManager.swift`
7. Replace `spawn_vite_dev` with unified `spawn_vite` in `tugcode/crates/tugtool/src/main.rs`; remove `rewrite_auth_url_to_vite_port` and its tests
8. Implement runtime dev mode toggle: kill and respawn Vite when dev mode is toggled via `bridgeSetDevMode`
9. Show error alert when Vite cannot start (no source tree set)
10. Clean up `justfile`: remove `lsof`/`kill` lines from `app` recipe

#### Non-goals (Explicitly out of scope) {#non-goals}

- Distribution packaging (bundling dist/ and a static server in the .app for users without source trees)
- Consolidating `/api/tell` onto the control socket
- Removing or changing the dev notification protocol (reloaded, restart_available, relaunch_available)
- Changing the three-watcher model in tugcast's dev.rs
- Adding new CLI flags to tugtool (it always runs vite dev mode)

#### Dependencies / Prerequisites {#dependencies}

- `bun` must be installed (for `bun install` and `bun run build`)
- `node_modules/.bin/vite` must exist in `tugdeck/` (established by `bun install`)
- The control socket infrastructure (UDS) must be functional for `sendDevMode` calls

#### Constraints {#constraints}

- tugcast's `build.rs` must still compile the tugtalk binary; only the tugdeck pipeline is removed
- The Vite port (5173) and tugcast port (55255) constants are defined in `tugcast-core` (`DEFAULT_VITE_DEV_PORT`) and `TugConfig.swift` (`defaultVitePort`); these are not changed
- Warnings are errors (`-D warnings` in `.cargo/config.toml`); all dead code must be removed, not just commented out

#### Assumptions {#assumptions}

- `rust-embed` is only used in tugcast -- safe to remove from both `tugcast/Cargo.toml` and workspace `Cargo.toml`
- The `copy_dir_recursive` helper in `build.rs` (lines 6-29) is only used by the tugdeck pipeline and will be removed
- The `rewrite_auth_url_to_vite_port` function and its tests in `tugtool/src/main.rs` will be deleted entirely (no longer needed since we always use the Vite port)
- Only `test_assets_index_exists` in `server.rs` references `Assets::get` and needs removal; `test_tell_request_deserialization` does NOT reference `Assets` and stays
- Two integration tests in `integration_tests.rs` (`test_static_index` and `test_build_app_production_mode`) exercise the `.fallback(serve_asset)` route by requesting `GET /` and asserting `200 OK` with `text/html`; both must be removed
- The `lsof`/`kill` lines in the justfile `app` recipe are removed; the `bun run build` step stays as the explicit production build trigger
- The `sendDevMode` call in tugtool supervisor loop still fires after every tugcast ready (to activate file watchers) -- decoupled from URL loading but not removed
- The `awaitingDevModeResult` flag and `onDevModeResult` callback in `AppDelegate.swift` are fully removed since URL loading no longer waits for `dev_mode_result`

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Vite preview requires pre-built dist/ (DECIDED) {#q01-dist-prebuilt}

**Question:** When the app runs in non-dev mode (vite preview), `dist/` must exist. Who ensures it is built?

**Why it matters:** If `dist/` is missing, `vite preview` serves nothing and the user sees a blank page.

**Options (if known):**
- The `just app` recipe runs `bun run build` before launching (already does this)
- The Swift app detects missing `dist/` and runs the build itself
- The user is expected to run `bun run build` manually

**Plan to resolve:** The `just app` recipe already runs `bun run build`. This is the only place the production build happens. No additional automation needed.

**Resolution:** DECIDED (see [D04])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Vite process dies unexpectedly | high | low | Log warning; user can restart via Developer menu | Repeated crashes in testing |
| `dist/` missing for non-dev mode | med | low | `just app` always runs `bun run build` first; Vite preview shows clear error | User reports blank page in non-dev |
| Race between Vite kill/respawn on dev mode toggle | med | low | Synchronous kill (waitUntilExit) before respawn | Toggle causes blank page |

**Risk R01: Vite process crash** {#r01-vite-crash}

- **Risk:** The Vite dev server or preview server crashes or fails to start, leaving the user with no frontend.
- **Mitigation:**
  - `waitForViteReady` already polls with timeout and logs failure
  - The Developer menu provides Restart Server and Relaunch App options
  - The `--strictPort` flag ensures Vite fails fast on port conflicts rather than silently binding elsewhere
- **Residual risk:** User must manually intervene if Vite crashes; no automatic Vite restart.

**Risk R02: Dev mode toggle race condition** {#r02-toggle-race}

- **Risk:** Rapid dev mode toggling could kill Vite before the new process starts, or leave two Vite processes running.
- **Mitigation:**
  - Use synchronous `waitUntilExit()` on the old process before spawning the new one
  - The duplication guard in `spawnViteServer` checks `viteProcess?.isRunning` before spawning
- **Residual risk:** Very rapid toggling (faster than process teardown) could temporarily leave no frontend. User can use Reload Frontend to recover.

---

### Design Decisions {#design-decisions}

#### [D01] Remove all static asset serving from tugcast (DECIDED) {#d01-remove-asset-serving}

**Decision:** Delete the `Assets` struct (rust-embed), `serve_asset`, `content_type_for`, and the `.fallback(serve_asset)` route from tugcast's server.rs. Unmatched routes return 404 with no body.

**Rationale:**
- tugcast's role is feed broadcasting, auth, and API commands -- not serving web pages
- The embedded asset pipeline adds build complexity (build.rs runs `bun install` and `bun run build` during `cargo build`)
- Three serving paths (embedded, Vite dev, Vite proxy fallback) caused the empty-window regression

**Implications:**
- `rust-embed` dependency removed from tugcast and workspace Cargo.toml
- `copy_dir_recursive` helper in build.rs removed (only used by tugdeck pipeline)
- `content_type_for` tests removed along with the function
- `test_assets_index_exists` test removed (references `Assets::get`)
- tugcast's build.rs only compiles tugtalk after this change

#### [D02] Vite is the single frontend server in all modes (DECIDED) {#d02-vite-single-server}

**Decision:** The browser always loads from Vite. In dev mode, Vite runs as `vite` (HMR, live transforms). In non-dev mode, Vite runs as `vite preview` (serves pre-built dist/). Both use the same port, same proxy config, same URL.

**Rationale:**
- One serving path eliminates the branching logic that caused regressions
- `vite preview` is Vite's built-in production preview server -- no custom static file server needed
- The proxy configuration (`/auth`, `/ws`, `/api` to tugcast) is shared between both modes via `vite.config.ts`

**Implications:**
- `vite.config.ts` gains a `preview.proxy` block identical to `server.proxy`
- The Swift app and tugtool always construct URLs with the Vite port
- No fallback to tugcast for serving; if Vite is down, the frontend is down

#### [D03] Unified Vite spawning with mode parameter (DECIDED) {#d03-unified-vite-spawn}

**Decision:** Replace `spawnViteDevServer` (Swift) and `spawn_vite_dev` (Rust) with unified methods that accept a `devMode` boolean. When `devMode` is true, spawn `vite` with dev server flags. When false, spawn `vite preview`.

**Rationale:**
- A single spawn method eliminates divergent code paths for dev vs. non-dev
- The only difference between modes is the Vite CLI arguments (`preview` flag)
- Both modes share the same port, env vars (TUGCAST_PORT), and process lifecycle

**Implications:**
- Swift: `spawnViteDevServer(sourceTree:tugcastPort:vitePort:)` becomes `spawnViteServer(sourceTree:tugcastPort:vitePort:devMode:)`
- Rust: `spawn_vite_dev(source_tree, tugcast_port, vite_port)` becomes `spawn_vite(source_tree, tugcast_port, vite_port)` (always dev mode in tugtool)
- tugtool always passes dev mode since it is a developer tool; no flag needed

#### [D04] `just app` recipe owns the production build (DECIDED) {#d04-just-app-prod-build}

**Decision:** The `bun run build` step in the `just app` recipe is the single place the production frontend is built. `vite preview` requires `dist/` to exist; `just app` ensures it does.

**Rationale:**
- With the build.rs pipeline removed, `cargo build` no longer triggers a frontend build
- `just app` already runs `bun run build`; this was previously redundant but is now the only trigger
- Keeping the build in the justfile recipe (not in the Swift app) keeps the app startup fast

**Implications:**
- If a user runs the app without `just app` (e.g., direct Xcode build + run), `dist/` may be stale or missing
- Non-dev mode specifically requires `dist/` to exist; dev mode does not (Vite transforms on the fly)

#### [D05] Runtime dev mode toggle kills and respawns Vite (DECIDED) {#d05-runtime-toggle}

**Decision:** When `bridgeSetDevMode` is called at runtime, the Swift app kills the current Vite process (synchronous `waitUntilExit()`) and respawns it in the correct mode (dev or preview). The WebView is then reloaded from the same Vite port.

**Rationale:**
- Dev mode and non-dev mode require different Vite invocations (`vite` vs. `vite preview`)
- A synchronous kill-then-spawn ensures no two Vite processes compete for the same port
- The user expects the toggle to take effect immediately

**Implications:**
- Brief frontend downtime during the kill/respawn cycle (fraction of a second)
- The WebView reloads after Vite is ready, which may lose frontend state
- `sendDevMode` is still called to tugcast to enable/disable file watchers (decoupled from URL loading)

#### [D06] Error alert when Vite cannot start (DECIDED) {#d06-error-alert}

**Decision:** When Vite is required but cannot start (e.g., no source tree is set, or the vite binary is missing), the Swift app shows an error alert/window explaining the problem. It does not silently show a blank page or fall back to tugcast.

**Rationale:**
- The old fallback-to-tugcast path is removed; there is no silent degradation path
- A clear error message is better than a blank window
- The error should guide the user to set a source tree via the Developer menu

**Implications:**
- `AppDelegate.processManager.onReady` must check for source tree availability before spawning Vite
- If no source tree, show an NSAlert explaining the issue and how to fix it (Developer > Choose Source Tree)

#### [D07] Remove rewrite_auth_url_to_vite_port from tugtool (DECIDED) {#d07-remove-url-rewrite}

**Decision:** Delete the `rewrite_auth_url_to_vite_port` function and all its tests from `tugtool/src/main.rs`. Instead, construct the browser URL directly with the Vite port.

**Rationale:**
- With Vite as the single serving path, there is no need to rewrite tugcast's auth URL
- The auth URL from tugcast still uses the tugcast port, but the browser URL is simply constructed with the Vite port
- Removing the function eliminates dead code (warnings are errors)

**Implications:**
- Two test functions deleted: `test_rewrite_auth_url_to_vite_port`, `test_rewrite_auth_url_to_vite_port_non_default_vite_port`
- The browser URL construction in `supervisor_loop` becomes a simple format string using the Vite port

---

### Specification {#specification}

#### Vite Configuration {#vite-config-spec}

**Spec S01: vite.config.ts proxy configuration** {#s01-vite-proxy}

The `vite.config.ts` file must have both `server.proxy` and `preview.proxy` blocks with identical configuration. The proxy routes are:

| Route | Target | WebSocket |
|-------|--------|-----------|
| `/auth` | `http://localhost:${tugcastPort}` | No |
| `/ws` | `ws://localhost:${tugcastPort}` | Yes |
| `/api` | `http://localhost:${tugcastPort}` | No |

The `tugcastPort` is read from `TUGCAST_PORT` env var, defaulting to `55255`.

The `build.emptyOutDir` setting is changed from `false` to `true`.

#### Swift App Vite Lifecycle {#swift-vite-lifecycle}

**Spec S02: Vite spawn protocol** {#s02-vite-spawn}

The `spawnViteServer` method accepts a `devMode` parameter:

| Parameter | Type | Description |
|-----------|------|-------------|
| `sourceTree` | `String` | Path to mono-repo root |
| `tugcastPort` | `Int` | Port tugcast is listening on |
| `vitePort` | `Int` | Port for Vite to bind to |
| `devMode` | `Bool` | If true, run `vite`; if false, run `vite preview` |

Dev mode arguments: `["--host", "127.0.0.1", "--port", "{vitePort}", "--strictPort"]`

Non-dev mode arguments: `["preview", "--host", "127.0.0.1", "--port", "{vitePort}", "--strictPort"]`

Both modes set `TUGCAST_PORT` env var.

**Spec S03: Runtime toggle protocol** {#s03-runtime-toggle}

When `bridgeSetDevMode(enabled:)` is called:

1. Kill existing Vite process (`viteProcess.terminate()` + `waitUntilExit()`)
2. Set `viteProcess = nil`
3. If source tree is available:
   a. Call `spawnViteServer(sourceTree:tugcastPort:vitePort:devMode:enabled)`
   b. Call `waitForViteReady(port:)`, then reload the WebView
4. Send `devMode` to tugcast via control socket (for file watchers, decoupled from URL loading)
5. If source tree is not available and enabling, show error alert per [D06]

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to remove {#symbols-to-remove}

**Table T01: Symbols removed from tugcast** {#t01-tugcast-removals}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Assets` | struct (derive) | `tugcode/crates/tugcast/src/server.rs` | `#[derive(RustEmbed)]` |
| `content_type_for` | fn | `tugcode/crates/tugcast/src/server.rs` | Content-type detection |
| `serve_asset` | fn | `tugcode/crates/tugcast/src/server.rs` | Static asset handler |
| `.fallback(serve_asset)` | method call | `tugcode/crates/tugcast/src/server.rs` | Router fallback |
| `test_content_type_*` | tests (5) | `tugcode/crates/tugcast/src/server.rs` | All content_type_for tests |
| `test_assets_index_exists` | test | `tugcode/crates/tugcast/src/server.rs` | References `Assets::get` |
| `test_static_index` | test | `tugcode/crates/tugcast/src/integration_tests.rs` | Sends `GET /`, asserts embedded HTML response |
| `test_build_app_production_mode` | test | `tugcode/crates/tugcast/src/integration_tests.rs` | Same pattern as `test_static_index` |
| `copy_dir_recursive` | fn | `tugcode/crates/tugcast/build.rs` | Only used by tugdeck pipeline |
| `use std::fs` | import | `tugcode/crates/tugcast/build.rs` | No remaining `fs::` usage after removals |
| `tugdeck_dir` | variable | `tugcode/crates/tugcast/build.rs` | Dead after tugdeck pipeline removal |
| `use rust_embed::RustEmbed` | import | `tugcode/crates/tugcast/src/server.rs` | No longer needed |
| `rust-embed` | dependency | `tugcode/crates/tugcast/Cargo.toml` | Workspace dependency |
| `rust-embed` | workspace dep | `tugcode/Cargo.toml` | Only used by tugcast |

**Table T02: Symbols removed from tugtool** {#t02-tugtool-removals}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `rewrite_auth_url_to_vite_port` | fn | `tugcode/crates/tugtool/src/main.rs` | URL port rewriting |
| `spawn_vite_dev` | fn | `tugcode/crates/tugtool/src/main.rs` | Replaced by `spawn_vite` |
| `test_rewrite_auth_url_to_vite_port` | test | `tugcode/crates/tugtool/src/main.rs` | Tests removed function |
| `test_rewrite_auth_url_to_vite_port_non_default_vite_port` | test | `tugcode/crates/tugtool/src/main.rs` | Tests removed function |

**Table T03: Symbols removed from Swift app** {#t03-swift-removals}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `awaitingDevModeResult` | property | `tugapp/Sources/AppDelegate.swift` | Dev mode result gate flag |
| `onDevModeResult` | callback | `tugapp/Sources/AppDelegate.swift` (set), `ProcessManager.swift` (declared) | URL gating callback |
| `spawnViteDevServer` | method | `tugapp/Sources/ProcessManager.swift` | Replaced by `spawnViteServer` |

#### Symbols to add / modify {#symbols}

**Table T04: New and modified symbols** {#t04-new-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `spawnViteServer(sourceTree:tugcastPort:vitePort:devMode:)` | method | `tugapp/Sources/ProcessManager.swift` | Replaces `spawnViteDevServer`, adds `devMode` param |
| `spawn_vite` | fn | `tugcode/crates/tugtool/src/main.rs` | Replaces `spawn_vite_dev`, always uses dev mode |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify Rust functions compile and pass without `rust-embed` | After removing asset serving |
| **Integration** | Verify `cargo build -p tugcast` succeeds without `rust-embed` | After dependency removal |
| **Manual** | Verify app launches with Vite serving frontend in both modes | After Swift app changes |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add preview proxy to vite.config.ts {#step-1}

**Commit:** `feat: add preview.proxy to vite.config.ts for vite preview mode`

**References:** [D02] Vite is the single frontend server, Spec S01, (#vite-config-spec)

**Artifacts:**
- `tugdeck/vite.config.ts` -- modified to add `preview.proxy` block and change `emptyOutDir` to `true`

**Tasks:**
- [ ] Extract the proxy config into a shared `proxyConfig` variable
- [ ] Add `preview: { proxy: proxyConfig }` alongside the existing `server: { proxy: proxyConfig }`
- [ ] Change `build.emptyOutDir` from `false` to `true`

**Tests:**
- [ ] Verify `vite.config.ts` has no syntax errors: `cd tugdeck && node -e "require('./vite.config.ts')"` or simply confirm the file parses by checking `grep` results below (full validation occurs in Step 2 when `cargo build` triggers build.rs which uses the Vite toolchain)

**Checkpoint:**
- [ ] `grep -c 'preview' tugdeck/vite.config.ts` returns at least 1
- [ ] `grep 'emptyOutDir: true' tugdeck/vite.config.ts` matches
- [ ] `grep -c 'proxyConfig' tugdeck/vite.config.ts` returns at least 3 (definition + server + preview)

---

#### Step 2: Strip tugcast of static asset serving {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: remove static asset serving and rust-embed from tugcast`

**References:** [D01] Remove all static asset serving, Table T01, (#assumptions)

**Artifacts:**
- `tugcode/crates/tugcast/src/server.rs` -- remove `Assets`, `serve_asset`, `content_type_for`, `.fallback(serve_asset)`, `use rust_embed::RustEmbed`, all `test_content_type_*` tests, and `test_assets_index_exists`
- `tugcode/crates/tugcast/src/integration_tests.rs` -- remove `test_static_index` and `test_build_app_production_mode` (both send `GET /` and assert `200 OK` with `text/html`, which will fail after removing the fallback)
- `tugcode/crates/tugcast/build.rs` -- remove `copy_dir_recursive` function, tugdeck build pipeline (bun check, bun install, bun run build, dist copy), and tugdeck `rerun-if-changed` directives; keep tugtalk compilation and tugtalk `rerun-if-changed` directives
- `tugcode/crates/tugcast/Cargo.toml` -- remove `rust-embed = { workspace = true }` line
- `tugcode/Cargo.toml` -- remove `rust-embed` from workspace dependencies

**Tasks:**
- [ ] In `server.rs`: remove the `use rust_embed::RustEmbed;` import
- [ ] In `server.rs`: remove the `#[derive(RustEmbed)] #[folder = ...] struct Assets;` block (lines 21-24)
- [ ] In `server.rs`: remove the `content_type_for` function (lines 43-63)
- [ ] In `server.rs`: remove the `serve_asset` function (lines 138-158)
- [ ] In `server.rs`: remove `.fallback(serve_asset)` from the router in `build_app` (line 172)
- [ ] In `server.rs`: remove the `use axum::http::{..., Uri, header}` items that are now unused (`Uri` and `header`)
- [ ] In `server.rs`: update the module doc comment to remove references to static asset serving
- [ ] In `server.rs` tests: remove `test_content_type_html`, `test_content_type_js`, `test_content_type_css`, `test_content_type_unknown`, `test_content_type_woff2`, and `test_assets_index_exists`
- [ ] In `server.rs`: update the `build_app` function doc comment (currently says "static asset routes") to reflect that tugcast only serves auth, WebSocket, and API routes
- [ ] In `integration_tests.rs`: remove `test_static_index` (sends `GET /` and asserts `200 OK` with `text/html` -- will fail after fallback removal)
- [ ] In `integration_tests.rs`: remove `test_build_app_production_mode` (same pattern as `test_static_index` -- sends `GET /` and asserts embedded asset response)
- [ ] In `build.rs`: remove the `copy_dir_recursive` function (lines 6-29)
- [ ] In `build.rs`: remove the `use std::fs;` import (line 2) -- after removing `copy_dir_recursive` and the `tugdeck_out` creation, nothing in the file references `std::fs`; the unused import will cause a `-D warnings` build failure
- [ ] In `build.rs`: remove the tugdeck-specific items from `main()`: the `tugdeck_out` variable and `fs::create_dir_all(&tugdeck_out)`, the `tugdeck_dir` variable (line 45), the `dist_dir` variable (line 79), the bun version check (`Command::new("bun").arg("--version")`), the bun install for tugdeck, the `bun run build` invocation, and the `copy_dir_recursive(&dist_dir, &tugdeck_out)` call. **Preserve** the `out_dir`, `manifest_dir`, and `repo_root` variables, as they are needed by the tugtalk compilation that follows
- [ ] In `build.rs`: remove the tugdeck `rerun-if-changed` directives for `vite.config.ts`, `index.html`, `src/`, and `package.json`. **Preserve** the tugtalk `rerun-if-changed` directives for `tugtalk/src/` and `tugtalk/package.json`
- [ ] In `build.rs`: verify `main()` flows cleanly from variable setup into tugtalk compilation with no dead code
- [ ] In `tugcode/crates/tugcast/Cargo.toml`: remove `rust-embed = { workspace = true }` from `[dependencies]`
- [ ] In `tugcode/Cargo.toml`: remove the `rust-embed` line from `[workspace.dependencies]`
- [ ] Run `cargo fmt --all` from the `tugcode/` directory

**Tests:**
- [ ] `cargo tree -p tugcast | grep rust-embed` returns empty (no rust-embed in dependency tree)
- [ ] All remaining tests in tugcast pass

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast`
- [ ] `cd tugcode && cargo nextest run -p tugcast`

---

#### Step 3: Unify tugtool Vite spawning and remove URL rewriting {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: unify tugtool vite spawning and remove URL port rewriting`

**References:** [D03] Unified Vite spawning, [D07] Remove rewrite_auth_url_to_vite_port, Table T02, (#assumptions)

**Artifacts:**
- `tugcode/crates/tugtool/src/main.rs` -- rename `spawn_vite_dev` to `spawn_vite` (unchanged behavior since tugtool always runs dev mode); delete `rewrite_auth_url_to_vite_port` and its tests; simplify browser URL construction in `supervisor_loop` to always use Vite port; make source tree required (exit with error if not found)

**Tasks:**
- [ ] Rename `spawn_vite_dev` to `spawn_vite` (keeping the same arguments and behavior)
- [ ] Update the doc comment on `spawn_vite` to reflect that tugtool always runs Vite in dev mode
- [ ] Update the call site in `supervisor_loop` from `spawn_vite_dev` to `spawn_vite`
- [ ] Delete the `rewrite_auth_url_to_vite_port` function entirely
- [ ] Simplify the `browser_url` construction in `supervisor_loop`: instead of calling `rewrite_auth_url_to_vite_port`, directly construct the URL using `format!("http://127.0.0.1:{}/auth?token={}", vite_port, token)` or extract the token from `auth_url` and build the Vite URL
- [ ] Handle `source_tree=None` as a fatal error: after tugcast's embedded assets are removed, tugtool cannot serve any frontend without Vite, and Vite requires a source tree. Change the auto-detect failure path in `main()` from a `warn!` (continue without dev mode) to an `eprintln!` + `std::process::exit(1)`, since running without a source tree will result in a 404 page
- [ ] Delete test functions: `test_rewrite_auth_url_to_vite_port` and `test_rewrite_auth_url_to_vite_port_non_default_vite_port`
- [ ] Run `cargo fmt --all` from the `tugcode/` directory

**Tests:**
- [ ] All remaining tugtool tests pass
- [ ] No references to `rewrite_auth_url_to_vite_port` remain in the codebase

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool`
- [ ] `cd tugcode && cargo nextest run -p tugtool`

---

#### Step 4: Unify Swift app Vite spawning {#step-4}

**Depends on:** #step-2

**Commit:** `refactor: unify Swift Vite spawning with devMode parameter`

**References:** [D03] Unified Vite spawning, Spec S02, Table T03, Table T04, (#swift-vite-lifecycle)

**Artifacts:**
- `tugapp/Sources/ProcessManager.swift` -- rename `spawnViteDevServer` to `spawnViteServer` with new `devMode: Bool` parameter; in non-dev mode, prepend `"preview"` to the arguments list
- `tugapp/Sources/AppDelegate.swift` -- update call site from `spawnViteDevServer` to `spawnViteServer`

**Tasks:**
- [ ] In `ProcessManager.swift`: rename `spawnViteDevServer(sourceTree:tugcastPort:vitePort:)` to `spawnViteServer(sourceTree:tugcastPort:vitePort:devMode:)`
- [ ] In `ProcessManager.swift`: add the `devMode: Bool` parameter; when `devMode` is false, set arguments to `["preview", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"]`; when true, keep existing arguments `["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"]`
- [ ] Update doc comment to explain both modes
- [ ] In `AppDelegate.swift`: update the `spawnViteDevServer` call to `spawnViteServer(..., devMode: self.devModeEnabled)`

**Tests:**
- [ ] Swift project builds: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds with no errors

---

#### Step 5: Simplify AppDelegate URL loading {#step-5}

**Depends on:** #step-4

**Commit:** `refactor: simplify AppDelegate to always load from Vite port`

**References:** [D02] Vite is the single frontend server, [D06] Error alert when Vite cannot start, Spec S03, Table T03, (#assumptions)

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` -- remove `awaitingDevModeResult`, `onDevModeResult` callback, dev/non-dev URL branching in `onReady`; always spawn Vite and load from Vite port; add error alert when no source tree

**Tasks:**
- [ ] Remove `private var awaitingDevModeResult: Bool = false` property
- [ ] Rewrite `processManager.onReady` closure: remove the `if devEnabled` / `else` branch; instead, always check if source tree is available; if available, call `spawnViteServer(...)` with `devMode: self.devModeEnabled`, then `waitForViteReady`, then load from Vite port URL; if no source tree, show `NSAlert` explaining that a source tree is required and guiding the user to Developer > Choose Source Tree
- [ ] Remove the `processManager.onDevModeResult` callback assignment entirely from `AppDelegate.swift`
- [ ] Keep `processManager.onDevModeError` (still useful for reporting dev mode errors from tugcast)
- [ ] After Vite is ready and URL is loaded, still call `sendDevMode` to activate tugcast file watchers (decoupled from URL loading)
- [ ] In `ProcessManager.swift`: remove the `onDevModeResult` property declaration (`var onDevModeResult: ((Bool) -> Void)?`)
- [ ] In `ProcessManager.swift`: update the `dev_mode_result` case in `handleControlMessage` -- remove the `onDevModeResult?(success)` call (line 257). Keep the `if !success` block that calls `onDevModeError?(errorMessage)` so dev mode errors are still reported to the UI

**Tests:**
- [ ] Swift project builds: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds
- [ ] No references to `awaitingDevModeResult` or `onDevModeResult` remain in Swift sources

---

#### Step 6: Implement runtime dev mode toggle {#step-6}

**Depends on:** #step-5

**Commit:** `feat: runtime dev mode toggle kills and respawns Vite in correct mode`

**References:** [D05] Runtime toggle, Spec S03, Risk R02, (#swift-vite-lifecycle)

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` -- update `bridgeSetDevMode` to kill current Vite, respawn in correct mode, reload WebView
- `tugapp/Sources/ProcessManager.swift` -- add `killViteServer()` method for clean Vite termination

**Tasks:**
- [ ] In `ProcessManager.swift`: add a `killViteServer()` method that calls `viteProcess?.terminate()`, `viteProcess?.waitUntilExit()`, sets `viteProcess = nil`
- [ ] In `AppDelegate.swift`: update `bridgeSetDevMode(enabled:completion:)` to: (1) call `processManager.killViteServer()`; (2) if enabling and source tree available, call `spawnViteServer(devMode: enabled)` then `waitForViteReady` then reload WebView via `window.loadURL(...)`; (3) if disabling and source tree available, spawn `spawnViteServer(devMode: false)` then wait and reload; (4) if no source tree and enabling, show error alert; (5) always call `sendDevMode` to tugcast for file watcher control
- [ ] Ensure the completion handler is called after the toggle is complete

**Tests:**
- [ ] Swift project builds without errors

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds

---

#### Step 7: Clean up justfile {#step-7}

**Depends on:** #step-2

**Commit:** `chore: remove stale Vite kill lines from justfile app recipe`

**References:** [D04] just app recipe owns the production build, (#assumptions)

**Artifacts:**
- `justfile` -- remove the `lsof`/`kill` lines that clean up stale Vite processes on port 5173

**Tasks:**
- [ ] Remove the line `lsof -ti :{{VITE_DEV_PORT}} | xargs kill 2>/dev/null || true` from the `app` recipe
- [ ] Verify the `bun run build` step remains in the `app` recipe
- [ ] Consider removing the `VITE_DEV_PORT` variable at the top if it is no longer referenced anywhere in the justfile

**Tests:**
- [ ] `just --list` succeeds (justfile syntax is valid)

**Checkpoint:**
- [ ] `grep -c 'lsof' justfile` returns 0
- [ ] `grep -c 'bun run build' justfile` returns at least 1

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-3, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Remove all static asset serving, [D02] Vite is the single frontend server, [D03] Unified Vite spawning, (#success-criteria)

**Tasks:**
- [ ] Verify all Rust tests pass across the workspace
- [ ] Verify Swift app builds
- [ ] Verify `just app` recipe works end-to-end: builds Rust, builds frontend, builds Swift app, launches with Vite serving
- [ ] Verify no references to `rust-embed`, `RustEmbed`, `serve_asset`, `content_type_for`, `awaitingDevModeResult`, `rewrite_auth_url_to_vite_port`, or `spawnViteDevServer` remain in active source files

**Tests:**
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run --workspace`
- [ ] `cd tugcode && cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** tugcast serves only feeds, auth, and API. Vite serves the frontend in all modes. The Swift app and tugtool always load from the Vite port with no branching or fallback.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo tree -p tugcast | grep rust-embed` returns empty (rust-embed fully removed)
- [ ] `cargo nextest run --workspace` passes with zero failures
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` passes
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds
- [ ] `just app` builds and launches the app with Vite serving the frontend
- [ ] Toggling dev mode at runtime via Settings kills the old Vite and spawns a new one

**Acceptance tests:**
- [ ] Launch via `just app` in non-dev mode: app loads from `vite preview`, frontend renders correctly
- [ ] Launch via `just dev`: app loads from `vite` dev server, HMR works (edit a component, see live update)
- [ ] Toggle dev mode on in Settings: Vite restarts in dev mode, frontend reloads
- [ ] Toggle dev mode off in Settings: Vite restarts in preview mode, frontend reloads
- [ ] Launch app with no source tree set: error alert appears explaining the issue

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Distribution packaging: bundle `dist/` and a minimal static server for installed .app without source tree
- [ ] Consolidate `/api/tell` HTTP endpoint onto the UDS control socket
- [ ] Automatic Vite restart on crash (currently requires manual intervention)

| Checkpoint | Verification |
|------------|--------------|
| rust-embed removed | `cargo tree -p tugcast \| grep rust-embed` returns empty |
| All Rust tests pass | `cd tugcode && cargo nextest run --workspace` |
| No warnings | `cd tugcode && cargo clippy --workspace --all-targets -- -D warnings` |
| Swift app builds | `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` |
| App launches correctly | `just app` completes and Tug.app renders the frontend |
