<!-- tugplan-skeleton v2 -->

## Selection, Focus, Scroll, and Content Persistence Subsystem {#phase-selection-subsystem}

**Purpose:** Define a complete, code-grounded strategy for tracking, managing, saving, and restoring text content, text selection, focus, and scroll position across every card, component, and lifecycle transition in tugdeck.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-22 |

---

### Phase Overview {#phase-overview}

#### Redo mandate {#redo-rationale}

An earlier version of this plan proposed a 16-step `SelectionKeeper` subsystem and reached partial implementation (Steps 1–6 committed, Step 7 attempted) before manual verification failed. The failure mode was not a bug — it was the plan.

Root cause: every decision in the previous plan was written against a theoretical model of how tugdeck handles selection, without grounding that model in the actual codebase. Multiple overviewer and critic audits reviewed the plan document for internal coherence but never validated its claims against real code. The core false premise — "the keeper can be the sole owner of selection save/restore" — silently collided with the fact that `TugTextEngine.restoreState` already owns selection restore for tide cards via `setSelectedRange`. That conflict, which a single `grep` would have surfaced, propagated through 16 steps of elaboration and six committed steps of implementation.

All committed work on the previous plan (commits `0f239b14` through `183d8af5`) has been rolled back. This document is now a stub; every assumption it will eventually rest on must cite a concrete file:line from the audit below.

#### Scope {#scope}

The new plan must cover, end-to-end, the persistence of:

- Text content (card-level `bag.content`, component-internal engine state, controlled React state).
- DOM selection (`window.getSelection()` ranges inside contentEditable regions and in card chrome).
- Form-control selection (`<input>` / `<textarea>` `selectionStart` / `selectionEnd` / `selectionDirection`).
- Focus (`document.activeElement`).
- Scroll position (card-level scroll on `hostContentEl`, per-input scroll inside form controls, per-region scroll inside card content).

Across every one of these transitions:

- App active / resign active.
- App hide / unhide.
- Browser reload (`window.beforeunload`, `document.visibilitychange(hidden)`).
- Process relaunch (Swift `applicationShouldTerminate` → `saveState` RPC).
- Card activate / deactivate (within a pane).
- Pane activate / deactivate (within the deck).
- Card drag / move / resize.
- Pane drag / move / resize.
- Tab switch (card activation inside a multi-card pane).
- Cross-pane card move.

---

### Code audit (pending) {#audit}

Before any design decision is written, we produce a top-to-bottom map of:

1. **Who currently saves and restores each of the persisted concepts above, per card type and per component.**

2. **Every lifecycle / transition trigger that touches any of the persisted concepts.** Who subscribes, what they do, what state they touch.

3. **Every write site that mutates these concepts:** `setBaseAndExtent`, `setSelectionRange`, `.focus()`, `scrollLeft` / `scrollTop` assignment, innerHTML rewrites that displace selection anchors, React setState that replaces text nodes.

The audit output populates two tables — one per concept, one per trigger — that become the definitive ownership map. Every design decision must cite rows from those tables. Every execution step must cite a design decision.

---

### Design decisions {#design-decisions}

*To be written after the audit. No decision is permitted here until it is grounded in a specific audit row.*

---

### Open Questions {#open-questions}

*To be populated during the audit and design phases.*

---

### Risks and mitigations {#risks}

*To be populated during the audit and design phases.*

---

### Execution Steps {#execution-steps}

*To be written after design decisions land. No step is permitted here until every decision it depends on exists in the design-decisions section.*

#### Step 1: Code audit {#step-1}

**Depends on:** none

**Commit:** `docs(selection-plan): ground ownership and trigger maps against code`

**References:** —

**Artifacts:**
- Ownership table under [#audit](#audit): per-concept map of saver / restorer / owner.
- Trigger table under [#audit](#audit): per-transition map of what fires, in what order, touching what state.

**Tasks:**
- [ ] Grep every `setBaseAndExtent`, `setSelectionRange`, `.focus()`, `scrollLeft =`, `scrollTop =` write site in `tugdeck/src/` and record file:line.
- [ ] For each card type (tide, gallery-input, gallery-textarea, file tree, terminal, any other registered card), trace content save/restore through `useCardPersistence` and any component-internal persistence.
- [ ] For each lifecycle observer (`app-lifecycle`, `card-lifecycle`, deck manager `saveAndFlush`, `beforeunload`, `visibilitychange`, Swift `saveState` RPC), list every callback and the state it touches.
- [ ] Fill both tables in [#audit](#audit) and mark this step complete only when both are fully populated.

**Tests:**
- [ ] Audit tables reviewed; every active write site appears in at least one row.

**Checkpoint:**
- [ ] `tugutil validate /u/src/tugtool/roadmap/tugplan-selection.md` passes.

---

### Deliverables and Checkpoints {#deliverables}

*To be populated once the execution plan exists beyond the audit step.*
