# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: #step-4
date: 2025-02-20T17:09:10Z
bead: tugtool-9o5.5
---

## #step-4: Deleted watch-assets.ts (168 lines of obsolete copy-to-dist logic). Rewrote dev.ts to minimal bun build --watch wrapper. Removed dev:assets script from package.json, simplified dev script to direct bun build --watch command. 475 bun tests pass.

**Files changed:**
- .tugtool/tugplan-dev-source-direct.md

---

---
step: #step-3
date: 2025-02-20T17:02:58Z
bead: tugtool-9o5.4
---

## #step-3: Updated ProcessManager to pass source tree root directly to --dev (removed tugdeckDistRel appending). Added bunProcess property and bun build --watch spawning in startProcess(). Updated stop() to terminate bun first then tugcast. Removed TugConfig.tugdeckDistRel constant. xcodebuild succeeds.

**Files changed:**
- .tugtool/tugplan-dev-source-direct.md

---

---
step: #step-2
date: 2025-02-20T16:55:43Z
bead: tugtool-9o5.3
---

## #step-2: Rewrote build.rs middle section to replace hardcoded fs::copy calls with manifest-driven loops. Reads tugdeck/assets.toml, iterates [files] for 1:1 copies, iterates [dirs] with glob pattern filtering. Replaced rerun-if-changed with manifest-derived entries using absolute paths. Bun build and tugtalk sections unchanged. 118 tests pass, OUT_DIR contains same 12 files.

**Files changed:**
- .tugtool/tugplan-dev-source-direct.md

---

---
step: #step-1
date: 2025-02-20T16:47:48Z
bead: tugtool-9o5.2
---

## #step-1: Replaced DevPath/ServeDir dev mode with manifest-based source-direct serving. Added AssetManifest/DevState structs, load_manifest, serve_dev_asset with three-tier lookup (files->dirs->fallback->404), path safety (percent-decode, normalize, canonicalize), reload script injection on / and /index.html. Removed tower-http, added percent-encoding. 118 tests pass including 15 new tests for path traversal, lookup tiers, and integration.

**Files changed:**
- .tugtool/tugplan-dev-source-direct.md

---

---
step: #step-0
date: 2025-02-20T16:26:33Z
bead: tugtool-9o5.1
---

## #step-0: Created asset manifest (tugdeck/assets.toml) with [files], [dirs], and [build] sections. Added glob to workspace deps, toml and glob to tugcast runtime deps, and explicit version pins for build-dependencies. Added cargo:rerun-if-changed for assets.toml in build.rs.

**Files changed:**
- .tugtool/tugplan-dev-source-direct.md

---

---
step: #step-2
date: 2025-02-20T03:30:54Z
bead: tugtool-wqb.3
---

## #step-2: Rewrote AppDelegate.swift menu bar: six menus (Tug, File, Edit, Developer, Window, Help), Settings window wiring, About panel, Help URLs, system menu registration, removed toggleDevMode.

**Files changed:**
- .tugtool/tugplan-mac-menus-settings.md

---

---
step: #step-1
date: 2025-02-20T03:23:04Z
bead: tugtool-wqb.2
---

## #step-1: Created SettingsWindow.swift with SettingsWindowController, registered in Xcode project. Settings window has dev mode toggle, source tree picker with validation, callback closures, and frame autosave.

**Files changed:**
- .tugtool/tugplan-mac-menus-settings.md

---

---
step: #step-0
date: 2025-02-20T03:13:00Z
bead: tugtool-wqb.1
---

## #step-0: Added NSHumanReadableCopyright key with 'Copyright © 2026 Ken Kocienda' to tugapp/Info.plist

**Files changed:**
- .tugtool/tugplan-mac-menus-settings.md

---

---
step: audit-fix
date: 2025-02-19T21:09:03Z
---

## audit-fix: Audit fix: removed redundant serde_json import in router.rs, changed map_or to is_some_and in dev.rs, added clippy::too_many_arguments allow on FeedRouter::new, ran cargo fmt. All clippy/fmt/test checks pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-6
date: 2025-02-19T21:03:15Z
bead: tugtool-bwn.7
---

## #step-6: Created tugcode/scripts/build-app.sh (189 lines) with full build pipeline: cargo build --release, bun build, xcodebuild, app bundle assembly, code signing, notarization, DMG creation. Supports --nightly (dev.tugtool.nightly bundle ID), --skip-sign, --skip-notarize flags. Created NightlyAppIcon.appiconset for nightly icon variant. Created .github/workflows/nightly.yml for daily CI builds on macOS-14 with certificate import and release upload.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-5
date: 2025-02-19T20:52:07Z
bead: tugtool-bwn.6
---

## #step-5: Created complete tugapp/ Mac app shell: Tug.xcodeproj with shared scheme, AppDelegate.swift (app lifecycle, Developer menu with dev mode toggle, Reload/Restart/Reset items), MainWindow.swift (WKWebView for 127.0.0.1:7890), ProcessManager.swift (tugcast process supervision with exit code contract 42=restart 43=reset), Info.plist with ATS exceptions for localhost/127.0.0.1, Tug.entitlements, Assets.xcassets. xcodebuild build succeeds.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-4
date: 2025-02-19T20:39:41Z
bead: tugtool-bwn.5
---

## #step-4: Added CONTROL (0xc0) feed ID to tugdeck protocol.ts, controlFrame factory, sendControlFrame on TugConnection and DeckManager, three Dock menu items (Restart Server, Reset Everything, Reload Frontend). Wired reload_tx broadcast sender from dev_file_watcher into FeedRouter, replaced reload_frontend stub with real SSE dispatch. Created protocol.test.ts with 3 tests. All 475 TypeScript and 99 Rust tests pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-3
date: 2025-02-19T20:30:44Z
bead: tugtool-bwn.4
---

## #step-3: Added FeedId::Control = 0xC0 to tugcast-core protocol with from_byte/as_byte support. Added Control frame handling in router.rs with JSON payload dispatch: restart sends exit 42, reset sends exit 43, reload_frontend is stub. Created shutdown channel pattern in main.rs with tokio::select! for orderly exit. 5 new protocol tests, all 46 tugcast-core and 99 tugcast tests pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-2
date: 2025-02-19T20:20:48Z
bead: tugtool-bwn.3
---

## #step-2: Created tugcast dev.rs module with SSE endpoint at /dev/reload, CSP-compliant /dev/reload.js script, index.html script injection before </body>, notify-based file watcher with .html/.css/.js extension filter and 300ms debounce, ReloadSender/DevPath Extension types. Updated build_app and run_server for dev routes. All 99 tests pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-1
date: 2025-02-19T20:11:11Z
bead: tugtool-bwn.2
---

## #step-1: Added --dev and --source-tree CLI flags to tugtool, source tree auto-detection, bun dev spawning with node_modules auto-install, supervisor loop handling exit codes 42 (restart) and 43 (reset), dual child process shutdown, Table T01 error handling. Created tugdeck/scripts/watch-assets.ts and dev.ts for dev asset assembly. All 15 tests pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: #step-0
date: 2025-02-19T20:01:26Z
bead: tugtool-bwn.1
---

## #step-0: Added tower-http workspace dependency, --dev flag to tugcast CLI, conditional ServeDir/serve_asset fallback in build_app and run_server, updated integration test helper, and added 4 new tests (2 CLI, 2 integration). All 95 tests pass.

**Files changed:**
- .tugtool/tugplan-dev-app-mode.md

---

---
step: audit-fix
date: 2025-02-19T18:05:06Z
---

## audit-fix: Audit fix round 2: git rm -r --cached target/ to remove 22k build artifacts from tracking, fixed 4 broken type imports (PanelState→CardState in 3 test files, PanelManager→DeckManager in deck-manager.test.ts)

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: audit-fix
date: 2025-02-19T17:57:45Z
---

## audit-fix: Audit fix: cargo fmt on build.rs, removed root target/ from git tracking, added /target/ to .gitignore, completed 159 missed panel→card TS symbol renames across 6 files

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-6
date: 2025-02-19T17:42:12Z
bead: tugtool-ovp.7
---

## #step-6: Moved Rust workspace into tugcode/ subdirectory. Fixed build.rs path depths, updated CI workflows with working-directory: tugcode, updated .gitignore, release scripts, CLAUDE.md, and README.md. Final mono-repo layout: tugcode/ (Rust), tugdeck/ (UI), tugplug/ (plugin)

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-5
date: 2025-02-19T17:26:21Z
bead: tugtool-ovp.6
---

## #step-5: Renamed launcher binary tug-launch to tugtool (final step of D01 three-step swap). Binary names now final: tugtool=launcher, tugcode=CLI

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-4
date: 2025-02-19T17:18:18Z
bead: tugtool-ovp.5
---

## #step-4: Renamed CLI binary tugtool to tugcode (step 2 of D01 three-step swap), claiming the freed tugcode name. Updated ~27 cli.rs occurrences, all agent/skill/hook files, both CLAUDE.md files, Formula, release.yml, and Justfile

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-3
date: 2025-02-19T17:05:51Z
bead: tugtool-ovp.4
---

## #step-3: Renamed launcher binary tugcode to tug-launch (step 1 of D01 three-step swap), freeing the tugcode name for the CLI binary

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-2
date: 2025-02-19T16:58:00Z
bead: tugtool-ovp.3
---

## #step-2: Moved plugin infrastructure to tugplug/ directory, renamed namespace tugtool: to tugplug:, split CLAUDE.md into root (project conventions) and tugplug/CLAUDE.md (plugin operations), updated release.yml and Formula share paths

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-1
date: 2025-02-19T16:47:14Z
bead: tugtool-ovp.2
---

## #step-1: Renamed panel/floating-panel to card/card-frame: 5 file renames, 676+ TS symbol updates, 36 CSS class renames, serialization v4→v5 with panels→cards key, build.rs and index.html updated

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: #step-0
date: 2025-02-19T15:56:41Z
bead: tugtool-ovp.1
---

## #step-0: Renamed all retronow/--rn-* references to tuglook/--tl-* in tokens.css, panels.css, cards.css, dock.css, and roadmap file

**Files changed:**
- .tugtool/tugplan-rename-reorganize.md

---

---
step: audit-fix
date: 2025-02-19T02:55:27Z
---

## audit-fix: Audit fix: clippy is_some_and in build.rs, added 2 dock tests (all 5 icon types, localStorage persistence) to meet L01 24-scenario requirement

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-5
date: 2025-02-19T02:50:05Z
bead: tugtool-j72.6
---

## #step-5: Final integration verification: all automated checkpoints passing, updated stale TugMenu JSDoc references to Dock in panel-manager.ts

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-4
date: 2025-02-19T02:40:55Z
bead: tugtool-j72.5
---

## #step-4: Deleted deck.css, updated build.rs to copy dock.css and fonts, updated index.html with dock.css link and --td-bg body background

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-3
date: 2025-02-19T02:34:15Z
bead: tugtool-j72.4
---

## #step-3: Created Dock component replacing TugMenu: 48px vertical rail with icon buttons, settings dropdown with theme select (Brio/Bluenote/Harmony), terminal theme reactivity via td-theme-change events

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-2
date: 2025-02-19T02:21:11Z
bead: tugtool-j72.3
---

## #step-2: Migrated cards.css to --td-* tokens and retronow aesthetic: rn-chip branch badge, rn-button gradient for send/approval, rn-field conversation input, rn-screen tool card

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-1
date: 2025-02-19T02:12:51Z
bead: tugtool-j72.2
---

## #step-1: Migrated panels.css to --td-* tokens and retronow aesthetic: titlebar gradient, rounded tabs, mono dropdowns, orange set-flash, disconnect banner moved from deck.css

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: #step-0
date: 2025-02-19T02:04:55Z
bead: tugtool-j72.1
---

## #step-0: Rewrote tokens.css with three-tier token architecture, installed IBM Plex Sans and Hack fonts locally, defined Brio/Bluenote/Harmony themes with body-class selectors

**Files changed:**
- .tugtool/tugplan-retronow-style-system.md

---

---
step: audit-fix
date: 2025-02-18T19:31:38Z
---

## audit-fix: CI fix: replaced timing-sensitive assertion in test_stats_runner_integration with ordering-agnostic subset check

**Files changed:**
- .tugtool/tugplan-snap-sets-shared-resize.md

---

---
step: #step-7
date: 2025-02-18T19:20:47Z
bead: tugtool-srv.8
---

## #step-7: Final polish: added _setMoveContext=null to destroy(). 4 new integration tests covering close-recompute set split, set dissolution, resetLayout cleanup, and pointercancel guide line hiding. All 450 tests pass.

**Files changed:**
- .tugtool/tugplan-snap-sets-shared-resize.md

---

---
step: #step-6
date: 2025-02-18T19:13:32Z
bead: tugtool-srv.7
---

## #step-6: Added set dragging to PanelManager. Top-most panel drags entire set with bounding-box snap against non-set panels. Non-top panels break out individually. Z-order captured in onFocus before focusPanel reorder. 5 new integration tests.

**Files changed:**
- .tugtool/tugplan-snap-sets-shared-resize.md

---

---
step: #step-5
date: 2025-02-18T19:00:33Z
bead: tugtool-srv.6
---

## #step-5: Added virtual sash system for shared-edge resize. Sashes are 8px hit targets at shared boundaries. Dragging resizes both panels with MIN_SIZE=100 clamping. CSS for col-resize/row-resize cursors and hover highlight. 4 new integration tests.

**Files changed:**
- .tugtool/tugplan-snap-sets-shared-resize.md

---

---
step: #step-4
date: 2025-02-18T18:51:45Z
bead: tugtool-srv.5
---

## #step-4: Added runtime set computation to PanelManager via recomputeSets(). Wired into onMoveEnd, onResizeEnd, and removeCard. Exposed getSets() for testing. 3 new integration tests.

**Files changed:**
- .tugtool/tugplan-snap-sets-shared-resize.md

---

