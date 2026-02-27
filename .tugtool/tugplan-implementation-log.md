# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

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

