# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: #step-6
date: 2025-02-16T02:11:24Z
bead: tugtool-p17.7
---

## #step-6: Added @xterm/addon-webgl@0.19.0 dependency and progressive WebGL activation in terminal-card.ts. Silent fallback to canvas renderer on failure. Bundle size increased from ~480kb to ~648kb. 75 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-5
date: 2025-02-16T02:05:52Z
bead: tugtool-p17.6
---

## #step-5: Added card collapse/expand to DeckManager with button injection, grid track updates (28px collapsed, 1fr expanded), and localStorage layout persistence (500ms debounce). Terminal card marked non-collapsible. 75 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-4
date: 2025-02-16T01:57:43Z
bead: tugtool-p17.5
---

## #step-4: Added WebSocket reconnection with exponential backoff (2s→30s cap), ConnectionState tracking, disconnect banner with countdown, and intentionalClose flag. Updated connection.ts, deck.css, index.html. 75 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-3
date: 2025-02-16T01:51:28Z
bead: tugtool-p17.4
---

## #step-3: Rewrote stats-card.ts with Sparkline (Canvas 2D ring buffer), SubCard helper, and StatsCard with three color-coded sub-cards. Updated cards.css. esbuild bundles successfully, 75 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-2
date: 2025-02-16T01:45:24Z
bead: tugtool-p17.3
---

## #step-2: Wired stats collectors into main.rs startup. Created watch channels for Stats (0x30), StatsProcessInfo (0x31), StatsTokenUsage (0x32), StatsBuildStatus (0x33). Spawned StatsRunner as background task. Removed dead_code annotations. 75 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-1
date: 2025-02-16T01:38:42Z
bead: tugtool-p17.2
---

## #step-1: Created stats feed module with StatCollector trait, StatsRunner, and three collector implementations (ProcessInfo, TokenUsage, BuildStatus). Added sysinfo, chrono, regex deps. 75 tugcast tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

