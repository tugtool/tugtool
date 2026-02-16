# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: #step-1
date: 2025-02-16T18:15:04Z
bead: tugtool-236.2
---

## #step-1: Installed Lucide v0.564.0 and replaced all text-character icons with SVG icons using createElement API. Refactored innerHTML to programmatic DOM construction. Bundle size increased only 4KB.

**Files changed:**
- .tugtool/tugplan-design-tokens-icons-polish.md

---

---
step: #step-0
date: 2025-02-16T18:05:04Z
bead: tugtool-236.1
---

## #step-0: Created two-tier design token system (tokens.css) with 46 CSS custom properties. Replaced all hardcoded hex colors in cards.css, deck.css, index.html, terminal-card.ts, and stats-card.ts with semantic token references.

**Files changed:**
- .tugtool/tugplan-design-tokens-icons-polish.md

---

---
step: audit-fix
date: 2025-02-16T17:21:11Z
---

## audit-fix: Audit fix: ran cargo fmt on crates/tugcast/build.rs to collapse multi-line chain per rustfmt

**Files changed:**
- .tugtool/tugplan-bun-pivot.md

---

---
step: #step-1
date: 2025-02-16T17:16:17Z
bead: tugtool-icp.2
---

## #step-1: Updated CI and release workflows: added oven-sh/setup-bun@v2 with pinned 1.3.x, node_modules cache keyed by bun.lock, and bun install --frozen-lockfile to build/clippy/release jobs

**Files changed:**
- .tugtool/tugplan-bun-pivot.md

---

---
step: #step-0
date: 2025-02-16T17:10:53Z
bead: tugtool-icp.1
---

## #step-0: Replaced npm/esbuild with Bun: updated build.rs (bun existence check, bun install, bun build), updated package.json scripts, removed devDependencies, deleted package-lock.json, generated bun.lock

**Files changed:**
- .tugtool/tugplan-bun-pivot.md

---

---
step: audit-fix
date: 2025-02-16T02:32:47Z
---

## audit-fix: Audit fix: ran cargo fmt to resolve P0 formatting issues in cli.rs, build_status.rs, mod.rs, integration_tests.rs, main.rs, auth.rs

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-8
date: 2025-02-16T02:28:11Z
bead: tugtool-p17.9
---

## #step-8: Added stats feed delivery and reconnection integration tests. Fixed auth.rs rustdoc warning (<T> → TOKEN). 496 tests pass, clippy clean, cargo doc clean. Phase 3 complete.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

---

---
step: #step-7
date: 2025-02-16T02:18:06Z
bead: tugtool-p17.8
---

## #step-7: Added --version flag, improved about/long_about help text, replaced error!() with eprintln!() for clean user-facing errors, removed unused tracing::error import. 79 tests pass.

**Files changed:**
- .tugtool/tugplan-stats-polish-resilience.md

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

