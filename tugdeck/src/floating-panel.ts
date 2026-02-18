/**
 * FloatingPanel — absolutely-positioned panel with move, resize, and z-order.
 *
 * The panel contains:
 * - A temporary 28px title bar (drag to move/re-dock; Step 5 replaces with CardHeader)
 * - A card area below the title bar where the card DOM is mounted
 * - Eight resize handles (4 edges + 4 corners)
 *
 * All mutations (move end, resize end, focus, drag-out) fire callbacks so
 * PanelManager owns the DockState mutations and serialization.
 */

import type { FloatingGroup } from "./layout-tree";

/** Minimum floating panel dimension in pixels (L01.7) */
const MIN_SIZE_PX = 100;

/** Drag threshold before a pointerdown becomes a drag (not a focus click) */
const DRAG_THRESHOLD_PX = 3;

/** Height of the temporary title bar in pixels */
export const FLOATING_TITLE_BAR_HEIGHT = 28;

export interface FloatingPanelCallbacks {
  /** Called when the user finishes dragging the panel to a new position. */
  onMoveEnd: (x: number, y: number) => void;
  /** Called when the user finishes resizing the panel. */
  onResizeEnd: (x: number, y: number, width: number, height: number) => void;
  /** Called when the panel receives focus (click anywhere). */
  onFocus: () => void;
  /**
   * Called when the title bar is dragged beyond DRAG_THRESHOLD_PX.
   * PanelManager takes over and initiates re-dock drag targeting.
   */
  onDragOut: (startEvent: PointerEvent) => void;
}

export class FloatingPanel {
  private el: HTMLElement;
  private titleBarEl: HTMLElement;
  private cardAreaEl: HTMLElement;
  private floatingGroup: FloatingGroup;
  private callbacks: FloatingPanelCallbacks;
  private canvasEl: HTMLElement;

  constructor(
    floatingGroup: FloatingGroup,
    callbacks: FloatingPanelCallbacks,
    canvasEl: HTMLElement
  ) {
    this.floatingGroup = floatingGroup;
    this.callbacks = callbacks;
    this.canvasEl = canvasEl;

    this.el = document.createElement("div");
    this.el.className = "floating-panel";
    this.applyGeometry();

    // Focus on click anywhere in the panel
    this.el.addEventListener("pointerdown", (e) => {
      // Stop propagation so canvas doesn't also receive this pointerdown
      e.stopPropagation();
      callbacks.onFocus();
    });

    // Title bar
    this.titleBarEl = document.createElement("div");
    this.titleBarEl.className = "floating-panel-title-bar";
    this.titleBarEl.textContent = floatingGroup.node.tabs[floatingGroup.node.activeTabIndex]?.title ?? "Panel";
    this.el.appendChild(this.titleBarEl);
    this.attachTitleBarDrag();

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

  getFloatingGroup(): FloatingGroup {
    return this.floatingGroup;
  }

  setZIndex(z: number): void {
    this.el.style.zIndex = String(z);
  }

  updateTitle(title: string): void {
    this.titleBarEl.textContent = title;
  }

  updatePosition(x: number, y: number): void {
    this.floatingGroup.position = { x, y };
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  updateSize(width: number, height: number): void {
    this.floatingGroup.size = { width, height };
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
  }

  destroy(): void {
    this.el.remove();
  }

  // ---- Private ----

  private applyGeometry(): void {
    const { x, y } = this.floatingGroup.position;
    const { width, height } = this.floatingGroup.size;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
  }

  /**
   * Title bar: pointerdown with DRAG_THRESHOLD_PX threshold.
   * - Click (< threshold): fires onFocus (already handled by panel-level listener)
   * - Drag within canvas: move the floating panel
   * - Drag (fires onDragOut): hands control to PanelManager for re-dock targeting
   */
  private attachTitleBarDrag(): void {
    this.titleBarEl.addEventListener("pointerdown", (downEvent: PointerEvent) => {
      if (downEvent.button !== 0) return;
      downEvent.preventDefault();
      downEvent.stopPropagation();
      this.titleBarEl.setPointerCapture(downEvent.pointerId);

      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const startPanelX = this.floatingGroup.position.x;
      const startPanelY = this.floatingGroup.position.y;
      let dragging = false;
      let draggedOut = false;

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!dragging && dist > DRAG_THRESHOLD_PX) {
          dragging = true;
        }
        if (!dragging) return;

        // Detect when cursor leaves the floating panel's bounding rect — this
        // transitions to re-dock targeting. Hand pointer control to PanelManager
        // by releasing capture and removing local listeners before calling onDragOut.
        if (!draggedOut) {
          const panelRect = this.el.getBoundingClientRect();
          const outsidePanel =
            e.clientX < panelRect.left ||
            e.clientX > panelRect.right ||
            e.clientY < panelRect.top ||
            e.clientY > panelRect.bottom;

          if (outsidePanel) {
            draggedOut = true;
            this.titleBarEl.releasePointerCapture(downEvent.pointerId);
            this.titleBarEl.removeEventListener("pointermove", onMove);
            this.titleBarEl.removeEventListener("pointerup", onUp);
            this.titleBarEl.removeEventListener("pointercancel", onUp);
            // Hand off to PanelManager for dock-zone targeting
            this.callbacks.onDragOut(downEvent);
            return;
          }
        }

        if (draggedOut) return;

        // Move the panel with the cursor
        const canvasRect = this.canvasEl.getBoundingClientRect();
        const newX = Math.max(0, Math.min(canvasRect.width - this.floatingGroup.size.width, startPanelX + dx));
        const newY = Math.max(0, Math.min(canvasRect.height - this.floatingGroup.size.height, startPanelY + dy));
        this.updatePosition(newX, newY);
      };

      const onUp = (_e: PointerEvent) => {
        this.titleBarEl.releasePointerCapture(downEvent.pointerId);
        this.titleBarEl.removeEventListener("pointermove", onMove);
        this.titleBarEl.removeEventListener("pointerup", onUp);
        this.titleBarEl.removeEventListener("pointercancel", onUp);

        if (dragging && !draggedOut) {
          this.callbacks.onMoveEnd(
            this.floatingGroup.position.x,
            this.floatingGroup.position.y
          );
        }
      };

      this.titleBarEl.addEventListener("pointermove", onMove);
      this.titleBarEl.addEventListener("pointerup", onUp);
      this.titleBarEl.addEventListener("pointercancel", onUp);
    });
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
      handle.setPointerCapture(downEvent.pointerId);

      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const startW = this.floatingGroup.size.width;
      const startH = this.floatingGroup.size.height;
      const startPX = this.floatingGroup.position.x;
      const startPY = this.floatingGroup.position.y;

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

        // Clamp position to canvas bounds
        newX = Math.max(0, Math.min(canvasRect.width - newW, newX));
        newY = Math.max(0, Math.min(canvasRect.height - newH, newY));

        this.updatePosition(newX, newY);
        this.updateSize(newW, newH);
      };

      const onUp = (_e: PointerEvent) => {
        handle.releasePointerCapture(downEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);

        this.callbacks.onResizeEnd(
          this.floatingGroup.position.x,
          this.floatingGroup.position.y,
          this.floatingGroup.size.width,
          this.floatingGroup.size.height
        );
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}
