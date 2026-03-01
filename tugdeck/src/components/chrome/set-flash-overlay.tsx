/**
 * SetFlashOverlay — React component for set-join/break-out flash feedback.
 *
 * Renders a bordered overlay div with the set-flash-fade CSS animation.
 * Calls onAnimationEnd when the animation completes so the parent can
 * remove it from state (self-removal via callback).
 *
 * CSS class (.set-flash-overlay) is preserved from the vanilla implementation
 * for visual continuity with the existing animation keyframes.
 *
 * [D02] React synthetic events, Spec S05, #step-8
 */

import React from "react";

export interface SetFlashOverlayProps {
  /** Suppress top border for internal horizontal shared edges. */
  hideTop?: boolean;
  /** Suppress bottom border for internal horizontal shared edges. */
  hideBottom?: boolean;
  /** Suppress left border for internal vertical shared edges. */
  hideLeft?: boolean;
  /** Suppress right border for internal vertical shared edges. */
  hideRight?: boolean;
  /** Called when the CSS animation ends. Parent uses this to remove the overlay. */
  onAnimationEnd: () => void;
}

export function SetFlashOverlay({
  hideTop,
  hideBottom,
  hideLeft,
  hideRight,
  onAnimationEnd,
}: SetFlashOverlayProps) {
  const style: React.CSSProperties = {};
  if (hideTop) style.borderTop = "none";
  if (hideBottom) style.borderBottom = "none";
  if (hideLeft) style.borderLeft = "none";
  if (hideRight) style.borderRight = "none";

  return (
    <div
      className="set-flash-overlay"
      style={style}
      onAnimationEnd={onAnimationEnd}
    />
  );
}
