# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-6
date: 2025-04-27T23:29:16Z
---

## step-6: Promoted 25 law lines in tuglaws.md from bold prose to H3 headings with {#lNN} trailing-attribute anchors per [Q02] / [D04]. Stripped duplicated law-text appendix from framework-architecture.md and replaced with single H2 'Laws referenced in this document' cross-ref list (9 laws: L02, L03, L04, L05, L06, L07, L08, L11, L24). Sub-step C (manual GitHub preview verification per OF6) deferred to Step 8 audit. All 5 plan tests pass.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

---

---
step: step-5
date: 2025-04-27T23:23:20Z
---

## step-5: Created tuglaws/app-test-harness.md (155 lines) per Spec S05 + [D03]: lifted architectural content (lifecycle model, fidelity envelope, native-gesture rationale, accessibility-grant relationship) from tests/app-test/README.md. Reduced README from 445 to 258 lines (gate: <320), kept procedural sections only per [D03] retain list. SC05 identifiers present; SC07 banner present.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

---

---
step: step-4
date: 2025-04-27T23:15:42Z
---

## step-4: Created tuglaws/lifecycle-delegates.md (211 lines) per Spec S04 + [D07] + OQ1 expansion: covers all 11 TugCardDelegate methods, the strict cross-card will/did ordering invariant, MessageChannel drain queue, LIFECYCLE_LOG, portal-refactoring relationship, and authoring rules. Source-of-truth is card-lifecycle.ts (primary), card-host.tsx (secondary). All SC04 identifiers present; banner present; tsc clean.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

---

---
step: step-3
date: 2025-04-27T23:09:12Z
---

## step-3: Created tuglaws/state-preservation.md (274 lines) per Spec S03: banner, Why, two opt-in layers, public-identifier inventory (15 identifiers), save/restore lifecycle, restore ordering, DOM attributes table, FocusSnapshot/CardStateBag detail, authoring rules, AT-tag relationship table, Files, Cross-Links. All SC03 identifiers present; SC07 banner present; tsc/test green.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

---

---
step: step-2
date: 2025-04-27T23:01:21Z
---

## step-2: git mv selection-model.md -> card-state-model.md, inserted Cross-references banner, renamed Scroll Persistence -> Preservation, added Form-control Value Preservation section, reduced ResponderChainProvider section to cross-ref, added Cross-Links closing section. Updated cross-refs in pane-model.md, component-authoring.md, responder-chain.md, plus comment-only path updates in selection-guard.ts and use-copyable-text.tsx.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

---

---
step: step-1
date: 2025-04-27T22:54:32Z
---

## step-1: Created tuglaws/INDEX.md per Spec S01 / [D05]: 35 lines, 5 H2 sections, lists every existing tuglaws/*.md plus the 4 forthcoming new docs.

**Files changed:**
- tuglaws-tidyup-ae990f1-1

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

