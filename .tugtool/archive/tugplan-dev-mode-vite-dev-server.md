<!-- tugplan-skeleton v2 -->

## Dev Mode: Vite Dev Server {#dev-mode-vite-dev-server}

**Purpose:** Replace `vite build --watch` with the Vite development server so that CSS changes are hot-swapped via HMR in under 100ms, JS/TSX changes use React Fast Refresh, and the structural race condition that causes "index.html not found" errors during development is eliminated.

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

Dev mode hot-reload is broken. Editing a CSS file causes "index.html not found." The app flashes and dies on launch. The root cause is that `vite build --watch` is a production build tool: every source change triggers a full Rollup + Tailwind rebuild (~2 seconds). During that rebuild, `dist/` files are being rewritten. Meanwhile, tugcast's styles file watcher independently detects the same source change and fires `reload_frontend`. The browser reloads while `dist/` is mid-rebuild, resulting in a 404.

This race is structural and cannot be patched with debouncing because the watcher and builder have no shared clock. The fix is to replace the production build watcher with the tool purpose-built for hot-reloading: the Vite development server.

#### Strategy {#strategy}

- Replace `vite build --watch` with `vite` (the Vite dev server) for all development serving
- Configure Vite's proxy to forward `/auth`, `/api`, and `/ws` requests to tugcast using the `TUGCAST_PORT` environment variable for port discovery
- Remove all `dist/`-based dev asset serving from tugcast (styles watcher, dev index/asset handlers, dist verification)
- Simplify the compiled code watcher to backend-only (no frontend mtime polling; Vite HMR handles frontend changes)
- Switch the Developer card's Styles row from tugcast `dev_notification` to Vite HMR `vite:afterUpdate` events
- Follow the implementation order: Vite config, Tugcast, tugtool, ProcessManager.swift, Developer card, Cleanup
- The Justfile `dev` and `app` recipes require no changes (Vite spawning is handled by tugtool/ProcessManager, not the Justfile)

#### Success Criteria (Measurable) {#success-criteria}

- CSS file edits hot-swap in the browser without page reload (verify by editing `tokens.css` and observing no navigation in browser devtools)
- TSX file edits trigger React Fast Refresh without full page reload (verify by editing a component and observing state preservation)
- `just dev` launches Vite dev server and tugcast, opens browser to Vite URL (port 5173), and proxies `/auth`, `/api`, `/ws` to tugcast
- `just app` launches the Mac app with WKWebView loading from Vite dev server when dev mode is enabled
- No "index.html not found" errors during CSS/JS editing sessions
- `cargo nextest run` passes with no warnings in the tugcode workspace
- `bun test` passes in the tugdeck workspace

#### Scope {#scope}

1. Vite config changes: proxy entries for `/auth`, `/api`, `/ws` using `TUGCAST_PORT` env var
2. Tugcast dev.rs simplification: remove styles watcher, dist verification, dev asset serving, frontend_dirty tracking
3. Tugcast server.rs fallback simplification: remove dev state asset serving path
4. Tugcast control.rs: remove `reload_frontend` broadcast after dev mode enable
5. Tugtool main.rs: replace `spawn_vite_watch()` with `spawn_vite_dev()`, remove `ensure_dist_populated()`, rewrite auth URL to Vite port
6. ProcessManager.swift: spawn Vite dev server, rewrite auth URL to Vite port
7. Developer card: switch Styles row to Vite HMR events
8. Dead code cleanup across tugcode and tugdeck

#### Non-goals (Explicitly out of scope) {#non-goals}

- HMR state preservation across tugcast restarts (full reload on restart is acceptable)
- Changing the production build or rust-embed embedding pipeline
- Running the Vite dev server in production
- Custom Vite plugins for tugcast integration
- Replacing the `dev_mode` control socket protocol
- Auto-restarting the Vite dev server if it crashes

#### Dependencies / Prerequisites {#dependencies}

- Vite and its React plugin are already installed in `tugdeck/` (`node_modules/.bin/vite`)
- The `@tailwindcss/vite` plugin is configured in `vite.config.ts`
- The `/ws` proxy entry already exists in `vite.config.ts` targeting port 7080 (needs to use `TUGCAST_PORT` env var instead)
- `bun run dev` script exists in `tugdeck/package.json` (invokes Vite dev server)

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` in `tugcode/.cargo/config.toml`
- Must not break the production build path (`vite build` for `build.rs` embedding)
- Must not break the `just app` recipe (which runs `bun run build` for embedding)
- ProcessManager.swift must handle the case where dev mode is disabled (no Vite process)

#### Assumptions {#assumptions}

- The Vite dev server defaults to port 5173 and `--strictPort` ensures it fails fast if occupied (rather than silently binding elsewhere)
- Tugcast default port is 55255 with port rolling (try next port if occupied)
- The actual tugcast port is communicated to Vite via `TUGCAST_PORT` environment variable
- The existing `/ws` proxy entry in `vite.config.ts` targets hardcoded port 7080; this will be replaced with the `TUGCAST_PORT` env var
- The Justfile `dev` recipe requires no changes; it runs `tugtool` which handles Vite spawning internally
- The Justfile `app` recipe keeps `bun run build` unchanged (needed for `cargo build.rs` embedding)
- The pending-flag confirmation pattern uses `restart_available` / `relaunch_available` notifications from the new tugcast instance as confirmation signals (previously used `reloaded`). These arrive within ~2 seconds of the new instance starting (compiled watcher poll interval). Badge calculation and git-based Edited state in `developer-card.tsx` are unchanged.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Vite dev server crashes | high | low | Log warning; developer restarts manually | Multiple crash reports in testing |
| Port 55255 occupied | medium | low | Port rolling already supported; env var propagates actual port | Frequent port conflicts |
| Vite HMR failure for complex JS changes | low | medium | Vite falls back to full page reload automatically | Developer reports state loss |
| CSP restrictions block HMR client | medium | low | Vite serves HTML and controls CSP in dev mode | HMR client script blocked |
| Vite startup race | low | high | Browser/WKWebView retries; add readiness poll if needed | Consistent connection-refused on first load |

**Risk R01: Vite dev server crash leaves browser without asset server** {#r01-vite-crash}

- **Risk:** If the Vite process exits, the browser loses its asset server and shows connection errors
- **Mitigation:** Log the exit, include exit code in log message; developer can restart via `just dev` or app relaunch. Same failure mode as current `vite build --watch` crash, but more visible.
- **Residual risk:** Manual intervention required to restore dev mode after Vite crash

**Risk R02: Port conflict on tugcast port** {#r02-port-conflict}

- **Risk:** Another process holds the tugcast port, preventing dev mode from working
- **Mitigation:** Port rolling is already supported (default 55255, rolls to next). `TUGCAST_PORT` env var ensures Vite always targets the actual bound port.
- **Residual risk:** None -- port rolling and env var propagation handle this

**Risk R03: Vite startup race — browser opens before Vite is listening** {#r03-vite-startup-race}

- **Risk:** Both tugtool (Step 3) and ProcessManager.swift (Step 4) open the browser/WKWebView targeting port 5173 immediately after spawning Vite, but Vite takes 1-3 seconds to start. The page request may arrive before Vite is listening, causing a connection-refused error.
- **Mitigation:** Browsers typically retry on connection-refused. If this proves unreliable (especially in WKWebView), add a readiness poll (e.g., retry HTTP GET to `http://localhost:5173` with short intervals) before opening the URL. Alternatively, spawn Vite earlier in the startup sequence to give it more lead time.
- **Residual risk:** Occasional connection-refused on first load; user refreshes. Acceptably low friction for a dev-only flow.

---

### Design Decisions {#design-decisions}

#### [D01] Use TUGCAST_PORT env var for port discovery (DECIDED) {#d01-tugcast-port-env-var}

**Decision:** Pass the actual tugcast bound port to Vite via the `TUGCAST_PORT` environment variable. Vite config reads `process.env.TUGCAST_PORT` to construct proxy targets.

**Rationale:**
- Tugcast uses port 55255 by default with port rolling; the actual port is determined at runtime
- Hardcoding a port in `vite.config.ts` would break when port rolling activates
- The roadmap document (`roadmap/dev-mode-vite-dev-server.md`) originally proposed a fixed port 7080 for tugcast in dev mode, but the env var approach is superior because it works with the existing port rolling mechanism without requiring a dev-mode-specific port override
- Environment variables are the standard mechanism for inter-process configuration

**Implications:**
- `vite.config.ts` reads `process.env.TUGCAST_PORT` with a fallback to `55255`
- `tugtool` starts tugcast first, reads the `port` field from the ready message JSON, then passes it to Vite via `TUGCAST_PORT`
- `ProcessManager.swift` does the same: starts tugcast, reads the `port` field from the ready message, passes it to Vite

#### [D02] Remove styles watcher and dev asset serving from tugcast (DECIDED) {#d02-remove-styles-watcher}

**Decision:** Delete the `dev_file_watcher` (styles watcher), `serve_dev_index()`, `serve_dev_asset()`, `load_dev_state()`, and all `dist/`-related dev logic from tugcast. Vite HMR handles CSS changes; Vite dev server serves all assets.

**Rationale:**
- The styles watcher + `reload_frontend` is the source of the race condition
- With Vite dev server serving assets, tugcast never needs to serve from `dist/` in dev mode
- Removing this code eliminates the race and simplifies tugcast significantly

**Implications:**
- `DevState` struct loses `dist_dir` and `index_path` fields, retains only `source_tree`
- `SharedDevState` type alias remains but wraps a simpler struct
- `enable_dev_mode()` no longer calls `load_dev_state()` or creates a styles watcher
- The `server.rs` fallback handler no longer checks `SharedDevState` for dev asset serving

#### [D03] Remove frontend_dirty and mark_frontend from DevChangeTracker (DECIDED) {#d03-remove-frontend-dirty}

**Decision:** Remove the `frontend_dirty` flag and `mark_frontend()` method from `DevChangeTracker` entirely. The compiled code watcher polls only the tugcast binary (backend).

**Rationale:**
- Frontend changes are now handled by Vite HMR, not by tugcast's compiled watcher
- The `frontend_dirty` flag and `mark_frontend()` are dead code after removing dist/index.html polling
- User answer explicitly confirmed this removal

**Implications:**
- `DevChangeTracker` has `backend_dirty`, `app_dirty`, `code_count`, `app_count` but no `frontend_dirty`
- `snapshot()` only checks `backend_dirty` and `app_dirty`
- `clear_restart()` only clears `backend_dirty` and `code_count`

#### [D04] Remove reload_frontend broadcast in control.rs (DECIDED) {#d04-remove-reload-frontend-broadcast}

**Decision:** Remove the `reload_frontend` broadcast that fires after `enable_dev_mode` succeeds in `control.rs`.

**Rationale:**
- This broadcast was for mid-session dev mode toggles to force a page reload
- With the Vite dev server, the browser loads from Vite directly; a full page reload is not needed after dev mode enable
- At startup, the Mac app gates `loadURL` on `dev_mode_result`, making the broadcast redundant
- User answer explicitly confirmed this removal

**Implications:**
- The `ControlReader::run_recv_loop` `DevMode` handler no longer sends `reload_frontend` after successful enable
- The `reload_frontend` action handler in `action-dispatch.ts` stays (it is used by the Developer menu's Cmd+R)

#### [D05] Rewrite auth URL to Vite port (DECIDED) {#d05-rewrite-auth-url}

**Decision:** Both `tugtool` and `ProcessManager.swift` rewrite the auth URL from tugcast's port to Vite's port (5173) before opening the browser or loading WKWebView. The URL structure (path, query parameters, token) is preserved.

**Rationale:**
- The browser must load from Vite dev server to get HMR support
- Auth still happens via Vite's proxy to tugcast, so the token in the URL works correctly
- Rewriting the port is the simplest approach since the URL format is `http://127.0.0.1:{port}/auth?token=...`

**Implications:**
- `tugtool` replaces the tugcast port in the auth URL with `5173` before calling `open_browser()`
- `ProcessManager.swift` does the same before passing the URL to `window.loadURL()`
- If Vite is not running on 5173 (unlikely but possible), the rewrite still targets 5173

#### [D07] Pending-flag confirmation uses restart_available/relaunch_available (DECIDED) {#d07-pending-flag-confirmation}

**Decision:** After removing the `"reloaded"` notification, the pending-flag confirmation pattern in `developer-card.tsx` relies on `restart_available` or `relaunch_available` notifications from the new tugcast instance's compiled watcher as the confirmation signal that the restart/relaunch completed. Any `dev_notification` arriving while `restartPendingRef` or `relaunchPendingRef` is true clears the corresponding row's stale state.

**Rationale:**
- The `"reloaded"` notification was sent by the styles watcher on dev mode enable, which is being removed
- The new tugcast instance's compiled watcher polls the backend binary and sends `restart_available` within ~2 seconds of starting (the poll interval)
- Since the pending-flag pattern already clears stale state on any incoming `dev_notification`, no code change is needed in the confirmation logic itself -- it already works with `restart_available`/`relaunch_available`
- The only change needed is in tests that currently use `type: "reloaded"` as the confirmation dispatch

**Implications:**
- The pending-flag confirmation logic in `handleDevNotification` is unchanged (it fires on any notification type)
- Tests that dispatch `type: "reloaded"` as confirmation must switch to `type: "restart_available"` or `type: "relaunch_available"`
- Confirmation latency may increase slightly (~2 seconds vs near-instant) because it depends on the compiled watcher poll interval rather than the immediate dev mode enable response

#### [D06] Keep SharedDevState on build_app but simplify fallback (DECIDED) {#d06-simplify-server-fallback}

**Decision:** The `build_app()` function in `server.rs` keeps its `SharedDevState` parameter because `handle_relaunch` in `control.rs` reads `source_tree` from it. However, the fallback handler is simplified to always serve from rust-embed -- the dev state check and dev asset serving closure are removed.

**Rationale:**
- In dev mode, the browser loads from Vite, not tugcast. Tugcast never serves HTML/JS/CSS assets in dev mode.
- In production mode, rust-embed serves the embedded assets as before.
- The `SharedDevState` is still read by `handle_relaunch()` to find the source tree path, so the parameter must remain on `build_app()`.
- The fallback closure is replaced with the simpler `serve_asset` function directly.

**Implications:**
- `build_app()` signature is unchanged (still takes `SharedDevState`)
- The fallback closure that checked `SharedDevState` and conditionally called `serve_dev_index`/`serve_dev_asset` is replaced with a direct call to `serve_asset`
- Integration tests that verify dev asset serving behavior (`test_build_app_dev_mode`, `test_dist_based_serving_*`) must be deleted since that serving path no longer exists

---

### Specification {#specification}

#### Vite Config Proxy Specification {#vite-proxy-spec}

**Spec S01: Vite proxy configuration** {#s01-vite-proxy}

The `server.proxy` section in `vite.config.ts` must proxy three path prefixes to tugcast:

| Path | Target protocol | WebSocket | Notes |
|------|----------------|-----------|-------|
| `/auth` | `http` | no | Authentication endpoint |
| `/api` | `http` | no | REST API (e.g., `/api/tell`) |
| `/ws` | `ws` | yes | WebSocket for feeds |

The target host is always `localhost`. The port is read from `process.env.TUGCAST_PORT` with fallback to `55255`.

```typescript
const tugcastPort = process.env.TUGCAST_PORT || "55255";
server: {
  proxy: {
    "/auth": { target: `http://localhost:${tugcastPort}` },
    "/ws": { target: `ws://localhost:${tugcastPort}`, ws: true },
    "/api": { target: `http://localhost:${tugcastPort}` },
  },
},
```

#### DevState Simplification {#devstate-simplification}

**Spec S02: Simplified DevState struct** {#s02-devstate}

After removing dist-based serving, `DevState` retains only the source tree path:

```rust
pub(crate) struct DevState {
    /// Absolute path to the source tree root (parent of tugdeck/)
    pub source_tree: PathBuf,
}
```

The `SharedDevState` type alias remains: `Arc<ArcSwap<Option<DevState>>>`.

`enable_dev_mode()` creates a `DevState` with only `source_tree`, starts only the backend binary watcher and app source watcher, and returns a `DevRuntime` without a styles watcher.

#### Compiled Watcher Simplification {#compiled-watcher-simplification}

**Spec S03: Backend-only compiled watcher** {#s03-compiled-watcher}

The `dev_compiled_watcher` function monitors only the tugcast binary path. The `frontend_path` parameter is removed.

```rust
pub(crate) fn dev_compiled_watcher(
    backend_path: PathBuf,
    tracker: SharedChangeTracker,
    client_action_tx: broadcast::Sender<Frame>,
) -> tokio::task::JoinHandle<()>
```

On stable mtime change, it calls `tracker.lock().unwrap().mark_backend()` and sends `restart_available` notification.

#### Auth URL Rewrite Specification {#auth-url-rewrite}

**Spec S04: Auth URL port rewrite and port extraction** {#s04-auth-url-rewrite}

The ready message from tugcast is JSON with structure: `{"type":"ready","auth_url":"http://127.0.0.1:{port}/auth?token={token}","port":{port},"pid":{pid}}`

The `port` field contains the actual bound port as a `u16`. Both `tugtool` and `ProcessManager.swift` extract the port from this field (not by parsing the URL string).

**Port extraction (tugtool):** Modify `wait_for_ready()` to also extract `msg["port"]` as `u16` from the ready message JSON and return it alongside the auth URL. New return type: `(String, u16, BufReader, OwnedWriteHalf)`. This is a 3-line change in the existing function.

**Port extraction (Swift):** In `handleControlMessage` for the `"ready"` case, read `msg.data["port"] as? Int` and pass it through the `onReady` callback. Change `onReady` signature from `(String) -> Void` to `(String, Int) -> Void`.

**Auth URL rewrite:** Both `tugtool` and `ProcessManager.swift` rewrite the port to `5173` (Vite dev server port):
- Input: `http://127.0.0.1:55255/auth?token=abc123`
- Output: `http://127.0.0.1:5173/auth?token=abc123`

Implementation approach: use the known tugcast port (from the ready message) to do a string replacement of `:{tugcast_port}` with `:5173` in the auth URL.

#### Vite Dev Server Spawning {#vite-spawn-spec}

**Spec S05: spawn_vite_dev function** {#s05-spawn-vite-dev}

Replaces `spawn_vite_watch()`. Spawns the Vite dev server process:

```rust
async fn spawn_vite_dev(
    source_tree: &Path,
    tugcast_port: u16,
) -> Result<tokio::process::Child, String>
```

- Binary: `{source_tree}/tugdeck/node_modules/.bin/vite`
- Working directory: `{source_tree}/tugdeck`
- Arguments: `--strictPort` (Vite defaults to dev server mode on port 5173; `--strictPort` ensures it fails fast if 5173 is occupied rather than silently binding to a different port, which would break the auth URL rewrite)
- Environment: `TUGCAST_PORT={tugcast_port}` (in addition to inherited env)
- stdout/stderr: inherited

#### Integration Tests Affected {#integration-tests-affected}

**Spec S06: Integration tests to delete or update** {#s06-integration-tests}

The following integration tests in `tugcode/crates/tugcast/src/integration_tests.rs` verify the dev asset serving path that is being removed. They must be deleted:

| Test | Reason for deletion |
|------|-------------------|
| `test_build_app_dev_mode` | Uses `load_dev_state()` and verifies dev asset serving from dist/ |
| `test_dist_based_serving_hashed_css` | Verifies CSS serving from dist/ via dev state |
| `test_dist_based_serving_font` | Verifies font serving from dist/ via dev state |
| `test_dist_based_serving_index_html` | Verifies index.html serving from dist/ via dev state |
| `test_dist_based_serving_path_traversal` | Verifies path traversal protection on dist/ serving |
| `test_dist_based_serving_unknown_path_404` | Verifies 404 for unknown paths in dist/ serving |

These tests all use `dev::load_dev_state()` to construct a `DevState` with `dist_dir`/`index_path` fields and then test asset serving through the `build_app` fallback. Since both `load_dev_state()` and the dev asset serving fallback are being removed, these tests have no valid target.

The remaining integration tests (`test_build_app_production_mode`, `test_auth_*`, `test_tell_*`, etc.) are unaffected and continue to work because they use `build_test_app()` which passes `dev::new_shared_dev_state()` (None state).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

None.

#### New files (if any) {#new-files}

None.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DevState.dist_dir` | field (remove) | `tugcode/crates/tugcast/src/dev.rs` | Remove field |
| `DevState.index_path` | field (remove) | `tugcode/crates/tugcast/src/dev.rs` | Remove field |
| `DevChangeTracker.frontend_dirty` | field (remove) | `tugcode/crates/tugcast/src/dev.rs` | Dead code per [D03] |
| `DevChangeTracker::mark_frontend` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Dead code per [D03] |
| `load_dev_state` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Replaced by direct DevState construction |
| `validate_dev_state` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | No dist to validate |
| `watch_dirs` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Styles watcher removed |
| `serve_dev_asset` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Vite serves assets |
| `serve_dev_index` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Vite serves index |
| `serve_dev_index_impl` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Internal impl |
| `serve_file_with_safety` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Dev asset safety check |
| `has_reload_extension` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Styles watcher filter |
| `dev_file_watcher` | fn (remove) | `tugcode/crates/tugcast/src/dev.rs` | Styles watcher |
| `send_dev_notification` (reloaded branch) | fn (modify) | `tugcode/crates/tugcast/src/dev.rs` | Remove the `"reloaded"` branch; only `restart_available` and `relaunch_available` remain |
| `dev_compiled_watcher` | fn (modify) | `tugcode/crates/tugcast/src/dev.rs` | Remove frontend_path param |
| `enable_dev_mode` | fn (modify) | `tugcode/crates/tugcast/src/dev.rs` | Remove dist logic, styles watcher |
| `DevRuntime._watcher` | field (remove) | `tugcode/crates/tugcast/src/dev.rs` | Was styles watcher |
| `build_app` | fn (modify) | `tugcode/crates/tugcast/src/server.rs` | Simplify fallback to always use serve_asset |
| `ensure_dist_populated` | fn (remove) | `tugcode/crates/tugtool/src/main.rs` | Not needed |
| `spawn_vite_watch` | fn (remove) | `tugcode/crates/tugtool/src/main.rs` | Replaced by spawn_vite_dev |
| `spawn_vite_dev` | fn (add) | `tugcode/crates/tugtool/src/main.rs` | Spawn Vite dev server with TUGCAST_PORT and --strictPort |
| `wait_for_ready` | fn (modify) | `tugcode/crates/tugtool/src/main.rs` | Return `(String, u16, BufReader, OwnedWriteHalf)` -- add port field |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test DevChangeTracker after field removal, verify DevState construction | Core logic changes |
| **Integration** | Verify build_app fallback serves embedded assets, auth/tell endpoints work | Server route behavior |
| **Manual** | CSS hot-reload, TSX Fast Refresh, restart flow, Mac app dev mode | HMR behavior in browser |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Update Vite Config with Proxy Entries {#step-1}

**Commit:** `feat(tugdeck): add proxy config for /auth, /api, /ws using TUGCAST_PORT env var`

**References:** [D01] Use TUGCAST_PORT env var for port discovery, Spec S01, (#vite-proxy-spec, #context)

**Artifacts:**
- Modified `tugdeck/vite.config.ts`

**Tasks:**
- [ ] Read `process.env.TUGCAST_PORT` with fallback to `"55255"` at the top of the `defineConfig` callback in `vite.config.ts`
- [ ] Replace the existing `server.proxy` block (which currently has only `/ws` targeting port 7080) with three entries: `/auth` (http), `/ws` (ws, ws: true), `/api` (http), all targeting `localhost:${tugcastPort}`
- [ ] Remove the comment about "no server.proxy config" since we now have one
- [ ] Keep `build.outDir` and `build.emptyOutDir` unchanged (production build path untouched)

**Tests:**
- [ ] `cd tugdeck && bun test` passes (existing tests still work)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Visually inspect `vite.config.ts` to confirm proxy targets use env var

---

#### Step 2: Simplify Tugcast Dev Mode {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugcast): remove dist-based dev serving, simplify to backend-only watchers`

**References:** [D02] Remove styles watcher and dev asset serving, [D03] Remove frontend_dirty, [D04] Remove reload_frontend broadcast, [D06] Keep SharedDevState on build_app but simplify fallback, Spec S02, Spec S03, Spec S06, (#devstate-simplification, #compiled-watcher-simplification, #integration-tests-affected)

> This step is a single atomic commit because the struct changes, function removals, enable_dev_mode simplification, and server.rs fallback changes are tightly coupled. Separating them would leave an intermediate state that does not compile (e.g., removing `dist_dir`/`index_path` from `DevState` while `load_dev_state()` still constructs them).

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs`
- Modified `tugcode/crates/tugcast/src/server.rs`
- Modified `tugcode/crates/tugcast/src/control.rs`
- Modified `tugcode/crates/tugcast/src/integration_tests.rs`

**Tasks:**
- [ ] Remove `dist_dir` and `index_path` fields from `DevState` struct, keep only `source_tree`
- [ ] Remove `frontend_dirty` field from `DevChangeTracker`
- [ ] Remove `mark_frontend()` method from `DevChangeTracker`
- [ ] Update `snapshot()` to only check `backend_dirty` and `app_dirty`
- [ ] Update `clear_restart()` to only clear `backend_dirty` and `code_count`
- [ ] Update `clear_all()` to remove `frontend_dirty` reference
- [ ] Remove `load_dev_state()` function
- [ ] Remove `validate_dev_state()` function
- [ ] Remove `watch_dirs()` function
- [ ] Remove `dev_file_watcher()` function entirely
- [ ] Remove `has_reload_extension()` function
- [ ] Remove `serve_dev_asset()`, `serve_dev_index()`, `serve_dev_index_impl()`, `serve_file_with_safety()` functions
- [ ] Remove unused imports that were only needed for asset serving (`axum::http`, `axum::response`, `header`, `Uri`, `StatusCode` in dev.rs)
- [ ] Remove `DevRuntime._watcher` field (was the styles watcher `RecommendedWatcher`)
- [ ] Update `enable_dev_mode()`: construct `DevState { source_tree }` directly (no `load_dev_state()` call), skip styles watcher creation, skip `validate_dev_state()` call, skip `watch_dirs()` call
- [ ] Update `dev_compiled_watcher()`: remove `frontend_path` parameter, remove frontend mtime variable and frontend mtime checking, keep only backend mtime polling
- [ ] Remove the `"reloaded"` branch from `send_dev_notification()` entirely -- only `restart_available` and `relaunch_available` remain
- [ ] Remove `test_send_dev_notification_reloaded` test
- [ ] Update `test_compiled_watcher_detects_mtime_change`, `test_compiled_watcher_missing_at_start`, and `test_compiled_watcher_stabilization` tests to use the new 3-parameter `dev_compiled_watcher` signature (remove `frontend_path` argument; test against backend path changes instead)
- [ ] Simplify `server.rs` `build_app()` fallback: replace the closure that checks `SharedDevState` and conditionally calls `serve_dev_index`/`serve_dev_asset` with a direct `.fallback(serve_asset)`. Keep the `SharedDevState` parameter on `build_app()` since `handle_relaunch` in `control.rs` still reads `source_tree` from it.
- [ ] In `control.rs` `ControlReader::run_recv_loop`, within the `DevMode` handler's success branch, remove the block that broadcasts `{"action":"reload_frontend"}` via `client_action_tx` (the 4 lines after the `make_dev_mode_result` send)
- [ ] Update all test code that constructs `DevState` to use the new single-field struct: update `test_handle_relaunch_reads_source_tree_from_dev_state` in `control.rs`
- [ ] Delete the following integration tests from `integration_tests.rs` (they test the removed dev asset serving path): `test_build_app_dev_mode`, `test_dist_based_serving_hashed_css`, `test_dist_based_serving_font`, `test_dist_based_serving_index_html`, `test_dist_based_serving_path_traversal`, `test_dist_based_serving_unknown_path_404`
- [ ] Delete the following unit tests from `dev.rs` that test removed functions: `test_load_dev_state_valid`, `test_load_dev_state_missing_dist`, `test_load_dev_state_missing_index_html`, `test_watch_dirs_returns_dist_and_src`, `test_validate_dev_state_warns_missing`, `test_serve_dev_asset_path_traversal_dotdot`, `test_serve_dev_asset_path_traversal_encoded`, `test_serve_dev_asset_path_traversal_double_encoded`, `test_serve_dev_asset_hashed_js_from_dist_assets`, `test_serve_dev_asset_font_from_dist_fonts`, `test_serve_dev_asset_404_not_in_dist`, `test_serve_dev_asset_index_html`, `test_has_reload_extension_excludes_js`, `test_has_reload_extension_includes_css_html`
- [ ] Update `test_shared_dev_state_store_load` to construct `DevState` with only `source_tree` (no `dist_dir`/`index_path`)
- [ ] Update `test_enable_dev_mode_valid`, `test_enable_dev_mode_invalid_path`, `test_disable_dev_mode_clears_state`, `test_enable_disable_enable_different_path`, `test_debounce_gating_after_disable` to work with the simplified `DevState` (no dist setup, no styles watcher assertions)
- [ ] Update `test_change_tracker_mark_frontend` -- delete this test (the `mark_frontend` method is removed per [D03])
- [ ] Update `test_change_tracker_combined_count`, `test_change_tracker_clear_all`, `test_change_tracker_snapshot` to remove `frontend_dirty`/`mark_frontend` references

**Tests:**
- [ ] `cd tugcode && cargo build -p tugcast` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes

---

#### Step 3: Update tugtool main.rs {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugtool): replace spawn_vite_watch with spawn_vite_dev, rewrite auth URL`

**References:** [D01] Use TUGCAST_PORT env var, [D05] Rewrite auth URL, Spec S04, Spec S05, (#auth-url-rewrite, #vite-spawn-spec)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`

**Tasks:**
- [ ] Delete `ensure_dist_populated()` function entirely
- [ ] Delete `spawn_vite_watch()` function entirely
- [ ] Add `spawn_vite_dev(source_tree: &Path, tugcast_port: u16) -> Result<tokio::process::Child, String>` function: spawns `{source_tree}/tugdeck/node_modules/.bin/vite` with argument `--strictPort` (fail fast if port 5173 is occupied), working dir `{source_tree}/tugdeck`, env var `TUGCAST_PORT={tugcast_port}`, stdout/stderr inherited
- [ ] Modify `wait_for_ready()` to also extract the `port` field from the ready message JSON as `u16`. Change return type from `(String, BufReader, OwnedWriteHalf)` to `(String, u16, BufReader, OwnedWriteHalf)`. The ready message already contains `"port":{port}` (see `control.rs` `ReadyMessage` struct). This is a 3-line change: add `let port = msg.get("port").and_then(|p| p.as_u64()).ok_or("ready message missing port")? as u16;` and include `port` in the return tuple.
- [ ] Update the `wait_for_ready` call site in `supervisor_loop` to destructure the new 4-element tuple: `let (auth_url, tugcast_port, mut reader, mut write_half) = ...`
- [ ] In `supervisor_loop`, remove the `ensure_dist_populated()` call in the `first_spawn` block
- [ ] In `supervisor_loop`, replace `spawn_vite_watch(st)` with `spawn_vite_dev(st, tugcast_port)` where `tugcast_port` comes from the `wait_for_ready` return value
- [ ] Add auth URL rewrite: before `open_browser(&auth_url)`, replace `:{tugcast_port}` with `:5173` in the auth URL string using the known `tugcast_port` value
- [ ] Update log messages to reflect "vite dev server" instead of "vite build --watch"

**Tests:**
- [ ] Existing `main.rs` tests pass: `cd tugcode && cargo nextest run -p tugtool`
- [ ] Add test for auth URL port rewrite logic (verify `http://127.0.0.1:55255/auth?token=abc` with `tugcast_port=55255` becomes `http://127.0.0.1:5173/auth?token=abc`)

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` compiles with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes

---

#### Step 4: Update ProcessManager.swift {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugapp): spawn Vite dev server, rewrite auth URL to Vite port`

**References:** [D01] Use TUGCAST_PORT env var, [D05] Rewrite auth URL, Spec S04, Spec S05, (#auth-url-rewrite, #vite-spawn-spec)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] In `ProcessManager.startProcess()`, remove the entire vite spawn block from `startProcess()`. Vite must not be spawned here because the tugcast port is not yet known (the ready message has not arrived). The current code hardcodes `TUGCAST_PORT=55255`, which is wrong when port rolling activates. Instead, Vite will be spawned from the `onReady` callback after the actual port is extracted from the ready message.
- [ ] Add a new method `spawnViteDevServer(sourceTree: String, tugcastPort: Int)` to `ProcessManager` that spawns the Vite dev server process. This method: sets arguments to `["--strictPort"]` (fail fast if port 5173 is occupied), sets working directory to `{sourceTree}/tugdeck`, adds `TUGCAST_PORT=\(tugcastPort)` to the process environment, inherits stdout/stderr. Includes the same `viteProcess?.isRunning` duplication guard as the current code to prevent re-spawning on tugcast restarts (Vite persists across tugcast restarts).
- [ ] In `handleControlMessage` for the `"ready"` case: read `msg.data["port"] as? Int` from the ready message data. The ready message already contains the `port` field. Change the `onReady` callback signature from `(String) -> Void` to `(String, Int) -> Void` to pass both auth URL and port.
- [ ] In `AppDelegate.swift` `onReady` handler: update to accept the new `(String, Int)` signature. Store the tugcast port (e.g., `self.lastTugcastPort = port`). If dev mode is enabled and source tree is set, call `spawnViteDevServer(sourceTree:tugcastPort:)` with the port from the ready message. This ensures Vite always gets the real tugcast port, even when port rolling activates.
- [ ] In `AppDelegate.swift` `onDevModeResult`: create a local `urlToLoad` variable from `lastAuthURL`. When dev mode is enabled, rewrite `urlToLoad` by replacing `:\(lastTugcastPort)` with `:5173` before calling `window.loadURL(urlToLoad)`. When dev mode is NOT enabled, load the original `lastAuthURL` unchanged (do NOT rewrite the port -- the browser should load directly from tugcast).
- [ ] Update log messages from "vite build --watch" to "vite dev server"
- [ ] Update the `relaunch` shutdown handler log message to reference "vite dev server" instead of "vite process"

**Tests:**
- [ ] Build the Mac app: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`
- [ ] Manual: launch app with dev mode enabled, verify WKWebView loads from port 5173

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds
- [ ] No compiler warnings in Xcode build output

---

#### Step 5: Update Developer Card for Vite HMR Events {#step-5}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): switch Styles row to Vite HMR events, remove reloaded notification handling`

**References:** [D02] Remove styles watcher, [D07] Pending-flag confirmation uses restart_available/relaunch_available, (#context, #strategy, #d07-pending-flag-confirmation)

**Artifacts:**
- Modified `tugdeck/src/components/cards/developer-card.tsx`
- Modified `tugdeck/src/components/cards/developer-card.test.tsx`
- Modified `tugdeck/src/action-dispatch.ts` (comment cleanup only)
- Modified `tugdeck/src/__tests__/action-dispatch.test.ts`

**Tasks:**
- [ ] Add a `useEffect` that registers a Vite HMR `vite:afterUpdate` listener using `import.meta.hot.on("vite:afterUpdate", callback)`. Guard with `if (import.meta.hot)`. On event, also dispatch a `td-hmr-update` CustomEvent on `document` (this indirection allows tests to trigger the flash without `import.meta.hot`, which is Vite-only and unavailable in the bun test runner). The CustomEvent handler triggers the "Reloaded" flash (same logic as the current `"reloaded"` notification handler: set `stylesFlashing` true, `stylesFlashText` "Reloaded", clear after 2000ms timeout).
- [ ] Remove the `"reloaded"` case from the `td-dev-notification` event handler in `handleDevNotification`. The `"reloaded"` type notification is no longer sent by tugcast.
- [ ] Remove the `"reloaded"` variant from the `DevNotificationEvent` `type` union since it is no longer used
- [ ] Keep `"restart_available"` and `"relaunch_available"` handlers unchanged
- [ ] Ensure the cleanup function in the HMR useEffect disposes the `vite:afterUpdate` listener via `import.meta.hot.dispose` if available, and removes the `td-hmr-update` document event listener
- [ ] In `action-dispatch.ts`: remove the comment `// For "reloaded" type, no badge (clean state)` in the `dev_notification` handler's card-closed branch (line ~232). The comment references a notification type that no longer exists. No functional code change needed since the handler forwards the payload generically.
- [ ] In `action-dispatch.test.ts`: delete or update the test `"should not dispatch badge event when card closed and type is reloaded"` (line ~204). This test dispatches `type: "reloaded"` which is no longer a valid notification type. Either delete the test entirely or convert it to test that unknown notification types do not dispatch badges.
- [ ] In `developer-card.test.tsx`: update `"shows Reloaded flash when reloaded notification received"` and `"reverts Styles row to Clean after Reloaded flash expires"` tests. These currently dispatch `type: "reloaded"` via `td-dev-notification`. Replace with tests that dispatch a `td-hmr-update` CustomEvent on `document` (the testable indirection for the Vite HMR path -- `import.meta.hot` is Vite-only and unavailable in bun test runner).
- [ ] In `developer-card.test.tsx`: update the pending-flag confirmation tests (`"clicking Restart calls sendControlFrame('restart') and button stays until confirmation"` and `"clicking Relaunch calls sendControlFrame('relaunch') and button stays until confirmation"`). These currently dispatch `type: "reloaded"` as the confirmation signal. Replace with `type: "restart_available"` or `type: "relaunch_available"` as the confirmation signal, since the pending-flag pattern now relies on `restart_available`/`relaunch_available` from the new tugcast instance (see [D07] and #assumptions).
- [ ] In `developer-card.test.tsx`: update `"badge stays at stale count after Restart click and goes to 0 on confirmation"` test. This dispatches `type: "reloaded"` as confirmation. Replace with `type: "restart_available"` from the new instance as confirmation.

**Tests:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Tests for Styles row HMR flash use `td-hmr-update` CustomEvent dispatch (testable without `import.meta.hot`)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Manual: edit a CSS file while dev server is running, verify "Reloaded" flash appears on Styles row without page reload

---

#### Step 6: Final Cleanup and Verification {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `chore: clean up dead code from vite dev server migration`

**References:** [D02] Remove styles watcher, [D03] Remove frontend_dirty, [D04] Remove reload_frontend broadcast, (#strategy)

**Artifacts:**
- Modified files across tugcode and tugdeck as needed

**Tasks:**
- [ ] Search for any remaining references to `vite build --watch` in comments, log messages, or documentation and update them
- [ ] Search for any remaining references to `ensure_dist_populated` and remove them
- [ ] Search for any remaining references to `dev_file_watcher` and remove them
- [ ] Verify no `#[allow(dead_code)]` annotations are on symbols that are now truly dead (remove the annotation if the symbol is used, remove the symbol if it is not)
- [ ] Delete `roadmap/dev-mode-vite-dev-server.md` -- this roadmap file describes the pre-implementation plan and is stale after this migration completes. The tugplan is the authoritative record. The roadmap originally proposed a fixed port 7080 for tugcast (contradicted by [D01] env var approach), making it actively misleading if retained.
- [ ] Run `cargo fmt --all` in `tugcode/`
- [ ] Run `cargo clippy --workspace --all-targets -- -D warnings` in `tugcode/`
- [ ] Run full test suite

**Tests:**
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] `cd tugdeck && bun test` passes

**Checkpoint:**
- [ ] `cd tugcode && cargo fmt --all -- --check` passes
- [ ] `cd tugcode && cargo clippy --workspace --all-targets -- -D warnings` passes
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] `cd tugdeck && bun test` passes
- [ ] Manual: `just dev` starts Vite dev server and tugcast, opens browser to Vite URL, CSS edits hot-swap, TSX edits use Fast Refresh

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Dev mode uses the Vite development server for hot-reload, eliminating the `dist/` race condition and providing sub-100ms CSS updates and React Fast Refresh.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `just dev` starts tugcast + Vite dev server, opens browser to `http://localhost:5173/auth?token=...` (verify by running `just dev`)
- [ ] CSS edits are hot-swapped without page reload (verify by editing `tugdeck/src/index.css` and observing no navigation event in devtools)
- [ ] TSX edits trigger React Fast Refresh (verify by editing a component and checking state preservation)
- [ ] `just app` builds and launches the Mac app with Vite dev server when dev mode is enabled (verify by checking WKWebView loads from port 5173)
- [ ] Backend code changes trigger "restart_available" notification (verify by touching `tugcode/target/debug/tugcast`)
- [ ] App source changes trigger "relaunch_available" notification (verify by touching a `.swift` file)
- [ ] No "index.html not found" errors during development
- [ ] `cd tugcode && cargo nextest run --workspace` passes
- [ ] `cd tugdeck && bun test` passes
- [ ] `cd tugcode && cargo clippy --workspace --all-targets -- -D warnings` passes

**Acceptance tests:**
- [ ] `just dev` starts successfully and browser opens to Vite URL
- [ ] Edit `tugdeck/src/index.css`, observe "Reloaded" flash on Developer card Styles row without page reload
- [ ] Edit a TSX component, observe React Fast Refresh without full page reload
- [ ] `cargo build -p tugcast` then touch the binary, observe "restart_available" notification in Developer card Code row

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Auto-restart Vite dev server on crash (currently manual restart)
- [ ] Support custom Vite port via CLI flag or config
- [ ] Explore Vite's `server.hmr` options for custom HMR behavior
- [ ] Consider removing the `reload_frontend` action handler from `action-dispatch.ts` if no longer needed by any feature

| Checkpoint | Verification |
|------------|--------------|
| Vite config compiles | `cd tugdeck && bun test` |
| Tugcast compiles clean | `cd tugcode && cargo build -p tugcast` with no warnings |
| Tugtool compiles clean | `cd tugcode && cargo build -p tugtool` with no warnings |
| Mac app builds | `xcodebuild ... build` succeeds |
| Full test suite | `cd tugcode && cargo nextest run --workspace && cd tugdeck && bun test` |
| Manual E2E | CSS hot-swap, TSX Fast Refresh, restart flow all work |
