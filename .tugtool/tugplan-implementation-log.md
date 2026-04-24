# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-16
date: 2025-04-24T00:08:53Z
---

## step-16: Phase 3 integration checkpoint closed. Aggregate tests/in-app 29 pass / 11 skip / 0 fail; tugdeck 2434 pass / 0 fail; tsc + lint:no-timers clean; zero new happy-dom tests added across plan. All Swift TestHarness additions and tugdeck __tug surface are #if DEBUG / import.meta.env.DEV-gated (static-inspection verified; wc -c on notarized binary deferred). Plan Status flipped draft->active; phase-2 intro updated to cite landed roadmap/tugplan-in-app-bridge.md. Drift-prevention revert-retest exercise and exact binary-size diff deferred pending built debug Tug.app.

**Files changed:**
- in-app-test-harness-701669b-2

---

---
step: step-16
date: 2026-04-23T00:00:00Z
---

## step-16: Phase 3 Integration Checkpoint. Flipped plan Status draft→active. Updated Documentation Plan entry for `roadmap/tugplan-in-app-bridge.md` (now landed) and the Phase 2 deep-dive intro to reflect the Phase 2 plan as the canonical source. Ran the full aggregate: `bun test tests/in-app/` = 29 pass / 11 skip / 0 fail; `bun test` in tugdeck = 2434 pass / 0 fail; `bun x tsc --noEmit` clean in both tugdeck and tests/in-app; `bun run lint:no-timers` clean (8 files). Verified no new happy-dom tests were added in any plan commit (grep across added test/config files turned up only explicit "NO happy-dom" comments). Verified DEBUG-gating for release-build size invariance: all tugapp TestHarness/*.swift files are `#if DEBUG...#endif` wrapped at file scope; the new `testHarnessBridge` property, startup, teardown in `AppDelegate.swift` and the `WKUserScript` install + `testHarnessWebView()` accessor in `MainWindow.swift` are each `#if DEBUG` gated; tugdeck `__tug` surface is `import.meta.env.DEV && window.__tugTestMode` gated so Vite prod builds tree-shake it. Drift-prevention exercise (manually reverting each M-series fix and re-running the test) deferred — requires a built Tug.app DEBUG binary and `TUGAPP_IN_APP_TEST=1`, same dependency that parked Step 11 manual tasks.

**Files changed:**
- .tugtool/tugplan-in-app-test-harness.md (Status draft→active; phase-2-bridge intro; Documentation Plan entry)
- .tugtool/tugplan-implementation-log.md
- .tugtool/session-memory.md

---

---
step: step-15
date: 2025-04-24T00:04:03Z
---

## step-15: Added tests/in-app/m16-tab-close-handoff.test.ts (248 lines) following m01/m03 pattern. Seeds pane with [c1,c2,c3] (c2 active), clicks c2's close button (data-testid=tug-tab-close-c2), asserts c3 becomes focused card, asserts no save-callback event for cardId=c2 in the trace slice since the closed card is destroyed, and asserts c3's caret lands at the bag.focus target via expectCaret. tsc clean; bun test 29 pass / 11 skip / 0 fail; lint:no-timers clean (8 files).

**Files changed:**
- in-app-test-harness-701669b-2

---

