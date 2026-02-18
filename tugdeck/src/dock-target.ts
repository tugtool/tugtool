/**
 * Dock targeting: zone detection (computeDropZone) and drop overlay (DockOverlay).
 *
 * computeDropZone is a PURE FUNCTION — no DOM access. All bounding rect data is
 * passed in as arguments, making the function trivially testable.
 *
 * Spec S05: Zone Detection Algorithm (Lumino-style, strict P1/P2/P3 precedence)
 * Table T01: Overlay Geometry per Zone
 */

import type { DockZone } from "./layout-tree";

// ---- Types ----

export interface DropZoneResult {
  zone: DockZone;
  /** null for root-* zones */
  targetTabNodeId: string | null;
  /** Absolute pixel rect for the overlay, relative to the canvas container */
  overlayRect: { x: number; y: number; width: number; height: number };
}

export interface TabNodeRect {
  tabNodeId: string;
  rect: DOMRect;
  /** Height of the tab bar (28px when present, 0 for single-tab nodes) */
  tabBarHeight: number;
}

/** 38.2% golden ratio complement — fraction of canvas covered by root-zone overlay */
const ROOT_OVERLAY_FRACTION = 0.382;

/** Root-edge detection threshold in pixels (P1) */
const ROOT_EDGE_THRESHOLD_PX = 40;

/** P2 tab-bar hit zone uses the stored tabBarHeight from TabNodeRect */

/**
 * Pure zone detection function.
 *
 * @param cursorX - Cursor X in viewport coordinates
 * @param cursorY - Cursor Y in viewport coordinates
 * @param canvasRect - Bounding rect of the panel canvas (this.container)
 * @param tabNodeRects - Bounding rects for all docked TabNodes
 * @returns DropZoneResult or null if cursor is not over a valid drop target
 */
export function computeDropZone(
  cursorX: number,
  cursorY: number,
  canvasRect: DOMRect,
  tabNodeRects: TabNodeRect[]
): DropZoneResult | null {
  // ---- P1: Root edge test (absolute priority) ----

  const dLeft = cursorX - canvasRect.left;
  const dRight = canvasRect.right - cursorX;
  const dTop = cursorY - canvasRect.top;
  const dBottom = canvasRect.bottom - cursorY;

  const nearLeft = dLeft < ROOT_EDGE_THRESHOLD_PX;
  const nearRight = dRight < ROOT_EDGE_THRESHOLD_PX;
  const nearTop = dTop < ROOT_EDGE_THRESHOLD_PX;
  const nearBottom = dBottom < ROOT_EDGE_THRESHOLD_PX;

  if (nearLeft || nearRight || nearTop || nearBottom) {
    // Resolve corner: pick the closer edge; on tie prefer horizontal (top/bottom)
    let rootZone: DockZone;

    // Collect candidates
    const candidates: { zone: DockZone; dist: number; isHorizontal: boolean }[] = [];
    if (nearLeft) candidates.push({ zone: "root-left", dist: dLeft, isHorizontal: false });
    if (nearRight) candidates.push({ zone: "root-right", dist: dRight, isHorizontal: false });
    if (nearTop) candidates.push({ zone: "root-top", dist: dTop, isHorizontal: true });
    if (nearBottom) candidates.push({ zone: "root-bottom", dist: dBottom, isHorizontal: true });

    // Sort: smallest distance first; on tie, horizontal wins (isHorizontal=true sorts before false)
    candidates.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      // Tie-break: horizontal wins
      if (a.isHorizontal && !b.isHorizontal) return -1;
      if (!a.isHorizontal && b.isHorizontal) return 1;
      return 0;
    });

    rootZone = candidates[0].zone;

    const cW = canvasRect.width;
    const cH = canvasRect.height;
    const overlayFracW = cW * ROOT_OVERLAY_FRACTION;
    const overlayFracH = cH * ROOT_OVERLAY_FRACTION;

    let overlayRect: { x: number; y: number; width: number; height: number };
    switch (rootZone) {
      case "root-left":
        overlayRect = { x: 0, y: 0, width: overlayFracW, height: cH };
        break;
      case "root-right":
        overlayRect = { x: cW - overlayFracW, y: 0, width: overlayFracW, height: cH };
        break;
      case "root-top":
        overlayRect = { x: 0, y: 0, width: cW, height: overlayFracH };
        break;
      case "root-bottom":
        overlayRect = { x: 0, y: cH - overlayFracH, width: cW, height: overlayFracH };
        break;
      default:
        overlayRect = { x: 0, y: 0, width: cW, height: cH };
    }

    return { zone: rootZone, targetTabNodeId: null, overlayRect };
  }

  // ---- P2 / P3: Find which TabNode the cursor is over ----

  let hitNode: TabNodeRect | null = null;
  for (const tnr of tabNodeRects) {
    const r = tnr.rect;
    if (
      cursorX >= r.left &&
      cursorX <= r.right &&
      cursorY >= r.top &&
      cursorY <= r.bottom
    ) {
      hitNode = tnr;
      break;
    }
  }

  if (!hitNode) {
    // Cursor is over a sash or outside all tab nodes
    return null;
  }

  const r = hitNode.rect;
  const nodeLeft = r.left - canvasRect.left;
  const nodeTop = r.top - canvasRect.top;
  const nodeW = r.width;
  const nodeH = r.height;

  // ---- P2: Tab-bar zone ----
  if (hitNode.tabBarHeight > 0 && cursorY - r.top < hitNode.tabBarHeight) {
    return {
      zone: "tab-bar",
      targetTabNodeId: hitNode.tabNodeId,
      overlayRect: {
        x: nodeLeft,
        y: nodeTop,
        width: nodeW,
        height: hitNode.tabBarHeight,
      },
    };
  }

  // ---- P3: Widget zone (closest edge) ----

  const edgeDLeft = cursorX - r.left;
  const edgeDRight = r.right - cursorX;
  const edgeDTop = cursorY - r.top;
  const edgeDBottom = r.bottom - cursorY;

  const centerX = r.left + nodeW / 2;
  const centerY = r.top + nodeH / 2;
  const absFromCenterX = Math.abs(cursorX - centerX);
  const absFromCenterY = Math.abs(cursorY - centerY);

  // Center zone: cursor is within 25% of each edge in each dimension
  const centerThresholdX = nodeW * 0.25;
  const centerThresholdY = nodeH * 0.25;
  const nearCenter =
    edgeDLeft > centerThresholdX &&
    edgeDRight > centerThresholdX &&
    edgeDTop > centerThresholdY &&
    edgeDBottom > centerThresholdY;

  if (nearCenter) {
    return {
      zone: "center",
      targetTabNodeId: hitNode.tabNodeId,
      overlayRect: { x: nodeLeft, y: nodeTop, width: nodeW, height: nodeH },
    };
  }

  // Find closest edge
  const minDist = Math.min(edgeDLeft, edgeDRight, edgeDTop, edgeDBottom);

  let zone: DockZone;
  if (edgeDLeft === minDist && edgeDRight === minDist) {
    // Tie between left and right: use larger distance from center rule
    zone = absFromCenterX >= absFromCenterY ? "widget-left" : "widget-top";
  } else if (edgeDTop === minDist && edgeDBottom === minDist) {
    // Tie between top and bottom
    zone = absFromCenterY >= absFromCenterX ? "widget-top" : "widget-left";
  } else if (edgeDLeft === minDist && edgeDTop === minDist) {
    // Tie between left and top: larger distance from center wins; tie -> horizontal
    if (absFromCenterX > absFromCenterY) zone = "widget-left";
    else if (absFromCenterY > absFromCenterX) zone = "widget-top";
    else zone = "widget-top"; // exact tie -> horizontal
  } else if (edgeDLeft === minDist && edgeDBottom === minDist) {
    if (absFromCenterX > absFromCenterY) zone = "widget-left";
    else if (absFromCenterY > absFromCenterX) zone = "widget-bottom";
    else zone = "widget-bottom";
  } else if (edgeDRight === minDist && edgeDTop === minDist) {
    if (absFromCenterX > absFromCenterY) zone = "widget-right";
    else if (absFromCenterY > absFromCenterX) zone = "widget-top";
    else zone = "widget-top";
  } else if (edgeDRight === minDist && edgeDBottom === minDist) {
    if (absFromCenterX > absFromCenterY) zone = "widget-right";
    else if (absFromCenterY > absFromCenterX) zone = "widget-bottom";
    else zone = "widget-bottom";
  } else if (edgeDLeft === minDist) {
    zone = "widget-left";
  } else if (edgeDRight === minDist) {
    zone = "widget-right";
  } else if (edgeDTop === minDist) {
    zone = "widget-top";
  } else {
    zone = "widget-bottom";
  }

  // Overlay geometry (Table T01): 50% of TabNode in the split dimension
  let overlayRect: { x: number; y: number; width: number; height: number };
  switch (zone) {
    case "widget-left":
      overlayRect = { x: nodeLeft, y: nodeTop, width: nodeW / 2, height: nodeH };
      break;
    case "widget-right":
      overlayRect = { x: nodeLeft + nodeW / 2, y: nodeTop, width: nodeW / 2, height: nodeH };
      break;
    case "widget-top":
      overlayRect = { x: nodeLeft, y: nodeTop, width: nodeW, height: nodeH / 2 };
      break;
    case "widget-bottom":
      overlayRect = { x: nodeLeft, y: nodeTop + nodeH / 2, width: nodeW, height: nodeH / 2 };
      break;
    case "center":
      overlayRect = { x: nodeLeft, y: nodeTop, width: nodeW, height: nodeH };
      break;
    default:
      overlayRect = { x: nodeLeft, y: nodeTop, width: nodeW, height: nodeH };
  }

  return { zone, targetTabNodeId: hitNode.tabNodeId, overlayRect };
}

// ---- DockOverlay ----

/**
 * Single absolutely-positioned overlay div showing the drop zone.
 *
 * Positioned relative to the canvas container (this.container in PanelManager).
 * Uses a 100ms hide delay to prevent flicker on zone boundary crossing.
 * Zone changes show the new geometry immediately (no delay for show).
 */
export class DockOverlay {
  private el: HTMLElement;
  private hideTimer: number | null = null;

  constructor(canvasContainer: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "dock-overlay";
    this.el.style.display = "none";
    canvasContainer.appendChild(this.el);
  }

  /**
   * Show the overlay at the given canvas-relative rect.
   * Cancels any pending hide timer immediately.
   */
  show(rect: { x: number; y: number; width: number; height: number }): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.el.style.left = `${rect.x}px`;
    this.el.style.top = `${rect.y}px`;
    this.el.style.width = `${rect.width}px`;
    this.el.style.height = `${rect.height}px`;
    this.el.style.display = "block";
  }

  /**
   * Hide the overlay after a 100ms delay (prevents flicker on zone boundary
   * crossing). If show() is called before the timer fires, the hide is cancelled.
   */
  hide(): void {
    if (this.hideTimer !== null) return;
    this.hideTimer = window.setTimeout(() => {
      this.el.style.display = "none";
      this.hideTimer = null;
    }, 100);
  }

  /** Hide immediately (used on drag end/cancel). */
  hideNow(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.style.display = "none";
  }

  destroy(): void {
    this.hideNow();
    this.el.remove();
  }
}

/**
 * Returns true if the cursor is inside the canvas container rect.
 * Used in onDragUp to decide between undock-to-floating and cancel.
 */
export function isCursorInsideCanvas(
  cursorX: number,
  cursorY: number,
  canvasRect: DOMRect
): boolean {
  return (
    cursorX >= canvasRect.left &&
    cursorX <= canvasRect.right &&
    cursorY >= canvasRect.top &&
    cursorY <= canvasRect.bottom
  );
}
