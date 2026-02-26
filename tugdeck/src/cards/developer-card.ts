/**
 * Developer Card - shows dev mode change status for Styles (CSS/HTML), Code (JS/binary), App (.swift)
 */

import type { TugCard, TugCardMeta } from "./card";
import type { FeedIdValue } from "../protocol";
import type { TugConnection } from "../connection";

export class DeveloperCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [];

  private container: HTMLElement | null = null;
  private connection: TugConnection;

  // Row elements
  private stylesRow: HTMLElement | null = null;
  private codeRow: HTMLElement | null = null;
  private appRow: HTMLElement | null = null;

  // Status elements
  private stylesDot: HTMLElement | null = null;
  private stylesStatus: HTMLElement | null = null;
  private codeDot: HTMLElement | null = null;
  private codeStatus: HTMLElement | null = null;
  private codeRestartBtn: HTMLElement | null = null;
  private appDot: HTMLElement | null = null;
  private appStatus: HTMLElement | null = null;
  private appRelaunchBtn: HTMLElement | null = null;

  // Build progress elements
  private buildProgressEl: HTMLElement | null = null;

  // Timer for "Reloaded" flash
  private reloadedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(connection: TugConnection) {
    this.connection = connection;
  }

  get meta(): TugCardMeta {
    return {
      title: "Developer",
      icon: "Code",
      closable: true,
      menuItems: [],
    };
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.classList.add("developer-card");

    const content = document.createElement("div");
    content.className = "developer-content";

    // Clear any existing dock badge on mount
    document.dispatchEvent(new CustomEvent("td-dev-badge", { detail: { count: 0 } }));

    // Styles row
    this.stylesRow = this.createRow("Styles", "Clean");
    this.stylesDot = this.stylesRow.querySelector(".dev-dot") as HTMLElement;
    this.stylesStatus = this.stylesRow.querySelector(".dev-status") as HTMLElement;
    content.appendChild(this.stylesRow);

    // Code row
    this.codeRow = this.createRow("Code", "Clean");
    this.codeDot = this.codeRow.querySelector(".dev-dot") as HTMLElement;
    this.codeStatus = this.codeRow.querySelector(".dev-status") as HTMLElement;

    // Restart button
    this.codeRestartBtn = document.createElement("button");
    this.codeRestartBtn.className = "dev-action-btn";
    this.codeRestartBtn.textContent = "Restart";
    this.codeRestartBtn.style.display = "none";
    this.codeRestartBtn.addEventListener("click", () => this.handleRestart());
    const codeActions = this.codeRow.querySelector(".dev-actions") as HTMLElement;
    codeActions.appendChild(this.codeRestartBtn);

    content.appendChild(this.codeRow);

    // App row (hide if WebKit bridge not available)
    const hasWebKit = typeof (window as any).webkit !== "undefined";
    this.appRow = this.createRow("App", "Clean");
    this.appDot = this.appRow.querySelector(".dev-dot") as HTMLElement;
    this.appStatus = this.appRow.querySelector(".dev-status") as HTMLElement;

    // Relaunch button
    this.appRelaunchBtn = document.createElement("button");
    this.appRelaunchBtn.className = "dev-action-btn";
    this.appRelaunchBtn.textContent = "Relaunch";
    this.appRelaunchBtn.style.display = "none";
    this.appRelaunchBtn.addEventListener("click", () => this.handleRelaunch());
    const appActions = this.appRow.querySelector(".dev-actions") as HTMLElement;
    appActions.appendChild(this.appRelaunchBtn);

    if (!hasWebKit) {
      this.appRow.style.display = "none";
    }
    content.appendChild(this.appRow);

    // Reset button section
    const resetSection = document.createElement("div");
    resetSection.className = "developer-reset-section";

    const resetBtn = document.createElement("button");
    resetBtn.className = "dev-reset-btn";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => this.handleReset());
    resetSection.appendChild(resetBtn);

    const resetNote = document.createElement("span");
    resetNote.className = "dev-reset-note";
    resetNote.textContent = "Clear localStorage and restart";
    resetSection.appendChild(resetNote);

    content.appendChild(resetSection);

    // Build progress area
    this.buildProgressEl = document.createElement("div");
    this.buildProgressEl.className = "developer-build-progress";
    this.buildProgressEl.style.display = "none";
    content.appendChild(this.buildProgressEl);

    container.appendChild(content);
  }

  /**
   * Public method called by action-dispatch dev_notification handler
   */
  update(payload: Record<string, unknown>): void {
    const type = payload.type as string;
    const changes = payload.changes as string[] | undefined;
    const count = payload.count as number | undefined;

    if (type === "reloaded") {
      // Flash Styles status to "Reloaded" for 2 seconds
      if (this.stylesStatus) {
        this.stylesStatus.textContent = "Reloaded";
        if (this.reloadedTimer) clearTimeout(this.reloadedTimer);
        this.reloadedTimer = setTimeout(() => {
          if (this.stylesStatus) {
            this.stylesStatus.textContent = "Clean";
          }
        }, 2000);
      }
    } else if (type === "restart_available") {
      // Set Code row dirty
      if (this.codeDot) {
        this.codeDot.style.backgroundColor = "var(--td-warning)";
      }
      if (this.codeStatus) {
        const changeText = count === 1 ? "1 change" : `${count ?? 0} changes`;
        this.codeStatus.textContent = changeText;
      }
      if (this.codeRestartBtn) {
        this.codeRestartBtn.style.display = "block";
      }
    } else if (type === "relaunch_available") {
      // Set App row dirty
      if (this.appDot) {
        this.appDot.style.backgroundColor = "var(--td-warning)";
      }
      if (this.appStatus) {
        const changeText = count === 1 ? "1 change" : `${count ?? 0} changes`;
        this.appStatus.textContent = changeText;
      }
      if (this.appRelaunchBtn) {
        this.appRelaunchBtn.style.display = "block";
      }
    }
  }

  /**
   * Public method called by action-dispatch dev_build_progress handler
   */
  updateBuildProgress(payload: Record<string, unknown>): void {
    const stage = payload.stage as string | undefined;
    const status = payload.status as string | undefined;
    const error = payload.error as string | undefined;

    if (!this.buildProgressEl) return;

    if (stage && status) {
      this.buildProgressEl.style.display = "block";
      let text = `${stage}: ${status}`;
      if (error) {
        text += ` (${error})`;
      }
      this.buildProgressEl.textContent = text;
    } else {
      this.buildProgressEl.style.display = "none";
    }
  }

  onFrame(_feedId: FeedIdValue, _payload: Uint8Array): void {
    // No-op: Developer card receives data via action-dispatch, not frame fan-out
  }

  onResize(_w: number, _h: number): void {
    // No-op
  }

  destroy(): void {
    if (this.reloadedTimer) {
      clearTimeout(this.reloadedTimer);
      this.reloadedTimer = null;
    }
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.container = null;
    this.stylesRow = null;
    this.codeRow = null;
    this.appRow = null;
    this.stylesDot = null;
    this.stylesStatus = null;
    this.codeDot = null;
    this.codeStatus = null;
    this.codeRestartBtn = null;
    this.appDot = null;
    this.appStatus = null;
    this.appRelaunchBtn = null;
    this.buildProgressEl = null;
  }

  // ---- Private ----

  private createRow(label: string, statusText: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "dev-row";

    const dot = document.createElement("span");
    dot.className = "dev-dot";
    dot.style.backgroundColor = "var(--td-success)"; // Green for clean
    row.appendChild(dot);

    const labelEl = document.createElement("span");
    labelEl.className = "dev-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const status = document.createElement("span");
    status.className = "dev-status";
    status.textContent = statusText;
    row.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "dev-actions";
    row.appendChild(actions);

    return row;
  }

  private handleRestart(): void {
    // Clear Code row state
    if (this.codeDot) {
      this.codeDot.style.backgroundColor = "var(--td-success)";
    }
    if (this.codeStatus) {
      this.codeStatus.textContent = "Clean";
    }
    if (this.codeRestartBtn) {
      this.codeRestartBtn.style.display = "none";
    }

    // Clear badge
    document.dispatchEvent(new CustomEvent("td-dev-badge", { detail: { count: 0 } }));

    // Send restart control frame
    this.connection.sendControlFrame("restart");
  }

  private handleRelaunch(): void {
    // Clear App row state
    if (this.appDot) {
      this.appDot.style.backgroundColor = "var(--td-success)";
    }
    if (this.appStatus) {
      this.appStatus.textContent = "Clean";
    }
    if (this.appRelaunchBtn) {
      this.appRelaunchBtn.style.display = "none";
    }

    // Clear badge
    document.dispatchEvent(new CustomEvent("td-dev-badge", { detail: { count: 0 } }));

    // Send relaunch control frame
    this.connection.sendControlFrame("relaunch");
  }

  private handleReset(): void {
    // Clear localStorage
    localStorage.clear();

    // Clear badge
    document.dispatchEvent(new CustomEvent("td-dev-badge", { detail: { count: 0 } }));

    // Send reset control frame
    this.connection.sendControlFrame("reset");
  }
}
