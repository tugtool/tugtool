/**
 * Settings Card - theme, dev mode, source tree configuration
 */

import type { TugCard, TugCardMeta } from "./card";
import type { FeedIdValue } from "../protocol";
import type { TugConnection } from "../connection";

const THEMES = [
  { key: "brio", label: "Brio" },
  { key: "bluenote", label: "Bluenote" },
  { key: "harmony", label: "Harmony" },
];

export class SettingsCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [];

  private container: HTMLElement | null = null;
  private connection: TugConnection;
  private themeRadios: HTMLInputElement[] = [];
  private devModeCheckbox: HTMLInputElement | null = null;
  private devModeLabel: HTMLSpanElement | null = null;
  private sourceTreePathEl: HTMLElement | null = null;
  private devModeConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private devNoteEl: HTMLElement | null = null;

  constructor(connection: TugConnection) {
    this.connection = connection;
  }

  get meta(): TugCardMeta {
    return {
      title: "Settings",
      icon: "Settings",
      closable: true,
      menuItems: [],
    };
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.classList.add("settings-card");

    const content = document.createElement("div");
    content.className = "settings-content";

    // SECTION 1: Theme selector
    const themeSection = document.createElement("div");
    themeSection.className = "settings-section";

    const themeTitle = document.createElement("h3");
    themeTitle.className = "settings-section-title";
    themeTitle.textContent = "Theme";
    themeSection.appendChild(themeTitle);

    const themeGroup = document.createElement("div");
    themeGroup.className = "settings-theme-group";

    const currentTheme = localStorage.getItem("td-theme") || "brio";

    for (const theme of THEMES) {
      const label = document.createElement("label");
      label.className = "settings-theme-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "theme";
      radio.value = theme.key;
      radio.checked = currentTheme === theme.key;
      this.themeRadios.push(radio);

      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.applyTheme(theme.key);
        }
      });

      const span = document.createElement("span");
      span.textContent = theme.label;

      label.appendChild(radio);
      label.appendChild(span);
      themeGroup.appendChild(label);
    }

    themeSection.appendChild(themeGroup);
    content.appendChild(themeSection);

    // SECTION 2: Source Tree
    const sourceSection = document.createElement("div");
    sourceSection.className = "settings-section";

    const sourceTitle = document.createElement("h3");
    sourceTitle.className = "settings-section-title";
    sourceTitle.textContent = "Source Tree";
    sourceSection.appendChild(sourceTitle);

    const sourceRow = document.createElement("div");
    sourceRow.className = "settings-source-row";

    this.sourceTreePathEl = document.createElement("span");
    this.sourceTreePathEl.className = "settings-source-path";
    this.sourceTreePathEl.textContent = "(not set)";

    const chooseBtn = document.createElement("button");
    chooseBtn.className = "settings-choose-btn";
    chooseBtn.textContent = "Choose...";
    chooseBtn.addEventListener("click", () => {
      this.connection.sendControlFrame("choose-source-tree");
    });

    sourceRow.appendChild(this.sourceTreePathEl);
    sourceRow.appendChild(chooseBtn);
    sourceSection.appendChild(sourceRow);
    content.appendChild(sourceSection);

    // SECTION 3: Developer Mode
    const devSection = document.createElement("div");
    devSection.className = "settings-section";

    const devTitle = document.createElement("h3");
    devTitle.className = "settings-section-title";
    devTitle.textContent = "Developer Mode";
    devSection.appendChild(devTitle);

    const devToggle = document.createElement("label");
    devToggle.className = "settings-toggle";

    this.devModeCheckbox = document.createElement("input");
    this.devModeCheckbox.type = "checkbox";
    this.devModeCheckbox.disabled = true;

    this.devModeCheckbox.addEventListener("change", () => {
      this.handleDevModeToggle();
    });

    this.devModeLabel = document.createElement("span");
    this.devModeLabel.textContent = "Tug source tree required for developer mode";

    devToggle.appendChild(this.devModeCheckbox);
    devToggle.appendChild(this.devModeLabel);
    devSection.appendChild(devToggle);

    this.devNoteEl = document.createElement("div");
    this.devNoteEl.className = "settings-dev-note";
    this.devNoteEl.style.display = "none";
    devSection.appendChild(this.devNoteEl);

    content.appendChild(devSection);

    container.appendChild(content);

    // Initialize bridge callbacks and load settings
    this.initBridge();
  }

  private applyTheme(themeKey: string): void {
    localStorage.setItem("td-theme", themeKey);

    // Remove all theme classes
    document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");

    // Add new theme class (brio is default, no class needed)
    if (themeKey === "bluenote") {
      document.body.classList.add("td-theme-bluenote");
    } else if (themeKey === "harmony") {
      document.body.classList.add("td-theme-harmony");
    }

    // Dispatch theme change event
    document.dispatchEvent(new CustomEvent("td-theme-change"));
  }

  private handleDevModeToggle(): void {
    if (!this.devModeCheckbox) return;
    const newState = this.devModeCheckbox.checked;
    // Confirmed UI: disable checkbox during bridge round-trip
    this.devModeCheckbox.disabled = true;
    // Capture pre-toggle state for revert on timeout
    const preToggleState = !newState;
    // Confirmation timeout: revert if bridge doesn't respond
    this.devModeConfirmTimer = setTimeout(() => {
      if (!this.container || !this.devModeCheckbox) return;
      this.devModeCheckbox.checked = preToggleState;
      this.devModeCheckbox.disabled = false;
      this.showDevNote("dev mode toggle requires the Tug app");
    }, 3000);
    // Send control frame (do NOT write to localStorage)
    this.connection.sendControlFrame("set-dev-mode", { enabled: newState });
  }

  private showDevNote(message: string): void {
    if (this.devNoteEl) {
      this.devNoteEl.textContent = message;
      this.devNoteEl.style.display = "block";
    }
  }

  private updateDevModeAvailability(hasSourceTree: boolean): void {
    if (this.devModeCheckbox) {
      this.devModeCheckbox.disabled = !hasSourceTree;
      if (!hasSourceTree) {
        this.devModeCheckbox.checked = false;
      }
    }
    if (this.devModeLabel) {
      this.devModeLabel.textContent = hasSourceTree
        ? "Enable developer mode"
        : "Tug source tree required for developer mode";
    }
  }

  private hideDevNote(): void {
    if (this.devNoteEl) {
      this.devNoteEl.style.display = "none";
    }
  }

  private initBridge(): void {
    const webkit = (window as any).webkit;

    if (webkit?.messageHandlers?.getSettings) {
      // Bridge is available - register callbacks and request settings
      const bridge = ((window as any).__tugBridge = (window as any).__tugBridge || {});

      bridge.onSettingsLoaded = (data: { devMode: boolean; sourceTree: string | null }) => {
        if (!this.container) return;
        if (this.sourceTreePathEl) {
          this.sourceTreePathEl.textContent = data.sourceTree || "(not set)";
        }
        this.updateDevModeAvailability(!!data.sourceTree);
        if (this.devModeCheckbox && data.sourceTree) {
          this.devModeCheckbox.checked = data.devMode;
        }
      };

      bridge.onDevModeChanged = (confirmed: boolean) => {
        if (!this.container) return;
        if (this.devModeConfirmTimer) {
          clearTimeout(this.devModeConfirmTimer);
          this.devModeConfirmTimer = null;
        }
        if (this.devModeCheckbox) {
          this.devModeCheckbox.checked = confirmed;
          this.devModeCheckbox.disabled = false;
        }
        this.hideDevNote();
      };

      bridge.onDevModeError = (message: string) => {
        if (!this.container) return;
        if (this.devModeCheckbox) {
          this.devModeCheckbox.checked = false;
          this.devModeCheckbox.disabled = false;
        }
        this.showDevNote(message);
      };

      bridge.onSourceTreeSelected = (path: string) => {
        if (!this.container) return;
        if (this.sourceTreePathEl) {
          this.sourceTreePathEl.textContent = path;
        }
        this.updateDevModeAvailability(!!path);
      };

      bridge.onSourceTreeCancelled = () => {
        // No-op
      };

      // Request current settings
      webkit.messageHandlers.getSettings.postMessage({});
    } else {
      // Bridge unavailable
      this.showDevNote("Developer features require the Tug app");
      if (this.sourceTreePathEl) {
        this.sourceTreePathEl.textContent = "(source tree picker requires the Tug app)";
      }
    }
  }

  onFrame(_feedId: number, _payload: Uint8Array): void {
    // No-op: Settings card doesn't subscribe to any feeds
  }

  onResize(_w: number, _h: number): void {
    // No-op: form layout handles itself
  }

  destroy(): void {
    if (this.devModeConfirmTimer) {
      clearTimeout(this.devModeConfirmTimer);
      this.devModeConfirmTimer = null;
    }

    // Clear bridge callbacks
    const bridge = (window as any).__tugBridge;
    if (bridge) {
      bridge.onSettingsLoaded = undefined;
      bridge.onDevModeChanged = undefined;
      bridge.onDevModeError = undefined;
      bridge.onSourceTreeSelected = undefined;
      bridge.onSourceTreeCancelled = undefined;
    }

    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }

    this.devModeCheckbox = null;
    this.devModeLabel = null;
    this.sourceTreePathEl = null;
    this.devNoteEl = null;
    this.themeRadios = [];
  }
}
