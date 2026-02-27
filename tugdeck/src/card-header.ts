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
  Info,
  Settings,
  Code,
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
  Info,
  Settings,
  Code,
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
  // Instance fields for targeted DOM mutation in updateMeta()
  private titleEl: HTMLElement;
  private iconEl: HTMLElement;
  private menuBtn: HTMLElement | null = null;

  constructor(
    meta: TugCardMeta,
    callbacks: CardHeaderCallbacks,
    options: { showCollapse?: boolean } = {}
  ) {
    this.meta = meta;

    // Root element
    this.el = document.createElement("div");
    this.el.className = "card-header";

    // ---- Icon ----
    this.iconEl = document.createElement("div");
    this.iconEl.className = "card-header-icon";
    const iconDef = ICON_MAP[meta.icon] ?? Box;
    this.iconEl.appendChild(createElement(iconDef, { width: 14, height: 14 }));
    this.el.appendChild(this.iconEl);

    // ---- Title ----
    this.titleEl = document.createElement("div");
    this.titleEl.className = "card-header-title";
    this.titleEl.textContent = meta.title;
    this.el.appendChild(this.titleEl);

    // ---- Spacer ----
    const spacer = document.createElement("div");
    spacer.className = "card-header-spacer";
    this.el.appendChild(spacer);

    // ---- Menu button (hidden if no menuItems) ----
    if (meta.menuItems.length > 0) {
      this.menuBtn = document.createElement("button");
      this.menuBtn.className = "card-header-btn";
      this.menuBtn.setAttribute("aria-label", "Card menu");
      this.menuBtn.appendChild(createElement(EllipsisVertical, { width: 14, height: 14 }));
      this.menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeMenu && this.activeMenu.isOpen()) {
          this.activeMenu.close();
          this.activeMenu = null;
        } else {
          // Read from this.meta so updated menu items (from updateMeta) are used
          const menu = new DropdownMenu(this.meta.menuItems, this.menuBtn!);
          this.activeMenu = menu;
          menu.open();
        }
      });
      this.el.appendChild(this.menuBtn);
    }

    // ---- Collapse button (docked only) ----
    const showCollapse = options.showCollapse !== false;
    if (showCollapse) {
      this.collapseBtn = document.createElement("button");
      this.collapseBtn.className = "card-header-btn";
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
      closeBtn.className = "card-header-btn";
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
    // Intentionally minimal — collapse state is managed by DeckManager
  }

  /**
   * Live-update the header's title, icon, and/or menu items.
   *
   * Called by CardFrame.updateMeta() which is triggered by ReactCardAdapter
   * when the active React card dispatches a "card-meta-update" event.
   * Performs targeted DOM mutations rather than full header reconstruction.
   */
  updateMeta(meta: TugCardMeta): void {
    // Close and destroy any open dropdown before mutating DOM
    if (this.activeMenu) {
      this.activeMenu.destroy();
      this.activeMenu = null;
    }

    // Update title if changed
    if (meta.title !== this.meta.title) {
      this.titleEl.textContent = meta.title;
    }

    // Swap icon SVG if changed
    if (meta.icon !== this.meta.icon) {
      const iconDef = ICON_MAP[meta.icon] ?? Box;
      this.iconEl.innerHTML = "";
      this.iconEl.appendChild(createElement(iconDef, { width: 14, height: 14 }));
    }

    // Rebuild menu button based on menuItems count change
    const hadMenu = this.meta.menuItems.length > 0;
    const hasMenu = meta.menuItems.length > 0;

    if (!hadMenu && hasMenu) {
      // Create new menu button and insert before collapse button (or at end)
      this.menuBtn = document.createElement("button");
      this.menuBtn.className = "card-header-btn";
      this.menuBtn.setAttribute("aria-label", "Card menu");
      this.menuBtn.appendChild(createElement(EllipsisVertical, { width: 14, height: 14 }));
      this.menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeMenu && this.activeMenu.isOpen()) {
          this.activeMenu.close();
          this.activeMenu = null;
        } else {
          const menu = new DropdownMenu(this.meta.menuItems, this.menuBtn!);
          this.activeMenu = menu;
          menu.open();
        }
      });
      if (this.collapseBtn) {
        this.el.insertBefore(this.menuBtn, this.collapseBtn);
      } else {
        // No collapse button: insert before the first button after the spacer
        // (close button), or at end if nothing follows
        const spacer = this.el.querySelector(".card-header-spacer");
        const nextSibling = spacer ? spacer.nextSibling : null;
        if (nextSibling) {
          this.el.insertBefore(this.menuBtn, nextSibling);
        } else {
          this.el.appendChild(this.menuBtn);
        }
      }
    } else if (hadMenu && !hasMenu) {
      // Remove menu button
      this.menuBtn?.remove();
      this.menuBtn = null;
    }
    // If still >0 items, no DOM change needed — click handler reads this.meta.menuItems
    // which will be updated below when we store the new meta

    // Store the new meta — must happen after all DOM updates that reference old meta
    this.meta = meta;
  }

  destroy(): void {
    if (this.activeMenu) {
      this.activeMenu.destroy();
      this.activeMenu = null;
    }
    this.el.remove();
  }
}
