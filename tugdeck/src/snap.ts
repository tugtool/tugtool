/**
 * Snap geometry module for the canvas card system.
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

import type { CardState } from "./layout-tree";

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
 * A shared edge between two cards.
 * axis: "vertical" means the cards share a vertical boundary (one card's right ~ other's left).
 * axis: "horizontal" means the cards share a horizontal boundary (one card's bottom ~ other's top).
 * overlapStart/overlapEnd: the perpendicular range of the overlap.
 * boundaryPosition: the coordinate of the shared boundary line.
 */
export interface SharedEdge {
  cardAId: string;
  cardBId: string;
  axis: "vertical" | "horizontal";
  overlapStart: number;
  overlapEnd: number;
  boundaryPosition: number;
}

export interface CardSet {
  cardIds: string[];
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

// ---- Helper: convert CardState to Rect ----

/**
 * Convert a CardState to a Rect for use in snap computations.
 */
export function cardToRect(card: CardState): Rect {
  return {
    x: card.position.x,
    y: card.position.y,
    width: card.size.width,
    height: card.size.height,
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

  for (const other of others) {
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

// ---- findSharedEdges ----

/**
 * Detect shared edges between all pairs of cards.
 *
 * A shared vertical edge exists when one card's right edge is within SNAP_THRESHOLD_PX
 * of another card's left edge, AND the cards have overlapping perpendicular ranges (top-to-bottom).
 *
 * A shared horizontal edge exists when one card's bottom edge is within SNAP_THRESHOLD_PX
 * of another card's top edge, AND the cards have overlapping perpendicular ranges (left-to-right).
 *
 * Pairwise check (i < j) avoids duplicates per pair. Each direction is checked
 * separately — A.right~B.left and B.right~A.left are different boundaries.
 */
export function findSharedEdges(cards: { id: string; rect: Rect }[]): SharedEdge[] {
  const edges: SharedEdge[] = [];

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];

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
            cardAId: a.id,
            cardBId: b.id,
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
            cardAId: b.id,
            cardBId: a.id,
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
            cardAId: a.id,
            cardBId: b.id,
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
            cardAId: b.id,
            cardBId: a.id,
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
 * Compute connected components (sets) of cards sharing edges.
 *
 * Uses union-find with path compression.
 * Returns only sets with 2+ cards — singletons are not included.
 */
export function computeSets(cardIds: string[], sharedEdges: SharedEdge[]): CardSet[] {
  // Union-find parent map
  const parent = new Map<string, string>();

  for (const id of cardIds) {
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
    // Only union cards that are in our cardIds list
    if (parent.has(edge.cardAId) && parent.has(edge.cardBId)) {
      union(edge.cardAId, edge.cardBId);
    }
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const id of cardIds) {
    const root = find(id);
    const group = groups.get(root);
    if (group !== undefined) {
      group.push(id);
    } else {
      groups.set(root, [id]);
    }
  }

  // Return only groups with 2+ members
  const sets: CardSet[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      sets.push({ cardIds: group });
    }
  }

  return sets;
}

// ---- Point type and computeSetHullPolygon ----

/**
 * A 2D point in canvas coordinates.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the outer perimeter polygon of a union of axis-aligned rectangles.
 * Returns vertices in canvas coordinates, ordered clockwise.
 * Returns empty array for degenerate input (no rects, zero-area rects).
 *
 * Algorithm:
 * 1. Coordinate compression: collect unique X and Y values from rect edges.
 * 2. Fill a boolean grid: cell (i,j) is filled if any rect covers that sub-region.
 * 3. Find topmost-leftmost filled cell; trace clockwise boundary.
 * 4. Remove collinear vertices for minimal polygon representation.
 *
 * References: [D01] Hull in snap.ts, Spec S01, Spec S02, #hull-algorithm
 */
export function computeSetHullPolygon(rects: Rect[]): Point[] {
  // Filter to non-degenerate rects only
  const validRects = rects.filter((r) => r.width > 0 && r.height > 0);
  if (validRects.length === 0) return [];

  // Step 1: Collect unique X and Y coordinates (sorted)
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  for (const r of validRects) {
    xSet.add(r.x);
    xSet.add(r.x + r.width);
    ySet.add(r.y);
    ySet.add(r.y + r.height);
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);

  const cols = xs.length - 1;
  const rows = ys.length - 1;
  if (cols <= 0 || rows <= 0) return [];

  // Step 2: Build boolean grid — cell (ci, ri) is filled if any rect covers it
  const grid: boolean[] = new Array(cols * rows).fill(false);
  for (const r of validRects) {
    // Find the column/row range this rect covers
    const ciStart = xs.indexOf(r.x);
    const ciEnd = xs.indexOf(r.x + r.width);
    const riStart = ys.indexOf(r.y);
    const riEnd = ys.indexOf(r.y + r.height);
    for (let ci = ciStart; ci < ciEnd; ci++) {
      for (let ri = riStart; ri < riEnd; ri++) {
        grid[ri * cols + ci] = true;
      }
    }
  }

  // Helper: is cell (ci, ri) filled?
  function cellFilled(ci: number, ri: number): boolean {
    if (ci < 0 || ci >= cols || ri < 0 || ri >= rows) return false;
    return grid[ri * cols + ci];
  }

  // Step 3: Find topmost-leftmost filled cell
  let startCi = -1;
  let startRi = -1;
  outer: for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      if (cellFilled(ci, ri)) {
        startCi = ci;
        startRi = ri;
        break outer;
      }
    }
  }
  if (startCi === -1) return [];

  // Step 4: Clockwise boundary trace (in screen/canvas coordinates, y-down)
  // Traces the outer perimeter with the filled interior on the LEFT as we walk.
  // Directions indexed as: 0=RIGHT, 1=DOWN, 2=LEFT, 3=UP (clockwise sequence in screen space).
  // Position is a grid corner in range [0..cols] x [0..rows].
  // Starting corner is top-left of topmost-leftmost filled cell, facing RIGHT.
  //
  // At each step (cellAhead = the interior cell we are hugging on our LEFT):
  //   - If the cell to our interior-right (cellToRight) is filled: concave corner, turn
  //     counterclockwise in screen (= (dir+3)%4), step forward, record vertex.
  //   - Else if cell ahead (cellAhead) is filled: continue straight, step forward, record vertex.
  //   - Else: convex outer corner, turn clockwise in screen (= (dir+1)%4), no step.
  //
  // Corner (col, row) cell lookups (derived from the spec's clockwise boundary trace spec):
  //   RIGHT → cellAhead = (col, row)       DOWN  → cellAhead = (col-1, row)
  //   LEFT  → cellAhead = (col-1, row-1)   UP    → cellAhead = (col, row-1)
  //   RIGHT → cellToRight = (col, row-1)   DOWN  → cellToRight = (col, row)
  //   LEFT  → cellToRight = (col-1, row)   UP    → cellToRight = (col-1, row-1)
  const DIR_RIGHT = 0;
  const DIR_DOWN = 1;
  const DIR_LEFT = 2;
  const DIR_UP = 3;

  function cellAheadOf(col: number, row: number, dir: number): [number, number] {
    switch (dir) {
      case DIR_RIGHT: return [col, row];
      case DIR_DOWN:  return [col - 1, row];
      case DIR_LEFT:  return [col - 1, row - 1];
      case DIR_UP:    return [col, row - 1];
      default:        return [col, row];
    }
  }

  function cellToRightOf(col: number, row: number, dir: number): [number, number] {
    switch (dir) {
      case DIR_RIGHT: return [col, row - 1];
      case DIR_DOWN:  return [col, row];
      case DIR_LEFT:  return [col - 1, row];
      case DIR_UP:    return [col - 1, row - 1];
      default:        return [col, row];
    }
  }

  function stepDir(dir: number): [number, number] {
    switch (dir) {
      case DIR_RIGHT: return [1, 0];
      case DIR_DOWN:  return [0, 1];
      case DIR_LEFT:  return [-1, 0];
      case DIR_UP:    return [0, -1];
      default:        return [0, 0];
    }
  }

  // Start at top-left corner of the topmost-leftmost filled cell, facing RIGHT
  let col = startCi;
  let row = startRi;
  let dir = DIR_RIGHT;
  const startCol = col;
  const startRow = row;
  const startDir = dir;

  const vertices: Array<[number, number]> = [[col, row]];

  // Safety limit to prevent infinite loops
  const maxIter = (cols + rows) * 4 * 4 + 8;
  let iter = 0;

  for (;;) {
    iter++;
    if (iter > maxIter) break; // Safety exit

    // At a concave inner corner (cellToRight is filled): turn counterclockwise in screen (dir+3)%4
    const [rci, rri] = cellToRightOf(col, row, dir);
    if (cellFilled(rci, rri)) {
      dir = (dir + 3) % 4;
      const [dx, dy] = stepDir(dir);
      col += dx;
      row += dy;
      vertices.push([col, row]);
    } else {
      // Check cell ahead (interior is still to our left: go straight)
      const [aci, ari] = cellAheadOf(col, row, dir);
      if (cellFilled(aci, ari)) {
        const [dx, dy] = stepDir(dir);
        col += dx;
        row += dy;
        vertices.push([col, row]);
      } else {
        // Convex outer corner: turn clockwise in screen (dir+1)%4, no step
        dir = (dir + 1) % 4;
      }
    }

    // Check if we've completed the loop
    if (col === startCol && row === startRow && dir === startDir) {
      break;
    }
  }

  // The last vertex is the same as the first (loop closure); remove it
  if (
    vertices.length > 1 &&
    vertices[vertices.length - 1][0] === vertices[0][0] &&
    vertices[vertices.length - 1][1] === vertices[0][1]
  ) {
    vertices.pop();
  }

  // Step 5: Remove collinear vertices
  // A vertex is collinear if it lies on a straight line between its neighbors
  function removeCollinear(pts: Array<[number, number]>): Array<[number, number]> {
    if (pts.length <= 2) return pts;
    const result: Array<[number, number]> = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i + n - 1) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      // Direction prev→cur
      const dx1 = cur[0] - prev[0];
      const dy1 = cur[1] - prev[1];
      // Direction cur→next
      const dx2 = next[0] - cur[0];
      const dy2 = next[1] - cur[1];
      // Collinear if same direction (cross product = 0)
      if (dx1 * dy2 !== dx2 * dy1) {
        result.push(cur);
      }
    }
    return result;
  }

  const minimal = removeCollinear(vertices);

  // Step 6: Convert grid indices back to canvas coordinates
  return minimal.map(([ci, ri]) => ({ x: xs[ci], y: ys[ri] }));
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
