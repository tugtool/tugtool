# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-5
date: 2025-03-02T19:50:24Z
---

## step-5: Created TugThemeProvider context with stylesheet injection, raw CSS imports, localStorage persistence, settings API sync, Swift bridge canvas color. Created vite-env.d.ts. Deleted use-theme.ts. Added registerThemeSetter to action-dispatch.ts.

**Files changed:**
- .tugtool/tugplan-tugways-phase-1-theme.md

---

---
step: step-4
date: 2025-03-02T19:43:19Z
---

## step-4: Created tugdeck/src/components/tugways/ directory with .gitkeep placeholder for future tugways design system components

**Files changed:**
- .tugtool/tugplan-tugways-phase-1-theme.md

---

---
step: step-3
date: 2025-03-02T19:41:09Z
---

## step-3: Created brio.css, bluenote.css, harmony.css with --tways-* palette tokens; updated 5 semantic tokens with var() fallbacks; removed body.td-theme-bluenote and body.td-theme-harmony blocks from tokens.css

**Files changed:**
- .tugtool/tugplan-tugways-phase-1-theme.md

---

---
step: step-2
date: 2025-03-02T19:32:05Z
---

## step-2: Added motion tokens section with 4 duration tokens, 3 easing tokens, duration scalar, and @media prefers-reduced-motion block with 0.001 scalar

**Files changed:**
- .tugtool/tugplan-tugways-phase-1-theme.md

---

---
step: step-1
date: 2025-03-02T19:27:27Z
---

## step-1: Renamed all 177 occurrences of --tl- to --tways- in tokens.css, updated header and inline comments to reference Tugways Design System instead of Tuglook

**Files changed:**
- .tugtool/tugplan-tugways-phase-1-theme.md

---

---
step: step-10
date: 2025-03-02T18:24:31Z
---

## step-10: Final verification step. Restored 8 archived test files per D01. Added CSP meta tag to index.html for drift test. Moved protocol.test.ts to __tests__/ and set bunfig.toml test root to scope discovery. All 119 tests pass across 9 files, tsc clean.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-9
date: 2025-03-02T18:11:48Z
---

## step-9: Removed unused TabNode interface (6 lines) from layout-tree.ts. No test changes needed — TabNode had zero references in any surviving file.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-8
date: 2025-03-02T18:07:13Z
---

## step-8: main.tsx already stripped to 58 lines in step 6 (Spec S01). Removed dead xterm manual chunk splitting from vite.config.ts. All checkpoints pass.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-7
date: 2025-03-02T18:04:21Z
---

## step-7: Rewrote action-dispatch.test.ts for gutted module: 15 tests covering surviving handlers (reload_frontend, reset, set-dev-mode, choose-source-tree) and core registry. Removed all tests for deleted handlers. Fixed window->globalThis for testability.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-6
date: 2025-03-02T17:59:36Z
---

## step-6: Gutted deck-manager.ts from 1817 to 215 lines per Spec S02. Fixed serialization.ts to inline CARD_TITLES. Also stripped main.tsx (58 lines, Spec S01) and action-dispatch.ts to satisfy tsc compilation gate. Added _archive exclusion to tsconfig.json and fixed markdown.ts archive import path. TypeScript compilation passes with zero errors.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-5
date: 2025-03-02T17:47:12Z
---

## step-5: Rewrote deck-canvas.tsx from 581 lines to 38-line minimal shell per Spec S03. Renders only DisconnectBanner, exports empty DeckCanvasHandle and simplified DeckCanvasProps.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-4
date: 2025-03-02T17:44:11Z
---

## step-4: Deleted 8 chrome components: card-frame, card-header, card-dropdown-menu, dock, tab-bar, snap-guide-line, virtual-sash, set-flash-overlay. Preserved deck-canvas, disconnect-banner, error-boundary.

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-3
date: 2025-03-02T17:42:15Z
---

## step-3: Deleted 9 test files exercising demolished components: canvas-overlays, card-dropdown-menu, card-frame-react, card-header-react, deck-canvas, deck-manager, dev-notification-context, dock-react, tab-bar-react

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-2
date: 2025-03-02T17:40:09Z
---

## step-2: Deleted 26 files: card components (about, developer, files, git, settings, stats, terminal), card infrastructure (card.ts, react-card-adapter, card-context), standalone modules (card-titles, drag-state), card hooks (use-card-meta, use-feed, use-connection), and dev-notification-context

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-1
date: 2025-03-02T17:36:22Z
---

## step-1: Archived 21 conversation files (components + logic) to _archive/cards/conversation/, updated import paths in 3 test files

**Files changed:**
- .tugtool/tugplan-tugways-phase-0-demolition.md

---

---
step: step-5
date: 2025-03-01T23:50:13Z
---

## step-5: Removed syncLocalStorageOnPageLoad(), bridgePageDidLoad() (protocol + implementation), keyTugdeckLayout, and keyTugdeckTheme from Swift code. All replaced by tugcast /api/settings endpoints.

**Files changed:**
- .tugtool/tugplan-shared-settings.md

---

