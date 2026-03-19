## Phase 1.0: Remove SSE Reload, Unify on WebSocket Control Frames {#phase-sse-to-ws}

**Purpose:** Eliminate the redundant SSE-based hot-reload notification path and make the dev-mode file watcher deliver reload signals exclusively through WebSocket Control frames, fixing WKWebView reliability and reducing code complexity.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-21 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current dev-mode hot-reload system has two parallel notification paths that were built at different times. The SSE path (`/dev/reload` endpoint, `reload.js` injection, `ReloadSender` newtype, `broadcast::channel<()>`) was built before the WebSocket Control frame infrastructure existed. The WebSocket path (`{\"action\":\"reload_frontend\"}` Control frame dispatched by `action-dispatch.ts`) was added later as part of the control socket and tell infrastructure.

Both paths trigger `location.reload()` in the browser, but only the WebSocket path works reliably in WKWebView. The SSE path's `EventSource` does not fire in WKWebView, meaning the macOS app's "Reload Frontend" menu command works (routed via WebSocket) but file-change hot-reload does not (SSE only). The `dev_file_watcher` currently sends on both channels, but only the WebSocket signal arrives in the native app.

#### Strategy {#strategy}

- Remove all SSE reload infrastructure, reload_tx threading, and affected tests atomically in a single commit across all seven source files (dev.rs, actions.rs, control.rs, router.rs, server.rs, main.rs, integration_tests.rs), because: (a) the type changes cascade across tightly-coupled function signatures, and (b) integration_tests.rs is a `#[cfg(test)]` module in the same compilation unit, so it must compile together with the source changes
- Simplify `dev_file_watcher` to send only the WebSocket Control frame via `client_action_tx`
- Remove the `reload_frontend` special case from `dispatch_action` that fires `reload_tx`
- Verify the build compiles with zero warnings and all tests pass (project enforces `-D warnings`)

#### Stakeholders / Primary Customers {#stakeholders}

1. macOS app users (WKWebView) who currently have broken file-change hot-reload
2. Developer experience: fewer channels to reason about, simpler signatures

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build` succeeds with zero warnings for the tugcast crate
- `cargo nextest run` passes all remaining tests
- No references to `ReloadSender`, `reload_tx`, `/dev/reload`, `reload.js`, or `inject_reload_script` remain in the codebase
- File changes in dev mode trigger `location.reload()` via WebSocket Control frame in both browser and WKWebView

#### Scope {#scope}

1. Remove `/dev/reload` SSE endpoint
2. Remove `/dev/reload.js` serving endpoint
3. Remove reload script injection into `index.html`
4. Remove `ReloadSender` newtype and `broadcast::channel<()>` for SSE
5. Remove `reload_tx` from all function signatures
6. Simplify `dev_file_watcher` to use only `client_action_tx`
7. Remove `reload_frontend` special case from `dispatch_action`
8. Delete dead tests and update affected integration tests

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the WebSocket Control frame protocol or `action-dispatch.ts`
- Adding new frontend reload logic (the existing `reload_frontend` handler in `action-dispatch.ts` already works)
- Changing the file watcher debounce logic or watch directory derivation
- Modifying production (non-dev) asset serving

#### Dependencies / Prerequisites {#dependencies}

- The WebSocket Control frame infrastructure and `client_action_tx` broadcast channel are already in place
- The `reload_frontend` action handler is already registered in `action-dispatch.ts`

#### Constraints {#constraints}

- Project enforces `-D warnings` via `tugcode/.cargo/config.toml` -- the build must be warning-free at every commit
- Removal must not break production (non-dev) mode asset serving

#### Assumptions {#assumptions}

- The `client_action_tx` broadcast channel is always available when dev mode is active (it is created unconditionally in `main.rs`)
- The existing `reload_frontend` handler in `action-dispatch.ts` with its dedup guard is sufficient
- No external consumers depend on the `/dev/reload` SSE endpoint or `/dev/reload.js`

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Remove SSE reload path entirely (DECIDED) {#d01-remove-sse}

**Decision:** Remove all SSE reload infrastructure rather than fixing it for WKWebView.

**Rationale:**
- WebSocket Control frames already deliver `reload_frontend` reliably in all environments
- Two parallel notification paths for the same signal is unnecessary complexity
- SSE `EventSource` does not work in WKWebView and fixing it would require a polyfill or bridging layer

**Implications:**
- The `ReloadSender` newtype, `broadcast::channel<()>`, and all SSE endpoint code are deleted
- The `reload_tx` parameter is removed from six function signatures across five files
- Tests asserting SSE behavior are deleted

#### [D02] File watcher sends only WebSocket Control frame (DECIDED) {#d02-watcher-websocket-only}

**Decision:** `dev_file_watcher` sends only a WebSocket Control frame via `client_action_tx`, not a parallel SSE signal.

**Rationale:**
- Eliminates the dual-send in the watcher's debounce task
- The `client_action_tx` broadcast channel is already created unconditionally in `main.rs` and subscribed to by all WebSocket clients in `handle_client`

**Implications:**
- `dev_file_watcher` return type simplifies from `Result<(broadcast::Sender<()>, RecommendedWatcher), String>` to `Result<RecommendedWatcher, String>`
- The `reload_tx` local in `main.rs` and its clones are removed

#### [D03] Remove reload_frontend special case from dispatch_action (DECIDED) {#d03-simplify-dispatch}

**Decision:** The `reload_frontend` arm in `dispatch_action` that fires `reload_tx` is removed. The action becomes a regular client-only action (falls through to the default broadcast arm).

**Rationale:**
- With `reload_tx` gone, the `reload_frontend` match arm has no server-side effect
- Broadcasting the Control frame to clients is the same behavior as the default arm
- This reduces `dispatch_action` from four match arms to three

**Implications:**
- `dispatch_action` signature drops the `reload_tx` parameter
- The `reload_frontend` integration test (`test_tell_reload_frontend`) is updated to verify only the `client_action_tx` broadcast, not `reload_rx`

#### [D04] Serve index.html without injection in dev mode (DECIDED) {#d04-no-injection}

**Decision:** In dev mode, `index.html` is served as-is from disk without any script injection.

**Rationale:**
- The injected `<script src="/dev/reload.js"></script>` loaded an `EventSource` for SSE -- with SSE removed, there is nothing to inject
- The WebSocket connection (established by the app's own JS) already receives Control frames including `reload_frontend`

**Implications:**
- `inject_reload_script` function is deleted
- `serve_dev_index_impl` reads and serves the file directly without modification
- The `serve_dev_index` handler and `serve_dev_asset` index.html special case are simplified

---

### 1.0.1 Symbol Inventory {#symbol-inventory}

#### 1.0.1.1 Symbols to remove {#symbols-remove}

**List L01: Symbols to Remove** {#l01-symbols-remove}

**dev.rs -- structs and functions:**
- ReloadSender (struct) -- newtype wrapper for broadcast::Sender<()>
- inject_reload_script (fn) -- injects script tag before closing body tag
- serve_dev_reload_js (fn) -- serves inline EventSource JS
- dev_reload_handler (fn) -- SSE endpoint handler

**Cross-file -- reload_tx threading:**
- reload_tx field on FeedRouter in router.rs -- Option<broadcast::Sender<()>>
- reload_tx param on dispatch_action in actions.rs -- &Option<broadcast::Sender<()>>
- reload_tx param on build_app in server.rs -- Option<broadcast::Sender<()>>
- reload_tx param on run_server in server.rs -- Option<broadcast::Sender<()>>
- reload_tx param on run_recv_loop in control.rs -- Option<broadcast::Sender<()>>
- reload_tx local in main.rs -- let (reload_tx, _) and all clones

**Tests to delete:**
- test_inject_reload_script (unit, dev.rs)
- test_inject_reload_script_no_body_tag (unit, dev.rs)
- test_serve_dev_reload_js (unit, dev.rs)
- test_dev_reload_sse_endpoint (integration, integration_tests.rs)

#### 1.0.1.2 Symbols to modify {#symbols-modify}

**List L02: Symbols to Modify** {#l02-symbols-modify}

- dev_file_watcher (fn, dev.rs) -- return Result<RecommendedWatcher, String>, remove reload_tx creation and SSE send
- FeedRouter::new (fn, router.rs) -- remove reload_tx parameter
- dispatch_action (fn, actions.rs) -- remove reload_tx param, remove reload_frontend match arm
- build_app (fn, server.rs) -- remove reload_tx param, remove SSE routes and ReloadSender layer
- run_server (fn, server.rs) -- remove reload_tx param
- run_recv_loop (fn, control.rs) -- remove reload_tx param from signature and dispatch_action call
- serve_dev_index_impl (fn, dev.rs) -- serve HTML directly without inject_reload_script
- main (fn, main.rs) -- remove reload_tx local and all its threading

#### 1.0.1.3 Imports to clean up {#imports-cleanup}

**List L03: Imports to Clean Up** {#l03-imports-cleanup}

- dev.rs -- remove axum::response::sse::{Event, KeepAlive, Sse}, futures::Stream, std::convert::Infallible, tokio::sync::broadcast
- server.rs -- remove tokio::sync::broadcast (if no other uses remain)
- main.rs -- remove references to dev::ReloadSender or broadcast::channel::<()> usage

---

### 1.0.2 Execution Steps {#execution-steps}

#### Step 0: Remove SSE infrastructure and reload_tx from all source files {#step-0}

**Commit:** `refactor(tugcast): remove SSE reload infrastructure, unify on WebSocket Control frames`

**References:** [D01] Remove SSE reload path entirely, [D02] File watcher sends only WebSocket Control frame, [D03] Remove reload_frontend special case, [D04] Serve index.html without injection, List L01 (#l01-symbols-remove), List L02 (#l02-symbols-modify), List L03 (#l03-imports-cleanup)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs`
- Modified `tugcode/crates/tugcast/src/actions.rs`
- Modified `tugcode/crates/tugcast/src/control.rs`
- Modified `tugcode/crates/tugcast/src/router.rs`
- Modified `tugcode/crates/tugcast/src/server.rs`
- Modified `tugcode/crates/tugcast/src/main.rs`
- Modified `tugcode/crates/tugcast/src/integration_tests.rs`

> All seven files must change in a single commit because: (1) the type changes
> cascade across tightly-coupled function signatures -- changing `dev_file_watcher`'s
> return type breaks `main.rs`, removing `reload_tx` from `dispatch_action` breaks
> its callers in `server.rs`, `router.rs`, and `control.rs`, and removing it from
> `run_recv_loop` breaks its caller in `main.rs`; and (2) `integration_tests.rs` is
> a `#[cfg(test)] mod` in the same crate, so it must compile together with the
> source changes -- a separate commit would fail `cargo build --tests`.

**Tasks:**

**dev.rs:**
- [ ] Delete `ReloadSender` struct
- [ ] Delete `inject_reload_script` function
- [ ] Delete `serve_dev_reload_js` function
- [ ] Delete `dev_reload_handler` function
- [ ] Simplify `dev_file_watcher`: remove `broadcast::channel::<()>` creation, remove `tx_clone` and SSE send (`let _ = tx_clone.send(());`), change return type from `Result<(broadcast::Sender<()>, RecommendedWatcher), String>` to `Result<RecommendedWatcher, String>`
- [ ] Simplify `serve_dev_index_impl`: remove `inject_reload_script` call, serve HTML content directly via `std::fs::read` instead of `read_to_string` + injection
- [ ] Update the comment on the `serve_dev_asset` index.html special case (line 205) from "Special case: index.html gets reload script injection" to "Special case: index.html served from disk" (the injection is gone)
- [ ] Remove unused imports: `sse::{Event, KeepAlive, Sse}`, `futures::Stream`, `std::convert::Infallible`, `tokio::sync::broadcast`
- [ ] Delete unit tests: `test_inject_reload_script`, `test_inject_reload_script_no_body_tag`, `test_serve_dev_reload_js`
- [ ] Update `test_serve_dev_asset_index_html_injection`: assert that index.html is served without the reload script tag

**actions.rs:**
- [ ] Remove `reload_tx: &Option<broadcast::Sender<()>>` parameter from `dispatch_action`
- [ ] Remove the `"reload_frontend"` match arm (it becomes a regular client-only action falling through to the default `other =>` arm)
- [ ] Update unit tests `test_dispatch_action_restart` and `test_dispatch_action_unknown` to call `dispatch_action` without the `reload_tx` parameter

**control.rs:**
- [ ] Remove `reload_tx: Option<broadcast::Sender<()>>` parameter from `run_recv_loop`
- [ ] Update the `dispatch_action` call inside `run_recv_loop` to drop the `reload_tx` argument

**router.rs:**
- [ ] Remove `pub(crate) reload_tx: Option<broadcast::Sender<()>>` field from `FeedRouter`
- [ ] Remove `reload_tx` parameter from `FeedRouter::new` and its assignment in the constructor body
- [ ] Remove `&router.reload_tx` from the `dispatch_action` call inside `handle_client` (the `FeedId::Control` match arm)

**server.rs:**
- [ ] Remove `reload_tx` parameter from `build_app` signature
- [ ] Simplify the dev-mode branch in `build_app`: remove `ReloadSender` layer, remove `/dev/reload` and `/dev/reload.js` routes, change the condition from `if let (Some(state), Some(tx)) = (dev_state, reload_tx)` to `if let Some(state) = dev_state`
- [ ] Remove `&router.reload_tx` from the `dispatch_action` call in `tell_handler`
- [ ] Remove `reload_tx` parameter from `run_server` signature and its forwarding to `build_app`
- [ ] Remove `use tokio::sync::broadcast` if no longer needed
- [ ] Update `test_action_classification`: remove the "Hybrid" assertions that classify `reload_frontend` alongside `reset` -- `reload_frontend` is now client-only, so move it to the "Client-only" section or remove those assertions entirely

**main.rs:**
- [ ] Remove `reload_tx` from the `dev_file_watcher` return destructuring (change `(Some(Arc::new(state)), Some(tx), Some(watcher))` to `(Some(Arc::new(state)), Some(watcher))`)
- [ ] Remove the `(None, None, None)` else-arm adjustment to `(None, None)`
- [ ] Remove `ctl_reload_tx` clone
- [ ] Remove `reload_tx.clone()` from `FeedRouter::new` call
- [ ] Remove `reload_tx` from `reader.run_recv_loop(...)` call
- [ ] Remove `reload_tx` from `server::run_server(...)` call

**integration_tests.rs (same compilation unit -- must update in this commit):**

**build_test_app helper (used by ~10 tests):**
- [ ] Remove `None` for `reload_tx` from the `FeedRouter::new` call (the parameter no longer exists)
- [ ] Remove `None` for `reload_tx` from the `build_app` call (the parameter no longer exists)

**Tests to delete:**
- [ ] Delete `test_dev_reload_sse_endpoint` test entirely

**Tests with direct FeedRouter::new and build_app calls (not using build_test_app):**
- [ ] Update `test_build_app_dev_mode`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls, remove assertion for `<script src="/dev/reload.js"></script>` in body
- [ ] Update `test_manifest_based_serving_index_html_injection`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls, change assertion from checking for reload script to checking that the HTML is served unmodified (rename test to `test_manifest_based_serving_index_html`)
- [ ] Update `test_manifest_based_serving_files_entry`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls
- [ ] Update `test_manifest_based_serving_dirs_entry`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls
- [ ] Update `test_manifest_based_serving_path_traversal`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls
- [ ] Update `test_manifest_based_serving_unknown_path_404`: remove `reload_tx` from `FeedRouter::new` and `build_app` calls
- [ ] Update `test_tell_reload_frontend`: remove `reload_tx` from `FeedRouter::new`, remove `reload_rx` and `reload_tx` broadcast channel creation, remove assertion on `reload_rx.try_recv()`, keep assertion on `client_action_rx` (verifying the Control frame is broadcast)
- [ ] Update `test_tell_restart_triggers_shutdown`: remove `reload_tx` (`None`) from `FeedRouter::new` call
- [ ] Update `test_tell_hybrid_reset_timing`: remove `reload_tx` (`None`) from `FeedRouter::new` call
- [ ] Update `test_tell_client_action_round_trip`: remove `reload_tx` (`None`) from `FeedRouter::new` call

**Import cleanup:**
- [ ] Remove unused import of `dev` in integration_tests.rs if no longer referenced
- [ ] Remove `broadcast::channel::<()>` usage in integration_tests.rs if no tests still create one

**Tests:**
- [ ] Existing unit tests for `load_manifest`, `watch_dirs`, `validate_manifest`, `serve_dev_asset` variants, and path traversal remain passing
- [ ] Unit tests in `actions.rs` pass with updated signatures
- [ ] Unit tests in `control.rs` are unaffected (they don't call `dispatch_action`)
- [ ] Unit tests in `router.rs` are unaffected (they test state machine constants, not `FeedRouter::new`)
- [ ] All integration tests pass

**Checkpoint:**
- [ ] `cargo build -p tugcast 2>&1 | grep warning` produces no output (zero warnings)
- [ ] `cargo nextest run -p tugcast` -- full test suite passes with zero failures
- [ ] `grep -r "ReloadSender\|reload_tx\|reload\.js\|dev/reload\|inject_reload_script" tugcode/crates/tugcast/src/` returns no matches

**Rollback:**
- `git checkout -- tugcode/crates/tugcast/src/dev.rs tugcode/crates/tugcast/src/actions.rs tugcode/crates/tugcast/src/control.rs tugcode/crates/tugcast/src/router.rs tugcode/crates/tugcast/src/server.rs tugcode/crates/tugcast/src/main.rs tugcode/crates/tugcast/src/integration_tests.rs`

**Commit after all checkpoints pass.**

---

### 1.0.3 Deliverables and Checkpoints {#deliverables}

**Deliverable:** All dev-mode hot-reload signals flow exclusively through WebSocket Control frames; SSE reload infrastructure is completely removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugcast` succeeds with zero warnings
- [ ] `cargo nextest run -p tugcast` passes all tests
- [ ] `grep -rn "ReloadSender\|reload_tx\|/dev/reload\|reload\.js\|inject_reload_script\|EventSource\|KeepAlive\|Sse\b" tugcode/crates/tugcast/src/` returns zero matches (confirming complete removal)
- [ ] File changes in dev mode produce a `{\"action\":\"reload_frontend\"}` Control frame on the WebSocket (manual verification or log inspection)

**Acceptance tests:**
- [ ] Integration test: `test_tell_reload_frontend` verifies that `reload_frontend` action broadcasts a Control frame via `client_action_tx`
- [ ] Integration test: `test_build_app_dev_mode` verifies dev mode serves `index.html` without SSE script injection
- [ ] Unit test: `test_dispatch_action_unknown` covers that `reload_frontend` now falls through to the default broadcast arm

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider adding a health-check endpoint for dev mode that confirms the WebSocket is connected
- [ ] Evaluate whether the `futures` crate dependency can be removed if SSE was its only consumer

| Checkpoint | Verification |
|------------|--------------|
| Zero warnings | `cargo build -p tugcast 2>&1 \| grep warning` returns empty |
| All tests pass | `cargo nextest run -p tugcast` exits 0 |
| No SSE remnants | `grep -rn "ReloadSender\|reload_tx" tugcode/crates/tugcast/src/` returns empty |

**Commit after all checkpoints pass.**
