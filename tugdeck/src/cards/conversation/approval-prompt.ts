/**
 * Approval prompt - renders tool approval request with Allow/Deny buttons
 */

import { createElement, X, AlertTriangle } from "lucide";
import { getToolIcon } from "./tool-card";

export class ApprovalPrompt {
  private container: HTMLElement;
  private actionsElement: HTMLElement;
  private onAllowCallback?: () => void;
  private onDenyCallback?: () => void;
  private allowBtn?: HTMLButtonElement;
  private denyBtn?: HTMLButtonElement;
  private isStale = false;

  constructor(
    private toolName: string,
    private requestId: string,
    private input: Record<string, unknown>
  ) {
    this.container = this.createContainer();
    this.actionsElement = this.container.querySelector(".approval-prompt-actions")!;
  }

  private createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "approval-prompt";
    container.dataset.requestId = this.requestId;

    // Header with tool icon and name
    const header = document.createElement("div");
    header.className = "approval-prompt-header";

    const iconSpan = document.createElement("span");
    iconSpan.className = "approval-prompt-icon";
    const Icon = getToolIcon(this.toolName);
    const icon = createElement(Icon, { width: 16, height: 16 });
    iconSpan.appendChild(icon);

    const nameSpan = document.createElement("span");
    nameSpan.className = "approval-prompt-name";
    nameSpan.textContent = `${this.toolName} requires approval`;

    header.appendChild(iconSpan);
    header.appendChild(nameSpan);

    // Input preview
    const preview = document.createElement("div");
    preview.className = "approval-prompt-preview";
    
    // Format input as key-value pairs
    const inputStr = Object.entries(this.input)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n");
    preview.textContent = inputStr || "(no input)";

    // Actions (Allow/Deny buttons)
    const actions = document.createElement("div");
    actions.className = "approval-prompt-actions";

    this.allowBtn = document.createElement("button");
    this.allowBtn.className = "approval-prompt-allow";
    this.allowBtn.textContent = "Allow";
    this.allowBtn.addEventListener("click", () => {
      if (this.onAllowCallback) {
        this.onAllowCallback();
      }
    });

    this.denyBtn = document.createElement("button");
    this.denyBtn.className = "approval-prompt-deny";
    this.denyBtn.textContent = "Deny";
    this.denyBtn.addEventListener("click", () => {
      this.showDenied();
      if (this.onDenyCallback) {
        this.onDenyCallback();
      }
    });

    actions.appendChild(this.allowBtn);
    actions.appendChild(this.denyBtn);

    container.appendChild(header);
    container.appendChild(preview);
    container.appendChild(actions);

    return container;
  }

  /**
   * Set callbacks for Allow and Deny actions
   */
  setCallbacks(onAllow: () => void, onDeny: () => void): void {
    this.onAllowCallback = onAllow;
    this.onDenyCallback = onDeny;
  }

  /**
   * Show denied state with X icon and remove buttons
   */
  showDenied(): void {
    this.container.classList.add("approval-prompt-denied");

    // Replace actions with denied label
    this.actionsElement.innerHTML = "";
    const deniedLabel = document.createElement("div");
    deniedLabel.className = "approval-prompt-denied-label";

    const xIcon = createElement(X, { width: 16, height: 16 });
    deniedLabel.appendChild(xIcon);

    const text = document.createElement("span");
    text.textContent = "Denied by user";
    deniedLabel.appendChild(text);

    this.actionsElement.appendChild(deniedLabel);
  }

  /**
   * Mark this approval prompt as stale (session restarted)
   */
  markStale(): void {
    if (this.isStale) return;
    this.isStale = true;

    // Add stale class
    this.container.classList.add("approval-prompt-stale");

    // Disable buttons
    if (this.allowBtn) this.allowBtn.disabled = true;
    if (this.denyBtn) this.denyBtn.disabled = true;

    // Create stale overlay
    const overlay = document.createElement("div");
    overlay.className = "approval-prompt-stale-overlay";

    const icon = createElement(AlertTriangle, { width: 16, height: 16 });
    overlay.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = "Session restarted -- this request is no longer active";
    overlay.appendChild(text);

    // Ensure container has position:relative
    this.container.style.position = "relative";
    this.container.appendChild(overlay);
  }

  /**
   * Get the DOM element for this approval prompt
   */
  render(): HTMLElement {
    return this.container;
  }
}
