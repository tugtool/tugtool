/**
 * Developer Card - shows dev mode change status for Styles (CSS/HTML), Code (JS/binary), App (.swift)
 */

import type { TugCard, TugCardMeta } from "./card";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugConnection } from "../connection";

/**
 * GitStatus payload received via FeedId.GIT frames.
 * Duplicated from git-card.ts -- see that file for the canonical definition.
 * Keep in sync with the GitStatus interface in git-card.ts.
 */
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  head_sha: string;
  head_message: string;
}

/** A single file entry in a GitStatus staged/unstaged array. */
interface FileStatus {
  path: string;
  status: string;
}

/** Row categories for file path classification in the Developer card. */
export type RowCategory = "styles" | "code" | "app";

/**
 * Categorize a repository-relative file path into a Developer card row.
 *
 * Patterns (Table T03 from the plan):
 *   Styles: tugdeck/ *.css, tugdeck/ *.html
 *   Code:   tugdeck/src/ *.ts, tugdeck/src/ *.tsx,
 *           tugcode/ *.rs, tugcode/ Cargo.toml
 *   App:    tugapp/Sources/ *.swift
 *
 * Returns null for paths that do not match any pattern.
 * Only staged and unstaged (tracked) files should be passed here;
 * callers are responsible for ignoring untracked files.
 */
export function categorizeFile(path: string): RowCategory | null {
  // Styles patterns (checked before Code to avoid tugdeck/styles/*.css matching Code)
  if (path.startsWith("tugdeck/") && path.endsWith(".css")) return "styles";
  if (path.startsWith("tugdeck/") && path.endsWith(".html")) return "styles";

  // Code patterns -- tugdeck/src/ prefix required for TS/TSX to avoid root-level tugdeck files
  if (path.startsWith("tugdeck/src/") && path.endsWith(".ts")) return "code";
  if (path.startsWith("tugdeck/src/") && path.endsWith(".tsx")) return "code";
  if (path.startsWith("tugcode/") && path.endsWith(".rs")) return "code";
  if (path.startsWith("tugcode/") && path.endsWith("Cargo.toml")) return "code";

  // App patterns
  if (path.startsWith("tugapp/Sources/") && path.endsWith(".swift")) return "app";

  return null;
}

export class DeveloperCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.GIT];

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

  // Per-row timestamp state
  private stylesLastCleanTs: number | null = null;
  private codeLastCleanTs: number | null = null;
  private codeFirstDirtySinceTs: number | null = null;
  private appLastCleanTs: number | null = null;
  private appFirstDirtySinceTs: number | null = null;

  // Per-row working state: count of edited (staged/unstaged tracked) files per row
  private stylesEditedCount = 0;
  private codeEditedCount = 0;
  private appEditedCount = 0;

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
    const count = payload.count as number | undefined;
    const timestamp = payload.timestamp as number | undefined;

    if (type === "reloaded") {
      // Flash Styles status to "Reloaded" for 2 seconds, then show clean label with timestamp
      if (this.stylesStatus) {
        this.stylesStatus.textContent = "Reloaded";
        if (this.reloadedTimer) clearTimeout(this.reloadedTimer);
        this.reloadedTimer = setTimeout(() => {
          if (this.stylesStatus) {
            if (timestamp !== undefined) {
              this.stylesLastCleanTs = timestamp;
            }
            this.stylesStatus.textContent = this.cleanLabel(this.stylesLastCleanTs);
          }
        }, 2000);
      }
    } else if (type === "restart_available") {
      // Capture "since" timestamp on first dirty notification after last clean state
      if (this.codeFirstDirtySinceTs === null && timestamp !== undefined) {
        this.codeFirstDirtySinceTs = timestamp;
      }
      // Set Code row dirty
      if (this.codeDot) {
        this.codeDot.style.backgroundColor = "var(--td-warning)";
      }
      if (this.codeStatus) {
        this.codeStatus.textContent = this.dirtyLabel(count ?? 0, this.codeFirstDirtySinceTs);
      }
      if (this.codeRestartBtn) {
        this.codeRestartBtn.style.display = "block";
      }
    } else if (type === "relaunch_available") {
      // Capture "since" timestamp on first dirty notification after last clean state
      if (this.appFirstDirtySinceTs === null && timestamp !== undefined) {
        this.appFirstDirtySinceTs = timestamp;
      }
      // Set App row dirty
      if (this.appDot) {
        this.appDot.style.backgroundColor = "var(--td-warning)";
      }
      if (this.appStatus) {
        this.appStatus.textContent = this.dirtyLabel(count ?? 0, this.appFirstDirtySinceTs);
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

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    if (feedId !== FeedId.GIT || payload.length === 0) return;

    const text = new TextDecoder().decode(payload);
    let status: GitStatus;
    try {
      status = JSON.parse(text);
    } catch {
      console.error("developer-card: failed to parse GitStatus payload");
      return;
    }

    // Collect unique paths from staged and unstaged (ignore untracked per [D03])
    const paths = new Set<string>();
    for (const f of status.staged) paths.add(f.path);
    for (const f of status.unstaged) paths.add(f.path);

    // Count edited files per row
    let stylesCount = 0;
    let codeCount = 0;
    let appCount = 0;
    for (const path of paths) {
      const category = categorizeFile(path);
      if (category === "styles") stylesCount++;
      else if (category === "code") codeCount++;
      else if (category === "app") appCount++;
    }

    this.stylesEditedCount = stylesCount;
    this.codeEditedCount = codeCount;
    this.appEditedCount = appCount;

    // Re-render each row to reflect updated working state
    this.renderWorkingState("styles");
    this.renderWorkingState("code");
    this.renderWorkingState("app");
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
    // Null timestamp state
    this.stylesLastCleanTs = null;
    this.codeLastCleanTs = null;
    this.codeFirstDirtySinceTs = null;
    this.appLastCleanTs = null;
    this.appFirstDirtySinceTs = null;
    // Reset working state edited counts
    this.stylesEditedCount = 0;
    this.codeEditedCount = 0;
    this.appEditedCount = 0;
  }

  // ---- Private ----

  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  private cleanLabel(ts: number | null): string {
    return ts !== null ? "Clean -- " + this.formatTime(ts) : "Clean";
  }

  private dirtyLabel(count: number, sinceTs: number | null): string {
    const countPart = count === 1 ? "1 change" : `${count} changes`;
    return sinceTs !== null ? countPart + " -- since " + this.formatTime(sinceTs) : countPart;
  }

  /**
   * Render working state (edited vs. clean) for a single row.
   * Used by onFrame() after updating edited counts.
   * Does not handle stale state -- that is managed by update() directly
   * and will be unified into renderRow() in step 3.
   */
  private renderWorkingState(row: "styles" | "code" | "app"): void {
    let dot: HTMLElement | null;
    let status: HTMLElement | null;
    let editedCount: number;
    let lastCleanTs: number | null;

    if (row === "styles") {
      dot = this.stylesDot;
      status = this.stylesStatus;
      editedCount = this.stylesEditedCount;
      lastCleanTs = this.stylesLastCleanTs;
    } else if (row === "code") {
      dot = this.codeDot;
      status = this.codeStatus;
      editedCount = this.codeEditedCount;
      lastCleanTs = this.codeLastCleanTs;
    } else {
      dot = this.appDot;
      status = this.appStatus;
      editedCount = this.appEditedCount;
      lastCleanTs = this.appLastCleanTs;
    }

    if (!dot || !status) return;

    if (editedCount > 0) {
      dot.style.backgroundColor = "var(--td-info)";
      const plural = editedCount === 1 ? "file" : "files";
      const base = `Edited (${editedCount} ${plural})`;
      status.textContent = lastCleanTs !== null ? base + " -- " + this.formatTime(lastCleanTs) : base;
    } else {
      dot.style.backgroundColor = "var(--td-success)";
      status.textContent = this.cleanLabel(lastCleanTs);
    }
  }

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
    // Set Code row to clean with timestamp
    this.codeLastCleanTs = Date.now();
    this.codeFirstDirtySinceTs = null;
    if (this.codeDot) {
      this.codeDot.style.backgroundColor = "var(--td-success)";
    }
    if (this.codeStatus) {
      this.codeStatus.textContent = this.cleanLabel(this.codeLastCleanTs);
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
    // Set App row to clean with timestamp
    this.appLastCleanTs = Date.now();
    this.appFirstDirtySinceTs = null;
    if (this.appDot) {
      this.appDot.style.backgroundColor = "var(--td-success)";
    }
    if (this.appStatus) {
      this.appStatus.textContent = this.cleanLabel(this.appLastCleanTs);
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
