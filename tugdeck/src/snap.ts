/**
 * Snap geometry module for the canvas card system.
 *
 * Pure functions with no DOM or state dependencies.
 * Handles snap-during-move, snap-during-resize, and edge visibility.
 *
 * Spec S01: Canvas Data Model Types
 * D01: Pure-function snap module
 */

// ---- Types ----

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapAxis = "x" | "y";

export interface GuidePosition {
  axis: SnapAxis;
  position: number;
}

export interface SnapResult {
  x: number | null;
  y: number | null;
  guides: GuidePosition[];
}

// ---- Constants ----

export const SNAP_THRESHOLD_PX = 8;

/**
 * Minimum fraction of an edge that must be visible (not occluded by higher-z cards)
 * for a snap to activate. 1.0 = full edge must be visible. Lower values are more
 * permissive (e.g. 0.3 = at least 30% of the edge visible).
 */
export const SNAP_VISIBILITY_THRESHOLD = 0.3;

// ---- Callback type for snap validation ----

/**
 * Optional callback to validate a candidate snap edge before accepting it.
 * Called for each edge-to-edge match within threshold. Return false to reject.
 *
 * @param axis - "x" for vertical edge alignment, "y" for horizontal
 * @param edgePosition - The coordinate of the snap target edge
 * @param otherRect - The target rect being snapped to
 * @param otherIndex - Index in the others array
 */
export type EdgeValidator = (
  axis: SnapAxis,
  edgePosition: number,
  otherRect: Rect,
  otherIndex: number
) => boolean;

// ---- computeSnap ----

/**
 * Compute snap for a moving rect against a set of stationary rects.
 *
 * For each axis (x, y), checks all 4 edges of the moving rect against all 4 edges
 * of each other rect. Finds the minimum-distance alignment within SNAP_THRESHOLD_PX.
 *
 * Returns the new top-left position (x, y) for the moving rect after snapping,
 * or null per axis if no snap is within threshold.
 * Also returns guide positions for each active snap axis.
 *
 * @param borderWidth - Optional border width in pixels (default 0). When > 0, adjacent-edge
 *   snaps are offset inward by this amount so that card borders overlap into a single visual line.
 *   Same-edge snaps (left-to-left, right-to-right, etc.) are not offset. Pass 0 or omit for
 *   backward-compatible behavior.
 */
export function computeSnap(
  moving: Rect,
  others: Rect[],
  validate?: EdgeValidator,
  borderWidth?: number
): SnapResult {
  const movingLeft = moving.x;
  const movingRight = moving.x + moving.width;
  const movingTop = moving.y;
  const movingBottom = moving.y + moving.height;

  const bw = borderWidth ?? 0;

  // Best snap per axis: { delta, guidePosition }
  // delta = amount to shift the rect's top-left so the snapping edges align
  let bestXDist = Infinity;
  let bestXDelta = 0;
  let bestXGuide = 0;
  let snapX = false;

  let bestYDist = Infinity;
  let bestYDelta = 0;
  let bestYGuide = 0;
  let snapY = false;

  for (let otherIdx = 0; otherIdx < others.length; otherIdx++) {
    const other = others[otherIdx];
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;

    // X-axis: four explicit named-edge comparisons to preserve offset directionality.
    // Same-edge pairs (left-to-left, right-to-right): no border offset.
    // Adjacent-edge pairs (moving-right to other-left, moving-left to other-right): apply offset.
    const xCandidates: Array<{ dist: number; delta: number; guide: number }> = [];

    // movingLeft vs otherLeft (same-edge, no offset)
    {
      const dist = Math.abs(movingLeft - otherLeft);
      if (dist <= SNAP_THRESHOLD_PX) {
        xCandidates.push({ dist, delta: otherLeft - movingLeft, guide: otherLeft });
      }
    }
    // movingLeft vs otherRight (adjacent: moving-left to other-right, offset inward -bw)
    {
      const dist = Math.abs(movingLeft - otherRight);
      if (dist <= SNAP_THRESHOLD_PX) {
        xCandidates.push({ dist, delta: otherRight - movingLeft - bw, guide: otherRight });
      }
    }
    // movingRight vs otherLeft (adjacent: moving-right to other-left, offset inward +bw)
    {
      const dist = Math.abs(movingRight - otherLeft);
      if (dist <= SNAP_THRESHOLD_PX) {
        xCandidates.push({ dist, delta: otherLeft - movingRight + bw, guide: otherLeft });
      }
    }
    // movingRight vs otherRight (same-edge, no offset)
    {
      const dist = Math.abs(movingRight - otherRight);
      if (dist <= SNAP_THRESHOLD_PX) {
        xCandidates.push({ dist, delta: otherRight - movingRight, guide: otherRight });
      }
    }

    for (const candidate of xCandidates) {
      if (candidate.dist < bestXDist) {
        if (validate && !validate("x", candidate.guide, other, otherIdx)) continue;
        bestXDist = candidate.dist;
        bestXDelta = candidate.delta;
        bestXGuide = candidate.guide;
        snapX = true;
      }
    }

    // Y-axis: four explicit named-edge comparisons to preserve offset directionality.
    // Same-edge pairs (top-to-top, bottom-to-bottom): no border offset.
    // Adjacent-edge pairs (moving-bottom to other-top, moving-top to other-bottom): apply offset.
    const yCandidates: Array<{ dist: number; delta: number; guide: number }> = [];

    // movingTop vs otherTop (same-edge, no offset)
    {
      const dist = Math.abs(movingTop - otherTop);
      if (dist <= SNAP_THRESHOLD_PX) {
        yCandidates.push({ dist, delta: otherTop - movingTop, guide: otherTop });
      }
    }
    // movingTop vs otherBottom (adjacent: moving-top to other-bottom, offset inward -bw)
    {
      const dist = Math.abs(movingTop - otherBottom);
      if (dist <= SNAP_THRESHOLD_PX) {
        yCandidates.push({ dist, delta: otherBottom - movingTop - bw, guide: otherBottom });
      }
    }
    // movingBottom vs otherTop (adjacent: moving-bottom to other-top, offset inward +bw)
    {
      const dist = Math.abs(movingBottom - otherTop);
      if (dist <= SNAP_THRESHOLD_PX) {
        yCandidates.push({ dist, delta: otherTop - movingBottom + bw, guide: otherTop });
      }
    }
    // movingBottom vs otherBottom (same-edge, no offset)
    {
      const dist = Math.abs(movingBottom - otherBottom);
      if (dist <= SNAP_THRESHOLD_PX) {
        yCandidates.push({ dist, delta: otherBottom - movingBottom, guide: otherBottom });
      }
    }

    for (const candidate of yCandidates) {
      if (candidate.dist < bestYDist) {
        if (validate && !validate("y", candidate.guide, other, otherIdx)) continue;
        bestYDist = candidate.dist;
        bestYDelta = candidate.delta;
        bestYGuide = candidate.guide;
        snapY = true;
      }
    }
  }

  const guides: GuidePosition[] = [];
  const x = snapX ? moving.x + bestXDelta : null;
  const y = snapY ? moving.y + bestYDelta : null;

  if (snapX) {
    guides.push({ axis: "x", position: bestXGuide });
  }
  if (snapY) {
    guides.push({ axis: "y", position: bestYGuide });
  }

  return { x, y, guides };
}

// ---- computeResizeSnap ----

/**
 * Snap only the edges that are actively being resized.
 *
 * resizingEdges: the current absolute positions of the edges being resized
 *   (only the keys present are snapped).
 *
 * Returns snapped edge values and guide positions.
 *
 * @param borderWidth - Optional border width in pixels (default 0). When > 0,
 *   adjacent-edge snaps (e.g. resizing right toward another card's left) are offset
 *   inward by this amount so that borders overlap into a single visual line.
 *   Same-edge snaps (e.g. resizing right toward another card's right) are not offset.
 *   Pass 0 or omit for backward-compatible behavior.
 */
export function computeResizeSnap(
  resizingEdges: { top?: number; bottom?: number; left?: number; right?: number },
  others: Rect[],
  borderWidth?: number
): { top?: number; bottom?: number; left?: number; right?: number; guides: GuidePosition[] } {
  const bw = borderWidth ?? 0;

  // Snap each edge independently; track best snap (minimum distance) per edge key.
  // For adjacent-edge snaps, the snapped value includes a borderWidth offset for border collapse.
  // The distance check uses the raw (un-offset) position.
  // Guide positions track the OTHER card's target edge (for rendering the guide line at the snap target).
  let leftSnapped: number | undefined;
  let leftGuide: number | undefined;
  let leftDist = Infinity;

  let rightSnapped: number | undefined;
  let rightGuide: number | undefined;
  let rightDist = Infinity;

  let topSnapped: number | undefined;
  let topGuide: number | undefined;
  let topDist = Infinity;

  let bottomSnapped: number | undefined;
  let bottomGuide: number | undefined;
  let bottomDist = Infinity;

  for (let otherIdx = 0; otherIdx < others.length; otherIdx++) {
    const other = others[otherIdx];
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;

    // Left edge: check same-edge (otherLeft, no offset) and adjacent-edge (otherRight, -bw offset)
    if (resizingEdges.left !== undefined) {
      // left vs otherLeft (same-edge, no offset)
      {
        const dist = Math.abs(resizingEdges.left - otherLeft);
        if (dist <= SNAP_THRESHOLD_PX && dist < leftDist) {
          leftDist = dist;
          leftSnapped = otherLeft;
          leftGuide = otherLeft;
        }
      }
      // left vs otherRight (adjacent-edge: resizing left toward other's right, overlap by bw)
      {
        const dist = Math.abs(resizingEdges.left - otherRight);
        if (dist <= SNAP_THRESHOLD_PX && dist < leftDist) {
          leftDist = dist;
          leftSnapped = otherRight - bw;
          leftGuide = otherRight;
        }
      }
    }

    // Right edge: check adjacent-edge (otherLeft, +bw offset) and same-edge (otherRight, no offset)
    if (resizingEdges.right !== undefined) {
      // right vs otherLeft (adjacent-edge: resizing right toward other's left, overlap by bw)
      {
        const dist = Math.abs(resizingEdges.right - otherLeft);
        if (dist <= SNAP_THRESHOLD_PX && dist < rightDist) {
          rightDist = dist;
          rightSnapped = otherLeft + bw;
          rightGuide = otherLeft;
        }
      }
      // right vs otherRight (same-edge, no offset)
      {
        const dist = Math.abs(resizingEdges.right - otherRight);
        if (dist <= SNAP_THRESHOLD_PX && dist < rightDist) {
          rightDist = dist;
          rightSnapped = otherRight;
          rightGuide = otherRight;
        }
      }
    }

    // Top edge: check same-edge (otherTop, no offset) and adjacent-edge (otherBottom, -bw offset)
    if (resizingEdges.top !== undefined) {
      // top vs otherTop (same-edge, no offset)
      {
        const dist = Math.abs(resizingEdges.top - otherTop);
        if (dist <= SNAP_THRESHOLD_PX && dist < topDist) {
          topDist = dist;
          topSnapped = otherTop;
          topGuide = otherTop;
        }
      }
      // top vs otherBottom (adjacent-edge: resizing top toward other's bottom, overlap by bw)
      {
        const dist = Math.abs(resizingEdges.top - otherBottom);
        if (dist <= SNAP_THRESHOLD_PX && dist < topDist) {
          topDist = dist;
          topSnapped = otherBottom - bw;
          topGuide = otherBottom;
        }
      }
    }

    // Bottom edge: check adjacent-edge (otherTop, +bw offset) and same-edge (otherBottom, no offset)
    if (resizingEdges.bottom !== undefined) {
      // bottom vs otherTop (adjacent-edge: resizing bottom toward other's top, overlap by bw)
      {
        const dist = Math.abs(resizingEdges.bottom - otherTop);
        if (dist <= SNAP_THRESHOLD_PX && dist < bottomDist) {
          bottomDist = dist;
          bottomSnapped = otherTop + bw;
          bottomGuide = otherTop;
        }
      }
      // bottom vs otherBottom (same-edge, no offset)
      {
        const dist = Math.abs(resizingEdges.bottom - otherBottom);
        if (dist <= SNAP_THRESHOLD_PX && dist < bottomDist) {
          bottomDist = dist;
          bottomSnapped = otherBottom;
          bottomGuide = otherBottom;
        }
      }
    }
  }

  const guides: GuidePosition[] = [];

  if (leftGuide !== undefined) {
    guides.push({ axis: "x", position: leftGuide });
  }
  if (rightGuide !== undefined) {
    if (!guides.some((g) => g.axis === "x" && g.position === rightGuide)) {
      guides.push({ axis: "x", position: rightGuide });
    }
  }
  if (topGuide !== undefined) {
    guides.push({ axis: "y", position: topGuide });
  }
  if (bottomGuide !== undefined) {
    if (!guides.some((g) => g.axis === "y" && g.position === bottomGuide)) {
      guides.push({ axis: "y", position: bottomGuide });
    }
  }

  return {
    ...(leftSnapped !== undefined ? { left: leftSnapped } : {}),
    ...(rightSnapped !== undefined ? { right: rightSnapped } : {}),
    ...(topSnapped !== undefined ? { top: topSnapped } : {}),
    ...(bottomSnapped !== undefined ? { bottom: bottomSnapped } : {}),
    guides,
  };
}

// ---- computeEdgeVisibility ----

/**
 * Compute what fraction of an edge segment is visible (not occluded by higher-z cards).
 *
 * Checks a line segment along one axis (vertical edge at a given x, or horizontal
 * edge at a given y) and determines how much of it is covered by occluder rects.
 *
 * @param edgePosition - x coordinate (for vertical edge) or y coordinate (for horizontal)
 * @param rangeStart - Start of the perpendicular range to check
 * @param rangeEnd - End of the perpendicular range to check
 * @param isVerticalEdge - true for vertical edge (x-position), false for horizontal (y-position)
 * @param occluders - Rects that might cover the edge (pre-filtered to higher z-index)
 * @returns Fraction of range that is visible, from 0.0 to 1.0
 */
export function computeEdgeVisibility(
  edgePosition: number,
  rangeStart: number,
  rangeEnd: number,
  isVerticalEdge: boolean,
  occluders: Rect[]
): number {
  const totalLength = rangeEnd - rangeStart;
  if (totalLength <= 0) return 0;

  const occludedRanges: [number, number][] = [];

  for (const r of occluders) {
    if (isVerticalEdge) {
      // Vertical edge at x=edgePosition. Occluder must straddle this x position.
      if (r.x < edgePosition && r.x + r.width > edgePosition) {
        const oStart = Math.max(rangeStart, r.y);
        const oEnd = Math.min(rangeEnd, r.y + r.height);
        if (oStart < oEnd) occludedRanges.push([oStart, oEnd]);
      }
    } else {
      // Horizontal edge at y=edgePosition. Occluder must straddle this y position.
      if (r.y < edgePosition && r.y + r.height > edgePosition) {
        const oStart = Math.max(rangeStart, r.x);
        const oEnd = Math.min(rangeEnd, r.x + r.width);
        if (oStart < oEnd) occludedRanges.push([oStart, oEnd]);
      }
    }
  }

  if (occludedRanges.length === 0) return 1.0;

  // Merge overlapping ranges
  occludedRanges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[occludedRanges[0][0], occludedRanges[0][1]]];
  for (let i = 1; i < occludedRanges.length; i++) {
    const last = merged[merged.length - 1];
    if (occludedRanges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], occludedRanges[i][1]);
    } else {
      merged.push([occludedRanges[i][0], occludedRanges[i][1]]);
    }
  }

  let occludedLength = 0;
  for (const [s, e] of merged) occludedLength += e - s;

  return (totalLength - occludedLength) / totalLength;
}
