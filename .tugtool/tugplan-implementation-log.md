# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-5
date: 2025-03-06T02:07:27Z
---

## step-5: Verified all exit criteria: no bare string dispatch, all handlers use ActionEvent, TugButton never hides, DeckCanvas last-resort responder, dispatchTo/nodeCanHandle present, target prop wired, gallery demo renders. 655 tests pass, build clean.

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d2-control-action.md

---

---
step: step-4
date: 2025-03-06T02:03:00Z
---

## step-4: Added ActionEvent Dispatch demo section to gallery-card.tsx with useResponder registration for action-event-demo node, dispatchTo-based onClick, and status line showing last received event fields.

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d2-control-action.md

---

---
step: step-3
date: 2025-03-06T01:57:32Z
---

## step-3: Added target prop to TugButton for explicit-target dispatch via dispatchTo/nodeCanHandle. Dev-mode warnings for target without action and dispatchTo returning false. Added tests for target-mode behavior and DeckCanvas last-resort responder verification.

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d2-control-action.md

---

---
step: step-2
date: 2025-03-06T01:50:07Z
---

## step-2: Added dispatchTo(targetId, event) for explicit-target dispatch (throws on unregistered) and nodeCanHandle(nodeId, action) for per-node capability queries to ResponderChainManager, with 8 unit tests.

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d2-control-action.md

---

---
step: step-1
date: 2025-03-06T00:19:28Z
---

## step-1: Added ActionPhase/ActionEvent types to responder-chain.ts, migrated dispatch() from string to ActionEvent, updated all handler signatures, implemented never-hide TugButton (disable instead of hide), added DeckCanvas last-resort canHandle, removed nonexistentAction button, and migrated all 11 test files.

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d2-control-action.md

---

---
step: step-5
date: 2025-03-05T21:14:27Z
---

## step-5: Integration checkpoint: verified all success criteria, Rules of Tug compliance, 641/641 tests pass, no code changes

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d1-default-button.md

---

---
step: step-4
date: 2025-03-05T21:11:07Z
---

## step-4: Added GalleryDefaultButtonContent component, registered gallery-default-button card, added sixth tab to GALLERY_DEFAULT_TABS, updated gallery-card.test.tsx and component-gallery.test.tsx with six-entry assertions

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d1-default-button.md

---

---
step: step-3
date: 2025-03-05T21:03:50Z
---

## step-3: Added .tug-button-destructive base rule with background-color: var(--td-danger) and color: var(--td-text-inverse) in tug-button.css

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d1-default-button.md

---

---
step: step-2
date: 2025-03-05T21:01:22Z
---

## step-2: Added Enter-key default-button activation logic to bubbleListener stage-2 with guards for INPUT/TEXTAREA/SELECT/BUTTON/contentEditable, plus 6 integration tests

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d1-default-button.md

---

---
step: step-1
date: 2025-03-05T20:56:29Z
---

## step-1: Added private defaultButtonStack field and three public methods (setDefaultButton, clearDefaultButton, getDefaultButton) to ResponderChainManager, plus comprehensive unit tests

**Files changed:**
- .tugtool/tugplan-tugways-phase-5d1-default-button.md

---

---
step: step-5
date: 2025-03-05T16:32:39Z
---

## step-5: Fixed stale hull shadow comment in postActionSetUpdate, verified no stale set-shadow/gestureActive/dragShadowEl/resizeShadowEl references remain in tugdeck source or styles.

**Files changed:**
- .tugtool/tugplan-set-shadow-rewrite.md

---

---
step: step-4
date: 2025-03-05T16:28:37Z
---

## step-4: Added per-frame updateSetAppearance call in applyResizeFrame for sash co-resize, ensuring both resizing card and sash neighbor get correct clip-path values during resize.

**Files changed:**
- .tugtool/tugplan-set-shadow-rewrite.md

---

---
step: step-3
date: 2025-03-05T16:25:45Z
---

## step-3: Deleted gesture-active flag system, dragShadowEl/resizeShadowEl refs, defensive sweep, shadow translation in drag/resize RAF loops. Replaced break-out shadow removal with direct clip-path/data-in-set clearing. Simplified deck-canvas store subscriber to call updateSetAppearance unconditionally.

**Files changed:**
- .tugtool/tugplan-set-shadow-rewrite.md

---

---
step: step-2
date: 2025-03-05T16:17:32Z
---

## step-2: Rewrote updateSetAppearance to apply clip-path:inset() on .tugcard elements instead of creating .set-shadow DOM elements. Added computeClipPathForCard helper and SHADOW_EXTEND_PX constant.

**Files changed:**
- .tugtool/tugplan-set-shadow-rewrite.md

---

---
step: step-1
date: 2025-03-05T16:09:21Z
---

## step-1: Added unconditional box-shadow to .tugcard, removed conditional shadow from .card-frame rules, deleted .set-shadow and .set-shadow-shape CSS rules and comment block

**Files changed:**
- .tugtool/tugplan-set-shadow-rewrite.md

---

---
step: step-5
date: 2025-03-05T15:10:11Z
---

## step-5: Added shadow element snapshot after resizePreSetMemberIds computation and position delta translation in applyResizeFrame, so shadow tracks card position during north/west resize gestures.

**Files changed:**
- .tugtool/tugplan-set-shadow-glitches.md

---

---
step: step-4
date: 2025-03-05T15:07:29Z
---

## step-4: Inserted defensive sweep in handleDragStart that removes all .set-shadow elements and rebuilds via updateSetAppearance before shadow lookup, preventing stale shadows from missed updates.

**Files changed:**
- .tugtool/tugplan-set-shadow-glitches.md

---

---
step: step-3
date: 2025-03-05T15:05:16Z
---

## step-3: Added module-level gesture flag (isGestureActive/setGestureActive) in card-frame.tsx with true at drag/resize start and false at all exit points. Added store subscriber useEffect in deck-canvas.tsx that rebuilds shadows on mutations when no gesture is active.

**Files changed:**
- .tugtool/tugplan-set-shadow-glitches.md

---

---
step: step-2
date: 2025-03-05T14:59:23Z
---

## step-2: Added updateSetAppearance call in the merge early-return block of onPointerUp to rebuild shadows after merge, preventing stale shadow elements.

**Files changed:**
- .tugtool/tugplan-set-shadow-glitches.md

---

---
step: step-1
date: 2025-03-05T14:56:51Z
---

## step-1: Added null-guarded removeChild call for dragShadowEl in the break-out detection block of applyDragFrame, preventing orphaned shadow elements during drag.

**Files changed:**
- .tugtool/tugplan-set-shadow-glitches.md

---

---
step: step-6
date: 2025-03-05T03:54:25Z
---

## step-6: Integration checkpoint: verified all exit criteria met. All unit tests pass, build succeeds, deleted helpers absent, flashCardPerimeter unchanged, no per-card clip-path applied.

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

---
step: step-5
date: 2025-03-05T03:51:34Z
---

## step-5: Renamed .set-flash-overlay CSS class to .card-flash-overlay to reflect its single-card break-out flash purpose. Verified no remaining references to obsolete symbols (buildFlashPolygon, FLASH_PADDING, computeInternalEdges, buildClipPath).

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

---
step: step-4
date: 2025-03-05T03:47:25Z
---

## step-4: Added dragShadowEl and dragShadowOrigin refs. At drag-start, looks up shadow by data-set-card-ids. In RAF loop set-move branch, translates shadow by clamped delta. Clears shadow ref on break-out, drag-end, and merge early-return.

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

---
step: step-3
date: 2025-03-05T03:40:37Z
---

## step-3: Rewrote updateSetAppearance to create virtual set shadow divs using hull polygon. Wrapper carries filter:drop-shadow, inner carries clip-path:polygon with background. Added containerEl parameter, data-set-card-ids attribute, z-index computation. Deleted computeInternalEdges and buildClipPath. Added DeckCanvas useLayoutEffect for initial load. Updated chrome.css with .set-shadow classes and box-shadow:none for in-set cards.

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

---
step: step-2
date: 2025-03-05T03:26:44Z
---

## step-2: Rewrote flashSetPerimeter to create a single SVG element with hull polygon path and glow filter. Added containerEl parameter to postActionSetUpdate and flashSetPerimeter. Deleted buildFlashPolygon and FLASH_PADDING. Added .set-flash-svg CSS class.

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

---
step: step-1
date: 2025-03-05T03:17:47Z
---

## step-1: Added Point interface and computeSetHullPolygon function to snap.ts implementing coordinate compression, grid fill, clockwise boundary trace, and collinear vertex removal. Added 9 unit test cases covering single rect, adjacent rects, L-shape, T-shape, staircase, overlapping rects, and degenerate inputs.

**Files changed:**
- .tugtool/tugplan-hull-polygon-visual-overhaul.md

---

