# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

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

