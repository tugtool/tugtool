/**
 * FloatingPanel — absolutely-positioned panel with move, resize, and z-order.
 *
 * The panel contains:
 * - A CardHeader providing icon, title, close, and drag-to-move.
 * - A card area below the header where card DOM is mounted.
 * - Eight resize handles (4 edges + 4 corners).
 *
 * All mutations (move end, resize end, focus, close) fire callbacks so
 * PanelManager owns the CanvasState mutations and serialization.
 *
 * Spec S01: PanelState data model
 * [D03] FloatingPanel accepts PanelState directly
 * [D06] Key panel focus model with title bar tint
 */

import type { PanelState } from "./layout-tree";
import type { TugCardMeta } from "./cards/card";
import { CardHeader } from "./card-header";

/** Minimum floating panel dimension in pixels */
const MIN_SIZE_PX = 100;

/** Drag threshold before a pointerdown becomes a drag (not a focus click) */
const DRAG_THRESHOLD_PX = 3;

/** Height of the header bar in pixels */
export const FLOATING_TITLE_BAR_HEIGHT = 28;

/** Inset from canvas edges — panels can't be positioned flush against the viewport */
const CANVAS_INSET_PX = 2;

export interface FloatingPanelCallbacks {
  /** Called when the user finishes dragging the panel to a new position. */
  onMoveEnd: (x: number, y: number) => void;
  /** Called when the user finishes resizing the panel. */
  onResizeEnd: (x: number, y: number, width: number, height: number) => void;
  /** Called when the panel receives focus (click anywhere). */
  onFocus: () => void;
  /** Called when the close button in the header is clicked. */
  onClose: () => void;
  /** Called on every pointermove during header drag. Return the (potentially snapped) position. */
  onMoving?: (x: number, y: number) => { x: number; y: number };
  /** Called on every pointermove during resize. Return the (potentially snapped) geometry. */
  onResizing?: (x: number, y: number, width: number, height: number) => { x: number; y: number; width: number; height: number };
}

export class FloatingPanel {
  private el: HTMLElement;
  private cardHeader: CardHeader;
  private cardAreaEl: HTMLElement;
  private panelState: PanelState;
  private callbacks: FloatingPanelCallbacks;
  private canvasEl: HTMLElement;

  constructor(
    panelState: PanelState,
    callbacks: FloatingPanelCallbacks,
    canvasEl: HTMLElement,
    meta?: TugCardMeta
  ) {
    this.panelState = panelState;
    this.callbacks = callbacks;
    this.canvasEl = canvasEl;

    this.el = document.createElement("div");
    this.el.className = "floating-panel";
    this.applyGeometry();

    // Focus on click anywhere in the panel
    this.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      callbacks.onFocus();
    });

    // Build meta from PanelState active tab if not provided
    const activeTab = panelState.tabs.find((t) => t.id === panelState.activeTabId)
      ?? panelState.tabs[0];
    const headerMeta: TugCardMeta = meta ?? {
      title: activeTab?.title ?? "Panel",
      icon: "Box",
      closable: true,
      menuItems: [],
    };

    this.cardHeader = new CardHeader(headerMeta, {
      onClose: () => {
        callbacks.onClose();
      },
      onCollapse: () => {
        // No-op: collapse does not apply to floating panels
      },
      onDragStart: (downEvent: PointerEvent) => {
        this.handleHeaderDrag(downEvent);
      },
    }, { showCollapse: false });

    this.el.appendChild(this.cardHeader.getElement());

    // Card area
    this.cardAreaEl = document.createElement("div");
    this.cardAreaEl.className = "floating-panel-content";
    this.el.appendChild(this.cardAreaEl);

    // Resize handles
    this.createResizeHandles();
  }

  getElement(): HTMLElement {
    return this.el;
  }

  getCardAreaElement(): HTMLElement {
    return this.cardAreaEl;
  }

  getPanelState(): PanelState {
    return this.panelState;
  }

  setZIndex(z: number): void {
    this.el.style.zIndex = String(z);
  }

  /** Kept for API compatibility; CardHeader renders the title. */
  updateTitle(_title: string): void {
    // Title is rendered by CardHeader; recreate would be needed for live updates.
  }

  updatePosition(x: number, y: number): void {
    this.panelState.position = { x, y };
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  updateSize(width: number, height: number): void {
    this.panelState.size = { width, height };
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
  }

  /** Toggle the key-panel title bar tint on the header element. */
  setKey(isKey: boolean): void {
    this.cardHeader.getElement().classList.toggle("panel-header-key", isKey);
  }

  destroy(): void {
    this.cardHeader.destroy();
    this.el.remove();
  }

  // ---- Private ----

  private applyGeometry(): void {
    const { x, y } = this.panelState.position;
    const { width, height } = this.panelState.size;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
  }

  /**
   * Handle header pointerdown for free-form canvas movement.
   *
   * Panel moves freely within canvas bounds. No re-dock detection.
   */
  private handleHeaderDrag(downEvent: PointerEvent): void {
    downEvent.preventDefault();

    const headerEl = this.cardHeader.getElement();
    if (headerEl.setPointerCapture) {
      headerEl.setPointerCapture(downEvent.pointerId);
    }

    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    const startPanelX = this.panelState.position.x;
    const startPanelY = this.panelState.position.y;
    let dragging = false;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!dragging && dist > DRAG_THRESHOLD_PX) {
        dragging = true;
      }
      if (!dragging) return;

      // Move freely within canvas bounds (with inset)
      const canvasRect = this.canvasEl.getBoundingClientRect();
      let newX = Math.max(CANVAS_INSET_PX, Math.min(canvasRect.width - this.panelState.size.width - CANVAS_INSET_PX, startPanelX + dx));
      let newY = Math.max(CANVAS_INSET_PX, Math.min(canvasRect.height - this.panelState.size.height - CANVAS_INSET_PX, startPanelY + dy));

      // Apply live callback if provided (snap override)
      if (this.callbacks.onMoving) {
        const snapped = this.callbacks.onMoving(newX, newY);
        newX = snapped.x;
        newY = snapped.y;
      }

      this.updatePosition(newX, newY);
    };

    const onUp = (_e: PointerEvent) => {
      if (headerEl.releasePointerCapture) {
        headerEl.releasePointerCapture(downEvent.pointerId);
      }
      headerEl.removeEventListener("pointermove", onMove);
      headerEl.removeEventListener("pointerup", onUp);
      headerEl.removeEventListener("pointercancel", onUp);

      if (dragging) {
        this.callbacks.onMoveEnd(
          this.panelState.position.x,
          this.panelState.position.y
        );
      }
    };

    headerEl.addEventListener("pointermove", onMove);
    headerEl.addEventListener("pointerup", onUp);
    headerEl.addEventListener("pointercancel", onUp);
  }

  /**
   * Create the eight resize handles (n, s, e, w, nw, ne, sw, se).
   */
  private createResizeHandles(): void {
    const directions = ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const;
    for (const dir of directions) {
      const handle = document.createElement("div");
      handle.className = `floating-panel-resize floating-panel-resize-${dir}`;
      this.el.appendChild(handle);
      this.attachResizeDrag(handle, dir);
    }
  }

  private attachResizeDrag(
    handle: HTMLElement,
    dir: "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se"
  ): void {
    handle.addEventListener("pointerdown", (downEvent: PointerEvent) => {
      downEvent.preventDefault();
      downEvent.stopPropagation();
      if (handle.setPointerCapture) {
        handle.setPointerCapture(downEvent.pointerId);
      }

      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const startW = this.panelState.size.width;
      const startH = this.panelState.size.height;
      const startPX = this.panelState.position.x;
      const startPY = this.panelState.position.y;

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const canvasRect = this.canvasEl.getBoundingClientRect();

        let newX = startPX;
        let newY = startPY;
        let newW = startW;
        let newH = startH;

        // Horizontal sizing
        if (dir === "e" || dir === "ne" || dir === "se") {
          newW = Math.max(MIN_SIZE_PX, startW + dx);
        } else if (dir === "w" || dir === "nw" || dir === "sw") {
          const candidateW = Math.max(MIN_SIZE_PX, startW - dx);
          newX = startPX + (startW - candidateW);
          newW = candidateW;
        }

        // Vertical sizing
        if (dir === "s" || dir === "sw" || dir === "se") {
          newH = Math.max(MIN_SIZE_PX, startH + dy);
        } else if (dir === "n" || dir === "nw" || dir === "ne") {
          const candidateH = Math.max(MIN_SIZE_PX, startH - dy);
          newY = startPY + (startH - candidateH);
          newH = candidateH;
        }

        // Clamp to canvas bounds (with inset)
        if (newX < CANVAS_INSET_PX) { newW += newX - CANVAS_INSET_PX; newX = CANVAS_INSET_PX; }
        if (newY < CANVAS_INSET_PX) { newH += newY - CANVAS_INSET_PX; newY = CANVAS_INSET_PX; }
        if (newX + newW > canvasRect.width - CANVAS_INSET_PX) { newW = canvasRect.width - CANVAS_INSET_PX - newX; }
        if (newY + newH > canvasRect.height - CANVAS_INSET_PX) { newH = canvasRect.height - CANVAS_INSET_PX - newY; }
        // Re-enforce minimum size after viewport clamping
        newW = Math.max(MIN_SIZE_PX, newW);
        newH = Math.max(MIN_SIZE_PX, newH);

        // Apply live callback if provided (snap override)
        if (this.callbacks.onResizing) {
          const snapped = this.callbacks.onResizing(newX, newY, newW, newH);
          newX = snapped.x;
          newY = snapped.y;
          newW = snapped.width;
          newH = snapped.height;
        }

        this.updatePosition(newX, newY);
        this.updateSize(newW, newH);
      };

      const onUp = (_e: PointerEvent) => {
        if (handle.releasePointerCapture) {
          handle.releasePointerCapture(downEvent.pointerId);
        }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);

        this.callbacks.onResizeEnd(
          this.panelState.position.x,
          this.panelState.position.y,
          this.panelState.size.width,
          this.panelState.size.height
        );
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}
