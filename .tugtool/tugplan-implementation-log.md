# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

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

