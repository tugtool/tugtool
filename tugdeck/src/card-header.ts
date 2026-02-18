/**
 * CardHeader — the standard 28px header bar for docked and floating cards.
 *
 * Structure (left to right):
 *   icon (14px Lucide) | title (12px, uppercase, 600 weight) | spacer | [menu btn] | [collapse btn] | [close btn]
 *
 * Drag initiation: pointerdown on the header root element (excluding buttons)
 * fires onDragStart, enabling single-tab docked cards to be dragged.
 *
 * [D06] Hybrid header bar construction
 */

import {
  createElement,
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
  EllipsisVertical,
  Minus,
  X,
  Box,
} from "lucide";
import type { TugCardMeta } from "./cards/card";
import { DropdownMenu } from "./card-menu";

// ---- Icon lookup map ----

const ICON_MAP: Record<string, Parameters<typeof createElement>[0]> = {
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
};

export interface CardHeaderCallbacks {
  /** Called when the close button is clicked. */
  onClose: () => void;
  /** Called when the collapse button is clicked (docked only). */
  onCollapse: () => void;
  /** Called when a pointer drag is initiated on the header. Omit to disable drag. */
  onDragStart?: (e: PointerEvent) => void;
}

export class CardHeader {
  private el: HTMLElement;
  private collapseBtn: HTMLElement | null = null;
  private meta: TugCardMeta;
  private activeMenu: DropdownMenu | null = null;

  constructor(
    meta: TugCardMeta,
    callbacks: CardHeaderCallbacks,
    options: { showCollapse?: boolean } = {}
  ) {
    this.meta = meta;

    // Root element
    this.el = document.createElement("div");
    this.el.className = "panel-header";

    // ---- Icon ----
    const iconEl = document.createElement("div");
    iconEl.className = "panel-header-icon";
    const iconDef = ICON_MAP[meta.icon] ?? Box;
    iconEl.appendChild(createElement(iconDef, { width: 14, height: 14 }));
    this.el.appendChild(iconEl);

    // ---- Title ----
    const titleEl = document.createElement("div");
    titleEl.className = "panel-header-title";
    titleEl.textContent = meta.title;
    this.el.appendChild(titleEl);

    // ---- Spacer ----
    const spacer = document.createElement("div");
    spacer.className = "panel-header-spacer";
    this.el.appendChild(spacer);

    // ---- Menu button (hidden if no menuItems) ----
    if (meta.menuItems.length > 0) {
      const menuBtn = document.createElement("button");
      menuBtn.className = "panel-header-btn";
      menuBtn.setAttribute("aria-label", "Card menu");
      menuBtn.appendChild(createElement(EllipsisVertical, { width: 14, height: 14 }));
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeMenu && this.activeMenu.isOpen()) {
          this.activeMenu.close();
          this.activeMenu = null;
        } else {
          const menu = new DropdownMenu(meta.menuItems, menuBtn);
          this.activeMenu = menu;
          menu.open();
        }
      });
      this.el.appendChild(menuBtn);
    }

    // ---- Collapse button (docked only) ----
    const showCollapse = options.showCollapse !== false;
    if (showCollapse) {
      this.collapseBtn = document.createElement("button");
      this.collapseBtn.className = "panel-header-btn";
      this.collapseBtn.setAttribute("aria-label", "Collapse card");
      this.collapseBtn.appendChild(createElement(Minus, { width: 14, height: 14 }));
      this.collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onCollapse();
      });
      this.el.appendChild(this.collapseBtn);
    }

    // ---- Close button ----
    if (meta.closable) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "panel-header-btn";
      closeBtn.setAttribute("aria-label", "Close card");
      closeBtn.appendChild(createElement(X, { width: 14, height: 14 }));
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onClose();
      });
      this.el.appendChild(closeBtn);
    }

    // ---- Drag initiation ----
    if (callbacks.onDragStart) {
      const dragStart = callbacks.onDragStart;
      this.el.addEventListener("pointerdown", (e: PointerEvent) => {
        // Ignore clicks originating from buttons
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault(); // prevent browser text selection
        dragStart(e);
      });
      this.el.style.cursor = "grab";
    }
  }

  getElement(): HTMLElement {
    return this.el;
  }

  /**
   * Update the collapsed state visual. Currently a no-op placeholder;
   * the collapse icon doesn't change between collapsed/expanded states
   * in this implementation (Step 6 can add animation if desired).
   */
  setCollapsed(_collapsed: boolean): void {
    // Intentionally minimal — collapse state is managed by PanelManager
  }

  destroy(): void {
    if (this.activeMenu) {
      this.activeMenu.destroy();
      this.activeMenu = null;
    }
    this.el.remove();
  }
}
