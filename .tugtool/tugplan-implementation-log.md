# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-5
date: 2025-02-28T15:56:36Z
---

## step-5: Added useEffect in developer-card.tsx to post badge state to devBadge bridge handler when stale state changes

**Files changed:**
- .tugtool/tugplan-dev-mode-completeness.md

---

---
step: step-4
date: 2025-02-28T15:45:10Z
---

## step-4: Added TugTheme UserDefaults key, updateBackgroundForTheme method mapping themes to NSColor sRGB values, setTheme bridge handler, and use-theme.ts bridge sync for native window background

**Files changed:**
- .tugtool/tugplan-dev-mode-completeness.md

---

---
step: step-3
date: 2025-02-28T15:37:56Z
---

## step-3: Split restart/reset case in ProcessManager.swift so reset follows relaunch path (stop Vite, doNotRestart). Updated reset button label to say relaunch.

**Files changed:**
- .tugtool/tugplan-dev-mode-completeness.md

---

---
step: step-2
date: 2025-02-28T15:33:45Z
---

## step-2: Widened Rust source watcher from tugcode/crates to tugcode/, added Cargo.lock to has_rust_extension(), added is_target_path() exclusion, updated frontend categorizeFile for Cargo.lock

**Files changed:**
- .tugtool/tugplan-dev-mode-completeness.md

---

---
step: step-1
date: 2025-02-28T15:27:44Z
---

## step-1: Changed .card-frame-content from overflow: hidden to overflow-y: auto to allow scrolling to Developer Mode toggle

**Files changed:**
- .tugtool/tugplan-dev-mode-completeness.md

---

---
step: step-5
date: 2025-02-28T02:40:33Z
---

## step-5: Moved 7 completed roadmap documents to roadmap/archive/. Updated dev-mode-notifications.md with Frontend/Backend naming, Rust source watcher note, Vite dev server references, and DONE markers for completed What to Remove items.

**Files changed:**
- .tugtool/tugplan-dev-mode-audit-fixes.md

---

---
step: step-4
date: 2025-02-28T02:32:56Z
---

## step-4: Added tracing::debug! logging in dev_compiled_watcher() after mtime change detection and in send_dev_notification() before/after broadcast send. Replaced silent let _ = send() with match that logs receiver count.

**Files changed:**
- .tugtool/tugplan-dev-mode-audit-fixes.md

---

---
step: step-3
date: 2025-02-28T02:25:12Z
---

## step-3: Fixed WKWebView flash by hiding webView until didFinishNavigation, setting drawsBackground=false, adding dark NSWindow background, and inline dark body background in index.html. Added diagnostic logging reduced to debug level.

**Files changed:**
- .tugtool/tugplan-dev-mode-audit-fixes.md

---

---
step: step-2
date: 2025-02-28T02:15:07Z
---

## step-2: Added has_rust_extension() helper and dev_rust_source_watcher() with 100ms debounce. Sends restart_available notifications when .rs or Cargo.toml files change. Integrated into DevRuntime and enable_dev_mode().

**Files changed:**
- .tugtool/tugplan-dev-mode-audit-fixes.md

---

---
step: step-1
date: 2025-02-28T02:09:04Z
---

## step-1: Renamed file categorization from Styles/Code to Frontend/Backend in developer card. Updated categorizeFile() return values, all state variables, UI labels, and restructured tests.

**Files changed:**
- .tugtool/tugplan-dev-mode-audit-fixes.md

---

---
step: step-4
date: 2025-02-27T22:14:41Z
---

## step-4: Added VITE_DEV_PORT variable to Justfile and replaced hardcoded 5173 in lsof command with variable reference

**Files changed:**
- .tugtool/tugplan-dev-mode-port-hardening.md

---

---
step: step-3
date: 2025-02-27T22:10:02Z
---

## step-3: Added defaultVitePort constant to TugConfig, added tugcastPort stored property and dynamic controlSocketPath to ProcessManager, parameterized spawnViteDevServer/waitForViteReady/sendDevMode, added vitePort property to AppDelegate and updated all call sites

**Files changed:**
- .tugtool/tugplan-dev-mode-port-hardening.md

---

---
step: step-2
date: 2025-02-27T22:03:28Z
---

## step-2: Added tugcast-core dependency to tugtool, parameterized spawn_vite_dev, wait_for_vite, rewrite_auth_url_to_vite_port, and send_dev_mode with vite_port parameter, updated supervisor_loop to use DEFAULT_VITE_DEV_PORT constant, updated and added tests

**Files changed:**
- .tugtool/tugplan-dev-mode-port-hardening.md

---

---
step: step-1
date: 2025-02-27T21:58:10Z
---

## step-1: Added DEFAULT_VITE_DEV_PORT constant to tugcast-core, added vite_port field to DevMode control message with backward-compatible serde default, updated handler to use runtime port with fallback, updated doc comments, added tests

**Files changed:**
- .tugtool/tugplan-dev-mode-port-hardening.md

---

---
step: step-6
date: 2025-02-27T20:22:37Z
---

## step-6: Deleted stale roadmap/dev-mode-vite-dev-server.md, removed send_shutdown dead code from control.rs. All checks pass: fmt, clippy, 746 Rust tests, 429 TS tests.

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-5
date: 2025-02-27T20:13:19Z
---

## step-5: Replaced reloaded notification with Vite HMR vite:afterUpdate events via td-hmr-update CustomEvent. Removed reloaded from DevNotificationEvent type. Updated pending-flag confirmation tests to use cross-category notifications.

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-4
date: 2025-02-27T20:05:08Z
---

## step-4: Updated ProcessManager to spawn Vite dev server from onReady callback with runtime tugcast port, removed old vite build --watch from startProcess, added auth URL rewrite to port 5173 in AppDelegate

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-3
date: 2025-02-27T19:58:07Z
---

## step-3: Replaced spawn_vite_watch with spawn_vite_dev, removed ensure_dist_populated, modified wait_for_ready to extract tugcast port, added auth URL rewrite to target Vite port 5173

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-2
date: 2025-02-27T19:51:47Z
---

## step-2: Removed dist-based asset serving, styles watcher, frontend_dirty tracking, reload_frontend broadcast. Simplified DevState to source_tree only. Deleted 20+ tests for removed code paths.

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-1
date: 2025-02-27T19:38:43Z
---

## step-1: Updated vite.config.ts with proxy entries for /auth, /ws, /api targeting tugcast via TUGCAST_PORT env var

**Files changed:**
- .tugtool/tugplan-dev-mode-vite-dev-server.md

---

---
step: step-3
date: 2025-02-27T15:40:36Z
---

## step-3: Replaced optimistic stale-clearing on Restart/Relaunch click with pending-flag confirmation pattern using useRef booleans, updated and added tests

**Files changed:**
- .tugtool/tugplan-dev-mode-post-react.md

---

---
step: step-2
date: 2025-02-27T15:33:24Z
---

## step-2: Replaced spawn_bun_dev with ensure_dist_populated + spawn_vite_watch, renamed bun_child to vite_child throughout, removed check_command_available

**Files changed:**
- .tugtool/tugplan-dev-mode-post-react.md

---

---
step: step-1
date: 2025-02-27T15:27:46Z
---

## step-1: Replaced bun build --watch watcher with Vite build --watch using project-local Vite binary in ProcessManager.swift

**Files changed:**
- .tugtool/tugplan-dev-mode-post-react.md

---

---
step: audit-fix
date: 2025-02-27T03:20:10Z
---

## audit-fix: CI fix: regenerated bun.lock to match package.json after isomorphic-dompurify removal

**Files changed:**
- .tugtool/tugplan-react-shadcn-adoption.md

---

---
step: step-10
date: 2025-02-27T03:13:08Z
---

## step-10: Deleted all vanilla TS card implementation files, conversation submodule files, vanilla test files, and cards.css. Updated chrome-layer tests (card-menus, card-header, e2e-integration) to use mock TugCardMeta objects. Removed isomorphic-dompurify dependency. Inlined categorizeFile and processFile into React components. 427 bun tests pass, 767 Rust tests pass.

**Files changed:**
- .tugtool/tugplan-react-shadcn-adoption.md

---

