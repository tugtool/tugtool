/**
 * TabBar — renders a tab strip for multi-tab panels.
 *
 * Presentation-only component: it fires callbacks for all state mutations
 * and lets PanelManager own all panel updates and card lifecycle operations.
 *
 * Supports:
 * - Click-to-switch (fires onTabActivate)
 * - Close button (fires onTabClose, stops propagation)
 * - Drag-reorder within the tab bar (fires onTabReorder)
 */

import { type TabNode } from "./layout-tree";

/** Callbacks wired by PanelManager. */
export interface TabBarCallbacks {
  /** Called when the user clicks a tab (not the close button). */
  onTabActivate: (tabIndex: number) => void;
  /** Called when the user clicks the close button for a tab. */
  onTabClose: (tabId: string) => void;
  /** Called when a drag-reorder finishes within this tab bar. */
  onTabReorder: (fromIndex: number, toIndex: number) => void;
}

/** Pixel threshold before a pointerdown-move is treated as a drag, not a click. */
const DRAG_THRESHOLD_PX = 5;

export class TabBar {
  private rootEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private currentNode: TabNode;

  constructor(node: TabNode, callbacks: TabBarCallbacks) {
    this.currentNode = node;
    this.callbacks = callbacks;

    this.rootEl = document.createElement("div");
    this.rootEl.className = "card-tab-bar";

    this.renderTabs(node);
  }

  /** Returns the root DOM element to be inserted into the panel layout. */
  getElement(): HTMLElement {
    return this.rootEl;
  }

  /**
   * Re-render the tab strip from updated TabNode state.
   * Called by PanelManager after any panel mutation (activate, reorder, close).
   */
  update(node: TabNode): void {
    this.currentNode = node;
    this.renderTabs(node);
  }

  /** Remove all event listeners and detach from DOM. */
  destroy(): void {
    // Event listeners are added to individual tab elements which are
    // cleared by innerHTML = "" on each update; rootEl itself has none.
    this.rootEl.innerHTML = "";
  }

  // ---- Private rendering ----

  private renderTabs(node: TabNode): void {
    this.rootEl.innerHTML = "";

    for (let i = 0; i < node.tabs.length; i++) {
      const tab = node.tabs[i];
      const isActive = i === node.activeTabIndex;

      const tabEl = document.createElement("div");
      tabEl.className = isActive
        ? "card-tab card-tab-active"
        : "card-tab";
      tabEl.dataset.tabId = tab.id;
      tabEl.dataset.tabIndex = String(i);

      // Label
      const labelEl = document.createElement("span");
      labelEl.className = "card-tab-label";
      labelEl.textContent = tab.title;
      tabEl.appendChild(labelEl);

      // Close button
      if (tab.closable !== false) {
        const closeEl = document.createElement("span");
        closeEl.className = "card-tab-close";
        closeEl.textContent = "×";
        closeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.callbacks.onTabClose(tab.id);
        });
        tabEl.appendChild(closeEl);
      }

      // Click-to-switch and drag-reorder share the same pointerdown handler
      this.attachTabPointerEvents(tabEl, i);

      this.rootEl.appendChild(tabEl);
    }
  }

  /**
   * Attach pointer events to a tab element for both click-to-switch and
   * drag-reorder. A 5px movement threshold distinguishes the two.
   */
  private attachTabPointerEvents(tabEl: HTMLElement, tabIndex: number): void {
    tabEl.addEventListener("pointerdown", (downEvent: PointerEvent) => {
      // Only handle primary pointer button
      if (downEvent.button !== 0) return;

      // Don't start drag on the close button
      if ((downEvent.target as HTMLElement).classList.contains("card-tab-close")) {
        return;
      }

      downEvent.preventDefault();
      tabEl.setPointerCapture(downEvent.pointerId);

      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      let dragging = false;
      let fromIndex = tabIndex;

      const onMove = (moveEvent: PointerEvent) => {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (!dragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) {
          dragging = true;
          tabEl.classList.add("dragging");
        }

        if (!dragging) return;

        // Within-tab-bar reorder
        const toIndex = this.hitTestTabIndex(moveEvent.clientX);
        if (toIndex !== -1 && toIndex !== fromIndex) {
          this.callbacks.onTabReorder(fromIndex, toIndex);
          // Update fromIndex: after reorder the dragged tab is now at toIndex
          fromIndex = toIndex;
        }
      };

      const onUp = (_upEvent: PointerEvent) => {
        tabEl.releasePointerCapture(downEvent.pointerId);
        tabEl.removeEventListener("pointermove", onMove);
        tabEl.removeEventListener("pointerup", onUp);
        tabEl.removeEventListener("pointercancel", onUp);

        tabEl.classList.remove("dragging");

        if (!dragging) {
          // It was a click, not a drag
          this.callbacks.onTabActivate(tabIndex);
        }
      };

      tabEl.addEventListener("pointermove", onMove);
      tabEl.addEventListener("pointerup", onUp);
      tabEl.addEventListener("pointercancel", onUp);
    });
  }

  /**
   * Given a clientX coordinate, return the index of the tab whose bounding
   * rect the cursor is within. Returns -1 if not over any tab.
   */
  private hitTestTabIndex(clientX: number): number {
    const tabs = Array.from(
      this.rootEl.querySelectorAll(".card-tab")
    ) as HTMLElement[];

    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        return i;
      }
    }
    return -1;
  }
}
