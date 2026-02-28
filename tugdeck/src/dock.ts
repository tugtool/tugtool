/**
 * Dock — 48px vertical rail on right viewport edge with theme switching.
 *
 * Replaces TugMenu with icon buttons for card creation, settings dropdown
 * with theme selection, and runtime theme change dispatch via MutationObserver.
 *
 * Icons: lucide-react components rendered via small per-button React roots.
 * Settings menu: CardDropdownMenuBridge via a temporary React root.
 * Both patterns are removed in Step 5 when Dock becomes a React component.
 *
 * [D07] lucide-react replaces vanilla lucide for chrome icons
 */

import type { DeckManager } from "./deck-manager";
import type { CardMenuItem } from "./cards/card";
import {
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
  Code,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { dispatchAction } from "./action-dispatch";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";
import { CardDropdownMenuBridge } from "./components/chrome/card-dropdown-menu";

/** Tug logo SVG (24x24 rounded square with "T" text) */
const TUG_LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5"/>
  <text x="12" y="16.5" text-anchor="middle" font-family="IBM Plex Sans, Inter, Segoe UI, system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="currentColor">T</text>
</svg>`;

/** Render a lucide-react icon into a container div synchronously. */
function renderIcon(container: HTMLElement, Icon: LucideIcon): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Icon, { width: 20, height: 20 }));
  });
  return root;
}

export class Dock {
  private deckManager: DeckManager;
  private dockEl: HTMLElement;
  // Tracked React root for the settings menu bridge (guarded against orphan roots)
  private menuRoot: Root | null = null;
  private menuContainer: HTMLElement | null = null;
  // React roots for icon buttons — unmounted in destroy()
  private iconRoots: Root[] = [];
  private observer: MutationObserver | null = null;
  private settingsBtnEl: HTMLElement | null = null;
  private btnEls: Map<string, HTMLElement> = new Map();
  private badgeEls: Map<string, HTMLElement> = new Map();
  private badgeEventHandler: ((e: Event) => void) | null = null;

  constructor(deckManager: DeckManager) {
    this.deckManager = deckManager;

    // Read theme from localStorage and apply on construction
    const savedTheme = localStorage.getItem("td-theme") || "brio";
    this.applyThemeClass(savedTheme);

    // Create dock element
    this.dockEl = document.createElement("div");
    this.dockEl.className = "dock";

    // Create card-type icon buttons using lucide-react icons
    this.addIconButton(MessageSquare, "code");
    this.addIconButton(Terminal, "terminal");
    this.addIconButton(GitBranch, "git");
    this.addIconButton(FolderOpen, "files");
    this.addIconButton(Activity, "stats");
    this.addIconButton(Code, "developer");

    // Spacer
    const spacer = document.createElement("div");
    spacer.className = "dock-spacer";
    this.dockEl.appendChild(spacer);

    // Settings gear button — icon rendered via lucide-react
    this.settingsBtnEl = document.createElement("div");
    this.settingsBtnEl.className = "dock-icon-btn";
    this.settingsBtnEl.setAttribute("role", "button");
    this.settingsBtnEl.setAttribute("aria-label", "Settings");
    const settingsIconContainer = document.createElement("span");
    this.settingsBtnEl.appendChild(settingsIconContainer);
    this.iconRoots.push(renderIcon(settingsIconContainer, Settings));
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

    // Listen for badge update events (from action-dispatch)
    this.badgeEventHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { componentId, count } = customEvent.detail as { componentId?: string; count?: number };
      if (componentId && typeof count === "number") {
        this.setBadge(componentId, count);
      }
    };
    document.addEventListener("td-dev-badge", this.badgeEventHandler);
  }

  destroy(): void {
    this.closeSettingsMenu();
    // Unmount all icon React roots
    for (const root of this.iconRoots) {
      root.unmount();
    }
    this.iconRoots = [];
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.badgeEventHandler) {
      document.removeEventListener("td-dev-badge", this.badgeEventHandler);
      this.badgeEventHandler = null;
    }
    // Clean up badges
    for (const badge of this.badgeEls.values()) {
      badge.remove();
    }
    this.badgeEls.clear();
    this.btnEls.clear();
    this.dockEl.remove();
  }

  /**
   * Set badge count for a dock button. Shows badge when count > 0, hides when count === 0.
   */
  setBadge(componentId: string, count: number): void {
    const btn = this.btnEls.get(componentId);
    if (!btn) return;

    let badge = this.badgeEls.get(componentId);

    if (count > 0) {
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "dock-badge";
        badge.textContent = String(count);
        btn.appendChild(badge);
        this.badgeEls.set(componentId, badge);
      } else {
        badge.textContent = String(count);
      }
    } else {
      if (badge) {
        badge.remove();
        this.badgeEls.delete(componentId);
      }
    }
  }

  // ---- Private ----

  /**
   * Add a card-type icon button to the dock.
   * The icon is rendered via a lucide-react component in a small React root.
   * This transitional pattern is removed in Step 5 when Dock becomes React.
   */
  private addIconButton(Icon: LucideIcon, cardType: string): void {
    const btn = document.createElement("div");
    btn.className = "dock-icon-btn";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", `Add ${cardType}`);

    // Render icon via lucide-react into a container span
    const iconContainer = document.createElement("span");
    btn.appendChild(iconContainer);
    this.iconRoots.push(renderIcon(iconContainer, Icon));

    btn.addEventListener("click", () => {
      dispatchAction({ action: "show-card", component: cardType });
    });
    this.dockEl.appendChild(btn);
    this.btnEls.set(cardType, btn);
  }

  /**
   * Toggle the settings menu open/closed.
   * Uses CardDropdownMenuBridge (React) via a temporary React root bridge.
   * Guards against orphan roots by unmounting any existing root first.
   * This transitional pattern is removed in Step 5 when Dock becomes React.
   */
  private toggleSettingsMenu(): void {
    // If menu is already open, close it
    if (this.menuRoot) {
      this.closeSettingsMenu();
      return;
    }

    // Create container div as sibling of the settings button
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.width = "0";
    container.style.height = "0";
    container.style.overflow = "visible";
    if (this.settingsBtnEl && this.settingsBtnEl.parentNode) {
      this.settingsBtnEl.parentNode.insertBefore(container, this.settingsBtnEl.nextSibling);
    } else {
      this.dockEl.appendChild(container);
    }
    this.menuContainer = container;

    const root = createRoot(container);
    this.menuRoot = root;

    const handleClose = () => {
      this.closeSettingsMenu();
    };

    root.render(
      React.createElement(CardDropdownMenuBridge, {
        items: this.buildSettingsMenuItems(),
        onClose: handleClose,
        align: "end",
        side: "left",
      })
    );
  }

  private closeSettingsMenu(): void {
    if (this.menuRoot) {
      this.menuRoot.unmount();
      this.menuRoot = null;
    }
    if (this.menuContainer) {
      this.menuContainer.remove();
      this.menuContainer = null;
    }
  }

  private buildSettingsMenuItems(): CardMenuItem[] {
    const pm = this.deckManager;
    const currentTheme = this.getCurrentTheme();

    const items: CardMenuItem[] = [
      {
        type: "action",
        label: "Add Code",
        action: () => pm.addNewCard("code"),
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
        label: "Restart Server",
        action: () => pm.sendControlFrame("restart"),
      },
      {
        type: "action",
        label: "Reset Everything",
        action: () => {
          // Clear localStorage before sending reset, since the server
          // will exit and the WebSocket will close
          localStorage.clear();
          pm.sendControlFrame("reset");
        },
      },
      {
        type: "action",
        label: "Reload Frontend",
        action: () => pm.sendControlFrame("reload_frontend"),
      },
      {
        type: "separator",
      },
      {
        type: "action",
        label: "About tugdeck",
        action: () => dispatchAction({ action: "show-card", component: "about" }),
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
