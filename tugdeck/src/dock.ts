/**
 * Dock — 48px vertical rail on right viewport edge with theme switching.
 *
 * Replaces TugMenu with icon buttons for card creation, settings dropdown
 * with theme selection, and runtime theme change dispatch via MutationObserver.
 */

import type { DeckManager } from "./deck-manager";
import { DropdownMenu } from "./card-menu";
import type { CardMenuItem } from "./cards/card";
import { createElement, MessageSquare, Terminal, GitBranch, FolderOpen, Activity, Settings } from "lucide";

/** Tug logo SVG (24x24 rounded square with "T" text) */
const TUG_LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5"/>
  <text x="12" y="16.5" text-anchor="middle" font-family="IBM Plex Sans, Inter, Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="currentColor">T</text>
</svg>`;

export class Dock {
  private panelManager: DeckManager;
  private dockEl: HTMLElement;
  private currentMenu: DropdownMenu | null = null;
  private observer: MutationObserver | null = null;
  private settingsBtnEl: HTMLElement | null = null;

  constructor(panelManager: DeckManager) {
    this.panelManager = panelManager;

    // Read theme from localStorage and apply on construction
    const savedTheme = localStorage.getItem("td-theme") || "brio";
    this.applyThemeClass(savedTheme);

    // Create dock element
    this.dockEl = document.createElement("div");
    this.dockEl.className = "dock";

    // Create card-type icon buttons
    this.addIconButton(MessageSquare, "conversation");
    this.addIconButton(Terminal, "terminal");
    this.addIconButton(GitBranch, "git");
    this.addIconButton(FolderOpen, "files");
    this.addIconButton(Activity, "stats");

    // Spacer
    const spacer = document.createElement("div");
    spacer.className = "dock-spacer";
    this.dockEl.appendChild(spacer);

    // Settings gear button
    this.settingsBtnEl = document.createElement("div");
    this.settingsBtnEl.className = "dock-icon-btn";
    this.settingsBtnEl.setAttribute("role", "button");
    this.settingsBtnEl.setAttribute("aria-label", "Settings");
    const settingsIcon = createElement(Settings);
    this.settingsBtnEl.appendChild(settingsIcon);
    this.settingsBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSettingsMenu();
    });
    this.dockEl.appendChild(this.settingsBtnEl);

    // Tug logo at bottom
    const logoEl = document.createElement("div");
    logoEl.className = "dock-logo";
    logoEl.setAttribute("aria-label", "tugdeck");
    logoEl.innerHTML = TUG_LOGO_SVG;
    this.dockEl.appendChild(logoEl);

    // Append dock to document.body (not canvas container)
    document.body.appendChild(this.dockEl);

    // Set up MutationObserver to dispatch theme change events
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          document.dispatchEvent(new CustomEvent("td-theme-change"));
        }
      }
    });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  destroy(): void {
    if (this.currentMenu) {
      this.currentMenu.destroy();
      this.currentMenu = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.dockEl.remove();
  }

  // ---- Private ----

  private addIconButton(iconConstructor: typeof MessageSquare, cardType: string): void {
    const btn = document.createElement("div");
    btn.className = "dock-icon-btn";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", `Add ${cardType}`);
    const icon = createElement(iconConstructor);
    btn.appendChild(icon);
    btn.addEventListener("click", () => {
      this.panelManager.addNewCard(cardType);
    });
    this.dockEl.appendChild(btn);
  }

  private toggleSettingsMenu(): void {
    if (this.currentMenu && this.currentMenu.isOpen()) {
      this.currentMenu.destroy();
      this.currentMenu = null;
      return;
    }

    if (this.currentMenu) {
      this.currentMenu.destroy();
      this.currentMenu = null;
    }

    const items = this.buildSettingsMenuItems();
    this.currentMenu = new DropdownMenu(items, this.settingsBtnEl!);
    this.currentMenu.open();
  }

  private buildSettingsMenuItems(): CardMenuItem[] {
    const pm = this.panelManager;
    const currentTheme = this.getCurrentTheme();

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
        type: "separator",
      },
      {
        type: "action",
        label: "Reset Layout",
        action: () => pm.resetLayout(),
      },
      {
        type: "separator",
      },
      {
        type: "select",
        label: "Theme",
        options: ["Brio", "Bluenote", "Harmony"],
        value: currentTheme,
        action: (theme: string) => this.applyTheme(theme),
      },
      {
        type: "separator",
      },
      {
        type: "action",
        label: "About tugdeck",
        action: () => {
          window.alert("tugdeck v1.0\nCanvas card system for tugtool.");
        },
      },
    ];

    return items;
  }

  private getCurrentTheme(): string {
    const savedTheme = localStorage.getItem("td-theme") || "brio";
    // Capitalize first letter for display
    return savedTheme.charAt(0).toUpperCase() + savedTheme.slice(1);
  }

  private applyTheme(theme: string): void {
    // Convert display label to lowercase for localStorage
    const themeKey = theme.toLowerCase();
    localStorage.setItem("td-theme", themeKey);
    this.applyThemeClass(themeKey);
    // Note: MutationObserver will detect the body class change and dispatch "td-theme-change"
  }

  private applyThemeClass(theme: string): void {
    // Remove all theme classes
    document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");

    // Apply theme class (no class for Brio)
    if (theme === "bluenote") {
      document.body.classList.add("td-theme-bluenote");
    } else if (theme === "harmony") {
      document.body.classList.add("td-theme-harmony");
    }
    // Brio: no class (default)
  }
}
