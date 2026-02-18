/**
 * TugMenu — fixed-position logo button in the top-right corner of the canvas.
 *
 * Opens a DropdownMenu with actions for adding card instances, resetting
 * the layout, saving/loading presets, and showing version info.
 *
 * The dropdown is recreated on each button click so Load Layout submenu
 * always shows current preset names without needing dynamic menu updates.
 */

import type { PanelManager } from "./panel-manager";
import { DropdownMenu } from "./card-menu";
import type { CardMenuItem } from "./cards/card";

/** Tug logo SVG (24x24 rounded square with "T" text) */
const TUG_LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5"/>
  <text x="12" y="16.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="700" fill="currentColor">T</text>
</svg>`;

export class TugMenu {
  private panelManager: PanelManager;
  private buttonEl: HTMLElement;
  private currentMenu: DropdownMenu | null = null;

  constructor(panelManager: PanelManager) {
    this.panelManager = panelManager;

    this.buttonEl = document.createElement("div");
    this.buttonEl.className = "tug-menu-button";
    this.buttonEl.setAttribute("role", "button");
    this.buttonEl.setAttribute("aria-label", "Tug menu");
    this.buttonEl.setAttribute("tabindex", "0");
    this.buttonEl.innerHTML = TUG_LOGO_SVG;

    this.buttonEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.buttonEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggleMenu();
      }
    });

    // Append button to the panel manager's canvas container
    const container = panelManager.getContainer();
    container.appendChild(this.buttonEl);
  }

  getElement(): HTMLElement {
    return this.buttonEl;
  }

  destroy(): void {
    if (this.currentMenu) {
      this.currentMenu.destroy();
      this.currentMenu = null;
    }
    this.buttonEl.remove();
  }

  // ---- Private ----

  private toggleMenu(): void {
    if (this.currentMenu && this.currentMenu.isOpen()) {
      this.currentMenu.destroy();
      this.currentMenu = null;
      return;
    }

    if (this.currentMenu) {
      this.currentMenu.destroy();
      this.currentMenu = null;
    }

    const items = this.buildMenuItems();
    this.currentMenu = new DropdownMenu(items, this.buttonEl);
    this.currentMenu.open();
  }

  private buildMenuItems(): CardMenuItem[] {
    const pm = this.panelManager;
    const items: CardMenuItem[] = [
      {
        type: "action",
        label: "Add Conversation",
        action: () => pm.addNewCard("conversation"),
      },
      {
        type: "action",
        label: "Add Terminal",
        action: () => pm.addNewCard("terminal"),
      },
      {
        type: "action",
        label: "Add Git",
        action: () => pm.addNewCard("git"),
      },
      {
        type: "action",
        label: "Add Files",
        action: () => pm.addNewCard("files"),
      },
      {
        type: "action",
        label: "Add Stats",
        action: () => pm.addNewCard("stats"),
      },
      {
        type: "action",
        label: "Reset Layout",
        action: () => pm.resetLayout(),
      },
      {
        type: "action",
        label: "Save Layout...",
        action: () => {
          const name = window.prompt("Preset name:");
          if (name && name.trim()) {
            pm.savePreset(name.trim());
          }
        },
      },
    ];

    // Load Layout submenu: one action per saved preset
    const presetNames = pm.getPresetNames();
    if (presetNames.length > 0) {
      for (const name of presetNames) {
        items.push({
          type: "action",
          label: `Load: ${name}`,
          action: () => pm.loadPreset(name),
        });
      }
    } else {
      items.push({
        type: "action",
        label: "No saved presets",
        action: () => {
          // no-op for disabled state
        },
      });
    }

    items.push({
      type: "action",
      label: "About tugdeck",
      action: () => {
        window.alert("tugdeck v1.0\nDockable panel system for tugtool.");
      },
    });

    return items;
  }
}
