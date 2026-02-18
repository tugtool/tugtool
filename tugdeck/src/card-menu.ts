/**
 * DropdownMenu — generic positioned dropdown for card header menus.
 *
 * The menu element is appended to document.body for correct stacking above
 * all panels. Position is computed from the anchor element's bounding rect,
 * clamped to viewport edges.
 *
 * Dismiss: click-outside on document or Escape key.
 */

import type { CardMenuItem, CardMenuSelect } from "./cards/card";

export class DropdownMenu {
  private el: HTMLElement;
  private items: CardMenuItem[];
  private _isOpen = false;

  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(items: CardMenuItem[], anchorEl: HTMLElement) {
    this.items = items;
    this.el = document.createElement("div");
    this.el.className = "card-dropdown-menu";
    this.el.style.display = "none";

    this.buildItems();
    this.positionBelow(anchorEl);
  }

  isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    if (this._isOpen) return;
    this._isOpen = true;
    this.el.style.display = "block";
    document.body.appendChild(this.el);

    // Dismiss on click outside
    this.clickOutsideHandler = (e: MouseEvent) => {
      if (!this.el.contains(e.target as Node)) {
        this.close();
      }
    };
    // Use setTimeout so this pointerdown doesn't immediately close
    window.setTimeout(() => {
      document.addEventListener("mousedown", this.clickOutsideHandler!);
    }, 0);

    // Dismiss on Escape
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.close();
      }
    };
    document.addEventListener("keydown", this.escapeHandler);
  }

  close(): void {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.el.style.display = "none";
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }

    if (this.clickOutsideHandler) {
      document.removeEventListener("mousedown", this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    if (this.escapeHandler) {
      document.removeEventListener("keydown", this.escapeHandler);
      this.escapeHandler = null;
    }
  }

  destroy(): void {
    this.close();
    this.el.remove();
  }

  // ---- Private ----

  private positionBelow(anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    const menuW = 160; // min-width from CSS

    let left = rect.left;
    let top = rect.bottom + 2;

    // Clamp to viewport
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    if (left + menuW > vpW) {
      left = vpW - menuW - 4;
    }
    if (left < 4) left = 4;
    // If near bottom, open upward
    if (top + 200 > vpH) {
      top = rect.top - 202;
    }
    if (top < 4) top = 4;

    this.el.style.position = "fixed";
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private buildItems(): void {
    for (const item of this.items) {
      if (item.type === "action") {
        const el = document.createElement("div");
        el.className = "card-dropdown-item";
        el.textContent = item.label;
        el.addEventListener("click", () => {
          item.action();
          this.close();
        });
        this.el.appendChild(el);
      } else if (item.type === "toggle") {
        const el = document.createElement("div");
        el.className = "card-dropdown-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.checked;
        checkbox.style.margin = "0";

        const label = document.createElement("span");
        label.textContent = item.label;

        el.appendChild(checkbox);
        el.appendChild(label);
        el.addEventListener("click", () => {
          item.checked = !item.checked;
          checkbox.checked = item.checked;
          item.action(item.checked);
        });
        this.el.appendChild(el);
      } else if (item.type === "select") {
        this.buildSelectItem(item);
      }
    }
  }

  private buildSelectItem(item: CardMenuSelect): void {
    const group = document.createElement("div");
    group.className = "card-dropdown-select-group";

    const labelEl = document.createElement("div");
    labelEl.className = "card-dropdown-item";
    labelEl.style.fontWeight = "600";
    labelEl.style.cursor = "default";
    labelEl.textContent = item.label;
    group.appendChild(labelEl);

    for (const option of item.options) {
      const optEl = document.createElement("div");
      optEl.className = "card-dropdown-select-option";
      if (option === item.value) {
        optEl.classList.add("selected");
      }
      optEl.textContent = option;
      optEl.addEventListener("click", () => {
        // Update selected styling
        for (const child of group.querySelectorAll(".card-dropdown-select-option")) {
          child.classList.remove("selected");
        }
        optEl.classList.add("selected");
        item.value = option;
        item.action(option);
        this.close();
      });
      group.appendChild(optEl);
    }

    this.el.appendChild(group);
  }
}
