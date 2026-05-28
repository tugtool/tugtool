/**
 * dev-jump-to-bottom-button.tsx — round "scroll to latest" affordance
 * for the dev-card transcript.
 *
 * Floats over the transcript viewport, pinned bottom-center, and is
 * shown only while the user has scrolled away from the live edge.
 * Modeled on the down-arrow button chat clients surface when the
 * conversation is scrolled up.
 *
 * **Visibility is appearance state.** The transcript host toggles a
 * `data-visible` attribute on the button — driven off `TugListView`'s
 * `onFollowBottomChange` observer — and CSS fades it in / out ([L06]).
 * The component itself holds no state and never re-renders for the
 * show / hide.
 *
 * **Mount discipline.** The host renders this unconditionally, never
 * mounting it behind a condition, so the show / hide is a pure CSS
 * transition with no React reconciliation ([L26]).
 *
 * @module components/tugways/cards/dev-jump-to-bottom-button
 */

import "./dev-jump-to-bottom-button.css";

import React from "react";
import { ArrowDown } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";

export interface DevJumpToBottomButtonProps {
  /**
   * Fired when the user clicks the button — the host jumps the
   * transcript to the latest content and re-engages follow-bottom.
   */
  onClick: () => void;
}

/**
 * Round jump-to-latest button. The host owns visibility via the
 * `data-visible` attribute (see module docstring); this component is
 * a thin, stateless affordance. The ref forwards to the underlying
 * `<button>` so the host can toggle that attribute imperatively.
 */
export const DevJumpToBottomButton = React.forwardRef<
  HTMLButtonElement,
  DevJumpToBottomButtonProps
>(function DevJumpToBottomButton({ onClick }, ref) {
  return (
    <TugPushButton
      ref={ref}
      data-slot="dev-jump-to-bottom-button"
      className="dev-jump-to-bottom-button"
      subtype="icon"
      emphasis="filled"
      role="action"
      size="sm"
      rounded="full"
      icon={<ArrowDown />}
      aria-label="Scroll to latest"
      onClick={onClick}
    />
  );
});
