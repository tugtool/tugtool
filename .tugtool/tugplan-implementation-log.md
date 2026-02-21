# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: #step-4
date: 2025-02-21T16:44:06Z
bead: tugtool-i2v.5
---

## #step-4: Removed println/flush/Write stdout auth URL printing from tugcast main.rs, kept tracing info! line

**Files changed:**
- .tugtool/tugplan-control-socket.md

---

---
step: #step-3
date: 2025-02-21T16:39:56Z
bead: tugtool-i2v.4
---

## #step-3: Replaced tugtool CLI stdout-parsing with UDS control socket IPC, removed regex dependency, added create_control_listener/wait_for_ready, rewrote supervisor_loop with RestartDecision state machine

**Files changed:**
- .tugtool/tugplan-control-socket.md

---

---
step: #step-2
date: 2025-02-21T16:29:55Z
bead: tugtool-i2v.3
---

## #step-2: Created actions.rs with dispatch_action(), control.rs with ControlSocket UDS client, refactored server.rs and router.rs to use dispatch_action, wired control socket into main.rs

**Files changed:**
- .tugtool/tugplan-control-socket.md

---

---
step: #step-1
date: 2025-02-21T16:20:00Z
bead: tugtool-i2v.2
---

## #step-1: Extracted TcpListener::bind from run_server to main.rs, removed unused SharedAuthState parameter

**Files changed:**
- .tugtool/tugplan-control-socket.md

---

---
step: #step-0
date: 2025-02-21T16:15:11Z
bead: tugtool-i2v.1
---

## #step-0: Added --control-socket CLI flag to tugcast with three unit tests

**Files changed:**
- .tugtool/tugplan-control-socket.md

---

---
step: audit-fix
date: 2025-02-21T04:27:50Z
---

## audit-fix: Audit fix: cargo fmt on tugcode/crates/tugcast/src/dev.rs to fix chain formatting and comment alignment

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-9
date: 2025-02-21T04:23:55Z
bead: tugtool-bs2.10
---

## #step-9: Added error logging completion handlers to all four evaluateJavaScript calls in MainWindow.swift WKScriptMessageHandler extension (chooseSourceTree selected/cancelled, setDevMode, getSettings). Makes invisible WebKit-level errors observable via Console.app without disrupting UX.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-8
date: 2025-02-21T04:19:08Z
bead: tugtool-bs2.9
---

## #step-8: Applied deferred-restart pattern to source tree changes. Removed processManager restart blocks from chooseSourceTree and bridgeChooseSourceTree in AppDelegate.swift. Added initialSourceTree/currentSourceTree tracking to settings-card.ts, generalized prompt text to 'Settings changed. Restart to apply.', extended updateRestartPrompt to handle source tree changes when dev mode is enabled.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-7
date: 2025-02-21T04:11:28Z
bead: tugtool-bs2.8
---

## #step-7: Added _resetForTest() to action-dispatch.ts. Created deck-manager.test.ts (closePanelByComponent regression) and action-dispatch.test.ts (show-card/close-card dispatch). 7 tests pass covering all branches. Added bunfig.toml for happy-dom preload.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-6
date: 2025-02-21T04:02:20Z
bead: tugtool-bs2.7
---

## #step-6: Verification-only step: traced bridgeGetSettings/onSettingsLoaded flow across settings-card.ts, MainWindow.swift, and AppDelegate.swift. Confirmed runtimeDevMode tracking is correct for restart prompt persistence across close-and-reopen. No issues found, no code changes needed.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-5
date: 2025-02-21T03:56:57Z
bead: tugtool-bs2.6
---

## #step-5: Gate About Tug and Settings menu items on frontendReady bridge signal fired from connection.onOpen in main.ts. Harden tell() with error logging (nil serverPort guard, HTTP error/status logging). Added bridgeFrontendReady to BridgeDelegate protocol and routing in MainWindow.swift.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-4
date: 2025-02-21T03:49:38Z
bead: tugtool-bs2.5
---

## #step-4: Added Restart Now prompt to Settings card with fail-safe timer, onClose API to TugConnection mirroring onOpen with unsubscribe, wired initialDevMode from runtimeDevMode for correct prompt persistence, added CSS styling for restart prompt.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-3
date: 2025-02-21T03:40:58Z
bead: tugtool-bs2.4
---

## #step-3: Deleted td-reopen-settings onOpen callback block from main.ts (lines 70-79). This completes full removal of the hack — step 2 removed the WRITE side, this step removed the READ side. Zero references remain in codebase.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-2
date: 2025-02-21T03:37:25Z
bead: tugtool-bs2.3
---

## #step-2: Replaced optimistic-update-with-rollback UI with confirmed UI pattern for dev mode toggle. Checkbox disables during bridge round-trip, confirms on ack, reverts on timeout. Removed td-reopen-settings localStorage hack and previousDevModeState field. Added updateRestartPrompt stub for step 4.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-1
date: 2025-02-21T03:31:29Z
bead: tugtool-bs2.2
---

## #step-1: Fixed closePanelByComponent type mismatch where activeTab.id (string) was passed to removeCard() which expects TugCard. Now uses cardRegistry.get() lookup matching existing patterns.

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: #step-0
date: 2025-02-21T03:27:20Z
bead: tugtool-bs2.1
---

## #step-0: Removed processManager.stop()/start() from bridgeSetDevMode, added runtimeDevMode field to AppDelegate, updated bridgeGetSettings to return both preference and runtime dev mode state, updated BridgeDelegate protocol and MainWindow handler

**Files changed:**
- .tugtool/tugplan-fix-external-commands.md

---

---
step: audit-fix
date: 2025-02-20T23:43:36Z
---

## audit-fix: CI fix: changed test value 3.14 to 2.5 in tell.rs to avoid clippy approx_constant warning

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: audit-fix
date: 2025-02-20T23:38:08Z
---

## audit-fix: Audit fix: cargo fmt formatting corrections across 4 files, moved tell CLI tests inside mod tests block in cli.rs

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-6
date: 2025-02-20T23:31:53Z
bead: tugtool-5dh.7
---

## #step-6: Fix About card logo SVG and add end-to-end integration tests for tell endpoint round-trip and loopback security

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-5
date: 2025-02-20T23:23:50Z
bead: tugtool-5dh.6
---

## #step-5: Add tugcode tell CLI subcommand with param type coercion and ureq HTTP client

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-4
date: 2025-02-20T23:10:52Z
bead: tugtool-5dh.5
---

## #step-4: Add WKScriptMessageHandler bridge to MainWindow, rewire Mac app menu actions to tell() HTTP endpoint, delete SettingsWindow

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-3
date: 2025-02-20T23:00:13Z
bead: tugtool-5dh.4
---

## #step-3: Wire dock About menu item to action dispatcher for About card integration

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-2
date: 2025-02-20T22:56:32Z
bead: tugtool-5dh.3
---

## #step-2: Add About and Settings cards with WKScriptMessageHandler bridge integration for theme, dev mode, and source tree settings

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-1
date: 2025-02-20T22:47:01Z
bead: tugtool-5dh.2
---

## #step-1: Add action dispatcher with Map-based handler registry and 7 built-in action handlers for tugdeck

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

---
step: #step-0
date: 2025-02-20T22:39:00Z
bead: tugtool-5dh.1
---

## #step-0: Add POST /api/tell endpoint and client_action_tx broadcast channel for external command interface

**Files changed:**
- .tugtool/tugplan-tugtell-external-command.md

---

