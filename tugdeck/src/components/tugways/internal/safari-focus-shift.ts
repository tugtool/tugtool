/**
 * suppressButtonFocusShift — onMouseDown handler for floating-surface content.
 *
 * Suppresses macOS Safari's button-focus quirk: WebKit does not move
 * focus to a `<button>` on click (only keyboard Tab focuses buttons).
 * When a user clicks a button inside a Radix-portaled floating surface
 * (popover, alert, sheet, confirm popover), Safari walks up from the
 * click target looking for the nearest focusable ancestor — which
 * lands on the Radix FocusScope wrapper, an element OUTSIDE the
 * surface's `data-responder-id`. The resulting focusin promotes the
 * wrong responder (usually the containing card), and the chain
 * dispatch fired from the button's onClick finds no matching
 * handler.
 *
 * Preventing `mousedown`'s default on non-text targets keeps focus
 * where it was and lets the pointerdown-promoted surface responder
 * handle the dispatch. Text inputs and contentEditable targets are
 * exempted so typing still moves the caret normally.
 *
 * Attach as `onMouseDown` on the surface's content element (the same
 * element carrying `data-responder-id`). Extracted from tug-alert,
 * tug-confirm-popover, tug-sheet, and tug-popover, where the
 * identical handler had been copy-pasted along with a lengthy
 * explanation comment. This file is the single source of truth for
 * both the behavior and its rationale.
 */

import type React from "react";

/**
 * Prevent `mousedown`'s default on non-text targets to suppress
 * Safari/WebKit's focusin promotion onto the Radix FocusScope wrapper.
 * Targets inside an `<input>`, `<textarea>`, or a `contentEditable`
 * element are skipped so caret placement and text selection still
 * work.
 */
export function suppressButtonFocusShift(e: React.MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (
    target.closest(
      'input, textarea, [contenteditable="true"], [contenteditable=""]',
    )
  ) {
    return;
  }
  e.preventDefault();
}
