/**
 * Snap geometry module for the canvas panel system.
 *
 * Pure functions with no DOM or state dependencies.
 * Handles snap-during-move, snap-during-resize, shared-edge detection,
 * and set (connected component) computation.
 *
 * Spec S01: Canvas Data Model Types
 * Spec S03: Shared-Edge Detection
 * D01: Pure-function snap module
 * D07: Shared-edge detection algorithm
 */

import type { PanelState } from "./layout-tree";

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

/**
 * A shared edge between two panels.
 * axis: "vertical" means the panels share a vertical boundary (one panel's right ~ other's left).
 * axis: "horizontal" means the panels share a horizontal boundary (one panel's bottom ~ other's top).
 * overlapStart/overlapEnd: the perpendicular range of the overlap.
 * boundaryPosition: the coordinate of the shared boundary line.
 */
export interface SharedEdge {
  panelAId: string;
  panelBId: string;
  axis: "vertical" | "horizontal";
  overlapStart: number;
  overlapEnd: number;
  boundaryPosition: number;
}

export interface PanelSet {
  panelIds: string[];
}

// ---- Constants ----

export const SNAP_THRESHOLD_PX = 8;

/**
 * Minimum fraction of an edge that must be visible (not occluded by higher-z panels)
 * for a snap to activate. 1.0 = full edge must be visible. Tune lower to be more
 * permissive (e.g. 0.5 = at least half the edge visible).
 */
export const SNAP_VISIBILITY_THRESHOLD = 1.0;

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

// ---- Helper: convert PanelState to Rect ----

/**
 * Convert a PanelState to a Rect for use in snap computations.
 */
export function panelToRect(panel: PanelState): Rect {
  return {
    x: panel.position.x,
    y: panel.position.y,
    width: panel.size.width,
    height: panel.size.height,
  };
}

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
 */
export function computeSnap(moving: Rect, others: Rect[], validate?: EdgeValidator): SnapResult {
  const movingLeft = moving.x;
  const movingRight = moving.x + moving.width;
  const movingTop = moving.y;
  const movingBottom = moving.y + moving.height;

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

    // X-axis: compare moving left/right against other left/right
    const xMovingEdges = [movingLeft, movingRight];
    const xOtherEdges = [otherLeft, otherRight];

    for (const movingEdge of xMovingEdges) {
      for (const otherEdge of xOtherEdges) {
        const dist = Math.abs(movingEdge - otherEdge);
        if (dist <= SNAP_THRESHOLD_PX && dist < bestXDist) {
          if (validate && !validate("x", otherEdge, other, otherIdx)) continue;
          bestXDist = dist;
          bestXDelta = otherEdge - movingEdge;
          bestXGuide = otherEdge;
          snapX = true;
        }
      }
    }

    // Y-axis: compare moving top/bottom against other top/bottom
    const yMovingEdges = [movingTop, movingBottom];
    const yOtherEdges = [otherTop, otherBottom];

    for (const movingEdge of yMovingEdges) {
      for (const otherEdge of yOtherEdges) {
        const dist = Math.abs(movingEdge - otherEdge);
        if (dist <= SNAP_THRESHOLD_PX && dist < bestYDist) {
          if (validate && !validate("y", otherEdge, other, otherIdx)) continue;
          bestYDist = dist;
          bestYDelta = otherEdge - movingEdge;
          bestYGuide = otherEdge;
          snapY = true;
        }
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
 */
export function computeResizeSnap(
  resizingEdges: { top?: number; bottom?: number; left?: number; right?: number },
  others: Rect[]
): { top?: number; bottom?: number; left?: number; right?: number; guides: GuidePosition[] } {
  // Snap each edge independently; track best snap (minimum distance) per edge key.
  let leftSnapped: number | undefined;
  let leftDist = Infinity;

  let rightSnapped: number | undefined;
  let rightDist = Infinity;

  let topSnapped: number | undefined;
  let topDist = Infinity;

  let bottomSnapped: number | undefined;
  let bottomDist = Infinity;

  for (const other of others) {
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;
    const xTargets = [otherLeft, otherRight];
    const yTargets = [otherTop, otherBottom];

    if (resizingEdges.left !== undefined) {
      for (const target of xTargets) {
        const dist = Math.abs(resizingEdges.left - target);
        if (dist <= SNAP_THRESHOLD_PX && dist < leftDist) {
          leftDist = dist;
          leftSnapped = target;
        }
      }
    }

    if (resizingEdges.right !== undefined) {
      for (const target of xTargets) {
        const dist = Math.abs(resizingEdges.right - target);
        if (dist <= SNAP_THRESHOLD_PX && dist < rightDist) {
          rightDist = dist;
          rightSnapped = target;
        }
      }
    }

    if (resizingEdges.top !== undefined) {
      for (const target of yTargets) {
        const dist = Math.abs(resizingEdges.top - target);
        if (dist <= SNAP_THRESHOLD_PX && dist < topDist) {
          topDist = dist;
          topSnapped = target;
        }
      }
    }

    if (resizingEdges.bottom !== undefined) {
      for (const target of yTargets) {
        const dist = Math.abs(resizingEdges.bottom - target);
        if (dist <= SNAP_THRESHOLD_PX && dist < bottomDist) {
          bottomDist = dist;
          bottomSnapped = target;
        }
      }
    }
  }

  const guides: GuidePosition[] = [];

  if (leftSnapped !== undefined) {
    guides.push({ axis: "x", position: leftSnapped });
  }
  if (rightSnapped !== undefined) {
    if (!guides.some((g) => g.axis === "x" && g.position === rightSnapped)) {
      guides.push({ axis: "x", position: rightSnapped });
    }
  }
  if (topSnapped !== undefined) {
    guides.push({ axis: "y", position: topSnapped });
  }
  if (bottomSnapped !== undefined) {
    if (!guides.some((g) => g.axis === "y" && g.position === bottomSnapped)) {
      guides.push({ axis: "y", position: bottomSnapped });
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

// ---- findSharedEdges ----

/**
 * Detect shared edges between all pairs of panels.
 *
 * A shared vertical edge exists when one panel's right edge is within SNAP_THRESHOLD_PX
 * of another panel's left edge, AND the panels have overlapping perpendicular ranges (top-to-bottom).
 *
 * A shared horizontal edge exists when one panel's bottom edge is within SNAP_THRESHOLD_PX
 * of another panel's top edge, AND the panels have overlapping perpendicular ranges (left-to-right).
 *
 * Pairwise check (i < j) avoids duplicates per pair. Each direction is checked
 * separately — A.right~B.left and B.right~A.left are different boundaries.
 */
export function findSharedEdges(panels: { id: string; rect: Rect }[]): SharedEdge[] {
  const edges: SharedEdge[] = [];

  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];

      const aLeft = a.rect.x;
      const aRight = a.rect.x + a.rect.width;
      const aTop = a.rect.y;
      const aBottom = a.rect.y + a.rect.height;

      const bLeft = b.rect.x;
      const bRight = b.rect.x + b.rect.width;
      const bTop = b.rect.y;
      const bBottom = b.rect.y + b.rect.height;

      // Vertical shared edge: A.right ~ B.left
      if (Math.abs(aRight - bLeft) <= SNAP_THRESHOLD_PX) {
        const overlapStart = Math.max(aTop, bTop);
        const overlapEnd = Math.min(aBottom, bBottom);
        if (overlapStart < overlapEnd) {
          edges.push({
            panelAId: a.id,
            panelBId: b.id,
            axis: "vertical",
            overlapStart,
            overlapEnd,
            boundaryPosition: (aRight + bLeft) / 2,
          });
        }
      }

      // Vertical shared edge: B.right ~ A.left
      if (Math.abs(bRight - aLeft) <= SNAP_THRESHOLD_PX) {
        const overlapStart = Math.max(aTop, bTop);
        const overlapEnd = Math.min(aBottom, bBottom);
        if (overlapStart < overlapEnd) {
          edges.push({
            panelAId: b.id,
            panelBId: a.id,
            axis: "vertical",
            overlapStart,
            overlapEnd,
            boundaryPosition: (bRight + aLeft) / 2,
          });
        }
      }

      // Horizontal shared edge: A.bottom ~ B.top
      if (Math.abs(aBottom - bTop) <= SNAP_THRESHOLD_PX) {
        const overlapStart = Math.max(aLeft, bLeft);
        const overlapEnd = Math.min(aRight, bRight);
        if (overlapStart < overlapEnd) {
          edges.push({
            panelAId: a.id,
            panelBId: b.id,
            axis: "horizontal",
            overlapStart,
            overlapEnd,
            boundaryPosition: (aBottom + bTop) / 2,
          });
        }
      }

      // Horizontal shared edge: B.bottom ~ A.top
      if (Math.abs(bBottom - aTop) <= SNAP_THRESHOLD_PX) {
        const overlapStart = Math.max(aLeft, bLeft);
        const overlapEnd = Math.min(aRight, bRight);
        if (overlapStart < overlapEnd) {
          edges.push({
            panelAId: b.id,
            panelBId: a.id,
            axis: "horizontal",
            overlapStart,
            overlapEnd,
            boundaryPosition: (bBottom + aTop) / 2,
          });
        }
      }
    }
  }

  return edges;
}

// ---- computeSets ----

/**
 * Compute connected components (sets) of panels sharing edges.
 *
 * Uses union-find with path compression.
 * Returns only sets with 2+ panels — singletons are not included.
 */
export function computeSets(panelIds: string[], sharedEdges: SharedEdge[]): PanelSet[] {
  // Union-find parent map
  const parent = new Map<string, string>();

  for (const id of panelIds) {
    parent.set(id, id);
  }

  function find(x: string): string {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  for (const edge of sharedEdges) {
    // Only union panels that are in our panelIds list
    if (parent.has(edge.panelAId) && parent.has(edge.panelBId)) {
      union(edge.panelAId, edge.panelBId);
    }
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const id of panelIds) {
    const root = find(id);
    const group = groups.get(root);
    if (group !== undefined) {
      group.push(id);
    } else {
      groups.set(root, [id]);
    }
  }

  // Return only groups with 2+ members
  const sets: PanelSet[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      sets.push({ panelIds: group });
    }
  }

  return sets;
}

// ---- computeEdgeVisibility ----

/**
 * Compute what fraction of an edge segment is visible (not occluded by higher-z panels).
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
