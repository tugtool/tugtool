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
  private sourceTreePathEl: HTMLElement | null = null;
  private devModeConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private initialDevMode: boolean = false;
  private initialSourceTree: string | null = null;
  private currentSourceTree: string | null = null;
  private devNoteEl: HTMLElement | null = null;
  private restartPromptEl: HTMLElement | null = null;
  private restartBtn: HTMLElement | null = null;
  private restartFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
  private closeUnsubscribe: (() => void) | null = null;

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

    // SECTION 2: Developer Mode
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

    this.devModeCheckbox.addEventListener("change", () => {
      this.handleDevModeToggle();
    });

    const devSpan = document.createElement("span");
    devSpan.textContent = "Enable developer mode";

    devToggle.appendChild(this.devModeCheckbox);
    devToggle.appendChild(devSpan);
    devSection.appendChild(devToggle);

    this.devNoteEl = document.createElement("div");
    this.devNoteEl.className = "settings-dev-note";
    this.devNoteEl.style.display = "none";
    devSection.appendChild(this.devNoteEl);

    this.restartPromptEl = document.createElement("div");
    this.restartPromptEl.className = "settings-restart-prompt";
    this.restartPromptEl.style.display = "none";
    const restartText = document.createElement("span");
    restartText.textContent = "Settings changed. Restart to apply.";
    this.restartBtn = document.createElement("button");
    this.restartBtn.className = "settings-choose-btn";
    this.restartBtn.textContent = "Restart Now";
    this.restartBtn.addEventListener("click", () => {
      if (this.restartBtn) {
        this.restartBtn.textContent = "Restarting...";
        (this.restartBtn as HTMLButtonElement).disabled = true;
      }
      fetch("/api/tell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      }).catch((err) => console.error("restart fetch failed:", err));
      // Fail-safe: re-enable if WebSocket doesn't disconnect within 5s
      this.restartFailsafeTimer = setTimeout(() => {
        if (this.restartBtn) {
          this.restartBtn.textContent = "Restart Now";
          (this.restartBtn as HTMLButtonElement).disabled = false;
        }
        this.showDevNote("Restart failed. Try again or restart the app.");
      }, 5000);
    });
    this.restartPromptEl.appendChild(restartText);
    this.restartPromptEl.appendChild(this.restartBtn);
    devSection.appendChild(this.restartPromptEl);

    content.appendChild(devSection);

    // SECTION 3: Source Tree
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

  private hideDevNote(): void {
    if (this.devNoteEl) {
      this.devNoteEl.style.display = "none";
    }
  }

  private updateRestartPrompt(): void {
    if (!this.restartPromptEl) return;
    const devModeChanged = (this.devModeCheckbox?.checked ?? false) !== this.initialDevMode;
    const sourceTreeChanged = this.currentSourceTree !== this.initialSourceTree;
    // Source tree only matters when dev mode is enabled (source tree controls dev-mode serving)
    const needsRestart = devModeChanged || (sourceTreeChanged && (this.devModeCheckbox?.checked ?? false));
    this.restartPromptEl.style.display = needsRestart ? "flex" : "none";
  }

  private initBridge(): void {
    const webkit = (window as any).webkit;

    if (webkit?.messageHandlers?.getSettings) {
      // Bridge is available - register callbacks and request settings
      const bridge = ((window as any).__tugBridge = (window as any).__tugBridge || {});

      bridge.onSettingsLoaded = (data: { devMode: boolean; runtimeDevMode: boolean; sourceTree: string | null }) => {
        if (!this.container) return;
        if (this.devModeCheckbox) {
          this.devModeCheckbox.checked = data.devMode;
        }
        this.initialDevMode = data.runtimeDevMode;
        this.initialSourceTree = data.sourceTree;
        this.currentSourceTree = data.sourceTree;
        if (this.sourceTreePathEl) {
          this.sourceTreePathEl.textContent = data.sourceTree || "(not set)";
        }
        this.updateRestartPrompt();
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
        this.updateRestartPrompt();
      };

      bridge.onSourceTreeSelected = (path: string) => {
        if (!this.container) return;
        if (this.sourceTreePathEl) {
          this.sourceTreePathEl.textContent = path;
        }
        this.currentSourceTree = path;
        this.updateRestartPrompt();
      };

      bridge.onSourceTreeCancelled = () => {
        // No-op
      };

      // Request current settings
      webkit.messageHandlers.getSettings.postMessage({});

      // Clear restart fail-safe timer on WebSocket disconnect (restart success signal)
      this.closeUnsubscribe = this.connection.onClose(() => {
        if (this.restartFailsafeTimer) {
          clearTimeout(this.restartFailsafeTimer);
          this.restartFailsafeTimer = null;
        }
      });
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

    this.closeUnsubscribe?.();
    this.closeUnsubscribe = null;
    if (this.restartFailsafeTimer) {
      clearTimeout(this.restartFailsafeTimer);
      this.restartFailsafeTimer = null;
    }

    // Clear bridge callbacks
    const bridge = (window as any).__tugBridge;
    if (bridge) {
      bridge.onSettingsLoaded = undefined;
      bridge.onDevModeChanged = undefined;
      bridge.onSourceTreeSelected = undefined;
      bridge.onSourceTreeCancelled = undefined;
    }

    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }

    this.devModeCheckbox = null;
    this.sourceTreePathEl = null;
    this.devNoteEl = null;
    this.restartPromptEl = null;
    this.restartBtn = null;
    this.initialSourceTree = null;
    this.currentSourceTree = null;
    this.themeRadios = [];
  }
}
