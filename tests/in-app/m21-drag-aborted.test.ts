/**
 * m21-drag-aborted.test.ts — Drag aborted via Escape preserves
 * focus inside the source card (parent plan #step-23c).
 *
 * Scenario:
 *
 *   Seed one pane: P1=[A, B] active=A. Click into A's input and
 *   type "alpha". Begin a drag of A's tab past the 5px threshold
 *   (so `cardDragCoordinator.startDrag` fires and installs the
 *   document-level `keydown` capture listener). Press Escape
 *   mid-drag. Verify A stays in P1 (no commit ran), A's input
 *   value is still "alpha", and focus is restored inside A's
 *   content.
 *
 * Harness gap (deferred — see PR description)
 * --------------------------------------------
 *
 *   The current harness primitives (`nativeDrag`, `nativeMouseDown`,
 *   `nativeMouseUp`, `nativeKey`) don't compose to a "trusted drag
 *   without final mouseUp" sequence: `nativeDrag` is atomic
 *   (mouseDown → 8 mouseDragged events → mouseUp in one Swift-side
 *   RPC), so `nativeKey("Escape")` issued before/after a
 *   `nativeDrag` either fires before the drag begins or after the
 *   drag has already committed via mouseUp. There is no
 *   `nativeMouseDragged` primitive exposed on the TS surface, so a
 *   compound "begin drag, hold, fire Escape, release" sequence
 *   cannot be authored with the current verbs.
 *
 *   Two paths to close this:
 *
 *     1. Extend the harness with a `nativeDragWithoutRelease`
 *        primitive (mouseDown + interpolated trail, no mouseUp).
 *        Test would chain `nativeDragWithoutRelease` →
 *        `nativeKey("Escape")` → `nativeMouseUp`.
 *
 *     2. Hybrid approach: `nativeMouseDown` + `app.evalJS` to fire
 *        a synthetic `pointermove` past the 5px threshold (which
 *        triggers `cardDragCoordinator.startDrag`) → `nativeKey
 *        ("Escape")` → `nativeMouseUp`. Synthetic pointermove is
 *        less faithful (no isTrusted, no PointerEvent.movementX
 *        accuracy), but exercises the Escape→cleanup→refocus path
 *        end-to-end against real WebKit.
 *
 *   Until one of those lands, manual verification of m21 is the
 *   regression gate: in the running app, click into a card's
 *   input, drag the tab >5px without releasing, press Escape,
 *   verify focus returns inside the input.
 *
 * Gating
 * ------
 * The describe block is wrapped in `describe.skipIf(true)` so the
 * placeholder neither passes nor fails until the gap closes; CI
 * sees a skip count and the file is discoverable for future pickup.
 */

import { describe, test } from "bun:test";

describe.skipIf(true)("m21: drag aborted by Escape preserves focus", () => {
  test("Escape mid-drag rolls back commit and restores focus inside source card", () => {
    // Pending harness extension — see file header.
  });
});
