/**
 * SnapGuideLine — stateless React component for snap alignment guides.
 *
 * Renders a positioned div at the given position on the x or y axis.
 * Used by DeckCanvas to show snap guide overlays during card drag.
 *
 * CSS classes (.snap-guide-line, .snap-guide-line-x, .snap-guide-line-y)
 * are preserved from the vanilla implementation for visual continuity.
 *
 * [D02] React synthetic events, Spec S05, #step-8
 */

import React from "react";
import type { GuidePosition } from "@/snap";

export interface SnapGuideLineProps {
  guide: GuidePosition;
}

export function SnapGuideLine({ guide }: SnapGuideLineProps) {
  const style: React.CSSProperties =
    guide.axis === "x"
      ? { left: guide.position }
      : { top: guide.position };

  const axisClass = guide.axis === "x" ? "snap-guide-line-x" : "snap-guide-line-y";

  return <div className={`snap-guide-line ${axisClass}`} style={style} />;
}
